# The first twenty minutes, for someone who has never seen it

Walked cold in Electron on `--clubhouse=pine-hills-v2`, doing what the game says
to do in the order it says it. Evidence in `qa/electron/first-twenty/`, driver
`tools/qa/electron-first-twenty-minutes.js`. Timings are from that run.

Nothing below is predicted. Every defect has a beat number and a screenshot.

## What they CAN do

- **Get into the game and look around.** Menu to a playable first-person frame
  in **7.3 seconds** (walk controller live at 4.4 s, loading veil clear at 7.3).
  No console errors anywhere in the run.
- **Learn the controls without being told twice.** The hint sits along the
  bottom of the screen and now names the player's own keys rather than the
  defaults.
- **Walk to the clubhouse and open the door.** Four seconds of W from the spawn
  is enough to be offered *"Shop doors — E open both · X open left leaf"*.
- **Find out the shop is filthy.** A chip reads *"🧹 Shop condition 9 — filthy"*
  the moment they are inside.
- **Cycle the whole tool belt.** Tapping F walks eight tools and then bare
  hands: vacuum → mop → broom → dustpan → spray → cloth → sponge → trash bag →
  nothing. Every one names itself and most say what they are for
  (*"Scouring sponge · stubborn grime takes repeated passes"*).
- **Clean something and see it change.** Two and a half seconds of held mouse
  with the vacuum took a patch from *"76% dirty"* to *"this patch is clean"*,
  and the shop condition chip moved.
- **See where the mess is.** Holding Q lights the remaining dirt and names the
  two media the held tool can shift.
- **Read the club's own book.** Seven sections, and the pages the club has not
  earned yet are printed as empty lines rather than hidden.
- **Change any setting and have it stick.** Fifteen audited, all fifteen reach
  the running game and survive a reload.

## What they CANNOT do

- **Play golf.** Nothing in the first twenty minutes puts a club in their hands.
- **Serve a customer.** The shop is shut at 6:00 AM and the first-run objective
  is restoration; the till is not part of the opening.
- **Use the pressure washer.** It is not on the F belt — eight tools cycle and
  the washer is not among them. A player who reads `TOOL_SET.md` would expect
  the exterior verb to exist; a player who does not will never know it is there.
- **Find the ledger without looking down at it.** See defect 6.
- **Tell what the objective is from the HUD.** No objective panel is on screen
  at any of the seven captured beats; the guidance arrives as toasts that pass.

## Defects, ranked by how early they are hit

### 1 — the very first frame, before any input (beat 0)

**A geometry artefact across the top-left of the porch roof.** A pale wedge cuts
over the roofline and the left-hand window bay. It is in the first frame the
player is ever given, before they have pressed anything.
`qa/electron/first-twenty/00-spawn.png`. Not diagnosed.

### 2 — the first frame, again

**The first prompt offered is "Weeds — E pull them".** At 6:00 AM on day one,
facing the clubhouse doors, the thing the crosshair volunteers is weeding. It is
not wrong — there are weeds — but the game's opening beat is the building, and
the first verb a stranger is shown should be the one the game wants next.

### 3 — within seconds of walking (beat 2)

**Twenty to seventy frames a second, and a 1% low of 1.9.** Spinning on the shop
floor produced a **1,877 ms** frame. This is the "laggy and glitchy" complaint
and it is the loudest thing in the build. It is a handful of freezes, not a low
frame rate: the same spin done twice costs 2,460 ms of stalls and then 232 ms.
Frames carrying a shadow bake cost 61.3 ms against 9.5 ms for frames that do
not. Report 15, section A.

### 4 — the moment they pick up a floor tool (beat 4)

**FIXED this pass.** The vacuum's hands and head were below the bottom of the
screen, and so were the washer's, and the broom's read as detached for the same
reason. One lift to the hand anchor closed all of them.

The old finding, kept because the reasoning matters:
**The vacuum's hands and head are below the bottom of the screen.** Looking down
at the floor — which is the only way to vacuum — puts the top of the tool's
bounding box at NDC y −1.39, entirely off-frame. The player sees a sliver of
hose. The obvious cause — a grip-to-intake span of 0.796 yd where the floor
solve needs 0.82 — was tested by rebuilding the asset with a proper 1.10 m wand
and is NOT the cause: the hands did not move. Still open.

### 4b — the moment they pick up the broom (beat 4)

**The gripping hand reads as detached from the shaft.** It is not: the palm
measures 0.035 yd from the pole's own axis, which is what a hand gripping a 2 cm
pole measures, and at a pitch where the hand is fully in frame the fist is
plainly closed around it. What the player sees is the hand being CUT OFF BY THE
BOTTOM EDGE at working pitches, leaving a sliver of fingers beside the shaft.
Same root cause as the vacuum above and as the sponge before it was fixed: the
viewmodel hands ride too low. `qa/electron/broom-b3-clear/dn-15.png` against
`qa/electron/wrap-grip/wrap-as-shipped.png`.

### 5 — the moment they try a cloth or a sponge (beat 4)

**Fixed this pass**, and worth recording because it was in the first minute of
handling: the hand stood vertically on the pad with its fingers splayed into the
air. It now lies palm-down on the sponge.

### 6 — as soon as they stand at the front desk

**The ledger cannot be found by looking around.** The book lies on a counter
2.2 yd below the eye. At a browsing pitch the door sign, the tee board or a
delivery carton takes the crosshair at **all 22 stand points tested**. Only by
pitching down onto the book does its prompt appear. The label now says what the
object is, but the discovery problem is a proximity problem and is not solved.

### 7 — the first time they open the book

**One 70 ms freeze on the swing.** Was 112.5 ms; the page build and paint now
happen during the walk-up. One frame is still over 40 ms.

### 8 — the first time they open Settings

**Fixed this pass**: a horizontal scroll bar under the tab strip, and the strip
scrolling out of reach under the Controls list.

### 9 — the first time they rebind a key

**Fixed this pass**: rebinding used to swap, so one keystroke moved two bindings
and only one was asked for.

### 10 — the first time they turn shadows off

**A `GL_INVALID_OPERATION` per draw call, for as long as it stays off.** Fixed
this pass, but it has been reachable from Settings for as long as the toggle has
existed, and it is two clicks from the pause menu.

### 10b — the first time they hover the customer's money

**Fixed this pass**: the outline covered one note of the handful while the click
took all of it. It covers the whole payment now. And in the drawer, where a
click really does give one piece, the outline covers that piece rather than the
whole labelled well.

### 11 — whenever they overpay at the till

**Fixed this pass**: *"OVER BY $2.50 — CUSTOMER RECEIVES EXTRA CHANGE"* drew as
*"…CUSTOMER REC…"*.

### 12 — on the front-desk screen, any time

**Fixed this pass**: the club's own name drew as *"PINE HILLS MUNICIPAL G…"* in
a 322 px box it needs 383 for.

### 13 — later, and reported but not reproduced

**"Tabbing out and back loads a different clubhouse first."** Four methods, the
scene fingerprinted every frame: identical throughout, one clubhouse ever built.
A build log now names both buildings if it ever happens.

**"Tee times read 'x am …'".** Nine front-desk screen states audited; no
tee-time string truncates. Not found.

## The one-line summary

A stranger can boot in seven seconds, learn the controls, walk into their filthy
pro shop, pick a tool off a belt of eight, clean a patch of floor and watch the
condition number move — and that loop reads well. What stops them is that the
frame freezes for up to two seconds while they do it, that the tool they are
holding is off the bottom of the screen, and that the book meant to tell them how
they are doing cannot be found by looking for it.
