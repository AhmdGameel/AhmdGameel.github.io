"""Render the Open Graph card: the name as a dot matrix, like the hero."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 1200, 630
PAPER, INK, INK3, SIGNAL, LINE = (243, 240, 232), (22, 21, 15), (139, 135, 124), (255, 77, 28), (214, 209, 196)

def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()

bold = font(["DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"], 168)
mono = font(["DejaVuSansMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"], 22)

mask = Image.new("L", (W, H), 0)
md = ImageDraw.Draw(mask)
md.text((70, 120), "Ahmed", font=bold, fill=255)
md.text((170, 290), "Gameel", font=bold, fill=255)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)
for y in range(0, H, 48):
    d.line([(0, y), (W, y)], fill=(234, 230, 220))
for x in range(0, W, 48):
    d.line([(x, 0), (x, H)], fill=(234, 230, 220))

step = 7
px = mask.load()
i = 0
for y in range(0, H, step):
    for x in range(0, W, step):
        if px[x, y] > 128:
            i += 1
            color = SIGNAL if i % 53 == 0 else INK
            d.rectangle([x, y, x + step - 2, y + step - 2], fill=color)

d.text((70, 60), "source kafka://cv  ->  parse  ->  validate  ->  materialize view ahmed_gameel", font=mono, fill=INK3)
d.line([(70, 530), (W - 70, 530)], fill=LINE, width=1)
d.text((70, 550), "Data Engineer  /  Spark, Kafka, Flink, Airflow, AWS  /  ahmdgameel.github.io", font=mono, fill=INK)
img.save(ROOT / "public" / "og.png", optimize=True)
print("og.png written")
