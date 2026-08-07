# B1 — Which tools the game needs

Written before Blender was opened, because this is a design answer and not a list.

## The rule I used

A tool earns a belt slot if it is **the only way to perform a verb the player can
tell apart from every other verb**. Not a dirt type — a verb. The player does not
think "this is bonded soiling"; they think "I am scrubbing that". Two tools that
produce the same gesture at the same distance against the same surface are one
tool with two names, however different their dirt lists are.

Everything below is measured against the nine that exist today: `washer`,
`vacuum`, `mop`, `broom`, `dustpan`, `spray`, `cloth`, `sponge`, `trashbag`.

## The six that stay

| Tool | The verb only it performs | Why nothing else covers it |
|---|---|---|
| **Broom** | Push loose debris across a floor into a pile | The only tool that MOVES dirt rather than removing it. The pile it makes is a thing in the world you then deal with — no other tool creates an object. |
| **Dustpan** | Lift a pile off the floor | The other half of the broom's verb, and the payoff for it. Without it the broom makes piles that nothing can collect and the loop has no ending. |
| **Mop** | Wet-clean a hard floor | Floor-height, two-handed, wide arc — the same posture as the broom but the opposite physics: it removes rather than pushes, and it leaves the floor wet, which is a state the room remembers. |
| **Sponge & cloth** (one tool) | Scrub a surface at hand height | The only hand-height verb. Counters, glass, walls, equipment. |
| **Pressure washer** | Blast an exterior surface from a distance | The only ranged tool (reach 7.0 against the next longest at 2.4) and the only one that works outdoors. Standing back and cutting a clean stripe into a filthy wall is a different pleasure from any of the above. |
| **Vacuum** | Lift fine dust off carpet and out of corners | The only tool that takes dust, and the only one whose head goes where a broom cannot: under fixtures, into the angle between floor and skirting. It is also the shop's first real capital purchase, so it wants to feel like an upgrade. |

## The three I am deleting, and what happens to them

**`cloth` and `sponge` merge into one tool.** They are the same object. Same
`toolClass` (`stroke`), same reach (1.2), same pose (`flat`), and — this is the
tell — **the same GLB**: both point at
`asset_077_cleaning_cloth_and_sponge_set_fp.glb`. The player is being asked to
carry two belt slots for one model and one gesture, distinguished only by a dirt
list they cannot see. The merged tool takes the union
(`smear`, `film`, `grime`, `bonded`) and keeps the sponge's name, because
"scouring sponge" says what the verb is and "microfibre cloth" says what the
object is made of.

**`spray` folds into that same tool.** Spray-then-wipe is one beat, not two. The
current design makes the player equip a bottle, spray a patch, equip a cloth, and
wipe it — two tool swaps for one surface. Every game that does this well
(House Flipper included) treats it as a single held object with a two-stage
action: the bottle is in the off hand, the cloth in the working hand. So the
merged tool holds both, left click wipes, right click lays solution on a stubborn
patch. `bonded` dirt requires the solution first; everything else does not. That
preserves the whole reason spray existed — some dirt needs a dwell — without
costing a slot.

**`trashbag` becomes a place, not a tool.** It is `toolClass: 'carry'`, it holds
`debris`, and it duplicates the dustpan's verb with a different container. A bag
you carry in your hands while also holding a broom is a fiction the rig cannot
sell — and the screenshots show why: with the bag out, the hand is a fist round a
neck and the whole lower third of the frame is black polythene. Instead the bin
is furniture that lives in the room, the dustpan empties into it, and the bag
becomes something you change when it is full. The disposal beat survives; the
belt slot does not.

**Net: nine belt slots become six**, and the two that were indistinguishable to
the player become one that does more.

## What that changes elsewhere

- `CLEANING_TOOLS` loses `cloth` and `trashbag` as ids; `sponge` gains the
  union dirt list and a `solution` sub-action.
- `TOOL_VM_FEEL` loses nothing — the merged sponge keeps the `flat` grip, which
  B4 has just fixed.
- The `TOOL_CLASS.CARRY` branch stays; the bin uses it.
- `campaign.cleaningToolsUsed` keys move; the migration is a rename, not a loss.

## The standard "properly built" has to mean

The brief says: **to the standard of the counter, not the old tools.** Reading
what makes the counter (`asset_061_front_desk_counter_shell`) read well and the
old tools read badly:

1. **Chamfered edges.** Every edge on the counter has a bevel; the vacuum's
   floor head is a raw `BoxGeometry`. At viewmodel distance — 0.5 yd from the
   eye — a sharp 90° edge is the single loudest tell that something is
   programmer art.
2. **Material breaks on real part boundaries.** The counter changes material
   where a joiner would change material. The mop is one cylinder of `ash` and one
   blob of `cotton`; there is no ferrule, no collar, no join.
3. **Something to catch a highlight.** The counter has a brass rail and a
   lacquered top. Every cleaning tool is roughness 0.85-0.99 across every part,
   so nothing on them ever catches light, which is why they read flat in every
   screenshot in `qa/electron/hands-on-tools/`.
4. **Detail budgeted at viewmodel distance, not world distance.** These are held
   a foot from the camera and get more screen area than any other asset in the
   game. The density audit (report 14, item 10) put broom, mop and trash bag at
   the bottom of the whole library by triangles per screen-yard.

## Status

This document is the B1 deliverable. The rebuild itself (B2) is scoped against
it and is the largest single piece of work in this brief — six tools authored to
the four criteria above. See `OVERNIGHT_REPORT_15.md` for what has been built so
far and what has not.
