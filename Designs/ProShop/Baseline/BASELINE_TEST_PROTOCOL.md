# Pro-Shop Phase 0 — Baseline Test Protocol

This document exists so a later session can reproduce the exact views, footage and
measurements captured in this folder. Every value below was read from the running
game, not from documentation. Values that could not be verified are marked
**UNKNOWN** rather than guessed.

---

## 1. Repository state

| Field | Value |
|---|---|
| Branch | `feature/pro-shop-vertical-slice` |
| Baseline commit SHA | `78ebbb7aafe7876446c5de778b78c362af5fc563` |
| Baseline commit subject | `Initial clean Golf Simulator repository` |
| Baseline tag | `pro-shop-pre-rebuild-baseline` (annotated) |
| Tag object SHA | `85c6e66384389bb08e0de1fc5cb4de6e00940cc0` |
| Tag target commit | `78ebbb7aafe7876446c5de778b78c362af5fc563` |
| Remote | `https://github.com/kennethcxv/Golf-Simulator.git` |
| Working tree at capture | clean apart from the Phase 0 package itself |

All captures in this folder were produced from the tree at `78ebbb7` plus the four
new `tools/qa/proshop-baseline-*.js` capture scripts, which add no gameplay code.

---

## 2. Machine and runtime

| Field | Value |
|---|---|
| OS | Windows 11 Pro 10.0.26100 |
| Shell | PowerShell 5.1 / Git Bash |
| Node | v22.23.1 |
| GPU (as reported by WebGL) | `ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| Logical CPU cores | 16 |
| System RAM | **UNKNOWN** — not queried |
| Runtime used for capture | Google Chrome (stable channel) driven by Playwright 1.61.1 |
| Chrome binary | `C:\Program Files\Google\Chrome\Application\chrome.exe` (`channel: 'chrome'`) |
| Headed / headless | **headed** (`HEADED=1`) so the real GPU is used |
| three.js | 0.185.1 (`vendor/three.module.js`, import map at `index.html:9`) |
| Electron (shipping runtime, not used for capture) | 39.8.10 |

The shipped game runs in Electron (`main.cjs`). The same `src/` runs unmodified in a
plain browser, which is what all repository QA tooling drives. Baseline captures use
the browser path because it is the only scriptable one. Electron-only surfaces
(native save store, window-mode/resolution controls) are therefore **not** exercised
by this baseline.

---

## 3. Launch commands

Start the static dev server (port 8457) in one shell and leave it running:

```bash
node tools/serve.cjs
# golf-empire dev server: http://localhost:8457/
```

Then run any capture script through the repository's own Playwright runner:

```bash
# 10 fixed screenshots + environment/scene data
HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-capture.js

# ~43 s broom interaction video
HEADED=1 VIDEO_DIR=/tmp/proshop-vid \
  node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-broom-video.js

# ~43 s laptop + customer + checkout video
HEADED=1 VIDEO_DIR=/tmp/proshop-vid2 \
  node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-systems-video.js

