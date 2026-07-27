# GOLF FLIPPER — FULL PROJECT RECOVERY, SYSTEMS UNIFICATION, AND STEAM-RELEASE POLISH

You are taking ownership of an existing game project called **Golf Flipper**.

The project already contains substantial gameplay logic created by multiple Codex agents. Many individual systems technically exist, but they were built independently, are inconsistently designed, interact poorly, contain placeholder-quality visuals, and often feel like disconnected AI-generated prototypes rather than one cohesive commercial game.

Your responsibility is not to add random new features.

Your responsibility is to:

1. Audit the entire existing project.
2. Understand every current system before changing it.
3. Preserve working functionality where appropriate.
4. remove duplicate, obsolete, conflicting, or low-quality implementations.
5. Rebuild weak Blender environments and assets.
6. Connect all major systems into one deliberate gameplay loop.
7. Make the starter experience polished enough to represent the final game.
8. Establish consistent technical, visual, interaction, and UX standards for the rest of development.
9. Determine honestly how far the project currently is from a strong Steam release.
10. Continue implementing fixes rather than stopping after producing an audit.

This is a full project recovery and vertical-slice polish pass.

---

# 1. THE GAME’S CORE IDENTITY

Golf Flipper is a first-person golf-course restoration and management simulator.

The fantasy is:

> Buy a neglected golf property, physically clean and repair it, restore its clubhouse and course, reopen the business, operate it, improve its reputation, expand it, automate parts of it, and eventually sell it or grow it into a premium golf destination.

The game should combine the satisfying hands-on restoration of games such as House Flipper with the accessible store-management loop of simulator games such as TCG Card Shop Simulator and Supermarket Simulator.

The game must not feel like:

* A collection of unrelated minigames.
* A generic business spreadsheet.
* A walking simulator with popup menus.
* A tech demo.
* A collection of unpolished generated assets.
* A game where every system has different controls and visual rules.
* A management game where the player never physically improves the property.
* A cleaning game where cleaning has no effect on business performance.

Every major system must support the same central fantasy:

**The player takes something run-down and personally turns it into a successful golf business.**

The restoration must be visually obvious, mechanically satisfying, financially meaningful, and reflected in customer reactions.

---

# 2. SOURCE-OF-TRUTH PRIORITY

Before implementing major changes, inspect:

* The full repository.
* Existing scenes and prefabs.
* Existing gameplay controllers.
* Existing save data.
* Existing UI.
* Existing Blender files and exported models.
* Existing design documents.
* Existing reference images.
* Existing tests and reports.
* Existing unfinished branches or alternate implementations, when accessible.
* Existing assets under the Designs directories.

Use the provided reference images as the visual target wherever they exist.

Likely important reference locations include:

* `Designs\RefrenceImages`
* `Designs\RefrenceImages\LaptopUI\LaptopUIFinal`
* `Designs\CashRegister\Final`
* Course and clubhouse reference folders.
* Tool, furniture, door, chair, checkout, UI, and product reference folders.
* Any newer folders that supersede these.

When sources conflict, use this priority:

1. This master specification.
2. The newest clearly labeled final reference images.
3. Existing functional behavior that matches the intended game.
4. Existing code and placeholder visuals.
5. Old experimental implementations.

Do not blindly preserve bad behavior merely because it already exists.

Do not blindly rewrite working systems merely because they were produced by another agent.

Understand first, then consolidate.

---

# 3. REQUIRED FIRST ACTION: FULL PROJECT AUDIT

Begin with a complete project audit.

Create a clear inventory of:

* Major gameplay systems.
* Scene hierarchy.
* Player controllers.
* Interaction systems.
* Inventory systems.
* Item definitions.
* Placement/building systems.
* Cleaning systems.
* Repair systems.
* Painting systems.
* Checkout systems.
* Booking and check-in systems.
* NPC systems.
* Delivery systems.
* Laptop systems.
* Course-maintenance systems.
* Economy systems.
* Save/load systems.
* Audio systems.
* UI systems.
* Blender assets.
* Materials.
* Colliders.
* Lighting.
* Performance bottlenecks.
* Duplicate or abandoned code.
* Hard-coded values.
* Conflicting managers.
* Broken references.
* Temporary assets.
* Systems that cannot survive save/load.
* Systems that work only in a test scene.
* Systems that visually exist but have no gameplay consequences.
* Systems that logically exist but have no finished presentation.

For each major system, classify it as:

* Production-ready.
* Functional but needs polish.
* Partially functional.
* Duplicated or conflicting.
* Placeholder only.
* Broken.
* Missing.

Give the current project an honest readiness score in these categories:

* Core gameplay loop.
* Starter experience.
* Visual quality.
* Environment quality.
* System integration.
* Player feedback.
* UI and UX.
* NPC behavior.
* Economy and progression.
* Save/load reliability.
* Performance.
* Stability.
* Audio.
* Content quantity.
* Steam release readiness.

Provide both:

* The current score.
* The minimum acceptable Steam-release score.

Do not inflate the assessment.

A system merely existing in code does not make it release-ready.

After the audit, immediately begin fixing the highest-impact issues.

Do not stop after writing reports.

---

# 4. REQUIRED DEVELOPMENT STRATEGY

Work in controlled passes.

## Pass 1 — Stabilize the foundation

* Identify the canonical implementation of each system.
* Remove or quarantine duplicates.
* Repair compile errors, broken references, null errors, and scene-load problems.
* Establish consistent naming and folder structure.
* Confirm the game boots reliably.
* Confirm new game, save, load, quit, and return-to-menu flows work.
* Confirm the starter property can be completed without developer tools.

## Pass 2 — Unify interaction architecture

* Standardize interaction detection.
* Standardize prompts.
* Standardize held-item behavior.
* Standardize tool use.
* Standardize placement mode.
* Standardize cancellation behavior.
* Standardize audio and visual feedback.
* Standardize input locking when menus or diegetic interfaces are active.

## Pass 3 — Rebuild the starter clubhouse

* Rebuild the environment in Blender where necessary.
* Replace weak blockout-quality geometry.
* Correct scale, doors, windows, walls, counters, floors, trim, lighting, and furniture.
* Build clear before-and-after states.
* Ensure the clubhouse supports the complete opening gameplay loop.

