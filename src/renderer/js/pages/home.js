import { h, icon, clear, stagger, instanceIcon, fmtAgo, fmtDuration, fmtNumber, LOADER_NAMES, fail, liveProgress, taskProgress } from '../ui.js';
import { api, store } from '../store.js';
import { go, play } from '../router.js';
import { openNewInstance } from '../newInstance.js';
import { openProject } from '../project.js';
import { openImport } from '../importDialog.js';

function playButton(inst, { big = false } = {}) {
  const running = store.running.has(inst.id);
  const busy = store.taskFor(inst.id);
  if (big) {
    const btn = h(`button.btn.primary.play${running ? '.stop' : ''}`, { onclick: (e) => { e.stopPropagation(); play(inst.id); } },
      icon(running ? 'stop' : 'play'), running ? 'Stop' : busy ? 'Preparing…' : 'Play');
    if (busy && !running) btn.prepend(h('i.spinner'));
    return btn;
  }
  return h(`button.play-fab${running ? '.running' : ''}`, {
    title: running ? 'Stop' : 'Play',
    onclick: (e) => { e.stopPropagation(); play(inst.id); },
  }, icon(running ? 'stop' : 'play'));
}

/** Shows (or clears) a card's task progress without rebuilding the card. */
function syncCardTask(card, inst) {
  const task = store.taskFor(inst.id);
  const slot = card.querySelector('.task-slot');
  if (task) {
    if (!card.lp) {
      card.lp = liveProgress({ bar: 'bar', striped: false });
      slot.replaceChildren(h('div.task-stage', card.lp.stage), card.lp.bar);
    }
    card.lp.update(task.stage, taskProgress(task));
  } else if (card.lp) {
    card.lp.dispose();
    card.lp = null;
    slot.replaceChildren();
  }
}

/** "3 updates": mods, packs or shaders in this instance that have a newer build on Modrinth. */
function updatesTag(inst) {
  const n = store.modUpdates.get(inst.id)?.length || 0;
  const tag = h('span.tag.upd', { title: 'Newer versions on Modrinth. Click to update.', onclick: (e) => { e.stopPropagation(); go('instance', { id: inst.id, tab: 'content', updates: true }); } }, icon('refresh'), `${n} update${n === 1 ? '' : 's'}`);
  tag.hidden = !n;
  tag.dataset.updates = inst.id;
  return tag;
}

function instanceCard(inst) {
  const card = h('div.inst-card', { dataset: { id: inst.id }, onclick: () => go('instance', { id: inst.id }) },
    h('div.top', instanceIcon(inst),
      h('div', { style: { minWidth: 0 } },
        h('div.name', inst.name),
        h('div.sub', inst.lastPlayed ? `Played ${fmtAgo(inst.lastPlayed)}` : 'Not played yet'))),
    h('div.meta',
      h('span.tag', inst.mcVersion),
      h('span.tag.accent', LOADER_NAMES[inst.loader] || inst.loader),
      inst.boost ? h('span.tag.good', { icon: 'zap' }, 'Boosted') : null,
      updatesTag(inst)),
    h('div.task-slot'),
    playButton(inst));
  syncCardTask(card, inst);
  return card;
}

