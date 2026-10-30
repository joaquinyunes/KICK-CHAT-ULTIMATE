// Tipos de pantalla-contexto (arrancar el visor desde tu código).
import type { ActivityEvent, ActivitySnapshot, AnalyzeResult, ReadOptions, ScreenContext } from "./client.js";

export * from "./client.js";

export type BackendName = "auto" | "ocr" | "ollama" | "gemini" | "claude";

export interface StartOptions {
  /** Puerto del visor. 0 elige uno libre (mira `port` en el resultado). Por defecto 3000. */
  port?: number;
  /** Por defecto 127.0.0.1. Fuera de localhost, define apiToken. */
  host?: string;
  backend?: BackendName;
  /** "verified" (por defecto): solo sale lo seguro. "all": sale todo, con su marca `verified`. */
  exportMode?: "verified" | "all";
  /** Si se define, la API HTTP de exportación exige `Authorization: Bearer <token>`. */
  apiToken?: string;
  /** Certeza mínima para exportar (0..1, por defecto 0.5). */
  minCertainty?: number;
  /** Lecturas seguidas que deben coincidir antes de exportar (por defecto 2). */
  stableFrames?: number;
  /** Lecturas seguidas de otra actividad antes de dar por cambiada la actual (por defecto 2). */
  switchFrames?: number;
  /** Segundos sin lecturas tras los que el contexto caduca (por defecto 300). */
  activityGapSeconds?: number;
  /** Idiomas del OCR, p. ej. "eng+spa". */
  ocrLangs?: string;
  /** JSON con tus juegos, equipos o apps para ampliar el catálogo. */
  knowledgeFile?: string;
  /** Usa un analizador remoto (otro equipo) en vez de uno local. */
  analyzerUrl?: string;
  /** Envía cada contexto verificado a esta URL, firmado con HMAC-SHA256 si hay secret. */
  webhook?: { url: string; secret?: string };
  /** Se llama con cada contexto exportable. Sus errores no afectan al visor. */
  onContext?: (context: ScreenContext, extra: { events: ActivityEvent[]; session: ActivitySnapshot }) => void | Promise<void>;
  /** Variables de entorno de partida (por defecto process.env). Las opciones de arriba mandan sobre ellas. */
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
}

export interface BackendInfo { ready: boolean; name: string; model: string; cost: string; local: boolean; maxSide: number; hint: string | null }

export interface PantallaContexto {
  /** Dirección del visor, p. ej. http://127.0.0.1:3000 */
  readonly url: string;
  readonly port: number;
  readonly host: string;
  info(): Promise<BackendInfo>;
  /** Contexto verificado actual, o null. Sin pasar por HTTP ni por el token. */
  context(options?: Pick<ReadOptions, "verified" | "maxAge">): ScreenContext | null;
  activity(options?: { verified?: boolean }): ActivitySnapshot;
  /** Analiza una captura tuya (JPEG, PNG o WebP) con las mismas reglas que el visor. */
  analyzeImage(image: Uint8Array | string, options?: { mode?: string; language?: "es" | "en"; note?: string; publish?: boolean }): Promise<AnalyzeResult>;
  /** "context": contexto verificado nuevo. "activity": evento confirmado. "reading": cada lectura. Devuelve cómo darse de baja. */
  on(event: "context" | "reading", listener: (context: ScreenContext) => void): () => void;
  on(event: "activity", listener: (event: ActivityEvent) => void): () => void;
  /** Cierra el servidor y libera el OCR. Se puede llamar más de una vez. */
  close(): Promise<void>;
}

export declare function startPantallaContexto(options?: StartOptions): Promise<PantallaContexto>;
export declare function buildConfig(options?: StartOptions): Record<string, any>;
