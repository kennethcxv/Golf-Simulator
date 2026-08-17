# THE DOOR AND THE TAB — owner-play repro, attribution, and why the census lied by omission (2026-08-16)

## What reproduces: ALL OF IT, without even needing your save

Booted your way (no pins, no teleports for the deed itself, real held-W
walking, real E, real Tab, customers live, 6:00 AM dawn — the Day-1 default),
recorded on video with a rAF gap log, a longtask observer, and
renderer.info + program-key snapshots bracketing each gesture. Two runs.

| moment | your report | run 2 | run 3 |
|---|---|---|---|
| walking toward the front door | — | **10.1 s** freeze | **16.4 s** freeze |
| the door / approach | ~10 s | 6.3 + 3.6 + 2.9 s | 2.4 + 1.4 s |
| Tab (overview) | ~10 s | **9.2 s** | **9.0 s** |
| Tab back | — | **11.4 s** | **12.0 s** |

Longtasks name every one of them `self`: the main thread blocked, not the
GPU idling. Evidence: `qa/ownerplay/repro-result.json`, `qa/ownerplay2/`
(video, 39 frame sheets — the overview sits frozen across whole sheets).

## The attribution, with the numbers

Across every freeze, geometry and texture counts moved by exactly ZERO.
Programs moved every time:

- **The front door: +5 programs**, all `physical`, every one differing from
  its nearest settled twin at ONE packed key field — index 48, value 2→1.
  That is the register-till's exact first-press axis from Goal 29, now
  measured at the front door too. Whatever state field 48 encodes (it
  matches the PCFSoft→PCF value range but is deliberately not named by
  index — the 46-fold rule), it separates EVERY warm from real play.
