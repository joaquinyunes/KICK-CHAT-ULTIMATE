# Cómo correr este proyecto

## 0. Dos modos de captura
- **remote** (recomendado para empezar): ffmpeg lee el HLS de tu canal de Kick
  en vivo. No necesita nada especial en la PC, funciona desde cualquier lado,
  ~20-40 s de retraso. Solo requiere `KICK_CANAL_SLUG`.
- **local**: ffmpeg captura tu pantalla/ventana y el audio del sistema en la
  PC que streamea. Cero retraso, pero en Windows hay que exponer el audio del
  sistema con "Stereo Mix" o un cable virtual (VB-Audio).

Se elige con `KICK_CAPTURE_MODE` en el `.env`.

## 1. Requisitos previos
- Python 3.10+
- `ffmpeg` en el PATH (`ffmpeg -version`)
- **Módulo 5 (OCR):** Tesseract. En Windows: `winget install UB-Mannheim.TesseractOCR`.
  Si te falta el idioma español, bajá `spa.traineddata` de
  github.com/tesseract-ocr/tessdata_fast a `<DATA_DIR>/tessdata/`.
- **Módulo 8 (resumen):** una de dos —
  - Gemini (nube, gratis): `KICK_GEMINI_API_KEY` de aistudio.google.com/apikey
  - Ollama (local): `ollama serve` + `ollama pull llama3.1:8b`, y `KICK_LLM_PROVIDER=ollama`

## 2. Instalación
```bash
cd src
pip install -r requirements.txt
```
(En Linux con Python del sistema puede hacer falta agregar `--break-system-packages`.)

## 3. Configuración (archivo `.env`)
Copiá `src/.env.example` a `src/.env` y completá los valores. **`common/config.py`
lo carga solo** al arrancar cualquier módulo — no hace falta exportar nada a mano
ni instalar `python-dotenv`.

```bash
cd src
cp .env.example .env       # PowerShell: Copy-Item .env.example .env
```

Alternativamente podés exportar las variables en la terminal (tienen prioridad
sobre el `.env`). En **PowerShell**:
```powershell
$env:KICK_CONTEXT_DATA_DIR = "C:\Users\TU_USUARIO\kick-context-data"
$env:KICK_VIDEO_SO = "windows"
$env:KICK_AUDIO_SO = "windows"
```

Variables clave (ver `.env.example` para la lista completa con comentarios):
- `KICK_CONTEXT_DATA_DIR` — carpeta donde se guarda todo. **En Windows es
  obligatoria** (sin ella se usa `%USERPROFILE%\kick-context-data`).
- `KICK_VIDEO_SO` / `KICK_AUDIO_SO` — `linux` | `windows` | `mac`.
- `KICK_AUDIO_DEVICE` (+ `KICK_AUDIO_DEVICE_2` opcional para mezclar micrófono).
- `KICK_VIDEO_WINDOW_TITLE` — capturar una sola ventana en vez del escritorio.
- `KICK_WHISPER_MODEL` / `KICK_WHISPER_DEVICE` / `KICK_WHISPER_VAD`.

### Cómo encontrar el nombre de tu dispositivo de audio
- **Linux:** `pactl list sources short`
- **Windows:** `ffmpeg -list_devices true -f dshow -i dummy`
- **Mac:** `ffmpeg -f avfoundation -list_devices true -i ""`

En Windows, para capturar el audio **del sistema** (no solo el micrófono) hay que
activar "Stereo Mix" en la configuración de sonido o instalar un cable virtual
(VB-Audio Virtual Cable) y usar ese nombre en `KICK_AUDIO_DEVICE`.

## 4. Orden recomendado de prueba (uno por uno, no todo junto)

Antes de usar el Orquestador, prueba cada módulo suelto para confirmar
que tu entorno específico (SO, dispositivos, hardware) funciona:

```bash
# 1. Solo audio primero — es la ruta más rápida a algo útil
python3 modulo02_captura_audio/captura_audio.py
# (dejar correr 30s, Ctrl+C, y revisar que existan archivos en
#  $KICK_CONTEXT_DATA_DIR/raw_audio/)

# 2. Buffer rotativo
python3 modulo03_buffer_rotativo/buffer_rotativo.py
# (revisar que copie a /buffer/audio/)

# 3. Transcripción
python3 modulo04_transcripcion_audio/transcripcion_audio.py
# (revisar los JSON en /transcripts/, confirmar que el texto tenga sentido)

# 4. Video (cuando el audio ya esté validado)
python3 modulo01_captura_video/captura_video.py

# 5. Análisis visual
python3 modulo05_analisis_visual/analisis_visual.py

# 6. Timeline
python3 modulo07_unificacion_timeline/unificacion_timeline.py

# 7. Memoria histórica
python3 modulo09_memoria_historica/memoria_historica.py

# 8. Resumen con LLM (requiere Ollama corriendo)
python3 modulo08_resumen_llm/resumen_llm.py
```

## 5. Correr todo junto con el Orquestador

```bash
cd src
python modulo10_orquestador/orquestador.py
```

Levanta los módulos 1-9. En modo `remote`, si el canal no está transmitiendo,
los módulos de captura esperan tranquilos hasta que arranques el stream (no
hace falta reiniciar nada). El resumen del último minuto aparece en el Panel
(`http://127.0.0.1:5000`) a los ~1-2 min de estar en vivo.

