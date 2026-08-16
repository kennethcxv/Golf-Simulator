# OVERNIGHT LOG

Running record, appended per asset so the morning report survives compaction.
Started from `Designs/ProShop/Overnight_Assets.md`.

## THE TABLE (kept current)

| asset | verdict | rounds | triangles | new materials | wired |
|---|---|---|---|---|---|
| cap (apparel v2) | **PASS** | 7 | 11,874 | 0 (shares ApparelCloth/Trim) | no |
| register (lane head) | **PASS** | 4 | 5,816 | 0 (5 slots, existing family) | no |
| money (notes + coins) | **PASS** | 3 | — | 0 | no |
| golf balls + packaging | **PASS** | 3 | — | 0 | no |
| polo hung (apparel v2) | **PARKED** at 8 | 8 | 9,980 | 0 | no |
| polo folded (apparel v2) | **PARKED** | 3 | 6,462 | 0 | no |
| tee / hoodie / trousers folded | **PARKED, not started** | 0 | — | 0 | no |
| tee / hoodie hung | **PARKED, not started** | 0 | — | 0 | no |
| hand | **PASS, reserved** | 6 | 5,178 | 0 | already wired |
| bunker rake | **PASS** | 1 | 784 | 0 | — |
| greens mower | **PASS** | 2 | 1,680 | 0 | — |
| rotary spreader | **PASS** | 2 | 1,628 | 0 | — |
| pressure washer wand | **PASS** | 3 | 1,248 | 0 | — |
| customer basket | **PASS** | 1 | 3,454 | 0 | — |
| shopping bag | **PASS** | 1 | 1,724 | 0 | — |
| hose nozzle | **PASS** | 1 | 1,116 | 0 | — |
| spray bottle | **PASS** | 3 | 1,420 | 0 | — |
| divot pail | **PASS** | 1 | 1,468 | 0 | — |
| divot tool | ITERATE | 1 | 152 | 0 | — |
| dustpan | ITERATE | 1 | 1,052 | 0 | — |
| broom head | **CUT** | 1 | 2,820 | — | no |
| ledger book | **PASS** | 2 | 6,656 | 0 | — |
| retail gondola | ITERATE | 1 | 872/bay | 0 | — |
| merch + softgoods | **PASS, reserved** | 1 | 1,480 | 0 | — |

## STANDING GATE: THE BLANK FRAMES

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

## PER-ASSET RECORD

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

### The retail gondola — ITERATE

It reads as clean shop shelving: uprights, back panel, shelves with a metal
front lip, three heights as a family. What is missing is the one feature that
makes shelving read as SHOP shelving — the **punched slot column** down each
upright. There are no base feet either, and the back panel is a plain sheet
where a real gondola has pegboard or slatwall.

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