- **Tab: +10 programs** — nine `physical` differing at index 36, value 4→1
  (the overview camera's state axis), plus one `basic` two packed bits up.
- **Why ten seconds and not 1.5:** each arrival lands inside a draw as a
  driver-side program build, and on this machine tonight those builds run
  SECONDS each (the same intermittent stall the load instrument watches
  strike compile-hidden / the spin / the register warm — one 16.4 s single
  gap here). The old 1,490 ms measurement was one arrival in a healthier
  window. Same mechanism, different weather: arrivals × stall-seconds.

## Why the instrument disagreed with you — three named reasons

1. **It plays a state you never play.** Clock pinned to 14:00, sim speed 0.
   Your game runs at 6:00 AM dawn with the sim live. The warms and the
   census compiled and measured the pinned state's programs; play asks for
   the dawn/live variants — the field-48 2→1 family — which existed nowhere
   until your first step made them, ten seconds at a time.
2. **The list is hand-written and the door was never on it.** Fifteen rows
   (Tab, ledger, book, front desk, till, pause, nine tool-equips, editor).
   The game's playable surface is hundreds of verb×state combinations:
   every door across five systems (including no-key proximity swings), the
   wall map's OWN step-back overview (a second overview path), the whole
   delivery chain (lift/carry/set-down/flatten/recycle), the deep register
   states (check-ins, walk-ins, restock), cooler and fitting-room doors,
   tool CONTACT verbs (wring, empty, dispose — the census only equips),
   tractor fuel/belt/repair, mower and spreader selection, irrigation,
   spotlight aim, tee-sign repair, the boards, the laptop, the phone.
   None censused.
3. **"Fixed to zero" was measured as a re-press of the warmed state.** The
   fix warmed exactly what the census then pressed. Circular by
   construction; honest about its own state, silent about yours.

Ledgered in FOUND_FALSE.md (Shape 7, with the list itself as Shape 1).

## What did NOT reproduce

- Nothing failed to reproduce. The freezes appear on a NEW GAME as readily
  as on your save — Day 1 starts at 6:00 AM, which is the state that
  matters.
- One adjacent finding, recorded and left alone per your instruction to
  stay off the profile question: your save copy's Continue button never
  enabled in the harness within 25 s across three boots (the runs
  proceeded new-game). Whether that is a save-scan latency or something
  about copied profiles is not chased here; your original profile resumes
  for you.

## Where the fix has to live (named, not built — you said report)

The freezes are program arrivals in play states no warm ever drew. The two
named fixes from Goal 29 (till, editor) and both of tonight's surfaces are
the SAME defect: **the warm draws under warm-state, play happens under
play-state.** A fix that survives this ledger must make the warm draw under
the state the game actually enters play with (6:00 AM, sim live), and add
the always-on arrivals tripwire (log every post-veil program arrival with
its twin-diff) so the next uncensused surface names itself in QA instead of
in your hands.

---

# THE FIX, BUILT AND MEASURED (2026-08-16, the following session)

## What was built

1. **The shadow-type flip now settles BEFORE the first mass compile.** The
   flip used to land inside the warm-composer bake — AFTER compile-hidden
   had compiled the whole world — so every world material carried a stale
   pre-flip program and recompiled at first sight in play (the door's five
   arrivals, the till's two, the editor's family). The settle now runs as
   the prewarm's first GPU act, through an override-material render so the
   settle frame itself compiles one basic variant instead of a pre-flip
   world. Stage label: `shadow-settled-before-compiles-1`, one iteration.
2. **The overview warm performs the REAL Tab transition** — real walkExit
   (the held-rig light leaves the visible set, which is part of the state),
   the real spinning player pin, whole-course framing, dirt pillars, two
   frames — then restores. Its own state is now self-reported in the
   timings: visible point-lights, flora instances, programs minted.
3. **The tripwire.** From frame 900 of active walk, any program arriving
   logs itself (console.warn + `scene3d.programArrivalTripwire()`) with its
   nearest-twin field diff. A missed surface names itself in QA now.
4. **The bailout is now honest.** `__FW_PREWARM_NO_BAILOUT` holds it open
   for QA; a bailed boot records `prewarm-bailout-skipped-draws` so it can
   never again read as a warmed boot.

## What the fix measures, on the repro driver (real walking, real E, real Tab)

With the warms RUNNING (bailout held open):

| gesture | arrivals before | arrivals after |
|---|---|---|
| front door + walk-through | 5 | **0** |
| Tab overview | 10 | **1** (the dirt-sense marker's basic, two packed bits — named, small, tripwire-tracked) |

Worst frames on this machine tonight: door 1,035 ms, tab 1,017 ms — but the
door showed those with ZERO arrivals: that is the machine's ambient stall
hitting arrival-free frames identically. **The under-200 ms number cannot be
certified on this hardware tonight; the compile CAUSE is gone.** On a
machine that does not stall, ~40-70 ms per residual compile is the going
rate, and there is one residual.

## THE DISCOVERY THAT EXPLAINS YOUR SESSION: the bailout guts the warms on this machine

`timedWarmDraw` becomes a NO-OP after the first >5 s stall — and on this
machine the stall fires EVERY boot. Every camera warm, the spin, the
ledger, the register and the overview warm silently skipped on every boot
you played. The bailout's premise — "first looks pay their old small
costs" — is false on the very driver that triggers it: the same stall that
hits the warm hits the first look, in your hands, at every new surface.
Your unplayable session was this trade executing as designed. It stands
tonight (un-bailing means 60-90 s loads on the stalling machine), but it
is now measured, labelled, and holdable-open.

## THE STATES SWEEP — you were right, and here is the different fix

One live session, warms held open, four states, tripwire read per state:

| state | program arrivals | worst frame |
|---|---|---|
| evening 19:30 | 1 (the known marker) | 33 ms |
| **night 23:00** | **31 — every one `physical`, light-count field 4→2** | 575 ms |
| heavy rain | **0** (rain is shader-driven) | 18 ms |
| **shop open mid-morning 10:00** | **28 — light-count field 4→3** | **7,946 ms** |

Warming one state MOVED the problem, exactly as you suspected. The axis is
now named by value: the packed key field is the VISIBLE POINT-LIGHT COUNT,
and a normal day walks it through at least four values (dawn walk 4,
overview 1, night 2, trading morning 3). Every transition revariants every
lit material on first sight. That is a different fix, and it has a name:
**collapse the axis — pad the visible point-light set to a constant count
with zero-intensity lights so the count never changes and one variant
serves the whole day** (alternatively: warm all four counts behind the
veil at 4x warm cost). Padding is the principled one; it also covers every
state nobody has enumerated yet. Not built tonight — it touches the
lighting core and deserves its own gated pass with goldens across all four
states.

## Collateral confirmations

- **The register till's Goal-29 residual is fixed by the same settle:**
  first press now +0 programs / +0 geometries / +0 textures (was +2
  programs one field-48 step from their twins), second press 0/0/0,
  planted-upload control exact. The "field 48" mystery is closed: it was
  the shadow-type flip landing after the world had compiled.
- Gates: lint ratchet 323 exactly, full suite exit 0, goldens 13/13 with
  the one-pixel control caught, on the fixed tree.

---

# THE FOUR ITEMS (2026-08-17 early), measured with real input, no pins

## 1. The point-light pad: BUILT, MEASURED, REVERTED — it did not pay

The pad held the visible point-light count at a constant 5 and the
four-state pixel A/B proved zero visual effect (pad-on-vs-off under each
state's own noise floor; pad arithmetic exact: dawn 4 real -> 1 pad,
overview 1 -> 4, night 2 -> 3, morning 3 -> 2). But the arrivals acceptance
refused it: morning collapsed 28 -> 2, and evening went 1 -> 13, night
31 -> 44 — new variant families surfaced on OTHER packed fields (34, 38):
different shader families pack their light vectors at different indices,
and the tool-rig scenes carry their own light rigs the scene pad cannot
reach. Net arrivals across the four states: 60 before, 59 after. It moved
the problem between states, which is the standing definition of does-not-
pay. Reverted the same hour. The module (`src/render3d/pointLightPad.js`,
unwired) and the A/B driver stay as the seed of the real fix, which must
pad EVERY light-family axis in EVERY rendered scene — a lighting-core pass
with its own gates, not a night landing.

## 2. The editor: NOT structurally broken — and the freeze has a name

Reproduced with real input twice, including J pressed MID-SPRAY with the
button held: the transition exits the walk, no viewmodel mesh is chain-
visible, right-drag rotates the rig (yaw 4.676 -> 2.492), the wheel zooms
(dist 342 -> 303), tool buttons react. The first repro's "dead input" was
this instrument's own error — it judged reaction on {courseMode, toasts,
pointerlock}, none of which a working editor click changes (ledgered
below with the numbers that corrected it).

The real defect: **editor entry costs 0 arrivals / 0 uploads / no frame
over 100 ms on a WARMED boot — and 17 program arrivals on a BAILED boot**
(field 36 4 -> 0: the editor's day-pin drops every point light). On this
machine every boot bails, so every entry pays 17 driver compiles, and on
stall weather that is a frozen screen showing the last walk frame — the
hand and the cleaner — with a live OS cursor. Exactly what was reported.
The remedy is the bailout trade again, now with numbers on both sides:
exempting the tiny state warms (editor/overview/register: ~10 draws)
re-arms the load stall risk on this machine; staggering entry compiles one
per frame keeps the editor painting while it pays. Owner's call; both are
scoped in this file's history.

## 3. The laptop: attributed — MAIN THREAD, one task, 3.6 s

Bar completes at its scripted 1,350 ms; **18 ms later a single 3,583 ms
longtask runs**; first click reacts 3,801 ms after the bar. Program
arrivals across the window: 0. Geometry: 0. Textures: 0. DOM growth: 65
nodes. This is pure synchronous JS inside `laptopUi.open()` -> `render()`
of the home page (the state-wide search index is the prime suspect). Not
GPU, not compiles, not uploads — a compute block that should be deferred
or chunked, and the bar should not claim done before it runs.

## 4. Tab and the page turns

- Page turn: unmeasurable on a fresh save (single-spread ledger refuses
  turnPage — its own long-standing note), open cost small tonight; the
  55 ms canvas-sync floor from the ledger's own measurements stands.
- Tab: NOT arrivals (one known basic remains), NOT purely ambient — there
  is a reproducible INPUT-ROUTING flake at the transition: across three
  runs, Tab toggles were half-eaten (one press netting zero mode change),
  and W held through — or pressed fresh after — a swallowed toggle leaves
  the player standing in overview, which reads exactly as "about 3 seconds
  before I can move" (the human retry loop). Reproduction driver:
  `tools/qa/ownerplay-tab-repress.js` (state snapshots per step). The
  input-router fix is flagged as its own pass per the stop-clause.

## 5. General smoothness, measured while WALKING (sim live, owner resolution)

20 seconds of held-W walking with quarter turns, 1,839 frames:
**median 10.2 ms (98 fps), p95 23.0 ms, p99 27.1 ms, worst 43.1 ms.**
The median is high-FPS; the FEEL is the tail: roughly every tenth frame
runs 2x the median, which matches the 10 Hz fitted-shadow bake cadence.
That tail — not a hitch, not a compile — is the "doesn't feel like high
FPS" texture, and its lever (shadow bake spreading/caching) is a perf
pass, not a state-parity one.

## Instrument corrections this session (kept honest)

- The editor "dead input" verdict was the probe's blindness (wrong
  reaction axes), caught by re-measuring on the rig camera and DOM.
- The pad's pixel A/B and its arrivals acceptance disagreed — the
  acceptance wins, the pad reverted.
- `elementsFromPoint` centre-stack in a clean editor: just the canvas;
  the earlier `ced-mini` hit came from this driver's own earlier clicks
  opening panels — an instrument artifact, not the input eater.
