"""LOOK AT THE TILES BEFORE ANYTHING IS WIRED TO THEM.

Six new height fields go into the counter and the three clubs. A height field
that is wrong is not visible in a GLB assertion -- `assert_maps` will happily
report a normal texture that encodes noise, or an oak grain running the wrong
way, or a diamond tooth whose period is a texel. Every one of those ships as
"baked" and looks worse than the flat colour it replaced.

So this writes the tiles out as images and, for each family, the three numbers
that say whether the field is a SURFACE or a mess:

  anisotropy   how much more the field varies across u than across v. Oak has
               to be strongly anisotropic (grain runs one way) and laminate
               must not be.
  seam         the difference across the wrap in both directions. These tiles
               repeat up to 64 times on one part; a seam of any size becomes a
               visible grid.
  contrast     peak-to-peak after normalisation, which is 1.0 by construction,
               and the standard deviation, which is not: a field that is 0.02
               of standard deviation is a flat grey with a couple of spikes.

    blender --factory-startup -b --python surface_control.py
    (needs Blender only because weave.py imports bpy at module scope)
"""

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "v6"))
sys.path.insert(0, os.path.dirname(HERE))

import weave as WV  # noqa: E402
import surface as SF  # noqa: E402


def _png(path, arr):
    """Write a HxW or HxWx3 float array as 8-bit, without PIL."""
    import bpy
    a = np.asarray(arr, dtype=np.float32)
    if a.ndim == 2:
        a = np.stack([a, a, a], axis=-1)
    h, w, _ = a.shape
    img = bpy.data.images.new(os.path.basename(path), width=w, height=h,
                              alpha=False, float_buffer=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(a, 0.0, 1.0)
    img.pixels.foreach_set(rgba.reshape(-1))
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def stats(h):
    # ACROSS vs ALONG. Mean absolute difference between neighbouring columns
    # against neighbouring rows: a grain that runs along u changes fast as you
    # step across it and slowly as you step along it.
    du = np.abs(np.diff(h, axis=1)).mean()
    dv = np.abs(np.diff(h, axis=0)).mean()
    aniso = float(max(du, dv) / max(min(du, dv), 1e-9))
    seam_u = float(np.abs(h[:, 0] - h[:, -1]).mean())
    seam_v = float(np.abs(h[0, :] - h[-1, :]).mean())
    # ...against the tile's own internal step, because a seam only matters
    # relative to how much the field moves anyway.
    step = float(max(du, dv))
    return dict(aniso=round(aniso, 2),
                seamU=round(seam_u / max(step, 1e-9), 2),
                seamV=round(seam_v / max(step, 1e-9), 2),
                sd=round(float(h.std()), 3),
                lo=round(float(h.min()), 3), hi=round(float(h.max()), 3))


def main():
    SF.register()
    out = os.path.join(os.path.dirname(os.path.dirname(
        os.path.dirname(HERE))), "qa", "hero", "v7", "tiles")
    os.makedirs(out, exist_ok=True)
    print()
    print("=" * 78)
    print("%-10s %8s %8s %8s %7s %14s  %s"
          % ("family", "aniso", "seamU", "seamV", "sd", "range", "verdict"))
    print("=" * 78)
    bad = []
    for fam in sorted(SF.HARD_FAMILY):
        spec = WV.FAMILY[fam]
        h, nrm, orm = WV.maps_for(fam, 0.40)
        s = stats(h)
        notes = []
        # A tile that repeats up to 64 times cannot carry a seam. 0.9 of the
        # tile's own internal step is the width of one texel's worth of change.
        if s["seamU"] > 0.9 or s["seamV"] > 0.9:
            notes.append("SEAM")
        # A field with almost no spread is a flat grey: the maps derived from
        # it say nothing, and "baked" would be a lie.
        if s["sd"] < 0.04:
            notes.append("FLAT")
        # the two that have a direction, and the one that must not
        if fam in ("oak", "brass", "steel") and s["aniso"] < 1.6:
            notes.append("NOT DIRECTIONAL")
        if fam == "laminate" and s["aniso"] > 1.6:
            notes.append("UNWANTED GRAIN")
        if notes:
            bad.append("%s: %s" % (fam, ", ".join(notes)))
        print("%-10s %8.2f %8.2f %8.2f %7.3f  %6.3f..%-6.3f  %s"
              % (fam, s["aniso"], s["seamU"], s["seamV"], s["sd"],
                 s["lo"], s["hi"], ", ".join(notes) or "ok"))
        _png(os.path.join(out, "%s_height.png" % fam), h)
        _png(os.path.join(out, "%s_normal.png" % fam), nrm)
        _png(os.path.join(out, "%s_orm.png" % fam), orm)
        print("            metal=%.1f slope=%.3f cell=%.1fmm  ORM blue=%.2f"
              % (spec.get("metal", 0.0), spec["slope"], spec["cell_mm"],
                 float(orm[..., 2].mean())))
    print()
    if bad:
        print("TILE CONTROL FAILED:")
        for b in bad:
            print("  " + b)
        raise SystemExit(1)
    print("tiles written to %s -- NOW LOOK AT THEM." % out)


if __name__ == "__main__":
    main()
