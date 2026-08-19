"""GROUND MAPS THAT REACH THE GAME: tileable albedo + normal, built in numpy.

Step one of the course. The player looks at these surfaces for most of every
outdoor frame, and today they are one Poly Haven photograph of a LEAFY MEADOW
(`leafy_grass`) doing fairway, semi, tee, green, fringe, rough and heavy rough,
separated only by a tint and a UV scale -- and the shader's FW_STYLIZE reduces
even that photograph to its luminance, so its colour never reaches the frame.
There is no roughness map at all: roughness is a per-zone constant, which is why
wet turf darkens without ever going glossy.

METHOD: weave.py, unchanged in principle
----------------------------------------
`tools/blender/hero/v6/weave.py` takes ONE periodic height field per family and
derives everything else from it and from nothing else, so the maps cannot
disagree. `tools/blender/hero/v7/surface.py` then showed the same machinery is
not about cloth: quarter-sawn oak went through it. Turf is another height field.

What is different here, and why this is a separate module rather than another
registration into weave: weave writes bpy Images for a glTF bake, and terrain is
not a glTF asset. These are PNG files the renderer loads with TextureLoader. The
primitives below are the same ones (periodic value noise on a RECTANGULAR
lattice -- a square lattice is isotropic by construction and there would be no
grain in the grain), reimplemented because weave imports bpy.

PACKING, and why it is not three files per surface
--------------------------------------------------
The terrain shader is close to WebGL's 16 active texture units: five data
textures, seven ground textures, two RectAreaLight LTC lookups. Three maps for
each of four surfaces would be twelve units for the ground alone and the
material would fail to link on 16-unit hardware. So:

    <surface>_alb.png   RGB = albedo (sRGB)        A = roughness (linear)
    <surface>_nrm.png   RG  = normal xy (linear)   B = occlusion   A = height

Normal z is reconstructed in the shader as sqrt(1 - x^2 - y^2), which is exact
for a unit normal and is what frees the blue channel. Eight units for four
surfaces, one more than the seven they replace.

THE FOUR SURFACES, and what each height field is FOR
----------------------------------------------------
  turf_close  fairway, semi, tee, green, fringe. Cut between 3 and 12 mm, so the
              structure the eye gets is the LAY of the blades, not the blades.
              Strongly anisotropic: fine across the lay, slow along it.
  turf_rough  rough, heavy rough, and the scrub band. Uncut, so it is clumps --
              tillers standing 30-60 mm with real shadow between them, and much
              less directional because nothing has rolled it flat.
  sand        bunker sand. Fine grain over the long shallow swell a rake leaves.
  hard        the cart path and the dirt zones: concrete with exposed aggregate.

MOW DIRECTION IS NOT IN THESE TILES. It cannot be: the direction changes per
cell across the hole. The tile carries the lay ALONG ITS OWN U AXIS, and the
shader rotates the sample UV into the flow field's direction. That is what makes
the mowing follow the mower's path rather than sit on the screen.

  python tools/course/turf.py            # write vendor/textures/ground/
  python tools/course/turf_control.py    # look at what was written
"""

import math
import os

import numpy as np

PX = 512
# One tile covers one metre of ground. At 512 px that is 1.95 mm per texel: a
# grass blade is 2-5 mm across, so the lay is resolvable and the clumping is
# comfortably so. A wider tile was the first instinct -- the shader's fairway UV
# is a 6.25 yd repeat -- but 5.6 mm per texel cannot hold a blade, and a turf
# tile with no blade in it is the flat field this work exists to fix.
TILE_M = 1.0

OUT = os.path.join("vendor", "textures", "ground")


# ---------------------------------------------------------------------------
# periodic primitives (weave.py / v7 surface.py, reimplemented without bpy)

