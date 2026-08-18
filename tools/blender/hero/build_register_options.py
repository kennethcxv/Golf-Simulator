"""GOAL 27 REWORK, ITEM 4 — THE CASH REGISTER. FOUR DESIGNS, SIDE BY SIDE.

"I do not like the current design. Bin it. GIVE ME SEVERAL DESIGNS TO CHOOSE
FROM. Three or four distinct takes, rendered side by side, and I will pick. Do
not iterate one design to death before I have seen the options."

So: four takes, no iteration on any of them yet.

Reference: ref/register/selfcheckout.jpg (a Publix lane -- big angled
touchscreen on a thick riser, a card terminal on a short arm below it, brushed
metal panels on a dark body, a scanner plate set into the counter) and
ref/register/pos-terminal.jpg (an Ingenico card terminal -- moulded black body,
contactless mark above the screen, receipt slot across the top).

  A  COUNTER TILL      the ordinary shop till: low wedge body, drawer in the
                       front, monitor on a post, customer display on the back,
                       printer at the side.
  B  TABLET COLUMN     a boutique pro-shop unit: slim column, swivelling
                       tablet, compact drawer in the base, scanner in a cradle.
  C  LANE HEAD         the supermarket-simulator shape: chunky body, wide
                       brushed-metal drawer, big angled touchscreen on a thick
                       riser, customer pole display, scanner/scale plate.
  D  CLUBHOUSE         timber case and brass, a modern screen let into a raised
                       back panel. The one that belongs in a golf clubhouse
                       rather than a supermarket.

CARRIED FORWARD from the old design, because those parts were right: notes in
the top tray, coins in a well beneath, the drawer a REAL compartment, and its
interior dimensions measured and reported rather than asserted.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_register_options.py -- \\
        [cycles] [only=A|B|C|D]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import cloth_lib as CL  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "register_options")

# A note is 156 mm long, a coin 27 mm across. Those two numbers set the drawer.
NOTE_L, COIN_D = 0.1706, 0.0265


# ---------------------------------------------------------------------------
# the shared kit


def tray(name, centre, size, wall=0.0060, lip=0.0):
    """An open compartment cut out of a solid, so it is a real box with real
    walls and still a closed surface.

    A boolean DIFFERENCE of two boxes is reliable where a union of swept tubes
    is not -- the hanger taught that the hard way.
    """
    cx, cy, cz = centre
    w, d, h = size
    outer = HS.box(f"{name}", (cx, cy, cz), (w, d, h))
    inner = HS.box(f"{name}_void", (cx, cy, cz + wall + lip),
                   (w - 2 * wall, d - 2 * wall, h))
    mod = outer.modifiers.new("Cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = inner
    mod.solver = "EXACT"
    out = HS.apply_mods(outer)
    bpy.data.objects.remove(inner, do_unlink=True)
    out.name = name
    return out


def drawer(prefix, centre, size, notes=4, coins=5):
    """The money drawer: notes in the top tray, coins in a well beneath.

    Reports its own interior, because "the bag phasing bug survived two fixes
    precisely because the game cleared goods against a rectangle somebody typed
    rather than real geometry".
    """
    cx, cy, cz = centre
    w, d, h = size
    p = {}
    p[f"{prefix}_box"] = tray(f"{prefix}_box", (cx, cy, cz), (w, d, h), wall=0.0055)
    iw, idp = w - 0.011, d - 0.011
    # the note tray sits on a ledge in the upper half; coins live under it
    note_h = h * 0.46
    p[f"{prefix}_notetray"] = tray(f"{prefix}_notetray",
                                   (cx, cy + idp * 0.02, cz + h - note_h),
                                   (iw, idp * 0.92, note_h), wall=0.0040)
    for i in range(notes - 1):
        x = cx - iw * 0.5 + iw * (i + 1) / notes
        p[f"{prefix}_ndiv{i}"] = HS.box(f"{prefix}_ndiv{i}",
                                        (x, cy + idp * 0.02, cz + h - note_h * 0.48),
                                        (0.0030, idp * 0.84, note_h * 0.86))
    for i in range(coins):
        x = cx - iw * 0.5 + iw * (i + 0.5) / coins
        p[f"{prefix}_cdiv{i}"] = HS.box(f"{prefix}_cdiv{i}",
                                        (x, cy - idp * 0.30, cz + h * 0.26),
                                        (0.0026, idp * 0.30, h * 0.40))
    return p, (iw, idp, h - 0.011), note_h


def screen(name, centre, size, tilt=0.0):
    """A panel with a bezel and a face that can carry emission."""
    cx, cy, cz = centre
    w, hgt, t = size
    body = HS.box(name, (cx, cy, cz), (w, t, hgt), bevel=0.0022)
    body.rotation_mode = "XYZ"
    body.rotation_euler = (math.radians(tilt), 0, 0)
    return body


def post(name, a, b, r=0.011, sides=10):
    return CL._sweep(name, [Vector(a), Vector(b)], r, sides=sides)


def printer(name, centre, size=(0.055, 0.075, 0.052)):
    return HS.box(name, centre, size, bevel=0.0030)


def terminal(name, centre, tilt=32.0):
    t = HS.box(name, centre, (0.052, 0.026, 0.092), bevel=0.0030)
    t.rotation_mode = "XYZ"
    t.rotation_euler = (math.radians(tilt), 0, 0)
    return t


# ---------------------------------------------------------------------------
# the four designs


def design_a():
    """COUNTER TILL -- the ordinary shop till."""
    p = {}
    W, D, Hh = 0.3400, 0.3100, 0.1150
    p["body"] = HS.box("A_body", (0, 0, Hh * 0.5), (W, D, Hh), bevel=0.0040)
    dr, interior, note_h = drawer("A_drw", (0, -0.1650, 0.0330),
                                  (W * 0.88, D * 0.80, 0.0620))
    p.update(dr)
    p["A_face"] = HS.box("A_face", (0, -0.2760, 0.0330), (W * 0.90, 0.0130, 0.0680),
                         bevel=0.0030)
    p["A_pull"] = HS.box("A_pull", (0, -0.2860, 0.0330), (W * 0.34, 0.0110, 0.0130),
                         bevel=0.0030)
    p["A_riser"] = post("A_riser", (0, 0.0700, Hh), (0, 0.0900, Hh + 0.1150))
    p["A_screen"] = screen("A_screen", (0, 0.0980, Hh + 0.1750),
                           (0.2350, 0.1500, 0.0180), tilt=-16)
    p["A_cust"] = screen("A_cust", (0, 0.1320, Hh + 0.0900),
                         (0.1250, 0.0520, 0.0140), tilt=8)
    p["A_keys"] = HS.box("A_keys", (-0.0250, -0.0350, Hh + 0.0090),
                         (0.1600, 0.1000, 0.0180), bevel=0.0025)
    p["A_printer"] = printer("A_printer", (0.1250, 0.0450, Hh + 0.0260))
    p["A_term"] = terminal("A_term", (0.1350, -0.0850, Hh + 0.0460))
    return p, interior, note_h


def design_b():
    """TABLET COLUMN -- slim, boutique, a swivelling tablet."""
    p = {}
    p["B_base"] = HS.box("B_base", (0, 0, 0.0230), (0.2600, 0.2600, 0.0460),
                         bevel=0.0060)
    dr, interior, note_h = drawer("B_drw", (0, -0.0350, 0.0640),
                                  (0.2300, 0.1900, 0.0520))
    p.update(dr)
    p["B_shell"] = HS.box("B_shell", (0, 0, 0.0900), (0.2600, 0.2600, 0.0420),
                          bevel=0.0050)
    p["B_face"] = HS.box("B_face", (0, -0.1340, 0.0640), (0.2400, 0.0120, 0.0560),
                         bevel=0.0026)
    p["B_pull"] = HS.box("B_pull", (0, -0.1420, 0.0640), (0.0900, 0.0090, 0.0100),
                         bevel=0.0024)
    p["B_col"] = post("B_col", (0, 0.0450, 0.1080), (0, 0.0450, 0.2450), r=0.0150)
    p["B_tablet"] = screen("B_tablet", (0, 0.0620, 0.3050),
                           (0.1900, 0.1350, 0.0130), tilt=-20)
    p["B_cradle"] = HS.box("B_cradle", (0.1000, -0.0700, 0.1220),
                           (0.0420, 0.0700, 0.0230), bevel=0.0028)
    p["B_scanner"] = HS.cylinder("B_scanner", (0.1000, -0.0700, 0.1480),
                                 0.0150, 0.0500, verts=12)
    p["B_term"] = terminal("B_term", (-0.0880, -0.0620, 0.1560), tilt=24)
    return p, interior, note_h


def design_c():
    """LANE HEAD -- the chunky supermarket-simulator shape."""
    p = {}
    W, D, Hh = 0.4200, 0.3600, 0.1500
    p["body"] = HS.box("C_body", (0, 0, Hh * 0.5), (W, D, Hh), bevel=0.0050)
    p["C_kick"] = HS.box("C_kick", (0, 0, 0.0110), (W * 1.02, D * 1.02, 0.0220),
                         bevel=0.0030)
    dr, interior, note_h = drawer("C_drw", (0, -0.1900, 0.0420),
                                  (W * 0.86, D * 0.78, 0.0700))
    p.update(dr)
    p["C_face"] = HS.box("C_face", (0, -0.3180, 0.0420), (W * 0.90, 0.0150, 0.0780),
                         bevel=0.0034)
    p["C_pull"] = HS.box("C_pull", (0, -0.3300, 0.0420), (W * 0.52, 0.0120, 0.0150),
                         bevel=0.0034)
    p["C_riser"] = HS.box("C_riser", (0, 0.1150, Hh + 0.0700),
                          (0.1500, 0.0700, 0.1400), bevel=0.0050)
    p["C_screen"] = screen("C_screen", (0, 0.0900, Hh + 0.1750),
                           (0.3000, 0.2050, 0.0220), tilt=-24)
    p["C_pole"] = post("C_pole", (0.1550, 0.1400, Hh), (0.1550, 0.1400, Hh + 0.2400),
                       r=0.0090)
    p["C_cust"] = screen("C_cust", (0.1550, 0.1500, Hh + 0.2650),
                         (0.1150, 0.0640, 0.0130), tilt=10)
    p["C_scale"] = HS.box("C_scale", (-0.1150, -0.0600, Hh + 0.0060),
                          (0.1500, 0.1500, 0.0120), bevel=0.0020)
    p["C_printer"] = printer("C_printer", (0.1450, -0.0450, Hh + 0.0300),
                             size=(0.0640, 0.0880, 0.0600))
    p["C_paper"] = HS.cylinder("C_paper", (0.1450, -0.0450, Hh + 0.0640),
                               0.0210, 0.0420, verts=14)
    p["C_term"] = terminal("C_term", (-0.0100, -0.1500, Hh + 0.0500), tilt=34)
    return p, interior, note_h


def design_d():
    """CLUBHOUSE -- timber and brass, a screen let into a raised back panel."""
    p = {}
    W, D, Hh = 0.3600, 0.2900, 0.1300
    p["body"] = HS.box("D_body", (0, 0, Hh * 0.5), (W, D, Hh), bevel=0.0055)
    p["D_top"] = HS.box("D_top", (0, 0, Hh + 0.0080), (W * 1.04, D * 1.04, 0.0160),
                        bevel=0.0040)
    dr, interior, note_h = drawer("D_drw", (0, -0.1500, 0.0380),
                                  (W * 0.84, D * 0.78, 0.0640))
    p.update(dr)
    p["D_face"] = HS.box("D_face", (0, -0.2580, 0.0380), (W * 0.88, 0.0160, 0.0720),
                         bevel=0.0040)
    p["D_pull"] = HS.cylinder("D_pull", (0, -0.2700, 0.0380), 0.0120, 0.0880,
                              verts=12,
                              rotation=(0.7071, 0.0, 0.7071, 0.0))
    p["D_back"] = HS.box("D_back", (0, 0.1250, Hh + 0.0900), (W * 0.94, 0.0260, 0.1600),
                         bevel=0.0050)
    p["D_screen"] = screen("D_screen", (0, 0.1090, Hh + 0.0980),
                           (0.2400, 0.1300, 0.0100), tilt=-6)
    p["D_bell"] = HS.cylinder("D_bell", (0.1350, 0.0300, Hh + 0.0270), 0.0230,
                              0.0180, verts=14)
    p["D_knob"] = HS.cylinder("D_knob", (0.1350, 0.0300, Hh + 0.0400), 0.0050,
                              0.0090, verts=8)
    p["D_term"] = terminal("D_term", (-0.1200, -0.0700, Hh + 0.0480), tilt=26)
    return p, interior, note_h


DESIGNS = {"A": ("COUNTER TILL", design_a), "B": ("TABLET COLUMN", design_b),
           "C": ("LANE HEAD", design_c), "D": ("CLUBHOUSE", design_d)}

PALETTE = {
    "A": {"body": (0.128, 0.140, 0.152), "metal": (0.520, 0.530, 0.540),
          "dark": (0.055, 0.058, 0.062), "glow": (0.230, 0.640, 0.700)},
    "B": {"body": (0.880, 0.878, 0.868), "metal": (0.560, 0.570, 0.580),
          "dark": (0.090, 0.092, 0.098), "glow": (0.250, 0.620, 0.690)},
    "C": {"body": (0.100, 0.108, 0.118), "metal": (0.610, 0.618, 0.625),
          "dark": (0.050, 0.052, 0.056), "glow": (0.220, 0.660, 0.720)},
    "D": {"body": (0.180, 0.112, 0.062), "metal": (0.640, 0.480, 0.190),
          "dark": (0.060, 0.070, 0.058), "glow": (0.240, 0.620, 0.680)},
}


def materialise(key, parts):
    pal = PALETTE[key]
    body = HS.pbr(f"{key}_Body", pal["body"], roughness=0.52)
    metal = HS.pbr(f"{key}_Metal", pal["metal"], roughness=0.32, metallic=0.85)
    dark = HS.pbr(f"{key}_Dark", pal["dark"], roughness=0.60)
    glow = HS.pbr(f"{key}_Screen", pal["glow"], roughness=0.18,
                  emission=pal["glow"], emission_strength=2.4)
    for name, ob in parts.items():
        n = name.lower()
        if "screen" in n or "tablet" in n or "cust" in n:
            m = glow
        elif ("pull" in n or "metal" in n or "scale" in n or "paper" in n
              or "bell" in n or "knob" in n or "scanner" in n):
            m = metal
        elif ("drw" in n or "term" in n or "keys" in n or "printer" in n
              or "kick" in n or "cradle" in n):
            m = dark
        else:
            m = body
        ob.data.materials.append(m)
    return 4


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    only = next((x.split("=", 1)[1] for x in args if x.startswith("only=")), "")
    suffix = "" if engine == "CYCLES" else "-eevee"

    shots = []
    for key in ("A", "B", "C", "D"):
        if only and key != only:
            continue
        label, fn = DESIGNS[key]
        H.reset_scene()
        H.set_engine(engine, samples=170 if engine == "CYCLES" else 96)
        parts, interior, note_h = fn()
        mats = materialise(key, parts)
        mesh = {k: v for k, v in parts.items() if hasattr(v, "data")}
        HS.assert_all_one_piece(mesh, f"{key}: every part is one piece")
        # A DRAWER IS INSIDE ITS CABINET. That is the one deep relationship in a
        # till and it has to be declared, not defaulted -- naming it here is a
        # decision on the record, and any pair NOT named that interpenetrates is
        # still a build failure.
        cabinet = [n for n in mesh if n in ("body",) or n.endswith("_shell")
                   or n.endswith("_base") or n.endswith("_top")]
        inner = [n for n in mesh if "_drw" in n]
        allow = [(a, b) for a in inner for b in cabinet]
        allow += [(a, b) for i, a in enumerate(inner) for b in inner[i + 1:]]
        # a paper roll sits INSIDE its printer; that is what a paper roll does
        allow += [("C_paper", "C_printer"), ("D_knob", "D_bell")]
        HS.assert_assembly(mesh, f"{key} ({label})", require_attached=False,
                           max_depth=0.0140, allow=allow)

        subject = list(mesh.values())
        lo, hi = H.bounds(subject)
        print(f"\n=== {key}  {label} ===")
        print(f"  TRIS {H.triangles(subject)} in {len(subject)} parts, "
              f"{mats} materials")
        print(f"  overall  {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} "
              f"x {(hi.z - lo.z) * 1000:.0f} mm")
        print(f"  DRAWER INTERIOR  {interior[0] * 1000:.0f} x "
              f"{interior[1] * 1000:.0f} x {interior[2] * 1000:.0f} mm")
        print(f"    note tray {note_h * 1000:.0f} mm deep, 4 bays "
              f"({interior[0] / 4 * 1000:.0f} mm each; a note is "
              f"{NOTE_L * 1000:.0f} mm long and lies ACROSS them)")
        print(f"    coin well beneath, 5 bays "
              f"({interior[0] / 5 * 1000:.0f} mm each; a coin is "
              f"{COIN_D * 1000:.0f} mm across)")

        centre, radius = H.subject_sphere(subject)
        LENS = 74.0
        dist = H.fit_distance(radius, LENS, res=(1000, 1000), margin=1.20)
        H.studio(center=centre, scale=radius)
        H.backdrop(center=centre, scale=radius)
        out = os.path.join(OUT_RENDER, key)
        for lbl, az, el in (("hero", -118, 20), ("front", -90, 6),
                            ("cust", 62, 14)):
            cam = H.camera(lbl, H.orbit_position(centre, dist, az, el), centre,
                           lens=LENS)
            path = H.render(cam, os.path.join(out, f"{key}{suffix}-{lbl}.png"),
                            res=(1000, 1000))
            if lbl == "hero":
                shots.append(path)
        H.turntable(centre, dist, out, f"{key}{suffix}", views=8, elevation=20.0,
                    lens=LENS, res=(800, 800))
    print("\nhero shots: " + " ".join(shots))


if __name__ == "__main__":
    main()
