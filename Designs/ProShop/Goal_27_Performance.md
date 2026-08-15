# GOAL 27 — PERFORMANCE, END TO END

One subject this session: **the game must never hitch.** Not on load, not on a
first press, not walking the course, not on a five-year-old machine.

Everything below is an instruction. Work it in phase order. Phases are gates.

---

## THE ONE RULE THAT OVERRIDES "REFACTOR ANYTHING"

I have said you may restructure whatever you need to. I mean it — **and** the
last time a brief said that, an agent spent 22 hours building a 3,041-line
write-ahead log nobody asked for.

So the permission comes with a condition:

> **Every change must be justified by a number you measured before you made it.**

Refactor a subsystem if the profile says that subsystem is the cost. Do not
refactor one because it looks untidy. If a change cannot be tied to a measured
frame, a draw call, a compile, or a load second, it is not this session's work.

---

## PHASE 0 — START FROM A TREE THAT HAS THE FIXES

Two parallel sessions left work on `playtest5/bugs` and `playtest5/assets`, and
`goal25/phase0-inherited-tree` was reset back to `d7716d4`. **I may have been
playing a build with none of it.**

- Merge both branches into one working branch and say what you merged.
- Run the suite and the gate; name every red.
- **Then re-check the two load-in faults below against the merged tree**, because
  one of them was reported fixed and I am still seeing it. If it is genuinely
  fixed, say so and move on. If it is not, that is Phase 1.

---

## PHASE 1 — LOADING IN

### 1.1 I load in holding a tool I never picked up

I start every game with the cleaning tool in my hand. See the attached frame.

A previous session root-caused this: `scheduleDeferredGpuWarm` in `main.js` asks
`typeof walk.tool === 'function'` when the accessor is `walk.getTool`, so its
"leave the player's hands alone" guard has **never once** skipped — and its
restore goes through a 120 ms debounce whose queue only drains while you are
walking. Press Tab and the tool stays in your hands for the session.

Verify that against the merged tree. If it is fixed, prove it. If not, fix it.

### 1.2 The background is the Tab view while I load in

Behind the loading text I can see the overview map, not the clubhouse. Measured
previously: the camera sits at **camY 147.9 for the whole prewarm** while it
warms the overview and editor programs, and only comes home on the next
production frame — while the veil starts a 420 ms fade immediately. One boot had
the frame winning by 287 ms.

The veil must never lift on a frame the walk camera does not own.

### 1.3 Loading takes far too long

Measure it properly and break it down: process start → menu interactive → click →
first controllable frame. Name where the seconds go — asset decode, shader
compile, navmesh bake, scene construction, texture upload — and attack the
largest.

**Report a before and after in seconds.**

---

## PHASE 2 — FIRST-PRESS STALLS, AS ONE PROBLEM

Every new thing I do lags the first time and is fine afterwards. Turning a page
in the book. Pressing Tab. Opening the course editor. Equipping a tool. Pressing
the cashier button. Checking someone in.

**Stop fixing these one surface at a time.** Six rounds have done that and a new
surface appears each playtest. Find the general mechanism and cover every surface
at once.

What is already known and should not be re-derived:

- The deferred warm **is** running: +76 programs measured.
- The **phone and the ledger compile ZERO programs** on first press. Their
  first-press cost is not shader compilation. Something else — first layout,
  first paint, first texture upload, lazy DOM construction — and it needs naming.
- The **overview costs 433 ms and compiles on its first round trip.** It is the
  one camera prewarm never warms: `fitSunShadow`'s third mode is `'full'` at
  **4096**, chosen only when `walk.active` is false and `editorShadowFocus` is
  false — which is Tab, and nothing warms it.
- `renderer.compileAsync` cannot help with a render target that has not been
  allocated yet.

**Verify by the program counter and by frame gaps read from the rAF stream, not
by `PerformanceObserver('longtask')`** — a hitch I feel can be well under 50 ms.
Milliseconds alone are noise; the same build has produced 33 ms and 464 ms for
one gesture.

