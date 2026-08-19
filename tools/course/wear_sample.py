"""Sample the three tones of a wear scar off the reference photographs.

The brief's two readings are that worn ground near paving is LIGHTER than the
turf -- a pale desaturated grey-cream near the paving's value, not darker -- and
that wear is two-toned: a broad straw-blond halo of dying grass with a narrow
darker compacted core through it.  The shipping shader disagrees with both: it
mixes one flat vec3(0.40, 0.35, 0.18), which is a dark brown, at a single
threshold.

So rather than invent three replacement colours, this reads them off the six
tracked photographs in Designs/Course/Ground/wear.  Each pixel is sorted into
one of three populations by hue and value:

  turf     green-dominant -- G clearly above R and B
  dry      warm and light but still tinted -- the straw halo
  core     desaturated and light -- the compacted tread

The populations are found per image and reported per image, because a mean over
six photographs taken in six lightings is a number about nothing.  What the
authoring wants is the RATIO between the three within one frame, which survives
the exposure difference that the absolute values do not.

    python tools/course/wear_sample.py
"""
import json
import os

import numpy as np
from PIL import Image

REF = os.path.join("Designs", "Course", "Ground", "wear")


def _srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _luma(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def classify(path, side=900):
    im = Image.open(path).convert("RGB")
    im.thumbnail((side, side))
    a = np.asarray(im, dtype=np.float64) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    val = _luma(a)

    # Sky and deep shadow are not ground and would drag every population.
    ground = (val > 0.06) & (val < 0.96) & ~((b > r + 0.06) & (b > g + 0.04))

    green = ground & (g > r + 0.035) & (g > b + 0.045)
    # Everything else on the ground is some flavour of worn.  The split between
    # the straw halo and the compacted core is SATURATION, not brightness: the
    # halo is dying grass and keeps a yellow tint, the tread is mineral soil
    # polished by feet and has almost none.
    worn = ground & ~green
    if worn.sum() < 500:
        return None
    s_worn = sat[worn]
    cut = float(np.quantile(s_worn, 0.45))
    dry = worn & (sat > cut)
    core = worn & (sat <= cut)

    def mean(mask):
        if mask.sum() < 200:
            return None
        return [round(float(x), 4) for x in a[mask].mean(axis=0)]

    def lin(mask):
        if mask.sum() < 200:
            return None
        return [round(float(x), 5) for x in _srgb_to_linear(a[mask]).mean(axis=0)]

    out = {
        "pixels": int(ground.sum()),
        "turf": mean(green), "dry": mean(dry), "core": mean(core),
        "turf_linear": lin(green), "dry_linear": lin(dry), "core_linear": lin(core),
        "turf_share": round(float(green.sum() / max(1, ground.sum())), 3),
        "sat_cut": round(cut, 4),
    }
    for k in ("turf", "dry", "core"):
        v = out[k]
        out[f"{k}_luma"] = round(float(_luma(np.array(v))), 4) if v else None
    return out


def main():
    rows = {}
    for name in sorted(os.listdir(REF)):
        if not name.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        r = classify(os.path.join(REF, name))
        if r:
            rows[name] = r

    print(f"{'image':26} {'turf':>8} {'dry':>8} {'core':>8}   dry/turf  core/turf")
    ratios = []
    for name, r in rows.items():
        t, d, c = r["turf_luma"], r["dry_luma"], r["core_luma"]
        if not (t and d and c):
            continue
        ratios.append((d / t, c / t))
        print(f"{name:26} {t:8.4f} {d:8.4f} {c:8.4f}   {d / t:8.2f}  {c / t:9.2f}")

    if ratios:
        dr = np.median([x[0] for x in ratios])
        cr = np.median([x[1] for x in ratios])
        print(f"\nMEDIAN across {len(ratios)} photographs:")
        print(f"  the dry halo is  {dr:.2f}x the turf's luma")
        print(f"  the compacted core is {cr:.2f}x the turf's luma")
        print(f"  and the core is {cr / dr:.2f}x the halo — "
              f"{'darker' if cr < dr else 'LIGHTER'} than the halo, as the brief says"
              if cr < dr else
              f"  and the core is {cr / dr:.2f}x the halo — LIGHTER, which contradicts the brief")
        rows["_median"] = {"dry_over_turf": round(float(dr), 3),
                           "core_over_turf": round(float(cr), 3)}

    with open(os.path.join(REF, "sampled.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1)
    print(f"\nwrote {os.path.join(REF, 'sampled.json')}")


if __name__ == "__main__":
    main()
