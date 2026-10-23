// Player models: they stand in for your skin. 50 of them, 50,000 coins each (Verity, with the most
// powers, costs more). Most are built like Minecraft's own mobs, from blocks with a little shading
// and noise so they read as made of something, on the player's skeleton (see kit.mjs for roles):
// legs at x ±2 from y 0 to 12, the body from 12 to 24, arms beside it, the head from 24 to 32.
import { Vox, part, GLOW, SEE, RAINBOW, FLICKER, mix, shade, alpha, rng, spin, sway, flap, bob, pulse, twitch, fx } from './kit.mjs';
import verity from './verity.mjs';

const items = [...verity];
const PRICE = 50000;

/** Adds a model. m: { h: heights per form, forms, faces, power }. */
function model(id, name, rarity, desc, parts, { h = 32, forms, faces, power, effects = [] } = {}) {
  items.push({
    id: `model_${id}`, name, slot: 'model', rarity, price: PRICE, desc,
    m: { h: Array.isArray(h) ? h : [h], ...(forms ? { forms } : {}), ...(faces ? { faces: faces.map((f) => f.name) } : {}), ...(power ? { power } : {}) },
    parts,
    fx: effects,
  });
}

// ------------------------------------------------------------------ painting

/**
 * A colour for each block: lighter on top, darker underneath, and a little noise (three steps, so
 * runs of blocks still merge), like a Minecraft texture. `base` may be a function (x, y, z).
 */
function paint(base, { seed = 1, noise = 0.035, light = 0.12 } = {}) {
  const R = rng(seed);
  const cache = new Map();
  return (x, y, z, y0 = 0, h = 1) => {
    const key = `${x},${y},${z}`;
    if (cache.has(key)) return cache.get(key);
    const c = typeof base === 'function' ? base(x, y, z) : base;
    if (c === null || c === undefined) return null;
    const t = h <= 1 ? 0.5 : (y - y0) / (h - 1);
    const n = R();
    const step = n < 0.2 ? -1 : n > 0.85 ? 1 : 0;
    const out = shade(c, 1 + Math.round((t - 0.5) * 4) / 4 * 2 * light + step * noise);
    cache.set(key, out);
    return out;
  };
}

/** A box of blocks painted with `p` (a colour, or a function from paint()), skipping nulls. */
function block(v, x, y, z, w, h, d, p, flags = 0) {
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) {
    const c = typeof p === 'function' ? p(x + i, y + j, z + k, y, h) : p;
    if (c !== null && c !== undefined) v.set(x + i, y + j, z + k, c, flags);
  }
  return v;
}

/** A new grid, drawn by `draw`. */
const vox = (draw) => { const v = new Vox(); draw(v); return v; };

// ------------------------------------------------------------------ skeletons

const DIMS = { legH: 12, legW: 4, hipX: 2, bodyW: 8, bodyH: 12, bodyD: 4, armW: 4, armH: 12, armOut: 0, headW: 8, headH: 8, headD: 8 };

/**
 * A humanoid. Each painter draws into a grid in its part's own space, given the sizes d:
 *   legs: x -legW/2.., y -legH..-1 (from the hip)     body: x -bodyW/2.., y 0..bodyH-1, z -bodyD/2..
 *   arms: x -armW/2.., y -(armH-2)..1 (from the shoulder)   head: x -headW/2.., y 0..headH-1, z -headD/2..
 * The face is the head's front layer (the front of what head() drew); faces: [{name, draw(v, d)}] draw it for
 * each face. extra: { head, body, root, armL, armR, legL, legR: [parts] } ride along.
 */
function humanoid(spec) {
  const d = { ...DIMS, ...(spec.dims || {}) };
  const { head, body, arm, armL = arm, armR = arm, leg, legL = leg, legR = leg, faces = null, extra = {}, scale = 1 } = spec;
  const H = vox((v) => head(v, d));
  // the face is the front layer of what the head painter drew
  const frontZ = Math.max(...[...H.cells.values()].filter((c) => c.y < d.headH && c.y >= 0).map((c) => c.z));
  let faceParts = [];
  let front = null;
  if (faces) {
    const layers = faces.map((f) => vox((v) => f.draw(v, d)));
    for (const c of [...H.cells.values()]) if (c.z === frontZ && c.y < d.headH) H.set(c.x, c.y, c.z, null);
    faceParts = layers.map((v, i) => part({ when: { face: i }, vox: v, occlude: H }));
    front = layers[0];
  }
  const ax = d.bodyW / 2 + d.armW / 2 + d.armOut;
  const parts = [
    part({ p: [d.hipX, d.legH, 0], k: 'legL', vox: vox((v) => legL(v, d, 1)), c: extra.legL || [] }),
    part({ p: [-d.hipX, d.legH, 0], k: 'legR', vox: vox((v) => legR(v, d, -1)), c: extra.legR || [] }),
    part({
      p: [0, d.legH, 0], k: 'body', vox: vox((v) => body(v, d)),
      c: [
        part({ p: [ax, d.bodyH - 2, 0], k: 'armL', vox: vox((v) => armL(v, d, 1)), c: extra.armL || [] }),
        part({ p: [-ax, d.bodyH - 2, 0], k: 'armR', vox: vox((v) => armR(v, d, -1)), c: extra.armR || [] }),
        part({ p: [0, d.bodyH, 0], k: 'head', vox: H, occlude: front, c: [...faceParts, ...(extra.head || [])] }),
        ...(extra.body || []),
      ],
    }),
    ...(extra.root || []),
  ];
  return scale === 1 ? parts : [part({ s: scale, c: parts })];
}

/** How tall a humanoid stands, in pixels. */
const tall = (dims = {}, scale = 1) => { const d = { ...DIMS, ...dims }; return Math.round((d.legH + d.bodyH + d.headH) * scale); };

/**
 * A four-legged body, facing +z. The back legs walk with the legL/legR roles and the front ones with
 * armL/armR (a trot: each back leg moves with the opposite front one). Painters draw in their part's
 * space: body x -w/2.., y 0..h-1, z -len/2..; legs from the hip down (y -legH..-1); the head from its
 * neck point (y up, z forward); extra: { head, body, root, tail: [parts] }.
 */
function quadruped(spec) {
  const { len = 12, w = 8, h = 7, legH = 8, legW = 3, neck = [0, 5, 0], head, body, leg, front = leg, back = leg, extra = {}, scale = 1 } = spec;
  const lx = w / 2 - legW / 2;
  const lz = len / 2 - legW / 2 - 0.5;
  const parts = [
    part({ p: [lx, legH, -lz], k: 'legL', vox: vox((v) => back(v, 1)) }),
    part({ p: [-lx, legH, -lz], k: 'legR', vox: vox((v) => back(v, -1)) }),
    part({ p: [lx, legH, lz], k: 'armR', vox: vox((v) => front(v, 1)) }),
    part({ p: [-lx, legH, lz], k: 'armL', vox: vox((v) => front(v, -1)) }),
    part({
      p: [0, legH, 0], vox: vox((v) => body(v)),
      c: [
        part({ p: [neck[0], neck[1], len / 2 + neck[2]], k: 'head', vox: vox((v) => head(v)), c: extra.head || [] }),
        ...(extra.tail ? [part({ p: [0, h - 2, -len / 2], k: 'tail', c: extra.tail })] : []),
        ...(extra.body || []),
      ],
    }),
    ...(extra.root || []),
  ];
  return scale === 1 ? parts : [part({ s: scale, c: parts })];
}

/** A plain leg for a quadruped, with a paw or hoof of another paint. */
const paw = (p, end, { legH = 8, legW = 3 } = {}) => (v) => block(v, -legW / 2, -legH, -legW / 2, legW, legH, legW, (x, y, z, y0, hh) => (end && y < -legH + 2 ? end(x, y, z, y0, hh) : p(x, y, z, y0, hh)));

/** Plain limbs: a painted box, the end (hand, boot) another paint. */
const armBox = (top, hand = null) => (v, d) => block(v, -d.armW / 2, -(d.armH - 2), -2, d.armW, d.armH, 4, (x, y, z, y0, h) => (hand && y <= -(d.armH - 4) ? hand(x, y, z, y0, h) : top(x, y, z, y0, h)));
const legBox = (top, boot = null) => (v, d) => block(v, -d.legW / 2, -d.legH, -2, d.legW, d.legH, 4, (x, y, z, y0, h) => (boot && y <= -d.legH + 3 ? boot(x, y, z, y0, h) : top(x, y, z, y0, h)));
const headBox = (p) => (v, d) => block(v, -d.headW / 2, 0, -d.headD / 2, d.headW, d.headH, d.headD, p);
const bodyBox = (p) => (v, d) => block(v, -d.bodyW / 2, 0, -d.bodyD / 2, d.bodyW, d.bodyH, d.bodyD, p);

// ------------------------------------------------------------------ things to carry and wear

/** A shoulder plate over an arm (a child of the arm), sticking out and up. */
const pauldron = (p, side, { w = 6, h = 3, d = 6 } = {}) => part({ p: [side, 1, 0], vox: vox((v) => {
  block(v, -w / 2 + side, 0, -d / 2, w, h, d, p);
  block(v, -w / 2 + side + (side > 0 ? 1 : 0), h, -d / 2 + 1, w - 1, 1, d - 2, p);
}) });

/** A cape hanging from the shoulders (a child of the body), swaying and lifting as you run. */
const cape = (p, { w = 8, h = 15, trim = null } = {}) => part({
  p: [0, 11, -2], k: 'lean', r: [6, 0, 0], a: [sway('x', 4, 0.5)],
  vox: vox((v) => block(v, -w / 2, -h, -1, w, h, 1, (x, y, z, y0, hh) => (trim && (y === -h || x === -w / 2 || x === w / 2 - 1) ? trim : p(x, y, z, y0, hh)))),
});

/** A sword held in the right hand (a child of armR), pointing ahead. */
const sword = ({ blade = 0xdfe6f0, edge = null, grip = 0x5a3a1c, guard = 0xffd24a, len = 12 } = {}) => part({
  p: [0, -9, 0.5], r: [90, 0, 0],
  vox: vox((v) => {
    block(v, 0, -2, 0, 1, 3, 1, grip);
    block(v, -1, 1, 0, 3, 1, 1, guard);
    v.set(0, -3, 0, guard);
    block(v, 0, 2, 0, 1, len, 1, blade, edge ? GLOW : 0);
    if (edge) for (let i = 2; i < len + 1; i += 3) v.set(0, i, 1, edge, GLOW);
  }),
});

/** A staff in the right hand, with a glowing gem on top. */
const staff = (wood, gem) => part({
  p: [0, -9, 1], r: [-12, 0, 0],
  vox: vox((v) => { block(v, 0, -6, 0, 1, 20, 1, wood); v.sphere(0.5, 15.5, 0.5, 1.7, gem, GLOW); }),
});

/** A round shield on the left arm. */
const shield = (face, rim, emblem = null) => part({
  p: [2, -5, 0], r: [0, 90, 0],
  vox: vox((v) => {
    for (let x = -4; x <= 4; x++) for (let y = -5; y <= 5; y++) {
      const r = Math.hypot(x / 4.5, y / 5.5);
      if (r <= 1) v.set(x, y, 0, r > 0.8 ? rim : emblem && emblem(x, y) ? emblem(x, y) : face);
    }
  }),
});

/** Wings on the back (children of the body): feathered or leathery, flapping slowly. */
function wings(colour, tip, { span = 12, leather = false, speed = 0.6, glow = false } = {}) {
  const one = (s) => vox((v) => {
    for (let i = 0; i < span; i++) {
      const hgt = Math.round((leather ? 9 : 11) * Math.sin(((i + 1) / (span + 1)) * Math.PI * 0.9) + 2);
      for (let j = 0; j < hgt; j++) {
        const y = j - Math.floor(hgt * 0.35) - (leather ? Math.round((i % 3 === 2 ? 1 : 0)) : 0);
        const c = j === hgt - 1 || i === span - 1 ? tip : colour;
        if (leather && j < hgt - 1 && i % 3 === 2) continue;
        v.set(s * (i + 1), y, -i * 0.15, c, glow ? GLOW : 0);
      }
    }
  });
  return [
    part({ p: [1.5, 8, -2.5], r: [0, 18, 0], a: [flap('y', -26, speed)], vox: one(1) }),
    part({ p: [-1.5, 8, -2.5], r: [0, -18, 0], a: [flap('y', 26, speed)], vox: one(-1) }),
  ];
}

/** A tail from the back of the hips (a child of the body), wagging faster as you run. */
const tail = (p, { len = 8, up = 0.3, thick = 2, tip = null } = {}) => part({
  p: [0, 1, -2], k: 'tail',
  vox: vox((v) => { for (let i = 0; i < len; i++) block(v, -Math.floor(thick / 2), Math.round(i * up) - 1, -i - 1, thick, thick, 1, tip && i >= len - 2 ? tip : p); }),
});

// ------------------------------------------------------------------ the models

const EYE = 0x14141c;

// ---- Knight: a bucket helm with a plume, shoulder plates, a tabard, sword, shield and cape
{
  const steel = paint((x, y) => (y % 4 === 0 ? 0xaab3c0 : 0xd4dae4), { seed: 3, light: 0.16 });
  const dark = paint(0x5d6576, { seed: 4 });
  const blue = paint(0x2a5bd7, { seed: 6 });
  const gold = 0xffd24a;
  const d = { headW: 9, headH: 9, headD: 9, bodyD: 5 };
  model('knight', 'Knight', 'legendary', 'Full plate from helm to boots, a sword in hand, a shield on the arm and a blue cape behind.', humanoid({
    dims: d,
    head: (v) => {
      block(v, -5, 0, -5, 9, 9, 9, steel);
      for (let x = -4; x <= 3; x++) v.set(x, 5, 3, EYE); // the visor slit
      for (const x of [-2, 0, 2]) for (const y of [2, 3]) v.set(x - 1, y, 3, 0x2a2e38);
      block(v, -1, 0, 3, 1, 5, 1, 0xeef2f7);
      block(v, -5, 9, -1, 9, 1, 2, dark); // the ridge
    },
    body: (v) => {
      block(v, -4, 0, -2.5, 8, 12, 5, steel);
      block(v, -3, 1, 2, 6, 10, 1, (x, y) => (x === -1 || y === 7 ? gold : blue(x, y, 2))); // the tabard and its cross
      block(v, -4, 0, -2.5, 8, 1, 5, 0x6b4423);
      v.set(-1, 0, 2, gold);
    },
    arm: armBox(steel, dark),
    leg: legBox(steel, dark),
    extra: {
      head: [part({ p: [0, 10, 0], a: [sway('x', 9, 0.55)], vox: vox((v) => { for (let i = 0; i < 7; i++) block(v, -1, i - Math.floor(i * i / 9), -i, 2, 2, 1, shade(0x2f6fdf, 1.15 - i * 0.05)); }) })],
      armL: [pauldron(steel, 1), shield(0x2a5bd7, 0xaab3c0, (x, y) => (x === 0 || y === 0 ? gold : null))],
      armR: [pauldron(steel, -1), sword({ edge: null, len: 13 })],
      body: [cape(blue, { w: 8, h: 18, trim: gold })],
    },
  }), { h: tall(d) + 2 });
}

