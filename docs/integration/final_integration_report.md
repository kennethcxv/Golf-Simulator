# Final integration report

**Integration branch:** `integration/all-verified-work-2026-07-18`
**Final local hash:** `bcb718bac1c119284531a64d37564fe6e448a1c5` (+ a docs commit)
**Remote hash:** — **no remote is configured on this repository**
**Is main safe to merge:** **No — not yet.** See §33.

---

## 1. Starting branch and hash

`tcg-checkout` @ `25fbdceee77e2904277ab4af2eb0fd661cf410df`
"fix(assets): connect the parts that were floating apart", 2026-07-18 12:19:21 −0700.

## 2. Safety refs created

Ten durable refs, all created before any index or branch mutation. The
working-tree snapshot was built with a temporary `GIT_INDEX_FILE`; the real
`.git/index` mtime (`1784403448`) was verified unchanged before and after.

| Ref | Object |
|---|---|
| `refs/integration-audit/head-tcg-checkout` | `25fbdce` |
| `refs/integration-audit/worktree-snapshot` | `67d0c37` |
| `refs/integration-audit/qa-evidence` | ignored `/qa/` evidence |
| `refs/integration-audit/worktree-course-takeover` | `3a230a0` |
| `refs/integration-audit/worktree-cashier-repair` | `8ae51d4` |
| `refs/integration-audit/worktree-cashier-staged` | `2914ed0` |
| `refs/integration-audit/preexisting-assets51100-snapshot` | `94a1711` |
| `refs/integration-audit/preexisting-takeover-safety` | `a718095` |
| `refs/integration-audit/preexisting-takeover-preclaude` | `5d1e802` |
| `refs/integration-audit/preexisting-codex-boxsystem` | `68ebb7a` |

**All safety refs are retained.** None deleted.

## 3. Branches reviewed

All 6. Four carry **zero** unique commits (`main`, `checkpoint/course-master-final-20260717`,
`course-editor-pre-rebuild`, `tcg-checkout-pre-kit`). One is the base. One
(`course-takeover-claude`) had 8 unique commits, all dispositioned.

## 4. Worktrees reviewed

All 4. The three secondary worktrees were **all clean** — no stranded uncommitted
work. None deleted.

## 5. Stashes reviewed

Zero stashes existed.

## 6. Staged files reviewed

**Zero.** Index tree == HEAD tree (`4bb9587`). Phase 4's mixed-index scenario did
not exist; nothing had to be unstaged or rebuilt by hunk.

## 7. Unstaged files reviewed

149 modified + 1 deleted, all classified and committed across 15 workstream
commits. The deletion was half of a directory-rename typo fix.

## 8. Untracked files reviewed

156 files, including production source that was tracked by nothing —
`src/data/cleaningTools.js`, `toolSockets.js`, `toolViewmodel.js`,
`cleaningDebris.js`, the whole `assets51to100/` runtime, and four
`clubhouse/box*`/delivery modules. All committed except one stray screenshot.

## 9. Ignored QA evidence reviewed

`/qa/` is gitignored by policy. Evidence preserved in
`refs/integration-audit/qa-evidence` rather than committed, satisfying both
"preserve ignored QA evidence" and "no large QA screenshots committed".

## 10. Commits integrated

20 on the integration branch: 15 working-tree workstream commits, 5 course
commits (`3009aa3`, `40e48b7`, `ec56171`, `813ede4`, `bcb718b`).

## 11. Commits rejected

- `aa5ec1b` → `src/render3d/clubhouse.js` hunks — self-labelled bridge scaffolding;
  would emit a duplicate ESM export and break module load
- `b67fb3f` → ring geometry hunks — base geometry is C1-continuous and finer

## 12. Commits superseded

`2914ed0`, `68ebb7a`, `a718095`, `5d1e802` — all preserved as refs, all verified
superseded on evidence (schema versions, file sizes, function signatures, dates).

## 13. Manual hunk merges

Four conflict regions, all resolved deliberately:

| File | Region | Resolution |
|---|---|---|
| `courseScene.js` | `rebuildTerrainHeights` body | incoming |
| `courseScene.js` | `refreshGround` terrain-rect argument | incoming |
| `ui/courseEditor.js` | `liveRefreshThrottled` | incoming |
| `ui/courseEditor.js` | `applyTerrainAt` rect accumulation | incoming |

Plus two hand-authored composites (pond fallback chain, ring colour + geometry)
and one hand-written regression fix (`placeSpot`).

## 14. Shared-file conflicts resolved

`src/render3d/courseScene.js` — merged three times (perf, ponds, boundary).
`src/ui/courseEditor.js` — two conflicts. `src/main.js` — auto-merged; verified
the incoming touches a *different* keydown listener than the working tree's
rewrite. `src/render3d/clubhouse.js` — conflict avoided by rejecting the bridge.

## 15. Temporary bridge code removed

One block, `aa5ec1b`'s `clubhouse.js` hunks, self-labelled
`// BRIDGE — drop this block when clubhouse.js is merged from the concurrent
checkout workstream`. Exit condition met; rejected. No bridge code remains.

## 16. Course work integrated

Editor performance (4 commits), pond shorelines (composite), property boundary
(composite + regression fix), editor input handling.

## 17–18. Assets 1–50 and 51–100 integrated

Blender sources, GLBs and runtime bindings committed (`62a5c94`, `ad44507`).
**Not re-verified at runtime** — see §29.

