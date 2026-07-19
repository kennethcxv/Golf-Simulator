async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const out = process.env.SHEET06_PERF_PROBE_OUT
    ? path.resolve(repo, process.env.SHEET06_PERF_PROBE_OUT)
    : path.join(repo, 'qa', 'assets_51_100_master', 'sheet_06', 'performance', 'contribution_probe');
  fs.mkdirSync(out, { recursive: true });

  const harnessSource = fs.readFileSync(
    path.join(repo, 'tools', 'qa', 'assets-51-100-sheet06-performance.js'),
    'utf8',
  );
  const harness = Function(`"use strict"; return (${harnessSource});`)();
  const oldOut = process.env.ASSET_QA_OUT;
  process.env.ASSET_QA_OUT = path.relative(repo, out).split(path.sep).join('/');
  let matchedRun;
  try {
    matchedRun = await harness(page);
  } finally {
    if (oldOut === undefined) delete process.env.ASSET_QA_OUT;
    else process.env.ASSET_QA_OUT = oldOut;
  }

  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const walk = app.scene3d.walk;
    const origin = clubhouse.interior.position;
    const shot = { x: -0.2, z: 1.8, tx: -0.2, tz: -0.2, pitch: -0.30 };
    walk.clearKeys?.();
    walk.state.x = origin.x + shot.x;
    walk.state.z = origin.z + shot.z;
    walk.state.yaw = Math.atan2(-(shot.tx - shot.x), -(shot.tz - shot.z));
    walk.state.pitch = shot.pitch;
    app.state.shop.reno.grime.fill(0.82);
    clubhouse.rebuildReno?.();
    walk.setTool?.('vacuum');
    walk.setSpraying?.(true);
  });
  await page.waitForTimeout(900);

  const contribution = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const renderer = app.scene3d.renderer;

    const renderMeasure = () => new Promise((resolve) => {
      renderer.info.autoReset = false;
      renderer.info.reset();
      renderer.shadowMap.needsUpdate = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const measured = {
          drawCalls: renderer.info.render.calls,
          renderedTriangles: renderer.info.render.triangles,
          points: renderer.info.render.points,
          lines: renderer.info.render.lines,
        };
        renderer.info.autoReset = true;
        resolve(measured);
      }));
    });

    const handles = new Map();
    for (let assetNumber = 51; assetNumber <= 60; assetNumber += 1) {
      const actual = assetNumber >= 55
        ? production.getAssemblyRoot(assetNumber)
        : production.getRoot(assetNumber);
      handles.set(assetNumber, actual || null);
    }
    const visibility = new Map([...handles].map(([number, root]) => [number, root?.visible]));
    const restore = () => {
      for (const [number, root] of handles) if (root) root.visible = visibility.get(number);
    };

    const allVisible = await renderMeasure();
    const withoutAsset = {};
    for (const [assetNumber, root] of handles) {
      if (!root || root.visible === false) {
        withoutAsset[assetNumber] = { skipped: true, reason: 'root absent or state-hidden' };
        continue;
      }
      root.visible = false;
      withoutAsset[assetNumber] = await renderMeasure();
      root.visible = visibility.get(assetNumber);
    }
    for (const root of handles.values()) if (root) root.visible = false;
    const withoutSheet06 = await renderMeasure();
    restore();
    app.scene3d.walk.setSpraying?.(false);
    app.scene3d.walk.setTool?.(null);
    return {
      production: production.diagnostics(),
      allVisible,
      withoutAsset,
      withoutSheet06,
    };
  });

  const report = {
    schemaVersion: 1,
    ok: matchedRun.ok === true,
    capturedAt: new Date().toISOString(),
    methodology: 'Matched frozen performance fixture; forced identical two-frame shadow/GTAO measurement with each live Sheet-6 root hidden in isolation.',
    matchedRun: {
      inheritedBaselineScript: matchedRun.inheritedBaselineScript,
      sheet06ProductionReadiness: matchedRun.sheet06ProductionReadiness,
      vacuumActive: matchedRun.performanceScenarios?.vacuumActive,
    },
    contribution,
  };
  fs.writeFileSync(path.join(out, 'contribution-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
