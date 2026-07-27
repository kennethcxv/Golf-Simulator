# Overnight recovery report — 2026-07-23 session

## MORNING SESSION ADDENDUM (post-review, Kenneth's House Flipper direction)

**FINAL VERDICT (12:5x): the §34 vertical slice passes end-to-end, `ok: true`,
in one continuous fresh-save playthrough** — dilapidated arrival through
cleaning, all eight structural repairs, stocking, the real porch-sign opening,
a fully physical three-product card sale banked exactly once with its gameplay
review, and a real autosave + reload with every state intact. Evidence:
`qa/recovery-2026-07-22/starter-loop-p1/` (result JSON + screenshot sequence).


Kenneth's live review was correct: the overnight work was systems-true but the
fresh game LOOKED unchanged. Root causes found and fixed in sequence:

1. **Dilapidated start** — `seedFreshCampaignWorld` pre-restored all seven
   architecture components (furnished-start design); new games now begin with
   every component broken, `componentRepairProgress` zeroed, opening blocked on
   `Structural damage repaired (0/8)`, each repair gated behind cleaning its
   area, and a visible `structural-repairs` objective guiding the chain.
   Existing saves keep the furnished migration untouched
   (`tests/campaign-dilapidated-start.test.js`, 4/4; campaign suites updated to
   run the real two-stage repair verb).
2. **Pine Hills presentation** — every property silently rendered the clean
   `modern-public` building, which actively suppresses the damage-capable
   sheet06 assets. The starter listing now selects a new `pine-hills` variant
   (marketplace archetype → `initPropertyState` → renderer selector), so new
   games boot into the authored boarded-up dilapidated building. Live proof:
   `qa/recovery-2026-07-22/dilapidated-start/`.
3. **CLEAN-SCUFF-001 root-caused and fixed** — the floor-cleaning gate refused
   tool contact against architecture and inside fixture footprints, making
   wall scuffs/corner cobwebs unreachable (campaign-blocking). `cleanWithTool`
   now forwards contact to the discrete-target map BEFORE the gate, one
   forward site for every tool class (58/58 cleaning suites; loop-driver
   validation in flight).
4. **§6 Blender pass, first round** (through the parametric sheet06 builder,
   all gates green — 31/31 asset tests, clean reimport 10/10):
   entrance leaves repainted deep golf green per the Course-1 reference
   (asset 053); asset 052's roof-mold patches clamped inside the shell span
   (fixed the failing reimport dimension check inherited from the parallel
   session); asset 051 gains eave gutter runs ending on the downspouts and
   warm-glow craftsman lanterns at the authored entrance light sockets.
5. **Branding audit (§15)** — laptop is GOLF SIMULATOR per its final skin;
   FAIRWAY STATE survives only in internal comment headers (left per the
   technical-risk rule); "Prime Fairways" appears once as the studio byline in
   credits, matching the package author. OPEN QUESTION for Kenneth: the spec
   titles the game **Golf Flipper** while the shipped product brand is
   **GOLF EMPIRE** (menu logo, window title, credits mark) — a deliberate
   one-word decision away from a mechanical rename sweep.



Continuation of the recovery begun 2026-07-22 (audit, checkpoints, and plan in
`docs/GOLF_FLIPPER_MASTER_RECOVERY_SPEC.md` + `docs/GOLF_FLIPPER_OVERNIGHT_EXECUTION.md`;
safety branch `checkpoint/pre-recovery-2026-07-22`).

## Commits this session (chronological)

