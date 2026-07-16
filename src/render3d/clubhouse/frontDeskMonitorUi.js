export const FRONT_DESK_MONITOR_WIDTH = 1024;
export const FRONT_DESK_MONITOR_HEIGHT = 640;

const COLORS = Object.freeze({
  cream: '#f4eddb',
  paper: '#fffaf0',
  green: '#173f35',
  greenSoft: '#28584a',
  sage: '#a8b9a4',
  sagePale: '#dce4d6',
  charcoal: '#272b29',
  muted: '#667069',
  brass: '#b58a42',
  brassPale: '#e5d2a8',
  white: '#fffdf8',
  danger: '#9b443d',
  dangerPale: '#efd8d2',
  success: '#2f7257',
  successPale: '#d6e8dc',
  line: '#c8c7b8',
});

const STAGE_COPY = Object.freeze({
  waiting: ['WAITING FOR CUSTOMER', 'The register is ready for the next transaction.'],
  'products-ready': ['PRODUCTS READY', 'Click each product to drop it in the bag.'],
  scanning: ['BAGGING', 'Click each product to drop it in the bag.'],
  'all-items-scanned': ['ALL ITEMS SCANNED', 'The customer is confirming how they will pay.'],
  'select-payment': ['PAYMENT CONFIRMED', 'Opening the selected payment workspace automatically.'],
  'card-payment': ['CARD PAYMENT', 'Insert the customer card into the chip reader.'],
  'cash-payment': ['CASH PAYMENT', 'Sort the received cash, then prepare the change.'],
  'change-selection': ['SELECT CHANGE', 'Select the exact change due from the drawer.'],
  'payment-complete': ['PAYMENT COMPLETE', 'Payment was accepted successfully.'],
  'ready-to-finalize': ['READY TO FINALIZE', 'Confirm the transaction to complete the sale.'],
  complete: ['TRANSACTION COMPLETE', 'The customer has been served.'],
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value) {
  return `$${finite(value).toFixed(2)}`;
}

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function canonicalApp(value) {
  const app = text(value, 'home').trim().toLowerCase().replaceAll('_', '-');
  if (app === 'checkin') return 'check-in';
  if (app === 'check-in' || app === 'checkout') return app;
  return 'home';
}

function canonicalStage(value) {
  return text(value, 'waiting').trim().toLowerCase().replaceAll('_', '-');
}

function roundedPath(ctx, x, y, width, height, radius = 12) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRound(ctx, x, y, width, height, radius, fill, stroke = null, lineWidth = 1) {
  roundedPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function setFont(ctx, size, weight = 500) {
  ctx.font = `${weight} ${size}px Arial, sans-serif`;
}

function fitText(ctx, value, maxWidth) {
  const source = text(value);
  if (ctx.measureText(source).width <= maxWidth) return source;
  const suffix = '...';
  let low = 0;
  let high = source.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(source.slice(0, mid) + suffix).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return source.slice(0, low) + suffix;
}

function wrapLines(ctx, value, maxWidth, maxLines = 2) {
  const words = text(value).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const candidate = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (lines.length >= maxLines - 1) {
      lines.push(fitText(ctx, [line, ...words.slice(index)].join(' '), maxWidth));
      return lines;
    }
    lines.push(line);
    line = word;
  }
  if (line && lines.length < maxLines) lines.push(fitText(ctx, line, maxWidth));
  return lines;
}

function drawLabel(ctx, label, x, y, color = COLORS.muted, size = 15) {
  setFont(ctx, size, 700);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text(label).toUpperCase(), x, y);
}

function statusPalette(value) {
  const status = text(value).toLowerCase();
  if (/accepted|complete|ready|paid|scanned|checked/.test(status)) {
    return [COLORS.successPale, COLORS.success];
  }
  if (/declined|error|invalid|cancel/.test(status)) {
    return [COLORS.dangerPale, COLORS.danger];
  }
  return [COLORS.brassPale, COLORS.charcoal];
}

