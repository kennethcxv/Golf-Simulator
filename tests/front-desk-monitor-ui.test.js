import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFrontDeskMonitorUi,
  FRONT_DESK_MONITOR_HEIGHT,
  FRONT_DESK_MONITOR_WIDTH,
} from '../src/render3d/clubhouse/frontDeskMonitorUi.js';

function makeCanvas() {
  const calls = [];
  const context = {
    calls,
    save() {}, restore() {}, clearRect() {}, fillRect() {}, beginPath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {},
    stroke() {}, arc() {},
    fillText(value, x, y) { calls.push({ value, x, y }); },
    measureText(value) { return { width: String(value).length * 9 }; },
  };
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
