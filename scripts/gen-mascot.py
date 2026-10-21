"""
用 NovelAI 生成吉祥物（猫娘）各表情立绘。
用法：  $env:NAI_KEY="pst-..."; python scripts/gen-mascot.py [名称...]
输出：  assets-src/mascot/<name>.png（原图）
"""
import io
import json
import os
import sys
import time
import urllib.request
import zipfile

KEY = os.environ.get("NAI_KEY")
if not KEY:
    sys.exit("请先设置环境变量 NAI_KEY")

OUT = os.path.join(os.path.dirname(__file__), "..", "assets-src", "mascot")
os.makedirs(OUT, exist_ok=True)

SEED = int(os.environ.get("NAI_SEED", "1314520"))
SUFFIX = os.environ.get("NAI_SUFFIX", "")
# 画风：普通头身（非 Q 版）、彩色描边、扁平上色、极少阴影，类似 VTuber 官方立绘 / 动画截图
BASE = (
    "1girl, solo, cat girl, cat ears, animal ear fluff, cat tail, white hair, medium hair, bob cut, "
    "pink hair tips, gradient hair, ahoge, pink eyes, sparkling eyes, star-shaped pupils, fang, blush stickers, "
    "white hoodie, oversized hoodie, hood down, paw print, pink drawstrings, sleeves past wrists, "
    "pink skirt, pleated skirt, white socks, pink footwear, tail ribbon, pink ribbon, "
    "white background, simple background, "
    "flat color, colored lineart, thick outline, no shading, soft colors, anime coloring, official art, "
    "very aesthetic, masterpiece, no text"
)
UC = (
    "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, "
    "chromatic aberration, multiple views, logo, too many watermarks, signature, text, watermark, "
    "chibi, super deformed, mini person, big head, "
    "shadow, drop shadow, gradient background, heavy shading, realistic, 3d, "
    "nsfw, animal, furry, cat, extra ears"
)

POSES = {
    "idle": "full body, standing, smile, open mouth, waving, looking at viewer, holding paintbrush",
    "happy": "cowboy shot, arms up, closed eyes, ^_^, open mouth, happy, sparkle, jumping",
    "busy": "upper body, holding paintbrush, holding sketchbook, drawing, focused, looking down, sweatdrop",
    "confused": "cowboy shot, head tilt, question mark, confused, index finger raised, finger to cheek, :o",
    "chill": "upper body, closed eyes, smile, :3, hugging own tail, holding own tail, relaxed",
    "wink": "upper body, one eye closed, v, smile, open mouth, looking at viewer",
    "avatar": "portrait, face focus, smile, open mouth, looking at viewer, clenched hands, hands up",
}

SEEDS: dict[str, int] = {}


def generate(name: str, pose: str) -> None:
    prompt = f"{BASE}, {pose}"
    seed = SEEDS.get(name, SEED)
    body = {
        "input": prompt,
        "model": "nai-diffusion-4-5-full",
        "action": "generate",
        "parameters": {
            "params_version": 3,
            "width": 1024,
            "height": 1024,
            "scale": 5.5,
            "sampler": "k_euler_ancestral",
            "steps": 28,
            "n_samples": 1,
            "seed": seed,
            "ucPreset": 0,
            "qualityToggle": False,
            "noise_schedule": "karras",
            "cfg_rescale": 0,
            "negative_prompt": UC,
            "v4_prompt": {
                "caption": {"base_caption": prompt, "char_captions": []},
                "use_coords": False,
                "use_order": True,
            },
            "v4_negative_prompt": {"caption": {"base_caption": UC, "char_captions": []}, "legacy_uc": False},
        },
    }
    req = urllib.request.Request(
        "https://image.novelai.net/ai/generate-image",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
            "Origin": "https://novelai.net",
            "Referer": "https://novelai.net/",
        },
        method="POST",
    )
    data = None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=180) as res:
                data = res.read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 5:
                time.sleep(4 + attempt * 3)
                continue
            print(f"[{name}] HTTP {e.code}: {e.read()[:500]!r}")
            return
    if data is None:
        return
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        png = z.read(z.namelist()[0])
    path = os.path.join(OUT, f"{name}{SUFFIX}.png")
    with open(path, "wb") as f:
        f.write(png)
    print(f"[{name}] saved {path} ({len(png)} bytes)")


names = sys.argv[1:] or list(POSES)
for n in names:
    generate(n, POSES[n])
    time.sleep(1.5)