## Pass 4 — Integrate the gameplay loop

Connect cleaning, repair, painting, placement, inventory, deliveries, customer service, checkout, reviews, revenue, and upgrades.

## Pass 5 — Polish and optimize

* Improve visual feedback.
* Improve animation.
* Improve audio.
* Improve NPC movement.
* Fix collisions.
* Fix performance spikes.
* Fix interaction edge cases.
* Run complete playthrough testing.

## Pass 6 — Release-gap evaluation

Once the vertical slice is stable, produce a concrete remaining-work estimate based on completed systems—not speculation.

---

# 5. EXACT PLAYER EXPERIENCE FROM START TO FINISH

The following describes how the game should function as a cohesive commercial experience.

---

## PHASE 0 — BOOT, MAIN MENU, AND NEW GAME

The game launches to a clean, fast, professional main menu.

Required options:

* Continue.
* New Game.
* Load Game.
* Settings.
* Credits.
* Quit.

The menu should communicate the Golf Flipper identity through the background environment, music, logo treatment, and UI.

Starting a new game should:

1. Create a valid save.
2. Load the starter property.
3. Place the player at the entrance or driveway.
4. Present a brief contextual introduction.
5. Give the player a clear first objective.
6. Avoid a long wall of tutorial text.

The player should immediately understand:

* They bought or took responsibility for a failed golf property.
* The place is dirty and nonfunctional.
* They need to restore the clubhouse before opening.
* Their money is limited.
* Their hands-on work directly affects the business.

Tutorials should be contextual, brief, dismissible, and triggered when the player first encounters a relevant action.

---

## PHASE 1 — THE STARTER PROPERTY

The first property is a small, failing municipal or local golf facility.

It should feel believable, compact, neglected, and full of restoration potential.

It should not begin as a beautiful empty room.

It should not feel like a generic square building.

It should not be oversized.

It should not contain a fully operational premium business.

The first property should include:

* A small clubhouse.
* A compact pro-shop area.
* A front counter.
* A dirty checkout area.
* A basic cash register.
* A card reader.
* A receipt printer.
* A laptop or management computer.
* A customer-facing payment location.
* Basic product shelving.
* A small storage area.
* A front entrance.
* A back or staff door where appropriate.
* Windows.
* Interior lighting.
* Exterior lights where appropriate.
* A dirty floor.
* Dust, debris, trash, stains, grime, and neglected surfaces.
* Damaged or outdated paint.
* A few broken or unusable fixtures.
* A visible connection to the course or practice area.
* A delivery location.
* A place where customers queue.
* A clear player path around the counter.
* Enough room to scan products and process transactions without camera obstruction.
* Enough room behind the register for the player, chair, laptop, cash drawer, and interaction animations.

The building should look neglected but structurally plausible.

The player must be able to look at the property and imagine its restored version.

---

# 6. STARTER CLUBHOUSE BLENDER REBUILD

The current clubhouse quality is not acceptable if it looks like generated blockout geometry, has poor proportions, lacks architectural detail, or does not support gameplay.

Rebuild or substantially improve it in Blender.

Use Blender 5.1-compatible assets and an export pipeline suitable for the game engine.

## Architectural requirements

The clubhouse should include:

* Proper wall thickness.
* Correct door frames.
* Correct window frames.
* Baseboards.
* Ceiling trim where appropriate.
* Clean floor transitions.
* Believable counter construction.
* Cabinet doors and drawers with separate movable parts.
* Correct hinges and pivots.
* Door handles.
* Light switches or believable wall details.
* Electrical outlets where visible.
* Ceiling lights.
* Ventilation details where appropriate.
* Exterior trim.
* Roof edge details.
* Gutters or drainage where appropriate.
* Exterior utility details.
* Signage attachment points.
* Correctly modeled thresholds.
* No visible holes between walls and ceilings.
* No overlapping wall geometry.
* No floating trim.
* No paper-thin doors.
* No interior faces visible from normal play angles.

## Required gameplay modularity

Do not model the entire clubhouse as one inseparable mesh.

Create logical modular components:

* Shell.
* Floor.
* Ceiling.
* Exterior walls.
* Interior walls.
* Door frames.
* Doors.
* Windows.
* Counter.
* Cabinets.
* Drawers.
* Shelves.
* Lighting fixtures.
* Signs.
* Furniture.
* Dirt and damage overlays.
* Replaceable fixtures.
* Repairable objects.

Interactive doors, drawers, cabinet doors, windows, and other movable pieces need:

* Correct pivots.
* Clear closed and open positions.
* Non-intersecting animation paths.
* Separate colliders when needed.
* Stable physics or controlled animation.
* Logical interaction points.

## Visual style

Target a stylized PBR simulator-game look.

The target is:

* Believable.
* Cleanly modeled.
* Slightly simplified.
* Warm.
* Readable.
* Commercial.
* Consistent.
* Not photorealistic.
* Not toy-like.
* Not overly low-poly.
* Not visually noisy.

Use the established palette where applicable:

* Warm cream.
* Walnut wood.
* Deep green.
* Sage.
* Charcoal.
* Muted brass.
* Natural turf tones.

The neglected version may use:

* Faded paint.
* Dull wood.
* Grime.
* Dust.
* Water stains.
* Scuff marks.
* Chipped finishes.
* Worn signage.
* Discolored floors.

The restored version should retain the same architecture but appear dramatically improved through cleaning, repair, repainting, furnishing, and lighting.

## Optimization requirements

* Sensible topology.
* Sensible material count.
* Reused trim sheets or material sets where appropriate.
* Proper UV mapping.
* No extreme texture sizes without justification.
* LODs when needed.
* Clean normals.
* Correct smoothing.
* No unnecessary hidden geometry.
* Correct engine scale.
* Consistent origin placement.
* Consistent forward-axis and up-axis conventions.
* Correct collision proxies.
* Clear asset naming.

---

# 7. THE FIRST RESTORATION SEQUENCE

The opening sequence should teach the game through action.

A strong order is:

