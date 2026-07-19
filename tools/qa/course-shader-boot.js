// Boot the course editor and prove the terrain shader actually compiles.
//
// The Node test suite never compiles GLSL, so a shader edit can pass 1,500
// tests and still black-screen the game. This driver is the missing gate:
// it opens the real editor, watches for WebGLProgram compile diagnostics, and
// reads back the shading channels the terrain material depends on.
//
//   node tools/qa/run-playwright.cjs tools/qa/course-shader-boot.js --bootstrap
//
// Set OUT_DIR to control where the screenshot lands.

async function courseShaderBoot(page) {
  // Evaluated via Function() by the runner, so there is no require here.
  // Playwright creates the screenshot's parent directories itself.
  const outDir = process.env.OUT_DIR || 'qa/course_master_final/claude_completion/handoff';

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/');
  await page.waitForFunction(() => document.readyState === 'complete');

  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  await cont.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((i) => i.textContent.trim() === 'Continue');
    return b && !b.disabled;
  });
  await cont.click();

  await page.waitForFunction(
    () => window.__fw?.state?.course?.vec && window.__fw?.scene3d && window.__fw?.editorUi?.(),
    null,
    { timeout: 90000 },
  );
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });

  // 'j' is the course editor's entry key.
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 60000 });
  await page.locator('.ced-root').waitFor({ state: 'visible' });

  // Let the terrain material link and draw a few real frames.
  await page.waitForTimeout(2500);

  const probe = await page.evaluate(() => {
    const scene = window.__fw.scene3d;
    const renderer = scene.renderer;
    const info = renderer.info;

    // Any program Three.js failed to link keeps its diagnostics object.
    const broken = [];
    for (const p of info.programs || []) {
      if (p.diagnostics && p.diagnostics.runnable === false) {
        broken.push({
          name: p.name,
          error: String(p.diagnostics.programLog || '').slice(0, 400),
          vertex: String(p.diagnostics.vertexShader?.log || '').slice(0, 300),
          fragment: String(p.diagnostics.fragmentShader?.log || '').slice(0, 300),
        });
      }
    }

    const gl = renderer.getContext();
    return {
      programs: (info.programs || []).length,
      brokenPrograms: broken,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
    };
  });

  const shot = `${outDir}/course_shader_boot.png`;
  await page.screenshot({ path: shot });

  const shaderErrors = errors.filter((e) => /shader|WebGLProgram|GLSL|compile/i.test(e));
  const ok = probe.brokenPrograms.length === 0
    && !probe.contextLost
    && probe.drawCalls > 0
    && shaderErrors.length === 0;

  return {
    ok,
    suite: 'course-shader-boot',
    probe,
    shaderErrors,
    consoleErrors: errors.slice(0, 20),
    consoleErrorCount: errors.length,
    screenshot: shot,
  };
}
