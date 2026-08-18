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

---

## Goal 29 (optimization overnight, 2026-08-16)

**6 — the Sky trap: a borrowed constructor that ignores its arguments.** The
planted-draw and planted-twin controls built scene objects the repo-standard
way — borrow the first mesh's constructor
(`new donor.constructor(geometry, material)`) so the page never needs to
import THREE. The first mesh in this scene's traverse order is the addon SKY,
whose constructor takes NO arguments and builds its own ShaderMaterial and
BoxGeometry, so every plant rendered the sky's material while the planted
material attached to nothing. Three twin-diff runs read "MISSING PROGRAM" on
all six plants before goal29-properties-probe.js chased it to
`plantCtor: "Sky"` (it also explains the +25 info.memory.geometries the first
draws-control run leaked — each Sky minted its own box). Every donor-built
instrument now pins `constructor?.name === 'Mesh'` AND assigns
geometry/material explicitly after construction. The general shape: **a
subclass constructor is allowed to ignore its arguments; nothing built by
borrowed constructor is proven to carry what you handed it until an assertion
reads it back off the object.**

**7 — instrument-time compiles mint phantom programs.** Calling
`renderer.compile(scene, camera)` (or a direct `renderer.render`) from a
probe, on a SETTLED boot, added +35..56 brand-new program cacheKeys — the
direct path sees different light/scene state than the composer's frames, so
it compiles variants that never occur in play. Any program census must
snapshot `renderer.info.programs` BEFORE its own compile work and analyze
that prefix only (the array is append-only); a census taken after pollutes
its own population with programs the game never uses.

