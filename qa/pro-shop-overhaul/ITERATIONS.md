# Pro-shop acceptance visual iteration log

## Status and protocol

The earlier iteration folders remain historical design evidence, but they are not counted toward final acceptance. The acceptance series below began after the completion audit reopened the unmet production gates.

Every counted pass launches the shipped game in hardware-accelerated Chrome at 1600 x 900, starts through **New Empire -> Relaxed -> Property Market -> Buy**, closes the guide with its real keyboard control, and proves movement with a canvas click plus Arrow/W input before any fixed-camera inspection. Each pass captures the same 18 starting-state and 18 fully-stocked player-height cameras, a route video, console/network diagnostics, and fixed performance scenarios. Fully stocked tier-three state is an inspection fixture only and does not write a save. Natural checkout acceptance is tracked separately and never uses state injection or QA transaction hooks.

The four-pass acceptance gate is still in progress. The sole console diagnostic in pass one is a Chromium/Direct3D shader-compiler warning. Recorded `ERR_ABORTED` requests are teardown or superseded background loads; no required shop asset failed and no HTTP error was recorded.

## Acceptance pass 1 - retail information hierarchy

Evidence:

- Before: `acceptance-visual-1-before/`
- After: `acceptance-visual-1-after/`
- Both runs: 36 fixed screenshots, route video, fresh-save boot record, normal-control proof, console/network log, and metrics in `run.json`
- Normal-control proof: 3.09 yards before and 2.94 yards after, with a visible yaw change
- Full premium normal-control walk: 93.75 FPS before; 105.03 FPS after. Active event listeners remained 92 in every measured scenario.

| Visible defect found in the before sweep | Revision verified in the after sweep |
|---|---|
| Three club-bay headers were oversized and competed with the club silhouettes. | Reduced each header from 1.90 x 0.30 m to 1.55 x 0.20 m. |
| Club price strips read as broad white panels. | Narrowed the rail to 2.30 x 0.14 m. |
| The central feature-table price strip dominated the low display. | Reduced it from 1.82 m to 1.55 x 0.14 m. |
| The accessory header was wider than its product field. | Reduced it to 1.35 x 0.16 m and its price rail to 0.14 m high. |
| The ball-wall header obscured upper packages at oblique angles. | Reduced it to 1.05 x 0.15 m with a narrower 2.30 m price rail. |
| The hat label felt detached from the compact fixture. | Reproportioned it to 0.66 x 0.12 m and matched its price strip to the bay. |
| The shoe label was visually heavier than the authored shoe forms. | Reduced it to 0.94 x 0.14 m and limited its price rail to 2.10 m. |
| The apparel-wall header overpowered the shirts. | Reduced it to 1.35 x 0.16 m with a 0.14 m price rail. |
| The fitting-room label competed with the curtain and mirror opening. | Reduced it to 0.76 x 0.14 m. |
| The snack-rack header blocked the top product row from player height. | Reduced it to 0.62 x 0.12 m and its price rail to 1.20 x 0.12 m. |
| The long `Scorecards / Baskets` label crowded the service station. | Renamed it `Baskets & cards` and reduced the board to 0.66 x 0.13 m. |
| The Tour Vault label made the premium cabinet look like a sign plinth. | Reduced it to 0.95 x 0.16 m. |
| The putting-demo label was nearly as wide as its small rack. | Reduced it to 0.50 x 0.12 m. |
| The bag-platform sign and price rail crossed the merchandise silhouette. | Reduced the sign to 0.76 x 0.14 m and the rail to 1.75 x 0.14 m. |
| The club camera cut off the end bays, weakening comparison coverage. | Moved the fixed player-height camera inward to include all three bays. |
| The accessories camera exaggerated perspective and hid the product lanes. | Moved the fixed camera closer to the bay centerline. |

## Acceptance pass 2 - comparison discipline and department hierarchy

Evidence:

- Before: `acceptance-visual-2-before/`
- Accepted after: `acceptance-visual-2-after-accepted/`
- Both runs: 36 fixed screenshots, route video, fresh-save boot record, normal-control proof, console/network log, and metrics in `run.json`
- Accepted after normal-control proof: 2.93 yards and 1.362 radians of yaw
- Accepted after clock proof: the real Space control changed speed from 1 to 0; clock drift over the assertion window was exactly 0 minutes
- Customer flow: six active shoppers, 14 unique reserved browse/experience sockets, 1.494-yard minimum separation, plus separate browsing and checkout-approach screenshots
- Exact stress state: ten customers spawned in total. Full-premium normal-control walk was 114.59 FPS average / 59.88 FPS 1% low, 1,870.22 draw calls per frame, 1,190 geometries, 241 textures, 108.24 MiB JavaScript heap, and 92 active listeners.

The before run's stress sample retained 16 actors because it added ten to the six already present. That is a useful overload result but not an exact ten-customer comparison. The accepted-after harness corrects the scenario to ten active customers total; final performance acceptance uses this corrected protocol on both sides.

