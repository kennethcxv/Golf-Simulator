"""Phase 6+7: measured fitting + stocked fixture assemblies.

For every fixture: imports the EMPTY fixture GLB + product GLBs, places product
instances on the named slots (scale 1), numerically validates fit (bbox vs slot
capacity, neighbour overlap, fixture bounds), renders a warm retail preview and
saves a stocked .blend.  Emits:

  assets/pro_shop/manifests/placement_manifest.json
  assets/pro_shop/manifests/fit_validation_report.json
  assets/pro_shop/source/assembled/<fixture>_stocked_preview.blend
  assets/pro_shop/previews/stocked/<fixture>_stocked.png

Run: blender --background --factory-startup --python tools/blender/assemble_pf_stocked.py -- all
"""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
from mathutils import Vector
import lib_props as L
import proshop_lib as P

ROOT = P.ROOT
GLB = P.GLB_DIR
FRAG = P.FRAGMENT_DIR
ASSEMBLED = P.SOURCE_DIR / "assembled"
ASSEMBLED.mkdir(parents=True, exist_ok=True)

DIMS = {}
HANGING = set()
for f in FRAG.glob("*.json"):
    d = json.loads(f.read_text())
    DIMS[d["id"]] = d
    # hanging assets live below their origin
    if d.get("min_z", 0) < -0.05:
        HANGING.add(d["id"])

TINTS = {
    "cream": (0.88, 0.85, 0.74), "sage": (0.55, 0.66, 0.50), "navy": (0.24, 0.30, 0.48),
    "charcoal": (0.32, 0.33, 0.35), "khaki": (0.72, 0.60, 0.42), "white": (0.95, 0.95, 0.92),
    "pink": (0.90, 0.62, 0.60),
}


def tint_import(objs, tint):
    """Multiply a colour tint into every textured material of an import."""
    col = TINTS[tint]
    done = set()
    for o in objs:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.use_nodes or m.name in done:
                continue
            done.add(m.name)
            m2 = m.copy()
            m2.name = f"{m.name}_{tint}"
            slot.material = m2
            nt = m2.node_tree
            bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if not bsdf:
                continue
            base = bsdf.inputs["Base Color"]
            if base.links:
                src = base.links[0].from_socket
                try:
                    mix = nt.nodes.new("ShaderNodeMix")
                    mix.data_type = "RGBA"
                    mix.blend_type = "MULTIPLY"
                    mix.inputs["Factor"].default_value = 0.9
                    nt.links.new(src, mix.inputs[6])
                    mix.inputs[7].default_value = (*col, 1.0)
                    nt.links.new(mix.outputs[2], base)
                except Exception:
                    base.default_value = (*col, 1.0)
            else:
                base.default_value = (*col, 1.0)


def import_glb(aid, *, kind="products"):
    path = GLB / kind / f"{aid}.glb"
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None or o.parent not in new]
    root = next((r for r in roots if aid in r.name), roots[0])
    root.rotation_mode = "XYZ"   # importer leaves QUATERNION mode: euler writes are ignored otherwise
    return root, new


def find(objs_root, name_part):
    out = []
    def walk(o):
        if name_part in o.name:
            out.append(o)
        for c in o.children:
            walk(c)
    walk(objs_root)
    return out


def slot_map(fx_root):
    slots = {}
    def walk(o):
        if o.get("slot"):
            slots[o.name.split(".")[0]] = o
        for c in o.children:
            walk(c)
    walk(fx_root)
    return slots


def world_aabb(root):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    def walk(o):
        if o.type == "MESH" and not o.name.startswith("COL_") and "COL_" not in o.name:
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                mins.x, mins.y, mins.z = min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)
                maxs.x, maxs.y, maxs.z = max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)
        for c in o.children:
            walk(c)
    walk(root)
    return mins, maxs


PLACEMENTS = []
REPORT = {"fixtures": {}, "failures": []}