def _value_noise_rect(px, nu, nv, seed):
    """Value noise on a RECTANGULAR lattice, wrapped on both axes.

    Rectangular is the whole point. A square lattice is isotropic by
    construction, and v7's tile control caught exactly that: anisotropy 1.02 on
    a wood grain that was supposed to run 14:1.
    """
    rng = np.random.default_rng(seed)
    g = rng.random((max(2, int(nv)), max(2, int(nu))))
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
        out += amp * _value_noise_rect(px, nu * (2 ** k), nv * (2 ** k), seed + k * 101)
        tot += amp
        amp *= gain
    return out / tot


def _aniso(px, across, along_ratio, octaves, seed):
    """A field with `across` features across the tile and `along_ratio` times
    fewer along u -- so it streaks along u. Delivered by the lattice, not by a
    blur, so the tile stays exactly periodic."""
    nv = max(2, int(round(across)))
    nu = max(2, int(round(across / float(along_ratio))))
    return _fractal_rect(px, nu, nv, octaves, seed)


def _blur(h, sigma_px):
    """Periodic Gaussian blur, in the Fourier domain so the wrap is exact and
    the occlusion does not develop a seam the tiling repeats forever."""
    px = h.shape[0]
    fv = np.fft.fftfreq(px)[:, None]
    fu = np.fft.rfftfreq(px)[None, :]
    g = np.exp(-2.0 * (math.pi ** 2) * (sigma_px ** 2) * (fu ** 2 + fv ** 2))
    return np.fft.irfft2(np.fft.rfft2(h) * g, s=(px, px))


def _unit(h):
    lo, hi = float(h.min()), float(h.max())
    return (h - lo) / (hi - lo) if hi - lo > 1e-9 else np.zeros_like(h)


def _srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * (c ** (1 / 2.4)) - 0.055)


# ---------------------------------------------------------------------------
# the height fields

def _h_turf_close(px, seed, lay=9.0, blade_mm=3.2, clump_mm=55.0, blade_w=0.62):
    """Mown turf: the LAY of the blades over a clumping ground.

    A 3 mm blade lying at 10-20 degrees is nine or ten times longer than it is
    wide in plan, which is the `lay` ratio. Sharpened with a power because a
    blade is a ridge with a crest, not a sine; raised, not centred, because the
    gaps between blades are where the light does not reach and that is the whole
    of what a normal map has to say about turf.
    """
    per_m = 1000.0 / TILE_M
    blades = _aniso(px, per_m / blade_mm, lay, 3, seed)
    blades = _unit(blades) ** 2.1
    clump = _fractal_rect(px, per_m / clump_mm, per_m / clump_mm, 3, seed + 41)
    # A faint second lay at a few degrees off: a real mower's roller does not lay
    # every blade the same way, and a single perfectly parallel field reads as
    # brushed metal rather than as grass.
    cross = _unit(_aniso(px, per_m / (blade_mm * 2.4), lay * 0.28, 2, seed + 77)) ** 1.6
    return _unit(blade_w * blades + 0.24 * cross + (1.0 - blade_w - 0.24) * _unit(clump))


def _h_turf_rough(px, seed, clump_mm=42.0, lay=1.9):
    """Uncut grass is CLUMPS, not a lay. Tillers stand in tufts with real
    shadow between them, and nothing has rolled them into a direction -- so this
    is near-isotropic where the mown tile is 9:1, and its relief is four times
    as deep."""
    per_m = 1000.0 / TILE_M
    tufts = _fractal_rect(px, per_m / clump_mm, per_m / clump_mm, 4, seed)
    tufts = _unit(tufts) ** 1.35
    stalks = _unit(_aniso(px, per_m / 5.5, lay, 3, seed + 19)) ** 1.8
    fine = _fractal_rect(px, per_m / 2.2, per_m / 2.2, 2, seed + 63)
    return _unit(0.54 * tufts + 0.32 * stalks + 0.14 * fine)


