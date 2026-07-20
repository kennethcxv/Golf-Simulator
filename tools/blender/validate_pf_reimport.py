"""Phase 8: reimport every exported pro-shop GLB into a clean Blender file and
verify: meshes present, materials assigned, textured images embedded, floor
contact (min z ~ 0 for standing assets / hanging assets flagged), sockets
survive, transforms sane.  Writes manifests/reimport_report.json."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
from mathutils import Vector
import proshop_lib as P

REPORT = {"checked": 0, "problems": []}
FRAG = {f.stem: json.loads(f.read_text()) for f in P.FRAGMENT_DIR.glob("*.json")}


def check(kind, path):
    aid = path.stem
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    problems = []
    if not meshes:
        problems.append("no meshes")
    vis = [o for o in meshes if not o.name.startswith("COL_")]
    if not any(o.data.materials for o in vis):
        problems.append("no materials")
    mins = Vector((1e9,) * 3)
    maxs = Vector((-1e9,) * 3)
    for o in vis:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mins[i] = min(mins[i], w[i])
                maxs[i] = max(maxs[i], w[i])
    hanging = FRAG.get(aid, {}).get("min_z", 0) < -0.05
    if not hanging and abs(mins.z) > 0.02 and kind == "products":
        problems.append(f"floor gap min_z={mins.z:.3f}")
    if not any(o.type == "EMPTY" and "PICKUP_SOCKET" in o.name for o in bpy.data.objects) and kind == "products":
        problems.append("missing PICKUP_SOCKET")
    if any(o.type in ("CAMERA", "LIGHT") for o in bpy.data.objects):
        problems.append("camera/light exported")
    imgs = [i for i in bpy.data.images if i.name != "Render Result"]
    if any(not i.packed_file and not i.pixels for i in imgs):
        problems.append("unpacked image")
    REPORT["checked"] += 1
    if problems:
        REPORT["problems"].append({"id": aid, "kind": kind, "issues": problems})


for kind in ("products", "fixtures"):
    for path in sorted((P.GLB_DIR / kind).glob("*.glb")):
        check(kind, path)

(P.MANIFEST_DIR / "reimport_report.json").write_text(json.dumps(REPORT, indent=1))
print(f"REIMPORT|checked={REPORT['checked']}|problems={len(REPORT['problems'])}")
for p in REPORT["problems"][:20]:
    print("  ", p["id"], p["issues"])
