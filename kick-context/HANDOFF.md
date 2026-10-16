# HANDOFF — Documento Vivo del Proyecto
**Última actualización:** 28 de agosto de 2026
**Instrucción de uso:** este archivo se actualiza al final de cada sesión de trabajo. No se borra el historial anterior, solo se agrega arriba de la sección "Historial de sesiones".

---

## Estado general del proyecto

| Fase | Módulo | Estado |
|------|--------|--------|
| A | 1. Captura de Video | Código listo |
| A | 2. Captura de Audio | Código listo |
| B | 3. Buffer Rotativo | Código listo |
| C | 4. Transcripción Audio | Código listo |
| C | 5. Análisis Visual | Código listo |
| C | 6. Metadata Kick (API) | Código listo |
| D | 7. Unificación Timeline | Código listo (probado) |
| D | 8. Resumen LLM | Código listo |
| D | 9. Memoria Histórica | Código listo |
| C | 6b. Metadata (API pública) | Funcionando (probado con canal real) |
| D | 8. Resumen LLM (Gemini) | Funcionando (probado con key real) |
| E | 10. Orquestador | Código listo (lógica probada) |
| E | 11. Panel de Control | Funcionando (flujo probado) |
| D | 12. Comentarista IA (chat Kick) | Código listo (helpers + panel probados; falta prueba en vivo) |

**Leyenda de estados:** `No iniciado` / `En progreso` / `Código listo` (escrito y compila; pendiente validar en hardware real) / `Funcionando` (validado en la máquina de streaming) / `Bloqueado`

## Decisiones tomadas hasta ahora
- Se usará la **API oficial de Kick** (api.kick.com, OAuth 2.1/PKCE) para metadata, en vez de scraping no oficial, para evitar zona gris de ToS — es tu propio canal así que el contenido en sí no tiene problema de propiedad.
- Captura de audio/video se hará de forma **local** (pantalla propia / OBS), no leyendo el HLS de Kick, para mayor control y cero dependencia de la API para lo crítico.
- Arquitectura 100% basada en **archivos compartidos en disco**, sin llamadas directas entre módulos, para garantizar que la caída de uno no arrastre a los demás.
- LLM de resumen será **local vía Ollama** (sin costo por token).
- Orden de construcción recomendado: Fase A → B → C (primero audio, luego visual) → D → E.
- El control prendido/apagado de módulos vive en un archivo (`/data/control/estado_deseado.json`): el Panel (M11) lo escribe, el Orquestador (M10) lo lee. Coherente con el resto de la arquitectura basada en archivos; el Panel nunca habla directo con el Orquestador.
- Configuración por `.env` cargado a mano por `config.py` (sin `python-dotenv`) para no sumar dependencias.

## Próximos pasos inmediatos
1. `pip install -r src/requirements.txt` en la máquina de streaming (Windows).
2. `cp src/.env.example src/.env` y completar (SO=windows, dispositivos de audio, carpeta de datos).
3. Validar módulo por módulo con el orden de `src/README.md` sección 4:
   audio → buffer → transcripción → video → visual → timeline → memoria → LLM.
4. Medir velocidad de faster-whisper en el hardware real; si un clip de 10 s
   tarda >10 s, bajar `KICK_WHISPER_MODEL` a `base` o `tiny`.
5. Para el Módulo 6: registrar la app en el panel de desarrolladores de Kick y
   hacer el login OAuth inicial una vez (falta escribir el script de login PKCE;
   por ahora se asume que ya tenés `KICK_ACCESS_TOKEN`/`KICK_REFRESH_TOKEN`).
6. Levantar el Panel (Módulo 11) y el Orquestador (Módulo 10) al final.

## Bloqueos / dudas abiertas
- **Módulo 6:** el código de la API de Kick (`api_kick_metadata.py`) nunca se
  probó contra `api.kick.com` reales y la forma exacta de la respuesta puede no
  coincidir; ajustar `_consultar_canal` cuando se tenga un token válido. Falta
  además el script de login OAuth/PKCE inicial.
