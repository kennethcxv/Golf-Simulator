# First-run stranger session — 2026-08-05 (N5's deliverable, produced by Phase 4 Verifier 3)

Played cold in Electron, pine-hills-v2, from the main menu: New game → Relaxed, Day 1
6:00 AM → 6:50 AM game time. 32 screenshots in `qa/electron/stranger/`, full text log in
`qa/electron/stranger/stranger-log.json`. The player never got inside the building and
never saw another person. The list is the deliverable; nothing here was fixed.

Produced AFTER the O1 copy sweep, per the review's ordering, so every quoted string is
current copy.

## Ranked confusions (earliest-and-worst first)

1. [Day 1 6:00 AM onward, step-05/06/23] **The game's goal text never appears on
   screen.** The DOM carried an objectives card the whole session — "INSPECT THE
   FURNISHED BUT NEGLECTED PROPERTY 2/18 · Survey the neglected property · Look around,
   then walk toward the clubhouse", later "Enter the closed clubhouse — Open the green
   entrance doors with E and step inside", later "FIRST USE · Maintain what you inspect
   · [Remind me later]" — and in 32 screenshots none of it is ever visible. All that
   ever shows is money, clock, key-hint bar, and occasional toasts. The goals were only
   discoverable by reading the page DOM. Result: the player never learned they were
   supposed to go inside, and spent all 50 game minutes in the yard.

2. [6:00–6:03 AM, step-06/09/10] Spawned facing green double doors under a lit porch;
   the sign says "PRO SHOP — CLOSED — RESTORATION". The crosshair only ever named
   "Weeds - E pull them" or "Porch boards and rail - blocked: Pressure wash the porch
   to 60% first (currently 11%)". E by the doors → the porch "blocked" refusal. At no
   point did any prompt mention the doors or how to enter.

3. [6:05 AM to end, step-13/17/32] **Once a tool is in hand, the prompt line shows only
   the tool's own controls** ("Pressure washer - hold LMB to wash · hold RMB to apply
   soap · F tools") no matter what is aimed at — twelve-direction scans found no other
   label at any yaw. The "60% (currently 11%)" gate is only readable while NOT holding
   the washer: while doing the work you cannot see the number you are working toward,
   and you can no longer find out what anything around you is.

4. [6:06–6:07 AM, step-16/17] Held LMB "to wash" twice (2+ seconds each). Nothing
   confirmed anything happened — no percentage, no condition readout, no toast, no
   before/after. (The invisible FIRST-USE card claims "Your tool readout shows the live
   turf value" — no such readout is on screen, and "turf value" for a pressure washer
   aimed at a porch reads like the wrong tutorial.)

5. [6:07 AM, step-19] Hint bar says "Z set down". Pressing Z with the washer visibly in
   hand → toast "NOT AVAILABLE — Your hands are empty." The picture and the message
   directly contradict each other. (X did nothing visible either.) Nothing
   distinguishes "held tool" from "carried thing" or says how to put the washer away.

6. [6:03–6:05 AM, step-09 → step-13] The porch prompt states the gate but nothing says
   where a pressure washer IS or how to get one. It was obtained because tapping F
   happened to slam one into the hands — no wheel seen, no list, no "equipped"
   message. "tap/hold F tools" gave no hint that a tap = instant-equip something
   unseen; the other owned tools were never shown.

7. [6:00 AM, logged at step-03/04] **The opening briefing fires while the loading veil
   still covers the screen** and is gone by the first playable frame. Lost with it: the
   greenskeeper's disease hook ("3 greens are fighting disease. Step outside and click
   them to diagnose") — which is also kickered "NOT AVAILABLE" like an error, says
   "step outside" to a player who spawns outside, and doesn't say where a diseased
   green is. A "✓ COMPLETE — Organize the floor and keep every route clear" toast three
   seconds into a new game reads like someone else's finished task.

8. [6:48 AM, step-28] Tab overview → toast "Overview camera - 18 dirty spots marked."
   The screen shows an unbroken carpet of trees; not one visible mark. Where are the 18
   spots? What does a mark look like? Also the simultaneous "Stepped you back to where
   you last had room." refers to nothing the player did.

9. [6:07 AM through end, steps 23–27] **After the porch beat there is no next beat.**
   From 6:07 to 6:50 game time the screen offered nothing: no toast, no arrival, no
   customer, no nudge. The sign says CLOSED and nothing says how it opens, whether
   customers exist, or what the $76,500 is for. (If the objectives card rendered — see
   #1 — this minute-7 dead end is likely covered; as delivered, it is a wall.)

10. [6:00–6:07 AM, step-05/06/17] Unlabeled white triangles: two pinned at the left and
    right screen edges at spawn, later a free-floating one in the sky. Never labeled,
    never explained — objective markers, birds, or glitches, unknowable from the frame.

11. [6:00 AM, step-04/05] Toast: "The old tractor sits by the shed, east of the porch -
    she'd run again with some work." There is no compass or cardinal anything in the
    UI. The shed was found by accident four minutes later; the tractor offered no
    prompt from where the player stood.

12. [6:00 AM, step-01] The main menu's bottom button is "Test scene: Maintenance Shed",
    presented with the same weight as New game/Settings. A stranger nearly clicked it
    first as "maybe the tutorial". Internal QA entry in the player-facing menu.

13. [6:00 AM, step-02] The difficulty dialog explains Relaxed vs Realistic in one line
    each (good) but marks no default or recommended pick. First decision of the game,
    zero guidance.

14. [6:12 AM onward, step-22/23/32] Mid-session the game returned to the "Click to look"
    state (mouse released) more than once without Esc being pressed, and **all prompts
    vanish while unlocked** — it was not obvious the game had let go of the mouse until
    the hint bar reappeared. (Caveat: synthetic mouse events; the symptom "prompts
    silently disappear whenever lock is lost" is real either way.)

15. [6:05 AM, step-15] Holding Q painted glowing yellow blobs on the wall — a visible
    result — but nothing named them, counted them, or tied them to the porch's 11%,
    and they faded without trace. "That's dirt" was inferred, never said.

16. [6:00 AM, step-06] The always-on key bar offers "J course editor" to a minute-one
    stranger, on equal footing with WASD and E. A developer-sounding concept handed
    before the player has learned to open a door.

## What worked well (taught themselves)

- Title menu: the "New game — Choose Relaxed or Realistic mode" subtitle, disabled Load
  game on a fresh profile, and the plain autosave warning in the New Game dialog.
- Load screen: names the destination, shows real progress, teaches one key (P pauses),
  and is fast — world in ~10 seconds.
- **The crosshair prompt grammar** — object + verb + key ("Weeds - E pull them") and
  object + gate + exact numbers ("blocked: Pressure wash the porch to 60% first
  (currently 11%)") — the best teaching in the session.
- The bottom hint bar is a complete, readable control sheet and swaps to a
  mode-specific sheet in overview.
- "🎯 Survey the neglected property - done." confirmed progress the instant it was
  earned.
- Q reveal gives an immediate visible payoff for pressing the advertised key.
- The held tool states its own controls with keycap styling.
- The pause menu is instantly legible (PAUSED flag, big Resume, "P or Esc resumes").
- HUD money and date/clock always readable; the clock visibly runs and the sunrise
  tracks it — time passing is felt.
- Diegetic signage ("PRO SHOP — CLOSED — RESTORATION", receiving-bay floor paint)
  frames the fiction well — even though the way inside was never taught.
