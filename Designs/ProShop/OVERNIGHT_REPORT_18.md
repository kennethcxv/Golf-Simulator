# Overnight Report 18

Session start: 2026-08-09 ~23:10. Branch `feature/pro-shop-vertical-slice`, base commit `a4baeaf`.
Order worked: H, A, C, B, D, F, E, G. Stop rule: 45 min / 5 commits per item.

Pre-flight: on `feature/pro-shop-vertical-slice`; last commit `a4baeaf` "F1: the common path is the el() factory, built in Goal 16"; tree NOT clean — 19 modified `.blend` files (Blender re-saves from the open instance; left unstaged all night) + 3 untracked `tools/qa/electron-f1-*.js` drivers from last session (left untracked until F work decides their fate).

---

## H — TOOLING

### H0 blender-mcp
**Finding: the socket is NOT live.** Port 9876 is LISTENING and owned by the running Blender (PID 4464, open since Aug 6), but every connection is dropped immediately (`WinError 10054` after accept). The addon's server thread is wedged after ~3 days of uptime. The only fix is restarting Blender, which risks unsaved state in the user's open session — not doing that overnight.
Mitigation: asset work tonight uses the existing headless pipeline plus headless renders (LOOK at the PNG before export — same discipline). The permanent viewport-screenshot rule still goes into `golf-assets` (H6) with the MCP socket as primary and headless render as fallback. Retrying the socket periodically; will use it the moment it answers.
**ACTION FOR YOU: restart Blender (save first), re-enable the MCP connection, and the H0 workflow is unblocked.**

### H1 ESLint + dev tooling — DONE
Installed `eslint pixelmatch pngjs @gltf-transform/cli gltf-validator` (+`globals`, `@eslint/js` for the flat config). Wrote `eslint.config.js` directly (flat, ESLint 10): `eslint:recommended` untuned; browser globals for `src/**`, node for `.cjs`/tools/tests. `npm run lint` added.

**Violation breakdown across `src/` (275 files, 72 with findings, 333 total). NOTHING fixed — your call:**

| count | rule | note |
|---|---|---|
| 227 | no-unused-vars | |
| 45 | no-useless-assignment | |
| 33 | no-undef | mostly REAL undefined identifiers, not env gaps: `arrivalIntro`×8, `campaignView`, `recordManualWork`×2, `addOrder`, `estimate`, `label`×2… and `Buffer`×2 used in renderer code |
| 7 | no-unreachable | 6 in `render3d/clubhouse/fixtures.js`, 1 in `sim/shop.js:767` |
| 6 | no-func-assign | all `courseScene.js:2619-2624` (`ensure*` functions overwritten) |
| 4 | no-useless-escape | |
| 4 | no-redeclare | `clubhouse.js:7827`, `fixtures.js:1072`, `courseScene.js:7591,9860` |
| 3 | no-empty | |
| 1 | **no-dupe-keys** | **`src/main.js:146` duplicate key `preferences` — the exact class that killed two drivers. Left in place per your "autofix NOTHING"; flagging it as the first thing to decide.** |
| 1 | no-extra-boolean-cast | |
| 1 | no-constant-binary-expression | |
| 1 | unused eslint-disable | `core/faultGuard.js:75` (no parse errors anywhere in src) |

Suite: green baseline 2954/2954 in 212 s (run immediately before this commit; commit touches no src/tests).

---

## Running lists (updated continuously)

### UNCONFIRMED
- (none yet)

### NOT DONE
- (none yet)

### VERIFIER FINDINGS STILL OPEN
- (none yet)

### Fixed but not asked for
- (none yet)
