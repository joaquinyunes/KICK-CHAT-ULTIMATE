"""
Módulo 5 — Análisis Visual (frames + OCR)

Vigila /data/buffer/video, extrae un frame representativo de cada clip
con ffmpeg, le aplica OCR (pytesseract), y guarda el resultado como
JSON en /data/visual_desc.

Empieza SOLO con OCR (liviano y rápido). La descripción de escena con
modelo de visión (moondream) queda como mejora opcional posterior —
ver la función `_describir_escena_opcional`.

Este módulo es el más frágil del sistema. Está diseñado para que
CUALQUIER falla puntual (frame negro, OCR sin texto, modelo de visión
no disponible) se registre y se salte, sin nunca tumbar el proceso.

Uso:
    python3 analisis_visual.py

Requiere:
    pip install pytesseract pillow --break-system-packages
    Y tener instalado el binario tesseract-ocr del sistema operativo.

Variables de entorno relevantes:
    KICK_VISUAL_OCR_IDIOMA   idioma de tesseract (default "spa")
    KICK_TESSERACT_CMD       ruta al ejecutable de tesseract. Si no se define,
                              se busca en el PATH y en la ruta de instalación
                              típica de Windows.
"""

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
import config  # noqa: E402

MODULO = "modulo05_analisis_visual"
INTERVALO_SEG = 3
REGISTRO_PROCESADOS = config.LOGS_DIR / "modulo05_procesados.txt"

_RUTAS_TESSERACT_WINDOWS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
]


def _configurar_tesseract():
    """Deja a pytesseract listo para encontrar el binario y los idiomas,
    incluso si Tesseract se instaló recién y el PATH no se recargó todavía."""
    try:
        import pytesseract
    except ImportError:
        return

    cmd = os.environ.get("KICK_TESSERACT_CMD", "")
    if not cmd:
        for ruta in _RUTAS_TESSERACT_WINDOWS:
            if Path(ruta).exists():
                cmd = ruta
                break
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd

    # Carpeta de idiomas propia (se descargan spa/eng/osd ahí)
    if config.TESSDATA_DIR.exists() and any(config.TESSDATA_DIR.glob("*.traineddata")):
        os.environ["TESSDATA_PREFIX"] = str(config.TESSDATA_DIR)


def _cargar_procesados():
    if REGISTRO_PROCESADOS.exists():
        return set(REGISTRO_PROCESADOS.read_text().splitlines())
    return set()


def _marcar_procesado(nombre_archivo: str):
    with open(REGISTRO_PROCESADOS, "a", encoding="utf-8") as f:
        f.write(nombre_archivo + "\n")


def _extraer_frame(clip_path: Path, frame_out: Path) -> bool:
    """Extrae un único frame (del segundo intermedio del clip) con ffmpeg.
    Devuelve False si falla, en vez de lanzar una excepción."""
    offset = config.DURACION_CLIP_SEGUNDOS // 2
    comando = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", str(offset),
        "-i", str(clip_path),
        "-frames:v", "1",
        str(frame_out),
    ]
    resultado = subprocess.run(comando, capture_output=True, text=True)
    return resultado.returncode == 0 and frame_out.exists()


def _ocr_frame(frame_path: Path):
    """Aplica OCR al frame. Devuelve None si pytesseract no está disponible
    o si no se detecta texto, sin nunca tumbar el módulo."""
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return None

    idioma = os.environ.get("KICK_VISUAL_OCR_IDIOMA", "spa")
    try:
        imagen = Image.open(frame_path)
        try:
            texto = pytesseract.image_to_string(imagen, lang=idioma).strip()
        except pytesseract.TesseractError:
            # El idioma pedido no está instalado: caer a inglés.
            texto = pytesseract.image_to_string(imagen, lang="eng").strip()
        return texto if texto else None
    except Exception as e:
        config.log(MODULO, f"OCR falló en {frame_path.name}: {e}", "WARN")
        return None


def _describir_escena_opcional(frame_path: Path):
    """
    Punto de extensión: aquí se conectaría un modelo de visión liviano
    (ej. moondream) para generar una descripción general de la escena,
    más allá del texto. Se deja como None por defecto — el sistema
    funciona perfectamente solo con OCR si esto no está implementado.
    """
    return None


def main():
    config.ensure_dirs()
    config.log(MODULO, "Módulo 5 (Análisis Visual) iniciado.")
    _configurar_tesseract()
    procesados = _cargar_procesados()

    while True:
        try:
            clips = sorted(config.BUFFER_VIDEO_DIR.glob("*.mp4")) if config.BUFFER_VIDEO_DIR.exists() else []
            for clip in clips:
                if clip.name in procesados:
                    continue

                ts_inicio = config.timestamp_desde_nombre(clip) or int(clip.stat().st_mtime)

                with tempfile.TemporaryDirectory() as tmp:
                    frame_path = Path(tmp) / "frame.jpg"
                    ok = _extraer_frame(clip, frame_path)

                    texto_en_pantalla = None
                    descripcion_escena = None
                    if ok:
                        texto_en_pantalla = _ocr_frame(frame_path)
                        descripcion_escena = _describir_escena_opcional(frame_path)
                    else:
                        config.log(MODULO, f"No se pudo extraer frame de {clip.name} (¿video corrupto?).", "WARN")

                resultado = {
                    "timestamp_inicio": ts_inicio,
                    "timestamp_fin": ts_inicio + config.DURACION_CLIP_SEGUNDOS,
                    "texto_en_pantalla": texto_en_pantalla,
                    "descripcion_escena": descripcion_escena,
                }
                salida = config.VISUAL_DESC_DIR / f"visual_{ts_inicio}.json"
                config.escribir_json(salida, resultado)

                procesados.add(clip.name)
                _marcar_procesado(clip.name)

            config.heartbeat(MODULO)
        except Exception as e:  # nunca debe tumbar el módulo completo por un ciclo malo
            config.log(MODULO, f"Error inesperado en ciclo de análisis visual: {e}", "ERROR")

        time.sleep(INTERVALO_SEG)


if __name__ == "__main__":
    main()
