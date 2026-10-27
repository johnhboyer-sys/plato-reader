// People. Every figure is drawn in its own frame — feet on y = 0, facing right,
// a standing adult about 300 units tall — and placed with lib.at(x, y, …, scale,
// flip). Faces are profiles in the mid-century manner: a dot of an eye, the
// nose carried by the silhouette, hair and beard as their own shapes.
import { P, g, at, rect, circle, ellipse, path, stroke, line, pol, smooth, f } from './lib.mjs';

// ── Heads (centre of the cranium at 0,0; radius ≈ 22) ──────────────────────
const FACE = {
  // brow → nose → lips → chin, as a closed skull+face silhouette
  plain: 'M-20 -8C-22 -27 0 -33 12 -25C18 -21 21 -13 21 -6L29 5L22 8L23 12L20 14L21 19C18 24 10 26 4 25C-6 24 -14 18 -18 10C-21 4 -21 -2 -20 -8Z',
  snub: 'M-21 -8C-23 -28 0 -34 13 -25C19 -21 21 -12 21 -6L26 0L28 6L22 8L23 12L20 14L21 19C18 24 10 26 4 25C-6 24 -14 18 -18 10C-21 4 -22 -2 -21 -8Z',
  soft: 'M-20 -8C-22 -26 0 -32 12 -24C18 -20 20 -12 20 -6L26 4L21 7L22 11L19 13L19 17C16 22 10 23 4 23C-6 22 -14 17 -18 10C-21 4 -21 -2 -20 -8Z',
};

const curls = (pts, r, color) => pts.map(([x, y]) => circle(x, y, r, color));

export function head(o = {}) {
  const {
    kind = 'man', skin = P.skin, hair = P.ink, beard = hair, wreath = null, band = null, eye = P.ink,
  } = o;
  const face = kind === 'socrates' ? FACE.snub : (kind === 'woman' || kind === 'youth' || kind === 'boy') ? FACE.soft : FACE.plain;
  const back = [], front = [];
  // hair behind the skull
  if (kind === 'elder') back.push(path('M-6 -30C-26 -30 -34 -6 -32 18C-30 36 -24 50 -18 58L-2 50C-6 30 -4 14 0 4Z', hair));
  if (kind === 'woman') {
    back.push(path('M-4 -30C-26 -28 -30 -6 -26 10C-24 18 -18 22 -12 20L0 -10Z', hair));
    back.push(ellipse(-24, -10, 13, 15, hair)); // the knot
  }
  if (kind === 'youth') back.push(path('M-8 -28C-28 -24 -30 4 -24 22C-20 30 -14 30 -10 24L-4 -6Z', hair));
  front.push(path(face, skin));
  front.push(ellipse(-4, 3, 4.5, 6.5, P.skinD, { opacity: 0.55 })); // ear
  // hair on the skull
  if (kind === 'socrates') {
    front.push(path('M-8 -9C-16 -8 -21 -2 -21 6C-21 12 -18 16 -14 18L-10 12C-14 6 -12 -2 -6 -4Z', hair));
  } else if (kind === 'man' || kind === 'boy' || kind === 'youth') {
    front.push(path('M-21 -2C-24 -22 -8 -33 8 -29C14 -27 18 -22 19 -16C12 -20 4 -18 -2 -14C-6 -10 -8 -4 -8 4C-12 6 -16 10 -18 14C-21 10 -22 4 -21 -2Z', hair));
    front.push(...curls([[-14, -24], [-4, -30], [7, -30], [15, -24], [-20, -12], [-21, 0]], kind === 'boy' ? 5 : 6, hair));
  } else if (kind === 'elder') {
    front.push(path('M-21 -2C-24 -22 -8 -33 8 -29C14 -27 18 -22 19 -16C10 -18 2 -16 -4 -12C-8 -8 -10 0 -10 8C-14 10 -18 12 -20 14C-22 10 -22 4 -21 -2Z', hair));
  } else if (kind === 'woman') {
    front.push(path('M-21 0C-24 -22 -8 -33 8 -29C15 -27 19 -21 20 -14C12 -18 2 -17 -4 -12C-8 -8 -10 0 -9 6C-13 8 -17 10 -20 12C-21 8 -21 4 -21 0Z', hair));
  } else if (kind === 'bald') {
    front.push(path('M-8 -9C-16 -8 -21 -2 -21 6C-21 12 -18 16 -14 18L-10 12C-14 6 -12 -2 -6 -4Z', hair));
  }
  // beard
  if (kind === 'socrates') {
    front.push(path('M20 13C24 22 22 34 14 42C6 50 -6 50 -12 42C-16 36 -14 24 -10 18C-4 24 6 24 12 18C14 16 18 14 20 13Z', beard));
    front.push(...curls([[14, 40], [4, 46], [-6, 44], [-12, 36], [18, 30]], 5, beard));
    front.push(stroke('M13 11Q18 9 22 11', beard, 3)); // moustache
  } else if (kind === 'man' || kind === 'bald') {
    front.push(path('M21 14C24 22 22 30 16 36C10 40 2 38 -2 32C-6 26 -8 20 -8 14C-2 20 8 20 14 14C16 12 19 12 21 14Z', beard));
    front.push(stroke('M14 11Q18 9 22 11', beard, 3));
  } else if (kind === 'elder') {
    front.push(path('M21 13C25 24 24 40 18 56C14 64 6 66 0 58C-6 46 -8 30 -8 16C-2 22 8 22 14 15C16 13 19 12 21 13Z', beard));
    front.push(stroke('M14 11Q18 9 23 11', beard, 3));
  }
  // eye and brow
  front.push(ellipse(11, -4, 2.6, 2.8, eye));
  front.push(stroke('M6 -11Q11 -14 16 -11', kind === 'elder' ? beard : hair, 2.4));
  if (band) front.push(stroke('M-21 -12Q-2 -24 17 -20', band, 4));
  if (wreath) {
    const leaves = [];
    for (let i = 0; i < 7; i++) {
      const a = 200 + i * 22;
      const [x, y] = pol(0, -4, 24, a);
      leaves.push(ellipse(x, y, 7, 3.4, wreath, { transform: `rotate(${f(a + 70)} ${f(x)} ${f(y)})` }));
    }
    front.push(...leaves);
  }
  return g([...back, ...front]);
}

