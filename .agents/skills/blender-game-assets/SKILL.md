---
name: blender-game-assets
description: Build, revise, export, and integrate production-ready Blender assets for Golf Flipper. Use for any new or modified 3D prop, register component, collision mesh, material, GLB export, or Blender-generated game asset.
---

# Blender Game Assets

## Required workflow

1. Inspect the repository, asset pipeline, nearby assets, player-camera screenshots, design references, and raw sources before modeling.
2. Record real-world target dimensions in meters and model at believable scale.
3. Build every moving or interactive component as a separate, clearly named object in a clean hierarchy.
4. Put each origin and pivot at its physical hinge, slide axis, grip point, or true center of motion. Exercise every moving part.
5. Apply rotation and scale transforms before export while preserving required object-space behavior.
6. Add intentional bevels and suitable smoothed or weighted normals. Avoid razor-sharp manufactured edges and excessive micro-detail.
7. Create clean, non-overlapping UVs with suitable texel density. Verify seams, orientation, padding, and material assignment.
8. Use the Pinehollow palette: warm cream, deep golf green, muted sage, medium walnut, natural oak, warm charcoal, and restrained brass. Use cohesive stylized PBR materials.
9. Build simplified, separately named collision proxies. Keep them convex or simple where practical.
10. Locate the existing GLB destination and naming conventions; export there instead of creating a parallel pipeline.
11. Integrate the GLB into the actual game and test scale, shading, collisions, pivots, interaction, and animation through normal gameplay.
12. Capture player-camera screenshots, compare with references, list visible weaknesses, revise the Blender source, re-export, and retest until correct in context.

## Source protection

- Never overwrite, destructively rename, or edit raw Tripo sources in place. Treat them as immutable inputs.
- Save derived Blender files and exports under distinct, traceable names.
- Do not download external assets without explicit approval. Record the source and license of every approved external asset.

## Completion evidence

Do not claim completion from a Blender viewport alone. Report source and GLB paths, dimensions, moving-part and pivot checks, collision approach, in-game test, screenshots reviewed, revisions, and remaining defects.
