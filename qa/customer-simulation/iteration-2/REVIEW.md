# Customer simulation visual QA — iteration 2

Run: `2026-07-19T-iteration-2`, Chrome default WebGL, 1600×900. The two authored seats were reached with zero navigation recovery and no emergency reposition. The queue grew naturally behind the two staged shoppers, all four held units remained uniquely accounted, and the real register remained in `scanning`. Console/page errors remained zero.

## Visible defects and revisions

1. Removing individual toast elements before the frame was racy; the tutorial ticker recreated them during the 700 ms camera settle. Clean-frame CSS now suppresses the entire toast wrapper for screenshots.
2. Evidence frames drifted from 10:08 to 10:23 despite claiming fixed lighting. The visual fixture now sets speed index zero after the normal-control smoke, holding the game clock and lighting at 10:00 while character runtime continues.
3. The corrected exterior frame made the route readable but left the customer too small against a large empty lawn/sky field. The trailing camera offsets are reduced for a medium-wide arrival shot.
4. The doorway frame captured the open leaf after the visitor had already crossed, so it failed to prove person/door coordination. The wait now requires `Waiting for door`, not either of two transient states.
5. The 700 ms camera settle was longer than the doorway crossing. The doorway evidence uses a 140 ms settle and temporarily reduces only the cast actor's walking speed after reaching the real door wait.
6. The inside-east doorway angle let the swing leaf occlude the visitor. The next frame moves outside-west and looks back across approach, threshold, actor, and moving leaf.
7. Seated thighs rotated toward local +Z—the rear of the character—so legs passed through chair backs. The hip signs now extend thighs toward the character's local -Z/front.
8. Seated knees compounded that backwards fold and lifted shins through upholstery. Opposing knee rotation now drops the shins vertically from the forward thighs.
9. Seated arms hung below the chair arms. A relaxed shoulder/elbow bend now rests the forearms forward instead of through the seat.
10. The west lounge angle let chair A's high back conceal most of its occupant. The next camera moves to the center aisle and looks straight into the two-seat composition.
11. A single carried glove was visually too small to communicate that the second queue customer held merchandise. That controlled shopper now reserves a glove plus ball box and therefore carries the existing physical basket.
12. The queue shot did not exercise visible impatience feedback. The second controlled shopper receives enough patience to remain safely queued while crossing the indicator's visible threshold.
13. Visual diagnostics exposed state but not the actual pose or ambient socket. Diagnostics now include animation mode and occupancy socket so the screenshots can be correlated with `Sit`, `lounge-chair-a`, and `lounge-chair-b`.
14. Browsing and queue frames still contained tutorial toast clutter even though the objective panel itself was hidden. The toast-wrapper rule applies uniformly to all five standard cameras.

## Evidence inspected

- `01-exterior-approach.png`
- `02-browsing-floor.png`
- `03-lounge.png`
- `04-entry-door.png`
- `05-register-queue.png`
- `visual-2026-07-19T-iteration-2.json`
- recorded WebM under `video/2026-07-19T-iteration-2/`
