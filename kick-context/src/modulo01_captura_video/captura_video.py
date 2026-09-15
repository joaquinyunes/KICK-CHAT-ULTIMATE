"""
Módulo 1 — Captura de Video

Lanza ffmpeg en modo segmentado para capturar video (pantalla/ventana)
en clips de N segundos, de forma continua.

Es el gemelo del Módulo 2 pero para video, y es igual de independiente:
si este módulo muere, el audio (Módulo 2) sigue funcionando sin enterarse.

Uso:
    python captura_video.py
    python captura_video.py --listar     # imprime las ventanas abiertas

QUÉ se captura (por orden de prioridad):
  1. La selección hecha desde el Panel (Módulo 11), que se guarda en
     <data>/control/captura_video.json. El Módulo 1 la relee sola y salta
     a la nueva fuente sin reiniciar nada.
  2. Si no hay selección: la config del .env (abajo).

Además, en cada ciclo el Módulo 1 publica las fuentes disponibles
(monitores + ventanas abiertas) en <data>/control/captura_opciones.json
para que el Panel arme el desplegable.

Variables de entorno (.env) — se usan como default si el Panel no eligió nada:
    KICK_CAPTURE_MODE        "local" (esta PC) | "remote" (HLS del canal).
    KICK_VIDEO_SO            "linux" | "windows" | "mac" (default linux)
    KICK_VIDEO_MODO          (Windows) "ventana" (default) | "activa" | "monitor"
                              | "escritorio" | "dshow".
       ventana    -> recorta UNA ventana (KICK_VIDEO_WINDOW_TITLE, parte del
                     título). Vacío = la ventana más grande que no esté en
                     KICK_VIDEO_IGNORAR. La sigue si la movés.
       activa     -> la ventana en primer plano; salta al cambiar de foco.
       monitor    -> un monitor entero (KICK_VIDEO_MONITOR = 1, 2, 3...).
       escritorio -> todo el escritorio.
       dshow      -> dispositivo dshow (KICK_VIDEO_DSHOW, ej "OBS Virtual Camera").
    KICK_VIDEO_WINDOW_TITLE  parte del título de la ventana a capturar.
    KICK_VIDEO_MONITOR       número de monitor (1-based).
    KICK_VIDEO_DSHOW         nombre del dispositivo dshow.
    KICK_VIDEO_IGNORAR       títulos que NUNCA se capturan, separados por coma.
                              Default: OBS, Task Manager, Administrador de tareas,
                              Panel de Control, kick-context, StreamChat.
    KICK_VIDEO_FPS           cuadros por segundo (default "10")
    KICK_VIDEO_RESOLUCION    (Linux) resolución (default "1280x720")
    KICK_VIDEO_DISPLAY       (Linux) display a capturar (default ":0.0")
"""

import ctypes
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
import config  # noqa: E402

MODULO = "modulo01_captura_video"
MAX_REINTENTOS = 3
ESPERA_ENTRE_REINTENTOS_SEG = 5
IGNORAR_DEFAULT = ("OBS", "Task Manager", "Administrador de tareas",
                   "Panel de Control", "kick-context", "StreamChat")
MODOS_DINAMICOS = ("activa", "ventana")

_ES_WINDOWS = sys.platform == "win32"


# ==========================================================================
#  Utilidades Win32 (solo Windows; en otros SO devuelven vacío)
# ==========================================================================
def _dpi_aware():
    if not _ES_WINDOWS:
        return
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def _titulo_ventana(hwnd) -> str:
    u = ctypes.windll.user32
    n = u.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    u.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value or ""


_CLASES_SHELL = {"Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
                 "Windows.UI.Core.CoreWindow", "ForegroundStaging",
                 "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland"}


def _clase_ventana(hwnd) -> str:
    buf = ctypes.create_unicode_buffer(256)
    ctypes.windll.user32.GetClassNameW(hwnd, buf, 256)
    return buf.value or ""


def _rect_ventana(hwnd):
    """(x, y, w, h) del área real de la ventana, sin el borde invisible de
    Windows 10/11. None si no es una ventana usable."""
    import ctypes.wintypes as wt
    r = wt.RECT()
    ok = False
    try:
        res = ctypes.windll.dwmapi.DwmGetWindowAttribute(  # EXTENDED_FRAME_BOUNDS = 9
            hwnd, 9, ctypes.byref(r), ctypes.sizeof(r))
        ok = (res == 0)
    except Exception:
        ok = False
    if not ok and not ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(r)):
        return None
    x, y, w, h = r.left, r.top, r.right - r.left, r.bottom - r.top
    if w < 120 or h < 120:
        return None
    return (x, y, w - (w % 2), h - (h % 2))  # dimensiones pares (libx264)


