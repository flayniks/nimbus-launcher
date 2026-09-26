// The launch splash: fed by the main process while the game gets going.
(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const pct = $('pct');
  const bar = $('bar');
  const fill = $('fill');
  // Launch steps can come and go within a few frames (a quick file check, an already
  // installed version), so the text and bar only follow changes that stick around.
  let shown = '';
  let pending = '';
  let stageAt = 0;
  let stageTimer = null;
  let busyTimer = null;
  let last = null;

  function showStage() {
    stageTimer = null;
    if (pending === shown) return;
    shown = pending;
    stageAt = Date.now();
    stage.classList.add('swap');
    setTimeout(() => { stage.textContent = shown; stage.classList.remove('swap'); }, 160);
  }

  function setStage(text) {
    if (!text) return;
    pending = text;
    if (text === shown) { clearTimeout(stageTimer); stageTimer = null; return; }
    const wait = 600 - (Date.now() - stageAt);
    if (wait <= 0) showStage();
    else if (!stageTimer) stageTimer = setTimeout(showStage, wait);
  }

  function setProgress(p) {
    if (p == null) {
      if (last == null || busyTimer) return;
      busyTimer = setTimeout(() => {
        busyTimer = null;
        last = null;
        bar.classList.add('indeterminate');
        pct.textContent = '';
      }, 450);
      return;
    }
    clearTimeout(busyTimer);
    busyTimer = null;
    const v = Math.max(0, Math.min(1, p));
    if (last == null || v < last - 0.02) {
      // a new step: jump back instead of sliding backwards
      fill.style.transition = 'none';
      fill.style.width = `${Math.round(v * 100)}%`;
      bar.classList.remove('indeterminate');
      void fill.offsetWidth;
      fill.style.transition = '';
    } else {
      fill.style.width = `${Math.round(v * 100)}%`;
    }
    pct.textContent = `${Math.round(v * 100)}%`;
    last = v;
  }

  window.splash.onUpdate((u) => {
    if (u.accent) document.documentElement.dataset.accent = u.accent;
    if (u.look) {
      const root = document.documentElement;
      if (u.look.a1) root.style.setProperty('--a1', u.look.a1);
      if (u.look.a2) root.style.setProperty('--a2', u.look.a2);
      root.dataset.particles = u.look.particles ? 'on' : 'off';
      root.dataset.style = !u.look.style || u.look.style === 'cube' ? 'spin' : u.look.style;
      document.body.classList.toggle('still', Boolean(u.look.still));
    }
    if (u.instance) $('instance').textContent = u.instance;
    if (u.stage) setStage(u.stage);
    if ('progress' in u) setProgress(u.progress);
    if (u.leaving) $('card').classList.add('leaving');
  });

  document.addEventListener('click', () => window.splash.dismiss());
})();
