"""HERO ASSET — THE CASH REGISTER / TILL. Drawer, monitor, body.

The reward loop. The DRAWER is the deliverable: coins and notes are placed INTO
it and land on each other, so it is a real compartment with real dividers and
its interior is measured off the geometry, exactly as the checkout bag's was.
A till whose drawer is a decal fixes nothing.

The monitor is an EMISSIVE screen, so this asset renders in both Cycles and
EEVEE — the game draws closer to EEVEE, and a screen judged only in a path
tracer has been judged in the engine that flatters it.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_register.py -- [cycles] [break-dividers]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "register")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "cash_register.glb")

BODY = (0.4400, 0.4600, 0.1750)     # w, d, h of the till base
DRAWER_W = 0.4060
DRAWER_D = 0.3900
DRAWER_H = 0.1080
WALL = 0.0060
OPEN = 0.2600                        # how far the drawer is pulled out

NOTE_BAYS = 4                        # note wells across the front
COIN_BAYS = 5                        # coin wells across the back
COIN_SPLIT = 0.42                    # share of depth given to coin wells


def tray():
    """The drawer as a real tray: floor, four walls, and a rim."""
    hw, hd = DRAWER_W * 0.5, DRAWER_D * 0.5
    outer = []
    for (x, y) in ((hw, hd), (-hw, hd), (-hw, -hd), (hw, -hd)):
        outer.append((x, y))
    verts, faces = [], []
    for z in (0.0, DRAWER_H):
        for (x, y) in outer:
            verts.append(Vector((x, y, z)))
    for i in range(4):
        j = (i + 1) % 4
        faces.append((i, j, j + 4, i + 4))
    faces.append((3, 2, 1, 0))
    ob = HS.mesh_from("DrawerShell", verts, faces)
    sol = ob.modifiers.new("Wall", "SOLIDIFY")
    sol.thickness = WALL
    sol.offset = -1.0
    sol.use_rim = True
    return HS.apply_mods(ob)


def dividers(broken=False):
    """The dividers: note bays across the front, coin wells across the back.

    These are the "many small things on one big thing" class -- every divider's
    root must be INSIDE the drawer floor, or the money lands in a tray that has
    lines drawn on it.
    """
    parts = []
    hw = DRAWER_W * 0.5 - WALL
    hd = DRAWER_D * 0.5 - WALL
    split_y = -hd + DRAWER_D * COIN_SPLIT
    root_z = WALL - 0.0008   # bottoms land 2 mm INSIDE the 6 mm floor
    if broken:
        # THE DELIBERATELY BROKEN VARIANT: every divider lifted off the floor.
        # It still looks like a divided drawer from above, which is why it ships.
        root_z += 0.020

    # the rail between coin wells and note bays
    # Dividers run WALL TO WALL deliberately. Shrinking them clear of the walls
    # looked like the fix for a zero-depth reading and was the opposite: the
    # tray is hollow, so its CAVITY reads as outside the shell, and the corners
    # that were scoring were the ones buried in the wall material. Pulling them
    # into open air took the reading from +1.46 mm to -0.04.
    rail = HS.box("Div_Rail", (0, split_y, root_z + 0.030),
                  (hw * 2, 0.0060, 0.060 + 0.0070))
    parts.append(HS.apply_mods(rail))

    # note bays: walls running front-to-back
    for i in range(1, NOTE_BAYS):
        x = -hw + (hw * 2) * i / NOTE_BAYS
        d = (hd - split_y)
        b = HS.box(f"Div_Note_{i}", (x, split_y + d * 0.5, root_z + 0.026),
                   (0.0055, d, 0.052 + 0.0070))
        parts.append(HS.apply_mods(b))

    # coin wells: walls running left-to-right across the back strip
    for i in range(1, COIN_BAYS):
        x = -hw + (hw * 2) * i / COIN_BAYS
        d = (split_y + hd)
        b = HS.box(f"Div_Coin_{i}", (x, -hd + d * 0.5, root_z + 0.020),
                   (0.0055, d, 0.040 + 0.0070))
        parts.append(HS.apply_mods(b))
    return parts, split_y, root_z


def build(broken=False):
    p = {}

    body = HS.box("TillBody", (0, 0, BODY[2] * 0.5), BODY, bevel=0.0055, segments=2)
    p["body"] = HS.apply_mods(body)

    p["drawer"] = tray()
    p["drawer"].location = Vector((0, -OPEN, 0.0110))
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    p["drawer"].select_set(True)
    bpy.context.view_layer.objects.active = p["drawer"]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    divs, split_y, root_z = dividers(broken=broken)
    for d in divs:
        # += , not = . HS.box places the box by setting the OBJECT's location,
        # so assigning here threw every divider's own position away and stacked
        # all eight on the same spot 26 mm outside the tray.
        d.location += Vector((0, -OPEN, 0.0110))
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for d in divs:
        d.select_set(True)
    bpy.context.view_layer.objects.active = divs[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    p["dividers"] = divs
    p["split_y"] = split_y - OPEN

    # ---- drawer face and pull
    # The bevel rounds the back edge, so the face's rearmost plane is inboard of
    # its nominal half-thickness -- flush by arithmetic was 4.3 mm short in fact.
    face = HS.box("DrawerFace", (0, -OPEN - DRAWER_D * 0.5 + 0.0060, 0.0620),
                  (BODY[0] * 0.96, 0.0180, 0.1240), bevel=0.0040, segments=2)
    p["face"] = HS.apply_mods(face)
    pull = HS.box("DrawerPull", (0, -OPEN - DRAWER_D * 0.5 - 0.0090, 0.0620),
                  (0.1600, 0.0140, 0.0220), bevel=0.0050, segments=2)
    p["pull"] = HS.apply_mods(pull)

    # ---- monitor on a stalk
    stalk = HS.cylinder("MonStalk", (0, 0.1250, BODY[2] + 0.0560), 0.0180, 0.1120,
                        verts=14)
    p["stalk"] = stalk
    tilt = math.radians(-16.0)
    shell = HS.box("MonShell", (0, 0.1250, BODY[2] + 0.1780),
                   (0.3400, 0.0300, 0.2300), bevel=0.0060, segments=2)
    shell.rotation_euler = (tilt, 0, 0)
    p["shell"] = HS.apply_mods(shell)
    screen = HS.box("MonScreen", (0, 0.1250 - 0.0175, BODY[2] + 0.1780),
                    (0.3060, 0.0030, 0.1960))
    screen.rotation_euler = (tilt, 0, 0)
    p["screen"] = HS.apply_mods(screen)

    # ---- keypad block
    keys = HS.box("Keypad", (0, -0.1150, BODY[2] + 0.0100),
                  (0.2400, 0.1500, 0.0200), bevel=0.0035, segments=2)
    p["keypad"] = HS.apply_mods(keys)

    shellmat = HS.pbr("TillShell", (0.052, 0.056, 0.062), roughness=0.46)
    trim = HS.pbr("TillTrim", (0.026, 0.028, 0.032), roughness=0.38)
    inner = HS.pbr("TillDrawer", (0.030, 0.033, 0.038), roughness=0.72)
    glow = HS.pbr("TillScreen", (0.030, 0.120, 0.075), roughness=0.22)
    em = glow.node_tree.nodes["Principled BSDF"]
    if "Emission Color" in em.inputs:
        em.inputs["Emission Color"].default_value = (0.075, 0.520, 0.330, 1.0)
        em.inputs["Emission Strength"].default_value = 2.4
    for o in (p["body"], p["face"], p["shell"]):
        o.data.materials.append(shellmat)
    for o in (p["pull"], p["stalk"], p["keypad"]):
        o.data.materials.append(trim)
    p["drawer"].data.materials.append(inner)
    for d in divs:
        d.data.materials.append(inner)
    p["screen"].data.materials.append(glow)
    return p


def measure_drawer(drawer, divs, split_y):
    """Read the wells off the GEOMETRY -- the same discipline as the bag."""
    vs = [drawer.matrix_world @ v.co for v in drawer.data.vertices]
    xs = sorted(v.x for v in vs)
    ys = sorted(v.y for v in vs)
    zs = sorted(v.z for v in vs)
    inner_w = DRAWER_W - WALL * 2
    inner_d = DRAWER_D - WALL * 2
    note_d = (ys[-1] - WALL) - split_y
    coin_d = split_y - (ys[0] + WALL)
    return {
        "outer": (xs[-1] - xs[0], ys[-1] - ys[0], zs[-1] - zs[0]),
        "inner": (inner_w, inner_d, DRAWER_H - WALL),
        "note_bay": ((inner_w - (NOTE_BAYS - 1) * 0.0055) / NOTE_BAYS, note_d),
        "coin_bay": ((inner_w - (COIN_BAYS - 1) * 0.0055) / COIN_BAYS, coin_d),
        "note_wall": 0.052, "coin_wall": 0.040,
    }


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = "break-dividers" in args
    suffix = "-BROKEN" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=200 if engine == "CYCLES" else 128)
    p = build(broken=broken)

    HS.assert_rooted(p["dividers"], p["drawer"], "drawer dividers",
                     min_verts=3, min_depth=0.0015)
    HS.assert_boxes_overlap(p["face"], p["drawer"],
                            "the drawer face must be on the drawer")
    HS.assert_touching(p["pull"], p["face"], "the pull must be on the face",
                       max_gap=0.0020)
    HS.assert_touching(p["stalk"], p["body"], "the monitor stalk must meet the body",
                       max_gap=0.0025)
    HS.assert_touching(p["screen"], p["shell"], "the screen must be in its bezel",
                       max_gap=0.0025)

    m = measure_drawer(p["drawer"], p["dividers"], p["split_y"])
    print("")
    print("  === THE DRAWER, measured off the tray (YARDS) ===")
    print(f"  outer               {m['outer'][0]:.4f} x {m['outer'][1]:.4f} x {m['outer'][2]:.4f}")
    print(f"  interior            {m['inner'][0]:.4f} x {m['inner'][1]:.4f} x {m['inner'][2]:.4f}")
    print(f"  {NOTE_BAYS} note bays        {m['note_bay'][0]:.4f} x {m['note_bay'][1]:.4f}"
          f"  wall {m['note_wall']:.3f} high")
    print(f"  {COIN_BAYS} coin wells       {m['coin_bay'][0]:.4f} x {m['coin_bay'][1]:.4f}"
          f"  wall {m['coin_wall']:.3f} high")
    print("")

    subject = [p["body"], p["drawer"], p["face"], p["pull"], p["stalk"],
               p["shell"], p["screen"], p["keypad"]] + p["dividers"]
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, 4 materials) "
          f"— the hand is 5,179")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.18)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"register{suffix}", views=8,
                     elevation=24.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"register{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -118, 28), ("drawer", -90, 62),
                          ("front", -90, 10), ("side", 0, 12)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"register{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"register{suffix}-silhouette.png"),
                         res=(900, 900))

    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (BODY[0] / 0.34) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, -118, 26), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"register{suffix}-apparent.png"), res=(1600, 900))

    if not broken and engine == "CYCLES":
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


main()
