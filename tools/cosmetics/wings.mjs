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
function wings(id, name, rarity, desc, right, { open = 28, amp = 22, speed = 0.9, effects = [], extra = [] } = {}) {
  const left = right.mirrorX();
  add('wings', id, name, rarity, desc, [
    part({ p: [1, 0, -1], r: [0, open, 0], a: [flap('y', -amp, speed)], vox: right }),
    part({ p: [-1, 0, -1], r: [0, -open, 0], a: [flap('y', amp, speed)], vox: left }),
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

// ------------------------------------------------------------------ auras

add('aura', 'aura_runes', 'Rune Circle', 'legendary', 'A magic circle turns under your feet, runes glowing.', [
  part({ p: [0, 0.2, 0], a: [spin('y', 30)], vox: (() => {
    const v = new Vox().ring(0, 0, 0, 13, 1, 0xa78bfa, GLOW).ring(0, 0, 0, 10, 0.8, 0x7c3aed, GLOW | FLICKER);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      v.art([['#.#', '.#.', '#.#'], ['###', '#..', '###'], ['.#.', '###', '.#.'], ['#.#', '###', '#.#']][k % 4], { '#': [0xe0d0ff, GLOW] }, { x: Math.round(Math.cos(a) * 11.5), z: Math.round(Math.sin(a) * 11.5), plane: 'xz' });
    }
    return v;
  })() }),
  part({ p: [0, 0.3, 0], a: [spin('y', -60)], vox: (() => {
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
  return part({ p: [0, 0, 0], a: [orbit(11, 40, k * 45), pulse(0.25, 2 + k * 0.2, k / 8)], vox: f });
}), [fx('ember', { at: [0, 1, 0], rate: 18, v: [0, 12, 0], sp: 11, life: 0.8, c: [0xffb23f, 0xff5a1a] })]);
add('aura', 'aura_blizzard', 'Blizzard', 'epic', 'Your own personal snowstorm.', [0, 1, 2, 3, 4, 5].map((k) => part({ p: [0, 4 + k * 4, 0], a: [orbit(9 + (k % 2) * 3, 80 + k * 15, k * 60), bob(1.5, 0.6, k / 6)], vox: new Vox().art(['.#.', '###', '.#.'], { '#': 0xffffff }, { plane: 'xy' }) })),
  [fx('snow', { at: [0, 30, 0], rate: 14, v: [0, -8, 0], sp: 12, life: 3, c: [0xffffff, 0xd8f4ff], glow: false })]);
add('aura', 'aura_gems', 'Orbiting Gems', 'legendary', 'Five precious gems circle you, sparkling.', [0xff3b5c, 0x22d3ee, 0x9bff3a, 0xffd24a, 0xb57bff].map((c, k) => {
  const g = new Vox();
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) + Math.abs(y) + Math.abs(z) <= 2) g.set(x, y, z, mix(c, 0xffffff, y > 0 ? 0.35 : 0), GLOW);
  return part({ p: [0, 16, 0], a: [orbit(13, 55, k * 72), bob(4, 0.35, k / 5), spin('y', 120)], vox: g });
}), [fx('spark', { at: [0, 16, 0], rate: 8, v: [0, 0, 0], sp: 12, life: 1, c: [0xffffff, 0xffe27a] })]);
add('aura', 'aura_music', 'Music Notes', 'rare', 'Notes float around you like you\'re always humming.', [0, 1, 2, 3].map((k) => part({ p: [0, 18, 0], a: [orbit(11, 45, k * 90), bob(3, 0.5, k / 4)], vox: new Vox().art(k % 2 ? ['.##', '.#.', '.#.', '##.', '##.'] : ['.###', '.#.#', '.#.#', '##.#', '##..'], { '#': [[0x22d3ee, 0xf472b6, 0xffe16f, 0x9bff3a][k], GLOW] }, { plane: 'xy' }) })),
  [fx('note', { at: [0, 20, 0], rate: 2, v: [0, 5, 0], sp: 8, life: 1.6, c: [0x22d3ee, 0xf472b6, 0xffe16f] })]);
add('aura', 'aura_nimbus', 'Nimbus Rings', 'mythic', 'Three halo rings orbit you like the Nimbus logo.', [
  part({ p: [0, 16, 0], r: [70, 0, 0], a: [spin('z', 80)], vox: new Vox().ring(0, 0, 0, 14, 1.2, (x, y, z, a) => mix(0x22d3ee, 0xa78bfa, (Math.cos(a) + 1) / 2), GLOW) }),
  part({ p: [0, 16, 0], r: [70, 60, 0], a: [spin('z', -65)], vox: new Vox().ring(0, 0, 0, 12.5, 1.2, (x, y, z, a) => mix(0xa78bfa, 0xf472b6, (Math.cos(a) + 1) / 2), GLOW) }),
  part({ p: [0, 16, 0], r: [70, -60, 0], a: [spin('z', 50)], vox: new Vox().ring(0, 0, 0, 11, 1.2, (x, y, z, a) => mix(0xf472b6, 0x22d3ee, (Math.cos(a) + 1) / 2), GLOW) }),
], [fx('spark', { at: [0, 16, 0], rate: 10, v: [0, 0, 0], sp: 14, life: 1, c: [0x22d3ee, 0xa78bfa, 0xf472b6] })]);

export default items;
