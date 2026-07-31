async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`${message.type()}:${message.text()}`);
    }
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const result = await page.evaluate(() => {
    const scene = window.__fw.scene3d;
    const clubhouse = scene.clubhouse();
    const lights = [];
    clubhouse.interior.traverse((object) => {
      if (!object.isLight || !/CeilingPanelLight/.test(object.name || '')) return;
      lights.push({
        name: object.name,
        type: object.type,
        visible: object.visible,
        intensity: object.intensity,
        backend: object.userData?.lightingBackend || null,
      });
    });
    return {
      maxTextures: scene.renderer?.capabilities?.maxTextures ?? null,
      maxVertexTextures: scene.renderer?.capabilities?.maxVertexTextures ?? null,
      lights,
    };
  });
  return { ok: true, result, diagnostics };
}
