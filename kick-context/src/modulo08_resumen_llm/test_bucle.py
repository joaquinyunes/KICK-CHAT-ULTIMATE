"""Corre el bucle real de M8 con captura y Gemini simulados (sin ffmpeg ni red).

    python test_bucle.py

Verifica: pantalla igual => no llama al modelo; "Analizar ahora" fuerza el
análisis aunque la pantalla no cambie; el resumen guarda evento/detalle y un
atraso medido desde el momento del frame; el timestamp del frame sale del
nombre del clip (no de su mtime, que es el final del clip).
"""
import json
import os
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

tmp = tempfile.mkdtemp()
os.environ.update({"KICK_CONTEXT_DATA_DIR": tmp, "KICK_RESUMEN_MODO": "rapido",
                   "KICK_LLM_PROVIDER": "ollama"})
here = Path(__file__).parent
sys.path[:0] = [str(here), str(here / ".." / "common"), str(here / ".." / "modulo09_memoria_historica")]
import config  # noqa: E402
import resumen_llm as m  # noqa: E402

# 1) timestamp del frame = inicio del clip (nombre) + 3 s de seek
clip = Path(tmp) / "video_20260101-120000.ts"
clip.write_bytes(b"x")
esperado = datetime(2026, 1, 1, 12, 0, 3).timestamp()
assert m._ts_frame(clip) == esperado, (m._ts_frame(clip), esperado)

# 2) bucle: A, A, A(+pedido manual), A, B
A, B = bytes([10]) * 1024, bytes([240]) * 1024
secuencia = [A, A, A, A, B]
vistas = []


def frames_falsos():
    vistas.append(1)
    if len(vistas) == 2:                       # el Panel toca "Analizar ahora"
        config.ANALIZAR_AHORA_PATH.parent.mkdir(parents=True, exist_ok=True)
        config.ANALIZAR_AHORA_PATH.write_text("1")
    if len(vistas) > len(secuencia):
        raise SystemExit(0)
    return [secuencia[len(vistas) - 1]], time.time() - 12


llamadas = []
m._cargar_requests = lambda: object()
m._frames_actuales = frames_falsos
m._huella = lambda jpg: jpg                    # el "frame" ya es su huella
m._audio_actual = lambda: None
m._llamar_llm = lambda *a: (llamadas.append(1) or json.dumps({
    "fase": "slots", "evento": "Mega Win", "resumen_actual": "juega",
    "detalle": {"juego": "Templo", "apuesta": "1000"}}))
time.sleep = lambda s: None                    # sin esperas reales

try:
    m.main()
except SystemExit:
    pass

assert len(llamadas) == 3, f"esperaba 3 llamadas (1ª, manual, cambio) y hubo {len(llamadas)}"
res = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(config.SUMMARIES_DIR.glob("resumen_*.json"))]
assert res and res[0]["evento"] == "Mega Win" and res[0]["detalle"]["juego"] == "Templo"
assert 11 <= res[0]["latencia_seg"] <= 15, res[0]["latencia_seg"]
print("ok")
