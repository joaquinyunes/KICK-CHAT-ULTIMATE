// Helpers compartidos del tema "dashboard" (body.kd).

// Sincroniza <input type="range" class="kd-range" data-for="<id del number>"> con su caja
// numérica. Escribir en cualquiera de los dos actualiza al otro y dispara `input` en la
// caja numérica, así el código que ya escucha ese input sigue funcionando igual.
export function bindRanges(root = document) {
  root.querySelectorAll('input.kd-range[data-for]').forEach((range) => {
    if (range.dataset.kdBound) return;
    const num = document.getElementById(range.dataset.for);
    if (!num) return;
    range.dataset.kdBound = '1';

    const paint = () => {
      const min = Number(range.min) || 0;
      const max = Number(range.max) || 100;
      const v = Math.min(max, Math.max(min, Number(range.value) || min));
      range.style.setProperty('--p', (max > min ? ((v - min) / (max - min)) * 100 : 0) + '%');
    };
    const fromRange = () => {
      num.value = range.value;
      num.dispatchEvent(new Event('input', { bubbles: true }));
      paint();
    };
    const fromNum = () => {
      const n = Number(num.value);
      if (!Number.isNaN(n)) range.value = String(n);
      paint();
    };
    range.addEventListener('input', fromRange);
    num.addEventListener('input', fromNum);
    num.addEventListener('change', fromNum);
    fromNum();
  });
}

// Marca como "on" la tarjeta-opción pulsada dentro de su grupo.
export function setOpt(group, mode) {
  group.querySelectorAll('[data-mode]').forEach((o) => {
    const on = o.dataset.mode === mode;
    o.classList.toggle('on', on);
    o.setAttribute('aria-pressed', String(on));
  });
}
