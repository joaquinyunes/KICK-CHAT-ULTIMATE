import { readFileSync } from "node:fs";
import { CATEGORIES } from "../modes.js";

const CATEGORIES_SET = new Set(CATEGORIES);

// Catálogo de nombres que el analizador sin modelo sabe reconocer en el texto de la pantalla.
// No es exhaustivo: amplíalo con tu propio JSON (PANTALLA_KNOWLEDGE_FILE) con las mismas claves.
// Se evitan a propósito nombres demasiado genéricos («Dice», «Crash», «Mines»…) que darían falsos positivos.
export const DEFAULT_KNOWLEDGE = {
  slots: [
    "Sweet Bonanza", "Sugar Rush", "Gates of Olympus", "Starlight Princess", "Big Bass Bonanza", "Big Bass Splash",
    "The Dog House", "The Dog House Megaways", "Wolf Gold", "Fruit Party", "Great Rhino Megaways", "Madame Destiny Megaways",
    "Book of Dead", "Reactoonz", "Gonzo's Quest", "Starburst", "Dead or Alive 2", "Wanted Dead or a Wild", "Razor Shark",
    "Mental", "San Quentin", "Tombstone RIP", "Fire in the Hole", "Money Train 2", "Money Train 3", "Chaos Crew",
    "Le Bandit", "Hand of Anubis", "Rise of Giza", "Mega Moolah", "Bonanza", "Buffalo King Megaways", "John Hunter and the Tomb of the Scarab Queen",
    "Aviator", "Plinko", "Zeppelin", "Gates of Hades", "Zeus vs Hades", "Cleocatra", "Rich Wilde and the Book of Dead",
  ],
  liveGames: [
    "Crazy Time", "Lightning Roulette", "Lightning Dice", "Mega Ball", "Monopoly Live", "Dream Catcher", "Funky Time",
    "Football Studio", "Immersive Roulette", "Speed Baccarat", "Lightning Baccarat", "Infinite Blackjack", "Gonzo's Treasure Hunt",
    "Sweet Bonanza CandyLand", "Deal or No Deal", "Cash or Crash", "Roulette", "Blackjack", "Baccarat", "Ruleta", "Poker",
  ],
  providers: [
    "Pragmatic Play", "Evolution", "Evolution Gaming", "Hacksaw Gaming", "Play'n GO", "NetEnt", "Nolimit City", "Push Gaming",
    "Relax Gaming", "Red Tiger", "BGaming", "Spribe", "Playtech", "Microgaming", "Yggdrasil", "Big Time Gaming", "Blueprint Gaming",
    "Thunderkick", "ELK Studios", "Quickspin", "Habanero", "Wazdan", "Endorphina", "PG Soft", "Games Global", "Stakelogic", "Ezugi",
  ],
  sites: [
    "Stake", "Bet365", "1xBet", "Betano", "Codere", "Bwin", "Rivalo", "Betsson", "William Hill", "DraftKings", "FanDuel",
    "Caliente", "Betway", "Pinnacle", "Bovada", "Unibet", "888casino", "LeoVegas", "Rollbet", "Roobet", "Duelbits", "BC.Game",
    "Bodog", "Sportium", "Luckia", "Winamax", "PokerStars", "Betfair", "Playdoit", "Wplay", "Rushbet", "Bplay", "Betcris",
  ],
  leagues: [
    "UEFA Champions League", "Champions League", "Europa League", "Conference League", "LaLiga", "La Liga", "Premier League",
    "Serie A", "Bundesliga", "Ligue 1", "Copa Libertadores", "Copa Sudamericana", "Copa del Rey", "FA Cup", "Liga MX", "MLS",
    "Liga Profesional", "Brasileirao", "Eredivisie", "Primeira Liga", "Copa America", "Eurocopa", "Mundial", "World Cup",
    "NBA", "NFL", "MLB", "NHL", "EuroLeague", "UFC", "ATP", "WTA", "Roland Garros", "Wimbledon", "US Open", "Formula 1", "MotoGP",
  ],
  teams: [
    "Real Madrid", "FC Barcelona", "Barcelona", "Atletico Madrid", "Sevilla", "Valencia", "Real Sociedad", "Athletic Club", "Villarreal", "Real Betis",
    "Manchester City", "Manchester United", "Liverpool", "Arsenal", "Chelsea", "Tottenham", "Newcastle", "Aston Villa", "West Ham",
    "Bayern Munich", "Borussia Dortmund", "RB Leipzig", "Bayer Leverkusen", "Paris Saint-Germain", "PSG", "Marseille", "Lyon", "Monaco",
    "Juventus", "Inter", "AC Milan", "Napoli", "Roma", "Lazio", "Atalanta", "Benfica", "Porto", "Sporting CP", "Ajax", "PSV",
    "Boca Juniors", "River Plate", "Racing Club", "Independiente", "San Lorenzo", "Flamengo", "Palmeiras", "Corinthians", "Santos", "Sao Paulo",
    "America", "Chivas", "Cruz Azul", "Pumas", "Tigres", "Monterrey", "Club America", "Nacional", "Penarol", "Colo-Colo", "Millonarios",
    "Los Angeles Lakers", "Boston Celtics", "Golden State Warriors", "Miami Heat", "Chicago Bulls", "Dallas Mavericks", "Denver Nuggets",
    "Kansas City Chiefs", "Dallas Cowboys", "New England Patriots", "Philadelphia Eagles", "San Francisco 49ers",
    "Argentina", "Brasil", "Brazil", "Espana", "Spain", "Francia", "France", "Alemania", "Germany", "Inglaterra", "England", "Portugal", "Mexico", "Colombia", "Uruguay",
  ],
  games: [
    "Valorant", "League of Legends", "Counter-Strike", "Counter-Strike 2", "CS2", "Dota 2", "Fortnite", "Minecraft", "Roblox", "Apex Legends",
    "Call of Duty", "Warzone", "Overwatch 2", "Rocket League", "Rainbow Six Siege", "PUBG", "Free Fire", "Genshin Impact", "Elden Ring",
    "Grand Theft Auto", "GTA V", "GTA Online", "Red Dead Redemption 2", "Cyberpunk 2077", "The Witcher 3", "Hogwarts Legacy", "Baldur's Gate 3",
    "Diablo IV", "World of Warcraft", "Path of Exile", "Lost Ark", "Destiny 2", "Escape from Tarkov", "Rust", "DayZ", "ARK", "Palworld",
    "EA Sports FC", "EA FC 25", "FIFA 23", "eFootball", "NBA 2K", "Madden NFL", "Mortal Kombat", "Street Fighter 6", "Tekken 8", "Hearthstone",
    "Among Us", "Fall Guys", "Hades", "Hollow Knight", "Zelda", "Mario Kart", "Super Smash Bros", "Pokemon", "Stardew Valley", "Terraria", "Chess.com",
  ],
  platforms: ["Twitch", "Kick", "Facebook Gaming", "YouTube Gaming", "TikTok Live"],
  // Aplicaciones con la actividad que suponen. Una cadena suelta (en tu JSON) se trata como «documents».
  apps: [
    ...["Visual Studio Code", "VS Code", "Visual Studio", "IntelliJ IDEA", "PyCharm", "WebStorm", "Android Studio", "Sublime Text", "Neovim", "Xcode", "Cursor"].map((name) => ({ name, category: "coding" })),
    ...["Windows Terminal", "PowerShell", "Command Prompt", "iTerm2", "Konsole", "Alacritty"].map((name) => ({ name, category: "terminal" })),
    ...["Excel", "Microsoft Excel", "Microsoft Word", "PowerPoint", "Google Docs", "Google Sheets", "Google Slides", "Notion", "Obsidian", "Figma", "Photoshop", "Illustrator", "Canva", "Premiere Pro", "DaVinci Resolve", "LibreOffice", "Keynote", "Acrobat", "Blender"].map((name) => ({ name, category: "documents" })),
    ...["Gmail", "Outlook", "Thunderbird", "Proton Mail", "Yahoo Mail"].map((name) => ({ name, category: "email" })),
    ...["Discord", "Slack", "WhatsApp", "Telegram", "Messenger", "Signal", "Skype"].map((name) => ({ name, category: "chat" })),
    ...["Zoom", "Google Meet", "Microsoft Teams", "Webex", "Jitsi"].map((name) => ({ name, category: "meeting" })),
    ...["OBS Studio", "Streamlabs"].map((name) => ({ name, category: "streaming" })),
    ...["YouTube", "Netflix", "Disney+", "Prime Video", "HBO Max", "Spotify", "Vimeo", "Crunchyroll", "Apple Music"].map((name) => ({ name, category: "video_media" })),
    ...["Instagram", "TikTok", "Twitter", "Facebook", "Reddit", "LinkedIn", "Pinterest"].map((name) => ({ name, category: "social" })),
    ...["Google Chrome", "Mozilla Firefox", "Microsoft Edge", "Safari", "Brave"].map((name) => ({ name, category: "browsing" })),
  ],
  assets: ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "USDT", "EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "S&P 500", "NASDAQ", "Dow Jones", "TSLA", "AAPL", "NVDA"],
};

