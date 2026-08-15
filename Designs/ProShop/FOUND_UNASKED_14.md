# Item 25 — what I think this game most needs

Broken things a player would hit, not features. Everything here was found while doing
something else across the last two sessions, and everything here is evidenced.

Ordered by how likely a player is to meet it and how badly it reads when they do.

---

## 1. The dustpan is not in your hands · **worst of these**

Equip the dustpan and the HUD says `Dustpan 0.0/1.8`, the tool group reports 5,472
triangles across 35 meshes, and the frame contains no dustpan — only a small white
fragment up near the ceiling. Its projected box runs y −6.86 .. −0.75, so nearly all of it
is below the frame with a sliver at the bottom right that does not read as a tool.

Evidence: `qa/electron/tool-rank/dustpan.png`, `qa/electron/tool-hands/dustpan-full.png`.

**FIXED 2026-08-06** (commit `ec3dcc8`), and the vacuum had the same defect and worse.
The gripping hand was at NDC y -1.365 (dustpan) and -1.454 (vacuum); both are back in
frame at -0.836 and -0.930, with the head plant improved rather than merely preserved.
Evidence: `qa/electron/dustpan-place/`.

This is not "reads low quality". It is a tool the player selects and cannot see. Of
everything in this document it is the one I would fix first, and it is the reason I would
push back gently on item 10's framing: the ranked table found a placement bug, not a
polish job.

## 2. A duplicate key silently broke a documented API for every clubhouse

`clubhouse.js` declared `customers: () => customers` and then, 350 lines later in the same
object literal, `customers, doors,`. The later key wins, so `clubhouse().customers()` threw
"not a function" everywhere, always. Two QA drivers using the documented form had been
dead; others had quietly grown `typeof … === 'function'` guards around it.

**Fixed this session.** Listed because the *class* matters: this is a lint rule's job
(`no-dupe-keys`), and the repo has no linter running over `src/`. That absence is the
finding.

## 3. The 1.247 guard was guarding a file the game never loads

A generator, a SHA-256 and a test, all green, all measuring
`assets/assets_51_100/glb/firstperson/asset_074_broom_fp.glb` while `cleaningTools.js`
loads `vendor/models/assets_51_100/firstperson/…`. Different files.

**Fixed this session.** Listed because there is no check that an authoring path and a
shipped path agree, and this will happen again with a different asset.

## 4. A customer's leg and bare foot clip through the front-desk counter

Visible in `qa/electron/drawer-run/03-drawer-worked.png`, top left: blue trouser leg and a
bare foot pass through the counter's solid mass while the customer stands at the till.
Every cash sale is played looking at that counter.

Not fixed. Wants a look at the customer's stand point against the desk collider.

## 5. `customerIdentity.paymentPreference` is 100% card

Across 1,961 sampled identities, `unit(seed, id, 'payment') < 0.5 ? 'cash' : 'card'`
returned card every single time. Harmless today — counter payments come from the balanced
`paymentBag`, and the field documents itself as dialogue flavour — but it is a coin that
has never once come up heads, and anything that later reads it for flavour will be wrong
in one direction forever.

Not fixed. Wants a look at `hash32`/`seedKey` for that field name.

## 6. The register facade is a hand-written whitelist

`clubhouse.js` forwards register methods one by one. A method added to
`simplifiedRegisterMode` is invisible to every driver until someone remembers to add a
line, and the failure mode is a driver reporting "0 notes on the desk" rather than
"that accessor does not exist". It cost me two runs this session before I made the
driver distinguish the two.

Not fixed. Either forward by iteration, or have the facade throw on unknown access rather
than returning undefined.

## 7. There is no linter over `src/`

Items 2 and 6 above, the duplicate `customers` key, and last session's dead
`scanPoseFor`/`scanReadFor` imports would all have been caught for free. `package.json`
has no lint script. For a codebase this size with this much QA machinery around it, that
is the cheapest quality win available.

---

## The pattern under all of them

Six of the seven are **a check that was green about the wrong thing**: a duplicate key
that made an API vanish, a SHA guard on an unused file, a facade that returns undefined
instead of throwing, a coin that never flips, a driver that cannot tell "missing" from
"empty". Across two sessions I have now recorded **fourteen instruments that were wrong
before they were right**, and every one of them either would have filed a bug against
working code or passed a broken one.

That is the thing I would spend the next session on, ahead of any single item in the
queue: not more checks, but making the existing ones incapable of being quietly wrong.
Concretely — a linter, a rule that every QA accessor throws rather than returns undefined,
and a convention that any new probe ships with the negative control that proves it fires.
