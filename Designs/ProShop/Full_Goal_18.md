# Full Goal 18

Everything below comes from me actually playing the build. Screenshots are
referenced by number and are attached to the session.

**Every line here is an INSTRUCTION, not a defect report.** Do the thing it says.
If a line is genuinely ambiguous, take the reading that CHANGES the game rather
than the one that preserves it, and record which you took.

---

## THE STOP RULE — read this first, it applies to every item

**If an item takes more than 5 commits or 45 minutes, STOP.** Write what you
found, put it on NOT DONE, and move to the next item. Never chase one thread
past that limit however close the answer feels.

Last session spent sixteen refuted fixes on one stall and thirty-plus commits on
a 376 ms hitch. Both ended honestly. Both cost hours that four other items
needed. **Breadth beats depth from here.**

## THE GREYBOX STAYS

`pine-hills-v2` is the greybox and suppresses assets 61, 62 and 63 (desk shell,
hutch cabinet, fitting booth) in favour of grey volumes. That is why the front
desk renders as a plain dark box in image 6. **This is deliberate and we are
keeping it.** Continue all work and all verification in `pine-hills-v2`. Do not
switch variants, do not "fix" the greybox, and do not raise it again.

## TWO ITEMS WERE REPORTED VERIFIED LAST SESSION AND ARE OBSERVABLY FALSE

Both are in section F. Treat them as the divergence problem, not as new work:

- **G9 concurrency** — reported "the ceiling was raised", with numbers. I still
  see one customer at a time and have never seen a queue of two.
- **G10 the 3-second stuck rule** — reported "fires regardless, Invariant 7 has
  a check". I watched a customer stuck for over five seconds without trying
  anything new.

For each: find out what the check was actually measuring, and say so before you
change any code. Requirement 2 from the last brief applies — the disagreement is
the finding.

## STANDING RULES

Electron only. `npm run dev -- --clubhouse=pine-hills-v2`.

A green suite is not evidence. Visual items need a screenshot at the **default
player camera** or they are UNCONFIRMED. Every new instrument gets a negative
control. Every fix gets a check you have **watched fail** on the unfixed build.
Suite green before each commit. **Commit and push after every item.**

---

# A — PERFORMANCE

The game is incredibly laggy, and it spikes on **every action**: loading in,
opening a door, opening the book.

You already have the diagnosis and have not applied it:

- GPU 8.4 ms per frame; the post chain is **74%** of it
- 4x MSAA on a half-float target costs **1.26 ms**
- **My monitor is 240 Hz** — a 4.17 ms budget. Your probe reported 120 Hz.
  Determine whether the probe is wrong or Windows is running the panel at 120,
  and say which.

## A1 Add a framerate cap to Settings

60, 120, 144, uncapped. Default it to the highest you can hold **without missing
cadence**, and say which you chose and why. At 8.4 ms of GPU work, 240 is not
achievable and 120 is marginal — pick honestly.

## A2 Re-grade invariant 1

The 16 ms bar is a 60 Hz budget. Point it at the refresh you actually ship and
state the number. **Do not tune to the invariant — tune to the frame, then set
the invariant to match what you achieved.**

## A3 Cut the post chain with pmndrs `postprocessing`

See section H. It merges effect passes into one shader instead of a full-screen
pass each. Measure the GPU frame time before and after at the same fixed indoor
poses and report both.

## A4 The per-action spikes

Loading in, opening a door, and opening the book each hitch. You measured the
door as costing nothing and the ledger as fixed. Both still spike in my hands.
Re-measure with real input at the default camera, and report what you find
rather than what the earlier instrument said.

---

# B — THE LEDGER. Five separate defects, all in one interaction.

## B1 The cover lettering is MIRRORED

Image 1. "PINE HILLS MUNICIPAL GOLF / MEMBERS AND GUESTS" reads back to front.

This is not a layout problem. Either the text is being drawn on the back face of
the cover, or the cover's geometry or UV is flipped in one axis, or the canvas is
mapped with a negative scale. Find which, fix the cause, and check the *other*
painted faces for the same fault.

## B2 The open book sits too far right

Image 1. It opens off-centre. Centre the spread in the frame.

## B3 There is no prompt telling me how to open or close it

Nothing on screen says which key opens the book, turns a page, or closes it. Add
it, in the same style as the tool control line.

## B4 It glitches for a frame on open

Pressing E shows the book open with **no cover panel — just the bare page** for a
moment, then corrects itself and opens properly. A frame is being drawn before
the cover geometry is posed. Find it and stop drawing that frame.

## B5 Putting the book back plays the animation TWICE

The set-down animation runs, finishes, and runs again. Almost certainly the
handler firing on both key-down and key-up, or two call sites reaching the same
routine. Find it.

---

# C — CHECKOUT

## C1 Items show OVER the bag

Image 2. The black cylinders sit above the bag's rim, plainly outside it. **Do
not allow this.** An item that has gone into the bag is inside the bag: below the
rim, occluded, or both. Never poking out the top.

