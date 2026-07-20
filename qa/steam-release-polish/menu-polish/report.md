# Menu Release Polish Report

## Outcome

The public menu no longer describes the game as a working build with placeholder
art. Starting a New Empire now transitions from `menu` to an owned `market` screen,
hides the menu underneath the property market, and returns cleanly to `menu` when
the modal closes.

Resolved blockers: `B-001`, `L-001`.

## Before

- `../baseline/menu/01-main-menu.png`: release-facing placeholder disclaimer.
- `../baseline/menu/02-new-game-route.png`: property market rendered while the app
  still reported `screen: "menu"` and left the menu visible below the modal.
- `../baseline/menu-result.json`: automated baseline finding for `B-001` and the
  stale menu screen state.

## After

- `final-2/01-main-menu.png`: product-focused footer copy.
- `final-2/02-new-game-route.png`: marketplace owns the viewport with no menu
  bleed-through.
- `final-2/03-market-close-returns-menu.png`: closing the market restores the menu.
- `final-2/video/`: recorded normal-control navigation.
- `final-2/result.json`: `screen: "market"`, `menuVisible: false`, a clean return to
  `screen: "menu"`, and no functional findings or runner diagnostics.

## Functional and visual QA

The Playwright driver used the visible New Empire and Close controls at 1920x1080.
It verified release copy, button state, both screen transitions, menu visibility,
and modal removal. Visual review found no stale footer, backdrop, or overlapping
screen after either transition. Browser console and page diagnostics were empty.

## Performance comparison

The change does not touch the renderer, scene graph, assets, animation loop, or
gameplay event loop. Before and after both keep one persistent menu node and one
temporary marketplace modal; after the change, the menu is additionally removed
from layout with its existing `display: none` path while the market is active. The
new close hook is scoped to the modal instance and runs once after that DOM subtree
is removed. There is no new per-frame work, GPU allocation, or retained listener,
so the accepted checkout performance measurements remain unchanged by this UI-only
increment.
