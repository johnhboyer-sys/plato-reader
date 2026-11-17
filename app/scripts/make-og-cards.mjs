// Share cards (og:image, 1200×630), one per work: public/og/<Work>.jpg.
// Design C (John, 2026-11-16): the work's opening words carved across the card,
// its Greek and English titles under them, "ΠΛΑΤΩΝ · Plato Reader" and the site's
// address at the foot.
//
// Each card is the work's own built landing page, restyled to the card, so it uses
// the site's fonts and says what the page says. Serve a build first:
//   node scripts/make-og-cards.mjs [--base http://localhost:4420] [--only Crito,Laws]
// The default base is the live site.
//
// src/data/og-cards.json records each card's words and sha256, so og-cards.test.ts
// can tell a swapped or stale card from the right one.
//
// Playwright is resolved as in scripts/shoot.mjs: the local install, else the npx cache.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function resolvePlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const npxRoot = join(homedir(), '.npm', '_npx');
  if (existsSync(npxRoot)) {
    for (const hash of readdirSync(npxRoot)) {
      const p = join(npxRoot, hash, 'node_modules', 'playwright');
      if (existsSync(p)) return require(p);
    }
  }
  throw new Error('Playwright not found. Install it (npm i -D playwright) or run `npx playwright --version` once.');
}
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cache)) process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
}

const app = fileURLToPath(new URL('..', import.meta.url));
const flag = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const base = (flag('--base') || 'https://plato.johnhboyer.com').replace(/\/$/, '');
const only = flag('--only')?.split(',');

// The card's layout, laid over the landing page. The page's opening inscription
// (12 × 4 cells there) runs 16 × 3 here, fading on its last row as on the page.
const CARD_CSS = `
  html, body { width: 1200px; height: 630px; overflow: hidden; margin: 0; }
  .site-nav, .lp-cta-row, .lp-facts, .lp > section:not(.lp-head), .site-footer, footer, dialog,
  .lp-eyebrow, .lp-lede, .lp-ref { display: none !important; }
  .lp { margin: 0 !important; padding: 0 !important; max-width: none !important; }
  .lp-head { display: flex !important; flex-direction: column; justify-content: center; gap: 44px;
    position: absolute; left: 64px; right: 64px; top: 24px; height: 524px; margin: 0 !important; padding: 0 !important; border: 0 !important; }
  .lp-inscr .stoi { --cols: 16 !important; --cell-w: 67px !important; --cell-h: 84px !important; --cell-fs: 62px !important; }
  .lp-intro { display: flex; align-items: baseline; gap: 0 28px; flex-wrap: nowrap; margin: 0 !important; }
  .lp-gr { font-size: var(--gs, 56px) !important; margin: 0 !important; white-space: nowrap; }
  h1.lp-en { font-size: var(--es, 46px) !important; margin: 0 !important; white-space: nowrap; }
  .og-foot { position: absolute; left: 64px; right: 64px; top: 548px; border-top: 1px solid var(--rule, #c9ccd1);
    padding-top: 18px; display: flex; justify-content: space-between;
    font: 500 15px/1 var(--font-caps, inherit); letter-spacing: .22em; text-transform: uppercase; color: var(--accent); }
  .og-foot .b { color: var(--text-mid); }
`;

const pw = resolvePlaywright();
const browser = await pw.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, colorScheme: 'light', serviceWorkers: 'block' })).newPage();

// The works: every landing page the home links to.
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
const all = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')]
  .map((a) => new URL(a.href).pathname.match(/^\/([A-Za-z0-9]+)\/?$/)?.[1]).filter(Boolean))]);
const ids = [];
for (const id of all) {
  if (only && !only.includes(id)) continue;
  const r = await page.goto(`${base}/${id}/`, { waitUntil: 'domcontentloaded' });
  if (r?.ok() && await page.$('.lp-inscr')) ids.push(id);
}
if (only && ids.length !== only.length) throw Error(`no work page for ${only.filter((id) => !ids.includes(id)).join(', ')}`);

mkdirSync(`${app}public/og`, { recursive: true });
mkdirSync(`${app}src/data`, { recursive: true });
const recordFile = `${app}src/data/og-cards.json`;
const record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) : {};
for (const id of ids) {
  await page.goto(`${base}/${id}/`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: CARD_CSS });
  const c = await page.evaluate(() => {
    const foot = document.createElement('div');
    foot.className = 'og-foot';
    foot.innerHTML = '<span class="b">ΠΛΑΤΩΝ · Plato Reader</span><span>plato.johnhboyer.com</span>';
    document.body.append(foot);
    return {
      title: document.querySelector('h1.lp-en')?.textContent.trim(),
      greek: document.querySelector('.lp-gr')?.textContent.trim(),
      opening: [...document.querySelectorAll('.lp-inscr .stoi span')].map((s) => s.textContent).join(''),
    };
  });
  for (const [k, v] of Object.entries(c)) if (!v) throw Error(`${base}/${id}/ has no ${k} for its card`);
  await page.evaluate(() => document.fonts.ready);
  // A long pair of titles steps down together until it fits the line.
  const fit = await page.evaluate(() => {
    const row = document.querySelector('.lp-intro'), c = document.documentElement;
    let gs = 56;
    for (; gs > 34 && row.scrollWidth > row.clientWidth; ) {
      gs -= 2;
      c.style.setProperty('--gs', `${gs}px`);
      c.style.setProperty('--es', `${Math.round(gs * 46 / 56)}px`);
    }
    const head = document.querySelector('.lp-head');
    return { gs, over: row.scrollWidth > row.clientWidth || head.scrollHeight > head.clientHeight };
  });
  if (fit.over) throw Error(`${id}: the words do not fit the card`);
  const path = `${app}public/og/${id}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 88 });
  record[id] = { ...c, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
  console.log(`${id.padEnd(14)} ${c.greek} · ${c.title}${fit.gs < 56 ? `  (titles ${fit.gs}px)` : ''}`);
}
await browser.close();
writeFileSync(recordFile, JSON.stringify(Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]])), null, 1) + '\n');
console.log(`${ids.length} cards`);
