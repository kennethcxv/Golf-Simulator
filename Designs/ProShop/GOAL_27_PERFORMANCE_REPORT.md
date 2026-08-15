# GOAL 27 — PERFORMANCE REPORT

**Probe lies this session: 0** (running total across sessions: 45)

## Phase gate status

| Phase | Status |
|---|---|
| 0 — merged tree | IN PROGRESS — merged + pushed, gate running |
| 1 — loading in | NOT STARTED |
| 2 — first-press stalls | NOT STARTED |
| 3 — mesh merge | NOT STARTED |
| 4 — outdoor collapse | NOT STARTED |
| 5 — low-end target | NOT STARTED |
| 6 — resolution follows monitor | NOT STARTED |

## Before/after table

| Scenario | Before | After | Where measured |
|---|---|---|---|
| _(populated as phases complete)_ | | | |

---

## Phase 0 — start from a tree that has the fixes

**What was merged, on `main`:**

- `2120a77` merges `playtest5/bugs` (8 commits, ending `88b5fbb`): course-editor
  null-scene wedge, deferred-warm dustpan + veil order, queue greeting distance,
  `playerBlocksCustomers` dead flags + ledger hole, crowd clamp per-second,
  register audio material pick + sale-end cue.
- `1f380dc` merges `playtest5/assets` (31 commits, ending `dab3097`): the
  first-person hand adopted 16/16 both hands, the mop head rebuilt through four
  photographed rounds, the broom head verified, the tool-photo QA harness.
- Zero files were touched by both branches since their fork point `d7716d4` —
  the merge had no conflicts.
- `origin/main` (`5a67f29`) was an ancestor of the whole line, so nothing on
  main was overwritten. The old local `main` (an unpushed July integration
  merge, `38fe561`) is preserved as `backup/local-main-pre-goal27`.
- Generated vendor models rebuilt from the merged Assets/: 126 copied, 0 problems.

**The LFS wedge, per your stop order.** 34 GLBs under `vendor/models/` are
stored as raw binary in history where `.gitattributes` says LFS pointer, so
`git status` shows them permanently modified. Answer to your question: **the
merge did not need the fix** — both merges completed conflict-free before I
touched anything, and the wedge blocks nothing tonight. Actions taken:

- `goal27/phase0-pre-lfs-merge` pushed at `1f380dc` — the way back, on the
  remote, independent of this session.
- The renormalize commit was dropped from main and kept as local branch
  `goal27/lfs-renormalize-candidate` for a daylight decision.
- Consequence accepted: 34 files sit in "modified" all night. **Nobody may
  `git add -A` near `vendor/models/`** — this session commits explicit paths
  only. The asset session writes `tools/blender/` and `Assets/models/` and
  should stay path-explicit too: a bare `-A` would silently re-commit the
  renormalize.

**Gate on the merged tree — every red named.** First run: suite 3680/3685,
five reds, gate exit 1 before the golden step. Each one diagnosed:

| # | Test | Cause | Disposition |
|---|---|---|---|
| 1767 | goal24 orchestrator: "never starts a second Electron child" | `spawnSync git` ETIMEDOUT under full-suite parallel load. NOT the LFS wedge — `git status --porcelain=v1 -uall` measures 0.45 s quiet. Passes 45/45 solo. | Environmental flake under load; named, not masked. |
| 1940 | hand materials shared set | Real merge seam: the assets session's Goal 26 hand rounds retuned fpHands SKIN `0xd9a97e -> 0xc4875c`; broomViewmodel's standalone FALLBACK constant stayed behind. The live arms share `fpHands.mats`, so the drawn look was already theirs. | FIXED: fallback aligned to `0xc4875c`. Zero drawn pixels change. |
| 2222 | mop D: bands hang from a collar | INHERITED from `playtest5/assets` (red at their tip too — test+source pair identical there). The approved "point c" design anchors the collar at 0.50 R and reaches the rim with the splayed skirt; settled tips 0.742 R vs the 0.75 bar written against an 0.80 R collar. Their own in-source sweep table documents the non-linearity. | RECALIBRATED bar 0.75 → 0.70 per the owner's recorded method for this test ("update the test to the new ruling"). New in-test control: a splayless barrel MUST fail the bar — watched passing as a refusal. |
| 2223 | mop B: ragged hem | INHERITED, same shape: the bar divided hem spread by the SYNTHETIC rig's length (0.30) while testing the SHIPPED rig, whose bisection cut length to 0.108. Measured spread is 45% of shipped length — deeply ragged. | RECALIBRATED denominator to `SHIPPED_MOP_YARN.length` (claim stays 20%). New in-test control: a uniform cut MUST read machined. |
| 3492 | tuner panel style block findable | CRLF: `core.autocrlf=true` + my fresh checkout rewrote worktree files with CRLF, and the test's regex anchors a literal `;\n`. Content identical to the green-at-88b5fbb bytes. | FIXED: anchor is now `;\r?\n`. Latent repo-wide pattern noted: any `\n`-anchored source scan can break on the next checkout that rewrites its file. |

After fixes: the three repaired files pass 20/20 together; the orchestrator file
passes 45/45 solo. Golden capture + control and a final full gate run follow.

**Re-check of the two load-in faults against the merged tree:** pending golden
(one Electron profile; runs are serialized).
