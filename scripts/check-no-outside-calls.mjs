#!/usr/bin/env node
// Does a built site call any host but its own? HANDOFF-PORTABILITY.md, test 3.
// Node 22+ and Playwright, found as below (it is no package of this repo).
//
//   node scripts/check-no-outside-calls.mjs [--dist=app/dist] [--allow=host,host]
//   SITE_BASE=/mirror/ node scripts/check-no-outside-calls.mjs --dist=<folder>
//
// The build is served from 127.0.0.1 under its base (SITE_BASE, read by
// scripts/site-params.mjs). Chromium is started with a second local server
// as its proxy, and nothing skips it, this machine's own addresses included
// ("<-loopback>"). The proxy hands a request for the site to the file
// server. Every other CONNECT or request it writes down and refuses, so
// nothing leaves the machine, and every call to another host or port, from
// a page or from the service worker, is seen.
//
// Before the visits, the page asks for a made-up .invalid host over http:
// and https:. The run fails if the proxy did not see both: then the block
// is not working, and a clean result would mean nothing.
//
// The visits: a work page, a word popup, a search, a lemma page, and the
// work page again once the service worker is in charge (Plato's reader offers
// no other typefaces, so Aristotle's sixth visit has no counterpart here).
// Each fails the run
// by name when what it looks for is not on screen. The run also fails on a
// site request that came back 404, on an uncaught page error, on a page that
// never stops asking for files, and when a visit did not run or the site got
// no requests.
//
// --allow names the hosts that may be asked for (exact names; a port other
// than 80 or 443, or a subdomain, is another host). They are still refused.
// The default is Grammata's site and its packs bucket (HANDOFF-PORTABILITY.md,
// decision 4: "two hosts ... until the packs move under one name").
//
// A <link rel="preconnect"> or "dns-prefetch" asks for no file: through a
// proxy Chromium sends nothing that names the host, though a visitor's
// browser would call it. So when a visit ends, those links are read off the
// page and their hosts counted with the rest.
//
// What this cannot see:
// - a link hint that is gone again when its visit ends;
// - anything a reader can do that these visits do not;
// - what an allowed host's script would call in turn: it is refused like the
//   rest, so it never runs. The list rules on what the site itself asks for;
// - traffic that is not HTTP, such as WebRTC's UDP. The site uses none.
//
// Exit 0 ok, 1 failure, 2 bad arguments.
import { createReadStream, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { siteParams } from './site-params.mjs';

export const DEFAULT_ALLOW = ['grammata.pages.dev', 'pub-d505f3fd993b4e01b2ab095428d0493e.r2.dev'];
// Site files a page asks for that no build makes, each with its reason: a
// 404 at exactly one of these paths (under the base, no query) is printed and
// not failed. --expect-missing replaces the list. A path the build does hold
// is refused, so the list cannot go stale in silence.
export const EXPECTED_MISSING = {
  // search.ts asks for the lemma-map shard of a word's first letter and reads
  // a 404 as "no words here". v is the digamma's shard, and Plato has no word
  // that starts with one.
  'data/lemma-map/v.json': 'the digamma shard: Plato has no word that starts with a digamma',
};
const REL = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const USAGE = 'Usage: node scripts/check-no-outside-calls.mjs [--dist=<folder>] [--allow=host,host]';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

export function parseArgs(argv, env = process.env) {
  let dist = path.resolve(import.meta.dirname, '..', 'app', 'dist');
  let allow = DEFAULT_ALLOW;
  let expected = Object.keys(EXPECTED_MISSING);
  for (const arg of argv) {
    if (arg.startsWith('--dist=')) dist = path.resolve(arg.slice(7));
    else if (arg.startsWith('--expect-missing=')) {
      expected = arg.slice(17) ? arg.slice(17).split(',') : [];
      const bad = expected.filter((p) => !REL.test(p));
      if (bad.length) throw usageError(`--expect-missing takes paths relative to the site's root, with no query: ${bad.map((p) => JSON.stringify(p)).join(', ')}`);
    }
    else if (arg.startsWith('--allow=')) {
      allow = arg.slice(8).split(',');
      const bad = allow.filter((h) => !HOST.test(h));
      if (bad.length) throw usageError(`--allow takes bare host names (no scheme, port, path or wildcard): ${bad.map((h) => JSON.stringify(h)).join(', ')}`);
    } else throw usageError(`Unknown argument: ${arg}`);
  }
  if (!existsSync(path.join(dist, 'index.html'))) throw usageError(`No index.html in ${dist}`);
  for (const p of expected) if (existsSync(path.join(dist, p))) throw usageError(`the expected-404 list names ${p} as never built, but ${dist} holds it; take it off the list`);
  try { return { dist, allow, base: siteParams(env).base, expected }; } catch (e) { throw usageError(e.message); }
}

function usageError(message) {
  return Object.assign(new Error(message), { usage: true });
}

// "host" for the default ports, "host:port" for any other, so an allowed
// name never covers a service on another port.
export function hostKey(host, port) {
  return port === 80 || port === 443 ? host : `${host}:${port}`;
}

// A CONNECT's target is "host:port"; any other proxied request names an
// absolute URI. Anything else is written down as it came.
export function parseTarget(kind, target) {
  if (kind === 'connect') {
    const at = target.lastIndexOf(':');
    return { host: target.slice(0, at).toLowerCase(), port: Number(target.slice(at + 1)) };
  }
  try {
    const u = new URL(target);
    return { host: u.hostname, port: Number(u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80)) };
  } catch {
    return { host: target, port: 0 };
  }
}

