# /goal — PRODUCTION ART PASS: REBUILD THE APPAREL TO ACTUALLY LOOK RETAIL-READY

Read this entire instruction before touching code or Blender.

The current apparel assets are **NOT production-ready**, regardless of what the existing PASS tables, assertions, round-trip checks, v2/v3 comparisons, triangle counts, or test suite say.

I am attaching the current turntables. LOOK AT THEM.

They still look like procedural placeholder geometry rather than merchandise that would appear in a polished retail/pro-shop game.

This task is a **visual production-art task first** and a pipeline/engineering task second.

---

# THE MOST IMPORTANT RULE

## REAL RETAIL PRODUCTS ARE THE SOURCE OF TRUTH.

Not v2.

Not v3.

Not the procedural generator.

Not an assertion.

Not a triangle count.

Not "technically one closed shell."

Not whether v3 is slightly better than an already-bad v2 asset.

For every asset, get **3–5 strong real-world references** of the equivalent product displayed in a real retail store or photographed for a retail catalog.

Examples:

* folded Ralph Lauren / Nike / Adidas polo on a retail shelf
* folded premium cotton T-shirt
* folded hoodie/sweatshirt
* folded chinos/golf trousers
* polo hanging on a retail hanger
* T-shirt hanging on a retail hanger
* hoodie hanging on a retail hanger
* trousers on a clamp hanger
* premium six-panel baseball/golf cap
* baseball cap displayed on a retail peg

Keep those references visible while modeling.

The final question for every asset is:

> If this model were placed in a polished Steam game beside a real retail reference, would a player immediately recognize it as believable store merchandise without being told what it is?

If the answer is no, IT DOES NOT PASS.

---

# STOP DOING THIS

The previous work spent far too much effort making tests agree with mediocre geometry.

For this pass:

* Do NOT spend the session inventing more generic assertions.
* Do NOT build another giant generalized cloth framework before fixing the models.
* Do NOT spend five rounds proving that a bad shape is mathematically valid.
* Do NOT call something PASS because it has no self-intersections.
* Do NOT call something PASS because it beats v2.
* Do NOT port one procedural solution to four garments and call four assets finished.
* Do NOT preserve an existing procedural technique just because a lot of work went into it.
* Do NOT use thick tubes/sausages as seams, cuffs, collars, hems, piping, pocket lips, or folds when real clothing would not look like that.
* Do NOT use giant rounded blocks as "folded cloth."
* Do NOT use inflated pillows as folded garments.
* Do NOT leave visible n-gon plates, razor edges, hard caps, floating trim, intersecting trim, buried trim, or detached accessories.
* Do NOT optimize triangle count while the silhouette is wrong.
* Do NOT spend more than roughly 10% of this task on QA tooling.

If the procedural approach is what is making the asset look bad, **abandon it and model the asset properly.**

You are allowed to rebuild meshes from scratch.

---

# ART DIRECTION

The game uses **stylized PBR**, not photorealism and not low-poly clay.

Target:

**clean premium stylized realism, like merchandise in a polished modern supermarket/pro-shop/store-management game.**

Think:

* clear believable silhouettes
* slightly simplified shapes
* physically plausible construction
* soft fabric
* readable folds
* tasteful materials
* restrained detail
* strong forms from normal gameplay distance

The asset should still look good when viewed close enough for the player to inspect merchandise.

It must NOT look:

* inflated
* rubbery
* melted
* clay-like
* toy-like unless deliberately stylized
* procedurally generated
* excessively smooth
* excessively chunky
* constructed from primitives
* like upholstery
* like pillows
* like tubes attached to blocks

---

# CURRENT VISUAL FAILURES

Use the attached turntables as the CURRENT-STATE FAILURE REFERENCE.

## CAP

Current problems:

* crown is swollen and helmet-like
* six-panel construction does not read naturally
* panel seams/piping are much too thick and look like cables
* brim is warped, thick, and shovel-like
* front silhouette is distorted
* crown-to-brim transition looks melted
* embroidery/branding does not sit naturally in the fabric
* cap looks inflated rather than sewn
* rear and side profiles do not resemble a real baseball/golf cap
* peg variant contains geometry that reads as a random detached rod rather than a believable retail display

Rebuild it as an actual premium six-panel baseball cap.

Reference construction should include:

* realistic crown proportion
* six sewn panels
* front panels slightly structured
* rear panels softer
* small top button
* subtle stitched seams
* believable eyelets
* properly curved visor/brim
* brim thickness appropriate for a cap
* natural transition from crown into visor
* embroidery that conforms to the panel instead of appearing as a card
* subtle fabric character

The cap should look good from FRONT, 3/4, SIDE, BACK, and TOP.

