import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'http://localhost:8457/';
const DEFAULT_OUTPUT_ROOT = 'qa/pine-hills-clubhouse/joined-tee-card';
const VIEWPORT = Object.freeze({ width: 1920, height: 1080 });
const FIXED_MINUTE = 14 * 60;
const PARTY_SIZE = 2;

function assert(value, message) {
  if (!value) throw new Error(message);
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

async function boot(page, baseUrl) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(baseUrl);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 45000 });
  await page.evaluate(async () => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    await Promise.all([
      clubhouse.pineHillsInterior?.ready,
      clubhouse.sheet07Production?.ready,
      clubhouse.modernClubhouse?.ready,
    ].filter(Boolean));
  });
  await page.waitForTimeout(1200);
  // This ordinary click enables the same browser audio and pointer path a player
  // uses before the joined route starts.
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(180);
}

async function setupFixture(page) {
  return page.evaluate(async ({ fixedMinute }) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const reservations = await import('/src/sim/reservations.js');
    const identities = await import('/src/sim/customerIdentity.js');
    const register = await import('/src/sim/register.js');
    const time = await import('/src/sim/time.js');
    const layout = await import('/src/data/shopLayout.js');
    const campaignModule = await import('/src/sim/campaign.js');

    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    app.speedIdx = 0;

    const initialCalendar = time.calendarOf(app.state.clock.minutes);
    const clockMinute = initialCalendar.dayAbs * 1440 + fixedMinute;
    app.state.clock.minutes = clockMinute;
    const campaign = campaignModule.ensureCampaign(app.state);
    if (campaign) {
      campaign.businessOpen = true;
      campaign.openedAt ??= clockMinute;
      campaign.operatingDayAbs ??= initialCalendar.dayAbs;
      clubhouse.refreshCampaign?.();
    }
    const book = reservations.resetGolfOperationsQA(app.state);
    book.lastProcessedMinute = clockMinute;

    // Give the laptop-created reservation a deterministic identity trait without
    // creating the reservation itself. The booking still happens exclusively by
    // clicking the diegetic laptop UI below. Select the first compact seed whose
    // next real reservation identity prefers card payment.
    const directory = identities.ensureCustomerDirectory(app.state);
    directory.customers.length = 0;
    directory.nextOrdinal = 0;
    let identitySeed = 1;
    while (identitySeed < 10000
      && identities.createCustomerIdentity(identitySeed, `reservation:${book.nextId}`).paymentPreference !== 'card') {
      identitySeed += 1;
    }
    if (identitySeed >= 10000) throw new Error('Could not select a deterministic card-paying customer identity.');
    directory.seed = String(identitySeed);

    app.state.weather.locked = true;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.46, windMph: 5,
    };
    app.scene3d.applyTimeWeather(fixedMinute, app.state.weather);

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

    // Observe the real Canvas2D board repaint. This is read-only QA evidence:
    // production still owns the sheet data and every draw call.
    window.__pineHillsJoinedTeePaintedText = [];
    const proto = CanvasRenderingContext2D.prototype;
    if (!proto.__pineHillsJoinedTeeOriginalFillText) {
      Object.defineProperty(proto, '__pineHillsJoinedTeeOriginalFillText', {
        value: proto.fillText,
        configurable: true,
      });
      proto.fillText = function joinedTeeObservedFillText(text, ...args) {
        window.__pineHillsJoinedTeePaintedText?.push({
          text: String(text),
          canvasWidth: this.canvas?.width || 0,
          canvasHeight: this.canvas?.height || 0,
        });
        return proto.__pineHillsJoinedTeeOriginalFillText.call(this, text, ...args);
      };
    }

    const origin = clubhouse.interior.position;
    const boardObject = clubhouse.interior.getObjectByName('PineHillsTeeTimeBoard');
    boardObject?.updateWorldMatrix(true, false);
    const boardWorld = boardObject ? {
      x: boardObject.getWorldPosition(new (await import('/vendor/three.module.js')).Vector3()).x,
      y: boardObject.getWorldPosition(new (await import('/vendor/three.module.js')).Vector3()).y,
      z: boardObject.getWorldPosition(new (await import('/vendor/three.module.js')).Vector3()).z,
    } : {
      x: origin.x + layout.FRONT_DESK.teeTimeBoard.x,
      y: origin.y + 1.61,
      z: origin.z + layout.FRONT_DESK.teeTimeBoard.z + 0.20,
    };
    const laptopWorld = {
      x: origin.x + layout.FRONT_DESK.laptop.x,
      y: origin.y + 1.14,
      z: origin.z + layout.FRONT_DESK.laptop.z,
    };
    const registerStandWorld = {
      x: origin.x + layout.REGISTER.stand.x,
      y: origin.y + 1.62,
      z: origin.z + layout.REGISTER.stand.z,
    };
    const registerMonitorWorld = {
      x: origin.x + layout.REGISTER.monitor.x,
      y: origin.y + 1.185,
      z: origin.z + layout.REGISTER.monitor.z,
    };

    return {
      dayAbs: initialCalendar.dayAbs,
      fixedMinute,
      nextReservationId: book.nextId,
      identitySeed,
      businessOpen: campaignModule.campaignAllowsBusiness(app.state),
      before,
      laptopWorld,
      boardWorld,
      registerStandWorld,
      registerMonitorWorld,
      fixtureDescription: 'fresh Pine Hills bootstrap; existing tee ledger reset; 14:00 clear weather; organic retail walk-ins disabled; card-trait customer directory seed selected before UI booking',
    };
  }, { fixedMinute: FIXED_MINUTE });
}