function drawPill(ctx, value, x, y, maxWidth = 220) {
  const label = text(value, 'IN PROGRESS').toUpperCase();
  setFont(ctx, 14, 700);
  const width = Math.min(maxWidth, Math.max(90, ctx.measureText(label).width + 28));
  const [background, foreground] = statusPalette(label);
  fillRound(ctx, x, y, width, 30, 15, background);
  ctx.fillStyle = foreground;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, label, width - 20), x + width / 2, y + 15);
  return width;
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((action) => action && action.id && action.label)
    .map((action) => ({
      id: text(action.id),
      label: text(action.label),
      kind: text(action.kind, 'secondary').toLowerCase(),
      disabled: Boolean(action.disabled),
    }));
}

function buttonPalette(kind, disabled) {
  if (disabled) return [COLORS.sagePale, '#899188', COLORS.line];
  if (kind === 'primary') return [COLORS.green, COLORS.white, COLORS.green];
  if (kind === 'success' || kind === 'positive') return [COLORS.success, COLORS.white, COLORS.success];
  if (kind === 'danger') return [COLORS.danger, COLORS.white, COLORS.danger];
  if (kind === 'brass' || kind === 'cash') return [COLORS.brass, COLORS.charcoal, COLORS.brass];
  return [COLORS.paper, COLORS.green, COLORS.sage];
}

function customerName(model) {
  const customer = model.customer ?? model.transaction?.customer;
  if (typeof customer === 'string') return customer;
  return text(customer?.fullName ?? customer?.name, 'No customer');
}

function customerPaymentChoice(data) {
  const choice = text(data.customerChoice ?? data.paymentChoice).trim().toLowerCase();
  return choice === 'cash' || choice === 'card' ? choice.toUpperCase() : '';
}

function paymentChoiceDialogueFor(data, choice) {
  if (!choice) return '';
  const phrase = choice === 'CASH' ? 'Cash is fine.' : "I'll use my card.";
  return `${customerName(data)}: ${phrase}`;
}

function paymentChoiceStatus(data, stage, stageCopy, choice) {
  const status = text(data.status, stageCopy[0]).toUpperCase();
  if (!choice || !/^CUSTOMER CHOSE(?: CASH| CARD)?$/.test(status)) return status;
  return stage === 'all-items-scanned' ? 'ALL ITEMS SCANNED' : 'PAYMENT CONFIRMED';
}

