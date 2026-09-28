// Gallery: every screenshot from every instance in one place, and the replay clips Nimbus saved.
// Click one to see it big; send it to a friend, copy it, use it as the launcher background,
// find it or bin it.
import { h, icon, clear, fail, ok, modal, confirmDialog, fmtBytes, fmtAgo } from '../ui.js';
import { api } from '../store.js';
import { sendToFriend } from '../share.js';

let lastTab = 'shots';

export function render(page, params = {}) {
  let tab = params.tab || lastTab;
  let data = { screenshots: [], clips: [] };
  let only = 'all';
  const tabs = h('div.gl-tabs');
  const filters = h('div.gl-filters');
  const grid = h('div.gl-grid');

  page.append(
    h('div.page-head',
      h('div', h('h1', 'Gallery'), h('p', 'Screenshots from all your instances (F2 in game) and your replay clips.')),
      h('div.spacer'),
      h('button.btn', { icon: 'folder', onclick: () => api.gallery.openFolder(tab === 'clips' ? 'clips' : 'shots').catch((e) => fail('Could not open the folder', e)) }, 'Folder'),
      h('button.btn', { icon: 'refresh', onclick: () => load() }, 'Refresh')),
    tabs, filters, grid);

  function drawTabs() {
    clear(tabs);
    for (const [id, label, ic, n] of [['shots', 'Screenshots', 'image', data.screenshots.length], ['clips', 'Clips', 'play', data.clips.length]]) {
      tabs.append(h(`button.gl-tab${tab === id ? '.on' : ''}`, { onclick: () => { tab = id; lastTab = id; only = 'all'; draw(); } }, icon(ic), h('b', label), h('span', String(n))));
    }
    clear(filters);
    const list = tab === 'shots' ? data.screenshots : data.clips;
    const names = [...new Set(list.map((x) => x.instance).filter(Boolean))];
    if (names.length > 1) {
      for (const n of ['all', ...names]) filters.append(h(`button.cz-chip${only === n ? '.on' : ''}`, { onclick: () => { only = n; draw(); } }, n === 'all' ? 'All instances' : n));
    }
  }

  const shown = () => (tab === 'shots' ? data.screenshots : data.clips).filter((x) => only === 'all' || x.instance === only);

  function draw() {
    drawTabs();
    clear(grid);
    const list = shown();
    grid.classList.toggle('clips', tab === 'clips');
    if (!list.length) {
      grid.append(tab === 'shots'
        ? h('div.empty.gl-empty', icon('image'), h('b', 'No screenshots yet'), 'Press F2 in game to take one. They all show up here.')
        : h('div.empty.gl-empty', icon('play'), h('b', 'No clips yet'), 'Turn on Replay clips in Settings, then press F8 in game to save the last 30 seconds.'));
      return;
    }
    list.forEach((item, i) => {
      const img = tab === 'shots'
        ? h('img', { src: item.thumb, alt: '', loading: 'lazy', decoding: 'async' })
        : h('img', { src: item.poster, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => { e.target.replaceWith(h('div.gl-noposter', icon('play'))); } });
      const tile = h('button.gl-tile', { style: { animationDelay: `${Math.min(i, 24) * 18}ms` }, onclick: () => open(i) },
        img,
        tab === 'clips' ? h('span.gl-play', icon('play')) : null,
        h('span.gl-cap', h('b', tab === 'clips' ? item.label : item.instance || ''), h('i', fmtAgo(item.time))));
      grid.append(tile);
    });
  }

  function open(index) {
    const list = shown();
    let i = index;
    const stage = h('div.gl-stage');
    const meta = h('div.gl-meta');
    const actions = h('div.gl-actions');
    const m = modal({ title: '', size: 'wide', body: h('div.gl-view', stage, meta, actions), onClose: () => document.removeEventListener('keydown', onKey) });
    m.el.classList.add('gl-modal');
    const show = () => {
      const item = list[i];
      clear(stage);
      clear(meta);
      clear(actions);
      if (tab === 'shots') stage.append(h('img', { src: item.url, alt: '' }));
      else stage.append(h('video', { src: item.url, controls: true, autoplay: true, playsInline: true, poster: item.poster }));
      if (list.length > 1) {
        stage.append(h('button.gl-nav.prev', { icon: 'back', title: 'Previous (←)', onclick: () => { i = (i - 1 + list.length) % list.length; show(); } }));
        stage.append(h('button.gl-nav.next', { icon: 'back', title: 'Next (→)', onclick: () => { i = (i + 1) % list.length; show(); } }));
      }
      meta.append(h('b', tab === 'clips' ? item.label : item.name), h('span', [item.instance, new Date(item.time).toLocaleString(), fmtBytes(item.size)].filter(Boolean).join(' · ')), h('span.gl-count', `${i + 1} / ${list.length}`));
      const act = (label, ic, run, cls = '') => h(`button.btn.sm${cls}`, { icon: ic, onclick: run }, label);
      if (tab === 'shots') {
        actions.append(
          act('Send to a friend', 'send', () => sendToFriend(item), '.primary'),
          act('Copy', 'copy', () => api.gallery.copy(item.path).then(() => ok('Copied', 'Paste it anywhere, like a Discord chat.')).catch((e) => fail('Could not copy', e))),
          act('Use as background', 'image', () => api.gallery.background(item.path).then(() => ok('New launcher background', 'Change it any time in Settings.')).catch((e) => fail('Could not use that', e))));
      }
      actions.append(
        act('Show in folder', 'folder', () => api.gallery.reveal(item.path).catch((e) => fail('Could not show it', e))),
        h('div', { style: { flex: 1 } }),
        act('Delete', 'trash', async () => {
          if (!(await confirmDialog({ title: `Delete this ${tab === 'shots' ? 'screenshot' : 'clip'}?`, message: 'It goes to the recycle bin.', confirm: 'Delete', danger: true }))) return;
          try {
            await api.gallery.remove(item.path);
            m.close();
            await load();
          } catch (e) { fail('Could not delete it', e); }
        }, '.danger'));
    };
    const onKey = (e) => {
      if (list.length < 2) return;
      if (e.key === 'ArrowLeft') { i = (i - 1 + list.length) % list.length; show(); }
      if (e.key === 'ArrowRight') { i = (i + 1) % list.length; show(); }
    };
    document.addEventListener('keydown', onKey);
    show();
  }

  async function load() {
    try {
      data = await api.gallery.list();
    } catch (err) {
      fail('Could not read the gallery', err);
    }
    draw();
  }

  draw();
  load();
}
