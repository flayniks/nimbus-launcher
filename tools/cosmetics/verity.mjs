// Verity, from ThatMob's Verity series: a floating yellow smiley ball with a face for every mood.
// Its powers: all 17 of its faces, and a glitch that crackles round it. The faces are 512 x 512
// pictures on a smooth ball (art/verity), so they stay sharp up close.
import { part, ball, bob, sway, twitch, fx } from './kit.mjs';
import FACES from './verity-faces.mjs';

const faces = () => FACES.map((f, i) => part({ when: { face: i }, g: [ball([0, 0, 0], 8, 0, { tex: `verity_face_${f.id}`, n: 36 })] }));

// floating at about chest height, looking where you look, each face its own picture; with the
// glitch on it jerks and shudders
const ballForm = part({
  p: [0, 24, 0], k: 'look',
  a: [bob(1.3, 0.42), sway('z', 3, 0.27)],
  c: [
    part({ when: { power: 0 }, c: faces() }),
    part({ when: { power: 1 }, a: [twitch('z', 18, 1.7, 0.12), twitch('y', -24, 2.3, 0.1, 0.9), sway('x', 3, 6.1), sway('z', 2, 7.7, 0.3)], c: faces() }),
  ],
});

export default [{
  id: 'model_verity',
  name: 'Verity',
  slot: 'model',
  rarity: 'mythic',
  price: 100000,
  desc: 'The smiley AI helper from ThatMob\'s Verity series, floating where you\'d stand. Switch between its 17 faces and make it glitch. Everyone sees it.',
  m: { h: [34], faces: FACES.map((f) => f.name), power: 'Glitch' },
  parts: [ballForm],
  fx: [
    fx('smoke', { at: [0, 24, 0], rate: 10, v: [0, 3, 0], sp: -9, life: 1.1, c: [0x1a1418, 0x2b1d22], glow: false, when: { power: 1 } }),
    fx('spark', { at: [0, 24, 0], rate: 16, v: [0, 2, 0], sp: -10, life: 0.5, c: [0xff2030, 0xffd23a], when: { power: 1 } }),
  ],
}];
