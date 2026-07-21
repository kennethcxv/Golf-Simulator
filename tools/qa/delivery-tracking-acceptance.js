async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const iteration = Math.max(1, Number.parseInt(process.env.DELIVERY_TRACKING_QA_ITERATION || '1', 10));
  const out = path.join(repo, 'qa', 'property-expansion-world-overhaul', 'delivery-tracking', `iteration-${String(iteration).padStart(2, '0')}`);
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:18679/';
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (!/ERR_ABORTED/i.test(failure)) diagnostics.push(`requestfailed: ${request.url()} (${failure})`);
  });

  const screenshots = [];
  const capture = async (file, description) => {
    const target = path.join(out, file);
    await page.screenshot({ path: target });
    screenshots.push({ file: target, description });
  };
  const waitForGame = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || parseFloat(getComputedStyle(veil).opacity) < 0.02;
    }, null, { timeout: 90000 });
    await page.waitForTimeout(650);
  };
  const seatAtLaptop = async () => {
    // Reloads and speed changes can release pointer lock. Reacquire the normal
    // world input surface before using the authored laptop interaction point.
    await page.locator('canvas').first().click({ position: { x: 800, y: 450 } });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = origin.x + 8.45;
      walk.z = origin.z + 4.5;
      walk.yaw = -Math.PI / 2;
      walk.pitch = -0.05;
      app.scene3d.walk.clearKeys?.();
    });
    await page.waitForFunction(() => /Laptop.*\[E\].*GOLF SIMULATOR/i.test(document.querySelector('.shop-prompt')?.textContent || ''), null, { timeout: 10000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('.lt-frame')?.getBoundingClientRect().width > 100, null, { timeout: 10000 });
    await page.waitForTimeout(250);
  };
  const uiSnapshot = () => page.evaluate(() => {
    const order = window.__fw.state.shop.orders[0];
    const card = document.querySelector('.lt-delivery-order');
    const frame = document.querySelector('.lt-frame');
    return {
      name: card?.querySelector('.lt-ordername')?.textContent?.trim() || null,
      eta: card?.querySelector('.lt-delivery-eta')?.textContent?.trim() || null,
      window: card?.querySelector('.lt-delivery-window')?.textContent?.trim() || null,
      stages: [...(card?.querySelectorAll('.lt-delivery-steps span') || [])].map((node) => ({ label: node.textContent.trim(), state: node.className })),
      progress: Number(card?.querySelector('.lt-delivery-track')?.getAttribute('aria-valuenow')),
      status: card?.querySelector('.lt-chip')?.textContent?.trim() || null,
      actions: [...(card?.querySelectorAll('.lt-orderactions button') || [])].map((node) => node.textContent.trim()),
      order: order ? structuredClone(order) : null,
      frameOverflowX: frame ? frame.scrollWidth - frame.clientWidth : null,
    };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.cash = 5000;
    app.empire.cash = 5000;
    app.state.shop.unlockedTier = 3;
    app.state.shop.progression.tier = 'luxury';
    const dayStart = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = dayStart + 9 * 60;
    app.empire.clockMinutes = app.state.clock.minutes;
    window.__deliveryTrackingQaTrace = [];
    const trace = (event) => {
      const button = event.target?.closest?.('button');
      window.__deliveryTrackingQaTrace.push({
        type: event.type,
        key: event.key || null,
        trusted: event.isTrusted,
        target: button?.textContent?.trim().replace(/\s+/g, ' ') || null,
      });
    };
    window.addEventListener('keydown', trace, true);
    window.addEventListener('pointerdown', trace, true);
  });

  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 800, y: 450 } });
  await seatAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: /^Shop$/ }).click();
  await page.locator('.lt-tabs-big .lt-tab').filter({ hasText: /^Order$/ }).click();
  const product = page.locator('.lt-product').filter({ has: page.locator('.lt-prodname').filter({ hasText: /^Club polo$/ }) });
  await product.locator('.lt-qbtn').filter({ hasText: /^\+$/ }).click();
  await page.locator('.lt-ordersummary .lt-primary').filter({ hasText: /^Place Order$/ }).click();
  await page.locator('.lt-confirm .lt-primary').filter({ hasText: /^Place the order$/ }).click();
  await page.waitForFunction(() => document.querySelector('.lt-tabs-big .lt-tab.on')?.textContent?.trim() === 'Deliveries');
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => {
    const state = window.__fw.state;
    const order = state.shop.orders[0];
    return {
      cash: state.cash,
      expense: state.ledger.today.expense.shopOrders,
      txCount: state.ledger.txLog.length,
      order: structuredClone(order),
      notifications: structuredClone(state.notifications.items),
    };
  });
  const beforeUi = await uiSnapshot();
  await capture('01-standard-tracking.png', 'Standard supplier order with exact appointment, ETA, progress, and four milestones.');

  await page.locator('.lt-priority').click();
  await page.waitForSelector('.lt-confirm');
  const confirmation = await page.evaluate(() => ({
    text: document.querySelector('.lt-confirm')?.textContent?.trim().replace(/\s+/g, ' ') || null,
    facts: [...document.querySelectorAll('.lt-confirmfact')].map((fact) => ({
      label: fact.querySelector('span')?.textContent?.trim() || null,
      value: fact.querySelector('strong')?.textContent?.trim() || null,
    })),
    cash: window.__fw.state.cash,
    expense: window.__fw.state.ledger.today.expense.shopOrders,
    order: structuredClone(window.__fw.state.shop.orders[0]),
  }));
  await capture('02-priority-confirmation.png', 'Inline priority confirmation before any fee or schedule mutation.');
  await page.locator('.lt-confirm .lt-primary').filter({ hasText: /^Book priority$/ }).click();
  await page.waitForFunction(() => window.__fw.state.shop.orders[0]?.priority === true);
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const state = window.__fw.state;
    const order = state.shop.orders[0];
    return {
      cash: state.cash,
      expense: state.ledger.today.expense.shopOrders,
      txCount: state.ledger.txLog.length,
      order: structuredClone(order),
      notifications: structuredClone(state.notifications.items),
    };
  });
  const afterUi = await uiSnapshot();
  await capture('03-priority-booked.png', 'Priority order with earlier persisted appointment, updated exact ETA, and priority identity.');
  const inputTrace = await page.evaluate(() => structuredClone(window.__deliveryTrackingQaTrace || []));

  const saved = await page.evaluate(async () => {
    await window.__fw.autosave();
    const raw = localStorage.getItem('golfempire:autosave');
    return { bytes: raw?.length || 0, containsPriority: /"priority":true/.test(raw || '') };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();
  const reloaded = await page.evaluate((orderId) => {
    const state = window.__fw.state;
    const order = state.shop.orders.find((candidate) => candidate.id === orderId);
    return {
      cash: state.cash,
      expense: state.ledger.today.expense.shopOrders,
      clockMinutes: state.clock.minutes,
      order: order ? structuredClone(order) : null,
      priorityNotifications: state.notifications.items.filter((item) => item.dedupeKey === `priority:${orderId}`).length,
    };
  }, after.order.id);
  await seatAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: /^Shop$/ }).click();
  await page.locator('.lt-tabs-big .lt-tab').filter({ hasText: /^Deliveries$/ }).click();
  await page.waitForTimeout(400);
  const reloadUi = await uiSnapshot();
  await capture('04-priority-after-reload.png', 'The same priority appointment and tracker restored through the game autosave and normal Continue.');

  await page.evaluate(() => {
    window.__deliveryProgressTrace = [];
    const trace = (event) => window.__deliveryProgressTrace.push({
      type: event.type,
      key: event.key || null,
      trusted: event.isTrusted,
    });
    window.addEventListener('keydown', trace, true);
    window.addEventListener('pointerdown', trace, true);
  });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false);
  await canvas.click({ position: { x: 800, y: 450 } });
  await page.keyboard.press('3');
  await page.waitForFunction((deliveryMin) => window.__fw.state.clock.minutes >= deliveryMin - 119, after.order.deliveryMin, { timeout: 30000, polling: 100 });
  await page.keyboard.press('Space');
  await seatAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: /^Shop$/ }).click();
  await page.locator('.lt-tabs-big .lt-tab').filter({ hasText: /^Deliveries$/ }).click();
  await page.waitForTimeout(400);
  const progressUi = await uiSnapshot();
  const progressAuthority = await page.evaluate((orderId) => ({
    clockMinutes: window.__fw.state.clock.minutes,
    soonNotifications: window.__fw.state.notifications.items
      .filter((item) => item.dedupeKey === `delivery-soon:${orderId}`).length,
    trace: structuredClone(window.__deliveryProgressTrace || []),
  }), after.order.id);
  await capture('05-live-on-road-progress.png', 'Normal 16× time advances the persisted order from Ordered to its On road stage.');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false);
  await canvas.click({ position: { x: 800, y: 450 } });
  await page.evaluate((deliveryMin) => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.clock.minutes = deliveryMin - 60.75;
    app.empire.clockMinutes = app.state.clock.minutes;
  }, after.order.deliveryMin);
  await page.keyboard.press('3');
  await page.waitForFunction((deliveryMin) => window.__fw.state.clock.minutes >= deliveryMin - 59.5, after.order.deliveryMin, { timeout: 8000, polling: 50 });
  await page.keyboard.press('Space');
  const reminderAuthority = await page.evaluate((orderId) => ({
    clockMinutes: window.__fw.state.clock.minutes,
    soonNotifications: window.__fw.state.notifications.items
      .filter((item) => item.dedupeKey === `delivery-soon:${orderId}`).length,
    trace: structuredClone(window.__deliveryProgressTrace || []),
    deliveryToast: [...document.querySelectorAll('.toast.delivery')].map((toast) => toast.textContent.trim()),
  }), after.order.id);
  await seatAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: /^Shop$/ }).click();
  await page.locator('.lt-tabs-big .lt-tab').filter({ hasText: /^Deliveries$/ }).click();
  await page.waitForTimeout(300);
  const reminderUi = await uiSnapshot();
  await capture('06-near-arrival-reminder.png', 'The persisted tracker reaches its true one-hour boundary once, with the live ETA under an hour.');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false);
  await canvas.click({ position: { x: 800, y: 450 } });
  await page.evaluate((deliveryMin) => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.clock.minutes = deliveryMin - 30.75;
    app.empire.clockMinutes = app.state.clock.minutes;
  }, after.order.deliveryMin);
  await page.keyboard.press('3');
  await page.waitForFunction((deliveryMin) => window.__fw.state.clock.minutes >= deliveryMin - 29.5, after.order.deliveryMin, { timeout: 8000, polling: 50 });
  await page.keyboard.press('Space');
  await seatAtLaptop();
  await page.locator('.lt-navbtn').filter({ hasText: /^Shop$/ }).click();
  await page.locator('.lt-tabs-big .lt-tab').filter({ hasText: /^Deliveries$/ }).click();
  await page.waitForTimeout(300);
  const arrivingUi = await uiSnapshot();
  await capture('07-arriving-action-lock.png', 'At the true thirty-minute arriving edge, the structural refresh removes late cancellation and activates Arriving.');

  const fee = after.order.priorityFee;
  const round = (number) => Math.round(number * 100) / 100;
  const assertions = {
    standardTrackerVisible: /Estimated arrival \d{1,2}:\d{2} [AP]M/.test(beforeUi.eta || '')
      && beforeUi.stages.length === 4
      && beforeUi.actions.some((action) => /^Priority \$/.test(action)),
    priorityConfirmationIsSideEffectFree: confirmation.cash === before.cash
      && confirmation.expense === before.expense
      && JSON.stringify(confirmation.order) === JSON.stringify(before.order),
    confirmationExplainsTimeAndFee: /Move this delivery forward by/i.test(confirmation.text || '')
      && JSON.stringify(confirmation.facts.map((fact) => fact.label))
        === JSON.stringify(['Current ETA', 'Priority ETA', 'Dispatch fee', 'Cash after'])
      && confirmation.facts.every((fact) => !!fact.value),
    priorityBilledExactlyOnce: round(before.cash - after.cash) === fee
      && round(after.expense - before.expense) === fee
      && after.txCount === before.txCount + 1,
    authoritativeAppointmentMovedEarlier: after.order.deliveryMin < before.order.deliveryMin
      && after.order.window.open < before.order.window.open
      && after.order.arrivesDay <= before.order.arrivesDay,
    orderTotalAndFreightIncludePriority: round(after.order.cost - before.order.cost) === fee
      && round(after.order.fee - before.order.fee) === fee,
    priorityIdentityAndNotificationVisible: after.order.priority === true
      && afterUi.order.priority === true
      && /PRIORITY/.test(afterUi.name || '')
      && after.notifications.filter((item) => item.dedupeKey === `priority:${after.order.id}`).length === 1,
    trackerUpdatedWithoutOverflow: afterUi.eta !== beforeUi.eta
      && afterUi.frameOverflowX <= 1
      && afterUi.actions.every((action) => !/^Priority \$/.test(action)),
    autosaveContainsPriorityAuthority: saved.bytes > 1000 && saved.containsPriority,
    prioritySurvivesNormalReload: reloaded.order?.priority === true
      && reloaded.order.deliveryMin === after.order.deliveryMin
      && reloaded.cash === after.cash
      && reloaded.expense === after.expense
      && reloaded.priorityNotifications === 1,
    reloadedUiMatchesAppointment: reloadUi.order?.deliveryMin === after.order.deliveryMin
      && reloadUi.eta?.split('·')[0].trim() === afterUi.eta?.split('·')[0].trim()
      && JSON.stringify(reloadUi.stages.map((stage) => stage.label))
        === JSON.stringify(afterUi.stages.map((stage) => stage.label)),
    normalTimeAdvancesTrackerAndReminder: progressUi.progress > afterUi.progress
      && progressUi.status === 'Out for delivery'
      && progressUi.stages.find((stage) => stage.label === 'On road')?.state === 'active'
      && progressAuthority.soonNotifications === 0
      && reminderAuthority.soonNotifications === 1
      && reminderUi.progress > progressUi.progress
      && /\b59m remaining\b/.test(reminderUi.eta || '')
      && progressAuthority.trace.some((entry) => entry.trusted && entry.key === '3')
      && reminderAuthority.trace.filter((entry) => entry.trusted && entry.key === '3').length >= 2
      && reminderAuthority.trace.filter((entry) => entry.trusted && entry.key === ' ').length >= 2,
    arrivingBoundaryRefreshesActions: arrivingUi.status === 'Arriving soon'
      && arrivingUi.stages.find((stage) => stage.label === 'Arriving')?.state === 'active'
      && arrivingUi.actions.every((action) => action !== 'Cancel')
      && /\b29m remaining\b/.test(arrivingUi.eta || ''),
    trustedPlayerControls: inputTrace.filter((entry) => entry.type === 'keydown' && entry.trusted && entry.key?.toLowerCase() === 'e').length >= 1
      && inputTrace.filter((entry) => entry.type === 'pointerdown' && entry.trusted).length >= 7,
    noConsolePageOrRequestErrors: diagnostics.length === 0,
  };

  const result = {
    ok: Object.values(assertions).every(Boolean),
    iteration,
    assertions,
    before: { authority: before, ui: beforeUi },
    confirmation,
    after: { authority: after, ui: afterUi },
    saved,
    reloaded,
    reloadUi,
    progress: { authority: progressAuthority, ui: progressUi, reminderAuthority, reminderUi, arrivingUi },
    inputTrace,
    diagnostics,
    screenshots,
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
