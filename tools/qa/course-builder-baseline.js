// Course-builder baseline captured through the normal Continue and J controls.
//
//   $env:QA_BASE_URL='http://localhost:8467/'
//   $env:COURSE_BUILDER_QA_PHASE='before'
//   node tools/qa/run-playwright.cjs tools/qa/course-builder-baseline.js --bootstrap
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const phase = String(process.env.COURSE_BUILDER_QA_PHASE || 'before')
    .replace(/[^a-z0-9._-]+/gi, '_');
  const outDir = path.resolve('qa/property-expansion-world-overhaul/course-builder', phase);
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8467/');
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
  await page.waitForFunction(() => window.__fw?.scene3d && window.__fw?.editorUi, null, { timeout: 45000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 15000 });
  await page.waitForTimeout(1800);

  const screenshot = path.join(outDir, '01-course-builder.png');
  await page.screenshot({ path: screenshot });
  const performance = await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    let previous = window.performance.now();
    const started = previous;
    function frame(now) {
      samples.push(now - previous);
      previous = now;
      if (now - started < 3000) return requestAnimationFrame(frame);
      const sorted = [...samples].sort((a, b) => a - b);
      const total = samples.reduce((sum, value) => sum + value, 0);
      resolve({
        averageFps: samples.length * 1000 / total,
        p99FrameMs: sorted[Math.max(0, Math.floor(sorted.length * 0.99) - 1)],
        worstFrameMs: Math.max(...samples),
        renderer: { ...window.__fw.scene3d.renderer.info.memory },
        dom: document.getElementsByTagName('*').length,
      });
    }
    requestAnimationFrame(frame);
  }));
  const state = await page.evaluate(() => ({
    active: window.__fw.editorUi().isActive(),
    tools: [...document.querySelectorAll('.ced-tool')].map((node) => node.textContent.trim()),
    topText: document.querySelector('.ced-top')?.textContent || '',
    panelText: document.querySelector('.ced-tool-panel')?.textContent || '',
  }));
  const result = {
    ok: state.active && diagnostics.length === 0 && performance.averageFps >= 30,
    phase,
    screenshot,
    state,
    performance,
    diagnostics,
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}
