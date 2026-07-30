import { renderNav, renderAuthHeader, requireAuth, startStatusLoop } from './client-nav.js';

const CATS = [
  { id: 'justchatting', label: '💬 Just Chatting' },
  { id: 'gaming', label: '🎮 Gaming' },
  { id: 'irl', label: '🌍 IRL' },
  { id: 'music', label: '🎵 Music' },
  { id: 'deportes', label: '⚽ Deportes' },
  { id: 'noticias', label: '📰 Noticias' },
  { id: 'arte', label: '🎨 Arte' },
  { id: 'evento', label: '🎉 Evento' },
];

const ENERGIES = [
  { id: 'tranquilo', label: '😴 Tranquilo' },
  { id: 'normal', label: '😐 Normal' },
  { id: 'hype', label: '😤 Hype' },
  { id: 'caotico', label: '🔥 Caótico' },
];

let cat = 'justchatting';
let energy = 'normal';
let autoCtx = false;
let generating = false;
let simMsgs = [];

function esc(str) { if (str == null) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function showMsg(msg, type) {
  const el = document.getElementById('sim-msg');
  if (!el) return;
  el.textContent = msg; el.dataset.type = type; el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

function renderChips() {
  const catsEl = document.getElementById('sim-cats');
  catsEl.innerHTML = CATS.map(c => `<button class="chip ${c.id === cat ? 'active' : ''}" data-id="${c.id}">${c.label}</button>`).join('');
  catsEl.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
    cat = b.dataset.id;
    catsEl.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b));
  }));

  const enEl = document.getElementById('sim-energies');
  enEl.innerHTML = ENERGIES.map(e => `<button class="chip ${e.id === energy ? 'active' : ''}" data-id="${e.id}">${e.label}</button>`).join('');
  enEl.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
    energy = b.dataset.id;
    enEl.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b));
  }));
}

function toggleAuto() {
  autoCtx = !autoCtx;
  const btn = document.getElementById('sim-auto-btn');
  const ta = document.getElementById('sim-ctx');
  btn.textContent = autoCtx ? '🤖 Auto activado' : '🤖 Auto (que lo invente)';
  ta.disabled = autoCtx;
  if (autoCtx) ta.value = '';
}

function updateButtons() {
  const has = simMsgs.length > 0;
  document.getElementById('sim-export-btn').disabled = !has;
  document.getElementById('sim-send-btn').disabled = !has;
}

