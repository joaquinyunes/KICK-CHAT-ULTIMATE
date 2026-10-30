// Detectores de señales sobre las líneas que lee el OCR. Son funciones puras: reciben líneas
// ({ text, norm, confidence, bbox, height, zone }) y devuelven lo que encuentran, sin decidir nada.
// La decisión de qué actividad es la toma classify.js sumando estas señales.

const CODE_LANGUAGES = {
  js: "JavaScript", jsx: "React (JSX)", ts: "TypeScript", tsx: "React (TSX)", py: "Python", java: "Java", go: "Go", rs: "Rust", c: "C", cpp: "C++", h: "C/C++",
  cs: "C#", rb: "Ruby", php: "PHP", swift: "Swift", kt: "Kotlin", json: "JSON", yml: "YAML", yaml: "YAML", toml: "TOML", md: "Markdown", sh: "Shell",
  html: "HTML", css: "CSS", sql: "SQL", vue: "Vue", svelte: "Svelte", dart: "Dart", lua: "Lua",
};
// Lenguaje por la extensión del archivo («main.js» -> JavaScript).
export const languageOf = (file) => CODE_LANGUAGES[String(file ?? "").split(".").pop().toLowerCase()] ?? null;

const DOC_KINDS = { xlsx: "spreadsheet", xls: "spreadsheet", csv: "spreadsheet", docx: "document", doc: "document", pptx: "presentation", ppt: "presentation", pdf: "pdf", txt: "document" };

// Palabras típicas de cada actividad, sobre texto normalizado (minúsculas, sin acentos). Cuenta términos DISTINTOS:
// repetir «error» veinte veces no suma más que verlo una vez.
export const TERMS = {
  casino: /\b(?:balance|saldo|spin|spins|giros?|free spins|multiplier|multiplicador|jackpot|bonus|ruleta|roulette|blackjack|baccarat|slots?|casino|autoplay|buy feature|wild|scatter|payline|megaways|dealer|crupier|place your bets|bets closed|last numbers|ultimos numeros)\b/g,
  sports_betting: /\b(?:cuotas?|odds|bet slip|boleto|cupon|apuesta simple|apuesta combinada|parlay|handicap|1x2|over under|mas de|menos de|mercado|market|cash out|moneyline|apostar|pronostico)\b/g,
  sports_live: /\b(?:half|tiempo|parte|periodo|period|quarter|cuarto|descanso|halftime|fulltime|prorroga|overtime|gol|goal|minuto|en vivo|en directo|live|q[1-4])\b/g,
  video_game: /\b(?:hp|health|armor|shield|ammo|kills?|deaths?|assists?|eliminations?|elims|players left|jugadores|round|ronda|level|nivel|xp|respawn|victory|victoria|defeat|derrota|mmr|rank|ranked|competitive|loadout|mission|quest|inventory|inventario|squad|lobby|wave|gold|stamina|mana)\b/g,
  streaming: /\b(?:viewers|espectadores|followers|seguidores|subscribe|suscribirse|suscriptores|raid|clip|chat|stream|directo|streamer|donate|donar|bits|is live|just chatting|following|browse)\b/g,
  trading: /\b(?:open|high|low|close|rsi|macd|ema|sma|volume|vol|buy|sell|long|short|leverage|apalancamiento|pnl|order|orden|limit|candle|vela|bid|ask|spread|futures|perp|stop loss|take profit)\b/g,
  video_media: /\b(?:play|pause|subtitulos|subtitles|episodio|episode|season|temporada|trailer|reproducir|skip intro|saltar intro|capitulo|views|visualizaciones|reproducciones|subscribe|suscribirse|up next|siguiente|playlist|shorts)\b/g,
  coding: /\b(?:function|const|let|var|import|export|return|class|def|async|await|public|private|void|interface|struct|problems|output|debug console|git|commit|branch|merge|pull request|npm|node modules|lint|compile|build|stack trace|exception|undefined)\b/g,
  terminal: /\b(?:command not found|permission denied|sudo|apt|brew|pip|npm|npx|yarn|pnpm|docker|kubectl|git|cargo|make|tests?|pass|fail)\b/g,
  documents: /\b(?:sheet|hoja|slide|diapositiva|document|documento|insert|insertar|formulas?|pivot|font|fuente|paragraph|parrafo|layout|diseno|editing|untitled|sin titulo|heading|cell|celda|columna|fila|row|column)\b/g,
  email: /\b(?:inbox|bandeja de entrada|compose|redactar|asunto|subject|borradores|drafts|enviados|spam|archivar|responder|reenviar|bcc)\b/g,
  chat: /\b(?:escribe un mensaje|type a message|mensaje|channels?|canales|typing|escribiendo|direct messages|mensajes directos|servers?|servidor|last seen|en linea|reply)\b/g,
  meeting: /\b(?:mute|unmute|silenciar|activar sonido|camera|camara|present now|presentar|share screen|compartir pantalla|leave|salir|raise hand|levantar la mano|participants|participantes|meeting|reunion|llamada|waiting room|sala de espera|gallery view|speaker view|end call|colgar)\b/g,
  browsing: /\b(?:suscribete|subscribe|noticias|news|opinion|editorial|ultima hora|breaking|leer mas|read more|cookies|acepto|aceptar|politica de privacidad|privacy policy|iniciar sesion|registrarse|sign up|carrito|comprar|buy now|add to cart|buscar|search|contacto)\b/g,
  social: /\b(?:like|likes|me gusta|retweet|repost|comments?|comentarios?|story|stories|historias|reels|following|siguiendo|follow|seguir|trending|hashtag)\b/g,
};

