// PLAYTEST 5, ITEM 2 — FINISH THE MOP BISECTION, ON FRAMES NOT NUMBERS.
//
// "My reference disc is roughly twice as wide as it is deep. Photograph three or
// four more points around that setting, lit, at the framing you used for mop-v4,
// and tell me which is closest. Do not tune on numbers — every one of the nine
// previous passes satisfied its own number while the head was a shuttlecock."
//
// So this sweeps SETTINGS and produces FRAMES. It reports the measured hem radius
// and drop alongside each one, because a wide-to-deep RATIO is the owner's own
// description of the target and the ratio is worth knowing — but the choice is
// made by looking, and the numbers are printed underneath the picture rather than
// in place of it.
//
// The yarn is rebuilt in place through `walk.rebuildYarn`, which exists for
// exactly this sweep, so one boot covers every point and nothing drifts between
// them: same room, same light, same camera, same tool, only the two numbers move.
//
// Each shot re-asserts the tool first. The deferred warm-up in main.js takes it
// out of the player's hands about fifteen seconds after boot, and a sweep that
// crosses that window otherwise photographs an empty hand.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-mop-bisect.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-bisect');
  fs.mkdirSync(OUT, { recursive: true });
  const libPath = `${process.cwd()}/tools/qa/lib/tool-photo.mjs`.replace(/\\/g, '/');
  const { setToolPose, drawableCount, lightTheRoom, photographTool } = await import(`file:///${libPath}`);
  const out = { errs: [], points: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await lightTheRoom(page);
  await page.waitForTimeout(1500);

  // Equip once, through the settling recipe, before any sweeping.
  const first = await photographTool(page, 'mop', path.join(OUT, '00-baseline.png'), { pitch: -0.62 });
  console.log('BASELINE', JSON.stringify(first));
  if (first.drawableAtShot === 0) throw new Error('the mop never reached the hand; nothing below would mean anything');

  // THE POINTS. Centred on splay 0.78 / length 0.132, which is the closest the
  // head has been, and spread toward "wider and flatter" because the reference
  // disc is about twice as wide as it is deep and this one is nearer square.
  const POINTS = [
    { id: 'a', splay: 0.78, length: 0.132, note: 'the current best — where the last session finished' },
    { id: 'b', splay: 0.95, length: 0.132, note: 'wider at the same drop' },
    { id: 'c', splay: 0.95, length: 0.108, note: 'wider AND shorter' },
    { id: 'd', splay: 1.10, length: 0.108, note: 'wider still' },
    { id: 'e', splay: 1.10, length: 0.088, note: 'the flattest — closest to a 2:1 disc on paper' },
  ];

  for (const p of POINTS) {
    // eslint-disable-next-line no-await-in-loop
    const rebuilt = await page.evaluate((o) => {
      const r = window.__fw.scene3d.walk.rebuildYarn?.('mop', { splay: o.splay, length: o.length });
      return r ? { ok: true } : { ok: false };
    }, p);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(2600);   // let the solver settle into the new shape

    // Re-assert: the warm-up window is ~15 s wide and this sweep outlasts it.
    // eslint-disable-next-line no-await-in-loop
    const held = await drawableCount(page, 'mop');
    if (held.tool !== 'mop' || held.drawable === 0) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(() => { window.__fw.scene3d.walk.setTool('mop'); });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForFunction(() => window.__fw.scene3d.walk.getTool?.() === 'mop', null, { timeout: 30000 }).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(2000);
    }

    // The hem, measured off the drawn tips, so the printed ratio is the object's
    // and not the parameters'.
    // eslint-disable-next-line no-await-in-loop
    const shape = await page.evaluate(async () => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const scene = window.__fw.scene3d.scene;
      let tips = null; let collar = null;
      scene.traverse((o) => {
        if (o.name === 'MopVerletTips') tips = o;
        if (o.name === 'MopVerletLayer_0') collar = o;
      });
      if (!tips || !collar || !tips.count) return null;
      const m = tips.instanceMatrix.array;
      const c = collar.instanceMatrix.array;
      let maxR = 0; let minY = Infinity; let maxY = -Infinity;
      for (let i = 0; i < tips.count; i += 1) {
        const x = m[i * 16 + 12]; const y = m[i * 16 + 13]; const z = m[i * 16 + 14];
        const r = Math.hypot(x, z);
        if (r > maxR) maxR = r;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      let collarY = -Infinity;
      for (let i = 0; i < collar.count; i += 1) {
        const y = c[i * 16 + 13];
        if (y > collarY) collarY = y;
      }
      const width = maxR * 2;
      const depth = Math.max(1e-4, collarY - minY);
      return {
        hemWidth: +width.toFixed(4),
        drop: +depth.toFixed(4),
        widthToDepth: +(width / depth).toFixed(2),
      };
    });

    const file = path.join(OUT, `${p.id}-splay${p.splay}-len${p.length}.png`);
    // eslint-disable-next-line no-await-in-loop
    await setToolPose(page, { pitch: -0.62 });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(700);
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: file });
    // eslint-disable-next-line no-await-in-loop
    const after = await drawableCount(page, 'mop');
    out.points.push({ ...p, rebuilt: rebuilt.ok, shape, drawable: after.drawable, tool: after.tool, file });
    console.log('POINT', p.id, JSON.stringify({ splay: p.splay, length: p.length, ...shape, drawable: after.drawable, tool: after.tool }));
  }

  out.verdict = {
    pointsShot: out.points.length,
    allHeldTheTool: out.points.every((p) => p.tool === 'mop' && p.drawable > 0),
    ratios: Object.fromEntries(out.points.map((p) => [p.id, p.shape ? p.shape.widthToDepth : null])),
    referenceRatio: '~2.0 (owner: "roughly twice as wide as it is deep")',
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('MOP-BISECT', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'mop-bisect.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
