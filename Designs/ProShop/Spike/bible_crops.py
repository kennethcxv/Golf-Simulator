"""ART_BIBLE validation — side-by-side crops across arms.

    python Designs/ProShop/Spike/bible_crops.py [A F I]

Whole-frame numbers are the wrong instrument for "does this read as furniture", and
they are the wrong instrument for "does the grain survive calibration" too: a mean
absolute difference cannot separate detail that was added from colour that moved.
This crops the places where the claims are testable and puts the arms side by side at
2x, which is the only way to answer either question.
"""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), 'bible')
OUT = os.path.join(ROOT, 'compare')

LABEL = {
    'A': 'A control (untextured)',
    'B': 'B bevels only',
    'C': 'C + materials',
    'D': 'D + contact',
    'F': 'F raw CC0, tint dropped',
    'G': 'G 512 + KTX2',
    'H': 'H 512 uncompressed',
    'I': 'I calibrated + tint',
}

# (name, shot file, crop box, zoom)
CROPS = [
    ('worktop-edge', '2-front-elevation.png', (620, 470, 1180, 680), 2),
    ('whole-table', '2-front-elevation.png', (600, 430, 1200, 890), 1),
    ('leg-floor-contact', '3-floor-contact.png', (600, 360, 1020, 800), 2),
    ('three-quarter', '1-three-quarter.png', (420, 300, 1300, 800), 1),
    # §7.4.1 palette gate. The worktop surface at 2x is where "does calibrated texture
    # still carry grain" is decided; the leg is where the dropped tint is most visible,
    # because raw Metal032 is a pale blue-grey and black powder-coat is not.
    ('cal-worktop-surface', '4-worktop-elevation.png', (620, 495, 1200, 660), 2),
    ('cal-worktop-leg', '4-worktop-elevation.png', (980, 600, 1220, 850), 2),
    ('cal-counter-surface', '5-counter-elevation.png', (500, 430, 1100, 620), 2),
]


def main():
    arms = sys.argv[1:] or ['A', 'B', 'C', 'D']
    arms = [a for a in arms if os.path.isdir(os.path.join(ROOT, f'arm{a}'))]
    if not arms:
        print('no arms found')
        return
    os.makedirs(OUT, exist_ok=True)
    for name, shot, box, zoom in CROPS:
        crops = []
        for a in arms:
            p = os.path.join(ROOT, f'arm{a}', shot)
            if not os.path.exists(p):
                crops.append(None)
                continue
            c = Image.open(p).convert('RGB').crop(box)
            if zoom != 1:
                c = c.resize((c.width * zoom, c.height * zoom), Image.LANCZOS)
            crops.append(c)
        live = [c for c in crops if c]
        if not live:
            continue
        cw, ch = live[0].size
        n = len(live)
        canvas = Image.new('RGB', (cw * n + 8 * (n - 1), ch + 26), (18, 18, 18))
        d = ImageDraw.Draw(canvas)
        i = 0
        for a, c in zip(arms, crops):
            if not c:
                continue
            x = i * (cw + 8)
            canvas.paste(c, (x, 26))
            d.text((x + 6, 8), LABEL.get(a, a), fill=(235, 235, 235))
            i += 1
        canvas.save(os.path.join(OUT, f'{name}.png'))
        print(f'{name}: {n} arms -> compare/{name}.png')


if __name__ == '__main__':
    main()
