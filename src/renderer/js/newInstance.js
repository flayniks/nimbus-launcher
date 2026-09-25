import { h, icon, clear, modal, fail, ok, debounce, LOADER_NAMES } from './ui.js';
import { api, store } from './store.js';
import { go } from './router.js';

const TYPES = [
  { key: 'release', label: 'Releases' },
  { key: 'snapshot', label: 'Snapshots' },
  { key: 'old_beta', label: 'Beta' },
  { key: 'old_alpha', label: 'Alpha' },
];
const TYPE_TAG = { release: 'Release', snapshot: 'Snapshot', old_beta: 'Beta', old_alpha: 'Alpha' };
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];
const supportCache = new Map();

function supported(kind) {
  if (kind === 'vanilla') return Promise.resolve(null);
  if (!supportCache.has(kind)) {
    supportCache.set(kind, api.loaders.games(kind).then((list) => new Set(list)).catch((err) => { supportCache.delete(kind); throw err; }));
  }
  return supportCache.get(kind);
}

export function openNewInstance(preset = {}) {
  const state = {
    loader: preset.loader || 'vanilla',
    mc: preset.mcVersion || null,
    loaderVersion: null,
    types: new Set(['release']),
    query: '',
    nameTouched: false,
    versions: [],
    support: null,
  };

  const nameInput = h('input.input', { placeholder: 'My world', maxlength: 60, oninput: () => { state.nameTouched = true; summary(); } });
  const loaderGrid = h('div.loader-grid');
  const chips = h('div.row-gap');
  const search = h('input.input', { placeholder: 'Search versions (e.g. 1.20.1, b1.7.3, 24w14a)', oninput: debounce(() => { state.query = search.value.trim().toLowerCase(); drawList(); }, 80) });
  const list = h('div.vlist');
  const loaderSelect = h('select.select', { onchange: () => { state.loaderVersion = loaderSelect.value; summary(); } });
  const loaderRow = h('label.field', h('span', 'Loader version'), loaderSelect);
  const forgeNote = h('div.note', icon('heart'), h('span', 'Forge is kept alive by the ads on its download site. If it powers your game, consider supporting it at ', h('a', { href: 'https://www.patreon.com/LexManos' }, 'patreon.com/LexManos'), '.'));
  const summaryEl = h('span');
  const createBtn = h('button.btn.primary', { icon: 'plus', disabled: true, onclick: create }, 'Create');

  const m = modal({
    title: 'New instance',
    size: 'wide',
    body: h('div.stack',
      h('label.field', h('span', 'Name'), nameInput),
      h('div.field', h('label.field', h('span', 'Mod loader')), loaderGrid),
      h('div.stack', { style: { gap: '10px' } }, h('div.form-row', search, chips), list),
      loaderRow,
      forgeNote),
    footer: [h('div.left', summaryEl), h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), createBtn],
  });

  function drawLoaders() {
    clear(loaderGrid);
    for (const id of LOADERS) {
      loaderGrid.appendChild(h(`button.loader-opt${state.loader === id ? '.on' : ''}`, { type: 'button', onclick: () => pickLoader(id) }, icon(id), LOADER_NAMES[id]));
    }
  }

  function drawChips() {
    clear(chips);
    for (const t of TYPES) {
      const disabled = state.loader !== 'vanilla' && (t.key === 'old_beta' || t.key === 'old_alpha');
      chips.appendChild(h(`button.chip${state.types.has(t.key) && !disabled ? '.on' : ''}`, {
        type: 'button',
        disabled,
        style: disabled ? { opacity: 0.35, cursor: 'not-allowed' } : null,
        title: disabled ? 'Mod loaders do not support versions this old' : null,
        onclick: () => {
          if (state.types.has(t.key)) state.types.delete(t.key); else state.types.add(t.key);
          if (!state.types.size) state.types.add('release');
          drawChips();
          drawList();
        },
      }, t.label));
    }
  }

  function visibleVersions() {
    const base = state.versions.filter((v) => (!state.support || state.support.has(v.id)) && (!state.query || v.id.toLowerCase().includes(state.query)));
    const typed = base.filter((v) => state.types.has(v.type));
    // typing "b1.7.3" with only Releases ticked should still find it
    return typed.length || !state.query ? typed : base;
  }

  function drawList() {
    clear(list);
    const items = visibleVersions();
    if (!items.length) {
      list.appendChild(h('div.empty', { style: { padding: '40px' } }, state.versions.length ? 'No versions match.' : 'Loading versions…'));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const v of items) {
      const row = h(`div.vrow${v.id === state.mc ? '.on' : ''}`, { dataset: { id: v.id }, onclick: () => pickVersion(v.id) },
        h('b', v.id),
        v.type !== 'release' ? h(`span.tag${v.type === 'snapshot' ? '' : '.warn'}`, TYPE_TAG[v.type]) : null,
        h('span', new Date(v.releaseTime).toLocaleDateString()));
      frag.appendChild(row);
    }
    list.appendChild(frag);
    list.querySelector('.vrow.on')?.scrollIntoView({ block: 'nearest' });
  }

  async function pickLoader(id) {
    state.loader = id;
    drawLoaders();
    drawChips();
    forgeNote.classList.toggle('hidden', id !== 'forge');
    loaderRow.classList.toggle('hidden', id === 'vanilla');
    state.support = null;
    try {
      state.support = await supported(id);
    } catch (err) {
      fail(`Could not reach ${LOADER_NAMES[id]}`, err);
    }
    if (state.loader !== id) return;
    if (state.support && state.mc && !state.support.has(state.mc)) state.mc = null;
    drawList();
    if (state.mc) loadLoaderVersions();
    summary();
  }

  function pickVersion(id) {
    state.mc = id;
    for (const row of list.querySelectorAll('.vrow')) row.classList.toggle('on', row.dataset.id === id);
    loadLoaderVersions();
    summary();
  }

  async function loadLoaderVersions() {
    clear(loaderSelect);
    state.loaderVersion = null;
    if (state.loader === 'vanilla' || !state.mc) return summary();
    const want = `${state.loader}:${state.mc}`;
    loaderSelect.appendChild(h('option', 'Loading…'));
    loaderSelect.disabled = true;
    try {
      const versions = await api.loaders.versions(state.loader, state.mc);
      if (`${state.loader}:${state.mc}` !== want) return;
      clear(loaderSelect);
      const def = versions.find((v) => v.recommended) || versions.find((v) => v.stable) || versions[0];
      for (const v of versions.slice(0, 200)) {
        const label = `${v.version}${v.recommended ? '  ★ recommended' : v.latest ? '  · latest' : ''}${!v.stable ? '  (beta)' : ''}`;
        loaderSelect.appendChild(h('option', { value: v.version, selected: v === def }, label));
      }
      state.loaderVersion = def?.version || null;
      if (!versions.length) loaderSelect.appendChild(h('option', { value: '' }, `No ${LOADER_NAMES[state.loader]} build for ${state.mc}`));
    } catch (err) {
      clear(loaderSelect);
      loaderSelect.appendChild(h('option', { value: '' }, 'Could not load versions'));
      fail('Loader versions', err);
    } finally {
      loaderSelect.disabled = false;
      summary();
    }
  }

  function summary() {
    const loaderName = LOADER_NAMES[state.loader];
    if (!state.nameTouched) {
      nameInput.value = state.mc ? `${state.loader === 'vanilla' ? 'Minecraft' : loaderName} ${state.mc}` : '';
    }
    summaryEl.textContent = state.mc
      ? `Minecraft ${state.mc}${state.loader !== 'vanilla' ? ` · ${loaderName} ${state.loaderVersion || '…'}` : ''}`
      : 'Pick a version';
    createBtn.disabled = !state.mc || (state.loader !== 'vanilla' && !state.loaderVersion);
  }

  async function create() {
    createBtn.disabled = true;
    try {
      const inst = await api.instances.create({ name: nameInput.value, mcVersion: state.mc, loader: state.loader, loaderVersion: state.loaderVersion });
      m.close();
      await store.refreshInstances();
      ok('Instance created', 'Downloading the game in the background — you can keep browsing.');
      go('instance', { id: inst.id });
    } catch (err) {
      fail('Could not create the instance', err);
      createBtn.disabled = false;
    }
  }

  drawLoaders();
  drawChips();
  forgeNote.classList.add('hidden');
  loaderRow.classList.add('hidden');
  drawList();
  summary();
  store.loadVersions().then((res) => {
    state.versions = res.versions;
    if (!state.mc && state.loader === 'vanilla') state.mc = res.latest.release;
    drawList();
    summary();
  }).catch((err) => fail('Could not load Minecraft versions', err));
  if (state.loader !== 'vanilla') pickLoader(state.loader);
  setTimeout(() => search.focus(), 50);
}
