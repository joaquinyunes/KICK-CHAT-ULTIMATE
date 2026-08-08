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
let simMode = 'general';
let screenshotDataUrl = null;

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

function setMode(mode) {
  simMode = mode;
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  document.querySelectorAll('.general-field').forEach(el => el.style.display = mode === 'general' ? '' : 'none');
  document.querySelectorAll('.betting-field').forEach(el => el.classList.toggle('visible', mode === 'betting'));
  const catCard = document.getElementById('sim-cats')?.closest('.sim-card');
  if (catCard) catCard.style.display = mode === 'general' ? '' : 'none';
}

function handleScreenshot(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showMsg('Solo se aceptan imágenes.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    screenshotDataUrl = reader.result;
    const preview = document.getElementById('screenshot-preview');
    const label = document.getElementById('screenshot-label');
    const hint = document.getElementById('screenshot-hint');
    const zone = document.getElementById('screenshot-zone');
    if (preview) { preview.src = screenshotDataUrl; preview.hidden = false; }
    if (label) label.textContent = '✅ Captura cargada';
    if (hint) hint.textContent = 'Tocá para cambiar la imagen.';
    if (zone) zone.classList.add('has-img');
  };
  reader.readAsDataURL(file);
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

// ─── Pegar JSON → solo mensajes ───
function openPasteModal() {
  const modal = document.getElementById('sim-modal');
  if (modal) { modal.hidden = false; document.getElementById('sim-paste-input').value = ''; document.getElementById('sim-paste-input').focus(); }
}

function closePasteModal() {
  const modal = document.getElementById('sim-modal');
  if (modal) modal.hidden = true;
}

function importPastedJson() {
  const ta = document.getElementById('sim-paste-input');
  const raw = ta.value.trim();
  if (!raw) { showMsg('Pegá el JSON primero.', 'error'); return; }
  let arr = null;
  try {
    arr = JSON.parse(raw);
  } catch {
    try {
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start >= 0 && end > start) arr = JSON.parse(raw.substring(start, end + 1));
    } catch {}
  }
  if (!Array.isArray(arr)) { showMsg('No se pudo leer el JSON. Pegá un array [ ... ].', 'error'); return; }
  for (const item of arr) {
    const msg = item && typeof item === 'object' ? item.message ?? item.mensaje ?? item.msg ?? item.text : null;
    if (msg && String(msg).trim()) appendMsg({ user: '💬', message: String(msg) });
  }
  showMsg(`✓ Importados ${simMsgs.length} mensajes pasados.`, 'success');
  closePasteModal();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function buildPromptForIA() {
  if (simMode === 'betting') {
    await buildBettingPrompt();
    return;
  }
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
    showBuiltPrompt(data.prompt, cant);
  } catch (e) {
    showMsg('Error de conexión al armar el prompt.', 'error');
  }
  btn.disabled = false;
  btn.textContent = original;
}

