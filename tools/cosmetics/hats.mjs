// Hats. The origin is the top centre of the head: the head fills x -4..3, y -8..-1, z -4..3
// (voxel indices), +z is the way the player faces and +y is up.
import { Vox, part, THEMES, GLOW, SEE, RAINBOW, FLICKER, mix, shade, alpha, hsl, rng, spin, sway, flap, bob, orbit, pulse, hop, trick, twitch, fx } from './kit.mjs';

const items = [];
const hat = (id, name, rarity, desc, parts, effects = []) => items.push({ id, name, slot: 'hat', rarity, desc, parts, fx: effects });

/** A square ring hugging the head, one voxel out from it. */
function band(v, y0, h, colour, flags = 0, out = 1) {
  for (let y = y0; y < y0 + h; y++) {
    for (let i = -4 - out; i <= 3 + out; i++) {
      for (const [x, z] of [[i, -4 - out], [i, 3 + out], [-4 - out, i], [3 + out, i]]) v.set(x, y, z, typeof colour === 'function' ? colour(x, y, z) : colour, flags);
    }
  }
  return v;
}

// ------------------------------------------------------------------ crowns

function crown(id, name, rarity, th, extra = {}) {
  const v = new Vox();
  band(v, -1, 3, (x, y) => (y === 1 ? th.c : y === -1 ? th.d : th.a));
  // points: tall on the corners and the middle of each side, small between
  for (let i = -5; i <= 4; i++) {
    for (const [x, z] of [[i, -5], [i, 4], [-5, i], [4, i]]) {
      const edge = Math.abs(i + 0.5);
      const tall = edge > 4.4 || edge < 1 ? 4 : edge > 2.4 && edge < 3.6 ? 2 : 0;
      for (let y = 2; y < 2 + tall; y++) v.set(x, y, z, y === 1 + tall ? th.c : th.a);
    }
  }
  // gems on the band: they glow and flicker
  const gem = (x, y, z, c) => v.set(x, y, z, c, GLOW | FLICKER);
  gem(-1, 0, 4, th.gem); gem(0, 0, 4, th.gem);
  gem(-1, 0, -5, th.gem); gem(0, 0, -5, th.gem);
  gem(-5, 0, -1, th.gem); gem(-5, 0, 0, th.gem);
  gem(4, 0, -1, th.gem); gem(4, 0, 0, th.gem);
  for (const [x, z] of [[-5, -5], [4, -5], [-5, 4], [4, 4]]) gem(x, 6, z, th.glow);
  // velvet cushion inside
  v.box(-4, 0, -4, 8, 1, 8, th.velvet || 0x8a1538);
  v.box(-3, 1, -3, 6, 1, 6, shade(th.velvet || 0x8a1538, 1.2));
  const parts = [part({ vox: v })];
  if (extra.orbit) {
    const o = new Vox().sphere(0, 0, 0, 1.2, th.glow, GLOW);
    for (let k = 0; k < 3; k++) parts.push(part({ p: [0, 3 + k, 0], a: [orbit(8, 90, k * 120), bob(1, 0.6, k / 3)], vox: o }));
  }
  hat(id, name, rarity, extra.desc || `A ${name.toLowerCase()} with glittering gems.`, parts, [fx('spark', { at: [0, 6, 0], rate: extra.rate || 5, v: [0, 4, 0], sp: 7, life: 1.2, c: [th.glow, th.c] })]);
}

crown('crown_royal', 'Royal Crown', 'epic', { ...THEMES.gold, velvet: 0x8a1538 });
crown('crown_frost', 'Frost Crown', 'epic', { ...THEMES.ice, velvet: 0x1f5f8b }, { desc: 'Carved from ice that never melts. Snowflakes drift off it.' });
crown('crown_emerald', 'Emerald Crown', 'rare', { ...THEMES.emerald, velvet: 0x14532d });
crown('crown_void', 'Void Crown', 'legendary', { ...THEMES.void, a: 0x2a1452, c: 0x7c3aed, d: 0x0c0418, velvet: 0x1a0633 }, { orbit: true, rate: 9, desc: 'Worn by whoever rules the End. Three void orbs circle it.' });

// ------------------------------------------------------------------ halos

