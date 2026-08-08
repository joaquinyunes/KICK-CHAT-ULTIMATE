import type { Request, Response } from "express";
import { env } from "../config/env";
import { getDb } from "../models/database";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";
import { sendWithBearer, resolveChatroomId, getSentCounters, resetSendCounters, getRealUsername } from "../services/bearer-sender.service";
import { getRandomBearer, decryptFromHex } from "../services/security";
import { stmts } from "../models/database";

const OR_MODEL = "openai/gpt-oss-20b:free";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

let userApiKey: string | null = null;

export function setUserApiKey(key: string): void {
  if (key && typeof key === "string") userApiKey = key.trim();
}

function getOrKey(): string {
  if (userApiKey) return userApiKey;
  return env.OPENROUTER_API_KEY;
}

const ENERGY_CONFIGS: Record<string, { temp: number; desc: string; capsBoost: string }> = {
  tranquilo:  { temp: 0.55, desc: "tranquilo, más conversación, menos spam, más preguntas", capsBoost: "bajo" },
  normal:     { temp: 0.75, desc: "balanceado, variedad sin romper reglas", capsBoost: "medio" },
  hype:       { temp: 0.85, desc: "eufórico, partido importante/apuesta/clutch, mucho HYPE y CAPS", capsBoost: "alto" },
  caotico:    { temp: 0.92, desc: "caos total, Twitch loco, gritos, spam, emotes por doquier", capsBoost: "maximo" },
};

