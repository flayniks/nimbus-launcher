// Sharing screenshots in chat: pick a friend for a screenshot (from the Gallery), pick a
// screenshot for a friend (from the chat), and look at the pictures friends sent.
import { h, icon, clear, fail, ok, modal } from './ui.js';
import { api, store } from './store.js';
import { go } from './router.js';

const head = (uuid, size = 32) => h('img.fr-head', { src: `https://mc-heads.net/avatar/${uuid}/${size}`, alt: '', loading: 'lazy', width: size, height: size });

/** Sends `shot` (a gallery screenshot) with an optional message; resolves to the chat message. */
async function send(to, shot, text, button) {
  const label = button?.textContent;
  if (button) { button.disabled = true; button.replaceChildren(h('i.spinner'), 'Sending'); }
  try {
    return await api.friends.sendShot(to, shot.path, text);
  } finally {
    if (button) { button.disabled = false; button.replaceChildren(icon('send'), label); }
  }
}

/** Gallery → "Send to a friend": choose who gets it. */
export function sendToFriend(shot) {
  const s = store.friends || {};
  if (!s.signedIn) {
    fail('Friends need a Microsoft account', new Error(s.error || 'Sign in with the account you play Minecraft with.'));
    return;
  }
  const friends = [...(s.friends || [])].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  if (!friends.length) {
    fail('No friends yet', new Error('Add someone on the Friends page first.'));
    return;
  }
  let chosen = null;
  const caption = h('input.input', { placeholder: 'Say something (optional)', maxLength: 300 });
  const sendBtn = h('button.btn.primary', { icon: 'send', disabled: true }, 'Send');
  const rows = friends.map((f) => {
    const row = h(`button.sh-friend${f.online ? '.online' : ''}`, { type: 'button' },
      h('div.fr-avatar', head(f.uuid, 32), h('i.fr-dot')), h('b', f.name), h('span', f.online ? 'Online' : 'Offline'));
    row.onclick = () => {
      chosen = f;
      for (const r of rows) r.classList.toggle('on', r === row);
      sendBtn.disabled = false;
      caption.focus();
    };
    return row;
  });
  const m = modal({
    title: 'Send to a friend',
    size: 'narrow',
    body: h('div.sh-pick',
      h('img.sh-preview', { src: shot.thumb || shot.url, alt: '' }),
      h('div.sh-friends', ...rows),
      caption),
    footer: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), sendBtn],
  });
  const go2 = async () => {
    if (!chosen) return;
    try {
      await send(chosen.uuid, shot, caption.value.trim(), sendBtn);
      m.close();
      ok(`Sent to ${chosen.name}`, 'It’s in your chat with them.', { actions: [{ label: 'Open chat', run: () => go('friends', { uuid: chosen.uuid }) }] });
    } catch (err) { fail('Not sent', err); }
  };
  sendBtn.onclick = go2;
  caption.addEventListener('keydown', (e) => { if (e.key === 'Enter') go2(); });
}

/** Chat → picture button: choose one of your screenshots for `friend`; resolves to the sent message. */
export function pickScreenshot(friend) {
  return new Promise((resolve) => {
    let chosen = null;
    let done = false;
    const grid = h('div.sh-grid', h('div.fr-hint', 'Loading your screenshots…'));
    const caption = h('input.input', { placeholder: 'Say something (optional)', maxLength: 300 });
    const sendBtn = h('button.btn.primary', { icon: 'send', disabled: true }, 'Send');
    const m = modal({
      title: `Send ${friend.name} a screenshot`,
      size: 'wide',
      body: h('div.sh-pick', grid, caption),
      footer: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), sendBtn],
      onClose: () => { if (!done) resolve(null); },
    });
    api.gallery.list().then(({ screenshots }) => {
      clear(grid);
      if (!screenshots.length) {
        grid.append(h('div.empty.gl-empty', icon('image'), h('b', 'No screenshots yet'), 'Press F2 in game to take one.'));
        return;
      }
      const tiles = screenshots.slice(0, 120).map((s) => {
        const tile = h('button.sh-tile', { type: 'button', title: `${s.instance} · ${new Date(s.time).toLocaleString()}` }, h('img', { src: s.thumb, alt: '', loading: 'lazy', decoding: 'async' }), h('i', icon('check')));
        tile.onclick = () => {
          chosen = s;
          for (const t of tiles) t.classList.toggle('on', t === tile);
          sendBtn.disabled = false;
        };
        tile.ondblclick = () => { chosen = s; submit(); };
        return tile;
      });
      grid.append(...tiles);
    }).catch((err) => { clear(grid).append(h('div.fr-hint', err.message)); });
    const submit = async () => {
      if (!chosen) return;
      try {
        const msg = await send(friend.uuid, chosen, caption.value.trim(), sendBtn);
        done = true;
        resolve(msg);
        m.close();
      } catch (err) { fail('Not sent', err); }
    };
    sendBtn.onclick = submit;
    caption.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

/** A picture in a chat message: loads when it's drawn, opens big when clicked. */
export function chatPicture(m) {
  const { id, w, h: ht } = m.image;
  const box = h('button.fr-pic', { type: 'button', title: 'Open', style: { aspectRatio: `${w} / ${ht}` } }, h('i.spinner'));
  let url = null;
  api.friends.image(id).then((u) => {
    url = u;
    box.replaceChildren(h('img', { src: u, alt: 'Screenshot' }));
  }).catch((err) => {
    box.classList.add('gone');
    box.replaceChildren(icon('image'), h('span', err.message));
  });
  box.onclick = () => { if (url) openPicture(url, m); };
  return box;
}

function openPicture(url, m) {
  const mine = m.from === store.friends?.me?.uuid;
  const act = (label, ic, run) => h('button.btn.sm', { icon: ic, onclick: run }, label);
  const md = modal({
    title: '',
    size: 'wide',
    body: h('div.gl-view',
      h('div.gl-stage', h('img', { src: url, alt: '' })),
      h('div.gl-meta', h('b', mine ? 'You sent this' : `From ${m.name}`), h('span', [m.text, new Date(m.at).toLocaleString()].filter(Boolean).join(' · '))),
      h('div.gl-actions',
        act('Copy', 'copy', () => api.friends.copyImage(m.image.id).then(() => ok('Copied', 'Paste it anywhere.')).catch((e) => fail('Could not copy', e))),
        act('Save…', 'download', () => api.friends.saveImage(m.image.id, mine ? 'Me' : m.name).then((saved) => { if (saved) ok('Saved'); }).catch((e) => fail('Could not save', e))))),
  });
  md.el.classList.add('gl-modal');
}
