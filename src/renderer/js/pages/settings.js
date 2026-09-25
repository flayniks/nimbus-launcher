import { h, icon, clear, fail, ok, fmtBytes, segmented, toggle, rangeFill, confirmDialog } from '../ui.js';
import { api, store } from '../store.js';
import { applyLook } from '../router.js';

const ACCENTS = [
  ['violet', '#7c5cff', '#c084fc'],
  ['sky', '#3b82f6', '#22d3ee'],
  ['emerald', '#10b981', '#5eead4'],
  ['rose', '#f43f5e', '#fb923c'],
  ['amber', '#f59e0b', '#fde047'],
  ['mono', '#9ca3af', '#f3f4f6'],
];

export function render(page) {
  const s = store.settings;
  const save = async (patch) => {
    try {
      store.settings = await api.settings.set(patch);
      applyLook(store.settings);
    } catch (err) { fail('Could not save', err); }
  };

  const swatches = h('div.row-gap');
  const drawSwatches = () => {
    clear(swatches);
    for (const [id, a, b] of ACCENTS) {
      const on = (store.settings.accent || 'violet') === id;
      swatches.appendChild(h('button', {
        title: id,
        style: {
          width: '30px', height: '30px', borderRadius: '10px', cursor: 'pointer', border: on ? '2px solid #fff' : '2px solid transparent',
          background: `linear-gradient(135deg, ${a}, ${b})`, transform: on ? 'scale(1.1)' : 'none', transition: 'transform .3s var(--ease-spring)',
        },
        onclick: async () => { await save({ accent: id }); drawSwatches(); },
      }));
    }
  };
  drawSwatches();

  const concOut = h('b', String(s.concurrency));
  const conc = rangeFill(h('input', { type: 'range', min: 4, max: 48, step: 2, value: s.concurrency }));
  conc.addEventListener('input', () => { concOut.textContent = conc.value; });
  conc.addEventListener('change', () => save({ concurrency: Number(conc.value) }));

  const clientId = h('input.input', { value: s.msClientId || '', placeholder: 'Leave empty to use the default', onchange: () => save({ msClientId: clientId.value.trim() }) });
  const cacheOut = h('span', '…');
  const javaList = h('div', { style: { display: 'grid', gap: '6px', minWidth: 0, width: '100%' } });

  page.append(
    h('div.page-head', h('div', h('h1', 'Settings'), h('p', 'How the launcher behaves and looks.'))),
    h('div.settings-grid.stagger',
      h('div.card',
        h('div.setting', h('div.txt', h('b', 'When the game starts'), h('span', 'Hiding the launcher frees memory and GPU time for Minecraft.'))),
        h('div.setting', segmented([
          { value: 'hide', label: 'Hide launcher' },
          { value: 'keep', label: 'Keep open' },
          { value: 'close', label: 'Close launcher' },
        ], s.onLaunch, (v) => save({ onLaunch: v })))),
      h('div.card',
        h('div.setting', h('div.txt', h('b', 'Animations'), h('span', 'Turn off for the lightest possible launcher.')), toggle(s.animations !== false, (on) => save({ animations: on }))),
        h('div.setting', h('div.txt', h('b', 'Accent colour')), swatches)),
      h('div.card',
        h('div.setting', h('div.txt', h('b', 'Parallel downloads'), h('span', 'More is faster on good connections.')), concOut),
        h('div.setting', conc)),
      h('div.card',
        h('div.setting', h('div.txt', h('b', 'Storage'), h('span', h('span', { style: { userSelect: 'text' } }, s.dataDir))), h('button.btn.sm', { icon: 'folder', onclick: () => api.app.openData() }, 'Open')),
        h('div.setting', h('div.txt', h('b', 'Download cache'), h('span', 'Installers and modpack archives. Safe to clear.')), cacheOut,
          h('button.btn.sm', { icon: 'trash', onclick: async () => {
            if (!(await confirmDialog({ title: 'Clear the cache?', message: 'Installers and downloaded modpack files are removed. Instances are not touched.', confirm: 'Clear' }))) return;
            await api.cache.clear(); ok('Cache cleared'); loadCache();
          } }, 'Clear'))),
      h('div.card',
        h('div.setting', h('div.txt', h('b', 'Java installs found'), h('span', 'Nimbus downloads the right Java per version by itself; these are for custom setups.')),
          h('button.btn.sm', { icon: 'refresh', onclick: loadJava }, 'Scan')),
        h('div.setting', { style: { minWidth: 0 } }, javaList)),
      h('div.card',
        h('div.setting', h('div.txt', h('b', 'Microsoft app client ID'), h('span', 'Advanced. Use your own Azure app (it must be approved for the Minecraft API).'))),
        h('div.setting', clientId))),
    h('div.muted', { style: { marginTop: '26px', fontSize: '12.5px', display: 'flex', gap: '8px', alignItems: 'center' } }, icon('info'),
      h('span', 'Nimbus Launcher · not affiliated with Mojang or Microsoft. Mods, packs and shaders come from ', h('a', { href: 'https://modrinth.com' }, 'Modrinth'), '.')),
  );
  [...page.querySelector('.stagger').children].forEach((c, i) => c.style.setProperty('--i', i));

  async function loadCache() {
    try { cacheOut.textContent = fmtBytes(await api.cache.size()); } catch { cacheOut.textContent = '?'; }
  }
  async function loadJava() {
    clear(javaList).appendChild(h('span.muted', 'Scanning…'));
    try {
      const list = await api.java.detect();
      clear(javaList);
      if (!list.length) javaList.appendChild(h('span.muted', 'None found yet — they appear after the first launch.'));
      for (const j of list) {
        javaList.appendChild(h('div.row-gap', { style: { fontSize: '12.5px', flexWrap: 'nowrap' } }, h('span.tag.accent', `Java ${j.major}`),
          h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'text' }, title: j.path }, j.path)));
      }
    } catch (err) { clear(javaList).appendChild(h('span.muted', err.message)); }
  }
  loadCache();
  loadJava();
  return null;
}
