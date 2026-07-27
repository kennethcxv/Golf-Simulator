async (page) => {
  const BASE = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.addInitScript(() => {
    window.__shaderDiagnostics = [];
    const timer = setInterval(() => {
      const renderer = window.__fw?.scene3d?.renderer;
      if (!renderer || renderer.userData?.shaderDiagnosticInstalled) return;
      renderer.userData ||= {};
      renderer.userData.shaderDiagnosticInstalled = true;
      renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
        const source = gl.getShaderSource(fragmentShader) || '';
        const samplerLines = source.split('\n').filter((line) => /uniform\s+.*sampler/i.test(line));
        const defines = source.split('\n').filter((line) => (
          /^\s*#define\s+(?:NUM_|USE_|STANDARD|PHYSICAL)/.test(line)
        ));
        window.__shaderDiagnostics.push({
          programLog: gl.getProgramInfoLog(program) || '',
          fragmentLog: gl.getShaderInfoLog(fragmentShader) || '',
          samplerLines,
          defines,
        });
      };
      clearInterval(timer);
    }, 0);
  });
  await page.goto(BASE);
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.evaluate(() => {
    const app = window.__fw;
    app.scene3d.clubhouse().setOrganicWalkins(false);
    app.scene3d.clubhouse().clearWalkins();
    const interior = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = interior.x - 5.8;
    walk.z = interior.z + 4.6;
    walk.yaw = 2.1;
    walk.pitch = 0.25;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 1260;
    app.scene3d.applyTimeWeather(1260, app.state.weather);
    app.scene3d.scene.traverse((object) => {
      if (!object.isMesh) return;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (material) material.needsUpdate = true;
      }
    });
  });
  await page.waitForTimeout(4000);
  return page.evaluate(() => ({
    ok: true,
    errors: window.__shaderDiagnostics || [],
  }));
}
