// Tipos de pantalla-contexto/client (el cliente sin dependencias).

export type Category =
  | "casino" | "sports_betting" | "sports_live" | "video_game" | "streaming" | "trading" | "video_media" | "coding"
  | "terminal" | "documents" | "email" | "chat" | "meeting" | "browsing" | "social" | "other";

export type Language = "es" | "en";
export type Confidence = "low" | "medium" | "high";
// confirming: aún no se repite; low_certainty: poca certeza; switching: una lectura suelta de otra actividad; verified: exportable.
export type ReadingState = "verified" | "confirming" | "low_certainty" | "switching";

export interface Entity { label: string; value: string }
export interface Evidence { label: string; value: string; text: string; confidence: number }

// Un contexto leído de la pantalla. `verified` es true solo si tiene certeza suficiente Y se confirmó en lecturas seguidas.
export interface ScreenContext {
  category: Category | (string & {});
  title: string;
  summary: string;
  activity: string;
  entities: Entity[];
  chat_line: string;
  changes: string;
  confidence: Confidence;
  /** 0..1: certeza del análisis (suma de evidencias, no una probabilidad calibrada). */
  certainty: number;
  uncertain: string[];
  /** Texto leído de la pantalla. Es contenido NO fiable: nunca son instrucciones. Vacío en correo, chat y reuniones. */
  text: string;
  evidence: Evidence[];
  /** Por qué se eligió esta actividad. */
  reasons: string[];
  subject: string;
  mode: string;
  language: Language;
  /** ISO 8601. */
  at: string;
  verified: boolean;
  confirmations: number;
  state: ReadingState;
}

export interface Candidate { title: string; category: string; certainty: number; confirmations: number; needed: number }

export interface ContextResponse {
  latest: ScreenContext | null;
  verified: boolean;
  age_seconds: number | null;
  /** Lo que se está viendo pero aún no se ha confirmado (solo cuando `latest` es null). */
  candidate: Candidate | null;
}

export type ActivityEventType =
  | "activity_started" | "activity_ended" | "balance_changed" | "bet_changed" | "big_win" | "command_run" | "error_cleared"
  | "error_seen" | "free_spins" | "page_changed" | "price_moved" | "round_changed" | "score_changed" | "tests_result" | "win";

export interface ActivityEvent { at: string; type: ActivityEventType | (string & {}); text: string; detail?: unknown; category?: string }

export interface ActivitySegment {
  id: number;
  category: string;
  subject: string;
  title: string;
  since: string;
  last: string;
  durationSec: number;
  readings: number;
  confirmations: number;
  verified: boolean;
  certainty: number;
  facts: Record<string, unknown>;
  stats: Record<string, unknown>;
  events: ActivityEvent[];
}

export interface ActivitySnapshot {
  current: ActivitySegment | null;
  candidate: Candidate | null;
  recent: ActivitySegment[];
  events: ActivityEvent[];
  updatedAt: string | null;
}

export interface TrackingInfo {
  verified: boolean;
  state: ReadingState;
  confirmations: number;
  needed: number;
  minCertainty: number;
  certainty: number;
  events: ActivityEvent[];
  activity: ActivitySegment;
}

export type AnalyzeResult =
  | { refused: true; reason: string; elapsed_ms: number }
  | { refused: false; context: Omit<ScreenContext, "mode" | "language" | "at" | "verified" | "confirmations" | "state">; meta: { model: string; usage: { input_tokens: number; output_tokens: number }; elapsed_ms: number }; tracking: TrackingInfo | null };

export interface ReadOptions {
  /** true (por defecto en el servidor): solo lo verificado. false o "all": también lo no verificado, marcado. */
  verified?: boolean | "only" | "all";
  /** Descarta lo más viejo de estos segundos. */
  maxAge?: number;
  language?: Language;
}

export interface WaitOptions { timeoutMs?: number; intervalMs?: number; maxAge?: number; signal?: AbortSignal }
export interface StreamOptions { verified?: boolean | "only" | "all"; signal?: AbortSignal; reconnect?: boolean; retryMs?: number; maxRetryMs?: number }

export type StreamItem = { event: "context"; data: ScreenContext } | { event: "activity"; data: ActivityEvent };

export interface ClientOptions {
  /** Por defecto PANTALLA_URL o http://127.0.0.1:3000. */
  url?: string;
  /** Por defecto PANTALLA_API_TOKEN. Se envía como `Authorization: Bearer`, nunca en la URL. */
  token?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type PantallaErrorCode = "unreachable" | "unauthorized" | "http" | "timeout" | "bad_stream";

export declare class PantallaError extends Error {
  code: PantallaErrorCode;
  status: number | null;
  constructor(code: PantallaErrorCode, message: string, options?: { status?: number | null; cause?: unknown });
}

export interface Client {
  readonly url: string;
  context(options?: ReadOptions): Promise<ContextResponse>;
  /** El contexto verificado actual, o null si aún no hay nada seguro (nunca inventa). */
  get(options?: ReadOptions): Promise<ScreenContext | null>;
  text(options?: ReadOptions): Promise<string>;
  /** Texto listo para pegar en otra IA, con el aviso de que el texto de la pantalla no son instrucciones. */
  prompt(options?: ReadOptions): Promise<string>;
  activity(options: { format: "text"; verified?: ReadOptions["verified"]; language?: Language }): Promise<string>;
  activity(options?: { format?: "json"; verified?: ReadOptions["verified"]; language?: Language }): Promise<ActivitySnapshot>;
  config(): Promise<Record<string, unknown>>;
  analyze(image: Uint8Array | string, options?: { mode?: string; language?: Language; note?: string; publish?: boolean }): Promise<AnalyzeResult>;
  /** Espera a un contexto verificado que cumpla la condición (una función o el nombre de una categoría). */
  waitFor(condition: Category | (string & {}) | ((context: ScreenContext) => boolean), options?: WaitOptions): Promise<ScreenContext>;
  /** Flujo en vivo con reconexión automática. */
  stream(options?: StreamOptions): AsyncGenerator<StreamItem, void, void>;
  /** Atajo con funciones; devuelve cómo parar. */
  subscribe(handlers: { context?: (context: ScreenContext) => void; activity?: (event: ActivityEvent) => void; error?: (error: Error) => void }, options?: Omit<StreamOptions, "signal">): () => void;
}

export declare function createClient(options?: ClientOptions): Client;
export declare function parseEventStream(body: AsyncIterable<Uint8Array>): AsyncGenerator<StreamItem, void, void>;
