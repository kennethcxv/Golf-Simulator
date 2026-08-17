"""V3 BESIDE V2, same scale, same lights, same camera.

The broom comparison is the model: a claim that one version beats another is
only worth anything if both are in the same frame under the same light. It also
caught me comparing against the wrong object, which is exactly the mistake this
avoids for the garments -- v2 and v3 share nothing here except the scene.

v2 comes from `tools/blender/hero/build_apparel.py` and the 30-cell lattice
atlas; v3 from `v3/garments3.py` and the 32-cell nap atlas. Both are imported
without running their main(), so neither renders or exports as a side effect.

    blender --factory-startup -b --python \\
        tools/blender/hero/v3/compare_v2_v3.py -- garment=polo-folded
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import build_apparel as V2  # noqa: E402
import garments3 as V3  # noqa: E402

OUT = os.path.join(os.getcwd(), "qa", "hero", "v3", "compare")

# how far apart to park the two, per garment, so they never touch
SPREAD = {"polo-folded": 0.34, "tee-folded": 0.40, "hoodie-folded": 0.44,
          "trousers-folded": 0.44, "polo-hung": 0.46, "tee-hung": 0.44,
          "hoodie-hung": 0.50, "cap": 0.24}


def build_side(mod, garment, origin):
    """Build one garment from one module AT ITS OWN ORIGIN, then move it.

    Passing an offset origin into the builder looked equivalent and is not: v2
    contains at least two places that add the origin to a value that already
    has it in, and they are invisible at origin 0 -- which is every render
    either version has ever had. `edge_x` threw the polo's size tag 400 mm
    clear that way, and `top_z` refuses outright on the hoodie, 268 mm from
    the surface it is looking for, so the baseline could not be built at all.

    Building at zero and translating afterwards renders v2 exactly as it
    ships. Fixing those bugs in v2 to make the comparison work would mean
    comparing against a version the owner has never seen.
    """
    fn = getattr(mod, "GARMENTS", {}).get(garment)
    if fn is None:
        raise SystemExit(f"CONTROL FAILED: {mod.__name__} has no {garment}")
    parts = fn(origin=(0.0, 0.0, 0.0))
    for ob in parts.values():
        if hasattr(ob, "location"):
            ob.location.x += origin[0]
            ob.location.y += origin[1]
            ob.location.z += origin[2]
    cloth, trim = mod.materials()
    for key, ob in parts.items():
        if not hasattr(ob, "data") or getattr(ob.data, "vertices", None) is None:
            continue
        ob.data.materials.append(trim if key in ("hanger", "hook") else cloth)
        c = mod.cell_for(key, garment)
        try:
            if ob.get("explicit_uv"):
                mod.CL.cell_offset(ob, c, mod.ATLAS_COLS, mod.ATLAS_ROWS)
            else:
                mod.CL.texture_into_cell(ob, c, mod.ATLAS_COLS, mod.ATLAS_ROWS)
        except Exception as exc:                      # noqa: BLE001
            print(f"    (uv skipped for {key}: {exc})")
    return [ob for ob in parts.values()
            if hasattr(ob, "data") and getattr(ob.data, "vertices", None)]


def main():
    args = H.argv_after_dashes()
    garment = next((a.split("=", 1)[1] for a in args
                    if a.startswith("garment=")), "polo-folded")
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    dx = SPREAD.get(garment, 0.44)

    H.reset_scene()
    H.set_engine(engine, samples=200 if engine == "CYCLES" else 128)

    old = build_side(V2, garment, (-dx, 0.0, 0.0))
    new = build_side(V3, garment, (dx, 0.0, 0.0))
    both = old + new
    print(f"  v2: {H.triangles(old)} tris in {len(old)} parts")
    print(f"  v3: {H.triangles(new)} tris in {len(new)} parts")

    centre, radius = H.subject_sphere(both)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)
    LENS = 72.0
    dist = H.fit_distance(radius, LENS, res=(1900, 950), margin=1.10)
    os.makedirs(OUT, exist_ok=True)
    for label, az, el in (("hero", -118, 24), ("front", -90, 8),
                          ("low", -90, -6), ("top", -90, 76)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre,
                       lens=LENS)
        H.render(cam, os.path.join(OUT, f"{garment}-{label}.png"),
                 res=(1900, 950))
    print(f"  wrote {OUT}  (v2 LEFT, v3 RIGHT)")


if __name__ == "__main__":
    main()
