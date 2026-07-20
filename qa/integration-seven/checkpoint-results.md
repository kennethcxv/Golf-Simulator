# Integration checkpoint results

## 1. Furniture customization

- Source head: `b271903ce5d99478f026b0000b344dc957fe1255`
- Strategy: cherry-pick all five coherent product commits; preserve authorship and asset provenance.
- Integrated commits: `b33ef02`, `dcdd394`, `1d7e035`, `1547d96`, `44433f3`.
- Conflicts: none at this checkpoint.
- Parser: 185 JavaScript files passed.
- Focused tests: 18/18 passed.
- Full tests: 534/534 passed.
- Diff check: passed.
- Earlier fresh normal-control branch gate: 26/26 passed, including preview/final transform, floor/wall/counter/shelf placement, invalid collision, door clearance, move/store/sell, undo, save/reload, customer navigation, checkout and laptop access.
- Decision: unified catalog/layout/build mode is now canonical placement; later physical-system conflicts must adapt to it.
