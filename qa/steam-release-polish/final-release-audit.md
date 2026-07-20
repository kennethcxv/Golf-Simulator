# Steam Release Polish — Final Release Audit

Captured 2026-07-19. This audit covers the branch from its recorded clean starting point through
the final checkout-first implementation, broader normal-player routes, desktop validation, and
release evidence. It does not claim systems the game does not implement.

## 1–6. Branch, commits, and blocker counts

1. **Branch:** `overnight/steam-release-polish`
2. **Starting commit:** `0c5137e5f0efac9627ce2309b9e66936f1eeb769`
3. **Final implementation commit:** `b81ed31` (`feat(release): finish player-facing presentation`).
   The evidence commit containing this report is `HEAD` at handoff.
4. **Focused commits before the final source/evidence commits:**
   - `a41396c` audit(release): catalogue checkout-visible defects
   - `f3c6e0d` fix(checkout): make cash handling physically reachable
   - `01acc1a` feat(checkout): require a physical card swipe
   - `6d15a83` feat(checkout): guide each transaction stage
   - `1478689` feat(checkout): animate the physical transaction
   - `475b51c` feat(checkout): put every action in the player's hands
   - `ec7feb5` fix(checkout): harden reentry and resource lifecycle
   - `e503749` fix(menu): own the new-empire transition
   - `778d7a9` feat(characters): replace checkout placeholder art
   - `012e79b` fix(rendering): remove ANGLE denoise warning
   - `733a5c1` perf(rendering): enforce release scene budgets
   - `6e70718` fix(desktop): ship on a secure Electron runtime
   - `b81ed31` feat(release): finish player-facing presentation
5. **Baseline blocker counts:** 3 blocker, 3 critical, 14 high, 8 medium, 1 low,
   2 cosmetic; 31 total.
6. **Final blocker counts:** 0 open at every severity. Seven supplemental broader-route findings
   were also found and resolved; see `release-blocker-list.md`.

## 7. Assets replaced or revised

- Replaced the checkout/customer primitive placeholder with an original repeatable
  Blender-authored modular character kit: `vendor/models/clubhouse/character_parts.glb`.
- Built and integrated physical register, terminal, drawer, receipt, basket, bag, divider, and
  impulse-rack components through `tools/blender/build_register.py` and the existing GLB pipeline.
- Added the closed handoff carrier and integrated the authored basket lifecycle.
- Derived 28 runtime GLBs with a reproducible 1024px atlas cap while preserving raw owner assets.
- Kept the raw `club_sign.glb` intact and mounted a live save-branded face over its baked name.
- No third-party assets were downloaded during this branch; existing source/license records remain
  in `ASSET_SOURCES.md`.

## 8–11. Collision, camera, interactions, and animation

8. **Collision:** checkout reach circles, drawer travel, staff corridor, scanner crossing, bag
   radius, entrance/receiving clearways, fixture overlap, and backroom case bounds are regression
   tested. Backroom stock is shared across rack capacities instead of duplicated/overflowing.
9. **Camera:** the authored cashier pose keeps drawer wells and transaction hardware visible;
   interrupted focus restores cleanly. Laptop returns FOV; world route validates walking, keyboard
   look, FOV 72, sensitivity 1.3, overview/editor transitions, and tractor camera. Electron pointer
   lock passes.
10. **Interactions:** one physical input causes one authoritative action for scan, judged swipe,
    cash take/deposit/change, receipt, bagging, handoff, box cutting/unboxing/stocking, tools,
    laptop, pause, and tractor mount/drive/park. Exit/reentry cancels held objects and partial swipes
    without losing the transaction.
11. **Animation:** first-person hands cover scan/card/cash/receipt/bag/handoff; receipt feeds and
    curls; drawer, money, bag fill, and carrier handoff move through defined lifecycles. Customers
    use animated articulated characters and visible baskets. Pocket and shelf-pick transitions
    remain stylized, as documented under limitations.

## 12–16. Lighting, materials, terrain, effects, and audio

12. **Lighting:** warm interior/cool daylight readability is retained across abandoned and restored
    captures. Low-value shadow casters were removed and directional shadows update once per composed
    frame; high-value characters and hardware remain grounded.
13. **Materials:** warm cream, deep green, walnut, oak, charcoal, and restrained brass roles are
    consistent across register, fixtures, signage, UI, and characters. Runtime atlas limits remove
    extreme texture cost without visibly flattening the scene.
14. **Terrain:** the normal world route visually checks turf, fairway/green edges, paths, horizon,
    trees, course overview, editor, and maintenance travel. No major terrain intersection or seam
    blocker remained; no hole redesign was undertaken.
15. **Effects:** pressure-washer/tool feedback, receipt, scanner, and UI effects remain restrained;
    repeated routes showed no persistent checkout effect or per-frame register-canvas redraw.
16. **Audio:** existing checkout/UI/tool cues are triggered at physical actions and tool loops are
    stopped on mode/settings changes. Volume and mute remain functional. No external audio was
    added. Headless automation cannot make a subjective final mix judgment; this is recorded as a
    limitation, not claimed as a measured mix pass.

## 17–21. UI, menus, NPCs, errors, and accessibility

17. **UI:** a five-step checkout HUD exposes only the current gesture, POS data is legible, stale
    scanner/turf controls are removed, checkout toasts use a replaceable channel, typography has
    explicit brand/operational/data roles, and 125% UI scale fits at 1920x1080.
18. **Menus:** release-disclaimer copy is gone. New Empire owns an explicit market screen, close
    returns to menu, Continue loads deliberately, pause preserves an intentional zero speed, save
    feedback works, and return to menu autosaves cleanly.
