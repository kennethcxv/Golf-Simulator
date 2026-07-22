# Visual QA loop 3 — iteration 2

## Run

- 17/17 projected laptop pages reached through normal clicks from the fixed player camera.
- Runtime: 0 console errors, 0 page errors, 4 late shutdown-aborted GLB requests.
- Property now renders a current value, acquisition, operating profit, condition, sale readiness and explainable contributions.

## Ten visible defects found and resolved

1. **Property, bottom-left:** the objective card reappears after its periodic refresh and covers the laptop frame.
2. **Finances, bottom-left:** the same refresh overlay obscures the start of the lower operating summary.
3. **Pricing, bottom-left:** the objective card competes with the lowest navigation controls.
4. **Reviews, bottom-left:** the objective card distracts from the complaint/reputation hierarchy.
5. **Renovation, bottom-left:** the objective card overlaps the physical laptop and makes the application look like a detached overlay.
6. **Property, lower half:** the four-tier progression framework is not visible in the retained top screenshot.
7. **Renovation, lower half:** upgrade requirement/cost/visible/gameplay/value rows are not visible in the retained top screenshot.
8. **Finances, lower half:** seven-day totals and recent-day trend are not visible in the retained top screenshot.
9. **Navigation stress audit:** listener before/after values still describe different active pages.
10. **Final retained screenshot:** it ends on Pricing, preventing an exact Home-before/Home-after visual comparison.

## Focused fix

- Added a `.laptop-mode` boundary with `display:none !important` for world HUD/objective roots so periodic inline refreshes cannot paint across the glass.
- Added normal mouse-wheel captures for Finances, Renovation and Property.
- Forced the listener and final screenshot comparison to Home on both sides of 24 repeated navigation cycles.

## Comparison

Iteration 3 reports both world overlays hidden, captures all three long-page bottoms, and holds active listeners exactly at 93 before and after stress navigation.
