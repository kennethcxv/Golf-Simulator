# The Course — Slice Brief

**STATUS: SPEC ONLY.** Nothing in this document authorizes implementation. No code, no
assets, no data files. A slice may only be executed when the owner explicitly names it.

---

## Read this first

**Nothing on the course has been built.** There is course *terrain*, there are course
*systems* in the sim, and there is a course *editor* — but the playable, restorable,
walkable golf course that everything below assumes does not exist yet.

Therefore: **every feature in this document is unbuildable until it does.** This is not a
backlog that can be picked from. It is a record of decisions made in advance, so that when
the course is built the arguments do not have to be had again.

Scope context: `Designs/ROADMAP.md` → "ACCEPTED, GATED ON THE COURSE EXISTING".

---

## What the course is for

The course is where restoration stops being interior decoration and becomes the property.
It is also, currently, a **revenue hole**: golfers check in, walk to the tee, and generate
nothing until they come back. Every feature below is chosen against that fact.

Two rules inherited, not restated in full:

- **complaint → fix → acknowledgment** is the loop. Course work is the hard end of the tier
  ladder — see `Designs/NamedGolfers/SLICE_BRIEF.md`.
- **Physical verbs, not menus** — see `Designs/FoundObjects/SLICE_BRIEF.md` §2. A course
  feature resolved from a screen is a worse version of the same feature.

---

## The beverage cart

A cart attendant working a route around the course.

### Why it earns a place

Right now golfers leave the property the moment they walk to the tee and generate nothing
until they return. **The cart is the only mechanic that puts commerce ON the course**, so
the course earns continuously rather than only at check-in.

Stocking it is a real judgment. You are guessing a whole round's demand in advance, and
**unsold stock is money in the wrong place** — not lost, but not working either. That is the
same class of decision as ordering for the shop, played at a different rhythm and with less
information.

### Two rulings, recorded

**1 — The player drives it early and delegates to staff later.**

Driving it yourself gets the player out onto the property they have been restoring, and
**nothing else currently does that.** The restoration is interior-facing; the course is
where the money and the neglect both are, and the player has no reason to be out there. The
cart is that reason. Delegation comes later, when the player has enough going on that
handing it off is a relief rather than a loss.

(Delegation implies staff, which are cut from Property 1 — so the delegated half is
later-property work by construction. The driven half is not.)

**2 — The cart is a MAINTENANCE OBJECT before it is a revenue stream.**

A neglected course has one with a dead battery, a broken cooler and flat tires. The player
finds it in that state and restores it, exactly like everything else on the property. It
does not arrive as a working revenue tap that only needs stocking; it arrives as another
thing that has been left to rot, and turning it into a revenue tap is the reward.

### The attendant

A **named attendant with a fixation**, written like every other named character —
fictional, hand-written, one grievance tied to one real object, per
`Designs/NamedGolfers/SLICE_BRIEF.md`. Not a fan-service character, not a personality
dispenser, not a shopkeeper who comments on the weather. The same register as everything
else: grounded, dry, deadpan.

---

## Trees

Three versions were considered. All three are recorded, including the rejection, because
"why don't we just plant trees and let them grow" is the obvious idea and will be raised
again by someone who has not seen this section.

### REJECTED — growth simulation

Planting saplings and waiting **does not work at any day length we can ship.** A tree takes
years; our fastest day is 45 real minutes. The two available outcomes are both bad:

- Saplings mature in a week of game time — and nobody believes it. The property's realism is
  the thing the whole game is trading on.
- The payoff sits decades out — and the player never sees it, so the mechanic is a cost with
  no reward.

Farming sims dodge this with crops that grow in days. **We have no equivalent**: there is no
plant on a golf course that both matters visually and matures on a schedule a player will
sit through. Turf grows back, and that is already modelled — that is not a tree.

### ACCEPTED — planting mature trees as course design

The player buys and places grown trees to shape a hole: block the shortcut over a dogleg,
frame a green, force a decision off the tee.

This is a **strategic purchase that changes how golfers play**, not decoration. It is also
the feature that connects most directly to the course editor — our strongest existing
system and a genuine differentiator. A tree placed here is a design decision with a
measurable consequence on the hole, which is exactly what the editor is for.

### ACCEPTED — maintaining existing trees as restoration work

Dead limbs, storm damage, overgrowth swallowing a fairway, roots lifting a cart path.

Same complaint → fix → acknowledgment loop as everything else on the property, and — the
load-bearing part — **it needs no growth system at all.** The tree is already there and
already in bad condition; the work is the same shape as every other repair the player
knows how to do.

---

## Cross-references

- **The loop itself:** `Designs/NamedGolfers/SLICE_BRIEF.md` — course fixations are the hard
  end of the tier ladder, and they are delivered by the **call** channel (the player is
  rarely standing where a course problem is).
- **Physical verbs:** `Designs/FoundObjects/SLICE_BRIEF.md` §2.
- **Scope and what is cut:** `Designs/ROADMAP.md`.
- **The course editor** (shipped) is the natural home for mature-tree placement.
- **Staff/employees** are cut from Property 1 — see `Designs/ProShop/SLICE_BRIEF.md` §4
  "Out of scope" — which is why cart delegation is later-property work.

---

## Not decided here

- What "building the course" means as a slice — holes, tee boxes, greens, cart paths,
  bunkers, water, the walk from the clubhouse. That is a much larger argument and this
  document deliberately does not pre-empt it.
- Whether the cart route is authored, player-drawn, or free driving.
- Whether tree placement costs money, time, or both.

---

## Tooling note (2026-08-10, Goal 18 H7)

**Geometry Nodes is the tool for scattering grass and trees** across the
course: density maps drive distribution, LOD variants come from the same
node graph, and the scatter stays non-destructive in the .blend. Do not
hand-place flora or write bespoke scatter scripts — a density-map-driven
Geometry Nodes setup is the standing approach when course vegetation work
begins.
