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

---

## RUNNING LISTS

### UNCONFIRMED (claimed but not yet proven at the player's camera)

- _(empty)_

### NOT DONE

- _(empty)_

### VERIFIER FINDINGS STILL OPEN

- _(empty)_

### FIXED WITHOUT BEING ASKED

- _(empty)_
