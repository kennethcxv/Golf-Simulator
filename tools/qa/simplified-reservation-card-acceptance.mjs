import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:8457/';
const DEFAULT_VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const REQUIRED_VIEWPORTS = Object.freeze(['1280x720', '1600x900', '1920x1080']);
let VIEWPORT = { ...DEFAULT_VIEWPORT };
const CUSTOMER_NAME = 'Avery Stone';
const TEE_MINUTE = 14 * 60;

function configureViewport(value) {
  const raw = String(value || '').trim().toLowerCase().replace('×', 'x');
  if (!raw) {
    VIEWPORT = { ...DEFAULT_VIEWPORT };
    return { explicit: false, tag: `${VIEWPORT.width}x${VIEWPORT.height}` };
  }
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(raw);
  if (!match) throw new Error(`Invalid reservation QA viewport "${value}". Use WIDTHxHEIGHT.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 640 || height < 360) throw new Error(`Reservation QA viewport ${raw} is too small for the production route.`);
  VIEWPORT = { width, height };
  return { explicit: true, tag: `${width}x${height}` };
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

async function boot(page) {
  await page.goto(BASE_URL);
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(1000);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null,
  { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);
}

async function setupFixture(page) {
  return page.evaluate(async ({ customerName, teeMinute }) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const reservations = await import('/src/sim/reservations.js');
    const register = await import('/src/sim/register.js');
    const time = await import('/src/sim/time.js');

    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    app.speedIdx = 0;

    const current = time.calendarOf(app.state.clock.minutes);
    app.state.clock.minutes = current.dayAbs * 1440 + teeMinute;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
    };
    app.scene3d.applyTimeWeather(teeMinute, app.state.weather);

    reservations.ensureReservations(app.state);
    app.state.reservations.booked.length = 0;
    app.state.reservations.nextId = 1;
    const made = reservations.bookSlot(app.state, current.dayAbs, teeMinute, {
      name: customerName,
      fullName: customerName,
      partySize: 1,
      paymentPreference: 'card',
    });
    if (!made.ok) throw new Error(`Could not book deterministic reservation: ${made.reason}`);

    const shop = app.state.shop;
    if (!shop.drawer) shop.drawer = register.newDrawer();
    const revenue = app.state.ledger.today.revenue;
    const before = {
      cash: app.state.cash,
      greenFees: revenue.greenFees || 0,
      shopSales: revenue.shopSales || 0,
      history: (shop.transactionHistory || []).length,
      held: structuredClone(shop.held || []),
      salesLive: structuredClone(shop.salesLive || {}),
      salesToday: structuredClone(shop.salesToday || {}),
      drawer: structuredClone(shop.drawer || null),
    };

    // Fixed production player camera at the register, via the clubhouse's LIVE
    // interior offset (a hardcoded one goes stale when the building moves and
    // drops the player onto the course, where a turf prop steals the [E] focus).
    const walk = app.scene3d.walk.state;
    const off = clubhouse.interior.position;
    walk.x = 2.80 + off.x;
    walk.z = 5.10 + off.z;
    walk.yaw = 0;
    walk.pitch = -0.18;

    return {
      reservation: structuredClone(made.res),
      before,
    };
  }, { customerName: CUSTOMER_NAME, teeMinute: TEE_MINUTE });
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
  assert(point && point.inView, `Monitor action ${action} is not visible.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(220);
  return point;
}

async function waitCamera(page, workspace) {
  await page.evaluate(() => { window.__reservationAcceptanceCameraProbe = null; });
  await page.waitForFunction((wanted) => {
    const app = window.__fw;
    const register = app.scene3d.clubhouse().register;
    if (register.workspace() !== wanted) return false;
    const camera = app.scene3d.camera;
    const now = {
      x: camera.position.x, y: camera.position.y, z: camera.position.z,
      qx: camera.quaternion.x, qy: camera.quaternion.y,
      qz: camera.quaternion.z, qw: camera.quaternion.w,
      fov: camera.fov,
    };
    const old = window.__reservationAcceptanceCameraProbe;
    if (!old) {
      window.__reservationAcceptanceCameraProbe = { ...now, stable: 0 };
      return false;
    }
    const delta = Math.max(
      Math.abs(now.x - old.x), Math.abs(now.y - old.y), Math.abs(now.z - old.z),
      Math.abs(now.qx - old.qx), Math.abs(now.qy - old.qy),
      Math.abs(now.qz - old.qz), Math.abs(now.qw - old.qw),
      Math.abs(now.fov - old.fov),
    );
    const stable = delta < 0.0008 ? old.stable + 1 : 0;
    window.__reservationAcceptanceCameraProbe = { ...now, stable };
    return stable >= 4;
  }, workspace, { timeout: 12000, polling: 80 });
}

async function escapeFrontDesk(page) {
  for (let step = 0; step < 4; step += 1) {
    const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    if (!active) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
  }
  const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
  assert(!active, 'Escape did not back out through the shared monitor and leave the front desk.');
}

async function projectLocal(page, point) {
  return page.evaluate(async (local) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const world = new THREE.Vector3(
      local.x + clubhouse.interior.position.x,
      local.y + clubhouse.interior.position.y,
      local.z + clubhouse.interior.position.z,
    );
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, point);
}

async function insertCard(page, shot, midLabel, processingLabel) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-ready';
  }, null, { timeout: 9000 });
  // handoff frame: the customer holds the card out; the workspace stays 'card'
  await waitCamera(page, 'card');
  await shot(midLabel);
  // click-to-insert: one click on the presented card runs the whole insert
  const cardPt = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint());
  assert(cardPt && cardPt.inView, 'Reservation card is outside the handoff camera.');
  await page.mouse.click(cardPt.x, cardPt.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-entry' && tx.checkoutFlow?.state === 'CardAmountEntry';
  }, null, { timeout: 5000 });
  const digits = await page.evaluate(async () => {
    const { totalOf } = await import('/src/sim/register.js');
    return String(Math.round(totalOf(window.__fw.scene3d.clubhouse().register.getTx()) * 100));
  });
  await page.keyboard.type(digits, { delay: 80 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-busy' && tx.checkoutFlow?.state === 'CardProcessing';
  }, null, { timeout: 4000 });
  await shot(processingLabel);
}

