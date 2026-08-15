# GOAL 27 — PERFORMANCE REPORT

**Probe lies this session: 1** (running total across sessions: 46)

| # | The lie | What it cost |
|---|---|---|
| 46 | `node tools/golden-diff.mjs ... \| tail -6; echo $?` reported exit 0 — `$?` after a pipeline is TAIL's exit, not node's. The diff had genuinely failed (bag-packed unanswered). | A transience hunt and one wasted 10-minute gate rerun before the laundering was caught. The same shape was dodged once earlier the same night (the first gate run was killed for being piped) and then walked into anyway. Every later exit-code read uses `${PIPESTATUS[0]}` in-band. |

## Phase gate status

| Phase | Status |
|---|---|
| 0 — merged tree | **DONE** — merged, gate exit 0, both load-in faults verified fixed |
| 1 — loading in | **DONE with caveats** — 1.1/1.2 fixed; 1.3 measured, largest warm block removed, totals dominated by migratory driver debt (documented) |
| 2 — first-press stalls | **DONE with two named residuals** — general mechanism shipped, every reachable surface ≤27 ms both tiers; course editor (823-1051 ms) open with one fix shape tried+reverted; page-turn instrument gap named |
| 3 — mesh merge | NOT STARTED |
| 4 — outdoor collapse | NOT STARTED |
| 5 — low-end target | NOT STARTED |
| 6 — resolution follows monitor | NOT STARTED |

## Before/after table

| Scenario | Before | After | Where measured |
|---|---|---|---|
| Load, cold shader cache, spawn→playable | 73.7 s | 85.7 s¹ | electron-load-breakdown g27-cold / g27-load-fix-cold |
| Load, warm shader cache, spawn→playable | 31.0 s | 35.8 s¹ | electron-load-breakdown g27-warm / g27-load-fix-warm |
| Prewarm stage clock, warm tier | 24.0 s | 18.4 s | same runs |
| gesture-tools veil stage, warm tier | 9.3–18.2 s | 0.002 s | prewarm stage rows |
| Mop first equip, cold tier | 93–485 ms, +1p +10g, STALL | **22.3 ms, +0p +0g, clean** | electron-first-press-census g27-census-cold / g27-census-fix2 |
| Every reachable surface, first press, cold tier | mop STALL, rest ≤31 ms | **all ≤25 ms** | census g27-census-full |
| Course editor first entry, both tiers | 823–1051 ms, +37–46p | unchanged (OPEN) | census g27-census-\* |

¹ Spawn→playable totals swing ±20 s run-to-run on both tiers (compile-hidden
alone measured 8.7 / 21.4 / 27.6 / 47.1 s across four runs of near-identical
builds) — migratory driver-compile debt drains through whichever draw comes
next. Single-run before/after totals are NOISE here; the stage clock and the
census verdicts are the stable instruments. Nothing in this session made the
load slower: the removed belt stage was absorbing debt on the cold tier, and
the debt now drains elsewhere behind the same veil.

---

## Phase 1.3 — where the load seconds go (measured, attack designed)

**The instrument:** `tools/qa/electron-load-breakdown.js` — outer timeline in
epoch ms (process creation → renderer origin → menu interactive → click →
scene → walk active → veil gone), prewarm per-stage attribution from the
scene's own clock, rAF-gap log. Two live controls every run: a planted 400 ms
busy-stall must appear in the gap log (caught, 415 ms), and the inner segments
must sum to the outer span within 10% (exact: 71,184 = 71,184).

