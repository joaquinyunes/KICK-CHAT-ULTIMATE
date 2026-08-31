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
INTERVALO_SEG = int(os.environ.get("KICK_RESUMEN_INTERVALO_SEG", 120))
BACKOFF_MAX_SEG = 300
USAR_AUDIO = os.environ.get("KICK_RESUMEN_AUDIO", "1") not in ("0", "false", "False", "")
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
                 "-frames:v", "1", "-vf", "scale=1152:-2",
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


def _frames_actuales():
    """Frames del video reciente. Con N_FRAMES=2 manda uno viejo + uno nuevo
    para que Gemini vea qué cambió; con 1 (default) solo el más reciente."""
    clips = _clips_video()
    if not clips:
        return []
    if N_FRAMES >= 2 and len(clips) >= 4:
        elegidos = [clips[-4], clips[-1]]
    else:
        elegidos = [clips[-1]]
    frames = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, clip in enumerate(elegidos):
            out = Path(tmp) / f"f{i}.jpg"
            if _extraer_frame(clip, out):
                frames.append(out.read_bytes())
    return frames


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


def _armar_prompt(historico: list, n_frames: int, nota: str,
                  titulo: str = "", quieto: bool = False) -> str:
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

    bloque_ventana = (
        f'VENTANA / PESTAÑA ACTIVA (lo que tiene abierto y enfocado ahora):\n"{titulo}"\n'
        if titulo else "VENTANA ACTIVA: (no se pudo leer)\n"
    )

    bloque_quieto = ""
    if quieto:
        bloque_quieto = (
            "\nATENCIÓN: la captura de AHORA es casi IDÉNTICA a la anterior — nadie "
            "tocó nada, la pantalla está quieta. Si en el audio tampoco se lo escucha "
            "metido en una actividad puntual, entonces NO está haciendo nada: "
            'fase = "pausa" y resumen_actual = que está quieto/AFK en esa ventana. '
            "NO inventes una partida, un giro, una apuesta ni un balance.\n"
        )

    return f"""Sos el asistente de un streamer de Kick. Le contás, en una o dos frases, QUÉ ESTÁ HACIENDO ÉL puntualmente ahora, para que retome el hilo de un vistazo.

{nota_frames} También te paso ~30 segundos de AUDIO del stream.
{bloque_nota}
{bloque_ventana}{bloque_quieto}
CÓMO DECIDIR "fase" y "resumen_actual" — EN ESTE ORDEN:
1. La VENTANA ACTIVA de arriba es la base: te dice la app / pestaña / juego / slot
   (ej. "Gates of Olympus - Stake", "Aston Villa vs Arsenal - Sofascore",
   "proyecto - Visual Studio Code", "YouTube"). Arrancá de ahí.
2. La CAPTURA sirve para agregar el detalle concreto SOLO si se lee CLARO
   (equipos, cuotas, cartas, montos, nombre del slot). Si algo no se lee nítido,
   NO lo pongas.
3. Los RESÚMENES ANTERIORES son SOLO para "contexto_previo". Si la ventana/pantalla
   muestran otra cosa que antes, la actividad CAMBIÓ: reportá la nueva.

PROHIBIDO INVENTAR. No nombres un slot, un balance, un monto, una apuesta, un
marcador, un equipo, unas cartas o un multiplicador que NO estén claramente
visibles en la captura o en el título. Ante la duda: describí de forma general
("mirando la home de Stake", "en una pestaña de apuestas") o poné fase "pausa".

SI NO ESTÁ HACIENDO NADA (pantalla quieta, en un menú, la misma imagen de siempre,
AFK, mirando el chat sin más): fase = "pausa" y decilo tal cual, sin adornar.
Es MUCHO mejor decir "no está haciendo nada puntual" que inventar una actividad.

DEL AUDIO: resumí qué dice o qué pasa (una jugada narrada, una reacción), no lo transcribas. Si es solo música o silencio, ignoralo (no alcanza para decir que está en una actividad).

IGNORÁ el chat de espectadores. No menciones lo que escriben los viewers.

RESÚMENES ANTERIORES (solo para "contexto_previo", del más viejo al más nuevo):
{bloque_historico}

Español rioplatense, directo. Devolvé ÚNICAMENTE este JSON:
{{
  "fase": "UNA palabra, según la ventana activa + la pantalla de AHORA: apostando | slots | poker | ruleta | jugando | programando | charlando | viendo-deporte | pausa | cargando | otro. Si no hay actividad clara → pausa.",
  "resumen_actual": "qué está haciendo AHORA, arrancando del título de la ventana y sumando SOLO datos que se lean claros. 1-2 frases. Si está quieto/AFK/en un menú: decí eso, sin inventar. NO repitas el resumen anterior si cambió.",
  "contexto_previo": "qué venía haciendo antes, tomado de los resúmenes anteriores",
  "tendencia_detectada": "hacia dónde va"
}}"""


