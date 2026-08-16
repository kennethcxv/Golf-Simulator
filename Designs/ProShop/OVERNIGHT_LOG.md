# OVERNIGHT LOG

Running record, appended per asset so the morning report survives compaction.
Started from `Designs/ProShop/Overnight_Assets.md`.

## THE TABLE (kept current)

| asset | verdict | rounds | triangles | new materials | wired |
|---|---|---|---|---|---|
| cap (apparel v2) | **PASS** | 7 | 11,874 | 0 (shares ApparelCloth/Trim) | no |
| polo folded (apparel v2) | **PASS** | 8 | 6,100 | 0 | no (GLB written for the FIRST time tonight) |
| tee folded | **PASS** | 2 | 4,812 | 0 | no |
| hoodie folded | ITERATE | 1 | 4,608 | 0 | no |
| trousers folded | ITERATE | 2 | 4,548 | 0 | no |
| polo hung (apparel v2) | **PASS** | 10 | 10,780 | 0 | no (GLB written for the FIRST time tonight) |
| tee / hoodie hung | **PARKED, not started** | 0 | — | 0 | no |
| register (lane head) | **PASS** | 4 | 5,816 | 0 (5 slots, existing family) | no |
| money (notes + coins) | **PASS** | 3 | 1,384 | 0 | no |
| golf balls + packaging | **PASS** | 3 | 7,848 | 0 | no |
| hand | **PASS, reserved** | 6+3 | 5,178 | 0 | no — see below |
| bunker rake | **PASS** | 1 | 784 | 0 | no |
| greens mower | **PASS** | 2 | 1,680 | 0 | no |
| rotary spreader | **PASS** | 2 | 1,628 | 0 | no |
| pressure washer wand | **PASS** | 3 | 1,248 | 0 | no |
| customer basket | **PASS** | 1 | 3,454 | 0 | no |
| shopping bag | **PASS** | 1 | 1,724 | 0 | no |
| hose nozzle | **PASS** | 1 | 1,116 | 0 | no |
| spray bottle | **PASS** | 3 | 1,420 | 0 | no |
| divot pail | **PASS** | 1 | 1,468 | 0 | no |
| divot tool | **PASS** | 2 | 560 | 0 | no |
| dustpan | **PASS** | 2 | 1,432 | 0 | no |
| retail gondola | **PASS** | 2 | 1,304/bay | 0 | no |
| ledger book | **PASS** | 2 | 6,656 | 0 | no |
| merch + softgoods | **PASS, reserved** | 1 | 1,480 | 0 | no |
| mop head | **PASS** | 1 | 5,616 | 0 | no |
| broom head | **CUT** (re-examined, stands) | 2 | 2,820 | — | no |

## SECOND SESSION — THE PANEL REBUILD, THE TWO RE-EXAMINED CALLS, THE THREE ITERATES

### The apparel panel rebuild (the highest-leverage job, and it landed)

`CL.folded()` stepped ONE lofted surface in and out at each leaf boundary. A
step is not a layer: no thickness of its own, nothing behind it to cast into,
no edge you could pinch. `folded_stack()` builds each leaf as its own closed
shell, and all four garments are on it.

The reading that forced the block was wrong: `assert_all_one_piece` is per
PART, not per asset. The cap ships six separate panel objects and passes it.

Three things found on the way, each with a control watched failing:

- **Leaf k's top sheet and leaf k+1's bottom sheet must carry the SAME vertical
  displacement.** Per-leaf droop scale and crease phase was up to 2.9 mm of
  differential across a 0.9 mm gap -- the leaves would have laced through each
  other. A shared field makes non-intersection structural, not tuned.
- **A roll radius equal to half the ply thickness is a sausage.** The first
  render was a stack of air mattresses. Cloth tapers over two or three times
  its own thickness and then turns.
- **The general assembly check CANNOT SEE leaves lacing through each other.**
  MAX_SEAT_DEPTH is 6 mm and a ply is 9.9 mm, so leaves driven 4 mm into each
  other PASSED. The control found that, not a render. `assert_leaves_clear`
  gives them a 0.6 mm ceiling and refuses to run rather than pass if nothing
  is named leafN.

And two defects the port exposed, both pre-existing: `CL.decal`'s frame was a
world-up cross product with a sign calibrated off one render of a chest print,
so on the flat-lying tee PINE HILLS printed upside down and backwards (fixed by
the invariant udir x vdir = n); and the trousers waistband was placed at
`oz + h`, where the lofted block used to end rather than where the stack's
surface is, so a 22.5 mm tube stood 20 mm clear of the cloth and read as an
open trough.

### The hung polo — both faults were somewhere else

- The side "hard vertical crease" is not a crease. The section arrives at the
  seam with a vertical tangent; the panels meet ROUNDED. It was the SAMPLING:
  with u uniform the last step collapsed 21 mm of section into one facet.
- The "sleeve ends in a flat disc" is not the sleeve's cap. The cuff ring was
  hung 17 mm PAST the sleeve's tip like a napkin ring, and the disc is the
  cavity you saw through it.

