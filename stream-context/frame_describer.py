import logging
import time
import os
import threading

from google import genai
from google.genai import types

import config

logger = logging.getLogger("frame_describer")


class FrameDescriber:
    def __init__(self):
        self.client = genai.Client(api_key=config.GEMINI_API_KEY)
        self._callbacks = []
        self._running = False
        self._last_summary = ""
        self._last_timestamp = 0
        self._frame_count = 0

    def on_description(self, callback):
        self._callbacks.append(callback)

    def describe_with_context(self, frame_bytes: bytes, audio_context: str) -> str:
        try:
            prompt = f"""Eres un asistente que analiza streams en vivo de Kick.com.
Tienes acceso a una captura del stream y a lo que se dijo en los ultimos 2 minutos.

CONTEXTO DE AUDIO (lo que se dijo):
{audio_context if audio_context else "No hay audio capturado aun."}

INSTRUCCIONES:
Basandote en la imagen Y el audio, genera un RESUMEN de lo que ha pasado en los ultimos 2 minutos.
Incluye:
- Que esta haciendo el streamer (juego, actividad, interaccion)
- Que se esta discutiendo o comentando (temas del chat, reacciones)
- Cambios de estado o eventos importantes
- Contexto emocional y energico del stream

Formato: 2-4 oraciones en español. Sé directo y descriptivo."""

            response = self.client.models.generate_content(
                model="gemini-2.0-flash",
                contents=[
                    types.Content(
                        parts=[
                            types.Part(text=prompt),
                            types.Part(
                                inline_data=types.Blob(
                                    mime_type="image/jpeg",
                                    data=frame_bytes
                                )
                            )
                        ]
                    )
                ],
                config=types.GenerateContentConfig(
                    max_output_tokens=300,
                    temperature=0.3
                )
            )
            summary = response.text.strip()
            self._last_summary = summary
            self._last_timestamp = time.time()
            self._frame_count += 1

            logger.debug(f"[RESUMEN {self._frame_count}] {summary}")

            entry = {
                "summary": summary,
                "timestamp": time.time(),
                "frame_number": self._frame_count,
                "audio_context": audio_context
            }
            for cb in self._callbacks:
                try:
                    cb(entry)
                except Exception as e:
                    logger.error(f"Error en callback de frame: {e}")

            return summary

        except Exception as e:
            logger.error(f"Error generando resumen: {e}")
            return self._last_summary or "No se pudo generar el resumen"

    def start_continuous(self, summary_queue):
        self._running = True
        threading.Thread(target=self._process_loop, args=(summary_queue,), daemon=True).start()

    def _process_loop(self, summary_queue):
        while self._running:
            try:
                item = summary_queue.get(timeout=5)
                frame_bytes = item["frame"]
                audio_context = item["audio"]
                self.describe_with_context(frame_bytes, audio_context)
            except Exception:
                continue

    def get_last_summary(self) -> str:
        return self._last_summary

    def stop(self):
        self._running = False
        logger.info("Describer detenido")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    config.validate()

    describer = FrameDescriber()
    test_img = "test_frame.jpg"
    if os.path.exists(test_img):
        with open(test_img, "rb") as f:
            desc = describer.describe_with_context(f.read(), "Contexto de prueba")
        print(f"[RESUMEN] {desc}")
    else:
        print(f"No se encontro {test_img}")
