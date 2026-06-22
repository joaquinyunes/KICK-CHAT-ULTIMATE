const form = document.getElementById('login-form');
const userInput = document.getElementById('username');
const passInput = document.getElementById('password');
const errorEl = document.getElementById('error-msg');
const submitBtn = document.getElementById('submit-btn');
const spinnerEl = document.getElementById('spinner');
const faceEl = document.querySelector('.face');

faceEl?.addEventListener('click', () => {
  const eyes = faceEl.querySelector('.face-eyes');
  if (!eyes) return;
  eyes.style.transition = 'transform 0.08s ease';
  eyes.style.transform = 'scaleY(0.1)';
  setTimeout(() => { eyes.style.transform = 'scaleY(1)'; }, 120);
  setTimeout(() => { eyes.style.transform = 'scaleY(0.1)'; }, 220);
  setTimeout(() => { eyes.style.transform = 'scaleY(1)'; }, 320);
});

function wiggleFace() {
  if (!faceEl) return;
  faceEl.style.transition = 'transform 0.08s ease';
  faceEl.style.transform = 'rotate(-8deg)';
  setTimeout(() => { faceEl.style.transform = 'rotate(6deg)'; }, 80);
  setTimeout(() => { faceEl.style.transform = 'rotate(-4deg)'; }, 160);
  setTimeout(() => { faceEl.style.transform = 'rotate(0)'; }, 240);
}

function showError(msg) {
  if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; }
}

function clearError() {
  if (errorEl) { errorEl.textContent = ''; errorEl.hidden = true; }
}

function setLoading(loading) {
  if (submitBtn) submitBtn.disabled = loading;
  if (spinnerEl) spinnerEl.hidden = !loading;
  if (submitBtn) submitBtn.dataset.loading = loading ? 'true' : 'false';
  const eyes = faceEl?.querySelector('.face-eyes');
  if (eyes) {
    if (loading) {
      eyes.style.transition = 'transform 0.2s ease';
      eyes.style.transform = 'scaleY(0.1)';
    } else {
      eyes.style.transition = 'transform 0.3s ease';
      eyes.style.transform = 'scaleY(1)';
    }
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  clearError();

  const username = userInput?.value.trim() || '';
  const password = passInput?.value || '';
  const serverUrl = window.location.origin;

  if (!username) { showError('El usuario no puede estar vacío.'); wiggleFace(); return; }
  if (!password) { showError('La contraseña no puede estar vacía.'); wiggleFace(); return; }

  setLoading(true);

  try {
    const res = await fetch(serverUrl + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = res.status === 401 ? 'Credenciales incorrectas.' : res.status === 429 ? 'Demasiados intentos.' : data?.message || 'Error ' + res.status;
      showError(msg);
      wiggleFace();
      return;
    }

    const token = data?.token || data?.access_token;
    if (!token) { showError('El servidor no devolvió un token válido.'); wiggleFace(); return; }

    sessionStorage.setItem('scb_jwt', token);
    localStorage.setItem('scb_jwt', token);
    let role = 'client';
    let permissions = ['chat', 'simulator', 'vods'];
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      role = payload.role || 'client';
      if (payload.permissions) {
        try { permissions = JSON.parse(payload.permissions); } catch { permissions = ['chat', 'simulator', 'vods']; }
      }
      sessionStorage.setItem('scb_role', role);
      localStorage.setItem('scb_role', role);
    } catch {
      sessionStorage.setItem('scb_role', 'client');
      localStorage.setItem('scb_role', 'client');
    }

    if (role === 'admin') {
      window.location.href = '/admin/dashboard';
    } else if (permissions.includes('vods') && !permissions.includes('chat')) {
      window.location.href = '/vods.html';
    } else {
      window.location.href = '/chat.html';
    }
  } catch (err) {
    showError(err?.name === 'TypeError' ? 'No se puede conectar al servidor.' : 'Error: ' + (err?.message || 'desconocido'));
    wiggleFace();
  } finally {
    setLoading(false);
  }
}

form?.addEventListener('submit', handleSubmit);
