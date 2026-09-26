// Nimbus LAN, the WebRTC half: one peer connection per join, one data channel per TCP
// connection Minecraft opens. The main process owns the sockets; this window only moves bytes.
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const peers = new Map();
const HIGH = 8 * 1024 * 1024;

function gather(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 6000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}

function setup(sid) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const peer = { pc, channels: new Map() };
  peers.set(sid, peer);
  pc.addEventListener('connectionstatechange', () => window.net.send('state', { sid, state: pc.connectionState }));
  pc.addEventListener('datachannel', (e) => wire(sid, e.channel, true));
  return peer;
}

function wire(sid, dc, remote) {
  const peer = peers.get(sid);
  if (!peer) return;
  dc.binaryType = 'arraybuffer';
  dc.bufferedAmountLowThreshold = 1024 * 1024;
  const cid = dc.label;
  peer.channels.set(cid, dc);
  const opened = () => window.net.send(remote ? 'channel' : 'channel-open', { sid, cid });
  if (dc.readyState === 'open') opened();
  else dc.addEventListener('open', opened);
  dc.addEventListener('message', (e) => window.net.send('data', { sid, cid, data: new Uint8Array(e.data) }));
  dc.addEventListener('close', () => {
    peer.channels.delete(cid);
    window.net.send('channel-closed', { sid, cid });
  });
  dc.addEventListener('bufferedamountlow', () => window.net.send('resume', { sid, cid }));
}

async function describe(sid, pc) {
  await gather(pc);
  window.net.send('local-sdp', { sid, sdp: pc.localDescription.toJSON() });
}

window.net.on(async (msg) => {
  try {
    const peer = peers.get(msg.sid);
    switch (msg.type) {
      case 'offer': {
        const p = setup(msg.sid);
        p.pc.createDataChannel('ctl'); // something to negotiate before Minecraft connects
        await p.pc.setLocalDescription(await p.pc.createOffer());
        await describe(msg.sid, p.pc);
        break;
      }
      case 'answer': {
        const p = setup(msg.sid);
        await p.pc.setRemoteDescription(msg.sdp);
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        await describe(msg.sid, p.pc);
        break;
      }
      case 'remote-sdp':
        await peer?.pc.setRemoteDescription(msg.sdp);
        break;
      case 'open-channel':
        if (peer) wire(msg.sid, peer.pc.createDataChannel(msg.cid, { ordered: true }), false);
        break;
      case 'send': {
        const dc = peer?.channels.get(msg.cid);
        if (!dc || dc.readyState !== 'open') break;
        dc.send(msg.data);
        if (dc.bufferedAmount > HIGH) window.net.send('pause', { sid: msg.sid, cid: msg.cid });
        break;
      }
      case 'close-channel':
        peer?.channels.get(msg.cid)?.close();
        break;
      case 'close':
        peer?.pc.close();
        peers.delete(msg.sid);
        break;
      default:
    }
  } catch (err) {
    window.net.send('error', { sid: msg.sid, error: String(err && err.message || err) });
  }
});
