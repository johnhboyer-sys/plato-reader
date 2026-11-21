import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { HOST_FILES, jsonCheck, lemmaCheck, makeBundle, rebuildReport } from '../make-bundle.mjs';
import { verifyTarget } from '../verify-snapshot.mjs';

const SCRIPT = fileURLToPath(new URL('../make-bundle.mjs', import.meta.url));

// The JSON check alone: verify-rebuild needs a whole corpus.
const jsonOnly = (served) => [['JSON', jsonCheck(served)]];

// A same-origin build in small: pages, a worker with no data root, data, and
// the primary host's own files.
function site(change = () => {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'make-bundle-'));
  const dist = path.join(root, 'dist');
  const put = (rel, text) => {
    mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
    writeFileSync(path.join(dist, rel), text);
  };
  put('index.html', '<h1>Plato</h1>');
  put('Euthyphro/index.html', '<p>Euthyphro</p>');
  put('sw.js', "// worker\nconst DATA_ROOT = '';\n");
  put('data/Cat/manifest.json', '{"author":"Plato"}');
  put('data/Cat/chapters/1.json', '{"greek":"Ὁμώνυμα λέγεται"}');
  for (const name of HOST_FILES) put(name, 'primary host only\n');
  change({ dist, put });
  return { root, dist, out: path.join(root, 'bundle.tar.gz') };
}

