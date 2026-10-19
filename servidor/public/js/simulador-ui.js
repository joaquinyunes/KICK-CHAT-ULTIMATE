import { renderNav, renderAuthHeader, requireAuth, startStatusLoop } from './client-nav.js';
import { cargar as cargarGlosario, filtrarPorSituacion, elegir } from './glosario.js';
import { detectar, sitById } from './contexto.js';

// Armador de prompt: pegás datos, elegís qué incluir y devuelve SOLO el prompt para pegarlo en otra IA.
// No llama a ningún modelo ni envía nada a Kick. El texto del prompt lo compone el servidor
// (POST /api/chat/build-prompt → src/prompts/prompt-builder.ts).

const STORE_KEY = 'sim_prompt_v2';
const STORE_VERSION = 4; // v4: el formato por defecto pasó a "hilos" (mensaje + respuestas) y se sumó el modo video

const DATOS = [
  { key: 'contexto', titulo: 'Contexto del stream', rows: 4, hint: 'Qué se ve y qué se oye. Lo más reciente, al final.', ph: 'Ej: quien streamea muestra su ticket en vivo y comenta los partidos.' },
  { key: 'glosario', titulo: 'Mis palabras (glosario)', rows: 5, hint: 'Las palabras que va a usar el chat. Escribilas acá o traé una tanda de tu glosario grande (se elige según el contexto, sin IA).', ph: 'rekt\nal horno = perdió todo\nse prendió\npagó = salió premio' },
  { key: 'transcripcion', titulo: 'Transcripción', rows: 4, hint: 'Opcional. Con o sin timestamps: el chat solo reacciona a los momentos relevantes.', ph: '00:12 …' },
  { key: 'evento', titulo: 'Último evento', rows: 2, hint: 'Lo último que pasó (un gol, una muerte, se cayó una pata del ticket…).', ph: '' },
  { key: 'estado', titulo: 'Marcador, tiempo y estadísticas', rows: 3, hint: 'Solo lo que esté confirmado.', ph: 'Ej: Fiorentina 0-1 Napoli, entretiempo' },
  { key: 'apuestas', titulo: 'Apuestas: ticket, cuotas y mercados', rows: 5, hint: 'Pegalo tal cual. Sin esto no existen cuotas ni mercados.', ph: 'Ej: más de 1.5 · totales asiáticos · 1,27 …\nApuesta ARS … / Pago ARS …' },
  { key: 'noticias', titulo: 'Noticias', rows: 4, hint: 'Una por línea. Son la ÚNICA fuente de actualidad: sin noticias, el chat no habla de ninguna.', ph: '' },
  { key: 'historial', titulo: 'Historial del chat', rows: 4, hint: 'Los últimos mensajes ya publicados, para que la tanda continúe desde ahí.', ph: '' },
  { key: 'memoria', titulo: 'Memoria de usuarios', rows: 2, hint: 'Opcional: quién suele decir qué.', ph: '' },
  { key: 'reglas_extra', titulo: 'Reglas extra', rows: 3, hint: 'Tus propias instrucciones. Valen salvo que contradigan los hechos o el formato.', ph: '' },
];

const CONTENIDOS = [
  ['casino', '🎰 Casino y slots'],
  ['apuestas', '💸 Apuestas deportivas'],
  ['deportes', '⚽ Deportes'],
  ['esports', '🎮 Esports'],
  ['gaming', '🕹️ Gaming y streams'],
  ['programacion', '💻 Programación y estudio'],
  ['charla', '💬 Charla e IRL'],
  ['musica', '🎵 Música, tech y series'],
  ['noticias', '📰 Noticias'],
];