1. Enter the neglected clubhouse.
2. Inspect the property.
3. Turn on or restore basic power.
4. Pick up obvious trash.
5. Remove loose debris.
6. Vacuum dirty interior flooring.
7. Mop hard floors.
8. Clean counters and windows.
9. Repair a broken fixture.
10. Patch or prepare damaged walls.
11. Paint a designated section.
12. Assemble or place the checkout counter.
13. Install or restore the cash register.
14. Place the laptop.
15. Place essential shelves.
16. Receive the first supply delivery.
17. Open the boxes.
18. stock a small number of products.
19. Configure prices or accept recommended prices.
20. Open the clubhouse.
21. Check in the first reserved customer.
22. Complete the first product transaction.
23. Receive the first review.
24. Earn enough money to purchase the next practical improvement.

The player should not be forced through every system at once.

Unlock systems in a controlled order.

Every tutorial action should result in a visible improvement.

---

# 8. CLEANING MUST BE A CORE GAMEPLAY PILLAR

Cleaning and restoration currently need substantially more emphasis.

The player must spend meaningful time physically improving the property.

Cleaning cannot be a single progress bar with no visual change.

Every cleaning task should have:

* A visible dirty state.
* A visible cleaning process.
* Tool-specific feedback.
* An obvious clean state.
* Audio feedback.
* Particle or decal feedback where appropriate.
* A completion cue.
* A gameplay consequence.

## Cleaning tools

The tool set may include:

* Hands for picking up trash.
* Trash bags.
* Broom.
* Dustpan.
* Vacuum.
* Mop.
* Sponge or cloth.
* Window cleaner.
* Pressure washer.
* Garden hose.
* Scraper.
* Weed trimmer or grounds tool where appropriate.

Tools should use one consistent first-person handling framework.

A GTA-style radial tool wheel may be used if already implemented or appropriate, but it must be:

* Fast.
* Readable.
* Consistent.
* Controller-friendly.
* Visually polished.
* Unable to select tools the player does not own.

## Cleaning state rules

Each cleanable object or surface should use a controlled state system, not arbitrary unrelated scripts.

Possible state data:

* Dirt amount.
* Dust amount.
* Wetness.
* Stain amount.
* Damage amount.
* Paint condition.
* Repair status.
* Cleaned status.
* Surface type.
* Allowed tools.
* Current material variation.

Different tools must work on appropriate surfaces.

Examples:

* Vacuum removes dust and loose dirt from carpets.
* Mop removes grime from hard indoor floors.
* Pressure washer removes exterior grime.
* Cloth removes counter dust.
* Window cleaner removes window haze.
* Trash must be picked up rather than painted over.

The wrong tool should either:

* Do nothing.
* Give a clear message.
* Have reduced effectiveness.

It should never silently corrupt the surface state.

## Business consequences

Cleanliness should affect:

* Customer satisfaction.
* Reviews.
* Reputation.
* Willingness to purchase.
* Membership interest.
* Facility rating.
* Staff efficiency.
* The ability to open certain areas.

Do not make cleanliness decay so aggressively that it becomes tedious.

Use understandable, balanced maintenance.

---

# 9. REPAIR AND RESTORATION SYSTEM

Cleaning and repair are different systems.

Cleaning removes dirt.

Repair restores damaged functionality or physical condition.

Repairable examples:

* Broken lights.
* Damaged shelves.
* Loose cabinet doors.
* Cracked signs.
* Malfunctioning register equipment.
* Damaged course furniture.
* Broken irrigation components.
* Worn tee signs.
* Damaged benches.
* Broken windows where appropriate.
* Faulty doors.
* Damaged maintenance equipment.

Repairs should use:

* Clear required tools.
* Clear parts.
* Clear feedback.
* Visible before-and-after states.
* Appropriate animations.
* Financial consequences.

Avoid generic “hold button to repair everything” behavior.

Simple starter repairs may be accessible, but later repairs can require specific parts or upgraded tools.

---

# 10. PAINTING AND SURFACE SYSTEM

The paint system must be technically controlled and visually clean.

Paint, dirt, repair damage, and material states cannot randomly overwrite each other.

Use an explicit surface-state hierarchy.

A wall should conceptually have:

1. Base construction surface.
2. Damage state.
3. Repair or patch state.
4. Paint layer.
5. Dirt or stain overlay.
6. Wetness or temporary effect.

The player should not be able to:

* Paint trash.
* Paint through furniture.
* Paint through walls.
* Paint the opposite side of a wall unintentionally.
* Paint doors when aiming at the wall beside them.
* Paint glass.
* Paint non-paintable trim without permission.
* Paint over unrepaired severe damage.
* Create floating paint.
* Paint surfaces through colliders.
* Mix unrelated paint regions because two objects overlap.

## Required paint behavior

* Raycasts must resolve the actual visible target.
* Paintable surfaces require explicit paintable metadata.
* Each paint region requires a stable surface ID.
* Adjacent walls should not share paint state accidentally.
* Separate rooms should not share paint state.
* Interior and exterior faces must be distinct.
* Doors and trim must use independent paint groups.
* Paint previews must match final coverage.
* The cursor or outline should indicate the selected surface.
* UI should display the chosen color.
* The player should know whether paint is allowed.
* Paint quantity should decrease predictably.
* Undo or cancellation rules must be consistent.
* Partially painted surfaces must save correctly.

Do not rely on object names alone to decide whether something is paintable.

Use components, tags, layers, data assets, or equivalent explicit metadata.

---

# 11. COLLISION, INTERACTION, AND PHYSICS RULES

Collision problems are unacceptable in a first-person simulator.

Perform a complete collision audit.

Fix:

* Player clipping through walls.
* Player snagging on tiny trim.
* Objects floating above surfaces.
* Objects sinking into counters.
* NPCs colliding with doors.
* NPCs walking through furniture.
* Placement previews intersecting walls.
* Held items clipping through the camera.
* Doors opening through players or furniture.
* Drawers intersecting nearby geometry.
* Interactions triggering through walls.
* Items being scanned while behind the register.
* Painting through objects.
* Cleaning through walls.
* Multiple interaction prompts appearing simultaneously.
* The player becoming trapped behind furniture.
* Dropped objects exploding from physics overlap.
* Chairs, laptops, or other objects disappearing because of incorrect culling or hierarchy.

## Collision-layer rules

Create and document clear layers or channels for:

