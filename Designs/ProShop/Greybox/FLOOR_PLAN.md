# Pine Hills v2 — Greybox Floor Plan

> **Status: APPROVED 2026-07-28, with two amendments, both incorporated below.**
> (1) Decision D1 approved as written — the checkout frame moves to the south wall and
> `PineHillsFrontDeskBackdrop` is deleted. (2) The lounge stays, rejustified: it is a
> **cleaning surface**, not decor (§5), with two recorded consequences — fully dirtyable
> in the v2 dirt plan, and visible from the entrance (§3 F5; `rail_outer` leaves the
> door→lounge fan to guarantee it). Approval green-lights exactly the greybox build in
> §9 — and nothing else (no hero assets, no materials, no lighting changes).

The room this replaces is measured in `../Baseline/PHASE_0_REPORT.md` §4 and the build
mechanism is the approved `../Baseline/AB_SCENE_PLAN.md` §1: a new `pine-hills-v2`
variant in `src/render3d/clubhouse/pineHillsV2Interior.js`, entered only by
`?clubhouse=pine-hills-v2`, with the old room untouched and switchable.

All coordinates are **building-local yards**, origin at the building centre,
**+z = SOUTH (entrance side), +x = EAST (service wing)**, floor at y 0 — the same
frame as `src/data/shopLayout.js`, which remains the coordinate bible.

---

## 1. What is fixed and what this plan changes

**Fixed — the greybox does not touch:**

| Invariant | Value | Why |
|---|---|---|
| Shell, doors, windows, porch | `SHELL`, `DOOR_MAIN` (S wall, x −0.8), `DOOR_STOCK`, `DOOR_BACK`, 4 windows | The building is architecture, not dressing |
| Interior envelope | 17.87 × 10.98 yd (`MODERN_PUBLIC_INTERIOR`) | `reno.grime` is exactly 104 cells over `RENO.room`; same dims → grid untouched, saves safe |
| Service wing | partition x 5.7 (z ≤ 2.0) + partition z 2.0 (x ≥ 5.7); stockroom, office, restroom pod, receiving flow, all `STOCKROOM`/`OFFICE` datums | Proven gameplay loop; zero §4 complaints |
| Ceiling panels | the 8 `CLUBHOUSE_CEILING_PANELS` ids and rects | Repair-gameplay ids are persisted in saves |
| Entrance dressing | `MAT`, `LOGO_RUG`, `BASKET_STATION`, `HOURS_SIGN`, both clearways | Working; the rug and baskets serve the entry sequence |
| Save schema | `state.shop.*`, fixture ids, `SAVE_VERSION` | Both rooms must load the same save |
| Register choreography | every frame-LOCAL offset in `FRONT_DESK_*`, `COUNTER`, `REGISTER` | 20+ tests and the QA drivers pin it; it is the part of checkout that works |

**Changed — the two masses §4 measured, plus the floor that serves them:**

1. The **front desk frame moves** from the door axis to the south-east wall (§2).
2. The **free-standing backdrop dies** — `PineHillsFrontDeskBackdrop`, a 4.85 × 2.48 yd
   panel standing at (−0.8, −0.16), 78 % of room height, dead on the room's centreline.
   Its three functions (key rack, tee-time board, club mark) land on the south wall
   behind the relocated desk — at their existing frame-local poses (§2).
3. Six retail fixtures reposition; everything else keeps today's coordinates (§5).

---

## 2. Decision D1 — the desk frame moves. This is the datum change.

**Proposed v2 frame: `x 3.30, z 3.35, ry 0`** (today: `x −0.8, z 1.80, ry π`).

The desk becomes a south-wall counter east of the entrance — the classic pro-shop
position: enter, the shop is ahead of you, the counter is to your right.

| Derived datum | Today (ry π, on the door axis) | v2 (ry 0, SE wall) |
|---|---|---|
| Desk slab | x −3.10..1.50 across the entry, z 1.80 | x 1.00..5.60 along the S wall, front face z 2.94 |
| Register | (0.40, 1.80) | (2.10, 3.35) |
| Queue head → step | (−0.32, 2.85) stepping SE toward the door | (2.82, 2.30) stepping WNW into the shop, away from till and door |
| Laptop | (0.92, 1.72) | (1.58, 3.43) |
| Staff chair / corridor | corridor on the room side of the desk | corridor z 3.76–4.89 against the S wall, entered from the office |
| Key rack / boards | surface z −0.08 — **mid-room**, on the backdrop | on the real S wall plane, z ≈ 5.42, frame-local x — **wall-mounted** |

