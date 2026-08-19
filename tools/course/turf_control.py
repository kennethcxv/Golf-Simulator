"""LOOK AT THE TILES, then measure them, then prove the measurement can fail.

v7's tile control caught three faults and twice it was the PICTURE, not the
number: an oak with anisotropy 1.02 (a square lattice is isotropic, so there was
no grain in the grain), contour bands that closed into loops and rendered as
leopard print, and an 18 mm spray tooth that made a painted crown look pitted.
Every one of those passed a threshold before it was seen.

So this writes a contact sheet to be LOOKED AT, and then reports four numbers
per surface with a stated failing condition for each:

  aniso     std across the lay / std along it. turf_close must be DIRECTIONAL
            (the mow pattern is the lay of the blades and the shader rotates
            this tile into the flow field); turf_rough must NOT be, because
            nothing has rolled uncut grass into a direction.
  seam      the wrap step over the interior step. Anything above ~1.5 prints a
            visible grid across the whole hole, forever.
  relief    std of the normal's xy. A tile whose normal is flat is a colour
            field with extra steps, which is the fault being fixed.
  chroma    mean distance from the tile's own mean colour, in sRGB. Zero is a
            flat paint chip. This is the number that says the surface has
            colour VARIATION and not merely a colour.

  python tools/course/turf_control.py            # measure + contact sheet
  python tools/course/turf_control.py --control  # prove the checks can fail
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import turf as T  # noqa: E402

SHEET = os.path.join("qa", "course", "ground_tiles.png")

# Each surface's stated requirement. A check without a direction is not a check.
# Each surface says which BAND carries its direction, and how much. "fine" is
# the adjacent-texel ratio (blades, tooth); "coarse" is the same ratio after a
# ~20 mm blur (a rake swell, a mower's roller pass).
WANT = {
    "turf_close": dict(band="fine",   lo=2.2,  hi=None, why="the lay of a mown blade"),
    "turf_rough": dict(band="fine",   lo=None, hi=1.9,  why="uncut grass has no lay"),
    "sand":       dict(band="coarse", lo=1.5,  hi=None, why="the rake swell is the only direction in a bunker"),
    "hard":       dict(band="fine",   lo=None, hi=2.4,  why="a broom tooth, not brushed metal"),
}
SEAM_MAX = 1.6
RELIEF_MIN = 0.012
CHROMA_MIN = 0.012


def _aniso_at(h):
    """Step across v against step across u. A field streaked along u varies fast
    in v and slowly in u, so the ratio is > 1."""
    du = np.abs(np.roll(h, -1, axis=1) - h).std()
    dv = np.abs(np.roll(h, -1, axis=0) - h).std()
    return float(dv / max(du, 1e-9))


def measure(m):
    h = m["h"]
    # ANISOTROPY AT TWO BANDS, because an adjacent-texel ratio only sees the
    # HIGHEST frequency in the tile, and the direction does not always live
    # there. Sand measured 1.05 and read as "no rake in the bunker" -- but a
    # bunker's grain genuinely is isotropic, and the 95 mm rake swell that
    # carries all of the direction contributes almost nothing to an
    # adjacent-texel difference. The tile was right and the instrument was
    # asking the wrong question, which is the same shape as every
    # feature-smaller-than-its-sampling fault on record.
    fine = _aniso_at(h)
    coarse = _aniso_at(T._blur(h, h.shape[0] / 48.0))
    aniso = fine

    # SEAM. The step across the wrap against the median interior step, on both
    # axes. Exact periodicity by construction is the claim; this is the check.
    def seam(axis):
        if axis == 0:
            wrap = np.abs(h[0, :] - h[-1, :]).mean()
            inner = np.abs(np.diff(h, axis=0)).mean()
        else:
            wrap = np.abs(h[:, 0] - h[:, -1]).mean()
            inner = np.abs(np.diff(h, axis=1)).mean()
        return float(wrap / max(inner, 1e-9))

    relief = float(np.sqrt(m["nx"].std() ** 2 + m["ny"].std() ** 2))
    alb = m["albedo"]
    chroma = float(np.abs(alb - alb.reshape(-1, 3).mean(axis=0)).mean())
    return dict(aniso=aniso, fine=fine, coarse=coarse, seamV=seam(0), seamU=seam(1), relief=relief,
                chroma=chroma, rough_lo=float(m["rough"].min()),
                rough_hi=float(m["rough"].max()), ao_lo=float(m["ao"].min()))


def verdict(name, s):
    bad = []
    w = WANT[name]
    v = s[w["band"]]
    if w["lo"] is not None and v < w["lo"]:
        bad.append(f"NOT DIRECTIONAL ({w['band']} {v:.2f} < {w['lo']}) -- {w['why']}")
    if w["hi"] is not None and v > w["hi"]:
        bad.append(f"TOO DIRECTIONAL ({w['band']} {v:.2f} > {w['hi']}) -- {w['why']}")
    if max(s["seamU"], s["seamV"]) > SEAM_MAX:
        bad.append(f"SEAM (u {s['seamU']:.2f}, v {s['seamV']:.2f})")
    if s["relief"] < RELIEF_MIN:
        bad.append(f"FLAT (normal xy sd {s['relief']:.4f})")
    if s["chroma"] < CHROMA_MIN:
        bad.append(f"NO COLOUR VARIATION (chroma {s['chroma']:.4f}) -- a paint chip")
    return bad


def sheet(rows):
    """A contact sheet: for each surface, albedo | normal | roughness | occlusion.
    Written to be looked at. The numbers above have all been passed by a tile
    that was visibly wrong."""
    from PIL import Image
    px = T.PX
    W, H = px * 4, px * len(rows)
    img = Image.new("RGB", (W, H))
    for r, (name, m) in enumerate(rows):
        alb = (np.clip(m["albedo"], 0, 1) * 255).astype(np.uint8)
        nrm = np.stack([m["nx"] * 0.5 + 0.5, m["ny"] * 0.5 + 0.5, np.full_like(m["nx"], 1.0)], -1)
        nrm = (np.clip(nrm, 0, 1) * 255).astype(np.uint8)
        rgh = (np.clip(np.repeat(m["rough"][..., None], 3, 2), 0, 1) * 255).astype(np.uint8)
        occ = (np.clip(np.repeat(m["ao"][..., None], 3, 2), 0, 1) * 255).astype(np.uint8)
        for c, arr in enumerate([alb, nrm, rgh, occ]):
            img.paste(Image.fromarray(arr, "RGB"), (c * px, r * px))
    os.makedirs(os.path.dirname(SHEET), exist_ok=True)
    img.save(SHEET)
    return SHEET


def control():
    """NEGATIVE CONTROL. Feed the checks the three shapes that have shipped
    before and watch each one be named."""
    # AT THE PRODUCTION RESOLUTION. The first cut ran the control at 128 px to
    # be quick, and the real turf_close tile FAILED its own directionality check
    # there (1.98 against a 2.2 floor) while measuring 5.14 at 512 -- a 3.2 mm
    # blade is under two texels at 128 px, so the lay aliases away. A control
    # that measures a different tile than the one that ships proves nothing.
    px = T.PX
    flat = dict(h=np.full((px, px), 0.5), nx=np.zeros((px, px)), ny=np.zeros((px, px)),
                ao=np.ones((px, px)), rough=np.full((px, px), 0.9),
                albedo=np.tile(np.array([0.3, 0.5, 0.2]), (px, px, 1)))
    iso = T.maps_for("turf_rough", px)          # isotropic where a lay is required
    seamy = T.maps_for("turf_close", px)
    seamy = dict(seamy)
    seamy["h"] = seamy["h"] + np.linspace(0, 0.5, px)[:, None]   # a ramp cannot wrap

    cases = [
        ("a flat tile offered as turf_close", "turf_close", flat),
        ("an isotropic tile offered as turf_close", "turf_close", iso),
        ("a tile that does not wrap in v", "turf_close", seamy),
    ]
    ok = True
    for label, as_name, m in cases:
        bad = verdict(as_name, measure(m))
        print(f"  {label}: {'; '.join(bad) if bad else 'PASSED -- the check is measuring nothing'}")
        if not bad:
            ok = False
    good = verdict("turf_close", measure(T.maps_for("turf_close", px)))
    print(f"  the real turf_close tile: {'; '.join(good) if good else 'passes, as it must'}")
    if good:
        ok = False
    print("CONTROL OK: every broken tile is named and the real one passes" if ok
          else "CONTROL FAILED: the checks do not catch what they claim to")
    return 0 if ok else 1


def main():
    if "--control" in sys.argv:
        raise SystemExit(control())
    rows, bad_total = [], 0
    print(f"tile {T.TILE_M} m at {T.PX} px = {T.TILE_M * 1000.0 / T.PX:.2f} mm/texel\n")
    for name in T.SURFACES:
        m = T.maps_for(name)
        s = measure(m)
        bad = verdict(name, s)
        bad_total += len(bad)
        print(f"{name:11s} aniso fine {s['fine']:5.2f} coarse {s['coarse']:5.2f}  seam u {s['seamU']:.2f} v {s['seamV']:.2f}  "
              f"relief {s['relief']:.4f}  chroma {s['chroma']:.4f}  "
              f"rough {s['rough_lo']:.2f}-{s['rough_hi']:.2f}  ao_lo {s['ao_lo']:.2f}")
        for b in bad:
            print(f"            FAIL: {b}")
        rows.append((name, m))
    print(f"\nwrote {sheet(rows)} -- LOOK AT IT")
    raise SystemExit(1 if bad_total else 0)


if __name__ == "__main__":
    main()