def place(fx, fx_root, slots, slot_name, product, *, kind="products", rotz=0.0, rotx=0.0, dz=0.0, dy=0.0, dx=0.0, tint=None, stack=1, hook=None):
    """Import + place product at slot (scale 1).  Returns placed roots."""
    entry = REPORT["fixtures"].setdefault(fx, {"placements": 0, "fit_fails": [], "overlaps": []})
    slot = slots.get(slot_name)
    if slot is None:
        REPORT["failures"].append(f"{fx}: missing slot {slot_name}")
        return []
    bpy.context.view_layer.update()
    base = slot.matrix_world.translation.copy()
    rot = slot.matrix_world.to_euler()
    placed = []
    if hook:
        hroot, _ = import_glb(hook, kind="fixtures")
        hroot.location = base
        hroot.rotation_euler = rot
        placed.append(hroot)
    d = DIMS.get(product, {})
    pd = d.get("dims_m", [0.1, 0.1, 0.1])
    maxd = (slot.get("max_w", 9), slot.get("max_d", 9), slot.get("max_h", 9))
    fits = pd[0] <= maxd[0] + 1e-6 and pd[1] <= maxd[1] + 1e-6 and pd[2] <= maxd[2] + 1e-6
    if not fits:
        entry["fit_fails"].append({"slot": slot_name, "product": product, "dims": pd, "max": list(maxd)})
    for s in range(stack):
        proot, objs = import_glb(product, kind=kind)
        if tint:
            tint_import(objs, tint)
        layer_h = (pd[1] if abs(rotx) > 0.5 else pd[2])   # laid-flat items stack by thickness
        z_off = dz + s * (layer_h + 0.0015)
        if hook:
            arm = DIMS.get(hook, {}).get("dims_m", [0, 0.13, 0])[1]
            proot.location = base + Vector((dx, -arm * 0.62, 0))
            proot.location.z = base.z + 0.014 - (0 if product in HANGING else pd[2] * 0.94)
        elif product in HANGING:
            proot.location = base + Vector((dx, dy, dz))
        else:
            proot.location = base + Vector((dx, dy, z_off))
        proot.rotation_euler = (rot.x + rotx, rot.y, rot.z + rotz)
        placed.append(proot)
        PLACEMENTS.append({
            "fixture": fx, "slot": slot_name, "product": product, "stack_index": s,
            "position": [round(v, 4) for v in proot.location],
            "rotation_z_deg": round(math.degrees(rot.z + rotz), 1),
            "scale": [1, 1, 1], "fits_capacity": fits, "tint": tint,
        })
        entry["placements"] += 1
    return placed


def overlap_check(fx, items):
    """AABB overlap among placed product roots (ignore stacked same-slot pairs)."""
    bpy.context.view_layer.update()   # the final placement's child matrices are stale otherwise
    entry = REPORT["fixtures"][fx]
    boxes = []
    for slotn, prod, root in items:
        mins, maxs = world_aabb(root)
        boxes.append((slotn, prod, mins, maxs))
    def cat(pid):
        return DIMS.get(pid, {}).get("category", "")
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i], boxes[j]
            if a[0] == b[0]:
                continue
            # garments shingle on a rail; round club heads nest at rack pitch —
            # AABB intersection is expected there, not a physical clash
            if cat(a[1]) == cat(b[1]) and cat(a[1]) in ("apparel", "clubs"):
                continue
            # plush soft goods may kiss on display (their AABBs exceed the cloth)
            soft = {"extras", "apparel", "gloves", "hats"}
            tol = 0.085 if (cat(a[1]) in soft and cat(b[1]) in soft) else 0.004
            ox = min(a[3].x, b[3].x) - max(a[2].x, b[2].x)
            oy = min(a[3].y, b[3].y) - max(a[2].y, b[2].y)
            oz = min(a[3].z, b[3].z) - max(a[2].z, b[2].z)
            if ox > tol and oy > tol and oz > tol:
                entry["overlaps"].append({"a": f"{a[0]}:{a[1]}", "b": f"{b[0]}:{b[1]}",
                                          "overlap_m": [round(ox, 4), round(oy, 4), round(oz, 4)]})


TRACK = []


def T(placed_list, slotn, prod):
    for r in placed_list:
        TRACK.append((slotn, prod, r))


def assemble(fx, plan):
    P.reset_scene()
    TRACK.clear()
    fx_root, _ = import_glb(fx, kind="fixtures")
    slots = slot_map(fx_root)
    for row in plan:
        placed = place(fx, fx_root, slots, *row[0:2], **(row[2] if len(row) > 2 else {}))
        prods = [p for p in placed if fx not in p.name]
        T([p for p in placed], row[0], row[1])
    overlap_check(fx, TRACK)
    # save + render
    blend = ASSEMBLED / f"{fx}_stocked_preview.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), check_existing=False)
    P.render_preview(fx, fx_root, subdir="stocked", name=f"{fx}_stocked", warm=True, azimuth=24, elevation=9)
    print(f"STOCKED|{fx}|placements={REPORT['fixtures'][fx]['placements']}")