async function buildBettingPrompt() {
  const estado = document.getElementById('betting-state')?.value.trim() || '';
  const cant = parseInt(document.getElementById('sim-cant').value, 10) || 200;

  const btn = document.getElementById('sim-prompt-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '⏳ Armando prompt betting...';

  let screenshotInfo = '';
  if (screenshotDataUrl) {
    screenshotInfo = `[IMAGEN ADJUNTA - La IA debe analizar esta captura del stream para basar las reacciones del chat en datos visuales reales: marcador, vida, oro, cuotas, jugadores vivos/muertos]`;
  }

  const prompt = BETTING_PROMPT.replace('{estado_apuestas}', estado || 'El chat tiene apuestas mixtas, algunos en over otros en under')
    .replace('{cantidad}', cant)
    .replace('{screenshot_info}', screenshotInfo);

  showBuiltPrompt(prompt, cant);
  btn.disabled = false;
  btn.textContent = original;
}

function showBuiltPrompt(prompt, cant) {
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
        style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 12px;color:var(--text);font-family:var(--font-mono);font-size:12px;resize:vertical">${esc(prompt)}</textarea>
    </div>
    <style>
      .txt::-webkit-scrollbar{width:8px}.txt::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
    </style>`;
  document.getElementById('copy-prompt-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      showMsg('✓ Prompt copiado. Pegalo en Gemini/ChatGPT.', 'success');
    } catch {
      const ta = document.getElementById('built-prompt');
      ta.select(); ta.setSelectionRange(0, 999999);
      document.execCommand('copy');
      showMsg('✓ Prompt copiado (seleccionado).', 'success');
    }
  });
  showMsg(`✓ Prompt armado para ${cant} mensajes. Copialo y pegalo en cualquier IA.`, 'success');
  if (window.__simPaste) window.__simPaste(prompt);
}

async function generate() {
  if (generating) return;
  const ctx = document.getElementById('sim-ctx').value.trim();
  if (!ctx && !autoCtx && simMode === 'general') { showMsg('Escribí un contexto o activá Auto.', 'error'); return; }
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
      body: JSON.stringify({ stream_context: autoCtx ? 'auto' : ctx, categoria_stream: simMode === 'betting' ? 'gaming' : cat, cantidad: cant, energia_chat: energy }),
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

const BETTING_PROMPT = `Sos un simulador de chat de stream en vivo (Kick/Twitch) de la comunidad hispanohablante (Argentina, Uruguay, Chile), especializado en APUESTAS de Esports (LoL, CS2).

{screenshot_info}

═══════════════════════════════════════════════════════════════
## 1. ANÁLISIS VISUAL (SILENCIOSO E INTERNO)
═══════════════════════════════════════════════════════════════
Si hay imagen adjunta, analizá la captura y basá el 100% de la reacción del chat en lo que descubras:
- ¿Qué juego es (CS2, LoL)? Mirá el marcador, la economía, el oro, los vivos/muertos.
- ¿Hay cuotas (odds) o tickets de apuestas visibles?
- ¿El equipo favorito está ganando o perdiendo? (Condiciona si el chat está eufórico o tóxico).

═══════════════════════════════════════════════════════════════
## 2. ENTRADA DE CONFIGURACIÓN (LÍNEA DE TIEMPO)
═══════════════════════════════════════════════════════════════
{
  "session_id": "stream_apuestas_en_vivo",
  "estado_apuestas": "{estado_apuestas}",
  "linea_de_tiempo": [
    {"rango_msg": "0-40", "trigger": "Reacción inmediata EXACTA a lo que muestra la captura de pantalla adjunta (HUD, vida, oro, marcador)."},
    {"rango_msg": "41-120", "trigger": "Desarrollo del momento. El chat reacciona a la jugada, insultan si pierden la apuesta o festejan 'platita' si ganan."},
    {"rango_msg": "121-200", "trigger": "El hype baja, se estabiliza. Discuten la próxima ronda, se quejan del lag, o bardean al streamer por mufa."}
  ]
}

═══════════════════════════════════════════════════════════════
## 3. PERSONALIDADES DEL CHAT (USALAS TODAS)
═══════════════════════════════════════════════════════════════
A (Spammers): tutossj, ChaskyBoom, LukaaF (Repiten palabras, todo caps)
B (Hype/Apuestas): laverde99, Reixzer, Andrestoby12, TimberoRafa (Festejan ganancias, gritan goles)
C (Tóxicos/Mufados): elmascapito3001, Gino_TN, royluis (Lloran la apuesta, insultan jugadores "vendidos")
D (Emotes): j00p_t7, Stebwb, SANGREJJAPONESA, J0lteonn (Solo tiran emotes)
E (Comentaristas Falsos): Manzanirou, INFODK, Graffi10k (Tiran data técnica, se creen pros)
F (Reactores): dekoredd, Janthz, ElYaSoy (Reaccionan rápido: "ojo", "wtf", "naaa")
G (Risas): KuroiiNekoo, Mariiana_013, maxii123mdcdd ("jajajaja", "aksjdhkas")
H (Saludadores/Lurkers): Elsopapas, bomboclat_0, chuchiti (Preguntan cómo va el partido)
I (Trolls/Anti-Streamer): Eloski12, Aidansitou (Bardean al streamer, le dicen mufa)

Emotes disponibles: [HYPERCLAP] [peepoRiot] [PogU] [KEKW] [LUL] [WeSmart] [Prayge] [peepoDJ] [vibePls] [emojiFire] [EZ] [BANGER]

═══════════════════════════════════════════════════════════════
## 4. REGLAS CRÍTICAS (APUESTAS Y REALISMO)
═══════════════════════════════════════════════════════════════
R1. REACTIVIDAD VISUAL (CRÍTICO): Mencioná datos precisos de la imagen. Si hay 5k de oro de diferencia, hablalo. Si van 11-11, hablá del Overtime.
R2. JERGA LUDÓPATA: Usá términos obligatorios: combinada, cuota, over/under, regalado, 322, pecheada, platita, mufa, ticket, tilt, free money.
R3. TOXICIDAD DE APUESTAS: Si un jugador falla, es un "vendido", "pecho frío", "hdp me arruinaste la combi". Si ganan: "ez", "casa", "plata".
R4. ORTOGRAFÍA SUCIA (ANTI-IA): Escribí como en Twitch. CERO tildes. Usá: q, xq, dsp, wacho, dlae, naaaa, jajajjaja, bue. PROHIBIDO mayúsculas perfectas o puntuación final.
R5. CERO LENGUAJE BOT: Prohibido decir "claro", "mirando la imagen", "como podemos ver", "entiendo".
R6. LÍNEA DE TIEMPO: Respetá estrictamente los cambios de comportamiento del JSON de entrada según el rango de mensajes.
R7. DINÁMICA: No son opiniones aisladas. Si alguien pregunta algo, otro le responde mal, otro se ríe, otro tira emotes.
R8. IMPERFECCIÓN: Typos naturales: "qiero", "re contra", "bien ahi". Mensajes cortados: "no puede ser que" (sin terminar). Repeticiones: "jaja" "jajaja" "jajajaja".
R9. CONVERSACIÓN REAL: Alguien pregunta → 2-3 responden → alguien cambia de tema → vuelven al tema. Hay silencios de 8-12 msgs donde nadie dice nada relevante.
R10. EMOTE PURO (cada 5 msgs): SOLO emotes, asignar a j00p_t7/Stebwb/SANGREJJAPONESA. ~25% del total.

═══════════════════════════════════════════════════════════════
## 5. FORMATO DE SALIDA EXACTO (SOLO JSON)
═══════════════════════════════════════════════════════════════
Generá EXACTAMENTE {cantidad} mensajes.
Incluí un "delay_ms" (entero) entre 100 y 3000 según la energía (100 = spam/jugada épica; 2000 = charla tranquila).
TU ÚNICA SALIDA DEBE SER EL ARRAY JSON CRUDO. NO incluyas formato markdown (ni \`\`\`json ni \`\`\`). NO agregues texto antes ni después. SOLO EL ARRAY.

[
  {"user":"usuario","message":"texto [EMOTE]","tipo":"hype|pregunta|respuesta|emote_puro|spam|queja","delay_ms": 500}
]`;

window.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
  renderAuthHeader('simulador');
  renderNav('simulador');
  startStatusLoop();
  renderChips();
  setMode('general');

  document.querySelectorAll('.mode-tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
  document.getElementById('sim-auto-btn').addEventListener('click', toggleAuto);
  document.getElementById('sim-gen-btn').addEventListener('click', generate);
  document.getElementById('sim-prompt-btn').addEventListener('click', buildPromptForIA);
  document.getElementById('sim-export-btn').addEventListener('click', exportTxt);
  document.getElementById('sim-send-btn').addEventListener('click', sendToKick);
  document.getElementById('sim-paste-btn').addEventListener('click', openPasteModal);
  document.getElementById('sim-modal-close').addEventListener('click', closePasteModal);
  document.getElementById('sim-paste-go').addEventListener('click', importPastedJson);
  document.getElementById('sim-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('sim-modal')) closePasteModal();
  });

  const screenshotZone = document.getElementById('screenshot-zone');
  const screenshotInput = document.getElementById('screenshot-input');
  if (screenshotZone && screenshotInput) {
    screenshotZone.addEventListener('click', () => screenshotInput.click());
    screenshotInput.addEventListener('change', handleScreenshot);
    screenshotZone.addEventListener('dragover', (e) => { e.preventDefault(); screenshotZone.style.borderColor = 'var(--accent)'; });
    screenshotZone.addEventListener('dragleave', () => { screenshotZone.style.borderColor = ''; });
    screenshotZone.addEventListener('drop', (e) => {
      e.preventDefault();
      screenshotZone.style.borderColor = '';
      if (e.dataTransfer.files.length) {
        screenshotInput.files = e.dataTransfer.files;
        handleScreenshot({ target: { files: e.dataTransfer.files } });
      }
    });
  }

  updateButtons();
});
