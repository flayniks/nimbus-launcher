/* global DOMPurify */
// Maps: CurseForge's Worlds section, through the Nimbus service. A map unpacks into an instance's
// worlds, so it shows up in Singleplayer. Worlds open in the version they were made for or a
// newer one, so the instance picked first is one that's new enough.
import { h, icon, clear, modal, fail, ok, info, fmtNumber, fmtBytes, fmtAgo, segmented } from './ui.js';
import { api, store } from './store.js';
import { play } from './router.js';

/** -1, 0 or 1 for two release versions ("1.20.4" < "1.21"); null when either isn't one. */
export function cmpVersion(a, b) {
  const re = /^\d+(\.\d+)*$/;
  if (!re.test(a || '') || !re.test(b || '')) return null;
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The oldest version a map is made for. */
const oldest = (versions) => [...(versions || [])].sort((a, b) => cmpVersion(a, b) ?? 0)[0] || null;

/** Whether a map made for `versions` opens in this instance (unknown counts as yes). */
export function opensIn(versions, inst) {
  const v = oldest(versions);
  const c = v ? cmpVersion(inst.mcVersion, v) : null;
  return c === null || c >= 0;
}

/** The instance to offer first: the picked one, else the newest one the map opens in. */
export function bestInstance(versions, preferId) {
  const list = store.instances;
  const picked = list.find((i) => i.id === preferId);
  if (picked) return picked;
  return list.filter((i) => opensIn(versions, i)).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0] || list[0] || null;
}

/** The file to install for an instance: the newest one made for its version or older, else the newest. */
export function bestFile(files, inst) {
  const usable = files.filter((f) => f.downloadable);
  const fitting = usable.filter((f) => !f.versions.length || f.versions.some((v) => (cmpVersion(inst.mcVersion, v) ?? 1) >= 0));
  return fitting[0] || usable[0] || null;
}

