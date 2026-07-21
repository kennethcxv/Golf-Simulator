async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.MANAGEMENT_PERSIST_QA_ROOT
    || path.join(process.cwd(), 'qa', 'management', 'acceptance', 'persistence'));
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = { consoleErrors: [], warnings: [], pageErrors: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.warnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.failedRequests.push({
    url: request.url(), error: request.failure()?.errorText || 'unknown',
  }));

  const assert = (value, message) => { if (!value) throw new Error(message); };
  const click = async (locator, label) => {
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    assert(box && box.width > 2 && box.height > 2, `${label} has no clickable bounds.`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  const waitLaptop = () => page.waitForFunction(() => (
    window.__fw?.laptopOpen === true
      && document.querySelector('.laptop-screen')?.style.display !== 'none'
  ), null, { timeout: 15000 });
  const openNav = async (label) => {
    const target = page.locator('.lt-navbtn').filter({ hasText: new RegExp(`^${label}$`) });
    await click(target, `${label} navigation`);
    await page.waitForFunction((wanted) => (
      document.querySelector('.lt-navbtn.on')?.textContent.trim() === wanted
    ), label, { timeout: 5000 });
  };
  const openTab = async (label) => {
    const target = page.locator('.lt-tabs-big .lt-tab').filter({ hasText: new RegExp(`^${label}$`) });
    await click(target, `${label} tab`);
    await page.waitForFunction((wanted) => (
      document.querySelector('.lt-tabs-big .lt-tab.on')?.textContent.trim() === wanted
    ), label, { timeout: 5000 });
  };
  const setRange = async (locator, target, label) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    assert(box, `${label} range has no bounds.`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const spec = await locator.evaluate((input) => ({
      min: Number(input.min), max: Number(input.max), step: Number(input.step) || 1,
    }));
    assert(target >= spec.min && target <= spec.max, `${label} target is outside its range.`);
    await page.keyboard.press('Home');
    const presses = Math.round((target - spec.min) / spec.step);
    for (let index = 0; index < presses; index += 1) await page.keyboard.press('ArrowRight');
    assert(Number(await locator.inputValue()) === target, `${label} did not reach ${target}.`);
  };
  const snapshot = () => page.evaluate(() => {
    const state = window.__fw.state;
    const tier = Object.keys(state.club.dues)[0];
    return {
      clubName: state.clubName,
      greenFee: state.club.greenFee,
      ballsMarkup: state.shop.markup.balls,
      memberTier: tier,
      memberDues: state.club.dues[tier],
      featureCategory: state.shop.featureCategory ?? null,
      reducedCameraMotion: state.uiPrefs?.checkout?.reducedCameraMotion === true,
    };
  });

  // The runner's first document seeds the isolated autosave. Let it settle
  // before the measured reload so cancelled models stay outside diagnostics.
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.goto(baseUrl);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    app.speedIdx = 0;
    app.state.shop.unlockedTier = 3;
    walk.x = origin.x + 8.55;
    walk.z = origin.z + 4.5;
    walk.yaw = -Math.PI / 2;
    walk.pitch = -0.05;
  });
  await page.waitForTimeout(650);
  await page.keyboard.press('e');
  await waitLaptop();

  await openNav('Pro Shop');
  await openTab('Pricing');
  let ranges = page.locator('.lt-content input[type="range"]');
  await setRange(ranges.nth(0), 58, 'green fee');
  await setRange(ranges.nth(2), 128, 'ball markup');
  await page.screenshot({ path: path.join(out, '01-pricing-set.png') });

  await openNav('Business');
  await openTab('Memberships');
  ranges = page.locator('.lt-content input[type="range"]');
  const duesBefore = Number(await ranges.nth(0).inputValue());
  const duesStep = Number(await ranges.nth(0).getAttribute('step')) || 5;
  const duesMax = Number(await ranges.nth(0).getAttribute('max'));
  const duesTarget = duesBefore + duesStep <= duesMax ? duesBefore + duesStep : duesBefore - duesStep;
  await setRange(ranges.nth(0), duesTarget, 'first membership tier dues');
  await page.screenshot({ path: path.join(out, '02-membership-dues-set.png') });

  await openTab('Marketing');
  const ballsFeature = page.locator('.lt-card .lt-tabs .lt-tab').filter({ hasText: /^Golf balls$/ });
  await click(ballsFeature, 'Balls feature category');
  await page.waitForFunction(() => window.__fw.state.shop.featureCategory === 'balls');
  await page.screenshot({ path: path.join(out, '03-marketing-feature-set.png') });

  await openNav('Settings');
  const nameInput = page.locator('.lt-input');
  await click(nameInput, 'club name');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Fairhollow Management QA');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw.state.clubName === 'Fairhollow Management QA');
  await openTab('Checkout');
  const reducedRow = page.locator('label.lt-row').filter({ hasText: /Reduced checkout camera motion/ });
  const reducedCheck = reducedRow.locator('input[type="checkbox"]');
  if (!await reducedCheck.isChecked()) await click(reducedCheck, 'reduced checkout camera motion');
  await page.waitForFunction(() => window.__fw.state.uiPrefs?.checkout?.reducedCameraMotion === true);
  await page.screenshot({ path: path.join(out, '04-settings-set.png') });

  const beforeSave = await snapshot();
  assert(beforeSave.greenFee === 58 && Math.abs(beforeSave.ballsMarkup - 1.28) < 1e-9,
    `Pricing controls did not write exact live values: ${JSON.stringify(beforeSave)}`);
  assert(beforeSave.memberDues === duesTarget && beforeSave.featureCategory === 'balls'
      && beforeSave.clubName === 'Fairhollow Management QA' && beforeSave.reducedCameraMotion,
  `Management controls did not write exact live values: ${JSON.stringify(beforeSave)}`);
  await page.evaluate(() => window.__fw.autosave());

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  const afterLoad = await snapshot();
  assert(JSON.stringify(afterLoad) === JSON.stringify(beforeSave),
    `Management state changed across autosave/reload: ${JSON.stringify({ beforeSave, afterLoad })}`);

  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 8.55;
    walk.z = origin.z + 4.5;
    walk.yaw = -Math.PI / 2;
    walk.pitch = -0.05;
  });
  await page.waitForTimeout(650);
  await page.keyboard.press('e');
  await waitLaptop();
  await openNav('Business');
  await openTab('Marketing');
  assert(await ballsFeature.isVisible(), 'Marketing feature controls disappeared after reload.');
  assert(await ballsFeature.evaluate((button) => button.classList.contains('on')),
    'The saved Balls feature is not visibly selected after reload.');
  await page.screenshot({ path: path.join(out, '05-after-reload.png') });

  const nonAborted = diagnostics.failedRequests.filter((entry) => !/ERR_ABORTED/.test(entry.error));
  const result = {
    ok: diagnostics.consoleErrors.length === 0 && diagnostics.pageErrors.length === 0
      && nonAborted.length === 0,
    beforeSave,
    afterLoad,
    normalInputChanges: ['green fee', 'ball markup', 'membership dues', 'featured merchandise', 'club name', 'checkout camera preference'],
    savePath: 'production autosave followed by a full page reload and Continue',
    diagnostics: { ...diagnostics, nonAbortedFailedRequests: nonAborted },
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
