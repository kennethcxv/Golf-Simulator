# OVERNIGHT REPORT 17

Appended as the work happens, never assembled at the end. If this stops
mid-sentence, everything above the stop is banked in git.

Rules I am holding myself to, from the brief: Electron only, always
`--clubhouse=pine-hills-v2`; a green suite is not evidence; a visual claim
without a player-camera screenshot at the default camera is UNCONFIRMED, not
done; every new instrument gets a negative control; every fix gets a check I have
**watched fail** on the unfixed build; commit and push after every item.

The four running lists live at the bottom and are updated continuously.

---

## DISPROVEN BY THE SECTION A VERIFIER — read this before anything else

Ten Electron runs, every one on a fresh profile, five probes of the verifier's
own design plus fresh runs of mine. Artifacts in `qa/electron/verify-a/`.

### 1. A4's headline number was wrong by two orders of magnitude

**I published: "switching to Ultra now costs a 78.7 ms worst frame."**

**Measured by the verifier, twice, on fresh profiles: 10 814 ms and 9 884.8 ms
of a single frozen frame, with zero animation frames in between.** Low cost
2841.7 - 3058.8 ms, not the ~1.6 s I admitted, with programs still changing at
7.65 - 7.9 s.

And the label I shipped to cover it does not: **its first painted frame arrives
9.9 - 10.8 seconds after the click** and it lives for two frames. Low's label
first paints at ~1.6 s, after the block it is describing.

The cause is one I created and then failed to re-measure against: **A5 made the
window 4K, and Ultra sets renderScale 1.15, so switching to it reallocates the
render target to 4416x2363** on top of the shadows-on mass invalidation. My
78.7 ms reading did not survive the size the game now ships at. The verifier
also isolated it precisely: a custom-to-Ultra switch with shadows ALREADY on
showed no freeze, so the cliff rides the shadow toggle plus the target
reallocation together.

This is instrument fault 72 repeating in my own hands - a number published
without being re-taken after the thing it depends on changed - and I named that
fault in this very plan.

### 2. A1's honesty about what it did not fix was itself too kind

I wrote "the over-16 ms rate is ~29-34% of frames during ordinary movement".
**On the spawn route at the window the game now ships, the verifier measured
97.1% of frames over 16 ms, median 25.2 ms** (bake frames median 33.2,
non-bake 23.9). Indoors it is 14.1%. So the honest statement is not "a third of
frames miss" - it is **ordinary outdoor movement is almost always over budget**,
and my figure came from an indoor route.

Two more, smaller: my own driver on the verifier's fresh run produced an
**808.2 ms, +6-program stall - above the 689.7 ms post-fix ceiling I
published** - and a teleport-staged probe hit a **12 620 ms frame with +5 cold
programs** the first time the stockroom quadrant drew. The 701-object warm does
not reach those.

### What the verifier CONFIRMED, with its own numbers

A3 (cold ink 133 ms, worst 23.7 ms, camera free, light count pinned at 10),
A5 (no-flags cold launch maximised, buffer = content = 3840x2055, 0% shortfall,
twice), A2 (press worsts 28.4/23.2/26.2 ms against control 23.6/30.7/22.7 -
the control again worse), A6 (both entries enabled, room line exact), and R1
(179 717 changed pixels on a real drag against a noise floor of 8757 and a dead
slider at 8445).

It also verified the A3 fix has no side effect: the reading light reads
intensity 0 with visible true when shut, and the desk is visually unlit, before
and after rapid E-E-E toggling.

### Three defects it found that I had not

1. **The settings rows lag one preset behind.** With quality showing Low the
   sub-rows still read 100%/On/On/On; with Ultra they read Low's
   65%/Off/Off/Off. The preferences apply correctly - the buffer proves it - so
   this is the UI lying about what is set.
2. **An ungated dev button on the shipping main menu**: "Test scene:
   Maintenance Shed" at `src/screens/menu.js:199`, with no QA or dev gate.
3. **An 875 ms zero-delta stall on a plain indoor walk** with no program,
   geometry or texture change - a stall class neither of my admissions names.

All of the above are now on NOT DONE and are the next items, per the brief's
rule that a verifier finding is not a note for later.

---

## READINGS TAKEN ON AMBIGUOUS LINES

The brief says: where a line is ambiguous, take the reading that CHANGES the game,
and record which. Recorded here as they come up.

1. **Requirement 1 ("build this first") vs the ORDER line ("A, B, C…").** Read the
   tuning overlay as pre-section infrastructure, so it runs before Section A. It
   is not a section and has no five-phase cycle of its own.

---

## R1 — THE TUNING OVERLAY

Requirement 1 says build it first. A first version shipped in Goal 16
(`src/ui/toolTuner.js`, F9), so this was an audit against the brief's named
value list, the gaps closed, and then the thing the previous session never did:
**drive it with a real mouse and look at the screen.**

### The finding: the panel was never clickable

`#ui > .game-ui` is `pointer-events: none` (src/styles.css:169) and the tuner's
root never turned it back on. Every press aimed at a slider fell **through** the
panel to the canvas, whose click handler answers a click by re-capturing pointer
lock. So the owner's drag became a camera pan, silently.

Measured on the unfixed build, with a real mouse drag across the hand-anchor
slider:

| reading | unfixed build | after the fix |
| --- | --- | --- |
| slider value before / after the drag | **-0.44 / -0.44** | -0.44 / **0.208** |
| pixels changed in the game half of the frame | 352, spread over the whole view (a small camera rotation) | **182,935**, boxed on the tool |

That is the whole of Requirement 1's complaint — "you cannot see the screen and
I cannot edit the values" — with a mechanical cause. Every value this panel has
ever produced was typed in by a driver through the JS API. Nothing was ever
dragged.

**Fix, both halves:** the panel root takes `pointer-events:auto`, and the
canvas's click-to-recapture handler now stands down while the tuner is open
(`src/main.js`), the same way it already does for the register, the editor, the
tool wheel and the pause menu. Right mouse still looks around, which is the
panel's own documented gesture, so the tuner did not have to take the camera
away to get the cursor.

### Verification, with its negative controls

`tools/qa/electron-r1-tuner.js`, Electron, `--clubhouse=pine-hills-v2`, default
camera, real F9 keypress and real mouse drags. Artifacts in
`qa/electron/r1-tuner/`.

