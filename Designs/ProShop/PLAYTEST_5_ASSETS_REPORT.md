# PLAYTEST 5, ITEM 6 — THE ASSETS

Branch `playtest5/assets`. Owned files only: `tools/qa/**`, `golf-assets`, the
Blender script directory, `src/render3d/toolViewmodel.js` and the three tools'
viewmodel modules. Nothing in `clubhouse.js`, `audio.js`, `main.js` or the course
editor has been edited.

---

## 0. FIRST: the tool that appears in zero frames — SOLVED

**It was never framing, and it was never the tutorial.** The game takes the tool
out of your hands roughly fifteen seconds after boot, and the probe keeps
reporting the tool it asked for.

### What was actually happening

`scheduleDeferredGpuWarm` in `src/main.js` (line ~1737) runs on a timer after
boot:

```js
const held = typeof walk.tool === 'function' ? walk.tool() : null;
if (!held) {
  walk.setTool('dustpan');
  await frame(); await frame(); await frame();
  walk.setTool(null);
}
```

The accessor on that object is **`walk.getTool`**, not `walk.tool`. So
`typeof walk.tool === 'function'` is always false, `held` is always `null`, the
branch **always runs**, and whatever the player is holding is swapped for the
dustpan for three frames and then for nothing at all.

Caught live, with the driver touching nothing (`electron-tool-goes-dark.js`):

| sample | t | tool | `Tool_mop` visible | drawable meshes |
|---|---|---|---|---|
| 0 | 13.5 s | `mop` | true | 25 / 92 |
| 6 | 28.8 s | `mop` | true | **83 / 92** |
| 7 | 29.2 s | **`dustpan`** | **false** | **0 / 26** |

Sample 6 → 7 is 428 ms apart and nothing in the driver ran between them.

**This is player-facing, not just a QA nuisance:** equip a tool inside the warm-up
window and it is silently taken away. The fix is one line — ask `walk.getTool`.
`main.js` belongs to the other session right now, so I have not touched it; it
should go to whoever owns that file.

There is a second, independent effect underneath it: **the tool streams in.** The
mop goes 25 → 83 drawable meshes over ~15 s as the authored model loads and the
procedural fallback is retired. A fixed sleep photographs whatever fraction
happened to be ready.

### Two instruments failed before the right one

| instrument | said | why it was wrong |
|---|---|---|
| scene-graph check | "visible, present, 92 meshes, 0.67 yd from camera" | presence is not drawing |
| projection check (box corners in frustum) | "in frame at every pitch from +0.2 to −1.3" | **its own control said the same with no tool equipped** — the retired group is still in the scene with a box to project. A metric whose control cannot fail measures nothing. Probe lie 38. |
| **pixel count** (paint flat magenta, kill ACES + composer, count with sharp) | see below | control counts **0** at every pitch |

### The measurement, with the tool actually held

Magenta pixels of mop on a 1600×900 frame, control in the same run:

| pitch | +0.05 | −0.15 | −0.3 | −0.45 | −0.62 | −0.8 | −1.0 | −1.1 |
|---|---|---|---|---|---|---|---|---|
| mop | 29,531 | **62,824** | 53,532 | 58,553 | 62,710 | 58,740 | 64,155 | 67,085 |
| no tool | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

The tool is drawn at **every** pitch. The earlier "invisible below −0.15" curve was
entirely the stolen tool — 25 drawable meshes at the first sample and zero at all
seven after it.

### The recipe, now reusable

`tools/qa/lib/tool-photo.mjs`:

- `setToolPose` — the golden suite's tool pose, from the **live** interior origin,
  default pitch **−0.15** (default FOV, a natural downward glance; the head falls
  below the bottom edge at +0.05).
- `equipAndSettle` — waits out the debounced `setTool`, waits for the drawable
  count to **plateau** rather than sleeping a fixed time, and **re-equips if the
  warm-up steals the tool mid-wait**.
- `photographTool` — re-asserts immediately before the shutter and returns the
  drawable count the frame was taken at, so a report states a number instead of
  trusting a picture.

Proved on three tools plus a control, deliberately started **inside** the warm-up
window (`electron-tool-photo-proof.js`):

| | mop | broom | vacuum | no tool |
|---|---|---|---|---|
| drawable at shot | **83 / 92** | **80 / 89** | **52 / 89** | **0** |
| right tool held at shot | yes | yes | yes | — |

Frames: `qa/electron/tool-photo/held-{mop,broom,vacuum,none}.png`. Viewed — the mop
frame shows the red hub, the white ring and the strands hanging below, with both
hands on the shaft. Judgeable.

**I can now photograph any held tool on demand, which is the precondition for
judging a new asset.** Modelling starts next.

---

## 1. The hands — MODELLED, NOT SHIPPED. The wiring is reverted.

**The model exists and validates. It is not in the game, because the two frames I
took of it were worse than what is there now, and I am not shipping that.**

### What was built

`tools/blender/hands/build_fp_hands.py`, Blender 5.1.2 headless, **16 parts,
3,416 triangles, 54 KB**, `tools/validate-gltf.mjs`: 0 failed, 0 warnings.

It exports **one mesh per joint segment**, not "a hand". The hand is articulated —
`pose()` writes joint rotations on every tool change and five poses depend on it —
so a single posed mesh would be rigid in the hand's one job. Each part is authored
with its origin at its own joint pivot, so the runtime drops it into the joint
hierarchy that already exists and the pose maths is untouched.

Four things separate a modelled finger from a capsule, taken from the reference
photograph, each a parameter rather than a modelling gesture:

| | capsule | authored |
|---|---|---|
| section | circular | **elliptical**, ~1.25:1 wide to deep |
| along its length | uniform | **tapered** toward the tip |
| at the joint | nothing | **knuckle bulge**, a raised cosine over the first third |
| palm | a scaled sphere | **thenar mass** on the thumb side, cupped face, domed back |

Draw-call budget: unchanged. One mesh per joint as before, and the four per-hand
nail boxes are folded into the distal segment's own modelled tip — 8 fewer meshes
across two hands.

### Why it is not wired in

**The Blender → glTF axis conversion.** The parts are authored running down −Z
because that is the axis `fpHands` lays fingers along, but `export_yup=True` maps
Blender (x, y, z) → glTF (x, z, −y), so an authored −Z arrives in the runtime as
+Y. Photographed: **every finger pointing away from the shaft as a straight rod**,
plainly worse than the capsules.

I then rotated the parts +90° about X and applied it before export, expecting the
yup conversion to send them back to −Z. Measured, that was worse again: drawable
meshes at the shot fell **72 → 22**. I had the mapping backwards a second time.

So the wiring is **reverted by file copy** and the revert asserted to have changed
the file (`f2e52d50…` → `e5bedfd4…`), with the hands measured back at **80/89
drawable** — exactly the procedural build that shipped.

### What the next attempt needs

Not more modelling. One decided fact: what axis a part must be authored along in
Blender so that, after `export_yup=True`, it arrives in three.js running down −Z.
Establish it with a single one-part probe — export a marker whose long axis is
unambiguous, read the vertex bounds in the runtime, and fix the convention — then
the 16 parts drop in unchanged. Guessing it twice has already cost this attempt.

**The model is good; the seam between two coordinate conventions is what beat me,
and I would rather hand you a working hand than a fast one.**
## 2. The mop head — NOT STARTED
## 3. The broom head — NOT STARTED
