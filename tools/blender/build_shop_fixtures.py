# PRO-SHOP FIXTURE PACK
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
#       --factory-startup --python tools/blender/build_shop_fixtures.py
#
# Project-owned, repeatable geometry for the pro-shop overhaul. One Blender unit
# is one game yard. Models are Z-up in Blender and export Y-up to glTF. Blender
# -Y is the customer-facing game +Z side, matching the existing asset pipeline.
# Origins sit at the fixture's floor centre; moving parts remain separate game
# objects (the cold-case door is deliberately static display geometry).

import bpy
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_register import wipe, mat, cube, cyl, assign, finish  # noqa: E402
from build_merch import build_bag, materials as merch_materials  # noqa: E402
from lib_model import bevel  # noqa: E402


def fixture_materials():
    return {
        'wood': mat('M_wood', (0.29, 0.20, 0.13), rough=0.58),
        'darkwood': mat('M_darkwood', (0.16, 0.10, 0.065), rough=0.62),
        'oak': mat('M_oak', (0.55, 0.39, 0.23), rough=0.72),
        'green': mat('M_green', (0.06, 0.22, 0.13), rough=0.70),
        'sage': mat('M_sage', (0.38, 0.48, 0.39), rough=0.88),
        'cream': mat('M_cream', (0.89, 0.85, 0.74), rough=0.82),
        'charcoal': mat('M_charcoal', (0.10, 0.11, 0.11), rough=0.52),
        'steel': mat('M_steel', (0.44, 0.47, 0.48), rough=0.32, metal=0.90),
        'brass': mat('M_brass', (0.63, 0.47, 0.12), rough=0.34, metal=0.82),
        'glass': mat('M_glass', (0.72, 0.85, 0.82), rough=0.08, metal=0.05),
        'rubber': mat('M_rubber', (0.035, 0.045, 0.038), rough=0.95),
        'white': mat('M_white', (0.94, 0.92, 0.85), rough=0.62),
    }


def part(parts, name, size, loc, material, rot=(0, 0, 0), bevel_w=0.0):
    o = cube(name, size, loc=loc, rot=rot)
    if bevel_w:
        bevel(o, bevel_w, 2)
    assign(o, material)
    parts.append(o)
    return o


def build_club_wall_bay(M):
    """Architectural club bay with three-point support: sole trough, lower
    shaft rail, and upper grip clips. Clubs cannot visually pass through it."""
    p = []
    # Sage display felt makes black shafts and chrome heads readable from the
    # entrance; the first dark-walnut back swallowed the merchandise.
    part(p, 'back', (2.90, 0.08, 2.34), (0, 0.30, 1.17), M['sage'])
    for x in (-1.44, 1.44):
        part(p, 'stile', (0.10, 0.20, 2.42), (x, 0.24, 1.21), M['wood'], bevel_w=0.018)
    part(p, 'header', (2.98, 0.22, 0.31), (0, 0.22, 2.27), M['wood'], bevel_w=0.020)
    part(p, 'base', (2.88, 0.82, 0.16), (0, -0.02, 0.08), M['wood'], bevel_w=0.020)
    # Two rows: each gets a shallow sole trough and a clip rail.
    for y, by in ((0.18, -0.10), (1.32, 0.12)):
        part(p, 'trough', (2.76, 0.24, 0.07), (0, by, y), M['oak'], rot=(0.10, 0, 0), bevel_w=0.012)
        part(p, 'rail', (2.78, 0.06, 0.06), (0, 0.02, y + 0.55), M['brass'], bevel_w=0.008)
        for x in (-1.20, -0.86, -0.52, -0.18, 0.18, 0.52, 0.86, 1.20):
            for dx in (-0.035, 0.035):
                part(p, 'clip', (0.018, 0.12, 0.10), (x + dx, -0.035, y + 0.55), M['rubber'], bevel_w=0.004)
    return finish(p, 'club_wall_bay')


def build_pegboard_wall(M):
    p = []
    part(p, 'back', (3.0, 0.08, 2.22), (0, 0.25, 1.11), M['green'], bevel_w=0.012)
    part(p, 'base', (3.05, 0.58, 0.16), (0, 0, 0.08), M['darkwood'], bevel_w=0.018)
    part(p, 'header', (3.08, 0.22, 0.30), (0, 0.17, 2.18), M['wood'], bevel_w=0.018)
    for x in (-1.50, 1.50):
        part(p, 'side', (0.08, 0.54, 2.25), (x, 0.04, 1.12), M['wood'], bevel_w=0.015)
    # Brass hook grid. The carded goods land on the same x/y rhythm in fixtureSlots.
    xs = [-1.225 + i * 0.35 for i in range(8)]
    ys = [0.38, 0.64, 0.90, 1.16, 1.42, 1.68]
    for x in xs:
        for z in ys:
            hook = cyl('hook', 0.009, 0.20, loc=(x, 0.02, z), rot=(math.pi / 2, 0, 0), verts=8)
            assign(hook, M['brass'])
            p.append(hook)
    return finish(p, 'pegboard_wall')


