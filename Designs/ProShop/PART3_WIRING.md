# PART 3 — WIRING, AND WHY IT STOPPED AT THE BASELINE PHOTOGRAPH

The brief's order is: get the baseline honest, then wire one asset at a time,
photographing each in game. I did the first two steps. The baseline photograph
is where it stopped, and it stopped for a good reason.

---

## THE BASELINE PHOTOGRAPH REPRODUCES YOUR RAKE COMPLAINT

`tools/qa/electron-rake-viewmodel.js` exists because of this note, quoted in
its own header:

> "The bunker rake viewmodel -- I reported deformed lumps filling the top
> third; a previous session could not reproduce it. Photograph it at the
> default camera and tell me what you see."

**I ran it before touching anything, and it reproduces.**

`qa/electron/rake-viewmodel/rake-level.png`
`qa/electron/rake-viewmodel/rake-down.png`

A **giant deformed hand fills the top third of the frame** -- splayed fingers,
no arm, floating against the sky. The rake's shaft is visible at the right
edge; **the rake head never appears in any of the three frames.** Looking down
does not bring it into view, it just moves the hand.

This is the baseline. **Nothing of mine is wired.** `grep -rn "models/hero"
src/` still returns nothing, and this session's commits touch
`tools/blender/hero/*`, `Assets/models/hero/*` and `Designs/*` only.

The driver already knew the one way this could lie -- "a tool viewmodel draws
only in its own domain; photographed indoors it reports equipped: true and
draws a picture of a wall" -- so it puts the player OUTDOORS first. The frames
are outdoors, at the default camera, with the tool confirmed equipped.

`tools/qa/electron-tool-draws-at-all.js` on the same build reports

    "rakeInScene": false
    ndcX [ -1.724, 12.369 ]   ndcY [ -18.367, 0.201 ]

Normalised device coordinates are [-1, 1] on screen. So the rake asset is not
in the scene at all, and whatever is being measured is enormous and mostly off
frame. What draws is the hand plus a procedural shaft.

**I have not chased this.** The rule is explicit and it is the right rule: no
debugging the game at 4am. It is written down with two photographs and a
number, which is what the morning needs.

One connection worth having, not chased either: suite failure **#1937, "the
shared set is the one the hands actually use"**, fails with a colour mismatch
(expected `0xc4875c`, actual `0xd9a97e`). It is one of only three real
failures in the baseline, and it is about the hands.

---

## WHY THIS BLOCKS THE WIRING RATHER THAN DELAYS IT

Step 3 of the brief is the whole point of the exercise:

> **Look at that photograph.** ... If an asset does not survive the clubhouse
> lighting, that is a fault, and it goes back rather than in.

That test cannot be run right now for a held tool. With a broken hand filling
the top third and the tool's own asset absent from the scene, a photograph
after wiring my rake would not tell me whether my rake is any good. It would
tell me the hand is still broken.

Wiring it anyway would mean shipping an asset on a test I could not read --
which is the exact failure mode this whole project's found-false ledger is
made of.

So: **no asset was wired, and the reason is a pre-existing fault in the
first-person viewmodel, photographed.**

---

## WHAT I FOUND ABOUT WIRING WHILE GETTING THERE

Worth having before the next attempt.

**The hero set mostly DUPLICATES assets the game already has**, from other
pipelines, and wiring means replacing something that already works rather than
filling a hole. The broom comparison already showed that can go either way.

**The clean category is small.** Assets loaded by plain URL with no dependency
on their internal node names are genuine file swaps: the rake, the mower and
the spreader, all in `HELD_TOOL_ASSET_MANIFEST` in `courseScene.js`. Everything
else either has no call site at all or has consumers that reach inside it --
the ledger's page-turn code addresses `glbNodes.ribbon`, `cover`, `faceL` by
name, so swapping that GLB breaks the animation.

**And the swaps are not free in the currency the parallel session is
counting.** Measured:

| asset | in game | mine |
|---|---|---|
| rake | 20,192 tris, **1 mesh, 1 material** | 784 tris, **5 meshes, 3 materials** |
| greens mower | 3,240 tris, 22 meshes, 6 materials | 1,680 tris, 23 meshes, 4 materials |
| rotary spreader | 3,196 tris, 17 meshes, 7 materials | 1,628 tris, 20 meshes, 4 materials |

The rake is a 26x triangle saving and costs **+4 draws and +2 materials**. With
the game held at 193 programs and 2,325 standing draws, that trade is the
owner's call, not mine, and it is worth making deliberately rather than
discovering it in a delta table.

---

## THE ORDER FOR NEXT TIME

1. Fix the first-person hand. Nothing held can be judged until it is.
2. Then the rake, mower and spreader as pure file swaps -- no source change,
   which makes each one revertible with `git checkout` of a single file.
3. Decide the draws-vs-triangles trade before wiring, not after.
4. Everything else needs a call site written, and several need their consumers
   checked for node-name dependencies first.
