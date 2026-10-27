// Phaedo 116e — "the sun is still upon the mountains and has not yet set."
// The prison at sunset: Socrates on the edge of his bed with the cup, Crito at
// his side, Phaedo on a low stool at his feet, Apollodorus weeping by the wall,
// and through the window the sun going down behind the hills.
import { P, W, H, g, at, rect, circle, ellipse, path, stroke, line, poly } from '../lib.mjs';
import { person, CAST, darken } from '../figures.mjs';
import { wall, hills, sun, cypress, kline, stool, kylix, amphora, lamp, meander } from '../props.mjs';

export default function Phaedo(c) {
  const floor = 520;
  const win = { x: 650, y: 104, w: 360, h: 290 };
  const sky = c.grad([[0, P.gold], [0.55, P.blush], [1, P.rose]]);
  const glow = c.radial([[0, P.gold, 0.55], [1, P.gold, 0]]);
  const light = c.grad([[0, P.gold, 0.5], [1, P.gold, 0]], { x1: 0, y1: 0, x2: 1, y2: 0 });

  const view = g([
    rect(win.x, win.y, win.w, win.h, sky),
    at(win.x + 190, win.y + 196, [sun(70, P.ochre, { ring: P.gold })]),
    hills([[win.x, 250], [win.x + 80, 216], [win.x + 170, 238], [win.x + 260, 196], [win.x + 360, 230]], win.y + win.h, P.dusk),
    hills([[win.x, 290], [win.x + 110, 262], [win.x + 220, 286], [win.x + 300, 258], [win.x + 360, 276]], win.y + win.h, P.tealD),
    hills([[win.x, 330], [win.x + 140, 312], [win.x + 260, 334], [win.x + 360, 318]], win.y + win.h, P.oliveD),
    at(win.x + 64, win.y + win.h - 30, [cypress(150, P.ink, { seed: 4 })]),
    at(win.x + 96, win.y + win.h - 34, [cypress(110, P.ink, { seed: 7 })]),
    at(win.x + 300, win.y + win.h - 36, [cypress(130, P.ink, { seed: 8 })]),
  ], { 'clip-path': c.clip(rect(win.x, win.y, win.w, win.h, '#000')) });

  return [
    // room
    wall(0, 0, W, floor, '#d9c7a2', { course: 52, seed: 6, joint: '#bfa983' }),
    rect(0, 0, W, 40, '#c9b48d'),
    meander(0, 40, W, 22, P.rust, '#e6d6b2'),
    rect(win.x - 26, win.y - 26, win.w + 52, win.h + 52, '#b59d74'),
    view,
    rect(win.x + win.w / 2 - 5, win.y, 10, win.h, '#5c4a34'),
    rect(win.x, win.y + 120, win.w, 9, '#5c4a34'),
    rect(win.x - 34, win.y + win.h + 8, win.w + 68, 18, '#c9b48d'),
    ellipse(win.x + 180, win.y + 180, 330, 240, glow),
    // floor, with the window's light thrown across it
    rect(0, floor, W, H - floor, '#b8794f'),
    rect(0, floor, W, H - floor, c.pat('check', '#a96a43', { size: 56 }), { opacity: 0.55 }),
    rect(0, floor, W, 8, '#8d5535'),
    poly([[win.x - 40, floor + 8], [win.x + win.w + 60, floor + 8], [win.x + win.w + 300, H], [win.x + 40, H]], light),

    // the door, half open, the jailer waiting in it
    rect(1050, 150, 120, 370, '#3f3122'),
    rect(1062, 162, 96, 358, '#2a2018'),
    at(1112, floor, [person({
      head: { kind: 'man', hair: P.ink, tilt: 8 }, robe: P.taupe, shade: '#7a6a50', chiton: P.sand, arm: 'down',
    })], 0.86, true),
    poly([[1050, 150], [1000, 166], [1000, 532], [1050, 520]], '#6b5238'),

    // Apollodorus at the wall, face in his hands
    at(150, floor, [person({
      head: { kind: 'youth', hair: P.ink, tilt: 22 }, robe: P.plum, border: P.gold, arm: [96, -128], backArm: [100, -110],
    })], 0.98),
    // Crito, seated, leaning in
    at(250, floor, [stool(P.rust)]),
    at(250, floor, [person({
      pose: 'sit', head: { kind: 'elder', hair: P.stone, beard: P.stone, tilt: 10 }, robe: P.teal, border: P.ochre,
      pattern: c.pat('dots', P.tealD, { size: 14, r: 2 }), arm: 'reach', hand: 'open',
    })]),

    // the bed, and Socrates on its edge raising the cup
    at(590, floor, [kline(-230, 40, { wood: "#6b3e22", cover: P.bone, cushion: P.clay, throwCol: P.teal, pattern: c.pat("stripes", P.sand, { size: 12 }) })]),
    at(470, floor, [person({
      ...CAST.socrates, pose: 'sit', arm: [40, -70],
      hold: (x, y) => at(x + 4, y - 4, [kylix(0.8, P.ink, P.clay)]),
    })]),
    // Phaedo on a low stool at his feet
    at(640, floor, [path('M-34 -60H34L28 0H22L18 -50H-18L-22 0H-28Z', P.rust)]),
    at(640, floor, [person({
      pose: 'crouch', head: { kind: 'youth', hair: P.rust, tilt: -6 }, robe: P.ochre, border: P.clay, arm: [140, -100],
    })], 1, true),

    // a lamp not yet needed, and a water jar
    at(880, floor, [amphora(0.8, P.clay, { band: P.ink })]),
    at(790, floor - 4, [lamp(0.8, P.clay, false)]),
  ];
}
