async (page) => {
  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(base);
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40_000 });
  await page.waitForTimeout(2200);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 - 8;
    walk.z = 5.10 + 228;
    walk.yaw = 0;
    walk.pitch = -0.18;

    const renderer = app.scene3d.renderer;
    const gameScene = app.scene3d.scene;
    const probe = window.__renderPassProbe = { frames: [], current: null };
    const originalRender = renderer.render;
    renderer.render = function passProbe(renderable, camera) {
      const before = {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        shadowNeedsUpdate: renderer.shadowMap.needsUpdate,
      };
      const override = renderable === gameScene ? gameScene.overrideMaterial?.name || null : null;
      const result = originalRender.call(this, renderable, camera);
      if (probe.current) {
        probe.current.push({
          kind: renderable === gameScene ? (override ? `scene:${override}` : 'scene:beauty') : 'fullscreen',
          before,
          after: {
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            shadowNeedsUpdate: renderer.shadowMap.needsUpdate,
          },
          shadowAutoUpdate: renderer.shadowMap.autoUpdate,
        });
      }
      return result;
    };
    const gameRender = app.scene3d.render;
    app.scene3d.render = function gameFrameProbe(...args) {
      const frame = [];
      probe.current = frame;
      try {
        return gameRender.apply(this, args);
      } finally {
        probe.current = null;
        probe.frames.push(frame);
        if (probe.frames.length > 30) probe.frames.shift();
      }
    };
  });

  const snapshot = async () => {
    await page.waitForTimeout(250);
    return page.evaluate(() => {
      const frames = window.__renderPassProbe.frames.filter((frame) => frame.length);
      const frame = frames.at(-1) || [];
      return {
        calls: frame,
        sumCalls: frame.reduce((sum, pass) => sum + pass.after.calls, 0),
        sumTriangles: frame.reduce((sum, pass) => sum + pass.after.triangles, 0),
        scene: {
          meshes: [...window.__fw.scene3d.scene.children].length,
          registerActive: window.__fw.scene3d.clubhouse().register.isActive(),
        },
      };
    });
  };

  const idle = await snapshot();
  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.sendToCounter(['balls3', 'glove1'], 'card');
  });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.hasTx());
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive());
  const active = await snapshot();
  return { idle, active };
}
