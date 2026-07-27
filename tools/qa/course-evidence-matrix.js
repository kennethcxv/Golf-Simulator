// The course completion evidence matrix: every hole from every camera preset,
// every lighting preset, and every supported resolution.
//
// This is a capture-and-report driver, not an acceptance gate. It makes no
// edits. Its job is to put the whole course in front of a human (and to fail
// loudly if a hole cannot be framed or a preset cannot be reached at all).
//
//   node tools/qa/run-playwright.cjs tools/qa/course-evidence-matrix.js --bootstrap
//
// OUT_DIR defaults to qa/course_master_final/claude_completion.

async function courseEvidenceMatrix(page) {
  const root = process.env.OUT_DIR || 'qa/course_master_final/claude_completion';
  const starterCourseGate = process.env.STARTER_COURSE_QA === '1';

  const errors = [];
  const warnings = [];
  const requestFailures = [];
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (request) => requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.goto('http://localhost:8457/');
  await page.waitForFunction(() => document.readyState === 'complete');
  const cont = page.locator('button.menu-action-primary').filter({
    has: page.locator('.menu-action-label', { hasText: /^Continue$/ }),
  });
  await cont.waitFor({ state: 'visible', timeout: 60000 });
  await cont.click({ timeout: 30000 });
  await page.waitForFunction(
    () => window.__fw?.state?.course?.vec && window.__fw?.scene3d && window.__fw?.editorUi?.(),
    null,
    { timeout: 90000 },
  );
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });

  const waitForAssetBarrier = () => page.evaluate(async () => {
    const barrier = window.__fw?.scene3d?.assetBarrier?.(60000);
    if (!barrier) return { supported: false, completed: null };
    if (barrier.idle) return { supported: true, completed: true };
    return { supported: true, completed: await barrier.promise !== false };
  });
  // The editor disposes the clubhouse scene. Let every requested clubhouse GLB
  // finish first so the normal J-key transition cannot cancel a healthy load.
  const clubhouseAssetBarrier = await waitForAssetBarrier();

  // Deterministic weather so a rerun is comparable frame for frame.
  await page.evaluate(() => {
    const w = window.__fw.state.weather;
    w.locked = true;
    w.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
  });

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 60000 });
  await page.locator('.ced-root').waitFor({ state: 'visible' });
  const editorAssetBarrier = await waitForAssetBarrier();
  await page.waitForTimeout(1500);

  const shots = [];
  const shoot = async (path) => {
    await page.screenshot({ path });
    shots.push(path);
  };

  const courseEvidence = await page.evaluate(async () => {
    const { ZONE, ZONE_NAMES } = await import('/src/sim/constants.js');
    const { holeDistanceYd, holePar } = await import('/src/sim/course.js');
    const course = window.__fw.state.course;
    const surfaceCells = Object.fromEntries(ZONE_NAMES.map((name) => [name, 0]));
    for (const zone of course.zones) surfaceCells[ZONE_NAMES[zone]] += 1;
    return {
      holeCount: course.holes.length,
      holes: course.holes.map((hole, index) => ({
        number: index + 1,
        name: hole.name,
        par: holePar(hole),
        yardage: Math.round(holeDistanceYd(hole)),
      })),
      dirtCells: surfaceCells[ZONE_NAMES[ZONE.DIRT]],
      dirtCoveragePercent: Number((
        (surfaceCells[ZONE_NAMES[ZONE.DIRT]] / course.zones.length) * 100
      ).toFixed(2)),
      surfaceCells,
    };
  });
  const { holeCount } = courseEvidence;
  if (starterCourseGate && holeCount !== 3) {
    problems.push(`starter course: expected 3 holes, found ${holeCount}`);
  }
  if (starterCourseGate && courseEvidence.dirtCells < 1) {
    problems.push('starter course: expected authored dirt cells, found none');
  }

  async function selectHole(index) {
    await page.locator('.ced-holechip').click();
    const cards = page.locator('.ced-holecard');
    if (await cards.count() <= index) {
      problems.push(`hole ${index + 1}: no hole card to select`);
      await page.keyboard.press('Escape');
      return false;
    }
    await cards.nth(index).click();
    const frame = page.getByRole('button', { name: 'Frame it', exact: true });
    if (await frame.count()) await frame.click();
    try {
      await page.waitForFunction(
        (n) => document.querySelector('.ced-holechip')?.textContent.includes(`Hole ${n}`),
        index + 1,
        { timeout: 15000 },
      );
    } catch (_) {
      problems.push(`hole ${index + 1}: chip never reported the selection`);
      return false;
    }
    await page.waitForTimeout(900);
    return true;
  }

  async function view(mode, settle = 1500) {
    await page.locator('.ced-camera').selectOption(mode);
    await page.waitForTimeout(settle);
  }

  // ---- every hole, every per-hole camera preset ----------------------------
  const HOLE_VIEWS = [
    ['frame-hole', 'aerial'],
    ['tee', 'tee'],
    ['fairway', 'fairway'],
    ['approach', 'approach'],
    ['green', 'green'],
  ];
  for (let i = 0; i < holeCount; i++) {
    if (!(await selectHole(i))) continue;
    const dir = `${root}/hole_${String(i + 1).padStart(2, '0')}`;
    for (const [mode, name] of HOLE_VIEWS) {
      await view(mode);
      await shoot(`${dir}/${name}.png`);
    }
    await view('ground-preview');
    await shoot(`${root}/ground_level/hole_${String(i + 1).padStart(2, '0')}_ground.png`);
  }

  // ---- lighting presets on the course overview -----------------------------
  await selectHole(0);
  for (const preset of ['day', 'morning', 'golden', 'overcast']) {
    await page.locator('.ced-light').selectOption(preset);
    await page.waitForTimeout(1400);
    await view('course-overview', 1600);
    await shoot(`${root}/lighting/${preset}.png`);
  }
  await page.locator('.ced-light').selectOption('day');
  await page.waitForTimeout(1200);

  // ---- supported resolutions ----------------------------------------------
  const RESOLUTIONS = [[1280, 720], [1600, 900], [1920, 1080]];
  for (const [w, h] of RESOLUTIONS) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1400);
    await view('frame-hole', 1500);
    await shoot(`${root}/resolutions/${w}x${h}_hole1.png`);
    await view('course-overview', 1500);
    await shoot(`${root}/resolutions/${w}x${h}_overview.png`);
    // A hole must stay readable with the tool rail over it.
    const covered = await page.evaluate(() => {
      const rail = document.querySelector('.ced-tool-rail') || document.querySelector('.ced-left');
      if (!rail) return null;
      const r = rail.getBoundingClientRect();
      return +(((r.width * r.height) / (window.innerWidth * window.innerHeight)) * 100).toFixed(1);
    });
    if (covered !== null && covered > 25) {
      problems.push(`${w}x${h}: editor chrome covers ${covered}% of the viewport`);
    }
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);

  const unexpectedWarnings = warnings.filter(
    (message) => !/PCFSoftShadowMap has been deprecated/i.test(message),
  );
  // Chrome reports lazy GLBs that are still in flight when the isolated QA
  // context closes as ERR_ABORTED. Preserve those cancellations in evidence,
  // but gate only failures that reached an actual network/HTTP error.
  const requestAborts = requestFailures.filter(
    (entry) => /ERR_ABORTED|NS_BINDING_ABORTED/i.test(entry.error),
  );
  const blockingRequestFailures = requestFailures.filter(
    (entry) => !/ERR_ABORTED|NS_BINDING_ABORTED/i.test(entry.error),
  );
  return {
    ok: problems.length === 0 && errors.length === 0
      && blockingRequestFailures.length === 0 && unexpectedWarnings.length === 0,
    suite: 'course-evidence-matrix',
    starterCourseGate,
    assetBarriers: { clubhouse: clubhouseAssetBarrier, editor: editorAssetBarrier },
    holeCount,
    courseEvidence,
    captured: shots.length,
    problems,
    consoleErrors: errors.slice(0, 20),
    consoleWarnings: warnings.slice(0, 20),
    unexpectedWarnings: unexpectedWarnings.slice(0, 20),
    requestFailures: blockingRequestFailures.slice(0, 20),
    requestAborts: requestAborts.slice(0, 20),
    shots,
  };
}
