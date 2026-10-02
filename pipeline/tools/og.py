"""Render the Open Graph share card: the name as a dot matrix, like the hero."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
W, H = 1200, 630
PAPER, INK, INK3, SIGNAL, LINE, GRID = (243, 240, 232), (22, 21, 15), (139, 135, 124), (255, 77, 28), (214, 209, 196), (234, 230, 220)


def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


BOLD = ["DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
MONO = ["DejaVuSansMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]

mask = Image.new("L", (W, H), 0)
md = ImageDraw.Draw(mask)
md.text((70, 120), "Ahmed", font=font(BOLD, 160), fill=255)
md.text((170, 280), "Gameel", font=font(BOLD, 160), fill=255)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)
for y in range(0, H, 48):
    d.line([(0, y), (W, y)], fill=GRID)
for x in range(0, W, 48):
    d.line([(x, 0), (x, H)], fill=GRID)

step, i, px = 7, 0, mask.load()
for y in range(0, H, step):
    for x in range(0, W, step):
        if px[x, y] > 128:
            i += 1
            d.rectangle([x, y, x + step - 2, y + step - 2], fill=SIGNAL if i % 211 == 0 else INK)

d.text((70, 66), "Open to Data Engineering opportunities", font=font(MONO, 22), fill=INK3)
d.line([(70, 500), (W - 70, 500)], fill=LINE, width=1)
d.text((70, 522), "Data Engineer", font=font(BOLD, 30), fill=INK)
d.text((70, 568), "Python, SQL, PySpark, Airflow, AWS Glue", font=font(MONO, 22), fill=INK3)
d.text((W - 70, 568), "ahmdgameel.github.io", font=font(MONO, 22), fill=SIGNAL, anchor="ra")
img.save(ROOT / "public" / "og.png", optimize=True)
print("og.png written")
