// PLAYTEST 5, ITEM 6 — THE TOOL DRAWS ONCE AND THEN GOES DARK.
//
// The pixel sweep found the real shape of this at last. At the FIRST sample the
// mop painted 25 meshes and put 27,375 magenta pixels on screen. At every sample
// after it, the painter found ZERO drawable meshes and the screen counted zero --
// and the no-tool control counted zero throughout, so the instrument is sound.
//
// That is not a framing problem and never was. Something retires the tool's
// meshes between the first frame and the next, while `getTool()` and the scene
// graph keep reporting it equipped. This driver watches the transition happen:
// every 400 ms it records, per mesh, the two conditions that can stop a draw --
//
//     visible (self AND every ancestor)      and      layers.mask
//
// -- alongside the tool id, the group's own visibility, and whether the paint or
// the flat-shot mode was touched at all. Those separate "the game holstered it",
// "an ancestor hid", "the batcher retired it into a merged buffer" and "my own
// probe broke it", which are four different bugs with four different fixes.
//
// The run does NOT paint or flat-shoot: it only observes. If the tool goes dark
// with nothing interfering, the cause is in the game; if it only goes dark after
// the paint, the cause is mine.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-tool-goes-dark.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tool-dark');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], timeline: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(3000);

  await page.evaluate(([dx, dz, yaw, pitch]) => {
    const w = window.__fw.scene3d.walk;
    const o = window.__fw.scene3d.clubhouse().interior.position;
    w.state.x = o.x + dx; w.state.z = o.z + dz; w.state.yaw = yaw; w.state.pitch = pitch;
    w.state.vx = 0; w.state.vz = 0;
  }, [-5.6, 4.4, -Math.PI / 2, 0.05]);

  await page.evaluate(() => { window.__fw.scene3d.walk.setTool('mop'); });
  await page.waitForFunction(() => window.__fw.scene3d.walk.getTool?.() === 'mop', null, { timeout: 30000 });

  const look = () => page.evaluate(() => {
    const app = window.__fw;
    let group = null;
    app.scene3d.scene.traverse((o) => { if (!group && o.name === 'Tool_mop') group = o; });
    if (!group) return { t: Math.round(performance.now()), group: false };
    let drawable = 0; let hiddenSelf = 0; let hiddenAncestor = 0; let maskZero = 0; let total = 0;
    group.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      total += 1;
      if (!o.visible) { hiddenSelf += 1; return; }
      let vis = true;
      for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
      if (!vis) { hiddenAncestor += 1; return; }
      if (o.layers.mask === 0) { maskZero += 1; return; }
      drawable += 1;
    });
    // Which ancestor, by name, if any is hiding things.
    let culprit = null;
    let at = group;
    while (at) { if (at.visible === false) culprit = at.name || at.type; at = at.parent; }
    return {
      t: Math.round(performance.now()),
      group: true,
      tool: app.scene3d.walk.getTool?.() ?? null,
      groupVisible: group.visible,
      hidingAncestor: culprit,
      total, drawable, hiddenSelf, hiddenAncestor, maskZero,
      pitch: +app.scene3d.walk.state.pitch.toFixed(3),
      // The two things most likely to be retiring it, asked by name.
      vmActive: app.scene3d.walk.heldToolDiagnostics?.()?.vmActive ?? null,
      rigEquipped: app.scene3d.walk.strandRigDiagnostics?.('mop')?.equipped ?? null,
    };
  });

  for (let i = 0; i < 30; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const row = await look();
    out.timeline.push(row);
    if (i === 0 || row.drawable !== out.timeline[out.timeline.length - 2]?.drawable) {
      console.log('SAMPLE', i, JSON.stringify(row));
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(400);
  }

  const first = out.timeline[0];
  const wentDark = out.timeline.find((r) => (r.drawable ?? 0) === 0);
  out.verdict = {
    drawableAtStart: first?.drawable ?? null,
    totalMeshes: first?.total ?? null,
    everWentDark: !!wentDark,
    msUntilDark: wentDark ? wentDark.t - first.t : null,
    whenDark: wentDark ? {
      hiddenSelf: wentDark.hiddenSelf,
      hiddenAncestor: wentDark.hiddenAncestor,
      maskZero: wentDark.maskZero,
      hidingAncestor: wentDark.hidingAncestor,
      groupVisible: wentDark.groupVisible,
      tool: wentDark.tool,
    } : null,
    drawableAtEnd: out.timeline[out.timeline.length - 1]?.drawable ?? null,
    nothingInterfered: 'this run never painted and never touched flat-shot mode',
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('TOOL-DARK', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'tool-dark.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
