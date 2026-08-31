"""
Módulo 1 — Captura de Video

Lanza ffmpeg en modo segmentado para capturar video (pantalla/escritorio)
en clips de N segundos, de forma continua.

Es el gemelo del Módulo 2 pero para video, y es igual de independiente:
si este módulo muere, el audio (Módulo 2) sigue funcionando sin enterarse.

Uso:
    python3 captura_video.py

Variables de entorno relevantes:
    KICK_CONTEXT_DATA_DIR    carpeta base de datos
    KICK_CAPTURE_MODE        "local" (captura la pantalla) | "remote" (lee el
                              HLS del canal de Kick). En "remote" se ignora todo
                              lo de abajo y se usa KICK_CANAL_SLUG / KICK_HLS_URL.
    KICK_VIDEO_SO            "linux" | "windows" | "mac" (default linux)
    KICK_VIDEO_DISPLAY       pantalla a capturar en Linux (default ":0.0")
    KICK_VIDEO_RESOLUCION    resolución de captura de pantalla completa (default "1280x720")
    KICK_VIDEO_FPS           cuadros por segundo a capturar (default "10")
    KICK_VIDEO_MONITOR       (Windows, modo local) número de monitor a capturar
                              (1, 2, 3...). Es lo que se ve en ese monitor.
    KICK_VIDEO_WINDOW_TITLE  (Windows, modo local) título EXACTO de una ventana.
                              Ver los títulos con:  ffmpeg -f gdigrab -i title=list
    KICK_VIDEO_DSHOW         (Windows, modo local) dispositivo dshow, ej.
                              "OBS Virtual Camera".
    Prioridad: DSHOW > WINDOW_TITLE > MONITOR > escritorio completo.
"""

import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
import config  # noqa: E402

MODULO = "modulo01_captura_video"
MAX_REINTENTOS = 3
ESPERA_ENTRE_REINTENTOS_SEG = 5


def _geometria_monitor(indice: int):
    """Devuelve (offset_x, offset_y, ancho, alto) del monitor `indice` (1-based)
    en Windows, o None si no se puede."""
    try:
        import ctypes
        import ctypes.wintypes as wt
    except Exception:
        return None
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass
    monitores = []
    proc = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong,
                              ctypes.POINTER(wt.RECT), ctypes.c_double)

    def _cb(h, hdc, lprc, data):
        r = lprc.contents
        monitores.append((r.left, r.top, r.right - r.left, r.bottom - r.top))
        return 1

    ctypes.windll.user32.EnumDisplayMonitors(0, 0, proc(_cb), 0)
    if 1 <= indice <= len(monitores):
        return monitores[indice - 1]
    return None


def _construir_comando():
    """
    Arma el comando de ffmpeg para captura de pantalla según SO.
    Resolución reducida a 720p por defecto: es suficiente para OCR/análisis
    visual y ahorra CPU y disco frente a capturar en la resolución nativa.
    """
    so = os.environ.get("KICK_VIDEO_SO", "linux").lower()
    resolucion = os.environ.get("KICK_VIDEO_RESOLUCION", "1280x720")
    fps = os.environ.get("KICK_VIDEO_FPS", "10")
    ventana = os.environ.get("KICK_VIDEO_WINDOW_TITLE", "").strip()
    # (Windows) nombre de un dispositivo de video dshow, ej: "OBS Virtual Camera".
    dshow_video = os.environ.get("KICK_VIDEO_DSHOW", "").strip()
    # (Windows) número de monitor a capturar (1, 2, 3...). Vacío = escritorio entero.
    monitor = os.environ.get("KICK_VIDEO_MONITOR", "").strip()
    # %Y%m%d-%H%M%S en vez de %s: en Windows ffmpeg no soporta %s en -strftime.
    salida = str(config.RAW_VIDEO_DIR / "video_%Y%m%d-%H%M%S.mp4")

    base = ["ffmpeg", "-y", "-loglevel", "warning"]
    salida_args = [
        "-f", "segment",
        "-segment_time", str(config.DURACION_CLIP_SEGUNDOS),
        "-strftime", "1",
        "-reset_timestamps", "1",
        salida,
    ]

    # --- Modo remoto: leer el video del HLS del canal de Kick ------------
    if config.CAPTURE_MODE == "remote":
        hls = config.resolver_hls_url()
        if not hls:
            raise RuntimeError(
                "CAPTURE_MODE=remote pero no se pudo resolver el HLS del canal. "
                "Revisá KICK_CANAL_SLUG o poné KICK_HLS_URL a mano.")
        config.log(MODULO, f"Modo remoto: leyendo video del HLS ({hls[:70]}...).")
        entrada = ["-reconnect", "1", "-reconnect_streamed", "1",
                   "-reconnect_delay_max", "5", "-i", hls]
        # -map 0:v:0 : el HLS trae varios streams; sin mapear explícito el muxer
        # de segmentos falla. El video ya viene en H.264 → se copia (liviano).
        return base + entrada + ["-map", "0:v:0", "-an", "-c:v", "copy"] + salida_args

    # --- Modo local: capturar la pantalla/ventana de la PC --------------
    if so == "linux":
        display = os.environ.get("KICK_VIDEO_DISPLAY", ":0.0")
        entrada = ["-f", "x11grab", "-framerate", fps, "-video_size", resolucion, "-i", display]
    elif so == "windows":
        if dshow_video:
            # Cámara/dispositivo dshow (ej. OBS Virtual Camera). OBS tiene que
            # estar abierto con la cámara virtual activada.
            config.log(MODULO, f"Capturando dispositivo dshow: {dshow_video}")
            entrada = ["-f", "dshow", "-framerate", fps, "-i", f"video={dshow_video}"]
        elif ventana:
            entrada = ["-f", "gdigrab", "-draw_mouse", "0", "-framerate", fps, "-i", f"title={ventana}"]
        elif monitor.isdigit() and _geometria_monitor(int(monitor)):
            ox, oy, w, h = _geometria_monitor(int(monitor))
            config.log(MODULO, f"Capturando monitor {monitor}: {w}x{h} en ({ox},{oy})")
            # -draw_mouse 0: sin esto gdigrab redibuja el cursor real cada frame
            # y se ve titilar el mouse en toda la pantalla.
            entrada = ["-f", "gdigrab", "-draw_mouse", "0", "-framerate", fps,
                       "-offset_x", str(ox), "-offset_y", str(oy),
                       "-video_size", f"{w}x{h}", "-i", "desktop"]
        else:
            # Escritorio completo: NO forzar -video_size (rompe con multi-monitor).
            entrada = ["-f", "gdigrab", "-draw_mouse", "0", "-framerate", fps, "-i", "desktop"]
    elif so == "mac":
        device = os.environ.get("KICK_VIDEO_DEVICE", "1")
        entrada = ["-f", "avfoundation", "-framerate", fps, "-video_size", resolucion, "-i", f"{device}:none"]
    else:
        raise ValueError(f"SO no soportado: {so}")

    # Bajar a 1280px de ancho para no acumular disco ni CPU.
    escala = ["-vf", "scale=1280:-2"]
    codificacion = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                    # mp4 fragmentado: cada segmento se puede leer aunque ffmpeg
                    # se corte a la mitad (no depende del 'moov atom' final).
                    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
                    "-g", str(int(fps) * 2)]  # keyframe cada ~2s

    return base + entrada + escala + codificacion + salida_args


