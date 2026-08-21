# THE NPCs — NAVIGATION AND BEHAVIOUR, REBUILT

The performance work is done for now. This is the next thing, and it is a big one.

My customers do not behave like people. They run into each other, they run into
walls, they walk into the counter and the boxes, they queue shoulder-to-shoulder
sideways instead of in a line, and at checkout they all leave together. Every
other simulator on the market solves this. Mine has to as well.

**Read the history before you start.** This has been reported across at least
five sessions — "NPCs still run continuously into a box at the top left", the
1-second stuck rule that shipped and did not hold, the sideways queue, and the
check-in screen showing AT DESK and IN QUEUE for people who had left. Some of
those were fixed against a population the player never sees (see below).

---

## PART 0 — THE TWO-POPULATIONS TRAP. Read this first or you will repeat it.

`sim/customerSimulation.js` keeps `active`. The clubhouse renderer keeps its own
organic visitors via `clubhouse.customers()`. **The tests and every prior check
read the first; the player watches the second.** A check pointed at the wrong one
passes while the shop disproves it — that is the documented root cause of
"verified but observably false" on this project.

Before you touch anything: establish which population drives the visible
customers, and make every instrument in this goal read THAT one. Say in the
report which you measured.

**And screenshot everything.** Three separate probes have reported clean on
things I could see were broken by looking. Every acceptance in this goal ends
with a picture or a clip.

---

## PART 1 — NAVIGATION. They must not walk into things.

Right now they walk into walls, boxes, the counter and each other. That is not a
tuning problem; it is missing pathfinding.

- **Build a real navigation representation** — a navmesh or a grid, generated
  from the actual collision geometry rather than hand-authored, so a new fixture
  or a dropped box changes the paths automatically. Anything hand-listed will go
  stale the first time the layout moves, and this codebase has been bitten by
  hand-written lists three times.
- **Local avoidance between agents** so two customers crossing the same aisle
  give way instead of grinding through each other. Steering, not collision
  response — I should see them anticipate, not bump and correct.
- **Dynamic obstacles.** Delivery boxes on the floor, the hand truck, the player
  standing in a doorway. They must path around me, not through me and not into a
  wall trying.
- **A stuck detector that actually works.** One shipped before and did not hold.
  Watch it fail on a deliberately blocked agent before you trust it.

**Acceptance: a five-minute clip of a busy shop with zero wall penetrations, zero
agent-agent overlaps, and zero stuck agents.** Not a count from a probe — the
clip, and you watch it.

---

## PART 2 — THE QUEUE. It forms sideways and empties all at once.

- **Single file, running back from the desk**, each person holding a slot with a
  natural gap — not shoulder to shoulder.
- **They advance when the person ahead moves**, and the slots re-flow when
  someone leaves the middle.
- **They do not all leave together.** Whatever is causing the mass exodus at
  checkout, find it and fix it. That is one bug, not emergent behaviour.
- Someone joining the back should walk to the back, not teleport into the shape.

---

## PART 3 — THEY SHOULD READ AS PEOPLE, NOT AGENTS.

This is the part that separates a good simulator from a cheap one. What I want,
roughly in order of how much it will show:

- **Individual pace and idle behaviour.** Not everyone walks at the same speed or
  stands identically. Small differences read as different people.
- **They look at what they are doing** — the shelf they are browsing, the person
  they are queued behind, the player when spoken to.
- **Browsing that looks like browsing.** Pause, look, consider, pick up or move
  on. Not a straight line to a shelf and a straight line out.
- **Personal space.** They do not stand inside each other or inside me.
- **Natural entrances and exits** — through the door, at their own pace, not
  spawning into position or vanishing.

Reference the games I have compared this to: TCG Card Shop Simulator, PowerWash
Simulator, House Flipper, Supermarket Simulator. Watch what their crowds actually
do and match that standard.

---

## PART 4 — THE LAPTOP, STILL SLOW ON FIRST OPEN

You took it from 3,583 ms to 290 ms bar-to-usable on a warmed boot by warming the
laptop close-up view. The first open in a fresh session is still slow. Measure
that specific case — cold profile, first ever open — and attribute it the way you
attributed the rest: arrivals, uploads, or main thread. Then fix it or tell me
why it cannot move.

---

## RULES

**Verify by playing, not by census.** Real input, sim live, no pins, no
teleports, on the population the player actually sees.

**Every acceptance ends with a clip or a screenshot that you have looked at.**

**Watch every new check fail on a known-bad case before you trust it.**

**Park past twelve rounds** on any one item and say why.

Goldens and the one-pixel control after anything that renders. Suite green.
Compact at 80% and carry on.