// Perfiles de análisis: cada modo le dice al modelo en qué fijarse.
// El id "auto" deja que el modelo detecte el tipo de contenido por sí solo.

export const MODES = {
  auto: {
    label: "Automático",
    focus:
      "Detect what kind of content this is (casino, sports betting, video game, stream, trading chart, video, work app, social media...) and follow the matching rules below.",
  },
  casino: {
    label: "Casino / slots",
    focus:
      "Online casino content. Identify the exact game (slot title, roulette, blackjack, crash, live-dealer show...) and its provider if visible. Capture the round state: bet amount, balance, last win, multipliers, free spins / bonus features, table limits, dealer or table name. Say whether the round is idle, spinning, in a bonus or showing a result.",
  },
  sports: {
    label: "Apuestas deportivas / partido",
    focus:
      "Sports betting site or live match. Identify the sport, league and the match (teams or players), the score, the clock or period, and what is happening in play. If a bet slip or odds board is visible, capture the market and odds shown (as displayed). Distinguish the match being watched from other matches listed on the page.",
  },
  gaming: {
    label: "Videojuego",
    focus:
      "Video game footage. Identify the game title (from HUD, logos, menus), mode/map/level, the player's current objective or situation, and key HUD values (health, score, kills, timer, rank). Say what moment this is: lobby, combat, cutscene, victory screen, loading...",
  },
  stream: {
    label: "Stream / directo",
    focus:
      "A streaming platform page (Twitch, Kick, YouTube Live...). Identify the channel, the stream title, the category and what the streamer is doing on screen, plus viewer count and the topic of the chat if visible. Describe the underlying content too (a game, a casino session, a match...).",
  },
  trading: {
    label: "Trading / gráficos",
    focus:
      "Financial charts or trading interface. Identify the asset or pair, the timeframe, the visible price level and the recent movement shown on the chart, plus any open orders or positions visible. Describe only what is displayed; never give financial advice or predictions.",
  },
  video: {
    label: "Vídeo / película / serie",
    focus:
      "Video or media player. Identify the title, platform, episode or scene if shown, and what is happening on screen. Read subtitles or captions if present.",
  },
  work: {
    label: "Documentos y diseño",
    focus:
      "A document, spreadsheet, presentation, design or note-taking app. Identify the app, the file or document in view and the task the person seems to be doing (writing, calculating, designing...).",
  },
  coding: {
    label: "Programación / terminal",
    focus:
      "A code editor, IDE or terminal. Identify the editor, the file and language in view, the project, any visible error or stack trace, and the command or test run in the terminal with its result.",
  },
  comms: {
    label: "Chats, correo y reuniones",
    focus:
      "A messaging app, email client or video call. Identify the app and what the person is doing (reading mail, chatting in a channel, in a meeting). Do not transcribe private messages, subjects or participant names.",
  },
  web: {
    label: "Navegación web",
    focus:
      "A web page. Identify the site (domain), the page or headline in view and the kind of content (news, shop, social network, documentation...).",
  },
  generic: {
    label: "General",
    focus:
      "Describe the main subject of the screenshot and what is happening, without assuming a particular domain.",
  },
};

export const MODE_IDS = Object.keys(MODES);

export const LANGUAGES = {
  es: "Spanish",
  en: "English",
};

export const CATEGORIES = [
  "casino",
  "sports_betting",
  "sports_live",
  "video_game",
  "streaming",
  "trading",
  "video_media",
  "coding",
  "terminal",
  "documents",
  "email",
  "chat",
  "meeting",
  "browsing",
  "social",
  "other",
];

// Contenido que suele ser privado: de él no se exporta el texto leído, solo lo que se está haciendo.
export const PRIVATE_CATEGORIES = ["email", "chat", "meeting"];
