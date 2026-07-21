# Customer simulation visual QA — iteration 3

Run: `2026-07-19T-iteration-3`, Chrome default WebGL, 1600×900. Lighting held at exactly 10:00, all four held units remained distinct, the main door reached its full 1.92-radian open angle, checkout remained in the existing scanner flow, and both lounge seats were reached without recovery. Console/page errors and emergency reposition remained zero.

## Visible defects and revisions

1. The tutorial objective card still occupied the lower-left exterior frame because setting `tutorial.hidden` did not synchronously refresh that component. Clean-frame CSS now suppresses `.objectives-card` as well.
2. The exterior character's cap brim pointed away from the clubhouse while their feet carried them toward it. The shared turn calculation now accounts for the mesh's local `-Z` visual front.
3. The same 180-degree convention made display customers face away from merchandise. `angleToward` now uses the corrected visual-front heading for browse, lounge, queue, door, and register targets.
4. Browse arm rotations reached toward local `+Z`, behind the corrected visual front. Browse/inspect/reach shoulder signs now extend the hand toward local `-Z` and the product.
5. Carry and staging arms also folded behind the torso. Their shoulder signs now bring both hands forward.
6. Card/cash gestures extended the paying hand backward. Payment shoulder signs now reach toward the terminal/cashier side.
7. Talk gestures were mirrored behind each speaker. Both conversational shoulder arcs now animate forward.
8. The seated armrest revision used the same inverted sign, so forearms still pressed into upholstery. Seated shoulders now bend toward the chair front.
9. Single-item and basket visuals were attached at local `+Z`, inside/behind the shopper. Held goods now sit centered at chest height on local `-Z`, between the hands.
10. The dark basket could be seen near the floor/static basket stack but not clearly in the second shopper's grip. Its attachment moves to the same forward carry point as other merchandise.
11. The cream cap overexposed to featureless white under lounge lighting. Customer profile caps now use the visual-direction palette's warmer, darker cream.
12. The centered lounge camera fixed overlap but cropped the right member at the frame edge. The next camera backs into the aisle for a complete two-chair composition.
13. The doorway frame remained empty because a fixed camera could still miss whichever of six approach sockets the allocator chose. The next camera is computed from the live actor and real door positions after the wait.
14. The random exterior spawn made the door evidence take almost two minutes on a low-FPS headless run. The visual cast now starts at a named near-property point and claims a named arrival socket, while retaining normal collision-aware approach, door wait, passage claim, open, and entry behavior.
15. A generic browsing-state wait often photographed the rest portion of the browse loop. The next frame waits for inspect/select and uses a 220 ms camera settle to preserve the visible reach.

## Evidence inspected

- `01-exterior-approach.png`
- `02-browsing-floor.png`
- `03-lounge.png`
- `04-entry-door.png`
- `05-register-queue.png`
- `visual-2026-07-19T-iteration-3.json`
- recorded WebM under `video/2026-07-19T-iteration-3/`
