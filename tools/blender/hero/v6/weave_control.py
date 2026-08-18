"""THE CONTROL FOR THE FABRIC TILES, and the frames to look at them in.

The maps are about to be believed by four other things -- the exporter, the
assertion, the studio render and the game -- so before any of that, make the
synthesiser fail on purpose and watch it.

  1  A FLAT height must give exactly (0.5, 0.5, 1.0) everywhere and occlusion
     exactly 1.0. If a constant input produces structure, the structure in the
     real tiles is the instrument's, not the cloth's.
  2  EVERY TILE MUST WRAP. The seam step is measured against the largest
     interior step: a tile that does not wrap repeats its seam across a whole
     garment as a visible grid, which is the classic way this fails and it is
     invisible in a single-tile preview.
  3  Every real family must be MEASURABLY not flat, in both u and v -- a
     one-directional map is corduroy, which one earlier round shipped by
     summing two waves instead of multiplying them.

Then it writes each family's height, normal and occlusion out as PNG so they
can be LOOKED AT, plus a nine-tile block per family, which is the only frame in
which a seam is actually visible.

    blender --factory-startup -b --python weave_control.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
import bpy  # noqa: E402

import weave as W  # noqa: E402

OUT = None


def flat_control():
    """Swap in a constant height field and require a dead-flat result."""
    keep = W.HEIGHT["pique"]
    W.HEIGHT["pique"] = lambda px, f, seed: np.full((px, px), 0.5)
    try:
        _, nrm, orm = W.maps_for("pique", 0.8)
    finally:
        W.HEIGHT["pique"] = keep
    dn = float(np.abs(nrm - np.array([0.5, 0.5, 1.0])).max())
    dao = float(np.abs(orm[..., 0] - 1.0).max())
    ok = dn < 1e-6 and dao < 1e-6
    print("  %-5s flat height -> normal off by %.2e, occlusion off by %.2e"
          % ("ok" if ok else "FAIL", dn, dao))
    return ok


def wrap_control(family, rough=0.8):
    """Seam step vs the largest interior step, per channel."""
    _, nrm, orm = W.maps_for(family, rough)
    worst = 0.0
    for img, tag in ((nrm, "normal"), (orm, "orm")):
        for axis in (0, 1):
            d = np.abs(np.diff(img, axis=axis))
            interior = float(d.max())
            seam = float(np.abs(np.take(img, 0, axis=axis)
                                - np.take(img, -1, axis=axis)).max())
            ratio = seam / max(interior, 1e-9)
            worst = max(worst, ratio)
    ok = worst <= 1.35
    print("  %-5s %-7s wraps: seam step is %.2fx the largest interior step"
          % ("ok" if ok else "FAIL", family, worst))
    return ok


def structure_control(family, rough=0.8):
    _, nrm, orm = W.maps_for(family, rough)
    sx = float(nrm[..., 0].std())
    sy = float(nrm[..., 1].std())
    ao = float(orm[..., 0].min())
    rg = float(orm[..., 1].max() - orm[..., 1].min())
    ok = sx > 0.008 and sy > 0.008 and ao < 0.92 and rg > 0.02
    print("  %-5s %-7s normal sd u=%.3f v=%.3f   occlusion floor %.2f   "
          "roughness spread %.3f" % ("ok" if ok else "FAIL", family,
                                     sx, sy, ao, rg))
    return ok


def save(name, rgb):
    h, w = rgb.shape[0], rgb.shape[1]
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"   # BEFORE the pixels; see weave._image
    buf = np.empty((h, w, 4), np.float32)
    buf[..., :3] = np.clip(rgb, 0.0, 1.0)
    buf[..., 3] = 1.0
    img.pixels.foreach_set(buf.ravel())
    img.update()
    back = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(back)
    if float(back.max()) < 1e-6:
        raise SystemExit("CONTROL FAILED: %s is empty before it is even saved"
                         % name)
    img.filepath_raw = os.path.join(OUT, name + ".png")
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def sheet(family, rough=0.8):
    h, nrm, orm = W.maps_for(family, rough)
    px = h.shape[0]
    grey = np.repeat(h[..., None], 3, axis=2)
    ao = np.repeat(orm[..., 0:1], 3, axis=2)
    strip = np.concatenate([grey, nrm, ao], axis=1)
    save("tile_%s" % family, strip)
    # THE NINE-TILE BLOCK. A seam is invisible in one tile by definition.
    nine = np.tile(nrm, (3, 3, 1))
    save("tile9_%s" % family, nine[::3, ::3])
    return px


def main():
    global OUT
    OUT = os.path.join(W.__file__, "..", "..", "..", "..", "..",
                       "qa", "hero", "v7", "tiles")
    OUT = os.path.abspath(OUT)
    os.makedirs(OUT, exist_ok=True)

    print()
    print("=" * 74)
    print("FABRIC TILE CONTROL")
    print("=" * 74)
    ok = [flat_control()]
    print()
    for fam in W.FAMILY:
        ok.append(wrap_control(fam))
    print()
    for fam in W.FAMILY:
        ok.append(structure_control(fam))
    print()
    for fam in W.FAMILY:
        sheet(fam)
    print("  wrote %d strips and %d nine-tile blocks to %s"
          % (len(W.FAMILY), len(W.FAMILY), OUT))
    print()
    if not all(ok):
        raise SystemExit("CONTROL FAILED: %d of %d checks"
                         % (sum(1 for x in ok if not x), len(ok)))
    print("control passed: %d of %d. A flat height gives a flat map, every "
          "tile wraps, and every family has structure in both directions."
          % (len(ok), len(ok)))


if __name__ == "__main__":
    main()
