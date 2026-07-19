import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
const DEFAULT_VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const REQUIRED_VIEWPORTS = Object.freeze(['1280x720', '1600x900', '1920x1080']);
let VIEWPORT = { ...DEFAULT_VIEWPORT };

function assert(value, message) {
  if (!value) throw new Error(message);
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function configureViewport(value) {
  const raw = String(value || '').trim().toLowerCase().replace('\u00d7', 'x');
  if (!raw) {
    VIEWPORT = { ...DEFAULT_VIEWPORT };
    return { explicit: false, tag: `${VIEWPORT.width}x${VIEWPORT.height}` };
  }
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(raw);
  if (!match) throw new Error(`Invalid lifecycle QA viewport "${value}". Use WIDTHxHEIGHT.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 640 || height < 360) {
    throw new Error(`Lifecycle QA viewport ${raw} is too small for the production route.`);
  }
  VIEWPORT = { width, height };
  return { explicit: true, tag: `${width}x${height}` };
}

async function waitForGame(page) {
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null,
  { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(900);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(120);
}

async function boot(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(BASE_URL);
  await waitForGame(page);
}

async function restoreBaseline(page, autosave) {
  await page.evaluate((raw) => {
    localStorage.setItem('golfempire:autosave', raw);
  }, autosave);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.setViewportSize(VIEWPORT);
  await waitForGame(page);
}

async function waitCamera(page, workspace, timeout = 12000) {
  await page.evaluate(() => { window.__qaLifecycleCameraProbe = null; });
  await page.waitForFunction((wanted) => {
    const app = window.__fw;
    const register = app && app.scene3d && app.scene3d.clubhouse().register;
    if (!register || register.workspace() !== wanted) return false;
    const camera = app.scene3d.camera;
    const now = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      qx: camera.quaternion.x,
      qy: camera.quaternion.y,
      qz: camera.quaternion.z,
      qw: camera.quaternion.w,
      fov: camera.fov,
    };
    const old = window.__qaLifecycleCameraProbe;
    if (!old) {
      window.__qaLifecycleCameraProbe = { ...now, stable: 0 };
      return false;
    }
    const delta = Math.max(
      Math.abs(now.x - old.x), Math.abs(now.y - old.y), Math.abs(now.z - old.z),
      Math.abs(now.qx - old.qx), Math.abs(now.qy - old.qy),
      Math.abs(now.qz - old.qz), Math.abs(now.qw - old.qw),
      Math.abs(now.fov - old.fov),
    );
    const stable = delta < 0.0008 ? old.stable + 1 : 0;
    window.__qaLifecycleCameraProbe = { ...now, stable };
    return stable >= 4;
  }, workspace, { timeout, polling: 80 });
}

async function monitorClick(page, action) {
  await page.waitForFunction((id) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.monitorScreenPoint(id);
    return register.workspace() === 'monitor' && point && point.inView;
  }, action, { timeout: 12000 });
  const point = await page.evaluate((id) => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
  ), action);
  assert(point && point.inView, `Monitor action ${action} is outside the fixed monitor camera.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(180);
  return point;
}

async function projectObject(page, predicate) {
  return page.evaluate(async (query) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((object) => {
      if (found || !object.visible || !object.userData) return;
      const data = object.userData;
      if (query.kind && data.kind !== query.kind) return;
      if (query.uid && data.uid !== query.uid) return;
      if (query.from && data.from !== query.from) return;
      if (query.denom !== undefined && Number(data.denom) !== Number(query.denom)) return;
      found = object;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.isEmpty()
      ? found.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, predicate);
}

async function pauseClock(page) {
  const speed = await page.evaluate(() => window.__fw.speedIdx);
  if (speed !== 0) await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__fw.speedIdx === 0);
}

async function enterFrontDesk(page) {
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
    { timeout: 8000 });
  await waitCamera(page, 'monitor');
}

async function leaveFrontDesk(page) {
  for (let step = 0; step < 5; step += 1) {
    const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    if (!active) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
  }
  assert(!await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive()),
    'Escape did not leave the shared front desk within five hierarchy steps.');
}

async function setupReservationArrival(page) {
  return page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const reservations = await import('/src/sim/reservations.js');
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    reservations.ensureReservations(app.state);
    app.state.reservations.booked.length = 0;
    app.state.reservations.nextId = 1;
    const dayAbs = Math.floor(app.state.clock.minutes / 1440);
    const teeMinute = 10 * 60 + 30;
    const teeTimeAbs = dayAbs * 1440 + teeMinute;
    const deskReadyAt = teeTimeAbs - 15;
    // Keep a real lounge interval while bounding the normal 16x clock crossing
    // to a few wall seconds under the current 1/30 minute-per-second base rate.
    const plannedArrival = deskReadyAt - 2;
    app.state.clock.minutes = plannedArrival - 1;
    app.speedIdx = 0;
    app.state.weather.today = {
      tempHiF: 70, tempLoF: 53, rainIn: 0, humidity: 0.44, windMph: 4,
    };
    app.scene3d.applyTimeWeather(app.state.clock.minutes % 1440, app.state.weather);
    const made = reservations.bookReservation(app.state, {
      dayAbs,
      minute: teeMinute,
      fullName: 'Morgan Ellis',
      partySize: 2,
      paymentPreference: 'card',
      totalFee: app.state.club.greenFee * 2,
      plannedArrival,
      arrivalWindow: { start: plannedArrival - 1, end: plannedArrival + 1 },
      travelVariationMin: 0,
      weatherDelayMin: 0,
      parkingDelayMin: 0,
      bankDeposit: false,
    });
    if (!made.ok) throw new Error(`Could not create arrival fixture: ${made.reason}`);
    made.res.deskReadyAt = deskReadyAt;
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 + app.scene3d.clubhouse().interior.position.x;
    walk.z = 5.10 + app.scene3d.clubhouse().interior.position.z;
    walk.yaw = 0;
    walk.pitch = -0.18;
    return {
      reservation: structuredClone(made.res),
      plannedArrival,
      deskReadyAt,
      teeTimeAbs,
    };
  });
}

