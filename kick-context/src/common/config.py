"""
config.py — Configuración y utilidades compartidas.

Este es el ÚNICO archivo que todos los módulos pueden importar.
No contiene lógica de negocio de ningún módulo, solo:
  - rutas de carpetas compartidas (/data/...)
  - función de heartbeat (para que el Orquestador sepa si un módulo vive)
  - creación automática de carpetas

Todas las rutas se pueden sobreescribir con la variable de entorno
KICK_CONTEXT_DATA_DIR (útil para pruebas locales sin tocar /data real).
"""

import os
import time
import json
from pathlib import Path


def _cargar_dotenv():
    """Carga un archivo .env (KEY=VALOR) si existe, sin depender de librerías
    externas. Busca en el directorio actual, en src/ y en la raíz del repo.
    No pisa variables que ya estén definidas en el entorno."""
    candidatos = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parent.parent / ".env",          # src/.env
        Path(__file__).resolve().parent.parent.parent / ".env",   # raíz/.env
    ]
    for env_path in candidatos:
        if not env_path.is_file():
            continue
        for linea in env_path.read_text(encoding="utf-8").splitlines():
            linea = linea.strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            clave, _, valor = linea.partition("=")
            os.environ.setdefault(clave.strip(), valor.strip().strip('"').strip("'"))
        break


_cargar_dotenv()

# --- Carpeta base -----------------------------------------------------
# En Windows "/data" no es una ruta válida; si no se define la variable,
# se usa una carpeta en el home del usuario.
BASE_DATA_DIR = Path(os.environ.get("KICK_CONTEXT_DATA_DIR") or (Path.home() / "kick-context-data"))

# --- Subcarpetas por módulo --------------------------------------------
RAW_VIDEO_DIR = BASE_DATA_DIR / "raw_video"
RAW_AUDIO_DIR = BASE_DATA_DIR / "raw_audio"
BUFFER_VIDEO_DIR = BASE_DATA_DIR / "buffer" / "video"
BUFFER_AUDIO_DIR = BASE_DATA_DIR / "buffer" / "audio"
TRANSCRIPTS_DIR = BASE_DATA_DIR / "transcripts"
VISUAL_DESC_DIR = BASE_DATA_DIR / "visual_desc"
METADATA_DIR = BASE_DATA_DIR / "metadata"
TIMELINE_DIR = BASE_DATA_DIR / "timeline"
SUMMARIES_DIR = BASE_DATA_DIR / "summaries"
LOGS_DIR = BASE_DATA_DIR / "logs"
HISTORY_DB_PATH = BASE_DATA_DIR / "history.db"

# --- Control del Panel (Módulo 11) -------------------------------------
# El Panel escribe aquí qué módulos deben estar activos; el Orquestador
# (Módulo 10) lo lee en cada ciclo y prende/apaga en consecuencia.
CONTROL_DIR = BASE_DATA_DIR / "control"
CONTROL_ESTADO_PATH = CONTROL_DIR / "estado_deseado.json"
# El Panel toca este archivo para pedirle al Módulo 8 un resumen inmediato.
ANALIZAR_AHORA_PATH = CONTROL_DIR / "analizar_ahora"
# El Panel toca este archivo para que el Módulo 12 regenere el lote YA.
REGENERAR_LOTE_PATH = CONTROL_DIR / "regenerar_lote"
# Ajustes de generación del Módulo 12 que se editan desde el panel /kc:
# {modo, contexto_manual, contexto_extra, cantidad, mezcla:{...}}
GEN_CONFIG_PATH = CONTROL_DIR / "gen_config.json"

# Carpeta con los .traineddata de Tesseract (Módulo 5). Se usa si existe;
# si no, Tesseract usa su tessdata por defecto.
TESSDATA_DIR = BASE_DATA_DIR / "tessdata"

# --- Nota / contexto que pone el streamer ----------------------------
# El usuario deja acá indicaciones para que el Módulo 8 las tenga en cuenta
# al resumir (ej: "estoy probando martingala, avisame si pierdo 3 seguidas").
# - nota.txt: texto activo (lo edita el Panel).
# - cualquier audio (.mp3/.wav/.m4a/.ogg/.opus) que se deje en la carpeta:
#   el Módulo 8 lo transcribe y lo agrega a nota.txt, y lo mueve a procesados/.
NOTA_USUARIO_DIR = BASE_DATA_DIR / "nota_usuario"
NOTA_USUARIO_TXT = NOTA_USUARIO_DIR / "nota.txt"
NOTA_USUARIO_PROCESADOS = NOTA_USUARIO_DIR / "procesados"