### The three ITERATEs, all now PASS

- **Dustpan.** The shading band was TWO faults and neither was the one in the
  review. The rail doubled back on itself (station 3 at y -60.0, station 4 at
  -55.0) so the loft folded; and flat shading on a floor that sweeps up 78 mm
  facets its specular into rows. Fixing the fold moved the band not at all,
  which is what said there was a second cause. Plus a returned flange on the
  wall tops, and three materials that are actually different colours.
- **Divot tool.** Both halves of "reads as a paperclip" were section faults: a
  four-point handle section is a slab whatever its outline, and straight
  5-sided prisms are flat blades. Twelve-point section with a thumb dish, and
  prongs that are round, taper, splay and dip.
- **Gondola.** Base feet, which change the SILHOUETTE -- unlike the slot
  columns, which were interior detail and measured invisible. Adding them found
  two silent omissions: `flat()` did not list them so nothing counted, checked
  or exported them, and with no material they rendered default white.

### The two garments still ITERATE, with the diagnosis written down

Both are the garment's own FURNITURE, not the leaf stack -- the stack works on
all four. Neither is a tuning round; both want the same kind of rethink the
leaves got, so they are parked rather than nudged.

**The hoodie's hood reads as a bread roll.** It is a lofted wedge whose span
term is `sqrt(1 - (2t-1)**2 * 0.92)`, so it tapers at BOTH ends into an
ellipsoid -- which is a bread roll, exactly. And the thing that identifies a
folded hood is the OPENING: a dark mouth facing forward with the cloth turning
into it. Here the opening is a closed lofted surface with a separate rolled
tube laid along the front of it, and a tube on a closed surface is a moulding,
not a mouth. It needs the opening built as a real recess -- the same "you
cannot get a slot out of one surface" problem the folded leaves had.

**The trousers' welt pocket reads as two floating bars,** an equals sign lying
on the leg. A welt is two lips with a SLOT between them and the slot is the
whole cue; two strips with nothing between them are just two strips. Same
shape of fault as the hood.

The tee's print also still carries a visible white rectangle border, which is
the decal artwork's own background rather than the geometry.

### The two calls re-examined

**THE BROOM CUT STANDS, for a different reason than I cut it.** Rendered
side by side (`qa/hero/broom_compare/`). I nearly compared against the wrong
object: the four-primitive broom in cleaningTools.js is the one-frame fallback,
and the broom actually seen is `asset_074_broom_fp.glb`, whose bristles are
5,184 triangles. On the real comparison mine loses -- but its BRISTLES beat the
shipping asset's, which are thirty fat separated pegs you can see between. Mine
loses on materials: flat brown block against real wood grain, a black stub
against a brass ferrule. Geometry was never the problem.

**THE HAND CALL WAS WRONG.** `web_probe` unprojects the hole's own pixel. The
ray passes 19.6 mm from t_cmc and 20.5 mm from palm2, and 26 mm from t_web and
t_web2 -- so it is NOT the first web space. It is proximal to it, between the
ball of the thumb and the palm: the thenar eminence, the thickest flesh on a
hand, which has no opening in it. t_cmc sits 33.5 mm from palm1 with 30.7 mm of
radius between them and no edge joining them. A two-node thenar ridge takes the
opening from 2,364 px to 718 px at no triangle cost. 718 px remain.

The probe also caught its own first version out: rendered without the shaft it
reported the GRIP TUNNEL as the worst hole in the hand.

## THE SUITE BASELINE IS ALREADY RED, AT 12

`npm test` on this branch: **3,676 tests, 3,661 pass, 12 fail, 3 skipped.**

None of them are mine, and that is checkable rather than asserted: this
session's commits touch `tools/blender/hero/*` and this log, nothing else, and
`grep -rln "models/hero\|blender/hero" tests/` returns nothing -- no test reads
the hero pipeline at all.

The failures:

    Sheets 6-10 and first-person references resolve to the supplied files
    assets that declare no collision ship no player blocker
    Sheet-6 clean-Blender reimport evidence is complete and production-green
    ceiling-light progression ... and all runtime files
    tests\chairs.test.js
    orchestrator never starts a second Electron child after the first exits nonzero
    the shared set is the one the hands actually use
    modern clubhouse source and exports retain production dimensions
    D (Goal 23): the bands hang from a COLLAR, not from a point
    B (Goal 25): 16-24 countable BUNCHES of many fine strands, not 16-24 rods
    resort source/export/manifest remain reproducible
    the tuning overlay takes pointer events

The two that sound like mine are not: both come from
`tests/mop-verlet-strands.test.js`, which imports `src/render3d/mopVerlet.js`
and never touches a hero builder.

The first run of the suite reported 11 and the second 12, so at least one of
these is flaky -- most likely the Electron orchestrator one.

**THIS MATTERS FOR THE WIRING RULE.** "Revert the asset if the suite fails"
needs a baseline, and the baseline is not green. Anyone wiring must diff
against these twelve, not against zero, or the first asset they wire will look
like it broke eight things it never touched.

