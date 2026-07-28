# Pro-Shop Phase 0 — Baseline Performance

Raw machine-readable results: `data/baseline-performance.json`.
Reproduce with `HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-performance.js`.

> ### Read §8 first — most of this document is superseded
>
> This was written when the harness seeded the world randomly, averaged a warm-up run into
> its results, and reported single numbers with no confidence interval. It measured a
> different golf course on every run, which is why identical code once produced 9.22 ms and
> 10.96 ms.
>
> **§8 has been rewritten** with the diagnosis, an empirical noise floor from 30 samples, a
> statement of the smallest difference this harness can resolve (3 %), and the budgets that
> are actually enforceable. The baseline table in §8 supersedes §2, and the load figure
> there supersedes §3.
>
> §1, §2, §3 and §6 are kept as the historical record of the Phase 0 capture. **Do not use
> their numbers for comparison.** §5 describes OBS-1, which has since been fixed on the
> feature branch (`b1c7e5b`); it is retained because it explains why the original run-3
> figures were discarded.

---

## 1. Test protocol

Sampling method matches `tools/qa/perf-probe.js`, the repository's existing
performance harness. That harness measures the **golf course** from a bootstrapped
`willow-creek` save; this one measures the **neglected starter pro-shop interior**,
which is the thing the rebuild will regress against.

* Fresh Relaxed new game, no save reuse (see `BASELINE_TEST_PROTOCOL.md` §5).
* Headed Chrome so the numbers come from the real GPU. 1600 × 900, DPR 1.0, FOV 66.
* Clock pinned to 13:00 and `speedIdx = 0` before every scenario, so all scenarios
  measure the same world. The one exception is `live-speed16-customers`, which
  deliberately runs the clock at 16×.
* Per-frame deltas recorded with `requestAnimationFrame`; the first five frames of
  each sample are discarded as settling.
* `avgFps` = mean of the retained deltas. `low1Fps` = mean of the worst 1 % of frames.
  `worstMs` = the single slowest retained frame. A **stutter** is any frame over
  33.3 ms (two missed frames at 60 Hz).
* **3 runs per scenario.** Reported values are the mean across runs, except
  `worstMs`, which is the maximum observed across all three.

### Machine