def plan_apparel_wall():
    up = [("APPAREL_HANGER_SLOT_01", "pf_polo_hanging", {"tint": "cream"}),
          ("APPAREL_HANGER_SLOT_02", "pf_quarterzip_hanging", {}),
          ("APPAREL_HANGER_SLOT_03", "pf_hoodie_hanging", {}),
          ("APPAREL_HANGER_SLOT_04", "pf_jacket_hanging", {}),
          ("APPAREL_HANGER_SLOT_05", "pf_pants_hanging", {}),
          ("APPAREL_HANGER_SLOT_06", "pf_pants_hanging", {"tint": "charcoal"})]
    lo = [("APPAREL_HANGER_SLOT_07", "pf_shorts_hanging", {}),
          ("APPAREL_HANGER_SLOT_08", "pf_polo_hanging", {"tint": "sage"}),
          ("APPAREL_HANGER_SLOT_09", "pf_shorts_hanging", {"tint": "khaki"}),
          ("APPAREL_HANGER_SLOT_10", "pf_polo_hanging", {"tint": "navy"}),
          ("APPAREL_HANGER_SLOT_11", "pf_shorts_hanging", {"tint": "cream"}),
          ("APPAREL_HANGER_SLOT_12", "pf_quarterzip_hanging", {"tint": "navy"})]
    hangers = [(s, "pf_hanger_wood" if i % 2 == 0 else "pf_hanger_metal", {}) for i, (s, _p, _o) in enumerate(up)]
    hangers += [(s, "pf_hanger_clip", {}) for (s, _p, _o) in lo[0::2]]
    folded = [("APPAREL_FOLDED_SLOT_01", "pf_polo_folded", {"stack": 3}),
              ("APPAREL_FOLDED_SLOT_02", "pf_quarterzip_folded", {"stack": 3, "tint": "navy"}),
              ("APPAREL_FOLDED_SLOT_03", "pf_pants_folded", {"stack": 3, "tint": "charcoal"}),
              ("APPAREL_FOLDED_SLOT_04", "pf_shorts_folded", {"stack": 3})]
    return hangers + up + lo + folded


def plan_hat_wall():
    tints = ["cream", "sage", "navy", "charcoal"]
    plan = []
    n = 0
    for row, prod in enumerate(["pf_hat_structured", "pf_hat_performance", "pf_hat_visor", "pf_hat_bucket"]):
        for i in range(4):
            n += 1
            if prod == "pf_hat_bucket" and i in (1, 3):
                continue
            plan.append((f"HAT_SLOT_{n:02d}", prod, {"tint": tints[i]}))
    return plan


def plan_slatwall():
    hooked = ["pf_teebox_wood", "pf_teebox_performance", "pf_teebox_bamboo", "pf_teebox_prolaunch",
              "pf_glove_white_card", "pf_glove_black_card", "pf_glove_navy_card",
              "pf_glove_sage_card", "pf_marker_coin_card", "pf_marker_enamel_card", "pf_marker_clip_card",
              "pf_marker_engraved_card", "pf_divot_classic_card", "pf_divot_folding_black_card",
              "pf_divot_slim_card", "pf_divot_folding_sage_card", "pf_towel_card", "pf_giftcard",
              "pf_towel_card", "pf_giftcard", "pf_towel_card"]
    plan = [(f"HOOK_SLOT_{i+1:02d}", prod, {"hook": "pf_hook_medium"}) for i, prod in enumerate(hooked)]
    plan += [("SHELF_SLOT_A01", "pf_bottle_squeeze", {}), ("SHELF_SLOT_A02", "pf_bottle_insulated", {}),
             ("SHELF_SLOT_A03", "pf_bottle_sport", {}), ("SHELF_SLOT_A04", "pf_bottle_slim", {}),
             ("SHELF_SLOT_A05", "pf_belt_coiled", {}),
             ("SHELF_SLOT_B01", "pf_sunglasses_box", {}), ("SHELF_SLOT_B02", "pf_belt_coiled", {}),
             ("SHELF_SLOT_B03", "pf_teebox_wood", {}), ("SHELF_SLOT_B04", "pf_divot_classic", {})]
    return plan