function appendMsg(m) {
  const el = document.getElementById('sim-msgs');
  const empty = document.getElementById('sim-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = `<span class="msg-user">${esc(m.user)}</span><span class="msg-sep">:</span><span class="msg-text">${esc(m.message)}</span>`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  simMsgs.push({ user: m.user, message: m.message });
  document.getElementById('sim-count').textContent = `${simMsgs.length} mensajes`;
  updateButtons();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function buildPromptForIA() {
  const tema = document.getElementById('sim-ctx').value.trim();
  if (!tema) { showMsg('Escribí el tema de conversación primero (ej: "Boca juega mal").', 'error'); return; }
  const cant = parseInt(document.getElementById('sim-cant').value, 10) || 100;

  const btn = document.getElementById('sim-prompt-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '⏳ Armando prompt...';
  try {
    const res = await fetch('/api/chat/build-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tema, categoria: cat, energia: energy, cantidad: cant }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) { showMsg(data.error || 'Error al armar el prompt.', 'error'); return; }
    const output = document.getElementById('sim-msgs');
    const count = document.getElementById('sim-count');
    if (count) count.textContent = `Prompt listo`;
    output.innerHTML = `
      <div style="padding:14px">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <button id="copy-prompt-btn" class="btn btn-primary btn-sm">📋 Copiar prompt</button>
          <a id="open-gemini-btn" class="btn btn-ghost btn-sm" href="https://chat.google.com" target="_blank" rel="noopener">✨ Abrir Gemini</a>
          <a id="open-chatgpt-btn" class="btn btn-ghost btn-sm" href="https://chatgpt.com" target="_blank" rel="noopener">🤖 Abrir ChatGPT</a>
        </div>
        <textarea id="built-prompt" class="field-input" rows="18" readonly
          style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 12px;color:var(--text);font-family:var(--font-mono);font-size:12px;resize:vertical">${esc(data.prompt)}</textarea>
      </div>
      <style>
        .txt::-webkit-scrollbar{width:8px}.txt::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
      </style>`;
    document.getElementById('copy-prompt-btn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(data.prompt);
        showMsg('✓ Prompt copiado. Pegalo en Gemini/ChatGPT.', 'success');
      } catch {
        const ta = document.getElementById('built-prompt');
        ta.select(); ta.setSelectionRange(0, 999999);
        document.execCommand('copy');
        showMsg('✓ Prompt copiado (seleccionado).', 'success');
      }
    });
    showMsg(`✓ Prompt armado para ${cant} mensajes. Copialo y pegalo en cualquier IA.`, 'success');
    if (window.__simPaste) window.__simPaste(data.prompt);
  } catch (e) {
    showMsg('Error de conexión al armar el prompt.', 'error');
  }
  btn.disabled = false;
  btn.textContent = original;
}

async function generate() {
  if (generating) return;
  const ctx = document.getElementById('sim-ctx').value.trim();
  if (!ctx && !autoCtx) { showMsg('Escribí un contexto o activá Auto.', 'error'); return; }
  const cant = parseInt(document.getElementById('sim-cant').value, 10) || 20;

  generating = true;
  const btn = document.getElementById('sim-gen-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Generando...';
  showMsg('Generando (sin API usa el modo local, instantáneo)...', 'success');

  try {
    const res = await fetch('/api/chat/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream_context: autoCtx ? 'auto' : ctx, categoria_stream: cat, cantidad: cant, energia_chat: energy }),
    });
    const data = await res.json();
    if (!res.ok) { showMsg(data.error || 'Error al generar.', 'error'); return; }
    const msgs = data.mensajes || [];
    const delay = msgs.length > 200 ? 5 : msgs.length > 100 ? 10 : 20;
    for (let i = 0; i < msgs.length; i++) {
      appendMsg(msgs[i]);
      if (i < msgs.length - 1) await sleep(delay);
    }
    showMsg(`✓ ${msgs.length} mensajes generados (${data.modo === 'local' ? 'modo local' : 'IA'}).`, 'success');
  } catch (e) {
    showMsg('Error de conexión.', 'error');
  }
  generating = false;
  btn.disabled = false;
  btn.textContent = '✨ Generar chat';
}

async function exportTxt() {
  if (simMsgs.length === 0) return;
  try {
    const res = await fetch('/api/chat/export-txt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensajes: simMsgs }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showMsg(`✓ Guardado en data/exports/${data.archivo}`, 'success');
    } else {
      showMsg(data.error || 'Error al guardar.', 'error');
    }
  } catch (e) {
    showMsg('Error al guardar.', 'error');
  }
}

function normalizeChannel(input) {
  if (!input) return '';
  let s = String(input).trim();
  try {
    const u = new URL(s);
    s = u.pathname;
  } catch {}
  s = s.replace(/^https?:\/\/(www\.)?kick\.com\//i, '');
  s = s.split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
  return s;
}

async function sendToKick() {
  if (simMsgs.length === 0) return;
  const settings = JSON.parse(localStorage.getItem('scb_settings') || '{}');
  const channel = normalizeChannel(settings.channelName || '');
  const chatroomId = parseInt(settings.chatroomId || '0', 10) || undefined;
  if (!channel && !chatroomId) {
    showMsg('Configurá el canal en Ajustes primero (nombre o chatroom_id).', 'error');
    return;
  }

  const btn = document.getElementById('sim-send-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '📤 Enviando...';
  try {
    const res = await fetch('/api/chat/send-sim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensajes: simMsgs, channel, chatroom_id: chatroomId, random_order: true, delay: 2500 }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      showMsg(`✓ Enviados ${data.enviados}, fallidos ${data.fallidos} (aleatorio con bearers).`, 'success');
    } else {
      showMsg(data.error || 'Error al enviar.', 'error');
    }
  } catch (e) {
    showMsg('Error de conexión al enviar.', 'error');
  }
  btn.disabled = false;
  btn.textContent = original;
}

window.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
  renderAuthHeader('simulador');
  renderNav('simulador');
  startStatusLoop();
  renderChips();
  document.getElementById('sim-auto-btn').addEventListener('click', toggleAuto);
  document.getElementById('sim-gen-btn').addEventListener('click', generate);
  document.getElementById('sim-prompt-btn').addEventListener('click', buildPromptForIA);
  document.getElementById('sim-export-btn').addEventListener('click', exportTxt);
  document.getElementById('sim-send-btn').addEventListener('click', sendToKick);
  updateButtons();
});