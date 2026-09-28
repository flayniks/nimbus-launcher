'use strict';
const fsp = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const { getJson, postJson, downloadFile, isValid } = require('./http');
const { sha1File, pool, writeJson } = require('./util');
const { CONTENT_DIRS } = require('./instances');

const API = 'https://api.modrinth.com/v2';

/** Which Modrinth loader tags run on an instance. Quilt runs most Fabric mods. */
function modLoaders(loader) {
  switch (loader) {
    case 'fabric': return ['fabric'];
    case 'quilt': return ['quilt', 'fabric'];
    case 'forge': return ['forge'];
    case 'neoforge': return ['neoforge'];
    default: return [];
  }
}

const q = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v != null && v !== '')).toString();

async function search({ query = '', type = 'mod', gameVersion, loader, sort = 'relevance', offset = 0, limit = 20, category } = {}) {
  const facets = [[`project_type:${type}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if ((type === 'mod' || type === 'modpack') && loader && loader !== 'vanilla') {
    facets.push(modLoaders(loader).map((l) => `categories:${l}`));
  }
  if (type === 'mod' || type === 'modpack') facets.push(['client_side:required', 'client_side:optional']);
  if (category) facets.push([`categories:${category}`]);
  return getJson(`${API}/search?${q({ query, facets: JSON.stringify(facets), index: sort, offset, limit })}`);
}

const getProject = (id) => getJson(`${API}/project/${encodeURIComponent(id)}`);
const getProjects = (ids) => (ids.length ? getJson(`${API}/projects?${q({ ids: JSON.stringify(ids) })}`) : Promise.resolve([]));
const getVersion = (id) => getJson(`${API}/version/${encodeURIComponent(id)}`);

async function getVersions(id, { loaders, gameVersions } = {}) {
  const params = {};
  if (loaders && loaders.length) params.loaders = JSON.stringify(loaders);
  if (gameVersions && gameVersions.length) params.game_versions = JSON.stringify(gameVersions);
  return getJson(`${API}/project/${encodeURIComponent(id)}/version?${q(params)}`);
}

/** The newest version of a project that runs on this instance, preferring full releases. */
async function compatibleVersion(projectId, type, instance) {
  const opts = { gameVersions: [instance.mcVersion] };
  if (type === 'mod') opts.loaders = modLoaders(instance.loader);
  let list = await getVersions(projectId, opts);
  // shader packs rarely tag every game version they work on
  if (!list.length && type === 'shader') list = await getVersions(projectId, {});
  return list.find((v) => v.version_type === 'release') || list[0] || null;
}

/**
 * What to update to from `currentId`: the newest release published after it, else the newest
 * beta after it. Never an older one (a project's newest *release* can be older than a beta
 * you already have). Null when there is nothing newer.
 */
async function newerVersion(projectId, type, instance, currentId) {
  const opts = { gameVersions: [instance.mcVersion] };
  if (type === 'mod') opts.loaders = modLoaders(instance.loader);
  const list = await getVersions(projectId, opts);
  const at = currentId ? list.findIndex((v) => v.id === currentId) : -1;
  let newer = at >= 0 ? list.slice(0, at) : list;
  if (at < 0 && currentId) {
    // installed from a build this list doesn't show: go by date
    const cur = await getVersion(currentId).catch(() => null);
    if (cur?.date_published) newer = list.filter((v) => v.date_published > cur.date_published);
  }
  newer = newer.filter((v) => v.version_type !== 'alpha');
  return newer.find((v) => v.version_type === 'release') || newer[0] || null;
}

function primaryFile(version) {
  return version.files.find((f) => f.primary) || version.files[0];
}

/**
 * Installs one Modrinth version into an instance, replacing older files of the same
 * project, then pulls in its required dependencies.
 */
async function installToInstance(ctx, instances, instance, { project, version }, state = { visited: new Set(), installed: [], warnings: [] }) {
  const type = project.project_type === 'shader' || project.project_type === 'resourcepack' ? project.project_type : 'mod';
  if (type === 'mod' && instance.loader === 'vanilla') {
    throw new Error('Vanilla instances cannot load mods. Create a Fabric, Quilt, Forge or NeoForge instance.');
  }
  if (state.visited.has(project.id)) return state;
  state.visited.add(project.id);

  const game = ctx.paths.gameDir(instance.id);
  const file = primaryFile(version);
  const rel = `${CONTENT_DIRS[type]}/${file.filename}`;
  const dest = path.join(game, ...rel.split('/'));
  if (!dest.startsWith(game + path.sep)) throw new Error('Refusing a file name that escapes the instance');

  const manifest = await instances.contentManifest(instance.id);
  for (const [oldRel, meta] of Object.entries(manifest)) {
    if (meta.projectId === project.id && oldRel !== rel) await instances.removeContent(instance.id, oldRel);
  }
  await downloadFile(file.url, dest, { sha1: file.hashes.sha1 });
  await instances.recordContent(instance.id, rel, {
    projectId: project.id,
    versionId: version.id,
    versionNumber: version.version_number,
    title: project.title,
    icon: project.icon_url || null,
    slug: project.slug,
    type,
    hash: file.hashes.sha1,
  });
  state.installed.push(project.title);

  if (type === 'mod') {
    const current = await instances.contentManifest(instance.id);
    const have = new Set(Object.values(current).map((m) => m.projectId));
    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      if (have.has(dep.project_id) || state.visited.has(dep.project_id)) continue;
      try {
        const depProject = await getProject(dep.project_id);
        let depVersion = dep.version_id ? await getVersion(dep.version_id) : null;
        if (!depVersion || !depVersion.game_versions.includes(instance.mcVersion)) {
          depVersion = await compatibleVersion(dep.project_id, 'mod', instance);
        }
        if (!depVersion) {
          state.warnings.push(`${project.title} needs ${depProject.title}, but there is no build of it for this version.`);
          continue;
        }
        await installToInstance(ctx, instances, instance, { project: depProject, version: depVersion }, state);
      } catch (err) {
        state.warnings.push(`Could not add a dependency of ${project.title}: ${err.message}`);
      }
    }
  }
  return state;
}

/** Installs the best version of a project (by id or slug). */
async function installProject(ctx, instances, instance, projectId, versionId) {
  const project = await getProject(projectId);
  const version = versionId ? await getVersion(versionId) : await compatibleVersion(project.id, project.project_type, instance);
  if (!version) throw new Error(`${project.title} has no version for ${instance.mcVersion}${instance.loader !== 'vanilla' ? ` on ${instance.loader}` : ''}.`);
  return installToInstance(ctx, instances, instance, { project, version });
}

/** Figures out which Modrinth project each unknown file is, by hash, and remembers it. */
async function identifyContent(ctx, instances, instanceId) {
  const game = ctx.paths.gameDir(instanceId);
  const items = await instances.listContent(instanceId);
  const unknown = items.filter((i) => !i.meta && !i.isDir);
  if (!unknown.length) return 0;
  const hashes = {};
  await pool(unknown, 8, async (item) => {
    const abs = path.join(game, ...item.rel.split('/')) + (item.enabled ? '' : '.disabled');
    hashes[await sha1File(abs)] = item;
  });
  const found = await postJson(`${API}/version_files`, { hashes: Object.keys(hashes), algorithm: 'sha1' });
  const versions = Object.entries(found);
  if (!versions.length) return 0;
  const projects = await getProjects([...new Set(versions.map(([, v]) => v.project_id))]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const manifest = await instances.contentManifest(instanceId);
  for (const [hash, version] of versions) {
    const item = hashes[hash];
    const project = byId.get(version.project_id);
    if (!item || !project) continue;
    manifest[item.rel] = {
      projectId: project.id, versionId: version.id, versionNumber: version.version_number,
      title: project.title, icon: project.icon_url || null, slug: project.slug, type: item.type, hash,
    };
  }
  await writeJson(instances.contentFile(instanceId), manifest);
  return versions.length;
}

/** Returns the installed files that have a newer compatible release on Modrinth. */
async function checkUpdates(ctx, instances, instance) {
  const manifest = await instances.contentManifest(instance.id);
  const byHash = {};
  for (const [rel, meta] of Object.entries(manifest)) if (meta.hash) byHash[meta.hash] = { rel, meta };
  const hashes = Object.keys(byHash);
  if (!hashes.length) return [];
  const updates = [];
  const groups = { mod: [], other: [] };
  for (const h of hashes) (byHash[h].meta.type === 'mod' ? groups.mod : groups.other).push(h);
  for (const [kind, list] of Object.entries(groups)) {
    if (!list.length) continue;
    const body = { hashes: list, algorithm: 'sha1', game_versions: [instance.mcVersion] };
    if (kind === 'mod') body.loaders = modLoaders(instance.loader);
    const res = await postJson(`${API}/version_files/update`, body);
    for (const [hash, version] of Object.entries(res)) {
      const { rel, meta } = byHash[hash];
      if (version.id !== meta.versionId) {
        updates.push({ rel, title: meta.title, icon: meta.icon, from: meta.versionNumber, to: version.version_number, projectId: meta.projectId, versionId: version.id });
      }
    }
  }
  return updates;
}

function safeJoin(root, rel) {
  const abs = path.resolve(root, ...rel.split(/[\\/]/));
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`Modpack tried to write outside its folder: ${rel}`);
  return abs;
}

/** Reads the loader out of a .mrpack's dependency list. */
function packLoader(deps) {
  if (deps['fabric-loader']) return { loader: 'fabric', loaderVersion: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { loader: 'quilt', loaderVersion: deps['quilt-loader'] };
  if (deps.neoforge) return { loader: 'neoforge', loaderVersion: deps.neoforge };
  if (deps.forge) return { loader: 'forge', loaderVersion: `${deps.minecraft}-${deps.forge}` };
  return { loader: 'vanilla', loaderVersion: null };
}

/**
 * Creates a new instance from a Modrinth modpack (.mrpack), either a version picked in
 * Browse or a file the user dropped in.
 */
async function installModpack(ctx, instances, { versionId, file, project, onStatus = () => {} }) {
  let packFile = file;
  let version = null;
  if (versionId) {
    version = await getVersion(versionId);
    const f = primaryFile(version);
    packFile = path.join(ctx.paths.cache, 'modpacks', f.filename);
    onStatus('Downloading modpack');
    if (!(await isValid(packFile, { sha1: f.hashes.sha1, size: f.size }))) await downloadFile(f.url, packFile, { sha1: f.hashes.sha1 });
  }
  const zip = new AdmZip(packFile);
  const indexText = zip.readAsText('modrinth.index.json');
  if (!indexText) throw new Error('That file is not a Modrinth modpack (no modrinth.index.json).');
  const index = JSON.parse(indexText);
  const deps = index.dependencies || {};
  if (!deps.minecraft) throw new Error('The modpack does not say which Minecraft version it needs.');
  const { loader, loaderVersion } = packLoader(deps);

  const instance = await instances.create({
    name: index.name || project?.title || 'Modpack',
    mcVersion: deps.minecraft,
    loader,
    loaderVersion,
    icon: project?.icon_url || null,
    modpack: { projectId: project?.id || version?.project_id || null, versionId: version?.id || null, version: index.versionId || null, name: index.name },
  });
  const game = ctx.paths.gameDir(instance.id);

  try {
    onStatus('Downloading modpack files');
    const tasks = [];
    for (const f of index.files || []) {
      if (f.env?.client === 'unsupported') continue;
      tasks.push({ url: f.downloads[0], fallbacks: f.downloads.slice(1), path: safeJoin(game, f.path), sha1: f.hashes?.sha1, size: f.fileSize });
    }
    await ctx.downloader.run(tasks, { label: `${instance.name} files` });

    onStatus('Unpacking overrides');
    for (const prefix of ['overrides/', 'client-overrides/']) {
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
        const dest = safeJoin(game, entry.entryName.slice(prefix.length));
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, entry.getData());
      }
    }
  } catch (err) {
    await instances.remove(instance.id).catch(() => {});
    throw err;
  }
  identifyContent(ctx, instances, instance.id).catch(() => {});
  return instance;
}

async function gameVersionTags() {
  return getJson(`${API}/tag/game_version`);
}

module.exports = {
  API, modLoaders, search, getProject, getProjects, getVersion, getVersions, compatibleVersion, newerVersion,
  installToInstance, installProject, identifyContent, checkUpdates, installModpack, packLoader, gameVersionTags,
};
