# VERIFIER 1 — Goal 20 adversarial verification (2026-08-10)

Mandate: DISPROVE five claims. Real input via the freeplay bridge
(`qa/electron/verifier1/`), default player camera, screenshots looked at
with my own eyes. No `src/` read, no reports read.

Concessions used (allowlisted, recorded here as required):
- `{"cmd":"qa","script":"inside"}` before claim 2 (teleport into shop,
  business open, organic walk-ins on) — a fresh save cannot pass the
  locked doors.
- `{"cmd":"qa","script":"sale"}` before claim 5 (stages the canonical
  3-item card sale).

Session: `node tools/qa/run-electron.cjs tools/qa/electron-freeplay-bridge.js
--clubhouse=pine-hills-v2 --user-data-dir=.../verifier1-profile`,
`QA_FREEPLAY_DIR=qa/electron/verifier1`. Fresh profile (Continue was
disabled, "No Continue save yet" — shot-000). New game -> Realistic.

## Claim 1 — "A QA run never captures the machine's cursor"

- Negative control (BEFORE my game was driven): 5s watch at 20 Hz ->
  `qa/electron/verifier1-pre/watch-control.jsonl`. 79 samples, ALL
  `showing:1, clipFree:1`, clip `[0,0,6400,2160]`. Instrument can say
  "free". CAVEAT: five GOLF EMPIRE windows from parallel sessions were
  already open (idle, undriven) — a zero-Electron control was not
  possible without killing other agents' work.
- Live watch during driven session: 60s at 20 Hz ->
  `qa/electron/verifier1/watch.jsonl`. **813/813 samples `showing:1,
  clipFree:1`**, clip always `[0,0,6400,2160]` (full desktop). Watch window
  1786416569799..1786416629645; driven shots 004-024 span
  1786416572803..1786416629187 — fully inside the window. Input driven
  during the watch: click-to-look, 8 sweeps, 8 WASD keyholds, 2 clicks.
- Sweep camera-turn check: shot-004 (facing shop doors head-on) vs
  shot-005 after `sweep dx=25 n=20` — view rotated right ~60 deg (sunrise,
  shed, PINE HILLS MUNICIPAL sign now in frame). shot-016 shows the player
  walked into the grounds mid-window. The cursor freedom was NOT bought by
  breaking the camera.
- VERDICT: **CONFIRMED** (0 captured samples in 813 while genuinely driven;
  camera demonstrably turns).

## Claim 2 — mop yarn simulated (trail / whip / spread / still-when-still)

