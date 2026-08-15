# PLAYTEST ROUND 2 — six items, in your order

**PROBE-LIE COUNT: 25.** Four new, all mine, all in this block. The worst is #22:
a Tab driver that screenshotted every sample at 4K, where each shot costs ~2.2 s,
and then reported "2.07 s to reach overview, 4.24 s to settle" — numbers that
were the shutter speed of my own loop. The transition had finished before the
first reading was taken. I nearly handed you that as a measurement of the game.

---

## P0 — THE CHECKOUT

### Your question, answered: **EVERY BOOT.** You were right.

`tools/qa/node/p0-relatch-probe.mjs`, three trip sites, each one released and
then saved and loaded again:

| trip site | released | latch on next boot |
|---|---|---|
| malformed WAL | yes | **back** |
| missing WAL + orphan ledger row | yes | **back** |
| incoherent receipts | yes | **back** |

The malformed arm even comes back under a **different reason** than the one it
was released from — out as `malformed-persisted-checkout-journal`, back as
`incoherent-persisted-checkout-settlement`. That difference is the mechanism.
The release rewrites `shop.pendingCheckouts`; `classifyCheckoutJournalCoherence`
derives its verdict partly from the **ledger** — an orphan bank posting with no
replay checkpoint. A release cannot rewrite financial history, so the evidence
outlives every repair and the repair re-derives the same verdict forever.

The load-time repair at `state.js:1961` empties the four shop authorities and
*then* quarantines. It can never converge. **The repair path is the bug, exactly
as you said, and the manager's key I shipped last session was useless against
any genuinely torn save.**

**Fixed.** `checkoutWalQuarantineAcknowledged()` is the one thing a release can
leave behind that the next boot will believe: an explicit release (`active:false`
with a `releasedBy`, which only `releaseCheckoutWalQuarantine` writes) **and**
still-empty authorities. Emptiness is what makes it safe — the accepted loss was
of records already discarded, and any NEW half-committed sale writes a plan, a
receipt or a projection, fails that test, and latches again. There is an
interlock control in the probe that tears the save again after a release and
demands the latch return; it does. 135/135 on the four checkout suites,
including the recovery test that pins the hard-coded pending count.

### But this is not what is wedging you, and I can prove it

**Your save does not have the latch and does not acquire it at boot.** All four
files in `%APPDATA%\GOLF EMPIRE\saves`, run through the shipped loader:

| file | latch on disk | latch after load | till would refuse |
|---|---|---|---|
| autosave.json | absent | clear | no |
| autosave-prev.json | absent | clear | no |
| shed-autosave.json | absent | clear | no |
| slot1.json | absent | clear | no |

This is also the first time I have ever actually read your save, which closes
probe lie #17. Every earlier attempt read `localStorage` inside a fresh Electron
QA profile. Electron does not use localStorage for saves at all — `storage.js`
routes through `window.fairwayNative` and `main.cjs` writes files under
`app.getPath('userData')`. An empty result meant "I cannot see it".

### How to read it yourself

```
npm run save:check              every save on this machine
npm run save:check -- autosave  just one
```

It prints the latch **on disk** and the latch **after load** separately, because
they are different questions: a latch that appears only in the second column is
being set at boot, and clearing it in game will not survive a restart.