async function reservationArrivalAndEscapeScenario(page, shot) {
  const fixture = await setupReservationArrival(page);
  const id = fixture.reservation.id;
  // The production 1x clock now advances at 1/30 game-minute per real second;
  // use the normal 16x key to cross this deterministic one-minute edge.
  await page.keyboard.press('3');
  await page.waitForFunction((reservationId) => {
    const reservation = window.__fw.state.reservations.booked
      .find((entry) => String(entry.id) === String(reservationId));
    return reservation && reservation.arrivalStatus === 'arrived'
      && reservation.currentDestination === 'lounge';
  }, id, { timeout: 10000 });
  await pauseClock(page);
  await page.waitForFunction((reservationId) => {
    const customer = window.__fw.scene3d.clubhouse().reservationCustomer(reservationId);
    return customer && customer.phase === 'lounge-waiting'
      && customer.currentDestination === 'lounge';
  }, id, { timeout: 60000 });
  const lounge = await page.evaluate((reservationId) => (
    window.__fw.scene3d.clubhouse().reservationCustomer(reservationId)
  ), id);
  assert(lounge.fullName === fixture.reservation.fullName, 'Lounge customer lost the booked full name.');
  assert(lounge.customerId === fixture.reservation.customerId, 'Lounge customer lost the stable customer ID.');
  assert(lounge.groupMembers.length === 2, 'Lounge customer lost party-member identity records.');
  assert(lounge.teeTime === fixture.reservation.minute, 'Lounge customer lost the tee time.');
  assert(Number.isFinite(lounge.arrivalTime), 'Lounge customer has no recorded arrival time.');

  await enterFrontDesk(page);
  await monitorClick(page, 'tab-check-in');
  await waitCamera(page, 'monitor');
  await shot('01-reservation-in-lounge.png');
  const loungeRows = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorHotspots().map((entry) => entry.id)
  ));
  assert(loungeRows.includes(`select-reservation:${id}`),
    'The in-lounge reservation is missing from the shared check-in monitor.');
  await leaveFrontDesk(page);

  await page.keyboard.press('3');
  await page.waitForFunction((readyAt) => window.__fw.state.clock.minutes >= readyAt,
    fixture.deskReadyAt, { timeout: 5000 });
  await pauseClock(page);
  await page.waitForFunction((reservationId) => {
    const customer = window.__fw.scene3d.clubhouse().reservationCustomer(reservationId);
    return customer && customer.queued && customer.queueIndex === 0
      && customer.phase === 'reservation-waiting'
      && customer.currentDestination === 'front-desk';
  }, id, { timeout: 60000 });

  await enterFrontDesk(page);
  await monitorClick(page, 'tab-check-in');
  let actions = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await monitorClick(page, `select-reservation:${id}`);
    await waitCamera(page, 'monitor');
    actions = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.monitorHotspots().map((entry) => entry.id)
    ));
    if (actions.includes('reservation-check-in')) break;
  }
  await shot('02-reservation-ready-at-desk.png');
  assert(actions.includes('reservation-check-in'), 'Ready reservation has no check-in action.');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive()),
    'First Escape left the desk instead of clearing the reservation selection.');
  actions = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorHotspots().map((entry) => entry.id)
  ));
  assert(!actions.includes('reservation-check-in') && actions.includes(`select-reservation:${id}`),
    'First Escape did not return from reservation detail to the check-in list.');
  await shot('03-escape-back-to-check-in-list.png');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  actions = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorHotspots().map((entry) => entry.id)
  ));
  assert(await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive()),
    'Second Escape left the desk instead of returning to Home.');
  assert(actions.includes('tab-check-in'), 'Second Escape did not return to the front-desk Home screen.');
  await shot('04-escape-back-to-home.png');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null,
    { timeout: 5000 });
  await page.waitForTimeout(650);
  await shot('05-escape-left-front-desk.png');
  const final = await page.evaluate((reservationId) => {
    const reservation = window.__fw.state.reservations.booked
      .find((entry) => String(entry.id) === String(reservationId));
    return {
      active: window.__fw.scene3d.clubhouse().register.isActive(),
      tx: window.__fw.scene3d.clubhouse().register.getTx(),
      reservation: structuredClone(reservation),
      customer: window.__fw.scene3d.clubhouse().reservationCustomer(reservationId),
    };
  }, id);
  assert(!final.active && !final.tx, 'Reservation ESC route left an active desk or payment transaction.');
  assert(final.reservation.status === 'booked', 'ESC changed the authoritative reservation status.');
  assert(final.customer.queued, 'ESC removed the waiting reservation customer from the desk queue.');
  return { fixture, lounge, final };
}

