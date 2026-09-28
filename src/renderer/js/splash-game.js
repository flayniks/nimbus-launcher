// Cloud Hop: a tiny game for the splash window while Minecraft starts. Space, click or tap to
// hop the Nimbus cube between block pillars; coins are worth a bonus point. Best score is kept.
(() => {
  const W = 400;
  const H = 272;
  const GROUND = 24;
  const GRAVITY = 980;
  const HOP = -300;
  const BEST_KEY = 'nimbus.cloudhop.best';

  let canvas = null;
  let ctx = null;
  let raf = 0;
  let last = 0;
  let state = 'ready';
  let score = 0;
  let best = 0;
  let deadAt = 0;
  let shake = 0;
  let t = 0;
  const player = { y: H / 2, v: 0 };
  let pillars = [];
  let coins = [];
  let bits = [];
  let clouds = [];
  let groundX = 0;
  let a1 = '#7c5cff';
  let a2 = '#c084fc';

  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { best = 0; }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const speed = () => 140 + Math.min(90, score * 3);
  const gap = () => Math.max(76, 104 - score * 1.5);

  function reset() {
    state = 'ready';
    score = 0;
    player.y = H / 2 - 10;
    player.v = 0;
    pillars = [];
    coins = [];
    bits = [];
    for (let i = 0; i < 3; i++) spawnPillar(W + 60 + i * 175);
  }

  function spawnPillar(x) {
    const g = gap();
    const top = rnd(34, H - GROUND - g - 34);
    pillars.push({ x, top, g, passed: false, seed: Math.floor(Math.random() * 1e6) });
    if (Math.random() < 0.55) coins.push({ x: x + 22, y: top + g / 2, got: false, spin: Math.random() * 6 });
  }

  function hop() {
    if (state === 'dead') {
      if (performance.now() - deadAt < 600) return;
      reset();
    }
    if (state === 'ready') state = 'play';
    player.v = HOP;
    for (let i = 0; i < 6; i++) bits.push({ x: 90, y: player.y + 12, vx: rnd(-80, -20), vy: rnd(20, 90), life: 0.5, c: i % 2 ? a1 : a2 });
  }

  function die() {
    if (state !== 'play') return;
    state = 'dead';
    deadAt = performance.now();
    shake = 0.35;
    for (let i = 0; i < 26; i++) bits.push({ x: 100, y: player.y + 10, vx: rnd(-160, 160), vy: rnd(-200, 60), life: rnd(0.5, 1), c: [a1, a2, '#ffffff'][i % 3] });
    if (score > best) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* not kept then */ }
    }
  }

  function update(dt) {
    t += dt;
    for (const c of clouds) { c.x -= c.s * dt; if (c.x < -80) { c.x = W + 40; c.y = rnd(10, 120); } }
    if (state !== 'dead') groundX = (groundX - speed() * dt) % 22;
    if (state === 'ready') {
      player.y = H / 2 - 10 + Math.sin(t * 3) * 6;
    } else if (state === 'play') {
      player.v += GRAVITY * dt;
      player.y += player.v * dt;
      const sp = speed() * dt;
      for (const p of pillars) {
        p.x -= sp;
        if (!p.passed && p.x + 44 < 90) { p.passed = true; score++; }
      }
      for (const c of coins) {
        c.x -= sp;
        if (!c.got && Math.abs(c.x - 101) < 16 && Math.abs(c.y - (player.y + 11)) < 18) {
          c.got = true;
          score++;
          for (let i = 0; i < 10; i++) bits.push({ x: c.x, y: c.y, vx: rnd(-120, 120), vy: rnd(-120, 60), life: 0.6, c: '#fcd34d' });
        }
      }
      if (pillars[0] && pillars[0].x < -50) {
        pillars.shift();
        spawnPillar(pillars[pillars.length - 1].x + 175);
      }
      coins = coins.filter((c) => c.x > -20 && !c.got);
      // the sky is a soft ceiling; pillars reach it anyway, so there's no flying over them
      if (player.y < -4) { player.y = -4; player.v = Math.max(0, player.v); }
      if (player.y > H - GROUND - 22) die();
      for (const p of pillars) {
        if (90 + 20 > p.x && 90 + 2 < p.x + 44 && (player.y + 2 < p.top || player.y + 20 > p.top + p.g)) die();
      }
    } else if (state === 'dead') {
      player.v += GRAVITY * dt;
      player.y = Math.min(H - GROUND - 22, player.y + player.v * dt);
    }
    for (const b of bits) { b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 500 * dt; }
    bits = bits.filter((b) => b.life > 0);
    shake = Math.max(0, shake - dt);
  }

  // ---------------------------------------------------------------- drawing (pixel art)

  function block(x, y, kind, seed) {
    const cols = { grass: ['#5fbf3a', '#4fa82f', '#6fd34a'], dirt: ['#8a5a36', '#7a4e2e', '#9a6a44'], stone: ['#8a8f99', '#7a7f88', '#9aa0aa'], leaf: ['#2f8a3a', '#3fa04a', '#256f2e'] }[kind];
    ctx.fillStyle = cols[0];
    ctx.fillRect(x, y, 22, 22);
    let s = seed;
    for (let i = 0; i < 14; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      ctx.fillStyle = cols[1 + (s % 2)];
      ctx.fillRect(x + ((s >> 3) % 11) * 2, y + ((s >> 7) % 11) * 2, 2, 2);
    }
    if (kind === 'grass') { ctx.fillStyle = cols[2]; ctx.fillRect(x, y, 22, 6); ctx.fillStyle = '#7a4e2e'; ctx.fillRect(x, y + 6, 22, 2); }
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(x + 20, y, 2, 22);
    ctx.fillRect(x, y + 20, 22, 2);
  }

  function pillar(p) {
    const x = Math.round(p.x);
    // hanging from the sky: leaves and stone
    for (let y = p.top - 22, i = 0; y > -22; y -= 22, i++) block(x, y, i === 0 ? 'leaf' : 'stone', p.seed + i);
    block(x + 22, Math.round(p.top - 22), 'leaf', p.seed + 99);
    for (let y = p.top - 44, i = 0; y > -22 && i < 12; y -= 22, i++) block(x + 22, y, 'stone', p.seed + 50 + i);
    // growing from the ground: grass, then dirt
    const bottom = p.top + p.g;
    for (let y = bottom, i = 0; y < H - GROUND; y += 22, i++) {
      block(x, y, i === 0 ? 'grass' : 'dirt', p.seed + 200 + i);
      block(x + 22, y, i === 0 ? 'grass' : 'dirt', p.seed + 300 + i);
    }
  }

  function cube(y, tilt) {
    ctx.save();
    ctx.translate(101, y + 11);
    ctx.rotate(tilt);
    // front, top and side of the Nimbus cube
    ctx.fillStyle = a1;
    ctx.fillRect(-11, -8, 18, 19);
    ctx.fillStyle = a2;
    ctx.beginPath(); ctx.moveTo(-11, -8); ctx.lineTo(-6, -13); ctx.lineTo(12, -13); ctx.lineTo(7, -8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.moveTo(7, -8); ctx.lineTo(12, -13); ctx.lineTo(12, 6); ctx.lineTo(7, 11); ctx.closePath(); ctx.fill();
    // a face
    ctx.fillStyle = '#fff';
    ctx.fillRect(-7, -3, 4, 4); ctx.fillRect(1, -3, 4, 4);
    ctx.fillStyle = '#1b1240';
    ctx.fillRect(-5, -2, 2, 2); ctx.fillRect(3, -2, 2, 2);
    if (state === 'dead') { ctx.fillStyle = '#1b1240'; ctx.fillRect(-4, 5, 8, 2); }
    ctx.restore();
  }

  function coin(c) {
    const w = Math.abs(Math.cos(t * 5 + c.spin)) * 7 + 1;
    ctx.fillStyle = '#b45309';
    ctx.fillRect(c.x - w - 1, c.y - 8, (w + 1) * 2, 16);
    ctx.fillStyle = '#fcd34d';
    ctx.fillRect(c.x - w, c.y - 7, w * 2, 14);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    if (w > 3) ctx.fillRect(c.x - w + 2, c.y - 5, 2, 4);
  }

  function text(s, x, y, size, color = '#fff', align = 'center') {
    ctx.font = `800 ${size}px 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10, 8, 30, .75)';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-4, 4) * shake * 3, rnd(-4, 4) * shake * 3);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#171336');
    sky.addColorStop(1, '#2b2560');
    ctx.fillStyle = sky;
    ctx.fillRect(-10, -10, W + 20, H + 20);
    // stars and far hills
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 24; i++) ctx.fillRect((i * 97 + 13) % W, (i * 53) % 110, 2, 2);
    ctx.fillStyle = 'rgba(124, 92, 255, .18)';
    for (let i = 0; i < 6; i++) ctx.fillRect(((i * 90 - t * 12) % (W + 90) + W + 90) % (W + 90) - 90, H - GROUND - 40 - (i % 3) * 14, 90, 60);
    for (const c of clouds) {
      ctx.fillStyle = 'rgba(230, 228, 255, .16)';
      ctx.fillRect(Math.round(c.x), Math.round(c.y), c.w, 10);
      ctx.fillRect(Math.round(c.x) + 8, Math.round(c.y) - 6, c.w - 16, 6);
    }
    for (const p of pillars) pillar(p);
    for (const c of coins) coin(c);
    // the ground
    for (let x = groundX - 22; x < W + 22; x += 22) block(Math.round(x), H - GROUND, 'grass', Math.round(x - groundX) * 7);
    for (const b of bits) { ctx.globalAlpha = Math.max(0, Math.min(1, b.life * 2)); ctx.fillStyle = b.c; ctx.fillRect(b.x, b.y, 3, 3); }
    ctx.globalAlpha = 1;
    cube(player.y, state === 'ready' ? 0 : Math.max(-0.5, Math.min(1.1, player.v / 500)));
    if (state !== 'ready') text(String(score), W / 2, 42, 30);
    if (state === 'ready') {
      text('Cloud Hop', W / 2, 70, 26, a2);
      text('Space or click to hop', W / 2, 100, 14, '#e5e7eb');
      if (best) text(`Best ${best}`, W / 2, 122, 12, '#fcd34d');
    }
    if (state === 'dead') {
      text(score > 0 && score >= best ? 'New best!' : 'Ouch!', W / 2, 92, 24, score > 0 && score >= best ? '#fcd34d' : '#fca5a5');
      text(`Score ${score} · Best ${best}`, W / 2, 118, 14, '#e5e7eb');
      if (performance.now() - deadAt > 600) text('Space or click to go again', W / 2, 142, 12, '#c4b5fd');
    }
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000 || 0);
    last = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function onKey(e) {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); hop(); }
  }

  /** Puts the game into `host` and starts it. */
  function start(host) {
    const root = getComputedStyle(document.documentElement);
    a1 = root.getPropertyValue('--a1').trim() || a1;
    a2 = root.getPropertyValue('--a2').trim() || a2;
    canvas = document.createElement('canvas');
    canvas.className = 'hop';
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    host.appendChild(canvas);
    clouds = Array.from({ length: 5 }, (_, i) => ({ x: i * 90, y: rnd(10, 120), w: rnd(40, 70), s: rnd(8, 18) }));
    reset();
    canvas.addEventListener('pointerdown', (e) => { e.stopPropagation(); hop(); });
    document.addEventListener('keydown', onKey);
    last = performance.now();
    raf = requestAnimationFrame(loop);
    canvas.focus?.();
  }

  function stop() {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
  }

  /** Whether a run is going on (or just ended, so its score is still showing). */
  function running() {
    return state === 'play' || (state === 'dead' && performance.now() - deadAt < 1500);
  }

  window.cloudHop = { start, stop, running, best: () => best };
})();
