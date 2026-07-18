async (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1800);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const heapBefore = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : null);
  await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const originalDispose = THREE.BufferGeometry.prototype.dispose;
    window.__patienceGeometryProbe = { totalDisposals: 0, ringDisposals: 0 };
    THREE.BufferGeometry.prototype.dispose = function patienceProbeDispose(...args) {
      const probe = window.__patienceGeometryProbe;
      if (probe) {
        probe.totalDisposals += 1;
        if (this.type === 'RingGeometry') probe.ringDisposals += 1;
      }
      return originalDispose.apply(this, args);
    };
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    for (const id of ['tees1', 'marker1', 'glove1']) app.state.shop.inventory[id].shelf = Math.max(20, app.state.shop.inventory[id].shelf || 0);
    clubhouse.rebuildStock();
    const origin = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 2.80;
    walk.z = origin.z + 5.35;
    walk.yaw = 0;
    walk.pitch = -0.18;
    window.__patienceCustomer = clubhouse.sendToCounter(['tees1', 'marker1', 'glove1'], 'card');
  });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.items.length === 3, null, { timeout: 20000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  await page.evaluate(() => {
    const customer = window.__fw.scene3d.clubhouse().register.getCustomer();
    customer.patience = 300;
    window.__patienceGeometryProbe.active = true;
    window.__patienceGeometryProbe.uuids = [];
    window.__patienceGeometryProbe.frames = [];
    let previous = performance.now();
    const tick = (now) => {
      const probe = window.__patienceGeometryProbe;
      if (!probe?.active) return;
      const current = window.__fw.scene3d.clubhouse().register.getCustomer()?.patienceMesh?.geometry?.uuid || null;
      probe.uuids.push(current);
      probe.frames.push(now - previous);
      previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const rendererBefore = await page.evaluate(() => ({ ...window.__fw.scene3d.renderer.info.memory }));
  await page.waitForTimeout(5000);
  const result = await page.evaluate(() => {
    const probe = window.__patienceGeometryProbe;
    probe.active = false;
    const uuids = probe.uuids.filter(Boolean);
    let geometryChanges = 0;
    for (let index = 1; index < uuids.length; index += 1) if (uuids[index] !== uuids[index - 1]) geometryChanges += 1;
    const frames = probe.frames.slice(5);
    const durationMs = frames.reduce((sum, value) => sum + value, 0);
    return {
      frames: frames.length,
      avgFps: +(frames.length * 1000 / durationMs).toFixed(2),
      uniquePatienceGeometryUuids: new Set(uuids).size,
      patienceGeometryChanges: geometryChanges,
      ringGeometryDisposals: probe.ringDisposals,
      totalGeometryDisposals: probe.totalDisposals,
      activelyServed: window.__fw.scene3d.clubhouse().register.isActive(),
      frozenPatience: window.__fw.scene3d.clubhouse().register.getCustomer()?.patience,
      rendererAfter: { ...window.__fw.scene3d.renderer.info.memory },
    };
  });
  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfter = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : null);
  return {
    protocol: { viewport: '1600x900', sampleMs: 5000, customerPatience: 300, activeRegister: true },
    rendererBefore,
    ...result,
    heapBeforeBytes: heapBefore,
    heapAfterBytes: heapAfter,
    heapDeltaBytes: heapBefore == null || heapAfter == null ? null : heapAfter - heapBefore,
    errors,
  };
}
