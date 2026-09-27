// Pets. They float beside your shoulder and follow you around; the origin is the pet's
// centre, +z is the way it faces.
import { Vox, part, THEMES, GLOW, SEE, RAINBOW, FLICKER, mix, shade, alpha, hsl, rng, spin, sway, flap, bob, orbit, pulse, hop, trick, twitch, fx } from './kit.mjs';

const items = [];
const pet = (id, name, rarity, desc, parts, effects = []) => items.push({ id, name, slot: 'pet', rarity, desc, parts, fx: effects });

const eyes = (v, y, z, gap = 1, c = 0x14141c, shine = 0xffffff) => {
  v.set(-gap - 1, y, z, c).set(gap, y, z, c);
  v.set(-gap - 1, y + 1, z, shine).set(gap, y + 1, z, c);
  return v;
};

/** A small cloud to sit on, for pets that can't fly. */
const seat = (seed = 1) => {
  const R = rng(seed);
  const v = new Vox();
  for (const [x, z, r] of [[0, 0, 3], [-3, 0.5, 2.2], [3, -0.4, 2.3], [0.5, 2.4, 2], [-0.6, -2.4, 2]]) v.sphere(x, 0, z, r + R() * 0.4, (px, py) => (py > 0 ? 0xffffff : 0xd9d4ff), 0, 1.6, r);
  return v;
};

// ------------------------------------------------------------------ dragons

function dragon(id, name, rarity, th, breath, desc) {
  const body = new Vox();
  body.sphere(0, 0, 0, 3, (x, y, z, dx, dy) => (dy < -0.3 ? th.c : th.a), 0, 2.6, 3.6);
  for (let z = -3; z <= 2; z++) body.set(0, 3, z, th.d).set(-1, 3, z, z % 2 ? th.d : th.a); // back spines
  const head = new Vox();
  head.box(-2, -1, -1, 4, 3, 4, th.a).box(-1, -1, 3, 2, 2, 2, th.b).set(-1, 0, 5, th.d).set(0, 0, 5, th.d);
  head.set(-2, 1, 2, 0xffffff).set(1, 1, 2, 0xffffff).set(-2, 1, 3, th.glow, GLOW).set(1, 1, 3, th.glow, GLOW);
  head.line([-1, 2, 0], [-2, 4, -2], th.c, 0).line([0, 2, 0], [1, 4, -2], th.c, 0);
  const wing = (s) => {
    const w = new Vox();
    for (let i = 0; i < 7; i++) for (let j = 0; j <= Math.min(i, 6 - Math.floor(i / 2)); j++) w.set(s * (i + 1), j, -1 + Math.floor(i / 3), j === 0 || i === 6 ? th.b : alpha(shade(th.a, 1.25), 0.85), j === 0 || i === 6 ? 0 : SEE);
    return w;
  };
  const tail = new Vox();
  for (let i = 0; i < 7; i++) tail.sphere(0, -i * 0.2, -i, Math.max(0.5, 1.6 - i * 0.2), i === 6 ? th.glow : th.a, i === 6 ? GLOW : 0);
  pet(id, name, rarity, desc, [
    part({ a: [bob(1.2, 0.5), sway('z', 5, 0.25)], vox: body, c: [
      part({ p: [0, 2, 3], a: [sway('x', 8, 0.5), sway('y', 10, 0.2)], vox: head }),
      part({ p: [-2, 2, 0], a: [flap('z', 45, 2.4)], vox: wing(-1) }),
      part({ p: [1, 2, 0], a: [flap('z', -45, 2.4)], vox: wing(1) }),
      part({ p: [0, -1, -3], a: [sway('y', 22, 0.7)], vox: tail }),
    ] }),
  ], [fx(breath.k, { at: [0, 2, 9], rate: breath.rate, v: [0, 0, 22], sp: 5, life: 0.45, c: breath.c, g: breath.g || 0 })]);
}

dragon('dragon_ember', 'Ember Dragon', 'legendary', { ...THEMES.fire, a: 0xd9310b, b: 0x7a1503, c: 0xffd35c, d: 0x4a0c07 }, { k: 'ember', rate: 18, c: [0xffb23f, 0xff5a1a, 0xfff27a] }, 'A baby dragon that breathes real (tiny) fire.');
dragon('dragon_frost', 'Frost Dragon', 'legendary', { ...THEMES.ice, a: 0x6fcff5, b: 0x2a7fb0, c: 0xe8fbff, d: 0x1f5f8b }, { k: 'snow', rate: 16, c: [0xe8fbff, 0x9fe7ff] }, 'Its breath is a flurry of snow.');
dragon('dragon_void', 'Void Dragon', 'mythic', { ...THEMES.void, a: 0x2a1452, b: 0x14062e, c: 0xb57bff, d: 0x7c3aed }, { k: 'spark', rate: 20, c: [0xb57bff, 0x22d3ee, 0xffffff] }, 'Born in the End. Breathes pure void energy.');
dragon('dragon_gold', 'Golden Dragon', 'mythic', { ...THEMES.gold, a: 0xe8a317, b: 0x9c6a0c, c: 0xfff3b0, d: 0x5c3a06 }, { k: 'spark', rate: 14, c: [0xffe27a, 0xffffff] }, 'Hoards nothing but attention.');

