import { h, icon, clear, fail, toast, fmtBytes } from './ui.js';
import { api, store } from './store.js';
import { go, registerPages, applyLook } from './router.js';
import * as home from './pages/home.js';
import * as browse from './pages/browse.js';
import * as boost from './pages/boost.js';
import * as accounts from './pages/accounts.js';
import * as settings from './pages/settings.js';
import * as instance from './pages/instance.js';

registerPages({ home, browse, boost, accounts, settings, instance });

const NAV = [
  { page: 'home', icon: 'home', label: 'Home' },
  { page: 'browse', icon: 'compass', label: 'Browse mods & packs' },
  { page: 'boost', icon: 'zap', label: 'FPS Boost' },
  { page: 'settings', icon: 'settings', label: 'Settings' },
];

// ---------------------------------------------------------------- task dock

function taskProgress(t) {
  if (t.state === 'done') return 1;
  if (t.checking || !t.total) return null;
  if (t.totalBytes) return Math.min(1, t.bytes / t.totalBytes);
  return t.done / t.total;
}

function renderTaskPill() {
  const pill = document.querySelector('.task-pill');
  const active = [...store.tasks.values()].filter((t) => t.state === 'running');
  pill.classList.toggle('show', store.tasks.size > 0);
  const ring = pill.querySelector('.ring circle.v');
  const label = pill.querySelector('.lbl');
  if (!active.length) {
    const failed = [...store.tasks.values()].some((t) => t.state === 'error');
    label.textContent = failed ? 'A task failed' : 'All done';
    ring.style.strokeDashoffset = failed ? 44 : 0;
    return;
  }
  const t = active[active.length - 1];
  const p = taskProgress(t);
  label.textContent = active.length > 1 ? `${active.length} tasks running` : t.label;
  ring.style.strokeDashoffset = p == null ? 33 : 44 - 44 * p;
  ring.parentElement.style.animation = p == null ? 'spin 1s linear infinite' : '';
}

function openDock() {
  if (document.querySelector('.dock')) { document.querySelector('.dock').remove(); return; }
  const dock = h('div.dock');
  const draw = () => {
    clear(dock);
    if (!store.tasks.size) { dock.appendChild(h('div.none', 'Nothing running right now.')); return; }
    for (const t of store.tasks.values()) {
      const p = taskProgress(t);
      const detail = t.state === 'error' ? t.error
        : t.state === 'done' ? 'Done'
          : t.totalBytes ? `${fmtBytes(t.bytes)} / ${fmtBytes(t.totalBytes)}`
            : t.total ? `${t.done} / ${t.total}` : '';
      dock.appendChild(h(`div.task${t.state === 'error' ? '.error' : ''}`,
        h('div.row', h('b', t.label), h('span', detail)),
        h('div.muted', { style: { fontSize: '12px', marginBottom: '7px' } }, t.stage),
        h(`div.pbar${p == null && t.state === 'running' ? '.indeterminate' : ''}`, h(`i${t.state === 'running' ? '.striped' : ''}`, { style: { width: `${(p ?? 0) * 100}%` } }))));
    }
  };
  draw();
  const off = store.on('tasks', draw);
  document.body.appendChild(dock);
  const away = (e) => {
    if (dock.contains(e.target) || e.target.closest('.task-pill')) return;
    dock.remove();
    off();
    document.removeEventListener('mousedown', away);
  };
  setTimeout(() => document.addEventListener('mousedown', away));
}

// ---------------------------------------------------------------- shell

function renderAccountChip() {
  const chip = document.querySelector('.account-chip');
  const acc = store.activeAccount();
  clear(chip);
  if (acc) {
    const img = h('img', { src: `https://mc-heads.net/avatar/${acc.uuid}/64`, alt: acc.name });
    img.onerror = () => img.replaceWith(h('div.ph', icon('user')));
    chip.append(img, h(`i.dot${acc.needsLogin ? '.off' : ''}`));
    chip.title = acc.name;
  } else {
    chip.append(h('div.ph', icon('user')), h('i.dot.off'));
    chip.title = 'Sign in';
  }
}


function buildShell() {
  const app = document.getElementById('app');
  if (api.platform === 'darwin') document.body.classList.add('mac');

  const ringSvg = '<svg class="ring" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="2.4"/><circle class="v" cx="9" cy="9" r="7" fill="none" stroke="url(#g-accent)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="44" stroke-dashoffset="44" transform="rotate(-90 9 9)" style="transition:stroke-dashoffset .3s"/></svg>';
  const pill = h('button.task-pill.no-drag', { onclick: openDock, title: 'Downloads and tasks' });
  pill.innerHTML = ringSvg;
  pill.appendChild(h('span.lbl', ''));

  app.append(
    h('header.titlebar',
      h('div.brand', h('span.mark', icon('logo')), 'Nimbus', h('small', 'Launcher')),
      h('div.spacer'),
      pill,
      h('div.winbtns',
        h('button', { icon: 'min', title: 'Minimize', onclick: () => api.app.minimize() }),
        h('button', { icon: 'max', title: 'Maximize', onclick: () => api.app.maximize() }),
        h('button.close', { icon: 'x', title: 'Close', onclick: () => api.app.close() }))),
    h('nav.sidebar',
      h('i.nav-pill'),
      NAV.map((n) => h('button.nav-item', { dataset: { page: n.page }, onclick: () => go(n.page) }, icon(n.icon), h('span.tip', n.label))),
      h('div.grow'),
      h('button.account-chip', { onclick: () => go('accounts') })),
    h('main#view'),
  );
  // one shared gradient for every SVG that wants the accent (gauge, rings)
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.style.position = 'absolute';
  defs.innerHTML = '<defs><linearGradient id="g-accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--a1)"/><stop offset="1" stop-color="var(--a2)"/></linearGradient></defs>';
  document.body.appendChild(defs);
}

async function boot() {
  buildShell();
  store.settings = await api.settings.get();
  applyLook(store.settings);
  await Promise.all([store.refreshInstances(), store.refreshAccounts()]);
  renderAccountChip();
  store.on('accounts', renderAccountChip);
  store.on('tasks', renderTaskPill);
  for (const t of await api.tasks.list()) store.tasks.set(t.id, t);
  renderTaskPill();

  store.on('task', (t) => {
    if (t.state === 'error' && !t.label.startsWith('Launching')) fail(`${t.label} failed`, t.error);
  });
  store.on('game-state', (e) => {
    if (e.running || e.killed || e.code === 0 || e.code == null) return;
    const inst = store.instances.find((i) => i.id === e.instanceId);
    toast('err', `${inst?.name || 'Minecraft'} crashed`, `Exit code ${e.code}. The console tab has the log.`, {
      timeout: 0,
      actions: [
        ...(e.crash ? [{ label: 'Crash report', run: () => api.game.openCrash(e.crash) }] : []),
        { label: 'Open console', run: () => go('instance', { id: e.instanceId, tab: 'console' }) },
      ],
    });
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); go('browse', { focus: true }); }
  });
  document.addEventListener('error', (e) => {
    if (e.target instanceof HTMLImageElement) e.target.classList.add('broken');
  }, true);
  // external links anywhere in the app open in the browser
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (/^https:\/\//.test(href)) api.app.external(href);
  });
  go('home');
}

boot().catch((err) => {
  console.error(err);
  document.body.appendChild(h('div.empty', h('b', 'Nimbus could not start'), err.message));
});
