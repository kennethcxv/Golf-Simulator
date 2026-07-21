// Full property-expansion acceptance: physical laptop controls, live portfolio,
// manager assignment, due diligence, auction escrow, persistence, and travel.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const base = process.env.QA_BASE_URL || 'http://localhost:18679/';
  const out = path.resolve(repo, process.env.PROPERTY_OPERATIONS_QA_OUT
    || 'qa/property-expansion-world-overhaul/property-operations/iteration-1');
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
    const empire = E.newEmpire('relaxed', 4242);
    empire.cash = 1_000_000;
    E.buyProperty(empire, 'willow-creek');
    E.buyProperty(empire, 'bent-pines');
    const state = E.activeState(empire);
    state.tutorial.complete = true;
    state.tutorial.hidden = true;
    state.tractor = { steps: { cleared: true, fuel: true, belt: true }, repaired: true };
    state.weather.locked = true;
    state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.42, windMph: 4 };
    const day = Math.floor(state.clock.minutes / 1440);
    state.clock.minutes = day * 1440 + 10 * 60;
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
  diagnostics.length = 0;

  const openPhysicalLaptop = async () => {
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
    await page.waitForFunction(() => document.querySelector('.laptop-screen')?.style.display !== 'none');
  };

  await openPhysicalLaptop();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page.getByText('Portfolio value', { exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, '01-physical-laptop-portfolio.png') });

  const bentCard = page.locator('.lt-property-card').filter({ hasText: 'Bent Pines Golf Club' });
  await bentCard.getByRole('button', { name: 'Manage remotely', exact: true }).click();
  await page.getByText(/No contract restores a neglected course/).waitFor();
  await page.screenshot({ path: path.join(out, '02-manager-contracts.png') });
  await page.getByRole('button', { name: /Hire/ }).first().click();
  await page.waitForFunction(() => window.__fw.empire.holdings
    .find((holding) => holding.property.id === 'bent-pines')?.operations?.managerTier === 'manager');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '03-managed-portfolio.png') });

  await page.getByRole('button', { name: /Market \(/ }).click();
  await page.getByText('Live auctions', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(out, '04-regional-market-and-auctions.png') });

  const auctionCard = page.locator('.lt-market-card.auction').filter({ hasText: 'Quarry Bluffs' });
  await auctionCard.getByRole('button', { name: /Inspect/ }).click();
  await page.getByText('Operating profile', { exact: true }).waitFor();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '05-independent-inspection.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await auctionCard.getByRole('button', { name: /^Bid/ }).click();
  await page.waitForFunction(() => window.__fw.empire.auctions
    .find((property) => property.id === 'quarry-bluffs')?.auction?.highBidder === 'player');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '06-player-leads-auction.png') });

  const marketMetrics = await page.evaluate(() => {
    const content = document.querySelector('.lt-content');
    return {
      scrollHeight: content.scrollHeight,
      clientHeight: content.clientHeight,
      auctionCards: document.querySelectorAll('.lt-market-card.auction').length,
      listingCards: document.querySelectorAll('.lt-market-card:not(.auction)').length,
      selectedNav: [...document.querySelectorAll('.lt-navbtn.on')].map((node) => node.textContent.trim()),
    };
  });
  await page.locator('.lt-content').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '07-conventional-listings.png') });

  const performance = await page.evaluate(async () => {
    const frames = [];
    let prior = performance.now();
    await new Promise((resolve) => {
      const start = prior;
      const tick = (now) => {
        frames.push(now - prior);
        prior = now;
        if (now - start >= 3000) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const averageMs = frames.reduce((sum, value) => sum + value, 0) / frames.length;
    return {
      averageFps: 1000 / averageMs,
      p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    };
  });

  await page.waitForTimeout(600); // autosave from the manager and bid callbacks
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
  });
  const persisted = await page.evaluate(() => ({
    managerTier: window.__fw.empire.holdings.find((holding) => holding.property.id === 'bent-pines')?.operations?.managerTier,
    auctionLeader: window.__fw.empire.auctions.find((property) => property.id === 'quarry-bluffs')?.auction?.highBidder,
    inspection: Boolean(window.__fw.empire.inspections['quarry-bluffs']),
    climate: window.__fw.state.weather.climate,
  }));
  diagnostics.length = 0;

  await openPhysicalLaptop();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  const savedBentCard = page.locator('.lt-property-card').filter({ hasText: 'Bent Pines Golf Club' });
  await savedBentCard.getByRole('button', { name: 'Travel to property', exact: true }).click();
  await page.waitForFunction(() => window.__fw.state?.clubName === 'Bent Pines Golf Club', null, { timeout: 90000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.state, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    const hidden = !veil || getComputedStyle(veil).display === 'none'
      || Number.parseFloat(getComputedStyle(veil).opacity || '1') <= 0.01;
    return hidden && window.__fw?.prewarming !== true;
  }, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const barrier = window.__fw.scene3d.assetBarrier?.(120000);
    if (barrier?.promise) await barrier.promise;
  });
  await page.waitForTimeout(3000);
  await page.mouse.click(800, 450);
  await page.waitForFunction(() => document.pointerLockElement === document.getElementById('game'), null, { timeout: 2500 })
    .catch(() => page.evaluate(() => {
      const hint = document.querySelector('.shop-lockhint');
      if (hint) hint.style.display = 'none';
    }));
  await page.screenshot({ path: path.join(out, '08-travelled-to-managed-property.png') });
  const travel = await page.evaluate(() => ({
    clubName: window.__fw.state.clubName,
    propertyId: window.__fw.state.property?.id || window.__fw.state.propertyInventory?.propertyId,
    climate: window.__fw.state.weather.climate,
    region: window.__fw.state.property.region,
  }));
  await openPhysicalLaptop();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  const arrivedBentCard = page.locator('.lt-property-card').filter({ hasText: 'Bent Pines Golf Club' });
  await arrivedBentCard.getByText('You are here', { exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.lt-navbtn.on')]
    .some((node) => node.textContent.trim() === 'Properties'));
  const arrivalPortfolioActive = await arrivedBentCard.getByText('You are here', { exact: true }).isVisible();
  await page.screenshot({ path: path.join(out, '09-arrived-portfolio.png') });
  await page.keyboard.press('Escape');

  const assertions = {
    physicalLaptopPortfolio: marketMetrics.auctionCards >= 1 && marketMetrics.listingCards >= 1,
    multiLocationPortfolio: persisted.managerTier === 'manager',
    inspectionPersisted: persisted.inspection,
    auctionEscrowPersisted: persisted.auctionLeader === 'player',
    activeClimatePersisted: persisted.climate === 'temperate',
    normalTravel: travel.clubName === 'Bent Pines Golf Club' && travel.propertyId === 'bent-pines',
    regionalClimateApplied: travel.climate === 'alpine' && travel.region === 'highlands',
    arrivalPortfolioActive,
    marketScrollable: marketMetrics.scrollHeight > marketMetrics.clientHeight,
    propertiesNavSelected: marketMetrics.selectedNav.length === 1 && marketMetrics.selectedNav[0] === 'Properties',
    noDiagnostics: diagnostics.length === 0,
    performanceFloor: performance.averageFps >= 24 && performance.p95FrameMs <= 80,
  };
  const result = {
    ok: Object.values(assertions).every(Boolean),
    assertions,
    persisted,
    travel,
    marketMetrics,
    performance,
    diagnostics,
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) throw new Error(`Property operations acceptance failed: ${JSON.stringify(assertions)}`);
}
