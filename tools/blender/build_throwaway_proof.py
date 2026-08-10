# H7 end-to-end proof asset — a range-ball bucket, built THROUGH golf-assets,
# then deleted. Not shipped. Every golf-assets step must fire:
#   palette body + material break on a real boundary (metal band) + specular
#   event, overlap assertion at build time, headless look-render (the MCP
#   socket is wedged tonight), GLB export for the validator gate.
#
#   "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background \
#     --python tools/blender/build_throwaway_proof.py
import bpy
import math
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'vendor', 'models', '_throwaway')
QA_DIR = os.path.join(ROOT, 'qa', 'throwaway')
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(QA_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def make_material(name, rgba, metallic=0.0, roughness=0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    # Workbench look-renders read the viewport color, not the node tree —
    # without this the look step shows grey and checks nothing about palette.
    mat.diffuse_color = rgba
    return mat

# Palette: clubhouse green body (ART_BIBLE dark green family), brass band.
body_mat = make_material('BucketBody', (0.107, 0.180, 0.079, 1.0), 0.0, 0.55)
band_mat = make_material('BrassBand', (0.55, 0.42, 0.18, 1.0), 1.0, 0.25)

# Body: tapered cylinder (bucket), rotation mode QUATERNION per the pipeline.
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.14, depth=0.26, location=(0, 0, 0.13))
body = bpy.context.active_object
body.name = 'MESH_BucketBody'
body.rotation_mode = 'QUATERNION'
body.data.materials.append(body_mat)
# taper: scale the bottom ring in
for v in body.data.vertices:
    if v.co.z < 0:
        v.co.x *= 0.78
        v.co.y *= 0.78

# Brass band: a torus wrapped around the upper body — the material break on a
# real part boundary, and the specular event.
bpy.ops.mesh.primitive_torus_add(major_radius=0.145, minor_radius=0.008, location=(0, 0, 0.22))
band = bpy.context.active_object
band.name = 'MESH_BrassBand'
band.rotation_mode = 'QUATERNION'
band.data.materials.append(band_mat)

# BUILD-TIME OVERLAP ASSERTION (the divider-in-carcass class): the band's
# inner radius must wrap OUTSIDE the body wall at its height, and the band
# must not float (gap > 6mm fails too).
body_r_at_band = 0.14  # untapered above z=0
band_inner = 0.145 - 0.008
band_outer = 0.145 + 0.008
gap = band_inner - body_r_at_band
assert -0.004 <= gap <= 0.006, f'OVERLAP ASSERTION FAIL: band gap {gap:.4f}m (buried if < -4mm, floating if > 6mm)'
print(f'overlap assertion ok: band gap {gap*1000:.1f}mm, outer {band_outer:.3f}m')

# Headless look-render (workbench: deterministic, no GPU drama) — the LOOK
# step; the PNG gets Read and judged before export.
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 800
scene.render.resolution_y = 600
cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
cam.location = (0.62, -0.62, 0.42)
cam.rotation_euler = (math.radians(70), 0, math.radians(45))
scene.camera = cam
scene.render.filepath = os.path.join(QA_DIR, 'viewport-look.png')
bpy.ops.render.render(write_still=True)
print('look-render written:', scene.render.filepath)

# Export GLB (only the two meshes, not the camera).
cam.select_set(False)
body.select_set(True)
band.select_set(True)
glb_path = os.path.join(OUT_DIR, 'range_bucket_throwaway.glb')
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', use_selection=True)
print('exported:', glb_path)
