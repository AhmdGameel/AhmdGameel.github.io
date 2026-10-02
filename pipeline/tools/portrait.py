"""Cut the portrait out of its background and give it a white sticker outline.

Needs: pip install "rembg[cpu]" pillow  (downloads the silueta model on first run)
Usage: python pipeline/tools/portrait.py path/to/photo.png
"""
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter
from rembg import new_session, remove

ROOT = Path(__file__).resolve().parents[2]
SIZE, PAD, OUTLINE = 768, 28, 21

src = Image.open(sys.argv[1]).convert("RGB")
big = src.resize((SIZE, SIZE), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
big = ImageEnhance.Contrast(big).enhance(1.05)
mask = remove(big, session=new_session("silueta"), only_mask=True, post_process_mask=True)
mask = mask.convert("L").filter(ImageFilter.GaussianBlur(1.1))

W, H = SIZE + 2 * PAD, SIZE + PAD  # no padding at the bottom, the photo is cropped there

def pad(im, mode, fill):
    out = Image.new(mode, (W, H), fill)
    out.paste(im, (PAD, PAD))
    return out

m = pad(mask, "L", 0)
outline = m.filter(ImageFilter.MaxFilter(OUTLINE)).filter(ImageFilter.GaussianBlur(1.4))
outline = outline.point(lambda v: 255 if v > 110 else int(v * 2.3))
canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
canvas.paste(Image.new("RGBA", (W, H), (255, 255, 255, 255)), (0, 0), outline)
person = pad(big.convert("RGBA"), "RGBA", (0, 0, 0, 0))
person.putalpha(m)
canvas = Image.alpha_composite(canvas, person)
canvas = canvas.crop(canvas.getchannel("A").getbbox())
canvas.save(ROOT / "public" / "portrait.webp", "WEBP", quality=88, method=6)
print("portrait.webp", canvas.size)
