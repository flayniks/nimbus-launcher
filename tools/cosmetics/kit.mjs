// The toolkit the cosmetics are built with: voxels (1 unit = 1 pixel = 1/16 block), parts that
// animate, and a few shape helpers. build.mjs turns everything into cosmetics.json, which Nimbus Core
// draws in game and the launcher draws in its previews. Both read the same format:
//
//   part  { p:[x,y,z] pivot, r:[x,y,z] degrees, s: scale, a:[anims], b:[boxes], c:[parts] }
//   box   [x, y, z, w, h, d, colour 0xRRGGBB or 0xAARRGGBB, flags, faces]
//         flags: 1 glows, 2 see-through (uses the alpha), 4 rainbow, 8 flickers
//         faces: which sides to draw, bits -x +x -y +y -z +z (63 = all)
//   anim  {t:'spin'|'sway'|'flap'|'bob'|'orbit'|'pulse'|'hop'|'trick'|'twitch', ...}
//   fx    {k: kind, at:[x,y,z], rate, v:[x,y,z], sp, life, g, sz, c:[colours]}

export const GLOW = 1;
export const SEE = 2;
export const RAINBOW = 4;
export const FLICKER = 8;

// ------------------------------------------------------------------ colours

export function rgb(hex) {
  return typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
}

