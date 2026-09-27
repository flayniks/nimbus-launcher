// Wings and auras. Wings: the origin is between the shoulder blades on the back, +z points into
// the body, so wings spread along ±x and trail towards -z. Auras: the origin is on the ground
// under the player, +y up (the player is about 32 units tall).
import { Vox, part, THEMES, GLOW, SEE, RAINBOW, FLICKER, mix, shade, alpha, hsl, rng, spin, sway, flap, bob, orbit, pulse, hop, trick, twitch, fx } from './kit.mjs';

const items = [];
const add = (slot, id, name, rarity, desc, parts, effects = []) => items.push({ id, name, slot, rarity, desc, parts, fx: effects });

/**
 * A pair of wings from one right-hand wing (x > 0). `open` is how far back they sit, `amp` and
 * `speed` how they flap.
 */
function wings(id, name, rarity, desc, right, { open = 38, lift = 24, amp = 22, speed = 0.9, effects = [], extra = [] } = {}) {
  const left = right.mirrorX();
  // each wing: flaps in its own plane, is tipped up by `lift` (so it spreads instead of hanging
  // down the arms), then swept back by `open`
  add('wings', id, name, rarity, desc, [
    part({ p: [1, 0, -1.5], r: [0, open, lift], a: [flap('y', -amp, speed)], vox: right }),
    part({ p: [-1, 0, -1.5], r: [0, -open, -lift], a: [flap('y', amp, speed)], vox: left }),
    ...extra,
  ], effects);
}

/**
 * Feathered wing: long primaries at the tip, shorter secondaries, and a raised row of covert
 * feathers along the top, each feather with its own shade and a darker tip.
 */
function feathered(c1, c2, flags = 0, len = 16) {
  const v = new Vox();
  const tipC = shade(c2, 0.82);
  for (let x = 0; x < len; x++) {
    const u = x / (len - 1);
    const top = Math.round(7 + Math.sin(u * Math.PI * 0.85) * 4 - u * 2);
    const long = Math.round(8 + u * 9 + (x % 2) * 1.5); // feathers get longer towards the tip
    const strip = x % 2 ? 0.94 : 1.04;
    for (let y = top - long; y <= top; y++) {
      const k = (top - y) / long;
      const tip = y <= top - long + 1;
      v.set(x, y, 0, tip ? tipC : shade(mix(c1, c2, k * 0.85), strip), flags);
    }
    // coverts: a scalloped row on top, one step towards the viewer
    const cov = 3 + (x % 3 === 1 ? 1 : 0);
    for (let y = top - cov; y <= top + 1; y++) v.set(x, y, 1, shade(mix(c1, c2, 0.15), y === top - cov ? 0.9 : 1.06), flags);
  }
  // the bone along the top edge
  for (let x = 0; x < len; x++) {
    const u = x / (len - 1);
    v.set(x, Math.round(7 + Math.sin(u * Math.PI * 0.85) * 4 - u * 2) + 1, 0, shade(c1, 0.9), flags);
  }
  return v;
}