**8 — own-flag visibility in scene walks counts geometry that never draws.**
The stability census checked `o.visible` (the mesh's OWN flag) while
traversing with `traverse()`, so meshes under a hidden ancestor — the
tier-gated retail gondola, the suppressed member lounge — read as standing
draw candidates. 25 of the census's "would-save" figure was a subtree that
has never drawn in this variant tier. This is the standing layers.mask lie in
a second costume: **the fix is traverseVisible (or an explicit ancestor-chain
check), and the draws instrument's planted control now proves counts move
only for geometry the GPU actually draws.**

**9 — texture.clone() shares its Source; assigning .image through the clone
repaints the ORIGINAL.** The Goal 30 rebake probe grafted candidate pixels
onto sign clones via `mat.map.clone()` then `nt.image = candidate` — but
`.image` is a getter/setter over the SHARED `Source`, so both grafts wrote
through to the live sign's texture and all three "resolutions" rendered the
last-assigned 512. The width read-back control caught it (512/512/512). Rule:
to give a mesh different pixels, hand it a texture that OWNS its source (the
candidate loader's own texture object, or `new Source(image)` — the goal29
till driver's pattern); never mutate `.image` on a clone. And a swap
instrument must read the swapped property back off the LIVE object per frame.

**10 — a staged camera spot is a CLAIM, not a fact: collider pushes and
look-alike dressing both frame the wrong subject.** Two Goal 30 probe cuts
shot the entrance's own flag pillars believing they were staged clones (the
dressing flanks the sign at almost the clones' offsets), and two more cuts
shot the groundskeeper's house because `walkEnter` shoves any spawn inside a
prop collider (r + the walker's 0.34 body radius) up to 45 yd down +z rather
than fail. Neither error is visible in green controls that only check the
staged OBJECTS. Rules: after posing the player, read the achieved camera
position back and fail beyond 0.5 yd; and project every staged subject into
NDC and require it in-frame before trusting any screenshot to show it.

## Goal 32 (editor/laptop/tab night, 2026-08-16)

**`clickThroughMenu` had never resumed a save.** The VERIFY2_L fix kept
`/\bContinue\b/` on the button's FLATTENED text, but the label and detail spans
concatenate with no whitespace — an ENABLED button reads
`ContinuePine Hills…`, and `e|P` is not a word boundary, so the regex matched
only DISABLED buttons (whose detail happens to contain the standalone word:
"No Continue save yet"). Every prior "resume" driver silently fell to
new-game — and a new-game boot on a seeded profile OVERWRITES the seeded
autosave (rotation to `.bak`), so the evidence of the miss erases itself.
Fixed in qa-boot by matching the `.menu-action-label` span (flattened text
stays as fallback). Rules: when a detector keys on text, test it against the
ENABLED state's real flattened text, not the disabled state's; and a driver
that requires a seeded resume must assert `bootPath === 'continue'` and fail
closed, because the fallback destroys the seed.

**Display-off vsync throttle poisons timing runs.** Late-night runs recorded
~1,000 ms rAF gaps in every band (Chromium's 1 Hz fake vsync once the display
sleeps) — `FW_QA=1` disables backgroundThrottling but cannot conjure a vsync
source. One earlier "GPU stall" (a lone 1002.5 ms gap in the laptop-cost run)
was this, not the game. Rule: before trusting any frame-gap measurement, check
the sampler's own idle band for a ~1000 ms cadence; keep the display awake for
the battery (`SetThreadExecutionState` keeper, process-scoped) rather than
touching system power config.

## Block A (pacing night, 2026-08-17)

**rAF ticks are not presented frames.** Under a frame cap the declined ticks
still fire `requestAnimationFrame`, and Chromium issues the next one almost
immediately because a declined tick produces no damage and therefore never
waits for a vsync. Measured at cap 60: 33.7% of all rAF gaps came back under
0.5 ms, next to a 4,778 ms outlier — a distribution that reads as a 2,000 fps
game with a catastrophic stall, and is really the skip. Any smoothness number
must be reconstructed from frames that were DRAWN. `frameCapDiagnostics()` now
exports `renderedFrames`/`skippedTicks` for exactly this; sample the counter
per tick and difference it. Rule: never report a frame-interval statistic
taken from raw rAF gaps while a cap is in force.

**An unpaced synthetic mouse flood starves the renderer.** The first version of
the pacing driver dispatched `page.mouse.move` in a loop with no await; every
leg came back at ~1 fps with a 1,036 ms p99 — identical in shape to the
display-off throttle above, and to a genuine catastrophic regression. Use
`{ steps: n }` so the deltas batch into one dispatch, await between sweeps, and
put a NO-INPUT quiet leg in the same boot as the environment control. Rule: a
timing run without a quiet leg cannot tell a game regression from a harness
one.

**`frameCap`'s "panel" is the app's own frame rate.** It derives the panel
interval from the median rAF gap, so on a GPU-bound frame it measures the game,
not the display. Measured this night: Electron's `screen` API reports the
display at 240 Hz; frameCap simultaneously reported panelHz 60.2 / 62.9 / 58.5
in the same three legs, giving `everyNVsyncs: 1` and `skippedTicks: 0` at every
cap — the cap is inert. Rule: the refresh rate comes from
`screen.getDisplayMatching(win.getBounds()).displayFrequency`, and a probe that
reports a "panel" figure which is not one of the OS's advertised modes (181.8
Hz, 90.1 Hz) is reporting the app.

## Block B (NPC night, 2026-08-17)

**`speedIdx = 2` PAUSES the game.** `BALANCE.speeds` is `[0, 1]` — there is no
fast-forward rung. Several drivers set `window.__fw.speedIdx = 2` to "run the
clock fast so a queue forms" (electron-npc-crowd.js says so in a comment);
`BALANCE.speeds[2]` is undefined, main.js's `if (speed > 0)` gate goes false, and
the day stops. The shop then never opens, nobody arrives, and the driver reports
a healthy empty room. The first B0 run waited 181 s that way. Rule: leave
speedIdx alone, and if a driver needs shop time, budget real seconds —
`gameMinutesPerRealSecond` is 4/30, so a game hour is 7.5 real minutes.

**A fresh profile cannot answer a customer question.** The starter shop's sign
defaults to CLOSED, so `shopAcceptsWalkIns` is false and no walk-in ever spawns.
Customer work must resume a seeded save whose `shop.signOpen` is true (his is,
opened at minute 365) and whose `customerSimulation.scheduled` has arrivals.

**Sim health is an environment control, like the pacing quiet leg.** One
five-minute watch came back with a third of its samples showing the clock barely
advancing and a "166-second stuck customer" that was really a stalled day.
Expected advance is 4/30 game-minutes per real second; assert the ratio and call
the leg void under 0.8 rather than reporting the shop.

**Stale coordinates read as "wrong population".** The B0 probe snapshotted body
positions, then painted, then waited, then screenshotted — about a second, during
which the bodies WALKED. 1,955 magenta pixels were in the frame and not one
projected point landed on them, which reads exactly like "these are not the
bodies on screen". Read positions and project them in the SAME tick as the
shutter, and widen the sample window to cover the residual slack.

**Aim at bodies that are drawn.** The first calibrated aim locked onto the
nearest customer, which was an invisible one 0.9 yd away, and photographed
nothing. Filter on `mesh.visible !== false` and prefer a portrait distance.

**A piped gate hides its own exit code — twice now.** `npm run gate | tail -30`
reports the exit status of `tail`, which is always 0, so a gate whose suite step
failed printed "[exited with code 0]" and read as green. It cost a false green in
the goal-32 session and again on the NPC night, on the same flake. Rule: run the
gate unpiped into a file and echo `$?`, then read the file. The same applies to
`npm test`; if a summary line says `# fail N`, the exit code you saw through a
pipe is meaningless.

**Known load-sensitive flake:** `tests/goal24-negative-control-phase-alignment.test.js`
— "the negative control drains stale rAF timestamps before accepting a post-stall
boundary" (expected 2, actual 1). Passes 12/12 in isolation across repeated runs;
fails only under full-suite contention. It reads real rAF timing through
`tools/qa/lib/goal24-interaction-recorder.mjs`, so a loaded machine changes what
it measures. Not attributable to any 2026-08-17 change.

## 2026-08-17, goal 34 — the delays and the cap

**Arrivals cannot see invalidation; count DEPARTURES too.** Every warm probe in
this repo has counted new program cacheKeys. A surface that was warm, went cold
and recompiled shows up as an arrival only after the stall, and as +0 net if
anything else was disposed in the same window. `programs.length` is a NET count.
The set difference A\B over full key lists is the missing instrument
(`tools/qa/goal34-editor-roundtrip-invalidation.js`), and its negative control
must swap a uniquely keyed material onto a mesh PROVEN TO BE DRAWING — an
`onBeforeRender` stamp decides which. The first cut staged a 2 cm mesh at the
camera origin, inside the near plane, where it never drew: the control reported
"no deletion detected" and was measuring nothing at all.

**Escape does not leave the course editor.** main.js claims it for the pause
menu before courseEditor's own handler sees it. A driver that presses Escape and
waits gets a paused game with the editor still active underneath, and every
measurement after that point is taken inside the editor. The gesture that leaves
is the Exit button in `.ced-top-btn`, plus "Discard & leave" if the session is
dirty. Relatedly, `editorUi.hide()` leaves `.ced-rail` IN THE DOM — wait on
`offsetParent === null`, never on removal.

**A dead waitForFunction is an instrument, not just a delay.** Ninety seconds
parked in a predicate that can never come true let the window lose the
foreground, and Chromium throttled rAF to 1 Hz. Every gesture measured after
that returned a tidy ~1,013 ms and looked like a real regression. The metronome
near 1,004/1,013 ms is the tell. Every timed gesture now carries a QUIET
no-input control immediately before it; if the control is already dirty the leg
is void and says so.

**Profile-cold is not machine-cold.** The NVIDIA shader cache sits underneath
Chromium's GPUCache, is machine-wide, and survives a wiped profile. The same
five laptop programs cost 14,401 ms, 3,565 ms and 383 ms on three runs of one
build. The ARRIVAL LIST is exact on any machine state — programs are per-process
and must be created every launch — but the seconds beside it are only a floor,
and only the first run of a build after a driver-cache eviction sees the real
number. Never A/B two warm fixes by their milliseconds; A/B them by arrivals.

**Both of frameCap's periodic re-checks were dead after 31 samples.** They fired
on `array.length % 8 === 0` and both arrays cap at HISTORY = 31; 31 % 8 is 7, so
once the history filled the trigger never fired again for the rest of the
session. `tests/frame-cap-cadence.test.js` asserts the panel estimate re-solves
on a display change and passed throughout, because it builds a fresh instance
per case. A test that never lets the buffer saturate cannot see a
saturation bug.

## 2026-08-17, nav rebuild stage 2

**An organic leg is at the mercy of what the shop happens to do.** The five
minute before run shoved in BURSTS — 436 correction frames in the first fifteen
seconds, then ninety seconds of nothing, then 250 a sample for a minute. The
first A/B ran two minutes per solver and the legacy leg landed in a quiet
stretch: 0.27 shoves/s against the 11.69 the same build had produced an hour
earlier. Reported as it stood it would have been a 43x understatement of the
thing being fixed. Any leg shorter than the burst period must STAGE its stress,
not wait for it; `nav-solver-ab.js` pinches the crowd onto a ring at a fixed
0.80 yd and asserts afterwards that the tightest staged gap actually bit.

**"Two customers on screen" is not "the crowd is legible."** The framing gate
counts customers whose projected position is inside the frame, and it passed at
100% on footage where a single body filled the screen from a yard away — no
verdict about whether anybody touched can be read off that. The gate now has a
companion: the player backs off until the nearest customer is 3.4 yd away and
re-aims. A distance test and an on-screen test are different questions.

**A solver guarantee is worth nothing if the pass behind it disagrees about the
number.** ORCA held pairs at 0.72 yd; `separate()` called anything under 0.78 a
violation and pushed. The velocity solver measured NO BETTER than the heuristic
it replaced (2.38 vs 2.20 shoves/s) and every one of those shoves was the
threshold, not the solver. Two constants naming the same physical distance in
two modules must be tied together by a test, not by a comment.

## 2026-08-17, nav rebuild stages 3-4

**A stall meter that counts RECOVERY ACTIONS cannot measure a build with no
recovery.** Every count of stuckness in clubhouse.js was a count of ladder
escalations, so switching the ladder off would have reported an empty, frozen
shop as perfectly healthy — zero escalations, because there was nothing left to
escalate. The replacement reads `noProgressT`, which the walking branch maintains
whether or not any rung exists, and it is what caught the 246-second stall.
Whenever a fix DELETES a mechanism, check first whether the mechanism is also the
instrument.

**Do not commit while `npm run gate` is running.** goal24's interaction
orchestrator hashes the repository and aborts any measurement whose tree changed
underneath it: `serialized-stop-01-cold-door-01: repository changed before this
measurement process.` A one-line commit landed mid-suite and failed a test that
had passed standalone four times that hour. The check is correct and the run is
void; the tree has to be quiet from `npm run gate` to GATE_EXIT.

**`separate()` is both the mechanism and the acceptance meter, and only one of
them was meant to go.** Deleting it outright would have driven `corrections` to
zero by construction and made every before/after comparison in this rebuild
meaningless. `separateMode = 'measure'` computes the correction and throws it
away, so the number keeps meaning "how much would a positional pass have had to
do" across the whole rebuild.

## 2026-08-17, goal 35 — the course editor

**A warm holding FRAMES cannot outlast a gate holding SECONDS.** The editor warm
pressed every tool through the editor's real `setTool` and held four frames on
each — about 28 ms. The clubhouse's visibility gate (interior draw distance,
per-lamp render budget) runs on `visClock > 0.5` inside `clubhouse.update`, i.e.
at 2 Hz, so every one of those presses warmed the camera's OLD light census and
minted nothing: `terrain+0p paint+0p tee+0p …` (qa/goal34/warm1.json,
`__fwWarm.editorMinted`). The tool row cost exactly what it had before while the
warm reported `done`. Rules: a warm's hold is TIME-bounded against the slowest
gate it waits on, and every warm reports what it MINTED per stage — otherwise a
warm that does nothing is indistinguishable from one that works.

**`nearestTwinDiffs` names an axis against the twins that HAPPEN to exist.** The
editor's arrivals read "point-light count 4 → 0" for two goals, and that reading
drove a whole light-census warm that removed nothing. Once the editor warm
minted the 0-light programs, two UNCHANGED surfaces re-labelled themselves: the
laptop's five went from a texture-slot/colorspace/shader-identity story to
"0 → 4", and Tab's from "4 → 1" to "0 → 1", without one line of laptop or Tab
code changing. The diff is a pointer to the nearest neighbour in the current
key set, not a claim about what the program is FOR. Confirm with the census the
gesture actually ran under (the tripwire now samples it mid-gesture, because a
reading taken after the surface closes is the walk state again).

**Programs are released from exactly one place.** `releaseProgram` in
three.module.js is reachable only from `deallocateMaterial`; a material keeps a
Map of every variant it has used, and changing light counts releases nothing.
That is why goal 27's "the under-veil round trip invalidates warmed state" could
be retired, and it also says which residuals are unwarmable: anything behind a
material DISPOSAL (the editor's object-placement ghost clones a material per
type and disposes it on the next; the exit discard rebuilds the water
materials) mints a fresh program every time however well the boot warmed.

**A driver that walks by holding W is not walking to the door, and a SHUT DOOR
IS NOT A WALL.** Four cuts before the route got indoors: six blind legs (walks
into a hillside); aim at the interior's world centre (a heading into a wall —
14 legs, 7.6 yd, never in); aim at the node whose name matches the main entrance
(found `ProceduralMainEntranceFallback`, the HIDDEN stand-in that only shows when
the authored door fails to bind, sitting at the group origin — the same wrong
heading with a better name on it); and then a VISIBLE `SOCKET_MainEntrance` with
a consistent wall-follow, which circled the building for 26 legs from 8 yd and
still never got in. The answer was one keypress: E, when blocked within 4.5 yd of
the door. Twenty-six legs and outside became four legs and inside. The per-leg
distances are what pointed at it — 5.13, 2.52, 0.18, 0.85, 0.40 … is a body
leaning on something, not a bad heading — and a walk-in helper that does not
report per-leg progress cannot show you that.

