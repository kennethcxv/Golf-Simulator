async (page) => {
  const exceptions = [];
  const session = await page.context().newCDPSession(page);
  await session.send('Runtime.enable');
  session.on('Runtime.exceptionThrown', ({ exceptionDetails }) => exceptions.push({
    text: exceptionDetails.text,
    url: exceptionDetails.url,
    lineNumber: exceptionDetails.lineNumber,
    columnNumber: exceptionDetails.columnNumber,
    description: exceptionDetails.exception?.description || null,
    stackTrace: exceptionDetails.stackTrace || null,
  }));
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  return {
    exceptions,
    title: await page.title(),
    continueCount: await page.getByText('Continue', { exact: true }).count(),
    body: (await page.locator('body').innerText()).slice(0, 2000),
  };
}