// ---- Robot: a screen for a face (six of them), a chest display, claws and an antenna
{
  const shell = paint((x, y) => (y === 0 ? 0x6b7385 : 0xa6afc0), { seed: 11, light: 0.2 });
  const joint = paint(0x3a3f4c, { seed: 12 });
  const led = 0x5ff2ff;
  const d = { headW: 10, headH: 8, headD: 9, bodyW: 10, bodyD: 6, hipX: 2.5, legW: 5, armW: 4, armOut: 0.5 };
  const F = (rows) => (v) => {
    block(v, -5, 0, 3, 10, 8, 1, (x, y) => (x === -5 || x === 4 || y === 0 || y === 7 ? 0x8b93a5 : 0x081018));
    v.art(rows, { o: [led, GLOW], r: [0xff4060, GLOW], p: [0xff7ad9, GLOW], y: [0xffd23a, GLOW] }, { x: 0, y: 1, z: 3 });
  };
  const faces = [
    { name: 'Happy', draw: F(['        ', '  o  o  ', '  o  o  ', '        ', ' o    o ', '  oooo  ']) },
    { name: 'Sad', draw: F(['        ', '  o  o  ', '  o  o  ', '        ', '  oooo  ', ' o    o ']) },
    { name: 'Angry', draw: F([' r    r ', '  r  r  ', '  r  r  ', '        ', '  rrrr  ', ' r    r ']) },
    { name: 'Love', draw: F([' pp pp  ', 'pppppppp', ' pppppp ', '  pppp  ', '   pp   ', '        ']) },
    { name: 'Error', draw: F(['r r  r r', ' r    r ', 'r r  r r', '        ', ' rrrrrr ', '        ']) },
    { name: 'Thinking', draw: F(['     yy ', '  o   y ', '  o  y  ', '     y  ', '        ', '  ooo   ']) },
  ];
  model('robot', 'Robot', 'legendary', 'A friendly robot with a screen for a face. Its power: six faces on the screen.', humanoid({
    dims: d,
    head: (v) => { block(v, -5, 0, -5, 10, 8, 9, shell); block(v, -6, 2, -2, 1, 4, 3, joint); block(v, 5, 2, -2, 1, 4, 3, joint); },
    faces,
    body: (v) => {
      block(v, -5, 0, -3, 10, 12, 6, shell);
      block(v, -3, 4, 2, 6, 5, 1, (x, y) => (y === 4 || y === 8 || x === -3 || x === 2 ? 0x3a3f4c : (x + y) % 3 ? 0x22d3ee : 0x0b2030), GLOW);
      block(v, -2, 6, -4, 4, 6, 1, joint); // a battery pack on the back
      block(v, -1, 7, -5, 2, 4, 1, 0x34d399, GLOW);
    },
    arm: (v) => { block(v, -2, -9, -2, 4, 11, 4, (x, y, z, y0, h) => (y === -4 ? joint(x, y, z) : shell(x, y, z, y0, h))); block(v, -2, -11, -2, 1, 2, 4, joint); block(v, 1, -11, -2, 1, 2, 4, joint); },
    leg: (v) => { block(v, -2.5, -12, -2, 5, 12, 4, (x, y, z, y0, h) => (y === -6 ? joint(x, y, z) : shell(x, y, z, y0, h))); block(v, -2.5, -12, 2, 5, 2, 1, joint); },
    extra: {
      head: [part({ p: [0, 8, 0], a: [sway('z', 14, 0.8)], vox: new Vox().box(0, 0, 0, 1, 4, 1, 0x6b7385).box(-1, 4, -1, 3, 2, 3, 0xff4060, GLOW) })],
    },
  }), { faces, h: tall(d) + 5 });
}

// ---- Ninja: lean, hooded, a long red scarf streaming behind and a katana across the back
{
  const cloth = paint(0x1f2230, { seed: 21, noise: 0.03 });
  const wrap = paint(0x3a3e50, { seed: 22 });
  const red = paint(0xd02030, { seed: 23 });
  model('ninja', 'Ninja', 'legendary', 'Hooded and masked, a katana on the back and a red scarf streaming behind. Its power: a smoke bomb.', humanoid({
    dims: { bodyW: 7, armW: 3, armOut: 0 },
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, cloth);
      block(v, -3, 3, 3, 6, 2, 1, 0xe0b48a);
      v.set(-2, 4, 3, EYE).set(1, 4, 3, EYE).set(-2, 3, 3, 0x5a3a28).set(1, 3, 3, 0x5a3a28);
      block(v, -4, 6, -4, 8, 1, 8, red);
      block(v, -4, 8, -3, 8, 1, 6, cloth); // the hood
      block(v, -3, 0, -5, 6, 7, 1, cloth);
    },
    body: (v) => { block(v, -3.5, 0, -2, 7, 12, 4, cloth); block(v, -3.5, 0, -2, 7, 2, 4, red); for (let i = 0; i < 6; i++) v.set(-3 + i, 11 - i * 2, 1, wrap(0, 0, 0)); },
    arm: armBox(cloth, wrap),
    leg: legBox(cloth, wrap),
    extra: {
      head: [part({ p: [0, 6.5, -4], k: 'tail', a: [sway('y', 16, 0.9), sway('x', 7, 1.4)], vox: vox((v) => { for (let i = 0; i < 12; i++) block(v, i % 3 === 0 ? -1 : 0, -Math.floor(i / 2.2), -i - 1, 2, 1, 1, red); }) })],
      body: [part({ p: [0, 6, -2.5], r: [0, 0, 40], vox: vox((v) => { block(v, 0, -8, 0, 1, 4, 1, 0x2a1a10); block(v, -1, -4, 0, 3, 1, 1, 0xffd24a); block(v, 0, -3, 0, 1, 13, 1, 0xdfe6f0); }) })],
    },
  }), { power: 'Smoke bomb', effects: [fx('smoke', { at: [0, 16, 0], rate: 45, v: [0, 2, 0], sp: -18, life: 1.4, c: [0x2a2d3a, 0x4a4d5a, 0x6b7080], glow: false, when: { power: 1 } })] });
}

// ---- Astronaut: a glass helmet with a gold visor, a life-support pack, and a jetpack power
{
  const suit = paint(0xeef1f6, { seed: 31, light: 0.14 });
  const grey = paint(0x9aa3b5, { seed: 32 });
  const orange = paint(0xff7a1a, { seed: 33 });
  const d = { headW: 10, headH: 10, headD: 10, bodyD: 5, bodyW: 9, armW: 4.5 };
  model('astronaut', 'Astronaut', 'legendary', 'A spacesuit with a gold-visored glass helmet and a life-support pack. Its power: the jetpack fires.', humanoid({
    dims: d,
    head: (v) => {
      // a glass bubble with a gold visor across the front, the face dark inside
      v.sphere(0, 4.5, 0, 5, (x, y, z, dx, dy, dz) => (dz > 0.35 && dy > -0.45 && dy < 0.55 ? 0xffc23a : alpha(0xd8ecff, 0.45)), 0, 5, 5);
      for (const c of [...v.cells.values()]) if (c.c === 0xffc23a) v.set(c.x, c.y, c.z, 0xffc23a, GLOW);
      else v.set(c.x, c.y, c.z, c.c, SEE);
      block(v, -4, -1, -4, 8, 1, 8, grey);
    },
    body: (v) => {
      block(v, -4.5, 0, -2.5, 9, 12, 5, suit);
      block(v, -3, 5, 2, 6, 4, 1, (x, y) => (y === 8 ? 0x3a3f4c : x < 0 ? 0xff4060 : x < 2 ? 0x22d3ee : 0x34d399), GLOW); // the chest panel
      block(v, -4.5, 10, -2.5, 9, 1, 5, orange);
      block(v, -4, 1, -6, 8, 10, 3, grey); // the pack
      block(v, -3, 2, -7, 2, 7, 1, 0xd0d6e0).set(1, 2, -7, 0xd0d6e0);
      block(v, 1, 2, -7, 2, 7, 1, 0xd0d6e0);
    },
    arm: armBox(suit, grey),
    leg: legBox(suit, grey),
    extra: { armL: [part({ p: [0, -3, 2.2], vox: vox((v) => block(v, -1, 0, 0, 2, 2, 1, 0x22d3ee, GLOW)) })] },
  }), {
    h: tall(d), power: 'Jetpack',
    effects: [
      fx('ember', { at: [-2, 13, -6], rate: 40, v: [0, -22, -2], sp: 3, life: 0.45, g: -10, c: [0xffd35c, 0xff7a1a, 0xffffff], when: { power: 1 } }),
      fx('ember', { at: [2, 13, -6], rate: 40, v: [0, -22, -2], sp: 3, life: 0.45, g: -10, c: [0xffd35c, 0xff7a1a, 0xffffff], when: { power: 1 } }),
      fx('smoke', { at: [0, 10, -6], rate: 14, v: [0, -6, -2], sp: 4, life: 1.2, c: [0xc8ccd6, 0xe8ebf0], glow: false, when: { power: 1 } }),
    ],
  });
}

// ---- Wizard: a tall bent hat with stars, a long white beard, a robe to the floor and a staff
{
  const robe = paint((x, y, z) => ((x * 7 + y * 13 + z * 5) % 23 === 0 ? 0xffe27a : 0x4b2fd6), { seed: 41, light: 0.14 });
  const hat = paint((x, y, z) => ((x * 5 + y * 11 + z * 3) % 19 === 0 ? 0xffe27a : 0x3b23b0), { seed: 42 });
  const beard = paint(0xf3f3f6, { seed: 43, noise: 0.05 });
  const skin = paint(0xe7b88f, { seed: 44 });
  model('wizard', 'Wizard', 'mythic', 'A starry robe, a hat that bends at the tip, a beard to the belt and a staff with a glowing gem. Its power: magic that swirls round you.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      block(v, -4, 4, -4, 8, 4, 8, (x, y, z) => (z >= 2 ? null : 0xe8e8ee)); // white hair behind
      v.set(-2, 4, 3, EYE).set(1, 4, 3, EYE);
      block(v, -3, 5, 3, 2, 1, 1, 0xf3f3f6).set(0, 5, 3, 0xf3f3f6).set(1, 5, 3, 0xf3f3f6);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, robe); block(v, -4, 4, -2, 8, 1, 4, 0xffd24a); },
    arm: armBox(robe, skin),
    leg: (v) => block(v, -2, -12, -2, 4, 12, 4, robe),
    extra: {
      head: [
        part({ p: [0, 7, 0], vox: vox((v) => {
          block(v, -6, 0, -6, 12, 1, 12, hat);
          for (let i = 0; i < 9; i++) { const r = Math.max(1, 4 - Math.floor(i / 2.2)); block(v, -r, i + 1, -r - (i > 5 ? i - 5 : 0), r * 2, 1, r * 2, hat); }
          v.set(-1, 10, -6, 0xffe27a, GLOW);
        }) }),
        part({ p: [0, 1, 4], a: [sway('x', 4, 0.4)], vox: vox((v) => { for (let y = 0; y < 9; y++) { const w = y < 3 ? 6 : y < 6 ? 4 : 2; block(v, -w / 2, -y, 0, w, 1, 1, beard); } }) }),
      ],
      armR: [staff(paint(0x6b4423, { seed: 45 }), 0x7cf5ff)],
      root: [part({ p: [0, 0, 0], vox: vox((v) => block(v, -5, 0, -3, 10, 3, 6, robe)) })],
    },
  }), {
    h: 44, power: 'Magic',
    effects: [
      fx('star', { at: [0, 18, 0], rate: 18, v: [0, 3, 0], sp: -12, life: 1.2, c: [0xffe27a, 0x7cf5ff, 0xc084fc], when: { power: 1 } }),
      fx('spark', { at: [-6, 30, 4], rate: 10, v: [0, 4, 0], sp: 3, life: 0.8, c: [0x7cf5ff, 0xffffff] }),
    ],
  });
}

// ---- Demon: red skin, curling horns, bat wings, a spade-tipped tail and glowing eyes
{
  const skin = paint(0xb3202c, { seed: 51, light: 0.16 });
  const dark = paint(0x5c0a12, { seed: 52 });
  const horn = paint((x, y) => shade(0x2a1a1a, 1 + y * 0.06), { seed: 53 });
  model('demon', 'Demon', 'mythic', 'Red as embers, with curling horns, bat wings and a spade-tipped tail. Its power: hellfire.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      v.set(-3, 4, 3, 0xffd23a, GLOW).set(-2, 4, 3, 0xffd23a, GLOW).set(1, 4, 3, 0xffd23a, GLOW).set(2, 4, 3, 0xffd23a, GLOW);
      block(v, -3, 5, 3, 2, 1, 1, dark).set(1, 5, 3, dark(0, 0, 0)).set(2, 5, 3, dark(0, 0, 0));
      for (let x = -2; x <= 1; x++) v.set(x, 1, 3, EYE);
      v.set(-2, 2, 3, 0xffffff).set(1, 2, 3, 0xffffff);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, skin); block(v, -4, 0, -2, 8, 3, 4, dark); for (const y of [5, 7, 9]) { v.set(-2, y, 1, dark(0, 0, 0)); v.set(1, y, 1, dark(0, 0, 0)); } },
    arm: armBox(skin, dark),
    leg: legBox(dark, paint(0x1c0a0c, { seed: 54 })),
    extra: {
      head: [-1, 1].map((s) => part({ p: [s * 3, 7, 0], vox: vox((v) => { for (let i = 0; i < 7; i++) block(v, s * Math.round(i * 0.6) - (s < 0 ? 1 : 0), i, -Math.round(i * i * 0.08), i < 4 ? 2 : 1, 1, i < 4 ? 2 : 1, horn); }) })),
      body: [...wings(0x5c0a12, 0x2a050a, { span: 11, leather: true, speed: 0.5 }), tail(skin, { len: 9, up: 0.25, thick: 1, tip: 0x5c0a12 })],
    },
  }), {
    h: 39, power: 'Hellfire',
    effects: [
      fx('ember', { at: [0, 2, 0], rate: 36, v: [0, 10, 0], sp: -9, life: 0.8, g: 4, c: [0xffb23f, 0xff5a1a, 0xff2a10], when: { power: 1 } }),
      fx('smoke', { at: [0, 4, 0], rate: 10, v: [0, 6, 0], sp: -8, life: 1.4, c: [0x2a1414, 0x3a2020], glow: false, when: { power: 1 } }),
    ],
  });
}

// ---- Angel: a white robe, a golden halo floating above and great feathered wings
{
  const robe = paint(0xf4f4fa, { seed: 61, light: 0.1 });
  const gold = paint(0xffd24a, { seed: 62 });
  const skin = paint(0xf2c9a0, { seed: 63 });
  const hair = paint(0xffe9a8, { seed: 64 });
  model('angel', 'Angel', 'mythic', 'A white robe, golden hair, a halo floating above and wings that beat slowly. Its power: heavenly light.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      block(v, -4, 5, -4, 8, 3, 8, hair);
      block(v, -4, 0, -4, 8, 5, 2, hair);
      v.set(-2, 4, 3, 0x3a7bd5).set(1, 4, 3, 0x3a7bd5).set(-2, 3, 3, 0xffffff).set(1, 3, 3, 0xffffff);
      v.set(-1, 1, 3, 0xd98a8a).set(0, 1, 3, 0xd98a8a);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, robe); block(v, -4, 2, -2, 8, 1, 4, gold); block(v, -1, 3, 1, 2, 9, 1, gold); },
    arm: armBox(robe, skin),
    leg: (v) => block(v, -2, -12, -2, 4, 12, 4, robe),
    extra: {
      head: [part({ p: [0, 10.5, 0], a: [bob(0.6, 0.5), spin('y', 40)], vox: vox((v) => v.ring(0, 0, 0, 4, 1.2, 0xffe27a, GLOW)) })],
      body: wings(0xffffff, 0xe6ecf5, { span: 14, speed: 0.4 }),
      root: [part({ vox: vox((v) => block(v, -5, 0, -3, 10, 2, 6, robe)) })],
    },
  }), { h: 40, power: 'Heavenly light', effects: [fx('star', { at: [0, 20, 0], rate: 14, v: [0, 4, 0], sp: -14, life: 1.4, c: [0xffe27a, 0xffffff], when: { power: 1 } }), fx('spark', { at: [0, 34, 0], rate: 6, v: [0, 2, 0], sp: 4, life: 0.8, c: [0xffe27a] })] });
}

