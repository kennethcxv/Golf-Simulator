# APPAREL v7 — BAKE IT, SHIP IT, JUDGE IT WHERE I SEE IT

Six revisions. The geometry is now good and the garments still look wrong in my
game. **You found the reason yourself at the end of last session and it changes
everything about how this session runs.**

---

## THE FINDING THAT EXPLAINS SIX ITERATIONS

Your own measurement: the exported GLBs carry **`normalTexture: 0`** — five
materials, not one with a normal map. `fabric()` builds its grain from procedural
nodes into a Bump node, and **that does not survive a glTF export.**

So every garment reaches my game as a bare `baseColorFactor`. Flat colour.

**Every fabric decision of the last six revisions has been invisible to me.** The
knit wale, the piqué lattice, the heather, the grain direction, the sheen — all
of it is studio-only. **I have never seen the good version.**

That is job one and nothing else starts until it is done.

---

## PART 1 — BAKE THE MAPS. NOTHING ELSE MATTERS FIRST.

For all ten garments plus the towel:

- **Bake normal, ambient occlusion and roughness to real textures** and wire them
  into the exported material. The UVs already exist — you did that in v5, 144 of
  144 primitives, with measured texel density.
- **Pack them sensibly** (ORM or equivalent) so it is one texture fetch, and share
  one atlas across garments where the fabric is the same.
- **Prove it in the file, not in Blender**: re-open each GLB and assert
  `normalTexture` is present on every fabric material. **Watch that check fail on
  the current exports first** — it will, on all of them.
- **Then prove it in the game**: a screenshot where the weave is visible.

**This alone may move the garments more than anything in v5 and v6 combined.**

---

## PART 2 — THE ACCEPTANCE FRAME CHANGES. This is the other half.

**Stop judging these in the Blender studio.**

Six revisions were reviewed on macro renders at close range against product
photographs. That is not where I see them and it is not the bar that matters.

**From now on the deciding frame is: the asset in the game, on a shelf or a rail,
from where the player actually stands, in clubhouse light.**

- Blender renders are for *finding* faults. **The in-game shot decides whether it
  is done.**
- Take the in-game shot at the distance a player browses from, and again from
  across the room.
- **If it reads correctly there, it is finished** — even if a 90 mm macro would
  show a flaw. A shelf prop does not need to survive a macro.

**And put a reference photograph beside the IN-GAME shot**, not beside the studio
render. That comparison has never once been made.

---

## PART 3 — CUT THE SCOPE. Two garments, properly.

Ten garments at 2-4 rounds each is how every revision has gone, and it is why none
of them is finished.

**Pick the two that matter most** — the folded polo and the hung hoodie are my
suggestion, because folded stock and a hanging garment are the two silhouettes the
shop needs — **and take those to genuinely good.** Twelve rounds each if that is
what it takes.

**Then port to the other eight only once those two pass in game.**

If the two cannot get there in twelve rounds each, **say so plainly and stop.** I
would rather know that than get a seventh revision.

---

## WHAT NOT TO DO

**Do not add colourways, branding or new material features until Part 1 ships.**
Anything you add now is invisible for the same reason everything else is.

**Do not build another instrument** unless it is measuring something you are about
to fix.

**Do not judge from a studio macro.** That frame has now driven six revisions of
work I could not see.

---

## RULES

Reference beside every render — and beside the in-game shot, which is the one that
decides.

Watch every check fail on a known-bad case first. The normal-map assertion should
fail on all eleven current exports.

Read the gate's real exit code. Do not commit while it runs.

Compact at 80% and carry on.