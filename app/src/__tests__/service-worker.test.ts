import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The Cloudflare build moves corpus data to another origin (R2), and
// scripts/postbuild-data-root.mjs writes that root into dist/sw.js. Run the
// real script over a scratch dist, then load the worker it wrote.
//
// sw.js is a plain browser script, not a module: run it inside a fake
// ServiceWorkerGlobalScope and collect the listeners it registers.
// process.cwd() is app/ under vitest. Ported from aristotle-reader (PR #222).
const SW_SRC = readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');

const ORIGIN = 'https://example.test';
const SCOPE = ORIGIN + '/';

function loadSw(src = SW_SRC) {
  const listeners = new Map<string, (event: unknown) => void>();
  const puts: string[] = [];
  const cache = {
    addAll: async () => {},
    match: async () => undefined,
    put: async (request: { url: string }) => { puts.push(request.url); },
  };
  const self = {
    registration: { scope: SCOPE },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    addEventListener: (name: string, fn: (event: unknown) => void) => { listeners.set(name, fn); },
  };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true };
  const fetchImpl = async () => ({ ok: true, type: 'cors', marker: 'network', clone: () => ({ marker: 'clone' }) });

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'location', src)(
    self, caches, fetchImpl, { origin: ORIGIN, href: SCOPE },
  );

  return {
    puts,
    fetchEvent(url: string, mode = 'cors') {
      const waits: Promise<unknown>[] = [];
      let response: Promise<unknown> | undefined;
      listeners.get('fetch')!({
        request: { url, method: 'GET', mode },
        waitUntil: (p: Promise<unknown>) => { waits.push(p); },
        respondWith: (p: Promise<unknown>) => { response = p; },
      });
      return { response, waits };
    },
  };
}

describe('service worker with off-origin data (PUBLIC_DATA_ROOT)', () => {
  const DATA = 'https://data.example.com';
  const dist = mkdtempSync(path.join(tmpdir(), 'sw-root-'));
  writeFileSync(path.join(dist, 'sw.js'), SW_SRC);
  execFileSync(process.execPath, ['scripts/postbuild-data-root.mjs', dist], {
    env: { ...process.env, PUBLIC_DATA_ROOT: DATA + '/' },
  });
  const src = readFileSync(path.join(dist, 'sw.js'), 'utf8');

  it('names the root in sw.js and keeps data out of the Worker upload', () => {
    expect(src).toContain(`const DATA_ROOT = "${DATA}/";`);
    expect(readFileSync(path.join(dist, '.assetsignore'), 'utf8')).toBe('data\n');
  });

  it('caches data from the root, network-first', async () => {
    const sw = loadSw(src);
    const event = sw.fetchEvent(DATA + '/Phaedo/book-01.json');
    await expect(event.response).resolves.toMatchObject({ marker: 'network' });
    await Promise.all(event.waits);
    expect(sw.puts).toEqual([DATA + '/Phaedo/book-01.json']);
  });

  it('leaves other origins alone', () => {
    const sw = loadSw(src);
    expect(sw.fetchEvent('https://data.example.com.evil.test/Phaedo/book-01.json').response).toBeUndefined();
  });

  it('does nothing without a root', () => {
    expect(SW_SRC).toMatch(/^const DATA_ROOT = '';$/m);
    const sw = loadSw();
    expect(sw.fetchEvent(DATA + '/Phaedo/book-01.json').response).toBeUndefined();
  });
});