_ultima_firma_frame = None  # miniatura del frame anterior, para ver si la pantalla se movió


def _titulo_ventana_activa() -> str:
    """Qué ventana / pestaña tiene abierta y enfocada. Es la señal MÁS confiable
    de qué está haciendo y no alucina como la lectura de píxeles.
    Usa las muestras que deja el Módulo 1 (el título que más apareció en los
    últimos ~2,5 min); si no hay, lee el foreground ahora mismo."""
    try:
        p = config.METADATA_DIR / "ventana_activa.txt"
        if p.is_file():
            ahora = time.time()
            recientes = []
            for ln in p.read_text(encoding="utf-8").splitlines()[-40:]:
                ts, _, tit = ln.partition("\t")
                try:
                    if tit.strip() and ahora - int(ts) < 150:
                        recientes.append(tit.strip())
                except ValueError:
                    pass
            if recientes:
                return max(set(recientes), key=recientes.count)
    except OSError:
        pass
    if sys.platform != "win32":
        return ""
    try:
        import ctypes
        u = ctypes.windll.user32
        h = u.GetForegroundWindow()
        n = u.GetWindowTextLengthW(h)
        buf = ctypes.create_unicode_buffer(n + 1)
        u.GetWindowTextW(h, buf, n + 1)
        return (buf.value or "").strip()
    except Exception:
        return ""


def _firma_frame(jpg_bytes: bytes):
    """Miniatura 24x24 en gris del frame (bytes crudos) para comparar dos frames."""
    if not jpg_bytes:
        return None
    try:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "s.jpg"
            src.write_bytes(jpg_bytes)
            r = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
                 "-vf", "scale=24:24,format=gray", "-f", "rawvideo", "-"],
                capture_output=True, timeout=10)
            return r.stdout if r.returncode == 0 and r.stdout else None
    except Exception:
        return None


def _pantalla_quieta(firma_nueva) -> bool:
    """True si el frame de ahora es casi idéntico al anterior (nadie tocó nada)."""
    global _ultima_firma_frame
    prev, _ultima_firma_frame = _ultima_firma_frame, firma_nueva
    if not prev or not firma_nueva or len(prev) != len(firma_nueva):
        return False
    dif = sum(abs(a - b) for a, b in zip(prev, firma_nueva)) / len(firma_nueva)
    return dif < 5.0   # ~5 niveles de gris de diferencia promedio ⇒ quieto


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


# --- Modo simulación (sin captura ni stream) --------------------------
_ESCENARIOS_SIM = [
    {"fase": "apostando",
     "resumen_actual": "Armando una combinada: Boca gana + Over 2.5 goles en el Real Madrid–Barcelona, cuota total 3.85, mete 8.000.",
     "tendencia_detectada": "va a esperar el resultado del primer tiempo antes de cobrar."},
    {"fase": "slots",
     "resumen_actual": "Jugando Gates of Olympus, viene 25 giros sin bonus y el balance bajó de 210.000 a 140.000.",
     "tendencia_detectada": "si no entra el bonus pronto se cambia de slot."},
    {"fase": "slots",
     "resumen_actual": "Entró un Mega Win de 45.000 en Sugar Rush con apuesta de 1.000, el balance venía en 90.000.",
     "tendencia_detectada": "quiere subir la apuesta a 2.000 por el envión."},
    {"fase": "poker",
     "resumen_actual": "En una mano con A-K, pagó un flop 10-J-2, hay 12.000 en el pozo y el rival apostó fuerte.",
     "tendencia_detectada": "está pensando si paga el turn o se retira."},
    {"fase": "viendo-deporte",
     "resumen_actual": "Mirando el River–Racing por ESPN, va 1-0 River al minuto 32, comenta el gol de Colidio.",
     "tendencia_detectada": "quiere apostar el 2-0 en vivo si sigue así."},
    {"fase": "charlando",
     "resumen_actual": "Just chatting: contando una anécdota de un viaje a Bariloche y leyendo mensajes del chat.",
     "tendencia_detectada": "va a arrancar con casino en un rato."},
    {"fase": "ruleta",
     "resumen_actual": "En la ruleta en vivo, apostando a docena del medio y a rojo, viene de perder 3 tiradas seguidas.",
     "tendencia_detectada": "está por hacer un martingala en rojo."},
    {"fase": "jugando",
     "resumen_actual": "Jugando EA FC 25 Ultimate Team, va perdiendo 2-1 en el minuto 70, pidiendo consejos al chat.",
     "tendencia_detectada": "si pierde este cierra el modo y pasa a casino."},
]


