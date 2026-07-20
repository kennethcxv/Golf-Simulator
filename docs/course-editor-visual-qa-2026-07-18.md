# Course Editor Visual QA - 2026-07-18

Final status: **PASS with one non-blocking scale limitation**. The editor is readable and operable from the 1600 x 900 player camera, selected vector features are framed and visibly editable, legal/illegal placement feedback is unambiguous, and all production checkpoints pass through normal controls.

## Protocol

- Headed Chromium 150, 1600 x 900, device scale factor 1.
- Deterministic bootstrap course and fixed dry late-morning lighting.
- Before and after screenshots plus WebM capture on each production pass.
- Normal editor controls for feature selection, dragging, deletion, Undo, object placement and transforms, Save/reload, Playtest, and swing.
- Reference direction reviewed against:
  - `Designs/RefrenceImages/Course/ChatGPT Image Jul 16, 2026, 07_15_15 PM.png`
  - `Designs/RefrenceImages/Course/ChatGPT Image Jul 16, 2026, 07_04_30 PM.png`
- Evaluation priorities: legibility, hierarchy, focus, interaction feedback, player-camera composition, and consistency with the warm golf-green visual language.

The tables below retain at least ten concrete visual defect checks per pass. A resolved entry remains listed in later passes so the iteration history is auditable.

## Iteration 1 - Baseline defect inventory

Evidence: `qa/course_master_final/course-editor-performance-baseline-tools-fixed-driver/`

| # | Visible defect | Evidence/read |
| ---: | --- | --- |
| 1 | The tip card always said to choose a tool, even while a specific tool was active. | Water, Paths, and Objects captures showed stale generic guidance. |
| 2 | Undo, Redo, Save, and Stats were icon-only at the target viewport. | The top bar required icon recognition instead of plain labels. |
| 3 | The selected-hole chip truncated useful identity and length context. | `Hole 5 - Millpond...` consumed space without finishing the information. |
| 4 | Vector handles were thin line crosses that disappeared against fairway and water colors. | Green, water, and path boundary edits lacked a strong grab target. |
| 5 | The selected stream was outlined but remained distant and visually compressed. | The long stream occupied a narrow strip near the top of the frame. |
| 6 | Stream centerline points were difficult to distinguish from the boundary. | Width and reshaping authority were not immediately readable. |
| 7 | The authored bridge was too small and unframed for confident deck/support/rail review. | The bridge capture emphasized the course more than the selected asset. |
| 8 | Long tool content scrolled the entire left column, allowing the tool rail and help to leave view. | Paths and Objects made navigation feel unstable. |
| 9 | A legal object ghost read mainly as a tiny green ground ring. | The Bench silhouette was too subtle at whole-hole aerial scale. |
| 10 | Illegal placement also depended on a small ring, with weak separation from nearby course detail. | Collision state was discoverable but not forceful. |
| 11 | A transformed or copied Bench was difficult to relocate after the operation. | The object was physically correct but visually tiny in the broad camera. |
| 12 | Toasts and the persistent bottom instruction pill competed for the same lower-center attention. | Rapid action feedback added transient visual clutter. |

Decision: fail the visual pass and revise navigation labels, contextual help, left-column layout, handle geometry, feature framing, and object feedback.

## Iteration 2 - Navigation and hierarchy revision

Evidence: `qa/course_master_final/course-editor-performance-visual-iteration-02/`

Changes visible in this pass: named top actions, a complete hole chip, tool-specific tips, and a fixed rail/tip with only the tool body scrolling.

| # | Defect check | Iteration-2 result |
| ---: | --- | --- |
| 1 | Stale generic tip | Resolved; tips now describe the active tool. |
| 2 | Icon-only top actions | Resolved; Undo, Redo, Save, and Stats are named. |
| 3 | Truncated hole identity | Resolved at 1600 x 900. |
| 4 | Tool rail scrolling away | Resolved; the panel body owns scrolling. |
| 5 | Thin green control points | Still too easy to lose over bright turf. |
| 6 | Thin water/stream control points | Still visually subordinate to shoreline lines. |
| 7 | Selected stream framing | Still too distant for immediate manipulation. |
| 8 | Selected bridge framing | Still too broad to judge rails/supports confidently. |
| 9 | Legal placement silhouette | Improved by clearer instruction, but the asset remained smaller than the ring. |
| 10 | Illegal placement state | Red was readable, but the target needed a stronger screen-space cue. |
| 11 | Selected/copied object location | Still difficult to reacquire at whole-hole zoom. |
| 12 | Dense long panels | Functionally stable, but their narrow internal scroll region needed careful visual hierarchy. |

Decision: functional pass, visual revision required. Strengthen screen-space handles and placement markers, then frame selected features around their authored bounds.

## Iteration 3 - Handle and placement-feedback revision

Evidence: `qa/course_master_final/course-editor-performance-visual-iteration-03/`

Changes visible in this pass: bright square control points, stronger selected markers, and thicker legal/illegal placement rings. All six production checkpoints passed. The result JSON was false only because the then-current harness compared a pre-lazy-load geometry baseline with a post-load plateau; both sampled plateaus were individually stable.

