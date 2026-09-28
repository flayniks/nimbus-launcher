// Servers: your favourites, the servers you added in game, and a few big public ones, each
// pinged live (players, ping, version, message of the day). Play starts an instance and joins.
import { h, icon, clear, fail, ok, modal } from '../ui.js';
import { api, store } from '../store.js';
import { go } from '../router.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const cmpVer = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

/** The Minecraft versions a server says it takes ("Requires MC 1.8 / 1.21", "Paper 1.21.1"…), as [min, max]. */
function versionRange(text) {
  const found = String(text || '').match(/1\.\d+(?:\.\d+)?/g);
  if (!found) return null;
  const sorted = found.sort(cmpVer);
  return [sorted[0], sorted[sorted.length - 1]];
}

function fits(range, mc) {
  if (!range || !/^1\.\d+/.test(mc || '')) return null;
  const major = (v) => v.split('.').slice(0, 2).join('.');
  if (range[0] === range[1]) return major(mc) === major(range[0]) && (range[0].split('.').length < 3 || cmpVer(mc, range[0]) === 0);
  return cmpVer(major(mc), major(range[0])) >= 0 && cmpVer(major(mc), major(range[1])) <= 0;
}

function motd(runs) {
  const el = h('div.sv-motd');
  for (const r of runs || []) {
    for (const [i, line] of r.text.split('\n').entries()) {
      if (i > 0) el.append(h('br'));
      if (!line) continue;
      el.append(h('span', { style: { color: r.color || null, fontWeight: r.bold ? '700' : null, fontStyle: r.italic ? 'italic' : null } }, line));
    }
  }
  return el;
}

function bars(ms) {
  const n = ms == null ? 0 : ms < 80 ? 4 : ms < 150 ? 3 : ms < 300 ? 2 : 1;
  const cls = n >= 3 ? 'good' : n === 2 ? 'ok' : 'bad';
  return h(`span.sv-bars.${cls}`, { title: ms == null ? 'No ping' : `${ms} ms` }, ...[1, 2, 3, 4].map((k) => h(`i${k <= n ? '.on' : ''}`, { style: { height: `${4 + k * 3}px` } })));
}

