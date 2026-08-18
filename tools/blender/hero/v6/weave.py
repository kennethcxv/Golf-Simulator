"""FABRIC MAPS THAT REACH THE GAME: tileable normal + ORM, built in numpy.

Six revisions of cloth were authored as Bump nodes off procedural textures, and
the glTF writer emits NOTHING for a Bump node. Every garment shipped as a bare
baseColorFactor. This module replaces that chain with real images.

WHY SYNTHESISED AND TILED, NOT BAKED PER OBJECT
-----------------------------------------------
A bake gives one map per object, sized by the object's UV layout, and the
garment UVs here are the PATTERN DRAFT -- each panel normalised 0..1, panels
overlapping between parts. Baking into that lays a 1024 map over a whole shirt:
roughly 0.5 mm per texel, which cannot hold a 1.5 mm knit cell, and it costs a
megabyte per garment for detail that repeats. A knit is a REPEATING material,
so the honest representation is a small seamless tile repeated many times.
That also gets the thing the brief asked for -- "share one atlas across
garments where the fabric is the same" -- for free: `HoodieFleece` and
`HoodieFFleece` are literally the same image datablock.

Macro occlusion -- the dark between two plies of a folded stack -- is NOT in
here, because it is per-object and cannot tile. That is `vertex_ao.py`.

WHAT IS IN A TILE
-----------------
One height field per fabric family, exactly periodic by construction, and then
three maps derived from it and from nothing else, so they cannot disagree:

  normal     central differences of the height, in CELL units, times the
             family's relief-to-cell slope. No invented millimetres: only the
             ratio survives into a normal map anyway.
  occlusion  a cavity map -- how far below its own neighbourhood a texel sits,
             at two radii. This is what makes a weave read under ambient light,
             and at shelf distance it does more work than the normal does.
  roughness  the authored base, raised in the cavities where the fibre is loose
             and lowered a little on the yarn crowns, plus a fine grain so the
             specular is not a single flat sheet.

Packed R=occlusion G=roughness B=metallic, which is exactly what the glTF
writer wants for one shared texture -- verified by probe_gltf_maps.py:
`occlusion=1 metRough=1`, one fetch.
"""

import math
import os

import bpy
import numpy as np

# Cells across one tile. Eight is the smallest number that reads as a repeating
# field rather than as one motif, and it keeps 256 px at 32 px per cell.
CELLS = 8
PX = 256

# family -> (slope, base cell size in mm, seed)
#
# `slope` is relief divided by cell width -- the only thing a normal map
# actually encodes. A real pique cell is about 0.35 mm proud on a 1.6 mm cell,
# so 0.22. Twill is much flatter; terry loops are much rounder.
FAMILY = {
    "pique":  dict(slope=0.22, cell_mm=1.6, seed=11),
    "jersey": dict(slope=0.17, cell_mm=1.3, seed=22),
    "fleece": dict(slope=0.34, cell_mm=2.5, seed=33),
    "twill":  dict(slope=0.15, cell_mm=0.9, seed=44),
    "rib":    dict(slope=0.30, cell_mm=3.0, seed=55),
    "terry":  dict(slope=0.42, cell_mm=1.8, seed=66),
    "cord":   dict(slope=0.35, cell_mm=2.0, seed=77),
}

# material name fragment -> family. Checked longest-first so "FFleece" and
# "Fleece" cannot race. Inference is PRINTED at build time, not silent.
INFER = [
    ("pique", "pique"), ("jersey", "jersey"), ("fleece", "fleece"),
    ("terry", "terry"), ("twill", "twill"), ("cord", "cord"),
    ("thread", "cord"), ("under", "jersey"), ("rib", "rib"), ("trim", "rib"),
]

_CACHE = {}


def family_of(name):
    n = name.lower()
    for frag, fam in INFER:
        if frag in n:
            return fam
    raise SystemExit(
        "BUILD FAILED: no fabric family for material %r. Add it to "
        "weave.INFER -- an unclassified cloth must not quietly ship flat."
        % name)


# ---------------------------------------------------------------------------
# periodic primitives


def _uv(px):
    """Texel centres. Row index is v, column index is u -- which is also the
    order Blender's pixel buffer wants, bottom row first."""
    t = (np.arange(px) + 0.5) / px
    return np.meshgrid(t, t, indexing="xy")


def _tri(x):
    """Triangle wave, period 1, range 0..1."""
    return 2.0 * np.abs(x - np.floor(x + 0.5))


def _frac(x):
    return x - np.floor(x)