const REGLAS = [
  { key: 'imagen', root: true, label: '📸 Analizar captura adjunta', desc: 'Vas a adjuntar una imagen del stream al pegar el prompt.' },
  { key: 'tiempo', label: 'Línea de tiempo y olas de reacción', desc: 'El chat no ve el futuro; reacciona en fases y con retraso.' },
  { key: 'hilos', label: 'Hilos entrelazados', desc: 'Solo con los formatos que no son “Hilos” (con Hilos ya viene siempre mensaje + respuestas).' },
  { key: 'voces', label: 'Voz fija por usuario', desc: 'Cada usuario escribe siempre igual; reparto desigual.' },
  { key: 'lateral', label: 'Charla lateral', desc: 'Hilos sueltos (sueño, laburo, música) con un detonante real.' },
  { key: 'emotePuro', label: 'Emotes solos y trenes', desc: 'Líneas de solo emotes en rachas irregulares y trenes de pico.' },
  { key: 'memoria', label: 'Continuidad con historial', desc: 'Continúa desde el historial y la memoria pegados.' },
  { key: 'antipatrones', label: 'Lista negra anti-IA', desc: 'Prohíbe muletillas y patrones que delatan a una IA.' },
  { key: 'autochequeo', label: 'Autochequeo silencioso', desc: 'La IA revisa la tanda antes de devolverla.' },
  { key: 'muestra', label: 'Muestra de textura', desc: 'Un ejemplo ficticio del tono (con aviso de no copiarlo).' },
];

const ENERGIAS = [['tranquilo', '😴 Tranquilo'], ['normal', '😐 Normal'], ['hype', '😤 Hype'], ['caotico', '🔥 Caótico']];
const MOMENTOS = [['PREVIA', 'Previa'], ['INICIO', 'Inicio'], ['EN_VIVO', 'En vivo'], ['DESCANSO', 'Descanso'], ['ENTRE_MAPAS_O_SETS', 'Entre mapas o sets'], ['POST_EVENTO', 'Post evento'], ['FINALIZADO', 'Finalizado'], ['COMIENZO_DEL_STREAM', 'Comienzo del stream']];

const TODAS_LAS_REGLAS = { tiempo: true, hilos: true, lateral: true, voces: true, emotePuro: true, antipatrones: true, autochequeo: true, muestra: true, memoria: true };

function defaults() {
  return {
    v: STORE_VERSION,
    datos: {},
    usar: Object.fromEntries(DATOS.map(d => [d.key, true])),
    hora: false,
    opciones: {
      cantidad: 100, energia: 'normal', momento: '', contenidos: [], formato: 'hilos', elenco: 'pool', imagen: false,
      duracion: 0, porMinuto: 0, minutoDesde: 1, minutoHasta: 0,
      reglas: { ...TODAS_LAS_REGLAS },
      estilo: { tildes: 'mixto', emojis: 'ninguno', acentos: 'rioplatense', emotes: 'completa' },
    },
  };
}

const PRESETS = [
  { id: 'general', label: 'General', apply: (o) => Object.assign(o, { contenidos: [], imagen: false, formato: 'hilos', elenco: 'pool', energia: 'normal', momento: '', reglas: { ...TODAS_LAS_REGLAS }, estilo: { tildes: 'mixto', emojis: 'ninguno', acentos: 'regional', emotes: 'completa' } }) },
  { id: 'apuestas', label: 'Apuestas + captura', apply: (o) => Object.assign(o, { contenidos: ['apuestas', 'deportes'], imagen: true, formato: 'hilos', elenco: 'apuestas', energia: 'hype', momento: 'EN_VIVO', reglas: { ...TODAS_LAS_REGLAS }, estilo: { tildes: 'cero', emojis: 'ninguno', acentos: 'regional', emotes: 'reducida' } }) },
  { id: 'casino', label: 'Casino / slots', apply: (o) => Object.assign(o, { contenidos: ['casino'], imagen: false, formato: 'hilos', elenco: 'pool', energia: 'normal', momento: '', reglas: { ...TODAS_LAS_REGLAS }, estilo: { tildes: 'mixto', emojis: 'ninguno', acentos: 'regional', emotes: 'completa' } }) },
  { id: 'kickchat', label: 'Con separador KICKCHAT', apply: (o) => Object.assign(o, { formato: 'lineas', elenco: 'pool', reglas: { ...TODAS_LAS_REGLAS } }) },
  { id: 'minimo', label: 'Mínimo', apply: (o) => Object.assign(o, { imagen: false, formato: 'hilos', reglas: { tiempo: false, hilos: true, lateral: false, voces: false, emotePuro: false, antipatrones: false, autochequeo: false, muestra: false, memoria: true }, estilo: { tildes: 'mixto', emojis: 'ninguno', acentos: 'rioplatense', emotes: 'ninguno' } }) },
];

