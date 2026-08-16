# GOAL 28 — LOAD AND FIRST PRESSES

**Probe lies this goal: 0 so far.** (Carried context from Goal 27's front:
the census program-counter control is VOID until fixed — any program-count
claim below that relies on it will be labeled. Frame/time claims don't.)

---

## PHASE 0 — BISECT THE AFTERNOON

**The question:** attr-cold read 30.7 s at 12:37 on `a9b6d2b`'s tree; the
same instrument reads a 64.4 s cold median tonight. Code, or machine?

**Method, written before the numbers:** worktree at `a9b6d2b` (the commit
that published attr-cold, 12:39) at `C:\gfb0` per the baseline-worktree
recipe — junctioned node_modules, `build-vendor-models` regenerated (126
copied, 0 problems), GLBs verified binary (glTF magic, no LFS pointer
wedge). The 12:37 tree's OWN load-breakdown driver runs, three cold boots
(run-electron default = fresh profile each), inner exit codes read
directly. Both of the driver's live negative controls must pass per run.

**Decision rule, also written first:** tonight's main-tree cold runs span
49.5–69.1 s (median 64.4). If the baseline median lands inside that band,
the regression is NOT in the code — bisect stops there, per the brief. If
the baseline median reads ≤ ~40 s (clearly below the band), the afternoon's
commits contain the regression and the bisect walks forward:
`fce48b2` (13:27) → `fffdeec` (13:52, slot-shape unification — runtime
materials) → `2ed151f` (14:13, untextured join — runtime) → `fd7c8d7`
(14:50) → `ec2b917` (15:52, stall bailout — runtime prewarm) → `d4b0d8e`
(16:29) → tonight's merge. Ambiguous middle (~40–50 s): more runs before
any claim.

**RESULT — THE REGRESSION IS NOT IN THE CODE. BISECT STOPPED.**

| tree | tier | three runs | median |
|---|---|---|---|
| `a9b6d2b` (12:37, measured 30.7 s that hour) | COLD | 83.8 / 91.5 / 116.7 s | **91.5 s** |
| main tonight (for reference) | COLD | 49.5 / 64.4 / 69.1 s | 64.4 s |

Every run's two controls passed (planted stall caught; segment sums
exact); inner exit codes 0, read directly. The baseline shows the same
signature — 2–3 giant single rAF gaps, up to **51.6 s** in one draw. It
reads WORSE than main because it predates `ec2b917`'s stall bailout,
which caps how long a stalled warm draw can hang; that is corroboration
of the machine story, not a code lead.

**What this means:** the same tree measured 30.7 s at 12:37 and ~91.5 s
tonight. Whatever degrades this machine arrived this afternoon, is not
any commit, and survives reboot + DXCache clear + quiet CPU. Per the
brief's own rule, the afternoon's optimisation numbers were measured
against noise, and timing-based acceptance is suspect until the machine
reads healthy again.

**Consequence for the phases (brief rule applied):** the machine is
adding 15–35 s of noise to LOAD-SCALE timings. Phases proceed, but every
acceptance leans on counts and on deltas larger than their slice's
measured noise band: Phase 1 verifies by module-request count (290 → 1)
with renderer→menu timing as support (that slice's noise is ±0.5 s, and
it is degradation-independent); Phase 2 by the two sync blocks' presence/
absence in the gap log (2.3 s and 1.2 s single gaps), not by total load;
Phase 4 by first-vs-second-press deltas (the per-surface control
subtracts the ambient floor). No total spawn→playable claim will be made
for any change until the machine is healthy.

---
