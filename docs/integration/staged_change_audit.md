# Staged change audit

## Finding: the index was clean

Phase 4 anticipates a mixed staged index that must be carefully unstaged and
rebuilt hunk by hunk. **That situation did not exist.**

```
staged paths (git diff --cached --name-only) : 0
index tree                                    : 4bb9587e116c4b63f63d2570a82ea4377259a055
HEAD tree                                     : 4bb9587e116c4b63f63d2570a82ea4377259a055
index tree == HEAD tree                       : YES
```

Nothing was staged. No hunk had to be unstaged, split, or rebuilt, and no staged
content was at risk of being lost.

### Why this needed checking anyway

`.git/index` had been rewritten at 12:37:28 — 33 seconds before the audit's first
command — accompanied by ~17 new loose-object directories. Loose objects mean
blobs were written, which `git status` never does; that is the signature of a
`git add`. So another session *had* staged something shortly before the audit
began.

By the time the index was inspected it matched HEAD exactly. The most likely
explanation is that the other session staged files, produced its snapshot commit
(`94a1711`, 12:36:04), and left the index reset to HEAD. Either way, the
verifiable fact is that no staged content existed to preserve, and the working
tree it had been staging was captured whole in
`refs/integration-audit/worktree-snapshot` before anything else happened.

## What was actually there: 295 unstaged/untracked paths

| Category | Count |
|---|---|
| Modified, tracked | 149 |
| Untracked (status entries; 156 files expanded) | 145 |
| Deleted | 1 |

The single deletion,
`Designs/RefrenceImages/11-20_refrence_imagesz/29E40B57-….png`, pairs with an
untracked `11-20_refrence_images/` — a directory rename fixing a typo, not a
content loss. Both sides were committed together in `2be74c7`.

## How the working tree was committed

Rather than one opaque commit, the tree was split into 15 workstream commits by
**explicit pathspec**. `git add -A` was never used — deliberately, because
`.claude/` was not yet ignored and a blanket add would have committed 2,617 files
including a nested worktree `.git`, corrupting the repository. That exposure was
closed first, as commit 1 (`10aae84`).

| # | Commit | Paths | Workstream |
|---|---|---|---|
| 1 | `10aae84` | `.gitignore`, `package.json`, `package-lock.json` | build/runtime |
| 2 | `ef4e3fe` | `cleaningTools.js`, `toolSockets.js`, `toolViewmodel.js`, `cleaningDebris.js`, `cleaningWet.js`, `core/audio.js` | L |
| 3 | `9f1245e` | `fpHands.js`, `mouseLook.js` | M |
| 4 | `2192d2f` | `courseScene.js`, `clubhouse/washing.js` | N/O/P/Q |
| 5 | `ad44507` | `src/render3d/assets51to100/` | H |
| 6 | `d557b90` | box placement, cutter path, carry profile, packaging | K |
| 7 | `46deabb` | `sim/checkout.js`, register mode, catalog visuals, fixture slots | I |
| 8 | `3f80740` | `clubhouse.js` + 11 clubhouse/sim/data files | J |
| 9 | `ddf4ff6` | `src/sim/state.js` | R |
| 10 | `bb1ced1` | `ui/ui.js`, `styles.css` | L/P |
| 11 | `cfff3b9` | `src/main.js` | L/M wiring |
| 12 | `513d9a4` | `tests/` (68 files) | T |
| 13 | `8c62535` | `tools/` (78 files) | E/G/T |
| 14 | `62a5c94` | `Assets/`, `asset_sources/`, `vendor/` (89 files) | E/G |
| 15 | `2be74c7` | `qa/` tracked manifests, `Designs/` (24 files) | T |

## Integrity: nothing lost

The integration tip was diffed against the pre-integration working-tree snapshot:

```
git diff --name-status 67d0c37 HEAD   (excluding .claude/)
  M  .gitignore
  D  asset26-in-game.png
  → 2 differences total
```

Both are intentional:

- `.gitignore` — the `/.claude/` exclusion added as commit 1.
- `asset26-in-game.png` — a stray QA screenshot at the repository root,
  deliberately **not** committed. It remains untracked on disk and is preserved
  in `refs/integration-audit/worktree-snapshot`.

Every other byte of the 295-path working tree is on the integration branch.

## Honest limitation of the split

The 15 commits are split for **reviewability, not bisectability**. The originating
session developed this tree as one interdependent unit — `clubhouse.js` imports
`cleaningTools.js`, `courseScene.js` imports `toolSockets.js`, and the tests
arrive in commit 12 while the code they cover lands in commits 2–11.

Individual intermediate commits are therefore **not guaranteed to boot or pass
tests in isolation.** What is guaranteed, and verified, is that the tip of the
series is green (1658/1658) and byte-identical to the working tree that was
already green at baseline (1641/1641).

Claiming per-commit greenness here would have required rewriting the source
session's work into an artificial dependency order, which would have meant
modifying code this audit had no mandate to change. The split was kept honest
instead.

## Ignored files

`/qa/` is gitignored by repository policy. The QA evidence produced by the source
sessions — completion screenshots, `clean_reimport.json` — was therefore **not**
committed to the branch. It is preserved separately in
`refs/integration-audit/qa-evidence`, satisfying "preserve ignored QA evidence"
without violating "no large QA screenshots committed unless repository policy
requires them".

The 12 *tracked* files under `qa/` (derived status manifests, tracked before this
audit despite the ignore rule) were committed normally in `2be74c7`.
