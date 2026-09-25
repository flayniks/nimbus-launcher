'use strict';
const fsp = require('fs').promises;
const path = require('path');
const { sha1File, exists } = require('./util');

/**
 * Nimbus Core, the mod that ships inside the launcher (see launcher/mod/). It is put into
 * every Fabric and Quilt instance it supports before each launch, turned back on if
 * someone disabled it, and restored if someone deleted it.
 */
const PREFIX = 'nimbus-core-';
const TITLE = 'Nimbus Core';

function isBuiltinFile(name) {
  return path.basename(name).startsWith(PREFIX);
}

/** The jar family for an instance, or null. Snapshots and pre-releases are left alone. */
function familyFor(instance) {
  if (instance.loader !== 'fabric' && instance.loader !== 'quilt') return null;
  const v = instance.mcVersion || '';
  if (/^1\.2[01](\.\d+)?$/.test(v)) return 'fabric-1.20-1.21';
  // year-numbered releases: 26.1, 26.3, 27.2.1 ...
  if (/^(\d{2})\.\d+(\.\d+)?$/.test(v) && Number(v.split('.')[0]) >= 26) return 'fabric-26';
  return null;
}

function versionOf(file) {
  const m = file.match(/-(\d+\.\d+\.\d+)\.jar$/);
  return m ? m[1] : null;
}

class Builtin {
  constructor(dir) {
    this.dir = dir;
  }

  async jars() {
    try {
      return (await fsp.readdir(this.dir)).filter((f) => f.startsWith(PREFIX) && f.endsWith('.jar'));
    } catch {
      return [];
    }
  }

  async jarFor(instance) {
    const family = familyFor(instance);
    if (!family) return null;
    return (await this.jars()).find((f) => f.startsWith(`${PREFIX}${family}-`)) || null;
  }

  /** Puts the right Nimbus Core jar in place (and nothing else of ours). Returns its file name or null. */
  async ensure(paths, instances, instance) {
    const want = await this.jarFor(instance);
    const modsDir = path.join(paths.gameDir(instance.id), 'mods');
    await fsp.mkdir(modsDir, { recursive: true });

    const manifest = await instances.contentManifest(instance.id);
    let dirty = false;
    for (const name of await fsp.readdir(modsDir)) {
      if (!isBuiltinFile(name) || name === want) continue;
      // older versions, other families, and disabled copies all go
      await fsp.rm(path.join(modsDir, name), { force: true, recursive: true });
      const rel = `mods/${name.replace(/\.disabled$/, '')}`;
      if (manifest[rel] && rel !== `mods/${want}`) { delete manifest[rel]; dirty = true; }
    }

    if (want) {
      const src = path.join(this.dir, want);
      const dest = path.join(modsDir, want);
      if (!(await exists(dest)) || (await sha1File(dest)) !== (await sha1File(src))) await fsp.copyFile(src, dest);
      const rel = `mods/${want}`;
      if (!manifest[rel]?.builtin) {
        manifest[rel] = { builtin: true, title: TITLE, versionNumber: versionOf(want), type: 'mod', icon: null, projectId: null };
        dirty = true;
      }
    }
    for (const [rel, meta] of Object.entries(manifest)) {
      if (meta.builtin && rel !== `mods/${want}`) { delete manifest[rel]; dirty = true; }
    }
    if (dirty) await instances.saveContentManifest(instance.id, manifest);
    return want;
  }
}

module.exports = { Builtin, PREFIX, TITLE, isBuiltinFile, familyFor };
