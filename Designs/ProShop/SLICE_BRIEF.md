# Golf Simulator — Starter Pro Shop Vertical Slice Brief

## Document purpose

This document is the permanent source of truth for rebuilding the starter clubhouse and pro shop into the visual and interaction-quality benchmark for Golf Simulator.

This file is a roadmap, not authorization to execute multiple phases.

A phase may only be executed when the user explicitly names that phase.

When instructed to execute a phase:

1. Read this document in full.
2. Execute only the named phase.
3. Do not begin the following phase.
4. Stop at every required visual-review gate.
5. Report what changed, what was measured, and what requires human approval.

---

# 1. Project reality

Golf Simulator is not a new prototype.

The project already contains substantial working or usable gameplay logic, including:

* Golf course view and course systems
* Course editor
* Laptop and business-management functionality
* Cashier and checkout flow
* Inventory systems
* Delivery foundations
* Cleaning-system foundations
* Interaction architecture
* Save and progression foundations
* Customer and NPC foundations
* Asset-loading architecture
* Existing tests and QA tooling

The primary weakness is not the absence of gameplay logic.

The primary weakness is that much of the visible game does not match the quality of the systems underneath it.

Current player-facing problems include:

* Inconsistent and weak 3D assets
* Generic or visibly generated-looking furniture
* Poor environmental composition
* Incorrect or inconsistent scale
* Weak proportions and silhouettes
* Mismatched materials
* Flat or incoherent lighting
* Arbitrary clutter
* Empty or poorly framed spaces
* Weak first-person tool presentation
* Cleaning tools that function but feel weightless
* Poor tool-to-surface alignment
* Weak animation timing
* Weak sound and particle feedback
* Visual inconsistency between systems
* Assets that appear imported from unrelated styles
* Interactions that function technically but do not feel satisfying

---

# 2. Core strategy

The project must be separated into two layers.

## 2.1 Preserve working logic

Preserve existing logic unless repository inspection or testing proves that it is defective.

Systems that should default to preservation include:

* Golf course logic
* Course editor logic
* Laptop functionality
* Checkout transaction logic
* Cash and card flow
* Inventory logic
* Delivery logic
* Save and progression data
* Economy logic
* Customer-state logic
* Interaction interfaces
* Existing tests that verify correct behavior

Working logic must not be rewritten merely because the surrounding visuals are weak.

## 2.2 Rebuild the visible clubhouse presentation

The starter clubhouse and pro shop may be rebuilt visually from first principles.

Areas eligible for full visual replacement include:

* Clubhouse room shell
* Interior layout
* Architecture
* Furniture
* Checkout-counter presentation
* Laptop-station presentation
* Product-display fixtures
* Cleaning-tool models
* Cleaning-tool animations
* Materials
* Lighting
* Prop placement
* Dirt presentation
* Surface feedback
* Particles
* Environmental storytelling
* Visual hierarchy
* First-person tool framing
* Room composition

Existing assets may only survive if they clearly meet the new quality standard.

Convenience is not sufficient reason to preserve a weak asset.

---

# 3. Vertical-slice objective

Create one commercial-quality benchmark room inside the starter clubhouse.

The slice must demonstrate that the existing gameplay systems can be presented at a cohesive, professional standard.

The benchmark must contain:

* One intentionally designed starter pro-shop room
* One checkout station connected to existing checkout logic
* One laptop station connected to existing laptop logic
* One small merchandise area
* One neglected starting state
* One restored state
* One completely polished cleaning tool
* One short customer checkout sequence
* Save and reload support
* Stable performance
* Direct comparison with the old implementation

The benchmark is not the entire game.

It exists to establish a repeatable production standard for later rooms, tools, and properties.

---

# 4. Scope boundaries

## In scope

* Starter clubhouse pro shop
* Room shell and architecture
* Checkout visual integration
* Laptop visual integration
* Limited merchandise presentation
* One cleaning tool
* Dirt and cleaning feedback
* Materials
* Lighting
* Sound relevant to the selected tool
* One customer route
* Save and reload for the benchmark room
* Performance measurement
* A/B comparison with the old room

## Out of scope

* Rebuilding the golf course
* Rebuilding the course editor
* Rebuilding laptop functionality
* Rebuilding checkout transaction logic
* Rebuilding the economy
* Rebuilding inventory architecture
* Building the full clubhouse
* Building multiple cleaning tools at once
* Creating all merchandise assets
* Adding new gameplay systems
* Adding employees
* Adding tournaments
* Building later golf properties
* Replacing all project materials globally
* Rewriting systems for stylistic reasons
* Expanding beyond the starter pro shop

