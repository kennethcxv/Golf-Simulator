# GOAL 28 — LOAD AND FIRST PRESSES

**Probe lies this goal: 1.** The P1 `moduleRequests` probe read 0 src
requests in BOTH the unbundled and bundled configurations — Electron
`file://` module loads emit no resource-timing entries at all (this also
retroactively explains every empty `slowResources` list in the Goal 27
runs). A probe that reads the same value in both worlds measures nothing;
it is void and labeled so. The request-collapse claim rides the esbuild
metafile (272 inputs) and the flat timing instead. (Carried context from Goal 27's front:
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

## PHASE 1 — THE MODULE GRAPH: BUNDLED, MEASURED, REFUTED, REVERTED

**Before (tonight's tiers, renderer→menu):** cold 1968.2 / 2079.4 / 1945
(median **1968**), warm 1933.1 / 1957.9 / 1924.4 (median **1933**).
Noise band ±80 ms.

**The change:** `tools/bundle-app.mjs` (esbuild; `three` and
`three/addons/*` external per the import-map rule) collapsed the live
graph — **272 modules by esbuild metafile** — into one 5.76 MB ESM file;
two one-line source fixes made the graph bundle-safe (recastNav and the
two debug imports now resolve via `document.baseURI`, correct in both
worlds). Boots clean, zero page errors.

**After:** cold 1913.5 / 1907.6 / 1870.5 (median **1908**), warm 1923.4 /
1932.2 / 1924.6 (median **1925**). Delta −60 ms cold / −8 ms warm.

**Verdict: the lever is dead — the ~1.9 s slice was never module
fetching.** index.html is reverted to the unbundled graph (the
no-build-step contract is worth more than −60 ms); the bundler tool and
the two base-anchored fixes stay.

**Where the slice actually goes** (new permanent seam:
`performance.mark('app-eval-start')` after main.js's import block, i.e.
after the ENTIRE static graph incl. three evaluates; driver now reports
pageMarks):

| segment | cold | warm |
|---|---|---|
| renderer origin → app-eval-start (fetch+parse+eval of all 272 modules + three) | 862 ms | 877 ms |
| app-eval-start → menu interactive (the app's own top-level init + menu mount) | 1042 ms | 1054 ms |

The bigger half is app init, not loading — that block is main-thread and
belongs to the same family as Phase 2's two blocks. It gets attributed
(not guessed) when Phase 3 touches the menu region.

## PHASE 2 — THE TWO MAIN-THREAD BLOCKS: ATTRIBUTED EXACTLY, THE FREEZE MADE INVISIBLE

**Measured before any change** (new marks `ng-stategen-*`,
`scene-construct-*`, driver reports pageMarks; p2-attr-idlecold):
- Block A = `newStarterEmpire` alone: **2,240 ms**, synchronous, in the
  click handler — and the veil historically rose AFTER it (veilShown ≈
  4607 > stategen-end ≈ 4384 in every pre-change run). The player click
  froze the MENU for two-plus seconds with no acknowledgment at all.
- Block B = `makeCourseScene`: **1,040 ms**, already behind the veil.
- `bootEmpire` returns in 0.6 ms; autosave ≈ 146 ms. The old "teardown"
  guess was wrong on a fresh boot — teardown is a no-op there.

**The change:** the veil rises FIRST in `onNewGame` ("Founding the club"),
with a double-rAF yield so its frame reaches the compositor before the
block lands; `veil.show()` made null-empire-tolerant (it used to read
`activeState(app.empire)` and threw — caught by a watched-fail boot, fixed,
and the fallback name is exactly right for a new game). One frozen-menu
regression pin updated for shape, contract intact
(`walk-key-consumption`: inputProbe still imported exactly once, still
dev-gated).

**Why no worker and no construction chunking:** the veil's photograph
drift/dissolve is CSS transform+opacity — compositor-threaded, immune to
main-thread blocks. VIEWED CLIP (`qa/clips/p2-veilfirst/`, frames mapped
by the run's own marks): frame 43 veil card up one frame into the block;
frames 60 → 70 → 80 show the plate dissolving IN while stategen still
blocks (ends at 83); frame 86 the same through makeCourseScene. The
loading state demonstrably animates through both blocks, which is the
brief's experience goal — a worker for state-gen would animate only the
progress bar and walks into the teardown class fce48b2 documents; internal
deferral of scene construction is the room-first ground where debt was
proven conserved. Declined, on that evidence.

**Order invariant, both tiers:** `veilShown <= ng-stategen-start` TRUE in
6/6 verification boots (3 cold, 3 warm). click→scene medians for the
record — cold 6.24 s, warm 3.91 s — carry the machine caveat (the box
sank further during the night; the pre-change warm was ~3.6-3.7 s and the
reorder's honest cost is two veil frames, ~35 ms). Full suite 3685/3685,
lint ratchet clean, inner exits read directly.

## PHASE 3 — MENU-TIME OVERLAP: THE SAFE HALF BUILT, THE UNSAFE HALF REFUSED WITH EVIDENCE

**Module warm during menu: already free.** The P1 seam proves the entire
272-module graph (three included) finishes evaluating at ~862 ms — before
the menu exists. There is nothing left to warm.

**Menu-time STATE speculation: rejected as unsafe, by contract.** The QA
seed pin (tests/qa-boot-seed-pin.test.js) intercepts the Math.random draw
INSIDE the onNewGame stack frame; every deterministic driver and the
golden gate depend on it. A seed drawn during menu idle bypasses the pin
silently. The safe inversion was built instead:

**The New Game click now generates off the main thread.** The seed draw
stays in onNewGame (pin intact); a module worker
(`src/workers/newGameGeneration.js`) runs newStarterEmpire and posts the
RUNTIME empire via structured clone; the main thread adopts it after a
3 ms `ensureCourseMaintenance` heal. Three watched failures shaped it:
1. First worker design posted the SAVE JSON — and the revive
   (`deserializeEmpireWithReport`) blocked the main thread 2,091 ms,
   because a save stores the SEED and revive REGENERATES the course
   (cpu-profile: hash2 / closestOnRoute / designCourse own ~all of it;
   JSON.parse is 3 ms of 3,500). The same cost is what every CONTINUE
   click pays today — measured, named, left as the next lever (the same
   worker+ensure shape fits it).
2. Structured clone drops non-enumerable properties: the first clone boot
   died on `model.runtime.dirtyRows` at the first visuals frame — while
   the serialize-equality fidelity test stayed GREEN (blind to
   non-enumerables). The contract test now sweeps every own property in
   the state graph and demands the runtime slot is the ONLY casualty
   (tests/new-game-worker-contract.test.js).
3. The fallback path was watched failing first: a bogus worker URL boot
   logged the warn and booted clean through synchronous generation with
   the same seed (qa/p3-fallback-control.log).

**Acceptance (machine-independent, per the Phase 0 rule):** the stategen
span's main-thread gap log. Before: one 2,168-2,343 ms single gap in
every boot. After: **zero gaps > 60 ms inside the span** (p3-final-cold1:
span 2,329 ms, gaps [], errs []), tiered verification below. Clone
fidelity 6/6 seeds×modes; fresh-empire save round-trip reports clean;
suite runs after the boots to avoid contending with the gap instrument.

**Tiered verification (7/7 boots):** stategen spans 2,285-2,408 ms with
ZERO main-thread gaps >60 ms inside the span, zero errors, zero
fallbacks — 3 cold, 3 warm, 1 clip run. CLIP VIEWED
(`qa/clips/p3-worker/`): frames 30 and 44, both inside the generation
window (frames 24-48), show two DIFFERENT photographs — the veil
cross-faded plates mid-generation. Suite 3688/3688 after two pin
re-anchors (the seed-pin test moved to the new draw shape and got
stronger: the draw must now also precede the veil's own plate
randomness — the suite caught the seed landing on the photograph when
the veil went first, exactly the class the pin exists for). One
pre-existing flake surfaced twice tonight and is now named:
`goal24-interaction-performance-orchestrator` "never starts a second
Electron child" fails under full-suite CPU pressure and passes 45/45 in
isolation; it predates every Goal 28 change (it is the gate run's
pipe-eaten "fail 1" from before P1 existed) and belongs in HARNESS_DEBT.
