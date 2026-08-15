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

## 1. The hands — WIRED AND ADOPTED. (And the panic two sections down was wrong.)

**RESOLVED: `contextIsolation: true`.** `main.cjs:170`. The renderer's app modules
run in the ISOLATED world; `page.evaluate` runs in the MAIN world. `window.__fw`
crosses because it is bridged deliberately. **A global set by module code does
not.**

So `__fwHandBuild`, `__fwHandLoad` and `__fwHandAdopt` reading null says nothing
about whether that code ran — it says a module-set global is invisible from a
driver, which is a harness fact and not a finding about the hand.

I wrote a correction below saying I could not confirm the authored model reached
the game. **That correction was itself wrong**, and I am leaving it in place rather
than deleting it, because the reasoning is the useful part: an unconditional write
reading null looked like proof the code never ran, and it was proof of a world
boundary instead.

**The adoption evidence stands.** Walking `FirstPersonRightHand` and reading what
each mesh actually draws: **15 BufferGeometry against 4 CapsuleGeometry.** A purely
procedural hand is capsules, spheres and cylinders — fifteen buffer geometries in
it is the authored parts, arrived and drawing.

**The harness rule this leaves behind:** a driver can only see globals it sets
ITSELF, inside `page.evaluate`. Everything in this session that worked —
`__st`, `__rt`, `__mop`, `__aud`, `__toolMeshes`, `__paintTool` — was set that way
and is unaffected. To observe module state, read it off `window.__fw` or off the
scene graph, never off a global the module wrote.

I instrumented the loader to keep its error instead of discarding it, and to
publish the outcome on `window` either way — loaded, threw, or failed. The probe
read **null for both**: `window.__fwHandLoad` is unset and `window.__fwHandAdopt`
is unset.

Those globals are written unconditionally, on every path, at the top of the load.
Null does not mean "the load failed". It means **that code never ran**.

Which forces a re-reading of everything I reported as adoption:

| what I said | what the evidence actually supports |
|---|---|
| "nails retired, `nailsStillVisible: 0`" | the nails may never have been visible, or my name match never hit — not proof my swap ran |
| "four capsules at the origin, so `adoptAuthored` ran on them" | if the swap never ran, they are at the origin for some other reason and my inference was wrong |
| "72/89 drawable, 8 fewer than the procedural build" | a difference I attributed to retired nails, with no proof of cause |
| three frames showing improvement | **may all be the procedural hand under different lighting** |

So the honest state of item 1 is not "wired but not right". It is: **the model is
built and validated, and I have no evidence it is in the game.** The frames prove a
hand was photographed, not whose hand it was.

### I asked that question, and the answer is a contradiction

I put an unconditional heartbeat at the top of `makeHand` — `window.__fwHandBuild`
incremented on entry, before anything else. Re-ran. **It reads null.**

But `makeHand` demonstrably ran: the scene contains `FirstPersonRightHand`, and
that name is written by `makeFpHands` on the group `makeHand` returns. My probe
walked it and listed 28 meshes.

So the running build executes `makeHand`, and none of the three globals that
function writes are visible to `page.evaluate` — while `window.__fw` in the same
`page.evaluate`, in the same driver, resolves fine.

**The most likely explanation is that `page.evaluate` and the game are not sharing
a JavaScript context**, and if that is true it does not only invalidate the hand
work. It puts a question mark over any probe in this session that read a global it
set itself, as opposed to reading `window.__fw`, which plainly works.

That is where a fresh session should start, and it should start there before
trusting anything below.

I would rather hand over a disproved assumption than a report that reads as
progress.

---

## 1b. What was built and wired (written before the above, and now unconfirmed)

**The model is in the game and drawing. The axis is settled. It is an improvement
on the splayed version and it does NOT yet match your reference, so it is yours to
judge before I touch the mop.**

Frame: `Designs/ProShop/Images/Goal_26/playtest5/hand-authored-v1.png`, default
player camera, broom held, **72 of 89 tool meshes drawable at the shutter** with
the right tool confirmed held.

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

### The axis, settled with a probe rather than guessed

