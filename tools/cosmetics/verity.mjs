// Verity, from ThatMob's Verity series: a yellow smiley ball with a face for every mood, that can
// turn into its monster. Its powers: all 17 of its faces, the monster form, and a glitch that
// crackles round it. The faces are 512 x 512 pictures on a smooth ball (art/verity), so they stay
// sharp up close. The monster is Verity Monster(TM) by GranDussek (CC BY 4.0), cut into parts by
// blender/verity_monster.py (art/verity/monster.json, wearing art/verity/monster.png).
import fs from 'fs';
import { part, ball, sway, twitch, fx } from './kit.mjs';
import FACES from './verity-faces.mjs';

const faces = () => FACES.map((f, i) => part({ when: { face: i }, g: [ball([0, 0, 0], 8, 0, { tex: `verity_face_${f.id}`, n: 36 })] }));

// sitting on the ground (the ball's radius is 8), looking where you look, each face its own
// picture; with the glitch on it jerks and shudders
const ballForm = part({
  p: [0, 8, 0], k: 'look',
  a: [sway('z', 3, 0.27)],
  c: [
    part({ when: { power: 0 }, c: faces() }),
    part({ when: { power: 1 }, a: [twitch('z', 18, 1.7, 0.12), twitch('y', -24, 2.3, 0.1, 0.9), sway('x', 3, 6.1), sway('z', 2, 7.7, 0.3)], c: faces() }),
  ],
});

// the monster: tall and thin, arms hanging to its knees, the grin. Each part turns at its joint:
// the legs and arms swing as it walks, the head looks where you look and now and then snaps to
// one side, the arms dangle and the body sways a little even standing still
const M = JSON.parse(fs.readFileSync(new URL('./art/verity/monster.json', import.meta.url), 'utf8')).parts;
const mesh = (r) => [{ t: 'mesh', n: M[r].n, v: M[r].v, i: M[r].i, tex: 'verity_monster' }];
const from = (r, base) => M[r].p.map((x, i) => Math.round((x - base[i]) * 100) / 100);
const hips = M.body.p;
const monster = () => [
  part({ p: M.legL.p, k: 'legL', ks: 0.5, g: mesh('legL') }),
  part({ p: M.legR.p, k: 'legR', ks: 0.5, g: mesh('legR') }),
  part({
    p: hips, k: 'body', a: [sway('x', 2.5, 0.31), sway('z', 1.5, 0.23, 0.4)], g: mesh('body'),
    c: [
      part({ p: from('armL', hips), k: 'armL', ks: 0.6, a: [sway('x', 5, 0.42), sway('z', -3, 0.31, 0.2)], g: mesh('armL') }),
      part({ p: from('armR', hips), k: 'armR', ks: 0.6, a: [sway('x', 5, 0.42, 0.5), sway('z', 3, 0.31, 0.7)], g: mesh('armR') }),
      part({ p: from('head', hips), k: 'head', a: [sway('z', 5, 0.19), twitch('z', 26, 5.3, 0.22), twitch('x', -14, 7.9, 0.16, 2.1)], g: mesh('head') }),
    ],
  }),
];
// with the glitch on, the whole monster jerks too
const monsterForm = [
  part({ when: { power: 0 }, c: monster() }),
  part({ when: { power: 1 }, a: [twitch('y', 20, 1.3, 0.1), twitch('z', -8, 1.9, 0.08, 0.6), sway('x', 2, 7.3)], c: monster() }),
];

export default [{
  id: 'model_verity',
  name: 'Verity',
  slot: 'model',
  rarity: 'mythic',
  price: 100000,
  desc: 'The smiley AI helper from ThatMob\'s Verity series, sitting where you\'d stand. Switch between its 17 faces, turn it into its monster, and make it glitch. Everyone sees it. Monster model: Verity Monster™ by GranDussek (CC BY 4.0).',
  m: { h: [18, 48], forms: ['Ball', 'Monster'], faces: FACES.map((f) => f.name), power: 'Glitch' },
  parts: [part({ when: { form: 0 }, c: [ballForm] }), part({ when: { form: 1 }, c: monsterForm })],
  fx: [
    fx('smoke', { at: [0, 8, 0], rate: 10, v: [0, 3, 0], sp: -9, life: 1.1, c: [0x1a1418, 0x2b1d22], glow: false, when: { form: 0, power: 1 } }),
    fx('spark', { at: [0, 8, 0], rate: 16, v: [0, 2, 0], sp: -10, life: 0.5, c: [0xff2030, 0xffd23a], when: { form: 0, power: 1 } }),
    fx('smoke', { at: [0, 30, 0], rate: 16, v: [0, 3, 0], sp: -14, life: 1.2, c: [0x1a1418, 0x2b1d22], glow: false, when: { form: 1, power: 1 } }),
    fx('spark', { at: [0, 32, 0], rate: 22, v: [0, 2, 0], sp: -16, life: 0.5, c: [0xff2030, 0xffd23a], when: { form: 1, power: 1 } }),
  ],
}];
