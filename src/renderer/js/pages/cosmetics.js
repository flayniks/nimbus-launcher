// Cosmetics: 3D hats, pets, wings and auras. Pick one per slot; it shows on you in game straight
// away, and on every other Nimbus player's screen once it's shared.
import { h, icon, clear, fail } from '../ui.js';
import { api, store } from '../store.js';
import { COSMETICS, SLOTS, RARITY, CosmeticViewer, thumbnails, byId } from '../cosmetics3d.js';

const ORDER = ['mythic', 'legendary', 'epic', 'rare', 'common'];
const thumbs = new Map(); // id -> data URL, kept for the whole session
let lastSlot = 'hat';

export function render(page) {
  let state = { worn: {}, sync: { state: 'local' }, showOthers: true };
  let slot = lastSlot;
  let rarity = 'all';
  let hovering = null;

  // ------------------------------------------------------------ the 3D stage
  const canvas = h('canvas.cz-canvas');
  const stage = h('div.cz-stage', canvas);
  let viewer = null;
  try {
    viewer = new CosmeticViewer(canvas);
  } catch {
    stage.append(h('div.cz-nogl', icon('alert'), h('span', '3D preview needs graphics acceleration')));
  }
  const worn = h('div.cz-worn');
  const syncNote = h('div.cz-sync');
  const fit = () => {
    if (!viewer) return;
    const w = Math.max(240, stage.clientWidth);
    const hgt = Math.max(320, stage.clientHeight);
    viewer.resize(w, hgt);
  };
  const ro = new ResizeObserver(fit);
  ro.observe(stage);

  // ------------------------------------------------------------ the picker
  const tabs = h('div.cz-tabs');
  const filters = h('div.cz-filters');
  const grid = h('div.cz-grid');

  page.append(
    h('div.page-head', h('div', h('h1', 'Cosmetics'), h('p', '100 hats, pets, wings and auras in 3D. Every Nimbus player sees them on you in Fabric and Quilt games.'))),
    h('div.cz-shell',
      h('div.cz-left', stage, worn, syncNote),
      h('div.cz-right', tabs, filters, grid)),
  );

  function drawTabs() {
    clear(tabs);
    for (const [id, label] of SLOTS) {
      const count = COSMETICS.filter((c) => c.slot === id).length;
      tabs.append(h(`button.cz-tab${slot === id ? '.on' : ''}`, { onclick: () => { slot = id; lastSlot = id; drawTabs(); drawGrid(); } },
        h('b', label), h('span', String(count)), state.worn[id] ? h('i.cz-dot') : null));
    }
    clear(filters);
    for (const r of ['all', ...ORDER]) {
      filters.append(h(`button.cz-chip${rarity === r ? '.on' : ''}`, { style: r === 'all' ? {} : { '--rc': RARITY[r] }, onclick: () => { rarity = r; drawTabs(); drawGrid(); } }, r === 'all' ? 'All' : r[0].toUpperCase() + r.slice(1)));
    }
  }

  function card(item) {
    const on = state.worn[item.slot] === item.id;
    // no src until the picture exists: an empty one counts as broken and gets hidden
    const img = h('img.cz-thumb', thumbs.has(item.id) ? { alt: '', src: thumbs.get(item.id) } : { alt: '' });
    img.dataset.id = item.id;
    const el = h(`div.cz-card${on ? '.on' : ''}`, { style: { '--rc': RARITY[item.rarity] }, title: item.desc, tabIndex: 0 },
      h('div.cz-thumb-box', img, on ? h('span.cz-check', icon('check')) : null),
      h('div.cz-meta', h('b', item.name), h('span.cz-rarity', item.rarity)));
    el.onclick = () => wear(item);
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wear(item); } };
    el.onmouseenter = () => tryOn(item);
    el.onmouseleave = () => tryOn(null);
    return el;
  }

  function drawGrid() {
    clear(grid);
    const items = COSMETICS.filter((c) => c.slot === slot && (rarity === 'all' || c.rarity === rarity))
      .sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name));
    const none = h(`div.cz-card.cz-none${state.worn[slot] ? '' : '.on'}`, { tabIndex: 0 },
      h('div.cz-thumb-box', icon('x')), h('div.cz-meta', h('b', 'Nothing'), h('span.cz-rarity', `no ${SLOTS.find(([s]) => s === slot)[1].toLowerCase().replace(/s$/, '')}`)));
    none.onclick = () => wear({ slot, id: null });
    grid.append(none, ...items.map(card));
  }

  function drawWorn() {
    clear(worn);
    for (const [s, label] of SLOTS) {
      const item = byId.get(state.worn[s]);
      worn.append(h(`div.cz-worn-chip${item ? '.on' : ''}`, { style: item ? { '--rc': RARITY[item.rarity] } : {} },
        h('span', label.replace(/s$/, '')), h('b', item ? item.name : '—')));
    }
    clear(syncNote);
    const shared = state.sync?.state === 'shared';
    syncNote.append(icon(shared ? 'globe' : 'alert'), h('span', shared
      ? 'Everyone on Nimbus sees these on you.'
      : 'Only you see these for now. Sign in with a Microsoft account to show them to other players.'));
    syncNote.classList.toggle('warn', !shared);
  }

  async function wear(item) {
    const id = item.id && state.worn[item.slot] === item.id ? null : item.id;
    try {
      state = await api.cosmetics.set(item.slot, id);
      viewer?.equip(item.slot, id);
      drawTabs();
      drawGrid();
      drawWorn();
    } catch (err) {
      fail('Could not put that on', err);
    }
  }

  // hovering a card tries it on without wearing it
  function tryOn(item) {
    if (!viewer) return;
    if (hovering) viewer.equip(hovering, state.worn[hovering] || null);
    hovering = item ? item.slot : null;
    if (item) viewer.equip(item.slot, item.id);
  }

  // ------------------------------------------------------------ load
  const stopThumbs = thumbnails(COSMETICS.map((c) => c.id).filter((id) => !thumbs.has(id)), 160, (id, url) => {
    thumbs.set(id, url);
    const img = grid.querySelector(`img[data-id="${id}"]`);
    if (img) {
      img.classList.remove('broken');
      img.src = url;
    }
  });

  const offState = api.on('cosmetics:state', (st) => { state = st; drawWorn(); });
  (async () => {
    try { state = await api.cosmetics.state(); } catch { /* keep defaults */ }
    for (const [s] of SLOTS) viewer?.equip(s, state.worn[s] || null);
    drawTabs();
    drawGrid();
    drawWorn();
    try {
      const view = store.activeAccount() ? await api.skins.state() : null;
      if (view?.skin?.texture) viewer?.setSkin(view.skin.texture, view.skin.variant === 'slim');
    } catch { /* the plain skin stays */ }
  })();
  drawTabs();
  drawGrid();
  drawWorn();
  if (viewer) {
    fit();
    viewer.start();
  }
  const pause = () => {
    if (!viewer) return;
    if (document.body.classList.contains('game-running') || document.hidden) viewer.stop();
    else if (viewer.stopped) viewer.start();
  };
  document.addEventListener('visibilitychange', pause);
  const offGame = store.on('game-state', pause);

  return () => {
    stopThumbs();
    ro.disconnect();
    offState?.();
    offGame?.();
    document.removeEventListener('visibilitychange', pause);
    viewer?.dispose();
  };
}
