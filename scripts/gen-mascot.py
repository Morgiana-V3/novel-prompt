"""
用 NovelAI 生成吉祥物（猫娘）各表情立绘。
用法：  $env:NAI_KEY="pst-..."; python scripts/gen-mascot.py [名称...]
输出：  assets-src/mascot/<name>.png（原图）
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

KEY = os.environ.get("NAI_KEY")
if not KEY:
    sys.exit("请先设置环境变量 NAI_KEY")

OUT = os.path.join(os.path.dirname(__file__), "..", "assets-src", "mascot")
os.makedirs(OUT, exist_ok=True)

SEED = 1314520
BASE = (
    "1girl, solo, chibi, cat girl, cat ears, animal ear fluff, cat tail, white hair, short hair, bob cut, "
    "pink hair tips, multicolored hair, pink eyes, sparkling eyes, fang, blush stickers, "
    "white hoodie, oversized hoodie, hood down, paw print, pink drawstrings, pink skirt, pleated skirt, "
    "white socks, pink footwear, tail ribbon, pink ribbon, "
    "full body, white background, simple background, flat color, thick outline, cel shading, "
    "very aesthetic, masterpiece, no text"
)
UC = (
    "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, "
    "chromatic aberration, multiple views, logo, too many watermarks, signature, text, watermark, "
    "shadow, gradient background, nsfw, realistic, animal, furry, cat, extra ears"
)

POSES = {
    "idle": "standing, smile, open mouth, waving, looking at viewer, holding paintbrush",
    "happy": "jumping, arms up, closed eyes, ^_^, open mouth, happy, sparkle, motion lines",
    "busy": "sitting, drawing, holding paintbrush, holding sketchbook, focused, looking down, sweatdrop",
    "confused": "standing, head tilt, question mark, confused, finger to cheek, :o",
    "sleep": "sitting, sleeping, closed eyes, eyes closed, zzz, hugging own tail, peaceful, :3, nose bubble",
    "wink": "upper body, one eye closed, v, smile, looking at viewer, close-up, portrait",
    "avatar": "portrait, face focus, head only, smile, open mouth, looking at viewer, close-up",
}

SEEDS = {"sleep": 20260521}


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
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            data = res.read()
    except urllib.error.HTTPError as e:
        print(f"[{name}] HTTP {e.code}: {e.read()[:500]!r}")
        return
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        png = z.read(z.namelist()[0])
    path = os.path.join(OUT, f"{name}.png")
    with open(path, "wb") as f:
        f.write(png)
    print(f"[{name}] saved {path} ({len(png)} bytes)")


names = sys.argv[1:] or list(POSES)
for n in names:
    generate(n, POSES[n])
