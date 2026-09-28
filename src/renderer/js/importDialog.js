// Import from other launchers: finds CurseForge, Prism, MultiMC, ATLauncher and Modrinth App
// instances on this computer, and brings the ones you tick over with their mods and worlds.
import { h, icon, clear, fail, ok, modal, instanceIcon, LOADER_NAMES } from './ui.js';
import { api, store } from './store.js';

export function openImport() {
  let found = [];
  const picked = new Set();
  const list = h('div.im-list');
  const status = h('span.muted');
  const importBtn = h('button.btn.primary', { icon: 'download', disabled: true }, 'Import');
  const m = modal({
    title: 'Import from another launcher',
    size: 'wide',
    body: h('div.stack',
      h('p.muted', { style: { margin: 0 } }, 'Nimbus looked for CurseForge, Prism Launcher, MultiMC, ATLauncher and Modrinth App instances. Each one you import becomes a Nimbus instance with its mods, settings, worlds and packs copied over; the original stays where it is.'),
      list),
    footer: [
      h('button.btn.ghost', { icon: 'folder', onclick: pickFolder }, 'Pick a folder…'),
      h('div.left', status),
      h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'),
      importBtn,
    ],
  });
  m.el.classList.add('im-modal');

  function draw() {
    clear(list);
    if (!found.length) {
      list.append(h('div.empty', icon('search'), h('b', 'No other launchers found'), 'If yours keeps its instances somewhere else, press Pick a folder and choose the instance (or the folder they are all in).'));
    }
    const groups = new Map();
    for (const f of found) (groups.get(f.sourceName) || groups.set(f.sourceName, []).get(f.sourceName)).push(f);
    for (const [name, items] of groups) {
      list.append(h('div.im-group', name));
      for (const f of items) {
        const on = picked.has(f.path);
        const row = h(`label.im-row${f.imported ? '.done' : ''}${on ? '.on' : ''}`,
          h('input', { type: 'checkbox', checked: on, disabled: f.imported, onchange: (e) => { if (e.target.checked) picked.add(f.path); else picked.delete(f.path); draw(); } }),
          instanceIcon({ name: f.name, icon: null }, 'sm'),
          h('div.im-main', h('b', f.name), h('span', f.path)),
          h('div.im-tags',
            h('span.tag', f.mcVersion),
            h('span.tag.accent', LOADER_NAMES[f.loader] || f.loader),
            f.mods ? h('span.tag', `${f.mods} mod${f.mods === 1 ? '' : 's'}`) : null,
            f.worlds ? h('span.tag', `${f.worlds} world${f.worlds === 1 ? '' : 's'}`) : null,
            f.imported ? h('span.tag.good', icon('check'), 'Imported') : null));
        list.append(row);
      }
    }
    importBtn.disabled = !picked.size;
    importBtn.replaceChildren(icon('download'), picked.size ? `Import ${picked.size}` : 'Import');
    status.textContent = found.length ? `${found.length} found` : '';
  }

  async function pickFolder() {
    try {
      const more = await api.importer.pick();
      if (!more) return;
      if (!more.length) { fail('Nothing to import there', new Error('That folder has no instance Nimbus can read.')); return; }
      for (const f of more) {
        if (!found.some((x) => x.path === f.path)) found.push(f);
        if (!f.imported) picked.add(f.path);
      }
      draw();
    } catch (err) { fail('Could not read that folder', err); }
  }

  importBtn.onclick = async () => {
    const folders = [...picked];
    importBtn.disabled = true;
    importBtn.replaceChildren(h('i.spinner'), 'Importing…');
    try {
      const made = await api.importer.run(folders);
      await store.refreshInstances();
      ok(made.length === 1 ? `Imported ${made[0].name}` : `Imported ${made.length} instances`, 'Nimbus is getting the game files ready in the background.');
      m.close();
    } catch (err) {
      fail('Import failed', err);
      importBtn.disabled = false;
      draw();
    }
  };

  list.append(h('div.im-loading', h('i.spinner'), 'Looking for other launchers…'));
  api.importer.scan().then((f) => {
    found = f;
    for (const x of found) if (!x.imported) picked.add(x.path);
    draw();
  }).catch((err) => { fail('Could not look for other launchers', err); found = []; draw(); });
}
