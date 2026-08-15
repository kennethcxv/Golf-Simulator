# F5 — the first ten minutes, as someone who has never seen this

**The list is the deliverable. Nothing here is fixed.**

Captured 2026-08-04 on a genuinely clean profile with
`tools/qa/first-run-legibility.js` — the HUD left ON, the beats photographed in
order, so what follows is written from what was on the screen rather than from
what the code says is there. Screenshots in `qa/first-run/`.

Ranked by **how early it happens**, because an early confusion costs every
minute after it.

---

## 1 · A dev entry sits in the shipping menu, one row under Credits
**When:** before the game starts. The very first screen.

The main menu reads: Continue · New game · Load game · Settings · Credits ·
**Test scene: Maintenance Shed**.

A first-time player has no way to know the last one is not content. It is
adjacent to Credits, styled identically, and it is the only entry whose label
promises somewhere to go. Some people will click it first.

## 2 · Thirteen seconds of nothing
**When:** immediately after choosing Relaxed.

Measured: **368 ms** to walk-active, **13.0 s** to the load veil clearing. A
stranger stares at a veil for thirteen seconds with no progress, no tip, and no
sense that anything is happening. B9's stated target was under ten.

That is also thirteen seconds before the first thing they are told, so it
compounds with #3.

## 3 · The one thing the game says is behind the thing it says it with
**When:** the first frame of play.

At spawn the game raises a toast — *"The old tractor sits by the shed, east of
the porch — she'd run again with some work."* — in the top-right. The objective
card, which is the only statement of what to actually do, is `.objectives-card`
carrying *"INSPECT THE FURNISHED BUT NEGLECTED PROPERTY 2/18 — Survey the
neglected property. Look around, then walk toward the clubhouse."*

**It is not visible in either captured frame.** The DOM says it is laid out;
the screen does not show it. So the first and only instruction competes with,
and loses to, a piece of colour about a tractor the player cannot see, has no
reason to care about, and will not find for another twenty minutes.

## 4 · "2/18"
**When:** the same frame, if they find the card at all.

The objective reads **2 of 18**. Eighteen of what? Two are already done — by
whom, when? A first-time player has been given a progress bar for a list they
have never seen, on the first screen, before doing anything.

## 5 · Turn a full circle and the game offers you weeds
**When:** the first fifteen seconds.

Measured directly: standing at spawn and sweeping the view through twelve
headings, the **only** interaction prompt in any direction is
**"Weeds — [E] pull them."**

The objective says *walk toward the clubhouse*. The world says *pull weeds*. The
clubhouse door, thirty feet ahead and dead centre of frame, offers nothing at
this range — so the first verb a stranger discovers is gardening, and the first
thing they will conclude is that this is a weeding game.

## 6 · Ten verbs on one line, permanently
**When:** always, from the first frame.

> Click to look · WASD move · Shift run · E interact · X carry · Z set down ·
> tap/hold F tools · J course editor · Tab overview · P pause

All ten, always, in one strip. Two problems, and the second is the real one:
- **J opens the course editor.** A first-time player who is told, on frame one,
  that a key opens an editor, will press it. There is no reason for a course
  editor to be in a new player's vocabulary in minute one.
- Nothing here is ever *removed*. A hint bar that never changes is wallpaper by
  minute two, so by the time E-to-interact matters it is no longer being read.

## 7 · The building's own name is cut off
**When:** the first frame, and again from the approach.

The clubhouse's exterior board — the club name, "PUBLIC GOLF CLUB",
"COURSE / FIRST TEE · MAIN ENTRANCE" — is hung so high that at the spawn stance
its top line is clipped by the top of the frame. From the porch it reads
"…OLF" and "…N ENTRANCE".

The one object in the scene whose job is to tell you where you are is the one
object you cannot read.

## 8 · A translucent white sheet across the east porch
**When:** as soon as you turn right at the porch.

Visible in `05-looking-around.png`: a large semi-transparent white plane hangs
off the porch's east end, over the rail. It reads as a rendering fault, not as
an object. A stranger cannot tell whether it is scenery, damage they are
supposed to fix, or a bug — and the game is about fixing things, so they will
try to interact with it.

## 9 · The money is a number with no unit of meaning
**When:** the first frame.

`$76,500`, top right, forever. Nothing on screen says whether that is a lot, what
it is for, or what anything costs. The first purchase decision arrives long
before any sense of scale does.

## 10 · "Day 1 · 6:00 AM ▶" — and the ▶ is a control
**When:** the first frame.

The clock chip carries a play/pause triangle that is also the speed control. It
is 12 px, unlabelled, and sits inside a read-out. A player who has been told
"P pause" at the bottom of the screen has no reason to read the top-right
triangle as anything but decoration — and if they do click it, they will not
know what changed.

---

## Not on the list, and why

**The tool belt.** I attempted to measure which tools a fresh profile can
actually equip and the measurement is invalid: `walk.setTool` is exposed as
`walkSetToolDebounced`, so a loop that sets nine tools in one tick reports eight
refusals that are the debounce and not ownership. The finding "only the pressure
washer is available at the start" is **not established** and is not claimed here.
Re-measure with a real delay between switches before believing it either way.

**Everything after the front door.** The capture stops at the porch. What a
stranger makes of the interior — the till, the laptop, the cleaning loop — is a
second pass, and it should be a second pass: eight of the ten items above happen
before they touch the handle, and fixing those changes what they arrive
believing.
