# THE NIGHT: FINISH THE MERGE, THEN CLOSE THE WEEK

Everything below is something I have asked for and that is still open. It is
ordered by what I will notice first. **Work it top-down and stop when the night
ends, not when you run out of ideas.**

Where an item names a finding you already made, that is deliberate — most of
these are things you diagnosed correctly and then left.

---

# BLOCK 0 — FINISH THE MERGE. Nothing else starts until this is committed.

The merge is in flight and mostly landed: 779 files, one golden conflict resolved,
the v5 garments wired through `HERO_GARMENTS`, the COLOR_0 bake fix in
`merch.bake()`, table and rail frames photographed and correct.

**Close it out:**

- **Read the gate's real exit code**, unpiped. It failed once already on the
  merged tree — the exact combination that had never been tested. Settle
  `tool-mop` properly: 24.4% was a capture pointing at the ceiling, so prove it
  is staging and not a regression, or rebaseline with `--only` and say why.
- **Commit and push.** Both branches have been green separately for a week and
  the merged tree is the thing that ships.
- **Then tell the asset worktree it can move** — it is holding at
  `playtest5/assets` waiting for this.

**Two things about the assets, which you already measured:**

- **The eleven apparel + towel are baked and wired. Good.**
- **Driver, putter, iron and counter have `img 0` and no `COLOR_0`.** They never
  went through the bake. **Do not wire them** — they would ship flat-coloured,
  which is the exact fault the v7 bake existed to fix. **Leave the counter
  greybox and say so.** Baking those four is Block 5.

**And record, do not fix tonight:** `PoloPique`, `TrouserTwill`, `TeeJersey` and
`TeeFJersey` are wired but no SKU asks for them, and `shorts1` has no v5 model.
Those are merchandising decisions, mine to make.

---

# BLOCK 1 — THE EDITOR CURSOR. Small, and it is what I hit every time.

**Terrain and Paint show me nothing.** No cursor, no ring, no indication of where
the edit will land or how big it will be. Every other tool gives me a ghost;
these two have only the brush ring, and it never appears.

You know the mechanism — `setEditorBrush` exists and your boot warm calls it. The
bug is that **nothing calls it until a pointer move lands over the course.**

- Ring visible the moment Terrain or Paint is selected, **before I move the
  mouse**.
- Shows the real **radius and falloff**, not a point.
- Updates live when I change brush size.
- Never blinks out between tools.

**Verify by screenshot, not by timing.** Select each, screenshot without moving
the mouse, change the size, screenshot again. Show me the frames.

---

# BLOCK 2 — THE NPCs: MAKE THEM READ AS PEOPLE.

The crowd solver worked. 11.69 → 0.01 shoves/second, zero contacts, closest
approach 0.775 yd across five minutes. **That part is done.**

**Two things are not.**

## 2a — THE LADDER IS STILL THERE, AND YOU SAID WHY

You deleted it, measured, and put it back: zero shoves and zero contacts, but 50
stalls with one customer held **246 seconds**, LP infeasible from t=63 s. Your own
verdict: *"the solver is not right yet — not because it lets people touch, but
because 'reachable stop' is not yet its problem. The fix is stop geometry."*

**So fix the stop geometry.**

- A stop no body may legally stand on **must never be issued.** Validate stops
  against the collider set and the player clearance at assignment time, not at
  arrival time.
- `member_station`'s browse point sits ~0.98 yd from queue slot 0, so a formed
  queue body-blocks it — 35 of 40 ladder lines in one run. **Move it.**
- **Then delete the ladder and measure again.** If stalls stay near zero, it goes
  for good. If not, say what is still issuing impossible stops.

## 2b — THEY STILL DO NOT BEHAVE LIKE PEOPLE

Never worked, and it is what separates this from its comps:

- **Individual pace and idle behaviour** — not everyone walks at one speed.
- **They look at what they are doing** — the shelf they browse, the person ahead
  of them in the queue, me when I speak to them.
- **Browsing that looks like browsing**: approach, pause, consider, pick up or
  move on. Not a straight line in and a straight line out.
- **Natural entrances and exits** through the door at their own pace.

Comps: Supermarket Simulator, TCG Card Shop Simulator, Two Point Hospital.

**Acceptance is a clip you have watched**, with the camera aimed at the crowd and
the framing gate passing — the discipline you built for the nav work.

---

# BLOCK 3 — AUDIO. Still barely worked, and it is half the feel.

You audited it: 2,956 lines, five-bus mixer, ~131 cues, 68 assets, per-surface
footsteps, a central click sink. **Better than expected.** And with the ambience
bed down every cue fires and `unknownCues` is empty.

**But you also measured the problem and did not fix it:** in the real mix the
ledger sits at 5× the floor and **footsteps sat at 1.38×.** You fixed the gait bug
(4 → 7 steps per 4-second walk) and then deliberately did not touch per-cue gains
because you could not hear the result.

**Do it now, from the measurement rather than by ear:**

- **Balance every cue against the mix floor**, not against silence. Anything under
  ~2× the floor is inaudible in play. Report the before and after table.
- **Ducking** so the register does not fight the ambience.
- **Distance attenuation** — the shop should sound different from the far corner.
- **Variation**: 3-5 variants per repeated cue with pitch and volume jitter. One
  footstep sample played 400 times is instantly recognisable as a game.

