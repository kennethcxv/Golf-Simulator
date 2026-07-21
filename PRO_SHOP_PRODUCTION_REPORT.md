# Prime Fairways Retail Asset Library — Production Report

Built 2026-07-16 against the binding reference set `Designs/RefrenceImages/Purchaseable_Items` (all 32 images audited — see `assets/pro_shop/manifests/reference_manifest.json`).

## v2 quality pass (same day)

The entire library was rebuilt through an upgraded pipeline after review:

- **Texture pipeline**: all packaging/label/card/decal art is now authored on a 3× supersampled canvas with rounded type strokes (anti-aliased print instead of jagged pixels), gradient panels, and 227 generated textures. Materials gained **normal maps** (piqué/knit/twill/canvas/ripstop/fleece weaves, leather pore, wood grain, knurl, ribs, golf-ball dimples), **roughness maps**, and **clearcoat** (club crowns, walnut, golf balls).
- **Hats**: crown panel seams, stitched brims with rolled edge binding, seated ropes with end caps, eyelets, buttons.
- **Apparel**: fold-over tipped collars, stitched plackets with rimmed buttons, zips with teeth/sliders/pullers/storm flaps, shoulder + side seams, hem stitching + wave, front creases, welt pockets, belt loops + fly stitching, chest logos, rolled sleeve cuffs, natural arm drape.
- **Shoes**: station-based lasts with carved ankle openings + collar rolls, welted outsoles with tread normals, midsole stripes, eyelet/lace crisscross or BOA dial mounted on the computed instep, heel counters + pull tabs + brand tabs, side arrow logos.
- **Gloves**: fingers rooted in the palm with knuckle profiles, crotch/tendon stitching, angled velcro strap with stitch rows, ribbed elastic wrist.
- **Rangefinders**: protruding ocular/objective barrels with hood rings, knurled rubber armor panels, waisted body.
- **Bags**: cloth normals, embedded pockets with zips + pullers, padded straps.
- **Clubs**: clearcoat gloss crowns, milled face-groove normals, knurled grips.
- All validations re-run green after the pass: fit 290/0/0, reimport 130/130, `npm test` 681/681.

## AAA review + polish pass (2026-07-16, after v2)

A measured audit + targeted polish over the whole library — 235 GLBs inspected
(114 pro-shop products, 16 pro-shop fixtures, checkout kit, clubhouse props),
147 previews graded via contact sheets (`previews/audit/`), every placement,
socket, collision and UV checked by `tools/blender/audit_pf_assets.py`
(results: `manifests/audit_report.json`).

**Found & fixed (16 assets rebuilt):**
- Loose tees ×4 — stripe bands floated above the lying tee (placement not rotated with the body)
- Sunglasses — disconnected lens slabs → rimmed lenses, browline, nose bridge, hinges, ear-hook temples
- Coiled belt — torus stack → true flat leather spiral with strap tongue and seated brass buckle + prong
- Umbrella — floating panel slats → alternating green/cream lobes painted into the fluted canopy mesh
- Folded towel — end dobby stripes + fold rolls + stronger waffle normal
- Headcovers ×2 — recessed rimmed number disc, fleece pom, ribbed sock band
- Folded apparel ×4 — fold-seam grooves, tucked folded sleeves, two-piece collar with points, placket + 2 buttons; pants/shorts get waistband + loops + seat seam + creases on top
- Bag display fixture — light bar floated mid-bay → housed strip under the upper deck

**Audit results (technical):** 0 missing collisions, 0 missing PICKUP_SOCKETs,
0 loose verts, 0 non-manifold failures, 0 textured meshes without UVs, no
floor gaps (wall-mount hooks correctly classified). Pro-shop fixtures are 1
joined mesh with ≤7 material slots each. Total visible triangles across all
235 assets: ~646k (pro-shop products 48–4.8k tris each, fixtures ≤4.4k).
High "texel spread" flags on joined multi-part meshes are expected (trim vs
panel density), not stretching — verified visually on wood surfaces.
Checkout-kit interactive assets (cash drawer 78 slots, payment terminal 42)
are contract-bound (named movables/keys the game animates) and were left
untouched; flagged as a future optimization once the register feature is
accepted.

**Re-validation after polish:** fit 290 placements / 0 fails / 0 overlaps ·
reimport 130/130 clean · `npm test` **686/686** · store re-rendered.

## Deliverables

| Deliverable | Count | Location |
|---|---|---|
| Product GLBs (game-ready, Y-up, embedded textures) | **114** | `assets/pro_shop/glb/products/` |
| Fixture GLBs (empty, with named slots + collision) | **16** | `assets/pro_shop/glb/fixtures/` |
| Blender sources (1 per asset + 13 stocked scenes + shop) | **143** | `assets/pro_shop/source/**` |
| Generated original textures (PNG dumps of packed images) | **150** | `assets/pro_shop/textures/` |
| Preview renders (products / fixtures / stocked+shop) | 114 / 16 / 17 | `assets/pro_shop/previews/**` |
| Manifests (products, fixtures, textures, placements, reference, scale, fit, reimport) | 8 | `assets/pro_shop/manifests/` |
| Assembled store | 1 | `assets/pro_shop/source/assembled/prime_fairways_pro_shop_assembled.blend` |
| Three.js validation suite | 7 tests | `tests/proshop-assets.test.js` |

## Product coverage (all 20 required categories + extras)

