import type { Request, Response } from "express";
import { env } from "../config/env";
import { getDb } from "../models/database";
import path from "path";
import fs from "fs";

const OR_MODEL = "openai/gpt-oss-20b:free";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

const ENERGY_CONFIGS: Record<string, { temp: number; desc: string; capsBoost: string }> = {
  tranquilo:  { temp: 0.55, desc: "tranquilo, más conversación, menos spam, más preguntas", capsBoost: "bajo" },
  normal:     { temp: 0.75, desc: "balanceado, variedad sin romper reglas", capsBoost: "medio" },
  hype:       { temp: 0.85, desc: "eufórico, partido importante/apuesta/clutch, mucho HYPE y CAPS", capsBoost: "alto" },
  caotico:    { temp: 0.92, desc: "caos total, Twitch loco, gritos, spam, emotes por doquier", capsBoost: "maximo" },
};

const SYSTEM_PROMPT = `Sos un simulador de chat de stream en vivo (Kick/Twitch) de la comunidad hispanohablante (Argentina, Uruguay, Chile, Venezuela, Colombia).

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
## CATEGORÍAS DE STREAM — USALAS PARA SABER EL TONO
═══════════════════════════════════════════════════════════════
- gaming: partidos, jugadas, kills, deaths, rage, competitivo, risas por bugs
- irl: salidas, comidas, viajes, eventos callejeros, anécdotas en vivo
- justchatting: conversación tranquila, el streamer responde preguntas, historias personales
- music: el streamer canta toca un instrumento o reacciona a música, el chat pide canciones
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
- tranquilo → más preguntas, menos CAPS, más conversación relajada
- normal → balanceado, variedad natural
- hype → mucho HYPE, CAPS, emotes de fuego, repeticiones
- caotico → TODO MAYÚSCULAS, spam extremo, emotes en cadena, caos controlado

═══════════════════════════════════════════════════════════════
## 50 PERSONALIDADES DEL CHAT
═══════════════════════════════════════════════════════════════
GRUPO A: SPAMMERS CAPS
  tutossj (TODO CAPS, repite 2-4 veces, NO emotes)
  ChaskyBoom (repite 3-5 veces, NO emotes)
  LukaaF (una palabra CAPS repetida, NO emotes)

GRUPO B: HYPE
  laverde99 ("GOAT" "EZ" "CRACK" caps, 1-2 emotes)
  Reixzer (frases cortas energéticas, 1-2 emotes)
  Andrestoby12 (anima, 2-4 emotes)
  aarturoo00 (celebra, 2-4 emotes)
  lautacc (hype tranquilo, 2-4 emotes)

GRUPO C: FANÁTICOS
  elmascapito3001 (defiende al streamer, 1-2 emotes)
  moritari (fan defender emocional, 1-2 emotes)

GRUPO D: EMOTE WARRIORS
  j00p_t7 (SOLO emotes, 4-8)
  Stebwb (SOLO emotes, 4-8)
  SANGREJJAPONESA (cadena baile [peepoDJ][vibePls][DanceDance][ratJAM])
  J0lteonn (solo emotes repetidos)
  Leito_Diaz_999 (texto corto + 3-5 emotes)
  DanielaSleep ([HYPERCLAP] repetido)
  valentinaaa_ssj (solo emotes baile y amor)
  CumbiaG0RD4 ([peepoDJ][DanceDance][shoulderRoll][beeBobble])

GRUPO E: COMENTARISTAS
  Manzanirou (comentario inteligente, sin/minimo emotes)
  royluis (crítica respetuosa)
  Damian777_Mc (narra como locutor)
  Cristianv7 (exagera TODO, 1-2 emotes)
  INFODK (análisis técnico)
  Graffi10k (drama gracioso, 1-2 emotes)

GRUPO F: REACTORES
  Gino_TN ("WTF" "NOOO" shock, 1-2 emotes)
  iCopito (quejas técnicas: "HAY DELAY" "NO SE ESCUCHA")
  dekoredd (palabras cortas: "ojo" "dale" "eso")
  Janthz (frases de impacto, 1-2 emotes)
  ElYaSoy (reacciones normales)
  yeremisonda (reactora emocional, 2-4 emotes)

GRUPO G: LURKERS RISAS
  KuroiiNekoo (aparece de golpe)
  Mariiana_013 ("JAJAJAJA" "ajksdjaksdj", 1-2 emotes)
  maxii123mdcdd (solo risas)
  bomboclat_0 (pregunta detalles)

GRUPO H: SALUDADORES
  Elsopapas (saluda a todos)
  nazawein ("primero" "presente")
  ThiaGOAT1177 (pide saludo)
  WiteRoom111 (habla al streamer)
  chuchiti ("qué me perdí")
  nyxalth (saludo corto)

GRUPO I: ESPECIALES
  GallitoXTZ (español+português)
  Kul_zu (mensajes random)
  FernetArgento (orgulloso argentino, 1-2 emotes)
  0800milton (recuerda streams viejos)
  mrloggio (novato, 1 emote)
  martinmacflay (nostálgico)
  Eloski12 (sarcasmo)
  Aidansitou (trollea, 1 emote)
  francebvb (links/datos)
  TimberoRafa (apostador)
  BotRix (info sistema, máx 1 por tanda)

═══════════════════════════════════════════════════════════════
## EMOTES DISPONIBLES
═══════════════════════════════════════════════════════════════
[HYPERCLAP] [Clap] [peepoRiot] [AYAYA] [PogU] [KEKW] [KEKBye] [PatrickBoo] [LUL] [OOOO] [WeSmart] [Prayge] [POLICE] [modCheck] [peepoDJ] [vibePls] [DanceDance] [shoulderRoll] [beeBobble] [ratJAM] [MuteD] [emojiAngry] [emojiCry] [emojiBlowKiss] [emojiAngel] [emojiCheerful] [Flowie] [catKISS] [emojiFire] [AURAPULSE] [EZ] [classic] [BANGER]

═══════════════════════════════════════════════════════════════
## REGLAS CRÍTICAS
═══════════════════════════════════════════════════════════════
R1. EMOTE PURO: Posiciones múltiplo de 5 (5,10,15,20... hasta donde alcance la cantidad) → SOLO emotes, asignar a usuarios emote_only/emote_dancer/clapper. En tandas grandes, ~25% del total deben ser solo emotes.

R2. DIVERSIDAD: Mínimo 15 usuarios distintos por cada 20 mensajes. En tandas de 600, usar los 50 usuarios, cada uno aparece 5-15 veces. Los spammers pueden repetirse seguido.

R3. COHERENCIA: 100% coherente con el contexto. TODOS los mensajes reaccionan al contexto dado. Si el contexto está vacío o dice "auto", INVENTÁ un contexto de stream vos mismo (elegí una categoría y describí qué está pasando).

R4. DATOS ESPECÍFICOS: Números del contexto → mínimo 3 mensajes los mencionan.

R5. NOTICIAS REALES: 20-30% pueden mencionar noticias si se pasaron.

R6. JERGA: dale/wacho/naa/bro/crack/goat/hdp/salame/xd/gg/posta/joya/capo/flaco/bue/boeeee/ajksdjaksdj

R7. PROHIBIDO: ¡ ¿ . final / "hola cómo estás" / "por supuesto" / lenguaje chatbot.

R8. CICLO PREGUNTA→RESPUESTA: Secuencia natural → alguien pregunta → 2-3 responden → emotes → nuevo tema. NO son 20 opiniones independientes, es una CONVERSACIÓN.

R9. ANTI-IA: No todos reaccionan a lo mismo. Variar longitud. Algunos ignoran cosas.

R10. HISTORIAL: Si hay historial, 2-3 mensajes referencian algo anterior.

R11. MEMORIA USUARIOS: Si se pasa memoria_usuarios, respetar cómo hablaron antes y qué temas tocaron.

R12. EVENTO: Si hay un evento activo ({tipo, impacto, tema}), los mensajes deben reaccionar al evento.
  - "gol" → euforia, celebración
  - "muerte" → shock, NOOOOOO
  - "clutch" → hype extremo, jugada increíble
  - "clutch_equipo" → el equipo entero hizo algo épico
  - "inicio" → saludos, buenas
  - "fin" → despedidas, gracias por venir
  - "raid" → llega gente de otro stream, bienvenida masiva
  - "hito" → X seguidores, X subs, celebración
  - "sorteo" → giveaway, el chat explota
  - "reaccion" → el streamer reacciona a algo inesperado
  - "gameplay_peak" → momento épico en el juego
  - "gameplay_error" → cagada épica, fail gracioso
  - "entrada_salida" → alguien entró/salió del stream

R13. NARRATIVA CONTINUA — IMPORTANTE: Los mensajes NO son aleatorios. Debe haber HILOS NARRATIVOS que conecten el inicio con el final:
  - Los primeros mensajes (1-50) establecen temas, reacciones iniciales, preguntas
  - Los mensajes del medio (50-300) desarrollan esos temas, aparecen nuevos, hay idas y vueltas
  - Los mensajes finales (300-600) cierran temas, resuelven dudas, hay desenlace
  - Ejemplo: si en el mensaje 1 alguien pregunta "cuánto va?", en el mensaje 10 alguien responde, en el 50 actualizan el resultado, en el 200 celebran o se quejan
  - Los spammers pueden repetir el mismo estribillo cada X mensajes (onda los memes que vuelven)
  - Debe sentirse como una conversación REAL de 600 mensajes, NO como 600 cortes independientes

═══════════════════════════════════════════════════════════════
## FORMATO DE SALIDA — SOLO JSON SIN MARKDOWN
═══════════════════════════════════════════════════════════════
{
  "session_id": "...",
  "contexto_usado": "...",
  "categoria_stream": "gaming|irl|justchatting|...",
  "noticias_encontradas": [],
  "mensajes": [
    {"id":0,"user":"nombre","message":"texto [EMOTE]","tipo":"hype|pregunta|respuesta|emote_puro|spam|analisis|noticia_externa|risa|queja|saludo|fondo|apuesta"}
  ],
  "resumen_para_db": {
    "temas_activos": [],
    "apuestas_en_curso": [],
    "usuarios_activos": [],
    "ultimo_evento": ""
  }
}`;

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
// POST /api/chat/generate
// ============================================================
export async function generateChat(req: Request, res: Response): Promise<void> {
  try {
    const { session_id, stream_context, cantidad, energia_chat, temperature, categoria_stream, historial_db } = req.body;

    const cantidadMsgs = Math.min(cantidad || 20, 600);
    const sessionId = session_id || `stream_${Date.now()}`;
    const orKey = req.headers["x-openrouter-key"] as string || env.OPENROUTER_API_KEY;
    if (!orKey) { res.status(500).json({ error: "OpenRouter API key requerida" }); return; }

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
      console.log(`[simulator] Using ${cachedNews.length} cached news items`);
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
      console.error("[simulator] Parse error, raw:", preview);
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
    console.error("[simulator] Error:", err);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
}

// ============================================================
// POST /api/chat/news  — busca noticias con OpenRouter
// ============================================================
export async function fetchNews(req: Request, res: Response): Promise<void> {
  try {
    const orKey = req.headers["x-openrouter-key"] as string || env.OPENROUTER_API_KEY;
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
    console.error("[simulator] News error:", err);
    res.status(500).json({ error: err.message });
  }
}
