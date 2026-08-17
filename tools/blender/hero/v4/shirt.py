"""The hanging-shirt machinery, extracted from the hoodie once it worked.

The brief allows generalising only AFTER one production-quality example proves
the technique, and forbids treating a shared change as a pass for anything
else. So this module holds the parts of the hoodie that are true of every
hanging top -- and nothing that is true only of a hoodie.

What is shared:
  * a panelled body with a two-segment yoke, so the shoulder has a CORNER in
    it rather than being one smooth dome;
  * real armholes cut as a window in the yoke, and sleeves grown from the loop
    the SOLVE left behind, not the one the builder drew;
  * a soft pin -- the hanger strip held hard, the body held at about 0.04 so
    gravity gets the folds without being free to redesign the silhouette;
  * projecting the sleeves out of the body along a radial ray.

What is NOT shared, and belongs to each garment: its measurements, its cloth,
its collar or hood, its plackets, pockets, cuffs and hems, and its own visual
review against its own photograph.
"""

import math

import bpy
from mathutils import Vector

import drape as D


def se(hw, hd, th, n):
    """Superellipse point. theta = 0 is CENTRE FRONT (-y)."""
    sx, sy = math.sin(th), -math.cos(th)
    x = hw * math.copysign(abs(sx) ** (2.0 / n), sx) if sx else 0.0
    y = hd * math.copysign(abs(sy) ** (2.0 / n), sy) if sy else 0.0
    return x, y


def fbs(th, p=1.7):
    c, s = math.cos(th), abs(math.sin(th))
    f, b, sd = max(0.0, c) ** p, max(0.0, -c) ** p, s ** p
    tot = f + b + sd or 1.0
    return f / tot, b / tot, sd / tot


def mix(table, th):
    f, b, s = fbs(th)
    return table["front"] * f + table["back"] * b + table["side"] * s


def bez(p0, p1, p2, t):
    return ((1 - t) ** 2 * Vector(p0) + 2 * (1 - t) * t * Vector(p1)
            + t * t * Vector(p2))


