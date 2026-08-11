# Verifier 3 — The Stranger (Goal 20)

Session: 2026-08-10, ~27 minutes of blind play via `tools/qa/electron-freeplay-bridge.js`,
`qa/electron/stranger20/` (shots 000-110). I read no code and no design docs; everything
below is what the screen showed me.

**Concessions and rig limits (recorded up front):**
- I used the allowlisted `{"cmd":"qa","script":"inside"}` once (after shot-048) because a
  fresh save cannot open the locked doors and I could not finish the porch task (see #1).
- My rig can only CLICK the mouse; it cannot HOLD a button, so I could never perform the
  washer's "hold LMB" verb. Findings about washing are tagged with that caveat.
- My rig's relative-look nudges cancel out vertically (horizontal look always worked), so
  I aimed up/down rarely. That is a bridge artifact, not a game fault.
- Screenshots carry no audio; I make no claims about sound either way.

## Findings (worst first)

1. **The first-time player hits a wall on the porch: the game names two verbs and neither
   visibly responds.** The door says "Entrance doors and hardware - blocked: Clear the
   entrance and wash the porch before repairing the doors" (shot-006). I equipped the
   washer and tap-clicked at dirt five separate times — no jet, no droplet, no wet mark,
   no sound-cue text, nothing changed (shot-013, shot-025, shot-037). I stood over the
   orange debris at the threshold with bare hands and pressed X and E — no pickup, no
   prompt, no "you can't do this because…" message (shot-028, shot-042, shot-044). Caveat:
   my rig cannot HOLD the mouse button, which the hint demands — but a tap producing
   absolutely zero feedback is the problem: fifteen real minutes outside, zero progress,
   zero corrective feedback. A stranger cannot tell a broken verb from a wrong one.

2. **"Milestone - Serve the first business day — COMPLETE" fired the instant the shop
   opened, before I had served anyone** (shot-050, immediately after the `inside`
   concession jumped the clock to 10:00 AM; money also rose $36,000 → $37,077 by itself).
   Caveat: a QA teleport triggered it, but the milestone plainly keys off the clock, not
   off serving — an unearned milestone cheapens the loop it names.

3. **The shop interior is dominated by giant blank surfaces.** Featureless grey slab
   panels along the back wall and floating above the counter (shot-050, shot-056), and a
   huge textureless brown wall/cabinet-back that fills half the frame from behind the
   desk (shot-057, shot-109). Everything else is finished enough that these read as
   missing assets, not style. (I'm told nothing; as a player I'd call the room unfinished.)

4. **Q is two different buttons at once and eats your tool.** Q pulses the dirt overlay,
   but Q is also "swaps back" for the tool belt — pressing Q while holding the washer
   silently stowed it (shot-013 → shot-014), and it took two F presses to visibly get it
   back because one slot of the F-cycle is empty hands with no on-screen feedback
   (shot-020 → shot-021). For several minutes I genuinely believed the tool system was
   broken.

5. **The tee-desk prompt named the wrong customer.** "Tee desk - E serve Chip Lambros
   (3 players · 10:00 AM)" (shot-056) — pressing E opened a CHECKOUT transaction for
   Lena Rhodes instead (shot-059). Small, but it's the first thing the desk ever told me
   and it was wrong.

6. **Clicking a product slides it instead of ringing it; the slide buried my scorecard
   under the bag.** Instruction says "Click each product once to ring it up" — first click
   shoved the towel sideways (shot-060), second click rang it; the same first-click shove
   wedged the scorecard half under the bag box (shot-062). It rang on the next click, but
   "once" is not true and small items can hide under the bag.

7. **Rain falls through the porch roof.** Thin white rain streaks render inside the
   covered porch, hanging from the ceiling above the door (shot-008, shot-013, shot-021),
   plus stray white wedge artifacts at the frame edges at roof height outside
   (shot-004). Cheap-looking in an otherwise handsome facade.

8. **After each transaction the register resets to CHECKOUT and "No customer" even while
   a check-in guest is standing at the desk** — I had to guess to click the CHECK IN tab
   (shot-080, shot-098), and between guests the next person in line stood beside the desk
   facing away from me (shot-078). The queue works, but the seams show.

9. **The change-drawer camera keeps moving after "the drawer is opening" and swallows
   clicks made during the slide.** My first three counted coins landed on nothing twice
   in a row because the framing settled late (shot-067, shot-089). A human with live
   video adapts; input being live before the camera settles is still sloppy.

10. **The dirt-reveal is a short pulse with floating flat markers.** The blue/yellow
    squares hover over walls and door glass rather than lying on surfaces, and fade
    within seconds so you re-press Q constantly (shot-008, shot-014 vs shot-020).

11. **Customers are clone-stamped toys standing on visible base plates.** Same head,
    same caps in 2 colors, and every person stands on a small flat grey plinth like a
    miniature (shot-054); the guest being served stands with her back to the till in the
    zoomed check-in view (shot-083/084). Readable, but it reads cheap up close.

12. **Small UI debris:** an empty outlined box sits in the main menu's bottom-right
    corner (shot-000); Chip's not-yet-arrived state shows a greyed "CHECK IN · CARD"
    button and a truncated badge "WAITING FOR ..." (shot-101).

## What is genuinely good

13. **Boot and load are fast and honest** — ~6 s to the main menu, ~7 s from clicking
    Realistic to standing in the world, with a progress bar and a real gameplay tip
    (shot-000, shot-002, shot-004).

14. **The mode-choice dialog says what the modes actually do** — "Relaxed: forgiving
    turf, softer finances" vs "Realistic: tighter margins, manual cash handling"
    (shot-001). I knew what I was signing up for.

15. **Contextual gaze text is everywhere and it's good** — the blocked-door explanation
    (shot-006, re-fires on approach shot-048), the tee-desk serve prompt (shot-056), and
    live stock info like "Scorecards - Pine Hills scorecard 5/12 - backroom empty"
    (shot-109).

16. **Hold-F opens a real tool belt** — labeled radial (Hands free / Rented washer /
    Watering hose / Divot kit / Bunker rake) with per-tool descriptions and equip keys
    spelled out (shot-032). This is how I finally understood the tool system.

17. **The front-desk loop is the best thing I touched.** Booking negotiation with honest
    unavailability ("3:00 PM is not available. The nearest open time is 2:30 PM" →
    2:30 / 3:30 / full sheet / turn away, shot-083; same pattern for Felix, shot-103);
    correct money math everywhere ($16 + 7% = $17.12, shot-063; $150 − $128 = $22,
    shot-084); a physical cash drawer with denomination slots, give/take-back tooltips,
    live SHORT BY / EXACT CHANGE feedback (shot-068, shot-075, shot-092); customers with
    flavor lines ("I'll pay with cash", "Hi, could we get 12:00 PM for 4?", shot-084,
    shot-095); and a real objective tick, "Check in the first tee-time guest - done"
    (shot-095). Earnings actually land in the HUD ($37,077 → $37,222, shot-106).

18. **Getting stuck behind the desk was handled gracefully** — walking into the nook
    produced "Stepped you back to where you last had room." and a clean recovery
    (shot-106).

## What I never reached

The retail shelving floor with browsable products, the broom/mop cleaning loop indoors,
the ledger book, and any customer buying off shelves organically — 27 minutes went to
the porch wall (#1) and the (excellent) desk loop. I also never heard the game, and I
never got the doors open the honest way.
