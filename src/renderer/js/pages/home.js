import { h, icon, clear, stagger, instanceIcon, fmtAgo, fmtDuration, fmtNumber, LOADER_NAMES, fail } from '../ui.js';
import { api, store } from '../store.js';
import { go, play } from '../router.js';
import { openNewInstance } from '../newInstance.js';
import { openProject } from '../project.js';

function progressOf(t) {
  if (!t || t.checking || !t.total) return null;
  return t.totalBytes ? t.bytes / t.totalBytes : t.done / t.total;
}

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

function instanceCard(inst) {
  const task = store.taskFor(inst.id);
  const p = progressOf(task);
  return h('div.inst-card', { dataset: { id: inst.id }, onclick: () => go('instance', { id: inst.id }) },
    h('div.top', instanceIcon(inst),
      h('div', { style: { minWidth: 0 } },
        h('div.name', inst.name),
        h('div.sub', inst.lastPlayed ? `Played ${fmtAgo(inst.lastPlayed)}` : 'Not played yet'))),
    h('div.meta',
      h('span.tag', inst.mcVersion),
      h('span.tag.accent', LOADER_NAMES[inst.loader] || inst.loader),
      inst.boost ? h('span.tag.good', { icon: 'zap' }, 'Boosted') : null),
    task ? h('div', h('div.sub', { style: { fontSize: '12px', marginBottom: '6px', color: 'var(--muted)' } }, task.stage),
      h('div.bar', h('i', { style: { width: `${(p ?? 0.05) * 100}%` } }))) : null,
    playButton(inst));
}

export function render(page) {
  const heroSlot = h('div');
  const grid = h('div.grid.instances.stagger');
  const discover = h('div.hscroll');
  const countEl = h('span.count');

  page.append(
    heroSlot,
    h('h2.section', 'Your instances', countEl, h('span', { style: { flex: 1 } }),
      h('button.btn.sm.ghost', { icon: 'upload', onclick: importPack }, 'Import .mrpack'),
      h('button.btn.sm', { icon: 'plus', onclick: () => openNewInstance() }, 'New instance')),
    grid,
    h('h2.section', 'Popular modpacks', h('span', { style: { flex: 1 } }), h('button.btn.sm.ghost', { onclick: () => go('browse', { type: 'modpack' }) }, 'See all')),
    discover,
  );

  function drawHero() {
    clear(heroSlot);
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

  function drawGrid() {
    clear(grid);
    for (const inst of store.instances) grid.appendChild(instanceCard(inst));
    grid.appendChild(h('div.inst-card.new', { onclick: () => openNewInstance() }, h('div.plus', icon('plus')), 'New instance'));
    stagger(grid);
    countEl.textContent = store.instances.length ? `· ${store.instances.length}` : '';
  }

  // task progress only touches the card it belongs to, no full re-render
  function onTask(t) {
    if (!t.instanceId) return;
    const card = grid.querySelector(`.inst-card[data-id="${CSS.escape(t.instanceId)}"]`);
    const inst = store.instances.find((i) => i.id === t.instanceId);
    if (card && inst) {
      const fresh = instanceCard(inst);
      fresh.style.animation = 'none';
      card.replaceWith(fresh);
    }
    if (store.instances[0]?.id === t.instanceId && t.state !== 'running') drawHero();
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
    store.on('task', onTask),
    store.on('launching', drawHero),
  ];
  store.refreshInstances().catch(() => {});
  return () => offs.forEach((off) => off());
}
