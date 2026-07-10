# GOLF EMPIRE — MANUAL TESTING CHECKLIST

Section-by-section manual pass matching what has actually been built. Grows with each
phase; each item is written to be checkable by a human in the running game. The
FAIRWAY STATE core sections below still apply to every owned property; the GOLF
EMPIRE section at the end covers the marketplace/portfolio layer.

How to run: `npm install`, then `npm start` (Electron) or `npm run serve` +
http://localhost:8457/ in a browser. Headless sim tests: `npm test`.

---

## Phase 1 — Shell, course view, terrain editing

**Menu & lifecycle** (empire era — see the GOLF EMPIRE section for the market itself)
- [ ] `npm run serve` + browser (or `npm start`): menu shows GOLF EMPIRE title; Continue is disabled on first run
- [ ] "New Empire — Realistic" opens the property market with a $60,000 wallet ("Relaxed" gives $100,000); buying your first course boots onto its pro-shop floor at Y1 Spring Day 1
- [ ] After at least one in-game day passes, reload: Continue is enabled and restores your whole empire (autosave)
- [ ] Esc in the shop opens the Clubhouse Office (in the course view Esc heads home to the shop — v5): Save slot 1–3, Load slot 1–3 (full empire), Empire overview, Exit to menu all work

**Course view**
- [ ] The 9-hole course renders: fairways, rough, greens, tee pads, 6 bunkers, pond right side, clubhouse building
- [ ] Drag pans; wheel zooms toward the cursor; WASD/arrows pan; grid lines appear when zoomed in
- [ ] Numbered tee markers and red pin flags on all 9 holes; hovering near a hole shows its dashed tee→pin line
- [ ] Clock runs (clean "H:MM AM/PM"), date advances, night dims the course between ~8 PM and ~6 AM
- [ ] Speed controls: ⏸/▶/▶▶/▶▶▶ buttons and Space/1/2/3 keys change sim speed
- [ ] Clicking a section (e.g. the pond, a green) opens the inspect panel with name/zone/area/hole; ✕ or Esc closes it

**Course Works (terrain editing)**
- [ ] E (or the HUD button) toggles works mode: left palette + bottom plan bar appear
- [ ] Each surface tool paints a ghost overlay; brush slider changes radius; painting shows live cost in the plan bar
- [ ] Raise/Lower/Smooth stage elevation changes (gold/blue ghost); a raise then equal lower cancels to zero cost
- [ ] Painting near an open hole shows "⚠ closes HN Xd" in the plan bar
- [ ] Cancel scraps the plan; Confirm charges cash, applies terrain, closes affected holes with ⛏ badges and grey pins
- [ ] Confirm with insufficient cash is refused (button shows "Not enough cash")
- [ ] Fast-forward: renovation counts down daily; hole reopens with a toast and red pin again
- [ ] New hole: + New hole, paint a tee pad + green somewhere sensible, Place tee, Place pin → hole enters construction, then opens
- [ ] Placing a pin off-green or tee off-pad is refused with a toast, no charge
- [ ] Design rating in the HUD moves when you add real features (and dips while holes are closed)

## Phase 2 — Turf simulation

**Reading the course**
- [ ] A new Realistic game shows "Course ~60 · D~86/C~46" in the HUD and a greenskeeper's note toast about diseased greens
- [ ] The course visibly reads scruffy: straw-tinted patchy fairways, dark shaggy rough, pale mottling on 3 sick greens
- [ ] Weather chip in the HUD shows temp/humidity/rain and updates daily; "🥵 Nd dry" appears during dry spells
- [ ] V key (or bottom-right buttons) cycles Normal → Health (red-to-green heatmap) → Moisture (tan-to-blue) views
- [ ] Clicking a turf section shows ONE status word (Healthy/Stressed/Declining) up front; "Details ▸" reveals health/moisture/nutrients/height/wear bars
- [ ] A green's panel shows its stimp speed ("rolls X.X")
- [ ] A diseased section shows a plain-language diagnosis naming the disease, the cause, and the actual live numbers

