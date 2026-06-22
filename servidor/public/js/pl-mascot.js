function injectPLMascot() {
  if (document.querySelector('.pl-mascot')) return;
  const div = document.createElement('div');
  div.className = 'pl-mascot';
  div.innerHTML = `<svg viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="27" r="16.5" stroke="#3DDC97" stroke-width="1.3" fill="#11151B"/>
    <g class="pl-mascot-eyes">
      <circle cx="18" cy="24" r="2.2" fill="#3DDC97"/>
      <circle cx="30" cy="24" r="2.2" fill="#3DDC97"/>
    </g>
    <path d="M19.5 33c0 0 2 3 4.5 3s4.5-3 4.5-3" stroke="#3DDC97" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="37" cy="16" r="4" fill="#3DDC97" opacity="0.08"/>
    <circle cx="38" cy="15" r="1.2" fill="#3DDC97" opacity="0.15"/>
  </svg>`;
  document.body.appendChild(div);

  div.addEventListener('click', () => {
    const eyes = div.querySelector('.pl-mascot-eyes');
    if (!eyes) return;
    const blink = () => {
      eyes.style.transition = 'transform 0.06s ease';
      eyes.style.transform = 'scaleY(0.1)';
      setTimeout(() => { eyes.style.transform = 'scaleY(1)'; }, 100);
    };
    blink();
    setTimeout(blink, 200);
    setTimeout(blink, 350);
  });
}

function plSquint(loading) {
  const eyes = document.querySelector('.pl-mascot-eyes');
  if (!eyes) return;
  eyes.style.transition = 'transform 0.2s ease';
  eyes.style.transform = loading ? 'scaleY(0.1)' : 'scaleY(1)';
}

function plWiggle() {
  const m = document.querySelector('.pl-mascot');
  if (!m) return;
  m.style.transition = 'transform 0.06s ease';
  m.style.transform = 'rotate(-6deg)';
  setTimeout(() => { m.style.transform = 'rotate(4deg)'; }, 60);
  setTimeout(() => { m.style.transform = 'rotate(-3deg)'; }, 120);
  setTimeout(() => { m.style.transform = 'rotate(0)'; }, 180);
}

function injectPLDecor() {
  if (document.querySelector('.pl-scene')) return;
  const html = `
    <div class="pl-scene" aria-hidden="true"></div>
    <div class="pl-grid" aria-hidden="true"></div>
    <div class="pl-orbs" aria-hidden="true"><div class="pl-orb"></div><div class="pl-orb"></div><div class="pl-orb"></div></div>
    <div class="pl-grain" aria-hidden="true"></div>`;
  document.body.insertAdjacentHTML('afterbegin', html);
}

document.addEventListener('DOMContentLoaded', () => {
  injectPLDecor();
  injectPLMascot();
});