---

# 5. Quality target

The target is not photorealism.

The target is not uncontrolled “AAA” complexity.

The target is:

**A cohesive, commercially presentable indie simulator with intentional stylized PBR assets, believable scale, satisfying physical interaction, strong visual hierarchy, and stable performance.**

Reference principles include:

* TCG Card Shop Simulator: retail readability and layout clarity
* Supermarket Simulator: understandable physical business interactions
* House Flipper: visible before-and-after transformation
* PowerWash Simulator: immediate and satisfying surface response

These games are references for clarity and cohesion only.

Do not copy their assets or layouts.

---

# 6. Approved visual direction

The starter clubhouse is a failing municipal golf clubhouse with believable history and visible restoration potential.

The neglected version should feel worn, outdated, and poorly maintained, but still intentionally designed.

The restored version should feel clean, organized, warm, and professional without appearing luxurious.

## Approved palette

* Warm cream
* Medium walnut
* Dark walnut
* Deep green
* Sage green
* Charcoal
* Black powder-coated metal
* Muted brass
* Warm neutral lighting

## Approved visual principles

* Stylized PBR
* Realistic scale
* Clear silhouettes
* Soft, consistent bevels
* Limited shared material library
* Controlled surface wear
* Authored clutter
* Grounded architecture
* Strong contact shadows
* Readable interaction zones
* Clear focal hierarchy
* Restrained detail
* Consistent proportions
* Clean restored-state contrast

## Prohibited visual tendencies

* Random color palettes
* Excessive material variety
* Unrelated asset styles
* Arbitrary clutter
* Flat primitive furniture
* Overly detailed generated surfaces
* Meaningless mechanical details
* Incorrect proportions
* Oversized fixtures
* Floating props
* Repetitive copied layouts
* Uncontrolled grime
* Randomized wear
* Inconsistent bevels
* Glossy materials without justification
* Dark corners that hide gameplay
* Decorative objects with no compositional purpose

---

# 7. Planned player experience

The target player sequence is:

1. Enter the neglected starter pro shop.
2. Immediately understand the room layout.
3. Notice the dirty floor and neglected fixtures.
4. Equip the selected cleaning tool.
5. Clean a short, clearly defined route.
6. Receive immediate visual and audio feedback.
7. Reveal the improved material beneath the dirt.
8. Restore or activate the checkout area.
9. Access the existing laptop station.
10. Stock a limited number of products.
11. Serve one customer using the existing checkout logic.
12. Complete the sequence.
13. Save and reload with the room state preserved.

The slice should feel cohesive rather than like disconnected technical demonstrations.

---

# 8. Room-design requirements

The new benchmark room must be authored as a separate implementation alongside the current clubhouse.

Do not immediately delete or overwrite the existing clubhouse.

The new room must support direct A/B comparison.

The room must include:

* Clear entrance
* Checkout focal point
* Laptop workstation
* Main merchandise wall
* Freestanding display
* Clothing, hat, club, or bag display
* Cleaning-tool station
* Customer route
* Player circulation
* Cleaning route
* Storage or back-of-counter logic where necessary
* Strong entrance sightline
* Clear before-and-after transformation

The room must not include:

* Arbitrary empty space
* Narrow accidental routes
* Random clutter
* Excessive furniture
* Fixtures without gameplay purpose
* Poorly visible checkout
* Laptop hidden from the player
* Products placed without retail logic
* Doors or drawers that cannot physically operate

---

# 9. Hero-asset plan

The benchmark slice may contain no more than eight new hero assets.

Each hero asset must be developed in its own review cycle.

Recommended order:

1. Checkout counter
2. Cash-register assembly
3. Laptop workstation
4. Main wall shelving
5. Freestanding merchandise fixture
6. Clothing or hat display
7. Golf bag or club display
8. Cleaning-tool station

One asset must be completed, integrated, rendered, tested, and approved before beginning the next asset.

Each asset requires:

* Written specification
* Approved dimensions
* Reference images or design sketch
* Blender source
* Runtime export
* Correct materials
* Correct pivot
* Correct collision
* Correct interaction geometry
* In-game screenshot
* Comparison against the replaced asset
* Technical checklist pass
* Human visual approval

---

# 10. Cleaning-tool benchmark

Only one cleaning tool will be polished during the benchmark phase.

Default selected tool:

