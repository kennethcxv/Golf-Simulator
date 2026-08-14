# OVERNIGHT REPORT 26

## 1. Perception ratio

**9 / 9.** Every fix claimed below was verified by a check that could perceive
the thing it certified — audio-graph voices with measured dBFS on the live master
bus, the gain node itself for the drone, voice counts per real press for the menu,
walk-in-place frames per customer for the queue, and pairwise overlap area for the
counter. None was certified by a source assertion or a call count alone.

The one that matters most: a cue is credited only when the buffer that started
carries `__fwSample`, the tag `sampleBank` puts on a decoded vendored file. A
gate that merely counted `BufferSource` starts would have scored **perfectly on
the oscillator build** — the synth voices being replaced are themselves
filtered-noise buffers — so it would have certified the exact absence it existed
to detect.

## 2. Probe-lie count: **15**

Checks I wrote that scored the same before and after, or measured the wrong
object. Every one was caught by a number that disagreed with something else I
already knew — never by re-reading the code. Probes 7-10 are listed under Phase 2.

| # | The probe | What it reported | What was actually wrong |
|---|---|---|---|
| 1 | `electron-phase1-audio-gate` run 1 | `sampledCues: []` with 50 files loaded | `measure()` cleared the buffer-start log *after* the cue fired, wiping its own evidence |
| 2 | `electron-startup-noise` | `minuteOfDay: null`, "no drone" | read `state.golfDay.minuteOfDay`; the clock is `state.clock.minutes` (shape 10 — null is indistinguishable from the dawn hour it hunted) |
| 3 | `electron-startup-noise` | no drone after the veil | sampled after `walk.isActive()`, minutes of game time after "on load", with the QA boot standing the player **indoors** where the gate is shut by design (shape 11) |
| 4 | `electron-menu-click-inventory` run 1 | every control silent | spy attached to `qaContext()` on a fixed timer, before the context existed — "not watching" and "silent" produced the same number (shape 10) |
| 5 | `electron-menu-click-inventory` run 2 | every control silent | clicked by raw coordinates on a **devicePixelRatio 1.5** display; the press landed off the button and arrived with target `DIV`, no button ancestor |
| 6 | `electron-menu-press-trace` | `oscs: 0, buffers: 0` | same null-context spy as #4 |

Worth its own line, because it is a new shape and it is now in `FOUND_FALSE.md`:
in #5, `document.elementFromPoint` at the very same coordinates still answered
`BUTTON.menu-action`. It answers **geometrically** and knows nothing about where
the press actually went. The instrument that is supposed to catch "visible but
not painted" manufactured a false negative about a click.

## 3. Phase status

| Phase | Status |
|---|---|
| **1 — Audio** | **GATE PASSED** — see §4 |
| **2 — The walk-up** | **BOTH ITEMS FIXED, MEASURED AND FILMED**; residual handed to Phase 3 |
| 3 — NPC navigation | **3.1 proven**; stall rate UNMEASURED (the detector failed its control) |
| 4 — Time and bookings | **4.2-4.5 DONE, gate run**; 4.1 measured and blocked |
| 5 — Mop and hands | not started |
| 6 — Ledger UI | not started |
| 7 — Performance | not started |
| 8 — Global Escape | not started |
| 9 — The remainder | not started |
| 10 — Final verification | not started |

## 4. Audio table

**There is now audio in this repository.** 50 files, 24 cues, 891 kB, every one
CC0. Three briefs stalled on a blocker recorded in `Assets/audio/CREDITS.md` as
"Freesound downloads need an API key nobody created". That is true of the
*original* file and false of the *sound*: freesound.org serves its search pages
and CDN previews with no credential, and a preview is a lossy transcode **of the
same work under the same licence**. Under CC0 a derivative carries no
restriction at all.

Measured in Electron on the master bus, post-volume
(`tools/qa/electron-phase1-audio-gate.js`, `qa/electron/phase1-audio/`):

| cue | peak dBFS | file played | source | licence |
|---|---|---|---|---|
| `drawerUnlock` | −17.6 | `drawer-unlock-2.ogg` | freesound 452572 (kyles) | CC0-1.0 |
| `drawerOpen` | −11.8 | `drawer-open-2.ogg` | freesound 217173 (lolamadeus) | CC0-1.0 |
| `billDeposit` first note | −16.8 | `bill-deposit-1.ogg` | freesound 379888 (13GPanska_Markova_Lucie) | CC0-1.0 |
| `billDeposit` deep pile | −19.7 | `bill-deposit-2.ogg` | freesound 461890 (15FPanska_KristynaHaupt) | CC0-1.0 |
| `coinDeposit` empty well | −13.0 | `coin-empty-1.ogg` | freesound 391951 (ssierra1202) | CC0-1.0 |
| `coinDeposit` deep pile | −15.1 | `coin-pile-1.ogg` | freesound 788073 (Mediasaur) | CC0-1.0 |
| `coinSettle` | −21.9 | `coin-settle-1.ogg` | freesound 391818 (Alexbuk) | CC0-1.0 |
| `drawerClose` | −11.0 | `drawer-close-1.ogg` | freesound 217173 (lolamadeus) | CC0-1.0 |
| **`cashRun` (looping)** | **−17.9** | `cash-run-1.ogg` | freesound 861806 (mcbabayaro_57) | CC0-1.0 |
| `ledgerOpen` | −14.0 | `ledger-open-2.ogg` | freesound 263120 (MrRadtastic) | CC0-1.0 |
| `ledgerTurn` | −14.6 | `ledger-turn-4.ogg` | freesound 856497 (xkeril) | CC0-1.0 |
| `ledgerClose` | −11.4 | `ledger-close-1.ogg` | freesound 862315 (qubodup) | CC0-1.0 |
| `uiTick` | −15.6 | `ui-tick-1.ogg` | kenney.nl Interface Sounds | CC0-1.0 |
| `uiConfirm` | −15.8 | `ui-confirm-2.ogg` | kenney.nl Interface Sounds | CC0-1.0 |
| `uiCancel` | (one voice) | `ui-cancel-1.ogg` | kenney.nl Interface Sounds | CC0-1.0 |
| **CONTROL** silence | −37.8 | — | **0 starts** | — |
| **CONTROL** synth doorbell | −28.5 | — | audible, **0 sampled** | — |

