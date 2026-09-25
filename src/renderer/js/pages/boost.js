import { h, icon, clear, fail, ok, LOADER_NAMES, toggle, confirmDialog } from '../ui.js';
import { api, store } from '../store.js';
import { go } from '../router.js';
import { openProject } from '../project.js';

const PRESET_ICONS = { potato: 'feather', balanced: 'scale', max: 'rocket' };

let gpuCache = null;

export function render(page, params = {}) {
  let inst = store.instances.find((i) => i.id === params.id) || store.instances[0] || null;
  let presetId = inst?.boost?.preset || 'balanced';
  const opts = { mods: true, jvm: true, memory: true, video: true, priority: true, gpu: api.platform === 'win32' };

  page.appendChild(h('div.page-head',
    h('div', h('h1', 'FPS Boost'), h('p', 'One click tunes mods, Java, memory and video settings for smoother frames.'))));

  if (!inst) {
    page.appendChild(h('div.empty', icon('zap'), h('b', 'No instances yet'), 'Create an instance first, then come back to boost it.'));
    return null;
  }

  const instSel = h('select.select', { style: { width: '260px' }, onchange: () => { inst = store.instances.find((i) => i.id === instSel.value); presetId = inst.boost?.preset || 'balanced'; refresh(); } },
    store.instances.map((i) => h('option', { value: i.id, selected: i.id === inst.id }, `${i.name} · ${i.mcVersion} ${LOADER_NAMES[i.loader]}`)));
  page.querySelector('.page-head').append(h('div.spacer'), instSel);

  const top = h('div.boost-top');
  const presetsEl = h('div.presets');
  const optsCard = h('div.card.opt-list');
  const actions = h('div.boost-go');
  const stepsEl = h('div.steps');
  const extra = h('div');
  page.append(top, h('h2.section', 'Choose a preset'), presetsEl, h('h2.section', 'What to tune'), optsCard, actions, stepsEl, extra);

  let info = null;
  let perfPresent = 0;

  function score() {
    // how much of what we can tune on this instance is tuned — not a made-up FPS number
    const b = inst.boost;
    const parts = [
      { label: 'Tuned garbage collector', on: Boolean(b && b.jvm && b.jvm !== 'vanilla'), w: 20 },
      { label: 'Right-sized memory', on: Boolean(inst.memory?.max), w: 15 },
      { label: 'Lean video settings', on: Boolean(b?.video), w: 20 },
      { label: 'Raised process priority', on: Boolean(b && b.priority !== 'normal'), w: 10 },
    ];
    if (inst.loader !== 'vanilla') {
      const groups = info.perfMods.length;
      // not every mod has a build for every version, so half the groups already counts as done
      parts.unshift({ label: `Performance mods (${perfPresent}/${groups})`, on: perfPresent * 2 >= groups, w: 35, partial: Math.min(1, (perfPresent * 2) / groups) });
    }
    const total = parts.reduce((n, p) => n + p.w, 0);
    const got = parts.reduce((n, p) => n + (p.on ? p.w : (p.partial || 0) * p.w), 0);
    return { pct: Math.round((got / total) * 100), parts };
  }

  function drawTop() {
    clear(top);
    const sys = info.system;
    const gpu = gpuCache || { name: 'Detecting…' };
    top.append(
      h('div.card.pad', h('div.row-gap', { style: { marginBottom: '14px' } }, h('b', 'Your PC'), h('span.muted', { style: { fontSize: '12px' } }, `${sys.platform} · ${sys.arch}`)),
        h('div.sys',
          h('div.cell', h('span', icon('cpu'), 'Processor'), h('b', { title: sys.cpu }, sys.cpu)),
          h('div.cell', h('span', icon('layers'), 'Threads'), h('b', `${sys.cores}`)),
          h('div.cell', h('span', icon('memory'), 'Memory'), h('b', `${(sys.totalMB / 1024).toFixed(1)} GB · ${(sys.freeMB / 1024).toFixed(1)} GB free`)),
          h('div.cell', h('span', icon('monitor'), 'Graphics'), h('b', { title: gpu.name }, gpu.name)))),
      gaugeCard());
  }

  function gaugeCard() {
    const { pct, parts } = score();
    const r = 62;
    const circ = 2 * Math.PI * r;
    const val = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    val.setAttribute('class', 'val');
    val.setAttribute('cx', 75); val.setAttribute('cy', 75); val.setAttribute('r', r);
    val.setAttribute('stroke-dasharray', circ);
    val.setAttribute('stroke-dashoffset', circ);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 150 150');
    svg.innerHTML = `<circle class="track" cx="75" cy="75" r="${r}"/>`;
    svg.appendChild(val);
    const num = h('b', '0');
    requestAnimationFrame(() => requestAnimationFrame(() => { val.setAttribute('stroke-dashoffset', circ * (1 - pct / 100)); }));
    // count up alongside the ring
    const start = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - start) / 1000);
      num.textContent = Math.round(pct * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return h('div.card.pad.boost-score',
      h('div.gauge', svg, h('div.num', h('div', num, h('span', '%')), h('span', 'tuned'))),
      h('div.list', h('b', { style: { marginBottom: '2px' } }, inst.boost ? 'Boost is on' : 'Not boosted yet'),
        parts.map((p) => h('div', h(`span.${p.on ? 'ok' : 'no'}`, icon(p.on ? 'check' : 'x')), p.label))));
  }

  function drawPresets() {
    clear(presetsEl);
    for (const [id, p] of Object.entries(info.presets)) {
      presetsEl.appendChild(h(`button.preset${id === presetId ? '.on' : ''}`, { type: 'button', onclick: () => { presetId = id; drawPresets(); } },
        h('div.check', icon('check')),
        h('div.pi', icon(PRESET_ICONS[id])),
        h('b', p.name), h('p', p.blurb),
        h('div.row-gap', { style: { marginTop: '10px' } },
          h('span.tag', `${p.video.render} chunks`),
          h('span.tag', p.video.graphics ? 'Fancy' : 'Fast'),
          h('span.tag', p.jvm === 'auto' ? 'ZGC / G1' : 'G1 tuned'))));
    }
  }

  function drawOptions() {
    clear(optsCard);
    const vanilla = inst.loader === 'vanilla';
    const rows = [
      ['mods', 'box', 'Install performance mods', vanilla ? 'Vanilla cannot load mods. A Fabric copy of this instance gets the biggest boost.' : 'Sodium or Embeddium, Lithium, FerriteCore, EntityCulling, ImmediatelyFast, ModernFix and friends — whatever has a build for this version.', vanilla],
      ['jvm', 'coffee', 'Optimized garbage collector', 'Tuned G1, or generational ZGC on Java 21+ with plenty of RAM, for fewer stutters.'],
      ['memory', 'memory', 'Smart memory', `Sets ${(info.recommendedMemory / 1024).toFixed(info.recommendedMemory % 1024 ? 1 : 0)} GB for ${info.modCount} mod${info.modCount === 1 ? '' : 's'} — enough, without starving the OS.`],
      ['video', 'eye', 'Lean video settings', 'Render/simulation distance, particles, clouds, shadows, mipmaps and VSync off. Your old options.txt is backed up.'],
      ['priority', 'gauge', 'Higher process priority', 'Asks the OS to schedule Minecraft first. Needs admin rights on Linux/macOS, skipped quietly otherwise.'],
      ['gpu', 'monitor', 'Use the dedicated GPU', api.platform === 'win32' ? 'On laptops with two GPUs, tells Windows to run Java on the fast one.' : 'Windows only.', api.platform !== 'win32'],
    ];
    for (const [key, ic, title, desc, disabled] of rows) {
      optsCard.appendChild(h('div.setting', h('div.ic', icon(ic)), h('div.txt', h('b', title), h('span', desc)),
        toggle(opts[key] && !disabled, (on) => { opts[key] = on; }, { disabled })));
    }
  }

  function drawActions() {
    clear(actions);
    const go1 = h('button.btn.primary.play', { icon: 'zap' }, inst.boost ? 'Re-apply boost' : 'Boost now');
    go1.onclick = async () => {
      go1.disabled = true;
      go1.replaceChildren(h('i.spinner'), 'Boosting…');
      clear(stepsEl);
      const off = store.on('boost-step', (s) => {
        if (s.instanceId !== inst.id || s.id !== 'mod') return;
        stepsEl.appendChild(stepRow(s));
      });
      try {
        const res = await api.boost.apply(inst.id, presetId, { ...opts, mods: opts.mods && inst.loader !== 'vanilla' });
        for (const s of res.steps.filter((x) => x.id !== 'mods')) stepsEl.appendChild(stepRow(s));
        await store.refreshInstances();
        inst = store.instances.find((i) => i.id === inst.id) || res.instance;
        ok('Boost applied', `${inst.name} is tuned. Press Play to feel the difference.`);
        await refresh(true);
      } catch (err) {
        fail('Boost failed', err);
      } finally {
        off();
        go1.disabled = false;
        go1.replaceChildren(icon('zap'), 'Re-apply boost');
      }
    };
    const revert = inst.boost ? h('button.btn.ghost', { icon: 'refresh', onclick: async () => {
      if (!(await confirmDialog({ title: 'Turn the boost off?', message: 'Java flags, memory and priority go back to defaults and your original options.txt is restored. Performance mods stay installed.', confirm: 'Revert' }))) return;
      try {
        await api.boost.revert(inst.id);
        await store.refreshInstances();
        inst = store.instances.find((i) => i.id === inst.id);
        ok('Boost removed');
        clear(stepsEl);
        refresh();
      } catch (err) { fail('Could not revert', err); }
    } }, 'Revert') : null;
    actions.append(h('span.muted', { style: { marginRight: 'auto', fontSize: '12.5px' } }, 'Changes apply next time you press Play.'), revert, go1);
  }

  function stepRow(s) {
    const st = s.status;
    const ic = st === 'failed' ? 'x' : st === 'skipped' || st === 'unavailable' ? 'info' : 'check';
    const word = { installed: 'Added', present: 'Already there', unavailable: 'Not available', skipped: 'Skipped', failed: 'Failed', done: 'Done' }[st] || st;
    return h(`div.step.${st}`, h('div.s-ic', icon(ic)), h('div.grow', h('b', s.label), s.detail ? h('span', s.detail) : null), h('span.tag', word));
  }

  function drawExtra() {
    clear(extra);
    extra.appendChild(h('div.card.pad.row-gap', { style: { marginTop: '22px' } },
      h('div', { style: { flex: 1, minWidth: '240px' } },
        h('b', 'Want a ready-made fast setup?'),
        h('div.muted', { style: { fontSize: '12.5px' } }, 'Fabulously Optimized is a popular modpack built entirely around performance and good looks.')),
      h('button.btn', { icon: 'package', onclick: () => openProject('fabulously-optimized') }, 'View modpack'),
      inst.loader === 'vanilla' ? h('button.btn', { icon: 'plus', onclick: () => go('home') }, 'Make a Fabric instance') : null));
  }

  async function refresh(keepSteps) {
    try {
      info = await api.boost.info(inst.id);
      inst = info.instance;
      perfPresent = 0;
      if (inst.loader !== 'vanilla') {
        const content = await api.content.list(inst.id).catch(() => []);
        const names = content.filter((c) => c.type === 'mod' && c.enabled).map((c) => `${c.meta?.slug || ''} ${c.file}`.toLowerCase());
        const has = (id) => names.some((n) => n.includes(id) || n.includes(id.replace('-', '')));
        perfPresent = info.perfMods.filter((g) => g.ids.some(has)).length;
      }
      drawTop();
      drawPresets();
      drawOptions();
      drawActions();
      drawExtra();
      if (!keepSteps) clear(stepsEl);
    } catch (err) {
      fail('Could not read this instance', err);
    }
  }

  refresh();
  if (!gpuCache) api.boost.gpu().then((g) => { gpuCache = g; if (info) drawTop(); }).catch(() => {});
  return null;
}