async function finalSnapshot(page, reservationId) {
  return page.evaluate((id) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const shop = app.state.shop;
    const booked = app.state.reservations?.booked || [];
    const reservation = booked.find((entry) => String(entry.id) === String(id)) || null;
    const expectedReference = `reservation:${String(id)}:check-in`;
    const matchingTickets = (shop.transactionHistory || [])
      .filter((ticket) => ticket.referenceId === expectedReference);
    return {
      registerActive: clubhouse.register.isActive(),
      tx: clubhouse.register.getTx(),
      workspace: clubhouse.register.workspace(),
      reservation: reservation ? structuredClone(reservation) : null,
      reservationCustomer: clubhouse.reservationCustomer(id),
      queue: clubhouse.checkoutQueue(),
      cash: app.state.cash,
      greenFees: app.state.ledger.today.revenue.greenFees || 0,
      shopSales: app.state.ledger.today.revenue.shopSales || 0,
      history: (shop.transactionHistory || []).length,
      matchingTickets: structuredClone(matchingTickets),
      held: structuredClone(shop.held || []),
      salesLive: structuredClone(shop.salesLive || {}),
      salesToday: structuredClone(shop.salesToday || {}),
      drawer: structuredClone(shop.drawer || null),
    };
  }, reservationId);
}

