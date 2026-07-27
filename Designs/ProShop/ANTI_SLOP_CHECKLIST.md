# Golf Simulator — Anti-Slop Acceptance Checklist

## Purpose

This checklist is a mandatory acceptance gate for every new or modified:

* Asset
* Material
* Room
* Scene
* Prop layout
* Cleaning tool
* Animation
* Particle effect
* Sound implementation
* Interaction
* Environment change

Nothing is final merely because it runs, exports, loads, or looks acceptable from one camera angle.

Every applicable technical item must pass.

Every applicable visual item must receive human approval.

---

# 1. Acceptance states

Use only these states:

* PASS
* FAIL
* NOT APPLICABLE
* REQUIRES HUMAN REVIEW

Do not use vague states such as:

* Mostly done
* Good enough
* Probably fine
* Nearly final
* Acceptable for now

A failed item blocks final acceptance unless the user explicitly approves an exception.

---

# 2. Required evidence

Every asset or scene submission must include:

* Repository path
* Blender source path
* Runtime-export path
* In-game screenshot
* Reference image or approved specification
* Front view
* Side view
* Rear view when visible
* Interaction view when applicable
* Before-and-after comparison when replacing an existing asset
* Performance measurement when relevant
* Completed checklist
* List of known deviations

No asset may be approved only from a Blender viewport render.

It must be reviewed in the actual game.

---

# 3. General technical gate

## File and naming

* [ ] File uses the approved naming convention.
* [ ] Blender source exists in the approved source directory.
* [ ] Runtime export exists in the approved runtime directory.
* [ ] Source and runtime files are clearly associated.
* [ ] No unexplained duplicate export exists.
* [ ] No obsolete version is loaded at runtime.
* [ ] No temporary file is committed.
* [ ] No hidden placeholder mesh exists.
* [ ] No test object remains in the final scene.
* [ ] No generated QA output is accidentally committed.

## Transforms

* [ ] Object scale is applied.
* [ ] Object rotation is applied where required.
* [ ] Object origin is intentional.
* [ ] Object position is not compensated through arbitrary parent transforms.
* [ ] Runtime transform matches the approved specification.
* [ ] Object does not require unexplained scale correction in code.
* [ ] No negative scale causes shading, collision, or animation problems.

## Geometry

* [ ] Geometry matches approved real-world dimensions.
* [ ] Silhouette is readable from gameplay distance.
* [ ] Geometry density is appropriate for screen size.
* [ ] Hidden faces and unnecessary internal geometry are removed.
* [ ] No duplicate vertices or overlapping faces remain.
* [ ] No non-manifold geometry remains unless explicitly required.
* [ ] No accidental holes exist.
* [ ] No z-fighting exists.
* [ ] No visibly faceted curved surface remains unintentionally.
* [ ] No excessive subdivision exists.
* [ ] Small details are modeled only when they materially improve gameplay readability.
* [ ] Decorative detail does not create unnecessary noise.

## Normals and shading

* [ ] Face normals point correctly.
* [ ] Smoothing is intentional.
* [ ] Hard edges are intentional.
* [ ] Weighted normals or equivalent treatment are used where appropriate.
* [ ] No shading artifacts appear under game lighting.
* [ ] No black faces appear.
* [ ] No visible tangent-space errors appear.
* [ ] Normal-map intensity is controlled and believable.

## Bevels

* [ ] Visible hard-surface edges use the approved bevel language.
* [ ] Bevel width matches object scale.
* [ ] Bevel width is consistent across related asset families.
* [ ] Tiny decorative bevels do not waste geometry.
* [ ] Large structural edges are not razor sharp.
* [ ] Bevels do not distort hinges, drawers, doors, or contact surfaces.
* [ ] Bevel quality is evaluated under actual game lighting.

## UVs

* [ ] UVs contain no unintended overlaps.
* [ ] Texel density matches the approved target within the permitted tolerance.
* [ ] Visible surfaces receive appropriate UV area.
* [ ] Hidden surfaces do not waste texture space.
* [ ] UV seams are placed intentionally.
* [ ] Dirt-mask UVs support required gameplay behavior.
* [ ] No texture stretching is visible.
* [ ] No visible seam appears across a focal surface.
* [ ] Lightmap UVs are valid if used.

## Materials