**Adding a step to a route changes the steps after it.** Row 08b (place a tee)
was added because his route ends with "place something". Row 09 below it then
went from 0 arrivals / 0 departures to 3 / 4: leaving now DISCARDS a real edit,
and the discard's course rebuild disposes the water materials and mints them
again. The cost is real and was invisible while the route never edited anything
— but row 09 before and after this change is not the same measurement, and any
table that puts them side by side has to say so.

**The tripwire's row count UNDER-REPORTS, and it under-reported in this goal's
favour.** `programTripwireScan` returns early unless `programs.length` grew since
the last scan, so any window where arrivals and departures overlap is never
examined at all — the new keys are simply never seen. The cold-profile run of
this goal's route reported `tripwireRows: 0` while the per-surface key-set diffs
in the same run reported **5 arrivals** (qa/goal34/cold35.json): row 09 arrived 3
and departed 6, a net of −3, so the scan skipped and took rows 08b and 10 with
it. `programs.length` is a NET count — this is the same fault already recorded
for arrival-only probes, one layer down, and it means the tripwire is a floor and
the per-surface diff is the number. Do not report "empty tripwire" off the row
count alone.

## 2026-08-17, goal 36 — the editor cursor and the laptop

**`renderer.info.programs` cannot see a SECOND WebGL context, and one of ours is
load-bearing.** The laptop's product thumbnails are rendered per sku by
`render3d/clubhouse/thumbs.js`, which owns its own `WebGLRenderer`. The Pro Shop
page switch therefore reads `+0p/+0g/+0t` from the main renderer's census while
`getProgramInfoLog` sits at 30.7 ms in its own CDP self-time profile
(qa/goal36/cold1.json). Two goals have now read "0 program arrivals" as "nothing
compiles here" — it only ever meant "nothing compiles in the renderer we asked".
Any surface that draws through a second context needs its own instrument or a
profiler, not the program census.