The register/queue/laptop rows are the proof the choreography survives translation:
every checkout offset is authored frame-local, and Pine Hills itself already rotated
the whole frame 180° (`ry π`) as a one-token presentation choice. v2 is the same
operation — a translation and a rotation of one frozen constant. The reach circles,
scan volume, drawer travel, staging/bagging rects and queue pitch all ride along
unchanged in local space. One honest exception, found against the code: the boards'
`+0.20 world-Z` renderer compensation is **ry-π-specific** (at ry 0 it stacks instead
of cancelling and would sink the boards 0.14 yd into the wall), so v2 does not reuse
it — the key rack and both boards mount on the actual wall plane at their frame-local
x positions (key rack x 1.37, tee sheet x 2.55, club mark x 4.25), facing the room.

**Mechanism** (build session): `shopLayout.js` exports a pure
`deriveFrontDeskFrame(variant)`; the module-level `FRONT_DESK_FRAME` and everything
derived from it resolve once at load from the active variant (browser query param;
Node and every existing test see no variant → today's values, byte-identical). v2
layout tests call the pure derivation directly — no module-state games. The same
module-load variant switch resolves the six repositioned fixture poses (§5), the
clutter spots and traffic polylines (§7), and the `safety` campaign site (§8): one
seam, one resolution point, and the dirt system (`clubhouse/dirt.js` paints from
`TRAFFIC_PATHS`, `FIXTURES` footprints and `frontDeskPoint`) re-seeds the v2 room
with zero dirt-code changes. This is the "separate, explicitly-approved change"
`AB_SCENE_PLAN.md` §2 anticipated; approving this document is that approval.

**Costs, priced:**

| Owed work | Size |
|---|---|
| Reach-circle re-derivation + `checkout-space` run against the v2 frame | the local rects are unchanged, so this is a verification run, not a redesign |
| Queue slots, campaign `frontCounter`/`registerHardware`/`laptop`/`officeChair` anchors | derive from the frame — follow automatically (§8) |
| New dirt plan + `TRAFFIC_PATHS` + cleanup-pose table for v2 | required by the AB plan for ANY new layout (§7) |
| Consumers | 19 files read these datums (~166 sites) — **zero edits**: all consume the derived module values, which is why the seam is the frame itself |
| `reno.grime` | untouched — room dims do not change |
| Asset 061 | the counter shell gets rebuilt/reposed for the v2 desk in Phase 4 — which is exactly why its staff-bay carve is deferred (`../Discriminator/ASSEMBLY_FIXES.md`) |

**Rejected alternative D1-b** — keep the frame, delete only the backdrop, see over the
1.055-yd counter: zero datum risk, but the first view remains the back of a desk 3.7 yd
inside the door, which is the confirmed §4 complaint in the user's own review verdict.
It under-solves the one thing Phase 3 exists to solve.

---

## 3. The four §4 findings, and how each is solved

**F1 — "The reception counter sits immediately inside the entrance and blocks the
entrance sightline."** Solved by D1: the entry-axis strip **x ∈ [−2.4, 0.9], door to
north wall** contains nothing taller than **1.35 yd** (feature table 1.0; rug, mat,
campaign markers flat). The desk's nearest corner is 1.85 yd east of the strip.
*Acceptance (greybox, measured):* from the door pose (−0.8, 5.2, eye 1.7) looking north,
≥ 60 % of rays in the central 40°×20° cone first hit ≥ 8 yd away. Today that number is
~0 % — every central ray dies on the backdrop at 5.6 yd or the desk at 3.7 yd.

**F2 — "The centre column and counter island split the room into halves that cannot
see each other."** The backdrop panel (the "column") is deleted; the desk (the
"island") becomes wall-backed. New standing rule for the open floor: **no free-standing
element both wider than 2.5 yd and taller than 1.35 yd** anywhere west of the partition
— tall things live on walls. *Acceptance:* from room centre (−1.6, 0), all four retail
walls' mid-points are unoccluded at eye height.

**F3 — Circulation: door → browse → counter → exit.** One legible counterclockwise
loop (§7): decompression zone with the feature display 2.9 yd in, main aisle north to
the ball/accessory walls, west to the club wall, back east past apparel/shoes/bags to
the queue head, out past the grab-and-go corner. Clear widths, measured rect-to-rect:
main loop **≥ 1.6 yd**, secondary aisles **≥ 1.1 yd**, staff corridor **1.13 yd**
(min 1.1 — `STAFF_CORRIDOR_MIN`). The queue holds 3 without touching the door clearway
or the main aisle; slot 3+ drifts across the entry axis at z ≈ 1.0 — accepted, rare,
and 4.5 yd clear of the door. *Acceptance:* 10 scripted customers complete the full
route in both neglected and restored states (§9).