---

# FOLDED GARMENTS

The current folded polo, tee, hoodie, and trousers still primarily read as **stacked cushions/mattresses**.

That is unacceptable.

A real folded garment is not a stack of identical rounded slabs.

Look at actual folded clothing.

The silhouette should reveal:

* cloth layers with realistic thickness
* folds caused by the garment's actual construction
* sleeves folded underneath or inward
* slight compression from the weight of the garment
* small asymmetry
* naturally wandering fabric edges
* some areas tightly folded
* some areas softly rounded
* visible construction cues specific to the garment

Do NOT make every ply the same rectangular pillow.

---

# FOLDED POLO

It needs to immediately read as a POLO.

Important cues:

* collar
* collar points
* neckline
* placket
* buttons
* sleeve folds
* hem
* fabric thickness
* subtle stitching
* tasteful logo/branding
* retail fold proportions

The collar cannot look like a rigid crescent, handle, tube, or plastic accessory sitting on top.

The placket cannot look like a raised luggage strap.

Buttons need to be restrained.

Use actual polo references.

---

# FOLDED TEE

It should look like a neatly folded cotton T-shirt.

Needs:

* thin cotton cloth
* believable folded sleeves
* soft but not inflated body
* correct neck rib
* slight edge irregularity
* screen print integrated into the fabric
* appropriate thickness

Do not build a thick rectangular block and decorate it until it resembles a shirt.

---

# FOLDED HOODIE

The current asset looks like cushions with a blob/tube sitting on top.

Rebuild it.

A folded hoodie should clearly show:

* thicker fleece fabric than a tee
* folded sleeves
* hood folded naturally across/behind the body
* hood cavity where appropriate
* kangaroo pocket construction
* ribbed cuffs
* ribbed waistband
* drawstrings
* believable compression
* appropriate bulk

The hood should be unmistakably a **hood made of cloth**, not an oval pillow, molded lid, cylinder, suitcase handle, or hard flap.

---

# FOLDED TROUSERS

Current version looks like folded bedding.

Rebuild around actual trouser construction.

Needs recognizable:

* waistband
* belt loops
* fly/front construction where visible
* pocket cues
* pressed crease where appropriate
* folded legs
* cloth weight
* asymmetric layer edges

Do not put random bars on a folded rectangle and call them pockets or waistband.

---

# HANGING GARMENTS

The current hanging garments are especially weak.

They look like rigid extrusions hanging from hooks.

A retail garment hanging from a hanger is governed by GRAVITY.

Use Blender cloth simulation, sculpted drape, hand-authored deformation, or a combination.

Do not let the procedural system force rigid geometry.

The hanger supports the shoulders.

Everything else falls downward.

Important:

* shoulders sag naturally off the hanger
* sleeves hang rather than project horizontally
* torso has gravity-driven folds
* side seams are not perfectly straight
* hems are not rigid horizontal extrusions
* fabric thickness is believable
* cuffs do not look like pipe collars
* garment volume is plausible
* back shape reads properly
* the hanger actually fits inside/supports the clothing

---

# HANGING POLO

Current model looks like a huge stiff poncho with cylinder sleeves.

Rebuild.

Must show:

* proper polo collar
* realistic placket/buttons
* hanger-supported shoulders
* sleeves dropping naturally
* appropriate torso taper
* subtle gravity folds
* realistic side seams
* cloth hem
* integrated embroidery/logo

A polo hanging in a shop should look attractive enough that a customer would buy it.

---

# HANGING TEE

Use a real T-shirt on a store hanger as reference.

Needs:

* believable shoulder line
* natural sleeve angle
* proper sleeve opening
* neckline ribbing
* gravity folds through torso
* slight side-to-side asymmetry
* thin cotton behavior
* screen print actually following the cloth

No rigid slab body.

No cylindrical sleeves.

---

# HANGING HOODIE

This is one of the weakest current assets.

The current body is too rectangular/poncho-like, the shoulders are unnatural, and the hood does not behave like fabric.

Rebuild substantially.

Needs:

* actual hood volume
* dark interior/cavity
* hood resting naturally behind shoulders
* believable neckline
* drawstrings
* shoulder drape
* hanging sleeves
* cuffs
* kangaroo pocket
* ribbed waistband
* gravity folds
* fleece thickness

The silhouette alone should say "hoodie."

---

# HANGING TROUSERS

Current model looks like two white extruded tubes.

Rebuild from real trousers hanging on a clamp hanger.

Needs:

* proper waistband
* belt loops
* hips
* front rise
* crotch construction
* two distinct legs
* tapered leg silhouette
* pockets
* seams
* subtle pressed crease if appropriate
* gravity folds
* realistic lower hems
* clamp hanger actually contacting waistband

