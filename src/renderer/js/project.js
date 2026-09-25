/* global DOMPurify, marked */
import { h, icon, clear, modal, fail, ok, info, fmtNumber, LOADER_NAMES, segmented } from './ui.js';
import { api, store } from './store.js';
import { go } from './router.js';

const MOD_LOADERS = { fabric: ['fabric'], quilt: ['quilt', 'fabric'], forge: ['forge'], neoforge: ['neoforge'] };

/** Can this project go into this instance at all? Used to filter the "install to" list. */
export function fits(project, inst) {
  const type = project.project_type;
  if (type === 'modpack') return false;
  const versions = project.game_versions || project.versions || [];
  const versionOk = !versions.length || versions.includes(inst.mcVersion);
  if (type === 'mod') {
    if (inst.loader === 'vanilla') return false;
    const loaders = project.loaders || project.categories || [];
    return versionOk && MOD_LOADERS[inst.loader].some((l) => loaders.includes(l));
  }
  if (type === 'shader') return true;
  return versionOk;
}

/** Shader packs need a shader mod. Offers to add Iris (or Oculus on Forge) when it is missing. */
export async function ensureShaderSupport(inst) {
  if (inst.loader === 'vanilla') {
    info('Shaders need a mod loader', 'The pack is in shaderpacks/, but vanilla cannot run it. Make a Fabric instance and add Iris.');
    return;
  }
  const content = await api.content.list(inst.id).catch(() => []);
  const names = content.map((c) => `${c.meta?.slug || ''} ${c.file}`).join(' ').toLowerCase();
  if (/iris|oculus|optifine/.test(names)) return;
  const mod = inst.loader === 'forge' ? 'oculus' : 'iris';
  info('Adding the shader loader', `${mod === 'iris' ? 'Iris + Sodium' : 'Oculus + Embeddium'} are needed to run shader packs.`);
  try {
    await api.modrinth.install(inst.id, mod);
  } catch (err) {
    fail(`Could not add ${mod === 'iris' ? 'Iris' : 'Oculus'}`, err);
  }
}

export async function installInto(project, inst, versionId) {
  const res = await api.modrinth.install(inst.id, project.id || project.project_id, versionId);
  const extra = res.installed.length > 1 ? ` (+${res.installed.length - 1} dependenc${res.installed.length > 2 ? 'ies' : 'y'})` : '';
  ok(`Added to ${inst.name}`, `${res.installed[0]}${extra}`);
  for (const w of res.warnings || []) info('Heads up', w);
  if (project.project_type === 'shader') await ensureShaderSupport(inst);
  return res;
}

export async function installModpack(project, versionId) {
  const title = project.title;
  info(`Installing ${title}`, 'This makes a new instance. Progress is in the task list up top.');
  try {
    const inst = await api.modrinth.installPack({ versionId, project: { id: project.id || project.project_id, title, icon_url: project.icon_url } });
    await store.refreshInstances();
    ok(`${title} is ready`, 'The game files finish downloading in the background.', {
      actions: [{ label: 'Open', run: () => go('instance', { id: inst.id }) }],
    });
    return inst;
  } catch (err) {
    fail(`${title} failed to install`, err);
    return null;
  }
}

function renderMarkdown(md) {
  const div = h('div.markdown');
  try {
    const html = marked.parse(md || '');
    div.innerHTML = DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'iframe', 'form', 'input'], FORBID_ATTR: ['style'] });
    for (const img of div.querySelectorAll('img')) { img.loading = 'lazy'; img.decoding = 'async'; }
  } catch {
    div.textContent = md || '';
  }
  return div;
}

