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

def read_app_token() -> str | None:
    """没设 NAI_KEY 时，读取应用设置里保存的 Token"""
    path = os.path.join(os.environ.get("APPDATA", ""), "novel-prompt", "data", "settings.json")
    try:
        with open(path, encoding="utf-8") as f:
            return (json.load(f).get("naiToken") or "").strip() or None
    except (OSError, ValueError):
        return None


KEY = os.environ.get("NAI_KEY") or read_app_token()
if not KEY:
    sys.exit("请先设置环境变量 NAI_KEY，或在应用「设置 / 数据」里填写 NovelAI Token")

OUT = os.path.join(os.path.dirname(__file__), "..", "assets-src", "mascot")
os.makedirs(OUT, exist_ok=True)

SEED = int(os.environ.get("NAI_SEED", "1314520"))
SUFFIX = os.environ.get("NAI_SUFFIX", "")
# 步数超过 28 会消耗 Anlas，换来更细致的线条和上色
STEPS = int(os.environ.get("NAI_STEPS", "28"))
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
    # 以下为各页面专属状态，避免同一张图在多处重复出现
    "reading": "upper body, holding book, open book, reading, looking down, concentrating, closed mouth",
    "think": "upper body, thinking, hand on own chin, looking up, pout, thought bubble",
    "paint": "cowboy shot, holding paintbrush, holding palette, painting (action), easel, canvas (object), paint on face, smile, open mouth",
    "oops": "upper body, flustered, panicking, wavy mouth, sweatdrop, flying sweatdrops, hands up, open mouth, nervous",
    "sleep": "upper body, yawning, sleepy, closed eyes, rubbing eyes, tears, hugging pillow, pillow, zzz, nightcap",
    "search": "upper body, holding magnifying glass, looking through magnifying glass, curious, smile, open mouth, leaning forward",
    "shrug": "upper body, shrugging, palms up, closed eyes, wavy mouth, sweatdrop",
    "point": "cowboy shot, pointing to the side, smile, open mouth, looking at viewer, hand on own hip",
    "key": "upper body, holding key, oversized object, key, smile, open mouth, looking at viewer",
    "thumbs": "upper body, thumbs up, grin, closed eyes, happy, sparkle",
    "ok": "upper body, ok sign, smile, open mouth, looking at viewer, hand up",
    "check": "upper body, holding clipboard, holding pen, checklist, smile, looking at viewer",
    "crystal": "upper body, holding crystal ball, crystal ball, glowing, sparkle, smile, looking at viewer",
}

# 闭眼的姿势要去掉基础提示词里强制睁眼的星星瞳孔，并在 UC 里排除睁眼
OMIT: dict[str, list[str]] = {
    "sleep": ["sparkling eyes", "star-shaped pupils"],
}
EXTRA_UC: dict[str, str] = {
    "sleep": "open eyes, looking at viewer",
}

SEEDS: dict[str, int] = {"sleep": 20261023}


def generate(name: str, pose: str) -> None:
    base = ", ".join(t for t in BASE.split(", ") if t not in OMIT.get(name, []))
    prompt = f"{base}, {pose}"
    uc = f"{UC}, {EXTRA_UC[name]}" if name in EXTRA_UC else UC
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
            "steps": STEPS,
            "n_samples": 1,
            "seed": seed,
            "ucPreset": 0,
            "qualityToggle": False,
            "noise_schedule": "karras",
            "cfg_rescale": 0,
            "negative_prompt": uc,
            "v4_prompt": {
                "caption": {"base_caption": prompt, "char_captions": []},
                "use_coords": False,
                "use_order": True,
            },
            "v4_negative_prompt": {"caption": {"base_caption": uc, "char_captions": []}, "legacy_uc": False},
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
