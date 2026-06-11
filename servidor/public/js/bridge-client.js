let _status = 'disconnected';
const _listeners = new Set();

function setStatus(next) {
  if (_status === next) return;
  _status = next;
  _listeners.forEach(fn => fn(next));
}

export function onStatusChange(fn) {
  _listeners.add(fn);
  fn(_status);
  return () => _listeners.delete(fn);
}

export function getStatus() {
  return _status;
}

export function setServerUrl(url) {
  if (url) sessionStorage.setItem('scb_server_url', url.replace(/\/+$/, ''));
}

export async function ping() {
  setStatus('checking');
  try {
    const url = sessionStorage.getItem('scb_server_url');
    if (!url) { setStatus('disconnected'); return false; }
    const res = await fetch(`${url}/health`);
    const ok = res.ok;
    setStatus(ok ? 'connected' : 'disconnected');
    return ok;
  } catch {
    setStatus('disconnected');
    return false;
  }
}

export async function fetchMyBots() {
  try {
    const url = sessionStorage.getItem('scb_server_url');
    const token = sessionStorage.getItem('scb_jwt');
    if (!url || !token) return [];
    const res = await fetch(`${url}/me/bots`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    return data.bots || [];
  } catch { return []; }
}

export async function sendMessage(payload) {
  try {
    const url = sessionStorage.getItem('scb_server_url');
    const token = sessionStorage.getItem('scb_jwt');
    if (!url || !token) return { ok: false, error: 'Not authenticated', status: 401 };
    const body = { sessionId: crypto.randomUUID?.() || Date.now().toString(), message: payload.message, channel: payload.channel };
    if (payload.bot_name) body.bot_name = payload.bot_name;
    if (payload.chatroom_id) body.chatroom_id = payload.chatroom_id;
    const res = await fetch(`${url}/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      sessionStorage.removeItem('scb_jwt');
      sessionStorage.removeItem('scb_role');
      window.location.href = '/';
      return { ok: false, error: 'Session expired', status: 401 };
    }
    return { ok: res.ok, status: res.status, ...data };
  } catch (err) {
    return { ok: false, error: err.message, status: 0 };
  }
}