**F4 — "Clutter reads as accidental rather than authored."** Eight clutter spots
(same count as today — the grime/clutter budget is unchanged), every one in a corner or
dead zone **≥ 0.8 yd off every traffic polyline**, and every one carrying a story label
in the plan (§7). Boxes never sit on the loop. *Acceptance:* the spot table in §7 is
the shipped `CLUTTER_SPOTS_V2`; a layout test asserts the 0.8-yd clearance.

**F5 — the lounge must read from the entrance** (approval amendment). The lounge is a
cleaning surface (§5): the neglect→restored transformation has to register on arrival,
so the door→lounge fan must be open. Measured against real fixture half-extents, a
1.45-yd rail anywhere in the mid-floor band x ≈ 1.0–2.9 cuts either the F1 strip or a
chair ray — so `rail_outer` leaves the open floor entirely (§5). The first greybox
boot then measured what the tier assumption had hidden: **the furnished starter
conveys the bag stand on day one** (no tier-1 grace), and with it in the fan chairA
read 0 % and chairB 85.7 %. The fix is the §5 swap — the 0.15-yd putting strip takes
the floor in front of the lounge (the chairs watch the green; every lounge ray passes
over it) and the bags move west. *Acceptance (greybox, measured):* from the door pose
(−0.8, 5.2, eye 1.7), silhouette sample visibility per upholstery piece — `chairA`,
`chairB` and the coffee table each ≥ 95 % at every tier; the flat rug is reported but
carries no bar (grazing incidence).

---

## 4. Fixture rules

* Every fixture ships at **final dimensions** as an untextured grey volume, named
  `GREY_<id>`, and registers its analytic collider via `addCol`/`addProp` — the only
  navigation authority. GLB collision stays contractually inactive.
* Heights in greybox: wall units 2.2, desk 1.055 (`COUNTER_TOP`), hutch 1.0, tables
  1.0, feature 1.0, rails 1.45, hat tree 1.75, fitting booth 2.05, premium case 1.9,
  demo strip 0.15 + 0.4 return.
* Fixture ids are persisted: **every id keeps its name**. Cuts remove geometry, not ids
  (a cut id simply has no v2 placement).
* Campaign keep-clear rects (§8) and both door clearways are validator inputs: the
  build fails if any fixture rect intersects them.

---

## 5. The fixture schedule — every fixture justifies itself or is cut

Poses are `x, z, ry`. **KEEP** = today's coordinates, unchanged.

| id | v2 pose | Gameplay reason (why it exists at all) | Δ vs today |
|---|---|---|---|
| `frontCounter` frame (desk + return) | **3.30, 3.35, ry 0** | The till: register flow, scan volume, drawer, laptop worktop, campaign facility | **MOVED** (D1) |
| `backcounter` | **4.00, 5.19, ry 0** | Staff-side storage under the wall boards; campaign key-rack surface | **MOVED** to S wall |
| key rack / tee-time board / club mark | frame-local poses, land on S wall | Check-in affordance + the shop's one branding moment, behind the cashier where every payer faces | rides with frame |
| `rack_drivers` / `rack_irons` / `rack_putters` | KEEP (x −8.55; z −3.2 / −0.2 / 2.8, ry π/2) | The hero wall: three browse fixtures with skus; putters gate the demo experience | — |
| `shelf_balls` | KEEP (−7.2, −5.05) | Consumable browse target, highest-frequency sku class | — |
| `shelf_acc` | KEEP (−4.0, −5.05) | Seven-sku browse wall | — |
| `shelf_small` | KEEP (−0.8, −5.05) | Gloves/apparel browse wall; gates fitting room | — |
| `table_polos` | KEEP (−6.0, 0.65) | Four-sku apparel table, three browse stops | — |
| `rail_outer` | **−4.00, 5.20, ry π** | Outerwear browse on the exit path — last-chance apparel between the snack corner and the door; at 1.45 tall it cannot stand anywhere in the open floor without cutting the F1 strip or the F5 lounge fan (both measured) | **MOVED** to the S wall |
| `hatstand` | KEEP (2.0, −4.95) | Three-sku impulse browse | — |
| `bagstand` | **−5.00, 2.90, ry 0** | Tier-2 big-ticket browse between the apparel table and the club wall (pick clubs → cross-sell the bag). Measurement forced the move: the furnished starter conveys it on day one, and at its old spot, 1.25 yd tall, it owned the door→lounge fan — chairA read 0 %, chairB 85.7 % | **MOVED** west, out of the F5 fan |
| `shoerack` | KEEP (−5.9, −3.5) | Tier-2 browse; pairs with fitting room | — |
| `fittingroom` | **−3.55, −2.85, ry π/2** | Tier-3 experience fixture (apparel conversion); booth is 2.05 tall — its east face grazed the F1 strip | **NUDGED** 0.55 west |
| `feature` | **−1.35, 2.60, ry π** | The decompression-zone power display — the first merchandise you see; tier-2. Faces the entrance; browsed from the aisle side — at ry 0 its browse stand would land inside the door clearway | **MOVED** onto the entry rug (from −4.75, 3.25) |
| `cold_drinks` | KEEP (−8.55, 4.78) | Grab-and-go on the exit path | — |
| `snackrack` | KEEP (−6.0, 5.05) | Same; the SW corner is the "one last thing" corner | — |
| `member_station` | **5.15, 2.15, ry −π/2** | Scorecard sku + service point; belongs beside the till, off its old spot which is now the queue head. z 2.15: at the drafted 2.05 its rect grazed the relocated safety keep-clear by 0.03 yd | **MOVED** to partition face |
| `tour_vault` | KEEP (4.95, −1.65) | Tier-3 premium experience case, wall-backed | — |
| `putting_demo` | **1.35, −2.65, ry 0** | Tier-3 experience staged in front of the lounge — the chairs watch the green, and at 0.15/0.4 yd tall the F5 fan sees straight over it at every tier. Its old pose (2.75, 4.25) is inside the new staff corridor; the drafted west spot went to the bags when F5 was measured | **MOVED** |
| office / stockroom set (`office_desk`, `office_chair`, `office_filing`, `packing_bench`, `backshelf_n/e/e2`) | KEEP | Back-office loop: laptop chair, filing, receiving, restock | — |
| Lounge suite (`chairA/B`, `coffee`, `rug`, `trophy`, `events`, `photo`) | KEEP (NE corner per `LOUNGE`) | **Cleaning surface — approved with amended justification.** Not decor: upholstery is among the highest-value before/after material in a restoration game, and the lounge is the room's clearest "this place was neglected" read. Two recorded consequences: **(a) fully dirtyable** — the v2 dirt plan covers the whole suite from day one (grime cells under the footprint, the three `lounge:*` cleanup targets with visuals, the crooked chair). No upholstery-level dirt mechanism exists in the codebase today; building one is material work, **recorded here as a Phase 4 requirement** so the grey chairs are understood as stand-ins for dirtyable upholstered heroes. **(b) Entrance-visible** — guaranteed and measured as F5; `rail_outer` left the fan to buy it | — |

