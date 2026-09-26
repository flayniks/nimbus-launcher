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

const THEMES = [
  ['midnight', 'Midnight', '#0b0d14'],
  ['void', 'Void', '#000000'],
  ['nebula', 'Nebula', '#0d0918'],
  ['ocean', 'Ocean', '#06111b'],
  ['forest', 'Forest', '#07120d'],
  ['ember', 'Ember', '#120a08'],
];

const BACKGROUNDS = [
  ['aurora', 'Aurora', 'Slow colour clouds'],
  ['stars', 'Starfield', 'Drifting, twinkling stars'],
  ['grid', 'Neon grid', 'A glowing floor into the distance'],
  ['solid', 'Plain', 'Just the theme colour'],
  ['image', 'Your picture', 'Any picture from your computer'],
];

const SECTIONS = [
  ['general', 'General', 'settings', 'Updates, what happens when you play, and storage.'],
  ['appearance', 'Appearance', 'palette', 'Make Nimbus look the way you like.'],
  ['animations', 'Animations', 'sparkles', 'Every animation, in the launcher, the launch splash and the game.'],
  ['downloads', 'Downloads', 'download', 'How Nimbus fetches files.'],
  ['java', 'Java', 'cpu', 'The Java runtimes on this computer.'],
  ['advanced', 'Advanced', 'wrench', 'Settings most people never need.'],
];

const SPEEDS = [['relaxed', 'Relaxed'], ['normal', 'Normal'], ['snappy', 'Snappy']];

let lastSection = 'general';

