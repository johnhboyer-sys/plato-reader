// Page 1 reads only its own books (the row table, shared/lib/row-table): open
// a heavy search on a built site and record what page 1 fetches from /data/,
// the books by name and the bytes raw and gzipped. Fails where page 1 reads a
// book it does not draw, more than --max-books books, or more than --max-mb
// of data unzipped. Plato's port of aristotle-reader's gate R-S8, which
// lives in its check-redesign.mjs; Plato has no such file.
//   node scripts/search-page1.mjs --base http://localhost:4400 [--path "/search?g=…"] [--max-books N] [--max-mb N]
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
const require = createRequire(import.meta.url);
function resolvePlaywright() {
  try { return require('playwright'); } catch {}
  const root = join(homedir(), '.npm', '_npx');
  if (existsSync(root)) for (const hash of readdirSync(root)) {
    const p = join(root, hash, 'node_modules', 'playwright');
    if (existsSync(p)) return require(p);
  }
  throw new Error('Playwright not found in the project or npm cache');
}
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cache)) process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
}
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = flag('--base');
if (!base) throw new Error('Usage: --base URL [--path PATH] [--max-books N] [--max-mb N]');
// ἀρετή and/or virtue: 40 rows on page 1, from a search that reaches nearly
// every dialogue.
const path = flag('--path', '/search?g=ἀρετή&e=virtue&op=or');
// Measured on the built site, 17 Nov: page 1's 40 rows stand in 6 books, and
// page 1 reads those 6 and 11.7 MB of data unzipped (2.3 MB gzipped), 0.4 MB
// of it the row tables; the site before the table read 51 books, 55.8 MB
// (12.9 MB gzipped). The bound leaves the indexes a little room to grow; a
// book more is caught by the count.
const maxBooks = Number(flag('--max-books', '6'));
const maxBytes = Number(flag('--max-mb', '12.5')) * 1e6;

// The headless shell in the Playwright cache, whatever build this Playwright
// asks for (CLAUDE.md: no Google Chrome on this machine).
const shells = join(homedir(), 'Library', 'Caches', 'ms-playwright');
const shell = existsSync(shells) && readdirSync(shells).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()
  .map(d => join(shells, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')).find(p => existsSync(p));
const browser = await resolvePlaywright().chromium.launch({ headless: true, ...(shell ? { executablePath: shell } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const p = await context.newPage();
  const books = new Set();
  const reads = [];
  let raw = 0;
  let gzip = 0;
  p.on('response', r => {
    const at = new URL(r.url()).pathname;
    if (!at.includes('/data/')) return;
    if (/\/book-\d+\.json$/.test(at)) books.add(at.replace(/^.*\/data\//, ''));
    reads.push(r.body().then(b => { raw += b.length; gzip += gzipSync(b).length; }).catch(() => {}));
  });
  await p.goto(new URL(path, base).href);
  await p.waitForFunction(() => document.querySelectorAll('main.search-page li.instance').length > 0
    && /of \d+/.test([...document.querySelectorAll('main.search-page .result-count')].find(el => el.checkVisibility())?.textContent ?? ''), null, { timeout: 120000 });
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(2000);
  await p.waitForLoadState('networkidle');
  await Promise.all(reads);
  const own = new Set(await p.evaluate(() => [...document.querySelectorAll('main.search-page li.instance a.inst-ref')]
    .map(a => { const m = new URL(a.href).pathname.match(/\/([^/]+)\/book\/(\d+)/); return m ? `${m[1]}/book-${m[2].padStart(2, '0')}.json` : ''; })));
  const rows = await p.locator('main.search-page li.instance').count();
  const stray = [...books].filter(b => !own.has(b));
  console.log(`page 1 of ${path}: ${rows} rows from ${own.size} books; read ${books.size} books, ${(raw / 1e6).toFixed(2)} MB of data (${(gzip / 1e6).toFixed(2)} MB gzipped)`);
  if (stray.length) console.log(`  read and not drawn: ${stray.length} (${stray.slice(0, 6).join(', ')}${stray.length > 6 ? ', …' : ''})`);
  const fails = [];
  if (!rows || !own.size) fails.push(`page 1 drew ${rows} rows from ${own.size} books`);
  if (stray.length) fails.push(`page 1 read ${stray.length} books it does not draw`);
  if (books.size > maxBooks) fails.push(`page 1 read ${books.size} books, at most ${maxBooks}`);
  if (raw > maxBytes) fails.push(`page 1 read ${(raw / 1e6).toFixed(2)} MB of data, at most ${maxBytes / 1e6} MB`);
  for (const f of fails) console.log(`FAIL ${f}`);
  process.exitCode = fails.length ? 1 : 0;
} finally { await browser.close(); }