wings('wings_angel', 'Angel Wings', 'legendary', 'Soft white feathers that shed a little light.', feathered(0xffffff, 0xd9e6ff), {
  effects: [fx('feather', { at: [0, -4, -6], rate: 1.5, v: [0, -3, -3], sp: 4, life: 2.2, c: [0xffffff, 0xf0f4ff], glow: false }), fx('spark', { at: [0, 2, -6], rate: 4, v: [0, -2, -2], sp: 6, life: 1, c: [0xfff3b0] })],
  extra: [part({ p: [0, 15, 0], r: [10, 0, 0], a: [bob(0.5, 0.5), spin('y', 30)], vox: new Vox().ring(0, 0, 0, 4.2, 1.1, 0xffe27a, GLOW) })],
});
wings('wings_demon', 'Demon Wings', 'legendary', 'Leathery bat wings with burning veins.', (() => {
  const v = new Vox();
  for (let x = 0; x < 17; x++) {
    const top = Math.round(5 + x * 0.55 - (x > 12 ? (x - 12) * 1.5 : 0));
    const scallop = 3 + Math.abs(((x % 5) - 2.5)) * 1.6;
    for (let y = Math.round(top - 6 - scallop - x * 0.3); y <= top; y++) v.set(x, y, 0, alpha(mix(0x3a0a12, 0x7a1020, (top - y) / 12), 0.95), SEE);
    v.set(x, top, 0, 0x1a0508);
    if (x % 5 === 0) for (let y = top - 1; y > top - 10 - x * 0.3; y--) v.set(x, y, 0, 0xff3a2a, GLOW | FLICKER);
  }
  return v;
})(), { amp: 26, speed: 0.8, effects: [fx('ember', { at: [0, 0, -6], rate: 8, v: [0, 4, -2], sp: 6, life: 1, c: [0xff3a2a, 0xff8a1a] })] });
wings('wings_prism', 'Prism Butterfly Wings', 'mythic', 'See-through butterfly wings that shift through every colour.', (() => {
  const v = new Vox();
  const upper = (x, y) => Math.hypot((x - 7) / 8, (y - 5) / 7) <= 1;
  const lower = (x, y) => Math.hypot((x - 5) / 6, (y + 5) / 5) <= 1;
  for (let x = 0; x < 16; x++) for (let y = -10; y < 13; y++) {
    if (!upper(x, y) && !lower(x, y)) continue;
    const edge = !(upper(x - 1, y) || lower(x - 1, y)) || !(upper(x + 1, y) || lower(x + 1, y)) || !(upper(x, y + 1) || lower(x, y + 1)) || !(upper(x, y - 1) || lower(x, y - 1));
    v.set(x, y, 0, edge ? 0x1d1d24 : alpha(hsl((x + y) / 30, 0.9, 0.65), 0.7), edge ? 0 : GLOW | SEE | RAINBOW);
  }
  return v;
})(), { open: 20, amp: 35, speed: 1.2, effects: [fx('spark', { at: [0, 0, -4], rate: 10, v: [0, -2, -3], sp: 7, life: 1.4, c: [0xff6fd8, 0x6ff2ff, 0xffe16f] })] });
wings('wings_fairy', 'Glass Fairy Wings', 'epic', 'Four delicate glass wings that buzz quickly.', (() => {
  const v = new Vox();
  for (let x = 0; x < 12; x++) for (let y = 0; y < 9; y++) if (Math.hypot((x - 6) / 6.5, (y - 4) / 4) <= 1) v.set(x, y + 1, 0, alpha(0xdffbff, 0.45), GLOW | SEE);
  for (let x = 0; x < 9; x++) for (let y = 0; y < 6; y++) if (Math.hypot((x - 4.5) / 5, (y - 3) / 3) <= 1) v.set(x, y - 7, 0, alpha(0xf5dcff, 0.45), GLOW | SEE);
  for (let x = 1; x < 11; x += 3) v.line([0, 1, 0], [x, 8, 0], 0xffffff, GLOW);
  return v;
})(), { open: 18, amp: 30, speed: 5, effects: [fx('spark', { at: [0, 0, -4], rate: 12, v: [0, -3, -2], sp: 5, life: 1.2, c: [0xffe16f, 0x9fe7ff, 0xff9ec7] })] });
wings('wings_dragon', 'Dragon Wings', 'mythic', 'Huge scaled wings with glowing membranes.', (() => {
  const v = new Vox();
  for (let x = 0; x < 20; x++) {
    const top = Math.round(4 + x * 0.6 - (x > 15 ? (x - 15) * 2.2 : 0));
    for (let y = Math.round(top - 5 - x * 0.7); y <= top; y++) {
      const bone = x % 6 === 0 || y === top;
      v.set(x, y, 0, bone ? 0x2a4a1a : alpha(mix(0x3fae4f, 0xb8ff5a, (top - y) / 16), 0.9), bone ? 0 : SEE | (x % 6 === 3 ? GLOW : 0));
    }
    if (x % 6 === 0) v.set(x, top + 1, 0, 0xe8e0c0).set(x, top + 2, 0, 0xe8e0c0);
  }
  return v;
})(), { amp: 18, speed: 0.6, open: 32 });
wings('wings_mech', 'Mech Wings', 'mythic', 'Armoured panels with neon light lines, folding in and out.', (() => {
  const v = new Vox();
  for (let k = 0; k < 5; k++) {
    const len = 14 - k * 2;
    const y0 = 6 - k * 3;
    v.box(0, y0, 0, len, 2, 1, (x) => (x % 4 === 3 ? 0x5a6275 : 0x3a3f52));
    v.box(1, y0 + 1, 0, len - 2, 1, 1, k % 2 ? 0x22d3ee : 0xf472b6, GLOW | FLICKER);
    v.set(len, y0, 0, 0xd9dee8);
  }
  return v;
})(), { open: 35, amp: 30, speed: 0.4, effects: [fx('spark', { at: [0, -6, -4], rate: 12, v: [0, -14, -4], sp: 3, life: 0.4, c: [0x22d3ee, 0xffffff] })] });
wings('wings_phoenix', 'Phoenix Wings', 'mythic', 'Wings made of fire, raining embers as they beat.', feathered(0xfff27a, 0xff3a0a, GLOW | FLICKER, 18), {
  amp: 26, speed: 1.1,
  effects: [fx('ember', { at: [0, 0, -6], rate: 26, v: [0, 6, -4], sp: 8, life: 0.9, c: [0xffb23f, 0xff5a1a, 0xfff27a] })],
});
wings('wings_frost', 'Frost Crystal Wings', 'legendary', 'Wings of shattered ice, trailing snowflakes.', (() => {
  const v = new Vox();
  const R = rng(42);
  for (let k = 0; k < 7; k++) {
    const a = (-30 + k * 22) * (Math.PI / 180);
    const len = 8 + R() * 8;
    v.line([0, 0, 0], [Math.cos(a) * len + 2, Math.sin(a) * len + 3, 0], (t) => alpha(mix(0xe8fbff, 0x4cc3f0, t), 0.8), GLOW | SEE, 0.9);
  }
  return v;
})(), { amp: 14, speed: 0.7, effects: [fx('snow', { at: [0, 0, -6], rate: 10, v: [0, -5, -2], sp: 6, life: 1.8, c: [0xffffff, 0xd8f4ff], glow: false })] });
wings('wings_void', 'Void Wings', 'mythic', 'Wings cut from the night sky, full of drifting stars.', (() => {
  const v = feathered(0x14062e, 0x2a1452, 0, 17);
  const R = rng(9);
  for (const c of v.cells.values()) if (R() < 0.12) { c.c = R() < 0.5 ? 0xffffff : 0xb57bff; c.f = GLOW | FLICKER; }
  return v;
})(), { effects: [fx('spark', { at: [0, 0, -6], rate: 14, v: [0, 0, -3], sp: 6, life: 1.4, c: [0xb57bff, 0x22d3ee, 0xffffff] })] });
wings('wings_leaf', 'Forest Wings', 'epic', 'Grown from living leaves; a few always drift away.', (() => {
  const v = new Vox();
  const R = rng(5);
  for (let k = 0; k < 9; k++) {
    const cx = 2 + k * 1.6;
    const cy = 5 - k * 1.3 + R() * 2;
    v.sphere(cx, cy, 0, 2.2 + R(), (x, y) => [0x3fae4f, 0x5fd35f, 0x2f8a3a, 0xd9c23a][Math.floor(R() * (k > 6 ? 4 : 3))], 0, 2.2, 0.6);
  }
  v.line([0, 0, 0], [15, -6, 0], 0x6a4a2a);
  return v;
})(), { amp: 16, speed: 0.6, effects: [fx('leaf', { at: [0, -2, -6], rate: 3, v: [0, -3, -2], sp: 5, life: 2.4, c: [0x5fd35f, 0xd9c23a], glow: false })] });

