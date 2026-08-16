# GOAL 27 REWORK, ITEM 4 — THE REGISTER: FOUR DESIGNS TO CHOOSE FROM

Not iterated. Four distinct takes, rendered side by side, as asked.

`qa/hero/register_options/four-designs.png` — and a turntable plus a
customer-side view per design in `qa/hero/register_options/<A|B|C|D>/`.

Build: `blender --factory-startup -b --python tools/blender/hero/build_register_options.py -- cycles`

---

| | A — COUNTER TILL | B — TABLET COLUMN | C — LANE HEAD | D — CLUBHOUSE |
|---|---|---|---|---|
| the idea | the ordinary shop till | boutique pro-shop unit | the supermarket-sim shape | timber and brass, belongs in a clubhouse |
| footprint | 340 x 447 x 366 mm | 260 x 277 x 371 mm | 428 x 520 x 448 mm | 374 x 433 x 300 mm |
| triangles | 1,052 | 988 | 1,320 | 924 |
| parts | 19 | 19 | 22 | 19 |
| materials | 4 | 4 | 4 | 4 |
| drawer interior | 288 x 237 x 51 mm | 219 x 179 x 41 mm | **350 x 270 x 59 mm** | 291 x 215 x 53 mm |
| note bays | 4 x 72 mm | 4 x 55 mm | 4 x 88 mm | 4 x 73 mm |
| coin bays | 5 x 58 mm | 5 x 44 mm | 5 x 70 mm | 5 x 58 mm |
| customer display | small rear panel | none (tablet swivels) | pole-mounted | screen in the back panel |
| scanner | none | handheld in a cradle | scale/scanner plate | none |

Every one carries forward what was right about the old till: **notes in the top
tray, coins in a well beneath, and the drawer as a real compartment** — cut out
of the solid with a boolean so it has actual walls, not a lid with lines on it.

**The dimension that matters:** a note is 171 mm long, so it lies ACROSS the
bays in all four. B's 179 mm depth is the tight one — a note fits with 4 mm to
spare and would need care; C's 270 mm is comfortable. If notes are meant to sit
flat and square, B needs its base widened before it is picked.

---

## WHAT I WOULD SAY IF ASKED

- **C** is closest to the reference and to the genre. It is also the biggest, and
  a 428 mm unit needs the counter to be built round it.
- **D** is the only one that looks like it belongs in a golf clubhouse rather
  than a Tesco. It has the smallest drawer of the three full-size options and
  the least "modern POS" read, which may be exactly right or exactly wrong.
- **A** is the safe one and the cheapest to finish.
- **B** is the odd one out and the only one that would suit a small counter.

Faults visible in the render, stated because they are real and none of them is
fixed yet — that is the next round, on whichever you pick:

- the drawer front reads as a separate slab in all four; it wants the body's
  colour and a recessed shadow gap
- A's keypad is a flat slab with no keys
- C's pole display reads as a flag on a stick
- the screens now genuinely emit (see below) but carry no UI

## ONE REAL BUG FOUND AND FIXED ALONG THE WAY

`hardsurface_lib.pbr()` has accepted an `emission` argument since it was
written and **never wired it to anything**. That is why the old register's
monitor rendered as a flat mint rectangle in BOTH engines, and why the review
recorded "no emission in either" — the brief asked for an emissive screen and
the material silently never had one. Now wired, with strength, and the four
screens above are actually emitting.

An argument a function accepts and ignores is worse than one it rejects.
