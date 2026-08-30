// Utilidades para parsear la salida (frecuentemente rota / truncada) del LLM
// del simulador de chat. Sin dependencias: testeable en aislamiento.

export interface SimMessage {
  id?: number;
  user: string;
  message: string;
  tipo?: string;
  [k: string]: unknown;
}

/**
 * Extrae los mensajes de la respuesta del modelo probando, en orden:
 *  1. objeto JSON completo con clave "mensajes"
 *  2. array JSON pelado
 *  3. objetos sueltos dentro de un array truncado
 *  4. una línea por objeto
 * Varias respuestas de agentes vienen unidas por "---SPLIT---".
 */
export function parseLlmMessages(rawText: string): SimMessage[] {
  const all: SimMessage[] = [];
  const parts = String(rawText ?? "").split("---SPLIT---");

  for (const part of parts) {
    const clean = part.replace(/```json|```/g, "").trim();

    // 1: objeto JSON con "mensajes": [...]
    const objMatch = clean.match(/\{(?:[^{}]|(?:\{[^{}]*\}))*"mensajes"\s*:\s*\[([\s\S]*?)\]\s*\}/);
    if (objMatch) {
      try {
        const arr = JSON.parse("[" + objMatch[1] + "]");
        if (Array.isArray(arr)) {
          all.push(...arr);
          continue;
        }
      } catch {
        /* sigue con la próxima estrategia */
      }
    }

    // 2: array JSON pelado
    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        all.push(...parsed);
        continue;
      }
    } catch {
      /* sigue */
    }

    // 3: objetos sueltos dentro de un array (posiblemente truncado)
    const arrMatch = clean.match(/\[([\s\S]*)$/);
    if (arrMatch) {
      const objPattern = /\{(?:[^{}]|(?:\{[^{}]*\}))*\}/g;
      let m: RegExpExecArray | null;
      while ((m = objPattern.exec(arrMatch[1])) !== null) {
        try {
          const obj = JSON.parse(m[0]);
          if (obj && obj.user && obj.message) all.push(obj);
        } catch {
          /* ignora el objeto roto */
        }
      }
    }

    // 4: una línea por objeto
    for (const line of part.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{"user"') || trimmed.startsWith('{"id"')) {
        try {
          const obj = JSON.parse(trimmed);
          if (obj.user && obj.message) all.push(obj);
        } catch {
          /* ignora */
        }
      }
    }
  }

  return all;
}

/** Limpia el contexto de stream que manda el cliente: sin control chars, sin comillas, máx 500. */
export function sanitizeStreamContext(input: unknown): string {
  if (!input || typeof input !== "string") return "";
  return input
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .replace(/["']/g, "")
    .slice(0, 500);
}
