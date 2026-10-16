"""
Módulo 8 — Resumen del stream (Gemini multimodal)

Cada ~2 min: toma un frame actual del video + ~30 s de audio reciente y se
los manda a Gemini, que MIRA la pantalla y ESCUCHA el audio y devuelve un
resumen en español de qué está haciendo el streamer.

No usa OCR ni transcripción local (Whisper): Gemini interpreta la imagen y
el audio directamente, mucho mejor en streams con overlays cargados.

Si Gemini no responde (rate limit / 503 / sin internet), este módulo NO
tumba nada: reintenta con backoff.

Uso:
    python resumen_llm.py

Variables de entorno:
    KICK_LLM_PROVIDER          "gemini" | "ollama"   (default "ollama")
    KICK_GEMINI_API_KEY        clave de aistudio.google.com
    KICK_GEMINI_MODEL          default "gemini-flash-lite-latest"
    KICK_RESUMEN_INTERVALO_SEG cada cuánto resume (default 120)
    KICK_RESUMEN_AUDIO         "1" para mandarle el audio a Gemini (default "1")
    KICK_RESUMEN_MODO          "rapido" = mira cada ~10 s, 1 frame liviano, sin
                               audio, y solo llama al modelo si la pantalla
                               cambió (objetivo: < 15 s de atraso). Default "completo".
    KICK_RESUMEN_UMBRAL_CAMBIO cuánto tiene que cambiar la pantalla (0-1, default 0.04)
"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "modulo09_memoria_historica"))
import config  # noqa: E402
from memoria_historica import obtener_ultimos_resumenes  # noqa: E402

MODULO = "modulo08_resumen_llm"
RAPIDO = os.environ.get("KICK_RESUMEN_MODO", "completo").lower() == "rapido"
INTERVALO_SEG = int(os.environ.get("KICK_RESUMEN_INTERVALO_SEG", 10 if RAPIDO else 120))
# En modo rápido, aunque la pantalla no cambie, refresca cada tanto igual.
REFRESCO_MAX_SEG = 120
UMBRAL_CAMBIO = float(os.environ.get("KICK_RESUMEN_UMBRAL_CAMBIO", 0.04))
ANCHO_FRAME = 768 if RAPIDO else 1152
BACKOFF_MAX_SEG = 300
USAR_AUDIO = (not RAPIDO and
              os.environ.get("KICK_RESUMEN_AUDIO", "1") not in ("0", "false", "False", ""))
CLIPS_AUDIO = 3  # cuántos clips del buffer juntar (~30 s)
# 1 = más rápido y confiable; 2 = ve el "antes y después" pero pesa el doble.
N_FRAMES = max(1, min(2, int(os.environ.get("KICK_RESUMEN_FRAMES", 1))))
GEMINI_TIMEOUT = int(os.environ.get("KICK_GEMINI_TIMEOUT", 75))

# Modelos de Gemini a probar en orden (si uno da 503/429, se prueba el siguiente).
MODELOS_GEMINI = [m.strip() for m in os.environ.get(
    "KICK_GEMINI_MODELS",
    f"{os.environ.get('KICK_GEMINI_MODEL', 'gemini-flash-lite-latest')},gemini-2.5-flash"
).split(",") if m.strip()]

# Archivo que toca el Panel para pedir un resumen YA (botón "Analizar ahora").
TRIGGER = None  # se setea en main() a partir de config


def _cargar_requests():
    try:
        import requests
        return requests
    except ImportError:
        config.log(MODULO, "Falta 'requests'. Correr: pip install requests", "ERROR")
        sys.exit(1)


def _extraer_frame(clip: Path, out: Path) -> bool:
    """Un frame del clip, a ~1150px de ancho y buena calidad JPEG (para que
    Gemini pueda LEER montos, cuotas, cartas, balances). Prueba distintos
    puntos de seek por si el clip es corto."""
    for ss in ("3", "1", "0"):
        try:
            r = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-ss", ss, "-i", str(clip),
                 "-frames:v", "1", "-vf", f"scale={ANCHO_FRAME}:-2",
                 # yuvj420p (full-range) es lo que quiere el encoder mjpeg;
                 # gdigrab entrega full-range y sin esto falla.
                 "-pix_fmt", "yuvj420p", str(out)],
                capture_output=True, timeout=20)
        except subprocess.TimeoutExpired:
            return False
        if r.returncode == 0 and out.exists() and out.stat().st_size > 0:
            return True
    return False


def _clips_video():
    if not config.BUFFER_VIDEO_DIR.exists():
        return []
    clips = [f for f in config.BUFFER_VIDEO_DIR.iterdir()
             if f.suffix.lower() in (".ts", ".mp4")]
    return sorted(clips)


def _ts_frame(clip: Path) -> float:
    """Momento real del frame: inicio del clip (por nombre; si no, mtime menos
    la duración) + los 3 s de seek de _extraer_frame. El mtime solo es el FINAL
    del clip, y medir desde ahí esconde ~7 s de atraso."""
    inicio = config.timestamp_desde_nombre(clip)
    if inicio is None:
        inicio = clip.stat().st_mtime - config.DURACION_CLIP_SEGUNDOS
    return inicio + 3


def _frames_actuales():
    """Frames del video reciente + el momento real del frame (para medir atraso).
    Con N_FRAMES=2 manda uno viejo + uno nuevo para que Gemini vea qué cambió;
    con 1 (default, y siempre en modo rápido) solo el más reciente."""
    clips = _clips_video()
    if not clips:
        return [], None
    if N_FRAMES >= 2 and len(clips) >= 4 and not RAPIDO:
        elegidos = [clips[-4], clips[-1]]
    else:
        elegidos = [clips[-1]]
    frames = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, clip in enumerate(elegidos):
            out = Path(tmp) / f"f{i}.jpg"
            if _extraer_frame(clip, out):
                frames.append(out.read_bytes())
    return frames, _ts_frame(elegidos[-1])


def _huella(jpg: bytes):
    """Miniatura 32x32 en gris (1024 bytes) para comparar frames sin IA."""
    try:
        r = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-vf",
             "scale=32:32,format=gray", "-f", "rawvideo", "pipe:1"],
            input=jpg, capture_output=True, timeout=10)
    except subprocess.TimeoutExpired:
        return None
    return r.stdout if r.returncode == 0 and len(r.stdout) == 1024 else None


def _diferencia(a: bytes, b: bytes) -> float:
    """0 = idénticas, 1 = opuestas. Sin huella previa cuenta como cambio total."""
    if not a or not b or len(a) != len(b):
        return 1.0
    return sum(abs(x - y) for x, y in zip(a, b)) / (255 * len(a))


def _audio_actual():
    """Junta los últimos CLIPS_AUDIO clips de audio del buffer en un mp3."""
    if not USAR_AUDIO:
        return None
    clips = sorted(config.BUFFER_AUDIO_DIR.glob("*.wav")) if config.BUFFER_AUDIO_DIR.exists() else []
    if not clips:
        return None
    clips = clips[-CLIPS_AUDIO:]
    with tempfile.TemporaryDirectory() as tmp:
        lista = Path(tmp) / "l.txt"
        lista.write_text("".join(f"file '{c}'\n" for c in clips), encoding="utf-8")
        out = Path(tmp) / "a.mp3"
        try:
            r = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                 "-i", str(lista), "-ac", "1", "-ar", "16000", "-b:a", "28k", str(out)],
                capture_output=True, timeout=25)
        except subprocess.TimeoutExpired:
            return None
        if r.returncode == 0 and out.exists():
            return out.read_bytes()
    return None


_EXT_AUDIO_NOTA = (".mp3", ".wav", ".m4a", ".ogg", ".opus", ".aac", ".flac")
_MIME_NOTA = {".mp3": "audio/mp3", ".wav": "audio/wav", ".m4a": "audio/mp4",
              ".ogg": "audio/ogg", ".opus": "audio/ogg", ".aac": "audio/aac",
              ".flac": "audio/flac"}


def _leer_nota() -> str:
    try:
        return config.NOTA_USUARIO_TXT.read_text(encoding="utf-8").strip()
    except (FileNotFoundError, OSError):
        return ""


def _transcribir_nota(requests, audio_bytes, mime) -> str:
    """Le pide a Gemini que transcriba una nota de voz del streamer."""
    parts = [
        {"text": "Transcribí textualmente esta nota de voz en español. "
                 "Devolvé SOLO la transcripción, sin comillas ni comentarios."},
        {"inline_data": {"mime_type": mime, "data": base64.b64encode(audio_bytes).decode()}},
    ]
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{config.GEMINI_MODEL}:generateContent")
    resp = requests.post(url, headers={"x-goog-api-key": config.GEMINI_API_KEY},
                         json={"contents": [{"parts": parts}]}, timeout=90)
    resp.raise_for_status()
    try:
        return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError):
        return ""


def _a_mp3_compacto(origen: Path):
    """Reencoda cualquier audio a un mp3 chico (mono 16k 28k). Devuelve bytes."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "n.mp3"
        try:
            r = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(origen),
                 "-ac", "1", "-ar", "16000", "-b:a", "28k", str(out)],
                capture_output=True, timeout=30)
        except subprocess.TimeoutExpired:
            return None
        if r.returncode == 0 and out.exists():
            return out.read_bytes()
    return None


