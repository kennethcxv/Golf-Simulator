# SESSION STATE — autonomous production overhaul

Resume from this file. Never rely on conversation memory.

- **Branch** `main` · **Last commit** `8f9a68b`
- **Tests** 361 green — run `node --test` **from the repo root only** (never `node --test tests/`)
- **Dev server** `node tools/serve.cjs`, port **8457**
- **Evidence** `qa/autonomous-overhaul/before/` and `.../pass-01/` (qa/ is gitignored — on disk only)
- **Queue** `AUTONOMOUS_BACKLOG.md` · **Record** `DEV_LOG.md`

**Live state at last check:** boot to interactive **4.4 s**; frame median **8.4 ms**, p99 13.8 ms,
worst **15.7 ms** over 200 frames sweeping the whole scene; **zero console errors**.

## Shipped this session

| Commit | What |
|--------|------|
| `46512cb` | P0-1 course-map drift — held-key normalisation + transition reset |
| `0baac43` | P0-2 depenetration, stuck recovery, Unstuck menu, door occupancy |
| `0f51120` | P0-3 laptop seat fitted to the screen (9.7 % → 53.7 % of viewport) |
| `7cd5afe` | P0-7 inventory conservation — shoppers can no longer delete stock |
| `f547d32` | P1-1 pressure washing — mask erosion, soap gate, tool tiers |
| `c85cc76` | P1-3 checkout staff space — 0.55 yd → 1.17 yd working corridor |
| `050b7b5` | P1-2 build mode — pick up / turn / place fixtures, with rules |
| `73eeb03` | P2-1/2 reviews with real causes + analytics that explain themselves |
| `fc309c9` | P2-4 the rent — weekly property bill, warnings, arrears |
| `8f9a68b` | P1-4 content-driven box sizes |

**All P0 defects from the brief are closed and verified live.**

## Next, in priority order

1. **P1-5 cleaning/tool animation quality** — visible hands, grip, sway, particle response. The
   pressure washer has a lance model and a jet but no hands; the vacuum likewise.
2. **P1-6 tutorial extended to the full loop** — it exists (18 steps, chaptered, skip/replay) but
   predates the washer, soap, build mode, box sizes and the rent. Those need chapters.
3. **P2-3 employees who do real physical work** — `restockShelvesByStaff()` currently teleports the
   work into completion, which the brief explicitly forbids ("They must not teleport work into
   completion"). A hired stocker should walk, carry a case, and fill a shelf.
4. **P2-5 rain decisions** — weather already suppresses attendance (`rounds.js`, rain > 0.5 in →
   0.35× play probability). What's missing is the player's *choice*: open/close/discount.
5. **P2-6 golf-cart condition + fleet progression.**
6. **P3 asset pass** — stockroom clutter (ref panel 6), character models, first-person hands.

## Known gaps, stated honestly

- **Boxes have no colliders.** They are interaction props only, so you can walk through a carton.
  The door-occupancy rule *does* consult world boxes, but nav and the player do not.
- **`club.reviews` is created lazily** on the first posted review; readers use `|| []`.
- **The exterior reads dark** in some light. The wash surfaces are `MeshStandardMaterial`, so they
  take scene lighting — worth a look during the P3 lighting pass.
- Reviews fire for ~2 in 5 visits by design; a quiet shop accumulates them slowly.

## Landmines / conventions learned the hard way

- **Walk yaw**: forward = `(−sin y, −cos y)`. Facing −z is **yaw 0**, not π. Aim:
  `yaw = atan2(−dx/d, −dz/d)`.
- **Building local → world** is a pure translation: `world = local + (−8, 228)`. The stockroom is
  local **x > 5.7**; standing at local x ≈ 4.6 puts you in the lounge looking at a partition.
- `addExpense()` **already takes the cash**. Adding a manual `state.cash -=` double-bills.
- The laptop's E-prop sits ~0.6 yd from the stockroom door; a blind `E` there opens the laptop, and
  while `laptopOpen` is true **all** walk input is parked. Check `walk.getFocusLabel()` first.
- `F` **cycles** the tool belt — calling it twice lands past the washer. In QA use
  `walk.setTool('washer')`.
- Door E-prompt radius is **2.1 yd**. At 2.2 yd, nothing happens.
- Playwright's synthetic `keyboard.up('d')` sends lowercase `d` even with Shift held, so it
  **cannot** reproduce the real stranded-key bug. Dispatch `new KeyboardEvent('keyup', {key:'D'})`.
- Wash surfaces must avoid the windows (south: 2.4 × 1.9, sill 0.85, at local x −8.3 and −4.9; the
  **west gable has none**). A grime plane over glass reads as a black tarp.
- Any new tool needs a `TOOL_LOOP_LEVEL` entry in `audio.js`, or `setTargetAtTime` gets `undefined`.
- Product packaging is keyed by **SKU id, not name**: the catalogue has a "Tee bag", a "Bag towel"
  *and* an "Ironwood stand bag", and the shoes are called "spikes".
