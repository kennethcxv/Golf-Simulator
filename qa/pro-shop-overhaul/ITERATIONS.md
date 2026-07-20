# Pro-shop visual iteration log

## Review protocol

Each round was captured from the normal **New Empire -> Relaxed -> Buy Willow Creek Municipal** route in Chrome at 1600 x 900. The clock was pinned to 2:00 PM before each of 18 fixed player-height cameras. Starting-state and fully-stocked tier-three sets were retained from round two onward. The fully-stocked state is an inspection fixture only and does not write a save.

The accepted result is in `iteration-5-accepted/`. Earlier folders are review evidence, not alternate shipped layouts.

## Round 1 - floor plan and fixture language

Evidence: `iteration-1-layout/` (18-camera fully-stocked sweep, zero page errors).

| Visible weakness | Revision made |
|---|---|
| The entrance rail, feature plinth, cartons, and hats competed for the first sightline. | Moved tall inventory to perimeter walls and kept the central entry axis open. |
| The feature plinth was a tall opaque blocker. | Replaced it with a low nested-oak new-arrivals table. |
| Club categories were scattered and shared a generic rack. | Consolidated drivers, irons/wedges, and putters into a continuous west-wall run. |
| Accessories sat on generic broad shelves. | Installed a green pegboard with a visible hook grid and authored product lanes. |
| Apparel created a wall through the middle of the room. | Reduced the island height and moved hanging presentation to the north perimeter. |
| Bags, shoes, and the mirror did not read as one department. | Authored an east-side bag, fitting-room, and shoe sequence. |
| There was no fitting room. | Added a three-sided walnut room with sage curtain, mirror, bench, and sign. |
| Snacks and drinks were absent beside checkout. | Added a compact glass-front refrigerator and four-tier turn-snack rack. |
| Checkout had no scorecard or membership destination. | Added a low brass-and-green service station outside the cashier corridor. |
| Tier three changed availability but not the room. | Added the Tour Vault case and a dedicated putting-studio endpoint. |
| Fixture browsing relied on random offsets. | Authored local browse sockets for every sales fixture. |
| Stocking happened at approximate fixture centers. | Authored separate stocking sockets without changing the inventory transaction model. |

## Round 2 - merchandise presentation and material read

Evidence: `iteration-2-full/` (18 starting-state plus 18 fully-stocked cameras, zero page errors).

| Visible weakness | Revision made |
|---|---|
| Dark club shafts disappeared against walnut and looked unsupported. | Added muted-sage backers, brass rails, sole troughs, and grip clips. |
| Club heads appeared to float or pass through the lower cabinet. | Re-authored six-item club lanes to rest visually in two deliberate rows. |
| Golf bags repeated a dense forest of club shafts. | Built and integrated an empty premium stand-bag GLB for the retail display. |
| The bag sign crossed the product silhouette. | Lowered the rail hierarchy and kept the sign in a separate front strip. |
| Small accessory shapes were generic placeholders. | Added recognizable card packs, divot tools, eyewear, bottles, rangefinders, and umbrellas. |
| The refrigerator did not read as stocked. | Added 24 visible water, sport-drink, and soda forms behind lit shelves. |
| Snacks were unbranded blocks. | Applied an original fictional TURN CRISPS / NINTH HOLE BAR / CADDIE CRACKERS label atlas to 24 packs. |
| The fitting room was too dark and monolithic. | Added sage inset panels, curtain folds, brass trim, and a brighter mirror/bench opening. |
| The premium cabinet read as an opaque cupboard. | Made the carcass hollow with lit glass faces and distinct hero-product risers. |
| The premium corner lacked a retail story. | Added trophy, glove, cap, rangefinder, shoe, and boxed-product silhouettes with an events backdrop. |
| Products had weak category and price hierarchy. | Added consistent cream labels, category headers, brass shelf strips, and line pricing. |
| Full stock could hide scale and clipping errors. | Bound rendered units to the same exact 4-15 authored sockets used by simulation capacity. |