let state = defaults();
let seq = 0;
let timer = null;
let flashTimer = null;
let lastPrompt = '';
let avisosActuales = '';

const $ = (id) => document.getElementById(id);

// ─── Persistencia (no crítica) ─────────────────────────────────────────────
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    const d = defaults();
    state = {
      v: STORE_VERSION,
      datos: (s.datos && typeof s.datos === 'object') ? s.datos : {},
      usar: { ...d.usar, ...(s.usar || {}) },
      hora: !!s.hora,
      opciones: {
        ...d.opciones, ...(s.opciones || {}),
        reglas: { ...d.opciones.reglas, ...((s.opciones || {}).reglas || {}) },
        estilo: { ...d.opciones.estilo, ...((s.opciones || {}).estilo || {}) },
      },
    };
    if (s.v !== STORE_VERSION) state.opciones.formato = 'hilos'; // estados viejos guardaban JSON o solo mensajes
  } catch { /* sin storage: valores por defecto */ }
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* ignorar */ } }

// ─── Render ─────────────────────────────────────────────────────────────────
function makeSwitch(id, label, checked, onChange, disabled = false) {
  const wrap = document.createElement('label');
  wrap.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox'; input.id = id; input.checked = checked; input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked));
  const track = document.createElement('span'); track.className = 'track';
  const text = document.createElement('span'); text.textContent = label;
  wrap.append(input, track, text);
  return wrap;
}

function renderDatos() {
  const root = $('datos');
  root.replaceChildren();
  for (const d of DATOS) {
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'card-' + d.key;

    const ta = document.createElement('textarea');
    ta.className = 'pb-input'; ta.id = 'd-' + d.key; ta.rows = d.rows; ta.placeholder = d.ph;
    ta.setAttribute('aria-label', d.titulo);
    ta.value = state.datos[d.key] || '';
    ta.disabled = state.usar[d.key] === false;
    card.classList.toggle('off', ta.disabled);
    ta.addEventListener('input', () => { state.datos[d.key] = ta.value; schedule(); });

    const head = document.createElement('div');
    head.className = 'card-head';
    const h3 = document.createElement('h3'); h3.textContent = d.titulo;
    const sw = makeSwitch('u-' + d.key, 'Usar', state.usar[d.key] !== false, (on) => {
      state.usar[d.key] = on; ta.disabled = !on; card.classList.toggle('off', !on); schedule();
    });
    head.append(h3, sw);

    const hint = document.createElement('p'); hint.className = 'card-hint'; hint.textContent = d.hint;

    card.append(head, hint, ta);
    if (d.key === 'contexto') card.append(contextoTools(ta));
    if (d.key === 'glosario') card.append(glosarioTools(ta));
    root.appendChild(card);
  }
}


// ─── Contexto: traerlo del analizador o resumirlo con IA gratis / local ─────
const IA_KEY = 'sim_ia_proveedor';
const btn = (txt, cls = 'btn btn-secondary btn-sm') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt; return b; };
const guardarCampo = (ta, key, valor) => { ta.value = valor; state.datos[key] = valor; schedule(); };

