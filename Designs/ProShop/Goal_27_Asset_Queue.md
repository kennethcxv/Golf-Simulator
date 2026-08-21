# GOAL 27 — THE ASSET QUEUE

Work straight down this list without stopping. Each asset gets the same loop
that produced the wand: render the turntable, open every frame at full size,
write faults down by frame number, fix, render again. Never review off the
contact sheet.

Push after every asset. Park anything past six rounds and say why rather than
grinding. If you run low on context, finish what you are on, push it, and say
what is left — do not start something new with nothing behind it.

---

# PART 1 — THE OUTDOOR TOOLS

## The thing that makes this batch different: SOCKETS

Your own inventory run found it. `gripsFor()` resolves `SOCKET_GripPrimary` and
`SOCKET_GripSupport` out of the loaded GLB every frame — and returns `null` for
anything outside `CLEANING_TOOLS`. So hose, divot and rake fall back to static
numbers in `LEGACY_GRIPS` that were never reconciled with the manifest positions.

Measured: **the rake's hands sit 0.81 yd from the rake.** Hose 0.97, divot 0.72.

**A new model against the same grip table changes nothing.** Author the sockets
into the mesh and the fault dies permanently, the way it already has for all nine
cleaning tools.

**Every held tool ships with `SOCKET_GripPrimary` as a named empty at the exact
point a hand closes.** Two-handed tools also ship `SOCKET_GripSupport`. Verify by
loading the exported GLB back and finding them by name — that assertion is the
point of this part.

1. **THE BUNKER RAKE** — head with tines one side and a levelling edge the other,
   tapered shaft, moulded end grip. Two sockets.
2. **THE HOSE NOZZLE** — trigger, barrel, coupling, hose entering at an angle.
   Decide whether a support hand should exist; `support: null` is why it reads as
   a tool nobody is holding.
3. **THE DIVOT TOOL** — the hand fork and the soil bucket, both. A socket each.
4. **THE PRESSURE WASHER WAND** — already shipped at 788 tris, but built with no
   socket and on the same fallback path. Add both sockets and re-export. A small
   edit, not a remodel.
5. **THE GREENS MOWER** — pushed, not held. Reel, roller, handlebar, catcher,
   engine housing. No sockets.
6. **THE ROTARY SPREADER** — pushed. Hopper, wheels, handlebar, spinner plate.

Both pushed roots are currently **unnamed** — they land under `Scene`, the same
naming gap that made `Tool_rake` unfindable for two sessions. Name them.

**What is wrong with the current four:** each is ONE MESH of ~20,000 triangles,
one material, no part boundary — rake 20,192, hose 20,313, fork 19,812, bucket
19,815. That is why none can carry a socket, and it is four times the hand's
entire budget. Rebuild as real parts on a shared material library.

**Do not model** `ballmark`, `debris` or `fungicide` yet — they draw nothing at
all today. Tell me what each should be and what it would cost. "Fungicide" may
just be the spray bottle that already exists indoors.

---

# PART 2 — THE UNIVERSAL RACK

One shelving unit that holds anything, not bespoke fixtures per product type.
It is the genre's answer, it makes the layout mine rather than authored, and
bespoke fixtures are exactly how material counts explode.

**BEFORE MODELLING, PHOTOGRAPH WHAT EXISTS.**
`vendor/models/assets_51_100/sheet_07` already has a tiered retail gondola and a
stockroom shelving system. Light them, turntable them, and tell me whether either
already reads correctly. If one does, keep it and say so — that is what you did
with the broom and it was the right call.

**ONE GONDOLA IN THREE SIZES** — low (see over it), standard, tall back-wall run.
Same model, same material, scaled. Sizes are free.

Uprights, adjustable shelves with real thickness and a front lip, a base kick
plate, a back panel. Every shelf **seated in its uprights, not floating** — same
class, same assertion, watched failing on a deliberately floating variant.

**THE DELIVERABLE IS THE MEASURED TOP SURFACE, not the silhouette.** Report per
shelf: usable top rectangle (width × depth), front lip height, clear height to
the shelf above. Those numbers feed the footprint-aware packer that already
exists for the counter. Feed a shelf's measured surface into that and any product
fits any shelf automatically — that is the whole feature.

A beautiful gondola with no measurable usable surface fixes nothing.

---

# PART 3 — THE MERCHANDISE

Everything a customer can pick up. **This is where the material budget is won or
lost**, so read the rule before you start.

## THE RULE FOR ALL MERCHANDISE

**Variety comes from TEXTURES, not from models.** One golf-ball mesh with a dozen
sleeve textures costs one material and one program. A dozen ball models cost
twelve of each — and a parallel session is cutting this game from 349 materials
to under 40 because that is what stands between me and a 70-second load.

**Report the cost for each family as a whole:** materials, programs, draw calls,
and how many distinct SKUs it covers. Target is one material family per group.

## The groups

**GOLF BALLS.** A single ball, a three-ball sleeve, a dozen box. Dimples matter
at the distance a player holds one. Different brands are box textures, not new
models.

**TEES.** A tee, and the bag or tube they come in. Wooden and plastic are a
texture and a colour, not two meshes.

**GLOVES.** A glove in its packet, hanging or boxed. Sizes and hands are texture
variants.

**GOLF SHIRTS / APPAREL.** Folded on a shelf and on a hanger — those are two
genuinely different meshes and both are needed. Colours and patterns are textures.

**HEADWEAR.** A cap. Stacked and single.

**ACCESSORIES.** Divot repair tools on cards, ball markers, towels, a pitchmark
repairer, tape and grip aids — the pegboard tier. Many of these can share ONE
carded-accessory mesh with a texture atlas of the card faces.

**DRINKS AND SNACKS.** A bottle, a can, a bar. High-frequency, low-detail, one
mesh each with a label atlas.

**Confirm the group list against `SHOP_CATALOG` before you start** and tell me
what you are covering and what you are leaving out. Do not model something the
catalogue does not sell.

---

## ASSERTIONS, EVERY ASSET

Same broken-variant discipline, and remember the lesson that has caught you three
times: **a break must exceed the overlap it undoes.** A 30 mm shove does not
detach a 30 mm shank.

- **Sockets findable** on every held tool, from the exported GLB, by name.
- **Every part rooted** — tines in the head, prongs in the handle, wheels on the
  axle, shelves in the uprights.
- **Nothing interpenetrates.** The wand's grip currently passes through its blue
  shell; do not repeat that.
- **Measured surfaces and volumes reported** wherever something holds something
  else — shelf tops, bucket interiors, box interiors.

## BUDGETS

Triangles reported against the hand's 5,179, per asset. Materials reported per
family, with the target of a small shared library across the whole queue.

Anything glossy or translucent gets both Cycles and EEVEE — the game draws closer
to EEVEE.

## REPORTING

Per asset: reference beside the render, turntable with every frame reviewed at
full size, triangles, materials, any measured surface, and a plain SHIP or
ITERATE.

Work continuously down the queue. Push after every asset.