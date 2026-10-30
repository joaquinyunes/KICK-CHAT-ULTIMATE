import {
  CHANGE_RATIO,
  changeRatio,
  decideWatch,
  describeSource,
  displayMediaOptions,
  fitSize,
  isRegionTooSmall,
  luminance,
  MAX_SETTLE_MS,
  normalizeRect,
  SETTLED_RATIO,
  toSourceRect,
} from "/capture.js";
import { CATEGORY_LABELS, contextToPrompt, sessionToText } from "/context-format.js";

const $ = (id) => document.getElementById(id);

const COST_LABELS = { "free-local": "gratis · local", "free-tier": "gratis (con límites)", paid: "de pago", hybrid: "OCR local + IA externa (solo texto)" };
// Errores tras los cuales seguir vigilando no tiene sentido: hace falta que el usuario actúe.
const FATAL_CODES = new Set(["upstream_auth", "upstream_bad_request", "model_missing", "bad_host"]);
const WATCH_TICK_MS = 1000; // cada lectura es una miniatura de 32x18: coste casi nulo
const BACKOFF_MS = 15_000; // respiro tras un error
const RATE_LIMIT_BACKOFF_MS = 30_000;
const MAX_HISTORY = 20;
const SETTINGS_KEY = "pantalla-contexto:settings";

const els = {
  banner: $("banner"),
  shareBtn: $("shareBtn"),
  selectBtn: $("selectBtn"),
  fullBtn: $("fullBtn"),
  selectionInfo: $("selectionInfo"),
  placeholder: $("placeholder"),
  frame: $("frame"),
  video: $("video"),
  canvas: $("selectionCanvas"),
  modeSelect: $("modeSelect"),
  languageSelect: $("languageSelect"),
  noteInput: $("noteInput"),
  analyzeBtn: $("analyzeBtn"),
  autoCheck: $("autoCheck"),
  intervalSelect: $("intervalSelect"),
  heartbeatSelect: $("heartbeatSelect"),
  backendInfo: $("backendInfo"),
  changesCheck: $("changesCheck"),
  publishCheck: $("publishCheck"),
  status: $("status"),
  card: $("card"),
  categoryBadge: $("categoryBadge"),
  cardTitle: $("cardTitle"),
  cardSummary: $("cardSummary"),
  cardChanges: $("cardChanges"),
  entities: $("entities"),
  chatBox: $("chatBox"),
  chatLine: $("chatLine"),
  copyChatBtn: $("copyChatBtn"),
  uncertainBox: $("uncertainBox"),
  uncertainList: $("uncertainList"),
  shot: $("shot"),
  meta: $("meta"),
  historyBox: $("historyBox"),
  historyList: $("historyList"),
  copyOverlayBtn: $("copyOverlayBtn"),
  copyApiBtn: $("copyApiBtn"),
  copyAiBtn: $("copyAiBtn"),
  textBox: $("textBox"),
  screenText: $("screenText"),
  surfaceSelect: $("surfaceSelect"),
  switchBtn: $("switchBtn"),
  sourceInfo: $("sourceInfo"),
  exportInfo: $("exportInfo"),
  verifyBadge: $("verifyBadge"),
  verifyText: $("verifyText"),
  whyBox: $("whyBox"),
  reasonsList: $("reasonsList"),
  evidenceList: $("evidenceList"),
  activityBox: $("activityBox"),
  activityText: $("activityText"),
  copyActivityBtn: $("copyActivityBtn"),
};

const state = {
  stream: null,
  // Los fija el analizador: los modelos locales prefieren imágenes pequeñas y el OCR necesita ampliar la letra diminuta.
  maxSide: 1568,
  minSide: 0,
  quality: 0.8,
  current: null, // entrada que se está mostrando (para «Copiar para otra IA»)
  selection: null, // rectángulo normalizado, o null = pantalla completa
  selecting: false,
  busy: false,
  lastThumb: null, // miniatura del último fotograma analizado, para detectar cambios
  promptHistory: [], // análisis previos que se mandan al modelo para el campo "changes"
  history: [], // lo que se muestra en el panel de historial
  selectedHistory: -1,
  onEnded: null, // manejador de «dejaron de compartir» de la pista actual
  policy: { minCertainty: 0.5, stableFrames: 2 }, // política de verificación del servidor
};