def _resumen_simulado(requests) -> dict:
    """Devuelve un resumen sintético. Si hay key de Gemini, le pide que
    varíe un escenario; si no, usa uno fijo de la lista."""
    base = _ESCENARIOS_SIM[int(time.time() // max(INTERVALO_SEG, 1)) % len(_ESCENARIOS_SIM)]
    if config.LLM_PROVIDER == "gemini" and config.GEMINI_API_KEY:
        try:
            prompt = (
                "Sos el asistente de un streamer argentino de Kick (casino / apuestas / just chatting). "
                "Inventá qué está haciendo AHORA, realista y concreto, tomando como punto de partida esta idea: "
                f"\"{base['resumen_actual']}\". Variá los datos (equipos, montos, slot, cartas). "
                "Devolvé SOLO este JSON: {\"fase\":\"...\",\"resumen_actual\":\"1-2 frases\","
                "\"contexto_previo\":\"qué venía haciendo\",\"tendencia_detectada\":\"hacia dónde va\"}"
            )
            crudo = _llamar_gemini_modelo(requests, MODELOS_GEMINI[0], [{"text": prompt}])
            parsed = _parsear_respuesta(crudo)
            if parsed and parsed.get("resumen_actual"):
                return parsed
        except Exception as e:
            config.log(MODULO, f"[SIM] Gemini no varió el escenario ({e}), uso el fijo.", "WARN")
    return {**base, "contexto_previo": "venía en otra actividad del stream"}


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
    config.log(MODULO, f"Módulo 8 (Resumen) iniciado. {config.LLM_PROVIDER}, "
                       f"modelos: {', '.join(MODELOS_GEMINI)}, cada {INTERVALO_SEG}s, "
                       f"audio={'sí' if USAR_AUDIO else 'no'}.")
    requests = _cargar_requests()

    if config.LLM_PROVIDER == "gemini" and not config.GEMINI_API_KEY and not config.SIMULACION:
        config.log(MODULO, "provider=gemini pero falta KICK_GEMINI_API_KEY en el .env.", "ERROR")
        sys.exit(1)

    backoff = INTERVALO_SEG
    manual = False   # el último despertar fue por "Analizar ahora" del Panel

    def _dormir(segundos):
        """Duerme, pero se corta apenas el Panel pide 'Analizar ahora'.
        Devuelve True si se cortó por pedido manual."""
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

            if config.SIMULACION:
                parsed = _resumen_simulado(requests)
            else:
                if config.LLM_PROVIDER == "gemini":
                    _procesar_audios_nota(requests)
                frames = _frames_actuales()
                audio = _audio_actual()

                titulo = _titulo_ventana_activa()
                quieto = _pantalla_quieta(_firma_frame(frames[0]) if frames else None)

                if not frames and not audio:
                    config.log(MODULO, "Todavía no hay captura (¿módulos 1/2 corriendo? ¿pantalla activa?).", "WARN")
                    manual = _dormir(15) or manual   # reintento pronto, no esperar el intervalo completo
                    continue

                # En un pedido manual el usuario acaba de cambiar de actividad:
                # NO le pasamos historial para que Gemini describa SOLO la pantalla.
                historico = [] if manual else obtener_ultimos_resumenes(2)
                prompt = _armar_prompt(historico, len(frames), _leer_nota(), titulo, quieto)
                config.heartbeat(MODULO)
                parsed = _parsear_respuesta(_llamar_llm(requests, prompt, frames, audio))
                config.log(MODULO, f"Ventana activa: {titulo or '(desconocida)'}"
                                   + ("  · pantalla QUIETA" if quieto else ""))

            if not parsed:
                config.log(MODULO, "Respuesta del modelo no es JSON válido, se descarta este ciclo.", "WARN")
            else:
                resultado = {
                    "timestamp": int(time.time()),
                    "fase": parsed.get("fase"),
                    "resumen_actual": parsed.get("resumen_actual"),
                    "contexto_previo": parsed.get("contexto_previo"),
                    "tendencia_detectada": parsed.get("tendencia_detectada"),
                }
                config.escribir_json(
                    config.SUMMARIES_DIR / f"resumen_{resultado['timestamp']}.json", resultado)
                config.log(MODULO, f"[{resultado.get('fase')}] {resultado['resumen_actual']}")

            backoff = INTERVALO_SEG
            manual = _dormir(INTERVALO_SEG)

        except Exception as e:
            config.log(MODULO, f"LLM ({config.LLM_PROVIDER}) no disponible: {e}. Reintento en {backoff}s.", "WARN")
            manual = _dormir(backoff) or manual
            backoff = min(int(backoff * 1.7), BACKOFF_MAX_SEG)


if __name__ == "__main__":
    main()