export function mix(a, b, t) {
  a = rgb(a); b = rgb(b);
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export const shade = (c, f) => mix(c, f < 1 ? 0x000000 : 0xffffff, f < 1 ? 1 - f : f - 1);
export const alpha = (c, a) => ((Math.round(a * 255) & 255) * 0x1000000) + (rgb(c) & 0xffffff);

export function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

/** A small random generator, so a model comes out the same on every build. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const THEMES = {
  gold: { a: 0xffd24a, b: 0xe8a317, c: 0xfff3b0, d: 0x9c6a0c, glow: 0xffe27a, gem: 0xff3b5c },
  ruby: { a: 0xe0243c, b: 0x9e0f24, c: 0xff8a9a, d: 0x5c0714, glow: 0xff5068, gem: 0xffd24a },
  ice: { a: 0x9fe7ff, b: 0x4cc3f0, c: 0xe8fbff, d: 0x2a7fb0, glow: 0xb8f4ff, gem: 0xffffff },
  emerald: { a: 0x2fd67b, b: 0x14924d, c: 0xa6ffcf, d: 0x0a5a2e, glow: 0x5dffa4, gem: 0xfff27a },
  void: { a: 0x7c3aed, b: 0x3b0f86, c: 0xc4a8ff, d: 0x14062e, glow: 0xb57bff, gem: 0x22d3ee },
  fire: { a: 0xff7a1a, b: 0xd9310b, c: 0xffd35c, d: 0x7a1503, glow: 0xffb23f, gem: 0xfff1a8 },
  ocean: { a: 0x1fb6c9, b: 0x0e6f8f, c: 0x8ef1ff, d: 0x073b52, glow: 0x5ff2ff, gem: 0xfff5d6 },
  sakura: { a: 0xff9ec7, b: 0xe0689a, c: 0xffe0ef, d: 0x9c3a64, glow: 0xffc2de, gem: 0xffffff },
  toxic: { a: 0x9bff3a, b: 0x4fb80f, c: 0xe2ff9e, d: 0x245c06, glow: 0xc4ff5c, gem: 0x9bff3a },
  shadow: { a: 0x3a3d4f, b: 0x1c1e29, c: 0x6b708a, d: 0x0a0b10, glow: 0xff3355, gem: 0xff3355 },
  candy: { a: 0xff6fd8, b: 0x7c5cff, c: 0x6ff2ff, d: 0xffe16f, glow: 0xffffff, gem: 0x6ff2ff },
  nimbus: { a: 0x7c5cff, b: 0x4b2fd6, c: 0xc084fc, d: 0x22d3ee, glow: 0xa78bfa, gem: 0xf472b6 },
  silver: { a: 0xd9dee8, b: 0x9aa3b5, c: 0xffffff, d: 0x5a6275, glow: 0xe8f0ff, gem: 0x4cc3f0 },
};

// ------------------------------------------------------------------ voxels

/**
 * A voxel grid that turns into boxes: runs of the same colour are merged along x, and faces
 * hidden by solid neighbours are left out, so detailed models stay cheap to draw.
 */
export class Vox {
  constructor() {
    this.cells = new Map();
  }

  key(x, y, z) {
    return `${x},${y},${z}`;
  }

  set(x, y, z, colour, flags = 0) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (colour === null || colour === undefined) this.cells.delete(this.key(x, y, z));
    else this.cells.set(this.key(x, y, z), { x, y, z, c: colour >>> 0, f: flags });
    return this;
  }

  get(x, y, z) {
    return this.cells.get(this.key(x, y, z));
  }

  box(x, y, z, w, h, d, colour, flags = 0) {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) this.set(x + i, y + j, z + k, typeof colour === 'function' ? colour(x + i, y + j, z + k) : colour, flags);
    return this;
  }

  /** A ball; `colour` may be a function of the position for shading and patterns. */
  sphere(cx, cy, cz, r, colour, flags = 0, ry = r, rz = r) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          const dx = (x + 0.5 - cx) / r;
          const dy = (y + 0.5 - cy) / ry;
          const dz = (z + 0.5 - cz) / rz;
          if (dx * dx + dy * dy + dz * dz <= 1) this.set(x, y, z, typeof colour === 'function' ? colour(x, y, z, dx, dy, dz) : colour, flags);
        }
      }
    }
    return this;
  }

  /** An upright cylinder or cone (r0 at the bottom, r1 at the top). */
  cyl(cx, y0, cz, h, r0, r1 = r0, colour, flags = 0, hollow = 0) {
    for (let j = 0; j < h; j++) {
      const r = r0 + (r1 - r0) * (h <= 1 ? 0 : j / (h - 1));
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++) {
          const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
          if (d <= r + 0.15 && d >= (hollow ? r - hollow : -1)) this.set(x, y0 + j, z, typeof colour === 'function' ? colour(x, y0 + j, z, j / Math.max(1, h - 1)) : colour, flags);
        }
      }
    }
    return this;
  }

  /** A flat ring in the x/z plane. */
  ring(cx, y, cz, r, thick, colour, flags = 0, height = 1) {
    for (let x = Math.floor(cx - r - thick); x <= Math.ceil(cx + r + thick); x++) {
      for (let z = Math.floor(cz - r - thick); z <= Math.ceil(cz + r + thick); z++) {
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (Math.abs(d - r) <= thick / 2) for (let j = 0; j < height; j++) this.set(x, y + j, z, typeof colour === 'function' ? colour(x, y + j, z, Math.atan2(z + 0.5 - cz, x + 0.5 - cx)) : colour, flags);
      }
    }
    return this;
  }

  /** A line of voxels from a to b. */
  line(a, b, colour, flags = 0, width = 0) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])) * 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      const c = typeof colour === 'function' ? colour(t) : colour;
      if (width >= 0.8) this.sphere(x, y, z, width, c, flags);
      else this.set(Math.floor(x), Math.floor(y), Math.floor(z), c, flags);
    }
    return this;
  }

  /** Draws rows of text art: rows[0] is the top; each character is looked up in `pal`. */
  art(rows, pal, { x = 0, y = 0, z = 0, plane = 'xy', depth = 1, center = true } = {}) {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const ox = center ? -Math.floor(w / 2) : 0;
    rows.forEach((row, ri) => {
      [...row].forEach((ch, ci) => {
        const p = pal[ch];
        if (!p) return;
        const [c, f] = Array.isArray(p) ? p : [p, 0];
        for (let k = 0; k < depth; k++) {
          const u = ox + ci;
          const v = h - 1 - ri;
          if (plane === 'xy') this.set(x + u, y + v, z + k, c, f);
          else if (plane === 'zy') this.set(x + k, y + v, z + u, c, f);
          else this.set(x + u, y + k, z + v, c, f); // xz: rows run front to back
        }
      });
    });
    return this;
  }

  /** Copies another grid in, moved and optionally mirrored. */
  paste(other, dx = 0, dy = 0, dz = 0, mirrorX = false) {
    for (const v of other.cells.values()) this.set((mirrorX ? -v.x - 1 : v.x) + dx, v.y + dy, v.z + dz, v.c, v.f);
    return this;
  }

  mirrorX() {
    const out = new Vox();
    for (const v of this.cells.values()) out.set(-v.x - 1, v.y, v.z, v.c, v.f);
    return out;
  }

  solid(x, y, z) {
    const v = this.get(x, y, z);
    return Boolean(v && !(v.f & (GLOW | SEE)) && (v.c >>> 24 === 0 || v.c >>> 24 === 255));
  }

  /**
   * The boxes: runs of one colour along x, stacked up along y where they line up, with every
   * face that solid neighbours cover completely left out.
   */
  boxes() {
    const runs = [];
    const rows = new Map();
    for (const v of this.cells.values()) {
      const k = `${v.y},${v.z}`;
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push(v);
    }
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      let i = 0;
      while (i < row.length) {
        const s = row[i];
        let j = i;
        while (j + 1 < row.length && row[j + 1].x === row[j].x + 1 && row[j + 1].c === s.c && row[j + 1].f === s.f) j++;
        runs.push({ x0: s.x, x1: row[j].x, y0: s.y, y1: s.y, z: s.z, c: s.c, f: s.f });
        i = j + 1;
      }
    }
    // stack identical runs that sit directly on top of each other
    const stacks = new Map();
    for (const r of runs) {
      const k = `${r.z},${r.x0},${r.x1},${r.c},${r.f}`;
      if (!stacks.has(k)) stacks.set(k, []);
      stacks.get(k).push(r);
    }
    const merged = [];
    for (const list of stacks.values()) {
      list.sort((a, b) => a.y0 - b.y0);
      let cur = list[0];
      for (let i = 1; i < list.length; i++) {
        if (list[i].y0 === cur.y1 + 1) cur = { ...cur, y1: list[i].y0 };
        else { merged.push(cur); cur = list[i]; }
      }
      merged.push(cur);
    }
    const out = [];
    for (const b of merged) {
      const open = Boolean(b.f & (GLOW | SEE));
      const all = (fn) => {
        for (let x = b.x0; x <= b.x1; x++) for (let y = b.y0; y <= b.y1; y++) if (!fn(x, y)) return false;
        return true;
      };
      const side = (x) => {
        for (let y = b.y0; y <= b.y1; y++) if (!this.solid(x, y, b.z)) return false;
        return true;
      };
      let mask = 0;
      if (open || !side(b.x0 - 1)) mask |= 1;
      if (open || !side(b.x1 + 1)) mask |= 2;
      if (open || !all((x) => this.solid(x, b.y0 - 1, b.z))) mask |= 4;
      if (open || !all((x) => this.solid(x, b.y1 + 1, b.z))) mask |= 8;
      if (open || !all((x, y) => this.solid(x, y, b.z - 1))) mask |= 16;
      if (open || !all((x, y) => this.solid(x, y, b.z + 1))) mask |= 32;
      if (mask) out.push([b.x0, b.y0, b.z, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, 1, b.c, b.f, mask]);
    }
    return out;
  }
}