**A warm that reports a FRAME COUNT can report success having warmed nothing.**
`__fwWarm.laptopThumbs = 'drawn:90'` was ninety FRAMES held on the laptop's home
page, which shows no product cards. Every thumbnail was still cold, and the first
desk that showed them paid 116 ms for the catalogue. A warm's report has to name
what it warmed, not how long it waited — the same fault as goal 35's
`terrain+0p`, in the opposite direction: there the string exposed a dead warm,
here the string looked like a count and was a duration.

**An instrument that re-derives the shipped formula measures the build it was
written against.** The first cut of the bar probe computed `bootStarted + 850`
because that is what `paintScreen('boot')` did. That number is meaningless the
moment the formula changes, and it would have gone silently green. The probe now
asks `clubhouse.laptopBootProgress()` and falls back to the old constant only
with the string `FALLBACK: bootStarted + 850 (old fixed clock)` in the report, so
the two can never be confused. The negative control run shows the fallback label
in exactly the run where the API is absent.

**`walkInsideClubhouse` returns `ok`, not `inside` — and reading the wrong field
produces TWO wrong facts.** qa/goal36/prof1.json both declared the walk a failure
and went on to record its "shop floor" frame-time baseline outdoors, at 87 fps
against the 102.8 fps the same window measures inside. A destructured field that
does not exist is `undefined`, which is falsy, which reads as a clean negative.
Check a helper's return shape before believing its answer.