// ------------------------------------------------------------------ 1.7.0: more wings

wings('wings_bat', 'Bat Wings', 'common', 'Small, leathery and a bit spooky.', (() => {
  const v = new Vox();
  for (let x = 0; x < 11; x++) {
    const top = Math.round(4 + x * 0.35);
    const bottom = Math.round(top - 4 - Math.abs(((x % 4) - 1.5)) * 1.3 - x * 0.2);
    for (let y = bottom; y <= top; y++) v.set(x, y, 0, y === top || x % 4 === 3 ? 0x2a2230 : 0x4a3a52);
  }
  return v;
})(), { amp: 26, speed: 1.4 });
wings('wings_bee', 'Bee Wings', 'rare', 'See-through and buzzing so fast they blur.', (() => {
  const v = new Vox();
  for (let x = 0; x < 9; x++) for (let y = -3; y <= 3; y++) if ((x - 4) ** 2 / 20 + y * y / 9 <= 1) v.set(x, y + (x > 4 ? 2 : 0), 0, alpha(y === 0 ? 0x9aa3b5 : 0xe8f6ff, 0.55), SEE);
  return v;
})(), { open: 28, lift: 30, amp: 30, speed: 9, effects: [fx('pollen', { at: [0, -2, -3], rate: 3, v: [0, -3, -1], sp: 2, life: 1, c: [0xffe16f], glow: false })] });
wings('wings_cloud', 'Cloud Wings', 'epic', 'Puffy wings made of cloud. They leave a little mist behind.', (() => {
  const v = new Vox();
  const R = rng(21);
  for (let k = 0; k < 8; k++) v.sphere(1.5 + k * 1.7, 6 - k * 0.7 + R() * 1.4, 0, 2.4 - k * 0.12 + R() * 0.5, (x, y) => mix(0xd9d4ff, 0xffffff, Math.min(1, Math.max(0, (y + 2) / 8))), 0, 2.2 - k * 0.1, 1.2);
  return v;
})(), { amp: 14, speed: 0.5, effects: [fx('smoke', { at: [0, 0, -5], rate: 4, v: [0, -2, -3], sp: 3, life: 1.5, c: [0xffffff, 0xe8e4ff], glow: false })] });
wings('wings_rainbow', 'Rainbow Wings', 'legendary', 'Feathers in every colour, rippling like a rainbow.', feathered(0xff6fd8, 0x6ff2ff, RAINBOW), {
  effects: [fx('confetti', { at: [0, -2, -6], rate: 5, v: [0, -3, -3], sp: 6, life: 1.6, g: -20, c: [0xff6fd8, 0x6ff2ff, 0xffe16f, 0x9bff3a], glow: false })],
});
wings('wings_crystal', 'Amethyst Wings', 'epic', 'Shards of amethyst, humming with energy.', (() => {
  const v = new Vox();
  for (let k = 0; k < 6; k++) {
    const len = 6 + k * 1.6;
    const ang = (0.9 - k * 0.28);
    v.line([0.5, 0, 0], [0.5 + Math.cos(ang) * len, Math.sin(ang) * len, 0], (t) => mix(0x7c3aed, 0xe0c8ff, t), 0, 0.9);
  }
  for (const c of v.cells.values()) c.f = (c.x + c.y) % 5 === 0 ? GLOW : 0;
  return v;
})(), { open: 40, amp: 12, speed: 0.6, effects: [fx('spark', { at: [0, 2, -5], rate: 7, v: [0, 1, -2], sp: 6, life: 1, c: [0xc4a8ff, 0xffffff] })] });
wings('wings_storm', 'Storm Wings', 'mythic', 'Wings of living lightning. They crackle when you move.', (() => {
  const v = new Vox();
  for (let k = 0; k < 5; k++) {
    let x = 0.5;
    let y = 1 - k * 0.5;
    const pts = [];
    for (let i = 0; i < 6; i++) { pts.push([x, y]); x += 2.4; y += (i % 2 ? -1.8 : 2.6) - k * 0.55; }
    for (let i = 0; i < pts.length - 1; i++) v.line([pts[i][0], pts[i][1], 0], [pts[i + 1][0], pts[i + 1][1], 0], mix(0x22d3ee, 0xffffff, k / 5), GLOW | FLICKER);
  }
  return v;
})(), { open: 36, amp: 16, speed: 1.1, effects: [fx('spark', { at: [0, 2, -5], rate: 14, v: [0, 0, -3], sp: 12, life: 0.35, c: [0x22d3ee, 0xffffff, 0xfff27a] })] });
wings('wings_paper', 'Paper Plane Wings', 'rare', 'Folded from the finest paper. Aerodynamic, probably.', (() => {
  const v = new Vox();
  for (let x = 0; x < 13; x++) for (let y = 0; y <= Math.max(0, 5 - Math.floor(x / 2.4)); y++) v.set(x, y - 2, 0, (x + y) % 6 === 0 ? 0xd9dee8 : 0xffffff);
  return v;
})(), { open: 42, lift: 6, amp: 8, speed: 0.7 });

