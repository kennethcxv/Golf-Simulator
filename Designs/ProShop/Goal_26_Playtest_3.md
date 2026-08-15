# GOAL 26 — PLAYTEST ROUND 3

New findings first, in this order. Then the verification list.

## P0 — THE CLICK IS HURTING MY EARS

The main menu click sounds like a SPACESHIP UI. Sharp, synthetic, piercing. The
same sound is in the cash register. I cannot play with it.

You sourced the UI set from Kenney's interface packs, which are sci-fi by design
— that is where the "space menu" comes from. Do not tune it, REPLACE it. Warm,
soft, physical: a real button, a felt key, a wooden switch. Quiet and relaxing.
Nothing with a metallic ring or a high sharp attack.

## P0 — THE LEDGER FROZE

Turning pages, I reached page 6 and the screen froze. Reproduce it — turn to page
6 specifically, and past it — and fix whatever is generated on that page.

## 1 — THE SFX AUDITION SWITCHER, BEFORE THE REST OF THE AUDIO

This unblocks everything else, because you cannot hear and I can.

In developer settings, a picker for every sound family: menu buttons, cash
register drawer, cash landing, ledger page turn, ledger pickup, ledger close,
background music. Each family offers SEVERAL DISTINCT OPTIONS — genuinely
different recordings, not one file pitched — switchable while the game runs,
audible immediately.

I audition them, tell you which wins, you make those the defaults.

At least 3–4 real candidates per family. Every one CC0 or CC-BY, every one in
THIRD_PARTY_ASSETS.md. Label them plainly in the picker ("soft wooden click",
"felt key", "muted tap") so I can name the winner.

## 2 — THE CASH REGISTER, THE WHOLE REWARD LOOP

Too loud, too metallic, too strong, delayed. All of it:

- SEQUENCE IT. Drawer opens. Its sound FINISHES. Then cash starts going in. They
  currently overlap and it is noise.
- Cash plays ONLY while cash is moving in. It starts late and runs past.
- Drawer open must be satisfying: latch, slide, stop. Warm wood and soft
  mechanism, NOT a hard metal bang.
- ADD A SOUND FOR PICKING CASH BACK UP when I have given too much. Nothing there.
- Lower the level. It fights everything else.

## 3 — THE LEDGER

- THE SFX ARE STILL WRONG. A real book: clean crisp page turns, a proper pickup,
  a proper set-down. Paper and board.
- IT MUST REOPEN TO THE FIRST PAGE. Put it down, open it again, page one.
  **This REVERSES the persistence clause you closed in Phase 6.** State
  persistence across close was implemented and verified last session and I am
  overruling it. Remove the behaviour AND the test that pins it, and record the
  overrule in the report so nobody restores it.

## 4 — BACKGROUND MUSIC

I do not like the current track. Several options changeable in SETTINGS — player
settings, not dev — plus an off switch. Quiet, loopable, unobtrusive. Licence
each one.

## 5 — THE MOP (see my screenshot beside the reference)

- THE STRANDS DO NOT TOUCH THE RED HUB. They form a RING floating around and
  below it with clear daylight between. They must be clamped into it — the hub
  grips the strand tops, the strands start inside it.
- THE STRANDS ARE HOLLOW TUBES AND I CAN SEE DOWN THEIR OPEN ENDS. That is what
  makes them read as curled or hooked. Cap them, or use geometry with no mouth.
- MAKE EACH STRAND THICKER. Far too thin.
- It reads as a ring, not a disc. The yarn must fill the head, not outline it.

## 6 — ITEMS MUST NOT TOUCH THE BAG

Customer goods must never intersect or rest against the shopping bag. Not
overlapping, not touching. Give the bag its own clearance in the 2.2 layout.

## THEN THE VERIFICATION LIST

**7. FINISH PHASE 3'S VERIFIER ONE.** You were interrupted mid-check: a shopper
sent to a goal behind the blockade got no closer than 4.3 yd, and you were asking
whether it had adopted the goal at all. Settle that first — `sent: true` only
means your splice landed. Never adopted = your staging, verifier still unrun.
Adopted and still short = a real routing failure, and it becomes the next item.
The gate needs the overhead clip and the player-view clip with frames viewed,
plus the reverted-integration control showing the old grinding fails the same
check. Your last clip pointed at a field because the staging put the player
outside the building — fix the staging before recording again.

**8. PHASE 10, VERIFIER 3 — THE STRANGER.** Clean start, no code read, real
input, no developer shortcuts. Can a stranger complete one full customer —
products, a tee time, one payment, bag, out the door — then a second and a third,
without getting stuck, hearing silence where a sound belongs, or hitting a stall?
A finding becomes the next item.

**9. 9.4 — FIX THE EXPLODED RAKE.** Photographed, hands ruled out.
electron-rake-explode-id.js exists to name the geometry — run it, name it, fix
it, re-photograph.

**10. PHASE 7'S MERGE, LAST, AND MEASURE FIRST.** 817 materials over 2482
mergeable meshes is three meshes per material. If dedup must come first for the
30% target to be reachable, say so plainly and do not start.

## TWO DECISIONS ARE MINE. DO NOT GUESS

- **4.1, time compression.** Golfers move at fixed wall speed, so compressing the
  day makes rounds proportionally longer. I decide whether the cap lifts for the
  course population or route distances shrink.
- **5.1's density ruling.** Goal 25 says daylight between bunches stops it
  reading as a brush, with a test behind it; my reference is a packed disc. I
  decide which wins. Strand thickness and the hub connection are NOT part of that
  decision — fix those regardless.