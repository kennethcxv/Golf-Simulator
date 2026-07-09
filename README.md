# FAIRWAY STATE (working title)

A realistic golf course management simulator. Design and renovate a living course in a
top-down management view, nurture real turf, run tiered memberships — and walk the floor
of your own first-person pro shop.

Spiritual successor to Sid Meier's SimGolf, grounded in real turf science and real
golf-business operating knowledge.

## Tech

- Vanilla JavaScript / HTML5 Canvas — course view, simulation, management UI
- Three.js — the walkable pro shop interior only
- Electron — desktop shell for the eventual Steam build
- `node --test` — headless unit tests for all simulation logic

## Run

```
npm install
npm start          # Electron app
npm run dev        # Electron app + devtools + remote debugging on :9223
npm run serve      # browser dev server on http://localhost:8447/ (for Playwright/DevTools QA)
npm test           # headless simulation unit tests
```

The game also runs in a plain modern browser via `npm run serve` — saves fall back to
localStorage there; the Electron build writes saves to the OS user-data folder.

## Docs

- `Golf_Course_Simulator_Project_Overview.md` — authoritative design spec (v2)
- `BUILD_BRIEF.md` — the build directive this project follows
- `DEV_LOG.md` — every judgment call made during development, with reasoning
- `KNOWN_ISSUES.md` — placeholder assets and pre-ship gaps
- `TESTING_CHECKLIST.md` — section-by-section manual test pass matching what's built
