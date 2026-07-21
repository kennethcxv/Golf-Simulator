# GOLF FLIPPER — SHIP-QUALITY PHYSICAL CASH-REGISTER VERTICAL SLICE

Use the highest available reasoning and coding effort.

You are working inside the existing Golf Flipper repository. Your only objective is to finish the physical cash-register experience to the highest-quality, most polished, most reliable commercial-simulator standard achievable with the repository, Blender MCP, Playwright, browser tooling, and available assets.

This is not a prototype pass. Treat this as a Steam-ready vertical slice.

Work autonomously. Do not ask me questions. I will be unavailable.

When a decision is ambiguous, use your engineering judgment and choose the option that best supports:
1. Clear first-person physical interaction
2. Polished commercial presentation
3. Stable transaction logic
4. Original Pinehollow Golf visual identity
5. Existing repository architecture
6. Strong performance
7. Verifiable evidence

Do not stop merely because code compiles, tests pass, assets exist, or a scripted transaction finishes.

---

# SOURCES OF TRUTH

Before changing anything, read and follow these files in this order:

1. `AGENTS.md`
2. `CASH_REGISTER_GOAL.md`
3. `Design_Doc.md`
4. `Golf_Flipper_Complete_Game_Vision.md`
5. `.agents/skills/checkout-production/SKILL.md`
6. `.agents/skills/blender-game-assets/SKILL.md`
7. `.agents/skills/browser-game-visual-qa/SKILL.md`
8. `.agents/skills/performance-regression/SKILL.md`

Then recursively inspect every reference image under:

`Designs/CashRegister`

Open each image at full resolution.

Analyze:

- Camera height
- Camera position
- Field of view
- Customer framing
- Counter proportions
- Product staging area
- Scanner position
- POS position
- Card-reader position
- Cash-drawer position
- Bagging area
- Hand visibility
- Object scale
- Screen-space balance
- Interaction readability
- Lighting
- Materials
- Animation expectations

Use TCG Card Shop Simulator only as a benchmark for interaction quality, clarity, pacing, and polish.

Do not copy its proprietary:
- Models
- Textures
- Interface artwork
- Icons
- Fonts
- Sounds
- Branding
- Code
- Exact screen composition

Create an original Pinehollow Golf implementation.

---

# STRICT SCOPE

Work only on systems directly required for the physical cash-register experience:

- Register assets
- Checkout counter layout
- Cashier camera
- Customer checkout positioning
- Product placement
- Product pickup
- Product rotation
- Barcode scanning
- POS monitor
- Card reader
- Mouse-controlled card swipe
- Cash presentation
- Cash acceptance
- Cash drawer
- Bill and coin compartments
- Cash deposit
- Change selection
- Change handoff
- Receipt printing
- Product bagging
- Receipt bagging
- Bag handoff
- Customer reaction and departure
- First-person hands
- Customer checkout animations
- Audio and visual feedback
- Transaction state management
- Recovery behavior
- Save/load protection
- Inventory and revenue correctness
- Playwright acceptance testing
- Visual QA
- Performance verification

Do not begin work on:

- Course maintenance
- Reservations
- Parking
- Deliveries unrelated to checkout
- Cleaning
- Driving range
- Employees
- Clubhouse expansion
- General laptop redesign
- New economy systems
- Unrelated product categories
- Other game systems

Use `Design_Doc.md` and `Golf_Flipper_Complete_Game_Vision.md` only to keep checkout consistent with the larger game.

---

# PRESERVE EXISTING WORK

This repository already contains substantial checkout work from previous agents.

Do not restart the register system.

Do not replace working architecture without strong evidence.

Do not run:

- `git reset --hard`
- `git clean`
- Destructive checkout restoration
- Mass file rewrites
- Unrelated formatting passes
- Broad architectural rewrites
- Deletion of existing QA evidence

Before editing, inspect:

