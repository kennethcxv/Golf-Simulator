"""Requirement 2 (Goal 17): IS THE ASSET THE GAME LOADS THE ASSET IN THE SOURCE?

The brief is explicit that six rounds of tool measurements may be explained by a
stale packed GLB, and this repo does ship two copies of every asset: a canonical
one under assets/ and the runtime one under vendor/models/ that the game
actually fetches. They are not byte-identical (the canonical carries JPEG
textures the runtime does not), so a hash comparison between THOSE two answers
nothing.

The question that matters is whether the runtime GLB still describes the same
rig as the .blend beside it. Byte equality cannot answer that either - two runs
of Blender's exporter differ in ordering and timestamps. So this dumps the
CONTENT that the rig depends on, and a node-side script dumps the same from the
shipped GLB. Anything that disagrees is a stale asset.

  blender --background <file.blend> --python tools/blender/dump_fp_source.py -- <out.json>
"""
import json
import sys
from pathlib import Path

import bpy  # noqa: E402  (only exists inside Blender)


def out_path() -> Path:
    argv = sys.argv
    if "--" in argv:
        tail = argv[argv.index("--") + 1:]
        if tail:
            return Path(tail[0])
    return Path("blend-dump.json")


def summarise() -> dict:
    objects = []
    for obj in bpy.data.objects:
        entry = {
            "name": obj.name,
            "type": obj.type,
            "parent": obj.parent.name if obj.parent else None,
            # World position to 4 dp: a socket that moved is the whole point of
            # this dump, and 0.1 mm is well below anything that matters.
            "world": [round(v, 4) for v in obj.matrix_world.translation],
        }
        if obj.type == "MESH" and obj.data:
            entry["verts"] = len(obj.data.vertices)
            entry["polys"] = len(obj.data.polygons)
            entry["materials"] = sorted({s.material.name for s in obj.material_slots if s.material})
        objects.append(entry)
    objects.sort(key=lambda e: e["name"])
    actions = sorted(a.name for a in bpy.data.actions)
    return {
        "blend": bpy.data.filepath,
        "objectCount": len(objects),
        "objects": objects,
        "actions": actions,
        "meshTotalVerts": sum(e.get("verts", 0) for e in objects),
        "sockets": {
            e["name"]: e["world"] for e in objects if e["name"].startswith("SOCKET_")
        },
    }


def main() -> None:
    target = out_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(summarise(), indent=1), encoding="utf-8")
    print(f"BLEND_DUMP|{target}")


main()
