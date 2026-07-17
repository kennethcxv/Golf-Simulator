async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/simplified-register-acceptance.mjs`);
  return driver.runSimplifiedRegisterAcceptance(page, 'cash', {
    viewport: process.env.REGISTER_QA_VIEWPORT || process.env.QA_VIEWPORT,
  });
}
