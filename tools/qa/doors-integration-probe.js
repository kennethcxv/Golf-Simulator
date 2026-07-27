async (page) => {
  const messages = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}\n${error.stack || ''}`));
  page.on('requestfailed', (request) => messages.push(
    `requestfailed: ${request.url()} ${request.failure()?.errorText || ''}`,
  ));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  const continueButton = page.getByText('Continue', { exact: true });
  if (await continueButton.count()) await continueButton.click().catch(() => {});
  await page.waitForTimeout(12000);
  const state = await page.evaluate(() => {
    const scene = window.__fw?.scene3d || null;
    const clubhouse = scene?.clubhouse?.() || null;
    return {
      url: location.href,
      title: document.title,
      fw: Boolean(window.__fw),
      screen: window.__fw?.screen || null,
      scene: Boolean(scene),
      clubhouse: Boolean(clubhouse),
      veil: document.querySelector('.load-veil')?.getAttribute('style') || null,
      bodyText: document.body.innerText.slice(0, 500),
      architecturalDoors: clubhouse?.architecturalDoors?.diagnostics?.() || null,
      sheet06: clubhouse?.sheet06Production?.diagnostics?.() || null,
    };
  });
  return { state, messages };
}