async function setupWalkIn(page) {
  return page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const reservations = await import('/src/sim/reservations.js');
    reservations.ensureReservations(app.state);
    app.state.reservations.booked.length = 0;
    app.state.reservations.nextId = 1;
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    const dayAbs = Math.floor(app.state.clock.minutes / 1440);
    app.state.clock.minutes = dayAbs * 1440 + 10 * 60;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(10 * 60, app.state.weather);
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 + app.scene3d.clubhouse().interior.position.x;
    walk.z = 5.10 + app.scene3d.clubhouse().interior.position.z;
    walk.yaw = 0;
    walk.pitch = -0.18;
    let customer = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidate = clubhouse.debugSpawn(false, null, { allowWalkInRequest: true });
      if (candidate && candidate.customerType === 'walk-in-tee') {
        customer = candidate;
        break;
      }
      clubhouse.clearWalkins();
    }
    if (!customer) throw new Error('Could not allocate a deterministic walk-in tee customer.');
    customer.partySize = Math.min(2, app.state.reservations.config.slotCapacity);
    customer.paymentPreference = 'cash';
    customer.payMethod = 'cash';
    customer.paymentDialogue = `${customer.fullName}: Cash is fine.`;
    if (customer.identity) customer.identity.paymentPreference = 'cash';
    const shop = app.state.shop;
    return {
      customerId: customer.customerId,
      fullName: customer.fullName,
      partySize: customer.partySize,
      before: {
        cash: app.state.cash,
        greenFees: app.state.ledger.today.revenue.greenFees || 0,
        history: (shop.transactionHistory || []).length,
      },
    };
  });
}

