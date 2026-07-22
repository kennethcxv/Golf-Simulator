# Full integration branch inventory

Captured 2026-07-21 09:42 America/Los_Angeles before the full-integration branch or backup tag was created.

## Safety baseline

- Starting operator worktree: `C:/Users/Kenneth/Documents/GitHub/Golf-Flipper`
- Starting operator branch: `feature/pro-shop-furniture`
- Starting operator commit: `9e0f68e76804aae5298e79dbe892e632e64e04a7`
- Starting `main` commit: `857bd2b4ff16a1f9ca6d1d32b607505081d19f27`
- Clean worktree reserved for integration: `C:/Users/Kenneth/Documents/GitHub/Golf-Flipper-seven-main-baseline-20260719`
- `git fetch --all --prune`: passed; there are no configured remotes, so no refs changed.
- Remote branches: none.
- Open pull requests: not authoritatively enumerable. The repository has no configured remote, the GitHub CLI is not installed, and the connected GitHub app exposes no installed repository matching `Golf-Flipper`. A global text search was intentionally rejected as unrelated/noisy evidence.
- Existing source branches and worktrees are retained. Dirty worktrees will not be reset, switched, staged, or modified; only their committed branch HEADs may be integrated.

## Worktree cleanliness

The repository is **not globally clean**. This is recorded rather than concealed. The clean `main` worktree above is used for integration so existing user work remains untouched.

| Worktree | Ref | State |
|---|---|---|
| `Golf-Flipper` | `feature/pro-shop-furniture` | dirty: 44 tracked, 352 untracked |
| `C:/tmp/Golf-Flipper-final-polish` | `feature/final-polish` | clean |
| `C:/tmp/Golf-Flipper-furniture` | `feature/furniture-catalog` | dirty: 64 untracked `.blend1`/cache files |
| `C:/tmp/Golf-Flipper-material-upgrades` | `feature/material-upgrades` | dirty: 2 tracked cache files |
| `C:/tmp/Golf-Flipper-material-upgrades-baseline` | detached `1dfb9de` | clean |
| `C:/tmp/Golf-Flipper-store-generation` | `feature/store-generation` | clean |
| `.claude/worktrees/course-takeover` | `course-takeover-claude` | clean |
| `Golf-Flipper-assets-51-100-runtime` | `overnight/assets-51-100-runtime` | clean |
| `Golf-Flipper-cashier-repair-validation` | detached `8ae51d4` | clean |
| `Golf-Flipper-cashier-staged-validation` | detached `2914ed0` | clean |
| `Golf-Flipper-checkout-baseline-1dfb9de` | detached `1dfb9de` | clean |
| `Golf-Flipper-checkout-delivery-groundskeeping-balance` | `overnight/checkout-delivery-groundskeeping-balance` | clean |
| `Golf-Flipper-checkout-polish` | `overnight/checkout-polish` | clean |
| `Golf-Flipper-cleaning-gameplay` | `overnight/cleaning-gameplay` | clean |
| `Golf-Flipper-course-editor-performance` | `overnight/course-editor-performance` | dirty: 7 tracked |
| `Golf-Flipper-course-maintenance` | `overnight/course-maintenance` | clean |
| `Golf-Flipper-course-visuals` | `overnight/course-visuals` | clean |
| `Golf-Flipper-course1-failing-municipal` | `feature/course-1-failing-municipal` | clean |
| `Golf-Flipper-customer-simulation` | `overnight/customer-simulation` | clean |
| `Golf-Flipper-economy-progression` | `overnight/economy-progression` | clean |
| `Golf-Flipper-eval-course-editor-head-20260719` | detached `4c17058` | clean |
| `Golf-Flipper-final-polish` | detached `1dfb9de` | dirty: 26 tracked, 7 untracked |
| `Golf-Flipper-furniture-customization` | `overnight/furniture-customization` | clean |
| `Golf-Flipper-gameplay-progression` | `overnight/gameplay-progression` | dirty: 3 tracked, 1 untracked |
| `Golf-Flipper-golf-gameplay-loop` | `overnight/golf-gameplay-loop` | clean |
| `Golf-Flipper-golf-operations` | `overnight/golf-operations` | clean |
| `Golf-Flipper-inventory-delivery-loop` | `overnight/inventory-delivery-loop` | clean |
| `Golf-Flipper-late-branch-review` | detached `a8e4724` | clean |
| `Golf-Flipper-management-systems` | `overnight/management-systems` | clean |
| `Golf-Flipper-overnight-integration-20260719` | `integration/codex-overnight-review-20260719` | dirty: 2 tracked |
| `Golf-Flipper-player-experience-polish` | `overnight/player-experience-polish` | clean |
| `Golf-Flipper-pro-shop-equipment` | `feature/pro-shop-equipment` | clean |
| `Golf-Flipper-pro-shop-overhaul` | `overnight/pro-shop-overhaul` | clean |
| `Golf-Flipper-property-expansion-world-overhaul` | `overnight/property-expansion-world-overhaul` | clean |
| `Golf-Flipper-qa-audit` | `overnight/qa-audit` | clean |
| `Golf-Flipper-save-stability` | `overnight/save-stability` | clean |
| `Golf-Flipper-seven-completed-integration-20260719` | `integration/seven-completed-branches-20260719` | clean |
| `Golf-Flipper-seven-main-baseline-20260719` | `main` | clean |
| `Golf-Flipper-seven-release-validation-20260719` | detached `ff00fd7` | clean |
| `Golf-Flipper-steam-release-polish` | `overnight/steam-release-polish` | clean |
| `Golf-Flipper-store-display-assets` | `feature/store-display-assets` | clean |
| `Golf-Flipper-validate-course-maintenance-seven-20260719` | detached `2a0ab21` | dirty: 4 tracked |
| `Golf-Flipper-validate-customer-seven-20260719` | detached `3cfbca4` | clean |
| `Golf-Flipper-validate-furniture-seven-20260719` | detached `b271903` | clean |