| Commit | What | Verification |
| --- | --- | --- |
| `0ac9a77` | docs: the two source-of-truth recovery documents (staged by Kenneth) | n/a |
| `12837c4` | **CHECKOUT-001 (P0) fixed** — restored the one-click physical scan choreography production had lost to a merge shortcut; ported the strict acceptance driver off three removed contracts (card swipe → automatic insert + keypad exact-amount with deterministic-approval proof; manual receipt/product/bag drags → authored self-delivery with recorded phase trace, `receiptPacked`, `bagAcceptedByCustomer < 0.04`; palm-click change → monitor confirm + hand-free bundle) | Strict card and cash drivers pass end-to-end (`qa/recovery-2026-07-22/checkout-final-card2/`, `.../checkout-final-cash2/`); contract test 4/4; 391/391 targeted; full suite 2279/2279 |
| `fab5941` | Cleanups: deleted dead `summarizeSaveMergeDuplicateA/B`; defect tracker updated (CHECKOUT-001, ASSET-051-100-001, SEC-ELECTRON-001 resolved with evidence); `SESSION_STATE.md` made current; 10 stray root screenshots relocated to gitignored `qa/legacy-root-screenshots/` | 43/43 storage+save tests |
| `3b5eeaf` | **PERF-001 resolved by measurement** — repaired the stale perf-harness boot (menu accessor; player must stand at the live register before the cashier `E`); headed canonical matrix passes outright | 9/9 cases: avg 75.0–102.4 FPS (threshold 30), 1% lows 30.1–40.1 (threshold 12), worst ≤33.4 ms (threshold 100); zero console/page errors (`qa/recovery-2026-07-22/perf/headed-v9/result.json`). Rider: the paired base/candidate *relative* gate was not re-run |
| `18a1e19` | **First-person structural repair + refinish verbs** (spec §9/§10 gameplay gaps) on the existing `restorationAction` owner: hold-E repair with persisted progress and exactly-one-kit consumption at the completion edge (shared `supplyUnits.js`, also adopted by the campaign); tap-E refinish cycling per-component finish enums, paid through the works ledger with per-application idempotency keys; sheet06 visual re-application; two tutorial lessons; two audio cues | 10/10 new unit tests; live in-scene acceptance `tools/qa/structural-work-acceptance.js` (prompt → hold → kit → awards → $60 refinish with exactly one ledger key → real autosave → reload intact, zero errors, `qa/recovery-2026-07-22/structural-work/`); full suite 2289/2289 |
| `ffd1f1d` | **Fresh-start campaign progression fixed** — `campaign.events` had no writer anywhere, so a new Relaxed game could never complete survey/enter and the phase was stuck at `arrival` forever; restored the intended tutorial forwarding and added the porch/threshold tracker in `clubhouse.js update()` | 5/5 new unit tests incl. source pin; live fresh-game starter-loop run completes survey → enter → entrance-trash, phase advances to `repairs`; full suite 2294/2294 |

| `3e8f47c` | **Cleaning-bay disposal was a visible no-op** — the disposal prop's E verbs wrote the legacy `reno.pan`/`reno.bag` mirrors, which `ensureCleaningToolState` rewrites from the structured authority every sync; the toast fired ("Dustpan emptied…" ×10 in the exposing run) while the pan refused to empty. clubhouse.js already imported the authority verbs (`emptyPanIntoBag`/`tieBag`/`disposeTiedBag`) — another half-finished migration, same shape as the orphaned `recordCampaignEvent`. Wired through the authority. | `tests/cleaning-disposal-wiring.test.js` (source pin + authority round trip); 58/58 cleaning suites; live starter-loop run; full suite |

## Defect tracker state

`docs/overnight/known-defects.md`: **zero open blockers** (was: 1×P0 + 3×P1).
All four resolved with dated evidence; P2 advisories unchanged.

## New QA infrastructure

- `tools/qa/structural-work-acceptance.js` — live repair/refinish acceptance incl. real-storage save/reload.
- `tools/qa/starter-loop-acceptance.js` — fresh-game starter vertical slice through player-facing verbs (menu → survey → enter → entrance clutter → *extension in progress:* debris/windows/details chain).
- `tools/qa/fresh-campaign-cleaning-probe.js` — minimal isolation probe used to root-cause tool-engagement behavior.

## Starter-loop driver coverage (final state tonight)

`tools/qa/starter-loop-acceptance.js`, fresh Relaxed game, all through player verbs:
menu boot ✔ → survey (look + walk-up) ✔ → doors + entry ✔ (phase advances) →
entrance clutter ✔ (2 piles) → loose debris ✔ (sweep/collect/vacuum + two-stage
disposal; one conserved fixture-checkpoint for a stockroom entry hostile to every
driver approach) → windows ✔ (all panes wiped) → cleanup details **10/14**
(all four direct-E details, both lounge trash targets, bin, NE cobweb; both
ceiling lights repaired → `lighting-repairs` COMPLETE) → later beats blocked on
`cleanup-details`.

Final driver coverage: **12/14** interaction targets through pure player verbs
(leaves-trash landed once the head-contact calibration went in). The
`tool-head-calibration-probe.js` measurement was load-bearing: **the spray
nozzle contact lands ≈2.75 yd AHEAD of the stand at pitch −0.78** (and farther
at shallower pitches) — every earlier "close" stand overshot its target. The
driver now walks a distance ladder (0.45–3.05 yd, pitch-matched).

Two explained holdouts, both real findings for the maintainer:

1. `corner:cobweb-nw` — its contact zone sits directly beside the **staged
   starter cartons** along the south wall; the cleaning gate correctly refuses
   contact into their colliders. Sequencing insight: this corner becomes
   reachable after `starter-stock` consumes the cartons, i.e. the objective
   *order* (details before stock) can soft-lock this one detail until the
   player moves a carton. Verify by hand; consider nudging the zone or the
   carton spot.
