# GOAL 27 — THE REGISTER, BUILT PROPERLY, AND THE STRETCHED TYPE

Items 2 and 3 of the production brief.

Build: `blender --factory-startup -b --python tools/blender/hero/build_lane_head.py -- cycles`
Screens: `node tools/blender/hero/make_register_art.mjs`
Face check: `blender --factory-startup -b --python tools/blender/hero/check_package_faces.py`

---

# 2 — THE REGISTER

## WHICH ONE, AND WHY

**C, the LANE HEAD.** It is the one the brief originally asked for — "a chunky
modern POS unit, a real customer-facing screen, a card terminal, a receipt
printer, a scanner, a proper drawer" — and it is closest to
`ref/register/selfcheckout.jpg`. It also has the largest drawer of the four,
which matters for a concrete reason: a note is **171 mm** long and has to lie
*across* the bays with room for fingers.

D, the timber clubhouse till, is the one that looks like it belongs in a golf
shop rather than a supermarket. If you would rather have character than genre,
say so and I will build D to the same standard — the parts kit is shared.

`build_register.py` (the design you told me to bin) is superseded by
`build_lane_head.py`.

## WHAT "PROPERLY" MEANT

| the brief | what is there |
|---|---|
| chamfers and fillets on every hard edge | every box is bevelled, 2 segments; nothing has a knife edge |
| real part boundaries | side plates, a back plate and a deck standing proud of a core, a **parting seam** right round the shell, and a **3.2 mm gap** used consistently everywhere |
| a screen bezel that stands proud | a bezel box with the screen on its front face |
| a raised keypad surround | a surround plate with the keys sitting in it |
| a receipt slot with depth | a recessed slot with the paper edge showing through it |
| a card terminal that reads as its own device | its own body, its own bezel, its own screen, its own 3x2 keypad, on a stalk |
| **actual keys** | a 4x4 grid of individually chamfered keys with 4.2 mm gaps, **two of them coloured** |
| the drawer front as part of the shell | a panel **recessed into** the body with an even gap all round |
| the screen with something on it | a full till interface: header, five line items with right-aligned prices, a TOTAL block, and VOID / DISC / CARD / CASH function keys. The customer display shows AMOUNT DUE and TAP OR INSERT. |

## COST

| | |
|---|---|
| triangles | **5,816** |
| parts | 60 |
| materials | **5** — body, dark, metal, screen, and one accent for the coloured keys |
| overall | 441 x 512 x 475 mm |
| drawer interior | **316 x 252 x 69 mm** |
| note tray | 33 mm deep, 4 bays at 79 mm — a 171 mm note lies across them |
| coin well | beneath, 5 bays at 63 mm — a coin is 26 mm |

1,770 part pairs checked; nothing interpenetrates past the 13 mm a recessed
part may sink, nothing is loose, every part is one closed piece.

## THE BUG WORTH RECORDING

The screen quad and its bezel **tilted about opposite axes**. `rotation_euler`
on a box turns about +X; my quad turned about its local `side`, which is −X for
a forward-facing panel. The two leaned apart, and the screen poked out below the
frame where you could read the till interface *backwards* from the customer's
side. Same axis, same sign, or they diverge — and the fix is a `_face_centre()`
that computes where a tilted box's front face actually is rather than placing
the screen near it by eye.

---

# 3 — THE STRETCHED TYPE

The cause was what the brief guessed, plus one more.

**Diagnosis.** Package faces were UV'd with a fixed corner sequence per face.
That is only correct for one winding, and **the two opposite faces of a box have
opposite windings by construction** — so half the faces printed mirrored. On top
of that I had *deliberately reversed* two of the atlas rectangles to compensate
for the old winding, and once the UVs came from position that reversal became
the mirror rather than the cure.

**Fix.** Every package face is now UV'd from **vertex position**: for each face,
u runs along the axis that points to the right of a viewer looking at that face
from outside, v runs up, and every atlas rectangle runs `u0 < u1`.

**And the end panel got its own artwork.** The dozen box's end is 92 x 49 mm — a
1.88 aspect — and it was showing a slice of a strip laid out for the 768-wide
back. Square-on it read `STREL · X-1 TOU`. It now has its own panel at its own
proportions: brand, model, "12 BALLS".

**The check.** `check_package_faces.py` photographs all seven printed faces
square-on at 110 mm so the type can be read back. It found the mirroring, it
found the cropping — **and its first run was itself wrong**: with all three
objects in the scene the camera aimed at the dozen box's end sat on the far side
of the sleeve, so `dozen-end` photographed the sleeve. Each subject is isolated
now. That is the third time this session a check needed fixing before the thing
it was checking did.

Every face now reads comfortably in the square-on render:
`qa/hero/balls/faces/` — sleeve front, side and back; dozen front, top, end and
back.