The tool is calibrated. `npm run save:check -- --dir=<path>` points it at a
deliberately torn save and it prints `SET`. A tool that has never once printed
SET cannot report "clear" as a finding, which is what it was doing for the first
ten minutes of its life (probe lie #25).

### So what IS wedging you — and why neither of us can currently tell

`checkout.integrityUnavailable` — "Checkout records are unavailable right now.
Try again." — has **277 call sites** in `src/`. Every one carries its own
internal `diagnostic` naming the actual cause, and **not one of them reaches
you**. In `simplifiedRegisterMode.js` alone there are four separate paths that
toast that sentence, and three of them discard the diagnostic entirely; the
fourth passes `result.reason`, which is the same sentence again.

Last session I found one of those 277, reproduced it, and reported it as *the*
cause. That was wrong of me. It is *a* cause, and your save rules it out.

I also tested the reading your symptom most suggested — money taken, customer
never released — which is `completeSale` running twice on one transaction. It is
**not** it: an early `tx.banked` guard returns "Already banked." before the
duplicate path is reached (`tools/qa/node/p0-double-complete-repro.mjs`).

**So I made the refusal say which refusal it was.** All four paths in
`simplifiedRegisterMode.js` now call `reportFault('checkout.refused.<where>', ...)`
with the real `diagnostic`, the transaction number, and whether the sale had
banked or prepared a commit.

It does NOT go in the toast: player copy is localized across ten locale tables
and an English machine code would show on all of them (the ratchet enforces
this). It goes where machine codes belong and where I can actually read it —
`reportFault` writes through the preload bridge into
`%APPDATA%\GOLF EMPIRE\logs\crash.log`, which is the same way I read your save
this round. Rate-limited by origin inside `reportFault`, so a till refusing every
second cannot fill the disk.

**Next time it happens, that file will name the cause.** Send me `crash.log`, or
say the word and I will read it here.

*Honest limit:* I verified the sink end to end — origin, diagnostic text and
context all arrive at the bridge that writes the log. I have **not** watched one
of the four call sites fire during a live refusal, because driving a real
customer sale to failure in the harness was more than the remaining session had.
The plumbing is proven; the trigger is not.

---

## P1 — THE OUTLINE STAYS LIT WHEN YOU PICK THE BOOK UP — **FIXED**

You called the trap before I could fall into it again, and you were exactly
right. Driven with the **real K press**, before changing anything:

| book state | samples | lit | shells | `carried` |
|---|---|---|---|---|
| closed (on desk, aimed) | 1 | 1 | 16 | false |
| **raising** | 2 | **2** | 16 | **false** |
| **held** | 12 | **12** | 16 | **false** |
| opening | 4 | 0 | 0 | false |
| open | 6 | 0 | 0 | false |

`carried` is **false the entire time**. It is the X/Z carry flag — the state you
reach by walking the book somewhere else — and the reading gesture never sets it.
That is why `setCarried(true)` did not reproduce: it was honest about a state a
player does not enter, precisely the G2 trap.

The gate read `!isOpen() && !carried`, and `raising`/`held` are neither. Opening
the book only *appeared* to fix it because the shells hang off meshes inside
`closedShell`, which the open pose hides. `isInHand()` already existed and is
exactly the question — `bookState !== 'closed'`. Verified after the fix with a
control that the raise actually happened.

## P1 — THE OUTLINE IS TOO MUCH — **16 shells → 6, and quieter**

Measured what the sixteen were. The cover's decoration passes any size test
because it spans nearly the whole board:

| kept | thickness |
|---|---|
| `LB_CoverBack`, `_1`–`_4`, `LB_CoverFrontBody` | 7.0 – 84.4 mm |
| **dropped** `LB_BorderInner/Outer_*` | 1.2 mm |
| **dropped** `LB_FaceTitle`, one unnamed plane | **0.0 mm — planes** |

A zero-thickness plane lying on the cover cannot contribute to a silhouette;
shelling it prints a second yellow rectangle inside the first. Thickness
separates printing from boards with no judgement call in the gap.

Two more changes, both from looking at the photograph rather than the numbers:
the rim is now capped at a third of each part's own thickness (an absolute
5.5 mm grown around leaves that sit 1–2 mm apart *merges* them, which is why the
binding photographed as one solid yellow crescent), and opacity drops 0.92 →
0.62 for a dark cover in a dim room.

**One box around the whole book was tried and is worse.** It measured tight —
0.351 × 0.085 × 0.267, the book's own dimensions — and photographed as a pale
slab sticking out past two corners. A back-face shell draws the silhouette of
its own geometry, so a box draws the box: everywhere the book's real shape falls
inside its bounding box fills with yellow. Both frames are kept in
`qa/electron/p1-outline-look/`.

---

## P1 — TAB — **NOT REPRODUCED as described.** Here is what I did find

Timing taken in-page on a rAF loop, after the shutter-speed disaster above.

