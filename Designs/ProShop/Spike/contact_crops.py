"""THROWAWAY spike tool — floor-contact close-ups across lighting arms.

    python Designs/ProShop/Spike/contact_crops.py

Whole-frame meanAbs is the wrong metric for "does this object sit on the ground".
This crops the places where geometry meets the floor and puts the arms side by side at
2x so the contact region can be judged directly.

Writes Designs/ProShop/Spike/lighting/contact/<name>.png, one strip per contact point,
and prints the mean luminance of each crop so the darkening is quantified where it
matters rather than across a frame that is mostly wall and ceiling.
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), 'lighting')
OUT = os.path.join(ROOT, 'contact')
ARMS = ['0', '3', '4', '5']
LABEL = {
    '0': 'arm0 control',
    '3': 'arm3 key light',
    '4': 'arm4 strong GTAO',
    '5': 'arm5 both',
}

# (name, shot file, crop box) — each box frames geometry meeting the floor.
CONTACTS = [
    ('display-table-legs', '09-floor-dirt-read.png', (120, 430, 620, 780)),
    ('bench-base', '09-floor-dirt-read.png', (1100, 330, 1500, 610)),
    ('table-legs-midroom', '07-cleaning-route.png', (380, 560, 880, 890)),
    ('snack-rack-base', '07-cleaning-route.png', (1030, 600, 1530, 890)),
    ('counter-plinth', '02-wide-room-overview.png', (680, 450, 1180, 750)),
    ('shelving-base', '06-main-merchandise-wall.png', (0, 430, 500, 780)),
]

ZOOM = 2


def luma(img):
    px = img.load()
    w, h = img.size
    tot = 0.0
    n = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            tot += 0.2126 * r + 0.7152 * g + 0.0722 * b
            n += 1
    return tot / max(1, n)


def main():
    os.makedirs(OUT, exist_ok=True)
    print('%-24s %10s %10s %10s %10s' % ('contact point', 'arm0', 'arm3', 'arm4', 'arm5'))
    for name, shot, box in CONTACTS:
        crops = []
        lumas = []
        for a in ARMS:
            p = os.path.join(ROOT, f'arm{a}', shot)
            if not os.path.exists(p):
                crops.append(None)
                lumas.append(None)
                continue
            c = Image.open(p).convert('RGB').crop(box)
            lumas.append(luma(c))
            crops.append(c.resize((c.width * ZOOM, c.height * ZOOM), Image.LANCZOS))
        live = [c for c in crops if c]
        if not live:
            continue
        cw, chh = live[0].size
        canvas = Image.new('RGB', (cw * len(live) + 8 * (len(live) - 1), chh + 28), (18, 18, 18))
        d = ImageDraw.Draw(canvas)
        for i, c in enumerate(crops):
            if not c:
                continue
            x = i * (cw + 8)
            canvas.paste(c, (x, 28))
            lbl = LABEL[ARMS[i]]
            if lumas[i] is not None:
                lbl += f'  luma {lumas[i]:.1f}'
            d.text((x + 6, 9), lbl, fill=(235, 235, 235))
        canvas.save(os.path.join(OUT, f'{name}.png'))
        print('%-24s %10s %10s %10s %10s' % (
            name, *[f'{v:.1f}' if v is not None else '-' for v in lumas]))


if __name__ == '__main__':
    main()
