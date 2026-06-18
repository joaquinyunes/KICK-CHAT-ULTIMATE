import { setServerUrl } from './bridge-client.js';

const form = document.getElementById('login-form');
const serverInput = document.getElementById('server-url');
const userInput = document.getElementById('username');
const passInput = document.getElementById('password');
const errorEl = document.getElementById('error-msg');
const submitBtn = document.getElementById('submit-btn');
const spinnerEl = document.getElementById('spinner');

function showError(msg) {
  if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; }
}

function clearError() {
  if (errorEl) { errorEl.textContent = ''; errorEl.hidden = true; }
}

function setLoading(loading) {
  if (submitBtn) submitBtn.disabled = loading;
  if (spinnerEl) spinnerEl.hidden = !loading;
}

async function handleSubmit(e) {
  e.preventDefault();
  clearError();

  const serverUrl = serverInput?.value.trim() || '';
  const username = userInput?.value.trim() || '';
  const password = passInput?.value || '';

  if (!serverUrl) { showError('Ingresa la URL del servidor.'); return; }
  if (!username) { showError('El usuario no puede estar vacío.'); return; }
  if (!password) { showError('La contraseña no puede estar vacía.'); return; }

  setServerUrl(serverUrl);
  localStorage.setItem('scb_server_url', serverUrl.replace(/\/+$/, ''));
  setLoading(true);

  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = res.status === 401 ? 'Credenciales incorrectas.' : res.status === 429 ? 'Demasiados intentos.' : data?.message || `Error ${res.status}`;
      showError(msg);
      return;
    }

    const token = data?.token || data?.access_token;
    if (!token) { showError('El servidor no devolvió un token válido.'); return; }

    sessionStorage.setItem('scb_jwt', token);
    localStorage.setItem('scb_jwt', token);
    let role = 'client';
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      role = payload.role || 'client';
      sessionStorage.setItem('scb_role', role);
      localStorage.setItem('scb_role', role);
    } catch {
      sessionStorage.setItem('scb_role', 'client');
      localStorage.setItem('scb_role', 'client');
    }

    window.location.href = role === 'admin' ? '/admin/dashboard' : '/chat.html';
  } catch (err) {
    showError(err?.name === 'TypeError' ? 'No se puede conectar al servidor.' : `Error: ${err?.message || 'desconocido'}`);
  } finally {
    setLoading(false);
  }
}

// Restore saved server URL
const savedUrl = localStorage.getItem('scb_server_url');
if (savedUrl && serverInput) serverInput.value = savedUrl;

form?.addEventListener('submit', handleSubmit);