```bash
git status --short
git diff --stat
git diff
git log --oneline -20

Then inspect all existing register code, assets, scripts, tests, screenshots, recordings, and result files.

Review everything under:

qa/cash-register-production/

Especially inspect:

Existing card recordings
Existing cash recordings
All screenshots
latest-result.json
Failure screenshots
Browser logs
Console errors
Page errors
Performance evidence
Existing pass reviews

Do not trust an "ok": true result without inspecting the visual evidence.

Preserve successful existing work, including:

Card and cash acceptance drivers
Transaction recovery
Timeout handling
Escape and browser-blur recovery
Exact-once sale banking
Protection against voiding completed sales
Receipt-in-bag validation
Visible change handoff
Existing customer and hand improvements
Existing camera improvements
Existing scanner-light tuning
Existing POS-screen readability improvements
PRIMARY QUALITY TARGET

The final result must feel like one uninterrupted physical transaction.

The player should never feel like they are controlling a detached debug interface.

The complete flow must be:

Customer approaches.
Customer stops at the correct register marker.
Customer places physical products on the counter.
Player enters cashier mode.
Player picks up each product separately.
Player rotates the product to find its barcode.
Player physically moves the barcode through the scanner.
Scanner reacts.
POS updates exactly once.
Player stages the scanned product.
Customer chooses card or cash.
Player completes the physical payment interaction.
Receipt physically prints.
Player collects the receipt.
Products are placed into a physical bag.
Receipt is placed into the bag.
Player offers the filled bag.
Customer visibly takes it.
Customer reacts and leaves.
Inventory updates exactly once.
Revenue updates exactly once.
Queue advances.
Register returns to a safe idle state.

No major interaction may be replaced by:

A single “complete transaction” button
A progress bar
A detached fullscreen menu
Hidden debug state changes
Automatic object teleportation
Invisible cash handling
Products disappearing without bagging
Customer handoff without visible physical contact
PHASE 1 — BASELINE AND AUDIT

Before implementing:

Launch the actual game.
Run the current card acceptance flow.
Run the current cash acceptance flow.
Record both.
Capture all major interaction moments.
Inspect every screenshot.
Watch both videos.
Inspect browser console and page errors.
Inspect current performance.
List the current defects ranked by player impact.

Create or update:

qa/cash-register-production/CURRENT_AUDIT.md

The audit must identify:

What already works
What is functional but visually weak
What is visually strong but mechanically weak
What clips
What floats
What is unreadable
What is off-camera
What has poor timing
What is missing
What can be fixed without rebuilding
What genuinely requires Blender changes

Do not spend excessive time documenting. Begin implementation once the major defects are understood.

PHASE 2 — BLENDER ASSET QUALITY

Use Blender MCP and repeatable Blender Python scripts when asset work is required.

Inspect existing assets before rebuilding them.

Improve or create only the register assets visible during checkout:

Checkout counter
POS monitor
POS stand
Barcode scanner
Scanner glass
Scanner beam housing
Payment terminal
Physical swipe channel
Chip slot
Contactless marker
Receipt printer
Receipt-paper roll
Cash-drawer housing
Sliding drawer
Cash tray
Bill compartments
Coin compartments
Bill-retaining clips
Shopping bag
Bag handles
Shopping basket
Counter divider
Customer-side product surface
Player-side staging surface
Bagging surface

Every final asset must have:

Believable real-world dimensions
Applied transforms
Clean normals
Correct shading
Intentional bevels
Clean hierarchy
Separate movable parts
Correct origins
Correct pivots
Interaction anchors
Grip anchors
Simplified collision meshes
Clean UVs
Cohesive stylized PBR materials
Performance-conscious geometry
Original Pinehollow Golf identity

Use:

Deep golf green
Warm cream
Muted sage
Natural oak
Medium walnut
Warm charcoal
Off-white
Restrained brass

Do not leave:

Raw cubes
Default materials
Floating components
Incorrect scales
Broken normals
Razor-sharp manufactured edges
Misaligned pivots
Decorative geometry inside collision meshes
Unoptimized duplicated materials

Preserve raw Tripo assets.

Save editable .blend sources.

Export GLBs through the existing pipeline.

Verify every Blender change inside the actual game.

A Blender viewport render is not completion evidence.

PHASE 3 — REGISTER LAYOUT

Arrange the checkout workspace using the reference images.

The player must naturally see and reach:

Customer
Product staging area
Barcode scanner
POS monitor
Card terminal
Cash drawer
Change compartments
Receipt printer
Bagging area
Customer handoff target

Requirements:

No equipment intersects the counter.
No equipment floats.
No equipment is hidden.
Customer does not clip into the counter.
Staff path remains open.
Customer path remains open.
Drawer opens without intersecting geometry.
Bagging surface is visible.
Reader is reachable.
Scanner is reachable.
POS does not block the customer.
Customer receiving hands remain visible.
Objects remain within the cashier camera’s useful frame.

Use actual player and customer collision volumes when validating placement.

PHASE 4 — CASHIER CAMERA

Create a deliberate first-person cashier composition.

Use the reference images as the main visual guide.

The normal cashier camera should clearly show:

Customer upper body
Products
Scanner
POS
Card terminal
Drawer area
Bagging area
Player hands
Customer handoff space

Use a natural field of view, approximately 55–70 degrees unless the references justify another value.

Requirements:

Smooth entry easing
Smooth exit easing
No camera clipping
No fisheye distortion
No excessive head bob
Limited useful mouse look
Correct pointer-lock restoration
Safe cancellation
Important interaction objects remain reachable
Hands never hide the main interaction
Customer never leaves the meaningful frame during handoff

Create focused physical camera transitions for:

Product scanning
Card swipe
Cash drawer
Change selection
Receipt collection
Bag handoff

These must feel like the player leaning or focusing physically, not opening a detached screen.

PHASE 5 — CUSTOMER PRODUCT PLACEMENT

The customer must place products physically.

Required behavior:

Customer stops at the checkout marker.
Customer faces the cashier.
Customer places each product individually.
Products land on the correct surface.
Products do not overlap.
Products do not float.
Products do not clip.
Large and small products use appropriate placement.
Customer waits naturally.
Customer visually follows the transaction.

Use customer hand IK or placement targets where appropriate.

Do not teleport all products onto the counter at once.

PHASE 6 — PRODUCT PICKUP AND BARCODE SCANNING

Every sellable product must have a physical barcode or tag.

Barcodes must correspond to:

SKU
Product identity
Price
Current transaction item

Place them logically:

Back or underside of boxes
Apparel tags
Shoe-box side
Golf-ball-box side
Club tags
Accessory packaging
Hat tags
Rangefinder packaging
Headcover tags

The player should not need pixel-perfect alignment.

Required scanning flow:

Player looks at the product.
Product receives subtle interaction feedback.
Player picks it up.
First-person hand reaches toward it.
Product attaches to the correct grip anchor.
Player rotates it.
Barcode becomes discoverable.
Barcode approaches the scanner.
Barcode receives subtle assistance near the scan zone.
Barcode enters the physical scan volume.
Barcode orientation is checked with a forgiving angle.
Scanner light activates.
Scanner beep plays.
POS adds the item once.
Product is marked scanned.
Player stages the product.
Next product becomes available.

Prevent:

Scanning from far away
Scanning a product without its barcode
Double scanning
Scanning another customer’s product
Payment before all products are scanned
Product duplication
Product deletion
Product becoming unreachable

The interaction should be satisfying, not frustrating.

PHASE 7 — FIRST-PERSON HANDS

Improve or create a stylized first-person hand and forearm system.

Required poses and animations:

Cashier idle
Reach toward product
Pick up small item
Pick up medium item
Support large item
Rotate product
Scan product
Stage product
Accept card
Swipe card
Accept bills
Accept coins
Deposit bills
Deposit coins
Select change
Hold change
Give change
Collect receipt
Open bag
Place products into bag
Place receipt into bag
Hold bag handles
Offer bag

Use:

IK targets
Grip anchors
Animation blending
Stable wrists
Natural arm proportions
Camera-safe poses
Small natural movement
Correct handedness

Reject any pose where:

Arms cross unnaturally
Hands cover the scanner
Hands hide the swipe channel
Wrists twist unnaturally
Products float
Cash floats
Card floats
Receipt floats
Bag floats
Arms clip through the camera or counter
PHASE 8 — POS MONITOR

Render checkout information directly on the physical POS display.

Do not use a detached fullscreen checkout menu.

The POS must clearly show:

Customer name
Transaction number
Product name
Product thumbnail
Quantity
Unit price
Subtotal
Discount
Tax if supported
Total
Items remaining
Payment method
Tendered amount
Change due
Payment status
Receipt status

Required states:

Waiting
Customer placing products
Ready to scan
Item scanned
Items remaining
Ready for payment
Card selected
Cash selected
Card processing
Card approved
Card declined
Cash received
Change required
Receipt printing
Bagging
Complete

Visual direction:

Cream base
Deep-green header
Warm-charcoal text
Sage secondary panels
Restrained brass accents
Large readable total
Clear item rows
Minimal clutter

The display must remain readable from the cashier camera.

Use a material that stays legible under scene lighting.

PHASE 9 — CARD PAYMENT

Required card flow:

Customer retrieves a physical card.
Customer presents the card.
Player hand takes or controls it.
Camera focuses on the physical reader.
Card aligns at the top of the swipe channel.
Mouse movement drives the card downward.
Card physically follows the input.
Reader evaluates the swipe.
Terminal processes.
Payment approves or declines.
Feedback appears on the physical reader and POS.
Camera returns safely.

Successful swipe requires:

Starting near the top
Mostly downward movement
Sufficient travel
Reaching near the bottom
Reasonable speed
Minimal reversal

Failure feedback:

Swipe slower
Swipe again
Swipe downward
Complete the swipe

Make the valid range generous.

Do not use a progress bar as the main interaction.

The physical card must visibly move through the physical reader.

PHASE 10 — CASH PAYMENT

Required cash flow:

Customer visibly retrieves cash.
Customer presents bills and coins.
Player reaches out.
Player accepts the tender.
Drawer unlocks.
Drawer slides open.
Player deposits bills.
Player deposits coins.
POS shows tendered amount.
POS shows change due.
Player selects visible denominations.
Selected total updates.
Player can undo.
Player confirms correct change.
Player holds the change.
Player gives it to the customer.
Customer visibly receives it.
Drawer closes.
Receipt prints.

Drawer requirements:

Proper housing
Proper tray
Bill compartments
Coin compartments
Correct slide pivot and axis
Believable easing
No teleportation
No clipping
No premature closing
No drawer becoming permanently stuck

Change selection must remain physical.

Bills and coins should be visible, readable, and clickable.

PHASE 11 — RECEIPT AND BAGGING

Required flow:

Receipt printer activates.
Paper visibly emerges.
Printer sound plays.
Player reaches for receipt.
Player removes receipt.
Bag opens.
Products are placed into bag.
Products remain represented inside the bag or use a believable transition.
Receipt is placed into the bag.
Player gathers handles.
Player offers the bag.
Customer reaches toward it.
Customer takes possession.
Customer reacts.
Customer leaves.

Large products may be handed over separately.

Do not make products disappear immediately after payment.

Do not allow the bag to leave the camera frame during handoff.

PHASE 12 — CUSTOMER ANIMATION

Required checkout animation coverage:

Approach register
Join queue
Advance in queue
Stop at counter
Face cashier
Place small product
Place medium product
Wait
Look at product
Look at cashier
Retrieve card
Present card
Retrieve cash
Present cash
Receive change
Receive bag
Positive reaction
Declined-card reaction
Impatient reaction
Leave register

Use IK targets for:

Product placement
Card presentation
Cash handoff
Change reception
Bag reception

Prevent:

Customer facing away
Hands passing through counter
Products passing through hands
Bag passing through customer
Customer turning before possession transfers
Customer leaving before transaction completion
PHASE 13 — TRANSACTION STATE MACHINE

Use an explicit and recoverable checkout state machine.

Required states should include equivalents of:

CustomerApproaching
CustomerPlacingProducts
WaitingForCashier
EnteringCashierMode
WaitingForScan
ProductHeld
ProductScanning
ProductScanned
AllProductsScanned
ChoosingPayment
CardPresented
CardSwipeReady
CardSwiping
CardProcessing
CardApproved
CardDeclined
CashPresented
CashAccepted
DrawerOpening
DepositingCash
SelectingChange
GivingChange
PaymentComplete
ReceiptPrinting
Bagging
BagHandoff
CustomerLeaving
TransactionComplete
Recovery

Every state must define:

Entry action
Allowed input
Camera behavior
Player animation
Customer animation
UI state
Audio
Completion condition
Timeout
Recovery path

No input should skip several major physical states.

PHASE 14 — RECOVERY AND SAFETY

Test interruption during:

Product pickup
Product rotation
Scanning
Card presentation
Card swipe
Card processing
Cash presentation
Drawer opening
Cash deposit
Change selection
Change handoff
Receipt printing
Bagging
Bag handoff

Test:

Escape
Browser blur
Pointer-lock loss
Customer timeout
Save/load if supported
Card decline
Card retry
Product falling
Product becoming unreachable
Sale-bank failure
Browser close or reload where practical

Confirm:

No money duplication
No product duplication
No lost products
No early revenue
No sale banked twice
No completed sale marked void
No drawer stuck open
No customer stuck
No queue stuck
No camera stuck
No cursor stuck
No leftover transaction objects
Register returns to safe state

Preserve all existing recovery protections unless replacing them with demonstrably stronger behavior.

PHASE 15 — AUDIO AND FEEDBACK

Add or improve restrained, synchronized feedback for:

Product placement
Product pickup
Product rotation
Scanner activation
Successful scan
Invalid scan
POS item added
Card movement
Card swipe
Card processing
Card approval
Card decline
Cash presentation
Bill handling
Coin handling
Drawer unlock
Drawer open
Drawer close
Change selection
Change handoff
Receipt printer
Paper removal
Bag opening
Bag rustling
Product bagging
Bag handoff
Transaction completion

Avoid excessive screen shake or arcade effects.

PHASE 16 — VISUAL REVIEW PASSES

Complete four genuine visual-review passes.

Store evidence under:

qa/cash-register-production/pass-1
qa/cash-register-production/pass-2
qa/cash-register-production/pass-3
qa/cash-register-production/pass-4
qa/cash-register-production/final

For each pass:

Run a full card transaction.
Run a full cash transaction.
Record both videos.
Capture every major interaction moment.
Inspect browser console.
Inspect page errors.
Open every screenshot.
Watch both videos.
Compare with Designs/CashRegister.
Identify at least ten specific player-visible defects.
Rank defects by impact.
Fix the highest-impact defects.
Rerun both transactions.
Confirm no regression.

Do not count a pass if it only returns "ok": true.

Each pass must include actual visual inspection and resulting fixes.

Prioritize:

Camera composition
Customer framing
Hand scale
Hand poses
Product grips
Barcode readability
Scanner visibility
POS readability
Card alignment
Swipe clarity
Cash visibility
Drawer visibility
Denomination readability
Change clarity
Receipt movement
Bag opening
Product bagging
Bag handoff
Customer reception
Customer departure
Clipping
Timing
Easing
Audio synchronization
PHASE 17 — PERFORMANCE

Measure the same representative scenario before and after.

Record where available:

Average FPS
1% low FPS
Worst frame time
Draw calls
Rendered triangles
Material count
Texture memory
JavaScript heap
Event-listener growth
UI update frequency
Ten-transaction leak behavior

Test:

Idle register
Three-item card transaction
Three-item cash transaction
Ten repeated transactions

Inspect for:

Duplicate event listeners
Duplicate meshes
Material recreation
Texture recreation
Receipt accumulation
Card accumulation
Cash accumulation
Bag accumulation
Customer accumulation
Camera-state leaks
DOM leaks
Unbounded heap growth

Do not invent unavailable metrics.

Report unavailable measurements honestly.

PHASE 18 — TESTING

Run:

Syntax checks
Focused register tests
State-machine tests
Barcode tests
Card-swipe tests
Cash tests
Change-selection tests
Exact-once transaction tests
Recovery tests
Relevant save/load tests
Card Playwright acceptance
Cash Playwright acceptance
Full repository test suite
git diff --check

Do not remove or weaken tests to obtain green results.

OVERNIGHT PRIORITY ORDER

The objective is the highest-quality verified vertical slice, not superficial completion of every checklist item.

Prioritize in this exact order:

Preserve all working transaction, inventory, revenue, queue, and recovery behavior.
Produce one visually polished uninterrupted card transaction.
Produce one visually polished uninterrupted cash transaction.
Fix every visible camera, clipping, hand, product, card, cash, drawer, receipt, and bag-handoff issue exposed by those recordings.
Improve only Blender assets visible in the final recordings.
Complete additional visual passes after both flows are stable.
Run focused tests after every important change.
Run final performance and full regression checks.
Produce exact evidence.

Do not rush low-priority work simply to check boxes.

FINAL ACCEPTANCE — CARD

The final uninterrupted card recording must visibly prove:

Customer approaches.
Customer places at least three physical products.
Player enters cashier mode.
Player picks up each product separately.
Player rotates each product.
Player finds each barcode.
Player physically scans each barcode.
POS updates exactly once per item.
Player stages each product.
Customer presents a physical card.
Camera focuses on the physical reader.
Player hand controls the card.
Mouse movement drives the card downward.
Card remains aligned with the swipe channel.
Reader processes payment.
Payment approves.
Receipt prints.
Player collects the receipt.
Products enter the bag.
Receipt enters the bag.
Player offers the filled bag.
Customer visibly receives it.
Customer leaves.
Inventory decreases exactly once.
Revenue increases exactly once.
Queue advances.
Register returns to idle.
FINAL ACCEPTANCE — CASH

The final uninterrupted cash recording must visibly prove:

Customer approaches.
Customer places multiple products.
Player physically scans every product.
Customer presents visible cash.
Player physically accepts it.
Drawer physically opens.
Player deposits bills and coins.
POS displays tendered amount.
POS displays change due.
Player selects visible denominations.
Selected total updates.
Player can undo a denomination.
Player confirms correct change.
Player hands change to the customer.
Customer visibly receives it.
Drawer closes.
Receipt prints.
Player collects the receipt.
Products enter the bag.
Receipt enters the bag.
Player offers the filled bag.
Customer takes it.
Customer leaves.
Inventory decreases exactly once.
Revenue increases exactly once.
Queue advances.
Register returns to idle.
FINAL EVIDENCE

Create final evidence under:

qa/cash-register-production/final/card
qa/cash-register-production/final/card/video
qa/cash-register-production/final/cash
qa/cash-register-production/final/cash/video

The final report must include:

Implementation
Files changed
Blender source paths
GLB export paths
Assets modified
Camera changes
Hand-animation changes
Customer-animation changes
Scanner changes
POS changes
Card changes
Cash changes
Drawer changes
Receipt changes
Bagging changes
Recovery changes
Evidence
Pass 1 path
Pass 2 path
Pass 3 path
Pass 4 path
Final card video
Final card screenshots
Final card result JSON
Final cash video
Final cash screenshots
Final cash result JSON
Validation
Card acceptance result
Cash acceptance result
Inventory exact-once result
Revenue exact-once result
Queue advancement result
Recovery result
Console errors
Page errors
Full test result
Performance comparison
Remaining Limitations

List every unresolved visual or technical weakness honestly.

Do not claim perfection unless the evidence genuinely supports it.

AUTONOMOUS WORK RULES

Do not ask me questions.

Do not wait for approval unless the tooling itself requires it.

When several options are reasonable, choose the one most consistent with the references, project documents, existing architecture, and commercial-quality simulator presentation.

Use small stable changes.

After important changes:

Run focused tests.
Launch the game.
Capture evidence.
Inspect the evidence.
Fix visible problems.
Continue.

Do not spend excessive time narrating your work.

Do not stop to provide intermediate summaries unless blocked.

If context becomes limited:

Compact the current state.
Record the active checkpoint.
Preserve exact remaining tasks.
Continue without restarting the implementation.

If tool access, usage limits, or an external blocker prevents completion:

Preserve a stable repository state.
Do not leave half-integrated changes.
Write an exact continuation report.
Include completed work.
Include evidence paths.
Include passed tests.
Include unresolved issues.
Include the next five highest-value actions.
STOPPING CONDITION

Do not stop because:

Code compiles
Unit tests pass
Models exist
A drawer opens
Card swipe works
Cash math works
One screenshot looks better
One transaction succeeds
One visual pass finishes

Stop only when:

The final card recording proves the complete card flow
The final cash recording proves the complete cash flow
Both are visually polished
Four genuine visual-review passes are complete
Recovery behavior is verified
Inventory and revenue update exactly once
Queue progression works
Full tests pass
Performance has been measured
Final evidence paths exist
The final report is truthful and complete

Begin now by inspecting the repository, all project instructions, every image under Designs/CashRegister, the current Git diff, and all existing register QA evidence.