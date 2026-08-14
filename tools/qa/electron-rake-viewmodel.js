// 9.4 (Goal 26) — PHOTOGRAPH THE BUNKER RAKE AND SAY WHAT I SEE.
//
// "The bunker rake viewmodel -- I reported deformed lumps filling the top third;
// a previous session could not reproduce it. Photograph it at the default camera
// and tell me what you see."
//
// The instruction is a photograph, so that is the whole deliverable. The one
// thing that can make this fail silently is already on the ledger:
//
//   A TOOL VIEWMODEL DRAWS ONLY IN ITS OWN DOMAIN. The belts are split -- the
//   rake is on the OUTDOOR belt, and photographed indoors it reports
//   equipped: true and vmActive: true and draws a picture of a wall. Four
//   photographs failed that way in Goal 23 before anyone noticed.
//
// So the player is put OUTDOORS, and the shot is taken at the default player
// camera with the tool confirmed equipped. A frame is also measured for how much
// of its TOP THIRD is covered by near-camera geometry, because "lumps filling the
// top third" is a claim about that specific region and a number makes the next
// comparison possible.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-rake-viewmodel.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/rake-viewmodel');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  // OUTDOORS. The rake is on the outdoor belt and simply is not drawn inside.
  out.staged = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const c = ch.interior.position;
    const w = s3.walk.state;
    w.x = c.x + 30; w.z = c.z + 30; w.vx = 0; w.vz = 0;
    w.yaw = 0; w.pitch = 0;
    return { inside: ch.isInside(w.x, w.z) };
  });
  await page.waitForTimeout(1200);
  out.equipped = await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    // getTool, NOT tool(). My first version read walk.tool?.(), which does not
    // exist -- it returned undefined and the run reported the rake unequipped
    // while saying nothing about whether it was. An optional call to a name that
    // was never there is a measurement of nothing wearing the costume of a null.
    walk.setTool('rake');
    return { tool: walk.getTool?.() ?? null };
  });
  await page.waitForTimeout(2500);
  console.log('STAGED', JSON.stringify(out.staged), 'EQUIPPED', JSON.stringify(out.equipped));

  const shots = {};
  for (const [name, pitch] of [['level', 0], ['down', -0.5], ['up', 0.25]]) {
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
    await page.waitForTimeout(700);
    const file = path.join(OUT, `rake-${name}.png`);
    await page.screenshot({ path: file });
    shots[name] = file;
  }

  // How much of the TOP THIRD is bright near-camera geometry? "Deformed lumps
  // filling the top third" is a claim about that band, so it gets a number.
  const sharp = (await import('sharp')).default;
  const meta = await sharp(shots.level).metadata();
  const band = await sharp(shots.level)
    .extract({ left: 0, top: 0, width: meta.width, height: Math.floor(meta.height / 3) })
    .greyscale()
    .raw()
    .toBuffer();
  const hist = new Array(256).fill(0);
  for (let i = 0; i < band.length; i += 1) hist[band[i]] += 1;
  let seen = 0;
  let median = 0;
  for (let v = 0; v < 256; v += 1) {
    seen += hist[v];
    if (seen >= band.length / 2) { median = v; break; }
  }
  out.topThird = { pixels: band.length, medianLuma: median };
  console.log('TOP-THIRD', JSON.stringify(out.topThird));
  console.log('SHOTS', JSON.stringify(shots));
  fs.writeFileSync(path.join(OUT, 'rake.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
