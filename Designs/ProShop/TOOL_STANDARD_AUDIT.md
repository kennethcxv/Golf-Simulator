# E1 — every tool against the broom's fixed standard

Measured 2026-08-04 off the live posed rig with `tools/qa/tool-standard-audit.js`,
not read off the registry. The registry says what a tool declares; this says
where its geometry ended up after the frame posed it.

**The control is the broom.** It is the tool the standard was set on, so if the
instrument does not report the broom as floor-referenced with a head on the
boards, it is not measuring the standard and no other row means anything. It
reports 0.012 yd of reach and 0.003 yd of carried spread. Everything below is
measured by the same code in the same run.

---

## The table

| tool | reach¹ | visible² | carried spread³ | floor-ref | hands | sleeves | poses⁴ | into fixture⁵ |
|---|---:|:--:|---:|:--:|---:|---:|---:|---:|
| **broom** | **0.012** | yes | **0.003** | **yes** | 2 | 4 | 112 | **0.000** |
| mop | 0.081 | yes | 0.631 | no | 2 | 4 | 137 | 0.755 |
| dustpan | 0.235 | yes | 0.640 | no | 2 | 4 | **1** | 0.603 |
| vacuum | 0.265 | yes | 0.611 | no | 2 | 4 | 89 | 0.705 |
| trashbag | 0.542 | yes | 1.676 | no | 2 | 4 | **1** | — |
| washer | 0.977 | yes | 1.367 | no | 2 | 4 | **1** | 0.324 |
| cloth | 1.159 | yes | 0.845 | no | 2 | 4 | 129 | — |
| sponge | 1.172 | yes | 0.838 | no | 2 | 4 | 122 | — |
| spray | 1.293 | yes | 0.789 | no | 2 | 4 | **1** | — |

1. **reach** — yards the contact socket sits above the floor at the tool's own
   declared working pitch. For a floor tool this should be ~0. For a hand tool
   (cloth, sponge, spray) a metre-ish is correct — they work surfaces, not
   boards — so their reach column is not a defect, it is the wrong question and
   is answered in §3 instead.
2. **visible** — the contact socket projects inside the frame at that pitch.
   Every tool passes. This axis found nothing.
3. **carried spread** — yards the contact socket's WORLD height moves across the
   carried band (pitch 0 → +1.35, mouseLook's real limit). This is the C2 class:
   a head that rides the view. Near zero is anchored.
4. **poses** — distinct local transforms across 2 s of held use. 1 is a static
   prop; ~100+ is a real animation.
5. **into fixture** — yards the contact point travels PAST a fixture's near face
   when the player walks into it. `—` means the contact point never reached the
   fixture from the 0.20 yd standoff, so the probe says nothing about that tool
   either way; it is not a pass.

---

## What the table says

### 1. The floor anchor is broom-only, and it is the biggest gap

`mop`, `vacuum` and `dustpan` all carry `floorAnchored: true` in the registry —
and none of them are. courseScene's floor solve for them is:

```js
g.rotation.x = CLEANING_TOOLS[id].worldPitch - walk.pitch;
…
g.position.y = rest.y + Math.max(-0.06, Math.min(0.06, floorY - _toolContact.y));
```

That holds a constant *angle* to the world and then nudges the height by **at
most 0.06 yd**. The measured error is 0.61–0.64 yd across the carried band, so
the clamp saturates immediately and the head simply rides the camera the rest of
the way. The flag is honest about intent and the implementation cannot deliver
it — the clamp is an order of magnitude too small for the quantity it is
correcting.

The broom does not use this path at all (`if (id === 'broom' && broomVm.isActive()) continue;`).
It solves the head's world height directly and caps the hands at the handle's
reach (C2). That is why it reads 0.003.

### 2. Two tools cannot touch what they clean

* **mop 0.081 yd** — 7.4 cm of daylight under the strands at its own working
  pitch. This is the 0.103 yd bug, one tool over and barely smaller.
* **vacuum 0.265 yd** and **dustpan 0.235 yd** — the floor head hovers most of a
  foot above the boards. A dustpan that cannot reach the floor is the whole tool.

### 3. Four tools are static props in the hands

`dustpan`, `spray`, `washer` and `trashbag` return **one** distinct pose across
two full seconds of held use. Not a small animation — no animation. The spray
bottle's discrete pump (`spraySqueezeActive`) drives the HANDS, not the tool
group, so the bottle itself never moves; the washer's recoil is declared
(`recoil: 0.055`) and does not reach the group either.

`mop`, `cloth`, `sponge` and `vacuum` do move (89–137 poses), so the machinery
exists and four tools are simply not wired into it.

### 4. Three floor tools drive through fixtures

Walking into the nearest fixture puts the contact point **0.60–0.76 yd inside**
it for mop, vacuum and dustpan, and 0.32 yd for the washer. The broom stops at
the face (0.000) because it is the only tool that consults `colliderQuery` and
binary-searches its reach back to a standoff.

The four `—` rows are not passes. Their contact points never reached the fixture
from the probe's standoff, so the instrument has nothing to say about them and
the audit says so rather than scoring them green.

### 5. Hands and sleeves are already uniform

Every tool: 2 hand meshes parented into the tool group, 4 sleeve/cuff meshes on
the arms. The nub-cap and floating-cuff problems the broom rebuild fixed were
fixed in the SHARED first-person rig, so every tool inherited them. This axis
needs no work, and that is worth knowing before anyone opens nine files.

---

## What E2 actually is, given the table

Ranked by what a stranger would hit first.

| # | work | tools | shape |
|---|---|---|---|
| 1 | port the broom's floor solve to the shared floor-tool path | mop, vacuum, dustpan | **real code**, not config. The 0.06 clamp has to become a solve. The broom's own solve is coupled to `broomViewmodel`, so this is "extract the anchor from broomViewmodel into something three more tools can call", not "copy a constant". |
| 2 | give the floor tools the broom's collider clamp | mop, vacuum, dustpan, washer | **real code**, but it comes free with #1 if the extraction takes the collider probe with it — they are the same solve. |
| 3 | reach: mop 0.081 → ~0.012 | mop | falls out of #1. |
| 4 | wire four tools into the use animation | dustpan, spray, washer, trashbag | **config-ish**: the stroke/spring machinery already drives four other tools; these four need a motion declared and the hook connected. The spray and washer already move the HANDS, so the question is only why the group is excluded. |
| 5 | hands, sleeves, nub caps | — | **nothing to do**, measured. |

So "most of this should be config rather than new code" is half right: item 4 is
config-shaped, items 1–3 are one real piece of code shared by four tools. I
would not do 4 first — a static dustpan is less wrong than a dustpan that cannot
reach the floor and drives through the counter.

*Raw: `Designs/ProShop/Baseline/round7/e1-tool-standard-audit.json`.*
