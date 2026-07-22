async (page) => {
  const responses = [];
  page.on('response', (response) => {
    if (response.status() >= 400) responses.push({ status: response.status(), url: response.url() });
  });
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  const diagnostics = await page.evaluate(async () => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    await clubhouse.sheet06ProductionReady();
    return clubhouse.sheet06Production.diagnostics();
  });
  return {
    ok: responses.length === 0
      && diagnostics.actualSharedGameIntegrated === true
      && diagnostics.activationStatus === 'active',
    responses,
    diagnostics,
  };
}
