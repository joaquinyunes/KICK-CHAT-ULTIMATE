"""
Módulo 12 — Comentarista IA (chat simulado que escribe en el chat de Kick)

Toma el "prompt maestro" (`prompt_chat.txt`), le inyecta el contexto real
del stream (los resúmenes del Módulo 8 + metadata del canal) rellenando sus
marcadores {{TEMA}}, {{CONTEXTO}}, {{EVENTO}}, {{CANTIDAD}}, {{HISTORIAL}}, …
y le pide a Gemini un LOTE de N mensajes de chat EN UNA SOLA LLAMADA.

Dos modos (config global, editable en caliente desde el Panel →
<data>/control/comentarista.json; el .env es solo el default):
- "bloque": 1 llamada cada `bloque_seg` y vuelca el lote entero al TXT de una.
  Ideal si otro proyecto consume el TXT.
- "goteo" (default): los mensajes se encolan y se sueltan de a uno cada X seg,
  con X al azar entre `min_seg` y `max_seg`; se pide otro lote cuando la cola
  baja del umbral. Cambiar de modo relanza este módulo solo.

- Cada mensaje se guarda en <data>/comentarios/comentario_<ts>.json y se ve
  en el Panel.
- Si KICK_COMENTARIO_POSTEAR=1, además se publica en el chat de tu canal vía
  la API oficial de Kick (POST /public/v1/chat, type=bot). Requiere haber
  corrido `python modulo06_api_kick_metadata/login_kick.py` una vez con el
  scope `chat:write`.
- Modo ensayo (default, POSTEAR=0): genera y guarda, NO postea nada.

Este módulo NO tumba nada: si Gemini o Kick fallan, reintenta con backoff.

Uso:
    python comentarista.py

Variables de entorno (ver .env.example):
    KICK_COMENTARIO_LOTE            mensajes por llamada al LLM (default 30)
    KICK_COMENTARIO_MODO            "goteo" (default) | "bloque"  (default; Panel manda)
    KICK_COMENTARIO_BLOQUE_SEG      (bloque) cada cuánto se genera (default 300)
    KICK_COMENTARIO_MIN_SEG/MAX_SEG (goteo) rango aleatorio entre mensajes (default 25/70)
    KICK_COMENTARIO_INTERVALO_SEG   (compat) usado como MIN_SEG si no se define
    KICK_COMENTARIO_REGEN_UMBRAL    (goteo) re-generar cuando quedan <= N en cola (default 4)
    KICK_COMENTARIO_POSTEAR         "1" postea en el chat, "0" solo guarda
    KICK_COMENTARIO_MAX_CHARS       recorte duro por mensaje (default 240)
    KICK_COMENTARIO_TXT_OUT         TXT que se actualiza con cada mensaje
                                    (para consumir desde otro proyecto)
    KICK_COMENTARIO_TXT_FORMATO     plain | ts | jsonl
    KICK_PROMPT_CHAT_FILE           ruta alternativa al prompt_chat.txt
    KICK_GEMINI_API_KEY / KICK_GEMINI_MODELS   (compartidas con el Módulo 8)
    KICK_CLIENT_ID / KICK_CLIENT_SECRET        (para refrescar el token de Kick)
"""

import json
import os
import random
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "modulo09_memoria_historica"))
import config  # noqa: E402
from memoria_historica import obtener_ultimos_resumenes  # noqa: E402

MODULO = "modulo12_comentarista"
LOTE = config.COMENTARIO_LOTE
REGEN_UMBRAL = config.COMENTARIO_REGEN_UMBRAL
BACKOFF_MAX_SEG = 300
GEMINI_TIMEOUT = int(os.environ.get("KICK_GEMINI_TIMEOUT", 90))
IGNORAR_OFFLINE = os.environ.get("KICK_COMENTARIO_IGNORAR_OFFLINE", "0") == "1"
TOKEN_ENDPOINT = "https://id.kick.com/oauth/token"
SEPARADOR = "KICKCHAT"  # el prompt separa cada 4 mensajes con KICKCHAT123456

MODELOS_GEMINI = [m.strip() for m in os.environ.get(
    "KICK_GEMINI_MODELS",
    f"{os.environ.get('KICK_GEMINI_MODEL', 'gemini-flash-lite-latest')},gemini-2.5-flash"
).split(",") if m.strip()]


def _cargar_requests():
    try:
        import requests
        return requests
    except ImportError:
        config.log(MODULO, "Falta 'requests'. Correr: pip install requests", "ERROR")
        sys.exit(1)


# --- Cola de mensajes pendientes ---------------------------------------

