# THE REGISTER

The counter you work with your hands.

---

## What was rejected, and why the brief was right

The old checkout was one context-sensitive `[E]` on an invisible trigger. Press it to
scan an item. Press it again to total up. Press it again to run the card. Press it again
to cycle a change amount, then `[R]` to confirm. Every verb was the same keypress, and
nothing on the counter ever moved: the customer's goods were flat coloured boxes that
teleported into place, `c.scanned += 1` was the entire scan, the drawer never opened, and
there was no cash to count.

It was a menu wearing a register's clothes, and the brief was right to reject it.

---

## The shape of the thing

Two layers, and the split is the whole safety argument.

| | |
|---|---|
| **`src/sim/register.js`** | The transaction. Pure, no three.js, 45 tests. Every rule lives here. |
| **`src/render3d/clubhouse/registerMode.js`** | The counter. Moves meshes, reports what the player did. **Owns no rules.** |

registerMode never decides anything. *May this be scanned? Is it already scanned? May
payment start? Is the change right? May the sale bank?* — every one of those goes to the
sim. The worst bug registerMode can have is refusing to do something. **It cannot invent
money.**

### The rules, enforced structurally rather than by convention

- **An item is scanned exactly once.** Each carries a `uid` and its own `scanned` flag, so
  two identical Pro-V dozens are two *pieces*. "Scan the same one twice" is not
  expressible, let alone countable.
- **Payment cannot start while anything is unscanned.** The subtotal counts scanned goods
  only — an unscanned item on the counter is a thing the register does not know about,
  which is exactly why you cannot take money for it.
- **Money moves in one place.** `completeSale()`, guarded on `stage === 'done'`. An
  approved card banks nothing. A printed receipt banks nothing. The customer has to be
  walking away with the bag.

---

## Money

Integer cents internally. A drawer holds hundreds of dimes, and `0.1 * 300` is
`30.000000000000004` in float — which would make a till that balances on paper fail to
balance in code.

Shop prices land on arbitrary cents (a $34 polo × 1.15 markup × 0.95 member = $37.15) and
there is no penny in the drawer. So **cash rounds to the nearest nickel and card takes the
exact cent** — what Canada, Australia and NZ each did when they retired the one-cent coin.
The rounding is recorded on the receipt, not quietly pocketed.

```
BILLS  50  20  10  5  1
COINS  0.25  0.10  0.05
```

Five bill wells and three coin cups, matching `DENOMS` exactly. The banknotes are *drawn*,
not modelled — a note IS its print, so they are canvas textures with guilloche linework on
thin geometry. The currency is invented (**FAIRWAY RESERVE**) because printing a real one
would be forgery rendered at 60 fps.

---

## The scan is not a button

The workspace is a production line, and the geometry makes the line obvious. Goods land in
front of the **customer** (west, at the queue head, where they can reach). They cross the
scanner in the **middle**. They end up bagged on the **staff** side, downstream to the east.

The scan volume sits deliberately *between* the staging tray and the bagging mat, so the
natural motion — pick it up there, put it down here — sweeps the barcode over the glass on
the way. **Scanning is what happens when you move an item the way you would move it
anyway.** Drop one into the bag around the side without crossing, and it stays unscanned,
and an unscanned item is one you cannot take money for.

Both surfaces sit *clear* of the volume, so nothing ever registers just by being put down.
`checkout-space.test.js` walks the straight line from tray to bag and asserts it really
does pass through the scanner — if that ever stops being true, the mechanic is dead.

### `segmentHitsBox` — why a fast drag cannot cheat

A mouse moves in jumps. At 60 fps a hard flick carries the barcode a third of a yard
between one frame and the next — clean over a 0.56 yd scan volume and out the far side,
never once sampled *inside* it. A point-in-box check would **miss that scan**. The item
would land in the bag unscanned, the player would swear blind they scanned it, and the
register would refuse payment.

So the test is swept: the segment the barcode actually travelled this frame, against the
box, by the slab method. `register-scanzone.test.js` pins the tunnelling case explicitly.

---

## The workspace was derived, not eyeballed

Two reach circles decide everything:

- player at **(2.80, 5.10)**, reaching **1.55 yd**
- customer at **(1.60, 3.05)**, leaning **1.60 yd** over the counter

Anything a hand must touch lives inside the right circle, and `checkout-space.test.js`
proves it. The first cut put the staging tray a **1.68 yd** stretch away and parked the bag
stack on top of the bagging mat. Both were caught by the tests, not by looking.

**The drawer:** 1.17 yd of staff corridor minus 0.34 yd of drawer travel leaves **0.83 yd**
of standing room against a 0.68 yd player. So you can work an open drawer *and still get
past it* — which is what "enough space to operate the drawer" has to mean.

---

## Running it

```bash
node --test                     # from the repo ROOT only. 427 green.
node tools/serve.cjs            # port 8457

# the models
BL="C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
"$BL" --background --factory-startup --python tools/blender/build_register.py
"$BL" --background --factory-startup --python tools/blender/inspect_glb.py   # LOOK at them
```

**QA harnesses** (Playwright MCP `browser_run_code_unsafe` with `filename`):

