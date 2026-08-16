# OVERNIGHT — EVERY ASSET FINISHED, THEN WIRED IN

I am going to bed. You will not be able to ask me anything, so make the calls
yourself and write down why. Work for as many hours as this takes.

Two halves, in order, and the second does not start until the first is genuinely
done:

    HALF A — every asset reviewed adversarially and taken to production ready.
    HALF B — every asset that PASSES gets wired into the actual game.

---

# HALF A — FINISH EVERY ASSET

## The standard

**Production ready means:** it looks like the reference photograph, every part is
connected to what it grows out of, nothing passes through anything it should not,
the materials read as their real material, and it holds up at the distance a
player sees it.

**Passing the assertions is NOT production ready.** Every asset in your last
review passed every check and nineteen of nineteen came back ITERATE. The checks
prove it is built correctly. They do not prove it looks finished.

**The bar: would this be in a game I paid money for?**

## The loop, per asset

1. **Reference beside it.** Search for real photographs if you do not have good
   ones. Three or four per asset, showing construction, not just the object.
2. **Render the turntable and OPEN EVERY FRAME AT FULL SIZE.** Never the contact
   sheet — every fault I have ever caught was invisible at that size.
3. **Write every fault down by frame number.** Be a hostile lead artist, not the
   person who built it.
4. **Fix them. Render again. Repeat until you cannot name a fault.**
5. Then the two checks that have bitten repeatedly: **is every part attached**,
   and **is anything inside anything it should not be.**

## Every asset gets this

The hand · the mop head · the broom (verify the procedural is still the better
one) · the dustpan · the spray bottle · the cloth and sponge · the shopping bag ·
the bunker rake · the hose nozzle · the divot tool and pail · the pressure washer
wand · the greens mower · the rotary spreader · the ledger book · the cash
register · the money (cards, notes, coins) · the customer basket · the golf balls
and packaging · the apparel (all of it) · the retail gondola · the merch and
softgoods families · anything else you have built this project.

## Known-bad, from your own review — these are the starting fault list, not the
## whole one

- **The apparel reads as blocks.** v2 is meant to be built from PANELS, not
  primitives softened. The cap especially — six panels, a button, eyelets, a
  curved brim, a sweatband, a closure. If it reads as a dome it is wrong.
- **The register is boxes.** Low-poly, squared, no chamfers. Pick your strongest
  of the four designs, say which and why, and build it properly — chamfered
  edges, real keys, panel gaps, a screen with something on it. Take the triangle
  budget it needs.
- **Packaging type is stretched** on some faces. Lay out each face's artwork for
  that face's real proportions and read the text back in the render.
- **Ten blank evidence frames remain on disk** and are still citable. Clear them
  by rebuilding their assets, or the blank-frame gate stays red.
- Everything else on the nineteen-item ITERATE table.

## Rules for the night

**Verify every assertion still fails on a known-bad asset before trusting it.**
You have caught four broken instruments this way and it is the only reason any
verdict means anything.

**A blank render is a build failure.** A frame with no subject is never evidence.

**If an asset cannot be made good, say so and cut it.** That was the right call
on the broom and it may be right again. An honest "this is worse than the
procedural one" is a result.

**Park anything past eight rounds**, write down exactly why, and move on. Do not
spend the night on one asset.

**Compact yourself when you run low and carry on.** Finish and push the asset you
are on first so compaction never lands mid-asset.

---

# HALF B — WIRE THEM IN

**Only start this once Half A is done and every asset has a written PASS.**

This is the first time any of these will be seen inside the game. Every asset
judgement on this project that went wrong, went wrong in a dark clubhouse — so
the in-game photograph is the real test, not the studio render.

## Per asset

1. Wire it in — swap the procedural build or the old GLB for the new one.
2. **Photograph it IN GAME.** Held at the camera for tools, on the shelf for
   merchandise, on the counter for the register and the bag.
3. **Look at that photograph.** If it does not survive the clubhouse lighting,
   that is a fault and it goes back to Half A for that asset.
4. Golden gate after each one.
5. Commit and push per asset, not in one lump.

## Report per asset

Draws, materials, programs, triangles, texture bytes — **the delta, not the
total.** A parallel session is holding this game at 193 programs and 1,443 draws
and is actively measuring both; your assets move those numbers and the deltas
have to stay attributable.

**Share the existing material library.** A new material family costs about a
second off my cold load at measured rates. If an asset would add one, say so and
justify it.

## Ownership

**You own:** `Assets/models/`, the held-tool manifest, the asset registries, and
the call sites that swap a build for a GLB.

**You do not own:** `courseScene.js` prewarm internals, the `main.js` load path,
`tools/qa/`. A parallel session is in those. If a wiring change needs one, leave
it, note it, and tell me in the morning.

**Sockets:** the outdoor tools must carry `SOCKET_GripPrimary` (and
`SOCKET_GripSupport` where two-handed) or the hands stay 0.8 yd from the tool
exactly as they are now. Verify by loading the exported GLB back and finding them
by name.

---

# THE MORNING REPORT

One table: asset, verdict, rounds spent, triangles, new materials, wired yes/no.

Then, plainly: what is genuinely finished, what you cut and why, what is parked
and why, and anything you had to decide without me.

Do not tidy the failures out of it. The nineteen-for-nineteen review was the most
useful thing you have produced on this project.