**Cut list:**

| Cut | Was | Why it had no reason |
|---|---|---|
| `PineHillsFrontDeskBackdrop` panel + trims | 4.85 × 2.48 yd free-standing wall at room centre | Pure dressing whose only measurable effect was F2 — splitting the room. Its three functions move to a real wall |
| Every `pineHillsInterior.js` dressing item not named in this schedule | plants, misc set pieces | Default-cut rule: v2 greybox contains ONLY scheduled fixtures + shell. Dressing returns in Phase 5 item-by-item, each with a stated reason — nothing re-enters by inertia |

---

## 6. The floor plan

Scale: 1 column ≈ 0.5 yd, 1 row ≈ 0.5 yd. North (z −5.49) at top. `·` = open floor.

```
        x= -8.9    -7    -5    -3    -1    +1    +3    +5   5.7      +8.9
             |     |     |     |     |     |     |     |     |         |
  z -5.49  W ┌─[BALLS──][ACCESS──][GLOVES─]···[HT]······┬──────────────┐
     -5      │c····························①···········│  STOCKROOM   │ N
     -4      │l··[SHOES──]···················{LNG·window│ [backshelves]│
     -3      │u··[SHOES──]·[FIT]··[DEMO════]·{LNG chairs│ [rcv]═ BACK
     -2      │b·····②·····[FIT]···············{LNG·····│·············│ DOOR
     -1      │w······[dsS]·····•FLOOR··········┃[VAULT]·│ [restroom]···│
      0      │a······[dsS]··························⑤│··············│
     +1      │l··[TABLE───]····•panels·→·······③·[safe]├──stock·door──┤
     +2      │l··[TABLE···]······queue③②①···[MEMB]····│    OFFICE    │
     +3      │··[BAGS───]·······[FEAT]··∎∎∎∎∎∎∎∎∎∎∎∎∎∎∎│ ④·[DESK]····│
     +4      │······⑦·······{rug}·{rug}·R∥··corridor····→··[chair]····│ E
     +5      │[FRIDGE]·[SNACK][RAIL]{mat}·[HUTCH═boards]│··[map]·······│
  z +5.49    └───⑧────────────┤MAIN·DOOR├──────────────┴──────────────┘
                 S (porch: welcome mat, hours sign — door at x −0.8)

  ∎ = the desk slab (x 1.00..5.60, front face z 2.94, top 1.055)
  ∥ = the return, closing the corridor's door end (x 1.00..1.87)
  R = register (2.10, 3.35) · laptop on the desk at (1.58, 3.43)
  corridor = staff lane z 3.76..4.89, 1.13 yd clear, entered from the office →
  queue ①②③ = (2.82,2.30) (1.64,1.85) (0.46,1.40) — the frame's own local pitch
  •FLOOR / •panels = campaign repair sites (kept fixture-clear)
  ①…⑧ in the open floor = clutter spots (§7 stories) — corners and dead zones
  {LNG} = lounge suite (KEEP — cleaning surface, F5) · [FIT] booth
  [DEMO] = putting strip, 0.15 tall — in front of the lounge; the F5 fan sees over it
  [RAIL] = outerwear rail on the S wall · [BAGS] moved west (both left the F5 fan)
  Entry-axis strip x −2.4..0.9: nothing over 1.35 tall from door to north wall
```