def _value_noise(px, n, seed):
    """Value noise on an n x n lattice, wrapped -- so it tiles exactly."""
    rng = np.random.default_rng(seed)
    g = rng.random((n, n))
    t = (np.arange(px) + 0.5) / px * n
    i0 = np.floor(t).astype(int)
    f = t - i0
    w = f * f * (3.0 - 2.0 * f)
    i0 %= n
    i1 = (i0 + 1) % n
    wv, wu = w[:, None], w[None, :]
    a = g[np.ix_(i0, i0)]
    b = g[np.ix_(i0, i1)]
    c = g[np.ix_(i1, i0)]
    d = g[np.ix_(i1, i1)]
    return (a * (1 - wv) * (1 - wu) + b * (1 - wv) * wu
            + c * wv * (1 - wu) + d * wv * wu)


def _fractal(px, n, octaves, seed, gain=0.5):
    out = np.zeros((px, px))
    amp, tot = 1.0, 0.0
    for k in range(octaves):
        out += amp * _value_noise(px, max(2, n * (2 ** k)), seed + k * 101)
        tot += amp
        amp *= gain
    return out / tot


def _blur(h, sigma_px):
    """Periodic Gaussian blur. In the Fourier domain, so the wrap is exact and
    the AO does not develop a seam the tiling then repeats forever."""
    px = h.shape[0]
    fv = np.fft.fftfreq(px)[:, None]
    fu = np.fft.rfftfreq(px)[None, :]
    g = np.exp(-2.0 * (math.pi ** 2) * (sigma_px ** 2) * (fu ** 2 + fv ** 2))
    return np.fft.irfft2(np.fft.rfft2(h) * g, s=(px, px))


def _unit(h):
    lo, hi = float(h.min()), float(h.max())
    return (h - lo) / (hi - lo) if hi - lo > 1e-9 else np.zeros_like(h)


# ---------------------------------------------------------------------------
# the height fields -- one per fabric, each a description of how the cloth is
# actually made rather than a texture that resembles it


def _h_pique(px, f, seed):
    """A pique is a LATTICE: two yarn systems interlocking at 45 degrees, and
    the cell is where both are raised. Multiplied, not summed -- summed gives
    diagonal corduroy, which is what one earlier round shipped."""
    u, v = _uv(px)
    a = _tri(f * (u + v))
    b = _tri(f * (u - v))
    cell = (a * b) ** 0.55           # rounds the crown; a knit cell is a dome
    return 0.88 * cell + 0.12 * _fractal(px, f * 3, 2, seed)


def _h_jersey(px, f, seed):
    """Jersey's face is columns of V-shaped wales: the loop of each course
    pulls the column sideways and back, which is the whole read."""
    u, v = _uv(px)
    course = _tri(f * 0.75 * v)
    zig = (course - 0.5) / f          # the wale sways by half a cell per course
    wale = _tri(f * (u + zig))
    h = 0.70 * (wale ** 1.3) + 0.30 * (1.0 - course) ** 1.6
    return 0.90 * h + 0.10 * _fractal(px, f * 3, 2, seed)