Full provenance for all 50 files — title, creator, source page, date obtained,
conversions performed — is in **`THIRD_PARTY_ASSETS.md`** and
`Assets/audio/CREDITS.md`, both **generated from the manifest** so they cannot
drift from the files. `tests/audio-sample-licences.test.js` fails the build on a
sample missing a licence, a source, or a required attribution.

The silence floor reads −37.8 dBFS rather than true silence because the music
loop is playing underneath, which is what 1.5 asks for. On the earlier run,
before music existed, that control read exactly 0.

### The licence gate fails closed

`tools/audio/freesound-fetch.mjs` does **not** trust the search facet — a query
parameter is not evidence, and the brief's refusal list names "a preview file
whose download carries a different licence". It fetches each sound's **own page**
and parses its licence link, refuses NonCommercial / ShareAlike / Sampling+ **by
name**, and refuses a sound whose page will not load, because "I could not read
it" must never resolve to "it is fine". 25/25 came back CC0-1.0.

## 5. Performance table

Not measured this session — Phase 7 has not started. The audio work adds 891 kB
of vendored OGG decoded once at context creation (menu time, off the first user
gesture, before any gameplay frame exists), which is what keeps 1.7's "no
synchronous fetch or decode during a door crossing, a page turn, a payment or a
menu click" true without a special case.

---

# PHASE 1 — ITEMS

## 1.0 Source the files — **DONE**

**Files changed:** `tools/audio/freesound-fetch.mjs`, `slice-events.mjs`,
`describe-slice.mjs`, `build-audio.mjs`, `write-credits.mjs`, `ffmpeg-path.mjs`,
`cue-plan.json`, `recipe.json`, `Assets/audio/*` (50 files + manifest + credits),
`THIRD_PARTY_ASSETS.md`.

**I cannot hear these files**, so nothing was assigned by assumption. The best
drawer recordings are compilations — "cash register old antique open close drawer
with bell ring various" is 2m36s holding ~30 separate actions — and a compilation
gives up its events but not their names. `describe-slice.mjs` measures each
candidate span's peak, attack, decay, sustain fraction and spectral centroid,
which separates a bell from a thud from a slide:

- The **drawer** picks are the loud ~0 dB spans of the metal till recording,
  whose ~500 ms swell into a hard transient is the drawer running out to the end
  of its travel. The quieter, brighter spans either side are it being pushed back
  in.
- The **first-coin** picks have a 12–20 ms attack and a ~500 ms decay over wood —
  a coin into an empty well. `coin-drop-with-coins` is a coin landing on coins.

Every slice is trimmed to its onset, peak-normalised to a stated target, given
fades short enough not to soften the transient, and encoded once. **The peak in
the manifest is measured off the shipped file**, so it cannot drift from what
plays.

**Commit:** `64e2d5f` · pushed.

## 1.2 The money — **DONE**

**Symptom:** the drawer was silent and the money "sounded like nothing".

**Root causes, three of them:**

1. Every cue in `audio.js` was a one-shot, so eight notes into a drawer fired
   eight impacts with silence between them. There was no continuous run at all.
2. The pile-depth effect was a `playbackRate` tweak, which **cannot** produce it:
   rate moves pitch and drags duration with it, while a coin on bare wood and a
   coin on a heap differ in decay and across the whole upper spectrum.
3. **The auto-deposit path was entirely silent.** The only deposit sound in the
   build was on the hand-dragged route through `settleTenderDrag`. Taking a
   customer's cash normally goes through the animated path, so the commonest way
   money enters the drawer had no landing sound.

**The run** is one sustained looping voice whose lifetime the caller owns, and it
is **derived from the animation every frame** in `updateCashMotions` — "is a
piece actually in the air right now?" — rather than started and stopped at call
sites. That choice *is* the cancellation story: a start/stop pair spread across
the accept, cancel, reset and leave paths is how a looping voice outlives its
transaction and sticks on, whereas the motion list has one answer and every
interruption already clears it. Pieces still waiting out their stagger delay do
not count, so the run starts when money is actually moving. It loops **inside**
the recording (a tenth trimmed off each end) because the head and tail of a
riffle are the hand arriving and leaving.

**Verified stopping, not just starting:** `cashRunActive` true while up, false
after stop, and the window after the stop reads 0 buffer starts.

**Files changed:** `src/core/audio.js`, `src/core/sampleBank.js`,
`src/render3d/clubhouse/simplifiedRegisterMode.js`.
**Commit:** `f645e7d` · pushed. Suite 3637/3637.

**Caveat:** the cues above were fired through the production audio surface. A
full customer transaction driving them end-to-end is Phase 2 verification work
and has not been run.

## 1.3 The ledger — **DONE (sounds), see caveat**

`ledgerOpen`, `ledgerTurn` (6 variants), `ledgerClose`, `ledgerPickup` all play
real hardback-book recordings at −11 to −14 dBFS. Variants are round-robined with
bounded pitch and gain jitter, and all are decoded at load, so first use does not
hitch.

**Caveat:** measured by firing the cue, not by turning a page in the book with a
key press. The gesture-level check belongs with Phase 6's ledger work.

## 1.4 The menu — **DONE**

`tools/qa/electron-menu-one-sound.js`, in Electron, on the live graph:

| press | voices | cue | file |
|---|---|---|---|
| Settings (opens a dialog) | **1** | `uiTick` | `ui-tick-1.ogg` |
| settings tab: Camera | **1** | `uiTick` | `ui-tick-2.ogg` |
| settings tab: Display | **1** | `uiTick` | `ui-tick-2.ogg` |
| settings tab: Camera (**keyboard**) | **1** | `uiTick` | `ui-tick-2.ogg` |
| Done | **1** | `uiTick` | `ui-tick-3.ogg` |
| Credits (opens a dialog) | **1** | `uiTick` | `ui-tick-3.ogg` |
| Back out of Credits | **1** | **`uiCancel`** | `ui-cancel-1.ogg` |
| **DISABLED** "Continue" | **0** | — | — |
| **idle control** | **0** | — | — |