| # | Defect check | Iteration-3 result |
| ---: | --- | --- |
| 1 | Green handles blending into turf | Resolved by bright square centers and cross arms. |
| 2 | Stream handles blending into the outline | Resolved at the current camera distance. |
| 3 | Path handles blending into bridge geometry | Improved; endpoint and center handles were now obvious. |
| 4 | Legal placement state | Resolved as an interaction state; the green ring was unmistakable. |
| 5 | Illegal placement state | Resolved as an interaction state; red separated clearly from the course palette. |
| 6 | Selected stream framing | Still broad; much of the screen remained unrelated course. |
| 7 | Selected bridge framing | Still broad enough that rail/support detail was smaller than desired. |
| 8 | Tiny Bench silhouette inside the marker | Still present at whole-hole zoom. |
| 9 | Reacquiring a transformed Bench | Improved feedback, but the physical prop remained easy to miss without zooming. |
| 10 | Long panel lower controls | Still required internal scrolling, though the rail and tip no longer moved. |
| 11 | Boundary-versus-handle hierarchy | Improved, but long stream outlines still dominated their centerline at a distance. |
| 12 | Visual performance verdict | Blocked by the lazy-geometry comparison race, not by a visible or functional regression. |

Decision: keep the stronger markers; add feature-aware camera framing and fix the driver so stable lazy-loaded geometry is measured fairly.

## Iteration 4 - Final focused-feature pass

Evidence: `qa/course_master_final/course-editor-performance-visual-iteration-04-final/`

The selected stream now fills the useful canvas area, its centerline handles read separately from its bank-to-bank boundary, and the authored bridge is framed closely enough to inspect its deck, supports, rails, water clearance, and centerline. All production checkpoints and the corrected performance gate passed.

| # | Defect audit | Final result |
| ---: | --- | --- |
| 1 | Tool-specific guidance becoming stale | Resolved; Water, Paths, Objects, and Select show distinct actionable copy. |
| 2 | Top-action ambiguity | Resolved with persistent labels. |
| 3 | Hole-chip truncation | Resolved; hole, name, par, and yardage are readable. |
| 4 | Tool rail/help disappearing during scroll | Resolved; only tool details scroll. |
| 5 | Green/bunker/water/path handle legibility | Resolved with bright square control points and cross arms. |
| 6 | Stream boundary and centerline ambiguity | Resolved in the focused stream view. |
| 7 | Bridge scale and framing | Resolved in the focused bridge view. |
| 8 | Legal/illegal placement ambiguity | Resolved through thick green/red screen-space rings and matching contextual copy. |
| 9 | Selected feature context being lost after operations | Resolved for vector features through focused bounds and persistent handles. |
| 10 | Playtest entry readability | Resolved; selected tee, ball, HUD, aiming line, minimap, and return control are visible. |
| 11 | Lower-center feedback collision | Acceptable; toast and persistent hint occupy separate vertical bands in final captures. |
| 12 | Physical prop silhouette at whole-hole scale | Non-blocking limitation: the legality ring is clear, but a Bench remains visually tiny until the camera is closer. |

## Final visual acceptance

Accepted:

- Visual hierarchy is stable at 1600 x 900.
- Active tools and transaction controls are named and readable.
- Control points provide obvious draggable targets.
- Selected stream and bridge geometry are presented at reviewable scale.
- Valid and colliding placement states are unambiguous.
- Save/reload and playtest captures preserve the authored result.
- The editor retains the established warm cream, deep green, muted sage, walnut, charcoal, and restrained brass direction.
- No third-party visual assets were introduced.

Non-blocking limitation:

- Small props cannot present a large physical silhouette in a whole-hole aerial camera without misrepresenting their world scale. The editor uses a clear screen-space ring for location and validity; closer views are still needed to inspect the actual Bench mesh.

## Evidence and videos

- Baseline screenshots: `qa/course_master_final/course-editor-performance-baseline-tools-fixed-driver/`
- Iteration 2 screenshots: `qa/course_master_final/course-editor-performance-visual-iteration-02/`
- Iteration 3 screenshots: `qa/course_master_final/course-editor-performance-visual-iteration-03/`
- Final screenshots: `qa/course_master_final/course-editor-performance-visual-iteration-04-final/`
- Final production-action screenshots: `qa/course_master_final/course-editor-performance-action-timings-final/`
- Final visual video: `qa/course-editor-performance/visual-iteration-04-final/video/`
- Final production-action video: `qa/course-editor-performance/action-timings-final/video/`

Representative final captures:

- `05_water-shoreline-and-stream.png` - focused stream, boundary, and centerline handles.
- `06_authored-bridge-path.png` - focused bridge with selected path controls.
- `09_bench-valid-snap-ghost.png` - legal green placement state.
- `10_bench-collision-ghost.png` - illegal red collision state.
- `12_bench-after-save-reload.png` - persisted transformed object.
- `14_selected-middle-tee-playtest.png` - normal selected-tee playtest entry.
