# GOLF EMPIRE — KNOWN ISSUES / PRE-SHIP GAPS

Honest list of what is placeholder, missing, or deliberately deferred. Anything listed
under "Needs a real art/audio pass" must be replaced before this could ship commercially.
GOLF EMPIRE is built on the FAIRWAY STATE core; everything below from that era still
applies per-property, plus the new empire-layer section at the top.

## GOLF EMPIRE layer — current status & deliberate v1 limits

Shipped portion 1 (2026-07-09): the property marketplace (8 hand-authored distinct
listings, real buildable courses), the shared appraisal/valuation, buy/sell
transactions, the multi-property portfolio with one live club + passive caretaker ticks
for parked ones, and the market/empire screens. 41 new headless tests (suite 162/162);
full browser playthrough QA'd with zero console errors.

Shipped portion 2 — the LIVING MARKET (2026-07-09, same day): new listings generated
over time from 7 parametrized distress-profile templates (one generation path — the
real serpentine builder + shared appraisal; cadence ~1 listing/8 days, cap 10, dry-
market floor 3), rival investors buying out listings that sit past a 10-day grace
window (~28-day mean tenure, named 🏴 feed notices, never silent), a bounded
buyer's/seller's pricing cycle (0.85–1.15, seasonal drift) applied to NEW asks only,
and the market UI for all of it (mood chip, relative age lines, live-refreshing
modal). 14 more headless tests (suite 176/176); browser-QA'd across ~62 in-game days
with zero console errors, including buying and playing a generated listing.

Living-market deliberate limits (reasoning in DEV_LOG.md):
- **The pricing cycle is buy-side only.** Owned-property valuations and sale payouts
  deliberately ignore the market mood (per the portion-2 brief's test spec). "Sell
  into a seller's market" is therefore NOT a mechanic yet; applying the cycle to
  payouts needs anti-exploit design (park-and-wait-for-peak is free money) and is
  future work.
- **The market only moves while world time moves** — own nothing, and the market
  freezes with the rest of the world. Consistent with world-clock semantics; a
  menu-sitting player is never sniped.
- **Rival buyers are flavor, not actors**: no shadow portfolios, no auctions, no
  competing bids — a listing just leaves with a named notice. Visible rival empires
  are future work.
- **A sold property's name can recur** on a later generated listing (the taken-name
  check covers live listings and holdings, not the full graveyard). Accepted.

Deliberate v1 simplifications (documented in DEV_LOG.md):
- **Parked properties are an approximation, not a shadow sim** — condition decays
  toward a caretaker floor (38) and a bounded daily net hits the wallet; membership,
  satisfaction, staff, shop, and prestige are FROZEN while parked. Outings scheduled
  and then abandoned are forfeited on return; a tournament left on the calendar
  resolves on your first night back against current condition.
- **Valuation semantics gap for young clubs**: an active club is priced on its BANKED
  trailing books (an anti-exploit choice — QA caught 6-day honeymoons annualizing into
  2.3× flips), while a parked club is priced on its caretaker run-rate ×24. Parking a
  healthy week-old club therefore reads ~15% higher until its books fill; attended
  steady-state always beats the caretaker rate. Post-playtest balance knob.
