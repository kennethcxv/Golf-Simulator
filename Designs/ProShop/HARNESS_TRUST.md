# HARNESS_TRUST.md

**Scope:** every `.js`/`.cjs`/`.mjs` under `tools/qa/` (343 files at audit close).
**Method:** static read-only audit, 2026-07-28. Every file's header read; ~40 read in depth;
classification greps across the directory; a parse-only sweep that constructs every
function-file exactly the way `run-playwright.cjs:66` does; harness-invoked register APIs
cross-checked against `src/render3d/clubhouse/simplifiedRegisterMode.js` exports. No harness
was executed for this audit; the customer-day findings were measured live the same night.

**Consequence already taken:** this audit's "systemic" verdict triggered the overnight
plan's conditional stop — the room resize was designed but NOT built, and no resize
verification numbers were produced, pending your read of this document.

---

## Executive summary

The divergence is **systemic in three named classes, not one-off**.

1. **Environment class** — all 306 browser harnesses run headless Chrome at pinned
   1600×900/DPR-1 against the dev server, with no GPU flags through the shared runner:
   unless `HEADED=1`, WebGL is SwiftShader, and no harness *gates* on the renderer string
   (perf-probe records it, nothing fails on it). Pointer-lock mouse-look, native DPR,
   window focus/blur, and the Electron `file://` build are exercised by **zero** committed
   harnesses beyond a menu-level smoke.
2. **Drive-mechanism class** — the house pattern is "teleport + sim-API fixture, then
   real-input assertion beat"; the best files (fov-parity, greybox-checkout, the
   cleaning/carton acceptances) genuinely earn their green through the real event pipeline,
   but day/journey harnesses run at 16× or teleport the clock outright, so *time-continuous*
   live behaviour (patience, rollover, night, nav churn) is measured through instruments too
   coarse for their claims — `proshop-greybox-customer-day.js` was the proven case (since
   rebuilt, see detail).
3. **Maintenance-drift class** — register API churn (swipe→insert, `getHandFeedback`
   removed) left **14 committed harnesses dead or false-red**: one does not parse
   (`register-sale.js`), nine reference a `BASE_URL` global no committed runner defines,
   five call `register.swipeAt()` which no longer exists in `src/`, and
   `simplified-register-acceptance.mjs` pins `lastRead.mode === 'direct-to-bag'` which the
   shipped register has never emitted in its current form. Their green *history* in `qa/`
   evidence folders is unreproducible archaeology.

Verdict: trust the browser-build greens of the Band-A harnesses; treat every performance
number produced headless as non-live; treat every "full day / zero stuck" claim from the
old watchdog as unproven; and treat the live desktop build as essentially uninstrumented.

> **Remediation status (2026-07-28 afternoon, user-authorized):** the
> maintenance-drift class is CLOSED — 11 files archived with named successors,
> 8 revived, the false-red pins re-derived, and the rule-8 parse/API sweep is a
> committed suite test (`tests/qa-harness-integrity.test.js`), so this class
> cannot silently recur. Rule-5 renderer gates guard the flagship perf files
> (shared helper `perf-renderer-gate.mjs`; family-wide wiring remains). Rules
> 11 and 13 have their first instruments (`mouse-look-parity.js`,
> `electron-walk-input.mjs`). Per-harness before/after and the green→red
> analysis live in `HARNESS_REMEDIATION.md`.

---

## Trust grades

| Grade | Meaning |
|---|---|
| **HIGH** | Green ≈ the claimed thing works in the live *browser* build. Real-input assertion beat, condition-based waits, contract matches shipped code. Residual gap to the desktop build is the shared environment class only. |
| **MEDIUM** | Green = sim/scene logic works; live interaction, live timing, or live rendering unproven (state-teleport drive, sim-API drive, headless GPU, capture-only output a human must judge). |
| **LOW** | Green can coexist with a live failure of the headline claim (coarse watchdogs, exemptions, retry-to-green, software-GPU perf gates). |
| **FALSE-RED** | Fails good builds: asserts contracts the shipped code no longer (or never) emitted. |
| **DEAD** | Cannot produce any result as committed (SyntaxError, undefined global, removed API). |

---

## Ranked table (most trusted first)

### Band A — HIGH