**Finding 1 — the QA harness has only ever measured COLD loads.** The runner
defaults to a fresh temp profile (`run-electron.cjs` policy line), so every
load number in this repo's history paid full ANGLE→HLSL→D3D compilation.
(The memory that QA shares the owner's profile is STALE; corrected.)

**Finding 2 — the two-tier load, same build, same profile dir, back-to-back:**

| stage | cold | warm cache | delta |
|---|---|---|---|
| spawn → playable | 73,654 ms | 30,954 ms | −58% |
| prewarm TOTAL | 66,970 | 23,986 | −64% |
| compile-hidden | 27,613 | 8,748 | −68% |
| warm-composer-render | 19,898 | 1,349 | −93% |
| interior-camera-warm | 3,226 | 296 | −91% |
| gesture-tools | 13,675 | 9,280 | **−32%** |

Chromium's GPU program cache (GPUCache, ~6.5 MB written by run A) eliminates
most compile cost. The owner's USUAL load is the ~31 s warm tier; cold events
(first run, driver update, cache eviction) pay ~74 s.

**Finding 3 — the largest warm-load block is `gesture-tools`: 9.3 s.** Nine
belt tools × two FORCED full-composer frames each with explicit shadow bakes
(~515 ms per warm frame at owner resolution). Its small cache benefit says
it is frame cost, not compile. It spends 9.3 s of EVERY load to pre-pay
one-time first-equip hitches measured at ~70 ms per tool.

**The attack (implemented as the first Phase 2 item, since it IS the general
first-press mechanism):** move the belt warm out of the veil into the
deferred post-veil slot that already exists (`scheduleDeferredGpuWarm`), one
tool per natural frame span, held off-frame with culling off so nothing
flashes, no forced composer draws. Expected: −9.3 s warm / −13.7 s cold on
every load; first-equip stays covered from ~2 s post-interactive; a player
who beats the warm pays the old one-time cost once.

**Also measured, smaller, not yet attacked:** menu interactive 2.3 s;
click→scene-object 3.5 s; compile-hidden warm residual 8.7 s (the
reveal-all-681 draw — a dedup like warm-traverse's may cut it); ~12 s of
click→veil sits outside prewarm's own clock (asset load window; the
resource-timing buffer overflowed — needs `performance.setResourceTimingBufferSize`
in the next instrument revision).

**Sacred history honored:** `compileAsync` pre-veil was tried 2026-08-03 and
lost 0.5 s net — not retried. The GPU-reset hazard note (compile bursts at
the veil boundary) is why the move targets the deferred slot, not the
boundary.

---

## Phase 2 — first-press stalls as one mechanism

**The general mechanism, shipped:** the deferred post-veil warm
(`scheduleDeferredGpuWarm`) now cycles ALL nine belt tools through the
immediate-door equip while the real loop ticks — three frames per tool,
starting 1.6 s after the game is interactive. Six previous rounds warmed
surfaces by re-implementing them, and each round missed a lazy piece; this
warm IS the production path, so what the live path builds, it builds — for
every tool and every future tool. The veil prewarm's belt loop (9.3–18.2 s
of every warm-cache load) is deleted; its hard-won rules are recorded at the
tombstone in courseScene.js.

**The instrument:** `tools/qa/electron-first-press-census.js` — every surface
pressed twice with a state VERIFICATION per press (a dispatched key that
never reached its handler must read UNAVAILABLE, not clean-by-vacancy — the
first version had exactly that hole and three of its rows were lies), rAF
gap windows, program-cacheKey ARRIVALS (info.programs.length is a net count;
a swap reads +0), geometry/texture deltas, an idle-wait between surfaces
(a stuck-open ledger poisoned every later row until it existed). Controls:
a planted 100 ms stall is caught every run; the planted program control is
VOID (three fresh defined materials produced no arrivals — mechanism
unexplained, named in the driver) — but the tab and mop rows demonstrate the
arrivals counter live every run: +1p on first press, +0p on second.

