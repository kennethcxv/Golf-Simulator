# Customer simulation visual QA — iteration 1

Run: `2026-07-19T-iteration-1`, Chrome default WebGL, 1600×900. The run used normal canvas/WASD/Escape controls before a deterministic seven-customer camera cast. Runtime result: zero console/page errors, four distinct held units, a four-person FIFO line by the final probe, checkout in the real `scanning` stage, and no emergency reposition. The seven request aborts occurred during browser shutdown while unrelated deferred course GLBs were still loading.

## Visible defects and revisions

1. The exterior arrival was cropped at the far-left edge, leaving the storefront rather than the visitor as the subject. The camera now derives its aim from the live exterior actor position.
2. The exterior composition aimed behind the walking actor, so the route did not read. The new three-quarter trailing angle keeps the actor against the clubhouse destination.
3. Every frame showed the large `Click to play` prompt after QA repositioned the camera. The harness now installs a screenshot-only clean-frame CSS rule for pointer-lock prompts.
4. Tutorial-completion toasts obscured the lounge patrons even though the tutorial panel was hidden. The harness now removes expired toast nodes immediately before each evidence frame.
5. The lounge camera ray selected the bag display, placing a large inventory prompt over the people. Screenshot framing now suppresses the interaction prompt without changing gameplay UI.
6. Both lounge visitors visually collapsed into one silhouette. The controlled cast now reserves the two distinct authored club-chair sockets.
7. A chair socket was authored at the center of a solid chair collider, causing repeated recovery instead of sitting. Each seat now has a collision-free authored approach point.
8. `Sit` bent the knees while leaving the pelvis and torso at standing height. The articulated character now lowers hips, pelvis, and chest to the seat height in `Sit` mode.
9. There was no physical transition from aisle to chair. Lounge actors now approach beside the chair and ease into the occupied seat over 0.7 seconds.
10. Leaving a chair would have begun navigation from inside its collider. A mirrored eased exit returns the actor to the safe approach point before releasing occupancy.
11. The fixed lounge view stacked the two chairs in depth. The next view moves west and closer to the seating axis so both occupied chairs read separately.
12. The register evidence camera sat behind the outerwear rail and its oversized sign completely hid the service line. The next view moves to the entrance side with a clear diagonal across the queue sockets.
13. The doorway view showed only a flat rear silhouette. The next view shifts east for a three-quarter view of the visitor, swing leaf, and threshold.
14. The first cast assigned ambient targets by customer-id hashing, making the intended seating comparison nondeterministic. The QA fixture now claims chair A and chair B explicitly while the production allocator remains unchanged.

## Evidence inspected

- `01-exterior-approach.png`
- `02-browsing-floor.png`
- `03-lounge.png`
- `04-entry-door.png`
- `05-register-queue.png`
- `visual-2026-07-19T-iteration-1.json`
- recorded WebM under `video/2026-07-19T-iteration-1/`
