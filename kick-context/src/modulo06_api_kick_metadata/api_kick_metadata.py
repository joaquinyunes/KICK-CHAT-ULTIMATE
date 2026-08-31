"""
Módulo 6 — Metadata del canal de Kick

Consulta periódicamente el estado de tu canal (en vivo, título, categoría,
viewers) y lo guarda en /data/metadata/estado_canal.json.

Usa la API PÚBLICA de Kick (no requiere login ni credenciales): basta con
KICK_CANAL_SLUG. El resto del sistema NO depende de este módulo — si Kick
no responde, simplemente no se actualiza la metadata.

Uso:
    python api_kick_metadata.py

Requiere:
    pip install requests

Variables de entorno:
    KICK_CANAL_SLUG   nombre de tu canal (el de la URL: kick.com/<slug>)

Opcional (solo si algún día se necesita un endpoint autenticado): correr
una vez `python login_kick.py` para generar los tokens OAuth.
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
import config  # noqa: E402

MODULO = "modulo06_api_kick_metadata"
INTERVALO_SEG = 30


def _extraer_estado(datos: dict) -> dict:
    """Normaliza la respuesta de la API de Kick a nuestro formato."""
    ls = datos.get("livestream") or {}
    if not isinstance(ls, dict):
        ls = {}
    categorias = ls.get("categories") or []
    categoria = None
    if categorias and isinstance(categorias, list) and isinstance(categorias[0], dict):
        categoria = categorias[0].get("name")

    return {
        "timestamp": int(time.time()),
        "en_vivo": bool(ls.get("is_live")),
        "titulo": ls.get("session_title") or datos.get("stream_title"),
        "categoria": categoria,
        "viewers": ls.get("viewer_count"),
        "seguidores": datos.get("followers_count"),
    }


def main():
    config.ensure_dirs()
    config.log(MODULO, "Módulo 6 (Metadata Kick) iniciado.")

    slug = config.CANAL_SLUG or os.environ.get("KICK_CANAL_SLUG", "")
    if not slug:
        config.log(MODULO, "Falta KICK_CANAL_SLUG en el .env. El módulo no puede continuar.", "ERROR")
        sys.exit(1)

    while True:
        try:
            datos = config._consultar_canal_kick(slug)
            if datos is None:
                config.log(MODULO, "La API de Kick no respondió (o Cloudflare bloqueó). "
                                   "Se reintenta.", "WARN")
            else:
                estado = _extraer_estado(datos)
                config.escribir_json(config.METADATA_DIR / "estado_canal.json", estado)
                if estado["en_vivo"]:
                    config.log(MODULO, f"En vivo: '{estado['titulo']}' | {estado['categoria']} "
                                       f"| {estado['viewers']} viewers")
            config.heartbeat(MODULO)
        except Exception as e:
            config.log(MODULO, f"Error consultando la API de Kick: {e}. "
                               f"Se reintenta en {INTERVALO_SEG}s.", "WARN")

        time.sleep(INTERVALO_SEG)


if __name__ == "__main__":
    main()
