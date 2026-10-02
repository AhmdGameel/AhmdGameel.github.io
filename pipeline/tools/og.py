"""Render the Open Graph card: the name as a dot matrix, like the hero."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
W, H = 1200, 630
PAPER, INK, INK3, SIGNAL, LINE = (243, 240, 232), (22, 21, 15), (139, 135, 124), (255, 77, 28), (214, 209, 196)

def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()

bold = font(["DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"], 132)
mono = font(["DejaVuSansMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"], 22)

mask = Image.new("L", (W, H), 0)
md = ImageDraw.Draw(mask)
md.text((64, 130), "Ahmed", font=bold, fill=255)
md.text((130, 265), "Gameel", font=bold, fill=255)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)
for y in range(0, H, 48):
    d.line([(0, y), (W, y)], fill=(234, 230, 220))
for x in range(0, W, 48):
    d.line([(x, 0), (x, H)], fill=(234, 230, 220))

step = 6
px = mask.load()
i = 0
for y in range(0, H, step):
    for x in range(0, W, step):
        if px[x, y] > 128:
            i += 1
            color = SIGNAL if i % 97 == 0 else INK
            d.rectangle([x, y, x + step - 2, y + step - 2], fill=color)

d.text((70, 70), "Open to Data Engineering roles, Cairo, Egypt", font=mono, fill=INK3)

# Portrait standing in an orange arch, like the hero
arch_l, arch_r, arch_t, arch_b = 820, 1130, 170, 630
d.rounded_rectangle([arch_l, arch_t, arch_r, arch_b + 40], radius=(arch_r - arch_l) // 2, fill=SIGNAL)
portrait = Image.open(ROOT / "public" / "portrait.webp").convert("RGBA")
ph = 520
pw = int(portrait.width * ph / portrait.height)
portrait = portrait.resize((pw, ph), Image.LANCZOS)
img.paste(portrait, ((arch_l + arch_r) // 2 - pw // 2, H - ph), portrait)
d = ImageDraw.Draw(img)
d.line([(70, 480), (760, 480)], fill=LINE, width=1)
d.text((70, 500), "Data Engineer", font=font(["DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"], 30), fill=INK)
d.text((70, 548), "Spark, Kafka, Flink, Airflow, AWS", font=mono, fill=INK3)
d.text((70, 580), "ahmdgameel.github.io", font=mono, fill=SIGNAL)
img.save(ROOT / "public" / "og.png", optimize=True)
print("og.png written")
