// Lee y valida las variables de entorno. Todo lo propio lleva prefijo PANTALLA_;
// solo se reutilizan los nombres estándar de cada proveedor (ANTHROPIC_API_KEY, GEMINI_API_KEY, OLLAMA_HOST).

export const BACKEND_NAMES = ["auto", "ollama", "gemini", "claude", "ocr"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

// OLLAMA_HOST admite "127.0.0.1:11434", "0.0.0.0" o una URL completa.
export function normalizeOllamaHost(raw) {
  const text = (raw ?? "").trim() || "127.0.0.1";
  const hasScheme = /^https?:\/\//i.test(text);
  const url = new URL(hasScheme ? text : `http://${text}`);
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  if (!hasScheme && !url.port) url.port = "11434";
  return url.origin;
}

function httpUrl(raw, name) {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) throw new Error("protocolo");
    return url;
  } catch {
    throw new Error(`${name} no es una URL http(s) válida: "${raw}".`);
  }
}

// «eng+spa», «eng,spa» o «eng spa» -> ["eng", "spa"]
function ocrLangs(raw) {
  const langs = [...new Set((raw || "eng").split(/[+,\s]+/).filter(Boolean))];
  if (langs.length === 0 || !langs.every((l) => /^[a-z_]{3,12}$/.test(l))) {
    throw new Error(`PANTALLA_OCR_LANGS inválido: "${raw}". Usa códigos como eng, spa o eng+spa.`);
  }
  return langs;
}

function num(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} debe ser un número entre ${min} y ${max} (valor actual: "${raw}").`);
  return n;
}

function int(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max} (valor actual: "${raw}").`);
  }
  return n;
}

export function loadConfig(env = process.env) {
  const backend = env.PANTALLA_BACKEND || "auto";
  if (!BACKEND_NAMES.includes(backend)) {
    throw new Error(`PANTALLA_BACKEND inválido: "${backend}". Usa uno de: ${BACKEND_NAMES.join(", ")}.`);
  }

  const effort = env.PANTALLA_CLAUDE_EFFORT || "low";
  if (!EFFORTS.includes(effort)) {
    throw new Error(`PANTALLA_CLAUDE_EFFORT inválido: "${effort}". Usa uno de: ${EFFORTS.join(", ")}.`);
  }

  const analyzerUrl = env.PANTALLA_ANALYZER_URL ? httpUrl(env.PANTALLA_ANALYZER_URL, "PANTALLA_ANALYZER_URL").origin : null;
  const webhookUrl = env.PANTALLA_WEBHOOK_URL ? httpUrl(env.PANTALLA_WEBHOOK_URL, "PANTALLA_WEBHOOK_URL").href : null;

  // «Otra IA»: hacen falta la URL y el modelo juntos; la clave es opcional (servidores locales no la piden).
  const llmUrl = env.PANTALLA_LLM_URL;
  const llmModel = env.PANTALLA_LLM_MODEL;
  if (Boolean(llmUrl) !== Boolean(llmModel)) {
    throw new Error(`Para usar una IA externa define PANTALLA_LLM_URL y PANTALLA_LLM_MODEL juntas (falta ${llmUrl ? "PANTALLA_LLM_MODEL" : "PANTALLA_LLM_URL"}).`);
  }

  const exportMode = env.PANTALLA_EXPORT || "verified";
  if (!["verified", "all"].includes(exportMode)) throw new Error(`PANTALLA_EXPORT inválido: "${exportMode}". Usa verified (solo lo verificado) o all.`);

  const host = env.HOST || "127.0.0.1";
  const analyzerHost = env.PANTALLA_ANALYZER_HOST || "127.0.0.1";
  const think = env.PANTALLA_OLLAMA_THINK;

  return {
    port: int(env, "PORT", 3000, { min: 1, max: 65535 }),
    host,
    loopbackOnly: LOOPBACK.has(host),
    backend,
    // Verificación: qué certeza mínima y cuántas lecturas seguidas hacen falta para exportar un contexto.
    tracking: {
      exportMode,
      minCertainty: num(env, "PANTALLA_MIN_CERTAINTY", 0.5, { min: 0, max: 1 }),
      stableFrames: int(env, "PANTALLA_STABLE_FRAMES", 2, { min: 1, max: 10 }),
      switchFrames: int(env, "PANTALLA_SWITCH_FRAMES", 2, { min: 1, max: 10 }),
      maxGapMs: int(env, "PANTALLA_ACTIVITY_GAP_S", 300, { min: 10, max: 86400 }) * 1000,
    },
    apiToken: env.PANTALLA_API_TOKEN || null,
    maxSide: int(env, "PANTALLA_MAX_SIDE", null, { min: 256, max: 4096 }),
    analyzerUrl,
    analyzer: {
      port: int(env, "PANTALLA_ANALYZER_PORT", 4000, { min: 1, max: 65535 }),
      host: analyzerHost,
      loopbackOnly: LOOPBACK.has(analyzerHost),
      token: env.PANTALLA_ANALYZER_TOKEN || null,
    },
    ollama: {
      host: normalizeOllamaHost(env.OLLAMA_HOST),
      model: env.PANTALLA_OLLAMA_MODEL || "qwen3-vl:2b",
      keepAlive: env.PANTALLA_OLLAMA_KEEP_ALIVE || "60s",
      threads: int(env, "PANTALLA_OLLAMA_THREADS", null, { min: 1, max: 256 }),
      think: think === "0" ? false : null, // solo se envía `think:false` si se pide explícitamente
      timeoutMs: int(env, "PANTALLA_OLLAMA_TIMEOUT_S", 180, { min: 10, max: 1800 }) * 1000,
    },
    ocr: {
      langs: ocrLangs(env.PANTALLA_OCR_LANGS),
      langPath: env.PANTALLA_OCR_LANG_PATH || null,
      keepAliveMs: int(env, "PANTALLA_OCR_KEEP_ALIVE_S", 60, { min: 1, max: 86400 }) * 1000,
    },
    knowledgeFile: env.PANTALLA_KNOWLEDGE_FILE || null,
    llm: llmUrl
      ? {
          baseUrl: httpUrl(llmUrl, "PANTALLA_LLM_URL").href.replace(/\/+$/, ""),
          model: llmModel,
          apiKey: env.PANTALLA_LLM_KEY || null,
          jsonMode: env.PANTALLA_LLM_JSON_MODE !== "0",
          timeoutMs: int(env, "PANTALLA_LLM_TIMEOUT_S", 60, { min: 5, max: 600 }) * 1000,
        }
      : null,
    webhook: webhookUrl ? { url: webhookUrl, secret: env.PANTALLA_WEBHOOK_SECRET || null } : null,
    gemini: {
      apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null,
      model: env.PANTALLA_GEMINI_MODEL || "gemini-flash-lite-latest",
      timeoutMs: 60_000,
    },
    claude: {
      configured: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE),
      model: env.PANTALLA_CLAUDE_MODEL || "claude-opus-5-5",
      effort,
      fallbacks: env.PANTALLA_CLAUDE_FALLBACKS !== "0",
    },
  };
}
