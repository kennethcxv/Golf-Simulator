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
  'cash-payment': ['CASH PAYMENT', 'Click the presented cash to take it.'],
  'change-selection': ['SELECT CHANGE', 'Count change from the drawer: exact, or up to $5.00 over.'],
  'payment-complete': ['PAYMENT COMPLETE', 'Payment was accepted successfully.'],
  'receipt-delivering': ['RECEIPT TO CUSTOMER', 'The receipt is being handed across.'],
  'bag-transfer': ['BAG TO CUSTOMER', 'The customer is taking their bag.'],
  'ready-to-finalize': ['READY TO FINALIZE', 'The receipt and bag are on their way across the counter.'],
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
  if (app === 'teesheet') return 'tee-sheet';
  if (app === 'check-in' || app === 'checkout' || app === 'cash' || app === 'tee-sheet') return app;
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

const TEXT_SCALE = new WeakMap();

function setFont(ctx, size, weight = 500) {
  const scale = TEXT_SCALE.get(ctx) || 1;
  ctx.font = `${weight} ${Math.round(size * scale)}px Arial, sans-serif`;
}

// EVERY STRING THIS SCREEN HAS EVER HAD TO CUT.
//
// F1/C7: two of the complaints in this brief are the same defect seen twice —
// "Tee times read 'x am ...'" and "'Customer rec...' on overpay is cut off".
// Both are this function doing its job on copy that was written without checking
// it fits. There was no way to find the others except by opening every screen in
// every state and reading them, so now the screen remembers: anything it
// truncates is recorded once, with the width it had and the width it needed.
// tests/front-desk-monitor-fits.test.js reads this and fails on a new one.
export const MONITOR_TRUNCATIONS = [];
const seenTruncations = new Set();

