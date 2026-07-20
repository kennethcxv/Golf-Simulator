# Inventory delivery visual QA — complete pass 1

`iteration-1/` is retained as the failed fixed-duration harness attempt. This is
the first complete normal-controls visual pass.

## Reproduction

```powershell
$env:QA_BASE_URL='http://127.0.0.1:8467/'
$env:QA_OUTPUT_DIR='qa/inventory-delivery-loop/iteration-2'
$env:QA_RESULT_PATH='qa/inventory-delivery-loop/iteration-2/result.json'
node C:\Users\Kenneth\Documents\GitHub\Golf-Flipper\tools\qa\run-playwright.cjs tools/qa/inventory-delivery-visual.js --bootstrap
```

Viewport: 1600 × 900. Fixed camera poses are recorded in
`tools/qa/inventory-delivery-visual.js`. The player opened the laptop and
receiving door, placed the carton, made two cutter holds, opened both flaps,
removed an armful, stored it in reserve, placed a sealed carton on the carton
rack, and recycled a flattened carton using trusted keyboard/mouse events.

Result: inventory reconciled with no discrepancies; zero console errors, page
errors, or HTTP error responses. The run retained 10 screenshots. Measured in
the loaded 19-carton stress scene: 46.64 average FPS, 6.21 1% low, 194.5 ms
worst frame, 1,106 renderer geometries, and 229 textures. This sample is not yet
accepted because it was taken immediately after several rebuilds and must be
repeated with the dedicated warm comparable performance probe.

## Visible defect review

Ranked by player impact:

1. **Critical — open carton, center (`05`)**: both opened flaps rotate inward
   and stand upright, completely hiding the products. Fixed by reversing the
   hinge rotation so panels fold outward and down.
2. **Critical — open carton, center (`05`)**: the required truthful product
   silhouettes cannot be inspected because of the flap occlusion. The hinge
   fix exposes the six-cell contents layer for the next comparison.
3. **High — reserve rack, full frame (`07`)**: the camera is inside the rack,
   leaving only shelf fascia and ceiling visible. Fixed camera setback from
   0.8 to 1.65 yards.
4. **High — reserve rack, full frame (`07`)**: six stored units are absent from
   the viewed rack because the renderer assigns the first reserve line to the
   remote short rack. Fixed deterministic rack order so the primary east rack
   receives the first 12 SKU rows once, without duplication.
5. **High — carton rack, full frame (`08`)**: the camera is inside the north
   rack and the stored carton is concealed despite its interaction prompt.
   Fixed with a 1.65-yard inspection pose.
6. **High — recycling station, lower frame (`09`, `10`)**: the camera is too
   close to identify the authored two-stream station; only its upper rail is
   visible. Fixed with a wider, lower inspection pose.
7. **High — worktable, center (`04`, `05`)**: the carton fills nearly the full
   height, hiding the authored table silhouette and making the work area feel
   cramped. Fixed by moving the fixed player pose back 0.8 yards.
8. **Medium — carried armful, lower frame (`06`)**: palms and sleeves are
   almost entirely cropped below the viewport, so products appear to float.
   Fixed by widening the grip and raising/further seating the first-person
   carry group, including its per-frame breathing baseline.
9. **Medium — receiving fallback, floor (`03`)**: deterministic cartons have
   arbitrary per-ID rotations, reading as a loose physics spill instead of
   marked receiving bays. Fixed by aligning pad/fallback carton rotation.
10. **Medium — van unloading gap, lower center (`02`)**: tall bag cartons crowd
    the open rear doors and weaken the vehicle silhouette. Fixed by moving the
    parked van 0.55 yards farther from the pad while retaining door reach.
11. **Medium — worktable hierarchy (`05`, `06`)**: the focus prompt and feedback
    toast overlap the already oversized foreground carton/armful, producing
    three competing center layers. The wider worktable pose and smaller visual
    footprint are queued for the next comparison.
12. **High — stress performance (`result.json`)**: the immediate post-rebuild
    1% low and worst frame are visibly below the clean-main baseline. Pending a
    warm like-for-like probe; if reproduced, profile and reduce rebuild/render
    cost before acceptance.

## Comparison target

The next complete pass must visibly show outward flaps and contents, both
hands, the exact reserve row and quantity tag, the stored carton, and the full
recycling station. It must also retain the zero-error/reconciled result.