* Player body.
* Player interaction raycast.
* NPC body.
* Static architecture.
* Doors.
* Placeable furniture.
* Small inventory items.
* Tools.
* Cleaning targets.
* Paintable surfaces.
* Checkout scanner.
* Course terrain.
* UI or diegetic screens.
* Placement previews.
* Nonblocking decoration.

Do not use one generic collision setting for everything.

## Interaction rules

Only one primary interactable should win at a time.

Target selection should prioritize:

1. Visible object.
2. Closest valid hit.
3. Object centered under the reticle.
4. Highest interaction priority when overlapping.

Prompts should clearly state the action:

* Open.
* Close.
* Pick up.
* Clean.
* Repair.
* Paint.
* Place.
* Rotate.
* Scan.
* Check in.
* Use laptop.
* Take payment.
* Give receipt.

Prompts should not flicker rapidly between objects.

---

# 12. BUILDING, FURNITURE, AND PLACEMENT SYSTEM

The build system should feel predictable and satisfying.

The player uses it to:

* Place checkout equipment.
* Place shelves.
* Place counters.
* Place chairs.
* Place decorations.
* Place storage.
* Place course furniture.
* Reorganize the clubhouse.
* Improve customer flow.
* Upgrade the business.

## Placement flow

1. Select an owned placeable item.
2. Enter placement mode.
3. Show a clear transparent preview.
4. Snap to the floor or valid surface.
5. Allow rotation.
6. Allow optional grid snapping.
7. Show valid or invalid placement clearly.
8. Block placement when collisions are unacceptable.
9. Confirm placement.
10. Save the result immediately or through a reliable save state.

## Placement rules

A placed object cannot:

* Intersect walls.
* Block required doors.
* Block emergency or essential paths.
* Trap the player behind the counter.
* Cover interaction points.
* Overlap another solid object.
* Float.
* Sink.
* Prevent NPC access to required stations.
* Block the checkout queue.
* Occupy the laptop chair position.
* Obstruct scanning visibility.

Small decorative objects may use less strict rules, but must still look intentional.

## Snapping

Support:

* Floor snapping.
* Wall snapping for valid wall objects.
* Countertop snapping.
* Shelf-slot snapping for products.
* Grid snapping where useful.
* Fine rotation where useful.
* Reset rotation.
* Cancel placement.
* Move already placed objects.
* Sell or store already placed objects.

Avoid forcing every object onto one universal grid.

A large shelf and a small desk accessory need different placement tolerances.

## Build-mode UX

The build UI should show:

* Item name.
* Quantity owned.
* Placement controls.
* Rotation controls.
* Validity.
* Storage or sell actions.
* Current cost when purchasing directly.
* Category filters.

Do not cover the center of the screen with excessive UI.

---

# 13. INVENTORY SYSTEM

Create one authoritative inventory model.

Do not allow separate systems to maintain conflicting item counts.

The inventory should distinguish between:

* Player-carried tools.
* Consumable supplies.
* Boxed delivery items.
* Sellable store products.
* Furniture.
* Buildable items.
* Repair parts.
* Course-maintenance materials.
* Business equipment.
* Stored objects.

Each item should use a consistent item definition containing appropriate data such as:

* Unique item ID.
* Display name.
* Category.
* Description.
* Icon.
* World prefab.
* Held prefab where needed.
* Boxed prefab where needed.
* Shelf prefab where needed.
* Buy price.
* Sell price.
* Stack size.
* Weight or handling rules when relevant.
* Placement rules.
* Allowed storage.
* Checkout barcode or scan metadata.
* Durability or quantity where relevant.
* Save serialization data.

Avoid identifying items solely by prefab names or display strings.

## Inventory behavior

* Quantities must update immediately.
* UI and world state must agree.
* Dropping and picking up must not duplicate items.
* Saving while holding an item must restore safely.
* Placing furniture must remove it from stored inventory.
* Returning furniture to storage must restore it.
* Scanned store products must not remain sellable afterward.
* Products inside unopened boxes must not appear as shelf inventory.
* Damaged or invalid save references must fail gracefully.

---

# 14. DELIVERY AND UNBOXING SYSTEM

The delivery system should support the business loop.

The player orders products, equipment, furniture, tools, and supplies from the laptop.

Orders should:

1. Be purchased with business funds.
2. Enter an order queue.
3. Display a delivery estimate.
4. Arrive at the correct delivery location.
5. Spawn valid boxes or packages.
6. Contain the correct items.
7. Save correctly before and after arrival.
8. Avoid duplicate deliveries after reloading.

## Unboxing

The player should:

* Pick up or move boxes.
* Place them in a suitable area.
* Use a box cutter or appropriate interaction.
* See products inside when the box opens.
* Remove individual items or groups in a clear way.
* Stock products onto shelves.
* Break down or discard empty boxes.

The opening animation should not hide the contents.

Products should not spawn behind the laptop, inside the counter, or outside the player’s view.

Boxes should have:

* Correct scale.
* Believable flaps.
* Correct pivots.
* Visible contents where possible.
* Stable colliders.
* No explosive physics.
* Clear labels without using copyrighted branding.

---

# 15. THE LAPTOP AND BUSINESS MANAGEMENT

The laptop is a diegetic management interface.

It should exist physically in the clubhouse.

The player should be able to:

* Approach it.
* Sit or enter an interaction view.
* Open or wake it.
* Use it with a centered, readable camera.
* Exit cleanly.
* Avoid moving the first-person camera accidentally while using it.

The laptop must not be:

* Backwards.
* Too far away.
* Off-center.
* Unreadably small.
* Obscured by the counter.
* Floating.
* Clipping through the desk.
* Disappearing with the chair.
* Showing a UI that does not match the physical display.

Use the final approved white laptop UI references where available.

The main product title should use the current game branding, such as **Golf Simulator** or the latest approved title, rather than outdated placeholder branding such as Prime Fairways.

## Laptop sections

The laptop should eventually support:

* Home.
* Pro Shop or Store.
* Orders and Suppliers.
* Inventory.
* Bookings.
* Customer Check-In.
* Finances.
* Reviews.
* Staff.
* Property Upgrades.
* Course Management.
* Marketing.
* Memberships.
* Settings or business configuration.

