"""
Módulo 4 — Transcripción de Audio (faster-whisper)

Vigila /data/buffer/audio, transcribe cada clip nuevo y guarda el
resultado como JSON en /data/transcripts.

Este es el módulo más importante como "red de seguridad": si TODO lo
demás falla (video, visual, metadata), este solo ya te da contexto
útil de lo que se está diciendo en el stream.

Uso:
    python3 transcripcion_audio.py

Requiere:
    pip install faster-whisper --break-system-packages

Variables de entorno relevantes:
    KICK_WHISPER_MODEL   tamaño del modelo: tiny/base/small/medium/large-v3 (default "small")
    KICK_WHISPER_DEVICE  "cpu" o "cuda" (default "cpu")
    KICK_WHISPER_IDIOMA  código de idioma forzado (default "es")
    KICK_WHISPER_VAD     "1" para filtrar silencios con VAD (default "1").
                          El VAD evita que Whisper "alucine" texto en los
                          tramos sin voz (muy común con música o silencio).
"""

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
import config  # noqa: E402

MODULO = "modulo04_transcripcion_audio"
INTERVALO_SEG = 3
REGISTRO_PROCESADOS = config.LOGS_DIR / "modulo04_procesados.txt"


def _cargar_modelo():
    """Carga el modelo de Whisper. Aislado en una función para poder
    fallar de forma clara y explicable si la librería no está instalada."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        config.log(
            MODULO,
            "faster-whisper no está instalado. Correr: "
            "pip install faster-whisper --break-system-packages",
            "ERROR",
        )
        sys.exit(1)

    modelo_nombre = os.environ.get("KICK_WHISPER_MODEL", "small")
    device = os.environ.get("KICK_WHISPER_DEVICE", "cpu")
    compute_type = "int8" if device == "cpu" else "float16"

    config.log(MODULO, f"Cargando modelo Whisper '{modelo_nombre}' en {device} ({compute_type})...")
    modelo = WhisperModel(modelo_nombre, device=device, compute_type=compute_type)
    config.log(MODULO, "Modelo cargado correctamente.")
    return modelo


def _cargar_procesados():
    if REGISTRO_PROCESADOS.exists():
        return set(REGISTRO_PROCESADOS.read_text().splitlines())
    return set()


def _marcar_procesado(nombre_archivo: str):
    with open(REGISTRO_PROCESADOS, "a", encoding="utf-8") as f:
        f.write(nombre_archivo + "\n")


def _transcribir_clip(modelo, clip_path: Path):
    idioma = os.environ.get("KICK_WHISPER_IDIOMA", "es")
    usar_vad = os.environ.get("KICK_WHISPER_VAD", "1") not in ("0", "false", "False", "")
    segments, info = modelo.transcribe(
        str(clip_path),
        language=idioma,
        beam_size=1,
        vad_filter=usar_vad,
        vad_parameters={"min_silence_duration_ms": 500},
        # No arrastrar el texto del clip anterior: cada clip es independiente
        # y esto reduce los bucles de repetición típicos de Whisper.
        condition_on_previous_text=False,
    )
    texto = " ".join(seg.text.strip() for seg in segments).strip()

    ts_inicio = config.timestamp_desde_nombre(clip_path)
    if ts_inicio is None:
        ts_inicio = int(clip_path.stat().st_mtime)

    return {
        "timestamp_inicio": ts_inicio,
        "timestamp_fin": ts_inicio + config.DURACION_CLIP_SEGUNDOS,
        "texto": texto,
        "idioma_detectado": getattr(info, "language", idioma),
        "confianza": round(getattr(info, "language_probability", 0.0), 2),
    }


def main():
    config.ensure_dirs()
    config.log(MODULO, "Módulo 4 (Transcripción de Audio) iniciado.")
    config.heartbeat(MODULO)  # latido antes de la carga (puede tardar decenas de seg)
    modelo = _cargar_modelo()
    config.heartbeat(MODULO)
    procesados = _cargar_procesados()

    while True:
        try:
            todos = sorted(config.BUFFER_AUDIO_DIR.glob("*.wav")) if config.BUFFER_AUDIO_DIR.exists() else []
            pendientes = [c for c in todos if c.name not in procesados]

            # Prioridad a la FRESCURA: si hay backlog, se transcribe solo el más
            # nuevo y los viejos se marcan como saltados. Vale más un resumen del
            # último minuto que uno completo pero atrasado.
            if len(pendientes) > 2:
                for viejo in pendientes[:-1]:
                    procesados.add(viejo.name)
                    _marcar_procesado(viejo.name)
                config.log(MODULO, f"Backlog de {len(pendientes)} clips: se saltan "
                                   f"{len(pendientes) - 1} y se transcribe solo el último.", "WARN")
                pendientes = pendientes[-1:]

            for clip in pendientes:
                inicio = time.time()
                try:
                    resultado = _transcribir_clip(modelo, clip)
                except Exception as e:
                    config.log(MODULO, f"Fallo al transcribir {clip.name}: {e}. Se omite y continúa.", "WARN")
                    procesados.add(clip.name)
                    _marcar_procesado(clip.name)
                    continue

                duracion_proceso = round(time.time() - inicio, 2)
                if duracion_proceso > config.DURACION_CLIP_SEGUNDOS:
                    config.log(
                        MODULO,
                        f"Atraso: {clip.name} tardó {duracion_proceso}s (> {config.DURACION_CLIP_SEGUNDOS}s). "
                        f"Bajá KICK_WHISPER_MODEL (tiny) si esto se repite.",
                        "WARN",
                    )

                salida = config.TRANSCRIPTS_DIR / f"transcript_{resultado['timestamp_inicio']}.json"
                config.escribir_json(salida, resultado)

                procesados.add(clip.name)
                _marcar_procesado(clip.name)
                config.heartbeat(MODULO)

            config.heartbeat(MODULO)
        except Exception as e:  # nunca debe tumbar el módulo completo por un ciclo malo
            config.log(MODULO, f"Error inesperado en ciclo de transcripción: {e}", "ERROR")

        time.sleep(INTERVALO_SEG)


if __name__ == "__main__":
    main()
