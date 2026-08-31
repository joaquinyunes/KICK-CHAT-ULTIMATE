"""
EJEMPLO DE CONSUMIDOR — copiá esto (o la lógica) en tu OTRO proyecto.

El Módulo 12 deja cada lote de mensajes de Gemini en una carpeta:

    <DATA_DIR>/comentarios/lotes/
        lote_1788012345.json   -> {"timestamp": 1788012345, "mensajes": [...]}
        lote_1788012345.txt    -> un mensaje por línea

Este script vigila esa carpeta, procesa el lote MÁS VIEJO primero, y lo
renombra a .done para no repetirlo (o lo borra si BORRAR=True).

Uso:
    python consumidor_ejemplo.py "C:\\Users\\yunde\\kick-context-data\\comentarios\\lotes"

Sustituí `procesar_mensajes()` por lo que tu proyecto tenga que hacer.
"""

import json
import sys
import time
from pathlib import Path

BORRAR = False          # True = borra el lote tras procesarlo; False = lo deja como .done
INTERVALO_SEG = 5       # cada cuánto revisa la carpeta


def procesar_mensajes(mensajes: list[str], timestamp: int):
    """<<< ACÁ VA LA LÓGICA DE TU OTRO PROYECTO >>>
    Recibe la lista de ~30 mensajes de un lote. Hacé lo que necesites:
    encolarlos, dosificarlos a tu ritmo, mandarlos a tu chat, etc."""
    print(f"\n=== lote {timestamp} ({len(mensajes)} mensajes) ===")
    for i, m in enumerate(mensajes, 1):
        print(f"{i:2}. {m}")


def _leer_lote(path_json: Path):
    try:
        data = json.loads(path_json.read_text(encoding="utf-8"))
        return data.get("mensajes", []), int(data.get("timestamp", 0))
    except (OSError, json.JSONDecodeError, ValueError):
        return None, 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    carpeta = Path(sys.argv[1])
    print(f"Vigilando {carpeta} ...")

    while True:
        # .json terminados (ignora los .part a medio escribir), del más viejo al más nuevo
        pendientes = sorted(carpeta.glob("lote_*.json"))
        for pj in pendientes:
            mensajes, ts = _leer_lote(pj)
            if mensajes is None:
                continue
            try:
                procesar_mensajes(mensajes, ts)
            except Exception as e:  # que un lote roto no frene el loop
                print(f"error procesando {pj.name}: {e}")
                continue
            pt = pj.with_suffix(".txt")
            if BORRAR:
                pj.unlink(missing_ok=True)
                pt.unlink(missing_ok=True)
            else:
                pj.rename(pj.with_suffix(".json.done"))
                if pt.exists():
                    pt.rename(pt.with_suffix(".txt.done"))
        time.sleep(INTERVALO_SEG)


if __name__ == "__main__":
    main()
