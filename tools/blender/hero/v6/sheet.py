"""Contact sheets and REFERENCE | v5 | v6 comparison sheets.

Two jobs, one grid:

  * TRIAGE. A folder of freshly fetched Commons photographs, small, labelled
    with the filename, so I can see which ones are actually the angle I asked
    for. A Commons title is not a photograph and picking by title has already
    put a 32x32 icon and a Van Gogh portrait made of polo shirts into a search
    result I nearly took.
  * THE COMPARISON SHEET the brief requires for every round: the reference in
    the left column, v5 in the middle, v6 on the right, at matching heights.

The sheet is for DECIDING WHAT TO LOOK AT. Fault-finding still happens on the
full-size frame -- v5's rule, and it stays.

  python sheet.py --out qa/x.png --cols 3 --cell 520 a.jpg b.png ...
  python sheet.py --out qa/x.png --cols 3 --cell 520 --labels "ref,v5,v6" ...
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

PAD = 14
BAR = 26
BG = (24, 24, 26)
FG = (232, 232, 228)


def _font(size=15):
    for p in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def build(paths, out, cols=3, cell=520, labels=None):
    fnt = _font()
    # An unexpanded shell glob arrives as the literal string "dir/*.jpeg" and
    # rendered as a red UNREADABLE tile in four sheets before I noticed. A path
    # that does not exist is a caller mistake, not a corrupt image; only a file
    # that exists and will not open earns the red tile.
    paths = [p for p in paths if os.path.exists(p)]
    tiles = []
    for i, p in enumerate(paths):
        try:
            im = Image.open(p).convert("RGB")
        except Exception as exc:                       # noqa: BLE001
            im = Image.new("RGB", (cell, cell), (60, 20, 20))
            ImageDraw.Draw(im).text((10, 10), f"UNREADABLE\n{exc}", font=fnt, fill=FG)
        im.thumbnail((cell, cell), Image.LANCZOS)
        lab = (labels[i] if labels and i < len(labels) else os.path.basename(p))
        tiles.append((im, lab))

    rows = (len(tiles) + cols - 1) // cols
    cw = max(t[0].width for t in tiles) + PAD
    ch = max(t[0].height for t in tiles) + PAD + BAR
    sheet = Image.new("RGB", (cols * cw + PAD, rows * ch + PAD), BG)
    d = ImageDraw.Draw(sheet)
    for i, (im, lab) in enumerate(tiles):
        r, c = divmod(i, cols)
        x = PAD + c * cw
        y = PAD + r * ch
        sheet.paste(im, (x + (cw - PAD - im.width) // 2, y))
        d.text((x + 2, y + im.height + 5), lab[:64], font=fnt, fill=FG)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sheet.save(out)
    print(f"{out}  {sheet.width}x{sheet.height}  {len(tiles)} tiles")


def main():
    argv = sys.argv[1:]
    out, cols, cell, labels, paths = "sheet.png", 3, 520, None, []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--out":
            out = argv[i + 1]; i += 2
        elif a == "--cols":
            cols = int(argv[i + 1]); i += 2
        elif a == "--cell":
            cell = int(argv[i + 1]); i += 2
        elif a == "--labels":
            labels = argv[i + 1].split(","); i += 2
        else:
            paths.append(a); i += 1
    if not paths:
        raise SystemExit("no images")
    build(paths, out, cols, cell, labels)


if __name__ == "__main__":
    main()
