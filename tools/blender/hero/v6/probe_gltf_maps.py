"""What does THIS Blender need in order to write a normal + ORM into a GLB?

Every assumption in the bake plan is a guess until this prints it: whether
numpy is here, what the occlusion node group is called in 5.1, and -- the one
that actually decides the design -- whether a GENERATED image (one built in
memory from numpy, never written to disk) survives export at all.

    blender --factory-startup -b --python probe_gltf_maps.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
HERO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERO, "v5"))
sys.path.insert(0, HERO)

import bpy  # noqa: E402

print("\nblender %s" % (bpy.app.version_string,))
try:
    import numpy as np
    print("numpy   %s" % np.__version__)
except ImportError:
    print("numpy   ABSENT -- the whole synthesis plan changes")
    np = None

# What node groups can be added? The exporter reads occlusion out of a special
# group, and its name has moved between versions.
print("\nnode group candidates:")
import nodeitems_utils  # noqa: E402
try:
    from io_scene_gltf2.blender.com import gltf2_blender_conversion  # noqa
    print("  io_scene_gltf2 importable")
except Exception as exc:
    print("  io_scene_gltf2 import: %s" % exc)

# The documented way: a node group literally named "glTF Material Output".
# Making one and reading it back is the only proof that matters.
grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
try:
    grp.interface.new_socket("Occlusion", in_out="INPUT",
                             socket_type="NodeSocketFloat")
    print("  made 'glTF Material Output' with an Occlusion input (5.x interface API)")
except Exception as exc:
    print("  interface.new_socket failed: %s" % exc)

# --- build the smallest possible textured cube and export it -----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
grp.interface.new_socket("Occlusion", in_out="INPUT",
                         socket_type="NodeSocketFloat")

bpy.ops.mesh.primitive_cube_add(size=0.2)
ob = bpy.context.active_object
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.01)
bpy.ops.object.mode_set(mode="OBJECT")

W = 32


def gen(name, rgb, non_colour):
    img = bpy.data.images.new(name, W, W, alpha=False, float_buffer=False)
    px = [0.0] * (W * W * 4)
    for i in range(W * W):
        px[i * 4 + 0] = rgb[0]
        px[i * 4 + 1] = rgb[1]
        px[i * 4 + 2] = rgb[2]
        px[i * 4 + 3] = 1.0
    img.pixels.foreach_set(px)
    img.update()
    if non_colour:
        img.colorspace_settings.name = "Non-Color"
    print("  image %-8s source=%s packed=%s has_data=%s"
          % (name, img.source, bool(img.packed_file), img.has_data))
    return img


print("\ngenerated images:")
nrm = gen("probe_n", (0.5, 0.5, 1.0), True)
orm = gen("probe_orm", (0.7, 0.6, 0.0), True)

m = bpy.data.materials.new("ProbePique")
m.use_nodes = True
nt = m.node_tree
b = nt.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.2, 0.35, 0.5, 1.0)

tn = nt.nodes.new("ShaderNodeTexImage")
tn.image = nrm
nm = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])

to = nt.nodes.new("ShaderNodeTexImage")
to.image = orm
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(to.outputs["Color"], sep.inputs["Color"])
nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
nt.links.new(sep.outputs["Blue"], b.inputs["Metallic"])

gn = nt.nodes.new("ShaderNodeGroup")
gn.node_tree = grp
nt.links.new(sep.outputs["Red"], gn.inputs["Occlusion"])

ob.data.materials.append(m)

out = os.path.join(os.path.expanduser("~"), "probe_maps.glb")
bpy.ops.object.select_all(action="DESELECT")
ob.select_set(True)
bpy.context.view_layer.objects.active = ob
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB",
                          use_selection=True, export_apply=True,
                          export_yup=False)

import json  # noqa: E402
import struct  # noqa: E402

with open(out, "rb") as fh:
    data = fh.read()
jlen = struct.unpack_from("<I", data, 12)[0]
j = json.loads(data[20:20 + jlen].decode("utf-8"))
print("\nWROTE %d bytes" % len(data))
print("  images   %d  %s" % (len(j.get("images", [])),
                             [i.get("mimeType", i.get("uri")) for i in j.get("images", [])]))
print("  textures %d" % len(j.get("textures", [])))
for mat in j.get("materials", []):
    pbr = mat.get("pbrMetallicRoughness", {})
    print("  material %-14s normal=%s occlusion=%s metRough=%s"
          % (mat["name"],
             mat.get("normalTexture", {}).get("index"),
             mat.get("occlusionTexture", {}).get("index"),
             pbr.get("metallicRoughnessTexture", {}).get("index")))
print()
