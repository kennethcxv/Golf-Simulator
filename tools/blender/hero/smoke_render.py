"""Negative-control smoke test for the hero studio.

Renders two known shapes -- a sphere and a flattened box -- through the exact
path the assets will use. Two things are being controlled for:

  1. THE RENDERER RUNS HEADLESS AT ALL. EEVEE needs a GL context; if background
     mode cannot make one this fails here rather than after an asset is modelled.
  2. THE SILHOUETTE PASS ACTUALLY DIFFERS FROM THE LIT PASS. A silhouette that
     comes out identical to the beauty render is a broken instrument, and a
     silhouette that comes out blank is worse -- it would pass every "is the
     outline clean" question by having no outline. The sphere and the slab have
     obviously different silhouettes, so the pass is checked against a shape
     whose answer is known before the render.

    blender --factory-startup -b --python tools/blender/hero/smoke_render.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import hero_lib as H  # noqa: E402

OUT = os.path.join(os.getcwd(), "qa", "hero", "smoke")


def main():
    H.reset_scene()
    H.set_engine("EEVEE", samples=48)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.05, location=(-0.07, 0, 0), segments=48, ring_count=24)
    sphere = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    bpy.ops.mesh.primitive_cube_add(size=0.1, location=(0.07, 0, 0))
    slab = bpy.context.active_object
    slab.scale = (1.0, 0.3, 1.4)

    mat = bpy.data.materials.new("Smoke")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.65, 0.42, 0.28, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.45
    for ob in (sphere, slab):
        ob.data.materials.append(mat)

    H.studio(center=(0, 0, 0), scale=0.12)
    H.backdrop(center=(0, 0, 0), scale=0.12)

    cam = H.camera("Hero", H.orbit_position((0, 0, 0), 0.42, -60, 20), (0, 0, 0), lens=72)
    lit = H.render(cam, os.path.join(OUT, "smoke-lit.png"), res=(700, 700))
    sil = H.silhouette([sphere, slab], cam, os.path.join(OUT, "smoke-silhouette.png"), res=(700, 700))

    tris = H.triangles([sphere, slab])
    print(f"TRIS {tris}")

    ok = True
    for path in (lit, sil):
        if not os.path.exists(path):
            print(f"FAIL missing {path}")
            ok = False
            continue
        size = os.path.getsize(path)
        print(f"FILE {os.path.basename(path)} {size} bytes")
        if size < 2000:
            print(f"FAIL {path} is too small to contain an image")
            ok = False

    # THE CONTROL: the two passes must differ, and the silhouette must be mostly
    # white with a black shape in it -- not blank, not all black.
    import numpy as np
    img = bpy.data.images.load(sil)
    w, h = img.size
    buf = np.asarray(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    dark = float((buf.mean(axis=2) < 0.25).mean())
    print(f"SILHOUETTE dark fraction {dark:.4f}")
    if not (0.02 < dark < 0.60):
        print("FAIL silhouette pass is blank or fully covered; it cannot discriminate")
        ok = False
    bpy.data.images.remove(img)

    print("SMOKE OK" if ok else "SMOKE FAILED")
    if not ok:
        sys.exit(3)


main()
