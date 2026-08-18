# Goal 37 — the Blender line joins the performance line

Two branches, 274 commits between them, and exactly one file touched by both.

## What each side actually was

    assets (174 commits)   Designs/ProShop 518 · tools/blender 122 ·
                           Assets/models 101 · ref/ 29 · tools/qa 5 ·
                           tests/goldens 2 · tools/golden-diff.mjs 1
                           ZERO files under src/
    main (100 commits)     tools/qa 95 · vendor/models 16 · Designs 15 ·
                           src/render3d 14 · src/ui 4 · src/core 4 · tests

The asset line never touched the renderer. That is the whole reason this merge
was small, and it is worth stating because it was the first thing checked.

## The one conflict, and why it resolved to main

`tests/goldens/tool-mop.png`. Both sides had rebaselined it, for different
stated reasons. Resolved on three facts rather than by taking a side:

* the mop-head rework (`44ee725`) is an **ancestor of the merge base**, so both
  branches already carried it;
* `Assets/models/hero/mop_head.glb` is referenced by nothing under `src/` and is
  not in the vendor manifest, so the asset line cannot reach that pose at all;
* the merged tree's `src/` **is** main's `src/`, and main's baseline was green
  against it.

## tool-mop's 24.4% was the camera, not the mop

The first full gate on the committed merge came back **`GATE_EXIT=1`** with
`tool-mop` at **24.4245%** against a 0.75% budget, twelve other poses between 0
and 0.28%. That number is not a moved mop; it is a different photograph.

Proven by looking, not by re-running until green: `qa/_tmp/mop-sbs.png` is the
baseline beside the capture. The baseline is the shop wall, the window, the mop
in hand at the bottom of frame. **The capture is the CEILING** — two dark beams
crossing a flat plane, no wall, no window, no mop anywhere in it. The pose
staged with the camera pitched up.

Three independent facts say it is staging:

1. the merge changed **no `src/`, no `vendor/`, no `index.html`** and no capture
   driver — `git diff 54ae36e c7ace27` outside Designs/Assets/ref/tools-blender
   is `thresholds.json`, `golden-diff.mjs` and five QA drivers;
2. `tests/goldens/tool-mop.png` is **byte-identical** to pre-merge main, which
   measured that pose at **0.2577%** hours earlier;
3. re-running `npm run golden` on the same tree gave **0.3077%** and
   `GOLDEN_EXIT=0`, all thirteen poses ok.

So: **not rebaselined.** A rebaseline would have written a photograph of the
ceiling into the contract. The reference is correct and the capture is flaky —
recorded in HARNESS_DEBT rather than papered over.

## The two mechanical obstacles

**Five untracked apparel docs** sat in this worktree and blocked the checkout.
Verified byte-identical to the branch versions (modulo CRLF) before being moved
aside; the merge restored them tracked.

**The 34-GLB LFS pointer wedge.** The clean filter turns real GLBs into pointers
that never match HEAD, so those files are permanently "modified" and `git merge`
refuses. All 32 verified byte-identical to HEAD by sha256, then merged with the
clean filter bypassed. The incoming 101 LFS objects then landed as POINTERS —
132-byte stubs — and `git lfs checkout` silently no-opped on them, so they were
copied from `.git/lfs/objects` by oid and re-verified: **76 of 76 GLBs carry a
real glTF header**.

## The gate failed for a third reason, and it was not the code

The gate on the **uncommitted** merge reported one test failure:

    orchestrator never starts a second Electron child after the first exits nonzero
    Error: git diff --binary --no-ext-diff HEAD failed: spawnSync git ENOBUFS

`repositoryMetadata()` fingerprints the working tree by shelling
`git diff --binary HEAD`. With 101 new binary GLBs staged that exceeds the
256 MB `maxBuffer` a previous session had already raised for the 34-file wedge,
and the contract test reports ENOBUFS instead of the contract it tests. After
committing, `git diff --binary HEAD` measures **0 bytes** and the test passes.

## The assets: eleven wired, four deliberately not

**Measured before wiring anything** (`tools/qa` bake probe, images + COLOR_0 per
primitive):

| | img | tex | COLOR_0 | baked |
|---|---|---|---|---|
| 10 garments (polo/tee/hoodie/trousers × hung+folded, cap, cap_peg) | 2–6 | 2–6 | every primitive | **yes** |
| `hard_towel` | 2 | 2 | 3/3 | **yes** |
| `hard_counter`, `hard_driver`, `hard_iron`, `hard_putter` | **0** | **0** | **0** | **no** |

The four hardgoods have UVs on every primitive — they are unwrapped and were
never baked. Wiring them would ship flat colour, which is the fault the v7 bake
existed to remove. **They are not wired. The front desk stays a grey box**, and
`pine-hills-v2`'s suppression of assets 61–63 has NOT been lifted. Baking them
is Block 5.

## How the eleven are wired

Through the merchandise system, so stock and tier still decide what appears:

* the vendor manifest stages them to `vendor/models/clubhouse/hero_*.glb`;
* they load in the **RAW** family, not FILES — `instantiate()` remaps every
  material to a palette slot and **none of the v5 material names are in SLOT or
  TINTABLE**, so all eleven would have resolved to charcoal and the bake would
  have been discarded at load;
* `HERO_GARMENTS` maps SKU → garment line, and the **slot** decides hung vs
  folded. `makeStockItem` falls through to the old checkout family if a hero
  model has not loaded, so nothing regresses to a placeholder.

### The bake was being deleted by the stock baker

`merch.bake()` merges a fixture's goods per material and strips attributes to
make the merge legal. `color` was on the strip list. Measured on the towel
before the fix: `material.vertexColors: true` with `geometry.color` **absent** —
a material asking for a colour stream that no longer existed. `color` is kept
now, and a bucket with mixed colour is filled with white (a no-op multiply)
rather than left to throw. Every hero material now reports `COLOR_0=Y`.

### What is wired but has nowhere to stand — recorded, not fixed

Slots are keyed by **SKU**, not by fixture (`fixtureSlots.js` BUILD):
`polo1/polo2/pants2 → tableApparel` (folded stacks), `jacket2 → apparelWall`
(hangs). So which lines hang is shipped merchandising, not wiring.

* `PoloPique`, `TrouserTwill`, `TeeJersey`, `TeeFJersey` — loaded and wired, no
  SKU asks for them.
* `shorts1` has no v5 model and keeps the tinted checkout family; dressing a
  shorts SKU as full-length trousers would be a lie on the shelf.

Merchandising decisions, left alone.

## Evidence

`tools/qa/goal37-hero-apparel-ingame.js` — watched failing on the unwired build
with **6 failures, 0/11 prototypes** (`qa/goal37/control.json`); **0 failures**
after (`qa/goal37/stock.json`), every required hero material present, visible,
with normal/AO/roughness maps and COLOR_0 intact.

Frames viewed: `stock-garments-table.png` — two folded stacks with the pique
lattice legible on the fold; `stock-garments-rail.png` — hung hoodies with hood,
shoulder and ribbed hem reading correctly.

**The photographs are in the STOCKROOM on purpose.** `GREYBOX_ZONES_EXCLUDED`
is `['stockroom','office']`, so every retail fixture on `pine-hills-v2` has its
anchor hidden and an opaque grey volume stood in its place — a garment on that
shop floor is photographed from inside a grey box, which
`qa/goal37/shots-garments-table.png` is exactly a picture of. The back room is
the one place these can be seen in real clubhouse light without defeating the
greybox, which the project rules forbid touching.
