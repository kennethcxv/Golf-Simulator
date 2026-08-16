"""OUTDOOR TOOL — THE DIVOT SET. The hand fork and the soil bucket, both.

Replaces two single meshes of 19,812 and 19,815 triangles, one material each and
no part boundary -- which is why neither can carry a socket, and why gripsFor()
falls through to LEGACY_GRIPS and puts the hands 0.72 yd from the tool.

A socket each, as the queue asks. The fork is one-handed and gets a primary. The
bucket is carried by its bail and gets a primary on the bail's grip sleeve, plus
a support on the rim, because a full pail of mix is steadied with the other hand.

The bucket HOLDS something, so its interior is measured off the cavity mesh and
reported -- the same rule the checkout bag lives under.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_divot.py -- \
        [cycles] [break=prongs|bail|socket]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import outdoor_lib as OL  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "divot")
GLB_FORK = os.path.join(REPO, "Assets", "models", "hero", "divot_fork.glb")
GLB_BUCKET = os.path.join(REPO, "Assets", "models", "hero", "divot_bucket.glb")

# ---- the fork. A pitchmark repairer is about four inches overall.
F_HANDLE = 0.0620
F_PRONG = 0.0400
F_WIDE = 0.0210
# 12 mm, not 5.8. A prong 7.6 mm across cannot sit 1.5 mm inside a handle only
# 4.7 mm thick at the neck -- the deepest any base vertex could reach was 0.3 mm.
# The rooting assertion is not being generous here; the geometry was wrong.
F_THICK = 0.0120
FORK_AT = Vector((-0.170, 0, 0.0060))     # parked beside the bucket for the shot

# ---- the pail
B_TOP_R = 0.1080
B_BOT_R = 0.0840
B_HEIGHT = 0.1620
B_WALL = 0.0034
BAIL_R = 0.1180


def ring(r, z, n=20):
    return [Vector((math.cos(2 * math.pi * k / n) * r,
                    math.sin(2 * math.pi * k / n) * r, z)) for k in range(n)]


def loft(name, rings, close_bottom=True, close_top=False, smooth=True):
    n = len(rings[0])
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    for r in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i))
    if close_bottom:
        faces.append(tuple(range(n - 1, -1, -1)))
    if close_top:
        b = (len(rings) - 1) * n
        faces.append(tuple(range(b, b + n)))
    return HS.mesh_from(name, verts, faces, smooth=smooth)


def build_fork(M, broken=""):
    p = {}
    o = FORK_AT
    # a flattened handle that swells at the thumb and tapers to the neck
    hv, hf = [], []
    STEPS = 9
    for s in range(STEPS):
        t = s / (STEPS - 1)
        y = o.y - F_HANDLE * 0.5 + F_HANDLE * t
        w = F_WIDE * (0.52 + 0.48 * math.sin(math.pi * (0.18 + 0.72 * t)))
        th = F_THICK * (0.85 + 0.15 * math.sin(math.pi * t))
        for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            hv.append(Vector((o.x + sx * w * 0.5, y, o.z + sz * th * 0.5)))
    for s in range(STEPS - 1):
        a, b = s * 4, (s + 1) * 4
        for k in range(4):
            q = (k + 1) % 4
            hf.append((a + k, a + q, b + q, b + k))
    hf.append((3, 2, 1, 0))
    last = (STEPS - 1) * 4
    hf.append((last, last + 1, last + 2, last + 3))
    p["handle"] = HS.mesh_from("ForkHandle", hv, hf)

    # two prongs off the neck. The same "many small things on one big thing"
    # class as the rake's tines, so the same assertion and the same control.
    drop = 0.030 if broken == "prongs" else 0.0
    p["prongs"] = []
    for k, sx in enumerate((-1, 1)):
        base = Vector((o.x + sx * 0.0058, o.y + F_HANDLE * 0.5 - 0.0140 + drop, o.z))
        p["prongs"].append(HS.prism(
            f"ForkProng_{k}", base, Vector((sx * 0.16, 1, -0.06)),
            F_PRONG + 0.014, 0.0026, 0.0013, sides=5))

    # a stamped badge on the thumb face -- one specular event on a tool that is
    # otherwise all matte metal
    p["badge"] = HS.cylinder("ForkBadge", (o.x, o.y - F_HANDLE * 0.22,
                                           o.z + F_THICK * 0.42),
                             0.0072, 0.0022, verts=14)

    stray = Vector((0.72, 0, 0)) if broken == "socket" else Vector((0, 0, 0))
    p["sock"] = H.socket("SOCKET_GripPrimary",
                         Vector((o.x, o.y - F_HANDLE * 0.16, o.z)) + stray)

    p["handle"].data.materials.append(M["steel"])
    for pr in p["prongs"]:
        pr.data.materials.append(M["steel"])
    p["badge"].data.materials.append(M["brass"])
    return p


def bail_lug(name, cx, z, r=0.0080, half=0.0125, rings=13, sides=12):
    """A bail lug with cross-sections ALONG its axis.

    A plain cylinder has vertices only on its two end caps -- one lands in the
    pail's cavity and the other outside the shell, and the wall between them is
    3.4 mm, so nothing of it is ever inside the wall for the rooting assertion
    to find. The same shape has now caught this project on the register's
    dividers and the basket's pivot bosses.
    """
    verts, faces = [], []
    for s in range(rings):
        x = cx - half + (2 * half) * s / (rings - 1)
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append(Vector((x, math.cos(a) * r, z + math.sin(a) * r)))
    for s in range(rings - 1):
        for k in range(sides):
            q = (k + 1) % sides
            faces.append((s * sides + k, s * sides + q,
                          (s + 1) * sides + q, (s + 1) * sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    b = (rings - 1) * sides
    faces.append(tuple(range(b, b + sides)))
    return HS.mesh_from(name, verts, faces, smooth=True)


def build_bucket(M, broken=""):
    p = {}
    rings = [ring(B_BOT_R, 0.0), ring(B_BOT_R + 0.0016, 0.0090),
             ring(B_BOT_R + (B_TOP_R - B_BOT_R) * 0.45, B_HEIGHT * 0.48),
             ring(B_TOP_R, B_HEIGHT * 0.955),
             ring(B_TOP_R + 0.0055, B_HEIGHT * 0.985),
             ring(B_TOP_R + 0.0060, B_HEIGHT),
             ring(B_TOP_R - 0.0020, B_HEIGHT * 0.972)]
    pail = loft("PailShell", rings)
    sol = pail.modifiers.new("Wall", "SOLIDIFY")
    sol.thickness, sol.offset, sol.use_rim = B_WALL, -1.0, True
    p["pail"] = HS.apply_mods(pail)

    # the cavity as its own closed mesh -- this is what gets measured
    inner = [ring(B_BOT_R - B_WALL, B_WALL),
             ring(B_BOT_R + (B_TOP_R - B_BOT_R) * 0.45 - B_WALL, B_HEIGHT * 0.48),
             ring(B_TOP_R - B_WALL, B_HEIGHT * 0.945)]
    p["interior"] = loft("PailInterior", inner, close_top=True, smooth=False)
    # A MEASUREMENT AID, not geometry. render() draws the whole scene, not the
    # subject list, so this cavity mesh capped the pail with a flat green disc
    # at the rim and hid the mix entirely.
    p["interior"].hide_render = True

    # the mix in it, sitting a little below the rim and not perfectly level
    fill_z = B_HEIGHT * 0.62
    fr = B_BOT_R + (B_TOP_R - B_BOT_R) * 0.62 - B_WALL
    top = [Vector((v.x, v.y, fill_z + 0.0035 * math.sin(i * 1.7)
                   + 0.0022 * math.sin(i * 3.1)))
           for i, v in enumerate(ring(fr, fill_z))]
    p["fill"] = loft("DivotMix", [ring(B_BOT_R - B_WALL, B_WALL + 0.0008), top],
                     close_top=True, smooth=False)

    # ---- the bail: a wire handle in two lugs, with a grip sleeve
    lift = 0.045 if broken == "bail" else 0.0
    BS = 15
    path = []
    for s in range(BS):
        t = s / (BS - 1)
        a = math.pi * t
        path.append(Vector((math.cos(a) * (B_TOP_R + 0.0010), 0.0,
                            B_HEIGHT * 0.86 + math.sin(a) * BAIL_R + lift)))
    p["bail"] = OL.sweep("PailBail", path, 0.0044, sides=6)
    # centred on the wall's MID-RADIUS, measured rather than guessed: the shell
    # tapers, so the wall at the lug's height is not at B_TOP_R
    lug_z = B_HEIGHT * 0.855
    z0, z1 = B_HEIGHT * 0.48, B_HEIGHT * 0.955
    r0 = B_BOT_R + (B_TOP_R - B_BOT_R) * 0.45
    lug_r = (r0 + (B_TOP_R - r0) * (lug_z - z0) / (z1 - z0)) - B_WALL * 0.5
    print(f"  probe: pail wall mid-radius at the lug height is {lug_r:.5f}")
    p["lugs"] = [bail_lug(f"PailLug_{k}", sx * lug_r, lug_z)
                 for k, sx in enumerate((-1, 1))]
    mid = path[BS // 2]
    p["sleeve"] = HS.cylinder("BailGrip", mid, 0.0092, 0.0620, verts=12,
                              rotation=Vector((1, 0, 0)).to_track_quat("Z", "Y"))

    stray = Vector((0.72, 0, 0)) if broken == "socket" else Vector((0, 0, 0))
    p["sock"] = H.socket("SOCKET_GripPrimary", mid + stray)
    p["sock_support"] = H.socket("SOCKET_GripSupport",
                                 Vector((0, B_TOP_R + 0.0030, B_HEIGHT * 0.97)))

    p["pail"].data.materials.append(M["green"])
    p["interior"].data.materials.append(M["green"])
    p["fill"].data.materials.append(M["wood"])
    p["bail"].data.materials.append(M["steel"])
    p["sleeve"].data.materials.append(M["rubber"])
    for lg in p["lugs"]:
        lg.data.materials.append(M["steel"])
    return p


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=170 if engine == "CYCLES" else 104)
    M = OL.palette()
    f = build_fork(M, broken=broken)
    b = build_bucket(M, broken=broken)

    HS.assert_rooted(f["prongs"], f["handle"], "the fork's prongs",
                     min_verts=3, min_depth=0.0015)
    HS.assert_touching(f["badge"], f["handle"], "the badge must be on the handle", 0.0020)
    HS.assert_socket_at(f["handle"], f["sock"], "the hand closes on the fork handle")

    HS.assert_rooted(b["lugs"], b["pail"], "the bail lugs", min_verts=3, min_depth=0.0010)
    HS.assert_touching(b["bail"], b["lugs"][0], "the bail must sit in its lug", 0.0025)
    HS.assert_touching(b["sleeve"], b["bail"], "the grip sleeve must be on the bail", 0.0025)
    HS.assert_socket_at(b["sleeve"], b["sock"], "the hand closes on the bail's sleeve")
    HS.assert_socket_at(b["pail"], b["sock_support"],
                        "the other hand steadies the rim")

    # ---- the interior, measured off the cavity mesh
    vs = [b["interior"].matrix_world @ v.co for v in b["interior"].data.vertices]
    z0, z1 = min(v.z for v in vs), max(v.z for v in vs)
    lo_r = max(math.hypot(v.x, v.y) for v in vs if v.z < z0 + 0.004)
    hi_r = max(math.hypot(v.x, v.y) for v in vs if v.z > z1 - 0.004)
    fvs = [b["fill"].matrix_world @ v.co for v in b["fill"].data.vertices]
    print("")
    print("  === THE PAIL, measured off the cavity mesh (YARDS) ===")
    print(f"  floor diameter     {lo_r * 2:.4f}")
    print(f"  opening diameter   {hi_r * 2:.4f}")
    print(f"  usable depth       {z1 - z0:.4f}")
    print(f"  mix sits at        {max(v.z for v in fvs):.4f} — "
          f"{(z1 - max(v.z for v in fvs)) * 1000:.0f} mm of freeboard")
    print("")

    fork = [f["handle"], f["badge"]] + f["prongs"]
    pail = [b["pail"], b["fill"], b["bail"], b["sleeve"]] + b["lugs"]
    print(f"TRIS  fork {H.triangles(fork)}  pail {H.triangles(pail)}  "
          f"= {H.triangles(fork + pail)} for the set "
          f"(the in-game pair is 39,627 in two meshes) — the hand is 5,179")
    print(f"  4 shared materials from outdoor_lib, 0 new")

    subject = fork + pail
    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.16)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"divot{suffix}", views=8,
                     elevation=22.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"divot{suffix}-turntable.png"), cols=4)
    fc, fr = H.subject_sphere(fork)
    fd = H.fit_distance(fr, LENS, res=(1100, 1100), margin=1.20)
    for label, az, el, c, d in (("hero", -120, 26, centre, dist),
                                ("side", 180, 10, centre, dist),
                                ("fork", -120, 34, fc, fd),
                                ("into", -90, 58, centre, dist)):
        cam = H.camera(label, H.orbit_position(c, d, az, el), c, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"divot{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"divot{suffix}-silhouette.png"),
                         res=(900, 900))

    if not broken and engine == "CYCLES":
        # Two objects cannot hold the same name in one scene, so the bucket's
        # primary was auto-renamed SOCKET_GripPrimary.001 and would have shipped
        # under a name gripsFor() cannot resolve. Export the fork, retire its
        # socket's name, then claim it for the bucket.
        f["sock"].name = "SOCKET_GripPrimary"
        H.bake_gltf_axis(fork + [f["sock"]])
        H.export_glb(fork + [f["sock"]], GLB_FORK)
        H.verify_sockets(GLB_FORK, ["SOCKET_GripPrimary"])
        f["sock"].name = "SOCKET_Fork_Exported"
        b["sock"].name = "SOCKET_GripPrimary"
        socks = [b["sock"], b["sock_support"]]
        H.bake_gltf_axis(pail + socks)
        H.export_glb(pail + socks, GLB_BUCKET)
        H.verify_sockets(GLB_BUCKET, ["SOCKET_GripPrimary", "SOCKET_GripSupport"])
        print(f"FINAL TRIS fork {H.triangles(fork)}  pail {H.triangles(pail)}")


main()
