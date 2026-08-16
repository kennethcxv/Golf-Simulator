# QA HARNESS MECHANICAL DEBT — counts before and after

> **Every new probe goes through the `golf-qa` skill** (`.claude/skills/golf-qa/`)
> — it is the distillation of this file's lessons into the five laws every
> instrument must satisfy (negative control, launch-the-game, watched-fail,
> and the repo-specific gotchas). Check new probes against BOTH: the skill for
> the discipline, this file for the specific shapes that have lied before.

Session of 2026-08-03 (B11). Three named categories, each counted before the
work and after it, with every remaining file listed and given a reason.

---

## 1. Drivers booting through the removed menu

**Before: 36 live drivers. After: 4, all deliberate.**

`tools/qa/lib/qa-boot.mjs` exists precisely because `run-playwright.cjs` launches
an **ephemeral** context: on a clean run "Continue" renders DISABLED, so a raw
`getByText('Continue').click()` either hangs on the load veil or falls through a
`.catch` and hangs on the driver's first in-game wait instead. `clickThroughMenu`
resumes when Continue is genuinely clickable and starts a fresh Relaxed game when
it is not, which is strictly more robust than the raw click in **every** one of
these files — including the save/reload drivers, which click Continue again after
a reload and get the correct branch either way.

Ported by two codemods, both kept in `tools/qa/lib/` so the next sweep is not
hand work:

| pass | tool | files | how |
|---|---|---:|---|
| 1 | `port-menu-boot.mjs` | 23 | six recognised statement shapes, regex-anchored on the whole statement group so a partial match cannot leave a dangling handle |
| 2 | `port-menu-boot-blocks.mjs` | 6 | the `if (enabled) click else new-game` blocks, matched by **brace walking** rather than regex |
| 3 | by hand | 3 | `laptop-tour.js` (its else-branch also BUYS the first course — now `if (bootMode === 'new-game')`), `golf-operations-laptop-booking-probe.js`, `simplified-register-recovery-accessibility.mjs` |

Every ported file was `node --check`ed; `doors-integration-probe.js` was run
end-to-end on a clean profile — the case that was broken — and completed.

### The 4 that keep it, and why

These do not *boot* through the menu; Continue's presence is what they assert.

| file | reason |
|---|---|
| `boot-exception-source.js` | COUNTS the Continue button as a boot diagnostic. It never clicks it. |
| `pine-hills-legacy-save-migration-acceptance.js` | asserts a migrated legacy save exposes a working Continue — that IS the acceptance |
| `pine-hills-restoration-lights-acceptance.js` | `requireCheck('bootstrap autosave exposes Continue', …)` — a named control in the acceptance list |
| `pine-hills-starter-stock-cooler-acceptance.js` | `clickVisibleContinue()` is a named acceptance step with its own visibility precondition |

---

## 2. The renderer gate on performance drivers

**Before: 5 gated. After: 11.**

HARNESS_TRUST rule 5: headless runs get SwiftShader, a CPU rasterizer, and
absolute frame numbers from it are not evidence about the live game.
`tools/qa/perf-renderer-gate.mjs` has existed; most perf drivers recorded a
renderer string at best and left every reader to remember to check it.

Two classes, treated differently — this distinction is the point:

* **GATE (refuse software)** — the driver reports absolute numbers:
  `course-perf.js`, `cleaning-performance-baseline.js`,
  `mountain-clubhouse-performance.js`, `premium-clubhouse-performance.js`,
  `steam-release-checkout-performance.js`, `scenario-performance-master.js`.
* **SOFTWARE-RELATIVE (declared)** — the driver pins its own swiftshader flags
  and compares two runs of *itself*; relative numbers survive a CPU rasterizer,
  so it passes `{ allowSoftware: true }` and the result carries the label:
  `simplified-register-performance.mjs`, `player-experience-performance.mjs`.

### Not gated, with reasons

| file | reason |
|---|---|
| `assets-51-100-sheet06-performance.js` | runs a **hash-pinned frozen fixture**; the driver asserts the fixture's own bytes. Adding a gate to it would break the contract it exists to hold. Gate belongs in the fixture's next revision, not bolted on. |
| `simplified-register-performance-overlay.js` | never samples frames — it READS numbers produced elsewhere and DRAWS an overlay image. Nothing to gate. |
| `sheet06-performance-comparison.mjs` | zero `page.` calls; it compares three completed runs' outputs. Nothing to gate. |