| Harness | Verifies | Drive | Key divergence risk | Cheapest fix |
|---|---|---|---|---|
| `fov-parity.js` | Boot lens 66 in both variants via **projection matrix** (render truth), laptop cycle restores lens on both exits, stored pref reaches lens | Real E/Escape; projected clicks with settle-guard + verified exit + 3× retry | DPR-1 only; pointer lock not engaged | Add one leg at deviceScaleFactor 2 |
| `walk-input-parity.js` | W/A/S/D through **real keydown/keyup** produce correct movement vectors, both rooms | Teleport to stands, then real keys | Mouse-look untouched; pointer lock untouched | Companion probe: pointer-locked `mouse.move` deltas → yaw/pitch assertion |
| `proshop-greybox-checkout.js` | Full V2 card sale: per-item scanned+bagged flags, flow states, digit-keyed exact total, cash/ledger/units/shelf/history deltas | `sendToCounter` fixture (a shipped diagnostic), then real E + real clicks at 3D-projected item points with settle loop | Customer *arrival* skipped; clock pinned 2 PM, organic walk-ins off | None needed for its claim; pair with natural-checkout for arrival |
| `register-acceptance-driver.mjs` (+ card/cash wrappers) | Strict scan→insert→receipt→bag→handoff choreography with physical-evidence asserts (`scanHit`, `facingDot ≤ -0.35`) — **all asserted fields exist in live code** | Real clicks/keys after `sendToCounter` fixture | Gate description in `run-integration-gates.mjs:79` still says "mouse card swipe" — text drift only | Fix the gate description |
| `laptop-actions.js`, `laptop-cycle.js` | Money paths through the glass (order charges wallet once, slider changes real price, survives reload); 30× sit/stand leak count | Real mouse on projected DOM **with settle-guard** | `laptop-actions` never navigates — requires `--bootstrap` | Add explicit goto fallback |
| Cleaning/restoration acceptances (`cleaning-tools-acceptance.js`, `cleaning-gameplay-acceptance.js`, `pressure-washer-acceptance.js`, `structural-work-acceptance.js`, `pine-hills-restoration-lights-acceptance.js`, `pine-hills-starter-stock-cooler-acceptance.js`, `shed-cleaning-acceptance.js`, probes) | Tools do the thing **to the simulation**, occlusion, attribution, persistence mid-clean | F/mouse-hold/E through real events; documented fixtures | Aim is synthesized sweeps, not pointer-locked mouse | None urgent; these are the model |
| Carton/stocking lifecycle (~19 files: delivery loop/eta/equipment/pallet, box lifecycles, save-reloads, sheet03/06 acceptances, props-71-100) | Cut/open/take/carry/stock through hold-E/tap-E; collision/door via real keys; game's own autosave + reload | Fixture teleports + real input beats | Time pinned; single-carton fixtures | None urgent |
| Campaign/progression (`starter-loop-acceptance.js`, progression-office/cleanup, `input-abuse-acceptance.js`, save-recovery + save fingerprints incl. `proshop-greybox-save-roundtrip.js`) | Fresh-game menu → verbs → objective arc; exactly-once under input spam; field-by-field save fingerprints across rooms | Real menu clicks, real keys; `localStorage.clear()` boots | `starter-loop` runs 1280×720 — different aspect than the 1600×900 standard | Unify viewport |
| Course editor/world (~14 files) | Player-facing editor tools, undo/redo, shader compile gate, lazy-load boundaries | Visible controls, J/E keys, real drags | Secondary server ports some scripts pin | None urgent |
| Golf loop (`golf-gameplay-normal.cjs`, carts driving/production, shop progression, live laptop order) | End-to-end play with `__fw` as observation only | Real keys, projected laptop, speed keys | Own launchers | — |
| Boot/smoke (10 files) | Boots clean, console clean | Continue button, error listeners | Tiny claims — high trust *because* small | — |
| Node-only static tools (36 files: GLB audits, manifest validators, economy evidence, contracts) | File/data/manifest claims; sim-logic soaks importing `src/sim` directly | Pure Node, no browser | **Their claims are not runtime claims** — a perfect GLB can still render wrong | Keep paired with a runtime probe |
| Infra (`run-playwright.cjs`, lock, gates, `electron-smoke.mjs`, `run-electron-saves.mjs`) | Runner, lock, gate orchestration; **the only two desktop-build instruments** | — | electron-smoke stops at the main menu | Port one Band-A acceptance to Electron |

