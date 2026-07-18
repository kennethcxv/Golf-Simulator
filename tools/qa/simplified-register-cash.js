async (page) => {
  const driver = await import('./simplified-register-acceptance.mjs');
  const query = new URL(page.url()).searchParams;
  return driver.runSimplifiedRegisterAcceptance(page, 'cash', {
    viewport: query.get('registerQaViewport') || undefined,
    root: query.get('registerQaRoot') || undefined,
  });
}