# --- Comentarista IA (Módulo 12) ------------------------------------
# prompt_chat.txt: el "prompt maestro" que simula un chat entero y genera
#   un lote de mensajes por llamada. Tiene marcadores {{TEMA}}, {{CONTEXTO}},
#   {{EVENTO}}, {{CANTIDAD}}, {{HISTORIAL}}, ... que el Módulo 12 rellena con
#   el contexto real del stream (resúmenes del M8 + metadata del canal).
#   Prioridad: KICK_PROMPT_CHAT_FILE > copia activa del Panel (PROMPT_CHAT_TXT)
#   > archivo del repo (modulo12_comentarista/prompt_chat.txt).
PROMPT_CHAT_DIR = BASE_DATA_DIR / "prompt_chat"
PROMPT_CHAT_TXT = PROMPT_CHAT_DIR / "prompt_chat.txt"
PROMPT_CHAT_FILE_REPO = Path(__file__).resolve().parent.parent / "modulo12_comentarista" / "prompt_chat.txt"
COMENTARIOS_DIR = BASE_DATA_DIR / "comentarios"
COMENTARIO_COLA_PATH = COMENTARIOS_DIR / "cola.json"
# Cada lote generado se deja también acá como lote_<ts>.txt + lote_<ts>.json,
# para que OTRO proyecto los levante (lee el más viejo, lo procesa, lo borra
# o lo renombra a .done). Es el punto de integración recomendado.
COMENTARIO_LOTES_DIR = COMENTARIOS_DIR / "lotes"

ALL_DIRS = [
    RAW_VIDEO_DIR, RAW_AUDIO_DIR, BUFFER_VIDEO_DIR, BUFFER_AUDIO_DIR,
    TRANSCRIPTS_DIR, VISUAL_DESC_DIR, METADATA_DIR, TIMELINE_DIR,
    SUMMARIES_DIR, LOGS_DIR, CONTROL_DIR, NOTA_USUARIO_DIR, NOTA_USUARIO_PROCESADOS,
    PROMPT_CHAT_DIR, COMENTARIOS_DIR, COMENTARIO_LOTES_DIR,
]


def leer_prompt_chat() -> str:
    """Prompt maestro para el Módulo 12 (con marcadores {{...}} sin rellenar).
    Prioridad: KICK_PROMPT_CHAT_FILE > copia activa del Panel > archivo del repo."""
    override = os.environ.get("KICK_PROMPT_CHAT_FILE", "")
    candidatos = [Path(override)] if override else []
    candidatos += [PROMPT_CHAT_TXT, PROMPT_CHAT_FILE_REPO]
    for p in candidatos:
        try:
            if p.is_file():
                txt = p.read_text(encoding="utf-8").strip()
                if txt:
                    return txt
        except OSError:
            continue
    return ""

