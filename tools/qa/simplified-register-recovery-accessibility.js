async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/simplified-register-recovery-accessibility.mjs`);
  return driver.runRecoveryAccessibilityAudit(page);
}
