# GOLF EMPIRE (working title)

Acquire distressed, struggling golf courses, breathe new life into them, and decide
each one's fate: hold it as a jewel in a growing empire, or flip it for a payout that
funds the next acquisition. Built on the FAIRWAY STATE simulation core — real turf
science, tiered memberships, persistent golfers, a walkable pro shop — with a property
marketplace, honest valuations, and a multi-course portfolio on top.

House Flipper's buy-restore-transform loop, applied to the golf course management sim.

## Tech

- Vanilla JavaScript — simulation, management UI
- Three.js — the 3D course view and the walkable pro shop interior
- Electron — desktop shell for the eventual Steam build
- `node --test` — headless unit tests for all simulation logic (162 green)

## Run

```
npm install
npm start          # Electron app
npm run dev        # Electron app + devtools + remote debugging on :9225
npm run serve      # browser dev server on http://localhost:8457/ (for Playwright/DevTools QA)
npm test           # headless simulation unit tests
```

The game also runs in a plain modern browser via `npm run serve` — saves fall back to
localStorage there; the Electron build writes saves to the OS user-data folder
(`%APPDATA%\GOLF EMPIRE\saves\`).

## The loop

Browse the property market (every listing is a real, buildable course — the ask is the
seller's number, not necessarily the truth) → buy one → restore it with the full
FAIRWAY STATE toolkit (turf care, staff, pricing, works, the shop) → then keep it for
income and prestige, or sell it at the live appraisal and move up. Parked properties
run under a caretaker: a trickle of income, slow condition decay, and everything
waiting exactly where you left it.

## Controls

**Empire** — M or 🏢: empire overview (properties, values, switching, selling) ·
market via the overview or the office menu

**Course** — drag: pan · right-drag: orbit · wheel: zoom · WASD/arrows: pan · Q: rotate ·
click: inspect a section · Space: pause · 1/2/3: speed · V: Normal/Health/Moisture views

**Panels** — G: Grounds (crew + policies) · C: Club office (members, pricing, staff,
development, tournaments) · 🛍: Shop desk (orders, markup, rentals) · E: Course Works
(terrain editing, plan → confirm) · Esc: menus

**Pro shop floor** — P: walk the floor · click: capture mouse (Esc releases) · WASD:
move · E: restock/interact · P or the door: leave

## Status

Portion 1 of the empire layer is complete on top of the feature-complete FAIRWAY STATE
core: property marketplace (8 genuinely distinct listings), acquisition & permanent
sale, live valuation, multi-property portfolio with passive caretaker simulation for
unvisited courses, and the market/empire screens. 162 headless tests green; full
browser playthrough QA'd with zero console errors. See TESTING_CHECKLIST.md for the
manual pass and KNOWN_ISSUES.md for v1 limits and the next portion's roadmap.

## Docs

- `Golf_Course_Simulator_Project_Overview.md` — FAIRWAY STATE core design spec (v2)
- `BUILD_BRIEF.md` — the original core-game build directive
- `DEV_LOG.md` — every judgment call made during development, with reasoning
- `KNOWN_ISSUES.md` — v1 limits, placeholder assets, and future work
- `TESTING_CHECKLIST.md` — section-by-section manual test pass matching what's built