// Head seen from behind (crowds, audiences): hair cap over a skin nape.
export const headBack = ({ skin = P.skin, hair = P.ink } = {}) => g([
  ellipse(-21, 4, 4, 6, skin), ellipse(21, 4, 4, 6, skin),
  circle(0, 0, 21, skin),
  path('M-21 6C-23 -16 -12 -26 0 -26C12 -26 23 -16 21 6C16 12 8 14 0 14C-8 14 -16 12 -21 6Z', hair),
  ...curls([[-15, -18], [-5, -24], [6, -24], [16, -17], [-19, -6], [19, -6], [-12, 8], [0, 10], [12, 8]], 6, hair),
]);

// Head facing the viewer.
export function headFront(o = {}) {
  const { skin = P.skin, hair = P.ink, beard = null, kind = 'man', eye = P.ink } = o;
  const out = [ellipse(0, 0, 21, 25, skin)];
  if (kind === 'woman') out.unshift(ellipse(0, -6, 26, 26, hair));
  out.push(path('M-21 -2C-22 -22 -10 -28 0 -28C10 -28 22 -22 21 -2C16 -14 8 -16 0 -16C-8 -16 -16 -14 -21 -2Z', hair));
  if (kind !== 'bald' && kind !== 'socrates') out.push(...curls([[-14, -22], [-4, -27], [6, -27], [15, -22]], 5.5, hair));
  if (beard) out.push(path('M-18 8C-16 30 -6 38 0 38C6 38 16 30 18 8C12 16 6 18 0 18C-6 18 -12 16 -18 8Z', beard));
  out.push(circle(-8, -2, 2.4, eye), circle(8, -2, 2.4, eye));
  out.push(stroke('M0 0L-2 9L2 9', P.skinD, 2));
  return g(out);
}

