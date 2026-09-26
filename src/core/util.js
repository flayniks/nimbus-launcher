'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');

/** Mojang's name for the OS we run on. */
function osName() {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'osx';
    default: return 'linux';
  }
}

/** "x86" in Mojang rules means a 32-bit JVM; everything we ship is 64-bit except ia32. */
function osArch() {
  if (process.arch === 'ia32') return 'x86';
  if (process.arch === 'arm64') return 'arm64';
  return 'x86_64';
}

function archBits() {
  return process.arch === 'ia32' ? '32' : '64';
}

/**
 * Turns a maven coordinate into a repository-relative path.
 * group:artifact:version[:classifier][@ext]
 */
function mavenPath(name) {
  let ext = 'jar';
  let coord = name;
  const at = coord.indexOf('@');
  if (at !== -1) {
    ext = coord.slice(at + 1);
    coord = coord.slice(0, at);
  }
  const [group, artifact, version, classifier] = coord.split(':');
  if (!group || !artifact || !version) throw new Error(`Bad maven coordinate: ${name}`);
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return [...group.split('.'), artifact, version, file].join('/');
}

/** group:artifact[:classifier] — used to drop duplicate libraries across inherited versions. */
function libraryKey(name) {
  const coord = name.split('@')[0];
  const [group, artifact, , classifier] = coord.split(':');
  return classifier ? `${group}:${artifact}:${classifier}` : `${group}:${artifact}`;
}

/**
 * Evaluates Mojang library/argument rules. No rules means allowed.
 * Otherwise nothing is allowed until a matching rule says so, and the last match wins.
 */
function rulesAllow(rules, features = {}) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, features)) allowed = rule.action === 'allow';
  }
  return allowed;
}

function ruleMatches(rule, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== osName()) return false;
    if (rule.os.arch && rule.os.arch !== osArch()) return false;
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(os.release())) return false;
      } catch { return false; }
    }
  }
  if (rule.features) {
    for (const [key, want] of Object.entries(rule.features)) {
      if (Boolean(features[key]) !== want) return false;
    }
  }
  return true;
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function sha1File(p) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(p)
      .on('data', (d) => hash.update(d))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function readJson(p, fallback) {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

/** Writes through a temp file so a crash never leaves half a JSON file behind. */
let tmpSeq = 0;
const writing = new Map();

/**
 * Writes JSON atomically (temp file, then rename). Writes to the same file take turns:
 * Windows refuses a rename onto a file another rename is replacing (EPERM), and the
 * last call must be the one that lands. The data is captured when you call.
 */
function writeJson(p, data) {
  const text = JSON.stringify(data, null, 2);
  const next = (writing.get(p) || Promise.resolve()).catch(() => {}).then(() => writeNow(p, text));
  writing.set(p, next);
  next.catch(() => {}).finally(() => { if (writing.get(p) === next) writing.delete(p); });
  return next;
}

async function writeNow(p, text) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.${++tmpSeq}.tmp`;
  await fsp.writeFile(tmp, text);
  for (let attempt = 1; ; attempt++) {
    try {
      await fsp.rename(tmp, p);
      return;
    } catch (err) {
      // antivirus and indexers briefly lock files on Windows
      if (attempt < 6 && ['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) {
        await new Promise((r) => setTimeout(r, 25 * attempt));
        continue;
      }
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function pool(items, limit, worker) {
  let next = 0;
  const results = new Array(items.length);
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function slugify(text) {
  return String(text).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'instance';
}

/** Splits a user-typed argument string, keeping "quoted parts" together. */
function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pending = null;
  const fire = () => {
    last = Date.now();
    timer = null;
    const args = pending;
    pending = null;
    fn(...args);
  };
  const wrapped = (...args) => {
    pending = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) fire();
    else if (!timer) timer = setTimeout(fire, wait);
  };
  wrapped.flush = () => { if (timer) { clearTimeout(timer); fire(); } };
  return wrapped;
}

module.exports = {
  osName, osArch, archBits, mavenPath, libraryKey, rulesAllow, exists, sha1File,
  readJson, writeJson, pool, slugify, splitArgs, throttle,
};
