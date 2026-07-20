async (page) => {
  const cycles = Math.max(1, Number(process.env.WATER_REBUILD_CYCLES || 20));
  const simulateOldLeak = process.env.DISPOSE_WATER_TARGETS === '0';
  const errors = [];
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(500);

  const result = await page.evaluate(async ({ cycles, simulateOldLeak }) => {
    const app = window.__fw;
    const gl = app.scene3d.renderer.getContext();
    const names = [
      'createFramebuffer', 'deleteFramebuffer', 'createRenderbuffer', 'deleteRenderbuffer',
      'createTexture', 'deleteTexture',
    ];
    const calls = Object.fromEntries(names.map((name) => [name, 0]));
    const originals = new Map();
    for (const name of names) {
      const original = gl[name];
      if (typeof original !== 'function') continue;
      originals.set(name, original);
      gl[name] = function trackedGlResource(...args) {
        calls[name] += 1;
        return original.apply(gl, args);
      };
    }
    const samples = [];
    const targetStats = { observed: 0, disposed: 0 };
    const observedTargets = new WeakSet();
    const observeTargets = () => {
      app.scene3d.scene.traverse((object) => {
        const target = object.isWater ? object.renderTarget : null;
        if (!target || observedTargets.has(target)) return;
        observedTargets.add(target);
        targetStats.observed += 1;
        target.addEventListener('dispose', () => { targetStats.disposed += 1; });
      });
    };
    observeTargets();
    const tick = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const snapshot = (cycle) => {
      let waterMeshes = 0;
      app.scene3d.scene.traverse((object) => { if (object.isWater) waterMeshes += 1; });
      return {
        cycle,
        waterMeshes,
        calls: { ...calls },
        renderTargets: { ...targetStats },
        rendererMemory: { ...app.scene3d.renderer.info.memory },
      };
    };
    samples.push(snapshot(0));
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      if (simulateOldLeak) {
        app.scene3d.scene.traverse((object) => {
          if (object.isWater) object.dispose = () => {};
        });
      }
      app.scene3d.rebuildWater();
      observeTargets();
      app.scene3d.render(16.67, app.state);
      await tick();
      await tick();
      samples.push(snapshot(cycle));
    }
    for (const [name, original] of originals) gl[name] = original;
    return { samples, calls, renderTargets: targetStats };
  }, { cycles, simulateOldLeak });

  return {
    protocol: { cycles, simulateOldLeak, route: 'loaded game; rebuildWater + rendered frame per cycle' },
    ...result,
    errors,
  };
}
