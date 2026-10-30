"""Compila el pipeline de contexto (kick-context/) a un ejecutable nativo con Nuitka.

Salida: desktop/build/python-dist/kc-runtime.exe (+ DLLs), sin ningún .py suelto.
Los prompts se incrustan en el binario (kc_embedded.py) en vez de copiarse como .txt.

    <venv>\Scripts\python.exe desktop\scripts\build_python.py
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "kick-context" / "src"
BUILD = ROOT / "desktop" / "build"
STAGE = BUILD / "python-stage"
OUT = BUILD / "python-dist"

# Módulos que el orquestador lanza (ver desktop/python/kc_main.py). Se aplanan en una sola
# carpeta porque se importan entre sí por nombre (import config, import resumen_llm...).
MODULES = {
    "common": ["config"],
    "modulo10_orquestador": ["orquestador"],
    "modulo01_captura_video": ["captura_video"],
    "modulo02_captura_audio": ["captura_audio"],
    "modulo03_buffer_rotativo": ["buffer_rotativo"],
    "modulo04_transcripcion_audio": ["transcripcion_audio"],
    "modulo05_analisis_visual": ["analisis_visual"],
    "modulo06_api_kick_metadata": ["api_kick_metadata"],
    "modulo07_unificacion_timeline": ["unificacion_timeline"],
    "modulo08_resumen_llm": ["resumen_llm"],
    "modulo09_memoria_historica": ["memoria_historica"],
    "modulo12_comentarista": ["comentarista"],
}

# Archivos de texto que lee el pipeline junto a su código (clave = ruta relativa a kick-context/src).
EMBED = ["modulo12_comentarista/prompt_chat.txt", "modulo12_comentarista/prompts"]


def stage() -> list[str]:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    names = []
    for folder, mods in MODULES.items():
        for mod in mods:
            shutil.copy(SRC / folder / f"{mod}.py", STAGE / f"{mod}.py")
            names.append(mod)
    shutil.copy(ROOT / "desktop" / "python" / "kc_main.py", STAGE / "kc_main.py")

    files = {}
    for rel in EMBED:
        p = SRC / rel
        for f in ([p] if p.is_file() else sorted(p.rglob("*.txt"))):
            files[f.relative_to(SRC).as_posix()] = f.read_text(encoding="utf-8")
    (STAGE / "kc_embedded.py").write_text(f"FILES = {files!r}\n", encoding="utf-8")
    names.append("kc_embedded")
    return names


def main() -> int:
    names = stage()
    cmd = [
        sys.executable, "-m", "nuitka",
        "--standalone",
        "--assume-yes-for-downloads",
        "--mingw64",
        f"--output-dir={OUT.parent}",
        "--output-filename=kc-runtime.exe",
        "--remove-output",
        "--python-flag=no_docstrings",
        "--python-flag=no_asserts",
        f"--jobs={os.cpu_count() or 4}",
        # faster-whisper se importa dentro de una función con try/except: se piden sus paquetes a mano.
        *[f"--include-package={p}" for p in ("faster_whisper", "ctranslate2", "tokenizers", "huggingface_hub", "onnxruntime", "av")],
        "--include-package-data=faster_whisper",
        "--nofollow-import-to=tkinter,pytest,matplotlib,IPython,flask",
        *[f"--include-module={n}" for n in names],
        str(STAGE / "kc_main.py"),
    ]
    print(" ".join(cmd), flush=True)
    rc = subprocess.call(cmd, cwd=BUILD)
    produced = BUILD / "kc_main.dist"
    if rc == 0 and produced.exists():
        if OUT.exists():
            shutil.rmtree(OUT)
        produced.rename(OUT)
        print(f"OK -> {OUT}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
