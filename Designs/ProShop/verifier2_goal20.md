# VERIFIER 2 — Goal 20 adversarial pass (2026-08-10)

Role: disprove, not confirm. No `src/` read. No report read. Real keyboard/mouse via
`tools/qa/electron-freeplay-bridge.js` (two sessions, 32-min cap each), default player camera only.
Shots: `qa/electron/verifier2/shot-*.png` (session 2 overwrote session 1 indices from 000; shot
numbers below are tagged s1/s2). Runner console logs: `runner.log` (s1), `runner2.log` (s2).

EVIDENCE CAVEAT: both sessions wrote to the same dir, so the on-disk shot-NNN.png files now hold
SESSION 2 frames only (s2 also ended at shot-068). Every s1 frame cited below was viewed with the
Read tool live during session 1 before it was overwritten; the descriptions are from those viewings.
Future verifiers: give each session its own QA_FREEPLAY_DIR.

## Concessions used (required record)
- `{"cmd":"qa","script":"inside"}` x3 — s1 once; s2 twice (second use to recover after the
  anti-stuck helper stranded me in the yard; it also rewinds the clock to 10:00 and re-opens business).
- `{"cmd":"qa","script":"ring"}` x1 (s1) — created the missed-call subject (Dana Whitfield).
- `{"cmd":"qa","script":"email"}` — NOT used. `sale` — NOT used.
- Deviation recorded: after exhausting the phone's stated arrows+Enter input model, I used direct
  MOUSE clicks on the phone panel to isolate whether the voicemail exists at all. Everything else
  was plain keyboard/mouse play.

## Claim 1 — "the main menu makes a sound when you press something"
- Audibility is NOT verifiable with this harness: screenshots and logs carry no audio. Stated plainly.
- What WAS verified (behavioural failure modes): hover highlights New game (s1 shot-001); clicking
  Settings opens it (s1 shot-003); Escape closes it and leaves a visible focus ring on the Settings row
  (s1 shot-004); clicking the disabled Load game does nothing — expected on a clean, saveless profile
  (s1 shot-005); New game opens the Relaxed/Realistic dialog (s1 shot-006) and boots into the world
  (s1 shots 007-009). No press froze or errored.
- Console/stderr (both runner logs): ZERO errors/exceptions. Only warnings: THREE.js
  "PCFSoftShadowMap deprecated", and [customer-nav] nudge/retarget spam (see notes).
- Supporting-but-not-proof: the Settings Audio tab exposes a "Menus — Clicks, confirmations,
  warnings — 80%" volume category plus master "Sound on" (s1 shot-003), i.e. a menu-audio path exists
  in the UI.
- VERDICT: audibility UNVERIFIABLE here; the menu did not break — every press responds visibly and
  the logs are clean.

## Claim 2 — "missed caller leaves a voicemail you can play, and you can ring back and they answer"
- Setup (concession): ring injected ~10:03; banner "The phone is ringing · Dana Whitfield · party of 2
  · today 2:00 PM · Y Accept · N Decline · T phone" rang continuously 10:04→~10:33 (s1 shots 014-021)
  — the full 30-game-minute request window, not a short ring-out — then expired; phone badge "1"
  (s1 shot-025).
- T opens the phone (s1 shot-026; footer "Arrows choose · Enter opens · T away"). Enter opens the
  Phone app: row "Dana Whitfield — Missed call · today 10:34 AM — PLAY MESSAGE" EXISTS (s1 shot-027).
- THE DISPROOF (keyboard model): in the call log the gold focus ring sits on "Back" and NO arrow key
  ever moves it to the call row. ArrowDown: no visible change (s1 shot-028; retried s1 shot-031).
  Enter then activates Back and dumps you to the phone home grid — twice (s1 shots 029, 032).
  ArrowUp (s1 shot-034) and ArrowLeft (s1 shot-035): ring stays glued to Back. So "press Enter on it"
  is impossible with arrows+Enter; the presses that did nothing toward the claim are ArrowDown /
  ArrowUp / ArrowLeft in the call log, and Enter (which closes the app instead of playing).
- Control: arrows DO work on the phone home grid — ArrowDown moved focus Phone → Messages with a
  visible ring (s2 shot-066). The dead zone is specifically the call-log rows.
- Mouse fallback (recorded deviation): clicking PLAY MESSAGE expands an italic voicemail transcript —
  "Dana Whitfield here. Any chance of a tee time for 2 on today 2:00 PM? Give me a ring back." — and
  the action flips to CALL BACK (s1 shot-036). Clicking CALL BACK connects a live call screen
  ("INCOMING CALL — Dana Whitfield — asks for today 2:00 PM · party of 2", Answer/Offer/Decline,
  s1 shot-037); Enter on the focused Answer books it: "Booked. today 2:00 PM." (s1 shot-038), and the
  booking is real — Tee Sheet shows "2:00 PM — Dana Whitfield" (s1 shot-052).
- VERDICT: DISPROVED AS STATED for the phone's own input model (arrow keys cannot reach the
  voicemail; Enter closes the app). The feature itself EXISTS and completes end-to-end via mouse:
  message plays (transcript), ring-back connects, she answers, the booking lands.