Key measured clearances: door clearway untouched (nearest fixture corner: desk return
at x 1.00, 0.50 yd east of it) · feature-to-return pass 1.35 · feature-to-table pass
2.40 · main north aisle ≥ 2.2 · club-wall browse lane ≥ 1.6 · lounge approach 1.6 ·
staff corridor 1.13 · hutch-to-return wall gap 0.31 (sealed by the return end panel) ·
rail–snackrack wall gap 0.65 (both wall-backed) · rail browse stand 1.5 yd clear of
the door clearway.

---

## 7. Circulation, dirt, clutter

**Customer route** (door → browse → counter → exit): enter at (−0.8, 5.49) → split
around the feature table → north aisle (x ≈ −0.9) → ball/accessory/glove walls → west
to the club wall → south past shoes/fitting → east along z ≈ −1.4 past bags/rail →
queue head (2.82, 2.30) → pay facing the boards → exit west past the outerwear rail
and the grab-and-go corner. Staff route: office → corridor mouth at (5.65, 4.3) → till; customers cannot
enter the corridor — the return closes its west end, the desk its north flank.

**Draft `TRAFFIC_PATHS_V2`** (final polylines land with the dirt plan in the build):

```
[(-0.8,5.45), (-0.3,2.9), (-0.9,-1.4), (-2.2,-4.7)]   door → aisle → north walls
[(-0.3,2.9), (1.77,1.68), (2.82,2.30)]                 aisle → queue → service
[(-0.9,-1.4), (-7.6,-0.6)]                             aisle → club wall
[(-0.9,-1.4), (4.2,-1.55), (3.9,-3.3)]                 aisle → vault corner → lounge
[(8.1,4.1), (8.1,0.6), (8.45,-3.4)]                    office → stock → receiving (KEEP)
[(6.4,4.3), (4.3,4.3)]                                 office → till corridor
```

**`CLUTTER_SPOTS_V2`** — eight, all ≥ 0.8 yd off the polylines, each with its story:

| # | Spot | Story |
|---|---|---|
| ① | (1.20, −5.05) | unhung apparel stock, wall nook between gloves and hat tree |
| ② | (−6.30, −3.90) | shoe boxes mid-unpack beside the shoe wall |
| ③ | (−3.30, −4.60) | fallen pegboard stock under the accessory wall |
| ④ | (6.70, 2.60) | office paperwork pile (KEEP) |
| ⑤ | (5.25, 0.10) | returns pile against the partition, clear of the panels site |
| ⑥ | (6.55, 5.20) | office corner pile, beside the filing cabinet |
| ⑦ | (−7.90, 4.60) | delivery never shelved, beside the drinks fridge |
| ⑧ | (−8.10, −4.80) | unopened range-ball delivery, NW corner (KEEP) |

Two spots moved during the build, when the F4 layout test measured the drafted poses
at 0.75 yd (③, off the door→north leg) and 0.65 yd (⑥, off the new office→till
corridor leg); the table above is the shipped `PINE_HILLS_V2_LAYOUT.clutterSpots` and
is exactly what `tests/pine-hills-v2-layout.test.js` enforces. The circled digits in
the §6 map are approximate at that scale; this table is authoritative.

Dirt: `reno.grime` grid untouched (same room). The v2 dirt plan re-seeds along
`TRAFFIC_PATHS_V2` + `DOOR_MAIN` + `MAT` exactly as `clubhouse/dirt.js` does today, and
v2 authors its own `CLEANUP_POSES` table (the Pine Hills one is orphaned by design —
`AB_SCENE_PLAN.md` §3.3). Grime/wet overlays keep y 0.026/0.028 and their name
whitelist; the floor stays flat — the held-tool contact solve requires it.

---

## 8. Campaign anchors — nothing softlocks

