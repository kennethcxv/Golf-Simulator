# THE LAPTOP

The club's operating system, on a real machine, on a real desk.

---

## The bug that caused most of the complaints

The brief listed ten failures. Four of them — *screen too far away*, *interface difficult to
read*, *interface feels like a popup*, *cursor interaction is weak* — were one defect wearing
four coats.

`alignLaptopUi()` ran **twice, on a `setTimeout`**, while the camera was still easing into the
seat and the lid was still swinging. So the `matrix3d` that mapped the interface onto the glass
always described where the screen **had been**.

Measured in the browser: force one extra alignment, and the DOM's bounding box becomes *exactly*
the live quad from the **previous** probe.

```
probe 1   live glass 1275x714 at (162, 65)      DOM 1499x747 at (50, 36)     <- disagree
probe 2   live glass 1210x700 at (195, 78)      DOM 1275x714 at (162, 65)    <- probe 1's glass
```

Permanently one alignment behind. The Fairway Office crumpled into a skewed trapezoid in the
corner of the lid, while the 3D canvas underneath went on painting **its own rival desktop** —
tiles and all — visible in the gaps around it. Two interfaces on one screen. Of course it read as
a popup: it *was* one, floating over a wallpaper.

**It aligns every frame now.** Four projections and a 3×3 solve is nothing, and a transform that
is never cached can never be stale. The interface rides the lid as it opens. Seated drift: **0px**
on all four corners, at every interface scale.

---

## Sitting down is a lens change

Walk mode runs a **66°** field of view — wide, because you are moving through a room.

To fill 80% of the frame with a 15-inch panel through a 66° lens you must sit **8 inches** from
it. At 8 inches the keycaps are enormous, the deck swallows the bottom third of the screen and
the top bezel clips off. The picture is *correct* and looks *wrong* — the same reason nobody
shoots a portrait on a wide angle.

The seated camera gets a **34°** lens and its own near plane. Same 80% coverage, but the eye
lands **17.1 inches** from the glass, which is where a person's face actually is when they read a
laptop. The perspective flattens, the keyboard settles, the bezel stays in frame.

`tests/laptop-seat.test.js` pins both: the coverage band the brief asked for (70–85%), and the
argument for the lens.

---

## The machine was a television

21.6 inches across the deck, with a **23.8-inch display**. Nobody had noticed, because at the old
seat distance it filled the view and there was nothing beside it to judge against.

It is a **15.4-inch, 16:10** laptop now — 14.0 inches across the deck.

The 16:10 is not cosmetic. The interface is a **1024×640 DOM** mapped corner-to-corner onto the
panel. Let the panel drift to 16:9 and every glyph is quietly stretched 11% wide, which reads as
"the font is a bit off" and is impossible to place.

And it has a **bezel** now. It did not: the glass was the whole underside of the lid, edge to
edge, which is why the interface always looked like a panel stuck to a slab rather than a screen
set into a machine.

---

## The shape of it

| | |
|---|---|
| **`src/core/laptopRig.js`** | The physical frame. Pure geometry. Every dimension the renderer builds from. |
| **`src/core/laptopProjection.js`** | The map onto the glass, and its inverse. |
| **`src/render3d/clubhouse.js`** | The machine itself, built from the rig and nothing invented. |
| **`src/main.js`** | Enter, exit, and the per-frame weld. |
| **`src/ui/laptop.js`** | Fairway Office. Sixteen applications. Knows nothing about 3D. |

### One convention, and everything follows

```
       local -Z  <-  the seat. The player sits here and looks toward +z.

  +----------------------------+  +z (far)   -- hinge along X, at the far edge
  |  ####  screen (on the lid) |            -- the lid opens AWAY from the player
  +----------------------------+
  |  [=]  keyboard             |            -- beyond the trackpad, nearer than the display
  |  [_]  trackpad             |            -- the palm rest, closest to the seat
  +----------------------------+  -z (near)
```

So `trackpad.z < keyboard.z < hingeZ`, and the open screen's normal points back at −z.

**The orientation was never wrong.** The brief guessed it might be; it was not. Measured live:
the machine's forward vector dots the chair direction at **1.000**, and the open screen's normal
at **0.956** (with 0.295 of upward recline — a lid leaning back, as it should). The debug gizmos
the brief asked for were built, screenshotted (`qa/laptop/debug/`) and removed, as it also asked.
They proved it once. `tests/laptop-rig.test.js` proves it on every run, which is the version worth
keeping.

### The corners are ordered

`main.js` used to project all four corners and then **sort them by y** to guess which pair was the
top. That guess is only ever as good as the camera angle, and it was never needed — the lid's own
frame knows the answer exactly. `screenCornersLocal()` hands back `[tl, tr, br, bl]` as the seated
player reads them, and the guess is deleted.

---

## Sixteen applications

Home · Pro Shop · Supplier · Orders · Deliveries · Inventory · Pricing · Reservations · Course ·
Carts & rentals · Employees · Finances · Reviews · Analytics · Renovation · Settings

One flat nav rail, grouped. No nested menus. Back and Home in the status bar. Active state, hover
state, scroll, a primary action, help tooltips — and an **empty state, an error state and a
confirmation bar** as shared components rather than per-page improvisation, which is how eleven
pages end up with eleven different ideas of "empty".

