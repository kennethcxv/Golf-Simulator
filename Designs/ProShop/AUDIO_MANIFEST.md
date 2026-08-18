# THE AUDIO MANIFEST — every sound this game needs, by exact filename

> "I am not recording audio, so the manifest is how I fill the gaps later."

**86 cues. 18 have real recordings. 68 are still oscillators and filtered
noise**, which is why the game sounds electric.

## How to fill a gap — no code change required

The player already prefers a recording over the synth, per cue, at runtime.
`src/core/sampleBank.js` keeps `cue -> [AudioBuffer, ...]` and
`src/core/audio.js` asks the bank first (`sampled(cue)`); when the bank has
nothing it synthesises. So adopting a sound is two steps and neither is code:

1. drop the file at the path in the table below;
2. add an entry to `Assets/audio/manifest.json` — `cue`, `file`, `seconds`,
   `peakDb`, `licence`, `source`.

The bank loads that manifest at boot and the synth voice stops being used for
that cue. **`tests/audio-sample-licences.test.js` fails the build if an entry
lacks a licence or a source**, and only `CC0-1.0`, `CC-BY-3.0` and `CC-BY-4.0`
are allowed — anything NonCommercial or ShareAlike is refused, because this
ships on Steam.

`tools/audio/build-audio.mjs` regenerates the manifest from
`tools/audio/recipe.json`, so hand-edits get overwritten; add the recipe entry,
not the manifest entry.

## Variants, and why the count matters

The bank plays a **random variant per trigger** and already applies
`pitchJitter 0.04` and `gainJitter 0.08` on top. One sample played four hundred
times is instantly recognisable as a game whatever the jitter, so **3-5 variants
for anything that repeats** — footsteps above all — and 1 is fine for a cue the
player hears once a session.

Where a cue already has recordings the table names the file that exists and how
many variants it has. Where it does not, the filename is the convention the
loader expects: `<kebab-cue>-1.ogg`, `-2`, `-3`.

## Format

OGG Vorbis, 44.1 kHz, mono for anything positional, normalised so the file's own
peak is around **-1 dBFS** — the mix trim lives in `CUE_TRIM` in `audio.js` and
is set from a measurement, so files should arrive at a consistent level rather
than pre-balanced by ear.

## Checkout - goods and scanning

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `productPlace` | synth only | `Assets/audio/product-place-1.ogg` | 3-5 | 0.15-0.60 |
| `productPickup` | synth only | `Assets/audio/product-pickup-1.ogg` | 3-5 | 0.15-0.60 |
| `productRotate` | synth only | `Assets/audio/product-rotate-1.ogg` | 3-5 | 0.15-0.60 |
| `scannerActivate` | synth only | `Assets/audio/scanner-activate-1.ogg` | 3-5 | 0.15-0.60 |
| `scanSuccess` | synth only | `Assets/audio/scan-success-1.ogg` | 3-5 | 0.15-0.60 |
| `scanInvalid` | synth only | `Assets/audio/scan-invalid-1.ogg` | 3-5 | 0.15-0.60 |
| `posAdd` | synth only | `Assets/audio/pos-add-1.ogg` | 3-5 | 0.15-0.60 |
| `scanBeep` | synth only | `Assets/audio/scan-beep-1.ogg` | 3-5 | 0.15-0.60 |
| `checkoutComplete` | **recorded** | `Assets/audio/checkout-complete-warm-1.ogg` | 1 | 1.26 |

