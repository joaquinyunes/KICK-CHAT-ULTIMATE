import { spawn, execFile, execFileSync, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { findPython } from "../utils/python";

/**
 * Supervisor del pipeline de contexto (proyecto-kick-context, ya absorbido
 * en `kick-context/`). Lanza el Módulo 10 (orquestador) que a su vez levanta
 * los módulos 1-9 y el 12 (comentarista). El 12 deja el lote de ~30 líneas
 * cada 5 min, que `kc-ingest.service.ts` absorbe.
 *
 * Gated por KC_PIPELINE_ENABLED (default "0"): necesita Python + ffmpeg +
 * KICK_GEMINI_API_KEY, así que no arranca solo salvo que se pida.
 */

const TAG = "kc-pipeline";

const RESTART_MIN_MS = 5_000;
const RESTART_MAX_MS = 60_000;
const CRASH_WINDOW_MS = 600_000;
const MAX_CRASHES_IN_WINDOW = 6;

let child: ChildProcess | null = null;
let stopping = false;
let restartTimer: NodeJS.Timeout | null = null;
let backoff = RESTART_MIN_MS;
let crashes: number[] = [];
let blocked = false;

const state = {
  startedAt: 0,
  lastExitCode: null as number | null,
  lastExitAt: 0,
  lastError: "",
  restarts: 0,
};

export function kcDir(): string {
  const custom = (env.KC_DIR || "").trim();
  return custom || path.resolve(process.cwd(), "..", "kick-context");
}

export function kcDataDir(): string {
  const custom = (env.KICK_CONTEXT_DATA_DIR || "").trim();
  return custom || path.resolve(process.cwd(), "..", "kick-context-data");
}

function orchestratorScript(): string {
  return path.join(kcDir(), "src", "modulo10_orquestador", "orquestador.py");
}

export function kcControlDir(): string {
  return path.join(kcDataDir(), "control");
}

function captureFile(): string {
  return path.join(kcDataDir(), "capture.json");
}

export interface KcCapture {
  monitor: string;
  windowTitle: string;
}

/** Qué pantalla/ventana captura el Módulo 1 (persistido en capture.json). */
export function getCaptureConfig(): KcCapture {
  try {
    const d = JSON.parse(fs.readFileSync(captureFile(), "utf-8"));
    return { monitor: String(d.monitor ?? ""), windowTitle: String(d.windowTitle ?? "") };
  } catch {
    return { monitor: "", windowTitle: "" };
  }
}

export function setCaptureConfig(c: Partial<KcCapture>): KcCapture {
  const cur = getCaptureConfig();
  const next: KcCapture = {
    monitor: c.monitor !== undefined ? String(c.monitor).trim() : cur.monitor,
    windowTitle: c.windowTitle !== undefined ? String(c.windowTitle).trim() : cur.windowTitle,
  };
  try {
    fs.mkdirSync(kcDataDir(), { recursive: true });
    fs.writeFileSync(captureFile(), JSON.stringify(next, null, 2), "utf-8");
  } catch (e: any) {
    logger.warn(TAG, `No se pudo guardar capture.json: ${e.message}`);
  }
  return next;
}

function pipelineEnabled(): boolean {
  const v = (env.KC_PIPELINE_ENABLED || "0").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "auto";
}

function simulation(): boolean {
  const v = (env.KC_SIMULATION || "0").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "si";
}

/** Env extra para el pipeline Python. En simulación acelera las cadencias. */
function pipelineEnv(): Record<string, string> {
  const extra: Record<string, string> = {
    // KC solo genera: el envío al chat lo hace KCU (kc-sender.service).
    KICK_COMENTARIO_POSTEAR: "0",
    // El resumen (M8) y la generación (M12) van por Gemini, no Ollama.
    KICK_LLM_PROVIDER: "gemini",
    // KCU absorbe los lotes por polling — el hook externo del M12 sobra.
    KICK_COMENTARIO_HOOK_CMD: "",
    // M8 en modo rápido (< 15 s de atraso, ver ACTA-analizador-streamchat.md).
    KICK_RESUMEN_MODO: process.env.KICK_RESUMEN_MODO || "rapido",
  };
  if (simulation()) {
    extra.KICK_SIMULACION = "1";
    // Modo prueba: cadencias rápidas para ver el flujo enseguida.
    extra.KICK_RESUMEN_INTERVALO_SEG = "20";
    extra.KICK_COMENTARIO_BLOQUE_SEG = "90";
  }
  // Pantalla / ventana que captura el Módulo 1 (elegida desde el panel).
  const cap = getCaptureConfig();
  if (cap.windowTitle) extra.KICK_VIDEO_WINDOW_TITLE = cap.windowTitle;
  else if (cap.monitor) extra.KICK_VIDEO_MONITOR = cap.monitor;
  return extra;
}

/**
 * El orquestador Python lanza módulos 1-9 + 12 como subprocesos y arranca
 * ffmpeg. `child.kill()` sólo mata al orquestador y deja huérfanos, así que
 * en Windows matamos el árbol entero con taskkill /T.
 */
function killTree(pid: number | undefined, hard: boolean): void {
  if (!pid) return;
  if (process.platform === "win32") {
    const args = ["/pid", String(pid), "/T"];
    if (hard) args.push("/F");
    execFile("taskkill", args, () => { /* ya muerto = ok */ });
  } else {
    try { process.kill(-pid, hard ? "SIGKILL" : "SIGTERM"); } catch { /* noop */ }
  }
}

function logStream(prefix: string, buf: Buffer): void {
  const text = buf.toString("utf-8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t) logger.info(`${TAG}:${prefix}`, t);
  }
}

function scheduleRestart(): void {
  if (stopping || blocked) return;

  const now = Date.now();
  crashes = crashes.filter((t) => now - t < CRASH_WINDOW_MS);
  if (crashes.length >= MAX_CRASHES_IN_WINDOW) {
    blocked = true;
    state.lastError = `Se cayó ${MAX_CRASHES_IN_WINDOW} veces en 10 min. Supervisor detenido — revisá los logs.`;
    logger.error(TAG, state.lastError);
    return;
  }

  logger.warn(TAG, `Reiniciando el pipeline en ${Math.round(backoff / 1000)}s`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    spawnPipeline();
  }, backoff);
  restartTimer.unref?.();
  backoff = Math.min(backoff * 2, RESTART_MAX_MS);
}