async function completeCashService(page, shot) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.kind === 'service' && tx.method === 'cash' && tx.stage === 'cash-tender';
  }, null, { timeout: 10000 });
  // Cash is first presented in the mixed monitor/customer frame; the
  // production camera moves to the drawer only after the handful is clicked.
  await waitCamera(page, 'monitor');
  await shot('09-walk-in-cash-presented.png');
  // one click on the presented handful accepts ALL the cash; the drawer opens
  // and the tender sorts itself into the wells (no per-piece deposit any more)
  const handful = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint());
  assert(handful && handful.inView, 'Walk-in presented cash is outside the working frame.');
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.drawerOpen,
    null, { timeout: 5000 });
  await waitCamera(page, 'cash');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.deposited,
    null, { timeout: 8000 });
  await page.waitForTimeout(600);
  await shot('10-walk-in-tender-deposited.png');
  const plan = await page.evaluate(async () => {
    const register = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return register.makeChangeFrom(
      register.drawerContents(tx, window.__fw.state.shop.drawer),
      register.changeDue(tx),
    );
  });
  assert(plan, 'The walk-in service drawer cannot make the required change.');
  for (const [rawDenom, count] of Object.entries(plan)) {
    const denom = Number(rawDenom);
    for (let index = 0; index < count; index += 1) {
      const slot = await projectObject(page, { kind: 'money', from: 'drawer', denom })
        || await projectObject(page, { kind: 'drawer-slot', denom });
      assert(slot && slot.inView, `Walk-in change slot ${denom} is outside the cash camera.`);
      await page.mouse.click(slot.x, slot.y);
      await page.waitForTimeout(140);
    }
  }
  await shot('11-walk-in-change-selected.png');
  // Enter confirms the exact change; the till closes and the service completes
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && ['receipt', 'bagging', 'done'].includes(tx.stage);
  }, null, { timeout: 10000 });
  await shot('12-walk-in-change-confirmed.png');
}

