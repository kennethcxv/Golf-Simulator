# Inventory delivery visual QA — complete pass 2

## Result and comparison

The same 1600 × 900 fixed-camera driver completed every trusted normal-control
action. Inventory reconciliation passed with no discrepancies and the driver
recorded zero console errors, page errors, or HTTP error responses. The loaded
19-carton stress scene measured 98.38 average FPS, 18.02 1% low, and 69.4 ms
worst frame (1,091 renderer geometries, 229 textures). That is a clear recovery
from pass 1's 46.64 average FPS, but the tail remains below the clean-main warm
baseline and is not yet accepted.

## Visible defect review

1. **Critical — open carton interior (`05`)**: the prompt reports 12 units but
   the case reads empty because product tops remain below the rim. Fixed by
   deriving each product's top surface from its measured bounds and fill ratio.
2. **Critical — reserve shelf (`07`)**: the exact `RESERVE ×6` tag is visible,
   but all three product silhouettes are absent. Fixed the multi-material bake
   path to preserve nested holder transforms when it reparents labelled packs.
3. **High — reserve shelf (`07`)**: a quantity card with no goods looks like a
   placeholder rather than physical inventory. The transform fix restores the
   product row while retaining one exact, non-duplicated tag.
4. **High — carton rack (`08`)**: the visible stored carton is not the active
   interaction; the prompt says `Safe receiving` for an occluded floor carton.
   Fixed focus scoring to favour reticle alignment over a nearer peripheral prop.
5. **High — carton rack aisle (`03`, `08`)**: ten fallback cartons fill the
   approach to the north rack, making nearest-distance-only targeting especially
   fragile. Reticle-weighted focus is fixed now; a more compact receiving layout
   remains a pass-3 visual target.
6. **High — recycling corner (`09`)**: the station is squeezed between the east
   rack and stockroom door, so it is difficult to approach without another prop
   winning focus. Moved it to the clear south work aisle.
7. **High — recycling silhouette (`09`)**: the player sees the station obliquely;
   `FLAT` and `PAPER` letters overlap foreground geometry and the two bins are not
   readable as a pair. Rotated the relocated asset to face the work aisle and
   changed its collider footprint to match.
8. **Medium — recycling door clearance (`09`)**: the carried slab and station
   occupy the door-side corner, visually weakening the safe egress path. The new
   location is entirely clear of the stock-door opening and swing.
9. **Medium — fallback mat (`03`)**: four rows obscure nearly all of `SAFE
   RECEIVING / KEEP DOOR CLEAR`; only the border remains legible. Pending a
   compact, accessible stack/bay revision if pass 3 confirms it can retain
   one-box-at-a-time interaction.
10. **Medium — hand-truck edge (`03`)**: the left carton column overlaps the red
    hand truck, reading as interpenetration. Pending the same receiving-layout
    revision.
11. **Medium — carried products (`06`)**: hands now touch the load and include
    thumbs, but the straight six-pack grid remains rigid and the sleeves form a
    wide V. Retain for pass-3 comparison before further adjustment; exact product
    identity and count are clear.
12. **High — stress tail performance (`result.json`)**: average FPS improved by
    111%, but 1% low remains only 18.02 FPS versus the clean-main warm baseline's
    56.24 FPS. A comparable warm probe and rebuild-churn profile remain required.

## Revision scope for pass 3

Verify visible box contents, visible reserve products, correct stored-carton
focus, and a front-facing accessible recycling station. Then evaluate a compact
fallback layout and profile the remaining tail-frame spikes without weakening
unit truth or persistence.
