// PHYSICAL CHECKOUT FLOW CONTRACT
//
// This module describes the player-visible register sequence. It deliberately
// owns no inventory, money, DOM, or three.js objects: register.js remains the
// source of truth for sale integrity while the renderer uses this contract to
// decide which physical interaction may happen next.
//
// State changes are adjacent and explicit. Recovery is the only exceptional
// edge, and it may only resume at the checkpoint selected when recovery began.

export const CHECKOUT_STATE_ORDER = Object.freeze([
  'CustomerApproaching',
  'CustomerPlacingProducts',
  'WaitingForCashier',
  'EnteringCashierMode',
  'WaitingForScan',
  'ProductHeld',
  'ProductScanning',
  'ProductScanned',
  'AllProductsScanned',
  'ChoosingPayment',
  'CardPresented',
  'CardInsertReady',
  'CardInserting',
  'CardAmountEntry',
  'CardProcessing',
  'CardApproved',
  'CardDeclined',
  'CashPresented',
  'CashAccepted',
  'DrawerOpening',
  'DepositingCash',
  'SelectingChange',
  'GivingChange',
  'PaymentComplete',
  'ReceiptPrinting',
  'Bagging',
  'BagHandoff',
  'CustomerLeaving',
  'TransactionComplete',
  'Recovery',
]);

export const CheckoutState = Object.freeze(Object.fromEntries(
  CHECKOUT_STATE_ORDER.map((name) => [name, name]),
));

const noTimeout = (reason) => ({ seconds: null, action: 'none', reason });
const timed = (seconds, reason) => ({ seconds, action: 'enter-recovery', reason });
const camera = (pose, transition, lookControl) => ({ pose, transition, lookControl });
const ui = (posState, prompt) => ({ posState, prompt });
const recovery = (resumeState, checkpoint, action, resolver = 'fixed') => ({
  resumeState,
  checkpoint,
  action,
  resolver,
});