The golden gate was NOT run. It captures through Electron, and a parallel
session is measuring frame timings on this machine; starting a second Electron
would corrupt their numbers as surely as it would mine.

## THE APPAREL ATLAS: THE GAME ALREADY SOLVES THIS

I flagged that the atlas is embedded separately in all ten apparel GLBs --
12.6 MB of the 14.7 MB total -- and the brief says to fix it before wiring or
ship twelve copies of one image. **At runtime you do not ship twelve copies.**

`src/render3d/sharedTexturePool.js` interns textures ACROSS files by name, and
`gltfCache.js` calls it on every GLB as it loads. Unnamed textures are skipped
deliberately ("no stable cross-file identity"), and the question is therefore
only whether the atlas carries a name. It does:

    apparel_polo_folded.glb   image[0] name='apparel_atlas'
    apparel_cap_navy.glb      image[0] name='apparel_atlas'
    merch_drinks.glb          image[0] name='merch_labels'

So the ten copies collapse to ONE GPU texture on load: `internTextures` swaps
`material[slot]` for the pooled one and counts the saving in `displacedBytes`.

**The 12.6 MB is a DISK and PARSE cost, not a GPU-memory cost.** That is still
worth something -- it is ten PNG decodes at load and 12 MB of install size --
but it is not the thing the brief was worried about, and rebuilding the apparel
export to avoid it would be work against a problem the codebase already
handles.

There is even an A/B harness for it, `tools/qa/proshop-texture-sharing-ab.js`,
which sets `__FW_DISABLE_TEXTURE_INTERNING` and compares the two runs. When the
apparel is wired I will measure it there rather than assume either way.

## THE FRAMES THAT BACK EACH CLAIM

`qa/` is gitignored, so these are on the machine rather than in the tree.

| claim | frame |
|---|---|
| the folded polo is a stack of leaves, not a lid | `qa/hero/apparel_v2/polo/folded/polo-folded-fairway-eevee-threequarter.png` |
| ...and its edges read from the front | `.../polo-folded-fairway-eevee-front.png` |
| the collar has points and a notch | `.../polo-folded-fairway-eevee-top.png` |
| the hung polo's side is a rounded turn, not a crease | `qa/hero/apparel_v2/polo/hung/polo-hung-fairway-eevee-side.png` |
| ...and its sleeves are closed | `.../polo-hung-fairway-eevee-threequarter.png` |
| the tee's print is the right way up | `qa/hero/apparel/tee-folded/tee-folded-eevee-top.png` |
| the trousers' waistband is not a trough | `qa/hero/apparel/trousers-folded/trousers-folded-eevee-hero.png` |
| the hoodie's hood is still a bread roll | `qa/hero/apparel/hoodie-folded/hoodie-folded-eevee-hero.png` |
| **the broom, mine beside the shipping one** | `qa/hero/broom_compare/pair-hero-eevee.png` |
| ...and at the size a player sees it | `qa/hero/broom_compare/pair-apparent-eevee.png` |
| the hand's remaining opening, unprojected | `qa/hero/hand/hand-webprobe-with-shaft.png` |
| ...and what the thenar pad does to the lit frame | `qa/hero/hand/hand-hero.png`, `hand-palmar.png` |
| the dustpan has no band and no knife edge | `qa/hero/dustpan/dustpan-hero.png` |
| the divot tool is not a paperclip | `qa/hero/divot/divot-eevee-fork.png` |
| the gondola stands on feet | `qa/hero/rack/rack-eevee-hero.png` |

Reference used, at full size: `ref/apparel/polo-rail-shop.jpg` for the folded
stack, and `Designs/ProShop/Images/Goal_26/playtest5/broom-v1-lit.png` for what
the broom actually looks like in the player's hands -- which is the frame that
told me I was about to compare against the wrong object.

## HALF B — MEASURED, AND BLOCKED ON SOMETHING REAL

Half B did not happen, and this time it is not because Half A was unfinished.
I went to wire, measured what wiring would take, and found five blockers. The
first one below is the one that matters, and it means these assets could not
have been wired successfully tonight by anybody. All of it is written down with the numbers, because "it
did not work" is not a handover -- and because two of the four were only
findable by measuring BEFORE touching the game rather than after.

### 0. THE ONE THAT MATTERS: THE EXPORT SCRAMBLES THE ASSET

Found last, and it is upstream of everything else here.

The shipped bunker rake is **1,750 mm tall with its base 786 mm below the
origin**. Its Blender scene is 970 mm tall with its base at -44. The file is
not the asset.

`H.bake_gltf_axis` permutes the VERTEX coordinates -- `(x,y,z) -> (x,z,-y)` --
and does not touch the object's own LOCATION, which the exporter writes through
unchanged. Any part with a non-identity transform therefore has its geometry in
the new convention and its position still in the old one. `RakeGrip` sits at
`(0, -0.7481, 0.8463)` and shipped 748 mm BELOW the origin instead of 846 mm
along it.