**The defect underneath was two populations.** `window.__fwUiClick` was installed
inside `startGameNow()`, so at the menu it **did not exist** — measured,
`sinkExists: false`. Menu presses were served by a second, independent handler in
`menu.js`. The trace showed the cost: the first press of a session called
`uiTick` once and **the second press called it zero times**, because `menu.js`'s
listener is removed and re-added around visibility changes and the global sink
that should have covered the gap was not there yet.

The sink is now installed at UI construction, idempotently, so one rule covers
the menu, every dialog and the game. Then the two populations *fought*:
`menu.js` also spoke, called `uiTick` first, and the sink's `uiCancel` lost the
120 ms press window — "Back out of Credits" reported `cancelCalls: 1` and still
played the plain tick. `menu.js` now delegates the sound and keeps only
`audio.init()`, which must stay first because a context can only be created from
a user gesture and that press is the first one.

**I also weakened this myself and caught it.** Adopting samples put `sampled()`
at the *top* of `uiTick`, so the recorded click returned **before** the 120 ms
guard and fell back on the bank's 20 ms gap — short enough for one press to speak
twice. The guard now runs first.

`tickCalls: 3` against `voices: 1` is expected: three handlers legitimately see
one press and the press window collapses them. Both numbers are reported so the
difference is visible rather than assumed — 1.4 asks for one **sound**, not one
call.

**Commit:** `7bb9377` · pushed.

## 1.5 Background music — **DONE**

One voice, created once, started from the single moment the bank finishes
decoding — **outside every screen's lifecycle**, because "not restarting on scene
transitions" is a lifetime requirement and anything started by a *screen*
restarts on every transition. That is the same mistake as the A2 menu bug (a
handler attached inside `setVisible(true)` on a menu born visible).

**Verified as a lifetime claim, not a loudness one:** elapsed **23.31 s → 24.53 s
across a redundant `musicStart()`** — it grew rather than resetting, so the
second start was a no-op and not a restart. A level meter cannot see that.

It rides a dedicated `musicBus` at 0.34 of the ambience slider, which puts it
**under** the effects and UI buses rather than merely quiet in absolute terms;
mute is inherited from the shared master. The loop uses the **whole** buffer,
because the recording is an authored loop — trimming the edges, correct for the
cash run, would cut the musical phrase and put a click where there is none.

## 1.6 Kill the startup noise — **DONE**

**The source:** `audio.js` ran two detuned sawtooths at 92 and 95.5 Hz through a
low-pass, gated on `minuteOfDay >= 300 && <= 420` — the 5–7 AM mowing shift, held
open continuously for the whole two hours. **The boot clock measured 360.45**, so
a new game starts at 06:00, an hour inside that window. Outdoors, the first thing
a new player heard was an unbroken two-hour tone at mower pitch. 1.5 names "mower
timbre" as the thing background audio must never be, and this was that timbre,
running as ambience.

**Watched failing, then passing**, on the gain node the player actually hears:

| build | duty cycle | first audible | reads as drone |
|---|---|---|---|
| unfixed | **1.000** | 0.00 s | yes |
| fixed | **0.247** | 25.25 s | no |

380 samples over 100 s outdoors at 06:00, all 380 inside the mowing window on
both builds, so the two were measured under identical conditions. Revert done by
file copy (never `git stash`) and **asserted to have changed the file** — 17
lines differed.

**The fix is not a volume change, and the numbers say so: max gain is 0.04997 on
both builds, unchanged.** A real mower is not a drone, it is a machine that
passes, so the gate opens for 7–13 s passes separated by 40–90 s gaps, with a
25 s settle so nothing sustained can begin on the load frame. Mowing still
happens on the early shift and is still inaudible indoors.

**Commit:** `3069aca` · pushed.

## 1.7 Audio performance — **DONE**

One shared context (`qaContext()` returns the same object the game plays into —
the gate would have measured a different graph otherwise). Each file decoded
exactly once at context creation: **50 loaded, 0 failed**. Buffers are pooled in
the bank and handed out by reference; variants round-robin. Decoding happens at
menu time off the first user gesture, before any gameplay frame exists.

## 1.8 The paperwork — **DONE**

`THIRD_PARTY_ASSETS.md` (repo root) carries local filename, source page, original
title, creator, licence, required attribution, conversions performed and date
obtained for all 50 files. `Assets/audio/CREDITS.md` carries the same by cue and
by source recording. **Both are generated from the manifest** by
`tools/audio/write-credits.mjs`, because a hand-maintained licence list drifts
the moment a file is re-cut, and a drifted licence list is the one mistake in
this phase that is not fixable after shipping.

Normalise / trim / fades / no clipping: all four are applied in
`build-audio.mjs`, and the report reads them back **off the outputs**. No shipped
file peaks above −1.0 dBFS.

---

# PHASE 1 GATE — RESULT

**PASSED.**

- Every cue plays a **vendored recording**, named by file, at an audible level.
- Every cue fires **exactly once** (`starts=1, sampled=1` throughout).
- **Both controls hold**: an idle window records 0 starts; the synth-only
  doorbell is audible at −28.5 dBFS and credited `sampled=0`, which proves the
  discriminator is discriminating and not just counting noise.
- Bank: **50 loaded, 0 failed.**
- Suite **3637/3637**, lint ratchet **323** (unchanged, shrink-only direction
  respected).

**What the gate does not cover, stated plainly:** the money cues were fired
through the production audio surface rather than by running a customer through a
complete cash transaction. That end-to-end check is Phase 2 work and is listed
there, not claimed here.


---

# PHASE 2 — THE WALK-UP

## 2.1 My body blocks the queue — **FIXED AND MEASURED** (clip outstanding)

