async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/simplified-register-save-reload.mjs`);
  return driver.runSimplifiedRegisterSaveReload(page);
}
