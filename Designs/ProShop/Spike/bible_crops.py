"""THROWAWAY — ART_BIBLE validation spike. Side-by-side crops across arms.

    python Designs/ProShop/Spike/bible_crops.py [A B C D]

Whole-frame numbers are the wrong instrument for "does this read as furniture".
This crops the places where the bible's claims are testable — the worktop edge where a
bevel either catches light or does not, and the leg-to-floor join where contact either
reads or does not — and puts the arms side by side at 2x.
"""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), 'bible')
OUT = os.path.join(ROOT, 'compare')

LABEL = {
    'A': 'A control',
    'B': 'B bevels only',
    'C': 'C + materials',
    'D': 'D + contact',
}

# (name, shot file, crop box, zoom)
CROPS = [
    ('worktop-edge', '2-front-elevation.png', (620, 470, 1180, 680), 2),
    ('whole-table', '2-front-elevation.png', (600, 430, 1200, 890), 1),
    ('leg-floor-contact', '3-floor-contact.png', (600, 360, 1020, 800), 2),
    ('three-quarter', '1-three-quarter.png', (420, 300, 1300, 800), 1),
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