---

## 3. Stale cutter-era drivers

**Before: 15 files matching. After: 15 — and nothing to do.**

Every one of the 15 matches is a **provenance comment** recording that the file
was already ported off the box cutter on 2026-07-30, e.g.

```
// (Ported off the box-cutter equip 2026-07-30 — cartons take one E per flap)
```

There is no live cutter usage in any driver outside `tools/qa/archive/` (14
files, deliberately frozen). This category was closed by the earlier port; the
count in the brief was counting the comments that record it.

---

## Found on the way, not fixed

* **`course-perf.js` is broken independently of the gate.** It waits for
  `getByText('New Empire — Realistic')`, a menu label that no longer exists, and
  fails there before reaching anything else. Its gate is in place for when that
  is fixed. Same class as the stale labels the menu-boot port removed elsewhere —
  worth a sweep of its own for `New Empire` across the harness.
* **`laptop-tour.js` fails on "marketplace: no affordable Buy button"** both
  before and after this session's changes (verified by stashing). An economy
  fixture problem, not a harness-boot one.

---

## 4. The laptop family — 10 of 13 red, and none of it from B8

B8's brief said to "confirm the laptop acceptance harnesses stay green". They
were not green to begin with. Measured rather than assumed, by running every one
of them twice: once against HEAD, once against a **worktree at `a48a9a3^`** —
the commit immediately before the laptop moved — served on its own port.

**The comparison has a control.** `laptop-bstand-verify.js` carries a negative
control that fails if the laptop is still at the old pose; run against the
pre-move port it fails with *"the laptop is still at local x −1.72, essentially
where it was"*, which is how I know that port was really serving the pre-move
build and not the current one. (The first attempt at this comparison was
invalid: the worktree had no `node_modules`, so `three` 404'd and the app never
booted. Every driver "failed" for that reason alone. Caught it because the log
showed a 404 on `RectAreaLightUniformsLib.js` rather than a test assertion.)

| harness | pre-B8 | HEAD | first failure |
|---|:--:|:--:|---|
| `laptop-bstand-verify` | fail¹ | **pass** | ¹by design — it is the control |
| `laptop-cycle` | — | **pass** | |
| `proshop-greybox-laptop` | — | **pass** | |
| `laptop-actions` | fail | fail | marketplace: no affordable Buy button |
| `laptop-tour` | fail | fail | marketplace: no affordable Buy button |
| `laptop-persist` | fail | fail | laptop did not open from either live stand |
| `laptop-round3` | fail | fail | `.laptop-screen input.lt-search` never visible |
| `laptop-search-kit` | fail | fail | `.laptop-screen input.lt-search` never visible |
| `laptop-search-navigate` | fail | fail | `.laptop-screen input.lt-search` never visible |
| `laptop-cart-flow` | fail | fail | `.laptop-screen button:has-text("Pro Shop")` |
| `laptop-look` | fail | fail | `waitForFunction` timeout |
| `laptop-sales-tax-card` | fail | fail | returned `ok:false` |
| `laptop-search-visible` | fail | fail | returned `ok:false` |

**Identical failure messages on both sides for all ten.** B8 changed nothing
here.

**It is not selector drift.** `.lt-search` still exists (`src/ui/laptop.js:549`),
and the interior group carries no rotation, so the local-plus-offset frame these
drivers use and the world frame `laptop-bstand-verify` uses agree. The four
`lt-search` failures are most likely downstream of the same thing
`laptop-persist` reports outright — the laptop never opens, so `.laptop-screen`
never has content to find. `laptop-bstand-verify` opens it from
`laptop.getWorldPosition()` + 0.85 z; the failing drivers stand at the
`FRONT_DESK.laptop` **layout datum** + 0.95 z, and the datum is not the rendered
rig's position.

**Not fixed here, deliberately.** That is one root cause across four to seven
files plus two independent economy-fixture failures, and it is a session rather
than a patch. Naming it beats leaving ten red drivers with no explanation, and
beats a shallow per-driver nudge that would paper over the shared cause.

