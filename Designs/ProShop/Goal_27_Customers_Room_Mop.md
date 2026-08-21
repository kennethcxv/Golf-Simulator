# GOAL 27 — CUSTOMERS, THE ROOM, AND THE MOP

Three things, in this order. The first two are the biggest gaps in the game and
neither has been touched; the third has failed ten times and gets one last
attempt on a different footing.

**Reference first, always.** Search for real photographs before modelling, put
the reference beside every render via `side_by_side.mjs`, and review off the
turntable at full size frame by frame — never the contact sheet.

**Before you trust any assertion, run it against a known-bad asset and confirm
it fails.** Your own hostile review found parts passing through each other in
nine assets and loose parts in eleven, every one of which the existing checks
passed. Those checks are broken until proven otherwise.

---

# PART 1 — THE MOP HEAD. Rebuilt, or cut.

Ten attempts. Nine parameter passes plus a Blender round, and your own review
still reads: *the strand ring is detached from the red hub and offset sideways,
the head is hollow through the middle, and the shaft passes out through the hub's
top.*

**It was never turntabled.** It went through parameter bisection, not the hero
pipeline, so the frame set you would have caught this in has never existed.

**Start from nothing.** Do not tune the Verlet rig. Model the head as geometry
the way the broom's bristles work — the broom is the one tool that reads
correctly and it is not a solver.

- The head is a **dense flat disc**, roughly twice as wide as deep, matching
  `MopReferenceImage.png`.
- The hub **clamps** the yarn — the shaft enters the hub, the hub grips the
  strand tops, and there is no daylight anywhere between them.
- **No hollow middle.** The yarn fills the disc, it does not outline it.
- The shaft **stops inside the hub.** It does not pass through.

**THE DECISION I AM GIVING YOU:** if a modelled head cannot beat the current one
inside six rounds, **say so and I will cut the mop from the game.** A bucket and
mop standing in a corner costs nothing to look at. Ten attempts is enough, and an
honest "this is not worth more time" is the right answer if it is true.

---

# PART 2 — THE CUSTOMERS. The largest gap in the game.

Every person who walks into the shop. They browse, they queue, they hand me
cards, they stand three feet from my face at the counter all day — and nobody has
ever looked at them. They are also the only **skinned** meshes in the scene,
which is why every static-mesh audit skipped them.

**This is a different discipline from everything you have built.** Rigging,
weighting and animation, not hard-surface parts. Take it seriously and slowly.

**START BY PHOTOGRAPHING WHAT EXISTS.** Light a customer, turntable them, and
show me what is actually in the game before you model anything. If they already
read acceptably, say so — that call was right on the broom and it may be right
here.

Then, if they need work:

- **One body mesh, clothed**, with the golf-shop apparel you are already
  modelling as its variants — polo, trousers, cap. Texture variety, not mesh
  variety.
- **A face that reads at counter distance.** They stand very close during a
  transaction.
- **Hands that can hold things** — a basket, a card, a bag. Sockets, the way the
  tools now carry `SOCKET_GripPrimary`.
- **The rig has to survive the existing animation.** Find out what drives them
  now — walk cycles, browse poses, the counter stance — and do not break it.
  Report what the current skeleton is before you replace anything.

Report triangles per customer AND how many are on the floor at once. A shop with
eight of them pays eight times.

---

# PART 3 — THE ROOM ITSELF

The shop is greybox. Floor, walls, ceiling, trim, door, windows. These are the
largest surfaces in every frame and they are the reason the game reads as a
prototype no matter how good the mop is.

**Photograph the current interior first** and tell me which surfaces are actually
bad versus merely plain.

Then, in order of how much frame they occupy:

1. **THE FLOOR** — a real pro-shop floor. Boards, tile or carpet, with a visible
   material and a grain or pattern that reads at walking distance.
2. **THE WALLS** — panelling, a chair rail, a skirting board, a paint break. Flat
   painted planes are what make a room feel unbuilt.
3. **THE CEILING** — beams, a coffer, or a plain field with real trim where it
   meets the wall.
4. **THE DOOR** — the object seen more than anything else in the game. Frame,
   panels, handle, glazing, threshold.
5. **THE WINDOWS** — frames, mullions, sills, and glass that reads as glass in
   EEVEE, not just Cycles.

**MATERIALS ARE THE HARD CONSTRAINT HERE**, more than anywhere else. The parallel
session measured **~70 ms of cold compile per program**, so every new material
family costs about a second off my first-ever load. The room is big surfaces —
use one wood, one paint, one glass, one trim, and tell me the count.

---

## STANDING RULES

**A blank render is a build failure.** Three of your evidence frames last session
were blank grey images and one was the only frame meant to show a mower's reel. A
frame with no subject must never be citable.

**Every part attached to what it grows out of** — not merely clear of other
parts. The hand shipped as three separate shells and passed every
part-versus-part check.

**Nothing inside anything it should not be.**

**Both Cycles and EEVEE** for glass, screens and anything glossy. The game draws
closer to EEVEE.

Park anything past six rounds and tell me why. Compact yourself when you run low
and carry on — finish and push the asset you are on first so compaction never
lands mid-asset.

Stop and show me after the mop verdict, and again after the customer photographs.