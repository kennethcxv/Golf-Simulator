# Overnight report — 2026-08-06 (session 13F)

**Named `_13F`, not `_13` as the brief asked.** `OVERNIGHT_REPORT_13.md` already exists —
it is the 2026-08-05 session's committed report, and `_13E` is its follow-on. Overwriting
either would destroy the record. Same reasoning report 13 itself used when it diverged
from its brief's "_12". Divergence logged here and nowhere else.

Branch `feature/pro-shop-vertical-slice`. All verification in **Electron**,
`--clubhouse=pine-hills-v2`, via `node tools/qa/run-electron.cjs <driver>`.
Suite green (**2792 pass / 0 fail**) before each of the four commits, all pushed.

`3872e0e` tags · `7927c8d` ledger · `5f9652c` tools 7+9 · `ee4bf1e` item 14.

**I did not finish the queue.** Items 8, 10–13 and 15–25 are NOT DONE and listed at the
bottom. I went deep on what I reached rather than shallow across all of it; the ledger
block alone took a third of the session because three of its measurements were wrong
before they were right. Whether that trade was correct is yours to judge.

---

## TAGS — asked three times, reported done twice

**What changed.** Deleted `productBarcodeTexture` (a 512×256 white barcode canvas), the
`RuntimeProductBarcode` plane `buildItemMesh` mounted on every item that crossed the
counter, and `scanPoseFor`/`scanReadFor` — which posed a product by its printed label and
judged a ray against it, dead since the scan arc became a click-slide, and the label's
only remaining consumers. `barcodeFor` stays: the barcode is a transaction string on
`userData`, and nothing draws it.

**Why it survived two "done" reports — the instrument.** The previous session's driver
asserted `stickersPresent: counts.barcode >= 1`. It was written to *require* the label,
and `checkout-scan-presentation.test.js` pinned `/RuntimeProductBarcode/` in the source.
A green sweep was evidence for the opposite of what was asked. The first pass deleted
shelf price rails; the second deleted the checkout swing tag but kept the sticker,
reasoning that a sticker is packaging where a tag is signage. It still reads as a tag at
the counter, which is where it was seen.

Both assertions are now inverted, and the driver carries a **negative control**: it mounts
a decoy label on a staged product, re-runs the audit, requires the decoy to be caught **by
name and by shape** (unlit plane + canvas map parented to an item), then removes it. An
audit that cannot see a tag cannot prove there isn't one.

| | |
|---|---|
| Driver | `tools/qa/h3-tag-free-checkout.js` |
| Result | clean: 0 label nodes, 0 unlit label planes; control caught both ways |
| Screenshot | `qa/electron/h3-tags/counter-staged-close.png` — glove, polo, ball carton on the counter mid-sale, none carrying a label |
| Bar met | **yes** |

---

## LEDGER

### 1 — clips through its own cover opening · **done**