// The proxy that forwards nothing. `deaf` is a test seam: the proxy answers
// but writes nothing down, so the control must catch it.
export async function startRecorder({ deaf = false, site } = {}) {
  const rec = { seen: [], visit: 'start' };
  const note = (kind, target) => {
    if (deaf) return;
    const { host, port } = parseTarget(kind, target);
    rec.seen.push({ kind, host, key: hostKey(host, port), target, visit: rec.visit });
  };
  const refuse = (socket) => { socket.on('error', () => {}); socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); };
  const server = http.createServer((req, res) => {
    if (site && req.url.startsWith(`http://127.0.0.1:${site.port}/`)) return site.handle(req, res);
    note('http', req.url);
    res.writeHead(403, { 'content-length': 0 });
    res.end();
  });
  server.on('connect', (req, socket) => { note('connect', req.url); refuse(socket); });
  server.on('upgrade', (req, socket) => { note('http', req.url); refuse(socket); });
  server.on('clientError', (_e, socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  rec.port = server.address().port;
  rec.note = note;
  rec.close = () => closeServer(server);
  return rec;
}

// The build under its base path: /base/x is dist/x, /base/dir/ is
// dist/dir/index.html; anything else, and any path that leaves the folder,
// is 404.
export async function startSite(dist, base) {
  const root = realpathSync(dist);
  const site = { requests: 0, missing: [], visit: 'start' };
  const notFound = (req, res) => {
    // Through the proxy the request line holds the whole address.
    const u = URL.canParse(req.url, 'http://x') ? new URL(req.url, 'http://x') : null;
    site.missing.push({ path: u ? u.pathname + u.search : req.url, visit: site.visit });
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  };
  site.handle = (req, res) => {
    site.requests++;
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return notFound(req, res); }
    if (p === base.slice(0, -1) && base !== '/') { res.writeHead(301, { location: base }); return res.end(); }
    if (!p.startsWith(base)) return notFound(req, res);
    let file = path.resolve(root, p.slice(base.length));
    if (file !== root && !file.startsWith(root + path.sep)) return notFound(req, res);
    if (!existsSync(file)) return notFound(req, res);
    if (statSync(file).isDirectory()) {
      if (!p.endsWith('/')) { res.writeHead(301, { location: p + '/' }); return res.end(); }
      file = path.join(file, 'index.html');
      if (!existsSync(file)) return notFound(req, res);
    }
    // A link inside the folder may still point out of it.
    const real = realpathSync(file);
    if (!real.startsWith(root + path.sep) || !statSync(real).isFile()) return notFound(req, res);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(real).pipe(res);
  };
  // The port is this server's; the browser reaches it through the proxy.
  const server = http.createServer(site.handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  site.port = server.address().port;
  site.close = () => closeServer(server);
  return site;
}

function closeServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

// Found as aristotle-reader's app/scripts/check-redesign.mjs finds it. The Playwright in
// the npx cache can be newer than the browsers installed for it, and nothing
// is downloaded here, so a missing browser falls back to the newest headless
// shell already in the cache.
async function launchChromium(proxyPort) {
  const cache = path.join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(cache)) process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
  const require = createRequire(import.meta.url);
  let pw;
  try { pw = require('playwright'); } catch {
    const npx = path.join(homedir(), '.npm', '_npx');
    for (const hash of existsSync(npx) ? readdirSync(npx) : []) {
      const p = path.join(npx, hash, 'node_modules', 'playwright');
      if (existsSync(p)) { pw = require(p); break; }
    }
  }
  if (!pw) throw new Error('Playwright not found: install it, or run `npx playwright --version` once to fill the npx cache');
  const options = { args: [`--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>'] };
  try {
    return await pw.chromium.launch(options);
  } catch (e) {
    if (!/Executable doesn't exist/.test(e.message)) throw e;
    const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const shells = (browsers && existsSync(browsers) ? readdirSync(browsers) : [])
      .filter((d) => /^chromium_headless_shell-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const shell of shells) {
      const dir = readdirSync(path.join(browsers, shell)).find((d) => d.startsWith('chrome-headless-shell-'));
      const exe = dir && path.join(browsers, shell, dir, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
      if (exe && existsSync(exe)) return pw.chromium.launch({ ...options, executablePath: exe });
    }
    throw new Error(`Playwright's Chromium is not installed and no headless shell is in ${browsers}`);
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// True once neither server has had a request for `quiet` ms; false when
// that has not happened within `max` ms.
async function settle(site, rec, max, quiet = 1000) {
  const start = Date.now();
  let last = -1, since = start;
  while (Date.now() - start < max) {
    const n = site.requests + rec.seen.length;
    if (n !== last) { last = n; since = Date.now(); } else if (Date.now() - since >= quiet) return true;
    await pause(100);
  }
  return false;
}

// Opens a browser on the build, runs the control and the visits, and returns
// the verdict. `visits` are {name, run({page, url, dist})}; `url` is the
// site's root, base included.
export async function run({ dist, base, allow, expected = [], visits, deaf = false, patience = 20000 }) {
  const site = await startSite(dist, base);
  const rec = await startRecorder({ deaf, site });
  const own = `127.0.0.1:${site.port}`;
  const control = `control-${process.pid}-${Date.now()}.invalid`;
  const pageErrors = [], consoleErrors = [], visitFailures = [], ran = [];
  const firstUrl = new Map();
  let controlSeen = false, browser;
  try {
    browser = await launchChromium(rec.port);
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    // Labels only: the proxy decides, but it sees no URL inside a CONNECT.
    context.on('request', (r) => {
      const u = new URL(r.url());
      if (/^(https?|wss?):$/.test(u.protocol) && u.host !== own) {
        const key = hostKey(u.hostname, Number(u.port || (/^(https|wss):$/.test(u.protocol) ? 443 : 80)));
        if (!firstUrl.has(key)) firstUrl.set(key, r.url());
      }
    });
    // The control on a page of its own, so its refusals are not counted
    // among the visits' console errors.
    rec.visit = site.visit = 'control';
    const blank = await context.newPage();
    await blank.evaluate(async (host) => {
      for (const scheme of ['http', 'https']) await fetch(`${scheme}://${host}/`, { mode: 'no-cors' }).catch(() => {});
    }, control);
    const saw = (kind) => rec.seen.some((s) => s.host === control && s.kind === kind);
    for (let i = 0; i < 50 && !(controlSeen = saw('http') && saw('connect')); i++) await pause(100);
    await blank.close();

    const page = await context.newPage();
    // On the context, so a window a page opens is heard too.
    context.on('weberror', (w) => pageErrors.push({ message: w.error().message, visit: rec.visit }));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    if (controlSeen) {
      const url = `http://127.0.0.1:${site.port}${base}`;
      for (const visit of visits) {
        rec.visit = site.visit = visit.name;
        try {
          await visit.run({ page, url, dist });
          if (!(await settle(site, rec, patience))) throw new Error(`the site was still asking for files after ${patience / 1000} seconds`);
          // Link hints ask for no file; see the header. Every frame of every
          // window is read; one that cannot be read is another site's,
          // refused already.
          const read = () => [...document.querySelectorAll('link[rel][href]')]
            .filter((l) => /(^|\s)(preconnect|dns-prefetch)(\s|$)/i.test(l.rel)).map((l) => l.href);
          const hints = await page.evaluate(read);
          const others = context.pages().flatMap((p) => p.frames()).filter((f) => f !== page.mainFrame());
          for (const frame of others) hints.push(...await frame.evaluate(read).catch(() => []));
          for (const href of hints) if (URL.canParse(href) && new URL(href).host !== own) rec.note('hint', href);
          ran.push(visit.name);
        } catch (e) {
          visitFailures.push(`visit "${visit.name}" failed: ${e.message.split('\n')[0]}`);
        }
      }
    }
  } finally {
    await browser?.close().catch(() => {});
    await site.close();
    await rec.close();
  }
  return verdict({
    seen: rec.seen.filter((s) => s.host !== control), allow, controlSeen, firstUrl,
    requests: site.requests, missing: site.missing, planned: visits.map((v) => v.name), ran, visitFailures,
    pageErrors, consoleErrors, base, expected,
  });
}

// Pure: what the run found, as {ok, hosts, lines}. The last line says how
// much was examined, pass or fail.
export function verdict({ seen, allow, controlSeen, firstUrl = new Map(), requests, missing: notFound, planned, ran, visitFailures = [], pageErrors = [], consoleErrors = [], base = '/', expected = [] }) {
  const isExpected = (m) => m.path.startsWith(base) && expected.includes(m.path.slice(base.length));
  const missing = notFound.filter((m) => !isExpected(m));
  const known = notFound.filter(isExpected);
  const hosts = new Map();
  for (const s of seen) {
    const h = hosts.get(s.key) ?? { key: s.key, count: 0, first: firstUrl.get(s.key) ?? s.target, visit: s.visit, allowed: allow.includes(s.key) };
    h.count++;
    hosts.set(s.key, h);
  }
  const list = [...hosts.values()];
  const denied = list.filter((h) => !h.allowed);
  const allowed = list.filter((h) => h.allowed);
  const uncaught = pageErrors;
  const lines = [], problems = [];
  const show = (h) => `${h.key} x${h.count} (first: ${h.first} during "${h.visit}")`;

  if (!controlSeen) problems.push('the block is not working: the proxy did not see the control host over both http: and https:, so no visit was run');
  if (denied.length) problems.push(`${denied.length} outside host${denied.length === 1 ? ' is' : 's are'} not allowed: ${denied.map(show).join(', ')}`);
  problems.push(...visitFailures);
  const notRun = planned.filter((name) => !ran.includes(name));
  if (controlSeen && notRun.length) problems.push(`${notRun.length} visit${notRun.length === 1 ? '' : 's'} did not run: ${notRun.join(', ')}`);
  if (controlSeen && requests === 0) problems.push('the site got no requests: nothing was examined');
  if (missing.length) problems.push(`${missing.length} site request${missing.length === 1 ? '' : 's'} came back 404`);
  if (uncaught.length) problems.push(`${uncaught.length} uncaught page error${uncaught.length === 1 ? '' : 's'}`);

  for (const h of allowed) lines.push(`  allowed (refused all the same): ${show(h)}`);
  for (const m of known) lines.push(`  expected not found: ${m.path} during "${m.visit}"`);
  for (const m of missing.slice(0, 30)) lines.push(`  not found: ${m.path} during "${m.visit}"`);
  if (missing.length > 30) lines.push(`  … and ${missing.length - 30} more not found`);
  for (const e of uncaught.slice(0, 5)) lines.push(`  page error during "${e.visit}": ${e.message.split('\n')[0]}`);
  lines.push(`  console errors: ${consoleErrors.length}${pageErrors.length ? `; page errors: ${pageErrors.length}` : ''}`);
  for (const c of consoleErrors.slice(0, 3)) lines.push(`    ${c.split('\n')[0].slice(0, 200)}`);

  const counts = `${ran.length} of ${planned.length} visits, ${requests} requests to the site (${missing.length} not found${known.length ? `, ${known.length} expected` : ''}), `
    + `${list.length} outside host${list.length === 1 ? '' : 's'} asked for`;
  const ok = problems.length === 0;
  const tail = ok
    ? `${counts}${list.length ? `, ${list.length === 1 ? 'it' : 'all'} allowed (${allowed.map((h) => `${h.key} x${h.count}`).join(', ')})` : ''}; control seen`
    : `${problems.join('; ')}; ${counts}; control ${controlSeen ? 'seen' : 'NOT seen'}`;
  return { ok, hosts: list, denied: denied.map((h) => h.key), allowed: allowed.map((h) => h.key), lines, tail };
}

// The page of this build a link leads to, as a path under dist, or null: the
// link must stay on the site, under its base, and name a folder below the
// root that holds an index.html.
export function localPage(href, url, dist) {
  if (!URL.canParse(href)) return null;
  const link = new URL(href), root = new URL(url);
  if (link.origin !== root.origin || !link.pathname.startsWith(root.pathname)) return null;
  let rel;
  try { rel = decodeURIComponent(link.pathname.slice(root.pathname.length)); } catch { return null; }
  const file = path.resolve(dist, rel, 'index.html');
  if (!rel || !file.startsWith(path.resolve(dist) + path.sep) || !existsSync(file) || !statSync(file).isFile()) return null;
  return rel;
}

// ── The visits ────────────────────────────────────────────────────────────
// Greek and Coptic, and Greek Extended.
const GREEK = new RegExp('[\\u0370-\\u03ff\\u1f00-\\u1fff]');
const WORK = 'Euthyphro/book/1/';
const LEMMA = 'lemma/logos/';
const LOAD = { waitUntil: 'domcontentloaded', timeout: 60000 };

// Reader.svelte: Greek tokens in .greek-col, the translation in .english-col.
async function openWork(page, url) {
  await page.goto(url + WORK, LOAD);
  await page.waitForSelector('.greek-col .tok', { timeout: 30000 });
  const n = await page.evaluate((src) => {
    // Only what is laid out on the page: not a column a style hides.
    const text = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }))
      .map((e) => e.innerText).join('');
    return { greek: (text('.greek-col').match(new RegExp(src, 'g')) ?? []).length,
      english: (text('.english-col').match(/[A-Za-z]/g) ?? []).length };
  }, GREEK.source);
  // The Euthyphro is one book: tens of thousands of letters.
  if (n.greek < 5000) throw new Error(`the Greek columns hold ${n.greek} Greek letters, under 5000`);
  if (n.english < 5000) throw new Error(`the English columns hold ${n.english} Latin letters, under 5000`);
}