// ------------------------------------------------------------------ spirits and ghosts

{
  const g = new Vox();
  g.sphere(0, 1, 0, 3.4, alpha(0xf4f6ff, 0.8), SEE, 3.6, 3.2);
  for (let x = -3; x <= 2; x++) for (let k = 0; k < 2 + ((x + 3) % 2); k++) g.set(x, -3 - k, 0, alpha(0xf4f6ff, 0.8), SEE);
  g.box(-2, 2, 3, 1, 2, 1, 0x101018).box(1, 2, 3, 1, 2, 1, 0x101018).box(-1, 0, 3, 2, 1, 1, 0x101018);
  pet('ghost', 'Friendly Ghost', 'rare', 'Boo! It fades in and out as it floats along.', [part({ a: [bob(2, 0.4), sway('z', 8, 0.3), pulse(0.06, 0.5)], vox: g })],
    [fx('smoke', { at: [0, -3, 0], rate: 4, v: [0, -2, -2], sp: 2, life: 1.2, c: [0xe8ecff], glow: false })]);
}
{
  const p = new Vox();
  p.sphere(0, 0, 0, 3.6, (x, y, z, dx) => (Math.abs(Math.round(dx * 4)) % 2 ? 0xe86a10 : 0xff8a1a), 0, 3, 3.6);
  p.art(['#...#', '.....', '#.#.#', '.###.'], { '#': [0xfff27a, GLOW | FLICKER] }, { y: -2, z: 4 });
  p.box(0, 3, 0, 1, 2, 1, 0x3a7a2a);
  pet('pumpkin_spirit', 'Pumpkin Spirit', 'epic', 'A jack-o\'-lantern with a flickering grin.', [part({ a: [bob(1.5, 0.5), spin('y', 20)], vox: p })],
    [fx('ember', { at: [0, 4, 0], rate: 4, v: [0, 5, 0], sp: 3, life: 0.8, c: [0xffb23f] })]);
}
{
  const w = new Vox().sphere(0, 0, 0, 2.2, 0xffffff, GLOW).sphere(0, 0, 0, 3.2, alpha(0x7cdcff, 0.45), GLOW | SEE);
  pet('wisp', 'Spirit Wisp', 'epic', 'A little ball of light that leaves a glowing trail.', [part({ a: [bob(2, 0.7), pulse(0.15, 1.5)], vox: w })],
    [fx('spark', { at: [0, 0, 0], rate: 22, v: [0, 0, -6], sp: 3, life: 0.9, c: [0x7cdcff, 0xffffff, 0xa78bfa] })]);
}

// ------------------------------------------------------------------ bugs

function winged(id, name, rarity, desc, bodyFn, wingC, wingShape, flapSpeed, effects = []) {
  const wing = (s) => {
    const w = new Vox();
    wingShape.forEach((row, ri) => [...row].forEach((ch, ci) => { if (ch !== '.') w.set(s * (ci + 1), wingShape.length - ri, 0, typeof wingC === 'function' ? wingC(ci, ri, ch) : wingC, ch === '*' ? GLOW : SEE); }));
    return w;
  };
  pet(id, name, rarity, desc, [
    part({ a: [bob(1.4, 0.8)], vox: bodyFn(), c: [
      part({ p: [-1, 1, 0], r: [0, 20, 0], a: [flap('z', 60, flapSpeed)], vox: wing(-1) }),
      part({ p: [0, 1, 0], r: [0, -20, 0], a: [flap('z', -60, flapSpeed)], vox: wing(1) }),
    ] }),
  ], effects);
}

winged('bee', 'Busy Bee', 'common', 'Buzz buzz. Its wings are a blur.', () => {
  const b = new Vox().sphere(0, 0, 0, 2.3, (x, y, z) => ((z & 1) ? 0x1d1d24 : 0xffc21a), 0, 2.2, 3.2);
  eyes(b, 0, 3, 1);
  b.set(0, 0, -4, 0x1d1d24);
  return b;
}, alpha(0xe8f6ff, 0.6), ['###.', '####', '.###'], 9, [fx('pollen', { at: [0, -2, 0], rate: 3, v: [0, -3, 0], sp: 2, life: 1, c: [0xffe16f], glow: false })]);
winged('butterfly_morpho', 'Morpho Butterfly', 'rare', 'Shimmering blue wings, flapping lazily.', () => new Vox().box(0, -2, -2, 1, 4, 5, 0x1d1d24).set(0, 2, 3, 0x1d1d24),
  (c, r) => mix(0x1fb6ff, 0x0b3fa0, (c + r) / 8), ['.####.', '######', '#####.', '.###..', '..##..', '.###..'], 1.6, [fx('spark', { at: [0, 0, 0], rate: 4, v: [0, -2, 0], sp: 3, life: 1, c: [0x7cdcff] })]);