// ------------------------------------------------------------------ auras

add('aura', 'aura_runes', 'Rune Circle', 'legendary', 'A magic circle turns under your feet, runes glowing.', [
  part({ p: [0, 0.6, 0], a: [spin('y', 30)], vox: (() => {
    const v = new Vox().ring(0, 0, 0, 13, 1, 0xa78bfa, GLOW).ring(0, 0, 0, 10, 0.8, 0x7c3aed, GLOW | FLICKER);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      v.art([['#.#', '.#.', '#.#'], ['###', '#..', '###'], ['.#.', '###', '.#.'], ['#.#', '###', '#.#']][k % 4], { '#': [0xe0d0ff, GLOW] }, { x: Math.round(Math.cos(a) * 11.5), z: Math.round(Math.sin(a) * 11.5), plane: 'xz' });
    }
    return v;
  })() }),
  part({ p: [0, 0.9, 0], a: [spin('y', -60)], vox: (() => {
    const v = new Vox();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const b = a + (Math.PI * 2) / 3;
      v.line([Math.cos(a) * 9.5, 0, Math.sin(a) * 9.5], [Math.cos(b) * 9.5, 0, Math.sin(b) * 9.5], 0xc4a8ff, GLOW);
    }
    return v;
  })() }),
], [fx('spark', { at: [0, 0, 0], rate: 10, v: [0, 10, 0], sp: 9, life: 1.2, c: [0xa78bfa, 0xe0d0ff] })]);
add('aura', 'aura_flames', 'Ring of Fire', 'epic', 'A ring of flames dancing around your feet.', [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
  const f = new Vox();
  for (let y = 0; y < 6; y++) f.sphere(0, y, 0, Math.max(0.5, 1.6 - y * 0.25), mix(0xfff27a, 0xff3a0a, y / 6), GLOW | FLICKER);
  return part({ p: [0, 1.7, 0], a: [orbit(12, 40, k * 45), pulse(0.25, 2 + k * 0.2, k / 8)], vox: f });
}), [fx('ember', { at: [0, 1, 0], rate: 18, v: [0, 12, 0], sp: 11, life: 0.8, c: [0xffb23f, 0xff5a1a] })]);
add('aura', 'aura_blizzard', 'Blizzard', 'epic', 'Your own personal snowstorm.', [0, 1, 2, 3, 4, 5].map((k) => part({ p: [0, 4 + k * 4, 0], a: [orbit(12 + (k % 2) * 3, 80 + k * 15, k * 60), bob(1.5, 0.6, k / 6)], vox: new Vox().art(['.#.', '###', '.#.'], { '#': 0xffffff }, { plane: 'xy' }) })),
  [fx('snow', { at: [0, 30, 0], rate: 14, v: [0, -8, 0], sp: 12, life: 3, c: [0xffffff, 0xd8f4ff], glow: false })]);