function contextoTools(ta) {
  const box = document.createElement('div'); box.className = 'pb-tools';
  const traer = btn('⬇ Traer del analizador');
  const sel = document.createElement('select'); sel.className = 'pb-sel'; sel.setAttribute('aria-label', 'IA para resumir');
  for (const [v, l] of [['auto', 'IA: automática'], ['gemini', 'IA: Gemini (gratis)'], ['ollama', 'IA: local (Ollama)']]) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); }
  try { sel.value = localStorage.getItem(IA_KEY) || 'auto'; } catch { /* sin storage */ }
  sel.addEventListener('change', () => { try { localStorage.setItem(IA_KEY, sel.value); } catch { /* ignorar */ } });
  const ia = btn('✨ Resumir con IA', 'btn btn-primary btn-sm');
  const undo = btn('↩ Deshacer'); undo.hidden = true;
  const st = document.createElement('span'); st.className = 'stat'; st.setAttribute('aria-live', 'polite');
  const det = document.createElement('details'); det.className = 'pb-ia';
  const sum = document.createElement('summary'); sum.textContent = '✨ IA opcional (apagada: no se usa salvo que la toques)';
  const detRow = document.createElement('div'); detRow.className = 'pb-tools'; detRow.append(sel, ia, undo);
  det.append(sum, detRow);
  box.append(traer, st, det);
  let previo = null;
  const msg = (t, type) => { st.textContent = t; if (type) st.dataset.type = type; else delete st.dataset.type; };

  fetch('/api/chat/context-ai').then(r => r.json()).then(d => {
    if (d && d.success && !d.gemini) msg('Sin clave de Gemini: sacá una gratis en aistudio.google.com/apikey y pegala en servidor/.env como KICK_GEMINI_API_KEY (o usá Ollama local).');
  }).catch(() => {});

  traer.addEventListener('click', async () => {
    msg('Buscando…');
    try {
      const d = await (await fetch('/api/chat/kc-context')).json();
      const lineas = (d.summaries || []).map(x => {
        const t = x.timestamp ? new Date(x.timestamp * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
        return `${t ? '[' + t + '] ' : ''}${x.resumen_actual || ''}${x.evento ? ' (' + x.evento + ')' : ''}`.trim();
      }).filter(Boolean);
      if (!lineas.length) { msg('El analizador no tiene resúmenes todavía (encendelo en la pestaña Contexto).', 'error'); return; }
      previo = ta.value; undo.hidden = false;
      guardarCampo(ta, 'contexto', lineas.join('\n'));
      msg(`✓ ${lineas.length} resúmenes del analizador.`, 'ok');
    } catch { msg('No se pudo leer el analizador.', 'error'); }
  });

  ia.addEventListener('click', async () => {
    const fuente = (state.datos.transcripcion || '').trim().length >= 20 ? state.datos.transcripcion : ta.value;
    if ((fuente || '').trim().length < 20) { msg('Pegá primero notas o una transcripción (aunque sea desordenada) y después resumí.', 'error'); return; }
    ia.disabled = true; msg('Resumiendo…');
    try {
      const res = await fetch('/api/chat/context-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: fuente, proveedor: sel.value }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) { msg(d.error || `Error ${res.status}.`, 'error'); return; }
      previo = ta.value; undo.hidden = false;
      guardarCampo(ta, 'contexto', d.contexto);
      const salto = (d.intentos || []).length ? ` (antes falló ${d.intentos.map(i => i.proveedor).join(', ')})` : '';
      msg(`✓ Resumido con ${d.proveedor === 'gemini' ? 'Gemini' : 'Ollama'} en ${(d.ms / 1000).toFixed(1)} s${salto}.`, 'ok');
    } catch { msg('No se pudo conectar con el servidor.', 'error'); } finally { ia.disabled = false; }
  });

  undo.addEventListener('click', () => { if (previo !== null) guardarCampo(ta, 'contexto', previo); undo.hidden = true; msg('Volvió el contexto anterior.'); });
  return box;
}

// ─── Glosario: sugerir palabras desde el texto que ya pegaste ───────────────
const STOP = new Set(('para pero como esta este esto estos estas esos esas porque cuando donde desde hasta entre sobre sino tambien también muy mas más menos todo toda todos todas nada algo alguien nadie cada otro otra otros otras tiene tienen tengo hacer hace hacen puede pueden quiero quiere fue ser son era eran hay han has hemos están estoy estamos estan estar bien aca acá alla allá ahi ahí aqui aquí aunque mismo misma ellos ellas nosotros usted ustedes vos tus sus mis nos les que con por una uno unos unas del los las sin sea van vamos voy vas dale dice dijo decir digo ver veo vio visto ahora luego antes despues después siempre nunca todavia todavía ya asi así entonces solo sólo').split(/\s+/));

function sugerirPalabras(texto, yaEstan) {
  const cuenta = new Map();
  for (const m of texto.toLowerCase().matchAll(/[a-záéíóúñü]{4,}/g)) {
    const w = m[0];
    if (!STOP.has(w) && !yaEstan.has(w)) cuenta.set(w, (cuenta.get(w) || 0) + 1);
  }
  const todas = [...cuenta].sort((a, b) => b[1] - a[1]);
  const repetidas = todas.filter(([, n]) => n >= 2);
  return (repetidas.length >= 8 ? repetidas : todas).slice(0, 30).map(([w]) => w);
}

const usadas = new Set();   // lo que ya se trajo del glosario (no repite hasta agotar)
function glosarioTools(ta) {
  const box = document.createElement('div'); box.className = 'pb-tools';
  const sug = btn('💡 Sugerir palabras de mi texto');
  const cnt = document.createElement('span'); cnt.className = 'stat';
  const chips = document.createElement('div'); chips.className = 'chips'; chips.style.cssText = 'width:100%;margin-top:4px';
  const palabras = () => (ta.value || '').split('\n').map(l => l.split('=')[0].trim().toLowerCase()).filter(Boolean);
  const contar = () => { const n = palabras().length; cnt.textContent = n ? `${n} palabra${n === 1 ? '' : 's'}` : ''; };
  ta.addEventListener('input', contar); contar();
  sug.addEventListener('click', () => {
    chips.replaceChildren();
    const fuente = ['historial', 'transcripcion', 'contexto', 'noticias'].map(k => state.datos[k] || '').join('\n');
    const lista = sugerirPalabras(fuente, new Set(palabras()));
    if (!lista.length) { cnt.textContent = 'No encontré candidatas: pegá antes el historial del chat o una transcripción.'; return; }
    for (const w of lista) {
      const c = btn(w, 'chip'); c.setAttribute('aria-pressed', 'false');
      c.addEventListener('click', () => { guardarCampo(ta, 'glosario', (ta.value.trim() ? ta.value.trim() + '\n' : '') + w); c.remove(); contar(); });
      chips.appendChild(c);
    }
  });
  const traer = btn('📚 Traer de mi glosario');
  const un = btn('↩ Deshacer'); un.hidden = true;
  let previo = null;
  traer.addEventListener('click', () => {
    const todo = cargarGlosario();
    if (!todo.length) { cnt.textContent = 'Tu glosario está vacío: cargalo en la página Glosario.'; return; }
    const r = detectar(state.datos.contexto || '')[0];
    const sit = r ? r.sit : null;
    const { lista, por } = filtrarPorSituacion(todo, sit);
    const sel = elegir(lista, 40, { used: usadas });
    previo = ta.value; un.hidden = false;
    guardarCampo(ta, 'glosario', sel.map((i) => i.t + (i.s ? ' = ' + i.s : '')).join('\n'));
    contar();
    cnt.textContent = `${sel.length} de ${lista.length.toLocaleString('es-AR')}${sit ? ' para “' + sit.label + '” (detectada en el contexto)' : ''} · por ${por}`;
  });
  un.addEventListener('click', () => { if (previo !== null) guardarCampo(ta, 'glosario', previo); un.hidden = true; contar(); });
  box.append(traer, un, sug, cnt, chips);
  return box;
}

function renderChips(rootId, items, isActive, onClick) {
  const root = $(rootId);
  root.replaceChildren();
  for (const [value, label] of items) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = label; b.dataset.value = value;
    b.setAttribute('aria-pressed', String(isActive(value)));
    b.addEventListener('click', () => { onClick(value); syncChips(); schedule(); });
    root.appendChild(b);
  }
}

