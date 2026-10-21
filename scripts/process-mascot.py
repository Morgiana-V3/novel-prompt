"""
把 assets-src/mascot/*.png 处理为透明底素材，输出到 src/renderer/src/assets/mascot/
- 从四周泛洪去掉白色背景（角色有描边，内部白色不会被误删）
- 身体被画面底边截断的图，底部做渐隐，避免生硬切边
- 按内容裁边，缩放到最长边 MAX
- avatar 额外裁出头部：生成侧栏 logo、应用图标（粉色圆角底）
"""
import os
import sys
from collections import deque

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "assets-src", "mascot")
DST = os.path.join(ROOT, "src", "renderer", "src", "assets", "mascot")
BUILD = os.path.join(ROOT, "build")
MAX = 460

os.makedirs(DST, exist_ok=True)
os.makedirs(BUILD, exist_ok=True)


def bg_mask(img: Image.Image, tol: int = 24) -> Image.Image:
    """返回前景 mask（255 = 角色）"""
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
        r, g, b = p[:3]
        return r > 255 - tol and g > 255 - tol and b > 255 - tol and max(r, g, b) - min(r, g, b) < 16

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
    return mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))


def cut_out(src: Image.Image) -> Image.Image:
    img = src.convert("RGBA")
    mask = bg_mask(img)
    w, h = img.size
    # 底边是否有前景像素（身体被截断）
    bottom = mask.crop((0, h - 3, w, h)).getextrema()[1]
    if bottom > 200:
        fade_h = int(h * 0.16)
        grad = Image.new("L", (1, fade_h))
        for y in range(fade_h):
            t = y / (fade_h - 1)
            grad.putpixel((0, y), int(255 * (1 - t) ** 1.6))
        grad = grad.resize((w, fade_h))
        region = mask.crop((0, h - fade_h, w, h))
        region = Image.composite(region, Image.new("L", region.size, 0), grad)
        mask.paste(region, (0, h - fade_h))
    img.putalpha(mask)
    return img


def bbox(img: Image.Image):
    return img.getchannel("A").point(lambda a: 255 if a > 10 else 0).getbbox()


def fit(img: Image.Image, max_side: int, pad: int = 6) -> Image.Image:
    img = img.crop(bbox(img))
    scale = max_side / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(img, (pad, pad), img)
    return canvas


def head_crop(img: Image.Image) -> Image.Image:
    """以头部为中心裁正方形：取前景顶部，宽度为前景宽度的 0.72"""
    l, t, r, b = bbox(img)
    w = r - l
    side = int(w * 0.72)
    cx = l + w // 2
    # 头部的水平中心：取顶部 40% 区域的前景中心，更准确
    top = img.getchannel("A").crop((l, t, r, t + int((b - t) * 0.4)))
    tb = top.point(lambda a: 255 if a > 10 else 0).getbbox()
    if tb:
        cx = l + (tb[0] + tb[2]) // 2
    x0 = max(0, cx - side // 2)
    return img.crop((x0, t, x0 + side, t + side))


def make_icon(head: Image.Image, size: int = 512) -> Image.Image:
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    r = int(size * 0.22)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=(255, 228, 238, 255))
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, outline=(255, 190, 212, 255), width=max(2, size // 128))
    inner = int(size * 0.94)
    h = head.resize((inner, inner), Image.LANCZOS)
    # 头像底部贴齐图标底边，顶部留一点呼吸
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.paste(h, ((size - inner) // 2, size - inner + int(size * 0.04)), h)
    clip = Image.new("L", (size, size), 0)
    ImageDraw.Draw(clip).rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=255)
    layer.putalpha(Image.composite(layer.getchannel("A"), Image.new("L", (size, size), 0), clip))
    return Image.alpha_composite(bg, layer)


names = [f[:-4] for f in os.listdir(SRC) if f.endswith(".png")]
for name in sys.argv[1:] or names:
    cut = cut_out(Image.open(os.path.join(SRC, name + ".png")))
    if name == "avatar":
        head = head_crop(cut)
        logo = Image.new("RGBA", head.size, (0, 0, 0, 0))
        logo.paste(head, (0, 0), head)
        logo.resize((160, 160), Image.LANCZOS).save(os.path.join(DST, "avatar.png"), optimize=True)
        icon = make_icon(head)
        icon.save(os.path.join(BUILD, "icon.png"))
        icon.save(os.path.join(BUILD, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        print("avatar -> avatar.png, build/icon.png, build/icon.ico")
        continue
    res = fit(cut, MAX)
    res.save(os.path.join(DST, name + ".png"), optimize=True)
    print(f"{name} -> {name}.png {res.size}")