// ---- Skeleton Lord: bones with gaps between them, a crown, and eyes like coals
{
  const bone = paint(0xe8e4d4, { seed: 71, light: 0.12 });
  const dark = 0x1a1814;
  const d = { armW: 2, legW: 2, bodyW: 8, armOut: 1 };
  model('skeleton_lord', 'Skeleton Lord', 'mythic', 'All bone, ribs and all, with a golden crown and red coals for eyes. Its power: blue soul fire.', humanoid({
    dims: d,
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, bone);
      block(v, -3, 3, 3, 2, 2, 1, dark); block(v, 1, 3, 3, 2, 2, 1, dark);
      v.set(-2, 3, 3, 0xff3020, GLOW).set(1, 3, 3, 0xff3020, GLOW);
      v.set(-1, 2, 3, dark).set(0, 2, 3, dark);
      for (let x = -3; x <= 2; x++) v.set(x, 0, 3, x % 2 ? dark : bone(x, 0, 3));
    },
    body: (v) => {
      // a spine, and ribs with gaps
      block(v, -0.5, 0, -1, 1, 12, 1, bone);
      for (const y of [4, 6, 8, 10]) block(v, -3, y, -2, 6, 1, 4, (x, yy, z) => (z === -2 && Math.abs(x) < 1 ? null : z > -2 && z < 1 && Math.abs(x + 0.5) < 2.5 ? null : bone(x, yy, z)));
      block(v, -3, 0, -1, 6, 2, 2, bone);
    },
    arm: (v) => block(v, -1, -10, -1, 2, 12, 2, bone),
    leg: (v) => block(v, -1, -12, -1, 2, 12, 2, bone),
    extra: {
      head: [part({ p: [0, 8, 0], vox: vox((v) => { block(v, -4, 0, -4, 8, 1, 8, 0xe8a317); for (const [x, z] of [[-4, -4], [3, -4], [-4, 3], [3, 3], [-1, 3], [-1, -4], [3, -1], [-4, -1]]) v.set(x, 1, z, 0xffd24a); v.set(-1, 1, 3, 0xff3b5c, GLOW); }) })],
    },
  }), { power: 'Soul fire', effects: [fx('ember', { at: [0, 4, 0], rate: 30, v: [0, 9, 0], sp: -8, life: 0.9, g: 3, c: [0x5ff2ff, 0x2a7fff, 0xffffff], when: { power: 1 } })] });
}

// ---- Pumpkin King: a glowing carved pumpkin for a head (four faces), a black suit and a vine collar
{
  const pumpkin = paint((x) => (x % 2 === 0 ? 0xf08a1a : 0xd96f0a), { seed: 81, light: 0.16 });
  const suit = paint(0x1c1e26, { seed: 82 });
  const vine = paint(0x3f7a2a, { seed: 83 });
  const glow = 0xffd35c;
  const d = { headW: 10, headH: 9, headD: 10 };
  const F = (rows) => (v) => { block(v, -5, 0, 4, 10, 9, 1, pumpkin); v.art(rows, { o: [glow, GLOW], O: [0xfff1a8, GLOW] }, { x: 0, y: 0, z: 4 }); };
  const faces = [
    { name: 'Grin', draw: F(['          ', ' oo    oo ', ' oO    Oo ', '          ', '    oo    ', '          ', ' o oooo o ', '  oOOOOo  ', '          ']) },
    { name: 'Scary', draw: F(['          ', ' o      o ', ' oo    oo ', ' ooo  ooo ', '          ', ' oooooooo ', ' o o  o o ', '  o oo o  ', '          ']) },
    { name: 'Surprised', draw: F(['          ', '  oo  oo  ', '  oO  Oo  ', '  oo  oo  ', '          ', '    oo    ', '   oOOo   ', '    oo    ', '          ']) },
    { name: 'Sleepy', draw: F(['          ', '          ', ' ooo  ooo ', '          ', '          ', '   oooo   ', '          ', '          ', '          ']) },
  ];
  model('pumpkin_king', 'Pumpkin King', 'mythic', 'A carved pumpkin for a head, lit from inside, a black suit and a collar of vines. Its powers: four carved faces, and candlelight.', humanoid({
    dims: d,
    head: (v) => { block(v, -5, 0, -5, 10, 9, 10, pumpkin); },
    faces,
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, suit); block(v, -1, 4, 1, 2, 8, 1, 0xe8e8ee); block(v, -1, 9, 2, 2, 2, 1, 0xf08a1a); },
    arm: armBox(suit, paint(0xf2f2f6, { seed: 84 })),
    leg: legBox(suit, paint(0x0c0c10, { seed: 85 })),
    extra: {
      head: [part({ p: [0, 9, 0], vox: vox((v) => { block(v, -1, 0, -1, 2, 3, 2, vine); block(v, 1, 2, -1, 2, 1, 1, vine); }) })],
      body: [part({ p: [0, 11, 0], vox: vox((v) => { for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; v.set(Math.round(Math.cos(a) * 4.6) - 0.5, (i % 3) - 1, Math.round(Math.sin(a) * 3), i % 4 ? vine(i, 0, 0) : 0x7ac04a); } }) })],
    },
  }), { faces, h: tall(d), power: 'Candlelight', effects: [fx('ember', { at: [0, 30, 5], rate: 10, v: [0, 4, 2], sp: 2, life: 0.8, c: [0xffd35c, 0xff9a1a], when: { power: 1 } }), fx('spark', { at: [0, 34, 0], rate: 6, v: [0, 6, 0], sp: 2, life: 1, c: [0xffd35c], when: { power: 1 } })] });
}

// ---- Iron Giant: half again as big, huge shoulders and fists, vines and glowing eyes
{
  const iron = paint((x, y) => (y % 5 === 0 ? 0xb9b4ac : 0xd6d1c8), { seed: 91, light: 0.16 });
  const vine = paint(0x3f7a2a, { seed: 92 });
  const d = { bodyW: 12, bodyD: 7, armW: 5, legW: 5, hipX: 3, headW: 8, headH: 9, headD: 8, armH: 17, armOut: 0 };
  model('iron_giant', 'Iron Giant', 'legendary', 'Half again as tall as you, with shoulders like an iron golem, arms to its knees and glowing eyes.', humanoid({
    dims: d,
    scale: 1.3,
    head: (v) => {
      block(v, -4, 0, -4, 8, 9, 8, iron);
      block(v, -3, 4, 3, 6, 1, 1, 0x4a4640);
      v.set(-2, 5, 3, 0xff5030, GLOW).set(1, 5, 3, 0xff5030, GLOW);
      block(v, -1, 1, 4, 2, 4, 1, iron); // the nose
    },
    body: (v) => { block(v, -6, 0, -3.5, 12, 12, 7, iron); for (let y = 2; y < 12; y += 3) v.set(-5 + (y % 7), y, 3, vine(0, y, 0)).set(-4 + (y % 7), y - 1, 3, vine(1, y, 0)); },
    arm: (v) => block(v, -2.5, -15, -2.5, 5, 17, 5, (x, y, z, y0, h) => (y < -12 ? shade(0xa8a39b, 1) : iron(x, y, z, y0, h))),
    leg: (v) => block(v, -2.5, -12, -2.5, 5, 12, 5, iron),
  }), { h: tall(d, 1.3) });
}

// ---- Samurai: red lacquered armour in plates, a horned golden crest, a mask and a katana
{
  const red = paint((x, y) => (y % 3 === 0 ? 0x7a1010 : 0xb81c1c), { seed: 101, light: 0.12 });
  const black = paint(0x22222a, { seed: 102 });
  const gold = 0xffc23a;
  const d = { headW: 9, headH: 8, headD: 9 };
  model('samurai', 'Samurai', 'legendary', 'Red lacquered armour in plates, a golden horned crest, a war mask and a katana at the ready.', humanoid({
    dims: d,
    head: (v) => {
      block(v, -5, 0, -5, 9, 8, 9, black);
      block(v, -5, 5, -5, 9, 3, 9, red); // the helmet
      block(v, -4, 0, 3, 7, 4, 1, (x, y) => (y === 2 ? null : 0x3a1010)); // the mask, with a slit
      v.set(-3, 2, 3, 0xffd23a, GLOW).set(1, 2, 3, 0xffd23a, GLOW);
      block(v, -6, 4, -5, 1, 3, 9, red); block(v, 4, 4, -5, 1, 3, 9, red); // side flaps
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, red); for (let y = 0; y < 12; y += 3) block(v, -4, y, 2, 8, 1, 1, black); block(v, -4, 0, -2, 8, 2, 4, black); },
    arm: armBox(red, black),
    leg: (v) => { block(v, -2, -12, -2, 4, 12, 4, black); block(v, -2.5, -6, -2.5, 5, 6, 5, red); },
    extra: {
      head: [part({ p: [0, 8, 3], vox: vox((v) => { for (let i = 0; i < 6; i++) { v.set(-1 - i, i, 0, gold); v.set(i, i, 0, gold); } block(v, -1, 0, 0, 2, 2, 1, gold); }) })],
      armL: [pauldron(red, 1, { w: 6, h: 4, d: 6 })],
      armR: [pauldron(red, -1, { w: 6, h: 4, d: 6 }), sword({ blade: 0xeef2f7, grip: 0x1c1c22, guard: 0xffc23a, len: 15 })],
    },
  }), { h: tall(d) + 6 });
}

// ---- Viking: a horned helm, a braided red beard, furs on the shoulders and a round shield
{
  const fur = paint(0x7a5634, { seed: 111, noise: 0.08 });
  const tunic = paint(0x2f5d8a, { seed: 112 });
  const skin = paint(0xe6b48c, { seed: 113 });
  const beard = paint(0xc0561c, { seed: 114 });
  const steel = paint(0x9aa3b5, { seed: 115 });
  model('viking', 'Viking', 'legendary', 'A horned helm, a braided red beard, furs over the shoulders and a painted round shield.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      block(v, -4, 5, -4, 8, 3, 8, steel);
      block(v, -1, 2, 3, 2, 3, 1, steel); // the nose guard
      v.set(-3, 4, 3, EYE).set(2, 4, 3, EYE);
      block(v, -4, 0, 3, 8, 2, 1, beard).set(-4, 2, 3, beard(0, 0, 0)).set(3, 2, 3, beard(0, 0, 0));
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, tunic); block(v, -4, 0, -2, 8, 2, 4, 0x5a3a1c); v.set(-1, 0, 2, 0xb0b8c4); },
    arm: armBox(skin, fur),
    leg: legBox(paint(0x5a4a3a, { seed: 116 }), fur),
    extra: {
      head: [
        ...[-1, 1].map((s) => part({ p: [s * 4, 6, 0], vox: vox((v) => { for (let i = 0; i < 5; i++) v.set(s * (i > 2 ? 2 : i), i, 0, i > 3 ? 0xe8e4d4 : 0xd8d0b8); }) })),
        part({ p: [0, 0, 4], a: [sway('x', 4, 0.5)], vox: vox((v) => { block(v, -3, -4, 0, 6, 4, 1, beard); block(v, -2, -7, 0, 1, 3, 1, beard); block(v, 1, -7, 0, 1, 3, 1, beard); v.set(-2, -8, 0, 0xffd24a).set(1, -8, 0, 0xffd24a); }) }),
      ],
      body: [part({ p: [0, 11, 0], vox: vox((v) => block(v, -5, 0, -3, 10, 2, 6, fur)) })],
      armL: [shield(0xc0302a, 0x6b4423, (x, y) => (Math.abs(x) + Math.abs(y) < 3 ? 0xf2e6c8 : (x * y) % 3 === 0 ? 0xf2e6c8 : null))],
    },
  }), { h: 36 });
}

// ---- Vampire, who can become a bat
{
  const pale = paint(0xe8e2e8, { seed: 121 });
  const black = paint(0x16161c, { seed: 122 });
  const cape = paint(0x1a1020, { seed: 123 });
  const red = 0xc0102a;
  const human = humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, pale);
      block(v, -4, 6, -4, 8, 2, 8, black); v.set(-1, 5, 3, black(0, 0, 0)).set(0, 5, 3, black(0, 0, 0)); // slicked hair with a widow's peak
      block(v, -4, 0, -4, 8, 6, 1, black);
      v.set(-2, 4, 3, red, GLOW).set(1, 4, 3, red, GLOW);
      v.set(-1, 1, 3, 0x6a1020).set(0, 1, 3, 0x6a1020).set(-1, 0, 3, 0xffffff).set(0, 0, 3, 0xffffff);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, black); block(v, -1, 5, 1, 2, 7, 1, 0xf2f2f6); v.set(-1, 10, 2, red).set(0, 10, 2, red); },
    arm: armBox(black, pale),
    leg: legBox(black, paint(0x08080c, { seed: 124 })),
    extra: {
      body: [part({ p: [0, 12, 0], vox: vox((v) => { block(v, -5, 0, -3, 10, 3, 1, cape); block(v, -5, 0, -3, 1, 3, 5, cape); block(v, 4, 0, -3, 1, 3, 5, cape); }) }), part({ p: [0, 11, -2], k: 'lean', a: [sway('x', 4, 0.5)], vox: vox((v) => block(v, -5, -17, -1, 10, 17, 1, (x, y) => (y > -3 ? red : cape(x, y, 0)))) })],
    },
  });
  const bat = part({
    p: [0, 22, 0], k: 'look', a: [bob(1.6, 1.4)],
    vox: vox((v) => { block(v, -2, -2, -2, 4, 4, 4, black); v.set(-1, 0, 1, red, GLOW).set(0, 0, 1, red, GLOW); v.set(-2, 2, 0, black(0, 0, 0)).set(1, 2, 0, black(0, 0, 0)); }),
    c: [-1, 1].map((s) => part({ p: [s * 2, 0, 0], a: [flap('z', s * 50, 3.2)], vox: vox((v) => { for (let i = 0; i < 7; i++) for (let j = 0; j < 4 - Math.floor(i / 2.5); j++) v.set(s * (i + 1) - (s < 0 ? 0 : 1) + (s < 0 ? -0 : 0), j - 1, 0, j === 0 ? 0x2a1a2a : 0x3a1a30); }) })),
  });
  model('vampire', 'Vampire', 'mythic', 'Pale, red-eyed, in a high-collared cape lined with red. Its power: turn into a bat and back.', [
    part({ when: { form: 0 }, c: human }),
    part({ when: { form: 1 }, c: [bat] }),
  ], { h: [32, 26], forms: ['Vampire', 'Bat'], effects: [fx('smoke', { at: [0, 22, 0], rate: 6, v: [0, 1, 0], sp: -5, life: 1, c: [0x2a1a2a, 0x1a1020], glow: false, when: { form: 1 } })] });
}

// ---- Werewolf: a villager by day, a towering wolf by night
{
  const skin = paint(0xd8a47c, { seed: 131 });
  const shirt = paint(0x5a7a3a, { seed: 132 });
  const pants = paint(0x4a3a2a, { seed: 133 });
  const fur = paint((x, y, z) => ((x + y * 3 + z * 7) % 5 === 0 ? 0x4a4a52 : 0x6a6a74), { seed: 134, noise: 0.07 });
  const light = paint(0xa8a8b0, { seed: 135 });
  const man = humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      block(v, -4, 6, -4, 8, 2, 8, paint(0x4a3020, { seed: 136 }));
      v.set(-2, 4, 3, 0x3a5a2a).set(1, 4, 3, 0x3a5a2a);
      block(v, -2, 1, 3, 4, 1, 1, paint(0x4a3020, { seed: 137 }));
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, shirt); block(v, -4, 0, -2, 8, 1, 4, 0x3a2a1a); },
    arm: armBox(shirt, skin),
    leg: legBox(pants, paint(0x2a1e14, { seed: 138 })),
  });
  const d = { bodyW: 10, bodyD: 6, armW: 4, legW: 4, hipX: 2.5, headW: 8, headH: 8, headD: 8, armH: 15, legH: 14 };
  const wolf = humanoid({
    dims: d,
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, fur);
      block(v, -2, 0, 4, 4, 3, 4, fur); block(v, -2, 0, 7, 4, 1, 1, light); v.set(-1, 3, 7, EYE).set(0, 3, 7, EYE); // the snout
      for (const x of [-2, 1]) v.set(x, 0, 7, 0xffffff);
      v.set(-3, 5, 3, 0xffd23a, GLOW).set(2, 5, 3, 0xffd23a, GLOW);
    },
    body: (v) => { block(v, -5, 0, -3, 10, 14, 6, fur); block(v, -3, 4, 2, 6, 7, 1, light); },
    arm: (v) => { block(v, -2, -13, -2, 4, 15, 4, fur); for (const x of [-2, -1, 0, 1]) v.set(x, -14, 1, 0xf0eadc); },
    leg: (v) => block(v, -2, -14, -2, 4, 14, 4, fur),
    extra: {
      head: [-1, 1].map((s) => part({ p: [s * 3, 8, -1], vox: vox((v) => block(v, -1, 0, 0, 2, 3, 1, fur)) })),
      body: [tail(fur, { len: 7, up: 0.2, thick: 3, tip: light })],
    },
  });
  model('werewolf', 'Werewolf', 'mythic', 'A plain villager, until it isn\'t: a towering grey wolf with glowing eyes. Its power: change between the two.', [
    part({ when: { form: 0 }, c: man }),
    part({ when: { form: 1 }, c: wolf }),
  ], { h: [32, tall(d)], forms: ['Human', 'Wolf'] });
}