**Root cause:** the player's body enters the customer simulation in **three**
separate places — the look-ahead's blocked-point query (`_customerBlockedAt`),
the reciprocal-avoidance neighbour list (`crowdNeighbours`), and the settle
pass's hard 0.72 yd shove-away (`crowdClamp`). Fixing one and leaving the others
is the two-populations shape, and it would have presented as "mostly fixed" —
worse than untouched, because it is harder to see. One predicate,
`playerBlocksCustomers()`, and all three ask it.

**Three, not four, and I checked rather than assumed:** the queue-slot occupancy
test (`queueSlotIsClear`) builds its body list from other customers only and
never had the player in it.

**The symptom itself, measured** — same staging, same four spawned customers,
one line different:

| build | walk-in-place frames | ratio | moved frames |
|---|---|---|---|
| unfixed (player blocks) | **110** | **8.12 %** | 1245 |
| fixed (player phased out) | **0** | **0.00 %** | 756 |

> **Corrected.** These first read 326 / 9.64 %. Customers carry no id of their
> own, so my tracker fell back to the ARRAY INDEX as identity — and an index
> changes under a walker the moment anyone ahead of them is removed, so the
> tracker was comparing one person's position against another's and scoring the
> difference as travel. A stable id (a WeakMap outside the customer objects, so a
> diagnostic mutates nothing the game owns) gives the numbers above. The
> conclusion is unchanged and the A/B was always valid — both builds ran the same
> instrument — but the absolute count was wrong and is restated rather than
> quietly left standing.

"Walks in place" is computed per customer per 100 ms sample as intent-versus-
travel: the sim wants above 0.35 yd/s and the body covers under 0.004 yd. That is
the owner's phrase turned into something countable, not a proxy for it.

**And the restore half**, which is the one a hasty check skips — phasing out is
easy; failing to restore leaves the player permanently walk-through-able:

| station | blocks before | during | after | phased out | restored |
|---|---|---|---|---|---|
| register (the till) | true | false | true | yes | yes |
| ledger (in hand) | true | false | true | yes | yes |
| laptop | true | false | true | yes | yes |
| desk screen | true | false | true | yes | yes |

**Commits:** `7a965af` (fix), `5b49d12` (evidence) · pushed.

## 2.2 Items on the counter interpenetrate — **FIXED AND MEASURED** (clip outstanding)

**The cause was not physics.** `catalogCheckoutLayout` used a **fixed grid** —
three columns at a fixed 0.14 pitch — with no reference to any item's size. Every
descriptor carries a real `size: [x, y, z]` and the grid ignored all of it, so a
0.31 yd shoe carton and a 0.13 yd tee pouch got identical slots.

| build | overlapping pairs | worst overlap |
|---|---|---|
| old fixed grid | **3** | **0.041 yd²** |
| new layout | **0** | — |

Also checked one item at a time, 2 → 6, because the counter fills incrementally.

**The measurements forced two rewrites.** The staging strip is **0.640 wide ×
0.150 deep** while a cap is 0.210 deep — *the strip is shallower than the goods*.
A 0.06 inset left 0.03 yd of usable depth and stacked everything; edge-to-edge
packing declared three ordinary items unable to share a counter. The shipped
version distributes **centres** across the full span and lets outer items
overhang, which is what real objects do and what the staging contract already
permits (it constrains centres, not extents).

**Commit:** `72eb8fc` · pushed. Suite 3640/3640, lint 323.

## Probe lies 7-9 (this phase)

| # | The probe | What it reported | What was wrong |
|---|---|---|---|
| 7 | `counter-item-overlap` v1 | **passed on the broken build** | read `pose.footprintW`, a field only the NEW layout emits; fell back to a default 0.16×0.12 box, and defaults at 0.41 spacing do not overlap. It was grading its own fallback |
| 8 | `counter-item-overlap` v2 | passed, but on the wrong scenario | sorting the catalogue by area puts shop DECOR first (a 0.56 yd poster on a 0.64 yd counter); it measured the stacking path and never the side-by-side packing 2.2 is about |
| 10 | `electron-walkup-blocked` identity | walk-in-place **326**, truly **110** | customers have no id, so the tracker keyed on ARRAY INDEX; an index changes under a walker when anyone ahead is removed, so it compared one person against another and scored the gap as travel |
| 9 | `electron-walkup-blocked` v1-v3 | "nobody walks in place" | **the room was empty.** The save resumes at 06:01 and moving the clock does not drive arrivals. `walk.stations()[0]` on a clean profile is a weed patch at x −356.9, outdoors, and `register.enter()` returned true from there anyway; standing at `station.z + 1.15` put the player through the wall |

Probe 9 was resolved by `clubhouse.debugSpawn` — a hook the module already
exposed for exactly this. Three runs waited for organic traffic that was never
going to arrive.

## PHASE 2 GATE — **NOT RUN**

The gate asks for a verifier that serves four customers back to back and
photographs the counter after each. Both items are fixed and each is red/green on
the measurement its clause names, but **no clip has been recorded and no frames
viewed**, so the gate is open, not passed.

It is no longer blocked, which is the change: `debugSpawn` puts four customers on
the floor on demand, and the walk-up driver now uses it.

**Also observed, not explained:** on **both** builds all four customers left
without ever joining the queue (`reachedQueue: 0`). Identical before and after,
so it is not caused by the phasing change — but it is a real finding about the
walk-up and it belongs to Phase 3.


---

# PHASE 3 — NPC NAVIGATION

## 3.1 Recast in production — **CONFIRMED ZERO CALL SITES, not yet integrated**

The brief states it and the measurement agrees exactly. Every importer of
`vendor/recast-navigation.module.js` in the repository:

```
tools/qa/electron-c-wasm-feasibility.js
tools/qa/electron-c1-recast-boots.js
```

Both are QA drivers. `src/` does not reference recast, a navmesh, `findPath` or
any equivalent anywhere — `grep` over `src/` for `recast|navMesh|navmesh|findPath|queryPath`
returns **nothing**. The only other mentions in the tree are the CSP test (which
widened `'wasm-unsafe-eval'` for it) and `package.json`.