function syncChips() {
  $('contenidos').querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(state.opciones.contenidos.includes(b.dataset.value))));
  $('energias').querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(state.opciones.energia === b.dataset.value)));
}

function renderReglas() {
  const root = $('reglas');
  root.replaceChildren();

  const fijo = document.createElement('div'); fijo.className = 'rule';
  fijo.append(makeSwitch('r-hechos', '🔒 Hechos estrictos (siempre activo)', true, () => {}, true));
  const fs = document.createElement('small'); fs.textContent = 'No inventar resultados, cuotas, montos, noticias ni pasados.';
  fijo.appendChild(fs);
  root.appendChild(fijo);

  for (const r of REGLAS) {
    const cur = r.root ? state.opciones.imagen : state.opciones.reglas[r.key];
    const item = document.createElement('div'); item.className = 'rule';
    item.append(makeSwitch('r-' + r.key, r.label, !!cur, (on) => {
      if (r.root) state.opciones.imagen = on; else state.opciones.reglas[r.key] = on;
      schedule();
    }));
    const s = document.createElement('small'); s.textContent = r.desc;
    item.appendChild(s);
    root.appendChild(item);
  }
}

function renderPresets() {
  const root = $('presets');
  root.replaceChildren();
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-secondary btn-sm'; b.textContent = p.label;
    b.addEventListener('click', () => { p.apply(state.opciones); syncOpciones(); renderReglas(); syncChips(); schedule(); });
    root.appendChild(b);
  }
}

