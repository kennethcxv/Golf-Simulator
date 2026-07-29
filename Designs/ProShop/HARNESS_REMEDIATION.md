# HARNESS_REMEDIATION.md — the trust-list worked, 2026-07-28

Companion to `HARNESS_TRUST.md` (the audit); this file records what was done
about it, harness by harness: what each measured before, what it measures now,
and whether any previously-green result changes. Worked in trust order,
cheapest first, per the morning ruling.

---

## Previously-green results that change (read this first)

**Final accounting: no committed green turned red.** Every candidate was
checked against evidence rather than assumed, and the big flip ran the OTHER
way — the register acceptance was failing every good build on four stacked
false layers and is now GREEN against the live contract. What the session DID
surface is a wide class of harnesses whose greens were *historical*: the
fresh-game menu route (29 files), the laptop's moved seat and re-homed IA, a
removed clubhouse API, and a pre-move register stand — none currently green,
all previously credited. The specific checks:

1. **`pro-shop-natural-checkout.mjs`** — the new rule-7 flake gate (accepted
   mode must land within 2 attempts) was run against the committed historical
   evidence (`qa/pro-shop-overhaul/natural-checkout-acceptance/summary.json`):
   cash accepted on attempt 1, card on attempt 2 — **the historical green
   survives** the new gate exactly.
2. **`locked-performance-acceptance.js`** — now REFUSES to produce numbers on
   SwiftShader. No committed evidence JSON from a headless run exists under
   `qa/`, so no past green is reclassified; the change is prospective: the
   headless invocation path that would previously pass quietly now exits red
   by design.
3. **One flip in the opposite direction:** `simplified-register-acceptance.mjs`
   was FALSE-RED (failed every good build on pins the register never emitted).
   Re-derived from the live evidence shape — expected to go red→green;
   validated in the ledger below.

Rows still marked ⏳ in the ledger can still produce flips — this section is
final only when the ledger has no ⏳ left.

Also noted, not a flip: `qa/cash-register-production/acceptance/card/latest-result.json`
records a SwiftShader renderer string inside a FUNCTIONAL acceptance green.
Functional claims on software GL remain valid (the rule-5 gate scopes
performance numbers); this is the environment class, tracked in
HARNESS_TRUST.md, not a remediation failure.

---

## A. Archived (11 files → `tools/qa/archive/`, README documents each)

| File | Measured before (claimed) | Now | Previously-green change? |
|---|---|---|---|
| `register-sale.js` | Full physical sale, both tenders | Archived — **never parsed as committed** (SyntaxError) | Its `qa/` greens predate the drift; unreproducible then and now — no change |
| `customer-simulation-checkout.mjs` | Checkout integration gate (video) | Archived — eval'd the parse-dead file; committed gates already run checkout via `register-acceptance-{card,cash}.js` | No — the gate path that actually runs is untouched |
| `pro-shop-checkout.mjs` | Overhaul-era checkout scenarios | Archived — imports the dead file at module top level | No — dead since the register API churn |
| `player-experience-checkout-baseline.mjs` | Seeded checkout replay baseline | Archived — loads the dead file (a loader the audit missed) | No |
| `record-… (see §B)` | | | |
| `register-swipe.js` | Physical card SWIPE choreography | Archived — `register.swipeAt()` no longer exists; insert-era claim covered by `register-acceptance-card.js` | No |
| `register-swipe-before.js` | Baseline capture of the swipe UX | Archived — historical capture of a removed UX | No |
| `register-performance.js` | Swipe-era matched checkout perf | Archived — successor `simplified-register-performance.mjs` | No |
| `register-recovery-driver.mjs` (+ `register-recovery.js` wrapper) | Recovery choreography via swipe | Archived — successors `simplified-register-recovery-accessibility.mjs`, `simplified-register-save-reload.mjs` | Suite test `cashier-build-provenance-drivers.test.js` updated to follow the move (design change, documented in-file) |
| `pine-hills-joined-tee-card-acceptance.mjs` (+ wrapper) | Joined tee-time + card on swipe register | Archived — successor `simplified-reservation-card-acceptance.mjs` | No |

