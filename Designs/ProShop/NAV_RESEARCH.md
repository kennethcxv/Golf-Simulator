# NAV_RESEARCH — how crowds are actually kept apart, and what mine does instead

Written 2026-08-17, before any code, against
`Designs/ProShop/NPC_Nav_Research_And_Rebuild.md`.

Your two absolutes are the whole brief: **never touch, never stuck.** Everything
below is aimed at whether a technique can *guarantee* either one, or only make it
less likely.

---

## 1. THE ONE IDEA THAT MATTERS: VELOCITY SPACE

Every system that genuinely prevents overlap does the same thing, and it is not
"push harder when they get close". It moves the decision **out of position space
and into velocity space.**

**The velocity obstacle.** For me (radius `ra`, at `pa`) and you (radius `rb`, at
`pb`), consider the set of *relative* velocities `v = va − vb` that would put our
discs in contact at some point in the next `τ` seconds. Geometrically that set is
a cone: apex at the origin, opening along the line between us, truncated by a
disc of radius `(ra+rb)/τ`. Any relative velocity **outside** that cone is
provably contact-free for `τ` seconds. Not "unlikely to collide" — cannot,
because contact requires the relative displacement `v·t` to bring the centres
within `ra+rb`, and every such `v` is inside the cone by construction.

That is the guarantee, and it is a geometric fact rather than a tuning outcome.
The whole engineering problem is choosing a velocity outside every neighbour's
cone while staying close to the one you wanted.

**Why "reciprocal".** If I treat you as a moving obstacle and dodge your whole
cone while you do the same to me, we each apply the full correction and swap
sides forever — the classic reciprocal dance. **RVO** (van den Berg 2008) fixes
it by having each agent take **half** the correction, assuming the other half
arrives from the other party. **ORCA** sharpens this: instead of a cone, each
neighbour contributes a single **half-plane** in my velocity space —
"your velocity must stay on this side of this line" — where the line is placed at
the half-way point of the minimum change `u` needed to leave the cone, with
normal along `u`. n neighbours give n half-planes. Their intersection is a convex
region of permitted velocities, and picking the point in it closest to my
preferred velocity is a **2-D linear program**, solvable exactly in O(n) expected
time by randomised incremental construction.

