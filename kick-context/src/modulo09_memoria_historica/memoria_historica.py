"""
Módulo 9 — Memoria Histórica (SQLite)

Vigila /data/summaries y guarda cada resumen nuevo en /data/history.db,
para que el Módulo 8 pueda consultar "qué pasó antes" más allá de la
ventana de 2-3 min.

También expone `obtener_ultimos_resumenes()`, usada directamente por el
Módulo 8 (import de este archivo) para leer el historial reciente.

Uso como proceso independiente (guarda resúmenes en la base):
    python3 memoria_historica.py
"""

import os
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
import config  # noqa: E402

MODULO = "modulo09_memoria_historica"
INTERVALO_SEG = 5
REGISTRO_PROCESADOS = config.LOGS_DIR / "modulo09_procesados.txt"

ESQUEMA = """
CREATE TABLE IF NOT EXISTS resumenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    resumen_actual TEXT,
    tendencia_detectada TEXT
);
"""


def _conectar():
    """Abre conexión a SQLite. Si el archivo está corrupto, lo respalda
    y crea uno nuevo en vez de tumbar el módulo."""
    try:
        conn = sqlite3.connect(config.HISTORY_DB_PATH)
        conn.execute(ESQUEMA)
        conn.commit()
        return conn
    except sqlite3.DatabaseError as e:
        config.log(MODULO, f"Base de datos corrupta ({e}). Respaldando y creando una nueva.", "ERROR")
        if config.HISTORY_DB_PATH.exists():
            respaldo = config.BASE_DATA_DIR / f"history_corrupto_{int(time.time())}.db"
            config.HISTORY_DB_PATH.rename(respaldo)
        conn = sqlite3.connect(config.HISTORY_DB_PATH)
        conn.execute(ESQUEMA)
        conn.commit()
        return conn


def obtener_ultimos_resumenes(n: int = 5):
    """Función pública que usa el Módulo 8 para pedir contexto histórico."""
    try:
        conn = _conectar()
        cur = conn.execute(
            "SELECT timestamp, resumen_actual, tendencia_detectada FROM resumenes "
            "ORDER BY timestamp DESC LIMIT ?", (n,)
        )
        filas = cur.fetchall()
        conn.close()
        return [
            {"timestamp": ts, "resumen_actual": r, "tendencia_detectada": t}
            for ts, r, t in reversed(filas)
        ]
    except Exception as e:
        config.log(MODULO, f"No se pudo leer historial ({e}). Se devuelve lista vacía.", "WARN")
        return []


def _cargar_procesados():
    if REGISTRO_PROCESADOS.exists():
        return set(REGISTRO_PROCESADOS.read_text().splitlines())
    return set()


def _marcar_procesado(nombre_archivo: str):
    with open(REGISTRO_PROCESADOS, "a", encoding="utf-8") as f:
        f.write(nombre_archivo + "\n")


def main():
    config.ensure_dirs()
    config.log(MODULO, "Módulo 9 (Memoria Histórica) iniciado.")
    procesados = _cargar_procesados()

    while True:
        try:
            conn = _conectar()
            archivos = sorted(config.SUMMARIES_DIR.glob("resumen_*.json")) if config.SUMMARIES_DIR.exists() else []
            for f in archivos:
                if f.name in procesados:
                    continue
                data = config.leer_json_seguro(f)
                if not data:
                    procesados.add(f.name)
                    _marcar_procesado(f.name)
                    continue

                conn.execute(
                    "INSERT INTO resumenes (timestamp, resumen_actual, tendencia_detectada) VALUES (?, ?, ?)",
                    (data.get("timestamp"), data.get("resumen_actual"), data.get("tendencia_detectada")),
                )
                conn.commit()
                procesados.add(f.name)
                _marcar_procesado(f.name)
            conn.close()
            config.heartbeat(MODULO)
        except Exception as e:
            config.log(MODULO, f"Error inesperado guardando en la base histórica: {e}", "ERROR")

        time.sleep(INTERVALO_SEG)


if __name__ == "__main__":
    main()