- **Flip margins are generous at current tuning** (a restored wreck roughly doubled in
  22 relaxed-mode days, mostly via the base game's own membership-growth dynamics).
  Balance pass required — same judgment-call tier as the rest of balance.js.
- **Realistic-mode debt (`debtDays`) counts against whichever club is active** — the
  wallet is empire-wide, so the number is the same, but the 5-day bankruptcy clock
  resets on switching. Worth revisiting alongside empire-wide prestige.
- **18-hole properties score rounds against the 9-hole par baseline** in golfer memories
  (rounds.js hardcodes par 34 and is on the do-not-touch list) — cosmetic in thought/
  memory copy only; economy and ratings are unaffected.
- **Executive-course yardage isn't priced directly** — the appraisal sees size only as
  9 vs 18 holes (plus design/condition); a short par-30 nine values like a full nine
  with the same ratings.
- **Closing the market before your first purchase** leaves you at the menu with an
  autosaved empty empire — Continue restores it; clicking New Empire re-rolls it.

Future work for the NEXT portion (ideas beyond the briefs so far, parked on purpose):
- Deeper empire-wide prestige (portfolio-level reputation/prestige, cross-club effects).
- ~~A growing/refreshing market: new listings over time, seasonal pricing~~ — SHIPPED
  (portion 2). Still open from that idea: buy-back/re-listing of previously-sold
  courses, competing buyers as visible actors (auctions, rival empires you can lose
  deals to on screen), and the pricing cycle applied to sale payouts (needs
  anti-exploit design, see living-market limits above).
- Manager delegation for unvisited courses (hire a GM to run a parked club properly —
  the natural upgrade path from the caretaker approximation, incl. member drift).
- More properties/archetypes (links, desert, mountain climates pair with the deferred
  multi-theme roadmap), and richer hidden-upside mechanics (survey reports, inspections).
- Empire-level financing: loans against portfolio value, staged payments on the whale.

## THE WALKABLE COURSE (2026-07-09) — current status & open items

Shipped: the course is now experienced first-person by default — WASD/pointer-lock
walking with real collision (tree instances, the clubhouse body, pond edges), a golf
cart (E to drive/park, ~3× walking pace, solid when parked), walk-up turf inspection
(one-status-word prompt + E opens the existing inspect panel), and a hand hose
(F equips, hold-to-water writes into the same turf moisture the crew uses, with spray
particles, a live readout, and wet-darkening turf). Golfer NPCs share the space. The
old orbit rig survives as a labeled "overview camera" one Tab away.

- **Terrain editing (Course Works) is NOT walkable yet — open redesign item.** The
  brief explicitly deferred it as a separate design problem. Today: triggering Works
  from on foot shows an honest "being redesigned for the walkable course" notice and
  refuses to open; the full existing editor remains available from the overview
  camera (Tab). The walkable replacement (survey stakes? a foreman mode? plan-on-the-
  ground?) is the next portion's design work.
- **More hands-on tools (mowing, weeding, litter pickup) deliberately not built** —
  the brief scoped exactly one tool (watering). The hose's equip/aim/hold pattern is
  the template they'd reuse.
- **Cart position is render-layer state**: it re-parks by the clubhouse on scene
  rebuild (save/load, property switch). Persisting it means a save-format field for
  a cosmetic nicety — deferred.
- **No player–golfer collision**: you share the ground, not shoulders — NPCs are
  pass-through. Fine at walking speeds; revisit if gameplay ever cares.
- **Hand-watering is free and works while paused** (your hands, not the clock; the
  crew's irrigation remains the scaled, costed system). If playtesting shows
  hose-only agronomy exploits, rate/cost knobs live in the waterAt hook.
- **Pointer lock can be refused** (kiosk/automation contexts): click-to-look plus
  arrow-key look cover it — same fallback the pro shop has always had.
- **GTAO is tuned for management-camera distances** (3-yd radius): at first-person
  range contact shadows read slightly broad. Cosmetic; queued for the art pass.

## VISUAL STYLE (2026-07-09) — matched to the Designs/ references; current status

A written style guide (palette, lighting, stylization, texture policy, character
and UI language — extracted from the 8 reference images) now lives permanently in
DEV_LOG.md; all rendering follows it. Applied this session: neutral-bright tone
mapping with bloom/AO cut to contact-only, vivid sky + stylized sprite cumulus,
luma-only photo textures under flat saturated zone tints with strong mow stripes,
olive-tan decay tinting, cream/sage/white clubhouse, green utility cart, two-tone
polo-and-khaki characters, and the charcoal + green-header UI kit. Side-by-side
proofs in qa/style-sbs-*.png.

Honest deltas still open (also recorded in ASSET_SOURCES.md):
- **Zenith blue**: the physical Sky shader can't reach the references' deep zenith
  at this exposure; sky reads paler up top. A gradient sky dome would fix it —
  future art pass.
- **Turf hue** sits a half-step more electric than the references' warm #55a83a;
  next tuning nudge belongs to a playtest, not more screenshot-eyeballing.
- **Silhouettes**: clubhouse clock tower / porch florals / entrance sign / feather
  flags and a real tractor+mower don't exist as models; palette matches, silhouette
  additions are modeling work (pairs with the earned-tractor MVP sequence).
- **Characters** are restyled primitives; no rigged models or Mixamo pipeline
  exists in this repo (the session brief referenced one from a "shop-polish
  session" that never happened here). A real character pass is pre-ship work.
- Minimap, numbered-step callouts, segmented three-option pickers, and toast
  pills from the reference UI aren't built (no counterpart screens yet); the kit
  (colors/headers/buttons) is in place for when they are.

## FAIRWAY STATE core (per-property) — needs a real art pass before release

- ~~Procedural ground textures~~ — replaced with real CC0 PBR sets (Poly Haven,
  diffuse+normal; see ASSET_SOURCES.md). ~~Gumdrop/cone trees~~ — replaced with Kenney
  Nature Kit CC0 models (color-remapped to realistic tones). Still placeholder: the
  box clubhouse (v4 Task 5 in progress at this line's writing), golfer/customer capsule
  characters, and shop interior fixtures — real character models and a shop kit remain
  pre-ship requirements.
- ~~Sky horizon blows out white at low sun angles~~ — fixed by v4's bloom threshold
  (40); re-verified at 6:50 AM and 7:35 PM low sun, both facings (qa/v5-sky-*.png).
  ~~Water surfaces have no ripple normals~~ — v4 Water.js + waternormals. Still open:
  **no rain particles**, and **tee-number sprites render as solid black squares when
  viewed against the light** (lit sprite material; fine sun-side, black anti-sun-side —
  seen clearly in the v5 dawn/dusk sky shots). Both queued for the polish pass.
- **Pro shop interior is simple geometric primitives** — hollow box shelving, box
  stock stacks, capsule-and-sphere customers, flat procedural wood/plaster. Needs a real
  modular shop kit, item models per SKU, and characters before ship. Register queue
  interaction and counter purchase animations are also deferred.
- **UI is hand-rolled DOM/canvas styling** — functional, consistent, but needs a real UI
  art/iconography pass (currently text + simple shapes/emoji glyphs).
- **Key art / branding / trailer** — nothing exists; "FAIRWAY STATE" is a working title.

- **AI-generated tree models attempted (v5), not achievable in this environment** —
  the plan was Tripo (tripo3d.ai) tree variants imported alongside the Kenney set with a
  same-angle side-by-side and an honest keep/replace call. Probe results: the tripo-mcp
  server requires the Tripo Blender addon, which is not installed (the machine's addon.py
  is vanilla blender-mcp with no Tripo command handlers); its MCP config carries an empty
  env (no API key); and no TRIPO_API_KEY / ~/.tripo credentials exist anywhere on the
  system, ruling out direct REST calls too. Higgsfield was explicitly excluded (image/video
  generator — no usable meshes). **Kenney Nature Kit trees remain the shipping asset.**
  AI-generated or hand-authored realistic trees stay on the pre-ship art-pass list; with a
  Tripo key + addon (or an artist), the import path is ready — GLBs drop into
  vendor/models/trees/ and register in courseScene.js's tree table.

## Needs a real audio pass before release

- All sound is procedurally synthesized WebAudio placeholder (mower hum, sprinkler ticks,
  ball strike clicks, ambient birdsong, shop doorbell/register). Real recorded SFX and a
  music bed are required for ship quality.

## Deferred by design (post-launch roadmap, per spec)

- Multiple course themes/climates, tournament broadcast systems, course sharing/Workshop,
  multiplayer, localization, Steamworks integration (Electron shell is in place so this
  bolts on without restructuring).

## Technical debt / open items

- ~~Electron native save bridge smoke-tested but not deep-QA'd~~ — deep-QA'd via CDP
  attach (tools/qa-electron-saves.mjs, 15 checks ALL PASS): bridge API, v5 shop boot in
  the real shell, byte-identical native round-trip, real files in
  `%APPDATA%\FAIRWAY STATE\saves\` (note: userData derives from **productName**, not
  package name), reload→Continue restore, office-menu slot save, delete/list, zero
  console/CSP errors. Gotchas recorded: `npm start -- --dev` can be eaten by npm
  ("config dev" warning) — use `npx electron . --remote-debugging-port=<port>`; and
  9223 may be held by a running GlassWaterV2 dev instance, so the tool takes a port arg.
- **Colorblind-safe palette pass pending** — zone colors are green-band heavy and turf
  health reads by hue; the Health/Moisture data views help but a proper colorblind-safe
  indicator pass (patterns/icons) is a pre-ship accessibility requirement, as is
  localization (zh-Hans/de/es/ja/ko per the spec) and remappable controls.
- **Balance is judgment-call tier** — every number in balance.js/club.js/shop.js needs
  real playtesting; the spec's external-playtest pass (with actual golfers) has not
  happened and no amount of build time substitutes for it.
- ~~CSP meta tag~~ — done (importmap hash pinned in index.html; verified in browser
  and Electron).
