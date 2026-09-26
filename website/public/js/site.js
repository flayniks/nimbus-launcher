// Nimbus Launcher website: a 3D world behind the page that follows your scroll, plus the
// text, cursor and card effects on top. No build step, three.js is vendored.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(hover: none), (pointer: coarse)').matches;
const small = innerWidth < 760;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const back = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

const pointer = { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0 };
addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.nx = (e.clientX / innerWidth) * 2 - 1;
  pointer.ny = (e.clientY / innerHeight) * 2 - 1;
}, { passive: true });

// ======================================================================== 3D world
const world = (() => {
  const canvas = $('#world');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, powerPreference: 'high-performance' });
  } catch {
    document.body.classList.add('no-gl');
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#07070d');
  scene.fog = new THREE.FogExp2('#07070d', 0.03);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 400);
  camera.position.set(0, 0, 10);

  scene.add(new THREE.AmbientLight('#8b7bff', 0.35));
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(4, 6, 8);
  scene.add(key);
  const cyan = new THREE.PointLight('#22d3ee', 16, 30);
  cyan.position.set(-6, -2, 4);
  scene.add(cyan);
  const pink = new THREE.PointLight('#f472b6', 16, 30);
  pink.position.set(6, 3, -2);
  scene.add(pink);

  // ---- the Nimbus block: gradient faces, the light diamond on top, glowing edges
  const faceTexture = (top, a, b, diamond) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    if (diamond) {
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(70, 70, 116, 116);
    }
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 250, 250);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const side = (a, b) => new THREE.MeshStandardMaterial({ map: faceTexture(false, a, b), roughness: 0.32, metalness: 0.15, emissive: new THREE.Color('#2a1070'), emissiveIntensity: 0.2 });
  const topMat = new THREE.MeshStandardMaterial({ map: faceTexture(true, '#ffffff', '#d9ccff', true), roughness: 0.25, metalness: 0.05, emissive: new THREE.Color('#6a55c9'), emissiveIntensity: 0.25 });
  const mats = [side('#6d3df0', '#3a168f'), side('#b69cff', '#7043f0'), topMat, side('#2a1070', '#1a0a4a'), side('#b69cff', '#7043f0'), side('#6d3df0', '#3a168f')];
  const block = new THREE.Group();
  const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mats);
  cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.01, 2.01, 2.01)), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 })));
  cube.rotation.set(0.62, 0.78, 0);
  block.add(cube);

  // ---- the halo: gradient round the ring and a glint running round it
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uTime; uniform float uPower; varying vec2 vUv;
      vec3 grad(float t){ t = fract(t); float k = t * 3.0;
        vec3 a = vec3(0.133, 0.827, 0.933), b = vec3(0.655, 0.545, 0.98), c = vec3(0.957, 0.447, 0.714);
        return k < 1.0 ? mix(a, b, k) : k < 2.0 ? mix(b, c, k - 1.0) : mix(c, a, k - 2.0); }
      void main(){
        vec3 col = grad(vUv.x + uTime * 0.04);
        float glint = pow(max(0.0, cos((vUv.x - uTime * 0.22) * 6.2831)), 90.0);
        gl_FragColor = vec4(col * (1.25 * uPower) + vec3(glint * 2.5), 1.0);
      }`,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.09, 24, 320), ringMat);
  ring.rotation.set(1.18, 0, -0.28);
  block.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.9, 0.025, 12, 320), new THREE.MeshBasicMaterial({ color: '#c084fc', transparent: true, opacity: 0.55 }));
  ring2.rotation.set(1.25, 0.2, 0.35);
  block.add(ring2);

  // sparks orbiting the ring
  const sparkCount = 90;
  const sparkPos = new Float32Array(sparkCount * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.09, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  block.add(sparks);
  const sparkSeed = Array.from({ length: sparkCount }, () => [Math.random() * Math.PI * 2, 2.9 + Math.random() * 1.4, (Math.random() - 0.5) * 0.5, 0.2 + Math.random() * 0.6]);
  scene.add(block);

  // ---- stars
  const starCount = small ? 1400 : 3200;
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(starCount * 3);
  const sPhase = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const r = 40 + Math.random() * 120;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    sp[i * 3] = r * Math.sin(ph) * Math.cos(th);
    sp[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    sp[i * 3 + 2] = r * Math.cos(ph);
    sPhase[i] = Math.random() * 10;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('phase', new THREE.BufferAttribute(sPhase, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float phase; uniform float uTime; varying float vA; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vA = 0.45 + 0.55 * sin(uTime * 1.5 + phase * 7.0);
        vC = mix(vec3(0.55, 0.45, 1.0), vec3(0.4, 0.9, 1.0), fract(phase));
        gl_PointSize = (1.0 + fract(phase * 3.1) * 2.0) * (110.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        gl_FragColor = vec4(mix(vec3(1.0), vC, 0.5), 0.8 * vA * smoothstep(0.5, 0.0, d)); }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ---- the voxel storm: little Minecraft-ish cubes rushing past
  const voxCount = small ? 260 : 620;
  const vox = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.25, emissive: new THREE.Color('#1a0f40'), emissiveIntensity: 0.15 }), voxCount);
  const palette = ['#7c5cff', '#c084fc', '#22d3ee', '#f472b6', '#ffffff', '#6aa84f', '#8b5a2b', '#9ca3af'].map((c) => new THREE.Color(c));
  const voxData = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < voxCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.5 + Math.random() * 16;
    voxData.push({
      x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7, z: -Math.random() * 120 + 8,
      rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 2,
      s: 0.5 + Math.random() * 1.6,
      // the intro: every voxel starts in the middle and is thrown out
      bx: (Math.random() - 0.5) * 2, by: (Math.random() - 0.5) * 2, bz: (Math.random() - 0.5) * 2,
    });
    vox.setColorAt(i, palette[i % palette.length]);
  }
  vox.instanceColor.needsUpdate = true;
  scene.add(vox);

  // ---- the explosion at the end: the block bursts into voxels
  const burstCount = 220;
  const burst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshStandardMaterial({ roughness: 0.3, emissive: new THREE.Color('#3a1a9a'), emissiveIntensity: 0.9 }), burstCount);
  const burstData = Array.from({ length: burstCount }, (_, i) => {
    burst.setColorAt(i, palette[i % 5]);
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    return { d, v: 6 + Math.random() * 14, spin: (Math.random() - 0.5) * 10 };
  });
  burst.instanceColor.needsUpdate = true;
  burst.visible = false;
  scene.add(burst);

  // ---- bloom
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.9, 0.45, 0.62);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  const state = { intro: 0, hero: 0, final: 0, warp: 0, burstAt: -1, shake: 0 };
  const clock = new THREE.Clock();
  let camX = 0;
  let camY = 0;

  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    ringMat.uniforms.uTime.value = t;
    starMat.uniforms.uTime.value = t;

    const intro = back(clamp(state.intro));
    const hp = state.hero;
    const fp = state.final;
    const wide = innerWidth > 900;

    // hero: the block sits to the right of the words, then the camera dives into it
    const dive = ease(clamp((hp - 0.3) / 0.62));
    const inHero = hp < 1;
    const baseX = wide ? lerp(3.4, 0, ease(clamp(hp / 0.45))) : 0;
    const baseY = wide ? 0 : lerp(2.9, 0, ease(clamp(hp / 0.45)));
    let scale = intro * (inHero ? lerp(wide ? 1 : 0.72, 1.35, dive) : 0);
    // the end: it comes back behind "READY?"
    if (!inHero) scale = back(clamp(fp * 1.25)) * 1.6;
    if (state.burstAt >= 0) scale *= clamp(1 - (t - state.burstAt) * 6);
    block.scale.setScalar(Math.max(0.0001, scale));
    block.position.set(inHero ? baseX : 0, inHero ? baseY : -0.4, inHero ? 0 : -9);
    cube.rotation.y += dt * (0.35 + dive * 3 + (inHero ? 0 : fp * 0.8));
    cube.rotation.x = 0.62 + Math.sin(t * 0.6) * 0.08;
    block.rotation.z = Math.sin(t * 0.4) * 0.05;
    ring.rotation.z = -0.28 + t * 0.12;
    ring2.rotation.z = 0.35 - t * 0.2;
    ringMat.uniforms.uPower.value = 1 + dive * 1.5 + (inHero ? 0 : fp);
    for (let i = 0; i < sparkCount; i++) {
      const [a0, r, h, sp2] = sparkSeed[i];
      const a = a0 + t * sp2;
      sparkPos[i * 3] = Math.cos(a) * r;
      sparkPos[i * 3 + 1] = h + Math.sin(a * 3 + t) * 0.12;
      sparkPos[i * 3 + 2] = Math.sin(a) * r * 0.35;
    }
    sparkGeo.attributes.position.needsUpdate = true;

    // camera: parallax with the mouse, and the dive
    camX = lerp(camX, pointer.nx * 0.9, 0.05);
    camY = lerp(camY, -pointer.ny * 0.6, 0.05);
    const camZ = inHero ? lerp(10, 1.2, dive) : 10;
    state.shake *= 0.9;
    camera.position.set(camX + (Math.random() - 0.5) * state.shake, camY + (Math.random() - 0.5) * state.shake, camZ);
    camera.lookAt(inHero ? baseX * dive : 0, inHero ? baseY * dive : 0, -4);
    camera.fov = inHero ? lerp(50, 95, dive) : 50;
    camera.updateProjectionMatrix();

    // voxels: thrown out at the start, then streaming past; faster while diving and scrolling
    const speed = 4 + state.warp * 60 + (inHero ? dive * 90 : 0);
    const stretch = 1 + Math.min(8, speed / 14);
    for (let i = 0; i < voxCount; i++) {
      const v = voxData[i];
      v.z += speed * dt;
      if (v.z > 12) v.z -= 130;
      v.rx += v.spin * dt;
      v.ry += v.spin * dt * 0.7;
      const k = intro;
      dummy.position.set(lerp(v.bx, v.x, k), lerp(v.by, v.y, k), lerp(v.bz, v.z, k));
      dummy.rotation.set(v.rx, v.ry, 0);
      dummy.scale.set(v.s, v.s, v.s * (speed > 20 ? stretch : 1));
      if (speed > 20) dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      vox.setMatrixAt(i, dummy.matrix);
    }
    vox.instanceMatrix.needsUpdate = true;
    stars.rotation.y = t * 0.01 + camX * 0.02;

    // burst
    if (state.burstAt >= 0) {
      const k = t - state.burstAt;
      burst.visible = k < 3.2;
      for (let i = 0; i < burstCount; i++) {
        const b = burstData[i];
        const d = b.v * (1 - Math.exp(-k * 2.2));
        dummy.position.set(b.d.x * d, b.d.y * d - k * k * 0.6 - 0.4, b.d.z * d - 9);
        dummy.rotation.set(k * b.spin, k * b.spin * 0.7, 0);
        dummy.scale.setScalar(clamp(1.4 - k * 0.45));
        dummy.updateMatrix();
        burst.setMatrixAt(i, dummy.matrix);
      }
      burst.instanceMatrix.needsUpdate = true;
      if (k > 3.2) state.burstAt = -1;
    }

    bloom.strength = 0.85 + dive * 0.9 + state.shake * 1.5;
    composer.render();
  }

  return {
    state,
    frame,
    explode() {
      state.burstAt = clock.elapsedTime;
      state.shake = 0.6;
    },
  };
})();

// ======================================================================== text effects
const STOPS = ['#22d3ee', '#7c5cff', '#c084fc', '#f472b6'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
function gradientAt(t) {
  const x = clamp(t) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}

// split letters so each one can flip up into place
for (const el of $$('[data-split]')) {
  let i = 0;
  for (const line of $$('.line', el)) {
    const words = line.textContent.split(' ');
    line.textContent = '';
    words.forEach((word, w) => {
      const box = document.createElement('span');
      box.className = 'word';
      for (const ch of word) {
        const s = document.createElement('span');
        s.className = 'char';
        s.style.setProperty('--i', i++);
        s.textContent = ch;
        box.appendChild(s);
      }
      line.appendChild(box);
      if (w < words.length - 1) line.appendChild(document.createTextNode(' '));
    });
    // gradient text can't paint through letters that move on their own: colour each letter instead
    if (line.classList.contains('grad') || el.classList.contains('giant')) {
      const chars = $$('.char', line);
      chars.forEach((c, k) => { c.style.color = gradientAt(chars.length > 1 ? k / (chars.length - 1) : 0); });
      line.classList.add('grad-chars');
    }
  }
}

// letters flicker through random glyphs before they settle
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&$@<>/\\{}[]01';
function scramble(el) {
  const final = el.dataset.text || el.textContent;
  el.dataset.text = final;
  const start = performance.now();
  const dur = 900 + final.length * 30;
  const tick = (now) => {
    const k = (now - start) / dur;
    let out = '';
    for (let i = 0; i < final.length; i++) {
      const settle = i / final.length;
      out += final[i] === ' ' || k > settle + 0.25 ? final[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (k < 1.3) requestAnimationFrame(tick);
    else el.textContent = final;
  };
  requestAnimationFrame(tick);
}

// ======================================================================== reveal on scroll
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target;
    el.classList.add('in');
    if (el.matches('[data-scramble]')) scramble(el);
    if (el.matches('[data-split]')) el.classList.add('split-in');
    if (el.matches('.stat b')) countUp(el);
    seen.unobserve(el);
  }
}, { threshold: 0.18 });
$$('.reveal-up').forEach((el) => {
  const sibs = [...el.parentElement.children].filter((c) => c.classList.contains('reveal-up'));
  el.style.setProperty('--d', `${sibs.indexOf(el) * 110}ms`);
});
$$('.card').forEach((el, i) => el.style.setProperty('--d', `${(i % 3) * 120 + Math.floor(i / 3) * 80}ms`));

function countUp(el) {
  const target = Number(el.dataset.count) || 0;
  const plus = el.hasAttribute('data-plus') ? '+' : '';
  const start = performance.now();
  const tick = (now) => {
    const k = clamp((now - start) / 1600);
    el.textContent = Math.round(target * ease(k)).toLocaleString() + (k >= 1 ? plus : '');
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ======================================================================== live numbers
(async () => {
  try {
    const base = 'https://abacus.jasoncameron.dev/get/nimbus-launcher/';
    const get = async (k) => { try { const r = await fetch(base + k); return r.ok ? (await r.json()).value || 0 : 0; } catch { return 0; } };
    const w = Math.floor(Date.now() / 300000);
    const [on1, on0, play1, play0, total] = await Promise.all([get(`online-${w}`), get(`online-${w - 1}`), get(`playing-${w}`), get(`playing-${w - 1}`), get('players-total')]);
    const online = Math.max(on1, on0);
    const playing = Math.max(play1, play0);
    $('#statOnline').dataset.count = online;
    $('#statPlayers').dataset.count = total;
    if (online || playing) $('#liveLine').textContent = `${online.toLocaleString()} online · ${playing.toLocaleString()} playing right now`;
  } catch { /* numbers stay as they are */ }
})();
(async () => {
  try {
    const r = await fetch('https://api.github.com/repos/flayniks/nimbus-launcher/releases/latest');
    const rel = await r.json();
    const exe = (rel.assets || []).find((a) => a.name === 'Nimbus-Launcher-Setup.exe');
    const version = String(rel.tag_name || '').replace(/^nimbus-v/, 'v');
    if (version) $('#versionLine').textContent = `${version} · Windows 10 / 11 · ${exe ? `${Math.round(exe.size / 1048576)} MB` : '64-bit'}`;
  } catch { /* keeps the plain line */ }
})();

// ======================================================================== cursor, trail, magnets
const cursor = $('.cursor');
const trail = $('#trail');
const tg = trail.getContext('2d');
const dots = [];
let ringX = pointer.x;
let ringY = pointer.y;
let lastX = pointer.x;
let lastY = pointer.y;
function sizeTrail() {
  trail.width = innerWidth * devicePixelRatio;
  trail.height = innerHeight * devicePixelRatio;
  tg.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
sizeTrail();
addEventListener('resize', sizeTrail);
if (!touch && !calm) document.body.classList.add('custom-cursor');

const TRAIL_COLORS = ['#22d3ee', '#7c5cff', '#c084fc', '#f472b6', '#ffffff'];
function drawTrail() {
  if (!touch && !calm) {
    const dx = pointer.x - lastX;
    const dy = pointer.y - lastY;
    const moved = Math.hypot(dx, dy);
    for (let i = 0; i < Math.min(6, moved / 6); i++) {
      dots.push({ x: pointer.x - dx * (i / 6) + (Math.random() - 0.5) * 6, y: pointer.y - dy * (i / 6) + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8 - 0.3, life: 1, c: TRAIL_COLORS[(Math.random() * TRAIL_COLORS.length) | 0], s: 2 + Math.random() * 3, square: Math.random() < 0.5 });
    }
    lastX = pointer.x;
    lastY = pointer.y;
    ringX = lerp(ringX, pointer.x, 0.18);
    ringY = lerp(ringY, pointer.y, 0.18);
    cursor.style.transform = `translate(${ringX}px, ${ringY}px)`;
    cursor.firstElementChild.style.transform = `translate(${pointer.x - ringX}px, ${pointer.y - ringY}px)`;
  }
  tg.clearRect(0, 0, innerWidth, innerHeight);
  tg.globalCompositeOperation = 'lighter';
  for (let i = dots.length - 1; i >= 0; i--) {
    const d = dots[i];
    d.x += d.vx;
    d.y += d.vy;
    d.vy += d.g || 0;
    d.life -= d.decay || 0.025;
    if (d.life <= 0) { dots.splice(i, 1); continue; }
    tg.globalAlpha = d.life;
    tg.fillStyle = d.c;
    if (d.square) {
      tg.save();
      tg.translate(d.x, d.y);
      tg.rotate(d.r || 0);
      d.r = (d.r || 0) + (d.vr || 0);
      tg.fillRect(-d.s / 2, -d.s / 2, d.s, d.s);
      tg.restore();
    } else {
      tg.beginPath();
      tg.arc(d.x, d.y, d.s * d.life, 0, Math.PI * 2);
      tg.fill();
    }
  }
  tg.globalAlpha = 1;
}
for (const el of $$('a, button, .card, .shot')) {
  el.addEventListener('pointerenter', () => cursor.classList.add('big'));
  el.addEventListener('pointerleave', () => cursor.classList.remove('big'));
}
for (const el of $$('[data-magnet]')) {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${x * 0.28}px, ${y * 0.38}px)`;
  });
  el.addEventListener('pointerleave', () => {
    el.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
    el.style.transform = '';
    setTimeout(() => { el.style.transition = ''; }, 600);
  });
}