function halo(id, name, rarity, colour, desc, opts = {}) {
  const ring = new Vox().ring(0, 0, 0, 5.2, 1.3, opts.colourFn || colour, GLOW | (opts.rainbow ? RAINBOW : 0) | FLICKER);
  const parts = [part({ p: [0, 5, 0], r: [8, 0, 0], a: [bob(1, 0.5), spin('y', opts.speed || 40)], vox: ring })];
  if (opts.inner) parts.push(part({ p: [0, 5, 0], r: [-12, 0, 0], a: [bob(1, 0.5, 0.1), spin('y', -110)], vox: new Vox().ring(0, 0, 0, 3.4, 0.9, opts.inner, GLOW) }));
  if (opts.dots) {
    const d = new Vox().box(0, 0, 0, 1, 1, 1, opts.dots, GLOW);
    for (let k = 0; k < 6; k++) parts.push(part({ p: [0, 5, 0], a: [bob(1, 0.5), orbit(7.5, 160, k * 60)], vox: d }));
  }
  if (opts.horns) {
    const hv = new Vox();
    for (const s of [-1, 1]) hv.line([s * 3.5, 0, 1], [s * 5, 4, 2], (t) => mix(0x2a0508, 0xff2a3a, t), 0, 0.8);
    parts.push(part({ vox: hv }));
  }
  hat(id, name, rarity, desc, parts, opts.fx || [fx('spark', { at: [0, 5, 0], rate: 4, v: [0, -3, 0], sp: 5, life: 1.4, c: [colour] })]);
}

halo('halo_angel', 'Angel Halo', 'rare', 0xffe27a, 'A golden halo that hums with light.');
halo('halo_demon', 'Demon Halo', 'epic', 0xff2a3a, 'Burning red, with two little horns to match.', { horns: true, speed: -60, fx: [fx('ember', { at: [0, 5, 0], rate: 6, v: [0, 5, 0], sp: 4, life: 1, c: [0xff2a3a, 0xff8a1a] })] });
halo('halo_cyber', 'Cyber Halo', 'legendary', 0x22d3ee, 'Two counter-spinning rings and six orbiting data bits.', { inner: 0xa78bfa, dots: 0xffffff, speed: 70 });
halo('halo_prism', 'Prism Halo', 'epic', 0xff6fd8, 'Every colour at once, all the time.', { rainbow: true, fx: [fx('spark', { at: [0, 5, 0], rate: 8, v: [0, -2, 0], sp: 7, life: 1.5, c: [0xff6fd8, 0x6ff2ff, 0xffe16f, 0x9bff3a] })] });

// ------------------------------------------------------------------ top hats

function topHat(id, name, rarity, desc, body, bandC, extra = () => []) {
  const v = new Vox();
  v.box(-6, 0, -6, 12, 1, 12, shade(body, 0.85)); // brim
  v.box(-4, 1, -4, 8, 9, 8, (x, y) => (y === 9 ? shade(body, 1.15) : body));
  band(v, 1, 2, bandC, 0, 0);
  v.box(-5, 0, -5, 10, 1, 10, shade(body, 0.7));
  hat(id, name, rarity, desc, [part({ vox: v }), ...extra(v)]);
}

topHat('tophat_classic', 'Gentleman\'s Top Hat', 'common', 'Tall, black and very polite.', 0x1d1d24, 0x7c2d3b);
topHat('tophat_magician', 'Magician\'s Hat', 'epic', 'A rabbit keeps popping out of the top.', 0x1a1a2a, 0x7c5cff, () => {
  const r = new Vox();
  r.box(-2, 0, -2, 4, 4, 4, 0xf5f5f5).box(-2, 4, 0, 1, 4, 1, 0xf5f5f5).box(1, 4, 0, 1, 4, 1, 0xf5f5f5);
  r.set(-2, 5, 1, 0xffb3c8).set(1, 5, 1, 0xffb3c8).set(-1, 2, 2, 0x222222).set(0, 2, 2, 0x222222).set(-1, 1, 2, 0xff9ec7);
  const bunny = part({ p: [0, 6, 0], a: [{ t: 'hop', h: 5, sp: 0.35 }], vox: r });
  return [bunny];
});
topHat('tophat_steam', 'Steampunk Topper', 'legendary', 'Brass gears turn on its side and the goggles glow.', 0x4a2e1c, 0xc98b2e, () => {
  const gear = (r, c) => {
    const g = new Vox();
    for (let a = 0; a < 360; a += 8) {
      const rad = (a * Math.PI) / 180;
      const rr = (a / 8) % 4 < 2 ? r + 1 : r;
      g.set(Math.round(Math.cos(rad) * rr), Math.round(Math.sin(rad) * rr), 0, c);
    }
    g.sphere(0, 0, 0, r - 0.6, shade(c, 0.8));
    g.set(0, 0, 0, 0x2a1a0e);
    return g;
  };
  const goggles = new Vox();
  for (const s of [-3, 2]) goggles.ring(s + 0.5, 0, 4.5, 1.5, 1, 0xc98b2e).box(s, 0, 4, 1, 1, 1, 0xffb23f, GLOW | FLICKER);
  return [
    part({ p: [4.6, 5, 0], r: [0, 90, 0], a: [spin('z', 60)], vox: gear(2.5, 0xc98b2e) }),
    part({ p: [4.6, 2, 3], r: [0, 90, 0], a: [spin('z', -90)], vox: gear(1.6, 0xe0b04a) }),
    part({ p: [0, 2, 0], vox: goggles }),
  ];
});

// ------------------------------------------------------------------ wizard hats

