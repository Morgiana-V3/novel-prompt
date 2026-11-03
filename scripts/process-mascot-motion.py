"""
把吉祥物场景动图处理为应用内素材。

输入目录需包含每个场景的 <name>-512.webp（透明循环动图）与 <name>-poster.png（同画布 512 静态原图）。
输出：
  src/renderer/src/assets/mascot/motion/<name>.webp  裁切后的动图，保留全部帧（高 DPI 下 240px 显示仍清晰）
  src/renderer/src/assets/mascot/<name>.png          与动图同一裁切范围的静态图（动图播完或低动态偏好时显示）

裁切范围取动图所有帧不透明像素的并集，静态图按相同比例裁切，切换时角色位置不跳动。

用法：python scripts/process-mascot-motion.py <输入目录> [名称 ...]
"""

import sys
from pathlib import Path

from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src" / "renderer" / "src" / "assets" / "mascot"
NAMES = ["ready", "reading", "search", "paint"]
ALPHA_THRESHOLD = 8
PADDING_PX = 4
STILL_HEIGHT_PX = 472
QUALITY = 90


def union_box(frames):
    box = None
    for frame in frames:
        alpha = frame.getchannel("A").point(lambda value: 255 if value > ALPHA_THRESHOLD else 0)
        frame_box = alpha.getbbox()
        if not frame_box:
            continue
        if box is None:
            box = list(frame_box)
        else:
            box = [
                min(box[0], frame_box[0]),
                min(box[1], frame_box[1]),
                max(box[2], frame_box[2]),
                max(box[3], frame_box[3]),
            ]
    width, height = frames[0].size
    return (
        max(0, box[0] - PADDING_PX),
        max(0, box[1] - PADDING_PX),
        min(width, box[2] + PADDING_PX),
        min(height, box[3] + PADDING_PX),
    )


def process(source_dir: Path, name: str) -> None:
    animation = Image.open(source_dir / f"{name}-512.webp")
    frames = [frame.convert("RGBA").copy() for frame in ImageSequence.Iterator(animation)]
    durations = [frame.info.get("duration", 42) for frame in ImageSequence.Iterator(animation)]
    box = union_box(frames)

    kept = [frame.crop(box) for frame in frames]
    kept_durations = durations
    motion_dir = ASSETS / "motion"
    motion_dir.mkdir(parents=True, exist_ok=True)
    kept[0].save(
        motion_dir / f"{name}.webp",
        save_all=True,
        append_images=kept[1:],
        duration=kept_durations,
        loop=0,
        quality=QUALITY,
        method=4,
    )

    poster = Image.open(source_dir / f"{name}-poster.png").convert("RGBA")
    scale = poster.width / frames[0].width
    poster_box = tuple(round(value * scale) for value in box)
    still = poster.crop(poster_box)
    still = still.resize(
        (round(still.width * STILL_HEIGHT_PX / still.height), STILL_HEIGHT_PX),
        Image.LANCZOS,
    )
    still.save(ASSETS / f"{name}.png", optimize=True)
    total_ms = sum(durations)
    print(f"{name}: crop {box}, {len(kept)} frames, {total_ms} ms")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    source_dir = Path(sys.argv[1])
    for name in sys.argv[2:] or NAMES:
        process(source_dir, name)


if __name__ == "__main__":
    main()