### Band B — MEDIUM

| Harness | Verifies | Key divergence risk | Cheapest fix |
|---|---|---|---|
| `perf-probe.js` | Frame pacing per scenario, bake-attributed spikes, A/B toggles, 16× live worst case | Headless→SwiftShader numbers accepted silently; GPU string recorded but not gated; spin is direct `walk.state.yaw` writes; DPR 1 | 5 lines: fail (or tag) when `gpu` matches SwiftShader and `HEADED!=='1'` |
| Perf family (~45 files: locked-performance, scenario master, baselines, leak/stress probes, GTAO/spike probes) | Relative A/B and leak/stability claims — valid; absolute FPS claims — not live | Same headless/SwiftShader hole; thresholds tuned on QA hardware | Same renderer-string gate everywhere; one shared helper |
| Sim-API functional (~30 files: customer-simulation, economy, integration, inventory, management, player-experience) | Sim outcomes, scene-vs-sim reconciliation, UI reachability | Seeded/organic RNG divergence by design (`player-experience-*` replaces `Math.random` with an LCG); `golf-operations-journey.cjs` **teleports the clock** then ticks once — nothing between beats ever happens | Journey harness: run the clock at speed instead of setting it |
| Geometry/scene measurement (`proshop-greybox-acceptance.js`, texel/texture probes, part-visibility, screen-time, census, residency, `focus-framing-probe.js`) | What's in the graph/frame, measured | A scene-graph probe measures geometry that never draws (batching gotcha — greybox-acceptance handles `layers.mask===0` correctly); capture ≠ perception | Keep the layer-mask discipline; pair with screenshots |
| Visual-capture / diagnostics (~100 files; human judges; green = "captured") — includes the register-family flow acceptances that assert live fields (`lastRead.ok`), queue/matrix/save-reload | Fixed-pose evidence; flows | SwiftShader colours/AO in unheaded captures can differ from live GPU output | Capture HEADED for anything colour-critical |

### Band C — LOW

| Harness | Why green can coexist with live failure | Cheapest fix |
|---|---|---|
| `pro-shop-natural-checkout.mjs` | The one fully-organic route (real GPU via `--use-angle=d3d11`) — **but** it retries up to 8 attempts and `passed` = each payment mode succeeded *at least once*. A route failing 7-in-8 for live players exits green. | Gate on first-attempt success or assert pass-rate; the `attempts` array is already recorded — enforce it |
| Software-GPU perf gates (`customer-simulation-performance.mjs`, `golf-operations-performance.cjs`, `golf-operations-laptop-idle.cjs` — all pin `--use-angle=swiftshader`) | Absolute frame numbers from a CPU rasterizer | Re-tag as relative-only, or add a hardware leg |
| `register-swipe-before.js` | Baseline of a superseded UX; the register it describes no longer ships | Archive |
| `stock-shop.js` | Explicitly an art aid; mutates inventory | Keep, never cite as QA |
| `proshop-greybox-customer-day.js` **(as originally committed)** | See detail below — the confirmed misleading instrument. **Rebuilt 2026-07-28** to the rule-3 spec: sim-second thresholds, net-displacement windows, no exemptions, `stillInsideAtClose` in `ok`, game's own nav-block log as primary source. | Done — the rebuild is in the tree |

### Band D — FALSE-RED (fails good builds)

| Harness | Pinned contract | Live reality |
|---|---|---|
| `simplified-register-acceptance.mjs` + wrappers `simplified-register-card.js`, `simplified-register-cash.js` | `read.mode === 'direct-to-bag' && read.code === 'bagged'` (L270-272) | `lastScanEvidence` (`simplifiedRegisterMode.js:4023-4040`) has **no `mode` field**, and `'direct-to-bag'` appears nowhere in `src/`. Fails identically in both rooms, so it cannot gate anything. `proshop-greybox-checkout.js` documents this and asserts the live contracts instead. |

**Fix:** delete the two stale asserts or re-derive them from the live evidence shape; the rest of the file's route is sound.