def _h_sand(px, seed, ripple_mm=95.0, grain_mm=1.6):
    """Raked sand: a long shallow swell from the rake's tines with a fine grain
    over it. The swell is the only directional thing in a bunker.

    THE FIRST CUT RENDERED AS CORRUGATED IRON, and the numbers were all green
    when it did. A pure cosine at 62% of the field gives every groove the same
    depth, the same width and the same phase across the whole metre, which is a
    roof, not sand. Three changes, all of them about IRREGULARITY rather than
    amplitude: the phase wanders along the groove so no two are parallel for
    long, the depth is modulated per groove, and the grain is given the majority
    of the field back. The rake is still legible; it is no longer machined.
    """
    per_m = 1000.0 / TILE_M
    n = max(1, int(round(TILE_M * 1000.0 / ripple_mm)))
    u = ((np.arange(px) + 0.5) / px)[None, :]
    v = ((np.arange(px) + 0.5) / px)[:, None]
    # ALONG u, like every other tile here, because the shader rotates all four
    # into the same world direction. The first cut varied the swell with u
    # instead of v, which put the rake grooves at ninety degrees to the lay and
    # measured as anisotropy 0.99 -- a bunker with no rake in it.
    # Integer periods per tile or it does not wrap, and a bunker that prints its
    # seam repeats a grid across every trap on the course.
    wander = _fractal_rect(px, 4, 2, 2, seed + 5) - 0.5     # slow along the groove
    phase = v + wander * (0.9 / n)                          # under one groove of drift
    wave = 0.5 + 0.5 * np.cos(2.0 * math.pi * n * phase)
    depth = 0.55 + 0.45 * _fractal_rect(px, 2, max(2, n // 2), 2, seed + 9)
    wave = wave * depth * (0.55 + 0.45 * (0.5 + u * 0.0))   # keep shape, no u term
    grain = _fractal_rect(px, per_m / grain_mm, per_m / grain_mm, 2, seed)
    swell = _fractal_rect(px, 5, 5, 2, seed + 31)           # the bunker floor itself
    return _unit(0.30 * wave + 0.52 * grain + 0.18 * swell)


def _h_hard(px, seed, agg_mm=7.0):
    """Broom-finished concrete with exposed aggregate: stones sitting in a
    matrix, and the faint parallel tooth a broom leaves across the pour."""
    per_m = 1000.0 / TILE_M
    stones = _fractal_rect(px, per_m / agg_mm, per_m / agg_mm, 2, seed)
    stones = _unit(stones)
    stones = np.clip((stones - 0.52) / 0.48, 0.0, 1.0) ** 0.7   # only the proud ones
    broom = _unit(_aniso(px, per_m / 2.6, 26.0, 2, seed + 11))
    matrix = _fractal_rect(px, per_m / 90.0, per_m / 90.0, 3, seed + 23)
    return _unit(0.50 * stones + 0.16 * broom + 0.34 * _unit(matrix))


# ---------------------------------------------------------------------------
# the surfaces
#
# `relief_mm` is how far the surface actually rises from its lowest point to its
# highest WITHIN THE TILE, in millimetres. weave states its slope as relief over
# CELL width because a knit cell is the unit there; a turf tile has no cell, so
# the honest statement is the physical relief against the physical texel, and
# the shader's normal follows from the two.
#
# The first cut wrote `slope` as relief-over-TILE and multiplied the central
# difference by px. For a feature four texels wide on a 512 tile that is a
# hundred-fold overstatement, and the control read a normal-xy spread of 0.89 --
# every normal lying almost flat on its side. Turf would have shaded like
# crumpled foil.
#
# `albedo` is sampled off the reference boards in Designs/Course/Ground and
# written here in sRGB. `spread` is how far the tile's own colour departs from
# it: blade crowns are lighter and yellower where the sun catches them, the
# shaded base is darker and bluer, and a turf with no chroma spread at all is
# the flat colour field this work exists to fix.

SURFACES = {
    "turf_close": dict(
        height=_h_turf_close, seed=101, relief_mm=2.2, rough=0.86, rough_spread=0.10,
        albedo=(0.330, 0.512, 0.238), warm=(0.070, 0.056, -0.032), spread=0.62,
        ao_strength=0.42,
        note="fairway / semi / tee / green / fringe -- the lay runs along +u",
        ref="Designs/Course/Ground/fairway/hole_and_path.jpg, turf_close/sod_farm.jpg",
    ),
    "turf_rough": dict(
        height=_h_turf_rough, seed=202, relief_mm=7.5, rough=0.93, rough_spread=0.06,
        albedo=(0.262, 0.386, 0.162), warm=(0.098, 0.068, -0.016), spread=0.74,
        ao_strength=0.72,
        note="rough / heavy / scrub -- clumped, four times the relief, near-isotropic",
        ref="Designs/Course/Ground/rough/halle_westf.jpg, fairway/hole_and_path.jpg (left of the path)",
    ),
    "sand": dict(
        height=_h_sand, seed=303, relief_mm=1.4, rough=0.74, rough_spread=0.08,
        albedo=(0.862, 0.836, 0.772), warm=(0.026, 0.013, -0.018), spread=0.16,
        ao_strength=0.22,
        note="bunker sand -- near white and barely saturated, NOT the orange tan the shader used",
        ref="Designs/Course/Ground/bunker/atalaya.jpg",
    ),
    "hard": dict(
        height=_h_hard, seed=404, relief_mm=1.7, rough=0.85, rough_spread=0.13,
        albedo=(0.672, 0.662, 0.634), warm=(0.028, 0.019, 0.008), spread=0.38,
        ao_strength=0.55,
        note="cart path concrete -- a light neutral grey, not the warm dirt the path zone tinted",
        ref="Designs/Course/Ground/fairway/hole_and_path.jpg, path/metairie.jpg",
    ),
}


def maps_for(name, px=PX):
    """One height field in, an albedo+roughness pair and a normal+occlusion pair
    out, derived from it and from nothing else."""
    s = SURFACES[name]
    h = _unit(s["height"](px, s["seed"]))

    # NORMAL. Central differences per TEXEL, scaled by the tile's stated relief
    # over the texel's own width -- a real slope in millimetres per millimetre.
    # Only xy is stored; z is reconstructed in the shader, which is exact for a
    # unit normal and is what frees blue for occlusion.
    texel_mm = TILE_M * 1000.0 / px
    k = s["relief_mm"] / texel_mm      # millimetres of rise per millimetre across
    du = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dv = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx, ny, nz = -du * k, -dv * k, np.ones_like(h)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm_x, nrm_y = nx * inv, ny * inv

    # OCCLUSION. How far a texel sits below its own neighbourhood, at two radii,
    # so both the gap between two blades and the broader hollow between two
    # clumps darken. Under a sky-dominated outdoor light this channel does more
    # work than the normal does: a normal needs a specular highlight to show,
    # and turf has almost none.
    r = px * 0.02
    cav = np.maximum(_blur(h, r) - h, _blur(h, r * 3.0) - h)
    cav = np.clip(cav / max(float(cav.max()), 1e-6), 0.0, 1.0)
    ao = np.clip(1.0 - s["ao_strength"] * cav, 0.0, 1.0)

    # ROUGHNESS. Rougher down in the cavity where the light scatters among
    # stems, smoother on the crown that has been rolled or worn.
    grain = _fractal_rect(px, px / 12, px / 12, 2, s["seed"] + 7) - 0.5
    rg = np.clip(s["rough"] + s["rough_spread"] * (cav - 0.35 * h + 0.4 * grain), 0.05, 1.0)

    # ALBEDO. The authored colour, moved along a warm axis by height: crowns
    # catch the sun and go lighter and yellower, the shaded base goes darker and
    # a little bluer. Built in LINEAR light and converted at the end, because
    # mixing two colours in sRGB darkens the mid-tone and turf is mostly
    # mid-tone.
    base = _srgb_to_linear(np.array(s["albedo"]))
    warm = np.array(s["warm"])
    t = (h - 0.5)[..., None]
    alb = base[None, None, :] * (1.0 + s["spread"] * t * 1.6) + warm[None, None, :] * t * s["spread"]
    # A little of the occlusion belongs in the albedo too: what a photograph of
    # turf records between the blades is not only less light arriving, it is
    # light that bounced twice off something green and came back darker.
    alb = alb * (0.62 + 0.38 * ao)[..., None]
    alb = _linear_to_srgb(np.clip(alb, 0.0, 1.0))

    return dict(h=h, albedo=alb, rough=rg, nx=nrm_x, ny=nrm_y, ao=ao)


def write(name, out_dir=OUT, px=PX):
    from PIL import Image
    m = maps_for(name, px)
    os.makedirs(out_dir, exist_ok=True)

    a = np.empty((px, px, 4), np.float64)
    a[..., :3] = m["albedo"]
    a[..., 3] = m["rough"]
    alb_path = os.path.join(out_dir, f"{name}_alb.png")
    Image.fromarray((np.clip(a, 0, 1) * 255.0 + 0.5).astype(np.uint8), "RGBA").save(alb_path)

    n = np.empty((px, px, 4), np.float64)
    n[..., 0] = m["nx"] * 0.5 + 0.5
    n[..., 1] = m["ny"] * 0.5 + 0.5
    n[..., 2] = m["ao"]
    n[..., 3] = m["h"]
    nrm_path = os.path.join(out_dir, f"{name}_nrm.png")
    Image.fromarray((np.clip(n, 0, 1) * 255.0 + 0.5).astype(np.uint8), "RGBA").save(nrm_path)
    return alb_path, nrm_path


def main():
    import sys
    print(f"tile {TILE_M} m at {PX} px = {TILE_M * 1000.0 / PX:.2f} mm/texel")
    for name in SURFACES:
        alb, nrm = write(name)
        s = SURFACES[name]
        print(f"  {name:11s} relief {s['relief_mm']:.1f} mm  rough {s['rough']:.2f}  -> "
              f"{os.path.basename(alb)}, {os.path.basename(nrm)}")
        print(f"              {s['note']}")
    print(f"  wrote {write_js()}")




# ---------------------------------------------------------------------------
# THE RATIO MATCH, and why the zone tints are not simply replaced
#
# The old shader wrote `col = (0.46 + luma(tex) * 1.28) * tint`. That reduces a
# photograph to its luminance -- the reason seven surfaces off one leafy-meadow
# image looked like seven flat colour fields -- but the TINTS themselves were
# tuned in the game, by eye, for legibility from the tee, and throwing that away
# would be a second mistake on top of the first.
#
# So each zone keeps its tuned MEAN exactly. The multiplier below is
# target / tile_mean, in linear light, so the authored tile's average lands on
# the old average and every per-texel departure from that average -- the part
# that was being discarded -- survives into the frame.
#
# `target` is the OLD mean output for the turf zones: the tuned tint times the
# mean of that stylize factor over the photograph it was tuned against
# (fairway_diff 0.7750, rough_diff 0.5294, scrub_diff 0.5934, path_diff 0.6155).
# Sand and the cart path DEPART deliberately: the bunker board shows sand is
# near-white and barely saturated where the old tint was a warm tan, and the
# path board shows light neutral concrete where the old one was warm dirt.

ZONES = {
    # zone id in the shader   surface        target mean (LINEAR)          note
    "fair":     ("turf_close", (0.1163, 0.2519, 0.0620), "tuned parkland fairway, unchanged"),
    "semi":     ("turf_close", (0.1124, 0.2131, 0.0574), "first cut, unchanged"),
    "green":    ("turf_close", (0.1395, 0.2790, 0.0636), "unchanged"),
    "fringe":   ("turf_close", (0.1163, 0.2325, 0.0543), "unchanged"),
    "tee":      ("turf_close", (0.1302, 0.2635, 0.0651), "unchanged"),
    "rough":    ("turf_rough", (0.0768, 0.1244, 0.0434), "unchanged"),
    "heavy":    ("turf_rough", (0.0900, 0.1191, 0.0450), "unchanged"),
    "scrub":    ("turf_rough", (0.1009, 0.1335, 0.0593), "native, unchanged"),
    "bed":      ("turf_rough", (0.1365, 0.0890, 0.0534), "dark mulch, unchanged"),
    "waterbed": ("turf_rough", (0.0771, 0.1216, 0.0534), "unchanged"),
    "sand":     ("sand",       None,                     "DEPARTS: the tile's own near-white, off bunker/atalaya.jpg"),
    "dirt":     ("hard",       (0.2585, 0.1908, 0.1231), "worn earth, unchanged"),
    "path":     ("hard",       None,                     "DEPARTS: the tile's own light concrete, off fairway/hole_and_path.jpg"),
}


def tile_mean_linear(name, px=PX):
    m = maps_for(name, px)
    return _srgb_to_linear(m["albedo"]).reshape(-1, 3).mean(axis=0)


def write_js(path=os.path.join("src", "data", "groundTiles.js"), px=PX):
    means = {n: tile_mean_linear(n, px) for n in SURFACES}
    L = []
    L.append("// GENERATED by `python tools/course/turf.py --js`. Do not hand-edit:")
    L.append("// tests/ground-tiles-match-their-maps.test.js reads the PNGs and fails on a diff.")
    L.append("//")
    L.append("// The ground surfaces the player looks at for most of every outdoor frame.")
    L.append("// Each is a periodic height field with a normal, an occlusion and a roughness")
    L.append("// derived from it and from nothing else (tools/course/turf.py), sized against")
    L.append("// the photographs in Designs/Course/Ground.")
    L.append("")
    L.append(f"export const GROUND_TILE_M = {TILE_M};")
    L.append(f"export const GROUND_TILE_PX = {px};")
    L.append("")
    L.append("export const GROUND_TILES = {")
    for n, s in SURFACES.items():
        mu = means[n]
        L.append(f"  {n}: {{")
        L.append(f"    albedo: 'ground/{n}_alb.png',   // RGB colour (sRGB), A roughness")
        L.append(f"    normal: 'ground/{n}_nrm.png',   // RG normal xy, B occlusion, A height")
        L.append(f"    reliefMm: {s['relief_mm']},")
        L.append(f"    roughness: {s['rough']},")
        L.append(f"    meanLinear: [{mu[0]:.5f}, {mu[1]:.5f}, {mu[2]:.5f}],")
        L.append(f"    note: {s['note']!r},".replace("'", '"'))
        L.append(f"    reference: {s['ref']!r},".replace("'", '"'))
        L.append("  },")
    L.append("};")
    L.append("")
    L.append("// zone -> [surface, multiplier]. multiplier = target mean / tile mean, in")
    L.append("// linear light, so the tile's AVERAGE lands on the colour that was tuned in")
    L.append("// the game and its variation is what is new. See ZONES in turf.py.")
    L.append("export const GROUND_ZONES = {")
    for z, (surf, target, note) in ZONES.items():
        mu = means[surf]
        mul = np.ones(3) if target is None else np.array(target) / np.maximum(mu, 1e-6)
        L.append(f"  {z}: {{ surface: '{surf}', mul: [{mul[0]:.4f}, {mul[1]:.4f}, {mul[2]:.4f}] }},"
                 f"  // {note}")
    L.append("};")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write("\n".join(L) + "\n")
    return path


if __name__ == "__main__":
    main()