export function render(page) {
  let data = { favourites: [], fromGame: [], popular: [] };
  let instances = [];
  const status = new Map(); // address -> ping result (or 'pending')
  const chosenFor = new Map(); // address -> instance id picked by hand
  const lists = h('div.sv-lists');
  const refreshBtn = h('button.btn', { icon: 'refresh', onclick: () => pingAll(true) }, 'Refresh');

  page.append(
    h('div.page-head',
      h('div', h('h1', 'Servers'), h('p', 'Live players, ping and version for your favourite servers. Press Play to start Minecraft and join.')),
      h('div.spacer'),
      refreshBtn,
      h('button.btn.primary', { icon: 'plus', onclick: () => addServer() }, 'Add server')),
    lists,
  );

  function pickInstance(server) {
    const range = versionRange(status.get(server.address)?.version);
    const ranked = [...instances].sort((a, b) => {
      const fa = fits(range, a.mcVersion) ? 1 : 0;
      const fb = fits(range, b.mcVersion) ? 1 : 0;
      return fb - fa || (b.lastPlayed || 0) - (a.lastPlayed || 0);
    });
    return ranked[0] || null;
  }

  function card(server, { favourite = false, from = null } = {}) {
    const st = status.get(server.address);
    const pending = st === 'pending' || !st;
    const online = st && st !== 'pending' && st.online;
    const range = online ? versionRange(st.version) : null;
    const select = h('select.select.sv-inst', { title: 'Which instance to play with' });
    const chosen = instances.find((i) => i.id === chosenFor.get(server.address)) || pickInstance(server);
    for (const inst of instances) {
      const good = fits(range, inst.mcVersion);
      select.append(h('option', { value: inst.id, selected: inst === chosen }, `${inst.name}${good === false ? ' (other version)' : ''}`));
    }
    select.onchange = () => chosenFor.set(server.address, select.value);
    const play = h('button.btn.primary.sv-play', { icon: 'play', disabled: !instances.length }, 'Play');
    play.onclick = async () => {
      const id = select.value;
      if (!id) return;
      if (!store.activeAccount()) { fail('Sign in to play', new Error('Add the Microsoft account you bought Minecraft with.')); go('accounts'); return; }
      play.disabled = true;
      play.replaceChildren(h('i.spinner'), 'Starting');
      try {
        await api.servers.play(id, server.address);
      } catch (err) {
        fail(`Couldn't join ${server.name}`, err);
      } finally {
        play.disabled = false;
        play.replaceChildren(icon('play'), 'Play');
      }
    };
    const isFav = data.favourites.some((f) => f.address === server.address);
    const star = h(`button.btn.ghost.icon.sm.sv-star${isFav ? '.on' : ''}`, { icon: 'heart', title: isFav ? 'Remove from favourites' : 'Add to favourites' });
    star.onclick = async () => {
      try {
        if (isFav) await api.servers.remove(server.address);
        else await api.servers.add({ name: server.name, address: server.address });
        await load();
      } catch (err) { fail('Could not change favourites', err); }
    };
    const copy = h('button.btn.ghost.icon.sm', { icon: 'copy', title: 'Copy the address' });
    copy.onclick = () => { navigator.clipboard.writeText(server.address).then(() => ok('Address copied', server.address)).catch(() => {}); };

    const pic = online && st.favicon ? h('img.sv-icon', { src: st.favicon, alt: '' }) : h('div.sv-icon.ph', icon('server'));
    const players = online ? h('span.sv-players', icon('users'), h('b', fmt(st.players.online)), h('span', ` / ${fmt(st.players.max)}`)) : null;
    const state = pending ? h('span.sv-state', h('i.spinner'), 'Pinging…')
      : online ? h('span.sv-state.on', bars(st.latency), st.latency != null ? `${st.latency} ms` : '')
        : h('span.sv-state.off', icon('alert'), st.error || 'Offline');
    const fit = online && range && chosen ? fits(range, chosen.mcVersion) : null;
    return h(`div.sv-card${online ? '' : pending ? '.pending' : '.offline'}`,
      pic,
      h('div.sv-main',
        h('div.sv-top', h('b.sv-name', server.name), players, state),
        h('div.sv-addr', server.address, from ? h('span.sv-from', ` · in ${from}`) : null, online && st.version ? h('span.sv-ver', st.version) : null),
        online ? motd(st.motd) : server.tags ? h('div.sv-tags', ...server.tags.map((t) => h('span.tag', t))) : null,
        online && st.players.sample?.length ? h('div.sv-sample', st.players.sample.slice(0, 6).join(', ')) : null),
      h('div.sv-side',
        h('div.sv-actions', star, copy),
        instances.length ? select : h('button.btn.sm', { onclick: () => go('home') }, 'Make an instance first'),
        play,
        fit === false ? h('span.sv-warn', icon('alert'), `Takes ${range[0] === range[1] ? range[0] : `${range[0]}–${range[1]}`}`) : null));
  }

  function section(title, sub, items, opts) {
    if (!items.length) return null;
    return h('section.sv-section', h('header', h('h3', title), sub ? h('span.muted', sub) : null),
      h('div.sv-list', ...items.map((s) => card(s, typeof opts === 'function' ? opts(s) : opts))));
  }

  function draw() {
    clear(lists);
    const favs = section('Favourites', null, data.favourites, { favourite: true });
    const game = section('In your games', 'from the multiplayer list of each instance', data.fromGame, (s) => ({ from: s.instance }));
    const popular = section('Popular servers', 'big public servers, pinged live', data.popular.filter((p) => !data.favourites.some((f) => f.address === p.address)), {});
    if (!favs) {
      lists.append(h('div.sv-hint', icon('heart'), h('span', 'Press the heart on a server to keep it at the top, or ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); addServer(); } }, 'add one by its address'), '.')));
    }
    lists.append(...[favs, game, popular].filter(Boolean));
  }

  async function pingAll(force = false) {
    const all = [...data.favourites, ...data.fromGame, ...data.popular];
    const todo = all.filter((s) => force || !status.has(s.address));
    for (const s of todo) status.set(s.address, 'pending');
    draw();
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const s = todo[i++];
        try { status.set(s.address, await api.servers.ping(s.address)); } catch (err) { status.set(s.address, { online: false, error: err.message }); }
        draw();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  function addServer() {
    const name = h('input.input', { placeholder: 'My server', maxLength: 40 });
    const address = h('input.input', { placeholder: 'play.example.com or 1.2.3.4:25565', spellcheck: false });
    const save = h('button.btn.primary', { icon: 'plus' }, 'Add');
    const m = modal({
      title: 'Add a server',
      size: 'narrow',
      body: h('div.stack', h('label.field', 'Address', address), h('label.field', 'Name (optional)', name)),
      footer: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), save],
    });
    setTimeout(() => address.focus(), 50);
    const submit = async () => {
      if (!address.value.trim()) { address.focus(); return; }
      save.disabled = true;
      try {
        await api.servers.add({ name: name.value, address: address.value });
        m.close();
        await load();
      } catch (err) {
        save.disabled = false;
        fail('Could not add that server', err);
      }
    };
    save.onclick = submit;
    for (const el of [name, address]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  async function load() {
    try {
      [data, instances] = await Promise.all([api.servers.list(), api.instances.list()]);
    } catch (err) {
      fail('Could not load servers', err);
    }
    draw();
    pingAll();
  }

  load();
  const timer = setInterval(() => { if (!document.hidden) pingAll(true); }, 60_000);
  return () => clearInterval(timer);
}