winged('butterfly_monarch', 'Monarch Butterfly', 'rare', 'Orange and black, like a stained-glass window.', () => new Vox().box(0, -2, -2, 1, 4, 5, 0x1d1d24),
  (c, r, ch) => ((c + r) % 3 === 0 ? 0x1d1d24 : mix(0xff8a1a, 0xffc21a, r / 6)), ['.####.', '######', '#####.', '.###..', '..##..', '.###..'], 1.5);
winged('fairy', 'Pixie Fairy', 'epic', 'A tiny fairy that sheds glowing dust.', () => {
  const f = new Vox().sphere(0, 2, 0, 1.4, 0xffe0cc).box(-1, -2, -1, 2, 3, 2, 0x9bff3a).set(-1, 3, 1, 0xffd24a).set(0, 3, 1, 0xffd24a);
  return f;
}, (c, r) => alpha(hsl(0.5 + c * 0.05, 0.9, 0.8), 0.7), ['*##.', '####', '*###', '.##.'], 3, [fx('spark', { at: [0, 0, 0], rate: 14, v: [0, -4, 0], sp: 3, life: 1.2, c: [0xffe16f, 0xff9ec7, 0x9fe7ff] })]);

{
  const parts = [];
  const bug = new Vox().box(0, 0, 0, 1, 1, 2, 0x3a3a2a).set(0, 0, -1, 0xd8ff5a, GLOW | FLICKER);
  for (let k = 0; k < 7; k++) parts.push(part({ a: [orbit(3 + (k % 3) * 1.5, 70 + k * 23, k * 51), bob(2, 0.5 + k * 0.13, k / 7)], vox: bug }));
  pet('firefly_swarm', 'Firefly Swarm', 'epic', 'Seven fireflies that dance around each other.', parts, [fx('spark', { at: [0, 0, 0], rate: 6, v: [0, 1, 0], sp: 5, life: 0.8, c: [0xd8ff5a] })]);
}

// ------------------------------------------------------------------ bouncy things

function slime(id, name, rarity, c, desc, effects = [], extra = null) {
  const s = new Vox();
  s.box(-4, -3, -4, 8, 7, 8, alpha(c, 0.72), SEE);
  s.box(-2, -1, -2, 4, 4, 4, shade(c, 0.75));
  eyes(s, 1, 4, 1, 0x14141c);
  s.box(-1, -1, 4, 2, 1, 1, 0x14141c);
  if (extra) extra(s);
  pet(id, name, rarity, desc, [part({ a: [hop(4, 1.1)], vox: s })], effects);
}

slime('slime', 'Bouncy Slime', 'common', 0x7cf05a, 'Boing. It never stops bouncing.');
slime('magma_cube', 'Magma Cube', 'rare', 0x9e1b12, 'Hot, bouncy, and dripping embers.', [fx('ember', { at: [0, 0, 0], rate: 6, v: [0, 6, 0], sp: 4, life: 0.8, c: [0xffb23f, 0xff5a1a] })],
  (s) => { for (let y = -3; y < 4; y += 2) for (const [x, z] of [[-4, 0], [3, -2], [0, 3], [-2, -4]]) s.set(x, y, z, 0xffb23f, GLOW | FLICKER); });
slime('jelly_cube', 'Jelly Cube', 'rare', 0xff6fd8, 'Wobbly, see-through, and colour-changing.', [], (s) => { for (const v of s.cells.values()) v.f |= RAINBOW; });

// ------------------------------------------------------------------ water friends (they swim through the air)

