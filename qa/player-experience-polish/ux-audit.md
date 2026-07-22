# Full UX Audit

This is the live audit ledger for the player-experience branch. “Captured” means the mode was reached in the running game and retained as evidence; it does not mean accepted. Every gameplay action below was exercised through normal keyboard or mouse controls; deterministic state setup was used only to make the route repeatable.

| Mode | Baseline state | Evidence | Highest-priority finding |
| --- | --- | --- | --- |
| Main menu | Captured | `baseline/00-main-menu-1440x900.png` | Missing production actions, metadata, identity, and destructive confirmation |
| New game | Captured | `baseline/01-new-game-property-market.png` | Focus escapes the market modal into covered menu controls |
| Continue | Partially exercised | `baseline/baseline-run.json` | Disabled state has misleading visual priority; save metadata and corrupt-save handling are absent |
| Clubhouse | Captured at fixed entrance and checkout cameras | `baseline/04-fixed-camera-entrance-prompt.png`, `05-fixed-camera-checkout.png` | Persistent guidance and view controls overwhelm contextual UI |
| Cleaning | Captured; clutter cleared and vacuum removed 1.404 grime units | `baseline/operations/10-cleaning-clutter-before.png` through `13-cleaning-vacuum-after.png`, `baseline/operations/result.json` | Active vacuum guidance loses priority to a nearby “Old clutter” interaction prompt |
| Placement | Captured; rack moved and rotated through B/E/R/E | `baseline/operations/14-placement-mode.png` through `16-placement-complete.png` | Three instruction layers coexist and stale carrying instructions remain after set-down |
| Laptop | Captured and operated through physical-screen coordinates | `baseline/09-laptop-home.png`, `10-laptop-settings.png` | Global HUD/tutorial duplicate laptop content |
| Delivery | Captured; delivery picked up through normal controls | `baseline/operations/loop-1-pad.png`, `loop-2-cutter.png` | Carried boxes dominate the lower view and unrelated global overlays remain |
| Unboxing | Captured; tape cut and flaps opened through held E | `baseline/operations/loop-2-cutter.png`, `loop-3-open.png`, `baseline/operations/result.json` | Focus reports “Old clutter” while the contextual box cutter is equipped and active |
| Stocking | Captured; six units moved from the opened case to the shelf | `baseline/operations/loop-4-armful.png`, `loop-5-stocked.png`, `baseline/operations/result.json` | Toasts repeat the interaction result while the carried-product model and unrelated guidance compete for the frame |
| Checkout | Card path completed; cash path reached counted change and softlocked before receipt | `baseline/checkout/card/`, `baseline/checkout/cash/`, `baseline/checkout/summary.json` | Static register controls remain wrong through every transaction stage; cash cannot currently make the required $14 change (underlying checkout defect, not redesigned here) |
| Front desk | Captured; Morgan Lee checked in and $32 collected through E | `baseline/operations/17-front-desk-checkin-before.png`, `18-front-desk-checkin-after.png` | Placement mode still owns the lower instruction stack while the desk owns the center prompt; successful check-in exposes contradictory mode state |
| Course | Captured | `baseline/11-course-overview.png` | Duplicate exit guidance and irrelevant clubhouse objective |
| Course editor | Captured | `baseline/12-course-editor.png` | Prototype hierarchy and unclear mode-local exit |
| Course maintenance | Captured; hose raised target moisture by 87.818 | `baseline/operations/19-course-maintenance-hose.png`, `20-course-maintenance-after.png`, `baseline/operations/result.json` | Current maintenance readout competes with stale front-desk, washer, and tool-equip notifications |
| Pause | Captured across Save/Settings/Controls | `baseline/06-pause-save.png` through `08-pause-controls.png` | Gameplay consumes Tab; keyboard navigation is nonfunctional |
| Save/load | UI captured; persistence and failure paths pending | `baseline/06-pause-save.png` | No explicit saving state, recovery, or player-safe failure presentation |
| Error states | Source paths audited; injected storage/action failures pending | `baseline-audit.md` | Storage errors are swallowed or surface only to the console; player-facing recovery is absent |

## Issue categories

| Required category | Baseline evidence |
| --- | --- |
| Unclear objective | Clubhouse objective remains visible and irrelevant in laptop, checkout, overview, and maintenance modes |
| Missing prompt | Cash change offers no denomination/shortfall guidance when exact change cannot be assembled |
| Incorrect prompt | Box cutting and vacuuming can display “Old clutter”; register hint stays at scan/total/drawer regardless of stage; controls describe Space as “Pause” rather than time pause |
| Too much text | Persistent control ribbon, tutorial card, completion notifications, mode hints, and interaction prompt can all appear together |
| Inconsistent controls | Pause blocks keyboard focus; duplicate E rows; checkout card acceptance is mouse clicks rather than the required physical swipe gesture |
| Input ownership bugs | Pause and marketplace lack focus containment; placement state can survive into front-desk interaction |
| Missing exit instruction | Course editor lacks a local exit; return/quit hierarchy in pause is buried |
| Camera transition problem | Dedicated timing/orientation stress audit pending; placement completion baseline leaves the camera intersecting a fixture |
| Unreadable UI | POS text is very small at the player camera; carried goods and placement ghosts obscure large parts of the view |
| Prototype styling | Main-menu placeholder copy and course editor’s saturated, disconnected control islands |
| Debug output | “Working build — placeholder art” is player-facing |
| Missing sound | Save failure, menu error, and corrupt-save feedback have no player-facing audio contract |
| Duplicate sound | Dedicated audio lifecycle/stress pass pending |
| Missing feedback | Save/load failure paths are silent; cash checkout cannot explain why available change is insufficient |
| Accessibility issue | No keyboard pause navigation, reduced motion, global UI scale, invert-Y, bob, or high-contrast controls |
| Resolution issue | 1440×900 captured; low/high/UI-scale matrix pending |

## Ownership boundary

The card transaction can reach receipt, bagging, and customer handoff. The cash transaction cannot progress from counted change to receipt because the available drawer values total $9 against $14 due in the deterministic baseline. That transaction rule and the required physical card-swipe mechanic belong to checkout production, so this branch records them as blockers and limits its changes to prompts, feedback, input containment, and presentation.

See `baseline-audit.md` for the ranked pre-change defect list and exact performance readings.
