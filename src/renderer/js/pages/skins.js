/* global skinview3d */
import { h, icon, clear, fail, ok, confirmDialog, segmented, toggle, debounce } from '../ui.js';
import { api, store } from '../store.js';
import { go } from '../router.js';
import * as art from '../skinart.js';

const ANIMS = {
  idle: () => new skinview3d.IdleAnimation(),
  walk: () => new skinview3d.WalkingAnimation(),
  run: () => new skinview3d.RunningAnimation(),
  fly: () => new skinview3d.FlyingAnimation(),
};

export function render(page) {
  const state = {
    view: null, // what the account wears: { name, skin: {texture, variant, url}, capes: [], wornId }
    wardrobe: [],
    preview: null, // a skin being tried on: { id?, name, texture, variant }
    showCape: true,
    anim: 'walk',
    error: null,
    busy: null,
  };
  const offs = [];

  // ------------------------------------------------------------ 3D viewer
  const canvas = h('canvas');
  const busy = h('div.stage-busy.hidden', h('i.spinner'), h('span', ''));
  const stage = h('div.skin-canvas', canvas, busy);
  let viewer = null;
  let shownName;
  let flat = null; // a flat front view when the GPU can't do WebGL
  try {
    viewer = new skinview3d.SkinViewer({ canvas, width: 340, height: 430 });
    viewer.fov = 38;
    viewer.zoom = 0.76;
    viewer.controls.enablePan = false;
    viewer.animation = ANIMS[state.anim]();
    viewer.animation.speed = 0.9;
    viewer.renderPaused = document.body.classList.contains('game-running');
  } catch {
    flat = h('img.flat-doll', { alt: '' });
    stage.replaceChildren(flat, h('div.flat-note', '3D preview needs graphics acceleration'), busy);
  }
  const fit = () => {
    if (!viewer) return;
    const w = Math.max(240, stage.clientWidth);
    viewer.width = w;
    viewer.height = 430;
  };
  const ro = new ResizeObserver(fit);
  ro.observe(stage);

  function capeTexture() {
    const c = state.view?.capes.find((x) => x.active);
    return c?.texture || null;
  }

  function paint() {
    const s = state.preview || (state.view?.skin ? { ...state.view.skin, name: state.view.name } : null);
    if (flat) {
      if (s?.texture) art.doll(s.texture, s.variant === 'slim', 10).then((src) => { flat.src = src; }).catch(() => {});
      return;
    }
    if (!viewer) return;
    if (s?.texture) viewer.loadSkin(s.texture, { model: s.variant === 'slim' ? 'slim' : 'default' });
    const cape = state.showCape ? capeTexture() : null;
    viewer.loadCape(cape, { backEquipment: state.anim === 'fly' ? 'elytra' : 'cape' });
    const name = state.view?.name || null;
    if (name !== shownName) {
      shownName = name;
      viewer.nameTag = name ? new skinview3d.NameTagObject(name, { font: '600 40px Inter, "Segoe UI", system-ui, sans-serif' }) : null;
    }
  }

  const animSeg = segmented([
    { value: 'idle', label: 'Idle' },
    { value: 'walk', label: 'Walk' },
    { value: 'run', label: 'Run' },
    { value: 'fly', label: 'Fly' },
  ], state.anim, (v) => {
    state.anim = v;
    if (viewer) { viewer.animation = ANIMS[v](); paint(); }
  });
  const capeSwitch = h('div.row-gap', { style: { gap: '8px', fontSize: '12.5px', color: 'var(--text-2)', fontWeight: 600 } },
    toggle(state.showCape, (on) => { state.showCape = on; paint(); }), 'Cape');

  // ------------------------------------------------------------ what you are wearing / previewing
  const bar = h('div.preview-bar');

  function drawBar() {
    clear(bar);
    const p = state.preview;
    if (p) {
      const variantSeg = segmented([
        { value: 'classic', label: 'Classic arms' },
        { value: 'slim', label: 'Slim arms' },
      ], p.variant, (v) => { p.variant = v; paint(); });
      const wear = h('button.btn.primary', { icon: 'check', disabled: !state.view || Boolean(state.busy) }, 'Wear this skin');
      wear.onclick = () => applyPreview();
      bar.append(...[
        h('div.row-gap', h('span.tag.accent', 'Previewing'), h('b', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name)),
        variantSeg,
        h('div.row-gap', wear,
          p.id ? null : h('button.btn', { icon: 'download', title: 'Keep it in your wardrobe without wearing it', onclick: () => saveFound(p) }, 'Save'),
          h('button.btn.ghost', { onclick: () => { state.preview = null; paint(); drawBar(); drawWardrobe(); drawResults(); } }, 'Back to mine')),
        !state.view ? h('div.note', icon('info'), h('span', 'Sign in to wear skins. You can still collect them in your wardrobe.')) : null].filter(Boolean));
      return;
    }
    const worn = state.wardrobe.find((w) => w.id === state.view?.wornId);
    bar.append(...[
      h('div.row-gap', h('span.tag.good', icon('check'), 'Wearing'), h('b', { style: { flex: 1 } }, worn?.name || (state.view?.skin ? 'Your skin' : 'Nothing yet')),
        state.view?.skin ? h('span.tag', state.view.skin.variant === 'slim' ? 'Slim arms' : 'Classic arms') : null),
      h('div.muted', { style: { fontSize: '12.5px' } }, 'Click any skin to try it on. Drag to spin the player.'),
      state.view?.skin ? h('button.btn.sm.ghost.danger', { icon: 'refresh', style: { justifySelf: 'start' }, onclick: resetSkin }, 'Reset to default skin') : null].filter(Boolean));
  }

  // ------------------------------------------------------------ wardrobe
  const grid = h('div.skin-grid');
  const pickBtn = h('button.btn.sm', { icon: 'upload', onclick: pickFile }, 'Upload PNG');

  async function drawWardrobe() {
    clear(grid);
    grid.appendChild(h('button.skin-tile.add', { onclick: pickFile, title: 'Add a skin PNG' }, h('div.plus', icon('plus')), h('div.name', 'Add skin')));
    state.wardrobe.forEach((item, i) => {
      const img = h('img', { alt: '' });
      art.doll(item.texture, item.variant === 'slim', 4).then((src) => { img.src = src; }).catch(() => {});
      const on = state.preview ? state.preview.id === item.id : state.view?.wornId === item.id;
      const tile = h(`div.skin-tile${on ? '.on' : ''}`, {
        style: { animation: `rise .35s var(--ease) both ${Math.min(i, 12) * 30}ms` },
        title: item.name,
        onclick: () => preview({ id: item.id, name: item.name, texture: item.texture, variant: item.variant }),
      },
      state.view?.wornId === item.id ? h('span.tag.good.badge', 'Wearing') : null,
      h('button.del', {
        icon: 'trash',
        title: 'Remove from wardrobe',
        onclick: async (e) => {
          e.stopPropagation();
          if (!(await confirmDialog({ title: `Remove ${item.name}?`, message: 'It is only removed from your wardrobe on this computer.', confirm: 'Remove', danger: true }))) return;
          state.wardrobe = await api.skins.remove(item.id);
          if (state.preview?.id === item.id) { state.preview = null; paint(); drawBar(); }
          drawWardrobe();
        },
      }),
      img,
      h('div.name', item.name));
      grid.appendChild(tile);
    });
  }

  function preview(p) {
    if (!state.preview && p.id && state.view?.wornId === p.id) return;
    state.preview = p;
    paint();
    drawBar();
    drawWardrobe();
    drawResults();
  }

  async function addToWardrobe({ name, texture, source }, show = true) {
    const variant = (await art.looksSlim(texture).catch(() => false)) ? 'slim' : 'classic';
    state.wardrobe = await api.skins.import({ texture, name, variant, source });
    await drawWardrobe();
    const entry = state.wardrobe.find((w) => w.texture === texture);
    if (show && entry) preview({ id: entry.id, name: entry.name, texture: entry.texture, variant: entry.variant });
  }

  async function pickFile() {
    try {
      const file = await api.skins.pick();
      if (file) await addToWardrobe({ ...file, source: 'file' });
    } catch (err) { fail('Could not add that skin', err); }
  }

  // ------------------------------------------------------------ finding skins
  // one box for both: a player with that name comes first, then gallery skins with it in their name
  const found = { query: '', skins: [], next: null, loading: false, error: null, gen: 0 };
  const results = h('div.skin-grid.small');
  const more = h('button.btn.sm.hidden', { icon: 'plus', onclick: () => runSearch(true) }, 'Show more');
  const searchInput = h('input.input', { placeholder: 'Search skins or a player name…', maxlength: 40 });
  const runSearchSoon = debounce(() => runSearch(false), 450);
  searchInput.addEventListener('input', runSearchSoon);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(false); });

  const IDEAS = ['knight', 'ninja', 'hoodie', 'robot', 'pirate', 'astronaut', 'creeper', 'wizard'];

  async function runSearch(append) {
    const query = searchInput.value.trim();
    if (!append && !query) {
      found.gen++;
      Object.assign(found, { query: '', skins: [], next: null, loading: false, error: null });
      drawResults();
      return;
    }
    if (!append && query === found.query && found.skins.length && !found.error) return;
    const gen = ++found.gen;
    found.loading = true;
    found.error = null;
    if (!append) { found.query = query; found.skins = []; found.next = null; }
    drawResults();
    try {
      const res = await api.skins.search(query, append ? found.next : null);
      if (gen !== found.gen) return;
      const seen = new Set(found.skins.map((x) => x.texture));
      found.skins.push(...res.skins.filter((x) => !seen.has(x.texture)));
      found.next = res.next;
    } catch (err) {
      if (gen !== found.gen) return;
      found.error = err;
    } finally {
      if (gen === found.gen) { found.loading = false; drawResults(); }
    }
  }

  async function variantOf(r) {
    if (r.variant) return r.variant;
    return (await art.looksSlim(r.texture).catch(() => false)) ? 'slim' : 'classic';
  }

  function drawResults() {
    clear(results);
    found.skins.forEach((r, i) => {
      const img = h('img', { alt: '' });
      variantOf(r).then((v) => art.doll(r.texture, v === 'slim', 3)).then((src) => { img.src = src; }).catch(() => {});
      const on = state.preview && !state.preview.id && state.preview.texture === r.texture;
      results.appendChild(h(`div.skin-tile${on ? '.on' : ''}`, {
        style: { animation: `rise .3s var(--ease) both ${Math.min(i, 18) * 18}ms` },
        title: r.source === 'player' ? `${r.name} is wearing this right now` : r.name,
        onclick: async () => preview({ name: r.source === 'player' ? `${r.name}'s skin` : r.name, texture: r.texture, variant: await variantOf(r), source: r.source }),
      },
      r.source === 'player' ? h('span.tag.accent.badge', icon('user'), 'Player') : null,
      h('button.del.save', {
        icon: 'download',
        title: 'Save to wardrobe',
        onclick: async (e) => {
          e.stopPropagation();
          saveFound({ name: r.source === 'player' ? `${r.name}'s skin` : r.name, texture: r.texture, variant: await variantOf(r), source: r.source });
        },
      }),
      img,
      h('div.name', r.name)));
    });
    if (found.loading) {
      results.appendChild(h('div.results-note', h('i.spinner'), h('span', found.skins.length ? 'Loading more…' : 'Searching…')));
    } else if (found.error) {
      results.appendChild(h('div.results-note', icon('alert'), h('span', found.error.message)));
    } else if (!found.query) {
      results.appendChild(h('div.results-note.ideas', h('span', 'Type a player name to copy their skin, or try'),
        ...IDEAS.map((word) => h('button.chip', { onclick: () => { searchInput.value = word; runSearch(false); } }, word))));
    } else if (!found.skins.length) {
      results.appendChild(h('div.results-note', icon('search'), h('span', `Nothing called “${found.query}”. Try another word.`)));
    }
    more.classList.toggle('hidden', !found.next || found.loading || Boolean(found.error));
  }

  async function saveFound(p) {
    try {
      state.wardrobe = await api.skins.import({ texture: p.texture, name: p.name, variant: p.variant, source: p.source || 'gallery' });
      const entry = state.wardrobe.find((w) => w.texture === p.texture);
      if (state.preview && !state.preview.id && state.preview.texture === p.texture && entry) {
        state.preview = { id: entry.id, name: entry.name, texture: entry.texture, variant: p.variant };
        drawBar();
      }
      await drawWardrobe();
      drawResults();
      ok('Saved to your wardrobe', p.name);
    } catch (err) { fail('Could not save it', err); }
  }

  // ------------------------------------------------------------ capes
  const capeGrid = h('div.cape-grid');

  function drawCapes() {
    clear(capeGrid);
    const capes = state.view?.capes || [];
    if (!state.view) {
      capeGrid.appendChild(h('div.muted', { style: { fontSize: '12.5px' } }, 'Sign in to see the capes you own.'));
      return;
    }
    const none = !capes.some((c) => c.active);
    capeGrid.appendChild(h(`button.cape-tile${none ? '.on' : ''}`, { onclick: () => setCape(null) },
      h('div.nocape', icon('x')), h('div.name', 'No cape')));
    for (const c of capes) {
      const img = h('img', { alt: '' });
      if (c.texture) art.cape(c.texture, 5).then((src) => { img.src = src; }).catch(() => {});
      capeGrid.appendChild(h(`button.cape-tile${c.active ? '.on' : ''}`, { title: c.name, onclick: () => setCape(c.id) }, img, h('div.name', c.name)));
    }
    if (!capes.length) {
      capeGrid.appendChild(h('div.muted', { style: { fontSize: '12.5px', alignSelf: 'center' } },
        'This account has no capes yet. Capes come from Minecraft events, Minecon and Mojang promotions.'));
    }
  }

  // ------------------------------------------------------------ talking to Mojang
  async function work(label, fn) {
    if (state.busy) return null;
    state.busy = label;
    busy.classList.remove('hidden');
    busy.lastChild.textContent = label;
    drawBar();
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'REAUTH' || err.code === 'NO_ACCOUNT') {
        state.error = err;
        drawBanner();
      }
      fail('Mojang said no', err);
      return null;
    } finally {
      state.busy = null;
      busy.classList.add('hidden');
      drawBar();
    }
  }

  function took(view) {
    if (!view) return;
    state.view = view;
    store.emit('skin-changed', view);
    paint();
    drawBar();
    drawWardrobe();
    drawCapes();
  }

  async function applyPreview() {
    const p = state.preview;
    if (!p) return;
    const view = await work('Putting it on…', () => api.skins.apply(p.id ? { id: p.id, variant: p.variant } : { texture: p.texture, variant: p.variant, name: p.name }));
    if (view) {
      state.preview = null;
      state.wardrobe = await api.skins.wardrobe();
      took(view);
      ok('Skin changed', 'You will see it the next time you join a world or server.');
    }
  }

  async function resetSkin() {
    if (!(await confirmDialog({ title: 'Go back to a default skin?', message: 'Mojang picks one of the default characters for you. Your wardrobe keeps every skin you saved.', confirm: 'Reset' }))) return;
    const view = await work('Resetting…', () => api.skins.reset());
    if (view) { took(view); ok('Skin reset'); }
  }

  async function setCape(id) {
    const current = state.view?.capes.find((c) => c.active)?.id || null;
    if (current === id) return;
    const view = await work(id ? 'Putting on the cape…' : 'Taking the cape off…', () => api.skins.cape(id));
    if (view) { took(view); ok(id ? 'Cape on' : 'Cape off'); }
  }

  // ------------------------------------------------------------ layout
  const banner = h('div');
  function drawBanner() {
    clear(banner);
    const acc = store.activeAccount();
    if (!acc || state.error) {
      banner.appendChild(h('div.target-banner', icon('user'),
        h('div.grow', h('b', acc ? 'Sign in again to change your skin' : 'Sign in to change your skin'),
          h('div.muted', { style: { fontSize: '12.5px' } }, state.error?.message || 'Skins and capes belong to your Microsoft account.')),
        h('button.btn.sm.primary', { onclick: () => go('accounts') }, 'Accounts')));
    }
  }

  page.append(
    h('div.page-head', h('div', h('h1', 'Skins'), h('p', 'Change your look — it shows in every version and on every server.')), h('div.spacer'),
      h('span.muted', { style: { fontSize: '12px' } }, 'Drop a PNG anywhere here to add it')),
    banner,
    h('div.skins-layout',
      h('div.card.skin-stage', stage, h('div.stage-tools', animSeg, capeSwitch), bar),
      h('div.stack',
        h('div.card.pad', h('div.row-gap', { style: { marginBottom: '12px' } }, h('b', { style: { flex: 1 } }, 'Wardrobe'), pickBtn), grid),
        h('div.card.pad', h('div.row-gap', { style: { marginBottom: '12px' } }, h('b', { style: { flex: 1 } }, 'Capes')), capeGrid),
        h('div.card.pad',
          h('div.row-gap', { style: { marginBottom: '12px' } }, h('b', { style: { flex: 1 } }, 'Find skins'),
            h('span.muted', { style: { fontSize: '12px' } }, 'Players by name, plus the MineSkin gallery')),
          h('div.search', { style: { marginBottom: '12px' } }, icon('search'), searchInput),
          results,
          h('div.row-gap', { style: { justifyContent: 'center', marginTop: '12px' } }, more)))));

  // drag a skin file onto the page
  const onDrag = (e) => { e.preventDefault(); page.classList.add('dropping'); };
  const onLeave = (e) => { if (e.target === page) page.classList.remove('dropping'); };
  const onDrop = async (e) => {
    e.preventDefault();
    page.classList.remove('dropping');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try { await addToWardrobe({ ...(await art.readSkinFile(file)), source: 'file' }); } catch (err) { fail('Could not add that skin', err); }
  };
  page.addEventListener('dragover', onDrag);
  page.addEventListener('dragleave', onLeave);
  page.addEventListener('drop', onDrop);

  offs.push(store.on('game-state', () => { if (viewer) viewer.renderPaused = document.body.classList.contains('game-running'); }));
  offs.push(store.on('accounts', () => { state.error = null; drawBanner(); load(); }));

  async function load() {
    drawBanner();
    drawBar();
    drawCapes();
    state.wardrobe = await api.skins.wardrobe().catch(() => []);
    await drawWardrobe();
    if (!store.activeAccount()) {
      if (state.wardrobe[0]) preview({ ...state.wardrobe[0] });
      return;
    }
    busy.classList.remove('hidden');
    busy.lastChild.textContent = 'Loading your skin…';
    try {
      state.view = await api.skins.state();
      state.error = null;
      state.wardrobe = await api.skins.wardrobe();
      // the game menu can change skins too, so bring the account chip up to date
      if (store.activeAccount()?.skin !== state.view.skin?.url) store.emit('skin-changed', state.view);
    } catch (err) {
      state.error = err;
    } finally {
      busy.classList.add('hidden');
    }
    drawBanner();
    paint();
    drawBar();
    drawWardrobe();
    drawCapes();
  }

  load();
  drawResults();
  requestAnimationFrame(fit);
  return () => {
    offs.forEach((o) => o());
    ro.disconnect();
    if (viewer) viewer.dispose();
  };
}
