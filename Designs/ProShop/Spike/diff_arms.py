"""THROWAWAY spike tool — quantify and visualise the difference between lighting arms.

    python Designs/ProShop/Spike/diff_arms.py 0 1 [2 3 ...]

For every shot, compares each arm against arm0 (control) and reports:
  meanAbs    mean absolute per-channel difference, 0-255
  pctDiff8   % of pixels where any channel moved by more than 8 (roughly perceptible)
  dLuma      mean signed luminance change; negative = the frame got darker
  maxCh      largest single-channel change anywhere in the frame

Also writes side-by-side composites to Designs/ProShop/Spike/lighting/compare/.

Caveat recorded deliberately: the HUD occupies the top-right and bottom-centre of every
frame and is included in these numbers. It is identical between arms except for transient
toasts, so it dilutes the percentages slightly rather than inventing differences.
"""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), 'lighting')
OUT = os.path.join(ROOT, 'compare')


def stats(a_path, b_path):
    a = Image.open(a_path).convert('RGB')
    b = Image.open(b_path).convert('RGB')
    if a.size != b.size:
        return None
    ap, bp = a.load(), b.load()
    w, h = a.size
    step = 2  # every 2nd pixel in each axis: 360k samples, plenty and 4x faster
    n = 0
    total = 0
    over8 = 0
    dl = 0.0
    mx = 0
    for y in range(0, h, step):
        for x in range(0, w, step):
            ar, ag, ab = ap[x, y]
            br, bg, bb = bp[x, y]
            dr, dg, db = abs(br - ar), abs(bg - ag), abs(bb - ab)
            m = max(dr, dg, db)
            total += dr + dg + db
            if m > 8:
                over8 += 1
            if m > mx:
                mx = m
            dl += (0.2126 * br + 0.7152 * bg + 0.0722 * bb) - (0.2126 * ar + 0.7152 * ag + 0.0722 * ab)
            n += 1
    return {
        'meanAbs': total / (n * 3.0),
        'pctDiff8': 100.0 * over8 / n,
        'dLuma': dl / n,
        'maxCh': mx,
    }


def composite(a_path, b_path, out_path, label_a, label_b):
    a = Image.open(a_path).convert('RGB')
    b = Image.open(b_path).convert('RGB')
    w, h = a.size
    scale = 0.5
    sw, sh = int(w * scale), int(h * scale)
    a = a.resize((sw, sh), Image.LANCZOS)
    b = b.resize((sw, sh), Image.LANCZOS)
    canvas = Image.new('RGB', (sw * 2 + 12, sh + 26), (18, 18, 18))
    canvas.paste(a, (0, 26))
    canvas.paste(b, (sw + 12, 26))
    d = ImageDraw.Draw(canvas)
    d.text((6, 8), label_a, fill=(230, 230, 230))
    d.text((sw + 18, 8), label_b, fill=(230, 230, 230))
    canvas.save(out_path)


def main():
    arms = sys.argv[1:] or ['1', '2', '3']
    base = os.path.join(ROOT, 'arm0')
    shots = sorted(f for f in os.listdir(base) if f.endswith('.png'))
    os.makedirs(OUT, exist_ok=True)
    for arm in arms:
        d = os.path.join(ROOT, f'arm{arm}')
        if not os.path.isdir(d):
            print(f'arm{arm}: MISSING')
            continue
        print(f'\n=== arm{arm} vs arm0 ===')
        print('%-34s %9s %10s %9s %7s' % ('shot', 'meanAbs', 'pctDiff8', 'dLuma', 'maxCh'))
        agg = []
        for s in shots:
            bp = os.path.join(d, s)
            if not os.path.exists(bp):
                continue
            st = stats(os.path.join(base, s), bp)
            if not st:
                print('%-34s size mismatch' % s)
                continue
            agg.append(st)
            print('%-34s %9.3f %9.2f%% %+9.3f %7d' % (s, st['meanAbs'], st['pctDiff8'], st['dLuma'], st['maxCh']))
            composite(os.path.join(base, s), bp,
                      os.path.join(OUT, f'arm0-vs-arm{arm}-{s}'),
                      'arm0 control', f'arm{arm}')
        if agg:
            print('%-34s %9.3f %9.2f%% %+9.3f %7d' % (
                'MEAN', sum(x['meanAbs'] for x in agg) / len(agg),
                sum(x['pctDiff8'] for x in agg) / len(agg),
                sum(x['dLuma'] for x in agg) / len(agg),
                max(x['maxCh'] for x in agg)))


if __name__ == '__main__':
    main()
