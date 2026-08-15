# PLAYTEST 5 — WHAT I FOUND, WHAT I FIXED, AND WHAT I DID NOT FINISH

## Probe-lie count this round: **5** (running total **42**)

| # | the instrument | what it claimed | what was actually true |
|---|---|---|---|
| 38 | `electron-course-editor-lag` | the course editor is healthy — 4.2 ms median frame, p95 8.4 ms, **zero** frames over 100 ms, no long tasks | It measured FRAME TIME. The fault is an exception thrown out of a pointer handler, which costs no frame time at all: the loop keeps its cadence while every click is discarded. Its own planted-400 ms control passed, so the instrument worked perfectly and was pointed at the wrong quantity. Had I stopped there I would have reported "cannot reproduce, the editor is fine" |
| 39 | `electron-course-editor-null-scene` step B | 0 uncaught errors after quitting to the menu **from inside the editor** | The quit never happened. The button match was `^Return to main menu$` against a list I had truncated to 20 entries, so it silently found nothing and the step ran against a game still sitting in the editor. `afterQuit.screen` was still `game` in the same JSON that carried the green number |
| 40 | `electron-editor-survives-scene-swap` step C | 0 uncaught errors **during the scene swap** over 86 pointer events | No swap occurred. The Save-to-slot-1 step did not write (`slot1 present after save: false`), so the Load confirm was a no-op on an empty slot, `scene3dIsNull` was `false` throughout, and the check reported green about a condition it never entered — a check born green |

| 41 | `electron-load-in-hands-and-camera` v1 | no tool was EVER held across the whole boot — "nothing is equipped on load" | It read `walk.tool`, which does not exist on the walk facade (the accessor is `getTool`), so every sample was `undefined`. Its own planted dustpan came back as "no span", which is the only reason the reading was not reported to you as fact. **The same non-existent accessor is what main.js's deferred warm reads** — a probe lie and a production bug from one typo |
| 42 | `electron-load-in-hands-and-camera` v2 | the unasked-for dustpan span is GONE after the fix | It sampled on a **50 ms `setInterval`** while the thing it measured is a **three-frame** draw — 12 ms at 240 Hz. The span had not gone; it had fallen between two samples. Re-sampled at rAF it was still there at 37 ms, and the real proof of the fix turned out to be somewhere else entirely (the overview, where the restore queue never drains) |

Lie 42 is the one worth dwelling on: it would have let me tell you the dustpan
was gone, with a number, from an instrument whose control passed. The control
only proves the probe can SEE the thing — it says nothing about whether the probe
looks OFTEN ENOUGH. Sample rate is a second axis of blindness and this file has
no prior entry for it.

The shape shared by 39 and 40 is worth naming, because it is not on the list in
`FOUND_FALSE.md`: **a step that fails to happen reports the same green as a step
that happened and was clean.** Both drivers printed a pass while their own
adjacent fields (`screen`, `scene3dIsNull`, `slot1 present`) said the setup had
not taken. Every staged precondition needs an assertion that it took, and the
verdict must read that assertion — not just the measurement downstream of it.

---

## Where each item stands

| item | state |
|---|---|
| P0 — course editor unusable | **ROOT-CAUSED FROM YOUR OWN CRASH LOG, FIXED, NOT VERIFIED IN PLAY** — see below |
| P0 — loading in (dustpan, map flash) | **DUSTPAN REPRODUCED AND FIXED.** Map flash NOT reproduced; the ordering race behind it is closed |
| 1 — first-press lag | not started |
| 2 — customers announce from the back | not started |
| 3 — my body is still solid | **THE LEAD IS TRUE.** Audit done, predicate fixed, source test red→green; not yet verified in play |
| 4 — walk-in tee time needs two attempts | not started |
| 5 — audio | not started |
| 6 — Blender assets | SKIPPED, second session owns it |

---

## P0 — THE COURSE EDITOR IS UNUSABLE

### It is in your crash log, and it names the line

`%APPDATA%\GOLF EMPIRE\logs\crash.log`, session `2026-08-15T07:11:54.673Z` —
the **first fault of your playtest session**, before anything else went wrong:

```
[2026-08-15T07:11:54.673Z] renderer:window.onerror
    TypeError: Cannot read properties of null (reading 'setEditorBrush')
        at updateHoverVisuals (src/ui/courseEditor.js:3288)
        at src/ui/courseEditor.js:3270          <- scheduleHoverPreview's rAF callback
    ... the same throw again at .684 and .721

[2026-08-15T07:11:55.356Z] renderer:window.onerror
    TypeError: Cannot read properties of null (reading 'renderer')
        at onPointerDown (src/ui/courseEditor.js:2925)
        at pdHandler (src/ui/courseEditor.js:4009)
```

Three hover throws inside 48 ms — one per frame, a hand moving the mouse — then a
press 635 ms later that threw on its own first line.

