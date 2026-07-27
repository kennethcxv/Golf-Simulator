import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFrontDeskMonitorUi,
  FRONT_DESK_MONITOR_HEIGHT,
  FRONT_DESK_MONITOR_WIDTH,
} from '../src/render3d/clubhouse/frontDeskMonitorUi.js';

function makeCanvas() {
  const calls = [];
  const fonts = [];
  const context = {
    calls, fonts,
    save() {}, restore() {}, clearRect() {}, fillRect() {}, beginPath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {},
    stroke() {}, arc() {},
    fillText(value, x, y) { calls.push({ value, x, y }); },
    measureText(value) { return { width: String(value).length * 9 }; },
  };
  Object.defineProperty(context, 'font', {
    get() { return this._font || ''; },
    set(value) { this._font = value; fonts.push(value); },
  });
  return { width: 0, height: 0, getContext: (kind) => kind === '2d' ? context : null, context };
}

test('front-desk monitor establishes a fixed 16:10 canvas and permanent navigation targets', () => {
  const canvas = makeCanvas();
  const ui = createFrontDeskMonitorUi(canvas);

  assert.equal(canvas.width, FRONT_DESK_MONITOR_WIDTH);
  assert.equal(canvas.height, FRONT_DESK_MONITOR_HEIGHT);
  assert.equal(canvas.width / canvas.height, 1.6);
  for (const id of ['home', 'exit', 'tab-check-in', 'tab-checkout']) {
    const point = ui.actionPoint(id);
    assert.ok(point, `${id} has a visible action point`);
    assert.equal(ui.hit(point.x, point.y), id);
  }
});

test('front-desk monitor brands the shared register from the saved club name', () => {
  const canvas = makeCanvas();
  const ui = createFrontDeskMonitorUi(canvas);
  ui.draw({ app: 'home', clubName: 'Cedar Crest Golf' });

  const drawnText = canvas.context.calls.map((call) => call.value);
  assert.ok(drawnText.includes('CEDAR CREST GOLF'));
  assert.ok(!drawnText.includes('PINEHOLLOW'));
});

test('check-in reservations expose deterministic selection and caller action hotspots', () => {
  const canvas = makeCanvas();
  const ui = createFrontDeskMonitorUi(canvas);
  ui.draw({
    app: 'check-in',
    reservations: [
      { id: 'r-1', name: 'Avery Stone', time: '2:10 PM', partySize: 4, status: 'waiting' },
      { id: 'r-2', name: 'Morgan Lee', actionId: 'choose-morgan', time: '2:20 PM' },
    ],
    selectedReservation: {
      id: 'r-1', name: 'Avery Stone', time: '2:10 PM', partySize: 4,
      holes: 18, depositPaid: 20, balanceDue: 64, status: 'reserved',
    },
    actions: [
      { id: 'take-payment', label: 'Take payment', kind: 'primary' },
      { id: 'instant-check-in', label: 'Check in', disabled: true },
    ],
  });

  for (const id of ['select-reservation:r-1', 'choose-morgan', 'take-payment']) {
    const point = ui.actionPoint(id);
    assert.ok(point, `${id} has a visible action point`);
    assert.equal(ui.hit(point.x, point.y), id);
  }
  assert.equal(ui.actionPoint('instant-check-in'), null);
  const disabled = ui.hotspots().find((hotspot) => hotspot.id === 'instant-check-in');
  assert.equal(disabled.disabled, true);
  assert.equal(ui.hit(disabled.x + 4, disabled.y + 4), null);
});