// ---- Pirate Captain: a tricorne, an eye patch, a long red coat with gold buttons and a cutlass
{
  const coat = paint(0x9e1c24, { seed: 141 });
  const black = paint(0x1c1c22, { seed: 142 });
  const skin = paint(0xd9a074, { seed: 143 });
  const gold = 0xffc23a;
  model('pirate', 'Pirate Captain', 'legendary', 'A tricorne hat, an eye patch, a long red coat with gold buttons, and a cutlass.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      block(v, -4, 6, -4, 8, 2, 8, black);
      v.set(1, 4, 3, EYE); block(v, -3, 4, 3, 2, 2, 1, EYE); block(v, -4, 5, 3, 8, 1, 1, EYE); // the patch and its strap
      block(v, -3, 0, 3, 6, 2, 1, paint(0x3a2414, { seed: 144 })); v.set(-3, 2, 3, 0x3a2414).set(2, 2, 3, 0x3a2414);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, coat); block(v, -1, 0, 2, 2, 12, 1, 0xf2ecdc); for (const y of [3, 6, 9]) v.set(-2, y, 2, gold).set(1, y, 2, gold); block(v, -4, 4, -2, 8, 1, 4, black); v.set(0, 4, 2, gold); },
    arm: armBox(coat, skin),
    leg: legBox(paint(0x2a2a34, { seed: 145 }), black),
    extra: {
      head: [part({ p: [0, 7, 0], vox: vox((v) => { block(v, -5, 0, -5, 10, 2, 10, black); block(v, -3, 2, -3, 6, 2, 6, black); for (const [x, z] of [[-5, -5], [4, -5], [-1, 4]]) block(v, x, 2, z, 1, 1, 1, black); block(v, -5, 1, -5, 10, 1, 1, gold); v.set(-1, 3, 3, 0xf2f2f2).set(0, 3, 3, 0xf2f2f2); }) })],
      armR: [sword({ blade: 0xd0d6e0, guard: gold, grip: 0x3a2414, len: 11 })],
      body: [part({ p: [0, 2, 0], vox: vox((v) => { block(v, -4, -6, -2, 1, 6, 4, coat); block(v, 3, -6, -2, 1, 6, 4, coat); block(v, -4, -6, -2, 8, 6, 1, coat); }) })],
    },
  }), { h: 36 });
}

// ---- Pharaoh: a striped gold-and-blue headdress, kohl-lined eyes, a broad collar and a crook
{
  const gold = paint(0xf2c03a, { seed: 151 });
  const blue = paint(0x1f3fa8, { seed: 152 });
  const skin = paint(0xb07a4a, { seed: 153 });
  const linen = paint(0xf4ecd8, { seed: 154 });
  const stripes = (x, y, z) => (y % 2 === 0 ? gold(x, y, z) : blue(x, y, z));
  model('pharaoh', 'Pharaoh', 'legendary', 'A striped gold-and-blue headdress, kohl-lined eyes, a jewelled collar and a crook of office.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      block(v, -4, 5, -4, 8, 3, 8, stripes); block(v, -4, 0, -4, 8, 5, 3, stripes); // the headdress
      v.set(-2, 4, 3, EYE).set(1, 4, 3, EYE).set(-3, 4, 3, 0x1a1a2a).set(2, 4, 3, 0x1a1a2a);
      block(v, -1, -2, 3, 2, 2, 1, gold); // the beard
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, linen); block(v, -4, 8, -2, 8, 4, 4, (x, y, z) => ((x + y) % 2 ? blue(x, y, z) : gold(x, y, z))); block(v, -4, 0, -2, 8, 2, 4, gold); },
    arm: armBox(skin, gold),
    leg: legBox(linen, gold),
    extra: {
      head: [-1, 1].map((s) => part({ p: [s * 4.5, 1, 0], vox: vox((v) => block(v, -0.5, -6, -2, 1, 7, 4, stripes)) })).concat([part({ p: [0, 7, 4], vox: vox((v) => { v.set(0, 0, 0, gold(0, 0, 0)).set(0, 1, 0, 0xff3b5c, GLOW); }) })]),
      armR: [part({ p: [0, -9, 0.5], r: [70, 0, 0], vox: vox((v) => { block(v, 0, -3, 0, 1, 12, 1, (x, y) => (y % 2 ? gold(x, y, 0) : blue(x, y, 0))); v.set(1, 9, 0, gold(0, 0, 0)).set(1, 10, 0, gold(0, 0, 0)).set(0, 10, 0, gold(0, 0, 0)); }) })],
    },
  }), { h: 34 });
}

// ---- Mummy: wrapped in bandages, loose ends trailing, green eyes in the dark gaps
{
  const wrap = paint((x, y, z) => ((y + Math.floor((x + z) / 3)) % 3 === 0 ? 0xc8bc9c : 0xe6dcc0), { seed: 161, noise: 0.05 });
  model('mummy', 'Mummy', 'legendary', 'Wrapped head to toe in old bandages, loose ends trailing, eyes glowing in the dark gaps. Its power: an ancient curse.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, wrap);
      block(v, -3, 3, 3, 6, 2, 1, 0x1a1810);
      v.set(-2, 4, 3, 0x7cff5a, GLOW).set(1, 4, 3, 0x7cff5a, GLOW);
    },
    body: (v) => block(v, -4, 0, -2, 8, 12, 4, wrap),
    arm: armBox(wrap),
    leg: legBox(wrap),
    extra: {
      armL: [part({ p: [0, -8, -2], a: [sway('x', 14, 0.8)], vox: vox((v) => block(v, 0, -5, 0, 1, 5, 1, wrap)) })],
      body: [part({ p: [2, 3, -2], a: [sway('x', 12, 0.6, 0.3)], vox: vox((v) => block(v, 0, -7, -1, 1, 7, 1, wrap)) })],
    },
  }), { power: 'Curse', effects: [fx('smoke', { at: [0, 16, 0], rate: 20, v: [0, 3, 0], sp: -12, life: 1.6, c: [0x3a6a2a, 0x5a9a3a, 0x2a4a1a], glow: false, when: { power: 1 } }), fx('spark', { at: [0, 28, 4], rate: 8, v: [0, 2, 3], sp: 3, life: 0.7, c: [0x7cff5a], when: { power: 1 } })] });
}

// ---- Zombie King: rotting green skin, tattered royal robes and a cracked crown
{
  const skin = paint((x, y, z) => ((x * 3 + y * 5 + z) % 7 === 0 ? 0x3e6a2c : 0x5a8a3c), { seed: 171 });
  const robe = paint(0x5a1a6a, { seed: 172 });
  const fur = paint(0xf0ece4, { seed: 173 });
  model('zombie_king', 'Zombie King', 'legendary', 'Rotting green skin, tattered purple robes trimmed with ermine, and a cracked golden crown.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      block(v, -3, 4, 3, 2, 1, 1, EYE).set(1, 4, 3, EYE).set(2, 4, 3, EYE);
      block(v, -2, 1, 3, 4, 1, 1, 0x1a2a10).set(-1, 0, 3, 0x2a3a1a);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, (x, y, z) => (y < 4 && (x + z) % 3 === 0 ? null : robe(x, y, z))); block(v, -4, 10, -2, 8, 2, 4, fur); block(v, -1, 0, 2, 2, 10, 1, fur); },
    arm: (v) => { block(v, -2, -10, -2, 4, 12, 4, (x, y, z) => (y > -4 ? robe(x, y, z) : skin(x, y, z))); },
    leg: legBox(paint(0x2a3a5a, { seed: 174 }), skin),
    extra: {
      head: [part({ p: [0, 8, 0], vox: vox((v) => { block(v, -4, 0, -4, 8, 2, 8, (x, y, z) => ((x === -2 && z === 3) ? null : y === 0 ? 0xc8961a : (x + z) % 2 ? null : 0xe8b52a)); v.set(-3, 0, 3, 0xff3b5c, GLOW).set(2, 0, 3, 0x3bb8ff, GLOW); }) })],
    },
  }), { h: 34 });
}

// ---- Reaper: a hooded black robe floating over the ground, a skull in the dark, and a scythe
{
  const robe = paint((x, y) => (y < 1 ? 0x101014 : 0x1c1c24), { seed: 181, noise: 0.05 });
  const bone = paint(0xe0dccc, { seed: 182 });
  const r = part({
    p: [0, 4, 0], k: 'lean', a: [bob(1.2, 0.35)],
    vox: vox((v) => {
      for (let y = 0; y < 22; y++) { const w = y < 6 ? 5 + Math.floor((6 - y) / 2) : 4; block(v, -w, y, -w + 1, w * 2, 1, w * 2 - 2, (x, yy, z) => (yy < 3 && (x + z) % 2 ? null : robe(x, yy, z))); }
    }),
    c: [
      part({ p: [0, 21, 0], k: 'head', vox: vox((v) => {
        block(v, -4, 0, -4, 8, 9, 8, robe); for (let x = -3; x < 3; x++) for (let y = 1; y < 7; y++) v.set(x, y, 3, null).set(x, y, 2, null); // the hood's opening
        block(v, -2, 1, 1, 4, 5, 1, bone); block(v, -3, 1, 1, 6, 6, 1, (x, y) => (v.get(x, y, 1) ? undefined : 0x08080a)); v.set(-2, 4, 1, 0x5ff2ff, GLOW).set(1, 4, 1, 0x5ff2ff, GLOW).set(-1, 3, 1, 0x1a1a1a).set(0, 3, 1, 0x1a1a1a);
        for (const x of [-2, -1, 0, 1]) v.set(x, 1, 1, x % 2 ? 0x1a1a1a : bone(x, 1, 1));
      }) }),
      part({ p: [-5, 17, 2], k: 'armR', r: [-30, 0, 0], vox: vox((v) => { block(v, -1, -6, -1, 3, 7, 3, robe); block(v, -1, -8, -1, 2, 2, 2, bone); }),
        c: [part({ p: [0, -7, 0], r: [100, 0, 0], vox: vox((v) => { block(v, 0, -10, 0, 1, 30, 1, 0x4a3420); for (let i = 0; i < 12; i++) { v.set(1 + i, 19 - Math.floor(i * i / 16), 0, i > 9 ? 0xffffff : 0xb8c0cc); v.set(1 + i, 18 - Math.floor(i * i / 16), 0, 0x8b93a5); } }) })] }),
    ],
  });
  model('reaper', 'Reaper', 'mythic', 'A hooded black robe gliding above the ground, a skull in the dark of the hood, and a great scythe. Its power: blue soul fire.', [r], { h: 36, power: 'Soul fire', effects: [fx('smoke', { at: [0, 4, 0], rate: 12, v: [0, -2, 0], sp: -6, life: 1.2, c: [0x101014, 0x1c1c24], glow: false }), fx('ember', { at: [0, 6, 0], rate: 30, v: [0, 8, 0], sp: -8, life: 1, g: 3, c: [0x5ff2ff, 0x2a7fff, 0xffffff], when: { power: 1 } })] });
}

// ---- Ice Queen: an icy crown, white hair, a gown of frost blue, and snow when she wills it
{
  const gown = paint((x, y) => mix(0x3a8ad8, 0xbfe9ff, Math.min(1, y / 22)), { seed: 191 });
  const ice = 0xbff6ff;
  const skin = paint(0xf6e4ec, { seed: 192 });
  const hair = paint(0xf2f6ff, { seed: 193 });
  model('ice_queen', 'Ice Queen', 'mythic', 'A crown of ice, white hair to the waist and a gown fading from blue to frost. Its power: a blizzard.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      block(v, -4, 5, -4, 8, 3, 8, hair); block(v, -4, -6, -4, 8, 11, 2, hair); block(v, -4, 0, -2, 1, 5, 4, hair); block(v, 3, 0, -2, 1, 5, 4, hair);
      v.set(-2, 4, 3, 0x3ad0ff, GLOW).set(1, 4, 3, 0x3ad0ff, GLOW).set(-1, 1, 3, 0x7a7ad8).set(0, 1, 3, 0x7a7ad8);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, gown); block(v, -4, 9, -2, 8, 1, 4, ice, GLOW); },
    arm: armBox(gown, skin),
    leg: (v) => block(v, -2, -12, -2, 4, 12, 4, gown),
    extra: {
      head: [part({ p: [0, 8, 0], vox: vox((v) => { for (const [x, h] of [[-4, 2], [-2, 3], [0, 4], [2, 3], [3, 2]]) block(v, x, 0, 2, 1, h, 1, alpha(ice, 0.85), SEE | GLOW); block(v, -4, 0, -3, 8, 1, 6, alpha(ice, 0.85), SEE | GLOW); }) })],
      root: [part({ vox: vox((v) => { block(v, -6, 0, -4, 12, 3, 8, gown); block(v, -5, 3, -3, 10, 3, 6, gown); }) })],
    },
  }), { h: 35, power: 'Blizzard', effects: [fx('snow', { at: [0, 34, 0], rate: 40, v: [0, -4, 0], sp: -18, life: 1.8, g: -2, c: [0xffffff, 0xd8f4ff, 0x9fe7ff], when: { power: 1 } }), fx('spark', { at: [0, 33, 0], rate: 5, v: [0, 2, 0], sp: 3, life: 0.6, c: [ice] })] });
}

// ---- Fire Spirit: a body of living flame that flickers, burning brighter with its power
{
  const flame = (x, y) => (y > 7 ? 0xffd35c : y > 3 ? 0xff9a1a : 0xff5a1a);
  const core = (x, y, z) => mix(0xff3a10, 0xfff1a8, Math.max(0, Math.min(1, (y + 24) / 34)));
  model('fire_spirit', 'Fire Spirit', 'mythic', 'A body of living flame that flickers and throws embers. Its power: an inferno.', humanoid({
    head: (v) => { block(v, -4, 0, -4, 8, 8, 8, (x, y, z) => flame(x, y + 6, z), GLOW | FLICKER); v.set(-2, 4, 3, 0xffffff, GLOW).set(1, 4, 3, 0xffffff, GLOW).set(-2, 3, 3, 0x7a1503).set(1, 3, 3, 0x7a1503); },
    body: (v) => block(v, -4, 0, -2, 8, 12, 4, (x, y, z) => core(x, y - 2, z), GLOW | FLICKER),
    arm: (v) => block(v, -2, -10, -2, 4, 12, 4, (x, y, z) => core(x, y + 4, z), GLOW | FLICKER),
    leg: (v) => block(v, -2, -12, -2, 4, 12, 4, (x, y, z) => core(x, y - 10, z), GLOW | FLICKER),
    extra: {
      head: [part({ p: [0, 8, 0], a: [sway('z', 8, 1.6)], vox: vox((v) => { for (const [x, z, h] of [[-3, -2, 4], [-1, 0, 6], [1, -1, 5], [2, 2, 3], [-2, 2, 3]]) block(v, x, 0, z, 1, h, 1, (xx, y) => (y > h - 2 ? 0xfff1a8 : 0xffb23f), GLOW | FLICKER); }) })],
    },
  }), { h: 38, power: 'Inferno', effects: [fx('ember', { at: [0, 16, 0], rate: 14, v: [0, 8, 0], sp: -6, life: 0.9, g: 4, c: [0xffd35c, 0xff7a1a] }), fx('ember', { at: [0, 4, 0], rate: 60, v: [0, 14, 0], sp: -12, life: 1, g: 6, c: [0xffd35c, 0xff5a1a, 0xffffff], when: { power: 1 } }), fx('smoke', { at: [0, 30, 0], rate: 10, v: [0, 8, 0], sp: 4, life: 1.4, c: [0x3a2a2a, 0x5a4a4a], glow: false, when: { power: 1 } })] });
}

