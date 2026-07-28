# OVERNIGHT REPORT — greybox-walk punch list, night of 2026-07-28

Thirteen items. Ranked by what you should read first, not by item number.
Every measured figure in this report has its instrument and evidence file named.

---

> **Morning update:** your "Continue" un-gated the stop. The resize is BUILT as
> §3 specifies (commit `00f92eb`), the layout contract grew to 16 green tests,
> and the full verification battery ran on the finished room — measured results
> in §3b and the addendum. The two decisions still open for you: the wall-vs-sim
> clock ruling, and the harness-hygiene afternoon.

## 1. READ FIRST — item 12 fired: the resize build and the §9 number set were STOPPED overnight

Item 7's audit came back **systemic, not one-harness** — three named divergence classes
(full findings in `Designs/ProShop/HARNESS_TRUST.md`):

1. **Environment**: all 306 browser harnesses run headless (SwiftShader GPU) at pinned
   1600×900/DPR-1 against the dev server. Zero committed harnesses exercise pointer-lock
   mouse-look, native DPR, or the Electron build beyond a main-menu smoke. Every green we
   have says "works in the browser build" — nothing more.
2. **Drive mechanism**: the house pattern teleports fixtures then asserts through real
   input (fine, and the best files genuinely earn their greens), but every *time-spanning*
   claim (full day, patience, rollover) ran at 16× through watchdogs too coarse for the
   claim — the customer-day case below was the proven instance.
3. **Maintenance drift**: **14 committed harnesses are dead or false-red** — one does not
   parse, nine reference an undefined `BASE_URL` global, five call a removed
   `register.swipeAt()`, and `simplified-register-acceptance.mjs` pins a scan-evidence
   field (`mode: 'direct-to-bag'`) that no shipped register ever emitted.

Your rule was explicit: systemic ⇒ stop before items 4 and 8. So: **the resize is fully
designed (section 3) but not built**, and no verification-number set was produced on top
of the untrusted instrument pool. Tonight's other numbers all come from Band-A instruments
(real-input, contract-verified) and are labelled as such.