export const KNOWLEDGE_KEYS = Object.keys(DEFAULT_KNOWLEDGE);

// Qué actividad suele haber detrás de un sitio web. Clave: el nombre principal del dominio («stake» para stake.com,
// stake.bet...) o el host completo para subdominios («mail.google.com»). Si es ambiguo (casas con casino y apuestas),
// se lista más de una categoría y la pantalla decide.
export const DOMAIN_HINTS = {
  stake: ["casino", "sports_betting"], roobet: ["casino"], duelbits: ["casino"], rollbit: ["casino"], "bc.game": ["casino"], "888casino": ["casino"], leovegas: ["casino", "sports_betting"],
  bet365: ["sports_betting", "casino"], "1xbet": ["sports_betting", "casino"], betano: ["sports_betting", "casino"], codere: ["sports_betting", "casino"], bwin: ["sports_betting", "casino"],
  williamhill: ["sports_betting"], draftkings: ["sports_betting"], fanduel: ["sports_betting"], caliente: ["sports_betting"], betway: ["sports_betting", "casino"], pinnacle: ["sports_betting"],
  bovada: ["sports_betting", "casino"], unibet: ["sports_betting", "casino"], sportium: ["sports_betting"], luckia: ["sports_betting", "casino"], winamax: ["sports_betting"], betfair: ["sports_betting"],
  betsson: ["sports_betting", "casino"], wplay: ["sports_betting"], rushbet: ["sports_betting"], betcris: ["sports_betting"],
  twitch: ["streaming"], kick: ["streaming"],
  youtube: ["video_media"], youtu: ["video_media"], netflix: ["video_media"], disneyplus: ["video_media"], primevideo: ["video_media"], hbomax: ["video_media"], vimeo: ["video_media"], crunchyroll: ["video_media"], spotify: ["video_media"],
  github: ["coding"], gitlab: ["coding"], stackoverflow: ["coding"], npmjs: ["coding"], localhost: ["coding"], codepen: ["coding"], replit: ["coding"],
  tradingview: ["trading"], binance: ["trading"], coinbase: ["trading"], kraken: ["trading"], bybit: ["trading"], investing: ["trading"],
  "mail.google.com": ["email"], "outlook.live.com": ["email"], "outlook.office.com": ["email"], protonmail: ["email"],
  "docs.google.com": ["documents"], "sheets.google.com": ["documents"], "drive.google.com": ["documents"], notion: ["documents"], figma: ["documents"], canva: ["documents"],
  discord: ["chat"], "web.whatsapp.com": ["chat"], "web.telegram.org": ["chat"], "app.slack.com": ["chat"], messenger: ["chat"],
  "meet.google.com": ["meeting"], zoom: ["meeting"], "teams.microsoft.com": ["meeting"], webex: ["meeting"],
  instagram: ["social"], tiktok: ["social"], x: ["social"], twitter: ["social"], facebook: ["social"], reddit: ["social"], linkedin: ["social"],
};

