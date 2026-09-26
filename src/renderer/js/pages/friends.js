// Friends: add people by their Minecraft name, see who's on and what they play, chat, and
// join worlds they host on Nimbus LAN.
import { h, icon, clear, fail, ok, fmtAgo } from '../ui.js';
import { api, store } from '../store.js';

const head = (uuid, size = 40) => h('img.fr-head', { src: `https://mc-heads.net/avatar/${uuid}/${size}`, alt: '', loading: 'lazy', width: size, height: size });
const LOADERS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

function statusText(f) {
  if (f.hosting) return `Hosting ${f.hosting.world ? `“${f.hosting.world}”` : 'a world'} · ${f.hosting.mc}`;
  if (f.status === 'playing' && f.playing) return `Playing ${f.playing.mc} ${LOADERS[f.playing.loader] || ''}`.trim();
  if (f.online) return 'Online';
  return f.seen ? `Offline · ${fmtAgo(f.seen)}` : 'Offline';
}

let openChat = null;

export function render(page, params = {}) {
  if (params.uuid) openChat = params.uuid;
  const list = h('div.fr-list');
  const chat = h('div.fr-chat');
  const addInput = h('input.input', { placeholder: 'Minecraft name', maxlength: 16, spellcheck: false });
  const addBtn = h('button.btn.primary', { icon: 'userPlus' }, 'Add friend');
  const add = async () => {
    const name = addInput.value.trim();
    if (!name) return addInput.focus();
    addBtn.disabled = true;
    try {
      const r = await api.friends.add(name);
      ok(r.status === 'friends' ? `You and ${r.name} are friends` : `Request sent to ${r.name}`, r.status === 'friends' ? null : 'They see it next time they open Nimbus.');
      addInput.value = '';
    } catch (err) { fail('Could not add them', err); } finally { addBtn.disabled = false; }
  };
  addBtn.onclick = add;
  addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  const lanBar = h('div.lan-bar');
  page.append(
    h('div.page-head', h('div', h('h1', 'Friends'), h('p', 'Chat, see what your friends play, and join their worlds on Nimbus LAN.'))),
    lanBar,
    h('div.fr-shell', h('div.fr-side', h('div.card.fr-add', addInput, addBtn), list), chat),
  );

  // Nimbus LAN: where a join stands, and requests to join your world
  const JOIN_TEXT = {
    asking: (j) => `Asking ${j.name} to let you in…`,
    connecting: (j) => `${j.name} said yes! Connecting to their computer…`,
    starting: (j) => `Starting Minecraft ${j.mc} and joining “${j.world || 'their world'}”…`,
    playing: (j) => `You're in ${j.name}'s world. Have fun!`,
    ready: (j) => j.note || `Connected to ${j.name}.`,
    failed: (j) => j.error || 'That didn’t work.',
    cancelled: () => 'Cancelled.',
  };
  function drawLan() {
    const l = store.lan || {};
    clear(lanBar);
    const j = l.joining;
    if (j && j.status !== 'cancelled') {
      const busy = ['asking', 'connecting', 'starting'].includes(j.status);
      lanBar.append(h(`div.lan-card.${j.status}`, head(j.to, 36),
        h('div.fr-txt', h('b', j.status === 'failed' ? `Couldn't join ${j.name}` : `Joining ${j.name}`), h('span', (JOIN_TEXT[j.status] || (() => j.status))(j))),
        busy ? h('i.lan-spin') : null,
        busy ? h('button.btn.sm.ghost', { onclick: () => api.lan.cancel().catch(() => {}) }, 'Cancel') : null));
    }
    if (l.hosting) {
      lanBar.append(h('div.lan-card.hosting', icon('globe'),
        h('div.fr-txt', h('b', `“${l.hosting.world}” is on Nimbus LAN`), h('span', l.requests?.length ? 'Someone wants to join. You can answer here or press Y / N in game.' : 'Friends can ask to join from their launcher.'))));
      for (const r of l.requests || []) {
        lanBar.append(h('div.lan-card.ask', head(r.uuid, 36), h('div.fr-txt', h('b', `${r.name} wants to join your world`), h('span', 'They join as soon as you say yes.')),
          h('button.btn.sm.primary', { icon: 'check', onclick: () => api.lan.decide(r.id, true).catch((e) => fail('Could not answer', e)) }, 'Let them in'),
          h('button.btn.sm.ghost', { onclick: () => api.lan.decide(r.id, false).catch(() => {}) }, 'No')));
      }
    }
  }
  api.lan.state().then((st) => { store.lan = st; drawLan(); }).catch(() => {});
  drawLan();
  const offLan = store.on('lan', drawLan);

  function drawList() {
    const s = store.friends || {};
    clear(list);
    if (!s.signedIn) {
      list.append(h('div.card.fr-empty', icon(s.offline ? 'globe' : 'users'), h('b', s.offline ? 'Friends are offline' : 'Friends need a Microsoft account'),
        h('span', s.error || 'Sign in with the account you play Minecraft with.'),
        h('button.btn.sm', { icon: 'refresh', onclick: () => api.friends.refresh().catch((e) => fail('Still no luck', e)) }, 'Try again')));
      drawChat();
      return;
    }
    if (s.error) list.append(h('div.fr-warn', icon('alert'), s.error));
    if (s.requests?.length) {
      list.append(h('div.group-title', 'Friend requests'));
      for (const r of s.requests) {
        list.append(h('div.fr-row.req', head(r.uuid, 36), h('div.fr-txt', h('b', r.name), h('span', 'wants to be friends')),
          h('button.btn.sm.primary', { icon: 'check', onclick: () => api.friends.accept(r.uuid).then(() => ok(`You and ${r.name} are friends`)).catch((e) => fail('Could not accept', e)) }, 'Accept'),
          h('button.btn.sm.ghost', { icon: 'x', title: 'Decline', onclick: () => api.friends.decline(r.uuid).catch((e) => fail('Could not decline', e)) })));
      }
    }
    const friends = [...(s.friends || [])].sort((a, b) => Number(Boolean(b.hosting)) - Number(Boolean(a.hosting)) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    list.append(h('div.group-title', `Friends · ${friends.filter((f) => f.online).length} online`));
    if (!friends.length) list.append(h('div.fr-hint', 'No friends yet. Add someone by their Minecraft name above.'));
    for (const f of friends) {
      const unread = s.unread?.[f.uuid] || 0;
      const row = h(`div.fr-row${openChat === f.uuid ? '.on' : ''}${f.online ? '.online' : ''}`, { onclick: () => { openChat = f.uuid; drawList(); drawChat(); } },
        h('div.fr-avatar', head(f.uuid, 40), h('i.fr-dot')),
        h('div.fr-txt', h('b', f.name), h(`span${f.hosting ? '.hosting' : ''}`, statusText(f))),
        unread ? h('span.fr-badge', String(unread)) : null,
        f.hosting ? h('button.btn.sm.primary.fr-join', { icon: 'play', onclick: (e) => { e.stopPropagation(); join(f); } }, 'Join') : null);
      row.dataset.uuid = f.uuid;
      list.append(row);
    }
    if (s.outgoing?.length) {
      list.append(h('div.group-title', 'Waiting for them'));
      for (const r of s.outgoing) {
        list.append(h('div.fr-row.req', head(r.uuid, 36), h('div.fr-txt', h('b', r.name), h('span', 'request sent')),
          h('button.btn.sm.ghost', { onclick: () => api.friends.cancel(r.uuid).catch((e) => fail('Could not cancel', e)) }, 'Cancel')));
      }
    }
    if (openChat && !friends.some((f) => f.uuid === openChat)) openChat = null;
    if (!openChat && friends.length) openChat = friends[0].uuid;
  }

  let chatFor = null;
  let messagesBox = null;
  function drawChat() {
    const s = store.friends || {};
    const f = (s.friends || []).find((x) => x.uuid === openChat);
    if (!f) {
      chatFor = null;
      clear(chat).append(h('div.fr-chat-empty', icon('message'), h('b', 'Pick a friend to chat'), h('span', 'Messages wait for them if they’re offline.')));
      return;
    }
    if (chatFor === f.uuid) {
      // same chat: just refresh the header
      const st = chat.querySelector('.fr-chat-head span');
      if (st) st.textContent = statusText(f);
      return;
    }
    chatFor = f.uuid;
    messagesBox = h('div.fr-messages');
    const input = h('input.input', { placeholder: `Message ${f.name}`, maxlength: 1000 });
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        const m = await api.friends.chat(f.uuid, text);
        appendMessage(m);
      } catch (err) { input.value = text; fail('Not sent', err); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    clear(chat).append(
      h('div.fr-chat-head', head(f.uuid, 36), h('div.fr-txt', h('b', f.name), h('span', statusText(f))),
        h('button.btn.sm.ghost', { title: 'Remove friend', onclick: async () => {
          if (!confirm(`Remove ${f.name} from your friends?`)) return;
          await api.friends.remove(f.uuid).catch((e) => fail('Could not remove', e));
        } }, 'Remove')),
      messagesBox,
      h('div.fr-compose', input, h('button.btn.primary', { icon: 'send', onclick: send }, 'Send')));
    messagesBox.append(h('div.fr-hint', 'Loading messages…'));
    api.friends.history(f.uuid).then((msgs) => {
      clear(messagesBox);
      if (!msgs.length) messagesBox.append(h('div.fr-hint', `Say hi to ${f.name}!`));
      for (const m of msgs) appendMessage(m, false);
      messagesBox.scrollTop = messagesBox.scrollHeight;
    }).catch((err) => { clear(messagesBox).append(h('div.fr-hint', err.message)); });
    api.friends.read(f.uuid).catch(() => {});
    setTimeout(() => input.focus(), 50);
  }

  function appendMessage(m, animate = true) {
    if (!messagesBox) return;
    messagesBox.querySelector('.fr-hint')?.remove();
    const mine = m.from === store.friends?.me?.uuid;
    const el = h(`div.fr-msg${mine ? '.mine' : ''}${animate ? '.new' : ''}`, h('p', m.text), h('time', new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    messagesBox.append(el);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  async function join(f) {
    try {
      await api.lan.join(f.uuid);
    } catch (err) { fail(`Could not join ${f.name}`, err); }
  }

  drawList();
  drawChat();
  const offState = store.on('friends', () => { drawList(); drawChat(); });
  const offMsg = store.on('friend-message', (m) => {
    if (m.type === 'chat' && m.from === chatFor) {
      appendMessage(m);
      api.friends.read(m.from).catch(() => {});
    }
  });
  return () => { offState(); offMsg(); offLan(); };
}