def build_apparel_wall(M):
    p = []
    part(p, 'back', (3.0, 0.08, 2.22), (0, 0.25, 1.11), M['cream'])
    part(p, 'plinth', (3.05, 0.58, 0.16), (0, 0, 0.08), M['darkwood'], bevel_w=0.018)
    part(p, 'header', (3.08, 0.22, 0.30), (0, 0.17, 2.18), M['wood'], bevel_w=0.018)
    for y in (0.50, 1.05, 1.60):
        part(p, 'shelf', (2.92, 0.48, 0.05), (0, -0.01, y), M['wood'], bevel_w=0.012)
        part(p, 'edge', (2.92, 0.025, 0.025), (0, -0.25, y + 0.02), M['brass'])
    # A small garment rail under the header for the storm shell facing.
    rail = cyl('rail', 0.018, 0.64, loc=(1.02, -0.12, 1.88), rot=(0, math.pi / 2, 0), verts=10)
    assign(rail, M['brass'])
    p.append(rail)
    return finish(p, 'apparel_wall')


def build_feature_table(M):
    p = []
    part(p, 'top', (2.02, 1.10, 0.09), (0, 0, 0.76), M['oak'], bevel_w=0.025)
    part(p, 'apron', (1.86, 0.94, 0.11), (0, 0, 0.67), M['darkwood'], bevel_w=0.012)
    for x in (-0.86, 0.86):
        for y in (-0.40, 0.40):
            part(p, 'leg', (0.09, 0.09, 0.68), (x, y, 0.34), M['wood'], bevel_w=0.012)
    # Low nested tier creates an intentional new-arrivals composition.
    part(p, 'nest_top', (1.20, 0.58, 0.07), (0.30, -0.34, 0.43), M['oak'], bevel_w=0.018)
    for x in (-0.18, 0.78):
        for y in (-0.56, -0.12):
            part(p, 'nest_leg', (0.06, 0.06, 0.40), (x, y, 0.20), M['darkwood'], bevel_w=0.008)
    return finish(p, 'feature_table')


def build_fitting_room(M):
    p = []
    # Enclosed on three sides, open toward Blender -Y / game +Z.
    part(p, 'back', (2.12, 0.10, 2.42), (0, 0.72, 1.21), M['green'], bevel_w=0.012)
    for x in (-1.02, 1.02):
        part(p, 'side', (0.10, 1.48, 2.42), (x, 0.03, 1.21), M['wood'], bevel_w=0.012)
        # Exterior inset panels keep the necessary privacy walls from reading
        # as two unbroken slabs when seen from the sales-floor aisle.
        for y in (-0.38, 0.38):
            part(p, 'side_inset', (0.018, 0.56, 1.74),
                 (x + (0.061 if x > 0 else -0.061), y, 1.22), M['sage'], bevel_w=0.010)
            part(p, 'side_rail', (0.025, 0.60, 0.025),
                 (x + (0.072 if x > 0 else -0.072), y, 0.34), M['brass'])
    part(p, 'header', (2.12, 0.18, 0.25), (0, -0.70, 2.30), M['wood'], bevel_w=0.016)
    rod = cyl('curtain_rod', 0.025, 1.92, loc=(0, -0.66, 2.12), rot=(0, math.pi / 2, 0), verts=12)
    assign(rod, M['brass'])
    p.append(rod)
    # Curtain parked to one side, with visible folds and a clear doorway.
    for i in range(5):
        x = -0.91 + i * 0.085
        fold = cyl('curtain_fold', 0.052, 1.86, loc=(x, -0.64, 1.13), verts=10)
        assign(fold, M['sage'])
        p.append(fold)
    # Bench and full-height mirror inside.
    part(p, 'bench', (0.92, 0.38, 0.34), (0.38, 0.42, 0.17), M['oak'], bevel_w=0.035)
    part(p, 'mirror_frame', (0.76, 0.055, 1.70), (-0.48, 0.655, 1.15), M['brass'], bevel_w=0.014)
    part(p, 'mirror', (0.67, 0.025, 1.60), (-0.48, 0.62, 1.15), M['glass'], bevel_w=0.006)
    return finish(p, 'fitting_room')


def build_drinks_fridge(M):
    p = []
    # Hollow carcass: a solid cube behind glass made the door an opaque grey
    # slab and hid every drink. Back, sides, top and base leave a real cavity.
    part(p, 'back', (0.90, 0.08, 1.90), (0, 0.33, 0.95), M['charcoal'], bevel_w=0.018)
    for x in (-0.41, 0.41):
        part(p, 'side', (0.08, 0.74, 1.90), (x, 0, 0.95), M['charcoal'], bevel_w=0.018)
    part(p, 'top', (0.82, 0.74, 0.08), (0, 0, 1.86), M['charcoal'], bevel_w=0.018)
    part(p, 'base', (0.82, 0.74, 0.08), (0, 0, 0.04), M['charcoal'], bevel_w=0.018)
    part(p, 'header', (0.82, 0.05, 0.25), (0, -0.385, 1.72), M['green'], bevel_w=0.012)
    part(p, 'door_glass', (0.72, 0.025, 1.38), (-0.03, -0.388, 0.87), M['glass'], bevel_w=0.018)
    for y in (0.33, 0.67, 1.01, 1.35):
        part(p, 'shelf', (0.72, 0.55, 0.025), (0, -0.02, y), M['steel'])
    part(p, 'handle', (0.035, 0.06, 0.82), (0.31, -0.43, 0.90), M['brass'], bevel_w=0.009)
    part(p, 'kick', (0.78, 0.08, 0.15), (0, -0.36, 0.10), M['rubber'], bevel_w=0.012)
    return finish(p, 'drinks_fridge')


