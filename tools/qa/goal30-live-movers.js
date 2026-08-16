// GOAL 30 LEVER B — WHO IS ACTUALLY MOVING on an idle standing frame:
// matrixWorld sampled twice, 2.5 s apart, at sim speed 0 and again at speed 1;
// every object whose matrix changed is listed with its root chain. This is
// simultaneously (a) the honest source of a watched-fail subject and (b) the
// bit-stability census the stability-freeze design starts from.
//   node tools/qa/run-electron.cjs tools/qa/goal30-live-movers.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal30');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(9000);

  const sample = (speedIdx) => page.evaluate(async (spd) => {
    const app = window.__fw;
    app.speedIdx = spd;
    const s3 = app.scene3d;
    const snap = new Map();
    s3.scene.traverse((o) => { snap.set(o.uuid, o.matrixWorld.toArray().join(',')); });
    await new Promise((r) => setTimeout(r, 2500));
    const movers = [];
    s3.scene.traverse((o) => {
      const before = snap.get(o.uuid);
      if (!before) return;
      if (o.matrixWorld.toArray().join(',') !== before) {
        let chain = o.name || o.type;
        for (let n = o.parent; n && n !== s3.scene; n = n.parent) chain = `${n.name || n.type}/${chain}`;
        movers.push(chain);
      }
    });
    // collapse to unique root prefixes with counts
    const byRoot = {};
    for (const m of movers) {
      const root = m.split('/')[0];
      byRoot[root] = (byRoot[root] || 0) + 1;
    }
    return { total: movers.length, byRoot, sample: movers.slice(0, 12) };
  }, speedIdx);

  const out = {};
  out.speed0 = await sample(0);
  out.speed1 = await sample(1);
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(OUT, 'live-movers.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
