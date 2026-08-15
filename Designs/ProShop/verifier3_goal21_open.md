# VERIFIER 3 — THE STRANGER — Goal 21 opening run
2026-08-10 · bridge session `qa/electron/stranger21a` · 89 commands · qa "inside" teleport **NOT used**

## The direct answer
**I never got inside the pro shop.** ~25 minutes of honest play (game clock 6:04 AM → 8:47 AM, Day 1,
Realistic mode). The door told me exactly what it wanted — "Clear the entrance and wash the porch
before repairing the doors" — and I could do neither: washing requires HOLDING the mouse button
(taps are explicit no-ops, and the test bridge has no mouse-hold command — harness limitation,
recorded below), and "clear the entrance" never resolved into an action any of my verbs or tools
performed. A third of the session was spent physically trapped at the front door by the
collision + auto-unstick loop (finding 1). Nothing after this line uses any concession.

## Timing
- Process launch 21:22:22 → main menu screenshot 21:22:28 (~6 s; the bridge waits 5 s before its
  first shot, so real boot was near-instant). Nothing to stare at — no load bar needed (shot-000).
- New game → Realistic → world: one loading screen ("Arriving at Pine Hills Municipal Golf",
  "Loading models", progress bar, one tip) for roughly 6–10 s (shot-002 → shot-003).

## Findings, worst first

1. **Door-pocket warp trap — the session-eater.** Eight "UPDATE — Stepped you back to where you
   last had room." toasts (shots 045, 048, 052, 056, 058, 061, 069→071, 073). Once wedged in the
   front-door alcove, every walk longer than ~1.5 s in ANY direction ended with a warp back into
   the alcove — including a Shift-sprint that had already crossed open lawn (shot-061). The
   unstick's remembered "last had room" point is itself inside the snag zone, so the rescue system
   re-arms the trap. Only a diagonal strafe (S+D / A+S held ~2.5 s) ever escaped it, twice
   (shots 053, 062). A new player would conclude the game is broken. This single issue consumed
   roughly a third of my session and is the main reason I never reached the second door I had
   seen around the corner (shot-033).

2. **The critical path runs through a mouse HOLD, and a tap is a designed no-op.** Tapping LMB with
   the pressure washer produced no water, no sound cue, no number movement — instead a toast:
   "Hold the button down to use a tool. A tap does nothing." (shot-014). The message is honest and
   I respect it, but the porch gate (60% washed) therefore cannot be advanced by any discrete
   input. *Harness note, not a game bug:* the freeplay bridge has `click` (tap) only — no
   mouse-hold command — so washing was untestable end-to-end for this verifier. Add a
   `{"cmd":"mousehold","ms":N}` before the next stranger run.

3. **Bunker rake viewmodel is visually broken.** Equipping it (F-cycle, 4th tool) fills the upper
   third of the screen with giant deformed tan lumps — an exploded hand/glove mesh — with the rake
   shaft floating separately (shot-028). Instantly visible to any player who cycles tools.

4. **No persistent current-task display anywhere on the HUD.** I checked all four corners in the
   world (shot-003), the phone (T: Phone/Contacts/Messages only, "No messages yet." — shots 034,
   037), and Tab overview. The only quest text in the game is the door's transient rejection toast
   (shot-005) and per-object captions (shot-011). Meanwhile REAL trackers exist — maintenance
   tablet with a 14-item work order (I, shot-078), empire overview with ledger (M, shot-080),
   maintenance work board with a crew morning report (G, shot-083) — but those keys appear ONLY in
   the pause menu's Controls screen (shot-076); the HUD hint bar never mentions I/M/G/C. A
   stranger who doesn't open Controls will never find the game's entire management layer.
   And none of those trackers mention the Day-1 shop-restoration chores.

5. **Q chip teaches the key but not the gesture.** HUD chip says "Q — reveal dirt" (shot-008); a
   tap does nothing visible (shot-009), so I wrote the feature off. The Controls screen says the
   truth: "Dirt sense: hold to reveal" (shot-076). Held Q is excellent — cyan wash-target patches
   bloom across the porch boards and up the wall siding (shot-087). One word ("hold") on the chip
   fixes this.