async function walkInScenario(page, shot) {
  const fixture = await setupWalkIn(page);
  await page.waitForFunction((customerId) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    return clubhouse.checkoutQueue().some((entry) => entry.customerId === customerId
      && entry.phase === 'walk-in-waiting');
  }, fixture.customerId, { timeout: 60000 });
  await shot('06-walk-in-arrived.png');
  await enterFrontDesk(page);
  await monitorClick(page, 'tab-check-in');
  let selection = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await monitorClick(page, `select-walkin:${fixture.customerId}`);
    await waitCamera(page, 'monitor');
    selection = await page.evaluate(() => {
      const ids = window.__fw.scene3d.clubhouse().register.monitorHotspots()
        .map((entry) => entry.id);
      return {
        ids,
        slotAction: ids.find((id) => id.startsWith('select-walkin-slot:')) || null,
      };
    });
    if (selection.slotAction) break;
  }
  await shot('07-walk-in-slot-selection.png');
  assert(selection.slotAction, 'The walk-in detail has no capacity-safe same-day slot action.');
  assert(selection.ids.includes('reject-walkin'), 'The walk-in detail has no explicit rejection action.');
  const slotParts = selection.slotAction.slice('select-walkin-slot:'.length).split(':');
  const minute = Number(slotParts.pop());
  const dayAbs = Number(slotParts.pop());
  const loadBefore = await page.evaluate(async ({ day, teeMinute }) => {
    const reservations = await import('/src/sim/reservations.js');
    return reservations.slotLoad(window.__fw.state, day, teeMinute);
  }, { day: dayAbs, teeMinute: minute });
  await monitorClick(page, selection.slotAction);
  const reservationId = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.servicePayment?.reservationId
  ));
  assert(reservationId != null, 'Walk-in slot selection did not start the service payment.');
  await waitCamera(page, 'monitor');
  await shot('08-walk-in-slot-booked.png');
  await completeCashService(page, shot);
  await shot('13-walk-in-service-processing.png');
  // the service banks itself once the receipt reaches the golfer — no manual
  // finalize button in the automatic flow. Wait for the transaction to clear.
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
    { timeout: 14000 });
  await shot('14-walk-in-check-in-complete.png');
  const final = await page.evaluate(async ({ id, day, teeMinute }) => {
    const reservations = await import('/src/sim/reservations.js');
    const app = window.__fw;
    const reservation = app.state.reservations.booked
      .find((entry) => String(entry.id) === String(id));
    const referenceId = `reservation:${String(id)}:check-in`;
    return {
      reservation: structuredClone(reservation),
      customer: app.scene3d.clubhouse().reservationCustomer(id),
      slot: reservations.slotLoad(app.state, day, teeMinute),
      cash: app.state.cash,
      greenFees: app.state.ledger.today.revenue.greenFees || 0,
      history: (app.state.shop.transactionHistory || []).length,
      tickets: (app.state.shop.transactionHistory || [])
        .filter((ticket) => ticket.referenceId === referenceId),
    };
  }, { id: reservationId, day: dayAbs, teeMinute: minute });
  assert(final.reservation.status === 'played', 'Walk-in reservation was not checked in.');
  assert(final.reservation.customerType === 'walk-in', 'Walk-in booking lost its customer type.');
  assert(final.reservation.fullName === fixture.fullName, 'Walk-in booking lost the full customer name.');
  assert(final.reservation.paymentMethod === 'cash', 'Walk-in booking did not persist cash payment.');
  assert(final.tickets.length === 1, `Expected one walk-in check-in ticket, got ${final.tickets.length}.`);
  assert(final.history === fixture.before.history + 1, 'Walk-in check-in did not write exactly one ticket.');
  assert(final.slot.bookedPlayers === loadBefore.bookedPlayers + fixture.partySize,
    'Walk-in booking did not consume exactly its party size from slot capacity.');
  assert(final.slot.bookedPlayers <= final.slot.capacity, 'Walk-in booking exceeded slot capacity.');
  assert(round2(final.greenFees - fixture.before.greenFees) === round2(final.reservation.fee),
    'Walk-in green-fee revenue did not increase exactly once.');
  assert(round2(final.cash - fixture.before.cash) === round2(final.reservation.fee),
    'Walk-in cash did not increase exactly once.');
  assert(final.customer && final.customer.released && !final.customer.queued,
    'Walk-in customer was not released after check-in.');
  await leaveFrontDesk(page);
  return { fixture, selectedSlot: { dayAbs, minute, loadBefore }, reservationId, final };
}