`scene()` in the editor is `() => app.scene3d`. Both handlers dereference it with
no guard, so **`app.scene3d` was null while the editor was still `active` and
still holding its five capture-phase window listeners.**

`onPointerDown`'s very first statement after the modal check is:

```js
if (e.target !== scene().renderer.domElement) return;   // line 2925
```

It throws there. Not one editor verb is reached. **"I cannot click anything" is
not an exaggeration or a timing complaint — it is literally true**, and it was
true for every click you made in that state.

### Why it is that line and not another

`groundAt` — the function immediately upstream — is already guarded:

```js
function groundAt(e) {
  return scene() ? scene().raycastGround(e.clientX, e.clientY) : null;
}
```

So tolerating a null scene has been the intent all along. With a null scene it
returns `null`, `hover` becomes `null`, `scheduleHoverPreview(null)` books a rAF,
and one frame later `updateHoverVisuals(null)` takes the `!g` branch and calls
`sc.setEditorBrush(null)` on `sc === null` — **line 3288, exactly the stack in
your log.** Somebody guarded the entry point and left the three consumers behind
it unguarded: `updateHoverVisuals`, `onPointerDown`, `onWheel`.

### Where the null comes from, and where twenty seconds fits

`app.scene3d` is null in exactly one window: between `destroyCurrentScene()`,
which nulls it, and `startGameNow()`, which reassigns it. `startGame()` sits
between the two — two animation frames, and then **up to a 12-second asset
barrier** (`scene.assetBarrier(12000)`, veil reading "Finishing the previous
course load") before the next course is built on top of that.

That window is reachable without leaving the editor. The pause shell the editor
itself opens with **P** carries **Save game** and **Load game**, and a load runs
`bootEmpire → startGame`. I read the shell's live button list in the running
editor to confirm it: `Resume, Overview, Save game, Load game, Settings,
Controls, Session`.

Two further faults compound it, and both are in the same file:

1. **`exitToMenu()` destroyed the scene and never told the editor.** Only
   `startGameNow` hid it, and only *after* the new scene existed.
2. **`hide()` talked to the scene BEFORE tearing itself down.** Seven unguarded
   `scene()` calls ran ahead of `root.style.display = 'none'` and ahead of all
   five `removeEventListener` calls. One throw at `scene().frameCourse()` and the
   editor stays painted at z-index 8 over whatever replaced it, with `onKey`
   still calling `stopPropagation()` in capture phase on **every key** —
   the game's entire keyboard dead. A transient became permanent.

### The half-black frame after Tab

`onKey` in the editor calls `e.stopPropagation()` but never `preventDefault()`,
and `main.js` returns to the editor's listener at line 3390 — *before* its own
line 3425, `if (e.key === 'Tab') e.preventDefault(); // Tab must never reach DOM
focus in-game`. **The editor is the one surface in the game where the browser's
focus traversal still runs.** Focus lands on a control in the editor bar and the
engine scrolls it into view, which slides the `position:absolute` canvas up
inside an `overflow:hidden` body and exposes the page's `--charcoal` background
underneath — top half editor, bottom half solid dark.

It fits your photograph and it is a real defect either way, so it is fixed. But
**I did not reproduce the torn frame**, and I am not claiming I did: Tab in a
healthy editor gave a clean full-height frame
(`qa/electron/course-editor-lag/04-after-tab-400ms.png`, viewed). The reason I
think it belongs to the same root cause is that with `app.scene3d` null, `frame()`
skips rendering entirely (guarded at main.js:4020) **and `resize()` returns early
at main.js:4638** — so the canvas keeps a stale drawing buffer at the old size
while its CSS box is re-laid out, and nothing ever redraws it. That is the exact
ingredient for a torn frame. **UNCONFIRMED.**

### What was changed

`src/ui/courseEditor.js`
- `detachEditorInput()` — the five `removeEventListener` calls in one place.
- `abandonForLostScene()` — when the scene is gone the editor takes *itself*
  down: DOM hidden, listeners removed, no scene touched. Swallowing the events
  silently would have been worse, because the dead editor would keep eating the
  keyboard.
- Every installed listener now funnels through one `guarded()` wrapper, so the
  rule is stated once instead of at seven call sites. `onWheel` and
  `updateHoverVisuals` (reached from a rAF, so it outlives its own event) are
  guarded directly.
- `hide()` reordered: `display:none` and `detachEditorInput()` **first**, scene
  restoration after and skipped entirely when there is no scene.
- `Tab` gets `preventDefault()`.

`src/main.js`
- `startGame()` hides the editor at the top, while the **old** scene is still
  alive — the only moment `hide()` can hand back its camera limits and lighting
  override.
- `exitToMenu()` does the same before `destroyCurrentScene()`.

### What I could NOT do, and why this is not marked DONE

**I never drove the game into the null-scene window, so I have never watched the
fix's check fail.** Three attempts are recorded above as probe lies 39 and 40.
The route needs Save-to-slot then Load-from-slot through the pause shell, and my
save step did not write. Per the 45-minute rule I stopped rather than keep
grinding on the harness.

So: the **defect** is proven — by your machine, with file, line and mechanism, and
that is better evidence than any driver I could have written. The **fix** is
applied to those exact lines. The **repair is unverified in play.** It stays
NOT DONE until a driver reaches the state and I have watched red go green.

Lint ratchet: 323 findings, unchanged.

---

## P0 — TWO THINGS WRONG WITH LOADING IN

### The dustpan: reproduced, and the reason it STAYS is not the reason it appears

The deferred GPU warm (`scheduleDeferredGpuWarm`, main.js) equips a dustpan
1600 ms after the veil lifts, draws three frames so the eight hand programs
compile, and puts it back. That draw is deliberate and, measured at rAF rate on
a fresh boot, lasts **49 ms** — a flicker. It is not what you are describing.

Two separate faults sit on top of it.

**1. The guard that was supposed to leave your hands alone never fired.**

```js
const held = typeof walk.tool === 'function' ? walk.tool() : null;   // undefined
if (!held) { ...take the hands... }
```

`walk.tool` does not exist on the walk facade. The accessor is `getTool`, and
every other caller in main.js uses it — lines 3014, 3065, 3081, 3139, 3205. So
`held` was `null` on every boot and the comment beside it —

> *"A player equipping a tool inside the first two seconds simply beats the warm
> and pays what they always paid; the warm skips itself rather than fight them
> for the hands."*

— describes something that has never once happened. The warm takes the hands off
whatever you just picked up, every time.

My own first probe read the same non-existent accessor and reported *"no tool
was ever held"* through its own planted dustpan. That is probe lie 41 below, and
it is the same trap: `tools/qa/electron-rake-viewmodel.js` already carries a
comment saying "getTool, NOT tool()" from an earlier session.

**2. The restore is QUEUED, and the queue is not always drained.**

```js
function walkSetToolDebounced(tool) {
  if (toolSwitchCooldown > 0) { pendingBeltTool = tool; hasPendingBeltTool = true; return; }
  ...
}
```

`TOOL_SWITCH_DEBOUNCE` is 120 ms; the warm's three frames are ~12 ms at 240 Hz.
So the warm's `setTool(null)` **never applies** — it is parked in
`pendingBeltTool`. The only thing that drains that queue is `updateHeldFeel`,
which runs from `walkUpdate`, which `main.js` only calls while `walkActive()`.

**Press Tab for the overview and `walkUpdate` stops.** That is one keypress from
loading in, and you are pressing it — item P0's other half is about what Tab
shows you.

Measured in the running game, driving the warm's own call sequence through the
same public API, in the overview
(`tools/qa/electron-warm-leaves-a-tool.js`, `qa/electron/warm-leaves-a-tool/`):

| the door the restore went through | after 3 seconds |
|---|---|
| `walk.setTool` — what the warm used | **`"dustpan"` — still in the hands** |
| `walk.setToolImmediate` — what the fix uses | `null` — hands empty |

`discriminates: true`: the two paths disagree, so the run measured the fix and
not the debounce. That is the dustpan you keep finding in your hand.

**Fixed:** `getTool` so the skip guard works, and a `setToolImmediate` door on
the walk facade that does not queue and clears any queued switch on the way
through. The debounce still guards the belt against a player mashing it; the
warm is not a player.

### The map before you load in: NOT REPRODUCED, but the race is real and now closed

`enterWalk()` runs long before prewarm, so `walk.active` has been true the whole
time and every flag-based probe calls this healthy. **The camera has not been
with the player.** Prewarm swings it out over the course to warm the overview and
editor programs, and the sampler reads **camY 147.87** for the entire prewarm
against a walk eye of **−0.84**.

Nothing in the completion block brought it back. `app.prewarming = false;
veil.hide();` ran synchronously, starting a 420 ms fade, while the camera only
returns on the **next scheduled production frame**. Which of those won was a
race. On my boots the frame won by 287 ms, 385 ms and 561 ms — so I never saw
the map, and I am not claiming I did.

**Fixed by ordering rather than by luck:** the veil now lifts inside a two-frame
yield — the same paint-yield idiom `startGame` uses — so a real production frame
is drawn from the walk camera underneath an opaque veil before it starts to fade.
Measured margin after the change: **1010 ms**, and it is no longer a race at all.

### Instrument notes

The probe went through three versions and the first two were worthless:
frame-time (blind to the fault), then a 50 ms `setInterval` (three to twelve
times too coarse for a three-frame draw). It samples at **rAF** now — the rate
the thing it measures changes at — and carries a planted-dustpan control that
must appear as a span. The control failed on the first run, which is the only
reason the "no dustpan" reading was not reported to you as fact.