- **Audio del sistema en Windows:** requiere "Stereo Mix" o cable virtual
  (VB-Audio). Sin eso, el Módulo 2 solo captura el micrófono.

## Cómo actualizar este documento
Cada vez que termines de trabajar en un módulo, edita la tabla de estado, agrega cualquier decisión nueva, y agrega una entrada en el historial de abajo con fecha.

---

## Historial de sesiones

### 30 de agosto de 2026 — Módulo 12: Comentarista IA (chat simulado)
- **Nuevo Módulo 12** (`src/modulo12_comentarista/comentarista.py`). Enfoque
  final (2ª iteración del día): NO es un solo "personaje", es un **prompt
  maestro** que simula un chat entero. Se copió el `.txt` del usuario
  ("PROMPT MAESTRO COMBINADO") a `src/modulo12_comentarista/prompt_chat.txt`.
- El módulo rellena los marcadores del prompt (`{{TEMA}}`, `{{CONTEXTO}}`,
  `{{EVENTO}}`, `{{CANTIDAD}}`, `{{HISTORIAL}}`, `{{CATEGORIA}}`,
  `{{PROYECTO_ACTUAL}}`…) con el contexto real (resúmenes M8 + `estado_canal`
  + `nota_usuario`) y borra los marcadores que quedan sin dato.
- **1 sola llamada → lote de N mensajes** (`KICK_COMENTARIO_LOTE`=30). Dos
  modos (`KICK_COMENTARIO_MODO`):
  - **`bloque`** (default): 1 llamada cada `KICK_COMENTARIO_BLOQUE_SEG`=300 s
    (5 min) y vuelca el lote entero al TXT de una.
  - **`goteo`**: encola (`<data>/comentarios/cola.json`) y suelta 1 msg cada
    `KICK_COMENTARIO_INTERVALO_SEG`=30 s; regenera al bajar de umbral 4.
  Esquiva los 503 del free tier.
- Salida en JSON (`{"lineas":[{n, autor, responde_a, texto}]}`, `responseSchema`
  de Gemini, `maxOutputTokens 8192`): hilos encadenados con voces fijas P1..P12.
  El parser es tolerante (JSON truncado, bloque markdown) y cae al texto plano
  viejo (ignora `KICKCHAT123456`). `[EMOTE: X]` → `X` en `texto`; `raw` conserva
  `[EMOTE:X]` y `@Pn` para el servidor. Dedupe por similitud (Jaccard) contra los
  últimos 40 y contra la propia tanda; `EVITAR` le pasa al prompt las aperturas y
  expresiones que el chat repitió de más. El lote (`lote_<ts>.json`) trae
  `mensajes` (strings, compatibilidad) y `lineas` (estructurado).
- **Posteo:** `POST https://api.kick.com/public/v1/chat` (`type: "bot"`).
  Default `KICK_COMENTARIO_POSTEAR=0` = **modo ensayo** (genera y guarda, NO
  postea). Con `=1` publica; requiere `login_kick.py` con el scope `chat:write`
  (se agregó al SCOPES).
- Panel: editor del prompt maestro + feed de mensajes + contador de cola.
  `config.py`: `PROMPT_CHAT_*`, `COMENTARIO_COLA_PATH`, `leer_prompt_chat()`.
- **Probado local:** relleno de marcadores OK; 1 llamada devolvió 28 mensajes
  coherentes; E2E de drip en modo ensayo OK (lote → cola → 1 msg cada 8 s →
  `comentario_*.json` → regenera al llegar a 4).