During the starter phase, only necessary sections should be enabled.

## Home screen

Display:

* Current cash.
* Today’s revenue.
* Upcoming tee times.
* Customers waiting.
* Low-stock warnings.
* Pending deliveries.
* Property cleanliness.
* Course condition.
* Current rating.
* Important tasks.

## Orders and suppliers

Allow the player to:

* Browse categories.
* Compare price and delivery time.
* Order products.
* Order supplies.
* Order furniture.
* Track orders.
* Reorder previous purchases.

## Finances

Display understandable information:

* Revenue.
* Product sales.
* Green fees.
* Membership income.
* Expenses.
* Supply costs.
* Repair costs.
* Utilities.
* Payroll when staff exist.
* Profit.
* Recent transactions.

Do not overwhelm the player with accounting complexity early in the game.

## Reviews

Reviews must reflect actual customer experiences such as:

* Cleanliness.
* Waiting time.
* Course condition.
* Product availability.
* Staff service.
* Price.
* Facility quality.

Reviews should not be random flavor text disconnected from gameplay.

---

# 16. BOOKINGS, ARRIVALS, AND CHECK-IN

Customers generally reserve tee times before arriving.

Not every customer should enter the clubhouse simultaneously.

Customers should arrive around their scheduled time, typically approximately 15 minutes early.

Possible customer cases:

* Online reservation.
* Walk-in asking for an available tee time.
* Member check-in.
* Customer purchasing store products.
* Customer checking in and purchasing products.
* Late arrival.
* No-show.
* Cancellation.
* Group arrival.

Each customer must have:

* A unique visible name.
* Reservation data when relevant.
* Tee time.
* Group size.
* Payment state.
* Payment preference when relevant.
* Membership state when relevant.
* Check-in state.
* Current objective.
* Queue state.

The player should see the customer’s name during check-in.

The customer may say whether they want to pay with:

* Cash.
* Card.

No-shows should follow understandable rules, such as a fee when appropriate.

Walk-ins should ask for available tee times, and the player should be able to assign an open slot.

The booking and check-in system must connect to:

* Course capacity.
* Available tee times.
* Customer arrival.
* Payment.
* Customer pathing.
* Reviews.
* Revenue.
* No-show handling.

---

# 17. CHECKOUT SYSTEM

The checkout should feel as tactile and polished as the strongest simulator games.

The player should:

1. Receive items from the customer.
2. See the items clearly.
3. Move or scan each item.
4. Hear and see successful scan feedback.
5. View the running total.
6. Accept cash or card.
7. Complete the correct payment interaction.
8. Print and give a receipt where appropriate.
9. Finalize the sale.
10. Clear the station for the next customer.

## Scanner behavior

* Every item has a valid scan target.
* Items must remain visible.
* Items cannot slide behind the computer or counter.
* Items cannot be scanned repeatedly.
* Scanned items move to a clear completed area.
* The scanner beam and sound match the interaction.
* The display total updates immediately.
* Customer ownership and transaction ownership are explicit.

## Cash payment

* Open the correct cash drawer.
* Show readable bills and coins.
* Use consistent currency presentation.
* Do not use copyrighted or highly realistic official currency artwork.
* Allow change calculations.
* Prevent invalid underpayment.
* Allow reasonable small overpayment rules only where deliberately designed.
* Correctly close and reset the drawer.
* Prevent money duplication.
* Save no incomplete transaction as completed.

## Card payment

Use an insert or tap interaction rather than an unnecessarily complicated swipe mechanic unless the approved design says otherwise.

The physical reader and any close-up UI must match.

Do not show one reader model in the world and another in the interaction popup.

## Receipt

* Print from the correct device.
* Allow the player to take it.
* Give it to the correct customer.
* Finalize the transaction only once.
* Safely handle repeated interaction attempts.
* Prevent duplicate revenue.

---

# 18. TRANSACTION AND ACTION IDEMPOTENCY

Critical actions must be safe when triggered more than once.

Examples:

* Completing a checkout.
* Charging a customer.
* Giving a receipt.
* Checking in a reservation.
* Accepting a delivery.
* Opening a box.
* Purchasing an upgrade.
* Completing a repair.
* Saving a placement.
* Collecting a reward.

Each transactional action should have:

* A unique action or transaction ID.
* A clear state.
* A single authoritative completion path.
* Safe repeated calls.
* No duplicate money.
* No duplicate inventory.
* No duplicate reviews.
* No duplicate customers.
* No duplicate order fulfillment.

Do not assume the interaction button can only be pressed once.

---

# 19. NPC BEHAVIOR AND PATHING

Customers must behave like customers, not wandering test agents.

Required states may include:

* Arriving.
* Entering.
* Waiting.
* Queueing.
* Checking in.
* Browsing.
* Carrying products.
* Waiting for checkout.
* Paying.
* Receiving receipt.
* Walking to the course.
* Leaving.
* Reacting to a blocked path.
* Timing out gracefully.

NPCs must:

* Use doors correctly.
* Avoid walking through doors before they open.
* Avoid furniture.
* Avoid counters.
* Maintain sensible queue spacing.
* Not all spawn at once.
* Avoid standing inside each other.
* Recover when pathing fails.
* Not permanently block the entrance.
* Avoid sudden rotation or animation snapping where possible.
* Face the player during service interactions.
* Use readable indicators only when necessary.

Queue positions should be explicit.

Customer navigation should update when the player moves furniture.

The game must detect furniture placements that destroy required navigation paths.

---

# 20. CUSTOMER EXPERIENCE AND REVIEWS

The customer’s experience should be calculated from actual events.

Possible factors:

* Wait time.
* Check-in accuracy.
* Checkout accuracy.
* Cleanliness.
* Product availability.
* Facility quality.
* Course quality.
* Price fairness.
* Staff availability.
* Broken equipment.
* Blocked paths.
* Lighting.
* Decoration.
* Restroom quality where implemented.
* Membership benefits.

Reviews should be:

* Specific.
* Understandable.
* Connected to gameplay.
* Useful for player decisions.
* Varied without being random nonsense.

A customer should not praise cleanliness in a filthy clubhouse.

A customer should not complain about a system they never encountered.

---

