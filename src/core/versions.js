'use strict';
const fsp = require('fs').promises;
const path = require('path');
const { getJson, isValid, downloadFile } = require('./http');
const { readJson, writeJson, exists } = require('./util');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MANIFEST_TTL = 10 * 60 * 1000;

let memo = null;

/** Mojang's version list, cached on disk so the launcher still works offline. */
async function getManifest(paths, { force = false } = {}) {
  if (!force && memo && Date.now() - memo.at < MANIFEST_TTL) return memo.data;
  const cacheFile = path.join(paths.cache, 'version_manifest_v2.json');
  try {
    const data = await getJson(MANIFEST_URL, { timeout: 15000 });
    await writeJson(cacheFile, data);
    memo = { at: Date.now(), data };
    return data;
  } catch (err) {
    const cached = await readJson(cacheFile, null);
    if (cached) {
      memo = { at: Date.now() - MANIFEST_TTL + 60000, data: cached };
      return cached;
    }
    throw err;
  }
}

/** Reads a version JSON, downloading it from Mojang when it is a vanilla version we do not have yet. */
async function getVersionJson(paths, id) {
  const file = paths.versionJson(id);
  const manifest = await getManifest(paths).catch(() => null);
  const entry = manifest?.versions.find((v) => v.id === id);
  if (entry) {
    if (!(await isValid(file, { sha1: entry.sha1 }))) {
      await downloadFile(entry.url, file, { sha1: entry.sha1 });
    }
  } else if (!(await exists(file))) {
    throw new Error(`Version ${id} is not installed and is not a Mojang version`);
  }
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

/** Follows inheritsFrom (Fabric, Quilt, Forge, NeoForge) down to the vanilla version and merges them. */
async function resolveVersion(paths, id) {
  const chain = [];
  let current = await getVersionJson(paths, id);
  chain.push(current);
  while (current.inheritsFrom) {
    if (chain.length > 8) throw new Error('Version inheritance is too deep');
    current = await getVersionJson(paths, current.inheritsFrom);
    chain.push(current);
  }
  let merged = chain.pop();
  merged = { ...merged, jar: merged.jar || merged.id, vanilla: merged.id };
  while (chain.length) merged = mergeVersion(merged, chain.pop());
  return merged;
}

function mergeVersion(parent, child) {
  const out = { ...parent, ...child };
  out.id = child.id;
  delete out.inheritsFrom;
  // the child comes first so its copy of a library wins when both list one
  out.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  if (parent.arguments || child.arguments) {
    out.arguments = {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    };
  }
  out.minecraftArguments = child.minecraftArguments ?? parent.minecraftArguments;
  for (const key of ['assetIndex', 'assets', 'downloads', 'javaVersion', 'logging']) {
    // Forge 1.12.2 ships "logging": {} which would otherwise hide vanilla's patched log4j config
    const own = child[key];
    const empty = own == null || (typeof own === 'object' && Object.keys(own).length === 0);
    out[key] = empty ? parent[key] : own;
  }
  // loader profiles stamp their own install time here, the game's era is what matters
  out.type = parent.type ?? child.type;
  out.releaseTime = parent.releaseTime ?? child.releaseTime;
  out.jar = child.jar || parent.jar || parent.id;
  out.vanilla = parent.vanilla;
  return out;
}

module.exports = { MANIFEST_URL, getManifest, getVersionJson, resolveVersion, mergeVersion };