*Raw runs: `Baseline/round6/laptop-harness-sweep.txt` (HEAD) and
`laptop-harness-preb8.txt` (pre-move).*


---

## 5. D1 — the laptop family: root cause found, drivers still red

**What §4 concluded was wrong, and the measurement says so.** §4 read
Playwright's "`.lt-search` never visible" as selector drift downstream of a
laptop that never opened, and named the `FRONT_DESK.laptop` layout datum as the
likely cause. Both are disproved:

| §4's hypothesis | measured 2026-08-04 | verdict |
|---|---|---|
| the drivers stand at a stale layout datum | the rig sits at interior-local (-2.550, 1.557); `FRONT_DESK.laptop` reads (-2.550, 1.557) | **wrong** — B8 moved the datum with the machine |
| the laptop never opens | standing at the rig and pressing E opens it, prompt `"Laptop — [E] open GOLF SIMULATOR"`, screen 1280x720 | **wrong** — it opens |
| `.lt-search` is a drifted selector | the field measures 217 x 15 px at (474, 149), `display: block`, `visibility: visible`, `opacity: 1` | **wrong** — it is there and it is visible |

**What is actually true.** `app.laptopOpen = true` is set on the FIRST line of
`enterLaptop()` (src/main.js), and the DOM it gates opens **1350 ms later**:

```js
app.laptopOpen = true;                       // main.js — immediately
…
laptopTimers.push(setTimeout(() => {         // main.js — +1350 ms
  if (ch.laptopScreen) ch.laptopScreen('live');
  laptopUi.open(startPage);                  // ← root.style.display = ''
}, 1350));
```

Time-resolved on a live open, polling every 400 ms:

```
t=0.4s flag=true exists=true display=none    0x0
t=1.2s flag=true exists=true display=none    0x0
t=1.6s flag=true exists=true display=(empty) 1280x720
```

Every red driver waited on that flag and went straight for the interface, so it
reached into a `.laptop-screen` that was still `display:none`. The flag means
"the player has sat down and the lid is swinging". It does not mean the screen
is on. `laptop-bstand-verify` was green throughout because it alone waits
1800 ms after the E press before touching anything — not because its stance was
better.

**Fixed:** every `laptopOpen === true` wait in the ten drivers (20 sites) now
also requires the screen to be up and the projected `.lt-frame` to be settled
and over 100 px wide. `tools/qa/lib/qa-laptop.mjs` carries the shared
`waitForLaptopScreen()` and `standAtLaptop()` for anything written next. The
stance was also moved onto `laptopRig()` — insurance, not a fix, and labelled
as such in the code so the disproved hypothesis is not re-run.

**Still red, and this is the honest state:**

| harness | before | after |
|---|:--:|:--:|
| `laptop-cycle`, `laptop-bstand-verify`, `proshop-greybox-laptop` | pass | pass |
| `laptop-round3`, `laptop-search-kit`, `laptop-search-navigate`, `laptop-cart-flow` | fail | fail — `locator.click` timeout on `.lt-search` |
| `laptop-persist` | fail | fail — its own open predicate never satisfied |
| `laptop-look`, `laptop-sales-tax-card`, `laptop-search-visible` | fail | fail — `ok:false` |
| `laptop-actions`, `laptop-tour` | fail | fail — "marketplace: no affordable Buy button" (economy fixture, unrelated) |

**0 of 10 turned green.** The race is real and fixing it was right, but it is not
the whole cause: a hand-driven open from the same stance, in the same build,
reaches a clickable field, and these drivers do not. The difference between the
probe's path and theirs has not been isolated.

**Next step, and it is a bisect not a theory.** Take `laptop-round3`, strip it to
boot → stand → E → click `.lt-search`, confirm it passes, then re-add its setup
one statement at a time until it fails. Its setup differs from the working probe
in at least: a 9:00 clock write plus `applyTimeWeather`, `page.keyboard.press('KeyE')`
rather than `'e'`, and a 3000 ms post-clubhouse settle. One of those, or
something between them, is the second cause. Guessing which has already cost
one session; the bisect is an hour and ends the question.

---