function syncOpciones() {
  const o = state.opciones;
  $('o-tildes').value = o.estilo.tildes;
  $('o-emojis').value = o.estilo.emojis;
  $('o-acentos').value = o.estilo.acentos;
  $('o-emotes').value = o.estilo.emotes;
  $('o-formato').value = o.formato;
  $('o-elenco').value = o.elenco;
  $('o-cantidad').value = o.cantidad;
  $('o-momento').value = o.momento;
  $('o-hora').checked = state.hora;
  $('o-duracion').value = o.duracion || '';
  $('o-permin').value = o.porMinuto || '';
  $('o-desde').value = o.minutoDesde || 1;
  $('o-hasta').value = o.minutoHasta || '';
  syncVideo();
}

function bindOpciones() {
  const sel = (id, apply) => $(id).addEventListener('change', (e) => { apply(e.target.value); schedule(); });
  sel('o-tildes', v => { state.opciones.estilo.tildes = v; });
  sel('o-emojis', v => { state.opciones.estilo.emojis = v; });
  sel('o-acentos', v => { state.opciones.estilo.acentos = v; });
  sel('o-emotes', v => { state.opciones.estilo.emotes = v; });
  sel('o-formato', v => { state.opciones.formato = v; });
  sel('o-elenco', v => { state.opciones.elenco = v; });
  sel('o-momento', v => { state.opciones.momento = v; });
  $('o-cantidad').addEventListener('input', (e) => {
    const n = parseInt(e.target.value, 10);
    if (Number.isFinite(n)) { state.opciones.cantidad = Math.min(Math.max(n, 4), 600); schedule(); }
  });
  $('o-hora').addEventListener('change', (e) => { state.hora = e.target.checked; schedule(); });

  const num = (id, key, min, max, fallback) => $(id).addEventListener('input', (e) => {
    const n = parseInt(e.target.value, 10);
    state.opciones[key] = Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
    syncVideo(); schedule();
  });
  num('o-duracion', 'duracion', 0, 600, 0);
  num('o-permin', 'porMinuto', 0, 60, 0);
  num('o-desde', 'minutoDesde', 1, 600, 1);
  num('o-hasta', 'minutoHasta', 0, 600, 0);
  $('video-next').addEventListener('click', siguienteTramo);

  const mom = $('o-momento');
  for (const [v, l] of MOMENTOS) { const op = document.createElement('option'); op.value = v; op.textContent = l; mom.appendChild(op); }
}

