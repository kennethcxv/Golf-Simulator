# Branch and ref comparison

Every branch, worktree HEAD, tag and custom ref in the repository, with its
relationship to the integration base (`tcg-checkout` @ `25fbdce`) and its
disposition.

## Topology

| Ref | Head | Merge base w/ 25fbdce | Unique to it | Unique to tcg | Verdict |
|---|---|---|---|---|---|
| `main` | 0c5137e | 0c5137e | **0** | 127 | strict ancestor — nothing to rescue |
| `checkpoint/course-master-final-20260717` | fd435a5 | fd435a5 | **0** | 50 | strict ancestor — checkpoint only |
| `course-editor-pre-rebuild` | 591f839 | 591f839 | **0** | 107 | strict ancestor — checkpoint only |
| `tcg-checkout-pre-kit` | 75da6eb | 75da6eb | **0** | 116 | strict ancestor — checkpoint only |
| `8ae51d4` (cashier-repair wt) | 8ae51d4 | 8ae51d4 | **0** | — | strict ancestor |
| **`course-takeover-claude`** | 3a230a0 | a34a2c8 | **8** | 23 | **diverged — integrated selectively** |
| **`refs/snapshots/claude-assets-51-100-takeover`** | 94a1711 | 8ae51d4 | **6** | — | **content == working tree; integrated** |
| `2914ed0` (cashier-staged wt) | 2914ed0 | 7e3aa71 | 1 | — | superseded |
| `refs/takeover/safety-snapshot` | a718095 | 8ae51d4 | 1 | — | pre-work checkpoint |
| `refs/takeover/snapshot-pre-claude` | 5d1e802 | 8ae51d4 | 1 | — | pre-work checkpoint |
| `refs/codex/checkpoints/box-system-pre-rebuild` | 68ebb7a | fe0a084 | 1 | — | pre-rebuild checkpoint |

Four of the six branches carry **zero** unique commits — they are pure
checkpoints. Only two refs carried substantial unique work.

`main` is 127 commits behind and contains nothing absent from the integration
base. **`main` was not modified.**

## Base selection

Base chosen: **`tcg-checkout` @ `25fbdce`**.

Rationale, on evidence rather than branch naming:

1. It is the most advanced shared architecture — 127 commits past `main`, and a
   strict superset of four of the five other branches.
2. It already contains the committed checkout, clubhouse, asset and course work.
   Basing anywhere else would have meant replaying it.
3. The uncommitted working tree sits directly on it, and that tree is
   byte-identical to the assets 51–100 session's own snapshot. Any other base
   would have required rebasing ~50k lines of uncommitted work.
4. `course-takeover-claude` (the only genuine alternative) carries 8 commits but
   is missing 23 that `tcg-checkout` has, including all the checkout and asset
   work. Its 8 were replayed onto this base instead.

## The duplicate-implementation problem

The central finding of this audit. `tcg-checkout` and `course-takeover-claude`
**independently implemented the same three fixes**:

| `tcg-checkout` (already on base) | `course-takeover-claude` (candidate) |
|---|---|
| `14e9d4e` every pond gets its own shoreline, not a disc | `a4bc3d2` every pond gets its real shoreline, not a bounding-box disc |
| `10f2971` the property stops reading as a slab on a plain | `b67fb3f` the property stops reading as a rectangle on the landscape |
| `5cd07f4` a terrain stroke stops rebuilding the whole course | `6cd6c80` terrain strokes go from 5 FPS to 87 FPS |

A wholesale `git merge` would have produced duplicate implementations of pond
tracing, boundary shaping and terrain-stroke scoping. Each pair was analysed
independently before any merge, and **none of the three resolved to a plain
"take one side"**:

- **Ponds → merge both.** They fix opposite halves. Taking either alone leaves a
  reachable circular fallback or a mis-aligned shoreline.
- **Boundary → A's geometry + B's shader.** They diagnosed different root causes;
  A is geometric only and leaves a ~1.7× tonal step.