Equipped via tool-belt radial (hold F -> labelled radial, shot-028; "3 M
Mop"; pressed M -> shot-031, mop in hands, "Mop dry - use the bucket in
the cleaning bay").

- Still test (no input, ~1.3s apart, shot-040 vs shot-042, pixel diff
  with `regiondiff.mjs`, threshold 8): world geometry regions 0 px
  changed (meanAbs 0.01-0.2 — renderer pixel-stable). Yarn region 46.9%
  px changed — but hands 37.4%, shaft 30.3%, knob 61%: the WHOLE
  viewmodel idle-sways; the yarn rides the swaying head coherently.
  There is no yarn-only shimmer on a frozen mop, and the game never
  presents a truly still head to test "perfectly still" literally
  (idle sway is constant; NPC positive control 19.5%).
- Trail: strafe left 1.5s -> shot-043 ~120ms after release: yarn mass
  strongly displaced sideways, strands fanned and streaming — nothing
  like the settled skirt.
- Whip: immediate reverse strafe right 1.5s -> shot-044: yarn flung to
  the LEFT of the head (trailing behind the rightward move / whipping
  through the reversal).
- Spread: camera pitched down puts the head at the floor; after 2.5s+
  rest (shot-046) the yarn is SPLAYED RADIALLY in a disc on the carpet —
  vs the compact hanging skirt when the head hovers (shot-038/040).
  Resting diffs (045 vs 046): yarn 39.3%, hands 22.5%, world 0% — motion
  scale consistent with a pendulum riding idle sway.
- Player judgment: it reads as a real string mop (wrapped grip, ferrule,
  long yarn that hangs, swings, whips, splays).
- VERDICT: **CONFIRMED** (with the honest caveat that "perfectly still"
  is unobservable — the held viewmodel never stops idle-swaying, and the
  yarn shows no independent jitter beyond it).

## Claim 3 — IN QUEUE means physically in line; Asks <time> only AT DESK

Observed the desk screen through two full servings with customers around:

- shot-055: physical line photographed — three customers single file
  (red = Silas Emery, white-cap, black shirt). Desk prompt named the
  at-desk person: "help Silas Emery choose a walk-in tee time".
- shot-061 (CHECK IN open): ONE row — "Silas Emery / Asks 12:30 PM /
  Party 4 / AT DESK". He was physically at the desk in front of me. The
  other two in line had no rows (shoppers; header said "1 walk-in tee
  requests are active").
- shot-064: second row appeared — "Yolanda Ostrowski / 11:30 AM /
  Party 2 / ARRIVING": a RESERVATION (no "Asks" prefix; booked time),
  and she walked in and was next AT DESK (shot-088) as the blue-shirt
  at the counter.
- shot-109: after serving both, the list showed "0 bookings / No
  reservations waiting" while served customers walked off — no phantom
  rows.
- The "Asks <time>" format appeared ONLY on the AT DESK walk-in row, in
  the whole session.
- CAVEAT: a literal IN QUEUE badge never appeared (never two waiting
  tee-guests at once in the window; states seen: AT DESK, ARRIVING), so
  the IN QUEUE<->line equivalence specifically was not exercised.
- VERDICT: **CONFIRMED (not disproved)** — every disproof condition
  failed to fire: nobody listed was absent from the shop, and no
  Asks-time was ever shown for anyone not AT DESK. The literal IN QUEUE
  badge went unobserved.

## Claim 4 — walk-ins never ask hours ahead of the wall clock

- One organic walk-in observed (Silas Emery). His ask (12:30 PM) was
  read at shot-061 (t=1786417280271). HUD clock is hidden in desk mode;
  bracketing HUD reads: 11:07 AM at shot-055 (t=...216881) and 12:39 PM
  at shot-114, sim rate measured 8.0 game-min/real-min (10:49->11:07
  over 135.2s) -> clock at read ~= 11:15 AM. Gap = ~75 min. Under the
  80-min line, and nowhere near "hours".
- The booking UI reinforced same-day nearness: "12:30 PM is open. The
  first time below books their ask", alternative offered 12:00 PM.
- CAVEAT: Silas was first seen at the desk at 10:58 AM (shot-053); if
  his 12:30 ask was already fixed then, the gap at that moment was ~92
  min — still not "hours", but above the 80-min operational line. I
  could not read his ask at 10:58 (screen not yet opened), so the only
  honest simultaneous measurement is the ~75 min one. n=1 sample; the
  session window allowed no second organic walk-in.
- VERDICT: **CONFIRMED** on the direct measurement (75 min; nothing
  remotely "hours ahead" observed), with the n=1 and 10:58-inference
  caveats stated.

## Claim 5 — checkout TOTAL no longer collides with UNIT

- Staged sale (concession): Isaac Lane, 3 items on the counter, CHECKOUT
  tab table PRICE | UNIT | TOTAL (shot-119, shot-126).
- Pixel-zoom crops (nearest-neighbour 4-5x, `crop.mjs`):
  - `zoom-119-cols.png` / `zoom-126-rows.png`: "$15.00 | 1 | $15.00",
    "$2.50 | 1 | $2.50", "$3.75 | 1 | $3.75" — UNIT digit to TOTAL "$"
    gap ~13-14 native px on the widest row. No contact anywhere.
  - `zoom-082-row.png` (wider value, from Silas's green fee):
    "$128.00 | 1 | $128.00" — clear gap either side of the UNIT digit.
  - `zoom-126-summary.png`: SUBTOTAL $21.25 / SALES TAX 7% $1.49 /
    TOTAL $22.74 / PAYMENT CARD — all separated cleanly.
- VERDICT: **CONFIRMED** — no two numbers touch at any width produced
  ($2.50 through $128.00), inspected at 4-5x zoom.

## Incidental finding (not one of the five claims)

- shot-094: toast "CHECKOUT — Yolanda Ostrowski: I'll pay with card."
  while the register ran a CASH flow (RECEIVED $80 / CHANGE $16, bills
  on the counter, drawer count). The button she was checked in with
  said "CHECK IN - CARD". Cash was what actually happened; the toast
  (and button label) contradict the tender used.

## Session close

Bridge ended cleanly: done.json {"endedAt":1786418197302,"commands":134},
runner exit 0. Shots 000-134 in qa/electron/verifier1/.