{
  const a = new Vox();
  a.box(-2, -1, -3, 4, 3, 7, 0xffa6c9).box(-1, -1, 4, 2, 2, 1, 0xff8ab5);
  eyes(a, 1, 4, 1, 0x1d1d24);
  a.line([-2, 0, -3], [-2, 0, -7], 0xff8ab5).line([1, 0, -3], [1, 0, -7], 0xff8ab5);
  const gill = (s) => new Vox().box(0, 0, 0, 1, 1, 1, 0xff4f8f).box(s, 1, 0, 1, 1, 1, 0xff4f8f).box(s * 2, 2, 0, 1, 1, 1, 0xff4f8f);
  const tail = new Vox().box(0, 0, 0, 1, 2, 4, 0xff8ab5);
  pet('axolotl', 'Axolotl', 'rare', 'Pink, smiling, and swimming through the air.', [part({ a: [bob(1.5, 0.5), sway('y', 12, 0.5)], vox: a, c: [
    part({ p: [-3, 1, 2], a: [sway('z', 20, 1.5)], vox: gill(-1) }),
    part({ p: [2, 1, 2], a: [sway('z', -20, 1.5)], vox: gill(1) }),
    part({ p: [-1, 0, -7], a: [sway('y', 30, 1.2)], vox: tail }),
  ] })], [fx('bubble', { at: [0, 2, 5], rate: 3, v: [0, 5, 2], sp: 2, life: 1.4, c: [0xbff4ff], glow: false })]);
}
{
  const f = new Vox();
  f.sphere(0, 0, 0, 2.6, (x, y, z, dx, dy) => (dy < -0.2 ? 0xfff1c0 : 0xff8a1a), 0, 2.6, 3.4);
  eyes(f, 0, 3, 1);
  const tail = new Vox().art(['#..#', '####', '.##.', '####', '#..#'], { '#': alpha(0xffb23f, 0.9) }, { plane: 'zy', y: -2 });
  const bowl = new Vox().sphere(0, 0, 0, 6, (x, y, z, dx, dy) => (dy < -0.5 ? alpha(0x3aa6ff, 0.35) : alpha(0xdff6ff, 0.18)), SEE);
  for (const k of [...bowl.cells.keys()]) { const c = bowl.cells.get(k); if (Math.hypot(c.x + 0.5, c.y + 0.5, c.z + 0.5) < 4.8 && c.y > -3) bowl.cells.delete(k); }
  pet('goldfish_bowl', 'Goldfish in a Bowl', 'epic', 'A goldfish that brought its own water.', [
    part({ a: [bob(1, 0.4)], vox: bowl, c: [part({ a: [orbit(2, 60), sway('y', 20, 1)], vox: f, c: [part({ p: [0, 0, -4], a: [sway('y', 35, 2)], vox: tail })] })] }),
  ], [fx('bubble', { at: [0, 4, 0], rate: 4, v: [0, 4, 0], sp: 2, life: 1, c: [0xdff6ff], glow: false })]);
}
{
  const j = new Vox();
  j.sphere(0, 1, 0, 3.6, (x, y, z, dx, dy) => alpha(mix(0xc084fc, 0xff9ec7, dy), 0.7), GLOW | SEE, 2.6, 3.6);
  for (let y = -1; y <= 0; y++) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (y < 0) j.set(x, y, z, null);
  const parts = [part({ a: [bob(2, 0.35), pulse(0.08, 0.7)], vox: j })];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const t = new Vox();
    for (let i = 0; i < 7; i++) t.set(0, -i, 0, alpha(0xe8b8ff, 0.8 - i * 0.08), GLOW | SEE);
    parts.push(part({ p: [Math.round(Math.cos(a) * 2), 0, Math.round(Math.sin(a) * 2)], a: [bob(2, 0.35), sway('x', 18, 0.7, k / 6), sway('z', 10, 0.5, k / 3)], vox: t }));
  }
  pet('jellyfish', 'Moon Jelly', 'legendary', 'A glowing jellyfish drifting through the air.', parts, [fx('spark', { at: [0, 0, 0], rate: 5, v: [0, -3, 0], sp: 2, life: 1.4, c: [0xe8b8ff, 0xff9ec7] })]);
}

// ------------------------------------------------------------------ birds and bats

