import { h, icon, clear, instanceIcon, fmtAgo, fmtDuration, fmtBytes, LOADER_NAMES, fail, ok, info, confirmDialog, segmented, toggle, rangeFill, liveProgress, taskProgress } from '../ui.js';
import { api, store } from '../store.js';
import { go, play } from '../router.js';
import { examine } from '../doctor.js';

const KINDS = [
  { key: 'mod', label: 'Mods', icon: 'box' },
  { key: 'resourcepack', label: 'Resource packs', icon: 'image' },
  { key: 'shader', label: 'Shaders', icon: 'sparkles' },
];

export function render(page, params) {
  let inst = store.instances.find((i) => i.id === params.id);
  let tab = params.tab || 'content';
  const offs = [];
  if (!inst) {
    page.appendChild(h('div.empty', h('b', 'Instance not found')));
    return null;
  }

  const head = h('div');
  const progress = h('div');
  const tabBar = h('div');
  const body = h('div');
  page.append(h('button.back', { onclick: () => go('home') }, icon('back'), 'Library'), head, progress, tabBar, body);

  let drawnHead = false;
  function drawHead() {
    // only the first draw slides in; launches and game exits redraw it in place
    head.classList.toggle('settled', drawnHead);
    drawnHead = true;
    const running = store.running.has(inst.id);
    const task = store.taskFor(inst.id);
    const playBtn = h(`button.btn.primary.play${running ? '.stop' : ''}`, { onclick: () => play(inst.id) },
      task && !running ? h('i.spinner') : icon(running ? 'stop' : 'play'), running ? 'Stop' : task ? 'Preparing…' : 'Play');
    clear(head).appendChild(h('div.inst-head', instanceIcon(inst, 'xl'),
      h('div.info',
        h('h1', inst.name),
        h('div.facts',
          h('span.tag', `Minecraft ${inst.mcVersion}`),
          h('span.tag.accent', `${LOADER_NAMES[inst.loader]}${inst.loaderVersion ? ` ${inst.loaderVersion}` : ''}`),
          h('span.tag', { icon: 'clock' }, fmtDuration(inst.playTime)),
          inst.lastPlayed ? h('span.tag', `Last played ${fmtAgo(inst.lastPlayed)}`) : null,
          inst.boost ? h('span.tag.good', { icon: 'zap' }, `${inst.boost.preset === 'max' ? 'Max FPS' : inst.boost.preset === 'potato' ? 'Potato' : 'Balanced'} boost`) : null,
          inst.modpack ? h('span.tag', { icon: 'package' }, 'Modpack') : null)),
      h('div.acts',
        h('button.btn.icon', { icon: 'folder', title: 'Open folder', onclick: () => api.instances.open(inst.id).catch((e) => fail('Could not open folder', e)) }),
        h('button.btn.icon', { icon: 'zap', title: 'FPS Boost', onclick: () => go('boost', { id: inst.id }) }),
        playBtn)));
  }

  // one progress card per task, updated in place (rebuilding it on every tick made it flicker)
  let live = null;
  function drawProgress(t) {
    if (!t || t.state !== 'running') {
      live?.dispose();
      live = null;
      clear(progress);
      return;
    }
    if (!live) {
      live = liveProgress();
      clear(progress).appendChild(h('div.progress-card', h('div.row', live.stage, live.detail), live.bar));
    }
    const detail = t.checking ? '' : t.totalBytes ? `${fmtBytes(t.bytes)} / ${fmtBytes(t.totalBytes)}` : t.total ? `${t.done} / ${t.total}` : '';
    live.update(t.stage, taskProgress(t), detail);
  }

  const tabs = segmented([
    { value: 'content', label: 'Content', icon: 'layers' },
    { value: 'settings', label: 'Settings', icon: 'sliders' },
    { value: 'console', label: 'Console', icon: 'terminal' },
  ], tab, (v) => { tab = v; drawBody(); });
  tabBar.append(h('div', { style: { margin: '6px 0 16px' } }, tabs));

  let bodyCleanup = null;
  function drawBody() {
    if (bodyCleanup) bodyCleanup();
    bodyCleanup = null;
    clear(body);
    const wrap = h('div', { style: { animation: 'fade .25s both' } });
    body.appendChild(wrap);
    if (tab === 'content') bodyCleanup = contentTab(wrap);
    else if (tab === 'settings') settingsTab(wrap);
    else bodyCleanup = consoleTab(wrap);
  }

  // ------------------------------------------------------------- content
  function contentTab(root) {
    let kind = 'mod';
    let items = [];
    let updates = store.modUpdates.get(inst.id) || [];
    let updating = false;
    const listEl = h('div.content-list');
    const updatesBtn = h('button.btn.sm', { icon: 'refresh', onclick: () => (updates.length ? updateAll() : checkUpdates(true)) });
    const drawUpdatesBtn = () => {
      updatesBtn.classList.toggle('primary', updates.length > 0);
      updatesBtn.disabled = updating;
      updatesBtn.replaceChildren(updating ? h('i.spinner') : icon('refresh'), updating ? 'Updating…' : updates.length ? `Update all (${updates.length})` : 'Check for updates');
    };
    drawUpdatesBtn();
    const sub = segmented(KINDS.map((k) => ({ value: k.key, label: k.label, icon: k.icon })), kind, (v) => { kind = v; draw(); });
    root.append(
      h('div.toolbar', sub, h('div', { style: { flex: 1 } }),
        updatesBtn,
        h('button.btn.sm', { icon: 'folder', onclick: () => api.instances.open(inst.id, { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }[kind]) }, 'Folder'),
        h('button.btn.sm', { icon: 'upload', title: 'Add files from your computer', onclick: () => addFiles(kind) }, 'Add file'),
        h('button.btn.sm.primary', { icon: 'plus', onclick: () => go('browse', { type: kind, target: inst.id }) }, 'Add content')),
      listEl);

    async function addFiles(type, paths) {
      try {
        const res = await api.content.addFiles(inst.id, type, paths);
        if (res.added.length) {
          const what = type === 'mod' ? 'mod' : type === 'shader' ? 'shader pack' : 'resource pack';
          ok(res.added.length === 1 ? `Added ${res.added[0]}` : `Added ${res.added.length} ${what}s`,
            type === 'mod' ? 'It loads the next time you play.' : 'It switches on by itself the next time you play.');
          await refresh();
        }
        if (res.skipped.length) fail(`Skipped ${res.skipped.map((x) => x.name).join(', ')}`, new Error(res.skipped[0].reason));
      } catch (err) { fail('Could not add that', err); }
    }

    // drop jars and zips anywhere on the tab: each goes where its kind belongs
    root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('dropping'); });
    root.addEventListener('dragleave', (e) => { if (e.target === root) root.classList.remove('dropping'); });
    root.addEventListener('drop', async (e) => {
      e.preventDefault();
      root.classList.remove('dropping');
      const byType = { mod: [], resourcepack: [], shader: [] };
      for (const f of e.dataTransfer?.files || []) {
        const p = api.app.pathForFile(f);
        if (!p) continue;
        if (/\.jar$/i.test(f.name)) byType.mod.push(p);
        else byType[kind === 'shader' ? 'shader' : 'resourcepack'].push(p);
      }
      for (const [type, list] of Object.entries(byType)) if (list.length) await addFiles(type, list);
    });

    function draw() {
      clear(listEl);
      const list = items.filter((i) => i.type === kind);
      if (!list.length) {
        const label = KINDS.find((k) => k.key === kind).label.toLowerCase();
        listEl.appendChild(h('div.empty', icon(KINDS.find((k) => k.key === kind).icon),
          h('b', `No ${label} yet`),
          kind === 'mod' && inst.loader === 'vanilla' ? 'Vanilla cannot load mods. Make a Fabric instance for mods.' : `Find ${label} in Browse, press Add file, or drop files here.`));
        return;
      }
      list.forEach((item, i) => {
        const upd = updates.find((u) => u.rel === item.rel);
        const pic = item.meta?.builtin ? h('div.ph.builtin', h('img', { src: 'img/logo.svg', alt: '' }))
          : item.meta?.icon ? h('img', { src: item.meta.icon, alt: '', loading: 'lazy', decoding: 'async' }) : h('div.ph', icon(KINDS.find((k) => k.key === item.type).icon));
        const row = h(`div.content-item${item.enabled ? '' : '.off'}`, { style: { animation: `rise .35s var(--ease) both ${Math.min(i, 15) * 22}ms` } },
          pic,
          h('div', { style: { minWidth: 0 } },
            h('div.t', item.meta?.title || item.file.replace(/\.(jar|zip)$/i, ''), upd ? h('button.tag.upd', { title: `Update ${item.meta?.title} to ${upd.to}`, onclick: () => updateAll([upd]) }, icon('refresh'), upd.to) : null),
            h('div.f', [item.meta?.versionNumber, item.file, fmtBytes(item.size)].filter(Boolean).join(' · '))),
          item.meta?.builtin ? h('span.tag.accent', { title: 'Nimbus Core is part of the launcher: it gives the game the Nimbus loading screen and is always on.' }, icon('lock'), 'Built in') : toggle(item.enabled, async (on) => {
            try {
              await api.content.toggle(inst.id, item.rel, on);
              item.enabled = on;
              row.classList.toggle('off', !on);
            } catch (err) { fail('Could not change that', err); }
          }),
          item.meta?.builtin ? h('span') : h('button.btn.ghost.icon.sm.danger', {
            icon: 'trash',
            title: 'Delete',
            onclick: async () => {
              if (!(await confirmDialog({ title: `Delete ${item.meta?.title || item.file}?`, message: 'The file is removed from this instance.', confirm: 'Delete', danger: true }))) return;
              try {
                await api.content.remove(inst.id, item.rel);
                row.classList.add('removing');
                setTimeout(() => { items = items.filter((x) => x !== item); draw(); }, 250);
              } catch (err) { fail('Could not delete', err); }
            },
          }));
        listEl.appendChild(row);
      });
    }

    async function refresh() {
      try {
        items = await api.content.list(inst.id);
        draw();
      } catch (err) { fail('Could not read content', err); }
    }

    async function checkUpdates(say = false) {
      if (updating) return;
      updatesBtn.disabled = true;
      updatesBtn.replaceChildren(h('i.spinner'), 'Checking');
      try {
        updates = await api.content.updates(inst.id);
        if (say && !updates.length) ok('Everything is up to date');
        draw();
      } catch (err) {
        if (say) fail('Could not check for updates', err);
      } finally {
        drawUpdatesBtn();
      }
    }

    /** Updates everything that has one (or just `only`), in one go. */
    async function updateAll(only = null) {
      const list = only || updates;
      if (!list.length || updating) return;
      updating = true;
      drawUpdatesBtn();
      try {
        await api.content.update(inst.id, list);
        ok(list.length === 1 ? `Updated ${list[0].title}` : `Updated ${list.length} things`, list.slice(0, 5).map((u) => `${u.title} ${u.from} → ${u.to}`).join('\n'));
        updates = updates.filter((u) => !list.includes(u));
        await refresh();
      } catch (err) {
        fail('Update failed', err);
      } finally {
        updating = false;
        drawUpdatesBtn();
      }
    }

    refresh().then(() => {
      // put names and icons on files that came from elsewhere, in the background
      if (items.some((i) => !i.meta)) api.content.identify(inst.id).then((n) => { if (n) refresh(); }).catch(() => {});
      // and see whether anything has a newer build (quietly: the button says so)
      if (inst.loader !== 'vanilla' || items.length) checkUpdates(false);
    });
    const off = store.on('task', (t) => { if (t.instanceId === inst.id && t.state === 'done') refresh(); });
    return off;
  }

  // ------------------------------------------------------------- settings
  function settingsTab(root) {
    const save = async (patch, quiet) => {
      try {
        inst = await api.instances.update(inst.id, patch);
        if (!quiet) ok('Saved');
        drawHead();
      } catch (err) { fail('Could not save', err); }
    };

    const nameInput = h('input.input', { value: inst.name, onchange: () => save({ name: nameInput.value.trim() || inst.name }) });

    // memory slider
    const autoMem = !inst.memory?.max;
    const memOut = h('div.mem-readout');
    const slider = rangeFill(h('input', { type: 'range', min: 1024, max: 16384, step: 256, value: inst.memory?.max || 4096, disabled: autoMem }));
    const showMem = () => {
      const v = Number(slider.value);
      const gb = v / 1024;
      const label = Number.isInteger(gb) ? String(gb) : gb.toFixed(2).replace(/0+$/, '');
      memOut.replaceChildren(slider.disabled ? 'Auto' : `${label} GB`, h('small', slider.disabled ? 'sized to your mods' : `${v} MB`));
    };
    slider.addEventListener('input', showMem);
    slider.addEventListener('change', () => save({ memory: { max: Number(slider.value) } }, true));
    showMem();
    api.boost.info(inst.id).then((b) => {
      slider.max = Math.max(2048, Math.floor(b.system.totalMB / 256) * 256);
      if (slider.disabled) slider.value = b.recommendedMemory;
      slider.dispatchEvent(new Event('input'));
    }).catch(() => {});

    const javaInput = h('input.input', { value: inst.javaPath || '', placeholder: 'Automatic — Nimbus downloads the right Java', onchange: () => save({ javaPath: javaInput.value.trim() || null }) });
    const jvmInput = h('textarea.input', { placeholder: '-XX:+UseZGC …', onchange: () => save({ jvmArgs: jvmInput.value }) });
    jvmInput.value = inst.jvmArgs || '';
    const wInput = h('input.input', { type: 'number', min: 320, placeholder: 'Width', value: inst.resolution?.width || '' });
    const hInput = h('input.input', { type: 'number', min: 240, placeholder: 'Height', value: inst.resolution?.height || '' });
    const saveRes = () => {
      const w = Number(wInput.value);
      const hh = Number(hInput.value);
      save({ resolution: w && hh ? { width: w, height: hh } : null }, true);
    };
    wInput.onchange = saveRes;
    hInput.onchange = saveRes;
    const serverInput = h('input.input', { value: inst.server || '', placeholder: 'play.example.net', onchange: () => save({ server: serverInput.value.trim() }) });

    root.append(h('div.settings-grid',
      h('div.card', h('div.setting', h('div.txt', h('b', 'Name')), h('div', { style: { width: '60%' } }, nameInput)),
        h('div.setting', h('div.txt', h('b', 'Memory'), h('span', 'More is not faster — too much makes garbage collection pauses longer.')),
          toggle(autoMem, (on) => { slider.disabled = on; showMem(); save({ memory: on ? null : { max: Number(slider.value) } }, true); }), h('span.muted', 'Auto')),
        h('div.setting', { style: { display: 'grid', gap: '10px' } }, memOut, slider)),
      h('div.card',
        h('div.setting', h('div.txt', h('b', 'Java'), h('span', 'Leave empty to use Mojang\'s runtime for this version.'))),
        h('div.setting', { style: { gap: '8px' } }, javaInput, h('button.btn.sm', { onclick: async () => { const p = await api.java.pick(); if (p) { javaInput.value = p; save({ javaPath: p }); } } }, 'Browse')),
        h('div.setting', { style: { display: 'grid', gap: '8px' } }, h('div.txt', h('b', 'Extra JVM arguments'), h('span', 'Added after Nimbus\'s own flags.')), jvmInput)),
      h('div.card',
        h('div.setting', h('div.txt', h('b', 'Window size'), h('span', 'Empty uses the game default.')), h('div.row-gap', { style: { width: '55%', flexWrap: 'nowrap' } }, wInput, hInput)),
        h('div.setting', h('div.txt', h('b', 'Start fullscreen')), toggle(Boolean(inst.fullscreen), (on) => save({ fullscreen: on }, true))),
        h('div.setting', h('div.txt', h('b', 'Join a server on launch'), h('span', 'Skips the menu and connects straight away.')), h('div', { style: { width: '50%' } }, serverInput))),
      h('div.card',
        h('div.setting', h('div.txt', h('b', 'Repair'), h('span', 'Re-checks every file by hash and reinstalls the loader.')),
          h('button.btn.sm', { icon: 'wrench', onclick: () => api.instances.repair(inst.id).then(() => ok('Repaired', `${inst.name} checks out.`)).catch((e) => fail('Repair failed', e)) }, 'Repair')),
        h('div.setting', h('div.txt', h('b', 'Duplicate'), h('span', 'Copies worlds, mods and settings.')),
          h('button.btn.sm', { icon: 'copy', onclick: async () => { try { const c = await api.instances.duplicate(inst.id); await store.refreshInstances(); go('instance', { id: c.id }); } catch (e) { fail('Could not duplicate', e); } } }, 'Duplicate')),
        h('div.setting', h('div.txt', h('b', 'Delete instance'), h('span', 'Removes worlds, mods and settings for good.')),
          h('button.btn.sm.danger', {
            icon: 'trash',
            onclick: async () => {
              if (!(await confirmDialog({ title: `Delete ${inst.name}?`, message: 'Worlds, screenshots and mods in this instance are deleted. This cannot be undone.', confirm: 'Delete forever', danger: true }))) return;
              try { await api.instances.remove(inst.id); await store.refreshInstances(); ok('Deleted', inst.name); go('home'); } catch (e) { fail('Could not delete', e); }
            },
          }, 'Delete')))));
  }

  // ------------------------------------------------------------- console
  function consoleTab(root) {
    const out = h('div.console');
    let follow = true;
    let count = 0;
    const MAX = 4000;
    out.addEventListener('scroll', () => { follow = out.scrollTop + out.clientHeight >= out.scrollHeight - 30; });
    const levelOf = (line) => {
      if (line.startsWith('[Nimbus]')) return 'NIMBUS';
      const m = line.match(/\/(INFO|WARN|ERROR|FATAL|DEBUG)\]/);
      if (m) return m[1];
      return /^\s+at |Exception|^Caused by/.test(line) ? 'ERROR' : 'INFO';
    };
    let queue = [];
    let raf = 0;
    const flush = () => {
      raf = 0;
      const frag = document.createDocumentFragment();
      for (const line of queue) frag.appendChild(h(`div.l-${levelOf(line)}`, line));
      count += queue.length;
      queue = [];
      out.appendChild(frag);
      while (count > MAX) { out.firstChild.remove(); count--; }
      if (follow) out.scrollTop = out.scrollHeight;
    };
    const push = (lines) => { queue.push(...lines); if (!raf) raf = requestAnimationFrame(flush); };

    const status = h('span.muted');
    const setStatus = () => { status.textContent = store.running.has(inst.id) ? 'Live output from the running game' : 'Output from the last session'; };
    setStatus();
    root.append(h('div.toolbar',
      status,
      h('div', { style: { flex: 1 } }),
      h('button.btn.sm', { icon: 'wrench', title: 'Look at the last crash and suggest fixes', onclick: () => examine(inst).catch((e) => fail('The crash doctor could not look', e)) }, 'Crash doctor'),
      h('button.btn.sm', { icon: 'copy', onclick: () => { navigator.clipboard.writeText(out.innerText); ok('Copied the log'); } }, 'Copy'),
      h('button.btn.sm', { icon: 'folder', onclick: () => api.instances.open(inst.id, 'logs') }, 'Logs folder'),
      h('button.btn.sm', { icon: 'x', onclick: () => { clear(out); count = 0; } }, 'Clear')), out);

    api.game.log(inst.id).then((lines) => {
      if (!lines.length) out.appendChild(h('div.l-DEBUG', 'Nothing yet — press Play and the game output shows up here.'));
      else push(lines);
    }).catch(() => {});
    const offs2 = [
      store.on('game-log', (e) => { if (e.instanceId === inst.id) push(e.lines); }),
      store.on('game-state', (e) => { if (e.instanceId === inst.id) setStatus(); }),
    ];
    return () => offs2.forEach((o) => o());
  }

  drawHead();
  drawProgress(store.taskFor(inst.id));
  drawBody();
  offs.push(store.on('task', (t) => { if (t.instanceId === inst.id) { drawProgress(t); if (t.state !== 'running') drawHead(); } }));
  offs.push(store.on('game-state', (e) => { if (e.instanceId === inst.id) drawHead(); }));
  offs.push(store.on('launching', (e) => { if (e.id === inst.id) drawHead(); }));
  offs.push(store.on('instances', () => {
    const fresh = store.instances.find((i) => i.id === inst.id);
    if (fresh) { inst = fresh; drawHead(); }
  }));
  return () => { offs.forEach((o) => o()); if (bodyCleanup) bodyCleanup(); live?.dispose(); };
}