# --- Ventana de contexto ------------------------------------------------
VENTANA_SEGUNDOS = int(os.environ.get("KICK_CONTEXT_VENTANA_SEGUNDOS", 180))  # 3 min
DURACION_CLIP_SEGUNDOS = int(os.environ.get("KICK_CONTEXT_CLIP_SEGUNDOS", 10))
CLIPS_EN_VENTANA = max(1, VENTANA_SEGUNDOS // DURACION_CLIP_SEGUNDOS)

# --- Resumen LLM (Módulo 8) ---------------------------------------------
# Proveedor: "gemini" (nube, free tier) | "ollama" (local)
LLM_PROVIDER = os.environ.get("KICK_LLM_PROVIDER", "ollama").lower()

# Ollama (local)
OLLAMA_URL = os.environ.get("KICK_CONTEXT_OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.environ.get("KICK_CONTEXT_OLLAMA_MODEL", "llama3.1:8b")

# Google Gemini (nube)
GEMINI_API_KEY = os.environ.get("KICK_GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("KICK_GEMINI_MODEL", "gemini-flash-lite-latest")

# --- Comentarista IA (Módulo 12) --------------------------------------
# Cuántos mensajes pide por llamada al LLM (1 sola llamada por lote).
COMENTARIO_LOTE = int(os.environ.get("KICK_COMENTARIO_LOTE", 30))
# "bloque"  = 1 llamada cada COMENTARIO_BLOQUE_SEG y vuelca el lote entero al TXT.
# "goteo"   = 1 llamada por lote, pero suelta los mensajes de a uno.
COMENTARIO_MODO = os.environ.get("KICK_COMENTARIO_MODO", "bloque").lower()
COMENTARIO_BLOQUE_SEG = int(os.environ.get("KICK_COMENTARIO_BLOQUE_SEG", 300))
# (modo goteo) Segundos entre cada mensaje que se suelta.
COMENTARIO_SEG_ENTRE_MSGS = int(os.environ.get("KICK_COMENTARIO_INTERVALO_SEG", 30))
# (modo goteo) Cuando quedan <= estos mensajes en la cola, se pide otro lote.
COMENTARIO_REGEN_UMBRAL = int(os.environ.get("KICK_COMENTARIO_REGEN_UMBRAL", 4))
# "1" publica en el chat de Kick de verdad; "0" (default) modo ensayo:
# genera y guarda los mensajes pero NO los postea.
COMENTARIO_POSTEAR = os.environ.get("KICK_COMENTARIO_POSTEAR", "0") in ("1", "true", "True")
COMENTARIO_MAX_CHARS = int(os.environ.get("KICK_COMENTARIO_MAX_CHARS", 240))
# TXT que se va actualizando con cada mensaje soltado (para que lo consuma
# otro proyecto, ej. "kick chat"). Vacío = usar el default de abajo.
# Formato: "plain" (una línea = un mensaje) | "ts" (epoch<TAB>mensaje) | "jsonl"
COMENTARIO_TXT_OUT = os.environ.get("KICK_COMENTARIO_TXT_OUT", "") or str(COMENTARIOS_DIR / "chat_feed.txt")
COMENTARIO_TXT_FORMATO = os.environ.get("KICK_COMENTARIO_TXT_FORMATO", "plain").lower()
COMENTARIO_TXT_MAX_LINEAS = int(os.environ.get("KICK_COMENTARIO_TXT_MAX_LINEAS", 500))
# Si se define, cada lote nuevo se manda por HTTP POST (JSON {timestamp, mensajes})
# a esta URL — "mandar eso directamente" a otro proyecto sin tocar disco.
COMENTARIO_WEBHOOK = os.environ.get("KICK_COMENTARIO_WEBHOOK", "")
# Si se define, tras escribir cada lote se ejecuta este comando y se le pasa
# como último argumento la ruta del lote_<ts>.json. Ej:
#   KICK_COMENTARIO_HOOK_CMD=python C:\mi-otro-proyecto\cargar.py
# Así el otro proyecto "se carga solo" cada vez que hay un lote nuevo.
COMENTARIO_HOOK_CMD = os.environ.get("KICK_COMENTARIO_HOOK_CMD", "")
# Endpoint oficial de Kick para enviar mensajes de chat.
KICK_CHAT_ENDPOINT = os.environ.get("KICK_CHAT_ENDPOINT", "https://api.kick.com/public/v1/chat")
KICK_TOKEN_STATE_PATH = METADATA_DIR / "kick_token_state.json"

# --- Modo simulación (probar sin estar en stream) ---------------------
# "1" = el Orquestador corre SOLO M8+M9+M12: el M8 genera resúmenes
# sintéticos (sin captura de pantalla ni stream) y el M12 arma el lote
# de mensajes con Gemini a partir de esos. Sirve para probar el flujo
# completo (contexto -> 30 líneas -> lote) sin transmitir.
SIMULACION = os.environ.get("KICK_SIMULACION", "0").lower() in ("1", "true", "yes", "si")

# --- Captura (Módulos 1 y 2) ------------------------------------------
# "local"  = ffmpeg captura la pantalla/ventana y el audio del sistema.
# "remote" = ffmpeg lee el HLS (.m3u8) del canal de Kick en vivo.
CAPTURE_MODE = os.environ.get("KICK_CAPTURE_MODE", "local").lower()
CANAL_SLUG = os.environ.get("KICK_CANAL_SLUG", "")
# URL del .m3u8 en vivo. Si se deja vacío y CAPTURE_MODE=remote, los módulos
# la resuelven solos a partir del slug con resolver_hls_url().
HLS_URL_MANUAL = os.environ.get("KICK_HLS_URL", "")


def ensure_dirs():
    """Crea todas las carpetas necesarias si no existen. Idempotente."""
    for d in ALL_DIRS:
        d.mkdir(parents=True, exist_ok=True)


def heartbeat(modulo_nombre: str):
    """
    Escribe/actualiza el archivo de heartbeat de un módulo.
    El Orquestador (Módulo 10) lee estos archivos para saber si el módulo sigue vivo.
    Cada módulo debe llamar a esto en cada ciclo de su bucle principal.
    """
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    path = LOGS_DIR / f"{modulo_nombre}_heartbeat.txt"
    path.write_text(str(int(time.time())))


def log(modulo_nombre: str, mensaje: str, nivel: str = "INFO"):
    """
    Escribe una línea de log con timestamp en el log propio del módulo.
    Cada módulo tiene su PROPIO archivo de log — nunca comparten archivo,
    así un módulo con logs muy verbosos no tapa los de otro.
    """
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    path = LOGS_DIR / f"{modulo_nombre}.log"
    linea = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [{nivel}] {mensaje}\n"
    with open(path, "a", encoding="utf-8") as f:
        f.write(linea)
    print(linea, end="")


def escribir_json(path: Path, data: dict):
    """Escritura atómica de JSON: escribe a un .tmp y luego renombra.
    Evita que otro módulo lea un archivo JSON a medio escribir."""
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def leer_json_seguro(path: Path):
    """Lee un JSON y devuelve None si el archivo no existe o está corrupto,
    en vez de lanzar una excepción que tumbe el módulo entero."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def leer_gen_config() -> dict:
    """Ajustes de generación editados desde el panel /kc. Devuelve defaults
    razonables si el archivo no existe."""
    d = leer_json_seguro(GEN_CONFIG_PATH) or {}
    mezcla = d.get("mezcla") or {}
    return {
        "modo": d.get("modo") if d.get("modo") in ("auto", "manual") else "auto",
        "contexto_manual": str(d.get("contexto_manual") or "").strip(),
        "contexto_extra": str(d.get("contexto_extra") or "").strip(),
        "cantidad": int(d["cantidad"]) if str(d.get("cantidad") or "").isdigit() else COMENTARIO_LOTE,
        "mezcla": {k: int(v) for k, v in mezcla.items() if str(v).lstrip("-").isdigit()},
    }


def _consultar_canal_kick(slug: str = ""):
    """GET público a la API de Kick para el canal. Devuelve el dict o None."""
    slug = slug or CANAL_SLUG
    if not slug:
        return None
    try:
        import requests
    except ImportError:
        return None
    headers = {
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
        "Accept": "application/json",
    }
    for url in (f"https://kick.com/api/v2/channels/{slug}",
                f"https://kick.com/api/v1/channels/{slug}"):
        try:
            r = requests.get(url, headers=headers, timeout=10)
            if r.status_code == 200:
                return r.json()
        except Exception:
            continue
    return None


def canal_en_vivo(slug: str = ""):
    """True/False si el canal está transmitiendo ahora. None si no se pudo saber."""
    if SIMULACION:
        return True
    datos = _consultar_canal_kick(slug)
    if datos is None:
        return None
    ls = datos.get("livestream") or datos.get("stream")
    if isinstance(ls, dict):
        return bool(ls.get("is_live"))
    return bool(ls)


def resolver_hls_url(slug: str = ""):
    """Devuelve la URL del .m3u8 en vivo del canal.
    Prioridad: KICK_HLS_URL manual > API pública de Kick a partir del slug.
    Devuelve None si no se pudo resolver (Kick caído, canal offline, o
    Cloudflare bloqueó la request — en ese caso poné la URL a mano en
    KICK_HLS_URL, se saca del navegador: DevTools > Network > filtro 'm3u8')."""
    if HLS_URL_MANUAL:
        return HLS_URL_MANUAL
    datos = _consultar_canal_kick(slug)
    if datos:
        return datos.get("playback_url")
    return None


def espera_si_canal_offline(modulo_nombre: str, segundos: int = 30) -> bool:
    """Solo en modo remoto: si el canal NO está en vivo, actualiza heartbeat,
    espera `segundos` y devuelve True (el módulo debe saltear ese ciclo sin
    considerarlo un error). Devuelve False si el canal está en vivo, si no se
    pudo verificar, o si el modo es local."""
    if CAPTURE_MODE != "remote":
        return False
    if canal_en_vivo() is False:
        log(modulo_nombre, f"Canal '{CANAL_SLUG}' fuera de vivo. Reintento en {segundos}s.")
        # Latir seguido durante la espera para que el Orquestador no lo dé por caído.
        transcurrido = 0
        while transcurrido < segundos:
            heartbeat(modulo_nombre)
            time.sleep(5)
            transcurrido += 5
        return True
    return False


def leer_estado_deseado() -> dict:
    """Devuelve el dict {nombre_modulo: activo(bool)} que escribe el Panel
    (Módulo 11). Si el archivo no existe todavía, devuelve {} y el
    Orquestador asume que todos los módulos deben estar activos."""
    return leer_json_seguro(CONTROL_ESTADO_PATH) or {}


def timestamp_desde_nombre(path: Path):
    """Extrae el timestamp Unix del nombre de archivo. Soporta dos formatos:
      prefijo_1735300000.ext        -> unix directo
      prefijo_20260828-143726.ext   -> fecha-hora local (ffmpeg -strftime;
                                       en Windows %s no funciona, por eso este)
    """
    try:
        ultimo = path.stem.split("_")[-1]
    except IndexError:
        return None
    try:
        from datetime import datetime
        return int(datetime.strptime(ultimo, "%Y%m%d-%H%M%S").timestamp())
    except ValueError:
        pass
    try:
        return int(ultimo)
    except ValueError:
        return None
