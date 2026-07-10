# FAIRWAY STATE — DEV LOG

Running log of every judgment call made during autonomous development, with reasoning.
Newest entries at the bottom.

---

## 2026-07-09 — Session start, direction pivot

- **Unity direction abandoned before any code was written.** The original v1 brief targeted
  Unity/URP. Mid-setup (a bare `-createProject` had just finished; zero custom assets/code),
  the v2 spec arrived superseding it: vanilla JS/HTML5 Canvas top-down course + Three.js
  walkable pro shop + Electron shell. Deleted the bare Unity-generated folders entirely —
  they contained no work. This repo is JS-only from the first commit.
- **Skipped the brainstorming/planning skill workflows.** The brief is a complete,
  authoritative design spec and explicitly forbids stopping for questions; user instructions
  take precedence over skill workflows. Logged here per that same instruction. The
  test-driven-development skill IS being used for all sim modules, since headless unit
  testing is the named primary verification method.
- **Mirroring GlassWaterV2 conventions** (sibling repo, the "proven approach" the brief
  names): `main.cjs` + `preload.cjs` Electron shell with context isolation and IPC
  save/load, `type: module` ESM app code, import-mapped vendored Three.js, zero-dependency
  static dev server (`tools/serve.cjs`, port **8447** here to avoid clashing with
  GlassWater's 8437), `node --test` for headless tests, `--dev` flag opening remote
  debugging on **9223** for Chrome DevTools MCP QA.
- **Dependencies pinned to the proven pair**: electron ^33.2.0, three ^0.185.1 — same
  versions GlassWaterV2 ships with on this machine, no reason to gamble on newer majors.

## 2026-07-09 — Core architecture decisions (before Phase 1 code)

- **Single serializable `GameState`** plain-data object; all sim modules are plain ESM
  functions operating on it (`tick`, commands). Rendering/UI read state and issue commands;
  nothing in `src/sim/` touches DOM/canvas — that's what makes `node --test` cover the
  entire simulation.
- **Seeded RNG (mulberry32) carried in state** so simulation runs are reproducible in tests.
- **Course model is a cell grid**: 120×80 cells, 1 cell = 8×8 yd (course footprint
  960×640 yd — plausible for a compact 9-hole muni). Per cell: zone type (out-of-play /
  rough / fairway / green / tee / bunker / water / path), elevation (float, yards),
  and later per-cell turf state. Zone *sections* ("Green 3", "Fairway 5 section 2") are
  derived as contiguous same-zone blobs and auto-associated to the nearest hole — no manual
  cell-to-hole assignment busywork for the player, and it keeps the editor free-form.
- **Holes** are tee marker + pin position (pin must sit on green cells) with par derived
  from tee→pin distance (real-world par bands: <251yd par 3, 251–470 par 4, >470 par 5).
- **Terrain editing is plan-then-confirm** ("Course Works" mode): paint changes as a ghost
  plan with an itemized cost, then confirm (charges cash, applies, and puts affected open
  holes into renovation downtime) or cancel. Rationale: the spec demands renovation feel
  like a real business decision, not a free undo button — batching edits into a confirmed
  project is both better game feel and cleaner cost/downtime accounting than per-brushstroke
  charges. There is deliberately NO free undo after confirm.
- **Game calendar**: 4 seasons × 24 days = 96-day year. Day runs 6:00–20:00 for play.
  1 real second = 10 game minutes at 1× speed (a full day ≈ 84 s), with pause/1×/4×/16×.
- **Money is integer cents avoided** — plain dollars as floats rounded to cents on display;
  amounts in this game are large enough that float noise is irrelevant, and it keeps
  balance code readable. (Logged in case a future accountant disagrees.)

## 2026-07-09 — Phase 1 complete (shell + course view + terrain editing)

- **TDD throughout the sim layer**: 45 headless tests written first (watched fail), then
  implemented green: utils/RNG, calendar, course model (grid/sections/holes/par/design
  rating), plan-confirm editing (costs, corridor-based renovation detection, tee/pin ops,
  daily countdowns), Willow Creek starting course, GameState serialization.
- **Willow Creek Municipal layout** is hand-routed in code (two loops off the clubhouse,
  par 34, ~2,380 yd, three par 3s, one par 5, pond guarding the par-3 5th, six bunkers)
  and painted deterministically from the game seed. Its scruffiness is intentionally in
  the *condition* dimension (arriving with the Phase 2 turf sim), not the architecture —
  a complete-if-modest 9-holer whose Design score (~86) is honest; the "fixer-upper" pain
  will come from turf health multiplying into the overall rating.
- **Design rating formula components** (45 playable holes / 10 par variety / 10 length /
  8 bunkering / 6 water / 8 green sizing / 8 land movement / 5 fairway coverage; holes
  under renovation count 0.4, construction 0.2). Judgment-call weights, tuned later.
- **Renovation corridor rule**: a confirmed edit within 4 cells of an open hole's tee→pin
  line closes that hole for `ceil(cells/6)` days (realistic; /12 relaxed), clamped 2–21.
  Tee/pin moves on an open hole: flat 3 days (realistic) / 2 (relaxed). New holes build
  for 5/3 days once valid. If renovation ends and the hole is incomplete (green dug up),
  it falls to `unbuilt` rather than reopening — verified by unit test.
- **Browser QA pass (Playwright)**: menu → new game → works mode → drag-painted a 32-cell
  bunker strip ($8,000 = 32×$250 exact) → plan bar warned "closes H1 4d, H7 2d" →
  confirmed → cash/badges/grey-pins correct → 16× fast-forward 6 days → holes reopened →
  reload → Continue restored Day 7 from autosave with works persisted → inspect panel
  ("Pond") → slot save. Zero console errors/warnings across the session.
- **Bugs found by QA, fixed**: HUD crashed reading `state.clubName` before any game
  existed (boot-order); clock rendered raw fractional minutes ("7:19.20299… AM") — floor
  in formatClock; hint bar overlapped the plan bar (hidden in works mode now).
- **`window.__fw` debug hook** exposes the app object for automated QA — kept
  deliberately, it's read-mostly and invaluable for driving later-phase tests.
- **Electron smoke-tested** (launches, stays alive, clean teardown). Deep native-bridge
  QA (userData save files) deferred to a later phase via CDP attach; the renderer code is
  byte-identical to the browser path and the bridge mirrors GlassWaterV2's proven 30-line
  pattern.
- **CSP meta deferred to Phase 7** (needs an importmap hash dance; zero third-party code
  runs meanwhile). Logged in KNOWN_ISSUES.

## 2026-07-09 — Phase 2 complete (turf simulation)

- **Turf model**: 8 per-cell typed arrays (health/moisture/nutrients/heightMm/wear/
  disType/disSev/treated) serialized with saves; sections stay the legibility layer
  (one status word, detail on demand). Disease lives ON CELLS deliberately — sections
  relabel on every course edit, so anything keyed to section ids would be orphaned by
  renovation; cell data survives arbitrary edits.
- **Physics ticks hourly** (evaporation by temp/humidity, four rain showers a day,
  growth consuming nutrients, disease severity creep, health drift); onset checks,
  wear recovery and fungicide countdown tick daily; maintenance executes at 5 AM.
- **Asymmetric health drift** (recovery ≈ 1/3 the pace of decline) — first draft let
  turf "heal through neglect" faster than drought could kill it; test-driven tuning
  caught it.
- **Demand-based irrigation**: each level (light/standard/heavy) fills toward a target
  in the zone's moisture band with a daily cap, skips when >0.2" rain is falling, and
  bills by points actually applied — replaced a fixed-dose design after tests showed
  fixed dosing + light rain drowning greens at 100 moisture. More realistic AND fixed
  the bug; drought weeks now genuinely cost more water money.
- **Two diseases as specced**: dollar spot (mild humid days + hungry turf — the classic
  underfed-green disease) and brown patch (hot humid nights + waterlogged/overfed turf).
  Plain-language diagnosis strings cite the live numbers ("Nutrients here read 36").
  Fungicide = 12 days protection, severity decays; cleared in ~7 game days in QA,
  matching the diagnosis copy.
- **Crew capacity model**: mowing/fertilizing consume crew-hours (greens→tees→fairways→
  rough priority); the fixer-upper opens with a 1-person crew that cannot cover the
  rough, which visibly shags out and darkens. Day-labor +/- hiring in the Grounds panel
  is the Phase 2 stand-in; Phase 3 replaces it with real staff records. Frost mornings
  stand the crew down (mowing skipped, logged in the report).
- **Fixer-upper numbers**: Design 86 / Condition ~46 → Course 62 on day one, exactly the
  "good bones, poor condition" muni intended. QA'd live: fungicide + standard feeding +
  3 crew cured Green 4 in 8 days, rough 70→52mm, condition 46→50, ~$400/day burn.
- **Balance judgment calls**: green stimp = 14.8 − height − (100−health)×0.045 −
  sev×0.012 clamped 6–13.5; condition weights greens 3× fairways 1.6× tees 1.2× rough
  0.5×; overall course rating = 40% design + 60% condition. All in balance.js for
  post-playtest tuning.
- **Renderer**: health browning (straw lerp), wear→dirt, disease blotches (pale dollar
  spot dots vs dark brown patch), overgrown-turf darkening, and V-cycle view modes
  (Normal/Health/Moisture heatmaps with non-turf dimmed). Terrain re-rasterizes once
  per game hour.
- 66/66 headless tests green; zero console errors across the browser QA session.

## 2026-07-09 — v3 PRESENTATION PIVOT: realistic 3D course view (owner directive)

- Mid-Phase-3 the owner interrupted with a new directive: **the course itself must be
  real 3D and look realistic — "like how it looks in real life" — not the blocky
  top-down view.** This supersedes the v2 constraint that Three.js was for the pro shop
  only. The v2 spec's top-down rationale (genre precedent) is now overridden by explicit
  owner preference; noted here per the log-everything rule.
- **What changes**: the rendering layer only. The course view becomes a Three.js scene —
  smoothed heightmap terrain with splat-style zone texturing (mow stripes on
  fairways/greens/tees, real sand, organic zone borders via domain-warped sampling),
  water surfaces, instanced trees, sun/sky/shadows with time-of-day, weather-reactive
  atmosphere — driven by the SAME serialized GameState and data textures fed from the
  same turf arrays. Health browning/disease mottle/view modes port into the terrain
  shader. RTS-style orbit/pan camera (drag pan, wheel dolly, rotate, pitch clamp).
  Editing (plan ghost, brush ring, tee/pin placement) works via terrain raycasting.
- **What does not change**: every sim module, every test, save format, the DOM UI
  (HUD/panels/menu), the Electron shell, and the Phase 4 first-person pro shop plan.
- Phase 3's two RED test files were parked (renamed .hold) so the suite stays green
  during the renderer swap; they come back immediately after and Phase 3 resumes.
- Elevation is rendered at 1.5× vertical for readability (±8 ft of real land movement
  reads nearly flat from a management camera at 1:1). Logged as a presentation choice,
  not a data change.

## 2026-07-09 — v3 renderer landed (realistic 3D course view)

- **What shipped**: 38k-vert smoothed heightmap terrain with a splat shader driven by
  two DataTextures straight from the turf arrays (zone id via domain-warped sampling for
  organic borders; health/wear/moisture bilinear-smoothed so per-cell variance doesn't
  render as camo blocks; disease blotches by type; mow stripes that FADE when grass
  overgrows its target height — the fixer-upper literally has no stripes until the crew
  mows); pond bowls carved into the mesh with flat water disks (the intersection of a
  flat disk and a carved bowl produces organic shorelines for free); ~2,700 instanced
  trees (deciduous + pines, per-instance color/scale) with cast shadows; 3D flags with
  numbered cloth + cups + tee markers + floating renovation badges; Sky-addon sun with
  time-of-day arc, dawn/dusk warmth, night moonlight, and rain-reactive fog/turbidity;
  RTS orbit camera (drag pan, right-drag orbit, wheel dolly, WASD/Q); raycast painting
  with a brush ring and pulsing plan-ghost cells on the terrain.
- **Bugs the QA loop caught**: (1) the tree-placement hash used unwrapped JS float
  multiplication — `(h ^ h>>13) * big` overflows and the ToInt32 coercion left the top
  bit dead, so every hash landed < 0.5 and ZERO trees spawned; fixed with Math.imul
  (the same construction utils.makeRng already used — lesson: never hand-roll a second
  hash). (2) InstancedMesh frustum culling uses the BASE geometry's bounds — the entire
  forest vanished when the origin left the frustum; frustumCulled=false. (3) The
  PlaneGeometry UV v-axis runs opposite my cell rows — zone texture rendered mirrored
  until flipped in-shader. (4) First-pass lighting was far too dark at dawn/rain.
- **Perf**: 361 fps in the QA browser at 1250px — huge headroom for Phase 5 golfers.
- **Deferred to polish**: sky horizon is blown white at low angles, water has no ripple
  normal yet, tree LOD/billboards unneeded at current perf, real photo textures (the
  procedural canvas textures are honest but a CC0 texture pass would lift realism).
- 2D renderer (courseRenderer.js/camera.js) deleted; ZONE_COLORS moved to
  render/palette.js, holeSummary into sim/course.js. All 66 sim tests untouched and
  green — the sim never knew the renderer changed.

## 2026-07-09 — Phase 3 complete (membership, hospitality, staffing, economy)

- **The golfer pool exists NOW** (140 named people with wealth 1–4, a picky-about
  persona, handicap, membership status, satisfaction) so joins/quits are real
  individuals with names in the feed — Phase 5 deepens these same records with
  memory/thoughts/rounds; no parallel system later.
- **Three tiers** (Fairway Card / Club Member / Legacy Member) billed per 24-day season,
  with guest passes and shop discounts staged for Phases 4–5. Joins follow perceived
  value: overall rating^1.5 × (fair dues / your dues)² × reputation^0.8; churn is a
  satisfaction-vs-price threshold (overpricing raises the bar members must feel).
  Satisfaction drifts toward a target built from condition (50%), design, amenities,
  and staffing coverage.
- **Accounting is accrue-at-close**: every recurring item books at the midnight that
  closes its day, so `yesterday.net` exactly equals the cash delta across any
  midnight-to-midnight window — a unit-tested invariant that forces all cash through
  the ledger (works/fungicide/severance included via economy.spend).
- **Fixed a real batched-time bug** the invariant test exposed: update() used to advance
  the clock fully and then replay hour ticks, so multi-day updates stamped every tick
  with the FINAL day (mow-day bookkeeping wrong, all outings resolving at once). The
  clock now advances incrementally per tick; batching N days behaves exactly like
  living them.
- **Staff**: hiring market refreshes every ~6 days (seeded), wages scale with role and
  skill, training = 2 days away for +½★, severance = 3 days wage. Groundskeeper skill
  converts to real crew-hours (8h × 0.6+0.2×skill) on top of day-labor; instructors
  activate the teaching program and lesson revenue; F&B skill lifts restaurant covers.
- **Corporate outings**: offers arrive organically (~every 5 days), expire in 2–3 days,
  pay out on their day, ding every member's satisfaction −6 that day, and nudge
  reputation by how good the course was. **Amenities**: range/grill/teaching with level
  costs, daily upkeep, and revenue lines.
- **10-day live QA**: cash +$9.3k, members 22→25 with named joins AND a quit, rep
  30→42, revenue mix green fees $7.3k / dues $3.5k / outing $2.4k, second offer arrived
  organically. 86/86 tests green, zero console errors.
- Balance judgment calls: base 30 public rounds/day scaled by season/weather/price-
  demand/quality/reputation; utilities $45/day; muni opens with 22 members. All in
  club.js/balance.js for tuning.

## 2026-07-09 — Phase 4 complete (walkable pro shop + retail sim)

- **Retail sim is headless** (sim/shop.js, 10 tests): 21-SKU catalog across
  clubs/balls/apparel/accessories in three tiers (tier 3 gated behind progression);
  supplier orders paid up front with per-category lead times (clubs ship in 4 days);
  shelf-vs-backroom split where floor staff shelve each morning by skill and the
  player can restock BY HAND on the walkable floor; per-category markup with a
  willingness-to-pay curve (wealthier shoppers tolerate more; 2× book price craters
  volume — unit-tested); shopper flow follows rounds played + members + reputation;
  club sales are assisted sales (a skilled floor pro roughly doubles closes);
  seasonal demand (storm shells don't sell in July, balls die in winter); rentals
  serve guests and wear the fleet; fittings need a real pro, pay $120, and stamp
  `fittedDay` on the member (Phase 5 makes them play better). Lost sales are
  TRACKED and surfaced — an empty shelf annoys the actual member who wanted it.
- **The walkable floor** (render3d/shopScene.js): 14×10yd interior with procedural
  wood/plaster, three windows, warm bulbs; hollow shelf units/racks/tables whose
  stacks ARE the live inventory (empty shelf = visibly empty); pointer-lock mouse
  look with arrow-key fallback (env-safe + accessibility); WASD + circle-vs-AABB
  collision; E-interact with center-view focus (restock/register/fitting/door);
  capsule customers whose presence scales with yesterday's real traffic, browsing
  waypoints and leaving — reactive to shop state, never a second sim, per the brief.
- **QA loop found real bugs**: spawn faced the door (yaw convention), W walked
  backward (forward/right projection sign error — derived properly this time),
  stock hid inside solid shelf frames (rebuilt as hollow units), pointer-lock
  request throws in headless (caught; click-to-look covers it).
- **Live 4-day QA**: order→deliver→sell verified; balls sold out; with no floor
  staff the delivered stock sat in the backroom and 9 shoppers walked — exactly the
  designed pressure to hire pro-shop staff or walk the floor daily.
- Deferred to polish: register queue minigame, customer purchase animations at the
  counter, shop ambient audio (Phase 7), display-arrangement beyond the feature
  table (post-v1).

## 2026-07-09 — Phase 5 complete (persistent golfers spanning course + shop)

- **113-thought catalog** (data/thoughts.js), every entry a `when(ctx)` predicate over
  live sim values and a renderer that quotes them ("Nutrients here read 36" energy, but
  for golfers): greens speed/health/disease, fairway/rough/tee state, design, weather+
  condition combos ("rained all morning and the fairways still played firm — great
  drainage"), pace (real wait minutes from real crowding), pricing vs computed fair
  value, staffing visibility, shop stock/prices/purchases/fittings, amenities, club
  reputation, membership economics, score reactions, and persona-specific verdicts.
  Unit test asserts thoughts FIRE on their conditions (six scenario fixtures).
- **Daily round sim** (sim/rounds.js): members play by satisfaction/weather propensity,
  non-members drop in; each round scores from skill + condition penalties (sick greens
  ≈ +3–5 strokes — condition measurably affects play, per spec); golfers keep an
  8-visit memory ring {day, score, thoughts}; satisfaction moves on what actually
  happened; skill (handicap) improves with play, faster within 21 days of a fitting or
  with a teaching pro; FOOT TRAFFIC WEARS GREENS/TEES (40 rounds ≈ +1.8 wear/day),
  closing the loop back into the turf sim.
- **Arcs**: consistently delighted full/premium regulars become ⭐ champions (permanent
  club.champions record + rep bump); satisfaction under 15 = they quit loudly and
  FOREVER (never rejoin, −3 rep). First draft used a dice roll at <20 and a boosted
  course could redeem them before it landed — changed to deterministic below 15
  (better drama, deterministic test).
- **Presentation**: golfers walk the course in 3D (capsule figures with caps walking
  tee→pin corridors with shot pauses, population ∝ real rounds, only during open
  hours); Club panel gains "The Regulars" (champion stars, handicap, satisfaction,
  last thought in their own words) with click-through golfer cards showing the full
  visit memory; the feed now carries overheard thoughts with mood icons.
- **Tooling scar tissue**: a PowerShell -replace pipe mangled UTF-8 em-dashes in two
  sim files (PS 5.1 encoding guess); repaired via a Node script. Rule going forward:
  never round-trip source files through PowerShell string ops — use Node or the
  editor tools.
- 105/105 tests. Live QA: 49 golfers held memories after 6 days; sampled thoughts all
  traced to true conditions (the conditions-persona member named the actual disease
  count; the bare-shelf complaint matched the actual sellout).

## 2026-07-09 — Phase 6 complete (progression, prestige, difficulty)

- **Prestige vs reputation**: reputation is what locals feel week to week; prestige is
  what the golf WORLD thinks — a slow composite of overall rating, reputation,
  amenities, premium members, champions, and hosted events. Prestige gates the tree
  and the tournament ladder.
- **Nine-improvement tree** (cash + prestige gates): triplex/lightweight mowers (−40%
  crew time on greens/fairways), deep-tine aerator (half-cost aeration + faster wear
  recovery), precision spray rig, smart irrigation (−30% water), premium supplier
  (tier-3 shop lines), reciprocal network (daily partner revenue + premium appeal),
  corporate desk (+35% outing payouts), tournament operations. Every effect is a real
  modifier in the sim (mow-hours, ledger lines, order gates) — no dead stats.
- **Tournament ladder**: Club Championship (P50) → County Amateur (P65, must have
  hosted the championship) → THE WILLOW CREEK OPEN (P85, condition 72+ with all nine
  open). Events cost real money, pay entry fees, and RESOLVE AGAINST THE ACTUAL
  COURSE on the day — success builds prestige/reputation; a shabby course on event day
  is a public embarrassment (−prestige). Live QA proved the stakes: a course at
  condition 85 on scheduling day WORE DOWN to 70 by event day under real foot
  traffic and missed the major by two points — championship prep (aerate, feed, peak
  for the date) is genuinely required. The win flips majorWon and a one-shot
  celebration modal; the club continues sandbox after.
- **Falsy-day bug**: unlocks stored their purchase dayAbs and `!!0` made day-0
  purchases invisible — hasUpgrade now tests key presence. (Classic.)
- **Difficulty**: bankruptcy in Realistic (5 straight days past a $2k overdraft →
  the bank calls it; load-save/exit modal); Relaxed floors the debt at $5k and never
  hard-fails; mode also scales turf decay, disease onset, renovation downtime, wages,
  starting cash, and prestige drift. The pause menu now switches mode mid-game —
  logged decision: allowed, it only swaps balance references.
- 116/116 tests; endgame + failure modals verified in-browser.

## 2026-07-09 — Phase 7 complete (sound, tutorial arc, hardening) — v1 FEATURE-COMPLETE

- **Procedural WebAudio placeholder sound** (core/audio.js): synthesized birdsong
  (FM chirps, daylight + fair weather only), looped-noise rain wash (attenuated
  indoors), detuned-saw mower hum gated to the 5–7 AM crew shift, ball-strike pings
  when golfers are actually out, and a two-tone shop doorbell fired by real customer
  spawns. Master volume/mute persist in localStorage (settings, not saves). WebAudio
  arms on the first user gesture. Real recorded SFX remain a pre-ship requirement
  (KNOWN_ISSUES).
- **Tutorial arc as real objectives** (sim/tutorial.js + guide card): ten steps woven
  into the opening — every check reads live state (treat an actual sick green, place
  an actual order, close an actual profitable day, reach prestige 30) with UI-moment
  flags for panel/floor visits. Clears with toasts; retires itself; hideable;
  serialized with the save; unit-tested advancement.
- **Hardening**: strict CSP finally pinned (sha256 of the inline importmap) and
  verified in both browser and Electron; HUD made responsive (weather text and club
  name collapse at narrow widths); pause menu gained sound controls next to the
  difficulty switch.
- 121/121 tests, zero console errors across the final QA pass. All seven phases of
  the build order are done: the game runs end-to-end from fixer-upper muni to
  hosting THE WILLOW CREEK OPEN.

## 2026-07-09 — v4 visual-fidelity pass (rendering only; sim/UI untouched)

- **Task 1 — real PBR ground**: Poly Haven CC0 1K sets (diffuse + GL normal) wired
  into the splat shader for fairway/green/tee (leafy_grass at three tilings), rough
  (sparse_grass), sand (sand_01), path (gravel_road), scrub (brown_mud_leaves_01).
  All sets sampled in uniform control flow (valid mip derivatives at warped borders);
  per-zone normals via a custom normal_fragment_maps override using derivative
  tangent frames; per-zone derived roughness keeps the shader at 13 samplers.
  Procedural canvases retained as offline fallback. One grading round required —
  photo grass is olive; green-forward tints and a lighter health-dry mix fixed it.
- **Task 2 — real trees**: Quaternius exposed no direct download (Patreon page), so
  Kenney Nature Kit (CC0, license verified in-pack) per the brief's fallback: six
  GLB variants merged per material, normalized, instanced (~6.3k instances, 14
  draws). Kenney's pastel-mint palette read toy-like against photo ground —
  remapped at load to realistic leaf/bark HSL. Honest note: these are stylized
  low-poly trees with realistic COLORING — a big step past gumdrops, sanctioned by
  the brief, but not photoreal foliage; billboard imposters remain a future upgrade.
- **Task 3 — water**: three's Water (512 reflector) per pond with the classic MIT
  waternormals map, sun-synced, time-animated. Disk margin trimmed after QA caught
  it poking through a terrain dip. The single-tonemap pipeline exposed the physical
  sky's violet zenith in reflections — vendored Water.js carries two flagged
  FAIRWAY STATE patches (reflectance capped 0.72, mirror desaturated/tinted) so
  ponds read as water; ripples and tree/sky reflections verified.
- **Task 4 — post stack**: EffectComposer (MSAA-4 HalfFloat target) → GTAO (3yd
  radius contact grounding) → UnrealBloom → OutputPass; exposure 0.84→0.92. TWO
  hard-won lessons: (1) the physical Sky emits HDR radiance in the TENS (sun disc
  thousands) — bloom threshold must clear the entire sky field (set 40) or the
  horizon floods white, found via pass-isolation screenshots; (2) an apparent
  "1 fps GPU cliff" was actually the QA browser occlusion-throttling
  requestAnimationFrame — tight-loop throughput is the honest metric: 1316 fps
  direct, 684 fps full stack mid-build, **566 fps final** at 2560×1249. Massive
  headroom retained.
- **Task 5 — clubhouse**: gabled plank-sided building with shingled overhanging
  roof, porch + columns, six framed windows glowing warm after dark, door, chimney.
  QA iterations: roof slab rotation inverted (V→gable), plane roof read as black
  void from the north (rebuilt as solid slabs), bark-scale siding retiled.
- **Honest residuals**: tee-number sprites mip to dark dots in far beauty shots
  (they're management UI; acceptable, could distance-fade later); Kenney trees are
  stylized-realistic, not photoreal; golfer/customer capsules and shop fixtures
  remain the biggest visual placeholder (already in KNOWN_ISSUES); rain has no
  particle effect. The scene now reads as a coherent, textured, grounded golf
  course rather than a strategy-map — the gap this pass existed to close.
- 121/121 sim tests untouched and green after every task; five commits, one per task.

## 2026-07-09 — v5: the shop becomes home base; camera lands closer; Tripo probe

- **Change 1 — navigation inversion (TCG-Card-Shop-style home base).** New Game and
  Continue now boot straight onto the walkable shop floor; the top-down course is a
  mode you deliberately step out into. Implemented by reusing the existing
  enterShop/exitShop handlers rather than restructuring views: `startGame()` ends with
  `handlers.enterShop()`; course-view Escape falls through its precedence chain
  (active tool → works plan → selected section → open panels) to `enterShop()` instead
  of a dead end; shop-view Escape opens the office menu (primary button is now
  context-aware: "Back to the shop"); P quick-toggles both ways. TWO in-shop exits, per
  the brief's "clear interaction point": the shop door (E) and a new framed **course
  management wall map** — a 240×160 canvas texture redrawn from the live zone grid
  (fairway loop, pond, pin flags) on every shop entry. The course itself stays
  top-down; walkable-course was explicitly ruled out (GolfTopia / Under Par precedent).
- **Playthrough verification, not code review**: Playwright run confirmed
  boot→`shop3d`, door focus label → E → `course`, Esc → `shop3d`, map focus label →
  E → `course`, P → `shop3d`, Esc-in-shop → office menu. One QA lesson repeated from
  v4: held-key WASD walking is unreliable under occlusion-throttled rAF (~1 fps —
  frames may fire only after keyup), so the run drives the same code paths
  deterministically (teleport + forced `shopScene.update()` + `interact()`), and real
  dispatched KeyboardEvents cover the Esc/P handlers.
- **Camera default: dist 430→210, pitch 0.88→0.78, framed behind the clubhouse looking
  up the opening fairway** (target −20,150 / yaw 0.12). At 430 the v4 texture work
  read as specks-and-wash; at 210 turf grain, individual tree canopies, shadows, and
  the clubhouse roof read immediately. Full zoom range (28–720) untouched. Honest
  before/after at identical 10:30 AM QA conditions: qa/v5-course-OLD-default-430.png
  vs qa/v5-course-default-view.png. (First capture attempt was unusable — 6 AM
  pre-dawn murk; the QA-conditions convention exists for a reason. Clock is
  `state.clock.minutes`, absolute.)
- **Change 2 — Tripo trees: probed thoroughly, not usable here; Kenney stays.**
  Higgsfield was excluded up front (image/video generation, no usable meshes). The
  Tripo probe: tripo-mcp's every call — including cloud generation — routes through a
  Tripo Blender addon socket; this machine's installed addon.py is vanilla blender-mcp
  (zero `tripo` matches, so launching Blender 5.1 wouldn't help), tripo-mcp's MCP
  config has an empty env, and no TRIPO_API_KEY / ~/.tripo exists (checked process,
  user, and machine scope) — which also rules out direct tripo3d.ai REST calls. Per
  the brief's fallback clause: **Kenney Nature Kit trees remain**, logged in
  KNOWN_ISSUES with the ready-made import path for when credentials exist. No
  substitute generator was smuggled in (Meshy/Hyper3D are different tools with real
  costs; the brief named Tripo or nothing).
- 121/121 tests green (nav + camera touch no sim logic; tutorial `check` functions
  deliberately untouched, hint strings only). Commits: one per change.

## 2026-07-09 — v5 continuation: Electron save bridge deep-QA'd; stale issues re-verified

- **Closed the oldest open KNOWN_ISSUES item**: the Electron native save bridge got its
  CDP-attach verification pass, as a committed repeatable tool
  (`tools/qa-electron-saves.mjs`, zero-dep Node ≥22 — built-in fetch/WebSocket). 15
  checks, ALL PASS, twice (scratchpad draft + committed tool proof run): bridge API
  shape, **v5 shop boot verified in the real ship shell**, 307 KB state byte-identical
  through save/load, real JSON files on disk, reload→Continue restores into the shop,
  office-menu slot save through the actual UI, delete/list round-trip, zero console
  errors / CSP violations. The tool cleans up after itself — no QA saves left on the
  machine.
- **Two launch gotchas worth their doc lines**: (1) `npm start -- --dev` never reached
  Electron — npm ate `--dev` as a config flag ("npm warn config dev"), so the app ran
  portless; `npx electron . --remote-debugging-port=<port>` is the reliable route
  (Electron forwards the raw Chromium switch). (2) Port 9223 was already held by the
  user's RUNNING GlassWaterV2 dev instance — attached, saw "GLASSWATER", and backed
  out without driving their window; the QA tool takes a port argument (9224 used) for
  exactly this. (3) userData derives from **productName** ("FAIRWAY STATE"), not
  package name — first disk assertion looked at `%APPDATA%\fairway-state\` and found
  nothing while `list()` said the saves existed; GLASSWATER keeps its own folder, so
  no cross-app save risk.
- **Re-verified two suspected-stale KNOWN_ISSUES bullets with screenshots** rather than
  striking them on memory: low-sun horizon (6:50 AM / 7:35 PM, both facings,
  qa/v5-sky-*.png) shows no white flood — v4's bloom-40 fix holds; water ripple
  normals shipped in v4. Both struck. NEW precise residual while looking: tee-number
  sprites go solid black viewed against the light (lit sprite material) — logged.
- Tripo status unchanged (no credentials); noted that the Higgsfield MCP server now
  advertises a `generate_3d` image→GLB mesh tool — the v5 brief excluded Higgsfield
  on "images/video only" grounds, so that exclusion may rest on outdated info, but it
  stands until the user says otherwise. Not touched.

## 2026-07-09 — GOLF EMPIRE session start: repo seeded from FAIRWAY STATE

- **New product, same core.** The GOLF EMPIRE brief arrived pointed at an EMPTY
  `Golf-Flipper/` working directory while declaring itself "a scoped extension to the
  existing FAIRWAY STATE codebase — do not rebuild." Resolution: located the FAIRWAY
  STATE repo at sibling `../Golf/` (its DEV_LOG self-identifies) and **copied the whole
  repo here, git history included** — the same repo-seeding pattern this machine already
  used for GLASSWATER → GlassWaterV2. The original `Golf/` repo stays untouched, which
  makes "the base game stays exactly as it is" literally true. Seed captured `748f8c9`
  (post-v5, incl. the GTAO sprite fix) with a clean tree; baseline `npm test` re-run
  HERE: 121/121 green before any new work.
- **Identity/isolation pass so the two games can never collide on one machine:**
  productName "GOLF EMPIRE" (Electron userData → its own `%APPDATA%\GOLF EMPIRE\saves\`,
  since userData follows productName — learned the hard way in the v5 save QA),
  localStorage prefix `golfempire:` (browser QA), dev server port 8457 (8437 GlassWater /
  8447 FAIRWAY STATE), remote debugging 9225 (9223 GlassWater), window/menu titles.
  No sim module touched.
- **Scope discipline for this session** (per the brief): add ONE layer — marketplace,
  valuation, buy/sell, portfolio + switching, and the two screens to use them. The
  forbidden-to-touch list (turf/club/staff/shop/golfers/rounds/progression/tutorial) is
  honored by importing, never editing; anything they need to expose differently gets
  wrapped in the new modules instead.

## 2026-07-09 — GOLF EMPIRE Task 1: property records & the marketplace (sim/marketplace.js)

- **Properties are real courses, not stat sheets.** Each record carries a layout spec +
  a build seed; `buildPropertyCourse()` deterministically paints the actual 120×80 grid,
  and the listed design rating is COMPUTED by scoring that grid with the same
  `courseDesignRating` the live game uses. The marketplace cannot list a design number
  the land doesn't earn. Condition is stored as a seeding TARGET the buy transaction
  (Task 3) will realize through the turf arrays.
- **One appraisal formula, two callers.** `appraiseStats({size, design, condition,
  members, reputation, monthlyNet})` prices the hidden trueValue at listing time and
  will be the core of the live valuation (Task 2). Shape: land floor ($12k/9 holes) +
  quality term ((0.45·design + 0.55·condition)^1.18 · $220 · sizeF^0.85, condition
  weighted over design because that's also how the play rating works) + business term
  (members·$450, reputation over 20·$180, trailing seasonal net·1.6 clamped). "Monthly"
  income = per-season (24-day) trailing net — the game has no calendar months, the
  season is its billing period. Tuned so Willow Creek asks ~$45k (realistic's $60k can
  buy it with working capital) and the 18-hole whale asks ~$89k (relaxed territory).
- **Roster is 8 hand-authored archetypes, not one scaled template**: Willow Creek (the
  original fixer-upper, via the untouched `buildStartingCourse`), Bent Pines (superb
  bones/dead turf — the bargain, bias 0.72), Flatiron Meadows (immaculate/dull, D~64
  C74), Saltgrass Point (executive-nine gem), Thornbury Estate (sprawling 18h whale),
  Quarry Bluffs (drama, elevAmp 2.0), Cypress Hollow (waterlogged, brown-patch
  flavored), Fairview Commons (the OVERPRICED trap, bias 1.24). Listing bias × small
  seeded jitter means ask and true value routinely diverge — the appraisal-judgment
  mechanic exists at data level from day one. Fairview's greens were oversized after
  the first dump (D80 → D72) so its stats match its "ordinary golf, ambitious ask"
  fiction.
- **Serpentine generator for non-Willow layouts**: holes routed boustrophedon across
  horizontal bands (how real courses route rectangular parcels), lengths drawn per
  par-mix with band-fit clamps, optional doglegs, greenside bunkers (`onlyOver`
  grass), ponds via a guarded ellipse that refuses to paint over GREEN/TEE cells.
  Paint order is the safety net — every corridor first, all pads last — so no rough
  halo can ever bury a pad that `validateHole` depends on. Per-band budgets were
  hand-checked per archetype (e.g. the 18-holer runs margin 6 × 10 bands; green-vs-
  green spacing stays clear because greens paint after everything).
- **`startingCourse.js` got four `export` keywords** (paintDisk, paintCorridor,
  shapeElevation, flattenUnder) so the generator reuses Willow's proven primitives
  instead of duplicating them. Additive only, zero behavior change — file is not on
  the forbidden list, and the whole 121-test baseline stayed green to prove it.
- **TDD**: 9 marketplace tests written first and watched fail (roster validity,
  distinctness, archetype spread, ask≠value, per-seed determinism, playable-course
  round-trip vs listed stats, deterministic rebuild, appraisal monotonicity, debug
  dump). 130/130 suite green after implementation.

## 2026-07-09 — GOLF EMPIRE Task 2: live valuation (sim/valuation.js)

- **The displayed estimate IS the sale payout** — `appraiseProperty(state)` is the only
  valuation anywhere, and it delegates to the same `appraiseStats` that priced listing
  trueValues, fed by the systems that already exist: `clubRatings` (design+condition),
  `memberCounts`, `club.reputation`, and the ledger. Nothing re-implements rating math.
- **"Trailing average monthly income" = trailing seasonal net**: average daily net over
  up to the last 24 closed ledger days × 24. A short history extrapolates its daily
  average rather than undercounting a new club; an empty history reads 0. (The ledger
  keeps 30 days, so the window is always available.)
- **Acreage counts real holes** (validateHole-passing, any status) — renovation dents
  design, not the land itself; unbuilt stubs price as nothing. `appraiseStats` gained a
  floor (`max(size,4)`) so even a maliciously razed property keeps its dirt value.
- **Purity is unit-tested**: appraisal consumes no randomness and never mutates state —
  the UI can call it every frame and saves can't drift from a look.
- **Manual sanity arc** (same seed, same property): as-bought $54k → run into the
  ground (C0, no members, −$650/day) $9.5k → restored (C87, 46 members, +$1,150/day)
  $128.5k. The buy-restore-flip fantasy exists in the numbers. 9 new tests; 139/139.

