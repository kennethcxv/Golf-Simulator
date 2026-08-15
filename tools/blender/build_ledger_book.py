"""The Pine Hills club register (ref: Designs/LedgerBook reference sheet).

A vintage green-leather ledger with gold-embossed double border, brass corner
caps, five raised spine bands with brass spine caps, a leather clasp strap with
brass buckle, a cream page block, and a green ribbon marker.

The GLB carries TWO subtrees the runtime toggles:
  LB_Closed - the shelf/desk book. LB_CoverFront is a hinged node (origin on
              the spine hinge line) the runtime rotates to swing the cover;
              LB_FaceTitle is a quad over the page block the runtime paints
              with the title page, revealed mid-swing.
  LB_Open   - the open book: covers lying in a shallow V, six arched page
              layers per half (stacked fore-edges like the reference), and
              LB_FaceL / LB_FaceR curved quads whose material the runtime
              replaces with its live page canvases. LB_LeafAnchor marks the
              turning-leaf pivot on the gutter line.

The cover TITLE is deliberately absent from the GLB: the club is renameable,
so the runtime paints the gold title onto a canvas plane at LB_TitleAnchor.

Axes (Blender): X = width, spine at +X, fore-edge at -X; Y = page depth
(+Y = top edge of the page); Z = up. Exported Y-up: Blender +Z becomes glTF
+Y, Blender +Y becomes glTF -Z.

Run:
  "<blender>" --background --factory-startup --python \
      tools/blender/build_ledger_book.py -- nojoin render
"""
import sys
import math
sys.path.insert(0, "tools/blender")
import bpy
import lib_props as L
from mathutils import Vector

# ---- the book's one set of measurements (metres) -----------------------------
COVER_W = 0.302      # spine to fore-edge
COVER_D = 0.228      # page top to bottom
COVER_T = 0.007      # one cover board
BLOCK_T = 0.059      # closed page block
BOOK_T = COVER_T * 2 + BLOCK_T
HINGE_X = COVER_W / 2  # the spine hinge line

# R2/R6 (2026-08-06): the block ran to 0.290 against a 0.2975 board, leaving a
# 7 mm overhang at the fore-edge and 17 mm at head and foot — so the boards read
# as a lopsided black rim, and there was nowhere to tool the turn-in. A bound
# book's SQUARES (the board's overhang past the block) are even all round.
# Narrowing the block gives 21 mm on all four edges, room for the gold, and a
# book that is genuinely narrower in frame.
PAGE_W = 0.276       # one OPEN half, gutter to fore-edge (a full page width)
PAGE_D = 0.184       # open page depth - PAGE_W / 1.5, the painters' canvas aspect
ARCH_SEGS = 24


def _leather_book(name="M_LBLeather"):
    # R6: the shared M_Green reads near-black on the open boards, which are the
    # only leather the reader ever looks at closely. Lifted and given a little
    # more sheen so it reads as green morocco under the clubhouse's dim light.
    return L.mat_tex(name, L.leather_image("LBLeather", (0.082, 0.196, 0.133)),
                     roughness=0.44)


def _leather_dark(name="M_LBLeatherDk"):
    return L.mat_tex(name, L.leather_image("LBLeatherDk", (0.040, 0.105, 0.068)),
                     roughness=0.55)


def _cream_dim(name="M_LBPageDim"):
    return L.mat(name, (0.735, 0.675, 0.545), roughness=0.62)


def _page_face(name="M_LBPageFace"):
    # placeholder the runtime swaps for its live CanvasTexture material
    return L.mat(name, (0.905, 0.862, 0.742), roughness=0.72)


