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

## 2026-07-09 — GOLF EMPIRE Task 3: acquisition & sale (sim/empire.js)

- **Buying boots the REAL newGame().** `state.js` gained a two-line optional `opts`
  param ({course, clubName}) so `initPropertyState` runs the exact same init wiring —
  turf, golfers, staff, shop, club, ledger, progression, tutorial, in the same order —
  onto the property's deterministically-built course. No parallel init path to drift.
  state.js is not on the brief's forbidden list; existing call sites are untouched
  (defaults preserved, full baseline green).
- **Seeding to the listing**: default diseases wiped, then exactly `sickGreens` greens
  infected with the listed disease (brown patch also wets its cells so the in-game
  diagnosis copy stays TRUE); turf arrays iterated until the live `conditionRating` —
  the same number the HUD shows — lands within ~1.5 of the listed condition (test
  tolerance ±4); membership trimmed/grown to the listed count (poorest walk first,
  wealthiest sign first — a distressed sale rarely conveys the whole book); reputation
  set from the listing; prestige derived low (clamp(8 + rep·0.3, 5..30)). Staff do NOT
  convey — the old crew walked before closing; you inherit the hiring market.
- **One wallet.** `empire.cash` is the only money; the ACTIVE club's `state.cash` is
  that wallet (so the entire existing economy/ledger/solvency stack works untouched),
  synced back before any empire-level transaction. The unit tests immediately caught
  the one bug this design invites — buying property B while property A is active
  deducted the wallet but not A's mirrored cash — hence the explicit `payer.cash`
  write-back. Parked properties hold $0; a known consequence is that realistic-mode
  `debtDays` counts against whichever club is active (empire-wide debt is the same
  number, just tracked on the active state).