{
  const b = new Vox();
  b.sphere(0, 0, 0, 2.6, (x, y, z, dx, dy) => mix(0xff5a1a, 0xffd35c, (dy + 1) / 2), GLOW, 3, 3);
  b.box(-1, 1, 3, 2, 1, 2, 0xfff27a, GLOW);
  b.set(-2, 1, 2, 0x1d1d24).set(1, 1, 2, 0x1d1d24);
  const wing = (s) => {
    const w = new Vox();
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4 - Math.floor(i / 3); j++) w.set(s * (i + 1), j - Math.floor(i / 4), -Math.floor(i / 2), mix(0xfff27a, 0xd9310b, i / 8), GLOW | FLICKER);
    return w;
  };
  const tail = new Vox();
  for (let i = 0; i < 6; i++) for (const x of [-1, 0, 1]) tail.set(x * (1 + Math.floor(i / 3)), -Math.floor(i / 2), -3 - i, mix(0xffb23f, 0xff2a0a, i / 6), GLOW);
  pet('phoenix', 'Phoenix', 'mythic', 'Reborn from its own flames, over and over.', [part({ a: [bob(1.5, 0.6)], vox: b, c: [
    part({ p: [-2, 1, 0], a: [flap('z', 50, 1.8)], vox: wing(-1) }),
    part({ p: [1, 1, 0], a: [flap('z', -50, 1.8)], vox: wing(1) }),
    part({ p: [0, 0, 0], a: [sway('x', 10, 0.9)], vox: tail }),
  ] })], [fx('ember', { at: [0, 0, -4], rate: 20, v: [0, 3, -5], sp: 5, life: 0.9, c: [0xffb23f, 0xff5a1a, 0xfff27a] })]);
}
{
  const o = new Vox();
  o.box(-3, -3, -2, 6, 7, 5, 0x8a6a4a).box(-2, -2, 3, 4, 4, 1, 0xd9c3a5);
  const face = new Vox().box(-3, 0, 2, 6, 3, 2, 0x8a6a4a).set(-2, 1, 4, 0xffd24a).set(1, 1, 4, 0xffd24a).set(-2, 2, 4, 0x14141c).set(1, 2, 4, 0x14141c).set(-1, 0, 4, 0xe8a317).set(0, 0, 4, 0xe8a317).set(-3, 3, 2, 0x5c4630).set(2, 3, 2, 0x5c4630);
  pet('owl', 'Wise Owl', 'rare', 'Its head turns all the way around. Hoo.', [part({ a: [bob(1, 0.4)], vox: o, c: [part({ p: [0, 2, 0], a: [{ t: 'twitch', ax: 'y', amp: 150, every: 5, dur: 1.2 }], vox: face })] })]);
}
{
  const b = new Vox().sphere(0, 0, 0, 2, 0x2a2430);
  b.set(-1, 1, 2, 0xff2a3a, GLOW).set(0, 1, 2, 0xff2a3a, GLOW).set(-2, 2, 0, 0x2a2430).set(1, 2, 0, 0x2a2430);
  const wing = (s) => new Vox().art(['####...', '######.', '#.#.#.#'], { '#': 0x3a3040 }, { plane: 'xy', center: false, x: s > 0 ? 1 : -8 });
  pet('bat', 'Night Bat', 'common', 'Flaps like crazy and never sits still.', [part({ a: [bob(2.5, 1.3), sway('z', 10, 0.9)], vox: b, c: [
    part({ p: [-1, 0, 0], a: [flap('z', 70, 4)], vox: wing(-1) }),
    part({ p: [1, 0, 0], a: [flap('z', -70, 4)], vox: wing(1) }),
  ] })]);
}
{
  const p = new Vox();
  p.sphere(0, 0, 0, 2.6, (x, y, z) => hsl((y + 3) / 7, 0.9, 0.55), RAINBOW, 3.2, 2.6);
  p.box(-1, 1, 2, 2, 2, 2, 0xffd24a).set(-2, 2, 1, 0x14141c).set(1, 2, 1, 0x14141c);
  const tail = new Vox();
  for (let i = 0; i < 6; i++) tail.set(0, -i, -2 - Math.floor(i / 2), hsl(i / 6, 0.9, 0.55), RAINBOW);
  pet('parrot_rainbow', 'Rainbow Parrot', 'epic', 'Every feather cycles through the rainbow.', [part({ a: [bob(1.2, 0.8), trick('x', 7, 0.7)], vox: p, c: [part({ a: [sway('x', 10, 1)], vox: tail })] })],
    [fx('confetti', { at: [0, 0, -3], rate: 3, v: [0, -2, -2], sp: 3, life: 1.2, c: [0xff6fd8, 0x6ff2ff, 0xffe16f], glow: false })]);
}

// ------------------------------------------------------------------ tech