## Claim 3 — "calls/emails arrive far more often — ~21/day instead of ~4"
- Session 2 is the clean observation (nothing injected): organic ring at 10:17 AM (Sadie Grady,
  party 2, +1d 1:00 PM — s2 shot-016 banner), organic ring at 10:21 AM (Lena Holt, party 3,
  +1d 12:30 PM — s2 shot-017 banner), and a third by ~10:24 (phone badge climbed 1→2→3 across s2
  shots 017-024 with no injection; 3 missed calls on the badge by 10:33). Messages app at 10:41:
  "No messages yet." (s2 shot-067) — all three arrivals were CALLS; zero emails.
- Observed rate: 3 organic calls in ~24-40 game minutes of open business ≈ 4-7/game-hour. Even if
  that is an opening burst, it is far beyond the old trickle (~1 per 2 game-hours) and beyond
  4/day; a 10-12h business day at anything like this rate lands well past 21/day.
- Session 1 caveat (honest): 0 organic arrivals seen in ~3.1 game hours, but the observation was
  dirty — my injected ring monopolized the banner for 30 game minutes and ~1.5 game hours were spent
  inside register UI where banners were not visible. One unexplained badge increment ~11:10.
- Walk-in traffic (not the claim's channels, but context): constant — queue peaked at 5 visible
  customers; two full sales processed.
- VERDICT: CONFIRMED in direction with measured data (3 organic calls in ~40 open game minutes;
  the old world's trickle would average ~0-1 in that span). The exact "21/day" figure and the email
  share are unverifiable in the observed span — zero organic emails appeared.

## Claim 4 — "ledger closes with Q, only E pages forward, D dead in the book"
- NOT REACHED — and the claim's stated premise failed observably. Across ~40 minutes of real play in
  two sessions the ledger book could never be opened:
  - With any customer waiting/arriving, the front-desk flow owns E: prompt reads "Front desk - E help
    Bennett Hart…" / "Tee desk - E serve Priya Ferreira…" / "Front desk - E check in Priya Ferreira…"
    even with the crosshair dead-center ON the book cover (s1 shot-047; s2 shots 015-017, 041, 061).
    Pressing E there always opens the register (s1 shot-048; s2 shots 018, 062-063).
  - X (carry) on the book did nothing (s1 shot-050) despite the ledger being a moveable prop.
  - In the ONE free-desk window (s2 10:03-10:15, doors closed, empty shop), aiming at the book edge
    produced NO gaze prompt naming the ledger, and E did nothing (s2 shots 055-059).
  - Negative control: the gaze-prompt system itself works — aiming at yard-sale clutter names it
    ("Old clutter - E haul it out", s2 shot-046). The missing prompt is specific to the book.
  - The task said "the gaze prompt names it" — that prompt was NEVER observed, from either side of
    the desk, dot-on-cover, at close range.
- Because the book never opened, the in-book bindings (D dead / E forward / A back / Q close) and the
  footer hint text could not be tested. Noted hazard: a persistent HUD chip "Q — reveal dirt" is
  bound near the desk, so Q already has a world meaning adjacent to the book.
- VERDICT: NOT REACHED for the key bindings; the reachable premise ("E picks it up", "the gaze
  prompt names it") is DISPROVED under real open-shop play — desk-flow capture plus a never-appearing
  book prompt make the ledger uninteractable in this build as a player experiences it.

## Claim 5 — "the loading screen is immersive" (opposite check, baseline)
- Timed with shot mtimes (s1): click Relaxed ~19:48:24.6 → world visible by 19:48:49.4
  (s1 shot-009) — ~24-25 seconds. (s2 repeat: also ~25 s, plus a REPLACE CURRENT AUTOSAVE confirm
  since a save now existed.)
- What is on screen while waiting: flat dark-green page, "GOLF EMPIRE — Arriving at Pine Hills
  Municipal Golf", a thin progress bar with stage labels ("Loading models" at 8%, s1 shot-007;
  "Warming the view" at 72%, s1 shot-008), and a single rotating tip line ("P pauses from walking,
  checkout…", "Manual save slots are separate from the Continue autosave."). No artwork, no scene,
  no animation beyond the bar — and the bar leaps 8%→72% because the renderer blocks (a 14 s gap
  between s1 shots 007→008 where screenshots could not be taken at all).
- VERDICT: baseline honestly described — functional and branded but static and blocky; ~24 s wall
  from mode-pick to standing in the world. "Immersive" is not the word; the claim that it is NOT
  fixed is consistent with what I saw.

## Bonus regressions/observations (evidence-backed, for the queue)
- Front-desk economy works end-to-end with real input: walk-in booking + card ($96 keyed on the
  terminal keypad, PROCESSING → PAYMENT ACCEPTED, money +$96) and a 3-item retail CASH sale
  ($343.47: click-to-ring each product, cash on counter, till drawer with $1-$50 / 1c-50c slots,
  counted EXACT CHANGE $6.53, DONE) — s1 shots 052-065, s2 shots 019-039. No receipt printed (by
  design per sim rules).
- Autosave: second New Game shows "REPLACE CURRENT AUTOSAVE?" confirm (s2 shot-005) — the Continue
  autosave from session 1 was real.
- [customer-nav] warning spam: s1 log ends with one visitor retargeting `fixture:shelf_acc`
  every frame for dozens of lines; worth an eye for a stuck-shopper loop.
- Anti-stuck helper ("Stepped you back to where you last had room.") fired twice while WALKING
  normally through the entrance doorway area and once dumped me outside/into the yard
  (s2 shots 048-053). Its trigger volume around the entrance mat looks too eager.
- The injected phone request rings for its entire 30-game-minute lifetime (10:04→10:33) — there is
  no shorter ring-out before "missed"; Y/N/T stay the only affordances the whole time.
