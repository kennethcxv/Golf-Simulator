// Customer rental-cart acceptance: normal laptop controls for booking and fleet
// management, then the persisted world lifecycle from bay to course and return.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const base = process.env.QA_BASE_URL || 'http://localhost:18679/';
  const out = path.resolve(repo, process.env.CUSTOMER_CART_QA_OUT
    || 'qa/property-expansion-world-overhaul/customer-carts/iteration-1');
  fs.mkdirSync(out, { recursive: true });
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => diagnostics.push(
    `requestfailed:${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  ));

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const E = await import('/src/sim/empire.js');
    const empire = E.deserializeEmpire(JSON.parse(localStorage.getItem('golfempire:autosave')));
    const state = E.activeState(empire);
    state.tutorial.complete = true;
    state.tutorial.hidden = true;
    state.tractor = { steps: { cleared: true, fuel: true, belt: true }, repaired: true };
    state.weather.locked = true;
    state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.42, windMph: 4 };
    state.club.lastRounds = 12;
    const day = Math.floor(state.clock.minutes / 1440);
    state.clock.minutes = day * 1440 + 9 * 60;
    empire.clockMinutes = state.clock.minutes;
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.state, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return window.__fw?.prewarming !== true
      && (!veil || getComputedStyle(veil).display === 'none' || Number(getComputedStyle(veil).opacity) < 0.02);
  }, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const app = window.__fw;
    const barrier = app.scene3d.assetBarrier?.(120000);
    if (barrier?.promise) await barrier.promise;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    app.scene3d.clubhouse?.()?.setOrganicWalkins?.(false);
  });
  diagnostics.length = 0; // discard requests intentionally cancelled by the fixture reload
  await page.waitForFunction(() => window.__fw.scene3d.customerCartCount?.() === 4
    && window.__fw.scene3d.customerFleetStationReady?.()
    && window.__fw.scene3d.customerFleetStationCollisionReady?.(), null, { timeout: 30000 });

  const face = async (target, { distance = 11, side = 8, pitch = -0.12 } = {}) => {
    await page.evaluate(({ target: point, distance: away, side: across, pitch: tilt }) => {
      const walk = window.__fw.scene3d.walk.state;
      walk.x = point.x + across;
      walk.z = point.z + away;
      walk.yaw = Math.atan2(-(point.x - walk.x), -(point.z - walk.z));
      walk.pitch = tilt;
    }, { target, distance, side, pitch });
    await page.waitForTimeout(900);
  };
  const resumeLook = async () => {
    await page.mouse.click(800, 450);
    await page.waitForFunction(() => document.pointerLockElement === document.getElementById('game'), null, { timeout: 2500 })
      .catch(() => page.evaluate(() => {
        const hint = document.querySelector('.shop-lockhint');
        if (hint) hint.style.display = 'none';
      }));
    await page.waitForTimeout(180);
  };

  const parked = await page.evaluate(() => window.__fw.scene3d.customerCartVisualState()[0]);
  await face(parked, { distance: 14, side: 10, pitch: -0.09 });
  await resumeLook();
  await page.screenshot({ path: path.join(out, '01-rental-fleet-bays-before-booking.png') });

  // Use the physical laptop interaction and real DOM controls for the booking.
  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 8.55;
    walk.z = origin.z + 4.5;
    walk.yaw = -Math.PI / 2;
    walk.pitch = -0.05;
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.laptop-screen')?.style.display !== 'none', null, { timeout: 15000 });
  await page.getByRole('button', { name: 'Tee Times', exact: true }).click();
  await page.getByRole('button', { name: '+ Add Walk-In', exact: true }).click();
  const addCard = page.locator('.lt-card').filter({ hasText: 'Add a walk-in' });
  const selects = addCard.locator('select');
  await selects.nth(1).selectOption('4');
  await selects.nth(2).selectOption('9');
  await selects.nth(3).selectOption('cart');
  await page.screenshot({ path: path.join(out, '02-cart-booking-quote.png') });
  await addCard.getByRole('button', { name: 'Book it', exact: true }).click();
  await page.waitForFunction(() => window.__fw.state.reservations.booked.some((entry) => entry.transport === 'cart'));

  await page.getByRole('button', { name: 'Upgrades', exact: true }).click();
  await page.getByRole('button', { name: 'Equipment', exact: true }).click();
  await page.screenshot({ path: path.join(out, '03-fleet-management-screen.png') });
  const ui = await page.evaluate(() => ({
    title: document.querySelector('.lt-h1')?.textContent,
    equipmentText: document.querySelector('.lt-content')?.textContent,
    contentScrollHeight: document.querySelector('.lt-content')?.scrollHeight,
    contentClientHeight: document.querySelector('.lt-content')?.clientHeight,
  }));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false);
  await resumeLook();

  const assignment = await page.evaluate(async () => {
    const R = await import('/src/sim/reservations.js');
    const state = window.__fw.state;
    const reservation = [...state.reservations.booked].reverse().find((entry) => entry.transport === 'cart');
    const result = R.checkInReservation(state, reservation.id);
    return {
      ok: result.ok,
      reservationId: reservation.id,
      tripId: reservation.cartTripId,
      carts: reservation.cartService?.cartIds,
      phase: result.cart?.trip?.phase,
    };
  });
  await page.waitForFunction((ids) => {
    const visual = window.__fw.scene3d.customerCartVisualState();
    return ids.every((id) => visual.some((entry) => entry.id === id && entry.golferVisible));
  }, assignment.carts, { timeout: 10000 });
  const walking = await page.evaluate((id) => window.__fw.scene3d.customerCartVisualState().find((entry) => entry.id === id), assignment.carts[0]);
  await face(walking.golferVisible ? { x: walking.golferX, z: walking.golferZ } : walking,
    { distance: 8, side: 5, pitch: -0.12 });
  await page.waitForTimeout(2400);
  await page.screenshot({ path: path.join(out, '04-golfers-walk-to-assigned-carts.png') });

  const loading = await page.evaluate(async (tripId) => {
    const F = await import('/src/sim/cartFleet.js');
    const state = window.__fw.state;
    const trip = state.cartFleet.trips.find((entry) => entry.id === tripId);
    state.clock.minutes = trip.startedAt + 3;
    F.advanceCartFleet(state, { at: state.clock.minutes });
    return { phase: trip.phase, equipmentLoaded: trip.equipmentLoaded };
  }, assignment.tripId);
  await page.waitForTimeout(1000);
  const loadingVisual = await page.evaluate((id) => window.__fw.scene3d.customerCartVisualState().find((entry) => entry.id === id), assignment.carts[0]);
  await face(loadingVisual, { distance: 8, side: 5, pitch: -0.12 });
  await page.screenshot({ path: path.join(out, '05-equipment-loading-at-cart.png') });

  const course = await page.evaluate(async (tripId) => {
    const F = await import('/src/sim/cartFleet.js');
    const state = window.__fw.state;
    const trip = state.cartFleet.trips.find((entry) => entry.id === tripId);
    state.clock.minutes = trip.startedAt + 14;
    F.advanceCartFleet(state, { at: state.clock.minutes });
    return { phase: trip.phase, cartIds: trip.cartIds, holeIndex: trip.holeIndex };
  }, assignment.tripId);
  await page.waitForTimeout(2200);
  const onCourse = await page.evaluate((id) => window.__fw.scene3d.customerCartVisualState().find((entry) => entry.id === id), assignment.carts[0]);
  const courseTarget = onCourse.golferVisible
    ? { x: (onCourse.x + onCourse.golferX) / 2, z: (onCourse.z + onCourse.golferZ) / 2 }
    : onCourse;
  await face(courseTarget, { distance: 8, side: 5, pitch: -0.1 });
  await page.screenshot({ path: path.join(out, '06-loaded-carts-park-at-hole.png') });

  const performance = await page.evaluate(async () => {
    const samples = [];
    let last = performance.now();
    for (let i = 0; i < 121; i += 1) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      if (i > 0) samples.push(now - last);
      last = now;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const averageMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    return {
      averageFps: 1000 / averageMs,
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
      renderer: { ...window.__fw.scene3d.renderer.info.render },
    };
  });

  const keyHandoff = await page.evaluate(async (tripId) => {
    const F = await import('/src/sim/cartFleet.js');
    const state = window.__fw.state;
    const trip = state.cartFleet.trips.find((entry) => entry.id === tripId);
    state.clock.minutes = trip.startedAt + 75;
    F.advanceCartFleet(state, { at: state.clock.minutes });
    return { phase: trip.phase, keyReturned: trip.keyReturned };
  }, assignment.tripId);
  await page.waitForTimeout(1200);
  const returningCart = await page.evaluate((id) => window.__fw.scene3d.customerCartVisualState().find((entry) => entry.id === id), assignment.carts[0]);
  await face(returningCart, { distance: 9, side: 6, pitch: -0.12 });
  await page.waitForTimeout(800);
  const keyVisual = await page.evaluate((id) => window.__fw.scene3d.customerCartVisualState().find((entry) => entry.id === id), assignment.carts[0]);
  await face(keyVisual.golferVisible ? { x: keyVisual.golferX, z: keyVisual.golferZ } : keyVisual,
    { distance: 7, side: 5, pitch: -0.12 });
  await page.screenshot({ path: path.join(out, '07-golfer-returning-cart-key.png') });

  const returned = await page.evaluate(async (tripId) => {
    const F = await import('/src/sim/cartFleet.js');
    const state = window.__fw.state;
    const trip = state.cartFleet.trips.find((entry) => entry.id === tripId);
    F.advanceCartFleet(state, { at: trip.startedAt + 220 });
    return {
      phase: trip.phase,
      keyReturned: trip.keyReturned,
      cartIds: trip.cartIds,
      reservation: state.reservations.booked.find((entry) => entry.id === trip.reservationId).cartService,
    };
  }, assignment.tripId);
  await page.waitForTimeout(1100);
  const back = await page.evaluate((id) => window.__fw.scene3d.customerCartVisualState().find((entry) => entry.id === id), assignment.carts[0]);
  await face(back, { distance: 13, side: 9, pitch: -0.1 });
  await page.screenshot({ path: path.join(out, '08-carts-returned-bags-unloaded.png') });

  const finalWorld = await page.evaluate(() => ({
    visual: window.__fw.scene3d.customerCartVisualState(),
    fleetCartCount: window.__fw.state.cartFleet.carts.length,
    stationReady: window.__fw.scene3d.customerFleetStationReady(),
    stationCollisionReady: window.__fw.scene3d.customerFleetStationCollisionReady(),
  }));
  const visual = finalWorld.visual;
  const assertions = {
    normalLaptopBooking: assignment.ok && assignment.carts.length === 2,
    managementScreen: ui.title === 'Upgrades' && /Customer rental carts/.test(ui.equipmentText),
    cartsRendered: visual.length === finalWorld.fleetCartCount,
    infrastructureRendered: finalWorld.stationReady,
    infrastructureCollision: finalWorld.stationCollisionReady,
    equipmentLoadingRendered: loading.phase === 'loading' && loadingVisual.bagsVisible === 2 && loadingVisual.golferVisible,
    onCoursePhaseRendered: course.phase === 'parked-at-hole' && onCourse.phase === 'parked-at-hole',
    equipmentLoaded: onCourse.bagsVisible === 2,
    keyHandoffRendered: keyHandoff.phase === 'returning-key' && keyHandoff.keyReturned === false
      && keyVisual.golferVisible && keyVisual.golferMode === 'Walk' && keyVisual.bagsVisible === 0,
    returnComplete: returned.phase === 'complete' && returned.keyReturned,
    equipmentUnloaded: back.bagsVisible === 0 && back.golferVisible === false,
    noDiagnostics: diagnostics.length === 0,
    performanceFloor: performance.averageFps >= 24 && performance.p95FrameMs <= 80,
  };
  const result = {
    ok: Object.values(assertions).every(Boolean),
    assertions,
    assignment,
    ui,
    loading,
    course,
    keyHandoff,
    returned,
    visual,
    performance,
    diagnostics,
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