export function render(page) {
  const heroSlot = h('div');
  const grid = h('div.grid.instances.stagger');
  const discover = h('div.hscroll');
  const countEl = h('span.count');

  page.append(
    heroSlot,
    h('h2.section', 'Your instances', countEl, h('span', { style: { flex: 1 } }),
      h('button.btn.sm.ghost', { icon: 'download', title: 'Bring instances over from CurseForge, Prism, MultiMC, ATLauncher or the Modrinth App', onclick: () => openImport() }, 'Import from other launchers'),
      h('button.btn.sm.ghost', { icon: 'upload', onclick: importPack }, 'Import .mrpack'),
      h('button.btn.sm', { icon: 'plus', onclick: () => openNewInstance() }, 'New instance')),
    grid,
    h('h2.section', 'Popular modpacks', h('span', { style: { flex: 1 } }), h('button.btn.sm.ghost', { onclick: () => go('browse', { type: 'modpack' }) }, 'See all')),
    discover,
  );

  let drawnHero = false;
  function drawHero() {
    clear(heroSlot);
    // only the first draw slides in; later redraws (a launch, a game closing) stay put
    heroSlot.classList.toggle('settled', drawnHero);
    drawnHero = true;
    const inst = store.instances[0];
    if (!inst) {
      heroSlot.appendChild(h('div.hero',
        h('div.cubes', Array.from({ length: 9 }, (_, i) => h('i', { style: { '--i': i } }))),
        h('div.eyebrow', 'Welcome to Nimbus'),
        h('h1', 'Make your first instance'),
        h('div.row', h('p', { style: { margin: 0, color: 'rgba(255,255,255,.75)', maxWidth: '520px' } },
          'Pick any Minecraft version — from 2009 pre-classic to today\'s snapshots — with Fabric, Quilt, Forge or NeoForge.')),
        h('div.row', h('button.btn.primary.play', { icon: 'plus', onclick: () => openNewInstance() }, 'Create instance'),
          h('button.btn', { icon: 'package', onclick: () => go('browse', { type: 'modpack' }) }, 'Browse modpacks'))));
      return;
    }
    const cubes = h('div.cubes', Array.from({ length: 9 }, (_, i) => h('i', { style: { '--i': i } })));
    heroSlot.appendChild(h('div.hero',
      cubes,
      h('div.eyebrow', inst.lastPlayed ? 'Jump back in' : 'Ready when you are'),
      h('div.row', instanceIcon(inst, 'xl'), h('div', h('h1', inst.name),
        h('div.facts', { style: { marginTop: '8px' } },
          h('span.tag', inst.mcVersion), h('span.tag.accent', LOADER_NAMES[inst.loader]),
          h('span.tag', { icon: 'clock' }, fmtDuration(inst.playTime)),
          inst.boost ? h('span.tag.good', { icon: 'zap' }, 'FPS boosted') : null))),
      h('div.row', playButton(inst, { big: true }),
        h('button.btn', { icon: 'sliders', onclick: () => go('instance', { id: inst.id }) }, 'Manage'),
        !inst.boost ? h('button.btn.ghost', { icon: 'zap', onclick: () => go('boost', { id: inst.id }) }, 'Boost FPS') : null)));
  }

  let drawnGrid = false;
  function drawGrid() {
    grid.querySelectorAll('.inst-card').forEach((c) => c.lp?.dispose());
    clear(grid);
    grid.classList.toggle('settled', drawnGrid);
    drawnGrid = true;
    for (const inst of store.instances) grid.appendChild(instanceCard(inst));
    grid.appendChild(h('div.inst-card.new', { onclick: () => openNewInstance() }, h('div.plus', icon('plus')), 'New instance'));
    stagger(grid);
    countEl.textContent = store.instances.length ? `· ${store.instances.length}` : '';
  }

  // task progress only touches the card it belongs to, and never rebuilds it
  function onTask(t) {
    if (!t.instanceId) return;
    const card = grid.querySelector(`.inst-card[data-id="${CSS.escape(t.instanceId)}"]`);
    const inst = store.instances.find((i) => i.id === t.instanceId);
    if (card && inst) syncCardTask(card, inst);
    if (store.instances[0]?.id === t.instanceId && t.state !== 'running') refreshHeroButton();
  }

  /** The big Play button is the only part of the hero that follows launches. */
  function refreshHeroButton() {
    const inst = store.instances[0];
    const btn = heroSlot.querySelector('.hero .btn.play');
    if (inst && btn) btn.replaceWith(playButton(inst, { big: true }));
  }

  async function importPack() {
    try {
      const inst = await api.modrinth.importPack();
      if (inst) await store.refreshInstances();
    } catch (err) { fail('Import failed', err); }
  }

  async function loadDiscover() {
    for (let i = 0; i < 4; i++) discover.appendChild(h('div.skeleton', { style: { height: '86px' } }));
    try {
      const res = await api.modrinth.search({ type: 'modpack', sort: 'downloads', limit: 12 });
      clear(discover);
      for (const hit of res.hits) {
        const img = hit.icon_url ? h('img', { src: hit.icon_url, loading: 'lazy', decoding: 'async', alt: '' }) : h('div.noimg');
        discover.appendChild(h('div.pack-card', { onclick: () => openProject(hit.project_id, { type: 'modpack' }) },
          img, h('div', { style: { minWidth: 0 } }, h('div.t', hit.title), h('div.d', hit.description),
            h('div.muted', { style: { fontSize: '12px', marginTop: '4px', display: 'flex', gap: '5px', alignItems: 'center' } }, icon('download'), fmtNumber(hit.downloads)))));
      }
      stagger(discover);
      discover.classList.add('stagger');
    } catch {
      clear(discover);
      discover.appendChild(h('div.muted', 'Modrinth is not reachable right now.'));
    }
  }

  drawHero();
  drawGrid();
  loadDiscover();
  const offs = [
    store.on('instances', () => { drawHero(); drawGrid(); }),
    store.on('mod-updates', () => {
      for (const inst of store.instances) {
        const tag = grid.querySelector(`[data-updates="${CSS.escape(inst.id)}"]`);
        if (tag) tag.replaceWith(updatesTag(inst));
      }
    }),
    store.on('task', onTask),
    store.on('launching', refreshHeroButton),
  ];
  store.refreshInstances().catch(() => {});
  return () => offs.forEach((off) => off());
}
