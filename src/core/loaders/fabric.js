'use strict';
const { getJson } = require('../http');
const { writeJson, exists } = require('../util');

const META = {
  fabric: 'https://meta.fabricmc.net/v2',
  quilt: 'https://meta.quiltmc.org/v3',
};

const gameCache = {};

/** Minecraft versions the loader has intermediary mappings for. */
async function supportedGameVersions(kind) {
  if (!gameCache[kind]) {
    gameCache[kind] = getJson(`${META[kind]}/versions/game`)
      .then((list) => new Set(list.map((v) => v.version)))
      .catch((err) => { delete gameCache[kind]; throw err; });
  }
  return gameCache[kind];
}

async function listLoaderVersions(kind, mcVersion) {
  const list = await getJson(`${META[kind]}/versions/loader/${encodeURIComponent(mcVersion)}`);
  return list.map((entry) => {
    const version = entry.loader.version;
    // Quilt has no "stable" flag, its pre-releases carry -beta/-pre in the version
    const stable = kind === 'fabric' ? entry.loader.stable !== false : !/-(beta|pre|rc|alpha)/i.test(version);
    return { version, stable };
  });
}

function versionId(kind, mcVersion, loaderVersion) {
  return `${kind}-loader-${loaderVersion}-${mcVersion}`;
}

/** Fabric and Quilt ship a ready-made version JSON that inherits from vanilla — we just save it. */
async function install(paths, kind, mcVersion, loaderVersion) {
  const id = versionId(kind, mcVersion, loaderVersion);
  if (await exists(paths.versionJson(id))) return id;
  const url = `${META[kind]}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const profile = await getJson(url);
  profile.id = id;
  await writeJson(paths.versionJson(id), profile);
  return id;
}

module.exports = { META, supportedGameVersions, listLoaderVersions, versionId, install };
