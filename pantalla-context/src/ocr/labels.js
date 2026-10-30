// Textos del analizador sin modelo, en español e inglés. Todo lo que ve el usuario sale de aquí.

const es = {
  cat: {
    casino: "Casino", sports_betting: "Apuestas deportivas", sports_live: "Deporte", video_game: "Videojuego", streaming: "Directo", trading: "Trading",
    video_media: "Viendo", coding: "Programando", terminal: "Terminal", documents: "Documento", email: "Correo", chat: "Chat", meeting: "Reunión",
    browsing: "Navegando", social: "Redes sociales", other: "Pantalla",
  },
  e: {
    game: "Juego", provider: "Proveedor", site: "Sitio", league: "Competición", match: "Partido", score: "Marcador", clock: "Minuto", period: "Periodo",
    odds: "Cuotas", balance: "Saldo", bet: "Apuesta", win: "Ganancia", spins: "Giros gratis", multiplier: "Multiplicador", pair: "Par", price: "Precio",
    timeframe: "Temporalidad", round: "Ronda", platform: "Plataforma", app: "App", viewers: "Espectadores", hint: "Pista", file: "Archivo", language: "Lenguaje",
    project: "Proyecto", error: "Error", command: "Comando", result: "Resultado", folder: "Vista", channel: "Canal", page: "Página", progress: "Progreso",
    views: "Vistas", kind: "Tipo", streamer: "Canal", section: "Sección", meeting: "Reunión", url: "Dirección",
  },
  live: "En directo",
  unknownGame: "juego sin identificar",
  detected: "Texto detectado",
  noText: "No se detectó texto legible en la zona.",
  note: {
    onlyText: "Análisis solo por texto (OCR): no interpreta imágenes, solo lo que está escrito.",
    deduced: "El nombre se dedujo del texto más grande; no está en el catálogo.",
    lowOcr: "El OCR leyó con poca seguridad: puede haber errores.",
    fromHint: "Algún nombre se tomó de tu pista, no de la pantalla.",
    privateText: "El texto leído se omite por privacidad (correo, chat o reunión): solo se indica qué estás haciendo.",
    enhanced: "Se leyó con un segundo paso para texto claro sobre fondo claro; puede haber errores.",
  },
  before: "Antes",
  kinds: { spreadsheet: "hoja de cálculo", document: "documento", presentation: "presentación", design: "diseño", videoEditing: "edición de vídeo", notes: "notas", pdf: "PDF" },
  act: {
    editing: "editando código", debugging: "con un error a la vista", running: "ejecutando comandos", news: "leyendo", chatting: "conversando", meeting: "en una videollamada",
    mail: "revisando el correo", video: "viendo un vídeo", stream: "viendo un directo", betting: "con una apuesta en curso", live: "partido en directo",
  },
  tests: (p, f, total) => `${total} pruebas: ${p} pasan, ${f} fallan`,
  reason: {
    slot: (n) => `Juego del catálogo: ${n}`, slotFuzzy: (n) => `Juego del catálogo (con una letra distinta): ${n}`, slotHint: (n) => `Juego tomado de tu pista: ${n}`,
    provider: (n) => `Proveedor del catálogo: ${n}`, balanceBet: () => "Saldo y apuesta visibles", amounts: () => "Importes con etiqueta (saldo, apuesta o ganancia)",
    multiplierSpins: () => "Multiplicador o giros gratis", scoreLine: (s) => `Marcador en la pantalla: ${s}`, clock: (c) => `Minuto o periodo: ${c}`, teams: () => "Dos equipos del catálogo",
    league: (n) => `Competición del catálogo: ${n}`, odds: (n) => `${n} cuotas visibles`, bettingTerms: (n) => `${n} términos de apuestas`, sportsTerms: (n) => `${n} términos deportivos`,
    game: (n) => `Videojuego del catálogo: ${n}`, hud: (n) => `${n} datos de HUD (vida, kills...)`, pair: (p) => `Par de trading: ${p}`, ohlc: () => "Apertura, máximo, mínimo y cierre",
    indicators: () => "Indicadores (RSI, MACD, medias)", editorTitle: (f) => `Barra del editor con el archivo ${f}`, editorApp: (n) => `Editor de código: ${n}`, codeFiles: (n) => `${n} archivos de código`,
    codeTokens: (n) => `${n} palabras clave de código`, errors: () => "Mensaje de error o traza visible", prompt: () => "Línea de comandos con prompt", commands: () => "Comandos de terminal",
    tests: () => "Resultado de pruebas", terminalApp: (n) => `Terminal: ${n}`, docApp: (n) => `Aplicación de documentos: ${n}`, docFile: (f) => `Archivo de documento: ${f}`,
    formulas: () => "Fórmulas de hoja de cálculo", mailApp: (n) => `Cliente de correo: ${n}`, mailTerms: (n) => `${n} términos de correo`, chatApp: (n) => `Aplicación de chat: ${n}`,
    channel: (c) => `Canal: #${c}`, chatTerms: (n) => `${n} términos de chat`, meetingApp: (n) => `Videollamada: ${n}`, meetingControls: (n) => `${n} controles de videollamada`,
    url: (d) => `Dirección web: ${d}`, newsTerms: (n) => `${n} términos de prensa o web`, prose: () => "Párrafos de texto corrido, como un artículo", playerTime: (t) => `Reproductor con tiempo ${t}`, views: () => "Contador de vistas",
    platform: (n) => `Plataforma: ${n}`, viewersCount: (n) => `${n} espectadores`, streamApp: (n) => `Herramienta de directo: ${n}`, socialApp: (n) => `Red social: ${n}`,
    terms: (cat, n) => `${n} palabras típicas de ${cat}`, mode: () => "Tipo de contenido elegido por ti", domain: (d) => `El sitio ${d} suele ser de este tipo`,
  },
};

