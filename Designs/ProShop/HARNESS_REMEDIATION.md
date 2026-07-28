# HARNESS_REMEDIATION.md — the trust-list worked, 2026-07-28

Companion to `HARNESS_TRUST.md` (the audit); this file records what was done
about it, harness by harness: what each measured before, what it measures now,
and whether any previously-green result changes. Worked in trust order,
cheapest first, per the morning ruling.

---

## Previously-green results that change (read this first)

**No committed green has turned red so far.** The specific candidates were
checked rather than assumed:

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
| `laptop-actions.js` | Required the runner to have navigated (sat on about:blank otherwise) | Explicit goto fallback | No |
| `fov-parity.js` | DPR-1 only | + DPR-2 leg via scoped CDP override, verdict `idleDpr2At66` | ⏳ queued — a DPR-2 lens/projection failure would be a NEW red (coverage, not regression) |

## C. New instruments

| File | Claim it adds | Status |
|---|---|---|
| `tests/qa-harness-integrity.test.js` | Rule 8 forever: every live QA file parses the way its runner runs it; every `register.<method>(` exists in live source; `BASE_URL` must be defined; archive loads banned. Negative-verified against `register-sale.js` and `swipeAt`. | **GREEN, in the suite** (2412/2412) |
| `tools/qa/mouse-look-parity.js` | Rule 11: first pointer-locked mouse-look coverage — locked mousemove sweeps vs in-page shipped-math expectations; spike-clamp and relock-guard beats (the 180-spin class) | ⏳ queued; may report `pointer-lock-unavailable` headless — HEADED fallback documented in-file |
| `tools/qa/electron-walk-input.mjs` | Rule 13: first Band-A acceptance in the desktop shell — fresh empire through the real menu, W/A/S/D deltas, pointer-lock engagement | ⏳ queued (runs without the browser QA lock) |
| `tools/qa/proshop-speed-curve.js` | Punch item 3: the wall-clock NPC defect measured (16×/4×/1×, same window, same room) | ⏳ queued after validations |

## D. Remaining (not done this session, in cost order)

- The ~40 remaining perf-family files get the shared gate call individually
  (helper exists; mechanical but wide).
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
| `fov-parity.js` (now 7 checks incl. DPR-2) | ⏳ |
| `walk-input-parity.js` (regression check after courseScene untouched) | ⏳ |
| `mouse-look-parity.js` | ⏳ |
| `simplified-register-card.js` (the re-derived acceptance) | ⏳ |
| Revived: `laptop-tour.js` | ⏳ |
| Revived: `laptop-persist.js` | ⏳ |
| Revived: `register-recover.js` | ⏳ |
| Revived: `delivery-accept.js` | ⏳ |
| `starter-loop-acceptance.js` at 1600×900 | ⏳ |
| `electron-walk-input.mjs` | ⏳ |
| `proshop-greybox-acceptance.js` (re-pitched queue clearances) | ⏳ |
| `proshop-speed-curve.js` | ⏳ |