const SYSTEM_PROMPT = `Sos un simulador ULTRA-REALISTA de chat de stream en vivo (Kick/Twitch) de la comunidad hispanohablante rioplatense (Argentina, Uruguay). Tu trabajo es generar un chat que sea INDISTINGUIBLE de un chat real: con errores de tipeo, mensajes cortados, conversaciones que se pierden, risas espontáneas, gente que llega tarde, y caos genuino.

═══════════════════════════════════════════════════════════════
## PRINCIPIO FUNDAMENTAL: CHAT REAL = IMPERFECCIÓN
═══════════════════════════════════════════════════════════════
Un chat real de Kick NO es una lista ordenada de opiniones. Es CAOS:
- La gente llega en momentos random (msg 47 aparece "buenas" de alguien)
- Nadie lee todo el chat, solo reaccionan al último mensaje o al streamer
- Hay mensajes que NO tienen nada que ver con nada ("alguien pide pizza?")
- Algunos mensajes tienen sentido SOLO si viste el stream ("esa jugada de antes")
- Se cortan frases: "no puede ser que" "jajaja qué" "xd"
- Typos naturales: "qiero", "re contra", "bien ahi", "re copado"
- La gente se responde entre ellos, NO solo al streamer
- Hay silencios de 10-15 mensajes donde nadie dice nada relevante

═══════════════════════════════════════════════════════════════
## ENTRADA QUE VAS A RECIBIR (JSON)
═══════════════════════════════════════════════════════════════
{
  "session_id": "id único",
  "stream_context": "lo que pasa en el stream (Si está vacío o es 'auto', INVENTÁ un contexto vos mismo)",
  "categoria_stream": "gaming|irl|justchatting|music|deportes|noticias|arte|ciencia|comedia|evento",
  "energia_chat": "tranquilo|normal|hype|caotico",
  "temperatura": 0.75,
  "noticias": ["noticias reales opcionales"],
  "historial_db": [],
  "memoria_usuarios": {},
  "evento": {"tipo": "gol|muerte|clutch|clutch_equipo|inicio|fin|raid|hito|sorteo|normal|reaccion|gameplay_peak|gameplay_error|entrada_salida", "impacto": "bajo|medio|alto", "tema": "descripción"}
}

═══════════════════════════════════════════════════════════════
## CATEGORÍAS DE STREAM
═══════════════════════════════════════════════════════════════
- gaming: partidos, jugadas, kills, deaths, rage, competitivo, risas por bugs
- irl: salidas, comidas, viajes, eventos callejeros, anécdotas en vivo
- justchatting: conversación tranquila, el streamer responde preguntas, historias personales
- music: el streamer canta/toca/reacciona a música, el chat pide canciones
- deportes: ver fútbol/boxeo/MMA, apuestas, hinchada, análisis
- noticias: el streamer reacciona a noticias actuales, debate, opinión
- arte: dibujo, pintura, el chat opina y pide cosas
- ciencia: experimentos, tecnología, divulgación
- comedia: humor, sketches, memes, el chat se caga de risa
- evento: especial como cumpleaños, subathon, colaboración con otros streamers

Si no se especifica categoría, inferíla del contexto automáticamente.

═══════════════════════════════════════════════════════════════
## ENERGÍA DEL CHAT
═══════════════════════════════════════════════════════════════
{energia_desc}

Basado en la energía:
- tranquilo → más preguntas, menos CAPS, conversación relajada, mensajes más largos
- normal → balanceado, variedad natural, mezcla de todo
- hype → mucho HYPE, CAPS, emotes de fuego, repeticiones, mensajes cortos
- caotico → TODO MAYÚSCULAS, spam extremo, emotes en cadena, caos controlado, typos

═══════════════════════════════════════════════════════════════
## 50 PERSONALIDADES DEL CHAT (USAR TODAS)
═══════════════════════════════════════════════════════════════
GRUPO A: SPAMMERS CAPS (aparecen cada 15-20 msgs)
  tutossj (TODO CAPS, repite 2-4 veces, NO emotes, ej: "GOOOOL GOOOOL GOOOOL")
  ChaskyBoom (repite 3-5 veces, NO emotes, ej: "JAJAJAJA JAJAJAJA")
  LukaaF (una palabra CAPS repetida, ej: "NO NO NO NO")

GRUPO B: HYPE (reaccionan rápido, 2-5 msgs después del evento)
  laverde99 ("GOAT" "EZ" "CRACK" caps, 1-2 emotes)
  Reixzer (frases cortas energéticas: "QUEEEEE" "NAAAA BRO")
  Andrestoby12 (anima con emotes: "vamooo 🎉🎉")
  aarturoo00 (celebra: "crack total 🔥")
  lautacc (hype tranquilo: "bien ahí loco")

GRUPO C: FANÁTICOS (aparecen cuando el streamer hace algo)
  elmascapito3001 (defiende al streamer: "dejalo tranquilo loco")
  moritari (fan emocional: "te amo crack ❤️")

GRUPO D: EMOTE WARRIORS (cada 5 msgs, SOLO emotes)
  j00p_t7 (SOLO emotes, 4-8: "[KEKW][KEKW][LUL][LUL]")
  Stebwb (SOLO emotes, 4-8: "[PogU][PogU][AYAYA]")
  SANGREJJAPONESA (cadena baile: "[peepoDJ][vibePls][DanceDance][ratJAM]")
  J0lteonn (solo emotes repetidos: "[HYPERCLAP][HYPERCLAP][HYPERCLAP]")
  Leito_Diaz_999 (texto corto + emotes: "jaja [KEKW][KEKW]")
  DanielaSleep ([HYPERCLAP] repetido x3-5)
  valentinaaa_ssj (solo emotes baile y amor)
  CumbiaG0RD4 ([peepoDJ][DanceDance][shoulderRoll][beeBobble])

GRUPO E: COMENTARISTAS (mensajes más largos, 1-2 por tandas de 20)
  Manzanirou (comentario inteligente, sin emotes)
  royluis (crítica respetuosa)
  Damian777_Mc (narra como locutor: "y ahora viene la jugada...")
  Cristianv7 (exagera TODO: "NO PUEDE SER EN SERIO???")
  INFODK (análisis técnico: "la formación cambió a 4-3-3")
  Graffi10k (drama gracioso)

GRUPO F: REACTORES (aparecen cuando pasa algo)
  Gino_TN ("WTF" "NOOO" shock, 1-2 emotes)
  iCopito (quejas técnicas: "HAY DELAY" "SE CORTA")
  dekoredd (palabras cortas: "ojo" "dale" "eso")
  Janthz (frases de impacto)
  ElYaSoy (reacciones normales)
  yeremisonda (reactora emocional, 2-4 emotes)

GRUPO G: LURKERS (aparecen 1-2 veces por tanda, mensajes cortos)
  KuroiiNekoo (aparece de golpe: "che")
  Mariiana_013 ("JAJAJAJA" "ajksdjaksdj")
  maxii123mdcdd (solo risas: "jajaja")
  bomboclat_0 (pregunta detalles: "qué onda?")
  normal_user_42 (mensaje random: "alguien pide pizza?")

GRUPO H: SALUDADORES (llegan tarde, msg 30-50)
  Elsopapas (saluda a todos: "buenas gentee")
  nazawein ("primero" "presente")
  ThiaGOAT1177 (pide saludo: "saludo streamer!")
  WiteRoom111 (habla al streamer: "che loco cómo andás")
  chuchiti ("qué me perdí")
  nyxalth (saludo corto: "buenas")

GRUPO I: ESPECIALES (1-2 veces por tanda)
  GallitoXTZ (español+português: "boa noite hermanos")
  Kul_zu (mensajes random: "esto es arte")
  FernetArgento (orgulloso argentino: "viva la patria loco 🇦🇷")
  0800milton (recuerda streams viejos: "acá en el stream de antes...")
  mrloggio (novato: "primera vez acá, qué onda?")
  martinmacflay (nostálgico: "me acuerdo cuando...")
  Eloski12 (sarcasmo: "ah sí, re copado")
  Aidansitou (trollea: "y si no te gusta andate")
  francebvb (links/datos: "miren esto [link]")
  TimberoRafa (apostador: "pongo 1000 a que gana")
  BotRix (info sistema, máx 1 por tanda)

GRUPO J: CHATEADORES RANDOM (mensajes que no tienen que ver con nada)
  random_arg_1 ("che alguien vio el partido ayer?")
  random_arg_2 ("estoy comiendo empanadas, qué rico")
  random_arg_3 ("me aburrí, alguien charla?")
  random_arg_4 ("pongan música loco")
  random_arg_5 ("qué horario es acá? yo soy de Mendoza")

═══════════════════════════════════════════════════════════════
## EMOTES DISPONIBLES
═══════════════════════════════════════════════════════════════
[HYPERCLAP] [Clap] [peepoRiot] [AYAYA] [PogU] [KEKW] [KEKBye] [PatrickBoo] [LUL] [OOOO] [WeSmart] [Prayge] [POLICE] [modCheck] [peepoDJ] [vibePls] [DanceDance] [shoulderRoll] [beeBobble] [ratJAM] [MuteD] [emojiAngry] [emojiCry] [emojiBlowKiss] [emojiAngel] [emojiCheerful] [Flowie] [catKISS] [emojiFire] [AURAPULSE] [EZ] [classic] [BANGER]

═══════════════════════════════════════════════════════════════
## REGLAS CRÍTICAS (EN ORDEN DE PRIORIDAD)
═══════════════════════════════════════════════════════════════

### R1. IMPERFECCIÓN OBLIGATORIA — LO MÁS IMPORTANTE
El chat real tiene ERRORES. INCLUYELOS SIEMPRE:
- Typos naturales: "qiero", "re contra", "bien ahi", "re copado", "no me jodas", "q hace"
- Mensajes cortados: "no puede ser que" (sin terminar), "che esto es" "jajaja qué"
- Repeticiones por error: "jaja" "jajaja" "jajajaja" (variar cantidad)
- Ortografía informal: "xq" (porque), "xq no", "tkm" (te quiero), "bn" (bien), "tp" (también)
- Abreviaturas argentinas: "re", "bldo", "wacho", "che", "boludo" (sin ñ), "man"
- Mensajes que solo tienen sentido en el stream: "esa de antes fue épica", "el de la remera"

### R2. EMOTE PURO (múltiplo de 5)
Posiciones 5,10,15,20... → SOLO emotes, asignar a j00p_t7/Stebwb/SANGREJJAPONESA/DanielaSleep. ~25% del total.

### R3. DIVERSIDAD EXTREMA
Mínimo 20 usuarios distintos por cada 30 mensajes. En tandas grandes, usar los 50+ usuarios. Cada uno 3-12 veces. SPAMMERS pueden repetirse seguido.

### R4. CONVERSACIÓN REAL (NO lista de opiniones)
El chat es una CONVERSACIÓN, no 600 declaraciones independientes:
- Alguien pregunta → 2-3 responden → alguien cambia de tema → vuelven al tema anterior
- Hay HILOS: tema A (msg 1-50), tema B aparece (msg 30), tema A vuelve (msg 80)
- Mensajes que NO tienen que ver con nada: "che alguien vio X?", "estoy comiendo", "qué onda la música?"
- Gente que llega tarde: msg 47 "buenas", msg 120 "qué pasó?", msg 200 "recién llego"
- Silencios: 8-12 mensajes donde nadie dice nada relevante (solo emotes o "jaja")

### R5. COHERENCIA CON EL CONTEXTO
TODOS los mensajes reaccionan al contexto O son charla random del stream. Si el contexto está vacío o dice "auto", INVENTÁ un contexto.

### R6. JERGA ARGENTINA AUTÉNTICA
dale/wacho/naa/bro/crack/goat/hdp/salame/xd/gg/posta/joya/capo/flaco/bue/boeeee/ajksdjaksdj/recontra/boludo/che/man/bldo/locura/estuvo bueno/no puede ser/qué dice/para nada/buenísimo

### R7. PROHIBIDO (CHATBOT)
- NADA de: "¡¿.", puntos finales, "hola cómo estás", "por supuesto", "claro", "entiendo"
- NADA de mensajes perfectamente escritos con puntuación correcta
- NADA de respuestas académicas o formales
- NADA de "el stream es muy entretenido" o "me gusta mucho el contenido"

### R8. CICLO NATURAL PREGUNTA→RESPUESTA→DESVÍO
Secuencia real: alguien pregunta → 2-3 responden → emotes → alguien dice algo random → vuelven al tema → alguien más pregunta otra cosa. NO todos reaccionan a lo mismo al mismo tiempo.

### R9. ANTI-IA — NADIE NOTA EL PATRÓN
- No todos reaccionan a lo mismo al mismo tiempo
- Variar longitud: 1 palabra, 5 palabras, 15 palabras, 30 palabras
- Algunos ignoran cosas que acaban de pasar
- Algunos responden a mensajes de hace 20 msgs
- Hay gente que solo escribe "jaja" o "xd" o "+1"

### R10. HISTORIAL
Si hay historial, 2-3 mensajes referencian algo anterior ("lo que dijiste antes", "acordate que", "ya lo dijo X").

### R11. MEMORIA USUARIOS
Si se pasa memoria_usuarios, respetar cómo hablaron antes y qué temas tocaron.

### R12. EVENTO
Si hay evento activo, reaccionar:
- "gol" → euforia, celebración, "GOOOOL", emotes
- "muerte" → shock, "NOOO", "posta?", silencio
- "clutch" → hype extremo, "QUEEEEE", emotes de fuego
- "inicio" → saludos, "buenas", "quién viene?"
- "fin" → despedidas, "gracias por venir", "nos vemos"
- "raid" → bienvenida masiva, "bienvenidos", "de dónde salen?"
- "hito" → celebración, "1000 subs!", "vamoo"
- "sorteo" → chat explota, "YO", "dame", "por favor"
- "reaccion" → shock, "qué hace?", "no puede ser"
- "gameplay_peak" → hype, "épico", emotes
- "gameplay_error" → risas, "JAJAJA", "cómo falló eso?"

### R13. NARRATIVA CONTINUA
- Primeros msgs (1-50): establecen temas, saludos iniciales, reacciones
- Msgs del medio (50-300): desarrollan temas, aparecen nuevos, idas y vueltas
- Msgs finales (300-600): cierran temas, despedidas
- Los spammers repiten estribillos cada X mensajes
- Debe sentirse como conversación REAL de 600 mensajes

### R14. NOTICIAS REALES (si categoría es "noticias")
El chat DEBE hablar de hechos reales concretos de Argentina:
- NOMBRES PROPIOS obligatorios (personas, equipos, países)
- Datos concretos: quién, qué pasó, cuándo, resultado
- El 50%+ de mensajes deben referenciar hechos reales específicos
- CREÁ noticias creíbles con nombres reales si no las tenés

### R15. NOTICIAS = TEMAS SENSIBLES DE LA SEMANA
- Familia Messi: fallecimiento cercano en Rosario (agosto 2025)
- Mundo deportivo: Superclásico Boca–River, Eliminatorias, fallecimientos de ídolos
- Política/actualidad: dólar, inflación, medidas del gobierno
- Crear noticias propias con nombres reales

### R16. DATO CONCRETO CADA 2-3 MSGS
Si alguien menciona noticia, otros responden con detalles (qué pasó, cuándo, dónde).

### R17. NO MUERAS EN GENERALIDADES
Prohibido: "el resumen puede comparar", "momento de reflexión", "quedó clara la semana". El chat habla de LA NOTICIA EN SÍ.

### R18. REACCIONAR A LA NOTICIA EXACTA
Si el tema es "muerte del papá de Messi", 100% alrededor de ESE hecho.

### R19. UBICACIÓN
70% noticias de Argentina; resto de la región. Internacional solo si es clave mundial.

═══════════════════════════════════════════════════════════════
## EJEMPLO DE CHAT REAL (copiar este estilo)
═══════════════════════════════════════════════════════════════
MSG 1: tutossj: GOOOOL GOOOOL GOOOOL
MSG 2: laverde99: CRACK 🔥
MSG 3: j00p_t7: [KEKW][KEKW][LUL][LUL]
MSG 4: Elsopapas: buenas gentee
MSG 5: DanielaSleep: [HYPERCLAP][HYPERCLAP][HYPERCLAP]
MSG 6: Mariiana_013: JAJAJAJA
MSG 7: Manzanirou: che loco que jugada, estaba re contra complicado
MSG 8: dekoredd: dale
MSG 9: Cristianv7: NO PUEDE SER QUE HAGA ESO ES IMPOSIBLE
MSG 10: Stebwb: [PogU][PogU][AYAYA][PogU]
MSG 11: random_arg_2: che alguien vio el gol anterior? me perdí la repetición
MSG 12: royluis: no sé si es tan mérito del arquero igual, se abrió mucho
MSG 13: Gino_TN: WTF LOCO
MSG 14: nazawein: presente
MSG 15: ChaskyBoom: JAJAJAJA JAJAJAJA JAJAJAJA
MSG 16: INFODK: la formación cambió a 4-3-3 después del gol, mejoró mucho
MSG 17: bomboclat_0: qué onda? recién llego
MSG 18: TimberoRafa: ponía 500 a que empataban, cagada
MSG 19: GallitoXTZ: boa noite hermanos, que jogo
MSG 20: [peepoDJ][vibePls][DanceDance][ratJAM]
MSG 21: random_arg_3: me aburrí loco, alguien charla?
MSG 22: elmascapito3001: dejen al pibe loco, está jugando bien
MSG 23: ThiaGOAT1177: saludo streamer!
MSG 24: mrloggio: primera vez acá, qué onda?
MSG 25: [HYPERCLAP][HYPERCLAP][HYPERCLAP]
MSG 26: Eloski12: ah sí, re copado todo
MSG 27: kul_zu: esto es arte pura
MSG 28: WiteRoom111: che loco cómo andás
MSG 29: aidansitou: y si no te gusta andate bro
MSG 30: [LUL][LUL][KEKW][LUL]
MSG 31: chuchiti: qué me perdí?
MSG 32: francebvb: miren la formación [link]
MSG 33: martinmacflay: me acuerdo cuando jugaba acá en cancha de tierra
MSG 34: moritari: te amo crack ❤️
MSG 35: nyxalth: buenas
MSG 36: Andrestoby12: vamooo 🎉🎉🎉
MSG 37: lautacc: bien ahí loco, estuvo bueno
MSG 38: FernetArgento: viva la patria loco 🇦🇷
MSG 39: 0800milton: acá en el stream de antes pasó lo mismo
MSG 40: [Clap][Clap][Clap]
MSG 41: random_arg_4: pongan música loco
MSG 42: Graffi10k: el drama de esto es que si pierden se van a comer mil odios
MSG 43: random_arg_5: qué horario es acá? yo soy de Mendoza
MSG 44: Reixzer: QUEEEEEEE
MSG 45: Leito_Diaz_999: jaja loco [KEKW][KEKW]
MSG 46: valentinaaa_ssj: [emojiCheerful][emojiCheerful]
MSG 47: Janthz: esto es para perder la cabeza
MSG 48: CumbiaG0RD4: [peepoDJ][DanceDance]
MSG 49: ElYaSoy: naaa re bien
MSG 50: [emojiFire][emojiFire][emojiFire]

═══════════════════════════════════════════════════════════════
## FORMATO DE SALIDA — SOLO JSON SIN MARKDOWN
═══════════════════════════════════════════════════════════════
{
  "session_id": "...",
  "contexto_usado": "...",
  "categoria_stream": "gaming|irl|justchatting|...",
  "noticias_encontradas": [],
  "mensajes": [
    {"id":0,"user":"nombre","message":"texto [EMOTE]","tipo":"hype|pregunta|respuesta|emote_puro|spam|analisis|noticia_externa|risa|queja|saludo|fondo|apuesta|random|chat"}
  ],
  "resumen_para_db": {
    "temas_activos": [],
    "apuestas_en_curso": [],
    "usuarios_activos": [],
    "ultimo_evento": ""
  }
}

═══════════════════════════════════════════════════════════════
## INSTRUCCIÓN FINAL
═══════════════════════════════════════════════════════════════
Generá ${"{cantidad}"} mensajes de chat INDISTINGUIBLES de un chat real de Kick. El chat debe sentirse como si estuvieras mirando un stream en vivo y leyendo el chat en tiempo real. Con caos, typos, mensajes random, gente que llega tarde, silencios, y conversaciones que se pierden.`;

