# Inventory and delivery baseline review

Captured from clean local `main` commit `0c5137e5f0efac9627ce2309b9e66936f1eeb769` on branch
`overnight/inventory-delivery-loop` before gameplay or asset changes.

Launch path:

```text
PORT=8467 node tools/serve.cjs
QA_BASE_URL=http://127.0.0.1:8467/ QA_OUTPUT_DIR=qa/inventory-delivery-loop/baseline/main-0c5137e-20260719T162953 QA_RESULT_PATH=qa/inventory-delivery-loop/baseline/main-0c5137e-20260719T162953/result.json node tools/qa/run-playwright.cjs tools/qa/inventory-delivery-baseline.js --bootstrap
```

The viewport was 1600 x 900 at device scale factor 1. The result file records the fixed local
player-camera poses and every trusted keyboard/mouse action. Direct state setup was confined to
the documented nine-box/full-shelf performance fixture. Laptop entry, box cutting, flap opening,
product removal, carrying, and shelf stocking used the game's normal controls.

## Baseline outcome

- Functional route: passed all nine functional checks.
- Console errors: 0.
- Page errors: 0.
- Console warnings: 20 (19 Canvas2D readback warnings and one shader compiler warning).
- Failed requests: 9 aborted GLB requests.
- Acceptance-ready: no.

## Performance baseline

| Metric | Nine boxes + full shelves | After five laptop cycles + one box lifecycle |
| --- | ---: | ---: |
| Average FPS | 145.73 | 150.35 |
| 1% low FPS | 56.24 | 74.96 |
| Worst frame | 27.80 ms | 13.90 ms |
| Draw calls | 2,083.81 | 1,923.00 |
| Rendered triangles | 6,879,226.03 | 6,878,626.00 |
| Materials | 250 | 247 |
| Estimated texture memory | 6,059.73 MiB | 6,058.06 MiB |
| JavaScript heap during sample | 84.08 MiB | 251.63 MiB |
| Renderer geometries | 1,178 | 2,226 |
| Active event listeners | 99 | 99 |
| Shop-prompt updates | 146.56/sec | 0/sec |

Forced-GC heap grew from 82.35 MiB to 250.44 MiB (+168.09 MiB). Active event listeners did not
grow. Draw calls and rendered triangles come from complete EffectComposer frames with
`WebGLRenderer.info` reset before each frame; scene resources come from a visible Three.js scene
traversal; texture memory is an explicitly labeled RGBA8 plus mip estimate.

## Visible defects, ranked by player impact

1. **Critical - receiving frame, lower half:** the nine cartons overlap into one heap and several
   intersect the camera, so simultaneous delivery contents cannot be read or approached safely.
2. **Critical - open-box frame, lower center:** the prompt reports twelve products, but the carton
   does not visibly show twelve products; numeric contents and visible contents disagree.
3. **High - receiving frame, whole scene:** the receiving zone has no convincing loading-bay
   composition, boundary, vehicle, employee, or arrival staging; cartons appear at the edge of an
   open course.
4. **High - sealed/open frames, stock shelves:** cartons intersect shelf beams, each other, and
   adjacent aisle space; the storage layout reads as a collision pile rather than authored zones.
5. **High - carried-product frame, bottom edge:** the six carried products are oversized white
   blocks that obscure the lower view and do not read as retail golf-ball packages.
6. **High - sealed frame, lower right:** the cutter is an oversized yellow wedge with no aligned
   hand pose; its blade/grip silhouette does not communicate a believable two-handed cut.
7. **High - laptop Orders view:** the empty state offers no example or explanation of order ID,
   processing, dispatch, ETA, receiving, box IDs, remaining quantity, or completion states.
8. **Medium - every carton:** supplier labels are blank white rectangles at normal player distance;
   supplier, order, SKU, quantity, weight, and handling data are unreadable.
9. **Medium - open-box frame:** flap geometry is paper-thin and visually clips against nearby
   cardboard; hinges and tape separation are not legible from the player camera.
10. **Medium - sealed/open frames:** repeated plain-brown cartons have almost no useful variation,
    hierarchy, or fictional supplier identity, making SKUs indistinguishable without the prompt.
11. **Medium - stockroom, left side:** the bright red vacuum/sign silhouette is a flat, primitive
    focal point that clashes with the warm cream, walnut, sage, and golf-green direction.
12. **Medium - stockroom, whole frame:** lighting is flat and muddy; dark shelf beams merge into the
    background and open carton interiors receive too little separation.
13. **Medium - stocked-shelf frame:** the camera sits too close to a mostly empty fixture face,
    making row capacity and partial/full/low-stock appearance hard to judge.
14. **Low - stocked-shelf frame, product row:** neighboring package faces crowd and partially mask
    one another, weakening facing direction and per-unit readability.
15. **Low - all first-person frames, bottom center:** the persistent `Click to play` chip competes
    with interaction prompts in the headless profile when pointer lock is unavailable.

## Baseline weaknesses outside the screenshots

- Order records are one SKU per order and do not retain the full requested lifecycle/state data.
- The pad capacity response blocks an arrival rather than choosing and presenting a safe fallback
  receiving zone.
- Accounting tests conserve only selected shelf/back/box states; they do not prove every requested
  stage (in transit, unopened, open, reserve, shelf, held, sold, disposed/lost) per order line.
- The baseline does not support a multi-SKU box, damage/disposal identity, persistent carrier ID,
  or explicit delivery/receiving completion records.
- The current prompt updates every rendered frame in the stressed receiving view, and the measured
  post-GC heap/resource growth requires investigation before the feature can pass its performance gate.
