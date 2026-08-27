import asyncio
import logging
import time
import queue
import threading
from collections import deque

import config
from stream_extractor import StreamExtractor
from audio_transcriber import AudioTranscriber
from frame_describer import FrameDescriber

logger = logging.getLogger("orchestrator")


class Orchestrator:
    def __init__(self, channel_url: str = None):
        self.channel_url = channel_url or config.KICK_CHANNEL_URL
        self.extractor = StreamExtractor(self.channel_url)
        self.transcriber = AudioTranscriber()
        self.describer = FrameDescriber()
        self._frame_queue = queue.Queue(maxsize=5)
        self._summary_queue = queue.Queue(maxsize=5)
        self._context_callbacks = []
        self._running = False
        self._audio_buffer = deque()
        self._audio_buffer_lock = threading.Lock()
        self._context_history = []
        self._history_max = 50
        self._last_summary = ""

    def on_context(self, callback):
        self._context_callbacks.append(callback)

    def _on_audio_data(self, audio_bytes: bytes):
        self.transcriber.feed_audio(audio_bytes)

    def _on_video_frame(self, frame_bytes: bytes):
        if not self._frame_queue.full():
            self._frame_queue.put(frame_bytes)

    def _on_transcript(self, entry: dict):
        with self._audio_buffer_lock:
            self._audio_buffer.append(entry)
            cutoff = time.time() - config.AUDIO_WINDOW_SECONDS
            while self._audio_buffer and self._audio_buffer[0]["timestamp"] < cutoff:
                self._audio_buffer.popleft()

        self._context_history.append(entry)
        if len(self._context_history) > self._history_max:
            self._context_history = self._context_history[-self._history_max:]

    def _get_audio_context(self) -> str:
        with self._audio_buffer_lock:
            texts = [e["text"] for e in self._audio_buffer]
        return " ".join(texts) if texts else ""

    def _on_summary(self, entry: dict):
        self._last_summary = entry["summary"]

        audio_ctx = self._get_audio_context()
        combined = {
            "timestamp": entry["timestamp"],
            "audio": audio_ctx,
            "visual": entry["summary"],
            "combined": f"[RESUMEN 2min]: {entry['summary']}"
        }

        self._context_history.append(combined)
        if len(self._context_history) > self._history_max:
            self._context_history = self._context_history[-self._history_max:]

        logger.info(f"\n{'='*60}\n[RESUMEN] {entry['summary']}\n{'='*60}")

        for cb in self._context_callbacks:
            try:
                cb(combined)
            except Exception as e:
                logger.error(f"Error en callback de contexto: {e}")

    def _frame_feeder(self):
        while self._running:
            try:
                frame_bytes = self._frame_queue.get(timeout=5)
                audio_context = self._get_audio_context()
                if not self._summary_queue.full():
                    self._summary_queue.put({
                        "frame": frame_bytes,
                        "audio": audio_context
                    })
            except Exception:
                continue

    def get_full_context(self) -> str:
        recent = self._context_history[-10:]
        if not recent:
            return "Sin contexto disponible aun."
        lines = []
        for entry in recent:
            ts = time.strftime("%H:%M:%S", time.localtime(entry["timestamp"]))
            lines.append(f"[{ts}] {entry['combined']}")
        return "\n".join(lines)

    def get_prompt_context(self) -> str:
        audio_ctx = self._get_audio_context()
        visual_ctx = self._last_summary

        prompt_parts = []
        if visual_ctx:
            prompt_parts.append(f"[ULTIMO RESUMEN: {visual_ctx}]")
        if audio_ctx:
            prompt_parts.append(f"[CONTEXTO AUDIO: {audio_ctx}]")

        if not prompt_parts:
            return "Esperando datos del stream en vivo..."

        return " ".join(prompt_parts)

    async def start(self):
        self._running = True
        logger.info(f"Iniciando captura de: {self.channel_url}")
        logger.info(f"Frame cada {config.FRAME_INTERVAL}s | Audio window: {config.AUDIO_WINDOW_SECONDS}s")

        await self.transcriber.start()
        self.transcriber.on_transcript(self._on_transcript)
        self.describer.on_description(self._on_summary)
        self.describer.start_continuous(self._summary_queue)

        threading.Thread(target=self._frame_feeder, daemon=True).start()
        self.extractor.start(self._on_audio_data, self._on_video_frame)

        logger.info("Orquestador corriendo. Presiona Ctrl+C para detener.")

    async def stop(self):
        self._running = False
        self.extractor.stop()
        await self.transcriber.stop()
        self.describer.stop()
        logger.info("Orquestador detenido completamente")


async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S"
    )

    config.validate()

    orch = Orchestrator()

    def on_new_context(entry):
        print(f"\n{'='*60}")
        print(f"[{time.strftime('%H:%M:%S')}] RESUMEN DEL STREAM")
        print(f"{'='*60}")
        print(f"{entry['combined']}")
        print(f"\n[PROMPT LISTO]: {orch.get_prompt_context()}")
        print(f"{'='*60}\n")

    orch.on_context(on_new_context)

    await orch.start()

    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        await orch.stop()


if __name__ == "__main__":
    asyncio.run(main())