// ---- Cyborg: half human, half machine, with a red eye that glows and a cannon arm
{
  const skin = paint(0xe0b48a, { seed: 201 });
  const metal = paint((x, y) => (y % 3 === 0 ? 0x5d6576 : 0x8b93a5), { seed: 202, light: 0.18 });
  const suit = paint(0x26303e, { seed: 203 });
  model('cyborg', 'Cyborg', 'legendary', 'Half human, half machine: a steel jaw, a glowing red eye, cables, and an arm that ends in a cannon.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, (x, y, z) => (x < 0 ? metal(x, y, z) : skin(x, y, z)));
      block(v, -4, 6, -4, 8, 2, 8, (x, y, z) => (x < 0 ? metal(x, y, z) : 0x3a2a1a));
      block(v, -3, 3, 3, 3, 3, 1, 0x2a2e38); v.set(-2, 4, 3, 0xff2030, GLOW);
      v.set(1, 4, 3, EYE); block(v, -2, 1, 3, 4, 1, 1, 0x4a3a30);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, suit); block(v, -4, 4, -2, 4, 8, 4, metal); block(v, 1, 6, 2, 2, 2, 1, 0xff2030, GLOW); for (let y = 1; y < 11; y += 2) v.set(0, y, 2, 0x22d3ee, GLOW); },
    armL: armBox(suit, skin),
    armR: (v) => { block(v, -2, -10, -2, 4, 12, 4, metal); block(v, -1.5, -13, -1.5, 3, 3, 3, 0x3a3f4c); v.set(0, -13, 1, 0xff2030, GLOW); },
    leg: legBox(suit, metal),
  }), { h: 32 });
}

// ---- Alien: a big grey-green head, huge black eyes, antennae and a silver suit; four faces
{
  const skin = paint(0x8ad86a, { seed: 211, light: 0.16 });
  const suit = paint(0xc8ccd6, { seed: 212, light: 0.2 });
  const d = { headW: 10, headH: 10, headD: 9, bodyW: 6, armW: 3, legW: 3, hipX: 1.5 };
  const F = (rows) => (v) => { block(v, -5, 0, 3, 10, 10, 1, skin); v.art(rows, { k: EYE, w: [0xffffff, 0], g: [0x5aff8a, GLOW], m: 0x2a5a2a }, { x: 0, y: 0, z: 3 }); };
  const faces = [
    { name: 'Calm', draw: F(['          ', ' kkk  kkk ', 'kkkkk kkkkk', 'kwkkk kwkk', ' kkk  kkk ', '          ', '          ', '   mmmm   ', '          ', '          ']) },
    { name: 'Glowing', draw: F(['          ', ' ggg  ggg ', 'ggggg ggggg', 'gwggg gwgg', ' ggg  ggg ', '          ', '          ', '   mmmm   ', '          ', '          ']) },
    { name: 'Shocked', draw: F([' kkk  kkk ', 'kkkkk kkkkk', 'kkwkk kkwkk', 'kkkkk kkkkk', ' kkk  kkk ', '          ', '    mm    ', '   m  m   ', '    mm    ', '          ']) },
    { name: 'Wink', draw: F(['          ', ' kkk      ', 'kkkkk kkkkk', 'kwkkk      ', ' kkk      ', '          ', '  m    m  ', '   mmmm   ', '          ', '          ']) },
  ];
  model('alien', 'Alien', 'legendary', 'A big green head, huge dark eyes, wobbling antennae and a silver suit. Its power: four faces, one of them glowing.', humanoid({
    dims: d,
    head: (v) => { block(v, -5, 0, -5, 10, 10, 9, skin); },
    faces,
    body: (v) => { block(v, -3, 0, -2, 6, 12, 4, suit); block(v, -1, 7, 1, 2, 2, 1, 0x5aff8a, GLOW); },
    arm: (v) => block(v, -1.5, -10, -1.5, 3, 12, 3, (x, y, z, y0, h) => (y < -8 ? skin(x, y, z) : suit(x, y, z, y0, h))),
    leg: (v) => block(v, -1.5, -12, -1.5, 3, 12, 3, suit),
    extra: { head: [-1, 1].map((s) => part({ p: [s * 3, 10, 0], a: [sway('z', s * 14, 0.7), sway('x', 8, 0.5)], vox: vox((v) => { block(v, 0, 0, 0, 1, 5, 1, skin); v.sphere(0.5, 6, 0.5, 1.4, 0x5aff8a, GLOW); }) })) },
  }), { faces, h: tall(d) + 6 });
}

// ---- Clown: a rainbow wig, a red nose, a striped suit with pom-poms, and big shoes
{
  const suit = paint((x, y) => (Math.floor((x + 4) / 2) % 2 ? 0xffd23a : 0xff4a8a), { seed: 221 });
  const face = paint(0xfaf6f2, { seed: 222 });
  model('clown', 'Clown', 'epic', 'A rainbow wig, a red nose, a striped suit with pom-poms, and the biggest shoes you\'ve seen.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, face);
      v.set(-2, 4, 3, 0x2a5bd7).set(1, 4, 3, 0x2a5bd7).set(-2, 5, 3, 0x2a5bd7).set(1, 5, 3, 0x2a5bd7);
      block(v, -1, 2, 3, 2, 2, 1, 0xff2030); block(v, -1, 2, 4, 2, 2, 1, 0xff2030);
      block(v, -3, 1, 3, 6, 1, 1, 0xff2030).set(-3, 2, 3, 0xff2030).set(2, 2, 3, 0xff2030);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, suit); for (const y of [3, 6, 9]) v.set(0, y, 2, 0xffffff); block(v, -4, 11, -2, 8, 1, 4, 0xffffff); },
    arm: armBox(suit, paint(0xffffff, { seed: 223 })),
    leg: (v) => { block(v, -2, -12, -2, 4, 12, 4, suit); block(v, -2, -12, -2, 4, 2, 7, 0xff2030); },
    extra: {
      head: [part({ p: [0, 4, 0], vox: vox((v) => { for (const s of [-1, 1]) v.sphere(s * 4.5, 3, -1, 3, (x, y, z) => [0xff2030, 0xffd23a, 0x34d399, 0x2a7fff, 0xb57bff][Math.abs(x * 3 + y + z * 2) % 5], 0, 3, 3); }) })],
    },
  }), { h: 32 });
}

// ---- Frog Knight: a frog in a little helmet and a leaf cape, with a twig sword and a lily-pad shield
{
  const frog = paint(0x4caf3a, { seed: 231, light: 0.16 });
  const belly = paint(0xc8e68a, { seed: 232 });
  const steel = paint(0xb8c0cc, { seed: 233, light: 0.18 });
  const d = { headW: 10, headH: 6, headD: 8, legH: 8, bodyH: 10, bodyW: 8, bodyD: 6, armH: 10, hipX: 2 };
  model('frog_knight', 'Frog Knight', 'epic', 'A brave frog in a tiny helmet and a leaf cape, with a twig sword and a lily-pad shield.', humanoid({
    dims: d,
    head: (v) => {
      block(v, -5, 0, -4, 10, 6, 8, frog);
      block(v, -5, 0, 3, 10, 1, 1, 0x2a6a20); // the wide mouth
      for (const s of [-1, 1]) { block(v, s > 0 ? 2 : -5, 5, 0, 3, 3, 3, frog); v.set(s > 0 ? 3 : -4, 6, 3, EYE).set(s > 0 ? 4 : -5, 6, 3, 0xffffff); }
      v.set(-3, 2, 3, 0xff8aa8).set(2, 2, 3, 0xff8aa8);
    },
    body: (v) => { block(v, -4, 0, -3, 8, 10, 6, frog); block(v, -3, 1, 2, 6, 7, 1, belly); },
    arm: armBox(frog),
    leg: (v, dd) => { block(v, -2, -8, -2, 4, 8, 4, frog); block(v, -2, -8, 2, 4, 1, 2, frog); },
    extra: {
      head: [part({ p: [0, 5, -1], vox: vox((v) => { block(v, -3, 0, -3, 6, 2, 5, steel); v.set(0, 2, 0, 0xff3b5c).set(0, 3, 0, 0xff3b5c).set(0, 2, -1, 0xff3b5c); }) })],
      armR: [part({ p: [0, -7, 0.5], r: [90, 0, 0], vox: vox((v) => { block(v, 0, -1, 0, 1, 2, 1, 0x7a5a2a); block(v, -1, 1, 0, 3, 1, 1, 0x5a3a1a); block(v, 0, 2, 0, 1, 9, 1, 0xa87a3a); v.set(1, 6, 0, 0x4caf3a); }) })],
      armL: [part({ p: [2, -4, 0], r: [0, 90, 0], vox: vox((v) => { for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) if (Math.hypot(x, y) <= 4.4 && !(x > 0 && Math.abs(y) < 1)) v.set(x, y, 0, Math.hypot(x, y) > 3.5 ? 0x2a7a20 : 0x5ac84a); v.set(-1, 1, 1, 0xff8ad8).set(-2, 1, 1, 0xff8ad8).set(-1, 2, 1, 0xffd8f0); }) })],
      body: [cape(paint(0x3a9a2a, { seed: 234 }), { w: 8, h: 12, trim: 0x2a6a20 })],
    },
  }), { h: tall(d) + 3 });
}

// ---- Teddy Bear: a stitched, button-eyed bear with a red bow; it gives out hearts
{
  const fur = paint(0xb07a4a, { seed: 241, noise: 0.06 });
  const pale = paint(0xe6c49a, { seed: 242 });
  const d = { headW: 10, headH: 9, headD: 8, bodyW: 10, bodyD: 6, bodyH: 11, legH: 8, legW: 4, hipX: 2.5, armH: 10 };
  model('teddy', 'Teddy Bear', 'epic', 'A big stitched teddy with button eyes and a red bow. Its power: hugs (hearts everywhere).', humanoid({
    dims: d,
    head: (v) => {
      block(v, -5, 0, -4, 10, 9, 8, fur);
      block(v, -2, 1, 3, 4, 3, 2, pale); block(v, -1, 3, 4, 2, 1, 1, EYE); v.set(0, 2, 4, 0x3a2414).set(-1, 1, 4, 0x3a2414);
      v.set(-3, 5, 3, EYE).set(2, 5, 3, EYE).set(-3, 6, 3, 0x3a3a48).set(2, 6, 3, 0x3a3a48);
    },
    body: (v) => { block(v, -5, 0, -3, 10, 11, 6, fur); block(v, -3, 1, 2, 6, 8, 1, pale); for (let y = 2; y < 9; y += 2) v.set(0, y, 3, 0x7a4a2a); },
    arm: (v) => { block(v, -2, -8, -2, 4, 10, 4, fur); block(v, -2, -8, 1, 4, 3, 1, pale); },
    leg: (v) => { block(v, -2, -8, -2, 4, 8, 4, fur); block(v, -2, -8, 2, 4, 3, 1, pale); },
    extra: {
      head: [-1, 1].map((s) => part({ p: [s * 4, 8, 0], vox: vox((v) => { v.sphere(0, 0.5, 0, 1.9, fur); v.set(0, 1, 1, pale(0, 0, 0)); }) })),
      body: [part({ p: [0, 10, 3], vox: vox((v) => { v.set(0, 0, 0, 0xc81e30); block(v, -3, -1, 0, 2, 3, 1, 0xff3b5c); block(v, 2, -1, 0, 2, 3, 1, 0xff3b5c); v.set(-1, -2, 0, 0xc81e30).set(1, -2, 0, 0xc81e30); }) })],
    },
  }), { h: tall(d) + 2, power: 'Hugs', effects: [fx('heart', { at: [0, 20, 4], rate: 8, v: [0, 5, 2], sp: 3, life: 1.4, c: [0xff3b5c, 0xff8ab0], when: { power: 1 } })] });
}

// ---- Bunny: tall floppy ears, a fluffy tail and a carrot; it hops around
{
  const fur = paint(0xf2eef0, { seed: 251, noise: 0.04 });
  const pink = paint(0xffb8cc, { seed: 252 });
  const d = { headH: 8, legH: 10, bodyH: 10, bodyD: 5 };
  model('bunny', 'Bunny', 'epic', 'A white bunny with long floppy ears, a cotton tail and a carrot for later.', humanoid({
    dims: d,
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, fur);
      v.set(-2, 4, 3, EYE).set(1, 4, 3, EYE).set(-2, 5, 3, 0xffffff);
      block(v, -1, 2, 3, 2, 1, 1, pink); v.set(-1, 1, 3, 0xffffff).set(0, 1, 3, 0xffffff);
      v.set(-3, 2, 3, 0xffd0dc).set(2, 2, 3, 0xffd0dc);
    },
    body: (v) => { block(v, -4, 0, -2.5, 8, 10, 5, fur); block(v, -2, 1, 2, 4, 6, 1, 0xffffff); },
    arm: armBox(fur),
    leg: (v) => { block(v, -2, -10, -2, 4, 10, 4, fur); block(v, -2, -10, 2, 4, 1, 2, fur); },
    extra: {
      head: [-1, 1].map((s) => part({ p: [s * 2, 8, 0], r: [-8, 0, s * -10], a: [sway('x', 10, 0.9, s)], vox: vox((v) => { block(v, -1, 0, -1, 3, 10, 2, fur); block(v, 0, 1, 1, 1, 8, 1, pink); }) })),
      body: [part({ p: [0, 1, -3], vox: vox((v) => v.sphere(0, 0, 0, 1.8, 0xffffff)) })],
      armL: [part({ p: [0, -9, 2], r: [70, 0, 0], vox: vox((v) => { for (let i = 0; i < 6; i++) v.set(0, i, 0, i < 5 ? (i % 2 ? 0xff8a1a : 0xff9a2a) : 0x4caf3a); v.set(-1, 5, 0, 0x4caf3a).set(1, 5, 0, 0x4caf3a); }) })],
    },
  }), { h: tall(d) + 10 });
}

// ---- Chef: a tall white hat, a moustache, an apron and a frying pan
{
  const white = paint(0xf6f6f2, { seed: 261 });
  const skin = paint(0xf0c098, { seed: 262 });
  const check = paint((x, y) => ((Math.floor(x / 1) + y) % 2 ? 0x1c1c22 : 0xf2f2f2), { seed: 263, noise: 0.02 });
  model('chef', 'Chef', 'epic', 'A tall white hat, a curly moustache, a spotless apron and a trusty frying pan.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      v.set(-2, 4, 3, EYE).set(1, 4, 3, EYE);
      block(v, -3, 2, 3, 6, 1, 1, 0x3a2414); v.set(-4, 3, 3, 0x3a2414).set(3, 3, 3, 0x3a2414);
      block(v, -4, 6, -4, 8, 2, 8, white);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, white); block(v, -3, 0, 2, 6, 9, 1, 0xffffff); for (const y of [9, 6]) v.set(-1, y, 2, 0xc8c8c0).set(1, y, 2, 0xc8c8c0); v.set(-1, 11, 2, 0xff3b5c).set(0, 11, 2, 0xff3b5c).set(1, 11, 2, 0xff3b5c); },
    arm: armBox(white, skin),
    leg: legBox(check, paint(0x2a2a30, { seed: 264 })),
    extra: {
      head: [part({ p: [0, 8, 0], vox: vox((v) => { block(v, -4, 0, -4, 8, 2, 8, white); v.sphere(0, 4.5, 0, 4.4, white, 0, 3.2, 4.4); }) })],
      armR: [part({ p: [0, -9, 0.5], r: [90, 0, 0], vox: vox((v) => { block(v, 0, -2, 0, 1, 6, 1, 0x3a2414); for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (Math.hypot(x, z) <= 3.4) { v.set(x, 7 + z, 0, 0x2a2a30); if (Math.hypot(x, z) > 2.6) v.set(x, 7 + z, 1, 0x3a3a44); } v.set(0, 7, 1, 0xfff1a8).set(0, 7, 2, 0xffc23a); }) })],
    },
  }), { h: 40 });
}