// ---------- ajustes ----------

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        mode: els.modeSelect.value,
        language: els.languageSelect.value,
        surface: els.surfaceSelect.value,
        note: els.noteInput.value,
        interval: els.intervalSelect.value,
        heartbeat: els.heartbeatSelect.value,
        onlyChanges: els.changesCheck.checked,
        publish: els.publishCheck.checked,
      }),
    );
  } catch {
    // Sin almacenamiento (modo privado, etc.): la app funciona igual.
  }
}

// ---------- estado y mensajes ----------

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

function showBanner(text) {
  els.banner.textContent = text;
  els.banner.hidden = !text;
}

function syncControls() {
  const sharing = Boolean(state.stream);
  els.selectBtn.disabled = !sharing;
  els.fullBtn.disabled = !sharing || !state.selection;
  els.analyzeBtn.disabled = !sharing || state.busy;
  els.autoCheck.disabled = !sharing;
  els.shareBtn.textContent = sharing ? "Dejar de compartir" : "Compartir pantalla";
  els.switchBtn.hidden = !sharing;
  els.surfaceSelect.disabled = sharing;
  els.shareBtn.classList.toggle("primary", !sharing);
  els.selectBtn.classList.toggle("active", state.selecting);
  els.frame.classList.toggle("selecting", state.selecting);
  els.placeholder.hidden = sharing;
  els.frame.hidden = !sharing;
  updateSelectionInfo();
}

function updateSelectionInfo() {
  if (!state.stream) {
    els.selectionInfo.textContent = "";
  } else if (state.selecting) {
    els.selectionInfo.textContent = "Arrastra sobre la imagen para elegir la zona.";
  } else if (state.selection) {
    const r = toSourceRect(state.selection, els.video.videoWidth, els.video.videoHeight);
    els.selectionInfo.textContent = `Zona elegida: ${r.w}×${r.h} px`;
  } else {
    els.selectionInfo.textContent = "Se analiza la pantalla completa.";
  }
}

// ---------- compartir pantalla ----------

// Pide al navegador una fuente. SIEMPRE enseña su propio selector (por privacidad no se puede saltar);
// la opción elegida aquí solo decide cuál se muestra primero. Devuelve null si el usuario cancela o falla.
async function pickSource() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus("Este navegador no permite compartir pantalla. Usa Chrome, Edge o Firefox de escritorio.", "error");
    return null;
  }
  try {
    return await navigator.mediaDevices.getDisplayMedia(displayMediaOptions(els.surfaceSelect.value));
  } catch (err) {
    setStatus(err.name === "NotAllowedError" ? "Cancelaste el permiso para compartir pantalla." : `No se pudo capturar la pantalla: ${err.message}`, "error");
    return null;
  }
}

function showSource() {
  const track = state.stream?.getVideoTracks()[0];
  if (!track) {
    els.sourceInfo.textContent = "";
    return;
  }
  const source = describeSource(track.getSettings?.(), track.label);
  els.sourceInfo.textContent = `Compartiendo ${source.text}.`;
}

function attachStream(stream) {
  const track = stream.getVideoTracks()[0];
  state.onEnded = () => stopShare();
  track.addEventListener("ended", state.onEnded);
  state.stream = stream;
  els.video.srcObject = stream;
  return els.video.play().catch(() => {});
}

async function startShare() {
  const stream = await pickSource();
  if (!stream) return;
  await attachStream(stream);
  resetSelection();
  showSource();
  setStatus("Pantalla compartida. Pulsa «Analizar ahora» o activa la vigilancia.");
  syncControls();
  resizeCanvas();
}

// Cambia de pantalla, ventana o pestaña SIN parar la vigilancia ni perder los ajustes. El selector del navegador
// se abre con la fuente actual aún activa: si cancelas, sigues como estabas.
async function switchSource() {
  const stream = await pickSource();
  if (!stream) {
    setStatus("Se mantiene la fuente actual.");
    return;
  }
  const old = state.stream;
  old?.getVideoTracks()[0]?.removeEventListener("ended", state.onEnded);
  old?.getTracks().forEach((t) => t.stop());
  await attachStream(stream);
  resetSelection(); // la zona elegida pertenecía a la fuente anterior
  showSource();
  setStatus("Fuente cambiada. La vigilancia sigue activa y se vuelve a analizar.");
  syncControls();
  resizeCanvas();
}

