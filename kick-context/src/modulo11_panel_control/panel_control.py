"""
Módulo 11 — Panel de Control (con login)

Aplicación web local (Flask) para:
  - Iniciar sesión con usuario/contraseña.
  - Ver el estado en vivo de los 9 módulos (vivo/caído, según heartbeat).
  - Prender/apagar cada módulo individualmente (el Orquestador respeta
    esa decisión leyendo /data/control/estado_deseado.json).
  - Ver el último resumen generado, el último timeline, y el estado del canal.

Este módulo NO ejecuta ninguna lógica de captura/transcripción/etc. —
solo LEE archivos que otros módulos ya escriben, y ESCRIBE el archivo
de estado deseado. Por eso, si el panel se cae, el resto del sistema
sigue funcionando exactamente igual, solo que sin interfaz web hasta
que el panel vuelva.

Uso:
    python3 panel_control.py

Requiere:
    pip install flask --break-system-packages

Variables de entorno OBLIGATORIAS:
    PANEL_USUARIO          nombre de usuario para iniciar sesión
    PANEL_PASSWORD_HASH    hash de la contraseña (generar con generar_password.py)
    PANEL_SECRET_KEY       clave secreta larga y aleatoria para las sesiones

Variables opcionales:
    PANEL_PUERTO           puerto donde corre el panel (default 5000)
    PANEL_HOST             host donde escucha (default 127.0.0.1, o sea
                            SOLO accesible desde tu propia PC — no lo cambies
                            a 0.0.0.0 a menos que sepas lo que haces, ya que
                            eso lo expondría a tu red local)
"""

import os
import sys
import time
from functools import wraps
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "common"))
import config  # noqa: E402

MODULO = "modulo11_panel_control"

try:
    from flask import Flask, render_template, request, redirect, url_for, session
    from werkzeug.security import check_password_hash
except ImportError:
    print("Falta Flask. Correr: pip install flask --break-system-packages")
    sys.exit(1)

app = Flask(__name__)
app.secret_key = os.environ.get("PANEL_SECRET_KEY", "")

# Módulos que el panel puede prender/apagar (el 10 y el 11 no se auto-administran)
MODULOS_CONTROLABLES = [
    ("modulo01_captura_video", "Captura de Video"),
    ("modulo02_captura_audio", "Captura de Audio"),
    ("modulo03_buffer_rotativo", "Buffer Rotativo"),
    ("modulo04_transcripcion_audio", "Transcripción de Audio"),
    ("modulo05_analisis_visual", "Análisis Visual"),
    ("modulo06_api_kick_metadata", "Metadata de Kick"),
    ("modulo07_unificacion_timeline", "Unificación de Timeline"),
    ("modulo08_resumen_llm", "Resumen con LLM"),
    ("modulo09_memoria_historica", "Memoria Histórica"),
    ("modulo12_comentarista", "Comentarista IA (chat)"),
]
# Margen amplio: algunos módulos (metadata, resumen LLM) laten cada 30-90 s.
# El objetivo del panel es dar un vistazo, no vigilar con precisión — de eso
# se encarga el Orquestador (Módulo 10).
TIEMPO_MAX_SILENCIO_DEFAULT_SEG = 120


def requiere_login(vista):
    @wraps(vista)
    def envoltura(*args, **kwargs):
        if not session.get("autenticado"):
            return redirect(url_for("login"))
        return vista(*args, **kwargs)
    return envoltura


def _validar_configuracion():
    faltantes = [v for v in ("PANEL_USUARIO", "PANEL_PASSWORD_HASH", "PANEL_SECRET_KEY")
                 if not os.environ.get(v)]
    if faltantes:
        print(f"Faltan variables de entorno obligatorias: {', '.join(faltantes)}. "
              f"Ver el encabezado de panel_control.py para instrucciones.")
        sys.exit(1)


def _leer_estado_deseado():
    estado = config.leer_json_seguro(config.CONTROL_ESTADO_PATH)
    return estado or {}


