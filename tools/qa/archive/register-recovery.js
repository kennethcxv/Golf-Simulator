async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/register-recovery-driver.mjs`);
  return driver.runRegisterRecovery(page);
}
