// Cosmetics in 3D for the launcher: a player with your skin wearing hats, pets, wings and auras,
// animated the same way Nimbus Core animates them in game (see mod/.../cosmetics/Cosmetic.java).
import * as THREE from '../vendor/three/three.module.min.js';
import data from './cosmetics-data.js';

export const COSMETICS = data.items;
export const byId = new Map(COSMETICS.map((c) => [c.id, c]));
export const SLOTS = [['model', 'Models'], ['hat', 'Hats'], ['pet', 'Pets'], ['wings', 'Wings'], ['aura', 'Auras']];
/** A model's powers, in words (for badges): forms, faces and the power. */
export function powersOf(item) {
  const m = item?.m;
  if (!m) return [];
  const out = [];
  if (m.forms?.length > 1) out.push(m.forms.slice(1).map((f) => `${f} form`).join(', '));
  if (m.faces?.length > 1) out.push(`${m.faces.length} faces`);
  if (m.power) out.push(m.power);
  return out;
}
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

/**
 * How a player model's role parts move (the same maths as Nimbus Core's Cosmetics.java):
 * pose = { yaw, pitch: where the head looks, in degrees, against the body; walk: walk cycle
 * position; speed: 0 standing to 1 running; crouch; attack: 0..1 of a swing }.
 */
export function role(m, k, pose, t) {
  if (!k || !pose) return;
  const c = Math.cos(pose.walk * 0.6662) * pose.speed;
  switch (k) {
    case 'head':
    case 'look':
      rotate(m, 'y', pose.yaw);
      rotate(m, 'x', pose.pitch);
      break;
    case 'legL': rotate(m, 'x', c * 1.4 / D2R); break;
    case 'legR': rotate(m, 'x', -c * 1.4 / D2R); break;
    case 'armL': rotate(m, 'x', -c / D2R); break;
    case 'armR': rotate(m, 'x', c / D2R - Math.sin(Math.sqrt(pose.attack) * Math.PI) * 80); break;
    case 'body': if (pose.crouch) rotate(m, 'x', 28); break;
    case 'tail': rotate(m, 'y', Math.sin(t * (2 + 6 * pose.speed)) * (10 + 25 * pose.speed)); break;
    case 'hop': {
      const k2 = Math.abs(Math.sin(pose.walk * 0.6662)) * pose.speed;
      translate(m, 0, k2 * 7, 0);
      m.multiply(tmp.makeScale(1 + 0.12 * (1 - k2) * pose.speed, 1 - 0.12 * (1 - k2) * pose.speed + 0.1 * k2, 1 + 0.12 * (1 - k2) * pose.speed));
      break;
    }
    case 'lean': rotate(m, 'x', pose.speed * 25); break;
    default:
  }
}

/** While a model changes form: which form shows, and how it's moved and scaled. */
export function transition(state, t) {
  const d = t - (state.changed ?? -99);
  if (d >= 0.9 || state.prev === undefined || state.prev === state.form) return null;
  if (d < 0.5) {
    const show = Math.floor(d / 0.07) % 2 === 0 ? state.form : state.prev;
    return { show, scale: 1, dx: Math.sin(d * 91) * 0.9, dz: Math.cos(d * 77) * 0.9 };
  }
  const k = (d - 0.5) / 0.4;
  const back = 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
  return { show: state.form, scale: 0.6 + 0.4 * back, dx: 0, dz: 0 };
}

/** Whether a part (or effect) with w = [form, face, power] shows in `state`. */
export function shows(w, state, tr) {
  if (!w) return true;
  const form = tr ? tr.show : state.form;
  return (w[0] < 0 || w[0] === form) && (w[1] < 0 || w[1] === state.face) && (w[2] < 0 || w[2] === (state.power ? 1 : 0));
}