| Site | v2 anchor | How |
|---|---|---|
| `frontCounter`, `registerHardware`, `laptop`, `officeChair` | follow the frame | derived from `COUNTER`/`REGISTER`/`FRONT_DESK` — automatic under D1 |
| `officeDesk`, `stockroomShelves` | KEEP | service wing unchanged |
| `displayShelves` (−4.25, −0.7, 2.4×0.8) | KEEP, kept fixture-clear | sits in open floor between table and rail's old spot — validator rect |
| `safety` | **(5.30, 1.35)** | old spot (5.15, −0.85) is under `tour_vault`'s wall run; moves 2.2 yd north on the same partition face, clear of the panels site and member station |
| Repair sites ×8 (`ceiling`,`floor`,`panels`,`trim`,`windows`,`porch`,`shell`,`entranceDoor`) | KEEP all | architectural or on floor the plan keeps clear; `floor` (−2.1,−0.8) and `panels` (5.15, 0.75) are validator keep-clear rects. `panels` sits at the staff-corridor mouth — reachable, kneel-clear, and the corridor keeps ≥ 1.1 past it |

The build session diffs `campaignWorld.js`'s site list against this table before first
run; any drift is a plan bug, not a runtime surprise.

---

## 9. The build session — scope and the numbers it must report

Build scope, in order: (1) `deriveFrontDeskFrame` seam + v2 frame constants;
(2) `pineHillsV2Interior.js` greybox — grey volumes per §5, colliders, v2 dirt plan,
traffic paths, clutter spots, campaign table; (3) **OBS-1 is already fixed on this
branch** — `b1c7e5b fix(LAPTOP-1)` corrected the walk-lens snapshot ordering in
`walkFocusOn`, with evidence in `../Phase1/data/fix-laptop-fov-verify.json`; the
build session re-runs `tools/qa/proshop-fix-laptop-fov-verify.js` and reports the
measured 66/34/66 instead of re-fixing (`AB_SCENE_PLAN.md` §3.2's condition is
satisfied); (4) `BASELINE_VARIANT` env in the capture script (still owed);
(5) verification. No hero assets, no materials, no lighting changes, no GLBs
(grey volumes are procedural — the part-visibility gate is untouched).

**Report measured numbers, not assurances:**

| System | The number |
|---|---|
| Checkout | one scripted full transaction in v2: items scanned / total / change / `tx` completes; `checkout-space` reach-circle distances against the v2 frame, all within the same bounds the old room passes |
| Laptop | `camera.fov` before / inside / after (66 / 34 / **66**), both exit routes, re-verified in v2; every sidebar destination reachable from the v2 seat pose (the tour's 7 pages — older notes' "24 pages" counts tabs/aliases, which the headless page suite covers) |
| Customer navigation | 10/10 scripted customers complete door → browse → queue → pay → exit, in neglected AND restored states, run twice each (the anti-slop repeat rule); mean route time; **zero stuck NPCs across a full simulated day** (state-age watchdog — any customer pinned in one nav state past its timeout fails the run) |
| Save/reload | old-room save → v2 load → old-room load: 104 grime cells, stock counts, drawer cash, campaign task states identical both directions (field-level diff counts) |
| Sightline | the F1 ray metric from the door pose (≥ 60 % of central-cone rays first-hit ≥ 8 yd), the F2 wall-midpoint check, and the F5 lounge-visibility percentages per upholstery piece |
| Clearances | every §6 aisle number re-measured from the placed colliders |
| Performance | the 7 baseline scenarios × 3 runs in BOTH rooms, same session, seeded empire; 1 % lows and worst frame side by side with the harness's 95 % CI per scenario; no unapproved regression > 10 % (deltas quoted against the CI) |
| Suite | full `node --test` green, including `proshop-part-visibility` and the existing register/laptop/nav pins (which all still run against the DEFAULT room and must not notice v2 exists) |

**What approval of this document authorises:** exactly the scope above, in a fresh
session. **What it does not:** Phase 4+ (hero assets), any texture work (deferred in
`../Spike/TEXTURE_VALIDATION.md`), the 061/099 geometry work (deferred in
`../Discriminator/ASSEMBLY_FIXES.md`), or removal of anything from the old room.

---

## 10. THE RESIZE — the 70 m² room this plan grew into (2026-07-28)

The greybox walk (see `../OVERNIGHT_REPORT.md`, the authoritative record) judged
the room above "far too large for a failing municipal starter pro shop" and
authorised a resize. The design was derived (real municipal shops 25–90 m²;
TCG Card Shop Simulator ≈ 50–80 m²; Supermarket Simulator starts at 16 m²),
approved by the morning "Continue", and built as commit `00f92eb`.

**What changed against §§5–7 of this document:**