19. **Customers/NPCs:** authored anatomy/clothing replaces placeholders; baskets fill/carry/set
    down/remove; queue transactions retain unique held inventory; abandonment funnels cancel safely.
    Final card capture can advance the next shopper without confusing their basket with the
    completed sale.
20. **Error handling:** incomplete/expired/declined cards, early total, drawer misuse, cash/change
    errors, inventory recovery, invalid native save keys, missing resources, and shader fallback
    paths expose bounded feedback instead of silent corruption. Final browser and Electron routes
    contain zero console/page/request/CSP diagnostics.
21. **Accessibility:** working persisted controls cover 90/100/110/125% UI scale, reduced motion,
    first-person tool sway, hold/toggle tool use, FOV 50–90 with a live degree value, sensitivity
    0.4–2.0 with a live multiplier, visible keyboard prompts, and color-independent text/state labels.

## 22. Performance before/after

| Metric | Baseline | Final | Change |
|---|---:|---:|---:|
| Idle draw calls | 4,948 | 2,559.3 | -48.3% |
| Idle triangles | 5,667,031 | 3,866,038 | -31.8% |
| Active checkout draw calls | 3,907 | 2,817.6 | -27.9% |
| Active checkout triangles | 5,838,390 | 3,646,593 | -37.5% |
| Active shadow casters | 494 | 405 | -18.0% |
| Unique decoded-image estimate | 6,054.5 MiB | 458.3 MiB | -92.4% |
| Listener growth / 25 transitions | 0 | 0 | stable |

The final run averaged 66.7 FPS idle and 72.4 FPS active checkout, with 23.1/34.8 ms idle
and 18.4/30.3 ms active p95/p99. It recorded zero idle long frames over 50 ms and two during
the eight-second active sample. FPS is host-sensitive; deterministic workload/resource stability
is the causal comparison. Full method and prior paired controls are in
`performance-before-after.md`.

## 23. Lifecycle results

- Checkout: prior 100/100 accelerated soak plus final 25/25 normal Escape/`E` transitions;
  zero reentry failures, zero listener growth, stable idle/active/post-stress renderer samples.
- Laptop: 30 enter/exit cycles; one UI root, no visible leftovers or listener accumulation, FOV
  restored, focus released, and player walks away normally.
- Delivery: six shipments/seven cartons including two half-open boxes survive reload with identical
  cash and units; normal cutter/unbox/carry/stock route passes.
- Save/recovery: mid-checkout units return, no phantom revenue or money change, no ghost register.
- World: pause/resume, settings, panels, editor, tractor, save slot, exit/autosave, and return to
  menu pass with zero diagnostics.

## 24. Build results

- Browser production preview: repository-local static server routes pass in Chrome.
- Desktop production runtime: Electron 43.1.1 runs the actual app with sandboxed preload,
  no Node globals in the renderer, allowlisted native persistence, denied external windows and
  navigation, healthy WebGL/pointer lock, and zero console/CSP errors.
- Dependency audit: `npm audit --audit-level=low` reports zero vulnerabilities.
- The repository does not define a distributable packaging/installer script; therefore no signed,
  Steam-depot-ready artifact or installer is claimed. This remains a delivery limitation.

## 25. Test results

- Full unit/integration suite: **548 passed, 0 failed, 0 skipped** in 6.82 seconds.
- Final card sale: pass; physical scan/swipe/receipt/bag/handoff, interruption, UI fit, zero errors.
- Final cash sale: pass in presentation iteration 4.
- Recovery, shader, world, menu, character, delivery, laptop, performance, and Electron routes: pass.
- Shader diagnostic: empty. Dependency audit: zero vulnerabilities. `git diff --check`: clean.
- Hygiene scan: no secrets, source personal paths, real keys, conflict artifacts, or unintended
  production debug calls. The `.git` worktree pointer is the only machine path and is not content.

## 26. Steam capture paths

- Baseline: `qa/steam-release-polish/baseline/`
- Final checkout card: `qa/steam-release-polish/final-routes/register-card-final-3/`
- Final checkout cash: `qa/steam-release-polish/register-presentation/iteration-4-final-cash/`
- Final world/settings/tractor: `qa/steam-release-polish/final-routes/world-smoke-final-2/`
- Final restored clubhouse: `qa/steam-release-polish/steam-captures/restored-clubhouse-1920x1080-final-2/`
- Final delivery/laptop routes: `qa/steam-release-polish/final-routes/delivery-*` and
  `qa/steam-release-polish/final-routes/laptop-*`
- Final Electron: `qa/steam-release-polish/final-routes/electron-final-2/`
- Final performance/shader/recovery: `qa/steam-release-polish/final-routes/{performance-final,shader-final,register-recovery-final}/`

Each principal visual route includes screenshots and/or WebM video at the documented viewport.

## 27. Files changed

Relative to the starting commit, the branch changes 98 production/source/test/tool files plus the
committed QA evidence set. The production set includes register/character GLBs and repeatable Blender
scripts; transaction, resource, rendering, accessibility, desktop-security, and world-presentation
code; focused regression tests; and portable browser/Electron QA drivers. Exact file inventory is
available from `git diff --name-status 0c5137e5..HEAD`.

## 28. Honest remaining limitations

- There is no distributable build/installer/signing/Steam-depot pipeline in this repository.
- The parked golf cart is ambient; the tractor is the implemented drivable course vehicle. A
  player-operable golf-cart fleet was not fabricated for capture.
- Pocket retrieval and individual shelf-pick gestures use stylized transitions rather than bespoke
  skeletal clips; the impulse rack remains non-inventory scenery.
- Headless automation proves audio events and lifecycle behavior but cannot replace a human final
  mix/listening pass across all output devices.
- The final captures are legitimate current gameplay. They do not fake pressure washing, placement,
  golfers, property expansion, or other states not explicitly exercised by their route.

No merge to `main` was performed.