| Field | Value |
|---|---|
| GPU | `ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| Logical cores | 16 |
| OS | Windows 11 Pro 10.0.26100 |
| Browser | Chrome stable via Playwright 1.61.1, headed |

> This is a high-end GPU. **These numbers are not a statement about minimum-spec
> behaviour** and must not be read as one. See §6.

---

## 2. Results

3 runs per scenario, mean unless stated.

| Scenario | avg FPS | 1 % low FPS | avg ms | worst ms | stutter % | draw calls | triangles | heap MB |
|---|---|---|---|---|---|---|---|---|
| `idle-interior` | 119.0 | 64.5 | 8.40 | 16.8 | 0.0 | 1,376 | 7,340,320 | 325 |
| `spin-interior` | 102.3 | 30.8 | 9.78 | **216.6** | 0.2 | 3,950 | 11,653,449 | 333 |
| `walk-spin-interior` | 98.0 | 34.2 | 10.20 | 58.3 | 0.2 | 676 | 4,803,492 | 328 |
| `entrance-sightline` | 114.3 | 46.0 | 8.75 | 33.3 | 0.0 | 3,015 | 7,670,078 | 326 |
| `broom-sweeping` | 119.7 | 96.5 | 8.36 | 25.0 | 0.0 | 974 | 6,096,066 | 312 |
| `live-speed16-customers` | 100.9 | 36.7 | 9.91 | 41.6 | 0.1 | 7,340 | 15,186,899 | 314 |
| `laptop-open` | 118.4 | 58.6 | 8.45 | 24.9 | 0.0 | 909 | 7,025,616 | 319 |

Scenario definitions:

* **`idle-interior`** — standing still at local (−2.0, 1.0), facing −Z.
* **`spin-interior`** — same spot, camera spinning at 2.4 rad/s. The fast-look case.
* **`walk-spin-interior`** — walking forward from (−6.0, 3.5) while spinning.
* **`entrance-sightline`** — standing at the entrance pose, the whole room in view.
* **`broom-sweeping`** — broom equipped, left mouse held, sweeping the debris row.
* **`live-speed16-customers`** — clock at 16× with customers arriving, camera spinning.
* **`laptop-open`** — laptop entered via `[E]`, 1024 × 640 DOM page re-projected onto
  the screen quad every frame. Runs **last** in each run for the reason in §5.

Draw-call and triangle figures are instantaneous reads at the end of the last run and
vary with what the camera happens to face; treat them as indicative, not exact.

---

## 3. Load timing

| Measure | Value |
|---|---|
| "New game" click → `walk.isActive()` | 4,714 ms |
| "New game" click → clubhouse built | 4,828 ms |
| "New game" click → load veil cleared (**time to first interactive frame**) | **18,186 ms** |

The veil-clear figure is the meaningful one: `walk.isActive()` becomes true long
before the world is presentable. Roughly 13 s of the 18 s is spent between the
clubhouse existing and the veil lifting — asset loading, shader prewarm and forced
shadow bakes. Repeat runs were consistent (18.2 s across both committed runs); a
cold shader cache is slower still.

---

## 4. Static scene cost

Measured at the entrance-sightline pose with `renderer.info.autoReset` disabled and
exactly one frame rendered — a naive read returns the last fullscreen post-processing
quad instead.

| Metric | Value |
|---|---|
| Draw calls per frame | 1,766 |
| Triangles drawn per frame | 7,268,740 |
| Interior subtree objects | 3,448 |
| Interior subtree meshes | 2,191 |
| Visible meshes, whole scene | 3,052 |
| Visible triangles, whole scene | 3,289,507 |
| Unique materials | 815 |
| Unique textures | 227 |
| Geometries in memory | 1,726 |
| Textures in memory | 297 |
| Shader programs | 244 |
| JS heap | 332 MB |

Triangles *drawn* (7.27 M) exceed visible scene triangles (3.29 M) because shadow and
post passes re-draw geometry within the same frame.

---

## 5. Observed defect that affected measurement

**OBS-1 — the camera lens is not restored when the player leaves the laptop.**

Verified twice, in two separate scripts:

| Probe | Value |
|---|---|
| `camera.fov` before entering the laptop | 66 |
| `camera.fov` while in the laptop | 34 |
| `camera.fov` after pressing Escape | **34** |
| `camera.fov` after walking around again | **34** |
| `view` after Escape | `course` (correctly exited) |
| `laptopScreenMode()` after Escape | `desk` (correctly exited) |

So the laptop closes correctly in every respect except the lens: the player is left
permanently zoomed to the laptop's 34° FOV. Recorded in
`data/baseline-systems-video.json` and `data/baseline-performance.json`
(`laptopEntry.fovAfterExit: 34`).

**Impact on this baseline.** The first performance run of this session placed the
laptop scenario mid-route, so every later scenario in that run — and *all* scenarios
in runs 2 and 3 — were framed at 34° instead of 66° and reported falsely cheap frames.
Those numbers were discarded. The harness now runs `laptop-open` **last** and
explicitly restores the lens in its teardown, which is a measurement fixture only.
**The defect itself has not been fixed** — Phase 0 does not change gameplay code.

The exit route tested was Escape (`src/main.js:2035-2038`). A "Close Laptop" button
also exists in the laptop UI; whether it restores the lens is **untested**.

---

## 6. Limitations

* **One machine, one GPU.** All figures come from an RTX 5080. Nothing here predicts
  minimum-spec behaviour, and the comfortable averages should not be read as "the room
  is cheap".
* **Browser, not Electron.** The shipped game runs in Electron; capture runs in Chrome.
  Frame costs should be close, but this is not the shipping runtime.
* **Random terrain per run.** The new-game seed is random (`src/main.js:2829`), so the
  golf course outside the windows differs every run. Interior cost is stable; anything
  drawn through a window is not.
* **Customers are live.** `idle-interior` and the other interior scenarios may or may
  not have had a customer in frame.
* **Draw call / triangle counts are single-frame samples**, taken at the end of a
  scenario, and depend on where the camera happened to be pointing.
* **Weather is not pinned** — overcast versus clear changes interior lighting cost.

### Metrics not captured

| Metric | Status |
|---|---|
| Texture memory in bytes | **UNAVAILABLE** — `renderer.info.memory.textures` counts texture objects (297), not bytes. No byte-level figure was obtainable from WebGL. |
| GPU-side memory / VRAM | **UNAVAILABLE** — not exposed to WebGL. |
| CPU profile / top self-time functions | **NOT CAPTURED** in this pass. `tools/qa/perf-probe.js` does capture one via CDP `Profiler` and can be adapted. |
| Audio performance | **NOT CAPTURED**. |
| Electron process memory | **NOT CAPTURED** — browser JS heap only (312–333 MB). |
| Minimum-spec / integrated-GPU behaviour | **NOT CAPTURED**. |
| Save/reload performance | **NOT CAPTURED** — baseline is a fresh game only. |

---

## 7. Observed bottlenecks

Stated only where the evidence supports them.

1. **Fast camera movement is the worst case.** `spin-interior` loses ~14 % average FPS
   against idle (119.0 → 102.3) but its 1 % low collapses from 64.5 to 30.8 FPS, and
   the worst single frame reached **216.6 ms**. Something expensive is triggered by
   turning — most plausibly the 100 ms shadow re-fit and bake, plus culling churn
   across a ~3,450-object interior subtree. Not isolated in this pass.
2. **The 1 % lows are the real story.** Averages sit near 100–120 FPS everywhere, but
   four of seven scenarios drop into the 30–46 FPS band at the 1 % low. On this GPU
   that is invisible; on a weaker one it is where the game will feel bad first.
3. **Draw calls scale sharply with what is in frame** — 676 walking to 7,340 in the
   live 16× scenario, and 3,950 while spinning. There is no aggressive batching for
   the interior in the general case.
4. **Load time (18.2 s to first interactive frame) is the weakest measured number**,
   and about 13 s of it sits after the clubhouse already exists.
5. **`broom-sweeping` is cheap** — 119.7 avg / 96.5 1 % low, the *best* 1 % low of any
   scenario. Cleaning feedback is not a performance problem today.

---

## 8. Pass / fail — and what this harness can actually measure

> **Rewritten 2026-07-27.** The earlier version of this section proposed budgets that the
> harness could not enforce. The instrument has since been diagnosed, fixed and
> characterised, and the numbers below supersede every performance figure earlier in this
> document.

### The problem that triggered this

Identical code measured **9.22 ms** and **10.96 ms** on the same scenario — a 19 % swing,
larger than every difference the lighting spike was trying to detect. `SLICE_BRIEF.md`
§13's "no unapproved regression greater than 10 %" rule was unenforceable, and so was every
performance gate between here and launch.

### Diagnosis — it was the environment, not the instrument

Five hypotheses were tested. The dominant cause was found by controlled experiment rather
than argued for:

| Cause | Finding |
|---|---|
| **Background CPU load** | **Confirmed, dominant.** Re-running the identical configuration under an 8-thread busy load inflated mean frame time by **+38 %** (6.674 → 9.211 ms) and doubled run-to-run CV (1.42 % → 3.11 %). The original 19 % drift was measured while two subagents were running on this machine. |
| **Random world seed** | **Confirmed, real.** The harness used the menu's New Game path, which seeds with `Math.random()` (`main.js:2829`) — so every run generated a different golf course and the harness compared *scenes*, not code. Now pinned via `newStarterEmpire('relaxed', 20260727)`. |
| **Warm-up** | **Confirmed, systematic.** The first sample of a session runs **+2.24 %** slower than later ones, consistently across 10 sessions. Now discarded rather than averaged in. |
| **Sample window / settle** | Contributory. Raised to 10 s sampling after a 5 s settle. |
| **Prewarm not finished** | **Ruled out.** `Continue → veil clear` was stable at 18.1–18.7 s across 10 sessions (3 % spread), and sampling starts well after it. |
| **GC** | **Not isolated.** Heap ranged 301–365 MB with no obvious correlation to frame time. Left as a known unknown. |

### The empirical noise floor

**10 sessions × 3 repetitions = 30 samples** of one unchanged configuration, quiet machine,
raw data in `Designs/ProShop/Phase1/data/perf-noise.jsonl`:

| Measure | Value |
|---|---|
| Grand mean | 6.674 ms |
| SD (total) | 0.095 ms — **CV 1.42 %** |
| SD within session | 0.098 ms — CV 1.46 % |
| SD **between** sessions | 0.051 ms — CV 0.76 % |
| Session-mean spread | 2.6 % |
| Under 8-thread load | mean +38 %, CV 3.11 % |

Between-session variance is *smaller* than within-session variance, which is the useful
result: once the machine is quiet and the world is seeded, comparing two separate runs is
about as reliable as comparing two samples inside one run.

### What effect size this harness can detect

Derived from the between-session SD, for a two-configuration comparison at 80 % power:

| Runs per configuration | 95 % CI on the mean | **Smallest detectable difference** |
|---|---|---|
| 1 session | ± 1.5 % | **3.0 %** |
| 3 sessions | ± 0.9 % | **1.7 %** |
| 5 sessions | ± 0.7 % | **1.3 %** |
| 10 sessions | ± 0.5 % | **1.0 %** |

**Stated plainly: with a single run per configuration on a quiet machine, this harness can
detect a 3 % change and cannot resolve anything smaller.** The brief's 10 % regression rule
is therefore **enforceable with a healthy margin** — three times the instrument's
resolution.

Two conditions attach, and both are now machine-checked rather than trusted:

1. **The machine must be quiet.** Every scenario reports run-to-run CV, and a run is
   flagged `trustworthy: false` when CV exceeds 2.5 % (quiet measured 1.42 %, loaded
   3.11 %). A run that fails this flag must not be compared against another.
2. **At least 2 usable runs** after the warm-up discard, so `BASELINE_PERF_RUNS` must be 3
   or more.

### The baseline, re-measured on the fixed harness

4 runs per scenario, first discarded as warm-up, seed 20260727, quiet machine, all
scenarios `trustworthy: true`. **These supersede §2.**

| Scenario | avg ms | 95 % CI | CV | 1 % low ms |
|---|---|---|---|---|
| idle-interior | 6.760 | ± 0.131 | 0.78 % | 19.65 |
| spin-interior | 9.393 | ± 0.273 | 1.17 % | 30.62 |
| walk-spin-interior | 8.820 | ± 0.066 | 0.30 % | 33.33 |
| entrance-sightline | 9.553 | ± 0.100 | 0.42 % | 26.40 |
| broom-sweeping | 4.930 | ± 0.194 | 1.58 % | 15.51 |
| live-speed16-customers | 9.593 | ± 0.299 | 1.26 % | 34.13 |
| laptop-open | 5.733 | ± 0.202 | 1.42 % | 27.50 |

Load: Continue click → first interactive frame **18.3 s**.

These differ from §2 because the world is now seeded rather than random, so they describe a
*specific* course rather than an average over unknown ones. That is the point: a fixed
reference is comparable, an average over random scenes is not.

### Adopted budgets

Only budgets the instrument can enforce are adopted. Each is measured on the scenario named,
with ≥3 runs on a quiet machine and `trustworthy: true`.

| # | Budget | Threshold | Enforceable? |
|---|---|---|---|
| B1 | Interior average frame time, per scenario | no more than **+10 %** against the table above | **Yes** — 3 % resolution vs a 10 % rule |
| B2 | Time to first interactive frame | no more than **+10 %** against 18.3 s | **Yes** — load timing spread was 3 % |
| B3 | Run trustworthiness | every compared run reports `trustworthy: true` | **Yes** — self-checked |
| B4 | Draw calls with the room in view | no more than **+15 %** against the recorded value | **Yes**, but coarse — single-frame reads |

### Explicitly NOT adopted

| Measure | Why it cannot be a budget yet |
|---|---|
| **1 % low frame time** | The noise floor was characterised for *mean* frame time. 1 % lows are an extreme-value statistic over ~600 frames and were not characterised; their run-to-run spread is visibly larger than the mean's. Treating them as a budget would fail runs at random. **The user's ruling that the deep dips are a defect still stands** — they are a bug to fix, and fixing them needs a repro, not a threshold. |
| **Worst single frame** | A one-sample extreme. Not a budget under any protocol; use it to find bugs. |
| **Triangles / texture memory** | Single-frame reads that vary with camera aim. Informational. |
| **Anything on other hardware** | One RTX 5080. Nothing here describes minimum spec, and no budget should be inferred for it. |

### How to run a comparison

```bash
node tools/serve.cjs
BASELINE_PERF_RUNS=4 HEADED=1 \
  node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-performance.js
```

Close other work first — a busy machine costs 38 %, which will swamp anything being
measured. To re-characterise the noise floor after a hardware or harness change, run
`tools/qa/proshop-perf-noise.js` across ten sessions and recompute the table above.