def _h_fleece(px, f, seed):
    """Brushed fleece has no lattice at all -- the knit ground is buried under
    a raised nap. Anything periodic here would be a lie, so it is noise, with
    the nap slightly drawn out along the wale direction."""
    fine = _fractal(px, f * 2, 3, seed)
    broad = _fractal(px, max(2, f // 2), 2, seed + 7)
    nap = _fractal(px, f, 2, seed + 13)
    nap = 0.5 * (nap + np.roll(nap, 2, axis=0))      # smear along v
    return _unit(0.45 * broad + 0.35 * nap + 0.20 * fine)


def _h_twill(px, f, seed):
    """A 2/1 twill. The diagonal is NOT a rotated wave -- it comes out of the
    interlacing, where the warp floats over two wefts and under one and the
    float shifts by a yarn every row. Built that way it also tiles exactly,
    which a rotated wave at 38 degrees does not."""
    u, v = _uv(px)
    su, sv = u * f * 2.0, v * f * 2.0
    pu = np.sin(math.pi * _frac(su)) ** 0.75         # round yarn section
    pv = np.sin(math.pi * _frac(sv)) ** 0.75
    warp_up = ((np.floor(su) - np.floor(sv)) % 3) < 2
    h = np.where(warp_up, 0.42 + 0.58 * pu, 0.30 * pv)
    return 0.93 * h + 0.07 * _fractal(px, f * 4, 2, seed)


def _h_rib(px, f, seed):
    """1x1 rib: raised columns with a deep valley between, the valley narrower
    than the column because the purl wale is pulled to the back."""
    u, v = _uv(px)
    col = (0.5 + 0.5 * np.cos(2.0 * math.pi * u * f)) ** 1.35
    # The course frequency has to be a WHOLE number of periods per tile or the
    # tile does not wrap, and a tile that does not wrap prints its seam across
    # the whole garment as a grid. f * 1.7 was 13.6 and the wrap control caught
    # it at 3.21x the interior step.
    courses = max(1, int(round(f * 1.75)))
    course = 0.86 + 0.14 * _tri(courses * v)
    return 0.92 * (col * course) + 0.08 * _fractal(px, f * 3, 2, seed)


def _h_terry(px, f, seed):
    """Terry is LOOPS -- rounded pile standing off the ground cloth in a rough
    grid, not a weave you can see. Nine neighbours so a loop near a tile edge
    still overlaps its wrapped copy."""
    u, v = _uv(px)
    rng = np.random.default_rng(seed)
    jit = rng.random((f, f, 2)) - 0.5
    h = np.zeros((px, px))
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for j in range(f):
                for i in range(f):
                    cu = (i + 0.5 + 0.55 * jit[j, i, 0]) / f + dx
                    cv = (j + 0.5 + 0.55 * jit[j, i, 1]) / f + dy
                    r2 = ((u - cu) ** 2 + (v - cv) ** 2) * (f * 1.55) ** 2
                    h = np.maximum(h, np.exp(-r2 * 2.2))
    return _unit(0.85 * h + 0.15 * _fractal(px, f * 2, 2, seed))


def _h_cord(px, f, seed):
    """A drawcord and a stitching thread are both a twisted multi-ply: steep
    helical ridges. Integer u and v frequencies so the helix closes."""
    u, v = _uv(px)
    a = np.floor(f) or 1
    b = max(1, int(round(f / 3.0)))
    ridge = (0.5 + 0.5 * np.cos(2.0 * math.pi * (u * a + v * b))) ** 1.15
    return 0.90 * ridge + 0.10 * _fractal(px, f * 3, 2, seed)


HEIGHT = {
    "pique": _h_pique, "jersey": _h_jersey, "fleece": _h_fleece,
    "twill": _h_twill, "rib": _h_rib, "terry": _h_terry, "cord": _h_cord,
}


# ---------------------------------------------------------------------------
# height -> the three maps


def maps_for(family, rough, px=PX, cells=CELLS):
    spec = FAMILY[family]
    h = _unit(HEIGHT[family](px, cells, spec["seed"]))

    # NORMAL. Central differences in CELL units: a normal map records slope,
    # and slope is relief over cell width, so the millimetres cancel and there
    # is no invented physical size to get wrong.
    per_cell = px / float(cells)
    du = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * per_cell
    dv = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * per_cell
    s = spec["slope"]
    nx, ny, nz = -du * s, -dv * s, np.ones_like(h)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5,
                    nz * inv * 0.5 + 0.5], axis=-1)

    # OCCLUSION. How far a texel sits below its own neighbourhood, at two
    # radii, so both the valley between two yarns and the broader hollow of the
    # weave darken. This is the channel that does the work at shelf distance:
    # a normal map needs a specular highlight to show at all, and a shelf in
    # ambient light barely has one.
    cav = np.maximum(_blur(h, per_cell * 0.30) - h,
                     _blur(h, per_cell * 0.90) - h)
    cav = np.clip(cav / max(float(cav.max()), 1e-6), 0.0, 1.0)
    # HOW DARK depends on how deep the cavity actually is, which is the same
    # relief-to-cell ratio the normal uses. Normalising by the tile's own
    # maximum -- the first cut -- gave every fabric an occlusion floor of
    # exactly 0.38, so a flat twill occluded as hard as a terry loop pile and
    # the number could not tell them apart.
    ao = np.clip(1.0 - min(0.78, 2.6 * s) * cav, 0.0, 1.0)

    # ROUGHNESS. Rougher in the cavity where loose fibre catches, smoother on
    # the yarn crown that has been pressed, plus a grain finer than the cell so
    # the specular is not one sheet.
    grain = _fractal(px, cells * 6, 2, spec["seed"] + 3) - 0.5
    rg = np.clip(rough + 0.085 * cav - 0.045 * h + 0.035 * grain, 0.12, 1.0)

    orm = np.stack([ao, rg, np.zeros_like(h)], axis=-1)
    return h, nrm, orm