def build_snack_rack(M):
    p = []
    part(p, 'back', (1.42, 0.08, 1.30), (0, 0.25, 0.65), M['green'], bevel_w=0.014)
    part(p, 'base', (1.46, 0.62, 0.14), (0, 0, 0.07), M['darkwood'], bevel_w=0.018)
    for y in (0.28, 0.55, 0.82, 1.09):
        part(p, 'tray', (1.34, 0.48, 0.045), (0, -0.01, y), M['oak'], rot=(0.10, 0, 0), bevel_w=0.010)
        part(p, 'lip', (1.34, 0.025, 0.08), (0, -0.255, y + 0.02), M['brass'])
    for x in (-0.70, 0.70):
        part(p, 'side', (0.055, 0.60, 1.32), (x, 0, 0.66), M['wood'], bevel_w=0.012)
    return finish(p, 'snack_rack')


def build_service_station(M):
    p = []
    part(p, 'cabinet', (0.88, 0.60, 0.78), (0, 0, 0.39), M['wood'], bevel_w=0.025)
    part(p, 'top', (0.94, 0.66, 0.055), (0, 0, 0.80), M['oak'], bevel_w=0.016)
    part(p, 'card_lip', (0.70, 0.16, 0.12), (0, -0.22, 0.85), M['brass'], bevel_w=0.010)
    for x in (-0.30, 0, 0.30):
        part(p, 'basket_hook', (0.035, 0.20, 0.32), (x, -0.18, 1.03), M['brass'], bevel_w=0.007)
    part(p, 'sign_back', (0.76, 0.08, 0.30), (0, 0.23, 1.16), M['green'], bevel_w=0.018)
    return finish(p, 'service_station')


def build_premium_case(M):
    p = []
    part(p, 'cabinet', (2.25, 0.66, 0.62), (0, 0, 0.31), M['darkwood'], bevel_w=0.025)
    part(p, 'top', (2.30, 0.70, 0.06), (0, 0, 0.64), M['brass'], bevel_w=0.012)
    # Glass envelope and restrained brass mullions.
    # An opaque cream back isolates the products from the lounge trophy wall;
    # without it, wall trophies visually appeared to sit inside this case.
    part(p, 'case_back', (2.18, 0.025, 1.28), (0, 0.31, 1.31), M['cream'])
    part(p, 'glass_front', (2.18, 0.025, 1.28), (0, -0.31, 1.31), M['glass'])
    for x in (-1.08, 1.08):
        part(p, 'glass_side', (0.025, 0.62, 1.28), (x, 0, 1.31), M['glass'])
    for x in (-1.10, 0, 1.10):
        part(p, 'mullion', (0.025, 0.67, 1.35), (x, 0, 1.31), M['brass'])
    for y in (0.68, 1.98):
        part(p, 'frame', (2.28, 0.68, 0.025), (0, 0, y), M['brass'])
    part(p, 'shelf', (2.12, 0.56, 0.025), (0, 0, 1.33), M['glass'])
    return finish(p, 'premium_case')


def build_putting_demo(M):
    p = []
    part(p, 'mat', (3.90, 1.12, 0.035), (0, 0, 0.018), M['green'], bevel_w=0.025)
    # Oak border and a raised backstop at the target end.
    for y in (-0.55, 0.55):
        part(p, 'border', (3.90, 0.055, 0.07), (0, y, 0.035), M['oak'], bevel_w=0.012)
    part(p, 'backstop', (0.16, 1.12, 0.18), (-1.87, 0, 0.09), M['oak'], bevel_w=0.018)
    # Cup and three brass aim dots; the mat remains low and walk-around.
    cup = cyl('cup', 0.09, 0.018, loc=(-1.48, 0, 0.040), verts=18)
    assign(cup, M['charcoal'])
    p.append(cup)
    for x in (-0.35, 0.45, 1.25):
        dot = cyl('aim_dot', 0.025, 0.010, loc=(x, 0, 0.042), verts=12)
        assign(dot, M['brass'])
        p.append(dot)
    return finish(p, 'putting_demo')


if __name__ == '__main__':
    builders = [
        build_club_wall_bay,
        build_pegboard_wall,
        build_apparel_wall,
        build_feature_table,
        build_fitting_room,
        build_drinks_fridge,
        build_snack_rack,
        build_service_station,
        build_premium_case,
        build_putting_demo,
    ]
    for build in builders:
        wipe()
        build(fixture_materials())
    wipe()
    build_bag(merch_materials(), clubs=False)
    print('\n=== BUILT %d PRO-SHOP FIXTURES + EMPTY TOUR BAG ===' % len(builders))
