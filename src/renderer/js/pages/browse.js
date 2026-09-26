import { h, icon, clear, fmtNumber, fmtAgo, debounce, fail, ok, modal, LOADER_NAMES, instanceIcon } from '../ui.js';
import { api, store } from '../store.js';
import { go } from '../router.js';
import { openProject, installInto, installModpack, fits } from '../project.js';

const TYPES = [
  { key: 'mod', label: 'Mods', icon: 'box' },
  { key: 'modpack', label: 'Modpacks', icon: 'package' },
  { key: 'resourcepack', label: 'Resource Packs', icon: 'image' },
  { key: 'shader', label: 'Shaders', icon: 'sparkles' },
];
const SORTS = [['relevance', 'Relevance'], ['downloads', 'Downloads'], ['follows', 'Followers'], ['newest', 'Newest'], ['updated', 'Recently updated']];
const PAGE = 20;

// remembered between visits
const memory = { type: 'mod', sort: 'relevance', query: '' };

export function render(page, params = {}) {
  const state = {
    type: params.type || memory.type,
    sort: memory.sort,
    query: params.query ?? memory.query,
    offset: 0,
    total: 0,
    loading: false,
    token: 0,
    target: store.instances.find((i) => i.id === (params.target || store.target)) || null,
    gameVersion: '',
    loader: '',
    installed: new Set(),
  };

  const tabs = h('div.tabs');
  const ink = h('i.ink');
  const input = h('input.input', { placeholder: 'Search Modrinth…', value: state.query, oninput: debounce(() => { state.query = input.value.trim(); memory.query = state.query; reload(); }, 280) });
  const sortSel = h('select.select', { onchange: () => { state.sort = memory.sort = sortSel.value; reload(); } },
    SORTS.map(([v, l]) => h('option', { value: v, selected: v === state.sort }, l)));
  const targetSel = h('select.select', { title: 'Show what fits this instance', onchange: () => pickTarget(targetSel.value) });
  const versionSel = h('select.select', { onchange: () => { state.gameVersion = versionSel.value; reload(); } });
  const loaderSel = h('select.select', { onchange: () => { state.loader = loaderSel.value; reload(); } },
    h('option', { value: '' }, 'Any loader'), ['fabric', 'quilt', 'forge', 'neoforge'].map((l) => h('option', { value: l }, LOADER_NAMES[l])));
  const banner = h('div');
  const results = h('div.results');
  const sentinel = h('div.sentinel');

  // "bring your own": a file from disk, into the folder that matches the tab you're on
  const FILE_LABELS = { mod: 'Add mod file', modpack: 'Import .mrpack', resourcepack: 'Add resource pack', shader: 'Add shader pack' };
  const fileBtn = h('button.btn.sm', { icon: 'upload', title: 'Add your own file from this computer', onclick: () => addFromFile() }, FILE_LABELS[state.type]);

  page.append(
    h('div.page-head', h('div', h('h1', 'Browse'), h('p', 'Mods, modpacks, resource packs and shaders from Modrinth.')), h('div.spacer'),
      fileBtn,
      h('span.muted', { style: { fontSize: '12px' } }, h('kbd', 'Ctrl'), ' ', h('kbd', 'K'), ' to search')),
    tabs,
    h('div.toolbar', h('div.search', icon('search'), input), targetSel, versionSel, loaderSel, sortSel),
    banner, results, sentinel);

  // ---- tabs with sliding ink
  const tabButtons = TYPES.map((t) => {
    const b = h(`button${t.key === state.type ? '.on' : ''}`, { onclick: () => pickType(t.key) }, icon(t.icon), t.label);
    b.dataset.key = t.key;
    tabs.appendChild(b);
    return b;
  });
  tabs.appendChild(ink);
  const placeInk = () => {
    const on = tabButtons.find((b) => b.dataset.key === state.type);
    ink.style.width = `${on.offsetWidth}px`;
    ink.style.transform = `translateX(${on.offsetLeft}px)`;
  };
  requestAnimationFrame(placeInk);

  async function addFromFile() {
    const type = state.type;
    try {
      if (type === 'modpack') {
        const inst = await api.modrinth.importPack();
        if (inst) { await store.refreshInstances(); ok(`Imported ${inst.name}`, 'Find it in your library.'); }
        return;
      }
      const target = state.target || await chooseInstance(type);
      if (!target) return;
      const res = await api.content.addFiles(target.id, type);
      if (res.added.length) {
        ok(res.added.length === 1 ? `Added ${res.added[0]} to ${target.name}` : `Added ${res.added.length} files to ${target.name}`,
          type === 'mod' ? 'It loads the next time you play.' : 'It switches on by itself the next time you play.');
        if (state.target) await loadInstalled();
      }
      if (res.skipped.length) fail(`Skipped ${res.skipped.map((x) => x.name).join(', ')}`, new Error(res.skipped[0].reason));
    } catch (err) { fail('Could not add that', err); }
  }

  /** Asks which instance a file goes into (when none is picked above). */
  function chooseInstance(type) {
    return new Promise((resolve) => {
      const list = store.instances.filter((i) => type !== 'mod' || i.loader !== 'vanilla');
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const m = modal({
        title: 'Add it to which instance?',
        size: 'narrow',
        body: list.length
          ? h('div.stack', list.map((i) => h('button.pick-row', { onclick: () => { finish(i); m.close(); } },
            instanceIcon(i), h('div', h('b', i.name), h('div.muted', `${i.mcVersion} · ${LOADER_NAMES[i.loader] || i.loader}`)))))
          : h('div.muted', type === 'mod' ? 'You need a Fabric, Quilt, Forge or NeoForge instance for mods.' : 'Make an instance first.'),
        onClose: () => finish(null),
      });
    });
  }

  function pickType(key) {
    state.type = memory.type = key;
    fileBtn.lastChild.textContent = FILE_LABELS[key];
    tabButtons.forEach((b) => b.classList.toggle('on', b.dataset.key === key));
    placeInk();
    drawFilters();
    reload();
  }

  function drawFilters() {
    const isPack = state.type === 'modpack';
    clear(targetSel);
    targetSel.appendChild(h('option', { value: '' }, isPack ? 'Modpacks make new instances' : 'Any instance'));
    if (!isPack) {
      for (const inst of store.instances) {
        targetSel.appendChild(h('option', { value: inst.id, selected: inst.id === state.target?.id }, `For ${inst.name} (${inst.mcVersion} ${LOADER_NAMES[inst.loader]})`));
      }
    }
    targetSel.disabled = isPack;
    const locked = Boolean(state.target && !isPack);
    versionSel.classList.toggle('hidden', locked);
    loaderSel.classList.toggle('hidden', locked || !(state.type === 'mod' || isPack));
    drawBanner();
  }

  function drawBanner() {
    clear(banner);
    if (!state.target || state.type === 'modpack') return;
    const t = state.target;
    const warn = state.type === 'mod' && t.loader === 'vanilla';
    banner.appendChild(h('div.target-banner', instanceIcon(t, 'sm'),
      h('div.grow', h('b', t.name), h('div.muted', { style: { fontSize: '12px' } },
        warn ? 'Vanilla instances cannot run mods — pick a Fabric, Quilt, Forge or NeoForge instance.' : `Showing ${TYPES.find((x) => x.key === state.type).label.toLowerCase()} for Minecraft ${t.mcVersion}${state.type === 'mod' ? ` on ${LOADER_NAMES[t.loader]}` : ''}`)),
      h('button.btn.sm.ghost', { onclick: () => go('instance', { id: t.id, tab: 'content' }) }, 'View installed'),
      h('button.btn.sm.ghost.icon', { icon: 'x', title: 'Show everything', onclick: () => pickTarget('') })));
  }

  async function pickTarget(id) {
    state.target = store.instances.find((i) => i.id === id) || null;
    store.target = state.target?.id || null;
    drawFilters();
    await loadInstalled();
    reload();
  }

  async function loadInstalled() {
    state.installed = new Set();
    if (!state.target) return;
    try {
      const items = await api.content.list(state.target.id);
      for (const i of items) if (i.meta?.projectId) state.installed.add(i.meta.projectId);
    } catch { /* not critical */ }
  }

  function card(hit) {
    const isPack = hit.project_type === 'modpack';
    const installed = state.installed.has(hit.project_id);
    const canInstall = isPack || (state.target && fits(hit, state.target));
    const btn = h(`button.btn.sm${installed ? '' : '.primary'}`, { disabled: installed, title: !canInstall ? 'Choose where to install it' : null },
      icon(installed ? 'check' : 'download'), installed ? 'Installed' : isPack ? 'Install' : 'Add');
    btn.onclick = async (e) => {
      e.stopPropagation();
      // no instance picked (or it does not fit): the project window has the instance picker
      if (!canInstall) { openProject(hit.project_id, { hit, targetId: state.target?.id }); return; }
      btn.disabled = true;
      btn.replaceChildren(h('i.spinner'), isPack ? 'Starting' : 'Adding');
      try {
        if (isPack) {
          await installModpack(hit);
          btn.replaceChildren(icon('check'), 'Installed');
        } else {
          const res = await installInto(hit, state.target);
          state.installed.add(hit.project_id);
          btn.classList.remove('primary');
          btn.replaceChildren(icon('check'), res.installed.length > 1 ? `Added +${res.installed.length - 1}` : 'Installed');
        }
      } catch (err) {
        fail('Install failed', err);
        btn.disabled = false;
        btn.replaceChildren(icon('download'), isPack ? 'Install' : 'Add');
      }
    };
    const ico = hit.icon_url ? h('img.ico', { src: hit.icon_url, alt: '', loading: 'lazy', decoding: 'async' }) : h('div.ico', icon(TYPES.find((t) => t.key === hit.project_type)?.icon || 'box'));
    const cats = (hit.display_categories || hit.categories || []).filter((c) => !['fabric', 'forge', 'quilt', 'neoforge', 'minecraft'].includes(c)).slice(0, 3);
    return h('div.result', { onclick: () => openProject(hit.project_id, { hit, targetId: state.target?.id }) },
      ico,
      h('div', { style: { minWidth: 0 } },
        h('div.title', h('b', hit.title), h('span', `by ${hit.author}`)),
        h('div.desc', hit.description),
        h('div.stats',
          h('span', icon('download'), fmtNumber(hit.downloads)),
          h('span', icon('heart'), fmtNumber(hit.follows)),
          h('span', icon('clock'), fmtAgo(Date.parse(hit.date_modified))),
          cats.map((c) => h('span.tag', c)))),
      h('div.actions', btn));
  }

  async function load() {
    if (state.loading) return;
    if (state.offset > 0 && state.offset >= state.total) return;
    state.loading = true;
    const token = ++state.token;
    const skeletons = state.offset === 0 ? [] : [h('div.skeleton'), h('div.skeleton')];
    if (state.offset === 0) {
      clear(results);
      for (let i = 0; i < 6; i++) skeletons.push(h('div.skeleton'));
    }
    results.append(...skeletons);
    const t = state.type !== 'modpack' ? state.target : null;
    try {
      const res = await api.modrinth.search({
        query: state.query,
        type: state.type,
        sort: state.query ? state.sort : state.sort === 'relevance' ? 'downloads' : state.sort,
        offset: state.offset,
        limit: PAGE,
        gameVersion: t ? t.mcVersion : state.gameVersion,
        loader: t ? t.loader : state.loader,
      });
      if (token !== state.token) return;
      skeletons.forEach((s) => s.remove());
      state.total = res.total_hits;
      const frag = h('div', { style: { display: 'contents' } });
      res.hits.forEach((hit, i) => {
        const c = card(hit);
        c.style.animation = `rise .4s var(--ease) both ${Math.min(i, 12) * 28}ms`;
        frag.appendChild(c);
      });
      results.appendChild(frag);
      state.offset += res.hits.length;
      if (!state.total) {
        results.appendChild(h('div.empty', icon('search'), h('b', 'Nothing found'), t ? 'Try another instance or clear the instance filter.' : 'Try another search.'));
      }
      sentinel.textContent = state.offset >= state.total && state.total ? `That's all ${fmtNumber(state.total)}` : '';
    } catch (err) {
      skeletons.forEach((s) => s.remove());
      if (token === state.token) {
        results.appendChild(h('div.empty', icon('alert'), h('b', 'Modrinth did not answer'), err.message));
      }
    } finally {
      if (token === state.token) state.loading = false;
    }
  }

  function reload() {
    state.offset = 0;
    state.total = 0;
    state.loading = false;
    state.token++;
    page.scrollTop = 0;
    load();
  }

  // infinite scroll
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && state.offset > 0) load();
  }, { root: page, rootMargin: '400px' });
  io.observe(sentinel);

  // game version list for the unfiltered view
  versionSel.appendChild(h('option', { value: '' }, 'Any version'));
  store.loadVersions().then((res) => {
    for (const v of res.versions.filter((x) => x.type === 'release')) versionSel.appendChild(h('option', { value: v.id }, v.id));
  }).catch(() => {});

  drawFilters();
  loadInstalled().then(reload);
  if (params.focus) setTimeout(() => input.focus(), 60);
  const offs = [store.on('instances', drawFilters)];
  window.addEventListener('resize', placeInk);
  return () => { io.disconnect(); offs.forEach((o) => o()); window.removeEventListener('resize', placeInk); };
}

