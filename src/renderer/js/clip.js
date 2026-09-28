// Replay clips: records the Minecraft window into a rolling buffer of encoded video (WebCodecs,
// on the graphics card where it can), and when asked turns the last N seconds into an MP4.
// Nothing touches the disk until a clip is saved, so recording costs no writes, only a little
// encoding work.
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer/mp4-muxer.mjs';

const QUALITY = {
  normal: { maxWidth: 1280, maxHeight: 720, fps: 30, bitrate: 6_000_000 },
  high: { maxWidth: 1920, maxHeight: 1080, fps: 60, bitrate: 14_000_000 },
};
const KEY_EVERY_US = 2_000_000; // a keyframe every 2 seconds, so a clip can start almost anywhere

let rec = null;

function even(n) {
  return Math.max(2, Math.floor(n / 2) * 2);
}

/** The best encoder this computer has: H.264 on the graphics card, then any H.264, then VP9. */
async function pickEncoder(width, height, fps, bitrate) {
  const level = width * height > 1280 * 720 || fps > 30 ? '2a' : '1f';
  const tries = [
    { codec: `avc1.6400${level}`, mux: 'avc', hardwareAcceleration: 'prefer-hardware', avc: { format: 'avc' } },
    { codec: `avc1.4d00${level}`, mux: 'avc', hardwareAcceleration: 'no-preference', avc: { format: 'avc' } },
    { codec: 'vp09.00.40.08', mux: 'vp9', hardwareAcceleration: 'no-preference' },
  ];
  for (const { mux, ...t } of tries) {
    const config = { ...t, width, height, bitrate, framerate: fps, latencyMode: 'realtime', bitrateMode: 'variable' };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return { config, mux };
    } catch { /* try the next one */ }
  }
  throw new Error('This computer can\'t encode video for clips.');
}

async function pickAudioEncoder() {
  const config = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000 };
  try {
    const r = await AudioEncoder.isConfigSupported(config);
    return r.supported ? config : null;
  } catch {
    return null;
  }
}

async function start({ sourceId, quality = 'normal', seconds = 30, audio = false }) {
  stop();
  const q = QUALITY[quality] || QUALITY.normal;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: q.maxWidth, maxHeight: q.maxHeight, maxFrameRate: q.fps } },
  });
  const track = stream.getVideoTracks()[0];
  const me = { stream, track, seconds, q, video: [], audio: [], decoderConfig: null, audioMeta: null, encoder: null, mux: null, width: 0, height: 0, lastKey: -Infinity, poster: null, posterAt: 0, stopped: false, audioStream: null, audioConfig: null };
  rec = me;
  track.addEventListener('ended', () => { if (rec === me) { stop(); window.clip.send('ended'); } });

  // game sound (Windows): the system's own output, as the video's soundtrack
  if (audio && window.clip.platform === 'win32') {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 16, maxHeight: 16, maxFrameRate: 1 } } });
      for (const t of s.getVideoTracks()) t.stop();
      const at = s.getAudioTracks()[0];
      const config = at && (await pickAudioEncoder());
      if (config) {
        me.audioStream = s;
        me.audioConfig = config;
        const enc = new AudioEncoder({
          output: (chunk, meta) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            if (meta?.decoderConfig) me.audioMeta = meta;
            me.audio.push({ data, timestamp: chunk.timestamp, duration: chunk.duration || 20_000 });
            trim(me);
          },
          error: () => { me.audioConfig = null; },
        });
        enc.configure(config);
        me.audioEncoder = enc;
        pump(new MediaStreamTrackProcessor({ track: at }).readable.getReader(), (data) => {
          if (enc.state === 'configured' && enc.encodeQueueSize < 20) enc.encode(data);
          data.close();
        }, me);
      } else {
        for (const t of s.getTracks()) t.stop();
      }
    } catch { /* no sound then */ }
  }

  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  pump(reader, async (frame) => {
    try {
      const w = even(frame.displayWidth);
      const h = even(frame.displayHeight);
      if (!me.encoder || w !== me.width || h !== me.height) await configure(me, w, h);
      if (me.encoder.state !== 'configured' || me.encoder.encodeQueueSize > 4) return; // falling behind: skip a frame
      const key = frame.timestamp - me.lastKey >= KEY_EVERY_US;
      if (key) me.lastKey = frame.timestamp;
      me.encoder.encode(frame, { keyFrame: key });
      // a small picture of the latest moment, for the clip's poster
      if (frame.timestamp - me.posterAt > 3_000_000) {
        me.posterAt = frame.timestamp;
        createImageBitmap(frame, { resizeWidth: 480, resizeHeight: Math.round(480 * h / w) }).then((b) => { me.poster?.close?.(); me.poster = b; }).catch(() => {});
      }
    } finally {
      frame.close();
    }
  }, me);
  window.clip.send('recording', { quality, seconds });
}

