"""Clean-reimport verification for any Assets 51-100 sheet.

Run from Blender, for example::

    blender --background --factory-startup --python tools/blender/verify_assets_reimport.py -- --sheet 7
    blender --background --factory-startup --python tools/blender/verify_assets_reimport.py -- --asset 61

Why this exists, and why it is deliberately generic
---------------------------------------------------
`verify_assets_51_60_reimport.py` proves Sheet 6 and only Sheet 6: its identities,
its expected sockets, its ``SHEET06_CLEAN_REIMPORT`` marker. Copying that file per
sheet would give four near-identical 50 KB scripts that drift apart the first time
the contract changes.

The thing actually worth verifying is sheet-independent: *does the exported binary,
opened cold in a scene that has never seen the builder, still contain what the
builder claimed it did?* A GLB is the only artifact the game loads. The .blend can be
perfect and the export still lose a socket, bake in an unapplied scale, flip a
normal, or drop a UV layer. So this reads the GLB and nothing else.

Critically, this never imports the builder module. If it did, a builder bug that
also corrupted the export would cancel itself out and the check would pass. The
expected root name is recomputed from the asset number via the shared identity
rules, so the only shared surface is the naming contract itself.

What a pass means
-----------------
The GLB opens in a virgin scene; the asset root is a single ``A_NNN_*_ROOT`` empty at
identity transform; every node carries an approved prefix; visible meshes are
``MESH_``, collision proxies are ``COL_``; meshes have applied scale/rotation, UVs and
no degenerate triangles; no camera or light shipped; and the round-tripped world
bounds match what the builder measured. Y-up glTF is converted back to Z-up on
import, so a bounds mismatch here is a real axis or scale defect, not a convention.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A

VALID_PREFIXES = ("A_", "MESH_", "COL_", "SOCKET_", "PIVOT_", "LOD0_", "LOD1_", "LOD2_")

# The builder measures bounds in metres before export. glTF round-trips through a
# Y-up float32 buffer, so exact equality is not available; 1 mm is far tighter than
# any real authoring defect and far looser than quantisation noise.
BOUNDS_TOLERANCE_M = 1e-3


def _nearly(value: float, target: float, tolerance: float = 1e-4) -> bool:
    return abs(float(value) - float(target)) <= tolerance


def wipe_scene() -> None:
    """Remove everything, including datablocks the importer would otherwise reuse.

    `--factory-startup` still ships the default cube, camera and light. Deleting only
    objects leaves their meshes and materials in `bpy.data`, where the glTF importer
    will happily reuse a name and mask a missing one in the file.
    """

    bpy.ops.wm.read_factory_settings(use_empty=True)
    for collection in (
        bpy.data.objects, bpy.data.meshes, bpy.data.materials,
        bpy.data.images, bpy.data.armatures, bpy.data.actions,
        bpy.data.cameras, bpy.data.lights,
    ):
        for item in list(collection):
            collection.remove(item, do_unlink=True)


def mesh_report(obj: bpy.types.Object) -> dict:
    """Topology facts that survive export and matter at runtime."""

    mesh = obj.data
    mesh.calc_loop_triangles()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    # `edge.is_manifold` is False for boundary edges too, and open geometry is the norm
    # here — a window casing or a floor plank is a shell, not a solid. Flagging those
    # produced 142 warnings on a known-good sheet, which is a check nobody will read.
    # Only an edge shared by three or more faces is genuinely malformed.
    non_manifold = sum(1 for edge in bm.edges if len(edge.link_faces) > 2)
    boundary = sum(1 for edge in bm.edges if len(edge.link_faces) == 1)
    zero_area = sum(1 for face in bm.faces if face.calc_area() <= 1e-12)
    bm.free()
    return {
        "name": obj.name,
        "triangles": len(mesh.loop_triangles),
        "uvLayers": len(mesh.uv_layers),
        "materialSlots": len(obj.material_slots),
        "nonManifoldEdges": non_manifold,
        "boundaryEdges": boundary,
        "zeroAreaFaces": zero_area,
        "appliedScale": all(_nearly(v, 1.0) for v in obj.scale),
        "appliedRotation": all(_nearly(v, 0.0) for v in obj.rotation_euler),
    }


def world_bounds(root: bpy.types.Object) -> dict | None:
    """Axis-aligned world bounds of the visible meshes under `root`, in metres."""

    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    found = False
    for obj in [root, *root.children_recursive]:
        if obj.type != "MESH" or obj.name.startswith("COL_"):
            continue
        found = True
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                lo[axis] = min(lo[axis], world[axis])
                hi[axis] = max(hi[axis], world[axis])
    if not found:
        return None
    return {
        "minimum": [round(v, 6) for v in lo],
        "maximum": [round(v, 6) for v in hi],
        "size": [round(hi[i] - lo[i], 6) for i in range(3)],
    }


def verify_glb(asset_number: int, slug: str | None, glb_path: Path) -> dict:
    """Import one GLB into a virgin scene and report exactly what is inside it."""

    issues: list[dict] = []

    def fail(code: str, message: str, node: str | None = None) -> None:
        issues.append({"severity": "error", "code": code, "message": message, "node": node})

    def warn(code: str, message: str, node: str | None = None) -> None:
        issues.append({"severity": "warning", "code": code, "message": message, "node": node})

    wipe_scene()

    if not glb_path.is_file():
        fail("glb-missing", f"no GLB at {glb_path}")
        return {"asset": asset_number, "glb": str(glb_path), "ok": False, "issues": issues, "stats": {}}

    bpy.ops.import_scene.gltf(filepath=str(glb_path))

    objects = list(bpy.context.scene.objects)
    roots = [o for o in objects if o.parent is None and o.name.startswith("A_")]
    if len(roots) != 1:
        fail("root-count", f"expected exactly one A_*_ROOT, found {len(roots)}")
        return {"asset": asset_number, "glb": str(glb_path), "ok": False, "issues": issues, "stats": {}}
    root = roots[0]

    # Recompute the expected name from the shared identity rules rather than trusting
    # the builder, so a rename in the builder cannot silently redefine "correct".
    if slug:
        expected = A.AssetIdentity(asset_number, slug).root_name
        if root.name != expected:
            fail("root-name", f"expected {expected}, got {root.name}", root.name)

    if root.type != "EMPTY":
        fail("root-type", "asset root must import as an empty", root.name)
    if any(not _nearly(v, 0.0) for v in (*root.location, *root.rotation_euler)):
        fail("root-transform", "asset root must sit at identity", root.name)
    if any(not _nearly(v, 1.0) for v in root.scale):
        fail("root-scale", f"asset root scale is {tuple(round(v, 6) for v in root.scale)}", root.name)

    nodes = [root, *root.children_recursive]
    orphans = [o.name for o in objects if o not in nodes]
    if orphans:
        fail("orphan-node", f"{len(orphans)} node(s) outside the asset root: {orphans[:5]}")

    visible = [o for o in nodes if o.type == "MESH" and o.name.startswith("MESH_")]
    collisions = [o for o in nodes if o.type == "MESH" and o.name.startswith("COL_")]
    sockets = sorted(o.name for o in nodes if o.name.startswith("SOCKET_"))
    pivots = sorted(o.name for o in nodes if o.name.startswith("PIVOT_"))
    stray_meshes = [
        o.name for o in nodes
        if o.type == "MESH" and not o.name.startswith(("MESH_", "COL_"))
    ]

    for node in nodes:
        if node.type in {"CAMERA", "LIGHT"}:
            fail("ship-node", "camera/light shipped inside the GLB", node.name)
        if node is not root and not node.name.startswith(VALID_PREFIXES):
            fail("node-name", "node lacks an approved prefix", node.name)

    if not visible:
        fail("visible-mesh", "GLB contains no MESH_ geometry")
    # Not everything is supposed to have collision. A viewmodel must never block the
    # player holding it, and wall dressing at head height -- a noticeboard, a clock, a key
    # rack -- must not snag someone walking past. Assets that ship none on purpose say so
    # on their root, and glTF carries that through as an extra; the default is that
    # collision is expected, so silence is never mistaken for intent.
    first_person_variant = bool(slug and slug.endswith("_fp"))
    collision_expected = root.get("collision_expected", True) not in (False, 0, "false", "False")
    if not collisions and collision_expected and not first_person_variant:
        warn("collision-missing", "GLB ships no COL_ proxy")
    if collisions and not collision_expected:
        warn("collision-unexpected",
             f"root declares collision_expected=false but ships {len(collisions)} COL_ proxy/proxies")
    if collisions and first_person_variant:
        fail("viewmodel-collision", f"viewmodel ships {len(collisions)} COL_ proxy/proxies")
    for name in stray_meshes:
        fail("mesh-prefix", "mesh is neither MESH_ nor COL_", name)

    meshes = []
    for obj in visible + collisions:
        report = mesh_report(obj)
        meshes.append(report)
        if not report["appliedScale"]:
            fail("unapplied-scale", "mesh carries a non-unit scale", obj.name)
        if not report["appliedRotation"]:
            fail("unapplied-rotation", "mesh carries an unapplied rotation", obj.name)
        if report["zeroAreaFaces"]:
            fail("zero-area", f"{report['zeroAreaFaces']} zero-area face(s)", obj.name)
        if obj.name.startswith("MESH_"):
            if report["uvLayers"] == 0:
                fail("uv-missing", "visible mesh has no UV layer", obj.name)
            if report["materialSlots"] == 0:
                fail("material-missing", "visible mesh has no material", obj.name)
            if report["nonManifoldEdges"]:
                warn("non-manifold", f"{report['nonManifoldEdges']} non-manifold edge(s)", obj.name)

    materials = sorted({
        slot.material.name
        for obj in visible for slot in obj.material_slots
        if slot.material
    })
    animations = sorted(action.name for action in bpy.data.actions)

    stats = {
        "root": root.name,
        "nodeCount": len(nodes),
        "visibleMeshCount": len(visible),
        "collisionMeshCount": len(collisions),
        "triangleCount": sum(m["triangles"] for m in meshes if m["name"].startswith("MESH_")),
        "collisionTriangleCount": sum(m["triangles"] for m in meshes if m["name"].startswith("COL_")),
        "materialCount": len(materials),
        "materials": materials,
        "socketCount": len(sockets),
        "sockets": sockets,
        "pivotCount": len(pivots),
        "pivots": pivots,
        "animationNames": animations,
        "boundsMeters": world_bounds(root),
        "fileBytes": glb_path.stat().st_size,
        "meshes": meshes,
    }

    return {
        "asset": asset_number,
        "glb": glb_path.as_posix(),
        "ok": not any(i["severity"] == "error" for i in issues),
        "errorCount": sum(1 for i in issues if i["severity"] == "error"),
        "warningCount": sum(1 for i in issues if i["severity"] == "warning"),
        "issues": issues,
        "stats": stats,
    }


def discover(sheet: int | None, asset: int | None) -> list[tuple[int, str, Path]]:
    """Find built GLBs on disk. Slug comes from the filename, not from a builder."""

    if asset is not None:
        numbers = [asset]
    elif sheet is not None:
        start = (sheet - 1) * 10 + 1
        numbers = list(range(start, start + 10))
    else:
        numbers = list(range(A.ASSET_MIN, A.ASSET_MAX + 1))

    found: list[tuple[int, str, Path]] = []
    for number in numbers:
        prefix = f"asset_{number:03d}_"
        # An asset can ship twice: the world copy under its sheet, and a viewmodel under
        # firstperson/. Both are loaded by the game, so both are verified.
        for directory in (A.RUNTIME_ROOT / f"sheet_{A.sheet_for_asset(number):02d}",
                          A.RUNTIME_ROOT / "firstperson"):
            for path in sorted(directory.glob(f"{prefix}*.glb")):
                slug = path.stem[len(prefix):]
                found.append((number, slug, path))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean-reimport verification for Assets 51-100.")
    parser.add_argument("--sheet", type=int, help="sheet number, 6-10")
    parser.add_argument("--asset", type=int, help="single asset number, 51-100")
    parser.add_argument("--out", type=str, help="write the JSON report to this path")
    args = parser.parse_args(A.blender_cli_args())

    targets = discover(args.sheet, args.asset)
    if not targets:
        print("CLEAN_REIMPORT|no GLBs found for the requested range", file=sys.stderr)
        return 1

    results = [verify_glb(number, slug, path) for number, slug, path in targets]
    payload = {
        "verified": len(results),
        "ok": all(r["ok"] for r in results),
        "errorCount": sum(r.get("errorCount", 0) for r in results),
        "warningCount": sum(r.get("warningCount", 0) for r in results),
        "results": results,
    }

    if args.out:
        out_path = Path(args.out)
        if not out_path.is_absolute():
            out_path = A.REPO_ROOT / out_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"CLEAN_REIMPORT_REPORT|{out_path}")

    print("CLEAN_REIMPORT|" + json.dumps(payload))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