| | |
|---|---|
| `tools/qa/register-boot.js` | does it boot clean? run this first — a screenshot of a broken scene looks like evidence |
| `tools/qa/register-sale.js` | a whole sale through real clicks and keys. Set `MODE` to `'card'` or `'cash'` |
| `tools/qa/register-recover.js` | save mid-transaction, reload, count the books |

The harnesses drive the **mouse at projected screen pixels** and press real keys. Nothing
reaches into the transaction. The one thing they do that a player cannot is
`sendToCounter`, which spawns a shopper holding shelf-debited goods so we do not have to
wait on the RNG to produce a two-item cash customer — it skips the *browsing*, not the
*accounting*.

---

## Playing it

Stand behind the counter. `[E]` when someone is waiting.

| | |
|---|---|
| **drag a product across the scanner** | rings it up — the crossing is the scan |
| `[T]` *or click the register* | total it up; the customer reaches for their money |
| **click the terminal** | card: they present · click again to run it |
| **click a note on the counter** | taking their cash IS accepting it |
| `[D]` *or click the drawer pull* | open/close the till |
| **drag a note into its well** | put their money away — you cannot close out until you have |
| **click a note in the drawer** | take it out to give as change |
| **click their open palm** | hand it over |
| **drag the receipt off the printer** | take it |
| **drag each item into the bag** | bag it |
| `[Esc]` | step back — the transaction survives |

---

## THE BUG THAT WAS ALREADY THERE

This is the one worth reading.

`pickFromShelf` debits `state.shop.inventory` the instant a shopper lifts an item.
`removeCustomer` gives it back, so **in memory** the books balanced. On **disk** they did
not: the day-rollover autosave (`main.js:1404`) snapshots `state` live, so a save taken
while someone stood at the counter persisted the *missing stock* but not the *pending
sale*. Reload — every shopper lives in the renderer and none of them survive — and the
units were destroyed outright, with the revenue never arriving.

The codebase half-knew. `clubhouse.js` carries a comment warning that a shopper deleted
mid-hold destroys stock, and routes every removal through one funnel to prevent it. But
that funnel only ran on scene teardown. **The autosave never called it.**

So "in a shopper's hands" is now a real, saved location: `shop.held`. It reaches the
snapshot, and `deserialize()` calls `recoverCheckout()` — every shopper is gone, so their
goods go back on the shelf. No money unwound. Idempotent on a double load.

And a second one, found by playing: `register.abandon()` was wired into `customerGiveUp`
**only** — but `removeCustomer` is the single funnel every shopper leaves through, including
the shop closing at eight. A shopper removed by any other route left the register holding a
live transaction over goods that had *already gone back on the shelf*. Finishing it would
have banked revenue for stock that was no longer sold: money out of nothing, with the player
stranded at a till serving someone who was not there.

`register-abandon.test.js` pins all four exits.

---

## Landmines

- **Never sleep for state.** Three times this session a fixed wait lied. The receipt that
  "never printed" (it printed two seconds later). The camera that hadn't finished easing
  (projecting mid-flight gave a pixel 90 px off, so the click landed on bare counter and
  the run reported `scanned: 0` as though the scanner were broken). Headless rAF is
  throttled — wait for the *condition*, never for the clock.
- **`forward = (−sin yaw, −cos yaw)`.** Yaw 0 faces −z; yaw π faces +z. Setting `yaw = π`
  "to face the counter" points the player at the back wall.
- **A 0..1 canvas needs 0..1 UVs.** The register model's screen face carries a
  `smart_project` atlas UV, so painting a canvas on it samples a magnified corner — the
  register rendered as a black slab. The displays are their own `PlaneGeometry` now, which
  has clean UVs by construction. Same class as `roundedBox()`'s planar world-scaled UVs,
  which cropped a product label into mush last session.
- **`cube()` in the Blender scripts takes FULL dimensions, not half-extents.** Reading them
  as halves put the impulse rack's side panels at `x = ±0.255` on a back only `0.26` wide —
  they floated clear of it, detached in mid-air.
- **Look at every generated model.** `inspect_glb.py` renders previews. It caught the
  detached rack, the basket handle whose arms splayed past the grip, and the drawer whose
  face plate was on the far side (it would have been buried in the counter when the drawer
  slid toward the player).
- **A hard rectangle edge is not a hitbox.** Bagging asked "is the origin inside the
  bagging rect", and two boxes came to rest at `x = 3.201` and `x = 3.299` against a rect
  starting at `3.300`. One missed by 10 cm; the other **by one millimetre**. It is
  proximity to the actual bag now, with a ring drawn at exactly that radius — a hint that
  lies about its own hitbox is worse than no hint.

---

## Current production boundary

The checkout path now includes animated first-person hands for scanning, card, cash,
receipt, bagging, and handoff; animated authored characters; a customer basket that fills,
moves to the counter, and leaves through a defined lifecycle; physical card swipe and cash
handling; a visible live payment timeout with retry; receipt feed/tear motion; bag fill and
customer handoff. Card and cash routes, recovery, interruption/re-entry, and videos are
recorded under `qa/steam-release-polish/`.

Pocket retrieval and individual shelf-pick gestures remain stylized state transitions rather
than bespoke skeletal clips. The small impulse rack remains scenery and is intentionally not
part of the checkout inventory. Neither limitation changes transaction correctness or blocks
the current checkout-first production gate.
