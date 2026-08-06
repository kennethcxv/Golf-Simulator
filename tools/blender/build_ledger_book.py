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

PAGE_W = 0.290       # one OPEN half, gutter to fore-edge (a full page width)
PAGE_D = 0.1935      # open page depth - PAGE_W / 1.5, the painters' canvas aspect
ARCH_SEGS = 24


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


def arch_z(t):
    """The open block's master silhouette, gutter (t=0) to fore-edge (t=1):
    low in the gutter's V, a gentle hump past centre, and a fore-edge that
    stays proud of the open cover's raised lip (~0.027)."""
    return 0.012 + 0.023 * math.sin(math.pi * (0.08 + 0.67 * t))


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
            x = (x_gutter + (x_fore - x_gutter) * t) * side
            z = max(0.0015, arch_z(t) * frac)
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
    green = M["green"]
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
    ostatic = []
    vee = math.radians(4.5)
    for side, tag in ((1, "R"), (-1, "L")):
        cover = L.box(f"LB_OpenCover{tag}", (COVER_W * 0.985, COVER_D, COVER_T),
                      (0, 0, 0), green, parent=book_open, bevel=0.0018)
        cover.rotation_mode = "XYZ"
        cover.location = (side * (COVER_W * 0.985 / 2) * math.cos(vee) + side * 0.001,
                          0,
                          COVER_T / 2 + (COVER_W * 0.985 / 2) * math.sin(vee))
        cover.rotation_euler = (0, -side * vee, 0)
        ostatic.append(cover)
        for i in range(6):
            ostatic.append(arched_layer(f"LB_Layer{tag}{i}", side,
                                        (i) / 6.0, (i + 1) / 6.0,
                                        0.0035 * (5 - i), cream if i % 2 else dim,
                                        book_open))
        page_face(f"LB_Face{tag}", side, face_mat, book_open)
        # brass caps on the open covers' outer corners, lips upward
        fx = side * (COVER_W * 0.985) * math.cos(vee) - side * 0.004
        cz = COVER_T + abs(COVER_W * 0.985) * math.sin(vee) - 0.0015
        corner_cap(f"LB_OpenCap{tag}A", fx, -COVER_D / 2 + 0.002, -side, 1,
                   cz, brass, book_open)
        corner_cap(f"LB_OpenCap{tag}B", fx, COVER_D / 2 - 0.002, -side, -1,
                   cz, brass, book_open)
    # spine bump under the gutter + the ribbon lying over the bottom edge
    ostatic.append(L.box("LB_OpenSpine", (0.030, COVER_D - 0.004, 0.010),
                         (0, 0, 0.006), dark, parent=book_open, bevel=0.002, uv=False))
    ostatic.append(L.box("LB_OpenRibbon", (0.016, PAGE_D * 0.62, 0.0022),
                         (0.010, -PAGE_D * 0.28, 0.0187), felt,
                         parent=book_open, bevel=0.0005, uv=False))
    tail = L.box("LB_OpenRibbonTail", (0.016, 0.080, 0.0022),
                 (0.013, -COVER_D / 2 - 0.018, 0.0075), felt,
                 parent=book_open, bevel=0.0005, uv=False)
    tail.rotation_mode = "XYZ"
    tail.rotation_euler = (math.radians(-6), 0, math.radians(5))
    ostatic.append(tail)
    L.empty("LB_LeafAnchor", (0, 0, arch_z(0.0) + 0.0012), parent=book_open)
    join_group(ostatic, "LB_OpenBody", book_open)

    return root


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
