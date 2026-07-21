# Phase 1 repository and baseline audit

Audit date: 2026-07-17 (America/Los_Angeles)

This is the evidence-backed starting state for the Assets 51–100 and first-person cleaning production pass. It is a discovery record, not a completion claim.

## Git and concurrent-work safety

- Branch: `tcg-checkout`
- Audited HEAD: `520a6dd6dad949713697181ef281539a1012e7bf`
- Committed-state checkpoint tag: `assets-51-100-phase0-20260717`
- Worktrees: one
- Stashes: none
- Merge/rebase/index lock: none
- Worktree at audit: approximately 94 modified, one deleted, and 84 untracked entries. The count changed during inspection while HEAD remained fixed.
- Active overlapping work includes checkout, delivery, course rendering, asset optimization, lifecycle/loading, and QA tooling. `src/render3d/courseScene.js`, `src/render3d/clubhouse.js`, fixtures, merchandise, lifecycle, and loader code were changing during the baseline window.
- Safety decision: do not stash, reset, stage, or commit unrelated dirty work. Phase 1 uses new `assets-51-100` tool/test names and the ignored `qa/assets_51_100_master` tree. Shared runtime edits wait for an explicit stable integration window.
- `/qa/` is intentionally ignored by Git. Required master evidence must be force-added by exact path when a stable increment is committed.

The checkpoint tag deliberately records the last committed state only. It does not pretend to capture the concurrent dirty worktree.

## Authoritative references

All six expected folders resolve beneath `Designs/RefrenceImages`:

- `Designs/RefrenceImages/51-60_refrence_images`
- `Designs/RefrenceImages/61-70_refrence_images`
- `Designs/RefrenceImages/71-80_refrence_images`
- `Designs/RefrenceImages/81-90_refrence_images`
- `Designs/RefrenceImages/91-100_refrence_images`
- `Designs/RefrenceImages/firstpersonView`

There are seven files total: one composite image for each numbered sheet and two first-person composites. Every file was opened at original resolution. Dimensions, sizes, hashes, precedence rules, and known reference gaps are recorded in `reference_inventory.json`.

Reference decisions that materially affect implementation:

1. Asset 51 is the canonical clubhouse shell. Asset 52 uses aligned damage modules/material states even though the two illustrations are not geometry-identical.
2. Written physical cleaning requirements override simplified sequence art: vacuum debris travels to the nozzle, broomed debris forms a pile, contact paths drive cleaning, and progress bars remain supplemental.
3. Pineview marks and AI-rendered labels are not production artwork. Use original Pinehollow/Golf Flipper-safe branding and deliberate original copy.
4. The first-person references add supporting garden hose, trash can, wheelbarrow, and leaf blower visuals outside the exact 50-primary-asset manifest.

## Repository asset census

- Approximately 300 Blender files: 88 under `asset_sources`, 212 under `Assets`.
- Approximately 406 GLBs: 207 under `Assets`, 199 under `vendor`.
- No pre-existing Sheet 06–10 source/export directories.
- No dedicated numbered 51–100 source/export set.
- No pre-existing Assets 51–100 spec, manifest, final audit, or target evidence tree.

Only eight plausible earlier source/export pairs resemble target assets: checkout counter, stock shelving, clubhouse workbench, office desk, lounge armchair, coffee table, office chair, and filing cabinet. These predate the new references and are reuse candidates only. Approximately 42/50 targets have no plausible dedicated source/export pair.

The established Assets 01–50 spec/audit/baseline scripts are useful templates, but their records remain individually unverified and cannot prove 51–100 completion.

## Current runtime architecture

- The clubhouse shell, exterior, doors, windows, trim, ceiling, floors, and much of its furniture are procedural Three.js construction in `src/render3d/clubhouse/`.
- The entrance is a single procedural glazed leaf, not the requested double-door assembly.
- There is no canonical finished/dilapidated shell pair or authored aligned damaged/restored floor set.
- Existing backroom mop/bucket/broom dressing is primitive and non-interactive.
- There is no dustpan, cloth/sponge, cleaning spray, trash-bag lifecycle, broom pile system, mop stroke system, or unified data-driven cleaning tool framework.
- `src/render3d/fpHands.js` uses procedural boxes/cylinders and hardcoded offsets. It has no authored hand rig, IK, Blender hand source, or GLB grip/effect sockets.
- Vacuum and pressure-washer viewmodels are procedural and remain outside the held-tool lazy-loaded GLB manifest.
- The washer effect starts from a hardcoded camera-local offset; the vacuum cleans a hardcoded point ahead of the player without a geometry-occlusion raycast.
- Floor dirt is a coarse 13×8 logical grid. Vacuum cleaning affects broad cells rather than a high-resolution nozzle/contact trail.
- Pressure washing has five fixed grime planes and 2,019 saved logical cells with soap dwell and a visible jet/mist, but no durable wetness/drying/runoff/material response.
- Soap readiness stores scene-relative time while scene time restarts on reload; a partially soaped save may behave incorrectly.
- Current save data does not cover tool location/equipped state, mop-bucket state, wetness, debris piles, trash-bag state, door/cabinet state, or floor/panel selections.

## Automated-test baseline

Environment:

- Node `22.14.0`
- npm `11.18.0`
- Electron `33.4.11`
- Three.js `0.185.1`

Results before game implementation changes:

