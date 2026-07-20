# Physical card-swipe functional pass

Date: 2026-07-19

Scope: functional checkout increment. The card-reader presentation remains in the
upcoming visual-polish pass; this document does not claim checkout complete.

## Implementation

- The visible, real-proportion card is now a mouse-owned 3D object at `card-ready`.
- Pointer movement is projected onto the physical reader path and recorded as
  normalized `{ y, t }` samples.
- The existing pure `judgeSwipe()` authority evaluates start, completion,
  direction, reversal, and pace. A terminal click can no longer bypass it.
- A failed stroke returns the card to the top and exposes the exact player-facing
  judge message. A valid stroke alone enters `card-busy`; `runCard()` remains the
  sole approval/decline authority.
- The camera uses a left-side sightline around the POS rather than moving checkout
  hardware out of customer reach.
- The Playwright runner now verifies the static server's canonical worktree root,
  preventing a port collision from recording another branch as evidence.
- The sale harness derives the cashier stand and focus pose from the live clubhouse
  transform instead of assuming one property-world offset.

## Evidence

- `functional-card-swipe-4/result.json` records the complete route.
- `functional-card-swipe-4/06-card-presented.png` shows the card at the top of the
  physical reader path.
- `functional-card-swipe-4/07-card-swipe-incomplete.png` accompanies a partial
  mouse stroke that remains `card-ready` with `Complete the swipe`.
- `functional-card-swipe-4/08-card-authorising.png` follows a paced full mouse
  stroke that enters `card-busy`.
- `functional-card-swipe-4/video/card-swipe-normal-controls.webm` records the run.

Observed acceptance facts:

- Incomplete swipe: refused; card attempts stayed 0.
- Complete swipe: accepted; exactly one card attempt reached approval.
- Revenue remained `$0` through approval, receipt, and bagging.
- Final bag handoff banked `$66`, sold 2 units, and reduced held stock to 0.
- Browser console/page error count: 0.
- Unit suite: 516 passed, 0 failed.

Visible follow-up: the terminal model's own display faces the customer and is not a
strong feedback surface from the cashier sightline. The register HUD/POS feedback,
stale hints, turf controls, toast stacking, handoff, characters, and animation are
still open and will be handled in the required visual iterations.