def _leer_cola():
    d = config.leer_json_seguro(config.COMENTARIO_COLA_PATH) or {}
    return list(d.get("pendientes", []))


def _guardar_cola(pendientes):
    config.escribir_json(config.COMENTARIO_COLA_PATH,
                         {"pendientes": pendientes, "actualizado": int(time.time())})


# --- Comentarios previos (historial + dedupe) -------------------------

def _ultimos_comentarios(n=12):
    if not config.COMENTARIOS_DIR.exists():
        return []
    archivos = sorted(config.COMENTARIOS_DIR.glob("comentario_*.json"), reverse=True)[:n]
    out = []
    for f in archivos:
        d = config.leer_json_seguro(f)
        if d and d.get("comentario"):
            out.append(d["comentario"])
    return list(reversed(out))


def _es_repetido(texto, previos):
    t = texto.strip().lower()
    if len(t) < 3:
        return True
    for p in previos[-6:]:
        p = p.strip().lower()
        if t == p:
            return True
    return False


# --- Token de Kick ----------------------------------------------------

def _leer_token():
    return config.leer_json_seguro(config.KICK_TOKEN_STATE_PATH) or {}


def _refrescar_token(requests, estado):
    client_id = os.environ.get("KICK_CLIENT_ID")
    client_secret = os.environ.get("KICK_CLIENT_SECRET")
    refresh = estado.get("refresh_token")
    if not (client_id and client_secret and refresh):
        return None
    r = requests.post(TOKEN_ENDPOINT, data={
        "grant_type": "refresh_token",
        "refresh_token": refresh,
        "client_id": client_id,
        "client_secret": client_secret,
    }, timeout=15)
    r.raise_for_status()
    data = r.json()
    nuevo = {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token", refresh),
        "expira_en": int(time.time()) + int(data.get("expires_in", 3600)),
    }
    config.escribir_json(config.KICK_TOKEN_STATE_PATH, nuevo)
    config.log(MODULO, "Token de Kick refrescado.")
    return nuevo


def _access_token(requests):
    estado = _leer_token()
    if not estado.get("access_token"):
        return None
    if estado.get("expira_en", 0) - time.time() < 120:
        try:
            estado = _refrescar_token(requests, estado) or estado
        except Exception as e:
            config.log(MODULO, f"No se pudo refrescar el token de Kick: {e}", "WARN")
    return estado.get("access_token")


def _postear_chat(requests, texto):
    token = _access_token(requests)
    if not token:
        config.log(MODULO, "No hay token de Kick (corré login_kick.py con scope chat:write). "
                           "El mensaje se guarda pero no se postea.", "WARN")
        return False
    r = requests.post(
        config.KICK_CHAT_ENDPOINT,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"content": texto[:config.COMENTARIO_MAX_CHARS], "type": "bot"},
        timeout=20,
    )
    if r.status_code >= 400:
        config.log(MODULO, f"Kick rechazó el mensaje ({r.status_code}): {r.text[:200]}", "WARN")
        return False
    return True


# --- Relleno del prompt maestro + LLM --------------------------------

def _vars_contexto(resumenes, estado_canal, historial):
    ec = estado_canal or {}
    ctx = " | ".join(r["resumen_actual"] for r in resumenes if r.get("resumen_actual"))
    ult = resumenes[-1] if resumenes else {}
    cat = ec.get("categoria") or ""
    titulo = ec.get("titulo") or ""
    try:
        nota = config.NOTA_USUARIO_TXT.read_text(encoding="utf-8").strip()
    except (FileNotFoundError, OSError):
        nota = ""

    return {
        "TEMA": titulo or cat or "Stream en vivo",
        "CANTIDAD": str(LOTE),
        "CONTEXTO": ctx or "(todavía sin datos del stream)",
        "MOMENTO": "EN_VIVO",
        "ENERGIA": "NORMAL",
        "CATEGORIA": cat or "(sin categoría)",
        "EVENTO": ult.get("resumen_actual") or "(sin evento puntual ahora)",
        "HISTORIAL": "\n".join(historial) or "(sin mensajes previos)",
        "MEMORIA_USUARIOS": "(sin memoria de usuarios)",
        "SLOTS_PROBABLES": "(las del ranking de arriba)",
        "ESTADO_SLOT": "NINGUNO",
        "DEPORTE_PRINCIPAL": "",
        "COMPETENCIA_ESPORTS": "",
        "EVENTO_ESPORTS": "",
        "PARTICIPANTES_ESPORTS": "",
        "MARCADOR_ESPORTS": "",
        "ESTADO_ESPORTS": "",
        "PARTIDOS_FUTBOL": "",
        "NOTICIAS_DEPORTIVAS": "",
        "CUOTAS_DISPONIBLES": "",
        "MERCADOS_DISPONIBLES": "",
        "RANKING_SLOTS_ICONICAS": "(ver la lista TOP 30 incluida en este prompt)",
        "PROYECTO_ACTUAL": nota or "(sin datos del proyecto)",
    }


