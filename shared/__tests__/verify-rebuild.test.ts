import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  alignConfigs,
  checkOverlays,
  checkPhraseIndex,
  checkRows,
  checkSearchIndexes,
  checkSlugs,
  checkWorksPresent,
  diffSlugs,
  duplicateSlugs,
  manifestWorks,
  movedSlugs,
  parseArgs,
  rowSnapshot,
  runChecks,
  // @ts-expect-error — plain ESM script, no declaration file
} from '../../scripts/verify-rebuild.mjs';

// A miniature repo: two manifests, one Jowett overlay, a built data dir with
// everything the deploy needs present. Each test then breaks one thing.
let root: string;
let data: string;
let manifests: string;
let sources: string;

const write = (path: string, value: unknown) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
};

// `alt`: undefined = no alt key at all (aligner never ran); null = an alt
// object with no jowett entry; 'half' = every other turn matched; 'full' = all.
function book(turns: number, opts: { alt?: 'half' | 'full' | null; kind?: 'para' } = {}) {
  const altFor = (i: number) => {
    if (opts.alt === undefined) return {};
    if (opts.alt === null) return { alt: {} };
    return { alt: { jowett: { e: opts.alt === 'full' || i % 2 ? `j ${i}` : null } } };
  };
  return {
    book: 1,
    segments: [{ id: '1:2a' }, { id: '1:2b' }],
    turnFlow: {
      ...(opts.kind ? { kind: opts.kind } : {}),
      leadE: null,
      turns: Array.from({ length: turns }, (_, i) => ({
        s: 'Socrates', d: 'Socrates.', g: null, e: `turn ${i}`, p: true, ...altFor(i),
      })),
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'verify-rebuild-'));
  data = join(root, 'dist');
  manifests = join(root, 'manifests');
  sources = join(root, 'sources');
  write(join(manifests, 'Crito.yaml'), 'work: {id: Crito}\n');
  write(join(manifests, 'Republic.yaml'), 'work: {id: Republic}\n');
  write(join(manifests, 'Republic-public.yaml'), 'work: {id: Republic}\n');
  write(join(sources, 'jowett-crito', 'align.json'), { work: 'Crito', trans_id: 'jowett' });
  write(join(data, 'Crito', 'manifest.json'), {});
  write(join(data, 'Crito', 'book-01.json'), book(4, { alt: 'full' }));
  write(join(data, 'Republic', 'manifest.json'), {});
  write(join(data, 'Republic', 'book-01.json'), book(3, { kind: 'para' }));
  write(join(data, 'Republic', 'book-02.json'), book(5, { kind: 'para' }));
  write(join(data, 'ngrams', 'summary.json'), {
    works: 2,
    streams: { form: { kept: 10 }, lemma: { kept: 20 }, english: { kept: 5 } },
  });
  write(join(data, 'lemma-map', 'a.json'), { areth: ['areth'] });
  write(join(data, 'lemma-picker', 'a.json'), { areth: { n: 1, c: [] } });
  write(join(data, 'Crito', 'search', 'english-overlay-jowett.json'), { virtue: [[0, 0]] });
  for (const w of ['Crito', 'Republic']) {
    write(join(data, w, 'search', 'greek_lemma.json'), { areth: [[0, 0]] });
    write(join(data, w, 'search', 'greek_form.json'), { areth: [[0, 0]] });
    write(join(data, w, 'search', 'english.json'), { virtue: [[0, 1]] });
  }
  write(join(data, 'search-shards', 'lemma', 'ar.json'), {});
  write(join(data, 'search-shards', 'form', 'ar.json'), {});
  write(join(data, 'search-shards', 'english', 'vi.json'), {});
  // As stage9 records them: a source's hash is of the per-work file it copied.
  const h = (...path: string[]) => createHash('sha256').update(readFileSync(join(data, ...path))).digest('hex').slice(0, 16);
  write(join(data, 'search-shards', 'index.json'), {
    streams: {
      lemma: { shards: ['ar'], sources: { Crito: h('Crito', 'search', 'greek_lemma.json'), Republic: h('Republic', 'search', 'greek_lemma.json') } },
      form: { shards: ['ar'], sources: { Crito: h('Crito', 'search', 'greek_form.json'), Republic: h('Republic', 'search', 'greek_form.json') } },
      english: {
        shards: ['vi'],
        sources: {
          'Crito/english': h('Crito', 'search', 'english.json'),
          'Crito/overlay-jowett': h('Crito', 'search', 'english-overlay-jowett.json'),
          'Republic/english': h('Republic', 'search', 'english.json'),
        },
      },
    },
  });
  write(join(data, 'lemmata', '_index.json'), [{ slug: 'logos', key: 'lo/gos' }, { slug: 'arete', key: 'a)reth/' }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('verify-rebuild', () => {
  it('folds -public manifests into their work and finds the overlay configs', () => {
    expect(manifestWorks(manifests)).toEqual(['Crito', 'Republic']);
    expect(alignConfigs(sources).map((c: { work: string; transId: string }) => [c.work, c.transId])).toEqual([['Crito', 'jowett']]);
  });

  it('passes a complete build', async () => {
    const { results } = await runChecks({ data, changed: [] }, { manifestsDir: manifests, sourcesDir: sources });
    expect(results.map((r: { status: string }) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
  });

  it('fails a work that never emitted', () => {
    rmSync(join(data, 'Republic'), { recursive: true });
    const r = checkWorksPresent(data, ['Crito', 'Republic']);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('Republic');
  });

  it('fails when stage8 did not run, or ran before the last work', () => {
    const works = ['Crito', 'Republic'];
    rmSync(join(data, 'ngrams', 'summary.json'));
    expect(checkPhraseIndex(data, works)).toMatchObject({ status: 'fail', detail: expect.stringContaining('stage8 did not run') });
    write(join(data, 'ngrams', 'summary.json'), { works: 1, streams: { form: { kept: 1 }, lemma: { kept: 1 }, english: { kept: 1 } } });
    expect(checkPhraseIndex(data, works).detail).toContain('saw 1 works, manifests have 2');
  });

  it('fails the compare column when `all` has wiped the alt payload', () => {
    // No alt key at all: the aligner never ran on this emission.
    write(join(data, 'Crito', 'book-01.json'), book(4));
    const [r] = checkOverlays(data, alignConfigs(sources));
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('align_turns.py has not run');
    // An alt object present but without this translation is the same failure.
    write(join(data, 'Crito', 'book-01.json'), book(4, { alt: null }));
    expect(checkOverlays(data, alignConfigs(sources))[0].status).toBe('fail');
  });

  it('fails search when stage9 did not run, ran before the aligner, or the aligner did not index', () => {
    const works = ['Crito', 'Republic'];
    const cfgs = alignConfigs(sources);
    expect(checkSearchIndexes(data, works, cfgs).status).toBe('ok');
    // Shards built before the aligner wrote the Jowett index.
    write(join(data, 'search-shards', 'index.json'), {
      streams: {
        lemma: { sources: { Crito: 'h', Republic: 'h' } },
        form: { sources: { Crito: 'h', Republic: 'h' } },
        english: { sources: { 'Crito/english': 'h', 'Republic/english': 'h' } },
      },
    });
    expect(checkSearchIndexes(data, works, cfgs).detail).toContain('stage9 ran before the aligner');
    // A work stage9 never saw.
    expect(checkSearchIndexes(data, ['Crito', 'Republic', 'Meno'], cfgs).detail).toContain('lemma shards lack Meno');
    // The aligner never indexed Jowett.
    rmSync(join(data, 'Crito', 'search', 'english-overlay-jowett.json'));
    expect(checkSearchIndexes(data, works, cfgs).detail).toContain('rerun align_turns.py');
    // No shards at all.
    rmSync(join(data, 'search-shards'), { recursive: true });
    expect(checkSearchIndexes(data, works, cfgs)).toMatchObject({ status: 'fail', detail: expect.stringContaining('stage9 did not run') });
  });

  it('fails search when a listed shard file is missing', () => {
    rmSync(join(data, 'search-shards', 'english', 'vi.json'));
    const r = checkSearchIndexes(data, ['Crito', 'Republic'], alignConfigs(sources));
    expect(r).toMatchObject({ status: 'fail', detail: expect.stringContaining('english/vi.json') });
  });

  it('fails search when a per-work index changed after stage9 hashed it', () => {
    // Re-emitted (or re-aligned) since the shards were cut: the shards still
    // hold the old postings.
    write(join(data, 'Crito', 'search', 'english-overlay-jowett.json'), { virtue: [[0, 3]] });
    const r = checkSearchIndexes(data, ['Crito', 'Republic'], alignConfigs(sources));
    expect(r).toMatchObject({ status: 'fail', detail: expect.stringContaining('Crito/overlay-jowett') });
    expect(r.detail).toContain('rerun stage9');
  });

  it('fails search when a source carries no hash to check', () => {
    const index = JSON.parse(readFileSync(join(data, 'search-shards', 'index.json'), 'utf8'));
    index.streams.lemma.sources.Crito = null;
    write(join(data, 'search-shards', 'index.json'), index);
    const r = checkSearchIndexes(data, ['Crito', 'Republic'], alignConfigs(sources));
    expect(r).toMatchObject({ status: 'fail', detail: expect.stringContaining('Crito') });
  });

  it('fails search when a source the shards list has no per-work index', () => {
    rmSync(join(data, 'Republic', 'search', 'greek_form.json'));
    const r = checkSearchIndexes(data, ['Crito', 'Republic'], alignConfigs(sources));
    expect(r).toMatchObject({ status: 'fail', detail: expect.stringContaining('Republic/search/greek_form.json') });
  });

  it('fails search when the lemma picker was not built', () => {
    rmSync(join(data, 'lemma-picker'), { recursive: true });
    expect(checkSearchIndexes(data, ['Crito', 'Republic'], alignConfigs(sources)).detail).toContain('lemma-picker/ is empty');
  });

  it('reports the overlay coverage when the aligner ran', () => {
    write(join(data, 'Crito', 'book-01.json'), book(4, { alt: 'half' }));
    const [r] = checkOverlays(data, alignConfigs(sources));
    // Turns 1 and 3 of 4 carry text.
    expect(r).toMatchObject({ status: 'warn', detail: '2/4 turns carry jowett (50.0%)' });
  });

  it('diffs the slug set and treats a removed slug as a failure unless allowed', async () => {
    expect(diffSlugs(new Set(['a', 'b']), new Set(['b', 'c']))).toEqual({ added: ['a'], removed: ['c'] });
    const live = join(root, 'live.json');
    write(live, [{ slug: 'logos' }, { slug: 'psyche' }]);
    const strict = await checkSlugs(data, live, false);
    expect(strict.status).toBe('fail');
    expect(strict.detail).toContain('+1 added (arete)');
    expect(strict.detail).toContain('-1 removed (psyche)');
    const lenient = await checkSlugs(data, live, true);
    expect(lenient.status).toBe('warn');
    write(live, [{ slug: 'logos' }, { slug: 'arete' }]);
    expect((await checkSlugs(data, live, false)).detail).toContain('byte-identical');
  });

  it('snapshots row counts and fails an unexpected change against a baseline', () => {
    const snap = rowSnapshot(data, ['Crito', 'Republic']);
    expect(snap.Republic['book-02.json']).toEqual({ segments: 2, turns: 5, kind: 'para' });
    expect(snap.Crito['book-01.json'].kind).toBe('dialogue');
    const baseline = join(root, 'baseline.json');
    write(baseline, { ...snap, Republic: { ...snap.Republic, 'book-02.json': { segments: 2, turns: 4, kind: 'para' } } });
    expect(checkRows(snap, baseline, [])).toMatchObject({ status: 'fail', detail: expect.stringContaining('not named in --changed: Republic') });
    expect(checkRows(snap, baseline, ['Republic']).status).toBe('ok');
    expect(checkRows(snap, baseline, ['Republic', 'Crito'])).toMatchObject({ status: 'warn', detail: expect.stringContaining('expected to change but did not: Crito') });
  });

  it('fails a slug emitted twice, which a set-difference cannot see', async () => {
    write(join(data, 'lemmata', '_index.json'),
      [{ slug: 'logos', key: 'lo/gos' }, { slug: 'logos', key: 'lo/gos2' }, { slug: 'arete', key: 'a)reth/' }]);
    const live = join(root, 'live.json');
    write(live, [{ slug: 'logos' }, { slug: 'arete' }]);
    // Both builds "contain" logos, so added/removed are empty — only the
    // count catches it.
    expect(diffSlugs(new Set(['logos', 'arete']), new Set(['logos', 'arete'])))
      .toEqual({ added: [], removed: [] });
    const r = await checkSlugs(data, live, false);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('logos ×2');
  });

  it('fails a swapped slug pair, which leaves the slug set identical', async () => {
    write(join(data, 'lemmata', '_index.json'), [
      { slug: 'apeimi', key: 'a)/peimi2' }, { slug: 'apeimi-2', key: 'a)/peimi1' },
    ]);
    write(join(data, 'lemmata', 'apeimi.json'), { head: 'ἄπειμι' });
    const live = join(root, 'live.json');
    write(live, [{ slug: 'apeimi', key: 'a)/peimi1' }, { slug: 'apeimi-2', key: 'a)/peimi2' }]);
    const r = await checkSlugs(data, live, true);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('2 slugs now name a different lemma');
    expect(r.detail).toContain('apeimi: a)/peimi1 -> a)/peimi2 (ἄπειμι)');
    expect(r.detail).toContain('apeimi-2: a)/peimi2 -> a)/peimi1');
    // The same keys on the same slugs pass, and a live index without keys is skipped.
    write(live, [{ slug: 'apeimi', key: 'a)/peimi2' }, { slug: 'apeimi-2', key: 'a)/peimi1' }]);
    expect((await checkSlugs(data, live, false)).detail).toContain('byte-identical');
    write(live, [{ slug: 'apeimi' }, { slug: 'apeimi-2' }]);
    expect((await checkSlugs(data, live, false)).status).toBe('ok');
  });

  it('movedSlugs lists only slugs whose key changed', () => {
    const moved = movedSlugs(
      [{ slug: 'a', key: 'x' }, { slug: 'b', key: 'y' }, { slug: 'c', key: 'z' }],
      [{ slug: 'a', key: 'x' }, { slug: 'b', key: 'w' }, { slug: 'd', key: 'z' }],
    );
    expect(moved).toEqual([{ slug: 'b', from: 'w', to: 'y', head: null }]);
  });

  it('reports a malformed built index as a failure rather than throwing', async () => {
    write(join(data, 'lemmata', '_index.json'), 'not json');
    const r = await checkSlugs(data, undefined, false);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('could not read');
  });

  it('tells a new work apart from an edited one', () => {
    const snap = rowSnapshot(data, ['Crito', 'Republic']);
    const baseline = join(root, 'baseline.json');
    const { Republic, ...withoutRepublic } = snap;
    write(baseline, withoutRepublic);
    const r = checkRows(snap, baseline, []);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('new since the baseline: Republic');
  });

  it('parses its arguments', () => {
    const opts = parseArgs(['--data', data, '--changed', 'Republic, Crito', '--allow-removed-slugs']);
    expect(opts).toMatchObject({ data, changed: ['Republic', 'Crito'], allowRemovedSlugs: true });
    expect(() => parseArgs(['--bogus'])).toThrow('unknown argument');
    expect(() => parseArgs(['--data'])).toThrow('needs a value');
  });
});