// Categorías asociadas a un host («www.stake.com» -> ["casino", "sports_betting"]), o [] si no se conoce.
// `extra` es el mapa propio del usuario (knowledge.domains): «mi-casino.com»: «casino».
export function domainCategories(host, extra = {}) {
  const h = host.toLowerCase().replace(/^www\./, "");
  const own = extra[h] ?? extra[h.split(".").slice(-2).join(".")];
  if (own) return [own].flat();
  if (DOMAIN_HINTS[h]) return DOMAIN_HINTS[h];
  const parts = h.split(".");
  // «sub.stake.com» -> «stake»; «stake.com.mx» -> «stake»; «bc.game» se busca completo arriba.
  for (let i = parts.length - 2; i >= 0; i--) if (DOMAIN_HINTS[parts[i]]) return DOMAIN_HINTS[parts[i]];
  return [];
}

// Quita acentos, símbolos y mayúsculas: «Gonzo's Quest» y «GONZOS QUEST» pasan a ser iguales.
export function normalizeText(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const VALID_APP_CATEGORIES = new Set(["coding", "terminal", "documents", "email", "chat", "meeting", "streaming", "video_media", "social", "browsing"]);

// Une el catálogo por defecto con el del usuario. Ignora claves desconocidas y valores que no sean válidos.
// `apps` admite cadenas (categoría «documents») u objetos { name, category }; `domains` es un mapa host -> categoría.
export function mergeKnowledge(extra = {}) {
  const merged = Object.fromEntries(KNOWLEDGE_KEYS.map((key) => [key, [...DEFAULT_KNOWLEDGE[key]]]));
  for (const key of KNOWLEDGE_KEYS) {
    const list = extra?.[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (key === "apps") {
        const app = typeof item === "string" ? { name: item.trim(), category: "documents" } : { name: String(item?.name ?? "").trim(), category: item?.category };
        if (app.name.length >= 2 && VALID_APP_CATEGORIES.has(app.category)) merged.apps.push(app);
      } else if (typeof item === "string" && item.trim().length >= 2) {
        merged[key].push(item.trim());
      }
    }
  }
  merged.domains = {};
  if (extra?.domains && typeof extra.domains === "object" && !Array.isArray(extra.domains)) {
    for (const [host, category] of Object.entries(extra.domains)) {
      if (typeof host === "string" && CATEGORIES_SET.has(category)) merged.domains[host.toLowerCase()] = category;
    }
  }
  return merged;
}

export function loadKnowledge(file = null) {
  if (!file) return mergeKnowledge();
  try {
    return mergeKnowledge(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    throw new Error(`No se pudo leer PANTALLA_KNOWLEDGE_FILE (${file}): ${err.message}`);
  }
}

// Distancia de edición con salida temprana: solo interesa saber si es menor o igual que `max`.
export function editDistanceWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

export function buildIndex(knowledge) {
  const entries = [];
  const seen = new Set();
  for (const key of KNOWLEDGE_KEYS) {
    for (const item of knowledge[key] ?? []) {
      const name = typeof item === "string" ? item : item.name;
      const norm = normalizeText(name);
      const id = `${key}:${norm}`;
      if (norm.length < 2 || seen.has(id)) continue;
      seen.add(id);
      entries.push({ type: key, name, norm, words: norm.split(" "), ...(typeof item === "object" ? { category: item.category } : {}) });
    }
  }
  return entries;
}

// Busca los nombres del catálogo en una línea de texto. Coincidencia exacta por palabras completas, o aproximada
// (1–2 letras de diferencia) para nombres largos, que es lo que suele fallar un OCR («SWEET BONANZ4»).
export function findNamesInLine(index, line) {
  const norm = normalizeText(line);
  if (!norm) return [];
  const padded = ` ${norm} `;
  const tokens = norm.split(" ");
  const found = [];
  for (const entry of index) {
    if (padded.includes(` ${entry.norm} `)) {
      found.push({ ...entry, exact: true });
      continue;
    }
    if (entry.norm.length < 8) continue;
    const tolerance = entry.norm.length >= 12 ? 2 : 1;
    const size = entry.words.length;
    for (let i = 0; i + size <= tokens.length; i++) {
      if (editDistanceWithin(tokens.slice(i, i + size).join(" "), entry.norm, tolerance) <= tolerance) {
        found.push({ ...entry, exact: false });
        break;
      }
    }
  }
  // Si un nombre contiene a otro («Champions League» dentro de «UEFA Champions League»), nos quedamos con el largo.
  return found.filter((a) => !found.some((b) => b !== a && b.type === a.type && b.norm.length > a.norm.length && b.norm.includes(a.norm)));
}