**And one discovery made after the audit, which belongs at the same severity: the game
clock and the game's actors run on different clocks.** `clubhouseApi.update(dtMs)` at
`courseScene.js:9651` receives RAW WALL time — the 16× speed control compresses the
CLOCK, but customers, doors, and interior life keep moving at 1× wall rate. Measured
consequence: a 16× "day" gives customers ~40 wall-minutes of actual locomotion (1/16 of
a day's ground), which is why every accelerated day run — old instrument and new — shows
near-zero transactions and customers still mid-route at close. This is simultaneously
(a) the reason no 16× harness can honestly claim "a full simulated day of customer
behaviour", and (b) a live economy question: **shop throughput per sim-day falls as the
player raises game speed.** Whether that is intended time-lapse feel or a bug is a design
call only you can make.

**Decision needed (morning):**
- Un-gate the resize build as designed in section 3? The design is complete to the
  coordinate level and the build path is proven (same seam mechanism as the current v2).
- Rule on the wall-vs-sim split: should customer locomotion scale with game speed
  (sim-consistent economy, bigger nav load at 16×), or stay wall-rate (current shipped
  behaviour, throughput inversely tied to speed)? The nav instruments are now written
  for the current behaviour and labelled with it either way.
- Authorize the harness-hygiene afternoon (mechanical): fix/archive the 14 dead files,
  commit the parse/API sweep so dead harnesses can't re-enter the tree, add the
  SwiftShader gate to perf harnesses, port one Band-A acceptance into Electron.

## 2. Item 3, answered plainly — did the customer-day check run, and did it pass?

**It ran, and it FAILED — twice — and the failure agrees with what you saw live.**

Both overnight runs of the day harness came back `ok: false`
(`Greybox/data/greybox-customer-day-run1.json`, `run2.json`): run1 flagged 3 stuck
customers in the neglected leg and 4 in the restored leg; run2 flagged 4 and 4. Zero
transactions in all four legs. The results landed after my last status message to you
("Customer day ×2: Running") — a reporting-latency failure on my side, not a false green.
The harness never told you "zero stuck NPCs"; it never got the chance to tell you anything.

**The divergence that DOES exist** is instrument coarseness, and it matters more than this
one bug, exactly as you suspected: the watchdog only counted a customer as stuck after
**20 sim-minutes** frozen (75 wall-seconds at 16×), rounded positions to a 0.5-yd grid
(oscillating stuck-loops reset the timer), exempted queue states entirely, and did not
assert `stillInsideAtClose`. It caught only the totally-frozen; everything softer passed
silently. That instrument is rebuilt (section 8). One more layer surfaced while rebuilding
it: because customers move in WALL time while the 16× clock spins (section 1), those runs
were never "a full simulated day of customer behaviour" at all — they were ~40
wall-minutes of true-rate motion under a compressed clock. The 75-wall-second freezes they
flagged remain genuine freezes; the day-scale framing around them was fiction twice over.

**The stuck customers themselves**: all seven recorded pins across both runs decode (via
the measured interior offset) to interior-local x −6.5…−8, z −4…+4.5 — **the browse stand
points of west-side fixtures** (`rack_drivers`, `rack_irons`, `table_polos`,
`cold_drinks`), which is your "stuck against a greyboxed wall fixture" sighting. The
mechanism, from the nav code itself (`src/render3d/clubhouse/nav.js`):

- `path()` silently snaps an unreachable goal to the nearest free grid cell, while the
  walker's arrival test still demands `dist < 0.18` to the ORIGINAL stop → a stand point
  that ends up inside a radius-inflated collider region can never be "arrived at";
- the built-in recovery (1.2 s repath, 3 s random sidestep) then loops forever: repath
  produces the same path, the sidestep resolves back into the same pocket;
- two adjacent latent hazards found on the way: door-flagged colliders are excluded from
  the nav bake but solid in customer collision when closed, and the asset-63 fitting-booth
  colliders are axis-aligned (they ignore the fixture's `ry` — the current v2 pose rotates
  the booth π/2, so its solid walls sit 90° off its visible shell).

The fix shipped tonight is the recovery ladder + block log (section 8), which makes any
such trap loud, recoverable, and reported with positions. The proposed resize (section 3)
also happens to demolish the entire west-wall territory where these pins live.

## 3. Items 4 + 10 — the resize: designed overnight, BUILT on your go

**Current interior, at the verified 66° lens** (datums from `shopLayout.js`, walls
measured live): the whole interior is 16.34 × 10.04 m (**164.1 m²**; gross shell
16.80 × 10.50 m = 176.4 m² = the header's 1,898.8 sq ft). The **public retail floor**
(west of the x=5.7 service partition) is 13.39 × 10.04 m = **134.4 m²**. Ceiling:
`SHELL.h` = 3.2 yd = **2.93 m**.

**Derived target.** Research anchors (sources in the working notes): real cramped
municipal pro-shop retail floors 25–90 m² (healthy small-public average 93–137 m²); TCG
Card Shop Simulator starting shop ≈ 50–80 m² (est. from tile counts); Supermarket
Simulator starting floor 16 m². Your 55–75 m² instinct is supported; the evidence tightens
it to **55–70 m² for an unmistakable cramped read**. Proposal: **70.0 m²** (8.30 × 10.09 yd
= 7.59 × 9.23 m) — the top of the band, chosen so the mandated lounge, the D1 desk+queue,
and a minimal browse circuit fit without violating any clearance datum.

**Mechanism**: the exterior building is an authored GLB (assets 51/52), so the greybox
resize builds **new grey interior walls with matching builder-owned colliders** inside the
existing shell — west wall pulled from x −8.94 to **−2.60**, north wall from z −5.49 to
**−4.60**; east (service partition) and south (door/porch) walls anchor. The space behind
the new walls becomes enclosed dead cavity — invisible from inside; the exterior keeps its
current size until Phase 4+ re-authors the shell (recorded consequence, below). The whole
change rides the existing variant seam; v1 stays byte-identical.

**Ceiling (item 10)**: drop to **2.80 yd = 2.56 m** with four grey cross-beams (0.18 deep
→ 2.40 m clear under beams), beam stations kept ≥1.0 yd off the door wall so the 2.45 m
door head clears. Low ceiling + beams carries the "underfunded municipal" read harder than
the footprint cut does.

**Every fixture cut, and why** (9 cuts):

| Fixture | Why cut |
|---|---|
| `rack_drivers`, `rack_irons` | A failing muni starter does not rack full club lines; clubs are the tier-2 aspiration the upgrade path sells back |
| `rack_putters` | Same rationale — it was the last club rack standing, and the west wall cannot hold booth + two retail walls + a rack (cut rather than cram) |
| `table_polos` | Apparel table is the biggest floor hog in the room; one wall display carries apparel at tier 0 |
| `shoerack` | minTier 2 already; shoes return with the tier upgrade |
| `bagstand` | minTier 2; floor hog; keeps the door→lounge fan open |
| `rail_outer` | Outerwear depth is a later-tier investment; its S-wall run is desk territory now |
| `hatstand` | Freestanding floor pole in a room with no spare floor |
| `snackrack`, `cold_drinks` | The refreshment corner is the tier-2 lounge upgrade's story; no wall run left at tier 0 |

`shelf_small` (gloves) also loses its own unit — its SKUs fold into the essentials
pegboard (one crowded display is on-theme; display-slot capacity note recorded).

**Kept and re-placed** (all inside the new envelope, stand points clear of every collider):
fitting room → NW corner (−0.35, −3.70, ry 0 — which also aligns its axis-aligned analytic
colliders with its visual shell, burying the ry-desync hazard); golf-balls shelf → west
wall (−2.25, −1.90); essentials pegboard (+gloves) → west wall (−2.25, 1.60); feature
display → room centre-south (0.55, −0.55, ry 0, facing the door); putting strip →
(1.70, −2.20); **lounge relocated** to the new NE corner (chairs/coffee/rug at
3.55…4.75, −3.05…−4.05; trophy/events on the partition; photo on the new north wall) —
the current lounge sits beyond the new north wall, and your mandate keeps it, entrance
sightline intact. Desk (D1), backcounter, queue, member station, safety site, tour vault:
**unchanged**. Service wing (office, stockroom, receiving, cleaning suite, all sockets
71–100): **untouched**.

```
BEFORE — current pine-hills-v2 public floor (13.4 × 10.0 m of the 164 m² interior):

      N (z −5.49)
  ┌─[balls]──[essentials]──[gloves]──────────────┬─────────────┐
  │ [drivers]                         LOUNGE     │  STOCKROOM  │
  │ [irons]  [shoes]  [fitting]    chairs·rug    │ (untouched) │
  │          [polos]              [vault]        ├─────────────┤
  │ [putters]      [DEMO════]       [scorecards] │   OFFICE    │
  │ [bags]                          [safety]     │ (untouched) │
  │ [fridge] [feature]      ┌──DESK──┐ [hutch]   │             │
  │ [snacks]  [RAIL]  ═DOOR═└────────┘           │             │
  └───────────────────╨─────╨───────────────────-┴─────────────┘
      S (z +5.49)   W wall x −8.94        partition x 5.7

AFTER — proposed 70 m² room (new grey walls; ▒ = sealed dead cavity):

  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒┌─[FITTING]─[photo]────────┬─────────────┐   N wall
  ▒▒  (cavity —      ▒│           LOUNGE         │  STOCKROOM  │   z −4.60
  ▒▒   behind the    ▒│[balls]  chairs·rug       │ (untouched) │
  ▒▒   new west      ▒│         [DEMO══] [vault] ├─────────────┤
  ▒▒   wall; the     ▒│[essntl+                  │   OFFICE    │
  ▒▒   exterior GLB  ▒│ gloves] [feature] [score]│ (untouched) │
  ▒▒   keeps its     ▒│              [safety]    │             │
  ▒▒   footprint)    ▒│        ┌──DESK──┐[hutch] │             │
  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│  ═DOOR═└────────┘        │             │
  ───────────────────-┴──╨────╨───────────────────┴─────────────┘
                    W wall x −2.60          partition x 5.7
  Ceiling: 2.93 m → 2.56 m + exposed grey beams (2.40 m clear).
```

**Recorded consequences you should know before the go:**
- **F1's ≥8-yd metric is physically impossible in a 9.2-m-deep room** — most rays hit a
  wall inside 8 yd in an *empty* room. The plan: report the literal figure AND a
  wall-normalized figure (first-hit ≥ 0.8× the empty-room distance along each ray, pass
  fraction ≥ 60%), same normalized metric re-measured on v1 for a fair A/B. Flagging this
  as a metric change, not silently redefining your threshold.
- The old room's windows (both S-west, one N) end up in the dead cavity; daylight becomes
  door-glazing only until Phase 4 decides window placement on the new walls.
- The exterior GLB reads bigger than the interior until the shell is re-authored (Phase 4+).
- v1 saves opened in v2 lose player-moves of cut fixtures (orphan layout entries ignored).
- Customer route door → browse → counter → exit re-verifies with the rebuilt day
  instrument as the acceptance, plus stop-clearance assertions added to the layout tests
  so a stand point inside a collider (item 3's trap) can never ship again.

### 3b. Built and measured (commit `00f92eb`, full suite 2407/2407)

The build is exactly the design above, with three coordinate refinements the new
16-test layout contract forced before it would go green (balls/essentials shifted
0.35/0.15 north to clear the booth's stand-point clearances; lounge chairB pulled
to (4.45, −3.30) out of tour_vault's sightline corner; the lounge traffic leg
ends at the threshold instead of inside the coffee table). The contract now
proves, statically, the thing item 3 taught: **every browse/stock stand point
and queue slot is ≥0.30 yd clear of every collider rect**, and no traffic leg
crosses anything solid.

Live figures on the finished room (`greybox-acceptance.json`, instrument updated
to the envelope — same code path measures both rooms):

| Measure | Resized v2 | v1 (same instrument) |
|---|---|---|
| F1 normalized (first obstruction ≥0.8× empty-room distance) | **65.7%** ≥ 60% ✓ | 5.7% |
| F1 literal ≥8 yd (physically wall-capped in a 9.2 m room) | 51.7% (static prediction was 51.2%) | 5.5% |
| F1 near-blockers | the retail fixtures themselves (essentials, feature, balls) | POS_Rear + static batch + POS_Bezel |
| F2 wall midpoints | 4/4 | 3/4 † |
| F5 lounge from the door | chairA 71.4 / chairB 100 / coffee 85.7 / rug 71.4 ‡ | n/a (no grey suite) |
| Staff corridor / queue gap / spacing | 1.130 / 0.640 / 1.263 (identical to approved — the desk anchored) | — |
| Checkout (full card tx) | $33.00, cash=ledger +33, units +3, shelf −3, facing −1.0 ×3 | — |
| Laptop | 66→34→66 both exits, 7/7 pages | — |
| Save round-trip v1↔v2 | zero differences | — |
| Customer day + perf A/B vs Phase 0 | addendum §12 | addendum §12 |

† v1's F2 north "miss" is the reworked vantage (now envelope-centre-derived)
grazing v1's outerwear rail — nothing moved in v1; the old vantage dodged it.
‡ The putting strip (0.4 tall, deliberately in the door→lounge fan so the chairs
watch the green) and the feature display's corner shade below-knee samples;
everything from seat-height up reads. If you want the old 100×4 back, the trade
is sliding the strip out of the fan — your call, flagged rather than made.

## 4. Item 1 — FOV: no defect is measurable; the instrument now pins it

Measured tonight, both variants, campaign-starter boots (instrument:
`tools/qa/fov-parity.js`, evidence `Greybox/data/fov-parity.json`, **green**):

- Boot idle: camera.fov = walk.state.fov = **projection-matrix truth = 66.000**, zoom 1,
  identical aspect — in BOTH rooms.
- Laptop cycle: 66 → 34 → 66 on both exit routes (Escape and the Close button), both rooms.
- A stored FOV preference (80) reaches the boot lens correctly — "66" is the default, not
  an accident; the preference file is `golfempire:preferences:v1` (range 50–90).
- Eye height above the floor: identical in both rooms at three probe points.

Every lens writer in the codebase lands on 66 (walk), 34 (laptop), 44–52 (register),
46 (management), 74 (cart driver) — no writer is variant-conditional, and the OBS-1 class
(set-without-restore) is covered by the new instrument on both exit routes.

**What I could not do from here** is reproduce your live sighting. Two candidates worth
10 seconds of your time: (a) your install's FOV preference — if your localStorage carries
a value ≠ 66 (the legacy `gc-settings.fov` migrates in!), every room renders wide;
(b) perceptual: a 134 m² untextured grey room reads wider than the furnished v1 at the
same 66 — the resize kills this driver. If it persists after both checks, run
`fov-parity.js` against your build and send me the JSON.

## 5. Item 2 — D key: no defect through the real event path; one real latch vector closed

`tools/qa/walk-input-parity.js` (**green**, evidence `walk-input-parity.json`): all four
movement keys, synthesized as genuine keydown/keyup through the browser event pipeline,
move the walker in the correct directions in BOTH rooms. No handler anywhere consumes 'd';
the movement mapping is symmetric; no latched keys observed after mode cycles.

One structural defect WAS found and fixed: `walkKeyDown` fed keys typed into form controls
(e.g. a laptop search field) into the held-movement set — the only mechanism in the code
by which a key could latch and cancel its opposite (a latched 'a' produces exactly
"W/A/S work, D dead"). Key-down now respects `isTextEntryTarget`; key-up stays
unconditional (heldKeys rule 3).

**Live diagnostic if it recurs**: alt-tab and back (window blur clears all held keys),
then press D. If D works again, it was a latched key — tell me what you typed just before.
If D is still dead after alt-tab, the fault is below the game (layout/hardware/OS hook)
— tell me your keyboard layout.

## 6. Item 9 — checkout/laptop camera framing: measured, fixed, re-measured

Instrument: `tools/qa/focus-framing-probe.js` (screen-quad NDC coverage, eye-vs-screen
height, pitch, standoff, fixed-pose screenshots). Evidence:
`Greybox/data/focus-framing-{before,after}.json` + `framing-laptop-{before,after}.png` +
`framing-register-before.png`.

**Laptop seat — the real breach, fixed to your derivation.** The pose was already
bbox-derived (eye from the screen corners along the live normal, `fitDistance` standoff)
but with authored offsets on top: +0.16·h eye raise, −0.10·h aim drop, 80% height fill.
Measured before: the panel filled **78%** of frame height, taken at a **−23.8°** downward
dive from 0.475 yd — the "menu shoved in your face" geometry, and the lid's back-tilt
keystones the UI so it reads like craning at it. Corrected per your spec — eye ON the
screen's forward normal at the centre (offsets removed), aim AT the centre, standoff
solved for a comfortable share (fracH 0.62): measured after, the panel is **dead-centred
(NDC centre 0.000)** at **62%** height, pitch **−17.1°** — which is exactly perpendicular
to the tilted face (the lid leans ~17°), i.e. "straight at the screen face" in the only
sense a tilted screen allows — standoff 0.598 yd with deck and bezel in frame.

**Register.** The working frame you stand in for scanning/overview measures eye 0.42
above the POS centre at −24.6°, 45% height — above-and-looking-down **by documented
design** ("the till is worked upright… never chin-on-the-glass"), which is the opposite
of the below-the-desk read; I left it untouched rather than fight its acceptance-pinned
choreography without your call. The one register pose that genuinely watched the screen
from below — the check-in tab, authored at eye 1.26 looking **+14.5° up** at the POS —
is now **derived from the live screen quad** exactly as the laptop is (eye on the panel's
forward normal at centre height, straight at the face, standoff solved for a 60% share,
side-guarded against flipped exports, falls back to the old preset until the POS mounts).
The register card acceptance driver re-ran green against these changes (addendum).

## 7. Items 6 + 11 — the FOV bug invalidated almost nothing, and the texel ceiling stands

Full sweep of every capture family under `Designs/ProShop/` (verdict table in the audit
notes; method: trace each family to its producing script and its recorded/asserted lens):

- **No decision document rests on a bad-lens frame.** FLOOR_PLAN acceptance figures are
  raycast metrics (lens-independent) with same-lens 66 screenshot pairs; discriminator
  portraits and rankings shot through an offscreen camera built from `walk.state.fov`
  (immune to OBS-1 by construction); lighting-spike arms assert 66 on all 40 shots;
  texture-validation arms record 66 on every shot.
- **The only bad-lens capture in the tree**: the back ~30 s of
  `Baseline/video/baseline-laptop-checkout-customer.webm` (customer-route/checkout beats
  filmed at 34 after a laptop exit — the OBS-1 defect recorded live in its own JSON). No
  conclusion was drawn from those beats; re-shooting is a plain re-run post-fix if you
  ever want that video as "before" footage.
- **Item 11**: ART_BIBLE §7.3's texel curve (767 px/yd @ 0.5 yd) states and records its
  lens: computed from the live camera at fov 66, with the in-doc analytic cross-check
  (346 vs 350 at 2 yd) that could not hold at any other fov. Since the measured live FOV
  is 66 everywhere, **the curve and the 512² ceiling stand; no re-derivation**. The only
  other non-66 instrument (`part-visibility`, fov 50) is deliberate and documented — its
  frames must never be compared against gameplay-lens captures.
- Two doc soft spots recorded: mainline docs cite `Spike/LIGHTING_SPIKE.md` which lives
  only on the un-merged spike branch; `BASELINE_CAMERA_TRANSFORMS.md` records poses
  without a lens field (lens provenance lives in `baseline-capture.json`).

## 8. Item 5 — customer nav: fail loudly, recover, and the live-parity instrument

No behaviour redesign. Three pieces, all in the tree:

- **Detection**: every stuck escalation logs a structured event — sim-time, customer,
  action, current stop (kind/fixture), position, target, and the surrounding collider
  boxes — to a ring buffer read via `clubhouse.navBlockDiagnostics()`, plus a console
  warning. 3 seconds pinned = first logged escalation, per your spec.
- **Recovery ladder** (extends the existing 1.2 s repath / 3 s sidestep): two sidesteps →
  **nudge** to the nearest cell the nav grid believes open (wedged-in-collision case) →
  **retarget** the stop to its nearest reachable point (the unreachable-stand-point case —
  item 3's exact trap; queue stops keep their geometry) → **skip** the stop rather than
  freeze the walker's day. `nav.js` grew the world-space open-cell queries the ladder uses.
- **Live-parity day instrument**: `proshop-greybox-customer-day.js` rebuilt to the
  HARNESS_TRUST rules — the primary evidence is the game's OWN block log (the same events
  the live build logs), the external freeze watchdog uses net-displacement windows so
  oscillation counts, queue advancement is bounded instead of exempted,
  `stillInsideAtClose === 0` is asserted, screenshots at each close.
- **The instrument's first full run was itself a finding.** With sim-second thresholds it
  flagged 21 "freezes" — and decoding them exposed the wall-vs-sim split (section 1): a
  1.6-wall-second pause is 26 "sim-seconds" at 16×, so sim-unit thresholds against
  wall-time actors are the same class of unit error the old watchdog made in the other
  direction. The watchdog is now expressed in **wall units, matching how the actors
  actually move** (freeze = net < 0.15 yd across 12 wall-s — the ladder's own recovery
  clears that bar, so only a trap the ladder cannot escape flags), the queue bound is
  patience-aware, and the instrument records its limitation in every result
  (`customersMoveInWallTime: true`; a full-parity day requires 1× ≈ 10.5 h). What the
  first run DID prove cleanly: the recovery ladder works — the block log shows
  sidestep → nudge → retarget → skip sequences resolving exactly the browse-stop traps
  from item 3 (25 blocks at `shelf_balls`, 13 at `cold_drinks` in one leg, with collider
  boxes attached), where the old code looped forever. Re-run results with the corrected
  units: **addendum below**.

## 9. Item 7 — where to look: `Designs/ProShop/HARNESS_TRUST.md`

The full ranked table: every harness in `tools/qa/`, its trust grade for a green result,
the named divergence risk, and the cheapest fix. Headlines: the Band-A set (real-input
acceptances, the parity instruments, the save fingerprints) deserves your trust in the
browser build; every headless perf number is SwiftShader until gated; 14 files are dead or
false-red and should be fixed or archived in one mechanical afternoon; the desktop build
has two instruments, both menu-level. Thirteen standing rules at the bottom are written to
be enforceable in review.

## 10. Found on the way (not on your list, recorded rather than acted on)

- **`enterFrontDesk` is a dead no-op**: `main.js:437` calls `ch.register.cashierPose?.()`
  — a method that exists **nowhere** in `src/` — so the tee-desk mode silently never
  opens. The optional chaining hides it; the same drift class the harness audit found in
  `tools/qa/`, but in shipped code. Needs a decision: wire it to a real pose (the register
  has `staffStand`/monitor datums to derive one from) or remove the mode.
- The register camera map for reference (`simplifiedRegisterMode.js`): empty-desk [E]
  lands on `overview` (eye 1.70 looking DOWN at the counter, fov 48.5); the only authored
  looking-up pose is the `checkin` tab (eye 1.26, +14.5° — deliberately below the POS per
  its comment). If your "too low, pitching up" checkout sighting was on the check-in tab,
  that pose's own justification is the thing your item 9 overrules, and the bbox
  derivation replaces it.
- The old `qa/` evidence folders for the nine `BASE_URL`-era scripts (laptop tour pages,
  delivery visuals) are unreproducible by any committed instrument — treat those PNGs as
  historical, not regenerable evidence.

## 11. Rough time spent per item (for calibrating what fits a session)

| Item | Rough time |
|---|---|
| 1 FOV (investigation + instrument + 3 probe iterations) | ~1.5 h |
| 2 D-key (code trace + instrument) | ~40 min |
| 3 stuck diagnosis (evidence decode + nav-code trace + harvest attempts) | ~1.5 h |
| 5 nav ladder + block log + day-harness rebuild + full-day run | ~1.5 h (plus ~45 min run) |
| 4+10 resize (research agent + design to coordinates + this proposal) | ~1.5 h |
| 6 captures audit (delegated agent) | ~12 min of agent wall time, ran parallel |
| 7 harness audit (delegated agent) + HARNESS_TRUST.md | ~19 min agent + ~30 min |
| 9 framing (probe authoring + measurement) | ~45 min |
| 11 texel provenance | folded into item 6 |
| 13 this report | ~45 min |
| Suites, commits, background-run management | ~1 h |

## 12. Addendum — final results (filled before hand-off)

**Item 9 validation**: register card acceptance driver re-ran **green** (`ok: true`)
against both pose changes; framing-after numbers are in section 6. One note: the laptop
nav-through-glass battery was not re-run tonight — at 62% screen share its projected
click targets are ~20% smaller than before; the settle-guard pattern handles it, but if
morning clicking feels tight, `fracH` in `office.seatPose` is the one number.

**Live-parity day runs on the CURRENT v2 room** (instrument:
`proshop-greybox-customer-day.js` at its final wall-unit tuning; evidence:
`greybox-customer-day-live-parity.json` + the preserved first-run
`…-simunits.json` + close screenshots ×4):

| Leg | Tracked | Frozen (12 wall-s net<0.15) | Still inside at close | Blocks logged | Transactions |
|---|---|---|---|---|---|
| Neglected | 11 | 6 | 1 (counter, waiting) | 53 | 0 |
| Restored | 11 | 10 | 4 (3 at west fixture stops, 1 counter) | 363 | 0 |

Verdict: **RED, for real reasons.** Every frozen record and the block-log mass sit in one
territory — the west browse cluster (`shelf_balls`, `cold_drinks`, `table_polos` stand
points, local x −6.5…−7.8) — the same trap field item 3 diagnosed and the same spot you
saw live. The recovery ladder changes the failure mode from "pinned forever" to "churning
recovery" (sidestep-out, collision-resolve-back; retarget/skip eventually move most
walkers — 15 customers were still inside at close under the old code's runs vs 1–4 now)
but the geometry is the disease and the proposed resize demolishes exactly that
territory. Queue rows: with no cashier present the queue holds ≥8 wall-minutes by
DESIGN (patience is ~10 real minutes), so the earlier bound flagged designed waiting —
final tuning bounds it at 12; transactions are zero because the player is the cashier
and no player was present. Full-parity day coverage (customers at true rate for a whole
day) remains gated on the wall-vs-sim design decision in section 1 — at 1× it is a
10.5-hour run.

**Customer day on the RESIZED room** (`greybox-customer-day-resized.json`, wall-unit
watchdog, ten scripted + organic walk-ins, both restoration states, full 16× clock
days):

| Leg | Tracked | Frozen (12 wall-s net<0.15) | Queue violations | Still inside at close | Blocks |
|---|---|---|---|---|---|
| Neglected | 11 | 5 | **0** | 2 (1 counter-waiting, 1 mid-exit on the porch) | 455 |
| Restored | 13 | 5 | **0** | 1 (walk-in waiting at counter) | 380 |

**The browse-stand trap class is dead.** Zero block events at any fixture stand
point that the resize re-placed — the block log's mass moved entirely to the
COUNTER area (75/58 sidesteps), and every frozen record decodes to the same new
cause: **crowd congestion in the queue/exit funnel**. With ~11 customers in 70 m²
and nobody serving the till, leavers jam against the standing queue for 10–15
wall-seconds at a time (the "fixture" labels on frozen rows name the walker's
DESTINATION; the coordinates are all the queue-head area or the porch). Compare
the first build's runs: sim-hour pins and 15 customers trapped at close.

One design flag from this, yours to rule on: D1's queue steps west INTO the shop
(frame-local pitch −1.18/−0.45), which in the smaller room crosses the exit path —
that crossing is where every remaining jam lives. Options: re-pitch the queue
southward along the desk face (a frame-local change to acceptance-pinned register
choreography — not made unilaterally), thin the peak occupancy, or accept
10–15-second jams at full house with no cashier as the "packed muni shop" read.

**Performance — 7 scenarios × 3 runs, HEADED on the real GPU (RTX 5080), both rooms
in one session, Phase 0 quoted alongside** (`baseline-performance-pine-hills{,-v2}.json`):

| Scenario | Phase 0 avg ms ±CI95 | v1 today | v2 resized | v2 vs v1 |
|---|---|---|---|---|
| idle-interior | 6.76 ±0.13 | 8.40 ±0.00 | 8.33 ±0.00 | −0.8% |
| spin-interior | 9.39 ±0.27 | 10.48 ±1.14 | 9.80 ±0.57 | −6.4% |
| walk-spin-interior | 8.82 ±0.07 | 10.66 ±0.13 | 10.04 ±0.06 | −5.9% |
| entrance-sightline | 9.55 ±0.10 | 9.76 ±1.78 | 8.39 ±0.00 | **−14.0%** |
| broom-sweeping | 4.93 ±0.19 | 8.40 ±0.00 | 8.33 ±0.00 | −0.8% |
| live-speed16-customers | 9.59 ±0.30 | 10.63 ±0.51 | 9.91 ±0.06 | −6.7% |
| laptop-open | 5.73 ±0.20 | 8.55 ±0.00 | 8.33 ±0.00 | −2.6% |

**Regressions beyond CI and >10%: NONE — the resized room is faster than v1 on
every scenario**, and the worst frames collapse (1% highs, v1→v2: idle 15.6→8.5 ms,
walk-spin 37.5→26.1, entrance 30.6→14.3, customers 34.7→25.5, laptop-open
23.8→8.5). Scene cost: draw calls 3051→**1791** (−41%), visible meshes 3469→3022.
Measurement caveat, stated rather than hidden: today's HEADED captures pin at the
display's 120 fps cap (the 8.33 ms floors with CI 0.00), while Phase 0's session
ran at a higher refresh — so the absolute Phase 0 deltas on the capped scenarios
are display-mode artifacts; the controlled comparison is the same-session v1↔v2
A/B above, exactly as the §9 plan specified.

**Commits tonight** (all pushed to `feature/pro-shop-vertical-slice`):
`05920d0` v2 boot TDZ fix · `b3379b7` lens/input parity instruments + typed-keys guard ·
`006f88e` nav recovery ladder + block log + harness trust audit · `a5f5ef3` focus cameras
derived from the glass · plus this report and the remaining evidence in the closing
commit. Full suite 2404/2404 green before each.
