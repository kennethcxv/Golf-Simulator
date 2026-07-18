async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/checkout-card-spike-probe.mjs`);
  return driver.runCheckoutCardSpikeProbe(page);
}
