// Scenery and things: architecture, landscape, plants, furniture, pottery.
// Like the figures, each prop draws in its own frame with its base on y = 0
// unless noted, and is placed with lib.at().
import { P, g, at, rect, circle, ellipse, path, stroke, line, poly, pol, smooth, blob, rng, f, lerp, arcD } from './lib.mjs';
import { darken, lighten } from './figures.mjs';

// ── Architecture ─────────────────────────────────────────────────────────────
// Doric column, base at y = 0, `h` tall, `w` wide at the foot.
export function column(h = 300, w = 34, color = P.bone, { flutes = true, shadow = null } = {}) {
  const sh = shadow ?? darken(color, 0.84);
  const top = w * 0.82;
  const out = [
    path(`M${-w / 2} 0L${-top / 2} ${-h + 22}H${top / 2}L${w / 2} 0Z`, color),
    path(`M${w / 6} 0L${top / 6} ${-h + 22}H${top / 2}L${w / 2} 0Z`, sh),
    path(`M${-top / 2 - 4} ${-h + 22}H${top / 2 + 4}L${top / 2 + 12} ${-h + 8}H${-top / 2 - 12}Z`, color), // echinus
    rect(-top / 2 - 14, -h, top + 28, 9, color), // abacus
    rect(-top / 2 - 14, -h + 6, top + 28, 3, sh),
  ];
  if (flutes) {
    for (let i = -2; i <= 2; i++) {
      out.push(line((i * w) / 6.5, -4, (i * top) / 6.5, -h + 26, sh, 1.6, { opacity: 0.7 }));
    }
  }
  return g(out);
}

// Entablature + pediment over a run of columns: a temple front.
export function templeFront(width = 420, colH = 220, color = P.bone, { cols = 6, roof = P.clay, frieze = P.teal, pedimentFill = null } = {}) {
  const sh = darken(color, 0.84);
  const out = [];
  out.push(rect(-width / 2 - 20, -14, width + 40, 14, color), rect(-width / 2 - 34, 0, width + 68, 14, sh));
  for (let i = 0; i < cols; i++) {
    const x = -width / 2 + 24 + (i * (width - 48)) / (cols - 1);
    out.push(at(x, -14, [column(colH, 30, color)]));
  }
  const yTop = -14 - colH;
  out.push(rect(-width / 2 - 12, yTop - 26, width + 24, 26, color)); // architrave
  out.push(rect(-width / 2 - 12, yTop - 50, width + 24, 24, frieze)); // frieze
  for (let x = -width / 2; x <= width / 2; x += 34) out.push(rect(x - 4, yTop - 50, 8, 24, darken(frieze, 0.7))); // triglyphs
  out.push(rect(-width / 2 - 20, yTop - 58, width + 40, 8, color));
  out.push(poly([[-width / 2 - 26, yTop - 58], [0, yTop - 58 - width * 0.2], [width / 2 + 26, yTop - 58]], color));
  out.push(poly([[-width / 2 + 2, yTop - 64], [0, yTop - 54 - width * 0.17], [width / 2 - 2, yTop - 64]], pedimentFill ?? sh));
  out.push(stroke(`M${-width / 2 - 30} ${yTop - 58}L0 ${yTop - 62 - width * 0.2}L${width / 2 + 30} ${yTop - 58}`, roof, 7));
  out.push(circle(0, yTop - 64 - width * 0.2, 7, roof), circle(-width / 2 - 28, yTop - 62, 6, roof), circle(width / 2 + 28, yTop - 62, 6, roof));
  return g(out);
}

