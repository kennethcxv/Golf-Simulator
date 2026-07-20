async function runGolfOperationsAdapterProbe(page) {
  const baseUrl = process.env.QA_BASE_URL || process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8507/';
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const continueButton = page.getByText('Continue', { exact: true }).first();
  await continueButton.waitFor({ state: 'visible', timeout: 30_000 });
  await continueButton.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });

  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const operations = await import('/src/sim/reservations.js');
    const { calendarOf } = await import('/src/sim/time.js');
    const cal = calendarOf(app.state.clock.minutes);
    const qaDay = cal.dayAbs + 1;
    operations.resetGolfOperationsQA(app.state);
    const seeded = operations.seedGolfOperationsQA(app.state, { dayAbs: qaDay, seed: 20260719 });
    const reservation = operations.reservationById(app.state, seeded.ids.earlyPrepaid);
    app.state.clock.minutes = reservation.arrival.plannedMinute;
    operations.golfOperationsTick(app.state, app.state.clock.minutes);
    app.speedIdx = 1;
    return {
      id: reservation.id,
      plannedMinute: reservation.arrival.plannedMinute,
      clock: app.state.clock.minutes,
      scheduled: app.state.shop.customerSimulation.scheduled
        .filter((entry) => entry.reservationId === reservation.id)
        .map((entry) => ({ ...entry })),
    };
  });

  const samples = [];
  for (let index = 0; index < 30; index += 1) {
    await page.waitForTimeout(500);
    samples.push(await page.evaluate((reservationId) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const sim = app.state.shop.customerSimulation;
      const actor = clubhouse.customers().find((entry) => entry.entity?.reservationId === reservationId);
      return {
        clock: app.state.clock.minutes,
        speedIdx: app.speedIdx,
        scheduled: sim.scheduled.find((entry) => entry.reservationId === reservationId)?.status || null,
        active: sim.active.length,
        actorState: actor?.entity?.state || null,
        recentTransitions: sim.transitionEvents.filter((entry) => entry.customerId === actor?.id).slice(-6),
      };
    }, fixture.id));
    if (samples.at(-1).actorState) break;
  }

  await page.evaluate((reservationId) => {
    const actor = window.__fw.scene3d.clubhouse().customers()
      .find((entry) => entry.entity?.reservationId === reservationId);
    if (actor?.entity) actor.entity.speed = 12;
  }, fixture.id);
  const movement = [];
  for (let index = 0; index < 120; index += 1) {
    await page.waitForTimeout(250);
    const sample = await page.evaluate((reservationId) => {
      const actor = window.__fw.scene3d.clubhouse().customers()
        .find((entry) => entry.entity?.reservationId === reservationId);
      return actor ? {
        state: actor.entity.state,
        position: { x: actor.mesh.position.x, z: actor.mesh.position.z },
        target: actor.entity.target,
        pathLength: actor.entity.currentPath?.length || 0,
        blockedDuration: actor.entity.blockedDuration,
        recoveryAttempts: actor.entity.recoveryAttempts,
        transitions: actor.entity.stateHistory.slice(-6),
      } : null;
    }, fixture.id);
    movement.push(sample);
    if (sample?.state === 'Front-desk inquiry') break;
  }

  const last = samples.at(-1);
  return {
    ok: !!last?.actorState && movement.at(-1)?.state === 'Front-desk inquiry' && errors.length === 0,
    fixture,
    samples,
    movement,
    errors,
  };
}
