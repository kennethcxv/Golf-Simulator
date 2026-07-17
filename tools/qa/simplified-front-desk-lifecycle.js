async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/simplified-front-desk-lifecycle-acceptance.mjs`);
  return driver.runSimplifiedFrontDeskLifecycleAcceptance(page, {
    viewport: process.env.LIFECYCLE_QA_VIEWPORT
      || process.env.RESERVATION_QA_VIEWPORT
      || process.env.REGISTER_QA_VIEWPORT
      || process.env.QA_VIEWPORT,
  });
}
