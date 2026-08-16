# FIRST-RUN COMPILE SCREEN — built, gated, proven (2026-08-16)

**Probe lies this session: 0.** One instrument slip was caught in the act and
rerun before any claim used it (a `| tail` swallowed the lint ratchet's exit
code once; rerun unpiped, inner code read). One PRIOR-session claim was found
false while working this item and is corrected below: commit `aad49e7`
(Goal 28 P4) was reported "lint-ratchet-clean" and was not — it added one
`no-unused-vars` finding in courseScene.js that has sat red on main since.

## What shipped

On the first boot of a profile, the load veil becomes the compile screen,
worded the way shipped games word it:

> GOLF EMPIRE / PINE HILLS MUNICIPAL GOLF
> **Compiling shaders**
> **First-time setup. This only happens once.**
> [progress bar — real fraction, not a spinner]
> **121 / 171**

After a driver update, the same screen with line 2 replaced:
**"Your graphics driver was updated. Rebuilding for the new version."** The
first-time promise is never repeated: the unit suite pins that the
driver-update line does not contain "only happens once"
(tests/compile-screen-gate.test.js, the liar clause).

**One deviation from the spec sketch, named:** the sketch's lines used em
dashes ("First-time setup — this only happens once"). ITEM 28 bans the em dash
from every string a player reads and tests/no-em-dash-in-player-copy.test.js
enforces it repo-wide, so both lines ship with periods instead. Same words,
different punctuation, and the standing rule wins until the owner says
otherwise.

## The count is the work, not a timer

The number is `renderer.info.programs.length` read live — the same counter
every acceptance in this repo trusts — painted from a rAF loop plus a 100 ms
interval so the freshest number is in the DOM whenever the compositor gets a
frame. The bar is the same fraction, so the veil's progress bar is REAL on a
first boot. The QA driver compared every painted "n / m" against the live
count read in the same tick: **displayed n equaled live at all 8 sampled
values on the proof boot (lag violations 0/6, fabrications 0)**, climbing
0 → 121 → 154 → 160 → 164 → 165 → 167 → 171/171.

The denominator starts at `COMPILE_EXPECTED_PROGRAMS = 171` — measured on this
build (final live count, fresh profile, pine-hills-v2, red-run boot) — and
clamps upward if the live count ever overtakes it; completion always repaints
`n / n`, so drift in the constant can make the count finish early, never lie.

## The gate

A stamp in localStorage (`golfEmpire.shaderCompileStamp.v1`), written ONLY
after the full warm completes (prewarm + belt warm, `finish(true)` in
main.js). It stores two identities:

- the GL key (vendor + unmasked renderer + GL version), and
- the GPU process's driver versions via a new bridge channel
  (`fw:gpu-driver-versions` in main.cjs, `assertTrusted`, registered in the
  electron-security channel list). Measured fact that forced this: **this
  Electron build's ANGLE string carries no driver version digits**
  ("... Direct3D11 vs_5_0 ps_5_0, D3D11)"), so GL strings alone cannot see a
  driver update. getGPUInfo('basic') reports them
  ("10.0.26100.8875,32.0.16.1088,32.0.21042.62" on this machine) and the
  stamp now carries that set.

Decision rules (tests/compile-screen-gate.test.js):
- no stamp → first-run screen; GL key changed → driver-update screen
- driver versions: **it takes two KNOWN, different versions to claim an
  update** — unknown is not "changed", so a slow bridge can only make the
  screen silent, never make the game claim a driver update that didn't happen
- no GL key at all → no claim either way, stamp untouched
- a crash before completion leaves no stamp → the screen shows again, which
  is true

## The proof (all Electron, pine-hills-v2, owner resolution 2560x1370 DIP @1.5)

Instrument: `tools/qa/electron-compile-screen.js` — a DOM/opacity/live-count
sampler installed before the menu click, with a PLANTED activation control
fired after every load (the sampler must catch a forced `compileBegin` on the
hidden veil, proving it was alive — "caught" in all four runs below).

| boot | profile state | expect | verdict | inner exit |
|---|---|---|---|---|
| red-unbuilt | fresh | first-run | **FAIL (watched red)**: "the compile screen never appeared during the load" | 1 |
| final-firstrun | fresh (`gfqa-compileproof-final`) | first-run | PASS — 8 distinct climbing values, all == live; stamp written with driver + drv + programs 171 | 0 |
| final-secondboot | same profile, boot 2 | absent | PASS — **zero activations across the whole load**, stamp byte-identical | 0 |
| final-driverupdate | same profile, stamp's driver mutated at menu | driver-update | PASS — driver-update line shown, stamp re-armed to the real key | 0 |

**The goal's two-boot clause is the middle two rows: boot one on a fresh
profile shows it, boot two on that same profile never does — and "never" is a
whole-load sampler claim with its own liveness control, not a spot check.**