**Broom**

Another tool may be selected only if repository inspection proves that the broom is unsuitable for the first benchmark.

The selected tool must include:

* Correct first-person scale
* Correct pivot
* Clear contact edge
* Equip animation
* Unequip animation
* Idle sway
* Movement bob
* Start-use transition
* Use loop
* Stop-use transition
* Recovery
* Surface-aware alignment
* Visible weight
* Inertia
* Immediate dirt response
* Surface-specific particles
* Layered sound
* Restrained camera response
* Configurable feel values
* No visible floating hands
* No gap between tool and surface

The tool must feel physically connected to the world.

It must not appear to play an animation near the surface.

---

# 11. Material strategy

Create a limited shared material library for the benchmark slice only.

Do not replace all materials across the entire project.

Approved material families may include:

* Painted wall
* Walnut
* Secondary wood
* Powder-coated metal
* Brushed steel
* Muted brass
* Clear glass
* Frosted glass
* Rubber
* Retail plastic
* Upholstery
* Tile
* Carpet
* Concrete
* Dust
* Dirt
* Mud
* Water staining

Every material must define:

* Base-color range
* Roughness range
* Metalness
* Normal intensity
* Texture resolution
* Permitted usage
* Prohibited usage
* Neglected-state treatment
* Restored-state treatment

One-off materials are prohibited unless explicitly documented and approved.

---

# 12. Lighting strategy

The room must use one coherent lighting setup.

Required qualities:

* Warm primary lighting
* Readable ambient fill
* Strong but controlled contact shadows
* Consistent exposure
* Correct color space
* Consistent tonemapping
* Restrained ambient occlusion
* Subtle color grading
* Readable corners
* Clear product silhouettes
* Clear neglected-versus-restored contrast

Lighting must not hide weak geometry or weak composition.

Lighting must support gameplay readability first.

---

# 13. Performance principles

Performance targets must be established from Phase 0 measurements.

Until those measurements exist, use these rules:

* No unapproved regression greater than 10% from baseline frame time
* Target sustained 60 FPS at the documented test configuration
* No recurring interaction stutters
* Cleaning feedback visible immediately or by the next rendered frame
* No new unnecessary material duplication
* No unnecessary unique textures
* No avoidable shader variants
* No unnecessary high-poly hidden geometry
* No decorative complexity that harms performance
* Load-time changes must be measured

Exact budgets for draw calls, triangles, textures, and loading must be defined after the baseline is captured.

---

# 14. Development phases

## Phase 0 — Baseline capture

Capture the current implementation before changing anything.

Required deliverables:

* Baseline Git tag
* Fixed screenshot positions
* Existing-room screenshots
* Existing broom footage
* Existing checkout footage
* Existing laptop footage
* Current frame time
* Current FPS
* Draw calls if available
* Load time if available
* Integration map
* A/B scene plan

No redesign or implementation is allowed during Phase 0.

## Phase 1 — Bounded reality check

Inspect only the systems required by the benchmark slice.

Classify each as:

* PRESERVE
* PRESERVE LOGIC, REPLACE PRESENTATION
* MINOR LOGIC FIX REQUIRED
* REBUILD ONLY IF PROVEN BROKEN

Systems to inspect:

* Starter clubhouse construction
* Cleaning logic
* Broom logic
* Dirt state
* Checkout integration
* Laptop integration
* Customer route
* Save and reload
* Asset loading
* Materials
* Lighting
* Performance tooling

Do not audit unrelated game systems.

## Phase 2 — Art bible and anti-slop standard

Create:

* `Designs/ProShop/ART_BIBLE.md`
* `Designs/ProShop/ANTI_SLOP_CHECKLIST.md`

Define:

* Unit scale
* Dimensions
* Bevel language
* Polygon targets
* Texel density
* Texture limits
* Material values
* Roughness ranges
* Metalness rules
* Wear conventions
* Dirt conventions
* Pivot rules
* Collision rules
* LOD rules
* Lighting
* Exposure
* Tonemapping
* Shadows
* Color grading

No room implementation is allowed until this phase is reviewed.

## Phase 3 — Separate-room greybox

Build the new benchmark room alongside the old room.

Do not delete the old room.

Develop:

* Room dimensions
* Entrance
* Checkout placement
* Laptop placement
* Merchandise layout
* Cleaning route
* Customer route
* Sightlines
* Focal points
* Player circulation

Use greybox geometry only.

Stop for visual approval before detailed assets are created.

## Phase 4 — Materials and lighting