async function setupNoShow(page) {
  return page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const reservations = await import('/src/sim/reservations.js');
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    reservations.ensureReservations(app.state);
    app.state.reservations.booked.length = 0;
    app.state.reservations.nextId = 1;
    const dayAbs = Math.floor(app.state.clock.minutes / 1440);
    const teeMinute = 10 * 60 + 30;
    app.state.clock.minutes = dayAbs * 1440 + 10 * 60;
    app.speedIdx = 0;
    const before = {
      cash: app.state.cash,
      greenFees: app.state.ledger.today.revenue.greenFees || 0,
      history: (app.state.shop.transactionHistory || []).length,
    };
    const made = reservations.bookReservation(app.state, {
      dayAbs,
      minute: teeMinute,
      fullName: 'Jordan Whitaker',
      partySize: 2,
      paymentPreference: 'card',
      totalFee: 80,
      deposit: 5,
      noShowFee: 20,
      willNoShow: true,
      plannedArrival: dayAbs * 1440 + teeMinute - 15,
      arrivalWindow: {
        start: dayAbs * 1440 + teeMinute - 17,
        end: dayAbs * 1440 + teeMinute - 13,
      },
    });
    if (!made.ok) throw new Error(`Could not create no-show fixture: ${made.reason}`);
    const afterBooking = {
      cash: app.state.cash,
      greenFees: app.state.ledger.today.revenue.greenFees || 0,
      history: (app.state.shop.transactionHistory || []).length,
    };
    const deadline = made.res.teeTimeAbs + app.state.reservations.config.noShowGraceMin;
    app.state.clock.minutes = deadline - 1;
    app.scene3d.applyTimeWeather(app.state.clock.minutes % 1440, app.state.weather);
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 + app.scene3d.clubhouse().interior.position.x;
    walk.z = 5.10 + app.scene3d.clubhouse().interior.position.z;
    walk.yaw = 0;
    walk.pitch = -0.18;
    return { reservation: structuredClone(made.res), before, afterBooking, deadline };
  });
}

async function moveToLaptop(page) {
  await page.evaluate(() => {
    const app = window.__fw;
    const offset = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = 8.45 + offset.x;
    walk.z = 4.5 + offset.z;
    walk.yaw = -Math.PI / 2;
    walk.pitch = -0.05;
  });
  await page.waitForTimeout(650);
}

async function openLaptopReservations(page) {
  await moveToLaptop(page);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const frame = document.querySelector('.lt-frame');
    if (!frame) return false;
    const rect = frame.getBoundingClientRect();
    const old = window.__qaLifecycleLaptopRect;
    window.__qaLifecycleLaptopRect = { x: rect.left, y: rect.top, width: rect.width };
    return old && rect.width > 100
      && Math.abs(rect.left - old.x) < 0.08
      && Math.abs(rect.top - old.y) < 0.08
      && Math.abs(rect.width - old.width) < 0.08;
  }, null, { timeout: 15000, polling: 100 });
  const point = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.lt-navbtn')]
      .find((entry) => entry.textContent.trim().includes('Bookings'));
    if (!button) return null;
    button.scrollIntoView({ block: 'nearest' });
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  assert(point, 'Bookings navigation is missing from the physical laptop.');
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => (
    document.querySelector('.lt-navbtn.on')?.textContent.trim() === 'Bookings'
  ), null, { timeout: 5000 });
  await page.waitForTimeout(300);
}

async function openPauseMenu(page) {
  if (await page.evaluate(() => !!document.pointerLockElement)) {
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 3000 });
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await page.locator('.pause-veil-ui').count()) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
  }
  await page.waitForSelector('.pause-veil-ui', { timeout: 5000 });
}

async function saveSlotOne(page) {
  await openPauseMenu(page);
  await page.getByRole('button', { name: 'Save game', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save here', exact: true }).first();
  await save.waitFor({ state: 'visible' });
  await save.click();
  await page.waitForTimeout(700);
}

async function loadSlotOne(page) {
  await openPauseMenu(page);
  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  const load = page.getByRole('button', { name: 'Load', exact: true }).first();
  await load.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((entry) => entry.textContent.trim() === 'Load');
    return button && !button.disabled;
  }, null, { timeout: 7000 });
  await page.evaluate(() => { window.__qaLifecyclePriorScene = window.__fw.scene3d; });
  await load.click();
  await page.waitForFunction(() => window.__fw.scene3d
    && window.__fw.scene3d !== window.__qaLifecyclePriorScene
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null,
  { timeout: 40000 });
  // Loading restarts gameplay at speed 1. Pause through the normal control as
  // soon as the new scene exists so veil settling cannot cross an hourly tick.
  await pauseClock(page);
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1000);
}

