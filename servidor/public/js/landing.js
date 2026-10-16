// landing.js — progreso de scroll por escena (--p), apariciones y tabs del panel.
(() => {
  document.documentElement.classList.add('js');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Escenas pegajosas: --p = cuánto de la escena ya se scrolleó.
  // Bloques [data-pass]: --p = cuánto del bloque cruzó la pantalla.
  const scenes = [...document.querySelectorAll('[data-scene]')];
  const passes = [...document.querySelectorAll('[data-pass]')];
  let queued = false;

  function frame() {
    queued = false;
    const vh = innerHeight;
    for (const s of scenes) {
      const r = s.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue; // fuera de pantalla: no tocar estilos
      const p = clamp(-r.top / Math.max(1, r.height - vh));
      s.style.setProperty('--p', p.toFixed(4));
      const steps = Number(s.dataset.steps) || 0;
      if (steps) s.dataset.step = String(Math.min(steps - 1, Math.floor(p * 1.7 * steps)));
    }
    for (const b of passes) {
      const r = b.getBoundingClientRect();
      b.style.setProperty('--p', clamp((vh - r.top) / (vh + r.height)).toFixed(4));
    }
  }
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };

  if (reduce) {
    for (const s of scenes) if (s.dataset.steps) s.dataset.step = '0';
    for (const b of passes) b.style.setProperty('--p', '1');
  } else {
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    frame();
  }

  // Aparición de bloques al entrar en pantalla.
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }, { rootMargin: '0px 0px -12% 0px' })
    : null;
  document.querySelectorAll('.reveal').forEach((el) => (io && !reduce ? io.observe(el) : el.classList.add('in')));

  // Si ya hay sesión, los botones llevan directo al panel.
  try {
    if (localStorage.getItem('scb_jwt') || sessionStorage.getItem('scb_jwt')) {
      document.querySelectorAll('[data-panel-link]').forEach((a) => {
        a.href = '/kc';
        if (a.textContent.trim() === 'Entrar' || a.textContent.trim() === 'Entrar al panel') a.textContent = 'Ir al panel';
      });
    }
  } catch { /* storage bloqueado: quedan los links a /login */ }

  // Tabs del panel de ejemplo (patrón ARIA: flechas mueven el foco).
  const tabs = [...document.querySelectorAll('.app-tabs [role="tab"]')];
  function select(tab) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });
})();
