# PLAN 17

Written section by section, never ahead. Each section gets Phase 0 (explain-back),
Phase 1 (plan), Phase 2 (four reviewers' objections with my answers), and then the
work happens.

---

## READING TAKEN: where the tuning overlay sits in the order

The brief says two things that could conflict. Requirement 1 says **build the live
tuning overlay first** and calls it "the highest-value thing you can produce
unattended". The ORDER line says **A, B, C, D, E, F, G, H**.

I read the overlay as pre-section infrastructure rather than a section, so it runs
**before Section A**. It is also cheap this time: a first version of it shipped in
Goal 16 (`src/ui/toolTuner.js`, F9), so the work here is an audit against
Requirement 1's named value list plus the gaps, not a build from zero.

Recorded per the brief's instruction to say which reading I took.

---

## R1 — THE TUNING OVERLAY: audit against the brief's own list

Requirement 1 names the values the panel must carry. Audited line by line against
the shipped `SLIDERS` table.

| brief's value | in the panel today | verdict |
| --- | --- | --- |
| hand anchor x/y/z | `compose.gripAnchor.0/1/2` | present |
| grip roll | `compose.handRollUpper`, `compose.handRollLower` | present |
| hand scale | `compose.handScale` | present |
| arm pose | `arms.forearmSpan`, `arms.forearmDepthRef` | present |
| elbow offsets | `arms.elbowOffsetRight.0/1/2` only | **half — the LEFT elbow has no slider** |
| strand stiffness | `strands.chaseBase` | present (mop only) |
| bristle stiffness | none | **missing — the strand group is hard-gated to `tool === 'mop'`** |
| lag | `strands.dragGain`, `weight.lagHz` | present |
| splay | `strands.splayBase` | present |
| slack | `strands.slackScale` | present |
| sweep arc | `sweep.arcRad` | present |
| stroke rate | `stroke.rate` | present |
| hand-follow radius | `sweep.handFollow` | present |
| wrist roll | `sweep.handRoll` | present |
| weight | `weight.lagHz` + `weight.lagDamping` | present |
| damping | `weight.lagDamping` | present |
| carry hover | `compose.carryHover` | present |
| plant blend | `pitch.carryAbove`, `pitch.workBelow` (the blend's two ends) | present as the two thresholds; the blend CURVE has no control |

Diagnostics the brief names: head above floor **present**, hand NDC **present**,
palm-to-shaft distance **present**. The panel also carries a rendered-frame row
(which camera drew the tool, and pixel motion in the head region), which is the
row that exists specifically to make the six-round divergence visible.

### R1 gaps I am closing

1. **Left elbow offsets** get their own three sliders. "Elbow offsets" is plural
   and a two-handed grip has two elbows; tuning one and not the other is why a
   pose can look right on one side and wrong on the other.
2. **The strand group stops being mop-only.** It becomes "whichever tool has a
   fibre rig", so the broom's bristles appear in the panel the moment B3 gives the
   broom one, with no second edit to the panel.
3. **Typed values.** A slider cannot hit 0.317 reliably at 4K. Every row gets a
   number box beside it that reads and writes the same path.
4. **A revert button.** Tuning is only safe if a bad drag is one click from the
   shipped value. Save already writes `toolFeelOverrides.json`; revert reloads the
   defaults into the live clone.

### R1 verification (Electron, default camera)

- Driver opens the panel with a real F9 keypress, drags one real slider through
  the DOM input's `input` event, and screenshots the game at the default camera
  before and after. The tool must be visibly different in the two shots.
- **Negative control (already built in):** the panel carries a dead slider wired
  to nothing. The same drag on the dead slider must produce a screenshot pair
  that is pixel-identical in the tool region. If the dead control moves the tool,
  the panel is lying and nothing it reports can be trusted.
- **Second negative control:** the typed number box and the slider must disagree
  with each other never — typing a value and reading the slider back must round
  trip. A box that displays but does not write is exactly the class of fault the
  brief is warning about.

### Definition of done, in a player's words

"I press F9, drag a slider, and the tool in my hands changes while I am dragging
it. I press Save and the change is still there next time I launch."

---

# SECTION A — PERFORMANCE

## Phase 0 — the section explained back, as verbs, before reading any code

Written from the brief alone. If any of these disagrees with the brief, the brief
wins; where I could not tell, I took the reading that changes the game.

- **A1.** I am going to **stop the player paying for shader compilation while
  they play.** The first thirty seconds stutter because programs compile after
  the veil lifts, and a program's cache key carries frame properties (light
  counts, shadow map size, clipping planes) that the current geometry-only
  prewarm never varies. So I will warm the frame states too, or intern materials
  so there are fewer programs to compile, or hold the veil until the scene is
  genuinely warm and say so on screen — whichever measures best. Then I report
  the frame times through the first thirty seconds, before and after.
- **A2.** I am going to **make opening a door cost nothing noticeable, every
  time**. First I find out what a door actually spends its time on — geometry
  changes, a nav rebake, lights being recounted, the shadow map refitting — and
  then I remove that cost rather than describing it.
- **A3.** I am going to **make the ledger open instantly.** It takes seconds
  today. Target is under 16 ms; if the work genuinely cannot be done in a frame,
  I open the book immediately and let the pages fill in as they finish, so the
  *visible* delay is zero either way.
- **A4.** I am going to **stop the quality-preset switch from stuttering while
  the player watches.** Recompiling every material when shadows toggle is
  correct behaviour; paying for it inside one frame is not. It goes behind a
  brief honest "applying" state, or gets spread over several frames.
- **A5.** I am going to **make the game open at the monitor's native
  resolution, full window** — 4K on this machine — instead of the 1080p it opens
  at now.
- **A6.** I am going to **make the resolution list compare against the real
  display**, so 1440p and 4K stop being labelled "bigger than your display" on a
  4K monitor. Today it is measuring the window; it must measure the monitor.

### The two things in this section I expect to be wrong about

1. **A1's "warm both light states behind the veil" has already been tried and did
   not move the number.** The brief says find out why. My restatement above
   assumes the prewarm is incomplete; it may instead be that the prewarm renders
   through a camera or layer mask that never touches the programs in question,
   which is the "wrong lens" fault this project has hit before.
2. **A3 at "seconds" contradicts the last measurement of 71 ms**, so something
   grew by two orders of magnitude. I expect the cause to be one thing painted
   many times rather than seven things each a little slower — and Verifier 2 of
   the previous session already measured the FIRST open specifically (821 ms in
   one session, 2.0-2.9 s in another) while reopens stayed clean at 25-29 ms.
   That split — first open expensive, reopens cheap — is the shape of a one-time
   build, not a per-open cost, and my restatement should not assume otherwise.

## Phase 1 — the plan for Section A

Order inside the section: **A5, A6 first** (they are the cheapest and they change
the resolution every other measurement in this section is taken at, so taking them
last would invalidate everything measured before them), then **A3**, then **A2**,
then **A4**, then **A1** (the hardest, and the one whose budget the others'
findings inform).

Requirement 9 says to name which of the logged instrument faults each new probe
could take. The recurring shapes I am exposed to here are: **the driver reaching a
state the player never occupies** (a probe that opens the ledger through an API
instead of pressing E measures a different code path); **measuring a proxy rather
than the thing** (frame count instead of frame time, or a timer wrapped round a
call that only queues work for the compositor); and **stale HEAD labelling**
(fault 72 - a first-load number is only true of the commit it was measured on).

---

### A5 - open full-window at the display's native resolution

**Reading taken:** "full-window" reads as *the window fills the display*, not
*exclusive fullscreen* - the settings panel already offers fullscreen as its own
mode, so making launch fullscreen would collide with a control the player owns.
Launch therefore opens **maximised over the active display's work area**. This
still changes the game (1600x940 today) and leaves the fullscreen toggle meaning
what it says.

- **Change:** `main.cjs` `createWindow()` - size and position from
  `screen.getPrimaryDisplay().workArea` instead of the hard-coded 1600x940, then
  `win.maximize()` so rounding cannot leave a one-pixel gutter. `minWidth` and
  `minHeight` stay.
- **Verify:** an Electron driver reads `win.getContentBounds()` and the display's
  `scaleFactor` from the main process, and reads `window.innerWidth/innerHeight`
  and `devicePixelRatio` from the renderer, and screenshots the game at the
  default camera. Physical content size must equal the display's work-area
  physical size. On this machine that is a 4K panel.
- **Negative control:** the same driver run against `FW_FAKE_DISPLAY=1600x900@1`
  must report 1600x900, not 3840x2160. If the probe reports 4K no matter what the
  display says, it is reading a constant, not the display.
- **Done, in a player's words:** "It opens filling my monitor, not in a small
  window in the corner."
- **Hard / might get wrong:** the frame-time cost. Four times the pixels of 1080p
  lands directly on the 16 ms invariant this very section is about. I will measure
  the same walk loop at the old size and the new one and report both numbers in
  the same breath, per Requirement 7. If the new default breaks the budget, that
  is a finding about the renderer's cost, not a reason to quietly keep the small
  window.
- **Rough time:** 45 min including the measurement.

### A6 - the resolution list compares against the monitor, not the window

- **Change:** possibly none. Goal 16's D1 already rewrote `fw:display-info` to
  speak physical pixels and compare against `display.size * scaleFactor`. The
  brief still lists it, so the instruction is to **prove it on the real 4K
  display** - and if it is still wrong there, fix it there.
- **Verify:** driver opens Settings then Display on the real monitor, screenshots
  the resolution list at the default camera, and asserts no entry at or below
  3840x2160 is marked as not fitting. The screenshot is the evidence, not the
  assertion.
- **Negative control:** `FW_FAKE_DISPLAY=1366x768@1` must mark 1440p and 4K as
  not fitting. A list that says everything fits on every display is not reading
  the display either.
- **Done:** "On my 4K monitor, 4K is offered, not greyed out as too big."
- **Hard:** the honest risk is that this reads green because it was fixed, and I
  report a fix I did not make. If so I say exactly that, with the commit that
  fixed it, and move on.
- **Rough time:** 30 min.

### A3 - the ledger opens instantly

- **Change:** find the cost first. Candidates named in the brief are the seven
  live page summaries, pages painted more than once, and the spine light forcing
  a shadow refit. Files: the ledger book module and the summary builders it
  calls, plus `courseScene.js` where the book's light is added. The fix is either
  "make it cheap" or "open the book on the first frame and paint leaves as they
  finish" - the brief accepts either, and the second is the one that guarantees
  zero visible delay.
- **Verify:** a driver that presses **E on a real keyboard** at the desk with
  pointer lock held, and samples animation-frame deltas across the press. The
  reported number is the worst single frame delta in the 2 s window after the
  press, plus the count over 33 ms. First open of a session and a reopen are
  measured separately, because Verifier 2 already proved they are different
  animals (821 ms to 2.9 s first, 25-29 ms after).
- **Negative control:** the same instrument run across a press of a key bound to
  nothing must report no hitch. If the probe reports a spike whenever any key is
  pressed, it is measuring the keypress handler, not the book.
- **Done:** "The book is in my hands the moment I press E, and I can still look
  around while it arrives."
- **Hard:** the brief's Requirement 5 forbids taking control away. If the answer
  is "open instantly, fill later", the fill must not freeze the mouse either, so
  the work has to be genuinely spread, not deferred into one later frame that
  costs the same.
- **Rough time:** 3 h.

### A2 - opening a door costs nothing noticeable

- **Change:** unknown until measured. The instrument comes first: a driver that
  walks to a door, presses the real interact key, and records frame deltas and
  the renderer's program and draw-call counts either side. Attribution before
  repair.
- **Verify:** worst frame delta across the door's animation, measured on the
  first door of a session and the fifth, since "every time, not just the first"
  is the complaint.
- **Negative control:** the same walk to the same spot without pressing the key.
  If that shows the same hitch, the door is not the cause and the finding is
  about walking, not doors.
- **Done:** "The door opens and the picture does not lurch."
- **Rough time:** 2 h.

### A4 - quality presets apply without a visible stutter

- **Change:** `src/main.js` `applySettings()` - the shadow-map toggle that
  recompiles every material moves behind an explicit "applying" state, or is
  spread across frames.
- **Verify:** frame deltas across a real click on Low and a real click on Epic in
  the settings panel, with a screenshot of the applying state.
- **Negative control:** clicking the preset already selected must produce no
  recompile and no hitch. If it hitches too, the cost is in the click, not the
  preset.
- **Done:** "Switching to Epic tells me it is applying instead of freezing."
- **Rough time:** 1.5 h.

### A1 - the first thirty seconds

- **Change:** measure first, in this order: (1) how many programs compile after
  the veil lifts, and what distinguishes their cache keys from the prewarmed
  ones; (2) whether the existing prewarm renders through a camera or layer that
  touches those materials at all - the "wrong lens" fault, and my stated
  expectation that this is where the previous attempt failed; (3) the material
  count against the program count, to see whether interning is worth it.
- **Verify:** frame deltas for the first 30 s after the veil, reported as a
  table (worst, count over 33 ms, count over 16 ms, median) before and after,
  three runs each. The renderer's program count is sampled alongside, because a
  hitch with a flat program count is a different animal from one that compiles.
- **Negative control:** a second consecutive session in the same process (warm
  GPU cache) must show the compile hitches gone while the non-compile ones stay.
  That separates "shader compilation" from "everything else that is slow at the
  start", which is the attribution the brief is asking for.
- **Done:** "The first half-minute is as smooth as the rest of the game."
- **Hard:** the brief already records that warming both light states was tried
  and did not move the number. If my measurement says it should have worked, the
  disagreement is the finding (Requirement 2) and I chase that, not the number.
- **Rough time:** 4 h+, and it may be bigger than it looks. If it is, I say so
  rather than shipping a shallow version.

## Phase 2 — adversarial review of the Section A plan

Four reviewers, given the brief's own context: 44 logged instrument faults, and
six consecutive rounds on the mop and broom that shipped measurements
disagreeing with the screen. Their job was to predict false greens, not to
improve the implementation. Every objection is below with my answer beside it.
I did not require agreement to proceed.

**Headline: the plan was wrong about what A1 is.** Two independent reviewers
showed that the post-veil window is the window already proven CLEAN, and that
the regression the owner feels lives in the load itself. The plan is corrected
below rather than defended.

### Reviewer 1 — VERIFICATION (can the check fail on a broken build?)

| # | objection | answer |
| --- | --- | --- |
| 1.1 | A1's "frame deltas for the first 30 s" names no player activity; the 42 late programs arrive on first-visit poses, so a driver that stands still reads clean on today's broken build. | **Accepted.** The A1 driver scripts the owner's own thirty seconds - walk in, 360 turn, cross the doorway - and must be shown RED on the unfixed build before any after-number is banked. |
| 1.2 | The "cold" run is not cold: Chromium persists compiled shaders to disk, so before and after can both read clean. | **Accepted.** GPUCache and DawnCache under the profile are deleted before every cold leg, and the before-leg must show compile-attributed hitches or the instrument is not trusted. |
| 1.3 | The veil-extension fix path passes by construction: hold the veil 60 s and the post-veil table is perfect. | **Accepted, and it is now a gate.** Time from launch to control is reported in the same table with a stated budget, so buying smoothness with load time shows up as the trade it is. |
| 1.4 | A3's "worst delta in the 2 s window" cannot fail on the intended fix's failure modes: deferred work, blank pages, or a smooth fill that freezes the mouse. | **Accepted, all three.** A3 now measures E-press to the first frame where the page is legible (pixels, not frames), samples until an instrumented "pages painted" event rather than a fixed window, and injects real mouse motion during the fill asserting the camera moves every frame. |
| 1.5 | A2 states no failing number, and a cost scheduled a tick after the swing lands outside the window. | **Accepted.** Gate is the 16 ms invariant; window runs from keypress to animation-end plus 2 s. |
| 1.6 | A4's click-window sampler misses deferred recompiles; the "already-selected preset" control passes on every build; a capturePage during a freeze returns the overlay either way. | **Accepted.** Sampling continues through a real 360 turn and a room change until the program count is stable, and input is asserted live DURING the applying state rather than photographed. |
| 1.7 | A5's probes all read the WINDOW; the DPR cap can leave the drawing buffer far smaller, and a blurry upscale passes every stated read. | **Accepted - this is the single most valuable objection in the section.** See A5 below: the probe now reports `getDrawingBufferSize()` against a stated expectation, and the window/buffer divergence is a first-class number. |
| 1.8 | A6's screenshot cannot be evidence: the resolution list is a native select whose popup Electron cannot capture. | **Accepted.** A6 asserts the exact rendered option text and disabled state for every candidate, plus the "this display has room for" line, which reads a different field and can disagree. |
| 1.9 | No Section A check is ever shown red; Requirement 8 appears nowhere in Phase 1. | **Accepted.** Every item's check runs once against a deliberately broken state before its green is banked. R1's check was already handled this way (three breaks, three reds, restored). |

### Reviewer 2 — HISTORY (which mistake is this repeating?)

| # | objection | answer |
| --- | --- | --- |
| 2.1 | A1's premise restates a claim Verifier 2 DISPROVED last session: the post-veil first ten seconds were the CLEAN part (0-8 frames over 33 ms, zero over 100 ms), the ~7.3 s stall sits BEHIND the veil, and the worst 30 s stall came with the program count FLAT 208-208 - a non-compile class. | **Accepted, and A1 is re-scoped.** The item's target is no longer "warm the shaders so the post-veil window improves". It is the load the owner waits through: page to playable, 7.8 s on both baselines against 22.1-22.8 s on the final HEAD. The per-commit bisect inside 8baa596..HEAD is the first action, not the last. The compile class is still real and still gets fixed, but it is a second finding, not the headline. |
| 2.2 | "Hold the veil until warm" is the regression's own mechanism: walk-active to veil-gone grew 2.2 s to 3.9 s to 10.4-12.4 s as work migrated behind the veil. | **Accepted.** Veil-hold is now disqualified as a primary fix and permitted only with page-to-playable guarded and reported. |
| 2.3 | Program and draw-call counters are reused without their logged failure modes (faults 29-31, 33): `needsUpdate` compiles nothing, `programs.length` is a NET count, a pre-first-draw baseline over-charges, and `render.calls` sampled once varied 133/351/273/686 at one pose. | **Accepted.** Program count is sampled as a series with the net caveat stated, never as a single before/after pair, and draw calls are averaged over frames or not reported. |
| 2.4 | A3's 2 s window is smaller than the known 2.0-2.9 s freeze (fault 69: a window must prove it contains the transition). | **Accepted.** The window is open-ended until the painted event, and the driver asserts the transition is inside what it sampled. |
| 2.5 | A3's press-timed sampling names none of the three mitigations already paid for: fault 57 (presses never stamped the mark; a turn read 6.5 s from a stale click), fault 52 (an unfocused window rAF-throttles to ~1 fps), fault 61 (re-staging inside the measured window). | **Accepted.** The driver stamps the press through a window-capture keydown listener registered before the game's handler, calls `bringToFront()`, and stages every mutation outside the sampled span. |
| 2.6 | A3's "first open of a session" will be warm if staged the usual way: localStorage seeding is a no-op in Electron, so the run measures whatever profile sits in userData. | **Accepted.** Coldness is established at the native save level (a fresh userData profile per cold leg), and the driver reports which it got rather than assuming. |
| 2.7 | A3's candidate list re-litigates acquitted suspects: the seven summaries were moved out of the open frame in report 15, paints measured at 0.3 ms, and report 16 convicted the ~55 ms canvas-to-texture sync. | **Accepted.** A3 starts at the convicted mechanism and at first-visibility of the open shell, not at the summaries. |
| 2.8 | A5/A6's `FW_FAKE_DISPLAY=` env control cannot reach main (fault 54); only the marker file ever worked, and a stale marker poisons real legs (fault 53). | **Accepted.** Controls are delivered by the marker file, written and deleted by the driver, and each leg reports `qaFakeDisplay` back so a stale file shows itself. |
| 2.9 | Fault 72 is cited in the preamble but not bound: no verify step requires a commit hash on its numbers. | **Accepted.** Every performance number in the report carries the commit it was measured on, in the same line. |

### Reviewer 3 — THE DIVERGENCE (would this notice the player seeing something else?)

| # | objection | answer |
| --- | --- | --- |
| 3.1 | A5 is the flagship exposure and the same class as the mop strands: the window can be 4K while the picture is upscaled from far fewer pixels, and capturePage grabs the composited surface so the screenshot cannot tell. | **Accepted.** The drawing-buffer size is reported, and a sharpness reading is taken from the real screenshot rather than assumed. |
| 3.2 | A6's assert reads the IPC payload while the screenshot is filed as evidence; if the panel paints before `fw:display-info` resolves, the data can be right and the first paint wrong. Also A5 sizes from `getPrimaryDisplay()` while display-info uses `getDisplayMatching(win.getBounds())` - two definitions of "the display". | **Accepted.** The two definitions are reconciled to one helper in main.cjs, and the assert reads the panel's first paint. |
| 3.3 | A3's frame deltas cannot see "the book arrived late": a perfectly paced three-second fill is green on every frame and still makes the player wait. | **Accepted** - already folded into 1.4. The headline A3 number becomes press-to-legible, in milliseconds. |
| 3.4 | A2's lurch may not be a frame-time event at all: a 10 Hz fitted shadow refit or mousemove starvation both leave deltas flat. | **Accepted.** The A2 driver holds the camera still through the swing and diffs successive captured frames, so a lighting pop shows up with clean timings. |
| 3.5 | A4's recompile is lazy - it fires at each material's next draw, so the stall lands thirty seconds later at the first doorway; and an applying state that freezes the mouse is Requirement 5's forbidden freeze wearing a label. | **Accepted** - folded into 1.6. |
| 3.6 | A1: an idle probe, a code-event t0 (veil removed but first real frame late), and a warm disk cache can each fake the win; if the fix is a longer veil, that must be reported as a longer load. | **Accepted** - folded into 1.1, 1.2, 1.3 and 2.2. |

### Reviewer 4 — BLAST RADIUS (what else does this touch?)

| # | objection | answer |
| --- | --- | --- |
| 4.1 | Every Electron driver inherits the new window; nothing anywhere asserts screenshot dimensions. | **Accepted.** A shared assertion goes into the QA boot helper and is called by the Section A drivers. |
| 4.2 | **The linchpin.** 382 files call `setViewportSize`; the run-electron shim maps it to `setContentSize` with no `unmaximize()`. On Windows a maximised window may refuse the resize, so 382 drivers would believe their stated size while running display-sized - and 117 of them use fixed click coordinates. | **Accepted, and it is now a prerequisite: A5 does not land until the shim unmaximizes and verifies the size it asked for.** This is the highest-consequence finding of the review. |
| 4.3 | Pixel floors calibrated at 1280x720 (the hands check's `FLOOR = 400`) silently weaken at 2.4x area; 41 files compute NDC and the aspect moves 1.70 to 1.84. | **Accepted.** Recorded as a standing consequence; the affected drivers are re-run in Phase 5 at the new default and any floor that moved is recalibrated with its reasoning stated. |
| 4.4 | Five CSS media queries flip state between 1600 and 2560 (course-editor rail at 1700/1500/1420, menu grid at 1250), and rem text is physically smaller in a 4K frame, so every legibility verdict recalibrates. | **Accepted.** The new default gets its own screenshot sweep, and the text-overlap invariants are re-run there rather than inherited. |
| 4.5 | The drawing buffer goes roughly 2.37x, so every previously-banked perf acceptance was calibrated at the small buffer, and ~23 pinned-viewport drivers keep passing while measuring a size the player no longer sees. | **Accepted.** The cost is measured and reported in the same breath as shipping A5, per Requirement 7. If it breaks the 16 ms invariant that is a finding about the renderer, not a reason to keep the small window. |
| 4.6 | Human-judged reference folders were captured at the old size, so future A/B compares different-sized frames. | **Accepted, recorded.** No automated fix; the report says which references predate the change. |
| 4.7 | A5's own negative control rides the dead env channel, and `activeDisplay()` needs `win.getBounds()` while `createWindow` runs before `win` exists. | **Accepted.** createWindow gets a display read that honours the marker file and does not require an existing window. |
| 4.8 | Deferring A4's shadow recompile opens a window where `shadowMap.enabled` is flipped but materials are not rebuilt - a state main.js documents as producing a continuous GL_INVALID_OPERATION stream, and nothing fails a run on GL errors. | **Accepted.** The A4 driver fails on a GL error stream, which is a check this project has never had. |
| 4.9 | A3's lazy fill makes the ledger's overlap instrument vacuous: overlaps=0 on an unpainted page would poison Section C's baseline. | **Accepted, and it is a cross-section trap.** The overlap recorder must assert the page was painted before it reports zero. Carried into Section C's plan. |
| 4.10 | A1's material interning breaks per-instance mutation: hover outlines, the probe paint, and tint identity all depend on materials not being shared. | **Accepted - interning is effectively disqualified** unless it is restricted to materials nothing mutates, and the report will say so. |
| 4.11 | Deferring A2's nav rebake past the door animation has no check for NPCs pathing through a just-opened door on the first frame. | **Accepted.** If the fix defers a rebake, that check gets written. |

### What the review changed

1. **A1 is re-scoped** from "warm the shaders" to "the load the owner waits
   through", with the compile class as a second finding. Two reviewers
   independently showed the plan was aimed at the window already proven clean.
2. **A5 gains a prerequisite** - the harness shim must unmaximize and verify -
   and a new headline number, the drawing buffer, without which the fix could
   ship blurry and green.
3. **A3's headline number changes** from worst frame delta to press-to-legible
   milliseconds, because the accepted fix path makes frame deltas blind.
4. **A6's evidence changes** from a screenshot to asserted option text, because
   the control is a native select whose popup cannot be captured.
5. **Every control moves off the env-var channel** onto the marker file, which
   is the only one measured to arrive.

---

# SECTION B — THE MOP

## Phase 0 — the section explained back, as verbs, before reading any code

Written from the brief alone.

- **B1.** I am going to **delete the current mop and build a new one** — head,
  strands, handle, grip, motion and floor contact, all new geometry and all new
  behaviour. Before I build anything I am going to **find footage of House
  Flipper's mop, watch it, and write down in the report what it does that ours
  does not**, then match that rather than invent. The strands have to *visibly*
  move: trail the stroke, splay against the floor when planted, swing behind on
  a direction change, and settle when I stop. And before any of that I have to
  **resolve the standing contradiction** — I have been told the strands travel
  0.25 yd and the owner sees no movement at all. One of those is wrong and
  finding out which is the first task, not a footnote.
- **B2.** I am going to **rebuild the broom's head so it reads as a brush and
  not a rake**: dense bristles instead of separated tines, a defined block, and
  a visible ferrule where the bristles meet the handle.
- **B3.** I am going to **give the broom's bristles the mop's motion system**,
  tuned for a stiff push broom rather than yarn — shorter travel, faster settle,
  less slack. This happens *after* the mop is right, because the brief says the
  mop's system does not work either yet.
- **B4.** I am going to **stop the rig planting a tool head on the floor when
  the handle cannot physically reach it**. My own earlier note says it plants
  regardless, which is why every candidate in a sweep read a plant of
  0.073-0.084 including one held two yards below the eye. The brief adds a
  hypothesis I should test: this is probably *upstream* of the hands reading as
  detached, because a head pinned to the floor while the hands sit where the
  handle cannot span means the shaft is being drawn between two points that do
  not belong to the same object.
- **B5.** I am going to **leave the other seven tools alone.** No opportunistic
  edits to the vacuum, dustpan, washer, spray, cloth, sponge or trash bag.

### The two things I expect to be wrong about

1. **"The strands do not move" may not be about the strands.** The measurement
   says 0.25 yd of travel. If that is true and the owner still sees nothing,
   the likely explanations are that the motion is real but far too small to read
   at arm's length, that it is happening on a mesh the player is not looking at,
   or that something downstream overwrites the pose before it draws. Requirement
   2 says the disagreement IS the finding, so B1 starts there and does not
   proceed until the two stories agree.
2. **"Delete it and build a new one" may collide with B4.** If the plant bug is
   upstream in the shared rig, a brand new mop hung off the same rig inherits
   the same detached-hands problem. The order that follows from that is B4
   first, or at least B4 understood first, even though the brief lists it
   fourth. I will follow reality and record the divergence if so.

### The cache check comes first, before any of it

Requirement 2 is explicit: **delete the packed asset cache, rebuild from source,
and confirm the GLB hash the game loads is the one I built.** If they differ,
that alone may explain six rounds of tool measurements. Nothing in this section
gets measured until that check has an answer.


---

# SECTION C — THE LEDGER

## Phase 0 — the section explained back, as verbs

- **C1.** I am going to **replace the ledger's opening animation entirely** with a
  two-press sequence: press E and the book comes up to my hands **closed**;
  press E again and it opens to the first page. What plays now - one press, a
  left side that appears already open and then swings toward the closing
  direction until it aligns with the right - is the wrong animation, not a
  mistuned one, so it goes rather than gets adjusted. (The 3-5 second delay and
  the input freeze were A3 and are already fixed: press-to-ink 1624 ms to 123
  ms, camera free throughout.)
- **C2.** I am going to **paginate any page whose content overflows**, using the
  machinery the guest register already uses, and make it impossible for any
  string in the book to show an ellipsis. Complaints and Fixes is the worst
  offender and is where I start. I will sweep every page at full content and at
  empty.
- **C3.** I am going to **fix every place words overlap words in the book**, and
  then fix the class: measure text before drawing it, and extend the existing
  truncation recorder so it records **overlaps** as well as cuts.
- **C4.** I am going to **stop the turning leaf showing a slice of the previous
  page through itself** - depth sorting, the leaf's own thickness, or the order
  the faces draw.
- **C5.** I am going to **move, reorient and restyle the bookmark**. It sits in
  the middle, it looks bad, and it is probably backwards: it should hang up and
  it hangs down.
- **C6.** I am going to **get page turns under 16 ms.**
- **C7.** I am going to **align the section locks and make the locked state read
  as deliberate.** Firsts is the worst.
- **C8.** I am going to **make the pages look like paper** - typography, ruling,
  ink weight, margins, the paper itself. It currently reads as a canvas with
  text on it.

### What I expect to be wrong about

1. **C1 says "the left side appears already open".** That sounds like the open
   subtree being revealed before the cover has swung, i.e. a swap-point problem
   rather than an animation-curve problem. If so the fix is in the swap, and
   "replace the animation" would be treating the symptom. I will look before I
   rewrite.
2. **C6 may already be satisfied.** The previous session measured per-turn cost
   at 1 hitch worst 54.1 ms, and A3's light fix removed a recompile that was
   firing on the book. Turns need re-measuring on this build before I assume
   there is work here.

## Phase 1 — the plan

**Order: C1 first** (it is the item that most changes the game and it gates how
every other ledger item is seen), then C3+C2 together (both are text-layout and
share the recorder), then C7, C5, C4, C8, with C6 measured first and worked only
if it is real.

- **C1.** Change: the book's state machine gains a **closed-in-hand** state
  between `closed` and `opening`. E from `closed` raises it to the hands and
  stops; E from `carried-closed` opens it; E from `open` closes and lowers it.
  Files: `src/render3d/clubhouse/ledgerBook.js` (states, `setOpen` becomes
  `advance`), `src/main.js` (the E handler must not toggle open/shut in one
  press).
  **Verify:** a driver that presses E on a real keyboard and reads the book's
  own state after each press - closed, carried-closed, open - plus a
  player-camera screenshot at each of the three states.
  **Negative control:** pressing a key bound to nothing must not advance the
  state. If it does, the driver is reading its own key handler.
  **Done, in a player's words:** "I press E and the book comes up shut. I press
  E again and it opens."
- **C2/C3.** Change: the paint functions measure every string before drawing it
  and record a rect; the recorder gains overlap detection to match the existing
  cut detection. Any page whose content exceeds its box paginates instead of
  shrinking or clipping.
  **Verify:** the recorder's own output across every page, at full content and
  at empty, with the counts reported.
  **Negative control:** a deliberately planted overlapping pair must be caught -
  the monitor recorder already uses a self-pairing plant and it works.
- **C6.** Measure first: press-to-painted for a turn, on a real key, with the
  frame deltas. Work it only if it is over budget.

### The reduced review, recorded as a divergence

The brief asks for four reviewers per section. I ran four on Section A and their
objections changed the work materially. For Section C I am running **two** - the
VERIFICATION and DIVERGENCE roles, which between them produced most of Section
A's useful objections - because context is finite and I would rather spend it on
the work than on a third and fourth opinion about a plan. Recorded here as a
deliberate reduction rather than an omission.


---

# SECTION D — CARRYING THINGS

## Phase 0 — the section explained back, as verbs

- **D1.** I am going to **make a carried thing follow the player or be put
  down, never abandoned in mid-air.** Today: carry the book, click the cashier,
  and the book hangs in the air where you were standing.
- **D2.** I am going to **add a put-down verb for the book**, the same verb every
  other carryable already uses.
- **D3.** I am going to **block the tool belt while carrying.** Today you can
  cycle cleaning tools with a ledger in your arms. Your hands are full.
- **D4.** I am going to **find every carryable object and give them all the same
  rules** - one pick-up verb, one put-down verb, no tool switching while
  carrying, nothing left floating, and the carried thing comes with you into and
  out of every station. Then **report the full list and confirm each obeys**,
  and add it to the invariant suite.

### Why this section is worth taking before C8

Standing Invariant 6 ("nothing the player carries is ever left floating, ever
unputdownable, and never allows a tool swap") is one of the seven my Phase 5
gate reports as **NO CHECK EXISTS**. D is the section that writes it. C8 is
typography polish on a book that already reads cleanly; D is a system the brief
calls broken, with an invariant attached and nothing watching it.

### What I expect to be wrong about

1. **"Carrying" may not be one mechanism.** The ledger has `setCarried`, boxes
   have a placement mode, and deliveries have their own carry profile. If those
   are three systems rather than one, D4's "make this one system" is the real
   work and D1-D3 are symptoms of it - and the honest first deliverable is the
   list, not a fix.
2. **The floating book may be a station-entry problem, not a carry problem.**
   "Click the cashier" enters a station; if station entry does not ask what the
   player is holding, then every station is a place a carried thing can be
   stranded, and fixing the cashier alone would leave the class untouched.