function wizard(id, name, rarity, th, desc) {
  const R = rng(id.length * 97);
  const base = new Vox();
  base.ring(0, 0, 0, 6.5, 2.6, th.b); // brim
  const cone = new Vox();
  const H = 16;
  for (let j = 0; j < H; j++) {
    const r = 5.2 * (1 - j / H) + 0.4;
    const bend = Math.pow(j / H, 2.2) * 6; // leans back towards the tip
    cone.cyl(0, j, -bend, 1, r, r, (x, y, z) => (R() < 0.05 ? th.glow : mix(th.a, th.b, j / H)));
  }
  // glowing stars on the cone
  for (let k = 0; k < 14; k++) {
    const j = Math.floor(R() * (H - 4));
    const r = 5.2 * (1 - j / H) + 0.4;
    const ang = R() * Math.PI * 2;
    cone.set(Math.round(Math.cos(ang) * r), j, Math.round(Math.sin(ang) * r - Math.pow(j / H, 2.2) * 6), th.glow, GLOW | FLICKER);
  }
  const tip = new Vox().sphere(0, 0, 0, 1.3, th.glow, GLOW);
  hat(id, name, rarity, desc, [
    part({ vox: base }),
    part({ p: [0, 0, 0], a: [sway('x', 4, 0.4)], vox: cone, c: [part({ p: [0, H, -6.5], a: [pulse(0.25, 1.2)], vox: tip })] }),
  ], [fx('star', { at: [0, 17, -6], rate: 5, v: [0, -4, 0], sp: 4, life: 1.8, c: [th.glow, th.c] })]);
}

wizard('wizard_arcane', 'Arcane Wizard Hat', 'epic', THEMES.void, 'Stars twinkle across it and the tip glows with magic.');
wizard('wizard_sky', 'Starlight Wizard Hat', 'rare', { ...THEMES.ocean, a: 0x1d3f8f, b: 0x0f1f5a }, 'Deep blue, sprinkled with starlight.');
wizard('wizard_ember', 'Ember Wizard Hat', 'epic', { ...THEMES.fire, a: 0x9e1b12, b: 0x4a0c07 }, 'Smoulders at the tip.');

// ------------------------------------------------------------------ horns

function horns(id, name, rarity, desc, path, colourAt, flags = 0, effects = []) {
  const v = new Vox();
  for (const s of [-1, 1]) {
    const pts = path(s);
    for (let i = 0; i < pts.length - 1; i++) {
      const t = i / (pts.length - 1);
      v.line(pts[i], pts[i + 1], colourAt(t), t > 0.85 ? flags : 0, Math.max(0.5, 1.6 * (1 - t) + 0.3));
    }
  }
  hat(id, name, rarity, desc, [part({ vox: v })], effects);
}

horns('horns_demon', 'Demon Horns', 'rare', 'Curved and wicked, with glowing tips.',
  (s) => [[s * 3, -1, 1], [s * 5, 2, 1], [s * 6, 5, 0], [s * 5.5, 8, -1], [s * 4.5, 10, -1]],
  (t) => mix(0x2a0508, 0xff2a3a, t), GLOW, [fx('ember', { at: [0, 9, -1], rate: 3, v: [0, 4, 0], sp: 3, life: 0.8, c: [0xff2a3a] })]);
horns('horns_ram', 'Ram Horns', 'common', 'Big curled horns for headbutting.',
  (s) => {
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI * 1.7;
      const r = 4.5 - i * 0.17;
      pts.push([s * (4 + Math.sin(a) * 1.2 + i * 0.12), -1 + Math.sin(a) * r * 0.9 + 1.5, 1 - (1 - Math.cos(a)) * r * 0.7]);
    }
    return pts;
  }, (t) => mix(0xd8c8a0, 0x8a7550, (t * 6) % 1 > 0.5 ? 0.3 : 0.6));
horns('horns_dragon', 'Dragon Horns', 'epic', 'Swept back like a dragon\'s, with a glowing core.',
  (s) => [[s * 3, -1, 2], [s * 4, 2, 0], [s * 4.5, 4, -3], [s * 4.5, 5, -7], [s * 4, 5, -10]],
  (t) => mix(0x3a1d0c, 0xffb23f, t * t), GLOW);

// unicorn: one spiral horn from the forehead
{
  const v = new Vox();
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    const a = t * Math.PI * 8;
    const r = 1.6 * (1 - t);
    v.sphere(Math.cos(a) * r * 0.6, -2 + t * 10, 4 + t * 5 + Math.sin(a) * r * 0.6, Math.max(0.55, 1.3 * (1 - t) + 0.4), hsl(t, 0.9, 0.7), GLOW | RAINBOW);
  }
  hat('horn_unicorn', 'Unicorn Horn', 'legendary', 'A rainbow horn that sheds sparkles everywhere.', [part({ a: [pulse(0.04, 1)], vox: v })],
    [fx('star', { at: [0, 8, 9], rate: 10, v: [0, 2, 3], sp: 6, life: 1.4, c: [0xff6fd8, 0x6ff2ff, 0xffe16f, 0xffffff] })]);
}

