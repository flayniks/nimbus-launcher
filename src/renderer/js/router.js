// Page switching and the Play action, shared by every page.
import { h, icon, fail, info, closeModals } from './ui.js';
import { api, store } from './store.js';
import * as look from './look.js';

let PAGES = {};

export function registerPages(pages) {
  PAGES = pages;
}

let current = null;

/** Switches page with an exit/enter animation; each page returns its own cleanup. */
export function go(name, params = {}) {
  const view = document.getElementById('view');
  closeModals();
  if (current?.cleanup) { try { current.cleanup(); } catch (err) { console.error(err); } }
  for (const old of view.querySelectorAll('.page')) {
    old.classList.remove('page-enter');
    old.classList.add('page-leave');
    setTimeout(() => old.remove(), 170);
  }
  const page = h('section.page.page-enter');
  view.appendChild(page);
  current = { name, params, cleanup: null };
  try {
    current.cleanup = PAGES[name].render(page, params) || null;
  } catch (err) {
    console.error(err);
    page.appendChild(h('div.empty', icon('alert'), h('b', 'Something broke'), err.message));
  }
  markNav(name === 'instance' ? 'home' : name);
}

function markNav(name) {
  const items = [...document.querySelectorAll('.nav-item')];
  const on = items.find((i) => i.dataset.page === name);
  items.forEach((i) => i.classList.toggle('active', i === on));
  const pill = document.querySelector('.nav-pill');
  if (on) {
    pill.style.opacity = '1';
    pill.style.transform = `translateY(${on.offsetTop}px)`;
  } else pill.style.opacity = '0';
}

/** Starts (or stops) an instance, sending people to sign in first when needed. */
export async function play(id) {
  if (store.running.has(id)) {
    await api.game.kill(id).catch((err) => fail('Could not stop the game', err));
    return;
  }
  if (!store.activeAccount()) {
    info('Sign in to play', 'Add the Microsoft account you bought Minecraft with.');
    go('accounts');
    return;
  }
  store.emit('launching', { id, on: true });
  try {
    await api.game.launch(id);
  } catch (err) {
    if (err.code === 'BANNED') {
      fail('You can\'t play while banned', err);
    } else if (err.code === 'NO_ACCOUNT' || err.code === 'REAUTH') {
      fail('Sign in again', err);
      go('accounts');
    } else {
      fail('Could not start the game', err, {
        actions: [{ label: 'Repair instance', run: () => api.instances.repair(id).catch((e) => fail('Repair failed', e)) }],
      });
    }
  } finally {
    store.emit('launching', { id, on: false });
  }
}

export function applyLook(s) {
  look.applyLook(s);
}