# performance, 3 runs per scenario
HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-performance.js
```

The shipping game is launched with `npm start` (Electron) or `npm run dev`
(Electron + DevTools on remote-debugging port 9225). Neither was used for capture.

`VIDEO_DIR` makes `tools/qa/run-playwright.cjs` attach Playwright's context recorder
(`run-playwright.cjs:77-82`). The recorder writes a single `.webm` with a hashed
filename when the context closes; rename it to the target name afterwards:

```bash
mv /tmp/proshop-vid/*.webm  Designs/ProShop/Baseline/video/baseline-broom-interaction.webm
mv /tmp/proshop-vid2/*.webm Designs/ProShop/Baseline/video/baseline-laptop-checkout-customer.webm
```

---

## 4. Display and graphics settings

| Field | Value | Source |
|---|---|---|
| Viewport / capture resolution | 1600 × 900 | set by each script |
| Canvas backing store | 1600 × 900 | `renderer.domElement` |
| Device pixel ratio | 1.0 | `window.devicePixelRatio` |
| Renderer pixel ratio | 1.0 | `renderer.getPixelRatio()` (engine caps DPR at 1.5) |
| Window mode | windowed browser page, not fullscreen | — |
| Walk field of view | **66°** | `walk.state.fov` and `camera.fov` |
| Camera near / far | 0.15 / 6000 | `camera.near` / `camera.far` |
| Aspect | 1.7778 | `camera.aspect` |
| Eye height | 1.75 yd | `walk.state.eye` |
| Tone mapping | ACESFilmic (`THREE` constant `4`) | `renderer.toneMapping` |
| Tone mapping exposure | 1.12 | `renderer.toneMappingExposure` |
| Output color space | `srgb` | `renderer.outputColorSpace` |
| Shadow map | enabled, type `1` (`PCFShadowMap`) | `renderer.shadowMap` |
| GTAO | enabled (half-resolution pass) | `scene3d.post.gtao.enabled` |
| Bloom | enabled (strength 0.12, effectively negligible) | `scene3d.post.bloom.enabled` |

Console emits one benign warning every boot:
`THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.`
The engine requests PCFSoft and three.js silently downgrades it to PCF. Recorded here
because it means the shipped shadow filtering is *not* the one the code asks for.

---

## 5. Starting state

Every capture starts from a **fresh, neglected game** — no save is reused:

1. `localStorage.clear()`, then reload.
2. Click **New game**.
3. Choose the **Relaxed** difficulty card.
4. Confirm if a confirmation button appears.
5. Wait for `window.__fw.scene3d.walk.isActive()`.
6. Wait for `.load-veil` to reach `display:none` or `opacity:0`.
7. Wait a further 2.5 s so shader prewarm has finished and the GTAO history has settled.

Resulting world state, verified at capture time:

| Field | Value |
|---|---|
| Property id | `willow-creek` |
| Property display name | Pine Hills Municipal Golf |
| Clubhouse variant | `pine-hills` (`src/data/marketplace.js:71`) |
| Difficulty | Relaxed |
| Campaign enabled | `true` |
| Shop condition | **10 / 100 — "filthy"** |
| Grime cells | 104 (13 × 8 grid), mean value 0.757 |
| Debris clusters | 18, total mass 3.93 |
| Clutter piles | 8, none cleared |
| Window dirt | `[0.87, 0.79, 0.92, 0.89]` |
| Architecture components restored | all seven `false` (shell, porch, windows, panels, trim, ceiling, floor) |
| Cleaning kit owned | `true` at fresh start |
| Player spawn | outside the main door, local `(-0.8, +13.7)` |

### Time, weather and clock

Screenshots and videos pin the clock to **13:00 (1:00 PM)** and set `speedIdx = 0`
(paused) before each frame:

```js
state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 13 * 60;
scene3d.applyTimeWeather(13 * 60, state.weather);
```

This is mandatory. Unpinned, roughly eight game-minutes pass per real second, so a
ten-shot pass drifts across more than an hour of sun angle and the images stop being
comparable. A fresh game otherwise starts at **06:00**.

Weather is **not** pinned and is **not** reproducible — see §8.

---

## 6. Room coordinate system

All poses are expressed in **local room coordinates** — metres/yards offset from the
live `clubhouse().interior.position`, which is the only stable anchor:

```js
const o = scene3d.clubhouse().interior.position;
walk.state.x = o.x + localX;
walk.state.z = o.z + localZ;
```

Measured footprint (sampled on a 0.5 yd grid with `clubhouse().isInside`):

| Field | Value |
|---|---|
| Local X range | −8.5 … +8.5 (width 17.0) |
| Local Z range | −5.0 … +5.0 (depth 10.0) |
| Interior world position (this capture) | `(-360, -2.442, 4)` |
| Interior rotation Y | 0 |
| Main door (world) | `(-360.8, 9.625)` → local `(-0.8, +5.625)` |
| Laptop pose (world) | `(-359.08, y, 5.778)` → local `(+0.92, +1.778)`, yaw 0, pitch −0.510 |

Orientation, confirmed visually:

* **−Z** is the merchandise / lounge end of the room.
* **+Z** is the checkout counter and the entrance doors.
* Yaw convention is `forward = (-sin yaw, -cos yaw)`; to look from `A` at `T`:
  `yaw = atan2(-(Tx-Ax)/d, -(Tz-Az)/d)`.
* Pitch is **negative-down**.

> **Do not use the `L2W` helper from `tools/qa/shoot-clubhouse.js`.** That harness
> hardcodes a world offset of `(x − 8, z + 228)`, which belongs to a different
> property and does not resolve to this room. Its poses photograph the wrong place.
> Always derive from the live `interior.position`.

---

## 7. Test routes

### 7.1 Screenshot route

Ten fixed poses, listed with exact transforms in
[`BASELINE_CAMERA_TRANSFORMS.md`](BASELINE_CAMERA_TRANSFORMS.md). After moving to a
pose the script waits 750 ms for culling, shadows and AO to settle, then screenshots
the full page (HUD included). Before the first shot it waits **14 s** so the arrival
objective toasts expire.

### 7.2 Broom route (`baseline-broom-interaction.webm`, 42.5 s)

Beats, in order, with their offsets in the recording:

| Beat | ≈ offset | What it shows |
|---|---|---|
| `idle-hands-free` | 0.1 s | empty hands, idle |
| `equip-broom` | 3.1 s | equip animation (`Broom_Equip` + procedural rise/settle) |
| `idle-holding` | 6.3 s | idle sway with the broom out |
| `walking` | 9.8 s | strafe right then left — gait bob |
| `begin-surface-contact` | 15.4 s | first left-mouse contact with the floor |
| `continuous-sweeping` | 18.1 s | strafing along the seeded debris row |
| `direction-changes` | 24.9 s | four yaw changes under continuous use |
| `cleaning-near-wall` | 31.8 s | working the west-wall cluster into the corner |
| `stop-use` | 38.3 s | releasing the button |
| `unequip` | 41.3 s | stow animation |

**Aim geometry matters.** The contact point is a floor-plane projection
(`clubhouse.js:5198`) that lands `eyeHeight / tan(−pitch)` ahead of the player and is
discarded past the tool's `reach` (broom: 2.4). The script stands `1.6` yd back with
pitch `−0.82`, which puts the head on the debris row at local z ≈ +2.8. An earlier
route used pitch `−0.34` and produced 45 s of footage in which the broom never
touched a single cluster. If you re-cut this route, verify with
`walk.cleaningDiagnostics().result.did > 0` — the script records those samples into
`data/baseline-broom-video.json` (`cleaningLanded: true`).

Equip is driven by `walk.setTool('broom')`. The two in-game routes are `[E]` on the
stockroom broom prop at local `(6.96, 1.82)`, or the `F` belt once the cleaning kit is
owned. Use is the **real** left-mouse path; movement is the **real** keyboard path.
Look is written directly to `walk.state.yaw` because pointer-lock mouse look is not
automatable — every camera harness in `tools/qa` does the same.

### 7.3 Laptop / customer / checkout route (`baseline-laptop-checkout-customer.webm`, 43.0 s)

| Beat | ≈ offset | What it shows |
|---|---|---|
| `approach-laptop` | 0.0 s | standing behind the counter |
| `laptop-open` | 2.7 s | `[E]` on the laptop, camera eases to the seat pose |
| `laptop-page-home` | 5.8 s | a page click landing on the projected DOM quad |
| `laptop-exit` | 8.0 s | Escape |
| `customer-route` | 13.0 s | a customer enters and walks to the counter |
| `checkout` | 22.7 s | goods placed on the staging tray |
| `checkout-observe` | 32.0 s | held on the register framing |

The customer is staged with `clubhouse().sendToCounter(['balls1','glove1'], 'card')` —
the clubhouse's own QA hook (`clubhouse.js:10424`), which performs a real
`pickFromShelf` and routes a real customer. It is the same hook every register driver
in `tools/qa` uses.

### 7.4 Performance route

Seven scenarios × 3 runs, described in
[`BASELINE_PERFORMANCE.md`](BASELINE_PERFORMANCE.md). Sampling method matches
`tools/qa/perf-probe.js`: a `requestAnimationFrame` delta recorder, first five frames
dropped, 1 % low computed from the worst 1 % of frames.

---

## 8. Known variability

These vary between runs and must be accounted for in any before/after comparison.

1. **The new-game seed is random.** `src/main.js:2829` calls
   `newStarterEmpire(mode, (Math.random() * 2 ** 31) | 0)`. The golf course terrain
   therefore differs every run, which changes the clubhouse floor height: across three
   boots `interior.position.y` was `+0.471`, `−0.435` and `−2.442`, while
   `interior.position.x/z` stayed exactly `(-360, 4)`.
   *Consequence:* **world Y coordinates are not reproducible; local room coordinates
   are.** Everything through the windows (terrain, trees, horizon) also differs.
   *Hardening for later phases:* seed the empire explicitly before capture instead of
   using the menu's random path.
2. **Weather is not pinned.** Fresh state observed: 64 °F high / 46 °F low, 0 in rain,
   humidity 0.55, wind 14 mph, 2 drought days. `applyTimeWeather` is called with
   `state.weather`, so overcast vs. clear changes interior light.
3. **Customers spawn live and are not suppressed.** A customer walked into frame
   during shots 05, 07, 08, 09 and 10 of this pass. This is honest — it is what the
   room looks like in play — but a comparison pass may or may not have one.
4. **Objective toasts.** Arrival objectives fire when the player first enters. The
   script waits 14 s for them to expire, but reservation chatter ("Hi, do you have
   anything open for 4?") can still appear mid-pass.
5. **HUD chrome is always present** — cash, date/clock, the "Shop condition N —
   filthy" badge and the control hint bar. Shots are the player's real view, not a
   clean render. Shop condition read **9** in early recon and **10** in the committed
   pass; it is derived from live state and drifts slightly.
6. **`interior.position.y` also settles during the first seconds after load**, so
   always wait for the veil plus the 2.5 s settle before reading it.
7. **Load time varies** with shader-cache warmth: 18.2 s new-game-click-to-veil-clear
   on the committed runs, but the very first run of a session is slower.

---

## 9. What this protocol does not cover

* Electron-specific behaviour (native save store, resolution/window-mode controls).
* Audio. Playwright's recorder captures video only, and all game audio is synthesised
  WebAudio with no files to inspect.
* Any save/reload cycle — the baseline captures a fresh game only.
* GPU-side texture memory. `renderer.info.memory.textures` counts texture objects, not
  bytes; no byte-level texture-memory figure was obtainable.