| | mode flip | longest frame | frames > 100 ms |
|---|---|---|---|
| **from inside the room** (where you stand) | 61 ms | 61.3 ms | **0** of ~650 |
| from the spawn point outside | — | **735.7 ms** | 1 |

Neither is 3–5 seconds. Clip recorded both times and the frames **viewed**
(`qa/tab-map/tiles-14.png` inside, `tiles-26.png` outside): interior, then
course, with nothing in between. No second clubhouse variant appears.

**What the frames do show, and it may be your actual report:** the overview is a
dense field of scattered trees and bushes with no clubhouse and no fairway
visible in it — `qa/tab-map/frames/frame-0316.png`. That is not what a course map
looks like, and it is very much the kind of thing a player would call a test map.
If that green scatter is what you are seeing, say so and I will chase the
overview camera instead of a variant swap.

I stopped at the time rule rather than run a sixth variation.

---

## P2 — FIRST-TIME LAG — **the measurement names the HANDS**

Your bottle-to-dustpan sequence was the experiment. The registry says `spray`
(the bottle) is `hands: false` and drawn bare; the dustpan draws hands.

| | max frame | GL programs compiled |
|---|---|---|
| **A** spray first | 50.9 ms | **+0** |
| A then dustpan | **282.4 ms** | **+8** |
| A then broom | 101.7 ms | +1 |
| **B** dustpan first | **279.9 ms** | **+8** |
| B then spray | 44.1 ms | **+0** |
| B then broom | 99.8 ms | +1 |

Identical bill wherever the dustpan lands. So it is **not** "the first equip of a
session" as I reported last round, and it is not the broom or the mop: it is the
**first frame that draws the hands**. The bottle is free because it compiles
nothing at all — a bare tool never asks for the hand programs, so it cannot pay
for them, and it leaves the whole bill for the next tool that does. The broom's
later +1 is its own viewmodel material, which is why every tool after the first
is cheap but not quite free.

The program delta is what makes this a cause rather than a symptom: 8 programs
arrive on that frame and never again.

**No seventeenth `renderer.compile()` configuration was attempted.** I tried the
different mechanism instead — a real DRAW of the hands behind the loading veil,
equipping through the shipped `walkSetTool` inside the interior warm so the light
layers, grips and viewmodel activation would all be the real ones.

**It did not work, and I reverted it.**

| | dustpan first-equip | programs | broom after |
|---|---|---|---|
| before the warm | 282.4 ms | +8 | 101.7 ms |
| **with the hands warm** | **315.2 ms** | **+8** | **980.9 ms** |

The warm compiled exactly **one** extra program, not eight, so the hands were
never actually drawn by that forced frame — equipping a tool is not sufficient to
put them on screen during prewarm, and something about it made the broom's own
first equip nearly ten times worse. Reverted by file copy with the revert
asserted to have changed the file.

What that failure narrows down: the hands do not draw from a forced composer
frame merely because a tool is equipped. The next attempt needs to find what else
the viewmodel pass requires (a `walk.active` update tick, the rig's own
`setActive`, or the `BROOM_FEEL.camera.layer` sweep) and prove the hands are on
screen in that frame **before** measuring whether it helped. The attempt is kept
at `scratchpad/courseScene-handswarm-attempt.js`.

Your "about 5 seconds" is longer than my 282 ms. On your machine, at 4K, with a
fuller room, the same eight compiles will cost more than they do here — but I am
measuring 282 and you are feeling 5000, and I do not want to pretend that gap
does not exist.

---

## P2 — THE MOP — **built as you ruled: density AND splay AND clumping**

You are right that the rulings never collided, and the reason is worth stating:
**16–24 was never the strand count.** It is the count of bunches a person can
pick out by eye, which is what both earlier rulings were reaching for. The error
in both directions was making the bunch and the strand the same object — at 22
strands each bunch was one 13 mm rod, and at 380 evenly-spread strands there were
no bunches at all.

**252 strands (18 × 14 exactly) at 4.4 mm, in 18 bunches, splay 0.32.** Draw
calls unchanged at 4.

