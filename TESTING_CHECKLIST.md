# FAIRWAY STATE — MANUAL TESTING CHECKLIST

Section-by-section manual pass matching what has actually been built. Grows with each
phase; each item is written to be checkable by a human in the running game.

How to run: `npm install`, then `npm start` (Electron) or `npm run serve` +
http://localhost:8447/ in a browser. Headless sim tests: `npm test`.

---

## Phase 1 — Shell, course view, terrain editing

**Menu & lifecycle**
- [ ] `npm run serve` + browser (or `npm start`): menu shows FAIRWAY STATE title; Continue is disabled on first run
- [ ] "New Club — Realistic" starts at Willow Creek: 9 holes, $60,000, Y1 Spring Day 1 6:00 AM ("Relaxed" gives $100,000)
- [ ] After at least one in-game day passes, reload: Continue is enabled and restores your game (autosave)
- [ ] Esc opens the Clubhouse Office: Save slot 1–3, Load slot 1–3, Exit to menu all work

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

## Phase 3 — Membership, hospitality, staffing

*(populated when Phase 3 is complete)*

## Phase 4 — Pro shop (walkable interior + inventory)

*(populated when Phase 4 is complete)*

## Phase 5 — Persistent golfers

*(populated when Phase 5 is complete)*

## Phase 6 — Progression, prestige, difficulty toggle

*(populated when Phase 6 is complete)*

## Phase 7 — Sound, tutorial, polish

*(populated when Phase 7 is complete)*