**Nothing catches it because every assertion and every render looks at the
BLENDER SCENE.** The GLB is written last and never read again. The scene is
correct in all of them; the file is wrong. A whole pipeline of instruments,
none of which look at the deliverable.

`tools/blender/hero/control_export_roundtrip.py` is the check that was missing:
build, export, re-import, compare bounds. The axis bake and the importer's
Y-up conversion are inverses, so a faithful export comes back where it started.
Rake before: **786.25 mm out**. After: **0.00 mm**.

**The fix already exists in this codebase.** `build_rack` and `build_register`
call `transform_apply(location=True)` on their meshes before the axis swap, and
the shipped rack measures 1225 x 484 x 1500 mm with its base at zero -- exactly
its scene bounds. The other 23 builders do not.

Applied and verified on the rake, the mower and the spreader. **23 of 40
shipped files still have mesh nodes at non-zero translations** and want the
same one-line fix. I have not made it across 23 files unverified at this hour;
the control makes each one a two-minute job with proof.

Meshes only -- sockets are EMPTYs whose locations are the point of them, and
`bake_gltf_axis` permutes those separately.

THE CONTROL CAUGHT ME OUT TOO, which is the best thing about it. Its first rack
recipe skipped the `transform_apply` that `build_rack` actually performs, so it
reported the rack scrambled by 1,318 mm when the shipped file is exactly right.
It was measuring my own omission. An instrument's first result is a claim about
the instrument.

And `drop_to_floor`, which I wrote tonight, was wrong in the same family:
measured in WORLD space, shifted in LOCAL, and printed "now 0.0 mm" while the
rake stayed 48.9 mm under the floor. It verifies its own result now and fails
if it did not achieve it.

### 1. NOT ONE HERO ASSET IS REFERENCED BY THE GAME

`grep -rn "models/hero" src/` returns nothing. `vendor/models/hero/` does not
exist. No entry in `tools/vendor-models.manifest.json` has a `from` under
`Assets/models/hero`. Every one of the 39 hero GLBs is a file on disk that
nothing loads — including the hand, which the table used to say was "already
wired". That was wrong and it is corrected above.

So wiring is not flipping a switch. Each asset needs a vendor path, a manifest
entry, and a call site.

### 2. THE FOUR THAT LOOK LIKE DROP-IN SWAPS ARE NOT

Four in-game GLBs share a name with a hero asset and are loaded by plain URL in
`courseScene.js`, which would have let me wire them by replacing the FILE and
changing no source at all — the safest wiring there is. Measured, they are not
interchangeable:

| asset | in game | hero | 
|---|---|---|
| rake | 56 x 411 x 982 mm, base at z=0, 20,192 tris | 460 x 971 x 1750 mm, z from -830, 784 tris |
| hose nozzle | 915 x 877 x 980 mm, base at z=0 | 46 x 335 x 411 mm — **a different object**: theirs is a coiled hose, mine is the nozzle |
| spreader | 790 x 1070 x 1026, base at z=0 | 780 x 1631 x 1175, z from -249 |
| greens mower | 1092 x 1230 x 1057, base at z=0 | 613 x 1785 x 1106, z from -179 |

The systematic part is the ORIGIN CONVENTION: every in-game prop sits with its
base at z = 0, and the hero exports straddle the origin. Only 6 of 39 hero GLBs
have base z = 0 (the three retail racks, the folded tee, the balls, the
drinks). Dropping one in as-is buries it to the waist in the fairway.

That is fixable and it is mine to fix — it is the export step, not the game.
It is not a five-minute change and it is not one to make at 4am and leave
untested, so it is written down rather than started.

### 3. 27 OF THE 39 EXPORTS WERE STALE

Before wiring anything I checked each GLB's mtime against its builder. **27 of
39 were older than the builder that makes them** — up to 19.7 hours. The
retail rack GLB on disk still had 872 triangles and 14 meshes when the builder
had been making 1,304 in 18 objects for an hour.

This is the stale-frame trap on the DELIVERABLE, and it is worse than the
render version: a stale frame lies to me, a stale GLB lies to the game. I would
have wired geometry that was neither what the builder makes nor what I reviewed
and signed off. A regeneration sweep over all 22 builders is running.

`tools/blender/hero/stale_frame_scan.mjs` should grow a GLB mode. Same idea,
higher stakes.

### 4. AND THE ROOT CAUSE OF THE STALENESS: THE EXPORT IS GATED ON CYCLES

Not carelessness. Twenty of the twenty-five builders export only under

    if not broken and engine == "CYCLES":

so every fast EEVEE iteration -- which is what all the review work is done in,
by design, because Cycles is for the review frames and EEVEE is for the loop --
regenerates the RENDERS and never the DELIVERABLE. The GLB on disk dates from
whenever somebody last paid for a full Cycles turntable.

That is a structural fault, not a mistake anyone made: **the deliverable is
coupled to the slow render mode.** You cannot regenerate an export without also
paying for a 200-sample turntable, so in practice nobody does, and the tree
quietly drifts. A first sweep of all 22 builders in their default mode changed
nothing at all, which is how it was found.