Do not make two cylinders suspended from a rectangle.

---

# FABRIC MATERIALS

Current geometry often looks molded partly because the material reinforces the problem.

Create believable fabric without making it noisy.

Use:

* correct roughness
* very subtle normal detail
* subtle woven/knit breakup
* microvariation rather than a perfect repeating diamond grid
* restrained color variation
* broad soft lighting response

Fabric normals should be subtle enough that the garment still reads at gameplay distance.

Do NOT use obvious tiled procedural patterns that make the garment look embossed or manufactured from rubber.

Different garments should have different fabric behavior:

TEE:
thin cotton jersey

POLO:
slightly heavier pique/knit

HOODIE:
thicker fleece/sweatshirt knit

TROUSERS:
woven chino/golf fabric

CAP:
structured woven cap fabric

Reuse material families where sensible, but do not force the exact same material response onto everything just to keep the material count at zero.

Visual quality wins.

---

# SEAMS / STITCHING / TRIM

Use real garment construction.

Most seams should NOT be giant mesh tubes.

Prefer:

* subtle geometry
* normal-map/baked stitching
* thin raised seams
* edge definition
* proper folded cloth construction

Only use geometry when it produces a visible silhouette or meaningful shadow.

If a seam looks like a cable, hose, worm, sausage, railing, or pipe, it is wrong.

---

# MODELING METHOD

For each garment, choose the method that produces the best result.

You may use:

* normal polygon modeling
* subdivision
* sculpting
* cloth simulation
* shrinkwrap
* solidify
* bevel
* lattice
* proportional editing
* corrective shape keys
* retopology
* baked details
* texture/normal details
* controlled procedural helpers

You are NOT required to solve every garment using the same generator.

In fact, assume that attempting to force every asset through one universal cloth generator is probably a mistake.

Build the asset first.

Generalize code only AFTER at least one production-quality example proves the technique.

---

# CLOTH SIMULATION

For hanging garments, seriously consider Blender cloth simulation.

Use:

1. simplified clean garment panels
2. sewing or appropriate joined topology
3. hanger collision
4. gravity
5. sensible cloth settings
6. pinning only where the hanger genuinely supports the garment
7. settle simulation
8. sculpt/clean final result
9. retopo or optimize afterward if required

The simulation does not have to be the final mesh.

It can be used to obtain believable gravity and fold structure before cleanup.

---

# GEOMETRY QUALITY

Visible surfaces need:

* good edge flow
* no accidental faceting
* no giant n-gons in visible curved surfaces
* no razor-thin visible edges
* no floating objects
* no buried objects
* no accidental intersections
* no detached pieces
* no shading discontinuities
* no bad normals
* no broken tangents
* no obvious modifier artifacts
* correct smoothing

Rigid pieces should have believable edge bevels.

Fabric should not have hard 90-degree machined corners unless the reference actually creates one.

---

# PROPORTIONS FIRST

Before adding details, compare silhouette to the real reference.

For each asset:

### Stage A — silhouette

The silhouette must look correct in:

* front
* 3/4 front
* side
* back
* top where relevant

If the silhouette is wrong, STOP and fix it.

Do not add buttons, logos, texture, stitching, labels, or microdetails to bad proportions.

### Stage B — construction

Then establish:

* collars
* hems
* sleeves
* cuffs
* waistband
* pockets
* hood
* seams
* openings

### Stage C — secondary folds

### Stage D — materials

### Stage E — branding / tags / microdetails

---

# RETAIL PRESENTATION TEST

Do not judge these only as isolated gray objects floating in a studio.

Every completed garment gets TWO kinds of renders.

## 1. Studio QA

At minimum:

* front
* three-quarter
* side
* back
* top or low angle where useful

Good neutral lighting.

No dramatic lighting hiding defects.

## 2. RETAIL CONTEXT

Place it where the actual game uses it.

Folded garment:

* on a shelf or folded merchandise table
* alongside several other garments

Hung garment:

* on a proper retail rail
* next to neighboring garments

Cap:

* on shelf/display stand/peg

Use game-appropriate store lighting.

The retail-context image is the deciding image.

If it only looks acceptable while isolated in a gray studio, it is not done.

---

# REAL REFERENCE COMPARISON

For EVERY asset create a reference sheet/contact sheet showing:

**REAL REFERENCE | CURRENT/OLD | NEW**

Same approximate angle.

Do not only compare v3 against v2.

A terrible v2 makes "beats v2" meaningless.

The NEW asset should be judged against the REAL reference.

You may preserve the v2 comparison for historical evidence, but it is secondary.

---

# QUALITY BAR

I want the assets to look as if they belong in a commercially released polished retail/store-management game.