**And write `Designs/ProShop/AUDIO_MANIFEST.md`** — every sound the game needs by
exact filename, with duration and one-line description, organised by layer. Build
the loader so dropping a real `.wav` at that path overrides the synth version with
no code change. **I am not recording audio**, so the manifest is how I fill the
gaps later.

---

# BLOCK 4 — THE LAPTOP AND THE PHONE UI.

## 4a — THE 541 ms YOU FLAGGED AND WALKED PAST

Your own row: *"06 laptop pages, 541 ms with zero arrivals, zero geometries, zero
textures. Whatever that is, it is not shader work."* And **5,113 ms on the same
row cold.**

- **Profile the real open and the real page switch** on a resumed save with the
  CDP profiler and **name the function with self-times** — the way you named
  `mopVerlet.update` at 554 ms with no tool equipped. Then fix it.
- Measure **frame time while the laptop is open** with the DOM overlay live,
  against frame time on the shop floor. If the overlay costs frames, say so.
- **The bar still lies.** It completes before the thing is usable. Make it honest.

## 4b — THE UI ITSELF

- **The laptop UI squeezes 32 items into 3 buttons.** Reported, never fixed. Give
  it real navigation.
- If there is a phone UI in the game, audit it the same way and tell me what you
  found. If there is not, say so in one line.

---

# BLOCK 5 — BLENDER: BAKE THE FOUR, THEN REVIEW THE NINE.

- **Bake driver, putter, iron and counter** through the same pipeline the eleven
  went through. Normal + AO + roughness, packed ORM, asserted by re-opening the
  GLB. **Watch `assert_maps.mjs` fail on all four first** — it will.
- **Then wire them**, counter included. If `pine-hills-v2`'s suppression of assets
  61-63 has to lift for the real front desk, lift it and say so. **That desk has
  been a grey box since the beginning and I stand at it for every transaction.**
- **Then review the nine garments in game** that were never reviewed. Only the
  hung hoodie and folded polo have been. In-game shot at browse distance and
  across the room, reference photo beside it.

**Not tonight:** the five hardgoods never started (stand bag, shoes, glove,
headcover, umbrella). Do not begin them.

---

# BLOCK 6 — THE BACKLOG. Everything here has been reported and is still open.

**6a — THE BAG AT CHECKOUT.** Items shrink and vanish instead of entering the bag.
Attempted four times and reverted; your note says the anchor needs re-authoring in
`checkout/shopping_bag.glb`. **Do that first, then the placement.**

**6b — CASH AND CHANGE.** Cents included, realistic denominations matching the
amount paid. Per-note hover outline in the drawer instead of the 25% white smear.
Change left of the monitor, items and cash right of the bag.

**6c — THE STUCK LIST.** Each reported, each still open:
- Price tags at checkout (reported fixed, still there — check by playing)
- The second outdoor sign does not change state — and `LegacyClubApproachSign` is
  registered with nothing, which you found and left
- Combined buy-plus-tee-time visits are rare
- Tee-time check-in at the requested time does not work
- The ceiling prompt still does not teach the repair

**6d — CHARACTER FAULTS.** Stomachs detach and pump while walking; eyebrows and
moustaches float in front of the face in profile. Both were "fixed" in an earlier
session and both are still visible. **Your D6 driver parked because it framed the
doorway instead of the face** — fix the framing gate (how much of the frame the
head FILLS, not merely whether it is inside it) and get a verdict.

**6e — THE EDITOR EXIT AFTER AN EDIT.** 3 arrivals, 641 ms warm, 5.4 s cold. You
fixed the water churn (departures 4 → 0) but the arrivals did not move: the
discard rebuild constructs material configurations unlike anything drawn before
(`false → uv` at field 7). **That is the course rebuild's material identity.** If
there is time, make the rebuild reuse material configurations rather than minting
new ones.

---

# RULES — the ones that have earned their place this week

**Verify by playing, not by census.** Real input, sim live, no pins, no teleports,
on the population the player actually sees.

**Every acceptance ends with a screenshot or clip you have looked at.** Four
probes have now reported clean on things I could see were broken: tab-overview at
zero, the editor viewmodel, the rake viewmodel, the D6 doorway frame.

**Watch every new check fail on a known-bad case first.**

**A warm that mints nothing must be indistinguishable from no warm at all.** Report
what each stage minted. Your four-frame tool warm reported `done` and did nothing.

**Read the gate's real exit code.** `| tail` reports tail's exit code — it has
masked a failing suite twice. **And do not commit while the gate runs**; goal24's
orchestrator hashes the repo and voids the run.

**When a detail vanishes, check the sampling pitch before the shader.** That fault
hit three times in one session and each time it looked like a broken material.

**`nearestTwinDiffs` is a hint, never a claim.** The "point-light 4 → 0" reading
drove two goals of work and never described the editor at all.

**Park at twelve rounds** on any item with the reason written, or cut it and say
why.

**Compact at 80% and CARRY ON.** Do not stop, do not hand off, do not wait for me.
Finish and push what you are on before compacting.

**In the morning:** what landed, what is parked, what you cut, and anything you
decided without me. **Do not tidy the failures out of it** — the mistakes have
been the most useful part of every report this week.