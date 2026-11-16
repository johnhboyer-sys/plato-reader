// Baseline of Plato's search before the port of aristotle-reader's new search.
// Adapted from aristotle-reader app/scripts/search-counts.mjs (origin/main eae145a3f1).
// Runs each search on a served build and records the bar's total, the page
// count, the bar's text, and the rows drawn on page 1. Run it again after the
// port and compare: a count that moves must be explained.
//
//   node docs/search-port/search-counts.mjs --base http://127.0.0.1:4410 --out docs/search-port/counts-base-2026-11-16.json
//
// Serve app/dist first (python3 -m http.server <port> --bind 127.0.0.1 -d app/dist).
// Playwright resolves from the project or the npm cache (npx), as in Aristotle's.
import { createRequire } from 'node:module';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
const flag = name => args[args.indexOf(name) + 1];
if (!args.includes('--base') || !args.includes('--out')) throw new Error('Usage: --base URL --out FILE.json');

// Each covers one thing the port touches: language, and/or, phrase,
// proximity, speaker, lemma, accents, running text, works.
const queries = [
  ['Greek, any form', { g: 'ἀρετή' }],
  ['English', { e: 'virtue' }],
  ['Both, and', { g: 'ἀρετή', e: 'virtue' }],
  ['Both, or', { g: 'ἀρετή', e: 'virtue', op: 'or' }],
  ['Greek, any word', { g: 'ἀρετή δικαιοσύνη', gm: 'any' }],
  ['Greek exact phrase', { g: 'ὦ Σώκρατες', gm: 'phrase', m: 'form' }],
  ['English exact phrase', { e: 'the good', em: 'phrase' }],
  ['Single lemma', { l: 'h(donh/' }],
  ['Accents observed', { g: 'ἀρετὴ', m: 'form', acc: '1' }],
  ['Accents ignored', { g: 'ἀρετὴ', m: 'form' }],
  ['Running text', { g: 'λογ', m: 'text' }],
  ['Virtue near justice (10 words)', [['c', 'l:areth'], ['c', 'l:dikaiosunh'], ['cw', '10']]],
  ['Pleasure before virtue, no pain', [['c', 'l:areth'], ['c', 'lb:hdonh'], ['c', 'ln:luph'], ['cw', '10']]],
  ['Speaker: Socrates only', { g: 'ἀρετή', sp: 'only', sn: 'Socrates' }],
  ['Works: Meno, Protagoras', { g: 'ἀρετή', w: 'Meno,Protagoras' }],
];

const browser = await resolvePlaywright().chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const results = [];
try {
  const page = await browser.newPage();
  for (const [name, params] of queries) {
    try {
      const url = new URL(`/search?${new URLSearchParams(params)}`, flag('--base')).href;
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => {
        const err = document.querySelector('.search-error');
        if (err) throw new Error(err.textContent);
        const status = document.querySelector('[role="status"]')?.textContent?.trim();
        return status && (status === 'No passages found.' || /^\d[\d,]* instances?/.test(status));
      }, null, { timeout: 120000 });
      // Page 1's rows are drawn after the count; wait for them to settle.
      await page.waitForFunction(() => {
        const status = document.querySelector('[role="status"]').textContent.trim();
        const loading = [...document.querySelectorAll('.pager-status')].some(el => el.textContent.includes('Loading'));
        return status === 'No passages found.' || (!loading && document.querySelectorAll('.instance-list > li').length > 0);
      }, null, { timeout: 120000 });
      const counts = await page.evaluate(() => {
        const status = document.querySelector('[role="status"]').textContent.trim();
        const match = status.match(/^([\d,]+) instances?/);
        if (!match && status !== 'No passages found.') throw new Error(`Unreadable count: ${status}`);
        const pages = status.match(/page \d+ of (\d+)/i);
        return {
          total: match ? Number(match[1].replaceAll(',', '')) : 0,
          pages: pages ? Number(pages[1]) : match ? 1 : 0,
          shown: status,
          bar: document.querySelector('.result-count')?.textContent?.trim() ?? null,
          rowsOnPage1: document.querySelectorAll('.instance-list > li').length,
        };
      });
      results.push({ name, url, ...counts });
      console.log(name, counts);
    } catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
  }
  writeFileSync(flag('--out'), JSON.stringify(results, null, 2) + '\n');
} finally { await browser.close(); }
