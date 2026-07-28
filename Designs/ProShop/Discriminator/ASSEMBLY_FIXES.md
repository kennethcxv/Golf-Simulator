# Assembly fixes — repositioning only, 2026-07-27

Follow-up to `DISCRIMINATOR.md`, which found that the bottom of the pro-shop ranking is
assembly defects, not under-building. Constraint for everything below: **reposition
existing geometry; no new triangles, no new materials, no texture.** Verified by running
`tools/qa/proshop-construction-audit.mjs` before and after every rebuild: parts, welded
shells, triangles, materials and bevel counts are unchanged on all seven touched assets.
Full suite green (2,383 tests) with the rebuilt GLBs.

## 1. The three named defects

| Asset | Defect | Fix |
|---|---|---|
| `087` wall clock | Case and bezel are **solid discs**; both front caps stood in front of the dial (bezel z −0.057, case −0.052, face −0.049), so the shipped clock was a blank walnut dome hiding a complete dial, ticks and boss | Case centre y −0.026 → −0.020, bezel −0.050 → −0.040. The face is now the frontmost opaque disc; the bezel's 22 mm annulus reads as the rim |
| `073` mop bucket | `WringerLeverArm`/`Grip` rotated **+34°** where every centre was computed for **−34°**: the arm's foot landed 156 mm behind the pivot and the grip floated off the arm. Separately the wringer cage hovered 20 mm above the bucket rim on two buried leg stubs | Rotation sign flipped (arm foot now lands exactly on the pivot, grip caps the arm tip to within 1 mm — the authored numbers were always for −34°); whole wringer assembly + lever + markers dropped 21 mm so the body sits 1 mm into the rim top |
| `078` pressure washer | Four `ReelCoil` tori sat **concentric in one plane** at x = 0, 7–31 mm clear of the drum, poking past the flange rims — read as a stack of loose discs; the whole reel was wedged into the cowl's front corner, overhanging the pump void | Coils spread along the drum at 26 mm pitch, each dropped by its radius surplus so its top edge lands exactly on the drum surface (a loose hose hangs from the top of a drum); whole assembly moved (+0.075 y, −0.030 z) so the drum rests on the cowl top and the flanges stop overhanging |

Before/after portraits: `frames/asset_0NN.png` vs `frames_after/asset_0NN.png`, same
instrument, same seed 20260727. The clock reads as a clock — the class of fix is
confirmed.

## 2. The sweep — parts that exist, are correctly authored, and cannot be seen

New instrument: `tools/qa/proshop-part-visibility.js`. Loads each runtime GLB in
isolation (vendor path — no room occlusion, no static batch), flat-colours every opaque
`MESH_` part on the screen-time tool's 6-level ID lattice, renders from 26 directions on
a sphere at 512², counts pixels per part. Transparent parts (glass) are hidden for the
pass and never flagged — glass in front of a dial does not hide it in the shipped game.
Data: `data/part-visibility.json`.

### The 087 class — static burial, no angle can ever reveal the part (6 found in the 37)

| Asset | Part | Cause | Outcome |
|---|---|---|---|
| `071` vacuum | `VacHeadWheelL` (R at 1–7 px) | Both wheels entirely inside the sole footprint | **Fixed**: stance widened to ±0.120 and moved half-proud of the sole's rear edge. R: 0 → 203 px / 23 angles. L remains 0 as a **residual**: the head's inner edge sits against the drum flank, so the drum owns the left wheel's whole hemisphere — a real inboard caster reads the same way; not fixable by repositioning the wheel |
| `077` cloth set | `ClothFoldSeam` | Fold ridge buried 8 mm inside the upper cloth slab | **Fixed**: moved to the stack's front face (y −0.030 → −0.044). 0 → 5,914 px / 22 angles |
| `082` filing cabinet | `CabinetPlinth` | Carcass ran to the floor past the recessed plinth — the authored shadow-gap reveal never existed on screen | **Fixed**: carcass bottom raised to the plinth top (same box, same 12 triangles, shorter — declared: this one is a one-box resize, not a translation). 0 → 37,222 px / 25 angles |
| `093` security camera | `CameraLensBarrel` | Lens assembly fully inside the **opaque** dome — the measured cause of the ranking's "no visible lens" | **Fixed**: Lens pivot + barrel + glass dropped 30 mm; the barrel's lower flank and glass break the dome's underside. 0 → 6,052 px / 19 angles. `DIMENSIONS[93]` height pin 0.11 → 0.13 to match |
| `061` counter shell | `StaffDivider` | Buried inside the **solid** `CounterCarcass`, which fills both counter faces; `StaffLowerShelf` is equally buried but escapes the instrument by z-fighting its coplanar rear face | **Reported, not fixed**: proud placement would breach the asset's own `staff_corridor_clear` contract; the staff bay needs carving open — new geometry, out of scope |
| `099` umbrella stand | `StandDrainTray` | The stand's hollow is faked by a solid black bore cylinder; there is no cavity to see into | **Reported, not fixed**: dead geometry; deletion or true hollowing both out of scope |

Six is more than three, so fixes were applied per the brief; four of the six were
repositionable.

### Flagged by the instrument but NOT the class — hidden at bind pose, revealed by animation

`062` `InternalShelf` (builder marks it `visible_when_door_open=True`), `082`
`CabinetTopBox` (the top drawer's body, slides out), `084` `PrinterSheet` (the print clip
drives it out of the slot), `092` shelves + supplies (door opens), `097` keys (door
opens), `073` `WringerPressPlate` (tips out of the cage at the lever's open pose). These
are interior parts positioned correctly for their reveal.

### Pre-existing, noted

`073`'s slat grate (5 slats, hard-black) is buried inside the solid wringer body — same
family as `099`: the cavity it implies does not exist. Unfixable by repositioning;
recorded here, left alone.

## 3. Reproduction

```bash
"/c/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
  --python tools/blender/build_assets_71_80.py -- --asset 73     # likewise 71, 77, 78
# sheet 09: build_assets_81_90.py -- --asset 82 / 87; sheet 10: build_assets_91_100.py -- --asset 93

node tools/serve.cjs                                             # port 8457
node tools/qa/run-playwright.cjs tools/qa/proshop-part-visibility.js
QA_ONLY_ASSETS="73,78,87" QA_FRAMES_DIR="Designs/ProShop/Discriminator/frames_after" \
  node tools/qa/run-playwright.cjs tools/qa/proshop-asset-contact-sheet.js
node tools/qa/proshop-construction-audit.mjs --out /tmp/after.json   # diff vs data/construction.json
```
