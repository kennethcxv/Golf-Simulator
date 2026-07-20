async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/simplified-register-performance.mjs`);
  return driver.runSimplifiedRegisterPerformance(page, {
    viewport: process.env.REGISTER_PERF_VIEWPORT
      || process.env.REGISTER_QA_VIEWPORT
      || process.env.QA_VIEWPORT,
  });
}
