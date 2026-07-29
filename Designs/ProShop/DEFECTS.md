# DEFECTS.md — named, evidenced, undecided-by-design

Defects logged with mechanism and evidence but deliberately NOT fixed, each
awaiting an explicit ruling. Nothing in this file is forgotten work; each entry
names what unblocks it.

---

## SIM-TIME-001 — NPC life is wall-clock-bound; game speed compresses only the clock

**Status:** OPEN — direction RULED 2026-07-28; fix scheduled **before Phase 7
integration**, not now. The agreed shape is recorded below so it is not
re-litigated. Standing consequence, effective immediately: **every NPC
verification runs at 1× only** — a 16× green means nothing for NPC claims;
runs above 1× are stress regimes and must be tagged as such.

**Symptom:** shop throughput per game day FALLS as game speed rises. A player
at 16× is penalised against a player at 1×: customers complete fewer visits
(and at high speed, near none) per game hour, queues at close are structural,
and every high-speed "day" measurement understates what a 1× player
experiences.

**Mechanism (all verified in source):**

- `courseScene.js:9651` — `clubhouseApi.update(dtMs)` receives **raw wall
  dt**. Everything inside the clubhouse loop (walker locomotion, door
  animation, browse dwell, checkout choreography) advances at wall rate at
  every speed.
- `src/sim/time.js:18` — the clock advances `gameMinutes` scaled by
  `BALANCE.speeds[app.speedIdx]` (`[0, 1, 4, 16]`, `src/sim/balance.js:57`).
  Speed multiplies the CLOCK only.
- `clubhouse.js:9594` — organic walk-in arrival is `Math.random() < dt * 0.15`
  per wall-second (occupancy-capped), gated by clock-derived open hours
  (minute 360–1200). Arrivals per WALL second are speed-invariant → arrivals
  per GAME hour shrink ∝ 1/speed.
- Reservation parties (`updateArrivals`, clubhouse.js:9588) materialize on
  clock-due tee times → at 16× they arrive 16× faster per wall second while
  walking at 1× — the pile-up direction.
- Patience is authored in real minutes (~10) — a further wall-bound quantity.

**Consequences for evidence:** every full-day NPC measurement in
`Designs/ProShop/Greybox/data/` before 2026-07-28 ran at 16× and therefore
represents a compressed, arrival-starved, completion-starved day — valid for
trap-geometry claims (blocks, freezes, collision), NOT for throughput,
queue-length, or day-shape claims. Recorded in each result as
`limitations.customersMoveInWallTime`.

**Measured curve** (`tools/qa/proshop-speed-curve.js`, 60 game-minutes from
10:00, restored fully-sealed room, 10 scripted spawns + measured organic
arrivals, fresh boot per leg, run EXCLUSIVELY — `Greybox/data/speed-curve.json`,
`ok: true`; an earlier orphan run with the same shape is superseded per
QA-LOCK-001):

| Game speed | Wall-time for the hour | Organic arrivals | **Visits completed** | Browse stops advanced | Queue peak | Nav blocks | Still mid-visit at window end |
|---|---|---|---|---|---|---|---|
| 16× | 114 s | 0 | **0 of 10** | 39 | 6 | 49 | **10** |
| 4× | 450 s | 1 | **0 of 11** | 49 | 9 | 227 | **11** |
| 1× | 1800 s | 1 | **10 of 11** | 70 | 8 | 505 | **1** |

The same game hour: at 1× the shop flows (ten visits complete, one customer
legitimately mid-visit at the bell); at 4× and 16× **nobody finishes a visit**
— the entire population is still mid-loop when the hour ends, and organic
arrivals barely exist (the occupancy cap plus wall-rate arrival rolls starve
them). Block events scale with WALL time, not game time (49 → 227 → 505 as
wall exposure grows 16×), i.e. per game-minute the 1× shop generates ~10× the
pathing work the 16× shop does — every 16× measurement under-samples the
actors' real interaction density.

**Which prior day-run conclusions survive at 1×:**

- **Survive** — every geometric/trap claim: what blocks, where, collision and
  recovery behaviour, the corridor-leak class, stand-point deliverability.
  These are wall-rate actor phenomena and position facts; the 1× leg
  reproduces the same churn classes at the same places (member-stand
  adjacency, leavers threading the queue head — and one wing-pocket wanderer,
  the last sub-capsule seam, logged for the next seam fill).
