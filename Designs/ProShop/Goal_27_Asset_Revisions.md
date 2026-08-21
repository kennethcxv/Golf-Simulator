# GOAL 27 — REVISION PASS ON THE SHIPPED ASSETS

I looked at all of them. Six need work before the shelf. Same loop as the wand:
render, open every frame at full size, faults by frame number, fix, render again.

The shelf waits until these are done.

---

## 1. THE BASKET — two faults

**THE HANDLE BASE DOES NOT CONNECT TO THE GREEN BODY.** The handle roots sit on
the rim rather than in it. This is the same class as the wand's hose fitting —
the flange was wider than the thing it bolts to, so nothing landed inside — and
the fix there was to model the SHANK a real part has. Do the same: the handle
pivot needs a boss that actually enters the body wall.

Assert it, and remember the control lesson: **a break has to exceed the overlap
it undoes.** A 30 mm shove does not detach a 30 mm shank. That has now caught
you three times.

**IT IS TOO LINEY — SMOOTH THE GREEN.** The ribbing reads as a corduroy pattern
of hard lines rather than moulded plastic. Soften it: fewer, shallower ribs with
rounded profiles, and smooth shading on the body walls. A real hand basket has
texture you notice on the second look, not stripes you see first.

---

## 2. THE CHECKOUT BAG — TOO PERFECT

It reads as a CAD box. A real grocery bag has been folded flat, opened, and
handled: the gussets crease unevenly, the walls bow slightly, the rolled rim is
not a perfect rectangle, and the base has fold lines from being flattened.

Give it that. Not damage — **use**. The silhouette should have a little slump and
asymmetry so it looks like a bag that has been picked up rather than extruded.

**Keep the measured interior.** Report it again after the change: floor rectangle,
wall height, opening rectangle. Those numbers are what the counter layout clears
goods against, and softening the walls must not lose them.

---

## 3. THE LEDGER — I HAVE NEVER SEEN IT CLOSED

Every frame you have shown me is the open book. The brief asked for closed, open,
and a leaf mid-turn. **Render the closed state properly** — full turntable, all
eight frames, cover and spine and fore-edge — and show me that before anything
else on this asset. It may already be fine; I cannot tell, because I have not
seen it.

---

## 4. THE MONEY — three changes

**REMOVE THE MASTERCARD SYMBOL.** There are interlocking circles on at least one
card. Even as a near-miss that is a copyright and trademark risk. Replace every
scheme mark with invented ones — an abstract glyph, a chevron, a geometric shape
that resembles no real network. Sweep the whole atlas for anything that reads as
a real brand.

**THE DESIGNS NEED MORE THOUGHT.** They read as flat colour swatches with a chip.
Real cards have gradients, a bank wordmark area, a card-number band, a holographic
patch, embossed or printed numerals, a signature strip on the reverse. Give them
composition — one premium metal-look, one plain debit, one bright consumer card,
one corporate. **Make them look like cards somebody designed.**

**THE CASH NEEDS GREEN, and better design.** Currency reads as green — that is the
single strongest cue that a rectangle is money. Add proper denomination layout:
a portrait oval, corner numerals, a border pattern, a serial band, distinct colour
accents per denomination. Same for the coins: rims, reeded edges where real coins
have them, a readable device on the face, distinct sizes already in place.

All still generic. No real currency reproduced, no real bank names.

---

## 5. THE CASH REGISTER — the biggest revision on this list

**THE DRAWER LAYOUT IS BACKWARDS.** Notes go in the TOP tray, coins in the BOTTOM.
Restructure it: a full-width note tray across the top with enough clearance for
bills to lie flat, and coin wells beneath. Report both levels' interior dimensions
and the clearance above the note tray.

**IT IS A GREY BOX AND IT IS BLAND.** This is the reward loop and I look at it
through every transaction. It needs to be a designed object: a moulded shell with
real part boundaries, a raised keypad bezel, a receipt slot, a coin-return lip,
a branded faceplate area, panel gaps and a parting seam. The wand's clamshell
seam trick worked — a material break on a real part boundary, costing no new
material. Do that here and more.

**THE BOX UNDER THE MONITOR STAYS CLOSED WHEN THE DRAWER OPENS.** The drawer
slides but the housing beneath the monitor does not move or open with it. Work
out what that box is meant to be and make it behave — either it opens as part of
the drawer or it is a fixed part of the shell that should not read as a drawer at
all.

**MATCH THE MONITOR TO WHAT IS IN THE GAME NOW.** Look at how the register screen
currently renders in-game and design the monitor to match that — same aspect,
same bezel proportion, same mounting. It should look like the thing I already use,
not a generic screen.

---

## 6. THE PRESSURE WASHER WAND — one fault

**THE BOTTOM HANDLE PHASES THROUGH THE BLUE PART.** The grip and the shell
intersect rather than meeting at a join. Fix the join properly — the grip should
socket into the body, not pass through it.

**AND MAKE IT MORE ACCURATE TO A REAL PRESSURE WASHER.** Find reference. A real
trigger gun has a safety catch, a swivel inlet fitting, a quick-connect coupler
with a pull collar at the lance tip, a moulded finger relief, and a hose that
enters at an angle rather than straight down. Right now it reads as a shape that
suggests a pressure washer rather than one somebody has held.

---

## THE ORDER

Register first — it is the biggest change and the thing I look at most. Then
money, basket, wand, bag, and the ledger's closed render last since it may need
nothing.

Same assertions, same broken-variant discipline, same six-round park rule. Both
Cycles and EEVEE for the register's screen and anything glossy.

Stop and show me when they are all revised.