/** A part's matrix inside its parent: pivot, base rotation, its role, animations, scale. */
export function partMatrix(m, p, t, pose = null, tr = null) {
  translate(m, p.p[0], p.p[1], p.p[2]);
  if (tr && p.w && p.w[0] >= 0) {
    translate(m, tr.dx, 0, tr.dz);
    if (tr.scale !== 1) m.multiply(tmp.makeScale(tr.scale, tr.scale, tr.scale));
  }
  if (p.r) { rotate(m, 'x', p.r[0]); rotate(m, 'y', p.r[1]); rotate(m, 'z', p.r[2]); }
  role(m, p.k, pose, t);
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

// ------------------------------------------------------------------ smooth shapes (same maths as the mod)

/**
 * A shape as quads: [[x, y, z, nx, ny, nz, u, v] x 4] each. Balls have their poles on z, so the
 * front half (facing +z) can show a picture seen from the front; the back half takes the
 * picture's top-left pixel.
 */
export function shapeQuads(g) {
  const quads = [];
  const n = g.n;
  if (g.t === 'ball') {
    const rings = Math.max(4, Math.round(n / 4) * 2);
    const [cx, cy, cz] = g.c;
    const [rx, ry, rz] = g.r;
    // tp: wider at the top (> 0) or the bottom (< 0), across and front to back
    const [tx, tz] = g.tp || [0, 0];
    const v = (th, ph, front) => {
      const ux = Math.sin(th) * Math.cos(ph);
      const uy = Math.sin(th) * Math.sin(ph);
      const uz = Math.cos(th);
      const kx = 1 + tx * uy;
      const kz = 1 + tz * uy;
      let nx = ux / (rx * kx);
      let ny = uy / ry;
      let nz = uz / (rz * kz);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      // wrap: the picture all the way round (skin); otherwise seen from the front (faces)
      if (g.wrap) return [cx + rx * kx * ux, cy + ry * uy, cz + rz * kz * uz, nx, ny, nz, ph / (2 * Math.PI), th / Math.PI];
      return [cx + rx * kx * ux, cy + ry * uy, cz + rz * kz * uz, nx, ny, nz, front ? 0.5 + 0.5 * ux : 0.004, front ? 0.5 - 0.5 * uy : 0.004];
    };
    // half: only the front half (a face over a skin ball just inside it)
    for (let i = 0; i < (g.half ? rings / 2 : rings); i++) {
      const t0 = (Math.PI * i) / rings;
      const t1 = (Math.PI * (i + 1)) / rings;
      const front = i < rings / 2;
      for (let j = 0; j < n; j++) {
        const p0 = (2 * Math.PI * j) / n;
        const p1 = (2 * Math.PI * (j + 1)) / n;
        quads.push([v(t0, p0, front), v(t1, p0, front), v(t1, p1, front), v(t0, p1, front)]);
      }
    }
  } else {
    const [ax, ay, az] = g.a;
    const [bx, by, bz] = g.b;
    const [r0, r1] = g.r;
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    // u: across the tube, w = d x u
    const [hx, hy, hz] = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = hy * dz - hz * dy;
    let uy = hz * dx - hx * dz;
    let uz = hx * dy - hy * dx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const wx = dy * uz - dz * uy;
    const wy = dz * ux - dx * uz;
    const wz = dx * uy - dy * ux;
    const slope = (r0 - r1) / len;
    const v = (ph, end) => {
      const c = Math.cos(ph);
      const s = Math.sin(ph);
      const rx = ux * c + wx * s;
      const ry = uy * c + wy * s;
      const rz = uz * c + wz * s;
      const r = end ? r1 : r0;
      let nx = rx + dx * slope;
      let ny = ry + dy * slope;
      let nz = rz + dz * slope;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      // a picture wraps round the tube: across it once, along it once
      return [(end ? bx : ax) + rx * r, (end ? by : ay) + ry * r, (end ? bz : az) + rz * r, nx, ny, nz, ph / (2 * Math.PI), end ? 1 : 0];
    };
    for (let j = 0; j < n; j++) {
      const p0 = (2 * Math.PI * j) / n;
      const p1 = (2 * Math.PI * (j + 1)) / n;
      quads.push([v(p0, false), v(p1, false), v(p1, true), v(p0, true)]);
    }
  }
  return quads;
}

/**
 * A sculpted mesh (made in Blender, see tools/cosmetics/blender): n vertices of 12 bytes each in v
 * (x, y, z as int16 in 1/64 pixels; a normal as 3 int8; a colour as 3 bytes), triangles in i (uint16).
 */
export function meshData(g) {
  if (g._mesh) return g._mesh;
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const v = new DataView(bytes(g.v).buffer);
  const idx = bytes(g.i);
  const pos = new Float32Array(g.n * 3);
  const nor = new Float32Array(g.n * 3);
  const col = new Float32Array(g.n * 3);
  for (let k = 0; k < g.n; k++) {
    const o = k * 12;
    pos[k * 3] = v.getInt16(o, true) / 64;
    pos[k * 3 + 1] = v.getInt16(o + 2, true) / 64;
    pos[k * 3 + 2] = v.getInt16(o + 4, true) / 64;
    nor[k * 3] = v.getInt8(o + 6) / 127;
    nor[k * 3 + 1] = v.getInt8(o + 7) / 127;
    nor[k * 3 + 2] = v.getInt8(o + 8) / 127;
    col[k * 3] = v.getUint8(o + 9) / 255;
    col[k * 3 + 1] = v.getUint8(o + 10) / 255;
    col[k * 3 + 2] = v.getUint8(o + 11) / 255;
  }
  const tri = new Uint16Array(idx.buffer, idx.byteOffset, idx.byteLength / 2);
  g._mesh = { pos, nor, col, tri };
  return g._mesh;
}

const TEXTURES = new Map(); // name -> { tex, mat, ready }
function texture(name) {
  if (!TEXTURES.has(name)) {
    let done;
    const ready = new Promise((r) => { done = r; });
    const tex = new THREE.TextureLoader().load(`img/models/${name}.png`, () => done(), undefined, () => done());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    TEXTURES.set(name, { tex, ready, mat: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }) });
  }
  return TEXTURES.get(name);
}