test('checkout renders transaction values and rebuilds action targets for each model', () => {
  const canvas = makeCanvas();
  const ui = createFrontDeskMonitorUi(canvas);
  ui.draw({
    app: 'checkout',
    stage: 'change-selection',
    customer: { fullName: 'Casey Morgan', name: 'Casey L.' },
    transactionNumber: 1042,
    items: [
      { name: 'Pinehollow Golf Glove', qty: 1, unitPrice: 18.25, scanned: true },
      { name: 'Fairway Tees', qty: 2, unitPrice: 4.5, scanned: false },
    ],
    itemsRemaining: 2,
    subtotal: 27.25,
    discount: 0,
    total: 27.25,
    payment: 'cash',
    customerChoice: 'cash',
    paymentDialogue: 'Casey Morgan: Cash is fine.',
    tendered: 40,
    changeDue: 12.75,
    selectedChange: 10,
    status: 'Select exact change',
    actions: [{ id: 'confirm-change', label: 'Confirm change', kind: 'primary' }],
  });

  const point = ui.actionPoint('confirm-change');
  assert.ok(point);
  assert.equal(ui.hit(point.x, point.y), 'confirm-change');
  const drawnText = canvas.context.calls.map((call) => call.value);
  assert.ok(drawnText.includes('CASEY MORGAN') || drawnText.includes('Casey Morgan'));
  assert.ok(drawnText.includes('CUSTOMER CHOSE CASH'));
  assert.ok(drawnText.includes('Casey Morgan: Cash is fine.'));
  assert.ok(drawnText.includes('$27.25'));
  assert.ok(drawnText.includes('$12.75'));

  ui.draw({ app: 'home' });
  assert.equal(ui.actionPoint('confirm-change'), null, 'stale transaction hotspots are discarded');
});

test('checkout choice copy follows the authoritative method without repeating it', () => {
  for (const [choice, staleDialogue, expectedDialogue, destination] of [
    ['cash', "Rhea Osborne: I'll use my card.", 'Rhea Osborne: Cash is fine.', 'Opening the cash workspace automatically.'],
    ['card', 'Rhea Osborne: Cash is fine.', "Rhea Osborne: I'll use my card.", 'Opening the card reader automatically.'],
  ]) {
    const canvas = makeCanvas();
    const ui = createFrontDeskMonitorUi(canvas);
    ui.draw({
      app: 'checkout',
      stage: 'all-items-scanned',
      customer: { fullName: 'Rhea Osborne' },
      transactionNumber: 1,
      items: [],
      subtotal: 37.95,
      total: 37.95,
      payment: choice,
      customerChoice: choice,
      paymentDialogue: staleDialogue,
      status: `CUSTOMER CHOSE ${choice.toUpperCase()}`,
      instruction: `Rhea Osborne: I'll pay with ${choice}. Continuing automatically.`,
    });

    const drawnText = canvas.context.calls.map((call) => call.value);
    assert.equal(drawnText.filter((value) => value === `CUSTOMER CHOSE ${choice.toUpperCase()}`).length, 1);
    assert.ok(drawnText.includes(expectedDialogue));
    assert.ok(!drawnText.includes(staleDialogue));
    assert.ok(drawnText.includes('ALL ITEMS SCANNED'));
    assert.ok(drawnText.join(' ').includes(destination));
  }
});

test('checkout instructions retain words that fit after the first line break', () => {
  const canvas = makeCanvas();
  const ui = createFrontDeskMonitorUi(canvas);
  ui.draw({
    app: 'checkout',
    stage: 'products-ready',
    customer: 'Rhea Osborne',
    instruction: 'Select each product and move it through the scanner beam.',
  });

  const drawnText = canvas.context.calls.map((call) => call.value);
  assert.ok(drawnText.includes('Select each product and move'));
  assert.ok(drawnText.includes('it through the scanner beam.'));
});

test('check-in paging exposes prev/next hotspots and disables them at the ends', () => {
  const canvas = makeCanvas();
  const ui = createFrontDeskMonitorUi(canvas);
  ui.draw({
    app: 'check-in',
    reservations: [
      { id: 'r-1', name: 'Avery Stone', time: '2:10 PM' },
      { id: 'r-2', name: 'Morgan Lee', time: '2:20 PM' },
    ],
    reservationCount: 12,
    page: 0,
    pageCount: 3,
  });
  assert.equal(ui.actionPoint('checkin-prev'), null, 'prev is disabled on the first page');
  const next = ui.actionPoint('checkin-next');
  assert.ok(next, 'next is available when more pages exist');
  assert.equal(ui.hit(next.x, next.y), 'checkin-next');

  ui.draw({
    app: 'check-in',
    reservations: [{ id: 'r-11', name: 'Last Golfer', time: '4:10 PM' }],
    reservationCount: 12,
    page: 2,
    pageCount: 3,
  });
  assert.ok(ui.actionPoint('checkin-prev'), 'prev is available on a later page');
  assert.equal(ui.actionPoint('checkin-next'), null, 'next is disabled on the last page');
});