## Checkout - card

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `cardMove` | synth only | `Assets/audio/card-move-1.ogg` | 3-5 | 0.15-0.60 |
| `cardSwipe` | synth only | `Assets/audio/card-swipe-1.ogg` | 3-5 | 0.15-0.60 |
| `cardInsert` | synth only | `Assets/audio/card-insert-1.ogg` | 3-5 | 0.15-0.60 |
| `cardProcessing` | synth only | `Assets/audio/card-processing-1.ogg` | 3-5 | 0.15-0.60 |
| `cardApproved` | synth only | `Assets/audio/card-approved-1.ogg` | 3-5 | 0.15-0.60 |
| `cardDeclined` | synth only | `Assets/audio/card-declined-1.ogg` | 3-5 | 0.15-0.60 |
| `cardOut` | synth only | `Assets/audio/card-out-1.ogg` | 3-5 | 0.15-0.60 |
| `cardTap` | synth only | `Assets/audio/card-tap-1.ogg` | 3-5 | 0.15-0.60 |
| `approve` | synth only | `Assets/audio/approve-1.ogg` | 3-5 | 0.15-0.60 |
| `decline` | synth only | `Assets/audio/decline-1.ogg` | 3-5 | 0.15-0.60 |

## Checkout - cash and drawer

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `cashPresent` | synth only | `Assets/audio/cash-present-1.ogg` | 3-5 | 0.15-0.60 |
| `notesDown` | synth only | `Assets/audio/notes-down-1.ogg` | 3-5 | 0.15-0.60 |
| `coinsDown` | synth only | `Assets/audio/coins-down-1.ogg` | 3-5 | 0.15-0.60 |
| `billHandle` | **recorded** | `Assets/audio/bill-handle-1.ogg` | 2 | 0.89 |
| `coinHandle` | **recorded** | `Assets/audio/coin-handle-1.ogg` | 1 | 1.09 |
| `billDeposit` | **recorded** | `Assets/audio/bill-deposit-2.ogg` | 2 | 0.28 |
| `coinDeposit` | **recorded** | `Assets/audio/coin-pile-1.ogg` | 4 | 0.30 |
| `drawerUnlock` | **recorded** | `Assets/audio/drawer-unlock-1.ogg` | 2 | 0.46 |
| `drawerOpen` | **recorded** | `Assets/audio/drawer-open-1.ogg` | 4 | 1.14 |
| `drawerClose` | **recorded** | `Assets/audio/drawer-close-1.ogg` | 3 | 1.10 |
| `cashRunStart` | synth only | `Assets/audio/cash-run-start-1.ogg` | 3-5 | 0.15-0.60 |
| `cashRunStop` | synth only | `Assets/audio/cash-run-stop-1.ogg` | 3-5 | 0.15-0.60 |
| `cashPickup` | **recorded** | `Assets/audio/cash-pickup-1.ogg` | 3 | 0.60 |
| `coinSettle` | **recorded** | `Assets/audio/coin-settle-1.ogg` | 2 | 1.01 |
| `changeSelect` | **recorded** | `Assets/audio/change-lift-1.ogg` | 3 | 0.30 |
| `changeHandoff` | synth only | `Assets/audio/change-handoff-1.ogg` | 3-5 | 0.15-0.60 |
| `coin` | synth only | `Assets/audio/coin-1.ogg` | 3-5 | 0.15-0.60 |
| `drawer` | synth only | `Assets/audio/drawer-1.ogg` | 3-5 | 0.15-0.60 |

## Checkout - receipt and bag

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `receiptPrint` | synth only | `Assets/audio/receipt-print-1.ogg` | 3-5 | 0.15-0.60 |
| `receiptTear` | synth only | `Assets/audio/receipt-tear-1.ogg` | 3-5 | 0.15-0.60 |
| `bagOpen` | synth only | `Assets/audio/bag-open-1.ogg` | 3-5 | 0.15-0.60 |
| `bagRustle` | synth only | `Assets/audio/bag-rustle-1.ogg` | 3-5 | 0.15-0.60 |
| `bagItem` | synth only | `Assets/audio/bag-item-1.ogg` | 3-5 | 0.15-0.60 |
| `bagHandoff` | synth only | `Assets/audio/bag-handoff-1.ogg` | 3-5 | 0.15-0.60 |
| `receipt` | synth only | `Assets/audio/receipt-1.ogg` | 3-5 | 0.15-0.60 |
| `paper` | synth only | `Assets/audio/paper-1.ogg` | 3-5 | 0.15-0.60 |

