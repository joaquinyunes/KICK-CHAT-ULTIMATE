"""Chequeo rápido del detector de cambio de pantalla: python test_diferencia.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from resumen_llm import _diferencia  # noqa: E402

negro, blanco = bytes(1024), bytes([255]) * 1024
assert _diferencia(negro, negro) == 0.0
assert _diferencia(negro, blanco) == 1.0
assert _diferencia(negro, None) == 1.0          # sin huella previa = cambio
casi = bytes([10]) * 1024
assert 0 < _diferencia(negro, casi) < 0.04      # ruido de compresión: no dispara
print("ok")