export async function openProject(projectId, { type, hit, targetId } = {}) {
  const body = h('div', h('div.skeleton', { style: { height: '160px' } }), h('div.skeleton.mt', { style: { height: '300px' } }));
  const head = h('div.proj-head', h('div.skeleton', { style: { width: '72px', height: '72px' } }), h('div', { style: { flex: 1 } }, h('h3', hit?.title || 'Loading…'), hit ? h('p', hit.description) : null));
  const m = modal({ size: 'wide', head, body });

  let project;
  try {
    project = await api.modrinth.project(projectId);
  } catch (err) {
    m.close();
    fail('Could not open project', err);
    return;
  }
  const isPack = project.project_type === 'modpack';
  const targets = store.instances.filter((i) => fits(project, i));
  let target = targets.find((t) => t.id === (targetId || store.target)) || targets[0] || null;

  const targetSelect = h('select.select', { style: { width: '220px' }, onchange: () => { target = targets.find((t) => t.id === targetSelect.value); store.target = target?.id; loadVersions(); } },
    targets.map((t) => h('option', { value: t.id, selected: t === target }, `${t.name} · ${t.mcVersion} ${LOADER_NAMES[t.loader]}`)));
  const installBtn = h('button.btn.primary', { icon: 'download' }, isPack ? 'Install modpack' : 'Install');
  installBtn.onclick = async () => {
    installBtn.disabled = true;
    try {
      if (isPack) { m.close(); await installModpack(project); return; }
      if (!target) return;
      await installInto(project, target);
    } catch (err) {
      fail('Install failed', err);
    } finally {
      installBtn.disabled = false;
    }
  };

  const links = [
    ['Modrinth', `https://modrinth.com/${project.project_type}/${project.slug}`],
    ['Source', project.source_url], ['Issues', project.issues_url], ['Wiki', project.wiki_url], ['Discord', project.discord_url],
  ].filter(([, u]) => u && /^https:\/\//.test(u));

  const img = project.icon_url ? h('img', { src: project.icon_url, alt: '' }) : h('div.skeleton', { style: { width: '72px', height: '72px', animation: 'none' } });
  head.replaceWith(h('header', { style: { display: 'block', padding: 0 } },
    h('div.proj-head', img,
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('h3', project.title),
        h('p', project.description),
        h('div.row-gap.mt', { style: { marginTop: '10px' } },
          h('span.tag', { icon: 'download' }, fmtNumber(project.downloads)),
          h('span.tag', { icon: 'heart' }, fmtNumber(project.followers)),
          (project.loaders || []).slice(0, 5).map((l) => h('span.tag.accent', l)),
          links.map(([label, url]) => h('a.tag', { href: url }, label, icon('external'))))),
      h('button.btn.ghost.icon.sm', { icon: 'x', style: { alignSelf: 'flex-start' }, onclick: () => m.close() })),
    h('div.row-gap', { style: { padding: '12px 20px 4px', justifyContent: 'flex-end' } },
      !isPack && targets.length ? h('span.muted', 'Install to') : null,
      !isPack && targets.length ? targetSelect : null,
      !isPack && !targets.length ? h('span.muted', project.project_type === 'mod' ? 'No instance with a matching loader and version — create one first.' : 'Create an instance first.') : null,
      (isPack || targets.length) ? installBtn : null)));

  // ---- tabs
  const pane = h('div');
  const tabs = segmented([
    { value: 'about', label: 'About', icon: 'info' },
    { value: 'versions', label: 'Versions', icon: 'layers' },
  ], 'about', (v) => show(v));
  clear(body);
  body.append(h('div', { style: { margin: '10px 0 14px' } }, tabs), pane);

  const gallery = (project.gallery || []).slice().sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  const about = h('div',
    gallery.length ? h('div.gallery', gallery.slice(0, 8).map((g) => h('img', { src: g.url, alt: g.title || '', loading: 'lazy', decoding: 'async' }))) : null,
    renderMarkdown(project.body));
  const versionsPane = h('div');

  async function loadVersions() {
    clear(versionsPane);
    versionsPane.appendChild(h('div.skeleton', { style: { height: '60px' } }));
    try {
      const opts = {};
      if (!isPack && target) {
        opts.gameVersions = [target.mcVersion];
        if (project.project_type === 'mod') opts.loaders = MOD_LOADERS[target.loader];
      }
      let versions = await api.modrinth.versions(project.id, opts);
      if (!versions.length && project.project_type === 'shader') versions = await api.modrinth.versions(project.id, {});
      clear(versionsPane);
      if (!versions.length) {
        versionsPane.appendChild(h('div.empty', { style: { padding: '30px' } }, h('b', 'No compatible versions'), target ? `Nothing for ${target.mcVersion} ${LOADER_NAMES[target.loader]}.` : ''));
        return;
      }
      for (const v of versions.slice(0, 40)) {
        const gv = v.game_versions;
        const range = gv.length > 3 ? `${gv[0]} – ${gv[gv.length - 1]}` : gv.join(', ');
        const btn = h('button.btn.sm', { icon: 'download' }, isPack ? 'Install' : 'Add');
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            if (isPack) { m.close(); await installModpack(project, v.id); } else if (target) await installInto(project, target, v.id);
          } catch (err) { fail('Install failed', err); } finally { btn.disabled = false; }
        };
        versionsPane.appendChild(h('div.ver-row',
          h('div', { style: { minWidth: 0 } }, h('b', v.name || v.version_number), h('span', `${v.version_number} · ${range} · ${v.loaders.join(', ')}`)),
          h(`span.tag${v.version_type === 'release' ? '.good' : '.warn'}`, v.version_type),
          (isPack || target) ? btn : h('span')));
      }
    } catch (err) {
      clear(versionsPane);
      versionsPane.appendChild(h('div.muted', err.message));
    }
  }

  function show(which) {
    clear(pane);
    pane.appendChild(which === 'about' ? about : versionsPane);
    pane.firstChild.style.animation = 'fade .25s both';
  }
  show('about');
  loadVersions();
  if (type && type !== project.project_type) console.warn('project type mismatch', type, project.project_type);
  return m;
}

