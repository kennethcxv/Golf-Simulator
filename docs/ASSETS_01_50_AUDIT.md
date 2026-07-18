# Assets 1-50 - Handoff Audit Summary

Durable summary of the Assets 1-50 takeover audit. Full evidence (measured JSON,
contact sheets, per-asset findings) lives under `qa/assets_01_50_master/claude_handoff/`,
which is gitignored. Regenerate with `node tools/qa/build-asset-audit.mjs`.

## Provenance

Every column is measured from files on disk - not read from a prior report.

| Evidence source | What it establishes |
|---|---|
| `tools/qa/assets-01-50-spec.mjs` | asset number -> stem/path contract (authored by the prior session, verified here) |
| `tools/qa/glb-inspect.mjs` | triangles, meshes, materials, textures, sockets, ship-gate flags |
| `tools/qa/glb-dimensions.mjs` | world-space bounding box in cm, from glTF POSITION accessors |
| the five reference contact sheets | independent transcription -> `reference_spec.json` |

## Status

All 50 assets grade **A**. 17 of 50 have been individually inspected against
their reference panel or explicitly ruled on; the remaining
33 are *measured clean* - complete blend -> build -> GLB -> runtime chain,
geometry and dimensions within tolerance, expected sockets present, no ship-gate
violations - but have not had an individual eye put on them. That distinction is
recorded per-asset as `visuallyVerified`.

## Library-level facts

- All 50 have a complete artifact chain. **Nothing is missing.**
- 472 GLBs parse cleanly; **zero** camera/light/generic-name ship-gate violations.
- `Assets/checkout/glb/` <-> `vendor/models/checkout/` are 49/49 byte-identical. The runtime
  loads only from `vendor/`, and the mirror is maintained **manually - no staging script
  exists**. Latent drift risk worth a guard test.
- Sheet 5 (41-50) was built under the `delivery:` commit workstream, not a "Sheet 05"
  label. Cartons are true RSC boxes - hinged flaps, segmented cuttable tape carrying
  `cut_order`, dynamic labels, dual closed/open collision, knocked-down flat state.

## Repairs made in this pass

| # | Asset | Before | After |
|---|---|---|---|
| 26 | Golf Bag Display | plank + bare tube, 354 tris (14% of sheet) | plank deck, welded channel, legs on feet, per-bay cradles, two-rail back; 2414 tris |
| 8 | Receipt | flat 16-segment ribbon, 32 tris | finer curl + cross-width trough, 128 tris |
| 37 | Lounge Coffee Table | solid walnut disc | the steel support ring the sheet names |
| - | all exports | mesh datablocks shipped as `Cylinder.008` | datablocks inherit their object name |

## Accepted deviation

- **Asset 1 (CHECKOUT COUNTER)** - renders 320x100x105 vs sheet 200x70x90. Layout-driven: COUNTER.len=3.2 anchors the staging/POS/bagging choreography in shopLayout.js. Shrinking to sheet spec breaks checkout. Deliberate, documented deviation.

## Dimension rulings

The sheets quote a nominal body size; a measured bounding box also contains whatever
protrudes. These were ruled by looking at the asset, not by moving a threshold.

| # | Asset | Ruling |
|---|---|---|
| 3 | PAYMENT TERMINAL (CARD READER) | sheet quotes the 6 cm device body; the model includes its angled counter stand. Keypad, chip slot, contactless chevrons and screen all match. |
| 4 | CASH DRAWER | sheet quotes the drawer carcass; measurement includes the front lip and lock bezel. |
| 5 | RECEIPT PRINTER | sheet quotes the printer body; measurement includes the paper spool and feed lip. |
| 6 | SHOPPING BAG (UPRIGHT) | sheet quotes the bag body; measurement includes the rope handles standing proud of the rim. |
| 49 | BOX CUTTER | 2.3 cm vs 2.0 cm is the 3 mm blade slider standing off the body. |

## Not yet done

- The 33 measured-clean assets have not been individually eyeballed.
- No in-game runtime pass: stocking, checkout, delivery, customer carry and save/reload
  were not exercised against a running build in this session.
- No staging-script guard for the manual `Assets/ -> vendor/` mirror.