{
  const d = new Vox().box(-3, -1, -3, 6, 2, 6, 0x3a3f52).box(-2, 1, -2, 4, 1, 4, 0x5a6275).box(-1, -2, 2, 2, 1, 1, 0xff2a3a, GLOW | FLICKER);
  const parts = [part({ a: [bob(1, 0.9), sway('z', 5, 0.4)], vox: d })];
  for (const [x, z] of [[-5, -5], [4, -5], [-5, 4], [4, 4]]) {
    parts.push(part({ p: [x + 0.5, 0, z + 0.5], a: [bob(1, 0.9)], vox: new Vox().box(-1, 0, -1, 2, 1, 2, 0x5a6275).line([0, 1, 0], [x > 0 ? -1 : 1, 0, 0], 0x3a3f52) }));
    parts.push(part({ p: [x + 0.5, 1.5, z + 0.5], a: [bob(1, 0.9), spin('y', 1440)], vox: new Vox().box(-2, 0, 0, 4, 1, 1, alpha(0xd9dee8, 0.6), SEE) }));
  }
  pet('drone', 'Scout Drone', 'rare', 'Four whirring rotors and a blinking red eye.', parts);
}
{
  const u = new Vox();
  u.cyl(0, 0, 0, 1, 5.5, 5.5, (x, y, z) => mix(0x9aa3b5, 0xd9dee8, (x + z + 10) / 20)).cyl(0, 1, 0, 1, 4, 4, 0xb8c0cc);
  u.sphere(0, 2, 0, 2.6, alpha(0x9fe7ff, 0.55), SEE, 2.2, 2.6);
  for (let k = 0; k < 8; k++) u.set(Math.round(Math.cos(k * 0.785) * 5), 0, Math.round(Math.sin(k * 0.785) * 5), [0xff3b3b, 0x9bff3a, 0x22d3ee, 0xffe16f][k % 4], GLOW | FLICKER);
  const beam = new Vox().cyl(0, -12, 0, 12, 3.5, 1.2, alpha(0x9bff3a, 0.22), GLOW | SEE, 0.8);
  pet('ufo', 'Tiny UFO', 'legendary', 'Spinning saucer with a tractor beam. Take me to your leader.', [part({ a: [bob(1.2, 0.5), sway('z', 6, 0.4), spin('y', 90)], vox: u }), part({ a: [bob(1.2, 0.5), pulse(0.12, 1.5)], vox: beam })]);
}
{
  const c = new Vox().box(-4, -4, -4, 8, 8, 8, (x, y, z) => (x === -4 || x === 3 || y === -4 || y === 3 || z === -4 || z === 3 ? ((x + y + z) & 1 ? 0xa6aebf : 0x8f97a8) : 0x8f97a8));
  for (const [plane, pos] of [['xy', 4], ['xy', -5]]) c.art(['.#.#.', '#####', '.###.', '..#..'], { '#': [0xff6fb0, GLOW | FLICKER] }, { y: -2, z: pos, plane });
  pet('companion_cube', 'Companion Cube', 'epic', 'It will never threaten to stab you.', [part({ a: [bob(1, 0.4), spin('y', 30), sway('x', 8, 0.3)], vox: c })]);
}
{
  const e = new Vox().sphere(0, 0, 0, 3.4, (x, y, z, dx, dy) => (Math.hypot(dx, dy) < 0.35 && z > 1 ? 0x14141c : Math.hypot(dx, dy) < 0.6 && z > 1 ? 0x7c3aed : 0xf4f6ff));
  for (let k = 0; k < 10; k++) e.set(Math.round(Math.cos(k) * 3), Math.round(Math.sin(k * 1.7) * 2.5), Math.round(Math.sin(k) * 3), 0xff6f8f);
  pet('floating_eye', 'Watcher Eye', 'epic', 'It looks around. It sees everything.', [part({ a: [bob(1.4, 0.5), sway('y', 35, 0.2), sway('x', 15, 0.27)], vox: e })],
    [fx('spark', { at: [0, 0, 0], rate: 3, v: [0, 0, 0], sp: 5, life: 1, c: [0xb57bff] })]);
}
{
  const s = new Vox().sphere(0, 0, 0, 2.2, 0xd9dee8).box(-8, -1, -1, 5, 2, 1, 0x2a5bd7).box(3, -1, -1, 5, 2, 1, 0x2a5bd7);
  for (let x = -8; x <= 7; x += 2) if (Math.abs(x) > 2) s.set(x, 0, 0, 0x6f9bff, GLOW);
  s.line([0, 2, 0], [0, 5, 0], 0x9aa3b5).set(0, 5, 0, 0xff3b3b, GLOW | FLICKER);
  pet('satellite', 'Pocket Satellite', 'rare', 'Solar panels out, beaming back signal.', [part({ a: [bob(1, 0.3), spin('z', 25), spin('y', 15)], vox: s })]);
}

// ------------------------------------------------------------------ animals on a cloud

function critter(id, name, rarity, desc, build, anims, effects = [], seed = 1) {
  const extra = build();
  pet(id, name, rarity, desc, [part({ p: [0, -4, 0], a: [bob(1, 0.4)], vox: seat(seed), c: [part({ p: [0, 2, 0], a: anims, vox: extra.body, c: extra.parts || [] })] })], effects);
}