# 21. COURSE RESTORATION AND GROUNDSKEEPING

After the clubhouse opens, the player gradually restores the golf course.

The course is not just a decorative background.

Course condition affects:

* Customer satisfaction.
* Green fees.
* Customer volume.
* Membership interest.
* Reviews.
* Tournament eligibility.
* Property value.

Course work may include:

* Picking up trash.
* Mowing.
* Trimming.
* Watering.
* Pressure washing.
* Repairing signs.
* Replacing tee markers.
* Raking bunkers.
* Repairing irrigation.
* Filling damaged turf.
* Restoring greens.
* Repairing paths.
* Improving drainage.
* Replacing flags.
* Restoring course furniture.

Tool interactions must visually affect the environment.

The grass must not appear pixelated, noisy, square, or visibly bounded by an artificial map edge.

Course terrain should:

* Blend naturally into the surrounding environment.
* Hide playable-area boundaries.
* Use stable LODs.
* Avoid severe texture shimmer.
* Avoid obvious square edges.
* Maintain good performance outside the clubhouse.

---

# 22. COURSE EDITOR AND CONSTRUCTION

The player may eventually modify:

* Hole layout.
* Tee locations.
* Bunkers.
* Landscaping.
* Decorations.
* Paths.
* Signs.
* Facilities.

The course editor should be powerful but understandable.

Do not expose a professional CAD-like interface to a new player.

Use progressive complexity:

* Basic placement and repair early.
* Landscaping later.
* Hole reshaping later.
* Advanced course design in higher-tier properties.

Preview modifications before committing them.

Prevent:

* Impossible terrain.
* Unreachable greens.
* Floating decorations.
* Severe overlap.
* Broken navigation.
* Unplayable hole paths.
* Visible world edges.

---

# 23. ECONOMY AND PROGRESSION

The economy must reward restoration and competent operation.

The player earns money through:

* Green fees.
* Product sales.
* Memberships.
* Events.
* Lessons or services if implemented.
* Tournaments at later properties.
* Selling improved properties.
* Other approved golf-business revenue.

The player spends money on:

* Supplies.
* Products.
* Repairs.
* Paint.
* Furniture.
* Equipment.
* Course improvements.
* Utilities.
* Marketing.
* Staff.
* Property purchases.
* Maintenance.

The starter economy should:

* Be forgiving enough to learn.
* Still require choices.
* Avoid soft-locking the player.
* Avoid giving unlimited money.
* Avoid requiring excessive grinding.
* Reward visible improvement.

Progression should unlock better:

* Tools.
* Suppliers.
* Equipment.
* Furniture.
* Products.
* Course features.
* Staff.
* Automation.
* Properties.
* Reputation tiers.

---

# 24. PROPERTY PROGRESSION

The long-term game can progress through properties with distinct challenges.

## Property 1 — Failing municipal facility

* Small clubhouse.
* Limited budget.
* Six to nine holes or a limited playable area.
* Heavy cleaning and basic restoration.
* Player performs almost everything manually.
* Focus on learning the core loop.

## Property 2 — Suburban public course

* Larger clubhouse.
* More customers.
* Cart fleet.
* Leagues.
* Events.
* Larger inventory.
* Early staff management.

## Property 3 — Mountain or woodland course

* Elevation.
* Drainage challenges.
* Scenic-value bonuses.
* More complex course maintenance.
* Premium visitor expectations.

## Property 4 — Desert or coastal property

* Water-management challenges.
* Wind.
* Sand.
* Premium green fees.
* Specialized maintenance.

## Property 5 — Private country club or destination resort

* Eighteen holes.
* Membership management.
* Tournaments.
* Premium facilities.
* High expectations.
* Large staff.
* Significant automation.
* Endgame business decisions.

Do not build all five properties before the starter vertical slice is excellent.

The starter property is the most important content because every player experiences it.

---

# 25. ART DIRECTION FOR ALL ASSETS

All assets should appear to belong to the same game.

Use a consistent:

* Shape language.
* Material response.
* Edge treatment.
* Texture density.
* Color palette.
* Scale.
* Detail level.
* Lighting model.
* Branding style.
* Wear treatment.

Avoid:

* Random photoreal assets mixed with stylized assets.
* Inconsistent bevel sizes.
* Texture resolutions that vary wildly.
* Real-world copyrighted logos.
* Official sports branding.
* Real currency reproductions.
* Objects with generated text artifacts.
* Furniture with impossible construction.
* Oversized props.
* Paper-thin models.
* Default Blender materials.
* Unnecessary visual clutter.

Products can be generic but should still have believable packaging and category identity.

---

# 26. MATERIAL, DIRT, PAINT, AND DAMAGE SEPARATION

Different visual systems must not overwrite or corrupt each other.

Create a clear strategy for:

* Base material.
* Paint color.
* Dirt overlay.
* Damage overlay.
* Wetness.
* Highlight or interaction outline.
* Placement preview.

Do not create a separate full material instance for every tiny state when a scalable shader or property-block approach is more appropriate.

Do not allow interaction highlighting to permanently alter the material.

Do not allow cleaning to reset the player’s chosen paint.

Do not allow painting to repair structural damage automatically.

Do not allow wetness to erase dirt permanently unless the cleaning system confirms removal.

Do not allow damaged-state meshes to remain visible after a completed repair.

State transitions must be deterministic and saved.

---

# 27. CAMERA AND FIRST-PERSON QUALITY

Fix all camera problems.

Known categories include:

* Sudden 180-degree turns.
* Mouse acceleration inconsistencies.
* Camera clipping.
* Incorrect cursor locking.
* Incorrect sensitivity after leaving UI.
* Camera jumping when using the laptop.
* Poor checkout framing.
* Held tools blocking the screen.
* Camera movement continuing while typing or clicking UI.
* Different sensitivity in different scenes.
* Motion that causes nausea.

Requirements:

* Stable mouse look.
* Consistent sensitivity.
* Optional FOV setting.
* Proper cursor lock and release.
* No camera input while menus are active.
* Smooth transitions into laptop and checkout interaction views.
* Reliable restoration of the original camera state.
* No forced camera movement without a clear reason.
* No excessive head bob.
* Controller support should follow the same interaction logic.

---