## Local branches

| Branch | Head | Main only / branch only commits | Initial classification |
|---|---:|---:|---|
| `backup/pre-overnight-integration-20260719` | `0c5137e` | 50 / 0 | backup; already in main |
| `backup/pre-seven-branch-integration-20260719` | `0c5137e` | 50 / 0 | backup; already in main |
| `checkpoint/course-master-final-20260717` | `fd435a5` | 50 / 77 | historical; contained by consolidated head |
| `course-editor-pre-rebuild` | `591f839` | 50 / 20 | historical; contained by consolidated head |
| `course-takeover-claude` | `3a230a0` | 50 / 112 | contained by consolidated head |
| `feature/course-1-failing-municipal` | `3a9b9b2` | 50 / 150 | 2 commits beyond consolidated base; candidate |
| `feature/final-polish` | `991c3ea` | 50 / 152 | 4 commits beyond consolidated base; candidate |
| `feature/furniture-catalog` | `f814b7e` | 50 / 157 | 9 commits beyond consolidated base; candidate; committed HEAD only |
| `feature/material-upgrades` | `ab35467` | 50 / 149 | 1 commit beyond consolidated base; candidate; committed HEAD only |
| `feature/pro-shop-equipment` | `b76ff9e` | 50 / 149 | 1 commit beyond consolidated base; candidate |
| `feature/pro-shop-furniture` | `9e0f68e` | 0 / 412 | consolidated candidate; committed HEAD only |
| `feature/store-display-assets` | `7e5e9f7` | 50 / 149 | 1 commit beyond consolidated base; candidate |
| `feature/store-generation` | `8779075` | 50 / 175 | 2 current commits beyond consolidated head; candidate |
| `integration/all-verified-work-2026-07-18` | `1dfb9de` | 50 / 148 | contained by consolidated head |
| `integration/codex-overnight-review-20260719` | `c481c65` | 50 / 211 | contained by consolidated head; dirty overlay excluded |
| `integration/seven-completed-branches-20260719` | `58805ba` | 2 / 0 | already in main and consolidated head |
| `main` | `857bd2b` | 0 / 0 | integration base |
| `overnight/assets-51-100-runtime` | `3567b7e` | 50 / 153 | contained by consolidated head |
| `overnight/checkout-delivery-groundskeeping-balance` | `bafe4ea` | 50 / 5 | contained by consolidated head |
| `overnight/checkout-polish` | `473b0e1` | 50 / 163 | contained by consolidated head |
| `overnight/cleaning-gameplay` | `20e7fd7` | 50 / 152 | contained by consolidated head |
| `overnight/course-editor-performance` | `4c17058` | 50 / 155 | contained by consolidated head; dirty overlay excluded |
| `overnight/course-maintenance` | `2a0ab21` | 50 / 4 | contained by consolidated head |
| `overnight/course-visuals` | `e3980ac` | 50 / 153 | contained by consolidated head |
| `overnight/customer-simulation` | `3cfbca4` | 50 / 6 | contained by consolidated head |
| `overnight/economy-progression` | `16b7570` | 50 / 5 | contained by consolidated head |
| `overnight/furniture-customization` | `b271903` | 50 / 5 | contained by consolidated head |
| `overnight/gameplay-progression` | `3ddb082` | 50 / 168 | contained by consolidated head; dirty overlay excluded |
| `overnight/golf-gameplay-loop` | `4e64f3f` | 50 / 19 | contained by consolidated head |
| `overnight/golf-operations` | `52cfe7e` | 50 / 13 | contained by consolidated head |
| `overnight/inventory-delivery-loop` | `12600d4` | 50 / 5 | contained by consolidated head |
| `overnight/management-systems` | `7462ad7` | 50 / 151 | contained by consolidated head |
| `overnight/player-experience-polish` | `bf072a1` | 50 / 5 | contained by consolidated head |
| `overnight/pro-shop-overhaul` | `798ab68` | 50 / 22 | contained by consolidated head |
| `overnight/property-expansion-world-overhaul` | `3660dfc` | 50 / 179 | 6 commits beyond consolidated base; candidate |
| `overnight/qa-audit` | `1a81abd` | 50 / 152 | contained by consolidated head |
| `overnight/save-stability` | `c6802c1` | 50 / 157 | contained by consolidated head |
| `overnight/steam-release-polish` | `d36fe92` | 50 / 14 | contained by consolidated head |
| `tcg-checkout` | `25fbdce` | 50 / 127 | historical; contained by consolidated head |
| `tcg-checkout-pre-kit` | `75da6eb` | 50 / 11 | historical; contained by consolidated head |