AND THE SHARPEST CASE: **the apparel v2 polo has never been exported at all.**
Not stale -- absent. `build_polo.py` writes
`apparel_polo_{state}_{way}.glb`, and no such file has ever existed on disk,
because nobody has run that builder in Cycles. Eighteen rounds of work across
two sessions -- the panel rebuild, the collar with real points, the leaf stack,
the side-seam sampling, the closed cuffs -- and the deliverable was never
written once. It exists as renders.

Anything that had gone looking for the v2 polo to wire it would have found the
v1 `apparel_polo_folded.glb` from `build_apparel.py` sitting there under a
plausible name, and wired that instead.

The fix is an export-only path that does not render. It is a small change in
each builder's main() and it is not one to make untested at this hour across
twenty files, so the sweep is running as `-- cycles views=1` instead and the
change is written down here.

`build_register.py` was also RED, and had been for 20.8 hours: the receipt slot
sits 11.00 mm inside the printer housing against a 6 mm ceiling. Declared at
the measured depth plus a millimetre, the same way the eight overnight seats
were. Nothing had noticed because a failing builder in EEVEE still writes its
renders before the assertion runs -- and nothing exports in EEVEE anyway.

### 5. THE HALF OF THE DELTA TABLE I CAN GIVE, AND WHAT IT SAYS

Read straight out of the GLB headers, so it is the shipped file rather than the
builder's own count. Draws and programs need the asset in the game; triangles
and texture bytes do not.

**39 assets, 132,748 triangles, 14.7 MB of texture.**

And the texture number is the finding: **12.6 MB of that 14.7 MB is ONE image,
the apparel atlas, embedded separately in all ten apparel GLBs.** Between 1,081
and 1,386 KB apiece, ten times over. Every other asset in the set is either
untextured or carries well under 200 KB.

The atlas was designed so a colourway never costs a program, and it does that
job -- but each GLB carries its own copy of it, so unless the loader dedupes by
content the ten of them are ten uploads of the same pixels. That is a decision
to take before wiring the apparel, not after, and it is the sort of thing that
does not show up until the memory number moves.

A CORRECTION TO MY OWN NUMBER: the divot fork's commit message says 1,024
triangles. The exported GLB is 560. The 1,024 was read off a build print rather
than the file, and the file is what ships.

### WHAT THIS MEANS FOR THE DELTAS

**Still zero deltas against the parallel session's 193 programs and 1,443
draws. Nothing of mine entered the build, and nothing should have until the
origin convention and the stale exports are dealt with.** No in-game
photographs were taken because there is nothing of mine in the game to
photograph.

### THE ORDER I WOULD DO IT IN, AND HOW FAR I GOT

1. ~~Regenerate all exports.~~ **DONE, and the cause fixed rather than the
   symptom.** The 21 CYCLES gates are gone, so a default EEVEE run now writes
   its deliverable and regeneration is minutes rather than hours. The whole set
   has been rebuilt and the scan is the check.

2. **Floor origin: helper written, not yet applied.** `H.drop_to_floor()` is in
   `hero_lib`, does the sockets as well as the meshes, and is called by nothing
   -- applying it mid-sweep would have left half the set on one convention and
   half on the other. It wants applying to the genuinely floor-standing props
   (mower, spreader, rake), NOT to the held tools, whose origin should relate
   to their grip. The hose is not a candidate at all: theirs is a coiled hose,
   mine is a nozzle.

3. **Sockets -- and A CORRECTION TO MY OWN FINDING.** Five assets carry
   `SOCKET_GripPrimary`: `bunker_rake`, `divot_bucket`, `divot_fork`,
   `hose_nozzle`, `pressure_wand`. I first wrote that the mower and the
   spreader were missing theirs and that the brief had asked for them by name.
   That is WRONG, and the builders say so in their own first line: "OUTDOOR
   TOOL -- THE GREENS MOWER. Pushed, not held, so no grip sockets." They carry
   a NAMED ROOT instead -- `Tool_greens_mower`, `Tool_rotary_spreader` -- and
   `H.verify_sockets` checks for it on every build.

   My audit script only matched names beginning `SOCKET_`, so it reported the
   roots as absent sockets and I read that as a gap. The same blind spot hid
   `Fixture_rack_low/standard/tall` and `Merch_apparel/carded/drinks/
   golf_balls/headwear`, which are all correctly anchored too.

   An instrument that only recognises one of the two conventions in the
   codebase will report the other one as missing every time. Nothing was
   wrong with the assets; the check was too narrow, and I nearly "fixed"
   two assets that were already right.

4. **Decide the apparel atlas question** before wiring any garment -- ten GLBs
   carrying 12.6 MB of the same image between them.

5. Manifest entries, then ONE asset end to end with the suite run before and
   after and diffed against the twelve pre-existing failures, then the rest one
   at a time.

## STANDING GATE: THE BLANK FRAMES — NOW GREEN

