import Anthropic from "@anthropic-ai/sdk";
import { singleFlight } from "../limit.js";
import { createOcrEngine } from "../ocr/engine.js";
import { buildIndex, loadKnowledge } from "../ocr/knowledge.js";
import { createClaudeBackend } from "./claude.js";
import { createGeminiBackend } from "./gemini.js";
import { createLlmEnricher } from "./llm.js";
import { createOcrBackend } from "./ocr.js";
import { createOllamaBackend } from "./ollama.js";
import { createRemoteBackend } from "./remote.js";

// Tamaño máximo (lado largo) de la imagen que envía el visor. Menos píxeles = menos tokens = más rápido y barato.
const DEFAULT_MAX_SIDE = { ollama: 768, gemini: 1024, claude: 1568, ocr: 1600, remote: 1024 };

const NO_BACKEND_HINT =
  "No hay ningún analizador listo. El OCR integrado no se pudo cargar (ejecuta npm install). " +
  "Alternativas: instala Ollama (ollama.com) y ejecuta «ollama pull qwen3-vl:2b», o define GEMINI_API_KEY (gratis) o ANTHROPIC_API_KEY.";

function build(name, config) {
  const maxSide = config.maxSide ?? DEFAULT_MAX_SIDE[name];
  if (name === "ollama") return createOllamaBackend({ ...config.ollama, maxSide });
  if (name === "gemini") return createGeminiBackend({ ...config.gemini, maxSide });
  if (name === "ocr") {
    return createOcrBackend({
      engine: createOcrEngine(config.ocr),
      index: buildIndex(loadKnowledge(config.knowledgeFile)),
      enricher: config.llm ? createLlmEnricher(config.llm) : null,
      maxSide,
    });
  }
  return createClaudeBackend({
    client: new Anthropic({ timeout: 60_000 }),
    model: config.claude.model,
    effort: config.claude.effort,
    fallbacks: config.claude.fallbacks,
    configured: config.claude.configured,
    maxSide,
  });
}

// Con "auto" se usa el primero que esté listo, en este orden: Ollama, nube gratis, de pago y, al final, OCR
// (que no necesita nada instalado ni ninguna clave: así siempre hay algo que analiza la pantalla).
function createAutoBackend(candidates) {
  async function pick() {
    for (const candidate of candidates) {
      const info = await candidate.info();
      if (info.ready) return { candidate, info };
    }
    // Ninguno está listo: se explica primero lo gratuito y local.
    const [first] = candidates;
    return { candidate: null, info: { ...(await first.info()), ready: false, hint: NO_BACKEND_HINT } };
  }
  return {
    async info() {
      return (await pick()).info;
    },
    async analyze(req) {
      const { candidate } = await pick();
      return candidate.analyze(req);
    },
  };
}

// Analizador local (el que de verdad llama al modelo). Un solo análisis a la vez.
export function createLocalBackend(config) {
  const names = config.backend === "auto" ? ["ollama", "gemini", "claude", "ocr"] : [config.backend];
  const candidates = names.map((name) => {
    const backend = build(name, config);
    return { ...backend, analyze: singleFlight(backend.analyze) };
  });
  const close = () => Promise.all(candidates.map((c) => c.close?.())).then(() => {});
  return candidates.length === 1 ? { ...candidates[0], close } : { ...createAutoBackend(candidates), close };
}

// Lo que usa el visor: el analizador remoto si hay URL configurada; si no, el local.
export function createBackend(config) {
  if (config.analyzerUrl) {
    return createRemoteBackend({
      url: config.analyzerUrl,
      token: config.analyzer.token,
      maxSide: config.maxSide ?? DEFAULT_MAX_SIDE.remote,
    });
  }
  return createLocalBackend(config);
}