## C2 The card is not in the customer's hand

Image 3. It floats beside the fingers with a visible gap. Put it in the grip.

## C3 Card transactions massively outnumber cash — make it 50/50

I see far more cards than cash. You measured the payment bag as a balanced 50/50
shuffle. **Measure what actually reaches the counter**, in a live run, and report
the real split before changing anything. Then make the observed split 50/50.

## C4 The new bag spawns in too roughly

When a transaction ends, the next bag simply appears. Either give it a smooth
arrival animation, or make me place a new one manually. **You choose — pick the
one that reads better and say why.**

## C5 The Q reveal markers stay when I enter the register

Image 6. Holding a tool, pressing Q, then clicking the register: the tool
correctly leaves, and **the blue markers stay on screen behind the till UI.**

Every mark Q created must go with it — the markers, the reveal, the legend, the
prompt chip. All of it.

---

# D — TEE TIMES

## D1 Almost nobody reserves a tee time

My scheduler is empty and everyone arrives as a walk-in. **Flip it: the majority
of golfers should be people who reserved in advance**, with walk-ins as the
minority. Report the measured split across a full day before and after.

## D2 People still arrive and check in long before their tee time

Still happening. You built a window that opens an hour before and closes at the
tee time (G11). It is not holding in the running game.

**Find out why before changing it.** Then make arrival, check-in and the desk's
answer all correlate with the in-game clock, and verify by watching a full day.

## D3 Add two new booking channels — email and phone

Both, implemented:

- **Email through the laptop.** Booking requests arrive in an inbox on the
  laptop. I read them and accept or decline into the tee sheet.
- **A phone that rings.** A golfer calls to book a time. I answer, hear what
  they want, and put them on the sheet.

Design both so they feed the same tee sheet and the same three states (free,
reserved-and-expected, checked-in). Say what you built and how a player learns
each one.

---

# E — THE MOP AND THE BROOM. Nothing else in the tool set.

## E1 The broom is held wrong, in three ways at once

Image 4:

- **One hand, not two.** It should be held with both hands.
- **The hand is at the very bottom of the shaft** and reads as holding it
  backwards.
- **The head is edge-on and rotated** — sideways rather than square to the floor.

Use the tuning overlay you built. Do not guess a number, measure it, and report
it — put the values in the panel, look at the screen, and tell me what you set.

## E2 The mop head looks bad

Image 5. The bristles read as a low-poly white shaving brush: too few, too
chunky, wrong colour, wrong silhouette. Rebuild the head. A mop head is many fine
strands, damp, hanging heavy, greyish rather than white.

## E3 The mop does not clean like a mop

It only moves side to side, in the same direction, regardless of what I am doing.

What I want:

- The stroke follows **how I am actually moving the mouse** — side to side, back
  and forth, circles — not one canned direction.
- Pressed to the floor, the strands **splay out** and flatten.
- The strands **lead and trail** the direction of travel rather than swinging on
  one axis.

## E4 The strands must move when I am NOT cleaning

They should move whenever the mop does: when I walk around the store, when I turn
quickly, when I stop. Not only while the button is held.

You found this once — the strands were welded while carried and you fixed the
carry case. It is not reading. Re-verify with real input at the default camera,
on video, and watch the video.

---

# F — CUSTOMERS

## F1 Still one at a time, and never a queue

Reported verified last session. Observably false. See the note at the top.

I want multiple customers in the shop at once and **a queue of two or more at the
counter**, and I want to see it happen. Report measured concurrency and the
longest queue observed across a full day.

## F2 The stuck rule does not work — and the threshold changes to ONE second

I watched a customer stuck for over five seconds without trying anything new.
Reported verified last session. Observably false.

**New threshold: 1 second of no progress.** Then they take a genuinely different
route, even a much longer one.

**And if they cannot find any way to reach what they want, tell me.** A
notification, or a message on the phone from section D. I should never have a
customer silently stuck in my shop without knowing.

Add this to the invariant suite properly this time, with a check you have watched
fail.

## F3 Customers should speak at the end of a transaction

A line when the sale completes, chosen from what actually happened:

- **Price** — "that's steep" or "cheap enough", based on the prices they paid
  against the shop's reviews for those items
- **Speed** — "that was quick" or "took your time", based on how long I actually
  took to process them
- **Overall** — a plain thank-you when it went well

**Make the logic real.** It reads off the actual transaction: the items, the
prices, the review standing, the elapsed time. Not random flavour. Report the
rules you used and show me three examples from a live run — a good one, a slow
one, and an expensive one.

---

# G — CHARACTERS

## G1 Their shoes point backwards and there is a white plane under them

Image 7. Both feet are on backwards, and each has a white slab beneath it.

Fix the foot orientation and delete the white plane. Check every body type and
several walk poses, not one.

---

# H — TOOLING. Install it, gate it, and make it permanent.

## H0 blender-mcp is already installed and connected

Blender is open with the socket live. Use it from now on, permanently:

