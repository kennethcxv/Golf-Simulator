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
10:00, restored resized room, 10 scripted spawns + measured organic arrivals,
fresh boot per leg — `Greybox/data/speed-curve.json`):

> _Numbers land with the speed-curve run queued behind today's validation
> chain; this section is filled from `speed-curve.json` the same day._

**Suspected-fix directions (for the future ruling, not begun):** scale
`clubhouseApi.update`'s dt by the speed multiplier (full sim-time parity —
changes walk speed perception at 16×); or scale only decision/dwell/arrival
cadences while keeping locomotion wall-rate (visual sanity, partial parity);
or redefine 16× as "cinematic fast-forward" and gate economy fairness
elsewhere. Each changes what a "day" yields; none is obviously right without
design intent.

**Unblocks:** the wall-vs-sim clock ruling flagged in
`OVERNIGHT_REPORT.md` §1 (still open).
