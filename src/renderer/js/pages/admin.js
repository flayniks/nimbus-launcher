// Admin: everyone who uses Nimbus, live, and bans. Only shown to Nimbus admins; the service
// checks every call on its own, so this page is just the way in.
import { h, icon, clear, fail, ok, modal, segmented, fmtAgo } from '../ui.js';
import { api, store } from '../store.js';

const head = (uuid, size = 36) => h('img.fr-head', { src: `https://mc-heads.net/avatar/${uuid}/${size}`, alt: '', loading: 'lazy', width: size, height: size });
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const LOADERS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const DURATIONS = [{ value: 1, label: '1 day' }, { value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 0, label: 'Forever' }];

function statusText(u) {
  if (u.hosting) return `Hosting ${u.hosting.world ? `“${u.hosting.world}”` : 'a world'} · ${u.hosting.mc}`;
  if (u.online && u.playing) return `Playing ${u.playing.mc} ${LOADERS[u.playing.loader] || ''}`.trim();
  if (u.online) return 'Online';
  return u.seen ? `Seen ${fmtAgo(u.seen)}` : 'Never signed in';
}

function banText(b) {
  return `${b.until ? `until ${new Date(b.until).toLocaleString()}` : 'forever'}${b.reason ? ` · ${b.reason}` : ''}${b.by ? ` · by ${b.by}` : ''}`;
}

