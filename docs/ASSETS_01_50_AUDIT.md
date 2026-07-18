# Assets 1-50 — Handoff Audit Summary

Durable summary of the Assets 1–50 takeover audit. Full evidence (measured JSON,
screenshots, per-asset findings) lives under `qa/assets_01_50_master/claude_handoff/`,
which is gitignored. Regenerate with `node tools/qa/build-asset-audit.mjs`.

## Provenance

Every column is measured from files on disk — not read from a prior report.

| Evidence source | What it establishes |
|---|---|
| `tools/qa/assets-01-50-spec.mjs` | asset number → stem/path contract (authored by the prior session, verified here) |
| `tools/qa/glb-inspect.mjs` | triangles, meshes, materials, textures, sockets, ship-gate flags |
| `tools/qa/glb-dimensions.mjs` | world-space bounding box in cm, from glTF POSITION accessors |
| the five reference contact sheets | independent transcription → `reference_spec.json` |

## Grade distribution

| Grade | Meaning | Count | Assets |
|---|---|---|---|
| A | Production ready, minor polish only | 33 | 2, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 27, 28, 29, 32, 35, 36, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 50 |
| B | Structurally correct, needs verification | 4 | 4, 5, 6, 49 |
| C | Visually or dimensionally light | 11 | 1, 3, 21, 24, 25, 30, 31, 33, 34, 37, 38 |
| D | Substantial rebuild | 0 | — |
| E | Placeholder / missing | 2 | 8, 26 |

## Library-level facts

- All 50 assets have a complete artifact chain: `.blend` → build function → GLB → runtime reference. **Nothing is missing.**
- 472 GLBs parse cleanly; **zero** camera/light/generic-name ship-gate violations.
- `Assets/checkout/glb/` ↔ `vendor/models/checkout/` are 49/49 byte-identical. The runtime loads only from `vendor/`, and the mirror is maintained **manually — no staging script exists**. This is a latent drift risk worth a guard test.
- Sheet 5 (41–50) was built under the `delivery:` commit workstream, not a "Sheet 05" label. Cartons are true RSC boxes — hinged flaps, segmented cuttable tape carrying `cut_order`, dynamic labels, dual closed/open collision, knocked-down flat state.

## Work queue (worst first)

| # | Asset | Grade | Finding |
|---|---|---|---|
| 8 | RECEIPT | E | geometry 16% of ~200 budget - placeholder-grade |
| 26 | GOLF BAG DISPLAY | E | geometry 14% of ~2600 budget - placeholder-grade |
| 1 | CHECKOUT COUNTER | C | size deviates 55% from sheet (310x101.4x99.7 vs 200x90x70 cm) |
| 3 | PAYMENT TERMINAL (CARD READER) | C | size deviates 81.1% from sheet (18.6x16.3x10 vs 16x9x6 cm) |
| 21 | APPAREL WALL DISPLAY | C | geometry 59% of ~2400 budget - visually light |
| 24 | CLUB RACK DISPLAY | C | geometry 34% of ~2200 budget - visually light |
| 25 | PUTTER RACK DISPLAY | C | geometry 37% of ~1800 budget - visually light |
| 30 | RANGEFINDER DISPLAY | C | geometry 52% of ~1100 budget - visually light |
| 31 | CENTER MERCHANDISE TABLE | C | geometry 41% of ~2200 budget - visually light |
| 33 | FOLDED APPAREL TABLE | C | geometry 39% of ~2300 budget - visually light |
| 34 | STOCKROOM SHELVING UNIT | C | geometry 37% of ~1800 budget - visually light |
| 37 | LOUNGE COFFEE TABLE | C | geometry 53% of ~1100 budget - visually light |
| 38 | OFFICE DESK | C | geometry 49% of ~2800 budget - visually light |
| 4 | CASH DRAWER | B | size deviates 20% from sheet |
| 5 | RECEIPT PRINTER | B | size deviates 16.7% from sheet |
| 6 | SHOPPING BAG (UPRIGHT) | B | size deviates 23.3% from sheet |
| 49 | BOX CUTTER | B | size deviates 15% from sheet |

## Judgment calls needing a human decision

- **Asset 1 (Checkout Counter)** renders at 320×100×105 cm against a 200×70×90 sheet spec. This is layout-driven, not drift: `COUNTER.len=3.2` anchors the three-zone register choreography (staging / POS / bagging). Shrinking it to sheet spec would break checkout. Recommend documenting the deviation rather than "fixing" it.
- **Asset 3 (Payment Terminal)** measures 18.6 cm tall against a 6 cm sheet figure; the sheet quotes device thickness while the model includes its stand. Needs a visual ruling, not a rebuild.