const STATE_SPECS = {
  CustomerApproaching: {
    phase: 'customer-arrival',
    branch: 'shared',
    entryAction: 'Reserve the register and navigate the customer and their owned products to the checkout marker.',
    allowedInput: ['cancel-checkout'],
    camera: camera('world-first-person', 'none', 'free-look'),
    playerAnimation: 'world-idle',
    customerAnimation: 'approach-counter',
    uiState: ui('waiting-for-customer', 'A customer is approaching the register.'),
    audio: ['customer-footsteps', 'queue-arrival-chime'],
    completionCondition: 'Customer collision volume reaches the checkout marker and the customer faces the cashier.',
    timeout: timed(45, 'Customer navigation did not reach the register.'),
    recoveryPath: recovery('CustomerApproaching', 'reserved-order', 'Rebuild navigation from the customer marker without cloning product UIDs.'),
  },
  CustomerPlacingProducts: {
    phase: 'customer-arrival',
    branch: 'shared',
    entryAction: 'Start the sequential placement controller at the first product not already marked placed.',
    allowedInput: ['cancel-checkout'],
    camera: camera('checkout-wide', 'soft-focus', 'free-look'),
    playerAnimation: 'world-idle',
    customerAnimation: 'place-products-sequentially',
    uiState: ui('customer-placing-items', 'Customer is placing products.'),
    audio: ['product-place-soft'],
    completionCondition: 'Every owned product has completed a separate placement animation at a non-overlapping staging pose.',
    timeout: timed(30, 'Sequential product placement stopped progressing.'),
    recoveryPath: recovery('CustomerPlacingProducts', 'placed-product-uids', 'Reconcile one mesh per UID and resume at the first unplaced product.'),
  },
  WaitingForCashier: {
    phase: 'customer-arrival',
    branch: 'shared',
    entryAction: 'Lock the staged products to their safe poses and expose the register interaction prompt.',
    allowedInput: ['enter-cashier', 'cancel-checkout'],
    camera: camera('world-first-person', 'none', 'free-look'),
    playerAnimation: 'world-idle',
    customerAnimation: 'wait-and-look-at-cashier',
    uiState: ui('ready-to-scan', 'Work the register.'),
    audio: ['customer-ready'],
    completionCondition: 'Player activates the physical register from interaction range.',
    timeout: timed(180, 'Customer waited too long without cashier interaction.'),
    recoveryPath: recovery('WaitingForCashier', 'staged-order', 'Release camera and pointer capture while keeping the unpaid order reserved.'),
  },
  EnteringCashierMode: {
    phase: 'cashier-entry',
    branch: 'shared',
    entryAction: 'Disable walking, release pointer lock, and ease the camera into the cashier composition.',
    allowedInput: ['cancel-cashier'],
    camera: camera('cashier-wide', 'ease-in', 'limited-counter-look'),
    playerAnimation: 'cashier-idle-blend-in',
    customerAnimation: 'look-at-cashier',
    uiState: ui('ready-to-scan', 'Preparing register...'),
    audio: ['cashier-mode-enter'],
    completionCondition: 'Camera reaches its pose, register pointer input is installed, and every product remains reachable.',
    timeout: timed(4, 'Cashier camera or input capture failed to settle.'),
    recoveryPath: recovery('WaitingForCashier', 'staged-order', 'Restore normal first-person camera and input before another entry attempt.'),
  },
  WaitingForScan: {
    phase: 'scanning',
    branch: 'shared',
    entryAction: 'Enable only unscanned order products for pickup and highlight the current reachable product.',
    allowedInput: ['pick-product', 'look', 'exit-cashier'],
    camera: camera('cashier-wide', 'ease', 'limited-counter-look'),
    playerAnimation: 'cashier-idle',
    customerAnimation: 'wait-and-follow-products',
    uiState: ui('items-remaining', 'Pick up the next product and find its barcode.'),
    audio: ['scan-ready'],
    completionCondition: 'Player physically picks up one unscanned product belonging to this transaction.',
    timeout: timed(120, 'No product was picked up while the customer waited.'),
    recoveryPath: recovery('WaitingForScan', 'scan-progress', 'Return loose objects to UID-owned staging poses and recompute scan progress.', 'scan-progress'),
  },
  ProductHeld: {
    phase: 'scanning',
    branch: 'shared',
    entryAction: 'Attach the selected product to its grip anchors and preserve its UID and barcode transform.',
    allowedInput: ['move-product', 'rotate-product', 'release-product', 'exit-cashier'],
    camera: camera('scanner-support', 'ease', 'limited-counter-look'),
    playerAnimation: 'hold-and-rotate-product',
    customerAnimation: 'look-at-held-product',
    uiState: ui('items-remaining', 'Rotate the product and move its barcode over the scanner.'),
    audio: ['product-pickup', 'product-rotate'],
    completionCondition: 'Barcode enters the scanner assistance range, or the product is released back to staging.',
    timeout: timed(30, 'A held product stopped moving or became unreachable.'),
    recoveryPath: recovery('WaitingForScan', 'scan-progress', 'Clear the grip and restore the product to its last safe staging pose.'),
  },
  ProductScanning: {
    phase: 'scanning',
    branch: 'shared',
    entryAction: 'Activate scanner assistance, barcode highlight, swept-volume tracking, and the scan hand pose.',
    allowedInput: ['move-product', 'rotate-product', 'release-product', 'exit-cashier'],
    camera: camera('scanner-focus', 'ease', 'limited-counter-look'),
    playerAnimation: 'scan-product',
    customerAnimation: 'look-at-scanner',
    uiState: ui('items-remaining', 'Pass the readable barcode through the scanner glass.'),
    audio: ['scanner-activation'],
    completionCondition: 'A fresh owned barcode crosses the physical scan volume within the accepted facing angle.',
    timeout: timed(30, 'The scan interaction did not complete.'),
    recoveryPath: recovery('WaitingForScan', 'scan-progress', 'Deactivate the beam, clear the grip, and restore the product without changing its scanned flag.'),
  },
  ProductScanned: {
    phase: 'scanning',
    branch: 'shared',
    entryAction: 'Commit one scan flag, append one POS line, and mark the held product for the bagging mat.',
    allowedInput: ['move-product', 'place-on-bagging-mat', 'exit-cashier'],
    camera: camera('cashier-wide', 'ease-out', 'limited-counter-look'),
    playerAnimation: 'place-scanned-product',
    customerAnimation: 'look-at-bagging-area',
    uiState: ui('item-added', 'Item added. Place it on the bagging mat.'),
    audio: ['scanner-beep', 'pos-item-added'],
    completionCondition: 'The scanned product is physically released inside the bagging staging area.',
    timeout: timed(30, 'A scanned product was not staged for bagging.'),
    recoveryPath: recovery('WaitingForScan', 'scan-progress', 'Restore the scanned item to its safe bagging pose and recompute whether items remain.', 'scan-progress'),
  },
  AllProductsScanned: {
    phase: 'scanning',
    branch: 'shared',
    entryAction: 'Disable further scans and make the physical TOTAL control available only after every item is staged.',
    allowedInput: ['press-total', 'exit-cashier'],
    camera: camera('cashier-pos', 'ease', 'limited-counter-look'),
    playerAnimation: 'cashier-idle',
    customerAnimation: 'prepare-payment',
    uiState: ui('ready-for-payment', 'All items scanned. Press TOTAL.'),
    audio: ['all-items-scanned'],
    completionCondition: 'Player presses TOTAL while all transaction items are scanned and staged.',
    timeout: timed(45, 'The total was not confirmed.'),
    recoveryPath: recovery('AllProductsScanned', 'all-items-scanned', 'Keep scan flags and staged poses, then restore the TOTAL control.'),
  },
  ChoosingPayment: {
    phase: 'payment-choice',
    branch: 'shared',
    entryAction: 'Resolve the customer payment preference and begin the matching physical presentation animation.',
    allowedInput: ['confirm-payment', 'exit-cashier'],
    camera: camera('cashier-wide', 'ease', 'limited-counter-look'),
    playerAnimation: 'cashier-idle',
    customerAnimation: 'retrieve-payment',
    uiState: ui('ready-for-payment', 'Waiting for payment method.'),
    audio: ['pos-payment-select'],
    completionCondition: 'Exactly one payment branch is selected and its physical card or cash props exist.',
    timeout: timed(20, 'Customer payment presentation did not start.'),
    recoveryPath: recovery('ChoosingPayment', 'all-items-scanned', 'Remove transient payment props and restart the selected presentation without authorizing money.'),
  },
  CardPresented: {
    phase: 'card',
    branch: 'card',
    entryAction: 'Attach a unique physical card to the customer presentation target and focus the cashier on it.',
    allowedInput: ['take-card', 'activate-card-reader', 'switch-to-cash', 'exit-cashier'],
    camera: camera('card-presentation', 'ease-in', 'limited-card-look'),
    playerAnimation: 'reach-for-card',
    customerAnimation: 'present-card',
    uiState: ui('card-selected', 'Take the card and activate the reader.'),
    audio: ['card-present'],
    completionCondition: 'Player takes control of the presented card and activates the physical reader.',
    timeout: timed(30, 'The presented card was not taken.'),
    recoveryPath: recovery('CardPresented', 'card-unapproved', 'Return the card to its presentation pose and clear transient insertion progress.'),
  },
  CardInsertReady: {
    phase: 'card',
    branch: 'card',
    entryAction: 'Align the card in front of the chip slot and enable a generous insertion target.',
    allowedInput: ['begin-card-insert', 'insert-card-button', 'switch-to-cash', 'exit-cashier'],
    camera: camera('card-reader-focus', 'ease-in', 'reader-constrained-look'),
    playerAnimation: 'card-ready-no-hands',
    customerAnimation: 'watch-card-reader',
    uiState: ui('card-selected', 'Insert the card into the reader.'),
    audio: ['reader-ready'],
    completionCondition: 'Primary pointer press or INSERT CARD begins from the generous aligned-card target.',
    timeout: timed(45, 'No insertion began while the card reader was ready.'),
    recoveryPath: recovery('CardInsertReady', 'card-unapproved', 'Release pointer capture and reset the card in front of the chip slot.'),
  },
  CardInserting: {
    phase: 'card',
    branch: 'card',
    entryAction: 'Snap the physical card forward along the chip-slot axis with no visible player hands.',
    allowedInput: ['move-card-insert', 'end-card-insert', 'cancel-card-insert'],
    camera: camera('card-reader-focus', 'hold', 'reader-constrained-look'),
    playerAnimation: 'card-insert-no-hands',
    customerAnimation: 'watch-card-reader',
    uiState: ui('card-selected', 'Push the card into the chip slot.'),
    audio: ['card-movement', 'card-insert'],
    completionCondition: 'The card reaches the snapped insertion stop; speed and pixel-perfect alignment are irrelevant.',
    timeout: timed(6, 'Card insertion did not reach the reader stop.'),
    recoveryPath: recovery('CardInsertReady', 'card-unapproved', 'Release pointer capture and slide the card back to its aligned start pose.'),
  },
  CardAmountEntry: {
    phase: 'card',
    branch: 'card',
    entryAction: 'Keep the card visibly inserted and enable the physical reader keypad for cent-accurate total entry.',
    allowedInput: ['card-keypad-digit', 'card-keypad-backspace', 'card-keypad-clear', 'card-keypad-confirm', 'exit-cashier'],
    camera: camera('card-reader-focus', 'hold', 'reader-constrained-look'),
    playerAnimation: 'card-inserted-keypad-entry',
    customerAnimation: 'watch-card-reader',
    uiState: ui('card-amount-entry', 'Enter the transaction total on the reader, then press OK.'),
    audio: ['terminal-keypad'],
    completionCondition: 'The entered cent amount exactly matches the POS total and the player confirms it; empty or mismatched values remain in this state.',
    timeout: timed(60, 'No matching amount was confirmed while the card remained inserted.'),
    recoveryPath: recovery('CardInsertReady', 'card-unapproved', 'Clear the amount, release keypad input, and return the card to its insertion-ready pose.'),
  },
  CardProcessing: {
    phase: 'card',
    branch: 'card',
    entryAction: 'Freeze further insertion input, light the terminal processing state, and start one authorization request.',
    allowedInput: ['exit-cashier'],
    camera: camera('card-reader-focus', 'hold', 'reader-constrained-look'),
    playerAnimation: 'card-inserted-no-hands',
    customerAnimation: 'wait-for-authorization',
    uiState: ui('card-processing', 'Processing card...'),
    audio: ['card-processing'],
    completionCondition: 'The single authorization returns approved, declined, or timed out.',
    timeout: timed(12, 'Card authorization exceeded its response window.'),
    recoveryPath: recovery('CardPresented', 'card-authorization', 'Cancel the pending visual request; resume payment only from a persisted authorization result.', 'card-authorization'),
  },
  CardApproved: {
    phase: 'card',
    branch: 'card',
    entryAction: 'Persist the authorization checkpoint, show approval feedback, and return the card reader to idle.',
    allowedInput: ['exit-cashier'],
    camera: camera('cashier-wide', 'ease-out', 'limited-counter-look'),
    playerAnimation: 'return-card',
    customerAnimation: 'payment-approved-reaction',
    uiState: ui('card-approved', 'Approved.'),
    audio: ['card-approved'],
    completionCondition: 'Approval feedback has remained visible for its minimum readable duration.',
    timeout: timed(4, 'Approved-card feedback did not advance.'),
    recoveryPath: recovery('PaymentComplete', 'card-authorization', 'Resume after approval only when the persisted authorization checkpoint is present.', 'card-authorization'),
  },
  CardDeclined: {
    phase: 'card',
    branch: 'card',
    entryAction: 'Show decline feedback, return the rejected card, and enable another physical card or cash fallback.',
    allowedInput: ['present-another-card', 'switch-to-cash', 'exit-cashier'],
    camera: camera('card-presentation', 'ease-out', 'limited-card-look'),
    playerAnimation: 'return-card',
    customerAnimation: 'card-declined-reaction',
    uiState: ui('card-declined', 'Declined. Try another card or use cash.'),
    audio: ['card-declined'],
    completionCondition: 'Customer presents a different card, or the payment branch is explicitly changed to cash.',
    timeout: timed(90, 'No replacement payment was presented after a decline.'),
    recoveryPath: recovery('CardPresented', 'card-unapproved', 'Eject the rejected card and restart with a newly presented physical card.'),
  },
  CashPresented: {
    phase: 'cash',
    branch: 'cash',
    entryAction: 'Create the exact tender pieces, animate the customer counting them, and extend them toward the cashier.',
    allowedInput: ['take-cash', 'exit-cashier'],
    camera: camera('cash-presentation', 'ease-in', 'limited-counter-look'),
    playerAnimation: 'reach-for-cash',
    customerAnimation: 'count-and-present-cash',
    uiState: ui('cash-selected', 'Take the presented cash.'),
    audio: ['cash-count', 'cash-handoff'],
    completionCondition: 'Player physically takes ownership of every presented bill and coin.',
    timeout: timed(30, 'Presented cash was not accepted.'),
    recoveryPath: recovery('CashPresented', 'cash-unaccepted', 'Return all tender props to the customer target; do not alter the persistent drawer.'),
  },
  CashAccepted: {
    phase: 'cash',
    branch: 'cash',
    entryAction: 'Checkpoint tender ownership in the transaction-local cash stack and enable the drawer control.',
    allowedInput: ['open-drawer', 'exit-cashier'],
    camera: camera('drawer-preparation', 'ease', 'limited-drawer-look'),
    playerAnimation: 'hold-cash',
    customerAnimation: 'wait-for-change',
    uiState: ui('cash-received', 'Cash received. Open the drawer.'),
    audio: ['cash-accepted'],
    completionCondition: 'Player activates the drawer and the unlock action succeeds.',
    timeout: timed(30, 'The drawer was not opened after cash acceptance.'),
    recoveryPath: recovery('CashAccepted', 'cash-accepted-local', 'Close the visual drawer, restore local tender stacks, and require a fresh physical drawer opening.'),
  },
  DrawerOpening: {
    phase: 'cash',
    branch: 'cash',
    entryAction: 'Play unlock, latch, bill-clip, and drawer-slide animation from the closed transform.',
    allowedInput: ['exit-cashier'],
    camera: camera('open-drawer-focus', 'ease-in', 'drawer-constrained-look'),
    playerAnimation: 'open-cash-drawer',
    customerAnimation: 'wait-for-change',
    uiState: ui('cash-received', 'Opening drawer...'),
    audio: ['drawer-unlock', 'drawer-open'],
    completionCondition: 'The drawer slide reaches its open stop without intersecting the counter or player.',
    timeout: timed(5, 'Drawer animation did not reach its open stop.'),
    recoveryPath: recovery('CashAccepted', 'cash-accepted-local', 'Snap only the visual rig to closed and preserve transaction-local tender ownership.'),
  },
  DepositingCash: {
    phase: 'cash',
    branch: 'cash',
    entryAction: 'Expose denomination slots and require each received piece to enter its matching physical compartment.',
    allowedInput: ['pick-tender-piece', 'place-tender-piece', 'return-tender-piece', 'exit-cashier'],
    camera: camera('open-drawer-focus', 'hold', 'drawer-constrained-look'),
    playerAnimation: 'deposit-cash',
    customerAnimation: 'wait-for-change',
    uiState: ui('cash-received', 'Place every received piece in the correct drawer slot.'),
    audio: ['paper-bill', 'coin-drop'],
    completionCondition: 'Every tender piece is in its matching transaction-local drawer compartment.',
    timeout: timed(120, 'Tender deposit stopped progressing.'),
    recoveryPath: recovery('CashAccepted', 'cash-accepted-local', 'Reconcile tender and pending-drawer stacks by denomination, close the visual drawer, and reopen deliberately.'),
  },
  SelectingChange: {
    phase: 'cash',
    branch: 'cash',
    entryAction: 'Display change due, enable drawer denomination picks and undo, and keep selected pieces in the cashier hand.',
    allowedInput: ['select-change-piece', 'undo-change-piece', 'confirm-change', 'exit-cashier'],
    camera: camera('change-selection-focus', 'ease', 'drawer-constrained-look'),
    playerAnimation: 'select-and-hold-change',
    customerAnimation: 'wait-for-change',
    uiState: ui('change-required', 'Select the required change, then confirm.'),
    audio: ['bill-pickup', 'coin-pickup', 'change-total-update'],
    completionCondition: 'Player confirms an exact held total in relaxed mode, or confirms the chosen total in realistic mode; exact-cash still requires confirmation.',
    timeout: timed(120, 'Change selection stopped progressing.'),
    recoveryPath: recovery('CashAccepted', 'cash-accepted-local', 'Return held change to the transaction-local drawer, close it, and require a fresh open before recounting.'),
  },
  GivingChange: {
    phase: 'cash',
    branch: 'cash',
    entryAction: 'Attach selected change to the cashier hand target and expose the customer reception target.',
    allowedInput: ['move-change', 'handoff-change', 'exit-cashier'],
    camera: camera('change-handoff-focus', 'ease-out', 'limited-customer-look'),
    playerAnimation: 'hand-change-to-customer',
    customerAnimation: 'receive-change',
    uiState: ui('change-required', 'Hand the change to the customer.'),
    audio: ['change-handoff', 'drawer-close'],
    completionCondition: 'Customer reception target takes the confirmed change and the physical drawer closes; exact cash records an acknowledged zero handoff.',
    timeout: timed(20, 'Customer change handoff did not complete.'),
    recoveryPath: recovery('CashAccepted', 'cash-accepted-local', 'Return any unaccepted change to the local drawer and replay the count from a closed drawer.'),
  },
  PaymentComplete: {
    phase: 'payment-complete',
    branch: 'shared',
    entryAction: 'Seal the payment checkpoint without booking sale revenue, close payment props, and start the receipt request.',
    allowedInput: ['exit-cashier'],
    camera: camera('cashier-wide', 'ease-out', 'limited-counter-look'),
    playerAnimation: 'cashier-idle',
    customerAnimation: 'payment-complete-reaction',
    uiState: ui('payment-complete', 'Payment complete.'),
    audio: ['payment-complete'],
    completionCondition: 'Payment props are secured, drawer is closed, and the receipt printer accepts one print job.',
    timeout: timed(5, 'Payment completion did not start receipt printing.'),
    recoveryPath: recovery('PaymentComplete', 'payment-authorized', 'Resume only from a persisted authorization or balanced local cash checkpoint.', 'payment-checkpoint'),
  },
  ReceiptPrinting: {
    phase: 'receipt',
    branch: 'shared',
    entryAction: 'Animate one receipt progressively through the printer and keep pickup disabled until the paper is fully exposed.',
    allowedInput: ['take-receipt', 'exit-cashier'],
    camera: camera('receipt-focus', 'ease-in', 'limited-receipt-look'),
    playerAnimation: 'reach-for-receipt',
    customerAnimation: 'wait-for-bag',
    uiState: ui('receipt-printing', 'Receipt printing...'),
    audio: ['receipt-printer', 'paper-feed', 'paper-tear'],
    completionCondition: 'Receipt fully emerges and the player physically removes it from the printer.',
    timeout: timed(15, 'Receipt animation or pickup did not complete.'),
    recoveryPath: recovery('ReceiptPrinting', 'payment-authorized', 'Recreate at most one receipt from the payment checkpoint and resume its visible feed position.', 'payment-checkpoint'),
  },
  Bagging: {
    phase: 'bagging',
    branch: 'shared',
    entryAction: 'Open the shopping bag and enable only paid scanned products and the printed receipt for insertion.',
    allowedInput: ['pick-bag-item', 'place-item-in-bag', 'place-receipt-in-bag', 'gather-bag-handles', 'exit-cashier'],
    camera: camera('bagging-focus', 'ease-in', 'limited-bag-look'),
    playerAnimation: 'open-and-pack-bag',
    customerAnimation: 'wait-for-bag',
    uiState: ui('bagging', 'Place every product and the receipt in the bag.'),
    audio: ['bag-open', 'bag-rustle', 'item-bagged'],
    completionCondition: 'Every purchased product and the receipt are visibly represented in the bag and the player gathers both handles.',
    timeout: timed(180, 'Bagging stopped progressing.'),
    recoveryPath: recovery('Bagging', 'payment-authorized', 'Reconcile bagged flags by UID, restore loose paid items, and recreate no duplicate receipt.', 'payment-checkpoint'),
  },
  BagHandoff: {
    phase: 'bagging',
    branch: 'shared',
    entryAction: 'Attach both bag handles to the player hands and enable the customer bag-reception target.',
    allowedInput: ['move-bag', 'handoff-bag', 'exit-cashier'],
    camera: camera('bag-handoff-focus', 'ease-out', 'limited-customer-look'),
    playerAnimation: 'hand-bag-to-customer',
    customerAnimation: 'receive-shopping-bag',
    uiState: ui('bagging', 'Hand the completed bag to the customer.'),
    audio: ['bag-handoff'],
    completionCondition: 'The customer reception target takes ownership of the complete bag exactly once.',
    timeout: timed(20, 'Bag handoff did not reach the customer target.'),
    recoveryPath: recovery('Bagging', 'payment-authorized', 'Return the complete bag to its safe counter pose unless customer ownership was durably recorded.', 'bag-handoff-checkpoint'),
  },
  CustomerLeaving: {
    phase: 'completion',
    branch: 'shared',
    entryAction: 'Bank the validated sale exactly once, release the register reservation, and navigate the customer away with the bag.',
    allowedInput: ['exit-cashier'],
    camera: camera('cashier-wide', 'ease-out', 'limited-customer-look'),
    playerAnimation: 'cashier-idle',
    customerAnimation: 'positive-reaction-and-leave',
    uiState: ui('complete', 'Transaction complete.'),
    audio: ['transaction-chime', 'customer-thanks'],
    completionCondition: 'Sale is banked once, queue advances once, and the customer exits the checkout navigation zone.',
    timeout: timed(45, 'Paid customer could not leave the checkout zone.'),
    recoveryPath: recovery('Bagging', 'sale-bank-checkpoint', 'If banked, resume departure; otherwise restore the completed bag for an idempotent handoff.', 'sale-bank-checkpoint'),
  },
  TransactionComplete: {
    phase: 'completion',
    branch: 'shared',
    entryAction: 'Finalize evidence fields, clear transient checkout input, and return the player camera to normal first person.',
    allowedInput: ['exit-cashier'],
    camera: camera('world-first-person', 'ease-out', 'free-look'),
    playerAnimation: 'world-idle',
    customerAnimation: 'departed',
    uiState: ui('complete', 'Sale complete.'),
    audio: ['completion-settle'],
    completionCondition: 'Terminal state: inventory, revenue, history, drawer, queue, input, and reservation invariants are settled once.',
    timeout: noTimeout('Terminal state has no timeout.'),
    recoveryPath: recovery('TransactionComplete', 'sale-banked', 'No rollback is allowed after the exactly-once bank checkpoint.'),
  },
  Recovery: {
    phase: 'recovery',
    branch: 'shared',
    entryAction: 'Freeze forward progress, release pointer and grabs, close unsafe visuals, reconcile UID and local-cash checkpoints, and select one safe resume state.',
    allowedInput: ['resume-checkout', 'void-unpaid-checkout'],
    camera: camera('recovery-safe-pose', 'ease-out', 'free-look'),
    playerAnimation: 'clear-hands',
    customerAnimation: 'recovery-wait',
    uiState: ui('recovery', 'Restoring checkout...'),
    audio: ['invalid-action-soft'],
    completionCondition: 'Input is clean, no prop is duplicated or unreachable, drawer visuals match local state, and the stored resume checkpoint validates.',
    timeout: noTimeout('Recovery cleanup is synchronous; an explicit void is available if its checkpoint cannot validate.'),
    recoveryPath: recovery(null, 'stored-resume-state', 'Resume only the stored validated target; otherwise void the unpaid transaction.', 'stored-target'),
  },
};

