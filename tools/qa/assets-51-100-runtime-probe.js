async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.setViewportSize({ width: 1600, height: 900 });
  const diagnostics = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => diagnostics.push({
    kind: 'requestfailed',
    message: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  }));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(12000);
  const runtime = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const result = clubhouse.assets51to100Runtime?.diagnostics?.() || null;
    const fittingRoom = clubhouse.assets51to100Runtime?.fittingRoom?.() || null;
    const interactionTargets = clubhouse.assets51to100Runtime?.interactionTargets?.() || [];
    const toolViewmodels = window.__fw.scene3d.walk.toolViewmodelDiagnostics?.() || null;
    const roots = [];
    clubhouse.interior.traverse((object) => {
      if (object.userData?.assetRuntime) {
        roots.push({
          name: object.name,
          visible: object.visible,
          parent: object.parent?.name || null,
          position: object.position.toArray(),
          assetRuntime: object.userData.assetRuntime,
        });
      }
    });
    return { result, fittingRoom, interactionTargets, toolViewmodels, roots };
  });
  return {
    ok: runtime.result?.placed === 40
      && runtime.result?.failed === 0
      && runtime.fittingRoom?.structuralColliders === 4
      && runtime.fittingRoom?.curtainColliderActive === true
      && runtime.interactionTargets.length === 22
      && runtime.toolViewmodels?.authoredCount === 9,
    runtime,
    diagnostics,
  };
}