- **Integración con otro proyecto** (3 vías, todas activas a la vez):
  1. `<data>/comentarios/chat_feed.txt` — feed rolling (500 líneas) para *tail*.
  2. `<data>/comentarios/lotes/lote_<ts>.{txt,json}` — **recomendado**: 1
     archivo por lote, escritura atómica; el otro proyecto lee el `.json` más
     viejo, lo procesa, lo pasa a `.done`. Ejemplo:
     `modulo12_comentarista/consumidor_ejemplo.py`.
  3. `KICK_COMENTARIO_WEBHOOK` — POST JSON `{timestamp, mensajes}` por lote.
  4. `KICK_COMENTARIO_HOOK_CMD` — ejecuta un comando (ej. `python cargar.py`)
     con la ruta del `lote_<ts>.json` tras cada lote → el otro proyecto
     "se carga solo".
  Probado OK (spool + consumidor + hook).
- **Desatendido:** `src/arrancar_desatendido.ps1` (watchdog: Panel + relanza
  el Orquestador si cae, log propio). Se registra como Tarea Programada
  `ONLOGON` (comando en el encabezado del .ps1 y en el README). Con eso el
  ciclo de 5 min corre sin la sesión de Claude abierta.
- **Ojo:** el prompt maestro trae datos deportivos/casino de ejemplo
  *hardcodeados* y el modelo los toma como reales. Si se quiere que el chat
  reaccione más al gameplay real, hay que editar `prompt_chat.txt`.
- **Pendiente:** prueba en vivo posteando de verdad; ajustar payload de
  `/public/v1/chat` si la API de Kick difiere.

### 29 de agosto de 2026 (parte 4) — clips .ts + tuning de Gemini
- "No se actualiza más": era doble — (a) Gemini free tier hoy tira 503 y
  timeouts de 120s constantes; (b) clips .mp4 que quedaban sin 'moov atom'
  cuando gdigrab se cortaba (sesión inactiva) → "moov atom not found" → M8
  no podía sacar el frame.
