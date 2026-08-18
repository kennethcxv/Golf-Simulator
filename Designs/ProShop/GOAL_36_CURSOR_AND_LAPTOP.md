# Goal 36 — the editor's cursor, and what the laptop's open actually is

Two items. The first is a missing affordance and no amount of milliseconds
would have fixed it. The second turned out not to be the thing it was filed as.

## 1. The cursor is on screen before the mouse moves

> "I open the editor and there is nothing showing me where I am about to edit
> until I move the mouse and wait."

Exactly right, and the cause was already written down: the brush ring, the
shaped feature outline and its fill are **retained** across pointer moves — but
nothing reveals them except a pointer move, and after entry no pointer move has
happened. The overlays existed, warmed, correct, and invisible.

Three separate holes, all of which had to close:

| | before | after |
|---|---|---|
| entry, mouse untouched | nothing | ring at the pointer |
| every tool change, mouse on the rail | cleared at the top of `setTool`, never redrawn | redrawn in the same turn |
| select (the tool it OPENS on), paths, measure, a green in pin mode, a stream | drew nothing in any state | ring |
| pointer off the course entirely | all three overlays cleared | anchored at the rig target |

The redraw in `setTool` runs **after** the overlay clear and **after** the
camera snap, in the same turn — so it reads the pose the player is about to see
and no frame is ever drawn without it. That ordering is asserted, because
getting it wrong is invisible in a screenshot and obvious in the hand.

There is no way to ask a browser where the mouse is without an event. The first
open of a session therefore seeds at the **viewport centre** — where the walking
crosshair sits, and where Chromium leaves the cursor when pointer lock releases.
Every later open uses the real position, tracked from the editor's own handlers
and never during playtest, where the pointer is locked and clientX/Y are frozen.

### Evidence

`tools/qa/editor-cursor-affordance.js`, three phases, each step recording what
the renderer will actually submit (`scene.editorCursorState()`), where that
projects to in NDC through the live camera, and a screenshot.

* **Watched failing first**: the same driver on this build with only
  `courseEditor.js` reverted to HEAD — `qa/editor-cursor/control1.json`,
  **16 rows of `cursor absent`**: entry, all ten tools with the mouse untouched,
  and select/paths/measure even with the mouse on the rail.
* **Green**: `qa/editor-cursor/fixed3.json`, **24/24, zero absent, zero
  off-screen**.
* Frames viewed, not just counted: `control1-A00-open.png` is the editor open on
  an empty course; `fixed1-A00-open.png` is the same frame with the ring on the
  fairway; `fixed1-tileA.png` carries all ten tools.

### The anchor branch is nearly unreachable, and that is worth knowing

Two phases of this driver *looked* like they tested the rig-target fallback and
did not. The editor camera looks down at a course that fills the frame, so:

* a ray through a **tool rail** pixel lands on the ground **behind the panel** —
  in bounds, so the pointer path handles it and the anchor never fires;
* a ray through the **top of the screen** lands on the ground at the **horizon**
  — also in bounds.

The driver now *asks the scene* for a pixel that misses rather than assuming one
exists, and orbits until one does, recording the pitch so a run that never
reached the horizon says so. It takes the editor's **minimum** pitch (0.08 rad)
to put sky in the frame at all. With that: the ray at (896, 2) misses, and the
ring lands at (−189.29, −70.68) — the rig target to the centimetre, at ndc
(0, 0). `fixed3-D1-anchor.png`.

### The placement ghost

Warmed now, for free: the boot warm presses every rail button, and the objects
button builds the ghost. The cost of switching object TYPE — the case that
disposes the clone and builds another — was measured across six type changes and
is **0 program arrivals** every time, on both the unfixed and fixed builds
(`control1.json` / `fixed1.json` `ghostCosts`). Two of the six carried a frame
gap (760 ms on Decor, 50 ms on Rocks, unfixed) which is geometry and asset work,
not a compile. So: no material cache is needed, and there is no frame to accept
either. The ghost simply appears.

## 2. The laptop: the open is a TIMER, not work

Profiled with the CDP sampling profiler on **his own save**, resumed
(`bootPath: continue`), **inside the clubhouse** (4 legs through
`SOCKET_MainEntrance`), on a profile-cold boot: `qa/goal36/cold1.json`.

    entered → interface painted   1,406.9 ms   (second open 1,400.8 ms)
    the laptop's own JS            14.0 ms     (second open  11.3 ms)
    program / geometry / texture   +0 / +0 / +0

`enterLaptop` schedules the interface with `setTimeout(..., 1350)`. That timer
is **96%** of the open. There is no stall to find: it has been chased as shader
work twice, and the two numbers that started this — 541 ms and 5,113 ms — were
the laptop-**pages** row, not the open.

### "Laggy once open" — measured, and it is the opposite

Same boot, same sampler, same window length, both taken inside:

    shop floor, before     102.8 fps   mean  9.73 ms   p95 15.0
    laptop open            110.0 fps   mean  9.09 ms   p95 14.1
    shop floor, after       86.0 fps   mean 11.63 ms   p95 14.6

The DOM overlay costs **−0.64 ms per frame**. It does not cost frames; the
seated camera sees less of the room than the standing one does. If the laptop
feels heavy it is not the frame rate.

### The bar

`clubhouse.js` painted it as `(now - bootT0) / 850`, started 420 ms into an open
whose interface lands at 1,350 ms. So it was **full and frozen** for the last
stretch of every open — and because the build blocks the main thread, on a
slower machine it sits full for as long as the build takes, unable even to
redraw.

