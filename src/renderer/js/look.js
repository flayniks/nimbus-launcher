// Applies Settings → Appearance and Animations: themes, colours, the animated
// background, glass, shapes, size and motion. Mostly flips data-* attributes that
// look.css keys off; the starfield, the tilt and the speed dial need a little code.
import { h } from './ui.js';
import { api, store } from './store.js';

let speed = 1;
let backdropKind = null;
let backdropImage = null;
let stars = null;

export function applyLook(s = {}) {
  const root = document.documentElement;
  root.dataset.theme = s.theme || 'midnight';
  if (s.accent === 'custom') {
    root.dataset.accent = 'custom';
    root.style.setProperty('--a1', s.customA1 || '#7c5cff');
    root.style.setProperty('--a2', s.customA2 || '#c084fc');
  } else {
    root.dataset.accent = s.accent || 'violet';
    root.style.removeProperty('--a1');
    root.style.removeProperty('--a2');
  }
  root.dataset.radius = s.radius || 'rounded';
  root.dataset.glass = s.glass === false ? 'off' : 'on';
  root.style.setProperty('--glass-blur', `${Number(s.glassBlur ?? 16)}px`);
  root.dataset.cards = s.cardStyle || 'glass';
  root.dataset.sidebar = s.sidebarLabels ? 'labels' : 'icons';
  root.dataset.transition = s.pageTransition || 'rise';
  root.dataset.stagger = s.stagger === false ? 'off' : 'on';
  root.dataset.hover = s.hoverEffect || 'lift';
  root.dataset.bgMotion = s.bgMotion === false ? 'off' : 'on';
  document.body.classList.toggle('no-anim', s.animations === false);
  speed = { relaxed: 0.7, normal: 1, snappy: 1.6 }[s.animSpeed] || 1;
  api.app.setZoom((Number(s.uiScale) || 100) / 100);
  drawBackdrop(s);
  // the sidebar may have changed width: let the pill find its item again
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

// ------------------------------------------------------------------ background

async function drawBackdrop(s) {
  const host = document.getElementById('backdrop');
  if (!host) return;
  const kind = s.background || 'aurora';
  const image = kind === 'image' ? s.bgImage : null;
  host.style.setProperty('--bg-blur', `${Number(s.bgBlur ?? 8)}px`);
  host.style.setProperty('--bg-dim', String((Number(s.bgDim ?? 45)) / 100));
  if (kind === backdropKind && image === backdropImage) {
    if (stars) stars.motion = s.bgMotion !== false;
    return;
  }
  backdropKind = kind;
  backdropImage = image;
  if (stars) { stars.stop(); stars = null; }
  host.replaceChildren();
  if (kind === 'aurora') {
    host.append(h('div.aurora', h('i'), h('i'), h('i')), h('div.grain'));
  } else if (kind === 'stars') {
    const canvas = h('canvas');
    host.append(h('div.aurora', { style: { opacity: '0.55' } }, h('i'), h('i')), canvas);
    stars = starfield(canvas);
    stars.motion = s.bgMotion !== false;
  } else if (kind === 'grid') {
    host.append(h('div.gridfloor', h('div.sun'), h('div.plane')));
  } else if (kind === 'image' && image) {
    const photo = h('div.photo');
    host.append(photo, h('div.photo-dim'), h('div.grain'));
    try {
      const url = await api.look.background();
      if (url && backdropImage === image) photo.style.backgroundImage = `url("${url}")`;
    } catch { /* image gone: stays plain */ }
  }
}

/** Twinkling dots drifting upwards, in the accent colours. Sleeps while a game runs. */
function starfield(canvas) {
  const g = canvas.getContext('2d');
  const dots = [];
  let raf = 0;
  let w = 0;
  let hgt = 0;
  const state = { motion: true, stop: () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size); } };
  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    return [cs.getPropertyValue('--a1').trim() || '#7c5cff', cs.getPropertyValue('--a2').trim() || '#c084fc', '#ffffff'];
  };
  function size() {
    const r = window.devicePixelRatio || 1;
    w = canvas.clientWidth;
    hgt = canvas.clientHeight;
    canvas.width = Math.max(1, w * r);
    canvas.height = Math.max(1, hgt * r);
    g.setTransform(r, 0, 0, r, 0, 0);
  }
  size();
  window.addEventListener('resize', size);
  const palette = colors();
  for (let i = 0; i < 140; i++) {
    dots.push({ x: Math.random() * w, y: Math.random() * hgt, r: Math.random() * 1.6 + 0.3, v: Math.random() * 12 + 4, p: Math.random() * Math.PI * 2, c: palette[i % 3] });
  }
  let last = performance.now();
  const frame = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const idle = document.hidden || document.body.classList.contains('game-running');
    if (!idle) {
      g.clearRect(0, 0, w, hgt);
      for (const d of dots) {
        if (state.motion) {
          d.y -= d.v * dt;
          d.p += dt * 2;
          if (d.y < -4) { d.y = hgt + 4; d.x = Math.random() * w; }
        }
        g.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(d.p));
        g.fillStyle = d.c;
        g.beginPath();
        g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        g.fill();
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return state;
}

// ------------------------------------------------------------------ motion

/** The speed dial: every CSS animation and transition plays faster or slower. */
function adjust(e) {
  if (speed === 1 || !e.target?.getAnimations) return;
  for (const a of e.target.getAnimations()) {
    const infinite = a.effect?.getTiming?.().iterations === Infinity;
    if (!infinite && a.playbackRate !== speed) a.playbackRate = speed;
  }
}
document.addEventListener('animationstart', adjust, true);
document.addEventListener('transitionrun', adjust, true);

/** Cards lean towards the mouse when the hover effect is Tilt. */
document.addEventListener('mousemove', (e) => {
  if (document.documentElement.dataset.hover !== 'tilt') return;
  const card = e.target.closest?.('.inst-card, .pack-card');
  if (!card) return;
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  card.style.setProperty('--ry', `${(x - 0.5) * 10}deg`);
  card.style.setProperty('--rx', `${(0.5 - y) * 10}deg`);
  card.style.setProperty('--mx', `${x * 100}%`);
  card.style.setProperty('--my', `${y * 100}%`);
});

// ------------------------------------------------------------------ player counter

const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : n.toLocaleString());

/** The "online · playing · players" pill in the title bar. */
export function presencePill() {
  const nums = { online: h('b.num', '0'), playing: h('b.num', '0'), total: h('b.num', '0') };
  const pill = h('div.presence', { title: 'People with Nimbus open right now, people in a game, and everyone who has installed it. Counted anonymously.' },
    h('i.live'), nums.online, h('span', 'online'), h('i.sep'), nums.playing, h('span', 'playing'), h('i.sep'), nums.total, h('span', 'players'));
  let timer = null;
  const set = (el, n) => {
    const text = fmt(n);
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  };
  async function refresh() {
    clearTimeout(timer);
    if (store.settings?.showCounter === false) { pill.classList.remove('show'); timer = setTimeout(refresh, 20000); return; }
    try {
      const s = await api.presence.stats();
      set(nums.online, s.online);
      set(nums.playing, s.playing);
      set(nums.total, s.total);
      pill.classList.add('show');
    } catch {
      pill.classList.remove('show');
    }
    timer = setTimeout(refresh, 60000);
  }
  pill.refresh = refresh;
  setTimeout(refresh, 1500);
  return pill;
}