def _hwnd_foreground():
    return ctypes.windll.user32.GetForegroundWindow() or None


def _ventanas_visibles():
    """[(hwnd, titulo, rect)] de ventanas visibles reales, de la más grande
    a la más chica."""
    if not _ES_WINDOWS:
        return []
    u = ctypes.windll.user32
    out = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def _cb(hwnd, _lparam):
        if u.IsWindowVisible(hwnd) and not u.IsIconic(hwnd):
            t = _titulo_ventana(hwnd)
            rect = _rect_ventana(hwnd)
            if t and rect and _clase_ventana(hwnd) not in _CLASES_SHELL:
                out.append((hwnd, t, rect))
        return True

    u.EnumWindows(_cb, 0)
    out.sort(key=lambda x: x[2][2] * x[2][3], reverse=True)
    return out


def _listar_monitores():
    """[(indice_1based, x, y, w, h)] o [] si no es Windows."""
    if not _ES_WINDOWS:
        return []
    import ctypes.wintypes as wt
    mons = []
    proc = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong,
                              ctypes.POINTER(wt.RECT), ctypes.c_double)

    def _cb(h, hdc, lprc, data):
        r = lprc.contents
        mons.append((r.left, r.top, r.right - r.left, r.bottom - r.top))
        return 1

    ctypes.windll.user32.EnumDisplayMonitors(0, 0, proc(_cb), 0)
    return [(i + 1, x, y, w, h) for i, (x, y, w, h) in enumerate(mons)]


def _geometria_monitor(indice: int):
    for i, x, y, w, h in _listar_monitores():
        if i == indice:
            return (x, y, w, h)
    return None


def _es_ignorada(titulo: str, ignorar) -> bool:
    return any(ig and ig.lower() in (titulo or "").lower() for ig in ignorar)


def _hwnd_por_titulo(substr: str):
    substr = substr.lower()
    for hwnd, t, _rect in _ventanas_visibles():
        if substr in t.lower():
            return hwnd
    return None


def _hwnd_mejor_no_ignorado(ignorar):
    for hwnd, titulo, _rect in _ventanas_visibles():
        if not _es_ignorada(titulo, ignorar):
            return hwnd
    return None


def _objetivo_ventana(modo: str, titulo_cfg: str, ignorar):
    """Resuelve la ventana a capturar ahora (modos 'ventana' / 'activa').
    Devuelve (rect, etiqueta) | "IGNORAR" | None."""
    if not _ES_WINDOWS:
        return None
    if modo == "ventana":
        hwnd = _hwnd_por_titulo(titulo_cfg) if titulo_cfg else None
        if not hwnd:
            hwnd = _hwnd_mejor_no_ignorado(ignorar)  # auto: la otra pantalla
        if not hwnd:
            return None
    else:  # "activa"
        hwnd = _hwnd_foreground()
        if not hwnd:
            return None
        if _es_ignorada(_titulo_ventana(hwnd), ignorar):
            return "IGNORAR"
    rect = _rect_ventana(hwnd)
    if not rect:
        return None
    return (rect, _titulo_ventana(hwnd) or "(sin título)")


def _rects_parecidos(a, b, tol=6):
    return a is not None and b is not None and all(abs(x - y) <= tol for x, y in zip(a, b))


def _hacer_detector_ventana(modo, titulo_cfg, ignorar, rect_actual):
    """True cuando hay una ventana objetivo NUEVA y estable (vista 2 veces)
    distinta de la que se captura. El 'estable' evita que un alt-tab corto
    corte la captura."""
    st = {"cand": None, "n": 0}

    def _det():
        obj = _objetivo_ventana(modo, titulo_cfg, ignorar)
        if obj in (None, "IGNORAR"):
            st["cand"], st["n"] = None, 0
            return False
        rect_nuevo = obj[0]
        if _rects_parecidos(rect_nuevo, rect_actual):
            st["cand"], st["n"] = None, 0
            return False
        if st["cand"] and _rects_parecidos(rect_nuevo, st["cand"]):
            st["n"] += 1
        else:
            st["cand"], st["n"] = rect_nuevo, 1
        return st["n"] >= 2

    return _det


