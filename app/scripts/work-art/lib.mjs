// Drawing kit for the work-landing illustrations (see build.mjs).
//
// Each plate is a self-contained SVG (1200×630 — also the social-card ratio)
// drawn in a mid-century editorial manner: flat colour from one shared
// palette, pattern and dry-brush texture, a slight hand-cut wobble on every
// edge, and a paper grain over all. Colours are written in as hex, so the file
// renders the same anywhere (an <img>, a social card, a print); the dark theme
// dims it with CSS rather than recolouring it.

export const W = 1200;
export const H = 630;

// The palette. Plates use these names, never raw hex.
export const P = {
  paper: '#efe6d2', cream: '#f7f0df', bone: '#fbf7ee', sand: '#e4d0a5', stone: '#cdbf9f', taupe: '#a8987a',
  ink: '#1f2422', night: '#1b2a37', dusk: '#2f4a5a',
  teal: '#1f6f7a', tealD: '#154e57', sky: '#a9cfc9', mist: '#d3e3dc',
  clay: '#c0552f', rust: '#8a3a20', rose: '#e8a07c', blush: '#f0c3a2',
  ochre: '#d9a134', gold: '#ebc463', olive: '#71803e', oliveD: '#46552a', sage: '#a7b07a',
  plum: '#6c3d5c', skin: '#e2a27c', skinD: '#b97852', skinL: '#efc09c',
};

export const f = (n) => Math.round(n * 10) / 10;

const attrs = (o) => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => ` ${k}="${v}"`).join('');

export const tag = (name, a = {}, kids) => (kids === undefined
  ? `<${name}${attrs(a)}/>`
  : `<${name}${attrs(a)}>${[].concat(kids).flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false).join('')}</${name}>`);

export const g = (kids, a = {}) => tag('g', a, kids);
export const at = (x, y, kids, s = 1, flip = false, rot = 0) => g(kids, {
  transform: `translate(${f(x)} ${f(y)})${rot ? ` rotate(${f(rot)})` : ''}${s !== 1 || flip ? ` scale(${flip ? -s : s} ${s})` : ''}`,
});
export const rect = (x, y, w, h, fill, a = {}) =>
  tag('rect', { x: f(x), y: f(y), width: f(w), height: f(h), fill, ...a });
export const circle = (cx, cy, r, fill, a = {}) =>
  tag('circle', { cx: f(cx), cy: f(cy), r: f(r), fill, ...a });
export const ellipse = (cx, cy, rx, ry, fill, a = {}) =>
  tag('ellipse', { cx: f(cx), cy: f(cy), rx: f(rx), ry: f(ry), fill, ...a });
export const path = (d, fill, a = {}) => tag('path', { d, fill, ...a });
export const stroke = (d, color, w = 2, a = {}) =>
  tag('path', { d, fill: 'none', stroke: color, 'stroke-width': w, ...a });
export const line = (x1, y1, x2, y2, color, w = 2, a = {}) =>
  tag('line', { x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2), stroke: color, 'stroke-width': w, ...a });
export const poly = (pts, fill, a = {}) =>
  tag('polygon', { points: pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' '), fill, ...a });

export const pol = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
export const arcD = (cx, cy, r, a0, a1) => {
  const [x0, y0] = pol(cx, cy, r, a0);
  const [x1, y1] = pol(cx, cy, r, a1);
  return `M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${f(x1)} ${f(y1)}`;
};
export const ptsD = (pts, closed = false) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + (closed ? 'Z' : '');

