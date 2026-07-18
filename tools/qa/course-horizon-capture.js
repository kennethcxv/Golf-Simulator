// Capture the views that expose the property boundary.
//
// The course overview and a low ground-level look outward are the two frames
// where a slab-edged property, a flat dead surround or a bare horizon show up.
// Screenshots only — this driver makes no edits.
//
//   node tools/qa/run-playwright.cjs tools/qa/course-horizon-capture.js --bootstrap
//
// OUT_DIR controls where the frames land.

async function courseHorizonCapture(page) {
  const outDir = process.env.OUT_DIR || 'qa/course_master_final/claude_completion/horizon';

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('http://localhost:8457/');
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

  // Fixed weather so successive captures are comparable.
  await page.evaluate(() => {
    const w = window.__fw.state.weather;
    w.locked = true;
    w.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
  });

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 60000 });
  await page.locator('.ced-root').waitFor({ state: 'visible' });
  await page.waitForTimeout(1800);

  const shots = [];
  async function shoot(name, mode, settle = 2200) {
    if (mode) {
      await page.locator('.ced-camera').selectOption(mode);
      await page.waitForTimeout(settle);
    }
    const p = `${outDir}/${name}.png`;
    await page.screenshot({ path: p });
    shots.push({ name, mode, path: p });
  }

  await shoot('01_course_overview', 'course-overview');
  await shoot('02_ground_preview', 'ground-preview');
  await shoot('03_tee_view', 'tee');
  await shoot('04_green_view', 'green');

  // Push the rig low and outward: the boundary is most exposed looking off the
  // property from close to the deck, which no built-in preset frames.
  await page.evaluate(() => {
    const sc = window.__fw.scene3d;
    const rig = sc.cameraRig || sc.rig;
    if (rig) {
      rig.pitch = 0.06;
      rig.dist = 210;
      rig.yaw = 0.9;
      if (rig.target) { rig.target.x = -380; rig.target.z = -300; }
    }
  });
  await page.waitForTimeout(1600);
  await shoot('05_boundary_low_angle', null);

  return {
    ok: errors.length === 0,
    suite: 'course-horizon-capture',
    shots,
    consoleErrors: errors.slice(0, 10),
  };
}
