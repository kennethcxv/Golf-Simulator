# Inventory delivery visual QA — complete pass 4

## Result and comparison

The fourth complete comparison passed the whole trusted-control sequence. The
worktable carton showed six real product packs, the reserve rack showed the same
six units and its exact quantity tag, the unopened rack carton owned the reticle,
and inventory reconciled with zero console, page, or HTTP errors. The warm sample
was 180.66 average FPS, 119.05 1% low, and 8.4 ms worst frame with 1,091 renderer
geometries and 229 textures.

## Visible defect review

1. **High — carton-rack occlusion (`08`)**: the oversized red hand truck hides
   the right side and lower bay of the operational carton rack. Replaced it with
   the existing authored GLB and parked it beside the worktable, outside both
   rack picking aisles.
2. **High — misleading safe-zone count (`03`)**: a legacy open-clutter carton
   behind the receiving stack makes ten sealed cartons read as eleven mixed
   cartons. Moved restoration clutter out of the operational stockroom.
3. **High — recycling focus theft (`10`)**: after the flat carton disappears,
   the reticle resolves to `Old clutter` through the recycling station. Added a
   versioned restoration-layout migration so old profiles relocate that pile.
4. **High — recycling clearance (`09`)**: the same open-clutter pile is wedged
   between the door and the station, eliminating the left working clearance.
   Relocated both legacy stockroom piles to believable office dead zones.
5. **High — saved-profile parity (`03`, `09`)**: changing only fresh-game layout
   data would leave the two visible conflicts in existing saves. Added
   `layoutVersion: 2` migration and retained every pile's hauled/unhauled flag.
6. **Medium — equipment silhouette (`03`)**: the procedural hand truck reads as
   one thick red slab rather than rails, axle, wheels, and toe plate. Swapped in
   the Blender-authored prop already shipped in the clubhouse asset set.
7. **Medium — focal hierarchy (`08`)**: saturated red equipment is brighter than
   the carton label and pulls the eye away from the stored SKU. The authored
   shared-material version is restrained and no longer occupies this frame.
8. **Medium — rack affordance (`08`)**: the foreground hand-truck frame visually
   suggests a barrier in front of a rack that is meant to be directly pickable.
   Its new equipment-bay position leaves the complete shelf frontage open.
9. **Medium — fallback equipment access (`03`)**: the hand truck is parked behind
   the compact carton stack, implying that receiving equipment becomes trapped
   whenever fallback bays are occupied. It now remains reachable beside the
   worktable throughout a full 12-carton fallback load.
10. **Medium — unrelated feedback (`09`)**: the prior rack-placement toast is
    still faintly superimposed over the recycling evidence. Increased the
    normal-walk settling interval before the recycling capture.
11. **Low — duplicate cardboard language (`09`)**: an unrelated open clutter
    carton beside a carried flat makes it unclear which cardboard is actionable.
    The migration removes the decorative carton from every delivery work zone.
12. **Low — post-action confirmation (`10`)**: `Cardboard recycled` competes with
    the immediately exposed clutter prompt, weakening completion feedback.
    Clearing the focus conflict leaves the confirmation and empty station as the
    only post-action read.

## Focused final pass

`final-normal-controls/` verifies these fixes on a migrated persistent browser
profile. The full sequence completed again with exact reconciliation and no
captured runtime errors. The final retained run reached 162.3 average FPS,
117.65 1% low, and an 11.1 ms worst frame with 1,162 geometries and 229 textures.
It additionally carried six reserve units back off the rack and stocked all six
onto the compatible retail display through the normal hold interaction. The
carton rack is unobstructed, the fallback count is visually unambiguous, and the
recycling station retains focus before the action and exposes no unrelated prop
afterward.
