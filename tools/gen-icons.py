"""Gera os ícones do PWA (moeda com R$). Uso: python3 tools/gen-icons.py [--out DIR]"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BG = (14, 16, 20, 255)
COIN = (61, 220, 151, 255)       # verde de destaque do app
COIN_DARK = (34, 160, 107, 255)  # borda / lateral da moeda
INK = (6, 42, 27, 255)           # texto sobre o verde
FONT = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
SS = 4  # supersampling para bordas suaves


def coin(d, cx, cy, r, unit):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=COIN_DARK)
    ri = r * 0.90
    d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=COIN)
    rr = r * 0.78  # anel interno
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=COIN_DARK, width=max(1, int(unit * 0.018)))
    font = ImageFont.truetype(FONT, int(r * 0.80))
    d.text((cx, cy), "R$", font=font, fill=INK, anchor="mm")


def draw(size, maskable=False):
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BG)
        unit = s * 0.66  # conteúdo dentro da zona segura
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG)
        unit = s * 0.84
    c = s / 2
    coin(d, c, c, unit * 0.40, unit)
    return img.resize((size, size), Image.LANCZOS)


ap = argparse.ArgumentParser()
ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "icons"))
args = ap.parse_args()
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
draw(192).save(out / "icon-192.png")
draw(512).save(out / "icon-512.png")
draw(512, maskable=True).save(out / "icon-maskable-512.png")
draw(180).save(out / "apple-touch-icon.png")
draw(48).save(out / "favicon-48.png")
print("ícones gerados em", out)