**The editor's rig-target fallback is nearly unreachable, so a driver has to
FIND a miss rather than assume one.** Two phases of the cursor driver looked like
they tested "the pointer is not over the course" and tested nothing of the sort:
a ray through a tool-rail pixel lands on the ground BEHIND the panel, and a ray
through the top of the screen lands on the ground at the HORIZON — both in
bounds. It takes the editor's minimum pitch (0.08 rad) to put sky in frame. The
driver now probes `raycastGround` across the screen for a pixel that misses,
orbits until one exists, and records the pitch, so a run that never reached the
branch says `the anchor path is UNTESTED by this run` instead of passing.

**Scene-graph `.visible` is fair for the editor overlays, and here is why.** Debt
item 8 says own-flag visibility counts geometry that never draws. It does not
bite for `editorCursorState()`: `brushRing`, `editorFeaturePreview` and the
placement ghost are all direct children of `scene` with default layers, so the
flag is authoritative for submission. The driver still projects the world point
through the live camera and fails on off-screen, and the frames were viewed.
State that reasoning when using an own flag; do not just use one.

**IN FRUSTUM IS NOT VISIBLE, AND I SHIPPED A PASS THAT PROVED IT.** The goal-36
cursor driver projected the indicator's centre through the live camera and
checked `|ndc| <= 1`. `qa/editor-cursor/fixed1-B02-Terrain.png` passed that test
at ndc (−0.846, 0.825) — the top-left corner, which is where the editor's tool
rail is drawn. The ring was BEHIND AN OPAQUE PANEL with one sliver escaping past
its edge, and the driver called it `present=true onScreen=true`. The editor's
chrome is painted over the canvas and a ray goes straight through it, so a
pointer on the rail yields a valid, in-bounds, invisible hit.

