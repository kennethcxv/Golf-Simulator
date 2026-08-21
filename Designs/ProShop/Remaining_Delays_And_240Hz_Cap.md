# THE REMAINING DELAYS, AND A REAL 240 Hz CAP

Walking, the door, the ledger, the belt — all genuinely smooth now. Five things
still stall, and they have a common shape you already named.

---

## READ THIS FIRST

**All five stalls happened AFTER the warms ran, on a stamped boot, in one played
session.** The warms are drawing under a state that is not the state play enters
these surfaces with — the same defect as the door and Tab a week ago, now showing
on the surfaces nobody warmed under the *played* state.

**And one number from last night is the likely reason it keeps recurring:** the
prewarm's own state warms happen before the player has ever moved, opened
anything, held anything, or advanced the clock. **Every one of these five is a
surface entered from a state the warm never occupied.**

Attribute each one the way you attributed the door: arrivals, uploads, or main
thread, with the number. Do not guess.

---

## THE FIVE, IN PLAY ORDER

**1. TAB — about 10 seconds.** You measured this at 1 arrival after the last fix.
It is ten seconds in my hands. Measure it again in a played session, not from a
fresh boot: walk in, move around, hold a tool, then press Tab.

**2. THE LAPTOP — full bar, then ~10 seconds.** You measured 951 ms cold and
290 ms warmed. Ten seconds in play. The bar is still lying, and whatever it is
now is not what you measured.

**3. A LAPTOP TAB CLICK — slight delay.** The nav inside the laptop. Smaller, but
it is the same family.

**4. THE COURSE EDITOR'S FIRST TEE — ~10 seconds before it appears on screen.**
The editor itself opened fine. Clicking a tool inside it stalled. That is a
per-tool cost nobody warmed.

**5. LEAVING THE EDITOR, THEN THE BROOM — 5 seconds.** And then the front door
delayed again on the way out. **Both of those surfaces were fixed and both came
back after an editor round trip**, which is the sharpest clue in this list: the
editor's exit is leaving the renderer in a state the warms did not cover, so
already-warmed surfaces recompile.

**Start with 5.** If exiting the editor invalidates warmed state, it explains why
the broom and the door regressed in the same session — and possibly why Tab and
the laptop did too.

---

## THE FIX SHAPE

Not more warms bolted on. **Warm under the states play actually reaches, and
verify from a played session rather than a fresh boot.**

Your own tripwire already exists: any program arriving after the veil lifts logs
itself with its nearest-twin diff. **Run a full played session — walk in, tools,
ledger, Tab, laptop, laptop tabs, editor, editor tools, editor exit, tools again,
door — and read the tripwire at the end.** Every row is a surface the warm
missed. Fix them as a set, not one at a time.

If some cannot be warmed at boot because they depend on state that does not exist
yet, then **warm them on first entry behind a brief cover** rather than in the
player's hands — and say which ones you did that for and why.

---

## AND THE FRAME CAP — MAKE IT REAL

You found the cap is inert: `everyNVsyncs` was 1 and `skippedTicks` 0 at 60, 144
and uncapped, because it infers the panel from rAF gaps and on a GPU-bound frame
that is the game's own rate, not the display's.

**Fix it properly:**

- **Get the refresh rate from the OS, not from rAF.** Electron's `screen` API
  reported 240 correctly when your probe said 60. Use it.
- **Add 240 to the cap options** — my panel is 240 Hz and there is no setting for
  it.
- **Make the cap actually skip.** Prove it: at cap 60 on a 240 Hz panel,
  `everyNVsyncs` must be 4 and `skippedTicks` must be non-zero. At 240 it must be
  1. If the numbers do not move, the cap still does not work.
- **Then measure presented-frame intervals at each setting** — 60, 120, 144, 240,
  uncapped — with held W and mouse sweep, and report median, p95, p99 and
  interval variance for each.

**Tell me which setting is actually smoothest on this machine**, because I would
rather run a locked 60 than an uneven 90.

---

## RULES

**Verify from a played session, not a fresh boot.** Every one of these five
appeared after real play. A driver that boots, warms and immediately presses the
surface is measuring the warm, not the game.

**Screenshot or clip every acceptance and look at it.**

**Watch every new check fail on a known-bad case first.**

**Read `npm run gate`'s real exit code** — you were bitten twice by `| tail`
masking a failing suite. It is in HARNESS_DEBT; use it.

Goldens and the one-pixel control after anything that renders. Compact at 80% and
carry on.