# ==========================================================================
#  Selección del Panel  <->  opciones publicadas
# ==========================================================================
def _ignorar_cfg():
    ig = [s.strip() for s in os.environ.get("KICK_VIDEO_IGNORAR", "").split(",") if s.strip()]
    return ig or list(IGNORAR_DEFAULT)


def _modo_env():
    """(modo, titulo, monitor) según el .env, con inferencia."""
    so = os.environ.get("KICK_VIDEO_SO", "linux").lower()
    modo = os.environ.get("KICK_VIDEO_MODO", "").strip().lower()
    titulo = os.environ.get("KICK_VIDEO_WINDOW_TITLE", "").strip()
    dshow = os.environ.get("KICK_VIDEO_DSHOW", "").strip()
    monitor = os.environ.get("KICK_VIDEO_MONITOR", "").strip()
    if not modo:
        if dshow:
            modo = "dshow"
        elif titulo:
            modo = "ventana"
        elif monitor:
            modo = "monitor"
        else:
            modo = "ventana" if so == "windows" else "escritorio"
    if modo in MODOS_DINAMICOS and so != "windows":
        modo = "escritorio"
    return modo, titulo, monitor


def _objetivo_efectivo():
    """Combina la selección del Panel (control/captura_video.json) con el .env.
    Devuelve (modo, titulo, monitor, origen)."""
    sel = config.leer_json_seguro(config.CAPTURA_VIDEO_PATH) or {}
    tipo = (sel.get("tipo") or "").lower()
    valor = str(sel.get("valor") or "").strip()
    if tipo == "monitor" and valor:
        return "monitor", "", valor, "panel"
    if tipo == "ventana":
        return "ventana", valor, "", "panel"   # valor vacío = auto
    if tipo == "activa":
        return "activa", "", "", "panel"
    if tipo == "escritorio":
        return "escritorio", "", "", "panel"
    m, t, mon = _modo_env()
    return m, t, mon, "env"


def _etiqueta_actual(modo, titulo, monitor, rect=None, etiqueta_win=None):
    if modo == "monitor":
        g = _geometria_monitor(int(monitor)) if monitor.isdigit() else None
        if g:
            return f"monitor {monitor} — {g[2]}×{g[3]} ({g[0]},{g[1]})"
        return f"monitor {monitor}"
    if modo == "escritorio":
        return "escritorio completo"
    if modo == "dshow":
        return f"dshow: {os.environ.get('KICK_VIDEO_DSHOW', '').strip()}"
    if modo == "activa":
        return f"ventana en foco: {etiqueta_win or '…'}"
    if modo == "ventana":
        base = f"ventana: {etiqueta_win}" if etiqueta_win else "ventana (auto)"
        return base + (f"  [filtro: {titulo}]" if titulo else "")
    return modo


def _publicar_opciones(ignorar, etiqueta_actual: str):
    """Escribe control/captura_opciones.json para que el Panel arme el
    desplegable de fuentes de captura."""
    if not _ES_WINDOWS:
        return
    try:
        opciones = [
            {"tipo": "ventana", "valor": "",
             "label": "Automático — la ventana más grande que no sea StreamChat/OBS"},
            {"tipo": "activa", "valor": "",
             "label": "La ventana que tenga el foco (sigue el foco)"},
        ]
        for i, x, y, w, h in _listar_monitores():
            opciones.append({"tipo": "monitor", "valor": str(i),
                             "label": f"monitor {i} — {w}×{h} ({x},{y})"})
        opciones.append({"tipo": "escritorio", "valor": "",
                         "label": "escritorio completo (todos los monitores)"})
        for _hwnd, titulo, (x, y, w, h) in _ventanas_visibles():
            marca = "  ·  (ignorada)" if _es_ignorada(titulo, ignorar) else ""
            opciones.append({"tipo": "ventana", "valor": titulo,
                             "label": f"ventana — {titulo}  [{w}×{h}]{marca}"})
        config.escribir_json(config.CAPTURA_OPCIONES_PATH, {
            "actualizado": int(time.time()),
            "actual": etiqueta_actual,
            "opciones": opciones,
        })
    except Exception as e:
        config.log(MODULO, f"No se pudieron publicar las opciones de captura: {e}", "WARN")


def _mtime(path):
    try:
        return path.stat().st_mtime
    except OSError:
        return None