Nine frames on disk score 1.4–2.2 against a floor of 8. All of them are the same
fault as the cap's `underbrim` camera: a shot aimed below or behind its subject
that photographs the backdrop's back or empty space. `hero_lib.render()` now
hard-fails on these, so rebuilding each asset forces the camera to be fixed.

| frame | asset |
|---|---|
| `hand/hand-palmar.png` | hand |
| `hand/hand-palmar-no-nails.png` | hand (archived control) |
| `hand/hand-palmar-no-weld.png` | hand (archived control) |
| `hand/hand-palmar-no-taper-no-weld.png` | hand (archived control) |
| `rake/rake-under.png` | bunker rake |
| `rake/rake-eevee-under.png` | bunker rake |
| `mower/mower-reel.png` | greens mower |
| `mower/mower-eevee-reel.png` | greens mower |
| `spreader/spreader-spinner.png` | rotary spreader |

## DECISIONS MADE WITHOUT THE OWNER

1. **The overnight brief absorbs the apparel goal.** `Overnight_Assets.md` lists
   "the apparel (all of it)" as one of its assets, so continuing Apparel_V2 and
   starting the overnight list are the same work rather than two queues.

2. **Eight deep seats declared rather than "fixed".** A moulded rake socket, a
   broom ferrule, a hose nozzle's four collars, a pail bail, ledger leaves and a
   merch cap's peak all sit deeper than the 6 mm default because that is how the
   objects are made. I measured every one first and set each ceiling to its
   measured value plus a millimetre or two, so the check still bites. The
   alternative — raising MAX_SEAT_DEPTH globally — would have thrown away the
   assertion that caught the wand.

3. **The broom stays CUT.** See its record below. It is worse than the
   procedural one and it is not close.

4. **The merch/softgoods cap family keeps its old peak geometry** (declared at
   21 mm) rather than adopting apparel v2's sewn-in bill. They are shelf props
   seen across a room; rebuilding the family is a bigger job than the night has
   room for, and it is written down rather than done quietly.

5. **The hand's remaining thumb-web opening is called correct anatomy.** Full
   reasoning in its record.

## DECISIONS MADE WITHOUT THE OWNER — SECOND SESSION

1. **Separate leaves, against the docstring that forbade them.** `folded()`
   said a garment made of separate leaves would be the loose-shell fault
   `assert_all_one_piece` exists to catch. It would not: that check is per
   PART, and the cap already ships six panel objects. I read the assertion
   rather than the comment about it.

2. **The leaves touch rather than float.** `gap` is 0.9 mm, deliberately under
   assert_assembly's 1.5 mm contact tolerance, because a floating ply is the
   loose part that check is for. The visible slot comes from the rolls turning
   away from the contact plane, not from air.

3. **A tighter ceiling for the leaves alone,** 0.6 mm against the general
   6 mm. Raising or reusing the global would have thrown away the check that
   caught the wand.

4. **The collar and placket moved to the body colour.** They were on the trim
   cell, which made them noticeably darker and read as applied patches. Every
   polo in the reference has a self-fabric collar. This changes the HUNG polo's
   appearance too.

5. **The broom cut STANDS but for a different reason,** and I have written the
   reason down rather than quietly keeping the old one. Its bristles beat the
   shipping asset's; it loses on materials.

6. **The hand's thenar pad added, and its bulge accepted.** There is no radius
   that closes the opening without standing proud -- closing it IS palmar
   volume. A thenar eminence is the proudest thing on a palm, and it reads
   correctly from the hero angle. Judged on the lit frame, not the silhouette.

7. **The export gate removed from 21 builders.** Exports were conditional on
   Cycles; that is why 27 were stale and why the v2 polo had never been written
   at all. Exporting from EEVEE produces identical geometry. This changes what
   every builder does on a default run, which is a real behavioural change and
   the reason it is listed here.

8. **The receipt slot declared at 11 mm** rather than raising MAX_SEAT_DEPTH.

9. **The gondola's back panel left plain,** on my own measurement that relief
   small enough to be cheap there is relief too small to read.

10. **The golden gate deliberately not run,** because a parallel session is
    measuring frame timings and a second Electron would corrupt both.

## PER-ASSET RECORD (FIRST SESSION — SUPERSEDED WHERE THE TABLE DIFFERS)

> These are the first session's notes, kept because the reasoning in them is
> still the record of how each fault was found. Where a verdict here says
> ITERATE or PARKED and the table at the top says PASS, **the table is
> current**: the dustpan, the divot tool, the gondola, the folded polo and the
> hung polo were all taken further in the second session. The broom's CUT is
> unchanged, but the REASON for it changed -- see the re-examination above.


### Blank-frame gate — 9 down to 1

Eight of the nine cleared by rebuilding. The cause in every case was the one
already fixed in `hero_lib.render()`: a camera below the backdrop photographing
its underside. `hand-palmar` went from an edge score of **1.4 to 208** with no
change to the camera at all. The three archived hand control variants
(`-no-nails`, `-no-weld`, `-no-taper-no-weld`) were regenerated rather than
deleted, so the controls stay valid.

