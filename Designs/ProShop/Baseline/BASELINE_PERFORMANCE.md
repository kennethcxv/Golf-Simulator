# Pro-Shop Phase 0 — Baseline Performance

Raw machine-readable results: `data/baseline-performance.json`.
Reproduce with `HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-performance.js`.

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

## 8. Pass / fail

**No pass or fail is claimed.** `SLICE_BRIEF.md` §13 states that performance targets
are to be established *from* these Phase 0 measurements, so no threshold existed to
test against while capturing them.

For Phase 1 to adopt, the evidence supports these as candidate baselines on this
machine — proposed, not approved:

| Candidate budget | Baseline value |
|---|---|
| Interior average frame time | 8.4 ms idle / 10.2 ms worst locomotion |
| Interior 1 % low | ≥ 30.8 FPS (`spin-interior`, the current floor) |
| Worst single frame | 216.6 ms — already bad, should be treated as a bug to fix, not a budget to preserve |
| Time to first interactive frame | 18.2 s |
| Draw calls, room in view | 1,766–3,015 |
| Triangles drawn per frame | ~7.3 M |

The brief's "no unapproved regression greater than 10 % from baseline frame time"
rule can be applied to the average-ms column above once a human approves it.
The brief's "sustained 60 FPS at the documented test configuration" is met on this
hardware by a wide margin at the average, and **not** met at the 1 % low in four of
seven scenarios — which is a judgement call for the user, not for this agent.