/** Waits for the pictures an item's shapes wear. */
export function texturesOf(item) {
  const names = new Set();
  const walk = (p) => { for (const g of p.g || []) if (g.tex) names.add(g.tex); (p.c || []).forEach(walk); };
  (item?.parts || []).forEach(walk);
  return Promise.all([...names].map((n) => texture(n).ready));
}

/** A part's shapes as meshes: one per picture, and solid / see-through / glowing ones. */
function shapeMeshes(p) {
  const groups = new Map();
  const out = [];
  for (const g of p.g || []) {
    if (g.t === 'mesh') {
      const d = meshData(g);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(d.nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(d.col, lin), 3));
      geo.setIndex(new THREE.BufferAttribute(d.tri, 1));
      const mesh = new THREE.Mesh(geo, MATS.solid);
      mesh.userData.live = [];
      out.push(mesh);
      continue;
    }
    const key = g.tex ? `t:${g.tex}` : bucketOf([0, 0, 0, 0, 0, 0, g.col, g.f || 0]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  for (const [key, shapes] of groups) {
    const pos = [];
    const nor = [];
    const uv = [];
    const col = [];
    const index = [];
    for (const g of shapes) {
      const [r, gr, b] = g.tex ? [1, 1, 1] : boxColour([0, 0, 0, 0, 0, 0, g.col, g.f || 0], 0);
      for (const q of shapeQuads(g)) {
        const base = pos.length / 3;
        for (const v of q) {
          pos.push(v[0], v[1], v[2]);
          nor.push(v[3], v[4], v[5]);
          uv.push(v[6], 1 - v[7]);
          col.push(lin(r), lin(gr), lin(b), 1);
        }
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, key.startsWith('t:') ? texture(key.slice(2)).mat : MATS[key]);
    mesh.userData.live = [];
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
    for (const m of shapeMeshes(p)) node.add(m);
    parent.add(node);
    nodes.push(node);
    for (const c of p.c || []) walk(c, node);
  };
  for (const p of item.parts) walk(p, root);
  root.userData.nodes = nodes;
  root.userData.item = item;
  return root;
}

function updateItem(obj, t, pose = null, state = null) {
  const tr = state ? transition(state, t) : null;
  for (const node of obj.userData.nodes) {
    const part = node.userData.part;
    node.visible = !state || shows(part.w, state, tr);
    if (!node.visible) continue;
    node.matrix.identity();
    partMatrix(node.matrix, part, t, pose, tr);
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
    // a player model's form, face and power, and whether it walks on the spot
    this.modelState = { form: 0, face: 0, power: false };
    this.walking = false;
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
      model: new THREE.Group(),
    };
    this.player.root.add(this.attach.model);
    this.attach.hat.position.set(0, 8, 0);
    this.player.parts.head.add(this.attach.hat);
    this.attach.wings.position.set(0, -4, -2);
    this.player.parts.body.add(this.attach.wings);
    this.player.root.add(this.attach.aura);
    this.attach.pet.position.set(-22, 25, -4);
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
    if (slot === 'model') this.modelState = { form: 0, face: 0, power: false };
  }

  /** The worn (or tried on) model, if any. */
  get model() {
    return this.slots.model ? this.slots.model.userData.item : null;
  }

  /** Changes the model's form, face or power: { form, face, power }. */
  setModelState(patch) {
    const t = (performance.now() - this.t0) / 1000;
    const next = { ...this.modelState, ...patch };
    if (patch.form !== undefined && patch.form !== this.modelState.form) Object.assign(next, { prev: this.modelState.form, changed: t });
    this.modelState = next;
  }

  /** Shows one cosmetic on its own, centred (for thumbnails and close-ups). */
  showAlone(id) {
    for (const s of Object.keys(this.slots)) this.equip(s, null);
    this.particles.clear();
    const item = byId.get(id);
    if (!item) return;
    this.equip(item.slot, id);
    const obj = this.slots[item.slot];
    if (item.slot === 'model') updateItem(obj, 0.8, { yaw: 0, pitch: 0, walk: 0, speed: 0, crouch: false, attack: 0 }, this.modelState);
    else updateItem(obj, 0.8);
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
    const model = this.model;
    // what a model's role parts follow: looking around, and walking on the spot when asked
    const pose = { yaw: Math.sin(t * 0.6) * 20, pitch: Math.sin(t * 0.43) * 7, walk: t * 7, speed: this.walking ? 0.6 : 0, crouch: false, attack: 0 };
    if (this.showPlayer) {
      // tall models: the camera steps back to fit them
      const tall = model ? Math.max(32, (model.m.h || [32])[Math.min(this.modelState.form, (model.m.h || [32]).length - 1)] || 32) : 32;
      const dist = 105 * Math.max(1, tall / 34);
      const look = model ? tall * 0.52 : 17;
      this.camera.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * dist, look + 1 + Math.sin(this.pitch) * dist, Math.cos(this.yaw) * Math.cos(this.pitch) * dist);
      this.camera.lookAt(0, look, 0);
      // a model stands in for the skin, and for what the skin wears on its head and back
      for (const g of Object.values(this.player.parts)) g.visible = !model;
      // a little life: breathing, arms swaying and the head looking around
      const p = this.player.parts;
      p.head.rotation.y = Math.sin(t * 0.6) * 0.35;
      p.head.rotation.x = Math.sin(t * 0.43) * 0.12;
      p.rightArm.rotation.x = Math.sin(t * 1.3) * 0.12;
      p.leftArm.rotation.x = -Math.sin(t * 1.3) * 0.12;
      p.rightArm.rotation.z = -0.06 - Math.sin(t * 1.1) * 0.03;
      p.leftArm.rotation.z = 0.06 + Math.sin(t * 1.1) * 0.03;
      this.attach.pet.position.set(-22 + Math.sin(t * 0.5) * 2, 25, -4 + Math.cos(t * 0.4) * 2);
    } else {
      const dist = (this.fitSize || 16) * 2.2;
      this.camera.position.set(Math.sin(this.yaw) * dist, Math.sin(0.35) * dist, Math.cos(this.yaw) * dist);
      this.camera.lookAt(0, 0, 0);
    }
    for (const [slot, obj] of Object.entries(this.slots)) {
      if (!obj) continue;
      if (slot === 'model') updateItem(obj, t, pose, this.modelState);
      else updateItem(obj, t);
    }
    this.scene.updateMatrixWorld(true);
    for (const [slot, obj] of Object.entries(this.slots)) {
      if (!obj) continue;
      const tr = slot === 'model' ? transition(this.modelState, t) : null;
      for (const f of obj.userData.fx) if (slot !== 'model' || shows(f.w, this.modelState, tr)) this.particles.emit(f, obj.matrixWorld, dt, this.rand);
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
  const step = async () => {
    if (stopped) return;
    for (let k = 0; k < 4 && i < ids.length; k++, i++) {
      const item = byId.get(ids[i]);
      if (item?.slot === 'model') await texturesOf(item);
      if (stopped) return;
      viewer.showAlone(ids[i]);
      viewer.yaw = item?.slot === 'wings' ? 0 : item?.slot === 'model' ? 0.35 : 0.6;
      viewer.frame(viewer.last + 16);
      onEach(ids[i], canvas.toDataURL('image/png'));
    }
    if (i < ids.length) requestAnimationFrame(step);
    else viewer.dispose();
  };
  requestAnimationFrame(step);
  return () => { stopped = true; viewer.dispose(); };
}
