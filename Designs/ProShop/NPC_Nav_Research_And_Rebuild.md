# NPC NAVIGATION — RESEARCH IT PROPERLY, THEN REBUILD IT

The navigation is worse than before, not better. In play right now, **customers
touch and rub against each other constantly — every few seconds** — and they
still get stuck. Last night's numbers said escalations fell 354 → 2 and overlaps
were zero. **What I see disagrees, so the measurement is wrong or it is measuring
the wrong thing.**

Two absolute requirements. Everything below serves them:

- **NPCs must never touch or rub against each other.** Not brush past, not
  overlap, not grind. Ever.
- **NPCs must never get stuck.** Not for a second.

---

## PART 1 — RESEARCH FIRST. Do not write code yet.

You have written a lot of bespoke navigation logic — a recovery ladder, nudges,
retargets, skips, arrival slack, yield timers. **That accumulation is itself the
problem: it is a pile of patches, not a navigation system.** Every fix has added
another rung.

**Before touching anything, go and find out how this is actually solved.** Search
properly and read:

- **RVO2 and ORCA** (Reciprocal Velocity Obstacles / Optimal Reciprocal Collision
  Avoidance) — the standard for crowds that never overlap. Understand *why* it
  guarantees non-collision rather than reacting after the fact.
- **Detour crowd** (the crowd layer on top of Recast navmesh) — what agent radius,
  separation weight and local boundary actually do.
- **Unity's NavMeshAgent** and **Unreal's Detour crowd controller** — the exact
  parameters shipped games tune, and what each one prevents.
- **How simulator games specifically handle shop crowds**: Supermarket Simulator,
  TCG Card Shop Simulator, Two Point Hospital, Planet Coaster, The Sims. Queueing,
  aisle passing, door bottlenecks.
- **Steering behaviours** (Reynolds) — separation, cohesion, arrival — and where
  they fail without a velocity-space solver.

**Write what you learn to `Designs/ProShop/NAV_RESEARCH.md` before you write any
code**, and say which approach you are taking and why. I want to see the reasoning
before the implementation.

**The question to answer in that document:** why does a proper crowd solver
guarantee agents never overlap, and what is my current system doing instead?

---

## PART 2 — THE MEASUREMENT IS WRONG. Fix it before you trust it again.

Your watch reported **zero body overlaps** across five minutes. I see them every
few seconds. One of these is true.

Find out which. Likely candidates:

- **Overlap tested at body centres rather than radii.** Two agents 0.3 yd apart
  with a 0.25 yd radius each are visibly touching and centre-distance says fine.
- **10 Hz sampling missing contacts** that happen between samples.
- **Measured on the wrong population** — B0 settled that the player watches
  `clubhouse.customers()`, so confirm the overlap check reads that one.
- **Only counting hard interpenetration**, not the rubbing and brushing that is
  what I actually see.

**Then define it the way I see it:** any two agents whose bodies come within a
visible margin of each other, at full frame rate, counted as a violation.

**And prove the detector works** by placing two agents deliberately on top of each
other and watching it fire.

---

## PART 3 — REBUILD IT

Once the research says what to build:

**Local avoidance in velocity space, not position correction.** The current system
lets agents collide and then pushes them apart — that push *is* the rubbing.
A proper solver has each agent pick a velocity that cannot collide within the next
few seconds. **Agents should visibly anticipate and give way.**

**A real navmesh from actual collision geometry**, not hand-authored waypoints.
Regenerated when the layout changes.

**And then delete the ladder.** The nudge/retarget/skip escalation exists because
agents get stuck. **If the solver is right, nothing gets stuck and the ladder has
nothing to do.** Keeping it means keeping the thing that masks failures. If you
cannot delete it, that means the solver is not right yet.

**Doors and bottlenecks need explicit handling** — a single-file door is where
every crowd system fails, and yielding there is correct behaviour, not a patch.

---

## HOW I WILL JUDGE IT

**A five-minute clip of the shop with people in it, which you have watched.**

- Zero contacts between agents
- Zero stuck agents
- Agents visibly giving way, not bumping and correcting
- Queue single-file with gaps
- Nobody grinding on the player in a doorway

**Numbers are not the acceptance. The clip is.** Three probes on this project have
reported clean on things I could see were broken by looking, and this is the
fourth.

---

## RULES

**Research before code.** I want `NAV_RESEARCH.md` first.

**Verify by watching, not by counting.** Then use counts to confirm what you saw.

**Watch every detector fail on a deliberately broken case first.**

**Read `npm run gate`'s real exit code** — `| tail` masked a failing suite twice.

**If the rebuild is bigger than one night, say so and land it in stages** — but do
not patch the old system further. It has had enough rungs.

Compact at 80% and carry on.