> **DONE 2026-07-28:** re-derived to the live contract (`{ ok, code: 'ok',
> scanHit }` per `src/sim/barcode.js`); bagged-ness stays asserted via the
> transaction item flags. Expected red→green — see HARNESS_REMEDIATION.md §E.

### Band E — DEAD (cannot run as committed)

| Harness | Cause |
|---|---|
| `register-sale.js` | **SyntaxError**: `const money` declared twice (L66, L82); undefined `BASE_URL` (L120); calls removed `register.getHandFeedback()` (L46). The only file that fails `Function()` construction. |
| `customer-simulation-checkout.mjs` | `eval`s `register-sale.js` → inherits the SyntaxError; the checkout integration gate crashes before reporting |
| `register-swipe.js`, `register-recovery-driver.mjs` (+wrapper), `register-performance.js`, `pine-hills-joined-tee-card-acceptance.mjs` (+wrapper) | `register.swipeAt()` — zero matches in `src/`; the physical swipe was replaced by insert (`insertAt`) |
| `laptop-tour.js`, `laptop-look.js`, `laptop-persist.js`, `register-recover.js`, `delivery-accept.js`, `delivery-boxes-visual.js`, `delivery-shelves.js`, `shoot-clubhouse.js` | `page.goto(BASE_URL)` with `BASE_URL` never defined by any committed runner — MCP-REPL-era scripts; their `qa/` evidence cannot be regenerated |

**Fix (one afternoon, mechanical):** (a) `BASE_URL` → `process.env.QA_BASE_URL || 'http://localhost:8457/'` in the nine files; (b) fix/port or archive the swipe family; (c) commit the parse sweep as a test — `Function()`-construct every function-file, `node --check` every module; (d) an API-surface lint: every `register.<method>(` in `tools/qa` must exist in the live export object.

> **DONE 2026-07-28, all four** — plus three transitively-dead loaders of
> `register-sale.js` this table missed (`pro-shop-checkout.mjs`,
> `player-experience-checkout-baseline.mjs`, `record-core-production-gameplay.js`'s
> checkout leg), found by reference-tracing before the moves. The swipe family
> and the parse-dead chain are archived under `tools/qa/archive/` with named
> successors; the eight BASE_URL scripts are revived in place; the sweep is
> `tests/qa-harness-integrity.test.js` (parse + register-API lint + BASE_URL
> rule + archive-load ban, negative-verified). Ledger: HARNESS_REMEDIATION.md.

---

## Detail: the harness that started this

### `proshop-greybox-customer-day.js` (as originally committed) — LOW, actively misleading

**Claim:** "customer navigation across a full simulated day, both restoration states, with a
stuck-NPC watchdog" → headline "zero stuck NPCs."
**What it actually measured:**

- `STUCK_LIMIT_S = 75` **wall**-seconds in one (progress, position) tuple at `speedIdx 3`
  (16×) — a customer had to stand frozen **20 sim-minutes** to count as stuck. Live
  perception is seconds.
- The identity key rounded position to a **0.5-yd grid** — an NPC oscillating between two
  cells (the classic stuck-loop signature) reset its timer forever.
- Any customer in `checkoutQueue` or `awaitingCheckout` was exempted **and its record
  deleted** — an undrained queue was invisible.
- The sampler was a 500 ms in-page timer — 8 sim-minutes between samples under load.
- `stillInsideAtClose` was *reported* but **not asserted** — customers trapped inside at
  close still produced a green.
- Population was `debugSpawn(false)` ×10 — scripted spawns, not the organic walk-in cadence.

It *did* catch fully-frozen NPCs overnight (both runs came back red, matching the live
sighting) — the instrument was real, its resolution was not. The honest summary of the
"zero stuck NPCs" plan line: **the check ran, it failed, and the failure agreed with the
live game.** The reporting failure was latency (results landed after the status report),
not a false green.

**The rebuild (in tree as of 2026-07-28):** freeze = net displacement < 0.15 yd across 20
consecutive **sim**-seconds (oscillation counts); queue advancement bounded at 25
sim-minutes with no exemptions; `stillInsideAtClose === 0` asserted in `ok`; primary
evidence is the game's own nav-block log (`clubhouse.navBlockDiagnostics()` — the same
escalation events the live build logs and console-warns); screenshots at each close.

---