# 6. The whole harness has never run in the shipping build (2026-08-04)

The brief for this session said "Electron only, never Chrome". Doing that turned
up two defects that make every prior Electron claim in this file, and in the
five reports before it, worth re-reading.

## 6.1 `import('/src/…')` throws under `file://` — so no function-file driver ran in Electron

Every driver in `tools/qa/` that reaches into the app's modules does it as

```js
const L = await import('/src/data/shopLayout.js');
```

Electron loads the app from `file:///…/index.html`. A leading slash there
resolves against the **drive root**, so that line becomes

```
Failed to fetch dynamically imported module: file:///C:/src/data/shopLayout.js
```

Not "wrong data" — a thrown promise, every time, in the shipping runtime. The
fix is one edit per driver:

```js
const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
```

`tools/qa/run-electron.cjs` (new) runs any existing function-file inside
Electron: it shims `page.goto` (the app is already loaded) and
`page.setViewportSize` (resizes the real BrowserWindow instead). The import
pattern is the only source change a driver needs.

**Status: the runner exists; the drivers have NOT been swept.** Six new drivers
use the correct pattern. Everything else in `tools/qa/` is still browser-only,
and should be assumed so until it is run.

## 6.2 Seeding a profile through `localStorage` is a no-op in Electron

The standard fixture is

```js
localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
```

In Electron saves go through `window.fairwayNative` to files under
`userData/saves/`. `storage.js` prefers the native bridge whenever it exists, so
the seeded localStorage copy is never read: the menu's Continue is computed from
the **native** autosave, and `clickThroughMenu` resumes THAT.

Consequence: any Electron run of a driver that seeds this way is measuring
whatever profile happens to be in `userData`, not the seed. Two of this
session's own measurements are affected and are labelled in
OVERNIGHT_REPORT_8.md rather than quietly corrected.

A correct Electron seed has to write through the bridge:

```js
await window.fairwayNative.save('autosave', E.empireSnapshot(empire));
```

…or delete `userData/saves/autosave.json` first, which is what the F4 driver
does because it needs the file anyway.

## 6.3 Two instrument defects caught by their own controls this session

| instrument | defect | how it surfaced |
|---|---|---|
| `staff-route-measure` | `dist` as a `Float32Array` — the popped f64 cost exceeds the stored f32 cost for nearly every node, the staleness guard fires on live nodes, and Dijkstra reports "unreachable" two yards from the door | the negative control (the queue head, open floor) came back unreachable |
| `staff-route-measure` | fed `walk.isFree` (WORLD) with shopLayout datums (INTERIOR-LOCAL, ~360 yd out in x) | free-cell fraction came back 0.98 |
| `electron-save-robustness` | file picker matched `autosave-meta.json` before `autosave.json` | all four mangled cases reported a perfectly healthy save |
| `electron-save-robustness` | mangled `version`, not `empireVersion`, so the "future save" was a current save | the case failed while the other three passed |
| `staff-route-walk` | mirrored yaw convention (`atan2(dx, -dz)`; the walker is `(-sin, -cos)`) | the player walked out of the door instead of into the room |

## 6.4 Still owed from §4's list — untouched

The four raw-`Continue` drivers, the stale `New Empire` sweep, `laptop-tour`'s
economy fixture and the five dead feel keys are all exactly as §4 left them.
Nothing in this session touched them.

---

# §7 — SELF-REFERENTIAL CHECKS: the `BROOM_FEEL.pitch.maxPitch` class

*Swept 2026-08-04 (D7). ~400 `src/` imports across 393 test files and 455 QA
drivers, plus a keyword hunt for duplicated literals.*

**The defect:** a test and its driver both read the same production constant and
use it as the *bound, expected value or threshold* they are checking. The check
is then true by construction — it cannot fail if the production value is wrong,
only if the code disagrees with itself. The named example: a driver swept the
broom's pitch to `BROOM_FEEL.pitch.maxPitch` (0.30) believing it was the look
limit. It is a reach-curve clamp; `mouseLook.js` owns `PITCH_LIMIT = 1.35`. The
driver measured 22 % of its range for its entire life and the test agreed.