- **Survive** — the resize/re-pitch verdicts: at 1× the room WORKS (10/11
  visits complete, queue advances to peak 8 and drains, zero queue
  violations). The trustworthiness stop-condition did NOT trigger — 1×
  vindicates the room; 16× was the stress case.
- **Do NOT survive as real-play claims** — every 16× throughput, queue-length,
  still-inside-at-close and "day shape" figure: those describe the compressed
  day (visits spanning multiple game-hours, closes landing mid-visit), not
  what a 1× player experiences. They remain valid as the stress-test regime
  they accidentally were.

**RULED fix shape (2026-07-28 — agreed, do not re-litigate):**

- NPC **decisions** — dwell, browse duration, arrival rolls, transaction
  time — scale with the **game clock**.
- NPC **locomotion** stays **wall-rate but capped at roughly 4×**.
- **Full dt scaling is rejected**: at 16× it would move bodies fast enough to
  tunnel collision — the exact class the corridor seals just closed.
- **Schedule:** the fix lands **before Phase 7 integration**, not now. Phase 4
  does not depend on NPC throughput, and the layout is validated at 1× where
  it matters.

(The other directions considered — full dt parity, or redefining 16× as pure
cinematic fast-forward — are rejected by this ruling and stay here only as
history.)

**Unblocks:** nothing — the direction is settled; the remaining work is the
Phase-7-gated implementation.

---

## NAV-CHURN-001 — crowd churn under a full house: accepted as designed pressure, gated by threshold

**Status:** RULED 2026-07-28. Not a defect to fix — a designed signal with a
red line. Recorded here so the gate's shape is not re-litigated.

**The ruling (operative lines):** "Eleven customers in 70 m² with nobody
serving should jam. That pressure is what makes hiring a cashier feel
necessary, so it stays. Do not exempt the class — that kills the signal.
Convert the gate to a threshold: fail if any single block exceeds 20 seconds,
or if the recovery rate drops below a floor you propose and justify. A genuine
trap must still turn the gate red."

**The gate (implemented in `tools/qa/proshop-greybox-customer-day.js`):**

- A **block episode** opens when a walker nets < 0.15 yd across a
  12-wall-second window while not at a stop and not queued, and stays open
  until the walker gets ≥ 0.60 yd from the episode anchor (a real escape —
  two body radii past shove jitter), arrives, joins the queue, or leaves.
  Episode time includes the 12-s detection lag (stillness began at window
  start). Slow-creep pins cannot reset the clock by drifting between windows.
- **RED: any single episode > 20 wall-seconds** (the ruled cap).
- **RED: recovery rate below the floor — with ≥ 4 episodes in a leg, at least
  75% must clear within 15 wall-seconds of onset.** Justification: 15 s is
  the recovery ladder's own design budget (12-s detection window + one ladder
  cycle — the constraint the instrument has always documented); an episode
  past 15 s means the ladder's first cycle failed and a second was needed.
  That should be the exception (≤ 1 in 4) in a working room; a room where
  most blocks need multiple ladder cycles is drifting toward trap country
  even if no single block hits 20 s. Below 4 episodes the cap alone governs —
  a proportion over 1–3 samples is noise.
- All thresholds are **wall units at every game speed** — locomotion is
  wall-rate (SIM-TIME-001), so a block is a wall-time phenomenon.
- Short jam churn under a full house stays **GREEN by design** — reported
  (count, p50/p95/max durations, positions) but not failed. Counter-class
  waiters still inside at close (in queue / counter stop / waiting / paying)
  are likewise the designed no-cashier signal: reported, not failed.

**Every genuine-trap class still turns the gate red:** a pinned walker trips
the 20-s cap; systemic ladder thrash trips the recovery floor; a queue that
outlives patience trips the 12-wall-minute queue bound; a geometry leak trips
the new containment assertion (no customer center in the staff corridor, east
of the public bound, or inside a sealed slab — rects derived from the live
layout); a large-loop pacer still inside at close is outside the
counter-waiter class and fails.