**Caring for it**
- [ ] G opens the Grounds panel: crew size with +/− (wages shown), per-zone mow height/frequency, irrigation, fertilizer dropdowns
- [ ] "This morning" report lists what was mowed/fed, what was skipped and why, and the money spent
- [ ] With 1 crew, rough mowing is skipped ("crew short") and the rough stays shaggy; hire to 3+ and it gets cut within its cycle
- [ ] Fungicide button treats a diseased section (cash drops); the disease clears over ~a week of game time with a recovery toast
- [ ] Aerate reduces a worn section's wear
- [ ] Turning all irrigation off during a dry spell browns the course visibly within a few days (watch the Health view); condition rating falls
- [ ] Cash drains daily from wages/water/fertilizer; heavier programs cost more
- [ ] Frost mornings (early spring/late fall) show ❄ and the report notes the frost delay
- [ ] Save/load mid-week: turf state, weather, policies, and the morning report all survive

## v3 — Realistic 3D course view

- [ ] New game opens on a 3D course: rolling terrain, ~2,700 trees with shadows, pond with water, clubhouse building, numbered flags and tee markers
- [ ] Drag pans, right-drag orbits/tilts, wheel zooms (28–720 yd), WASD pans, Q rotates
- [ ] Time of day is real: dawn warmth, moving sun and shadows, dusk, readable moonlit night; rainy days are foggy and dim
- [ ] The fixer-upper reads in 3D: straw-tinted weak turf, pale dollar-spot blotches on sick greens, no mow stripes on overgrown fairways
- [ ] After the crew mows (fast-forward a morning), greens/fairways show mow stripes that fade back as grass regrows
- [ ] V cycles Normal → Health heatmap → Moisture (non-turf dims dark in data views)
- [ ] Works mode: brush ring follows the cursor on the terrain; painting stages pulsing ghost cells; confirm converts real terrain (trees clear from converted cells; bunkers become sculpted sand)
- [ ] Renovation badges float over closed holes ("⛏ H1 · 4d"); pins turn grey; reopening restores red flags
- [ ] Raise/Lower/Smooth visibly reshape the land on confirm; ponds carve real bowls with water surfaces
- [ ] Click a section to inspect it (same panel as before) — raycast picking matches what you clicked

## Phase 3 — Membership, hospitality, staffing

**Club Office (C key or 🏛 Club button)**
- [ ] Overview chips show Reputation / Members / Satisfaction / Rounds per day; HUD shows 👥 count · Rep
- [ ] Green fee and all three tier dues adjust with −/+ and show "fair ≈" hints that move with course quality
- [ ] Underpricing vs fair lifts daily rounds; doubling prices visibly cuts play and (over days) bleeds members
- [ ] Payroll lists staff with role/stars/wage; Train sidelines someone 2 days then their stars rise; ✕ fires with severance
- [ ] Hiring market shows 4–6 candidates and refreshes with new names every ~6 days
- [ ] Hiring a skilled groundskeeper visibly increases what the morning crew finishes (Grounds report)
- [ ] Teaching program earns nothing without an instructor; hire one and lessons revenue appears
- [ ] Amenity upgrades charge cash, add daily upkeep, and raise satisfaction/join appeal
- [ ] Outing offers arrive in the feed, expire if ignored, can be booked, pay out on their day (books + feed), and members grumble that day
- [ ] "Around the club" feed shows named joins and quits with reasons
- [ ] Yesterday's books itemize revenue/expense lines and the 7-day net; net matches how cash actually moved
- [ ] Reputation drifts up when the course is good and members are happy; renovations drag it
- [ ] Save/load preserves members, staff, pricing, offers, and the ledger

## Phase 4 — Pro shop (walkable interior + inventory)

**The desk (🛍 Shop button)**
- [ ] Yesterday chip shows sales count and revenue; a warning chip appears when shoppers left empty-handed
- [ ] Markup sliders (80–200% of book) per category; feature table select nudges a category
- [ ] Stock list shows shelf/backroom counts per item with 🚚 pending quantities; Order buttons charge cash and deliver to the backroom after the category's lead time (clubs slowest)
- [ ] Premium (tier 3 🔒) items can't be ordered yet — they unlock with progression
- [ ] Rental fleet card shows sets/condition; buying a set improves both
- [ ] Notable sales list names members and what they bought

