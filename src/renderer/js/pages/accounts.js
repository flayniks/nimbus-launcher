import { h, icon, clear, fail, ok, confirmDialog, avatarUrl } from '../ui.js';
import { api, store } from '../store.js';

export function render(page) {
  const list = h('div.grid', { style: { gap: '10px' } });
  const loginBtn = h('button.ms-btn', h('span.ms', h('i', { style: { background: '#f25022' } }), h('i', { style: { background: '#7fba00' } }), h('i', { style: { background: '#00a4ef' } }), h('i', { style: { background: '#ffb900' } })), 'Sign in with Microsoft');

  loginBtn.onclick = async () => {
    loginBtn.disabled = true;
    const label = loginBtn.lastChild;
    label.textContent = 'Waiting for Microsoft…';
    try {
      await api.accounts.login();
      await store.refreshAccounts();
      ok(`Signed in as ${store.activeAccount()?.name}`, 'You are ready to play.');
    } catch (err) {
      if (err.code !== 'CANCELLED') fail('Sign-in failed', err);
    } finally {
      loginBtn.disabled = false;
      label.textContent = 'Sign in with Microsoft';
    }
  };

  page.append(
    h('div.page-head', h('div', h('h1', 'Accounts'), h('p', 'Minecraft: Java Edition needs a Microsoft account that owns the game.'))),
    h('div.card.pad', { style: { display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap', animation: 'rise .4s var(--ease) both' } },
      h('div', { style: { flex: 1, minWidth: '260px' } },
        h('b', { style: { fontSize: '15px' } }, 'Add an account'),
        h('div.muted', { style: { fontSize: '13px', marginTop: '4px' } },
          'A Microsoft window opens — sign in there. Nimbus never sees your password, and the tokens it gets back are stored encrypted with your system keychain.')),
      loginBtn),
    h('h2.section', 'Signed in'),
    list);

  function draw() {
    clear(list);
    if (!store.accounts.length) {
      list.appendChild(h('div.empty', icon('users'), h('b', 'No accounts yet'), 'Sign in above to start playing.'));
      return;
    }
    store.accounts.forEach((a, i) => {
      const img = h('img', { src: avatarUrl(a.uuid, 64), alt: '' });
      img.onerror = () => { img.style.visibility = 'hidden'; };
      list.appendChild(h(`div.acct${a.active ? '.on' : ''}`, { style: { animation: `rise .35s var(--ease) both ${i * 40}ms` } },
        img,
        h('div.grow', h('b', a.name), h('span', a.needsLogin ? 'Needs to sign in again' : a.active ? 'Playing as this account' : 'Microsoft account')),
        a.active ? h('span.tag.good', icon('check'), 'Active') : h('button.btn.sm', { onclick: async () => { await api.accounts.select(a.uuid); await store.refreshAccounts(); ok(`Now playing as ${a.name}`); } }, 'Use this'),
        h('button.btn.sm.ghost.danger', {
          icon: 'logout',
          onclick: async () => {
            if (!(await confirmDialog({ title: `Sign out ${a.name}?`, message: 'Its saved sign-in is deleted from this computer.', confirm: 'Sign out', danger: true }))) return;
            try { await api.accounts.remove(a.uuid); await store.refreshAccounts(); } catch (err) { fail('Could not sign out', err); }
          },
        }, 'Sign out')));
    });
  }

  draw();
  return store.on('accounts', draw);
}