**Instrument correction this ruling forced into the open:** the residual class
was previously described as "12-second recovering churn". That was an artifact
of the old instrument — its per-customer record kept only the worst 12-s
*detection window*, so every block read as ~12 s regardless of true length.
requeue3's own nav-block log shows visitor:4 and visitor:8 at fixed
coordinates near member_station from game-minute ~754 to ~873 at 16× (~7.5
continuous wall-minutes) before the crowd shifted and both completed their
visits. Under the episode instrument that is one episode far over the cap.

**Measured at 1× on the sealed room (2026-07-28, the airtight re-run —
`greybox-customer-day-airtight1x-{neglected,restored}.json`, 60 game-min peak
window, full house, exclusive):**

| Leg | Episodes | Over 20 s cap | Max | p50 | Recovery ≤15 s | Containment | Queue | Verdict |
|---|---|---|---|---|---|---|---|---|
| neglected | 95 | **43** | 93.6 s | 17.8 s | 27% | **0** | 0 | **RED** (cap + floor) |
| restored | 82 | **41** | 75.3 s | 20.1 s | 17% | **0** | 0 | **RED** (cap + floor) |

The airtight claim itself is **confirmed** — zero containment violations,
zero queue violations, every episode cleared organically (none active at
window end), all visits completed or legitimately mid-visit. The red is
entirely the churn class, honestly measured for the first time: **90/95 and
79/82 episodes are the member_station stand crowd** — customers stacked in
the approach band (lx 2.0–4.5, lz 1.3–2.6) waiting for one browse stand with
no wait behaviour, shoving and ladder-sidestepping for 20–90 s until the
stand frees. p50 ≈ 18–20 s means these are not ladder failures (the ladder's
15-s budget was never going to resolve "the stand is occupied"); they are
wait-your-turn dynamics with nowhere to put the waiting.

**Decision — RESOLVED 2026-07-28 (the walk-through's second ruling):** "the
member_station stack is a missing feature, not a threshold problem. Log it as
a named defect — NPCs have nowhere to wait for an occupied browse stand — then
exempt only episodes attributable to that defect, tagged with its ID, with the
exemption expiring when the defect is fixed. Every other class stays under the
20s cap and the 75% recovery floor."

So the cap and the floor are **unchanged**. What changed is that the gate now
*attributes* each episode, and the single class attributable to
**NAV-WAIT-001** (below) is exempted from the cap and excluded from the floor's
denominator — tagged with that defect ID in the report so the exemption is
never silent.

**The exemption expires automatically.** `DEFECT_EXEMPTIONS` in the harness
keys the waiver to `NAV-WAIT-001` with `expiresWhenFixed: true`. When that
defect's status here changes from OPEN, the waiver must be deleted in the same
commit — `tests/proshop-churn-exemption.test.js` fails if this file and the
harness disagree, in either direction. The exemption cannot outlive the defect
by accident.

---

## NAV-WAIT-001 — NPCs have nowhere to wait for an occupied browse stand

**Status:** OPEN. Named 2026-07-28 by the walk-through ruling on NAV-CHURN-001.
A **missing feature**, not a threshold problem and not a nav bug.

**The defect.** A browse stand serves one customer at a time. A customer whose
chosen stand is occupied has no wait state to enter: it keeps its stand point
as its goal and keeps walking at it. The result is a stack of bodies in the
approach band shoving each other and sidestepping off the recovery ladder until
the stand frees. There is no queue, no spaced hold point, no "come back later" —
the waiting has nowhere to go, so it happens on top of the stand.

**Measured signature** (1×, 60-game-min peak window, full house, both legs —
`Greybox/data/greybox-customer-day-airtight1x-*.json`):

- **90 of 95** neglected-leg episodes and **79 of 82** restored-leg episodes are
  this class.
- Approach band `lx 2.0–4.5, lz 1.3–2.6` at `member_station`.
- Durations 20–90 s, **p50 ≈ 18–20 s**. The p50 is the tell: the recovery
  ladder's budget is 15 s, and no number of ladder cycles resolves "the stand is
  occupied". These are wait-your-turn dynamics being handled by collision.

**Why it is not the recovery ladder's problem.** The ladder exists to free a
walker that is *stuck*. These walkers are not stuck — their goal is simply not
available yet. Escalating them (sidestep, nudge, retarget) is the wrong verb,
and the sidestepping is what makes the stack look like thrash.

**Gate treatment while open.** Episodes attributable to this defect are tagged
`NAV-WAIT-001` in the customer-day report and exempted from the 20-s cap and the
recovery floor's denominator. **Attribution is narrow on purpose** — an episode
qualifies only if the walker was heading for a stand, stalled inside that
stand's approach (> 0.22 and ≤ 2.60 yd from it — near it, not at it, not across
the room), and another body held the stand for ≥ 90% of the episode. Anything
else — a pin against geometry, a queue overrun, a containment breach — is
untagged and still fails. Waived episodes are always printed with their count,
durations, fixtures and the defect ID; the waiver is never silent.