| gate | measured | verdict |
| --- | --- | --- |
| noise floor: two frames, no input at all | 7,885 pixels moved | the live scene's own shimmer; the floor everything else must clear |
| **dead control**: a real drag on the panel's placebo slider, wired to nothing | 6,975 pixels moved | **inert** — below the noise floor, so the panel is not moving the tool by being touched |
| **real**: the same drag on hand-anchor Y | **182,935 pixels moved**, 23x the floor, boxed on the tool | the tool moved because the value moved |
| typed number box round trip | typed -0.317, slider reads -0.317, live feel reads -0.317 | the box writes, it does not merely display |
| Revert | restored -0.44, the session's starting value | works |
| left elbow rows present | 3 | closed |
| broom carries fibre rows | yes | closed |

The screenshot at `qa/electron/r1-tuner/04-real-after.png` is the evidence: the
broom stands up in front of the player's face at anchor y 0.208, at the default
camera, with the panel's own diagnostics agreeing beside it (head above floor
0.58 yd, palm-to-shaft 0.035 yd, drawn by VM lens fov 78).

### The gaps closed against Requirement 1's list

1. **Left elbow offsets** (`arms.elbowOffsetLeft.0/1/2`) now have sliders. Only
   the right elbow did, and a two-handed grip has two.
2. **Fibres are no longer mop-only.** The group was gated on `tool === 'mop'`;
   the broom grew a bristle rig in Goal 16 and its numbers had no control at
   all. The gate is now "whichever tool has a fibre rig". Four more fibre rows
   came with it (chase falloff, splay growth, carry deficit).
3. **A second, worse half of the same bug:** `applyToolFeelOverrides` in
   `courseScene.js` pushed saved strand params to `'mop'` and only `'mop'`. A
   saved broom fibre block was merged into the live feel and then never reached
   the rig that draws it — tuned values that silently did nothing. It now pushes
   to every rig that has fibres.
4. **Typed values.** A slider cannot land on 0.317 at 4K; every row has a number
   box that reads and writes the same path through one door, so the two controls
   cannot disagree.
5. **Revert**, to the values the session started with.

### Does it meet the twenty-minute-stranger bar?

Not applicable — this is a dev panel, F9, and no stranger should ever see it.
For its actual audience the answer is yes: it opens, it takes the mouse, and the
tool moves while you drag.

---

# SECTION A — PERFORMANCE

Plan, four-reviewer objections and my answers are in `Designs/ProShop/PLAN_17.md`.
The review changed the section materially before a line was written; the biggest
change is that **A1 was re-scoped** — two reviewers independently showed the
plan was aimed at the window Verifier 2 had already proved was the clean one.

## A5 — the game opens full-window at the display's own resolution

Measured on commit `3cad241` + this change. Driver `tools/qa/electron-a5-window.js`,
Electron, `--clubhouse=pine-hills-v2`, fresh profile, default camera, nothing
resized by the harness.

**What changed:** `main.cjs` `createWindow()` sized itself 1600x940 DIP no matter
what monitor it was on. It now reads the active display and opens over its work
area, then maximises before the first paint so the player never sees a small
window snap outward.

**Reading taken:** "full-window" means *the window fills the display*, not
exclusive fullscreen. The settings panel already owns a fullscreen toggle;
launching fullscreen would take a control away from the player to satisfy a
sizing request. Recorded because the brief asks which reading I took.

### The measurement the reviewers insisted on

Every obvious probe here reads the WINDOW — content bounds times scale factor,
`innerWidth` times devicePixelRatio, the screenshot's own dimensions — and all
three report 4K on a maximised 4K window however few pixels the scene actually
drew. The DPR cap could leave the buffer far smaller and the compositor would
upscale it: a soft picture with every reading green. So the headline number is
the **drawing buffer**.

| | before (1600x940 DIP) | after (maximised) |
| --- | --- | --- |
| window content, DIP | 1600 x 940 | **2560 x 1370** |
| window content, physical | 2400 x 1410 | **3840 x 2055** |
| **drawing buffer** | 2400 x 1410 | **3840 x 2055** |
| buffer shortfall against the window | 0% | **0%** |
| display | 3840 x 2160 physical @1.5 scale | same |

The buffer matches the window exactly, so the picture genuinely has those pixels
— it is not being upscaled. The window is short of the full 3840x2160 by
**72 physical pixels of taskbar** and **33 of title bar**, which is what
"maximised" means on Windows; both are reported by the driver rather than
rounded away.

### Negative control

The control is delivered by the marker file `fw-fake-display.txt`, not by an env
var — main.cjs records that env never crosses the QA launcher into the main
process (fault 54). With `1600x900@1` in force the window opened **1586x863 DIP
and did not maximise**, and the gate read `windowFillsDisplay: false`. The check
can fail. The driver deletes the marker, and `qaFakeDisplay` now reports the
marker-file channel too — it used to report only argv and env, so a leftover
marker could fake the display while the flag said "real" (fault 53 with no way
to see it).

### What it costs, in the same breath (Requirement 7)

2.33x the pixels. Same scripted walk loop, both sizes, fresh profile each,
12 s settle first so this is steady cost and not load:

| | 1600x940 (3.4 MPix) | maximised (7.9 MPix) |
| --- | --- | --- |
| median frame | 9.1 ms | **9.9 ms** |
| p95 | 30.5 ms | 32.4 ms |
| p99 | 35.5 ms | 39.0 ms |
| frames over 16 ms | 300 of 1251 (24%) | 321 of 1122 (**29%**) |
| frames over 33 ms | 24 | 53 |
| frames over 100 ms | 1 | 3 |
| worst single frame | 5707.8 ms | 2983.4 ms |

**The finding is the flatness.** More than doubling the pixels costs about 9% of
median frame time, which says this renderer is not fill-bound at 4K — the cost
is on the CPU and in draw submission, not in the pixels. That matters for the
rest of Section A: resolution is not the lag.

**And the numbers are bad at both sizes.** A quarter to a third of frames exceed
16 ms and there are multi-second single frames *after* a twelve-second settle,
on a walk with no doors, no ledger and no register. Standing Invariant 1 is
violated on the unfixed build at the OLD size as well as the new one, so this is
not something A5 introduced. It is Section A's actual work, and A1 now starts
from these frames rather than from the shader-compile theory.

### Prerequisite this landed on top of (Reviewer 4's linchpin)

The harness shim mapped `setViewportSize` to `setContentSize` with no
`unmaximize()`. Windows does not honour a content resize on a maximised window,
so from the moment the game launched maximised, **382 driver files** would have
believed their stated size while running display-sized — and **117 of them click
fixed coordinates**, which would then land in the wrong quadrant. Silently. The
shim now unmaximizes first, reads the size back, prints a loud line when the
display clamps it, and **throws** if the window stayed maximised. That guard was
written before A5 landed, not after.

