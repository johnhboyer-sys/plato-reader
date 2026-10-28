import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The service worker's contract is "anything you have read is available
// offline", which only holds if each cache write outlives the response. A
// write started and then abandoned (`cache.put(...)` with nothing holding the
// event open) may be killed when the browser stops the worker after the
// response is delivered, so every write must be handed to event.waitUntil().
// Ported from homer-reader, where the same defect was found and fixed.
//
// sw.js is a plain browser script, not a module: run it inside a fake
// ServiceWorkerGlobalScope and collect the listeners it registers.
const SW_SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../app/public/sw.js'), 'utf8');

const ORIGIN = 'https://example.test';
const SCOPE = ORIGIN + '/';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };

function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Let every queued microtask and timer callback run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Does this promise still have nothing to say once the queue has drained? */
async function pending(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  await flush();
  return !settled;
}

interface Harness {
  fetchEvent(url: string, init?: { mode?: string }): {
    response: Promise<Response> | null;
    waits: Promise<unknown>[];
  };
  /** Resolves the one in-flight cache.put, if any. */
  put: Deferred<void>;
  puts: string[];
  /** Every URL the worker asked the network for. */
  fetched: string[];
}

function loadSw(
  { responseOk = true, type = 'basic', cached = false }: { responseOk?: boolean; type?: string; cached?: boolean } = {},
): Harness {
  const listeners = new Map<string, (event: unknown) => void>();
  const put = defer<void>();
  const puts: string[] = [];
  const fetched: string[] = [];

  const cache = {
    addAll: async () => {},
    // With `cached`, every request already has a copy in the cache.
    match: async () => (cached ? { marker: 'cached' } : undefined),
    put: (request: { url: string }) => {
      puts.push(request.url);
      return put.promise;
    },
  };

  const self = {
    registration: { scope: SCOPE },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners.set(type, fn); },
  };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true };
  const fetchImpl = async (request: { url: string }) => {
    fetched.push(request.url);
    return {
      ok: responseOk,
      type,
      marker: 'network',
      clone: () => ({ marker: 'clone' }),
    };
  };

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'location', SW_SRC)(
    self, caches, fetchImpl, { origin: ORIGIN },
  );

  return {
    put,
    puts,
    fetched,
    fetchEvent(url, init = {}) {
      const waits: Promise<unknown>[] = [];
      let response: Promise<Response> | null = null;
      const event = {
        request: { url, method: 'GET', mode: init.mode ?? 'no-cors' },
        waitUntil: (p: Promise<unknown>) => { waits.push(p); },
        respondWith: (p: Promise<Response>) => { response = p; },
      };
      listeners.get('fetch')!(event);
      return { get response() { return response; }, waits };
    },
  };
}

/** The write is made, the response is not held back for it, and the event stays open until it lands. */
async function expectHeldWrite(sw: Harness, url: string, init?: { mode?: string }, marker: object = { marker: 'network' }) {
  const event = sw.fetchEvent(url, init);
  await expect(event.response).resolves.toMatchObject(marker);
  expect(sw.puts).toEqual([url]);

  expect(event.waits).toHaveLength(1);
  expect(await pending(event.waits[0])).toBe(true);

  sw.put.resolve();
  expect(await pending(event.waits[0])).toBe(false);
}

describe('service worker cache writes are tied to the event lifetime', () => {
  it('page navigations (network-first, offline page fallback)', async () => {
    await expectHeldWrite(loadSw(), SCOPE + 'Phaedo/book/1/', { mode: 'navigate' });
  });

  it('corpus data and other same-scope files (network-first)', async () => {
    await expectHeldWrite(loadSw(), SCOPE + 'data/Phaedo/book-01.json');
  });

  it('hashed build assets under /_astro/ (cache-first)', async () => {
    await expectHeldWrite(loadSw(), SCOPE + '_astro/Reader.abc123.css');
  });

  it('the self-hosted fonts (cache-first)', async () => {
    await expectHeldWrite(loadSw(), SCOPE + 'fonts/gentium-book-plus-400-greek.woff2');
  });

  // cacheFirst also keeps an opaque response (ok is false) on its own arm. No
  // same-origin request is opaque, but the arm is in the code, so it gets a
  // case: with a 'basic' response the first condition short-circuits and the
  // arm is never reached.
  it('the opaque arm of cache-first', async () => {
    await expectHeldWrite(loadSw({ responseOk: false, type: 'opaque' }), SCOPE + 'fonts/geologica-latin.woff2', undefined, { type: 'opaque' });
  });

  it('does not write, or extend the event, for a failed response', async () => {
    const sw = loadSw({ responseOk: false });
    const event = sw.fetchEvent(SCOPE + 'data/Phaedo/book-01.json');

    await expect(event.response).resolves.toMatchObject({ ok: false });
    expect(sw.puts).toEqual([]);
    expect(event.waits).toEqual([]);
  });

  it('leaves cross-origin requests to the browser', () => {
    const sw = loadSw();
    const event = sw.fetchEvent('https://fonts.gstatic.com/s/x/v1/font.woff2');
    expect(event.response).toBeNull();
    expect(sw.puts).toEqual([]);
  });
});

// With a copy already cached, the two strategies part: cache-first answers
// from the cache and never touches the network, network-first still asks the
// network. These cases pin each route to its strategy, which the write cases
// above cannot do (their cache always misses, so both strategies fetch).
describe('each route keeps its strategy', () => {
  for (const url of [SCOPE + '_astro/Reader.abc123.css', SCOPE + 'fonts/gentium-book-plus-400-greek.woff2']) {
    it(`cache-first: ${url.slice(SCOPE.length)} is served from the cache without a request`, async () => {
      const sw = loadSw({ cached: true });
      const event = sw.fetchEvent(url);
      await expect(event.response).resolves.toMatchObject({ marker: 'cached' });
      expect(sw.fetched).toEqual([]);
    });
  }

  for (const [url, init] of [[SCOPE + 'Phaedo/book/1/', { mode: 'navigate' }], [SCOPE + 'data/Phaedo/book-01.json', {}]] as const) {
    it(`network-first: ${url.slice(SCOPE.length)} still goes to the network`, async () => {
      const sw = loadSw({ cached: true });
      const event = sw.fetchEvent(url, init);
      await expect(event.response).resolves.toMatchObject({ marker: 'network' });
      expect(sw.fetched).toEqual([url]);
    });
  }
});