2. `wall:scuff-west/east` — spray reliably marks them to the 0.28 watermark,
   but the cloth lift **never** progressed past it across four intervention
   rounds (direction ladders, saturation pre-spray). The cloth requires its
   own contact cell to hold solution AND land within the scuff radius; at
   wall-adjacent zones that conjunction may be nearly unsatisfiable. Open
   verification item: hand-play a scuff wipe, or trace the cloth contact cell
   vs the solution deposit; if a human can't lift them either, this blocks
   `cleanup-details` → `open` → the whole campaign, making it a P1.

## Honest findings log

- The four audited blockers all resolved without weakening a single strict assertion; three of them were QA harnesses pinning removed production contracts (see memory: qa-harness-drift).
- The furnished starter (save v13) begins with all seven architecture components restored — fresh games exercise the *refinish* half of the new verbs after the campaign; full structural repair applies to campaign-era/legacy saves and future non-furnished properties. The starter loop's repair beat is the two ceiling lights, as designed.
- The bootstrap QA profile's `--bootstrap` seed reports "Autosave repaired 1 invalid save field(s)" from a pre-existing `$.shop.layout.moved` fixture artifact (22 unsafe fixture poses removed by the loader) — loader behaves correctly; fixture could be regenerated cleanly some day.
- Tool-use refusal "The tool is against a fixture, not the floor" is working as designed; QA drivers must approach debris from open floor like a player.

## §11 float/collision audit outcome (pine-hills interior)

`interior-float-collision-audit.js` scanned 61 top-level interior props on a
fresh dilapidated boot. After correcting the datum (fixtures rest on the
finished floor 0.30 yd above the walk base — the naive scan misread all of
them as floaters) and excluding container groups, the REAL findings were:

1. The pooled customer-basket stack hovered 3 cm above its walnut base plate
   at the entrance station — fixed (rest height 0.072).
2. One small anonymous mesh at the stockroom corner (+0.18) — recorded, low
   priority.
3. Zero genuine fixture-pair overlaps: every flagged pair involved a
   room-spanning container group (sheet06 LIVE root, stock/markers layers),
   not solid props. The register group's −0.7 minimum is parked sub-object
   staging, not a visible sink.

Kenneth's original floating/colliding sightings were on the modern-public
presentation, which no longer renders the starter. The audit is committed as
an ongoing triage tool with per-finding screenshots.

## Starter clubhouse vs the newest references (`Designs/ClubHouse/`, Jul 20)

