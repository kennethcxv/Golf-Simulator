async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/simplified-register-queue-acceptance.mjs`);
  return driver.runSimplifiedRegisterQueueAcceptance(page, {
    viewport: process.env.REGISTER_QA_VIEWPORT || process.env.QA_VIEWPORT,
  });
}