So ORCA's non-collision is a theorem with a proof, not a parameter:
*if every agent runs it with the same τ and every LP is feasible, no pair can
come into contact within τ.* ([UNC GAMMA / ORCA](https://gamma.cs.unc.edu/ORCA/),
[snape/RVO2](https://github.com/snape/RVO2))

**Where the guarantee lapses, precisely.** Two places, and both matter here:

1. **Infeasibility.** In tight spaces the half-planes can have empty
   intersection — there is *no* velocity that avoids everyone. The RVO2 library
   handles this by falling back to a **3-D linear program** that minimises the
   maximum constraint violation: "the least-bad velocity", chosen to penetrate
   the shallowest constraint by the smallest amount. This is where an ORCA crowd
   can still touch, and it is the case a shop doorway produces on purpose.
2. **Everyone must be running it.** A neighbour that does not reciprocate (the
   player, a pinned queuer) must be modelled as taking *zero* responsibility, so
   I take all of it. RVO2 does this by setting that agent's share to 1.

---

## 2. WHAT SHIPPED SYSTEMS ACTUALLY DO (and what they admit)

**Detour crowd (Recast).** Not ORCA. Mikko Mononen — who wrote Recast/Detour —
tried ORCA and published what went wrong: the half-plane construction commits to
**one side** of each obstacle and cannot revisit that choice. His words:
*"I cannot see how the method is able to choose good constraint planes by
selecting a single choice for each object"*, and *"that green plane messes things
up big time. Had the method chosen the other side of the obstacle, the case would
have had good solution"*, and *"even in slightly crowded scenes that kind of
problems occur a lot."*
([Digesting Duck](http://digestingduck.blogspot.com/2010/09/experimenting-with-orca.html))

So Detour uses **sampling-based velocity obstacles** instead: sample candidate
velocities on adaptive rings around the desired velocity, score each by time-to-
collision against neighbour discs *and navmesh boundary segments*, plus alignment
with desired and current velocity, and take the best. No guarantee — but no
infeasibility cliff either, and it can pick either side of an obstacle because
both sides are in the sample set. Its pipeline is worth copying verbatim in
order: **steering → separation → velocity planning → integrate → collision
resolution → corridor update.** Note that collision resolution (pushing
overlapping agents apart) is *last and is a cleanup*, not the mechanism.
([DeepWiki: DetourCrowd](https://deepwiki.com/recastnavigation/recastnavigation/4-detourcrowd:-agent-management-and-simulation),
[dtCrowdAgentParams](https://recastnav.com/structdtCrowdAgentParams.html))

Its `separationWeight` is a *steering* force, `weight = w · (1 − (d/range)²)`,
and `collisionQueryRange` is typically `radius × 8` — i.e. real systems look
**eight body radii** ahead for neighbours. Mine looks far less (§3).

**Unity NavMeshAgent.** RVO-family avoidance with a quality dial. Two facts from
the docs that bear directly on your complaint: at quality `None` *"agents will
not consider other agents as obstacles and simply walk through them, often
causing overlapping and pushing"*; and **avoidancePriority** means *"agents of
lower priority are ignored"* — a lower-priority agent will **push a
higher-priority one out of the way**, and randomised priorities produce exactly
the erratic shoving you describe. The documented remedy is to give every agent
that must avoid every other the **same** priority.
([Unity: obstacleAvoidanceType](https://docs.unity3d.com/530/Documentation/ScriptReference/NavMeshAgent-obstacleAvoidanceType.html),
[avoidancePriority](https://docs.unity3d.com/ScriptReference/AI.NavMeshAgent-avoidancePriority.html),
[NavMesh Agent manual](https://docs.unity3d.com/462/Documentation/Manual/class-NavMeshAgent.html))

**Planet Coaster** (10,000 guests). Not per-agent pathfinding at all: **flow
fields** computed from each goal outward — *"instead of computing a path from A
to B for each person, a path from each goal to all possible positions is
computed"* — with density and velocity fields for avoidance. Their deadlock
remedy is the honest one and worth knowing about: *"the longer guests are in
head-on collisions with other guests, the smaller their collision radius would
become until they could fit through the gaps."* **They trade a little clipping
for never-stuck.** At our scale we do not have to make that trade, but it names
the axis: in a bottleneck, *something* has to give — radius, or throughput.
([Game Developer deep dive](https://www.gamedeveloper.com/audio/game-design-deep-dive-creating-believable-crowds-in-i-planet-coaster-i-))

**Shop sims.** Supermarket Simulator ships Unity NavMeshAgent and its players
report *customers walking on top of each other* and NPCs stuck in pick
animations, on Steam, in a shipped and successful game. That is not permission to
be sloppy — it is evidence that "shop crowd that never touches" is genuinely
above the shipped bar, and that the default NavMeshAgent stack does not reach it
without work. ([Steam discussions](https://steamcommunity.com/app/2670630/discussions/0/4289187252715893601/))

**Reynolds steering** (separation/cohesion/arrival) is a *force* model: it sums
neighbour repulsions into an acceleration. It has no notion of "will we meet",
so it reacts to proximity rather than to a predicted contact, and its failure
mode is exactly the one my own code comments already name — opposing pushes in a
corridor sum to zero and walk the agent into the middle of the crowd. It is a
garnish on a velocity solver, never the mechanism.
([Reynolds' steering behaviours](https://slsdo.github.io/steering-behaviors/))

---

## 3. WHAT MY SYSTEM ACTUALLY DOES — AND WHY IT RUBS

Reading `src/render3d/clubhouse/crowd.js` and the walker loop in
`src/render3d/clubhouse.js` (~12420–12680, 11484–11585):

**It is two half-systems, and neither one is the guarantee.**

**(a) `avoidanceHeading` — a heuristic, not a solver.** It is genuinely
velocity-aware and reciprocal-flavoured: it computes time of closest approach and
takes half the correction. But then:

- **It reacts to ONE neighbour.** `crowd.js:97` picks `worst` by urgency and
  ignores every other. Its comment defends this as avoiding the boids
  cancellation problem — and against boids it is right — but the consequence is
  that avoiding the most urgent neighbour can steer straight into the second.
  ORCA's whole point is that *all* n constraints are satisfied simultaneously.
- **It bends a heading; it does not choose a feasible velocity.**
  `hx = ux·(1−bend) + px·bend + bx` with `bend = strength·shortfall`, strength
  0.85. There is no step that asks "is the resulting velocity actually outside
  the contact cone?" It is a nudge whose magnitude is a tuning constant.
- **The speed scaling is a separate, later heuristic** (`crowdSlow` 0.35/0.6 by
  urgency band, clubhouse.js:12452). Direction and speed are decided by two
  different rules that never see each other. In velocity space they are one
  decision.

**(b) `separate()` — a positional relaxation pass, and this is the rubbing.**
After every customer has moved, `settleCustomerCrowd()` collects the bodies and
runs 3 iterations of "if two are closer than `want`, move each half the overlap
out", then **writes the result straight into `mesh.position`**
(clubhouse.js:11525). `want = 0.31 + 0.31 + 0.16 = 0.78 yd`.

That is precisely the thing you identified. It lets the pair get too close and
then *displaces them*, every frame, at frame rate. The displacement is not
motion the character chose — no yaw change, no gait change, no anticipation — so
it reads exactly as bodies grinding and shoving. **The push is the artefact.**

And it fights the walker: the walker's goal-seeking pulls back toward the same
line the next frame, so the loop is push → walk back → push, sustained. Nothing
in `avoidanceHeading` knows the push happened.

**(c) The ladder is downstream of both.** Five rungs (sidestep/sidestep/nudge/
retarget/skip) on top of `stuckT`/`noProgressT`, plus arrival slack and a
doorway yield timer added last night. Every rung exists because an agent got
somewhere it should never have been able to get. Your read is correct: it is the
mask, not the fix.

**Verdict:** I have an RVO-*flavoured* steering nudge and a rigid position
solver. I do not have a collision-free velocity at any point in the pipeline.
There is no theorem anywhere in it — only constants.

---

## 4. WHY THE MEASUREMENT SAID ZERO AND YOU SAW CONTACT

Your suspicion was centre-versus-radii. It is not that — it is worse and simpler.

The detector (`crowdDiagnostics`, clubhouse.js:11532) does test radii:
`if (d < BODY_RADIUS * 2)`, i.e. **d < 0.62 yd**, which is the true touching
distance for two 0.31 yd bodies. But:

1. **The solver holds pairs at 0.78 yd and the detector only fires below 0.62.**
   The 0.16 yd `comfort` band is a region the solver actively treats as a
   violation and pushes out of, and the detector calls clean. Every push you see
   happens **inside a band the detector cannot report.**
2. **The detector measures the solver's RESIDUAL, not its ACTIVITY.** A rigid
   positional solve exists to drive the residual to zero — so "zero overlaps" is
   what a working `separate()` produces *by construction*, whether it shoved
   people twice or two thousand times. I measured the one number that is
   guaranteed to look good. The number that describes what you see is **how often
   and how hard a correction was applied**, and nothing has ever recorded it.
3. **The QA watch polled at ~10 Hz** while the game separates every frame. A
   contact that exists for three frames at 120 fps is invisible to a 10 Hz poll
   even when the threshold is right. The full-rate count already exists in the
   engine — `separate()` returns first-pass overlaps at the 0.78 threshold — and
   the driver read the polled 0.62 one instead.
4. Population was **not** the fault this time: both the detector and the solver
   read `customers` (the array `clubhouse.customers()` exposes), which B0 settled
   is the one you watch.

**So the definition has to change**, as you said. What I will count:
- **Contact** = any pair whose centre distance is under `2·BODY_RADIUS + visible
  margin`, evaluated **every frame inside the sim**, not polled.
- **Correction** = any frame on which the positional solver displaced anybody,
  with the displacement magnitude. This is the number that should be **zero** in
  a finished system, and it is the direct measurement of the rubbing.
- **Closest approach**, min over the session, so "how near did anyone ever get"
  is a single honest number rather than a threshold count.
- Its **negative control** is your instruction: place two agents on top of each
  other and watch it fire, plus place them a metre apart and watch it stay quiet.

---

## 5. THE APPROACH I AM TAKING, AND WHY

**ORCA as the core, in velocity space, with obstacles as constraints in the same
LP.** Reasons, in order of weight:

1. **You asked for a guarantee and only ORCA offers one.** Sampling (Detour)
   scores candidates and takes the best available; if every sample is bad it
   still returns one. ORCA's feasible region either contains a contact-free
   velocity or is provably empty — and knowing *which* is what lets me handle the
   empty case deliberately instead of discovering it as a shove.
2. **Mononen's objection is a density objection, and I have no density.** His
   trouble was crowded scenes where a committed half-plane picks the wrong side.
   This shop peaks at three or four customers plus the player. With n ≤ 8 the LP
   is a handful of half-planes, runs in microseconds in JS, and the wrong-side
   case is rare and recoverable — whereas his 200-agent case made it constant.
   I am taking his warning as the reason to keep a **side-preference bias** from
   the path direction, not as a reason to prefer sampling.
3. **It collapses direction and speed into one decision.** The `crowdSlow` band
   and the heading bend stop being two tuning constants that disagree; a slower
   velocity is simply a point in the feasible set, and "yielding" becomes an
   emergent, visible behaviour rather than a scripted timer. That is your
   "visibly anticipate and give way".
4. **Static geometry belongs in the same solve.** Detour's sampler already scores
   navmesh boundary segments alongside agents; ORCA takes segment obstacles as
   half-plane constraints natively. Solving walls and people together is what
   stops "dodge a person into a shelf", which is one of the ways the ladder earns
   its keep today.

**What I am explicitly NOT doing, and why:**
- **Not flow fields.** Planet Coaster's win is at 10,000 agents; at four it is
  all cost and no benefit, and its shrinking-radius deadlock fix trades away the
  exact absolute you set.
- **Not keeping `separate()` as a safety net.** A net under a guarantee is a way
  of never finding out the guarantee is false — and its pushes are the visible
  defect. It goes, and if things touch afterwards the solver is wrong and I want
  to see that.
- **Not tuning the existing ladder further.** Your instruction, and I agree with
  the reasoning.

**The two places I will add something beyond textbook ORCA**, both because the
theorem does not cover them:
- **Infeasibility is handled explicitly**, RVO2-style: when the half-planes have
  no common point, solve the 3-D "minimise the worst violation" program instead
  of returning an arbitrary velocity. This is the difference between a crowd that
  slows and shuffles in a jam and one that pops through each other.
- **The doorway gets a reservation, not a solver.** A door narrower than two
  agent diameters is *provably* infeasible for two agents heading opposite ways —
  no local method can fix it, and this is where every crowd system fails
  (your words, and the literature agrees). One agent holds the door, the other
  waits outside its mouth. That is not a patch on the solver; it is a
  higher-level traffic rule that the solver then satisfies trivially.

---

## 6. THIS IS BIGGER THAN ONE NIGHT. THE STAGES

Saying so up front, as you asked. Four stages; each ends somewhere the game is
playable and honest.

**Stage 1 — the measurement, and a "before" clip.** Full-rate contact counter,
correction-activity meter, closest-approach minimum, all inside the sim on
`customers`. Negative control: two agents placed on top of each other, watched
firing; and a clean-separation control watched staying quiet. Then a five-minute
clip of the shop **as it is now**, watched, so there is a real before to compare
against — and so I find out whether what you see is contact, correction, or both.

**Stage 2 — the ORCA core**, behind a flag, agents only (no static obstacles yet),
with the ladder and `separate()` still present but *instrumented* rather than
removed. Success is the correction meter falling toward zero on its own, which
proves the velocities are already contact-free before anything pushes.

**Stage 3 — obstacles into the LP, the doorway reservation, and the deletions.**
`separate()` and the ladder come out here, together, because leaving either one
in makes stage 4's clip meaningless.

**Stage 4 — the acceptance clip.** Five minutes, watched, against your five
criteria: zero contacts, zero stuck, visible giving way, single-file queue with
gaps, nobody grinding on the player in a doorway.

**Stage 1 tonight.** I will not write solver code before the detector can prove
itself on a broken case, because the entire reason this document exists is that
the last measurement was wrong.

---

## Sources

- [Optimal Reciprocal Collision Avoidance (ORCA), UNC GAMMA](https://gamma.cs.unc.edu/ORCA/)
- [snape/RVO2 — the reference C++ implementation](https://github.com/snape/RVO2)
- [Mikko Mononen, "Experimenting with ORCA" (Digesting Duck)](http://digestingduck.blogspot.com/2010/09/experimenting-with-orca.html)
- [DetourCrowd: agent management and simulation](https://deepwiki.com/recastnavigation/recastnavigation/4-detourcrowd:-agent-management-and-simulation)
- [dtCrowdAgentParams reference](https://recastnav.com/structdtCrowdAgentParams.html)
- [Unity — NavMeshAgent.obstacleAvoidanceType](https://docs.unity3d.com/530/Documentation/ScriptReference/NavMeshAgent-obstacleAvoidanceType.html)
- [Unity — NavMeshAgent.avoidancePriority](https://docs.unity3d.com/ScriptReference/AI.NavMeshAgent-avoidancePriority.html)
- [Unity — NavMesh Agent manual](https://docs.unity3d.com/462/Documentation/Manual/class-NavMeshAgent.html)
- [Game Design Deep Dive: believable crowds in Planet Coaster](https://www.gamedeveloper.com/audio/game-design-deep-dive-creating-believable-crowds-in-i-planet-coaster-i-)
- [Reynolds steering behaviours](https://slsdo.github.io/steering-behaviors/)
- [Supermarket Simulator — players reporting customers on top of each other](https://steamcommunity.com/app/2670630/discussions/0/4289187252715893601/)