The fix for the instrument is `document.elementFromPoint` — the only thing that
knows what is actually on top at a pixel — sampled around the indicator's
CIRCUMFERENCE, not just at its centre, since a large brush can be half visible.
`tools/qa/editor-brush-ring.js` reports a visible fraction and names the blocking
element (`ced-row`, `ced-tool-panel`, `ced-tip`), which turns "it looks wrong"
into "0% visible, blocked by ced-row x31".

**AND THE FIRST RUN OF THAT DRIVER PASSED EVERYTHING.** On that boot the ray
from the rail happened to leave the course, so the rig-target anchor caught it.
The course is seeded per boot, so whether the hidden hit is in bounds varies run
to run: the defect is intermittent BY CONSTRUCTION. A single green run of a
geometry-dependent check is not evidence — place the pointer deliberately
(over the size slider, over the tip box) rather than hoping the interesting case
turns up.

## 2026-08-18, goal 37 — the asset merge

**THE GOLDEN CAPTURE CAN STAGE A POSE AT THE CEILING, AND IT LOOKS LIKE A 24%
REGRESSION.** The first full gate on the committed merge failed with `tool-mop`
at 24.4245% against a 0.75% budget. It was not the mop: the merge changed no
`src/`, no `vendor/`, no capture driver, and `tests/goldens/tool-mop.png` was
byte-identical to pre-merge main, which had measured that pose at 0.2577% hours
earlier. Putting the baseline beside the capture settled it in one look — the
baseline is the shop wall with the mop in hand, the capture is two dark beams on
a flat plane. The camera was pitched up and the mop was not in frame at all.
Three later runs read 0.3077, 0.4251 and ok.

The lesson is the number's SHAPE. A tool pose that drifts reads in tenths of a
percent; twenty-four percent is a different photograph, and a different
photograph is a staging fault until proven otherwise. Rebaselining that run
would have written a picture of the ceiling into the contract — and `--accept`
would have taken it without comment.