def _procesar_audios_nota(requests):
    """Busca notas de voz nuevas dejadas por el usuario, las transcribe y las
    agrega a nota.txt. Mueve el audio a procesados/ para no repetir."""
    carpeta = config.NOTA_USUARIO_DIR
    if not carpeta.exists():
        return
    nuevos = [f for f in sorted(carpeta.iterdir())
              if f.is_file() and f.suffix.lower() in _EXT_AUDIO_NOTA]
    for f in nuevos:
        try:
            audio_mp3 = _a_mp3_compacto(f) or f.read_bytes()
            texto = _transcribir_nota(requests, audio_mp3, "audio/mp3")
            if texto:
                linea = f"[{time.strftime('%H:%M')}] {texto}"
                previo = _leer_nota()
                lineas = ([previo] if previo else []) + [linea]
                config.NOTA_USUARIO_TXT.write_text(
                    "\n".join(lineas[-15:]), encoding="utf-8")
                config.log(MODULO, f"Nota de voz agregada: {texto[:80]}")
            config.NOTA_USUARIO_PROCESADOS.mkdir(parents=True, exist_ok=True)
            f.rename(config.NOTA_USUARIO_PROCESADOS / f.name)
        except Exception as e:
            config.log(MODULO, f"No se pudo procesar la nota {f.name}: {e}", "WARN")


