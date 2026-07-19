# Overnight branch inventory — 2026-07-19

Inventory captured on 2026-07-19 before integration. The repository has no configured remotes, so every candidate is local-only. `git fetch --all --prune` completed without changing any refs.

## Safety baseline

- Recorded `main`: `0c5137e5f0efac9627ce2309b9e66936f1eeb769`
- Latest previously verified line: `integration/all-verified-work-2026-07-18` at `1dfb9de646c6785b027ddb023dda1e3a6af9a5c6`
- Safety branch: `backup/pre-overnight-integration-20260719` at the recorded `main`
- Integration branch: `integration/codex-overnight-review-20260719`, created from `1dfb9de`
- External byte-for-byte working-copy backup: `C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-integration-safety-20260719`
- Existing stashes: none
- Remote branches: none

The working copy at `integration/all-verified-work-2026-07-18` contained 15 modified tracked files and two untracked screenshots. It was preserved in place and copied to the external safety directory; none of it was overwritten or folded into this integration implicitly. The `overnight/course-editor-performance` worktree contained a seven-file uncommitted overlay. That overlay was separately backed up and evaluated; it is not part of the branch head.

## Candidate branches

All eight candidates fork exactly at `1dfb9de`, are zero commits behind that verified base, and contain no merge commits.

| Branch | Head | Commits | Ahead of recorded `main` | Latest commit (local time) | Diff | Likely workstream | Worktree state | Initial disposition |
|---|---|---:|---:|---|---|---|---|---|
| `overnight/save-stability` | `c6802c155aec4902d25ed7a485a6640c9b51f207` | 9 | 157 | 2026-07-19 13:58 | 26 files, +3,346/−373 | versioned save migration, corrupt-save recovery, checkout resume, lifecycle evidence | clean | substantial unique value; repair one lifecycle regression |
| `overnight/checkout-polish` | `473b0e18bff585189fb066cbcf749d0a41edfc6f` | 15 | 163 | 2026-07-19 13:02 | 44 files, +3,603/−647 | scanner, payment, drawer, receipt, bagging, queue, stock, checkout QA | clean | incomplete physical scanner flow; repair before integration |
| `overnight/course-visuals` | `e3980acc0ad3c86d305bd26e2bc6d2af81de1e9f` | 5 | 153 | 2026-07-19 06:10 | 16 files, +1,112/−187 | nine-hole course visual and renderer polish | clean | complete-looking; validate after editor merge |
| `overnight/assets-51-100-runtime` | `3567b7e127ef2e01337a524e8e8acdbbd2f15940` | 5 | 153 | 2026-07-19 04:19 | 30 files, +3,263/−322 | runtime manifest, prop placement, fixtures, asset residency QA | clean | complete-looking and independently accepted |
| `overnight/cleaning-gameplay` | `20e7fd79d0d815ce2e911a16af8b81d2d44300d1` | 4 | 152 | 2026-07-19 03:56 | 21 files, +3,485/−126 | first-person cleaning tools, effects, audio, persistence, lifecycle/performance QA | clean | complete-looking and independently accepted |
| `overnight/management-systems` | `7462ad7a7b0e3167dec1a8e79432f66c25718765` | 3 | 151 | 2026-07-19 03:31 | 15 files, +1,830/−185 | laptop management, finance/turf/club state, checkout outcome linkage | clean | compatible candidate, gated behind checkout acceptance |
| `overnight/course-editor-performance` | `4c17058ce40c0152346170a1286096f5dcc1612c` | 7 | 155 | 2026-07-19 02:52 | 18 files, +2,214/−195 | course-editor spatial index, worker pipeline, stroke QA | dirty overlay outside head | committed head accepted; overlay rejected |
| `overnight/qa-audit` | `1a81abda451175f21e2cdeacb47c902ff9e04269` | 4 | 152 | 2026-07-19 01:38 | 25 files, +9,510/−44 | isolated browser drivers, checkout audit, shader/asset/performance/security audit | clean | use selected QA tools and findings; do not treat reports as product code |

## Other refs reviewed and excluded

- `course-takeover-claude` predates the overnight window and was already evaluated during the 2026-07-18 integration. It is historical input, not a new candidate.
- `tcg-checkout` and its checkpoint branches are ancestors of the verified base.
- Detached worktree `8ae51d4` is an ancestor of the verified base.
- Detached worktree `2914ed0` is an older abandoned checkout-validation state. Its worktree remains available and was not deleted.
- The uncommitted overlay on `integration/all-verified-work-2026-07-18` is user work, not an overnight branch. It remains preserved and excluded from automatic integration.

## Shared-file overlap

The highest-risk overlap is `src/render3d/courseScene.js`, changed by five branches. `src/main.js` and `src/render3d/clubhouse.js` each have four-way overlap. Checkout/register lifecycle, first-person presentation, asset placement, shared CSS, and browser QA drivers also overlap. See `integration_decisions.md` for file-level classifications and canonical selections.