def _escribir_estado_deseado(estado: dict):
    config.CONTROL_DIR.mkdir(parents=True, exist_ok=True)
    config.escribir_json(config.CONTROL_ESTADO_PATH, estado)


def _edad_heartbeat(nombre_modulo: str):
    """Segundos desde el último latido del módulo, o None si nunca latió."""
    hb_path = config.LOGS_DIR / f"{nombre_modulo}_heartbeat.txt"
    try:
        return time.time() - int(hb_path.read_text().strip())
    except (FileNotFoundError, OSError, ValueError):
        return None


def _esta_vivo(nombre_modulo: str) -> bool:
    edad = _edad_heartbeat(nombre_modulo)
    return edad is not None and edad <= TIEMPO_MAX_SILENCIO_DEFAULT_SEG


def _estado_sistema():
    """Devuelve (nivel, texto) para el cartel grande del panel.
    nivel: 'ok' | 'arrancando' | 'caido'"""
    orq = _edad_heartbeat("modulo10_orquestador")
    cap = _edad_heartbeat("modulo01_captura_video")
    if orq is None or orq > 60:
        return "caido", "APAGADO — el orquestador no está corriendo. Arrancá con arrancar.ps1"
    if cap is None or cap > 90:
        return "arrancando", "Orquestador OK, pero todavía no llega la captura de video."

    # último resumen
    ult = None
    if config.SUMMARIES_DIR.exists():
        archivos = sorted(config.SUMMARIES_DIR.glob("resumen_*.json"))
        if archivos:
            data = config.leer_json_seguro(archivos[-1])
            ult = data.get("timestamp") if data else None
    if ult is None:
        return "arrancando", "Andando y capturando. Esperando el primer resumen (~2-3 min)."
    hace = int(time.time() - ult)
    if hace < 60:
        cuando = "hace segundos"
    elif hace < 3600:
        cuando = f"hace {hace // 60} min"
    else:
        cuando = f"hace {hace // 3600} h"
    return "ok", f"ANDANDO — capturando y resumiendo. Último resumen {cuando}."


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        usuario = request.form.get("usuario", "")
        contrasena = request.form.get("contrasena", "")
        usuario_valido = usuario == os.environ.get("PANEL_USUARIO")
        contrasena_valida = check_password_hash(os.environ.get("PANEL_PASSWORD_HASH", ""), contrasena)
        if usuario_valido and contrasena_valida:
            session["autenticado"] = True
            session["usuario"] = usuario
            return redirect(url_for("dashboard"))
        error = "Usuario o contraseña incorrectos."
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/nota", methods=["POST"])
@requiere_login
def guardar_nota():
    texto = request.form.get("nota", "")
    config.NOTA_USUARIO_DIR.mkdir(parents=True, exist_ok=True)
    config.NOTA_USUARIO_TXT.write_text(texto.strip(), encoding="utf-8")
    config.log(MODULO, f"Nota del usuario actualizada ({len(texto)} chars).")
    return redirect(url_for("dashboard"))


@app.route("/prompt-chat", methods=["POST"])
@requiere_login
def guardar_prompt_chat():
    texto = request.form.get("prompt_chat", "")
    config.PROMPT_CHAT_DIR.mkdir(parents=True, exist_ok=True)
    config.PROMPT_CHAT_TXT.write_text(texto.strip(), encoding="utf-8")
    config.log(MODULO, f"Prompt del comentarista actualizado ({len(texto)} chars).")
    return redirect(url_for("dashboard"))


@app.route("/comentarista-categoria", methods=["POST"])
@requiere_login
def comentarista_categoria():
    """Categoría de prompt elegida a mano para el Comentarista (Módulo 12):
    compone prompts/base.txt + prompts/categorias/<categoria>.txt."""
    categoria = request.form.get("categoria", config.CATEGORIA_PROMPT_DEFAULT).lower()
    if categoria not in config.CATEGORIAS_PROMPT:
        categoria = config.CATEGORIA_PROMPT_DEFAULT
    config.CONTROL_DIR.mkdir(parents=True, exist_ok=True)
    config.escribir_json(config.CATEGORIA_PROMPT_PATH, {"categoria": categoria})
    config.log(MODULO, f"'{session.get('usuario')}' eligió la categoría de prompt: {categoria}")
    return redirect(url_for("dashboard"))