// Cuántos términos distintos de una categoría aparecen en el texto normalizado.
export function termHits(category, normAll) {
  return new Set(normAll.match(TERMS[category]) ?? []).size;
}

const TLDS = "com|es|net|org|io|dev|tv|gg|app|co|mx|ar|cl|pe|uk|de|fr|it|br|us|info|me|ai|so|ly|xyz|online|bet|casino|games|game";
const URL_RE = new RegExp(`(?:https?:\\/\\/)?((?:[a-z0-9-]+\\.)+(?:${TLDS})|localhost)(?::\\d+)?(\\/[^\\s¶]*)?`, "i");

// Direcciones web que aparecen en las líneas (la de la barra del navegador suele estar en la franja superior).
export function findUrls(lines) {
  const found = [];
  for (const line of lines) {
    const m = URL_RE.exec(line.text);
    if (!m) continue;
    // «main.js» o «server.ts» no son dominios: el TLD tiene que ir seguido de fin de palabra.
    const host = m[1].toLowerCase().replace(/^www\./, "");
    if (found.some((u) => u.host === host)) continue;
    found.push({ host, path: m[2] ?? "", zone: line.zone, text: line.text });
  }
  return found;
}

const CODE_FILE_RE = new RegExp(`\\b([\\w][\\w.-]{0,60}\\.(${Object.keys(CODE_LANGUAGES).join("|")}))\\b`, "gi");
const DOC_FILE_RE = new RegExp(`\\b([\\w][\\w .-]{0,60}\\.(${Object.keys(DOC_KINDS).join("|")}))\\b`, "gi");

// Archivos de código y de documentos que se nombran en pantalla (pestañas, barra de título, rutas).
export function findFiles(lines) {
  const code = new Map();
  const docs = new Map();
  for (const { text, zone } of lines) {
    for (const [, name, ext] of text.matchAll(CODE_FILE_RE)) {
      if (!/^\d/.test(name)) code.set(name, { name, ext: ext.toLowerCase(), language: CODE_LANGUAGES[ext.toLowerCase()], zone });
    }
    for (const [, name, ext] of text.matchAll(DOC_FILE_RE)) docs.set(name.trim(), { name: name.trim(), ext: ext.toLowerCase(), kind: DOC_KINDS[ext.toLowerCase()], zone });
  }
  return { code: [...code.values()], docs: [...docs.values()] };
}

// «main.js — pantalla-context — Visual Studio Code». El OCR suele perder el punto («main js»), así que se tolera.
const EXT_ALTERNATIVES = Object.keys(CODE_LANGUAGES).join("|");
// El separador es un guion RODEADO DE ESPACIOS: los nombres de proyecto llevan guiones («pantalla-context»).
const EDITOR_TITLE_RE = new RegExp(`^[●•\\s]*([\\w-]+(?:\\.[\\w-]+)*?)[.\\s]?(${EXT_ALTERNATIVES})\\s+[—–-]\\s+(.+?)\\s+[—–-]\\s+(.*(?:Visual Studio Code|IntelliJ|PyCharm|WebStorm|Sublime|Cursor|Xcode|Android Studio).*)$`, "i");
export function findEditorTitle(lines) {
  for (const { text } of lines) {
    const m = EDITOR_TITLE_RE.exec(text);
    if (m) return { file: `${m[1]}.${m[2].toLowerCase()}`, project: m[3].trim(), app: m[4].trim() };
  }
  return null;
}