function paymentChoiceInstruction(data, stageCopy, choice) {
  const instruction = text(data.instruction, stageCopy[1]);
  if (!choice || !/(?:customer chose|i['’]ll (?:pay|use)|cash is fine)/i.test(instruction)) {
    return instruction;
  }
  return choice === 'CASH'
    ? 'Opening the cash workspace automatically.'
    : 'Opening the card reader automatically.';
}

function checkoutData(model) {
  const nested = model.checkout ?? model.transaction ?? {};
  return { ...model, ...nested };
}

function reservationName(reservation) {
  return text(reservation?.name ?? reservation?.customerName ?? reservation?.guestName, 'Unnamed guest');
}

/**
 * Pure Canvas 2D presentation for the physical front-desk monitor.
 *
 * The renderer deliberately owns no transaction or reservation state. The caller
 * supplies a model and action ids, then resolves hit-test results in gameplay code.
 */
export function createFrontDeskMonitorUi(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('createFrontDeskMonitorUi requires a canvas-like object');
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new TypeError('createFrontDeskMonitorUi requires a 2D canvas context');

  canvas.width = FRONT_DESK_MONITOR_WIDTH;
  canvas.height = FRONT_DESK_MONITOR_HEIGHT;

  let activeHotspots = [];

  function addHotspot(id, label, kind, x, y, width, height, disabled = false) {
    if (!id) return;
    activeHotspots.push({
      id: text(id), label: text(label), kind: text(kind, 'action'),
      x, y, width, height, disabled: Boolean(disabled),
    });
  }

  function drawButton(action, x, y, width, height) {
    const [background, foreground, stroke] = buttonPalette(action.kind, action.disabled);
    fillRound(ctx, x, y, width, height, 10, background, stroke, 2);
    setFont(ctx, height >= 54 ? 18 : 16, 700);
    ctx.fillStyle = foreground;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, action.label.toUpperCase(), width - 24), x + width / 2, y + height / 2 + 1);
    addHotspot(action.id, action.label, action.kind, x, y, width, height, action.disabled);
  }

  function drawHeader(app) {
    ctx.fillStyle = COLORS.green;
    ctx.fillRect(0, 0, FRONT_DESK_MONITOR_WIDTH, 78);

    setFont(ctx, 22, 800);
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('PINEHOLLOW', 24, 29);
    setFont(ctx, 14, 600);
    ctx.fillStyle = COLORS.brassPale;
    ctx.fillText('GOLF CLUB  /  FRONT DESK', 24, 54);
    addHotspot('home', 'Home', 'nav', 16, 10, 330, 58);

    drawButton({ id: 'exit', label: 'Exit', kind: 'secondary', disabled: false }, 886, 17, 114, 46);

    const tabs = [
      { id: 'tab-check-in', label: 'Check In', app: 'check-in', x: 24 },
      { id: 'tab-checkout', label: 'Checkout', app: 'checkout', x: 224 },
    ];
    for (const tab of tabs) {
      const selected = app === tab.app;
      fillRound(ctx, tab.x, 92, 184, 52, 10,
        selected ? COLORS.green : COLORS.paper,
        selected ? COLORS.green : COLORS.sage, 2);
      setFont(ctx, 18, 800);
      ctx.fillStyle = selected ? COLORS.white : COLORS.green;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tab.label.toUpperCase(), tab.x + 92, 119);
      addHotspot(tab.id, tab.label, 'tab', tab.x, 92, 184, 52);
    }
  }

  function drawActionGrid(actions, x, y, width, height) {
    // Four choices keep every control legible at the physical monitor's size.
    // Multi-step denomination selection belongs to the physical drawer, not a
    // wall of tiny POS buttons.
    const visible = normalizeActions(actions).slice(0, 4);
    if (!visible.length) return;
    const columns = visible.length <= 2 || height < 100 ? visible.length : 2;
    const rows = Math.ceil(visible.length / columns);
    const gap = 10;
    const cellWidth = (width - gap * (columns - 1)) / columns;
    const cellHeight = Math.min(58, (height - gap * (rows - 1)) / rows);
    visible.forEach((action, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      drawButton(action, x + column * (cellWidth + gap), y + row * (cellHeight + gap), cellWidth, cellHeight);
    });
  }

  function drawHome(model) {
    setFont(ctx, 30, 800);
    ctx.fillStyle = COLORS.charcoal;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text(model.heading, 'Welcome to the front desk'), 36, 190);
    setFont(ctx, 18, 500);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(text(model.message, 'Choose an app to help the next customer.'), 36, 220);

    const cards = [
      {
        id: 'tab-check-in', x: 36, title: 'CHECK IN', number: '01',
        copy: 'Find a reservation, review the visit, and confirm arrival.',
      },
      {
        id: 'tab-checkout', x: 522, title: 'CHECKOUT', number: '02',
        copy: 'Scan shop products and complete card or cash payment.',
      },
    ];
    for (const card of cards) {
      fillRound(ctx, card.x, 258, 466, 302, 16, COLORS.paper, COLORS.sage, 2);
      setFont(ctx, 18, 800);
      ctx.fillStyle = COLORS.brass;
      ctx.textAlign = 'left';
      ctx.fillText(card.number, card.x + 28, 304);
      setFont(ctx, 34, 800);
      ctx.fillStyle = COLORS.green;
      ctx.fillText(card.title, card.x + 28, 359);
      setFont(ctx, 19, 500);
      ctx.fillStyle = COLORS.charcoal;
      const lines = wrapLines(ctx, card.copy, 380, 3);
      lines.forEach((line, index) => ctx.fillText(line, card.x + 28, 409 + index * 28));
      drawButton({ id: card.id, label: `Open ${card.title}`, kind: 'primary' }, card.x + 28, 490, 410, 50);
    }
  }

  function drawReservationList(model) {
    const reservations = Array.isArray(model.reservations) ? model.reservations.slice(0, 5) : [];
    const selectedId = text(model.selectedReservation?.id ?? model.selectedReservationId);
    fillRound(ctx, 24, 162, 416, 454, 14, COLORS.paper, COLORS.line, 2);
    drawLabel(ctx, text(model.listLabel, 'Today\'s reservations'), 46, 196);
    setFont(ctx, 15, 600);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${reservations.length} ${reservations.length === 1 ? 'booking' : 'bookings'}`, 416, 196);

    if (!reservations.length) {
      setFont(ctx, 20, 700);
      ctx.fillStyle = COLORS.green;
      ctx.textAlign = 'center';
      ctx.fillText('No reservations waiting', 232, 344);
      setFont(ctx, 16, 500);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText('New arrivals will appear here.', 232, 376);
      return;
    }

    reservations.forEach((reservation, index) => {
      const id = text(reservation.id, String(index));
      const selected = id === selectedId || reservation === model.selectedReservation;
      const y = 216 + index * 74;
      fillRound(ctx, 40, y, 384, 62, 9,
        selected ? COLORS.sagePale : COLORS.white,
        selected ? COLORS.greenSoft : COLORS.line, selected ? 2 : 1);
      setFont(ctx, 18, 700);
      ctx.fillStyle = COLORS.charcoal;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(fitText(ctx, reservationName(reservation), 230), 56, y + 27);
      setFont(ctx, 14, 600);
      ctx.fillStyle = COLORS.muted;
      const meta = [reservation.time, reservation.partySize ? `Party ${reservation.partySize}` : null]
        .filter(Boolean).join('  /  ');
      ctx.fillText(fitText(ctx, meta || text(reservation.subtitle, 'Reservation'), 230), 56, y + 49);
      drawPill(ctx, text(reservation.status, 'WAITING'), 310, y + 16, 100);
      addHotspot(text(reservation.actionId, `select-reservation:${id}`), reservationName(reservation), 'reservation', 40, y, 384, 62, reservation.disabled);
    });
  }

  function detailRow(label, value, x, y, valueColor = COLORS.charcoal) {
    drawLabel(ctx, label, x, y, COLORS.muted, 13);
    setFont(ctx, 18, 700);
    ctx.fillStyle = valueColor;
    ctx.textAlign = 'right';
    ctx.fillText(fitText(ctx, text(value, '--'), 258), x + 454, y);
  }

  function drawReservationDetail(model) {
    const reservation = model.selectedReservation;
    fillRound(ctx, 458, 162, 542, 454, 14, COLORS.paper, COLORS.line, 2);
    if (!reservation) {
      setFont(ctx, 23, 800);
      ctx.fillStyle = COLORS.green;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('Select a reservation', 729, 343);
      setFont(ctx, 16, 500);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText('Guest details and check-in actions appear here.', 729, 376);
      drawActionGrid(model.actions, 482, 528, 494, 64);
      return;
    }

    drawLabel(ctx, 'Selected guest', 482, 196);
    setFont(ctx, 28, 800);
    ctx.fillStyle = COLORS.green;
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, reservationName(reservation), 330), 482, 232);
    drawPill(ctx, text(reservation.status, 'RESERVED'), 837, 202, 139);

    const party = reservation.partySize ?? reservation.groupSize ?? reservation.players;
    const visit = [reservation.holes ? `${reservation.holes} holes` : null, party ? `${party} players` : null]
      .filter(Boolean).join('  /  ');
    detailRow('Tee time', reservation.time ?? reservation.teeTime, 482, 279);
    detailRow('Visit', visit || reservation.visit, 482, 316);
    detailRow('Cart / rentals', reservation.extras ?? reservation.cartAndRentals ?? reservation.rentals, 482, 353);
    detailRow('Deposit paid', money(reservation.depositPaid), 482, 390, COLORS.success);
    detailRow('Balance due', money(reservation.balanceDue ?? reservation.balance ?? reservation.fee), 482, 427, COLORS.green);

    const note = text(reservation.note ?? reservation.notes);
    if (note) {
      setFont(ctx, 14, 500);
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, note, 494), 482, 466);
    }
    drawActionGrid(model.actions, 482, 518, 494, 74);
  }

  function drawCheckIn(model) {
    drawReservationList(model);
    drawReservationDetail(model);
  }

  function drawItemRows(data) {
    const items = Array.isArray(data.items) ? data.items.slice(0, 6) : [];
    fillRound(ctx, 24, 162, 606, 454, 14, COLORS.paper, COLORS.line, 2);
    // Reference column order: Product | Price | Unit | Total.
    drawLabel(ctx, 'Product', 46, 196);
    drawLabel(ctx, 'Price', 434, 196, COLORS.muted, 12);
    drawLabel(ctx, 'Unit', 506, 196, COLORS.muted, 12);
    drawLabel(ctx, 'Total', 566, 196, COLORS.muted, 12);

    if (!items.length) {
      setFont(ctx, 21, 700);
      ctx.fillStyle = COLORS.green;
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for products', 327, 350);
      setFont(ctx, 16, 500);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText('Customer items will appear here.', 327, 380);
      return;
    }

    items.forEach((item, index) => {
      const y = 214 + index * 55;
      const scanned = Boolean(item.scanned || item.status === 'scanned');
      ctx.fillStyle = index % 2 ? COLORS.cream : COLORS.white;
      ctx.fillRect(40, y, 574, 49);
      ctx.fillStyle = scanned ? COLORS.success : COLORS.brass;
      ctx.beginPath();
      ctx.arc(57, y + 24, 7, 0, Math.PI * 2);
      ctx.fill();
      setFont(ctx, 17, scanned ? 600 : 700);
      ctx.fillStyle = scanned ? COLORS.muted : COLORS.charcoal;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, text(item.name ?? item.label ?? item.sku, 'Product'), 336), 76, y + 24);
      setFont(ctx, 16, 600);
      ctx.textAlign = 'right';
      const quantity = Math.max(1, Math.round(finite(item.qty ?? item.quantity, 1)));
      ctx.fillText(money(item.unitPrice ?? item.price), 476, y + 24);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(String(quantity), 530, y + 24);
      ctx.fillStyle = COLORS.green;
      ctx.fillText(money(item.subtotal ?? finite(item.unitPrice ?? item.price) * quantity), 604, y + 24);
    });

    if (data.itemsRemaining !== undefined) {
      const remaining = Math.max(0, Math.round(finite(data.itemsRemaining)));
      drawPill(ctx, remaining ? `${remaining} REMAINING` : 'ALL SCANNED', 46, 564, 160);
    }
  }

  function summaryRow(label, value, x, y, strong = false, color = COLORS.charcoal) {
    setFont(ctx, strong ? 17 : 15, strong ? 800 : 600);
    ctx.fillStyle = strong ? COLORS.charcoal : COLORS.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label.toUpperCase(), x, y);
    setFont(ctx, strong ? 23 : 17, strong ? 800 : 700);
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(value, x + 300, y);
  }

  function drawCheckoutSummary(data) {
    fillRound(ctx, 648, 162, 352, 454, 14, COLORS.paper, COLORS.line, 2);
    const stage = canonicalStage(data.stage);
    const stageCopy = STAGE_COPY[stage] ?? [text(data.stage, 'CHECKOUT').toUpperCase(), 'Follow the on-screen instructions.'];

    drawLabel(ctx, 'Current transaction', 670, 194);
    setFont(ctx, 22, 800);
    ctx.fillStyle = COLORS.green;
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, customerName(data), 206), 670, 226);
    setFont(ctx, 13, 700);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`#${text(data.transactionNumber ?? data.txNumber ?? data.id, '--')}`, 976, 224);

    const choice = customerPaymentChoice(data);
    const choiceOffset = choice ? 32 : 0;
    if (choice) {
      drawPill(ctx, `CUSTOMER CHOSE ${choice}`, 670, 238, 306);
      setFont(ctx, 12, 600);
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(fitText(ctx, paymentChoiceDialogueFor(data, choice), 306), 670, 282);
    }

    const statusY = choice ? 292 : 246;
    const status = paymentChoiceStatus(data, stage, stageCopy, choice);
    const instruction = paymentChoiceInstruction(data, stageCopy, choice);
    const [statusBackground, statusForeground] = statusPalette(status);
    fillRound(ctx, 670, statusY, 306, 82, 10, statusBackground);
    setFont(ctx, 17, 800);
    ctx.fillStyle = statusForeground;
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, status, 278), 686, statusY + 27);
    setFont(ctx, 14, 500);
    const lines = wrapLines(ctx, instruction, 278, 2);
    lines.forEach((line, index) => ctx.fillText(line, 686, statusY + 53 + index * 18));

    summaryRow('Subtotal', money(data.subtotal), 670, 351 + choiceOffset);
    const discount = Math.abs(finite(data.discount));
    summaryRow('Discount', discount > 0 ? `-${money(discount)}` : money(0), 670, 377 + choiceOffset);
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(670, 390 + choiceOffset);
    ctx.lineTo(976, 390 + choiceOffset);
    ctx.stroke();
    // Prominent total block, matching the reference's emphasis.
    setFont(ctx, 18, 800);
    ctx.fillStyle = COLORS.charcoal;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('TOTAL', 670, 421 + choiceOffset);
    setFont(ctx, 32, 800);
    ctx.fillStyle = COLORS.green;
    ctx.textAlign = 'right';
    ctx.fillText(money(data.total), 976, 424 + choiceOffset);

    if (data.payment || data.paymentMethod) {
      summaryRow('Payment', text(data.payment ?? data.paymentMethod).toUpperCase(), 670, 446 + choiceOffset);
    }
    if (data.tendered !== undefined || data.amountPaid !== undefined) {
      summaryRow('Tendered', money(data.tendered ?? data.amountPaid), 670, 472 + choiceOffset);
    }
    if (data.changeDue !== undefined) {
      summaryRow('Change due', money(data.changeDue), 670, 498 + choiceOffset, false, COLORS.green);
    }
    if (data.selectedChange !== undefined || data.selected !== undefined) {
      summaryRow('Selected', money(data.selectedChange ?? data.selected), 670, 524 + choiceOffset);
    }

    drawActionGrid(data.actions, 670, 546 + choiceOffset, 306, choice ? 38 : 50);
  }

  function drawCheckout(model) {
    const data = checkoutData(model);
    drawItemRows(data);
    drawCheckoutSummary(data);
  }

  function draw(model = {}) {
    activeHotspots = [];
    const app = canonicalApp(model.app ?? model.tab ?? model.view);
    ctx.save();
    ctx.clearRect(0, 0, FRONT_DESK_MONITOR_WIDTH, FRONT_DESK_MONITOR_HEIGHT);
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(0, 0, FRONT_DESK_MONITOR_WIDTH, FRONT_DESK_MONITOR_HEIGHT);
    drawHeader(app);
    if (app === 'check-in') drawCheckIn(model);
    else if (app === 'checkout') drawCheckout(model);
    else drawHome(model);
    ctx.restore();
    return api;
  }

  function hit(canvasX, canvasY) {
    const x = finite(canvasX, NaN);
    const y = finite(canvasY, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    for (let index = activeHotspots.length - 1; index >= 0; index -= 1) {
      const hotspot = activeHotspots[index];
      if (hotspot.disabled) continue;
      if (x >= hotspot.x && x <= hotspot.x + hotspot.width
        && y >= hotspot.y && y <= hotspot.y + hotspot.height) return hotspot.id;
    }
    return null;
  }

  function actionPoint(actionId) {
    const hotspot = activeHotspots.find((candidate) => candidate.id === actionId && !candidate.disabled);
    if (!hotspot) return null;
    return { x: hotspot.x + hotspot.width / 2, y: hotspot.y + hotspot.height / 2 };
  }

  function hotspots() {
    return activeHotspots.map((hotspot) => ({ ...hotspot }));
  }

  const api = Object.freeze({ draw, hit, actionPoint, hotspots });
  draw({ app: 'home' });
  return api;
}