- `npm test`: 1,044 tests; 1,042 passed; two failed; duration approximately 231.55 seconds.
- Repeated focused delivery run: seven passed, two failed.
- `tests/delivery-acceptance.test.js`: box 2 setdown rejected because it would cut off a required route.
- `tests/delivery-boxes.test.js`: cycle 8 setdown failure.
- Washing plus held-tool lazy-loading: 13/13 passed.
- Shop renovation plus state persistence: 31/31 passed.

The two full-suite failures are deterministic pre-existing delivery-box placement/navigation failures. They are not caused by the new Phase 1 documentation/audit files and must remain visible until fixed by the owning workstream or during a safe integration window.

No current tests cover mop, broom, dustpan, spray, cloth, sponge, trash-bag gameplay, authored hand grips, effect sockets, high-resolution cleaning paths, or the full 51–100 contract.

## Browser and visual baseline

Normal browser-QA launch: `npm run serve` / `node tools/serve.cjs` at `http://localhost:8457/`.

The Assets 51–100 baseline route uses 22 fixed 1600×900 DPR1 cameras: the existing 13-location clubhouse/delivery route, seven architecture/furniture views, and current vacuum/washer viewmodel views. It uses the documented Willow Creek fixture, fixed 2 PM clear weather, and isolated browser save state.

The canonical repository collection completed at `2026-07-18T07:11:28.493Z` while the worktree still contained concurrent shared-runtime edits. It is valid timestamped visual evidence but not a stable performance verdict. Evidence root:

`qa/assets_51_100_master/baseline/current`

The route wrote a valid `baseline-result.json` and all 22 PNGs with `ok: true`. Its command wrapper reached the 60-second teardown timeout after printing the complete result; a follow-up process census confirmed that no route process remained.

Latest measured scenarios:

| Scenario | Average FPS | 1% low FPS | Worst frame | UI mutations/sec |
|---|---:|---:|---:|---:|
| Idle exterior | 22.80 | 14.97 | 66.8 ms | not measured |
| Active vacuum | 92.14 | 54.17 | 25.0 ms | 8.35 |
| Active pressure washer | 29.10 | 19.94 | 50.3 ms | 0 |

Latest idle renderer census: 17,439 accumulated calls, 44.15 million rendered triangles, 6.79 million scene triangles, 3,728 nodes, 2,661 visible meshes, 489 materials, 198 textures, and 90 listeners. Texture memory bytes are explicitly unmeasured because the current renderer diagnostics expose counts but not allocation size.

Other identical idle collections produced 25.04 and 26.23 average FPS. An earlier repository baseline reported 46.64 average FPS, 27.16 1% low, and 38.9 ms worst. The instability and poor frame-time tails require a quiet identical-scenario rerun before any regression judgment.

Diagnostics:

- Console errors: zero
- Page errors: zero
- Failed requests: zero
- Warning: one repeated Three.js shader warning about a potentially uninitialized `dyn_index_vec4_float4_int`

Highest-impact visible baseline defects:

1. The reference double entrance is a single narrow leaf.
2. Porch deck/steps/rail assembly is incomplete and not reference-matched.
3. Exterior grime reads as a broad dark rectangle/smear instead of physical localized buildup.
4. The cleaning corner is sticks plus a yellow cylinder, not production mop/bucket/broom assets.
5. The vacuum viewmodel is a red box and black tube with no convincing hand, body, grip, or contact head.
6. The pressure-washer viewmodel is a pole/octagonal guard with a crude procedural hand and no believable trigger, hose, or authored nozzle.
7. No baseline capture demonstrates active spray impact, wetness, suction, debris travel, or contact-path cleaning.
8. “Click to play” overlaps interaction prompts and first-person presentation.
9. Tool notifications can stack and obscure the view.
10. Deferred held-tool first equips flash primitive fallbacks for roughly 94–158 ms.
11. Several fixed cameras are dominated by retail fixtures rather than their intended architectural subject.
12. Current lounge, office, wall panels, flooring, lighting, and safety/utility dressing remain materially below the supplied reference quality.

## Phase 1 outputs

- `reference_inventory.json`: complete seven-image inventory, hashes, and reference decisions.
- `production_standards.md`: unit, naming, hierarchy, pivots, sockets, animation, geometry, material, budget, collision, viewmodel, cleaning, persistence, performance, and QA contracts.
- `tools/qa/assets-51-100-spec.mjs`: exact ordered 50-record production contract with Sheet 6–10, first-person, dimensions, budget, collision, animation, socket, candidate, and canonical-path metadata.
- `tests/assets-51-100-manifest.test.js`: six passing contract tests covering count/order, references, dimensions/budgets, first-person representations, path uniqueness, and honest candidate status.
- `tools/qa/assets-51-100-baseline.js`: repeatable 22-camera visual/performance route, now captured under `baseline/current`.
- `tools/qa/glb-structure-audit.mjs`: reusable structural GLB inspection needed by the 51–100 manifest generator.
- `tools/qa/assets-51-100-audit.mjs`: deterministic generator for the exact 50-record JSON/Markdown manifest and structural audit.
- `asset_manifest.json` / `.md` and `final_asset_audit.json` / `.md`: Phase-1 discovery truth, including all world and required first-person production paths. Current planned structural acceptance is 0/50 and final production acceptance is 0/50; those values intentionally prevent discovery artifacts from being mistaken for finished production.