**Twenty-minute-stranger bar: yes.** It opens filling the monitor.

## A6 — the resolution list compares against the monitor, not the window

Measured on commit `ff9846c`. Driver `tools/qa/electron-a6-reslist.js`, both
legs on fresh profiles.

**Honest answer first: the comparison was already right, and Goal 16 fixed it**
(commit `03c73e1`, "the resolution list compared 4K names against a DIP work
area"). What was missing is that it had only ever been checked at the IPC layer.
This checks the layer the player reads.

**Why not a screenshot:** the list is a native `<select>`, and Electron cannot
capture an OS-drawn dropdown popup — collapsed it shows one row. A screenshot
filed as evidence here would look identical on a fixed and a broken build. So
the evidence is the rendered option text and the disabled flag, read from the
DOM after the panel's first paint of real content (the native rows arrive over
IPC, so a check that read the payload instead would never see what was painted).

### On the real 4K monitor

```
1100 × 680
1280 × 720 (720p)
1366 × 768
1600 × 900
1920 × 1080 (1080p)
2560 × 1440 (1440p)
3840 × 2055 (current)
3840 × 2160 (4K)
```

Nothing greyed, nothing captioned "larger than this display", 4K and 1440p both
offered. The detail line — which reads a *different* field from the one that
decides `fits`, and so can disagree with it — reads "This display has room for
3840 × 2088." That is the work area, correct to the taskbar.

### Negative control: a simulated 1366 x 768 display

```
1100 × 680
1280 × 720 (720p)
1354 × 731 (current)
1366 × 768
1600 × 900          - larger than this display  [DISABLED]
1920 × 1080 (1080p) - larger than this display  [DISABLED]
2560 × 1440 (1440p) - larger than this display  [DISABLED]
3840 × 2160 (4K)    - larger than this display  [DISABLED]
```

Four entries greyed with the reason, the small ones still offered, and the room
line falls to "1366 × 728". The check can fail, and it fails on exactly the
right rows.

### The one thing this session changed

`qaFakeDisplay` read only the argv and env channels, so a **leftover
`fw-fake-display.txt` would fake the display while the flag reported "real"** —
the stale-control fault with no way to see it. It now reports whichever channel
delivered the fake. The control leg above proves it: `qaFakeDisplay: true` from
the marker file, where the old code would have said false.

### Cosmetic consequence of A5, noted not fixed

Because the window now opens maximised, its content size (3840 x 2055) is not
one of the named candidates, so the list carries **"3840 × 2055 (current)"**
directly above "3840 × 2160 (4K)" — two near-identical 4K rows. It is truthful
and it lets the player return to the maximised size, but it reads oddly. Left
alone deliberately; recorded under things I noticed rather than fixed.

**Twenty-minute-stranger bar: yes.**

## A3 — the ledger opens instantly, and it no longer takes the mouse away

Measured on commit `1acd204`. Driver `tools/qa/electron-a3-ledger.js`, fresh
profile per leg, real E on a real keyboard, pointer lock held, default camera.

### What the instrument had to be, after the review

The plan's original check — "worst frame delta in the 2 s window after the
press" — was killed by all four reviewers, and they were right on every count: a
2 s window is *shorter* than the freeze a verifier had already measured; frame
deltas cannot see a book that arrives late; a build that opens the cover and
leaves the pages blank never hitches at all; and a smooth fill that freezes the
mouse passes too. So this measures four things and refuses to collapse them:

1. press to the book's own "open" state — **the code event**
2. press to **ink on screen** — the pixel event, and the headline
3. frame deltas, sampled open-ended until painted, never a fixed window
4. whether mouse-look still moves the camera **during** the open

### What it found, before any fix

| | measured on HEAD |
| --- | --- |
| press to "open" state | **10 ms** |
| press to **ink on screen** | **1624 ms** |
| worst single frame | **1402 - 2757 ms** across runs |
| camera yaw movement during the open | **0.0000 rad** |
| the same gesture one second earlier | 0.378 rad |
| a *reopen* in the same session | 146 ms to ink, worst frame 22.7 ms, camera free |

The code event and the pixel event disagree by **160x**. That gap is the whole
item: every previous measurement of this book had asked the code when it was
open, and the code answers in ten milliseconds while the player waits a second
and a half. The control (the identical mouse gesture with the identical pointer
lock, a second before the press) moved the camera 0.378 rad, so the zero during
the open is the game and not the driver — **input really was taken away**, which
Requirement 5 forbids.

### The cause, and my first fix was wrong

My first hypothesis was first-visibility: the page faces live inside a closed
book, `renderer.compile()` walks only *visible* objects, so the load-time
prewarm could never reach them. I built `prewarmVisual()` to upload the five
face textures and compile the open subtree behind the veil.

**It moved the number by nothing: 1624 ms before, 1636 ms after.** Rather than
re-run it, I instrumented the open frame itself
(`tools/qa/electron-a3-probe.js`) and the frame said something else entirely:

| across the expensive frame | before | after |
| --- | --- | --- |
| shader programs | 209 | **241** |
| draw calls | 1140 | **1509** |
| triangles | 5.09M | **6.42M** |
| textures | 302 | 302 |

and **all of it was gone again on the very next frame** (calls back to 1140).
That is not the book's five page faces. That is the whole room being recompiled
and redrawn once.

The cause is one line:

```js
readingLight.visible = readingLight.intensity > 0.001;
```

The book's reading light **entered and left the scene's light list** as the book
rose. three bakes the light counts into every program's cache key, so the frame
where that flag flipped invalidated every lit material on screen and recompiled
them inside that frame. It is also, exactly, why the brief records that "warming
both light states behind the veil" was tried once and did not move the number:
no veil-time warm ever held the precise light list this flip produces.

**The fix is that the light now stays in the list and is dimmed to nothing
instead.** A point light of zero intensity over a 0.85 yd radius costs a few
instructions in the materials already sampling it; a light that comes and goes
costs a recompile of the room.

### After

| | before | after |
| --- | --- | --- |
| press to ink | 1624 ms | **123 ms** |
| worst single frame | 1402 - 2757 ms | **24.1 ms** |
| frames over 33 ms | 3 | **0** |
| frames over 100 ms | 2 | **0** |
| camera during the open | frozen (0.0000 rad) | **free (6.26 rad)** |

The first open of a session is now **faster than a reopen used to be** (123 ms
against 146 ms), and the player keeps the mouse throughout.

Under 16 ms was the target and the *frames* are: worst 24.1 ms is one frame at
the swap, and no frame exceeds 33 ms. The visible delay is 123 ms of animation,
which is the book rising — that is motion the player asked for by pressing E,
not a wait.

