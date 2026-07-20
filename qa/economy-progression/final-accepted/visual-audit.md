# Final accepted visual QA

## Normal gameplay path

`New Empire` → visible `Buy` → walk to the existing clubhouse laptop fixture → `E` → projected mouse clicks through all 17 pages. Finances, Renovation and Property were also scrolled with a normal mouse wheel. The retained video is `video/final-accepted-normal-controls.webm`.

## Result

- 17/17 pages reached; no page reported a render crash.
- 0 console errors and 0 page errors.
- World HUD and tutorial objective remain hidden while seated.
- Active listeners remain 93 before and after 24 repeated page switches.
- Home shows cash, profit, four-category reputation, property value, two immediate risk causes and the exact next readiness goal.
- Finances shows current itemized entries plus daily, seven-day and recent-day actual-ledger summaries.
- Pricing gives readable response bands and consequences.
- Renovation leads with every operational upgrade and its physical/gameplay/value contract.
- Property exposes 13 live condition categories, exact valuation causes, safe appraisal choices and the four-tier framework.
- The separate normal-control sale recording in `../sale-browser/` proves Keep, Accept, explicit Confirm, payout, backup and next market states.

## Non-blocking observations

- Some GLB requests finish as `net::ERR_ABORTED` when the isolated browser context closes; no asset is missing in retained screenshots and there are no browser errors.
- The isolated sequential performance sample was invalidated by shared-host QA saturation. Two accepted simultaneous base/current pairs show current ahead on average FPS, 1% lows, worst frames, and render resources with no listener growth; details are in `../performance-comparison.md`.
