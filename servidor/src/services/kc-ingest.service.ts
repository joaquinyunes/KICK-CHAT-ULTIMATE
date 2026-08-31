import fs from "fs";
import path from "path";
import os from "os";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { kcDataDir } from "./kc-supervisor.service";
import { enqueueKcLines } from "./kc-sender.service";

/**
 * Ingesta automática del contexto de proyecto-kick-context (Módulo 12).
 *
 * Ese proyecto genera con Gemini un lote de ~30 líneas de chat cada 5 min y lo
 * deja como `<data>/comentarios/lotes/lote_<ts>.json` (escritura atómica).
 * Acá lo leemos cada `KC_INGEST_POLL_SEG` segundos y lo volcamos a
 * `data/context-chat/incoming.txt`, que el panel de chat absorbe solo.
 */

const TAG = "kc-ingest";

const OUT_DIR = path.resolve(process.cwd(), "data", "context-chat");
const OUT_FILE = path.join(OUT_DIR, "incoming.txt");
const STATE_FILE = path.join(OUT_DIR, "state.json");

interface IngestState {
  lastTs: number;
  lastCount: number;
  lastIngestAt: string;
}

let timer: NodeJS.Timeout | null = null;
let lastError = "";

function enabled(): boolean {
  const v = (env.KC_INGEST_ENABLED || "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

function lotesDir(): string {
  const custom = (env.KC_LOTES_DIR || "").trim();
  if (custom) return custom;

  // Misma carpeta de datos que usa el supervisor para el pipeline Python.
  const inRepo = path.join(kcDataDir(), "comentarios", "lotes");
  if (fs.existsSync(inRepo)) return inRepo;

  // proyecto-kick-context corriendo por fuera con su carpeta por defecto.
  const home = path.join(os.homedir(), "kick-context-data", "comentarios", "lotes");
  if (fs.existsSync(home)) return home;

  return inRepo;
}

function readState(): IngestState {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return {
      lastTs: Number(s.lastTs) || 0,
      lastCount: Number(s.lastCount) || 0,
      lastIngestAt: typeof s.lastIngestAt === "string" ? s.lastIngestAt : "",
    };
  } catch {
    return { lastTs: 0, lastCount: 0, lastIngestAt: "" };
  }
}

function writeState(s: IngestState): void {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf-8");
    fs.renameSync(tmp, STATE_FILE);
  } catch (e: any) {
    logger.warn(TAG, `No se pudo guardar el estado: ${e.message}`);
  }
}

function parseLote(file: string): string[] {
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  const arr: unknown = data?.mensajes;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((m: any) => (typeof m === "string" ? m : String(m?.mensaje ?? m?.message ?? "")))
    .map((s: string) => s.replace(/[\r\n]+/g, " ").trim())
    .filter((s: string) => s.length > 0);
}

function writeIncoming(lines: string[]): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = OUT_FILE + ".tmp";
  fs.writeFileSync(tmp, lines.join("\n") + "\n", "utf-8");
  fs.renameSync(tmp, OUT_FILE);
}

/** Lee la carpeta de lotes una vez y absorbe el más nuevo si hay uno sin procesar. */
export function tick(): void {
  if (!enabled()) return;

  const dir = lotesDir();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    lastError = `No existe la carpeta de lotes: ${dir}`;
    return;
  }
  lastError = "";

  const lotes = entries
    .map((name) => {
      const m = /^lote_(\d+)\.json$/.exec(name);
      return m ? { name, ts: Number(m[1]) } : null;
    })
    .filter((x): x is { name: string; ts: number } => x !== null)
    .sort((a, b) => a.ts - b.ts);

  if (lotes.length === 0) return;

  const state = readState();
  const nuevos = lotes.filter((l) => l.ts > state.lastTs);
  if (nuevos.length === 0) return;

  // El más nuevo manda: son ~30 líneas cada 5 min, no acumulamos lotes viejos.
  const elegido = nuevos[nuevos.length - 1];
  try {
    const lines = parseLote(path.join(dir, elegido.name));
    if (lines.length === 0) {
      logger.warn(TAG, `${elegido.name} sin mensajes utilizables`);
      writeState({ ...state, lastTs: elegido.ts });
      return;
    }
    writeIncoming(lines);
    writeState({ lastTs: elegido.ts, lastCount: lines.length, lastIngestAt: new Date().toISOString() });
    logger.info(TAG, `Absorbido ${elegido.name}: ${lines.length} líneas`);
    enqueueKcLines(lines, elegido.ts);
  } catch (e: any) {
    lastError = `Error leyendo ${elegido.name}: ${e.message}`;
    logger.error(TAG, lastError);
  }
}