const ERROR_RE = /\b((?:[A-Z][A-Za-z]*(?:Error|Exception)|Traceback|Uncaught|FATAL|panic:?|ENOENT|ECONNREFUSED|EADDRINUSE|segmentation fault|command not found|Permission denied)\b[^¶]{0,110})/;
const STACK_RE = /\bat\s+[\w.<>$]+\s+\([^)]*:\d+:\d+\)|File "[^"]+", line \d+/;
export function findErrors(lines) {
  const first = lines.map((l) => ERROR_RE.exec(l.text)).find(Boolean);
  return { error: first ? first[1].trim() : null, stack: lines.some((l) => STACK_RE.test(l.text)) };
}

const PROMPT_RE = /^(?:[\w.-]+@[\w.-]+[: ]\S*\s?[$#%]|\$\s|PS [A-Z]:\\[^>]*>|[A-Z]:\\[^>]*>)\s*(.*)$/;
const COMMAND_RE = /^(npm|npx|yarn|pnpm|git|docker|kubectl|pip3?|python3?|node|cargo|go|make|ls|cd|cat|curl|ssh|sudo|apt|brew|java|mvn|gradle|dotnet|terraform)\b.*$/;

// Línea de comandos: hay prompt y cuál fue el último comando escrito.
export function findTerminal(lines) {
  let prompt = false;
  let command = null;
  for (const { text } of lines) {
    const m = PROMPT_RE.exec(text);
    if (!m) continue;
    prompt = true;
    if (COMMAND_RE.test(m[1])) command = m[1].slice(0, 80);
  }
  const text = lines.map((l) => l.text).join(" ¶ ");
  const node = /# tests (\d+)[^#]*# pass (\d+)[^#]*# fail (\d+)/i.exec(text);
  const passing = /(\d+) passing/i.exec(text);
  const failing = /(\d+) failing/i.exec(text);
  let tests = null;
  if (node) tests = { total: +node[1], passed: +node[2], failed: +node[3] };
  else if (passing) tests = { total: +passing[1] + +(failing?.[1] ?? 0), passed: +passing[1], failed: +(failing?.[1] ?? 0) };
  return { prompt, command, tests };
}

// Reproductor de vídeo: «12:34 / 25:10», contador de vistas, botón de suscribirse.
export function findPlayer(lines) {
  const text = lines.map((l) => l.text).join(" ¶ ");
  const time = /\b(\d{1,2}:\d{2}(?::\d{2})?)\s*\/\s*(\d{1,2}:\d{2}(?::\d{2})?)\b/.exec(text);
  const views = /([\d.,]+\s?[KMB]?)\s*(?:views|visualizaciones|reproducciones)/i.exec(text);
  return { time: time ? { current: time[1], total: time[2] } : null, views: views ? views[1].trim() : null };
}

// Directos: «xQc is live», espectadores y categoría («Just Chatting · 48,213 viewers»).
export function findStream(lines) {
  const text = lines.map((l) => l.text).join(" ¶ ");
  const streamer = /(?:^|¶\s*)([\w.\-]{2,25})\s+(?:is live|esta en directo|está en directo)/i.exec(text);
  const viewers = /([\d.,]+)\s*(?:viewers|espectadores)/i.exec(text);
  const category = /([A-Za-zÀ-ÿ&' ]{3,30}?)\s*[·•|-]\s*[\d.,]+\s*(?:viewers|espectadores)/i.exec(text);
  return { streamer: streamer?.[1] ?? null, viewers: viewers?.[1] ?? null, category: category?.[1].trim() ?? null };
}

export function findChannel(lines) {
  const m = /(?:^|\s)#\s?([\w-]{2,30})\b/.exec(lines.map((l) => l.text).join(" ¶ "));
  return m ? m[1] : null;
}

// Importes con etiqueta en la misma línea («BALANCE €148.30», «Apuesta simple €10.00»).
const MONEY = String.raw`(?:[€$£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|\$|£|USD|EUR|MXN|ARS|COP|CLP|PEN|BRL))`;
const AMOUNT_LABELS = [
  { key: "balance", re: /\b(?:balance|saldo|credits?|creditos?)\b/i },
  { key: "bet", re: /\b(?:total bet|bet|apuesta total|apuesta|stake|wager)\b/i },
  { key: "win", re: /\b(?:total win|win|ganancia|ganancias|premio|payout|you won|has ganado)\b/i },
];
export function findLabeledAmounts(lines) {
  const found = {};
  for (const { text } of lines) {
    for (const { key, re } of AMOUNT_LABELS) {
      if (found[key]) continue;
      // Admite un calificativo entre la etiqueta y el importe: «Apuesta simple €10.00», «Bet slip total 5.00».
      const m = new RegExp(`${re.source}(?:\\s+(?:simple|sencilla|combinada|acumulada|single|parlay|slip))?\\s*[:=]?\\s*(${MONEY}|\\d[\\d.,]*)`, "i").exec(text);
      if (m) found[key] = m[1].trim();
    }
  }
  return found;
}

export function findSpins(text) {
  const m = /free spins?\s*:?\s*(\d+)|(\d+)\s*free spins?|giros gratis\s*:?\s*(\d+)|(\d+)\s*giros gratis/i.exec(text);
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4]) : null;
}

export function findMultiplier(lines) {
  for (const { text } of lines) {
    const m = /\b(?:multiplier|multiplicador|mult)\b\s*:?\s*[x×]?\s*(\d+(?:[.,]\d+)?)\s*[x×]?/i.exec(text);
    if (m) return `x${m[1]}`;
  }
  return null;
}

// «Real Madrid 2 - 1 Manchester City» en una línea. Si el nombre del visitante se parte («Boston» / «Celtics»),
// se completa con la línea corta de justo debajo.
export function findScoreLine(lines) {
  const re = /^(.{2,32}?)\s+(\d{1,3})\s*[-–:]\s*(\d{1,3})\s+(.{2,32})$/;
  const letters = (str) => (str.match(/\p{L}/gu) ?? []).length;
  for (const [i, { text, bbox }] of lines.entries()) {
    const m = re.exec(text);
    if (!m) continue;
    const [, home, hs, as, away] = m;
    if (letters(home) < 3 || letters(away) < 3) continue;
    let awayName = away.trim();
    const next = lines[i + 1];
    if (next?.bbox && bbox && /^[\p{L}' .-]{3,24}$/u.test(next.text) && next.bbox.y0 - bbox.y1 < 1.5 * (bbox.y1 - bbox.y0) && next.bbox.x0 < bbox.x1 && next.bbox.x1 > bbox.x0) {
      awayName = `${awayName} ${next.text}`;
    }
    return { home: home.trim(), away: awayName, score: `${hs}-${as}` };
  }
  return null;
}

// Minuto («67'»), periodo de baloncesto («Q4 · 03:21») o hito del partido («HT», «FT»).
export function findClock(lines) {
  for (const { text } of lines) {
    const quarter = /\bQ([1-4])\b\s*[·•\-–]*\s*(\d{1,2}:\d{2})/.exec(text);
    if (quarter) return `Q${quarter[1]} ${quarter[2]}`;
    const minute = /(?:^|[^\d])(\d{1,3})\s?(?:'|’|′)(?!\d)/.exec(text);
    if (minute) return `${minute[1]}'`;
    const period = /\b(?:HT|FT|half ?time|descanso|final)\b/i.exec(text);
    if (period) return period[0].toUpperCase();
  }
  return null;
}

// Cuotas: líneas que son solo un decimal entre 1.01 y 99.99 y la etiqueta más cercana por encima (misma columna).
export function findOdds(lines) {
  const isOdd = (t) => /^\d{1,2}[.,]\d{2}$/.test(t) && Number(t.replace(",", ".")) >= 1.01;
  const oddLines = lines.filter((l) => isOdd(l.text) && l.bbox);
  if (oddLines.length < 2) {
    // Todas en la misma línea: «1.45 4.20 6.75»
    const row = lines.map((l) => l.text.split(" ")).find((tokens) => tokens.length >= 2 && tokens.length <= 4 && tokens.every(isOdd));
    return row ? row.map((value) => ({ label: null, value })) : [];
  }
  return oddLines.map((odd) => {
    const cx = (odd.bbox.x0 + odd.bbox.x1) / 2;
    const above = lines
      .filter((l) => l.bbox && !isOdd(l.text) && l.bbox.y1 <= odd.bbox.y0 + 4 && odd.bbox.y0 - l.bbox.y1 < 160 && cx >= l.bbox.x0 - 20 && cx <= l.bbox.x1 + 20)
      .sort((a, b) => b.bbox.y1 - a.bbox.y1)[0];
    return { label: above?.text ?? null, value: odd.text };
  });
}

export function findTradingPair(text) {
  const m = /\b([A-Z]{2,6})\s?[/\\I|-]\s?([A-Z]{3,6})\b/.exec(text);
  return m && /^(?:USDT|USDC|USD|EUR|BTC|ETH|JPY|GBP|BUSD)$/.test(m[2]) ? `${m[1]}/${m[2]}` : null;
}

export function findTimeframe(text) {
  const m = /(?:^|\s)(1m|3m|5m|15m|30m|1h|2h|4h|1d|1w|1M)(?:\s|$)/.exec(text);
  return m ? m[1] : null;
}

export function findPrice(lines) {
  for (const { text } of lines) {
    const m = /\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d{2,})\b\s*([+-]\d+(?:\.\d+)?%)?/.exec(text);
    if (m && /[+-]\d+(?:\.\d+)?%/.test(text)) return m[2] ? `${m[1]} (${m[2]})` : m[1];
  }
  return null;
}

export function findHud(text) {
  const hud = [];
  for (const [label, re] of [
    ["HP", /\bHP\s*:?\s*(\d{1,4})\b/i],
    ["Shield", /\bShield\s*:?\s*(\d{1,4})\b/i],
    ["Kills", /\bKills?\s*:?\s*(\d{1,4})\b/i],
    ["Deaths", /\bDeaths?\s*:?\s*(\d{1,4})\b/i],
    ["K/D", /\bK\s?[/I]\s?D\s*:?\s*(\d+(?:\.\d+)?)/i],
    ["Eliminations", /\bEliminations?\s*:?\s*(\d{1,4})\b/i],
    ["Level", /\b(?:Level|Lvl|Nivel)\s*:?\s*(\d{1,3})\b/i],
  ]) {
    const m = re.exec(text);
    if (m) hud.push(`${label} ${m[1]}`);
  }
  return hud;
}

// Todas las señales de una pantalla de una vez.
export function detectSignals(lines) {
  const joined = lines.map((l) => l.text).join(" ¶ ");
  const urls = findUrls(lines);
  return {
    joined,
    amounts: findLabeledAmounts(lines),
    spins: findSpins(joined),
    multiplier: findMultiplier(lines),
    scoreLine: findScoreLine(lines),
    clock: findClock(lines),
    odds: findOdds(lines),
    live: /\b(?:live|en vivo|en directo)\b/i.test(joined),
    pair: findTradingPair(joined),
    timeframe: findTimeframe(joined),
    price: findPrice(lines),
    hud: findHud(joined),
    round: /ROUND\s*(\d+)/i.exec(joined)?.[1] ?? null,
    urls,
    files: findFiles(lines),
    editorTitle: findEditorTitle(lines),
    errors: findErrors(lines),
    terminal: findTerminal(lines),
    player: findPlayer(lines),
    stream: findStream(lines),
    channel: findChannel(lines),
    emails: (joined.match(/\[correo\]/g) ?? []).length,
    dateline: /\b\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic|jan|apr|aug|dec)[a-z]*\.?\s+\d{4}\b/i.test(joined),
    prose: lines.filter((l) => l.zone !== "top" && l.text.split(" ").length >= 8).length,
    urlBar: lines.some((l) => l.zone === "top" && /https?:\/\//i.test(l.text)),
    formulas: /=\s?(?:SUM|AVERAGE|IF|VLOOKUP|COUNT|MAX|MIN|PROMEDIO|SUMA|SI)\s?\(/i.test(joined),
  };
}
