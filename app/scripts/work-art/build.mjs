// Draws the illustration for every work's landing page and writes it to
// public/art/<work id>.svg. One scene module per work lives in scenes/<id>.mjs
// and exports a default function (ctx) → SVG body (files named _*.mjs are
// shared helpers, not scenes); the shared kit is lib.mjs
// (canvas, palette, textures), figures.mjs (people) and props.mjs (scenery).
// The SVGs are generated, deterministic output — edit the scene and rerun,
// never the SVG files by hand.
//
// Run: node scripts/work-art/build.mjs [ids…]   (from app/)

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { context, plate } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'public', 'art');

export const sceneIds = () => readdirSync(join(HERE, 'scenes'))
  .filter((n) => n.endsWith('.mjs') && !n.startsWith('_')).map((n) => n.slice(0, -4)).sort();

export async function render(id, bust = '') {
  const mod = await import(`${pathToFileURL(join(HERE, 'scenes', `${id}.mjs`)).href}${bust}`);
  const ctx = context(`wa-${id}`);
  const body = mod.default(ctx);
  return `${plate(ctx, body, mod.options ?? {})}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : sceneIds();
  mkdirSync(OUT, { recursive: true });
  for (const id of ids) writeFileSync(join(OUT, `${id}.svg`), await render(id));
  console.log(`wrote ${ids.length} plate(s) to ${OUT}`);
}