// ------------------------------------------------------------------ parts

/** A part: boxes from voxels (or a list), a pivot, a base rotation and animations. */
export function part({ p = [0, 0, 0], r, s, a, vox, b, c } = {}) {
  const out = { p };
  if (r && (r[0] || r[1] || r[2])) out.r = r;
  if (s && s !== 1) out.s = s;
  if (a && a.length) out.a = a;
  const boxes = [...(b || []), ...(vox ? vox.boxes() : [])];
  if (boxes.length) out.b = boxes;
  if (c && c.length) out.c = c;
  return out;
}

// animation shorthands
export const spin = (ax, sp, ph = 0) => ({ t: 'spin', ax, sp, ph });
export const sway = (ax, amp, sp, ph = 0) => ({ t: 'sway', ax, amp, sp, ph });
export const flap = (ax, amp, sp, ph = 0) => ({ t: 'flap', ax, amp, sp, ph });
export const bob = (amp, sp, ph = 0, ax = 'y') => ({ t: 'bob', amp, sp, ph, ax });
export const orbit = (r, sp, ph = 0, ax = 'y') => ({ t: 'orbit', r, sp, ph, ax });
export const pulse = (amp, sp, ph = 0) => ({ t: 'pulse', amp, sp, ph });
export const hop = (h, sp, ph = 0) => ({ t: 'hop', h, sp, ph });
export const trick = (ax, every, dur, ph = 0) => ({ t: 'trick', ax, every, dur, ph });
export const twitch = (ax, amp, every, dur = 0.25, ph = 0) => ({ t: 'twitch', ax, amp, every, dur, ph });

/** A particle stream. */
export const fx = (k, o = {}) => ({ k, at: o.at || [0, 0, 0], rate: o.rate ?? 4, v: o.v || [0, 6, 0], sp: o.sp ?? 3, life: o.life ?? 1.2, g: o.g ?? 0, sz: o.sz ?? 1, c: (o.c || [0xffffff]).map(rgb), ...(o.glow === false ? { solid: 1 } : {}) });