critter('cat', 'Cloud Cat', 'rare', 'Curled up on its cloud, tail swishing.', () => {
  const b = new Vox().box(-2, 0, -3, 4, 3, 6, 0xf0a04a).box(-2, 3, 1, 4, 3, 3, 0xf0a04a).set(-2, 6, 3, 0xf0a04a).set(1, 6, 3, 0xf0a04a);
  eyes(b, 4, 4, 1, 0x3a8a2a).set(-1, 3, 4, 0xff9ec7);
  for (let z = -3; z <= 2; z += 2) b.box(-2, 1, z, 4, 1, 1, 0xd07a2a);
  return { body: b, parts: [part({ p: [0, 1, -3], a: [sway('y', 30, 0.6), sway('x', 15, 0.9)], vox: new Vox().line([0, 0, 0], [0, 4, -2], 0xd07a2a) })] };
}, [twitch('y', 20, 4)], [], 2);
critter('dog', 'Cloud Pup', 'rare', 'A good boy. Its tail never stops wagging.', () => {
  const b = new Vox().box(-2, 0, -3, 4, 3, 6, 0xd9b38a).box(-2, 2, 2, 4, 4, 3, 0xd9b38a).box(-1, 2, 5, 2, 2, 1, 0xc49a70).set(-1, 3, 6, 0x1d1d24);
  eyes(b, 4, 5, 1).box(-3, 3, 2, 1, 3, 2, 0x8a6040).box(2, 3, 2, 1, 3, 2, 0x8a6040);
  return { body: b, parts: [part({ p: [0, 2, -3], a: [sway('y', 45, 2.5)], vox: new Vox().line([0, 0, 0], [0, 2, -2], 0xc49a70) })] };
}, [hop(1, 0.8)], [fx('heart', { at: [0, 6, 3], rate: 0.5, v: [0, 5, 0], sp: 2, life: 1.2, c: [0xff6f8f] })], 3);
critter('fox', 'Cloud Fox', 'epic', 'Sly, fluffy, and a little bit magic.', () => {
  const b = new Vox().box(-2, 0, -3, 4, 3, 6, 0xf07a1f).box(-2, 2, 2, 4, 3, 3, 0xf07a1f).box(-1, 2, 5, 2, 1, 2, 0xfff1e0).set(-1, 3, 6, 0x1d1d24).set(0, 3, 6, 0x1d1d24);
  eyes(b, 3, 5, 1).box(-2, 5, 3, 1, 2, 1, 0xf07a1f).box(1, 5, 3, 1, 2, 1, 0xf07a1f);
  const tail = new Vox().sphere(0, 1, -3, 1.8, (x, y, z) => (z < -4 ? 0xfff1e0 : 0xf07a1f), 0, 1.8, 3);
  return { body: b, parts: [part({ p: [0, 1, -2], a: [sway('y', 35, 0.7)], vox: tail })] };
}, [twitch('y', 25, 3.5)], [fx('spark', { at: [0, 2, -6], rate: 4, v: [0, 2, -2], sp: 3, life: 1, c: [0xffb23f, 0xffffff] })], 4);
critter('panda', 'Cloud Panda', 'rare', 'Munching bamboo on a cloud.', () => {
  const b = new Vox().box(-3, 0, -3, 6, 4, 6, 0xf2f2f2).box(-3, 1, -3, 6, 2, 6, 0x1d1d24).box(-3, 4, -1, 6, 5, 5, 0xf2f2f2);
  b.box(-2, 6, 4, 2, 2, 1, 0x1d1d24).box(0, 6, 4, 2, 2, 1, 0x1d1d24).set(-2, 7, 4, 0xffffff).set(1, 7, 4, 0xffffff).box(-3, 9, 1, 2, 1, 2, 0x1d1d24).box(1, 9, 1, 2, 1, 2, 0x1d1d24);
  return { body: b, parts: [part({ p: [2, 5, 4], a: [sway('x', 20, 0.8)], vox: new Vox().box(0, -3, 0, 1, 7, 1, 0x5fb34a).set(0, 3, 1, 0x3a8a2a) })] };
}, [sway('z', 4, 0.5)], [], 5);
critter('penguin', 'Cloud Penguin', 'rare', 'Waddles in place, very seriously.', () => {
  const b = new Vox().box(-2, 0, -2, 5, 8, 4, 0x1d1d24).box(-1, 0, 2, 3, 6, 1, 0xf2f2f2).box(0, 5, 2, 1, 1, 2, 0xffa01a).set(-1, 6, 2, 0xffffff).set(1, 6, 2, 0xffffff);
  return { body: b, parts: [part({ p: [-3, 5, 0], a: [flap('z', 25, 2)], vox: new Vox().box(0, -4, -1, 1, 4, 2, 0x1d1d24) }), part({ p: [3, 5, 0], a: [flap('z', -25, 2)], vox: new Vox().box(0, -4, -1, 1, 4, 2, 0x1d1d24) })] };
}, [sway('z', 10, 1)], [], 6);
critter('frog', 'Cloud Frog', 'common', 'Ribbit. It hops, and occasionally flips.', () => {
  const b = new Vox().box(-3, 0, -2, 6, 3, 5, 0x5fbf3a).box(-3, 3, 1, 2, 2, 2, 0x5fbf3a).box(1, 3, 1, 2, 2, 2, 0x5fbf3a);
  b.set(-2, 4, 3, 0x14141c).set(2, 4, 3, 0x14141c).box(-2, 1, 3, 4, 1, 1, 0xd94a4a).box(-3, 0, -2, 6, 1, 5, 0xc9e89a);
  return { body: b };
}, [hop(3, 0.9), trick('x', 6, 0.5)], [], 7);
critter('turtle', 'Cloud Turtle', 'common', 'Slow and steady, on a very fluffy cloud.', () => {
  const b = new Vox().sphere(0, 1, 0, 3.4, (x, y, z) => ((x + z) % 3 === 0 ? 0x4a7a2a : 0x6a9a3a), 0, 2, 3.4).box(-1, 0, 3, 2, 2, 3, 0x9fd46a).set(-1, 1, 5, 0x14141c).set(0, 1, 5, 0x14141c);
  return { body: b };
}, [sway('y', 8, 0.2)], [], 8);
critter('crab', 'Cloud Crab', 'common', 'Snip snap. It waves its claws at everyone.', () => {
  const b = new Vox().box(-3, 0, -2, 6, 2, 4, 0xe0412a).box(-2, 2, -1, 4, 1, 2, 0xe0412a).set(-2, 3, 1, 0x14141c).set(1, 3, 1, 0x14141c);
  const claw = new Vox().box(0, 0, 0, 2, 2, 2, 0xff5a3a).set(0, 2, 1, 0xff5a3a);
  return { body: b, parts: [part({ p: [-5, 1, 1], a: [sway('z', 25, 1.4)], vox: claw }), part({ p: [3, 1, 1], a: [sway('z', -25, 1.4, 0.5)], vox: claw })] };
}, [sway('x', 5, 1.5)], [], 9);
critter('duck', 'Rubber Duck', 'common', 'Squeak. Bobs like it\'s in the bath.', () => {
  const b = new Vox().sphere(0, 1, 0, 2.8, 0xffd21a, 0, 2, 3.2).sphere(0, 4, 1.5, 2, 0xffd21a).box(-1, 3, 3, 2, 1, 2, 0xff8a1a).set(-1, 5, 3, 0x14141c).set(0, 5, 3, 0x14141c);
  return { body: b };
}, [sway('z', 12, 0.7), sway('x', 6, 0.5)], [fx('bubble', { at: [0, 0, 0], rate: 2, v: [0, 3, 0], sp: 3, life: 1, c: [0xdff6ff], glow: false })], 10);