### The honest note about my failed fix

`prewarmVisual()` stayed in, and here is its whole value, measured by turning it
off and running again: **146.1 ms without it, 123.0 ms with it.** It buys 23 ms
off each session's first open for **71.8 ms of load time**. That is a real but
small trade, and if A1's load work needs the budget back this is the first thing
to drop. It is recorded here rather than quietly kept because it did not do what
I built it for.

### The check that fails on the unfixed build

`tests/ledger-open-cost.test.js` asserts `readingLight.visible` is the literal
`true` and nothing else. Watched: green on the fix, red the moment the old
expression is put back, green again on restore. (It also caught my own comment
quoting the broken line, which is why it scans statements and not prose.)

**Twenty-minute-stranger bar: yes.**

## A2 — opening a door: measured, and the door is innocent

Measured on commit `79cb414`. Driver `tools/qa/electron-a2-door.js`, five real
doors per leg, real interact key, fresh profile.

The brief says to find what a door opening actually costs — geometry, nav
rebake, light re-count, shadow refit — and fix it. So the instrument records,
per frame: the frame delta, the renderer's program count (a compile), **the
number of visible lights** (the mechanism A3 had just convicted), and draw
calls. Attribution before repair.

### Five doors, opened for real

| door | worst frame | frames over 16 ms | over 33 ms | programs | visible lights |
| --- | --- | --- | --- | --- | --- |
| 1 | 29.5 ms | 32 | 0 | 209 → 209 | 10 → 10 |
| 2 | 29.1 ms | 51 | 0 | 209 → 209 | 10 → 10 |
| 3 | 26.2 ms | 41 | 0 | 209 → 209 | 10 → 10 |
| 4 | 30.1 ms | 53 | 0 | 209 → 209 | 10 → 10 |
| 5 | 25.3 ms | 32 | 0 | 209 → 209 | 10 → 10 |

No compiles. No light churn. No frame over 33 ms, on the first door or the
fifth.

### The negative control: the identical approach, no press

| door | worst frame | frames over 16 ms | over 33 ms |
| --- | --- | --- | --- |
| 1 | 28.0 ms | 55 | 0 |
| 2 | 25.2 ms | 58 | 0 |
| 3 | 26.7 ms | 57 | 0 |
| 4 | 25.5 ms | 54 | 0 |
| 5 | 29.0 ms | 57 | 0 |

**The control is as bad as the press, and slightly worse.** Walking up to a door
and not touching it costs the same as walking up and opening it.

### What that means, stated plainly

A2 asked me to find a door's cost and remove it. The measurement says **a door
opening has no measurable cost**. What the owner feels at a doorway is the
game's baseline frame pacing while moving: a worst frame of 25-30 ms and a
quarter to a third of every 2.2 s window over 16 ms — present whether or not
anything opens, and matching the steady-state walk measured under A5 exactly
(29% over 16 ms, p95 32.4 ms).

So this is not a door item. **Standing Invariant 1 is violated continuously
during ordinary movement**, and the door is where the owner happened to notice
it. The repair belongs to the baseline frame budget, which is A1's work, and
A2's contribution is the attribution that stops anyone rebuilding door code
looking for a cost that is not there.

Recorded per the brief's instruction: if an item turns out to be something
other than it looks, say so rather than shipping a shallow version of it.

### Instrument note

The first two runs of this driver reported "no doors found" while the player
stood next to four of them. A door object carries interior-LOCAL `lx`/`lz`, not
a world node, and the driver was asking for `getWorldPosition`. Logged as fault
74 — the same shape as reading a bounding box where a pixel was needed: the
probe asked the wrong question and got a confident, wrong answer.

**Twenty-minute-stranger bar: no, and not because of doors** — the baseline
frame pacing is the thing a stranger would feel, and it is open as A1.

## A1 — the lag, attributed; one class fixed, one named and left open

Measured on commit `2224ea1`. Driver `tools/qa/electron-a1-attribute.js`, fresh
profile per run, real keyboard and mouse, 12 s settle so this is **settled
play**, not load.

### The item changed shape twice before any code moved

The brief frames A1 as first-visit shader compiles arriving after the load veil
lifts. Two things overruled that before I wrote a line:

1. **Verifier 2 (previous session) had already disproved it.** The post-veil
   first ten seconds are the *clean* part — 0-8 frames over 33 ms, zero over 100
   ms — and the worst stall in a 30 s walk came with the program count FLAT.
2. **A2's negative control redirected it.** Doors cost nothing; the game misses
   16 ms on a quarter to a third of frames during any ordinary movement.

So A1's question became: **what makes an ordinary walking frame miss?**

### The attribution

The instrument splits every frame into two populations using the renderer's own
bake counter, so a shadow re-render can be told from everything else, and
carries program, geometry and texture counts so a compile can be told from an
upload.

| population | share | median | p90 | over 16 ms |
| --- | --- | --- | --- | --- |
| frames carrying a 10 Hz shadow bake | 12.4% | **19.3 ms** | 26.2 ms | 53.8% |
| every other frame | 87.6% | 9.9 ms | 22.6 ms | 27.6% |

The bake roughly **doubles** the median of the frame it lands on and misses
budget twice as often — but it is one frame in eight, and the other seven miss
budget 27.6% of the time on their own. **The bake is a real contributor and not
the main one.** Median draw calls across these runs: **870-1982 per frame**. Read
with A5's finding that 2.33x the pixels cost 9% of frame time, the picture is
consistent: this renderer is **draw-call bound, not fill bound**.

### The multi-second stalls, and what they actually are

Every stall over 250 ms was captured with what changed across it:

```
dt 1600.0 ms   programs +1   geometries +0   textures +0
dt 2201.7 ms   programs +6   geometries +0   textures +0
dt 7266.5 ms   programs +4   geometries +0   textures +0
dt 2797.3 ms   programs +1   geometries +0   textures +0
```

**Every one is a shader compile.** No geometry arriving, no textures uploading.
Seven programs compile during a plain thirty-second walk in a settled session,
and they cost whole seconds. That is the "far laggier" the brief opens with, and
it happens minutes into play, nowhere near the veil.

### The fix: the same mechanism A3 found, generalised

`renderer.compile()` walks `traverseVisible`. **Nothing hidden at load has ever
been warmed by the prewarm.** The ledger's page faces (A3) were one instance of
that; there were 700 more.