- **Envelope:** public floor x ∈ [−2.60, 5.70], z ∈ [−4.60, 5.49] = 8.30 × 10.09 yd
  = **70.0 m²** (was 134.4 m²). East (service partition) and south (door/porch)
  anchor; the new west/north walls are grey slabs with builder-owned colliders
  inside the authored shell. The space behind them is sealed cavity pending the
  Phase 4+ exterior re-author. Ceiling **2.80 yd = 2.56 m** (was 2.93 m) with four
  exposed beams (2.40 m clear).
- **Windows: none. Settled 2026-07-28 — the room stays windowless.** The resize
  sealed all three public-room windows behind the new west and north walls,
  leaving the glazed main door as the only aperture. The Phase 4 walk-through
  raised that as an open question and ruled it closed: *the room stays
  windowless, because the walk wants it darker and a window works against that.*
  This is a design decision, not an artifact of the resize — do not "restore" a
  window as a fix, and do not treat the sealed openings as a defect. The office's
  east window survives in the service wing and is still the `windows` repair
  site. Recorded in `ART_BIBLE.md` §2.4.
- **Cut rather than crammed (11):** rack_drivers, rack_irons, rack_putters,
  table_polos, shoerack, bagstand, rail_outer, hatstand, snackrack, cold_drinks,
  shelf_small (gloves SKUs fold into the essentials pegboard). Clubs, apparel
  depth, bags, shoes and refreshments become the upgrade path.
- **Keepers re-seated:** fitting booth NW corner (−0.35, −3.70, ry 0 — its
  axis-aligned analytic hull now matches its shell); golf balls (−2.25, −1.55)
  and essentials+gloves (−2.25, 1.75) on the west wall; feature display
  (0.55, −0.55) facing the door; putting strip (1.70, −2.20); the **lounge
  re-seats in the new NE corner** (chairA 3.55/−4.05, chairB 4.45/−3.30, coffee
  3.55/−3.35, photo on the new north wall) — mandate intact. Desk frame, queue,
  backdrop, member station, safety site, tour vault, and the whole service wing:
  untouched.
- **§9's metric change, recorded:** the literal F1 ≥8-yd threshold is physically
  impossible for most bearings in a 9.2 m-deep room (the walls arrive first), so
  the resize contract is wall-normalized F1 — first obstruction at ≥80% of the
  empty-room distance per ray, pass fraction ≥60%. Both figures are measured and
  reported; the same instrument measures both rooms.

**Measured on the finished room** (evidence in `data/`): F1 normalized **65.7%**
(v1: 5.7%) with the near-blockers now the retail fixtures themselves rather than
the POS masses; F1 literal 51.7% (wall-capped; static prediction 51.2%); F2 4/4;
F5 lounge 71.4/100/85.7/71.4 (the putting strip and feature corner shade
below-knee samples — flagged as a design trade, not silently accepted); staff
corridor 1.130 / queue 0.640 / spacing 1.263 (identical to the approved desk);
checkout $33.00 card transaction with exact business deltas; laptop 66/34/66 both
exits; save round-trip zero diffs. Customer-day and perf-vs-Phase-0 figures live
in `../OVERNIGHT_REPORT.md` §12. Layout contract: `tests/pine-hills-v2-layout.test.js`
(16 tests) now proves every stand point and queue slot ≥0.30 yd clear of every
collider rect — the stuck-customer class of this room's first build cannot
statically recur.

---

## 11. Two rulings on the resized room (2026-07-28, user)

Both flags raised by the resize close-out (`OVERNIGHT_REPORT.md` §12) were ruled
on the following morning. Recorded here so neither is revisited.

### 11a. Queue re-pitch — CHANGED (design change, not a test fix)

**Ruling:** *"Re-pitch the queue south along the desk face. A queue that crosses
its own exit path is a layout error, not a sim artifact."*

**What was wrong:** the v1 frame-local pitch (−1.18, −0.45) steps the tail WEST
into the room. In the 70 m² envelope that lays the waiting line directly between
the head and the door — every leaver wades through it — and at a no-cashier full
house the linear slots run through the west shelves and out of the room entirely
(slot 5 = local x −3.08, slot 8 = −6.62; the west wall is at −2.60). The
resized-day block log's entire residual mass (455/380 events, all `counter`
stops, all west-shelf colliders) is this geometry.

**The shipped design** (`PINE_HILLS_V2_LAYOUT.queue`, walked by
`pineHillsV2QueueSlot()` — v1 untouched, byte-identical in Node):

- **Head unchanged** at frame-local (−0.48, −1.05) → room (2.82, 2.30): every
  checkout reach circle, camera pose and save datum keeps.