* [ ] Asset uses only approved material families.
* [ ] Material count is justified.
* [ ] No unnecessary one-off material exists.
* [ ] Base color is within the approved range.
* [ ] Roughness is within the approved range.
* [ ] Metalness is physically plausible.
* [ ] Glass is not treated as generic transparent plastic.
* [ ] Wood grain scale is believable.
* [ ] Metal does not look like plastic.
* [ ] Plastic does not look like polished metal.
* [ ] Dirt is separated from the clean base material where required.
* [ ] Material response matches related assets.
* [ ] No material exists solely to hide poor geometry.
* [ ] No unrelated texture style is introduced.

## Textures

* [ ] Texture resolution follows the art bible.
* [ ] Texture resolution matches the asset’s screen importance.
* [ ] No oversized texture is used unnecessarily.
* [ ] No visibly compressed focal texture remains.
* [ ] Color space is correct.
* [ ] Normal maps use the correct format.
* [ ] Roughness and metalness channels are interpreted correctly.
* [ ] Mipmapping behaves correctly.
* [ ] Texture tiling is not visibly repetitive.
* [ ] Wear and damage are authored intentionally.
* [ ] No AI-generated artifacts, warped details, fake text, or incoherent patterns remain.
* [ ] Labels and signs use readable, deliberate typography.

## Pivots and moving parts

* [ ] Main pivot matches the approved location.
* [ ] Door pivot is located at the hinge.
* [ ] Drawer pivot or translation axis is correct.
* [ ] Lid pivot is physically plausible.
* [ ] Moving parts do not intersect surrounding geometry.
* [ ] Opening direction is correct.
* [ ] Maximum opening range is physically plausible.
* [ ] Handles align with the player interaction point.
* [ ] Animation does not expose missing internal geometry.
* [ ] Moving parts return to a stable resting state.

## Collision

* [ ] Collision exists where required.
* [ ] Collision is absent where it would block valid movement.
* [ ] Collision shape matches the gameplay silhouette.
* [ ] Collision is not unnecessarily complex.
* [ ] Player cannot walk through visible solid surfaces.
* [ ] Player does not snag on decorative details.
* [ ] Held objects do not clip through the asset during normal use.
* [ ] Doors and drawers have collision states appropriate to open and closed positions.
* [ ] Customer navigation is not blocked by decorative collision.
* [ ] Placement systems recognize the intended footprint.

## Export

* [ ] Export uses the approved axis convention.
* [ ] Export uses the approved unit scale.
* [ ] Export includes only intended objects.
* [ ] Export excludes cameras and lights unless required.
* [ ] Export preserves required animation.
* [ ] Export preserves required material slots.
* [ ] Export does not include hidden source geometry.
* [ ] Export has been validated by the repository’s asset-validation tools.
* [ ] Runtime loads the expected export.
* [ ] Runtime console contains no related errors or warnings.

---

# 4. Visual art-direction gate

These items require human visual judgment.

An agent may prepare evidence but may not grant final visual approval.

## Silhouette and form

* [ ] Object silhouette is intentional and recognizable.
* [ ] Proportions look designed rather than generated.
* [ ] Construction appears physically understandable.
* [ ] The asset does not look like stacked primitives without refinement.
* [ ] Detail hierarchy is clear.
* [ ] Major forms read before minor details.
* [ ] The asset does not rely on random detail to appear finished.
* [ ] The asset looks appropriate for a municipal golf clubhouse.
* [ ] The asset matches the approved stylized-PBR direction.
* [ ] The asset does not look imported from an unrelated game.

## Scale and placement

* [ ] Asset appears correctly scaled beside the player.
* [ ] Asset appears correctly scaled beside doors, counters, and furniture.
* [ ] Handles, seats, screens, and controls are at believable heights.
* [ ] Merchandise fits realistically on shelves.
* [ ] Asset is grounded on the floor or mounting surface.
* [ ] No visible floating exists.
* [ ] No visible sinking exists.
* [ ] Placement has a clear functional purpose.
* [ ] Asset does not create accidental dead space.
* [ ] Asset does not block important sightlines.

## Composition