function stopShare() {
  stopAuto();
  state.stream?.getVideoTracks()[0]?.removeEventListener("ended", state.onEnded);
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  els.video.srcObject = null;
  showSource();
  state.selecting = false;
  resetBaseline();
  syncControls();
  if (!state.busy) setStatus("Dejaste de compartir la pantalla.");
}

// ---------- selección de zona ----------

const ctx2d = els.canvas.getContext("2d");
let draft = null; // {start, current} mientras se arrastra

function resizeCanvas() {
  els.canvas.width = els.canvas.clientWidth;
  els.canvas.height = els.canvas.clientHeight;
  drawSelection();
}

function drawSelection() {
  const { width: W, height: H } = els.canvas;
  ctx2d.clearRect(0, 0, W, H);
  const rect = draft ? normalizeRect(draft.start, draft.current) : state.selection;
  if (!rect) return;
  const x = rect.x * W;
  const y = rect.y * H;
  const w = rect.w * W;
  const h = rect.h * H;
  ctx2d.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx2d.fillRect(0, 0, W, H);
  ctx2d.clearRect(x, y, w, h);
  ctx2d.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#5eead4";
  ctx2d.lineWidth = 2;
  ctx2d.setLineDash([6, 4]);
  ctx2d.strokeRect(x, y, w, h);
}

function pointerToNormalized(e) {
  const box = els.canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
    y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
  };
}

// Olvida lo analizado antes (miniatura base e historial del prompt): lo siguiente se analiza de cero.
function resetBaseline() {
  state.lastThumb = null;
  state.promptHistory = [];
  watch.prevThumb = null;
  watch.changedSince = null;
}

function resetSelection() {
  state.selection = null;
  state.selecting = false;
  resetBaseline();
  drawSelection();
}

els.selectBtn.addEventListener("click", () => {
  state.selecting = !state.selecting;
  syncControls();
});

els.fullBtn.addEventListener("click", () => {
  resetSelection();
  syncControls();
});

els.canvas.addEventListener("pointerdown", (e) => {
  if (!state.selecting) return;
  els.canvas.setPointerCapture(e.pointerId);
  const p = pointerToNormalized(e);
  draft = { start: p, current: p };
  drawSelection();
});

els.canvas.addEventListener("pointermove", (e) => {
  if (!draft) return;
  draft.current = pointerToNormalized(e);
  drawSelection();
});

els.canvas.addEventListener("pointerup", (e) => {
  if (!draft) return;
  draft.current = pointerToNormalized(e);
  const rect = normalizeRect(draft.start, draft.current);
  draft = null;
  const source = toSourceRect(rect, els.video.videoWidth, els.video.videoHeight);
  if (isRegionTooSmall(source)) {
    setStatus("La zona es demasiado pequeña. Arrastra un rectángulo más grande.", "error");
  } else {
    state.selection = rect;
    state.selecting = false;
    resetBaseline();
    setStatus("Zona elegida. Pulsa «Analizar ahora».");
  }
  drawSelection();
  syncControls();
});

els.canvas.addEventListener("pointercancel", () => {
  draft = null;
  drawSelection();
});

new ResizeObserver(resizeCanvas).observe(els.frame);
let lastSize = "";
els.video.addEventListener("resize", () => {
  const size = `${els.video.videoWidth}x${els.video.videoHeight}`;
  if (lastSize && size !== lastSize && state.stream) {
    resetSelection();
    showSource();
    setStatus("La fuente cambió de tamaño: se analiza la pantalla completa.");
    syncControls();
  }
  lastSize = size;
});
els.video.addEventListener("loadedmetadata", () => {
  resizeCanvas();
  updateSelectionInfo();
});

// ---------- captura ----------

const tinyCanvas = document.createElement("canvas");
tinyCanvas.width = 32;
tinyCanvas.height = 18;
const tinyCtx = tinyCanvas.getContext("2d", { willReadFrequently: true });

