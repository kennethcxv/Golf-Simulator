# THE DELIVERY-TO-SHELF LOOP

Order on the laptop; a labelled carton lands on the pad; you carry it in, cut the tape, open the
flaps, take an armful, walk it to the right fixture and stock it; the shelf visibly fills; it
sells; the shelf visibly empties; you flatten the empty and recycle it.

> **No part of this loop is one E press.** That line from the brief is the whole design. It *was*
> three presses — one set `cut = true`, one teleported the contents into a backroom number, one
> dumped the backroom onto a shelf — and each of those is now a physical act with a verb, a tool,
> or a walk between two places.

---

## The shape of it

| | |
|---|---|
| **`src/data/suppliers.js`** | Who ships what, and what freight costs (base + per box). |
| **`src/data/boxes.js`** | Packaging by contents, units per box, weight, and `planShipment` — THE packer. |
| **`src/data/fixtureSlots.js`** | Every place a unit physically stands. Capacity IS the slot count. |
| **`src/sim/deliveries.js`** | The box as a physical object: tape, flaps, contents, flatten, recycle. |
| **`src/sim/stocking.js`** | Your hands. What you carry, and what goes on what. |
| **`src/render3d/clubhouse.js`** | The boxes, the cutter-in-hand, the armful, the hold verbs (search: physical deliveries). |
| **`src/render3d/courseScene.js`** | Tap-vs-hold, the box cutter tool, weight-on-speed. |
| **`src/ui/laptop.js`** | Supplier / Orders / Deliveries — the freight, the manifest, the nine statuses. |

---

## The manifest is a promise

`planShipment(sku, qty)` packs an order **once**, when you place it. The Orders screen reads that
object to promise you three cases and forty-five pounds; the receiving pad reads the **same object**
to decide what to stand there. Pack it twice — once for the screen, once for the world — and they
drift, and nothing can tell you which one is lying. So there is one packer, and both sides call it.

A golf bag used to ship **twelve to a carton**, because its category is `accessories` and the
per-category rule packs twelve. Packing is per-SKU now, and it knows an iron set is already eight
clubs and a stand bag is its own carry.

---

## The nine statuses are six plus three

`shop.orders` means **in transit** to every reader in the game — the Home page's "on the truck",
Finances' "stock already paid for", the conservation test's on-order units. So a landed order cannot
stay in that list beside its boxes, or every unit is counted twice. It becomes a **shipment**, and
its three floor statuses — *delivered · partially unpacked · fully unpacked* — are **derived from
the state of its boxes**, never stored, because a stored status drifts the first time someone empties
a carton by another route.

- On the road (from `sim/deliveries.js` `ORDER_FLOW`): received → processing → packed → shipped →
  out for delivery → arriving soon.
- On the floor (`shipmentStatus`): delivered → partial → unpacked.

"Arriving soon" now means the last half hour. The old rule flipped an order to "Arriving now" the
instant its two-hour window opened and then said so for the next thirty-seven minutes — a status
telling you to stand at a pad where nothing is happening.

---

## A box is three axes, not fourteen flags

The brief lists fourteen box states. Writing them as fourteen booleans is how you get a box that is
both `empty` and `full` because two code paths disagreed. So a box is: **where** it is (`loc`), **how
sealed** it is (`tape` 0..1, `flaps` [0..1, 0..1]), and **what is left in it** (`qty` against `cap`).
Everything — `boxState`, `shipmentStatus`, the label a prop shows — is derived from those three.

Cutting the tape is a **cut, not a switch**: `cutTape(state, id, amount)` advances the blade by
`amount`, so holding the button runs it down the seam and letting go leaves it **half cut**, which
the save remembers. The centre seam goes first, then the sides.

---

## A shelf holds what it has room for

Capacity was a number in a table (`SHELF_CAP.accessories = 24`) and the renderer was a separate
opinion (`Math.min(count, 12)`), and nothing checked them against each other. A full accessories
shelf drew half its stock; a full ball wall padded the gap with a decorative back row that
represented nothing; a bag platform's capacity was twenty-four stand bags.

Capacity is the **slot count** now (`data/fixtureSlots.js`). The sim refuses to stack past it; the
renderer walks the same list and puts one item in each. Every unit on the shelf is a unit; nothing
on the shelf is not a unit. The last one only showed up by *looking*: gloves laid flat on a board
are edge-on to a standing player, so twenty-four of them read as an empty shelf. They stand up now.

---

## The interaction grammar (tap vs hold)

A held key repeats its keydown ~30×/second. A verb bound to the press therefore fires thirty times —
a machine gun, not a hold. So the browser's own auto-repeat flag splits them:

- **Tap** (fires once on the real press): open a flap, take an armful, flatten, pick up, set down.
- **Hold** (driven per-frame off the held-key set): run the cutter down the tape, stock a shelf in a
  flow. A quick tap on a fixture stocks one; holding stocks a stream.

The **box cutter** is contextual — it appears in your hands the instant you look at a taped carton
and goes away when you look off. A knife you equip from a menu is a knife you fight.

Weight is real: `carrySpeedFactor` slows you from 1.0 (empty-handed) to 0.45 (a 124 lb lounge crate),
which is the argument for a hand truck and for hiring someone.

---

## Running it

```bash
node --test                     # from the repo ROOT only. 496 green.
node tools/serve.cjs            # port 8457
```

**QA harnesses** (Playwright MCP `browser_run_code_unsafe` with `filename`, or copy into
`.playwright-mcp/`):

| | |
|---|---|
| `tools/qa/delivery-accept.js` | order six kinds, land them, half-open two, AUTOSAVE, reload, verify |
| `tools/qa/delivery-loop.js` | the full loop with real key presses: cut → flaps → armful → stock |
| `tools/qa/delivery-shelves.js` | fill every shelf to capacity; count the scene graph against the sim |
| `tools/qa/delivery-boxes-visual.js` | beauty shots: sealed / open-with-contents / fragile / cutter / armful |

The loop harness holds `E` **until the box reports cut**, not for a fixed time — headless rAF is
throttled and runs far fewer frames than 60fps, so a fixed hold under-cuts. Wait for the condition.

---

## What is NOT done

Stated plainly.

- **The armful and the carried box read a little low in frame.** They are camera-attached and sit
  just above the HUD bar; a taller player rig or a lower HUD would seat them better. They are
  present and correct, not prominent.
- **The contents inside a box are representative, not a full count.** A case of twelve dozen balls
  shows a layer of eight, not ninety-six meshes — enough to read "full" vs "half" vs "empty", capped
  so a big case is not five hundred draw calls.
- **The hand truck is named but not modelled.** `STOCKROOM.handTruck` has a spot on the floor plan;
  the oversized-fixture-needs-a-hand-truck rule from the brief is not enforced yet — a heavy crate
  just walks you slowly.
- **No video.** Screenshots only, under `qa/delivery/`.
