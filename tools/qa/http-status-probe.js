async (page) => {
  const responses = [];
  const failures = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      responses.push({ status: response.status(), url: response.url() });
    }
  });
  page.on('requestfailed', (request) => {
    failures.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' });
  });
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  return { ok: true, responses, failures };
}
