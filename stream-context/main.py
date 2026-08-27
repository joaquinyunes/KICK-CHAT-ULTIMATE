import asyncio
import logging
import time
import sys

import config
from orchestrator import Orchestrator

logger = logging.getLogger("main")


async def run_module_test():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S"
    )

    print("=" * 60)
    print("  STREAM CONTEXT - Test de modulos independientes")
    print("=" * 60)

    from stream_extractor import StreamExtractor
    from audio_transcriber import AudioTranscriber
    from frame_describer import FrameDescriber
    from error_handler import health

    modules = [
        ("StreamExtractor", StreamExtractor),
        ("AudioTranscriber", AudioTranscriber),
        ("FrameDescriber", FrameDescriber),
    ]

    for name, cls in modules:
        try:
            obj = cls()
            print(f"  [OK] {name} se instancia correctamente")
            health.record_ok(name.lower())
        except Exception as e:
            print(f"  [FAIL] {name}: {e}")
            health.record_error(name.lower(), str(e))

    print()
    print("Estado de salud:", health.report())
    print()


async def run_full():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S"
    )

    print("=" * 60)
    print("  STREAM CONTEXT - Captura en vivo de Kick")
    print("=" * 60)
    print(f"  Canal: {config.KICK_CHANNEL_URL}")
    print(f"  Resumen cada: {config.FRAME_INTERVAL // 60} minutos")
    print(f"  Audio window: {config.AUDIO_WINDOW_SECONDS // 60} minutos")
    print(f"  Costo: GRATIS (Deepgram $200 credit + Gemini free tier)")
    print("=" * 60)

    orch = Orchestrator()

    def on_context(entry):
        ts = time.strftime("%H:%M:%S", time.localtime(entry["timestamp"]))
        print(f"\n{'─'*60}")
        print(f"[{ts}] RESUMEN DEL STREAM (ultimos 2 min)")
        print(f"{'─'*60}")
        print(f"\n{entry['combined']}")
        print(f"\n{'─'*60}")
        print(f"PROMPT LISTO: {orch.get_prompt_context()[:200]}...")
        print(f"{'─'*60}")

    orch.on_context(on_context)

    await orch.start()

    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print("\nDeteniendo...")
        await orch.stop()
        print("Listo.")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        asyncio.run(run_module_test())
    else:
        asyncio.run(run_full())