def plan_club_rack():
    longs = ["pf_driver_aero_max", "pf_driver_forge_tour", "pf_driver_vantage_pro", "pf_driver_elevate_lite",
             "pf_wood_aero_max_3", "pf_wood_forge_pro_5", "pf_wood_vantage_xlt_7", "pf_wood_elevate_tour_3",
             "pf_hybrid_aero_2h", "pf_hybrid_vantage_3h", "pf_hybrid_forge_4h", "pf_hybrid_elevate_5h"]
    shorts = ["pf_iron_players_7", "pf_iron_cavity_7", "pf_iron_gameimp_7", "pf_wedge_sand_56",
              "pf_putter_blade", "pf_putter_mallet_spider"]
    # alternate depth/turn so neighbouring heads nest like the reference rack
    return [(f"CLUB_SLOT_{i+1:02d}", p, {"rotz": math.radians(6 if i % 2 else -6), "dy": 0.022 if i % 2 else -0.012})
            for i, p in enumerate(longs + shorts)]


def plan_bag_display():
    bags = ["pf_bag_stand", "pf_bag_cart", "pf_bag_staff", "pf_bag_sunday"] * 2
    return [(f"BAG_SLOT_{i+1:02d}", b,
             {"dy": 0.05 if b == "pf_bag_stand" else (0.04 if b == "pf_bag_sunday" else 0.0),
              "rotz": math.radians(14) if b == "pf_bag_sunday" else 0.0})
            for i, b in enumerate(bags)]


def plan_ball_shelf():
    plan = []
    rows = {"A": "pf_ballbox_tour12", "B": "pf_ballbox_soft12", "C": "pf_ballbox_range12", "D": "pf_ballsleeve_value3"}
    for letter, prod in rows.items():
        for i in range(6):
            plan.append((f"SHELF_SLOT_{letter}{i+1:02d}", prod, {}))
    plan += [("SHELF_SLOT_Z01", "pf_ballsleeve_value3", {}), ("SHELF_SLOT_Z02", "pf_ballsleeve_value3", {}),
             ("SHELF_SLOT_Z03", "pf_ball_loose_white", {}), ("SHELF_SLOT_Z04", "pf_ball_loose_yellow", {}),
             ("SHELF_SLOT_Z05", "pf_ballbox_tour12", {}), ("SHELF_SLOT_Z06", "pf_ballbox_soft12", {})]
    return plan


def plan_snack_shelf():
    return [("SHELF_SLOT_A01", "pf_snack_granola_box", {}), ("SHELF_SLOT_A02", "pf_snack_chips", {}),
            ("SHELF_SLOT_A03", "pf_snack_granola_box", {}), ("SHELF_SLOT_A04", "pf_snack_chips", {}),
            ("SHELF_SLOT_A05", "pf_snack_trailmix", {}),
            ("SHELF_SLOT_B01", "pf_snack_trailmix", {}), ("SHELF_SLOT_B02", "pf_snack_protein_bar", {}),
            ("SHELF_SLOT_B03", "pf_snack_protein_bar", {}), ("SHELF_SLOT_B04", "pf_snack_protein_bar", {}),
            ("SHELF_SLOT_B05", "pf_snack_chips", {}),
            ("SHELF_SLOT_C01", "pf_snack_granola_box", {}), ("SHELF_SLOT_C02", "pf_snack_trailmix", {}),
            ("SHELF_SLOT_C03", "pf_snack_chips", {}), ("SHELF_SLOT_C04", "pf_snack_granola_box", {}),
            ("SHELF_SLOT_C05", "pf_snack_trailmix", {}),
            ("SHELF_SLOT_Z01", "pf_bottle_squeeze", {}), ("SHELF_SLOT_Z02", "pf_bottle_insulated", {}),
            ("SHELF_SLOT_Z03", "pf_bottle_sport", {}), ("SHELF_SLOT_Z04", "pf_bottle_slim", {}),
            ("SHELF_SLOT_Z05", "pf_bottle_squeeze", {})]


