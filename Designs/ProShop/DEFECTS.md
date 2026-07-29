# DEFECTS.md — named, evidenced, undecided-by-design

Defects logged with mechanism and evidence but deliberately NOT fixed, each
awaiting an explicit ruling. Nothing in this file is forgotten work; each entry
names what unblocks it.

---

## SIM-TIME-001 — NPC life is wall-clock-bound; game speed compresses only the clock

**Status:** OPEN — quantified 2026-07-28 (per the ruling: "quantify, do not fix
yet"). Fix gated on a design decision about what game speed *means* for the
shop simulation.

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

**Suspected-fix directions (for the future ruling, not begun):** scale
`clubhouseApi.update`'s dt by the speed multiplier (full sim-time parity —
changes walk speed perception at 16×); or scale only decision/dwell/arrival
cadences while keeping locomotion wall-rate (visual sanity, partial parity);
or redefine 16× as "cinematic fast-forward" and gate economy fairness
elsewhere. Each changes what a "day" yields; none is obviously right without
design intent.

**Unblocks:** the wall-vs-sim clock ruling flagged in
`OVERNIGHT_REPORT.md` §1 (still open).

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