* [ ] Asset supports the room’s focal hierarchy.
* [ ] Checkout remains visually obvious.
* [ ] Laptop station remains discoverable.
* [ ] Merchandise layout is understandable.
* [ ] Cleaning route is readable.
* [ ] Customer route is readable.
* [ ] Clutter is authored rather than random.
* [ ] Empty space is intentional.
* [ ] Repetition is controlled.
* [ ] Prop density supports gameplay.
* [ ] No scene area appears accidentally unfinished.
* [ ] No decorative object competes with the primary interaction.

## Cohesion

* [ ] Asset matches the approved palette.
* [ ] Bevel language matches nearby assets.
* [ ] Material response matches nearby assets.
* [ ] Wear level matches the room state.
* [ ] Restored assets look related to neglected versions.
* [ ] Wood species and grain direction are coherent.
* [ ] Metal finishes are consistent.
* [ ] Visual complexity matches neighboring assets.
* [ ] Asset belongs to the same production universe as the room.
* [ ] No asset appears noticeably more realistic or more primitive than the rest.

## Anti-AI-slop review

* [ ] No arbitrary mechanical detail exists.
* [ ] No fake text or unreadable label exists.
* [ ] No warped logo or symbol exists.
* [ ] No meaningless groove, vent, bolt, panel, or seam exists.
* [ ] No random material assignment exists.
* [ ] No unexplained asymmetry exists.
* [ ] No physically impossible construction exists.
* [ ] No unrelated decorative style exists.
* [ ] No detail was added merely to make the asset appear complex.
* [ ] No generic “generated furniture” silhouette remains.
* [ ] No strange proportions remain.
* [ ] No obvious reference mismatch remains.
* [ ] No major defect is hidden through camera placement.
* [ ] Side-by-side comparison clearly improves on the replaced asset.

---

# 5. Room and architecture gate

## Room shell

* [ ] Room dimensions are documented.
* [ ] Ceiling height is believable.
* [ ] Door dimensions are believable.
* [ ] Window dimensions are believable.
* [ ] Wall thickness is believable.
* [ ] Floor and ceiling meet walls cleanly.
* [ ] No light leaks exist.
* [ ] No visible wall gaps exist.
* [ ] No exterior void is visible through geometry.
* [ ] Trim is consistently applied.
* [ ] Architectural style is coherent.
* [ ] Architecture supports gameplay routes.

## Layout

* [ ] Entrance sightline is intentional.
* [ ] Checkout is a clear focal point.
* [ ] Laptop is visible or naturally discoverable.
* [ ] Player can move comfortably.
* [ ] Customer can move comfortably.
* [ ] Cleaning route is not obstructed.
* [ ] Product displays have believable spacing.
* [ ] Behind-counter space is usable.
* [ ] No interaction is blocked by furniture.
* [ ] No major area is purposeless.
* [ ] No room section is filled only to avoid emptiness.
* [ ] Scene remains readable from normal gameplay FOV.

## Environmental storytelling

* [ ] Neglect has a believable cause.
* [ ] Dirt placement follows traffic and use.
* [ ] Dust accumulates in believable locations.
* [ ] Damage is restrained.
* [ ] Clutter communicates former use.
* [ ] Objects are not scattered randomly.
* [ ] Restored state visibly improves the same room.
* [ ] Restored state does not erase all character.
* [ ] Before-and-after difference is immediately readable.
* [ ] Storytelling props do not obstruct gameplay.

---

# 6. Material and lighting gate

## Lighting

* [ ] Exposure is consistent.
* [ ] White balance is consistent.
* [ ] Primary light direction is understandable.
* [ ] Ambient fill keeps interaction zones readable.
* [ ] Contact shadows ground assets.
* [ ] Corners are readable without becoming flat.
* [ ] Checkout remains visually emphasized.
* [ ] Laptop screen remains readable.
* [ ] Merchandise remains readable.
* [ ] No asset is accepted only because dramatic darkness hides defects.
* [ ] No major light leak exists.
* [ ] No distracting flicker exists.
* [ ] Shadow resolution is appropriate.
* [ ] Lighting performs within the approved budget.

## Post-processing

* [ ] Color space is correct.
* [ ] Tonemapping is consistent.
* [ ] Ambient occlusion is restrained.
* [ ] Vignette is subtle or absent.
* [ ] Color grade supports the approved palette.
* [ ] Bloom is restrained.
* [ ] Highlights are not clipped unnecessarily.
* [ ] Dark areas retain usable detail.
* [ ] Post-processing does not hide weak materials.
* [ ] The same grade is used across benchmark comparison shots.