function spawnPipeline(): void {
  if (child) return;

  const script = orchestratorScript();
  if (!fs.existsSync(script)) {
    state.lastError = `No se encontró el orquestador: ${script}`;
    logger.error(TAG, state.lastError);
    return;
  }

  const py = findPython();
  if (!py) {
    state.lastError = "No se encontró Python (probé python, python3, py). Instalá Python 3.11 o seteá PYTHON_PATH.";
    logger.error(TAG, state.lastError);
    return;
  }

  const dataDir = kcDataDir();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    /* KC lo crea igual con ensure_dirs() */
  }

  stopping = false;
  state.lastError = "";

  const proc = spawn(py, [script], {
    cwd: path.join(kcDir(), "src"),
    env: {
      ...process.env,
      KICK_CONTEXT_DATA_DIR: dataDir,
      PYTHONIOENCODING: "utf-8",
      PYTHONUNBUFFERED: "1",
      ...pipelineEnv(),
    },
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  child = proc;
  state.startedAt = Date.now();
  logger.info(TAG, `Pipeline arrancado (pid ${proc.pid}) — data: ${dataDir}`);

  proc.stdout?.on("data", (b: Buffer) => logStream("out", b));
  proc.stderr?.on("data", (b: Buffer) => logStream("err", b));

  proc.on("exit", (code, signal) => {
    const deadPid = proc.pid;
    child = null;
    state.lastExitCode = code;
    state.lastExitAt = Date.now();
    logger.warn(TAG, `Pipeline terminó (code=${code} signal=${signal})`);
    // El orquestador murió pero sus módulos + ffmpeg pueden seguir vivos.
    killTree(deadPid, true);
    if (!stopping) {
      crashes.push(Date.now());
      state.restarts += 1;
      scheduleRestart();
    }
  });

  proc.on("error", (err) => {
    state.lastError = err.message;
    logger.error(TAG, `Error de spawn: ${err.message}`);
  });

  // Un arranque que aguanta 60s resetea el backoff.
  setTimeout(() => {
    if (child === proc) backoff = RESTART_MIN_MS;
  }, 60_000).unref?.();
}

export function startKcPipeline(opts: { manual?: boolean } = {}): { ok: boolean; message: string } {
  if (!opts.manual && !pipelineEnabled()) {
    logger.info(TAG, "Pipeline de contexto deshabilitado (KC_PIPELINE_ENABLED=0)");
    return { ok: false, message: "KC_PIPELINE_ENABLED=0" };
  }
  if (child) return { ok: true, message: "Ya estaba corriendo" };

  blocked = false;
  crashes = [];
  backoff = RESTART_MIN_MS;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  spawnPipeline();
  return child
    ? { ok: true, message: "Pipeline arrancado" }
    : { ok: false, message: state.lastError || "No se pudo arrancar" };
}

/** Mata el árbol de forma bloqueante. Para usar en el shutdown del proceso. */
export function killPipelineSync(): void {
  stopping = true;
  const pid = child?.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { timeout: 5_000, stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch { /* ya muerto */ }
}

export function restartKcPipeline(): { ok: boolean; message: string } {
  stopKcPipeline();
  const t = setTimeout(() => startKcPipeline({ manual: true }), 6_000);
  t.unref?.();
  return { ok: true, message: "Reiniciando el pipeline (~6 s)" };
}

export function stopKcPipeline(): { ok: boolean; message: string } {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    const pid = child.pid;
    killTree(pid, false);
    setTimeout(() => killTree(pid, true), 5_000).unref?.();
  }
  return { ok: true, message: "Pipeline detenido" };
}

export interface KcCheck {
  id: "python" | "requests" | "ffmpeg" | "gemini";
  ok: boolean;
  label: string;
  fix: string;
  /** Comando para pegar en una terminal, si el arreglo es uno solo. */
  cmd?: string;
}

function probe(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5_000, windowsHide: true }, (err) => resolve(!err));
  });
}