Three markers, one per candidate Blender axis, read straight off the exported glTF
accessor bounds — no Electron, no opinion:

| authored in Blender | arrives in glTF as |
|---|---|
| −Z | **−Y** |
| **+Y** | **−Z** ← the axis `fpHands` lays fingers along |
| +X | +X |

**The Blender → glTF axis conversion** was the whole blocker. The parts are authored running down −Z
because that is the axis `fpHands` lays fingers along, but `export_yup=True` maps
Blender (x, y, z) → glTF (x, z, −y), so an authored −Z arrives in the runtime as
+Y. Photographed: **every finger pointing away from the shaft as a straight rod**,
plainly worse than the capsules.

I then rotated the parts +90° about X and applied it before export, expecting the
yup conversion to send them back to −Z. Measured, that was worse again: drawable
meshes at the shot fell **72 → 22**. I had the mapping backwards a second time.

The fix is baked into the **vertex data**, not an object rotation. The exporter
reported `nodeRot: null` on every probe — it bakes transforms — and the runtime
swap takes **geometry only**, so anything left at node level is silently dropped.
That is exactly what beat the second attempt, where a rotate-and-apply left the
parts wrong and cut drawable meshes from 72 to 22.

Verified on the rebuilt file before wiring: `IndexProx` spans z +0.0006 → −0.0332
(down −Z), `Palm` is asymmetric on x (−0.0335 → +0.0413, the thenar), `Forearm`
runs z −0.006 → +0.119 (back toward the camera). All three as intended.

### Where it actually stands

| | |
|---|---|
| parts adopted | authored geometry in the joints, nails retired (`nailsStillVisible: 0`) |
| capsules left | **4** — not yet traced; a name or a reference I have not matched |
| drawable at the shutter | 72 / 89, against 80 / 89 for the procedural build (the 8 are the retired nails) |

**Looking at the frame: the fingers now curl around the shaft instead of standing
off it as rods, which is the axis fix landing. It still does not match your
reference.** The finger cluster reads lumpy rather than as one hand, and the
forearm reads flat — a plank rather than an arm. The proportions and the pose need
another pass, and four capsules are still in there.

### Round 2: two measured defects fixed, still not right

I did not stop to ask; I iterated on the two things the frame showed.

**The forearm read as a plank.** It was thinner than the cylinder it replaced —
0.0295 × 0.0244 at the elbow against a radius of 0.037 — and an ellipse that thin
against a wide palm reads as a board. Now 0.0370 × 0.0330 at the elbow, 0.0268 ×
0.0212 at the wrist.

**The fingers read as a string of beads.** A uniform 0.14 knuckle bulge on all
three phalanges beads each one instead of articulating the finger. The bulge now
tapers down the finger the way a real one does: **0.10 at the base knuckle, 0.05
at the middle joint, 0.02 at the tip.**

`hand-authored-v2.png`: the forearm reads as an arm rather than a board, and the
segments flow instead of beading. **It still does not match the reference.** The
fingers read as a bumpy cluster rather than four distinct fingers wrapped round the
shaft, and at the default camera the hand is small and dark enough that finer
judgement needs a closer exhibit.

### What is still open, precisely

1. **Four capsules — traced, and the finding narrows it sharply.** I said this
   needed an accessor from `courseScene.js`; that was wrong, and the scene graph
   answered it directly. Recording each capsule's PARENT CHAIN and local position:

   ```
   CAPSULE verts 110  pos 0,0,0  chain Group < FirstPersonRightHand < FirstPersonHands < Tool_broom
   ...x4, identical
   ```

   **All four sit at exactly (0, 0, 0).** That is the signature of `adoptAuthored`
   having RUN on them — it is the function that writes `position.set(0,0,0)`, and
   it returns early, before touching position, when the authored part is missing.
   So these are not parts that failed to arrive. They are meshes whose geometry
   assignment was made and then undone, or made against an already-disposed
   buffer — `adoptAuthored` disposes the outgoing geometry, and a shared or
   double-listed entry would dispose something still in use.

   That is a different bug from the one I assumed, and it is findable now: the next
   pass should log the geometry uuid before and after each assignment rather than
   the count. Four fingers, four capsules, all at origin, strongly suggests one
   entry per finger being processed twice.