| Visible or evidence defect found in the before sweep | Revision verified in the accepted after sweep |
|---|---|
| Random shoppers blocked the entrance, checkout, and club comparison cameras. | Isolated all 36 matched cameras from actors and recorded live flow in a separate two-camera set. |
| The pinned clock had advanced to 2:07 PM by the close cameras. | Paused through the real Space control; every fixed frame now reads exactly 2:00 PM. |
| The stress scenario added ten shoppers on top of six and mislabeled the result. | Counted the exported customer array and spawned only enough actors to reach ten total. |
| Pausing comparison cameras initially froze newly spawned flow actors outside. | Resumed with Space for a 16-second real walk-in, then paused again for readable flow evidence. |
| The shoe camera cropped the bottom price rail and exaggerated the fixture. | Moved it back and left, lowered the sightline, and retained the full shoe/fitting relationship. |
| The snack camera made two small fixtures fill nearly the whole screen. | Moved it back to show snack, fridge, fitting, bags, and shoe context together. |
| The fitting camera made the privacy wall read as a blank foreground slab. | Shifted it into the aisle to reveal the curtain opening, inset panels, shoe wall, and lounge edge. |
| The Tour Vault camera cropped the lounge and made the cabinet feel detached. | Pulled back to include the lounge chairs, window, events board, and full cabinet. |
| Bright cream category labels floated like paper taped onto the shoe, ball, hat, apparel, and fitting fixtures. | Converted those headers to the shop's charcoal-and-brass department treatment. |
| The Golf Shoes header still overpowered the actual shoe silhouettes. | Reduced it again to 0.86 x 0.13 m. |
| The fitting-room header was wider than the visible doorway. | Reduced it to 0.68 x 0.12 m. |
| The Cold Drinks board dominated the compact refrigerator. | Reduced it to 0.54 x 0.12 m while keeping player-height legibility. |
| The Turn Snacks board obscured branded packages. | Reduced it to 0.50 x 0.10 m, narrowed the price rail, and changed it to charcoal/brass. |
| Remaining cream signs and price strips were stark white against warm walnut. | Shifted their fields to restrained warm-cream tones without changing text contrast. |
| Layered Tour Vault glazing looked grey and hid the lower products. | Reduced display-glass opacity from 0.075 to 0.045 and raised transmission from 0.12 to 0.20. |

## Acceptance pass 3 - shoppers and merchandise rails

Evidence:

- Before: `acceptance-visual-3-before/`
- After: `acceptance-visual-3-after/`
- Both runs: 36 clean fixed screenshots, two separate customer-flow screenshots, route video, fresh-save boot record, normal-control and clock proof, console/network log, and exact-ten metrics in `run.json`
- After normal-control proof: 2.98 yards and 1.253 radians of yaw
- Customer flow after: six active shoppers, nine unique reserved browse/experience sockets, 1.139-yard minimum separation, and ten shoppers spawned in total for stress
- Full-premium normal-control walk: 92.71 FPS / 14.39 FPS 1% low before; 108.02 FPS / 59.52 FPS 1% low after. Active listeners remained 92. The character revision is 1,724 triangles per articulated figure.

| Visible defect found in the before sweep | Revision verified in the after sweep |
|---|---|
| Customer torsos were featureless boxes. | Replaced them with tapered eight-sided polo forms. |
| Heads appeared disconnected above the shirt. | Added an actual neck between torso and skull. |
| Shirts had no neckline or garment construction. | Added a two-piece contrasting polo collar. |
| The pelvis and shirt met as an unbroken color block. | Added a restrained dark belt and tapered trouser waist. |
| Upper arms were rectangular sticks. | Rebuilt them as low-poly articulated capsules. |
| Forearms were rectangular sticks. | Rebuilt them as slimmer skin-toned capsules. |
| Arms ended abruptly without hands. | Added rounded hands that inherit elbow animation. |
| Thighs and calves read as four separate boxes. | Rebuilt both articulated leg segments as rounded low-poly capsules. |
| Faces had no orientation cues, making browsing direction hard to read. | Added small eyes, nose, and ears while keeping the stylized scale. |
| Caps were floating cylinders with oversized rectangular brims. | Rebuilt caps as fitted half-domes with smaller brims. |
| Bare-head hair floated above the skull. | Lowered and vertically fitted the hair cap to the head. |
| Bright cream price slabs pulled attention away from merchandise across every department. | Converted all price rails to deep-green fields with warm-cream type. |
| Golf Essentials was the last large cream department header in the main wall run. | Converted it to the same charcoal-and-brass treatment as neighboring departments. |
| The Golf Bags label crossed the lounge sightline as a broad cream panel. | Reduced it to 0.62 x 0.10 m and integrated it into the back rail in charcoal/brass. |
| The apparel camera cropped the left header and club wall. | Moved the fixed camera back to show the full apparel wall, center table, and adjacent clubs. |
| The bag camera made the fitting-room side wall the dominant foreground object. | Shifted the camera into the main aisle to show the four-bag platform, lounge, fitting room, and shoes together. |

## Acceptance pass 4

Pending. It must independently document at least ten visible defects, implement revisions, rerun the complete 36-camera protocol, and retain before/after evidence before the visual gate can close.