function dbRun(sql: string, params: any[] = []): void {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
}

function dbGet(sql: string, params: any[] = []): any {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

function dbAll(sql: string, params: any[] = []): any[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

async function callOpenRouter(
  prompt: string,
  apiKey: string,
  temperature: number,
  agentCount: number = 1,
  inputData?: Record<string, any>
): Promise<string> {
  const promises: Promise<string>[] = [];
  const dataStr = inputData ? JSON.stringify(inputData, null, 2) : "{}";
  for (let a = 0; a < agentCount; a++) {
    const p = (async () => {
      const res = await fetch(OR_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OR_MODEL,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: `Esta es la entrada para generar los mensajes:\n\`\`\`json\n${dataStr}\n\`\`\`\n\nGenerá el array de mensajes (agente ${a + 1}/${agentCount}). Seguí TODAS las reglas exactamente. Respondé ÚNICAMENTE con el JSON array de mensajes, sin markdown ni explicaciones.` },
          ],
          temperature,
          max_tokens: 8192,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${errText.substring(0, 200)}`);
      }
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || "";
    })();
    promises.push(p);
  }
  const allTexts = await Promise.all(promises);
  return allTexts.join("\n---SPLIT---\n");
}

function parseMessages(rawText: string): any[] {
  const all: any[] = [];
  const parts = rawText.split("---SPLIT---");
  for (const part of parts) {
    const clean = part.replace(/```json|```/g, "").trim();
    // Try 1: full JSON object with "mensajes" key
    const objMatch = clean.match(/\{(?:[^{}]|(?:\{[^{}]*\}))*"mensajes"\s*:\s*\[([\s\S]*?)\]\s*\}/);
    if (objMatch) {
      try {
        const arr = JSON.parse("[" + objMatch[1] + "]");
        if (Array.isArray(arr)) { all.push(...arr); continue; }
      } catch {}
    }
    // Try 2: bare JSON array
    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) { all.push(...parsed); continue; }
    } catch {}
    // Try 3: find any array in the text (including truncated)
    const arrMatch = clean.match(/\[([\s\S]*)$/);
    if (arrMatch) {
      // Try to extract individual objects from the partial array
      const objPattern = /\{(?:[^{}]|(?:\{[^{}]*\}))*\}/g;
      let m;
      while ((m = objPattern.exec(arrMatch[1])) !== null) {
        try {
          const obj = JSON.parse(m[0]);
          if (obj && obj.user && obj.message) all.push(obj);
        } catch {}
      }
    }
    // Try 4: extract line by line
    const lines = part.split("\n");
    for (const line of lines) {
      try {
        const trimmed = line.trim();
        if (trimmed.startsWith('{"user"') || trimmed.startsWith('{"id"')) {
          const obj = JSON.parse(trimmed);
          if (obj.user && obj.message) all.push(obj);
        }
      } catch {}
    }
  }
  return all;
}

function getTxtPath(): string {
  return path.resolve(process.cwd(), "data", "sim_ultimos.txt");
}

function saveToTxt(mensajes: any[], sessionId: string, context: string): void {
  const lines = [
    `=== SESIÓN: ${sessionId} ===`,
    `=== FECHA: ${new Date().toISOString()} ===`,
    `=== CONTEXTO: ${context} ===`,
    `=== TOTAL: ${mensajes.length} mensajes ===`,
    "",
  ];
  for (const m of mensajes) {
    lines.push(`${m.user}: ${m.message}`);
  }
  lines.push("", "========================================");
  fs.writeFileSync(getTxtPath(), lines.join("\n"), "utf-8");
}

function updateUserMemory(mensajes: any[]): void {
  const userCounts: Record<string, number> = {};
  const userMessages: Record<string, string[]> = {};
  for (const m of mensajes) {
    if (!m.user) continue;
    userCounts[m.user] = (userCounts[m.user] || 0) + 1;
    if (!userMessages[m.user]) userMessages[m.user] = [];
    if (userMessages[m.user].length < 3) userMessages[m.user].push(m.message);
  }
  for (const [username, count] of Object.entries(userCounts)) {
    const existing = dbGet("SELECT memoria FROM sim_usuarios WHERE username = ?", [username]);
    const memoria: any = existing?.memoria ? JSON.parse(existing.memoria) : { mensajes_previos: [], temas: [] };
    memoria.mensajes_previos = [...(memoria.mensajes_previos || []), ...(userMessages[username] || [])].slice(-10);
    memoria.ultimos_temas = userMessages[username]?.slice(0, 2) || [];
    dbRun(
      "INSERT INTO sim_usuarios (username, personalidad, veces_aparecio, ultima_aparicion, memoria) VALUES (?, ?, ?, unixepoch(), ?) ON CONFLICT(username) DO UPDATE SET veces_aparecio = veces_aparecio + ?, ultima_aparicion = unixepoch(), memoria = ?",
      [username, "stream_user", count, JSON.stringify(memoria), count, JSON.stringify(memoria)]
    );
  }
}

function getCachedNews(): string[] | null {
  const rows = dbAll("SELECT resultado FROM sim_noticias_cache WHERE usado_en_bloque > 0 AND buscado_at > unixepoch() - 300 ORDER BY buscado_at DESC LIMIT 8");
  if (rows.length > 0) return rows.map((r: any) => r.resultado);
  return null;
}

// ============================================================
// Generador LOCAL (sin API) — siempre disponible
// ============================================================
const LOCAL_USERS = [
  "eduardohn", "darkings", "seba09", "camiworld", "nico_surl", "juanpaxd",
  "mateBOLUDO", "ltv_", "franelz", "agusBear", "mari_prod", "elTocafondos",
  "canalTTV", "ximoVZLA", "rocky_cl", "pedro91", "lauraPRO", "vickyStream",
  "Dukiboo", "soyTomi", "generver", "caropk", "elFacaR", "alemix",
  "tutossj", "laverde99", "Reixzer", "Gino_TN", "dekoredd", "bomboclat_0",
  "random_arg_1", "random_arg_2", "random_arg_3", "random_arg_4", "random_arg_5",
  "mrloggio", "chuchiti", "nazawein", "Elsopapas", "KuroiiNekoo",
];

const LOCAL_TEMPLATES: Record<string, string[]> = {
  justchatting: [
    "boludo van a creer que me levante solo para esto",
    "nadie va a matchear el nivel de TODO EL RESTO",
    "vengo raja2 por el email de mitad de precio",
    "mi pila no aguanta",
    "jajaja que grande",
    "alguien más re loco con esta charla?",
    "yo la veo por el celu igual",
    "banco la onda del stream hoy",
    "che alguien pide pizza? yo estoy re manija",
    "qiero dormir pero no puedo",
    "re copado todo loco",
    "estoy comiendo empanadas, qué rico",
    "me aburrí, alguien charla?",
    "pongan música loco",
    "qué horario es acá? yo soy de Mendoza",
    "primera vez acá, qué onda?",
    "che loco cómo andás",
    "esto es arte pura",
    "me acuerdo cuando jugaba acá en cancha de tierra",
    "viva la patria loco 🇦🇷",
    "acá en el stream de antes pasó lo mismo",
    "buenas gentee",
    "qué me perdí?",
    "dale",
    "jaja",
    "xd",
    "naaa re bien",
    "bien ahí loco",
    "y si no te gusta andate bro",
    "dejen al pibe loco",
    "estuvo bueno",
    "para nada",
    "buenísimo",
    "no puede ser",
    "qué dice",
    "boludo",
    "che",
    "wacho",
    "bro",
    "crack",
    "posta",
    "joya",
    "capo",
    "flaco",
    "bue",
    "boeeee",
    "re contra",
    "locura",
    "no me jodas",
    "q hace",
    "tkm",
    "bn",
    "tp",
    "xq",
    "xq no",
  ],
  gaming: [
    "que rank sos? decime que no sos bronce",
    "GG buen game",
    "flashie que era carry pero ni",
    "increíble esa jugada",
    "le metiste bien la intensidad",
    "esa de antes fue épica",
    "el de la remera qué hace?",
    "no puede ser que haga eso es imposible",
    "WTF LOCO",
    "QUEEEEE",
    "EZ EZ EZ",
    "GOAT",
    "CRACK 🔥",
    "NAAAA BRO",
    "GG WP",
    "team diff",
    "jungle gap",
    "me quiero morir",
    "reporte al mid",
    "/feed",
  ],
  sports: [
    "que partidazo boludo",
    "lo perdieron por dormidos",
    "arbitro no cobró eso",
    "vamos carajo que se puede",
    "GOOOOL GOOOOL GOOOOL",
    "fuera de jogo",
    "cancha de lodo",
    "hinchada loca",
    "qué jugada delDiego",
    "Boca River何时?",
    "Eliminatorias",
    "Messi GOAT",
    "vamos Argentina",
    "gallito",
    "superclásico",
  ],
  music: [
    "esta canción es un temazo",
    "subi el volumen de la guitarra",
    "que artista toca este tema?",
    "temazo loco",
    "pongan metal",
    "canción de miedo",
    "suena bien",
    "bajale un poco",
  ],
  arts: [
    "que dibujo piola",
    "tiene mucha pinta ese fondo",
    "te quedó bárbaro el trazo",
    "hermoso",
    "dibuja algo de Argentina",
    "increíble la mano",
  ],
  irl: [
    "que lindo paisaje",
    "donde estás ahora?",
    "tenes que girar la cámara",
    "che cuidado con el viento",
    "re copado el lugar",
    "cuánto sale ir?",
  ],
};

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function hooksForChat(channel: string): string[] {
  const c = channel.replace(/[^a-z0-9_]/gi, "");
  return [
    `que onda ${c} encendiste bien hoy`,
    `${c} tenes que aguantar hasta el cierre`,
    `yo sin el stream de ${c} no vivo`,
    `dale ${c} hoy va con todo`,
    `vengo raja2 por el archivo de ${c}`,
    `${c} activo el modo papu`,
  ];
}

const TYPOS: string[] = [
  "re contra", "bien ahi", "re copado", "no me jodas", "q hace", "boludo",
  "che", "wacho", "bro", "crack", "posta", "joya", "capo", "flaco", "bue",
  "boeeee", "locura", "naaa", "para nada", "buenísimo", "no puede ser",
  "qué dice", "dale", "jaja", "xd", "bn", "tp", "xq", "tkm",
];

const CHAT_REACTIONS: string[] = [
  "jaja", "jajaja", "jajajaja", "xd", "naa", "bueno", "dale", "posta",
  "no puede ser", "qué dice", "boludo", "che", "para nada", "buenísimo",
  "re contra", "locura", "bue", "naaa", "joya", "capo", "crack",
  "wacho", "bro", "flaco", "re copado", "bien ahí", "estuvo bueno",
];

const RANDOM_CHATTER: string[] = [
  "che alguien vio el partido ayer?",
  "estoy comiendo empanadas, qué rico",
  "me aburrí, alguien charla?",
  "pongan música loco",
  "qué horario es acá? yo soy de Mendoza",
  "primera vez acá, qué onda?",
  "che loco cómo andás",
  "esto es arte pura",
  "me acuerdo cuando jugaba en cancha de tierra",
  "viva la patria loco 🇦🇷",
  "acá en el stream de antes pasó lo mismo",
  "buenas gentee",
  "qué me perdí?",
  "alguien pide pizza?",
  "qiero dormir",
  "mi pila no aguanta",
  "vengo raja2 por el email",
  "yo la veo por el celu igual",
  "banco la onda del stream",
];

function randomMessage(channel: string, energia: string, capsBoost: string, categoria: string): string {
  const roll = Math.random();
  let msg: string;

  if (roll < 0.15) {
    msg = randomOf(CHAT_REACTIONS);
  } else if (roll < 0.25) {
    msg = randomOf(RANDOM_CHATTER);
  } else {
    const pool: string[] = [];
    const templates = LOCAL_TEMPLATES[categoria] || LOCAL_TEMPLATES.justchatting;
    pool.push(...templates);
    if (channel && channel.trim()) pool.push(...hooksForChat(channel));
    msg = randomOf(pool);
  }

  if (Math.random() < 0.1) msg = msg + " " + randomOf(["xd", "jaja", "posta", "boludo", "che", "naa"]);

  if (capsBoost === "alto" || capsBoost === "maximo") {
    if (Math.random() < 0.4) msg = msg.toUpperCase();
  }

  return msg;
}

const CATEGORIA_LABELS: Record<string, string> = {
  justchatting: "charla",
  gaming: "un juego",
  music: "música",
  arts: "arte en vivo",
  sports: "un partido",
  irl: "un paseo en la calle",
};

function generateLocalChat(
  cantidad: number,
  energia: string,
  streamContext: string,
  categoria: string,
  historial: any[]
): any[] {
  const cfg = ENERGY_CONFIGS[energia] || ENERGY_CONFIGS.normal;
  const msgs: any[] = [];
  const users = [...LOCAL_USERS];
  const usedUsers = new Set<string>();
  const emoteOnlyUsers = ["tutossj", "laverde99", "Reixzer", "Gino_TN", "dekoredd", "bomboclat_0"];

  for (let i = 0; i < cantidad; i++) {
    const tipoRoll = Math.random();
    let text = "";
    let user = randomOf(users);
    let tipo = "fondo";

    usedUsers.add(user);

    if (i % 5 === 0 && i > 0) {
      text = randomOf(["[KEKW][KEKW][LUL][LUL]", "[PogU][PogU][AYAYA]", "[HYPERCLAP][HYPERCLAP]", "[peepoDJ][vibePls][DanceDance][ratJAM]", "[emojiFire][emojiFire][emojiFire]"]);
      user = randomOf(emoteOnlyUsers);
      tipo = "emote_puro";
    } else if (tipoRoll < 0.1) {
      const followUp = historial[Math.max(0, historial.length - 1 - randInt(0, 3))];
      text = followUp && followUp.message ? randomOf([`+1 a "${followUp.message}"`, "jaja exacto", "posta", "tal cual"]) : randomOf(["jaja", "xd", "posta", "naa"]);
      tipo = "respuesta";
    } else if (tipoRoll < 0.18) {
      text = randomOf(RANDOM_CHATTER);
      tipo = "random";
    } else if (tipoRoll < 0.22) {
      text = randomOf([
        "buenas gentee", "qué me perdí?", "recién llego", "qué pasó?",
        "estaba dormido", "volví", "che qué onda?", "primera vez acá",
      ]);
      tipo = "saludo";
    } else if (tipoRoll < 0.28) {
      text = randomOf(CHAT_REACTIONS);
      tipo = "risa";
    } else {
      text = randomMessage("", energia, cfg.capsBoost, categoria);
      tipo = i % 8 === 0 ? "destacado" : "fondo";
    }

    if (Math.random() < 0.08) text = text + " xd";
    if (Math.random() < 0.05) text = text + " boludo";
    if (Math.random() < 0.03) text = text.substring(0, Math.floor(text.length * 0.7));

    msgs.push({ user, message: text, tipo });
  }
  return msgs;
}

function persistSimulation(
  mensajes: any[],
  sessionId: string,
  context: string,
  energia: string,
  temp: number
): void {
  const existing = dbGet("SELECT id FROM sim_sessions WHERE id = ?", [sessionId]);
  if (!existing) {
    dbRun("INSERT INTO sim_sessions (id, stream_context, total_mensajes) VALUES (?, ?, ?)",
      [sessionId, context, mensajes.length]);
  } else {
    dbRun("UPDATE sim_sessions SET total_mensajes = total_mensajes + ?, ultimo_bloque = unixepoch() WHERE id = ?",
      [mensajes.length, sessionId]);
  }
  const countRows = dbAll("SELECT COUNT(*) as cnt FROM sim_mensajes WHERE session_id = ?", [sessionId]);
  const bloqueNum = Math.floor((countRows[0]?.cnt || 0) / 20);
  for (let i = 0; i < mensajes.length; i++) {
    const msg = mensajes[i];
    dbRun(
      "INSERT INTO sim_mensajes (session_id, bloque_numero, posicion, user_name, message, tipo) VALUES (?, ?, ?, ?, ?, ?)",
      [sessionId, bloqueNum, i, msg.user || "desconocido", msg.message || "", msg.tipo || "fondo"]
    );
  }
  saveToTxt(mensajes, sessionId, context);
  updateUserMemory(mensajes);
}

// ============================================================
// POST /api/chat/generate
// ============================================================
function sanitizeContext(input: string): string {
  if (!input || typeof input !== "string") return "";
  return input
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .replace(/["""'']/g, "")
    .slice(0, 500);
}

export async function generateChat(req: Request, res: Response): Promise<void> {
  try {
    let { session_id, stream_context, cantidad, energia_chat, temperature, categoria_stream, historial_db } = req.body;
    stream_context = sanitizeContext(stream_context);

    const cantidadMsgs = Math.min(cantidad || 20, 600);
    const sessionId = session_id || `stream_${Date.now()}`;
    const orKey = getOrKey();

    if (!orKey) {
      // ── Modo local sin API: generador procedural siempre disponible ──
      const energiaRawLocal = (typeof energia_chat === "string") ? energia_chat : "normal";
      const energyKeyLocal = ENERGY_CONFIGS[energiaRawLocal] ? energiaRawLocal : "normal";
      const allLocal = generateLocalChat(
        cantidadMsgs,
        energyKeyLocal,
        (stream_context && stream_context.trim() && stream_context !== "auto") ? stream_context : "transmisión en vivo",
        categoria_stream || "justchatting",
        historial_db || []
      );
      persistSimulation(allLocal, sessionId, stream_context, energyKeyLocal, ENERGY_CONFIGS[energyKeyLocal].temp);
      res.json({
        mensajes: allLocal,
        session_id: sessionId,
        cantidad: allLocal.length,
        energia_usada: energyKeyLocal,
        modo: "local",
        temperatura_usada: ENERGY_CONFIGS[energyKeyLocal].temp,
      });
      return;
    }

    const energiaRaw = (typeof energia_chat === "string") ? energia_chat : (temperature !== undefined ? "custom" : "normal");
    const energyKey = ENERGY_CONFIGS[energiaRaw] ? energiaRaw : "normal";
    const energyCfg = ENERGY_CONFIGS[energyKey];
    const temp = temperature ?? energyCfg.temp;
    const energiaLabel = energyKey.charAt(0).toUpperCase() + energyKey.slice(1);

    // Auto context: if stream_context is empty or "auto", let the AI invent it
    const ctxFinal = (stream_context && stream_context.trim() && stream_context !== "auto")
      ? stream_context
      : "auto";

    // Build energy description for prompt injection
    const energiaDesc = `ENERGÍA: ${energiaLabel} — ${energyCfg.desc} | CAPS boost: ${energyCfg.capsBoost}`;
    const prompt = SYSTEM_PROMPT.replace("{energia_desc}", energiaDesc);

    // Get cached news
    const cachedNews = getCachedNews();
    if (cachedNews) {
      logger.info("simulator", `Using ${cachedNews.length} cached news items`);
    }

    // Get user memories
    const userMemRows = dbAll("SELECT username, memoria FROM sim_usuarios WHERE ultima_aparicion > unixepoch() - 86400");
    const memoriaUsuarios: Record<string, any> = {};
    for (const row of userMemRows) {
      try { memoriaUsuarios[row.username] = JSON.parse(row.memoria); } catch { memoriaUsuarios[row.username] = {}; }
    }

    // Get previous messages for history
    const historial = historial_db || [];
    if (historial.length === 0) {
      const prevMsgs = dbAll(
        "SELECT user_name as user, message FROM sim_mensajes WHERE session_id = ? ORDER BY bloque_numero DESC, posicion DESC LIMIT 10",
        [sessionId]
      );
      historial.push(...prevMsgs.reverse());
    }

    // Determine how many agents/calls
    const msgsPerCall = cantidadMsgs <= 20 ? 20 : 30;
    const agentCount = Math.ceil(cantidadMsgs / msgsPerCall);

    // Build input data for each call
    const inputData = {
      session_id: sessionId,
      stream_context: ctxFinal,
      categoria_stream: categoria_stream || "justchatting",
      cantidad: msgsPerCall,
      energia_chat: energyKey,
      temperatura: temp,
      noticias: cachedNews || [],
      historial_db: historial.slice(-10),
      memoria_usuarios: memoriaUsuarios,
      evento: { tipo: "normal", impacto: "medio", tema: ctxFinal !== "auto" ? ctxFinal.substring(0, 50) : "transmisión en vivo" },
    };

    // Call OpenRouter (potentially multiple parallel agents)
    const rawText = await callOpenRouter(prompt, orKey, temp, agentCount, inputData);

    // Parse all messages
    let allMessages = parseMessages(rawText);

    // If we got too many, trim; if too few, try to recover by requesting more
    if (allMessages.length > cantidadMsgs) {
      allMessages = allMessages.slice(0, cantidadMsgs);
    }

    if (allMessages.length === 0) {
      const preview = rawText.substring(0, 500);
      logger.error("simulator", `Parse error, raw: ${preview}`);
      res.status(502).json({ error: "Error al parsear respuesta", raw: preview });
      return;
    }

    // ── Save to DB ──
    const existing = dbGet("SELECT id FROM sim_sessions WHERE id = ?", [sessionId]);
    if (!existing) {
      dbRun("INSERT INTO sim_sessions (id, stream_context, total_mensajes) VALUES (?, ?, ?)",
        [sessionId, stream_context, allMessages.length]);
    } else {
      dbRun("UPDATE sim_sessions SET total_mensajes = total_mensajes + ?, ultimo_bloque = unixepoch() WHERE id = ?",
        [allMessages.length, sessionId]);
    }

    const countRows = dbAll("SELECT COUNT(*) as cnt FROM sim_mensajes WHERE session_id = ?", [sessionId]);
    const bloqueNum = Math.floor((countRows[0]?.cnt || 0) / msgsPerCall);

    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];
      dbRun(
        "INSERT INTO sim_mensajes (session_id, bloque_numero, posicion, user_name, message, tipo) VALUES (?, ?, ?, ?, ?, ?)",
        [sessionId, bloqueNum, i, msg.user || "desconocido", msg.message || "", msg.tipo || "fondo"]
      );
    }

    // ── Save to TXT (clear + write) ──
    saveToTxt(allMessages, sessionId, stream_context);

    // ── Update user memory ──
    updateUserMemory(allMessages);

    res.json({
      mensajes: allMessages,
      session_id: sessionId,
      bloque_numero: bloqueNum,
      total_en_sesion: (countRows[0]?.cnt || 0) + allMessages.length,
      energia_usada: energyKey,
      temperatura_usada: temp,
    });

  } catch (err: any) {
    logger.error("simulator", `Error: ${err}`);
    res.status(500).json({ error: "Error interno del simulador" });
  }
}

// ============================================================
// GET /api/chat/history
// ============================================================
export async function getHistory(req: Request, res: Response): Promise<void> {
  try {
    const sessionId = req.query.session_id as string;
    if (!sessionId) { res.status(400).json({ error: "session_id requerido" }); return; }

    const rows = dbAll(
      "SELECT user_name as user, message, timestamp_gen as timestamp FROM sim_mensajes WHERE session_id = ? ORDER BY bloque_numero ASC, posicion ASC LIMIT 200",
      [sessionId]
    );
    res.json({ mensajes: rows, session_id: sessionId });
  } catch (err: any) {
    res.status(500).json({ error: "Error interno del simulador" });
  }
}

// ============================================================
// POST /api/chat/news  — busca noticias con OpenRouter
// ============================================================
export async function fetchNews(req: Request, res: Response): Promise<void> {
  try {
    const orKey = env.OPENROUTER_API_KEY;
    if (!orKey) { res.status(500).json({ error: "OpenRouter API key requerida" }); return; }

    // Check cache: if we fetched news in the last 5 minutes, return cached
    const cached = getCachedNews();
    if (cached && cached.length > 0) {
      const parsed = cached.map((t: string) => {
        try { return JSON.parse(t); } catch { return { tipo: "news", texto: t }; }
      });
      res.json({ noticias: parsed, cache: true });
      return;
    }

    const newsPrompt = `Generá las noticias más importantes de las ÚLTIMAS HORAS en estas 3 categorías. Respondé ÚNICAMENTE con un JSON array sin markdown:
[
  {"tipo":"sport","texto":"descripción breve del resultado o noticia deportiva"},
  {"tipo":"trend","texto":"tendencia viral en redes sociales"},
  {"tipo":"news","texto":"noticia general importante"}
]
Máximo 8 items en total, mezcla los 3 tipos. Priorizá Argentina y Latinoamérica. Incluí resultados de fútbol, MMA, boxeo, gaming, esports.`;

    const resOR = await fetch(OR_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${orKey}`,
      },
      body: JSON.stringify({
        model: OR_MODEL,
        messages: [
          { role: "system", content: "Sos un generador de noticias. Respondé solo JSON." },
          { role: "user", content: newsPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!resOR.ok) {
      const errText = await resOR.text();
      res.status(502).json({ error: "Error OpenRouter", status: resOR.status, detail: errText.substring(0, 200) });
      return;
    }

    const data = await resOR.json();
    const fullText = data?.choices?.[0]?.message?.content || "";

    let parsed: any[] = [];
    try {
      const clean = fullText.replace(/```json|```/g, "").trim();
      const match = clean.match(/\[[\s\S]*?\]/);
      if (match) parsed = JSON.parse(match[0]);
    } catch { parsed = []; }

    // Cache results
    if (parsed.length > 0) {
      const sid = `news_${Date.now()}`;
      for (const n of parsed) {
        dbRun("INSERT INTO sim_noticias_cache (session_id, query_usada, resultado, usado_en_bloque) VALUES (?, ?, ?, 1)",
          [sid, "manual", JSON.stringify(n)]);
      }
    }

    res.json({ noticias: parsed, cache: false });

  } catch (err: any) {
    logger.error("simulator", `News error: ${err}`);
    res.status(500).json({ error: "Error interno del simulador" });
  }
}

// ============================================================
// POST /api/chat/export-txt — guarda los mensajes en un .txt
// ============================================================
export async function exportSimTxt(req: Request, res: Response): Promise<void> {
  try {
    const { mensajes, nombre } = req.body || {};
    if (!Array.isArray(mensajes) || mensajes.length === 0) {
      res.status(400).json({ error: "No hay mensajes para exportar" });
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = (typeof nombre === "string" && nombre.trim())
      ? nombre.trim().replace(/[^a-z0-9_-]/gi, "")
      : `sim_${stamp}`;
    const filePath = path.resolve(process.cwd(), "data", "exports", `${safeName}.txt`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const lines = [
      `=== Simulación ${new Date().toLocaleString("es-AR")} ===`,
      `=== ${mensajes.length} mensajes ===`,
      "",
    ];
    for (const m of mensajes) {
      lines.push(`${m.user || "anónimo"}: ${m.message || ""}`);
    }
    fs.writeFileSync(filePath, lines.join("\n"), "utf-8");

    res.json({ success: true, archivo: safeName + ".txt", ruta: filePath });
  } catch (err: any) {
    logger.error("simulator", `Export error: ${err}`);
    res.status(500).json({ error: "Error al exportar el .txt" });
  }
}

// ============================================================
// GET /api/chat/send-stats — conteo de mensajes por bot
// ============================================================
const ACCOUNT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const usernameCache = new Map<string, string | null>();

async function resolveKickUsername(bearer: string): Promise<string | null> {
  // 1) nombre ya aprendido de un send exitoso (fuente confiable, sin API extra)
  const learned = getRealUsername(bearer);
  if (learned) return learned;
  if (usernameCache.has(bearer)) return usernameCache.get(bearer) || null;
  try {
    const res = await fetch("https://kick.com/api/v2/self", {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": ACCOUNT_UA,
        Authorization: bearer.startsWith("Bearer ") ? bearer : "Bearer " + bearer,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 200) {
      usernameCache.set(bearer, null);
      return null;
    }
    const data: any = await res.json();
    const name = data?.username || data?.data?.username || data?.identity?.username || null;
    usernameCache.set(bearer, name);
    return name;
  } catch {
    usernameCache.set(bearer, null);
    return null;
  }
}

export async function getSendStats(_req: Request, res: Response): Promise<void> {
  try {
    const counters = getSentCounters();
    const bots = stmts.listAllBots.all() as any[];
    const out: any[] = [];
    for (const b of bots) {
      let token = "";
      try { token = (decryptFromHex(b?.encrypted_bearer || "") || "").trim(); } catch {}
      const count = token ? counters.get(token) || 0 : 0;
      const storedName = (b?.kick_username || "").trim();
      let name = storedName || b.bot_name;
      if (token && !storedName) {
        const real = await resolveKickUsername(token);
        if (real) {
          name = real;
          try { stmts.updateBotKickUsername.run([real, b.id]); } catch {}
        }
      }
      out.push({ botId: name, count, botName: b.bot_name, used: count > 0 });
    }
    out.sort((a, b) => (b.count || 0) - (a.count || 0));
    res.json({ success: true, total: out.reduce((s, u) => s + (u.count || 0), 0), bots: out });
  } catch (err: any) {
    logger.error("simulator", `Send stats error: ${err}`);
    res.status(500).json({ error: "Error obteniendo estadísticas" });
  }
}

export async function resetSendStats(_req: Request, res: Response): Promise<void> {
  resetSendCounters();
  res.json({ success: true });
}

// ============================================================
// POST /api/chat/send-sim — envía en vivo los mensajes con los bearers
// ============================================================
export async function sendSimMessages(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body || {};
    const mensajes: any[] = Array.isArray(body.mensajes) ? body.mensajes : [];
    const channel = (typeof body.channel === "string" && body.channel.trim())
      ? body.channel.trim()
      : "";
    const chatroomId: number | undefined = body.chatroom_id ?? undefined;
    const randomOrder = body.random_order !== false;
    const delay = Math.max(800, Number(body.delay) || 2500);

    if (mensajes.length === 0) { res.status(400).json({ error: "No hay mensajes para enviar" }); return; }
    if (!channel && chatroomId == null) { res.status(400).json({ error: "Falta el canal o chatroom_id" }); return; }

    let resolvedChatroomId = chatroomId;
    if (channel && resolvedChatroomId == null) {
      const r = await resolveChatroomId(channel);
      if (r.chatId == null) { res.status(400).json({ error: "No se pudo resolver el canal: " + channel }); return; }
      resolvedChatroomId = r.chatId;
    }

    const order = randomOrder ? mensajes.map((_, i) => i).sort(() => Math.random() - 0.5) : mensajes.map((_, i) => i);
    const results: any[] = [];
    let ok = 0, fail = 0;

    for (const idx of order) {
      const m = mensajes[idx];
      if (!m.message) continue;
      const texto = `${m.user || "anonymous"}: ${m.message}`;
      const r = await sendWithBearer(channel || "", texto, { chatroomId: resolvedChatroomId });
      if (r.ok) ok++; else fail++;
      results.push({ user: m.user, status: r.status, ok: r.ok });
      await new Promise(s => setTimeout(s, delay));
    }

    res.json({ ok: true, enviados: ok, fallidos: fail, detalles: results, chatroom_id: resolvedChatroomId });
  } catch (err: any) {
    logger.error("simulator", `Send error: ${err}`);
    res.status(500).json({ error: "Error al enviar mensajes" });
  }
}

// ============================================================
// POST /api/chat/build-prompt — arma un prompt con las reglas
// adaptadas a un tema, para pegarlo en Gemini/ChatGPT/OpenRouter
// ============================================================
export async function buildPrompt(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body || {};
    const tema = (typeof body.tema === "string" && body.tema.trim()) ? body.tema.trim() : "";
    const categoria = (typeof body.categoria === "string" && body.categoria.trim()) ? body.categoria.trim() : "justchatting";
    const energiaRaw = (typeof body.energia === "string" && body.energia.trim()) ? body.energia.trim() : "normal";
    const energia = ENERGY_CONFIGS[energiaRaw] ? energiaRaw : "normal";
    const cantidad = Math.min(Math.max(Number(body.cantidad) || 50, 10), 600);

    if (!tema) { res.status(400).json({ error: "Escribí un tema de conversación" }); return; }

    const cfg = ENERGY_CONFIGS[energia];
    const energiaDesc = `ENERGÍA: ${energia.charAt(0).toUpperCase() + energia.slice(1)} — ${cfg.desc} | CAPS boost: ${cfg.capsBoost}`;

    const prompt = `${SYSTEM_PROMPT.replace("{energia_desc}", energiaDesc)}

═══════════════════════════════════════════════════════════════
## TEMA / CONTEXTO DE ESTA TRANSMISIÓN (adaptá TODAS las reglas a esto)
═══════════════════════════════════════════════════════════════
Tema: ${tema}

Categoría detectada: ${categoria}

═══════════════════════════════════════════════════════════════
## INSTRUCCIÓN FINAL PARA VOS (IA)
═══════════════════════════════════════════════════════════════
Generá ${cantidad} mensajes de chat en vivo (Kick/Twitch, español rioplatense) que reaccionen EXCLUSIVAMENTE a este tema: "${tema}".

Segú TODAS las reglas R1 a R18:
- Mezclá las 50 personalidades, repetí las que correspondan (spammers, emoters, hype).
- Respetá la energía: ${energia} (${cfg.desc}).
- Los primeros mensajes abren el tema, los del medio lo desarrollan, los finales lo cierran (narrativa continua R13).
- Cero frases de bot: nada de "claro", "entiendo", "por supuesto". Lenguaje callejero: dale, wacho, naa, bro, crack, posta, capo.
- Mínimo 15 usuarios distintos cada 20 mensajes.
- En ${Math.ceil(cantidad / 5)} mensajes al azar usá SOLO emotes (emote_puro), con usuarios tipo j00p_t7, Stebwb, DanielaSleep.
- CRÍTICO (R14-R18): si el tema es una NOTICIA o actualidad, NO resumas el "formato del programa": HABLÁ de la noticia EN SÍ. Usá hechos reales y concretos de Argentina y la región con NOMBRES PROPIOS, países, fechas, personas, equipos, resultados. Prohibido: generalidades tipo "el próximo resumen comparará", "hubo ruido político", "la semana tuvo temas". Si el tema menciona un hecho puntual (ej. "muerte del papá de Messi", "fallo de X", "clásico Boca–River"), el 90% de los mensajes deben reaccionar a ESE hecho exacto con datos, memoria o reacción emocional realista.

Respondé ÚNICAMENTE con un JSON array, sin markdown, así:
[{"user":"usuario","message":"texto","tipo":"hype|pregunta|respuesta|emote_puro|spam|analisis|risa|saludo"}]

El array debe tener exactamente ${cantidad} objetos.`;

    res.json({ success: true, prompt, cantidad, energia, categoria });
  } catch (err: any) {
    logger.error("simulator", `Build prompt error: ${err}`);
    res.status(500).json({ error: "Error armando el prompt" });
  }
}
