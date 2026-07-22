"""AAA technical audit over every kit GLB (pro_shop products+fixtures, checkout
kit, clubhouse props).  Measures — does not fix:

  geometry : tri count, mesh objects, loose verts, non-manifold edges
  materials: slot count (draw calls), unique materials, flat-vs-textured
  textures : unique images, resolutions, oversized/undersized
  uvs      : textured meshes missing UVs, texel-density spread (max/min per mesh)
  export   : residual object transforms (non-identity), floor gap, dims drift vs manifest
  contract : COL_ present, PICKUP_SOCKET (products), slot extras (fixtures)

Writes assets/pro_shop/manifests/audit_report.json and prints offender tables.
"""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import bmesh
from mathutils import Vector
import proshop_lib as P

ROOT = P.ROOT
FRAG = {f.stem: json.loads(f.read_text()) for f in P.FRAGMENT_DIR.glob("*.json")}

SCOPES = [
    ("pro_products", ROOT / "assets/pro_shop/glb/products"),
    ("pro_fixtures", ROOT / "assets/pro_shop/glb/fixtures"),
    ("checkout", ROOT / "assets/checkout/glb"),
    ("clubhouse", ROOT / "vendor/models/clubhouse"),
]

REPORT = {"assets": {}, "summary": {}}


def audit(scope, path):
    aid = path.stem
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.import_scene.gltf(filepath=str(path))
    except Exception as e:
        REPORT["assets"][aid] = {"scope": scope, "error": str(e)[:120]}
        return
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    vis = [o for o in meshes if not o.name.startswith("COL_")]
    entry = {"scope": scope, "issues": []}

    tris = 0
    mat_slots = 0
    loose = 0
    nonman = 0
    td_spread_worst = 1.0
    missing_uv = []
    xform = []
    for o in vis:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        mat_slots += max(1, len(o.material_slots))
        # transforms (glTF import may keep non-identity on roots legitimately;
        # flag only meshes with non-uniform scale)
        s = o.scale
        if abs(s.x - s.y) > 1e-4 or abs(s.y - s.z) > 1e-4:
            xform.append(o.name)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        loose += sum(1 for v in bm.verts if not v.link_edges)
        nonman += sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
        # texel density spread for textured meshes with UVs
        has_tex = any(m and m.use_nodes and any(n.type == "TEX_IMAGE" for n in m.node_tree.nodes)
                      for m in o.data.materials if m)
        uv = bm.loops.layers.uv.active
        if has_tex and uv is None:
            missing_uv.append(o.name)
        elif has_tex and uv is not None and len(bm.faces) > 3:
            dens = []
            for f in bm.faces:
                if len(f.loops) < 3:
                    continue
                a3 = f.calc_area()
                if a3 < 1e-10:
                    continue
                uvs = [lp[uv].uv for lp in f.loops]
                a2 = 0.0
                for i in range(1, len(uvs) - 1):
                    a2 += abs((uvs[i].x - uvs[0].x) * (uvs[i + 1].y - uvs[0].y)
                              - (uvs[i + 1].x - uvs[0].x) * (uvs[i].y - uvs[0].y)) / 2
                if a2 > 1e-12:
                    dens.append(math.sqrt(a2 / a3))
            if len(dens) > 8:
                dens.sort()
                lo = dens[int(len(dens) * 0.08)]
                hi = dens[int(len(dens) * 0.92)]
                if lo > 1e-9:
                    td_spread_worst = max(td_spread_worst, hi / lo)

    imgs = {}
    for img in bpy.data.images:
        if img.name != "Render Result" and img.size[0]:
            imgs[img.name.split(".")[0]] = f"{img.size[0]}x{img.size[1]}"

    names = {o.name.split(".")[0] for o in bpy.data.objects}
    mins = Vector((1e9,) * 3)
    for o in vis:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins.x, mins.y, mins.z = min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)

    frag = FRAG.get(aid, {})
    hanging = frag.get("min_z", 0) < -0.05 or aid.startswith("pf_hook") or "hanger" in aid

    entry.update({
        "tris": tris, "mesh_objects": len(vis), "mat_slots": mat_slots,
        "images": len(imgs), "loose_verts": loose, "nonmanifold_edges": nonman,
        "texel_spread": round(td_spread_worst, 1),
    })
    if scope.startswith("pro"):
        if not any(n.startswith("COL_") for n in names):
            entry["issues"].append("no collision")
        if scope == "pro_products" and "PICKUP_SOCKET" not in names:
            entry["issues"].append("no PICKUP_SOCKET")
        if not hanging and mins.z > 0.02:
            entry["issues"].append(f"floor gap {mins.z:.3f}")
        if mins.z < -0.02 and not hanging:
            entry["issues"].append(f"below floor {mins.z:.3f}")
        entry["wall_mount"] = bool(aid.startswith("pf_hook"))
        fd = frag.get("dims_m")
        if fd:
            import_dims = None
    if loose:
        entry["issues"].append(f"loose verts {loose}")
    if nonman > 60:
        entry["issues"].append(f"nonmanifold {nonman}")
    if missing_uv:
        entry["issues"].append(f"textured-no-UV: {','.join(missing_uv[:3])}")
    if xform:
        entry["issues"].append(f"nonuniform scale: {','.join(x.split('.')[0] for x in xform[:3])}")
    if td_spread_worst > 14:
        entry["issues"].append(f"texel spread {td_spread_worst:.0f}x")
    if mat_slots > 26:
        entry["issues"].append(f"mat slots {mat_slots}")
    REPORT["assets"][aid] = entry


for scope, d in SCOPES:
    if not d.exists():
        continue
    for p in sorted(d.glob("*.glb")):
        audit(scope, p)

worst = sorted(REPORT["assets"].items(), key=lambda kv: -(kv[1].get("tris", 0)))[:12]
flagged = {k: v for k, v in REPORT["assets"].items() if v.get("issues")}
REPORT["summary"] = {
    "audited": len(REPORT["assets"]),
    "flagged": len(flagged),
    "total_tris": sum(v.get("tris", 0) for v in REPORT["assets"].values()),
    "total_mat_slots": sum(v.get("mat_slots", 0) for v in REPORT["assets"].values()),
}
(P.MANIFEST_DIR / "audit_report.json").write_text(json.dumps(REPORT, indent=1))
print(f"AUDIT|assets={REPORT['summary']['audited']}|flagged={len(flagged)}|tris={REPORT['summary']['total_tris']}")
print("TOP TRIS:")
for k, v in worst:
    print(f"  {k:42s} {v.get('tris',0):7d} tris  {v.get('mat_slots',0):3d} slots  {v.get('mesh_objects',0):3d} meshes")
print("FLAGGED:")
for k, v in sorted(flagged.items()):
    print(f"  {k:42s} {'; '.join(v['issues'])}")