// A long stoa: colonnade with a tiled lean-to roof.
export function stoa(width = 900, colH = 200, color = P.bone, { step = 64, roof = P.clay, back = P.stone } = {}) {
  const out = [rect(-width / 2, -colH - 30, width, colH + 30, back)];
  out.push(rect(-width / 2 - 14, -14, width + 28, 14, darken(color, 0.86)));
  for (let x = -width / 2 + step / 2; x < width / 2; x += step) out.push(at(x, -14, [column(colH, 26, color)]));
  out.push(rect(-width / 2 - 10, -colH - 40, width + 20, 26, color));
  out.push(path(`M${-width / 2 - 24} ${-colH - 40}L${-width / 2 + 10} ${-colH - 78}H${width / 2 - 10}L${width / 2 + 24} ${-colH - 40}Z`, roof));
  for (let x = -width / 2; x < width / 2; x += 18) out.push(line(x, -colH - 42, x + 8, -colH - 76, darken(roof, 0.8), 2, { opacity: 0.6 }));
  return g(out);
}

// Ashlar wall filling a rectangle, with staggered joints.
export function wall(x, y, w, h, color = P.stone, { course = 44, seed = 1, joint = null } = {}) {
  const R = rng(seed);
  const j = joint ?? darken(color, 0.8);
  const out = [rect(x, y, w, h, color)];
  for (let yy = y, row = 0; yy < y + h; yy += course, row++) {
    out.push(line(x, yy, x + w, yy, j, 2, { opacity: 0.6 }));
    for (let xx = x + (row % 2) * 40 + R() * 30; xx < x + w; xx += 90 + R() * 80) {
      out.push(line(xx, yy, xx, Math.min(yy + course, y + h), j, 2, { opacity: 0.6 }));
    }
  }
  return g(out);
}

// The Acropolis on its rock, Parthenon on top — a backdrop for Athenian scenes.
export function acropolis(color = P.stone, rock = P.taupe) {
  const sh = darken(color, 0.82);
  const out = [
    path('M-260 0C-240 -40 -220 -70 -180 -80L-120 -92C-60 -100 40 -104 120 -96L190 -84C224 -74 246 -40 260 0Z', rock),
    path('M-120 -92C-60 -100 40 -104 120 -96L130 -86C40 -92 -60 -90 -126 -84Z', darken(rock, 0.85)),
  ];
  // Parthenon
  out.push(rect(-60, -150, 150, 52, color));
  for (let x = -54; x <= 84; x += 12) out.push(rect(x, -150, 5, 52, sh));
  out.push(rect(-66, -160, 162, 10, color), poly([[-68, -160], [15, -180], [98, -160]], color));
  // Propylaea and Erechtheion, smaller blocks
  out.push(rect(-150, -122, 60, 30, color), poly([[-154, -122], [-120, -134], [-86, -122]], color));
  for (let x = -146; x <= -96; x += 10) out.push(rect(x, -122, 4, 30, sh));
  out.push(rect(110, -126, 50, 30, color));
  return g(out);
}