## Round 3 - shopper flow, wayfinding, and state readability

Evidence: `iteration-3-customer-flow-final/` (36 cameras with 10 live shoppers, zero page errors, 0.60-yard minimum separation).

| Visible weakness | Revision made |
|---|---|
| Shoppers could stack at a shared browse point. | Added exclusive browse-socket reservations; 15 reservations were all unique in the stress capture. |
| Random browse jitter put customers close to fixtures and one another. | Transformed authored local sockets into stable world positions. |
| The doorway could become a browsing destination. | Kept all browse sockets inside department bays and outside the entrance lane. |
| Customer routes cut through high center fixtures. | Preserved a low center and perimeter-based department loop. |
| The checkout approach competed with refreshments. | Kept the fridge and snacks against the wall, outside the customer queue and cashier corridor. |
| The bag/fitting area became a dead end. | Kept two-sided circulation around the low bag platform and visible shoe wall. |
| Customers lacked readable department destinations. | Added large category headers and consistent green/cream/brass wayfinding. |
| Stockers had no precise destination feedback. | Stock prompts now name the SKU, target fixture, shelf count, and capacity. |
| Carried product could be hard to correlate with a shelf. | Added a target-slot stock preview while carrying the correct SKU. |
| Tier upgrades could leave fixture visuals stale. | Relayed tier changes through the fixture rebuild path. |
| Customer testing could contaminate checkout acceptance. | Added a QA preparation hook that drains ambient/reservation shoppers through normal removal. |
| Flow claims were based on stills only. | Verified 10 active shoppers, 15 unique reserved sockets, normal WASD movement, and all 18 cameras in-browser. |

## Round 4 - transaction acceptance and environmental polish

Evidence: `iteration-4-final/`, `checkout-final/`, and the focused `iteration-4-rain-fix/` review.

| Visible or interaction weakness | Revision made |
|---|---|
| The handoff palm could overlap the monitor from employee view. | Moved the palm left and used a 48-pixel screen-space handoff target. |
| Overlapping fanned banknotes made the $10 bill pick a neighboring $5. | Selected the nearest visible money-stack center in screen space with a tight 30-pixel threshold. |
| Cash acceptance could continue with the wrong held value. | Added an exact-change assertion before the receipt/bag/handoff sequence. |
| A headless checkout could run past closing time during frame stalls. | Paused only the simulation clock through the normal Space control during the transaction route. |
| Ambient customers could race the deterministic sale customer. | Drained them before the scripted player transaction without bypassing removal bookkeeping. |
| Test bookkeeping could accidentally inspect unrelated sale UIDs. | Tracked the exact two units assigned to the active transaction. |
| A successful sale could be claimed before the shopper cleared. | Waited for the handoff, transaction cleanup, and customer departure. |
| Save/load during a partial scan needed proof against ghost stock. | Recorded a half-scanned reload with both units restored, nothing held, no revenue, and no locked register. |
| Card acceptance lacked a full visual chain. | Recorded scan, total, card presentation, authorization, result, receipt, bag, handoff, and departure. |
| Cash acceptance lacked a full visual chain. | Recorded tender, open drawer, deposit, exact change, receipt, bag, handoff, and departure. |
| Rain streaks followed the player through the clubhouse roof in the final sweep. | Hid the named weather-rain mesh whenever the player camera is inside, retaining live rain level for immediate outdoor resumption. |
| The focused weather correction needed a full-scene regression check. | Ran a nine-camera rain-focused review, then a complete fifth 36-camera accepted sweep with video. |

## Final accepted review

`iteration-5-accepted/` contains 18 starting-state and 18 fully-stocked screenshots plus the full route video. Player-camera review confirmed clear entrance/checkout circulation, readable club and apparel silhouettes, coherent fitting/refreshment/premium departments, and no indoor precipitation. It recorded zero page errors. The sole console diagnostic is a Chromium D3D shader compiler warning; teardown-aborted asynchronous GLB requests are listed in `run.json` and did not affect required assets in the captured scene.
