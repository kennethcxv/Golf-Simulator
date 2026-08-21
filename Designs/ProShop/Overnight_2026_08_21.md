# Overnight — 2026-08-21

Boot is 15 s now, measured by hand. Good enough for tonight. What is left is
latency in everything I touch, the NPCs, and the room.

---

## Block 0 — EVERY interaction is laggy. Test the systemic cause first.

Swapping items fast, opening the laptop, flipping the ledger book, moving terrain
in the course editor, pressing Tab. All of it.

**Five separate bugs is unlikely. Test one cause before chasing five.**

You found rAF pinned at 1 Hz with both display heads reporting offline, timers at
4 ms, a MessageChannel at 0. You fixed prewarm to race its yields against a timer
— but only prewarm. **Everything else in the game still advances on
requestAnimationFrame.** If that state comes and goes while I play, then the
laptop, the book, Tab, the editor and the swap wheel are all being served one
frame per second, and each would feel exactly as I describe.

- Tell me first: what does `window.__fwVeilTicks` read on a real launch? You
  asked for it and here it is — I will boot and report if you tell me where to
  look.
- Find out WHY the compositor throttles on this machine. Both heads offline is a
  power/display event, not a game event. Is it the monitors sleeping, a GPU
  driver power state, Wallpaper Engine, or something the app itself does?
- Then decide honestly whether the whole main loop needs the same armed fallback
  prewarm got — and what that costs when the compositor is healthy. Do not ship
  a permanent timer loop that burns battery and adds a frame of latency to a
  healthy machine.

**Only after that**, measure each surface individually, input-to-pixel, sim live,
histogram not median: fast repeated swaps, laptop open, ledger page flip, Tab in
and out, and a terrain drag in the editor. Report a table. Fix what is genuinely
per-surface once the systemic cause is known.

Guard rails unchanged: A/B the door-crossing and tool-swap drivers on every
change and show both numbers. Do not trade a stall in play for anything.

---

## Block 1 — Delete the Tripo clubhouse.

There is a large AI-generated clubhouse on the map from months ago. I do not know
why it is still there. **Delete it.** One clubhouse — ours — and nothing else.

Find every reference, remove it from the map and the loaders, and move the asset
to `Assets/_archive/` with an `ARCHIVED.json` entry so `npm run assets:check`
fails if anything names it again. Then regenerate `Assets/MANIFEST.md`.

While you are in there: the manifest reported 63 files under `Assets/models/hero/`
that nothing loads, and a whole `Assets/props` tree with no loader. Say what is
dead and what is merely not wired yet. Do not delete anything else without asking.

---

## Block 2 — Fix the room. The desk is wrong and things do not flow.

The desk looks messed up and the room does not read well.

You already found the root cause: `hero_counter` is instantiated raw at **2.39 m**
inside a hidden greybox slab built to the layout's **4.2 m**. Props are placed in a
coordinate system half again as long as the object they sit on — the laptop was
0.56 m off one end, the ledger book hangs off the other.

**My call: shorten the layout to the asset.** hero_counter is a real desk at its
authored size; the 4.2 m came from a greybox nobody measured. Bring
`FRONT_DESK_FRAME.frontLength` and everything derived from it — colliders, queue
slots, prop datums, the ledger, the register — onto the drawn counter. The queue
and register are load-bearing, so watch the layout audit fail first and tell me
what moves.

Then look at the room as a room and tell me what else does not flow. Photograph it
from the door and from the desk in `final` at 10:30.

---

## Block 3 — Put more of the Blender work in the room.

Fifteen hero assets are baked, asserted and round-trip clean, and most of them are
in no room at all. **Wire what exists before anyone models anything new.**

Candidates: `hard_towel`, the folded garments on the shelves, the cap on its peg.
Use `instantiateRaw` like the eleven garments — their material names are not in
SLOT or TINTABLE and `instantiate()` resolves them to charcoal.

Put them in `final` first, since that room is meant to show the assets, then say
which belong in v2/v3 and why. Photograph each one lit, in place, from the door.

---

## Block 4 — NPC navigation. Fix the whole situation.

This has been half-fixed for weeks and I want it closed.

What is on record: the recovery ladder is still on, and the A/B says why — with
it off the crowd is perfect and **nobody finishes an errand** (worst no-progress
227.59 s, 8 people still there at 245 s). With it on, errands complete but there
are interpenetrating frames. `stopsUnreachable` is 0 in both, so the remaining
stall class is **mutual deadlock**, not stop legality.

And the stop-geometry fix has a coverage gap you named: it is wired at
`fixtureBrowsePose` only, so it validates browse points and nothing else — not
queue slots, not the overflow pocket, not the exit. `tour_vault` is the real
offender, not `member_station`.

Close it properly:
- extend stop validation to queue slots, the overflow pocket and the exit
- break the mutual deadlock in the ORCA solver — you already have the 4-minute
  staged A/B that reproduces it, and the bias term is deliberate, so the
  infeasible-LP freeze is the thing to attack
- then delete the ladder and prove it with the same A/B: crowd clean AND errands
  complete

Watch and record a clip. Numbers alone have not settled this before.

---

## Discipline

Watch every check fail first. Screenshot what you claim. Read the gate's real exit
code unpiped. The goldens are all indoor. Pin the seed on any course A/B — the
noise floor is 18% unpinned and under 0.1% pinned.