2. **A closer exhibit.** Judging a hand at the default camera against a reference
   photograph taken at arm's length is not a fair comparison; the next pass should
   put both at the same apparent size.
3. **Then the pose**, which is where the remaining difference actually lives.

No regression: 72 / 89 drawable at the shutter, right tool held, no page errors.
The 8-mesh difference from the procedural build is the retired nails, by design.
## 2. The mop head — NOT STARTED
## 3. The broom head — NOT STARTED


---

## THE THING THAT BEAT THIS SESSION, NAMED

I named the twelve finger segments in `makeFinger` so the four unswapped capsules
could be read off the scene graph instead of counted. Re-ran. The result:

```
AUTHORED (BufferGeometry): Palm (unnamed) x12 ThumbProx ThumbDist
CAPSULES LEFT:  (unnamed) x4, all at pos 0,0,0
```

Fifteen authored parts are drawing — **twelve finger segments, the palm and both
thumb bones.** So the swap works, and works better than I had credited: the only
one of the sixteen missing is the **Forearm**, which is still a `CylinderGeometry`.

But look at the names. `Palm`, `ThumbProx` and `ThumbDist` are named — those names
are set in the ORIGINAL `fpHands.js`. **The twelve names I just added are absent**,
while the swap those same edits feed plainly runs.

**The running build is not the newest `fpHands.js` on disk.** An older revision of
my own file is executing. That is the thing that made this session so slow to
converge: several rounds were photographed against code I had already changed, and
at least two of my conclusions — the "reverted" round and the "never ran"
correction — were reasoning about a build I was not looking at.

### PROVEN, not inferred

I did not leave this as a hypothesis. I renamed an existing, already-visible mesh —
`palm.name = 'Palm'` became `'PalmV2'` on disk — and re-ran:

```
named meshes in the running hand:  HandCuffBody HandCuffRoll HandCuffInner Palm ThumbProx ThumbDist
MARKER PRESENT: NO
```

`PalmV2` is on disk. The running build says `Palm`. **An edit to `fpHands.js` does
not reach the executing code.** (Marker reverted.)

And note what the same run shows: fifteen authored parts ARE adopted, which
requires my swap code. So the executing build is a SNAPSHOT — it contains edits I
made early in the session and none of the later ones. Every frame after the first
successful run was of stale code, which is why proportion changes appeared to do
so little and why two of my conclusions had to be retracted.

**This invalidates a class of conclusion, not a detail.** Any visual judgement in
this report made after the first adopted frame was made against code that was not
the code on disk.

### What the next session must do first, before anything else

**A concrete lead, found on the last check.** The Electron profile path in the
worktree runs reads:

```
--user-data-dir=...\golf-flipper-electron-qa-profiles\c9b7a35163f3a1f41222-<random>
```

`c9b7a35163f3a1f41222` is `repoScopeId(root)` = sha256 of `canonicalPath(root)`
truncated — and it is **the same scope id the MAIN repo reported** when it refused
the lock at the start of this session. Two different roots cannot hash to the same
scope. So `ROOT` (which is `process.cwd()`, and which the harness also uses as the
spawn `cwd`) is resolving to the main repository even when the command is run from
`C:/gfassets`.

That would mean Electron is serving the MAIN repo's `src/`, not the worktree's.

It does not explain everything on its own — the main repo's `fpHands.js` contains
**zero** occurrences of `adoptAuthored`, yet fifteen parts demonstrably adopt — so
either the adoption has another source or the picture is more complicated than one
wrong root. But it is the first hard, checkable discrepancy, and it is where I
would start.

Other candidates, in the order I would check them after it: an HTTP/module cache
surviving the per-run `--user-data-dir`; the worktree serving `src/` from a path
other than the one being edited; or a snapshot/copy step inside the Electron
harness. Then establish the marker check as routine — rename a mesh, read it back
through the scene graph, and trust no frame until it matches. Put a version marker in
`fpHands.js`, read it back through the scene graph (a mesh name, not a global —
`contextIsolation` blocks globals), and do not trust a single frame until the
marker matches. Likely suspects: a module cache surviving the fresh user-data-dir,
or the worktree serving from somewhere other than where I am editing.

