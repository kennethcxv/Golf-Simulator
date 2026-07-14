# GOLF EMPIRE (working title)

Acquire distressed, struggling golf courses, breathe new life into them, and decide
each one's fate: hold it as a jewel in a growing empire, or flip it for a payout that
funds the next acquisition. Built on the FAIRWAY STATE simulation core — real turf
science, tiered memberships, persistent golfers, a walkable pro shop — with a property
marketplace, honest valuations, and a multi-course portfolio on top.

House Flipper's buy-restore-transform loop, applied to the golf course management sim.

> **This is the sole active codebase going forward** (as of 2026-07-09). The original
> FAIRWAY STATE repo (sibling `Golf/` folder) is retired and kept for reference/history only.

## Tech

- Vanilla JavaScript — simulation, management UI
- Three.js — the 3D course view and the walkable pro shop interior
- Electron — desktop shell for the eventual Steam build
- `node --test` — headless unit tests for all simulation logic (231 green)

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

**On the course (first-person, the default)** — WASD: walk · Shift: run · mouse
(click to capture): look · E: interact (inspect turf, repair chores, signs, the
tractor) · F: cycle the tool belt (hose → divot kit → bunker rake; hold the mouse
button to use) · Tab: overview camera · Space: pause · 1/2/3: speed · V:
Normal/Health/Moisture views · P: back to the shop. Driving the tractor (earned by
repairing it at the maintenance yard) switches to a third-person chase camera.

**Overview camera (Tab)** — drag: pan · right-drag: orbit · wheel: zoom · E: Course
Works (terrain editing — its walkable redesign is pending) · click: inspect

**Panels** — G: Grounds (crew + policies) · C: Club office (members, pricing, staff,
development, tournaments) · 🛍: Shop desk (orders, markup, rentals, tee sheet) ·
Esc: menus

**Pro shop floor** — P: walk the floor · click: capture mouse (Esc releases) · WASD:
move · E: restock/interact (clutter, decor ghosts, the office computer, check-ins) ·
F: the vacuum (hold the mouse button to clean) · P or the door: leave

## Status

Five portions complete on top of the feature-complete FAIRWAY STATE core: the
empire layer (marketplace, acquisition & permanent sale, live valuation,
multi-property portfolio with caretaker simulation), the LIVING market (new listings
over time from parametrized distress profiles, rival buyers expiring stale listings,
a bounded buyer's/seller's pricing cycle, all surfaced in the UI), the WALKABLE
course (first-person by default with real collision, walk-up turf inspection — the
old orbit rig demoted to a Tab-away overview camera; terrain editing's walkable
redesign is the headline open item), the SHOP RESTORATION arc (a filthy pro shop
cleaned and furnished up to its reference — vacuum, decor placement, the office
computer with supplier orders and a tee-time reservation sheet, counter check-ins),
and the ASSET INTEGRATION portion (the earned-tractor repair sequence with a
third-person drive camera, a real hand-tool belt — hose, divot kit, bunker rake —
bunker footprints, storm litter, the broken→restored tee sign, real flagsticks and
tee markers, and a weathered stone entrance sign). 2026-07-13: the clubhouse became
one continuous, physical pro shop — walk in through real hinged doors (no scene
swap), run Fairway Office on the desk laptop, receive deliveries as boxes you
carry/unpack/shelve, and ring customers up at the register yourself. 231 headless
tests green; every
portion browser-QA'd with zero console errors. See TESTING_CHECKLIST.md for the
manual pass and KNOWN_ISSUES.md for limits and the roadmap.

## Docs

- `Golf_Course_Simulator_Project_Overview.md` — FAIRWAY STATE core design spec (v2)
- `BUILD_BRIEF.md` — the original core-game build directive
- `DEV_LOG.md` — every judgment call made during development, with reasoning
- `KNOWN_ISSUES.md` — v1 limits, placeholder assets, and future work
- `TESTING_CHECKLIST.md` — section-by-section manual test pass matching what's built
