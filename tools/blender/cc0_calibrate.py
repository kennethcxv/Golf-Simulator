"""Bring a CC0 albedo onto the ART_BIBLE palette, and report whether it got there.

The problem this solves.  A downloaded albedo arrives with its own hue, its own
mean brightness and its own saturation.  Multiplying it by a palette tint does
NOT put the surface on palette — the renderer computes

    albedo_linear = baseColorFactor * texture_linear

so the shipped mean is the *product* of two colours, and a walnut tint over an
already-brown map lands somewhere darker and muddier than either.  That is how
`Spike/TEXTURE_VALIDATION.md` Arm F drifted off palette while every individual
value in it looked reasonable.

The fix is to make the map carry **variation** and the tint carry **hue**:

  1. Desaturate the map toward its own luminance, so it stops contributing hue.
  2. Rescale that luminance about its own mean so the grain contrast survives
     desaturation instead of going flat.
  3. Solve the tint arithmetically: tint = target_linear / mean(map_linear).
     Because the mean of a product is the product of the mean for a constant
     factor, this lands the shipped mean exactly on the palette value.
  4. Check it, rather than trusting it.

Run standalone (no Blender needed):

    python tools/blender/cc0_calibrate.py --report
    python tools/blender/cc0_calibrate.py --bake Wood051_1K-JPG_Color.jpg medium_walnut
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from palette import (  # noqa: E402
    ART_BIBLE_SRGB_HEX,
    hex_to_linear_rgba,
    linear_channel_to_srgb,
    srgb_channel_to_linear,
)

REPO = Path(__file__).resolve().parents[2]
CC0_DIR = REPO / "asset_sources" / "textures" / "cc0_spike"

# Rec. 709 luminance, the weighting three.js and Blender both use.
LUMA = (0.2126, 0.7152, 0.0722)


def _load_rgb(path: Path):
    """Return an (n, 3) float array of LINEAR values, and the image size."""
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - environment guard
        raise SystemExit(
            "Pillow is required for calibration measurement: python -m pip install pillow numpy"
        ) from exc
    import numpy as np

    with Image.open(path) as img:
        img = img.convert("RGB")
        size = img.size
        arr = np.asarray(img, dtype=np.float64) / 255.0
    # sRGB EOTF, vectorised
    lin = np.where(arr <= 0.04045, arr / 12.92, ((arr + 0.055) / 1.055) ** 2.4)
    return lin.reshape(-1, 3), size


def measure(path: Path) -> dict:
    """Mean, luminance contrast and saturation of a source albedo, in linear."""
    import numpy as np

    lin, size = _load_rgb(path)
    mean = lin.mean(axis=0)
    luma = lin @ np.array(LUMA)
    # Saturation as the mean per-pixel chroma spread, normalised by luminance.
    chroma = (lin.max(axis=1) - lin.min(axis=1)).mean()
    return {
        "file": path.name,
        "size": list(size),
        "meanLinear": [round(float(c), 6) for c in mean],
        "meanSrgbHex": "".join(f"{round(linear_channel_to_srgb(float(c)) * 255):02X}" for c in mean),
        "meanLuma": round(float(luma.mean()), 6),
        "lumaStd": round(float(luma.std()), 6),
        # contrast ratio the grain actually carries, p90/p10 of luminance
        "lumaP10": round(float(np.percentile(luma, 10)), 6),
        "lumaP90": round(float(np.percentile(luma, 90)), 6),
        "lumaP99": round(float(np.percentile(luma, 99)), 6),
        # Ratio contrast is what an exposure change preserves, so it is the number
        # to quote when claiming the grain survived calibration.
        "contrastP90overP10": round(
            float(np.percentile(luma, 90) / max(np.percentile(luma, 10), 1e-9)), 3
        ),
        "meanChroma": round(float(chroma), 6),
    }


CEILING = 0.95  # highest linear value the normalised map is allowed to reach


def exposure_gain(luma_p99: float, ceiling: float = CEILING) -> float:
    """Single multiplier that puts the map's p99 at `ceiling`.

    A constant multiply in LINEAR space is an exposure change: it preserves every
    ratio in the image exactly, so the grain contrast the source was chosen for
    survives untouched.  A gamma or curve adjustment would not.

    p99 rather than max, because one specular pixel should not set the exposure
    for the whole map; the 1 % above it clips, which for an albedo is invisible.
    """
    if luma_p99 <= 0:
        return 1.0
    return ceiling / luma_p99


def solve_tint(source_mean_luma: float, luma_p99: float, target_hex: str) -> dict:
    """The baseColorFactor that lands a normalised map's mean on the palette value.

    Because the mean of (constant x image) is constant x mean, solving
    tint = target / mean lands the SHIPPED mean exactly on the palette value.
    That is the whole trick — the tint is computed, never eyeballed.
    """
    target = hex_to_linear_rgba(target_hex)[:3]
    gain = exposure_gain(luma_p99)
    normalised_mean = source_mean_luma * gain
    tint = [t / normalised_mean for t in target]
    over = [c for c in tint if c > 1.0]
    return {
        "targetHex": target_hex,
        "targetLinear": [round(c, 6) for c in target],
        "sourceMeanLuma": round(source_mean_luma, 6),
        "exposureGain": round(gain, 4),
        "normalisedMeanLuma": round(normalised_mean, 6),
        "tintLinear": [round(c, 6) for c in tint],
        # glTF clamps baseColorFactor to [0,1]. A tint above 1 means even the
        # exposure-normalised map is too dark to reach the target by multiplication,
        # and the source has to be replaced rather than pushed.
        "reachable": not over,
        "note": (
            "UNREACHABLE: tint exceeds 1.0 even after exposure normalisation — this source "
            "cannot carry this palette value; pick a lighter source map"
            if over else "reachable"
        ),
    }


def predicted_shipped(tint, source_mean_luma: float) -> dict:
    """What the renderer will actually average to, given tint x desaturated map."""
    shipped = [t * source_mean_luma for t in tint]
    return {
        "shippedLinear": [round(c, 6) for c in shipped],
        "shippedHex": "".join(f"{round(linear_channel_to_srgb(c) * 255):02X}" for c in shipped),
    }


def deltaE_ish(a, b) -> float:
    """A blunt perceptual gap: euclidean distance in sRGB-encoded 0-255 space.

    Not CIEDE2000.  It is used only as an acceptance threshold and is honest about
    being coarse — the [V] side-by-side is the real gate.
    """
    ea = [linear_channel_to_srgb(c) * 255 for c in a]
    eb = [linear_channel_to_srgb(c) * 255 for c in b]
    return round(sum((x - y) ** 2 for x, y in zip(ea, eb)) ** 0.5, 2)


def report() -> dict:
    """Measure every CC0 albedo on disk and solve its palette tint."""
    # The three families asset_065 (stockroom worktable) is built from.
    plan = [
        ("Wood051_1K-JPG_Color.jpg", "medium_walnut", "worktop"),
        ("Wood062_1K-JPG_Color.jpg", "dark_walnut", "underframe / shelf"),
        ("Metal032_1K-JPG_Color.jpg", "black_powder_coat", "legs, brackets"),
    ]
    out = []
    for filename, palette_key, role in plan:
        path = CC0_DIR / filename
        if not path.exists():
            out.append({"file": filename, "error": "missing"})
            continue
        m = measure(path)
        target_hex = ART_BIBLE_SRGB_HEX[palette_key]
        solved = solve_tint(m["meanLuma"], m["lumaP99"], target_hex)
        shipped = predicted_shipped(solved["tintLinear"], solved["normalisedMeanLuma"])
        # What happens if you skip desaturation and tint the raw map's own colour
        # instead — this is the Arm F drift, quantified.
        naive_shipped = [
            t * c * solved["exposureGain"] for t, c in zip(solved["tintLinear"], m["meanLinear"])
        ]
        out.append({
            "role": role,
            "paletteKey": palette_key,
            **m,
            **solved,
            **shipped,
            "gapToTarget": deltaE_ish(shipped["shippedLinear"], solved["targetLinear"]),
            "naiveNoDesatLinear": [round(c, 6) for c in naive_shipped],
            "naiveNoDesatHex": "".join(
                f"{round(linear_channel_to_srgb(c) * 255):02X}" for c in naive_shipped
            ),
            "naiveGapToTarget": deltaE_ish(naive_shipped, solved["targetLinear"]),
        })
    return {"cc0Dir": str(CC0_DIR), "materials": out}


def bake(src: Path, dst: Path) -> dict:
    """Write the calibrated map: desaturated to luminance, then exposure-normalised.

    Both operations happen in LINEAR space and both are ratio-preserving, so the
    grain contrast the source was chosen for arrives intact.  What the map loses
    is its hue — which is the point, because hue is now the tint's job.
    """
    from PIL import Image
    import numpy as np

    lin, size = _load_rgb(src)
    luma = lin @ np.array(LUMA)
    gain = exposure_gain(float(np.percentile(luma, 99)))
    adj = np.clip(luma * gain, 0.0, 1.0)
    grey = np.repeat(adj[:, None], 3, axis=1)
    srgb = np.where(grey <= 0.0031308, grey * 12.92, 1.055 * grey ** (1 / 2.4) - 0.055)
    img = Image.fromarray(
        (np.clip(srgb, 0, 1) * 255).round().astype("uint8").reshape(size[1], size[0], 3)
    )
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, quality=95)
    after = luma * gain
    return {
        "src": str(src),
        "dst": str(dst),
        "exposureGain": round(float(gain), 4),
        "meanLumaBefore": round(float(luma.mean()), 6),
        "meanLumaAfter": round(float(np.clip(after, 0, 1).mean()), 6),
        "contrastBefore": round(
            float(np.percentile(luma, 90) / max(np.percentile(luma, 10), 1e-9)), 3
        ),
        "contrastAfter": round(
            float(np.percentile(after, 90) / max(np.percentile(after, 10), 1e-9)), 3
        ),
        "clippedFraction": round(float((luma * gain > 1.0).mean()), 5),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report", action="store_true", help="measure the CC0 sources and solve tints")
    ap.add_argument("--bake", nargs=2, metavar=("SRC", "DST"), help="write a calibrated map")
    args = ap.parse_args()

    if args.bake:
        print(json.dumps(bake(Path(args.bake[0]), Path(args.bake[1])), indent=2))
        return
    print(json.dumps(report(), indent=2))


if __name__ == "__main__":
    main()