def tri_prism(name, verts2d, z0, z1, material, parent, *, loc=(0, 0, 0)):
    """A vertical prism from a 2D triangle footprint - the brass corner caps."""
    mesh = bpy.data.meshes.new(name)
    lo = [(x, y, z0) for (x, y) in verts2d]
    hi = [(x, y, z1) for (x, y) in verts2d]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    mesh.from_pydata(lo + hi, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    obj.rotation_mode = "QUATERNION"
    bpy.context.scene.collection.objects.link(obj)
    L.parent_keep(obj, parent)
    return obj


def corner_cap(name, corner_x, corner_y, sx, sy, z0, material, parent, *, leg=0.050):
    """One brass corner protector: triangular plate + edge lips + a stud.

    (corner_x, corner_y) is the cover corner; sx/sy point INTO the cover.
    """
    tri = [(corner_x, corner_y),
           (corner_x + sx * leg, corner_y),
           (corner_x, corner_y + sy * leg)]
    tri_prism(f"{name}_plate", tri, z0, z0 + 0.0032, material, parent)
    # lips wrapping the cover edge thickness
    L.box(f"{name}_lipx", (leg * 0.98, 0.0028, COVER_T + 0.004),
          (corner_x + sx * leg * 0.49, corner_y + sy * 0.0012, z0 - COVER_T / 2 - 0.0006),
          material, parent=parent, bevel=0.0006, uv=False)
    L.box(f"{name}_lipy", (0.0028, leg * 0.98, COVER_T + 0.004),
          (corner_x + sx * 0.0012, corner_y + sy * leg * 0.49, z0 - COVER_T / 2 - 0.0006),
          material, parent=parent, bevel=0.0006, uv=False)
    L.sphere(f"{name}_stud", 0.0026,
             (corner_x + sx * 0.0145, corner_y + sy * 0.0145, z0 + 0.0032), material,
             parent=parent, segs=10)


def gold_frame(name, cx, cy, w, d, z, material, parent, *, bar=0.0034, t=0.0012):
    """One rectangle of the embossed double border."""
    L.box(f"{name}_n", (w, bar, t), (cx, cy + d / 2 - bar / 2, z), material,
          parent=parent, bevel=0.0004, uv=False)
    L.box(f"{name}_s", (w, bar, t), (cx, cy - d / 2 + bar / 2, z), material,
          parent=parent, bevel=0.0004, uv=False)
    L.box(f"{name}_e", (bar, d - 2 * bar, t), (cx + w / 2 - bar / 2, cy, z), material,
          parent=parent, bevel=0.0004, uv=False)
    L.box(f"{name}_w", (bar, d - 2 * bar, t), (cx - w / 2 + bar / 2, cy, z), material,
          parent=parent, bevel=0.0004, uv=False)


# ---- the V the open covers lie in, and the surface the page block rests on --
# R1 (2026-08-06): "it clips through its own cover opening. Covers and page
# block must never intersect." They did, everywhere. The page block was built
# on the TABLE PLANE (layer 0's underside pinned at z=0.0015) while the covers
# lie in a 4.5 degree V whose top surface climbs from z=0.0070 at the gutter to
# z=0.0298 at the fore-edge — so the whole block was 5 to 29 mm inside the
# boards, and even the top layer's fore-edge (arch 0.0283) sank under the
# cover's lip. The old arch_z's docstring claimed the lip was "~0.027"; it was
# never measured.
#
# So the cover plane is now DERIVED from the cover's own placement, and every
# page layer is built above it. Both surfaces move together if the V changes.
COVER_VEE = math.radians(4.5)
_CW = COVER_W * 0.985                  # the open cover board's width
_C_LOC_X = (_CW / 2) * math.cos(COVER_VEE) + 0.001
_C_LOC_Z = COVER_T / 2 + (_CW / 2) * math.sin(COVER_VEE)


def _cover_top_corner(local_x):
    """A point on the open cover's TOP face, in the open book's own frame."""
    a = -COVER_VEE
    lz = COVER_T / 2
    return (
        _C_LOC_X + local_x * math.cos(a) + lz * math.sin(a),
        _C_LOC_Z + (-local_x * math.sin(a) + lz * math.cos(a)),
    )


_CT_GUTTER = _cover_top_corner(-_CW / 2)
_CT_FORE = _cover_top_corner(_CW / 2)
_CT_SLOPE = (_CT_FORE[1] - _CT_GUTTER[1]) / (_CT_FORE[0] - _CT_GUTTER[0])
PAGE_CLEARANCE = 0.0013   # the gap the block keeps off the board, everywhere


def cover_top_z(x):
    """Height of the open cover's top face at distance `x` from the gutter."""
    return _CT_GUTTER[1] + (x - _CT_GUTTER[0]) * _CT_SLOPE


def block_floor_z(x):
    """Where the page block's underside lies: on the board, never in it."""
    return cover_top_z(x) + PAGE_CLEARANCE


def arch_h(t):
    """The page block's THICKNESS, gutter (t=0) to fore-edge (t=1).

    Thin where the leaves fold into the gutter, bellied past centre where the
    stack is deepest, easing back at the fore-edge. Height above the board —
    the board's own rise is added by block_floor_z, so the silhouette is the
    real one: a shallow V with a belly, fore-edges proudest."""
    return 0.0075 + 0.0135 * math.sin(math.pi * (0.10 + 0.66 * t))


def arch_z(t):
    """The open block's TOP surface, gutter to fore-edge, in the open frame."""
    x = 0.002 + (PAGE_W - 0.002) * t
    return block_floor_z(x) + arch_h(t)


def arched_layer(name, side, frac_lo, frac_hi, inset, material, parent):
    """One page layer of an open half: an arched shell with visible edges.

    side +1 = the +X half (viewer varies; runtime maps), -1 = the -X half.
    frac_lo/frac_hi scale the master arch for the layer's bottom/top surface.
    """
    x_gutter = 0.002
    x_fore = PAGE_W - inset
    depth = PAGE_D - inset * 2
    mesh = bpy.data.meshes.new(name)
    verts = []
    n = ARCH_SEGS
    for level, frac in ((0, frac_lo), (1, frac_hi)):
        for i in range(n + 1):
            t = i / n
            ax = x_gutter + (x_fore - x_gutter) * t
            x = ax * side
            # every leaf lies ON the board and takes its share of the block's
            # thickness above it - the layer stack grows upward from the cover,
            # never down through it
            z = block_floor_z(ax) + max(0.0004, arch_h(t) * frac)
            verts.append((x, -depth / 2, z))
            verts.append((x, depth / 2, z))
    faces = []
    def vid(level, i, front):
        return level * (n + 1) * 2 + i * 2 + (0 if front else 1)
    for i in range(n):
        # top surface
        faces.append((vid(1, i, True), vid(1, i + 1, True), vid(1, i + 1, False), vid(1, i, False)))
        # bottom surface
        faces.append((vid(0, i, False), vid(0, i + 1, False), vid(0, i + 1, True), vid(0, i, True)))
        # front/back edge walls
        faces.append((vid(0, i, True), vid(0, i + 1, True), vid(1, i + 1, True), vid(1, i, True)))
        faces.append((vid(1, i, False), vid(1, i + 1, False), vid(0, i + 1, False), vid(0, i, False)))
    # fore-edge wall + gutter wall
    faces.append((vid(0, n, True), vid(0, n, False), vid(1, n, False), vid(1, n, True)))
    faces.append((vid(0, 0, False), vid(0, 0, True), vid(1, 0, True), vid(1, 0, False)))
    if side < 0:
        # the mirrored X inverts every face's winding - reverse the tuples so
        # normals stay outward (edit-mode flip ops are fragile headless)
        faces = [tuple(reversed(face)) for face in faces]
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    obj.rotation_mode = "QUATERNION"
    bpy.context.scene.collection.objects.link(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    L.parent_keep(obj, parent)
    return obj


def page_face(name, side, material, parent):
    """The curved live-canvas quad riding the top layer.

    The reading pose faces local -z with viewer-LEFT at +x (VERIFY2_L), so
    u=0 (the left edge of the painted canvas) sits at the FORE-EDGE on the
    +x half and at the GUTTER on the -x half; v=1 at the page TOP (+Y).
    The first wiring had u inverted on both halves - every page photographed
    mirror-image."""
    x_gutter = 0.004
    x_fore = PAGE_W - 0.004
    depth = PAGE_D - 0.006
    n = ARCH_SEGS
    mesh = bpy.data.meshes.new(name)
    verts = []
    uvs = []
    for i in range(n + 1):
        t = i / n
        x = (x_gutter + (x_fore - x_gutter) * t) * side
        z = arch_z(t) + 0.0008
        verts.append((x, -depth / 2, z))
        verts.append((x, depth / 2, z))
        u = (1.0 - t) if side > 0 else t
        uvs.append((u, 0.0))
        uvs.append((u, 1.0))
    faces = []
    for i in range(n):
        a, b = i * 2, i * 2 + 1
        c, d = (i + 1) * 2, (i + 1) * 2 + 1
        faces.append((a, c, d, b) if side > 0 else (c, a, b, d))
    mesh.from_pydata(verts, [], faces)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        poly.use_smooth = True
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            uv_layer.data[li].uv = uvs[vi]
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    obj.rotation_mode = "QUATERNION"
    obj["movable"] = "page_face"
    bpy.context.scene.collection.objects.link(obj)
    L.parent_keep(obj, parent)
    return obj


RAW_PARTS = "rawparts" in sys.argv


def join_group(objs, name, parent):
    """Fuse one subtree's static dressing into a single named body."""
    meshes = [o for o in objs if o and o.type == "MESH"]
    if RAW_PARTS:
        return None
    if len(meshes) < 2:
        return meshes[0] if meshes else None
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    target = meshes[0]
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    target.name = name
    L.parent_keep(target, parent)
    return target


def build(M):
    green = _leather_book()
    dark = _leather_dark()
    brass = M["brass"]
    gold = M["gold"]
    cream = M["cream"]
    dim = _cream_dim()
    face_mat = _page_face()
    felt = M["green_felt"]

    root = L.asset_root("ledger_book", (COVER_W, COVER_D, BOOK_T))

    # ============================================================= CLOSED ====
    closed = L.empty("LB_Closed", (0, 0, 0), parent=root)
    static = []

    static.append(L.box("LB_CoverBack", (COVER_W, COVER_D, COVER_T),
                        (0, 0, COVER_T / 2), green, parent=closed, bevel=0.0018))
    # closed page block: alternating cream slabs, inset from three edges
    slabs = 7
    slab_t = BLOCK_T / slabs
    block_w = COVER_W - 0.018
    block_cx = (HINGE_X - 0.004) - block_w / 2
    for i in range(slabs):
        z = COVER_T + slab_t * (i + 0.5)
        jitter = 0.0016 if i % 2 else -0.0012
        static.append(L.box(f"LB_Block{i}", (block_w + jitter, COVER_D - 0.016 + jitter, slab_t + 0.0004),
                            (block_cx, 0, z), cream if i % 2 else dim,
                            parent=closed, bevel=0.0008, uv=False))
    # spine: wrap, five raised bands, two brass caps - one continuous curve
    # with gentle ridges, not stacked donuts
    spine_r = BOOK_T / 2
    wrap_r = spine_r + 0.0045
    static.append(L.cyl("LB_SpineWrap", wrap_r, COVER_D - 0.002,
                        (HINGE_X + 0.001, 0, spine_r), green,
                        rot=(math.radians(90), 0, 0), verts=32))
    L.parent_keep(static[-1], closed)
    for i, y in enumerate((-0.078, -0.039, 0.0, 0.039, 0.078)):
        static.append(L.cyl(f"LB_Band{i}", wrap_r + 0.0012, 0.010,
                            (HINGE_X + 0.001, y, spine_r), dark,
                            rot=(math.radians(90), 0, 0), verts=32))
        L.parent_keep(static[-1], closed)
    for i, y in enumerate((-(COVER_D / 2 - 0.007), COVER_D / 2 - 0.007)):
        static.append(L.cyl(f"LB_SpineCap{i}", wrap_r + 0.0012, 0.011,
                            (HINGE_X + 0.001, y, spine_r), brass,
                            rot=(math.radians(90), 0, 0), verts=32))
        L.parent_keep(static[-1], closed)
    # back-cover corner caps (fore-edge corners)
    corner_cap("LB_CapBackA", -COVER_W / 2 + 0.002, -COVER_D / 2 + 0.002, 1, 1,
               COVER_T, brass, closed)
    corner_cap("LB_CapBackB", -COVER_W / 2 + 0.002, COVER_D / 2 - 0.002, 1, -1,
               COVER_T, brass, closed)
    # the closed ribbon tail sliding out of the block at the bottom fore
    # corner, resting on the back cover's lip
    rib = L.box("LB_RibbonClosed", (0.017, 0.058, 0.0022),
                (-0.102, -COVER_D / 2 - 0.009, COVER_T + 0.0025), felt,
                parent=closed, bevel=0.0006, uv=False)
    rib.rotation_mode = "XYZ"
    rib.rotation_euler = (0, 0, math.radians(12))
    static.append(rib)
    # clasp: lower strap wrapping the fore-edge from the back cover
    static.append(L.box("LB_ClaspSide", (0.0045, 0.032, BOOK_T - 0.008),
                        (-COVER_W / 2 - 0.0035, 0.0, (BOOK_T - 0.008) / 2 + 0.002),
                        dark, parent=closed, bevel=0.001, uv=False))
    static.append(L.box("LB_ClaspUnder", (0.052, 0.032, 0.004),
                        (-COVER_W / 2 + 0.024, 0.0, 0.004), dark,
                        parent=closed, bevel=0.001, uv=False))

    # hinged front cover - origin ON the hinge line so rotation swings it.
    # parent_keep PRESERVES WORLD TRANSFORMS, so every piece below is placed
    # in world space (cover centre z = BOOK_T - COVER_T/2, face at BOOK_T).
    hinge = L.empty("LB_CoverFront", (HINGE_X, 0, BOOK_T - COVER_T / 2), parent=closed)
    hinge["movable"] = "cover"
    cov_z = BOOK_T - COVER_T / 2
    face_z = BOOK_T
    L.box("LB_CoverFrontBody", (COVER_W, COVER_D, COVER_T),
          (0, 0, cov_z), green, parent=hinge, bevel=0.0018)
    # embossed gold double border on the face
    gold_frame("LB_BorderOuter", 0, 0, COVER_W - 0.034, COVER_D - 0.034,
               face_z + 0.0007, gold, hinge)
    gold_frame("LB_BorderInner", 0, 0, COVER_W - 0.058, COVER_D - 0.058,
               face_z + 0.0007, gold, hinge, bar=0.0022)
    corner_cap("LB_CapFrontA", -COVER_W / 2 + 0.002, -COVER_D / 2 + 0.002, 1, 1,
               face_z, brass, hinge)
    corner_cap("LB_CapFrontB", -COVER_W / 2 + 0.002, COVER_D / 2 - 0.002, 1, -1,
               face_z, brass, hinge)
    # clasp tongue + brass buckle on the cover face
    L.box("LB_ClaspTongue", (0.058, 0.030, 0.0038),
          (-COVER_W / 2 + 0.036, 0, face_z + 0.0019), dark,
          parent=hinge, bevel=0.001, uv=False)
    bx = -COVER_W / 2 + 0.030
    L.box("LB_BuckleN", (0.020, 0.0035, 0.0058), (bx, 0.0165, face_z + 0.002),
          brass, parent=hinge, bevel=0.0008, uv=False)
    L.box("LB_BuckleS", (0.020, 0.0035, 0.0058), (bx, -0.0165, face_z + 0.002),
          brass, parent=hinge, bevel=0.0008, uv=False)
    L.box("LB_BuckleE", (0.0035, 0.036, 0.0058), (bx + 0.010, 0, face_z + 0.002),
          brass, parent=hinge, bevel=0.0008, uv=False)
    L.box("LB_BuckleW", (0.0035, 0.036, 0.0058), (bx - 0.010, 0, face_z + 0.002),
          brass, parent=hinge, bevel=0.0008, uv=False)
    L.box("LB_BucklePin", (0.017, 0.0028, 0.0034), (bx, 0, face_z + 0.0035),
          brass, parent=hinge, bevel=0.0006, uv=False)
    # where the runtime hangs the painted title plane
    L.empty("LB_TitleAnchor", (0, 0.012, face_z + 0.0012), parent=hinge)

    # the title page the swing reveals (runtime canvas)
    title_face = bpy.data.meshes.new("LB_FaceTitle")
    tw, td = block_w - 0.012, COVER_D - 0.030
    title_face.from_pydata(
        [(block_cx - tw / 2, -td / 2, 0), (block_cx + tw / 2, -td / 2, 0),
         (block_cx + tw / 2, td / 2, 0), (block_cx - tw / 2, td / 2, 0)],
        [], [(0, 1, 2, 3)])
    uvl = title_face.uv_layers.new(name="UVMap")
    # viewer-left is +x: u=0 belongs on the +x vertex pair
    for li, uv in zip(range(4), ((1, 0), (0, 0), (0, 1), (1, 1))):
        uvl.data[li].uv = uv
    title_face.materials.append(face_mat)
    tf = bpy.data.objects.new("LB_FaceTitle", title_face)
    tf.location = (0, 0, COVER_T + BLOCK_T + 0.0006)
    tf.rotation_mode = "QUATERNION"
    tf["movable"] = "page_face"
    bpy.context.scene.collection.objects.link(tf)
    L.parent_keep(tf, closed)

    join_group(static, "LB_ClosedBody", closed)

    # =============================================================== OPEN ====
    book_open = L.empty("LB_Open", (0, 0, 0), parent=root)
    # The open book joins into TWO named bodies, not one. R1 is a claim about
    # covers versus pages, and a claim you cannot measure is a claim you cannot
    # keep — with a single LB_OpenBody the runtime had no way to tell them
    # apart, which is how the block came to be built inside the boards.
    cover_parts = []
    cap_parts = []
    page_parts = []
    vee = COVER_VEE
    for side, tag in ((1, "R"), (-1, "L")):
        cover = L.box(f"LB_OpenCover{tag}", (_CW, COVER_D, COVER_T),
                      (0, 0, 0), green, parent=book_open, bevel=0.0018)
        cover.rotation_mode = "XYZ"
        cover.location = (side * _C_LOC_X, 0, _C_LOC_Z)
        cover.rotation_euler = (0, -side * vee, 0)
        cover_parts.append(cover)
        # R6 (2026-08-06): "fix what still reads cheap: leather, gold, page
        # edges, ink." Open, the board reads as a flat dark slab framing the
        # paper — the gold lived only on the CLOSED front cover, so the whole
        # thing the reader actually looks at carried none of it. A real bound
        # ledger's turn-in is tooled: a double gold rule runs the board's inner
        # face just outside the block. Drawn in the board's own rotated frame
        # so it rides the V instead of floating over it.
        for inset, bar in ((0.010, 0.0026), (0.020, 0.0013)):
            gold_frame(f"LB_OpenTurnIn{tag}{int(inset * 1000)}",
                       0, 0, _CW - inset * 2, COVER_D - inset * 2,
                       COVER_T / 2 + 0.0007, gold, parent=cover, bar=bar, t=0.0009)
        cover_parts.extend([c for c in cover.children
                            if c.name.startswith(f"LB_OpenTurnIn{tag}")])
        for i in range(6):
            page_parts.append(arched_layer(f"LB_Layer{tag}{i}", side,
                                           (i) / 6.0, (i + 1) / 6.0,
                                           0.0035 * (5 - i), cream if i % 2 else dim,
                                           book_open))
        # R6 "page edges": the block is GILT ON THE FORE-EDGE. A ledger's edges
        # are gilded so the closed book shows a gold band, and open it catches
        # the light along the outer edge of each half. It is the one page-edge
        # detail that reads from across a dim room, and the block had none.
        gild_t = (arch_z(1.0) - block_floor_z(PAGE_W)) * 0.92
        page_parts.append(L.box(
            f"LB_GiltEdge{tag}",
            (0.0022, PAGE_D - 0.006, gild_t),
            (side * (PAGE_W - 0.0004),
             0,
             block_floor_z(PAGE_W) + gild_t / 2 + 0.0006),
            gold, parent=book_open, bevel=0.0004, uv=False))
        page_face(f"LB_Face{tag}", side, face_mat, book_open)
        # brass caps on the open covers' outer corners, lips upward
        fx = side * _CW * math.cos(vee) - side * 0.004
        cz = COVER_T + abs(_CW) * math.sin(vee) - 0.0015
        # the caps join SEPARATELY: they are proud brass fittings standing off
        # the board's outer corners, and folding them into the cover body made
        # the board's fitted thickness read 4.96 mm instead of 3.5, eating a
        # millimetre of the clearance R1 is about
        cap_parts.append(corner_cap(f"LB_OpenCap{tag}A", fx, -COVER_D / 2 + 0.002, -side, 1,
                                    cz, brass, book_open))
        cap_parts.append(corner_cap(f"LB_OpenCap{tag}B", fx, COVER_D / 2 - 0.002, -side, -1,
                                    cz, brass, book_open))
    # the spine bump fills the V's trough BELOW the block's gutter floor
    gutter_floor = block_floor_z(0.002)
    spine_t = 0.009
    # the spine bump stays its OWN object: it straddles the gutter, so folding
    # it into either board turned the board's fitted box from 297 x 228 x 7 mm
    # into 388 x 228 x 10 and made every clearance number read short
    L.box("LB_OpenSpine", (0.030, COVER_D - 0.004, spine_t),
          (0, 0, gutter_floor - spine_t / 2 - 0.0004), dark,
          parent=book_open, bevel=0.002, uv=False)
    # THE RIBBON LIES ON THE PAGE, NOT IN IT. It used to be pinned at z=0.0187
    # while the painted face at the same x sat at 0.0190 — the marker was sawn
    # in half lengthwise by the page it was supposed to be resting on.
    #
    # AND IT HANGS OFF THE RIGHT EDGE. Blender +Y maps to glTF -Z, and the
    # reading pose turns glTF +Z UP toward the eye — so a ribbon laid toward
    # -Y overhung the page at the top of the frame and photographed as a green
    # post standing out of the gutter. It runs the other way now: down the
    # page, past the FOOT, where a marker actually falls.
    ribbon_x = 0.026
    ribbon_t = 0.0022
    ribbon_w = 0.013
    ribbon_z = arch_z((ribbon_x - 0.002) / (PAGE_W - 0.002)) + 0.0012 + ribbon_t / 2
    page_parts.append(L.box("LB_OpenRibbon", (ribbon_w, PAGE_D * 0.66, ribbon_t),
                            (ribbon_x, PAGE_D * 0.24, ribbon_z), felt,
                            parent=book_open, bevel=0.0005, uv=False))
    # The TAIL used to be pinned near the closed book's cover height and ran
    # back UNDER the board — 5 mm inside it. A ribbon end hangs in free air
    # past the board's edge, so it now starts beyond that edge and droops from
    # the ribbon's own height rather than from the table's.
    tail_len = 0.055
    tail_near = COVER_D / 2 - 0.010           # just inside the board's foot edge
    tail_mid = tail_near + tail_len / 2
    tail_droop = math.radians(-7)              # the far end falls away past the board
    tail = L.box("LB_OpenRibbonTail", (ribbon_w, tail_len, ribbon_t),
                 (ribbon_x + 0.002, tail_mid,
                  ribbon_z - 0.0010 + (tail_len / 2) * math.sin(tail_droop)), felt,
                 parent=book_open, bevel=0.0005, uv=False)
    tail.rotation_mode = "XYZ"
    tail.rotation_euler = (tail_droop, 0, math.radians(-4))
    page_parts.append(tail)
    L.empty("LB_LeafAnchor", (0, 0, arch_z(0.0) + 0.0012), parent=book_open)
    _assert_no_cover_page_overlap()
    join_group(cover_parts, "LB_OpenCovers", book_open)
    join_group(cap_parts, "LB_OpenCaps", book_open)
    join_group(page_parts, "LB_OpenPages", book_open)

    return root


def _assert_no_cover_page_overlap():
    """R1's guard, run at BUILD time on the numbers the meshes are made from.

    Samples the width and requires the page block's underside to stay above
    the cover board's top face at every point. If the V, the board thickness
    or the arch is ever retuned, this fails here rather than shipping a book
    that saws through its own covers again."""
    worst = None
    for i in range(201):
        t = i / 200.0
        x = 0.002 + (PAGE_W - 0.002) * t
        gap = block_floor_z(x) - cover_top_z(x)
        if worst is None or gap < worst[1]:
            worst = (x, gap)
    if worst[1] < 0.0008:
        raise SystemExit(
            f"LEDGER R1: page block clears the cover by only {worst[1] * 1000:.2f} mm "
            f"at x={worst[0]:.4f} — covers and page block must never intersect."
        )
    top_fore = arch_z(1.0)
    if top_fore <= cover_top_z(PAGE_W) + 0.0008:
        raise SystemExit(
            f"LEDGER R1: the block's fore-edge ({top_fore:.4f}) sinks into the "
            f"cover lip ({cover_top_z(PAGE_W):.4f})."
        )
    print(f"LEDGER R1 OK | min cover clearance {worst[1] * 1000:.2f} mm | "
          f"fore-edge proud by {(top_fore - cover_top_z(PAGE_W)) * 1000:.2f} mm")


def main():
    # custom run: both subtrees export at the ORIGIN (the runtime toggles
    # them), then LB_Open slides aside so the preview shows closed and open
    # side by side instead of interpenetrating
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    L.reset_scene()
    M = L.materials()
    root = build(M)
    L.save_and_export("ledger_book", root, subdir="clubhouse")
    if "render" in argv:
        for obj in bpy.data.objects:
            if obj.name == "LB_Open":
                obj.location.x += 0.52
        if "swing" in argv:
            hinge = bpy.data.objects.get("LB_CoverFront")
            if hinge:
                hinge.rotation_mode = "XYZ"
                hinge.rotation_euler = (0, math.radians(-150), 0)
        L.render_preview("ledger_book", root, azimuth=35, elevation=32)
    print("COMPLETE|ledger_book")


main()
