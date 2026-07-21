async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/checkout-card-gtao-visual-ab.mjs`);
  return driver.runCheckoutCardGtaoVisualAb(page);
}