async function noShowSnapshot(page, reservationId) {
  return page.evaluate((id) => {
    const app = window.__fw;
    const reservation = app.state.reservations.booked
      .find((entry) => String(entry.id) === String(id));
    const noShowReference = `reservation:${String(id)}:no-show-fee`;
    const depositReference = `reservation:${String(id)}:deposit`;
    return {
      reservation: reservation ? structuredClone(reservation) : null,
      customer: app.scene3d.clubhouse().reservationCustomer(id),
      cash: app.state.cash,
      greenFees: app.state.ledger.today.revenue.greenFees || 0,
      history: (app.state.shop.transactionHistory || []).length,
      noShowTickets: (app.state.shop.transactionHistory || [])
        .filter((ticket) => ticket.referenceId === noShowReference),
      depositTickets: (app.state.shop.transactionHistory || [])
        .filter((ticket) => ticket.referenceId === depositReference),
      customerIdentity: (app.state.customerDirectory?.customers || [])
        .find((customer) => customer.customerId === reservation?.customerId) || null,
    };
  }, reservationId);
}

function persistentNoShowView(snapshot) {
  return {
    reservation: snapshot.reservation,
    cash: snapshot.cash,
    greenFees: snapshot.greenFees,
    history: snapshot.history,
    noShowTickets: snapshot.noShowTickets,
    depositTickets: snapshot.depositTickets,
    customerIdentity: snapshot.customerIdentity,
  };
}

async function noShowAndSaveReloadScenario(page, shot) {
  const fixture = await setupNoShow(page);
  const id = fixture.reservation.id;
  await page.keyboard.press('3');
  await page.waitForFunction((reservationId) => {
    const reservation = window.__fw.state.reservations.booked
      .find((entry) => String(entry.id) === String(reservationId));
    return reservation && reservation.status === 'noShow'
      && ['charged', 'covered-by-deposit', 'waived'].includes(reservation.noShowFeeStatus);
  }, id, { timeout: 10000 });
  await pauseClock(page);
  const charged = await noShowSnapshot(page, id);
  const expectedCharge = round2(fixture.reservation.noShowFee - fixture.reservation.depositPaid);
  assert(charged.reservation.status === 'noShow', 'Missed reservation was not marked no-show.');
  assert(charged.reservation.arrivalStatus === 'no-show', 'No-show arrival state is incorrect.');
  assert(charged.reservation.currentDestination === 'departed', 'No-show did not resolve to departed.');
  assert(charged.noShowTickets.length === 1, `Expected one no-show ticket, got ${charged.noShowTickets.length}.`);
  assert(charged.depositTickets.length === 1, `Expected one deposit ticket, got ${charged.depositTickets.length}.`);
  assert(round2(charged.noShowTickets[0].total) === expectedCharge,
    'No-show ticket did not subtract the retained deposit exactly once.');
  assert(round2(charged.cash - fixture.afterBooking.cash) === expectedCharge,
    'No-show processing changed cash by the wrong amount.');
  assert(round2(charged.greenFees - fixture.afterBooking.greenFees) === expectedCharge,
    'No-show processing changed green-fee revenue by the wrong amount.');
  assert(charged.history === fixture.afterBooking.history + 1,
    'No-show processing did not append exactly one fee ticket.');
  assert(!charged.customer, 'A will-no-show reservation spawned a live clubhouse customer.');

  await openLaptopReservations(page);
  const laptopText = await page.locator('.lt-content').innerText();
  assert(laptopText.includes(fixture.reservation.fullName), 'Laptop tee sheet lost the no-show full name.');
  assert(laptopText.toLowerCase().includes('no-show'), 'Laptop tee sheet does not visibly label the no-show.');
  await shot('15-no-show-visible-on-reservations-laptop.png');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 5000 });

  await saveSlotOne(page);
  await shot('16-no-show-save-slot-written.png');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await loadSlotOne(page);
  await pauseClock(page);
  const firstLoad = await noShowSnapshot(page, id);
  assert(JSON.stringify(persistentNoShowView(firstLoad))
    === JSON.stringify(persistentNoShowView(charged)),
  'First normal UI load changed no-show provenance, identity, money, or ticket history.');
  await shot('17-no-show-first-load.png');

  await loadSlotOne(page);
  await pauseClock(page);
  const secondLoad = await noShowSnapshot(page, id);
  assert(JSON.stringify(persistentNoShowView(secondLoad))
    === JSON.stringify(persistentNoShowView(firstLoad)),
  'Loading the same lifecycle save twice duplicated or changed no-show state.');
  await shot('18-no-show-second-load-idempotent.png');
  return { fixture, charged, firstLoad, secondLoad };
}