- **Line east along the desk face:** pitch (+0.80, +0.10), slots at (2.82, 2.30)
  → (3.62, 2.40) → (4.42, 2.50), hugging the face band 0.44–0.64 yd off the
  slab. The tail now grows AWAY from the exit; the two flows cannot cross. The
  face runs out at member_station (rect west edge 4.77), so the line holds 3.
- **Overflow pocket** for indices ≥3 (the no-cashier full house): sunflower
  packing around (3.40, 1.25) — r = min(0.52 + 0.30√k, 1.05) at k·2.3999632 —
  nine deterministic unique points on open floor SE of centre, every one ≥0.30
  from every fixture rect, wall and the desk slab, and none in the exit lane.
  A full house bunches on open floor instead of extending a line into a wall.
- Queue spur wear line follows: (−0.60, 2.60) → slot 0 → slot 2.
- Reported clearance changes: queue spacing 1.263 → 0.806 (tight-retail band);
  head-to-desk 0.640 unchanged.

**Tests changed, and why (design change):** `tests/pine-hills-v2-layout.test.js`
previously re-derived the queue from hardcoded locals (−0.48, −1.05)/(−1.18,
−0.45) and audited slots 0–3. It now imports the shipped `pineHillsV2QueueSlot`
(the pinned values move because the DESIGN moved — the head-anchor assert
(2.82, 2.30) stays as the unchanged-choreography proof), audits all twelve
full-house indices against every collider rect, and adds a new test pinning the
ruling itself: tail monotone east, spacing 0.60–1.00, line on the face band,
and no queue point other than the head inside the exit lane rect
(0.20–2.60 × 2.20–5.20). `tools/qa/proshop-greybox-acceptance.js` measures
spacing (reports 0.806 now) but pins nothing. `tests/checkout-space.test.js`
is v1-scoped and unchanged.

### 11b. F5 lounge trade — ACCEPTED, no change

**Ruling:** *"The chairs read 71–100% from the door. Below-knee shading from the
putting strip does not hurt the before/after read, and moving the strip trades a
real gameplay surface for a marginal sightline gain."*

The putting strip stays at (1.70, −2.20); the lounge F5 figures stand at
71.4 / 100 / 85.7 / 71.4 with the shading understood as below-knee only. Not to
be revisited in Phase 4 layout passes.

### 11a-addendum — what the first re-pitched day run found (same day)

The 16× day re-run on the re-pitch (`greybox-customer-day-requeue.json`)
confirmed the ruled defect dead — zero queue targets beyond the west aisle
(was: slots through the west wall), neglected blocks 455→231, zero queue
violations, still-inside reduced to the designed no-cashier counter-waiters —
and exposed two follow-on faults, both fixed the same day:

1. **The corridor was never actually sealed.** §7 promises "customers cannot
   enter the corridor", and the §6 drawing runs the x 5.70 partition line into
   the desk — but the build's `PARTITIONS` stops that wall at z 2.00 while the
   desk face starts at z 2.94. Two customers were body-shoved through the
   0.94-yd hole by the full-house crowd and spent game-hours pinned in the
   staff corridor retrying paths through the desk (722 sampled block events in
   the restored leg = those two walkers). Fix: `corridorSeal` — the drawn
   stub, v2-only (grey slab `GREY_CorridorSeal` + builder collider), asserted
   continuous partition-end → desk-face by the layout test.
2. **The overflow pocket pressed the member_station stand band.** The first
   anchor (3.40, 1.25, r ≤ 1.05) reached z 2.30 — into the browse-stand band
   at z ≈ 2.15, feeding the shoves above. Re-anchored (3.15, 0.95, r ≤ 0.85):
   crowd tops out at z 1.80, browse lane z 1.8–2.6 stays clear; every pocket
   point re-verified ≥0.30 from every rect by the same test.

Also: `walk-input-parity`'s v2 stand (0.5, 0.5) predates the resize — the
feature table now sits 0.40 yd north of it, and the probe read a dead W key.
Stand moved to (0.5, 1.7). A stale probe fixture, not an input regression.

**Same-day follow-up (sealed-room re-run):** with the east hole closed, the day
run surfaced the SECOND leak the §6 drawing seals and the build never did — a
Z-shaped sub-capsule channel behind the return (return-south gap z 5.15–5.44,
then the return-to-hutch slot x 1.87–2.40): the greybox note assumed "narrower
than a capsule" meant impassable, and body-separation shoves tunnel exactly
such gaps. Two cabinet-height fillets now close it airtight
(`corridorWestSeal`: GREY_ReturnBackFill 1.00–1.88 × 5.15–5.49,
GREY_HutchGapFill 1.88–2.40 × 4.89–5.49), every seam asserted flush by the
layout test. Standing rule this bought: **a sub-capsule gap is not a wall** —
if the plan draws it sealed, build the seal.