async function setPlayerAim(page, at, target) {
  return page.evaluate(({ at: playerAt, target: playerTarget }) => {
    const walk = window.__fw.scene3d.walk;
    const clubhouse = window.__fw.scene3d.clubhouse();
    walk.clearKeys();
    walk.setSpraying?.(false);
    walk.state.x = playerAt.x;
    walk.state.z = playerAt.z;
    const dx = playerTarget.x - playerAt.x;
    const dz = playerTarget.z - playerAt.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.state.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    // Targets are world-space; the clubhouse is vertically seated below the
    // course origin, so aim from the real world eye instead of a local 1.62.
    const eyeY = clubhouse.interior.position.y + 1.62;
    walk.state.pitch = Math.atan2(playerTarget.y - eyeY, horizontal);
    return { x: walk.state.x, z: walk.state.z };
  }, { at, target });
}

async function normalForwardStep(page, duration = 120) {
  const before = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x,
    z: window.__fw.scene3d.walk.state.z,
  }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(duration);
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x,
    z: window.__fw.scene3d.walk.state.z,
  }));
  return {
    before,
    after,
    distance: Math.hypot(after.x - before.x, after.z - before.z),
  };
}

async function waitFocus(page, pattern, timeout = 8000) {
  await page.waitForFunction((source) => {
    const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
    return new RegExp(source, 'i').test(label);
  }, pattern.source, { timeout });
  return page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || null);
}

async function waitLaptop(page) {
  await page.waitForFunction(() => window.__fw?.laptopOpen === true, null, { timeout: 5000 });
  // Production intentionally spends 1.35 s seating the player and opening the
  // lid before painting the portal. The host itself has no reliable layout box;
  // the following role/DOM locators are the readiness assertion.
  await page.waitForTimeout(1600);
}

