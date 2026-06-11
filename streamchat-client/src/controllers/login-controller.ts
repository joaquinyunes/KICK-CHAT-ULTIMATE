/**
 * login-controller.ts  –  StreamChat Bridge FASE 2
 *
 * Flujo:
 *  1. Carga la serverUrl desde settings.json (vía IPC) y la pone en sessionStorage.
 *  2. Recibe usuario/contraseña del formulario.
 *  3. Hace POST a /auth/login del servidor.
 *  4. Guarda el JWT en sessionStorage (volátil).
 *  5. Navega a chat.html.
 *
 * NUNCA se almacena el token Bearer de Kick aquí.
 * NUNCA se importan módulos de cifrado.
 */

import { setServerUrl } from '../bridge-client';

// ──────────────────────────────────────────────────────────────
// Referencias al DOM (se resuelven en init())
// ──────────────────────────────────────────────────────────────

let formEl:     HTMLFormElement   | null = null;
let userInput:  HTMLInputElement  | null = null;
let passInput:  HTMLInputElement  | null = null;
let serverInput:HTMLInputElement  | null = null;
let submitBtn:  HTMLButtonElement | null = null;
let errorEl:    HTMLElement       | null = null;
let spinnerEl:  HTMLElement       | null = null;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function showError(msg: string): void {
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.hidden      = false;
}

function clearError(): void {
  if (!errorEl) return;
  errorEl.textContent = '';
  errorEl.hidden      = true;
}

function setLoading(loading: boolean): void {
  if (submitBtn) submitBtn.disabled = loading;
  if (spinnerEl) spinnerEl.hidden   = !loading;
}

// ──────────────────────────────────────────────────────────────
// Lógica de login
// ──────────────────────────────────────────────────────────────

async function handleSubmit(e: Event): Promise<void> {
  e.preventDefault();
  clearError();

  const username  = userInput?.value.trim()   ?? '';
  const password  = passInput?.value          ?? '';
  const serverUrl = serverInput?.value.trim() ?? '';

  // Validaciones client-side
  if (!serverUrl) { showError('Ingresa la URL del servidor.');    return; }
  if (!username)  { showError('El usuario no puede estar vacío.'); return; }
  if (!password)  { showError('La contraseña no puede estar vacía.'); return; }

  // Almacena URL en sessionStorage y en el bridge
  setServerUrl(serverUrl);
  sessionStorage.setItem('scb_server_url', serverUrl.replace(/\/+$/, ''));

  setLoading(true);

  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg =
        res.status === 401 ? 'Credenciales incorrectas.'   :
        res.status === 429 ? 'Demasiados intentos. Espera un momento.' :
        (data as any)?.message ?? `Error del servidor (${res.status}).`;
      showError(msg);
      return;
    }

    const token: string = (data as any)?.token ?? (data as any)?.access_token ?? '';

    if (!token) {
      showError('El servidor no devolvió un token válido.');
      return;
    }

    // Almacena JWT de forma volátil (se borra al cerrar la ventana)
    sessionStorage.setItem('scb_jwt', token);

    // Guardar rol desde el payload del JWT
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      sessionStorage.setItem('scb_role', payload.role || 'client');
    } catch {
      sessionStorage.setItem('scb_role', 'client');
    }

    // Persiste la URL del servidor en disco para próximas sesiones
    const currentSettings = await (window as any).bridge?.settingsRead();
    await (window as any).bridge?.settingsWrite({
      ...(currentSettings?.settings ?? {}),
      serverUrl,
    });

    // Navega al chat
    await (window as any).bridge?.navigate('chat.html');

  } catch (err: any) {
    const isOffline =
      err?.name === 'TypeError' ||
      err?.message?.includes('Failed to fetch') ||
      err?.name === 'AbortError';

    showError(
      isOffline
        ? 'No se puede conectar al servidor. Verifica la URL y tu red.'
        : `Error inesperado: ${err?.message ?? 'desconocido'}`,
    );
  } finally {
    setLoading(false);
  }
}

// ──────────────────────────────────────────────────────────────
// Inicialización
// ──────────────────────────────────────────────────────────────

export async function initLoginController(): Promise<void> {
  formEl      = document.getElementById('login-form')     as HTMLFormElement;
  userInput   = document.getElementById('username')       as HTMLInputElement;
  passInput   = document.getElementById('password')       as HTMLInputElement;
  serverInput = document.getElementById('server-url')     as HTMLInputElement;
  submitBtn   = document.getElementById('submit-btn')     as HTMLButtonElement;
  errorEl     = document.getElementById('error-msg')      as HTMLElement;
  spinnerEl   = document.getElementById('spinner')        as HTMLElement;

  // Pre-carga la URL del servidor guardada
  try {
    const result = await (window as any).bridge?.settingsRead();
    if (result?.ok && result.settings?.serverUrl) {
      if (serverInput) serverInput.value = result.settings.serverUrl;
      setServerUrl(result.settings.serverUrl);
    }
  } catch {
    // No hay settings previos; no es un error
  }

  formEl?.addEventListener('submit', handleSubmit);
}