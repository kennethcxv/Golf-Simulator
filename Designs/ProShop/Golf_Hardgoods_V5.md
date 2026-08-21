# THE NEXT TEN — GOLF HARDGOODS, v5 METHOD

The apparel rebuild worked. The method is what fixed it and the method carries
forward: **draft real construction, no harmonic terms, crisp edges, and the
reference beside every render.**

These ten are the golf goods a pro shop actually sells and the fixtures that hold
them. **Swap any of them if I've picked wrong — but do not add an eleventh.**

---

## FIRST — CLOSE v5's OPEN LOOP

**v5 produces no GLB and is not wired into the game.** Ten garments exist only as
Blender renders. Before starting new work:

- Export all ten through the round-trip gate (`bake_gltf_axis`, the 0.000 mm
  displacement check, base-colour flattening — all of which caught real
  shipping-blockers last time).
- **Verify in-game with `apparel-v4-ingame.js`** or its v5 equivalent: loaded
  through the app's own loader, at the player camera, screenshotted.
- **The golden gate is RED at tool-mop, 0.91 against a 0.75 threshold**, three
  runs, diff localised to the mop head and strands. Your diff was Blender-only,
  so it is probably not yours — **A/B it against the pre-session commit and
  settle it.** A red gate you have not explained is a red gate.

Then start the ten.

---

## THE TEN

**1. GOLF CLUB — DRIVER.** The single most identifiable object in the game and
you do not have one. Real construction: a hollow titanium head with a crown, a
sole plate, a face insert, a hosel, a graphite shaft with a ferrule, and a grip
with real taper and texture. **The crown is a compound curve, not a sphere.**

**2. GOLF CLUB — IRON.** A cavity-back with a topline, a sole, grooves in the
face, and a steel shaft. **The grooves are geometry, not a bump map** — they read
at shelf distance and they are what says "iron".

**3. GOLF CLUB — PUTTER.** A blade or mallet with a distinct alignment line and a
flat face. Different silhouette from the other two or it is not worth having.

**4. GOLF BAG — STAND BAG.** Fabric panels over a frame, so it is a soft-goods
job: **draft the panels, sew them, let the frame hold them.** Pockets with
zips, a strap, dividers at the mouth, and legs that actually reach the floor.

**5. GOLF SHOES.** A pair, displayed. Upper, sole unit, spikes or dimples,
laces. **Not a solid block with a swoosh.**

**6. GLOVE, PACKAGED.** Card backing, clear front, the glove visible inside.
Small, but it is on every counter in every pro shop.

**7. TOWEL — FOLDED AND CLIPPED.** Soft goods again, and the folding machinery
from `folded.py` already exists. A tri-fold with a carabiner.

**8. HEADCOVER.** Knit or leather, sitting over a club head. The one that reads
most as golf at a glance.

**9. UMBRELLA — FURLED.** In a stand. Panels, ribs, a shaft, a handle. Long
vertical object that fills a corner.

**10. THE FRONT DESK / COUNTER.** **This is still a grey box in my game and the
player stands at it for every transaction.** Real construction: a top with an
edge profile, a front panel, a kick, a customer-side shelf, and the countertop
the register and ledger already sit on. Highest-visibility fixture in the shop.

---

## THE METHOD — WHAT CARRIED

**Draft the construction, not the silhouette.** A driver head is a crown, sole
and face joined at edges. An iron is a body with a milled face. A bag is panels
over a frame. Build the parts a factory builds.

**No harmonic terms.** No `sin` added to fake a shape. If a surface curves, it
curves because its construction curves.

**Crisp edges.** Smooth at ~30°, not 70°. **Every fault in v4 traced to uniform
rounding**, and hardgoods punish it worse than cloth — a chrome edge that should
catch a highlight in one line instead smears it over a centimetre.

**Real materials.** Chrome, brushed steel, matte titanium, graphite, leather,
rubber, knit — these are seven different light responses and v4 had one.

**Reference beside every render, every round.** Search for construction photos —
three or four per asset, showing how the thing is actually made.

**Write the fault list by frame number before editing.** That is what turned the
apparel round.

**REFERENCE | v4 (or nothing) | v5** sheet for each.

**Park at twelve rounds** with the reason written, or cut it.

---

## RULES

**Full-size frames, frame by frame. Never the contact sheet.**

**Watch every new assertion fail on a known-bad case first.**

**Export and round-trip each asset as you finish it**, rather than accumulating
ten unexported assets again.

**If the construction is fighting you for a third round, rebuild it with a
different method** — that is what unlocked the garments.

Compact at 80% and carry on. Technical gates after the art is right, and read the
gate's real exit code.