// ------------------------------------------------------------------ cosmic

{
  const s = new Vox();
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
    pts.push([Math.cos(a) * (k % 2 ? 1.8 : 4.4), Math.sin(a) * (k % 2 ? 1.8 : 4.4)]);
  }
  for (let x = -5; x <= 5; x++) for (let y = -5; y <= 5; y++) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) s.box(x, y, -1, 1, 1, 2, mix(0xfff27a, 0xffb23f, Math.hypot(x, y) / 5), GLOW);
  }
  eyes(s, 0, 1, 1);
  pet('star_buddy', 'Star Buddy', 'epic', 'A little star that twinkles and trails stardust.', [part({ a: [bob(1.5, 0.5), spin('y', 60), pulse(0.1, 1.2)], vox: s })],
    [fx('star', { at: [0, 0, 0], rate: 10, v: [0, -3, -3], sp: 3, life: 1.4, c: [0xfff27a, 0xffffff] })]);
}
{
  const core = new Vox().sphere(0, 0, 0, 2.2, 0x050508);
  const disk = new Vox().ring(0, 0, 0, 4.2, 2.2, (x, y, z, a) => mix(0xff8a1a, 0xb57bff, (Math.sin(a * 2) + 1) / 2), GLOW | FLICKER);
  pet('pocket_void', 'Pocket Black Hole', 'mythic', 'A black hole on a leash. Try not to fall in.', [part({ a: [bob(1, 0.4)], vox: core }), part({ r: [20, 0, 0], a: [bob(1, 0.4), spin('y', 240)], vox: disk })],
    [fx('spark', { at: [0, 0, 0], rate: 14, v: [0, 0, 0], sp: -7, life: 0.8, c: [0xc4a8ff, 0xff8a1a] })]);
}
{
  const c = new Vox();
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9;
    const h = 4 + (k % 3) * 2;
    for (let j = 0; j < h; j++) c.set(Math.round(Math.cos(a) * (k ? 1.6 : 0)), j - 3, Math.round(Math.sin(a) * (k ? 1.6 : 0)), mix(0x22d3ee, 0xe8fbff, j / h), GLOW | SEE);
  }
  pet('crystal_cluster', 'Crystal Cluster', 'rare', 'A living geode, humming with light.', [part({ a: [bob(1.2, 0.4), spin('y', 35)], vox: c })], [fx('spark', { at: [0, 3, 0], rate: 5, v: [0, 3, 0], sp: 3, life: 1, c: [0x9fe7ff] })]);
}
{
  const block = new Vox().box(-3, -3, -3, 6, 6, 6, (x, y, z) => (y === 2 ? 0xc4b5fd : x === -3 || z === -3 ? 0x6d4df0 : 0x8b6bff));
  eyes(block, 0, 3, 1, 0xffffff, 0x14141c);
  const ring = new Vox().ring(0, 0, 0, 5.5, 1.1, (x, y, z, a) => mix(0x22d3ee, 0xf472b6, (Math.cos(a) + 1) / 2), GLOW);
  pet('nimbus_buddy', 'Nimbus Buddy', 'legendary', 'The Nimbus block itself, following you around.', [part({ a: [bob(1.4, 0.5), sway('y', 25, 0.3)], vox: block }), part({ r: [0, 0, -20], a: [bob(1.4, 0.5), spin('y', 120)], vox: ring })],
    [fx('spark', { at: [0, 0, 0], rate: 6, v: [0, 2, 0], sp: 4, life: 1, c: [0x22d3ee, 0xa78bfa, 0xf472b6] })]);
}
{
  const h = new Vox().art(['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'], { '#': [0xff3b7a, GLOW] }, { y: -3, depth: 3, z: -1 });
  eyes(h, 0, 2, 1, 0xffffff, 0x14141c);
  pet('love_heart', 'Love Bug', 'rare', 'A heart with a face. It thinks you\'re great.', [part({ a: [bob(1.4, 0.6), pulse(0.15, 1.4)], vox: h })],
    [fx('heart', { at: [0, 0, 0], rate: 2, v: [0, 4, 0], sp: 4, life: 1.4, c: [0xff3b7a, 0xff9ec7] })]);
}

export default items;