**Acceptance:** after warm-up, no first press of anything in the game produces a
frame over 33 ms. Enumerate the surfaces you covered and prove each.

---

## PHASE 3 — DRAW CALLS AND THE MESH MERGE

Named in Goal 23, Goal 24, Goal 25 and Goal 26. **Never started.** Measured and
found viable last session:

| | measured |
|---|---|
| standing draw calls | 1446 |
| peak | 4404 |
| mergeable meshes | 1037 over 349 materials (2.97 each) |
| available reduction | −47.6% against a 30% target — 17 points of headroom |
| material dedup | **not required** to hit the target; adds ~7 points more |

Do it. Classify meshes — static visual, interactive, animated, skinned,
collision-only, visibility-switched — merge compatible static visual geometry per
material and render state, instance where repeated transforms suit it better.

Preserve world transforms, normals, UVs, lighting and shadow behaviour, material
identity, culling and appearance. Do not destroy hit targets. Do not merge across
visibility zones if it makes the doorway render more. Do not produce one enormous
mesh that ruins culling.

**Report before and after: meshes, materials, draw calls, triangles, load time,
doorway frame time.**

---

## PHASE 4 — THE OUTDOOR COLLAPSE

Measured on a build from an earlier session: **6.7 fps walking away from the
clubhouse.** 148 ms median frames, one at 559 ms, 2745 draw calls, 8.6M
triangles. That is course vegetation and it is the single largest performance
problem in the game.

Nobody has ever been asked to look at it. Look at it.

Instancing, LOD, impostors at distance, frustum and distance culling — whatever
the profile points at. Measure standing, walking, and a 60-second loop of the
course.

---

## PHASE 5 — THE LOW-END TARGET

I want this to run well on machines far weaker than mine.

Define the target yourself and say what you chose: a resolution, a GPU class, a
frame budget. Something like 1080p on integrated graphics or a five-year-old
discrete card, holding 60 fps with no frame over 33 ms.

Then find how to test against it on this machine — a resolution scale, a forced
software or throttled GPU path, a CPU throttle in the Chromium protocol — and
measure the whole game against it: load, door, register, ledger, tool cycle, Tab,
course editor, an outdoor walk.

**Report the numbers per scenario, and say plainly which ones fail.**

---

## PHASE 6 — RESOLUTION FOLLOWS THE MONITOR

Drag the window from my 4K panel to my 1440p panel and the render resolution
should follow. Same for fullscreen and for changing displays.

Known trap: **a maximised window on Windows silently ignores `setContentSize`.**
An earlier session found that and it is why resolution has never been testable
from the QA side.

---

## EVIDENCE

Same standard as every previous goal. Reproduce through the real Electron path.
Capture the failing baseline **before** you touch the fix area. Build a check
that can perceive the thing. File-copy revert, **assert the file changed**, watch
the check fail, restore, watch it pass.

**And the rule that cost a whole session last week:** never suppress a command's
output and then read a file it was supposed to write. Four conclusions came from
a nineteen-minute-old JSON after a driver had crashed silently. Check the exit
code. Read the output.

**Sample rate is a control.** An instrument reported a three-frame event as
absent because it sampled on a 50 ms timer. Match the rate to the thing.

## ADVERSARIAL REVIEW, PER PHASE

A verifier that has read none of your code drives the phase's scenarios with real
input and a frame-time overlay, records the video, and **watches it**. Any
recurring frame over 33 ms is a finding and a finding is the next item.

## REPORTING

`Designs/ProShop/GOAL_27_PERFORMANCE_REPORT.md`. At the top: probe-lie count, a
before/after table for every measured scenario, and the phase gate status.

5 commits or 45 minutes per item, then NOT DONE and move on. Push after every
item. Work continuously; stop cleanly when you cannot continue.