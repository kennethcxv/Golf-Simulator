# Overnight — five blocks, top-down

I am asleep. Make the calls yourself and write down why. Do not stop, do not hand
off, do not wait for me.

**The fitting booth STAYS CUT.** F1 went 58.5% → 73.2% without it and the club wall
is the better use of that wall. Decided — do not revisit it.

---

## Block 0 — I played it tonight. Tool swaps are laggy and the whole thing feels sluggish.

This is the real bug. Every tool swap has noticeable latency and the game is
generally laggy — not one stall, a constant feel.

Your harness says 4.2 ms median and zero frames over 33 ms. **I am telling you the
harness is wrong**, or it is measuring something the player does not experience.
Trust my report over your instrument: you have found four instruments this week
that measured something adjacent to what they claimed. Assume a fifth.

- **Median is the wrong statistic for felt lag.** Report p99, the max, and the
  histogram of frame intervals. A frame at 4 ms and one at 120 ms average to
  something that looks fine and feels terrible.
- **Measure input-to-pixel for a tool swap**, not frame time: keypress to the frame
  where the new viewmodel is actually drawn. That is the number I am complaining
  about. All nine tools, indoors and out.
- **Check the scene is doing what mine does** — customers walking, sim live, clock
  running, stock on shelves. A quiet staged room is not the game.
- **The 300× variance is the same smell.** The outdoor washer's first press read
  17.8 / 44.2 / 128.2 / 933.9 / 3,539 / 5,043 ms across six runs on BOTH builds.
  That is not shader compile. Find what it actually is.

Fix the swap latency so it is imperceptible, and fix the general sluggishness. If
you cannot reproduce it in the harness, that is a finding about the harness — say
so and build the instrument that does reproduce it.

---

## Block 1 — The loading screen. Under 15 seconds.

Over a minute on every launch and it is the most annoying thing in the game.
Target: **under 15 s on a stamped boot**, this machine, launch to veil lift. Cold
boot may be slower; every boot after the first may not.

You already have the diagnosis: no 1 Hz throttle, the main thread is BLOCKED up to
21 s at a stretch, and a MessageChannel loses the same 87 s as rAF (ratio 1.01).
Cooperative deadlines took 170.6 s → 78.0 s. Not enough.

- Do not just shorten budgets and push compiles into my hands mid-play. If you cut
  a stage, prove what it costs the FIRST PLAY — every belt tool, laptop, editor in
  and out, overview — and report the worst block at each.
- **What must be paid once should be paid ONCE and recorded**, not re-derived every
  boot. You showed `renderer.info.programs` counts three.js objects rebuilt per
  session while the stamp tracks real compiles. Find what is redoing work a stamped
  boot has already done.
- **Warming the day** probes 1440 minutes in 10-minute steps, two frames per
  distinct light census. Ask hard whether that sweep is needed every boot or
  whether the distinct censuses cache across sessions.
- Move work off the critical path: after the veil, on idle, or on first genuine
  need with a measured cost. Given Block 0, a short veil with warming finishing
  while I walk to the door is probably the right shape — but only if it does not
  make the walk stutter. Measure it.

**DO NOT ADD LATENCY ANYWHERE ELSE.** A/B the played route before and after — walk
in, every belt tool, ledger, Tab, laptop, editor, exit, door, and the same
outdoors. Report boot time AND the worst block on every one. If 15 s costs a stall
in play, give me the number and let me choose rather than trading it silently.

---

## Block 2 — The belt warm completes one tool of nine.

`warmSummary.belt` reads "1/9" on a warm boot — the 10 s budget goes entirely on the
first equip, so eight tools have never been warmed anywhere. You called it the
cheapest win available, and it is very likely part of Block 0.

Find why it stops at one, get it to 9/9, and give me **one combined number with
Block 1** rather than two that fight each other.

---

## Block 3 — Vertical surfaces are unlit. You named it; now fix it.

Your own words on the club wall frame: it reads dark against a lit room, and that
is the standing defect. It is also blocking the asset session entirely.

Eleven garments, one boot, measured on their own pixels:

| garment  | hung | folded |
|----------|------|--------|
| polo     | 6.4% | 43.5%  |
| tee      | 1.3% | 29.5%  |
| hoodie   | 2.5% | 34.7%  |
| trousers | 5.1% | 35.9%  |

Same garment, same albedo, same maps. **At the same height** still 4.6% vs 43.5%.
Ruled out with numbers: albedo, baked occlusion (off: 6.4 → 5.9), the normal map,
metallicFactor 1.0 with effective metalness 0.000, layer scoping, height. Pure
white lands near 17%.

The room has essentially no fill; everything is lit from straight above. **Not an
apparel problem** — the counter front, the club wall, the wall boards, and the
fronts of your customers. Check an NPC's chest against their shoulders.

Diagnose properly: census, directions, intensities, what ambient or hemisphere term
exists and what it contributes at a vertical normal. Fix it, re-measure the same
eleven garments, re-shoot `01-door-clubs-and-desk.png`. **Target: a vertical surface
within a factor of ~2 of a horizontal one, not 20.**

The goldens are all indoor so this WILL move them. Read every diff image and
rebaseline with `--only`, naming each pose and why. Never accept the set wholesale.

---

## Block 4 — Then step two: wear.

Reference is fetched, credited and read, and your two readings drive it:

- **Worn ground near paving is LIGHTER than the turf** — a pale desaturated
  grey-cream near the paving's value, not darker.
- **Wear is two-toned** — a broad straw-blond halo of dying grass metres wide with a
  narrow darker compacted core through it.

A single-threshold mask is wrong in both directions.

Worn apron beside each tee, walk-off scar at each green, scuffed margin where carts
leave the path. Authored from the course vector as a mask, sampled by the mow flow
field. Judged at eye height in game with the reference beside the frame.

---

## Discipline, throughout

Watch every check fail first. Screenshot what you claim. Read the gate's real exit
code unpiped. The goldens are all indoor, so they certify nothing about the course.