add('aura', 'aura_gems', 'Orbiting Gems', 'legendary', 'Five precious gems circle you, sparkling.', [0xff3b5c, 0x22d3ee, 0x9bff3a, 0xffd24a, 0xb57bff].map((c, k) => {
  const g = new Vox();
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) + Math.abs(y) + Math.abs(z) <= 2) g.set(x, y, z, mix(c, 0xffffff, y > 0 ? 0.35 : 0), GLOW);
  return part({ p: [0, 16, 0], a: [orbit(13, 55, k * 72), bob(4, 0.35, k / 5), spin('y', 120)], vox: g });
}), [fx('spark', { at: [0, 16, 0], rate: 8, v: [0, 0, 0], sp: 12, life: 1, c: [0xffffff, 0xffe27a] })]);
add('aura', 'aura_music', 'Music Notes', 'rare', 'Notes float around you like you\'re always humming.', [0, 1, 2, 3].map((k) => part({ p: [0, 18, 0], a: [orbit(13, 45, k * 90), bob(3, 0.5, k / 4)], vox: new Vox().art(k % 2 ? ['.##', '.#.', '.#.', '##.', '##.'] : ['.###', '.#.#', '.#.#', '##.#', '##..'], { '#': [[0x22d3ee, 0xf472b6, 0xffe16f, 0x9bff3a][k], GLOW] }, { plane: 'xy' }) })),
  [fx('note', { at: [0, 20, 0], rate: 2, v: [0, 5, 0], sp: 8, life: 1.6, c: [0x22d3ee, 0xf472b6, 0xffe16f] })]);