Measured on the unfixed build with the live-value instrument, which correctly
labelled itself `FALLBACK: bootStarted + 850 (old fixed clock)` because the
build has no live value to give: **93.5 ms and 110 ms early**
(`qa/goal36/barcontrol.json`).

Now it approaches and only **arrives** when main.js says the interface is on the
glass. Past its nominal beat it creeps rather than stopping, because a bar that
stops moving reads as finished.

### Before and after, same instrument, same profile, one boot each

`before` is HEAD, `after2` is this work; both inside, both his save, both with the
corrected "usable" mark.

| | before | after |
|---|---|---|
| entered → **usable**, 1st open | 1,375.5 ms | **916.1 / 941.7 ms** |
| entered → usable, 2nd open | 1,385.7 ms | **923.3 / 916.3 ms** |
| the laptop's own JS | 11.5 / 12.3 ms | 12.5 / 11.2 ms |
| bar full before usable | **101.3 / 105.3 ms** | **12.6 / 8.0 ms** (one frame) |
| Pro Shop page, paint to paint | 61.6 ms | **23.4 / 25.0 ms** |
| worst page of eight | 61.6 ms | **25.0 ms** |
| laptop open | 232.2 fps | 232.6 / 191.1 fps |
| shop floor, same boot | 123.8 / 129.1 fps | 117.7 / 112.2 fps |

The 8–12 ms residual on the bar is deliberate: the bar completes, one frame is
drawn showing it complete, and the glass goes live on the next. The check fails
above 40 ms.

Two honesty notes on the after2 run specifically: its `floor (before)` window is
void — it caught a 5,276 ms stall and read 5.8 fps, so the frame comparison
above uses its clean `floor (after)` window and the `after` run; and its first
open recorded +5 program arrivals where every other run recorded 0, on the same
code. Run variance with a polluted settle, not a regression, but it is in the
evidence and so it is here.

### Watched failing first

`qa/goal36/before.json`, HEAD with the final instrument:
**`FAIL: first-open: the bar was full 101.3 ms before the interface was on the
glass`** and the same for the second open. The instrument labelled itself
`FALLBACK: bootStarted + 850 (old fixed clock)` on that build, which is the
proof that the live reading it uses on the fixed build is genuinely absent there
and not being silently substituted.

### The clip

`qa/clips/goal36-laptop`, his save, default player camera, 251 frames at 4 fps.
Frames viewed, not counted:

* **frame-0201.png at 50.00 s** — lid open, boot screen, the bar just started.
* **frame-0202.png at 50.25 s** — boot screen, bar roughly **half** filled.
* **frame-0203.png at 50.50 s** — the interface, on the glass.

There is no frame anywhere in that sequence showing a full bar with no interface
behind it, which is the thing being fixed. The driver's own tracking agrees:
boot at 452 ms, bar full at 930 ms, interface shown at 939 ms.

### Three changes, and the one number that is a judgement call

1. **The interface is built during the lid swing**, hidden, instead of inside
   the reveal timer. Its cost overlaps the animation rather than being added to
   it. On this machine that is 14 ms; on a slower one it is the difference.
2. **The bar completes on readiness**, not on a clock.
3. **The reveal beat is 1,350 ms → 900 ms**, and it is now a named constant
   (`LAPTOP_REVEAL_MS` in main.js). Nothing measured ever chose 1,350: the lid's
   ease has a 154 ms time constant, so it is 99% open by ~710 ms, and the boot
   screen's remaining job is to read as a machine waking. **This is the one
   thing here that is a feel decision rather than a measurement, and it is a
   one-line revert.**

### The page switches, and the census that could not see them

Every desk, profile-cold, on his save (`cold1.json`), paint-to-paint:

    Pro Shop   116.1 ms      Home        42.7 ms     Bookings  39.3 ms
    Upgrades    36.4 ms      Course      29.0 ms     Settings  25.7 ms
    Business    23.2 ms      Mail        21.7 ms

Pro Shop is the outlier and its self-time names why: `getProgramInfoLog` 30.7 ms
and `toDataURL` 23.1 ms. Product thumbnails are rendered per sku into the
**thumbs rig's own WebGL context** and cached forever by id, so whichever desk
shows them first pays for the whole catalogue.

**That context is invisible to `renderer.info.programs`** — which is why the row
reads `+0p` while a shader link sits in its profile. "Zero program arrivals"
never certified that nothing compiled; it certified that nothing compiled *in
the main renderer*.

The boot warm was reporting `laptopThumbs: drawn:90` — **ninety FRAMES**, not
ninety thumbnails, held on the home page, which has no product cards on it. It
warmed none of them. `laptopUi.warmPages()` now paints every desk once under the
veil, the same move the editor warm makes with the tool rail, and reports what
it painted rather than how long it waited:

    __fwWarm.laptopPages = home|reservations|mail|shop|course|upgrades|finances|settings

Pro Shop went 61.6 → 23.4 ms, and the worst desk of the eight is now 25.0 ms.

### One defect this found in the fix itself

`laptopBootProgress()` reported `1` from the PREVIOUS open until `startBoot`
cleared the flag 420 ms into the next one, so the probe scored a second open as
"the bar was full 923 ms early". Real staleness, caught because the check ran
twice in one session rather than once. It reports `null` outside the boot
window now.
