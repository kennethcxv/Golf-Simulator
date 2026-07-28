"""Palette values and the sRGB-hex to linear conversion, with no Blender dependency.

This module exists because the conversion it holds was got wrong in production.
`Designs/ProShop/Spike/TEXTURE_VALIDATION.md` Arm C authored `#6B4A2F` medium
walnut by dividing the hex bytes by 255 and writing the result straight into a
glTF `baseColorFactor`.  glTF `baseColorFactor` is **linear**, not sRGB, so the
surface shipped as `#AD9377` — a washed-out tan two stops light of the intended
walnut.  Nothing in the pipeline objected.

Splitting it out of :mod:`assets_51_100_lib` (which imports ``bpy`` at module
scope and therefore only runs inside Blender) makes the conversion importable by
a plain-Python test.  See ``tests/palette-colorspace.test.js``.

Everything here is pure Python: no ``bpy``, no I/O, no globals.
"""

from __future__ import annotations

from typing import Mapping

__all__ = [
    "PALETTE_SRGB_HEX",
    "ART_BIBLE_SRGB_HEX",
    "srgb_channel_to_linear",
    "linear_channel_to_srgb",
    "hex_to_linear_rgba",
    "hex_to_srgb_floats",
]


# The palette the Sheet 6-10 builders have shipped since the assets 51-100 pass.
# NOT identical to ART_BIBLE_SRGB_HEX below — see the note on that table.
PALETTE_SRGB_HEX: Mapping[str, str] = {
    "warm_cream": "E8DFC9",
    "deep_green": "173F32",
    "muted_sage": "829681",
    "medium_walnut": "704934",
    "natural_oak": "B98A59",
    "warm_charcoal": "292C2A",
    "restrained_brass": "9B7A3B",
    "brushed_steel": "737B7C",
    "soft_black": "111513",
    "rubber": "171B19",
    "paper": "EEE9DC",
    "safety_red": "9E2F2B",
    "safety_yellow": "C9A33B",
    "cool_white": "DDE4E0",
    "glass_tint": "B8D0C9",
}


# `Designs/ProShop/ART_BIBLE.md` §8, verbatim.  This is the authority for the
# pro-shop slice.  It is deliberately a SEPARATE table from PALETTE_SRGB_HEX:
# the two disagree on most entries, and silently retinting fifty already-shipped
# assets is not a texture-infrastructure change.  Reconciling them is Phase 3
# work; until then a builder states which table it is drawing from.
ART_BIBLE_SRGB_HEX: Mapping[str, str] = {
    "warm_cream": "E8DFC9",
    "plaster_shadow": "CFC6B0",
    "medium_walnut": "6B4A2F",
    "dark_walnut": "3E2A1B",
    "deep_green": "2F4A35",
    "deep_green_shadow": "21351F",
    "sage_green": "9FB09A",
    "charcoal": "2B2E30",
    "black_powder_coat": "1C1E1F",
    "muted_brass": "A8823C",
    "warm_panel_light": "FFD8AD",
    "dead_diffuser": "C9C1B3",
}


def srgb_channel_to_linear(value: float) -> float:
    """One sRGB channel in 0..1 to linear.  The IEC 61966-2-1 EOTF.

    Not a gamma 2.2 power curve and not ``value ** 2.2``: the standard has a
    linear toe below 0.04045.  For the dark end of this palette the difference
    is visible, so the piecewise form is the one that ships.
    """
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def linear_channel_to_srgb(value: float) -> float:
    """Inverse of :func:`srgb_channel_to_linear`.  Used to check round trips."""
    return value * 12.92 if value <= 0.0031308 else 1.055 * (value ** (1 / 2.4)) - 0.055


def _parse_hex(value: str) -> tuple[float, float, float]:
    value = value.strip().lstrip("#")
    if len(value) != 6:
        raise ValueError(f"expected six-digit hex color, got {value!r}")
    return tuple(int(value[index: index + 2], 16) / 255.0 for index in (0, 2, 4))  # type: ignore[return-value]


def hex_to_srgb_floats(value: str) -> tuple[float, float, float]:
    """Hex to 0..1 sRGB floats.  This is the value that is NOT a baseColorFactor.

    Exposed so the wrong answer has a name.  Writing this into a glTF
    ``baseColorFactor``, a Blender Base Color socket, or a ``THREE.Color`` set
    with ``setRGB(..., LinearSRGBColorSpace)`` is the Arm C bug.
    """
    return _parse_hex(value)


def hex_to_linear_rgba(value: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    """Hex sRGB to the linear RGBA a glTF ``baseColorFactor`` expects.

    Blender's Principled Base Color socket is also linear, so this is equally
    the correct value to assign there before export.
    """
    return (*(srgb_channel_to_linear(channel) for channel in _parse_hex(value)), float(alpha))