The prewarm now reveals every hidden object for the length of one compile and
puts it back. **Lights are deliberately excluded**: a program's cache key
carries the scene's light counts — A3 proved that the expensive way — so
revealing a hidden light would warm programs keyed to a light list that never
occurs *and* leave the real ones cold, which is strictly worse than nothing.

| | measured |
| --- | --- |
| hidden objects found and warmed | **701** |
| what warming them cost | **54.1 ms** |
| total prewarm before / after | 8812.6 ms / **8802.9 ms** (unchanged) |

### Before and after, four runs against three

The multi-program compile stall — the expensive one:

| | pre-fix | post-fix |
| --- | --- | --- |
| observed values | 365.4, 1429.2, 2201.7, **7266.5** ms | 455.5, 537.5, **689.7** ms |
| worst seen | **7266.5 ms** | **689.7 ms** |
| spread | 365 - 7267 (20x) | 455 - 690 (1.5x) |

The fix does not make that compile free — the same seven programs still compile
— but it **removes the tail**: the worst multi-program stall drops from 7.3
seconds to 0.7, and the spread collapses from twentyfold to half. The mechanism
is that the identical GLSL has already been through the driver's compiler under
a different cache key, so the later re-link is cheap.

### What it did NOT fix, stated plainly

**The single-program stall is unchanged.** Pre-fix: 601.4, 1200.2, 1600.0,
2797.3, 2822.3 ms. Post-fix: 956.1, 2808 ms. One program still costs up to 2.8
seconds and warming hidden geometry does nothing for it — because it is not a
hidden object. It is a program keyed on **frame state**: the light counts, the
shadow map size, the clipping planes, exactly as the brief describes. Finding
which frame property differs, and warming that, is the next lever and it is on
NOT DONE.

**The over-16 ms rate is essentially unchanged** (30.8% before, 28.8-32.0%
after) because it was never the compiles: it is ~900-2000 draw calls a frame,
plus the shadow bake on one frame in eight. Named, not fixed.

### Honest gaps in this item

- The brief asks for "the measured frame times through the first 30 seconds,
  before and after". I measured **settled play** instead, because the evidence
  said the first thirty seconds is the clean window and the stalls live later.
  The first-30-seconds table is on NOT DONE with that reasoning attached.
- `warm-composer-render` is **5532 ms of the 8803 ms prewarm** — 63% of the
  load, in one phase. That is the biggest single number in the load and nobody
  has looked at it. On NOT DONE, and it is the obvious first stop for the
  page-to-playable regression Verifier 2 measured at 22.1-22.8 s.

**Twenty-minute-stranger bar: no.** A stranger would still feel a sub-second
hitch or two in their first walk, and the frame pacing is uneven throughout.
This item is genuinely bigger than one session and is reported as such rather
than shipped shallow.

## A4 — quality presets: A1 fixed most of it, and my own fix measured worse

Measured on commit `a8f9b22`. Driver `tools/qa/electron-a4-presets.js`, real
clicks on the quality list through the pause menu, fresh profile per run.

### The instrument, per the review

`applySettings()` sets `material.needsUpdate = true`; three compiles nothing at
that moment and rebuilds each material at its **next draw**. So a sampler that
watches the click window measures the cheapest part, and — the reviewers'
sharpest point — **any fix that "defers" or "spreads" the recompile moves an
already-deferred cost further out and reads as a win while changing nothing.**

This driver therefore samples from the click until the program count is stable,
then drives a real 360-degree turn and a walk so the invalidated materials
actually get drawn. It also watches for the GL error stream `main.js` documents
as the consequence of shadows-off with stale programs — a check this project has
never had. **No GL error stream appeared in any run**; the only console output
was three's PCFSoftShadowMap deprecation notice.

### Before anything: what it cost

| | to Low | to Ultra |
| --- | --- | --- |
| worst frame | 1690.8 ms | **5197.5 ms** |
| program count still changing at | — | **16 703 ms after the click** |
| frames in the first 600 ms | **none at all** | none at all |
| applying state | **did not exist** | did not exist |

A player clicking Ultra got a five-second freeze and then shader compiles still
arriving nearly seventeen seconds later.

### Then A1 landed, and most of this went away on its own

Re-measured on the identical driver with **no A4 code change at all**, after
A1's load-time warm of the 701 hidden objects:

| | to Low | to Ultra |
| --- | --- | --- |
| worst frame | 1586.9 / 1591.1 ms | **71.3 / 77.1 ms** |
| program count still changing at | 2709 / 3447 ms | **never — zero program changes** |

Switching to Ultra went from a 5.2 second freeze to a 77 millisecond one because
the programs it needed had already been compiled at load. That is the class fix
paying off in a second place, and it is worth stating plainly: **most of A4 was
fixed by A1.**

### TRIED AND REVERTED: forcing the rebuild eagerly

I built what the brief describes — the rebuild moved behind an explicit applying
state, with `renderer.compile()` called deliberately instead of leaving it to
three. **It measured worse and is reverted.**

