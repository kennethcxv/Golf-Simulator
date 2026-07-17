async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/register-acceptance-driver.mjs`);
  return driver.runRegisterAcceptance(page, 'card');
}
