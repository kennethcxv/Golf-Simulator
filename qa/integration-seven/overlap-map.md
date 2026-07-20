# Seven-branch overlap map

Exactly 17 paths are changed by more than one completed branch. Classifications describe the architectural risk; no conflict is resolved with an unexamined whole-file “ours” or “theirs” choice.

| File | Branches | Classification |
|---|---|---|
| `ASSET_SOURCES.md` | `furniture-customization`<br>`course-maintenance` | Compatible additive change |
| `src/main.js` | `furniture-customization`<br>`inventory-delivery-loop`<br>`course-maintenance`<br>`golf-operations`<br>`economy-progression`<br>`player-experience-polish` | Shared API conflict; State ownership conflict; Input conflict; Save-schema conflict |
| `src/render3d/clubhouse.js` | `furniture-customization`<br>`inventory-delivery-loop`<br>`customer-simulation`<br>`golf-operations`<br>`economy-progression` | Shared API conflict; State ownership conflict; Performance conflict |
| `src/render3d/clubhouse/buildMode.js` | `furniture-customization`<br>`player-experience-polish` | Input conflict; UI conflict |
| `src/render3d/clubhouse/registerMode.js` | `golf-operations`<br>`economy-progression` | Shared API conflict; State ownership conflict; Input conflict |
| `src/render3d/courseScene.js` | `inventory-delivery-loop`<br>`course-maintenance`<br>`player-experience-polish` | Shared API conflict; Performance conflict; Audio conflict |
| `src/sim/checkout.js` | `inventory-delivery-loop`<br>`economy-progression` | State ownership conflict; Shared API conflict; Save-schema conflict |
| `src/sim/economy.js` | `golf-operations`<br>`economy-progression` | State ownership conflict; Shared API conflict; Save-schema conflict |
| `src/sim/reservations.js` | `customer-simulation`<br>`golf-operations`<br>`economy-progression` | State ownership conflict; Shared API conflict; Save-schema conflict |
| `src/sim/reviews.js` | `customer-simulation`<br>`economy-progression` | State ownership conflict; Shared API conflict |
| `src/sim/shop.js` | `inventory-delivery-loop`<br>`economy-progression` | State ownership conflict; Shared API conflict; Save-schema conflict |
| `src/sim/state.js` | `inventory-delivery-loop`<br>`customer-simulation`<br>`course-maintenance`<br>`golf-operations`<br>`economy-progression` | Save-schema conflict; State ownership conflict |
| `src/styles.css` | `furniture-customization`<br>`course-maintenance`<br>`golf-operations`<br>`economy-progression`<br>`player-experience-polish` | UI conflict |
| `src/ui/laptop.js` | `inventory-delivery-loop`<br>`golf-operations`<br>`economy-progression`<br>`player-experience-polish` | UI conflict; Shared API conflict; Performance conflict |
| `src/ui/marketplacePanel.js` | `economy-progression`<br>`player-experience-polish` | UI conflict; Shared API conflict |
| `src/ui/ui.js` | `economy-progression`<br>`player-experience-polish` | UI conflict; Shared API conflict |
| `tools/qa/register-sale.js` | `inventory-delivery-loop`<br>`customer-simulation` | Test conflict |
