# The club wall: the room is 0.70 yd short

Item 3. **NOT DONE**, and the reason is geometric rather than an implementation
problem, so it needs your decision rather than another attempt from me.

## What you asked for

> Put the three racks on the retail wall opposite the front desk, so a customer
> walking in sees clubs and the desk in the same frame.

The desk is a south-wall counter at (3.30, 3.35) whose customer side faces
north, and the door is on the entry axis at x −0.8. So the wall opposite it is
the **north wall**, and the framing logic is right: from the mat the north wall
is ahead and the desk is to the right.

## Why it does not fit

A club rack's footprint entry `rack: [1.5, 0.45]` is **half**-extents. Each rack
is **3.0 yd wide**, which the layout test named the moment I placed them
(`rack_drivers rect {minX:-0.40, maxX:2.60}` — 3.0 yd, not the 1.5 I had
assumed).

    three racks          9.00 yd
    the north wall       8.30 yd   (publicBounds x −2.60 → 5.70)
                        --------
                         0.70 yd short, before anything else on that wall

And the north wall is not empty: the fitting booth sits at (−0.35, −3.70) and
eats about 3.1 yd of it, which leaves **5.50 yd — room for exactly one rack.**

The east and west walls are 10.09 yd deep, which is why the full layout puts all
three on the **west** wall at z −3.2 / −0.2 / 2.8, spanning exactly 9.0.

The layout change is reverted; the tree is green (`GATE_EXIT=0`).

## Three ways to have it, and the trade in each

1. **Two on the north wall, putters elsewhere.** Needs the fitting booth moved
   off the north wall first, because two racks are 6.0 yd and only 5.50 is
   clear. Keeps your framing for the two that matter most.
2. **All three on the west wall.** Fits exactly, no other fixture moves, and it
   is the arrangement the full layout already proves. Costs your framing: from
   the door the west wall is on the customer's left and the desk is behind their
   right shoulder, so clubs and desk are not one frame.
3. **Re-author the rack footprint narrower.** A 2.6-yd rack puts three on the
   north wall with the booth moved. This is a change to the fixture itself and
   affects every room that uses it.

My recommendation is **1**: your framing is the point of the request, and the
fitting booth has no reason to be on the north wall specifically — its authored
rationale is only that at ry 0 its curtain faces +x so the shell and the
collision walls agree, which is preserved anywhere.

## One thing worth knowing before you choose

`pine-hills-v3` is presentation-only — `CLUBHOUSE_LAYOUT_VARIANT` resolves it to
`pine-hills-v2`, so **the layout is shared**. Un-cutting the racks puts them in
pine-hills-v2 as well, drawn grey. There is no way to place clubs in the room for
v3 alone without splitting the layout seam, and CLAUDE.md protects v2's plan. v2
gaining three grey rack volumes on a wall that carried nothing looked to me like
the smaller price, but it is your plan and your call.

No photograph exists yet, because there is nothing correct to photograph.