// every click sends out a shockwave
addEventListener('pointerdown', (e) => {
  if (calm) return;
  const s = document.createElement('div');
  s.className = 'shock';
  s.style.left = `${e.clientX}px`;
  s.style.top = `${e.clientY}px`;
  document.body.appendChild(s);
  setTimeout(() => s.remove(), 800);
});

// download: a burst of pixel confetti, and the block explodes when it's on screen
function confetti(x, y) {
  for (let i = 0; i < 160; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 4 + Math.random() * 12;
    dots.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, g: 0.35, life: 1, decay: 0.008 + Math.random() * 0.01, c: TRAIL_COLORS[i % TRAIL_COLORS.length], s: 5 + Math.random() * 8, square: true, vr: (Math.random() - 0.5) * 0.3 });
  }
}
const flash = $('.flash');
for (const a of $$('[data-download]')) {
  a.addEventListener('click', (e) => {
    const r = a.getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top + r.height / 2);
    if (world && world.state.final > 0.5) world.explode();
    flash.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' });
  });
}

// cards lean towards the mouse, with a light under it
for (const card of $$('.card')) {
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--mx', `${x * 100}%`);
    card.style.setProperty('--my', `${y * 100}%`);
    card.style.setProperty('--ry', `${(x - 0.5) * 16}deg`);
    card.style.setProperty('--rx', `${(0.5 - y) * 14}deg`);
  });
  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
}

