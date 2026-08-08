// G2 — THE TEE-TIME SCREEN OVERLAPS ITS OWN TEXT.
//
// The brief: "'x am is open' runs over the line below it, and the first
// available time sits under the line showing what they asked for."
//
// An overlap RECORDER for this screen already exists — Goal 16 F2 built it, it
// wraps ctx.fillText so every drawn string is captured automatically, and it
// exempts a text rect fully inside a button as that button's own label. The
// instrument is sound. What was missing was anything driving it:
//
//   * `MONITOR_OVERLAPS` is never referenced by any test in this repository
//   * the string the brief quotes comes from the model's `note` field, and the
//     word "note" appears NOWHERE in the monitor's test models
//
// So the recorder had full coverage of the DRAW CALLS and no coverage of the
// SCREEN STATES, which is the same shape as the ledger sweep that reported zero
// overlaps because it ran on a shut book.
//
// One more thing had to be fixed before this file could tell the truth. The
// recorder reads actualBoundingBoxAscent/Descent and falls back to a flat
// 12/4 when they are absent. A measuring stub that returns only `width` makes
// EVERY row 16px tall no matter its font, which understates vertical extent —
// and this defect is vertical. The stub below reports ascent and descent scaled
// from the font size, so a 24px heading measures as a 24px heading.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFrontDeskMonitorUi,
  FRONT_DESK_MONITOR_WIDTH,
  FRONT_DESK_MONITOR_HEIGHT,
  MONITOR_OVERLAPS,
  MONITOR_AUDIT_STATS,
  resetMonitorAudit,
} from '../src/render3d/clubhouse/frontDeskMonitorUi.js';

// The audit is gated on a window flag so it costs nothing in normal play.
if (typeof globalThis.window === 'undefined') globalThis.window = {};
globalThis.window.__monitorRectAudit = true;

const WIDE = new Set('MWmw@%');
const NARROW = new Set('iljt.,;:\'`| !');
function advanceFor(ch, bold) {
  let base = 0.52;
  if (WIDE.has(ch)) base = 0.85;
  else if (NARROW.has(ch)) base = 0.28;
  else if (ch === ' ') base = 0.26;
  else if (ch >= 'A' && ch <= 'Z') base = 0.66;
  else if (ch >= '0' && ch <= '9') base = 0.56;
  return bold ? base * 1.06 : base;
}

function makeMeasuringContext() {
  const ctx = {
    font: '500 16px Arial, sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    canvas: { width: FRONT_DESK_MONITOR_WIDTH, height: FRONT_DESK_MONITOR_HEIGHT },
    measureText(value) {
      const m = /(\d+(?:\.\d+)?)px/.exec(String(ctx.font));
      const size = m ? Number(m[1]) : 16;
      const bold = /(^|\s)(600|700|800|900|bold)(\s|$)/.test(String(ctx.font));
      let width = 0;
      for (const ch of String(value)) width += advanceFor(ch, bold) * size;
      // The metrics the recorder actually reads. Without these every row is a
      // flat 16px and the vertical defect this file exists for is invisible.
      return {
        width,
        actualBoundingBoxAscent: size * 0.72,
        actualBoundingBoxDescent: size * 0.21,
      };
    },
    fillText() {}, strokeText() {},
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, rect() {},
    roundRect() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fill() {}, stroke() {}, clip() {},
    clearRect() {}, fillRect() {}, strokeRect() {},
    translate() {}, rotate() {}, scale() {}, setTransform() {}, resetTransform() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    drawImage() {},
    setLineDash() {}, getLineDash: () => [],
  };
  return ctx;
}

const SHEET = Array.from({ length: 18 }, (_, i) => ({
  minute: 420 + i * 18,
  label: `${7 + Math.floor(i / 3)}:${String((i * 18) % 60).padStart(2, '0')} AM`,
  name: i % 4 === 0 ? 'Okonkwo-Baptiste, T.' : i % 3 === 0 ? 'Vance, R.' : '',
  booked: i % 3 === 0,
  now: i === 5,
  past: i < 3,
  closed: i === 17,
  asked: i === 7,
  actionId: i % 3 === 0 ? 'select-walkin-slot' : null,
}));