Remaining: `broom/broom-under.png`. The broom is a CUT asset pending the
brief's "verify the procedural is still the better one", so it is rebuilt as
part of that verdict rather than separately.

### The rake, the mower and the spreader — the rebuilt assertions caught three real things

All three now FAILED their own checks, because `MAX_SEAT_DEPTH` did not exist
when they were written. Two were deliberate deep seats and one was a genuine
instrument fault:

- **Rake.** The ferrule reads 18.9 mm into a 38 mm head — its middle, which is
  how a moulded rake is made. Declared at 22 mm, and a NEW check added for the
  thing that would actually be wrong: the ferrule coming out of the underside
  among the tines. It stops **16.1 mm** clear.
- **Spreader.** `assert_touching` said the axle was "16.00 mm from Wheel_0 and
  not embedded in it" while the axle's end caps were plainly deep in the hub.
  The wheel was a tyre and a hub **joined**, so it self-intersects — and parity
  is undefined on a self-intersecting mesh: a ray through the overlap crosses
  four surfaces where the point is inside one solid, comes out even, and reports
  OUTSIDE. 16 mm is the hub wall, which is what the fallback gap test then
  measures. `HS.weld_union` booleans such pieces into one closed shell, and the
  axle now reads a correct 21.00 mm inside. **Fifth instrument fault of the
  project.**
- **Mower and spreader welds.** Every remaining failure was a tube welded into
  another tube seated to its host's radius. Rather than guess a ceiling each, I
  patched `assert_touching` loose for one run and MEASURED all eight
  (3.00–21.00 mm), then set each ceiling to its measured value plus a millimetre
  or two — so the check still bites if a join moves. A blanket allowance would
  not have.

### THE STALE-FRAME TRAP — found twice, and now it has a scanner

**A stale frame is worse than a blank one.** A blank frame fails the gate; a
stale frame passes every check and lies, because it is a real render of a real
asset — just not of the asset as it is now.

**It happened three times.** The rake's Cycles under-view stayed blank while
its EEVEE twin was cured. Then the spray bottle. Then the ledger, where I made
the ruling heavier, saw no change, and found `ledger-hero.png` was from 16:35
the previous afternoon — that builder uses the `-eevee` suffix where the spray
builder does not, so the two are exactly opposite and neither is wrong. On the
same run the texture regenerated a second AFTER the render that was supposed to
use it.

It cost me two fixes on the spray bottle. Its liquid showed a stack of hard
concentric lenses, I turned off `show_transparent_back` (no change), made the
liquid opaque (no change), and only then checked the file's timestamp:
`spray-eevee-hero.png` was **hours old**. That builder writes no `-eevee`
suffix, so the frame I wanted was `spray-hero.png` — where **both fixes had
worked all along** and the banding was already gone. The rake had the same shape
of problem earlier: its EEVEE under-view was cured while its Cycles twin stayed
blank.

`tools/blender/hero/stale_frame_scan.mjs` flags any frame older than the builder
that makes it. It reports **496 of them**, but it over-reports by design: an
edit that only adds an assertion ceiling changes no pixels, and tonight I
touched nearly every builder that way. It would have caught the one that lied,
which is the point. The four assets whose GEOMETRY actually changed tonight —
hand, wand, spray, spreader — were re-rendered in Cycles.

### The ledger — PASS after one real fix

The ruling was drawn at 1.6 px and 0.55 opacity over a 230 mm page and rendered,
under AgX at -0.9 EV, as **blank paper**. A ledger with no ruling is a
sketchbook, and this is the asset the owner reads at arm's length. Lines to
3.0 px at 0.88, columns to 3.6 at 0.92, the red margin to 5.0 at 0.92, and the
feint colour from #8d9bab to #5d6f85. It reads as an account book now.

Notes not fixed: the turning page has a hard **kink** at its top rather than a
smooth curl, and the page block's fore-edge reads as hard parallel lines rather
than paper.

### The retail gondola — ITERATE, and one thing tried and taken back out

It reads as clean shop shelving: uprights, back panel, shelves with a metal
front lip, three heights as a family. What is missing is the one feature that
makes shelving read as SHOP shelving — the **punched slot column** down each
upright. There are no base feet either, and the back panel is a plain sheet
where a real gondola has pegboard or slatwall.

**I built the slot columns and then removed them.** Worth recording as a
measurement rather than an opinion:

- The first cut went through the full post width, and the very next shelf landed
  in the void it left. `assert_rooted` failed the build immediately. That is the
  check doing exactly its job on a fault I had just created.
- Made shallow and on the inner face only, it cut cleanly — and took the
  standard bay from **872 to 1,736 triangles. It doubled the bay.**
- At the distance a player walks past shelving, a 5.5 mm recess on an inner face
  **does not read at all.** The render before and after is the same picture.

Doubling the largest object in the shop for something invisible is not a trade
worth making. `_slot()` stays in the file, uncalled, because the number is the
useful part: if this ever wants doing, it wants doing in the texture.

