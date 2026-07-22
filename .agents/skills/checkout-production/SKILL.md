---
name: checkout-production
description: Implement, repair, or validate Golf Flipper's complete player-facing cash-register transaction. Use for checkout, POS, scanner, card, cash drawer, change, receipt, bagging, customer handoff, or any claim that the register experience is finished.
---

# Checkout Production

## Acceptance sequence

Treat checkout as one continuous physical interaction. Accept a transaction only when the player completes every step through normal controls:

1. Customer places products at the register.
2. Player picks up each product individually.
3. Each product's barcode physically reaches the scanner zone with readable orientation and clear feedback.
4. The POS updates with the item, quantity, price, subtotal, and transaction feedback.
5. Player performs the card swipe with a mouse-driven physical interaction for card payment.
6. The physical cash drawer visibly opens for cash payment.
7. Player physically deposits received cash into the correct drawer area.
8. Player selects the correct change and gives it to the customer.
9. A receipt is visibly printed and completes its intended interaction.
10. Player bags all purchased products.
11. Player hands the completed bag to the customer and receives clear completion feedback.

Exercise both card and cash branches. If a step is inapplicable to one branch, demonstrate it on the other; never silently skip it.

## Implementation rules

- Inspect transaction, input, save/load, inventory, customer, and UI paths before editing.
- Preserve working transaction and save logic. Make narrow changes and add regression coverage.
- Tie state changes to successful physical interactions, not debug hooks or direct state mutation.
- Provide visible, audible, and interaction feedback for success, rejection, and invalid order.
- Prevent duplication, lost products or money, premature completion, soft locks, and reload exploits.
- Test with normal mouse and keyboard controls from the player camera. Programmatic state injection is not end-to-end acceptance.

## Completion gate

Do not redefine “finished” as “the transaction state changed.” Require a recorded end-to-end card transaction and cash transaction, console check, save/load safety check, after screenshots or video, and evidence for all eleven steps. List any missing step as unfinished.