- **Before exporting ANY asset, take a viewport screenshot and LOOK at it.** The
  rake bristles, the divider buried in a solid carcass and the page block inside
  its own covers were all visible there and invisible in the numbers.
- Use Poly Haven through it for textures and HDRIs.
- **Ignore its Hyper3D generation and Sketchfab download entirely** — their
  output is not game-ready and they would put an AI-content disclosure on the
  Steam page.

## H1 Node devDependencies — run `npm install --save-dev` yourself

`eslint`, `pixelmatch`, `pngjs`, `@gltf-transform/cli`, `gltf-validator`

Write the ESLint config **directly** — do NOT run `npx eslint --init`, it is
interactive and will hang.

Then run it across `src/` and **report the violation count by rule. Autofix
NOTHING.** I decide once I see the breakdown. There has never been a linter over
`src/`; a duplicate `customers` key silently killed two drivers, and the
hand-written scanner built to catch that class then missed quoted keys twice.

## H2 Three renderer libraries — `npm install`, then VENDOR them

`troika-three-text`, `postprocessing`, `three-mesh-bvh`

The renderer loads three from `vendor/three.module.js` with **no bundler**, so
npm install alone does nothing. Vendor their ESM builds into `vendor/` the same
way and rewrite their internal `three` imports to point at our copy.

**Verify each loads in Electron before claiming it works.** An import that
resolves in Node and 404s in the app is a shape that has bitten this project.

- `postprocessing` → A3, the post chain
- `troika-three-text` → the ledger and the front-desk monitor paint 768px
  canvases and upload them. SDF text is geometry: no canvas, no upload, no
  repaint on a page turn.
- `three-mesh-bvh` → collision, tool clamps, and a visibility sweep firing 26
  rays per part across 531 assets

## H3 The two glTF tools become pipeline gates

`gltf-validator`: every export validated, a spec violation **fails the build**.
The boolean-brings-the-cutter's-material-slot-across problem has appeared twice.

`gltf-transform inspect` replaces the hand-rolled census scripts. Report meshes,
materials, textures and triangles for the ten highest-screen-share assets, and
report what `dedup` and `prune` **would** remove. Report only.

## H4 THE REPO IS CARRYING 200–250 MB OF BINARIES

The texture pass grew the GLBs by 4,000–19,000% each and they are stored
**twice** — once under `Assets/` and again under `vendor/models/`. Every rebuild
re-commits the whole file because binaries do not diff.

- `vendor/models/` is generated from `Assets/`. **Gitignore it and build it.**
- Set up git-lfs for what remains.
- Report the repo size before and after.
- Then explain why a 512×512-textured GLB is 8–12 MB. If the maps are embedded
  uncompressed, compress them.

## H5 The golden-image suite

102 instrument faults are logged and no numeric check can see a rake, a hat
through a face, or a book inside its own covers.

Pin screenshots at fixed poses — shop floor, counter mid-sale, each tool held,
the ledger open, a customer at conversational distance — diff with `pixelmatch`
every run, fail above a threshold.

**Its control: change one pixel of a golden and confirm the diff FAILS.**

## H6 Two project skills, committed to `.claude/skills/`

Use `skill-creator`.

**golf-assets** — ART_BIBLE §7.4.1 palette; a material break on a real part
boundary; something that catches light; a silhouette that reads at viewing
distance; the build-time overlap assertion; **viewport screenshot via blender-mcp
before export**; pack `--no-compress`; regenerate the visibility sweep;
player-camera screenshot beside the reference, and say what differs.

**golf-qa** — every instrument gets a negative control; a green suite is not
evidence; **an invariant that does not launch the game certifies nothing**; check
every new probe against `HARNESS_DEBT.md`; every fix gets a check you have
watched fail.

## H7 Make all of it permanent

- ESLint, `gltf-validator` and the golden-image diff join the **one**
  regression-gate command.
- Update `CLAUDE.md`: the tooling available, when each is used, the blender-mcp
  viewport rule, the 45-minute stop rule, that the greybox is the working
  variant, and that assets go through `golf-assets` and probes through `golf-qa`.
- Point `HARNESS_DEBT.md`'s header at `golf-qa`.
- Record in the course notes that **Geometry Nodes** is the tool for scattering
  grass and trees with density maps and LODs.
- Then **prove it end to end**: build one throwaway asset through the
  `golf-assets` skill, with a viewport screenshot, the validator gate and a
  golden image. Report every step that fired. Delete the asset after.

---

# REPORTING

Append to `Designs/ProShop/OVERNIGHT_REPORT_18.md` **as you go**, not at the end.
Per item: what changed, how it was verified, the screenshot path, and whether it
meets the twenty-minute-stranger bar.

Keep four running lists at the bottom, updated continuously: UNCONFIRMED, NOT
DONE, VERIFIER FINDINGS STILL OPEN, and anything you fixed that I did not ask
for.

**Keep the report under 2,000 lines.** The last one was 16,349 and nobody can
read it.