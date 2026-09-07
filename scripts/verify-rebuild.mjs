#!/usr/bin/env node
// Post-rebuild checks for the two failures a full corpus rebuild commits
// silently (CLAUDE.md, Build gotchas), plus the slug and row-count diffs a
// deploy is supposed to look at anyway.
//
//   `plato_pipeline all` is per work. It does not run stage8, so /phrases can
//   ship with no data behind it; and it recreates build/dist/<work>/, which
//   destroys the alt[] payload align_turns.py injects, so the Jowett compare
//   column ships blank. Neither raises. This script does.
//
// Usage (from the repo root, after scripts/build-public.mjs or a partial rebuild):
//
//   node scripts/verify-rebuild.mjs
//   node scripts/verify-rebuild.mjs --live-slugs https://johnhboyer-sys.github.io/plato-reader/data/lemmata/_index.json
//   node scripts/verify-rebuild.mjs --snapshot build/rows.json
//   node scripts/verify-rebuild.mjs --baseline build/rows-live.json --changed Republic,Charmides
//
//   --data <dir>          data root (default build/dist)
//   --live-slugs <src>    a lemmata/_index.json to diff the built slug set
//                         against: a URL or a local path. A removed or renamed
//                         slug FAILS unless --allow-removed-slugs is given,
//                         because it breaks an inbound /lemma/<slug>/ link.
//   --snapshot <file>     write the per-book row counts here (segments, turns,
//                         flow kind) for use as a later --baseline.
//   --baseline <file>     compare row counts against a snapshot. Works whose
//                         counts changed FAIL unless named in --changed.
//   --changed <a,b,...>   works expected to differ from the baseline.
//   --allow-removed-slugs treat removed slugs as a warning, not a failure.
//
// Exit status 1 on any FAIL. Every check prints one line; failures repeat at
// the end so they cannot scroll off.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function parseArgs(argv) {
  const out = { data: join(ROOT, 'build', 'dist'), changed: [], allowRemovedSlugs: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--data') out.data = resolve(next());
    else if (a === '--live-slugs') out.liveSlugs = next();
    else if (a === '--snapshot') out.snapshot = resolve(next());
    else if (a === '--baseline') out.baseline = resolve(next());
    else if (a === '--changed') out.changed = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--allow-removed-slugs') out.allowRemovedSlugs = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// The works the build is supposed to contain: one per manifest, the -public
// variants folded into their base work.
export function manifestWorks(manifestsDir) {
  return readdirSync(manifestsDir)
    .filter(n => n.endsWith('.yaml') && !n.endsWith('-public.yaml'))
    .map(n => n.slice(0, -'.yaml'.length))
    .sort();
}

// The compare overlays the build is supposed to carry: sources/*/align.json.
export function alignConfigs(sourcesDir) {
  if (!existsSync(sourcesDir)) return [];
  return readdirSync(sourcesDir)
    .map(dir => join(sourcesDir, dir, 'align.json'))
    .filter(p => existsSync(p))
    .map(p => {
      const cfg = readJson(p);
      return { path: p, work: cfg.work, transId: cfg.trans_id };
    })
    .sort((a, b) => a.work.localeCompare(b.work));
}

function bookFiles(workDir) {
  if (!existsSync(workDir)) return [];
  return readdirSync(workDir).filter(n => /^book-\d+\.json$/.test(n)).sort();
}

// ── Checks ─────────────────────────────────────────────────────────────────
// Each returns { name, status: 'ok' | 'warn' | 'fail', detail }.

export function checkWorksPresent(dataDir, works) {
  const missing = works.filter(w =>
    !existsSync(join(dataDir, w, 'manifest.json')) || bookFiles(join(dataDir, w)).length === 0);
  return missing.length
    ? { name: 'works', status: 'fail', detail: `${missing.length} of ${works.length} works have no data: ${missing.join(', ')}` }
    : { name: 'works', status: 'ok', detail: `${works.length} works emitted` };
}

export function checkPhraseIndex(dataDir, works) {
  const summaryPath = join(dataDir, 'ngrams', 'summary.json');
  if (!existsSync(summaryPath)) {
    return { name: 'phrase index', status: 'fail', detail: 'ngrams/summary.json missing — stage8 did not run; /phrases has no data' };
  }
  const summary = readJson(summaryPath);
  const problems = [];
  if (summary.works !== works.length) problems.push(`stage8 saw ${summary.works} works, manifests have ${works.length} — rerun stage8 after the last work`);
  for (const stream of ['form', 'lemma', 'english']) {
    const kept = summary.streams?.[stream]?.kept ?? 0;
    if (!kept) problems.push(`${stream} stream kept 0 phrases`);
  }
  const mapDir = join(dataDir, 'lemma-map');
  const shards = existsSync(mapDir) ? readdirSync(mapDir).filter(n => n.endsWith('.json')).length : 0;
  if (!shards) problems.push('lemma-map/ is empty — lemma search cannot widen an inflected form');
  return problems.length
    ? { name: 'phrase index', status: 'fail', detail: problems.join('; ') }
    : {
        name: 'phrase index',
        status: 'ok',
        detail: `${summary.works} works; form ${summary.streams.form.kept} / lemma ${summary.streams.lemma.kept} / english ${summary.streams.english.kept} phrases; ${shards} lemma-map shards`,
      };
}

// Every turn of every book of an overlay work must carry alt[transId]. The
// aligner writes an entry for EVERY reference turn (e: null where it found no
// match), so a turn with no key at all means the aligner never ran on this
// emission — `all` recreated the directory after it.
export function checkOverlays(dataDir, configs) {
  const results = [];
  for (const cfg of configs) {
    const books = bookFiles(join(dataDir, cfg.work));
    if (!books.length) {
      results.push({ name: `compare ${cfg.work}`, status: 'fail', detail: 'no book files' });
      continue;
    }
    let turns = 0;
    let keyed = 0;
    let filled = 0;
    for (const b of books) {
      const data = readJson(join(dataDir, cfg.work, b));
      for (const t of data.turnFlow?.turns ?? []) {
        turns++;
        const alt = t.alt?.[cfg.transId];
        if (alt) { keyed++; if (alt.e) filled++; }
      }
    }
    if (!turns) {
      results.push({ name: `compare ${cfg.work}`, status: 'fail', detail: 'no turnFlow — the aligner has nothing to attach to' });
    } else if (keyed < turns) {
      results.push({
        name: `compare ${cfg.work}`, status: 'fail',
        detail: `${turns - keyed} of ${turns} turns have no alt.${cfg.transId} — align_turns.py has not run since this work was rebuilt; the compare column is blank`,
      });
    } else if (!filled) {
      results.push({ name: `compare ${cfg.work}`, status: 'fail', detail: `all ${turns} turns aligned to nothing` });
    } else {
      const pct = (100 * filled / turns).toFixed(1);
      results.push({ name: `compare ${cfg.work}`, status: pct < 90 ? 'warn' : 'ok', detail: `${filled}/${turns} turns carry ${cfg.transId} (${pct}%)` });
    }
  }
  return results;
}

export function slugSet(indexJson) {
  return new Set(indexJson.map(e => e.slug));
}

export function diffSlugs(built, live) {
  const added = [...built].filter(s => !live.has(s)).sort();
  const removed = [...live].filter(s => !built.has(s)).sort();
  return { added, removed };
}

async function loadSlugSource(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
    return res.json();
  }
  return readJson(resolve(src));
}