@app.route("/analizar", methods=["POST"])
@requiere_login
def analizar_ahora():
    config.CONTROL_DIR.mkdir(parents=True, exist_ok=True)
    config.ANALIZAR_AHORA_PATH.write_text(str(int(time.time())))
    config.log(MODULO, f"'{session.get('usuario')}' pidió un resumen inmediato.")
    return redirect(url_for("dashboard"))


# Tipos válidos para la fuente de captura de video (Módulo 1).
_CAPTURA_TIPOS = {"ventana", "activa", "monitor", "escritorio", "env"}


@app.route("/captura", methods=["POST"])
@requiere_login
def elegir_captura():
    """Guarda qué debe capturar el Módulo 1. El valor viene del <select> como
    'tipo|valor' (ej. 'monitor|2', 'ventana|Stake', 'ventana|' = auto,
    'env|' = volver a lo que dice el .env)."""
    crudo = request.form.get("fuente", "")
    tipo, _, valor = crudo.partition("|")
    tipo = tipo.strip().lower()
    if tipo not in _CAPTURA_TIPOS:
        return redirect(url_for("dashboard"))
    config.CONTROL_DIR.mkdir(parents=True, exist_ok=True)
    if tipo == "env":
        try:
            config.CAPTURA_VIDEO_PATH.unlink()
        except OSError:
            pass
    else:
        config.escribir_json(config.CAPTURA_VIDEO_PATH,
                             {"tipo": tipo, "valor": valor.strip()})
    config.log(MODULO, f"'{session.get('usuario')}' eligió fuente de captura: {crudo}")
    return redirect(url_for("dashboard"))


@app.route("/comentarista-cadencia", methods=["POST"])
@requiere_login
def comentarista_cadencia():
    """Config global de cada cuánto el Comentarista (Módulo 12) manda mensajes."""
    def _int(nombre, defecto):
        try:
            return int(request.form.get(nombre, defecto))
        except (TypeError, ValueError):
            return defecto

    modo = request.form.get("modo", "goteo")
    if modo not in ("goteo", "bloque"):
        modo = "goteo"
    min_seg = max(3, _int("min_seg", config.COMENTARIO_MIN_SEG))
    max_seg = max(min_seg, _int("max_seg", config.COMENTARIO_MAX_SEG))
    bloque_seg = max(30, _int("bloque_seg", config.COMENTARIO_BLOQUE_SEG))

    config.CONTROL_DIR.mkdir(parents=True, exist_ok=True)
    config.escribir_json(config.COMENTARISTA_CFG_PATH, {
        "modo": modo, "min_seg": min_seg, "max_seg": max_seg, "bloque_seg": bloque_seg,
    })
    config.log(MODULO, f"'{session.get('usuario')}' cambió la cadencia del comentarista: "
                       f"modo={modo}, {min_seg}-{max_seg}s, bloque={bloque_seg}s")
    return redirect(url_for("dashboard"))


