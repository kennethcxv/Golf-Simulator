async (page) => {
  // Commercial pro-shop progression acceptance: one recorded player journey
  // through the physical laptop, real construction time, reload recovery, the
  // four rendered floors, and a matched full-shop performance/lifecycle probe.
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const out = process.env.QA_OUT_DIR || path.join(
    repo, 'qa', 'property-expansion-world-overhaul', 'shop-progression', 'after',
  );
  await fs.mkdir(out, { recursive: true });

  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => requestFailures.push({
    url: request.url(),
    reason: request.failure()?.errorText || 'unknown',
  }));

  const checks = {};
  const assert = (condition, name, detail = null) => {
    checks[name] = { pass: !!condition, detail };
    if (!condition) throw new Error(`${name} failed${detail == null ? '' : `: ${JSON.stringify(detail)}`}`);
  };

  async function waitForGame() {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      return (!clubhouse.assetsReady || clubhouse.assetsReady())
        && (!clubhouse.deliveryEquipmentReady || clubhouse.deliveryEquipmentReady());
    }, null, { timeout: 90000 });
    await page.evaluate(() => {
      const app = window.__fw;
      app.speedIdx = 0;
      app.scene3d.walk.clearKeys?.();
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.state.weather.today = {
        tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
      };
      app.state.weather.locked = true;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    });
    await page.waitForTimeout(800);
  }

  async function pose(camera, shot = null) {
    await page.evaluate((view) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = origin.x + view.x;
      walk.z = origin.z + view.z;
      const dx = origin.x + view.tx - walk.x;
      const dz = origin.z + view.tz - walk.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.pitch = view.pitch || 0;
    }, camera);
    await page.waitForTimeout(450);
    if (shot) await page.screenshot({ path: `${out}/${shot}.png` });
  }

  async function seatAtLaptop() {
    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = origin.x + 8.45;
      walk.z = origin.z + 4.5;
      walk.yaw = -Math.PI / 2;
      walk.pitch = -0.05;
    });
    await page.waitForTimeout(300);
  }

  async function openLaptopWithNormalControl() {
    await seatAtLaptop();
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
    await page.waitForFunction(() => {
      const screen = document.querySelector('.laptop-screen');
      return screen && screen.style.display !== 'none' && document.querySelector('.lt-frame');
    }, null, { timeout: 15000 });
    await page.waitForTimeout(400);
  }

  async function glassClick(selector, match, exact = false) {
    const spot = await page.evaluate(({ selector: css, match: text, exact: exactText }) => {
      const candidates = [...document.querySelectorAll(css)].filter((element) => {
        const value = element.textContent.trim();
        return exactText ? value === text : value.includes(text);
      });
      const element = candidates.find((candidate) => !candidate.disabled && candidate.getClientRects().length) || null;
      if (!element) return null;
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: element.textContent.trim() };
    }, { selector, match, exact });
    if (!spot) throw new Error(`No enabled visible ${selector} matching ${match}`);
    await page.mouse.move(spot.x, spot.y);
    await page.waitForTimeout(80);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(350);
    return spot.text;
  }

  async function openClubhouseUpgrades() {
    await glassClick('.lt-navbtn', 'Upgrades');
    await glassClick('button.lt-tab', 'Clubhouse', true);
    await page.waitForFunction(() => document.querySelectorAll('.lt-shop-tier').length === 4);
  }

  async function snapshot() {
    return page.evaluate(async () => {
      const app = window.__fw;
      const [{ placedFixtures }, { shopProgressionSummary }, { appraisalBreakdown }] = await Promise.all([
        import('/src/sim/layout.js'),
        import('/src/sim/shopProgression.js'),
        import('/src/sim/valuation.js'),
      ]);
      const summary = shopProgressionSummary(app.state);
      return {
        tier: summary.current.id,
        pending: summary.pending ? structuredClone(summary.pending) : null,
        customerCapacity: summary.customerCapacity,
        productCapacity: summary.productCapacity,
        propertyValue: summary.propertyValue,
        appraisal: appraisalBreakdown(app.state),
        cash: app.state.cash,
        supplierTier: app.state.shop.unlockedTier,
        fixtureIds: placedFixtures(app.state).map((fixture) => fixture.id),
        visuals: app.scene3d.clubhouse().shopProgressionDiagnostics(),
        renderer: {
          geometries: app.scene3d.renderer.info.memory.geometries,
          textures: app.scene3d.renderer.info.memory.textures,
          calls: app.scene3d.renderer.info.render.calls,
          triangles: app.scene3d.renderer.info.render.triangles,
        },
        resourceEntries: performance.getEntriesByType('resource').length,
      };
    });
  }

  async function beginTier(label, cost) {
    await openLaptopWithNormalControl();
    await openClubhouseUpgrades();
    const before = await page.evaluate(() => window.__fw.state.cash);
    const cardButton = await page.evaluate((tierLabel) => {
      const card = [...document.querySelectorAll('.lt-shop-tier')]
        .find((element) => element.querySelector('.lt-shop-tier-label')?.textContent.trim() === tierLabel);
      const button = card?.querySelector('button.lt-primary');
      if (!button || button.disabled) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: button.textContent.trim() };
    }, label);
    if (!cardButton) throw new Error(`${label} shop tier has no enabled build action`);
    await page.mouse.click(cardButton.x, cardButton.y);
    await page.waitForTimeout(250);
    await glassClick('.lt-confirm button.lt-primary', 'Start construction', true);
    await page.waitForFunction((tierLabel) => {
      const pending = window.__fw.state.shop.progression?.pending;
      return pending?.target === tierLabel.toLowerCase();
    }, label);
    const after = await page.evaluate(() => window.__fw.state.cash);
    assert(Math.abs(before - after - cost) < 0.001, `${label.toLowerCase()}-charged-exactly-once`, { before, after, cost });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.laptopOpen === false);
    await page.waitForTimeout(500);
    return { before, after, action: cardButton.text };
  }

  async function advanceConstructionDays(days) {
    const steps = await page.evaluate(async (count) => {
      const { update } = await import('/src/sim/state.js');
      const app = window.__fw;
      const steps = [];
      for (let index = 0; index < count; index += 1) {
        const boundary = (Math.floor(app.state.clock.minutes / 1440) + 1) * 1440;
        update(app.state, boundary - app.state.clock.minutes + 1);
        steps.push({
          day: Math.floor(app.state.clock.minutes / 1440),
          tier: app.state.shop.progression.tier,
          pending: app.state.shop.progression.pending
            ? structuredClone(app.state.shop.progression.pending)
          : null,
        });
      }
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.speedIdx = 0;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      app.scene3d.clubhouse().refreshShopProgression();
      return steps;
    }, days);
    // Normal play gives transient purchase toasts time to clear during the
    // intervening days; keep completed-tier evidence equally unambiguous.
    await page.waitForTimeout(3200);
    return steps;
  }

  async function performanceSample(durationMs = 3000) {
    return page.evaluate((duration) => new Promise((resolve) => {
      const deltas = [];
      let previous = performance.now();
      const started = previous;
      function frame(now) {
        deltas.push(now - previous);
        previous = now;
        if (now - started >= duration) {
          const values = deltas.slice(1).filter((value) => value > 0).sort((a, b) => a - b);
          const total = values.reduce((sum, value) => sum + value, 0);
          resolve({
            frames: values.length,
            fps: values.length / (total / 1000),
            meanMs: total / values.length,
            p99Ms: values[Math.min(values.length - 1, Math.floor(values.length * 0.99))],
          });
          return;
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }), durationMs);
  }

  await page.setViewportSize({ width: 1600, height: 900 });
  // The runner seeds its isolated autosave after its own bootstrap navigation;
  // reload the menu so its asynchronous save scan sees that new slot.
  await page.goto('http://127.0.0.1:8467/', { waitUntil: 'domcontentloaded' });
  const continueButton = page.getByText('Continue', { exact: true });
  await continueButton.waitFor({ state: 'visible', timeout: 30000 });
  await continueButton.click();
  await waitForGame();

  const basic = await snapshot();
  assert(basic.tier === 'basic', 'fresh-property-starts-basic', basic);
  assert(basic.customerCapacity === 2, 'basic-customer-capacity', basic.customerCapacity);
  assert(basic.fixtureIds.length === 6, 'basic-has-compact-fixture-set', basic.fixtureIds);
  assert(basic.supplierTier === 1, 'basic-supplier-tier-one', basic.supplierTier);
  assert(basic.visuals.floorFinish === 'utility'
    && basic.visuals.loungeBarrier
    && basic.visuals.loungeBarrierCollider
    && !basic.visuals.premiumCounterInset,
  'basic-physical-treatment', basic.visuals);
  await pose({ x: -0.7, z: 5.5, tx: -4.2, tz: -1.6, pitch: -0.08 }, '01-basic-entry');

  await openLaptopWithNormalControl();
  await openClubhouseUpgrades();
  const tierUi = await page.evaluate(() => [...document.querySelectorAll('.lt-shop-tier')].map((card) => ({
    label: card.querySelector('.lt-shop-tier-label')?.textContent.trim(),
    text: card.textContent.replace(/\s+/g, ' ').trim(),
  })));
  assert(tierUi.length === 4
    && tierUi[0].text.includes('OPERATING')
    && tierUi[1].text.includes('$6,500')
    && tierUi[2].text.includes('$16,000')
    && tierUi[3].text.includes('$35,000'),
  'four-tier-laptop-ui-is-explicit', tierUi);
  await page.screenshot({ path: `${out}/02-tier-ui.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false);

  const standardPurchase = await beginTier('STANDARD', 6500);
  const pendingBeforeReload = await snapshot();
  assert(pendingBeforeReload.pending?.target === 'standard'
    && pendingBeforeReload.pending?.daysLeft === 2
    && pendingBeforeReload.visuals.constructionMarker
    && pendingBeforeReload.visuals.constructionCollider,
  'standard-construction-is-visible-physical-and-timed', pendingBeforeReload);
  await pose({ x: 0, z: 1.25, tx: 0, tz: -2.0, pitch: -0.07 }, '03-construction-in-progress');

  // The purchase path autosaves. Reload before a day passes and recover through
  // the real Continue button to prove unfinished work is durable.
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await waitForGame();
  const pendingAfterReload = await snapshot();
  assert(pendingAfterReload.pending?.target === 'standard'
    && pendingAfterReload.pending?.daysLeft === 2
    && pendingAfterReload.cash === standardPurchase.after
    && pendingAfterReload.visuals.constructionMarker
    && pendingAfterReload.visuals.constructionCollider,
  'pending-construction-and-payment-survive-reload', pendingAfterReload);

  const standardDays = await advanceConstructionDays(2);
  await page.waitForTimeout(800);
  const standard = await snapshot();
  assert(standard.tier === 'standard' && !standard.pending, 'standard-completes-after-two-days', standardDays);
  assert(standard.customerCapacity === 4 && standard.supplierTier >= 2,
    'standard-capacity-and-supplier-benefits', standard);
  assert(standard.fixtureIds.length === 12 && standard.propertyValue === 7500,
    'standard-fixtures-and-property-value', standard);
  assert(standard.visuals.floorFinish === 'standard'
    && standard.visuals.loungeBarrier
    && !standard.visuals.constructionMarker,
  'standard-physical-treatment', standard.visuals);
  await pose({ x: -0.7, z: 5.5, tx: -4.2, tz: -1.6, pitch: -0.08 }, '04-standard-entry');

  const premiumPurchase = await beginTier('PREMIUM', 16000);
  const premiumDays = await advanceConstructionDays(4);
  await page.waitForTimeout(900);
  const premium = await snapshot();
  assert(premium.tier === 'premium' && !premium.pending, 'premium-completes-after-four-days', premiumDays);
  assert(premium.customerCapacity === 6 && premium.fixtureIds.length === 18
    && premium.propertyValue === 20000 && premium.supplierTier >= 3,
  'premium-capacity-fixtures-supplier-and-value', premium);
  assert(premium.visuals.floorFinish === 'authored-premium'
    && !premium.visuals.loungeBarrier
    && premium.visuals.premiumCounterInset
    && !premium.visuals.luxuryShowcase,
  'premium-opens-lounge-and-finished-floor', premium.visuals);
  await pose({ x: -0.7, z: 5.5, tx: -4.2, tz: -1.6, pitch: -0.08 }, '05-premium-full-floor');
  await pose({ x: 0.8, z: -2.7, tx: 4.0, tz: -5.0, pitch: -0.04 }, '06-premium-open-lounge');

  const luxuryPurchase = await beginTier('LUXURY', 35000);
  const luxuryDays = await advanceConstructionDays(6);
  await page.waitForTimeout(1200);
  const luxury = await snapshot();
  assert(luxury.tier === 'luxury' && !luxury.pending, 'luxury-completes-after-six-days', luxuryDays);
  assert(luxury.customerCapacity === 8 && luxury.fixtureIds.length === 18
    && luxury.propertyValue === 45000,
  'luxury-capacity-fixtures-and-value', luxury);
  assert(luxury.visuals.floorFinish === 'luxury'
    && luxury.visuals.luxuryShowcase
    && luxury.visuals.premiumCounterInset
    && luxury.visuals.luxuryCounterTrim,
  'luxury-physical-treatment', luxury.visuals);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().clearWalkins?.());
  await pose({ x: -0.7, z: 5.5, tx: -4.2, tz: -1.6, pitch: -0.08 }, '07-luxury-full-floor');
  await pose({ x: 2.9, z: 1.6, tx: 2.9, tz: 4.2, pitch: -0.24 }, '08-luxury-checkout-frontage');
  await pose({ x: -0.55, z: 5.75, tx: -2.55, tz: 4.9, pitch: -0.14 }, '09-luxury-entrance-showcase');

  // Repeated physical refreshes must return to the same renderer residency.
  const lifecycleBefore = await snapshot();
  await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    for (let index = 0; index < 10; index += 1) {
      app.state.shop.progression.tier = index % 2 ? 'luxury' : 'basic';
      clubhouse.refreshShopProgression();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    app.state.shop.progression.tier = 'luxury';
    clubhouse.refreshShopProgression();
  });
  await page.waitForTimeout(900);
  const lifecycleAfter = await snapshot();
  const lifecycleDelta = {
    geometries: lifecycleAfter.renderer.geometries - lifecycleBefore.renderer.geometries,
    textures: lifecycleAfter.renderer.textures - lifecycleBefore.renderer.textures,
    resourceEntries: lifecycleAfter.resourceEntries - lifecycleBefore.resourceEntries,
  };
  assert(lifecycleDelta.geometries <= 2
    && lifecycleDelta.textures <= 1
    && lifecycleDelta.resourceEntries === 0,
  'ten-tier-refresh-cycles-have-stable-residency', lifecycleDelta);

  await pose({ x: -0.7, z: 5.5, tx: -4.2, tz: -1.6, pitch: -0.08 });
  const finalPerformance = await performanceSample();
  const baseline = JSON.parse(await fs.readFile(
    `${repo}/qa/property-expansion-world-overhaul/shop-progression/before/result.json`,
    'utf8',
  ));
  const performanceComparison = {
    baseline: baseline.performance,
    final: finalPerformance,
    fpsRatio: finalPerformance.fps / baseline.performance.fps,
    p99DeltaMs: finalPerformance.p99Ms - baseline.performance.p99Ms,
    rendererDelta: {
      geometries: lifecycleAfter.renderer.geometries - baseline.fixture.renderer.geometries,
      textures: lifecycleAfter.renderer.textures - baseline.fixture.renderer.textures,
    },
    rendererCountAuthority: 'The exact ten-cycle matched lifecycle delta is authoritative for residency. The older cross-run counts are diagnostic because deferred world assets have different wall-clock residency.',
  };
  assert(finalPerformance.fps >= 30
    && performanceComparison.fpsRatio >= 0.75
    && finalPerformance.p99Ms <= Math.max(30, baseline.performance.p99Ms * 2),
  'luxury-shop-performance-within-baseline-budget', performanceComparison);

  assert(consoleErrors.length === 0 && pageErrors.length === 0 && requestFailures.length === 0,
    'no-browser-errors', { consoleErrors, pageErrors, requestFailures });

  return {
    ok: Object.values(checks).every((entry) => entry.pass),
    route: 'physical-laptop-four-tier-construction-reload-visual-performance',
    controls: 'Trusted Playwright keyboard E/Escape and mouse coordinates on the projected physical laptop; production state update advances construction days.',
    purchases: { standardPurchase, premiumPurchase, luxuryPurchase },
    tiers: { basic, standard, premium, luxury },
    progressionDays: { standardDays, premiumDays, luxuryDays },
    persistence: { pendingBeforeReload, pendingAfterReload },
    lifecycle: { before: lifecycleBefore, after: lifecycleAfter, delta: lifecycleDelta },
    performance: performanceComparison,
    diagnostics: { consoleErrors, pageErrors, requestFailures },
    checks,
    media: {
      screenshots: out,
      video: 'Playwright context video is finalized when the runner closes.',
    },
  };
}
