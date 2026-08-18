"""A camera that frames a WIDTH, not a subject.

`studio.shots` computes its distance with `hero_lib.fit_view(subject, ...)`, so
the `radius` argument only aims the cyc and the lights -- the framing always
fits the whole subject list. Asking for a close-up by passing a smaller radius
does nothing at all, and that is how the towel's waffle came to be reported
missing: the "detail" frame spanned the full 300 mm stack, where 1.9 mm of
relief is four pixels. The relief was there the whole time.

So: state the field width in millimetres and let the distance follow.

    d = (w / 2) / tan(hfov / 2),   hfov = 2 atan(sensor / (2 * lens))

`sensor` is Blender's default 36 mm on the horizontal fit. If the render is
taller than it is wide the sensor fit flips, so the vertical case is handled
rather than assumed.
"""

import math
import os

from mathutils import Vector

import hero_lib as H
import studio as ST

SENSOR = 36.0


def macro(subject, look, width_mm, out, plan, res=(1200, 900), lens=85.0):
    """Render `plan` framing exactly `width_mm` across the frame.

    plan entries are (tag, azimuth, elevation).
    """
    w = width_mm / 1000.0
    aspect = res[0] / float(res[1])
    # Blender fits the sensor to the LONGER side
    if aspect >= 1.0:
        hfov = 2.0 * math.atan(SENSOR / (2.0 * lens))
    else:
        hfov = 2.0 * math.atan((SENSOR * aspect) / (2.0 * lens))
    dist = (w * 0.5) / math.tan(hfov * 0.5)

    paths = []
    for tag, az, el in plan:
        a, e = math.radians(az), math.radians(el)
        d = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a),
                    math.sin(e)))
        ST.aim_cyc(look, max(w, 0.05), -d)
        ST.aim_lights(look, az)
        cam = H.camera("cam_" + tag, Vector(look) + d * dist, look, lens=lens)
        paths.append(H.render(cam, os.path.join(out, "%s.png" % tag), res=res))
        print("  macro %-16s %6.1f mm across, camera %.3f m out" % (tag, width_mm, dist))
    return paths


def field_width(res, lens, dist):
    """What a frame actually spans, for checking a claim after the fact."""
    aspect = res[0] / float(res[1])
    hfov = 2.0 * math.atan((SENSOR if aspect >= 1.0 else SENSOR * aspect)
                           / (2.0 * lens))
    return 2.0 * dist * math.tan(hfov * 0.5) * 1000.0
