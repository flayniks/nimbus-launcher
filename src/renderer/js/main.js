import { h, icon, clear, fail, toast, fmtBytes, liveProgress, taskProgress } from './ui.js';
import { api, store } from './store.js';
import { go, registerPages, applyLook } from './router.js';
import * as home from './pages/home.js';
import * as browse from './pages/browse.js';
import * as boost from './pages/boost.js';
import * as accounts from './pages/accounts.js';
import * as settings from './pages/settings.js';
import * as instance from './pages/instance.js';
import * as skins from './pages/skins.js';
import { head as skinHead } from './skinart.js';
import { presencePill } from './look.js';

registerPages({ home, browse, boost, accounts, settings, instance, skins });

const NAV = [
  { page: 'home', icon: 'home', label: 'Home' },
  { page: 'browse', icon: 'compass', label: 'Browse mods & packs' },
  { page: 'boost', icon: 'zap', label: 'FPS Boost' },
  { page: 'skins', icon: 'shirt', label: 'Skins & capes' },
  { page: 'settings', icon: 'settings', label: 'Settings' },
];

// ---------------------------------------------------------------- task dock

function renderTaskPill() {
  const pill = document.querySelector('.task-pill');
  const active = [...store.tasks.values()].filter((t) => t.state === 'running');
  pill.classList.toggle('show', store.tasks.size > 0);
  const ring = pill.querySelector('.ring circle.v');
  const label = pill.querySelector('.lbl');
  if (!active.length) {
    clearTimeout(pillSpin.timer);
    Object.assign(pillSpin, { timer: null, on: false, seen: false });
    ring.parentElement.style.animation = '';
    const failed = [...store.tasks.values()].some((t) => t.state === 'error');
    label.textContent = failed ? 'A task failed' : 'All done';
    ring.style.strokeDashoffset = failed ? 44 : 0;
    return;
  }
  const t = active[active.length - 1];
  const p = taskProgress(t);
  const text = active.length > 1 ? `${active.length} tasks running` : t.label;
  if (label.textContent !== text) label.textContent = text;
  // like the bars: only start spinning if the number stays away for a moment
  if (p == null) {
    if (!pillSpin.timer && !pillSpin.on) {
      pillSpin.timer = setTimeout(() => {
        pillSpin.timer = null;
        pillSpin.on = true;
        ring.style.strokeDashoffset = 33;
        ring.parentElement.style.animation = 'spin 1s linear infinite';
      }, pillSpin.seen ? 450 : 0);
    }
    return;
  }
  clearTimeout(pillSpin.timer);
  pillSpin.timer = null;
  pillSpin.on = false;
  pillSpin.seen = true;
  ring.style.strokeDashoffset = 44 - 44 * p;
  ring.parentElement.style.animation = '';
}
const pillSpin = { timer: null, on: false, seen: false };

function openDock() {
  if (document.querySelector('.dock')) { document.querySelector('.dock').remove(); return; }
  const dock = h('div.dock');
  // one row per task, kept and updated in place so the bars run smoothly
  const rows = new Map();
  const none = h('div.none', 'Nothing running right now.');
  const draw = () => {
    for (const [id, row] of rows) {
      if (store.tasks.has(id)) continue;
      row.live.dispose();
      row.el.remove();
      rows.delete(id);
    }
    if (!store.tasks.size) { if (!none.isConnected) dock.appendChild(none); return; }
    none.remove();
    for (const t of store.tasks.values()) {
      let row = rows.get(t.id);
      if (!row) {
        const live = liveProgress();
        const el = h('div.task', h('div.row', h('b', t.label), live.detail), h('div.muted', { style: { fontSize: '12px', marginBottom: '7px' } }, live.stage), live.bar);
        row = { el, live };
        rows.set(t.id, row);
        dock.appendChild(el);
      }
      const detail = t.state === 'error' ? t.error
        : t.state === 'done' ? 'Done'
          : t.checking ? ''
            : t.totalBytes ? `${fmtBytes(t.bytes)} / ${fmtBytes(t.totalBytes)}`
              : t.total ? `${t.done} / ${t.total}` : '';
      row.el.classList.toggle('error', t.state === 'error');
      row.live.update(t.stage, taskProgress(t), detail);
      row.live.bar.firstChild.classList.toggle('striped', t.state === 'running');
    }
  };
  draw();
  const off = store.on('tasks', draw);
  document.body.appendChild(dock);
  const away = (e) => {
    if (dock.contains(e.target) || e.target.closest('.task-pill')) return;
    dock.remove();
    off();
    rows.forEach((r) => r.live.dispose());
    document.removeEventListener('mousedown', away);
  };
  setTimeout(() => document.addEventListener('mousedown', away));
}

// ---------------------------------------------------------------- updates

export async function installUpdate() {
  if (store.update.state !== 'ready') return;
  try {
    await api.updates.install();
  } catch (err) {
    fail('Update will install later', err);
  }
}

// A downloaded update restarts the launcher by itself, after a short countdown, as soon as
// nothing would be interrupted: no game running and no downloads going.
const autoUpdate = { announced: null, closeAnnounce: null, later: false, countdown: null, waitingShown: false };