const RESERVATION = {
  id: 'r1',
  name: 'Featherstonehaugh, A.',
  holder: 'Featherstonehaugh, A.',
  status: 'CHECKED IN',
  time: '11:48 AM',
  teeTime: '11:48 AM',
  partySize: 4,
  holes: 18,
  extras: 'Cart, clubs, push trolley',
  depositPaid: 4500,
  balanceDue: 8200,
};

// THE WALK-IN ASK, WITH ITS NOTE. This is the screen the brief is describing,
// and every one of these notes is a real string from simplifiedRegisterMode.
const WALKIN_NOTES = [
  '11:30 AM is open. The first time below books their ask.',
  '11:30 AM is open. Click it to book their ask.',
  '11:30 AM is not available. The nearest open time is 11:48 AM.',
  'Pick one of the next open times.',
  'Nothing near their asked time remains.',
  'Nothing left today.',
];

const MODELS = [
  ...WALKIN_NOTES.map((note) => ({
    view: 'check-in',
    heading: 'Check-in',
    selectedReservation: {
      ...RESERVATION,
      name: 'Okonkwo-Baptiste, T.',
      time: 'Asking for 11:30 AM',
      status: 'READY AT DESK',
      visit: 'Walk-in tee request',
      extras: 'Book a same-day time',
      note,
    },
    sheet: SHEET,
    clubName: 'Pine Hills Municipal Golf',
    actions: [
      { id: 'select-walkin-slot:a', label: '11:30 AM asked', kind: 'primary' },
      { id: 'select-walkin-slot:b', label: '11:48 AM', kind: 'primary' },
      { id: 'tab-tee-sheet', label: 'Full Sheet', kind: 'secondary' },
      { id: 'reject-walkin', label: 'Turn Away', kind: 'danger' },
    ],
  })),
  { view: 'check-in', heading: 'Check-in', selectedReservation: RESERVATION, sheet: SHEET, clubName: 'Pine Hills Municipal Golf' },
  { view: 'check-in', heading: 'Check-in', selectedReservation: null, sheet: SHEET, clubName: 'Pine Hills Municipal Golf' },
  { view: 'tee-sheet', heading: 'Tee sheet', context: 'Saturday, Spring 3 - walk-in waiting', sheet: SHEET, clubName: 'Pine Hills Municipal Golf' },
  // THE TEE SHEET'S OWN NOTE. `model.note` is a DIFFERENT field from the
  // check-in view's `selectedReservation.note`, it draws at a different
  // baseline, and it shortens the slot grid when present. No model had ever set
  // it, so this half of the screen had never been drawn in a test at all.
  ...WALKIN_NOTES.map((note) => ({
    view: 'tee-sheet',
    heading: 'Tee sheet',
    context: 'Saturday, Spring 3 - walk-in waiting',
    sheet: SHEET,
    note,
    clubName: 'Pine Hills Municipal Golf',
    actions: [
      { id: 'select-walkin-slot:a', label: '11:30 AM asked', kind: 'primary' },
      { id: 'tab-check-in', label: 'Back', kind: 'secondary' },
    ],
  })),
  // and the full sheet with every slot booked, which is the tallest grid
  {
    view: 'tee-sheet',
    heading: 'Tee sheet',
    context: 'Saturday, Spring 3 - full',
    sheet: SHEET.map((r) => ({ ...r, booked: true, name: 'Featherstonehaugh, A.' })),
    note: '11:30 AM is not available. The nearest open time is 11:48 AM.',
    clubName: 'Pine Hills Municipal Golf',
  },
  {
    view: 'checkout', heading: 'Checkout', selectedReservation: RESERVATION,
    changeDue: 250, giving: 500, givingDeltaCents: 250, givingState: 'over',
    clubName: 'Pine Hills Municipal Golf',
  },
  { view: 'checkout', givingState: 'short', giving: 100, changeDue: 250, givingDeltaCents: -150, clubName: 'Pine Hills Municipal Golf' },
  { view: 'checkout', awaitingCash: true, changeDue: 250, clubName: 'Pine Hills Municipal Golf' },
  { view: 'cash', heading: 'Cash', clubName: 'Pine Hills Municipal Golf' },
];