The confirmation is never a browser `confirm()`. That is a detached modal — the exact thing the
brief rejected — and it would land in the middle of the real monitor rather than on the laptop's
glass.

### Every number is read live from the sim

Where the sim does not model something the brief asked for, **the page says so, in place.**

> **Golf carts are not simulated.** There is no cart fleet, no cart condition, no cart cleanliness
> and no cart assignment anywhere in the club — `shop.rentalFleet` is rental **club sets**. So the
> Carts & rentals page says exactly that, in an error box, at the top, and then shows the rental
> fleet, which is real.

A page of invented cleanliness and reliability scores would have looked more complete and been
worth less than nothing, because you would have made decisions on it.

### The numbers that had to be recorded first

Three things the applications needed did not exist. They are recorded for real now, not computed
plausibly on a screen:

- **Per-SKU sales.** The shop only kept an aggregate, so Inventory's velocity and days-of-supply
  and Analytics' best-sellers and sellouts had nowhere truthful to come from. There is a per-SKU
  tally now, rolled into a seven-day window each night. **Both** selling paths feed it — the
  offline day simulation *and* the physical register — because a velocity that counts half the
  sales is a lie with a decimal point on it.
- **Order cancellation.** A screen that can watch an order and not stop it is a readout, not an
  application. See below.
- **Yesterday's gate** (`club.prevRounds`), so Analytics can explain the *change* in visitors.
  Without it the delta is always zero and the page is mute.

---

## Cancelling an order must not invent money

The order was **paid for** when it was placed (`addExpense 'shopOrders'`). So cancelling has to
give that money back, and giving money back is where refunds go wrong.

Routing the refund through `addRevenue` would have balanced the **cash** and lied about the
**books**: the day would show a purchase and a mysterious matching income, and every margin on the
Finances page would be wrong.

`economy.unbill()` reverses the original entry instead. Cash back to the penny, the expense line
back down, **no trace** — which is what "cancelled" means.

And it can only happen once: the order is spliced out of the list **before** the refund, so a
second call cannot find it and there is nothing to pay back. There is no window where both are
true.

---

## Running it

```bash
node --test                     # from the repo ROOT only. 461 green.
node tools/serve.cjs            # port 8457
```

**QA harnesses** (Playwright MCP `browser_run_code_unsafe` with `filename`):

| | |
|---|---|
| `tools/qa/laptop-look.js` | measures the seated framing and the projection drift |
| `tools/qa/laptop-tour.js` | all sixteen pages, clicked **where they really land on the glass** |
| `tools/qa/laptop-cycle.js` | sit down and stand up 30 times; counts roots, listeners, the lens |
| `tools/qa/laptop-persist.js` | change prices, order, cancel, rename, autosave, reload, count |

The tour does not call `laptopUi.go('orders')` — that would prove a page renders, which is not the
claim. It moves the **cursor to where the nav button actually lands on the projected quad** and
clicks it. If the matrix were off by so much as a nav row, the clicks would land on the wrong
application and the run would say so.

---

## Landmines

- **Never sleep for state.** Headless rAF is throttled. Wait for the *condition*.
- **`replaceChildren()` stringifies `null`** into the literal text "null". `el()` filters; the raw
  DOM API does not. That is how the Supplier page printed **"nullnull"** above its category tabs.
  Everything goes through `paint()` now.
- **`em`, not `rem`, inside the laptop's stylesheet.** `rem` resolves against the *document* root,
  so an interface-scale setting built on it would do nothing at all.
- **The interface and the panel must be the same aspect** (16:10). Pinned by a test.
- **A degenerate quad returns `null`, not NaN.** The lid is *shut* when the player presses E, so on
  the first frames the glass is edge-on. A NaN there would poison the DOM's transform for the rest
  of the session and nothing would ever put it right.
- **World-space gizmos hang off `scene`, not `interior`.** `interior` carries the clubhouse's own
  offset and would put them 228 yards up the fairway. (It did.)

---

## What is NOT done

Stated plainly.

- **The accessory and decor thumbnails share one carton model.** The clubs were nine identical
  hairlines and are fixed; one level down, a tee bag, a bag towel, a rangefinder and an umbrella
  all render as the same kraft box with a label too small to read at card size. They are real
  renders of the real models — the shop genuinely stocks them as branded cartons — but on a
  product page you cannot tell them apart. Distinct models are asset work, not laptop work.
- **The Orders page shows five states, not the brief's eight.** *Pending, Processing, Out for
  delivery, Arriving now, Delivered* are what the delivery sim actually produces, plus *Partially
  unpacked* read from a box that has been opened and still has stock in it. There is no "Packed"
  state and no carrier hand-off in the sim, so the page does not claim one.
- **A keypress in the ~0.4s after Escape is silently dropped.** `courseScene` decides what you are
  looking at *from the camera*, and for those 0.4s the camera is still easing out of the seat and
  is in the laptop's face — so no prop is under the gaze and the prompt is blank. It self-heals the
  instant the camera is back behind your eyes; nothing is trapped, and 30 sit-down/stand-up cycles
  pass clean. Fixing it properly means changing the shared focus/prop system the register also
  depends on.
- **No video.** Screenshots only, under `qa/laptop/`.
