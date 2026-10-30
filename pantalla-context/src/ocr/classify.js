import { domainCategories } from "./knowledge.js";
import { labels } from "./labels.js";
import { termHits } from "./signals.js";

// Decide qué actividad hay en la pantalla sumando evidencias y calcula cuánta certeza hay.
//
// Cada evidencia tiene dos números con funciones distintas:
//   points  entra en la puntuación que decide la categoría ganadora;
//   weight  (0..1) es cuánto reduce la duda; la certeza es 1 − Π(1 − weight), es decir, cada señal INDEPENDIENTE
//           que coincide resta duda, pero una sola señal nunca basta para estar seguro.
// Después se descuenta si el OCR leyó con poca confianza o si la segunda opción está cerca.

// Una app o un dominio cuenta mucho si sale en la barra de título o de pestañas y poco si solo se menciona en el cuerpo
// (el título de un vídeo que habla de OBS no significa que estés usando OBS).
const ZONE_WEIGHT = { top: 1, bottom: 0.8, body: 0.35 };

const MODE_CATEGORIES = {
  casino: ["casino"],
  sports: ["sports"],
  gaming: ["video_game"],
  stream: ["streaming"],
  trading: ["trading"],
  video: ["video_media"],
  work: ["documents", "email"],
  coding: ["coding", "terminal"],
  comms: ["chat", "meeting", "email"],
  web: ["browsing", "social"],
};

export const SPORTS = "sports"; // familia que agrupa «apuestas deportivas» y «deporte en directo»

// La mejor coincidencia de un tipo del catálogo: lo que se lee en pantalla antes que la pista del usuario,
// luego las exactas y las de nombre más largo (más específicas).
export function best(matches, type) {
  return (
    matches
      .filter((m) => m.type === type)
      .sort((a, b) => Number(Boolean(a.fromHint)) - Number(Boolean(b.fromHint)) || Number(b.exact) - Number(a.exact) || b.norm.length - a.norm.length)[0] ?? null
  );
}

const cap = (n, max) => Math.min(n, max);