**The exemption expires with the defect.** When this entry leaves OPEN,
`DEFECT_EXEMPTIONS` in `tools/qa/proshop-greybox-customer-day.js` must lose its
`NAV-WAIT-001` waiver in the same commit. `tests/proshop-churn-exemption.test.js`
enforces the pairing in both directions, so a fix that forgets the waiver turns
the suite red instead of quietly keeping a dead exemption alive.

**Fix shape (unscheduled — sim work, explicitly out of scope for the blocker
session):** a stand needs an occupancy claim and a small ring of spaced wait
points. A customer that finds its stand claimed either holds at a wait point
facing the stand, or re-picks a different destination and returns. The
acceptance signal is that this class disappears from the episode log rather than
being exempted from it.

---

## NAV-PUSH-001 — the recovery ladder cannot see a walker that is sliding

**Status:** OPEN — diagnosed 2026-07-28 (Blocker 9). **Not fixed in that
session**: the ruling was "report why it did not fire — that answer matters more
than the fix", and NPC behaviour tuning was explicitly out of scope.

**Reported symptom:** customers stall against the player or an object and keep
pushing forward indefinitely instead of repathing.

**Why the ladder does not fire.** Three separate reasons, all in
`clubhouse.js:9944-9987`, and all of them are about the ladder's *inputs*, not
its rungs:

1. **`moved` is displacement, not progress.** The trigger compares the distance
   the walker actually covered against the step it wanted. A walker pushed
   sideways around an obstacle covers its full step every frame while getting no
   closer to its waypoint, so `moved > step * 0.6` resets the timer forever.
   The player's collider makes this the *normal* case rather than an edge case:
   `resolveCustomer` (clubhouse.js:9531) does not slide a walker along the
   player, it projects them radially onto a 0.72-yd circle — a purely tangential
   displacement that reads to the ladder as healthy walking.
2. **There is a dead band between the two thresholds.** The timer accumulates
   only below `step * 0.25` and resets only above `step * 0.6`. Between those,
   neither branch runs: `stuckT` is frozen, so a walker grinding along at a
   third of its speed is invisible to the ladder indefinitely — it is neither
   stuck nor recovering, by construction.
3. **The player is not in the nav grid.** `navFresh()` rebuilds from
   `custCols` (static colliders) only; the player is applied afterwards, inside
   collision resolution. So even when a repath *does* fire, the grid believes
   the player's cell is open and returns the same line through them. The one
   rung that could help — rung 3's nudge to the nearest grid-open cell — is
   consulting a map that does not contain the obstacle.