- **Shared world clock**: a newly bought property joins at the CURRENT world time
  (active club's clock), with a fresh weather roll for that calendar day — no
  time-travel between properties. While nothing is active, `empire.clockMinutes`
  remembers the hour.
- **Selling is scorched earth**: payout = `appraiseProperty(state)` (the same number
  the UI will display), holding spliced out — course, members, golfer memories, staff,
  shop stock, all gone with it; the listing does NOT quietly return to the market
  (buy-backs logged as future work). Tutorial runs only on the first property ever
  bought; later purchases arrive with it retired.
- **DONE-WHEN playthrough (headless)**: the brief's "live playthrough" for this task
  was run at the sim level (the screens don't exist until Task 5, which re-proves the
  loop in a real browser): bought Bent Pines $31k (true $43k) → crew 4 + hires +
  fungicide + feeding → C31→C78, 7→44 members over 22 days → sold for the displayed
  $107,500 → wallet $191k, holdings empty. Flip margins at this tuning are GENEROUS
  (+$76.5k in 22 relaxed-mode days, mostly via membership growth the base game's own
  join dynamics produce) — logged as a post-playtest balance knob, not changed now.
- 11 new tests written first (including one that buys every archetype, checks realized
  condition ±4 and appraisal within 15% of hidden true value, and runs a full sim day
  on each). Suite 150/150.

## 2026-07-09 — GOLF EMPIRE Task 4: portfolio, switching, and the passive tick

- **Model: exactly one live club.** Every holding keeps its FULL state object in memory
  (~a few hundred KB each — trivial for a handful of properties); "parked" means the
  sim doesn't run on it, not that it's serialized away. Switching parks the outgoing
  club (freezing a passive summary), reconciles the incoming one, and hands the wallet
  over. `empireUpdate(empire, minutes)` is the single tick the app calls: full sim for
  the active club, then one passive day per world-day for every parked holding.
- **THE PASSIVE APPROXIMATION (the judgment call this task demands logged):**
  Each parked property carries `{conditionEst, design, members, reputation, greenFee,
  duesPerDay}` frozen at park time. Per world-day:
  - *Condition*: `conditionEst → max(38, est − (est − 38)·0.035)` — exponential decay
    toward a caretaker floor of 38, half-life ≈ 20 days. It only pulls DOWN: a course
    parked below 38 holds (the caretaker prevents rot but does not restore — otherwise
    parking a wreck would be a free renovation, an obvious exploit the tests pin).
    Reasoning: an unattended-but-caretaken course loses its edge fast (greens are the
    perishable asset) but doesn't become a ruin, matching the fiction that some
    minimal crew stays on.
  - *Income*: `rounds = 14 · seasonF · (q/60) · clamp(rep/45, 0.3, 1.4) · sizeF` where
    `q = 0.4·design + 0.6·conditionEst` (the HUD's own overall blend) and seasonF is
    the live club's seasonal demand table [0.95, 1.15, 1.0, 0.22]. Revenue = rounds ×
    frozen green fee + frozen dues/day; costs = $150·sizeF caretaker+skeleton
    maintenance + $45 utilities; `net = clamp(revenue − costs, −800·sizeF, +2600·sizeF)`
    credited straight to the ONE wallet daily. Base 14 rounds vs the live club's ~30:
    nobody is marketing, hosting, or selling — showing up must always beat parking.
    Sanity: parked Willow trickles ~$400–550/day vs ~$800–1500 attended; a parked wreck
    makes ~$100/day (the caretaker still sells a few rounds — the REAL cost of parking
    a wreck is the condition/value decay, not the P&L).
  - *Frozen on purpose*: membership, satisfaction, staff, shop, prestige do not move
    while parked (the task says income + condition drift, NOT a shadow sim). Staff are
    effectively furloughed (the caretaker line stands in for wages); scheduled outings
    you weren't there to host are FORFEITED on return with a feed entry (paying them
    would be time-travel money; the passive net never included them). A tournament
    scheduled then abandoned resolves on your first night back against current
    condition — rare, self-inflicted, left as-is.
- **Reconciliation on return**: clock jumps to world time, `driftTurfToward` writes the
  decayed estimate into the REAL turf arrays (same iterate-to-target used at purchase,
  ±1.5 tolerance; unit test holds realized-vs-estimate to ±4), supplier orders that
  arrived while away land in the backroom, stale outing offers expire, weather re-rolls
  for the actual calendar day, and the 5 AM pass is re-armed. A same-moment
  switch (no world time passed) is a PURE unpark — zero side effects, so A→B→A
  round-trips byte-identical state; the fingerprint test enforces exactly that.
- **Parked value = sale payout, no mutation**: `holdingValue()` prices parked clubs via
  `appraiseStats` over the frozen summary + drifted estimate (income term: lastNet×24),
  and `sellProperty` pays exactly that number — "the number on the screen is the number
  on the check" holds for parked sales without touching their arrays. Active sales use
  the live appraisal as before.
- **Save format**: one envelope — `{empireVersion, mode, seed, cash, clockMinutes,
  activeId, market, holdings: [{property, passive, state: snapshot()}], log, ...}` —
  reusing the existing per-state snapshot/deserialize verbatim. A pre-empire plain
  GameState save still loads: it wraps into a one-property empire ('legacy-club',
  market minus the Willow listing so the world holds one Willow Creek).
- **Tests caught real test-bugs too**: Float32 vs double rounding (fixed with
  Math.fround on the expected side) and the transaction log legitimately remembering a
  sold club's name (history ≠ resurrection; assertion narrowed to holdings+market).
- 12 new portfolio tests (round-trip fingerprint, parked-doesn't-sim, wallet math,
  192-day boundedness, below-floor hold, drift reconciliation, parked-sale pricing,
  multi-property save/load, sold-stays-sold, legacy wrap, bad switches, displayed-
  value formula pin). Suite 162/162.

## 2026-07-09 — GOLF EMPIRE Task 5: the market & empire screens, and what browser QA caught

- **Two screens, existing patterns only.** The property market is a `modal()` (new
  `.modal.wide` class) listing every record's real stats + blurb + Buy, wallet at top —
  the hidden trueValue is deliberately absent; judging a listing against its ask IS the
  game. The empire overview is a standard left `panel` (same class as Grounds/Club):
  wallet, total portfolio value, combined "all courses yesterday" net (active club's
  closed books + every parked club's passive day), a card per holding (condition,
  value, income, "earned $X while you were away"), Go there / Sell…, market button,
  and the deed log. HUD gains 🏢 Empire; M toggles it; the Clubhouse Office menu gets
  an "Empire overview" entry so it's reachable from the shop too.
- **main.js now plays an EMPIRE, not a state**: New Empire opens the market over the
  menu (the first act is judgment — you own nothing until you buy); the first purchase
  boots the club through the existing `startGame`; later purchases park from birth;
  `empireUpdate` drives the frame loop; autosave/save-slots/Continue/bank-failure all
  read and write the empire envelope. Switching = `switchProperty` + `startGame` (full
  scene rebuild — it's a different course; you arrive on the new club's shop floor,
  consistent with the v5 home-base rule). Selling the active club moves the office to
  the next holding; selling the last one drops you back to the market with the check.
- **The sale confirm pauses the world** so the number in the dialog is exactly the
  number `sellProperty` pays — the modal restates the permanence in plain words.
- **Browser QA caught a real economy exploit** (the whole reason the done-when demands
  a live playthrough): `trailingMonthlyNet` extrapolated a 6-day honeymoon to a full
  season and a $46k Willow appraised at $103.5k on day 6 — a 2.3× flip in six days.
  Fixed: the trailing window now counts only what was actually BANKED (sum of the last
  ≤24 closed days, no extrapolation); the valuation test was updated to pin the new
  semantics, and the same six-day Willow now appraises ~$69.5k. Honest residual, noted
  in KNOWN_ISSUES: a parked club is priced on its caretaker run-rate (lastNet×24)
  while a young active club is priced on thin books, so parking a healthy 6-day-old
  club reads ~15% higher until its history fills — exploit-resistant in the direction
  that matters (attended steady-state books always beat the caretaker run-rate).
- **Full playthrough verified in a real browser** (Playwright over `npm run serve`,
  port 8457): menu → New Empire (Relaxed) → market modal (8 listings, wallet
  $100k) → bought Willow Creek $46k → booted onto its shop floor, tutorial 1/10 alive,
  HUD wallet correct → bought Bent Pines $30.5k from the in-game market (parked from
  birth, C31) → 5 days at 16×: Bent accrued +$480 at +$96/day, held C31 (below-floor
  hold verified live), Willow's books/members/rep all moving → Go there: office moved
  to Bent Pines (own course renders — serpentine bands, bunkers; own shop floor;
  second-club tutorial correctly skipped) → Willow parked, "earned $584 while away" →
  Sell… confirm showed $81,000, paid exactly $81,000, wallet $112,212, holding gone,
  not re-listed → page reload → Continue restored the whole empire (Bent active, day
  7, wallet intact, market at 6). ZERO console errors across the entire run (one
  pre-existing THREE shader-compile warning from the base renderer appeared once in
  an earlier session; none after). Screenshots: qa/e1-marketplace.png,
  e2-first-buy-shop-boot.png, e3-empire-two-holdings.png, e4-bent-pines-course.png,
  e5-sell-confirm.png.

## 2026-07-09 — GOLF EMPIRE portion 1: SESSION SUMMARY

**What was built** (all five bricks of the brief, in order, each TDD'd and committed):
`sim/marketplace.js` (8 hand-authored distinct property archetypes over a parametric
serpentine course builder — every listing is a real, buildable, validated course;
hidden trueValue priced by the shared `appraiseStats`), `sim/valuation.js` (one live
appraisal = displayed estimate = sale payout, fed by the existing ratings/club/ledger
outputs), `sim/empire.js` (one-wallet empire; buy boots the REAL `newGame` wiring onto
the property's course and seeds it to the listing; sell pays the displayed number and
erases every trace; portfolio with exactly one live club; passive caretaker ticks;
reconciliation on return; empire save envelope + legacy wrap), and the two screens
(market modal + empire panel) wired through `main.js` so the app plays an empire.
41 new headless tests, suite 162/162; full zero-console-error browser playthrough.

**The judgment calls that matter** (each argued in its own entry above):
1. Marketplace listings are REAL courses, never stat fictions — design ratings are
   computed from the actual grid; condition is a target realized in the turf arrays.
2. One appraisal formula everywhere — the listing's hidden value, the owner's estimate,
   and the sale check can never disagree; parked clubs price on their frozen summary so
   the shown number stays the paid number without mutating state.
3. One wallet, carried by the active club's `state.cash` — the entire existing economy,
   ledger invariant, and solvency stack run untouched.
4. Parked properties approximate, never shadow-simulate: exponential condition decay to
   a caretaker floor (never below, never restoring a wreck), bounded daily net from
   frozen stats, everything else frozen; the drift becomes real turf on return.
5. Anti-exploit valuation: trailing income counts only banked days (browser QA caught
   6-day honeymoons annualizing into 2.3× flips before this).
6. FAIRWAY STATE core untouched: zero edits to turf/club/staff/shop/golfers/rounds/
   progression/tutorial; `startingCourse.js` gained four `export` keywords and
   `state.js` a two-line opts param — both additive, baseline-verified.

**Explicitly left for the next portion** (parked in KNOWN_ISSUES with reasoning):
empire-wide prestige, a living market (new/refreshing listings, buy-backs, rival
buyers), manager delegation for parked clubs (the upgrade path from the caretaker
approximation), more archetypes/climates, empire financing, the young-club valuation
semantics gap, the flip-margin balance pass, and per-club debt-clock semantics.


## 2026-07-09 — LIVING MARKET session: Part 1 (repo consolidation) & Task 1 (new listings over time)

Part 1: this repo is now the sole active codebase; the original FAIRWAY STATE repo
(sibling `Golf/`) is retired to read-only reference. Both READMEs say so plainly —
a banner at the top of Golf's, a note near the top of ours. Documentation only; no
code moved in either direction.

Task 1 makes the market a living thing: a fixed roster of 8 that runs out becomes a
stream. New listings are generated over time by `generateListing()` in marketplace.js
and injected by a per-world-day `marketTick()` in empire.js, wired into `empireUpdate`.

**Judgment calls, with reasoning:**

- **Cadence = a roll every 6 days at 75%** (`MARKET.refreshEveryDays`/`refreshChance`),
  landing a listing about every 8 days — inside the brief's "every 1-2 in-game weeks."
  A roll-plus-chance beats a fixed metronome: the player learns the rhythm ("check the
  market most weeks") without being able to set a watch by it.
- **Cap = 10 unsold listings** (`MARKET.maxListings`, brief suggested 10-12). The launch
  roster is 8, so a quiet market has headroom of 2 before turnover (Task 2) exists —
  the window stays a window, not a warehouse.
- **Dry-market floor = 3** (`MARKET.dryMarketFloor`): at or below 3 listings the next
  roll is guaranteed. An aggressive buyer can't be starved into dead weeks by rng.
- **One generation path, parametrized.** Seven distress-profile templates generalize
  the 8 hand-authored archetypes into ranges (neglected-gem, tired-muni, polished-bore,
  executive, waterlogged/brown-patch, legacy-trap, and a rare 18-hole championship
  wreck at weight 1 of 15). Layout params push the design rating the intended
  direction, but the listed rating is still COMPUTED by building the real course —
  same serpentine builder, same appraisal, same rigor assertions in tests.
- **Par-mix sanity rails**: the weighted par draw is capped (≤2 par-5s on a nine, ≤4 on
  an eighteen, ≤6 par-3s) and generated nines use a slightly tightened par range
  (GEN_PAR_RANGE) so even an extreme roll stays inside honest yardage bounds
  (1500-3800yd / 3800-7400yd). Checked against worst-case arithmetic, then enforced by
  building all 30 test listings for real.
- **Names** come from two-part pools + suffix (2,376 combos), deliberately disjoint
  from the launch roster's names, with retry against everything currently listed or
  owned. A name can recur after its bearer is SOLD and gone — accepted; the alternative
  is tracking a graveyard forever for a case players will rarely notice.
- **The market has its own serializable rng stream** (`empire.marketRngState`, seeded
  `seed ^ 0x9e3779b9`) — market luck never consumes the active club's dice, saves
  replay the exact same market future, and `lastMarketDay` catch-up keeps multi-day
  steps honest.
- **The market only moves while world time moves.** No active club → the world clock
  stands still → no churn. Consistent with the existing world-time semantics rather
  than inventing a second clock.
- **Migration**: pre-living-market saves (v1 empire envelopes and legacy single-club
  saves) grow the stream on load, join the market clock at their own world day, and
  their frozen listings are stamped listed-today — fair, since their expiry clock
  (Task 2) shouldn't start in arrears for time the feature didn't exist.

Tests: 7 new in tests/market-live.test.js (cadence knobs honest, listings appear over
60 quiet days, cap held across 400 days, launch-roster rigor on generated listings,
24-listing long-run variety incl. all courses building valid, growth through the real
live-club update loop, save/load + migration). Suite 169/169. A 120-day dump shows the
launch 8 growing to the cap with distinct, correctly-priced arrivals announced in the
empire feed.

## 2026-07-09 — LIVING MARKET Task 2: listings that don't last forever

Rival investors now take listings that sit unbought. Implemented as a per-day roll in
`marketDay()` — before the refresh roll, so a slot freed by a rival can be refilled the
same day the cadence allows.

**Judgment calls, with reasoning:**

- **Grace window = 10 days on market** (`MARKET.minDaysListed`): inside it a listing is
  untouchable. That's the "actively considering" protection the brief demands — you can
  sleep on a purchase across a payday or two without being sniped, but you cannot sit
  on a bargain for a season.
- **Rival roll = 5.5%/day after grace** (`MARKET.rivalDailyChance`): mean tenure ≈ 28
  days (10 + 1/0.055), i.e. a listing typically survives about a season; some go the
  day grace ends, a few linger 60+. A roll, not a countdown — the player learns
  "bargains don't wait" without being handed a min-maxable timer.
- **Rivals pay nobody and the course leaves the game.** No shadow economy, no rival
  portfolios — that's the "living market with competing buyers/auctions" future-work
  item in KNOWN_ISSUES, not this task. The notice (kind `rival`, distinct from
  `market` arrivals so the UI can badge them) names a flavor buyer from a small pool.
- **Removal is feed-visible, never silent**: every rival buy logs "X bought <name> —
  it's off the market." The empire log stays capped at 30 entries; the test suite
  therefore collects notices during the run rather than trusting the final buffer.
- **Accepted flavor nit**: name-pool combos can produce near-siblings on the market at
  once ("Candlewood Bend" / "Candlewood Bend Golf Links"). Names stay strictly unique
  as strings; deduplicating by first word would cost pool variety for a case that reads
  like real-world golf naming anyway.

One ignored in-game year (seed 20260709): launch roster fully turned over — all 8
gone to rivals with visible notices, earliest at day 12 (≥ grace), replacements cycling,
market holding ~5 listings at steady state. Tests: 2 new (grace window + knob sanity;
250-day turnover with per-removal age and per-removal notice checks). Suite 171/171.

## 2026-07-09 — LIVING MARKET Task 3: market conditions (pricing drift)

A single bounded multiplier, `empire.marketCondition`, now represents the
buyer's/seller's cycle. It multiplies the ASKING PRICE of listings generated while
it's in effect — and touches nothing else.

**Judgment calls, with reasoning:**

- **Bounds ±15%** (`conditionMin` 0.85 / `conditionMax` 1.15): enough that timing a
  purchase into a trough is real money on a $50k course (~$15k swing peak-to-trough),
  small enough that a bargain archetype in a hot market can still be a bargain. It's a
  modifier, not an economy — the brief is explicit that this needn't be a model.
- **Drift shape: lerp-to-target + whisper of noise.** The target re-rolls uniformly
  inside the bounds every 24 days (`conditionRetargetDays` — once a season), and the
  mood covers ~86% of the gap per season (`conditionLerp` 0.08), so cycles feel
  seasonal: slow swells, no lurches. Daily noise 0.008 keeps the line organic. The
  bounded-drift test pins both: 600 days inside hard bounds with a worst daily step
  under 0.03.
- **The mood prices ONLY new arrivals.** `generateListing` bakes the multiplier into
  the sticker at listing time; the listing then never re-prices (the ask you saw is
  the ask you pay — same shown-number-is-paid-number ethic as sales). Owned property
  valuations — active or parked — never see the multiplier, per the brief's explicit
  test requirement: they price on their own condition/income. Consequence I'm
  accepting and documenting: "sell into a seller's market" is NOT a mechanic; the
  timing strategy is entirely buy-side (asks run soft in a downturn). Applying the
  cycle to sale payouts is logged in KNOWN_ISSUES as future work, because it needs
  anti-exploit thought (park-and-wait-for-peak with zero effort) that this task's
  scope doesn't cover.
- **Drift runs before the day's refresh** in marketDay so an arrival prices on the
  day's mood, not yesterday's.
- **Migration**: older saves join the cycle at par (1.0) and drift from there;
  new empires start at par with a random first target already pulling.
- Also fixed while staring at name output: the pool guard now rejects repeated-word
  combos ("Wren Hill Links Golf Links" can no longer occur).

Two-year dump (seed 55555): mood swung 0.87→1.10→0.87; arrivals' average ask/true
ratio moved 0.896 (soft market) vs 1.040 (hot) with per-seller bias noise on top —
learnable, not min-maxable. Tests: 3 new (bounded slow drift; same-stream clone
empires spawn the same day-6 course asking ×1.35 more at the top of the cycle than
the bottom; owned-property isolation incl. sale payout). Suite 174/174.

## 2026-07-09 — LIVING MARKET Task 4: the screens, and what browser QA caught

The market modal now leads with one honest status chip — Buyer's market / Balanced
market / Seller's market — and each listing carries a relative age line. Rival
buy-outs and new arrivals land in the empire panel's existing deed log with kind
icons (🏴 rival, 🏷 market news; log depth 6→8 since the market talks more now).

**Judgment calls, with reasoning:**

- **Mood label thresholds at 0.96 / 1.04**: a ±4% dead zone reads "Balanced" so the
  label doesn't flap on noise; beyond it the copy commits. No numbers shown anywhere —
  the hint text on hover says what to do about it, not how big it is.
- **Age copy in three buckets** ("Just listed" ≤2d, "A week or two on the market",
  "Been sitting — rival buyers circling"), with the third bucket starting exactly at
  MARKET.minDaysListed: the UI only threatens rivals once rivals genuinely can act.
  No countdown — urgency without a min-max timer, per the brief.
- **A market left open stays live**: the frame loop's day-pass hook re-renders it via
  an `app.marketRefresh` handle that un-hooks itself once the modal leaves the DOM.
- **Bug caught by browser QA** (the reason the done-when says "interact with the real
  build"): `modal()` runs its build callback BEFORE attaching the box to the document,
  so gating the FIRST render on `box.isConnected` produced a perfectly empty market
  modal. Fix: only the live-refresh wrapper checks connectivity; the initial render
  always paints. Caught within a minute of driving the real UI.
- **QA fast-forward methodology**: long stretches were driven by dynamic-importing
  `/src/sim/empire.js` in the page and calling the REAL `empireUpdate` day by day —
  same module instance the frame loop uses, so no QA-only code paths were added to
  the game to make it testable.

Browser QA (fresh empire, ~62 in-game days): day-0 market shows Balanced + 8×"Just
listed" (lm1); launch roster fully rival-bought with named 🏴 notices while new stock
cycled in; mood indicator changed Balanced → Seller's market with warn-colored chip
and age labels spanning all three buckets (lm2); bought a GENERATED listing
(lst-ozisrk, "Tamarack Ridge Golf Club" $43,000) through the real Buy button, switched
to it, and walked its serpentine nine in 3D (lm3); market modal left open live-updated
across midnights (marked DOM node replaced); reload → Continue restored mood, market
day, every listing's listedDay stamp, holdings, and feed byte-for-byte; ZERO console
errors or warnings across the entire session. Suite 176/176.

## 2026-07-09 — LIVING MARKET portion: SESSION SUMMARY

**Built this portion**, on top of portion 1's fixed-roster marketplace: repo
consolidation (this repo is now the sole active codebase; `Golf/` retired to
reference), then the market made alive — `generateListing()` (7 parametrized
distress-profile templates through the same serpentine builder + shared appraisal;
one generation path), `marketTick()`/`marketDay()` (per-world-day: pricing-cycle
drift → rival buy-outs → cadence refresh, all on the empire's own serializable rng
stream), and the screens (mood chip, relative age lines, 🏴/🏷 feed, live-refreshing
market modal). 14 new headless tests → suite 176/176; ~62-day browser playthrough
with zero console errors.

**The judgment calls that matter** (each argued in its own entry above):
1. Cadence ~1 listing/8 days (roll every 6 at 75%), cap 10, dry-floor 3 — rhythm
   without a metronome, a window not a warehouse, no rng starvation.
2. Grace window 10 days + 5.5%/day rival roll → ~28-day mean tenure: urgency you can
   feel, protection while you're actually deciding, no min-max countdown anywhere.
3. Pricing cycle 0.85–1.15, seasonal lerp-to-target: prices NEW asks only. Buy-side
   timing is a mechanic; sell-side is deliberately not (anti-exploit), logged in
   KNOWN_ISSUES as future work.
4. The market moves only while world time moves, and replays identically through
   saves (own rng stream, lastMarketDay catch-up).
5. Migration is fair: old saves join the market clock "today" — no rival buys or
   drift in arrears for time the feature didn't exist.
6. Browser QA caught the one real UI bug (modal builds before DOM attach → the
   isConnected guard blanked the first render) — the done-when's "interact with the
   real build" clause earned its keep again.

**Explicitly left for future portions** (recorded in KNOWN_ISSUES): empire-wide
prestige, manager delegation, buy-backs/re-listing of sold courses, rival buyers as
visible actors/auctions, the pricing cycle on sale payouts, more climates/archetypes,
empire financing.

## 2026-07-09 — WALKABLE COURSE Task 1: first-person camera, movement, collision

The course is now experienced on foot by default. The controller is the pro shop's,
adapted outdoors: WASD + pointer-lock look (arrows as accessibility/QA fallback),
Shift to run, a 0.34-yd body circle, axis-separated movement so blocked diagonals
slide along obstacles. The old management rig stays one Tab away — it isn't deleted,
it's demoted.

**Judgment calls, with reasoning:**

- **Eye height 1.75 yd, walk 3.4 yd/s, run ×1.8.** The shop's proven controller runs
  1.7/3.1 in a 14-yd room; outdoors, 1.75 yd (≈5'3" eye line — a real human eye
  height) reads right against 6–12-yd trees and the 8-yd cell grid, and 3.4 yd/s
  (~7 mph brisk walk; ~12.5 running) makes a 300-yd hole feel like a real walk
  without being a slog. Task 2's cart is the fast option, not a faster walk.
- **No new collision data, per the brief**: tree circles (r 0.55) come from the SAME
  computeTreeSpots()/placeSpot() the renderer plants (1,120 on the current course);
  the clubhouse is one AABB around its 26×16-yd gabled body (the porch stays open —
  you can shelter under it between the columns); water blocks at the cell edge by
  sampling the toe of each step against course.zones. Works rebuilds refresh the
  colliders (rebuildAll → refreshWalkColliders) so felled trees stop blocking.
- **First-person camera = the scene camera, retuned per mode**: FOV 66 / near 0.15
  on foot (the shop's human FOV), restored to 46 / near 1 when the rig takes over.
  One camera keeps the whole post stack (GTAO, bloom) untouched.
- **Tab is the mode toggle** (preventDefault'd — it's a camera switch, not DOM
  focus). Esc on foot follows the shop convention (release pointer → office menu);
  Esc in the overview returns you to your feet. Works from on-foot shows an honest
  redesign notice and points at the overview, where the existing editor still fully
  functions — nothing silently breaks.
- **Spawn = just past the porch, facing the course** (the door you walked out of);
  a guard nudges the spawn out of any obstacle that might have grown there.
- **Pointer lock is request-with-fallback** (same as the shop): some environments
  (incl. automation) refuse it; click-to-look plus arrow-look cover it.

Browser QA (Tamarack Ridge, a GENERATED course): P out of the shop boots walk mode
at the clubhouse; movement measured at exactly 3.4 yd/s at eye height exactly 1.75;
collision verified to the centimeter against all three classes — a tree (stops at
0.89 = trunk 0.55 + body 0.34), the clubhouse wall (maxZ + 0.34), and a pond (walked
9.65 yd, stopped at the water cell edge + 0.34); arrow-look and (lock-stubbed)
mouse-look deltas match the tuned rates; Tab → overview (FOV 46, rig restored) and
back resumes the exact standing position. Zero console errors or warnings.

## 2026-07-09 — WALKABLE COURSE Task 2: the golf cart

A real cart parked by the porch: walk up ([E] take the wheel — the shop's focus +
interact convention), drive at cart pace, [E] park here, and it stays exactly where
you left it, solid to walk against, visible from the overview too.

**Judgment calls, with reasoning:**

- **10 yd/s (~20 mph) forward, 3.5 reverse — an honest golf-cart pace, 2.9× walking.**
  Fast enough that crossing a 960-yd property is a drive, slow enough that steering
  matters and trees still kill your line.
- **Handling, not physics**: W/S throttle along the heading, A/D steer at 1.6 rad/s
  under way (reduced authority reversing, gentle pivot when stopped), no strafing in
  a vehicle, mouse-look doubles as the wheel. The brief asked for faster movement
  with reasonable turning — this is exactly that, no drift model pretending otherwise.
- **The cart is a solid object**: a 1.1-yd circle when parked (QA repeatedly proved
  this by accident — the test player kept walking into it and stopping at exactly
  1.44 yd center-to-center), 0.9-yd collision radius while driven, seated eye 1.55.
- **Dismount steps out the side** (right door, then left, then out the back —
  whichever isn't blocked), and the mesh parks at that spot.
- **Cart position is render-layer state**: it re-parks by the clubhouse on scene
  rebuild (save/load, property switch). Persisting a parked-cart coordinate into the
  save format for a purely-visual convenience isn't worth the schema noise at v1 —
  logged here deliberately.
- Self-collision bug caught in QA: the park-position guard saw the cart itself and
  pushed the spawn 45 yd downfield — fixed with an ignore-cart flag on the check.

Browser QA: prompt appears on approach + facing; mount snaps to the wheel; open-field
speeds measured walk 3.41 vs drive 10.0 yd/s (2.9×); steering measured 1.6 rad/s;
the cart mesh follows under way; dismount steps 1.7 yd clear and the prompt flips
back to "take the wheel". Zero console errors or warnings.

## 2026-07-09 — WALKABLE COURSE Task 3: walk-up turf inspection

The top-down click-to-inspect is now a walk-up: the patch of ground ~2.4 yd ahead of
your feet carries a shop-style prompt — the section's name and ONE status word
("Green 1 — Declining — [E] inspect") — and E opens the exact same inspect panel
(status chip, stimp, diagnosis, Details, treat/aerate) the click used to.

**Judgment calls, with reasoning:**

- **The trigger is the aim cell, not a radius**: a fixed 2.4-yd look-ahead from the
  player's heading maps to one grid cell, and that cell's section is what you're
  "at". Predictable, cheap, and it means the prompt IS the answer to "what am I
  standing in front of" — the one-status-first rule from the panel now lives on the
  crosshair too.
- **All the data flows through the hooks the app supplies** (turfLabelAt/inspectAt →
  sectionAtCell + sectionStatus + inspectPanel.show): the render layer never imports
  sim logic, and the panel, diagnosis copy, and treatment buttons are the SAME code
  the top-down path used — only the trigger and camera changed, per the brief.
- **E releases the pointer** when the panel opens (its Details/Fungicide/Aerate
  buttons need a cursor); clicking the canvas re-locks. Esc closes the panel first,
  then panels, then the office — the same layered-escape the game already teaches.
- **Non-turf sections still inspect** (bunkers, paths — the panel's zone chip), and
  unzoned scrub deliberately prompts nothing, so the prompt only ever names a real
  section. The cart prompt wins over turf when both apply — vehicles over dirt.

Browser QA (Tamarack Ridge): standing before Green 1 shows "Green 1 — Declining —
[E] inspect" (matches sectionStatus exactly); E opens the panel titled GREEN 1,
Declining chip, stimp, cells/area, hole membership, Details and Aerate — the real
panel on the real section. A fairway section prompts by its own name; open scrub
prompts nothing. Zero console errors or warnings.

## 2026-07-09 — WALKABLE COURSE Task 4: the hand hose

F pulls out the hose, the prompt becomes a live nozzle readout ("💦 Fairway 2 · a —
moisture 62 — hold the mouse button to water"), and holding the mouse button soaks
the patch you're aiming at: spray-droplet arc, the ground visibly darkening as it
drinks, and the number climbing in real time.

**Judgment calls, with reasoning:**

- **One source of truth, enforced by architecture**: the tool writes through a main.js
  hook straight into `state.turf.moisture` — the SAME Float32Array the crew's
  scheduled irrigation and the weather system read and write. turf.js untouched
  (do-not-touch list); no parallel watering system, exactly per the brief.
- **Rate 30 moisture/s at the nozzle cell, 35% splash on the four orthogonal
  neighbors, clamp 100.** Bone-dry (20) to saturated in under 3 seconds — instant
  tangible control, which is the tool's whole point — while a single hose pass
  soaking one 8-yd cell plus splash keeps the CREW the answer for acreage.
  Only turf zones drink; scrub, sand, and paths shed it.
- **Hand-watering costs nothing.** The crew's irrigation is the scaled, costed
  system; a per-gallon microcharge on the player's own hands would be bookkeeping
  noise. If playtesting finds an exploit (hose-only agronomy), the knob lives in
  the waterAt hook.
- **Visible feedback is threefold and all honest**: spray points arcing from the
  nozzle (kept a full yard from the camera so attenuated points read as droplets —
  the first cut rendered as screen-filling blocks, caught on the first screenshot),
  a new wet-darkening term in the turf shader (`smoothstep(0.58,1.0,moisture)*0.2` —
  invisible at normal levels, unmistakable when saturated, and equally honest for
  rain-soaked ground), and a throttled updateTurf (5 Hz while spraying) so the
  data views track live.
- **Watering works while paused** — the hose is the player's hands, not the clock.
- Mounting the cart stows the hose; E with the hose out still opens the Task 3
  inspect panel (checking your work shouldn't need a holster dance).

Browser QA (staged a 7×7 bone-dry patch on a soaked winter fairway): nozzle cell
20 → 100 with clamp, splash neighbors +26 (exactly 30 × 0.35 × 2.5s), cells beyond
untouched; the live prompt tracked 20 → 68 → 100 while holding; the top-down
moisture view shows the watered plus-shape blue inside the pale dry square
(w4c-moisture-view.png — the money shot); E-inspect over the patch opens the real
panel (Details → Moisture 85 section average). Zero console errors or warnings.

## 2026-07-09 — WALKABLE COURSE Task 5: the default course experience

Stepping out the pro-shop door now lands you ON the course, on foot, at the door —
verified through the actual door interactable, not just the P shortcut. The full loop
runs clean end to end: shop door → walk → take the cart, drive, park it → walk up to
turf, read the prompt, E-inspect → pull the hose, water a patch → P back onto the
shop floor.

**Judgment calls, with reasoning:**

- **The overview rig survives as a management camera, one Tab away.** Course Works
  genuinely needs it until the walkable terrain-editing redesign lands (an explicitly
  deferred design problem, per the brief — now recorded in KNOWN_ISSUES). Triggering
  Works from on foot (HUD button or any path) shows the honest notice: "Course Works
  is being redesigned for the walkable course. For now, press Tab for the overview
  camera and edit from there." — and refuses to half-open. Nothing silently breaks;
  nothing pretends.
- **Esc hierarchy**: on foot, Esc follows the shop convention (release pointer, then
  office menu). In the overview, Esc returns you to your feet. P is always the shop.
- **Golfer NPCs share the walkable space by construction** — same scene, same
  heightAt terrain, no changes needed. QA counted 9 wandering capsule golfers around
  the player at noon; the sim also honestly despawned every one of them at a wrecked
  course in winter (lastRounds → 0 target), which is why the QA staged a busier day
  to photograph them. No player-golfer collision at v1 — they're ghosts you share
  ground with, logged in KNOWN_ISSUES.
- The overview hint bar now says what it is ("Overview camera — … Tab/Esc: back on
  foot") so the demoted mode can't be mistaken for the game.

Browser QA end-to-end (one continuous session, Tamarack Ridge): Continue → shop →
E at the door → walking at the clubhouse; walked 4.1 yd, cart prompt → mounted →
drove → parked; fairway prompt → E panel (Fairway 2 · a) → Esc; F hose → watered
(the saturated winter fairway held at 100, the differential was proven in Task 4) →
F away; Works button → placeholder toast, works mode stayed off; golfers staged and
photographed sharing the course; P → back on the shop floor, walk mode cleanly torn
down. ZERO console errors or warnings across the entire walkable-course QA session.

## 2026-07-09 — WALKABLE COURSE portion: SESSION SUMMARY

**Built this portion**: the course's primary experience changed from an RTS orbit
camera to first-person. One controller (the pro shop's, adapted outdoors and living
in courseScene.js) provides walking with real collision against what already exists
— 1,100+ tree instances from the renderer's own placement data, the clubhouse body,
pond water at the cell edge; a golf cart with honest handling that parks where you
leave it and is solid when parked; walk-up turf inspection reusing the exact
inspect panel and status vocabulary through app-supplied hooks; and a hand hose
writing straight into the crew's own turf moisture array with spray, live readout,
and wet-darkening feedback. The shop door boots it; golfers share it; the overview
rig survives one Tab away because Course Works still needs it.

**The judgment calls that matter** (each argued in its entry above): human tuning
(eye 1.75 yd, walk 3.4, run ×1.8, cart 10 — the cart is the fast option, not a
faster walk); no new collision data per the brief; one camera retuned per mode so
the post stack never forked; Tab as the mode switch with an honest, labeled
demotion of the old rig; a redesign notice — never a half-open editor — when Works
is triggered on foot; watering free, instant, paused-or-not, single-cell-plus-splash
so the crew stays the answer for acreage; and every interaction on the shop's
established E/prompt conventions rather than a second grammar.

**QA discipline note**: every task's done-when was verified by driving the real
build (Playwright), and it caught real bugs again — the cart's park-guard
self-collision (pushed itself 45 yd downfield) and screen-filling spray points —
plus the honest sim moments (winter despawning golfers at a wrecked course) that
pure code-reading would never surface. Zero console errors across the whole
walkable QA session.

**Explicitly left for future portions** (recorded in KNOWN_ISSUES): the walkable
terrain-editing redesign (THE open design problem this portion deliberately did not
attempt), more hands-on tools (mowing/weeding/litter — the hose is their template),
cart-position persistence, player–golfer collision, hose cost/rate balance, GTAO
retune for first-person range — plus everything already parked from the market
portions (empire-wide prestige, manager delegation, buy-backs, rival actors,
sale-side pricing cycle).

## 2026-07-09 — VISUAL STYLE GUIDE (from the 8 reference images in Designs/) — PERMANENT REFERENCE

**Session context, logged honestly**: this session's brief references a prior
"art-direction correction" session (reduced bloom/AO), a "shop-polish session" with
Mixamo-rigged characters, and a tractor. None of those exist in this repo — HEAD
before this session is the walkable-course wrap-up; characters are capsule
primitives; the vehicle is the golf cart; bloom/AO are at their original FAIRWAY
STATE values. Judgment call: treat those references as DIRECTION TO ESTABLISH NOW,
mapped onto what actually exists (cart ≙ tractor-equivalent; primitive characters
restyled in place; this session performs the bloom/AO/lighting correction itself).

The 8 references (ChatGPT-generated, "Dusty Pines Golf Club" / "Golf Course
Flipper") depict: (1) tractor+mower on a striped fairway before the clubhouse,
(2) the same course DEAD — cracked lot, overgrown olive grass, weathered clubhouse,
(3) tractor repair inside the shed, (4) third-person mowing, unmowed vs striped,
(5) kneeling divot-cluster repair with a green utility cart, (6) top-down course
redesign UI, (7) soft-opening with carts and arriving golfers, (8) thriving endgame
with the KEEP-OR-SELL decision. They are rendered MORE photoreal than our build can
or should reach — per the brief the target is "Farming Simulator-style: clean,
bright, stylized, readable, explicitly NOT photorealistic," so this guide extracts
their COLOR, LIGHT, PROPORTION, and READABILITY language, to be applied at our
simplified geometric fidelity. Where the images' photorealism exceeds that mandate,
the guide says so.

### 1. Palette (approximate sRGB samples to hit)

**Turf** (the signature — high saturation, yellow-leaning healthy green):
- Fairway base ~#55a83a; mow stripes alternate ±8-10% luminance (~#5cb43e light
  band / #4c9a34 dark band) — stripes are HIGH-contrast and always visible.
- Rough ~#4a8f30 (darker, slightly yellower, longer texture).
- Putting green ~#6cc24a (brightest, cleanest surface on the course).
- Neglected/unmowed turf: OLIVE-TAN, not brown-black — #8f9455 → #a8a060 dry
  grass; decay reads as desaturation toward tan, never as darkness.
- Bunker sand: bright clean #d8c99a.
**Sky**: zenith #2f6fd0 → horizon #a8d8f5; pure-white cumulus; NO haze gray. Far
tree lines stay saturated (only a whisper of blue lift at extreme distance).
**Vegetation**: deciduous canopy #2f6b2f–#4a8f3a, pine #2a5d33, trunks #6b4f35.
**Architecture**: siding cream #e9e2cc; trim/fascia white #f5f2e6; roof SAGE GREEN
#57795c (the clubhouse identity — cream walls + green roof + white trim); stone
walls/sign piers #b8a98c; asphalt paths #8a8578 warm light gray.
**Equipment**: tractor/mower RED #c23327 + black #1e1e20 + white hubs #e8e6e0;
utility/grounds cart GREEN #3d5c40 with black bed and tan seat #c9b98a; golfer
carts cream #e5ddc4; safety accents orange #e07820.
**Characters**: staff = green polo #2f5c38 + khaki #c2b190 + green cap; golfers =
polo in blue #3b6fb3 / navy #2c3e66 / pink #d98bb0 / orange #d97538 / white +
khaki/tan shorts; skin warm #d9a97e; shoes brown/white.
**UI kit**: panel charcoal #16191b at ~92% opacity, 8-10px rounded corners; title
header bar green #1f8a34 (gradient to #17692a) with bold white text; body text
white/#d8ddd6; positive/money green #45d052; progress bars green fill on #2a2f2c
track; warn/negative red #d84b3a; decision buttons = solid green KEEP / solid red
SELL; keycap chips (dark, 1px light border, white letter); simple white icons in
circles; star ratings render GREEN, not gold. Toast pills top-center, dark with
"+1% ↑" deltas in green.

### 2. Geometric detail / stylization

Simplified-but-clean mid-poly: real-world proportions, chunky rounded silhouettes,
zero microdetail or greebling. Our existing low-poly kit (Kenney trees, primitive
buildings/vehicles) is BELOW the references' density — correct response is NOT to
add detail but to make the simple shapes read intentional through color and
material: flat saturated albedo, roughness 0.8-0.95, metalness 0 (tiny exceptions:
equipment trim), strong silhouettes. Mow stripes carry more style weight than any
geometry. No new modeling unless a silhouette is actively wrong.

### 3. Lighting & post-processing

- ONE bright, slightly warm sun (#fff6e8) high in the sky (late-morning angle),
  soft-edged shadows; shadowed grass keeps ~60-70% of lit luminance AND full
  saturation — shadows are never gray or black. Strong sky/ambient fill.
- Exposure bright and clean: whites (clouds, trim, wheel hubs) genuinely white,
  not gray. Neutral tone mapping — no filmic teal/orange grade, no crushed blacks.
- Bloom: effectively OFF for the scene (only extreme sources like the sun disc may
  glint). No halo on bright turf or trim, ever.
- AO: tight contact-darkening under vehicles/props only; no soft corner-grime
  spread across the ground.
- Fog: near-none on a clear day (distance stays colorful); weather may thicken it.
- Color grading: none beyond exposure — saturation lives in the albedo, not a LUT.

### 4. Texture detail

References use photoreal grass/bark/asphalt; per the NOT-photorealistic mandate we
go cleaner: texture supplies subtle brightness variation only, while HUE comes
from flat zone tints (texture luminance × saturated tint color). Fields should
read as smooth clean color at gameplay distance, with mow bands, damage patches,
and disease blotches as deliberate, readable marks — not photographic noise.
Weathering (the dead-course state) = tan/olive tint shifts and sparse debris, not
grunge maps.

### 5. Characters & props

Normal human proportions (references are realistic; explicitly NOT chibi/bobble).
At our fidelity: primitive figures gain a two-tone body — polo-colored torso,
khaki legs, skin head, cap for staff — so the silhouette language ("person in a
polo on a golf course") reads at distance. One saturated accent color per figure.
Props follow equipment palette above; vehicles are boxy-friendly with visible
wheels, roof posts, and a single body color + black running gear.

### 6. UI structure language (from images 1,2,4,6,8)

Top-left: club-name header bar (green) over a task/status panel with circular
checkboxes and a green progress bar. Top-right: status cluster — weather icon |
time | money-in-green. Bottom-right: CONTROLS keycap panel (and/or minimap in a
rounded frame). Top-center: transient +delta toast pills. Decision modals: dark
panel, stat columns with green numbers, big solid green/red buttons with subtitle
lines. Segmented 3-option pickers with the selected cell filled green.

### Known deltas we accept (and why)

- Reference clubhouse has a clock tower and porch florals; ours is a simple gabled
  volume — material match now, silhouette additions belong to a future art pass.
- Reference characters/grass are photoreal; mandate says stylized — we match
  palette and proportion, not fidelity.
- Reference tractor+mower rig doesn't exist in the build; the golf cart adopts the
  utility-vehicle language (green body/black bed) until a tractor is modeled for
  the earned-tractor MVP sequence.

## 2026-07-09 — STYLE Task 2: terrain, lighting, post — applied against the guide

Changes in courseScene.js, each tied to a guide section:
- **Tone mapping**: ACESFilmic 0.92 → Neutral 1.12 (§3: bright, no filmic grade —
  saturation lives in the albedo now).
- **Bloom**: 0.5/40 → 0.12/60 (effectively scene-off; sun-disc glints only).
  **GTAO**: blend 1.0→0.4, radius 3.0→1.5 yd (contact darkening only).
- **Sky**: turbidity 6→2, rayleigh 1.6→4, mie 0.004→0.002 — the milk is gone.
  Physical-Sky limitation logged: at this bright exposure the zenith still reads
  paler than the reference's #2f6fd0; accepted rather than faking with a LUT (§3
  bans grading). NEW: 14 stylized billboard cumulus sprites (canvas radial puffs,
  toneMapped:false so they stay paper-white; hidden at night/heavy rain) — the
  references always show puffy clouds and the physical Sky has none.
- **Light rig**: sun 3.1→2.6 slightly warm; hemisphere fill 0.85→1.25-1.35 with
  sky/ground colors #cfe6fa/#5d7a44 — shadows now hold ~2/3 luminance and full
  color (§3). Fog density day 0.00028→0.0001, color → #bfdcf2 (distance stays
  saturated).
- **Turf shader — the big one (§4)**: photo textures now contribute LUMINANCE
  ONLY (FW_STYLIZE: 0.25 + luma×2.6), hue comes from flat saturated zone tints
  (fairway/rough/green/tee/sand/scrub/path). Two visual iterations were needed:
  v1 read neon-flat (texture swing too narrow, scrub muddy-tan); v2 widened the
  luma curve, deepened/warmed the greens, and re-greened the out-of-play scrub.
  Stripe amplitude fairway 0.1→0.2, tee 0.08→0.14 (stripes are the signature).
  Dry/wear tints moved to olive-tan (§1 decay reads as desaturation, not dirt).
  normalScale 0.85→0.45 (texture whispers). Water 0x0a2b30→0x2a6d8f.
- **Trees**: foliage remap brightened/saturated (deciduous L .26→.33 S .46→.55,
  pine L .20→.26 S .42→.50) so canopies hold color at distance.

Accepted deltas (logged per brief): zenith saturation short of reference; turf a
half-step more electric than the reference's warm #55a83a; the references' dense
photoreal blade detail is explicitly NOT targeted (stylized mandate).

Verification: 3-panel comparison qa/style-sbs-task2-fairway.png (BEFORE pre-session
/ AFTER / REFERENCE 4, same in-game staging both shots: healthy turf, 10:00, clear,
identical pose) — the after frame moves decisively toward the reference's color,
lighting mood, and cleanliness. Zero console errors; suite 176/176 (rendering only).

## 2026-07-09 — STYLE Task 3: props, equipment, structures

- **Clubhouse** (the visual anchor, §1 architecture): photo-albedo siding and roof
  replaced with flat guide colors — cream #e9e2cc walls, sage #57795c roof, white
  #f5f2e6 trim/porch — keeping only the normal maps for relief; door goes
  club-green. BEFORE it read as a dark timber barn; AFTER it reads as the
  references' cream-and-green clubhouse at a glance. Reference's clock tower and
  flower beds remain out of scope (silhouette additions = future art pass, noted
  in the guide's accepted deltas).
- **Utility cart** (§1/§5 equipment): cream runabout → grounds-crew language:
  green #3d5c40 body, tan #c9b98a bench, cream #e5ddc4 canopy, black running
  gear — the references' "Turf Boss" identity, at our primitive fidelity.
- **Pro-shop fixtures**: wood lightened/warmed (0x6e563c→0x8a6b48), ambient
  0.55→0.75 warmer white — bright friendly interior rather than dim clubroom.
- QA plumbing: walk API gained placeCart(x,z,yaw) — the cart mesh previously only
  re-placed on park/drive, so staged screenshots moved the state but not the
  mesh; the first cart "comparison" had no cart in it. Real-browser verification
  catches what code-reading assumes, again.

Verification: qa/style-sbs-task3-clubhouse.png (before / after / reference 7) and
qa/style-sbs-task3-cart.png (after / reference 5). Zero console errors.

## 2026-07-09 — STYLE Task 4: characters

Golfers and shop customers move from single-color capsules to the guide's §5
two-tone figure: khaki legs (cylinder) under a saturated polo torso (capsule),
skin head, cap — reading as "person in a polo on a golf course" at any distance.
Wardrobe pulled straight from the references: polos in blue/navy/pink/orange/
white/green over three khaki tones; caps in white/navy/green/cream; warmer skin
tone (#d9a97e). Shop customers get the same treatment and palette.

**Logged honestly per the brief**: the brief says to "reuse the existing Mixamo
animation rigging approach from the shop-polish session" — no such session,
pipeline, or rigged model exists anywhere in this repo (vendor/models holds only
the Kenney trees; characters have always been primitives here). Restyled the
primitives in place to the guide's proportions and palette instead; a rigged
character pass remains future work and is recorded in KNOWN_ISSUES.

QA note: photographing a live walker through tool latency kept missing (they
cover 3-6 yd/s), so the scene gained setGolfersFrozen(v) — an honest 3-line
photography/QA hook alongside placeCart. Verification:
qa/style-sbs-task4-golfer.png (frozen pink-polo golfer vs reference 8's
foreground pair). Zero console errors.

## 2026-07-09 — STYLE Task 5: the UI kit

styles.css moved from the dark clubhouse-green theme to the guide's §6 kit —
CSS-variable and rule changes only, zero markup/layout edits:
- Neutral charcoal panels (#16191b / #232829, lines #363d40) replacing the
  green-tinted set; body text lifted to near-white.
- Panel titles and modal headers wear the green header bar
  (linear-gradient #1f8a34→#17692a, white uppercase text) via
  `.panel > h3:first-of-type` — so mid-panel section headings (Properties,
  Ledger of deeds) stay plain, exactly like the references' panels.
- Money is GREEN now (--accent-2 #45d052): HUD cash, listing prices, plan-bar
  costs all inherit it — matching every reference's status cluster.
- Decision buttons are solid fills: primary = header green, danger = red — the
  sell confirm reads as reference 8's KEEP (green) / SELL (red) pair verbatim.

Verified live: empire panel (green GOLF EMPIRE bar, mood chip, green Browse
button), sell modal (green header, red Sell $25,500 / green Keep it), Keep-it
interaction still closes and preserves holdings, market modal opens with Buy
correctly gated, HUD money green. qa/style-sbs-task5-ui.png vs reference 8.
Zero console errors; suite 176/176.

## 2026-07-09 — VISUAL STYLE PASS: SESSION SUMMARY

The style guide extracted from Designs/ (see the PERMANENT REFERENCE entry above)
was applied end to end: Task 2 terrain/lighting/post (neutral-bright tone mapping,
bloom/AO to contact-only, vivid sky + sprite cumulus, luma-only textures under flat
saturated tints, doubled stripe presence), Task 3 props/structures (cream/sage/white
clubhouse, green utility cart, brighter shop), Task 4 characters (two-tone
polo/khaki figures, reference wardrobe, both scenes), Task 5 UI (charcoal panels,
green header bars, money-green, solid KEEP/SELL-style decision buttons). Every task
verified with a real side-by-side against its reference (qa/style-sbs-*.png), every
commit per-task, suite 176/176 throughout, zero console errors in every check.

Notable judgment calls beyond the per-task entries: the references are more
photoreal than the "explicitly NOT photorealistic" mandate — the guide resolves the
conflict by matching color/light/proportion language at our stylized fidelity, and
that resolution is written INTO the guide; the brief's references to a prior
art-correction session, a Mixamo shop-polish session, and a tractor were treated as
direction to establish now (none exist in this repo's history — logged in the guide
header). QA hooks added for photography: placeCart(x,z,yaw) and setGolfersFrozen(v).

Deltas that remain (KNOWN_ISSUES + ASSET_SOURCES carry the full list): pale zenith
(physical-Sky limit), slightly electric turf pending playtest tuning, missing
reference silhouettes (clock tower, tractor, sign, flags), primitive characters,
and reference UI surfaces that have no screens yet (minimap, step callouts,
segmented pickers).

## 2026-07-09 — ASSET SESSION Task 1: recon (probe first, don't assume)

Also logged: a UI-layout/IA session brief arrived alongside this one but its
SUPERSEDING NOTE makes THIS the geometry/asset session — the UI brief is parked in
KNOWN_ISSUES as the queued next session, not silently dropped.

Probe results:
- **Mixamo: NOT usable here.** mixamo.com loads as a login-gated Adobe SPA
  ("Loading Mixamo…"); downloads require an Adobe account and interactive browser
  auth — no credentials exist in this environment and WebFetch can't drive the
  SPA. Same honest-failure record as the earlier Tripo attempt.
- **Blender: USABLE, headless.** Blender 5.1 installed (Program Files); the MCP
  addon bridge is not running (no live instance), but
  `blender --background --python` works — verified "BPY OK 5.1.2". This is the
  pipeline.
- **CC0 model sources: no confirmed-license direct download for what we need.**
  Kenney has no tractor or rigged humanoids (trees already vendored); Poly Haven
  models catalog has no tractor; Quaternius lists Animated Character/farm packs
  but a prior session already found its downloads Patreon-gated and this probe
  confirmed no direct links or license text on the public pages; Sketchfab CC0
  search needs API auth we don't have.

**Decision**: build ORIGINAL assets via headless bpy scripts — a rigged low-poly
character (armature + rigid bone-parented parts, baked Walk/Idle/Swing/Browse
actions, materials named for per-instance retinting) and a detailed tractor+mower
— exported as GLBs into vendor/models/. Original work = CC0-clean by ownership,
and style-guide-exact because the guide's palette is set programmatically.

## 2026-07-09 — ASSET SESSION Task 2: articulated characters (and an honest pivot)

**The rigged-GLB path failed twice, and the failure is logged like Tripo was**: a
bpy-built armature with bone-parented rigid parts exported with every limb scattered
(glTF joints pivot at bone heads; Blender bone-parents at tails), and the rigid-skin
rewrite (single mesh, per-bone vertex groups, armature modifier) STILL shipped
displaced parts — the live NLA-strip stack polluting the export was fixed (muted
tracks), but the inverse-bind chain from Blender 5.1's exporter to three.js r185
remained visibly wrong, and screenshot-debugging an exporter black box was burning
the session. Both broken GLBs are deleted, not shipped.

**Pivot (per the brief's fallback discipline): procedural articulated characters
built directly in three.js** — src/render3d/characterAsset.js is now a factory:
jointed figures with hip/knee/shoulder/elbow pivots under a chest pivot (lean +
twist) and a head pivot, wearing the §5 wardrobe (polo/khaki/cap tints per
instance). Four procedural modes replace the baked clips: Walk (1.4 Hz gait,
counter-swinging arms, knee flex, torso bob), Idle (sway + breath), Swing (a
readable address→backswing→through golf swing on pauses mid-corridor), Browse
(right-arm shelf reach + head tilt, used at shop fixtures). Golfers and shop
customers share the factory; behavior drives mode (walkers swing at stops, idle by
the green; customers browse at fixtures, walk between).

This meets the done-when's substance — visibly articulated, properly animated,
varied characters on both floors — without the export black box. The Mixamo-grade
skinned upgrade remains future work (recorded in KNOWN_ISSUES with the exporter
findings for whoever picks it up).

Verified live: a golfer frozen mid-stride (scissored legs, bent knee, opposed
arms — qa/assets-after-golfer.png) and a browsing shop customer
(qa/assets-after-shop-customers.png). Zero console errors.

## 2026-07-09 — ASSET SESSION Tasks 3+4: the real tractor, sign, and flags

Mid-session the project owner dropped 20 GLBs into Assets/ (red tractor, course
signs, flagpole, shed, and the earned-tractor-sequence props — hose nozzle, gas can,
rubber belt, tool chest, workbench). Task 3/4 use them: `tractor_red.glb` (scale
×3.6, settled -0.1 into turf, flipped π — generated GLBs author front-toward-viewer)
replaces the boxy build as the drivable vehicle, with my bpy-scripted tractor as
offline fallback and primitives beneath that; `course_sign.glb` + two
`flagpole.glb` pennants dress the clubhouse approach. Labels now say Tractor;
seat eye 1.55→1.9; collision radius 0.9→1.15 for the real footprint.

Honest notes: the drive-direction flip is visually confirmed parked/close-up but
the mid-drive facing check was inconclusive under QA latency — if the tractor ever
drives grille-backward, the fix is the one `flip` boolean (KNOWN_ISSUES). The sign
model reads small at ×2.2; sizing it against the reference's stone entrance sign is
a one-line tune for the next pass. Mount/drive/park verified live (the tractor
drove under power and parked where left); before/after: qa/style-after-cart.png
(old boxes) vs qa/assets-after-tractor.png; decor: qa/assets-after-entrance.png.

## 2026-07-09 — ASSET SESSION: wrap-up

Suite 176/176 (rendering only). Parked, per the superseding note: the UI-layout/IA
session brief (minimal HUD + consolidated Manage entry, comps research first) is
queued as the NEXT session — recorded in KNOWN_ISSUES, not dropped. Deferred UI kit
pieces (minimap, step callouts, segmented pickers) stay deferred per the brief.

## 2026-07-10 — SHOP RESTORATION Task 1: the shop starts rundown (condition state)

Two briefs landed together (shop-restoration arc + the 19-asset Tripo integration,
plus a third-person-while-driving request); the user's "start by making the
clubhouse interior more [rundown]" orders the shop arc first. Reference viewed in
full: Designs/ClubHouseInterior — the FINISHED end-state (warm cream over green
wainscoting, wood trusses, green counter with a computer, PRO SHOP alcove, lounge).

Task 1 state design, TDD (tests/shop-reno.test.js, 8 tests → suite 184):

- `state.shop.reno = { grime[35], clutter[5], decor[] }`, owned by sim/shop.js
  (in scope this session). A 7×5 grid of 2×2-yd dirt cells (0..1) over the room;
  condition 0-100 is DERIVED, never stored: cleanliness×70 + decor finish (cap 30).
  Fresh game ≈ 16 — "filthy". Judgment call: deriving condition kills drift bugs
  and makes the vacuum/decor math trivially testable.
- Grime draws from a LOCAL rng (`seed ^ 0x51c7`), NOT state.rngState — adding the
  reno block cannot shift golfer/staff/weather draws in existing tests or saves
  (same isolation trick as the empire market stream). Verified by test.
- Migration: `ensureShopReno` in deserialize — old saves gain a dirty shop.
  Judgment call: thematically every acquired property is a fixer-upper, so making
  existing shops start dirty is consistent, and it beats special-casing "old saves
  get a free clean shop."
- clutter: 5 cardboard piles at fixed candidate spots (seeded jitter). Hauling one
  out (E, the standard interact verb) wipes 0.5 dirt under it — the pile is both
  set dressing and a small first restoration beat. One-shot per pile, save-persisted.

Scene side (shopScene.js): a lit transparent canvas overlay paints the dust FROM
the grime cells (pale haze + dark specks — first cut used dark stains on the
already-dark floor and vanished; pale-on-wood reads in both light states);
condition drives ambient/window light, one burnt-out bulb (<45), a flickering
second tube (<40), dingy wall/floor/ceiling tints, and filthy window glass.
Everything rebuilds per enter() from state (rebuildReno), so loads/new games are
honest. Overlay chip shows live "Shop condition N — word". Verified live: E on a
pile → 5→4 piles, condition 16→18, zero console errors/warnings.
qa/shopreno-sbs-task1.png is the before/after pair at the door angle.

## 2026-07-10 — SHOP RESTORATION Task 2: the vacuum

The vacuum copies the hose contract exactly: F equips/stows (shop3d branch), hold
LMB to use, window-level pointerup releases — no new input paradigm. It is also a
REAL catalog item ('vac1', new non-retail cat 'supplies', $140, 2-day lead) bought
through the existing placeOrder/deliverOrdersDue supplier flow; the fixer-upper
does not come with one. `vacuumOwned` gates the F key with an honest hint.

Guard rails (tested): RETAIL_CATS keeps supplies/decor out of shopper demand,
out of staff shelving, and out of hand-shelving — your vacuum is not for sale.
Live QA caught two real bugs: (1) saves written before vac1 existed had no
inventory slot → desk panel crashed; ensureShopReno now backfills missing catalog
SKUs on load (tested). (2) the desk panel grew "NaN% of book" markup sliders for
the new categories — markup/feature-table rows now render only for cats with real
markup entries.

Feedback loop: cleaning writes cleanGrimeAt(0.5 dirt/s, full strength ~0.9yd +
soft ring), the dust canvas repaints and lights re-lerp at ~6 Hz while held, and
motes stream from the floor into the wand nozzle (style-guide red head). Verified
live end-to-end: ordered via desk panel ($140 out of the wallet), fast-forwarded 2
real sim days for the truck, F equip, held clean → condition 16→20, the aimed
patch visibly wiped while far patches stayed. qa/shopreno-sbs-task2-vacuum.png.
Suite 187/187. Zero console errors. Vacuum whir audio: skipped for now (audio.js
untouched this session) — noted as polish.

## 2026-07-10 — SHOP RESTORATION Task 3: decor & fixture placement

Six decor SKUs modeled on the ClubHouseInterior reference (pine rug, potted
plants, course posters, cork events board, green pendant lights, the green lounge
set), all cat 'decor' in the same catalog, ordered through the same supplier flow
(3-day lead). Placement reuses the interactives/E pattern wholesale: owning an
unplaced piece spawns translucent green GHOSTS of it on its valid free spots;
walk up, look at one, E — placeDecor() moves it back→placed, the real mesh (and
colliders for the sofa/plants, and a real warm PointLight for pendants) replaces
the ghost. Judgment calls:

- Valid spots are DATA (DECOR_SPOTS in data/shopItems.js): the sim validates and
  persists {skuId, spot} indexes without knowing coordinates; the scene maps
  spot→transform. No free placement UI paradigm, exactly per the brief.
- finish per placed instance, capped at 30 of the 100 — tested that a fully
  furnished but filthy shop stays under 60: decor cannot mask dirt.
- A 1.1s signature poll surfaces new ghosts the moment a delivery lands while
  you're standing in the shop (deliveries land on the midnight tick).
- No un-place/move yet — logged in KNOWN_ISSUES as small follow-on work.

Live QA: ordered rug+plant+pendant+lounge ($735), FF 3 sim days, placed all four
by E → condition 16→24→28→35→44, pendant adds real light, zero console errors.
qa/shopreno-sbs-task3-decor.png. Suite 191/191 (4 new tests).