// ─── Modo video: duración + comentarios por minuto ─────────────────────────
const MAX_CANT_VIDEO = 1500; // mismo tope que prompt-builder.ts

// Tramo efectivo (mismas reglas que normalizarOpciones en el servidor)
function tramo() {
  const o = state.opciones;
  if (!(o.duracion > 0 && o.porMinuto > 0)) return null;
  const desde = Math.min(Math.max(o.minutoDesde || 1, 1), o.duracion);
  let hasta = Math.min(Math.max(o.minutoHasta || o.duracion, desde), o.duracion);
  hasta = Math.min(hasta, desde + Math.floor(MAX_CANT_VIDEO / o.porMinuto) - 1);
  return { desde, hasta, n: hasta - desde + 1, total: (hasta - desde + 1) * o.porMinuto };
}

function syncVideo() {
  const o = state.opciones;
  const t = tramo();
  $('o-cantidad').disabled = !!t;
  $('o-formato').disabled = !!t;
  $('video-next').disabled = !t;
  $('video-resumen').textContent = t
    ? `${o.porMinuto} por minuto × ${t.n} min (del ${t.desde} al ${t.hasta}) = ${t.total} mensajes, en hilos. La cantidad y el formato se fijan solos.`
    : 'Sin modo video: se usa la cantidad y el formato de “Salida”.';
}

function siguienteTramo() {
  const t = tramo();
  if (!t) return;
  if (t.hasta >= state.opciones.duracion) { flash('Ya cubriste hasta el final del video (minuto ' + state.opciones.duracion + ').', 'ok'); return; }
  state.opciones.minutoDesde = t.hasta + 1;
  state.opciones.minutoHasta = Math.min(state.opciones.duracion, t.hasta + t.n);
  syncOpciones();
  schedule();
}

