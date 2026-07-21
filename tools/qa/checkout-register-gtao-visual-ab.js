// Recommended: $env:HEADED='1'; node tools/qa/run-playwright.cjs tools/qa/checkout-register-gtao-visual-ab.js --bootstrap
async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/checkout-register-gtao-visual-ab.mjs`);
  return driver.runCheckoutRegisterGtaoVisualAb(page);
}
