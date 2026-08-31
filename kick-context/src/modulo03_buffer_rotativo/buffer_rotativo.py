"""
Módulo 3 — Buffer Rotativo

Mantiene en /data/buffer/{video,audio} solo los últimos N clips
(configurable por config.CLIPS_EN_VENTANA), y limpia los archivos
crudos viejos en /data/raw_video y /data/raw_audio.

No captura nada, solo administra archivos. Si video o audio faltan
(porque su módulo está caído), simplemente no hay nada que copiar
para ese tipo — no es un error, sigue funcionando con lo que haya.

Uso:
    python3 buffer_rotativo.py

Variables de entorno relevantes:
    KICK_CONTEXT_VENTANA_SEGUNDOS  tamaño de la ventana de contexto (default 180)
    KICK_BUFFER_RETENCION_RAW_SEG  cuánto conservar en raw_* antes de borrar (default 600)
"""

import os
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
import config  # noqa: E402

MODULO = "modulo03_buffer_rotativo"
INTERVALO_SEG = 5
RETENCION_RAW_SEG = int(os.environ.get("KICK_BUFFER_RETENCION_RAW_SEG", 600))  # 10 min
# Un archivo modificado hace menos de esto probablemente todavía lo está
# escribiendo ffmpeg: no se copia hasta que "se enfríe".
EDAD_MINIMA_SEG = 2


def _listar_ordenado(carpeta: Path):
    """Devuelve los archivos de una carpeta ordenados por timestamp del nombre."""
    if not carpeta.exists():
        return []
    archivos = []
    for f in carpeta.iterdir():
        if not f.is_file():
            continue
        ts = config.timestamp_desde_nombre(f)
        if ts is not None:
            archivos.append((ts, f))
    archivos.sort(key=lambda x: x[0])
    return archivos


def _actualizar_buffer(origen: Path, destino: Path, cantidad_a_mantener: int):
    """Copia al buffer solo los N clips más recientes de `origen`,
    y borra del buffer los que ya no correspondan a la ventana vigente."""
    destino.mkdir(parents=True, exist_ok=True)
    archivos = _listar_ordenado(origen)

    # El más nuevo casi siempre lo está escribiendo ffmpeg todavía: se descarta
    # de esta pasada (entra en la próxima, cuando ya haya uno más nuevo).
    if archivos:
        archivos = archivos[:-1]

    recientes = archivos[-cantidad_a_mantener:] if archivos else []
    nombres_recientes = {f.name for _, f in recientes}
    ahora = time.time()

    # Copiar los que falten en el buffer (y que ya no se estén escribiendo)
    for _, f in recientes:
        destino_path = destino / f.name
        if destino_path.exists():
            continue
        try:
            if ahora - f.stat().st_mtime < EDAD_MINIMA_SEG:
                continue  # todavía "caliente", esperamos al próximo ciclo
            shutil.copy2(f, destino_path)
        except OSError as e:
            config.log(MODULO, f"No se pudo copiar {f.name}: {e}", "WARN")

    # Borrar del buffer lo que ya no está en la ventana vigente
    for f in destino.iterdir():
        if f.is_file() and f.name not in nombres_recientes:
            try:
                f.unlink()
            except OSError:
                pass

    return len(recientes)


def _limpiar_raw_viejos(carpeta: Path, retencion_seg: int):
    """Borra de la carpeta cruda los archivos más viejos que `retencion_seg`,
    para no acumular disco indefinidamente."""
    ahora = int(time.time())
    for ts, f in _listar_ordenado(carpeta):
        if ahora - ts > retencion_seg:
            try:
                f.unlink()
            except OSError:
                pass


def main():
    config.ensure_dirs()
    config.log(MODULO, f"Módulo 3 (Buffer Rotativo) iniciado. Ventana = {config.VENTANA_SEGUNDOS}s "
                        f"(~{config.CLIPS_EN_VENTANA} clips por tipo).")

    while True:
        try:
            n_video = _actualizar_buffer(config.RAW_VIDEO_DIR, config.BUFFER_VIDEO_DIR, config.CLIPS_EN_VENTANA)
            n_audio = _actualizar_buffer(config.RAW_AUDIO_DIR, config.BUFFER_AUDIO_DIR, config.CLIPS_EN_VENTANA)

            _limpiar_raw_viejos(config.RAW_VIDEO_DIR, RETENCION_RAW_SEG)
            _limpiar_raw_viejos(config.RAW_AUDIO_DIR, RETENCION_RAW_SEG)

            if n_video == 0 and n_audio == 0:
                config.log(MODULO, "Sin clips de audio ni video todavía (¿módulos 1 y 2 corriendo?).", "WARN")

            config.heartbeat(MODULO)
        except Exception as e:  # nunca debe tumbar el proceso completo
            config.log(MODULO, f"Error inesperado en ciclo de buffer: {e}", "ERROR")

        time.sleep(INTERVALO_SEG)


if __name__ == "__main__":
    main()
