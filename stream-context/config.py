import os
from pathlib import Path
from dotenv import load_dotenv

_dir = Path(__file__).parent
load_dotenv(_dir / ".env")

DEEPGRAM_API_KEY: str = os.getenv("DEEPGRAM_API_KEY", "")
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
KICK_CHANNEL_URL: str = os.getenv("KICK_CHANNEL_URL", "")
FFMPEG_PATH: str = os.getenv("FFMPEG_PATH", "ffmpeg")
FRAME_INTERVAL: int = int(os.getenv("FRAME_INTERVAL", "120"))
AUDIO_WINDOW_SECONDS: int = int(os.getenv("AUDIO_WINDOW_SECONDS", "120"))
STREAM_QUALITY: str = os.getenv("STREAM_QUALITY", "best")

TEMP_DIR = _dir / "temp"
TEMP_DIR.mkdir(exist_ok=True)

AUDIO_PIPE = str(TEMP_DIR / "audio_pipe.mp3")
FRAMES_DIR = str(TEMP_DIR / "frames")
os.makedirs(FRAMES_DIR, exist_ok=True)


def validate():
    missing = []
    if not DEEPGRAM_API_KEY:
        missing.append("DEEPGRAM_API_KEY")
    if not GEMINI_API_KEY:
        missing.append("GEMINI_API_KEY")
    if not KICK_CHANNEL_URL:
        missing.append("KICK_CHANNEL_URL")
    if missing:
        raise EnvironmentError(
            f"Faltan variables de entorno: {', '.join(missing)}\n"
            "Copia .env.example a .env y completa tus credenciales."
        )