// Lectura barata (miniatura 32x18 en gris). Es lo único que se hace en cada pulso de vigilancia.
function sampleThumb() {
  const { videoWidth, videoHeight } = els.video;
  if (!videoWidth || !videoHeight) return null;
  const src = toSourceRect(state.selection, videoWidth, videoHeight);
  if (src.w < 1 || src.h < 1) return null;
  tinyCtx.drawImage(els.video, src.x, src.y, src.w, src.h, 0, 0, tinyCanvas.width, tinyCanvas.height);
  return luminance(tinyCtx.getImageData(0, 0, tinyCanvas.width, tinyCanvas.height).data);
}

// Recorte + reducción + JPEG. Es lo caro, así que solo se hace cuando de verdad se va a analizar.
function encodeFrame() {
  const { videoWidth, videoHeight } = els.video;
  if (!videoWidth || !videoHeight) throw new Error("El vídeo todavía no está listo.");
  const src = toSourceRect(state.selection, videoWidth, videoHeight);
  if (isRegionTooSmall(src)) throw new Error("La zona elegida es demasiado pequeña.");

  const out = fitSize(src.w, src.h, state.maxSide, state.minSide);
  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high"; // al ampliar, un suavizado bueno es lo que permite al OCR leer letra pequeña
  ctx.drawImage(els.video, src.x, src.y, src.w, src.h, 0, 0, out.width, out.height);

  const preview = document.createElement("canvas");
  const previewSize = fitSize(src.w, src.h, 320);
  preview.width = previewSize.width;
  preview.height = previewSize.height;
  preview.getContext("2d").drawImage(canvas, 0, 0, preview.width, preview.height);

  return { image: canvas.toDataURL("image/jpeg", state.quality), preview: preview.toDataURL("image/jpeg", 0.7) };
}

// ---------- análisis ----------

async function analyze() {
  if (state.busy || !state.stream) return { ok: false };

  let frame;
  let thumb;
  try {
    thumb = sampleThumb();
    frame = encodeFrame();
  } catch (err) {
    setStatus(err.message, "error");
    return { ok: false };
  }

  state.busy = true;
  syncControls();
  setStatus("Analizando…", "busy");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: frame.image,
        mode: els.modeSelect.value,
        language: els.languageSelect.value,
        note: els.noteInput.value.trim(),
        history: state.promptHistory,
        publish: els.publishCheck.checked,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message ?? `Error ${response.status}`);
      error.code = body.error;
      throw error;
    }
    if (body.refused) {
      setStatus("El modelo no pudo analizar esta captura (política de seguridad).", "error");
      return { ok: false };
    }

    state.lastThumb = thumb;
    state.promptHistory = [...state.promptHistory, { title: body.context.title, summary: body.context.summary }].slice(-3);
    addToHistory({ context: body.context, meta: body.meta, tracking: body.tracking, preview: frame.preview, at: new Date() });
    setStatus(`Listo en ${(body.meta.elapsed_ms / 1000).toFixed(1)} s. ${trackingSummary(body.tracking)}`.trim());
    refreshActivity();
    return { ok: true };
  } catch (err) {
    setStatus(err.message, "error");
    if (err.code === "no_backend") refreshBackend();
    return { ok: false, fatal: FATAL_CODES.has(err.code), code: err.code };
  } finally {
    state.busy = false;
    syncControls();
  }
}

// ---------- resultados e historial ----------

function render(entry) {
  const { context, meta, preview, tracking } = entry;
  els.card.hidden = false;
  els.categoryBadge.textContent = (CATEGORY_LABELS[els.languageSelect.value] ?? CATEGORY_LABELS.es)[context.category] ?? context.category;
  state.current = entry;
  els.textBox.hidden = !context.text;
  els.screenText.textContent = context.text ?? "";
  renderVerification(tracking, context);
  els.cardTitle.textContent = context.title;
  els.cardSummary.textContent = context.summary;
  els.cardChanges.hidden = !context.changes;
  els.cardChanges.textContent = context.changes ? `Novedad: ${context.changes}` : "";

  els.entities.replaceChildren(
    ...context.entities.flatMap((e) => {
      const dt = document.createElement("dt");
      dt.textContent = e.label;
      const dd = document.createElement("dd");
      dd.textContent = e.value;
      return [dt, dd];
    }),
  );

  renderWhy(context);
  els.chatLine.textContent = context.chat_line;
  els.chatBox.hidden = !context.chat_line;
  els.uncertainBox.hidden = context.uncertain.length === 0;
  els.uncertainList.replaceChildren(
    ...context.uncertain.map((u) => {
      const li = document.createElement("li");
      li.textContent = u;
      return li;
    }),
  );

  els.shot.hidden = !preview;
  if (preview) els.shot.src = preview;
  // El OCR local no gasta tokens: no tiene sentido mostrar «0 tokens».
  const tokens = meta.usage?.input_tokens || meta.usage?.output_tokens ? ` · ${meta.usage.input_tokens} tokens de entrada / ${meta.usage.output_tokens} de salida` : "";
  els.meta.textContent = `${meta.model}${tokens}`;
}

