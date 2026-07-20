async (page) => {
  // Boot diagnostics through the same Continue control a returning player uses.
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const errs = [];
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errs.push(message.text().slice(0, 300));
    if (message.type() === 'warning') warnings.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => {
    errs.push(`PAGEERROR: ${(error.stack || error.message).slice(0, 500)}`);
  });

  await page.goto(baseUrl);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForFunction(() => document.readyState === 'complete');
  const menuState = await page.evaluate(() => ({
    hasFw: !!window.__fw,
    screen: window.__fw?.screen ?? null,
    buttons: [...document.querySelectorAll('button')]
      .map((button) => button.textContent.trim()).slice(0, 12),
  }));

  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  await continueButton.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent.trim() === 'Continue');
    return !!button && !button.disabled;
  });
  await continueButton.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1000);

  const after = await page.evaluate(() => ({
    screen: window.__fw?.screen ?? null,
    hasScene: !!window.__fw?.scene3d,
    hasClubhouse: !!window.__fw?.scene3d?.clubhouse?.(),
    veil: (() => {
      const veil = document.querySelector('.load-veil');
      return veil ? `${getComputedStyle(veil).display}/${getComputedStyle(veil).opacity}` : 'none';
    })(),
    rendererContextLost: window.__fw?.scene3d?.renderer?.getContext?.().isContextLost?.() ?? null,
  }));
  const ok = menuState.hasFw
    && after.hasScene
    && after.hasClubhouse
    && after.rendererContextLost === false
    && errs.length === 0;
  return {
    ok,
    menuState,
    after,
    errs: errs.slice(0, 10),
    warnings: warnings.slice(0, 10),
  };
}
