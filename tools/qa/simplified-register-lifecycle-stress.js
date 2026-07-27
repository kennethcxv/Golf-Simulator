async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/simplified-register-lifecycle-stress.mjs`);
  return driver.runSimplifiedRegisterLifecycleStress(page, {
    viewport: process.env.REGISTER_QA_VIEWPORT || process.env.QA_VIEWPORT,
    cycles: process.env.REGISTER_QA_CYCLES,
  });
}