# 28. UI AND UX STANDARDS

Every screen should look like part of one product.

Use consistent:

* Fonts.
* Button shapes.
* Margins.
* Spacing.
* Colors.
* Icons.
* Hover states.
* Disabled states.
* Confirmation dialogs.
* Error messages.
* Input hints.

The HUD should remain minimal during normal play.

Show only relevant information such as:

* Current task.
* Interaction prompt.
* Held item.
* Tool state.
* Money when relevant.
* Time and business status.
* Small notification feed.

Do not keep giant permanent panels onscreen.

Use clear feedback for:

* Money earned.
* Money spent.
* Item added.
* Item removed.
* Cleaning progress.
* Repair completion.
* Invalid placement.
* Low inventory.
* New review.
* Delivery arrival.
* Customer waiting.
* Objective completion.

---

# 29. AUDIO REQUIREMENTS

Add or standardize audio for:

* Footsteps by surface.
* Doors.
* Drawers.
* Cabinet doors.
* Trash pickup.
* Vacuum.
* Mop.
* Water spray.
* Pressure washer.
* Painting.
* Repairs.
* Item pickup.
* Item placement.
* Scanner beep.
* Cash drawer.
* Coins and bills.
* Card reader.
* Receipt printer.
* Laptop clicks.
* Box opening.
* Product stocking.
* Customer reactions.
* Objective completion.
* Business open and closed states.
* Exterior ambience.
* Clubhouse ambience.

Audio should reinforce state changes.

Avoid repetitive, harsh, or excessively loud sounds.

---

# 30. SAVE AND LOAD RELIABILITY

The complete starter property state must survive save/load.

Save:

* Player position safely.
* Money.
* Business progression.
* Objectives.
* Inventory.
* Held item where safe.
* Tools.
* Deliveries.
* Opened boxes.
* Products.
* Shelf stock.
* Furniture placement.
* Furniture rotation.
* Paint colors.
* Paint completion.
* Dirt state.
* Cleaning completion.
* Repairs.
* Doors where relevant.
* Laptop upgrades.
* Bookings.
* Customer state where appropriate.
* Reviews.
* Course condition.
* Property upgrades.
* Settings.

Loading should never:

* Duplicate products.
* Duplicate customers.
* Duplicate deliveries.
* Reset cleaned surfaces.
* Reset painted walls.
* Lose furniture.
* Spawn the player inside furniture.
* Resume an invalid half-completed payment.
* Award money twice.
* Break navigation.
* Lose ordered products.

Use versioned save data and safe migration practices where feasible.

---

# 31. PERFORMANCE AND TECHNICAL POLISH

Investigate the reported lag, especially:

* Outside the clubhouse.
* During customer spawning.
* During navigation updates.
* During placement.
* When laptop UI opens.
* When many products are visible.
* When grass and course scenery are rendered.
* During save operations.
* During cleaning effects.
* During delivery spawning.

Check for:

* Excessive per-frame allocations.
* Expensive global searches.
* Repeated scene-wide object discovery.
* Too many physics checks.
* Too many active rigid bodies.
* Unbounded update loops.
* Duplicate managers.
* Excessive material instances.
* Large unoptimized textures.
* Missing occlusion or culling strategy.
* Broken LODs.
* Excessive grass density.
* Navigation rebakes occurring too often.
* UI rebuilding every frame.
* Event listeners registered multiple times.
* Memory leaks.
* Objects never returned to pools.
* Excessive save serialization.
* Debug logging in frequent loops.

Target stable gameplay on reasonable Steam hardware.

Do not hide performance problems by simply reducing visual quality everywhere.

Profile first.

---

# 32. CODE QUALITY AND ARCHITECTURE

The existing project may contain AI-generated architectural problems.

Look for:

* God objects.
* Duplicate singleton managers.
* Circular dependencies.
* Multiple inventories.
* Multiple money systems.
* Multiple input systems.
* Duplicate customer state.
* Scene-specific hard coding.
* String-based object lookup.
* Uncontrolled static state.
* Unsubscribed events.
* Unclear ownership.
* Repeated transaction logic.
* Large methods.
* Dead code.
* Placeholder comments.
* Silent exception handling.
* Magic numbers.
* Unvalidated save data.
* Race conditions.
* State that exists only in UI.

Refactor toward clear system boundaries.

Suggested domains include:

* Game flow.
* Save data.
* Player interaction.
* Inventory.
* Items.
* Placement.
* Property state.
* Cleaning.
* Repair.
* Painting.
* Economy.
* Orders.
* Deliveries.
* Checkout.
* Bookings.
* Customers.
* NPC navigation.
* Reviews.
* Objectives.
* UI.
* Audio.

Do not create abstraction purely for abstraction’s sake.

Prefer simple, explicit, testable ownership.

---

# 33. PREVENTING FUTURE AI SLOP

Every change should meet these standards:

* It solves a documented gameplay or technical problem.
* It uses the project’s canonical systems.
* It does not introduce another duplicate manager.
* It does not create another temporary UI style.
* It does not use placeholders in final-facing areas.
* It has clear names.
* It has predictable states.
* It saves correctly.
* It handles failure.
* It has appropriate feedback.
* It is tested in the actual starter scene.
* It does not break other systems.
* It improves the complete player experience.

Do not mark a task complete because:

* The code compiles.
* A button exists.
* An animation plays once.
* A test object works in an empty scene.
* A model was exported.
* A UI mockup appears.

A feature is complete only when it works inside the actual game loop.

---

# 34. STARTER VERTICAL-SLICE ACCEPTANCE TEST

The starter property is not complete until a fresh player can perform this sequence without developer intervention:

1. Launch the game.
2. Start a new save.
3. Arrive at the starter property.
4. Understand the first objective.
5. Enter the clubhouse.
6. Pick up trash.
7. Vacuum or mop appropriate surfaces.
8. Clean at least one visibly dirty fixture.
9. Repair at least one damaged object.
10. Paint at least one valid surface.
11. Place essential furniture.
12. Install or use the checkout station.
13. Use the laptop.
14. Order initial stock.
15. Receive a delivery.
16. Open the boxes.
17. Stock products.
18. Open the business.
19. Check in a named customer with a valid booking.
20. Process a card payment.
21. Process a cash payment.
22. Scan products without losing sight of them.
23. Print and give a receipt.
24. Receive revenue exactly once.
25. Receive a gameplay-relevant review.
26. Complete a basic course-maintenance task.
27. Purchase an upgrade.
28. Save.
29. Exit to the menu.
30. Reload.
31. Find all property, inventory, money, paint, cleaning, repair, furniture, and progression states intact.
32. Continue playing without broken NPCs, duplicated items, or soft locks.