Para desactivar un módulo: ponelo en `"activo": False` en la lista `MODULOS`
de `orquestador.py`, o apagalo desde el Panel (Módulo 11).

### Cambiar entre remote y local
Editá `KICK_CAPTURE_MODE` en `src/.env` y reiniciá el Orquestador.

## 6. Verificar que el sistema está vivo
Los archivos de heartbeat están en:
```
$KICK_CONTEXT_DATA_DIR/logs/<nombre_modulo>_heartbeat.txt
```
Cada uno contiene el timestamp Unix de la última vez que ese módulo
confirmó estar activo. Los logs detallados están en
`$KICK_CONTEXT_DATA_DIR/logs/<nombre_modulo>.log`.

## 7. Siguiente paso sugerido
Marca el avance en `HANDOFF.md` (en la raíz del proyecto) a medida que
valides cada módulo en tu máquina.

## 8. Módulo 11 — Panel de Control (web con login)

Panel web local para ver el estado de los 9 módulos y prenderlos/apagarlos.
El Orquestador lee esa decisión en cada ciclo (`/data/control/estado_deseado.json`)
y arranca/detiene los procesos en consecuencia.

Puesta en marcha:
```bash
pip install flask
python modulo11_panel_control/generar_password.py   # crea usuario/hash/secret
# pegar las 3 líneas que imprime en tu .env
python modulo11_panel_control/panel_control.py       # abre http://127.0.0.1:5000
```

El panel es de solo lectura sobre lo que producen los demás módulos y solo
escribe el archivo de estado deseado: si el panel se cae, el resto del
sistema sigue igual.

## 8b. Módulo 12 — Comentarista IA (chat simulado en el chat de Kick)

Usa el **prompt maestro** `src/modulo12_comentarista/prompt_chat.txt` (con
marcadores `{{TEMA}}`, `{{CONTEXTO}}`, `{{EVENTO}}`, `{{HISTORIAL}}`, …). El
módulo los rellena con el contexto real del stream (resúmenes del Módulo 8 +
metadata del canal) y pide un **lote** de `KICK_COMENTARIO_LOTE` (30) mensajes
en **una sola llamada**. Modos (`KICK_COMENTARIO_MODO`):

- **`bloque`** (default): 1 llamada cada `KICK_COMENTARIO_BLOQUE_SEG` (300 s =
  5 min) y escribe el lote entero en el TXT de una.
- **`goteo`**: encola los mensajes y los suelta de a uno cada
  `KICK_COMENTARIO_INTERVALO_SEG` (30 s); cuando quedan pocos, pide otro lote.

- **Modo ensayo (default):** `KICK_COMENTARIO_POSTEAR=0` — genera, encola y
  guarda cada mensaje en `<data>/comentarios/*.json` (visible en el Panel),
  pero **no publica nada**.
- **Publicar de verdad:** `KICK_COMENTARIO_POSTEAR=1` + correr una vez
  `python modulo06_api_kick_metadata/login_kick.py` (ya incluye el scope
  `chat:write`) con `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` en el `.env`.

El prompt maestro se edita a mano o desde el Panel. Con el archivo vacío, el
canal offline o sin resúmenes del M8, el módulo no hace nada.

### Consumir los mensajes desde otro proyecto
Cada lote se deja en `<DATA_DIR>/comentarios/lotes/` como `lote_<ts>.json`
(`{timestamp, mensajes: [...]}`) + `lote_<ts>.txt`. Tu otro proyecto lee el
`.json` más viejo, lo procesa y lo renombra a `.done` (o lo borra). Hay un
consumidor de ejemplo listo para copiar:
```bash
python modulo12_comentarista/consumidor_ejemplo.py "<DATA_DIR>/comentarios/lotes"
```
Alternativas: `chat_feed.txt` (feed rolling para *tail*),
`KICK_COMENTARIO_WEBHOOK` (POST JSON por lote), o `KICK_COMENTARIO_HOOK_CMD`
(ejecuta tu comando con la ruta del `lote_<ts>.json` tras cada lote — el otro
proyecto "se carga solo").

## 10. Dejarlo corriendo solo (sin la terminal de Claude)

`src/arrancar_desatendido.ps1` levanta el Panel y mantiene vivo el Orquestador
(lo relanza si se cae). Para que arranque al iniciar sesión de Windows,
registralo como Tarea Programada (PowerShell **como admin**, desde `src\`):

```powershell
$exe = (Get-Command powershell).Source
$arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Resolve-Path .\arrancar_desatendido.ps1) + '"'
schtasks /Create /TN "KickContext" /TR "$exe $arg" /SC ONLOGON /RL LIMITED /F
schtasks /Run /TN "KickContext"
```

A partir de ahí, con el canal en vivo, el Módulo 12 genera un lote cada 5 min
(`KICK_COMENTARIO_MODO=bloque`), escribe el TXT/lote y dispara el hook —
todo sin intervención. Log: `<DATA_DIR>\logs\arrancar_desatendido.log`.

## 9. Estado de verificación
Todos los módulos pasan `python -m py_compile`. Config, timeline (matching por
tolerancia), lógica de estado-deseado del Orquestador y el flujo completo del
Panel (login → dashboard → toggle) están probados. Lo que **no** se pudo probar
en este entorno por falta de hardware/servicios: captura real de ffmpeg,
faster-whisper, OCR con tesseract, la API de Kick y Ollama. Esos hay que
validarlos en tu máquina, módulo por módulo, con el orden de la sección 4.