add('aura', 'aura_nimbus', 'Nimbus Rings', 'mythic', 'Three halo rings orbit you like the Nimbus logo.', [
  part({ p: [0, 16, 0], r: [0, 0, 28], a: [spin('y', 80)], vox: new Vox().ring(0, 0, 0, 15, 1.2, (x, y, z, a) => mix(0x22d3ee, 0xa78bfa, (Math.cos(a) + 1) / 2), GLOW) }),
  part({ p: [0, 16, 0], r: [0, 60, 28], a: [spin('y', -65)], vox: new Vox().ring(0, 0, 0, 13.5, 1.2, (x, y, z, a) => mix(0xa78bfa, 0xf472b6, (Math.cos(a) + 1) / 2), GLOW) }),
  part({ p: [0, 16, 0], r: [0, -60, 28], a: [spin('y', 50)], vox: new Vox().ring(0, 0, 0, 12, 1.2, (x, y, z, a) => mix(0xf472b6, 0x22d3ee, (Math.cos(a) + 1) / 2), GLOW) }),
], [fx('spark', { at: [0, 16, 0], rate: 10, v: [0, 0, 0], sp: 14, life: 1, c: [0x22d3ee, 0xa78bfa, 0xf472b6] })]);

// ------------------------------------------------------------------ 1.7.0: more auras

/** Things going round you at waist height, bobbing a little. */
function orbiters(id, name, rarity, desc, make, n, { r = 14, y = 16, speed = 50, bobAmp = 3, spinSp = 0, effects = [] } = {}) {
  add('aura', id, name, rarity, desc, Array.from({ length: n }, (_, k) => part({ p: [0, y, 0], a: [orbit(r, speed, (k * 360) / n), bob(bobAmp, 0.4, k / n), ...(spinSp ? [spin('y', spinSp)] : [])], vox: make(k) })), effects);
}

orbiters('aura_hearts', 'Heart Swirl', 'common', 'Little hearts float round you. Aww.', (k) => new Vox().art(['##.##', '#####', '.###.', '..#..'], { '#': [[0xff5a8a, 0xff8ab0, 0xff3b5c][k % 3], GLOW] }, { plane: 'xy' }), 4,
  { speed: 45, effects: [fx('heart', { at: [0, 18, 0], rate: 2, v: [0, 5, 0], sp: 7, life: 1.4, c: [0xff6f8f, 0xffa0c0] })] });