// ---- Cowboy: a wide hat, a bandana, a vest with a sheriff's star, boots with spurs, and a lasso
{
  const skin = paint(0xd9a074, { seed: 271 });
  const hat = paint(0x8a5a2a, { seed: 272 });
  const denim = paint(0x3a5a8a, { seed: 273 });
  const shirt = paint((x, y) => ((x + y) % 4 < 2 ? 0xc83a3a : 0xe66060), { seed: 274, noise: 0.02 });
  const vest = paint(0x5a3a1c, { seed: 275 });
  model('cowboy', 'Cowboy', 'epic', 'A wide-brimmed hat, a bandana, a leather vest with a sheriff\'s star and a lasso at the ready.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, skin);
      v.set(-2, 4, 3, EYE).set(1, 4, 3, EYE); block(v, -2, 2, 3, 4, 1, 1, 0x5a3a1c);
      block(v, -4, 0, 3, 8, 1, 1, 0xc81e30);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, shirt); block(v, -4, 0, -2, 2, 12, 4, vest); block(v, 2, 0, -2, 2, 12, 4, vest); block(v, -4, 0, -2, 8, 3, 4, vest); block(v, -4, 0, -2, 8, 1, 4, 0x2a1a0c); v.set(0, 0, 2, 0xffd24a); v.set(-3, 8, 2, 0xffd24a, GLOW).set(-3, 7, 2, 0xffd24a).set(-3, 9, 2, 0xffd24a).set(-4, 8, 2, 0xffd24a).set(-2, 8, 2, 0xffd24a); },
    arm: armBox(shirt, skin),
    leg: (v) => { block(v, -2, -12, -2, 4, 12, 4, denim); block(v, -2, -12, -2, 4, 5, 4, paint(0x6a4020, { seed: 276 })); v.set(0, -11, -3, 0xd0d6e0); },
    extra: {
      head: [part({ p: [0, 7, 0], vox: vox((v) => { block(v, -6, 0, -6, 12, 1, 12, (x, y, z) => (Math.abs(x + 0.5) > 5 && Math.abs(z + 0.5) > 5 ? null : hat(x, y, z))); for (const s of [-1, 1]) block(v, s > 0 ? 5 : -6, 1, -6, 1, 1, 12, hat); block(v, -4, 1, -4, 8, 3, 8, hat); block(v, -4, 1, -4, 8, 1, 8, 0x2a1a0c); block(v, -1, 4, -3, 2, 1, 6, hat); }) })],
      armL: [part({ p: [0, -8, 0], r: [0, 0, 0], vox: vox((v) => { for (let a = 0; a < 20; a++) { const t = (a / 20) * Math.PI * 2; v.set(2 + Math.round(Math.cos(t) * 3), Math.round(Math.sin(t) * 3) - 2, 0, 0xd8b878); } }) })],
    },
  }), { h: 34 });
}

// ---- Deep-sea Diver: a brass diving helmet with portholes, a canvas suit, and bubbles
{
  const brass = paint((x, y) => (y % 3 === 0 ? 0xc8862a : 0xe0a83a), { seed: 281, light: 0.2 });
  const suit = paint(0x8a7a5a, { seed: 282 });
  const lead = paint(0x4a4a52, { seed: 283 });
  const d = { headW: 10, headH: 10, headD: 10 };
  model('diver', 'Deep-sea Diver', 'legendary', 'An old brass diving helmet with glass portholes, a canvas suit and lead boots. Its power: bubbles.', humanoid({
    dims: d,
    head: (v) => {
      v.sphere(-0.5, 4.5, -0.5, 5, brass);
      block(v, -3, 2, 4, 5, 5, 1, alpha(0x7ad8ff, 0.55), SEE);
      for (let i = -3; i <= 2; i++) { v.set(i, 1, 4, 0xa86a1a).set(i, 7, 4, 0xa86a1a); }
      for (let j = 2; j <= 6; j++) { v.set(-4, j, 4, 0xa86a1a).set(2, j, 4, 0xa86a1a); }
      for (const s of [-1, 1]) { block(v, s > 0 ? 4 : -6, 3, -1, 1, 3, 2, alpha(0x7ad8ff, 0.55), SEE); }
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, suit); block(v, -5, 9, -3, 10, 3, 6, brass); block(v, -2, 2, -4, 4, 7, 2, paint(0x5a5a62, { seed: 284 })); },
    arm: armBox(suit, paint(0x3a3a3a, { seed: 285 })),
    leg: legBox(suit, lead),
  }), { h: 34, power: 'Bubbles', effects: [fx('bubble', { at: [0, 30, 0], rate: 14, v: [0, 6, 0], sp: 4, life: 2, g: 3, c: [0xbff6ff, 0x7ad8ff, 0xffffff] }), fx('bubble', { at: [0, 20, 0], rate: 50, v: [0, 9, 0], sp: 9, life: 2.2, g: 4, c: [0xbff6ff, 0x7ad8ff, 0xffffff], when: { power: 1 } })] });
}

// ---- Dark Knight: spiked black armour with red trim, a burning visor, a greatsword and a dark aura
{
  const plate = paint((x, y) => (y % 4 === 0 ? 0x1a1a22 : 0x2a2a36), { seed: 291, light: 0.18 });
  const red = 0xc81e30;
  model('dark_knight', 'Dark Knight', 'mythic', 'Spiked black armour edged in red, a burning visor and a huge greatsword. Its power: a dark aura.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, plate);
      block(v, -3, 4, 3, 6, 1, 1, 0xff2030, GLOW);
      block(v, -4, 1, 3, 8, 1, 1, red); v.set(0, 2, 4, red).set(0, 3, 4, red);
    },
    body: (v) => { block(v, -4, 0, -2, 8, 12, 4, plate); block(v, -1, 2, 2, 2, 8, 1, red); block(v, -3, 7, 2, 6, 1, 1, red); v.set(0, 6, 3, 0xff2030, GLOW); },
    arm: armBox(plate),
    leg: legBox(plate, paint(0x101016, { seed: 292 })),
    extra: {
      head: [-1, 1].map((s) => part({ p: [s * 4, 6, 0], r: [0, 0, s * -30], vox: vox((v) => block(v, 0, 0, 0, 1, 4, 1, (x, y) => (y > 2 ? red : 0x2a2a36))) })),
      armL: [pauldron(plate, 1, { w: 6, h: 4, d: 6 }), part({ p: [3, 3, 0], vox: vox((v) => { block(v, 0, 0, -1, 1, 3, 1, 0x3a3a46); v.set(0, 3, -1, red); block(v, 0, 0, 1, 1, 2, 1, 0x3a3a46); }) })],
      armR: [pauldron(plate, -1, { w: 6, h: 4, d: 6 }), sword({ blade: 0x2a2a36, edge: 0xff2030, grip: 0x1a1a1a, guard: red, len: 16 })],
      body: [cape(paint(0x5a0a14, { seed: 293 }), { w: 8, h: 17, trim: 0x1a1a22 })],
    },
  }), { h: 34, power: 'Dark aura', effects: [fx('smoke', { at: [0, 2, 0], rate: 34, v: [0, 5, 0], sp: 9, life: 1.5, c: [0x1a0a1a, 0x3a0a1a, 0x101014], glow: false, when: { power: 1 } }), fx('ember', { at: [0, 4, 0], rate: 16, v: [0, 8, 0], sp: 8, life: 1, g: 3, c: [0xff2030, 0xc81e30], when: { power: 1 } })] });
}

// ---- Creeper Man: a creeper standing upright; its power charges it with blue lightning
{
  const green = paint((x, y, z) => [0x5ac84a, 0x3a9a2a, 0x7ad86a, 0x4caf3a][Math.abs(x * 7 + y * 3 + z * 5) % 4], { seed: 301, noise: 0.03, light: 0.1 });
  model('creeper_man', 'Creeper Man', 'legendary', 'A creeper that learned to stand up. Its power: charged, crackling with blue lightning.', humanoid({
    head: (v) => {
      block(v, -4, 0, -4, 8, 8, 8, green);
      block(v, -3, 4, 3, 2, 2, 1, 0x101010); block(v, 1, 4, 3, 2, 2, 1, 0x101010);
      block(v, -1, 1, 3, 2, 3, 1, 0x101010); v.set(-2, 0, 3, 0x101010).set(-2, 1, 3, 0x101010).set(1, 0, 3, 0x101010).set(1, 1, 3, 0x101010);
    },
    body: (v) => block(v, -4, 0, -2, 8, 12, 4, green),
    arm: armBox(green),
    leg: legBox(green, paint(0x2a6a20, { seed: 302 })),
    extra: {
      root: [part({ when: { power: 1 }, a: [pulse(0.04, 4)], vox: vox((v) => { for (let y = 0; y < 32; y++) for (const [x, z] of [[-6, -4], [5, -4], [-6, 3], [5, 3]]) if ((y + x) % 5 < 2) v.set(x + ((y >> 2) % 2), y, z, alpha(0x5fc8ff, 0.6), GLOW | SEE | FLICKER); }) })],
    },
  }), { h: 32, power: 'Charged', effects: [fx('spark', { at: [0, 16, 0], rate: 30, v: [0, 2, 0], sp: 12, life: 0.35, c: [0x5fc8ff, 0xffffff, 0x2a7fff], when: { power: 1 } })] });
}

// ---- Void Walker: a tall shadow full of stars, with violet eyes; its power blinks it with teleport sparks
{
  const night = paint((x, y, z) => ((x * 13 + y * 7 + z * 3) % 23 === 0 ? 0xffffff : (x * 5 + y * 11 + z) % 17 === 0 ? 0xb57bff : 0x120a24), { seed: 311, noise: 0.03, light: 0.08 });
  const d = { legH: 16, bodyH: 13, armH: 16, legW: 3, armW: 3, bodyW: 7, hipX: 1.5, bodyD: 3 };
  model('void_walker', 'Void Walker', 'mythic', 'A tall shadow full of stars, with violet eyes. Its power: it blinks through space, leaving purple sparks.', humanoid({
    dims: d,
    head: (v) => { block(v, -4, 0, -4, 8, 8, 8, night); block(v, -3, 4, 3, 2, 1, 1, 0xd58bff, GLOW); block(v, 1, 4, 3, 2, 1, 1, 0xd58bff, GLOW); },
    body: (v) => block(v, -3.5, 0, -1.5, 7, 13, 3, night),
    arm: (v) => block(v, -1.5, -14, -1.5, 3, 16, 3, night),
    leg: (v) => block(v, -1.5, -16, -1.5, 3, 16, 3, night),
    extra: { root: [part({ when: { power: 1 }, a: [twitch('y', 40, 1.6, 0.18)], c: [] })] },
  }), { h: tall(d), power: 'Teleport', effects: [fx('spark', { at: [0, 20, 0], rate: 6, v: [0, 1, 0], sp: 4, life: 0.8, c: [0xb57bff, 0xd58bff] }), fx('star', { at: [0, 20, 0], rate: 40, v: [0, 0, 0], sp: 14, life: 0.6, c: [0xb57bff, 0xd58bff, 0xffffff], when: { power: 1 } })] });
}

// ---- Panda: round, black and white, chewing bamboo
{
  const white = paint(0xf4f4f0, { seed: 321, noise: 0.04 });
  const black = paint(0x1c1c22, { seed: 322, noise: 0.04 });
  const d = { headW: 10, headH: 9, headD: 9, bodyW: 12, bodyD: 8, bodyH: 11, legH: 8, legW: 5, hipX: 3, armW: 4, armH: 10 };
  model('panda', 'Panda', 'epic', 'Round, black and white, and never without a bamboo snack.', humanoid({
    dims: d,
    head: (v) => {
      block(v, -5, 0, -5, 10, 9, 9, white);
      for (const s of [-1, 1]) { block(v, s > 0 ? 1 : -4, 3, 3, 3, 3, 1, black); v.set(s > 0 ? 2 : -3, 4, 3, 0xffffff); }
      block(v, -1, 1, 3, 2, 1, 2, black); v.set(-1, 2, 4, black(0, 0, 0)).set(0, 2, 4, black(0, 0, 0)); block(v, -2, 0, 3, 4, 3, 2, (x, y, z) => (v.get(x, y, z) && v.get(x, y, z).c === 0 ? null : z === 4 && y > 0 ? white(x, y, z) : undefined));
    },
    body: (v) => { block(v, -6, 0, -4, 12, 11, 8, white); block(v, -6, 7, -4, 12, 4, 8, black); },
    arm: (v) => block(v, -2, -8, -2, 4, 10, 4, black),
    leg: (v) => block(v, -2.5, -8, -2.5, 5, 8, 5, black),
    extra: {
      head: [-1, 1].map((s) => part({ p: [s * 4.5, 8, 0], vox: vox((v) => block(v, -1, 0, -1, 2, 2, 2, black)) })),
      armR: [part({ p: [0, -8, 1], r: [60, 0, 0], vox: vox((v) => { for (let y = 0; y < 12; y++) v.set(0, y, 0, y % 4 === 0 ? 0x6aa83a : 0x8ad84a); v.set(1, 9, 0, 0x4caf3a).set(2, 10, 0, 0x4caf3a).set(-1, 6, 0, 0x4caf3a); }) })],
    },
  }), { h: tall(d) + 2 });
}

// ---- Wolf: a grey wolf with a white chest, pointed ears and a bushy tail
{
  const fur = paint((x, y, z) => ((x * 3 + y * 5 + z * 7) % 6 === 0 ? 0x8a8a94 : 0xa8a8b2), { seed: 331, noise: 0.05 });
  const light = paint(0xe6e4ea, { seed: 332 });
  model('wolf', 'Wolf', 'legendary', 'A grey wolf with a white chest, pointed ears and a bushy tail. It trots.', quadruped({
    len: 14, w: 7, h: 7, legH: 9, legW: 3, neck: [0, 3, -1],
    body: (v) => { block(v, -3.5, 0, -7, 7, 7, 14, fur); block(v, -4.5, 1, 2, 9, 7, 6, fur); block(v, -2.5, 0, 6, 5, 4, 2, light); },
    head: (v) => {
      block(v, -3, 0, 0, 6, 6, 5, fur); block(v, -1.5, 0, 5, 3, 3, 3, light); v.set(-1, 2, 7, EYE).set(0, 2, 7, EYE);
      v.set(-2, 4, 4, EYE).set(1, 4, 4, EYE).set(-2, 3, 5, null);
      for (const s of [-1, 1]) block(v, s > 0 ? 1 : -3, 6, 1, 2, 2, 1, fur);
    },
    leg: paw(fur, light, { legH: 9 }),
    extra: { tail: [part({ r: [-40, 0, 0], vox: vox((v) => { for (let i = 0; i < 8; i++) block(v, -1, -1, -i - 1, 3, 3, 1, i > 5 ? light : fur); }) })] },
  }), { h: 22 });
}

// ---- Fox: orange with a white-tipped tail, black socks and big ears
{
  const orange = paint(0xe8782a, { seed: 341, noise: 0.05 });
  const white = paint(0xf6f0e8, { seed: 342 });
  const sock = paint(0x2a2024, { seed: 343 });
  model('fox', 'Fox', 'legendary', 'A clever orange fox with black socks, big ears and a white-tipped tail. Its power: a sly trick (it vanishes in a puff).', quadruped({
    len: 12, w: 6, h: 6, legH: 6, legW: 2, neck: [0, 2, -1],
    body: (v) => { block(v, -3, 0, -6, 6, 6, 12, orange); block(v, -2, 0, 3, 4, 3, 3, white); },
    head: (v) => {
      block(v, -3.5, 0, 0, 7, 6, 5, orange); block(v, -3.5, 0, 3, 2, 2, 2, white); block(v, 1.5, 0, 3, 2, 2, 2, white);
      block(v, -1, 0, 5, 2, 2, 2, white); v.set(-1, 1, 7, EYE).set(0, 1, 7, EYE);
      v.set(-2, 3, 4, EYE).set(1, 3, 4, EYE);
      for (const s of [-1, 1]) { block(v, s > 0 ? 1 : -3, 6, 1, 2, 3, 1, orange); v.set(s > 0 ? 2 : -3, 8, 1, sock(0, 0, 0)); }
    },
    leg: paw(sock, null, { legH: 6, legW: 2 }),
    extra: { tail: [part({ r: [-20, 0, 0], vox: vox((v) => { for (let i = 0; i < 9; i++) { const t = i > 2 && i < 7 ? 4 : 3; block(v, -t / 2, -t / 2, -i - 1, t, t, 1, i > 6 ? white : orange); } }) })] },
  }), { h: 17, power: 'Trick', effects: [fx('smoke', { at: [0, 8, 0], rate: 30, v: [0, 3, 0], sp: 10, life: 0.9, c: [0xf6f0e8, 0xe8782a, 0xffffff], glow: false, when: { power: 1 } })] });
}

