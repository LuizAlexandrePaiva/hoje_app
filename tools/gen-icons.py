"""Gera os ícones do PWA (sol nascendo sobre o horizonte). Uso: python3 tools/gen-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

BG = (14, 16, 20, 255)
SUN = (61, 220, 151, 255)
LINE = (236, 238, 243, 255)
OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 4  # supersampling para bordas suaves


def draw(size, maskable=False):
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BG)
        scale = 0.62  # conteúdo dentro da zona segura
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG)
        scale = 0.78
    c = s / 2
    unit = s * scale
    horizon = c + unit * 0.12
    r = unit * 0.30
    # sol: meio disco acima do horizonte
    d.pieslice([c - r, horizon - r, c + r, horizon + r], 180, 360, fill=SUN)
    # raios
    import math
    for ang in (200, 235, 270, 305, 340):
        a = math.radians(ang)
        r1, r2 = r * 1.28, r * 1.62
        d.line([c + r1 * math.cos(a), horizon + r1 * math.sin(a),
                c + r2 * math.cos(a), horizon + r2 * math.sin(a)], fill=SUN, width=int(unit * 0.055))
    # horizonte
    w = unit * 0.82
    t = unit * 0.06
    d.rounded_rectangle([c - w / 2, horizon + t * 0.6, c + w / 2, horizon + t * 1.6], radius=int(t / 2), fill=LINE)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
draw(192).save(OUT / "icon-192.png")
draw(512).save(OUT / "icon-512.png")
draw(512, maskable=True).save(OUT / "icon-maskable-512.png")
print("ícones gerados em", OUT)