### The broom — CUT, confirmed

Faults off `broom-hero.png`: the bristles are **flat vertical ribbons in single
rows**, every one the same length and cut off square, so the brush reads as a
comb; there are **clean vertical slots** at two places where bristle groups do
not meet; and **you can see straight through the middle** of the head between
the front and back rows. 218 objects and 2,820 triangles to look worse than the
procedural build.

I am judging this from the studio render rather than a side-by-side against the
procedural one in game, and I am saying so. But the fault list is decisive on
its own: nothing with visible slots through it ships regardless of what it is
compared against. **The owner's earlier call stands.**

### The dustpan — ITERATE, and I had it wrong first

My first read said "no front lip, no back wall". Reading the builder corrected
me: the pan is one lofted U-profile whose wall height goes to zero at the lip,
so the lip is continuous with the pan by construction, and the rail does raise a
back wall to 80 mm. Recording that because a hostile review that invents faults
is as useless as one that misses them.

What is actually wrong: the side walls end in a **hard knife edge** along their
top; there is a **shading discontinuity** across the pan floor where the loft's
lip rows change; the whole object is **one flat grey** that reads as pressed
sheet metal rather than moulded plastic; and the handle is a plain telescopic
tube with no grip and no hanging hole.

### The divot tool — ITERATE

The pail is good — moulded body, wire bail with ball pivots, a grip sleeve. Two
notes: the rim is visibly **faceted** at 12-14 sides, and the sand is a **flat
disc** with no mounding.

The tool itself reads as a **paperclip**: two thin prongs and a flat white body
with a yellow dot. At 75 mm it is the smallest thing in the set and it is the
least convincing.

### The apparel — the cap PASSES, everything else is PARKED

**The cap is the one that is finished** and it is the proof that the panel
approach works: six panel objects dished and tucked at their seams, a real hole
at the apex under a covered button, a cut-away U at the back bound with its own
tape and bridged by a working snapback, a bill whose two curvatures are driven
by distance travelled forward. 11,874 tris, 44 parts, still the two shared
apparel materials.

**The polo is parked at 8 rounds**, the brief's limit. Its front reads as a polo
— level hem, a collar with a stand and a fold crest and two points, visible
buttons, a chest badge, flat sleeves. Its SIDE does not: the two panels meet at
the side seam in a **hard vertical crease** where a hung shirt has a soft fold,
and the sleeve's open end is a **flat disc** facing the camera. Giving the body
real depth (58 to 83 mm) did not help, because the fault is the crease, not the
thickness.

**The folded garments are parked as a family, and here is the diagnosis.**
`cloth_lib.folded()` builds one lofted block whose rings step in at each leaf,
and the brief's own words apply to it exactly: a softened block stays a block.
Tonight I improved it — the lips now appear at the FRONT EDGE ONLY, where the
reference has them, instead of ringing the whole perimeter at 88% on the sides
and 20% even at the back, which is what made it read as a moulded lid with
concentric rings. That change improves all four folded garments at once. It is
still a lid.

What it needs is the treatment the cap's crown got: **the leaves built as
separate surfaces, not as rings of one loft.** Until that happens the polo, tee,
hoodie and trousers folded states are all the same object with different
proportions, and iterating on any one of them individually is wasted work. That
is why all four are parked together on one reason rather than four times over.

Two things on the folded polo were plainly broken and are fixed: the size band
was built twice in the same function (the second loop overwrote the first) and
the survivor put it on a semicircular arc through the air, so it rendered as a
bag handle looped over a corner. It now follows the garment's own surface.

### The hand — PASS, with a reservation, parked at 6 rounds

`hand-palmar` showed a dark slot between the thumb and the index finger. The lit
render could not distinguish a hole from a shadow and the radial view showed
nothing, so I ran the control the brief asks for: **a palmar silhouette**, where
a genuine hole prints white. It printed white. One render settled it.

The skeleton had no bone spanning the first web space, so the Skin modifier left
it open. Added `t_web`, `t_web2` and `i_web` — closing from the index side as
well, because closing from one edge only chases the gap across. Hung off
existing chains rather than bridged between them: a loop in the skeleton is what
this modifier answers with a second closed hull, which is the 546-vertex
floating thumb, twice.

The opening is now about 40% of its original area and **it survives**. My call,
made without the owner: **what remains is correct anatomy, not a fault.** With
the thumb laid ALONG the handle rather than wrapped round to meet the index —
which is what the solver produces, and it stops on shaft contact at 6.0/8.5/60.5
degrees against limits of 80/75/65, not at a limit — the first web space is
genuinely open on a real hand. What was wrong was the missing membrane at the
knuckle end, and that is closed.

**If that call is wrong**, the next round should NOT guess at node positions as
I did twice. It should unproject the hole's pixel from the palmar camera and
report where that ray passes relative to the thumb and index bones. I stopped
before doing that because six rounds on one asset with nineteen left is the
trade the brief told me not to make.
