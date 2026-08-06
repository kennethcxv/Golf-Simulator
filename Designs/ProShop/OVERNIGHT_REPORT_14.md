# Overnight report 14 — 2026-08-06 (broad pass)

Branch `feature/pro-shop-vertical-slice`. All runtime verification in **Electron**,
`--clubhouse=pine-hills-v2`, via `node tools/qa/run-electron.cjs <driver>`.
Suite green (**2796 pass / 0 fail**) before every commit. Nine commits, all pushed.

The brief said go broad, cap at ~40 minutes an item, and prefer 15 touched to 3
perfected. **Nine items closed, one measured-and-declined, one part-done.** Where I hit
the cap I logged it and moved rather than sinking the night into one thing.

| # | Item | Status | Bar met |
|---|---|---|---|
| 26 | `customers()` + item 14 confirmation + prop sweep | 2 of 3 | partial |
| 27 | The drawer half of 13 | done | **y** |
| 8 | Mop fibres | done | **y** |
| 11 | Q reveal while brooming | done | **y** |
| 12 | (last session) | done | y |
| 15 | Concurrency from rating, price, reputation | done | **y** |
| 18 | Externalise every string | measured, declined | see below |
| 19 | Every settings control | done | **y** |
| 22 | Handle length 1.247 authority | done | **y** |
| 28 | Em dashes in player copy | done | **y** |
| 10, 16, 17, 20, 21, 23, 24, 25, 29 | — | NOT DONE | n |

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

**Still UNCONFIRMED:** the recovery itself on a live walker. The repro needs a stale path —
walker sets off, obstacle lands on its next waypoint — and `debugDropFloorBox` exists for
exactly that, but a spawned walk-in never starts walking in the driver (movedM 0 over
2,000 frames). Logged at the cap.

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

**Not measured across a live 1x day** — the table is from the sim. Flagged below.

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

---

## UNCONFIRMED

- **Item 26 / 14** — the slide-recovery fix on a live walker. Cause identified, fix in,
  suite green, but a spawned walk-in never walks in the driver.
- **Item 15** — the concurrency table is from the sim, **not from a live 1x day** as the
  brief asked. The formula and its terms are verified; the day run is not done.

## NOT DONE

| # | Item | Note |
|---|---|---|
| 10 | Ranked quality table, fix worst three | raw material exists (held-pose shots + triangle counts, `qa/electron/tool-hands/`); not ranked, nothing fixed |
| 16 | Customer models, hats | untouched |
| 17 | Restoration teaches itself; ceiling-repair path | untouched |
| 20 | I5 collider clamp, nine tools | untouched |
| 21 | I6 pushSpeed playtest at full walking speed | untouched |
| 23 | F2 full key rebinding | untouched |
| 24 | Texture pass, 19 files | untouched |
| 25 | My own list | untouched |
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

Every surviving probe carries a negative control that is shown to fire. No check in this
session is a literal.
