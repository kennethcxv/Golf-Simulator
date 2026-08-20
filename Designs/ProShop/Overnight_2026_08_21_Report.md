# Overnight 2026-08-21 — morning report

Five commits, gate green at the end (`GATE_EXIT=0`, 3793/3793, one-pixel
control fires): `d917c7a` laptop, `53aa3e3` frame health, `a9304cf` second
clubhouse deleted, `5636453` desk frame, `6d85fa6` hutch + heroes, `ef550c7`
ladder deleted.

## FIRST: the two globals to read from a real launch

**`__fwVeilTicks`** — was this boot throttled? `npm run dev`, F12 (DevTools
opens detached with `--dev`), wait for the veil to lift, then in the console:

    __fwVeilTicks        →  { frame: 27, timer: 0, ms: 210.4 }

`timer: 0` = every yield got a real frame; the boot's length was the work.
`timer: 20+` = the compositor was starving the boot; the number describes the
machine's display state, not the build.

**`__fwFrameHealth`** — new tonight, and the one I most want after you PLAY
for ten minutes:

    __fwFrameHealth      →  { gaps250: n, gaps900: n, worstMs: …,
                              mainThreadShare: 'compositor'|'blocked', recent: […] }

Every production frame stamps its gap; a 100 ms heartbeat runs beside it, so
each gap over 250 ms is labeled **blocked** (main thread — the build) or
**compositor** (frames not delivered — the machine). Its negative control is
in `tools/qa/fast-swap-burst.js`: a deliberate 300 ms block must show up
labeled `blocked`, and does.

## Block 0 — the systemic cause: measured, split in two

### What one QA session recorded while the game-side numbers were pristine

    gaps250 = 11,  gaps900 = 5,  worst 3,643 ms, verdict compositor

— in eight minutes, on a build whose scrub test applied 28/28 presses with
settle 0 ms in the same run. **The machine freezes the screen for seconds at a
time while the game answers instantly.** That is what "everything I touch is
laggy" feels like, and no per-surface fix can touch it.

Ruled out tonight by direct A/B (each run in `qa/boot9x/`):
- **Wallpaper Engine** — killed: 10/5/3.3 s, statistically identical.
- **Window focus** — QA windows run unfocused; forced focused
  (`FW_QA_FOCUS=1`, new in main.cjs): 12/8/3.6 s. Identical.
- **The build** — last night's swap A/B threw the same outliers on both arms.
- **GPU process crashes** — none logged; in-process GPU.

Still standing: NVIDIA driver (July 2026), DWM/MPO transitions, G-SYNC
windowed behaviour. **A 2-minute test you can run**: play with
`__fwFrameHealth` open, then toggle "Multi-Plane Overlay" off (registry
`DisableOverlays`) or flip G-SYNC to fullscreen-only in NVCP and play again.
If `gaps900` collapses, we have the machine-level culprit.

### The overnight 1 Hz state — and a question only you can answer

Last night's 6.05 s vs 34.8 s: same build, same profile — the difference was
rAF pinned at 1 Hz (timers fine) while both display heads reported offline.
Tonight, with your display timeout set to NEVER (verified), session unlocked,
no screensaver, **the machine never entered that state on its own all night**
— every probe read healthy from the moment you left.

