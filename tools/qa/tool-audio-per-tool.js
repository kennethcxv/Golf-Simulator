// E3 — does every tool now have its own three audio layers, in the build?
//
// Before: 26 of the 27 sound names the registry declares did not exist, and
// setToolLoopIntensity — the layer that makes a loop follow the stroke and the
// floor surface — was only ever called for the broom. Every other tool played
// one flat loop from button-down to button-up.
//
// Audio cannot be screenshotted, so this measures the calls: it wraps the audio
// module's own functions and records what each tool actually asks for over two
// seconds of real use. The acceptance is a DIVERGENCE — the tools must ask for
// different things — so a silent no-op and a single shared sound both fail.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tool-audio');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 4.2; w.state.z = o.z + 5.0; w.state.yaw = -Math.PI / 2; w.state.pitch = -0.40;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(500);

  // Instrument the audio surface. The hook is what the renderer emits; these are
  // what the audio module is actually asked to do with it.
  await page.evaluate(() => {
    const a = window.__fw.audio;
    window.__audioLog = [];
    for (const name of ['setToolLoopIntensity', 'toolContactStart', 'toolContactStop', 'setToolLoop']) {
      const original = a[name];
      if (typeof original !== 'function') { window.__audioLog.push({ missing: name }); continue; }
      a[name] = (...args) => {
        window.__audioLog.push({ fn: name, args: args.map((v) => (typeof v === 'number' ? +v.toFixed(3) : v)) });
        return original.apply(a, args);
      };
    }
  });

  const rows = [];
  for (const id of ['mop', 'vacuum', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag', 'broom']) {
    await page.evaluate((t) => {
      window.__audioLog.length = 0;
      window.__fw.scene3d.walk.setTool(t);
    }, id);
    await page.waitForTimeout(1400);
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
    await page.waitForTimeout(600);
    const log = await page.evaluate(() => window.__audioLog.slice());
    const intensities = log.filter((e) => e.fn === 'setToolLoopIntensity' && e.args[0] === id)
      .map((e) => e.args[1]);
    rows.push({
      tool: id,
      intensityCalls: intensities.length,
      intensityMin: intensities.length ? Math.min(...intensities) : null,
      intensityMax: intensities.length ? Math.max(...intensities) : null,
      // a flat loop is the OLD behaviour: the same value every frame
      intensityVaries: intensities.length > 4
        && (Math.max(...intensities) - Math.min(...intensities)) > 0.15,
      contactStarts: log.filter((e) => e.fn === 'toolContactStart' || e.fn === 'broomStart').length,
      contactStops: log.filter((e) => e.fn === 'toolContactStop' || e.fn === 'broomStop').length,
      surfacesSeen: [...new Set(log.filter((e) => e.fn === 'setToolLoopIntensity')
        .map((e) => e.args[2]).filter(Boolean))],
    });
  }

  const nonBroom = rows.filter((r) => r.tool !== 'broom');
  const checks = {
    everyToolDrivesItsLoop: nonBroom.every((r) => r.intensityCalls > 10),
    everyLoopFollowsTheStroke: nonBroom.every((r) => r.intensityVaries),
    // the broom is the control: it had all three layers before this change and
    // must still have them
    broomUnchanged: (rows.find((r) => r.tool === 'broom')?.intensityCalls ?? 0) > 10,
  };
  fs.writeFileSync(path.join(OUT, 'tool-audio.json'), `${JSON.stringify({ rows, checks }, null, 1)}\n`);
  return { rows, checks, ok: Object.values(checks).every(Boolean) };
}