**A LARGE UNCOMMITTED CHANGE BREAKS goal24's ORCHESTRATOR CONTRACT TEST WITH AN
ERROR THAT HAS NOTHING TO DO WITH THE CONTRACT.** `repositoryMetadata()`
fingerprints the tree with `git diff --binary --no-ext-diff HEAD`. A previous
session already raised its `maxBuffer` to 256 MB for the standing 34-GLB wedge;
101 new binary GLBs staged blow through even that and the test reports
`spawnSync git ENOBUFS`. Committing takes the same diff to 0 bytes. Expect this
on every future asset merge — the failure names git, not the code under test.

**`git lfs checkout` CAN SILENTLY NO-OP ON POINTERS WHOSE OBJECTS ARE PRESENT.**
Merging with the LFS clean filter bypassed (the only way past the pointer wedge)
lands incoming LFS files as 132-byte pointer stubs. `git lfs checkout -- Assets/`
returned success and changed nothing, with the objects sitting in
`.git/lfs/objects` at the right size. They had to be copied by oid and then
re-verified by glTF magic — 76 of 76. **Never assume an LFS materialisation
worked; check the file's first four bytes.**

**A PROBE THAT ASKS FOR SOMETHING THE PUBLIC API DOES NOT EXPOSE REPORTS ELEVEN
PHANTOM MISSES.** `clubhouse().merch` is not on the returned API, so
`m?.has ? ... : null` answered null for every hero model and the driver printed
`prototypes loaded: 0/11` — on a build where the towel was demonstrably drawing.
An unreachable probe must report UNAVAILABLE, never absent.

**AND THE CHECK DEMANDED A POSE THE GAME NEVER ASKS FOR.** The same driver
failed on "hung polo missing", so the polos were moved onto a rail — and it
failed again. Slots are keyed by SKU, not by fixture: `polo1` builds
`tableApparel`, which is folded stacks, whatever fixture it sits on. The check
was wrong twice before the wiring was. Read the data model before asserting what
it should produce.

## 2026-08-18, close-the-week night

**A STAGED SAVE THAT IS THE START OF A CAMPAIGN HAS NO CUSTOMERS, AND FIVE RUNS
WENT INTO LEARNING THAT.** `people=0` for five minutes, three separate times.
The shop opens at 09:00, so moving the clock looked like the fix and was not —
the save's shop has never opened at all (condition 10, objective still "enter
the closed clubhouse"). The nav watch's own guards fired correctly every time
("never had two people in the room at once — this watch has measured nothing
about crowds"); I did not act on them until the third run. **Read the driver's
failures before re-running it.**

The way through is `QA_NAV_STAGE=n`, which spawns through the production spawn
path (`sendWalkInToDesk` / `sendToCounter`). Only the arrival is scripted. Say
so in the report rather than implying organic play.

**AND THAT DRIVER STILL WALKED IN WITH SIX BLIND LEGS OF HELD W** — the method
goal 35 measured as unable to reach the room, in a file goal 35 did not touch.
When a navigation fix lands, grep for the OLD method across `tools/qa` and
retire it; otherwise every driver written before the fix keeps the bug.

**A PROBE THAT ASKS THE PUBLIC API FOR SOMETHING IT DOES NOT EXPOSE REPORTS
ABSENCE, NOT UNAVAILABILITY.** `clubhouse().merch` is not on the returned API,
so `m?.has ? ... : null` answered null for all eleven hero models and printed
`prototypes loaded: 0/11` on a build where the towel was demonstrably drawing.
An unreachable probe must say UNAVAILABLE.

**A CHECK CAN BE WRONG TWICE BEFORE THE CODE IS WRONG ONCE.** The apparel driver
failed on "hung polo missing", so the polos were moved onto a rail — and it
failed again. Slots are keyed by SKU, not by fixture: `polo1` builds
`tableApparel`, which is folded stacks, whatever fixture it sits on. Read the
data model before asserting what it should produce.

**A UNIT TEST THAT HARD-CODES COORDINATES IN A ROOM WILL GET THEM BACKWARDS.**
The stop-legality test picked (0.6, -0.2) as "open floor" and the front desk's
centre as "solid"; both were the opposite. It now scans the room, classifies
every point by asking the geometry, and fails loudly if the room contains no
example of either — because then it is measuring nothing.
