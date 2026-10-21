"""
把 assets-src/mascot/*.png 处理为透明底素材，输出到 src/renderer/src/assets/mascot/
- 从四周泛洪去掉白色背景（角色有深色描边，内部白色不会被误删）
- 按内容裁边，缩放到最长边 MAX
- avatar 额外裁出头部，生成正方形 logo 与应用图标
"""
import os
import sys
from collections import deque

from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "assets-src", "mascot")
DST = os.path.join(ROOT, "src", "renderer", "src", "assets", "mascot")
BUILD = os.path.join(ROOT, "build")
MAX = 420
RENAME = {"sleep": "chill"}

os.makedirs(DST, exist_ok=True)
os.makedirs(BUILD, exist_ok=True)


def remove_bg(img: Image.Image, tol: int = 26) -> Image.Image:
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    def is_bg(p):
        r, g, b, _ = p
        return r > 255 - tol and g > 255 - tol and b > 255 - tol and max(r, g, b) - min(r, g, b) < 18

    mask = Image.new("L", (w, h), 255)
    mp = mask.load()
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not is_bg(px[x, y]):
            continue
        mp[x, y] = 0
        if x > 0:
            q.append((x - 1, y))
        if x < w - 1:
            q.append((x + 1, y))
        if y > 0:
            q.append((x, y - 1))
        if y < h - 1:
            q.append((x, y + 1))

    # 轻微收缩 + 羽化，去掉白边锯齿
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    img.putalpha(mask)
    return img


def fit(img: Image.Image, max_side: int, pad: int = 6) -> Image.Image:
    bbox = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    img = img.crop(bbox)
    scale = max_side / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(img, (pad, pad), img)
    return canvas


def square(img: Image.Image, size: int) -> Image.Image:
    side = max(img.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    return canvas.resize((size, size), Image.LANCZOS)


names = [f[:-4] for f in os.listdir(SRC) if f.endswith(".png")]
for name in sys.argv[1:] or names:
    src = Image.open(os.path.join(SRC, name + ".png"))
    cut = remove_bg(src)
    out_name = RENAME.get(name, name)
    if name == "avatar":
        a = cut.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        head = cut.crop((a[0], a[1], a[2], a[1] + int((a[3] - a[1]) * 0.66)))
        head = fit(head, 256, pad=4)
        square(head, 128).save(os.path.join(DST, "avatar.png"), optimize=True)
        icon = square(head, 256)
        icon.save(os.path.join(BUILD, "icon.png"))
        icon.save(os.path.join(BUILD, "icon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        print("avatar -> avatar.png, build/icon.png, build/icon.ico")
        continue
    res = fit(cut, MAX)
    res.save(os.path.join(DST, out_name + ".png"), optimize=True)
    print(f"{name} -> {out_name}.png {res.size}")