def _armar_prompt(historico: list, n_frames: int, nota: str) -> str:
    bloque_historico = "\n".join(
        f"- {h['resumen_actual']}" for h in historico if h.get("resumen_actual")
    ) or "(sin resúmenes previos todavía)"

    nota_frames = ("Te paso 2 capturas de pantalla (una de ~30s atrás y otra de ahora) "
                   "para que veas qué CAMBIÓ." if n_frames >= 2
                   else "Te paso 1 captura de pantalla.")

    bloque_nota = ""
    if nota:
        bloque_nota = f"""
INDICACIONES DEL PROPIO STREAMER (tenelas MUY en cuenta, son lo que él quiere que mires / avises):
{nota}
"""

    return f"""Sos el asistente de un streamer de Kick. Le contás, en una o dos frases, QUÉ ESTÁ HACIENDO ÉL puntualmente ahora, para que retome el hilo de un vistazo.

{nota_frames} También te paso ~30 segundos de AUDIO del stream.
{bloque_nota}
RESÚMENES ANTERIORES (del más viejo al más nuevo):
{bloque_historico}

CÓMO MIRAR LA PANTALLA — enfocate en la ACCIÓN puntual, no en el decorado:
- NO describas todo lo que hay en pantalla. Identificá LO QUE ESTÁ MIRANDO/HACIENDO ahora (dónde está el foco, el mouse, lo que se está moviendo) y contá ESO.
- Apuestas deportivas: qué apuesta puntual está armando o mirando — qué equipos, qué mercado (ganador, hándicap, over/under), qué cuota, si es simple o combinada, cuánto pone. Ej: "armando una combinada de Boca gana + over 2.5 en el United".
- Slots: qué slot es (nombre), y cómo viene — si está pagando o no, si viene perdiendo el balance, si entró un bonus. Ej: "jugando Gates of Olympus, sin pagar hace varios giros, el balance viene bajando".
- Póker: en qué mano está — sus cartas si se ven, el board, el pozo, si ganó o perdió la última. Ej: "en una mano con AK, pagó el flop, hay pozo grande".
- Programando: qué lenguaje/archivo y qué está construyendo o debuggeando puntualmente.
- Si de verdad no está haciendo nada concreto (menú, cargando, mirando la nada), decilo tal cual.

DEL AUDIO: resumí qué dice o qué pasa (una jugada narrada, una reacción), no lo transcribas. Si es solo música, ignoralo.

IGNORÁ el chat de espectadores. No menciones lo que escriben los viewers.

Español rioplatense, directo. Devolvé ÚNICAMENTE este JSON:
{{
  "evento": "si pasó algo puntual respecto al resumen anterior (pegó un bonus, cambió de slot, ganó/perdió la mano, cerró la apuesta), en pocas palabras; si no pasó nada nuevo, null",
  "detalle": {{"juego": "nombre del slot/juego/partido/programa o null", "apuesta": "monto o cuota visible o null", "balance": "balance visible o null", "resultado": "si pagó/ganó/perdió o null"}},
  "fase": "UNA palabra que resuma qué está haciendo: apostando | slots | poker | ruleta | jugando | programando | charlando | viendo-deporte | pausa | cargando | otro",
  "resumen_actual": "la acción puntual de ahora, concreta y con datos (equipos, cuotas, slot, cartas, montos), 1-2 frases",
  "contexto_previo": "qué venía haciendo antes (resúmenes anteriores + lo que cambió entre las 2 capturas)",
  "tendencia_detectada": "hacia dónde va"
}}"""