**Morning question: did you power the monitor off by its button on the
night of the 18th, and leave it on last night?** One answer settles the
trigger. (A real keystroke woke it instantly both times I saw it; QA's
injected input never does — `run-electron` now stamps `compositorAtMenu`
into every run and prints a WARNING when a run is measured throttled, so a
poisoned number can never again go unlabeled. HARNESS_DEBT #11/#12.)

### The one genuine per-surface defect — found, fixed: the laptop

My own Item-0 retirement of the laptop-view warm had handed the first open a
**12,809 ms main-thread block** (whole catalogue rendered + PNG-encoded
synchronously; CDP profile: toDataURL 2,797 ms + getProgramInfoLog 1,889 ms).
Three-part fix, watched failing on the reverted shape:

| | before | after |
|---|---|---|
| first open, usable | 13,322 ms (12,809 block) | **916 ms** (32 ms block) |
| repeat open | 900 ms boot theater replayed | **256 ms wake** |

- thumbnails STREAM one per beat into placeholder cards (thumbs.js queue);
- the rig renders on the MAIN renderer into an offscreen target — a second
  GL context measured 2.5–3.6 s of block at the first outdoor belt press
  alive, and 2.3 s to recreate disposed; one context ends both;
- a woken laptop no longer boots: exitLaptop leaves the lid open, opens after
  the session's first skip the power-on choreography (new scene = boots).

### The full surface table (healthy compositor, sim live)

| surface | measured | verdict |
|---|---|---|
| fast scrub 8–12 presses @150–180 ms | all applied, settle 0 ms | clean |
| single tool swap | p50 20.5–29 ms, 0–1/9 swallowed | clean (guard) |
| laptop open (boot / wake) | 916 / 256 ms, blocks ≤32 ms | fixed tonight |
| ledger page flip | turns 30–34 ms vs ambient 30–32 | ambient — never slow |
| Tab in / out | 49 / 33 ms worst block | fixed 08-20 |
| editor enter / exit | 362 / 459 ms worst | fixed 08-19 |

(The pageturn driver had drifted twice — moveable book, two-beat open — and
was repaired; ledger measured on a copy of your own save.)

### The main-loop decision: NO armed fallback, and here is the reasoning

1. The 1 Hz state has never been observed while real input arrives; one
   keystroke clears it. A player's first input IS the wake — a timer loop
   cannot beat it to the punch.
2. Serving frames at 1 Hz to a display that is off is correct behaviour; an
   armed timer loop would burn CPU drawing for nobody.
3. The two real victims are covered: the unattended boot (prewarm's armed
   race, 08-20) and QA numbers (`compositorAtMenu` stamp + WARNING, tonight).
4. The multi-second in-play gaps are NOT the 1 Hz state (they hit focused,
   display-on runs) and a main-loop fallback would not touch them — they are
   machine-level and now measured per-session by `__fwFrameHealth`.

## Block 1 — the second clubhouse is deleted

`vendor/models/clubhouse_ext_opt.glb` — a downloaded house model (source file
literally `house+3d+model.glb`) standing at scale 20 as "the groundskeeper's
residence". Placement, collider, walk prop, preload entry: gone. Both GLBs
archived under `Assets/_archive/` with ARCHIVED.json entries, so naming either
path fails the suite; the vendor manifest no longer generates the copy.

Proof: the network gate, watched flipping — placement restored = 1 GLB request
per boot; removed = 0 (`tools/qa/tripo-house-gone.js`). In the pinned v2
layout it stood entirely inside the forest, which is presumably how it
survived months of QA frames; your layout put it in the open.

Also surveyed (reported, nothing deleted): `Assets/models/hero` 60 files not
wired (v5/v6/v7 bake byproducts), `Assets/pro_shop` 495 files with **no loader
at all**, `pro_shop_furniture` 281/301 not wired.

## Block 2 — the desk frame IS the drawn desk now

`frontLength` 4.2 → **2.388 m** (your call), pinned by test to the measured
`HERO_COUNTER_DRAWN_HALF_LENGTH`. The audits then named every mover, and each
got its own fix: back cabinets shrank to 1.28 yd and moved west (the 3.2 yd
run left a 0.33 yd staff mouth); register kit compacted inboard; the west-end
paperwork cluster (ledger spawn, phone, lamp, clipboard — your floating-props
complaint) came in from x −2.08; the cashier stand moved 0.10 east (a carton
at the old stand grazed the relocated return leg); the chair parks at the open
east end after four west-half attempts each failed a different standing
contract; the legacy asset61+return pair keeps its authored 4.20 m seam as a
centred unit (the GLB contract test caught my split poses interpenetrating).

One golden (bag-packed) deliberately rebaselined. `--accept --only` ignored
`--only` AGAIN — twelve goldens hand-restored, HARNESS_DEBT #13.

Photos in `qa/final-room/`: `block2c-desk-front.png` (desk with laptop seated,
register block, nothing off the ends), `block2c-from-desk.png`,
`block3b-hutch-closeup.png`.

**Room notes, as asked**: the shrunken hutch reads as a dark divider behind
the desk's west half — it wants either re-centring on the desk or its wordmark
back; the essentials pegboard crowds the doorway sightline at close range;
two bare brass pegs on the wall east of the hutch are exactly where
`hero_cap_peg` belongs day-one (candidate, not done).

## Block 3 — the baked heroes are in a room

The drawn backcounter was itself a hardcoded 3.2 yd unit — same disease as the
desk; every dimension now derives from the fixture footprint. Its lit hutch
boards now show the hero work day one in every dressed room:
`hero_polo_folded`, `hero_hoodie_folded`, `hero_tee_folded` on the lower
board; `hero_towel` and `hero_cap` on the cabinet top — all `instantiateRaw`
(their material names resolve to charcoal through `instantiate()`). Cap-on-peg
and the hung garments stay stock-gated through their existing slots.

## Block 4 — the ladder is deleted

Reproduced first (staged 8 desk walk-ins, ladder off): worst no-progress
climbed linearly to **125 s**, four bodies in a permanent touching knot,
stop legality innocent (`unreachable 0`) — mutual deadlock, as you said.

Replacements, none of which moves a body:
- **`orca.js options.patience`** — no-progress seconds escalate the
  deterministic lean, this body's reciprocal share, and squeeze the comfort
  band (floor 40%, radii inviolate), identity-scaled so mirrored pairs never
  escalate in lockstep. Red/green: `tests/orca-deadlock-escalation.test.js`
  (aisle sized so full comfort cannot pass, squeezed comfort can — the control
  parks, escalation passes, zero contact either way).
- **Hold-and-pass** — mutually stalled neighbours: the less bold (hash) stands
  1.6 s, the other passes. Two mobile bodies otherwise seesaw forever
  (measured).
- **Depth-aware blocked arrival** — reach extends per stationary body in the
  corridor (cap 3); the 125 s freeze was a walker 1.2 yd behind a two-deep
  knot, outside the old one-body reach.
- **Experience sockets validated** through `legalStopPoint` (tour_vault's
  socket was the written gap). Queue slots were already validated; the exit
  stands in DOOR_CLEARWAY, which every layout rule keeps clear.
- **Queue waiters do not escalate** — their stillness is the line working.

Like-for-like staged A/B (same driver, same mix):

| scenario | old solver, ladder off | tonight |
|---|---|---|
| all-desk knot, worst no-progress | 125 s, climbing | **37.7 s, capped** |
| all-desk knot, touching frames | 1,571, climbing | **6 total** |
| mixed errands, completions | browsers churn (stalls 73↑) | **6/8 leave in 30 s**, stalls plateau 14 |
| clip vantage run (3 min) | — | shoves 1, stalls 0, closest 0.779 yd |

The bell survives as a 30 s give-up fuse; the player-yield hold and plain
repath survive; the source contract asserts no rung returns.

**Honest gap**: clips were recorded (`qa/nav/b4-*`) and frames reviewed — no
interpenetration visible anywhere — but the queue vantage kept landing
illegibly (three attempts, stop rule). A legible clip of a full queue cycle
with a served customer is still owed, and serving the desk end-to-end from a
driver remains the known missing harness piece.

## Debts and opens

- The multi-second compositor gaps: environmental, quantified, unattributed.
  Your `__fwFrameHealth` reading after a real session is the next datum.
- The monitor question above (trigger of the overnight 1 Hz state).
- Laptop driver still presses hook-level (the E-prompt aim never landed);
  input path certified by the swap/door drivers instead.
- `final`: hutch wordmark/centring; cap-on-peg day-one; the desk-side brown
  board composition.
- `nav-five-minute-watch` gained `QA_NAV_DESK_SHARE` and `QA_NAV_CAMERA=desk`;
  its staging now mixes browsers with desk walk-ins.
