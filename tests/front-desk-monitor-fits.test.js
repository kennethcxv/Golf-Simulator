// F1/C7 — NOTHING THE FRONT-DESK SCREEN SAYS MAY BE CUT OFF.
//
// Two complaints in the same brief were the same defect seen on two screens:
// tee times reading "x am ..." and the overpay caption reading "Customer rec...".
// Both are frontDeskMonitorUi's fitText doing its job on copy that was written
// without anyone checking it fits. Finding the rest by opening every screen in
// every state is not a plan, so the screen records every string it truncates and
// this test drives it through the states and reads the record.
//
// This is a canvas UI with no canvas in Node, so the test supplies a measuring
// context. THE MEASUREMENT MUST BE HONEST OR THE TEST IS THEATRE: a stub that
// returns width 0 would pass everything forever. So the stub models a real
// proportional face — per-character advance scaled by the font size parsed out
// of ctx.font — and the test asserts against a control string KNOWN to overflow
// before it trusts a single pass.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFrontDeskMonitorUi,
  MONITOR_TRUNCATIONS,
  FRONT_DESK_MONITOR_WIDTH,
  FRONT_DESK_MONITOR_HEIGHT,
} from '../src/render3d/clubhouse/frontDeskMonitorUi.js';

// Arial-ish average advances as a fraction of the em, by character class. Bold
// is wider. Deliberately a little GENEROUS (real Arial digits are 0.556em) so a
// string this test passes has margin in the real face rather than sitting on the
// line.
function advanceFor(ch, bold) {
  const base = /[MW@]/.test(ch) ? 0.90
    : /[A-Z]/.test(ch) ? 0.70
      : /[mw]/.test(ch) ? 0.83
        : /[ilj.,'!|]/.test(ch) ? 0.28
          : /[0-9$]/.test(ch) ? 0.58
            : ch === ' ' ? 0.28
              : 0.55;
  return bold ? base * 1.06 : base;
}

function makeMeasuringContext() {
  const calls = [];
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
      let w = 0;
      for (const ch of String(value)) w += advanceFor(ch, bold) * size;
      return { width: w };
    },
    fillText(value, x, y) { calls.push({ value: String(value), x, y }); },
    strokeText() {},
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
  ctx.__calls = calls;
  return ctx;
}

test('the measuring stub can actually see an overflow (control)', () => {
  const ctx = makeMeasuringContext();
  ctx.font = '800 24px Arial, sans-serif';
  const short = ctx.measureText('EXACT CHANGE').width;
  const long = ctx.measureText('OVER BY $2.50 - CUSTOMER RECEIVES EXTRA CHANGE').width;
  assert.ok(short > 0, 'the stub measures something');
  assert.ok(long > short * 2, 'a longer string measures longer');
  // The exact caption C7 reported, in the box it was drawn into. If this does
  // not exceed 500 the stub is too narrow to catch anything and every pass below
  // is meaningless.
  assert.ok(long > 500, `the reported overpay caption must overflow its 500px box, measured ${Math.round(long)}`);
});

// A reservation and a sheet with the longest plausible real content: a
// double-barrelled name, a full party, and a time in the two-digit hour that
// makes the widest tee-time string.
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

const SHEET = Array.from({ length: 18 }, (_, i) => ({
  label: `${((i + 6) % 12) + 1}:${i % 2 ? '30' : '00'} ${i + 6 >= 12 ? 'PM' : 'AM'}`,
  capacity: 4,
  booked: i % 3,
  openSeats: 4 - (i % 3),
  names: i % 3 ? ['Featherstonehaugh, A.', 'Okonkwo-Baptiste, J.'].slice(0, i % 3) : [],
  now: i === 5,
  past: i < 3,
  closed: i === 17,
  asked: i === 7,
  actionId: i % 3 === 0 ? 'select-walkin-slot' : null,
}));

const MODELS = [
  { view: 'check-in', heading: 'Check-in', selectedReservation: RESERVATION, sheet: SHEET, clubName: 'Pine Hills Municipal Golf' },
  { view: 'check-in', heading: 'Check-in', selectedReservation: null, sheet: SHEET, clubName: 'Pine Hills Municipal Golf' },
  { view: 'tee-sheet', heading: 'Tee sheet', context: 'Saturday, Spring 3 - walk-in waiting', sheet: SHEET, clubName: 'Pine Hills Municipal Golf' },
  {
    view: 'checkout',
    heading: 'Checkout',
    selectedReservation: RESERVATION,
    changeDue: 250,
    giving: 500,
    givingDeltaCents: 250,
    givingState: 'over',
    clubName: 'Pine Hills Municipal Golf',
  },
  { view: 'checkout', givingState: 'exact', giving: 250, changeDue: 250, givingDeltaCents: 0, clubName: 'Pine Hills Municipal Golf' },
  { view: 'checkout', givingState: 'excess', giving: 1200, changeDue: 250, givingDeltaCents: 950, clubName: 'Pine Hills Municipal Golf' },
  { view: 'checkout', givingState: 'short', giving: 100, changeDue: 250, givingDeltaCents: -150, clubName: 'Pine Hills Municipal Golf' },
  { view: 'checkout', awaitingCash: true, changeDue: 250, clubName: 'Pine Hills Municipal Golf' },
  { view: 'cash', heading: 'Cash', clubName: 'Pine Hills Municipal Golf' },
];

test('no front-desk monitor screen has to truncate its own copy', () => {
  MONITOR_TRUNCATIONS.length = 0;
  const ctx = makeMeasuringContext();
  const ui = createFrontDeskMonitorUi({ getContext: () => ctx, width: 0, height: 0 });
  assert.ok(ui && typeof ui.draw === 'function', 'the monitor UI exposes draw()');
  for (const model of MODELS) ui.draw(model);

  // A player NAME is allowed to be cut - names are unbounded and the screen has
  // to cope. Everything else is copy this repository wrote and can shorten.
  const authored = MONITOR_TRUNCATIONS.filter((t) => (
    !t.text.includes('Featherstonehaugh') && !t.text.includes('Okonkwo-Baptiste')
  ));
  assert.deepEqual(
    authored.map((t) => `${t.text}  (needs ${t.neededWidth}px, has ${t.maxWidth}px)`),
    [],
    'copy the front desk cannot fit',
  );
});
