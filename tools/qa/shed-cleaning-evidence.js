// SHED-CLEANING EVIDENCE — the Stage-1 baseline capture.
//
// A fixed, re-runnable screenshot matrix of the nine first-person cleaning tools (idle pose,
// working stance, and mid-use), the two world props that anchor the cleaning bay, an
// end-of-cycle belt-stability shot, and a palette reference strip. This is the "before" a later
// cleaning-presentation polish pass gets measured against. It captures artifacts and writes a
// blank scoring rubric only — nothing here judges whether a tool looks good, only that the same
// fixed pose produced a picture of it, every time this is re-run.
//
// Conventions reused verbatim from tools/qa/cleaning-tools-acceptance.js: the boot handshake, the
// indoor player pose and debris-ring seeding, the setTool/setSpraying fixture calls, and the
// pageerror/console-error collection. That collection only listens for console messages of
// type() === 'error', so the advisory ANGLE X4000 shader warning — a 'warning', never an 'error'
// — is never collected, exactly how that driver already tolerates it.
//
// The washer is an outdoor tool. Its three shots reuse the siding-facing pose from
// tools/qa/pressure-washer-acceptance.js instead of the indoor floor pitches the other eight
// tools use.
//
// Run with: node tools/qa/run-playwright.cjs tools/qa/shed-cleaning-evidence.js --bootstrap
// (a fresh browser context has no save, and the menu's Continue button stays disabled without
// one — see run-playwright.cjs's --bootstrap handling).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const childProcess = process.getBuiltinModule('node:child_process');
  const repo = process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.SHED_EVIDENCE_QA_ROOT
    || path.join(repo, 'qa', 'shed_stage1', 'evidence', 'iter0'));
  fs.mkdirSync(out, { recursive: true });

  let commit = 'unknown';
  try {
    commit = childProcess.execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
  } catch (_) { /* leave 'unknown' — a missing git binary should not fail the capture */ }

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(async () => {
    await window.__fw.scene3d.clubhouse().sheet06ProductionReady?.();
  });
  // Grace period before checking the veil: production can report ready before the veil element
  // itself is even in the DOM, which reads as "already gone" and screenshots the loading screen.
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    if (!v) return true;
    const cs = getComputedStyle(v);
    return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.02;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(500);

  // --- registry data, read from the game's own source of truth, not hardcoded here -------------
  const FALLBACK_TOOL_ORDER = [
    'washer', 'vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag',
  ];
  const TOOL_ORDER = await page.evaluate(async (fallback) => {
    try {
      const mod = await import('/src/data/cleaningTools.js');
      const order = (mod.BELT_ORDER || []).filter(Boolean);
      return order.length ? order : fallback;
    } catch (_) {
      return fallback;
    }
  }, FALLBACK_TOOL_ORDER);
  // The full material palette, not a hand-picked subset — "label each swatch with its key name"
  // only makes sense read straight off PALETTE's own keys.
  const PALETTE_ENTRIES = await page.evaluate(async () => {
    const mod = await import('/src/data/cleaningTools.js');
    return Object.entries(mod.PALETTE || {}).map(([key, spec]) => ({
      key,
      hex: `#${(spec.color >>> 0).toString(16).padStart(6, '0')}`,
    }));
  });

  const nnFor = (toolId) => String(TOOL_ORDER.indexOf(toolId) + 1).padStart(2, '0');

  // --- world props dressed alongside the belt tools: asset 73 (mop bucket), asset 78 (washer) --
  const WORLD_PROPS = [
    { asset: 73, tool: 'mop', slug: 'mop-bucket' },
    { asset: 78, tool: 'washer', slug: 'washer-base' },
  ];

  // --- planned shot list, fixed before a single frame is captured --------------------------------
  const plannedShots = [];
  for (const tool of TOOL_ORDER) {
    const nn = nnFor(tool);
    plannedShots.push(`${nn}-${tool}-a-idle.png`, `${nn}-${tool}-b-work.png`, `${nn}-${tool}-c-use.png`);
  }
  for (const spec of WORLD_PROPS) plannedShots.push(`${nnFor(spec.tool)}-${spec.slug}-d-world.png`);
  plannedShots.push('90-belt-cycle.png', '91-palette-reference.png');

  const shots = [];
  const shoot = async (name) => {
    await page.screenshot({ path: path.join(out, name) });
    shots.push(name);
  };

  // --- pose helpers -------------------------------------------------------------------------------
  const setPitch = (pitch) => page.evaluate((p) => {
    window.__fw.scene3d.walk.state.pitch = p;
  }, pitch);

  const applyMidday = () => page.evaluate(() => {
    const app = window.__fw;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
  });

  // Open floor, west of the front counter — cleaning-tools-acceptance.js's stance.
  const INDOOR_PLAYER_LOCAL = { x: -5.5, z: 3.2 };
  const faceIndoor = async () => {
    await page.evaluate((local) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      const o = app.scene3d.clubhouse().interior.position;
      walk.state.x = o.x + local.x;
      walk.state.z = o.z + local.z;
      walk.state.yaw = 0;
    }, INDOOR_PLAYER_LOCAL);
    await applyMidday();
  };

  // Outside, south of the building, aimed at the siding east of the door — the exact pose
  // pressure-washer-acceptance.js proved the water jet actually reaches.
  const WASHER_POSE = { x: 5.6, z: 9.2, tx: 5.6, tz: 6.5, pitch: 0.06 };
  const faceWasherPose = async () => {
    await page.evaluate((s) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      const origin = app.scene3d.clubhouse().interior.position;
      walk.state.x = origin.x + s.x;
      walk.state.z = origin.z + s.z;
      const dx = (origin.x + s.tx) - walk.state.x;
      const dz = (origin.z + s.tz) - walk.state.z;
      const d = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / d, -dz / d);
      walk.state.pitch = s.pitch;
    }, WASHER_POSE);
    await applyMidday();
    await page.waitForTimeout(400);
  };

  // ~2 yd off the prop's own local centre, offset into open stockroom floor rather than toward
  // the west partition or the office doorway that both the bucket and the machine sit close to.
  const WORLD_PROP_OFFSET = { dx: 1.6, dz: -1.15 };
  const WORLD_PROP_PITCH = -0.35;
  const worldPropLocalCenter = (assetNumber) => page.evaluate(async (n) => {
    const THREE = await import('three');
    const ch = window.__fw.scene3d.clubhouse();
    await ch.assets51to100Runtime.ready;
    const root = ch.assets51to100Runtime.getRoot(n);
    if (!root) return null;
    const box = new THREE.Box3().setFromObject(root);
    const c = ch.interior.worldToLocal(box.getCenter(new THREE.Vector3()));
    return { x: +c.x.toFixed(3), z: +c.z.toFixed(3) };
  }, assetNumber);
  const faceWorldProp = async (center) => {
    await page.evaluate(({ target, offset, pitch }) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      const origin = app.scene3d.clubhouse().interior.position;
      const camX = target.x + offset.dx;
      const camZ = target.z + offset.dz;
      walk.state.x = origin.x + camX;
      walk.state.z = origin.z + camZ;
      const dx = (origin.x + target.x) - walk.state.x;
      const dz = (origin.z + target.z) - walk.state.z;
      const d = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / d, -dz / d);
      walk.state.pitch = pitch;
    }, { target: center, offset: WORLD_PROP_OFFSET, pitch: WORLD_PROP_PITCH });
    await applyMidday();
    await page.waitForTimeout(400);
  };

  // --- indoor stance + the reference driver's own debris ring, seeded once ----------------------
  await faceIndoor();
  await setPitch(-0.62);
  await page.waitForTimeout(600);
  await page.evaluate((PLAYER_LOCAL) => {
    const list = window.__fw.state.shop.reno.debris;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      list.push({
        x: +(PLAYER_LOCAL.x + Math.cos(a) * 0.42).toFixed(3),
        z: +(PLAYER_LOCAL.z - 0.75 + Math.sin(a) * 0.42).toFixed(3),
        a: 0.22,
      });
    }
  }, INDOOR_PLAYER_LOCAL);
  await page.waitForTimeout(200);

  // --- per-tool matrix: idle / working stance / mid-use ------------------------------------------
  const PITCH_IDLE = -0.10;
  const PITCH_WORK = -0.62;
  const SETTLE_A_MS = 400;
  const SETTLE_B_MS = 400;
  const USE_MS = 800;
  const RELEASE_SETTLE_MS = 150;

  for (const tool of TOOL_ORDER) {
    const nn = nnFor(tool);
    const isWasher = tool === 'washer';

    if (isWasher) {
      await faceWasherPose();
    } else {
      await faceIndoor();
      await setPitch(PITCH_IDLE);
    }
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), tool);
    await page.waitForTimeout(SETTLE_A_MS);
    await shoot(`${nn}-${tool}-a-idle.png`);

    if (!isWasher) await setPitch(PITCH_WORK);
    await page.waitForTimeout(SETTLE_B_MS);
    await shoot(`${nn}-${tool}-b-work.png`);

    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
    await page.waitForTimeout(USE_MS);
    await shoot(`${nn}-${tool}-c-use.png`);
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
    await page.waitForTimeout(RELEASE_SETTLE_MS);
  }

  // --- world-prop context shots: asset 73 (mop bucket) and asset 78 (washer base) ----------------
  for (const spec of WORLD_PROPS) {
    const center = await worldPropLocalCenter(spec.asset);
    if (!center) continue; // left for the missing-shot check below to catch and fail on
    await faceWorldProp(center);
    await shoot(`${nnFor(spec.tool)}-${spec.slug}-d-world.png`);
  }

  // --- belt-cycle stability shot -------------------------------------------------------------------
  const BELT_STEP_MS = 250;
  await faceIndoor();
  await setPitch(PITCH_WORK);
  await page.waitForTimeout(300);
  for (const tool of TOOL_ORDER) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), tool);
    await page.waitForTimeout(BELT_STEP_MS);
  }
  await shoot('90-belt-cycle.png');
  const beltCycle = await page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    let visibleToolMeshes = 0;
    scene.traverse((o) => {
      if (o.name && o.name.startsWith('Tool_') && o.visible) visibleToolMeshes += 1;
    });
    return { visibleToolMeshes, withinTolerance: visibleToolMeshes <= 1 };
  });

  // --- palette reference strip ----------------------------------------------------------------------
  const STRIP_ID = 'qa-shed-palette-strip';
  await page.evaluate(({ entries, id }) => {
    const strip = document.createElement('div');
    strip.id = id;
    strip.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;'
      + 'display:flex;flex-wrap:wrap;align-items:center;background:rgba(12,14,12,0.88);'
      + 'padding:6px 8px;gap:2px 10px;font:11px/1.3 monospace;color:#f4f2e8;';
    for (const { key, hex } of entries) {
      const chip = document.createElement('div');
      chip.style.cssText = 'display:flex;align-items:center;gap:5px;';
      const sw = document.createElement('span');
      sw.style.cssText = 'display:inline-block;width:16px;height:16px;'
        + `border:1px solid rgba(255,255,255,0.6);background:${hex};`;
      const label = document.createElement('span');
      label.textContent = `${key} ${hex}`;
      chip.append(sw, label);
      strip.appendChild(chip);
    }
    document.body.appendChild(strip);
  }, { entries: PALETTE_ENTRIES, id: STRIP_ID });
  await page.waitForTimeout(200);
  await shoot('91-palette-reference.png');
  await page.evaluate((id) => { document.getElementById(id)?.remove(); }, STRIP_ID);

  // --- rubric skeleton -------------------------------------------------------------------------------
  const viewport = page.viewportSize();
  const rubricLines = [
    '# Shed cleaning — Stage-1 evidence rubric (iter0)',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Commit: ${commit}`,
    `- Viewport: ${viewport ? `${viewport.width}x${viewport.height}` : 'unknown'}`,
    `- Shot count: ${plannedShots.length}`,
    '',
    'Blank until the polish pass lands. Score 1-5 per axis, or leave blank for "not yet assessed."',
    '',
    '## Shot list',
    '',
    ...plannedShots.map((name) => `- ${name}`),
    '',
    '## Scoring grid',
    '',
    '| Tool | Silhouette | Palette | Grip-contact | Working-point | Composition | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...TOOL_ORDER.map((tool) => `| ${tool} |  |  |  |  |  |  |`),
    '',
  ];
  const rubricPath = path.join(out, 'rubric.md');
  fs.writeFileSync(rubricPath, `${rubricLines.join('\n')}\n`);

  // --- final gate: every planned file present, zero page/console errors --------------------------
  const missingShots = plannedShots.filter((name) => !fs.existsSync(path.join(out, name)));
  const ok = missingShots.length === 0 && errors.length === 0;

  return {
    ok,
    shots,
    errors,
    missingShots,
    plannedCount: plannedShots.length,
    toolOrder: TOOL_ORDER,
    paletteKeyCount: PALETTE_ENTRIES.length,
    beltCycle,
    commit,
    viewport,
    out,
    rubric: rubricPath,
  };
}
