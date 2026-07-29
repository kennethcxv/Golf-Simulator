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
Whether the 1× regime (visits complete, crowds thin) reproduces pins of that
length is exactly what the 1× airtight re-run measures — if it does, the gate
is now honest enough to say so.

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