6. **Tab overview cannot answer "where am I?".** It opens over featureless forest canopy with the
   toast "Overview camera - 18 dirty spots marked" — but no markers, no player pin, no clubhouse
   in frame (shot-039). V switches data views (Health) with NO legend — near-black terrain vs a
   tan band means nothing to a new player (shot-040); after panning, yellow turf with red
   hotspots along a cart path appears, still unlabeled (shot-041). WASD pans the overview but the
   on-screen legend only advertises drag/wheel. Also the bottom-right view chips sit underneath
   the phone/T badges — overlapping UI (shot-039).

7. **Failed interactions are totally silent.** E and X produce zero feedback on the debris pucks,
   the fallen plank, and the shovel in the flower bed (shots 023, 026, 067). Only the door talks
   back. A player cannot distinguish "wrong target" from "broken keybinding". One "nothing to do
   here" ping would fix it.

8. **"Clear the entrance" never resolves into an action.** The entrance debris is marked (orange
   pucks + dashed outlines, shots 008, 021) but E/X ignore it and the tool belt holds only
   washer/hose/divot kit/bunker rake (shots 012, 024, 027, 028) — no broom, no debris bag. A
   "Debris bag" exists in the maintenance tablet's equipment list (shot-078), but nothing connects
   it to the porch chore. Half of the door's gate is therefore un-figure-out-able from the porch.

9. **Red turf renders like a debug overlay.** The unhealthy patches east of the shop are flat
   salmon-red with hard edges in the world view (shots 066/067) — they read as an artifact or
   editor tint, not as dying grass.

## What was GOOD (calibration)
- **Boot and menus are tight.** ~6 s to a clean title menu; Continue is properly disabled with a
  reason ("No Continue save yet", shot-000); the Relaxed/Realistic cards state real consequences
  (shot-001); the loading tip teaches the phone key (shot-002).
- **The door speaks in requirements, and objects carry live numbers.** "Clear the entrance and
  wash the porch before repairing the doors" (shot-005); "Porch boards and rail - blocked:
  Pressure wash the porch to 60% first (currently 11%)." (shot-011). That percentage is exactly
  what a player needs.
- **Tools teach themselves on equip** — "Pressure washer - hold LMB to wash · hold RMB to apply
  soap · F tools" (shot-012) — and the tap-does-nothing toast explains rather than ignores
  (shot-014).
- **The restoration fantasy is sold visually**: "PRO SHOP / CLOSED / RESTORATION" plaque
  (shot-011), gold window decal, muddy footprints tracked across the club welcome mat INSIDE the
  locked shop (shot-045), rain clearing into morning sun over a clocktower clubhouse and course
  sign (shot-033).
- **The anti-stuck system exists and communicates** (dedup "×2/×3" counters) — its rescue POINT is
  the bug, not its voice.
- **Deep management layer** once discovered: 14-step daily work order with condition sub-scores
  (shot-078), automation policies with honest lock copy ("Watering and feeding remain locked
  until their real equipment is earned") and a crew-shortage morning report (shot-083), and an
  empire ledger recording "Day 1 - Bought Pine Hills Municipal Golf for $23,000" (shot-080).
- **Pause menu is complete and honest** about what pauses (shot-075); Controls screen is a real
  reference (shot-076).

## Harness notes for the next stranger
- PowerShell 5.1 `Add-Content -Encoding utf8` writes a BOM into the empty commands.jsonl; the
  bridge silently drops that first line (no shot, no error). Use `-Encoding Ascii`.
- No mouse-hold command exists; washing/soap (and any hold-verb) is untestable. Tap-clicks while
  pointer-locked also STEER THE CAMERA before clicking (the move is consumed as look), which made
  phone-tile clicking impossible — the phone's keyboard path (arrows/Enter, footer hint) worked.
- `qa` teleport concessions were not used in this run.