def _titulo_ventana_activa() -> str:
    """Título de la ventana en primer plano en Windows (la pestaña del navegador,
    el juego, el editor)."""
    if sys.platform != "win32":
        return ""
    try:
        import ctypes
        u = ctypes.windll.user32
        h = u.GetForegroundWindow()
        n = u.GetWindowTextLengthW(h)
        b = ctypes.create_unicode_buffer(n + 1)
        u.GetWindowTextW(h, b, n + 1)
        return (b.value or "").strip()
    except Exception:
        return ""


def _muestrear_titulo():
    """Anota la ventana activa en metadata/ventana_activa.txt. El Módulo 8 lee
    este archivo (varias muestras) para saber qué está haciendo, en vez de
    depender solo de leer los píxeles."""
    t = _titulo_ventana_activa()
    if not t:
        return
    try:
        p = config.METADATA_DIR / "ventana_activa.txt"
        prev = p.read_text(encoding="utf-8").splitlines() if p.is_file() else []
        prev.append(f"{int(time.time())}\t{t}")
        p.write_text("\n".join(prev[-40:]) + "\n", encoding="utf-8")
    except OSError:
        pass


def _ejecutar_con_supervision():
    comando = _construir_comando()
    config.log(MODULO, f"Lanzando ffmpeg: {' '.join(comando)}")
    inicio = time.time()
    proceso = subprocess.Popen(
        comando, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True
    )

    while proceso.poll() is None:
        config.heartbeat(MODULO)
        _muestrear_titulo()
        time.sleep(3)

    codigo = proceso.returncode
    _, stderr = proceso.communicate()
    duracion = time.time() - inicio
    if codigo != 0:
        config.log(MODULO, f"ffmpeg terminó tras {duracion:.0f}s (código {codigo}). "
                           f"stderr: {stderr[-400:]}", "WARN")
    return codigo, duracion


def main():
    config.ensure_dirs()
    config.log(MODULO, "Módulo 1 (Captura de Video) iniciado.")

    remoto = config.CAPTURE_MODE == "remote"
    intentos_fallidos = 0
    espera = ESPERA_ENTRE_REINTENTOS_SEG
    while True:
        if config.espera_si_canal_offline(MODULO):
            intentos_fallidos = 0
            espera = ESPERA_ENTRE_REINTENTOS_SEG
            continue

        _codigo, duracion = _ejecutar_con_supervision()

        if duracion >= 30:
            intentos_fallidos = 0
            espera = ESPERA_ENTRE_REINTENTOS_SEG

        intentos_fallidos += 1

        # Modo remoto: nunca abandonamos (un stream en vivo se corta seguido).
        # Modo local: 3 fallos seguidos = problema real de captura de pantalla.
        if not remoto and intentos_fallidos > MAX_REINTENTOS:
            config.log(MODULO, f"Se superaron los {MAX_REINTENTOS} reintentos en modo local. "
                               f"El módulo se detiene. Revisar la fuente de captura.", "ERROR")
            sys.exit(1)

        config.heartbeat(MODULO)
        config.log(MODULO, f"Reintentando en {espera}s (intento {intentos_fallidos}).")
        time.sleep(espera)
        espera = min(espera * 2, 30)


if __name__ == "__main__":
    main()
