// Cosmetics: 3D hats, pets, wings and auras. Pick one per slot; it shows on you in game straight
// away, and on every other Nimbus player's screen once it's shared. Commons are free; the rest
// are unlocked with Nimbus coins, earned with daily tasks and achievements in game.
import { h, icon, clear, fail, modal } from '../ui.js';
import { api, store } from '../store.js';
import { COSMETICS, SLOTS, RARITY, CosmeticViewer, thumbnails, byId } from '../cosmetics3d.js';

const ORDER = ['mythic', 'legendary', 'epic', 'rare', 'common'];
const EARN = 'earn';
const thumbs = new Map(); // id -> data URL, kept for the whole session
let lastSlot = 'hat';

const fmtNumber = (n) => Math.floor(n || 0).toLocaleString('en-US');
const coins = (n) => h('span.cz-coins', icon('coin'), h('b', fmtNumber(n)));
const TIME_UNITS = new Set(['play', 'together', 'nether', 'end']);
function amount(stat, n) {
  if (TIME_UNITS.has(stat)) return `${Math.floor(n / 60)}`;
  return fmtNumber(Math.floor(n));
}
function progressText(t) {
  if (t.goal <= 1) return t.progress >= t.goal ? 'Done' : 'Not yet';
  const unit = TIME_UNITS.has(t.stat) ? ' min' : '';
  return `${amount(t.stat, t.progress)} / ${amount(t.stat, t.goal)}${unit}`;
}
function untilText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function render(page) {
  let state = { worn: {}, sync: { state: 'local' }, showOthers: true, wallet: null };
  let slot = lastSlot;
  let filter = 'all';
  let hovering = null;
  const owns = (it) => it.price === 0 || Boolean(state.wallet?.owned?.includes(it.id));

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
  const daily = h('div.cz-daily');
  const balance = h('div.cz-balance');
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
  const earn = h('div.cz-earn');

  page.append(
    h('div.page-head', h('div', h('h1', 'Cosmetics'), h('p', `${COSMETICS.length} hats, pets, wings and auras in 3D. Every Nimbus player sees them on you in Fabric and Quilt games.`)), balance),
    h('div.cz-shell',
      h('div.cz-left', stage, worn, syncNote, daily),
      h('div.cz-right', tabs, filters, grid, earn)),
  );

  function drawTabs() {
    clear(tabs);
    for (const [id, label] of SLOTS) {
      const count = COSMETICS.filter((c) => c.slot === id).length;
      tabs.append(h(`button.cz-tab${slot === id ? '.on' : ''}`, { onclick: () => { slot = id; lastSlot = id; redraw(); } },
        h('b', label), h('span', String(count)), state.worn[id] ? h('i.cz-dot') : null));
    }
    const open = (state.wallet?.tasks || []).filter((t) => !t.done).length;
    tabs.append(h(`button.cz-tab.cz-earn-tab${slot === EARN ? '.on' : ''}`, { onclick: () => { slot = EARN; lastSlot = EARN; redraw(); } },
      icon('trophy'), h('b', 'Earn coins'), open ? h('span', String(open)) : null));
    clear(filters);
    filters.hidden = slot === EARN;
    for (const r of ['all', 'owned', 'locked', ...ORDER]) {
      const label = { all: 'All', owned: 'Unlocked', locked: 'Locked' }[r] || r[0].toUpperCase() + r.slice(1);
      filters.append(h(`button.cz-chip${filter === r ? '.on' : ''}`, { style: RARITY[r] ? { '--rc': RARITY[r] } : {}, onclick: () => { filter = r; redraw(); } }, label));
    }
  }

  function card(item) {
    const on = state.worn[item.slot] === item.id;
    const mine = owns(item);
    // no src until the picture exists: an empty one counts as broken and gets hidden
    const img = h('img.cz-thumb', thumbs.has(item.id) ? { alt: '', src: thumbs.get(item.id) } : { alt: '' });
    img.dataset.id = item.id;
    const el = h(`div.cz-card${on ? '.on' : ''}${mine ? '' : '.locked'}`, { style: { '--rc': RARITY[item.rarity] }, title: item.desc, tabIndex: 0 },
      h('div.cz-thumb-box', img, on ? h('span.cz-check', icon('check')) : null, mine ? null : h('span.cz-lock', icon('lock'))),
      h('div.cz-meta', h('b', item.name), h('div.cz-meta-row', h('span.cz-rarity', item.rarity), mine ? (item.price === 0 ? h('span.cz-free', 'free') : null) : coins(item.price))));
    el.onclick = () => (mine ? wear(item) : unlock(item));
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.onclick(); } };
    el.onmouseenter = () => tryOn(item);
    el.onmouseleave = () => tryOn(null);
    return el;
  }

  function drawGrid() {
    clear(grid);
    grid.hidden = slot === EARN;
    if (slot === EARN) return;
    const items = COSMETICS.filter((c) => c.slot === slot && (filter === 'all' || c.rarity === filter || (filter === 'owned' && owns(c)) || (filter === 'locked' && !owns(c))))
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
    const st = state.sync?.state;
    const shared = st === 'shared';
    const text = {
      shared: 'Everyone on Nimbus sees these on you.',
      'signed-out': 'Only you see these. Sign in with a Microsoft account to show them to other players and earn Nimbus coins.',
      offline: `${state.sync?.error || "Can't reach the Nimbus online service."} Only you see these until it's back. Trying again by itself.`,
      error: `Couldn't share these: ${state.sync?.error || 'unknown error'}. Only you see them for now.`,
    }[st] || 'Connecting to Nimbus…';
    syncNote.append(icon(shared ? 'globe' : 'alert'), h('span', text));
    if (st === 'offline' || st === 'error') {
      const retry = h('button.cz-retry', 'Retry');
      retry.onclick = async () => {
        retry.disabled = true;
        retry.textContent = 'Trying…';
        try { state = await api.cosmetics.refresh(); } catch { /* the note says why */ }
        redraw();
      };
      syncNote.append(retry);
    }
    syncNote.classList.toggle('warn', !shared);

    clear(balance);
    const w = state.wallet;
    if (w) {
      if (w.streak > 1) balance.append(h('span.cz-streak', { title: 'Days in a row. Come back every day for a bigger log-in gift.' }, icon('flame'), h('b', `${w.streak} days`)));
      balance.append(h('button.cz-balance-pill', { title: 'Nimbus coins. Finish daily tasks and achievements in game to earn more.', onclick: () => { slot = EARN; redraw(); } }, coins(w.coins)));
    }
  }

  function taskRow(t, big = false) {
    const pct = Math.min(100, (t.progress / t.goal) * 100);
    return h(`div.cz-task${t.done ? '.done' : ''}${big ? '.big' : ''}`,
      h('span.cz-task-ic', icon(t.done ? 'check' : 'target')),
      h('div.cz-task-main',
        h('div.cz-task-top', h('b', t.title), h('span.cz-task-reward', '+', coins(t.reward))),
        h('div.cz-bar', h('i', { style: { width: `${pct}%` } })),
        h('span.cz-task-num', t.done ? 'Done' : progressText(t))));
  }

  function drawDaily() {
    clear(daily);
    const w = state.wallet;
    if (!w) {
      daily.append(h('div.cz-daily-head', icon('coin'), h('b', 'Nimbus coins')),
        h('p.cz-daily-empty', state.sync?.state === 'signed-out'
          ? 'Sign in with a Microsoft account to get daily tasks and earn coins for new cosmetics.'
          : 'Daily tasks show up here once Nimbus is online.'));
      return;
    }
    daily.append(
      h('div.cz-daily-head', icon('target'), h('b', "Today's tasks"), h('span', `new in ${untilText(w.resetsAt - Date.now())}`)),
      ...w.tasks.map((t) => taskRow(t)),
      h('div.cz-daily-foot', w.bonus?.done ? h('span', icon('check'), 'All done! Bonus paid.') : h('span', 'Finish all three for ', coins(w.bonus?.reward || 50), ' more')));
  }

  function drawEarn() {
    clear(earn);
    earn.hidden = slot !== EARN;
    if (slot !== EARN) return;
    const w = state.wallet;
    if (!w) {
      earn.append(h('div.cz-earn-empty', icon('coin'), h('b', 'Nimbus coins'),
        h('p', 'Play with Nimbus to earn coins: daily tasks, achievements, a log-in streak and just playing. Spend them on the locked cosmetics.'),
        h('p.muted', state.sync?.state === 'signed-out' ? 'Sign in with a Microsoft account to start earning.' : 'Waiting for the Nimbus online service…')));
      return;
    }
    const until = untilText(w.resetsAt - Date.now());
    earn.append(
      h('section.cz-earn-sec',
        h('header', h('h3', icon('target'), "Today's tasks"), h('span.muted', `New tasks in ${until}`)),
        h('p.muted', 'Nimbus Core counts these while you play any Fabric or Quilt version. Coins arrive by themselves.'),
        h('div.cz-earn-tasks', ...w.tasks.map((t) => taskRow(t, true))),
        h('div.cz-earn-extra',
          h('div', icon('sparkles'), h('span', 'All three done'), h('b', w.bonus.done ? 'Paid' : ['+', coins(w.bonus.reward)])),
          h('div', icon('clock'), h('span', `Playing: 1 coin every ${Math.round(w.play.every / 60)} minutes`), h('b', `${w.play.paid} / ${w.play.max} today`)),
          h('div', icon('flame'), h('span', 'Log-in streak: a bigger gift each day in a row'), h('b', `${w.streak || 0} ${w.streak === 1 ? 'day' : 'days'}`)))),
      h('section.cz-earn-sec',
        h('header', h('h3', icon('trophy'), 'Achievements'), h('span.muted', `${w.achievements.filter((a) => a.done).length} / ${w.achievements.length}`)),
        h('div.cz-ach-grid', ...w.achievements.map((a) => {
          const pct = Math.min(100, (a.progress / a.goal) * 100);
          return h(`div.cz-ach${a.done ? '.done' : ''}`,
            h('div.cz-ach-top', h('span.cz-ach-ic', icon(a.done ? 'check' : 'trophy')), h('b', a.title), h('span.cz-task-reward', '+', coins(a.reward))),
            h('span.cz-ach-desc', a.desc),
            h('div.cz-bar', h('i', { style: { width: `${pct}%` } })),
            h('span.cz-task-num', a.done ? 'Unlocked' : progressText(a)));
        }))),
    );
  }

  function redraw() {
    drawTabs();
    drawGrid();
    drawWorn();
    drawDaily();
    drawEarn();
  }

  async function wear(item) {
    const id = item.id && state.worn[item.slot] === item.id ? null : item.id;
    try {
      state = await api.cosmetics.set(item.slot, id);
      viewer?.equip(item.slot, id);
      redraw();
    } catch (err) {
      fail('Could not put that on', err);
    }
  }

  function unlock(item) {
    const w = state.wallet;
    const have = w?.coins ?? 0;
    const short = item.price - have;
    const img = h('img.cz-buy-thumb', thumbs.has(item.id) ? { alt: '', src: thumbs.get(item.id) } : { alt: '' });
    const buyBtn = h('button.btn.primary', { disabled: !w || short > 0 }, icon('lock'), `Unlock for ${fmtNumber(item.price)}`);
    const m = modal({
      title: `Unlock ${item.name}`,
      size: 'narrow',
      body: h('div.cz-buy', { style: { '--rc': RARITY[item.rarity] } },
        h('div.cz-buy-art', img),
        h('div.cz-buy-info',
          h('span.cz-rarity', item.rarity),
          h('p', item.desc),
          h('div.cz-buy-row', h('span', 'Price'), coins(item.price)),
          h('div.cz-buy-row', h('span', 'You have'), coins(have)),
          !w ? h('p.cz-buy-note', state.sync?.state === 'signed-out' ? 'Sign in with a Microsoft account to earn and spend Nimbus coins.' : "The Nimbus online service can't be reached right now.")
            : short > 0 ? h('p.cz-buy-note', `You need ${fmtNumber(short)} more coins. Finish daily tasks and achievements in game to earn them.`) : null)),
      footer: [
        h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'),
        short > 0 && w ? h('button.btn', { onclick: () => { m.close(); slot = EARN; redraw(); } }, icon('target'), 'See tasks') : null,
        buyBtn,
      ],
    });
    buyBtn.onclick = async () => {
      buyBtn.disabled = true;
      try {
        state = await api.cosmetics.buy(item.id);
        m.close();
        viewer?.equip(item.slot, state.worn[item.slot] || null);
        redraw();
      } catch (err) {
        buyBtn.disabled = false;
        fail(`Couldn't unlock ${item.name}`, err);
      }
    };
  }

  // hovering a card tries it on without wearing it (locked ones too)
  function tryOn(item) {
    if (!viewer) return;
    if (hovering) viewer.equip(hovering, state.worn[hovering] || null);
    hovering = item ? item.slot : null;
    if (item) viewer.equip(item.slot, item.id);
  }

  // ------------------------------------------------------------ load
  const stopThumbs = thumbnails(COSMETICS.map((c) => c.id).filter((id) => !thumbs.has(id)), 160, (id, url) => {
    thumbs.set(id, url);
    for (const img of page.querySelectorAll(`img[data-id="${id}"]`)) {
      img.classList.remove('broken');
      img.src = url;
    }
  });

  const offState = api.on('cosmetics:state', (st) => {
    const key = (x) => JSON.stringify([x.worn, x.wallet?.owned, x.wallet?.coins, x.wallet?.tasks, x.sync]);
    const changed = key(st) !== key(state);
    state = st;
    for (const [s] of SLOTS) if (s !== hovering) viewer?.equip(s, state.worn[s] || null);
    if (changed) redraw();
  });
  (async () => {
    try { state = await api.cosmetics.state(); } catch { /* keep defaults */ }
    for (const [s] of SLOTS) viewer?.equip(s, state.worn[s] || null);
    redraw();
    api.cosmetics.refresh().catch(() => {}); // fresh tasks and coins
    try {
      const view = store.activeAccount() ? await api.skins.state() : null;
      if (view?.skin?.texture) viewer?.setSkin(view.skin.texture, view.skin.variant === 'slim');
    } catch { /* the plain skin stays */ }
  })();
  redraw();
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
  const clock = setInterval(() => drawDaily(), 60_000);

  return () => {
    stopThumbs();
    ro.disconnect();
    offState?.();
    offGame?.();
    clearInterval(clock);
    document.removeEventListener('visibilitychange', pause);
    viewer?.dispose();
  };
}
