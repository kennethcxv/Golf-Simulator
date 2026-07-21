async (page) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const base = process.env.QA_BASE_URL || 'http://localhost:8497/';
  const requestedTargetFixtureId = String(process.env.QA_TARGET_FIXTURE_ID || '').trim();
  const targetFixtureId = requestedTargetFixtureId || 'backshelf_e2';
  const evidenceName = requestedTargetFixtureId
    ? `ownership-${targetFixtureId.replaceAll('_', '-')}`
    : 'ownership-normal-controls';
  const out = path.join(process.cwd(), 'qa', 'store-generation', evidenceName);
  await fs.mkdir(out, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed:${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });

  await page.setViewportSize({ width: 1600, height: 900 });

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
  }

  async function launchBoutique() {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const E = await import('/src/sim/empire.js');
      const empire = E.newEmpire('relaxed', 985731);
      empire.cash = 10_000_000;
      const property = empire.market.find((entry) => entry.shopLevel === 5);
      if (!property) throw new Error('No course-5 property available');
      const bought = E.buyProperty(empire, property.id);
      if (!bought.ok) throw new Error(bought.reason);
      bought.state.tutorial.complete = true;
      bought.state.tutorial.hidden = true;
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Continue', { exact: true }).click();
    await waitForGame();
    await page.mouse.click(800, 450);
    await page.waitForTimeout(1200);
  }

  async function aimAtPose(fixture) {
    return page.evaluate((pose) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
      const walk = app.scene3d.walk.state;
      const fallbackDistance = 3.0;
      const offset = Math.abs(Math.sin(pose.ry || 0)) > 0.5
        ? { x: fallbackDistance, z: 0 }
        : { x: 0, z: fallbackDistance };
      walk.x = origin.x + (pose.view?.x ?? pose.x + offset.x);
      walk.z = origin.z + (pose.view?.z ?? pose.z + offset.z);
      const dx = origin.x + pose.x - walk.x;
      const dz = origin.z + pose.z - walk.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.pitch = -Math.atan2(walk.eye, distance);
      app.scene3d.walk.clearKeys?.();
      return { fixture: { ...pose }, distance };
    }, fixture);
  }

  async function aimAtFixture(fixtureId) {
    const fixture = await page.evaluate(async (id) => {
      const { placedFixtures } = await import('/src/sim/layout.js');
      const app = window.__fw;
      const fixtures = placedFixtures(app.state);
      const found = fixtures.find((entry) => entry.id === id);
      if (!found) throw new Error(`Fixture ${id} is not placed`);
      let view = null;
      if (id === 'office_chair') {
        const desk = fixtures.find((entry) => entry.id === 'office_desk');
        const dx = found.x - desk.x;
        const dz = found.z - desk.z;
        const length = Math.hypot(dx, dz) || 1;
        view = { x: found.x + dx / length * 1.6, z: found.z + dz / length * 1.6 };
      } else if (id === 'office_filing') {
        view = { x: 8.15, z: 4.15 };
      } else if (id === 'packing_bench') {
        view = { x: 8.15, z: -2.75 };
      }
      return { id: found.id, title: found.title, x: found.x, z: found.z, ry: found.ry, view };
    }, fixtureId);
    return aimAtPose(fixture);
  }

  await launchBoutique();
  const initialAim = await aimAtFixture(targetFixtureId);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '01-placed-fixture.png') });

  // From here onward every ownership mutation uses the same keys a player uses.
  await page.keyboard.press('b');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.diagnostics().active);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => (
    window.__fw.scene3d.clubhouse().build.diagnostics().carrying === id
  ), targetFixtureId);
  await page.screenshot({ path: path.join(out, '02-picked-up.png') });

  await page.keyboard.press('x');
  await page.waitForFunction((id) => (
    window.__fw.state.shop.layout.stored.includes(id)
    && !window.__fw.scene3d.clubhouse().build.diagnostics().carrying
  ), targetFixtureId);
  await page.keyboard.press('i');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.diagnostics().inventoryOpen);
  // Generated decor entries sort first; the newly stored fixture is the final entry.
  await page.keyboard.press('ArrowUp');
  const selectedStoredText = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.inventoryText());
  if (!selectedStoredText.includes(initialAim.fixture.title)) {
    throw new Error(`Stored fixture was not selected through inventory controls: ${selectedStoredText}`);
  }
  await page.screenshot({ path: path.join(out, '03-stored-inventory.png') });

  const cashBeforeSale = await page.evaluate(() => window.__fw.state.cash);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(120);
  await page.keyboard.press('Delete');
  await page.waitForFunction((id) => window.__fw.state.shop.layout.sold.includes(id), targetFixtureId);
  const cashAfterSale = await page.evaluate(() => window.__fw.state.cash);
  await page.screenshot({ path: path.join(out, '04-sold.png') });

  await page.keyboard.press('e');
  await page.waitForFunction((id) => (
    window.__fw.scene3d.clubhouse().build.diagnostics().carrying === id
    && !window.__fw.state.shop.layout.sold.includes(id)
  ), targetFixtureId);
  const cashAfterReplacement = await page.evaluate(() => window.__fw.state.cash);
  await page.screenshot({ path: path.join(out, '05-replacement-ghost.png') });

  await aimAtPose(initialAim.fixture);
  await page.waitForTimeout(120);
  const beforePlacementDiagnostics = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().build.diagnostics()
  ));
  if (!beforePlacementDiagnostics.validation.ok) {
    throw new Error(`Replacement ghost is not at a valid pose: ${JSON.stringify(beforePlacementDiagnostics)}`);
  }
  await page.keyboard.press('e');
  await page.waitForFunction((id) => (
    !window.__fw.scene3d.clubhouse().build.diagnostics().carrying
      && !window.__fw.state.shop.layout.stored.includes(id)
      && !window.__fw.state.shop.layout.sold.includes(id)
  ), targetFixtureId);
  await page.screenshot({ path: path.join(out, '06-replaced-on-floor.png') });

  const beforeSave = await page.evaluate(async (id) => {
    const { fixtureOwnershipEntries, placedFixtures } = await import('/src/sim/layout.js');
    return {
      entry: fixtureOwnershipEntries(window.__fw.state).find((candidate) => candidate.id === id),
      fixture: placedFixtures(window.__fw.state).find((candidate) => candidate.id === id),
      layout: structuredClone(window.__fw.state.shop.layout),
    };
  }, targetFixtureId);
  await page.evaluate(() => window.__fw.autosave());
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();
  const reloaded = await page.evaluate(async (id) => {
    const { fixtureOwnershipEntries, placedFixtures } = await import('/src/sim/layout.js');
    const entry = fixtureOwnershipEntries(window.__fw.state).find((candidate) => candidate.id === id);
    const fixture = placedFixtures(window.__fw.state).find((candidate) => candidate.id === id);
    return {
      status: entry?.status || null,
      fixture: fixture ? { id: fixture.id, x: fixture.x, z: fixture.z, ry: fixture.ry } : null,
      cash: window.__fw.state.cash,
      operationCount: Object.keys(window.__fw.state.shop.layout.fixtureOperations || {}).length,
    };
  }, targetFixtureId);
  if (reloaded.fixture) await aimAtFixture(targetFixtureId);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '07-reloaded.png') });

  const result = {
    ok: reloaded.status === 'placed'
      && !!reloaded.fixture
      && cashAfterSale > cashBeforeSale
      && cashAfterReplacement < cashAfterSale
      && reloaded.operationCount >= 2,
    branch: 'feature/store-generation',
    targetFixtureId,
    initialAim,
    normalControls: ['B', 'E', 'X', 'I', 'ArrowUp', 'Delete', 'Delete', 'E', 'E'],
    selectedStoredText,
    cashBeforeSale,
    cashAfterSale,
    cashAfterReplacement,
    beforePlacementDiagnostics,
    beforeSave,
    reloaded,
    diagnostics,
  };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  if (!result.ok) throw new Error(`Ownership cycle did not survive reload: ${JSON.stringify(result)}`);
  return result;
}