function busyWith() {
  if (store.running.size > 0) return 'game';
  if ([...store.tasks.values()].some((t) => t.state === 'running')) return 'tasks';
  return null;
}

function maybeRestartForUpdate() {
  const u = store.update;
  if (u.state !== 'ready' || autoUpdate.later || autoUpdate.countdown) return;
  const busy = busyWith();
  if (busy) {
    if (!autoUpdate.waitingShown) {
      autoUpdate.waitingShown = true;
      toast('info', `Nimbus ${u.version} is ready`, busy === 'game'
        ? 'It installs as soon as you close Minecraft.'
        : 'It installs as soon as your downloads finish.', { timeout: 7000 });
    }
    return;
  }
  let left = 5;
  const text = h('span', `Restarting to update in ${left}s…`);
  const tick = setInterval(() => {
    left -= 1;
    if (busyWith()) { stop(); maybeRestartForUpdate(); return; }
    if (left <= 0) { stop(); installUpdate(); return; }
    text.textContent = `Restarting to update in ${left}s…`;
  }, 1000);
  const close = toast('info', `Updating to Nimbus ${u.version}`, text, {
    timeout: 0,
    actions: [
      { label: 'Restart now', run: () => { stop(); installUpdate(); } },
      { label: 'Later', run: () => { stop(); autoUpdate.later = true; toast('info', 'Update saved for later', 'It installs next time you close Nimbus, or from Settings.'); } },
    ],
  });
  function stop() {
    clearInterval(tick);
    autoUpdate.countdown = null;
    close();
  }
  autoUpdate.countdown = { stop };
}

function onUpdateState(u) {
  renderUpdatePill();
  if (u.state === 'downloading' && u.version && autoUpdate.announced !== u.version) {
    autoUpdate.announced = u.version;
    autoUpdate.closeAnnounce = toast('info', `Nimbus ${u.version} is out`, 'Downloading it now — the launcher restarts into it when it is done.', { timeout: 6000 });
  }
  if (u.state === 'ready') {
    autoUpdate.closeAnnounce?.();
    autoUpdate.closeAnnounce = null;
    maybeRestartForUpdate();
  }
}

/** Says so once after the launcher restarts into a new version. */
function announceNewVersion() {
  try {
    const now = store.update.current;
    const before = localStorage.getItem('nimbus.lastVersion');
    if (now && before && before !== now) toast('ok', `Updated to Nimbus ${now}`, 'You are on the newest version.', { timeout: 6000 });
    if (now) localStorage.setItem('nimbus.lastVersion', now);
  } catch { /* storage unavailable */ }
}

function renderUpdatePill() {
  const el = document.querySelector('.update-pill');
  const u = store.update;
  const show = u.state === 'ready' || u.state === 'downloading';
  el.classList.toggle('show', show);
  el.classList.toggle('ready', u.state === 'ready');
  el.replaceChildren(icon(u.state === 'ready' ? 'refresh' : 'download'),
    u.state === 'ready' ? `Update ${u.version} ready · Restart` : `Downloading update ${Math.round(u.percent || 0)}%`);
  el.title = u.state === 'ready' ? 'Restart Nimbus to finish updating' : 'A new version is downloading in the background';
}

// ---------------------------------------------------------------- shell

function renderAccountChip() {
  const chip = document.querySelector('.account-chip');
  const acc = store.activeAccount();
  clear(chip);
  if (acc) {
    const img = h('img', { src: `https://mc-heads.net/avatar/${acc.uuid}/64`, alt: acc.name });
    img.onerror = () => img.replaceWith(h('div.ph', icon('user')));
    // draw the head from the real skin when we have it; the avatar service can lag behind a change
    if (acc.skin) api.skins.texture(acc.skin).then((t) => skinHead(t, 64)).then((src) => { img.src = src; }).catch(() => {});
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
  const presence = presencePill();
  store.presence = presence;
  const pill = h('button.task-pill.no-drag', { onclick: openDock, title: 'Downloads and tasks' });
  pill.innerHTML = ringSvg;
  pill.appendChild(h('span.lbl', ''));

  app.append(
    h('header.titlebar',
      h('div.brand', h('img.mark', { src: 'img/logo.svg', alt: '', draggable: false }), 'Nimbus', h('small', 'Launcher')),
      h('div.center', presence),
      h('div.spacer'),
      h('button.update-pill.no-drag', { onclick: installUpdate }),
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
  store.on('skin-changed', () => store.refreshAccounts().catch(() => {}));
  // a file dropped outside a drop zone must not make the window navigate to it
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  store.on('tasks', renderTaskPill);
  store.update = await api.updates.state().catch(() => ({ state: 'idle' }));
  renderUpdatePill();
  announceNewVersion();
  store.on('update', onUpdateState);
  // a finished game or download may be all a ready update was waiting for
  store.on('game-state', () => setTimeout(maybeRestartForUpdate, 1500));
  store.on('tasks', () => { if (!busyWith()) maybeRestartForUpdate(); });
  if (store.update.state === 'ready') maybeRestartForUpdate();
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