Once that is closed, the remaining hand work is small and known:

1. **Forearm** — the one part of sixteen not adopting. It is the only swap entry
   whose runtime mesh is a `CylinderGeometry` rather than a capsule, and it is the
   part I most recently changed the dimensions of.
2. **The four unnamed capsules at the origin** — not finger segments, since all
   twelve of those are adopted. Something else in the hand, now identifiable by
   giving every mesh a name.
3. **Then proportions**, against a closer exhibit.


---

# THE CAUSE IS NOT ESTABLISHED. THE EFFECT IS. (Read the correction at the end.)

Computed with `run-electron.cjs`'s OWN `canonicalPath` (it lowercases on win32 —
my first reconstruction did not, which is why my first attempt at this comparison
produced two hashes that matched nothing and should have been thrown away rather
than reasoned from):

```
scope(worktree C:/gfassets) : 41d8c05e53795c93fcf0
scope(main repo)            : c9b7a35163f3a1f41222
observed in the worktree run: c9b7a35163f3a1f41222   <-- the MAIN REPO
```

**Every Electron run I made from the worktree served the MAIN repository's `src/`.**
`ROOT` is `process.cwd()`, it resolved to the main repo, and the harness passes it
as the spawn `cwd`, so `electron .` loaded the main repo's app.

### What that means, and it is not small

The main repo's `fpHands.js` contains **zero** occurrences of `adoptAuthored`. So:

- **The authored hand has never been in the game.** Not once.
- The "15 BufferGeometry adopted" reading was never my parts. It is authored
  geometry that the held-tool asset registry streams in — the same 25 → 83 mesh
  streaming measured at the top of this report — and I misread it as my swap.
- The v1 and v2 frames differ because of lighting and time of day, **not** because
  of anything I modelled.