The three reference sheets are **specs, not scene-look mockups**: (1) a five-tier
fixture/upgrade price catalog (racks, desks, carts, shelving, lighting, flooring,
ceilings, doors — Basic $ through Luxury $$$), (2) the five-property progression
(Course 1 failing municipal "Pine Hills" through Course 5 country club, "all
interiors intentionally empty for player customization"), and (3) the Course-1
Pine Hills detail sheet (sage peeling siding, stone porch columns/chimney, fascia
sign, cracked lot, dumpster, shed; muted sage/stone palette).

Assessment: the current Pine Hills starter matches the Course-1 brief well
(siding color, porch, neglect dressing, signage) — **no Blender rebuild is
warranted**. The tier catalog maps onto the existing construction-finishes
quality tiers and placeable catalog; the property progression maps onto the
already-built modernPublic/mountainLodge/premium/resort variants.

**Visual review needed (manual):**
1. Entrance doors render maroon; the Course-1 reference and the campaign hint
   both say green. The color is baked into the architectural door-tier GLB
   material (`data/architecturalDoors.js` tiers, applied by
   `architecturalDoorInstallation.js`) — recolor toward deep golf green in the
   door tier source and re-export. Cosmetic, low risk, needs an art pass.
2. Starter-loop screenshots for overall first-hour readability:
   `qa/recovery-2026-07-22/starter-loop-p1/*.png` (porch approach, interior,
   clutter-clearing) and `qa/recovery-2026-07-22/structural-work/*.png`
   (repair/refinish states).

## Remaining / in progress (dependency order)

1. Starter-loop driver extension through the cleaning chain (loose-debris → windows → details → floor milestone), then lighting repairs → starter stock → open → first check-in → first sale → first review → day close → save/reload.
2. Abuse/idempotency browser pass over the spec's spam list (existing suites `register-lifecycle-stress`, `save-stability`, `inventory-conservation` are green in the full suite; the browser-level spam checks remain).
3. Starter clubhouse visual assessment vs `Designs/ClubHouse/` references (Pine Hills kit believed to supersede most of spec §6 — verify before any Blender work).
4. Re-establish the paired base/candidate relative perf gate for future rendering A/Bs.
5. Steam packaging (no electron-builder/forge yet) — deliberately after gameplay stability.

## Steam-readiness scores (honest, evidence-based; target = shippable EA build)

| Category | Current | Target | Basis |
| --- | --- | --- | --- |
| Core commerce loop (scan/pay/deliver/bank) | 9/10 | 9 | Both strict physical drivers green end-to-end; atomicity/idempotency suites; exactly-once banking proven live |
| Fresh-start onboarding (campaign arc) | 9/10 | 9 | Was hard-stuck at `arrival` (fixed `ffd1f1d`); the full House Flipper arc now exists and is driver-proven through cleaning → all 8 structural repairs → stock → the opening gate (one trash-sweep iteration from the porch-sign flip at last run); wall targets player-liftable after the reachability fixes |
| Starter identity vs the spec fantasy | 8/10 | 9 | NEW games boot into the authored boarded-up dilapidated Pine Hills building (Course-1 reference: green doors, lanterns, sage siding) with power out until the ceiling repair; was 3/10 at Kenneth's morning review (furnished, clean, modern-public shell) |
| Save/load stability | 8/10 | 9 | v13 + healers + backup recovery; matrix suites green; new fields round-trip through the real storage facade live |
| Performance | 8/10 | 9 | Absolute canonical matrix green with 2.5–3× margin on this hardware; paired relative gate not re-established |
| Gameplay feature completeness (spec §9/§10) | 7/10 | 8 | Repair + refinish verbs shipped and live-verified; cleaning/checkout/laptop/course systems production-ready per audit; NPC animation/character polish still thin (KNOWN_ISSUES) |
| Visual/content polish | 6/10 | 8 | Starter matches the Course-1 reference brief; door color off-reference; later-property variants exist but unvalidated in the loop |
| Release infrastructure (packaging/Steamworks) | 1/10 | 7 | No electron-builder/forge config exists; deliberately sequenced after gameplay stability |
| QA/verification infrastructure | 9/10 | 9 | 2,296 tests, ~280 live harnesses, strict acceptance fleet now current with production contracts |

## Exact dependency-ordered continuation (next session)

1. Extend `starter-loop-acceptance.js` through the remaining arc: finish the last wall/corner detail targets → `starter-stock` (three cartons: cutter → carry → six fixture groups) → `organize-floor` check → `open` (porch hours sign) → `first-checkin` (front-desk E on the arriving named guest) → `first-sale` (reuse the strict one-click scan + insert/keypad choreography) → `first-review`/`first-day-close` (clock to midnight) → save → reload → assert everything intact. Fix the earliest real break each iteration; the focus-competition instrumentation pattern (record `sawLabels`) is the debugging tool.
2. Browser-level abuse pass (spam E/scan/checkout/check-in/delivery-accept; save during placement/painting; reload with customers present) — sim-layer duplication is already covered green (`checkout-atomicity`, `inventory-conservation` 750-action fuzz, `register-lifecycle-stress`, `save-stability`).
3. Door-tier material recolor toward the Course-1 deep-green reference (art pass, `data/architecturalDoors.js` tier GLBs).
4. Re-establish the paired base/candidate relative perf gate before the next rendering change.
5. Packaging: electron-builder (or forge) config, production CSP review (`src/electron/security.cjs`), crash/error reporting, then Steamworks wiring. Only after the vertical slice holds.

## Morning-session verification ledger additions

- Full `npm test`: four more green runs at 2,300 (dilapidated seed; final
  variant tree; door/presentation tree; closing batch) — eight green full
  runs across the whole session.
- Live Playwright, morning: dilapidated visual probe ×3 (state facts + the
  green-door exterior evidence); entrance-door identification probe; wall
  scuff hand-play probe ×3 (final verdict player-liftable); float/collision
  audit (one real fix: basket stack); input-abuse pass green on all four
  categories; vertical-slice acceptance ×4 iterations — the latest opens the
  business through the real porch sign after the full cleaning + 8-repair +
  stock + trash gate, with the named-customer card sale + reload as the last
  segment under validation.
- Blender gates: assets 051/052/053 rebuilt, validation 0 errors each,
  canonical/runtime hashes identical, sheet06 clean reimport 10/10, 31/31
  asset suites.
- Known variance: one of the twelve cleanup details occasionally completes
  only at the disclosed checkpoint rather than under scripted aim (11/12
  player-verb in the last runs); the campaign itself never gates on it alone.

## Test/verification ledger (every run counted)

- Full `npm test`: 4 green runs this session (2279, 2289 [after +10], 2294 [after +5], plus baseline 2278 pre-session).
- Targeted batteries: register/checkout 391/391; storage+save 43/43; restoration+tutorial+campaign 61/61 and 37/37; audio 5/5.
- Live Playwright: strict card ✔, strict cash ✔, structural work ✔, starter-loop phase 1 ✔ (phase 2 iterating), perf matrix headed ✔, cleaning acceptance control run (bootstrap profile) — broom/dustpan verbs engaged; its own end-state assertions require the untouched bootstrap fixture, superseded here by the starter-loop coverage.
