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
from PIL import Image, ImageDraw, ImageFilter

BIBLE = Path(__file__).resolve().parent / "bible"
SHOTS = ["1-three-quarter", "2-front-elevation", "3-floor-contact"]

ARM_LABEL = {
    "A": "A  untextured control",
    "F": "F  raw CC0 albedo, tint dropped on export",
    "G": "G  512 + KTX2",
    "H": "H  512 uncompressed",
    "I": "I  calibrated albedo + solved baseColorFactor",
}


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


# Regions of pure surface — no props, no edges, no background — for measuring how much
# variation a surface actually carries. Saved by --surface so the boxes can be checked
# rather than trusted; a region that clips a prop reports that prop's contrast as grain.
SURFACE_REGIONS = {
    "worktop": ("4-worktop-elevation", (668, 537, 998, 596)),
    "counter-top": ("5-counter-elevation", (262, 452, 392, 496)),
    "leg": ("4-worktop-elevation", (1100, 665, 1128, 815)),
}

# §8 medium walnut — the value the worktop and the counter run are both supposed to be.
MEDIUM_WALNUT = (0x6B, 0x4A, 0x2F)


def surface_stats(arm: str, region: str) -> dict:
    """How much variation a flat surface carries, separated from how it is lit.

    Two numbers, and the second is the one that matters:

    `spread` is the total p90-p10 of luminance across the region. It is dominated by the
    lighting gradient falling across the surface, so an untextured surface scores high on
    it — which makes it useless for "does this carry grain".

    `detail` is the standard deviation of the region AFTER subtracting a Gaussian blur of
    it. The blur keeps the lighting gradient and discards the grain, so the residual is
    the grain alone. An untextured surface scores near zero on it by construction.

    Both are measured in sRGB code values rather than linear, because the question is what
    a player can see. That distinction carries the result: a constant multiply in linear
    space preserves contrast ratio exactly, but the sRGB curve is compressive at the
    bottom, so the same ratio at a brighter mean spans more visible code values. Measured
    in linear, calibration would look like it changed nothing.
    """
    shot, box = SURFACE_REGIONS[region]
    path = BIBLE / f"arm{arm}" / f"{shot}.png"
    if not path.exists():
        raise SystemExit(f"missing {path}")
    img = Image.open(path).convert("RGB").crop(box)
    crop = np.asarray(img, dtype=np.float64)
    luma = crop @ np.array([0.2126, 0.7152, 0.0722])

    blurred = np.asarray(
        img.filter(ImageFilter.GaussianBlur(radius=6)), dtype=np.float64,
    ) @ np.array([0.2126, 0.7152, 0.0722])

    mean = crop.reshape(-1, 3).mean(axis=0)
    gap = float(np.linalg.norm(mean - np.array(MEDIUM_WALNUT, dtype=np.float64)))
    return {
        "arm": arm,
        "region": region,
        "meanHex": "".join(f"{int(round(c)):02X}" for c in mean),
        "gapToMediumWalnut": round(gap, 1),
        "meanLuma": round(float(luma.mean()), 1),
        "spread": round(float(np.percentile(luma, 90) - np.percentile(luma, 10)), 1),
        "detail": round(float((luma - blurred).std()), 2),
    }


def _band(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, text: str, height: int = 26) -> None:
    draw.rectangle([x, y, x + w, y + height], fill=(16, 16, 16))
    draw.text((x + 10, y + 7), text, fill=(235, 235, 235))