## 19. Checkout integrated

`46deabb`. Contract tests pass. **No live transaction driven** — see §29.

## 20. Cleaning systems integrated

Registry, sockets, viewmodels, hands, debris, wetness, gameplay integration
(`ef4e3fe`, `9f1245e`, `2192d2f`, `bb1ced1`, `cfff3b9`). **Not exercised at
runtime** — see §29.

## 21. Save migrations reconciled

One coherent latest version: **10**. Base and `course-takeover-claude` were both
at 6; only the working tree bumped. No competing bumps, no fields discarded.

## 22. Full test result

**1658 tests, 1658 pass, 0 fail, 0 skipped.** Baseline was 1641/1641; net +17,
all from integrated course work. No test weakened, skipped or deleted.

## 23. Runtime smoke result

App boots in Chromium, loads a course, opens the editor, accepts a 225-frame
terrain drag, undoes correctly. `console: []`, `pageErrors: []`.

## 24. Course-editor performance result — measured on this branch

| Metric | Target | Measured |
|---|---|---|
| Terrain-edit FPS | ~80+ (was ~5) | **136.3** |
| Frames > 100 ms | none | **0** |
| Worst frame | tens of ms (was >1 s) | **41.6 ms** |
| Undo integrity | — | **0 differing of 1,040,403 components** |

Scoped vs unscoped: live tick 1126 → **0.4 ms**; stamp 202.7 → **19.9 ms**;
undo 1145.1 → **30.1 ms**.

Caveat: 18 frames exceeded 33 ms (source branch reported 0) and worst frame was
41.6 ms vs 25.1 ms there — different machine, partly under concurrent load. Both
still inside target.

## 25. Checkout result

Contract/unit tests pass within the 1658. **No live card or cash transaction
run.**

## 26. Cleaning-tool result

Unit tests pass within the 1658. **No tool equipped at runtime; no effect,
socket, audio or wall-occlusion behaviour observed.**

## 27. Save/reload result

Ten save-related test files pass. **No live save written, migrated and reloaded.
A v6 → v10 migration has not been exercised against a real on-disk save.**

## 28. Remaining worktree differences

None. All three secondary worktrees are clean and carry no unique unintegrated
work. `course-takeover-claude`'s 8 commits are all dispositioned; the branch
itself is unchanged and still available.

## 29. Remaining limitations

1. **Cleaning and checkout were never exercised at runtime by this audit.** They
   were committed verbatim from an already-green tree and no line was modified,
   so merge risk is near zero — but independent runtime verification did not happen.
2. **v6 → v10 save migration untested against a real save file.** Highest-value
   remaining gap; it is the defect class that would reach players with existing saves.
3. **Visual criteria verified structurally, not visually.** "No hard property
   edge" is verified numerically (1.00× luminance ratio); "no circular fallback
   ponds" structurally (disc unreachable behind the tracer). Neither was
   eyeballed on this branch.
4. **Blender regeneration and clean reimport not re-run.** Assets arrived
   pre-built; source-session evidence preserved but not regenerated.
5. **Phase 11 metrics not captured:** draw calls, triangles, materials, textures,
   heap growth, listeners, mixers, audio nodes, particles, save/load duration.
6. **Intermediate commits are not individually bootable.** The tree was developed
   as one interdependent unit; the split is for reviewability. Only the tip is
   verified green.
7. **Pond tracer caveat carried forward:** edge map keyed by start vertex can drop
   an edge at a checkerboard pinch; no island holes; no automated shoreline test.
8. **~40 other `tools/qa/*.js` files still hardcode port 8457.** Only
   `course-master-final.js` was fixed.
9. **Repository has many unreachable loose objects.** Git warns on every write.
   `prune`/`gc` deliberately not run.

## 30. Integration branch name

`integration/all-verified-work-2026-07-18`

## 31. Final local hash

`bcb718bac1c119284531a64d37564fe6e448a1c5` (before the docs commit; see git log
for the tip).

## 32. Remote hash

**None.** `git remote -v` is empty — this repository has no remote configured.
The branch could not be pushed and no remote was added, since configuring a
publishing destination is not a decision this audit should make unilaterally.

## 33. Whether main is safe to merge

**No — do not merge to main yet.**

Of the eight conditions required, six are met:

| Condition | Status |
|---|---|
| Full suite passes | **yes** — 1658/1658 |
| Course editor performs correctly | **yes** — measured on this branch |
| No unique work in another branch/worktree | **yes** — all dispositioned |
| No unknown staged/unstaged production change | **yes** — only a stray screenshot |
| Integration diff reviewed by workstream | **yes** — 20 commits, one workstream each |
| Runtime smoke passes | **partial** — course only |
| Checkout passes | **not verified at runtime** |
| Cleaning tools pass | **not verified at runtime** |
| Save/reload passes | **not verified against a real save** |

The blocking gaps are runtime verification of checkout and cleaning, and the
v6 → v10 save migration. Those are precisely the areas this audit could not
exercise, and the last one carries real player-data risk.

**Recommendation:** treat this branch as ready for review and manual QA, not for
merge. Run the five checks in `runtime_qa.md` §"Recommended before merging to
main", plus a real v6 save migration. If those pass, main is safe.

`main` was not modified and remains at `0c5137e5f0efac9627ce2309b9e66936f1eeb769`.
`tcg-checkout` remains at `25fbdceee77e2904277ab4af2eb0fd661cf410df`.