// ------------------------------------------------------------------ ears

function ears(id, name, rarity, desc, make, anim) {
  const parts = [];
  for (const s of [-1, 1]) parts.push(part({ p: [s * 2.5, 0, 0], r: [0, 0, s * -8], a: anim(s), vox: make(s) }));
  hat(id, name, rarity, desc, parts);
}

ears('ears_cat', 'Cat Ears', 'common', 'They twitch when you least expect it.', (s) => {
  const v = new Vox();
  for (let y = 0; y < 5; y++) for (let x = -2 + Math.ceil(y / 2); x <= 1 - Math.floor(y / 2); x++) v.box(x, y, -1, 1, 1, 2, x > -2 + Math.ceil(y / 2) && x < 1 - Math.floor(y / 2) && y < 4 ? 0xff9ec7 : 0x2d2d38);
  return v;
}, (s) => [twitch('z', s * 18, 4, 0.2, s > 0 ? 0 : 0.5)]);
ears('ears_bunny', 'Bunny Ears', 'rare', 'Long and floppy; they bounce as you walk.', () => {
  const v = new Vox();
  v.box(-1, 0, 0, 3, 10, 1, 0xf2f2f2).box(0, 1, 1, 1, 8, 1, 0xffb3c8).box(-1, 10, 0, 3, 1, 1, 0xe6e6e6);
  return v;
}, (s) => [sway('x', 14, 0.9, s > 0 ? 0 : 0.3), sway('z', 6, 0.6)]);
ears('ears_fox', 'Fox Ears', 'rare', 'Orange, fluffy, with white tufts.', () => {
  const v = new Vox();
  for (let y = 0; y < 6; y++) for (let x = -2 + Math.floor(y / 2); x <= 2 - Math.floor(y / 2); x++) v.box(x, y, -1, 1, 1, 2, y >= 4 ? 0x2a1a12 : Math.abs(x) <= 1 - Math.floor(y / 3) && y < 4 ? 0xfff1e0 : 0xf07a1f);
  return v;
}, (s) => [twitch('x', 20, 5, 0.25, s > 0 ? 0.2 : 0.6)]);
ears('ears_bear', 'Bear Ears', 'common', 'Round and cuddly.', () => new Vox().sphere(0, 1.5, 0, 2.2, (x, y, z, dx, dy, dz) => (dz > 0.2 && Math.abs(dx) < 0.5 && dy < 0.4 ? 0xd9a48a : 0x7a4a2c), 0, 2.2, 1.2), () => [sway('x', 5, 0.5)]);

// ------------------------------------------------------------------ things floating over your head

function floater(id, name, rarity, desc, vox, anims, effects = [], y = 9, extra = []) {
  hat(id, name, rarity, desc, [part({ p: [0, y, 0], a: anims, vox }), ...extra], effects);
}

function cloudVox(light, dark, seed) {
  const R = rng(seed);
  const v = new Vox();
  const blobs = [[0, 0, 0, 3.4], [-3.5, -0.8, 0.5, 2.6], [3.5, -0.6, -0.3, 2.8], [1.5, 1.6, 0.4, 2.4], [-1.8, 1.2, -0.8, 2.2], [0, -0.5, 2.2, 2.2], [0.5, -0.4, -2.4, 2.3]];
  for (const [x, y, z, r] of blobs) v.sphere(x, y, z, r + R() * 0.3, (px, py) => mix(dark, light, Math.min(1, Math.max(0, (py + 3) / 6))));
  return v;
}

floater('cloud_nimbus', 'Nimbus Cloud', 'rare', 'Your own little cloud. It rains when it feels like it.', cloudVox(0xffffff, 0xb9b2ff, 3), [bob(1, 0.4), sway('z', 4, 0.3)],
  [fx('drop', { at: [0, 7, 0], rate: 12, v: [0, -22, 0], sp: 2, life: 0.6, g: -30, c: [0x6fb6ff, 0x9fd4ff], glow: false })], 10);
floater('cloud_storm', 'Storm Cloud', 'epic', 'Dark, grumbly, and it throws lightning.', cloudVox(0x6b6f80, 0x2a2c36, 7), [bob(0.8, 0.5), sway('z', 3, 0.7)],
  [fx('drop', { at: [0, 7, 0], rate: 16, v: [0, -26, 0], sp: 3, life: 0.5, g: -30, c: [0x6f7fb6], glow: false }), fx('spark', { at: [0, 6, 0], rate: 6, v: [0, -30, 0], sp: 12, life: 0.25, c: [0xfff27a, 0xffffff] })], 10,
  [part({ p: [1, 5, 0], a: [pulse(0.6, 3.1)], vox: new Vox().line([0, 0, 0], [-1, -2, 0], 0xfff27a, GLOW | FLICKER).line([-1, -2, 0], [1, -3, 0], 0xfff27a, GLOW | FLICKER).line([1, -3, 0], [0, -6, 0], 0xfff27a, GLOW | FLICKER) })]);

