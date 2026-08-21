# GOAL 27 — TEN HERO ASSETS, MODELLED AND REVIEWED UNTIL THEY ARE GAME READY

One subject: **the ten objects a player looks at closely must look like real
objects.** Modelled in Blender, wired in, photographed, and torn apart by a
reviewer who is not on your side.

---

## THE ASSETS

Hero means **the player sees it from eighteen inches** or stares at it while
doing something. That is the whole selection rule.

Propose your ten in the report before you start, from this list and your own
knowledge of the game, and say why you dropped anything you dropped:

1. **The hands** — both, every tool. Asked six times, never delivered.
2. **The mop head** — nine passes of parameter tuning, last frame showed the head
   **detached from the shaft entirely.**
3. **The ledger book** — closed and open. The player reads it.
4. **The cash register / till** — the drawer, the monitor, the body.
5. **The shopping bag.**
6. **The dustpan.**
7. **The spray bottle.**
8. **The cloth or sponge.**
9. **The bunker rake** — currently a detached hand floating in the sky.
10. **The credit card in the customer's fingers** — reported flat and phasing
    through.

The broom head is **already good.** I looked at `broom-v1-lit.png` and it reads
as a proper push broom. Leave it alone.

---

## HOW TO WORK

### Reference first, every time

Before modelling anything: find reference. Search the web for photographs of the
real object. Check `Designs/ProShop/Images/` for references I have already given
you — the mop and hands both have one. Look at how comparable games solve it.

**Put the reference in the report beside your result.** A model with no reference
is a guess, and this project has eight rounds of guesses on the mop to prove it.

### One asset at a time, all the way through

Model → wire in **replacing** the procedural build → light the room → photograph
at the default player camera **and** at a close framing → review → iterate →
next. Do not start a second asset while the first is "almost there."

### The plumbing, already solved — do not rediscover any of this

- **Blender 5.1.2 drives headless:** `blender --factory-startup -b --python <script>`.
  **Do not pass `--noaudio`** — Blender 5.1 consumes it as a filename and exits
  having done nothing. Two runs looked like hangs and were that.
- **Axis:** Blender **+Y → glTF −Z**. Established by marker probe off exported
  accessor bounds. **Bake it into the vertices, not an object rotation** — the
  exporter reports `nodeRot: null` because it bakes transforms, and the runtime
  swap takes geometry only, so anything left at node level is silently dropped.
- **`tools/qa/lib/tool-photo.mjs`** is a working photograph recipe: golden tool
  pose, waits for the drawable mesh count to plateau rather than sleeping,
  re-equips if the deferred warm steals the tool, re-asserts before the shutter.
- **LIGHT THE ROOM.** Every frame taken before this was at 6:01 AM in an unlit
  filthy clubhouse and none of them were judgeable. Set the clock to about 13:00
  **before equipping** — the clock jump unequips the tool.
- **`contextIsolation: true`.** A driver sees only globals it sets inside
  `page.evaluate`. Module-set globals read as `null` and that means nothing.
- **The golden gate** has per-pose budgets: 0.75% for tool poses, 0.25% static.
  A deliberate mesh change is absorbed unless it is a large silhouette shift.
  `tool-mop` sits at **0.7349 against 0.75** — a remodel will turn it red, which
  is correct. Show me the frame and I will accept it.

### The mop's specific bug

In the last frame the strand ring was **floating well to the left of and below
the red hub, attached to nothing.** That is a broken transform, not a proportion.
It also means every bisection number measured hem width and drop on geometry in
the wrong place. Whatever parents the new head will have the same problem — find
it before you model.

---

## THE ADVERSARIAL REVIEW, AND IT IS THE POINT OF THIS BRIEF

After each asset is wired and photographed, **run a review as a hostile lead
artist on a shipping game.** Not encouragement. The job is to find what is wrong.

The reviewer works **only from the frames and the reference.** It does not read
the model script, does not know how hard anything was, and does not care.

It answers these, in writing, every time:

- Does this read as the real object at a glance? If not, name the first thing
  that gives it away.
- **Silhouette:** would you recognise it as a black shape?
- **Proportion:** measure against the reference. Name what is too long, too thin,
  too fat, too short.
- **Materials:** does it read as the substance it is meant to be — wood, metal,
  cotton, paper, plastic — or as coloured geometry?
- **Construction:** visible seams, floating parts, parts that interpenetrate,
  parts that are obviously primitives.
- **Function:** does it look like it would work? Would a hand hold it there?
  Would that clamp hold that yarn?
- **At distance:** does it survive the default player camera, not just a close-up?
- **Cost:** triangles and draw calls against comparable assets in the project.

**It ends with one word: SHIP or ITERATE.** If ITERATE, it lists the faults in
priority order with a specific change for each.

Then you fix them and it reviews again. **Loop until it says SHIP.**

If three review rounds pass without measurable improvement, say so plainly and
tell me what the ceiling is and why — do not grind. The last session claimed a
ceiling that turned out to be false because a loft profile can be **any closed
curve, not just an ellipse**, and two "impossible" fixes then landed in one round.

---

## WHAT WOULD MAKE THIS SESSION A FAILURE

- Three assets that are almost there. **One that ships beats three that do not.**
- A frame taken in the dark.
- An improvement reported from a measurement rather than from looking.
- A model that is built and not actually in the game — verify adoption by reading
  what each mesh **draws** off the scene graph, never a global you set.

---

## REPORTING

`Designs/ProShop/GOAL_27_ASSETS_REPORT.md`. Per asset: the reference, the
model's triangle and draw-call count, every review round with its verdict and
faults, the frames, and a plain statement of SHIP or not.

**Stop and show me after each asset ships.** I have eyes and you do not — one
round trip per asset is cheap and it is the only thing that has reliably worked.

Push after every asset. Work continuously; stop cleanly when you cannot continue.