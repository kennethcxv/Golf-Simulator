async (page) => {
  const OUT = process.env.QA_OUTPUT_DIR || 'qa/steam-release-polish/final-routes/world-smoke';
  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const log = [];
  const checks = {};
  const mark = (name, ok, detail = null) => {
    checks[name] = { ok: !!ok, detail };
    log.push({ name, ok: !!ok, detail });
  };
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
  const waitForGame = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive(), null, { timeout: 40000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 40000 });
    await page.waitForTimeout(900);
  };
  const openPause = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await page.locator('.pause-veil-ui').count()) return;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
    await page.waitForSelector('.pause-veil-ui', { timeout: 5000 });
  };

  await page.goto(base);
  await page.setViewportSize({
    width: Number(process.env.QA_VIEWPORT_WIDTH || 1920),
    height: Number(process.env.QA_VIEWPORT_HEIGHT || 1080),
  });
  await page.waitForTimeout(1000);

  // A repaired tractor is a legitimate state produced by its three maintenance
  // chores. The fixture supplies that state; mounting, driving and parking use
  // the player's normal E/W controls below.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw.holdings.find((item) => item.property.id === raw.activeId) || raw.holdings[0];
    holding.state.tractor = {
      steps: { cleared: true, fuel: true, belt: true },
      repaired: true,
    };
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
    localStorage.removeItem('gc-settings');
  });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await waitForGame();
  await shot('01-course-walk');

  const beforeWalk = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z, yaw: w.yaw };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(650);
  await page.keyboard.up('w');
  await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  await page.waitForTimeout(650);
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowLeft');
  const afterWalk = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z, yaw: w.yaw };
  });
  const walkDistance = Math.hypot(afterWalk.x - beforeWalk.x, afterWalk.z - beforeWalk.z);
  mark('walk, sprint, and keyboard look respond', walkDistance > 3 && afterWalk.yaw !== beforeWalk.yaw,
    { walkDistance, yawDelta: afterWalk.yaw - beforeWalk.yaw });

  await page.keyboard.press('Space');
  mark('Space pauses simulation', await page.evaluate(() => window.__fw.speedIdx === 0));
  await openPause();
  mark('Esc pause menu preserves already-paused speed', await page.evaluate(() => window.__fw.speedIdx === 0));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.set-row').filter({ hasText: 'Interface scale' }).getByRole('button', { name: '125%' }).click();
  const motionRow = page.locator('.set-row').filter({ hasText: 'Reduced motion' });
  if ((await motionRow.getByRole('button').textContent()).trim() !== 'On') {
    await motionRow.getByRole('button').click();
  }
  await page.locator('.set-row').filter({ hasText: 'Tool use' }).getByRole('button', { name: 'Toggle' }).click();
  await page.locator('.set-row').filter({ hasText: 'Field of view' }).locator('input').evaluate((input) => {
    input.value = '72';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.set-row').filter({ hasText: 'Mouse sensitivity' }).locator('input').evaluate((input) => {
    input.value = '1.3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const visibleSettingValues = {
    fov: (await page.locator('.set-row').filter({ hasText: 'Field of view' }).locator('.set-val').textContent()).trim(),
    sens: (await page.locator('.set-row').filter({ hasText: 'Mouse sensitivity' }).locator('.set-val').textContent()).trim(),
  };
  await shot('02-accessibility-settings');
  const accessibility = await page.evaluate(() => ({
    settings: JSON.parse(localStorage.getItem('gc-settings')),
    rootSize: getComputedStyle(document.documentElement).fontSize,
    reduced: document.documentElement.dataset.reducedMotion,
    fov: window.__fw.scene3d.camera.fov,
    walkReduced: window.__fw.scene3d.walk.state.reducedMotion,
    sway: window.__fw.scene3d.walk.state.toolSway,
    sens: window.__fw.scene3d.walk.state.sens,
    clubNamePanel: (() => {
      let panel = null;
      window.__fw.scene3d.scene.traverse((object) => {
        if (object.userData?.releaseRole === 'live-club-name') panel = object;
      });
      return panel?.userData?.clubName || null;
    })(),
  }));
  mark('accessibility settings apply and persist',
    accessibility.settings.uiScale === 1.25
      && accessibility.settings.reducedMotion === true
      && accessibility.settings.toolUse === 'toggle'
      && accessibility.rootSize === '18.75px'
      && accessibility.reduced === 'true'
      && accessibility.fov === 72
      && accessibility.walkReduced === true
      && accessibility.sway === true
      && accessibility.sens === 1.3
      && visibleSettingValues.fov === '72°'
      && visibleSettingValues.sens === '1.3×'
      && accessibility.clubNamePanel === 'WILLOW CREEK MUNICIPAL',
    { ...accessibility, visibleSettingValues });

  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  mark('closing pause menu restores intentional zero speed', await page.evaluate(() => window.__fw.speedIdx === 0));
  await page.keyboard.press('Space');
  mark('Space resumes simulation', await page.evaluate(() => window.__fw.speedIdx === 1));

  await page.keyboard.press('f');
  const tool = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
  await page.locator('#game').click({ position: { x: 960, y: 540 } });
  await page.waitForTimeout(250);
  const toggledOn = await page.evaluate(() => window.__fw.scene3d.walk.isSpraying());
  await page.locator('#game').click({ position: { x: 960, y: 540 } });
  await page.waitForTimeout(150);
  const toggledOff = !(await page.evaluate(() => window.__fw.scene3d.walk.isSpraying()));
  mark('toggle-use tool input starts and stops authoritatively', tool === 'washer' && toggledOn && toggledOff,
    { tool, toggledOn, toggledOff });
  await shot('03-tool-and-clean-hud');

  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw.courseMode === 'overview');
  await shot('04-course-overview');
  await page.keyboard.press('v');
  mark('overview data view cycles', await page.evaluate(() => window.__fw.viewMode === 'health'));
  await page.keyboard.press('g');
  mark('grounds desk opens from normal shortcut', await page.evaluate(() => window.__fw.groundsOpen));
  await shot('05-grounds-maintenance');
  await page.keyboard.press('g');
  await page.keyboard.press('c');
  mark('club office opens from normal shortcut', await page.evaluate(() => window.__fw.clubOpen));
  await shot('06-club-office');
  await page.keyboard.press('c');
  await page.keyboard.press('m');
  mark('empire panel opens from normal shortcut', await page.evaluate(() => window.__fw.empireOpen));
  await shot('07-property-empire');
  await page.keyboard.press('m');
  await page.keyboard.press('e');
  mark('course editor opens from normal shortcut', await page.evaluate(() => window.__fw.worksMode));
  await shot('08-course-editor');
  await page.keyboard.press('e');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw.courseMode === 'walk');

  await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    walk.state.x = walk.cart.x;
    walk.state.z = walk.cart.z + 2;
    walk.state.yaw = 0;
    walk.state.pitch = 0;
  });
  await page.waitForFunction(() => /take the wheel/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''), null, { timeout: 5000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.walk.cart.mounted);
  const tractorBefore = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.cart.x,
    z: window.__fw.scene3d.walk.cart.z,
  }));
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  const tractorAfter = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.cart.x,
    z: window.__fw.scene3d.walk.cart.z,
  }));
  const tractorDistance = Math.hypot(tractorAfter.x - tractorBefore.x, tractorAfter.z - tractorBefore.z);
  mark('repaired tractor mounts and drives through E/W controls', tractorDistance > 2, { tractorDistance });
  await shot('09-tractor-driving');
  await page.keyboard.press('e');
  mark('tractor parks through E', !(await page.evaluate(() => window.__fw.scene3d.walk.cart.mounted)));

  await openPause();
  await page.getByRole('button', { name: 'Save game', exact: true }).click();
  await page.getByRole('button', { name: 'Save here', exact: true }).first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.slot-meta')].some((node) => !/empty|…/.test(node.textContent.toLowerCase())));
  mark('pause-menu save slot writes through normal controls', true);
  await page.getByRole('button', { name: 'Office', exact: true }).click();
  await page.getByRole('button', { name: /Exit to main menu/ }).click();
  await page.waitForFunction(() => {
    const menu = document.querySelector('.menu-screen');
    return menu && getComputedStyle(menu).display !== 'none';
  }, null, { timeout: 40000 });
  mark('exit to menu autosaves and returns cleanly', await page.evaluate(() => window.__fw.screen === 'menu'));
  await shot('10-returned-to-menu');

  const ok = Object.values(checks).every((check) => check.ok);
  return { ok, checks, log };
}
