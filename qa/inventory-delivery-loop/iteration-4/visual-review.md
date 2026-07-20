# Inventory delivery visual QA — complete pass 3

## Result and comparison

The fixed driver again completed every physical action through trusted controls,
inventory reconciled with no discrepancies, and console/page/HTTP error counts
were all zero. The warm 19-carton stress sample reached 182.02 average FPS,
119.05 1% low, and an 8.4 ms worst frame with stable renderer resources (1,091
geometries, 229 textures). This exceeds both prior passes and the clean-main
baseline sample; the final dedicated comparison still needs to confirm resource
churn across repeated rebuilds.

## Visible defect review

1. **High — carton rack prompt (`08`)**: the stored carton is now visible, but a
   floor-level fallback carton still owns the prompt because prop focus is only
   two-dimensional. Fixed optional 3D prop aim using the player's pitch and each
   physical carton's world height.
2. **High — fallback access (`03`)**: four single-height rows consume the whole
   north work aisle and visually block the carton rack. Repacked the 12-capacity
   fallback as six footprints with two accessible tiers.
3. **High — stacked interaction (`03`)**: simply stacking meshes would let the
   player select a supporting carton through the top carton. Added a physical
   top-first rule: covered supports expose no prompt/tool/action until clear.
4. **High — stable receiving identity (code audit during `03`)**: arrival used
   carton count as the next slot, so clearing a middle bay then landing another
   order could duplicate a transform. Replaced it with explicit free-slot
   allocation and added a matrix assertion for all pad/fallback slots and bay
   reuse.
5. **High — receiving-door clearway (`03`)**: the right fallback column occupies
   the documented east-door clearway. The compact zone now sits wholly west of
   `BACKDOOR_CLEARWAY` while still retaining all 12 physical cartons.
6. **Medium — hand-truck collision (`03`)**: the procedural hand truck intersects
   the left carton row. Moved it to the north-east equipment bay outside the
   compact receiving footprints and door approach.
7. **Medium — fallback marking (`03`)**: the old wide mat no longer matches the
   compact layout and its center text disappears under boxes. Rebuilt it at the
   actual footprint with `12 CARTONS MAX` and `KEEP DOOR CLEAR` markings.
8. **Medium — reserve density (`07`)**: three silhouettes represent six stored
   units, making the rack read half as full as the exact tag. Raised the bounded
   density layer to six faithful silhouettes arranged in two rows.
9. **Medium — reserve composition (`07`)**: the first SKU occupies the far-left
   bay, leaving the visual center empty. Changed bay order to center-first while
   preserving stable slot numbers and exact one-row-per-SKU accounting.
10. **Medium — open-box legibility (`05`)**: both three-unit depth rows overlap
    from the shallow inspection pitch, so six cells read as three. Increased the
    fixed worktable inspection pitch for a clearer top-down count.
11. **Medium — recycling/door spacing (`09`)**: the relocated station is readable
    head-on but its left edge is still visually tight to the stockroom door.
    Shifted the station farther into the work bay and moved cleaning tools away.
12. **Low — recycling screenshot (`09`)**: the prior rack-placement toast remains
    over the station after the QA camera teleport. Added normal walking-equivalent
    delay before capture so retained evidence shows current recycling feedback.

## Final-pass target

Pass 4 must demonstrate all 12 fallback cartons in compact top-first bays,
correct 3D focus on the visible stored carton, six reserve silhouettes for six
units, a readable/clear recycling station, outward flaps and visible box
contents, exact reconciliation, zero runtime errors, and acceptable warm
performance.