# ==========================================================================
#  ffmpeg
# ==========================================================================
def _construir_comando(modo, titulo="", monitor="", rect_windows=None):
    so = os.environ.get("KICK_VIDEO_SO", "linux").lower()
    resolucion = os.environ.get("KICK_VIDEO_RESOLUCION", "1280x720")
    fps = os.environ.get("KICK_VIDEO_FPS", "10")
    dshow_video = os.environ.get("KICK_VIDEO_DSHOW", "").strip()
    salida = str(config.RAW_VIDEO_DIR / "video_%Y%m%d-%H%M%S.mp4")

    base = ["ffmpeg", "-y", "-loglevel", "warning"]
    salida_args = ["-f", "segment", "-segment_time", str(config.DURACION_CLIP_SEGUNDOS),
                   "-strftime", "1", "-reset_timestamps", "1", salida]

    if config.CAPTURE_MODE == "remote":
        hls = config.resolver_hls_url()
        if not hls:
            raise RuntimeError("CAPTURE_MODE=remote pero no se pudo resolver el HLS. "
                               "Revisá KICK_CANAL_SLUG o poné KICK_HLS_URL a mano.")
        config.log(MODULO, f"Modo remoto: HLS ({hls[:70]}...).")
        entrada = ["-reconnect", "1", "-reconnect_streamed", "1",
                   "-reconnect_delay_max", "5", "-i", hls]
        return base + entrada + ["-map", "0:v:0", "-an", "-c:v", "copy"] + salida_args

    if so == "windows" and rect_windows is not None:
        ox, oy, w, h = rect_windows
        entrada = ["-f", "gdigrab", "-framerate", fps, "-offset_x", str(ox),
                   "-offset_y", str(oy), "-video_size", f"{w}x{h}", "-i", "desktop"]
    elif so == "linux":
        entrada = ["-f", "x11grab", "-framerate", fps, "-video_size", resolucion,
                   "-i", os.environ.get("KICK_VIDEO_DISPLAY", ":0.0")]
    elif so == "windows":
        if modo == "dshow" and dshow_video:
            config.log(MODULO, f"Capturando dshow: {dshow_video}")
            entrada = ["-f", "dshow", "-framerate", fps, "-i", f"video={dshow_video}"]
        elif modo == "monitor" and monitor.isdigit() and _geometria_monitor(int(monitor)):
            ox, oy, w, h = _geometria_monitor(int(monitor))
            config.log(MODULO, f"Capturando monitor {monitor}: {w}x{h} en ({ox},{oy})")
            entrada = ["-f", "gdigrab", "-framerate", fps, "-offset_x", str(ox),
                       "-offset_y", str(oy), "-video_size", f"{w}x{h}", "-i", "desktop"]
        else:  # escritorio: NO forzar -video_size (rompe con multi-monitor)
            entrada = ["-f", "gdigrab", "-framerate", fps, "-i", "desktop"]
    elif so == "mac":
        device = os.environ.get("KICK_VIDEO_DEVICE", "1")
        entrada = ["-f", "avfoundation", "-framerate", fps, "-video_size", resolucion,
                   "-i", f"{device}:none"]
    else:
        raise ValueError(f"SO no soportado: {so}")

    # No pasar de 1280px de ancho, ni escalar hacia arriba una ventana chica.
    escala = ["-vf", "scale='min(1280,iw)':-2"]
    codificacion = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
                    "-g", str(int(fps) * 2)]
    return base + entrada + escala + codificacion + salida_args


def _ejecutar_con_supervision(comando, debe_reiniciar=None, on_tick=None):
    """Lanza ffmpeg y lo vigila. Corta limpio si `debe_reiniciar()` da True
    (cambió la ventana o la selección del Panel). `on_tick` corre en cada
    chequeo (~3s) — se usa para republicar las opciones."""
    config.log(MODULO, f"Lanzando ffmpeg: {' '.join(comando)}")
    inicio = time.time()
    cortado = False
    proc = subprocess.Popen(comando, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, text=True)
    while proc.poll() is None:
        config.heartbeat(MODULO)
        if on_tick:
            try:
                on_tick()
            except Exception:
                pass
        if debe_reiniciar and debe_reiniciar():
            config.log(MODULO, "Cambió la fuente de captura; recapturando.")
            cortado = True
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            break
        time.sleep(3)

    codigo = proc.returncode if proc.returncode is not None else 0
    _, stderr = proc.communicate()
    duracion = time.time() - inicio
    if not cortado and codigo not in (0, None):
        config.log(MODULO, f"ffmpeg terminó tras {duracion:.0f}s (código {codigo}). "
                           f"stderr: {(stderr or '')[-400:]}", "WARN")
    return codigo, duracion