/** La clave puede estar en servidor/.env (hereda el hijo) o en kick-context/src/.env. */
export function geminiKeyPresent(): boolean {
  if ((process.env.KICK_GEMINI_API_KEY || "").trim()) return true;
  try {
    const txt = fs.readFileSync(path.join(kcDir(), "src", ".env"), "utf-8");
    return /^[ \t]*KICK_GEMINI_API_KEY[ \t]*=[ \t]*["']?[^\s"']/m.test(txt);
  } catch {
    return false;
  }
}

let checksCache: { at: number; checks: KcCheck[] } | null = null;

/**
 * Lo que el pipeline necesita para andar. Sin esto arranca, se cae en loop y
 * termina "BLOQUEADO" sin decir por qué; mejor avisar antes. Cacheado 15 s
 * porque el panel lo consulta cada pocos segundos.
 */
export async function getKcChecks(force = false): Promise<KcCheck[]> {
  if (!force && checksCache && Date.now() - checksCache.at < 15_000) return checksCache.checks;

  const py = findPython();
  const [requests, ffmpeg] = await Promise.all([
    py ? probe(py, ["-c", "import requests"]) : Promise.resolve(false),
    probe("ffmpeg", ["-version"]),
  ]);
  const checks: KcCheck[] = [
    { id: "python", ok: !!py, label: "Python",
      fix: "Instalá Python 3.11 o más nuevo desde python.org (marcá «Add to PATH») y reiniciá el servidor." },
    { id: "requests", ok: requests, label: "Librería de Python «requests»",
      fix: "Instalala con este comando en una terminal.", cmd: "python -m pip install requests" },
    { id: "ffmpeg", ok: ffmpeg, label: "ffmpeg (captura de pantalla y audio)",
      fix: "Instalalo con este comando; después cerrá y volvé a abrir el servidor para que lo encuentre.", cmd: "winget install Gyan.FFmpeg" },
    { id: "gemini", ok: geminiKeyPresent(), label: "Clave de Gemini",
      fix: "Sacá una clave gratis en aistudio.google.com/apikey, pegala en servidor/.env como KICK_GEMINI_API_KEY=… y reiniciá el servidor." },
  ];
  checksCache = { at: Date.now(), checks };
  return checks;
}

export interface KcPipelineStatus {
  enabled: boolean;
  simulation: boolean;
  running: boolean;
  blocked: boolean;
  pid: number | null;
  startedAt: number;
  restarts: number;
  lastExitCode: number | null;
  lastError: string;
  /** Apagado a propósito (no es una caída esperando reinicio). */
  stopping: boolean;
  kcDir: string;
  dataDir: string;
  captureMode: string;
  monitor: string;
  windowTitle: string;
}

export function getKcPipelineStatus(): KcPipelineStatus {
  return {
    enabled: pipelineEnabled(),
    simulation: simulation(),
    running: child != null,
    blocked,
    pid: child?.pid ?? null,
    startedAt: state.startedAt,
    restarts: state.restarts,
    lastExitCode: state.lastExitCode,
    lastError: state.lastError,
    stopping,
    kcDir: kcDir(),
    dataDir: kcDataDir(),
    captureMode: (env.KICK_CAPTURE_MODE || "local").trim(),
    monitor: getCaptureConfig().monitor,
    windowTitle: getCaptureConfig().windowTitle,
  };
}