// Smooth curve through points (Catmull-Rom → cubic Bézier).
export const smooth = (pts, closed = false, k = 6) => {
  const n = pts.length;
  const q = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = q(i - 1), p1 = q(i), p2 = q(i + 1), p3 = q(i + 2);
    d += `C${f(p1[0] + (p2[0] - p0[0]) / k)} ${f(p1[1] + (p2[1] - p0[1]) / k)} `
      + `${f(p2[0] - (p3[0] - p1[0]) / k)} ${f(p2[1] - (p3[1] - p1[1]) / k)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
};
export const blob = (pts, fill, a = {}) => path(smooth(pts, true), fill, a);

export const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const lerp = (a, b, t) => a + (b - a) * t;

// ── Per-plate context: pattern and filter defs, ids prefixed by the plate id
// so two plates on one page never collide.
export function context(id) {
  const defs = new Map();
  const ctx = {
    id,
    // Repeating pattern used as a fill: url(#…). kinds: dots, hatch, stripes, check, waves, cross.
    pat(kind, color, { size = 10, w = 2, r = 1.6, angle = 0, bg = null } = {}) {
      const key = `${id}-${kind}-${color.slice(1)}-${size}-${w}-${r}-${angle}-${bg ? bg.slice(1) : ''}`;
      if (!defs.has(key)) {
        let kids;
        const s = size;
        if (kind === 'dots') kids = [circle(s / 2, s / 2, r, color), circle(0, 0, r, color), circle(s, 0, r, color), circle(0, s, r, color), circle(s, s, r, color)];
        else if (kind === 'hatch') kids = [line(0, s / 2, s, s / 2, color, w)];
        else if (kind === 'stripes') kids = [rect(0, 0, s, s / 2, color)];
        else if (kind === 'check') kids = [rect(0, 0, s / 2, s / 2, color), rect(s / 2, s / 2, s / 2, s / 2, color)];
        else if (kind === 'waves') kids = [stroke(`M0 ${s * 0.6}Q${s / 4} ${s * 0.25} ${s / 2} ${s * 0.6}T${s} ${s * 0.6}`, color, w)];
        else if (kind === 'cross') kids = [line(0, s / 2, s, s / 2, color, w), line(s / 2, 0, s / 2, s, color, w)];
        else throw new Error(`pattern ${kind}`);
        defs.set(key, tag('pattern', {
          id: key, width: s, height: s, patternUnits: 'userSpaceOnUse',
          patternTransform: angle ? `rotate(${angle})` : null,
        }, [bg ? rect(0, 0, s, s, bg) : null, ...kids]));
      }
      return `url(#${key})`;
    },
    // Dry-brush: punches fine speckled holes through whatever it is applied to.
    get dry() {
      const key = `${id}-dry`;
      if (!defs.has(key)) {
        defs.set(key, tag('filter', { id: key, x: '-5%', y: '-5%', width: '110%', height: '110%' }, [
          tag('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.7', numOctaves: 3, seed: 11, result: 'n' }),
          tag('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 1.75', result: 'm' }),
          tag('feComposite', { in: 'SourceGraphic', in2: 'm', operator: 'in' }),
        ]));
      }
      return `url(#${key})`;
    },
    // Soft blur, for glows and atmospheric haze.
    blur(sd) {
      const key = `${id}-blur${sd}`;
      if (!defs.has(key)) defs.set(key, tag('filter', { id: key, x: '-50%', y: '-50%', width: '200%', height: '200%' }, tag('feGaussianBlur', { stdDeviation: sd })));
      return `url(#${key})`;
    },
    // Linear gradient (vertical by default) from a list of [offset, colour, opacity?].
    grad(stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1 } = {}) {
      const key = `${id}-g${defs.size}`;
      defs.set(key, tag('linearGradient', { id: key, x1, y1, x2, y2 }, stops.map(([o, c, op = 1]) => tag('stop', { offset: o, 'stop-color': c, 'stop-opacity': op }))));
      return `url(#${key})`;
    },
    radial(stops, { cx = 0.5, cy = 0.5, r = 0.5 } = {}) {
      const key = `${id}-r${defs.size}`;
      defs.set(key, tag('radialGradient', { id: key, cx, cy, r }, stops.map(([o, c, op = 1]) => tag('stop', { offset: o, 'stop-color': c, 'stop-opacity': op }))));
      return `url(#${key})`;
    },
    clip(shape) {
      const key = `${id}-c${defs.size}`;
      defs.set(key, tag('clipPath', { id: key }, shape));
      return `url(#${key})`;
    },
    defs: () => [...defs.values()],
  };
  return ctx;
}

// The finished plate: the drawing with a hand-cut wobble, then paper grain.
export function plate(ctx, body, { wobble = 2.2 } = {}) {
  const id = ctx.id;
  const filters = [
    tag('filter', { id: `${id}-wob`, x: '-2%', y: '-2%', width: '104%', height: '104%' }, [
      tag('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.04', numOctaves: 2, seed: 5, result: 't' }),
      tag('feDisplacementMap', { in: 'SourceGraphic', in2: 't', scale: wobble, xChannelSelector: 'R', yChannelSelector: 'G' }),
    ]),
    tag('filter', { id: `${id}-grain`, x: 0, y: 0, width: '100%', height: '100%' }, [
      tag('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: 2, seed: 7, stitchTiles: 'stitch', result: 'n' }),
      tag('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0.12  0 0 0 0 0.1  0 0 0 0 0.06  0 0 0 2.2 -1.05' }),
    ]),
    tag('filter', { id: `${id}-fiber`, x: 0, y: 0, width: '100%', height: '100%' }, [
      tag('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.012 0.09', numOctaves: 3, seed: 3, result: 'n' }),
      tag('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0.98  0 0 0 0 0.95  0 0 0 0 0.86  0 0 0 1.4 -0.62' }),
    ]),
  ];
  return tag('svg', {
    xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, [
    tag('defs', {}, [...filters, ...ctx.defs()]),
    tag('clipPath', { id: `${id}-frame` }, rect(0, 0, W, H, '#000')),
    g([
      g(body, { filter: `url(#${id}-wob)` }),
      rect(0, 0, W, H, '#000', { filter: `url(#${id}-fiber)`, opacity: 0.12 }),
      rect(0, 0, W, H, '#000', { filter: `url(#${id}-grain)`, opacity: 0.5 }),
    ], { 'clip-path': `url(#${id}-frame)` }),
  ]);
}
