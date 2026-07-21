# Visual QA loop 4 — final polish inspection

## Run

- 17/17 pages reached normally, fixed 1600×900 player camera, video retained.
- 0 console errors and 0 page errors.
- This run occurred during unrelated host-wide QA saturation; its performance numbers are retained but rejected in favor of the later clean `final-performance` sample.

## Twelve visible defects found and fixed

1. **Home KPI row:** `Daily profit` can be read as the still-open day even though it is the latest close. Renamed to `Today profit` with an explicit closed-day subline.
2. **Home immediate risks:** the count exposes only the first cause. It now displays the top two causes and the long-term card retains the full list.
3. **Home next goal:** generic `Progress` does not name the phase. It now reads Readiness, Decision, Next tier or Sandbox.
4. **Finances reasons:** `walkIns` leaks an internal key. Ledger labels now render `Walk-in green fees`.
5. **Finances reasons:** `wagesDayLabor` leaks an internal key. It now renders `Day labour`.
6. **Pricing rows:** consequence copy is too small from the player camera. Management value text was enlarged with a clearer line height.
7. **Upgrade rows:** visible/gameplay/value explanations are too small. Product metadata type was enlarged.
8. **Renovation hierarchy:** operational upgrades are buried after six decor orders. Upgrades now appear immediately below the restoration stage card.
9. **Property offer state:** the top card keeps showing pre-closing estimated proceeds after a live offer exists. It now switches to `Net offer` after closing/outstanding costs.
10. **Valuation breakdown:** `Appraisal rounding` reads like an implementation artifact. It now says `Market rounding adjustment`.
11. **Restoration invested:** paid furniture and physical equipment orders are omitted. They are now capital-classified, shown while paid, and removed by a cancellation reversal.
12. **Property market header:** status chips and guidance run together. The header now wraps with explicit gaps and a readable guidance column.

## Final comparison

The corrected states are visible in `final-accepted/screenshots/`: the Home phase reads `Readiness`, upgrades lead Renovation, finance reasons use player language, and the projected laptop remains free of world overlays.