const FORWARD_TRANSITIONS = {
  CustomerApproaching: ['CustomerPlacingProducts'],
  CustomerPlacingProducts: ['WaitingForCashier'],
  WaitingForCashier: ['EnteringCashierMode'],
  EnteringCashierMode: ['WaitingForScan'],
  WaitingForScan: ['ProductHeld'],
  ProductHeld: ['WaitingForScan', 'ProductScanning'],
  ProductScanning: ['ProductHeld', 'ProductScanned'],
  ProductScanned: ['WaitingForScan', 'AllProductsScanned'],
  AllProductsScanned: ['ChoosingPayment'],
  ChoosingPayment: ['CardPresented', 'CashPresented'],
  CardPresented: ['CardInsertReady', 'ChoosingPayment'],
  CardInsertReady: ['CardInserting', 'ChoosingPayment'],
  CardInserting: ['CardInsertReady', 'CardAmountEntry'],
  CardAmountEntry: ['CardProcessing'],
  CardProcessing: ['CardApproved', 'CardDeclined'],
  CardApproved: ['PaymentComplete'],
  CardDeclined: ['CardPresented', 'ChoosingPayment'],
  CashPresented: ['CashAccepted'],
  CashAccepted: ['DrawerOpening'],
  DrawerOpening: ['DepositingCash'],
  DepositingCash: ['SelectingChange'],
  SelectingChange: ['GivingChange'],
  GivingChange: ['PaymentComplete'],
  PaymentComplete: ['ReceiptPrinting'],
  ReceiptPrinting: ['Bagging'],
  Bagging: ['BagHandoff'],
  BagHandoff: ['CustomerLeaving'],
  CustomerLeaving: ['TransactionComplete'],
  TransactionComplete: [],
};

