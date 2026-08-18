"""WHICH STEP WIPES A GENERATED IMAGE? The tile PNGs saved out solid black.

The control reported fifteen green numbers computed in numpy, and then the
image written from those same numbers was empty -- so the numbers were true and
the thing that ships was not, which is the failure mode this whole project
keeps hitting. Read the buffer back after each step and find where it dies.

    blender --factory-startup -b --python probe_image_write.py
"""

import os

import bpy
import numpy as np

W = 8
OUT = os.path.join(os.path.expanduser("~"), "probe_img")
os.makedirs(OUT, exist_ok=True)


def payload():
    b = np.zeros((W, W, 4), np.float32)
    b[..., 0] = 0.25
    b[..., 1] = 0.50
    b[..., 2] = 0.75
    b[..., 3] = 1.0
    return b


def peek(img, tag):
    buf = np.empty(W * W * 4, np.float32)
    img.pixels.foreach_get(buf)
    b = buf.reshape(W, W, 4)
    print("    %-34s r=%.3f g=%.3f b=%.3f" % (tag, b[..., 0].mean(),
                                              b[..., 1].mean(),
                                              b[..., 2].mean()))


def run(order):
    name = "probe_" + order
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, W, W, alpha=False, float_buffer=False)
    print("  %s" % order)
    if "cs_first" in order:
        img.colorspace_settings.name = "Non-Color"
        peek(img, "after colorspace, before pixels")
    img.pixels.foreach_set(payload().ravel())
    peek(img, "after foreach_set")
    if "update" in order:
        img.update()
        peek(img, "after update()")
    if "cs_last" in order:
        img.colorspace_settings.name = "Non-Color"
        peek(img, "after colorspace")
    path = os.path.join(OUT, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    peek(img, "after save()")
    # And read the FILE back, which is the only thing that matters.
    back = bpy.data.images.load(path)
    buf = np.empty(W * W * 4, np.float32)
    back.pixels.foreach_get(buf)
    b = buf.reshape(W, W, 4)
    print("    %-34s r=%.3f g=%.3f b=%.3f   <- from the file"
          % ("reloaded", b[..., 0].mean(), b[..., 1].mean(), b[..., 2].mean()))
    print()


print("\nwanted r=0.250 g=0.500 b=0.750 at every step\n")
run("cs_last_update")
run("cs_first_update")
run("cs_first_noupdate")
run("cs_last_noupdate")