## Neglected and restored states

* [ ] Neglected state looks dirty rather than visually broken.
* [ ] Restored state appears cleaner and more organized.
* [ ] Material identities remain consistent between states.
* [ ] Restoration does not unexpectedly replace unrelated materials.
* [ ] Dirt removal reveals believable clean surfaces.
* [ ] Lighting change does not falsely create the entire transformation.
* [ ] Before-and-after transformation is visible under identical camera conditions.

---

# 7. Cleaning-tool gate

## Tool model

* [ ] Tool dimensions are believable.
* [ ] First-person scale is believable.
* [ ] Grip location is plausible.
* [ ] Contact edge is clearly defined.
* [ ] Pivot supports intended movement.
* [ ] Tool does not block excessive screen space.
* [ ] Tool remains readable against common surfaces.
* [ ] Tool materials match the art bible.
* [ ] Tool model does not include floating hands.
* [ ] Tool does not intersect the camera during normal use.

## Equip and idle

* [ ] Equip uses eased movement.
* [ ] Unequip uses eased movement.
* [ ] Equip has clear anticipation and settling.
* [ ] Tool does not snap into position.
* [ ] Idle sway is restrained.
* [ ] Idle motion does not cause nausea.
* [ ] Walking bob responds to player movement.
* [ ] Tool returns smoothly to idle.
* [ ] Animation timing values are configurable.

## Surface contact

* [ ] Tool visibly touches the surface.
* [ ] Contact alignment responds to surface normal.
* [ ] Tool does not hover.
* [ ] Tool does not sink deeply into the surface.
* [ ] Tool does not pass through walls or floors during normal use.
* [ ] Contact point matches particle origin.
* [ ] Contact point matches cleaning effect.
* [ ] Contact point matches audio behavior.
* [ ] Contact remains stable on uneven surfaces.
* [ ] Tool reacts when contact is lost.

## Motion and weight

* [ ] Motion has anticipation.
* [ ] Motion has follow-through.
* [ ] Motion has recovery.
* [ ] Direction changes do not look instantaneous.
* [ ] Tool exhibits believable inertia.
* [ ] Repetition does not look mechanically identical.
* [ ] Variation does not break responsiveness.
* [ ] Camera response remains restrained.
* [ ] Tool motion communicates weight without slowing input excessively.

## Dirt response

* [ ] Dirt changes immediately after valid contact.
* [ ] Dirt removal occurs at the visible contact location.
* [ ] Dirt radius matches the tool width.
* [ ] Dirt does not disappear far from the tool.
* [ ] Dirt does not lag behind the animation.
* [ ] Cleaned areas remain cleaned after leaving the surface.
* [ ] Cleaning progress survives save and reload.
* [ ] No visible square or grid artifact appears.
* [ ] Partial cleaning appears smooth and readable.
* [ ] Completed cleaning state is clear.

## Particles

* [ ] Particles originate at contact.
* [ ] Particle direction follows tool motion or surface normal.
* [ ] Particle amount reflects interaction intensity.
* [ ] Particle color matches surface material.
* [ ] Particles do not pass obviously through the tool.
* [ ] Particles stop when contact stops.
* [ ] Particles do not continue after unequip.
* [ ] Particle count stays within performance budget.
* [ ] Particles support feedback rather than obscure the surface.

## Audio

* [ ] Equip sound exists where appropriate.
* [ ] Start transient exists.
* [ ] Use loop exists.
* [ ] Stop tail exists.
* [ ] Loop does not click at boundaries.
* [ ] Sound varies without becoming random.
* [ ] Surface material affects sound where appropriate.
* [ ] Sound intensity corresponds to contact.
* [ ] Sound stops when contact stops.
* [ ] Audio timing matches visible animation.
* [ ] Audio level is balanced against the room.
* [ ] No placeholder sound remains.

## Feel and responsiveness

* [ ] Input produces immediate visible response.
* [ ] Tool does not feel detached from the cursor or camera.
* [ ] Interaction does not continue after input release.
* [ ] Tool does not become stuck between states.
* [ ] State transitions are reliable under rapid input.
* [ ] Tool survives repeated equip and unequip.
* [ ] Tool survives save and reload where applicable.
* [ ] Interaction remains stable during movement.
* [ ] Interaction remains stable near walls and corners.
* [ ] A human reviewer approves the overall feel.