const run = (s, gates = jsonOnly) => {
  try { return makeBundle({ dist: s.dist, out: s.out, gates }); } finally { /* the caller removes s.root */ }
};
// The files an archive holds; tar lists folders too, each ending in "/".
const names = (archive) => spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' }).stdout.trim().split('\n')
  .filter((n) => !n.endsWith('/')).map((n) => n.replace(/^\.\//, '')).sort();

function refuses(change, pattern, gates) {
  const s = site(change);
  try {
    const r = run(s, gates);
    assert.equal(r.ok, false, 'the bundle should have been refused');
    assert.match(r.problems.join('\n'), pattern);
    assert.equal(existsSync(s.out), false, 'a refused bundle leaves no archive behind');
  } finally { rmSync(s.root, { recursive: true, force: true }); }
}

test('packs every built file but the host files, with sums that verify', () => {
  const s = site();
  try {
    const r = run(s);
    assert.deepEqual(r.problems, []);
    assert.equal(r.ok, true);
    assert.deepEqual(names(s.out), ['Euthyphro/index.html', 'SHA256SUMS', 'data/Cat/chapters/1.json', 'data/Cat/manifest.json', 'index.html', 'sw.js']);
    assert.equal(r.files, 5);
    assert.deepEqual(r.left, HOST_FILES);
    const v = verifyTarget(s.out);
    assert.equal(v.ok, true);
    assert.equal(v.read, 5);
    // The folder that was packed is as it was.
    for (const name of HOST_FILES) assert.equal(existsSync(path.join(s.dist, name)), true);
    assert.equal(existsSync(path.join(s.dist, 'SHA256SUMS')), false);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('the archive carries no Mac side files, and a host file’s name deeper down stays', () => {
  const s = site(({ put }) => { put('data/Cat/CNAME', 'not the host file'); put('data/Cat/-C', '{}'); });
  try {
    assert.equal(run(s).ok, true);
    const got = names(s.out);
    assert.equal(got.some((n) => path.posix.basename(n).startsWith('._')), false);
    assert.equal(got.includes('data/Cat/CNAME'), true);
    assert.equal(got.includes('CNAME'), false);
    assert.equal(got.includes('data/Cat/-C'), true);
    assert.equal(got.length, 8);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('refuses a build made for data on another host', () => {
  refuses(({ put }) => put('sw.js', 'const DATA_ROOT = "https://data.example.org";\n'), /built for data at https:\/\/data\.example\.org/);
  refuses(({ put }) => put('.assetsignore', 'data\n'), /\.assetsignore/);
  refuses(({ put }) => put('_redirects', '/data/* https://data.example.org/:splat 302\n'), /_redirects/);
});

test('refuses a build with no worker line, no data, or no home page', () => {
  refuses(({ put }) => put('sw.js', '// no root here\n'), /sw\.js has no DATA_ROOT line/);
  refuses(({ dist }) => rmSync(path.join(dist, 'sw.js')), /no sw\.js/);
  refuses(({ dist }) => rmSync(path.join(dist, 'data'), { recursive: true }), /no data files/);
  refuses(({ dist }) => rmSync(path.join(dist, 'index.html')), /no index\.html/);
});

test('refuses when the host-file list names a file the build does not hold', () => {
  refuses(({ dist }) => rmSync(path.join(dist, HOST_FILES[0])), new RegExp(`names ${HOST_FILES[0]}, which this build does not hold`));
});

test('refuses a link, a Finder file, and a file named like the sums', () => {
  refuses(({ dist }) => symlinkSync(path.join(dist, 'index.html'), path.join(dist, 'home.html')), /home\.html is not a plain file or folder/);
  refuses(({ put }) => put('Cat/.DS_Store', 'x'), /Cat\/\.DS_Store/);
  refuses(({ put }) => put('SHA256SUMS', 'x'), /already holds SHA256SUMS/);
});

test('refuses a data file cut short, and data with no JSON to read', () => {
  refuses(({ put }) => put('data/Cat/translation.json', '{"by":"Fow'), /JSON: data\/Cat\/translation\.json is not JSON/);
  refuses(({ dist, put }) => { rmSync(path.join(dist, 'data'), { recursive: true }); put('data/Cat/readme.txt', 'x'); }, /JSON: no JSON data file to read/);
});

test('runs the gates on data files only, and on every one', () => {
  const seen = [], text = [];
  const s = site(({ put }) => { put('notes.json', '{"by":"Fow'); put('data/Cat/readme.txt', 'plain'); });
  try {
    const r = run(s, (served) => {
      for (const f of served(() => true)) seen.push(f.path);
      for (const f of served((n) => n.endsWith('.txt'))) text.push(f.path);
      return [['count', { ok: true, problems: [] }]];
    });
    assert.equal(r.ok, true);
    assert.deepEqual(seen.sort(), ['data/Cat/chapters/1.json', 'data/Cat/manifest.json', 'data/Cat/readme.txt']);
    assert.deepEqual(text, ['data/Cat/readme.txt']);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('refuses to write over a file, and a gate list that is empty', () => {
  const s = site();
  try {
    writeFileSync(s.out, 'mine');
    const r = run(s);
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /already exists/);
    assert.equal(readFileSync(s.out, 'utf8'), 'mine');
  } finally { rmSync(s.root, { recursive: true, force: true }); }
  refuses(() => {}, /no gate ran/, () => []);
});

test('refuses bytes that change after a gate has read them', () => {
  // The gate passes what it read; the file is then cut short.
  const rewrite = (dist) => (served) => {
    const report = jsonCheck(served);
    writeFileSync(path.join(dist, 'data/Cat/manifest.json'), '{"author":"Pla');
    return [['JSON', report]];
  };
  let s = site();
  try {
    const r = run(s, rewrite(s.dist));
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /data\/Cat\/manifest\.json changed while the bundle was being made/);
    assert.equal(existsSync(s.out), false);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
  // The same between two gates: the second must not be handed other bytes in silence.
  s = site();
  try {
    const r = run(s, (served) => [...rewrite(s.dist)(served), ['again', { ok: [...served(() => true)].length > 0, problems: [] }]]);
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /data\/Cat\/manifest\.json changed while the bundle was being made/);
    assert.equal(existsSync(s.out), false);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
  // And the worker, read for its data root before the gates run.
  s = site();
  try {
    const r = run(s, (served) => {
      writeFileSync(path.join(s.dist, 'sw.js'), 'const DATA_ROOT = "https://data.example.org";\n');
      return jsonOnly(served);
    });
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /sw\.js changed while the bundle was being made/);
    assert.equal(existsSync(s.out), false);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('refuses a name the two tars read differently', () => {
  const odd = / is not packed alike by every tar/;
  refuses(({ put }) => put('data/Cat/a\\t.json', '{}'), /"data\/Cat\/a\\\\t\.json": a name with a backslash/);
  for (const name of ['data/Cat/a.json ', 'data/Cat/ a.json', 'data/Cat /a.json', 'data/Cat/a\tb.json', 'lemma/λόγος/index.html', 'data/Cat/a\x7f.json']) {
    refuses(({ put }) => put(name, '{}'), odd);
  }
});

test('a name with a space or a leading dash is packed as it is', () => {
  const s = site(({ put }) => { put('data/Cat/two words.json', '{}'); put('-T/--help', 'x'); });
  try {
    assert.equal(run(s).ok, true);
    const got = names(s.out);
    assert.equal(got.includes('data/Cat/two words.json'), true);
    assert.equal(got.includes('-T/--help'), true);
    assert.equal(verifyTarget(s.out).read, 7);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('does not write over a file that appears while it works', () => {
  const s = site();
  try {
    const r = run(s, (served) => { writeFileSync(s.out, 'mine'); return jsonOnly(served); });
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /already exists/);
    assert.equal(readFileSync(s.out, 'utf8'), 'mine');
    assert.deepEqual(readdirSync(s.root).sort(), ['bundle.tar.gz', 'dist']);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('refuses a folder that is not there', () => {
  refuses(({ dist }) => rmSync(dist, { recursive: true }), /is not a folder/);
});

test('refuses an archive that does not read back against its sums', () => {
  // A tar that skips the step that adds the sums, one that drops a file, one
  // that adds a file, a file rewritten just before it is packed, and a gzip
  // that fails.
  const real = spawnSync('which', ['tar'], { encoding: 'utf8' }).stdout.trim();
  const sums = /does not match its SHA256SUMS/;
  const shims = [
    ['no sums', 'tar', `#!/bin/sh\ncase "$1" in -rf) exit 0;; esac\nexec ${real} "$@"\n`, sums],
    ['a file short', 'tar', `#!/bin/sh\nif [ "$1" = -cf ]; then sed -i.bak -e '/index.html/d' "$6"; fi\nexec ${real} "$@"\n`, sums],
    ['a file too many', 'tar', `#!/bin/sh\nif [ "$1" = -rf ]; then echo x > "$4/extra.txt"; exec ${real} "$@" ./extra.txt; fi\nexec ${real} "$@"\n`, /1 unlisted/],
    ['a file changed after its last read', 'tar', `#!/bin/sh\nif [ "$1" = -cf ]; then echo more >> "$4/index.html"; fi\nexec ${real} "$@"\n`, /1 changed/],
    // A file rewritten before packing, and its line in the sums rewritten to match.
    ['a file and its sum changed together', 'tar', `#!/usr/bin/env node
const { spawnSync } = require('node:child_process'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const a = process.argv.slice(2), note = path.join(__dirname, 'dist-path');
if (a[0] === '-cf') { fs.appendFileSync(path.join(a[3], 'index.html'), 'more'); fs.writeFileSync(note, a[3]); }
if (a[0] === '-rf') {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(fs.readFileSync(note, 'utf8'), 'index.html'))).digest('hex');
  const sums = path.join(a[3], 'SHA256SUMS');
  fs.writeFileSync(sums, fs.readFileSync(sums, 'utf8').replace(/^[0-9a-f]{64}(  index\\.html)$/m, sha + '$1'));
}
process.exit(spawnSync('${real}', a, { stdio: 'inherit' }).status);
`, /the sums in the archive are not the sums this run took/],
    ['gzip fails', 'gzip', '#!/bin/sh\necho no room >&2\nexit 3\n', /gzip -n failed: no room/],
  ];
  for (const [what, command, shim, wrong] of shims) {
    const s = site();
    const bin = path.join(s.root, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, command), shim, { mode: 0o755 });
    const before = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${before}`;
    try {
      const r = run(s);
      assert.equal(r.ok, false, what);
      assert.match(r.problems.join('\n'), wrong, what);
      assert.equal(existsSync(s.out), false, what);
      assert.deepEqual(readdirSync(s.root).sort(), ['bin', 'dist'], `${what}: nothing is left beside the output`);
      assert.equal(readFileSync(path.join(s.dist, 'sw.js'), 'utf8').includes('DATA_ROOT'), true, `${what}: the build is still there`);
    } finally {
      process.env.PATH = before;
      rmSync(s.root, { recursive: true, force: true });
    }
  }
});

test('tar and gzip do not take options from the caller’s environment', () => {
  // GNU tar obeys TAR_OPTIONS (--remove-files would delete the build), gzip obeys GZIP.
  const real = { tar: spawnSync('which', ['tar'], { encoding: 'utf8' }).stdout.trim(), gzip: spawnSync('which', ['gzip'], { encoding: 'utf8' }).stdout.trim() };
  const s = site();
  const bin = path.join(s.root, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'tar'), `#!/bin/sh\ncase "$1" in -cf|-rf|-xzOf|-xzf) if [ -n "$TAR_OPTIONS" ]; then echo TAR_OPTIONS reached tar >&2; exit 9; fi;; esac\nexec ${real.tar} "$@"\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'gzip'), `#!/bin/sh\nif [ -n "$GZIP" ]; then echo GZIP reached gzip >&2; exit 9; fi\nexec ${real.gzip} "$@"\n`, { mode: 0o755 });
  const before = { PATH: process.env.PATH, TAR_OPTIONS: process.env.TAR_OPTIONS, GZIP: process.env.GZIP };
  process.env.PATH = `${bin}${path.delimiter}${before.PATH}`;
  process.env.TAR_OPTIONS = '--verbose';
  process.env.GZIP = '-1';
  try {
    const r = run(s);
    assert.deepEqual(r.problems, []);
    assert.equal(r.ok, true);
  } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('the command line: exit codes and the count it prints', () => {
  const s = site();
  try {
    const bad = spawnSync(process.execPath, [SCRIPT, `--dist=${s.dist}`], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    const odd = spawnSync(process.execPath, [SCRIPT, `--dist=${s.dist}`, `--out=${s.out}`, '--force'], { encoding: 'utf8' });
    assert.equal(odd.status, 2);
    // The real gates need a real corpus, so this small site must be refused by them.
    const real = spawnSync(process.execPath, [SCRIPT, `--dist=${s.dist}`, `--out=${s.out}`], { encoding: 'utf8' });
    assert.equal(real.status, 1);
    assert.match(real.stdout, /^FAIL /m);
    assert.equal(existsSync(s.out), false);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('the real gates: verify-rebuild runs on the folder’s data and its failures are named', async () => {
  const { dataGates } = await import('../make-bundle.mjs');
  const s = site();
  try {
    const served = function* (filter) { if (filter('manifest.json')) yield { path: 'data/Cat/manifest.json', text: '{}' }; };
    const reports = dataGates(served, { dataDir: path.join(s.dist, 'data') });
    assert.deepEqual(reports.map(([name]) => name), ['verify-rebuild', 'lemma pages', 'JSON']);
    const [, rebuild] = reports[0];
    assert.equal(rebuild.ok, false);
    assert.match(rebuild.problems.join('\n'), /^FAIL/m);        // a folder with one work of 36
    assert.equal(reports[1][1].ok, false);                      // this small site has no lemma index
    assert.equal(reports[2][1].ok, true);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

// Codex's review of phase 2.
test('bytes a gate reads from disk are held to the bytes packed: a file changed before the JSON check is refused', () => {
  // A gate like verify-rebuild reads the folder itself; then the file changes
  // to other valid JSON before anything reads it through served().
  const s = site();
  try {
    const r = run(s, (served) => {
      writeFileSync(path.join(s.dist, 'data/Cat/manifest.json'), '{"author":"someone else"}');
      return [['JSON', jsonCheck(served)]];
    });
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /data\/Cat\/manifest\.json changed while the bundle was being made/);
    assert.equal(existsSync(s.out), false);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('verify-rebuild: a warning fails the bundle gate, and a run with nothing to say does too', () => {
  assert.deepEqual(rebuildReport({ status: 0, stdout: 'ok    works  36 works emitted\nok    lemma slugs  5345 slugs built\n' }), { ok: true, problems: [] });
  const warned = rebuildReport({ status: 0, stdout: 'ok    works  36\nWARN  lemma slugs  no lemmata/_index.json\n' });
  assert.equal(warned.ok, false);
  assert.match(warned.problems.join('\n'), /^WARN  lemma slugs/m);
  assert.match(rebuildReport({ status: 1, stdout: 'FAIL  works  2 works missing\n' }).problems.join('\n'), /^FAIL  works/m);
  assert.match(rebuildReport({ status: 1, stdout: '', stderr: 'data dir x does not exist' }).problems.join('\n'), /exit 1: data dir x does not exist/);
  assert.equal(rebuildReport({ status: 0, stdout: '' }).ok, false);
  assert.equal(rebuildReport({ status: null, stdout: '', error: new Error('spawn failed') }).ok, false);
});

test('the lemma pages: an index that lists slugs, each with its file', () => {
  const files = ['data/lemmata/_index.json', 'data/lemmata/logos.json', 'data/lemmata/arete.json'];
  const served = (index) => function* (filter) { if (filter('_index.json') && index !== undefined) yield { path: 'data/lemmata/_index.json', text: index }; };
  const good = JSON.stringify([{ slug: 'logos', key: 'lo/gos' }, { slug: 'arete', key: 'a)reth/' }]);
  assert.deepEqual(lemmaCheck(served(good), files), { ok: true, problems: [], read: 2 });
  assert.match(lemmaCheck(served(undefined), files).problems.join('\n'), /no data\/lemmata\/_index\.json/);
  assert.match(lemmaCheck(served('[]'), files).problems.join('\n'), /lists no slug/);
  assert.match(lemmaCheck(served('{"a":1}'), files).problems.join('\n'), /not a list/);
  assert.match(lemmaCheck(served(JSON.stringify([{ slug: 'logos' }, { slug: 'nous' }])), files).problems.join('\n'), /1 slug has no file, first: nous/);
});

test('the real gates are handed the folder by its full path, wherever the script runs from', async () => {
  const { dataGates } = await import('../make-bundle.mjs');
  const s = site();
  const here = process.cwd();
  try {
    process.chdir(s.root);                 // dist is ./dist from here, and not from the repo's root
    const reports = dataGates(function* () {}, { dataDir: 'dist/data', files: [] });
    const rebuild = reports.find(([name]) => name === 'verify-rebuild')[1];
    assert.equal(rebuild.ok, false);       // one work of 36
    assert.doesNotMatch(rebuild.problems.join('\n'), /does not exist/);
  } finally { process.chdir(here); rmSync(s.root, { recursive: true, force: true }); }
});
