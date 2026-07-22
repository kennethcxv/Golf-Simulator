# Visual QA loop 2 — iteration 1

## Run

- Same 1600×900, DPR 1, fixed laptop-desk camera and deterministic eight-day fixture as baseline.
- Normal controls: visible New Empire → Buy → keyboard `E` → projected mouse clicks through 16 laptop pages.
- Runtime: 0 console errors, 0 page errors, 5 late GLB requests aborted during browser shutdown.
- Comparison: baseline’s missing ledger, property loop, category reputation, reasoned summaries, and pricing consequences are now visibly present.

## Ten visible defects found and resolved

1. **Top-right, every page:** world cash/time chips duplicate the laptop header. Fixed by hiding the world HUD for the seated laptop mode.
2. **Bottom-left, every page:** the tutorial card overlaps the laptop chassis. Fixed by hiding the objective layer during seated laptop use.
3. **Estate navigation:** Property exists in the build but is absent from the 16-page screenshot loop. Fixed by adding Property to the fixed navigation audit.
4. **Home/Finances cash:** the fixture advances a property state without synchronizing the empire wallet, allowing contradictory visible cash. Fixed by advancing through `empireUpdate`.
5. **Property condition:** bunker quality can read from a nonexistent turf-health field and understate live condition. Fixed by deriving bunker condition from actual bunker wear.
6. **Pricing consequence:** rejected high-price purchases are not separated from stockouts in the daily visible explanation. Fixed by recording stock and price misses independently.
7. **Reviews/category reputation:** retail conversion and cleanliness do not visibly explain daily category movement. Fixed with reasoned retail and cleanliness outcomes.
8. **Renovation:** operational upgrade details are below the initial viewport with no retained evidence. Fixed by adding deterministic lower-page capture, then later moving upgrades above decor.
9. **Finances:** weekly and recent-day summaries are below the initial viewport with no retained evidence. Fixed by adding a normal mouse-wheel lower-page capture.
10. **Leak comparison:** listener counts compare Settings before cycling with Pricing afterward, so a different page surface looks like growth. Fixed by comparing Home against Home.

## Result carried forward

Iteration 2 covers all 17 pages and corrects the economic fixture. The overlay fix needed one further revision because the objective panel’s periodic refresh could restore its inline display state.