Three of the archived files (`pro-shop-checkout`, `player-experience-checkout-baseline`,
plus wrapper `pine-hills-joined-tee-card.js`) were **transitively dead loaders the
audit's count of 14 missed** — found by tracing references before moving files.

## B. Fixed in place

| File | Before | After | Green change? |
|---|---|---|---|
| `laptop-tour.js`, `laptop-look.js`, `laptop-persist.js`, `register-recover.js`, `delivery-accept.js`, `delivery-boxes-visual.js`, `delivery-shelves.js`, `shoot-clubhouse.js` | DEAD: `BASE_URL` never defined (MCP-REPL era) — could not produce any result | Revived: `BASE_URL = QA_BASE_URL \|\| :8457`; claims unchanged (projected-click page tour, laptop persistence, save-during-transaction, delivery round-trips, shelf visual count, art shots) | ⏳ validation runs queued behind the day run — stale in-file pins (e.g. laptop-tour's old sidebar labels) may surface as reds and will be judged per file |
| `simplified-register-acceptance.mjs` (+ card/cash wrappers) | FALSE-RED: pinned `read.mode === 'direct-to-bag' && read.code === 'bagged'` — fields the shipped register never emitted; failed every good build | Asserts the live contract: `{ ok, code: 'ok', scanHit }` from `src/sim/barcode.js`; bagged-ness already physically asserted via the transaction item flags | ⏳ expected red→green; run queued |
| `record-core-production-gameplay.js` | Checkout leg eval'd the parse-dead `register-sale.js` — the recording died at that section | Checkout leg repointed to `register-acceptance-card.js` (same claim, insert era) | ⏳ long video run; queued behind higher-value validations |
| `run-integration-gates.mjs:79` | Gate description said "mouse card swipe" | Says "mouse card insert" — text drift only | No |
| `perf-probe.js` | Recorded the GPU string; SwiftShader numbers passed silently | Refuses software GL via the shared gate; result carries `softwareRenderer` | No committed headless greens found |
| `resolution-fov-performance.js` (integration gate), `locked-performance-acceptance.js`, `proshop-baseline-performance.js` | Same silent-SwiftShader hole | Same gate; result carries `rendererGate` | See flip section item 2 |
| `customer-simulation-performance.mjs`, `golf-operations-performance.cjs`, `golf-operations-laptop-idle.cjs` | Pinned SwiftShader by design but results looked like live numbers | Results declare `softwareRelativeOnly: true` + header note | No — reclassification only |
| `pro-shop-natural-checkout.mjs` | `passed` = each mode succeeded ≥1 time in ≤8 attempts (a 7-fail route exited green) | Each accepted mode must land within `NATURAL_ACCEPT_WITHIN` (2) attempts; `flaky` list in summary and stdout | **No** — historical evidence re-checked: cash 1, card 2 |
| `starter-loop-acceptance.js` | Ran at 1280×720 — the lone viewport outlier | 1600×900 QA standard; centre click follows | ⏳ queued |
| `laptop-actions.js` | Required the runner to have navigated (sat on about:blank otherwise); office stand; retired desk labels; `Place order` label drift (live: `Place Order`) | Explicit goto fallback + live-laptop stand with north retry (shared `openLaptop` too) + Pro Shop tabs + label fix → **GREEN end to end** (order charged exactly once, sliders write the sim, save/reload survives, three viewports) | No — its old green predates the drift; the revived green is current |
| `fov-parity.js` | DPR-1 only | + DPR-2 leg via scoped CDP override, verdict `idleDpr2At66` | ⏳ queued — a DPR-2 lens/projection failure would be a NEW red (coverage, not regression) |

## C. New instruments

| File | Claim it adds | Status |
|---|---|---|
| `tests/qa-harness-integrity.test.js` | Rule 8 forever: every live QA file parses the way its runner runs it; every `register.<method>(` exists in live source; `BASE_URL` must be defined; archive loads banned. Negative-verified against `register-sale.js` and `swipeAt`. | **GREEN, in the suite** (2412/2412) |
| `tools/qa/mouse-look-parity.js` | Rule 11: first pointer-locked mouse-look coverage — locked mousemove sweeps vs in-page shipped-math expectations; spike-clamp and relock-guard beats (the 180-spin class) | ⏳ queued; may report `pointer-lock-unavailable` headless — HEADED fallback documented in-file |
| `tools/qa/electron-walk-input.mjs` | Rule 13: first Band-A acceptance in the desktop shell — fresh empire through the real menu, W/A/S/D deltas, pointer-lock engagement | ⏳ queued (runs without the browser QA lock) |
| `tools/qa/proshop-speed-curve.js` | Punch item 3: the wall-clock NPC defect measured (16×/4×/1×, same window, same room) | ⏳ queued after validations |

## F. Concurrency taint disclosure (QA-LOCK-001) — which numbers were re-run

Two "stopped" chains kept running (kills don't kill trees on Windows) and the
run lock failed to serialize at least one window — full evidence in
`DEFECTS.md` QA-LOCK-001. Every affected number was re-measured exclusively in
the final chain rather than argued about:

- **`greybox-customer-day-requeue2.json` counts** (frozen/blocks): its restored
  leg overlapped an orphan chain's speed-curve legs — freeze/churn counts are
  contention-shadowed. Its GEOMETRIC findings (walkers inside the staff
  corridor, the west shove-channel decode) are position facts and stand.
  Authoritative sealed-room day = `requeue3` (final chain).
- **`speed-curve.json` as first committed** (chain-1's orphan run): x16/x4 legs
  overlapped the day re-run, and the whole run predates the west seal —
  superseded wholesale by the final chain's exclusive re-run.
- Chain-2 functional greens taken in overlap windows (acceptance raycasts,
  fov-parity, walk-input) are geometry/lens facts with wide margins — kept,
  noted.
- The "New Empire" menu-route class: 29 files matched; the five in today's
  validation set are fixed (starter-loop already carried the modern flow — the
  canonical pattern to copy); the remaining ~24 are the same mechanical fix and
  stay listed as remaining work below.

## D. Remaining (not done this session, in cost order)

- The ~40 remaining perf-family files get the shared gate call individually
  (helper exists; mechanical but wide).
- The ~24 remaining "New Empire" fresh-game boots move to the modern menu flow
  (New game → difficulty card → confirm; copy starter-loop's block).
- QA-LOCK-001 hardening after a dedicated repro (rules 14–15 mitigate now).
- `golf-operations-journey.cjs`: run the clock at speed instead of teleporting
  it (rule 12) — a behavioural rewrite, not a patch.
- Electron coverage beyond walk-input (cleaning, selling).
- `integration-seven-inventory.mjs` still lists `tools/qa/register-sale.js` in
  its historical conflict map (inert data, load-checked by the sweep as safe).

## E. Validation ledger

Filled in as the queued runs complete (browser QA serializes on the run lock;
the customer-day re-run holds it as of this writing).

| Run | Result |
|---|---|
| `fov-parity.js` (now 7 checks incl. DPR-2) | **GREEN 7/7** — the DPR-2 leg passes: lens 66 and the projection hold at deviceScaleFactor 2 |
| `walk-input-parity.js` | First run RED — **stale probe fixture, not a regression**: the resize seated the feature table 0.40 yd north of the v2 stand and W read dead. Stand moved (0.5, 0.5)→(0.5, 1.7) → **GREEN 8/8** on the re-run |
| `mouse-look-parity.js` | Headless AND background-headed both refuse pointer lock (`requestPointerLock` needs a **focused** document) — the instrument correctly reports `pointer-lock-unavailable` instead of faking a green. Fixed with `page.bringToFront()` before engaging; re-run ⏳ chain 3 |
| `simplified-register-card.js` (the re-derived acceptance) | **GREEN — the red→green flip is complete.** FOUR false layers peeled: (1) `mode 'direct-to-bag'`/`code 'bagged'` never emitted; (2) `presentation.phase 'bagging'` belongs to the transaction-stage machine — live scan-motion runs `pickup→scan-approach→scan-hold→scan-exit→bag`; (3) structural: the one-click redesign flips `bagged` at motion COMPLETION, so the flags-first wait always outlived the animation — restructured flight-first; (4) provenance: stale PNGs from the old filenames tripped the every-PNG-referenced gate — evidence root wiped. Full route green with all three scans `{ok, code:'ok'}` and business deltas exact |
| Revived: `laptop-tour.js` / `laptop-persist.js` / `laptop-look.js` | Revival exposed two more drift layers: all three stood at the OFFICE desk (8.45, 4.5) — the laptop moved to the front desk — and tour/persist drove retired sidebar desks (Tee Times/Shop/Finances/Pricing/Supplier/Orders → live Bookings/Pro Shop/Business + Pro Shop tabs). All three re-derive the stand from the live layout and drive the live IA → **all three GREEN** (look 16:41, tour 16:08, persist 16:09) |
| Revived: `delivery-accept.js` / `delivery-boxes-visual.js` / `delivery-shelves.js` / `shoot-clubhouse.js` | delivery-accept needed the live stand + Pro Shop tabs (its layer 2) → **GREEN**; the other three **GREEN** first try |
| `register-recover.js` | **Archived after an honest six-layer excavation** (BASE_URL → menu route → property market → stale world offset → pre-move desk stand → drag-to-scan choreography the one-click register no longer has). The stopping rule: its claim — mid-transaction save survives reload with the books intact — is already GREEN against the live contract in the integration `save-reload` gate (`simplified-register-save-reload.js` + the matrix test). Porting a superseded harness through a rebuilt UX is not remediation; the successor is named in the archive README |
| The "New Empire" fresh-game route class | **29 files** still reference the removed menu button — found because the revived files actually ran. Five fixed today (register-recover, electron-walk-input, laptop-actions, laptop-tour, record-core); `starter-loop` already carried the modern flow and is the canonical pattern; ~24 remain (§D) |
| `starter-loop-acceptance.js` at 1600×900 | **GREEN** |
| `electron-walk-input.mjs` | **GREEN — rule 13's first desktop-shell Band-A acceptance is whole**: fresh empire through the real menu, pointer lock engages in the shell, W/A/S/D all move on the correct axes (~2.07 yd each). Two instrument lessons en route: the fresh-campaign guide overlay swallows walk keys (dismiss it), and Escape opens the pause menu — sweep under the held lock, never "unlock first" |
| `mouse-look-parity.js` (HEADED) | **GREEN — rule 11's instrument is whole.** Both variants: lock engages (bringToFront + retries), every measurement matches the shipped math exactly (yaw −0.840 vs −0.840, pitch −0.475, spike clamped at the 140-px limit), and the relock beat goes through the REAL resume path (Escape opens the pause menu; a second Escape resumes and main.js re-locks — the exact alt-tab flow the 180-spin guard exists for, now measured swallowing a 600-px event to zero) |
| `proshop-greybox-acceptance.js` | **GREEN ×3**: re-pitched queue, then east-sealed, then fully-sealed room incl. `GREY_CorridorSeal` + both west fillets in the grey contract |
| `proshop-greybox-customer-day.js` | Three-run arc: requeue proved the ruled class dead AND caught the corridor leak; requeue2 (counts contention-tainted, geometry valid) decoded the west shove-channel; **requeue3 (exclusive, fully sealed): corridor customer-free, 0 west targets, 0 queue violations, blocks 455→173 / 380→61, still-inside = the designed counter-waiters (2/1)**. Residual red = 12-s recovering crowd-churn moments (member-stand adjacency, west-aisle crossings, leavers threading the head) — a design-acceptability call left to the user |
| `proshop-speed-curve.js` | ⏳ chain 3 final step (exclusive, sealed room); the orphan chain-1 run is superseded (§F) but previewed the shape: visits completed in 60 game-min = 0/10 at 16×, 0/10 at 4×, 11/12 at 1× |
