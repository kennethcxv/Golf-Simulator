async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/checkout-terminal-canvas-hotpath.mjs`);
  return driver.runCheckoutTerminalCanvasHotpath(page);
}