def plan_rangefinder():
    return [("SHELF_SLOT_A01", "pf_rangefinder_box", {}), ("SHELF_SLOT_A02", "pf_rangefinder_box", {}),
            ("SHELF_SLOT_A03", "pf_rangefinder_box", {}), ("SHELF_SLOT_A04", "pf_rangefinder_box", {}),
            ("SHELF_SLOT_B01", "pf_rangefinder_stealth", {}), ("SHELF_SLOT_B02", "pf_rangefinder_armor", {}),
            ("SHELF_SLOT_B03", "pf_rangefinder_tour", {}), ("SHELF_SLOT_B04", "pf_rangefinder_field", {}),
            ("SHELF_SLOT_C01", "pf_sunglasses", {}), ("SHELF_SLOT_C02", "pf_sunglasses_box", {}),
            ("SHELF_SLOT_C03", "pf_scorecard_booklet", {}), ("SHELF_SLOT_C04", "pf_scorecard_course", {}),
            ("SHELF_SLOT_Z01", "pf_scorecard_holeguide", {"stack": 3}), ("SHELF_SLOT_Z02", "pf_scorecard_mini", {"stack": 4}),
            ("SHELF_SLOT_Z03", "pf_scorecard_booklet", {}), ("SHELF_SLOT_Z04", "pf_pencil", {})]


def plan_shoes():
    shoes = ["pf_shoe_spiked_pro", "pf_shoe_knit_flex", "pf_shoe_saddle_classic", "pf_shoe_waterproof_trail"]
    plan = []
    ln = rn = 0
    for tier in range(3):
        for i in range(4):
            left = (i % 2 == 0)
            if left:
                ln += 1
                nm = f"SHOE_LEFT_SLOT_{ln:02d}"
            else:
                rn += 1
                nm = f"SHOE_RIGHT_SLOT_{rn:02d}"
            plan.append((nm, shoes[(tier + i) % 4], {}))
    plan += [("SHOE_LEFT_SLOT_90", "pf_shoe_spiked_pro", {}), ("SHOE_RIGHT_SLOT_90", "pf_shoe_knit_flex", {})]
    return plan


def plan_center_table():
    return [("TABLE_SLOT_01", "pf_polo_folded", {"stack": 4, "tint": "cream"}),
            ("TABLE_SLOT_02", "pf_polo_folded", {"stack": 4, "tint": "sage"}),
            ("TABLE_SLOT_03", "pf_polo_folded", {"stack": 4, "tint": "navy"}),
            ("TABLE_SLOT_04", "pf_quarterzip_folded", {"stack": 3}),
            ("TABLE_SLOT_05", "pf_pants_folded", {"stack": 3, "tint": "charcoal"}),
            ("TABLE_SLOT_06", "pf_pants_folded", {"stack": 3, "tint": "sage"}),
            ("TABLE_SLOT_07", "pf_hat_structured", {}),
            ("TABLE_SLOT_08", "pf_hat_bucket", {}),
            ("SHELF_SLOT_L01", "pf_pants_folded", {"stack": 2}),
            ("SHELF_SLOT_L02", "pf_shorts_folded", {"stack": 3}),
            ("SHELF_SLOT_L03", "pf_polo_folded", {"stack": 2, "tint": "charcoal"}),
            ("SHELF_SLOT_L04", "pf_towel_folded", {"stack": 2, "rotz": math.radians(90)})]


