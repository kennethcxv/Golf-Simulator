// NPC CROWD — "the npc running into the line", measured in the running game.
//
// The owner photographed a shopper mid-stride passing THROUGH the body of the
// person in front of them. The number that corresponds to that picture is the
// count of PAIRS of people standing closer together than two body radii, so
// this drives a busy shop and samples that continuously.
//
// It also records the worst overlap seen, because "a few pairs briefly touching"
// and "a body halfway inside another body" are different bugs and a pair count
// alone cannot tell them apart.
//
// A CONTROL IS BUILT IN: the same run reports how many people were present. Zero
// overlaps in a room with two customers is not evidence of anything, and the
// summary says so rather than leaving me to notice.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-npc-crowd.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/npc-crowd');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(600);

  // Stand in the room and run the clock fast so a queue actually forms. Without
  // customers this driver measures an empty shop and reports it as healthy.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const w = window.__fw.scene3d.walk.state;
    const c = ch.interior.position;
    w.x = c.x; w.z = c.z + 2.2; w.vx = 0; w.vz = 0;
    window.__fw.speedIdx = 2;
    // THE LIVE CUSTOMERS ARE IN clubhouse.js, NOT clubhouse/customers.js.
    // ch.customers() returns a plain ARRAY of walkers. createCustomerView in
    // clubhouse/customers.js is imported by nothing -- a parallel implementation
    // the game never loads, which this repo has already been burned by once
    // (see the note at clubhouse.js:11821). Two versions of this driver reported
    // "0 samples" against it, and a guessed accessor returns undefined rather
    // than throwing, which reads exactly like a healthy empty room.
    window.__fw.speedIdx = 2;
  });

  // BUILD A REAL LINE. The organic arrival rate spawns nobody inside a 30 second
  // driver, and 70 samples of an empty shop is not a measurement of crowding --
  // the MEANINGFUL flag below exists because the first run of this driver
  // reported zero overlaps about a room with zero people in it.
  // ch.sendToCounter is what the queue driver uses.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const baskets = [['balls1'], ['glove1'], ['tees1'], ['water1'], ['balls1'], ['glove1']];
    for (let i = 0; i < baskets.length; i += 1) {
      ch.sendToCounter?.(baskets[i], i % 2 ? 'cash' : 'card');
    }
  });
  await page.waitForTimeout(1200);

  const sample = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const crowd = ch.crowdDiagnostics?.() ?? null;
    return {
      people: crowd?.people ?? null,
      pairs: crowd?.pairs ?? null,
      worst: crowd?.worstOverlap ?? null,
      touching: crowd?.touching ?? null,
      passes: crowd?.passes ?? null,
      pinned: crowd?.pinned ?? null,
    };
  });

  // Look at the line as well as counting it: the owner reported this with a
  // photograph, and "0 overlapping pairs" is not the same claim as "the queue
  // looks like a queue".
  const shoot = async (name) => {
    await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const w = window.__fw.scene3d.walk.state;
      const slot = ch.queueSlotForIndex ? ch.queueSlotForIndex(0) : null;
      if (!slot) return;
      const c = ch.interior.position;
      let dx = c.x - slot.x; let dz = c.z - slot.z;
      const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      w.x = slot.x + dx * 3.2; w.z = slot.z + dz * 3.2; w.vx = 0; w.vz = 0;
      const lx = slot.x - w.x; const lz = slot.z - w.z;
      const h = Math.hypot(lx, lz) || 0.001;
      w.yaw = Math.atan2(-lx / h, -lz / h);
      w.pitch = -0.06;
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, name) });
  };

  const samples = [];
  for (let i = 0; i < 70; i += 1) {
    await page.waitForTimeout(420);
    const s = await sample();
    samples.push(s);
    if (i % 10 === 0) console.log('CROWD', JSON.stringify(s));
  }
  out.samples = samples;
  await shoot('queue-line.png');

  const valid = samples.filter((s) => s.people != null);
  const peopleMax = valid.reduce((m, s) => Math.max(m, s.people || 0), 0);
  const framesWithPairs = valid.filter((s) => (s.pairs || 0) > 0).length;
  const worst = valid.reduce((m, s) => Math.max(m, s.worst || 0), 0);
  const busy = valid.filter((s) => (s.people || 0) >= 3);

  out.summary = {
    samples: valid.length,
    peopleMax,
    // the control: an empty shop cannot prove anything
    framesWithAtLeast3People: busy.length,
    framesWithOverlappingPairs: framesWithPairs,
    pctFramesOverlapping: valid.length
      ? +(100 * framesWithPairs / valid.length).toFixed(1) : null,
    worstOverlapYd: +worst.toFixed(4),
    touchingDistanceYd: valid[0]?.touching ?? null,
    settlePasses: valid[valid.length - 1]?.passes ?? null,
    pinnedMax: valid.reduce((m, x) => Math.max(m, x.pinned || 0), 0),
    MEANINGFUL: busy.length >= 5,
  };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'crowd.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('NPC-CROWD', JSON.stringify(out.summary, null, 2));
  return out;
}