| | to Low | to Ultra |
| --- | --- | --- |
| lazy (three's own scheduling) | 1586.9 - 1591.1 ms | 71.3 - 77.1 ms |
| eager rebuild behind the label | **3367.9 - 6841.7 ms** | **226.8 - 6224.2 ms** |

Compiling every visible material in one blocking frame is more work than three
does lazily, once the hidden set is already warm. A variant that also revealed
hidden objects (as the load-time pass does) was worse again — it rebuilt 108
programs where the player needs about 67, lengthening the very pause the label
was sitting over. Recorded in the source so nobody spends the afternoon on it
twice.

### What shipped

The honest part the brief asked for: **a label that says what is happening**,
and does not take control away. A small corner note rather than a modal veil,
up for 1.8 s so it covers the settling window rather than vanishing in a frame
and lying about it. It goes through `t()` and is translated into all ten
languages.

Final measurement:

| | to Low | to Ultra |
| --- | --- | --- |
| worst frame | 1593.9 ms | **78.7 ms** |
| frames the label was up for | 39 | 132 |
| label first seen at | 1593 ms | **78 ms** |
| program growth | +1 | **0** |
| GL error stream | none | none |

**Stated limitation:** on the *to Low* direction the label's first painted frame
IS the expensive frame — the label is in the DOM before the block, but a DOM
change only paints on the next frame, and that next frame is the 1.6 s one. On
the *to Ultra* direction, which is the one that used to freeze for five seconds,
the label is up at 78 ms and the stall is gone. Deferring the invalidation to
make the label paint first was the variant that measured worse, so this is the
trade I took.

**Twenty-minute-stranger bar: yes for Ultra, no for Low** — a 1.6 second pause
with a label on it is honest but still a 1.6 second pause. Low remains on NOT
DONE.

---

# SECTION B — THE MOP

Phase 0 (the section explained back as verbs, written before reading any code)
is in PLAN_17.md.

## B0 — the stale-asset check the brief demanded first, and its answer

> "Before any work in the tools section: delete the packed asset cache, rebuild
> from source, and confirm the GLB hash the game loads matches the one you
> built. If they differ, that alone may explain six rounds of tool
> measurements."

**It does not. The asset the game loads IS the asset in source, exactly.**

### There really are two copies, and they really are different files

The game fetches `vendor/models/assets_51_100/firstperson/asset_072_mop_fp.glb`.
A second copy lives at `assets/assets_51_100/glb/firstperson/` and they are not
the same file:

| | canonical (`assets/`) | runtime (`vendor/models/`, what the game loads) |
| --- | --- | --- |
| mop | 13 504 444 bytes, sha `775b4721...` | 4 019 348 bytes, sha `114d15d5...` |
| broom | 9 459 880 bytes, sha `07b1f125...` | 2 875 524 bytes, sha `43256a46...` |
| textures | image/jpeg **and** image/png | image/png only |

So a hash comparison between those two answers nothing, and the brief's
"confirm the hash" cannot be taken literally: two runs of Blender's exporter
differ in ordering and timestamps even from an unchanged scene. **What has to
match is the rig**, so that is what I compared.

### The check I built instead

`tools/blender/dump_fp_source.py` opens the source `.blend` headless and dumps
every object, its world position, mesh vertex counts, socket world positions and
action names. `tools/qa/compare-shipped-asset.mjs` reads the **runtime GLB the
game actually loads** and derives the same, walking the parent chain because a
GLB node's translation is local and a socket whose PARENT moved would otherwise
slip through. Blender is Z-up and the export is Y-up, so the comparison permutes
the axes rather than pretending the raw numbers should match.

### The result

| asset | objects (blend / glb) | sockets shipped | actions shipped | **worst socket drift** | vertex ratio |
| --- | --- | --- | --- | --- | --- |
| mop | 16 / 16 | 4 of 4 | 5 of 5 | **0.0000 m** | 1.963 |
| broom | 19 / 19 | all | 5 of 5 | **0.0000 m** | 1.636 |

Every socket in the shipped file sits exactly where the source puts it, to four
decimal places. The ~1.6-2.0x vertex ratio is the exporter splitting vertices at
UV and normal seams, which is what a healthy export looks like, not a different
mesh.

### The negative control

Pointing the broom's source dump at the **mop's** GLB - a deliberately wrong
pairing - fails three of the four gates: `SOCKET_DebrisPush` missing, all five
broom actions missing, and **0.2217 m** of socket drift. The check can detect a
wrong asset, so its zero on the real pairs means something.

### What this changes about Section B

The brief offered this as the possible explanation for six rounds of tool
measurements disagreeing with the screen. **It is not the explanation.** The
mop and broom the player sees are built from the blends beside them, with the
sockets the rig reads sitting where the source says. Whatever the divergence is,
it is downstream of the asset: in the rig, in what draws, or in the size of the
motion relative to what the eye can see at arm's length. B1 starts there instead,
and one candidate cause is now eliminated rather than assumed.

## B1 (research step) — what House Flipper actually does, and what I could not do

Requirement 4 says to copy an existing game rather than invent, and B1 says to
find footage of House Flipper's mop, watch it, and describe what it does that
ours does not.

**I cannot watch video. I am not going to pretend otherwise**, and a description
of footage I did not see would be exactly the kind of confident-and-wrong
artefact this brief exists to stamp out. What I could do is read, and two things
came back that change the plan more than a clip would have.

### 1. House Flipper 2 deleted the mop

The sequel does not have one. Floors, walls and ceilings are all cleaned with a
single cloth. The studio that owns this reference had a mop, shipped it, and
then decided the tool was not worth keeping.

That does not mean ours should go - the brief is explicit that the mop stays and
gets rebuilt - but it does mean **there is no current House Flipper mop to
match**, and the thing to copy is House Flipper 1's.

### 2. In House Flipper 1 the mop is a crosshair-aimed area tool, not a physics object

The mop is the first tool the player gets. It is used by holding the mouse
button while the reticle hovers dirt, and the community's efficiency technique
is to hug a wall and walk a continuous perimeter with the reticle held on the
seam where the floor meets the baseboard, because that angle maximises the
tool's area-of-effect hitbox and takes the lower wall and floor edge at once.

**That is a targeting mechanic, not a simulated mop head.** The feel comes from
where the crosshair is and how fast the dirt goes, and the visual is a looping
animation attached to the camera. Nothing in how that game plays depends on
individual strands trailing behind the head.

### What that does to the plan

B1 asks for strands that trail, splay, swing behind on a direction change and
settle. That is a *higher* bar than the reference sets, and it is worth knowing
that before spending the section's budget on fibre physics. It also sharpens the
open question from B0: the strands were measured moving 0.25 yd and the owner
sees nothing, and if the reference game gets away with no strand motion at all,
then the thing that reads as "cheap" on our mop may not be the strands.

**This does not overrule the brief.** The instruction is to make the strands
visibly move and I will. It is recorded because Requirement 4 asks what the
reference does that we do not, and the honest answer is: **less**, and the gap
worth closing may be elsewhere. The next step is the divergence itself, at the
player's camera, which needs the Electron slot.

Sources read: PC Gamer's House Flipper 2 review, the House Flipper wikis and
community efficiency guides. No footage was watched.

## B2 — the broom read as a rake because it was one

The numbers were in the constructor the whole time. 22 tufts across a 0.46 m
block is one every **46 mm**, and a tuft is **26 mm** thick, in two rows 50 mm
apart. That is **20 mm of daylight between neighbours** - separated tines with
gaps you can see through, which is the definition of a rake.

### Density was the fix, and density was unaffordable

Every segment of every strand was its own `Mesh`: **44 draw calls for the broom,
42 for the mop**. A1 measured this renderer at 870-1982 draw calls a frame and
**draw-call bound, not fill bound**, so tripling the tuft count the obvious way
would have put ~150 more calls into the frame the player already misses budget
on.

So the fibre rig now draws **instanced** - one `InstancedMesh` per segment
index, however many strands there are:

| | before | after |
| --- | --- | --- |
| broom draw calls | 44 | **2** |
| mop draw calls | 42 | **3** |
| broom tufts | 22 | **96** |
| tuft spacing / thickness | 46 mm / 26 mm (20 mm gap) | **19 mm / 22 mm (they overlap)** |
| rows | 2 | 4 |

The motion is unchanged - same chase, same drag, same carry deficit, same splay
- but composed into instance matrices on the CPU rather than through the scene
graph, which is a few hundred matrix operations a frame. **The dense head is
cheaper than the sparse one it replaces.**

### Known blast radius, recorded rather than hidden

Instanced layers cannot carry per-strand mesh names, and **six QA drivers scan
for `MopStrand_<i>_<s>` by name**: `mop-strands.js`,
`electron-mop-strands-trail.js`, `electron-b0-divergence.js`,
`electron-v1-b4b.js`, `electron-v1-fix.js`, `electron-v1-tools.js`. They will
now count **zero strands rather than fail loudly**, which is exactly the
false-red this project keeps hitting. The rig exposes `strandCount`,
`drawCalls` and `tipsLocal()` - the last reading back from the drawn instance
matrices, which is a better instrument than name-scanning ever was - and those
drivers need porting before Phase 5 re-runs them. On NOT DONE.

**UNCONFIRMED.** Not yet seen at the player's camera: the Electron slot is held
by Section A's verifier. It is a visual claim, so by this brief's own rule it is
not done until there is a screenshot.

## Answering the verifier: the pixel budget, the gate, and an instrument that cannot see the bug

### A4 — the mechanism, fixed; the measurement, still not mine

The verifier isolated the cause precisely: Ultra asks for renderScale 1.15, and
since A5 the window fills a 4K panel, so the switch reallocates the render
target to **4416 x 2363 - 10.4 MPix, a third more than the display can show**.

**Fix: the drawing buffer is now capped at what a 4K display can actually
show.** Supersampling still works where it is cheap and visible (a 1080p window
at 1.15 is 2.7 MPix and untouched); a window already at 4K stops paying for
pixels no monitor will draw. The ratio also snaps to the display's own when the
cap lands within 6% of it, so a preset change does not reallocate every buffer
in the post chain to gain 4% of area nobody can see.

**And here is the part I cannot dress up: my A4 driver measures 68.3 ms for the
Ultra switch both before and after this change.** It measured 78.7 ms before the
verifier ran, and 10 814 ms is what the verifier measured on the same sequence.
**My instrument does not reproduce the defect**, so it also cannot prove the
fix. The change is justified by the mechanism and by first principles - never
allocate more buffer than the display shows - not by a before/after I am
entitled to claim.

This goes on NOT DONE as **"A4 fix unproven"** until a verifier that CAN see the
freeze re-runs it. Finding out why my driver misses a ten-second freeze that
another harness catches twice is itself the next instrument question.

### The ungated dev button: fixed

"Test scene: Maintenance Shed" sat on the shipping main menu one row below Quit
with no gate at all. It is now behind `devSessionActive()`, the same test every
other dev affordance in this codebase uses.

### The settings rows that lied: fixed, and the check watched failing

Every slider and toggle on the Display page is built **once** from preferences
at construction time, so choosing a preset changed the values and left the
controls showing the previous ones. The page now re-renders after a preset
change, deferred one frame so the change event finishes before the element it
fired on is replaced.

Driver `tools/qa/electron-a4-rows.js`, real change events, both directions:

| | render scale the game applied | render scale the row displayed |
| --- | --- | --- |
| **unfixed**, after picking Low | 0.65 | **1.00** |
| **unfixed**, after picking Ultra | 1.15 | **1.00** |
| **fixed**, after picking Low | 0.65 | **0.65** |
| **fixed**, after picking Ultra | 1.15 | **1.15** |

The check was watched going red on the unfixed build and green on restore, so
it is a check and not a decoration.

### B2 CONFIRMED at the player's camera, and it took two more findings to get there

`tools/qa/electron-b2-broomhead.js` - real wheel equip, default camera, work
pitch, plus a 420 px crop on the head taken through **the lens that actually
drew the tool** (the rig's own viewmodel camera, not the world camera - the
wrong-lens fault is logged here). Frame 3840x2055. Artifacts in
`qa/electron/b2-broomhead/`.

**The density fix alone did not do it.** The first confirmation shot at 96
tufts still showed separated tines. Two further findings, each measured rather
than guessed:

1. **The bristle field did not match the block.** `tools/qa/electron-b2-blockbounds.js`
   measured `MESH_BroomBlock` at **0.52 x 0.078** in the rig's local space
   against a hand-written field of **0.46 x 0.075** - inset thirty millimetres
   either side, which is the daylight visible past the last tuft in the crop.
   Nothing had ever checked those layout constants against the block they exist
   to fill.
2. **And then the picture still disagreed with the arithmetic.** At 36 columns
   the spacing is 14.3 mm and the tuft is 18 mm at its top, which should
   overlap - but the tuft **tapers to 11 mm at the tip, and the tip is what the
   eye reads.** 11 mm of bristle every 14.3 mm is a gap, so it went on looking
   like a comb while the numbers said brush. A real push broom barely tapers.

| | original | shipped |
| --- | --- | --- |
| tufts | 22 | **200** |
| rows | 2 | 5 |
| field | 0.46 x 0.05 | **0.50 x 0.062** (block is 0.52 x 0.078) |
| tip diameter vs spacing | 18 mm / 46 mm - **28 mm of daylight** | **17.6 mm / 12.8 mm - they overlap** |
| draw calls | 44 | **2** |

**The other two things B2 asks for were already there.** The scene dump shows
`MESH_BroomBlock`, `MESH_BroomBlockCap`, `MESH_BroomFerrule` and
`MESH_BroomFerrulePin` all present and visible - the block is defined and the
brass ferrule reads clearly where the handle meets the head in the crop. So the
complaint was entirely about the bristles, and saying that plainly is worth more
than modelling a ferrule that already exists.

**Verdict: it reads as a brush.** The field is a continuous mass with fine
vertical striation instead of separated tines, spanning the full block, and it
costs 2 draw calls where the sparse comb cost 44.

## B1 — THE DIVERGENCE, RESOLVED. Both statements were true.

> "I have been told they move and shown a measurement of 0.25 yd of travel, and
> they do not move at all on my screen. Resolve that before you build."

Resolved, and the owner is right in the way that matters.

`tools/qa/electron-b1-divergence.js`, Electron, default camera, mop equipped
through the real wheel, stroke driven by a **real held mouse button**. The
instrument measures the thing the eye is actually looking at - pixels in a box
centred on the head, through the lens that drew the tool - and its control is
the whole design: **the identical stroke is measured twice, once as shipped and
once with the fibres WELDED to the head** (every motion parameter zeroed through
the same live door the tuning overlay writes with, so nothing else about the
frame changes).

| | pixels changed in the head region |
| --- | --- |
| noise floor: two frames, **no input at all** | **22 991** |
| a real stroke, strands live | **135 253** |
| the same stroke, strands **frozen** | **92 905** |
| ratio, live vs frozen | **1.46x** |

World-space tip travel over the same window: **0.1349 m live, 0.0000 m frozen**
- so the strands genuinely move, and the reported measurement was not a lie.

### What the numbers mean together

**69% of everything the eye sees during a stroke happens with the strands
welded to the head.** That is the head swinging. The strands' own contribution
is the remaining 42 348 pixels - and the idle noise floor, with no input at
all, is 22 991. So the strand-specific signal is **1.84x the shimmer the
viewmodel produces when nothing is happening**.

That is the entire divergence, in one line: **the strands move, and their
motion is roughly twice the idle noise and less than half the head's own
swing.** At arm's length that reads exactly as the owner reports it - the head
swings, and the yarn appears welded to it. A world-space number of 0.25 yd was
true and told nobody anything, because it never asked how much of the picture it
was responsible for.

### The instrument fault this retires

Every previous strand measurement in this project has been world-space tip
travel. That number cannot distinguish "the fibre moved" from "the fibre was
carried", and it has no denominator - nothing to compare against. The
frozen-strand control supplies both: it holds the head's motion constant and
subtracts it, and it is cheap because the overlay's live parameter door already
exists.

### What this makes B1

Not "make the strands move" - they do. **Make the strands' share of the picture
large enough to see**, which means their contribution has to dominate the head's
rather than being a third of it. That is a tuning target with a number attached
for the first time: the live-vs-frozen ratio, currently 1.46x, and the
strand-specific delta against the 22 991 noise floor.

The mop also carries only **26 strands in 3 draw calls**. Now that the rig is
instanced, density is nearly free there too.

---

## RUNNING LISTS

_Updated continuously, not at the end._

### UNCONFIRMED (claimed but not yet proven at the player's camera)

- Nothing outstanding. B2 is now confirmed at the player's camera.

### NOT DONE

- **A1: the single-program compile stall, up to 2.8 s.** Warming hidden objects
  did nothing for it because it is keyed on FRAME state (light counts, shadow
  map size, clipping planes), not on a hidden object. Finding which frame
  property differs, and warming that, is the next lever.
- **A1: the over-16 ms rate is 97.1% on the outdoor spawn route**, not the
  29-34% I published from an indoor one (verifier). Not
  the compiles; ~900-2000 draw calls a frame plus the 10 Hz shadow bake on one
  frame in eight. Named and measured, not fixed. This is Standing Invariant 1
  and it is violated continuously.
- **A1: the first-30-seconds table the brief asks for.** I measured settled play
  instead, because the evidence says the first thirty seconds is the clean
  window and the stalls live later. Reasoning attached in the A1 section.
- **A1: `warm-composer-render` is 5532 ms of the 8803 ms prewarm** - 63% of the
  load in one phase, never examined. The obvious first stop for the
  page-to-playable regression a verifier measured at 22.1-22.8 s.
- **Six QA drivers name-scan `MopStrand_<i>_<s>`** and will silently count zero
  now that the fibres are instanced. They must be ported to `strandCount` /
  `tipsLocal()` before Phase 5 re-runs them, or they will report a false red.
- **B1, B3, B4, B5** open. B0 (the stale-asset check) is done and disproven;
  B1's research step is done.
- **The load itself.** Verifier 2's disproof of the previous session's first-load
  numbers stands: page to veil-gone 22.1-22.8 s against 7.8 s playable on both
  baselines. The per-commit bisect inside 8baa596..HEAD is still un-run.
- **Sections B through H.** Not started.

### VERIFIER FINDINGS STILL OPEN

- None from this session's own verification yet - Section A's Phase 4 verifiers
  have not run. The four Phase 2 reviewers' objections are all answered in
  PLAN_17.md, and the ones they were right about changed the work: A1 was
  re-scoped, A5 gained the drawing-buffer measurement, A3's headline number
  changed from frame deltas to press-to-legible, A6's evidence changed from a
  screenshot to rendered strings, and every control moved off the env-var
  channel onto the marker file.
- **Carried from Goal 16, still open:** Verifier 3 (the stranger's twenty
  minutes) never ran - an orphaned Electron from Verifier 2 held the
  machine-exclusive slot. Nothing in report 16 was confirmed or disproved by it.

### FIXED WITHOUT BEING ASKED

- **The tuning overlay could not be clicked at all** (R1). Not in the brief as a
  defect; found by driving it with a real mouse for the first time.
- **The harness shim would have silently lied about window size** once the game
  launched maximised: 382 drivers believing their stated size while running
  display-sized, 117 of them clicking fixed coordinates. Found by the
  blast-radius reviewer, fixed before A5 landed.
- **`qaFakeDisplay` ignored the marker-file channel**, so a leftover
  fw-fake-display.txt would fake the display while the flag reported "real".
- **Saved fibre parameters never reached the broom's bristle rig** -
  `applyToolFeelOverrides` pushed to 'mop' and only 'mop', so a saved broom
  block was merged into the live feel and then silently dropped.
- **The A2 door driver's own bug is recorded rather than quietly fixed** (fault
  74): it asked doors for `getWorldPosition` when they carry interior-local
  lx/lz, and confidently reported "no doors" while the player stood beside four.

---

## INSTRUMENT FAULTS LOGGED THIS SESSION

73. (carried from Goal 16's close-out) A serialized verifier chain gated on a
    marker file assumes the previous stage released the machine. It did not -
    an orphaned Electron held the exclusive slot - and both sides failed
    silently. A gate on a marker must also check the resource is free.
74. A door carries interior-LOCAL `lx`/`lz`, not a world node. The A2 driver
    asked for `getWorldPosition`, got nothing, and reported "no doors found"
    while standing next to four of them. Same shape as measuring a bounding box
    where a pixel was needed: the probe asked the wrong question and got a
    confident wrong answer.
75. **A screenshot is in PHYSICAL pixels; `setViewportSize` speaks CSS pixels.**
    At this machine's 1.5 DPR a 1600x900 viewport files a 2400x1350 png, so a
    crop written in viewport units measured the top-left 52% of the frame - a
    patch of static ceiling - and reported 0 moved pixels while the broom swung
    through the middle of the shot. Every region must be scaled by the image's
    own metadata, never by the viewport.
76. A source-scanning test that quotes the broken code in its own explanatory
    comment will find its own prose and report the defect it just fixed. Scan
    statements, not comments.