export async function checkSlugs(dataDir, liveSrc, allowRemoved) {
  const indexPath = join(dataDir, 'lemmata', '_index.json');
  if (!existsSync(indexPath)) {
    return { name: 'lemma slugs', status: 'warn', detail: 'lemmata/_index.json not built yet (app build writes it) — skipped' };
  }
  const built = slugSet(readJson(indexPath));
  if (!liveSrc) {
    return { name: 'lemma slugs', status: 'ok', detail: `${built.size} slugs built; pass --live-slugs to diff against the live site` };
  }
  let live;
  try {
    live = slugSet(await loadSlugSource(liveSrc));
  } catch (err) {
    return { name: 'lemma slugs', status: 'warn', detail: `could not load ${liveSrc}: ${err.message}` };
  }
  const { added, removed } = diffSlugs(built, live);
  const show = (xs) => xs.slice(0, 12).join(', ') + (xs.length > 12 ? ` … (+${xs.length - 12})` : '');
  if (!added.length && !removed.length) {
    return { name: 'lemma slugs', status: 'ok', detail: `byte-identical slug set: ${built.size} slugs` };
  }
  const detail = `${built.size} built vs ${live.size} live; +${added.length} added${added.length ? ` (${show(added)})` : ''}; -${removed.length} removed${removed.length ? ` (${show(removed)})` : ''}`;
  if (removed.length && !allowRemoved) {
    return { name: 'lemma slugs', status: 'fail', detail: `${detail} — a removed slug breaks an inbound /lemma/ link; pass --allow-removed-slugs if intended` };
  }
  return { name: 'lemma slugs', status: added.length || removed.length ? 'warn' : 'ok', detail };
}

