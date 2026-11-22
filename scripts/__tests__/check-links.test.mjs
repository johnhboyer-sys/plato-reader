// node --test "scripts/__tests__/check-links.test.mjs"
// The link check at a base path (SITE_BASE). Codex's review of phase 2: under
// /mirror/, a root-relative link that leaves out the base points outside the
// site and must count as broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../check-links.mjs', import.meta.url));

function check(links, base) {
  const dist = mkdtempSync(path.join(tmpdir(), 'check-links-'));
  try {
    mkdirSync(path.join(dist, 'a'));
    writeFileSync(path.join(dist, 'a', 'index.html'), '<!doctype html><p id="x">a</p>');
    writeFileSync(path.join(dist, 'index.html'), `<!doctype html>${links.map((h) => `<a href="${h}">l</a>`).join('')}`);
    const r = spawnSync(process.execPath, [SCRIPT, dist], { encoding: 'utf8', env: { ...process.env, SITE_BASE: base } });
    const m = r.stdout.match(/links checked: (\d+);.*broken: (\d+)/);
    return { status: r.status, links: m && Number(m[1]), broken: m && Number(m[2]), out: r.stdout + r.stderr };
  } finally { rmSync(dist, { recursive: true, force: true }); }
}

test('under a base, a root-relative link without the base is broken; with it, it resolves', () => {
  const bad = check(['/mirror/a/', '/a/'], '/mirror/');
  assert.equal(bad.links, 2, bad.out);
  assert.equal(bad.broken, 1, bad.out);
  assert.notEqual(bad.status, 0);
  const good = check(['/mirror/a/', '/mirror/', '/mirror', 'a/', '/mirror/a/#x'], '/mirror/');
  assert.equal(good.broken, 0, good.out);
  assert.equal(good.status, 0, good.out);
});

test('at the root, a root-relative link resolves as before', () => {
  const r = check(['/a/', '/', 'a/'], '');
  assert.equal(r.broken, 0, r.out);
  assert.equal(r.status, 0, r.out);
  assert.equal(check(['/b/'], '').broken, 1);
});