@app.route("/", methods=["GET"])
@requiere_login
def dashboard():
    estado_deseado = _leer_estado_deseado()

    modulos = []
    for nombre, etiqueta in MODULOS_CONTROLABLES:
        deseado = estado_deseado.get(nombre, True)
        modulos.append({
            "nombre": nombre,
            "etiqueta": etiqueta,
            "vivo": _esta_vivo(nombre) if deseado else False,
            "deseado": deseado,
        })

    # Feed de resúmenes: se acumulan, no se pisan. Del más nuevo al más viejo.
    resumenes = []
    if config.SUMMARIES_DIR.exists():
        archivos = sorted(config.SUMMARIES_DIR.glob("resumen_*.json"), reverse=True)
        for f in archivos[:40]:
            data = config.leer_json_seguro(f)
            if data:
                resumenes.append(data)

    import time as _t
    for r in resumenes:
        ts = r.get("timestamp")
        r["hora"] = _t.strftime("%H:%M:%S", _t.localtime(ts)) if ts else "?"

    estado_canal = config.leer_json_seguro(config.METADATA_DIR / "estado_canal.json")

    try:
        nota = config.NOTA_USUARIO_TXT.read_text(encoding="utf-8")
    except (FileNotFoundError, OSError):
        nota = ""

    prompt_chat = config.leer_prompt_chat_manual()
    categoria_actual = config.leer_categoria_prompt()
    categoria_opciones = config.CATEGORIAS_PROMPT

    comentarios = []
    if config.COMENTARIOS_DIR.exists():
        archivos = sorted(config.COMENTARIOS_DIR.glob("comentario_*.json"), reverse=True)
        for f in archivos[:25]:
            data = config.leer_json_seguro(f)
            if data:
                ts = data.get("timestamp")
                data["hora"] = time.strftime("%H:%M:%S", time.localtime(ts)) if ts else "?"
                comentarios.append(data)

    cola = config.leer_json_seguro(config.COMENTARIO_COLA_PATH) or {}
    cola_pendiente = len(cola.get("pendientes", []))
    comentario_txt_out = config.COMENTARIO_TXT_OUT

    sistema_nivel, sistema_texto = _estado_sistema()

    captura = config.leer_json_seguro(config.CAPTURA_OPCIONES_PATH) or {}
    captura_seleccion = config.leer_json_seguro(config.CAPTURA_VIDEO_PATH) or {}
    captura_valor_actual = (f"{captura_seleccion.get('tipo')}|{captura_seleccion.get('valor', '')}"
                            if captura_seleccion else "env|")

    return render_template(
        "dashboard.html",
        modulos=modulos,
        captura_opciones=captura.get("opciones", []),
        captura_actual=captura.get("actual"),
        captura_actualizado=captura.get("actualizado"),
        captura_valor_actual=captura_valor_actual,
        cadencia=config.leer_comentarista_cfg(),
        resumenes=resumenes,
        nota=nota,
        prompt_chat=prompt_chat,
        categoria_actual=categoria_actual,
        categoria_opciones=categoria_opciones,
        comentarios=comentarios,
        cola_pendiente=cola_pendiente,
        comentario_txt_out=comentario_txt_out,
        comentario_postear=config.COMENTARIO_POSTEAR,
        sistema_nivel=sistema_nivel,
        sistema_texto=sistema_texto,
        estado_canal=estado_canal,
        usuario=session.get("usuario"),
    )


@app.route("/panel/toggle/<nombre_modulo>", methods=["POST"])
@requiere_login
def toggle_modulo(nombre_modulo):
    nombres_validos = {n for n, _ in MODULOS_CONTROLABLES}
    if nombre_modulo not in nombres_validos:
        return redirect(url_for("dashboard"))

    estado_deseado = _leer_estado_deseado()
    actual = estado_deseado.get(nombre_modulo, True)
    estado_deseado[nombre_modulo] = not actual
    _escribir_estado_deseado(estado_deseado)
    config.log(MODULO, f"Usuario '{session.get('usuario')}' cambió {nombre_modulo} a "
                        f"{'ACTIVO' if not actual else 'APAGADO'}.")
    return redirect(url_for("dashboard"))


def main():
    _validar_configuracion()
    config.ensure_dirs()
    puerto = int(os.environ.get("PANEL_PUERTO", 5000))
    host = os.environ.get("PANEL_HOST", "127.0.0.1")
    config.log(MODULO, f"Panel de Control iniciado en http://{host}:{puerto}")
    app.run(host=host, port=puerto, debug=False)


if __name__ == "__main__":
    main()
