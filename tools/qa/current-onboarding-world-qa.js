async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const iteration = process.env.ONBOARDING_QA_ITERATION || 'iteration-01';
  const out = path.join(repo, 'qa', 'current-fix-pass', 'onboarding-world', iteration);
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], warnings: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.warnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive(), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).display === 'none' || Number(getComputedStyle(veil).opacity) <= 0.01;
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(1_500);

  const shot = async (name) => {
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file, animations: 'disabled' });
    return path.relative(repo, file).replaceAll('\\', '/');
  };
  const poseLocal = async (at, target, pitch = -0.04) => {
    await page.evaluate(({ at, target, pitch }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.group.updateWorldMatrix(true, false);
      const makeWorld = ([x, z]) => clubhouse.group.localToWorld(
        clubhouse.group.position.clone().set(x, 0, z),
      );
      const a = makeWorld(at);
      const b = makeWorld(target);
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = a.x;
      walk.state.z = a.z;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / length, -dz / length);
      walk.state.pitch = pitch;
      app.speedIdx = 0;
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + 14 * 60;
      app.state.weather.today.rainIn = 0;
      app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    }, { at, target, pitch });
    await page.waitForTimeout(500);
  };
  const localWalk = () => page.evaluate(() => {
    const app = window.__fw;
    const walk = app.scene3d.walk.state;
    const local = app.scene3d.clubhouse().group.worldToLocal(
      app.scene3d.clubhouse().group.position.clone().set(walk.x, 0, walk.z),
    );
    return { x: local.x, z: local.z, yaw: walk.yaw, pitch: walk.pitch };
  });

  const captures = [];
  const onboarding = await page.evaluate(async () => {
    const tutorial = await import(new URL('src/sim/tutorial.js', document.baseURI).href);
    const app = window.__fw;
    return {
      screen: app.screen,
      activeId: app.empire.activeId,
      holdings: app.empire.holdings.length,
      listedStarter: app.empire.market.some((property) => property.id === 'willow-creek'),
      holes: app.state.course.holes.length,
      holeNames: app.state.course.holes.map((hole) => hole.name),
      tutorial: tutorial.currentStep(app.state),
      propertyMarketVisible: !!document.querySelector('.market-dialog'),
      spawn: { ...app.scene3d.walk.state },
    };
  });
  captures.push(await shot('01-new-game-direct-spawn'));

  await poseLocal([0, 25], [-0.8, 5.8], 0.04);
  captures.push(await shot('02-starter-clubhouse-arrival'));

  let doorFocus = null;
  const doorProbe = [];
  for (const z of [7.25, 7.0, 6.75]) {
    await poseLocal([-0.8, z], [-0.8, 5.63], -0.10);
    doorFocus = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
    doorProbe.push({ z, focus: doorFocus });
    if (/shop door/i.test(doorFocus || '')) break;
  }
  if (!/shop door/i.test(doorFocus || '')) {
    throw new Error(`Compact main door was not focusable through normal aim: ${JSON.stringify(doorProbe)}`);
  }
  captures.push(await shot('03-main-door-closed-normal-focus'));
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => {
    const main = window.__fw?.state?.shop?.reno?.architecture?.doors?.main;
    return main?.left === 'open' && main?.right === 'open';
  }, null, { timeout: 10_000 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1_100);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(250);
  const afterDoorWalk = await localWalk();
  captures.push(await shot('04-entered-through-open-main-door'));

  await page.evaluate(() => {
    const app = window.__fw;
    const laptop = app.scene3d.clubhouse().laptopRig().object;
    laptop.updateWorldMatrix(true, false);
    const target = laptop.getWorldPosition(laptop.position.clone());
    const seatSide = laptop.localToWorld(laptop.position.clone().set(0, 0, -0.92));
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.state.x = seatSide.x;
    walk.state.z = seatSide.z;
    const dx = target.x - seatSide.x;
    const dz = target.z - seatSide.z;
    walk.state.yaw = Math.atan2(-dx, -dz);
    walk.state.pitch = -0.34;
  });
  await page.waitForFunction(() => /laptop/i.test(
    window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
  ), null, { timeout: 10_000 });
  const laptopFocus = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
  captures.push(await shot('05-office-laptop-normal-focus'));
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__fw?.laptopOpen === true
    && document.querySelector('.lt-frame')?.getBoundingClientRect().width > 100, null, { timeout: 20_000 });
  captures.push(await shot('06-laptop-home-property-route'));
  const acquisitionCopy = await page.locator('.laptop-screen').textContent();
  await page.getByRole('button', { name: 'Browse Properties', exact: true }).click();
  await page.getByRole('heading', { name: 'Property market', exact: true }).waitFor({ timeout: 10_000 });
  captures.push(await shot('07-property-market-opened-from-laptop'));
  const market = {
    laptopClosed: await page.evaluate(() => window.__fw.laptopOpen === false),
    listingCount: await page.locator('.market-listing').count(),
    heading: await page.getByRole('heading', { name: 'Property market', exact: true }).textContent(),
  };
  await page.getByRole('button', { name: 'Back to the club', exact: true }).click();

  await poseLocal([0, 25], [-0.8, 5.8], 0.04);
  const performance = await page.evaluate(() => new Promise((resolve) => {
    const frames = [];
    let previous = performance.now();
    const tick = (now) => {
      frames.push(now - previous);
      previous = now;
      if (frames.length < 240) {
        requestAnimationFrame(tick);
        return;
      }
      const sorted = frames.slice(1).sort((a, b) => a - b);
      const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
      const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
      const renderer = window.__fw.scene3d.renderer;
      resolve({
        samples: sorted.length,
        averageFps: 1000 / mean,
        onePercentLowFps: 1000 / p99,
        worstFrameMs: sorted.at(-1),
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      });
    };
    requestAnimationFrame(tick);
  }));

  const checks = {
    directStarterEntry: onboarding.screen === 'game'
      && onboarding.activeId === 'willow-creek'
      && onboarding.holdings === 1
      && onboarding.listedStarter === false
      && onboarding.propertyMarketVisible === false,
    threeHoleCourse: onboarding.holes === 3,
    dynamicTutorialActive: onboarding.tutorial?.id === 'survey'
      && onboarding.tutorial?.complete === false,
    mainDoorFocusedAndTraversed: /shop door/i.test(doorFocus) && afterDoorWalk.z < 6.1,
    laptopFocused: /laptop/i.test(laptopFocus),
    propertyMarketRoutedThroughLaptop: /Acquisitions are handled from this front-desk laptop/.test(acquisitionCopy)
      && market.laptopClosed && market.listingCount > 0,
    noBrowserErrors: diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0
      && diagnostics.requestFailures.length === 0,
  };
  const result = {
    ok: Object.values(checks).every(Boolean),
    checks,
    onboarding,
    door: { focus: doorFocus, afterWalk: afterDoorWalk },
    laptop: { focus: laptopFocus, acquisitionCopyFound: /Acquisitions are handled/.test(acquisitionCopy) },
    market,
    performance,
    diagnostics,
    captures,
  };
  fs.writeFileSync(path.join(out, 'latest-result.json'), JSON.stringify(result, null, 2));
  return result;
}