async function configure(me, width, height) {
  if (me.encoder && me.encoder.state !== 'closed') me.encoder.close();
  // a new size means a new stream: what came before can't go in the same file
  me.video = [];
  me.decoderConfig = null;
  me.lastKey = -Infinity;
  me.width = width;
  me.height = height;
  const { config, mux } = await pickEncoder(width, height, me.q.fps, Math.round(me.q.bitrate * Math.min(1, (width * height) / (me.q.maxWidth * me.q.maxHeight) + 0.2)));
  me.mux = mux;
  me.encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (meta?.decoderConfig) me.decoderConfig = meta.decoderConfig;
      me.video.push({ data, type: chunk.type, timestamp: chunk.timestamp, duration: chunk.duration });
      trim(me);
    },
    error: (err) => window.clip.send('error', { error: String(err?.message || err) }),
  });
  me.encoder.configure(config);
  window.clip.send('encoder', { codec: config.codec, width, height });
}

/** Keeps a little more than the clip length, starting on a keyframe. */
function trim(me) {
  const v = me.video;
  if (v.length < 2) return;
  const cutoff = v[v.length - 1].timestamp - (me.seconds + 3) * 1e6;
  let drop = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i].timestamp > cutoff) break;
    if (v[i].type === 'key') drop = i;
  }
  if (drop > 0) v.splice(0, drop);
  const a = me.audio;
  const first = v[0]?.timestamp ?? 0;
  let k = 0;
  while (k < a.length && a[k].timestamp < first - 1e6) k++;
  if (k) a.splice(0, k);
}

async function pump(reader, fn, me) {
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || me.stopped) {
        value?.close?.();
        break;
      }
      await fn(value);
    }
  } catch { /* the stream ended */ }
}

function stop() {
  const me = rec;
  if (!me) return;
  rec = null;
  me.stopped = true;
  try { me.encoder?.close(); } catch { /* closed */ }
  try { me.audioEncoder?.close(); } catch { /* closed */ }
  for (const t of me.stream.getTracks()) t.stop();
  for (const t of me.audioStream?.getTracks() || []) t.stop();
}

/** The last `seconds` as an MP4, and a JPEG poster. */
async function save(seconds) {
  const me = rec;
  if (!me || !me.video.length || !me.decoderConfig) throw new Error('Nothing recorded yet. Give it a few seconds.');
  const v = me.video;
  const endTs = v[v.length - 1].timestamp;
  let start = 0;
  for (let i = v.length - 1; i >= 0; i--) {
    if (v[i].type === 'key') {
      start = i;
      if (v[i].timestamp <= endTs - seconds * 1e6) break;
    }
  }
  const chunks = v.slice(start);
  const t0 = chunks[0].timestamp;
  const audio = me.audioConfig && me.audioMeta ? me.audio.filter((a) => a.timestamp >= t0 && a.timestamp <= endTs) : [];
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    // no frameRate: captured frames don't arrive on an exact grid, and rounding them onto one
    // can put two frames on the same tick
    video: { codec: me.mux, width: me.width, height: me.height },
    ...(audio.length ? { audio: { codec: 'opus', numberOfChannels: me.audioConfig.numberOfChannels, sampleRate: me.audioConfig.sampleRate } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: audio.length ? 'cross-track-offset' : 'offset',
  });
  chunks.forEach((c, i) => {
    const next = chunks[i + 1];
    const duration = next ? next.timestamp - c.timestamp : c.duration || Math.round(1e6 / me.q.fps);
    muxer.addVideoChunkRaw(c.data, c.type, c.timestamp, Math.max(1, duration), i === 0 ? { decoderConfig: me.decoderConfig } : undefined);
  });
  audio.forEach((a, i) => muxer.addAudioChunkRaw(a.data, 'key', a.timestamp, a.duration, i === 0 ? me.audioMeta : undefined));
  muxer.finalize();
  let poster = null;
  if (me.poster) {
    const c = new OffscreenCanvas(me.poster.width, me.poster.height);
    c.getContext('2d').drawImage(me.poster, 0, 0);
    poster = await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 })).arrayBuffer();
  }
  return { data: muxer.target.buffer, poster, seconds: Math.round((endTs - t0) / 1e6), sound: audio.length > 0, codec: me.mux };
}

window.clip.on(async (msg) => {
  try {
    if (msg.type === 'start') await start(msg);
    else if (msg.type === 'stop') stop();
    else if (msg.type === 'save') window.clip.send('saved', { id: msg.id, ...(await save(msg.seconds || rec?.seconds || 30)) });
  } catch (err) {
    window.clip.send('error', { id: msg.id, error: String(err?.message || err) });
  }
});
window.clip.send('ready');
