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

## RUNNING LISTS

### UNCONFIRMED (claimed but not yet proven at the player's camera)

- _(empty)_

### NOT DONE

- _(empty)_

### VERIFIER FINDINGS STILL OPEN

- _(empty)_

### FIXED WITHOUT BEING ASKED

- _(empty)_
