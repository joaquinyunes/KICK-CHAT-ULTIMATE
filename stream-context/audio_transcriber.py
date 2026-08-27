import json
import asyncio
import logging
import time
import threading
from collections import deque

from deepgram import DeepgramClient
from deepgram.listen.v1.socket_client import V1SocketClient
from deepgram.core.events import EventType

import config

logger = logging.getLogger("audio_transcriber")


class AudioTranscriber:
    def __init__(self):
        self.client = DeepgramClient(api_key=config.DEEPGRAM_API_KEY)
        self.connection = None
        self._buffer = deque(maxlen=config.AUDIO_WINDOW_SECONDS * 50)
        self._current_text = ""
        self._callbacks = []
        self._running = False
        self._thread = None

    def on_transcript(self, callback):
        self._callbacks.append(callback)

    def _handle_message(self, msg):
        if hasattr(msg, "channel"):
            alternatives = msg.channel.alternatives
            if alternatives:
                transcript = alternatives[0].transcript
                is_final = getattr(msg, "is_final", False)

                if is_final and transcript.strip():
                    entry = {
                        "text": transcript.strip(),
                        "timestamp": time.time(),
                        "confidence": getattr(alternatives[0], "confidence", 0)
                    }
                    self._buffer.append(entry)
                    self._current_text = transcript.strip()
                    logger.debug(f"[FINAL] {transcript}")

                    for cb in self._callbacks:
                        try:
                            cb(entry)
                        except Exception as e:
                            logger.error(f"Error en callback de transcripcion: {e}")

    def _run_sync(self):
        try:
            with self.client.listen.v1.connect(
                model="nova-2",
                language="es",
                punctuate=True,
                interim_results=True,
                smart_format=True,
                encoding="linear16",
                sample_rate=16000,
                channels=1,
            ) as socket:
                self.connection = socket
                logger.info("Deepgram WebSocket conectado (v7 SDK)")

                socket.on(EventType.OPEN, lambda _: logger.info("Conexion abierta"))
                socket.on(EventType.MESSAGE, self._handle_message)
                socket.on(EventType.ERROR, lambda e: logger.error(f"Error WebSocket: {e}"))
                socket.on(EventType.CLOSE, lambda _: logger.info("Conexion cerrada"))

                socket.start_listening()

        except Exception as e:
            logger.error(f"Error en transcriber: {e}")
            raise

    async def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run_sync, daemon=True)
        self._thread.start()
        logger.info("Transcriber thread iniciado")

    def feed_audio(self, audio_bytes: bytes):
        if self.connection and self._running:
            try:
                self.connection.send_media(audio_bytes)
            except Exception as e:
                logger.error(f"Error enviando audio a Deepgram: {e}")

    def get_recent_context(self, seconds: int = None) -> str:
        seconds = seconds or config.AUDIO_WINDOW_SECONDS
        cutoff = time.time() - seconds
        recent = [e["text"] for e in self._buffer if e["timestamp"] >= cutoff]
        return " ".join(recent)

    def get_current(self) -> str:
        return self._current_text

    async def stop(self):
        self._running = False
        if self.connection:
            try:
                self.connection.send_close_stream()
            except Exception:
                pass
        logger.info("Transcriber detenido")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    config.validate()

    def on_entry(entry):
        print(f"[TRANSCRIPT] {entry['text']}")

    transcriber = AudioTranscriber()
    transcriber.on_transcript(on_entry)

    async def main():
        await transcriber.start()
        print("Esperando audio... (presiona Ctrl+C para salir)")
        try:
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            await transcriber.stop()

    asyncio.run(main())
