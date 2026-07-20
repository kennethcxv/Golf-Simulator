# Player experience polish — test matrix

| Area | Scenario and input | Result | Evidence |
| --- | --- | --- | --- |
| Main menu | First visit; keyboard Tab wrap, arrows, Home/End | Pass — disabled Continue is skipped and focus never falls to BODY | Iterations 1–4 |
| New game | Open dialog, choose Relaxed, buy first property through visible controls | Pass — no literal `null`, consequences readable, world loads | Iterations 1–4 and final acceptance |
| Property market | Compact keyboard traversal into below-fold Buy actions | Pass — 569 px viewport scrolls within 1,311 px document | Iteration 3 `03b` capture/result |
| Loading | Real load stages, progress, rotating tip, reduced motion | Pass | Iterations 2–4 |
| Settings persistence | Audio `0.60`, sensitivity `1.35`, invert Y, FOV `74`, bob off, UI scale `1.10` | Pass across menu → game → second page | Stress result |
| Accessibility | Reduced motion, high contrast, 125% UI, toggle tool activation | Pass at 2560×1440 with no clipping | Iteration 4 |
| Tutorial | Disable, then reset | Pass — hidden/complete then restored/incomplete with card visible | Stress result |
| Save success | Pause → Save slot 1 | Pass — data and metadata written | Stress result |
| Save write failure | Inject quota error, Save slot 2 | Pass — previous slot preserved, actionable persistent error | Stress screenshot 01/result |
| Save recovery | Corrupt slot 1 primary with valid backup | Pass — backup reported and loadable | Stress screenshot 02/result |
| Save version guard | Slot 3 empire version `999` | Pass — refused as newer version | Stress screenshot 02/result |
| Pause — walk | P at speed 2, then resume | Pass — `walk → pause → walk`, `2 → 0 → 2` | Stress result |
| Pause — tool wheel | Hold F, then P | Pass — wheel closes, pause opens, no pointer recapture | Stress result |
| Pause — placement | P while placement is active | Pass — `placement → pause → placement`, speed stays 0 | Stress result |
| Pause — laptop | P while seated | Pass — `laptop → pause → laptop`, speed stays 0 | Stress result |
| Pause — register | P behind till | Pass — `register → pause → register`, speed stays 0 | Stress result |
| Pause — overview/editor | P from both modes | Pass — exact mode restored | Stress result |
| Pause repetition | 100 P open/close cycles | Pass — speed 2, zero pause nodes, clean audio | Stress result |
| Camera-mode repetition | 100 Tab transitions | Pass — ends in walk, no pause nodes | Stress result |
| Tool wheel | Hold F, keyboard traversal over unavailable options, Escape, Tab | Pass — reasons readable; focus releases to BODY; overview receives Tab | Iterations 1–4 |
| Tool selection | Select washer with number key and hold LMB | Pass — washer active and one tool loop created | Stress result |
| Notifications | Burst 70 duplicates plus mixed priorities | Pass — visible cap 3, `×70` dedupe, final nodes 0 | Stress result |
| Audio backgrounding | Hold washer, dispatch hidden/visible lifecycle | Pass — suspended and loop cleared; running cleanly on restore | Stress result |
| Returning player | Open second page after save | Pass — Continue enabled and preferences retained | Stress screenshot 03/result |
| Delivery | Pad → cut tape → flaps → armful → shelf with normal E/hold E | Pass | Final operations |
| Clutter | Face an unobscured pile and press E | Pass — uncleared count drops by one | Final operations |
| Vacuum | Equip via F and hold LMB on dirty floor | Pass — grime reduced by `1.402` | Final operations |
| Fixture placement | B, E, R, move, E | Pass — committed legal position and auto-exited mode | Final operations |
| Front desk | Book due tee time, face register, press E | Pass — `booked → played` | Final operations |
| Course maintenance | Space, F to hose, hold LMB on aimed cell | Pass — local moisture +`36.504` | Final operations |
| Checkout — card | Scan, total, click terminal, receipt, bag, handoff | Partial — sale completes, but no physical swipe gesture | Final checkout card |
| Checkout — cash | Scan, total, accept tender, open drawer, select change | Blocked — `$9 / $14`, remains `cash-drawer` | Final checkout cash |
| Performance | Three × 600-frame fixed-camera runs, paired baseline/final | Pass — no meaningful regression; listener delta 0 | Final performance comparison |
| Console/page errors | All final visual, stress, operations, performance routes | Pass — zero unexpected console errors and zero page errors | Result JSON and logs |
| Automated suite | `npm test` | Pass — 520/520, zero failures/skips | Terminal run on final worktree |
| Controller | Current game exposes no Gamepad/controller binding layer | Not applicable to this keyboard/mouse pass; no controller claim made | Input source inspection |

## Reproduction commands

Run from the player-experience worktree with the static server on port 8463:

```powershell
$env:GOLF_FLIPPER_URL='http://127.0.0.1:8463/'
node tools/qa/player-experience-stress.mjs
$env:QA_EVIDENCE_LABEL='final'
node tools/qa/player-experience-operations-baseline.mjs
node tools/qa/player-experience-checkout-baseline.mjs
node tools/qa/player-experience-performance.mjs
$env:QA_LOOP='final-acceptance'
$env:QA_VIDEO='1'
node tools/qa/player-experience-visual-loop.mjs
npm test
```

The performance acceptance file compares against the separately captured paired baseline report. To repeat that exact A/B, serve commit `c540a96` on a second port and run the performance harness once with `QA_PERF_LABEL=paired-baseline`, then run the polished build with `QA_COMPARE_WITH` pointing at that report.