def _llamar_ollama(requests, prompt, _frames, _audio):
    resp = requests.post(config.OLLAMA_URL,
                         json={"model": config.OLLAMA_MODEL, "prompt": prompt, "stream": False},
                         timeout=120)
    resp.raise_for_status()
    return resp.json().get("response", "")


def _llamar_gemini_modelo(requests, modelo, parts):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{modelo}:generateContent")
    resp = requests.post(url, headers={"x-goog-api-key": config.GEMINI_API_KEY},
                         json={"contents": [{"parts": parts}],
                               "generationConfig": {"response_mime_type": "application/json",
                                                    "temperature": 0.4}},
                         timeout=GEMINI_TIMEOUT)
    if resp.status_code in (429, 500, 503):
        raise RuntimeError(f"{modelo}: ocupado ({resp.status_code})")
    resp.raise_for_status()
    try:
        return resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return ""


def _llamar_gemini(requests, prompt, frames, audio_bytes):
    if not config.GEMINI_API_KEY:
        raise RuntimeError("Falta KICK_GEMINI_API_KEY en el .env")
    parts = [{"text": prompt}]
    for fb in (frames or []):
        parts.append({"inline_data": {"mime_type": "image/jpeg",
                                      "data": base64.b64encode(fb).decode()}})
    if audio_bytes:
        parts.append({"inline_data": {"mime_type": "audio/mp3",
                                      "data": base64.b64encode(audio_bytes).decode()}})
    # Probar cada modelo en orden; si todos fallan, propagar el último error.
    ultimo_error = None
    for modelo in MODELOS_GEMINI:
        try:
            return _llamar_gemini_modelo(requests, modelo, parts)
        except Exception as e:
            ultimo_error = e
            config.log(MODULO, f"{e}. Probando el siguiente modelo...", "WARN")
    raise ultimo_error or RuntimeError("Sin modelos de Gemini configurados")


def _llamar_llm(requests, prompt, frames, audio_bytes):
    if config.LLM_PROVIDER == "gemini":
        return _llamar_gemini(requests, prompt, frames, audio_bytes)
    return _llamar_ollama(requests, prompt, frames, audio_bytes)


def _parsear_respuesta(texto):
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        i, f = texto.find("{"), texto.rfind("}")
        if i != -1 and f != -1:
            try:
                return json.loads(texto[i:f + 1])
            except json.JSONDecodeError:
                return None
        return None