/** Signed out, the service without its key, or a real error: what the page should say. */
export function mapsProblem(err) {
  const msg = String(err?.message || err || '');
  if (/isn't set up|not set up/i.test(msg)) return { kind: 'setup', title: 'Map search is coming soon', text: 'You can already add a map you downloaded: press Add map file and pick its .zip.' };
  if (/sign in|microsoft account/i.test(msg)) return { kind: 'signin', title: 'Sign in to search maps', text: 'Map search uses your Nimbus sign-in. Add your Microsoft account on the Accounts page.' };
  return { kind: 'error', title: 'Maps did not load', text: msg };
}

/** Downloads a map file into an instance and says how it went. */
export async function installMap(map, file, inst) {
  try {
    const got = await api.maps.install(inst.id, map.id, file.id);
    const names = got.map((w) => w.name);
    ok(got.length > 1 ? `${got.length} worlds added to ${inst.name}` : `${map.name} is in ${inst.name}`, `Open Singleplayer to play ${names.length > 1 ? 'them' : `“${names[0]}”`}.`, {
      actions: [{ label: 'Play', run: () => play(inst.id) }],
    });
    if (!opensIn(file.versions, inst)) info('Heads up', `This map was made for Minecraft ${oldest(file.versions)}, newer than ${inst.mcVersion}. It may not open.`);
    return got;
  } catch (err) {
    fail(`Could not install ${map.name}`, err);
    return null;
  }
}

function sanitize(html) {
  const div = h('div.markdown');
  try {
    div.innerHTML = DOMPurify.sanitize(html || '', { FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'script'], FORBID_ATTR: ['style'] });
    for (const img of div.querySelectorAll('img')) { img.loading = 'lazy'; img.decoding = 'async'; }
    for (const a of div.querySelectorAll('a')) if (!/^https:\/\//.test(a.getAttribute('href') || '')) a.removeAttribute('href');
  } catch {
    div.textContent = '';
  }
  return div;
}

/** The map's window: pictures, what it is, its versions, and Install. */
export async function openMap(id, { hit, targetId } = {}) {
  const body = h('div', h('div.skeleton', { style: { height: '160px' } }), h('div.skeleton.mt', { style: { height: '300px' } }));
  const head = h('div.proj-head', h('div.skeleton', { style: { width: '72px', height: '72px' } }), h('div', { style: { flex: 1 } }, h('h3', hit?.name || 'Loading…'), hit ? h('p', hit.summary) : null));
  const m = modal({ size: 'wide', head, body });
  let map;
  let files;
  try {
    [map, files] = await Promise.all([api.maps.project(id), api.maps.files(id)]);
  } catch (err) {
    m.close();
    const p = mapsProblem(err);
    fail(p.title, new Error(p.text));
    return;
  }
  let target = bestInstance(map.versions, targetId || store.target);
  const targetSelect = h('select.select', { style: { width: '230px' } },
    store.instances.map((i) => h('option', { value: i.id, selected: i === target }, `${i.name} · ${i.mcVersion}${opensIn(map.versions, i) ? '' : ' (older)'}`)));
  targetSelect.onchange = () => { target = store.instances.find((i) => i.id === targetSelect.value); store.target = target?.id; drawVersions(); };
  const installBtn = h('button.btn.primary', { icon: 'download' }, 'Install');
  installBtn.onclick = async () => {
    if (!target) return;
    const file = bestFile(files.files, target);
    if (!file) return;
    installBtn.disabled = true;
    installBtn.replaceChildren(h('i.spinner'), 'Installing');
    const got = await installMap(map, file, target);
    installBtn.disabled = false;
    installBtn.replaceChildren(icon(got ? 'check' : 'download'), got ? 'Installed' : 'Install');
  };
  const noDownloads = !files.files.some((f) => f.downloadable);
  head.replaceWith(h('header', { style: { display: 'block', padding: 0 } },
    h('div.proj-head', map.logo ? h('img', { src: map.logo, alt: '' }) : h('div.skeleton', { style: { width: '72px', height: '72px', animation: 'none' } }),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('h3', map.name),
        h('p', map.summary),
        h('div.row-gap.mt', { style: { marginTop: '10px' } },
          h('span.tag', { icon: 'download' }, fmtNumber(map.downloads)),
          map.authors?.length ? h('span.tag', { icon: 'user' }, map.authors.slice(0, 2).join(', ')) : null,
          map.versions[0] ? h('span.tag.accent', map.versions.length > 1 ? `${oldest(map.versions)} – ${map.versions[0]}` : map.versions[0]) : null,
          map.categories.map((c) => h('span.tag', c)),
          /^https:\/\//.test(map.url) ? h('a.tag', { href: map.url }, 'CurseForge', icon('external')) : null)),
      h('button.btn.ghost.icon.sm', { icon: 'x', style: { alignSelf: 'flex-start' }, onclick: () => m.close() })),
    h('div.row-gap', { style: { padding: '12px 20px 4px', justifyContent: 'flex-end' } },
      noDownloads ? h('span.muted', 'Its maker only allows downloads on CurseForge itself.') : null,
      !noDownloads && store.instances.length ? h('span.muted', 'Install to') : null,
      !noDownloads && store.instances.length ? targetSelect : null,
      !noDownloads && !store.instances.length ? h('span.muted', 'Make an instance first.') : null,
      !noDownloads && store.instances.length ? installBtn : null,
      noDownloads && /^https:\/\//.test(map.url) ? h('a.btn.primary', { href: map.url, icon: 'external' }, 'Open on CurseForge') : null)));

  const pane = h('div');
  const tabs = segmented([
    { value: 'about', label: 'About', icon: 'info' },
    { value: 'versions', label: 'Versions', icon: 'layers' },
  ], 'about', (v) => show(v));
  clear(body);
  body.append(h('div', { style: { margin: '10px 0 14px' } }, tabs), pane);
  const about = h('div',
    map.screenshots.length ? h('div.gallery', map.screenshots.map((s) => h('img', { src: s.thumb, alt: s.title, loading: 'lazy', decoding: 'async', onclick: () => window.open(s.url) }))) : null,
    sanitize(map.description));
  const versionsPane = h('div');

  function drawVersions() {
    clear(versionsPane);
    if (!files.files.length) {
      versionsPane.appendChild(h('div.empty', { style: { padding: '30px' } }, h('b', 'No files')));
      return;
    }
    for (const f of files.files.slice(0, 40)) {
      const fitsHere = !target || !f.versions.length || f.versions.some((v) => (cmpVersion(target.mcVersion, v) ?? 1) >= 0);
      const btn = h('button.btn.sm', { icon: 'download', disabled: !f.downloadable || !target }, 'Install');
      btn.onclick = async () => {
        btn.disabled = true;
        await installMap(map, f, target);
        btn.disabled = false;
      };
      versionsPane.appendChild(h('div.ver-row',
        h('div', { style: { minWidth: 0 } }, h('b', f.name), h('span', [f.versions.join(', ') || 'Any version', f.size ? fmtBytes(f.size) : null, f.date ? fmtAgo(Date.parse(f.date)) : null].filter(Boolean).join(' · '))),
        h(`span.tag${!fitsHere ? '.warn' : f.type === 'release' ? '.good' : '.warn'}`, !fitsHere ? 'newer version' : f.type),
        btn));
    }
  }

  function show(which) {
    clear(pane);
    pane.appendChild(which === 'about' ? about : versionsPane);
    pane.firstChild.style.animation = 'fade .25s both';
  }
  drawVersions();
  show('about');
  return m;
}