{
  const sun = new Vox().sphere(0, 0, 0, 3.5, (x, y, z, dx, dy) => mix(0xff8a1a, 0xfff27a, (dy + 1) / 2), GLOW | FLICKER);
  const rays = new Vox();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    rays.line([Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0], [Math.cos(a) * (k % 2 ? 6.5 : 8), Math.sin(a) * (k % 2 ? 6.5 : 8), 0], 0xffd35c, GLOW);
  }
  floater('mini_sun', 'Mini Sun', 'legendary', 'A tiny star of your own, rays spinning around it.', sun, [bob(1, 0.3)],
    [fx('ember', { at: [0, 11, 0], rate: 10, v: [0, 2, 0], sp: 10, life: 0.9, c: [0xffb23f, 0xfff27a, 0xff6a1a] })], 11,
    [part({ p: [0, 11, 0], a: [bob(1, 0.3), spin('z', 45)], vox: rays })]);
}
{
  const planet = new Vox().sphere(0, 0, 0, 3.6, (x, y) => [0x3d7be0, 0x5fa0ff, 0x2fd67b, 0x3d7be0, 0xe8f6ff][Math.abs(Math.round(y)) % 5]);
  const ring = new Vox().ring(0, 0, 0, 6, 1.4, (x, y, z, a) => mix(0xffd9a8, 0xc98b5a, (Math.sin(a * 5) + 1) / 2), 0);
  const moon = new Vox().sphere(0, 0, 0, 1.2, 0xd9dee8);
  floater('mini_planet', 'Tiny Planet', 'epic', 'Ringed, with its own moon.', planet, [bob(1, 0.3), spin('y', 25)], [], 11,
    [part({ p: [0, 11, 0], r: [22, 0, 10], a: [bob(1, 0.3), spin('y', -35)], vox: ring }), part({ p: [0, 11, 0], a: [bob(1, 0.3), orbit(9, 70)], vox: moon })]);
}
{
  const c = new Vox();
  for (let y = -5; y <= 5; y++) {
    const r = 3.2 * (1 - Math.abs(y) / 5.5);
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) if (Math.abs(x) + Math.abs(z) <= r + 0.3) c.set(x, y, z, mix(0x22d3ee, 0xe8fbff, (y + 5) / 10), GLOW | SEE);
  }
  const shard = new Vox().box(0, 0, 0, 1, 2, 1, 0x9fe7ff, GLOW);
  floater('crystal_float', 'Floating Crystal', 'epic', 'A glowing crystal with shards orbiting it.', c, [bob(1.2, 0.35), spin('y', 50)],
    [fx('spark', { at: [0, 10, 0], rate: 6, v: [0, 0, 0], sp: 6, life: 1, c: [0x9fe7ff, 0xffffff] })], 10,
    [0, 1, 2, 3].map((k) => part({ p: [0, 10, 0], a: [bob(1.2, 0.35), orbit(7, 120, k * 90)], vox: shard })));
}
{
  const b = new Vox().box(-4, -4, -4, 8, 8, 8, (x, y, z) => ((x === -4 || x === 3) && (y === -4 || y === 3) ? 0x9c6a0c : 0xe8a317));
  const q = ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'];
  for (const [plane, pos] of [['xy', 4], ['xy', -5]]) b.art(q, { '#': [0xfff3b0, GLOW] }, { x: 0, y: -3, z: pos, plane });
  b.art(q, { '#': [0xfff3b0, GLOW] }, { x: 4, y: -3, z: 0, plane: 'zy' }).art(q, { '#': [0xfff3b0, GLOW] }, { x: -5, y: -3, z: 0, plane: 'zy' });
  floater('lucky_block', 'Lucky Block', 'rare', 'It bounces and spins. What\'s inside? Nobody knows.', b, [hop(3, 0.8), spin('y', 90)], [], 9);
}
{
  const h = new Vox().art(['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'], { '#': [0xff3b7a, GLOW] }, { y: -3, z: 0, depth: 3 });
  h.art(['.#.....', '#......'], { '#': [0xffc2de, GLOW] }, { y: 2, z: 3, depth: 1 });
  floater('heart_float', 'Floating Heart', 'rare', 'It beats. With love.', h, [bob(1, 0.4), pulse(0.14, 1.3), spin('y', 40)],
    [fx('heart', { at: [0, 9, 0], rate: 2, v: [0, 5, 0], sp: 5, life: 1.6, c: [0xff3b7a, 0xff9ec7] })], 10);
}
{
  const f = new Vox();
  for (let y = 0; y < 9; y++) {
    const r = 3.4 * Math.sin(((y + 1) / 10) * Math.PI) * (1 - y / 14);
    f.cyl(0, y - 4, (y / 9) * -0.8, 1, r, r, mix(0xfff27a, 0xff3a0a, y / 9), GLOW | FLICKER);
  }
  f.sphere(0, -2, 0, 1.6, 0xffffff, GLOW);
  floater('fire_orb', 'Fire Orb', 'epic', 'A living flame that follows your head around.', f, [bob(1, 0.6), sway('z', 6, 1.4)],
    [fx('ember', { at: [0, 12, 0], rate: 14, v: [0, 10, 0], sp: 4, life: 0.8, c: [0xffb23f, 0xff5a1a, 0xfff27a] })], 10);
}
{
  const bh = new Vox().sphere(0, 0, 0, 3, 0x050508);
  const disk = new Vox().ring(0, 0, 0, 6, 3, (x, y, z, a) => mix(0xff8a1a, 0x7c3aed, (Math.sin(a * 3) + 1) / 2), GLOW | FLICKER);
  const disk2 = new Vox().ring(0, 0, 0, 8.5, 1.2, 0xc4a8ff, GLOW);
  floater('black_hole', 'Black Hole', 'mythic', 'Nothing escapes. Not even your hat hair.', bh, [bob(0.8, 0.3)],
    [fx('spark', { at: [0, 12, 0], rate: 16, v: [0, 0, 0], sp: -9, life: 0.9, c: [0xc4a8ff, 0xff8a1a, 0xffffff] })], 12,
    [part({ p: [0, 12, 0], r: [16, 0, 0], a: [bob(0.8, 0.3), spin('y', 200)], vox: disk }), part({ p: [0, 12, 0], r: [-10, 0, 8], a: [bob(0.8, 0.3), spin('y', -120)], vox: disk2 })]);
}
{
  // the Nimbus logo: a block inside a tilted halo ring
  const block = new Vox().box(-3, -3, -3, 6, 6, 6, (x, y, z) => (y === 2 ? 0xc4b5fd : x === -3 || z === -3 ? 0x6d4df0 : 0x8b6bff));
  const ring = new Vox().ring(0, 0, 0, 6.5, 1.3, (x, y, z, a) => mix(0x22d3ee, 0xf472b6, (Math.cos(a) + 1) / 2), GLOW);
  floater('nimbus_logo', 'Nimbus Emblem', 'legendary', 'The Nimbus block and its halo, spinning above you.', block, [bob(1, 0.4), spin('y', 60)],
    [fx('spark', { at: [0, 11, 0], rate: 6, v: [0, 2, 0], sp: 6, life: 1.2, c: [0x22d3ee, 0xa78bfa, 0xf472b6] })], 11,
    [part({ p: [0, 11, 0], r: [0, 0, -20], a: [bob(1, 0.4), spin('y', -90)], vox: ring })]);
}