## Remote branches and pull requests

- Remote refs: none.
- Configured remotes: none.
- Open PRs: unavailable for the reasons in the safety baseline. No PR was guessed from unrelated global search results.

## Branches containing commits not in `main`

All local branches except the two backup branches, `integration/seven-completed-branches-20260719`, and `main` contain commits not reachable from `main`. The table above records exact left/right counts.

`feature/pro-shop-furniture` is a descendant of `main` and already retains normal merge commits for the previously completed integration branches. The following current heads are ancestors of it and therefore need no second merge: `checkpoint/course-master-final-20260717`, `course-editor-pre-rebuild`, `course-takeover-claude`, `integration/all-verified-work-2026-07-18`, `integration/codex-overnight-review-20260719`, both backup branches, `integration/seven-completed-branches-20260719`, `main`, every listed `overnight/*` branch except `overnight/property-expansion-world-overhaul`, and both `tcg-checkout*` branches.

Eight heads retain commits not reachable from `feature/pro-shop-furniture` and are the focused follow-on candidates:

| Candidate | Unique commits beyond consolidated ancestry | Scope |
|---|---:|---|
| `feature/course-1-failing-municipal` | 2 | Course 1 municipal property assets/runtime |
| `feature/material-upgrades` | 1 | five-grade clubhouse finishes |
| `feature/pro-shop-equipment` | 1 | tiered pro-shop equipment assets/runtime |
| `feature/store-display-assets` | 1 | tiered retail display assets/runtime |
| `feature/furniture-catalog` | 9 | unified furniture placement, authored catalog/assets, tests/QA |
| `feature/store-generation` | 2 | generated shop/service-room ownership |
| `overnight/property-expansion-world-overhaul` | 6 | cleaning completion, vehicles, property, world, delivery |
| `feature/final-polish` | 4 | checkout behavior, QA provenance, physical receipt polish |

Final inclusion/skipping decisions and merge order are recorded separately after conflict/build evaluation.

## Final ancestry re-audit

Rechecked at validated code head `04cf42a1e72e9c9d0c0829486de8041eca1dcbca`:

- Local branches: 41 total (`integration/all-branches` plus 40 other tips).
- Other local tips contained by the integration head: 40/40.
- Missing local tips: 0.
- Configured remotes: 0.
- Safety tag `pre-full-integration-20260721-0942` still resolves to starting `main` commit `857bd2b4ff16a1f9ca6d1d32b607505081d19f27`.
- The original dirty `feature/pro-shop-furniture` worktree remains untouched.

No branch was deleted or force-updated. Dirty uncommitted overlays were not inferred to be branch work and were not imported.
