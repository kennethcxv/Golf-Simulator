# Branch review matrix — 2026-07-19

Scores are comparative engineering judgments on a five-point scale, where 5 is strongest. They do not override hard acceptance failures. Initial full-suite results include the shared missing generated Sheet-6 Blender report unless explicitly called out; that report is regenerated in the final integration gate.

| Branch | Intended / actual scope | Complete | Code | Architecture | Visual / asset | Tests | Save | Perf | Risk | Complexity | Unique value | Broken / incomplete | Recommendation |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| `save-stability` | Intended and delivered migrations, domain recovery, corrupt/future-save refusal, checkout resume, notices, and lifecycle evidence | 4 | 4 | 4 | n/a | 4 | 5 | 4 | 3 | 4 | strongest recovery/migration path | full suite has a branch-specific scene-start lifecycle contract failure | **requires repair before integration** |
| `checkout-polish` | Intended full front-desk polish; delivers substantial scanner/payment/receipt/bag/queue/stock presentation | 2 | 4 | 4 | 4 | 4 | 4 | 4 | 5 | 5 | strongest checkout visuals, lifecycle, assets, and tests | strict normal-control card and cash runs fail because pick-up auto-scans and auto-stages products; bundled driver also uses a stale world offset | **requires repair before integration** |
| `course-visuals` | Intended and delivered whole-course visual, shader, lighting, hazard, and nine-hole QA polish | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | strongest nine-hole presentation and shader gate | only the shared missing generated Blender report failed in the initial suite | **cherry-pick selected commits** after canonical editor work |
| `assets-51-100-runtime` | Intended and delivered a canonical runtime manifest, optimized placement, interactions, and acceptance tooling | 5 | 4 | 5 | 4 | 5 | 4 | 5 | 3 | 4 | closes runtime integration for existing authored assets | existing checkout coverage admits the full physical scan flow is unfinished elsewhere | **merge substantially as-is** through reviewable cherry-picks |
| `cleaning-gameplay` | Intended and delivered shared first-person cleaning lifecycle, tools, effects/audio, state, and soak coverage | 5 | 4 | 5 | 4 | 5 | 5 | 4 | 3 | 4 | one coherent cleaning/tool framework; 100-switch acceptance run | only the shared missing generated Blender report failed in the initial suite | **merge substantially as-is** through reviewable cherry-picks |
| `management-systems` | Intended and delivered laptop-linked club/turf/finance systems using existing authorities | 5 | 4 | 4 | 4 | 5 | 4 | 4 | 3 | 2 | verified checkout outcome linkage without a duplicate economy authority | product priority forbids accepting it ahead of checkout | **cherry-pick selected commits** only after checkout is accepted |
| `course-editor-performance` | Intended and delivered spatial indexing, worker-safe tools, stroke/history QA, and visual passes | 5 | 5 | 5 | 4 | 5 | 5 | 5 | 3 | 4 | canonical committed editor performance implementation | the separate uncommitted overlay fails exact terrain undo integrity | **merge substantially as-is**; **reject overlay** |
| `qa-audit` | Intended and delivered independent browser isolation, strict checkout audit, GLB/perf/security findings | 5 | 4 | 4 | n/a | 5 | n/a | 4 | 2 | 3 | found the physical scanner blocker that feature-local tests missed | several reports describe pre-integration state; selected drivers overlap newer branches | **cherry-pick selected commits / use findings as reference** |

## Independent verification snapshot

| Branch | Full Node suite | Browser / runtime result | Console and request result |
|---|---|---|---|
| verified base `1dfb9de` | 1,654 pass, 1 shared-report fail, 3 skip | strict card and cash both fail at physical barcode orientation | no blocking browser errors before failure |
| `save-stability` | 1,677 pass, 2 fail, 3 skip | recovery/discovery/future/corrupt-save browser scenarios pass | clean; expected future-schema warning only |
| `checkout-polish` | 1,683 pass, 0 fail, 3 skip | strict card and cash both fail: product becomes scanned/staged immediately after mouse-down | clean aside from known shader warning |
| `course-visuals` | 1,659 pass, 1 shared-report fail, 3 skip | full nine-hole sweep and shader boot pass | 0 broken shaders, GL error 0, no failed requests |
| `assets-51-100-runtime` | 1,662 pass, 0 fail, 3 skip | runtime probe, runtime acceptance, and completion QA pass | no blocking errors |
| `cleaning-gameplay` | 1,672 pass, 1 shared-report fail, 3 skip | full acceptance passes, including 100 tool switches and save/load | no console errors or failed requests; known shader warning only |
| `management-systems` | 1,659 pass, 1 shared-report fail, 3 skip | baseline and persistence acceptance pass | no console/page errors or non-aborted request failures |
| `course-editor-performance` | 1,658 pass, 1 shared-report fail, 3 skip | headed production, utility, stroke, and long-frame gates pass | clean |
| course-editor uncommitted overlay | 93 focused tests pass | headed production and utility pass; exact terrain undo gate fails | no unrelated browser blocker |
| `qa-audit` | 1,671 pass, 0 fail, 3 skip | its worktree-aware strict driver reproduced the verified-base and checkout-branch physical scan blocker | clean aside from known shader warning |

Raw branch logs and browser artifacts are retained locally under `qa/integration/branches/`. Durable per-branch summaries are added alongside this matrix before the final merge.
