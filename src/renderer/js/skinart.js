// Flat previews cut straight out of skin and cape textures with a canvas.

const cache = new Map();

function load(src) {
  if (!cache.has(src)) {
    cache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { cache.delete(src); reject(new Error('Could not read that image')); };
      img.src = src;
    }));
  }
  return cache.get(src);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return { c, g };
}

/** Draws part of the texture, optionally mirrored (old 64x32 skins reuse the right limbs for the left). */
function part(g, img, sx, sy, sw, sh, dx, dy, scale, mirror = false) {
  if (mirror) {
    g.save();
    g.translate((dx + sw) * scale, dy * scale);
    g.scale(-1, 1);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale);
    g.restore();
  } else {
    g.drawImage(img, sx, sy, sw, sh, dx * scale, dy * scale, sw * scale, sh * scale);
  }
}

/** The face plus hat layer, as a data URL. */
export async function head(texture, size = 64) {
  const img = await load(texture);
  const scale = size / 8;
  const { c, g } = canvas(size, size);
  part(g, img, 8, 8, 8, 8, 0, 0, scale);
  part(g, img, 40, 8, 8, 8, 0, 0, scale);
  return c.toDataURL();
}

/** A front view of the whole player, 16x32 skin pixels. */
export async function doll(texture, slim = false, scale = 5) {
  const img = await load(texture);
  const legacy = img.height === 32;
  const arm = slim ? 3 : 4;
  const { c, g } = canvas(16 * scale, 32 * scale);
  const off = 4 - arm; // slim arms sit against the body
  // base layer
  part(g, img, 8, 8, 8, 8, 4, 0, scale); // head
  part(g, img, 20, 20, 8, 12, 4, 8, scale); // body
  part(g, img, 44, 20, arm, 12, off, 8, scale); // right arm (viewer's left)
  if (legacy) part(g, img, 44, 20, arm, 12, 12, 8, scale, true);
  else part(g, img, 36, 52, arm, 12, 12, 8, scale);
  part(g, img, 4, 20, 4, 12, 4, 20, scale); // right leg
  if (legacy) part(g, img, 4, 20, 4, 12, 8, 20, scale, true);
  else part(g, img, 20, 52, 4, 12, 8, 20, scale);
  // outer layer (hat, jacket, sleeves, trousers)
  part(g, img, 40, 8, 8, 8, 4, 0, scale);
  if (!legacy) {
    part(g, img, 20, 36, 8, 12, 4, 8, scale);
    part(g, img, 44, 36, arm, 12, off, 8, scale);
    part(g, img, 52, 52, arm, 12, 12, 8, scale);
    part(g, img, 4, 36, 4, 12, 4, 20, scale);
    part(g, img, 4, 52, 4, 12, 8, 20, scale);
  }
  return c.toDataURL();
}

/** The outside of a cape (the part other players see). */
export async function cape(texture, scale = 6) {
  const img = await load(texture);
  // capes come as 64x32 or HD multiples of it
  const k = img.width / 64;
  const { c, g } = canvas(10 * scale, 16 * scale);
  g.drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, 10 * scale, 16 * scale);
  return c.toDataURL();
}

/** Slim (Alex) skins leave the outermost arm column empty. */
export async function looksSlim(texture) {
  const img = await load(texture);
  if (img.height === 32) return false;
  const { c, g } = canvas(64, 64);
  g.drawImage(img, 0, 0);
  const px = g.getImageData(54, 20, 2, 12).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return false;
  return true;
}

/** Reads a dropped file as a data URL and makes sure it is a skin-sized PNG. */
export async function readSkinFile(file) {
  if (!/\.png$/i.test(file.name) && file.type !== 'image/png') throw new Error('Drop a PNG skin file.');
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read that file'));
    r.readAsDataURL(file);
  });
  const img = await load(url);
  if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) {
    throw new Error(`Minecraft skins are 64×64 (or 64×32) pixels — this one is ${img.width}×${img.height}.`);
  }
  return { name: file.name.replace(/\.png$/i, ''), texture: url };
}
