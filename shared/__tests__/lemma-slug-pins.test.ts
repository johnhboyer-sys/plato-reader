import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Runs app/scripts/build-lemmata.mjs on a miniature corpus in which two lemmata
// (πεδίον / πέδιον, as `pe/dion` and `pedi/on`) slugify alike, then flips which
// is commoner. Unpinned, the slugs swap; pinned, they hold.
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../app/scripts/build-lemmata.mjs');
let app: string;

const put = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
};

// n1 tokens of lemma pe/dion, n2 of pedi/on.
function corpus(n1: number, n2: number) {
  const analyses: Record<string, unknown[]> = {
    a: [{ lemma: 'pe/dion', lsj: ['pe/dion'], parse: 'noun', gloss: 'plain' }],
    b: [{ lemma: 'pedi/on', lsj: ['pedi/on'], parse: 'noun', gloss: 'plain' }],
  };
  const tokens = [
    ...Array.from({ length: n1 }, () => ({ k: 'a', t: 'α' })),
    ...Array.from({ length: n2 }, () => ({ k: 'b', t: 'β' })),
  ];
  put(join(app, 'public/data/W/analyses.json'), analyses);
  put(join(app, 'public/data/W/book-01.json'), {
    book: 1, segments: [{ column: '1a', greek: [{ n: 1, tokens }] }],
  });
}

const build = () => execFileSync(process.execPath, ['--experimental-strip-types', SCRIPT], { cwd: app, stdio: 'pipe' });
const slugs = (): Record<string, string> =>
  Object.fromEntries(JSON.parse(readFileSync(join(app, 'public/data/lemmata/_index.json'), 'utf8'))
    .map((e: { slug: string; key: string }) => [e.key, e.slug]));

beforeEach(() => { app = mkdtempSync(join(tmpdir(), 'lemma-pins-')); });
afterEach(() => rmSync(app, { recursive: true, force: true }));

describe('build-lemmata slug pinning', () => {
  it('without a pin file, a count change swaps two colliding slugs (the defect)', () => {
    corpus(5, 4);
    build();
    expect(slugs()).toMatchObject({ 'pe/dion': 'pedion', 'pedi/on': 'pedion-2' });
    rmSync(join(app, 'lemma-slugs.json'));
    corpus(4, 5);
    build();
    expect(slugs()).toMatchObject({ 'pe/dion': 'pedion-2', 'pedi/on': 'pedion' });
  });

  it('keeps the pinned slug when the counts cross', () => {
    corpus(5, 4);
    build();
    corpus(4, 5);
    build();
    expect(slugs()).toMatchObject({ 'pe/dion': 'pedion', 'pedi/on': 'pedion-2' });
  });

  it('reserves the slug of a lemma that falls below the page threshold', () => {
    corpus(5, 4);
    build();
    corpus(2, 4);   // pe/dion loses its page
    build();
    expect(slugs()).toEqual({ 'pedi/on': 'pedion-2' });
    expect(JSON.parse(readFileSync(join(app, 'lemma-slugs.json'), 'utf8'))['pe/dion']).toBe('pedion');
    corpus(5, 4);   // and gets the same URL back
    build();
    expect(slugs()['pe/dion']).toBe('pedion');
  });

  it('gives a new lemma the next free suffix and leaves an unchanged pin file alone', () => {
    put(join(app, 'lemma-slugs.json'), '{\n"pe/dion":"pedion"\n}\n');
    corpus(5, 4);
    build();
    expect(slugs()).toMatchObject({ 'pe/dion': 'pedion', 'pedi/on': 'pedion-2' });
    const before = readFileSync(join(app, 'lemma-slugs.json'), 'utf8');
    build();
    expect(readFileSync(join(app, 'lemma-slugs.json'), 'utf8')).toBe(before);
    expect(existsSync(join(app, 'public/data/lemmata/pedion-2.json'))).toBe(true);
  });

  it('refuses a pin file where two keys share a slug', () => {
    put(join(app, 'lemma-slugs.json'), '{\n"a":"x",\n"b":"x"\n}\n');
    corpus(5, 4);
    expect(build).toThrow();
  });
});
