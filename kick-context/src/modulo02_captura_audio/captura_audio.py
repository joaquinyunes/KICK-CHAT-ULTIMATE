"""
Módulo 2 — Captura de Audio

Lanza ffmpeg en modo segmentado para capturar audio (micrófono y/o
audio del sistema) en clips de N segundos, de forma continua.

Este módulo es INDEPENDIENTE del video: si el Módulo 1 (video) muere,
este sigue funcionando exactamente igual, porque no importa nada de él
ni comparte proceso.

Uso:
    python3 captura_audio.py

Variables de entorno relevantes:
    KICK_CONTEXT_DATA_DIR       carpeta base de datos
    KICK_CONTEXT_CLIP_SEGUNDOS  duración de cada clip (default 10)
    KICK_CAPTURE_MODE          "local" (captura dispositivos de la PC) |
                                "remote" (lee el audio del HLS del canal). En
                                "remote" se usa KICK_CANAL_SLUG / KICK_HLS_URL
                                y se ignora KICK_AUDIO_DEVICE*.
    KICK_AUDIO_SO               "linux" | "windows" | "mac" (default linux)
    KICK_AUDIO_DEVICE           nombre/id del dispositivo de audio principal
                                 (típicamente el audio del sistema / lo que se
                                 escucha en el stream)
    KICK_AUDIO_DEVICE_2         (opcional) segundo dispositivo, típicamente el
                                 micrófono. Si se define, se mezcla con el
                                 principal (amix) y el clip queda con ambos.

Capturar el audio del SISTEMA en Windows requiere un dispositivo que lo
exponga como entrada: activá "Stereo Mix" en la config de sonido, o
instalá un cable virtual (VB-Audio Virtual Cable) y usá su nombre en
KICK_AUDIO_DEVICE. Listá los nombres con:
    ffmpeg -list_devices true -f dshow -i dummy
"""

import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
import config  # noqa: E402

MODULO = "modulo02_captura_audio"
MAX_REINTENTOS = 3
ESPERA_ENTRE_REINTENTOS_SEG = 5


def _construir_comando():
    """
    Arma el comando de ffmpeg según el sistema operativo.
    Cada SO tiene un backend de captura de audio distinto en ffmpeg.
    Ajusta KICK_AUDIO_DEVICE al nombre real de tu dispositivo si el
    default no funciona (correr `ffmpeg -list_devices true -f dshow -i dummy`
    en Windows, o `pactl list sources` en Linux, para ver los nombres).
    """
    so = os.environ.get("KICK_AUDIO_SO", "linux").lower()
    device = os.environ.get("KICK_AUDIO_DEVICE", "default")
    device2 = os.environ.get("KICK_AUDIO_DEVICE_2", "").strip()
    # %Y%m%d-%H%M%S en vez de %s: en Windows ffmpeg no soporta %s en -strftime.
    salida = str(config.RAW_AUDIO_DIR / "audio_%Y%m%d-%H%M%S.wav")

    base = ["ffmpeg", "-y", "-loglevel", "warning"]
    salida_args = [
        "-f", "segment",
        "-segment_time", str(config.DURACION_CLIP_SEGUNDOS),
        "-strftime", "1",
        "-reset_timestamps", "1",
        salida,
    ]

    # --- Modo remoto: leer el audio del HLS del canal de Kick -------------
    if config.CAPTURE_MODE == "remote":
        hls = config.resolver_hls_url()
        if not hls:
            raise RuntimeError(
                "CAPTURE_MODE=remote pero no se pudo resolver el HLS del canal. "
                "Revisá KICK_CANAL_SLUG o poné KICK_HLS_URL a mano.")
        config.log(MODULO, f"Modo remoto: leyendo audio del HLS ({hls[:70]}...).")
        entrada = ["-reconnect", "1", "-reconnect_streamed", "1",
                   "-reconnect_delay_max", "5", "-i", hls]
        # -map 0:a:0 : el HLS trae varios streams (audio, video, id3); si no se
        # mapea explícito, el muxer de segmentos falla ("no packets").
        conversion = ["-map", "0:a:0", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1"]
        return base + entrada + conversion + salida_args

    # --- Modo local: capturar dispositivos de audio de la PC -------------
    dispositivos = [device] + ([device2] if device2 else [])

    def _entrada_para(dev):
        if so == "linux":
            return ["-f", "pulse", "-i", dev]
        if so == "windows":
            return ["-f", "dshow", "-i", f"audio={dev}"]
        if so == "mac":
            return ["-f", "avfoundation", "-i", f":{dev}"]
        raise ValueError(f"SO no soportado: {so}")

    entrada = []
    for dev in dispositivos:
        entrada += _entrada_para(dev)

    # Si hay dos dispositivos, se mezclan en una sola pista.
    mezcla = []
    if len(dispositivos) == 2:
        mezcla = ["-filter_complex", "amix=inputs=2:duration=longest:normalize=0", "-ac", "2"]

    return base + entrada + mezcla + salida_args


def _ejecutar_con_supervision():
    """
    Corre ffmpeg y bloquea mientras vive. Si el proceso termina (crash,
    dispositivo desconectado, etc.), devuelve el código de salida para
    que el bucle principal decida si reintenta.
    """
    comando = _construir_comando()
    config.log(MODULO, f"Lanzando ffmpeg: {' '.join(comando)}")
    inicio = time.time()
    proceso = subprocess.Popen(
        comando, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True
    )

    # Mientras ffmpeg vive, actualizamos heartbeat periódicamente
    while proceso.poll() is None:
        config.heartbeat(MODULO)
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
    config.log(MODULO, "Módulo 2 (Captura de Audio) iniciado.")

    remoto = config.CAPTURE_MODE == "remote"
    intentos_fallidos = 0
    espera = ESPERA_ENTRE_REINTENTOS_SEG
    while True:
        if config.espera_si_canal_offline(MODULO):
            intentos_fallidos = 0
            espera = ESPERA_ENTRE_REINTENTOS_SEG
            continue

        # Modo local sin dispositivo configurado: no hay nada que capturar,
        # esperamos tranquilos en vez de crashear en loop.
        if not remoto and not os.environ.get("KICK_AUDIO_DEVICE", "").strip():
            config.heartbeat(MODULO)
            config.log(MODULO, "Modo local sin KICK_AUDIO_DEVICE: sin captura de audio. "
                               "En espera.")
            time.sleep(30)
            continue

        _codigo, duracion = _ejecutar_con_supervision()

        # Si ffmpeg estuvo funcionando un rato largo, la caída es un incidente
        # nuevo, no una racha: se resetea el contador y la espera.
        if duracion >= 30:
            intentos_fallidos = 0
            espera = ESPERA_ENTRE_REINTENTOS_SEG

        intentos_fallidos += 1

        # En modo remoto un stream en vivo se corta seguido (pausas, cortes del
        # encoder, tandas). Nunca abandonamos: reintentamos con backoff. En modo
        # local, si falla 3 veces seguidas es un problema real (dispositivo).
        if not remoto and intentos_fallidos > MAX_REINTENTOS:
            config.log(MODULO, f"Se superaron los {MAX_REINTENTOS} reintentos en modo local. "
                               f"El módulo se detiene. Revisar dispositivo de audio.", "ERROR")
            sys.exit(1)

        config.heartbeat(MODULO)
        config.log(MODULO, f"Reintentando en {espera}s (intento {intentos_fallidos}).")
        time.sleep(espera)
        espera = min(espera * 2, 30)


if __name__ == "__main__":
    main()