- **Perf → take B wholesale.** B is a strict superset; A scoped only the position
  write and left three unscoped 346,801-vertex passes per tick.

See `workstream_inventory.md` for per-commit reasoning.

## Per-commit disposition: `course-takeover-claude` (all 8)

| Commit | Subject | Disposition | Landed as |
|---|---|---|---|
| `aa5ec1b` | build(course): make this branch stand alone… | **PARTIAL** | `3009aa3` (QA file only) |
| `6cd6c80` | perf: terrain strokes 5 → 87 FPS | INTEGRATE | `ec56171` (group) |
| `2588a0a` | perf: scope rebuild for stamps/feature edits | INTEGRATE | `ec56171` (group) |
| `f9f95a5` | perf: upload only the edited buffer span | INTEGRATE | `ec56171` (group) |
| `4d9c215` | perf: undo/redo refresh only the reverted op | INTEGRATE | `ec56171` (group) |
| `b67fb3f` | fix: property stops reading as a rectangle | **PARTIAL** | `bcb718b` (shader hunk only) |
| `a4bc3d2` | fix: every pond gets its real shoreline | INTEGRATE (composite) | `813ede4` |
| `3a230a0` | fix(course-editor): camera stops fighting… | INTEGRATE | `40e48b7` |

### Rejected hunks, and why

**`aa5ec1b` → `src/render3d/clubhouse.js` (2 hunks, +59/−4): REJECTED.**
Self-labelled temporary bridge code:

> `// BRIDGE — drop this block when clubhouse.js is merged from the concurrent`
> `// checkout workstream, which owns the fuller version of this helper.`

Its stated exit condition is met — the working tree already carries
`CLUBHOUSE_GTAO_EXCLUSION_CLEARANCE_YD`, `pointInsideClubhouseInterior`,
`clubhouseInteriorGtaoExcludedAt` and the `isInside` `axialMargin` rework, with
function bodies byte-identical apart from comment prose. Applying it would emit a
second `export function pointInsideClubhouseInterior` — an ESM duplicate-export
`SyntaxError` that fails module load. `git apply --check` confirms:

```
error: patch failed: src/render3d/clubhouse.js:139
error: src/render3d/clubhouse.js: patch does not apply
```

**`b67fb3f` → ring geometry hunks: REJECTED in favour of the base's.**
The base's geometry is C1-continuous (smoothstep, zero derivative at the
boundary) where `b67fb3f` is only C0 and introduces a slope kink of `−edgeH/260`
starting at the property line. The base also resolves the straddling quad 1.65×
finer (34 yd vs 56 yd) and keeps a z-fight floor. Only the colour hunk was taken.

## Worktree disposition

| Worktree | Unique uncommitted work | Unique commits | Action |
|---|---|---|---|
| `.claude/worktrees/course-takeover` | none (clean) | 8 — all dispositioned above | retained; work integrated |
| `Golf-Flipper-cashier-repair-validation` | none (clean) | 0 | retained; nothing to integrate |
| `Golf-Flipper-cashier-staged-validation` | none (clean) | 1 — superseded | retained; nothing to integrate |

No worktree was deleted. All three were verified clean before any decision.

### `2914ed0` supersession — verified, not assumed

Dated 2026-07-18 06:19, ~6 h before the integrated work. 47 of its 69 files are
already byte-identical on the integration branch. The 22 that differ are older
there, not newer:

| | `2914ed0` | integration HEAD |
|---|---|---|
| `PERFORMANCE_SCHEMA_VERSION` | 3 | **4** |
| `simplified-register-performance.mjs` | 154,038 B | **177,726 B** |
| `transactionStabilityReport` signature | `(start, afterFirstSale, end)` | **`(start, afterFirstSale, afterWarmSale, end)`** |

An initial symbol scan appeared to show `transactionStabilityReport` missing from
HEAD; that was a false alarm caused by a `^function` regex that missed
`export function`. It is present at
`tools/qa/simplified-register-performance.mjs:2825` and referenced by three test
files. Nothing is stranded.