const pct = (n) => `${Math.round(n * 100)} %`;

function trackingSummary(tracking) {
  if (!tracking) return "";
  if (tracking.verified) return "Verificado: se exporta.";
  if (tracking.state === "confirming") return `Confirmando (${tracking.confirmations}/${tracking.needed}): aún no se exporta.`;
  if (tracking.state === "switching") return "¿Cambio de actividad? Se confirmará si se repite.";
  return `Certeza baja (${pct(tracking.certainty)}): no se exporta.`;
}

// Qué se ha concluido y cuánta seguridad hay, sin disfrazar una suposición de certeza.
function renderVerification(tracking, context) {
  const certainty = context.certainty ?? 0;
  const set = (cls, badge, text) => {
    els.verifyBadge.className = `vbadge ${cls}`.trim();
    els.verifyBadge.textContent = badge;
    els.verifyText.textContent = text;
  };
  if (!tracking) return set("", "No publicado", `Certeza ${pct(certainty)}. «Publicar en el overlay» está desmarcado: no se sigue ni se exporta.`);
  if (tracking.state === "verified") return set("ok", "✓ Verificado", `Certeza ${pct(certainty)} · visto en ${tracking.confirmations} lecturas seguidas. Se exporta a la API, el overlay, el webhook y el MCP.`);
  if (tracking.state === "confirming") return set("warn", `Confirmando ${tracking.confirmations}/${tracking.needed}`, `Certeza ${pct(certainty)}. Se exportará cuando se repita en otra lectura seguida; así un fotograma de transición no se da por cierto.`);
  if (tracking.state === "switching") return set("warn", "¿Cambio de actividad?", `Certeza ${pct(certainty)}. Parece otra actividad, pero hace falta verla ${tracking.needed} veces seguidas para cambiar.`);
  return set("low", "Certeza baja", `Certeza ${pct(certainty)}, por debajo del mínimo de ${pct(tracking.minCertainty)}: no se exporta.`);
}

// «¿Por qué lo digo?»: los motivos de la conclusión y, de cada dato, el texto de la pantalla en que se basa.
function renderWhy(context) {
  const reasons = context.reasons ?? [];
  const evidence = context.evidence ?? [];
  els.whyBox.hidden = reasons.length === 0 && evidence.length === 0;
  els.reasonsList.replaceChildren(
    ...reasons.map((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      return li;
    }),
  );
  els.evidenceList.replaceChildren(
    ...evidence.map((e) => {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = e.text;
      li.append(`${e.label}: ${e.value} ← `, code, ` (OCR ${e.confidence} %)`);
      return li;
    }),
  );
}

// Si el servidor protege la API con PANTALLA_API_TOKEN, abre el visor como http://127.0.0.1:3000/?token=TU_TOKEN.
const pageToken = new URLSearchParams(location.search).get("token");
const authHeaders = pageToken ? { authorization: `Bearer ${pageToken}` } : {};
// Dirección de un recurso exportable, con el token solo si el visor se abrió con él (para el overlay de OBS, que lo necesita).
const exportUrl = (path) => `${location.origin}${path}${pageToken ? `${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(pageToken)}` : ""}`;
const TOKEN_NOTE = " Incluye tu token: no la compartas en público.";

// Lo que has estado haciendo y desde cuándo, con los eventos confirmados.
async function refreshActivity() {
  try {
    const response = await fetch("/api/session?verified=all", { headers: authHeaders });
    if (response.status === 401) {
      els.activityBox.hidden = false;
      els.activityText.textContent = "La API está protegida con token: abre el visor con ?token=TU_TOKEN al final de la dirección para ver la actividad.";
      return;
    }
    const snapshot = await response.json();
    els.activityBox.hidden = !snapshot.current && !snapshot.candidate && snapshot.recent.length === 0;
    els.activityText.textContent = sessionToText(snapshot, { language: els.languageSelect.value });
  } catch {
    // La actividad es un extra: si falla, el resto sigue funcionando.
  }
}