def lerp2(table, z):
    if z <= table[0][0]:
        return table[0][1], table[0][2]
    if z >= table[-1][0]:
        return table[-1][1], table[-1][2]
    for (z0, a0, b0), (z1, a1, b1) in zip(table, table[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            t = t * t * (3 - 2 * t)
            return a0 + (a1 - a0) * t, b0 + (b1 - b0) * t
    return table[-1][1], table[-1][2]


class Shirt:
    """One hanging top. `spec` carries the measurements; nothing else."""

    def __init__(self, spec):
        self.s = spec
        self.rows = None
        self.nv_body = 0
        self.wins = {}

    # -- construction ------------------------------------------------------

    def body_rows(self):
        s = self.s
        NU = s["nu"]
        rows, zs, z = [], [], s["hem_z"]
        while z < s["chest_z"] - 1e-6:
            zs.append(z)
            z += s["row_h"]
        zs.append(s["chest_z"])
        lift = s.get("hem_lift")
        for z in zs:
            hw, hd = lerp2(s["profile"], z)
            row = []
            for k in range(NU):
                th = 2 * math.pi * k / NU
                x, y = se(hw, hd, th, s["body_n"])
                zz = z
                if lift:
                    # A SHIRT-TAIL HEM. A polo's hem is not level: it drops at
                    # the centres and rides up at the side seams, where the
                    # vents are. A level hem is the loudest single sign that a
                    # garment was swept rather than cut.
                    fade = 1.0 - D._smooth(z, s["hem_z"], s["hem_z"] + 0.115)
                    zz = z + mix(lift, th) * fade
                row.append((x, y, zz))
            rows.append(row)

        chest = rows[-1]
        ring = {}
        for k in range(NU):
            th = 2 * math.pi * k / NU
            ax, ay = se(*s["ctrl_a"], th, s["body_n"])
            sx, sy = se(*s["shoulder"], th, s["body_n"])
            bx, by = se(*s["ctrl_b"], th, s["body_n"])
            nx, ny = se(*s["neck"], th, 2.6)
            ring[k] = (Vector((ax, ay, mix(s["ctrl_a_z"], th))),
                       Vector((sx, sy, mix(s["shoulder_z"], th))),
                       Vector((bx, by, mix(s["ctrl_b_z"], th))),
                       Vector((nx, ny + s["neck_cy"], mix(s["neck_z"], th))))
        for j in range(1, s["yoke_a"] + 1):     # armhole edge
            t = j / s["yoke_a"]
            rows.append([tuple(bez(Vector(chest[k]), ring[k][0], ring[k][1], t))
                         for k in range(NU)])
        for j in range(1, s["yoke_b"] + 1):     # shoulder seam
            t = j / s["yoke_b"]
            rows.append([tuple(bez(ring[k][1], ring[k][2], ring[k][3], t))
                         for k in range(NU)])
        self.rows, self.nv_body = rows, len(zs) - 1
        return rows

    def loop_indices(self, u0, u1, v0, v1, sign):
        us, vs = list(range(u0, u1 + 1)), list(range(v0, v1 + 1))
        loop = [(u, v0) for u in us[:-1]]
        loop += [(u1, v) for v in vs[:-1]]
        loop += [(u, v1) for u in reversed(us[1:])]
        loop += [(u0, v) for v in reversed(vs[1:])]
        if sign < 0:
            loop = [loop[0]] + loop[1:][::-1]
        return loop

    def shell(self, name="shirt"):
        s = self.s
        NU = s["nu"]
        rows = self.body_rows()
        for sign, centre in ((+1, NU // 4), (-1, 3 * NU // 4)):
            self.wins[sign] = (centre - s["arm_u"], centre + s["arm_u"],
                               self.nv_body + s["arm_v"][0],
                               self.nv_body + s["arm_v"][1])
        skip = set()
        for (u0, u1, v0, v1) in self.wins.values():
            for u in range(u0, u1):
                for v in range(v0, v1):
                    skip.add((u % NU, v))
        ob = D.grid_mesh(name, rows, wrap_u=True,
                         skip=lambda u, v: (u, v) in skip)
        D.weld(ob, 2e-4)
        D.strip_loose(ob)
        D.jitter(ob, s.get("jitter", 0.0015), seed=s.get("seed", 2.7))
        self.body = ob
        return ob

    # -- the solve ---------------------------------------------------------

    def openings(self):
        """Vertex indices of the armhole loops and the neck ring, taken by
        POSITION before the solve so they can be read back after it."""
        from mathutils import kdtree
        s = self.s
        NU = s["nu"]
        me = self.body.data
        kd = kdtree.KDTree(len(me.vertices))
        for i, v in enumerate(me.vertices):
            kd.insert(v.co, i)
        kd.balance()

        def at(p):
            return kd.find(Vector(p))[1]

        self.arm_idx = {
            sg: [at(self.rows[v][u % NU])
                 for (u, v) in self.loop_indices(*self.wins[sg], sg)]
            for sg in self.wins}
        self.neck_idx = [at(self.rows[-1][k]) for k in range(NU)]
        self._at = at
        return self.arm_idx, self.neck_idx

    def pin(self):
        s = self.s
        NU = s["nu"]
        hard = set()
        for centre in (NU // 4, 3 * NU // 4):
            for u in range(centre - s["pin_cols"], centre + s["pin_cols"] + 1):
                for v in range(self.nv_body + s["pin_rows"][0],
                               self.nv_body + s["pin_rows"][1] + 1):
                    hard.add(self._at(self.rows[v][u % NU]))
        g = self.body.vertex_groups.new(name="pin")
        soft, fade = s.get("pin_soft", 0.042), s.get("pin_fade", 0.170)
        free_z = s.get("pin_free_z", s["hem_z"] + 0.100)
        for i, v in enumerate(self.body.data.vertices):
            if i in hard:
                g.add([i], 1.0, 'REPLACE')
                continue
            if v.co.z < free_z:
                continue
            t = min(1.0, max(0.0, (v.co.z - free_z) / fade))
            g.add([i], soft * t * t * (3 - 2 * t), 'REPLACE')
        self.n_hard = len(hard)
        return len(hard)

    def solve(self, preset, frames=90, quality=12, friction=0.8):
        before = [Vector(v.co) for v in self.body.data.vertices]
        D.add_cloth(self.body, preset=preset, pin="pin", quality=quality,
                    self_dist=0.0030, coll_dist=0.0030, damping=2.2,
                    friction=friction)
        D.bake(frames=frames)
        D.freeze(self.body)
        moved = D.travelled(self.body, before)
        if moved < 0.012:
            raise SystemExit(f"BUILD FAILED: cloth did not move ({moved:.3f} m)")
        if moved > 0.400:
            raise SystemExit(f"BUILD FAILED: solve diverged ({moved:.2f} m)")
        n = D.despike(self.body, tol=3.0)
        D.relax(self.body, rounds=2, factor=0.32)
        return moved, n

    # -- sleeves -----------------------------------------------------------

    def sleeve(self, sign, name, drop, axis_x, outer, depth, section,
               rows=30, cuff_t=0.90, cuff_pinch=0.10, fold=(0.088, 0.046),
               bow=0.052, clear=0.0072, hem_curl=0.0):
        """A sleeve hanging from the armhole the SOLVE settled into.

        The section is parallel-transported along the path, so "up at the
        armhole" becomes "outboard at the cuff". Measuring the armhole's
        extents in world x and y and rebuilding the oval in world x and y --
        which is the obvious thing to write -- gives a sleeve with the right
        two dimensions applied to the wrong two axes.

        `clear` is how far off the body the sleeve is pushed. It has to be
        AT LEAST the two cloth thicknesses that meet there or the solidified
        shells interpenetrate, and not much more or a slot of background opens
        between sleeve and body -- the tee read as a flap bolted to a slab at
        7.2 mm, which is four and a half thicknesses of jersey.

        `hem_curl` lifts the trailing edge of the cuff ring towards the body.
        A sleeve hem cut square to its own axis ends in a sharp point at the
        outer corner; a real one turns under and reads as a lobe.
        """
        from mathutils import Quaternion
        pts = [Vector(self.body.data.vertices[i].co) for i in self.arm_idx[sign]]
        C = sum(pts, Vector()) / len(pts)
        P1 = Vector((C.x + sign * bow, C.y - 0.006, C.z - drop * 0.185))
        P2 = Vector((sign * axis_x, C.y - 0.012, C.z - drop))

        T = (P1 - C).normalized()
        e1 = Vector((0, 0, 1)).cross(T)
        e1 = e1.normalized() if e1.length > 1e-6 else Vector((0, 1, 0))
        e2 = T.cross(e1).normalized()
        ang, r1, r2 = [], [], []
        for p in pts:
            d = p - C
            d = d - T * d.dot(T)
            ang.append(math.atan2(d.dot(e2), d.dot(e1)))
            r1.append(d.dot(e1))
            r2.append(d.dot(e2))
        R1 = max(abs(v) for v in r1) or depth
        R2 = max(abs(v) for v in r2) or outer

        out_rows = [[tuple(p) for p in pts]]
        prevT = T
        for j in range(1, rows + 1):
            t = j / rows
            c = bez(C, P1, P2, t)
            nT = (2 * (1 - t) * (P1 - C) + 2 * t * (P2 - P1)).normalized()
            ax = prevT.cross(nT)
            if ax.length > 1e-7:
                q = Quaternion(ax.normalized(), math.asin(min(1.0, ax.length)))
                e1 = e1.copy()
                e1.rotate(q)
                e2 = e2.copy()
                e2.rotate(q)
            prevT = nT
            sw, sh = lerp2(section, t)
            if t > cuff_t:
                g = (t - cuff_t) / (1.0 - cuff_t)
                pinch = 1.0 - cuff_pinch * math.exp(-((g - 0.10) / 0.13) ** 2)
                sw *= pinch * (1.0 - 0.10 * g)
                sh *= pinch * (1.0 - 0.07 * g)
            tgt1 = (R1 + (depth - R1) * D._smooth(t, 0.0, 0.42)) * sw
            tgt2 = (R2 + (outer - R2) * D._smooth(t, 0.0, 0.42)) * sh
            w = min(1.0, t / 0.30) ** 1.25
            # the cuff turns under: the outboard half of the last rows walks
            # back along the sleeve axis, so the hem is a lobe not a chamfer
            curl = hem_curl * D._smooth(t, cuff_t - 0.10, 1.0)
            row = []
            for i in range(len(pts)):
                a = ang[i]
                f = ((fold[0] * math.cos(a * 2.0 + 0.6)
                      + fold[1] * math.cos(a * 3.0 - 1.1 + t * 1.8))
                     * D._smooth(t, 0.14, 0.62))
                o = (e1 * (tgt1 * (1.0 + f) * math.cos(a))
                     + e2 * (tgt2 * (1.0 + f) * math.sin(a)))
                keep = e1 * r1[i] + e2 * r2[i]
                p = c + keep.lerp(o, w)
                if curl > 0.0:
                    # measured DOWNWARD in world z, not by section angle: the
                    # frame has been parallel-transported, so which way `a`
                    # points is whatever the armhole happened to start at
                    below = max(0.0, (c.z - p.z) / max(1e-6, tgt2))
                    p = p - nT * (curl * min(1.0, below))
                row.append(tuple(p))
            out_rows.append(row)
        sl = D.grid_mesh(name, out_rows, wrap_u=True)
        nu = len(pts)
        keep = {i: Vector(sl.data.vertices[i].co)
                for i in range(min(6 * nu, len(sl.data.vertices)))}
        D.push_out_radial(sl, self.body, offset=clear)
        for i, co in keep.items():
            w = D._smooth(i // nu, 1.0, 6.0)
            sl.data.vertices[i].co = co.lerp(sl.data.vertices[i].co, w)
        return sl

    def join(self, parts):
        bpy.ops.object.select_all(action='DESELECT')
        for p in parts:
            p.select_set(True)
        self.body.select_set(True)
        bpy.context.view_layer.objects.active = self.body
        bpy.ops.object.join()
        D.weld(self.body, 2e-5)
        D.cleanup(self.body)
        return self.body


def audit(ob, label="", allow_nonmanifold=4):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    nonman = [e for e in bm.edges if len(e.link_faces) not in (1, 2)]
    tiny = [f for f in bm.faces if f.calc_area() < 1e-9]
    short = [e for e in bm.edges if e.calc_length() < 1e-5]
    print(f"  AUDIT {label} verts {len(bm.verts)} faces {len(bm.faces)} "
          f"| non-manifold {len(nonman)} | zero-area {len(tiny)} "
          f"| zero-length {len(short)}")
    bm.free()
    if len(tiny) or len(short) or len(nonman) > allow_nonmanifold:
        raise SystemExit(f"BUILD FAILED: bad topology ({label})")
