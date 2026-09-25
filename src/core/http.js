'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { pool, sha1File } = require('./util');

const { version } = require('../../package.json');

const USER_AGENT = `flayniks/nimbus-launcher/${version} (github.com/flayniks/nimbus-launcher)`;

class HttpError extends Error {
  constructor(url, status, body) {
    super(`HTTP ${status} for ${url}${body ? `: ${String(body).slice(0, 300)}` : ''}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with a user agent, a timeout and a couple of retries on network or 5xx errors. */
async function request(url, opts = {}) {
  const { retries = 2, timeout = 30000, headers = {}, ...rest } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...rest,
        headers: { 'User-Agent': USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      const err = new HttpError(url, res.status, body);
      // 4xx will not get better by asking again (429 aside)
      if (res.status < 500 && res.status !== 429) throw err;
      lastErr = err;
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      lastErr = err;
    }
    if (attempt < retries) await sleep(400 * 2 ** attempt);
  }
  throw lastErr;
}

async function getJson(url, opts) {
  const res = await request(url, opts);
  return res.json();
}

async function getText(url, opts) {
  const res = await request(url, opts);
  return res.text();
}

async function postJson(url, body, opts = {}) {
  const res = await request(url, {
    ...opts,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function postForm(url, form, opts = {}) {
  const res = await request(url, {
    ...opts,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
    body: new URLSearchParams(form).toString(),
  });
  return res.json();
}

/**
 * Checks whether a file on disk already matches what we would download.
 * Size is checked first because hashing thousands of assets on every launch is slow;
 * `deep` forces the hash (used by "repair").
 */
async function isValid(file, { sha1, size }, deep = false) {
  let stat;
  try { stat = await fsp.stat(file); } catch { return false; }
  if (!stat.isFile()) return false;
  if (size != null && stat.size !== size) return false;
  if (sha1 && (deep || size == null)) return (await sha1File(file)) === sha1;
  return true;
}

/** Streams one URL to disk, hashing as it goes, then moves it into place. */
async function downloadFile(url, dest, { sha1, onBytes, timeout = 120000 } = {}) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const res = await request(url, { timeout, retries: 1 });
  const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.part`;
  const hash = crypto.createHash('sha1');
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      if (onBytes) onBytes(chunk.length);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(tmp));
    const got = hash.digest('hex');
    if (sha1 && got !== sha1) throw new Error(`Checksum mismatch for ${path.basename(dest)} (expected ${sha1}, got ${got})`);
    await fsp.rename(tmp, dest);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Downloads many files at once. Tasks look like
 * { url, fallbacks?, path, sha1?, size?, executable? }.
 * Emits 'progress' with { done, total, bytes, totalBytes }.
 */
class Downloader extends EventEmitter {
  constructor({ concurrency = 16 } = {}) {
    super();
    this.concurrency = concurrency;
  }

  async run(tasks, { deep = false, label } = {}) {
    // one entry per destination, the rest are duplicates (shared assets etc.)
    const seen = new Set();
    const unique = tasks.filter((t) => t && !seen.has(t.path) && seen.add(t.path));

    const progress = { label, done: 0, total: unique.length, bytes: 0, totalBytes: 0, checking: true };
    this.emit('progress', { ...progress });

    const needed = [];
    await pool(unique, 64, async (task) => {
      if (await isValid(task.path, task, deep)) progress.done++;
      else {
        needed.push(task);
        progress.totalBytes += task.size || 0;
      }
    });
    progress.checking = false;
    progress.total = unique.length;
    this.emit('progress', { ...progress });
    if (needed.length === 0) return { downloaded: 0 };

    let lastEmit = 0;
    const tick = (force) => {
      const now = Date.now();
      if (force || now - lastEmit > 100) {
        lastEmit = now;
        this.emit('progress', { ...progress });
      }
    };

    const failures = [];
    await pool(needed, this.concurrency, async (task) => {
      const urls = [task.url, ...(task.fallbacks || [])].filter(Boolean);
      let lastErr;
      for (const url of urls) {
        for (let attempt = 0; attempt < 3; attempt++) {
          let received = 0;
          try {
            await downloadFile(url, task.path, {
              sha1: task.sha1,
              onBytes: (n) => { received += n; progress.bytes += n; tick(); },
            });
            if (task.executable && process.platform !== 'win32') await fsp.chmod(task.path, 0o755);
            lastErr = null;
            break;
          } catch (err) {
            progress.bytes -= received;
            lastErr = err;
            // a 404 on this mirror will not fix itself, move to the next one
            if (err instanceof HttpError && err.status === 404) break;
            await sleep(500 * (attempt + 1));
          }
        }
        if (!lastErr) break;
      }
      if (lastErr) failures.push({ task, err: lastErr });
      progress.done++;
      tick();
    });
    tick(true);

    if (failures.length) {
      const first = failures[0];
      const err = new Error(`${failures.length} file(s) failed to download. First: ${path.basename(first.task.path)} — ${first.err.message}`);
      err.failures = failures;
      throw err;
    }
    return { downloaded: needed.length };
  }
}

module.exports = { USER_AGENT, HttpError, request, getJson, getText, postJson, postForm, isValid, downloadFile, Downloader };