- My retraction ("I cannot confirm the authored model reached the game") was
  **right**. My un-retraction ("contextIsolation explains the nulls, the adoption
  evidence stands") was **wrong**. `contextIsolation: true` is a real fact and a
  real trap, but it was not the cause here.

Three conclusions in this report were reached by inference from a build I was not
running. They are struck: the adoption count, the four capsules at origin, and the
proportion improvements.

### The fix, for the next session

`ROOT = process.cwd()` in `tools/qa/run-electron.cjs`. Get the cwd right — verify
it by printing `repoScopeId` at launch and comparing it to the worktree's
`41d8c05e53795c93fcf0` — and the asset work becomes ordinary. Nothing about the
model, the axis or the wiring is known to be wrong; none of it has been tested.

**Then re-take every visual judgement in this report.** The parts of it that stand
are the ones that never depended on a frame: the `main.js` tool theft, the
Blender → glTF axis, `contextIsolation`, the stale-build proof, and a validated
16-part model.

---

## CORRECTION TO THE SECTION ABOVE — I ATTRIBUTED A NUMBER I DID NOT VERIFY

The scope id I compared against, `c9b7a35163f3a1f41222`, I described as "observed
in the worktree run". Checking where I actually read it: it appears in the **main
repository's** lock-refusal message at the very start of this session, and in a
run I made from the main repo during the previous goal. **I did not verify it came
from a worktree run.** I then re-ran from the worktree to capture the profile path
directly and the path did not appear in that run's output, so it is still not
verified.

So the arithmetic in that section is sound and its premise is not. `ROOT`
resolving to the main repo is a HYPOTHESIS, not a measurement, and I presented it
as settled. That is the third time today I have reasoned from a value I had not
carefully attributed, and it is the same error each time.

### What is actually measured, and survives

`palm.name = 'PalmV2'` on disk; the running build reports `Palm`. Directly
observed, twice, with the marker reverted afterwards. **An edit to `fpHands.js`
does not reach the executing code.** That effect is real whatever its cause.

`node cwd: C:\gfassets` when run from the worktree — so `process.cwd()` is
correct at the point `run-electron` reads it, which makes the wrong-root
hypothesis *less* likely, not more.

### What the next session should do, stated without a guess attached

1. Print `repoScopeId(ROOT)` and `app.getAppPath()` from inside an actual run and
   compare them to the worktree. That settles cause in one command; everything I
   wrote about it above is speculation until then.
2. Keep the marker check as the gate: rename a mesh, read it back through the
   scene graph, trust no frame until it matches.

Everything that never depended on a frame still stands: the `main.js` tool theft,
the Blender → glTF axis, `contextIsolation`, the stale-build effect, the
photograph recipe, and a validated 16-part model.

---

## THE ROOT HYPOTHESIS IS DEAD, MEASURED FROM INSIDE THE RUN

`run-electron.cjs` prints its own repository record. From a worktree run:

```
"root":       "c:\gfassets"
"scopeId":    "41d8c05e53795c93fcf0"     <- the WORKTREE's scope, computed earlier
"executable": "C:\gfassets\node_modules\electron\dist\electron.exe"
```

**Electron is serving the worktree.** The wrong-root story I told across two
messages is disproved by the runner's own report, which I could have read at any
point in the last two hours — it is printed at the end of every run.

So the ledger on that thread is: an effect measured directly and twice
(`PalmV2` on disk, `Palm` in the running build), and **three successive causes
proposed and disproved** — context isolation, a stale snapshot from an unknown
source, and a wrong repository root. What remains is a module/code cache, and it
has not been demonstrated either.

I am recording it that way rather than proposing a fourth cause. The pattern in
this session is that every time I offered an explanation instead of a measurement,
it was wrong, and the measurement was available.

### The one instruction that matters for whoever picks this up

Do not trust any frame until a marker proves the running build contains your edit.
Rename a mesh, read the name back through the scene graph, and only then look at
the picture. That check takes one run and would have saved this entire session.

---

# THE TRUTH, AND THE CAUSE OF EVERY RETRACTION ABOVE

## The hand is fully in the game. All sixteen parts. Both hands.

```
ADOPT  [{"applied":16,"expected":16,"missed":[]},
        {"applied":16,"expected":16,"missed":[]}]

load   "loaded 16 parts"  IndexProx IndexMid IndexDist MiddleProx MiddleMid
                          MiddleDist RingProx RingMid RingDist LittleProx
                          LittleMid LittleDist ThumbProx ThumbDist Palm Forearm

MARKER PalmMARK PRESENT: YES  -- edits DO reach the running build
builds 2                      -- both hands constructed
```

No misses. The Forearm adopts. The "four capsules" are not hand segments at all.
Edits reach the build. **There was never a stale build.**

## What actually happened, and it was me

One of my `sed`/regex edits mangled line 41 of
`tools/qa/electron-hands-authored.js`, leaving fragments of an earlier replacement
in the middle of a statement:

```
SyntaxError: Unexpected token ')'
```

**The driver had been failing on every run since.** And I had been invoking it as
`node tools/qa/run-electron.cjs ... >/dev/null 2>&1`, so I never saw the error —
then reading `qa/electron/hands/hands.json` and treating it as the result. That
file was **nineteen minutes old**: written 00:48:21, read at 01:07:59.

Every conclusion in the four sections above was drawn from a stale artefact:

| I claimed | actually |
|---|---|
| the swap never ran | it ran, 16/16, both hands |
| `contextIsolation` hid the globals | the globals were fine; the run had crashed |
| an older snapshot of `fpHands.js` was executing | no; the marker proves edits land |
| `ROOT` resolved to the main repo | no; the runner reports `root: c:\gfassets` |

Four retractions, one cause: **I suppressed a command's output and then trusted a
file it had not written.** The `>/dev/null 2>&1` is the whole of it. Every
explanation I reached for afterwards was an elaboration on top of a stale JSON.

## Where item 1 genuinely stands

Wired, adopted 16/16 on both hands, photographed at the default player camera with
the tool confirmed held: `Designs/ProShop/Images/Goal_26/playtest5/hand-authored-v3.png`.
72 of 89 tool meshes drawable at the shutter, no page errors.

**Whether it LOOKS right is still the open question, and it is now the only one.**
At the default camera the hand is small and dark. Judging it against a reference
photographed at arm's length needs a closer exhibit at matched apparent size —
which is the next concrete step, and the first one in this whole thread that is
about the model rather than about the harness.

## The rule this session earned

Never suppress a command's output and then read a file it was supposed to write.
Check the artefact's timestamp, or do not treat it as evidence.

---

## THE EXHIBIT, AND WHY THE FRAME IS STILL NOT GOOD ENOUGH TO JUDGE ON

Took the acceptance shot at the default camera and two magnified exhibits at
FOV 30 and FOV 18 — lens only, no transform touched, FOV restored and verified
back at 66 afterwards. All three held the broom with 72 drawable meshes.

Looking at the FOV 18 frame: the structure is right. Fingers wrapped round the
shaft, thumb across, forearm running back and down. Nothing splayed, nothing
detached, no capsule seams.

**But it is still not a frame anyone can judge a model on, and the reason is the
STAGE, not the lens.** Every shot in this report is taken at **6:01 AM on Day 1 in
an unlit, "filthy" clubhouse.** The hand is in near-darkness at the bottom of the
frame. Magnifying a dark subject gives a bigger dark subject.

That is a fixable mistake and it is mine: earlier drivers in this session set the
clock to 13:00 and called `applyTimeWeather` before shooting. `tool-photo.mjs`
does not. It should — the acceptance camera can stay exactly as it is while the
ROOM is lit, and then the comparison against a reference photographed in daylight
is a fair one.

### So the state of item 1, honestly

- **Technically complete**: 16/16 parts adopted on both hands, verified by the
  swap's own report, with the marker proving edits reach the build.
- **Visually unjudged**: not because the model is unknown, but because every frame
  of it was taken in the dark.

The next step is one line in `tool-photo.mjs` — pin the clock to midday before the
shutter — and then the question "does it look right" can finally be asked properly,
of the hand and of the mop and broom after it.

---

# THE HAND, IN A FRAME THAT CAN BE JUDGED

`Designs/ProShop/Images/Goal_26/playtest5/hand-lit-fov18.png` — 1:00 PM, lit room,
FOV 18. Acceptance shot beside it at the default camera and default FOV:
`hand-acceptance-lit.png`. Both at 72/89 drawable with the broom confirmed held.

One more trap on the way: calling `lightTheRoom` between equipping and shooting
**took the tool out of the player's hands** — acceptance fell to 22 drawable and the
magnified exhibits to ZERO with `tool: null`. The clock jump does it. Lighting now
runs ONCE at boot, before anything is equipped, and never again.

## What the frame shows, now that it can be seen

**Right:** both hands are ON the shaft with fingers genuinely wrapped round it, the
segments articulate as fingers rather than beads, the forearms taper away
correctly, and there is not a capsule seam anywhere. Against the splayed rods of
the first attempt this is a different object.

**Wrong, and specific:**

1. **The fingers are too thin and too pale.** They read as pale sticks. The
   reference is fuller and warmer — flesh, not bone. This is `SKIN` (0xd9a97e) plus
   my thickness values, and the thinness is mine: I taper `fthick * 0.50` down to
   `* 0.30` and the reference does not narrow like that.
2. **The palm has no mass.** The hand reads as mostly fingers with nothing behind
   them. My palm is 0.0335 × 0.0165 — too shallow against a 0.019 finger.
3. **The thumb does not cross over.** In the reference the thumb lies across the
   fingers on the near side. Here it is tucked and barely visible.

None of that is a plumbing problem. It is three numbers and a pose, and every one
of them is now measurable against a frame that shows them.

## Item 1 verdict

**Wired and adopted 16/16 on both hands. Photographed fairly. NOT yet a match.**
It is closer than the capsules by a clear margin and it is not what the owner asked
for, which is a hand that looks right. The three faults above are the work
remaining, and for the first time in this thread they are faults of the MODEL
rather than of the harness.