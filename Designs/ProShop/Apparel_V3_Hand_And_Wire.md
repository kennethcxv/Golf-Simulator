# APPAREL V3, THE BROKEN HAND, THEN WIRING

Three jobs in order. The first is the biggest and I want you to take as long as
it needs.

---

# PART 1 — THE APPAREL, PROPERLY

I have looked at them and I do not like them. They read as rushed, and they are
the merchandise a player sees on every rail and shelf in the shop. **Every
garment gets rebuilt to a higher standard than v2 reached.**

You marked them PASS. I am overruling that — PASS meant "the faults I listed are
gone", not "this looks like a real garment". The bar is: **would this be on a
shelf in a game I paid money for?**

## Do not iterate v2. Look at what a real garment is made of.

v1 was a lofted block. v2 made it a stack of leaves, which was the right move and
it is why the plies read now. But a folded garment is still being **approximated
from the outside** — a shape that resembles cloth rather than cloth that has been
folded.

**Get much more reference than you have.** Three or four photographs per garment,
and specifically:

- Folded stacks photographed **from a low angle**, so the ply edges and the
  shadow slots between them read.
- **Close shots of construction** — a collar seam, a cuff rib, a placket's
  stitch line, a hood's opening, a waistband and its loops.
- **Hung garments from the side and three-quarter**, showing how cloth falls from
  a shoulder and how a sleeve hangs when nothing is in it.

## What is actually wrong, and it is the same thing everywhere

**The relief is too shallow and too regular.** Seams, ribs, stitch lines and
edges all wash out. Real cloth has depth you can see at three metres — and it is
never evenly spaced.

**The materials read as plastic.** The knit atlas helped, but these still look
moulded. Cloth is soft-edged, slightly translucent at thin edges, and it takes
light differently across a fold than across a flat.

**Everything is too symmetrical.** Real folded stock leans, sags unevenly, and no
two plies agree. You added wander; it is not enough.

**And they are too plain.** These are shop goods — chest logos, sleeve badges,
printed fronts, contrast collars, hang tags, size stickers. A rail of eight
unmarked navy garments is not a shop.

## Every garment, and both states where it has two

Polo, tee, hoodie, trousers, cap. Folded and hung. **Multiple colourways for
each** — atlas cells, not materials.

Take the rounds you need. The hand took twenty-six and was worth it. **Park past
twelve here rather than eight** — this is the biggest visible surface in the shop
and it deserves the time.

**Show me the apparel before you move on.** I want to see it before anything gets
wired.

---

# PART 2 — THE BROKEN FIRST-PERSON HAND

Your own baseline photograph: a giant deformed hand fills the top third of the
frame, no arm, and the rake head never appears. `rakeInScene: false`, NDC bounds
x[-1.724, 12.369] against an on-screen range of ±1.

**This is pre-existing and it blocks all wiring** — you were right to stop rather
than photograph a new asset through a broken frame.

Fix it. The rake asset is not in the scene at all, so what draws is the hand plus
a procedural shaft. Two things to establish before touching anything:

- **Why is the rake not in the scene?** `setTool('rake')` was measured returning
  success while no rake exists — that was found once and never chased.
- **Why is the hand that size and in that place?** The outdoor tools fall back to
  static `LEGACY_GRIPS` numbers because `gripsFor()` returns null outside
  `CLEANING_TOOLS`. That put the hands 0.8 yd from the tool. This may be the same
  fault at a larger scale.

**Acceptance: a photograph of the rake held in-game that reads correctly.** Not a
number — the picture.

---

# PART 3 — WIRING

Only once Part 2 gives a readable frame.

**The rake swap is a 26× triangle increase and +2 materials** — theirs is one mesh
with one material, yours is five with three. **You were right to flag it as my
call: do it anyway**, and report the real in-game delta. If it costs more than
the numbers suggest, revert it and tell me.

Then everything else that passes, one at a time, photographed in game, deltas per
asset, revert-on-break.

---

## RULES

**Reference beside every render, every round.** Turntable at full size, frame by
frame, never the contact sheet.

**Assertions watched failing on known-bad first.** Your export check took five
attempts and the control caught every one — that discipline is why Part 1 is
trustworthy.

**Controls instead of guessing when a fault survives a fix.**

**Cut anything that cannot be made good** and say why.

**Compact at 80% and carry on.** Finish and push the garment you are on first.