# ==========================================================================
#  Loops
# ==========================================================================
def _loop_remoto():
    espera = ESPERA_ENTRE_REINTENTOS_SEG
    while True:
        if config.espera_si_canal_offline(MODULO):
            espera = ESPERA_ENTRE_REINTENTOS_SEG
            continue
        _c, dur = _ejecutar_con_supervision(_construir_comando("remote"))
        if dur >= 30:
            espera = ESPERA_ENTRE_REINTENTOS_SEG
        config.heartbeat(MODULO)
        config.log(MODULO, f"HLS cortado, reintento en {espera}s.")
        time.sleep(espera)
        espera = min(espera * 2, 30)


def _loop_local():
    ignorar = _ignorar_cfg()
    ultimo_rect = None
    fallos_seguidos = 0

    while True:
        modo, titulo, monitor, origen = _objetivo_efectivo()
        sel_mtime = _mtime(config.CAPTURA_VIDEO_PATH)

        rect = None
        etiqueta_win = None
        if modo in MODOS_DINAMICOS:
            obj = _objetivo_ventana(modo, titulo, ignorar)
            if obj not in (None, "IGNORAR"):
                rect, etiqueta_win = obj
                ultimo_rect = rect
            elif ultimo_rect is not None:
                rect, etiqueta_win = ultimo_rect, "(última ventana conocida)"
            else:
                hwnd = _hwnd_mejor_no_ignorado(ignorar)
                r = _rect_ventana(hwnd) if hwnd else None
                if r:
                    rect, etiqueta_win = r, _titulo_ventana(hwnd)
                    ultimo_rect = rect

        etiqueta = _etiqueta_actual(modo, titulo, monitor, rect, etiqueta_win)
        _publicar_opciones(ignorar, etiqueta)

        if modo in MODOS_DINAMICOS and rect is None:
            config.log(MODULO, "Esperando una ventana capturable.")
            config.heartbeat(MODULO)
            time.sleep(2)
            continue

        config.log(MODULO, f"Capturando [{origen}]: {etiqueta}")
        try:
            comando = _construir_comando(modo, titulo, monitor, rect_windows=rect)
        except Exception as e:
            config.log(MODULO, f"No se pudo armar el comando: {e}", "ERROR")
            time.sleep(3)
            continue

        det_win = (_hacer_detector_ventana(modo, titulo, ignorar, rect)
                   if modo in MODOS_DINAMICOS else (lambda: False))

        def _debe_reiniciar():
            return det_win() or _mtime(config.CAPTURA_VIDEO_PATH) != sel_mtime

        _c, dur = _ejecutar_con_supervision(
            comando, _debe_reiniciar,
            on_tick=lambda: _publicar_opciones(ignorar, etiqueta))

        if dur < 5:
            fallos_seguidos += 1
            if fallos_seguidos > MAX_REINTENTOS:
                config.log(MODULO, "ffmpeg muere al instante repetidas veces. "
                                   "Revisá la fuente de captura. Reintento lento.", "ERROR")
                time.sleep(15)
                fallos_seguidos = 0
            else:
                config.heartbeat(MODULO)
                time.sleep(3)
        else:
            fallos_seguidos = 0


def _imprimir_ventanas():
    _dpi_aware()
    vs = _ventanas_visibles()
    if not vs:
        print("No se detectaron ventanas (¿Windows con sesión activa?).")
        return
    print("Monitores:")
    for i, x, y, w, h in _listar_monitores():
        print(f"  monitor {i} — {w}×{h} ({x},{y})")
    print("\nVentanas abiertas (poné una parte del título en KICK_VIDEO_WINDOW_TITLE):\n")
    for _hwnd, titulo, (x, y, w, h) in vs:
        print(f"  [{w:>5}x{h:<5}]  {titulo}")


def main():
    if "--listar" in sys.argv or "--ventanas" in sys.argv:
        _imprimir_ventanas()
        return

    config.ensure_dirs()
    _dpi_aware()
    config.log(MODULO, "Módulo 1 (Captura de Video) iniciado.")

    if config.CAPTURE_MODE == "remote":
        _loop_remoto()
    else:
        _loop_local()


if __name__ == "__main__":
    main()
