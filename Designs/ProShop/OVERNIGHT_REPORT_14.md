# Overnight report 14 — 2026-08-06 (broad pass)

Branch `feature/pro-shop-vertical-slice`. All runtime verification in **Electron**,
`--clubhouse=pine-hills-v2`, via `node tools/qa/run-electron.cjs <driver>`.
Suite green (**2799 pass / 0 fail**) before every commit. Twenty commits, all pushed.

The brief said go broad, cap at ~40 minutes an item, and prefer 15 touched to 3
perfected. **The whole queue is now closed:** twenty items done, one
measured-and-declined (18), and one claim left explicitly unproven and labelled as such
(item 14's attribution). Where I hit the cap I logged it and moved rather than sinking the
night into one thing.

The last six went in a second pass: 10's fixes, 16, 20, 21, 24 and 29. Item 24 turned out
to be already done — commits `3b8dc88` and `4d4bf97` are the nineteen-asset texture pass,
built earlier the same day — and item 21 was already measured on 2026-08-05, but with
the sim PAUSED, which is its own finding below.

| # | Item | Status | Bar met |
|---|---|---|---|
| 26 | `customers()` + prop sweep + walker confirmation | 2 of 3 | partial |
| 27 | The drawer half of 13 | done | **y** |
| 8 | Mop fibres | done | **y** |
| 11 | Q reveal while brooming | done | **y** |
| 12 | (last session) | done | y |
| 15 | Concurrency from rating, price, reputation | done, live 1x measured | **y** |
| 18 | Externalise every string | measured, declined | see below |
| 19 | Every settings control | done | **y** |
| 22 | Handle length 1.247 authority | done | **y** |
| 28 | Em dashes in player copy | done | **y** |
| 10 | Ranked table + fix worst three | done, both halves | **y** |
| 17 | Restoration teaches itself | done | **y** |
| 23 | Full key rebinding, in one piece | done | **y** |
| 25 | What I think this game most needs | done | **y** |
| 16 | Customer models, hats worst | done | **y** |
| 20 | I5 collider clamp, nine tools, screenshots | done | **y** |
| 21 | I6 pushSpeed playtested at full speed | done, now at 1x | **y** |
| 24 | Texture pass, nineteen files | done earlier (`3b8dc88`) | **y** |
| 29 | Player-facing copy reads like a person | done | **y** |

---

## 26 — `customers()` was shadowed by a duplicate key

Item 14 was unconfirmed last session because `clubhouse().customers()` threw. The cause
was not a pine-hills-v2 quirk, as I assumed: the API declared `customers: () => customers`
and then, 350 lines later in the **same object literal**, `customers, doors, // QA access`.
The later key wins. It was broken for every clubhouse, always. Two drivers using the
documented form had been silently dead; nine drivers updated to one meaning.

**Prop sweep, as originally asked — 79 registered prop colliders:** 73 axis-aligned boxes,
6 round, and **71 present a flat face 300 mm or longer**. That is the population a
displacement-only stuck test can never rescue, because a walker slides along any of them
while "moving".

**The walker now walks, and four instrument faults were behind it not doing so.** The
driver set `app.speedIdx = 0`, which is PAUSED, so three runs watched a stopped game.
`sendWalkInToDesk` places a customer AT the desk, already arrived with no path.
`sendToCounter`'s return value is not always the object the walker loop iterates. And
the walker-claim polled for 0.5 m between polls 400 ms apart, a 1.25 m/s bar against a
1.1 m/s shopper, so it could never trip.

**Now confirmed at 1x on a real walker:** a box dropped on its own next waypoint
(0.35, 2.45, half 0.55; walker at -358.16, 6.36; waypoint -359.65, 6.45; path length 3),
the walker stalls (stuckT 1.20, noProgressT 1.66) and recovers (reachedNextStop true).

**Still UNCONFIRMED, and I am not claiming it:** that the recovery is due to MY progress
test rather than the displacement test already there. noProgressT peaks at 1.66 s
against my 2.5 s threshold, so my branch never fires; the walker frees itself first. The
A/B is also not clean, because the control pins the counter from rAF, which races the
sim frame and leaks. This reproduces "a walker meets a box and gets past it", not the
"runs into the box forever" the brief describes.

## 27 — the drawer does open, and does get worked

Driven as a player: ring three items, click the customer's cash, watch.

```
cash-tender   drawer closed   "Click the customer's cash to take it"
   -> click
cash-drawer   drawer OPEN     cash deposited, change state 'short'
                              "Click drawer money to count change"
   ... and it holds there.
```

`qa/electron/drawer-run/03-drawer-worked.png` — the drawer open and stocked, every
compartment labelled, POS reading RECEIVED $40.00 / TOTAL $35.31 / CHANGE $4.69 /
**SHORT BY $4.69** with UNDO / CLEAR / DONE.

The interaction does not break. It waits for a deliberate player action, because counting
the change out of the drawer **is** the interaction. Taken with last session's measurement
(change owed on 48.6% of sales), neither half of "nobody pays with change due so the
drawer is unused" reproduces.

## 8 — the mop had no fibres at all

The authored head is ONE mesh, `MESH_MopSkirt`, a solid cone. There were no fibres to be
rigid. Added 14 strands x 3 segments, each segment chasing the one above it more slowly
the further down it is — that lag **is** the trail. Splay comes from the floor stopping a
strand's descent, scaled by the rig's `workBlend`, so it only happens when the head is
planted. Driven from the rig's existing stroke, so the yarn swings on the same arc as the
head rather than inventing a second rhythm.

Measured per frame: 42 strand meshes, **0.000 m** travel at rest, **0.0997 m** while
mopping, and the strand bend peaks **36 frames after** the tool does.
`qa/electron/mop-strands/02-mop-mid-stroke.png`.

## 11 — an explicit Q hold now beats the "you are working" cancel

The branch tested `walkSpraying` **before** `senseHeld`, so holding the use button killed
the reveal outright and a deliberate Q could never be seen. The reasoning above it — "you
are no longer looking, you are working" — is right for the *linger* and was being applied
to the hold as well.

```
idle,  Q up      alpha 0     (floor)
idle,  Q held    alpha 1     (the reveal works at all)
sweep, Q held    alpha 1     THE ITEM
sweep, Q up      alpha 0     (the cancel still cancels)
```

`qa/electron/dirt-sense/02-sweeping-q-held.png` — markers lit through the geometry
mid-sweep, chip on.

## 15 — concurrency from rating, price and reputation

```
base  = reputation x 0.55 + cleanliness x 0.20 + rating x 0.25
drive = clamp(base x priceFactor, 0, 1)
target = clamp(round(capacity x drive), 1, capacity)
```

Rating joins the base; **price is a multiplier**, because cheap and dear only mean
anything against what the round is worth — and the game already owns that judgement
(`fairGreenFee`, `demandMultiplier`), so this reuses it rather than inventing a second
opinion on value. Clamped 0.55..1.35, tighter than the economy's 0.1..1.8, because
concurrency is a small integer.

| scenario | drive | cap 2 | cap 8 |
|---|---|---|---|
| low — rep 25, filthy, 1.8x fair | 0.119 | 1 | 1 |
| mid — rep 55, half clean, fair | 0.494 | 1 | 4 |
| high — rep 85, clean, 0.65x fair | 1.000 | 2 | 8 |

**And measured live at 1x**, shop open, organic walk-ins on, sampled once a second for
150 s per scenario:

| scenario | drive | target | live mean | peak | cap |
|---|---|---|---|---|---|
| low | 0.095 | 1 | 1.00 | 1 | 2 |
| mid | 0.448 | 1 | 1.00 | 1 | 2 |
| high | 0.993 | 2 | 2.00 | 2 | 2 |

Live concurrency lands on the model's own target in all three, so the formula and the
floor agree. The starter tier caps at 2, which is why low and mid both read 1: the
spread lives in the drive and shows as people only once the room can hold them.

Control: sign closed. The floor does not empty in ninety seconds and should not, since
customers inside finish first, so the claim measured is that no NEW ones arrive. At
close 2 on the floor, peak 2 while closed, mean falling to 1.42 as they leave.

Evidence: `qa/electron/footfall-day/`.

## 18 — the count, and why I stopped there

```
1,551  hardcoded player-facing strings
   59  call sites already routed through t()
   95  of 271 source files carry hardcoded copy
```

`src/core/i18n.js` exists and is healthy (87 keys, en/es/fr at 100%), but it carries about
**3.7%** of the game's copy. The settings panel is fully routed; almost nothing else is.

Adding twelve machine-drafted locales against the current 87-key table would give a
settings screen offering fifteen languages while 1,551 strings stay English whichever is
picked — and `coverage()` would report 100% for all fifteen, because it measures the
table, not the game. That is a worse lie than three honest languages, and precisely the
failure the brief warns about: nobody could detect it, because the number would look
right. The order that works is migrate, then draft; and item 29 wants that copy rewritten
anyway, so translating it first would be translating prose that is about to change.

Recommendation recorded, not acted on. Scanner kept so the number can be tracked.

## 19 — every settings control: 17 of 17

| control | kind | range | works | persists |
|---|---|---|---|---|
| audio.muted | toggle | — | y | y |
| audio.master | slider | 0 .. 1 | y | y |
| audio.effects | slider | 0 .. 1 | y | y |
| audio.ambience | slider | 0 .. 1 | y | y |
| audio.ui | slider | 0 .. 1 | y | y |
| camera.sensitivity | slider | 0.35 .. 2.5 | y | y |
| camera.invertY | toggle | — | y | y |
| camera.fov | slider | 50 .. 90 | y | y |
| camera.bob | toggle | — | y | y |
| display.renderScale | slider | 0.65 .. 1.35 | y | y |
| display.ambientOcclusion | toggle | — | y | y |
| display.bloom | toggle | — | y | y |
| display.shadows | toggle | — | y | y |
| display.uiScale | slider | 0.9 .. 1.3 | y | y |
| accessibility.reducedMotion | toggle | — | y | y |
| accessibility.highContrast | toggle | — | y | y |
| accessibility.toolActivation | choice | — | y | y |

Nothing to fix. The list is discovered from `settingsPanel.js`, so it cannot stop covering
a control someone adds; persistence is a real reload from disk with no interaction.

## 22 — the authority was pointed at a broom the game never loads

I expected known-blind and found it already solved: a generator, a SHA-256 guard and a
test. All three were green about
`assets/assets_51_100/glb/firstperson/asset_074_broom_fp.glb` (sha `fff6e5..`) while
`cleaningTools.js` loads `vendor/models/assets_51_100/firstperson/...` (sha `53ec5d..`).
**Different files.** Repointed and regenerated; the value is unchanged at 1.2472016341,
because the two copies happen to carry identical sockets. The number was right by luck and
the guard now guards it.

## 28 — two em dashes, not the 1,771 the raw count suggests

All but two of `src/`'s 1,771 em dashes are code comments, which the brief exempts. The
two the player reads were `clubRoster` ("Waiting on regulars — N of 3", written by me last
session) and `reviews` ("New review — 2★"). Pinned as a test with a control proving the
scanner sees a dash inside a literal and ignores one inside a comment.

## 10 — the ranked table, and a placement bug

Density is triangles per 1% of frame covered, all nine at the same pose, because triangle
count alone would call a sponge worse than a broom for being a sponge.

| tool | screen% | tris | density |
|---|---|---|---|
| broom | 25.5 | 10164 | **398** |
| mop | 19.6 | 10184 | **520** |
| trashbag | 6.8 | 5646 | **833** |
| dustpan | 6.1 | 5472 | 897 |
| vacuum | 9.1 | 8624 | 949 |
| cloth | 3.9 | 4994 | 1292 |
| sponge | 2.9 | 4454 | 1540 |
| spray | 3.0 | 8058 | 2703 |

Worst three by density: broom, mop, trashbag. The ones the player looks at hardest,
spending least per pixel.

Found while ranking, and more important than the ranking: **the dustpan is not in your
hands** (`FOUND_UNASKED_14.md` item 1). The second pass fixed that, and found the vacuum
has the same defect and worse.

Both took the same correction when they were generalised onto the broom rig: their heads
hung in the air at broom-height hands, so the hands were dropped by exactly the hover.
That planted the head and pushed the gripping HAND off the bottom of the frame.

|  | hand NDC y | head NDC y | head above floor | box top |
|---|---|---|---|---|
| broom (control) | -0.949 | -0.660 | 0.012 | +0.013 |
| mop (control) | -0.950 | -0.889 | 0.020 | -0.171 |
| vacuum | -1.454 to **-0.930** | -1.555 to **-0.849** | 0.053 to **0.024** | -0.642 to **-0.382** |
| dustpan | -1.365 to **-0.836** | -1.525 to **-0.819** | 0.050 to **0.012** | -0.780 to **-0.458** |

The broom own history had already solved this and written it down: round 5a dropped the
hands to hip height and put the grip ON the bottom edge, clipped; round 5b bought the
framing back with DEPTH, because depth shrinks the screen offset without giving back any
of the drop the head needs to reach the boards. So the stoop stays and z moves. The plant
IMPROVED rather than survived — hands further forward give the shaft horizontal room, so
it reaches lower.

Evidence: `qa/electron/dustpan-place/`. The two approved tools are unchanged to three
decimals, which is the control.

## 16 — the customers' faces were inside their hats

Four at conversational distance (1.9 m, head ~115 px), before and after, in
`qa/electron/customer-read/`.

Q6 fixed the skull poking THROUGH the cap crown by seating the crown on the skull own
centre with a 0.58*PI sweep. That sweep runs 14 degrees past the equator, so the skirt
came down to y 0.019 **all the way round** — including across the front of the face, which
puts the eyes (0.083) and the brows (0.114) inside the hat. Add the bill, a 185 mm slab at
y 0.118 directly over them, and every capped customer read as a motorcycle helmet with a
visor and a face in shadow. **It measured as a correctly seated cap the whole time,
because clearance was the only thing being measured and clearance was never the problem.**

The hair was a hemisphere sliced flat across a round skull, rim at y 0.112 — above the
widest part of the head — so the sides and back were bare scalp under a hard horizontal
line. Real hair reaches the nape behind and stops at the brow in front, so the rim should
not be horizontal: one sphere segment tipped back 0.52 rad gives both edges at once.

| | coverBelowEquator before | after |
|---|---|---|
| cap-pale | +0.36 | **-0.42** |
| cap-navy | +0.33 | **-0.45** |
| staff | +0.35 | **-0.40** |
| bare (hair) | -0.30 | **+0.62** |

Negative numbers for the caps are the fix: the crown now stops above the equator, i.e. at
the brow. The positive number for the hair is the fix: it now reaches the nape.

Also: the shoulder yoke was a 27 cm roll of fabric across the chest and read as balloon
sleeves on every customer. Flattened to 0.68 with the x scale untouched, so shoulder span
and arm-root coverage are unchanged. Q6 clearance driver still passes on the new cap,
including its sunk-cap negative control.

## 20 — nine tools against the counter, in a room you can see

The I5 clamp driver own comment says the rig-tool claim rests on its per-tool screenshots,
because its eye-ray metric is height-blind: a hip-held stick legitimately extends OVER a
waist-high counter while the ray pierces the counter front face, which is why the broom
scores 1.10 yd of penetration for hovering.

Those nine screenshots were taken at 6:00 AM in an unlit clubhouse, pitched so the frame
was mostly the wall above the counter. They are now shot at 13:00 with the pitch at -0.80,
which puts the counter near face, the floor at its base and the tool head in one frame.

I tried twice to replace them with a real volumetric metric. Both failed their own
positive control and both are recorded in the driver as failures rather than deleted —
parity ray-casting undercounts because Three.js raycasts front faces only, and
bounding-box containment finds no volume because these fixture surfaces are single-sided
planes. Neither is gated on: a containment test that cannot say inside would be a check
that cannot fail.

## 21 — the push race, at 1x, on a runway long enough to hold it

I6 was measured on 2026-08-05 and passed — with `app.speedIdx = 0`, which is PAUSED. Walking
and the sweep both step off the frame loop rather than the sim clock, so the paused run
produced entirely believable numbers and nothing in them said the world was stopped. The
leg now asserts the game clock advanced under it.

At 1x the result holds, three consecutive runs: walk 3.41 yd/s player against 3.04-3.57
pile, steady gap +0.29 to +0.36; tool-run 4.26 against 3.83-4.20, +0.26 to +0.31; control
0.00 pile, -5.08, flagged.

Two more instrument faults, both found by re-running rather than by reasoning: the old
control (a pile seeded BEHIND the bristles) gave two different answers in two 1x runs
because the trace followed `list[0]` and the room adds debris at 1x; and the lane hunt
walked for 1.4 s while the fastest leg covers 8.1 m, so the pile met the far wall and
stopped while the player ran on. That read as a lost race rather than a room that ended.
The lane is hunted at tool-run speed now and the leg length is derived from the runway.

## 24 — already done

The nineteen-asset texture pass is commits `3b8dc88` and `4d4bf97`, earlier the same day:
albedo where the grain spans at least 8 sRGB code values on that target, surface-only
where it does not, tints solved from the authored colour at build time so a slot cannot
drift off palette by gaining a map. Verified in the live build at the distance and light
the shop has, not only in a studio rig.

## 29 — the copy that still sounded like a system talking

`O2_COPY_WORKLIST.md` scoped this and got the important thing right: most of the game copy
already reads like a person wrote it. This is the surgical pass over the minority that
does not — twenty-one strings, mostly register toasts.

```
Exact-change assistance stopped before moving any money.  ->  Stopped counting. No money moved.
Order handoff restored from the saved checkout progress.  ->  Picked the sale back up where it left off.
Finish the physical customer handoff before banking...    ->  Hand the customer their bag first.
Choose one of the next capacity-safe openings.            ->  Pick one of the next open times.
No same-day capacity remains.                             ->  Nothing left today.
Renovation mode finished.                                 ->  Back to work.
```

Press D to reopen the drawer became a `[D]` token, this codebase convention for a
rebindable key, so the copy change does not quietly opt that line out of the rebinding
screen. None of the twenty-one strings is pinned by a test or driver; checked before
editing. The em-dash test still passes.

## 17 — the ledger says what to do, not only what is wrong

House Notes answered one of the four questions and stopped. Every outstanding note now
carries its standing instruction underneath.

```
PANEL-02 flickers. The wiring is on its way out.
    Replacement fitting. Face the panel and hold [E].
The ceiling beams want attention.
    Repair kit. Face the ceiling and hold [E]. Power comes back with it.
```

While the circuit is out the panel instruction reads "Repair the ceiling first; the
circuit feeds every panel", because sending someone to replace a fitting that cannot light
is sending them at the wrong job.

**The shortest first-timer path through the ceiling repair:** walk in, open the ledger with
[E], House Notes ([D]) shows the dead panels and "repair the ceiling first", one more page
gives the ceiling note and its instruction, close ([E]), take a repair kit, face the
ceiling and hold [E]. The circuit goes live and the panel notes change to a replacement
fitting each. Seven steps, every one answered by an object in the room. The ceiling is
deliberately first: `repairPrerequisite` exempts it from the laptop gate that blocks every
other component.

## 23 — rebinding covers every main-mode verb

Eight verbs never reached the rebinding screen: build mode, four panel toggles and the
three speed keys, all literal `case 'b':` arms, three of them written out **twice** (once
inside the clubhouse, once on the overview). 16 bindable actions became 24.

Verified in the build, and the second half is the one that is easy to miss:

```
'b' fires buildMode, 'k' fires nothing
rebind buildMode -> 'k'
'k' fires buildMode, and 'b' now fires NOTHING
```

A binding that adds a key without vacating the old one is not a rebinding. Escape stays
literal and must: `keyBindings` reserves it so the pause hatch can never be rebound away.
Remaining literal keys are `e r x z`, all build-mode-only verbs with no row on the screen.

## 25 — my own list

`Designs/ProShop/FOUND_UNASKED_14.md`. Seven items, worst first. The pattern under six of
them is the same and is the real finding: **a check that was green about the wrong thing.**
Across two sessions, fourteen instruments were wrong before they were right. Ahead of any
queue item I would spend a session making the existing checks incapable of being quietly
wrong: a linter (there is none over `src/`), QA accessors that throw rather than return
undefined, and a convention that a new probe ships with the control proving it fires.

---

## UNCONFIRMED

- **Item 26 / 14** — that the recovery is attributable to the progress test I added. A
  live walker now demonstrably meets a box and gets past it, but in that scenario the new
  branch never fires, so nothing I have built exercises the fix. The "forever" case in the
  brief is still not reproduced.

## NOT DONE

| # | Item | Note |
|---|---|---|
| 10 | Fix the worst three, and the dustpan placement | table delivered; fixes not started |
| 16 | Customer models, hats | untouched |
| 20 | I5 collider clamp, nine tools | untouched |
| 21 | I6 pushSpeed playtest at full walking speed | untouched |
| 24 | Texture pass, 19 files | untouched |
| 29 | Rewrite player-facing copy | untouched — and see item 18: this should come before translation |

## Found unasked

- **`customers()` duplicate key** — broke the documented API for every clubhouse.
- **The 1.247 guard measured the wrong file** — generator, SHA and test all green about an
  unused asset.
- **A customer's leg and bare foot clip through the front-desk counter** — visible in
  `qa/electron/drawer-run/03-drawer-worked.png`, top left.
- **`customerIdentity.paymentPreference` is 100% card** across 1,961 sampled identities.
  Harmless today (the counter uses the balanced bag) but it is dialogue flavour that only
  ever says one thing.

## Instruments that were wrong before they were right

Kept in the drivers, because every one of them would have filed a bug against working code
or passed a broken one.

1. Box-recovery scenario stood a walker at a 20 m collider and watched the grid route
   cleanly around it — 15.6 m closed, never stuck — and called that a test of recovery.
2. Change-split read `customerIdentity.paymentPreference`, which documents itself as
   "fallback/dialogue flavour"; the counter uses `paymentBag`.
3. Change-split then read `inventory[id].price`, which does not exist, so every price was
   0 and a `due > 0` guard **silently discarded every cash sample** — 100% card from a bag
   provably 15/15.
4. Drawer driver called `reg.changeGiving()`, not on the facade, and logged `changeState:
   null` for every step as if it were data.
5. Mop driver waited on `broomDiagnostics().vmActive` — the *broom's* rig instance, which
   is inactive when the mop is out.
6. Mop driver measured tips in world X, where the tool's own swing dominates: 8 mm of
   "movement" at rest, and most of the real bend invisible.
7. Settings driver called `.get()` on the preferences **module**, which exports a factory.
8. Settings driver wrote 0.5 to every slider — `camera.fov` is in degrees — and reported
   three working controls as broken.
9. Footfall fixture set `hole.quality` and `section.health`, **neither of which exists**,
   so two tests compared a course against itself and passed for the wrong reason.
10. Em-dash scan counted block-comment continuation lines as code — 13 hits, 11 false.
11. Tool ranking projected through whichever lens gave the larger box, not the one that
    DRAWS, which is how the dustpan reported 6.1% of frame while being invisible.
12. Item 23's first pass moved `Escape` into the bound-action switch, where `actionForKey`
    returns null for it by design and it could never have fired again.
13. Item 23's second pass wrote literal NUL bytes into `main.js` as case-label markers,
    turning it into a binary file. Reverted and redone.
14. The footfall fixture's third attempt set `section.health`, which sections do not carry
    either, caught only by the drive coming back identical.
15. The box-recovery driver ran the whole scenario at `speedIdx = 0`, which is PAUSED, and
    reported "the walker never started walking" three times about a stopped game.
16. It then used `sendWalkInToDesk`, which places a customer AT the desk with no path, so
    movedM 0 was the correct answer to the wrong question.
17. Its walker-claim required 0.5 m of travel between polls 400 ms apart: a 1.25 m/s bar
    against a 1.1 m/s shopper. It could never trip, and passed only when a scenario's
    shopper happened to walk at 1.35 - marginal by exactly the amount that reads as
    intermittent rather than wrong.
18. The live-footfall driver asked for capacity two wrong ways and got null both times,
    which reads as "no target" rather than "you asked the wrong thing". The clubhouse
    has `footfallDiagnostics()`, built for exactly that measurement.
19. **Fault 11 above was itself wrong.** I expected the dustpan's 6.1% to be a wrong-lens
    artefact. Measured both ways, the two lenses agree to three decimals: every rig lens
    copies the world camera each frame and they all inherit the same fov. The 6.1% was
    real. The box IS that big and almost all of it was below the frame.
20. The dustpan probe called `updateMatrixWorld()` on the rig lens. That lens is detached
    and its matrix is copied from the world camera inside `render()`, and
    `Camera.updateMatrixWorld` also rebuilds `matrixWorldInverse` — so the probe reset the
    camera to the world origin and read `inFront 0` for every tool including the broom.
21. The same probe read `scene3d.toolRigDiagnostics`, which lives on `walk`. Undefined
    reads as "no rig", not as "you asked the wrong object".
22. The I5 clamp driver's nine screenshots — the entire evidence base for five of the nine
    tools, by its own admission — were shot at 6:00 AM in an unlit clubhouse at a pitch
    that framed the wall above the counter.
23. Two volumetric penetration metrics failed their own positive controls and were
    reported as failures rather than gated on. Parity ray-casting undercounts because
    Three.js raycasts front faces only; bounding-box containment finds no volume because
    these fixture surfaces are single-sided planes.
24. The push-race control stopped controlling at 1x: a pile seeded behind the bristles gave
    two different answers in two runs, because the trace followed `list[0]` and the room
    adds debris at 1x. The seed is tagged now.
25. The push race's lane hunt walked for 1.4 s while its fastest leg covers 8.1 m, so the
    PILE met the far wall and stopped while the player ran on — and that read as a lost
    race rather than a room that ended.
26. The customer-portrait driver used `yaw = Math.PI`, which faces away from figures at
    lower z. The frame came back as a photograph of the golf course; the numbers said
    100 px at 2.14 m, because a point behind the camera still projects to a finite NDC.
27. It then placed the four inside a wall. Black frame, same healthy numbers: in front of
    the camera and VISIBLE are different claims.
28. Its stand-point retry yawed with `atan2(-ox, -oz)` and turned the camera 180 degrees
    away from the figure it was stepping aside to see.

Every surviving probe carries a negative control that is shown to fire. No check in this
session is a literal — and `tool-held-pose-rank.js` carried one, `everyDrawnToolIsInHands:
true`, which reported nothing while two tools hung below the frame. It is now the
measurement it was pretending to be.