def _rellenar(prompt_base, variables):
    out = prompt_base
    for clave, valor in variables.items():
        out = out.replace("{{" + clave + "}}", str(valor))
    # Cualquier marcador que haya quedado sin datos → vacío.
    out = re.sub(r"\{\{[A-Z_]+\}\}", "", out)
    return out


def _parsear_lote(texto):
    msgs = []
    for linea in (texto or "").splitlines():
        s = linea.strip()
        if not s or s.upper().startswith(SEPARADOR):
            continue
        s = re.sub(r"\[EMOTE:\s*([A-Za-z0-9_]+)\s*\]", r"\1", s)
        s = s.strip(" -*\t").strip()
        if s:
            msgs.append(s[:config.COMENTARIO_MAX_CHARS])
    return msgs


def _llamar_gemini_texto(requests, prompt):
    if not config.GEMINI_API_KEY:
        raise RuntimeError("Falta KICK_GEMINI_API_KEY en el .env")
    ultimo_error = None
    for modelo in MODELOS_GEMINI:
        url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{modelo}:generateContent")
        try:
            r = requests.post(
                url, headers={"x-goog-api-key": config.GEMINI_API_KEY},
                json={"contents": [{"parts": [{"text": prompt}]}],
                      "generationConfig": {"temperature": 1.0, "maxOutputTokens": 4096}},
                timeout=GEMINI_TIMEOUT)
            if r.status_code in (429, 500, 503):
                raise RuntimeError(f"{modelo}: ocupado ({r.status_code})")
            r.raise_for_status()
            return r.json()["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            ultimo_error = e
            config.log(MODULO, f"{e}. Probando el siguiente modelo...", "WARN")
    raise ultimo_error or RuntimeError("Sin modelos de Gemini configurados")


def _generar_lote(requests, prompt_base, resumenes, estado_canal):
    historial = _ultimos_comentarios(12)
    prompt = _rellenar(prompt_base, _vars_contexto(resumenes, estado_canal, historial))
    crudo = _llamar_gemini_texto(requests, prompt)
    msgs = _parsear_lote(crudo)
    # Filtrar los que repiten textual lo último ya dicho.
    limpios, previos = [], list(historial)
    for m in msgs:
        if not _es_repetido(m, previos):
            limpios.append(m)
            previos.append(m)
    config.log(MODULO, f"Lote generado: {len(limpios)} mensajes útiles (de {len(msgs)} crudos).")
    return limpios


# --- Bucle ----------------------------------------------------------

def _canal_en_vivo():
    d = config.leer_json_seguro(config.METADATA_DIR / "estado_canal.json")
    if not d:
        return None
    return bool(d.get("en_vivo"))


def _guardar_comentario(texto, publicado):
    ts = int(time.time())
    config.escribir_json(
        config.COMENTARIOS_DIR / f"comentario_{ts}.json",
        {"timestamp": ts, "comentario": texto, "publicado": publicado,
         "modo_ensayo": not config.COMENTARIO_POSTEAR})
    _append_txt(texto, ts)


def _append_txt(texto, ts):
    """Agrega el mensaje al TXT que consume otro proyecto (ej. 'kick chat').
    Reescribe el archivo con las últimas N líneas para que no crezca infinito."""
    ruta = Path(config.COMENTARIO_TXT_OUT)
    fmt = config.COMENTARIO_TXT_FORMATO
    if fmt == "ts":
        linea = f"{ts}\t{texto}"
    elif fmt == "jsonl":
        linea = json.dumps({"timestamp": ts, "mensaje": texto}, ensure_ascii=False)
    else:
        linea = texto
    try:
        ruta.parent.mkdir(parents=True, exist_ok=True)
        previas = ruta.read_text(encoding="utf-8").splitlines() if ruta.is_file() else []
        previas.append(linea)
        previas = previas[-config.COMENTARIO_TXT_MAX_LINEAS:]
        tmp = ruta.with_suffix(ruta.suffix + ".tmp")
        tmp.write_text("\n".join(previas) + "\n", encoding="utf-8")
        os.replace(tmp, ruta)
    except OSError as e:
        config.log(MODULO, f"No se pudo escribir el TXT de salida ({ruta}): {e}", "WARN")


def _heartbeat_dormir(segundos):
    restante = segundos
    while restante > 0:
        config.heartbeat(MODULO)
        time.sleep(min(5, restante))
        restante -= 5


_MODO_INICIAL = None  # se fija en main()


def _reiniciar_si_cambio_modo():
    """El modo (goteo/bloque) no se puede cambiar en caliente dentro del mismo
    loop; si el Panel lo cambió, salimos limpio y el Orquestador (Módulo 10)
    relanza el módulo con el modo nuevo. El min/max sí se aplica sin reiniciar."""
    if _MODO_INICIAL and config.leer_comentarista_cfg()["modo"] != _MODO_INICIAL:
        config.log(MODULO, "El Panel cambió el modo de cadencia. Salgo para que "
                           "el Orquestador me relance con el modo nuevo.")
        sys.exit(0)


def _contexto_listo():
    """Devuelve (base, resumenes, estado_canal) si se puede comentar, o None."""
    base = config.leer_prompt_chat()
    if not base:
        config.log(MODULO, "prompt_chat.txt vacío: sin prompt no comento.", "WARN")
        return None
    if _canal_en_vivo() is False and not IGNORAR_OFFLINE:
        config.log(MODULO, "Canal offline. No comento. "
                           "(KICK_COMENTARIO_IGNORAR_OFFLINE=1 para generar igual)")
        return None
    resumenes = obtener_ultimos_resumenes(6)
    if not resumenes:
        config.log(MODULO, "Todavía no hay resúmenes del Módulo 8.", "WARN")
        return None
    estado_canal = config.leer_json_seguro(config.METADATA_DIR / "estado_canal.json")
    return base, resumenes, estado_canal


def _soltar_mensaje(requests, texto):
    """Postea (si corresponde) y guarda el mensaje + lo agrega al TXT."""
    publicado = False
    if config.COMENTARIO_POSTEAR:
        try:
            publicado = _postear_chat(requests, texto)
        except Exception as e:
            config.log(MODULO, f"Error posteando en Kick: {e}", "WARN")
    _guardar_comentario(texto, publicado)
    return publicado


def _loop_bloque(requests):
    """1 llamada cada N seg (config global, releída en caliente); vuelca el
    lote entero al TXT."""
    espera = config.leer_comentarista_cfg()["bloque_seg"]
    while True:
        try:
            _reiniciar_si_cambio_modo()
            config.heartbeat(MODULO)
            bloque_seg = config.leer_comentarista_cfg()["bloque_seg"]
            listo = _contexto_listo()
            if not listo:
                _heartbeat_dormir(min(60, bloque_seg))
                continue
            base, resumenes, estado_canal = listo
            nuevos = _generar_lote(requests, base, resumenes, estado_canal)
            if not nuevos:
                config.log(MODULO, f"Lote vacío. Reintento en {espera}s.", "WARN")
                _heartbeat_dormir(espera)
                espera = min(int(espera * 1.7), BACKOFF_MAX_SEG)
                continue
            espera = bloque_seg
            _volcar_lote(requests, nuevos)
            for m in nuevos:
                _soltar_mensaje(requests, m)
            config.log(MODULO, f"Bloque de {len(nuevos)} mensajes volcado al TXT. "
                               f"Próximo en {espera}s.")
            _heartbeat_dormir(espera)
        except Exception as e:
            config.log(MODULO, f"Ciclo con error: {e}. Reintento en {espera}s.", "WARN")
            _heartbeat_dormir(espera)
            espera = min(int(espera * 1.7), BACKOFF_MAX_SEG)


def _espera_goteo():
    """Segundos hasta el próximo mensaje: un valor al azar dentro del rango
    [min, max] que se configura globalmente desde el Panel."""
    cfg = config.leer_comentarista_cfg()
    return random.randint(cfg["min_seg"], cfg["max_seg"])


def _loop_goteo(requests):
    """1 llamada por lote, pero suelta los mensajes de a uno cada
    random(min, max) segundos (config global, releída en caliente)."""
    backoff = _espera_goteo()
    while True:
        try:
            _reiniciar_si_cambio_modo()
            config.heartbeat(MODULO)
            listo = _contexto_listo()
            if not listo:
                _heartbeat_dormir(_espera_goteo())
                continue
            base, resumenes, estado_canal = listo

            cola = _leer_cola()
            if len(cola) <= REGEN_UMBRAL:
                nuevos = _generar_lote(requests, base, resumenes, estado_canal)
                if nuevos:
                    _volcar_lote(requests, nuevos)
                    cola = cola + nuevos
                    _guardar_cola(cola)

            if not cola:
                config.log(MODULO, "Cola vacía y no se pudo generar. Reintento.", "WARN")
                _heartbeat_dormir(backoff)
                backoff = min(int(backoff * 1.7), BACKOFF_MAX_SEG)
                continue

            backoff = _espera_goteo()
            texto = cola.pop(0)
            _guardar_cola(cola)

            if _es_repetido(texto, _ultimos_comentarios(6)):
                config.log(MODULO, f"Mensaje repetido, se saltea: {texto[:80]}")
            else:
                publicado = _soltar_mensaje(requests, texto)
                marca = "posteado" if publicado else ("ensayo" if not config.COMENTARIO_POSTEAR else "NO posteado")
                config.log(MODULO, f"[{marca}] ({len(cola)} en cola) {texto}")

            _heartbeat_dormir(_espera_goteo())

        except Exception as e:
            config.log(MODULO, f"Ciclo con error: {e}. Reintento en {backoff}s.", "WARN")
            _heartbeat_dormir(backoff)
            backoff = min(int(backoff * 1.7), BACKOFF_MAX_SEG)


def _volcar_lote(requests, mensajes):
    """Deja el lote entero disponible para otro proyecto:
      - <data>/comentarios/lotes/lote_<ts>.txt   (una línea por mensaje)
      - <data>/comentarios/lotes/lote_<ts>.json  ({timestamp, mensajes: [...]})
      - HTTP POST a KICK_COMENTARIO_WEBHOOK si está configurado.
    Escritura atómica: primero .json/.txt.part y luego rename, así el
    consumidor nunca lee un archivo a medio escribir."""
    if not mensajes:
        return
    ts = int(time.time())
    payload = {"timestamp": ts, "mensajes": mensajes}
    d = config.COMENTARIO_LOTES_DIR
    lote_json = d / f"lote_{ts}.json"
    try:
        d.mkdir(parents=True, exist_ok=True)
        for final, contenido in (
            (lote_json, json.dumps(payload, ensure_ascii=False, indent=2)),
            (d / f"lote_{ts}.txt", "\n".join(mensajes) + "\n"),
        ):
            parcial = final.with_suffix(final.suffix + ".part")
            parcial.write_text(contenido, encoding="utf-8")
            os.replace(parcial, final)
    except OSError as e:
        config.log(MODULO, f"No se pudo escribir el lote en {d}: {e}", "WARN")

    if config.COMENTARIO_HOOK_CMD:
        try:
            partes = shlex.split(config.COMENTARIO_HOOK_CMD, posix=(os.name != "nt"))
            subprocess.Popen(partes + [str(lote_json)])
            config.log(MODULO, f"Hook disparado: {config.COMENTARIO_HOOK_CMD}")
        except Exception as e:
            config.log(MODULO, f"Hook falló ({config.COMENTARIO_HOOK_CMD}): {e}", "WARN")

    if config.COMENTARIO_WEBHOOK:
        try:
            r = requests.post(config.COMENTARIO_WEBHOOK, json=payload, timeout=15)
            r.raise_for_status()
            config.log(MODULO, f"Lote enviado al webhook ({r.status_code}).")
        except Exception as e:
            config.log(MODULO, f"Webhook falló ({config.COMENTARIO_WEBHOOK}): {e}", "WARN")


def main():
    global _MODO_INICIAL
    config.ensure_dirs()
    base = config.leer_prompt_chat()
    cfg = config.leer_comentarista_cfg()
    modo = cfg["modo"]
    _MODO_INICIAL = modo
    cadencia = (f"1 lote cada {cfg['bloque_seg']}s" if modo == "bloque"
                else f"goteo 1 msg cada {cfg['min_seg']}-{cfg['max_seg']}s (al azar)")
    config.log(MODULO, f"Módulo 12 (Comentarista) iniciado. modo={modo}, lote={LOTE}, "
                       f"{cadencia}, postear={'SÍ' if config.COMENTARIO_POSTEAR else 'no (modo ensayo)'}, "
                       f"TXT={config.COMENTARIO_TXT_OUT}, "
                       f"prompt={'cargado' if base else 'VACÍO (falta prompt_chat.txt)'}.")
    requests = _cargar_requests()

    if not config.GEMINI_API_KEY:
        config.log(MODULO, "Falta KICK_GEMINI_API_KEY.", "ERROR")
        sys.exit(1)

    if modo == "bloque":
        _loop_bloque(requests)
    else:
        _loop_goteo(requests)


if __name__ == "__main__":
    main()