## The ledger book

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `ledgerOpen` | **recorded** | `Assets/audio/ledger-open-1.ogg` | 2 | 1.06 |
| `ledgerTurn` | **recorded** | `Assets/audio/ledger-turn-1.ogg` | 11 | 0.68 |
| `ledgerClose` | **recorded** | `Assets/audio/ledger-close-1.ogg` | 3 | 0.56 |

## The room and the shop

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `doorbell` | synth only | `Assets/audio/doorbell-1.ogg` | 3-5 | 0.15-0.60 |
| `phoneRing` | synth only | `Assets/audio/phone-ring-1.ogg` | 3-5 | 0.15-0.60 |
| `doorSwing` | synth only | `Assets/audio/door-swing-1.ogg` | 3-5 | 0.15-0.60 |
| `doorShut` | synth only | `Assets/audio/door-shut-1.ogg` | 3-5 | 0.15-0.60 |
| `signFlip` | synth only | `Assets/audio/sign-flip-1.ogg` | 3-5 | 0.15-0.60 |
| `stationEnter` | synth only | `Assets/audio/station-enter-1.ogg` | 3-5 | 0.15-0.60 |
| `stationLeave` | synth only | `Assets/audio/station-leave-1.ogg` | 3-5 | 0.15-0.60 |
| `lightSwitch` | synth only | `Assets/audio/light-switch-1.ogg` | 3-5 | 0.15-0.60 |
| `fixtureAdjust` | synth only | `Assets/audio/fixture-adjust-1.ogg` | 3-5 | 0.15-0.60 |
| `chime` | synth only | `Assets/audio/chime-1.ogg` | 3-5 | 0.15-0.60 |
| `thunk` | synth only | `Assets/audio/thunk-1.ogg` | 3-5 | 0.15-0.60 |
| `truck` | synth only | `Assets/audio/truck-1.ogg` | 3-5 | 0.15-0.60 |
| `flap` | synth only | `Assets/audio/flap-1.ogg` | 3-5 | 0.15-0.60 |
| `boxTapeTear` | synth only | `Assets/audio/box-tape-tear-1.ogg` | 3-5 | 0.15-0.60 |
| `recycle` | synth only | `Assets/audio/recycle-1.ogg` | 3-5 | 0.15-0.60 |
| `starterCall` | synth only | `Assets/audio/starter-call-1.ogg` | 3-5 | 0.15-0.60 |

## The player: walking and tools

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `footstep` | synth only | `Assets/audio/footstep-1.ogg` | 3-5 | 0.15-0.60 |
| `equipTick` | synth only | `Assets/audio/equip-tick-1.ogg` | 3-5 | 0.15-0.60 |
| `keypadTap` | synth only | `Assets/audio/keypad-tap-1.ogg` | 3-5 | 0.15-0.60 |
| `strokeAccent` | synth only | `Assets/audio/stroke-accent-1.ogg` | 3-5 | 0.15-0.60 |
| `toolContactStart` | synth only | `Assets/audio/tool-contact-start-1.ogg` | 3-5 | 0.15-0.60 |
| `toolContactStop` | synth only | `Assets/audio/tool-contact-stop-1.ogg` | 3-5 | 0.15-0.60 |
| `sprayPulse` | synth only | `Assets/audio/spray-pulse-1.ogg` | 3-5 | 0.15-0.60 |
| `cleanSparkle` | synth only | `Assets/audio/clean-sparkle-1.ogg` | 3-5 | 0.15-0.60 |
| `vacuumPickup` | synth only | `Assets/audio/vacuum-pickup-1.ogg` | 3-5 | 0.15-0.60 |
| `wipe` | synth only | `Assets/audio/wipe-1.ogg` | 3-5 | 0.15-0.60 |
| `broomStart` | synth only | `Assets/audio/broom-start-1.ogg` | 3-5 | 0.15-0.60 |
| `broomStop` | synth only | `Assets/audio/broom-stop-1.ogg` | 3-5 | 0.15-0.60 |

