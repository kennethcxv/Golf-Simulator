// PHASE 5 GATE (Goal 26) — EQUIP EACH TOOL, STAND, WALK, TURN, USE, PHOTOGRAPH.
//
// "A verifier equips each tool, stands still, walks, turns sharply, and uses it,
// and photographs each at the default player camera. Put those photographs side
// by side with the reference images in the report and say plainly how close they
// are."
//
// So this is a photographer, not a judge. It does exactly the four states named,
// for each stick tool, at the DEFAULT player camera, and writes the frames. The
// "how close they are" is a sentence a person writes after looking at them, and
// this deliberately does not pretend to compute it.
//
// Two things it does check, because both have silently voided photographs here
// before and neither is a judgement:
//
//   EQUIPPED FOR REAL   walk.getTool() after the set, not the request. A tool
//                       that failed to equip photographs as an empty hand and
//                       the picture looks fine.
//   THE TOOL IS DRAWN   its viewmodel group is visible with a live world matrix.
//                       Four Goal 23 photographs were of a wall because the rake
//                       is on the outdoor belt and simply is not drawn inside.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-phase5-gate.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/phase5-gate');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], tools: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  const home = async () => page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const c = s3.clubhouse().interior.position;
    const w = s3.walk.state;
    w.x = c.x; w.z = c.z + 2; w.vx = 0; w.vz = 0; w.yaw = 0; w.pitch = -0.72;
  });

  for (const tool of ['mop', 'broom']) {
    await home();
    // eslint-disable-next-line no-await-in-loop
    const equipped = await page.evaluate((t) => {
      window.__fw.scene3d.walk.setTool(t);
      return { asked: t };
    }, tool);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(4000);
    // eslint-disable-next-line no-await-in-loop
    const live = await page.evaluate((t) => {
      const s3 = window.__fw.scene3d;
      const got = s3.walk.getTool?.() ?? null;
      let drawn = null;
      s3.scene.traverse((o) => {
        if (drawn) return;
        if ((o.name || '') !== `Tool_${t}`) return;
        o.updateWorldMatrix(true, false);
        let vis = o.visible;
        let p = o.parent;
        while (vis && p) { vis = p.visible; p = p.parent; }
        const e = o.matrixWorld.elements;
        drawn = { name: o.name, visibleChain: vis, world: [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)] };
      });
      return { got, drawn };
    }, tool);
    const row = { tool, ...equipped, ...live, shots: {} };

    const shoot = async (state) => {
      const file = path.join(OUT, `${tool}-${state}.png`);
      await page.screenshot({ path: file });
      row.shots[state] = path.basename(file);
    };

    // STAND STILL
    // eslint-disable-next-line no-await-in-loop
    await shoot('still');

    // WALK — real velocity through the walk state, held long enough that the
    // viewmodel's own bob and sway are at their working amplitude rather than
    // being caught on the first frame of the ramp.
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(async () => {
      const w = window.__fw.scene3d.walk.state;
      const t0 = performance.now();
      while (performance.now() - t0 < 1800) {
        w.z -= 0.03;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((d) => requestAnimationFrame(() => d()));
      }
    });
    // eslint-disable-next-line no-await-in-loop
    await shoot('walking');

    // TURN SHARPLY
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(async () => {
      const w = window.__fw.scene3d.walk.state;
      const t0 = performance.now();
      while (performance.now() - t0 < 900) {
        w.yaw += 0.06;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((d) => requestAnimationFrame(() => d()));
      }
    });
    // eslint-disable-next-line no-await-in-loop
    await shoot('turning');

    // USING IT
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying?.(true));
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(async () => {
      const w = window.__fw.scene3d.walk.state;
      const t0 = performance.now();
      while (performance.now() - t0 < 1600) {
        const t = (performance.now() - t0) / 1000;
        w.x += Math.cos(t * 3.2) * 0.014;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((d) => requestAnimationFrame(() => d()));
      }
    });
    await shoot('using');
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying?.(false));

    out.tools.push(row);
    console.log('TOOL', JSON.stringify(row));
  }

  out.verdict = {
    toolsPhotographed: out.tools.map((t) => t.tool),
    allEquipped: out.tools.every((t) => t.got === t.asked),
    allDrawn: out.tools.every((t) => t.drawn && t.drawn.visibleChain === true),
    notEquipped: out.tools.filter((t) => t.got !== t.asked).map((t) => `${t.asked} -> ${t.got}`),
    notDrawn: out.tools.filter((t) => !t.drawn || !t.drawn.visibleChain).map((t) => t.tool),
    statesPerTool: ['still', 'walking', 'turning', 'using'],
  };
  console.log('PHASE5-GATE', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'phase5-gate.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
