# Runtime Rendering and Texture Budget

## Outcome

`H-012`, `H-013`, and `M-008` are resolved. The release scene retains its
materials, lighting, close-up register presentation, and reflective water while
substantially reducing decoded texture memory, full-scene submissions, and
low-value shadow casters.

## Changes

- Added a repeatable Blender 5.1 pipeline that caps embedded images in 28
  derived runtime GLBs at 1024px. All 66 resized images passed a candidate
  re-import comparison for mesh count, triangles, materials, transforms, and
  world bounds before atomic promotion.
- Added the same texture cap to `process_tripo.py`, preventing future rebuilds
  from restoring 4096px atlases. Raw owner-provided `Assets/` files and the
  preserved `vendor/models/clubhouse_ext.glb` remain untouched.
- Changed the directional shadow map from automatic update on every internal
  scene render to one explicit update per composed game frame. GTAO reuses the
  resulting shadow map.
- Kept only silhouette-defining character parts in the sun shadow and removed
  merged shelf stock from the caster list; shelves still cast and stock still
  receives both shadow and GTAO contact definition.
- Prevented reflective water from recursively rendering color during GTAO's
  material-override pass. When the player is indoors, its reflection target is
  reused until meaningful camera motion or a 0.5-second refresh, so water seen
  through a window remains present without rendering an occluded course every
  frame.

## Measured result

Same 1600x900 Chrome route, relaxed seed 424242, 14:00 lighting, fully stocked
shop, twelve-character crowd, and two-item active card order:

| View | Metric | Before | Final | Change |
|---|---|---:|---:|---:|
| Idle clubhouse | Unique decoded image estimate | 6054.5 MiB | 454.5 MiB | -92.5% |
| Idle clubhouse | Draw calls | 4938.5 | 2642.3 | -46.5% |
| Idle clubhouse | Triangles submitted | 5,684,119 | 3,868,819 | -31.9% |
| Idle clubhouse | Average CPU render | 20.06 ms | 8.48 ms | -57.7% |
| Idle clubhouse | Average FPS | 48.30 | 108.55 | +124.7% |
| Twelve-character crowd | Draw calls | 5629 | 3048.3 | -45.8% |
| Twelve-character crowd | Shadow casters | 593 | 417 | -29.7% |
| Active checkout | Draw calls | 4554 | 3265 | -28.3% |
| Active checkout | Triangles submitted | 6,099,754 | 3,766,524 | -38.3% |
| Active checkout | Shadow casters | 663 | 479 | -27.8% |

The 28 derived GLBs occupy 24,477,588 bytes after optimization versus
96,760,196 bytes before (-74.7%). The final 25-transition soak had 0 normal
re-entry failures, 0 listener growth, negative heap growth, a stable renderer
resource plateau, and no runner diagnostics.

## Four visual iterations

1. `iteration-1-performance`: capped the derived atlases. The in-game close-up
   terminal, textured footwear, chairs, and wider clubhouse retained their
   baseline appearance while decoded image memory fell to 454.5 MiB.
2. `iteration-2-shadow-budget`: removed low-value casters and the redundant
   internal shadow update. Active checkout submissions fell, but the unchanged
   idle/crowd counts exposed another multiplier rather than ending the audit.
3. `iteration-3-reflection-budget`: the pass trace identified planar water
   recursively rendering the world in both beauty and GTAO normal passes. The
   budgeted reflection path produced the final render reduction with no visible
   window, lighting, contact-shadow, or character-silhouette regression.
4. `iteration-4-final-card`: a complete normal-control card sale, including an
   intentionally incomplete swipe, physical accepted swipe, receipt, bagging,
   and customer handoff. Revenue reached $66, two units banked, both re-entry
   checks passed, errors remained empty, and a WebM records the route.

## Evidence

- Before: `../shader-diagnostics/performance-control-adjacent/`
- Blender audit: `applied/audit.json`
- Iteration performance results and screenshots: `iteration-1-performance/`,
  `iteration-2-shadow-budget/`, and `iteration-3-reflection-budget/`
- Pass-level diagnosis: `render-pass-diagnostics/result.json`
- Final transaction screenshots, result, and video: `iteration-4-final-card/`
- Final instrumented WebGL boot: `final-shader-diagnostics/result.json`

No third-party asset was added and no source/license record changed.
