# Assets 1-50 - Handoff Audit Summary

Takeover audit of the Assets 1-50 library. Full evidence (measured JSON, contact
sheets, runtime captures) lives under `qa/assets_01_50_master/claude_handoff/`,
which is gitignored. Regenerate with `node tools/qa/build-asset-audit.mjs`.

## Provenance

Every column is measured from files on disk - not read from a prior report.

| Evidence source | What it establishes |
|---|---|
| `tools/qa/assets-01-50-spec.mjs` | asset number -> stem/path contract (prior session, verified here) |
| `tools/qa/glb-inspect.mjs` | triangles, meshes, materials, textures, sockets, ship-gate flags |
| `tools/qa/glb-dimensions.mjs` | world-space bounding box in cm from glTF POSITION accessors |
| `tools/blender/render_glb_preview.py` | turntable preview of any GLB (Sheet 5 had none) |
| the five reference contact sheets | independent transcription -> `reference_spec.json` |
| the running game | live scene traversal, frame timing, save/reload |

## Status

All 50 grade **A**. **50 of 50** have been individually inspected against their
reference panel or explicitly ruled on - recorded per-asset as `visuallyVerified`.

Three deviations are recorded rather than silently "fixed":

- **Asset 1 (CHECKOUT COUNTER)** - deviation-accepted: renders 320x100x105 vs sheet 200x70x90. Layout-driven: COUNTER.len=3.2 anchors the staging/POS/bagging choreography in shopLayout.js. Shrinking to sheet spec breaks checkout. Deliberate, documented deviation.
- **Asset 42 (HAND TRUCK (DOLLY))** - deviation-noted: structure matches (frame, two wheels, toe plate) but finished in house green; the sheet shows bare silver metal
- **Asset 43 (STOCKING CART)** - deviation-noted: structure matches (3 shelves, casters, push handle) but finished in house green; the sheet shows dark grey

## Runtime verification

Driven against the running game (save loaded via Continue, clubhouse instantiated):

| Check | Result |
|---|---|
| Save load | clubhouse ready in 2.3 s |
| Console errors | 0 |
| Frame time | median 4.4 ms (~227 fps), p95 7.5 ms |
| Scene | 6254 nodes, 3636 visible meshes, 3.31 M scene triangles |
| Rebuilt geometry live | `Deck_Plank_01/06`, `Cradle_Arm_01_L`, `Mid_Rail`, `Support_Ring` x2, `Tuft_Button_11` x2 all present |
| Stale geometry gone | `Ring_Shelf` (the old solid disc) count 0 |
| Sockets | `BAG_SLOT_01..05` intact |

Note: GLB socket empties are authoring metadata. The runtime places stock from the
`fixtureSlots.js` data registry at computed world positions, not by parenting to the
empties - so an empty socket node with zero children is expected, not a fault.

## Library-level facts

- All 50 have a complete blend -> build -> GLB -> runtime chain. **Nothing is missing.**
- 472 GLBs parse cleanly; **zero** camera/light/generic-name ship-gate violations.
- `Assets/checkout/glb/` <-> `vendor/models/checkout/` are 49/49 byte-identical, now
  guarded by `tests/checkout-kit-runtime-mirror.test.js` (the copy is manual).
- Sheet 5 (41-50) was built under the `delivery:` workstream, not a "Sheet 05" label.
  Cartons are true RSC boxes - hinged flaps, segmented cuttable tape carrying
  `cut_order`, dynamic labels, dual collision states, knocked-down flat state.

## Repairs made in this pass

| # | Asset | Before | After |
|---|---|---|---|
| 26 | Golf Bag Display | plank + bare tube, 354 tris (14% of sheet) | plank deck, welded channel, legs on feet, per-bay cradles, two-rail back; 2414 tris |
| 8 | Receipt | flat 16-segment ribbon, 32 tris | finer curl + cross-width trough, 128 tris |
| 37 | Lounge Coffee Table | solid walnut disc | the steel support ring the sheet names |
| 36 | Lounge Armchair | flat leather, no cushion relief | tufting + tapered visible feet |
| 49 | Box Cutter | brass body, read as a gold tool | `M_CutterSafetyYellow` per the sheet |
| - | all exports | mesh datablocks shipped as `Cylinder.008` | datablocks inherit object names |
| - | staging | manual mirror, unguarded | mirror guard test, proven by injected drift |

## Method note

A triangle count below the sheet estimate is **not** evidence of a defect. The sheets
quote rough polygon figures, and several fixtures hit the reference silhouette
efficiently - assets 24 and 34 sit at 34%/37% of budget and are production-correct,
while 26 at 14% genuinely was a plank and a tube. Only inspection separates those, so
the audit records a visual verdict per asset and never downgrades on ratio alone.

## Not yet done

- Interaction driving (pick up / stock / bag / cut open a carton via real input) was
  not exercised; runtime verification was scene-state and diagnostics based.
- Assets 42 and 43 remain in house green against a reference showing bare metal.