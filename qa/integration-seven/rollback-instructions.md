# Safe rollback instructions

Do not execute these steps automatically. They are reviewable, non-destructive recovery options that retain every source branch and commit.

## Recorded refs

- Original main: `0c5137e5f0efac9627ce2309b9e66936f1eeb769`
- Backup branch: `backup/pre-seven-branch-integration-20260719`
- Integration branch: `integration/seven-completed-branches-20260719`; required-report commit `ff00fd76c78f04747d38084094ba23a722686587` followed by a clean-release result update
- Validated integration code head before report-only commits: `ec88eba401e812cf131a7008f4ec868e575435f6`
- Furniture source: `b271903ce5d99478f026b0000b344dc957fe1255`
- Inventory source: `12600d497cb94a8c3dd4983c6b311f2687c8e7e5`
- Customer source: `3cfbca443adde45b2f8e224e36b4c88f1483fc65`
- Course source: `2a0ab21a735beb2b011a8625b3bd7a17c0a4391a`
- Golf-operations source: `52cfe7e12b013fc699382e076fe9bc443e77b815`
- Economy source: `16b757055e8887c6dd4e16cc36f693da8138bcb2`
- Player-experience source: `bf072a1e1d26cce631daa19d351525b4d5acf941`
- Excluded active gameplay-progression source: `3ddb082f90cdb78325e633ec722fd04a3bf98fdf`
- Main integration merge commit: `ce1b9d98944efe1e2751d65c4357c0c75bb7d549`
- Post-merge report finalization commit: the commit containing this document; resolve with `git rev-parse seven-overnight-branches-integrated-20260719^{commit}`
- Final main/tag target: `seven-overnight-branches-integrated-20260719^{commit}`
- Integration tag: `seven-overnight-branches-integrated-20260719`

The excluded gameplay-progression worktree must not be used for rollback operations.

## Preferred rollback: revert on main

First preserve any new user work and confirm the current worktree is clean:

```powershell
git status --short --branch
git branch rollback/before-seven-branch-revert-20260719 main
```

If a report-only commit was created after the merge, revert it first only if the QA-file history itself must be removed. Then revert the merge with mainline parent 1:

```powershell
git switch main
git revert <POST_MERGE_REPORT_COMMIT>
git revert -m 1 <MAIN_MERGE_COMMIT>
```

Run `npm ci`, `npm test`, static-server smoke, and Electron launch before sharing the reverted main. Revert creates new commits and does not discard later history. Do not use `git reset --hard`, force-push, worktree prune, or branch deletion.

If the report-only commit should remain, reverting the merge may conflict in `qa/integration-seven/*` because those files were subsequently finalized. Resolve by retaining the audit/rollback reports while removing product changes, then run `git diff --check` and tests before committing the revert.

## Inspection branch at the exact original main

For diagnosis without moving main:

```powershell
git worktree add ..\Golf-Flipper-original-main-inspection -b rollback/original-main-inspection-20260719 backup/pre-seven-branch-integration-20260719
```

This creates a new branch/worktree at the original main commit. It does not rewrite main or any overnight branch. Choose a path that does not already exist and confirm it is outside every active worktree.

## Restore one subsystem selectively

Use the integration log and `checkpoint-results.md` to identify the relevant integration commit. Prefer `git revert <integration-repair-or-feature-commit>` on a review branch, then rerun that subsystem plus checkout, save, and full regression. Do not cherry-pick from or reset to the active gameplay-progression branch.

## Verification after rollback

1. Confirm all seven source branch refs still resolve to the recorded heads.
2. Confirm `overnight/gameplay-progression` still resolves to `3ddb082f...` or its legitimate active-session successor; do not inspect or clean its worktree.
3. Confirm the backup branch still resolves to original main.
4. Confirm no source branch or tag was deleted.
5. Run `git diff --check`, parser checks, `npm test`, server smoke, checkout smoke, save/load, and Electron launch.
6. Record the revert commit and results in a new incident report; do not rewrite this historical integration report.