**The multiplier:** a constant is far more dangerous when a *competing authority*
exists elsewhere. Eleven instances found; three are load-bearing.

| # | constant | authority | harness reader | use | competing authority | sev |
|---|---|---|---|---|---|---|
| 1 | `BROOM_FEEL.dirt.pushSpeed` = 2.6 | `src/data/broomFeel.js:307` | `tests/broom-feel-config.test.js:64-71` | threshold vs retyped `2.2` | **yes** — `walk.speed: 3.4`, `src/render3d/courseScene.js:5758` | **HIGH — firing now** |
| 2 | `BROOM_FEEL.walk.bobRate` = 8.7 | `src/data/broomFeel.js:268` | `tests/broom-feel-config.test.js:25-29` | expected value vs retyped literal | **yes** — `courseScene.js:6957`, `characterAsset.js:415` | HIGH |
| 3 | `BROOM_FEEL.pitch.maxPitch` = 0.30 | `src/data/broomFeel.js:323` | `tools/qa/broom-hover-origin.js:68` | sweep bound | **yes** — `PITCH_LIMIT`, `src/render3d/mouseLook.js:16` | HIGH — **FIXED** below |
| 4 | `PITCH_LIMIT` = 1.35, retyped | `src/render3d/mouseLook.js:16` | `broom-lookup-clip.js:61`, `broom-c2-reverify.js:59`, `broom-lookup-float.js:53`, `tool-standard-audit.js:97` | sweep bounds | itself | HIGH — **2 of 4 FIXED** |
| 5 | eye height 1.62 | `simplifiedRegisterMode.js:345` + `clubhouse.js:719-722` | `tests/broom-floor-anchor.test.js:24`, `broom-feel-config.test.js:154` | geometry input, retyped | yes, several | MEDIUM |
| 6 | walk FOV 66 | `courseScene.js:5765` | `broom-feel-config.test.js:32` | inequality guard vs retyped literal | yes | MEDIUM |
| 7 | `DELIVERY_CARRY_RENDER_LAYER` = 30 | `clubhouse.js:5827` | `broom-feel-config.test.js:34` | inequality guard vs retyped literal | yes (the export itself) | MEDIUM |
| 8 | broom handle 1.247 yd | the GLB's socket distance | `broom-feel-config.test.js:153` | reach-contract input | the asset | MEDIUM |
| 9 | `carryHover` / `floorKiss` | `broomFeel.js:142,354` | `broom-hover-origin.js:86-122` | expected value from the same source | none — deliberate internal-consistency check, and it says so | LOW |
| 10 | `RENO.grid` / `RENO.room` | `src/sim/shop.js` | 5 files | sweep bounds + `grime.length == w*h` | room dims vs `INTERIOR`, but that sync is separately pinned (`tests/shop-layout.test.js:25-28`) | LOW |
| 11 | `TX_LOG_CAP`, `NOTIF_CAP`, `PAD_CAPACITY`, the two schema versions, `LEAD_DAYS`, `GRID_W/H` | various | ~10 test files | overfill-then-assert-cap, round-trips | **none found** — sole definitions, and the checks verify enforcement wiring rather than the value | LOW |

Setup-only readers (`REGISTER`/`COUNTER_TOP` for camera placement, `MINUTES_PER_DAY`
as a time step, `CLEANING_TOOLS` as an enumeration) are correct and not listed.

> ## CORRECTION, 2026-08-04 — the "hold-W does nothing" finding is WITHDRAWN
>
> §7 originally closed with a claim that `page.keyboard.down('w')` moves the
> player 0.000 yd under Electron, and that ~20 drivers holding W had therefore
> been measuring a stationary player. **That was wrong, and it was wrong in
> exactly the way this section is about.**
>
> `walk.moveIntent` — a seam already in `courseScene`, whose own comment says
> position delta *"reads identically for 'the key never arrived' and 'the key
> arrived and a wall was in the way'"* — records **130 frames of forward intent**
> during those zero readings. The key arrived, landed in `walkHeld`, and the
> movement block acted on it on every frame. The player was walking into a
> fixture. Facing the open lane, the same press moves **0.935 yd**
> (`tools/qa/walk-input-probe.js`, which now tries four facings as a control).
>
> So: hold-W works, no driver needs re-running on this account, and the instrument
> that would have settled it in one step existed before I started. I reached for a
> conclusion from a position delta, which is the same mistake as reading a
> constant from a copy of itself. Recorded rather than quietly deleted.