> **Swapped with hero assets on 2026-07-27.** Materials and lighting now come first.
>
> Reason: the lighting spike established that a shadow-casting interior light is still an
> open question (`ART_BIBLE.md` §3), and that assets read materially differently once
> directional light and contact occlusion exist. Authoring eight hero assets under lighting
> that is about to change means approving each of them twice — once under provisional
> lighting and again after it settles. Doing lighting first means every hero asset is judged
> once, under final conditions.
>
> Consequence for the art bible: it deliberately carries **no** final exposure value, no
> contrast target and no shadow-softness spec, because those are outputs of this phase
> rather than inputs to it.

Apply the approved slice material library.

Implement the approved lighting setup — including resolving the interior key-light
question, gated to the ceiling power state and the panel fault states.

Capture identical before-and-after camera views.

Measure performance before and after, using the confidence-interval protocol in
`Baseline/BASELINE_PERFORMANCE.md` §8. Do not adopt a budget the harness cannot measure.

## Phase 5 — Hero assets

Build one hero asset per session, under the lighting approved in Phase 4.

Each asset must pass:

* Technical review
* In-game review
* Side-by-side comparison against the anchors in `ART_BIBLE.md` §1
* Human approval

Do not batch all eight assets.

## Phase 6 — One polished cleaning tool

Polish the selected tool from end to end.

Do not begin another cleaning tool.

Required comparison:

* Old interaction footage
* New interaction footage
* Timing values
* Particle behavior
* Sound behavior
* Surface alignment
* Dirt-response timing
* Performance impact

## Phase 7 — Existing-system integration

Connect the new room to:

* Existing checkout
* Existing laptop
* Existing inventory
* Existing customer flow
* Existing save and reload

Modify working systems only where required for visual integration or proven defects.

## Phase 8 — Final benchmark review

Validate:

* Full player sequence
* Save and reload
* Customer route
* Checkout
* Laptop
* Cleaning
* Performance
* Visual consistency
* Asset checklist
* Material checklist
* Lighting checklist
* Before-and-after comparison

The old room must remain available until the new room is explicitly approved.

---

# 15. Required review gates

Work must stop for human visual approval after:

* Phase 0 baseline capture
* Phase 1 system classification
* Phase 2 art bible
* Phase 3 greybox
* Material and lighting pass (Phase 4)
* Every hero asset (Phase 5)
* First completed broom interaction
* Final benchmark review

Gate order follows the Phase 4/5 swap recorded in §14.

Silence is not approval.

An agent may not approve its own visual work and continue automatically.

---

# 16. Git rules

Before every phase:

1. Run `git status`.
2. Run `git branch --show-current`.
3. Confirm the branch is `feature/pro-shop-vertical-slice`.
4. Record the current commit SHA.
5. Confirm there are no unrelated changes.

Never:

* Switch branches
* Create another worktree
* Merge into main
* Force-push
* Rewrite history
* Delete branches
* Delete the old clubhouse without approval
* Commit secrets
* Commit generated temporary files

After a verified milestone:

1. Run relevant tests.
2. Run `git diff --stat`.
3. Run `git status`.
4. Commit with a descriptive message.
5. Push only `feature/pro-shop-vertical-slice`.
6. Report the pushed SHA.
7. Stop.

---

# 17. Absolute prohibitions

Do not:

* Execute multiple phases without explicit permission
* Rebuild the entire game
* Rebuild the course editor
* Rebuild laptop functionality
* Rebuild checkout transaction logic
* Replace all materials project-wide
* Generate large batches of assets
* Preserve weak assets for convenience
* Add unrelated features
* Expand outside the starter pro shop
* Delete the old room before final approval
* Call anything final without in-game comparison
* Skip human visual approval
* Grade subjective visual quality solely through self-review
* Continue automatically after a review gate

---

# 18. Definition of success

The vertical slice succeeds when:

* The new room looks intentionally designed
* The visual language is cohesive
* Scale is believable
* Materials respond consistently
* Lighting supports the room
* No obvious placeholder remains in the benchmark area
* The selected cleaning tool visibly contacts the surface
* Dirt responds immediately
* Animation, particles, audio, and surface response agree
* Existing checkout still works
* Existing laptop still works
* Customer routing works
* Save and reload preserve the state
* Performance remains within the approved budget
* The new room clearly outperforms the old room in side-by-side review
* The user explicitly approves the new benchmark

Only after approval may this standard be applied to additional rooms, assets, and tools.
