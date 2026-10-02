"""Dot-matrix AG monogram: favicon.svg plus PNG icons."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2] / "public"
A = ["01110", "10001", "10001", "11111", "10001", "10001", "10001"]
G = ["01110", "10001", "10000", "10111", "10001", "10001", "01111"]
CELL, DOT = 2.4, 2.0
OX = (32 - (10 * CELL + DOT)) / 2
OY = (32 - (6 * CELL + DOT)) / 2
SIGNAL = (1, 6, 4)  # glyph, row, col of the orange dot

def dots():
    for gi, g in enumerate([A, G]):
        for r, row in enumerate(g):
            for c, ch in enumerate(row):
                if ch == "1":
                    yield OX + (gi * 6 + c) * CELL, OY + r * CELL, (gi, r, c) == SIGNAL

svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">', '<rect width="32" height="32" rx="7" fill="#16150f"/>']
for x, y, s in dots():
    svg.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{DOT}" height="{DOT}" rx="0.3" fill="{"#ff4d1c" if s else "#f3f0e8"}"/>')
svg.append("</svg>")
(ROOT / "favicon.svg").write_text("\n".join(svg))

for size, name in [(180, "apple-touch-icon.png"), (512, "icon-512.png")]:
    k = size / 32
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=7 * k, fill=(22, 21, 15))
    for x, y, s in dots():
        d.rounded_rectangle([x * k, y * k, (x + DOT) * k, (y + DOT) * k], radius=0.3 * k, fill=(255, 77, 28) if s else (243, 240, 232))
    im.save(ROOT / name)
print("icons written")