They intersected everywhere, and the numbers say by how much. The page block was built on
the table plane (layer 0's underside pinned at z=0.0015) while the covers lie in a 4.5° V
whose top face climbs 0.0070 → 0.0298. The whole block was **5 to 29 mm inside the
boards**, and even the top layer's fore-edge (0.0283) sank under the cover lip. `arch_z`'s
docstring claimed that lip was "~0.027"; it was 0.0298 and had never been measured.

The cover plane is now derived from the cover's own placement and every layer built above
it, so both move together if the V is retuned. The builder **refuses to export** below
0.8 mm clearance and prints what it got — `LEDGER R1 OK | min cover clearance 1.30 mm |
fore-edge proud by 18.04 mm`. The open book joins into `LB_OpenCovers` / `LB_OpenCaps` /
`LB_OpenPages` instead of one `LB_OpenBody`, precisely so the claim stays measurable.

Verified: **0 page vertices inside any cover solid**; negative control sinks the block
6 mm and catches **388**. Screenshot `qa/electron/ledger-frame/01-open-spread.png`.

### 2 — too wide, cut off by the frame edges · **done**

Measured before touching it: **90.5% of frame width, 33 px left margin against 118 right.**
Both from one assumption — that the gutter is the book's centre and a hand-tuned
`FACE_DISTANCE` would frame it. It is not the centre (covers, caps and the ribbon tail are
not symmetric about it) and a fixed distance cannot know the aspect ratio.

Solved instead: measure the open book's own box, put its **centre** on the view axis,
derive the distance from the camera's real FOV so it covers at most 74% in both axes. The
page block also narrows to 0.276 × 0.184 so the boards' squares are an even 21 mm all
round — narrower and shorter, as decided.

**After: margins 234 / 279 / 331 / 94 px, width 67.9% of frame.** Holds at any window size
by construction. Negative control (book scaled 1.9×) is reported out of frame.

### 3 — "Ahead X on that day" overlaps the page controls · **done**

Confirmed by measurement *before* changing anything: the summary's box ran 463..500
straight through the control line at 479..501, and it moves with the money, so eyeballing
one figure would have proved nothing.

The page now has a **foot band whose top edge is measured from the glyphs actually drawn
in it**; every painter stops there; the row inside it is laid out by measurement, and the
folio prints only if the measured gap holds it.

Verified on a **full page** (six-figure takings) and an **empty** one, read off the live
page canvases: worst row of ink inside the band 26 px — the controls themselves — in both.
Negative control paints a slab across the band and is caught at **618**.
`02-takings-full.png`, `03-takings-empty.png`.

### 4 — real page turn · **done**

Recorded **per frame** (170 samples): hidden at rest, rotating −0.001 → −1.000 turns, its
own sheet bending **26.7 → 40.4 → 26.6 mm** and back, hidden after, two paper cues. A
crossfade cannot deform its own vertices.

The leaf also follows the page arch now — its rest height was the constant 0.038, which
sat *inside* the rebuilt block. The leaf nodes are named
(`LedgerTurningLeafPivot/Front/Back`): unnamed, the only handle on them was "a node with
two 768×512 planes", which also describes `LB_Open`, and the driver's first cut measured
the two static page faces and reported a leaf that never moved.

**Caveat:** the screenshots did not land inside the 550 ms turn — the screenshot round trip
is ~110 ms and none of five frames caught the leaf mid-arc. The per-frame record is the
evidence; there is no picture of it. `qa/electron/ledger-turn/ledger-turn.json`.

### 5 — lock by section, not the book · **done**

`journalSections` hardcoded `locked: true` on the last two, so per-section locking existed
on paper only — they could never open. They now read campaign and roster state, carry the
unlock condition in words the reader can act on, and have real pages when earned
(`courseLogSummary`, `championEntries` — both lenses on state the sim already keeps, no
invented content). Locked pages are **ruled blanks**, not the drawn leather strap and
brass buckle, which read as a store page rather than a book.

Verified: course log locked at start, unlocks on `businessOpen`. `04-locked-blank.png`,
`05-course-unlocked.png`.

### 6 — what still reads cheap · **partially done**

Done: even 21 mm squares all round, so the boards read as a frame rather than a lopsided
rim; the turn-in **tooled in gold** on the open boards — the gold had only ever been on the
*closed* front cover, which is not the face anyone reads; leather lifted off near-black.

**UNASSESSED-AESTHETIC:** under the clubhouse's dim light the boards still read darker than
the reference. Before/after: `qa/electron/ledger-polish/r6-before-spread.png` vs
`qa/electron/ledger-frame/01-open-spread.png`.

---

## TOOLS

### 7 — the broom hand stays put while the head swings · **done**

**Is it wired?** Yes — `broomViewmodel:700` reads `handFollow` every frame. So the answer
was never the constant.

**How detached?** Across a stroke the head travels 0.329 of the screen and the hand 0.159.
But screen travel flatters the hand, which is 0.7 yd from the lens. In **world** terms it
covered 0.156 yd against the head's 0.934 — **a ratio of 0.167.**

The cause is structural: the head is swung about the **grip**, so the hands *are* the pivot
and move only by whatever that one fudge term adds back. `handFollow` is now the radius the
hands turn on about a body pivot behind them — where a sweep's arc actually comes from —
with the arc's own depth term, so they come in slightly at the extremes instead of sliding
on a rail. **World ratio 0.167 → 0.329.**

Translation alone still reads as a hand being towed, because `rollLean` is a *velocity*
lean: it peaks mid-stroke and is zero at both ends, so the wrist was in the same
orientation at the end of the push and the end of the pull. Added a term on the stroke
**angle**.

**Instrument note.** The first wiring test tried to patch `BROOM_FEEL`, which is
deep-frozen; the patch failed silently and three identical runs looked like proof the key
was dead. The control that needs no patch is idle-vs-sweeping: **idle 0.010 NDC of hand
travel, sweeping 0.375.**

`qa/electron/broom-hand-follow/` — numbers plus `sweep-shipped.png`. **No before/after
picture pair:** the first run's screenshot was overwritten before I thought to keep it. The
before is the numbers.

### 9 — hands on the sponge and cloth · **partially done**

Photographed at the held pose: **five fingertips standing up through the sponge** and
through the folded cloth. The hand was inside the tool, not holding it.

Cause: the authored socket's position wins outright over the registry's, and on these two
it sits at the block's centre — correct for a shaft, where the pole passes through a closed
palm, and wrong for a 15 cm block, which cannot. Tools can now declare a grip `standoff`
that lifts the resolved socket in the tool's own frame. And the `flat` pose's curl of 0.46
barely bent the fingers, so once the palm cleared the sponge they stood straight off it — a
hand on a pad drapes.

**Fixed and photographed:** `qa/electron/tool-hands/sponge-full.png`, `cloth-full.png` —
palm resting on the tool, fingers curling over the front edge, no penetration.

**Still wrong (UNASSESSED-AESTHETIC):** the authored socket's *orientation* leaves the palm
reading open-handed rather than gripping. Fixing that means re-authoring the socket in the
FP asset, which I did not do.

**Audit of all nine tools** (`tool-hands.json`): every tool draws hands. Rig tools (broom,
mop, vacuum, dustpan, washer) carry 23 hand meshes; palm/trigger tools (sponge, cloth,
trashbag, spray) carry 27. Full-frame shot of each at the held pose in
`qa/electron/tool-hands/`.

**A finding I retracted.** The audit first reported "the washer equips and draws nothing".
It does not: `Tool_washer` is empty **by design** — the registry marks it `external: true`
and courseScene builds its geometry itself. Checked before believing it; the check now
exempts external tools by reading the registry rather than by name.

**Three penetration metrics failed** and none is gated: whole-tool AABB called every tool
100% buried; per-mesh AABBs call a rotated 1.3 m broom handle "bulk"; and the hands turn
out to be **children of the tool group**, so the probe found `FirstPersonRightForearm`
inside `Tool_sponge`. Axis-aligned boxes over rotated geometry cannot answer this. The
screenshots are the evidence.

---

## CUSTOMERS

### 14 — they run into the box forever · **fixed, UNCONFIRMED in the build**

**Why the ladder never fires.** Its only stuck test is **displacement** — did I move at
least a quarter of the step I asked for. Walk into a *corner* and you move nothing, so it
fires and all five rungs are available. Walk into the flat **face** of a box and
`resolveCustomer` slides you along it: you move most of your step, every frame,
indefinitely, and `moved < step * 0.25` is never true. The ladder was never reached, so
repath / sidestep / nudge / retarget / skip were all unreachable *on that obstacle*. The
**shape of the prop** decided whether recovery existed — which is why it is one particular
box, and why moving the box would have fixed nothing.

**The fix, at the cause.** Displacement is the wrong question; progress is the right one.
The walker tracks its best distance to target, and 2.5 s of moving without closing on it
counts as stuck and enters the same ladder. Reset on a new destination and after any rung
fires, so a rung that just moved the walker does not immediately re-trigger.

**UNCONFIRMED.** Suite green and the reasoning is from the code, but the driver written to
prove it does not run: under `--clubhouse=pine-hills-v2` the clubhouse API has **no
`customers()`**, so the scenario cannot select a walker. I have not seen a customer recover
from a box face in Electron. That API gap is worth knowing on its own — QA drivers written
against the default clubhouse can fail on the shipping variant.

**The prop sweep and count are NOT DONE** — they were part of the same driver.

---

## NOT DONE

No code changed for any of these; nothing to un-shelve.

| # | Item | Notes |
|---|---|---|
| 8 | Mop fibres rigid — strands must trail, splay, swing behind | untouched |
| 10 | Ranked quality table for every indoor cleaning asset, then fix the worst | raw material exists: full-frame held-pose shot of all nine plus triangle counts in `qa/electron/tool-hands/`. Not ranked, nothing fixed |
| 11 | Q reveal invisible while brooming | observed in passing only: the "Q reveal dirt" chip **is** rendering bottom-left (`sweep-shipped.png`), so the complaint is likely the revealed markers, not the hint — unverified |
| 12 | Hover outlines THAT note only | untouched |
| 13 | Make change-due common; report the 1× split | untouched |
| 15 | Concurrency from rating + price + reputation | untouched |
| 16 | Customer models, hats worst | untouched |
| 17 | Restoration teaches itself; ceiling-repair first-timer path | untouched |
| 18 | Externalise every player-facing string; English complete, 14 machine-drafted | untouched |
| 19 | Verify every settings control; works/persists table | untouched |
| 20 | I5 collider clamp, nine tools, screenshot each | untouched |
| 21 | I6 pushSpeed playtest at full walking speed | untouched |
| 22 | I7 handle length 1.247 — authority or known-blind | untouched |
| 23 | F2 full key rebinding | untouched |
| 24 | Texture pass, 19 files | untouched |
| 25 | My own list | untouched |

## UNCONFIRMED

- **Item 14** — fix in, mechanism explained, never seen working in Electron.
- **Ledger 4** — proven by per-frame numbers; no screenshot caught the leaf mid-turn.

## UNASSESSED-AESTHETIC

- **Ledger 6** — boards still read dark under the clubhouse's dim light.
- **Item 9** — sponge and cloth no longer clip, but the palm reads open-handed rather than
  gripping; needs the FP asset's socket re-authored.

## Fixed unasked

- **`journalSections` could never unlock.** Both locked sections were hardcoded
  `locked: true`, so the book's "locked things" were permanent regardless of what the
  player earned. Found while reading for item 5.
- **Dead scan code.** `scanPoseFor` / `scanReadFor` / `scannerReadFacts` /
  `judgeBarcodeRead` had outlived the scan arc by a full round and were still maintained
  as if live.
- **Unnamed runtime meshes.** The turning leaf had no node names, which is what let a
  driver measure the wrong geometry and report a working feature as broken.

## Instruments that were wrong before they were right

Recorded because a wrong instrument is exactly how the tag survived two "done" reports.

1. Ledger clearance measured **world-up on a tilted book** → −211 mm on geometry with
   1.3 mm of real clearance.
2. Ledger clearance by **column sampling** against 8-corner boxes → 12 of 14 columns held
   no cover vertex → −2.22 mm.
3. Ledger clearance by **vertical plane fit** on a node carrying a 4.5° rotation → board
   read 4.96 mm half-thick instead of 3.5.
4. Broom `handFollow` wiring test **patched a deep-frozen object**; the patch failed
   silently and three identical runs read as "the key is dead".
5. Leaf probe **matched `LB_Open`** instead of the leaf and reported a page turn that never
   moved.
6. Foot-band control **painted its decoy on the hidden turning leaf**, which the probe
   correctly ignores — reading as "this probe cannot fail" when it can.
7. Three tool-penetration metrics, all abandoned.
8. "The washer draws nothing" — **retracted**, it is `external: true`.

Every surviving probe now carries a negative control that is shown to fire.
