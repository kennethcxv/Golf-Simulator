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