## Golf

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `ballStrike` | synth only | `Assets/audio/ball-strike-1.ogg` | 3-5 | 0.15-0.60 |
| `ballLanding` | synth only | `Assets/audio/ball-landing-1.ogg` | 3-5 | 0.15-0.60 |

## Laptop

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `laptopOpen` | synth only | `Assets/audio/laptop-open-1.ogg` | 3-5 | 0.15-0.60 |
| `laptopBoot` | synth only | `Assets/audio/laptop-boot-1.ogg` | 3-5 | 0.15-0.60 |

## UI

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `uiTick` | **recorded** | `Assets/audio/opt-felt-tap-tick.ogg` | 1 | 0.18 |
| `uiConfirm` | **recorded** | `Assets/audio/opt-felt-tap-confirm.ogg` | 1 | 0.18 |
| `uiCancel` | **recorded** | `Assets/audio/opt-felt-tap-cancel.ogg` | 1 | 0.18 |
| `uiError` | **recorded** | `Assets/audio/ui-error-warm-1.ogg` | 1 | 0.26 |

## Music

| cue | status | file to drop in | variants | ~seconds |
|---|---|---|---|---|
| `musicStart` | synth only | `Assets/audio/music-start-1.ogg` | 3-5 | 0.15-0.60 |
| `musicStop` | synth only | `Assets/audio/music-stop-1.ogg` | 3-5 | 0.15-0.60 |

---

## THE MIX TRIM — before and after, measured at the master bus

Not by ear. `tools/qa/goal33-c1-audio-audit.js` taps the post-volume master
through an analyser and samples RMS across each interaction, on his save, with
the ambience bed running — so the reference is **the mix floor**, not silence.
A cue whose RMS does not rise clear of that floor is inaudible in play whatever
the code says it did.

| cue | before | after |
|---|---|---|
| ledger open | **12.25x** | 6.91x |
| ledger page | 7.05x | 4.04x |
| UI click | 3.81x | 3.57x |
| escape menu | 3.39x | 3.38x |
| tool equip | **1.08x** | **2.91x** |
| footsteps | **1.53x** | **2.33x** |
| tool use, held | 2.11x | 1.77x |
| button hover | 0.06x | 0.08x |

**Spread 11.3:1 -> 3.9:1. Cues under the 2x audibility line: 2 -> 1.**

The trims live in one table, `CUE_TRIM` in `src/core/audio.js`, with the
measurement in the comment beside them. They are multipliers on each cue's
existing level, so no sound's shape changed - only where it sits.

### Two rows that are not what they look like

**`button hover` is not a quiet cue, it is NO cue.** Only the tool wheel plays
anything on hover (`uiTick`); a generic button has no hover sound at all, so
that row measures the floor drifting. It was not "fixed" by raising a gain that
does not exist.

**`tool use, held` at 1.77x is the tool LOOP**, which is a continuous voice with
its own intensity envelope rather than a one-shot, so it is not in `CUE_TRIM`
and a flat multiplier is the wrong instrument for it. Named here rather than
trimmed blind.

The floor itself moved 0.00666 -> 0.00705 between the two runs (+6%): the
ambience bed is not identical boot to boot, so every ratio above carries a few
percent of that. It does not change any of the verdicts - a 12x cue and a 1x cue
are not a measurement artefact.

---

## What is NOT in this manifest, and is still owed

- **Ducking.** The register does not push the ambience down while it plays. The
  five-bus mixer has the buses to do it (`ambientBus`, `sfxBus`) and nothing
  wires a compressor between them.
- **Distance attenuation.** Every cue plays at the same level wherever the
  player is standing; the shop sounds identical from the far corner. The cues
  are not positional nodes today — adopting `PannerNode` per cue is the real
  fix and it is a bigger change than a trim.

Both are measured gaps, not guesses, and both are deliberately not done in the
same pass as the level trim: the trim is verifiable at the master bus and these
two are not.
