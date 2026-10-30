"""Punto de entrada del pipeline de contexto compilado (app de escritorio).

El orquestador lanza cada módulo como un proceso aparte; compilado, ese
proceso es este mismo ejecutable:

    kc-runtime.exe --kc-module <nombre>
"""

import importlib
import json
import sys

MODULOS = (
    "orquestador",
    "captura_video",
    "captura_audio",
    "buffer_rotativo",
    "transcripcion_audio",
    "analisis_visual",
    "api_kick_metadata",
    "unificacion_timeline",
    "resumen_llm",
    "memoria_historica",
    "comentarista",
)


def monitores() -> None:
    """Monitores de esta PC (x, y, ancho, alto), para el selector del panel."""
    import ctypes
    import ctypes.wintypes as wt

    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass
    mons = []
    proc = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.POINTER(wt.RECT), ctypes.c_double)

    def cb(h, hdc, lprc, data):
        r = lprc.contents
        mons.append({"x": r.left, "y": r.top, "w": r.right - r.left, "h": r.bottom - r.top})
        return 1

    ctypes.windll.user32.EnumDisplayMonitors(0, 0, proc(cb), 0)
    print(json.dumps(mons))


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] != "--kc-module":
        print("Uso: kc-runtime --kc-module <nombre>", file=sys.stderr)
        return 2
    nombre = sys.argv[2]
    if nombre == "monitores":
        monitores()
        return 0
    if nombre not in MODULOS:
        print(f"Módulo desconocido: {nombre}", file=sys.stderr)
        return 2
    importlib.import_module(nombre).main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
