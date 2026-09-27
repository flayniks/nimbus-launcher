// Cosmetics in 3D for the launcher: a player with your skin wearing hats, pets, wings and auras,
// animated the same way Nimbus Core animates them in game (see mod/.../cosmetics/Cosmetic.java).
import * as THREE from '../vendor/three/three.module.min.js';
import data from './cosmetics-data.js';

export const COSMETICS = data.items;
export const byId = new Map(COSMETICS.map((c) => [c.id, c]));
export const SLOTS = [['hat', 'Hats'], ['pet', 'Pets'], ['wings', 'Wings'], ['aura', 'Auras']];
export const RARITY = { common: '#9aa3b5', rare: '#4cc3f0', epic: '#b57bff', legendary: '#ffb23f', mythic: '#ff5a8a' };

const GLOW = 1;
const SEE = 2;
const RAINBOW = 4;
const FLICKER = 8;
const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ colours (same maths as the mod)

function hueShift(c, t, x, y, z) {
  let r = ((c >> 16) & 255) / 255;
  let g = ((c >> 8) & 255) / 255;
  let b = (c & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  let h = 0;
  if (max !== min) {
    if (max === r) h = (g - b) / (max - min) + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h /= 6;
  }
  if (s < 0.3) s = 0.8;
  h = (h + t * 0.25 + (x + y + z) * 0.02) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (tt) => {
    tt = ((tt % 1) + 1) % 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/** sRGB to the linear colour three.js expects in vertex colours. */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** The colour of a box right now, as [r, g, b, a] in 0..1 (sRGB, like the game uses). */
export function boxColour(box, t) {
  const c = box[6] >>> 0;
  const flags = box[7];
  let a = c >>> 24 ? (c >>> 24) / 255 : 1;
  let rgb = flags & RAINBOW ? hueShift(c, t, box[0], box[1], box[2]) : [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  if (flags & FLICKER) {
    const f = 0.7 + 0.3 * Math.sin(t * 7 + box[0] * 1.3 + box[1] * 0.7 + box[2] * 1.1);
    rgb = rgb.map((v) => v * f);
  }
  if (!(flags & SEE)) a = 1;
  return [rgb[0], rgb[1], rgb[2], a];
}

// ------------------------------------------------------------------ animation (same maths as the mod)

const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const tmp = new THREE.Matrix4();

function rotate(m, ax, deg) {
  if (deg) m.multiply(tmp.makeRotationAxis(AX[ax] || AX.y, deg * D2R));
}

function translate(m, x, y, z) {
  if (x || y || z) m.multiply(tmp.makeTranslation(x, y, z));
}

/** Applies one animation to `m` at time `t` (seconds). */
export function animate(m, a, t) {
  const wave = (sp, ph) => Math.sin(TAU * (sp * t + (ph || 0)));
  switch (a.t) {
    case 'spin': rotate(m, a.ax, a.sp * t + (a.ph || 0)); break;
    case 'sway': rotate(m, a.ax, a.amp * wave(a.sp, a.ph)); break;
    case 'flap': {
      const s = wave(a.sp, a.ph);
      rotate(m, a.ax, a.amp * (0.5 + 0.5 * Math.sign(s) * Math.pow(Math.abs(s), 0.7)));
      break;
    }
    case 'bob': {
      const d = a.amp * wave(a.sp, a.ph);
      translate(m, a.ax === 'x' ? d : 0, a.ax === 'x' || a.ax === 'z' ? 0 : d, a.ax === 'z' ? d : 0);
      break;
    }
    case 'orbit': {
      const ang = (a.sp * t + (a.ph || 0)) * D2R;
      const c = Math.cos(ang) * a.r;
      const s = Math.sin(ang) * a.r;
      if (a.ax === 'x') translate(m, 0, c, s);
      else if (a.ax === 'z') translate(m, c, s, 0);
      else translate(m, c, 0, s);
      break;
    }
    case 'pulse': {
      const k = 1 + a.amp * wave(a.sp, a.ph);
      m.multiply(tmp.makeScale(k, k, k));
      break;
    }
    case 'hop': {
      const u = (((a.sp * t + (a.ph || 0)) % 1) + 1) % 1;
      const k = Math.sin(Math.PI * u);
      translate(m, 0, a.h * k, 0);
      const sy = 0.88 + 0.17 * k;
      const sxz = 1 / Math.sqrt(sy);
      m.multiply(tmp.makeScale(sxz, sy, sxz));
      break;
    }
    case 'trick': {
      const u = (((t + (a.ph || 0)) % a.every) + a.every) % a.every;
      if (u < a.dur) {
        const k = u / a.dur;
        rotate(m, a.ax, 360 * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2));
      }
      break;
    }
    case 'twitch': {
      const u = (((t + (a.ph || 0)) % a.every) + a.every) % a.every;
      if (u < a.dur) rotate(m, a.ax, a.amp * Math.sin(Math.PI * (u / a.dur)));
      break;
    }
    default:
  }
}

/** A part's matrix inside its parent: pivot, base rotation, animations, scale. */
export function partMatrix(m, p, t) {
  translate(m, p.p[0], p.p[1], p.p[2]);
  if (p.r) { rotate(m, 'x', p.r[0]); rotate(m, 'y', p.r[1]); rotate(m, 'z', p.r[2]); }
  for (const a of p.a || []) animate(m, a, t);
  if (p.s) m.multiply(tmp.makeScale(p.s, p.s, p.s));
  return m;
}

// ------------------------------------------------------------------ geometry

// faces: -x +x -y +y -z +z, four corners each, counter-clockwise from outside
const FACES = [
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
];

const MATS = {
  solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
  see: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  // glowing parts are unlit, so they stay bright in the dark (the game draws them at full brightness)
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  glowSee: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
};

function bucketOf(box) {
  if (box[7] & GLOW) return box[7] & SEE ? 'glowSee' : 'glow';
  return box[7] & SEE ? 'see' : 'solid';
}

/** One part's boxes as up to three meshes (solid, see-through, glowing). */
function partMeshes(p) {
  const out = [];
  const groups = { solid: [], see: [], glow: [], glowSee: [] };
  for (const b of p.b || []) groups[bucketOf(b)].push(b);
  for (const [kind, boxes] of Object.entries(groups)) {
    if (!boxes.length) continue;
    const pos = [];
    const nor = [];
    const col = [];
    const index = [];
    const live = [];
    for (const b of boxes) {
      const dynamic = b[7] & (RAINBOW | FLICKER);
      const start = col.length / 4;
      for (let f = 0; f < 6; f++) {
        if (!((b[8] ?? 63) & (1 << f))) continue;
        const face = FACES[f];
        const base = pos.length / 3;
        for (const [cx, cy, cz] of face.v) {
          pos.push(b[0] + cx * b[3], b[1] + cy * b[4], b[2] + cz * b[5]);
          nor.push(...face.n);
          const [r, g, bl, a] = boxColour(b, 0);
          col.push(lin(r), lin(g), lin(bl), a);
        }
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      if (dynamic) live.push({ b, start, end: col.length / 4 });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(index);
    const mesh = new THREE.Mesh(g, MATS[kind]);
    mesh.userData.live = live;
    if (kind === 'see' || kind === 'glowSee') mesh.renderOrder = 2;
    out.push(mesh);
  }
  return out;
}

/** Builds a cosmetic as a tree of objects whose matrices are set every frame. */
function buildItem(item) {
  const root = new THREE.Group();
  const nodes = [];
  const walk = (p, parent) => {
    const node = new THREE.Group();
    node.matrixAutoUpdate = false;
    node.userData.part = p;
    for (const m of partMeshes(p)) node.add(m);
    parent.add(node);
    nodes.push(node);
    for (const c of p.c || []) walk(c, node);
  };
  for (const p of item.parts) walk(p, root);
  root.userData.nodes = nodes;
  root.userData.item = item;
  return root;
}

function updateItem(obj, t) {
  for (const node of obj.userData.nodes) {
    node.matrix.identity();
    partMatrix(node.matrix, node.userData.part, t);
    node.matrixWorldNeedsUpdate = true;
    for (const mesh of node.children) {
      if (!mesh.isMesh || !mesh.userData.live?.length) continue;
      const colour = mesh.geometry.getAttribute('color');
      for (const { b, start, end } of mesh.userData.live) {
        const [r, g, bl, a] = boxColour(b, t);
        for (let i = start; i < end; i++) colour.setXYZW(i, lin(r), lin(g), lin(bl), a);
      }
      colour.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ particles

const PARTICLE = {
  spark: { s: [0.6, 0.6, 0.6], glow: true },
  ember: { s: [0.8, 0.8, 0.8], glow: true },
  star: { s: [0.7, 0.7, 0.7], glow: true },
  heart: { s: [1.4, 1.2, 0.6], glow: true },
  note: { s: [1, 1.4, 0.4], glow: true },
  snow: { s: [0.7, 0.7, 0.7] },
  drop: { s: [0.35, 1.2, 0.35] },
  confetti: { s: [1.2, 0.8, 0.15], tumble: true },
  leaf: { s: [1.2, 0.25, 0.8], tumble: true },
  feather: { s: [1.6, 0.25, 0.6], tumble: true },
  bubble: { s: [1.1, 1.1, 1.1], see: true },
  smoke: { s: [1.4, 1.4, 1.4], see: true, grow: true },
  pollen: { s: [0.4, 0.4, 0.4] },
};

class Particles {
  constructor(scene) {
    this.list = [];
    this.meshes = {};
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const kind of ['glow', 'solid', 'see']) {
      const mat = kind === 'glow' ? new THREE.MeshBasicMaterial()
        : kind === 'see' ? new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55, depthWrite: false }) : new THREE.MeshLambertMaterial();
      const mesh = new THREE.InstancedMesh(box, mat, 700);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.meshes[kind] = mesh;
    }
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.c = new THREE.Color();
  }

  emit(fx, world, dt, rand) {
    fx._acc = (fx._acc || 0) + dt * fx.rate;
    const kind = PARTICLE[fx.k] || PARTICLE.spark;
    while (fx._acc >= 1 && this.list.length < 650) {
      fx._acc -= 1;
      const dir = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
      const local = new THREE.Vector3(...fx.at);
      const vel = new THREE.Vector3(...fx.v);
      if (fx.sp < 0) {
        local.addScaledVector(dir, -fx.sp);
        vel.addScaledVector(dir, fx.sp * 1.3);
      } else {
        vel.addScaledVector(dir, fx.sp * rand());
        local.addScaledVector(dir, 0.5);
      }
      const pos = local.applyMatrix4(world);
      const v = vel.transformDirection(world).multiplyScalar(vel.length());
      this.list.push({ pos, v, g: fx.g || 0, life: fx.life * (0.6 + 0.4 * rand()), age: 0, c: fx.c[Math.floor(rand() * fx.c.length)], kind, sz: fx.sz || 1, spin: rand() * 6, solid: fx.solid });
    }
  }

  update(dt, t) {
    const counts = { glow: 0, solid: 0, see: 0 };
    this.list = this.list.filter((p) => (p.age += dt) < p.life);
    for (const p of this.list) {
      p.v.y += p.g * dt;
      p.pos.addScaledVector(p.v, dt);
      const k = p.age / p.life;
      const kind = p.kind.glow && !p.solid ? 'glow' : p.kind.see ? 'see' : 'solid';
      const mesh = this.meshes[kind];
      const shrink = p.kind.grow ? 1 + k * 1.2 : 1 - k * k;
      this.q.setFromEuler(new THREE.Euler(p.kind.tumble ? t * 3 + p.spin : 0, t * 2 + p.spin, 0));
      this.m.compose(p.pos, this.q, new THREE.Vector3(p.kind.s[0] * p.sz * shrink, p.kind.s[1] * p.sz * shrink, p.kind.s[2] * p.sz * shrink));
      const i = counts[kind]++;
      mesh.setMatrixAt(i, this.m);
      this.c.setHex(p.c);
      if (kind === 'glow') this.c.multiplyScalar(1 - k * 0.6);
      mesh.setColorAt(i, this.c);
    }
    for (const [kind, mesh] of Object.entries(this.meshes)) {
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this.list = [];
  }
}

// ------------------------------------------------------------------ the player

/** The standard skin layout: [u, v, w, h, d] of each box. */
const SKIN = {
  head: [[0, 0, 8, 8, 8], [32, 0, 8, 8, 8]],
  body: [[16, 16, 8, 12, 4], [16, 32, 8, 12, 4]],
  rightArm: [[40, 16, 4, 12, 4], [40, 32, 4, 12, 4]],
  leftArm: [[32, 48, 4, 12, 4], [48, 48, 4, 12, 4]],
  rightLeg: [[0, 16, 4, 12, 4], [0, 32, 4, 12, 4]],
  leftLeg: [[16, 48, 4, 12, 4], [0, 48, 4, 12, 4]],
};

function skinBox(tex, [u, v, w, h, d], inflate, slimArm) {
  if (slimArm) w = 3;
  const g = new THREE.BoxGeometry(w + inflate * 2, h + inflate * 2, d + inflate * 2);
  const uv = g.getAttribute('uv');
  const rect = (fu, fv, fw, fh, flipX = false) => {
    const [x0, x1] = flipX ? [fu + fw, fu] : [fu, fu + fw];
    return [[x0 / 64, 1 - fv / 64], [x1 / 64, 1 - fv / 64], [x0 / 64, 1 - (fv + fh) / 64], [x1 / 64, 1 - (fv + fh) / 64]];
  };
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z
  const faces = [
    rect(u + d + w, v + d, d, h), // +x: the model's left side
    rect(u, v + d, d, h), // -x: right side
    rect(u + d, v, w, d), // top
    rect(u + d + w, v, w, d, false), // bottom
    rect(u + d, v + d, w, h), // front (+z)
    rect(u + d * 2 + w, v + d, w, h), // back
  ];
  faces.forEach((f, i) => {
    let corners = f;
    if (i === 3) corners = [f[2], f[3], f[0], f[1]];
    corners.forEach(([x, y], k) => uv.setXY(i * 4 + k, x, y));
  });
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: inflate > 0, alphaTest: 0.1, side: inflate > 0 ? THREE.DoubleSide : THREE.FrontSide });
  return new THREE.Mesh(g, mat);
}

function buildPlayer(tex, slim) {
  const root = new THREE.Group();
  const part = (name, size, pivot, offset) => {
    const g = new THREE.Group();
    g.position.set(...pivot);
    const [inner, outer] = SKIN[name];
    const slimArm = slim && name.includes('Arm');
    for (const [spec, inflate] of [[inner, 0], [outer, name === 'head' ? 0.5 : 0.25]]) {
      const m = skinBox(tex, spec, inflate, slimArm);
      m.position.set(...offset);
      g.add(m);
    }
    root.add(g);
    return g;
  };
  const armX = slim ? 5.5 : 6;
  const parts = {
    head: part('head', 8, [0, 24, 0], [0, 4, 0]),
    body: part('body', 12, [0, 24, 0], [0, -6, 0]),
    rightArm: part('rightArm', 12, [-armX + 0, 22, 0], [slim ? -0.5 : 0, -4, 0]),
    leftArm: part('leftArm', 12, [armX, 22, 0], [slim ? 0.5 : 0, -4, 0]),
    rightLeg: part('rightLeg', 12, [-2, 12, 0], [0, -6, 0]),
    leftLeg: part('leftLeg', 12, [2, 12, 0], [0, -6, 0]),
  };
  return { root, parts };
}

// ------------------------------------------------------------------ the viewer

export class CosmeticViewer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{player?: boolean, spin?: boolean}} opts player: draw the player; spin: turn slowly
   */
  constructor(canvas, { player = true, spin = true } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !player });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 1000);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(30, 60, 50);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xb9a8ff, 0.8);
    rim.position.set(-40, 20, -50);
    this.scene.add(rim);
    this.stage = new THREE.Group();
    this.scene.add(this.stage);
    this.particles = new Particles(this.scene);
    this.slots = {};
    this.items = {};
    this.yaw = 0.5;
    this.pitch = 0.12;
    this.autoSpin = spin;
    this.showPlayer = player;
    this.t0 = performance.now();
    this.last = this.t0;
    this.seed = 1;
    this.rand = () => {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      return this.seed / 4294967296;
    };
    if (player) this.setSkin(null);
    this.bindDrag();
  }

  bindDrag() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch };
      this.canvas.setPointerCapture(e.pointerId);
      this.autoSpin = false;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!down) return;
      this.yaw = down.yaw + (e.clientX - down.x) * 0.012;
      this.pitch = Math.max(-0.4, Math.min(0.8, down.pitch + (e.clientY - down.y) * 0.006));
    });
    const up = () => { down = null; };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  /** Loads a skin (a URL or data URL); null draws a plain default. */
  setSkin(url, slim = false) {
    if (this.player) this.stage.remove(this.player.root);
    const tex = url ? new THREE.TextureLoader().load(url) : defaultSkin();
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.player = buildPlayer(tex, slim);
    this.stage.add(this.player.root);
    // attach points, moved with the body parts
    this.attach = {
      hat: new THREE.Group(),
      wings: new THREE.Group(),
      aura: new THREE.Group(),
      pet: new THREE.Group(),
    };
    this.attach.hat.position.set(0, 8, 0);
    this.player.parts.head.add(this.attach.hat);
    this.attach.wings.position.set(0, -4, -2);
    this.player.parts.body.add(this.attach.wings);
    this.player.root.add(this.attach.aura);
    this.attach.pet.position.set(-14, 27, -5);
    this.player.root.add(this.attach.pet);
    for (const [slot, id] of Object.entries(this.items)) this.equip(slot, id, true);
  }

  /** Puts a cosmetic on (id) or takes the slot off (null). */
  equip(slot, id, force = false) {
    if (!force && this.items[slot] === id) return;
    if (this.slots[slot]) this.slots[slot].parent?.remove(this.slots[slot]);
    this.slots[slot] = null;
    this.items[slot] = id || null;
    const item = id && byId.get(id);
    if (!item) return;
    const obj = buildItem(item);
    obj.userData.fx = item.fx.map((f) => ({ ...f }));
    if (this.showPlayer) this.attach[item.slot].add(obj);
    else this.stage.add(obj);
    this.slots[slot] = obj;
  }

  /** Shows one cosmetic on its own, centred (for thumbnails and close-ups). */
  showAlone(id) {
    for (const s of Object.keys(this.slots)) this.equip(s, null);
    this.particles.clear();
    const item = byId.get(id);
    if (!item) return;
    this.equip(item.slot, id);
    const obj = this.slots[item.slot];
    updateItem(obj, 0.8);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    obj.position.sub(centre);
    this.fitSize = Math.max(size.x, size.y, size.z, 6);
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(now = performance.now()) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    if (this.autoSpin) this.yaw += dt * 0.35;
    if (this.showPlayer) {
      const dist = 105;
      this.camera.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * dist, 18 + Math.sin(this.pitch) * dist, Math.cos(this.yaw) * Math.cos(this.pitch) * dist);
      this.camera.lookAt(0, 17, 0);
      // a little life: breathing, arms swaying and the head looking around
      const p = this.player.parts;
      p.head.rotation.y = Math.sin(t * 0.6) * 0.35;
      p.head.rotation.x = Math.sin(t * 0.43) * 0.12;
      p.rightArm.rotation.x = Math.sin(t * 1.3) * 0.12;
      p.leftArm.rotation.x = -Math.sin(t * 1.3) * 0.12;
      p.rightArm.rotation.z = -0.06 - Math.sin(t * 1.1) * 0.03;
      p.leftArm.rotation.z = 0.06 + Math.sin(t * 1.1) * 0.03;
      this.attach.pet.position.set(-14 + Math.sin(t * 0.5) * 2, 27, -5 + Math.cos(t * 0.4) * 2);
    } else {
      const dist = (this.fitSize || 16) * 2.2;
      this.camera.position.set(Math.sin(this.yaw) * dist, Math.sin(0.35) * dist, Math.cos(this.yaw) * dist);
      this.camera.lookAt(0, 0, 0);
    }
    for (const obj of Object.values(this.slots)) if (obj) updateItem(obj, t);
    this.scene.updateMatrixWorld(true);
    for (const obj of Object.values(this.slots)) {
      if (!obj) continue;
      for (const f of obj.userData.fx) this.particles.emit(f, obj.matrixWorld, dt, this.rand);
    }
    this.particles.update(dt, t);
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    const loop = (now) => {
      if (this.stopped) return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.stopped = false;
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
  }
}