def _hay_pedido_manual():
    """True si el Panel pidió un resumen inmediato (y consume el pedido)."""
    try:
        if config.ANALIZAR_AHORA_PATH.exists():
            config.ANALIZAR_AHORA_PATH.unlink()
            return True
    except OSError:
        pass
    return False


def main():
    config.ensure_dirs()
    config.log(MODULO, f"Módulo 8 (Resumen) iniciado{' en modo RÁPIDO' if RAPIDO else ''}. {config.LLM_PROVIDER}, "
                       f"modelos: {', '.join(MODELOS_GEMINI)}, cada {INTERVALO_SEG}s, "
                       f"audio={'sí' if USAR_AUDIO else 'no'}.")
    requests = _cargar_requests()

    if config.LLM_PROVIDER == "gemini" and not config.GEMINI_API_KEY:
        config.log(MODULO, "provider=gemini pero falta KICK_GEMINI_API_KEY en el .env.", "ERROR")
        sys.exit(1)

    backoff = INTERVALO_SEG
    ultima_huella = None
    ultimo_analisis = 0.0
    forzar = False   # un "Analizar ahora" salta el filtro de pantalla-sin-cambios

    def _dormir(segundos):
        """Duerme, pero se corta apenas el Panel pide 'Analizar ahora'.
        Devuelve True si fue por un pedido manual (hay que analizar sí o sí)."""
        restante = segundos
        while restante > 0:
            config.heartbeat(MODULO)
            if _hay_pedido_manual():
                config.log(MODULO, "Pedido manual de resumen desde el Panel.")
                return True
            time.sleep(min(5, restante))
            restante -= 5
        return False

    while True:
        try:
            config.heartbeat(MODULO)
            if config.LLM_PROVIDER == "gemini":
                _procesar_audios_nota(requests)
            frames, ts_frame = _frames_actuales()
            audio = _audio_actual()

            if RAPIDO and frames:
                huella = _huella(frames[-1])
                cambio = _diferencia(huella, ultima_huella)
                if (not forzar and cambio < UMBRAL_CAMBIO
                        and time.time() - ultimo_analisis < REFRESCO_MAX_SEG):
                    forzar = _dormir(INTERVALO_SEG)   # pantalla igual: no gastar una llamada
                    continue
                ultima_huella = huella

            if not frames and not audio:
                config.log(MODULO, "Todavía no hay captura (¿módulos 1/2 corriendo? ¿pantalla activa?).", "WARN")
                forzar = _dormir(15)   # reintento pronto, no esperar el intervalo completo
                continue

            prompt = _armar_prompt(obtener_ultimos_resumenes(4), len(frames), _leer_nota())

            config.heartbeat(MODULO)
            parsed = _parsear_respuesta(_llamar_llm(requests, prompt, frames, audio))

            ultimo_analisis = time.time()
            if not parsed:
                config.log(MODULO, "Respuesta del modelo no es JSON válido, se descarta este ciclo.", "WARN")
            else:
                ahora = time.time()
                resultado = {
                    "timestamp": int(ahora),
                    "fase": parsed.get("fase"),
                    "evento": parsed.get("evento") or None,
                    "detalle": parsed.get("detalle") if isinstance(parsed.get("detalle"), dict) else None,
                    # Atraso real: desde el momento del frame hasta que hay resumen.
                    "latencia_seg": round(ahora - ts_frame, 1) if ts_frame else None,
                    "resumen_actual": parsed.get("resumen_actual"),
                    "contexto_previo": parsed.get("contexto_previo"),
                    "tendencia_detectada": parsed.get("tendencia_detectada"),
                }
                config.escribir_json(
                    config.SUMMARIES_DIR / f"resumen_{resultado['timestamp']}.json", resultado)
                config.log(MODULO, f"[{resultado.get('fase')}] {resultado['resumen_actual']} "
                                   f"(atraso {resultado['latencia_seg']}s)")

            backoff = INTERVALO_SEG
            forzar = _dormir(INTERVALO_SEG)

        except Exception as e:
            config.log(MODULO, f"LLM ({config.LLM_PROVIDER}) no disponible: {e}. Reintento en {backoff}s.", "WARN")
            forzar = _dormir(backoff)
            backoff = min(int(backoff * 1.7), BACKOFF_MAX_SEG)


if __name__ == "__main__":
    main()