function fitText(ctx, value, maxWidth) {
  const source = text(value);
  const full = ctx.measureText(source).width;
  if (full <= maxWidth) return source;
  if (!seenTruncations.has(source)) {
    seenTruncations.add(source);
    MONITOR_TRUNCATIONS.push({
      text: source,
      maxWidth,
      neededWidth: Math.round(full),
      overBy: Math.round(full - maxWidth),
    });
  }
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
  let targetPadding = 0;

  function addHotspot(id, label, kind, x, y, width, height, disabled = false) {
    if (!id) return;
    const left = Math.max(0, x - targetPadding);
    const top = Math.max(0, y - targetPadding);
    const right = Math.min(FRONT_DESK_MONITOR_WIDTH, x + width + targetPadding);
    const bottom = Math.min(FRONT_DESK_MONITOR_HEIGHT, y + height + targetPadding);
    activeHotspots.push({
      id: text(id), label: text(label), kind: text(kind, 'action'),
      x: left, y: top, width: right - left, height: bottom - top,
      centerX: x + width / 2, centerY: y + height / 2,
      visualWidth: width, visualHeight: height,
      disabled: Boolean(disabled),
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

  function drawHeader(app, clubName) {
    ctx.fillStyle = COLORS.green;
    ctx.fillRect(0, 0, FRONT_DESK_MONITOR_WIDTH, 78);

    setFont(ctx, 22, 800);
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // THE CLUB'S OWN NAME WAS BEING CUT. "PINE HILLS MUNICIPAL GOLF" needs
    // 383px at 22px bold and the box was 322, so the default club in the default
    // save drew its own masthead as "PINE HILLS MUNICIPAL G...". The bar runs
    // the full 1024 and the Exit button starts at 886, so the width was simply
    // never checked against the name it ships with. 560 leaves the button clear
    // and still truncates a genuinely long custom name rather than colliding.
    ctx.fillText(
      fitText(ctx, text(clubName, 'Pine Hills Municipal Golf').toUpperCase(), 560),
      24,
      29,
    );
    setFont(ctx, 14, 600);
    ctx.fillStyle = COLORS.brassPale;
    ctx.fillText('GOLF CLUB  /  FRONT DESK', 24, 54);

    drawButton({ id: 'exit', label: 'Exit', kind: 'secondary', disabled: false }, 886, 17, 114, 46);

    // The cash exchange owns the full screen below the brand bar; offering tab
    // navigation mid-count would only orphan the open drawer. VERIFY2_L: the
    // brand block's own 'home' hotspot has to sit behind this gate too - it
    // was the one live control that could swap the glass off a cash count.
    if (app === 'cash') return;
    addHotspot('home', 'Home', 'nav', 16, 10, 330, 58);

    const tabs = [
      { id: 'tab-check-in', label: 'Check In', app: 'check-in', x: 24 },
      { id: 'tab-checkout', label: 'Checkout', app: 'checkout', x: 224 },
      { id: 'tab-tee-sheet', label: 'Tee Sheet', app: 'tee-sheet', x: 424 },
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

  function drawActionGrid(actions, x, y, width, height, forcedColumns = null) {
    // Four choices keep every control legible at the physical monitor's size.
    // Multi-step denomination selection belongs to the physical drawer, not a
    // wall of tiny POS buttons.
    const visible = normalizeActions(actions).slice(0, 4);
    if (!visible.length) return;
    // A caller with a narrow column can insist on one button per row. Splitting
    // 308px between two buttons left "Ready for the next customer" rendering as
    // "READY FOR T..." — a control the player cannot read is not a control.
    const columns = forcedColumns
      || (visible.length <= 2 || height < 100 ? visible.length : 2);
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
    const totalCount = Math.max(finite(model.reservationCount, reservations.length), reservations.length);
    const page = Math.max(0, Math.round(finite(model.page, 0)));
    const pageCount = Math.max(1, Math.round(finite(model.pageCount, 1)));
    fillRound(ctx, 24, 162, 416, 454, 14, COLORS.paper, COLORS.line, 2);
    drawLabel(ctx, text(model.listLabel, 'Today\'s reservations'), 46, 196);
    setFont(ctx, 15, 600);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${totalCount} ${totalCount === 1 ? 'booking' : 'bookings'}`, 416, 196);

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
      const y = 212 + index * 68;
      fillRound(ctx, 40, y, 384, 60, 9,
        selected ? COLORS.sagePale : COLORS.white,
        selected ? COLORS.greenSoft : COLORS.line, selected ? 2 : 1);
      setFont(ctx, 19, 700);
      ctx.fillStyle = COLORS.charcoal;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(fitText(ctx, reservationName(reservation), 226), 56, y + 26);
      setFont(ctx, 15, 600);
      ctx.fillStyle = COLORS.muted;
      const meta = [reservation.time, reservation.partySize ? `Party ${reservation.partySize}` : null]
        .filter(Boolean).join('  /  ');
      ctx.fillText(fitText(ctx, meta || text(reservation.subtitle, 'Reservation'), 226), 56, y + 48);
      drawPill(ctx, text(reservation.status, 'WAITING'), 310, y + 15, 100);
      addHotspot(text(reservation.actionId, `select-reservation:${id}`), reservationName(reservation), 'reservation', 40, y, 384, 60, reservation.disabled);
    });

    // More golfers than fit are paged, never shrunk into unreadable rows.
    if (pageCount > 1) {
      drawButton({ id: 'checkin-prev', label: 'Prev', kind: 'secondary', disabled: page <= 0 }, 40, 560, 110, 42);
      setFont(ctx, 16, 700);
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`PAGE ${page + 1} / ${pageCount}`, 232, 582);
      drawButton({ id: 'checkin-next', label: 'Next', kind: 'secondary', disabled: page >= pageCount - 1 }, 314, 560, 110, 42);
    }
  }

  function detailRow(label, value, x, y, valueColor = COLORS.charcoal) {
    drawLabel(ctx, label, x, y, COLORS.muted, 14);
    setFont(ctx, 21, 700);
    ctx.fillStyle = valueColor;
    ctx.textAlign = 'right';
    ctx.fillText(fitText(ctx, text(value, '--'), 300), x + 494, y);
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
    setFont(ctx, 30, 800);
    ctx.fillStyle = COLORS.green;
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, reservationName(reservation), 330), 482, 234);
    drawPill(ctx, text(reservation.status, 'RESERVED'), 837, 202, 139);

    const party = reservation.partySize ?? reservation.groupSize ?? reservation.players;
    const visit = [reservation.holes ? `${reservation.holes} holes` : null, party ? `${party} players` : null]
      .filter(Boolean).join('  /  ');
    detailRow('Tee time', reservation.time ?? reservation.teeTime, 482, 284);
    detailRow('Visit', visit || reservation.visit, 482, 322);
    detailRow('Cart / rentals', reservation.extras ?? reservation.cartAndRentals ?? reservation.rentals, 482, 360);
    detailRow('Deposit paid', money(reservation.depositPaid), 482, 398, COLORS.success);

    // The amount owed is the loudest number on the screen — a filled panel,
    // not another quiet row.
    const due = finite(reservation.balanceDue ?? reservation.balance ?? reservation.fee);
    fillRound(ctx, 482, 418, 494, 62, 12, due > 0 ? COLORS.successPale : COLORS.sagePale, COLORS.success, 2);
    setFont(ctx, 19, 800);
    ctx.fillStyle = COLORS.charcoal;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(due > 0 ? 'AMOUNT DUE' : 'PAID IN FULL', 502, 450);
    setFont(ctx, 34, 800);
    ctx.fillStyle = COLORS.success;
    ctx.textAlign = 'right';
    ctx.fillText(money(due), 956, 451);
    ctx.textBaseline = 'alphabetic';

    const note = text(reservation.note ?? reservation.notes);
    if (note) {
      setFont(ctx, 14, 500);
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, note, 494), 482, 502);
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
      setFont(ctx, 22, scanned ? 650 : 750);
      ctx.fillStyle = scanned ? COLORS.muted : COLORS.charcoal;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, text(item.name ?? item.label ?? item.sku, 'Product'), 336), 76, y + 24);
      setFont(ctx, 20, 700);
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

  function summaryRow(label, value, x, y, width, strong = false, color = COLORS.charcoal, compact = false) {
    // In a paired cell the label and the figure share half the column, so the
    // figure is measured FIRST and the label gets what is left. Sizing them
    // independently is what printed "CHANGE D$21.78" over itself.
    const valueSize = compact ? 17 : (strong ? 26 : 19);
    setFont(ctx, valueSize, strong ? 800 : 700);
    const valueWidth = ctx.measureText(value).width;
    setFont(ctx, compact ? 13 : (strong ? 18 : 16), strong ? 800 : 600);
    ctx.fillStyle = strong ? COLORS.charcoal : COLORS.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitText(ctx, label.toUpperCase(), Math.max(30, width - valueWidth - 10)), x, y);
    setFont(ctx, valueSize, strong ? 800 : 700);
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(value, x + width, y);
  }

  // THE SUMMARY COLUMN, LAID OUT RATHER THAN NUDGED (round 10, 2026-08-03).
  //
  // Every block in here used to be a literal y plus a stack of hand-added
  // corrections — `choiceOffset` when the customer had picked a method,
  // `taxOffset` because the sales-tax line was added later — so the column's
  // real height depended on which optional rows happened to be present, and
  // nothing checked where the bottom landed. With a payment choice showing, the
  // action grid solved to y=604 with height 38: 642 on a 640-tall canvas. The
  // primary button was six pixels outside its own panel card and two pixels off
  // the bottom of the screen. Reported three sessions running as "flush against
  // the bottom with no margin" and "the panel reads cluttered".
  //
  // It is a top-down cursor inside a padded panel now, with the actions ANCHORED
  // to the panel's bottom padding and the money block sitting just above them.
  // Optional rows move the cursor instead of shifting a stack of literals, so no
  // arrangement can reach the edge: the edge is where the layout stops. The
  // rhythm below is a scale rather than per-element guesses, which is most of
  // what "breathing room" means on a panel this size.
  const SUMMARY = Object.freeze({
    x: 648, y: 162, w: 352, h: 454, pad: 22,
    gapXs: 10, gapSm: 16, gapMd: 26, gapLg: 34,
  });

  function drawCheckoutSummary(data) {
    const x = SUMMARY.x + SUMMARY.pad;
    const width = SUMMARY.w - SUMMARY.pad * 2;
    const right = x + width;
    const top = SUMMARY.y + SUMMARY.pad;
    const floor = SUMMARY.y + SUMMARY.h - SUMMARY.pad;
    fillRound(ctx, SUMMARY.x, SUMMARY.y, SUMMARY.w, SUMMARY.h, 14, COLORS.paper, COLORS.line, 2);

    const stage = canonicalStage(data.stage);
    const stageCopy = STAGE_COPY[stage] ?? [text(data.stage, 'CHECKOUT').toUpperCase(), 'Follow the on-screen instructions.'];
    const choice = customerPaymentChoice(data);
    const status = paymentChoiceStatus(data, stage, stageCopy, choice);
    const instruction = paymentChoiceInstruction(data, stageCopy, choice);

    // --- WHAT THERE IS TO SAY ------------------------------------------------
    const discount = Math.abs(finite(data.discount));
    const taxRate = finite(data.taxRate);
    const taxLabel = taxRate > 0
      ? `Sales tax ${(taxRate * 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`
      // "Sales tax (none in state)" needed 263px in a 246px column and drew as
      // "Sales tax (none in st...". A parenthetical is the first thing to go.
      : 'Sales tax - none';
    const breakdown = [['Subtotal', money(data.subtotal)]];
    // A "DISCOUNT $0.00" row on every single sale is the clutter, not the
    // spacing. It appears when there IS one.
    if (discount > 0) breakdown.push(['Discount', `-${money(discount)}`]);
    breakdown.push([taxLabel, money(finite(data.tax))]);

    // Each tender row carries how load-bearing it is, because a column that has
    // to shed rows must shed the right ones. What the customer still has coming
    // back to them outranks how they paid.
    const tail = [];
    if (data.payment || data.paymentMethod) {
      tail.push({
        label: 'Payment', value: text(data.payment ?? data.paymentMethod).toUpperCase(),
        color: COLORS.charcoal, keep: 1,
      });
    }
    if (data.tendered !== undefined || data.amountPaid !== undefined) {
      tail.push({
        label: 'Tendered', value: money(data.tendered ?? data.amountPaid),
        color: COLORS.charcoal, keep: 2,
      });
    }
    if (data.changeDue !== undefined) {
      tail.push({ label: 'Change due', value: money(data.changeDue), color: COLORS.green, keep: 4 });
    }
    if (data.selectedChange !== undefined || data.selected !== undefined) {
      tail.push({
        label: 'Selected', value: money(data.selectedChange ?? data.selected),
        color: COLORS.charcoal, keep: 3,
      });
    }

    // --- SOLVE THE COLUMN BEFORE DRAWING ANY OF IT ---------------------------
    // Measure first, draw second. Solving as it drew is what left the money
    // block computing its own position from whatever the status card happened to
    // have consumed, which put it either over the status card or under the
    // buttons depending on the state. Now nothing is painted until the whole
    // column is known to fit, and the ways it may give — in order — are: a
    // tighter row pitch, tender rows paired two to a line, a one-line
    // instruction, then dropping the least load-bearing tender rows.
    setFont(ctx, 16, 600);
    const instructionLines = wrapLines(ctx, instruction, width - 32, 2);
    const headerHeight = 44;
    const choiceHeight = choice ? 57 : 0;
    const TOTAL_BLOCK = 44;
    const actionCount = normalizeActions(data.actions).slice(0, 4).length;
    const actionColumns = actionCount <= 2 ? 1 : 2;
    const actionRows = Math.ceil(actionCount / actionColumns) || 0;
    const actionHeight = actionCount ? actionRows * 46 + (actionRows - 1) * 10 : 0;

    const fit = { pitch: 25, lines: instructionLines.length, tailColumns: 1, tail: [...tail] };
    const statusHeight = () => 44 + fit.lines * 20;
    const tailRows = () => Math.ceil(fit.tail.length / fit.tailColumns);
    const used = () => headerHeight + choiceHeight + SUMMARY.gapSm + statusHeight()
      + SUMMARY.gapSm
      + (breakdown.length + tailRows()) * fit.pitch + TOTAL_BLOCK + SUMMARY.gapSm
      + (actionHeight ? SUMMARY.gapSm + actionHeight : 0);
    const available = floor - top;
    const concessions = [
      () => { if (fit.pitch === 25) { fit.pitch = 22; return true; } return false; },
      () => { if (fit.tail.length >= 3 && fit.tailColumns === 1) { fit.tailColumns = 2; return true; } return false; },
      () => { if (fit.lines > 1) { fit.lines = 1; return true; } return false; },
      () => {
        if (!fit.tail.length) return false;
        let weakest = 0;
        for (let index = 1; index < fit.tail.length; index += 1) {
          if (fit.tail[index].keep < fit.tail[weakest].keep) weakest = index;
        }
        fit.tail.splice(weakest, 1);
        return true;
      },
    ];
    for (const concede of concessions) {
      while (used() > available && concede()) { /* give one thing at a time */ }
      if (used() <= available) break;
    }

    // --- DRAW ----------------------------------------------------------------
    let y = top + 12;
    drawLabel(ctx, 'Current transaction', x, y);
    y += SUMMARY.gapMd + 6;
    setFont(ctx, 22, 800);
    ctx.fillStyle = COLORS.green;
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, customerName(data), width - 60), x, y);
    setFont(ctx, 13, 700);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`#${text(data.transactionNumber ?? data.txNumber ?? data.id, '--')}`, right, y - 2);

    if (choice) {
      // Tight, because this block is a caption on the one above it rather than a
      // section of its own: the pill and the line the customer said belong
      // together, and every pixel spent separating them is a pixel the money
      // block does not get.
      y += SUMMARY.gapXs;
      drawPill(ctx, `CUSTOMER CHOSE ${choice}`, x, y, width);
      y += 34;
      setFont(ctx, 14, 650);
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(fitText(ctx, paymentChoiceDialogueFor(data, choice), width), x, y + 13);
      y += 13;
    }

    y += SUMMARY.gapSm;
    const lines = instructionLines.slice(0, fit.lines);
    const [statusBackground, statusForeground] = statusPalette(status);
    fillRound(ctx, x, y, width, statusHeight(), 10, statusBackground);
    // The heading shrinks before it truncates: "TRANSACTION COMPLETE" is the
    // longest state string and was rendering as "TRANSACTION COMPLE...", which
    // hides the one word that says whether the sale went through.
    ctx.fillStyle = statusForeground;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const size of [19, 18, 17, 16, 15]) {
      setFont(ctx, size, 800);
      if (ctx.measureText(status).width <= width - 32 || size === 15) break;
    }
    ctx.fillText(fitText(ctx, status, width - 32), x + 16, y + 28);
    setFont(ctx, 16, 600);
    lines.forEach((line, index) => ctx.fillText(line, x + 16, y + 52 + index * 20));
    y += statusHeight() + SUMMARY.gapSm;

    // the money block flows straight on from the status card, and the controls
    // are pinned to the bottom padding — the fit above guarantees they clear
    const actionsY = floor - actionHeight;
    const ruleY = y + breakdown.length * fit.pitch + 6;
    const totalBaseline = ruleY + 32;
    breakdown.forEach(([label, value], index) => {
      summaryRow(label, value, x, y + (index + 1) * fit.pitch - 6, width);
    });

    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, ruleY);
    ctx.lineTo(right, ruleY);
    ctx.stroke();

    setFont(ctx, 20, 800);
    ctx.fillStyle = COLORS.charcoal;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('TOTAL', x, totalBaseline);
    setFont(ctx, 38, 800);
    ctx.fillStyle = COLORS.green;
    ctx.textAlign = 'right';
    ctx.fillText(money(data.total), right, totalBaseline + 3);

    const tailCellWidth = fit.tailColumns === 2
      ? Math.floor((width - SUMMARY.gapMd) / 2)
      : width;
    fit.tail.forEach((entry, index) => {
      const column = index % fit.tailColumns;
      const row = Math.floor(index / fit.tailColumns);
      summaryRow(
        entry.label, entry.value,
        x + column * (tailCellWidth + SUMMARY.gapMd),
        totalBaseline + SUMMARY.gapSm + (row + 1) * fit.pitch - 6,
        tailCellWidth, false, entry.color, fit.tailColumns === 2,
      );
    });

    if (actionHeight) {
      drawActionGrid(data.actions, x, actionsY, width, actionHeight, actionColumns);
    }
  }

  function drawCheckout(model) {
    const data = checkoutData(model);
    drawItemRows(data);
    drawCheckoutSummary(data);
  }

  // THE CASH SCREEN. During a cash exchange this view owns the whole monitor,
  // sitting directly above the open drawer: the orange Received/Total/Change
  // block, the navy Giving strip whose colour states the rule (red short,
  // green exact, amber allowed overage, red beyond $5.00), and Undo/Clear/Done.
  function drawCashScreen(model) {
    setFont(ctx, 20, 800);
    ctx.fillStyle = COLORS.charcoal;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitText(ctx, customerName(model), 460), 36, 128);
    setFont(ctx, 16, 700);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`#${text(model.transactionNumber, '--')}`, 988, 126);

    fillRound(ctx, 24, 146, 976, 268, 16, '#ef9824');
    setFont(ctx, 26, 800);
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = 'center';
    ctx.fillText('CASH PAYMENT', 512, 186);
    const rows = [
      ['RECEIVED', model.received],
      ['TOTAL', model.total],
      ['CHANGE', model.changeDue],
    ];
    rows.forEach(([label, value], index) => {
      const y = 240 + index * 56;
      setFont(ctx, 34, 800);
      ctx.fillStyle = COLORS.white;
      ctx.textAlign = 'left';
      ctx.fillText(label, 84, y);
      setFont(ctx, 38, 800);
      ctx.textAlign = 'right';
      ctx.fillText(money(value), 940, y);
      if (index === 1) {
        ctx.strokeStyle = '#b26a10';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(84, y + 16);
        ctx.lineTo(940, y + 16);
        ctx.stroke();
      }
    });

    fillRound(ctx, 24, 430, 976, 96, 14, '#163e5a');
    setFont(ctx, 36, 800);
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = 'left';
    ctx.fillText('GIVING', 84, 492);
    const givingState = text(model.givingState, 'short');
    const givingColor = givingState === 'exact' ? '#54ef6e'
      : givingState === 'over' ? '#ffc94d' : '#ff5147';
    setFont(ctx, 44, 800);
    ctx.fillStyle = givingColor;
    ctx.textAlign = 'right';
    ctx.fillText(money(model.giving), 940, 494);

    const deltaCents = Math.abs(Math.round(finite(model.givingDeltaCents)));
    const deltaText = `$${(deltaCents / 100).toFixed(2)}`;
    let caption;
    // C7/F1: 36 characters at 24px bold in a 500px box drew as "CLICK THE
    // CUSTOMER'S CASH TO ..." in the shipping build. Photographed, not guessed.
    if (model.awaitingCash) caption = 'CLICK THEIR CASH TO TAKE IT';
    else if (givingState === 'exact') caption = 'EXACT CHANGE';
    // C7: "OVER BY $2.50 - CUSTOMER RECEIVES EXTRA CHANGE" is 45 characters at
    // 24px bold and the box is 500px, so it drew as "...CUSTOMER REC...". The
    // captions either side of it are three words; this one was a sentence.
    else if (givingState === 'over') caption = `${deltaText} OVER - THEY KEEP IT`;
    else if (givingState === 'excess') caption = 'TOO MUCH - MAX EXTRA IS $5.00';
    else caption = finite(model.givingDeltaCents) === 0 && !model.deposited
      ? 'SORTING THE RECEIVED CASH'
      : `SHORT BY ${deltaText}`;
    setFont(ctx, 24, 800);
    ctx.fillStyle = givingState === 'exact' ? COLORS.success
      : givingState === 'over' ? '#a06a00' : COLORS.danger;
    if (model.awaitingCash) ctx.fillStyle = COLORS.charcoal;
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, caption, 500), 36, 566);

    drawActionGrid(model.actions, 560, 540, 440, 56);
  }

  // L2 — THE TEE SHEET IS A SHEET. Every slot of the day on one screen, the
  // way a paper starter's sheet reads: a time column, one seat pip per place
  // in the slot (filled = booked), holder names beside them, closed rows said
  // plainly, a rule at the current time. Open rows become booking hotspots
  // whenever the model marks them bookable (a walk-in is selected at the desk
  // head); the action id is the same select-walkin-slot the check-in tab
  // uses, so this is one flow with two surfaces.
  function drawTeeSheet(model) {
    const slots = Array.isArray(model.sheet) ? model.sheet : [];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    setFont(ctx, 26, 800);
    ctx.fillStyle = COLORS.charcoal;
    ctx.fillText(fitText(ctx, text(model.heading, 'Tee sheet'), 560), 36, 192);
    setFont(ctx, 16, 500);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(fitText(ctx, text(model.context), 700), 36, 218);
    if (!slots.length) {
      setFont(ctx, 20, 600);
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'center';
      ctx.fillText('The course is closed today.', FRONT_DESK_MONITOR_WIDTH / 2, 380);
      return;
    }

    const top = 240;
    const bottom = model.note ? 596 : 616;
    const columnX = [24, 524];
    const columnWidth = 476;
    const perColumn = Math.ceil(slots.length / columnX.length);
    const rowHeight = Math.max(22, Math.min(34, (bottom - top) / perColumn));
    ctx.textBaseline = 'middle';
    slots.forEach((slot, index) => {
      const column = Math.floor(index / perColumn);
      const row = index % perColumn;
      const x = columnX[column];
      const y = top + row * rowHeight;
      const middle = y + rowHeight / 2;
      const dim = slot.past || slot.closed;
      // the asked slot wears a pale brass ground; the now line is a brass rule
      if (slot.asked && !dim) {
        fillRound(ctx, x, y + 1, columnWidth, rowHeight - 2, 6, COLORS.brassPale);
      }
      if (slot.now) {
        ctx.fillStyle = COLORS.brass;
        ctx.fillRect(x, y - 1, columnWidth, 2);
      }
      setFont(ctx, 15, 700);
      ctx.textAlign = 'left';
      ctx.fillStyle = dim ? COLORS.muted : COLORS.green;
      ctx.fillText(text(slot.label), x + 10, middle + 1);
      // seat pips: one box per place, filled for each booked player
      const capacity = Math.max(0, Math.min(6, finite(slot.capacity, 4)));
      const booked = Math.max(0, Math.min(capacity, finite(slot.booked, 0)));
      const pipSize = Math.min(13, rowHeight - 10);
      for (let seat = 0; seat < capacity; seat += 1) {
        const pipX = x + 98 + seat * (pipSize + 5);
        const pipY = middle - pipSize / 2;
        roundedPath(ctx, pipX, pipY, pipSize, pipSize, 3);
        if (slot.closed) {
          ctx.strokeStyle = COLORS.line;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (seat < booked) {
          ctx.fillStyle = dim ? COLORS.sage : COLORS.greenSoft;
          ctx.fill();
        } else {
          ctx.strokeStyle = dim ? COLORS.line : COLORS.sage;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      // names, or the slot's state, in the remaining width
      const textX = x + 98 + 6 * (pipSize + 5) + 8;
      const textWidth = x + columnWidth - 10 - textX;
      setFont(ctx, 13, 500);
      if (slot.closed) {
        ctx.fillStyle = COLORS.muted;
        ctx.fillText('CLOSED', textX, middle + 1);
      } else if (slot.names && slot.names.length) {
        ctx.fillStyle = dim ? COLORS.muted : COLORS.charcoal;
        ctx.fillText(fitText(ctx, slot.names.join(', '), textWidth), textX, middle + 1);
      } else if (!slot.past) {
        ctx.fillStyle = slot.actionId ? COLORS.success : COLORS.sage;
        ctx.fillText(slot.actionId ? `${finite(slot.openSeats, 0)} open · book` : `${finite(slot.openSeats, 0)} open`, textX, middle + 1);
      }
      if (slot.actionId) {
        addHotspot(slot.actionId, `Book ${slot.label}`, 'slot', x, y, columnWidth, rowHeight, false);
      }
    });
    if (model.note) {
      setFont(ctx, 15, 600);
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.brass;
      ctx.fillText(fitText(ctx, text(model.note), 952), 36, 616);
    }
  }

  function draw(model = {}) {
    activeHotspots = [];
    const accessibility = model.accessibility && typeof model.accessibility === 'object'
      ? model.accessibility
      : {};
    TEXT_SCALE.set(ctx, Math.max(1, Math.min(1.2, finite(accessibility.textScale, 1))));
    targetPadding = Math.max(0, Math.min(12, finite(accessibility.targetPadding, 0)));
    const app = canonicalApp(model.app ?? model.tab ?? model.view);
    ctx.save();
    ctx.clearRect(0, 0, FRONT_DESK_MONITOR_WIDTH, FRONT_DESK_MONITOR_HEIGHT);
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(0, 0, FRONT_DESK_MONITOR_WIDTH, FRONT_DESK_MONITOR_HEIGHT);
    drawHeader(app, model.clubName);
    if (app === 'check-in') drawCheckIn(model);
    else if (app === 'checkout') drawCheckout(model);
    else if (app === 'cash') drawCashScreen(model);
    else if (app === 'tee-sheet') drawTeeSheet(model);
    else drawHome(model);
    ctx.restore();
    return api;
  }

  function hit(canvasX, canvasY) {
    const x = finite(canvasX, NaN);
    const y = finite(canvasY, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    let closest = null;
    let closestDistance = Infinity;
    for (let index = activeHotspots.length - 1; index >= 0; index -= 1) {
      const hotspot = activeHotspots[index];
      if (hotspot.disabled) continue;
      if (x >= hotspot.x && x <= hotspot.x + hotspot.width
        && y >= hotspot.y && y <= hotspot.y + hotspot.height) {
        // Expanded neighboring controls can overlap by a few pixels. Resolve
        // that seam by the nearest visible control center, not draw order.
        const dx = (x - hotspot.centerX) / Math.max(1, hotspot.visualWidth);
        const dy = (y - hotspot.centerY) / Math.max(1, hotspot.visualHeight);
        const distance = dx * dx + dy * dy;
        if (distance < closestDistance) {
          closest = hotspot.id;
          closestDistance = distance;
        }
      }
    }
    return closest;
  }

  function actionPoint(actionId) {
    const hotspot = activeHotspots.find((candidate) => candidate.id === actionId && !candidate.disabled);
    if (!hotspot) return null;
    return { x: hotspot.centerX, y: hotspot.centerY };
  }

  function hotspots() {
    return activeHotspots.map((hotspot) => {
      const { centerX, centerY, visualWidth, visualHeight, ...publicHotspot } = hotspot;
      return { ...publicHotspot };
    });
  }

  const api = Object.freeze({ draw, hit, actionPoint, hotspots });
  draw({ app: 'home' });
  return api;
}