const RECOVERY_RESUME_STATES = Object.freeze([
  'CustomerApproaching',
  'CustomerPlacingProducts',
  'WaitingForCashier',
  'WaitingForScan',
  'AllProductsScanned',
  'ChoosingPayment',
  'CardPresented',
  'CardInsertReady',
  'CashPresented',
  'CashAccepted',
  'PaymentComplete',
  'ReceiptPrinting',
  'Bagging',
  'CustomerLeaving',
  'TransactionComplete',
]);

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
};

export const CHECKOUT_TRANSITIONS = deepFreeze(Object.fromEntries(
  CHECKOUT_STATE_ORDER.map((name) => {
    if (name === 'Recovery') return [name, [...RECOVERY_RESUME_STATES]];
    const next = [...(FORWARD_TRANSITIONS[name] || [])];
    if (name !== 'TransactionComplete') next.push('Recovery');
    return [name, next];
  }),
));

export const CHECKOUT_STATES = deepFreeze(Object.fromEntries(
  CHECKOUT_STATE_ORDER.map((name) => [name, {
    id: name,
    ...STATE_SPECS[name],
    nextStates: [...CHECKOUT_TRANSITIONS[name]],
  }]),
));

export const REQUIRED_CHECKOUT_STATE_FIELDS = Object.freeze([
  'id',
  'entryAction',
  'allowedInput',
  'camera',
  'playerAnimation',
  'customerAnimation',
  'uiState',
  'audio',
  'completionCondition',
  'timeout',
  'recoveryPath',
  'nextStates',
]);