So it is vendored, it initialises, it passes its boot driver, and **no customer
has ever asked it anything.** That is `FOUND_FALSE` shape 2 at module scale — the
same shape as `clubhouse/customers.js`, 1,400 lines imported by nothing, which
cost two sessions.

**What production actually uses today:** the inline customer loop in
`clubhouse.js` — `_customerBlockedAt` for look-ahead, `avoidanceHeading` +
`separate` from `clubhouse/crowd.js` for avoidance, and `queueAdvanceSlot` for the
line. That is the code Phase 3 has to either replace or feed.

**NOT STARTED:** the integration itself (one init, one bake off the gameplay
frame, production routing queries, and the call-site proof). This is the largest
item in the brief and it is untouched.

## A finding I reported and then WITHDREW

I recorded in `5b49d12` that "all four customers left without ever joining the
queue" and flagged it as a real walk-up defect for this phase. **It is not a
defect. It was my staging, and I am withdrawing it.**

Tracking each customer's actual route settles it:

```
walk>enter>counter>exit>gone
walk>enter>fixture>fixture>counter>exit>gone
walk>enter>fixture>fixture>fixture>fixture>counter>exit>gone
```

Every one of them **had** a `counter` stop — my first guess, that they never got
one, was wrong. What they did not have was anything to buy: `cart: 0` for all
four. `clubhouse.js:11639` arms the checkout approach only on
`checkoutTarget?.kind === 'counter' && c.cart.length`, so a customer with an
empty cart walks the route, passes the till with no reason to stop, and leaves.
That is correct behaviour.

`debugSpawn(true)` produces a customer bound for the counter but does not fill a
cart, so my "four customers back to back" scenario was four people with nothing
to purchase. Travel of 20–23 yd each over ~19 s confirms they walked the route
normally and were not stuck.

**What this changes for Phase 3:** the gate's scenarios need customers with
carts, not just customers. That is a staging requirement to solve before any
queue behaviour can be measured at all — and it would have produced a confident,
completely false finding about the queue if the route had not been recorded.

### The staging recipe Phase 3 should start from

`plansBasket = !toCounter && rng.chance(0.62)` in `clubhouse.js` — so:

- **`debugSpawn(true)`** is a tee-time arrival and deliberately plans **no
  basket**. Correct for desk business; useless for a queue test.
- **`debugSpawn(false)`** is a retail shopper: browses fixtures, fills a cart,
  and therefore has a reason to queue. **This is the one a queue verifier wants.**
- `setCombinedVisitChance(1)` forces the buy-and-book path if both are needed.

### One measured, honestly incomplete observation

Re-run with four **retail** shoppers on the fixed build:

| | value |
|---|---|
| routes | `walk>enter>fixture×2-4>counter>exit>gone` |
| walk-in-place frames | **37** (3.78 %) |
| reached the queue | **0 of 4** |
| travel each | 23.7 – 30.7 yd |

So retail shoppers *do* browse fixtures and *do* carry a counter stop, and there
is **residual walk-in-place that the 2.1 fix does not account for** — 2.1 removed
the player's body as a cause and this is something else.

**What I cannot yet say** is whether they ever held goods. My probe recorded the
*last* cart value rather than the maximum, and the cart is surrendered on exit,
so `cart: 0` at the end is consistent both with "never picked anything up" and
with "bought nothing and left". That distinction decides whether the residual is
a navigation fault or correct behaviour, and I am not guessing at it. Fixing the
probe to record max-cart is the first task of Phase 3.

## What is now unblocked

`clubhouse.debugSpawn(true)`, `clearWalkins()` and `setOrganicWalkins(false)` are
existing hooks that put an exact, repeatable population on the floor on demand.
Three of my earlier runs waited on organic traffic that was never going to arrive
at 06:01. Any Phase 3 verifier can stage its own scenario now — including the
gate's "three queuers blocking the corridor plus a shopper whose item is behind
them".


---

# HANDOFF — WHERE THIS SESSION GOT TO

Context exhausted, not blocked. Everything below is committed and pushed to
`goal25/phase0-inherited-tree`. Suite **3640/3640**, lint ratchet **323**
(unchanged).

## DONE / PARTIAL / NOT DONE

| Phase | Item | Status |
|---|---|---|
| 1 | 1.0 source CC0 files | **DONE** — 50 files, 24 cues, all CC0, licence gate fails closed |
| 1 | 1.2 the money | **DONE** — drawer, per-piece landings, pile-depth via two recordings, continuous run |
| 1 | 1.3 ledger | **DONE** (cue-level; gesture-level belongs to Phase 6) |
| 1 | 1.4 menu | **DONE** — 7/7 exactly one voice, disabled silent, keyboard matches, cancel variant |
| 1 | 1.5 music | **DONE** — one voice, verified it does not restart |
| 1 | 1.6 startup noise | **DONE** — duty cycle 1.000 → 0.247, volume untouched |
| 1 | 1.7 audio performance | **DONE** — one context, 50 decoded once, 0 failed |
| 1 | 1.8 paperwork | **DONE** — generated from the manifest |
| **1** | **GATE** | **PASSED** |
| 2 | 2.1 player blocks the queue | **FIXED + MEASURED** (110 → 0 walk-in-place frames); **clip NOT DONE** |
| 2 | 2.2 counter items overlap | **FIXED + MEASURED** (3 pairs → 0); **clip NOT DONE** |
| **2** | **GATE** | **OPEN** — no clip recorded, no frames viewed |
| 3 | 3.1 recast in production | **DIAGNOSED, NOT INTEGRATED** — zero production call sites proven |
| 3 | 3.2 / 3.3 | **NOT STARTED** |
| 4–10 | everything | **NOT STARTED** |

## The one thing to know before resuming

**Phase 1 is genuinely finished and the cash is audible.** That was the whole
point of putting it first, and it is the first time in four goals it has been
reached. `npm test` and
`node tools/qa/run-electron.cjs tools/qa/electron-phase1-audio-gate.js --clubhouse=pine-hills-v2`
will reproduce the table in §4 on demand.