## The three that matter

**1 — `pushSpeed` is a live defect, not a latent one.** The review bar it guards
is *"dirt recedes with visible immediacy; a slower push walks over its own pile"*,
enforced as `pushSpeed > 2.2`. The player walks at **3.4** yd/s
(`courseScene.js:5758`, applied `:8138`, ×1.8 running). At 2.6 the broom cannot
beat a walking player — the round-1 "dirt lag" condition is arithmetically back —
and the test is green because it compares against a `2.2` that no longer exists
anywhere authoritative. Production carries the same stale copy at
`courseScene.js:8419` (`speedNorm … / 2.2`). **Not fixed here:** the repair is a
feel-tuning change and this session could not playtest sweeping to confirm it.
Recorded rather than guessed at.

**3 and 4 — the pitch sweeps.** `broom-hover-origin.js` now reads `PITCH_LIMIT`
from `mouseLook.js` and sweeps to it (confirmed: `headAboveFloor` holds at 0.600
from +1.35 down to level, which the old +0.30 ceiling could never have shown).
`broom-lookup-clip.js` and `broom-c2-reverify.js` now import it instead of
retyping `1.35`. **Still retyped:** `broom-lookup-float.js:53` and
`tool-standard-audit.js:97`.

**2 — `bobRate` 8.7.** The config's own comment says it *"MUST match the
characters' stride rate"*, and nothing enforces that. Four copies of 8.7 exist
(`courseScene.js:6957`, `characterAsset.js:415`, `broomFeel.js:268`, and the
test's literal). Any stride retune desynchronises the held-tool bob — the "tool
reads as detached from the body" regression the constant exists to prevent —
with every check green. **Not fixed here.**

---

## Goal 24

**3 — `tests/walk-prop-focus.test.js` slices source and evals it.** It reads a
character range out of `courseScene.js`, strips the `export` keyword, and runs
it through `Function()`. Adding an `export const` anywhere inside that range
killed the whole file with `SyntaxError: Unexpected token 'export'` — and the
stack points at the test's own line 20, not at the line that caused it, so the
error tells you nothing about where to look. Fixed narrowly (strip every
`export`, not three named ones), but the technique still means any edit inside
an invisible line range can break a test in a distant file. **The range is
delimited by two comment strings**; renaming either comment silently changes
what is under test rather than failing.

**4 — a station-versus-crosshair check that passes on both builds.** The
Goal 24 driver `electron-d3-crosshair-outranks-station.js` scored identically
with its own rule reverted, in all three configurations tried. Its checks are
renamed `noRegression_*` for that reason. Recorded here because the SHAPE
recurs: a scenario that cannot reach the code it is aimed at looks exactly like
a scenario in which the code already works.

---

## Goal 29 (compile screen session, 2026-08-16)

**5 — the orchestrator contract test's git fingerprint had a 10 s budget in a
repo whose binary diff costs 18.8 s.** `repositoryMetadata` in
`tools/qa/goal24-interaction-performance.mjs` runs
`git diff --binary --no-ext-diff HEAD` under `spawnSync {timeout: 10_000}`.
The standing LFS pointer wedge keeps 34 vendor GLBs permanently "modified",
and the binary patch of them measured 18.8 s of git time, so the fingerprint
ETIMEDOUTed and the test 'orchestrator never starts a second Electron child
after the first child exits nonzero' failed with a git error that had nothing
to do with the contract under test. This was ALSO the full-gate's hidden
fail-1 on 2026-08-15 (load-dependent then, deterministic by morning) — it was
recorded as "flake" that night, which was wrong: it is an instrument time
budget below the repository's measured floor, the same fault class the
helper's own maxBuffer comment already fixed for SPACE. Timeout raised to
120 s with the measurement in a comment; isolation went 44/45 → 45/45 on the
change alone. The general shape: **any instrument that shells out to git in
this repo must budget for the wedge's 34 binary-diffed GLBs, or its failures
will masquerade as product failures.**
