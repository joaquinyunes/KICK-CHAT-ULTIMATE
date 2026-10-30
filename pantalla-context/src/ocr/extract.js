import { PRIVATE_CATEGORIES } from "../modes.js";
import { classify } from "./classify.js";
import { describe } from "./describe.js";
import { buildIndex, findNamesInLine, mergeKnowledge, normalizeText } from "./knowledge.js";
import { labels } from "./labels.js";
import { detectSignals } from "./signals.js";

// Convierte las líneas que lee el OCR en un contexto estructurado, SIN ningún modelo de IA: solo reglas.
//   1. limpia el ruido y enmascara datos sensibles,  2. reconoce nombres del catálogo,  3. detecta señales (importes, marcador,
//   direcciones, errores...),  4. decide la actividad sumando evidencias (classify.js),  5. lo redacta (describe.js).
// Es honesto sobre sus límites: no entiende imágenes, solo texto, y lo dice cuando deduce algo.

const MAX_TEXT = 2000;

// Enmascara lo que no debería viajar a otra IA aunque el usuario no lo haya pensado: correos y números largos
// (tarjetas, cuentas). Los importes normales (saldo, apuesta) NO se tocan: son justo el contexto que se busca.
export function redactSensitive(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[correo]")
    .replace(/\b(?:\d[ -]?){12,19}\b/g, "[número]");
}

// Limpia las líneas, descarta el ruido de iconos y dibujos y calcula en qué franja de la pantalla está cada una.
// `height` es la altura real de la imagen; sin ella se estima con la línea más baja.
// Patrones con estructura (hora, marcador, importe, cuarto): aunque el OCR los lea con poca confianza, merece la pena conservarlos.
const STRUCTURED = /\d{1,2}:\d{2}|\d+\s*[-:]\s*\d+|[€$£]\s?\d|\b[Qq][1-4]\b/;

// Franja de la pantalla: arriba (barra de título, pestañas, dirección), abajo (barra de estado) o cuerpo.
// La barra de título tiene letra PEQUEÑA: un titular grande que empieza cerca del borde superior no es «barra».
function zoneOf(line, H, hasLayout) {
  if (!hasLayout || !line.bbox) return "body";
  const h = line.bbox.y1 - line.bbox.y0;
  if (line.bbox.y0 < 0.14 * H && h <= 0.05 * H) return "top";
  if (line.bbox.y1 > 0.92 * H && h <= 0.05 * H) return "bottom";
  return "body";
}

function prepareLines(rawLines, height) {
  const lines = rawLines
    .map((l) => ({ ...l, text: redactSensitive(l.text.replace(/\s+/g, " ").trim()) }))
    .filter((l) => {
      const alnum = (l.text.match(/[\p{L}\p{N}]/gu) ?? []).length;
      if (l.text.length < 2 || alnum / l.text.length < 0.55) return false; // símbolos sueltos: ruido de iconos y dibujos
      if (l.confidence >= 80) return alnum >= 2; // etiquetas cortas y seguras: «HP», «x25»
      if (l.confidence >= 25) return alnum >= 3;
      return l.confidence >= 15 && STRUCTURED.test(l.text) && alnum >= 3;
    });
  const boxes = lines.filter((l) => l.bbox);
  const H = height ?? Math.max(1, ...boxes.map((l) => l.bbox.y1));
  const spread = boxes.length ? Math.max(...boxes.map((l) => l.bbox.y0)) - Math.min(...boxes.map((l) => l.bbox.y0)) : 0;
  const hasLayout = height != null || spread > 0.2 * H; // sin posiciones fiables, todo cuenta como «cuerpo»
  return lines.map((l) => ({
    ...l,
    height: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0,
    norm: normalizeText(l.text),
    zone: zoneOf(l, H, hasLayout),
  }));
}

