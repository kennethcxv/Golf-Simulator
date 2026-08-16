"""PART 2, STEP ONE — photograph what already exists before modelling anything.

The queue is explicit: `vendor/models/checkout/retail_gondola.glb` and
`asset_064_stockroom_shelving_system.glb` already exist. Light them, turntable
them, and say whether either already reads correctly. Keeping one that works is
what happened with the broom and it was the right call.

This is a REPORT, not a build. It imports, measures and renders; it writes no
asset.

    blender --factory-startup -b --python tools/blender/hero/inspect_shelving.py -- \
        <glb-path> <label> [cycles]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import hero_lib as H  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "shelving")


def main():
    args = H.argv_after_dashes()
    path = args[0]
    label = args[1]
    engine = "CYCLES" if "cycles" in args else "EEVEE"

    H.reset_scene()
    H.set_engine(engine, samples=150 if engine == "CYCLES" else 96)
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, path))
    imported = [o for o in bpy.data.objects if o.name not in before]
    meshes = [o for o in imported if o.type == "MESH"]

    mats = set()
    for o in meshes:
        for slot in o.material_slots:
            if slot.material:
                mats.add(slot.material.name)

    print("")
    print(f"  === {label}: {os.path.basename(path)} ===")
    print(f"  nodes {len(imported)}   meshes {len(meshes)}   "
          f"materials {len(mats)}")
    print(f"  TRIS {H.triangles(meshes)}  — the hand is 5,179")
    lo, hi = H.bounds(meshes)
    print(f"  overall {(hi.x - lo.x):.4f} x {(hi.y - lo.y):.4f} x "
          f"{(hi.z - lo.z):.4f} yd")
    roots = [o.name for o in imported if o.parent is None]
    print(f"  root nodes: {roots[:6]}")
    print(f"  materials: {sorted(mats)[:10]}")
    print("")

    centre, radius = H.subject_sphere(meshes)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.14)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, label, views=8,
                     elevation=16.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"{label}-turntable.png"), cols=4)
    for name, az, el in (("hero", -122, 18), ("front", -90, 6), ("top", -90, 62)):
        cam = H.camera(name, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"{label}-{name}.png"), res=(1100, 1100))


main()
