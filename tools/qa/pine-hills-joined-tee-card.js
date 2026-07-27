async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/pine-hills-joined-tee-card-acceptance.mjs`);
  return driver.runPineHillsJoinedTeeCardAcceptance(page, {
    outputRoot: process.env.PINE_HILLS_JOINED_TEE_ROOT,
    baseUrl: process.env.QA_BASE_URL,
  });
}
