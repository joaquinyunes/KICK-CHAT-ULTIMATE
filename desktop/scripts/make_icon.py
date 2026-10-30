"""Genera desktop/assets/icon.ico (cuadrado verde con una K). Se ejecuta una vez; el .ico se versiona."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = 256
out = Path(__file__).resolve().parents[1] / "assets" / "icon.ico"
out.parent.mkdir(exist_ok=True)

im = Image.new("RGBA", (S, S), (13, 15, 20, 255))
d = ImageDraw.Draw(im)
d.rounded_rectangle((8, 8, S - 8, S - 8), radius=44, fill=(83, 252, 24, 255))
try:
    font = ImageFont.truetype("arialbd.ttf", 170)
except OSError:
    font = ImageFont.load_default()
d.text((S / 2, S / 2 + 6), "K", font=font, fill=(7, 20, 10, 255), anchor="mm")
im.save(out, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print(out)