export function isCheckoutState(state) {
  return typeof state === 'string' && Object.hasOwn(CHECKOUT_STATES, state);
}

export function checkoutStateDefinition(state) {
  return isCheckoutState(state) ? CHECKOUT_STATES[state] : null;
}

export function validateCheckoutContract() {
  const errors = [];
  if (CHECKOUT_STATE_ORDER.length !== 30) errors.push(`Expected 30 checkout states, found ${CHECKOUT_STATE_ORDER.length}.`);
  if (new Set(CHECKOUT_STATE_ORDER).size !== CHECKOUT_STATE_ORDER.length) errors.push('Checkout state names must be unique.');

  for (const name of CHECKOUT_STATE_ORDER) {
    const spec = CHECKOUT_STATES[name];
    if (!spec) {
      errors.push(`${name} has no state definition.`);
      continue;
    }
    for (const field of REQUIRED_CHECKOUT_STATE_FIELDS) {
      if (!Object.hasOwn(spec, field)) errors.push(`${name} is missing ${field}.`);
    }
    if (!Array.isArray(spec.allowedInput)) errors.push(`${name}.allowedInput must be an array.`);
    if (!Array.isArray(spec.audio)) errors.push(`${name}.audio must be an array.`);
    if (!spec.camera || !spec.camera.pose || !spec.camera.transition || !spec.camera.lookControl) {
      errors.push(`${name}.camera must define pose, transition, and lookControl.`);
    }
    if (!spec.uiState || !spec.uiState.posState || !spec.uiState.prompt) {
      errors.push(`${name}.uiState must define posState and prompt.`);
    }
    if (!spec.timeout || !Object.hasOwn(spec.timeout, 'seconds') || !spec.timeout.action) {
      errors.push(`${name}.timeout must explicitly define seconds and action.`);
    }
    if (!spec.recoveryPath || !spec.recoveryPath.checkpoint || !spec.recoveryPath.action) {
      errors.push(`${name}.recoveryPath must define a checkpoint and action.`);
    }
    for (const target of spec.nextStates || []) {
      if (!isCheckoutState(target)) errors.push(`${name} transitions to unknown state ${target}.`);
      if (target === name) errors.push(`${name} may not transition directly to itself.`);
    }
    if (name !== 'Recovery' && name !== 'TransactionComplete' && !spec.nextStates.includes('Recovery')) {
      errors.push(`${name} must expose the safe Recovery edge.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateCheckoutTransition(from, to) {
  if (!isCheckoutState(from)) return { ok: false, reason: `Unknown checkout state: ${String(from)}.` };
  if (!isCheckoutState(to)) return { ok: false, reason: `Unknown checkout state: ${String(to)}.` };
  if (from === to) return { ok: false, reason: `Checkout cannot re-enter ${from} without a physical state change.` };
  if (!CHECKOUT_TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `${from} cannot transition directly to ${to}.` };
  }
  return { ok: true };
}

export function canTransitionCheckout(from, to) {
  return validateCheckoutTransition(from, to).ok;
}

function boundedHistory(history, entry) {
  return [...(history || []), entry].slice(-64);
}

export function createCheckoutFlow({ state = 'CustomerApproaching', nowMs = 0 } = {}) {
  if (!isCheckoutState(state)) throw new TypeError(`Unknown checkout state: ${String(state)}.`);
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be a finite number.');
  return {
    state,
    enteredAtMs: nowMs,
    sequence: 0,
    recovery: null,
    history: [{ from: null, to: state, event: 'flow-created', atMs: nowMs }],
  };
}

export function validateCheckoutFlow(flow) {
  if (!flow || typeof flow !== 'object') return { ok: false, reason: 'Checkout flow is missing.' };
  if (!isCheckoutState(flow.state)) return { ok: false, reason: `Unknown checkout flow state: ${String(flow.state)}.` };
  if (!Number.isFinite(flow.enteredAtMs)) return { ok: false, reason: 'Checkout flow enteredAtMs is invalid.' };
  if (!Number.isInteger(flow.sequence) || flow.sequence < 0) return { ok: false, reason: 'Checkout flow sequence is invalid.' };
  if (!Array.isArray(flow.history)) return { ok: false, reason: 'Checkout flow history is invalid.' };
  if (flow.state === 'Recovery') {
    if (!flow.recovery || !isCheckoutState(flow.recovery.fromState)) {
      return { ok: false, reason: 'Recovery flow has no valid origin.' };
    }
    if (!RECOVERY_RESUME_STATES.includes(flow.recovery.resumeState)) {
      return { ok: false, reason: 'Recovery flow has no safe resume state.' };
    }
  }
  return { ok: true };
}

function resolvedPaymentCheckpoint(facts, state) {
  if (facts.paymentAuthorized === false) return 'ChoosingPayment';
  return state;
}

export function resolveCheckoutRecoveryTarget(fromState, facts = {}) {
  if (!isCheckoutState(fromState)) return null;
  const path = CHECKOUT_STATES[fromState].recoveryPath;
  switch (path.resolver) {
    case 'scan-progress':
      return facts.allProductsScanned && facts.allScannedItemsStaged
        ? 'AllProductsScanned'
        : 'WaitingForScan';
    case 'card-authorization':
      return facts.paymentAuthorized ? 'PaymentComplete' : 'CardPresented';
    case 'payment-checkpoint':
      return resolvedPaymentCheckpoint(facts, path.resumeState);
    case 'bag-handoff-checkpoint':
      return facts.customerOwnsBag ? 'CustomerLeaving' : resolvedPaymentCheckpoint(facts, 'Bagging');
    case 'sale-bank-checkpoint':
      return facts.saleBanked ? 'CustomerLeaving' : resolvedPaymentCheckpoint(facts, 'Bagging');
    case 'stored-target':
      return RECOVERY_RESUME_STATES.includes(facts.resumeState) ? facts.resumeState : null;
    default:
      return path.resumeState;
  }
}

function applyTransition(flow, to, { nowMs, event, recovery }) {
  return {
    ...flow,
    state: to,
    enteredAtMs: nowMs,
    sequence: flow.sequence + 1,
    recovery,
    history: boundedHistory(flow.history, { from: flow.state, to, event, atMs: nowMs }),
  };
}

export function transitionCheckout(flow, to, {
  nowMs = 0,
  event = 'state-complete',
  facts = {},
} = {}) {
  const validFlow = validateCheckoutFlow(flow);
  if (!validFlow.ok) return { ok: false, reason: validFlow.reason, flow };
  if (!Number.isFinite(nowMs)) return { ok: false, reason: 'nowMs must be a finite number.', flow };
  const validEdge = validateCheckoutTransition(flow.state, to);
  if (!validEdge.ok) return { ...validEdge, flow };

  if (flow.state === 'Recovery' && flow.recovery.resumeState !== to) {
    return { ok: false, reason: `Recovery may only resume ${flow.recovery.resumeState}.`, flow };
  }

  if (to === 'Recovery') {
    const resumeState = resolveCheckoutRecoveryTarget(flow.state, facts);
    if (!RECOVERY_RESUME_STATES.includes(resumeState)) {
      return { ok: false, reason: `No safe recovery target for ${flow.state}.`, flow };
    }
    const recoveryInfo = {
      cause: event,
      fromState: flow.state,
      resumeState,
      checkpoint: CHECKOUT_STATES[flow.state].recoveryPath.checkpoint,
      startedAtMs: nowMs,
    };
    return {
      ok: true,
      flow: applyTransition(flow, to, { nowMs, event, recovery: recoveryInfo }),
    };
  }

  return {
    ok: true,
    flow: applyTransition(flow, to, { nowMs, event, recovery: null }),
  };
}

export function enterCheckoutRecovery(flow, {
  cause = 'interrupted',
  nowMs = 0,
  facts = {},
} = {}) {
  return transitionCheckout(flow, 'Recovery', { nowMs, event: cause, facts });
}

export function resumeCheckout(flow, { nowMs = 0 } = {}) {
  const valid = validateCheckoutFlow(flow);
  if (!valid.ok) return { ok: false, reason: valid.reason, flow };
  if (flow.state !== 'Recovery') return { ok: false, reason: 'Checkout is not in Recovery.', flow };
  return transitionCheckout(flow, flow.recovery.resumeState, { nowMs, event: 'recovery-complete' });
}

export function checkoutStateTimedOut(flow, nowMs) {
  const valid = validateCheckoutFlow(flow);
  if (!valid.ok || !Number.isFinite(nowMs)) return false;
  const seconds = CHECKOUT_STATES[flow.state].timeout.seconds;
  return seconds != null && nowMs - flow.enteredAtMs >= seconds * 1000;
}

export function recoverTimedOutCheckout(flow, { nowMs = 0, facts = {} } = {}) {
  if (!checkoutStateTimedOut(flow, nowMs)) {
    return { ok: false, reason: 'Checkout state has not timed out.', flow };
  }
  return enterCheckoutRecovery(flow, {
    cause: `timeout:${flow.state}`,
    nowMs,
    facts,
  });
}
