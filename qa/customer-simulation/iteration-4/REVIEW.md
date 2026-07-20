# Customer simulation visual QA — iteration 4

Run: `2026-07-19T-iteration-4`, Chrome default WebGL, 1600×900. The corrected visual front is now consistent in the exterior walk, shelf reach, seated poses, and service line. The final probe records the door fully open at 1.92 radians, `Door` animation during entry, five unique held units, FIFO positions 0–3, the real checkout scanner active, no recovery, no emergency reposition, and zero console/page errors.

## Visible defects and revisions

1. The dynamic door composition finally included both visitor and open leaf, but a porch column crossed the actor's torso. The final verification camera flips to the opposite perpendicular side of the actor-to-door axis.
2. The second shopper's two-item basket remained low and easy to confuse with the static basket stack. The held basket anchor moves from 0.76 to 1.02 local height and slightly farther forward.
3. The held basket itself was empty, so it did not visually substantiate the two reserved units. It now contains two compact category-colored product boxes derived from the actual cart SKU ids.
4. Basket contents could have allocated arbitrary materials per customer. The additions use the existing bounded shared material map keyed by category color.
5. The impatience ring was not visible even after the queue wait crossed its threshold. Its old 1.74 height placed it inside the roughly 1.95-high head/cap silhouette; it moves to 2.08.
6. The patience marker was too small to read at the standard service-line camera distance. Its authored radii increase modestly from 0.105/0.126 to 0.125/0.154 while retaining restrained opacity.
7. The diagnostics could not distinguish a broken invisible marker from a shopper whose wait had not crossed the threshold. Actor diagnostics now report both wait seconds and patience seconds.
8. The lounge caps still read close to pure white under the ceiling fixtures. The warm-cream profile value is lowered again to a muted natural canvas tone.
9. The carried-goods proof was limited to a visual guess. Basket contents now come from `actor.entity.cart`, preserving the exact identity/accounting relationship already used by checkout.
10. A fallback path could have produced an empty invisible basket if the Blender basket were unavailable. It falls back to the first real cart product visual.
11. The browse frame now proves a forward reach, but the final report should correlate it with the exact animation. Existing iteration-3 diagnostics are retained and expanded rather than adding screen-only labels.
12. The clean frame retains normal money/time/condition/view HUD while suppressing only tutorial and interaction overlays, avoiding a misleading UI-free beauty render.

## Evidence inspected

- `01-exterior-approach.png`
- `02-browsing-floor.png`
- `03-lounge.png`
- `04-entry-door.png`
- `05-register-queue.png`
- `visual-2026-07-19T-iteration-4.json`
- recorded WebM under `video/2026-07-19T-iteration-4/`
