// WHY DOES THE BELT WARM COMPLETE ONE TOOL OF NINE?
//
// The stamped-boot ledger says the `belt` stage spent 14,066 ms across FOUR
// frames -- 3,516 ms per frame -- minted 9 programs, and blew its 10 s budget
// inside the first tool. Eight tools have therefore never been warmed anywhere.
//
// The stage report cannot say WHAT those 14 seconds were, and there are three
// candidates that a wall-clock number cannot separate:
//
//   compile   the tool's materials mint programs on first draw. ANGLE's HLSL
//             translate+link does not disk-cache here, so this is re-paid every
//             boot however warm the profile is.
//   load      the authored viewmodel GLB is fetched and parsed on first equip.
//             That is re-paid every boot too, and looks identical in wall time.
//   draw      the frames are simply expensive, and the count of them is the cost.
//
// So this equips each belt tool ONE AT A TIME after the boot has settled and
// records, per tool: wall ms, programs minted, geometries and textures added.
// Programs separate compile from the other two; geometries/textures separate
// load from draw. Nothing here is inferred from a total.
//
// THE CONTROL is the second pass. Every tool is equipped a second time in the
// same session, when by construction nothing is left to compile or load. If the
// second pass is not dramatically cheaper then the cost is per-EQUIP rather than
// per-first-equip, and the whole warm strategy is pointless -- which is a result
// this probe must be able to return.
//
//   node tools/qa/run-electron.cjs tools/qa/belt-warm-anatomy.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/belt-anatomy';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  out.warmSummary = await page.evaluate(() => window.__fwWarm || null);
  out.stamped = await page.evaluate(() => {
    try { return !!localStorage.getItem('golfEmpire.shaderCompileStamp.v2'); } catch { return null; }
  });
  console.log(`boot stamped=${out.stamped}   warmSummary.belt=${out.warmSummary?.belt}`);

  const pass = async (label) => {
    console.log(`\n== ${label} ==`);
    console.log('  tool        wall ms   programs   geometries   textures');
    const rows = await page.evaluate(async () => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const equip = walk.setToolImmediate || walk.setTool;
      const info = () => {
        const i = app.scene3d.renderer?.info;
        return {
          p: i?.programs?.length ?? -1,
          g: i?.memory?.geometries ?? -1,
          t: i?.memory?.textures ?? -1,
        };
      };
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const belt = ['vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag', 'washer'];
      const res = [];
      for (const tool of belt) {
        const a = info();
        const t0 = performance.now();
        equip.call(walk, tool);
        // Three frames, which is what the production warm gives each tool: one
        // to build, one to draw, one to settle.
        await frame(); await frame(); await frame();
        const ms = +(performance.now() - t0).toFixed(1);
        const b = info();
        equip.call(walk, null);
        await frame();
        res.push({
          tool, ms, programs: b.p - a.p, geometries: b.g - a.g, textures: b.t - a.t,
        });
      }
      return res;
    });
    for (const r of rows) {
      console.log(`  ${r.tool.padEnd(10)} ${String(r.ms).padStart(8)}   `
        + `${String(r.programs).padStart(8)}   ${String(r.geometries).padStart(10)}   ${String(r.textures).padStart(8)}`);
    }
    const total = rows.reduce((a, r) => a + r.ms, 0);
    console.log(`  TOTAL ${total.toFixed(1)} ms   programs ${rows.reduce((a, r) => a + r.programs, 0)}`
      + `   geometries ${rows.reduce((a, r) => a + r.geometries, 0)}`);
    return { rows, totalMs: +total.toFixed(1) };
  };

  out.first = await pass('FIRST EQUIP OF EACH TOOL');
  out.second = await pass('SECOND EQUIP — THE CONTROL (nothing left to compile or load)');

  const drop = out.first.totalMs > 0
    ? +(1 - out.second.totalMs / out.first.totalMs).toFixed(3) : null;
  console.log(`\nsecond pass is ${(drop * 100).toFixed(1)}% cheaper than the first`);
  out.dropFraction = drop;
  if (drop == null || drop < 0.5) {
    fail(`the second equip of every tool cost ${out.second.totalMs} ms against ${out.first.totalMs} ms first time — `
      + 'the cost is per-equip, not per-first-equip, and warming cannot help it');
  }

  fs.writeFileSync(`${OUT}/anatomy.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
