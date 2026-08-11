# Audio credits

Every recorded sample shipped with GOLF EMPIRE, with its licence and where it
came from. Generated from `Assets/audio/manifest.json`, which the test suite
gates: a sample without a licence and a source cannot ship.

**There are currently none.** Every sound in the game is synthesised from
oscillators and filtered noise in `src/core/audio.js`. The player that would
use recordings is in place (`src/core/sampleBank.js`) and falls back to the
synth for any cue it cannot serve, so samples can be adopted one cue at a time.

## What is needed, in priority order (Full_Goal_23 §G3)

| cue | what it should be |
|---|---|
| `ledgerOpen` / `ledgerTurn` / `ledgerClose` | a real hardback book: cover swing, a single page turning, the thump of it shutting |
| `uiTick` / `uiConfirm` | a soft mechanical click, not a sine blip |
| `billDeposit` / `coinDeposit` | notes onto a pile; a coin landing on coins in a wooden till |

## Sources that work, and the one that does not

- **freesound.org** — by far the best foley library, and CC0 filtering is a
  first-class search facet. Downloads need an API key or an OAuth token. I have
  not created one on the owner's behalf.
- **opengameart.org** — CC0 packs, direct download, no credential.
- **Wikimedia Commons** — checked, and it is the wrong shelf: it is an
  encyclopedia media library. A search for coin, page-turn and cash-register
  audio returned photographs of coins, photographs of pages and photographs of
  cash registers.

Licences accepted: **CC0** and **CC-BY** only. Anything carrying a
non-commercial or share-alike term is refused — this ships on Steam.