// ---- Black Cat: sleek and black with glowing green eyes and a curling tail
{
  const fur = paint(0x1c1a22, { seed: 351, noise: 0.06, light: 0.18 });
  model('black_cat', 'Black Cat', 'legendary', 'A sleek black cat with glowing green eyes and a curling tail. Lucky, or not.', quadruped({
    len: 11, w: 5, h: 5, legH: 7, legW: 2, neck: [0, 2, -1],
    body: (v) => block(v, -2.5, 0, -5.5, 5, 5, 11, fur),
    head: (v) => {
      block(v, -3, 0, 0, 6, 5, 5, fur); block(v, -1, 0, 5, 2, 2, 1, 0x2a2830); v.set(-1, 1, 5, 0xff8aa8);
      v.set(-2, 3, 4, 0x7cff5a, GLOW).set(1, 3, 4, 0x7cff5a, GLOW);
      for (const s of [-1, 1]) block(v, s > 0 ? 1 : -3, 5, 1, 2, 2, 1, fur);
      for (const s of [-1, 1]) for (const y of [1, 2]) v.set(s * 4 - (s > 0 ? 1 : 0), y, 4, 0xd0d0d8);
    },
    leg: paw(fur, null, { legH: 7, legW: 2 }),
    extra: { tail: [part({ r: [-70, 0, 0], vox: vox((v) => { for (let i = 0; i < 10; i++) v.set(0, Math.round(Math.sin(i / 3) * 1.5), -i - 1, fur(0, i, 0)).set(-1, Math.round(Math.sin(i / 3) * 1.5), -i - 1, fur(1, i, 0)); }) })] },
  }), { h: 15 });
}

// ---- Unicorn: a white horse with a glowing golden horn and a rainbow mane and tail
{
  const coat = paint(0xf8f4fa, { seed: 361, noise: 0.03 });
  const hoof = paint(0xc8b080, { seed: 362 });
  model('unicorn', 'Unicorn', 'mythic', 'A white horse with a glowing golden horn and a mane and tail in every colour. Its power: a trail of rainbow stars.', quadruped({
    len: 18, w: 8, h: 9, legH: 13, legW: 3, neck: [0, 6, -2],
    body: (v) => block(v, -4, 0, -9, 8, 9, 18, coat),
    head: (v) => {
      block(v, -2.5, 0, -1, 5, 9, 4, coat); // the neck
      block(v, -3, 6, 0, 6, 5, 9, coat); block(v, -2, 6, 8, 4, 3, 2, 0xffd8e4);
      v.set(-3, 9, 4, EYE).set(2, 9, 4, EYE).set(-3, 9, 5, 0x5a8aff).set(2, 9, 5, 0x5a8aff);
      for (const s of [-1, 1]) block(v, s > 0 ? 1 : -2, 11, 1, 1, 2, 1, coat);
      for (let i = 0; i < 5; i++) v.set(0, 11 + i, 4 + i * 0.3, i % 2 ? 0xffd24a : 0xfff1a8, GLOW);
      for (let y = 0; y < 12; y++) block(v, -0.5, y, -2, 1, 1, 2, 0xff4a8a, RAINBOW); // the mane
    },
    leg: paw(coat, hoof, { legH: 13 }),
    extra: { tail: [part({ r: [-30, 0, 0], a: [sway('x', 10, 0.8)], vox: vox((v) => { for (let i = 0; i < 12; i++) block(v, -1, -i, -1 - (i >> 2), 2, 1, 2, 0xff4a8a, RAINBOW); }) })] },
  }), { h: 32, power: 'Rainbow', effects: [fx('star', { at: [0, 14, -8], rate: 6, v: [0, 2, -2], sp: 2, life: 1, c: [0xffd24a, 0xffffff] }), fx('star', { at: [0, 12, -8], rate: 40, v: [0, 2, -6], sp: 5, life: 1.6, c: [0xff3b5c, 0xffa23a, 0xffe14a, 0x34d399, 0x3bb8ff, 0xb57bff], when: { power: 1 } })] });
}

// ---- Mini Dragon: a small red dragon with gold horns and belly, wings and a spiked tail
{
  const scale = paint((x, y, z) => ((x + y + z) % 3 === 0 ? 0xb01e24 : 0xd83a30), { seed: 371, light: 0.16 });
  const belly = paint(0xffc24a, { seed: 372 });
  const horn = 0xf2e6c0;
  model('mini_dragon', 'Mini Dragon', 'mythic', 'A small red dragon with golden horns and belly, leathery wings and a spiked tail. Its power: fire breath.', quadruped({
    len: 14, w: 8, h: 7, legH: 7, legW: 3, neck: [0, 4, -1],
    body: (v) => { block(v, -4, 0, -7, 8, 7, 14, scale); block(v, -3, 0, -6, 6, 1, 12, belly); for (let z = -6; z < 7; z += 2) v.set(0, 7, z, horn); },
    head: (v) => {
      block(v, -2, 0, -1, 4, 6, 4, scale); // the neck
      block(v, -3, 4, 1, 6, 5, 6, scale); block(v, -2, 4, 7, 4, 3, 3, scale); block(v, -2, 4, 7, 4, 1, 3, belly);
      v.set(-1, 6, 9, 0x2a0a0a).set(0, 6, 9, 0x2a0a0a);
      v.set(-3, 7, 5, 0xffd24a, GLOW).set(2, 7, 5, 0xffd24a, GLOW);
      for (const s of [-1, 1]) { const x = s > 0 ? 2 : -3; v.set(x, 9, 2, horn).set(x, 10, 1, horn).set(x, 11, 0, horn); }
    },
    leg: (v) => { block(v, -1.5, -7, -1.5, 3, 7, 3, scale); for (const x of [-1, 0, 1]) v.set(x, -7, 2, horn); },
    extra: {
      body: wings(0x8a1018, 0xffc24a, { span: 11, leather: true, speed: 0.9 }).map((w) => ({ ...w, p: [Math.sign(w.p[0]) * 3.5, 7, 1], r: [-75, 0, 0] })),
      tail: [part({ r: [-10, 0, 0], vox: vox((v) => { for (let i = 0; i < 12; i++) { const t = i < 4 ? 3 : i < 8 ? 2 : 1; block(v, -Math.floor(t / 2), -Math.floor(t / 2), -i - 1, t, t, 1, scale); if (i % 2 === 0) v.set(0, Math.ceil(t / 2), -i - 1, horn); } block(v, -1, 0, -14, 3, 1, 2, horn); }) })],
    },
  }), { h: 22, power: 'Fire breath', effects: [fx('ember', { at: [0, 18, 17], rate: 80, v: [0, 1, 18], sp: 4, life: 0.6, g: -2, c: [0xffd35c, 0xff7a1a, 0xff3a10, 0xffffff], when: { power: 1 } })] });
}

// ---- T-Rex: a big green tyrannosaurus with tiny arms and a huge head; its power is a roar
{
  const hide = paint((x, y, z) => ((x * 5 + y * 3 + z * 7) % 7 === 0 ? 0x3a7a2a : 0x4c9a3a), { seed: 381, light: 0.16 });
  const belly = paint(0xc8d88a, { seed: 382 });
  const jaw = (open) => part({ p: [0, 0, 2], r: [open ? 28 : 0, 0, 0], ...(open ? { a: [sway('x', 6, 4)] } : {}), vox: vox((v) => { block(v, -3.5, -3, 0, 7, 3, 10, hide); block(v, -3.5, -3, 0, 7, 1, 10, belly); for (let z = 2; z < 10; z += 2) v.set(-3, 0, z, 0xffffff).set(2, 0, z, 0xffffff); }) });
  const rex = [
    part({ p: [2.5, 12, -1], k: 'legL', vox: vox((v) => { block(v, -2.5, -6, -3, 5, 6, 7, hide); block(v, -2, -12, -2, 4, 6, 4, hide); block(v, -2, -12, 2, 4, 1, 2, 0xf2e6c0); }) }),
    part({ p: [-2.5, 12, -1], k: 'legR', vox: vox((v) => { block(v, -2.5, -6, -3, 5, 6, 7, hide); block(v, -2, -12, -2, 4, 6, 4, hide); block(v, -2, -12, 2, 4, 1, 2, 0xf2e6c0); }) }),
    part({
      p: [0, 12, 0], r: [-12, 0, 0], vox: vox((v) => { block(v, -4.5, 0, -6, 9, 12, 11, hide); block(v, -3.5, 1, 5, 7, 10, 1, belly); }),
      c: [
        part({ p: [3, 6, 5], k: 'armL', vox: vox((v) => { block(v, 0, -3, 0, 1, 3, 2, hide); v.set(0, -3, 2, 0xf2e6c0); }) }),
        part({ p: [-4, 6, 5], k: 'armR', vox: vox((v) => { block(v, 0, -3, 0, 1, 3, 2, hide); v.set(0, -3, 2, 0xf2e6c0); }) }),
        part({
          p: [0, 12, 2], r: [12, 0, 0], k: 'head',
          vox: vox((v) => { block(v, -4, 0, -3, 8, 6, 13, hide); v.set(-4, 4, 4, 0xffd23a).set(3, 4, 4, 0xffd23a).set(-4, 4, 5, EYE).set(3, 4, 5, EYE); block(v, -4, 6, 2, 8, 1, 4, hide); for (let z = 3; z < 10; z += 2) v.set(-3, -1, z, 0xffffff).set(2, -1, z, 0xffffff); }),
          c: [part({ when: { power: 0 }, c: [jaw(false)] }), part({ when: { power: 1 }, c: [jaw(true)] })],
        }),
        part({ p: [0, 3, -6], k: 'tail', r: [10, 0, 0], vox: vox((v) => { for (let i = 0; i < 16; i++) { const t = Math.max(2, 8 - (i >> 1)); block(v, -Math.floor(t / 2), -i * 0.2, -i - 1, t, Math.max(2, t - 1), 1, hide); } }) }),
      ],
    }),
  ];
  model('trex', 'T-Rex', 'mythic', 'A big green tyrannosaurus with tiny arms, a huge head and a long tail. Its power: a ground-shaking roar.', rex, { h: 34, power: 'Roar', effects: [fx('smoke', { at: [0, 30, 14], rate: 30, v: [0, 2, 12], sp: 6, life: 0.7, c: [0xe6e4ea, 0xc8c8d0], glow: false, when: { power: 1 } }), fx('smoke', { at: [0, 0, 0], rate: 24, v: [0, 3, 0], sp: 10, life: 1, c: [0x8a7a5a, 0x6a5a3a], glow: false, when: { power: 1 } })] });
}

// ---- Slime: a bouncy see-through green cube with a solid core; three faces
{
  const gel = alpha(0x7ad86a, 0.55);
  const core = paint(0x3a9a2a, { seed: 391 });
  const F = (draw) => (v) => draw(v);
  const faces = [
    { name: 'Happy', draw: F((v) => { block(v, -3, 7, 4, 2, 2, 1, EYE); block(v, 1, 7, 4, 2, 2, 1, EYE); block(v, -2, 3, 4, 4, 1, 1, EYE); v.set(-3, 4, 4, EYE).set(2, 4, 4, EYE); }) },
    { name: 'Angry', draw: F((v) => { block(v, -3, 7, 4, 2, 1, 1, EYE); block(v, 1, 7, 4, 2, 1, 1, EYE); v.set(-3, 8, 4, EYE).set(2, 8, 4, EYE); block(v, -2, 4, 4, 4, 1, 1, EYE); v.set(-3, 3, 4, EYE).set(2, 3, 4, EYE); }) },
    { name: 'Sleepy', draw: F((v) => { block(v, -3, 7, 4, 2, 1, 1, EYE); block(v, 1, 7, 4, 2, 1, 1, EYE); v.set(0, 4, 4, EYE).set(-1, 4, 4, EYE); }) },
  ];
  model('slime', 'Slime', 'legendary', 'A bouncy, wobbly green cube you can see right through. It hops when you walk. Its power: three faces.', [
    part({
      k: 'hop', a: [pulse(0.03, 2)],
      vox: vox((v) => { for (let x = -5; x < 5; x++) for (let y = 0; y < 10; y++) for (let z = -5; z < 5; z++) if (x === -5 || x === 4 || y === 0 || y === 9 || z === -5) v.set(x, y, z, gel, SEE); block(v, -2, 2, -2, 4, 4, 4, core); }),
      c: faces.map((f, i) => part({ when: { face: i }, vox: vox(f.draw) })).concat([part({ vox: vox((v) => { for (let x = -5; x < 5; x++) for (let y = 0; y < 10; y++) if (!(y >= 3 && y <= 8 && x >= -3 && x <= 2 && (y === 3 || y === 4 || y >= 7))) v.set(x, y, 4, gel, SEE); }) })]),
    }),
  ], { h: 14, faces });
}

// ---- Magma Cube: a cube of dark rock rings around a glowing core; it bounces and erupts
{
  const rock = paint((x, y, z) => ((x * 3 + z * 5 + y) % 4 === 0 ? 0x5a1a0a : 0x3a1008), { seed: 401 });
  const lava = (x, y, z) => mix(0xff5a1a, 0xffd35c, ((x * 7 + z * 3 + y * 5) % 5) / 5);
  model('magma_cube', 'Magma Cube', 'legendary', 'Rings of dark rock around a glowing core, bouncing as it goes. Its power: an eruption.', [
    part({
      k: 'hop',
      vox: vox((v) => {
        for (let y = 0; y < 10; y++) block(v, -5, y, -5, 10, 1, 10, y % 3 === 1 ? lava : rock, y % 3 === 1 ? GLOW : 0);
        block(v, -3, 6, 5, 2, 2, 1, 0xffd35c, GLOW); block(v, 1, 6, 5, 2, 2, 1, 0xffd35c, GLOW); v.set(-2, 6, 5, 0xff3a10, GLOW).set(2, 6, 5, 0xff3a10, GLOW);
      }),
    }),
  ], { h: 14, power: 'Eruption', effects: [fx('ember', { at: [0, 10, 0], rate: 6, v: [0, 6, 0], sp: 3, life: 0.8, g: 4, c: [0xffd35c, 0xff7a1a] }), fx('ember', { at: [0, 10, 0], rate: 70, v: [0, 16, 0], sp: 10, life: 1.2, g: 14, c: [0xffd35c, 0xff7a1a, 0xff3a10], when: { power: 1 } }), fx('smoke', { at: [0, 12, 0], rate: 14, v: [0, 9, 0], sp: 4, life: 1.6, c: [0x2a1a1a, 0x4a3a3a], glow: false, when: { power: 1 } })] });
}

// ---- Ghost: a floating sheet with a wavy hem; four faces, and a power that fades it nearly away
{
  const sheet = (a) => (x, y, z) => alpha(mix(0xf6f6ff, 0xc8d0f0, Math.max(0, 1 - y / 6) * 0.6), a);
  const body = (a) => vox((v) => {
    for (let y = 0; y < 18; y++) {
      const r = y > 11 ? 5.5 - (y - 11) * 0.55 : 5.5;
      for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5);
        if (d > r || (d < r - 1.6 && y < 16)) continue;
        if (y < 2 && (Math.atan2(z, x) * 4 / Math.PI + 8 + y) % 2 < 1) continue; // the wavy hem
        v.set(x, y, z, sheet(a)(x, y, z), a < 1 ? SEE : 0);
      }
    }
  });
  const F = (rows) => (v) => v.art(rows, { k: EYE, p: 0xff8ab0 }, { x: 0, y: 12, z: 5 });
  const faces = [
    { name: 'Boo', draw: F([' kk  kk ', ' kk  kk ', '        ', '   kk   ', '  k  k  ', '   kk   ']) },
    { name: 'Happy', draw: F([' k    k ', 'k k  k k', '        ', ' p    p ', '  kkkk  ', '        ']) },
    { name: 'Scared', draw: F(['kkk  kkk', 'k k  k k', 'kkk  kkk', '        ', '  kkkk  ', ' k    k ']) },
    { name: 'Sleepy', draw: F(['        ', 'kk    kk', '        ', '        ', '   kk   ', '        ']) },
  ];
  model('ghost', 'Ghost', 'legendary', 'A floating sheet with a wavy hem that bobs as it drifts. Four faces, and its power fades it almost away.', [
    part({
      p: [0, 6, 0], k: 'look', a: [bob(1.5, 0.5)],
      c: [
        part({ when: { power: 0 }, vox: body(0.92), c: faces.map((f, i) => part({ when: { face: i }, vox: vox(f.draw) })) }),
        part({ when: { power: 1 }, vox: body(0.3), c: faces.map((f, i) => part({ when: { face: i }, vox: vox((v) => { f.draw(v); for (const c of v.cells.values()) c.c = alpha(c.c, 0.45), c.f |= SEE; }) })) }),
        ...[-1, 1].map((s) => part({ p: [s * 5.5, 9, 0], r: [0, 0, s * 35], a: [sway('z', s * 10, 0.6)], vox: vox((v) => block(v, 0, -4, -1, 1, 5, 2, alpha(0xf0f0ff, 0.85), SEE)) })),
      ],
    }),
  ], { h: 30, faces, power: 'Fade', effects: [fx('spark', { at: [0, 10, 0], rate: 8, v: [0, 2, 0], sp: 4, life: 1, c: [0xc8d0ff, 0xffffff], when: { power: 1 } })] });
}

