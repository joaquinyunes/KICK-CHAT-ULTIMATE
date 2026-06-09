/**
 * bridge-client.ts  –  StreamChat Bridge FASE 2
 *
 * Responsabilidades:
 *  - Adjuntar el JWT de sesión en cada petición al servidor.
 *  - Detectar 401 (token expirado) → borrar sesión y redirigir al login.
 *  - Detectar fallos de red (servidor offline) → emitir evento 'disconnected'.
 *  - NUNCA almacena tokens Bearer de Kick ni importa módulos de cifrado.
 */

// ──────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────

export type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

export interface BridgeResponse<T = unknown> {
  ok:    boolean;
  data?: T;
  error?: string;
  status?: number;
}

export interface SendMessagePayload {
  channel:  string;
  message:  string;
  platform: string;
}

// ──────────────────────────────────────────────────────────────
// Almacén de estado del Bridge (módulo singleton)
// ──────────────────────────────────────────────────────────────

type StatusListener = (status: ConnectionStatus) => void;

let _status: ConnectionStatus        = 'disconnected';
const _listeners: Set<StatusListener> = new Set();

function setStatus(next: ConnectionStatus): void {
  if (_status === next) return;
  _status = next;
  _listeners.forEach(fn => fn(next));
}

// ──────────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────────

/**
 * Obtiene el JWT almacenado en sessionStorage.
 * sessionStorage es volátil: se borra al cerrar la ventana.
 */
function getToken(): string | null {
  return sessionStorage.getItem('scb_jwt');
}

/**
 * Destruye la sesión y redirige al login.
 * Se llama cuando el servidor responde 401.
 */
function destroySessionAndRedirect(): void {
  sessionStorage.removeItem('scb_jwt');
  setStatus('disconnected');
  // window.bridge viene del preload.js (contextBridge)
  (window as any).bridge?.navigate('login.html');
}

/**
 * Lee la URL base del servidor desde sessionStorage (se carga al iniciar).
 */
function getServerUrl(): string {
  return sessionStorage.getItem('scb_server_url') ?? '';
}

// ──────────────────────────────────────────────────────────────
// Petición base
// ──────────────────────────────────────────────────────────────

/**
 * Realiza una petición fetch al servidor con el JWT adjunto.
 * Maneja 401, errores de red y timeouts.
 */
async function request<T = unknown>(
  method:  'GET' | 'POST' | 'PUT' | 'DELETE',
  path:    string,
  body?:   object,
  timeoutMs = 8000,
): Promise<BridgeResponse<T>> {

  const serverUrl = getServerUrl();
  if (!serverUrl) {
    return { ok: false, error: 'URL del servidor no configurada.' };
  }

  const token = getToken();
  if (!token) {
    destroySessionAndRedirect();
    return { ok: false, error: 'Sin sesión activa.' };
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`,   // JWT del servidor, NUNCA token de Kick
  };

  try {
    const res = await fetch(`${serverUrl}${path}`, {
      method,
      headers,
      body:   body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Token expirado → destruir sesión
    if (res.status === 401) {
      destroySessionAndRedirect();
      return { ok: false, error: 'Sesión expirada. Vuelve a iniciar sesión.', status: 401 };
    }

    setStatus('connected');

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        ok:     false,
        error:  (errData as any)?.message ?? `Error ${res.status}`,
        status: res.status,
      };
    }

    const data = await res.json() as T;
    return { ok: true, data, status: res.status };

  } catch (err: any) {
    clearTimeout(timeoutId);

    const isOffline =
      err.name === 'AbortError'  ||   // Timeout
      err.name === 'TypeError'   ||   // Failed to fetch (red caída)
      err.message?.includes('Failed to fetch');

    if (isOffline) {
      setStatus('disconnected');
      return { ok: false, error: 'Servidor no disponible. Verifica tu conexión.' };
    }

    return { ok: false, error: `Error inesperado: ${err.message}` };
  }
}

// ──────────────────────────────────────────────────────────────
// API pública del módulo
// ──────────────────────────────────────────────────────────────

/**
 * Suscribe un listener al estado de conexión.
 * Devuelve la función de cancelación.
 */
export function onStatusChange(fn: StatusListener): () => void {
  _listeners.add(fn);
  fn(_status);  // emite el estado actual inmediatamente
  return () => _listeners.delete(fn);
}

/** Estado de conexión actual */
export function getStatus(): ConnectionStatus {
  return _status;
}

/**
 * Verifica si el servidor está vivo (ping).
 * Se llama periódicamente desde la UI.
 */
export async function ping(): Promise<boolean> {
  setStatus('checking');
  const res = await request('GET', '/health');
  return res.ok;
}

/**
 * Envía un mensaje al servidor para su reenvío a la plataforma destino.
 * El servidor es quien gestiona la autenticación con la plataforma (Kick, etc.).
 */
export async function sendMessage(
  payload: SendMessagePayload,
): Promise<BridgeResponse> {
  return request('POST', '/messages/send', payload);
}

/**
 * Obtiene el estado actual del canal en el servidor.
 */
export async function getChannelStatus(
  channel: string,
): Promise<BridgeResponse> {
  return request('GET', `/channels/${encodeURIComponent(channel)}/status`);
}

/**
 * Obtiene la lista de plataformas disponibles en el servidor.
 */
export async function getPlatforms(): Promise<BridgeResponse> {
  return request('GET', '/platforms');
}

/**
 * Carga la URL del servidor en sessionStorage.
 * Se llama desde settings o login, nunca almacena tokens de plataforma.
 */
export function setServerUrl(url: string): void {
  const sanitized = url.replace(/\/+$/, '');  // quita slash final
  sessionStorage.setItem('scb_server_url', sanitized);
}