## Detail: shared infrastructure and the environment gap

**`run-playwright.cjs`** — real Chrome channel, ephemeral context, viewport 1600×900 at
`deviceScaleFactor: 1`, headless unless `HEADED=1`, **no GPU args** → headless runs render
on SwiftShader. `--bootstrap` writes `golfempire:autosave` (seeded empire 424242,
willow-creek, tutorial off). `ok:false` results correctly fail the process. The run lock
serializes runs repo-wide. **localStorage bleed is profile-scoped:** ephemeral contexts die
clean, but `QA_PERSISTENT_PROFILE` (or any human-shared profile) inherits QA saves — nearly
every harness begins `localStorage.clear()` + seeded-save write. Never run QA in a profile
a human plays in.

**Named environment divergences no green can currently speak to:** pointer-lock mouse-look
(every harness either writes `walk.state.yaw` directly or turns with arrow keys — **no
committed harness moves the camera with pointer-locked mouse deltas**, the exact path of
the live 180-spin bug class); native DPR > 1; window focus/blur and background-tab
throttling; texture residency over Electron `file://` vs dev-server HTTP; organic RNG
(fixtures are seeded everywhere); time-of-day (fixtures pin 9 AM/10 AM/2 PM at `speedIdx 0`
— dawn/night lighting, shadow refit across sun angles, and the day-rollover autosave run
only in the 16×/teleport harnesses).

**The desktop build has two instruments total.** `electron-smoke.mjs` launches the real
Electron binary and asserts **main menu only**. `run-electron-saves.mjs` delegates
persistence asserts. Nothing ever walks, cleans, or sells in the shipped shell. Every
"live build works" claim currently rests on browser-build evidence plus these two smokes.

**Click-projection contract:** the laptop/register UI is DOM projected onto the 3D screen;
clicks at `getBoundingClientRect` coordinates die silently mid-ease (measured live tonight:
`elementFromPoint` at a projected button's rect returns CANVAS). The settle-guard pattern
(wait until the frame rect stops moving → click → **verify the click landed** → retry ≤ 3)
is present in the good harnesses and absent in some older glass-clickers.

---

## Standing rules for any future harness

1. **Never sleep for state.** Wait on a sim condition. A fixed timeout around animation is a bug.
2. **Projected-DOM clicks:** settle-guard → click → verify the intended effect landed → retry ≤ 3. No exceptions.
3. **Watchdog resolution must match the perceptual claim.** Thresholds in **sim-seconds** at ≤ the player-visible tolerance (~10-20 sim-s for "stuck"); position keys at ≤ 0.1 yd with a net-displacement check so oscillation counts; **no state-class exemptions** unless a named companion harness owns the exempted class; every reported field that backs the headline claim must be asserted in `ok`.
4. **Fixture may teleport; the assertion beat may not.** Direct `walk.state`/clock/inventory writes are legal only before the measured beat, and the header must say so.
5. **Performance greens must gate the renderer string.** Fail (or hard-tag) SwiftShader results unless the harness is declared software-relative. Absolute FPS from headless-default runs is not evidence.
6. **No pinned contract strings.** Assert against fields the live code demonstrably emits (probe first) or import the constant from `src/`. The `direct-to-bag` drift is what pinning costs.
7. **Retry-to-green must surface the flake rate in the exit contract.**
8. **Commit the parse/API sweep** so a parse-dead harness can never sit in the tree again. *(DONE 2026-07-28: `tests/qa-harness-integrity.test.js`.)*
9. **One organic route per loop** — seeded fixtures for determinism, but each gameplay loop keeps at least one unseeded, no-`sendToCounter`, no-`debugSpawn` route.
10. **localStorage hygiene:** ephemeral contexts by default; snapshot/restore any persistent profile; never run QA in a profile a human plays in.
11. **Pointer-lock mouse-look needs its first instrument** before any mouse-look regression is called "covered." *(First instrument 2026-07-28: `mouse-look-parity.js`.)*
12. **Run the clock, don't set it,** in any harness whose claim spans time.
13. **The desktop build is not the browser build.** Until at least one Band-A acceptance runs inside Electron, phrase every green as "works in the browser build" — because that is all it proves. *(First shell acceptance 2026-07-28: `electron-walk-input.mjs`.)*