**The floor (P key or the desk's Walk button)**
- [ ] P enters a first-person shop: wood floor, windows, shelves, racks, apparel table, counter with register, fitting bay
- [ ] Click captures the mouse for looking (Esc releases); arrow keys also turn the view; WASD walks; Shift runs
- [ ] You collide with fixtures and walls — no walking through the apparel table
- [ ] Shelf stacks match real inventory counts: sell-through visibly empties them; restocking refills them
- [ ] Facing a display shows its label with shelf/backroom counts; E restocks it from the backroom with a toast
- [ ] The register shows yesterday's take; the fitting bay reports fittings (or that you need a pro)
- [ ] Customers wander in, browse displays, visit the counter, and leave; more traffic follows better sales days
- [ ] E at the door or P returns to the course; time and money keep flowing while you're inside

**The loop**
- [ ] With no floor staff, delivered stock stays in the backroom until YOU shelve it — lost sales climb; hiring a pro-shop staffer fixes mornings
- [ ] Doubling markup visibly cuts units sold; near-book pricing moves volume
- [ ] An instructor on payroll starts generating fittings revenue and happier members
- [ ] Save/load preserves inventory, orders in transit, markup, and the rental fleet

## Phase 5 — Persistent golfers

- [ ] During open hours, small golfer figures walk the open holes in 3D, pausing to swing; more play on busy days; none at night or on closed holes
- [ ] Club panel → "The Regulars": members list with handicap, 😊 satisfaction, rounds played, and their latest thought in quotes
- [ ] Clicking a regular opens their card: tier, handicap, rounds here, best score, persona, and up to 6 remembered visits with scores and the thoughts from each
- [ ] Thoughts trace to real conditions: sick greens produce disease complaints (with the real count), high green fees produce value gripes naming the price, busy days produce wait complaints with real minutes, a sold-out shop produces bare-shelf complaints
- [ ] Feed ("Around the club") carries overheard thoughts with 💬/💢 mood icons
- [ ] Buy a fitting-capable pro (instructor) and watch fittings improve members' handicaps faster over following weeks
- [ ] Handicaps drift down with regular play; scores respond (better skill + healthier course = lower numbers in memories)
- [ ] Busy days visibly wear greens (Health view darkens on putting surfaces; aerate to relieve)
- [ ] A consistently delighted full/premium regular becomes a ⭐ champion (feed entry, permanent star on their card)
- [ ] Let a member's satisfaction collapse below ~15 and they quit FOREVER — ⛔ feed entry, reputation hit, and they never rejoin
- [ ] Save/load: memories, champions, and the walked-out-forever all persist

## Phase 6 — Progression, prestige, difficulty toggle

- [ ] HUD shows 🏆 prestige next to members/reputation; it climbs slowly as the club genuinely improves (course, amenities, premium members, champions, events)
- [ ] Club panel → Development lists nine improvements grouped by category with 🔒 prestige locks, prices, and ✔ owned marks
- [ ] Triplex mowers visibly free up crew hours (Grounds morning report finishes more with the same crew)
- [ ] Smart irrigation cuts the daily water line; spray rig cuts fungicide prices in the inspect panel; aerator halves aeration and sheds wear faster
- [ ] Premium supplier unlocks 🔒 tier-3 items at the shop desk
- [ ] Corporate desk raises new outing offer payouts; reciprocal network adds a daily revenue line
- [ ] Tournaments: locked until Tournament operations; Club Championship (P50) → County Amateur (P65, requires hosting the championship) → THE WILLOW CREEK OPEN (P85)
- [ ] Scheduling an event charges the staging cost and shows the countdown with its condition requirement
- [ ] A well-prepped event succeeds: 🏅 feed note, prestige/reputation jump, entry fees in the books, "hosted ×N" mark
- [ ] A shabby course on event day fails publicly: 💥 note and a prestige drop — the course must be peaked FOR the date (mind foot-traffic wear!)
- [ ] Winning the Open triggers the 🏆 celebration and the club keeps playing afterward
- [ ] Realistic: five straight days past a −$2,000 overdraft ends the run (bank modal, load save or exit); Relaxed: debt floors at −$5,000, never a hard fail
- [ ] Pause menu switches Relaxed/Realistic mid-game and the balance changes take hold (turf decay, disease, wages, downtime)

## v4 — Visual fidelity pass

- [ ] Up close (≤60yd zoom), fairway/green/rough show real grass grain, bunkers show real sand texture, paths show gravel — not flat color
- [ ] Rough reads as a visibly different, clumpier grass than fairway; greens read as a tighter cut
- [ ] Trees are recognizable varied species (round oaks, blocky canopies, tiered pines) with bark trunks and realistic foliage tones, at every zoom level
- [ ] The pond reflects sky/trees, ripples continuously, and holds a natural shoreline; no water slivers in terrain dips
- [ ] Trees and the clubhouse sit grounded with soft contact shading (AO) where they meet the ground; the sky does NOT bloom into white fog
- [ ] The clubhouse reads as a building: gabled shingle roof, plank siding, porch with columns, chimney; windows glow warm at dusk/night
- [ ] Full stack performance stays far above 60fps (tight-loop measured ~566fps at 2560px; note: rAF in occluded windows throttles to 1-2fps and is not a GPU signal)
- [ ] `npm test` still 121/121 — this pass changed rendering only

## Phase 7 — Sound, tutorial, polish

**Sound (procedural placeholders)**
- [ ] After your first click/keypress, ambient birdsong plays on the course on fair-weather days
- [ ] Rain days bring an audible rain wash (quieter inside the shop)
- [ ] The 5–7 AM crew shift hums with mowers; occasional ball-strike clicks during open hours when golfers are out
- [ ] Entering customers ring the shop doorbell while you're walking the floor
- [ ] Pause menu: volume slider and mute work and persist across sessions (not part of saves)

**Tutorial arc**
- [ ] A new club shows the 🎯 guide card (1/10, "Walk the property"); ✕ hides it permanently for that save
- [ ] Steps clear from REAL actions with a toast: open Grounds → treat a green → staff up → order stock → walk the shop floor → touch prices → first new member → first profitable day → first amenity/improvement → prestige 30
- [ ] The guide retires with a farewell toast when the arc completes; state survives save/load

**Chrome & hardening**
- [ ] HUD stays usable at narrow window widths (weather collapses, club name hides)
- [ ] The strict CSP is active: game loads with zero console errors in browser AND Electron
- [ ] `npm test` → 121 passing; `npm start` boots the Electron app to the menu
- [ ] Electron native saves (repeatable): `npx electron . --remote-debugging-port=9224`, then `node tools/qa-electron-saves.mjs 9224` → RESULT: ALL PASS (bridge API, shop boot, byte-identical round-trip, files in `%APPDATA%\FAIRWAY STATE\saves\`, Continue restore, cleanup, zero console/CSP errors)

## v5 — Home base navigation + camera default

**Shop as home base**
- [ ] New Club AND Continue boot directly onto the walkable shop floor (not the course, not a menu)
- [ ] The lock-hint bar reads "…E interact · P: course · Esc: office menu"; a "⛳ Out to the course (P)" button sits top-right
- [ ] Facing the shop door shows "Step out to the course — greens, works, and the grounds crew"; E enters the top-down course view
- [ ] A framed course map hangs beside the door, drawn from YOUR actual course (fairway loop, pond, red pins — repaint after works changes it); facing it shows "Course management — open the course overview"; E enters the course view
- [ ] In the course view, Esc (with no tool/plan/panel open) and P both return to the shop; the hint bar says "Esc/P: back to shop"
- [ ] Esc in the course still honors precedence first: active works tool → staged plan → open panel/inspect close before any exit happens
- [ ] Esc in the shop opens the Clubhouse Office; its primary button reads "Back to the shop" there (and "Back to the course" when opened from the course)
- [ ] The course view is NOT walkable — it remains the top-down management view; time and money flow in both views
- [ ] Tutorial step 1 reads "Step out through the shop door (E) and open the Grounds desk (G)" and still clears by opening Grounds

**Camera default**
- [ ] A fresh course entry frames the clubhouse at bottom with the opening fairway ahead (dist 210): turf grain, individual tree shapes, and shadows are readable WITHOUT zooming in
- [ ] Wheel still zooms the full 28–720 range; the old far overview is one zoom-out away

## GOLF EMPIRE — marketplace, portfolio, flipping

**The property market**
- [ ] New Empire opens the market over the menu: 8 listings, each with holes/par/yards, Design, Condition, members, Rep, sick-green warnings where true, an asking price, and a flavor line — the hidden true value is never shown
- [ ] The listings are genuinely different: a classic fixer-upper, a superb-bones wreck, an immaculate-but-dull nine, an executive nine, an 18-hole estate, and at least one that smells overpriced
- [ ] Buy is disabled ("Not enough cash") on anything the wallet can't cover; buying deducts exactly the ask
- [ ] Your first purchase boots you onto THAT club's shop floor; the HUD shows its name and your remaining wallet
- [ ] The tutorial guide runs at your first-ever club only — a second purchase arrives with the guide already retired
- [ ] In-game, 🏢 Empire (M) → "Browse the market" lets you buy more; a purchase while you own a club parks the new one ("away — caretaker crew") instead of teleporting you

**The empire overview (🏢 / M, or the office menu)**
- [ ] Shows the wallet, total portfolio value, and "all courses yesterday" (active club's books + each parked club's passive day)
- [ ] Each owned property card shows holes, condition, value, and daily net; the active one is marked 📍 "you are here"
- [ ] A parked property accrues while you play elsewhere: its card shows "away Nd" and "Earned $X while you were away", and the wallet actually received it
- [ ] A parked wreck does NOT heal (condition holds below the caretaker floor of ~38); a parked showpiece decays toward it over weeks
- [ ] "⛳ Go there" switches clubs: full scene rebuild, arrival on the new club's shop floor, shared clock (no time travel), wallet carried; the previous club parks
- [ ] Returning to a parked club shows the decay for real on the turf (walk it / Health view) and delivers any shop orders that arrived while away; outings you weren't there to host are forfeited with a feed note
- [ ] Sell… opens a confirmation stating the exact payout and that the sale is permanent (members, regulars, staff all gone); the world pauses while it's open
- [ ] Confirming pays exactly the number shown, removes the property everywhere (not re-listed), and logs the deed; selling your active club moves the office to your next property — selling your last drops you back into the market with the check
- [ ] Save/load (slots or Continue) round-trips the entire empire: every holding's full state, parked summaries, wallet, market, and deed log
**The living market**
- [ ] The market modal leads with one mood chip — Buyer's market / Balanced market / Seller's market — and its hover hint says what the mood means for prices
- [ ] Each listing's header line ends with a relative age — "Just listed", "A week or two on the market", or "Been sitting — rival buyers circling" — and never a numeric countdown
- [ ] Over a few in-game weeks, new listings appear (🏷 feed notice with the ask); the market never exceeds 10 unsold listings
- [ ] Generated listings are real: buy one, walk it — the course exists, matches its listed size/par/yards, and its design rating is honest
- [ ] A listing ignored past its grace window eventually goes to a named rival (🏴 feed notice, e.g. "Fairline Capital bought …"); nothing in its first week-plus on the market ever vanishes
- [ ] Ignoring the market for a season+ turns over the whole launch roster with visible notices while replacements keep arriving — the window is never left empty for long
- [ ] The mood indicator genuinely changes over weeks (Balanced ↔ Buyer's/Seller's); new listing asks run visibly softer in a buyer's market and richer in a seller's market
- [ ] Owned property values and sale payouts do NOT move with the market mood — only new listings' asks do
- [ ] A market left open on screen re-renders as days pass (ages tick over, arrivals/rival-buys appear) without reopening it
- [ ] Reload → Continue restores the market exactly: same listings with the same listedDay stamps, same mood, same feed
- [ ] `npm test` → 176 passing (121 core + 41 empire-layer + 14 living-market) — superseded, see 2026-07-10 sections: now 210

## THE WALKABLE COURSE — first-person by default

**On foot**
- [ ] Stepping out the shop door (E at the door, or P) lands you standing at the clubhouse, facing the course, at human eye height — not the old top-down camera
- [ ] WASD walks (~3.4 yd/s), Shift runs, click captures the mouse for looking, arrows also look; the crosshair overlay shows the controls hint until the pointer locks
- [ ] You collide with and slide along trees, the clubhouse walls, and pond edges — you can shelter under the porch but not walk through the building, and you stop at the water
- [ ] Tab switches to the labeled overview camera (the old rig, hint bar returns); Tab or Esc returns you to your feet exactly where you stood
- [ ] Esc on foot: releases the pointer first, then opens the office menu; panels (G/C/M) open over the walk view with the cursor freed

**The cart**
- [ ] A golf cart is parked by the clubhouse porch; walking up to it facing it shows "Golf cart — [E] take the wheel"
- [ ] Driving is ~3× walking with A/D steering (no strafe); the cart mesh follows under you; parked carts are solid obstacles
- [ ] E parks it: you step out the side, the cart stays exactly there, and the prompt flips back to "take the wheel"

**Walk-up inspection**
- [ ] The patch of ground ahead always prompts with its section name and ONE status word ("Green 1 — Declining — [E] inspect"); open scrub prompts nothing
- [ ] E opens the same inspect panel the top-down click used (status chip, stimp on greens, diagnosis, Details, Fungicide/Aerate), for that exact section

**The hose**
- [ ] F pulls the hose out: the prompt becomes a live readout ("💦 Fairway 2 · a — moisture 62 — hold the mouse button to water")
- [ ] Holding the mouse button sprays a droplet arc and the number climbs in real time; the watered patch visibly darkens; the Moisture view (V) shows the soaked cells blue
- [ ] The moisture genuinely lands in the sim (inspect Details agree; the crew/weather systems read the same values); only turf drinks — sand and paths shed it
- [ ] F again puts it away; taking the cart's wheel stows it automatically

**The rest of the world**
- [ ] Golfer NPCs wander and play on the same ground you walk (none at night or on a wrecked course in winter — that's the sim being honest)
- [ ] Triggering Course Works from on foot shows the honest "being redesigned for the walkable course" notice and does NOT half-open; from the overview camera (Tab) the existing editor still fully works
- [ ] The full loop runs clean: shop door → walk → drive → inspect → water → P back to the shop floor — zero console errors

## Shop restoration arc (2026-07-10)

**Condition & cleaning**
- [ ] A fresh game boots into a visibly rundown shop: dim/flickering light, one dead tube, filthy windows, pale dust drifts on the floor, cardboard clutter piles; the chip reads "Shop condition ~16 — filthy"
- [ ] E on a clutter pile hauls it out (once), the floor under it cleans a little, condition ticks up
- [ ] Order the Shop vacuum ($140) from the desk/computer; it arrives in 2 days; F equips it (wand + red head visible), holding LMB cleans the aimed patch — dust recedes in place, motes stream into the nozzle, condition climbs live
- [ ] Supplies/decor never appear on sales shelves and shoppers never buy them

**Decor & the computer**
- [ ] Ordering decor (rug/plant/poster/board/pendant/lounge) through the same supplier flow spawns translucent green ghosts at each valid free spot once delivered; E places (back→placed), the real mesh + condition bump land; pendants add real warm light
- [ ] The counter computer prompts "[E] supplier orders & pricing" and opens the REAL desk panel; Esc closes the panel before offering the office menu
- [ ] Tee sheet tab: half-hour grid 7:00–16:30 up to 7 days out; Book for a member or walk-in; double-booking refused; Cancel frees the slot
- [ ] On the booked day from 45 min before the slot, the register offers "[E] check in <name> (<time> tee, $fee)"; E collects exactly the booking-day fee into greenFees; a golfer walks to the counter around their time
- [ ] Full renovation: vacuum everything + place all decor → condition 100 "showroom"; shell reads like Designs/ClubHouseInterior (wainscot, beams, wordmark with THIS club's name, trimmed windows, stocked varied shelves)

## Asset integration & course tools (2026-07-10)

**The earned tractor**
- [ ] A fresh game has NO drivable tractor: the maintenance yard (shed/workbench/tool chest) sits east of the porch with the BROKEN tractor (dull, sagging) buried in a junk pile
- [ ] E on the junk pile, fuel can, and drive belt each completes once with a toast; the tractor prompt lists what's still missing, then "[E] get her running"
- [ ] Repair swaps the broken shell for the restored red tractor IN PLACE with the mower deck hitched; "[E] take the wheel" now works
- [ ] Driving is THIRD-PERSON (chase cam behind/above); on foot stays first-person; old saves keep a working tractor from the start
- [ ] Reloading a fresh save keeps repair progress (steps + repaired persist)

**The tool belt**
- [ ] F cycles: hose → divot kit → bunker rake → hands free, each with a real held model (coiled hose+gun / fork+soil bucket / rake) and its own prompt + particle color
- [ ] Divot kit: aim at worn turf ("divot wear N"), hold LMB → the number drains, the olive-tan wear tint clears, ends at "smooth, no divots here"
- [ ] Bunker rake: after some played days, bunkers read "footprints N" with visibly churned sand; holding sweeps a cross of cells clean → "raked smooth"
- [ ] Play traffic re-footprints sand daily (sim/bunkers.js); quiet days don't

**Course props**
- [ ] 4 storm-debris piles sit on fairway/rough/tee cells; E hauls each away once (persisted)
- [ ] The broken tee sign leans by Tee 1; "[E] repair it (150 dollars)" charges the books and swaps in the upright sign
- [ ] Every OPEN hole has the real flagstick (striped pole, red flag) and the green tee-marker pair squared to the line of play; closed holes keep the gray primitive flag
- [ ] The stone entrance sign stands on the approach, dulled and leaning while condition is poor

- [ ] `npm test` → 210 passing

## Overnight session (2026-07-10, Parts 0-6)

**Tool feel & audio**
- [ ] Tools rise into the hands over ~0.25s (tilted, from below) and drop away on stow; they bob with your stride and breathe at rest
- [ ] Mounting the tractor EASES to the chase cam (~0.45s), dismounting eases back; no camera cuts
- [ ] Equip click, per-tool use loops (hose hiss / vacuum hum / scrapes), a two-note chime when a patch comes smooth or the shop climbs a condition tier, thunks on hauls/placements, engine loop while driving (needs one human ear-pass for levels)
- [ ] Panels/modals ease in like toasts

**HUD / Manage dock**
- [ ] Top bar = club · date/time · speed · cash · 🗂 Manage · ☰ only
- [ ] Manage drops a dock of five entries with kbd hints and LIVE sublines (members/rep under Club, weather under Grounds, course rating under Works, portfolio under Empire, yesterday's sales under Shop); entries open their panel and dismiss the dock; outside-click/Esc dismisses; hotkeys unchanged

**Store loop + Summary tab**
- [ ] Computer's third tab 📊 Summary: condition + wallet chips, yesterday from the real books, today's tee sheet, GROUNDS CHORES (bunkers to rake / worn patches / debris piles / broken sign / broken tractor — or "all caught up"), inbound orders with countdowns, notable sales
- [ ] Full loop in one sitting: order stock+decor+vacuum on the computer → book a slot → deliveries land → vacuum/haul/place still work → booked golfer checks in and pays — zero console errors

**NPCs**
- [ ] Three simultaneous due bookings form a real diagonal queue at the register; label says "· N more waiting"; head served first; line advances
- [ ] Customers collide with fixtures/player/each other and FACE what they browse
- [ ] Golfers sidestep the walking player (~1.4 yd min), the tractor, and each other, then drift back to their line

**Doors & moments**
- [ ] Shop and clubhouse doors swing open on approach (player or customers) and close behind
- [ ] Placed decor lands with a scale pop; hauled junk/litter/parts shrink out

**Course systems (new)**
- [ ] THE DECK CUTS: driving the repaired tractor mows a 3-cell swath to per-zone ideal height (verify heightMm and visible stripes/lane); clippings burst behind the deck over shaggy ground; deck vibrates while cutting
- [ ] Rain: streaks fall matching the day's rainIn; tee-number badges stay readable facing the sun
- [ ] Decor pack-up: E a placed piece → back to backroom, ghost reoffers the spot

- [ ] `npm test` → 211 passing