export function startKcIngest(): void {
  if (!enabled()) {
    logger.info(TAG, "Ingesta de contexto KC deshabilitada (KC_INGEST_ENABLED=0)");
    return;
  }
  const seg = env.KC_INGEST_POLL_SEG || 300;
  logger.info(TAG, `Ingesta de contexto KC activa: ${lotesDir()} (cada ${seg}s)`);
  try {
    tick();
  } catch (e: any) {
    logger.error(TAG, `tick inicial falló: ${e.message}`);
  }
  timer = setInterval(() => {
    try {
      tick();
    } catch (e: any) {
      logger.error(TAG, `tick falló: ${e.message}`);
    }
  }, seg * 1000);
  timer.unref?.();
}

let regenWatch: NodeJS.Timeout | null = null;

/**
 * Prepara la ingesta para una regeneración: borra el incoming y marca el
 * estado con la hora actual, así ignora todos los lotes viejos y solo
 * absorbe el lote nuevo que el Módulo 12 va a escribir en unos segundos.
 */
export function primeForRegenerate(): void {
  try {
    fs.unlinkSync(OUT_FILE);
  } catch {
    /* no existía */
  }
  writeState({ lastTs: Math.floor(Date.now() / 1000), lastCount: 0, lastIngestAt: "" });
}

/**
 * Tras pedir una regeneración: barre la carpeta de lotes cada pocos segundos
 * hasta absorber el lote nuevo (el Módulo 12 puede tardar 1-2 min si Gemini
 * está con 503 y hay que caer al modelo de respaldo). Corta solo.
 */
export function watchForRegenerate(maxMs = 180_000): void {
  if (regenWatch) clearInterval(regenWatch);
  const startedAt = Date.now();
  const baseline = readState().lastTs;
  try {
    tick();
  } catch {
    /* noop */
  }
  regenWatch = setInterval(() => {
    try {
      tick();
    } catch {
      /* noop */
    }
    const absorbido = readState().lastTs > baseline;
    if (absorbido || Date.now() - startedAt > maxMs) {
      if (regenWatch) clearInterval(regenWatch);
      regenWatch = null;
      if (absorbido) logger.info(TAG, "Lote regenerado absorbido");
      else logger.warn(TAG, "Regeneración: no llegó un lote nuevo en 3 min");
    }
  }, 4000);
  regenWatch.unref?.();
}

export function stopKcIngest(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export interface KcSummary {
  timestamp: number;
  fase: string | null;
  resumen_actual: string | null;
  contexto_previo: string | null;
  tendencia_detectada: string | null;
}

/** Últimos N resúmenes del Módulo 8 — el contexto real que alimenta al M12. */
export function getKcSummaries(n = 8): KcSummary[] {
  const dir = path.join(kcDataDir(), "summaries");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => /^resumen_\d+\.json$/.test(f));
  } catch {
    return [];
  }
  files.sort();
  const out: KcSummary[] = [];
  for (const f of files.slice(-n)) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      out.push({
        timestamp: Number(d.timestamp) || 0,
        fase: d.fase ?? null,
        resumen_actual: d.resumen_actual ?? null,
        contexto_previo: d.contexto_previo ?? null,
        tendencia_detectada: d.tendencia_detectada ?? null,
      });
    } catch {
      /* archivo a medio escribir */
    }
  }
  return out.reverse();
}

export function isRegenerating(): boolean {
  return regenWatch != null;
}

export interface KcIngestStatus {
  enabled: boolean;
  lotesDir: string;
  lastTs: number;
  lastCount: number;
  lastIngestAt: string;
  lastError: string;
  lines: string[];
  mtime: number;
  regenerating: boolean;
}

export function getKcIngestStatus(): KcIngestStatus {
  const state = readState();
  let lines: string[] = [];
  let mtime = 0;
  try {
    mtime = fs.statSync(OUT_FILE).mtimeMs;
    lines = fs
      .readFileSync(OUT_FILE, "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim());
  } catch {
    /* todavía no hay archivo */
  }
  return {
    enabled: enabled(),
    lotesDir: lotesDir(),
    lastTs: state.lastTs,
    lastCount: state.lastCount,
    lastIngestAt: state.lastIngestAt,
    lastError,
    lines,
    mtime,
    regenerating: isRegenerating(),
  };
}
