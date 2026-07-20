# Economy/progression baseline visual audit

Captured on 2026-07-19 from `main` commit `0c5137e5f0efac9627ce2309b9e66936f1eeb769`, before economy/progression implementation.

## Fixed run

- Launch: `node tools/serve.cjs` with `PORT=8461`, followed by `node tools/qa/economy-browser-qa.mjs --url=http://127.0.0.1:8461/ --phase=baseline --out=qa/economy-progression/baseline --duration-ms=8000`
- Browser: isolated Playwright Chrome context, 1600x900 CSS pixels, device scale factor 1, headless.
- State: first property acquired through the visible New Empire and Buy buttons; the normal simulation then advanced eight complete days.
- Camera: clubhouse laptop desk at `x=0.45`, `z=232.50`, `yaw=-1.5708`, `pitch=-0.05` for deterministic seed `1089431369`.
- Interaction: keyboard `E` opened the physical laptop; every page was selected by a mouse click on the projected in-world button.
- Console/page errors: none.
- Failed requests: 14 late GLB requests ended as `net::ERR_ABORTED`; the exact URLs are retained in `browser-report.json`.

## Visible defects, ranked by player impact

1. **Critical — Finances, top-left KPI:** the card labeled `NET · TODAY` displays the empire wallet ($60,585), while its subordinate line reports today's -$90. The primary value and label contradict each other, so the player cannot read today's profit.
2. **Critical — Finances, whole page:** there is no transaction ledger. Revenue and expenses exist only as category totals, with no timestamp, description, source transaction, property, or exact-once identity.
3. **High — Home, KPI row:** no reputation or property-value KPI exists, so the long-term restore/operate/flip goal is absent from the first screen.
4. **High — Home, objective panel:** the only goal remains the opening tutorial (`Take a look around`) after eight simulated days; there is no next economic goal, sale-readiness target, or immediate progression risk.
5. **High — Reviews, recent section:** the page says nobody has been in even though Home and Analytics report visitors and eight days of rounds. Operational outcomes are not producing an understandable review trail.
6. **High — Reviews, scorecards:** a single overall reputation (42) and raw factor bars do not expose cleanliness, retail, course, and service reputation categories or their changes/reasons.
7. **High — Pricing, every slider:** controls show the current number and a vague `about right` badge, but not expected demand, satisfaction/reputation consequence, sales likelihood, or the response band the player is entering.
8. **High — Estate navigation:** the only estate page is `Renovation`; there is no property appraisal, valuation breakdown, sale/keep decision, upgrade roadmap, or next-property progress.
9. **High — Finances, summary:** gross revenue, COGS, operating expenses, average transaction, tee utilization, missed sales, no-show impact, condition deltas, and property-value change are absent.
10. **Medium — Finances, recent days:** history is a terse `in / out / net` list that does not explain why a day moved, and the lower entries disappear behind the laptop bezel without any visible affordance that the panel scrolls.
11. **Medium — Renovation, item cards:** purchase rows state only cost and a generic `finish +N`; they omit requirements, visible result, gameplay effect, and property-value contribution.
12. **Medium — Analytics, chart:** the bar chart has no axis, day labels, hover/value labels, revenue/expense split, or ledger reconciliation. It reads as decorative rather than auditable.
13. **Medium — Home and all laptop pages, top-right:** the world HUD duplicates cash and time outside the laptop while the laptop header shows the same information, producing two competing status layers during focused use.
14. **Medium — All laptop pages, bottom-left:** the tutorial card overlaps the laptop frame and remains visually dominant while the player is doing management work.
15. **Low — Home, `SHOP FLOOR` KPI:** `23% clean` and `condition 16` are stacked without explaining whether condition includes cleaning or how either affects reviews/value.
16. **Low — Course, condition table:** zone rows expose raw maintenance signals but no roll-up into the property-condition categories used for valuation and progression.

## Baseline performance

| Scenario | Average FPS | 1% low FPS | Worst frame | Avg draw calls | Avg rendered triangles | Materials | Approx. texture memory | JS heap | Active listeners | UI mutations/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Idle fixed clubhouse camera | 109.59 | 14.21 | 116.60 ms | 1,215.23 | 6,007,195 | 266 | 6,081,256,171 B | 77,128,085 B | 82 | 0 |
| Repeated laptop navigation | 307.84 | 131.10 | 13.80 ms | 1,282.52 | 4,568,686 | 286 | 6,081,256,171 B | 82,179,604 B | 85 | 10.50 |

The listener audit measured 91 active registrations before and after 24 repeated page switches, so no active-listener growth was observed. Texture memory is an RGBA8-plus-mipmap scene estimate rather than a driver allocation; all metric sources are documented in `browser-report.json`.