- **Fix (b) v2:** el `.ts` con re-encode de gdigrab salía corrupto ("cbp too
  large"). Se volvió a **.mp4 pero FRAGMENTADO**
  (`-movflags +frag_keyframe+empty_moov+default_base_moof`, keyframe cada ~2s):
  legible aunque se corte. Y `_extraer_frame` usa `-pix_fmt yuvj420p`
  (gdigrab entrega full-range y el encoder mjpeg lo exige). PROBADO OK:
  leyó "Instagram, post de @minjares.ia sobre alternativas a Todoist".
- **Fix (a): tuning** — `KICK_RESUMEN_FRAMES=1` por default (1 frame, más
  liviano y confiable; 2 = ve el cambio pero pesa el doble). Timeout de
  Gemini bajado a 75s (`KICK_GEMINI_TIMEOUT`). Se reintenta también con 500.
- M8: si no hay captura, reintenta a los 15s (antes esperaba 120s).
- **Cartel de estado grande en el Panel:** 🟢 ANDANDO / 🟡 arrancando /
  🔴 APAGADO, con "último resumen hace X".

### 29 de agosto de 2026 (parte 3) — botón manual, fases, fallback de modelo
Feedback: "no funciona lo que decís / no me da las fases / quiero un botón".
- **La captura de pantalla SÍ funciona** — se comprobó que Gemini lee el
  contenido real ("partido Bournemouth vs Everton por ESPN 2, min 12, 0-0").
  El problema era la demora: Gemini free tier con 503 constantes hoy.
- **Fallback de modelo:** `KICK_GEMINI_MODELS` = lista; si el primero da
  503/429 se prueba el siguiente. Default: `gemini-flash-lite-latest,
  gemini-2.5-flash`.
- **Botón "⚡ Analizar ahora"** en el Panel → toca `control/analizar_ahora`
  → el Módulo 8 corta la espera y resume en el acto. Probado OK.
- **Campo `fase`** en cada resumen (apostando / slots / poker / jugando /
  programando / charlando / viendo-deporte / pausa / …). Se muestra como
  badge en el feed.
- **Fix del estado de módulos:** el Orquestador ahora resetea
  `estado_deseado.json` a la config de MODULOS en cada arranque (antes un
  archivo viejo resucitaba M4/M5/M7). Los toggles del panel valen mientras
  el Orquestador corre; al reiniciarlo vuelve a la config.
- Módulo 2 en modo local sin `KICK_AUDIO_DEVICE`: ahora espera tranquilo en
  vez de crashear en loop.

### 29 de agosto de 2026 (parte 2) — probar sin transmitir (modo local / OBS)
- **Módulo 1:** agregada la opción `KICK_VIDEO_DSHOW` (Windows) para capturar
  un dispositivo dshow, típicamente "OBS Virtual Camera" → permite probar el
  sistema sin estar EN VIVO, viendo la escena compuesta de OBS.
- El grab de escritorio (`gdigrab -i desktop`) ya no fuerza `-video_size`
  (rompía con esta PC de 3 monitores en offsets raros); escala a 1280 ancho.
- Ojo: `gdigrab` solo funciona con la sesión de Windows activa (no probable
  de verificar desde acá cuando la sesión remota está inactiva; en la PC del
  usuario mientras streamea, siempre lo está). La cámara virtual de OBS no
  tiene esa limitación.
- Para probar: `.env` → `KICK_CAPTURE_MODE=local` + `KICK_VIDEO_DSHOW=OBS
  Virtual Camera` (u `KICK_VIDEO_WINDOW_TITLE`). Audio: `KICK_RESUMEN_AUDIO=0`
  (sin), o el micrófono, o VB-Cable para el audio del sistema.

### 29 de agosto de 2026 — nota de voz del usuario + cómo dejarlo corriendo
- **Feature nueva: indicación del streamer.** El Módulo 8 ahora inyecta en
  cada prompt lo que el usuario quiera que mire/avise. Dos formas:
  1. Panel → sección "Tu indicación para el resumen" (textarea + Guardar) →
     escribe en `<data>/nota_usuario/nota.txt`.
  2. Copiar un audio (.mp3/.wav/.m4a/.ogg/…) en `<data>/nota_usuario/` →
     M8 lo reencoda a mp3 chico, lo transcribe con Gemini, lo agrega a
     nota.txt (con hora, últimas 15 líneas) y lo mueve a `procesados/`.
  Probado OK con una nota TTS.
- **Aclarado con el usuario:** el pipeline vive dentro de la sesión de
  Claude; cuando se cierra, se corta. Para dejarlo corriendo tiene que
  arrancarlo él: `src/arrancar.ps1` (nuevo) o a mano el orquestador + panel.
- Config sin cambios: `remote`, `yundev`, Gemini flash-lite, resumen cada
  2 min con 2 frames en alta + audio. Módulos activos: 1,2,3,6,8,9.

### 28 de agosto de 2026 (8ª parte — resumen más específico)
Feedback: "no quiero que describa todo lo que ve, quiero que diga QUÉ estoy
haciendo puntual — qué apuesta concreta, qué slot y si paga, qué mano de
póker". Cambios en Módulo 8:
- **Frames en alta** (1152px, JPEG q4) para que Gemini pueda LEER montos,
  cuotas, nombres de slot, cartas, balances.
- **2 frames** (uno de ~30s atrás + uno de ahora) → Gemini ve qué CAMBIÓ
  (si el slot viene comiendo el balance, si entró un Mega Win, si avanzó
  la mano).
- **Prompt reescrito**: "enfocate en la ACCIÓN puntual, no el decorado".
  Ejemplos concretos por caso (apuestas: equipos/mercado/cuota/combinada;
  slots: nombre + si paga + balance; póker: cartas/board/pozo/resultado).
- Probado: "Pegá un Mega Win de GC 4.869 en el slot Sugar Rush con apuesta
  de GC 1.000, balance venía en GC 109.800." — nivel de detalle correcto.
- Costo: la llamada a Gemini pasó a ~60-90s (payload grande: 2 imágenes +
  audio). Timeout 120s, tolerancia del orquestador para M8 = 200s.

### 28 de agosto de 2026 (7ª parte — Gemini escucha el audio, sin Whisper)
Feedback del usuario: el resumen del audio salía en "lenguaje raro" (era
Whisper transcribiendo música como ruido), quería más detalle ("no que haya
pestaña de casino, sino en qué partido apuesta / qué programa"), y que
ignore el chat de viewers.
- **Módulo 8 ahora le manda a Gemini el AUDIO directo** (últimos ~30s del
  buffer, concatenados a mp3) además del frame. Gemini escucha y resume con
  sentido ("relató que ganó la mano con full", etc.). Probado: con audio solo
  ya dice "Estás jugando CS2 en Mirage, tirando en medio y pidiendo drop".
- **Prompt reescrito** exigiendo concreción (qué partido/cuota/deporte, qué
  lenguaje/archivo, qué pasa en la partida) e **ignorar el chat** de viewers.
- **Whisper (M4) APAGADO** — ya no hace falta y en CPU iba lentísimo.
  **M7 (timeline) APAGADO** — no queda nada que unificar. M5 sigue apagado.
  Módulos activos ahora: 1, 2, 3, 6, 8, 9 (+ orquestador y panel).
- Panel: se sacó la sección "Detalle en vivo" (mostraba la basura de Whisper).
- El orquestador ahora siembra estado_deseado.json al arrancar → el panel
  muestra bien qué está on/off.
- `KICK_RESUMEN_AUDIO=1` (mandar audio a Gemini). Para volver a transcripción
  literal: prender M4 en el orquestador.

### 28 de agosto de 2026 (6ª parte — cadencia 2 min + contexto acumulado)
Pedido del usuario: resumen cada 2 min (no cada 45s), que combine pantalla +
audio, y que el contexto NO se borre.
- `KICK_RESUMEN_INTERVALO_SEG=120` (Módulo 8). Menos llamadas a Gemini →
  menos 429/503.
- M8 duerme troceado latiendo cada 20s (tolerancia del orquestador 60s).
- **Panel rehecho:** ahora la sección principal es "Contexto acumulado" —
  un feed de los últimos 40 resúmenes, del más nuevo al más viejo, con hora.
  No se pisa: cada resumen queda. El "detalle en vivo" (timeline 3 min) pasa
  a ser secundario. Refresco de página bajado a 30s.
- Los .json de summaries/ y history.db no se borran nunca (ya era así).
- Whisper queda PRENDIDO (`tiny`). M5/OCR queda APAGADO (Gemini ve el frame).

### 28 de agosto de 2026 (5ª parte — OCR fuera, resumen multimodal)
Con el stream en vivo aparecieron 2 problemas grandes:
- **El OCR de Tesseract era ilegible** en este stream (overlay de apuestas +
  chat + categoría todo junto → ensalada de palabras que además contaminaba
  el resumen). **Módulo 5 apagado por defecto.**
- **Gemini `gemini-2.5-flash` daba 429** (free tier muy limitado, agravado por
  reintentos rápidos). Cambiado a **`gemini-flash-lite-latest`** e intervalo
  de resumen subido a **45 s**.
- **Módulo 8 ahora es multimodal:** en vez de leer texto OCR, le manda a Gemini
  el frame actual del video (640px) + la transcripción de audio, y pide el
  resumen. Gemini "ve" la pantalla directamente — describe mucho mejor. Prompt
  forzado a **español rioplatense**.
- Whisper `base` no daba abasto en CPU bajo carga (25-94 s/clip) → default
  `tiny` + M4 saltea backlog y prioriza el último clip.
- Resultado probado: resumen en 4-5 s, en español, combinando lo que se ve
  en pantalla con lo que se escucha. Ej: "Arrancaste una mano importante de
  póker en la Mesa 4 con un pozo de $1200."

### 28 de agosto de 2026 (4ª parte — corriendo con el stream EN VIVO)
El usuario prendió el stream (`yundev`) y se corrió el sistema de verdad.
Bugs encontrados y arreglados (ninguno se veía sin un stream real):
- **ffmpeg `-strftime 1` con `%s` NO funciona en Windows** (nombre de
  segmento vacío → "Failed to open segment ''"). Cambiado a
  `%Y%m%d-%H%M%S` en M1/M2; `config.timestamp_desde_nombre` ahora parsea
  ese formato además del unix directo.
- **HLS trae varios streams** (audio, video, id3): sin `-map 0:a:0` /
  `-map 0:v:0` el muxer de segmentos falla ("no packets" / "incorrect
  codec parameters"). Agregado a M1/M2 en modo remoto.
- **M3 copiaba al buffer el clip que ffmpeg todavía estaba escribiendo**
  → M4 leía WAV truncados ("Invalid data"). Ahora M3 descarta el más
  nuevo y espera 2 s de "enfriamiento" por mtime.
- **M1/M2 abandonaban tras 3 fallos** (`sys.exit`). En un stream en vivo
  los cortes son normales → en modo remoto ahora reintentan para siempre
  con backoff (5→30 s); en local mantienen el límite de 3.
- **M4 se reiniciaba durante la carga del modelo Whisper** (sin heartbeat
  ~20 s). Ahora late antes de cargar y su tolerancia subió a 90 s.
- Módulo 6 confirmado: la API pública de Kick da título/categoría/viewers
  sin OAuth.
- **RESULTADO:** con el stream en "JUST CHATTING / NO MIC", el pipeline
  generó resúmenes reales a partir del OCR de pantalla + chat visible.
  Sin micrófono no hay transcripción de audio (es esperable).

### 28 de agosto de 2026 (3ª parte — pipeline probado punta a punta)
- **Gemini:** la key del usuario funciona. `gemini-2.0-flash` fue discontinuado
  por Google → ahora el default es **`gemini-2.5-flash`** (probado, ~5 s por
  resumen, calidad muy buena).
- **Kick:** canal = `yundev`. La API pública (`kick.com/api/v2/channels/yundev`)
  responde sin Cloudflare: `resolver_hls_url()` y `canal_en_vivo()` andan.
  Módulo 6 reescrito para usar SOLO la API pública (sin OAuth) — título,
  categoría, viewers, seguidores. `login_kick.py` queda para endpoints
  autenticados futuros.
- **Dry-run completo** (con clips sintéticos, stream offline): raw → buffer →
  Whisper (`base`) → OCR → timeline → **resumen Gemini** → panel. Todo OK; el
  panel muestra el resumen + el timeline con audio 🎙 y texto de pantalla 🖥.
- **Modo remoto pulido:** M1/M2 detectan si el canal está offline y esperan
  (latiendo) en vez de tirar error. M8 late aunque no haya timeline.
- **Config actual (`src/.env`):** `KICK_CAPTURE_MODE=remote`,
  `KICK_CANAL_SLUG=yundev`, `KICK_LLM_PROVIDER=gemini`, whisper `base`.
- **PENDIENTE para verlo en vivo:** que el canal `yundev` transmita. Con el
  stream ON, `python modulo10_orquestador/orquestador.py` levanta todo y en
  ~1-2 min el panel muestra el contexto del último minuto.

### 28 de agosto de 2026 (2ª parte — puesta en marcha real)
- **Tesseract 5.4** instalado (winget). Sin `spa` en el paquete → se descargaron
  `spa/eng/osd.traineddata` a `<data>/tessdata/`. Módulo 5 ahora localiza el
  binario solo (`KICK_TESSERACT_CMD` o rutas típicas de Windows) y setea
  `TESSDATA_PREFIX`. OCR probado OK.
- **faster-whisper** probado con audio real (TTS): modelo `small` en CPU tarda
  ~8 s por clip de 10 s — anda pero justo; si se atrasa, bajar a `base`.
- **Módulo 8:** soporta proveedor de LLM configurable. `KICK_LLM_PROVIDER=gemini`
  usa Google Gemini (free tier, `response_mime_type: application/json`);
  `ollama` sigue disponible. Falta la API key del usuario para probarlo en vivo.
- **Captura remota:** Módulos 1 y 2 aceptan `KICK_CAPTURE_MODE=remote` → ffmpeg
  lee el HLS del canal. `config.resolver_hls_url()` lo saca del slug vía API
  pública de Kick, con override manual `KICK_HLS_URL`. Falta el slug del usuario
  para probar (Cloudflare puede bloquear la resolución automática).
- **Módulo 6:** escrito `login_kick.py` (OAuth 2.1 PKCE, servidor local para el
  callback). Endpoints/scopes pueden necesitar ajuste según docs de Kick.
- `.env` / `.env.example` reescritos con todo lo nuevo.
- Pendiente del usuario: (1) API key de Gemini, (2) URL del canal de Kick.
  Audio local sigue sin resolver (no hay Stereo Mix / cable virtual) — el plan
  es arrancar en modo remoto y sumar captura local después.

### 28 de agosto de 2026
Se completó todo lo que faltaba para cerrar el proyecto a nivel código:
- **`common/config.py`:** carga automática de `.env` (sin dependencias), default
  de carpeta de datos válido en Windows (`~/kick-context-data` en vez de `/data`),
  constantes `CONTROL_DIR` / `CONTROL_ESTADO_PATH` y helper `leer_estado_deseado()`.
- **Módulo 10 (Orquestador):** ahora lee `estado_deseado.json` en cada ciclo y
  prende/apaga módulos según lo que diga el Panel (prioridad sobre `activo`).
  Agregado período de gracia al arranque para evitar falsos reinicios.
- **Módulo 11 (Panel de Control):** creadas las plantillas `templates/login.html`
  y `templates/dashboard.html`, el helper `generar_password.py`, y `flask`
  agregado a `requirements.txt`. Flujo login→dashboard→toggle probado con
  cliente de test de Flask.
- **Módulo 4:** filtro VAD (`vad_filter`) + `condition_on_previous_text=False`
  para cortar las alucinaciones de Whisper en silencios.
- **Módulo 1:** captura de una ventana específica en Windows
  (`KICK_VIDEO_WINDOW_TITLE`) + `KICK_VIDEO_FPS`.
- **Módulo 2:** mezcla de dos dispositivos de audio (`KICK_AUDIO_DEVICE_2`),
  típicamente sistema + micrófono, vía `amix`.
- **Módulo 7:** el timeline ya no exige timestamps idénticos entre audio y video;
  matchea por ventana de tolerancia (probado con datos simulados).
- Nuevos: `src/.env.example`, README reescrito para Windows/PowerShell.
- Verificación: `py_compile` OK en los 12 archivos; config, timeline, lógica del
  orquestador y panel probados. Sin validar en hardware: ffmpeg, whisper,
  tesseract, API de Kick, Ollama.

### 27 de agosto de 2026
- Se crearon los archivos base del proyecto: stack tecnológico, arquitectura general, 10 microfases de módulos, y este handoff.
- Aún no se ha escrito código.

> **Nota de recuperación (ver `NOTA-RECUPERACION.md` en la raíz del proyecto):** esta es la versión original de este archivo. La conversación de origen editó este documento (y varios módulos) en sesiones posteriores, pero el export de la conversación compartida no conserva el contenido de esas ediciones — solo el de los archivos creados desde cero. Ver `NOTA-RECUPERACION.md` para el detalle completo de qué se recuperó y qué no.
