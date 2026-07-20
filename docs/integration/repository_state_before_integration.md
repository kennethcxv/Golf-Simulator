# Repository state before integration

Recorded at the start of the master integration audit.

## Timing

| Field | Value |
|---|---|
| Audit started | 2026-07-18 12:38:01 PDT (19:38:01 UTC) |
| Integration executed | 2026-07-18 21:57 – 22:30 PDT |
| Starting branch | `tcg-checkout` |
| Starting HEAD | `25fbdceee77e2904277ab4af2eb0fd661cf410df` |
| HEAD subject | fix(assets): connect the parts that were floating apart |
| HEAD author/date | Kenneth Camacho, Sat Jul 18 12:19:21 2026 -0700 |
| Git operation in progress | none (no MERGE_HEAD / REBASE / CHERRY_PICK / BISECT / SEQUENCER) |

## Concurrency check — the critical operating rule

The audit opened with evidence that **another session was actively writing to the
repository**, so no index-modifying work began until exclusivity was established.

Evidence of concurrent activity found at audit start:

| Time | Artifact | Meaning |
|---|---|---|
| 12:25:21 | `src/render3d/assets51to100/propPlacement.js` modified | assets 51–100 session editing |
| 12:29:14 | `src/render3d/clubhouse.js` modified | hot shared file being edited |
| 12:35:29–34 | 8 PNGs in `qa/assets_51_100_master/claude_completion/props_71_100/` | live QA capture run |
| 12:36:04 | `refs/snapshots/claude-assets-51-100-takeover` created (305 files, +49,984) | another session's safety snapshot |
| 12:36:05 | `.git/sg-hook-once-toolu_01XtDvCHwXtbyUiPLzSou8x6` | hook marker keyed to another session's tool-use id |
| 12:37:28 | `.git/index` rewritten + ~17 new loose-object dirs | blobs written — a `git add`, not a status refresh |
| 12:20:44 | `course-takeover-claude` commit | second session, in its own worktree |

`.git/index` mtime held at 12:37:28 across two samples 24 s apart, so the audit's
own `git status` did not cause it; and `git status` never writes blobs.

**Resolution.** A 30-sample watcher (12:39:35 → 12:44:31, 10 s interval) recorded
identical `(index mtime, worktree hash, refs hash)` triples throughout. The session
was then idle ~9 h. On resumption at 21:57 the state was **re-verified rather than
assumed**:

- index mtime, worktree hash and refs hash byte-identical to the 12:44 sample
- zero files in the repository modified since 12:45:00
- zero reflog entries after 12:20:44
- exactly one `claude.exe` running (PID 79520, started 12:37:04) — this audit's own

9 h 13 m of total quiescence established exclusive ownership on evidence.

## Inventory at audit start

| Category | Count |
|---|---|
| Changed paths (`git status --short`) | 295 (149 M, 145 ??, 1 D) |
| Untracked files (expanded) | 156 |
| **Staged paths (index vs HEAD)** | **0 — index tree == HEAD tree (`4bb9587`)** |
| Tracked files at HEAD | 2,560 |
| Local branches | 6 |
| Remotes | **none configured** |
| Worktrees | 4 (1 primary + 3 secondary) |
| Stashes | 0 |
| Tags | 4 |
| Custom refs | 4 (`refs/snapshots/`, `refs/takeover/` ×2, `refs/codex/`) |

The index being clean is significant: Phase 4's "mixed staged index" scenario did
not exist. Nothing had to be unstaged or rebuilt by hunk.

### Worktrees

| Path | HEAD | Branch | Dirty |
|---|---|---|---|
| `Golf-Flipper` (primary) | 25fbdce | tcg-checkout | 295 paths |
| `.claude/worktrees/course-takeover` | 3a230a0 | course-takeover-claude | **clean** |
| `Golf-Flipper-cashier-repair-validation` | 8ae51d4 | detached | **clean** |
| `Golf-Flipper-cashier-staged-validation` | 2914ed0 | detached | **clean** |

No uncommitted work was stranded in any secondary worktree.

## Safety refs created

All created before any index or branch mutation. The working-tree snapshot was
built with a **temporary `GIT_INDEX_FILE`**, so the real `.git/index` was never
touched — verified by mtime before and after (`1784403448` unchanged).

| Ref | Object | Contents |
|---|---|---|
| `refs/integration-audit/head-tcg-checkout` | `25fbdce` | starting HEAD |
| `refs/integration-audit/worktree-snapshot` | `67d0c37` | **full working tree**: tracked + untracked (2,715 files, +155 over HEAD) |
| `refs/integration-audit/qa-evidence` | see note | gitignored `/qa/` evidence, preserved separately |
| `refs/integration-audit/worktree-course-takeover` | `3a230a0` | course-takeover worktree HEAD |
| `refs/integration-audit/worktree-cashier-repair` | `8ae51d4` | cashier-repair worktree HEAD |
| `refs/integration-audit/worktree-cashier-staged` | `2914ed0` | cashier-staged worktree HEAD |
| `refs/integration-audit/preexisting-assets51100-snapshot` | `94a1711` | other session's snapshot, re-pinned |
| `refs/integration-audit/preexisting-takeover-safety` | `a718095` | pre-existing, re-pinned |
| `refs/integration-audit/preexisting-takeover-preclaude` | `5d1e802` | pre-existing, re-pinned |
| `refs/integration-audit/preexisting-codex-boxsystem` | `68ebb7a` | pre-existing, re-pinned |

### Snapshot fidelity verified

`refs/integration-audit/worktree-snapshot` (`67d0c37`) and the other session's
`94a1711` have **byte-identical trees** (`65e362ea1a172b8952eea4d80757c892e9c2c2e7`).
The working tree on disk was exactly the assets 51–100 snapshot; nothing was lost
or torn. Blob-level spot checks all matched disk:

```
src/data/cleaningTools.js                   snap=83c8d3f  disk=83c8d3f  OK
src/render3d/toolSockets.js                 snap=9dac967  disk=9dac967  OK
src/render3d/toolViewmodel.js               snap=6b84f5c  disk=6b84f5c  OK
src/sim/cleaningDebris.js                   snap=dddc828  disk=dddc828  OK
src/render3d/assets51to100/propPlacement.js snap=c909fd5  disk=c909fd5  OK
src/render3d/clubhouse/boxPlacementMode.js  snap=937deb2  disk=937deb2  OK
```

## Baseline test result (pre-integration)

Run on the starting working tree before any commit:

```
# tests 1641   # pass 1641   # fail 0   # skipped 0   # duration_ms 267567
```

This green baseline is the bar the integration had to preserve.

## Destructive operations

None used. No `reset --hard`, `clean`, `checkout -f`, `push --force`, `prune`, or
`gc` was run at any point. Git emitted "too many unreachable loose objects;
run 'git prune'" repeatedly; prune was deliberately **not** run.

The integration branch was created by repointing HEAD with `git symbolic-ref`
rather than `git checkout`, so a 295-path dirty tree was never at risk from a
branch switch.