// Per-book row counts. `kind` distinguishes a dialogue turn flow from a
// narrated paragraph flow from a bare segment list, so a work silently
// falling back from spine mode to the dialogue flow shows up here.
export function rowSnapshot(dataDir, works) {
  const snap = {};
  for (const w of works) {
    const books = {};
    for (const b of bookFiles(join(dataDir, w))) {
      const data = readJson(join(dataDir, w, b));
      books[b] = {
        segments: data.segments?.length ?? 0,
        turns: data.turnFlow?.turns?.length ?? 0,
        kind: data.turnFlow ? (data.turnFlow.kind ?? 'dialogue') : 'segments',
      };
    }
    snap[w] = books;
  }
  return snap;
}

export function diffSnapshots(baseline, current) {
  const changed = [];
  for (const w of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    const a = JSON.stringify(baseline[w] ?? null);
    const b = JSON.stringify(current[w] ?? null);
    if (a !== b) changed.push(w);
  }
  return changed.sort();
}

export function checkRows(snapshot, baselinePath, expectedChanged) {
  if (!baselinePath) return { name: 'row counts', status: 'ok', detail: `${Object.keys(snapshot).length} works counted; pass --baseline to compare` };
  const baseline = readJson(baselinePath);
  const changed = diffSnapshots(baseline, snapshot);
  const expected = new Set(expectedChanged);
  const unexpected = changed.filter(w => !expected.has(w));
  const unchangedButExpected = expectedChanged.filter(w => !changed.includes(w));
  const parts = [];
  if (changed.length) parts.push(`changed: ${changed.join(', ')}`);
  else parts.push('no work changed');
  if (unchangedButExpected.length) parts.push(`expected to change but did not: ${unchangedButExpected.join(', ')}`);
  if (unexpected.length) {
    return { name: 'row counts', status: 'fail', detail: `${parts.join('; ')} — not named in --changed: ${unexpected.join(', ')}` };
  }
  return { name: 'row counts', status: unchangedButExpected.length ? 'warn' : 'ok', detail: parts.join('; ') };
}

// ── Driver ─────────────────────────────────────────────────────────────────

export async function runChecks(opts, { manifestsDir = join(ROOT, 'manifests'), sourcesDir = join(ROOT, 'sources') } = {}) {
  const works = manifestWorks(manifestsDir);
  const results = [];
  results.push(checkWorksPresent(opts.data, works));
  results.push(checkPhraseIndex(opts.data, works));
  results.push(...checkOverlays(opts.data, alignConfigs(sourcesDir)));
  results.push(await checkSlugs(opts.data, opts.liveSlugs, opts.allowRemovedSlugs));
  const snapshot = rowSnapshot(opts.data, works);
  if (opts.snapshot) writeFileSync(opts.snapshot, JSON.stringify(snapshot, null, 1));
  results.push(checkRows(snapshot, opts.baseline, opts.changed));
  return { results, snapshot };
}

function report(results) {
  const pad = Math.max(...results.map(r => r.name.length));
  for (const r of results) {
    const tag = r.status === 'ok' ? 'ok  ' : r.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${tag}  ${r.name.padEnd(pad)}  ${r.detail}`);
  }
  const failed = results.filter(r => r.status === 'fail');
  if (failed.length) {
    console.log(`\n${failed.length} check${failed.length === 1 ? '' : 's'} FAILED:`);
    for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
  } else {
    console.log('\nverify-rebuild: all checks passed');
  }
  return failed.length ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.data)) {
    console.error(`data dir ${opts.data} does not exist — build first`);
    process.exit(1);
  }
  const { results } = await runChecks(opts);
  process.exit(report(results));
}