At normal gameplay distance they should look immediately correct.

At close inspection they should still hold together.

They do not need cinematic garment simulation.

They DO need:

* believable construction
* believable gravity
* believable proportions
* appropriate materials
* clean silhouettes
* clean shading
* intentional retail presentation

Think:

**premium game asset, not procedural tech demo.**

---

# POLYGON BUDGET

Do not butcher quality to satisfy the old triangle counts.

Model the shape correctly first.

Then optimize.

Reasonable final budgets are acceptable if needed, especially for hero merchandise.

A clean 15k-triangle garment that actually looks like clothing is vastly better than a 5k-triangle procedural blob.

Optimize invisible geometry and excessive loops AFTER approval-quality appearance exists.

---

# UV / MATERIAL / EXPORT REQUIREMENTS

Once appearance passes:

* sensible UVs
* consistent texel density
* no stretching on logos or seams
* appropriate atlas use where beneficial
* clean PBR material assignments
* apply transforms correctly
* intentional origin/pivot
* correct dimensions
* no export scrambling
* no missing textures
* no duplicate accidental material slots
* no glTF warnings
* proper runtime orientation
* preserve existing pooling where appropriate

Existing round-trip/export tests may remain.

They are the LAST gate, not the art director.

---

# GAME TEST

After Blender approval:

Load each completed asset IN THE ACTUAL GAME.

Verify:

* scale
* orientation
* shelf placement
* hanger placement
* lighting response
* texture response
* clipping
* camera distance
* LOD/readability

Take screenshots.

If Blender looks good but the game looks bad, the asset is not finished.

---

# PASS / FAIL RULE

An asset cannot be marked PASS because:

* assertions pass
* exports pass
* glTF validator passes
* tests pass
* triangle count is low
* v3 beats v2
* there are zero intersections
* geometry is technically manifold

Those are engineering requirements.

For this task, PASS requires ALL of:

1. Real reference chosen.
2. Silhouette convincingly matches the type of real garment.
3. Garment construction is recognizable.
4. No procedural/block/pillow/tube look.
5. Material reads as the intended cloth.
6. Retail-context render looks believable.
7. New version clearly closes the major visual gap to the real reference.
8. No obvious visible modeling defects.
9. Technical/export gates pass.
10. In-game screenshot still looks production-ready.

If #1–8 fail, technical success does not matter.

---

# WORKING STYLE

Do NOT keep sending me reports after every tiny adjustment.

Work autonomously.

For each asset:

REFERENCE
→ visual fault list
→ silhouette rebuild
→ construction
→ drape/folds
→ materials
→ retail render
→ compare to real reference
→ self-critique
→ iterate until genuinely good
→ technical cleanup/export
→ in-game verification

Do several internal iterations yourself.

Do NOT stop because you reached some arbitrary round number.

If an approach has failed repeatedly, REBUILD instead of continuing to tweak it.

Do not ask me whether a visibly bad version is "good enough."

Use the reference to answer that yourself.

---

# PRIORITY ORDER

Start with the assets where the current modeling approach is most visibly failing:

1. hoodie hung
2. trousers hung
3. cap
4. polo hung
5. tee hung
6. hoodie folded
7. trousers folded
8. polo folded
9. tee folded
10. cap display/peg state

Finish each one as its own art asset.

Shared improvements are fine, but a shared code change NEVER automatically means another garment passes.

Every asset needs its own visual review.

---

# REQUIRED FINAL DELIVERY

Do not give me another giant engineering diary.

When the batch is actually finished, give me:

### Per asset

**Asset:**
**Real references used:**
**Major old faults:**
**What was rebuilt:**
**Final tris:**
**Materials:**
**Blender render:**
**Retail-context render:**
**In-game render:**
**Technical validation:** PASS/FAIL
**VISUAL VERDICT:** PRODUCTION READY / NOT READY

And provide a contact sheet for all ten.

I want to be able to look at the contact sheet for five seconds and think:

> "Those are clothes from a real retail store."

If I instead think:

> "Those are procedural Blender shapes representing clothes,"

the task is not finished.

---

# FIRST ACTION

Before editing anything:

1. Inspect all ten attached turntables closely.
2. Collect real retail references for all ten.
3. Create a visual fault board.
4. Identify which current modeling techniques are directly responsible for the blocky/inflated/procedural appearance.
5. Start with **hoodie hung**.
6. Do not touch QA infrastructure unless a visible defect specifically requires it.
7. Do not report back until hoodie hung has a genuinely convincing REAL-REFERENCE → NEW comparison and retail-context render.

This is an art-quality rebuild, not another assertion-system project.

Make the merchandise look commercially shippable.