export function render(page) {
  let data = null;
  let filter = 'all';
  const stats = h('div.ad-stats');
  const list = h('div.ad-list');
  const search = h('input.input', { type: 'search', placeholder: 'Search by name or uuid', spellcheck: false });
  const chips = h('div.sv-chips');
  const note = h('span.muted.ad-note');

  page.append(
    h('div.page-head',
      h('div', h('h1', 'Admin'), h('p', 'Everyone who uses Nimbus Launcher. Only Nimbus admins can see this page.')),
      h('div.spacer'),
      h('button.btn', { icon: 'refresh', onclick: () => load() }, 'Refresh'),
      h('button.btn.danger', { icon: 'lock', onclick: () => banDialog(null) }, 'Ban by name')),
    stats,
    h('div.sv-search', icon('search'), search),
    h('div.ad-bar', chips, note),
    list);

  search.addEventListener('input', () => draw());

  function drawStats() {
    clear(stats);
    const s = data?.stats || {};
    for (const [label, n, ic, cls] of [['Users', s.total, 'users', ''], ['Online now', s.online, 'globe', 'on'], ['Playing', s.playing, 'play', 'play'], ['New today', s.newToday, 'userPlus', ''], ['Banned', s.banned, 'lock', 'ban']]) {
      stats.append(h(`div.ad-stat${cls ? `.${cls}` : ''}`, icon(ic), h('b', data ? fmt(n) : '–'), h('span', label)));
    }
  }

  function drawChips() {
    clear(chips);
    const all = data?.users || [];
    for (const [id, label, n] of [['all', 'Everyone', all.length], ['online', 'Online', all.filter((u) => u.online).length], ['banned', 'Banned', all.filter((u) => u.banned).length]]) {
      chips.append(h(`button.cz-chip${filter === id ? '.on' : ''}`, { onclick: () => { filter = id; draw(); } }, `${label} · ${fmt(n)}`));
    }
  }

  function row(u) {
    const me = store.friends?.me?.uuid === u.uuid;
    const action = u.admin
      ? h('span.tag', icon('check'), me ? 'You' : 'Admin')
      : u.banned
        ? h('button.btn.sm', { icon: 'refresh', onclick: () => unban(u) }, 'Unban')
        : h('button.btn.sm.danger', { icon: 'lock', onclick: () => banDialog(u) }, 'Ban');
    const copy = h('button.btn.ghost.icon.sm', { icon: 'copy', title: 'Copy the uuid' });
    copy.onclick = () => navigator.clipboard.writeText(u.uuid).then(() => ok('Uuid copied', u.uuid)).catch(() => {});
    return h(`div.ad-row${u.online ? '.online' : ''}${u.banned ? '.banned' : ''}`,
      h('div.fr-avatar', head(u.uuid), h('i.fr-dot')),
      h('div.ad-who',
        h('div.ad-name', h('b', u.name), u.admin ? h('span.tag.ad-admin', 'Admin') : null, u.banned ? h('span.tag.ad-banned', 'Banned') : null),
        h('div.ad-uuid', h('code', u.uuid), copy),
        u.banned ? h('div.ad-ban', icon('lock'), `Banned ${banText(u.banned)}`) : null),
      h('div.ad-status', h(`span${u.hosting ? '.hosting' : ''}`, statusText(u))),
      h('div.ad-meta',
        h('span', { title: 'Nimbus coins' }, icon('coin'), u.coins == null ? '–' : fmt(u.coins)),
        h('span', { title: 'Launcher installs this account used' }, icon('monitor'), String(u.installs || 0)),
        h('span', { title: 'Started using Nimbus' }, icon('clock'), u.joined ? new Date(u.joined).toLocaleDateString() : '–')),
      h('div.ad-act', action));
  }

  function draw() {
    drawStats();
    drawChips();
    clear(list);
    if (!data) {
      list.append(h('div.sv-hint', h('i.spinner'), h('span', 'Loading everyone…')));
      return;
    }
    const q = search.value.trim().toLowerCase();
    const shown = data.users.filter((u) => (filter === 'all' || (filter === 'online' ? u.online : u.banned)) && (!q || u.name.toLowerCase().includes(q) || u.uuid.includes(q.replace(/-/g, ''))));
    note.textContent = `Updated ${new Date(data.at).toLocaleTimeString()}`;
    if (!shown.length) {
      list.append(h('div.empty.sv-empty', icon('users'), h('b', q ? `Nobody called “${search.value.trim()}”` : 'Nobody here')));
      return;
    }
    // a few hundred rows at most at once; the search finds the rest
    for (const u of shown.slice(0, 400)) list.append(row(u));
    if (shown.length > 400) list.append(h('div.sv-hint', h('span', `${fmt(shown.length - 400)} more. Search to find them.`)));
  }

  function banDialog(u) {
    const name = h('input.input', { placeholder: 'Their Minecraft name', maxLength: 16, spellcheck: false });
    const reason = h('input.input', { placeholder: 'Reason (they see this)', maxLength: 200 });
    let days = 0;
    const seg = segmented(DURATIONS, 0, (v) => { days = v; });
    const go = h('button.btn.danger', { icon: 'lock' }, u ? `Ban ${u.name}` : 'Ban');
    const m = modal({
      title: u ? `Ban ${u.name}` : 'Ban a player',
      size: 'narrow',
      body: h('div.stack',
        h('p.muted', { style: { margin: 0 } }, 'They can\'t use Nimbus Launcher at all while banned: no games, friends, chat or cosmetics, on this account and on every computer it was used on.'),
        u ? null : h('label.field', 'Minecraft name', name),
        h('label.field', 'Reason', reason),
        h('div.field', h('span', 'How long'), seg.el || seg)),
      footer: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), go],
    });
    setTimeout(() => (u ? reason : name).focus(), 50);
    const submit = async () => {
      if (!u && !name.value.trim()) { name.focus(); return; }
      go.disabled = true;
      try {
        const r = await api.admin.ban(u ? { uuid: u.uuid, name: u.name } : { name: name.value.trim() }, reason.value.trim(), days);
        m.close();
        ok(`${r.name} is banned`, r.installs ? `And ${r.installs} launcher install${r.installs === 1 ? '' : 's'} they used.` : null);
        await load();
      } catch (err) {
        go.disabled = false;
        fail('Could not ban them', err);
      }
    };
    go.onclick = submit;
    for (const el of [name, reason]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  async function unban(u) {
    try {
      await api.admin.unban(u.uuid);
      ok(`${u.name} can use Nimbus again`);
      await load();
    } catch (err) { fail('Could not unban them', err); }
  }

  async function load() {
    if (!store.friends?.me?.admin) {
      clear(list).append(h('div.empty.sv-empty', icon('lock'), h('b', 'Admins only'), h('span', 'This page is for Nimbus admins.')));
      clear(stats);
      clear(chips);
      return;
    }
    try {
      data = await api.admin.users();
    } catch (err) {
      fail('Could not load the users', err);
    }
    draw();
  }

  draw();
  load();
  const timer = setInterval(() => { if (!document.hidden) load(); }, 30_000);
  return () => clearInterval(timer);
}