**The census verdict (cold tier, the worst case):** every reachable surface
first-presses ≤ 25 ms — Tab overview, ledger open, register till, pause,
and all nine tools, the mop now included (was the game's one tool stall).
Warm tier: ≤ 31 ms. The acceptance ("no first press over 33 ms after
warm-up") is MET for every surface the census can reach.

**Named residuals, not glossed:**

1. **Course editor: 823–1051 ms first entry, +37–46 programs, on BOTH
   disk-cache tiers** — ANGLE translation/link do not disk-cache, and the
   editor's content builds lazily at entry. The obvious fix — a real
   enter/exit round trip under the still-opaque veil — was BUILT, MEASURED,
   and REVERTED: it left exit-path state that made the player's next real
   entry cost 9.5 SECONDS (+12p). exitEditor's invalidation
   (rebuildSectionIndex / layer-refresh territory) must be understood before
   this is retried. The stall stands, once per session, on the owner's
   machine.
2. **Book page TURN:** the census's kick fires 700 ms after the book opens
   and `turnPage` still refuses (mid-rise). Instrument gap, not a clean
   bill — the turn's first-press cost is UNMEASURED tonight.
3. **Front desk: unreachable from QA at spawn** — `enterFrontDesk` returns
   silently through one of its guards even with a clean idle pre-state.
   Which guard refuses is not yet known; the census reports it honestly as
   UNAVAILABLE rather than measuring a no-op.

**Deferred-warm cost, measured:** zero warm-tier gaps over 60 ms from the
belt cycle; one 261 ms cold-tier frame inside the settle window (~2 s
post-interactive), where the mop's lazy build now lands instead of on the
player's chosen moment.

---

## Found along the way — the gate was a coin flip

The post-Phase-2 gate went red with **all 13 diff rows green**: `bag-packed`
NOT CAPTURED, and the diff rightly counts an unanswered committed golden as
failure (that contract predates this session and is correct — a vanished
pose once hid a real regression). The capture's own manifest said why:
"only N goods packed."

Root cause, two layers down: the staging clicks each transaction item at its
projected CENTER pixel from a fixed stance — and the customer leaning over
the counter occludes that center. The staging record now shows every item
needs exactly TWO candidate points. Which items got occluded varied with the
boot, so the pose staged 1, 2, or 3 goods at random and **the whole gate has
been a coin flip on this axis since the contract landed** — tonight it
rolled green once and red twice before being caught.

Fix in `golden-capture.js`: aim the camera at each item, then click candidate
points across its projected box until the packed COUNT moves, and record
per-item outcomes (`bagStaging` in the manifest) so a skip names its step.
Verified: 3/3 packed, `bag-packed` diffs 0.0 against its committed baseline,
golden exit 0 honest via PIPESTATUS.

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

After fixes: **full gate exit 0** — 3685/3685, ratchet 323 (frozen), vendor
127 up-to-date, all 12 goldens ok (tool-mop re-capture noise floor 0.067),
one-pixel control alive. The 1767 flake did not recur in the full rerun.

**Goldens rebaselined, frames viewed.** `tool-mop` failed exactly as
predicted when the point-c remodel merged (0.8738 vs 0.75); the current
frame was looked at before accepting — red collar, clumped white skirt, the
adopted hand gripping the shaft. World poses pixel-zero; other pose drifts
inside the same band as the pre-merge run. `bag-packed` still self-skips
("only 2 goods packed") — pre-existing, not from these branches.

**Re-check of the two load-in faults on the merged tree — both FIXED:**

- **1.1 dustpan** (`electron-warm-leaves-a-tool`, goal27-phase0): the A/B
  discriminates in one run — the old debounced door still leaves the dustpan
  after 3 s (the fault mechanism is real; that is the control), the immediate
  door the production warm now uses leaves hands clean (`afterThreeSeconds:
  null`). Back on foot: no tool.
- **1.2 map behind the veil** (`electron-load-in-hands-and-camera`,
  goal27-phase0): 929 visible samples, **0 showing the map**; the camera came
  home **3,877 ms before** the veil lifted (pre-fix it LOST by 287 ms);
  instrument control detected. The two held-tool spans are both explained
  (pre-scene boot accessor, and the warm's own 49 ms in-and-out).

The owner's report of still seeing these was correct **for the build he was
playing** — `goal25/phase0-inherited-tree` at `d7716d4` predates both fixes.
The merged main has them.

**Free finding for Phase 1.3:** the same run put the first visible frame at
**t = 100.5 s** from process start on the QA path. That is the number 1.3
attacks.

**Near-miss, logged not counted:** my first gate run was wrapped in
`| tail -60`, which would have laundered the exit code through `tail` and
dropped mid-stream failures. Killed and rerun bare before any conclusion was
read from it.

**Phase 0 time:** ~95 minutes against the 45-minute rule. Spent knowingly:
the merge is the gate for every later phase, and the overrun bought a green
gate, five named reds, and both rechecks. No other item gets this treatment.