export function render(page) {
  const s = () => store.settings;
  const save = async (patch) => {
    try {
      store.settings = await api.settings.set(patch);
      applyLook(store.settings);
      if ('showCounter' in patch || 'shareOnline' in patch) store.presence?.refresh();
    } catch (err) { fail('Could not save', err); }
  };

  // a row: title and description on the left, a control on the right
  const row = (title, desc, control) => h('div.setting', h('div.txt', h('b', title), desc ? h('span', desc) : null), control || null);
  const card = (...rows) => h('div.card', ...rows);
  const onOff = (key, fallback = true) => toggle(s()[key] === undefined ? fallback : s()[key] !== false, (on) => save({ [key]: on }));
  const seg = (key, options, fallback, cast = String) =>
    segmented(options.map(([value, label]) => ({ value: String(value), label })), String(s()[key] ?? fallback), (v) => save({ [key]: cast(v) }));
  const slider = (key, { min, max, step, fallback, unit, live }) => {
    const input = rangeFill(h('input', { type: 'range', min, max, step, value: s()[key] ?? fallback }));
    const out = h('b', `${input.value}${unit}`);
    input.addEventListener('input', () => { out.textContent = `${input.value}${unit}`; live?.(Number(input.value)); });
    input.addEventListener('change', () => save({ [key]: Number(input.value) }));
    return h('div.range-row', { style: { width: '260px', maxWidth: '100%' } }, input, out);
  };

  let offUpdate = () => {};

  // ---------------------------------------------------------------- general
  function general(root) {
    const version = h('b', 'Nimbus Launcher');
    api.app.info().then((i) => { version.textContent = `Nimbus Launcher ${i.version}`; }).catch(() => {});
    const updStatus = h('span');
    const updBtn = h('button.btn.sm', { icon: 'refresh' }, 'Check now');
    const drawUpdate = () => {
      const u = store.update || {};
      updStatus.textContent = {
        disabled: u.message,
        checking: 'Checking for updates…',
        current: 'You have the newest version. Nimbus checks every time it opens.',
        downloading: `Downloading ${u.version || 'update'} — ${Math.round(u.percent || 0)}%`,
        ready: `Version ${u.version} is downloaded. Restart to use it, or it installs when you close Nimbus.`,
        error: `Could not check: ${u.message}`,
      }[u.state] || 'Checks every time Nimbus opens, and every few hours.';
      updBtn.replaceChildren(icon(u.state === 'ready' ? 'zap' : 'refresh'), u.state === 'ready' ? 'Restart & update' : 'Check now');
      updBtn.classList.toggle('primary', u.state === 'ready');
      updBtn.disabled = u.state === 'checking' || u.state === 'downloading' || u.state === 'disabled';
    };
    updBtn.onclick = async () => {
      try {
        if (store.update.state === 'ready') await api.updates.install();
        else {
          const u = await api.updates.check();
          if (u.state === 'current') ok('No update right now', `Nimbus ${u.current} is the newest version.`);
        }
      } catch (err) { fail('Could not check for updates', err); }
    };
    drawUpdate();
    offUpdate = store.on('update', drawUpdate);

    const cacheOut = h('span', '…');
    const loadCache = async () => {
      try { cacheOut.textContent = fmtBytes(await api.cache.size()); } catch { cacheOut.textContent = '?'; }
    };
    loadCache();

    root.append(
      card(h('div.setting', h('div.txt', version, updStatus), updBtn)),
      card(
        row('When the game starts', 'Hiding the launcher frees memory and GPU time for Minecraft.'),
        h('div.setting', seg('onLaunch', [['hide', 'Hide launcher'], ['keep', 'Keep open'], ['close', 'Close launcher']], 'hide'))),
      h('div.group-title', 'Player counter'),
      card(
        row('Show the counter', 'How many people have Nimbus open, are playing, and have installed it — at the top of the window.', onOff('showCounter')),
        row('Count me', 'Adds you to those numbers. Nothing about you is sent, it only bumps anonymous counters.', onOff('shareOnline'))),
      h('div.group-title', 'Storage'),
      card(
        row('Data folder', h('span', { style: { userSelect: 'text' } }, s().dataDir), h('button.btn.sm', { icon: 'folder', onclick: () => api.app.openData() }, 'Open')),
        row('Download cache', 'Installers and modpack archives. Safe to clear.', h('div.row-gap', cacheOut,
          h('button.btn.sm', { icon: 'trash', onclick: async () => {
            if (!(await confirmDialog({ title: 'Clear the cache?', message: 'Installers and downloaded modpack files are removed. Instances are not touched.', confirm: 'Clear' }))) return;
            await api.cache.clear(); ok('Cache cleared'); loadCache();
          } }, 'Clear')))));
  }

  // ---------------------------------------------------------------- appearance
  function appearance(root) {
    const themes = h('div.choice-grid');
    const drawThemes = () => {
      clear(themes);
      for (const [id, name, bg] of THEMES) {
        const on = (s().theme || 'midnight') === id;
        const b = h(`button.choice${on ? '.on' : ''}`, { onclick: async () => { await save({ theme: id }); drawThemes(); } },
          h('div.swatch', { style: { background: `radial-gradient(120% 90% at 20% 0%, color-mix(in srgb, var(--a1) 35%, ${bg}), ${bg} 70%)` } },
            h('span.check', icon('check'))),
          name);
        b.dataset.theme = id;
        themes.appendChild(b);
      }
    };
    drawThemes();

    const accents = h('div.accent-row');
    const a1In = h('input.color-in', { type: 'color', value: s().customA1 || '#7c5cff', title: 'First colour' });
    const a2In = h('input.color-in', { type: 'color', value: s().customA2 || '#c084fc', title: 'Second colour' });
    const useCustom = () => save({ accent: 'custom', customA1: a1In.value, customA2: a2In.value }).then(drawAccents);
    const preview = () => {
      document.documentElement.style.setProperty('--a1', a1In.value);
      document.documentElement.style.setProperty('--a2', a2In.value);
    };
    for (const input of [a1In, a2In]) {
      input.addEventListener('input', preview);
      input.addEventListener('change', useCustom);
    }
    function drawAccents() {
      clear(accents);
      for (const [id, a, b] of ACCENTS) {
        const on = (s().accent || 'violet') === id;
        const dot = h(`button.accent-dot${on ? '.on' : ''}`, {
          title: id, style: { background: `linear-gradient(135deg, ${a}, ${b})` },
          onclick: async () => { await save({ accent: id }); drawAccents(); },
        });
        dot.dataset.accent = id;
        accents.appendChild(dot);
      }
      const custom = s().accent === 'custom';
      accents.append(h('span.muted', { style: { marginLeft: '10px', fontSize: '12.5px' } }, 'Your own'), a1In, a2In,
        custom ? h('span.tag.accent', 'In use') : h('button.btn.sm.ghost', { onclick: useCustom }, 'Use these'));
    }
    drawAccents();

    const bgs = h('div.choice-grid');
    const bgExtra = h('div');
    const backdrop = () => document.getElementById('backdrop');
    async function pickPicture() {
      try {
        const next = await api.look.pickBackground();
        if (!next) return;
        store.settings = next;
        applyLook(store.settings);
        drawBgs();
      } catch (err) { fail('Could not use that picture', err); }
    }
    function drawBgs() {
      clear(bgs);
      for (const [id, name, desc] of BACKGROUNDS) {
        const on = (s().background || 'aurora') === id;
        const b = h(`button.choice${on ? '.on' : ''}`, {
          title: desc,
          onclick: async () => {
            if (id === 'image' && !s().bgImage) return pickPicture();
            await save({ background: id });
            drawBgs();
          },
        }, h('div.swatch', { style: { background: previewFor(id) } }, h('span.check', icon('check'))), name);
        b.dataset.bg = id;
        bgs.appendChild(b);
      }
      clear(bgExtra);
      if (s().background === 'image') {
        bgExtra.append(card(
          row('Picture', 'Shown behind everything. Blur and darken it so text stays easy to read.', h('button.btn.sm', { icon: 'image', onclick: pickPicture }, 'Change')),
          row('Blur', null, slider('bgBlur', { min: 0, max: 30, step: 1, fallback: 8, unit: 'px', live: (v) => backdrop()?.style.setProperty('--bg-blur', `${v}px`) })),
          row('Darken', null, slider('bgDim', { min: 0, max: 90, step: 5, fallback: 45, unit: '%', live: (v) => backdrop()?.style.setProperty('--bg-dim', String(v / 100)) }))));
      }
    }
    drawBgs();

    root.append(
      h('div.group-title', 'Theme'), themes,
      h('div.group-title', 'Accent colour'), card(h('div.setting', accents)),
      h('div.group-title', 'Background'), bgs, bgExtra,
      h('div.group-title', 'Surfaces'),
      card(
        row('Glass', 'Frosted, see-through bars and panels.', onOff('glass')),
        row('Frost', 'How strongly the glass blurs what is behind it.',
          slider('glassBlur', { min: 4, max: 32, step: 2, fallback: 16, unit: 'px', live: (v) => document.documentElement.style.setProperty('--glass-blur', `${v}px`) })),
        row('Cards', null, seg('cardStyle', [['glass', 'Glass'], ['solid', 'Solid'], ['outline', 'Outline']], 'glass')),
        row('Corners', null, seg('radius', [['sharp', 'Sharp'], ['rounded', 'Rounded'], ['round', 'Round']], 'rounded'))),
      h('div.group-title', 'Layout'),
      card(
        row('Size', 'Makes everything in the launcher bigger or smaller.', seg('uiScale', [[90, '90%'], [100, '100%'], [110, '110%'], [125, '125%']], 100, Number)),
        row('Sidebar labels', 'Names next to the sidebar icons.', onOff('sidebarLabels', false))),
      h('div', h('button.btn.sm.ghost', { icon: 'refresh', onclick: async () => {
        await save({ theme: 'midnight', accent: 'violet', background: 'aurora', glass: true, glassBlur: 16, cardStyle: 'glass', radius: 'rounded', uiScale: 100, sidebarLabels: false });
        show('appearance');
      } }, 'Back to the default look')));
  }

  function previewFor(id) {
    switch (id) {
      case 'aurora': return 'radial-gradient(60% 80% at 20% 20%, color-mix(in srgb, var(--a1) 70%, transparent), transparent), radial-gradient(60% 80% at 80% 80%, color-mix(in srgb, var(--a2) 60%, transparent), transparent), var(--bg)';
      case 'stars': return 'radial-gradient(1.5px 1.5px at 20% 30%, #fff, transparent), radial-gradient(1.5px 1.5px at 60% 70%, var(--a2), transparent), radial-gradient(2px 2px at 80% 20%, var(--a1), transparent), radial-gradient(1px 1px at 40% 80%, #fff, transparent), radial-gradient(1px 1px at 88% 60%, #fff, transparent), var(--bg)';
      case 'grid': return 'linear-gradient(transparent 55%, color-mix(in srgb, var(--a1) 30%, transparent)), repeating-linear-gradient(90deg, color-mix(in srgb, var(--a1) 45%, transparent) 0 1px, transparent 1px 14px), var(--bg)';
      case 'image': return 'linear-gradient(135deg, #475569, #1e293b 60%, #0f172a)';
      default: return 'var(--bg)';
    }
  }

  // ---------------------------------------------------------------- animations
  function animations(root) {
    const demo = h('div.preview-strip', h('div.demo'), h('div.demo'), h('div.demo'),
      h('span.muted', { style: { fontSize: '12.5px', marginLeft: '6px' } }, 'Hover the cards on Home and Browse to see the hover effect.'));
    const replay = () => {
      for (const [i, d] of [...demo.querySelectorAll('.demo')].entries()) {
        d.style.animation = 'none';
        void d.offsetWidth;
        d.style.animation = `rise .5s var(--ease) ${i * 80}ms both`;
      }
    };
    root.append(
      h('div.group-title', 'Launcher'),
      card(
        row('Animations', 'Everything that moves in the launcher. Off is the lightest.', toggle(s().animations !== false, async (on) => { await save({ animations: on }); replay(); })),
        row('Speed', null, segmented(SPEEDS.map(([value, label]) => ({ value, label })), s().animSpeed || 'normal', async (v) => { await save({ animSpeed: v }); replay(); })),
        row('Page change', 'How a page appears when you switch to it.', seg('pageTransition', [['rise', 'Rise'], ['fade', 'Fade'], ['slide', 'Slide'], ['zoom', 'Zoom'], ['none', 'None']], 'rise')),
        row('Lists slide in', 'Cards and rows appear one after another.', onOff('stagger')),
        row('Hover', 'What a card does under the mouse.', seg('hoverEffect', [['lift', 'Lift'], ['tilt', 'Tilt'], ['glow', 'Glow'], ['none', 'None']], 'lift')),
        row('Moving background', 'The background drifts slowly. It always rests while you play.', onOff('bgMotion'))),
      demo,
      h('div.group-title', 'Launch splash'),
      card(
        row('Show the splash', 'The animated Nimbus window from Play until the game opens.', onOff('splash')),
        row('Style', null, seg('splashStyle', [['cube', 'Cube'], ['minimal', 'Minimal']], 'cube')),
        row('Particles', 'Sparks rising behind it.', onOff('splashParticles'))),
      h('div.group-title', 'In the game'),
      card(
        row('Nimbus loading screen', 'Off shows the normal Mojang loading screen instead.', onOff('gameLoading')),
        row('Particles', 'Sparks on the loading screen and behind the Nimbus menus.', onOff('gameParticles')),
        row('Spinning cube', 'The Nimbus cube turns on the loading screen.', onOff('gameCube')),
        row('Speed', null, seg('gameAnimSpeed', SPEEDS, 'normal')),
        row('Title screen badge', 'The Nimbus badge in the corner of the title screen.', onOff('gameBadge')),
        row('Moving menus', 'The drifting glow behind Skins & Capes and Nimbus Features.', onOff('gameMenuMotion'))),
      h('div.muted', { style: { fontSize: '12.5px', display: 'flex', gap: '8px', alignItems: 'center' } }, icon('info'),
        'In-game options are for Fabric and Quilt instances (through Nimbus Core) and apply the next time the game starts.'));
  }

  // ---------------------------------------------------------------- downloads
  function downloads(root) {
    root.append(card(
      row('Parallel downloads', 'More is faster on good connections.', slider('concurrency', { min: 4, max: 48, step: 2, fallback: 16, unit: '' }))));
  }

  // ---------------------------------------------------------------- java
  function java(root) {
    const javaList = h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '6px', minWidth: 0, width: '100%' } });
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
    root.append(card(
      row('Java installs found', 'Nimbus downloads the right Java per version by itself; these are for custom setups.', h('button.btn.sm', { icon: 'refresh', onclick: loadJava }, 'Scan')),
      h('div.setting', { style: { minWidth: 0 } }, javaList)));
    loadJava();
  }

  // ---------------------------------------------------------------- advanced
  function advanced(root) {
    const clientId = h('input.input', { value: s().msClientId || '', placeholder: 'Leave empty to use the default', onchange: () => save({ msClientId: clientId.value.trim() }) });
    root.append(card(
      row('Microsoft app client ID', 'Use your own Azure app (it must be approved for the Minecraft API).'),
      h('div.setting', clientId)));
  }

  // ---------------------------------------------------------------- shell
  const builders = { general, appearance, animations, downloads, java, advanced };
  const nav = h('nav.settings-nav');
  const body = h('div', { style: { minWidth: 0 } });
  const navButtons = SECTIONS.map(([id, label, ic]) => {
    const b = h('button', { onclick: () => show(id) }, icon(ic), label);
    b.dataset.section = id;
    nav.appendChild(b);
    return b;
  });

  function show(id) {
    lastSection = id;
    offUpdate();
    offUpdate = () => {};
    navButtons.forEach((b) => b.classList.toggle('on', b.dataset.section === id));
    const [, label, , lead] = SECTIONS.find((x) => x[0] === id);
    const section = h('div.settings-section', h('h2', label), h('p.lead', lead));
    section.dataset.section = id;
    builders[id](section);
    clear(body).appendChild(section);
  }

  page.append(
    h('div.page-head', h('div', h('h1', 'Settings'), h('p', 'How the launcher behaves, looks and moves.'))),
    h('div.settings-shell', nav, body),
    h('div.muted', { style: { marginTop: '26px', fontSize: '12.5px', display: 'flex', gap: '8px', alignItems: 'center' } }, icon('info'),
      h('span', 'Nimbus Launcher · not affiliated with Mojang or Microsoft. Mods, packs and shaders come from ', h('a', { href: 'https://modrinth.com' }, 'Modrinth'), '.')),
  );
  show(lastSection);
  return () => offUpdate();
}
