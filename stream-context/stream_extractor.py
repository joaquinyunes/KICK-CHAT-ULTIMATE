import subprocess
import threading
import logging
import time
import sys

import streamlink

import config

logger = logging.getLogger("stream_extractor")


def _get_stream_url(channel: str) -> str:
    base = channel.rstrip("/")
    slug = base.split("/")[-1]
    api = f"https://kick.com/api/v2/channels/{slug}"
    sessions = streamlink.Streamlink()
    streams = sessions.streams(api)
    if not streams:
        raise RuntimeError(f"No se encontraron streams para: {slug}")
    quality = config.STREAM_QUALITY
    if quality not in streams:
        quality = "best"
    return streams[quality].url


class StreamExtractor:
    def __init__(self, channel_url: str = None):
        self.channel_url = channel_url or config.KICK_CHANNEL_URL
        self._proc_audio = None
        self._proc_video = None
        self._running = False
        self._reconnect_delay = 2
        self._max_reconnect_delay = 60

    def _spawn_ffmpeg(self, stream_url: str):
        ffmpeg = config.FFMPEG_PATH

        audio_cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "warning",
            "-reconnect", "1", "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
            "-i", stream_url,
            "-vn", "-acodec", "libmp3lame", "-ab", "128k",
            "-ar", "16000", "-ac", "1",
            "-f", "mp3", "pipe:1"
        ]

        video_cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "warning",
            "-reconnect", "1", "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
            "-i", stream_url,
            "-vf", f"fps=1/{config.FRAME_INTERVAL}",
            "-q:v", "2",
            "-f", "image2pipe", "-vcodec", "mjpeg",
            "pipe:1"
        ]

        self._proc_audio = subprocess.Popen(
            audio_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        self._proc_video = subprocess.Popen(
            video_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        logger.info("FFmpeg processes spawned")

    def start(self, on_audio_frame, on_video_frame):
        self._running = True
        self._on_audio = on_audio_frame
        self._on_video = on_video_frame
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while self._running:
            try:
                logger.info(f"Conectando a {self.channel_url}...")
                stream_url = _get_stream_url(self.channel_url)
                logger.info(f"Stream URL obtenido")
                self._reconnect_delay = 2

                self._spawn_ffmpeg(stream_url)
                self._read_audio()
                self._read_video()

            except Exception as e:
                logger.error(f"Error en extractor: {e}")
                time.sleep(self._reconnect_delay)
                self._reconnect_delay = min(
                    self._reconnect_delay * 2, self._max_reconnect_delay
                )

    def _read_audio(self):
        proc = self._proc_audio
        if not proc or not proc.stdout:
            return
        while self._running and proc.poll() is None:
            chunk = proc.stdout.read(4096)
            if chunk:
                self._on_audio(chunk)

    def _read_video(self):
        proc = self._proc_video
        if not proc or not proc.stdout:
            return
        buf = b""
        while self._running and proc.poll() is None:
            byte = proc.stdout.read(1)
            if not byte:
                break
            buf += byte
            if buf[-2:] == b"\xff\xd9":
                if len(buf) > 1000:
                    self._on_video(buf)
                buf = b""

    def stop(self):
        self._running = False
        for p in (self._proc_audio, self._proc_video):
            if p and p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()
        logger.info("Extractor detenido")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    config.validate()

    def on_audio(data):
        sys.stdout.write(f"[AUDIO] {len(data)} bytes\n")

    def on_video(data):
        sys.stdout.write(f"[FRAME] {len(data)} bytes\n")

    extractor = StreamExtractor()
    extractor.start(on_audio, on_video)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        extractor.stop()