function addToHistory(entry) {
  state.history.push(entry);
  if (state.history.length > MAX_HISTORY) state.history.shift();
  state.selectedHistory = state.history.length - 1;
  render(entry);
  renderHistory();
}

function renderHistory() {
  els.historyBox.hidden = state.history.length === 0;
  els.historyList.replaceChildren(
    ...state.history
      .map((entry, index) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        if (index === state.selectedHistory) button.setAttribute("aria-current", "true");
        const time = document.createElement("time");
        time.textContent = entry.at.toLocaleTimeString();
        button.append(time, entry.context.title);
        button.addEventListener("click", () => {
          state.selectedHistory = index;
          render(entry);
          renderHistory();
        });
        li.append(button);
        return li;
      })
      .reverse(),
  );
}

// ---------- vigilancia automática ----------
// Cada segundo se lee una miniatura (casi gratis). Solo cuando la imagen cambió, se quedó quieta y pasó
// la separación mínima se codifica y se envía al analizador. Así el consumo en reposo es mínimo.

const watch = { timer: null, prevThumb: null, changedSince: null, lastEnd: 0, notBefore: 0, mode: "" };

function setWatchStatus(mode, text) {
  if (watch.mode === mode) return;
  watch.mode = mode;
  setStatus(text);
}

async function watchTick() {
  if (!state.stream) return;
  const thumb = sampleThumb();
  if (!thumb) return;

  const now = Date.now();
  const onlyChanges = els.changesCheck.checked;
  const hasBaseline = state.lastThumb !== null;
  const differs = hasBaseline && changeRatio(state.lastThumb, thumb) >= CHANGE_RATIO;
  // Sin "solo si cambia", se analiza a intervalos fijos como antes: todo cuenta como cambio y ya quieto.
  const changed = onlyChanges ? differs : true;
  const settled = onlyChanges ? watch.prevThumb !== null && changeRatio(watch.prevThumb, thumb) < SETTLED_RATIO : true;
  watch.prevThumb = thumb;
  if (!changed) watch.changedSince = null;
  else if (watch.changedSince === null) watch.changedSince = now;

  const action = decideWatch({
    busy: state.busy,
    now,
    notBefore: watch.notBefore,
    lastEnd: watch.lastEnd,
    minGapMs: Number(els.intervalSelect.value) * 1000,
    heartbeatMs: Number(els.heartbeatSelect.value) * 1000,
    hasBaseline,
    changed,
    settled,
    changedSince: watch.changedSince,
    maxSettleMs: MAX_SETTLE_MS,
  });

  if (action === "analyze") {
    watch.changedSince = null;
    const result = await analyze();
    watch.lastEnd = Date.now();
    watch.mode = "";
    if (result.fatal) return stopAuto();
    if (!result.ok) {
      const slow = result.code === "rate_limited" || result.code === "busy";
      watch.notBefore = watch.lastEnd + (slow ? RATE_LIMIT_BACKOFF_MS : BACKOFF_MS);
    }
    return;
  }
  if (state.busy || now < watch.notBefore) return; // no pisar el mensaje de «Analizando…» ni el de un error
  if (action === "wait") setWatchStatus("wait", "Cambio detectado: esperando para analizar…");
  else setWatchStatus("idle", "Vigilando: sin cambios.");
}

function startAuto() {
  watch.lastEnd = 0;
  watch.notBefore = 0;
  watch.mode = "";
  watchTick();
  watch.timer = setInterval(watchTick, WATCH_TICK_MS);
}

function stopAuto() {
  clearInterval(watch.timer);
  watch.timer = null;
  els.autoCheck.checked = false;
}

els.autoCheck.addEventListener("change", () => (els.autoCheck.checked ? startAuto() : stopAuto()));

// ---------- eventos varios ----------

els.shareBtn.addEventListener("click", () => (state.stream ? stopShare() : startShare()));
els.analyzeBtn.addEventListener("click", () => analyze());

