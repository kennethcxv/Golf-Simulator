# Golf Flipper Agent Instructions

## Product Direction

Golf Flipper is a polished first-person golf-club restoration and management simulator.

Visual and interaction benchmarks:
- TCG Card Shop Simulator
- House Flipper
- Supermarket Simulator

These are quality references only. Do not copy their assets, UI, branding, code, or exact screen layouts.

## Current Priority

The cash-register experience is the only major production priority until it is accepted.

Do not begin unrelated economy, course, employee, expansion, or property systems while checkout remains unfinished.

## Required Workflow

1. Inspect the repository and relevant references.
2. Capture the current in-game baseline.
3. Make a narrowly scoped plan.
4. Preserve working transaction and save logic.
5. Build assets through Blender MCP or repeatable Blender Python scripts.
6. Integrate assets into the actual game.
7. Test through normal gameplay with Playwright.
8. Capture screenshots and video.
9. Identify visible weaknesses.
10. Revise repeatedly.
11. Run all tests.
12. Commit only stable increments.

## Completion Rules

Do not claim completion merely because:
- Code compiles
- Tests pass
- A Blender model exists
- A state machine advances
- One screenshot looks improved

A feature is complete only when:
- It works through normal controls
- It looks correct from the player camera
- Assets, materials, animations, UI, sound, and feedback are present
- Save/load is safe
- Performance remains acceptable
- Screenshots and recorded gameplay demonstrate the result

## Blender Rules

- Never overwrite raw Tripo assets.
- Use believable real-world dimensions.
- Apply transforms before export.
- Use correct pivots for every moving part.
- Create simplified collision meshes.
- Keep moving components separate.
- Use clean names and hierarchies.
- Export GLB files into the existing asset pipeline.
- Verify every asset inside the game, not only in Blender.

## Asset Licensing

Do not download Poly Haven, Sketchfab, generated, or third-party assets without explicit approval.
Record the source and license of every external asset.

## Visual Direction

Use:
- Warm cream
- Deep golf green
- Muted sage
- Medium walnut
- Natural oak
- Warm charcoal
- Restrained brass

Use stylized PBR materials.
Avoid photorealism, flat primitives, excessive micro-detail, and inconsistent asset styles.

## Quality Assurance

Every visual task requires:
- Before screenshots
- Functional QA
- Visual QA
- Console-error check
- Performance comparison
- After screenshots

## Imagegen

Use the preinstalled Imagegen skill for original UI icon concepts, product-package designs, fictional brand labels, register-screen mockups, posters, paintings, and Blender reference images.

Do not use Imagegen as a replacement for actual 3D geometry. Use it for visual references, texture source material, UI assets, and packaging artwork. Then have Blender build the physical model.