test('the cash screen shows the change window states with Undo/Clear/Done hotspots', () => {
  const canvas = makeCanvas();
  const ui = createFrontDeskMonitorUi(canvas);
  ui.draw({
    app: 'cash',
    customer: 'June Sawyer',
    transactionNumber: 18,
    received: 600,
    total: 578,
    changeDue: 22,
    giving: 25,
    givingState: 'over',
    givingDeltaCents: 300,
    deposited: true,
    actions: [
      { id: 'undo-change', label: 'Undo', kind: 'secondary' },
      { id: 'clear-change', label: 'Clear', kind: 'secondary' },
      { id: 'confirm-change', label: 'Done', kind: 'success' },
    ],
  });
  const drawn = canvas.context.calls.map((call) => call.value);
  assert.ok(drawn.includes('CASH PAYMENT'));
  assert.ok(drawn.includes('$600.00'));
  assert.ok(drawn.includes('$25.00'));
  assert.ok(drawn.some((value) => /OVER BY \$3\.00/.test(String(value))), 'the allowed overage is captioned');
  for (const id of ['undo-change', 'clear-change', 'confirm-change']) {
    const point = ui.actionPoint(id);
    assert.ok(point, `${id} is clickable`);
    assert.equal(ui.hit(point.x, point.y), id);
  }

  ui.draw({
    app: 'cash',
    received: 600,
    total: 578,
    changeDue: 22,
    giving: 30,
    givingState: 'excess',
    givingDeltaCents: 800,
    deposited: true,
    actions: [{ id: 'confirm-change', label: 'Done', kind: 'success', disabled: true }],
  });
  const drawnExcess = canvas.context.calls.map((call) => call.value);
  assert.ok(drawnExcess.some((value) => /TOO MUCH/.test(String(value))));
  assert.equal(ui.actionPoint('confirm-change'), null, 'Done is disabled beyond the $5 ceiling');
});

test('renderer is presentation-only and does not mutate the supplied model', () => {
  const canvas = makeCanvas();
  const ui = createFrontDeskMonitorUi(canvas);
  const model = Object.freeze({
    app: 'checkout',
    stage: 'card-payment',
    items: Object.freeze([Object.freeze({ name: 'Marker', qty: 1, price: 8 })]),
    actions: Object.freeze([Object.freeze({ id: 'insert', label: 'Insert card' })]),
  });
  assert.doesNotThrow(() => ui.draw(model));
  assert.deepEqual(model, {
    app: 'checkout', stage: 'card-payment',
    items: [{ name: 'Marker', qty: 1, price: 8 }],
    actions: [{ id: 'insert', label: 'Insert card' }],
  });
});

test('large checkout accessibility mode increases POS type and safe hit areas', () => {
  const normalCanvas = makeCanvas();
  const normal = createFrontDeskMonitorUi(normalCanvas);
  const model = {
    app: 'checkout',
    customer: 'Avery Stone',
    total: 24.5,
    actions: [{ id: 'confirm-change', label: 'Confirm', kind: 'primary' }],
  };
  normal.draw(model);
  const normalHotspot = normal.hotspots().find((hotspot) => hotspot.id === 'confirm-change');
  const normalLargestFont = Math.max(...normalCanvas.context.fonts.map((font) => Number(/ (\d+)px/.exec(font)?.[1] || 0)));

  const largeCanvas = makeCanvas();
  const large = createFrontDeskMonitorUi(largeCanvas);
  large.draw({
    ...model,
    accessibility: { textScale: 1.14, targetPadding: 8 },
  });
  const largeHotspot = large.hotspots().find((hotspot) => hotspot.id === 'confirm-change');
  const largeLargestFont = Math.max(...largeCanvas.context.fonts.map((font) => Number(/ (\d+)px/.exec(font)?.[1] || 0)));

  assert.ok(largeHotspot.width > normalHotspot.width);
  assert.ok(largeHotspot.height > normalHotspot.height);
  assert.ok(largeLargestFont > normalLargestFont);
  assert.equal(
    large.hit(normalHotspot.x - 4, normalHotspot.y + normalHotspot.height / 2),
    'confirm-change',
    'the padded area accepts a near-edge click',
  );
});