// ======================================================================== scroll choreography
const nav = $('.nav');
const hero = $('#hero');
const heroCopy = $('.hero-copy');
const hint = $('.scroll-hint');
const gallery = $('#gallery');
const track = $('.gallery-track');
const shots = $$('.shot');
const finalSec = $('#download');
const floats = $$('.float');
const marquee = $('.marquee');
let smooth = scrollY;
let lastScroll = scrollY;
let velocity = 0;

function progressOf(el, startAt = 0) {
  const r = el.getBoundingClientRect();
  const span = el.offsetHeight - innerHeight;
  return clamp((-r.top + startAt) / Math.max(1, span));
}

function onScrollFrame() {
  smooth = lerp(smooth, scrollY, 0.12);
  velocity = lerp(velocity, scrollY - lastScroll, 0.2);
  lastScroll = scrollY;
  nav.classList.toggle('solid', scrollY > 40);

  // hero: words drift away while the camera dives
  const hp = progressOf(hero);
  if (!calm) {
    heroCopy.style.transform = `translate3d(0, ${-hp * 180}px, 0) scale(${1 - hp * 0.2})`;
    heroCopy.style.opacity = String(clamp(1 - hp * 1.9));
    heroCopy.style.filter = `blur(${hp * 14}px)`;
    hint.style.opacity = String(clamp(1 - hp * 5));
  }
  // the white-out as the camera enters the block
  const whiteout = clamp((hp - 0.8) / 0.12) * clamp((1 - hp) / 0.06);
  if (!flash.getAnimations().length) flash.style.opacity = String(whiteout * 0.95);

  // gallery: vertical scroll becomes a sideways ride; the shots turn as they pass
  const gp = progressOf(gallery);
  const max = track.scrollWidth - innerWidth;
  track.style.transform = `translate3d(${-gp * max}px, 0, 0)`;
  for (const s of shots) {
    const r = s.getBoundingClientRect();
    const off = (r.left + r.width / 2 - innerWidth / 2) / innerWidth;
    s.style.setProperty('--turn', `${clamp(off * -35, -35, 35)}deg`);
    s.style.setProperty('--sc', String(1 - Math.min(0.15, Math.abs(off) * 0.18)));
  }

  // in-game pictures float at different depths
  floats.forEach((f, i) => {
    const r = f.parentElement.getBoundingClientRect();
    const k = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
    f.style.transform = `translate3d(${pointer.nx * (i + 1) * 8}px, ${k * (i + 1) * -60}px, 0) rotate(${(i - 1) * 2 + k * 3}deg)`;
  });

  // the marquee leans into fast scrolling
  marquee.style.transform = `rotate(-3deg) scale(1.05) skewX(${clamp(-velocity * 0.4, -12, 12)}deg)`;

  if (world) {
    world.state.hero = hp;
    world.state.warp = clamp(Math.abs(velocity) / 60);
    const fr = finalSec.getBoundingClientRect();
    world.state.final = clamp(1 - (fr.top + fr.height * 0.25) / innerHeight);
  }
}

