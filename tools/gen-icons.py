"""Gera os ícones do PWA (moeda com R$). Uso: python3 tools/gen-icons.py [--out DIR]"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BG = (18, 19, 17, 255)           # --bg
COIN = (98, 207, 143, 255)       # --pos, verde de destaque do app
COIN_DARK = (58, 146, 96, 255)   # borda / lateral da moeda
INK = (7, 36, 20, 255)           # --pos-ink, texto sobre o verde
# a mesma fonte do app (variável); o R$ usa o peso 700
FONT = str(Path(__file__).resolve().parent.parent / "app" / "fonts" / "red-hat-text.woff2")
SS = 4  # supersampling para bordas suaves


def coin(d, cx, cy, r, unit):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=COIN_DARK)
    ri = r * 0.90
    d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=COIN)
    rr = r * 0.78  # anel interno
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=COIN_DARK, width=max(1, int(unit * 0.018)))
    font = ImageFont.truetype(FONT, int(r * 0.80))
    font.set_variation_by_axes([700])
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
ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "app" / "icons"))
args = ap.parse_args()
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
draw(192).save(out / "icon-192.png")
draw(512).save(out / "icon-512.png")
draw(512, maskable=True).save(out / "icon-maskable-512.png")
draw(180).save(out / "apple-touch-icon.png")
draw(48).save(out / "favicon-48.png")
print("ícones gerados em", out)
