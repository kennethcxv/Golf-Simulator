# FRAME PACING, THEN THE NPCs

Two jobs. The first is short and may be one line. The second is the big one.

---

# PART A — SMOOTHNESS AT 144Hz

**Push everything you have verified first.** The lag spikes are gone — I played
it and there were no freezes. Door, editor, laptop, Tab, all fine. That is the
first time that has been true and it deserves to be committed before anything
else moves.

**What is left is different in kind.** At 144Hz the game does not feel SMOOTH
when I walk and look around fast. Not stutter, not a spike I can point at — a
rough, rugged feel. Sub-hitch. **This is frame PACING and FPS headroom, not
first-press compiles**, so stop working the arrivals angle entirely.

## A1 — MY DISPLAY IS 144Hz AND YOUR CAP DEFAULTS TO 60

You set that default because 120 held 0% on cadence, blocked by ~8.0 ms of
CPU-side render submit. **Both numbers predate this week's work and the matrix
freeze.** Re-measure:

- What refresh rate the panel is ACTUALLY running. Your probe once said 120 when
  I said 240 — trust the OS, not the probe.
- Whether 144 holds now.
- **Whether the cap itself is what makes it feel rough.** A 60 cap on a 144Hz
  panel produces exactly the uneven cadence I am describing, because 60 does not
  divide 144.

If the cap is the cause that is the fix and it is one line. **Prove it by
measuring frame-to-frame INTERVAL VARIANCE, not average FPS.** Smoothness is
consistency, not throughput.

## A2 — THE SHADOW BAKE

You named it: every tenth frame runs double on the 10 Hz fitted-shadow cadence.
At 60 fps that is a hiccup every 100 ms; at 144 it is worse and more visible.
Spread the bake across frames, cache it, or drop the cadence — whichever measures
best.

## A3 — THE 8.0 ms CPU SUBMIT

That was the named blocker for 120 fps, measured on the un-frozen 2,208-object
clubhouse subtree. You have since frozen the static set and cut matrix churn 56%.
Re-measure it — it may already be gone.

## HOW TO MEASURE IT

The way it feels, not the way it averages:

- 2,000+ frames of held W **with mouse-look sweeping**, sim live, my resolution
- median, p95, p99, worst, **and frame-to-frame interval variance**
- the same at cap 60, cap 144, and uncapped
- **target: p99 under 6.9 ms at 144Hz, and interval variance flat**

Then tell me which of the three it was. **If it is the cap, say so plainly** — I
have been chasing compiles for a week and it may have been a one-line setting.

---

# PART B — THE NPCs

My customers do not behave like people. They run into each other, into walls,
into the counter and the boxes; they queue shoulder-to-shoulder sideways instead
of in a line; and at checkout they all leave together. Every other simulator on
the market solves this. Mine has to as well.

**Read the history first.** This has been reported across at least five sessions
— "NPCs still run continuously into a box at the top left", a 1-second stuck rule
that shipped and did not hold, the sideways queue, and a check-in screen showing
AT DESK and IN QUEUE for people who had already left.

## B0 — THE TWO-POPULATIONS TRAP. Read this or you will repeat it.

`sim/customerSimulation.js` keeps `active`. The clubhouse renderer keeps its own
organic visitors via `clubhouse.customers()`. **The tests and every prior check
read the first; the player watches the second.** A check pointed at the wrong one
passes while the shop disproves it — that is the documented root cause of
"verified but observably false" on this project.

Before touching anything: establish which population drives the visible
customers, point every instrument in this goal at THAT one, and say in the report
which you measured.

**And screenshot everything.** Three separate probes have now reported clean on
things I could see were broken by looking. Every acceptance here ends with a
picture or a clip you have actually viewed.

## B1 — NAVIGATION. They must not walk into things.

- **Build a real navigation representation** — navmesh or grid — **generated from
  the actual collision geometry**, so a new fixture or a dropped box changes the
  paths automatically. Anything hand-listed goes stale the first time the layout
  moves, and this codebase has been bitten by hand-written lists three times.
- **Local avoidance between agents**: two customers crossing an aisle give way
  rather than grinding through each other. Steering, not collision response — I
  want to see them anticipate, not bump and correct.
- **Dynamic obstacles**: delivery boxes, the hand truck, me standing in a
  doorway. They path around, not through, and not into a wall trying.
- **A stuck detector that works.** One shipped before and did not hold. Watch it
  fail on a deliberately blocked agent before trusting it.

**Acceptance: a five-minute clip of a busy shop with zero wall penetrations, zero
agent-agent overlaps, zero stuck agents.** The clip, watched — not a probe count.

## B2 — THE QUEUE

- **Single file running back from the desk**, natural gaps, not shoulder to
  shoulder.
- **Advance when the person ahead moves**, and re-flow when someone leaves the
  middle.
- **They must not all leave together.** Whatever causes the mass exodus at
  checkout is one bug, not emergent behaviour. Find it.
- Someone joining walks to the back rather than teleporting into the shape.

## B3 — THEY SHOULD READ AS PEOPLE

This is what separates a good simulator from a cheap one, roughly in order of how
much it will show:

- **Individual pace and idle behaviour** — not everyone walks at one speed or
  stands identically.
- **They look at what they are doing** — the shelf they browse, the person ahead
  of them, me when I speak to them.
- **Browsing that looks like browsing**: pause, look, consider, pick up or move
  on. Not a straight line in and a straight line out.
- **Personal space** — they do not stand inside each other or inside me.
- **Natural entrances and exits** through the door, at their own pace, not
  spawning into position or vanishing.

Reference the comps: TCG Card Shop Simulator, PowerWash Simulator, House Flipper,
Supermarket Simulator. Watch what their crowds do and match that standard.

## B4 — THE LAPTOP, STILL SLOW ON FIRST OPEN

You took it 3,583 ms → 290 ms bar-to-usable on a warmed boot. The first open in a
fresh session is still slow. Measure that specific case — cold profile, first
ever open — attribute it the way you attributed the rest (arrivals, uploads, or
main thread), then fix it or tell me why it cannot move.

---

## RULES

**Verify by playing, not by census.** Real input, sim live, no pins, no
teleports, on the population the player actually sees.

**Every acceptance ends with a clip or screenshot you have looked at.**

**Watch every new check fail on a known-bad case first.**

**Park past twelve rounds** on any one item and say why.

Goldens and the one-pixel control after anything that renders. Suite green.
Compact at 80% and carry on.