- **Golf balls (6)**: Prime Tour premium 12, Eagle Soft Feel 12, Range Practice 12 (real window + 4 neon balls), Birdie Value 3-sleeve (window + stacked balls), loose white/yellow balls.
- **Tees (8)**: 4 retail window boxes w/ hang tabs + visible tees inside (Classic Wood kraft, Performance, Eco Bamboo, Pro Launch stepped) + 4 loose tees.
- **Snacks (4)**: Fairway Fuel granola carton, Elevate Trail Mix stand-up pouch, Green Drive protein bar, Bunker Bites chips bag.
- **Bottles (4)**: squeeze, insulated (swing handle), sport, slim steel — PF flag-crest label wraps.
- **Scorecards (5)**: folded PF Golf Club tent card (cover art outside, hole table inside), navy/gold Player's booklet w/ brass corners, hole-guide card, mini scorecard, green pencil.
- **Divot tools (8)**: classic/folding-black/slim/folding-sage + 4 retail hang-cards.
- **Ball markers (8)**: brass coin, green enamel tee, magnetic copper clip, engraved pewter + 4 hang-cards.
- **Gloves (8)**: Aero Max white leather, Vantage Pro black, Forge 360 navy mesh, Elevate Lite sage + 4 hang-cards.
- **Rangefinders (5)**: stealth/armor/tour/field bodies (dual lenses, buttons, eyecup, PF Optics plate) + retail box.
- **Hats (4)**: structured rope cap, perforated performance cap, visor, bucket (colorways = documented material variants).
- **Clubs (24, full length, never shortened)**: 4 drivers (Aero Max, Forge Tour, Vantage Pro, Elevate Lite — 1.145 m), 4 fairway woods, 4 hybrids, 4 irons (players/cavity/game-improvement/distance), 4 Norvik wedges (gap/versa/sand/lob), 4 putters (blade/wide/spider/fang).
- **Shoes (4)**: spiked BOA-dial, knit spikeless, saddle classic, waterproof trail.
- **Golf bags (4)**: stand (deployed legs), cart, Elevate Tour staff (gold crest), Sunday pencil.
- **Apparel (13)**: hanging polo/quarter-zip/hoodie/jacket/pants/shorts, folded polo/quarter-zip/pants/shorts, 3 reusable hangers (wood/metal/clip). Colorways cream/sage/navy/charcoal(+khaki) as material variants; stocked scenes tint per instance.
- **Extras (9)**: towel hang-card + folded towel, driver/wood headcovers, coiled belt, course umbrella, sunglasses + retail box, gift card.

Branding is fully original (PF shield crest, wordmark, P-roundel, A-arrow performance mark, sub-brands Aero/Forge/Vantage/Elevate/Velocity/Ascent/Norvik, Fairway Fuel/Elevate/Green Drive/Bunker Bites) — reference real-brand marks (Pinnacle/Titleist/Nike lookalikes) were deliberately replaced.

## Fixtures (one PF construction family)

apparel wall (12 hanger + 4 folded slots), hat wall (16 tilted slots), accessory slatwall (21 hooks + 9 shelf slots), club rack (18 club slots in split-height long/short zones + grip/shaft/head helper sockets), bag display (8 slots, 2 lit decks), ball shelf (30 slots), snack/drink shelf (20), rangefinder display (16), shoe display (14 angled L/R slots), center table (12), gondola (30 hooks + 11 shelf slots + umbrella barrel), checkout counter shell, and 4 reusable slatwall hooks. Every slot is a named empty with capacity extras (`slot_type/accepts/max_w/max_d/max_h`), every fixture has a `COL_` box.

## Validation results (all green)

- **Numeric fit** (`fit_validation_report.json`): **290 placements, 0 capacity failures, 0 overlaps** at scale 1,1,1.
- **Reimport** (`reimport_report.json`): **130/130 GLBs** clean in a fresh Blender file (meshes, materials, packed images, floor contact, sockets, no cameras/lights).
- **Three.js** (`tests/proshop-assets.test.js`): 7/7 tests — every GLB parses through the game's GLTFLoader, PICKUP_SOCKET + collision on every product, full club lengths asserted, slot capacity extras exposed to the engine, tri budgets enforced.
- **Repo suite**: `npm test` → **679/679 pass**.

## Triangle counts (visible geometry)

Products: snacks 108–132, scorecards 48–768, markers 108–744, clubs 964–1,804, bottles ≤3,672, rangefinders ≤3,272, shoes 3,128–4,696, tees ≤4,784, everything ≤4.8k. Fixtures: 336–4,436. All far inside the stated budgets.

## Rebuild / extend

- Any product: `blender --background --factory-startup --python tools/blender/build_pf_<category>.py -- <id|all> render`
- Fixtures: `build_pf_fixtures.py`; stocked scenes + fit report: `assemble_pf_stocked.py -- all`; store: `assemble_pf_shop.py`; reimport audit: `validate_pf_reimport.py`; manifest collation: `node tools/collate_pf_manifests.mjs`.
- Shared libs: `tools/blender/proshop_lib.py` (textures/text/geometry/sockets/export/batch), `pf_brand.py` (original brand art), `pf_club_lib.py`.

## Known non-blocking limitations

1. Apparel/glove/hat cloth is stylized game-res (readable silhouettes + procedural fabric, no simulation); a character artist pass would elevate hero closeups.
2. Packaging typography uses the kit's 5×7 pixel font — legible and consistent, but a vector-font bake would look more premium at extreme closeup.
3. Colorways ship as documented material variants (`material_variants` extras + per-instance tinting in stocked scenes) rather than one GLB per color, matching the spec's variant rule; the game should swap materials at runtime.
4. Club rack holds 18 of the 24 club SKUs at once by design (retail density); remaining SKUs rotate stock.
5. The interactive checkout register kit (`assets/checkout/`, 22 GLBs) is a separate deliverable and was left untouched; the pro-shop counter here is a matching static shell.