const en = {
  cat: {
    casino: "Casino", sports_betting: "Sports betting", sports_live: "Sports", video_game: "Video game", streaming: "Live stream", trading: "Trading",
    video_media: "Watching", coding: "Coding", terminal: "Terminal", documents: "Document", email: "Email", chat: "Chat", meeting: "Meeting",
    browsing: "Browsing", social: "Social media", other: "Screen",
  },
  e: {
    game: "Game", provider: "Provider", site: "Site", league: "Competition", match: "Match", score: "Score", clock: "Minute", period: "Period",
    odds: "Odds", balance: "Balance", bet: "Bet", win: "Win", spins: "Free spins", multiplier: "Multiplier", pair: "Pair", price: "Price",
    timeframe: "Timeframe", round: "Round", platform: "Platform", app: "App", viewers: "Viewers", hint: "Hint", file: "File", language: "Language",
    project: "Project", error: "Error", command: "Command", result: "Result", folder: "View", channel: "Channel", page: "Page", progress: "Progress",
    views: "Views", kind: "Type", streamer: "Channel", section: "Section", meeting: "Meeting", url: "Address",
  },
  live: "Live",
  unknownGame: "unidentified game",
  detected: "Detected text",
  noText: "No readable text was detected in the area.",
  note: {
    onlyText: "Text-only analysis (OCR): it does not interpret images, only what is written.",
    deduced: "The name was deduced from the largest text; it is not in the catalog.",
    lowOcr: "The OCR read with low confidence: there may be errors.",
    fromHint: "Some name was taken from your hint, not from the screen.",
    privateText: "The text read is omitted for privacy (email, chat or meeting): only what you are doing is reported.",
    enhanced: "Read with a second pass for light text on light backgrounds; there may be errors.",
  },
  before: "Before",
  kinds: { spreadsheet: "spreadsheet", document: "document", presentation: "presentation", design: "design", videoEditing: "video editing", notes: "notes", pdf: "PDF" },
  act: {
    editing: "editing code", debugging: "with an error in view", running: "running commands", news: "reading", chatting: "chatting", meeting: "in a video call",
    mail: "checking email", video: "watching a video", stream: "watching a live stream", betting: "with a bet in progress", live: "live match",
  },
  tests: (p, f, total) => `${total} tests: ${p} pass, ${f} fail`,
  reason: {
    slot: (n) => `Game from the catalog: ${n}`, slotFuzzy: (n) => `Game from the catalog (one letter off): ${n}`, slotHint: (n) => `Game taken from your hint: ${n}`,
    provider: (n) => `Provider from the catalog: ${n}`, balanceBet: () => "Balance and bet visible", amounts: () => "Labeled amounts (balance, bet or win)",
    multiplierSpins: () => "Multiplier or free spins", scoreLine: (s) => `Score on screen: ${s}`, clock: (c) => `Minute or period: ${c}`, teams: () => "Two teams from the catalog",
    league: (n) => `Competition from the catalog: ${n}`, odds: (n) => `${n} odds visible`, bettingTerms: (n) => `${n} betting terms`, sportsTerms: (n) => `${n} sports terms`,
    game: (n) => `Video game from the catalog: ${n}`, hud: (n) => `${n} HUD values (health, kills...)`, pair: (p) => `Trading pair: ${p}`, ohlc: () => "Open, high, low and close",
    indicators: () => "Indicators (RSI, MACD, averages)", editorTitle: (f) => `Editor title bar with file ${f}`, editorApp: (n) => `Code editor: ${n}`, codeFiles: (n) => `${n} code files`,
    codeTokens: (n) => `${n} code keywords`, errors: () => "Error message or stack trace visible", prompt: () => "Command line with a prompt", commands: () => "Terminal commands",
    tests: () => "Test results", terminalApp: (n) => `Terminal: ${n}`, docApp: (n) => `Document app: ${n}`, docFile: (f) => `Document file: ${f}`,
    formulas: () => "Spreadsheet formulas", mailApp: (n) => `Email client: ${n}`, mailTerms: (n) => `${n} email terms`, chatApp: (n) => `Chat app: ${n}`,
    channel: (c) => `Channel: #${c}`, chatTerms: (n) => `${n} chat terms`, meetingApp: (n) => `Video call: ${n}`, meetingControls: (n) => `${n} video-call controls`,
    url: (d) => `Web address: ${d}`, newsTerms: (n) => `${n} news or web terms`, prose: () => "Running paragraphs of text, like an article", playerTime: (t) => `Player with time ${t}`, views: () => "View counter",
    platform: (n) => `Platform: ${n}`, viewersCount: (n) => `${n} viewers`, streamApp: (n) => `Streaming tool: ${n}`, socialApp: (n) => `Social network: ${n}`,
    terms: (cat, n) => `${n} typical ${cat} words`, mode: () => "Content type chosen by you", domain: (d) => `The site ${d} is usually of this kind`,
  },
};

export const LABELS = { es, en };
export const labels = (language) => LABELS[language] ?? LABELS.es;