// ── Arms ────────────────────────────────────────────────────────────────────
// Angles in degrees clockwise from +x; 90 hangs straight down.
export const ARM = {
  down: [92, 88], speak: [62, -38], point: [14, 4], hold: [68, 4], raise: [-58, -76],
  chin: [104, -118], cup: [56, -20], reach: [26, 24], open: [40, -10], rest: [80, 20], back: [120, 80],
};

export function arm(sx, sy, pose, { skin = P.skin, len = 1, sleeve = null, hand = 'fist', w = 13 } = {}) {
  const [a1, a2] = typeof pose === 'string' ? ARM[pose] : pose;
  const [ex, ey] = pol(sx, sy, 60 * len, a1);
  const [hx, hy] = pol(ex, ey, 54 * len, a2);
  const out = [
    stroke(`M${f(sx)} ${f(sy)}L${f(ex)} ${f(ey)}`, skin, (w + 2) * len),
    stroke(`M${f(ex)} ${f(ey)}L${f(hx)} ${f(hy)}`, skin, (w - 1) * len),
  ];
  if (sleeve) out.unshift(stroke(`M${f(sx)} ${f(sy)}L${f(lerpPt(sx, ex, 0.55))} ${f(lerpPt(sy, ey, 0.55))}`, sleeve, (w + 7) * len));
  if (hand === 'point') {
    const [fx, fy] = pol(hx, hy, 15 * len, a2 - 8);
    out.push(circle(hx, hy, 7.5 * len, skin), stroke(`M${f(hx)} ${f(hy)}L${f(fx)} ${f(fy)}`, skin, 4.5 * len));
  } else if (hand === 'open') {
    const [fx, fy] = pol(hx, hy, 12 * len, a2 - 30);
    out.push(ellipse(hx, hy, 9 * len, 6 * len, skin, { transform: `rotate(${f(a2 - 30)} ${f(hx)} ${f(hy)})` }),
      stroke(`M${f(hx)} ${f(hy)}L${f(fx)} ${f(fy)}`, skin, 6 * len));
  } else {
    out.push(circle(hx, hy, 7.5 * len, skin));
  }
  return { svg: g(out), hand: [hx, hy], elbow: [ex, ey] };
}
const lerpPt = (a, b, t) => a + (b - a) * t;