// ¿En qué línea de la pantalla se basa este dato? Sirve para que el usuario pueda comprobarlo.
function evidenceFor(entities, lines) {
  const out = [];
  for (const { label, value } of entities) {
    const candidates = [value, ...value.split(" · ")].map(normalizeText).filter((n) => n.length >= 2);
    const line = candidates.map((c) => lines.find((l) => l.norm.includes(c))).find(Boolean);
    if (line) out.push({ label, value, text: line.text.slice(0, 100), confidence: Math.round(line.confidence) });
  }
  return out;
}

const level = (certainty) => (certainty >= 0.8 ? "high" : certainty >= 0.5 ? "medium" : "low");

// Entrada: { lines: [{text, confidence, bbox}], confidence, height?, enhanced? }
// Opciones: { language, mode, note, knowledge, history, keepPrivateText }
// `note` es la pista del usuario («estoy en Sweet Bonanza»): completa lo que la zona elegida no muestra.
export function extractContext(ocr, { language = "es", mode = "auto", note = "", knowledge = mergeKnowledge(), history = [], index = buildIndex(knowledge), keepPrivateText = false } = {}) {
  const t = labels(language);
  const lines = prepareLines(ocr.lines, ocr.height ?? null);
  const uncertain = [t.note.onlyText];

  if (lines.length === 0) {
    return { category: "other", title: t.cat.other, summary: t.noText, activity: "", entities: [], chat_line: t.cat.other, changes: "", confidence: "low", uncertain, text: "", certainty: 0, evidence: [], reasons: [], subject: "" };
  }

  const hint = redactSensitive(String(note ?? "").trim()).slice(0, 200);
  const matches = [
    ...lines.flatMap((l) => findNamesInLine(index, l.text).map((m) => ({ ...m, zone: l.zone, conf: l.confidence }))),
    ...(hint ? findNamesInLine(index, hint).map((m) => ({ ...m, fromHint: true, zone: "body" })) : []),
  ];
  const signals = detectSignals(lines);
  const normAll = lines.map((l) => l.norm).join(" ¶ ");
  const verdict = classify({ lines, signals, matches, mode, normAll, language, knowledge });
  const d = describe({ category: verdict.category, signals, matches, lines, language });

  const entities = d.entities.slice(0, 8);
  const priv = PRIVATE_CATEGORIES.includes(verdict.category) && !keepPrivateText;
  const text = priv ? "" : lines.map((l) => l.text).join("\n").slice(0, MAX_TEXT);
  const evidence = evidenceFor(entities, lines);
  if (hint) entities.push({ label: t.e.hint, value: hint });

  uncertain.push(...d.notes);
  if (matches.some((m) => m.fromHint && entities.some((e) => normalizeText(e.value).includes(m.norm)))) uncertain.push(t.note.fromHint);
  if (ocr.enhanced) uncertain.push(t.note.enhanced);
  if (priv) uncertain.push(t.note.privateText);
  const meanConf = lines.reduce((n, l) => n + l.confidence * l.text.length, 0) / lines.reduce((n, l) => n + l.text.length, 0);
  if (meanConf < 55) uncertain.push(t.note.lowOcr);

  // Si se deduce un nombre de lo más grande de la pantalla, la certeza baja: es una suposición, no una coincidencia.
  const deduced = d.notes.includes(t.note.deduced);
  const certainty = Math.round(verdict.certainty * (deduced ? 0.6 : 1) * 100) / 100;

  const previous = history.at(-1);
  return {
    category: verdict.category,
    title: d.title.slice(0, 120),
    summary: d.summary.slice(0, 500),
    activity: d.activity,
    entities: entities.slice(0, 9),
    chat_line: (d.chat || d.title).slice(0, 240),
    changes: previous && previous.title !== d.title ? `${t.before}: ${previous.title}` : "",
    confidence: level(certainty),
    uncertain,
    text,
    certainty,
    evidence,
    reasons: verdict.reasons,
    subject: d.subject.slice(0, 100),
  };
}