export const SITE_VISITS = [
  { name: 'work page', run: ({ page, url }) => openWork(page, url) },
  {
    // WordPopup.svelte: div.word-sidebar, its cards' .lemma (headword),
    // .gloss and .parse-rows. All come from the site's own data; Grammata is
    // only asked for when "Show LSJ definition" is pressed.
    name: 'word popup',
    run: async ({ page, url }) => {
      if (!page.url().endsWith(WORK)) await openWork(page, url);
      const word = page.locator('.greek-col .tok').first();
      // The click does nothing until the reader's island has hydrated.
      for (let i = 0; i < 30 && !(await page.locator('.word-sidebar').count()); i++) {
        await word.click();
        await page.waitForSelector('.word-sidebar', { timeout: 1000 }).catch(() => {});
      }
      await page.waitForSelector('.word-sidebar .analysis-card .lemma, .word-sidebar .popup-loading:not(:has-text("Looking up"))', { timeout: 15000 });
      const card = await page.evaluate(() => {
        const side = document.querySelector('.word-sidebar');
        const t = (sel) => [...side.querySelectorAll(sel)].map((e) => e.innerText.trim()).join(' ');
        return { shown: side.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }), note: t('.popup-loading'),
          lemma: t('.analysis-card .lemma'), gloss: t('.analysis-card .gloss'), parse: t('.analysis-card .parse-rows dt') };
      });
      if (!card.shown) throw new Error('the popup is in the page but not on screen');
      if (card.note) throw new Error(`the popup says "${card.note}"`);
      if (!GREEK.test(card.lemma)) throw new Error(`the popup's headword is not Greek: "${card.lemma}"`);
      if (!card.gloss && !card.parse) throw new Error('the popup shows neither a gloss nor a parse');
    },
  },
  {
    // Search.svelte: #grk-input, button.search-btn, hits as li.instance
    // with a.inst-ref linking into a work.
    name: 'search',
    run: async ({ page, url, dist }) => {
      await page.goto(url + 'search/', LOAD);
      const box = page.locator('#grk-input');
      // Typed before hydration, the text never reaches the component.
      for (let i = 0; i < 30; i++) {
        await box.fill('λόγος');
        await page.locator('button.search-btn[type="submit"]').first().click();
        if (await page.waitForSelector('li.instance a.inst-ref', { timeout: 2000 }).catch(() => null)) break;
      }
      const hit = await page.locator('li.instance a.inst-ref').first().evaluate((a) => ({ text: a.textContent.trim(), href: a.href }))
        .catch(() => { throw new Error('no hit for λόγος'); });
      if (!localPage(hit.href, url, dist)) throw new Error(`the first hit (${hit.text}) does not link to a page of this build: ${hit.href}`);
      if (!hit.text) throw new Error('the first hit has no citation text');
    },
  },
  {
    // LemmaPage.astro: h1.lm-hw, p.lm-gl, the works list ul.bywork; the LSJ
    // entry itself is Grammata's, in .grammata-mount, whose text changes from
    // "Loading the dictionary entry…" when it loads or fails.
    name: 'lemma page',
    run: async ({ page, url }) => {
      await page.goto(url + LEMMA, LOAD);
      const head = (await page.locator('h1.lm-hw').textContent({ timeout: 15000 }))?.trim();
      if (head !== 'λόγος') throw new Error(`the headword is "${head}", not λόγος`);
      const gloss = (await page.locator('.lm-gl').textContent({ timeout: 5000 }).catch(() => ''))?.trim();
      if (!gloss) throw new Error('the page shows no gloss');
      if (!(await page.locator('.bywork a').count())) throw new Error('the page lists no works');
      await page.waitForFunction(() => {
        const t = document.querySelector('.grammata-mount')?.textContent.trim();
        return t && !t.startsWith('Loading the dictionary entry');
      }, null, { timeout: 15000 }).catch(() => { throw new Error('the LSJ entry neither loaded nor failed'); });
    },
  },
  {
    // Pwa.astro registers sw.js on load; once it controls the page, the
    // reload's requests pass through it, and its own fetches are seen.
    name: 'work page, service worker',
    run: async ({ page, url }) => {
      if (!page.url().endsWith(WORK)) await openWork(page, url);
      const ready = await page.evaluate(() => Promise.race([
        navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 20000))]));
      if (!ready) throw new Error('the service worker never became ready');
      await page.reload(LOAD);
      await page.waitForSelector('.greek-col .tok', { timeout: 30000 });
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) throw new Error('the service worker does not control the reloaded page');
    },
  },
];

async function main(argv) {
  let args;
  try { args = parseArgs(argv); } catch (e) {
    if (!e.usage) throw e;
    console.error(e.message);
    console.error(USAGE);
    return 2;
  }
  const rel = path.relative(process.cwd(), args.dist) || '.';
  const label = rel.startsWith('..') ? args.dist : rel;
  const r = await run({ ...args, visits: SITE_VISITS });
  for (const line of r.lines) console.log(line);
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${label} at ${args.base}: ${r.tail}`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.log(`FAIL ${e.message.split('\n')[0]}; 0 visits run`);
    process.exit(1);
  });
}