// ─── Armado del prompt ─────────────────────────────────────────────────────
function horaLocal() {
  const d = new Date();
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const p = (n) => String(n).padStart(2, '0');
  return `${dias[d.getDay()]} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function payload() {
  const datos = {};
  for (const d of DATOS) {
    if (state.usar[d.key] !== false && (state.datos[d.key] || '').trim()) datos[d.key] = state.datos[d.key];
  }
  if (state.hora) datos.hora_local = horaLocal();
  return { datos, opciones: state.opciones };
}

function avisos() {
  const o = state.opciones;
  const p = payload().datos;
  const out = [];
  if (o.imagen) out.push('📸 Acordate de adjuntar la captura al pegar el prompt.');
  if (o.contenidos.includes('apuestas') && !p.apuestas && !o.imagen) out.push('⚠️ Elegiste apuestas pero no hay ticket ni captura: el chat hablará de apuestas sin datos.');
  if (o.contenidos.includes('noticias') && !p.noticias) out.push('⚠️ Elegiste noticias pero no pegaste ninguna: el chat no hablará de noticias.');
  if ((o.formato === 'lineas' || o.formato === 'mensajes' || o.formato === 'hilos' || tramo()) && o.elenco !== 'pool') out.push('ℹ️ Con “solo mensajes” no se usan nombres de usuario: el elenco no aplica.');
  const t = tramo();
  if (t) {
    out.push(`🎬 Pegá la respuesta en la pestaña Video (duración ${o.duracion} min) para que salga sincronizada.`);
    if (t.total > 250) out.push('ℹ️ Son muchos mensajes para una sola respuesta: usá tramos (Desde/Hasta) de ~10 min y “Siguiente tramo”.');
    if (!(p.transcripcion || p.contexto)) out.push('⚠️ Sin contexto ni transcripción por minuto, el chat hablará en general del video. Pegá una transcripción con tiempos (ej: 02:15 …) para que cada minuto reaccione a lo suyo.');
  } else if (o.duracion > 0 || o.porMinuto > 0) {
    out.push('ℹ️ Para el modo video completá la duración Y los comentarios por minuto.');
  }
  if (!t && o.cantidad > 200) out.push('ℹ️ Más de 200 mensajes puede cortarse en algunas IAs: probá con 100 y repetí.');
  return out;
}

function setStatus(msg, type) {
  const el = $('pb-status');
  el.style.whiteSpace = 'pre-line';
  el.textContent = msg || '';
  if (type) el.dataset.type = type; else delete el.dataset.type;
}

function restoreAvisos() { flashTimer = null; setStatus(avisosActuales); }

function flash(msg, type) {
  setStatus(msg, type);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(restoreAvisos, 4000);
}

function schedule() {
  save();
  clearTimeout(timer);
  timer = setTimeout(build, 250);
}

async function build() {
  const mine = ++seq;
  try {
    const res = await fetch('/api/chat/build-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    const data = await res.json().catch(() => ({}));
    if (mine !== seq) return; // llegó una respuesta más nueva
    if (res.status === 401) { setStatus('Tu sesión venció. Volvé a iniciar sesión.', 'error'); return; }
    if (!res.ok || !data.success) { setStatus(data.error || `Error ${res.status} al armar el prompt.`, 'error'); return; }

    lastPrompt = data.prompt;
    $('pb-out').value = lastPrompt;
    $('pb-copy').disabled = false;
    $('pb-download').disabled = false;
    $('pb-stats').textContent = `${data.chars.toLocaleString('es-AR')} caracteres · ~${Math.round(data.chars / 3.6).toLocaleString('es-AR')} tokens · ${data.lineas} líneas`;
    const inc = $('pb-incluye');
    inc.replaceChildren();
    for (const t of (data.incluye || [])) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = t; inc.appendChild(s); }
    avisosActuales = avisos().join('\n');
    if (!flashTimer) restoreAvisos();
  } catch {
    if (mine === seq) setStatus('No se pudo conectar con el servidor.', 'error');
  }
}

// ─── Acciones ───────────────────────────────────────────────────────────────
async function copiar() {
  if (!lastPrompt) return;
  try {
    await navigator.clipboard.writeText(lastPrompt);
  } catch {
    const ta = $('pb-out');
    ta.select(); ta.setSelectionRange(0, lastPrompt.length);
    try { document.execCommand('copy'); } catch { flash('No se pudo copiar. Seleccioná el texto y copialo a mano.', 'error'); return; }
  }
  flash('✓ Prompt copiado. Pegalo en Gemini, ChatGPT o Claude' + (state.opciones.imagen ? ' y adjuntá la captura.' : '.'), 'ok');
}

function descargar() {
  if (!lastPrompt) return;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `prompt-chat-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.txt`;
  const url = URL.createObjectURL(new Blob([lastPrompt], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function vaciarDatos() {
  if (!window.confirm('¿Vaciar todos los datos pegados? Las opciones y tu glosario se mantienen.')) return;
  state.datos = state.datos.glosario ? { glosario: state.datos.glosario } : {};
  renderDatos();
  schedule();
}

// ─── Init ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
  renderAuthHeader('simulador');
  renderNav('simulador');
  startStatusLoop();

  load();
  bindOpciones();
  renderDatos();
  renderChips('contenidos', CONTENIDOS, v => state.opciones.contenidos.includes(v), v => {
    const c = state.opciones.contenidos;
    state.opciones.contenidos = c.includes(v) ? c.filter(x => x !== v) : [...c, v];
  });
  renderChips('energias', ENERGIAS, v => state.opciones.energia === v, v => { state.opciones.energia = v; });
  renderReglas();
  renderPresets();
  syncOpciones();

  $('pb-copy').addEventListener('click', copiar);
  $('pb-download').addEventListener('click', descargar);
  $('pb-clear').addEventListener('click', vaciarDatos);

  build();
});
