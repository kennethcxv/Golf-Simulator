"""CONTROL — DOES THE EXPORT PRESERVE THE ASSET?

Nothing has ever asked. Every check in this pipeline looks at the Blender scene
BEFORE the export, and every render is of that scene. The GLB is written last
and then nobody looks at it again, so an export that scrambles the asset is
invisible to all of it -- the assertions pass, the frames are correct, and the
file is wrong.

It does scramble it. `H.bake_gltf_axis` permutes the VERTEX coordinates,

    (x, y, z)_blender -> (x, z, -y)_gltf

but it does not touch the object's own LOCATION, and the exporter writes that
location straight through. So for any part whose object transform is not the
identity, the vertices are in the new convention and the transform is still in
the old one.

Measured on the bunker rake, whose RakeGrip sits at (0, -0.7481, 0.8463):

    Blender scene   y[-822.9,  50.0]  z[ -44.1, 926.3]
    round-tripped   y[-921.1,  50.0]  z[-830.3, 919.6]

The grip is exported 748 mm BELOW the origin instead of 846 mm along it. The
asset is 970 mm tall in the scene and 1,750 mm tall in the file.

THERE IS A KNOWN FIX AND TWO BUILDERS ALREADY USE IT. `build_rack` and
`build_register` call

    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

on their meshes before the axis swap, which zeroes every object transform so
there is nothing left to be in the wrong convention. The shipped rack measures
1225 x 484 x 1500 mm with its base at zero -- exactly its scene bounds. The
other 23 builders do not do this, and any of their parts made with HS.box or
HS.cylinder carries a location.

It must be applied to MESHES ONLY. The sockets are EMPTYs and their locations
are the whole point of them; bake_gltf_axis permutes those separately.

THIS IS WHY NONE OF THE HERO ASSETS COULD HAVE BEEN WIRED. It is upstream of
the origin convention, upstream of the sockets, upstream of everything else on
the Half B list.

    blender --factory-startup -b --python \\
        tools/blender/hero/control_export_roundtrip.py -- [only=rake,mower]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402

TOL = 1e-4
OUT = os.path.join(os.getcwd(), "qa", "hero", "_roundtrip")


def subject_of(mod):
    """Build an asset and return the list its builder actually exports."""
    if mod == "rake":
        import build_rake as B
        p = B.build()
        parts = [p["head"], p["ferrule"], p["shaft"], p["grip"],
                 HS.join(p["tines"], "RakeTines")]
        bpy.ops.object.select_all(action="DESELECT")
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.transform_apply(location=True, rotation=False,
                                       scale=False)
        return parts
    if mod == "rack":
        # build_rack is one of only two builders that bakes its object
        # locations before the axis swap, and the control has to reproduce that
        # or it measures its own omission. It did, first time round, and
        # reported the rack scrambled by 1,318 mm when the shipped file is
        # exactly right.
        import build_rack as B
        import outdoor_lib as OL
        p = B.build_one(OL.palette(), "ctl", 1.5, 4, 0.0)
        parts = B.flat(p)
        bpy.ops.object.select_all(action="DESELECT")
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.transform_apply(location=True, rotation=False,
                                       scale=False)
        return parts
    raise SystemExit(f"CONTROL FAILED: no subject recipe for {mod}")


def roundtrip(name):
    H.reset_scene()
    H.set_engine("EEVEE", samples=8)
    subject = subject_of(name)
    lo, hi = H.bounds(subject)
    moved = [o.name for o in subject
             if o.location.length > 1e-9 or o.rotation_euler.x
             or o.rotation_euler.y or o.rotation_euler.z]

    H.bake_gltf_axis(subject)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.glb")
    H.export_glb(subject, path)

    H.reset_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    ms = [o for o in bpy.data.objects if o.type == "MESH"]
    lo2, hi2 = H.bounds(ms)

    # The axis bake then the importer's glTF-Y-up-to-Blender-Z-up conversion are
    # inverses, so a faithful export comes back exactly where it started.
    d = max(abs(lo2.x - lo.x), abs(hi2.x - hi.x), abs(lo2.y - lo.y),
            abs(hi2.y - hi.y), abs(lo2.z - lo.z), abs(hi2.z - hi.z))
    print(f"  {name}")
    print(f"    parts with a non-identity transform: "
          f"{', '.join(moved) if moved else 'none'}")
    print(f"    scene        x[{lo.x * 1000:8.1f},{hi.x * 1000:8.1f}] "
          f"y[{lo.y * 1000:8.1f},{hi.y * 1000:8.1f}] "
          f"z[{lo.z * 1000:8.1f},{hi.z * 1000:8.1f}]")
    print(f"    round trip   x[{lo2.x * 1000:8.1f},{hi2.x * 1000:8.1f}] "
          f"y[{lo2.y * 1000:8.1f},{hi2.y * 1000:8.1f}] "
          f"z[{lo2.z * 1000:8.1f},{hi2.z * 1000:8.1f}]")
    print(f"    worst corner moved {d * 1000:.2f} mm")
    return d, moved


def main():
    args = H.argv_after_dashes()
    only = next((a.split("=", 1)[1] for a in args if a.startswith("only=")),
                "rack,rake")
    print()
    print("=" * 74)
    print("CONTROL — the export round trip")
    print("=" * 74)
    bad = []
    for name in only.split(","):
        d, moved = roundtrip(name.strip())
        if d > TOL:
            bad.append((name, d, moved))
    print()
    if bad:
        for name, d, moved in bad:
            print(f"  SCRAMBLED  {name}: {d * 1000:.1f} mm, and the parts with "
                  f"transforms are {moved}")
        raise SystemExit(
            "CONTROL FAILED: the export does not preserve the asset. "
            "bake_gltf_axis permutes vertices and leaves object transforms in "
            "the old convention; parts that skip HS.apply_mods keep a "
            "transform and land in the wrong place.")
    print("CONTROL PASSED — every asset checked survives the round trip "
          "unchanged.")


if __name__ == "__main__":
    main()