// ---- Storm Cloud: a fluffy cloud with a sleepy face; its power brings rain and lightning
{
  const fluff = (dark) => paint((x, y) => mix(dark ? 0x5a6078 : 0xd8dcea, dark ? 0x8a90a8 : 0xffffff, Math.min(1, y / 8)), { seed: 411, noise: 0.03 });
  const cloud = (dark) => vox((v) => {
    const p = fluff(dark);
    for (const [x, y, z, r] of [[0, 4, 0, 5], [-5, 3, 0, 3.8], [5, 3, 0, 3.8], [-2, 7, -1, 3.5], [3, 6, 0, 3.2], [0, 3, -3, 4]]) v.sphere(x, y, z, r, p);
    for (const c of [...v.cells.values()]) if (c.y < 1) v.set(c.x, c.y, c.z, null);
  });
  model('storm_cloud', 'Storm Cloud', 'mythic', 'A fluffy cloud that follows you around with a sleepy face. Its power: rain and lightning.', [
    part({
      p: [0, 18, 0], k: 'look', a: [bob(1, 0.4)],
      c: [
        part({ when: { power: 0 }, vox: cloud(false) }),
        part({ when: { power: 1 }, vox: cloud(true) }),
        part({ vox: vox((v) => { block(v, -3, 4, 5, 2, 1, 1, EYE); block(v, 2, 4, 5, 2, 1, 1, EYE); v.set(-4, 2, 5, 0xffb8cc).set(4, 2, 5, 0xffb8cc); block(v, -1, 2, 5, 2, 1, 1, EYE); }) }),
        part({ when: { power: 1 }, p: [2, 0, 1], vox: vox((v) => { for (const [x, y] of [[0, 0], [0, -1], [-1, -2], [-1, -3], [0, -3], [1, -4], [0, -5], [0, -6], [-1, -7]]) v.set(x, y, 0, 0xfff36a, GLOW | FLICKER); }) }),
      ],
    }),
  ], { h: 30, power: 'Storm', effects: [fx('drop', { at: [0, 18, 0], rate: 50, v: [0, -14, 0], sp: -8, life: 1, g: -10, c: [0x7ad8ff, 0x3bb8ff], when: { power: 1 } })] });
}

// ---- Snowman: three snowballs, a carrot nose, coal buttons, stick arms, a top hat and a scarf
{
  const snow = paint(0xf6f8ff, { seed: 421, noise: 0.03 });
  const coal = 0x1c1c22;
  const stick = (s) => part({ p: [s * 5, 15, 0], k: s > 0 ? 'armL' : 'armR', vox: vox((v) => { for (let i = 0; i < 8; i++) v.set(s * (i + 1), -Math.round(i * 0.4), 0, 0x5a3a1c); v.set(s * 7, 0, 0, 0x5a3a1c).set(s * 9, -2, 0, 0x5a3a1c); }) });
  model('snowman', 'Snowman', 'legendary', 'Three snowballs, a carrot nose, coal buttons, stick arms, a top hat and a red scarf. Its power: snowfall.', [
    part({
      k: 'lean', vox: vox((v) => { v.sphere(-0.5, 5, -0.5, 6, snow); v.sphere(-0.5, 14, -0.5, 4.6, snow); for (const y of [12, 15, 18]) v.set(0, y - 4, 4, coal); for (const y of [11, 14]) v.set(-0.5, y, 4.5, coal); }),
      c: [
        stick(1), stick(-1),
        part({ p: [0, 18, 0], k: 'head', vox: vox((v) => {
          v.sphere(-0.5, 3.5, -0.5, 3.8, snow);
          v.set(-2, 4, 3, coal).set(1, 4, 3, coal); for (let z = 3; z < 7; z++) v.set(-0.5, 3, z, z > 5 ? 0xff9a2a : 0xff7a1a);
          for (const x of [-2, -1, 0, 1]) v.set(x, 1 + (x === -2 || x === 1 ? 1 : 0), 3, coal);
          block(v, -4, 6, -4, 8, 1, 8, coal); block(v, -3, 7, -3, 6, 5, 6, coal); block(v, -3, 7, -3, 6, 1, 6, 0xc81e30);
          for (let x = -4; x <= 3; x++) for (let z = -4; z <= 3; z++) if (Math.hypot(x + 0.5, z + 0.5) > 3.6 && Math.hypot(x + 0.5, z + 0.5) < 4.6) v.set(x, -1, z, 0xc81e30);
          block(v, 2, -6, 3, 2, 5, 1, 0xc81e30); v.set(2, -6, 3, 0xffffff).set(3, -6, 3, 0xffffff);
        }) }),
      ],
    }),
  ], { h: 32, power: 'Snowfall', effects: [fx('snow', { at: [0, 34, 0], rate: 30, v: [0, -4, 0], sp: -16, life: 2, g: -2, c: [0xffffff, 0xe8f4ff], when: { power: 1 } })] });
}

// ---- Penguin: a short penguin in black and white with an orange beak and flippers; it waddles
{
  const black = paint(0x1c2030, { seed: 431, light: 0.16 });
  const white = paint(0xf6f6f2, { seed: 432 });
  const beak = 0xff9a2a;
  const d = { legH: 3, legW: 3, hipX: 2, bodyW: 10, bodyD: 8, bodyH: 12, armW: 2, armH: 9, headW: 8, headH: 7, headD: 7 };
  model('penguin', 'Penguin', 'epic', 'A round penguin with an orange beak and flippers. It waddles. Its power: a little bow tie (and confetti).', humanoid({
    dims: d,
    head: (v) => { block(v, -4, 0, -3.5, 8, 7, 7, black); block(v, -3, 1, 3, 6, 5, 1, white); v.set(-2, 4, 3, EYE).set(1, 4, 3, EYE); block(v, -1, 2, 3, 2, 1, 2, beak); v.set(-1, 1, 3, 0xe8782a).set(0, 1, 3, 0xe8782a); },
    body: (v) => { block(v, -5, 0, -4, 10, 12, 8, black); block(v, -4, 0, 3, 8, 11, 1, white); block(v, -3, 0, 4, 6, 9, 1, white); },
    arm: (v) => block(v, -1, -7, -2, 2, 9, 4, black),
    leg: (v) => { block(v, -1.5, -3, -1.5, 3, 3, 3, beak); block(v, -1.5, -3, 1.5, 3, 1, 2, beak); },
    extra: { body: [part({ when: { power: 1 }, p: [0, 11, 4], vox: vox((v) => { v.set(0, 0, 0, 0xc81e30); block(v, -3, -1, 0, 2, 3, 1, 0xff3b5c); block(v, 2, -1, 0, 2, 3, 1, 0xff3b5c); }) })] },
  }), { h: tall(d) + 1, power: 'Party', effects: [fx('confetti', { at: [0, 24, 0], rate: 20, v: [0, 8, 0], sp: 7, life: 1.6, g: 6, c: [0xff3b5c, 0xffd24a, 0x34d399, 0x3bb8ff, 0xb57bff], when: { power: 1 } })] });
}

// ---- Lava Golem: a hulking golem of black rock split by glowing lava cracks
{
  const rock = paint((x, y, z) => ((Math.floor(x / 2) + Math.floor(y / 3) + Math.floor(z / 2)) % 3 === 0 ? 0x4a4248 : 0x34303a), { seed: 441, light: 0.14 });
  // jagged cracks: a few zig-zag lines down each face
  const crack = (p) => (x, y, z) => { const u = Math.round(x + z * 0.5); const k = ((u + Math.floor(y / 2) * (Math.floor(y / 4) % 2 ? 1 : -1)) % 5 + 5) % 5; return k === 0 && (y * 3 + u) % 7 !== 0 ? mix(0xff5a1a, 0xffd35c, ((y >> 1) & 3) / 3) : p(x, y, z); };
  const glowCrack = (v) => { for (const c of v.cells.values()) if (((c.c >>> 16) & 255) > 0xc0) c.f |= GLOW; };
  const d = { bodyW: 10, bodyD: 6, armW: 5, armH: 15, legW: 4, hipX: 2.5, legH: 11 };
  const parts = humanoid({
    dims: d,
    head: (v) => { block(v, -4, 0, -4, 8, 7, 8, crack(rock)); block(v, -3, 3, 3, 2, 1, 1, 0xffd35c); block(v, 1, 3, 3, 2, 1, 1, 0xffd35c); block(v, -2, 1, 3, 4, 1, 1, 0xff7a1a); glowCrack(v); },
    body: (v) => { block(v, -5, 0, -3, 10, 12, 6, crack(rock)); block(v, -2, 5, 3, 4, 4, 1, (x, y) => mix(0xff7a1a, 0xffd35c, (y - 5) / 3)); glowCrack(v); },
    arm: (v) => { block(v, -2.5, -13, -2.5, 5, 15, 5, crack(rock)); glowCrack(v); },
    leg: (v) => { block(v, -2, -11, -2, 4, 11, 4, crack(rock)); glowCrack(v); },
    scale: 1.2,
  });
  model('lava_golem', 'Lava Golem', 'mythic', 'A hulking golem of black rock split by glowing cracks of lava. Its power: an eruption of embers.', parts, { h: Math.round(tall(d) * 1.2), power: 'Eruption', effects: [fx('ember', { at: [0, 20, 0], rate: 10, v: [0, 6, 0], sp: 6, life: 0.8, g: 3, c: [0xffd35c, 0xff7a1a] }), fx('ember', { at: [0, 30, 0], rate: 60, v: [0, 12, 0], sp: 12, life: 1.2, g: 8, c: [0xffd35c, 0xff5a1a, 0xffffff], when: { power: 1 } }), fx('smoke', { at: [0, 36, 0], rate: 12, v: [0, 6, 0], sp: 4, life: 1.6, c: [0x2a2a2a, 0x4a4a4a], glow: false, when: { power: 1 } })] });
}

// ---- Crystal Golem: a golem of glassy amethyst, crystals growing from its shoulders
{
  const glass = (x, y, z) => alpha([0x8a4ad8, 0xa86ae8, 0xc898ff][(Math.floor((x + 8) / 3) + Math.floor((y + 16) / 4) + Math.floor((z + 8) / 3)) % 3], 0.82);
  const d = { bodyW: 10, bodyD: 6, armW: 5, armH: 14, legW: 4, hipX: 2.5 };
  const cluster = (s) => part({ p: [s * 1, 2, 0], vox: vox((v) => { for (const [x, z, h] of [[0, 0, 6], [s * 2, -1, 4], [-s, 1, 3], [s, 2, 4]]) block(v, x, 0, z, 1, h, 1, (xx, y) => (y === h - 1 ? 0xffffff : 0xd8a8ff), GLOW | SEE); }) });
  model('crystal_golem', 'Crystal Golem', 'mythic', 'A golem of glassy amethyst with crystals growing from its shoulders and a glowing heart. Its power: shine.', humanoid({
    dims: d,
    head: (v) => { block(v, -4, 0, -4, 8, 8, 8, glass, SEE); block(v, -3, 4, 3, 2, 1, 1, 0xffffff, GLOW); block(v, 1, 4, 3, 2, 1, 1, 0xffffff, GLOW); },
    body: (v) => { block(v, -5, 0, -3, 10, 12, 6, glass, SEE); block(v, -1, 6, -1, 2, 3, 2, 0xff8ae8, GLOW); },
    arm: (v) => block(v, -2.5, -12, -2.5, 5, 14, 5, glass, SEE),
    leg: (v) => block(v, -2, -12, -2, 4, 12, 4, glass, SEE),
    extra: { armL: [cluster(1)], armR: [cluster(-1)], head: [part({ p: [0, 8, 0], vox: vox((v) => { block(v, -1, 0, 0, 1, 4, 1, 0xd8a8ff, GLOW | SEE); v.set(-1, 4, 0, 0xffffff, GLOW); block(v, 1, 0, -1, 1, 3, 1, 0xd8a8ff, GLOW | SEE); }) })] },
  }), { h: tall(d) + 4, power: 'Shine', effects: [fx('spark', { at: [0, 20, 0], rate: 5, v: [0, 2, 0], sp: 5, life: 0.8, c: [0xe0b8ff, 0xffffff] }), fx('star', { at: [0, 20, 0], rate: 30, v: [0, 3, 0], sp: 12, life: 1, c: [0xe0b8ff, 0xff8ae8, 0xffffff], when: { power: 1 } })] });
}

// ---- Mech: a walking robot suit that transforms into battle mode, with rocket boosters
{
  const plate = paint((x, y) => (y % 4 === 0 ? 0xc8ccd6 : 0xe6e8ee), { seed: 451, light: 0.16 });
  const dark = paint(0x3a3f4c, { seed: 452 });
  const orange = paint(0xff8a1a, { seed: 453 });
  const d = { bodyW: 10, bodyD: 6, armW: 5, armH: 13, legW: 5, hipX: 3, legH: 13 };
  const base = (battle) => humanoid({
    dims: d,
    head: (v) => { block(v, -4, 0, -4, 8, 7, 8, plate); block(v, -3, 3, 3, 6, 2, 1, battle ? 0xff2030 : 0x22d3ee, GLOW); block(v, -4, 0, -4, 8, 1, 8, orange); },
    body: (v) => { block(v, -5, 0, -3, 10, 12, 6, plate); block(v, -3, 5, 3, 6, 4, 1, dark); v.sphere(0, 7, 3, 1.4, battle ? 0xff2030 : 0x22d3ee, GLOW); block(v, -5, 10, -3, 10, 2, 6, orange); block(v, -3, 2, -4, 6, 8, 1, dark); },
    arm: (v) => { block(v, -2.5, -11, -2.5, 5, 13, 5, plate); block(v, -2.5, -11, -2.5, 5, 3, 5, dark); block(v, -2.5, 0, -2.5, 5, 2, 5, orange); },
    leg: (v) => { block(v, -2.5, -13, -2.5, 5, 13, 5, plate); block(v, -2.5, -13, -2.5, 5, 3, 6, dark); block(v, -2.5, -7, 2.5, 5, 2, 1, orange); },
    extra: battle ? {
      armL: [part({ p: [0, -10, 0], vox: vox((v) => { block(v, -1.5, -4, -1.5, 3, 4, 3, dark); v.set(0, -4, 0, 0xff2030, GLOW); }) })],
      armR: [part({ p: [0, -10, 0], vox: vox((v) => { block(v, -1.5, -4, -1.5, 3, 4, 3, dark); v.set(0, -4, 0, 0xff2030, GLOW); }) })],
      body: [-1, 1].map((s) => part({ p: [s * 4, 12, -1], vox: vox((v) => { block(v, -2, 0, -2, 4, 3, 4, dark); for (const x of [-1, 0]) for (const z of [-1, 0]) v.set(x, 3, z, 0xff3b5c); }) })),
    } : {},
    scale: 1.15,
  });
  model('mech', 'Mech', 'mythic', 'A walking robot suit with glowing visor and core. Its powers: transform into battle mode with arm cannons and shoulder rockets, and fire up the boosters.', [
    part({ when: { form: 0 }, c: base(false) }),
    part({ when: { form: 1 }, c: base(true) }),
  ], { h: Math.round(tall(d) * 1.15), forms: ['Mech', 'Battle'], power: 'Boosters', effects: [fx('ember', { at: [0, 24, -6], rate: 60, v: [0, -10, -4], sp: 4, life: 0.5, g: -4, c: [0x7ad8ff, 0xffffff, 0x3bb8ff], when: { power: 1 } }), fx('smoke', { at: [0, 20, -6], rate: 14, v: [0, -4, -4], sp: 3, life: 1, c: [0x8a8a94, 0xc8c8d0], glow: false, when: { power: 1 } })] });
}

export default items;
