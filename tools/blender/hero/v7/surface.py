"""HARD-SURFACE MAPS, through the fabric pipeline rather than beside it.

Block 5: "Bake driver, putter, iron and counter through the same pipeline the
eleven went through." The eleven got tiling normal + ORM from `v6/weave.py` and
per-object macro occlusion in COLOR_0 from `v6/vertex_ao.py`. The four hardgoods
got neither: `assert_maps.mjs` fails them 119 times -- every mapped material
with no normalTexture, no occlusionTexture and no metallicRoughnessTexture, and
every primitive with no COLOR_0. Wiring them as they are ships flat colour,
which is the exact fault the bake exists to fix.

WHY THIS REGISTERS INTO weave RATHER THAN COPYING IT
-----------------------------------------------------
`weave.wire()`, `weave.atlas()` and `weave.maps_for()` are not about cloth. They
take a periodic height field and derive a normal map (central differences in
CELL units), an occlusion map (a two-radius cavity measure) and a roughness
channel from it and from nothing else -- so the three can never disagree. That
is exactly as true of quarter-sawn oak as of a pique knit.

So this module contributes HEIGHT FIELDS and their families, and registers them
into weave's own tables at import. The counter then goes through literally the
same `wire()` call the polo went through, with the same 256 px tile, the same
cavity radii, the same glTF Material Output group for occlusion. Nothing here
re-implements a bake; if the fabric path is ever fixed, this is fixed with it.

WHAT A HARD SURFACE NEEDS THAT CLOTH DOES NOT
----------------------------------------------
Metal. The fabric ORM writes zero into blue because a knit is a dielectric, and
`wire()` links blue to Metallic -- so a brushed brass rail wired through the
fabric path would come out as a dielectric with a brass tint, which is the one
thing brass must not be. Each family therefore declares its own `metal`, and the
blue channel carries it.

THE FAMILIES, and what each height field is FOR:

  oak       quarter-sawn joinery. Long fine grain lines along u with a slow
            ray-fleck across them. The counter is 2.4 m of one material and the
            thing that stops it reading as a painted box is the run of the
            grain, so the anisotropy is the point -- 14:1 along u.
  brass     a brushed rail. Near-pure directional streak, very shallow: brushing
            is a roughness pattern much more than a height one, which is why the
            slope is a tenth of the oak's and the roughness spread is triple.
  laminate  the worktop. A fine orange-peel with a sparse scatter of darker
            mineral flecks -- what a commercial solid-surface top does under a
            shop light, and the reason a bare roughness scalar reads as plastic.
  paint     the kick panel: sprayed satin over MDF. Almost flat, with the faint
            long-period undulation a sprayed panel keeps and a very fine tooth.
  steel     club heads and shafts. Finer and tighter than brass, less directional.
  rubber    a grip. Moulded diamond tooth over a coarse matte base.

    used by tools/blender/hero/v5/counter.py, driver.py, putter.py, iron.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "v6"))

import weave as WV  # noqa: E402


# slope is relief / cell width -- the only thing a normal map encodes.
# cell_mm is the real size of one cell, used when a caller has no authored
# repeat and has to derive one from the part's span.
# metal is what goes in the ORM's blue channel.
HARD_FAMILY = {
    "oak":      dict(slope=0.055, cell_mm=26.0, seed=101, metal=0.0),
    "brass":    dict(slope=0.014, cell_mm=7.0, seed=102, metal=1.0),
    "laminate": dict(slope=0.030, cell_mm=11.0, seed=103, metal=0.0),
    # 18 mm was the wrong size by an order of magnitude and the driver render
    # said so: a painted crown came out PITTED, because an 18 mm cell of spray
    # tooth is a dent. Orange peel is about a millimetre, and at that size it
    # is a sheen variation rather than a surface feature.
    "paint":    dict(slope=0.008, cell_mm=1.4, seed=104, metal=0.0),
    "steel":    dict(slope=0.012, cell_mm=5.0, seed=105, metal=1.0),
    "rubber":   dict(slope=0.240, cell_mm=3.4, seed=106, metal=0.0),
    # A GRAPHITE SHAFT IS NOT A STEEL ONE, and hard.py says so in as many
    # words: "near-black composite with a hard, narrow highlight and NO
    # metallic response -- that is what separates it from a steel shaft at a
    # glance, and v4 gave both the same material." Name inference would have
    # walked straight back into that: "DriverShaft" contains "shaft", "shaft"
    # maps to steel, and steel writes 1.0 into the metallic channel. So the
    # clubs pass their families EXPLICITLY, and this exists to be passed.
    "graphite": dict(slope=0.010, cell_mm=4.0, seed=107, metal=0.0),
}

# Material-name fragment -> family. Printed at build time by the caller, never
# inferred silently: an unclassified surface must not quietly ship flat.
HARD_INFER = [
    ("oak", "oak"), ("wood", "oak"), ("timber", "oak"),
    ("brass", "brass"), ("bronze", "brass"),
    ("top", "laminate"), ("laminate", "laminate"), ("worktop", "laminate"),
    ("kick", "paint"), ("paint", "paint"), ("panel", "paint"),
    ("steel", "steel"), ("chrome", "steel"), ("head", "steel"),
    ("face", "steel"), ("hosel", "steel"), ("shaft", "steel"),
    ("ferrule", "steel"), ("crown", "steel"), ("sole", "steel"),
    ("cavity", "steel"), ("body", "steel"),
    ("grip", "rubber"), ("rubber", "rubber"),
]


def _value_noise_rect(px, nu, nv, seed):
    """weave._value_noise on a RECTANGULAR lattice, wrapped on both axes.

    THE FIRST CUT OF THIS FILE DID NOT HAVE IT, and the tile control caught the
    consequence in one line: anisotropy 1.02 on oak, 1.01 on brass, 1.00 on
    steel. weave's lattice is n x n, so the field is isotropic by construction,
    and transposing a square isotropic field -- which is what the first version
    did -- gives another isotropic field. There was no grain in the grain.

    Rows are v, columns are u, matching weave's convention.
    """
    rng = np.random.default_rng(seed)
    g = rng.random((max(2, nv), max(2, nu)))
    nv, nu = g.shape

    def axis(n):
        t = (np.arange(px) + 0.5) / px * n
        i0 = np.floor(t).astype(int) % n
        f = t - np.floor(t)
        return i0, (i0 + 1) % n, f * f * (3.0 - 2.0 * f)

    iv0, iv1, wv = axis(nv)
    iu0, iu1, wu = axis(nu)
    a = g[np.ix_(iv0, iu0)]
    b = g[np.ix_(iv0, iu1)]
    c = g[np.ix_(iv1, iu0)]
    d = g[np.ix_(iv1, iu1)]
    wv = wv[:, None]
    wu = wu[None, :]
    return (a * (1 - wv) * (1 - wu) + b * (1 - wv) * wu
            + c * wv * (1 - wu) + d * wv * wu)


def _fractal_rect(px, nu, nv, octaves, seed, gain=0.5):
    out = np.zeros((px, px))
    amp, tot = 1.0, 0.0
    for k in range(octaves):
        out += amp * _value_noise_rect(px, nu * (2 ** k), nv * (2 ** k),
                                       seed + k * 101)
        tot += amp
        amp *= gain
    return out / tot


def _aniso(px, cells, seed, along=14.0, octaves=4):
    """A field stretched ALONG u: fine detail across the grain, slow along it.

    `along` is how many times more slowly the field varies as you walk down the
    grain than across it, and it is delivered by the lattice rather than by a
    blur, so the tile stays exactly periodic on both axes.
    """
    nv = max(2, int(round(cells)))
    nu = max(2, int(round(cells / float(along))))
    return _fractal_rect(px, nu, nv, octaves, seed)


def _h_oak(px, cells, seed):
    """Quarter-sawn: straight grain along u, with rays crossing it.

    The grain lines are a hard-edged function of a slowly varying field, not a
    sine: real grain is a set of ARRIVING ring boundaries, unevenly spaced, and
    a sine gives a corduroy that reads as machining.
    """
    # THE TILE CONTROL PASSED THIS AND THE PICTURE FAILED IT. The first cut
    # took contour bands of an anisotropic field — `tri(base * 3.4)` — which
    # scores 2.93 on the anisotropy metric and looks like leopard print: the
    # contours of a 2D field close into loops, and a ring boundary in oak does
    # not close, it runs the length of the board. Numbers about a texture are
    # not a texture; the sheet had to be looked at.
    #
    # So the ring PHASE is a function of v — across the grain — perturbed
    # slowly along u. That makes lines that run the whole length of the tile
    # and wander the way sawn rings do.
    u, v = WV._uv(px)                                      # noqa: SLF001
    # 1.7 of wander made the rings SWIM: the studio render read as burl or as
    # water ripple, not as sawn oak. Quarter-sawn is the straightest cut there
    # is — that is the whole reason it is used for joinery — so the wander is
    # a fifth of a ring width, not two.
    wob = _aniso(px, cells, seed, along=30.0, octaves=3) - 0.5
    rings = WV._tri(v * cells + wob * 0.42) ** 1.7         # noqa: SLF001
    # medullary rays: short, bright, ACROSS the grain and sparse. The opposite
    # lattice to the rings — many cells along u, few across v.
    ray = _fractal_rect(px, max(2, cells * 3), 2, 2, seed + 3)
    ray = np.clip((ray - 0.62) * 3.0, 0.0, 1.0)
    # a very fine tooth so the top is not glassy between the rings
    tooth = WV._fractal(px, cells * 10, 2, seed + 5)       # noqa: SLF001
    return rings * 0.80 + ray * 0.14 + tooth * 0.06


def _h_brass(px, cells, seed):
    """Brushed: a directional streak, almost no relief."""
    streak = _aniso(px, cells * 4, seed, along=26.0, octaves=3)
    fine = WV._fractal(px, cells * 12, 2, seed + 2)        # noqa: SLF001
    return streak * 0.86 + fine * 0.14


def _h_laminate(px, cells, seed):
    """Orange peel with sparse mineral flecks."""
    peel = WV._fractal(px, cells * 3, 3, seed)             # noqa: SLF001
    fleck = WV._fractal(px, cells * 7, 1, seed + 4)        # noqa: SLF001
    fleck = np.clip((fleck - 0.70) * 3.6, 0.0, 1.0)
    return peel * 0.78 + fleck * 0.22


def _h_paint(px, cells, seed):
    """Sprayed satin: a long undulation and a very fine tooth."""
    # a sprayed panel keeps a faint long undulation, but at 0.62 of the field
    # it read as a stain rather than a finish. The tooth is what a satin spray
    # actually is.
    swell = WV._fractal(px, max(2, cells // 2), 2, seed)   # noqa: SLF001
    tooth = WV._fractal(px, cells * 9, 3, seed + 1)        # noqa: SLF001
    return swell * 0.26 + tooth * 0.74


def _h_steel(px, cells, seed):
    """A tighter, less directional brush than brass."""
    streak = _aniso(px, cells * 5, seed, along=18.0, octaves=3)
    fine = WV._fractal(px, cells * 14, 2, seed + 2)        # noqa: SLF001
    # 0.30 of isotropic fine noise diluted the direction to 1.41 and the tile
    # control called it: a brushed finish that is not directional is a matte
    # one. The fine tooth is still there, it just no longer outvotes the brush.
    return streak * 0.84 + fine * 0.16


def _h_rubber(px, cells, seed):
    """Moulded diamond tooth over a matte base."""
    u, v = WV._uv(px)                                      # noqa: SLF001
    a = WV._tri((u + v) * cells)                           # noqa: SLF001
    b = WV._tri((u - v) * cells)                           # noqa: SLF001
    diamond = np.minimum(a, b) ** 0.8
    base = WV._fractal(px, cells * 4, 2, seed)             # noqa: SLF001
    return diamond * 0.74 + base * 0.26


def _h_graphite(px, cells, seed):
    """A composite shaft under a clearcoat: a very fine weave-ish tooth, no
    brush direction, and almost no relief. It is the ROUGHNESS that reads."""
    fine = WV._fractal(px, cells * 8, 3, seed)             # noqa: SLF001
    u, v = WV._uv(px)                                      # noqa: SLF001
    # the faint bias of a wound composite, at a shallow angle
    # INTEGER PERIODS ON BOTH AXES OR IT DOES NOT WRAP. The first cut used
    # (u * 2.0 + v * 0.35) * cells, which is 2.8 periods across v at cells=8 —
    # so the tile did not join itself and the control read seamV 1.83, nearly
    # twice the tile's own internal step. Written as whole periods it cannot
    # drift when CELLS changes.
    wind = WV._tri(u * (2 * cells) + v * 3.0) ** 1.4       # noqa: SLF001
    return fine * 0.72 + wind * 0.28


HARD_HEIGHT = {
    "oak": _h_oak, "brass": _h_brass, "laminate": _h_laminate,
    "paint": _h_paint, "steel": _h_steel, "rubber": _h_rubber,
    "graphite": _h_graphite,
}


def bake(pairs, label=""):
    """Wire a whole asset's materials and print what each one became.

    `pairs` is (material, family, rough, span_mm). The family is EXPLICIT here
    rather than inferred, because the one place inference is dangerous is a
    club: "DriverShaft" contains "shaft" and a graphite shaft is not steel.
    """
    register()
    rows = []
    for mat, family, rough, span_mm in pairs:
        info = wire(mat, family=family, rough=rough, span_mm=span_mm)
        rows.append((mat.name, info))
        print("  %-16s -> %-9s x%-6.1f rough %.2f  metal %.1f"
              % (mat.name, info["family"], info["repeat"], info["rough"],
                 WV.FAMILY[info["family"]].get("metal", 0.0)))
    if label:
        print("  %s: %d materials mapped" % (label, len(rows)))
    return rows


def _metal_aware_maps(family, rough, px=WV.PX, cells=WV.CELLS):
    """weave.maps_for, plus the metal channel a hard surface needs.

    The fabric version writes zero into ORM blue because a knit is always a
    dielectric, and wire() links blue to Metallic. A brass rail through that
    path is a dielectric with a brass tint -- which is the one thing brass must
    not be, and it is the sort of silent wrongness that only shows up under a
    moving light.
    """
    h, nrm, orm = _ORIGINAL_MAPS_FOR(family, rough, px=px, cells=cells)
    spec = WV.FAMILY[family]
    metal = float(spec.get("metal", 0.0))
    if metal:
        orm = orm.copy()
        orm[..., 2] = metal
    return h, nrm, orm


_ORIGINAL_MAPS_FOR = WV.maps_for


def register():
    """Put the hard families into weave's tables. Idempotent."""
    WV.FAMILY.update(HARD_FAMILY)
    WV.HEIGHT.update(HARD_HEIGHT)
    for pair in reversed(HARD_INFER):
        if pair not in WV.INFER:
            WV.INFER.insert(0, pair)
    if WV.maps_for is not _metal_aware_maps:
        WV.maps_for = _metal_aware_maps
        # atlas() closes over the module global, so it picks this up too
    return sorted(HARD_FAMILY)


def wire(mat, family=None, rough=None, span_mm=None, strength=1.0):
    """Wire one hard material, deriving the repeat from the part's real span.

    `span_mm` is how many millimetres of surface the UV 0..1 covers, so the
    tile lands at its authored cell size instead of an invented one. A 2.4 m
    counter front and a 12 mm ferrule cannot share a repeat and must not have
    to share a caller.
    """
    register()
    fam = family or WV.family_of(mat.name)
    r = 0.40 if rough is None else float(rough)
    repeat = WV.repeat_for(fam, None, span_mm if span_mm else 300.0)
    # A tile repeated more than ~64 times across a part is smaller than a texel
    # at any distance the player sees it from, and reads as noise.
    repeat = max(1.0, min(64.0, repeat))
    return WV.wire(mat, fam, r, repeat, strength=strength)