Test this sequence repeatedly.

Also test deliberate failure cases:

* Spam the interaction button.
* Save during different activities.
* Attempt invalid placements.
* Block customer paths.
* Try painting invalid objects.
* Try cleaning with the wrong tool.
* Attempt to scan the same item twice.
* Reload during an order.
* Reload after a delivery arrives.
* Leave the laptop unexpectedly.
* Cancel checkout interactions.
* Open and close doors around NPCs.
* Drop objects near walls.
* Move checkout furniture after using it.

---

# 35. STEAM-RELEASE QUALITY BAR

The project is not ready for Steam merely because the core loop exists.

A credible release requires:

* A polished first hour.
* Clear onboarding.
* Stable saving.
* Consistent visuals.
* Reliable controls.
* Good performance.
* No major soft locks.
* No obvious placeholder environments.
* Satisfying cleaning.
* Satisfying restoration.
* Understandable business management.
* Functional customer flow.
* Meaningful progression.
* Adequate audio.
* Settings.
* Controller considerations.
* Multiple graphics options.
* Resolution support.
* Robust pause behavior.
* Basic accessibility considerations.
* Sufficient content.
* Clear feedback.
* Professional menus.
* QA across multiple complete playthroughs.

The vertical slice should be polished enough that a Steam player understands the game’s long-term potential within the first 15–30 minutes.

---

# 36. REQUIRED REPORTS AND DELIVERABLES

Maintain clear project documentation while working.

Produce:

## A. Current State Audit

Include:

* What exists.
* What works.
* What is broken.
* What is duplicated.
* What is placeholder.
* What is missing.
* What is dangerous to modify.
* What should be retained.
* What should be replaced.

## B. Canonical Systems Map

Document which implementation is now authoritative for each system.

## C. Starter Experience Flow

Document the actual objective sequence and unlock order.

## D. Asset Replacement List

Include:

* Asset name.
* Current quality issue.
* Keep, improve, or replace.
* Reference folder.
* Blender source file.
* Exported file.
* Collider status.
* Material status.
* Interaction status.

## E. Bug and Integration Tracker

Prioritize:

* Blocker.
* Critical.
* High.
* Medium.
* Low.

## F. Performance Report

Include:

* Measured bottlenecks.
* Root causes.
* Fixes.
* Before-and-after results.

## G. Steam Readiness Report

For each category, provide:

* Current score out of 10.
* Release target.
* Main blockers.
* Work completed.
* Remaining work.

## H. Final Verification Report

Include the exact tests run and their results.

Do not claim tests passed unless they were actually run.

---

# 37. IMPLEMENTATION PRIORITY

Use this priority order:

1. Game-breaking errors and save corruption.
2. Duplicate and conflicting foundational systems.
3. Starter property architecture and scale.
4. Player interaction consistency.
5. Cleaning and visible restoration.
6. Placement and collision reliability.
7. Checkout and check-in.
8. Inventory, deliveries, and stocking.
9. Laptop usability.
10. NPC pathing and queue behavior.
11. Economy and progression.
12. Course maintenance.
13. Performance.
14. Audio and visual polish.
15. Additional content.

Do not prioritize late-game content while the opening clubhouse remains ugly or broken.

---

# 38. IMPORTANT WORKING RULES

* Take ownership of the whole result.
* Inspect before rewriting.
* Make backups or safe checkpoints before destructive refactors.
* Keep the project playable throughout development.
* Commit changes in logical groups when version control is available.
* Test inside the actual game.
* Use Blender for assets that require true modeling improvements.
* Do not disguise weak models with lighting alone.
* Do not create more placeholder systems.
* Do not silently remove functionality.
* Do not leave two competing implementations active.
* Do not stop after an audit.
* Do not call an area polished while obvious visual or interaction defects remain.
* Do not optimize only for screenshots; optimize for first-person gameplay.
* Do not prioritize feature count over cohesion.
* Do not invent unrelated mechanics.
* Do not use copyrighted golf brands or real currency reproductions.
* Do not break existing reference-image alignment.
* Do not create a giant clubhouse for the starter property.
* Do not make the starter property clean before the player restores it.
* Do not automate away the hands-on restoration fantasy.
* Do not turn every interaction into a popup menu.

---

# 39. DEFINITION OF SUCCESS

This recovery is successful when the game feels like one deliberately designed product.

The starter clubhouse should progress from:

* Dirty.
* Neglected.
* Cluttered.
* Damaged.
* Poorly lit.
* Barely operational.

Into:

* Clean.
* Repaired.
* Repainted.
* Properly furnished.
* Easy to navigate.
* Professionally lit.
* Fully operational.
* Visually satisfying.
* Profitable.

The player must feel responsible for that transformation.

Cleaning, repair, painting, furniture placement, stocking, customer service, course work, reviews, and finances must all reinforce one another.

The player should be able to look back at the original clubhouse and immediately see how much they changed.

That transformation is the product.

---

# 40. BEGIN NOW

Start by:

1. Auditing the full repository.
2. Identifying the canonical starter scene.
3. Running the existing game.
4. Completing as much of the current loop as possible.
5. Recording every blocker and major quality issue.
6. Mapping duplicate systems.
7. Producing the initial readiness score.
8. Creating a prioritized recovery plan.
9. Beginning the highest-priority fixes immediately.
10. Rebuilding the starter clubhouse and its required assets in Blender when the current assets cannot meet the quality bar.
11. Testing every repaired system in the complete starter gameplay loop.

Do not wait for additional instructions unless access to a genuinely required external resource is impossible.

Use reasonable, documented decisions when minor details are unspecified.

The final result should be a cohesive, satisfying, performant, visually consistent, Steam-quality restoration and golf-business simulator—not a larger collection of disconnected prototypes.