/** A plain skin for when there's none to show: dark blue clothes, Nimbus violet shirt. */
function defaultSkin() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const fill = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  fill('#c8906a', 0, 0, 32, 16); // head
  fill('#3a2616', 8, 0, 8, 8); fill('#3a2616', 0, 8, 32, 2); fill('#3a2616', 16, 0, 8, 8);
  fill('#ffffff', 9, 12, 2, 1); fill('#ffffff', 13, 12, 2, 1); fill('#4b2fd6', 10, 12, 1, 1); fill('#4b2fd6', 13, 12, 1, 1);
  fill('#7c5cff', 16, 16, 24, 16); // body
  fill('#7c5cff', 40, 16, 16, 16); fill('#7c5cff', 32, 48, 16, 16); // arms
  fill('#c8906a', 44, 28, 4, 4); fill('#c8906a', 36, 60, 4, 4);
  fill('#243052', 0, 16, 16, 16); fill('#243052', 16, 48, 16, 16); // legs
  fill('#1a1a24', 0, 28, 16, 4); fill('#1a1a24', 16, 60, 16, 4);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/** Renders a still picture of every cosmetic (for the grid), a few per frame so the page stays responsive. */
export function thumbnails(ids, size, onEach) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  let viewer;
  try {
    viewer = new CosmeticViewer(canvas, { player: false, spin: false });
  } catch {
    return () => {};
  }
  viewer.resize(size, size);
  viewer.yaw = 0.6;
  let i = 0;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    for (let k = 0; k < 4 && i < ids.length; k++, i++) {
      viewer.showAlone(ids[i]);
      const item = byId.get(ids[i]);
      viewer.yaw = item?.slot === 'wings' ? 0 : 0.6;
      viewer.frame(viewer.last + 16);
      onEach(ids[i], canvas.toDataURL('image/png'));
    }
    if (i < ids.length) requestAnimationFrame(step);
    else viewer.dispose();
  };
  requestAnimationFrame(step);
  return () => { stopped = true; viewer.dispose(); };
}
