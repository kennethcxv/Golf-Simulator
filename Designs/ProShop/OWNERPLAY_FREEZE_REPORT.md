# THE DOOR AND THE TAB — owner-play repro, attribution, and why the census lied by omission (2026-08-16)

## What reproduces: ALL OF IT, without even needing your save

Booted your way (no pins, no teleports for the deed itself, real held-W
walking, real E, real Tab, customers live, 6:00 AM dawn — the Day-1 default),
recorded on video with a rAF gap log, a longtask observer, and
renderer.info + program-key snapshots bracketing each gesture. Two runs.

| moment | your report | run 2 | run 3 |
|---|---|---|---|
| walking toward the front door | — | **10.1 s** freeze | **16.4 s** freeze |
| the door / approach | ~10 s | 6.3 + 3.6 + 2.9 s | 2.4 + 1.4 s |
| Tab (overview) | ~10 s | **9.2 s** | **9.0 s** |
| Tab back | — | **11.4 s** | **12.0 s** |

Longtasks name every one of them `self`: the main thread blocked, not the
GPU idling. Evidence: `qa/ownerplay/repro-result.json`, `qa/ownerplay2/`
(video, 39 frame sheets — the overview sits frozen across whole sheets).

## The attribution, with the numbers

Across every freeze, geometry and texture counts moved by exactly ZERO.
Programs moved every time:

- **The front door: +5 programs**, all `physical`, every one differing from
  its nearest settled twin at ONE packed key field — index 48, value 2→1.
  That is the register-till's exact first-press axis from Goal 29, now
  measured at the front door too. Whatever state field 48 encodes (it
  matches the PCFSoft→PCF value range but is deliberately not named by
  index — the 46-fold rule), it separates EVERY warm from real play.
- **Tab: +10 programs** — nine `physical` differing at index 36, value 4→1
  (the overview camera's state axis), plus one `basic` two packed bits up.
- **Why ten seconds and not 1.5:** each arrival lands inside a draw as a
  driver-side program build, and on this machine tonight those builds run
  SECONDS each (the same intermittent stall the load instrument watches
  strike compile-hidden / the spin / the register warm — one 16.4 s single
  gap here). The old 1,490 ms measurement was one arrival in a healthier
  window. Same mechanism, different weather: arrivals × stall-seconds.

## Why the instrument disagreed with you — three named reasons

1. **It plays a state you never play.** Clock pinned to 14:00, sim speed 0.
   Your game runs at 6:00 AM dawn with the sim live. The warms and the
   census compiled and measured the pinned state's programs; play asks for
   the dawn/live variants — the field-48 2→1 family — which existed nowhere
   until your first step made them, ten seconds at a time.
2. **The list is hand-written and the door was never on it.** Fifteen rows
   (Tab, ledger, book, front desk, till, pause, nine tool-equips, editor).
   The game's playable surface is hundreds of verb×state combinations:
   every door across five systems (including no-key proximity swings), the
   wall map's OWN step-back overview (a second overview path), the whole
   delivery chain (lift/carry/set-down/flatten/recycle), the deep register
   states (check-ins, walk-ins, restock), cooler and fitting-room doors,
   tool CONTACT verbs (wring, empty, dispose — the census only equips),
   tractor fuel/belt/repair, mower and spreader selection, irrigation,
   spotlight aim, tee-sign repair, the boards, the laptop, the phone.
   None censused.
3. **"Fixed to zero" was measured as a re-press of the warmed state.** The
   fix warmed exactly what the census then pressed. Circular by
   construction; honest about its own state, silent about yours.

Ledgered in FOUND_FALSE.md (Shape 7, with the list itself as Shape 1).

## What did NOT reproduce

- Nothing failed to reproduce. The freezes appear on a NEW GAME as readily
  as on your save — Day 1 starts at 6:00 AM, which is the state that
  matters.
- One adjacent finding, recorded and left alone per your instruction to
  stay off the profile question: your save copy's Continue button never
  enabled in the harness within 25 s across three boots (the runs
  proceeded new-game). Whether that is a save-scan latency or something
  about copied profiles is not chased here; your original profile resumes
  for you.

## Where the fix has to live (named, not built — you said report)

The freezes are program arrivals in play states no warm ever drew. The two
named fixes from Goal 29 (till, editor) and both of tonight's surfaces are
the SAME defect: **the warm draws under warm-state, play happens under
play-state.** A fix that survives this ledger must make the warm draw under
the state the game actually enters play with (6:00 AM, sim live), and add
the always-on arrivals tripwire (log every post-veil program arrival with
its twin-diff) so the next uncensused surface names itself in QA instead of
in your hands.
