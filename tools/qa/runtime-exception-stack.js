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
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent.trim() === 'Continue');
    if (!button) throw new Error('Continue button missing');
    setTimeout(() => button.click(), 0);
  });
  await new Promise((resolve) => setTimeout(resolve, 35000));
  return { exceptions };
}
