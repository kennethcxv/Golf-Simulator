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
  const imported = await page.evaluate(async () => {
    try {
      const module = await import('/src/sim/empire.js');
      return { ok: true, exports: Object.keys(module) };
    } catch (error) {
      return {
        ok: false,
        name: error?.name || null,
        message: error?.message || String(error),
        stack: error?.stack || null,
      };
    }
  });
  await page.waitForTimeout(1000);
  return { imported, exceptions };
}
