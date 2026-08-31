"""
Módulo 7 — Unificación de Timeline

Combina /data/transcripts, /data/visual_desc y /data/metadata en un
único archivo /data/timeline/timeline_actual.json que representa la
ventana vigente de los últimos 2-3 minutos.

Diseñado para ser TOLERANTE a datos faltantes: si no hay descripción
visual para un timestamp (porque el Módulo 5 está caído), ese campo
queda en null, pero el timeline se genera igual con lo que sí exista.

Uso:
    python3 unificacion_timeline.py
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
import config  # noqa: E402

MODULO = "modulo07_unificacion_timeline"
INTERVALO_SEG = 10
# Audio y video vienen de dos procesos ffmpeg distintos, así que sus clips
# casi nunca arrancan en el mismo segundo exacto. Se considera que un clip
# de video corresponde a uno de audio si sus timestamps están a menos de
# esta tolerancia.
TOLERANCIA_MATCH_SEG = max(2, config.DURACION_CLIP_SEGUNDOS)


def _cargar_por_timestamp(carpeta, prefijo):
    """Lee todos los JSON de una carpeta y arma un dict {timestamp_inicio: contenido}.
    Ignora archivos corruptos individualmente, sin detener la carga completa."""
    resultado = {}
    if not carpeta.exists():
        return resultado
    for f in carpeta.glob(f"{prefijo}_*.json"):
        data = config.leer_json_seguro(f)
        if data and "timestamp_inicio" in data:
            resultado[data["timestamp_inicio"]] = data
    return resultado


def _texto_visual(v):
    if not v:
        return None
    return v.get("texto_en_pantalla") or v.get("descripcion_escena")


def _visual_mas_cercano_ts(ts, visuales, usados):
    """Devuelve el timestamp del clip visual sin usar más cercano a `ts`
    dentro de la tolerancia, o None si no hay ninguno."""
    mejor_ts, mejor_dist = None, None
    for vts in visuales:
        if vts in usados:
            continue
        dist = abs(vts - ts)
        if dist <= TOLERANCIA_MATCH_SEG and (mejor_dist is None or dist < mejor_dist):
            mejor_ts, mejor_dist = vts, dist
    return mejor_ts


def _armar_timeline():
    ahora = int(time.time())
    ventana_desde = ahora - config.VENTANA_SEGUNDOS

    transcripts = {ts: d for ts, d in _cargar_por_timestamp(config.TRANSCRIPTS_DIR, "transcript").items()
                   if ts >= ventana_desde}
    visuales = {ts: d for ts, d in _cargar_por_timestamp(config.VISUAL_DESC_DIR, "visual").items()
                if ts >= ventana_desde}
    estado_canal = config.leer_json_seguro(config.METADATA_DIR / "estado_canal.json")

    estado_canal_resumen = {
        "viewers": estado_canal.get("viewers"),
        "categoria": estado_canal.get("categoria"),
    } if estado_canal else None

    eventos = []
    visuales_usados = set()

    # 1. El audio es la columna vertebral: a cada transcript se le adosa el
    #    clip visual más cercano en el tiempo (no exige timestamp idéntico).
    for ts in sorted(transcripts):
        vts = _visual_mas_cercano_ts(ts, visuales, visuales_usados)
        if vts is not None:
            visuales_usados.add(vts)
        eventos.append({
            "timestamp": ts,
            "audio": transcripts[ts].get("texto"),
            "video": _texto_visual(visuales.get(vts)) if vts is not None else None,
            "estado_canal": estado_canal_resumen,
        })

    # 2. Clips visuales que no matchearon con ningún audio (p. ej. el Módulo 4
    #    está caído): entran igual como eventos solo-video.
    for ts in sorted(visuales):
        if ts in visuales_usados:
            continue
        eventos.append({
            "timestamp": ts,
            "audio": None,
            "video": _texto_visual(visuales[ts]),
            "estado_canal": estado_canal_resumen,
        })

    eventos.sort(key=lambda e: e["timestamp"])

    return {
        "generado_en": ahora,
        "ventana_desde": ventana_desde,
        "ventana_hasta": ahora,
        "eventos": eventos,
    }


def main():
    config.ensure_dirs()
    config.log(MODULO, "Módulo 7 (Unificación de Timeline) iniciado.")

    while True:
        try:
            timeline = _armar_timeline()
            config.escribir_json(config.TIMELINE_DIR / "timeline_actual.json", timeline)
            config.heartbeat(MODULO)
        except Exception as e:
            config.log(MODULO, f"Error inesperado armando el timeline: {e}", "ERROR")

        time.sleep(INTERVALO_SEG)


if __name__ == "__main__":
    main()
