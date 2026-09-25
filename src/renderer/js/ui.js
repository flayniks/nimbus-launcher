// Small DOM toolkit: element builder, icons, toasts, modals, formatting.

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const icons = {
  logo: P('<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>'),
  home: P('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  compass: P('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  zap: P('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  settings: P('<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  users: P('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.6v14.8a1 1 0 0 0 1.5.9l12.2-7.4a1 1 0 0 0 0-1.8L8.5 3.7A1 1 0 0 0 7 4.6z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  download: P('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
  heart: P('<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>'),
  x: P('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: P('<path d="M20 6 9 17l-5-5"/>'),
  alert: P('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'),
  folder: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  wrench: P('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>'),
  trash: P('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  copy: P('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  back: P('<path d="m15 18-6-6 6-6"/>'),
  external: P('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  cpu: P('<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
  memory: P('<path d="M6 19v-3M10 19v-3M14 19v-3M18 19v-3M8 11V9M16 11V9M12 11V9M2 15h20M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.8V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.8z"/>'),
  monitor: P('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  box: P('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
  image: P('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
  sparkles: P('<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>'),
  package: P('<path d="M16.5 9.4 7.5 4.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>'),
  terminal: P('<path d="m4 17 6-6-6-6M12 19h8"/>'),
  refresh: P('<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/>'),
  sliders: P('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  gauge: P('<path d="M12 14 16 10"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>'),
  feather: P('<path d="M20.2 12.2a6 6 0 0 0-8.5-8.5L5 10.5V19h8.5z"/><path d="M16 8 2 22M17.5 15H9"/>'),
  scale: P('<path d="M12 3v18M5 21h14M3 7h18M6 7l-3 7a4 4 0 0 0 6 0zM18 7l-3 7a4 4 0 0 0 6 0z"/>'),
  rocket: P('<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  coffee: P('<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2"/>'),
  upload: P('<path d="M12 21V9m0 0-4 4m4-4 4 4M4 7V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3"/>'),
  min: P('<path d="M5 12h14"/>'),
  max: P('<rect x="5" y="5" width="14" height="14" rx="1.5"/>'),
  lock: P('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  eye: P('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  layers: P('<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>'),
  server: P('<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>'),
  logout: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  palette: P('<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2c0-.5-.2-1-.5-1.4-.3-.3-.5-.8-.5-1.3a2 2 0 0 1 2-2h2.3A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z"/>'),
  // loaders
  vanilla: P('<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/><path d="M7.5 9.5v5M16.5 9.5v5" opacity=".5"/>'),
  fabric: P('<path d="M4 20 20 4M8 20l12-12M4 16 16 4M12 20l8-8M4 12l8-8"/>'),
  quilt: P('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="4"/>'),
  forge: P('<path d="M3 8h13l5-3v5l-5 1H9l-1 4h4l1 4H5l1-4h2"/>'),
  neoforge: P('<path d="M12 22c4.4 0 7-2.9 7-7 0-4.5-4-6.4-4-11-2.6 1.6-4 4.1-4 7-1-1-1.7-2.2-2-3.5C7.3 9.3 5 11.6 5 15c0 4.1 2.6 7 7 7z"/>'),
};

export function icon(name) {
  const span = document.createElement('span');
  span.style.display = 'contents';
  span.innerHTML = icons[name] || '';
  return span.firstChild;
}

/** h('div#id.card.pad', {onclick}, ...children) — tag#id.class shorthand, children may be nodes, strings or arrays. */
export function h(sel, attrs, ...children) {
  const [head, ...classes] = sel.split('.');
  const [tag, id] = head.split('#');
  const el = document.createElement(tag || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'icon') el.appendChild(icon(v));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Assigns --i so .stagger children animate in one after another. */
export function stagger(parent) {
  [...parent.children].forEach((c, i) => c.style.setProperty('--i', i));
  return parent;
}

// ---------------------------------------------------------------- formatting

export function fmtNumber(n) {
  if (n == null) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtDuration(sec) {
  if (!sec) return 'No playtime yet';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (hrs) return `${hrs}h ${mins}m played`;
  return `${Math.max(1, mins)}m played`;
}

export function fmtAgo(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

/** A stable pair of colours per name for instances without an icon. */
export function instanceIcon(inst, size = '') {
  const el = h(`div.inst-icon${size ? `.${size}` : ''}`);
  if (inst.icon) {
    const img = h('img', { src: inst.icon, alt: '', loading: 'lazy', decoding: 'async' });
    img.onerror = () => { img.remove(); fill(); };
    el.appendChild(img);
  } else fill();
  function fill() {
    let hash = 0;
    for (const ch of inst.name || '?') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = hash % 360;
    el.style.background = `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 50) % 360} 75% 42%))`;
    const letters = (inst.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    el.textContent = letters || '?';
  }
  return el;
}

export function avatarUrl(uuid, size = 64) {
  return `https://mc-heads.net/avatar/${uuid}/${size}`;
}

// ---------------------------------------------------------------- toasts

export function toast(kind, title, message, { actions = [], timeout = kind === 'err' ? 8000 : 4200 } = {}) {
  const host = document.getElementById('toasts');
  const ic = { ok: 'check', err: 'alert', info: 'info' }[kind] || 'info';
  const el = h(`div.toast.${kind}`,
    h('div.ti', { icon: ic }),
    h('div.tx', h('b', title), message ? h('span', message) : null,
      actions.length ? h('div.acts', actions.map((a) => h('button.btn.sm', { onclick: () => { a.run(); close(); } }, a.label))) : null),
    h('button.x', { icon: 'x', onclick: () => close() }),
    timeout ? h('div.life', { style: { animationDuration: `${timeout}ms` } }) : null);
  host.appendChild(el);
  let timer = timeout ? setTimeout(close, timeout) : null;
  el.addEventListener('mouseenter', () => { clearTimeout(timer); el.querySelector('.life')?.style.setProperty('animation-play-state', 'paused'); });
  el.addEventListener('mouseleave', () => { if (timeout) { timer = setTimeout(close, 2000); } });
  function close() {
    clearTimeout(timer);
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
  while (host.children.length > 4) host.firstChild.remove();
  return close;
}

export const ok = (t, m, o) => toast('ok', t, m, o);
export const fail = (t, err, o) => toast('err', t, err?.message || String(err || ''), o);
export const info = (t, m, o) => toast('info', t, m, o);

// ---------------------------------------------------------------- modals

export function modal({ title, body, footer, size = '', onClose, head } = {}) {
  const root = document.getElementById('modal-root');
  const box = h(`div.modal${size ? `.${size}` : ''}`,
    head || h('header', h('h3', title || ''), h('button.btn.ghost.icon.sm', { icon: 'x', onclick: () => close() })),
    h('div.body', body),
    footer ? h('footer', footer) : null);
  const back = h('div.modal-back', box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.appendChild(back);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    back.classList.add('closing');
    setTimeout(() => back.remove(), 190);
    if (onClose) onClose();
  }
  return { el: box, close };
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { answered = true; resolve(v); m.close(); };
    const m = modal({
      title,
      size: 'narrow',
      body: h('p.muted', { style: { margin: '0 0 6px' } }, message),
      footer: [
        h('button.btn.ghost', { onclick: () => done(false) }, 'Cancel'),
        h(`button.btn${danger ? '.danger' : '.primary'}`, { onclick: () => done(true) }, confirm),
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/** A segmented control with a sliding thumb. options: [{value,label,icon,disabled}] */
export function segmented(options, value, onChange) {
  const thumb = h('i.thumb');
  const seg = h('div.seg', thumb);
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', disabled: o.disabled, title: o.title || null, onclick: () => set(o.value, true) }, o.icon ? icon(o.icon) : null, o.label);
    b.dataset.value = o.value;
    seg.appendChild(b);
    return b;
  });
  function place() {
    const on = buttons.find((b) => b.dataset.value === String(value));
    buttons.forEach((b) => b.classList.toggle('on', b === on));
    if (!on) { thumb.style.width = '0'; return; }
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  function set(v, user) {
    value = v;
    place();
    if (user && onChange) onChange(v);
  }
  requestAnimationFrame(place);
  new ResizeObserver(place).observe(seg);
  seg.set = (v) => set(v, false);
  return seg;
}

export function toggle(checked, onChange, { disabled = false } = {}) {
  const input = h('input', { type: 'checkbox', checked, disabled, onchange: () => onChange(input.checked) });
  return h('label.toggle', input, h('i'));
}

export function rangeFill(input) {
  const upd = () => {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  };
  input.addEventListener('input', upd);
  upd();
  return input;
}

export function spinnerButton(btn, promiseFn, busyLabel) {
  return async (...args) => {
    const original = [...btn.childNodes];
    btn.disabled = true;
    btn.replaceChildren(h('i.spinner'), busyLabel || '');
    try {
      return await promiseFn(...args);
    } finally {
      btn.disabled = false;
      btn.replaceChildren(...original);
    }
  };
}

/** Swaps an element for a new one with a quick fade, used for lists that refresh in place. */
export function swap(oldEl, newEl) {
  newEl.style.animation = 'fade .25s both';
  oldEl.replaceWith(newEl);
  return newEl;
}