Clip (the count is motion, so it is on film): boot final-firstrun recorded via
VIDEO_DIR, 83 frames extracted and VIEWED (`qa/clips/compile-screen/`):
- frame-0021 (20 s): bar ~70%, count **121 / 171**, both lines legible
- frame-0039 (38 s): bar ~98%, count **167 / 171**
- frame-0040 (39 s): compile block handed back — title "Arriving at Pine
  Hills Municipal Golf", bar full, count gone (compileEnd before the fade)
- frame-0041 (40 s): veil gone, player at the porch
Stills: `qa/electron/compile-screen/final-firstrun-mid-compile.png`
(first-run wording) and `final-driverupdate-mid-compile.png` (driver-update
wording, "0 / 171" at capture). Both read cleanly at owner resolution.

## Fixed on the way

- `aad49e7`'s unwatched lint debt: `catch (e)` with unused `e` in the
  gesture-overview warm stage (courseScene.js) → `catch { }`. Ratchet back to
  323 exactly.
- tests/electron-security.test.js channel list extended with
  `fw:gpu-driver-versions` so the new handler is pinned to exactly one
  secured registration.
- **The gate's fail-1 root-caused and fixed — it was never a flake.** The
  goal24 orchestrator test died on `spawnSync git ETIMEDOUT`:
  `repositoryMetadata`'s fingerprint runs `git diff --binary HEAD` under a
  10 s budget, and with the standing 34-GLB LFS wedge that diff measures
  **18.8 s** on this tree. Same instrument-fault class its own maxBuffer
  comment fixed for space; time budget raised to 120 s, isolation went
  44/45 → 45/45 on that change alone. This was also 2026-08-15's hidden
  full-gate fail-1, misfiled that night as CPU-pressure flake. HARNESS_DEBT
  entry 5. A stale 0-byte `.git/index.lock` (01:54, no git process) was
  removed on the way.

## Found by this session's gate: Goal 28 P3 shipped a world-content regression

The gate's golden half was RED on main before today's work — every scene,
deterministically (bag-packed reproduced to four decimals across runs), and
no golden had run since the P1-P5 commits landed. Bisection by A/B:

1. courseScene.js fully reverted to c6871ec → still red → the gesture-overview
   prewarm exonerated.
2. Worker generation bypassed (sync path) → **green** → the P3 worker path
   owns it.
3. Node value-diff of sync product vs clone+heal product: serialization
   byte-equal, but five runtime fields differ — the healed
   `runtime.coarseShadow` was EMPTY (617 entries lost). The shadow is
   deliberately stale: it holds coarse values as of the last fine-import so
   the first tick can land generation-era coarse drift. Rebuilding it from
   current cells silently discards that pending import. Fix one: the worker
   now carries the REAL runtime across the clone under an enumerable alias
   (`runtimeCarry`), the adopter moves it back non-enumerable, and the
   contract test value-walks the entire graph (zero diffs allowed).
4. Still red in Electron with the carry proven landed (`ng-leg-*` marks) —
   because Node hid the second mechanism: **the worker is its own module
   graph with no preload and no page query, so it resolved the DEFAULT
   clubhouse variant while the page ran pine-hills-v2**, and generation
   seeded the wrong room's layout. Fix two: the page's resolved variant now
   rides the worker URL as `?clubhouse=...` — the resolver's first-priority
   source — so the worker's shopLayout freezes the same datums at module
   eval.

Also root-caused on the way: ensureCourseMaintenance's runtime-missing heal
now rebuilds the full cache tail (shadow capture + encoded surface/fields +
revision + scoreDirty) instead of topology only, matching the load path — the
backstop for any runtime-less model is now load-semantics, not almost-nothing.

## Files

- `src/ui/compileScreen.js` (new): copy, stamp io, decision, count pump
- `src/main.js`: veil compile block (compileBegin/compileCount/compileEnd,
  set() suppression while compiling), wiring at the prewarm site,
  finish(false) on every abort path, `__fw.loadVeil` QA hook, driver-version
  prime at boot; P3 fixes: runtimeCarry adoption + variant on the worker URL
  + ng-leg-* marks naming which generation leg a boot took
- `src/styles.css`: `.load-veil-compiling` block
- `main.cjs` + `preload.cjs`: `fw:gpu-driver-versions`
- `src/workers/newGameGeneration.js`: enumerable runtime carry (both legs)
- `src/sim/courseMaintenance.js`: ensureCourseMaintenance heals to load
  semantics (shadow + encodings), not topology-only
- `tests/compile-screen-gate.test.js` (new),
  `tests/new-game-worker-contract.test.js` (value-walking protocol test),
  `tests/electron-security.test.js` (channel list)
- `tools/qa/electron-compile-screen.js` (new instrument, three modes)
- `tools/qa/goal24-interaction-performance.mjs` (git fingerprint time budget)

Verification at close: goldens green with the worker path live
(qa/electron/compile-screen/golden-variantfix.log, worst scene 0.05 vs 0.75);
final full gate in qa/electron/compile-screen/gate3.log.