async function closeLaptop(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw?.laptopOpen === false, null, { timeout: 5000 });
  await page.waitForTimeout(250);
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
  assert(point?.inView, `Monitor action ${action} is not visible.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(220);
  return point;
}

async function waitRegisterCamera(page, workspace) {
  await page.evaluate(() => { window.__pineHillsJoinedTeeCameraProbe = null; });
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
    const old = window.__pineHillsJoinedTeeCameraProbe;
    if (!old) {
      window.__pineHillsJoinedTeeCameraProbe = { ...now, stable: 0 };
      return false;
    }
    const delta = Math.max(
      Math.abs(now.x - old.x), Math.abs(now.y - old.y), Math.abs(now.z - old.z),
      Math.abs(now.qx - old.qx), Math.abs(now.qy - old.qy),
      Math.abs(now.qz - old.qz), Math.abs(now.qw - old.qw),
      Math.abs(now.fov - old.fov),
    );
    const stable = delta < 0.0008 ? old.stable + 1 : 0;
    window.__pineHillsJoinedTeeCameraProbe = { ...now, stable };
    return stable >= 4;
  }, workspace, { timeout: 12000, polling: 80 });
}

async function completeCardPayment(page, shot) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-ready';
  }, null, { timeout: 9000 });
  await waitRegisterCamera(page, 'card');
  await shot('10-card-presented.png');
  const terminalPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardTerminalScreenPoint()
  ));
  assert(terminalPoint?.inView, 'The physical card reader is outside the handoff camera.');
  await page.mouse.click(terminalPoint.x, terminalPoint.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.swipeAt().armed
  ), null, { timeout: 3000 });
  // The reader spends 0.30 s moving the offered card to its authored swipe
  // start. Then perform the same deliberate, valid top-to-bottom gesture a
  // player uses; production judges its start, direction, completeness and pace.
  await page.waitForTimeout(420);
  const swipe = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    const registerRoot = clubhouse.interior.getObjectByName('SimplifiedFrontDeskRegister');
    if (!registerRoot) throw new Error('The physical shared-register root is missing.');
    const local = register.swipeAt();
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const project = (position) => {
      const world = registerRoot.localToWorld(new THREE.Vector3(position.x, position.y, position.z));
      world.project(app.scene3d.camera);
      return {
        x: rect.left + ((world.x + 1) / 2) * rect.width,
        y: rect.top + ((-world.y + 1) / 2) * rect.height,
        inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
      };
    };
    registerRoot.updateMatrixWorld(true);
    return { top: project(local.top), bottom: project(local.bot) };
  });
  assert(swipe.top.inView && swipe.bottom.inView,
    `The authored card-swipe path is outside the terminal camera: ${JSON.stringify(swipe)}.`);
  await page.mouse.move(swipe.top.x, swipe.top.y);
  await page.mouse.down();
  await page.mouse.move(swipe.bottom.x, swipe.bottom.y, { steps: 12, delay: 30 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-busy' && tx.checkoutFlow?.state === 'CardProcessing';
  }, null, { timeout: 4000 });
  await shot('11-card-processing.png');
}

async function finalSnapshot(page, reservationId) {
  return page.evaluate((id) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const shop = app.state.shop;
    const reservation = app.state.reservations.booked
      .find((entry) => String(entry.id) === String(id)) || null;
    const referenceId = `reservation:${String(id)}:check-in`;
    return {
      reservation: reservation ? structuredClone(reservation) : null,
      reservationCustomer: clubhouse.reservationCustomer(id),
      registerActive: clubhouse.register.isActive(),
      tx: clubhouse.register.getTx(),
      workspace: clubhouse.register.workspace(),
      queue: clubhouse.checkoutQueue(),
      cash: app.state.cash,
      greenFees: app.state.ledger.today.revenue.greenFees || 0,
      shopSales: app.state.ledger.today.revenue.shopSales || 0,
      history: (shop.transactionHistory || []).length,
      matchingTickets: structuredClone((shop.transactionHistory || [])
        .filter((ticket) => ticket.referenceId === referenceId)),
      held: structuredClone(shop.held || []),
      salesLive: structuredClone(shop.salesLive || {}),
      salesToday: structuredClone(shop.salesToday || {}),
      drawer: structuredClone(shop.drawer || null),
    };
  }, reservationId);
}

export async function runPineHillsJoinedTeeCardAcceptance(page, options = {}) {
  const baseUrl = options.baseUrl || process.env.QA_BASE_URL || DEFAULT_BASE_URL;
  const outputRoot = path.resolve(options.outputRoot || DEFAULT_OUTPUT_ROOT);
  fs.mkdirSync(outputRoot, { recursive: true });
  const videoPath = path.join(outputRoot, 'joined-tee-card-route.webm');

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
    const output = path.join(outputRoot, name);
    await page.screenshot({ path: output });
    evidence.push(path.relative(process.cwd(), output).replaceAll('\\', '/'));
  };

  let fixture = null;
  let booking = null;
  let boardEvidence = null;
  let boardInteraction = null;
  let waitingCustomer = null;
  let final = null;
  let capture = null;
  let captureActive = false;

  const startCapture = async () => {
    fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    const started = await page.evaluate(async () => {
      const audio = window.__fw?.audio;
      if (!audio?.startCapture) throw new Error('The game audio/video capture API is unavailable.');
      audio.setMuted(false);
      audio.setVolume(0.8);
      return audio.startCapture(document.getElementById('game'), { fps: 30 });
    });
    assert(started.audioTracks > 0 && started.videoTracks > 0,
      `Capture tracks are incomplete: ${JSON.stringify(started)}.`);
    capture = { output: path.relative(process.cwd(), videoPath).replaceAll('\\', '/'), ...started };
    captureActive = true;
  };

  const stopCapture = async ({ requireAudio = true } = {}) => {
    if (!captureActive) return capture;
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    const stopPromise = page.evaluate((downloadName) => (
      window.__fw.audio.stopCapture({ downloadName })
    ), path.basename(videoPath));
    const [download, stopped] = await Promise.all([downloadPromise, stopPromise]);
    const failure = await download.failure();
    if (failure) throw new Error(`Joined-flow video download failed: ${failure}`);
    await download.saveAs(videoPath);
    const bytesOnDisk = fs.statSync(videoPath).size;
    capture = { ...capture, ...stopped, bytesOnDisk };
    captureActive = false;
    assert(bytesOnDisk > 100000, `Joined-flow video is unexpectedly small (${bytesOnDisk} bytes).`);
    if (requireAudio) {
      assert(stopped.nonSilentAudioWindows > 0 && stopped.audioPeak > 0.0001,
        'The joined-flow video has an audio track but the live game bus remained silent.');
    }
    return capture;
  };

  try {
    await boot(page, baseUrl);
    fixture = await setupFixture(page);
    await startCapture();

    // Open the physical laptop with a real W step and E interaction.
    const laptopAt = {
      x: fixture.laptopWorld.x - 0.10,
      z: fixture.laptopWorld.z + 1.25,
    };
    await setPlayerAim(page, laptopAt, fixture.laptopWorld);
    const laptopMovement = await normalForwardStep(page, 120);
    const laptopFocus = await waitFocus(page, /laptop/);
    assert(laptopMovement.distance > 0.02, 'The W key did not move the player toward the laptop.');
    await page.keyboard.press('KeyE');
    await waitLaptop(page);
    await shot('01-laptop-opened-by-normal-controls.png');

    const bookingNav = page.locator('.lt-navbtn').filter({ hasText: /Bookings|Reservations/ }).first();
    await bookingNav.click();
    await page.waitForFunction(() => /Booking\s*&\s*Check-In/i.test(
      document.querySelector('.lt-content')?.textContent || '',
    ));
    await page.getByRole('button', { name: '+ Add Walk-In', exact: true }).click();
    let addCard = page.locator('.lt-card').filter({ hasText: 'Add a walk-in' }).first();
    await addCard.locator('select').nth(1).selectOption(String(PARTY_SIZE));
    addCard = page.locator('.lt-card').filter({ hasText: 'Add a walk-in' }).first();
    const selectedSlot = await addCard.locator('select').first().inputValue();
    const selectedSlotLabel = await addCard.locator('select').first().locator('option:checked').textContent();
    await addCard.getByRole('button', { name: 'Book it', exact: true }).click();
    await page.waitForFunction((expectedId) => window.__fw.state.reservations.booked
      .some((reservation) => String(reservation.id) === String(expectedId)), fixture.nextReservationId,
    { timeout: 5000 });
    booking = await page.evaluate((id) => {
      const app = window.__fw;
      const reservation = app.state.reservations.booked
        .find((entry) => String(entry.id) === String(id));
      const identity = app.state.customerDirectory.customers
        .find((entry) => entry.customerId === reservation.customerId);
      return {
        reservation: structuredClone(reservation),
        identity: structuredClone(identity),
        uiText: document.querySelector('.lt-content')?.textContent || '',
      };
    }, fixture.nextReservationId);
    booking.selectedSlot = Number(selectedSlot);
    booking.selectedSlotLabel = selectedSlotLabel?.trim() || null;
    booking.laptopMovement = laptopMovement;
    booking.laptopFocus = laptopFocus;
    assert(booking.reservation.partySize === PARTY_SIZE,
      `Laptop booked ${booking.reservation.partySize} players instead of ${PARTY_SIZE}.`);
    assert(booking.identity?.paymentPreference === 'card',
      `Deterministic laptop customer preference is ${booking.identity?.paymentPreference || 'missing'}, not card.`);
    assert(booking.uiText.includes(booking.reservation.reservationHolder),
      'The new reservation holder is not visible in the laptop tee sheet.');
    await shot('02-laptop-booking-visible.png');

    let matchingRow = page.locator('tr').filter({ hasText: booking.reservation.reservationHolder }).first();
    await matchingRow.getByRole('button', { name: 'View', exact: true }).click();
    await page.waitForFunction((holder) => {
      const modal = document.querySelector('.lt-modalcard');
      return modal && modal.textContent.includes(holder);
    }, booking.reservation.reservationHolder);
    await shot('03-laptop-booking-detail.png');
    await page.locator('.lt-modalcard').getByRole('button', { name: 'Close', exact: true }).click();
    await closeLaptop(page);

    // Wait for the live board to consume the new day sheet, then walk toward it.
    await page.waitForFunction((holder) => (
      window.__pineHillsJoinedTeePaintedText?.some((entry) => entry.text.includes(holder))
    ), booking.reservation.reservationHolder, { timeout: 5000 });
    const boardAt = {
      x: fixture.boardWorld.x - 0.65,
      z: fixture.boardWorld.z + 1.25,
    };
    await setPlayerAim(page, boardAt, fixture.boardWorld);
    const boardMovement = await normalForwardStep(page, 120);
    const boardFocus = await waitFocus(page, /tee-time board/);
    assert(boardMovement.distance > 0.02, 'The W key did not move the player toward the tee board.');
    boardEvidence = await page.evaluate((holder) => {
      const reservation = window.__fw.state.reservations.booked
        .find((entry) => entry.reservationHolder === holder);
      const painted = (window.__pineHillsJoinedTeePaintedText || [])
        .filter((entry) => entry.canvasWidth === 1024 && entry.canvasHeight === 640);
      return {
        holder,
        reservationId: reservation?.id ?? null,
        paintedText: painted,
        holderPaintCount: painted.filter((entry) => entry.text.includes(holder)).length,
      };
    }, booking.reservation.reservationHolder);
    assert(boardEvidence.holderPaintCount > 0,
      'The persisted reservation holder was never painted into the live wall-board canvas.');
    await shot('04-wall-tee-board-holder-visible.png');

    // E on the physical board must route to Bookings. Open the same holder's
    // detail from that board-routed UI, not from a direct application call.
    await page.keyboard.press('KeyE');
    await waitLaptop(page);
    await page.waitForFunction((holder) => {
      const content = document.querySelector('.lt-content');
      return /Booking\s*&\s*Check-In/i.test(content?.textContent || '')
        && content.textContent.includes(holder);
    }, booking.reservation.reservationHolder, { timeout: 5000 });
    await shot('05-board-opened-bookings.png');
    matchingRow = page.locator('tr').filter({ hasText: booking.reservation.reservationHolder }).first();
    await matchingRow.getByRole('button', { name: 'View', exact: true }).click();
    await page.waitForFunction((holder) => (
      document.querySelector('.lt-modalcard')?.textContent.includes(holder)
    ), booking.reservation.reservationHolder);
    await shot('06-board-opened-same-reservation.png');
    boardInteraction = {
      movement: boardMovement,
      focusLabel: boardFocus,
      laptopOpened: true,
      bookingPageVisible: true,
      sameReservationDetailOpened: true,
    };
    await page.locator('.lt-modalcard').getByRole('button', { name: 'Close', exact: true }).click();
    await closeLaptop(page);

    await page.waitForFunction((id) => {
      const customer = window.__fw.scene3d.clubhouse().reservationCustomer(id);
      return customer?.queued && customer.queueIndex === 0
        && customer.phase === 'reservation-waiting';
    }, booking.reservation.id, { timeout: 60000 });
    waitingCustomer = await page.evaluate((id) => {
      const customer = window.__fw.scene3d.clubhouse().reservationCustomer(id);
      return customer ? {
        name: customer.name,
        fullName: customer.fullName,
        paymentPreference: customer.paymentPreference,
        phase: customer.phase,
        queued: customer.queued,
        queueIndex: customer.queueIndex,
      } : null;
    }, booking.reservation.id);
    assert(waitingCustomer?.paymentPreference === 'card',
      `The arriving golfer requested ${waitingCustomer?.paymentPreference || 'no payment method'}, not card.`);

    await setPlayerAim(page, fixture.registerStandWorld, fixture.registerMonitorWorld);
    await page.waitForTimeout(250);
    const registerFocus = await waitFocus(page, /front desk|tee desk|check in/);
    assert(registerFocus.includes(booking.reservation.reservationHolder),
      `Shared-desk focus does not name ${booking.reservation.reservationHolder}: ${registerFocus}`);
    await shot('07-golfer-waiting-at-shared-register.png');
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
      { timeout: 5000 });
    await waitRegisterCamera(page, 'monitor');
    await monitorClick(page, 'tab-check-in');
    await monitorClick(page, `select-reservation:${booking.reservation.id}`);
    await shot('08-shared-register-reservation-selected.png');
    const actions = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.monitorHotspots().map((entry) => entry.id)
    ));
    assert(actions.includes('reservation-check-in'),
      'The shared monitor has no reservation check-in action for the selected golfer.');
    await monitorClick(page, 'reservation-check-in');
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.kind === 'service'
        && String(tx.servicePayment?.reservationId) === String(id)
        && tx.method === 'card';
    }, booking.reservation.id, { timeout: 7000 });
    // Fix only the acceptance outcome; terminal tap and the judged card swipe
    // remain normal physical mouse interactions. The dedicated decline route
    // covers the low random branch separately.
    await page.evaluate(() => {
      window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.99;
    });
    await waitRegisterCamera(page, 'card');
    await shot('09-shared-register-card-handoff.png');
    await completeCardPayment(page, shot);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && ['receipt', 'bagging', 'done'].includes(tx.stage);
    }, null, { timeout: 9000 });
    await shot('12-card-approved.png');
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'done';
    }, null, { timeout: 10000 });
    await shot('13-check-in-completing.png');
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
      { timeout: 14000 });
    await page.waitForTimeout(700);
    await shot('14-shared-register-check-in-complete.png');

    // The completed service remains on the shared monitor so another arrival
    // can be selected. Leave it with the ordinary Escape control before taking
    // the conservation snapshot.
    for (let depth = 0; depth < 5; depth += 1) {
      const active = await page.evaluate(() => (
        window.__fw.scene3d.clubhouse().register.isActive()
      ));
      if (!active) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(220);
    }
    assert(!(await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive())),
      'Normal Escape controls did not unwind the completed shared-register monitor.');
    await shot('15-normal-control-register-exit.png');

    final = await finalSnapshot(page, booking.reservation.id);
    assert(final.reservation?.status === 'played', 'Reservation was not marked played.');
    assert(final.reservation.paymentMethod === 'card', 'Reservation did not persist the card method.');
    assert(round2(final.reservation.paidAmount) === round2(booking.reservation.fee),
      'Reservation paid amount does not match its booked green fee.');
    assert(final.history === fixture.before.history + 1,
      'Shared checkout did not add exactly one transaction-history ticket.');
    assert(final.matchingTickets.length === 1,
      `Expected one typed reservation ticket; found ${final.matchingTickets.length}.`);
    const ticket = final.matchingTickets[0];
    assert(ticket.type === 'reservation-check-in' && ticket.revenueKey === 'greenFees'
      && ticket.method === 'card', `Reservation ticket provenance is wrong: ${JSON.stringify(ticket)}.`);
    assert(ticket.customer === booking.reservation.reservationHolder,
      `Ticket customer ${ticket.customer} does not match ${booking.reservation.reservationHolder}.`);
    assert(round2(final.cash - fixture.before.cash) === round2(booking.reservation.fee),
      'Cash did not advance exactly once by the booked fee.');
    assert(round2(final.greenFees - fixture.before.greenFees) === round2(booking.reservation.fee),
      'Green-fee revenue did not advance exactly once by the booked fee.');
    assert(round2(final.shopSales) === round2(fixture.before.shopSales),
      'The tee check-in incorrectly changed retail shop-sales revenue.');
    assert(sameJson(final.held, fixture.before.held), 'Tee check-in changed held merchandise.');
    assert(sameJson(final.salesLive, fixture.before.salesLive), 'Tee check-in changed retail analytics.');
    assert(sameJson(final.salesToday, fixture.before.salesToday), 'Tee check-in changed retail velocity.');
    assert(sameJson(final.drawer, fixture.before.drawer), 'Card check-in changed the saved cash drawer.');
    assert(!final.tx && !final.registerActive, 'The shared register did not return to idle.');
    assert(!final.queue.some((entry) => String(entry.reservationId) === String(booking.reservation.id)),
      'The completed reservation remained in the shared checkout queue.');

    await stopCapture();
    const nonAborted = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
    assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
    assert(nonAborted.length === 0,
      `Non-aborted request failures: ${JSON.stringify(nonAborted)}.`);

    const result = {
      ok: true,
      mode: 'pine-hills-joined-tee-card',
      baseUrl,
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      fixture,
      booking,
      boardEvidence,
      boardInteraction,
      waitingCustomer,
      final,
      evidence,
      capture,
      console: {
        errors: consoleErrors,
        warnings: consoleWarnings,
        pageErrors,
        failedRequests,
        nonAbortedFailedRequests: nonAborted,
      },
    };
    fs.writeFileSync(path.join(outputRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    if (captureActive) {
      await stopCapture({ requireAudio: false }).catch((captureError) => {
        capture = { ...capture, stopError: String(captureError?.stack || captureError) };
        captureActive = false;
      });
    }
    const result = {
      ok: false,
      mode: 'pine-hills-joined-tee-card',
      baseUrl,
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      blocker: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      fixture,
      booking,
      boardEvidence,
      boardInteraction,
      waitingCustomer,
      final,
      evidence,
      capture,
      console: { errors: consoleErrors, warnings: consoleWarnings, pageErrors, failedRequests },
    };
    fs.writeFileSync(path.join(outputRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    throw error;
  }
}