export async function runSimplifiedFrontDeskLifecycleAcceptance(page, options = {}) {
  const viewportRun = configureViewport(options.viewport
    || process.env.LIFECYCLE_QA_VIEWPORT
    || process.env.RESERVATION_QA_VIEWPORT
    || process.env.REGISTER_QA_VIEWPORT
    || process.env.QA_VIEWPORT);
  const rootBase = path.resolve(process.env.LIFECYCLE_QA_ROOT
    || 'qa/cash-register-production/simplified-rebuild/lifecycle');
  const root = viewportRun.explicit ? path.join(rootBase, viewportRun.tag) : rootBase;
  fs.mkdirSync(root, { recursive: true });

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));

  const evidence = [];
  const shot = async (name) => {
    const output = path.join(root, name);
    await page.screenshot({ path: output });
    evidence.push(output);
    return output;
  };
  const scenarios = {};
  let currentScenario = 'boot';
  let baselineAutosave = null;
  try {
    await boot(page);
    baselineAutosave = await page.evaluate(() => localStorage.getItem('golfempire:autosave'));
    assert(baselineAutosave, 'Lifecycle acceptance requires the runner --bootstrap fixture.');

    currentScenario = 'reservation arrival, lounge, and Escape hierarchy';
    scenarios.reservationArrivalAndEscape = await reservationArrivalAndEscapeScenario(page, shot);

    currentScenario = 'walk-in capacity-safe booking and cash check-in';
    await restoreBaseline(page, baselineAutosave);
    scenarios.walkIn = await walkInScenario(page, shot);

    currentScenario = 'no-show, visible laptop status, save, and reload';
    await restoreBaseline(page, baselineAutosave);
    scenarios.noShowSaveReload = await noShowAndSaveReloadScenario(page, shot);

    const nonAborted = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
    assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
    assert(nonAborted.length === 0, `Non-aborted request failures: ${JSON.stringify(nonAborted)}`);
    const result = {
      ok: true,
      viewport: { ...VIEWPORT },
      requiredViewports: REQUIRED_VIEWPORTS,
      evidenceDirectory: root,
      fixtureBoundary: 'Autosave reset, deterministic reservation/customer creation, time/weather normalization, and fixed player placement only; front-desk navigation, slot selection, cash handling, time acceleration, laptop navigation, Escape, Save, and Load use Playwright keyboard/mouse controls.',
      scenarios,
      evidence,
      console: {
        errors: consoleErrors,
        warnings: consoleWarnings,
        pageErrors,
        failedRequests,
        nonAbortedFailedRequests: nonAborted,
      },
    };
    fs.writeFileSync(path.join(root, 'latest-result.json'), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const blockerFile = `99-blocker-${currentScenario.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}.png`;
    await page.screenshot({ path: path.join(root, blockerFile) }).catch(() => {});
    const nonAborted = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
    const result = {
      ok: false,
      viewport: { ...VIEWPORT },
      requiredViewports: REQUIRED_VIEWPORTS,
      evidenceDirectory: root,
      blocker: {
        scenario: currentScenario,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
        evidence: blockerFile,
      },
      scenarios,
      evidence,
      console: {
        errors: consoleErrors,
        warnings: consoleWarnings,
        pageErrors,
        failedRequests,
        nonAbortedFailedRequests: nonAborted,
      },
    };
    fs.writeFileSync(path.join(root, 'latest-result.json'), JSON.stringify(result, null, 2));
    return result;
  }
}