def _image(name, rgb):
    """A GENERATED image, never written to disk. probe_gltf_maps.py proved
    these export: two images, image/png, packed into the GLB."""
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    px = rgb.shape[0]
    img = bpy.data.images.new(name, px, px, alpha=False, float_buffer=False)
    # COLORSPACE FIRST. Assigning colorspace_settings.name to a GENERATED image
    # ZEROES its buffer -- measured, four orderings, probe_image_write.py. The
    # first cut set it last and wrote seven solid-black tiles, and the numbers
    # in the control were all still green because they were computed in numpy
    # before the image existed. A black normal map is worse than none.
    img.colorspace_settings.name = "Non-Color"
    buf = np.empty((px, px, 4), np.float32)
    buf[..., :3] = rgb
    buf[..., 3] = 1.0
    img.pixels.foreach_set(buf.ravel())
    img.update()
    got = np.empty(px * px * 4, np.float32)
    img.pixels.foreach_get(got)
    if float(got[:px * px * 4:4].std()) < 1e-7 and float(got.max()) < 1e-6:
        raise SystemExit("BUILD FAILED: image %r came back empty after writing "
                         "it -- see probe_image_write.py" % name)
    return img


def atlas(family, rough):
    """The pair of images for one fabric, shared by every material asking for
    it within one file.

    THE CACHE HOLDS NUMPY, NOT DATABLOCKS. Caching the bpy Images looked right
    and worked for five assets, then `export_all` called `reset_scene` before
    the sixth and every cached reference became "StructRNA of type Image has
    been removed" -- and Blender still exited 0, so a run that died at asset
    six of ten reported success. What is expensive is the synthesis; the image
    datablock is cheap and belongs to whichever scene is current.
    """
    key = (family, round(rough, 3))
    if key not in _CACHE:
        _, nrm, orm = maps_for(family, rough)
        _CACHE[key] = (nrm, orm)
    nrm, orm = _CACHE[key]
    nm = "wv_%s_n" % family
    om = "wv_%s_orm_%03d" % (family, int(rough * 100))
    have_n = bpy.data.images.get(nm)
    have_o = bpy.data.images.get(om)
    return (have_n if have_n is not None else _image(nm, nrm),
            have_o if have_o is not None else _image(om, orm))


def clear_cache():
    _CACHE.clear()


# ---------------------------------------------------------------------------
# the node group the glTF writer reads occlusion out of


def gltf_settings_group():
    name = "glTF Material Output"
    grp = bpy.data.node_groups.get(name)
    if grp is None:
        grp = bpy.data.node_groups.new(name, "ShaderNodeTree")
        grp.interface.new_socket("Occlusion", in_out="INPUT",
                                 socket_type="NodeSocketFloat")
    return grp


def repeat_for(family, rib, scale_mm, cells=CELLS):
    """How many times the tile repeats across UV 0..1.

    Two sources, and which one applies is not a preference. Where the author
    already tuned a band count in the studio (`rib` = cells per UV unit) that
    number is the tuned look and it is kept exactly: repeat = rib / cells.
    Where there was no rib -- fleece, cord, the towel, the trouser trim -- fall
    back to the panel's own span and a real cell size for that cloth.
    """
    if rib and rib > 0:
        return float(rib) / cells
    span = max(float(scale_mm), 1.0)
    return span / (cells * FAMILY[family]["cell_mm"])


def wire(mat, family, rough, repeat, strength=1.0):
    """Put the tile onto a material and return what was done, for printing."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nrm_img, orm_img = atlas(family, rough)

    uvn = nt.nodes.new("ShaderNodeUVMap")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (repeat, repeat, 1.0)
    nt.links.new(uvn.outputs["UV"], mp.inputs["Vector"])

    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = nrm_img
    tn.interpolation = "Smart"
    nt.links.new(mp.outputs["Vector"], tn.inputs["Vector"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = strength
    nt.links.new(tn.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    to = nt.nodes.new("ShaderNodeTexImage")
    to.image = orm_img
    to.interpolation = "Smart"
    nt.links.new(mp.outputs["Vector"], to.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    # Roughness comes from the map now, so the scalar the call site passed is
    # the map's CENTRE, already baked into the green channel above.
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    gn = nt.nodes.new("ShaderNodeGroup")
    gn.node_tree = gltf_settings_group()
    nt.links.new(sep.outputs["Red"], gn.inputs["Occlusion"])
    return dict(family=family, repeat=repeat, rough=rough,
                images=(nrm_img.name, orm_img.name))