// Meander (Greek key) band, `w` long, `h` tall, starting at x, y.
export function meander(x, y, w, h, color, bg = null) {
  const u = h / 5;
  const out = bg ? [rect(x, y, w, h, bg)] : [];
  let d = '';
  for (let xx = x; xx + 5 * u <= x + w; xx += 5 * u) {
    d += `M${f(xx)} ${f(y + 4.5 * u)}V${f(y + 0.5 * u)}H${f(xx + 4 * u)}V${f(y + 3.5 * u)}H${f(xx + 1.5 * u)}V${f(y + 2 * u)}H${f(xx + 2.5 * u)}`;
    d += `M${f(xx)} ${f(y + 4.5 * u)}H${f(xx + 5 * u)}`;
  }
  out.push(stroke(d, color, u * 0.8, { 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' }));
  return g(out);
}

// Row of wave scrolls ("running dog") — a sea border.
export function waveBand(x, y, w, h, color) {
  const u = h;
  let d = `M${f(x)} ${f(y + u)}`;
  for (let xx = x; xx < x + w; xx += u * 1.4) {
    d += `C${f(xx + u * 0.5)} ${f(y + u)} ${f(xx + u * 0.5)} ${f(y)} ${f(xx + u * 0.95)} ${f(y + u * 0.1)}`
      + `C${f(xx + u * 1.25)} ${f(y + u * 0.2)} ${f(xx + u * 1.15)} ${f(y + u * 0.62)} ${f(xx + u * 0.9)} ${f(y + u * 0.55)}`
      + `M${f(xx + u * 0.95)} ${f(y + u)}L${f(xx + u * 1.4)} ${f(y + u)}`;
  }
  return stroke(d, color, Math.max(2, u * 0.14));
}

// ── Landscape ────────────────────────────────────────────────────────────────
// A ridge of hills across [x0, x1], tops through `pts`, filled down to `base`.
export const hills = (pts, base, fill, a = {}) =>
  path(`${smooth(pts)}L${f(pts.at(-1)[0])} ${base}L${f(pts[0][0])} ${base}Z`, fill, a);

// Mid-century sun: disc with an inner ring and optional rays.
export function sun(r = 60, color = P.ochre, { rays = 0, ring = null, rayColor = null } = {}) {
  const out = [];
  for (let i = 0; i < rays; i++) {
    const a = (360 / rays) * i;
    const [x0, y0] = pol(0, 0, r * 1.18, a);
    const [x1, y1] = pol(0, 0, r * (i % 2 ? 1.5 : 1.75), a);
    out.push(line(x0, y0, x1, y1, rayColor ?? color, r * 0.07));
  }
  out.push(circle(0, 0, r, color));
  if (ring) out.push(circle(0, 0, r * 0.72, 'none', { stroke: ring, 'stroke-width': r * 0.06, opacity: 0.6 }));
  return g(out);
}

// Stylised cloud: lumps on a flat base, `w` wide.
export function cloud(w = 160, color = P.bone, shade = null) {
  const h = w * 0.32;
  const out = [path(`M${-w / 2} 0C${-w / 2} ${-h * 0.6} ${-w * 0.3} ${-h * 0.8} ${-w * 0.18} ${-h * 0.62}C${-w * 0.12} ${-h * 1.3} ${w * 0.16} ${-h * 1.35} ${w * 0.2} ${-h * 0.7}C${w * 0.34} ${-h * 0.95} ${w / 2} ${-h * 0.6} ${w / 2} 0Z`, color)];
  if (shade) out.push(path(`M${-w / 2} 0H${w / 2}C${w * 0.4} ${-h * 0.18} ${-w * 0.4} ${-h * 0.18} ${-w / 2} 0Z`, shade));
  return g(out);
}

export const bird = (s = 1, color = P.ink) =>
  stroke(`M${-14 * s} ${-2 * s}Q${-7 * s} ${-9 * s} 0 0Q${7 * s} ${-9 * s} ${14 * s} ${-2 * s}`, color, 3 * s);

// Sea from y down to `bottom`, with rows of wave marks.
export function sea(y, bottom, color = P.teal, { mark = null, seed = 3, rows = 5, width = 1200 } = {}) {
  const R = rng(seed);
  const m = mark ?? lighten(color, 0.35);
  const out = [rect(0, y, width, bottom - y, color)];
  for (let i = 0; i < rows; i++) {
    const yy = y + 14 + (i * (bottom - y - 20)) / rows;
    for (let x = R() * 60; x < width; x += 60 + R() * 70) {
      const w = 14 + R() * 18 + i * 4;
      out.push(stroke(`M${f(x)} ${f(yy)}q${f(w / 2)} ${f(-6 - i)} ${f(w)} 0`, m, 2.5 + i * 0.4, { opacity: 0.8 }));
    }
  }
  return g(out);
}

// ── Plants ───────────────────────────────────────────────────────────────────
export function cypress(h = 240, color = P.oliveD, { seed = 2 } = {}) {
  const R = rng(seed);
  const w = h * 0.17;
  const out = [rect(-4, -12, 8, 14, P.rust)];
  const body = `M0 ${-h}C${w * 0.5} ${-h * 0.8} ${w} ${-h * 0.45} ${w * 0.8} ${-h * 0.12}C${w * 0.6} ${-h * 0.02} ${w * 0.3} -8 0 -8C${-w * 0.3} -8 ${-w * 0.6} ${-h * 0.02} ${-w * 0.8} ${-h * 0.12}C${-w} ${-h * 0.45} ${-w * 0.5} ${-h * 0.8} 0 ${-h}Z`;
  out.push(path(body, color));
  const hi = lighten(color, 0.22);
  for (let i = 0; i < 9; i++) {
    const yy = -h * (0.15 + i * 0.085);
    const ww = w * (0.75 - Math.abs(i - 3) * 0.06) * (0.6 + R() * 0.3);
    out.push(stroke(`M${f(-ww * 0.2)} ${f(yy)}q${f(ww * 0.3)} ${f(-10)} ${f(ww * 0.7)} ${f(-4)}`, hi, 3));
  }
  return g(out);
}

// Olive: twisted trunk and a silvery canopy of leaf clusters.
export function olive(s = 1, { leaf = P.sage, dark = P.olive, trunk = P.taupe, seed = 5 } = {}) {
  const R = rng(seed);
  const out = [
    path('M-10 0C-4 -30 -22 -60 -8 -90C0 -104 -14 -120 -6 -134L8 -134C2 -116 18 -102 10 -86C2 -60 18 -30 12 0Z', trunk),
    stroke('M-4 -96C-24 -110 -40 -116 -56 -128', trunk, 7),
    stroke('M6 -100C22 -116 40 -122 58 -132', trunk, 7),
  ];
  const lumps = [[-70, -150, 46], [-20, -176, 54], [36, -168, 50], [78, -140, 38], [-40, -120, 34], [20, -128, 40]];
  for (const [x, y, r] of lumps) out.push(ellipse(x, y, r * 1.2, r * 0.82, dark));
  for (const [x, y, r] of lumps) out.push(ellipse(x - 6, y - 6, r, r * 0.66, leaf));
  for (let i = 0; i < 46; i++) {
    const x = -100 + R() * 200, y = -200 + R() * 110;
    out.push(ellipse(x, y, 7, 2.6, i % 3 ? lighten(leaf, 0.3) : dark, { transform: `rotate(${f(R() * 180)} ${f(x)} ${f(y)})` }));
  }
  return g(out, { transform: s === 1 ? null : `scale(${s})` });
}

// Plane tree: pale mottled trunk, broad lobed canopy.
export function planeTree(s = 1, { leaf = P.olive, light = P.sage, trunk = P.stone, seed = 9 } = {}) {
  const R = rng(seed);
  const out = [
    path('M-26 0C-18 -60 -30 -120 -14 -190L14 -190C26 -120 22 -60 30 0Z', trunk),
    stroke('M-10 -170C-50 -200 -90 -214 -140 -230', trunk, 16),
    stroke('M8 -176C50 -210 100 -220 150 -236', trunk, 14),
  ];
  for (let i = 0; i < 9; i++) out.push(ellipse(-14 + R() * 30, -20 - R() * 160, 6 + R() * 6, 4 + R() * 4, lighten(trunk, 0.45), { opacity: 0.8 }));
  const lumps = [[-190, -250, 80], [-100, -300, 100], [10, -320, 110], [120, -300, 100], [200, -250, 80], [-60, -230, 70], [80, -230, 70]];
  for (const [x, y, r] of lumps) out.push(ellipse(x, y, r, r * 0.7, leaf));
  for (const [x, y, r] of lumps) out.push(ellipse(x - r * 0.2, y - r * 0.18, r * 0.62, r * 0.4, light, { opacity: 0.85 }));
  for (let i = 0; i < 40; i++) {
    const x = -240 + R() * 480, y = -380 + R() * 180;
    out.push(path(`M${f(x)} ${f(y)}l6 -8l6 8l-6 6z`, i % 2 ? light : darken(leaf, 0.8)));
  }
  return g(out, { transform: s === 1 ? null : `scale(${s})` });
}

// ── Furniture & things ──────────────────────────────────────────────────────
export const stool = (color = P.rust) => g([
  rect(-40, -124, 80, 12, color),
  stroke('M-32 -112C-30 -70 -38 -30 -34 0M32 -112C30 -70 38 -30 34 0', color, 8),
  line(-33, -50, 33, -50, color, 5),
]);

// Couch (kline) for reclining or sitting on, mattress top at y = -140, from
// x0 to x1; the raised head-end is at x1.
export const kline = (x0 = -250, x1 = 60, { wood = P.rust, cover = P.bone, cushion = P.teal, pattern = null, throwCol = null } = {}) => g([
  path(`M${x0} -112H${x0 + 24}L${x0 + 20} -60L${x0 + 26} -40L${x0 + 18} 0H${x0 + 8}L${x0 + 4} -40L${x0 + 10} -60Z`, wood),
  path(`M${x1 - 24} -112H${x1}L${x1 - 10} -60L${x1 - 4} -40L${x1 - 12} 0H${x1 - 22}L${x1 - 26} -40L${x1 - 20} -60Z`, wood),
  rect(x0 - 8, -124, x1 - x0 + 16, 16, wood),
  rect(x0 - 8, -112, x1 - x0 + 16, 4, darken(wood, 0.7)),
  path(`M${x0 - 4} -124C${x0 - 6} -138 ${x0} -146 ${x0 + 10} -146H${x1 - 6}C${x1 + 4} -146 ${x1 + 6} -136 ${x1 + 4} -124Z`, cover),
  pattern ? path(`M${x0 - 4} -124C${x0 - 6} -138 ${x0} -146 ${x0 + 10} -146H${x1 - 6}C${x1 + 4} -146 ${x1 + 6} -136 ${x1 + 4} -124Z`, pattern) : null,
  throwCol ? path(`M${x0 + 30} -146H${x0 + 140}L${x0 + 134} -96C${x0 + 110} -88 ${x0 + 60} -88 ${x0 + 36} -96Z`, throwCol) : null,
  path(`M${x1 - 4} -150C${x1 + 4} -196 ${x1 + 26} -212 ${x1 + 46} -206C${x1 + 30} -196 ${x1 + 22} -174 ${x1 + 22} -124H${x1 - 2}Z`, wood),
  ellipse(x1 - 10, -166, 34, 22, cushion),
  stroke(`M${x1 - 38} -168Q${x1 - 10} -154 ${x1 + 20} -168`, darken(cushion, 0.7), 3),
]);

export const table = (w = 90, color = P.rust) => g([
  rect(-w / 2, -62, w, 8, color),
  stroke(`M${-w / 2 + 10} -54L${-w / 2 + 6} 0M${w / 2 - 10} -54L${w / 2 - 6} 0M0 -54V0`, color, 6),
]);

// Kylix (shallow cup), centred, base on y = 0.
export const kylix = (s = 1, color = P.ink, band = P.clay) => g([
  path('M-50 -34H50C48 -18 30 -12 0 -12C-30 -12 -48 -18 -50 -34Z', color),
  rect(-4, -14, 8, 10, color),
  path('M-14 0C-12 -4 -6 -6 0 -6C6 -6 12 -4 14 0Z', color),
  stroke('M-46 -30C-60 -36 -66 -26 -54 -22M46 -30C60 -36 66 -26 54 -22', color, 4),
  band ? stroke('M-40 -26Q0 -18 40 -26', band, 3) : null,
], { transform: s === 1 ? null : `scale(${s})` });

// Volute krater, base on y = 0, about 150 tall at s = 1.
export function krater(s = 1, color = P.ink, { band = P.clay, figure = P.clay } = {}) {
  return g([
    path('M-60 -150H60L50 -128C76 -118 82 -86 70 -60C60 -40 36 -30 22 -28L16 -14H32V0H-32V-14H-16L-22 -28C-36 -30 -60 -40 -70 -60C-82 -86 -76 -118 -50 -128Z', color),
    stroke('M-56 -140C-86 -150 -90 -112 -66 -110M56 -140C86 -150 90 -112 66 -110', color, 7),
    rect(-62, -110, 124, 6, band),
    rect(-58, -54, 116, 5, band),
    figure ? path('M-30 -98C-20 -100 -12 -90 -14 -78L-8 -62H-40L-34 -78C-38 -88 -36 -96 -30 -98ZM20 -98C30 -100 38 -90 36 -78L42 -62H10L16 -78C12 -88 14 -96 20 -98Z', figure) : null,
  ], { transform: s === 1 ? null : `scale(${s})` });
}

// Amphora, base on y = 0, about 150 tall.
export function amphora(s = 1, color = P.clay, { band = P.ink, dark = null } = {}) {
  const d = dark ?? darken(color, 0.75);
  return g([
    path('M-16 -150H16L14 -120C46 -110 56 -76 48 -46C42 -24 22 -10 10 -6L14 0H-14L-10 -6C-22 -10 -42 -24 -48 -46C-56 -76 -46 -110 -14 -120Z', color),
    path('M10 -118C40 -106 48 -76 42 -48C36 -28 20 -14 10 -8C26 -30 30 -80 10 -118Z', d),
    stroke('M-14 -136C-34 -138 -40 -116 -30 -108M14 -136C34 -138 40 -116 30 -108', color, 6),
    rect(-44, -80, 88, 6, band), rect(-40, -62, 80, 4, band),
  ], { transform: s === 1 ? null : `scale(${s})` });
}

// Oil lamp, nozzle to the right, base on y = 0; optional flame.
export function lamp(s = 1, color = P.clay, flame = true) {
  return g([
    path('M-40 -8C-40 -30 -10 -34 10 -28L44 -24C52 -22 52 -12 44 -10L10 -6C-10 0 -40 6 -40 -8Z', color),
    ellipse(-6, -24, 14, 4, darken(color, 0.6)),
    stroke('M-40 -18C-56 -22 -56 -6 -40 -8', color, 5),
    flame ? path('M48 -26C40 -40 46 -54 54 -66C54 -52 64 -44 60 -32C58 -26 52 -24 48 -26Z', P.ochre) : null,
    flame ? path('M50 -28C47 -36 50 -44 54 -50C55 -42 59 -38 57 -32C56 -29 53 -28 50 -28Z', P.bone) : null,
  ], { transform: s === 1 ? null : `scale(${s})` });
}

// Scroll held open, centred at 0,0.
export const scroll = (w = 70, color = P.bone, rod = P.rust) => g([
  rect(-w / 2, -14, w, 28, color),
  rect(-w / 2 - 6, -18, 10, 36, rod, { rx: 4 }), rect(w / 2 - 4, -18, 10, 36, rod, { rx: 4 }),
  stroke(`M${-w / 2 + 12} -6H${w / 2 - 12}M${-w / 2 + 12} 2H${w / 2 - 20}M${-w / 2 + 12} 10H${w / 2 - 14}`, darken(color, 0.7), 1.6),
]);

// Lyre (chelys), base on y = 0, about 120 tall.
export const lyre = (s = 1, wood = P.rust, shell = P.ochre) => g([
  stroke('M-18 -100C-40 -74 -36 -40 -16 -24M18 -100C40 -74 36 -40 16 -24', wood, 7),
  line(-26, -98, 26, -98, wood, 6),
  ellipse(0, -18, 28, 20, shell),
  ellipse(0, -18, 18, 12, darken(shell, 0.8)),
  ...[-9, -4.5, 0, 4.5, 9].map((x) => line(x, -96, x * 0.8, -14, P.bone, 1.4)),
], { transform: s === 1 ? null : `scale(${s})` });

export { darken, lighten };