// ======================================================================== intro, then run
const intro = $('.intro');
const count = $('.intro-count span');
function loop() {
  onScrollFrame();
  drawTrail();
  if (world) world.frame();
  requestAnimationFrame(loop);
}

async function start() {
  const images = $$('img').filter((i) => !i.complete).slice(0, 8);
  const fonts = document.fonts?.ready || Promise.resolve();
  let shown = 0;
  const introTime = calm ? 150 : 1500;
  const t0 = performance.now();
  requestAnimationFrame(loop);
  await new Promise((resolve) => {
    const tick = () => {
      const k = clamp((performance.now() - t0) / introTime);
      shown = Math.round(ease(k) * 100);
      count.textContent = shown;
      if (k < 1) requestAnimationFrame(tick);
      else Promise.race([Promise.all([fonts, ...images.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))]), new Promise((r) => setTimeout(r, 1200))]).then(resolve);
    };
    tick();
  });
  intro.classList.add('done');
  document.body.classList.remove('loading');
  flash.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' });
  if (world) {
    world.state.shake = 0.35;
    const s = performance.now();
    const grow = (now) => {
      world.state.intro = clamp((now - s) / 1400);
      if (world.state.intro < 1) requestAnimationFrame(grow);
    };
    requestAnimationFrame(grow);
  }
  setTimeout(() => {
    $('.hero .mega').classList.add('split-in');
    $$('.hero .reveal-up').forEach((el) => el.classList.add('in'));
  }, calm ? 0 : 250);
  setTimeout(() => intro.remove(), 1300);
  $$('.reveal-up:not(.hero .reveal-up), [data-scramble], .final [data-split], .card, .stat b, .phone').forEach((el) => seen.observe(el));
}
start();