def palette_plate(arms: list[str], out: Path) -> None:
    """The §7.4.1 [V] plate: worktop beside counter run, one row per arm.

    One literal frame is impossible — a solid partition stands between the stockroom and
    the shop floor, measured by `tools/qa/proshop-counter-worktop-sightline.js`. So the
    two subjects are photographed with a matched camera (identical 1.6 yd standoff, eye
    height, lens; pitch differs only by the two surfaces' own heights) and placed side by
    side. The substitution is printed on the plate, not hidden in a document.

    Left column is the calibrated subject. Right column is the reception counter, which is
    textured but NOT calibrated this way — it is the production the worktable has to match.
    """
    rows = []
    for arm in arms:
        left = BIBLE / f"arm{arm}" / "4-worktop-elevation.png"
        right = BIBLE / f"arm{arm}" / "5-counter-elevation.png"
        if not left.exists() or not right.exists():
            continue
        rows.append((arm, Image.open(left).convert("RGB"), Image.open(right).convert("RGB")))
    if not rows:
        raise SystemExit("no arm has both 4-worktop-elevation and 5-counter-elevation")

    # Half scale: two 1600x900 frames side by side is 3200 px wide, which nobody views
    # at 1:1. The crops carry the detail; this plate carries the overall read.
    scale = 0.5
    cw = int(rows[0][1].width * scale)
    chh = int(rows[0][1].height * scale)
    gap, band, top = 6, 26, 30
    width = cw * 2 + gap
    height = top + len(rows) * (band + chh + gap)
    canvas = Image.new("RGB", (width, height), (20, 20, 20))
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 8), "left: asset_065 worktop     right: reception counter run (textured, NOT calibrated)"
                      "     matched camera: 1.6 yd standoff, same eye height, same lens",
              fill=(200, 200, 200))

    y = top
    for arm, left, right in rows:
        _band(draw, 0, y, width, f"arm {ARM_LABEL.get(arm, arm)}", band)
        y += band
        canvas.paste(left.resize((cw, chh), Image.LANCZOS), (0, y))
        canvas.paste(right.resize((cw, chh), Image.LANCZOS), (cw + gap, y))
        y += chh + gap

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)


def main() -> None:
    argv = sys.argv[1:]
    if argv and argv[0] == "--surface":
        arms = argv[1:] or ["A", "F", "I"]
        head = f"{'region':<14}{'arm':<4}{'meanHex':>9}{'gapMW':>8}{'meanLuma':>10}{'spread':>8}{'detail':>8}"
        print(head)
        print("-" * len(head))
        for region in SURFACE_REGIONS:
            for arm in arms:
                r = surface_stats(arm, region)
                print(f"{r['region']:<14}{r['arm']:<4}{r['meanHex']:>9}"
                      f"{r['gapToMediumWalnut']:>8}{r['meanLuma']:>10}"
                      f"{r['spread']:>8}{r['detail']:>8}")
            print()
        # Save the sampled regions so the boxes can be checked, not trusted.
        out = BIBLE / "compare" / "surface-regions.png"
        rows = []
        for region, (shot, box) in SURFACE_REGIONS.items():
            for arm in arms:
                rows.append(Image.open(BIBLE / f"arm{arm}" / f"{shot}.png").convert("RGB").crop(box))
        w = max(r.width for r in rows)
        h = sum(r.height for r in rows) + 2 * (len(rows) - 1)
        canvas = Image.new("RGB", (w, h), (20, 20, 20))
        y = 0
        for r in rows:
            canvas.paste(r, (0, y))
            y += r.height + 2
        out.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out)
        print(f"wrote {out.relative_to(BIBLE.parents[2])}")
        return

    arms = argv or ["F", "H", "G"]
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
    tag = "palette" if set(arms) >= {"A", "I"} else "pipeline"
    for shot in SHOTS:
        out = BIBLE / "compare" / f"{tag}-{shot}.png"
        side_by_side(arms, shot, out)
        print(f"wrote {out.relative_to(BIBLE.parents[2])}")

    if (BIBLE / f"arm{arms[0]}" / "4-worktop-elevation.png").exists():
        out = BIBLE / "compare" / "palette-calibration-worktop.png"
        palette_plate(arms, out)
        print(f"wrote {out.relative_to(BIBLE.parents[2])}")


if __name__ == "__main__":
    main()
