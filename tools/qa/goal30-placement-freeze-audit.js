// GOAL 30 LEVER B — why each Assets61to100 entry did or did not freeze:
// per-root frozen/auto counts plus every exclusion-relevant flag.
//   node tools/qa/run-electron.cjs tools/qa/goal30-placement-freeze-audit.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(10000);
  const out = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let runtimeRoot = null;
    s3.scene.traverse((o) => { if (!runtimeRoot && o.name === 'Assets61to100Runtime') runtimeRoot = o; });
    if (!runtimeRoot) return { err: 'no Assets61to100Runtime' };
    const rows = [];
    for (const child of runtimeRoot.children) {
      let auto = 0; let frozen = 0;
      child.traverse((o) => {
        if (o.matrixAutoUpdate) auto += 1;
        if (o.userData?.matrixFrozen) frozen += 1;
      });
      rows.push({
        name: child.name || `(${child.type})`,
        auto,
        frozen,
        flags: {
          fixtureId: child.userData?.fixtureId || null,
          live: !!child.userData?.liveVisualHierarchy,
          gated: !!child.userData?.visibilityGated,
        },
      });
    }
    rows.sort((a, b) => b.auto - a.auto);
    let totalAuto = 0; let totalFrozen = 0;
    runtimeRoot.traverse((o) => {
      if (o.matrixAutoUpdate) totalAuto += 1;
      if (o.userData?.matrixFrozen) totalFrozen += 1;
    });
    return { totalAuto, totalFrozen, rows: rows.slice(0, 30) };
  });
  console.log(JSON.stringify(out, null, 1));
  return out;
}