orbiters('aura_leaves', 'Autumn Swirl', 'common', 'A breeze of autumn leaves follows you everywhere.', (k) => new Vox().art(['.##', '###', '##.'], { '#': [0xd9a23a, 0xc4561a, 0xe8c24a, 0x9a3a1a, 0xd97a2a][k % 5] }, { plane: 'xy' }), 5,
  { r: 13, y: 12, speed: 70, bobAmp: 8, spinSp: 120, effects: [fx('leaf', { at: [0, 26, 0], rate: 7, v: [0, -5, 0], sp: 12, life: 2.6, c: [0xd9a23a, 0xc4561a, 0xe8c24a, 0x9a3a1a], glow: false })] });
orbiters('aura_bubbles', 'Bubble Stream', 'common', 'Bubbles rise all around you, like you\'re underwater.', (k) => new Vox().sphere(0, 0, 0, 1.4 + (k % 3) * 0.5, alpha(0xd8f4ff, 0.55), SEE), 6,
  { r: 13, y: 12, speed: 35, bobAmp: 9, effects: [fx('bubble', { at: [0, 2, 0], rate: 9, v: [0, 9, 0], sp: 11, life: 2, c: [0xd8f4ff, 0xb8e8ff], glow: false })] });
orbiters('aura_stars', 'Star Ring', 'rare', 'Five stars circle you, twinkling.', (k) => new Vox().art(['..#..', '.###.', '#####', '.###.', '.#.#.'], { '#': [mix(0xffe16f, 0xffffff, k / 5), GLOW | FLICKER] }, { plane: 'xy' }), 5,
  { r: 15, speed: 60, spinSp: 90, effects: [fx('star', { at: [0, 16, 0], rate: 6, v: [0, 2, 0], sp: 14, life: 1.2, c: [0xffe16f, 0xffffff] })] });
orbiters('aura_sakura', 'Cherry Blossoms', 'rare', 'Pink petals drift down around you.', (k) => new Vox().art(['.#.', '#o#', '.#.'], { '#': [0xff9ec7, 0], o: [0xffe16f, 0] }, { plane: 'xz' }), 5,
  { r: 14, y: 20, speed: 30, bobAmp: 6, spinSp: 60, effects: [
    fx('leaf', { at: [0, 30, 0], rate: 9, v: [0, -4, 0], sp: 14, life: 3, c: [0xff9ec7, 0xffc2de, 0xffe0ef], glow: false }),
    fx('pollen', { at: [0, 12, 0], rate: 3, v: [0, 2, 0], sp: 10, life: 1.6, c: [0xffe0ef], glow: false }),
  ] });
