"""Pixel comparison between texture-pipeline arms on the same fixed camera.

The arms differ only in how asset_065's textures are stored, so any difference is
attributable to the pipeline — that is the whole point of shooting them from the
poses in `tools/qa/spike-bible-arm.js`, which pins the camera, hides customers,
forces the doors closed and asserts the FOV.

Reported per pair:
  meanAbs   mean absolute per-channel difference, 0-255
  p99       99th percentile difference — where the worst real error sits
  pctOver2  share of pixels differing by more than 2/255 on any channel, which is
            roughly the threshold below which a difference is not visible on a
            calibrated display at normal viewing distance
  maxAbs    worst single channel anywhere, including the 1 % the p99 excludes

Usage: python Designs/ProShop/Spike/compare_arms.py F H G
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

BIBLE = Path(__file__).resolve().parent / "bible"
SHOTS = ["1-three-quarter", "2-front-elevation", "3-floor-contact"]


def load(arm: str, shot: str) -> np.ndarray:
    path = BIBLE / f"arm{arm}" / f"{shot}.png"
    if not path.exists():
        raise SystemExit(f"missing {path}")
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)


def compare(a_arm: str, b_arm: str, shot: str) -> dict:
    a = load(a_arm, shot)
    b = load(b_arm, shot)
    if a.shape != b.shape:
        raise SystemExit(f"shape mismatch {a.shape} vs {b.shape}")
    diff = np.abs(a - b)
    per_pixel_max = diff.max(axis=2)
    return {
        "shot": shot,
        "meanAbs": round(float(diff.mean()), 3),
        "p99": round(float(np.percentile(diff, 99)), 2),
        "maxAbs": int(diff.max()),
        "pctOver2": round(float((per_pixel_max > 2).mean() * 100), 2),
        "pctOver8": round(float((per_pixel_max > 8).mean() * 100), 2),
    }


def side_by_side(arms: list[str], shot: str, out: Path) -> None:
    """Stack the arms vertically with a 4 px rule, so a reviewer sees one image."""
    imgs = [Image.open(BIBLE / f"arm{a}" / f"{shot}.png").convert("RGB") for a in arms]
    w = max(i.width for i in imgs)
    gap = 4
    h = sum(i.height for i in imgs) + gap * (len(imgs) - 1)
    canvas = Image.new("RGB", (w, h), (20, 20, 20))
    y = 0
    for img in imgs:
        canvas.paste(img, (0, y))
        y += img.height + gap
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)


def main() -> None:
    arms = sys.argv[1:] or ["F", "H", "G"]
    print(f"arms: {' '.join(arms)}\n")
    header = f"{'pair':<10} {'shot':<20} {'meanAbs':>8} {'p99':>7} {'maxAbs':>7} {'%>2':>7} {'%>8':>7}"
    print(header)
    print("-" * len(header))
    for i in range(len(arms) - 1):
        for j in range(i + 1, len(arms)):
            for shot in SHOTS:
                r = compare(arms[i], arms[j], shot)
                print(
                    f"{arms[i]}vs{arms[j]:<7} {r['shot']:<20} {r['meanAbs']:>8} "
                    f"{r['p99']:>7} {r['maxAbs']:>7} {r['pctOver2']:>7} {r['pctOver8']:>7}"
                )
            print()
    for shot in SHOTS:
        out = BIBLE / "compare" / f"pipeline-{shot}.png"
        side_by_side(arms, shot, out)
        print(f"wrote {out.relative_to(BIBLE.parents[2])}")


if __name__ == "__main__":
    main()
