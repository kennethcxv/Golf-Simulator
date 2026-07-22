async (page) => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/simplified-register-lifecycle-stress.mjs`);
  const provenance = await import(pathToFileURL(
    path.resolve('tools/qa/capture-39-lifecycle-provenance.mjs'),
  ).href);
  const evidenceRoot = path.resolve(process.env.REGISTER_QA_ROOT
    || 'qa/cashier_master_final/lifecycle/browser');
  const buildBefore = path.join(evidenceRoot, 'build-before.json');
  const buildAfter = path.join(evidenceRoot, 'build-after.json');
  const runnerResult = path.join(evidenceRoot, 'runner-result.json');
  const protectedOutputs = [
    buildBefore,
    buildAfter,
    runnerResult,
    path.join(evidenceRoot, 'lifecycle-result.json'),
    path.join(evidenceRoot, 'lifecycle-summary.md'),
    path.join(evidenceRoot, 'lifecycle-resource-details.json'),
    path.join(evidenceRoot, 'lifecycle-metrics.png'),
    path.join(evidenceRoot, provenance.CAPTURE_39_PROVENANCE_FILE),
  ];
  const existing = protectedOutputs.filter((file) => fs.existsSync(file));
  if (existing.length) {
    throw new Error(`Lifecycle evidence root must be fresh; refusing to overwrite: ${existing.join(', ')}`);
  }
  const requestedRunnerResult = process.env.QA_RESULT_PATH
    ? path.resolve(process.env.QA_RESULT_PATH) : runnerResult;
  if (requestedRunnerResult !== runnerResult) {
    throw new Error(`QA_RESULT_PATH must be ${runnerResult} for Capture #39 provenance.`);
  }
  fs.mkdirSync(evidenceRoot, { recursive: true });
  process.env.QA_RESULT_PATH = runnerResult;
  provenance.writeCashierBuildSnapshotFile({ outputPath: buildBefore });
  try {
    return await driver.runSimplifiedRegisterLifecycleStress(page, {
      root: evidenceRoot,
      viewport: process.env.REGISTER_QA_VIEWPORT || process.env.QA_VIEWPORT,
      cycles: process.env.REGISTER_QA_CYCLES,
    });
  } finally {
    provenance.writeCashierBuildSnapshotFile({ outputPath: buildAfter });
  }
}