add('aura', 'aura_lightning', 'Static Charge', 'epic', 'You\'re so charged up that sparks jump off you.', [
  part({ p: [0, 1, 0], a: [spin('y', 140)], vox: (() => {
    const v = new Vox();
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * Math.PI * 2;
      const a1 = ((k + 1) / 12) * Math.PI * 2;
      const r0 = 12 + (k % 2 ? 1.5 : -1);
      v.line([Math.cos(a0) * 12.5, 0, Math.sin(a0) * 12.5], [Math.cos(a1) * r0, 0, Math.sin(a1) * r0], 0x9fe7ff, GLOW | FLICKER);
    }
    return v;
  })() }),
], [fx('spark', { at: [0, 14, 0], rate: 22, v: [0, 0, 0], sp: 26, life: 0.25, c: [0x22d3ee, 0xffffff, 0xfff27a] })]);
orbiters('aura_shadow', 'Shadow Cloak', 'epic', 'Dark smoke curls up around you, with red eyes watching.', (k) => {
  const v = new Vox().sphere(0, 0, 0, 2.2, alpha(0x1c1e29, 0.7), SEE, 3, 2.2);
  if (k % 2 === 0) v.set(-1, 1, 2, 0xff3355, GLOW).set(0, 1, 2, 0xff3355, GLOW);
  return v;
}, 4, { r: 13, y: 10, speed: -40, bobAmp: 6, effects: [
  fx('smoke', { at: [0, 2, 0], rate: 12, v: [0, 7, 0], sp: 9, life: 1.8, c: [0x1c1e29, 0x3a3d4f, 0x2a1452], glow: false }),
  fx('spark', { at: [0, 10, 0], rate: 3, v: [0, 3, 0], sp: 9, life: 1, c: [0xff3355] }),
] });
add('aura', 'aura_portal', 'Nether Portal', 'epic', 'A swirl of portal purple spins at your feet.', [
  part({ p: [0, 0.6, 0], a: [spin('y', 70)], vox: (() => {
    const v = new Vox();
    for (let i = 0; i < 90; i++) {
      const t = i / 90;
      const a = t * Math.PI * 4;
      const r = 3 + t * 10;
      v.set(Math.cos(a) * r, 0, Math.sin(a) * r, mix(0x3b0f86, 0xc4a8ff, t), GLOW);
    }
    return v;
  })() }),
], [fx('spark', { at: [0, 1, 0], rate: 14, v: [0, 12, 0], sp: 8, life: 1.2, c: [0xb57bff, 0x7c3aed, 0xe0c8ff] })]);
orbiters('aura_coins', 'Coin Shower', 'legendary', 'Nimbus coins spin round you. Show everyone how rich you are.', () => {
  const v = new Vox();
  for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) if (x * x + y * y <= 5) v.set(x, y, 0, x * x + y * y >= 4 ? 0xe8a317 : 0xffd24a, GLOW);
  v.set(-1, 1, 1, 0x9c6a0c).set(-1, 0, 1, 0x9c6a0c).set(-1, -1, 1, 0x9c6a0c).set(0, 0, 1, 0x9c6a0c).set(1, 1, 1, 0x9c6a0c).set(1, 0, 1, 0x9c6a0c).set(1, -1, 1, 0x9c6a0c);
  return v;
}, 6, { r: 14, speed: 70, spinSp: 200, effects: [fx('spark', { at: [0, 16, 0], rate: 8, v: [0, -4, 0], sp: 14, life: 1, c: [0xffe27a, 0xffffff] })] });
orbiters('aura_swords', 'Blade Dance', 'legendary', 'Four diamond swords circle you, ready for anything.', () => new Vox().art([
  '....#',
  '...#.',
  '..#..',
  '##...',
  '.#...',
], { '#': [0x3fe6e0, 0] }, { plane: 'xy' }).set(0, 1, 0, 0x7a4a2c).set(-1, 1, 0, 0x7a4a2c), 4, { r: 15, y: 17, speed: 80, spinSp: 0, effects: [fx('spark', { at: [0, 17, 0], rate: 5, v: [0, 0, 0], sp: 14, life: 0.8, c: [0xb8fff9] })] });
add('aura', 'aura_galaxy', 'Galaxy Disc', 'mythic', 'A whole spiral galaxy turns under your feet.', [
  part({ p: [0, 0.6, 0], a: [spin('y', 25)], vox: (() => {
    const v = new Vox();
    const R = rng(33);
    for (let arm = 0; arm < 3; arm++) {
      for (let i = 0; i < 70; i++) {
        const t = i / 70;
        const a = t * Math.PI * 3 + (arm * Math.PI * 2) / 3;
        const r = 1.5 + t * 13;
        v.set(Math.cos(a) * r + (R() - 0.5) * 1.5, 0, Math.sin(a) * r + (R() - 0.5) * 1.5, hsl(0.72 - t * 0.35, 0.8, 0.55 + (1 - t) * 0.3), GLOW);
      }
    }
    v.sphere(0, 0, 0, 1.6, 0xfff6c8, GLOW, 0.6, 1.6);
    return v;
  })() }),
  part({ p: [0, 6, 0], a: [orbit(13, 30, 40), bob(2, 0.3)], vox: new Vox().sphere(0, 0, 0, 1.3, 0xff6fd8, GLOW) }),
  part({ p: [0, 9, 0], a: [orbit(11, -40, 200), bob(2, 0.35, 0.5)], vox: new Vox().sphere(0, 0, 0, 1.1, 0x22d3ee, GLOW) }),
], [fx('star', { at: [0, 1, 0], rate: 10, v: [0, 6, 0], sp: 12, life: 1.6, c: [0xffffff, 0xc4a8ff, 0x9fe7ff] })]);

export default items;
