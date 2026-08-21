# THE NIGHT: PACING, THE NPCs, AUDIO, AND THE BACKLOG

Four blocks in order. A is short. B is the big one. C has never been worked at
all. D is the runway so you never run out — work it top-down and stop when the
night ends, not when you run out of ideas.

---

# BLOCK A — SMOOTHNESS AT 144Hz

**Push everything you have verified first.** The lag spikes are gone — I played
it, no freezes anywhere. Door, editor, laptop, Tab. First time that has been
true; commit it before anything moves.

**What is left is different in kind.** At 144Hz it does not feel SMOOTH when I
walk and look around fast. Not stutter, not a spike I can point at — a rough,
rugged feel. Sub-hitch. **Frame PACING and headroom, not compiles.** Stop working
arrivals entirely.

## A1 — MY DISPLAY IS 144Hz AND YOUR CAP DEFAULTS TO 60

You set that default because 120 held 0% on cadence, blocked by ~8.0 ms of
CPU-side submit. **Both numbers predate this week's work and the matrix freeze.**

- What refresh rate is the panel ACTUALLY running? Your probe once said 120 when
  I said 240 — trust the OS, not the probe.
- Does 144 hold now?
- **Is the cap itself the roughness?** 60 on a 144Hz panel gives exactly the
  uneven cadence I am describing, because 60 does not divide 144.

**Measure frame-to-frame INTERVAL VARIANCE, not average FPS.** Smoothness is
consistency, not throughput.

## A2 — THE SHADOW BAKE

Every tenth frame runs double on the 10 Hz fitted-shadow cadence — your own
finding. Spread it, cache it, or drop the cadence, whichever measures best.

## A3 — THE 8.0 ms CPU SUBMIT

Measured on the un-frozen 2,208-object subtree. You have since frozen the static
set and cut matrix churn 56%. Re-measure — it may already be gone.

**HOW:** 2,000+ frames of held W **with mouse-look sweeping**, sim live, my
resolution. Median, p95, p99, worst, and interval variance. Same at cap 60, cap
144, uncapped. **Target: p99 under 6.9 ms at 144Hz, variance flat.**

Then tell me which of the three it was. **If it is the cap, say so plainly.**

---

# BLOCK B — THE NPCs

They run into each other, into walls, into the counter and the boxes. They queue
shoulder-to-shoulder sideways instead of in a line. At checkout they all leave
together. Every simulator on the market solves this.

**Reported across at least five sessions**: "NPCs still run continuously into a
box at the top left", a 1-second stuck rule that shipped and did not hold, the
sideways queue, a check-in screen showing AT DESK for people who had left.

## B0 — THE TWO-POPULATIONS TRAP. Read this or repeat it.

`sim/customerSimulation.js` keeps `active`. The renderer keeps its own organic
visitors via `clubhouse.customers()`. **Tests read the first; the player watches
the second.** That is the documented root cause of "verified but observably
false" here.

Establish which drives the visible customers, point every instrument at THAT one,
say which in the report. **And screenshot everything** — three probes have now
reported clean on things I could see were broken by looking.

## B1 — NAVIGATION

- **A real navigation representation, generated from actual collision geometry**
  — navmesh or grid. Anything hand-listed goes stale the first time the layout
  moves, and hand-written lists have bitten this codebase three times.
- **Local avoidance between agents** — steering, not collision response. I want
  to see them anticipate, not bump and correct.
- **Dynamic obstacles**: delivery boxes, the hand truck, me in a doorway.
- **A stuck detector that works.** One shipped and did not hold. Watch it fail on
  a deliberately blocked agent first.

**Acceptance: a five-minute clip of a busy shop — zero wall penetrations, zero
agent overlaps, zero stuck agents.** The clip, watched.

## B2 — THE QUEUE

Single file running back from the desk, natural gaps. Advance when the person
ahead moves; re-flow when someone leaves the middle. **They must not all leave
together** — that is one bug, not emergent behaviour. Joiners walk to the back
rather than teleporting into the shape.

## B3 — THEY SHOULD READ AS PEOPLE

Individual pace and idle behaviour. They look at what they are doing — the shelf,
the person ahead, me. Browsing that looks like browsing: pause, consider, pick up
or move on. Personal space. Natural entrances and exits through the door.

