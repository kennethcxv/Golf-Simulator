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

