// The launch splash: fed by the main process while the game gets going.
(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const pct = $('pct');
  const bar = $('bar');
  const fill = $('fill');
  let lastStage = '';

  function setStage(text) {
    if (!text || text === lastStage) return;
    lastStage = text;
    stage.classList.add('swap');
    setTimeout(() => { stage.textContent = text; stage.classList.remove('swap'); }, 160);
  }

  window.splash.onUpdate((u) => {
    if (u.accent) document.documentElement.dataset.accent = u.accent;
    if (u.instance) $('instance').textContent = u.instance;
    if (u.stage) setStage(u.stage);
    if (u.progress == null) {
      bar.classList.add('indeterminate');
      pct.textContent = '';
    } else {
      bar.classList.remove('indeterminate');
      fill.style.width = `${Math.round(u.progress * 100)}%`;
      pct.textContent = `${Math.round(u.progress * 100)}%`;
    }
    if (u.leaving) $('card').classList.add('leaving');
  });

  document.addEventListener('click', () => window.splash.dismiss());
})();