Three mechanisms, none of which works alone:

- **bunches** — anchors are a bunch's place on the collar plus a small offset
  inside it, not a sunflower fill. A sunflower spreads points as evenly as a disc
  can be covered, which is exactly the gapless barrel that read as a brush.
- **a bunch flares as one** — the outward direction is the bunch's, not each
  strand's own azimuth, so a bunch leans and buckles together instead of
  dissolving the moment the head touches the floor.
- **splay is a force, not a pose** — seeding the strands flared does nothing; the
  first constraint pass pulls them plumb and it is a barrel again by frame two.

### Your question: what does splay cost 4.4's dynamics? **Nothing.**

All seven dynamics tests pass unchanged — at-rest stillness, trailing, floor
spread, whip, determinism, frame-rate independence, collar. What splay *did* do
was expose two latent bugs that were invisible while the counts happened to
divide evenly:

- the splay forces did not sum to zero for arbitrary strand counts, so the yarn
  hung off-axis — **13.8 mm against this file's own 4 mm bar** at the test's own
  count of 48. The bundle mean is now subtracted; zero by construction.
- the collar ring itself was not centred when the count did not divide by the
  bunch count. Centred now.

Both are no-ops for the shipped 252/18 — which is the worst way for a bug to be
wrong, because it hides until someone changes a number.

**The test is updated to the new band and says so.** `strandCount 16–24` is gone;
it now asserts `clumpCount` 16–24, ≥8 strands per bunch, a strand under 8 mm
across, and that a bunch stays narrower than the gap to its neighbour. The
comment carries your ruling verbatim and records that it supersedes 16–24.

**Photographed** at the player camera at splay 0.55 and 0.32
(`qa/mop-reference/mop-goal25r2-splay055.png`, `-splay032.png`). Honest read:
both are clearly finer than the 22-rod comb and neither is the 380-strand barrel,
but at player-camera scale **I cannot separate the two splay values by eye**. I
shipped 0.32 as the more hanging of the two. If you want it flatter or fuller
that is one number and I will not sweep it.

---

## THE FOUR NEW PROBE LIES

22. **A Tab driver that measured its own shutter.** 4K screenshots at ~2.2 s each,
    reported as the game's transition time. Sample 00 landed at 2068 ms.
23. **`window.__fw.app.courseMode`** — `window.__fw` *is* the app. Read the wrong
    object, got `null`, and the driver concluded Tab never fired when it had
    worked correctly. The same mistake silently produced `ledgerOpenFlag: null`
    in the outline driver, where I did not notice it.
24. **Pressed Tab from outside the clubhouse** — a true finding about a place you
    do not stand when you press it.
25. **`inspect-save.mjs` reported "no save has an active latch"** before it had
    ever been shown to print SET. Caught and calibrated before it reached you,
    but it was an uncalibrated green for the first ten minutes.

---

---

## THE GATE

| piece | result |
|---|---|
| `npm test` | **3614 / 3614** |
| golden capture + diff | **13 / 13 ok** |
| golden one-pixel control | **OK** — a single flipped pixel still fails the strict diff |
| vendor-models `--check` | 126 up to date, 0 problems |
| lint ratchet | **325 vs 324** — the inherited red, unchanged by this block |

**The mop needed no rebaseline.** `tool-mop` moved 0.392% against its 0.75%
budget, so the new yarn is inside the gate's own tolerance and nothing was
accepted to keep the row green. `bag-packed` also captured this run (0.1276%)
after being NOT CAPTURED last round.

---

## WHAT IS NOT DONE

- **The 277-cause error message.** The real P0 defect and the reason your next
  report will be as hard to act on as this one.
- **The hands prewarm.** Diagnosed precisely; the draw-behind-the-veil attempt
  failed and was reverted (see P2 above). Still the right direction, but the next
  attempt must prove the hands are actually on screen in the warm frame first.
- **Tab.** Not reproduced; needs one datum from you about whether the green
  scatter overview is what you are calling the test map.
- Inherited lint ratchet red: 325 vs baseline 324, untouched by this block.