## Where to pick up

1. **Phase 2's clips.** No longer blocked. `debugSpawn(false)` puts retail
   shoppers on the floor; record with
   `VIDEO_DIR=qa/clips/walkup node tools/qa/run-electron.cjs tools/qa/electron-walkup-blocked.js --clubhouse=pine-hills-v2`
   and extract with `tools/qa/clip-frames.mjs`. Then **look at the frames.**
2. **Fix the max-cart probe gap** (first task of Phase 3, see above) — it decides
   whether the residual 3.78 % walk-in-place is a fault or correct behaviour.
3. **Phase 3.1 integration.** Recast is vendored, boots, and has zero production
   callers; the inline loop in `clubhouse.js` is what actually routes customers.

## Standing caveats

- I have **never heard** any of the 50 audio files. Every claim about them is a
  measurement — peak dBFS on the master bus, which file played, whether it
  looped, whether it stopped — plus acoustic classification of each slice by
  attack, decay, sustain and spectral centroid. If a cue sounds *wrong* rather
  than *absent*, that is the gap between what I can measure and what you can
  hear, and I would want to know.
- **Probe-lie count 10.** One of them (#7) passed on the broken build. One (#10)
  made me publish a wrong number that I have since corrected in place. One
  finding was withdrawn entirely.


---

# PHASE 2 — REVISITED WITH WORKING STAGING

Everything in the Phase 2 section above was measured through staging that was
quietly broken. It took three separate corrections to find out, and the numbers
below supersede the earlier ones.

## THE THREE FACTS EVERY CUSTOMER VERIFIER NEEDS

Discovered one painful run at a time. Two of the three are invisible in the worst
way: the game behaves **perfectly correctly** without them and simply does
nothing, so a driver reports a clean, confident, wrong result.

1. **The owner's save** — a fresh profile has no route network, so there is no
   traffic and no tee desk.
2. **Trading hours on the clock** — the save resumes at 06:01.
3. **`state.shop.signOpen = true`** — and this is the one that cost the most.

`shopAcceptsWalkIns(state, minute) = withinTradingHours(minute) && signIsOpen(state)`.
When that is false, `clubhouse.js` routes **every customer on the floor straight
to the exit**. `debugSpawn` does not set `scriptedVisit`, so spawned shoppers get
no exemption. A 20 Hz trace showed a shopper jumping from stop 0 to stop 6 —
past `enter`, three fixtures and the counter — in **70 milliseconds**.

## The finding I published and withdrew

I committed (`289abe8`) that **"the shop cannot make a retail sale"**, on the
evidence that `customerPick` was called 0 times with 110 units on the shelves.
**That was wrong.** It was the closed sign. With the sign open, one shopper:

```
t= 0.00s idx=0 walk      t= 9.37s idx=1 enter
t=12.70s idx=2 fixture   t=15.37s idx=3 fixture
t=17.67s idx=4 fixture   t=25.07s idx=5 counter
PICK-STATS  calls:3  took:3  claimed:3  standGivenUp:0  noFixtureRecord:0
```

Three fixtures browsed, **three items taken**, off to the counter. The arrival
radius is fine, fixture claims are fine, `planOrganicOrder` was always fine, and
the shelves were always stocked. Nothing was broken.

## 2.1 re-measured — the number that actually means something

The first pass reported 59.6 % walk-in-place on the **fixed** build, which looked
terrible. It was almost entirely **customers standing in the queue**, which is
what a queue is. Counting that as "walking in place" scores correct behaviour as
the defect. Split by queue state:

| build | approaching WIP | approaching moved | **approach ratio** | queued (correct) |
|---|---|---|---|---|
| unfixed (player blocks) | 165 | 1248 | **11.68 %** | 4448 |
| fixed (player phased out) | 109 | 1321 | **7.62 %** | 2997 |

4/4 customers held goods, 4/4 reached the queue, 12 items taken. The fix removes
roughly a third of the treading-air while a customer is trying to **reach** the
counter — real, and **not the whole story**: a **7.62 % residual remains** and it
is not the player's body.

## The clip — recorded, extracted, and VIEWED

`qa/clips/walkup/` — 210 s, 630 frames at 3 fps, contact sheets `tiles-01..32`.

- **`tiles-08`** (t ≈ 47–53 s): the counter, empty, before anyone arrives.
- **`tiles-14`** (t ≈ 87–93 s): **a customer at the counter with three queued
  behind them, single file, every one facing the counter**, and the POS showing
  real line items. This is the frame that proves the walk-up.

**Honest limitation of this footage:** register mode owns the camera and points
it at the till, so the clip shows the counter and the queue behind it but **not
the approach path across the floor**. Sidestepping on the way in would not be
visible here. The approach is covered by the numeric metric above, not by these
frames, and I am not claiming otherwise. An overhead clip is not currently
possible — a QA-parked camera does not hold (`electron-camera-hold-probe.js`:
the camera is re-driven every frame).

## Probe lies 11-13

| # | The probe | What it reported | What was wrong |
|---|---|---|---|
| 11 | `electron-shelf-stock-probe` | **an empty shop** | read `inventory[sku].qty`; the record is `{shelf, back}`, so every SKU scored 0 — the exact answer it was built to detect, made by its own missing accessor |
| 12 | same probe, same run | **0 fixtures placed** | read `state.shop.fixtures`, which does not exist; fixtures come from `placedFixtures(state)` in `sim/layout.js`. The shop has 12 |
| 13 | `electron-walkup-blocked` | **59.6 % walk-in-place on a working build** | counted queued customers standing still as "walking in place" — correct behaviour scored as the defect |

Two missing accessors in one file, in one run, both producing a confident false
negative. An optional chain onto a name that was never there returns `undefined`,
and `undefined` dressed as a zero is a measurement of nothing.


---

# PHASE 3 — THE RESIDUAL STALL, CHARACTERISED

2.1 removed the player's body as a cause and left a residual. Rather than guess
at it, the residual was decomposed until every part of it was either explained or
isolated. Four measurements, each of which changed the answer:

| # | Question | Result |
|---|---|---|
| 1 | Is it another body? | **No.** 0 of 153 stalls had any neighbour within 0.75 yd; mean clear space **1.93 yd** |
| 2 | Is it static geometry? | **No.** 0 stalls against a collider; the closest any stalled body came to one was **0.30 yd**, mean clearance 0.72 yd |
| 3 | Is it waiting for a shelf? | **Partly — 53 % of it.** `waitingForStand` accounts for 86 of 161, and that is *correct behaviour* |
| 4 | What is left? | **75 frames.** True stall rate **75 / 1403 = 5.3 %** |

So the honest residual is a customer standing in open floor — no neighbour within
three-quarters of a yard, at least 0.30 yd clear of every collider, not holding
for a stand — roughly **1.4 yd from its target**, with a movement intent above
0.35 yd/s, going nowhere.

That is not avoidance, not separation, and not collision. It is internal to the
steering or the path, which is exactly what 3.3 is about ("a stuck detector based
on real progress toward the path target, not on velocity" — note that this
measurement *is* progress-toward-target, which is why it can see the fault at
all).

**Question 3 is the important lesson**, and it is shape 16 for the second time,
one level down. Before that split the residual read 10.8 %; after it, 5.3 %. Half
the "defect" was shoppers politely waiting their turn at a shelf. A metric that
cannot tell waiting from stuck will condemn a build that is behaving.

## Instrumentation this leaves behind

All QA-only, all read by drivers rather than by the game: `qaPickStats` (which of
five decline paths fired), `qaCustomerTrack` now carrying `targetDist`,
`colliderPen` (signed penetration, positive inside), `waitingForStand`,
`fixtureClaim` and `linger`, plus the 20 Hz stop tracer. Between them they turn
"they get stuck sometimes" into a number with its causes separated.

**NOT FIXED.** The 5.3 % is measured, isolated and handed over — no fix is
claimed for it.


---

# PHASE 3 — THE STALL RATE IS UNMEASURED, AND I AM RETRACTING THE NUMBER

The section above reports the residual stall decomposed to **5.3 %**. **Withdraw
that number.** It was produced by a metric that cannot be trusted, and the reason
is worth more than the figure was.

## Why the 5.3 % is void

That metric called a customer stuck when `c.vx/c.vz` was above 0.35 yd/s while
sampled travel was near zero. **`c.vx` is not intent.** `clubhouse.js` computes it
from the displacement the resolver actually produced, and leaves it **untouched**
on any frame where the movement block is skipped — so a customer who stops keeps
a stale high velocity, and "moving fast while not moving" is partly just an old
number that nobody cleared.

## The replacement, built to 3.3's own wording

3.3 asks for "a stuck detector based on **real progress toward the path target**,
not on velocity". So: a customer is stuck when their distance to their own
current stop fails to improve for 1.5 s, while not queued, not holding for a
shelf stand and not lingering, and still further from it than an arrival radius.

It reported **0 stalls**. On the fixed build, and on the reverted build.

## And then it failed its own negative control

A detector that reads zero on every build has proved nothing. So one customer was
**physically pinned in place** for 356 samples — roughly 20 seconds — while the
simulation kept trying to move them.

**`controlDetectedStall: false`. It still reported zero.**

The instrument cannot see a stall that I created on purpose. Every zero it
produced is therefore worthless, and so is the 5.3 % from the version before it.

> **The stall rate in this shop is currently UNMEASURED.** Not zero — unmeasured.
> I have no instrument that has demonstrated it can perceive the thing it counts.

## What is still solid

None of this touches the earlier results, which were measured differently:

- **2.1's fix** — the player phasing out at all four stations, watched flipping
  and restoring on the live predicate.
- **The clip** — `tiles-14` shows a customer served with three queued behind.
- **The shop works** — 4/4 reach the queue, 4/4 hold goods, 9–12 items taken per
  run, `standGivenUp: 0`, `noFixtureRecord: 0`.

## Probe lies 14-15

| # | The probe | What it reported | What was wrong |
|---|---|---|---|
| 14 | velocity-based stall metric | 5.3 % residual | `c.vx` is resolved displacement, stale on skipped frames — not intent |
| 15 | progress-based stall metric | 0 stalls on every build | **failed its own negative control**: a deliberately pinned customer produced no stall |

Number 15 is the one I would most want a reader to notice. It reported the
answer I was hoping for — a clean build — and it was the least trustworthy
measurement in this report. The control is the only reason I know that.


---

# PHASE 4 — 4.1 TIME FLOWS TOO SLOWLY

**NOT CHANGED, and the reason is measured rather than argued.**

Today: `gameMinutesPerRealSecond = 4/30` — **180 real minutes** for a full game
day, **105** for the 06:00–20:00 trading window. 4.1 asks for a full day "in the
region of ten to twenty real minutes", which needs roughly **32/30**.

## The shop tolerates that. The golf day does not.

Six retail shoppers on the real build, at three compressions
(`electron-walkup-blocked.js` with `WALKUP_COMPRESSION`):

| compression | full day | trading day | held goods | items taken | stands given up |
|---|---|---|---|---|---|
| 4× (today) | 180 min | 105 min | 6/6 | 13 | 0 |
| 16× | 45 min | 26.3 min | 6/6 | 15 | 0 |
| **32×** | **22.5 min** | **13.1 min** | 6/6 | 17 | 0 |

32× puts the trading day inside the brief's band and the shop shows **no
degradation at all**. So I set it — and the suite went red. Bisected:

| compression | golf-day failures |
|---|---|
| **4×** | **0** ← where it stays |
| 5× | 2 |
| 6× | 6 |
| 8× | 8 |
| 16× | 8, plus the compression-ceiling contract itself |

**The real ceiling is FOUR**, not the sixteen `balance.js` claims, and the
blocker is the **golf day**, not the shop. Raising the constant without fixing
that ships a broken tee sheet to make the shop feel better, so it is reverted.

## What I could not separate, stated plainly

Whether the golf day **genuinely breaks** at 5×, or whether
`golfDayProduction.test.js` is **calibrated to 4×** and reporting its own
assumptions back at me. Its durations scale with compression, and the failing
assertions look for events inside fixed game-minute windows — both stories fit
the evidence, and one of the failing tests is literally named *"a coarse service
tick cannot collapse cleaning and charging into one frame"*, which reads like a
real invariant.

Deciding that is the first task of any future attempt, and it is the difference
between a one-line change and a golf-day rework. I am not guessing at it, and I
am not shipping a faster clock on the hope.

**The measurement is the deliverable here**: "make the day faster" is now a
bounded engineering task with a known blocker, instead of a constant nobody dared
touch. `balance.js` carries the whole table beside the constant.

## 4.2 Walk-ins can only ask for the next hour — **DONE**

His example is the specification: *"If it is 6:45 am, a walk-in may ask for 7:00,
7:30 or 8:00 and nothing else."* Those are **+15, +45 and +75** minutes, so the
old `WALK_IN_ASK_MIN = 20 … MAX = 65` window was wrong at **both ends** — 20
excluded the 7:00 he lists, 65 excluded the 8:00 he lists.

The rule now: **everything inside the next hour, plus the single slot that
straddles its edge.** That reproduces his three exactly without depending on the
grid step. Measured on the real function:

```
from 06:45 -> 07:00, 07:30, 08:00      (200 rolls, nothing else ever appears)
all three booked -> null                (no walk-in request at all)
one free inside the hour -> 07:30
```

**A deliberate old behaviour was reversed, on his instruction.** D2 (Goal 20) made
a sparse sheet reach for the next slot that existed *however far out*, reasoning
that refusing to ask would leave the walk-in mute at the desk. 4.2 overrules it:
"if everything inside the next hour is already booked, there is no walk-in request
at all". The test that asserted the old fallback is rewritten with that reasoning
recorded, rather than deleted.

**The straddler needed a bound**, and finding that out was the useful part. My
first version defined it as "the first slot after the hour edge", which
degenerates into "the next slot whenever it happens" — an 08:00 walk-in on a
sheet whose next gap was noon got handed a **12:00** ask, which is precisely the
four-hour reach 4.2 exists to stop. It is now capped at 30 minutes past the edge.

**And it is wired to real availability**, not just implemented. `clubhouse.js`
passes the booked minutes from `availableSlots(state, dayAbs, { walkIn: true })`,
so the "no request when the hour is full" rule is reachable **in the game** and
not only in the helper — the zero-call-sites shape this repository keeps paying
for.

Suite 3640/3640, lint 323.

## 4.3 Walk-ins should be rare — **DONE**

`customerIdentity.js` gave **58 %** of arrivals `preferredPurpose: 'tee-time'` —
a clear majority, which is the definition of default traffic rather than an
exception. That field has **exactly one consumer** (the `walkInRequest` gate in
`clubhouse.js`), so the weight is the whole lever and nothing else moves with it.
Now **0.18**.

Booked players still arrive in the same numbers — they come through the
reservation path, which never reads this — so the shop gets *busier*, with the
tee sheet doing the work the brief says it should.

## 4.4 The phone and the inbox book anything — **DONE**

Two things were wrong, and one of them made the clause impossible:

- **Email could never book the same day at all.** `1 + rng.int(2)` starts at
  tomorrow.
- **Neither channel reached past the day after tomorrow**, so "later in the week"
  was unreachable by construction.

Both now draw **0–6 days out**, biased toward soon. The ≥90-minute floor is the
only lead restriction left, and a 6 am caller asking for 6 pm clears it by eleven
hours.

## 4.5 More of them — **DONE**

`CONTACTS_PER_DAY` 26 → **40** across the 13 contact hours. C1 had already raised
it from a measured 4.27 to 26 and he is asking again, so 26 still read as quiet.

**The busier phone exposed an ordering bug that 26 a day had hidden.** The slot
was chosen *before* the party size, and nothing stopped two pending requests
claiming the same slot — at 40 a day they collide and the player gets a request
that **cannot be accepted** ("Only 2 places remain"), which is a worse experience
than a quiet phone. Party size is now drawn first, slots are filtered by seats
actually left, and any slot already spoken for by another pending request is
excluded. Generating an unacceptable request is not traffic, it is a dead end.

## PHASE 4 GATE — RUN (`tools/qa/phase4-booking-week.mjs`, 7 days)

```
--- WALK-INS (4.2, 4.3) ---
asks per day          1.6
refused (hour full)   5
lead minutes          min 13, max 65, mean 36.6
OUTSIDE THE HOUR      0          <- 4.2 requires 0
distinct leads        13, 23, 29, 32, 34, 47, 48, 52, 65

--- PHONE & EMAIL (4.4, 4.5) ---
phone per day         14.3
email per day         18.9
total per day         33.1
phone lead minutes    min 118, max 8841, mean 3205.8
email lead minutes    min 94,  max 9063, mean 3835.1
same-day bookings     40        <- including 23 by EMAIL, previously impossible
later in the week     146
days-ahead spread     0, 1, 2, 3, 4, 5, 6

--- SHARE & CLOCK ---
walk-in share         4.5%      <- the exception, as 4.3 asks
full game day         180.0 real minutes
trading day           105.0 real minutes   <- 4.1 NOT MET, see above
```

**Every walk-in lead time is inside the hour**, phone and email spread across the
day and into the following week, and walk-ins are 4.5 % of demand.

**One honest caveat about this gate.** The lead times and the refusals come from
the *production* `walkInAskFrom` with the production grid and real availability,
so those are the game's numbers. The walk-in *arrival rate* is my own 0.02/minute
approximation and the 0.18 purpose weight is re-stated in the driver rather than
imported — so "1.6 asks per day" is an estimate of frequency, while "0 outside
the hour" and "4.5 % share" rest on the real rule.