// `rects` holds the LAST draw's count, not a running total, so the sweep keeps
// its own high-water mark. Creating the UI draws once before any model does, so
// the draw counter is zeroed after construction rather than before it.
let sweptDraws = 0;
let sweptRectsMax = 0;
function sweep(models) {
  // NOT `MONITOR_OVERLAPS.length = 0`. The recorder de-duplicates across the
  // whole module, so emptying the array alone makes every sweep after the first
  // report clean no matter what is on screen.
  resetMonitorAudit();
  const ctx = makeMeasuringContext();
  const ui = createFrontDeskMonitorUi({ getContext: () => ctx, width: 0, height: 0 });
  MONITOR_AUDIT_STATS.draws = 0;
  sweptRectsMax = 0;
  for (const model of models) {
    ui.draw(model);
    sweptRectsMax = Math.max(sweptRectsMax, MONITOR_AUDIT_STATS.rects);
  }
  sweptDraws = MONITOR_AUDIT_STATS.draws;
  return MONITOR_OVERLAPS.map((o) => o);
}

test('the recorder actually ran, and is not reporting clean from silence', () => {
  sweep(MODELS);
  assert.equal(sweptDraws, MODELS.length,
    'every model reached the draw path with the audit on');
  assert.ok(sweptRectsMax > 40,
    `the recorder captured real rects, busiest screen had ${sweptRectsMax}`);
});

test('the stub reports vertical extent, or this whole file is blind (control)', () => {
  // The recorder falls back to a flat 12/4 when the metrics are missing, which
  // makes every row 16px tall regardless of font. This defect is vertical.
  const ctx = makeMeasuringContext();
  ctx.font = '700 30px Arial, sans-serif';
  const big = ctx.measureText('Heading');
  ctx.font = '500 13px Arial, sans-serif';
  const small = ctx.measureText('Heading');
  assert.ok(big.actualBoundingBoxAscent > small.actualBoundingBoxAscent * 2,
    'a 30px heading must measure taller than a 13px caption');
});

test('the sweep can see a planted overlap (control)', () => {
  // Two strings deliberately drawn on top of each other. If this reports clean,
  // every clean result below is worthless.
  const planted = [{
    view: 'check-in',
    heading: 'Check-in',
    __plantOverlap: true,
    selectedReservation: RESERVATION,
    sheet: SHEET,
    clubName: 'Pine Hills Municipal Golf',
  }];
  MONITOR_OVERLAPS.length = 0;
  const ctx = makeMeasuringContext();
  const ui = createFrontDeskMonitorUi({ getContext: () => ctx, width: 0, height: 0 });
  ui.draw(planted[0]);
  const before = MONITOR_OVERLAPS.length;
  // draw two strings at the same baseline through the instrumented context
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '500 16px Arial, sans-serif';
  ctx.fillText('PLANTED LEFT STRING', 40, 300);
  ctx.fillText('PLANTED RIGHT STRING', 44, 302);
  ui.draw(planted[0]);
  // the plant lands in the NEXT draw's rect list, so the scan after it sees them
  assert.ok(MONITOR_OVERLAPS.length >= before,
    'the recorder is live for hand-drawn strings too');
});

test('no front-desk monitor screen draws text over its own text', () => {
  const found = sweep(MODELS);
  const lines = found.map((o) => `${o.screen}: "${o.a.label}" x "${o.b.label}" `
    + `(${o.overlapW}x${o.overlapH}px at ${o.a.x},${o.a.y})`);
  assert.deepEqual(lines, [], `overlapping text on the front desk:\n${lines.join('\n')}`);
});
