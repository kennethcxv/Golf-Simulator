# Merge order

Integration base: `main` at `857bd2b4ff16a1f9ca6d1d32b607505081d19f27`.
Safety tag: `pre-full-integration-20260721-0942`.
Integration branch: `integration/all-branches`.

The fan-in used normal merge commits so branch ancestry remains auditable:

1. `9e50ba1` — `feature/pro-shop-furniture`, the consolidated descendant containing the previously integrated overnight work.
2. `066b438` — `feature/material-upgrades`.
3. `96c7c54` — `feature/pro-shop-equipment`.
4. `67638de` — `feature/store-display-assets`.
5. `05b6de1` — `feature/furniture-catalog`.
6. `fd4e5ae` — `feature/store-generation`.
7. `9e8bd3b` — `feature/course-1-failing-municipal`.
8. `e997f75` — `overnight/property-expansion-world-overhaul`.
9. `1c9acab` — `feature/final-polish`.

The remaining local tips were already ancestors of the consolidated furniture branch and were not merged a second time. Backup, historical, detached validation, and dirty-worktree overlays were retained but not mutated. After reconciliation, `git merge-base --is-ancestor` confirmed all 41 local branch tips are contained by the integration branch.

Semantic repair commits were then applied in dependency order: shared runtime (`8b1bef1`), packaged assets (`4e3c104`), save authorities (`9f52f6a`), receiving (`99f361b`), shop layout (`a8359fd`), player-facing business contracts (`f061b91`), checkout (`45d1761`), release/Electron (`1591412`), migrated inventory (`aa3b8a9`), and municipal restoration (`a6104e3`). Final browser-discovered repairs are recorded in `conflicts-resolved.md`.

Final stabilization followed with physical golf/check-in and current checkout QA (`d170c12`), then the cross-mode laptop/tool-wheel repairs and their browser regression route (`04cf42a`). The nine audit documents were committed only after the post-fix full suite passed.
