// WHOSE BROOM IS IN FRONT OF THE CAMERA?
//
// The hardgood shots came back "BLOCKED BY BroomLeftSleeve at 1.40 m" on one
// run and "clear" on the next -- a moving occluder, which makes the whole
// visibility check non-deterministic. Before hiding anything by name, find out
// what that object actually hangs off, and whether there is an API that stows
// it. Guessing which subtree to exclude is how a check ends up excluding the
// subject.
//
//   node tools/qa/run-electron.cjs tools/qa/apparel-v7-whoholds.js \
//        --clubhouse=pine-hills-v2
//
async (page) => {
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(1000);
  const boot = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 180000 });
  } catch { /* keep going */ }
  await page.waitForTimeout(2500);

  const out = await page.evaluate(async () => {
    const app = window.__fw;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k];
      if (v && v.isCamera) { cam = v; break; }
    }
    let scene = cam;
    while (scene.parent) scene = scene.parent;

    const rows = [];
    scene.traverse((o) => {
      if (!/broom|sleeve|hand|arm|glove/i.test(o.name || '')) return;
      const chain = [];
      let n = o;
      while (n) { chain.push(n.name || n.type); n = n.parent; }
      rows.push({ name: o.name, type: o.type, visible: o.visible,
                  chain: chain.slice(0, 6).join(' < ') });
    });

    // what is the top of that chain, and is there an API to stow it?
    const api = Object.keys(app.scene3d).filter((k) =>
      /tool|hand|view|equip|stow|carry/i.test(k));
    const walkKeys = app.scene3d.walk
      ? Object.keys(app.scene3d.walk).filter((k) => /tool|hand|equip|stow/i.test(k))
      : [];
    return { rows: rows.slice(0, 14), api, walkKeys,
             fwTool: app.state?.tool ?? null,
             carried: app.state?.carried ?? null };
  });

  console.log('\nobjects matching broom/sleeve/hand/arm:');
  for (const r of out.rows) {
    console.log(`  ${(r.name || '?').padEnd(24)} visible=${r.visible}  ${r.chain}`);
  }
  console.log(`\nscene3d keys that look tool-ish : ${out.api.join(', ') || '(none)'}`);
  console.log(`walk keys that look tool-ish    : ${out.walkKeys.join(', ') || '(none)'}`);
  console.log(`state.tool = ${JSON.stringify(out.fwTool)}   state.carried = ${JSON.stringify(out.carried)}`);
  return out;
}