// ── Bodies ──────────────────────────────────────────────────────────────────
// o: { pose, head (opts for head()), robe, shade, chiton, border, pattern,
//      arm (front-arm pose), backArm (pose or null), hold (fn(hx, hy) → svg),
//      skin, sandal }
export function person(o = {}) {
  const {
    pose = 'stand', robe = P.teal, shade = null, chiton = P.cream, border = null, pattern = null,
    skin = P.skin, sandal = P.rust, arm: armPose = 'down', backArm = null, hold = null, hand = 'fist',
  } = o;
  const hd = { skin, ...(o.head ?? {}) };
  const dk = shade ?? darken(robe);
  const parts = [];
  let H0, S, B; // head centre, front shoulder, back shoulder
  if (pose === 'stand' || pose === 'walk') {
    const walk = pose === 'walk';
    H0 = [8, -272]; S = [14, -230]; B = [-18, -232];
    if (backArm) parts.push(arm(B[0], B[1], backArm, { skin: P.skinD }).svg);
    parts.push(walk
      ? ellipse(-30, -4, 13, 5, sandal)
      : ellipse(-18, -4, 13, 5, sandal));
    parts.push(ellipse(walk ? 44 : 30, -4, 13, 5, sandal));
    // chiton below the himation hem
    parts.push(path(walk
      ? 'M-38 -34L40 -38L50 -8L-44 -6Z'
      : 'M-34 -34L36 -36L40 -8L-38 -7Z', chiton));
    parts.push(stroke(walk ? 'M-20 -30L-24 -8M6 -32L8 -8M28 -34L34 -9' : 'M-18 -30L-20 -8M4 -32L5 -8M22 -33L25 -9', darken(chiton, 0.85), 2.5));
    if (border) parts.push(path(walk ? 'M-43 -14L49 -16L50 -8L-44 -6Z' : 'M-38 -14L39 -15L40 -8L-38 -7Z', border));
    const robeD = walk
      ? 'M-24 -240C-36 -200 -40 -120 -40 -60L-42 -32L42 -38C44 -90 40 -140 32 -182C28 -210 24 -230 14 -242C6 -248 -14 -246 -24 -240Z'
      : 'M-24 -240C-34 -200 -36 -120 -34 -60L-36 -30L37 -34C38 -90 38 -140 32 -182C28 -210 24 -230 14 -242C6 -248 -14 -246 -24 -240Z';
    parts.push(path(robeD, robe));
    if (pattern) parts.push(path(robeD, pattern));
    // the himation's diagonal drape and folds
    parts.push(path(walk
      ? 'M-24 -240C-6 -200 22 -150 36 -110L40 -70C14 -110 -16 -168 -34 -206Z'
      : 'M-24 -240C-6 -200 22 -150 34 -110L37 -70C12 -110 -16 -168 -32 -206Z', dk));
    parts.push(stroke('M-20 -160C-14 -120 -12 -80 -14 -44', dk, 3));
    parts.push(stroke('M2 -130C6 -100 10 -70 10 -44', dk, 3));
    parts.push(stroke('M-30 -110C-28 -80 -28 -60 -28 -42', dk, 3));
    if (border) parts.push(stroke(walk ? 'M-42 -33L42 -39' : 'M-36 -31L37 -35', border, 5));
  } else if (pose === 'sit') {
    H0 = [10, -246]; S = [14, -206]; B = [-16, -208];
    if (backArm) parts.push(arm(B[0], B[1], backArm, { skin: P.skinD }).svg);
    parts.push(ellipse(84, -4, 13, 5, sandal), ellipse(60, -4, 12, 5, sandal));
    const robeD = 'M-24 -216C-34 -186 -34 -150 -28 -124L40 -114L46 -12L90 -10L84 -112C84 -126 74 -134 62 -136L12 -140C22 -170 24 -198 16 -220C6 -228 -14 -224 -24 -216Z';
    parts.push(path('M46 -40L90 -40L90 -10L46 -12Z', chiton));
    parts.push(path(robeD, robe));
    if (pattern) parts.push(path(robeD, pattern));
    parts.push(path('M-24 -216C-6 -186 10 -160 20 -138L-8 -132C-18 -160 -26 -186 -30 -200Z', dk));
    parts.push(stroke('M56 -104L62 -16', dk, 3), stroke('M72 -108L78 -16', dk, 3), stroke('M-6 -128L60 -126', dk, 3));
    if (border) parts.push(stroke('M46 -12L90 -10', border, 6));
  } else if (pose === 'recline') {
    H0 = [4, -258]; S = [12, -216]; B = [-20, -214];
    const back = arm(B[0], B[1], [128, 176], { skin: P.skinD });
    parts.push(back.svg);
    // bare torso
    parts.push(path('M-22 -224C-10 -232 10 -232 18 -222C26 -206 26 -186 20 -168L-18 -164C-26 -184 -28 -206 -22 -224Z', skin));
    // drapery over the hips and legs, stretched out to the left
    const dr = 'M30 -170C30 -150 24 -140 10 -140L-230 -140C-238 -150 -232 -168 -214 -172C-180 -178 -140 -196 -110 -194C-80 -192 -50 -176 -24 -176Z';
    parts.push(path(dr, robe));
    if (pattern) parts.push(path(dr, pattern));
    parts.push(stroke('M-200 -160C-160 -170 -120 -180 -90 -176', dk, 3), stroke('M-80 -150C-50 -158 -20 -162 10 -160', dk, 3));
    if (border) parts.push(stroke('M-230 -142L12 -142', border, 6));
  } else if (pose === 'crouch') {
    H0 = [56, -176]; S = [44, -140]; B = [20, -142];
    if (backArm) parts.push(arm(B[0], B[1], backArm, { skin: P.skinD, len: 0.85 }).svg);
    parts.push(stroke('M6 -60L60 -66L44 -4', P.skinD, 17), ellipse(52, -4, 12, 5, sandal));
    parts.push(stroke('M0 -58L54 -60L36 -4', skin, 18), ellipse(44, -4, 12, 5, sandal));
    const tunic = 'M-14 -60C-18 -96 0 -136 28 -152L52 -148C62 -120 64 -96 60 -72L56 -56L-12 -48Z';
    parts.push(path(tunic, robe));
    if (pattern) parts.push(path(tunic, pattern));
    parts.push(stroke('M6 -120C16 -100 20 -80 22 -56', dk, 3));
    if (border) parts.push(stroke('M-12 -50L56 -58', border, 6));
  }
  const h = head(hd);
  parts.push(rect(H0[0] - 7, H0[1] + 14, 15, 22, skin)); // neck
  parts.push(at(H0[0], H0[1], [h], 1, false, hd.tilt ?? 0));
  if (armPose) {
    const len = pose === 'crouch' ? 0.85 : 1;
    const a = arm(S[0], S[1], armPose, { skin, len, hand });
    parts.push(a.svg);
    if (hold) parts.push(hold(a.hand[0], a.hand[1]));
  }
  return g(parts);
}