---

# 8. Checkout and laptop integration gate

## Checkout

* [ ] Existing transaction logic remains functional.
* [ ] Checkout counter aligns with interaction positions.
* [ ] Register scale is believable.
* [ ] Scanner position is believable.
* [ ] Card reader position is believable.
* [ ] Cash drawer opens correctly.
* [ ] Bills and coins align correctly.
* [ ] Products fit on the counter.
* [ ] Customer stands in the correct location.
* [ ] Player camera frames the interaction clearly.
* [ ] No clipping occurs during normal checkout.
* [ ] Receipt presentation remains readable.
* [ ] Existing cash flow still works.
* [ ] Existing card flow still works.
* [ ] No workflow was changed solely for visual convenience.

## Laptop

* [ ] Existing laptop functionality remains intact.
* [ ] Laptop faces the correct direction.
* [ ] Screen is readable.
* [ ] Chair does not disappear.
* [ ] Desk height is believable.
* [ ] Laptop position is reachable.
* [ ] Camera transition is centered.
* [ ] Player exits reliably.
* [ ] Laptop does not clip through furniture.
* [ ] No visual redesign breaks the UI.
* [ ] Save and reload preserve laptop-related state.

---

# 9. NPC and route gate

* [ ] Customer enters successfully.
* [ ] Customer can reach the checkout.
* [ ] Customer does not intersect furniture.
* [ ] Customer does not walk through doors.
* [ ] Customer does not become trapped.
* [ ] Customer waiting position is believable.
* [ ] Customer orientation at checkout is correct.
* [ ] Customer exits successfully.
* [ ] Player can move around the customer.
* [ ] Cleaning props do not block navigation.
* [ ] Route remains valid in neglected and restored states.
* [ ] Route survives save and reload.
* [ ] Route is tested repeatedly, not only once.

---

# 10. Performance gate

The exact budgets must be defined from the Phase 0 baseline.

Until exact budgets are approved:

* [ ] Average frame time is measured.
* [ ] FPS is measured.
* [ ] 1% low FPS is measured if tooling supports it.
* [ ] Draw calls are measured if tooling supports it.
* [ ] Triangle count is measured if tooling supports it.
* [ ] Texture memory is measured if tooling supports it.
* [ ] Scene load time is measured.
* [ ] Interaction stutters are documented.
* [ ] No unapproved frame-time regression exceeds 10%.
* [ ] Target 60 FPS is sustained under the approved test configuration.
* [ ] No new recurring stutter exists.
* [ ] Cleaning feedback remains immediate.
* [ ] No unnecessary material instances exist.
* [ ] No oversized texture is introduced without justification.
* [ ] No decorative geometry creates measurable harm without visible benefit.
* [ ] Old and new benchmark measurements are shown together.

Unavailable measurements must be marked unavailable.

They must not be invented.

---

# 11. Comparison gate

Every replacement must be compared against the current implementation.

Required:

* [ ] Same camera position
* [ ] Same field of view
* [ ] Same resolution
* [ ] Same scene state
* [ ] Same time of day
* [ ] Same exposure where applicable
* [ ] Old screenshot
* [ ] New screenshot
* [ ] Old performance data
* [ ] New performance data
* [ ] Known tradeoffs listed
* [ ] Human reviewer confirms the new version is clearly better

A different camera angle may not be used to hide weaknesses.

---

# 12. Final approval gate

The benchmark cannot be declared complete until:

* [ ] All applicable technical items pass.
* [ ] All blocking failures are resolved.
* [ ] All deviations are documented.
* [ ] Room composition receives human approval.
* [ ] Hero assets receive human approval.
* [ ] Materials receive human approval.
* [ ] Lighting receives human approval.
* [ ] Cleaning tool receives human approval.
* [ ] Checkout integration passes.
* [ ] Laptop integration passes.
* [ ] Customer route passes.
* [ ] Save and reload pass.
* [ ] Performance remains within budget.
* [ ] Old and new versions are compared directly.
* [ ] The user explicitly approves the benchmark.

The agent must not self-approve the final visual result.

The agent must stop and request human judgment at every required visual-review gate.