def plan_gondola():
    # rows per side: slots 1-5 / 16-20 top (z1.32), 6-10 / 21-25 mid, 11-15 / 26-30 bottom.
    # tall soft goods (headcovers 0.36, towel cards 0.32) go on the BOTTOM row so
    # nothing hangs beneath them; short cards ride the upper rows.
    top = ["pf_glove_white_card", "pf_marker_enamel_card", "pf_divot_classic_card", "pf_marker_coin_card", "pf_glove_sage_card",
           "pf_glove_black_card", "pf_marker_clip_card", "pf_divot_slim_card", "pf_marker_engraved_card", "pf_glove_navy_card"]
    mid = ["pf_teebox_wood", "pf_teebox_performance", "pf_giftcard", "pf_teebox_bamboo", "pf_teebox_prolaunch",
           "pf_teebox_bamboo", "pf_divot_folding_black_card", "pf_giftcard", "pf_divot_folding_sage_card", "pf_teebox_wood"]
    bot = ["pf_headcover_driver", "pf_towel_card", "pf_headcover_wood", "pf_towel_card", "pf_headcover_driver",
           "pf_headcover_wood", "pf_towel_card", "pf_headcover_driver", "pf_towel_card", "pf_headcover_wood"]
    order = {}
    for k in range(5):
        order[1 + k] = top[k]; order[16 + k] = top[5 + k]
        order[6 + k] = mid[k]; order[21 + k] = mid[5 + k]
        order[11 + k] = bot[k]; order[26 + k] = bot[5 + k]
    plan = [(f"HOOK_SLOT_{i:02d}", order[i], {"hook": "pf_hook_medium"}) for i in sorted(order)]
    plan += [("SHELF_SLOT_GF01", "pf_shorts_folded", {"stack": 2}), ("SHELF_SLOT_GF02", "pf_polo_folded", {"stack": 2, "tint": "sage"}),
             ("SHELF_SLOT_GF03", "pf_shorts_folded", {"stack": 2, "tint": "navy"}), ("SHELF_SLOT_GF04", "pf_polo_folded", {"stack": 2, "tint": "cream"}),
             ("SHELF_SLOT_GB01", "pf_polo_folded", {"stack": 2, "tint": "navy"}), ("SHELF_SLOT_GB02", "pf_shorts_folded", {"stack": 2, "tint": "khaki"}),
             ("SHELF_SLOT_GB03", "pf_polo_folded", {"stack": 2, "tint": "charcoal"}), ("SHELF_SLOT_GB04", "pf_shorts_folded", {"stack": 2}),
             ("TABLE_SLOT_T01", "pf_polo_folded", {"stack": 3, "tint": "cream"}),
             ("TABLE_SLOT_T02", "pf_hat_performance", {}),
             ("TABLE_SLOT_T03", "pf_towel_folded", {"stack": 2, "rotz": math.radians(90)}),
             ("BARREL_SLOT_01", "pf_umbrella_closed", {}),]
    return plan


def plan_checkout():
    flat = math.radians(-90)
    return [("COUNTER_SLOT_01", "pf_scorecard_mini", {"stack": 8, "rotx": flat}),
            ("COUNTER_SLOT_02", "pf_scorecard_holeguide", {"stack": 6, "rotx": flat}),
            ("COUNTER_SLOT_02", "pf_scorecard_course", {"dx": 0.02, "dy": 0.18}),
            ("COUNTER_SLOT_03", "pf_pencil", {}),
            ("COUNTER_SLOT_03", "pf_giftcard", {"dx": -0.05, "dy": 0.1, "rotx": flat})]


PLANS = {
    "pf_fixture_apparel_wall": plan_apparel_wall,
    "pf_fixture_hat_wall": plan_hat_wall,
    "pf_fixture_accessory_slatwall": plan_slatwall,
    "pf_fixture_club_rack": plan_club_rack,
    "pf_fixture_bag_display": plan_bag_display,
    "pf_fixture_ball_shelf": plan_ball_shelf,
    "pf_fixture_snack_shelf": plan_snack_shelf,
    "pf_fixture_rangefinder_display": plan_rangefinder,
    "pf_fixture_shoe_display": plan_shoes,
    "pf_fixture_center_table": plan_center_table,
    "pf_fixture_freestanding_gondola": plan_gondola,
    "pf_fixture_checkout_counter_shop": plan_checkout,
}


def main():  # noqa: C901
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    which = [a for a in argv if a in PLANS] or list(PLANS)
    for fx in which:
        try:
            assemble(fx, PLANS[fx]())
        except Exception:
            import traceback
            traceback.print_exc()
            REPORT["failures"].append(f"{fx}: exception during assembly")
            print(f"STOCK_FAILED|{fx}")
    # write manifests
    (P.MANIFEST_DIR / "placement_manifest.json").write_text(json.dumps({
        "note": "products placed at scale 1 on named fixture slots; capacities in fixture GLB slot extras",
        "placements": PLACEMENTS}, indent=1))
    total_fail = sum(len(v["fit_fails"]) for v in REPORT["fixtures"].values())
    total_over = sum(len(v["overlaps"]) for v in REPORT["fixtures"].values())
    REPORT["summary"] = {"placements": len(PLACEMENTS), "fit_failures": total_fail,
                         "overlaps": total_over, "assembly_failures": len(REPORT["failures"])}
    (P.MANIFEST_DIR / "fit_validation_report.json").write_text(json.dumps(REPORT, indent=1))
    print(f"FIT_REPORT|placements={len(PLACEMENTS)}|fit_failures={total_fail}|overlaps={total_over}")


if __name__ == "__main__":
    main()