**Measured live at 1×** (`Greybox/data/npc-block-diagnosis.json`,
`tools/qa/proshop-npc-block-diagnosis.js`, 40 wall-seconds, player planted on
the walker's line to its stop):

| | |
|---|---|
| max `stuckT` reached | **1.88 s** (repath threshold 1.2 s — fired once) |
| max escalation rung | **0** (rung 1 needs 3.0 s) |
| frames within one body length | 18 |
| net progress toward the stop | **+8.99 yd — it arrived** |

**What this run does NOT show, stated plainly:** a single blocker on open floor
does not trap anyone. The walker slid around the 0.72-yd push circle, repathed
once, and completed its stop. So the indefinite push the walk reported needs
*confinement* — a doorway, a corridor mouth, a fixture gap — where sliding
around is not available and reason 2's dead band keeps the timer frozen. That
repro is not yet captured, and the fix should not be designed until it is.

**Do not fix reasons 1-3 by lowering the thresholds.** The correct signal is
*progress toward the current waypoint*, not displacement; a walker circling an
obstacle at full speed is exactly the case the current test calls healthy.

---

## TILL-REACH-001 — the staff side of the front desk is a sealed box

**Status: OPEN.** Diagnosed 2026-07-29, not fixed: the fix is a change to the
approved v2 floor plan and is a design decision, not a repair.

Reported on the walk as two complaints — "the staff side renders black" and "the
only way in is standing backward on the wrong side and phasing through". They
are one defect. Measured by `tools/qa/proshop-cashier-station-diagnosis.js`
(`Greybox/data/cashier-station-pine-hills-v2.json`).

**The staff area is enclosed on all four sides.** A flood fill from the middle of
the public floor across walkable cells reaches 1479 of 1530 free cells in the
room. The staff pocket is in the other 51: free floor, no route to it.

| what | collider, building-local |
|---|---|
| desk front run, north side | x 0.90 → 5.70, z 2.84 → 3.86 |
| desk return, west end | x 0.90 → 1.98, z 3.66 → 5.25 |
| east end | the desk run reaches x 5.70, which IS `PUBLIC_ROOM_BOUNDS.maxX` |
| south | the exterior wall |
| the staff standing spot itself | office chair, 0.72 × 0.72 at x 1.94 → 2.66, z 4.04 → 4.76 |

`FRONT_DESK_COLLIDERS.returnRun` carries the comment "closes the east/reception
end of the work area". In v2 it closes the WEST end, and the front run reaches
the east wall, so both ends are shut. There is no gate, no flap and no gap.

A clutter pile seeded at (0.96, 4.88) sits in what would otherwise be the only
remaining approach. The clearway clamp added the same day protects the two
doorways and knows nothing about this route.

**"Renders black" is a consequence, not a separate bug.** From a legal pose the
staff side measures mean luma **102.1** against **99.87** for the customer side
of the same counter under identical conditions — a ratio of 1.02. It is not
dark. What the walk saw was the camera inside the desk collider after phasing
through, which is the inside of the counter.

**The decision.** Opening the run needs one of:

1. **Shorten the front run at the east end** to leave a body-width gap between
   the counter and the east wall. Needs ≥ 0.68 yd; the run currently ends
   exactly on the room bound, so this shortens the counter.
2. **Shorten `returnStaffExtent`** so the west end opens between the return and
   the south wall. The return spans z 3.66 → 5.25 and the wall is at ~5.40, so
   this also needs the clutter spot at (0.95, 4.90) moved.
3. **A hinged counter flap** — a section of the front run whose collider is
   removed while the player is behind it. Most faithful to a real pro shop and
   the most work.

Whichever is chosen, the office chair's collider has to stop occupying the one
spot a cashier stands, or the pocket is reachable and still unusable.

---

## QA-LOCK-001 — concurrent QA chains ran despite the run lock; kills don't kill trees

**Status:** OPEN — observed 2026-07-28 during the remediation session; needs a
dedicated repro before a fix is designed.

**Observed facts (all from chain output timestamps in the session logs):**

1. `TaskStop` on a background QA chain (git-bash on Windows) did **not** stop
   it: chain 1 was "stopped" at ~14:00 and demonstrably ran its remaining nine
   steps to completion, finishing an 83-minute speed-curve at 15:39. A second
   "stopped" chain kept running its speed-curve step until explicitly
   `taskkill /T /F`'d. Killing the shell does not kill the runner tree.
2. Two `run-playwright.cjs` processes ran **concurrently**: chain-1's
   `starter-loop-acceptance` (14:05:56–14:16:24) executed inside chain-2's
   `proshop-greybox-customer-day` window (~14:06–14:56), even though `main()`
   acquires the run lock unconditionally. The same lock demonstrably DID
   serialize later (laptop-persist waited 39 minutes on the speed-curve).
   Mechanism unconfirmed — candidates: the stale-owner unlink/acquire path
   racing, `processAlive` misreading a PID, or an environment-specific lock
   path divergence.

**Consequences already handled:** every wall-clock-sensitive result captured in
the overlap window was declared tainted and re-run exclusively (see
HARNESS_REMEDIATION.md §F). Standing rules 14–15 added to HARNESS_TRUST.md.

**Unblocks:** a small repro harness (two deliberate concurrent runners +
lock-state logging) before hardening (acquire re-verification, mtime-based
staleness, or rename-based acquire).
