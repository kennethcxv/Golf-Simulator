async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.addInitScript(() => {
    localStorage.setItem('golfempire:preferences:v1', JSON.stringify({
      audio: { master: 0, effects: 0, ambience: 0, ui: 0, muted: true },
      camera: { sensitivity: 1, invertY: false, fov: 66, bob: true },
      display: {
        quality: 'high', renderScale: 1, ambientOcclusion: true,
        bloom: true, shadows: true, uiScale: 1,
      },
      accessibility: { reducedMotion: false, highContrast: false, toolActivation: 'hold' },
    }));
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const continueButton = page.locator('button.menu-action-primary').filter({
    has: page.locator('.menu-action-label', { hasText: /^Continue$/ }),
  });
  await continueButton.click({ timeout: 30_000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90_000 });
  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    await Promise.all([
      clubhouse.pineHillsInterior?.ready,
      clubhouse.sheet07Production?.ready,
      clubhouse.modernClubhouse?.ready,
    ].filter(Boolean));
    app.speedIdx = 0;
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const customersOf = () => (
      typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers
    );
    while (customersOf().length < 10) {
      if (!clubhouse.debugSpawn(false)) break;
    }
    const customers = customersOf();
    const origin = clubhouse.interior.position;
    const positions = [
      [-3.4, -2.5], [-1.65, -2.5], [0.1, -2.5], [1.85, -2.5],
      [-3.4, -1.05], [-1.65, -1.05], [0.1, -1.05], [1.85, -1.05],
      [-1.65, 0.4], [0.1, 0.4],
    ];
    customers.slice(0, 10).forEach((customer, index) => {
      const [localX, localZ] = positions[index];
      const x = origin.x + localX;
      const z = origin.z + localZ;
      customer.mesh.position.set(x, customer.mesh.position.y, z);
      customer.path = [];
      customer.pathGoal = null;
      customer.speed = 0;
      customer.linger = 1e9;
      customer.stops = [{ kind: 'fixture', x, z, faceX: origin.x + 2.8, faceZ: origin.z + 5.1 }];
      customer.stopIdx = 0;
    });
    Object.assign(app.scene3d.walk.state, {
      x: origin.x + 2.8, z: origin.z + 5.1, yaw: 0, pitch: -0.18,
    });
    return { customers: customers.length };
  });
  await page.waitForTimeout(2_000);

  async function measure(label) {
    return page.evaluate((name) => new Promise((resolve) => {
      const frames = [];
      let previous = null;
      let started = null;
      const tick = (now) => {
        if (started == null) started = now;
        if (previous != null) frames.push(now - previous);
        previous = now;
        if (now - started < 5_000) return requestAnimationFrame(tick);
        const retained = frames.slice(5);
        const total = retained.reduce((sum, value) => sum + value, 0);
        const sorted = [...retained].sort((a, b) => b - a);
        const slowCount = Math.max(1, Math.ceil(sorted.length * 0.01));
        const slowMean = sorted.slice(0, slowCount)
          .reduce((sum, value) => sum + value, 0) / slowCount;
        resolve({
          label: name,
          frameCount: retained.length,
          averageFps: retained.length * 1000 / total,
          onePercentLowFps: 1000 / slowMean,
          worstFrameMs: sorted[0],
        });
      };
      requestAnimationFrame(tick);
    }), label);
  }

  const production = await measure('production');
  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers() : clubhouse.customers;
    for (const customer of customers) {
      const char = customer.mesh.userData.char;
      if (!char) continue;
      char.__isolationUpdate = char.update;
      char.update = () => {};
    }
  });
  const animationFrozen = await measure('animation-frozen');
  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers() : clubhouse.customers;
    for (const customer of customers) {
      const char = customer.mesh.userData.char;
      if (char?.__isolationUpdate) char.update = char.__isolationUpdate;
      customer.mesh.visible = false;
    }
  });
  const customersHidden = await measure('customers-hidden');
  return { ok: true, fixture, samples: [production, animationFrozen, customersHidden] };
}