// Figure facing the viewer, standing, robe and folds symmetrical-ish.
export function personFront(o = {}) {
  const { robe = P.teal, shade = null, skin = P.skin, chiton = P.cream, border = null, head: hd = {}, arms = 'down', pattern = null } = o;
  const dk = shade ?? darken(robe);
  const robeD = 'M-30 -236C-46 -200 -48 -100 -44 -30L44 -30C48 -100 46 -200 30 -236C20 -244 -20 -244 -30 -236Z';
  const out = [
    ellipse(-14, -4, 12, 5, P.rust), ellipse(14, -4, 12, 5, P.rust),
    path('M-42 -36H42L44 -10H-44Z', chiton),
    border ? rect(-44, -20, 88, 10, border) : null,
    path(robeD, robe),
    pattern ? path(robeD, pattern) : null,
    path('M-30 -236C-10 -200 20 -140 44 -100L44 -70C10 -110 -20 -170 -38 -200Z', dk),
    stroke('M-24 -150C-20 -110 -20 -70 -22 -34', dk, 3),
    stroke('M18 -90C20 -70 20 -50 20 -34', dk, 3),
    rect(-7, -252, 14, 20, skin),
    at(0, -276, [headFront({ skin, ...hd })]),
  ];
  if (arms === 'down') out.push(stroke('M30 -226L40 -160L38 -110', skin, 13), circle(38, -106, 7.5, skin));
  if (arms === 'raise') out.push(stroke('M30 -226L64 -270L70 -320', skin, 13), circle(70, -324, 7.5, skin));
  return g(out);
}

// Seated audience member seen from behind: head over a draped back.
export const backView = ({ robe = P.teal, skin = P.skin, hair = P.ink, s = 1 } = {}) => g([
  path('M-40 0C-44 -40 -34 -70 -20 -78C-8 -84 8 -84 20 -78C34 -70 44 -40 40 0Z', robe),
  path('M-20 -78C-6 -60 14 -40 34 -10L40 0L28 0C10 -30 -10 -56 -26 -72Z', darken(robe)),
  rect(-8, -92, 16, 14, skin),
  at(0, -104, [headBack({ skin, hair })]),
], { transform: s === 1 ? null : `scale(${s})` });

// Darker shade of a palette colour for folds and shadow sides.
export function darken(hex, k = 0.72) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
export function lighten(hex, k = 0.35) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// Recurring cast, so a character looks the same from plate to plate.
export const CAST = {
  socrates: { head: { kind: 'socrates', hair: P.taupe, beard: P.taupe, skin: P.skin }, robe: P.taupe, shade: '#7d6f57', chiton: P.cream },
};

export { line, ellipse, rect, circle };