els.modeSelect.addEventListener("change", () => {
  resetBaseline();
  saveSettings();
});
for (const el of [els.languageSelect, els.surfaceSelect, els.noteInput, els.intervalSelect, els.heartbeatSelect, els.changesCheck, els.publishCheck]) {
  el.addEventListener("change", saveSettings);
}

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(okMessage);
  } catch {
    setStatus("No se pudo copiar al portapapeles.", "error");
  }
}

els.copyChatBtn.addEventListener("click", () => copyText(els.chatLine.textContent, "Frase copiada."));
els.copyAiBtn.addEventListener("click", () => {
  if (!state.current) return;
  const { context, tracking } = state.current;
  const withCheck = { ...context, verified: Boolean(tracking?.verified), confirmations: tracking?.confirmations };
  copyText(contextToPrompt(withCheck, { language: els.languageSelect.value }), tracking?.verified ? "Contexto verificado copiado: pégalo en cualquier IA." : "Contexto copiado (SIN VERIFICAR, y así se lo dice a la otra IA).");
});
els.copyActivityBtn.addEventListener("click", () => copyText(els.activityText.textContent, "Actividad copiada: pégala en cualquier IA."));
els.switchBtn.addEventListener("click", () => switchSource());
els.copyApiBtn.addEventListener("click", () =>
  copyText(exportUrl("/api/context?format=prompt"), `URL copiada: cualquier IA o bot que la lea sabrá el contexto actual.${pageToken ? TOKEN_NOTE : ""}`),
);
els.copyOverlayBtn.addEventListener("click", () =>
  copyText(exportUrl("/overlay"), `URL del overlay copiada. En OBS: Fuentes → Navegador → pega la URL.${pageToken ? TOKEN_NOTE : ""}`),
);

// ---------- arranque ----------

let backendTimer = null;

// Muestra qué analizador hay y si está listo. Mientras no lo esté, vuelve a mirar cada pocos segundos
// para que el aviso desaparezca solo cuando el usuario arranque Ollama o configure la clave.
async function refreshBackend() {
  clearTimeout(backendTimer);
  try {
    const { backend, export: policy } = await (await fetch("/api/config")).json();
    state.policy = policy ?? state.policy;
    els.exportInfo.textContent = policy
      ? `Exportación: ${policy.mode === "verified" ? `solo lo verificado (certeza ≥ ${Math.round(policy.minCertainty * 100)} % y ${policy.stableFrames} lecturas seguidas)` : "todo, marcando lo no verificado"}${policy.protected ? " · protegida con token" : ""}`
      : "";
    state.maxSide = backend.maxSide ?? state.maxSide;
    state.minSide = backend.minSide ?? 0;
    state.quality = backend.quality ?? 0.8;
    const cost = COST_LABELS[backend.cost] ?? backend.cost;
    els.backendInfo.textContent = `Analizador: ${backend.name} · ${backend.model} · ${cost}`;
    els.backendInfo.classList.toggle("ok", backend.ready);
    showBanner(backend.ready ? "" : backend.hint ?? "No hay analizador disponible.");
    if (!backend.ready) backendTimer = setTimeout(refreshBackend, 5000);
  } catch {
    showBanner("No se pudo contactar con el servidor local.");
    backendTimer = setTimeout(refreshBackend, 5000);
  }
}

async function init() {
  const settings = loadSettings();
  els.noteInput.value = settings.note ?? "";
  els.languageSelect.value = settings.language ?? "es";
  els.surfaceSelect.value = ["any", "browser", "window", "monitor"].includes(settings.surface) ? settings.surface : "any";
  els.intervalSelect.value = settings.interval ?? "10";
  els.heartbeatSelect.value = settings.heartbeat ?? "0";
  els.changesCheck.checked = settings.onlyChanges ?? true;
  els.publishCheck.checked = settings.publish ?? true;

  try {
    const config = await (await fetch("/api/config")).json();
    els.modeSelect.replaceChildren(
      ...config.modes.map((m) => {
        const option = document.createElement("option");
        option.value = m.id;
        option.textContent = m.label;
        return option;
      }),
    );
    els.modeSelect.value = config.modes.some((m) => m.id === settings.mode) ? settings.mode : "auto";
  } catch {
    // refreshBackend() mostrará el aviso.
  }
  await refreshBackend();
  syncControls();
}

init();
