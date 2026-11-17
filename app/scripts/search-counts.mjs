// Every search below on a built site: its count line, and with --pages every
// page's rows (each row's reference and link), so two builds can be compared
// row for row (search-counts-compare.mjs). Ported from aristotle-reader's,
// with Plato's searches, which reach every view, join, context and filter.
//   node scripts/search-counts.mjs --base http://localhost:4400 --out FILE.json [--pages] [--extra "ctx=1&ps=20"]
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
if (!args.includes('--base') || !args.includes('--out')) throw new Error('Usage: --base URL --out FILE.json [--pages] [--extra "ctx=1&ps=20"]');
const walk = args.includes('--pages');
const extra = args.includes('--extra') ? new URLSearchParams(flag('--extra')) : null;
const queries = [
  ['Greek any form', { g: 'ἀρετή' }],
  ['English virtue', { e: 'virtue' }],
  ['Both, a link with no op (and)', { g: 'ἀρετή', e: 'virtue' }],
  ['Both and/or', { g: 'ἀρετή', e: 'virtue', op: 'or' }],
  ['Both or: one language, not both', { g: 'ἀρετή', e: 'virtue', op: 'xor' }],
  ['Greek any word', { g: 'ἀρετή ἐπιστήμη', gm: 'any' }],
  ['Exact phrase', { g: 'ὦ Σώκρατες', gm: 'phrase', m: 'form' }],
  ['Virtue near knowledge', [['c', 'l:areth'], ['c', 'l:episthmh'], ['cw', '10']]],
  ['Accents observed', { g: 'ἀρετή', acc: '1' }],
  ['Running text', { g: 'σωφροσυν', m: 'text' }],
  ['Genitive plural near virtue', [['c', 'g:case.gen,number.pl'], ['c', 'l:areth'], ['cw', '10']]],
  ['By form', { g: 'ἀρετή', v: 'form' }],
  ['By grammar', { g: 'ἀρετή', v: 'grammar' }],
  ['Both and/or by form', { g: 'ἀρετή', e: 'virtue', op: 'or', v: 'form' }],
  ['Both and/or, one line', { g: 'ἀρετή', e: 'virtue', op: 'or', ctx: '1' }],
  ['Both and/or, the section', { g: 'ἀρετή', e: 'virtue', op: 'or', ctx: 's' }],
  ['English justice, a phrase set aside', { e: 'justice', xp: 'of justice and' }],
  ['Both justice and/or, a phrase set aside', { g: 'δικαιοσύνη', e: 'justice', op: 'or', xp: 'of justice and' }],
  ['English justice in Jowett', { e: 'justice', t: 'jowett' }],
  ['Narrated: temperance in Charmides', { g: 'σωφροσύνη', e: 'temperance', op: 'or', w: 'Charmides' }],
  ['Republic only, Greek and English', { g: 'ψυχή', e: 'soul', op: 'or', wf: 'Republic' }],
  ['Spoken by Socrates', { g: 'ἀρετή', sp: 'only', sn: 'Socrates' }],
];
// Every page's rows, from the first to the last, by the pager's Next.
async function pageRows(page) {
  const rows = [];
  for (let i = 1; ; i++) {
    await page.waitForFunction(n => {
      const status = document.querySelector('.pager-status')?.textContent ?? '';
      return document.querySelectorAll('li.instance').length > 0 && !/Loading/.test(status)
        && (n === 1 || status.startsWith(`Page ${n} `));
    }, i, { timeout: 120000 });
    rows.push(await page.$$eval('li.instance', lis => lis.map(li => {
      const a = li.querySelector('a.inst-ref, a.cmp-ref, .cmp-ref');
      return `${a?.textContent?.trim()} ${a?.getAttribute?.('href') ?? ''}`;
    })));
    // A DOM click: Playwright's own waits after a click can outlast the page's
    // re-render of the pager.
    const more = await page.evaluate(() => {
      const next = document.querySelector('button.pager-next');
      if (!next || next.disabled) return false;
      next.click();
      return true;
    });
    if (!more) break;
  }
  return rows;
}
// The headless shell in the Playwright cache, whatever build this Playwright
// asks for (CLAUDE.md: no Google Chrome on this machine).
const shells = join(homedir(), 'Library', 'Caches', 'ms-playwright');
const shell = existsSync(shells) && readdirSync(shells).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()
  .map(d => join(shells, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')).find(p => existsSync(p));
const browser = await resolvePlaywright().chromium.launch({ headless: true, ...(shell ? { executablePath: shell } : {}) });
const results = [];
try {
  const page = await browser.newPage();
  // The row table's own warnings: a book whose rows differ from the table's
  // count retires it, and a work with no table is read as before.
  let warnings = [];
  page.on('console', m => { if (/row table/.test(m.text())) warnings.push(m.text()); });
  for (const [name, params] of queries) {
    try {
      const query = new URLSearchParams(params);
      if (extra) for (const [k, v] of extra) query.set(k, v);
      const url = new URL(`/search?${query}`, flag('--base')).href;
      warnings = [];
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => {
        const status = document.querySelector('[role="status"][aria-live]')?.textContent?.trim();
        if (document.querySelector('.search-error')) throw new Error(document.querySelector('.search-error').textContent);
        // Pages are rows, counted as the books load: "page 1 of …" until they have.
        return status && (status === 'No passages found.' || (/^\d[\d,]* sections?/.test(status) && !/of …/.test(status)));
      }, null, { timeout: 120000 });
      const counts = await page.evaluate(() => {
        const status = document.querySelector('[role="status"][aria-live]').textContent.trim();
        // The bar counts Stephanus sections, with the hits where it counts them.
        const match = status.match(/^([\d,]+) sections?/);
        if (!match && status !== 'No passages found.') throw new Error(`Unreadable count: ${status}`);
        const hits = status.match(/· ([\d,]+) hits?/);
        const pages = status.match(/page \d+ of (\d+)/i);
        const separate = {};
        for (const el of document.querySelectorAll('.result-count, .lang-count')) {
          for (const m of el.textContent.matchAll(/([\d,]+)\s+(Greek|English)/gi)) separate[m[2].toLowerCase()] = Number(m[1].replaceAll(',', ''));
        }
        return { total: match ? Number(match[1].replaceAll(',', '')) : 0, hits: hits ? Number(hits[1].replaceAll(',', '')) : null, pages: pages ? Number(pages[1]) : match ? 1 : 0, ...separate, shown: status };
      });
      if (walk) counts.rows = await pageRows(page);
      if (warnings.length) counts.table = warnings;
      warnings = [];
      results.push({ name, url, ...counts });
      console.log(name, { ...counts, rows: counts.rows ? `${counts.rows.flat().length} rows on ${counts.rows.length} pages` : undefined });
    } catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
  }
  writeFileSync(flag('--out'), JSON.stringify(results, null, 2) + '\n');
} finally { await browser.close(); }
