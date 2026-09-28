// The crash doctor's window: what happened, in plain words, which mod did it, and fixes to press.
import { h, icon, fail, ok, modal } from './ui.js';
import { api } from './store.js';
import { go, play } from './router.js';

const KIND_ICON = {
  'missing-dependency': 'package', 'missing-library': 'package', 'wrong-version': 'layers', 'wrong-loader': 'layers',
  duplicate: 'copy', incompatible: 'x', 'dependency-version': 'layers', mixin: 'wrench', memory: 'memory', 'memory-too-much': 'memory', killed: 'memory',
  java: 'cpu', graphics: 'monitor', config: 'settings', suspect: 'alert', unknown: 'alert',
};

/** Shows a diagnosis for an instance. `inst` is the instance, `d` what the doctor found. */
export function showDoctor(inst, d, { crashFile = null } = {}) {
  let fixedSomething = false;
  const fixes = h('div.dr-fixes');
  const again = h('button.btn.primary', { icon: 'play', style: { display: 'none' } }, 'Play again');
  const m = modal({
    title: 'Crash doctor',
    body: h('div.dr',
      h('div.dr-head',
        h('span.dr-icon', icon(KIND_ICON[d.kind] || 'alert')),
        h('div', h('span.dr-kicker', `${inst?.name || 'Minecraft'} crashed`), h('h2', d.title))),
      h('p.dr-explain', d.explain),
      d.culprits?.length ? h('div.dr-culprits', h('span', d.culprits.length > 1 ? 'Mods involved:' : 'To blame:'), ...d.culprits.map((c) => h('span.tag.warn', icon('package'), c.name))) : null,
      d.fixes?.length ? h('div.dr-label', 'Fix it') : null,
      fixes,
      d.also?.length ? h('div.dr-also', h('span', 'Also noticed:'), h('ul', ...d.also.map((a) => h('li', a)))) : null,
      d.evidence ? h('details.dr-evidence', h('summary', 'What the game said'), h('pre', d.evidence)) : null),
    footer: [
      crashFile || d.crashFile ? h('button.btn.ghost', { icon: 'external', onclick: () => api.game.openCrash(crashFile || d.crashFile).catch((e) => fail('Could not open it', e)) }, 'Crash report') : null,
      h('button.btn.ghost', { icon: 'terminal', onclick: () => { m.close(); go('instance', { id: inst.id, tab: 'console' }); } }, 'Log'),
      h('div', { style: { flex: 1 } }),
      h('button.btn', { onclick: () => m.close() }, 'Close'),
      again,
    ],
  });
  m.el.classList.add('dr-modal');
  again.onclick = () => { m.close(); play(inst.id); };

  for (const fx of d.fixes || []) {
    const btn = h('button.btn.dr-fix', { icon: fx.kind === 'install' ? 'plus' : fx.kind === 'disable' ? 'x' : fx.kind === 'update' ? 'refresh' : fx.kind === 'link' ? 'external' : fx.kind === 'memory' ? 'memory' : 'wrench' }, fx.label);
    btn.onclick = async () => {
      if (fx.kind === 'link') { api.app.external(fx.url).catch(() => {}); return; }
      btn.disabled = true;
      btn.replaceChildren(h('i.spinner'), fx.label);
      try {
        const r = await api.doctor.fix(inst.id, fx);
        btn.replaceChildren(icon('check'), `${fx.label}: done`);
        btn.classList.add('done');
        fixedSomething = true;
        again.style.display = '';
        if (r?.warnings?.length) ok('Done, with a note', r.warnings.join('\n'));
      } catch (err) {
        btn.disabled = false;
        btn.replaceChildren(icon('alert'), fx.label);
        fail('That fix didn\'t work', err);
      }
    };
    fixes.append(btn);
  }
  return { close: () => m.close(), get fixed() { return fixedSomething; } };
}

/** The console's "Crash doctor" button: looks at the newest crash of an instance. */
export async function examine(inst) {
  const d = await api.doctor.examine(inst.id);
  if (!d) {
    ok('Nothing wrong found', 'No crash report, and the last log looks fine.');
    return;
  }
  showDoctor(inst, d);
}