export function classify({ lines, signals, matches, mode, normAll, language, knowledge }) {
  const t = labels(language);
  const evidence = [];
  const add = (category, key, args, points, weight) => evidence.push({ category, key, args, points, weight });

  const catalog = (type) => best(matches, type);
  const appsOf = (category) => matches.filter((m) => m.type === "apps" && m.category === category && !m.fromHint);
  // Mejor zona entre todas las veces que sale la app.
  const zoneWeight = (m) => ZONE_WEIGHT[m.zone ?? "body"];
  const topApp = (category) => appsOf(category).sort((a, b) => zoneWeight(b) - zoneWeight(a))[0] ?? null;

  const addTerms = (category, catKey, maxPts, maxWeight, extra = 0) => {
    const n = cap(termHits(category, normAll) + extra, maxPts);
    if (n > 0) add(category, "terms", [catKey, n], n, Math.min(maxWeight, 0.07 * n));
  };
  const addApp = (category, key, topPts = 4, topWeight = 0.45) => {
    const app = topApp(category);
    if (app) add(category, key, [app.name], topPts * zoneWeight(app), topWeight * zoneWeight(app));
  };

  // ---- casino ----
  // Un nombre leído con poca confianza (línea por debajo de 60) pesa menos: puede ser una coincidencia por casualidad.
  const trust = (m) => (m && (m.fromHint || (m.conf ?? 100) >= 60) ? 1 : 0.7);
  const slot = catalog("slots");
  if (slot) add("casino", slot.fromHint ? "slotHint" : slot.exact ? "slot" : "slotFuzzy", [slot.name], slot.fromHint ? 2 : slot.exact ? 5 : 4, slot.fromHint ? 0.2 : slot.exact ? 0.6 : 0.45);
  const live = catalog("liveGames");
  if (live) {
    const generic = !live.norm.includes(" "); // «Roulette» o «Blackjack» solos son palabras corrientes
    add("casino", live.fromHint ? "slotHint" : "slot", [live.name], generic ? 2 : 4, generic ? 0.2 : live.fromHint ? 0.2 : 0.5);
  }
  const provider = catalog("providers");
  if (provider) add("casino", "provider", [provider.name], 3, 0.35);
  const { balance, bet, win } = signals.amounts;
  if (balance && bet) add("casino", "balanceBet", [], 3, 0.4);
  else if (balance || bet || win) add("casino", "amounts", [], 1, 0.1);
  if (signals.multiplier || signals.spins) add("casino", "multiplierSpins", [], 2, 0.25);
  addTerms("casino", "casino", 6, 0.35);

  // ---- deporte (apuestas y directo) ----
  if (signals.scoreLine) add("sports_live", "scoreLine", [signals.scoreLine.score], 3, 0.35);
  if (signals.clock) add("sports_live", "clock", [signals.clock], 2, 0.25);
  if (matches.filter((m) => m.type === "teams" && !m.fromHint).length >= 2) add("sports_live", "teams", [], 2, 0.25);
  const league = catalog("leagues");
  if (league && !league.fromHint) add("sports_live", "league", [league.name], 2, 0.25);
  const sportsTerms = cap(termHits("sports_live", normAll), 4);
  if (sportsTerms) add("sports_live", "sportsTerms", [sportsTerms], sportsTerms, Math.min(0.2, 0.05 * sportsTerms));
  if (signals.odds.length >= 2) add("sports_betting", "odds", [signals.odds.length], 4, 0.35);
  const bettingTerms = cap(termHits("sports_betting", normAll), 6);
  if (bettingTerms) add("sports_betting", "bettingTerms", [bettingTerms], bettingTerms, Math.min(0.3, 0.06 * bettingTerms));

  // ---- videojuegos ----
  const game = catalog("games");
  if (game) add("video_game", "game", [game.name], (game.exact ? 5 : 4) * trust(game), (game.exact ? 0.55 : 0.4) * trust(game));
  if (signals.hud.length >= 2) add("video_game", "hud", [signals.hud.length], 3, 0.35);
  else if (signals.hud.length === 1) add("video_game", "hud", [1], 1, 0.1);
  addTerms("video_game", "videojuego", 5, 0.3);

  // ---- directos ----
  const platform = catalog("platforms");
  if (platform) add("streaming", "platform", [platform.name], 3 * zoneWeight(platform), 0.3 * zoneWeight(platform));
  if (signals.stream.viewers) add("streaming", "viewersCount", [signals.stream.viewers], 3, 0.35);
  if (signals.stream.streamer) add("streaming", "terms", ["directo", 1], 2, 0.2);
  addApp("streaming", "streamApp", 3, 0.3);
  addTerms("streaming", "directo", 5, 0.3);

  // ---- vídeo ----
  if (signals.player.time) add("video_media", "playerTime", [`${signals.player.time.current} / ${signals.player.time.total}`], 5, 0.45);
  if (signals.player.views) add("video_media", "views", [], 2, 0.25);
  addApp("video_media", "platform", 3, 0.3);
  addTerms("video_media", "vídeo", 4, 0.25);

  // ---- trading ----
  if (signals.pair) add("trading", "pair", [signals.pair], 4, 0.4);
  if (["open", "high", "low", "close"].filter((w) => new RegExp(`\\b${w}\\b`, "i").test(signals.joined)).length >= 3) add("trading", "ohlc", [], 3, 0.3);
  if (/\b(?:RSI|MACD|EMA|SMA|MA\(\d+\))\b/.test(signals.joined)) add("trading", "indicators", [], 2, 0.2);
  if (matches.some((m) => m.type === "assets" && !m.fromHint)) add("trading", "terms", ["trading", 1], 1, 0.07);

  // ---- programación y terminal ----
  if (signals.editorTitle) add("coding", "editorTitle", [signals.editorTitle.file], 6, 0.6);
  addApp("coding", "editorApp", 4, 0.45);
  const codeFiles = signals.files.code.length;
  if (codeFiles) add("coding", "codeFiles", [codeFiles], cap(codeFiles * 1.5, 3), Math.min(0.3, 0.12 * codeFiles));
  const syntaxLines = lines.filter((l) => /[{};]\s*$|=>|\)\s*;?$/.test(l.text)).length;
  addTerms("coding", "código", 6, 0.35, syntaxLines >= 2 ? Math.min(syntaxLines, 3) : 0);
  if (signals.errors.error || signals.errors.stack) add("coding", "errors", [], signals.errors.stack ? 3 : 2, 0.2);
  if (signals.terminal.prompt) add("terminal", "prompt", [], 6, 0.55);
  if (signals.terminal.command) add("terminal", "commands", [], 2, 0.25);
  if (signals.terminal.tests) add("terminal", "tests", [], 2, 0.2);
  addApp("terminal", "terminalApp", 3, 0.3);
  if (signals.terminal.prompt) addTerms("terminal", "terminal", 3, 0.15);

  // ---- documentos ----
  addApp("documents", "docApp", 4, 0.45);
  if (signals.files.docs.length) add("documents", "docFile", [signals.files.docs[0].name], 3, 0.3);
  if (signals.formulas) add("documents", "formulas", [], 3, 0.3);
  addTerms("documents", "documentos", 4, 0.25);

  // ---- correo, chat, reuniones ----
  addApp("email", "mailApp", 4, 0.4);
  const mailTerms = cap(termHits("email", normAll), 5);
  if (mailTerms) add("email", "mailTerms", [mailTerms], mailTerms, Math.min(0.4, 0.1 * mailTerms));
  if (signals.emails >= 2) add("email", "terms", ["correo", signals.emails], 2, 0.2);
  addApp("chat", "chatApp", 4, 0.4);
  if (signals.channel) add("chat", "channel", [signals.channel], 3, 0.3);
  if (lines.filter((l) => /\b(?:hoy|today|ayer|yesterday)\b[^¶]{0,10}\d{1,2}:\d{2}/i.test(l.text)).length >= 2) add("chat", "chatTerms", [2], 3, 0.3);
  addTerms("chat", "chat", 3, 0.25);
  addApp("meeting", "meetingApp", 4, 0.4);
  const controls = cap(termHits("meeting", normAll), 6);
  if (controls) add("meeting", "meetingControls", [controls], controls, Math.min(0.45, 0.1 * controls));

  // ---- navegación y redes ----
  const topUrl = signals.urls.find((u) => u.zone === "top") ?? null;
  if (topUrl) add("browsing", "url", [topUrl.host], 3, 0.3);
  else if (signals.urlBar) add("browsing", "url", ["http(s)://"], 2, 0.15); // la barra se ve pero el OCR no la leyó entera
  if (signals.dateline) add("browsing", "newsTerms", [1], 2, 0.2);
  addApp("browsing", "platform", 1, 0.1); // el nombre del navegador en la barra de título: indicio débil
  addTerms("browsing", "web", 4, 0.25);
  addApp("social", "socialApp", 4, 0.4);
  addTerms("social", "redes sociales", 4, 0.25);

  // ---- pistas por dominio (stake.com -> casino, github.com -> programación...) ----
  for (const url of signals.urls) {
    const categories = domainCategories(url.host, knowledge?.domains);
    const w = ZONE_WEIGHT[url.zone ?? "body"];
    for (const category of categories) {
      const target = category === "sports_betting" ? "sports_betting" : category;
      add(target, "domain", [url.host], (3 * w) / categories.length + 0.5 * w, (0.3 * w) / Math.sqrt(categories.length));
    }
  }

  // ---- ¿es un artículo? ----
  // Una reseña de «Sweet Bonanza» o la crónica de un Real Madrid–City contienen los mismos nombres que la pantalla real.
  // Un nombre solo cuenta del todo si lo acompaña la interfaz propia de esa actividad (saldo y apuesta, cuotas, vida y kills...).
  // Si lo que hay son párrafos de texto corrido con fecha o dirección web, esos nombres pesan mucho menos.
  const articleLike = signals.prose >= 2 && (Boolean(topUrl) || signals.urlBar || signals.dateline);
  if (articleLike) {
    const structural = {
      casino: Boolean((balance && bet) || signals.spins || signals.multiplier),
      sports_live: signals.odds.length >= 2,
      sports_betting: signals.odds.length >= 2,
      video_game: signals.hud.length >= 2,
      trading: Boolean(signals.pair && (signals.price || signals.joined.match(/\bclose\b/i))),
    };
    const nameBased = new Set(["slot", "slotFuzzy", "slotHint", "provider", "scoreLine", "clock", "teams", "league", "sportsTerms", "game", "bettingTerms", "terms", "pair"]);
    for (const e of evidence) {
      if (e.category in structural && !structural[e.category] && nameBased.has(e.key)) {
        e.points *= 0.4;
        e.weight *= 0.4;
      }
    }
    add("browsing", "prose", [], 4, 0.3);
  }

  // ---- el tipo elegido por el usuario desempata ----
  for (const category of MODE_CATEGORIES[mode] ?? []) {
    if (category === SPORTS) {
      add("sports_live", "mode", [], 3, 0);
    } else add(category, "mode", [], 3, 0);
  }

  // ---- puntuación ----
  const points = {};
  for (const e of evidence) points[e.category] = (points[e.category] ?? 0) + e.points;
  // Partido en directo y casa de apuestas son una misma familia: compiten juntas con el resto.
  const family = (points.sports_live ?? 0) + (points.sports_betting ?? 0);
  const scores = Object.fromEntries(Object.entries(points).filter(([c]) => c !== "sports_live" && c !== "sports_betting"));
  if (family > 0) scores[SPORTS] = family;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topName = "other", topScore = 0] = ranked[0] ?? [];
  const margin = topScore - (ranked[1]?.[1] ?? 0);
  let category = topScore < 3 ? "other" : topName;
  if (category === SPORTS) {
    // Con cuotas o vocabulario de apuestas es «apuestas deportivas»; si no, «deporte».
    const betting = evidence.filter((e) => e.category === "sports_betting");
    const bettingPts = betting.reduce((n, e) => n + e.points, 0);
    category = bettingPts >= 3 || betting.some((e) => e.key === "domain") ? "sports_betting" : "sports_live";
  }

  // ---- certeza ----
  const mine = evidence.filter((e) => (category === "sports_live" || category === "sports_betting" ? e.category.startsWith("sports") : e.category === category) && e.weight > 0);
  const doubt = mine.reduce((d, e) => d * (1 - e.weight), 1);
  const textual = lines.filter((l) => (l.text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 3);
  const chars = textual.reduce((n, l) => n + l.text.length, 0) || 1;
  const meanConf = textual.reduce((n, l) => n + l.confidence * l.text.length, 0) / chars;
  const ocrFactor = 0.6 + 0.4 * Math.min(1, Math.max(0, (meanConf - 40) / 55));
  const marginFactor = margin >= 3 ? 1 : 0.8; // otra actividad casi igual de probable: menos seguro
  const certainty = category === "other" ? Math.min(0.3, (1 - doubt) * ocrFactor) : (1 - doubt) * ocrFactor * marginFactor;

  const reasons = [...mine]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
    .map((e) => (e.key === "terms" ? t.reason.terms(...e.args) : t.reason[e.key](...e.args)));

  return {
    category,
    ranking: ranked.slice(0, 3).map(([name, pts]) => ({ category: name, points: Math.round(pts * 10) / 10 })),
    topScore,
    margin,
    certainty: Math.round(certainty * 100) / 100,
    reasons,
    evidence,
  };
}