// ------------------------------------------------------------------ helmets and caps

{
  const v = new Vox();
  v.sphere(-0.5, -1, -0.5, 5.3, (x, y, z, dx, dy) => (Math.abs(dx) < 0.12 || Math.abs(dy - 0.2) < 0.08 ? 0xc98b2e : 0xb8c0cc), 0, 5.8, 5.3);
  for (let x = -5; x <= 4; x++) for (let z = -5; z <= 4; z++) for (let y = -9; y <= -1; y++) if (x >= -4 && x <= 3 && z >= -4 && z <= 3) v.set(x, y, z, null);
  for (let y = -9; y < -2; y++) for (let x = -5; x <= 4; x++) for (let z = -5; z <= 4; z++) v.set(x, y, z, null);
  band(v, -3, 1, 0xc98b2e);
  v.box(-1, -6, 4, 2, 4, 1, 0xb8c0cc); // nose guard
  for (const s of [-1, 1]) v.line([s * 5, -1, 0], [s * 8, 3, 0], (t) => mix(0xf1e6c8, 0xa89468, t), 0, 1.1).line([s * 8, 3, 0], [s * 8.5, 7, -1], 0xf1e6c8, 0, 0.8);
  hat('helm_viking', 'Viking Helmet', 'rare', 'Steel, brass and two proud horns.', [part({ vox: v })]);
}
{
  const cap = new Vox();
  band(cap, -2, 3, (x, y, z) => ((x + z) & 1 ? 0xff3b3b : 0xffd24a), 0, 0);
  cap.sphere(-0.5, 0, -0.5, 4.6, (x, y, z) => [0xff3b3b, 0xffd24a, 0x3d7be0, 0x2fd67b][((x >= 0) ? 1 : 0) + (z >= 0 ? 2 : 0)], 0, 2.5);
  for (let y = -2; y < 0; y++) for (let x = -4; x <= 3; x++) for (let z = -4; z <= 3; z++) cap.set(x, y, z, null);
  cap.box(-4, -1, 4, 8, 1, 4, 0x3d7be0); // peak
  const prop = new Vox().box(-7, 0, -1, 14, 1, 2, (x) => (x < 0 ? 0xff3b3b : 0xffd24a)).box(-1, 0, -7, 2, 1, 14, (x, y, z) => (z < 0 ? 0x2fd67b : 0x3d7be0)).box(-1, -2, -1, 2, 3, 2, 0xdddddd);
  hat('cap_propeller', 'Propeller Cap', 'rare', 'The propeller spins so fast it blurs.', [part({ vox: cap }), part({ p: [0, 3.5, 0], a: [spin('y', 1080)], vox: prop })]);
}
{
  const v = new Vox();
  band(v, -1, 3, 0xffffff, 0, 0);
  for (const [x, z, r] of [[0, 0, 4], [-2.5, -1, 3], [2.5, 1, 3], [0, 2.5, 3], [-1, -2.5, 3], [2, -2, 3], [-2.5, 2, 2.6]]) v.sphere(x - 0.5, 5, z - 0.5, r, (px, py, pz) => (py > 6 ? 0xffffff : 0xf0f0f0), 0, 3, r);
  v.box(-4, 2, -4, 8, 2, 8, 0xf7f7f7);
  hat('hat_chef', 'Chef\'s Hat', 'common', 'Puffy, spotless, and ready to cook.', [part({ vox: v })]);
}
{
  const v = new Vox();
  for (let x = -8; x <= 7; x++) for (let z = -8; z <= 7; z++) {
    const d = Math.max(Math.abs(x + 0.5), Math.abs(z + 0.5));
    const tri = Math.abs(x + 0.5) + Math.abs(z + 0.5);
    if (tri < 11 && d < 8) v.set(x, Math.round(0 + (d > 5 ? (d - 5) * 0.8 : 0)), z, d > 6.8 ? 0xe8b93a : 0x1a1a1f);
  }
  v.box(-4, 1, -4, 8, 5, 8, 0x1a1a1f).box(-3, 6, -3, 6, 1, 6, 0x24242b);
  v.art(['.###.', '#.#.#', '#####', '.#.#.'], { '#': 0xf2f2f2 }, { y: 1, z: 4 });
  const feather = new Vox().line([0, 0, 0], [0, 9, -3], (t) => mix(0xd9312f, 0xffd24a, t), 0, 0.9);
  hat('hat_pirate', 'Pirate Tricorn', 'epic', 'Skull and crossbones, with a feather that flutters.', [part({ vox: v }), part({ p: [4, 5, -2], a: [sway('x', 10, 1.1)], vox: feather })]);
}
{
  const v = new Vox();
  for (let x = -9; x <= 8; x++) for (let z = -9; z <= 8; z++) {
    const d = Math.hypot(x + 0.5, z + 0.5);
    if (d <= 8.8) v.set(x, Math.round(Math.pow(Math.abs(x + 0.5) / 8.8, 2) * 3), z, d > 8 ? 0x5c3a1e : 0x8a5a2e);
  }
  v.cyl(-0.5, 1, -0.5, 6, 4.6, 3.8, (x, y, z, t) => (t < 0.25 ? 0x3a2412 : 0x8a5a2e));
  v.box(-3, 6, -1, 6, 1, 2, 0x7a4e26);
  hat('hat_cowboy', 'Cowboy Hat', 'common', 'Yeehaw. A proper curved brim and a leather band.', [part({ vox: v })]);
}
{
  const v = new Vox();
  band(v, -3, 4, (x, y) => (y === -3 ? 0xc98b2e : 0x1a1a24));
  v.sphere(-0.5, 0, -0.5, 5, (x, y, z, dx, dy) => ((Math.round(dy * 6) & 1) ? 0x262634 : 0x1a1a24), 0, 3.4);
  for (let y = -3; y < 0; y++) for (let x = -4; x <= 3; x++) for (let z = -4; z <= 3; z++) v.set(x, y, z, null);
  for (const s of [-1, 1]) v.box(s > 0 ? 5 : -8, -4, -3, 3, 4, 6, 0x262634); // neck guards
  const crest = new Vox();
  for (const s of [-1, 1]) crest.line([0, 0, 0], [s * 7, 7, 1], (t) => mix(0xffd24a, 0xfff3b0, t), GLOW, 0.7);
  crest.sphere(0, 0, 0, 1.4, 0xff3b3b, GLOW);
  hat('helm_samurai', 'Samurai Kabuto', 'legendary', 'Lacquered black steel with a golden crest that shines.', [part({ vox: v }), part({ p: [0, 1, 5], a: [pulse(0.05, 0.8)], vox: crest })],
    [fx('spark', { at: [0, 6, 6], rate: 3, v: [0, 3, 0], sp: 4, life: 1, c: [0xffd24a] })]);
}
{
  const v = new Vox();
  for (let j = 0; j < 13; j++) v.cyl(-0.5, j, -0.5, 1, 4.8 * (1 - j / 13) + 0.3, 4.8 * (1 - j / 13) + 0.3, (Math.floor(j / 2) % 2) ? 0xff6fd8 : 0x6ff2ff);
  for (let k = 0; k < 9; k++) v.set(Math.round(Math.cos(k) * 3), Math.floor(k * 1.3), Math.round(Math.sin(k) * 3), 0xffe16f, GLOW);
  const pom = new Vox().sphere(0, 0, 0, 1.6, 0xffe16f, GLOW | RAINBOW);
  hat('hat_party', 'Party Hat', 'common', 'Striped, sparkly, and it throws confetti.', [part({ vox: v }), part({ p: [0, 13.5, 0], a: [pulse(0.2, 2)], vox: pom })],
    [fx('confetti', { at: [0, 13, 0], rate: 8, v: [0, 14, 0], sp: 10, life: 1.6, g: -30, c: [0xff6fd8, 0x6ff2ff, 0xffe16f, 0x9bff3a], glow: false })]);
}
{
  const v = new Vox();
  band(v, -1, 3, 0xffffff, 0, 1);
  const cone = new Vox();
  for (let j = 0; j < 10; j++) cone.cyl(-0.5, j, -(j * j) / 16, 1, 4.6 * (1 - j / 11) + 0.4, 4.6 * (1 - j / 11) + 0.4, 0xd62834);
  const bobble = new Vox().sphere(0, 0, 0, 1.8, 0xffffff);
  hat('hat_santa', 'Santa Hat', 'rare', 'Jolly, red, with a bobble that swings.', [part({ vox: v }), part({ p: [0, 2, 0], a: [sway('x', 6, 0.8)], vox: cone, c: [part({ p: [0, 10, -6], vox: bobble })] })],
    [fx('snow', { at: [0, 10, -3], rate: 3, v: [0, -4, 0], sp: 5, life: 2, g: 0, c: [0xffffff], glow: false })]);
}
{
  const v = new Vox();
  // the band over the head and two ear cups
  for (let a = 0; a <= 180; a += 4) {
    const r = (a * Math.PI) / 180;
    v.box(Math.round(Math.cos(r) * 5.2) - 1, Math.round(Math.sin(r) * 3) - 1, -1, 2, 1, 2, 0x1d1d24);
  }
  for (const s of [-1, 1]) v.box(s > 0 ? 4 : -7, -7, -2, 3, 5, 4, 0x2d2d3a).box(s > 0 ? 6 : -7, -6, -1, 1, 3, 2, 0x7c5cff, GLOW);
  const parts = [part({ vox: v })];
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) parts.push(part({ p: [s > 0 ? 7.2 : -7.2, -6, k - 1], a: [pulse(0.9, 2 + k * 0.7, k * 0.3)], vox: new Vox().box(0, 0, 0, 1, 3, 1, [0x22d3ee, 0xa78bfa, 0xf472b6][k], GLOW) }));
  hat('headphones', 'Beat Headphones', 'epic', 'The equaliser bars dance to music only you can hear.', parts,
    [fx('note', { at: [6, -2, 0], rate: 1.5, v: [4, 6, 0], sp: 3, life: 1.6, c: [0x22d3ee, 0xf472b6] }), fx('note', { at: [-6, -2, 0], rate: 1.5, v: [-4, 6, 0], sp: 3, life: 1.6, c: [0xa78bfa, 0xffe16f] })]);
}
{
  const parts = [];
  for (const s of [-1, 1]) {
    const stalk = new Vox().line([0, 0, 0], [s * 2, 7, 0], 0x5fd35f, 0, 0.5);
    const tip = new Vox().sphere(0, 0, 0, 1.4, 0x9bff3a, GLOW | FLICKER);
    parts.push(part({ p: [s * 2, 0, 1], a: [sway('z', 12, 0.9, s > 0 ? 0 : 0.5), sway('x', 8, 0.6)], vox: stalk, c: [part({ p: [s * 2, 8, 0], a: [pulse(0.3, 2.2)], vox: tip })] }));
  }
  hat('antennae_alien', 'Alien Antennae', 'rare', 'Receiving signals from the mothership.', parts, [fx('spark', { at: [0, 8, 1], rate: 4, v: [0, 3, 0], sp: 5, life: 0.8, c: [0x9bff3a] })]);
}
{
  const v = new Vox();
  const flowers = [0xff9ec7, 0xffffff, 0xffe16f, 0xc084fc, 0xff6f8f];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const x = Math.cos(a) * 5;
    const z = Math.sin(a) * 5;
    v.sphere(x - 0.5, 0, z - 0.5, 1.4, flowers[k % flowers.length]).set(Math.round(x - 0.5), 1, Math.round(z - 0.5), 0xffe16f);
    v.set(Math.round(Math.cos(a + 0.2) * 5.4), 0, Math.round(Math.sin(a + 0.2) * 5.4), 0x3fae4f);
  }
  hat('crown_flower', 'Flower Crown', 'rare', 'Fresh blossoms, trailing cherry petals.', [part({ a: [bob(0.3, 0.5)], vox: v })],
    [fx('leaf', { at: [0, 1, 0], rate: 3, v: [0, -3, 0], sp: 6, life: 2.2, c: [0xff9ec7, 0xffc2de], glow: false })]);
}

export default items;