export async function runSimplifiedReservationCardAcceptance(page, options = {}) {
  const viewportRun = configureViewport(options.viewport
    || process.env.RESERVATION_QA_VIEWPORT
    || process.env.REGISTER_QA_VIEWPORT
    || process.env.QA_VIEWPORT);
  const rootBase = path.resolve(process.env.RESERVATION_QA_ROOT
    || 'qa/cash-register-production/simplified-rebuild/reservation-card');
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
  page.on('pageerror', (error) => pageErrors.push(String(error && error.stack ? error.stack : error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));

  const evidence = [];
  const shot = async (name) => {
    const output = path.join(root, name);
    await page.screenshot({ path: output });
    evidence.push(output);
  };
  let fixture = null;
  let final = null;
  let waitingAfterExit = null;

  try {
    await boot(page);
    fixture = await setupFixture(page);
    const reservationId = fixture.reservation.id;
    assert(fixture.reservation.fee > 0, 'The deterministic booking has no green fee to collect.');
    await shot('01-reservation-created.png');

    await page.waitForFunction((id) => {
      const customer = window.__fw.scene3d.clubhouse().reservationCustomer(id);
      return customer && customer.queued && customer.queueIndex === 0
        && customer.phase === 'reservation-waiting';
    }, reservationId, { timeout: 60000 });
    await shot('02-reservation-customer-waiting.png');

    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
      { timeout: 5000 });
    await waitCamera(page, 'monitor');
    await shot('03-front-desk-home.png');
    await monitorClick(page, 'tab-check-in');
    await monitorClick(page, `select-reservation:${reservationId}`);
    await shot('04-reservation-selected.png');

    // Verify the real waiting customer survives a normal front-desk exit. No
    // payment transaction or persistent revenue exists yet.
    await escapeFrontDesk(page);
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null,
      { timeout: 5000 });
    await page.waitForTimeout(900);
    waitingAfterExit = await page.evaluate((id) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const reservation = app.state.reservations.booked.find((entry) => String(entry.id) === String(id));
      return {
        customer: clubhouse.reservationCustomer(id),
        queue: clubhouse.checkoutQueue(),
        reservation: structuredClone(reservation),
        tx: clubhouse.register.getTx(),
        history: (app.state.shop.transactionHistory || []).length,
        greenFees: app.state.ledger.today.revenue.greenFees || 0,
      };
    }, reservationId);
    assert(waitingAfterExit.customer && waitingAfterExit.customer.queued,
      'Reservation customer left the queue after the safe exit.');
    assert(waitingAfterExit.customer.phase === 'reservation-waiting',
      `Unexpected customer phase after exit: ${waitingAfterExit.customer.phase}`);
    assert(waitingAfterExit.reservation.status === 'booked',
      'Safe exit changed the reservation before payment.');
    assert(!waitingAfterExit.tx, 'Safe exit created or retained an unexpected payment transaction.');
    assert(waitingAfterExit.history === fixture.before.history,
      'Safe exit wrote transaction history before payment.');
    assert(round2(waitingAfterExit.greenFees) === round2(fixture.before.greenFees),
      'Safe exit banked a green fee before payment.');
    await shot('05-safe-exit-customer-still-waiting.png');

    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
      { timeout: 5000 });
    await waitCamera(page, 'monitor');
    await monitorClick(page, 'tab-check-in');
    await monitorClick(page, `select-reservation:${reservationId}`);
    await shot('06-safe-reentry-reservation-retained.png');

    const checkInActions = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.monitorHotspots().map((hotspot) => hotspot.id)
    ));
    assert(checkInActions.includes('reservation-check-in'),
      'The current automatic-preference reservation check-in action is missing.');
    assert(!checkInActions.includes('reservation-pay-card') && !checkInActions.includes('reservation-pay-cash'),
      'The reservation monitor still asks the player to choose card or cash.');
    await monitorClick(page, 'reservation-check-in');
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.kind === 'service'
        && String(tx.servicePayment?.reservationId) === String(id)
        && tx.method === 'card';
    }, reservationId, { timeout: 7000 });
    await page.evaluate(() => {
      window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0;
    });
    await waitCamera(page, 'card');
    await shot('07-reservation-card-presented.png');

    // One clean run: the reader always approves once the total is keyed
    // (gameplay never declines).
    await insertCard(
      page,
      shot,
      '08-card-handoff.png',
      '08b-card-processing.png',
    );
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && ['receipt', 'bagging', 'done'].includes(tx.stage);
    }, null, { timeout: 9000 });
    await shot('11-card-accepted.png');

    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.stage === 'done';
    }, null, { timeout: 10000 });
    await shot('12-check-in-processing.png');

    // The check-in banks ITSELF once the receipt reaches the golfer (no manual
    // finalize button in the automatic flow). Wait for the transaction to clear.
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
      { timeout: 14000 });
    await shot('13-check-in-complete.png');
    await page.waitForTimeout(1000);
    final = await finalSnapshot(page, reservationId);

    assert(final.reservation && final.reservation.status === 'played',
      'Reservation was not marked played after finalization.');
    assert(final.reservation.paymentMethod === 'card', 'Reservation did not persist the card method.');
    assert(round2(final.reservation.paidAmount) === round2(fixture.reservation.fee),
      'Reservation provenance has the wrong paid amount.');
    assert(final.history === fixture.before.history + 1,
      'Transaction history did not advance exactly once.');
    assert(final.matchingTickets.length === 1,
      `Expected exactly one typed reservation ticket, got ${final.matchingTickets.length}.`);

    const ticket = final.matchingTickets[0];
    assert(ticket.type === 'reservation-check-in', `Unexpected ticket type: ${ticket.type}`);
    assert(ticket.revenueKey === 'greenFees', `Unexpected revenue key: ${ticket.revenueKey}`);
    assert(ticket.method === 'card', `Unexpected ticket method: ${ticket.method}`);
    assert(ticket.customer === CUSTOMER_NAME, `Unexpected ticket customer: ${ticket.customer}`);
    assert(round2(ticket.total) === round2(fixture.reservation.fee),
      `Unexpected ticket total: ${ticket.total}`);
    assert(final.reservation.checkInReferenceId === ticket.referenceId,
      'Reservation and ticket references do not match.');
    assert(final.reservation.checkInTransactionNumber === ticket.number,
      'Reservation and ticket transaction numbers do not match.');

    assert(round2(final.cash - fixture.before.cash) === round2(fixture.reservation.fee),
      `Expected cash to increase once by $${fixture.reservation.fee.toFixed(2)}.`);
    assert(round2(final.greenFees - fixture.before.greenFees) === round2(fixture.reservation.fee),
      `Expected greenFees to increase once by $${fixture.reservation.fee.toFixed(2)}.`);
    assert(round2(final.shopSales) === round2(fixture.before.shopSales),
      'Reservation payment changed shop-sales revenue.');
    assert(sameJson(final.held, fixture.before.held), 'Reservation payment changed held merchandise.');
    assert(sameJson(final.salesLive, fixture.before.salesLive),
      'Reservation payment changed live merchandise analytics.');
    assert(sameJson(final.salesToday, fixture.before.salesToday),
      'Reservation payment changed merchandise velocity.');
    assert(sameJson(final.drawer, fixture.before.drawer), 'Card check-in changed the saved cash drawer.');
    assert(!final.tx, 'Finalized reservation left a live register transaction.');
    assert(!final.queue.some((entry) => String(entry.reservationId) === String(reservationId)),
      'Finalized reservation customer remained in the checkout queue.');
    assert(!final.reservationCustomer
      || (final.reservationCustomer.released && !final.reservationCustomer.queued),
    'Finalized reservation customer was not released.');

    assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
    const nonAborted = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
    assert(nonAborted.length === 0,
      `Non-aborted request failures: ${JSON.stringify(nonAborted)}`);

    const result = {
      ok: true,
      mode: 'reservation-card',
      viewport: { ...VIEWPORT },
      requiredViewports: REQUIRED_VIEWPORTS,
      fixture,
      waitingAfterExit,
      final,
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
    const nonAborted = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
    const result = {
      ok: false,
      mode: 'reservation-card',
      viewport: { ...VIEWPORT },
      requiredViewports: REQUIRED_VIEWPORTS,
      blocker: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      fixture,
      waitingAfterExit,
      final,
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
    throw error;
  }
}