Comps to match: TCG Card Shop Simulator, Supermarket Simulator, House Flipper.

---

# BLOCK C — AUDIO. This has never been properly worked and it is half the feel.

A simulator with no sound feels broken even at 144 fps. I have asked for
"click/interaction audio everywhere including the desktop UI" before and it has
never happened.

## C1 — AUDIT WHAT EXISTS

Before adding anything: what sounds does the game currently have, where do they
play from, and is there a mixer at all? Write the inventory down. I suspect it is
thin.

## C2 — THE INTERACTION LAYER

Everything the player touches makes a sound:
- Every UI click, hover, and confirm — including the laptop and the settings menu
- Register: key press, drawer, receipt, card beep, cash handling
- Ledger: pick up, open, page turn, close, set down
- Doors, drawers, boxes opening, items placed on the counter
- Picking up and putting down every tool

## C3 — THE TOOL LAYER

Each cleaning tool needs its own loop with start, sustain and stop — a broom
sweep is not a mop swish is not a vacuum. **Tie them to the actual motion**, not
to a key being held, so the sound follows the stroke.

## C4 — THE WORLD LAYER

Footsteps that change with surface. Room tone indoors, birds and wind outdoors,
weather when it rains. Customer presence — murmur, footsteps, the door chime when
someone enters. **Distance attenuation** so the shop sounds different from the
far corner.

## C5 — THE MIXER

Master, music, SFX, ambience, UI — separate sliders in settings, persisted. **No
sound may clip or stack into a mess** when five things happen at once.

**Acceptance for every one of these: a clip with audio that you have played
back.** A test asserting a sound fired is not evidence it sounds right.


BLOCK C ADDITION — I will not be recording audio. So:

Build every sound with Web Audio synthesis for now, and be honest in the report
about which ones synthesis serves well (UI clicks, register beeps, latches) and
which it does not (footsteps, cloth, ambience, crowd).

Then write Designs/ProShop/AUDIO_MANIFEST.md: every sound the game needs, by
exact filename, with duration and a one-line description, organised by layer.
Build the loader so dropping a real .wav at that path overrides the synth version
with no code change.

That way the system is finished tonight and the sound quality is a file swap
whenever I get round to it.
---

# BLOCK D — THE BACKLOG. Work top-down until the night ends.

These are things I have asked for that keep getting deferred. In priority order.

**D1 — AUTOSAVE EVERY ~5 MINUTES.** Asked for repeatedly. Not done.

**D2 — THE BAG AT CHECKOUT.** Items should physically enter the bag rather than
shrinking and vanishing. C1 was attempted four times and reverted; your own note
says the bag anchor needs re-authoring in `checkout/shopping_bag.glb`. Do that
first, then the placement.

**D3 — CASH AND CHANGE.** Cents included, realistic denominations, matching the
amount paid. Per-note hover outline in the drawer instead of the 25% white
smear. Change placed left of the monitor, items and cash right of the bag.

**D4 — THE STUCK-ITEM LIST.** Each of these has been reported and is still open:
- Price tags at checkout (reported done, still there — check again by playing)
- The second outdoor sign does not change state
- Combined buy-plus-tee-time visits are rare
- Tee-time check-in at the requested time does not work
- The laptop UI squeezes 32 times into 3 buttons
- The ceiling prompt still does not teach the repair

**D5 — THE LAPTOP'S FIRST OPEN.** You took it 3,583 ms → 290 ms on a warmed
boot; the first open in a fresh session is still slow. Measure that specific
case, attribute it, fix it or say why not.

**D6 — CHARACTER FAULTS.** Stomachs detach and pump while walking; eyebrows and
moustaches float in front of the face in profile. Both reported, both open.

---

## RULES

**Verify by playing, not by census.** Real input, sim live, no pins, no
teleports, on the population the player actually sees.

**Every acceptance ends with a clip or screenshot — or audio — that you have
actually looked at or listened to.**

**Watch every new check fail on a known-bad case first.**

**Park past twelve rounds** on any item and say why. **Cut anything that cannot
be made good** and say why.

Goldens and the one-pixel control after anything that renders. Suite green.
**Compact at 80% and carry on — do not stop, do not hand off.** Finish and push
what you are on before compacting.

In the morning: what landed, what is parked, what you cut, and anything you
decided without me. Do not tidy the failures out of it.