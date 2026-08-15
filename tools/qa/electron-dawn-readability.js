// 9.3 (Goal 26) — IS THE INTERIOR READABLE AT 6 AM, WHICH IS WHEN THE GAME STARTS?
//
// "The interior is unreadably dark at 6 am, which is when the game starts."
//
// The measurement is PIXELS, because "unreadably dark" is a statement about the
// picture, not about a light intensity. Screenshots are decoded and their
// luminance histogram taken: the median, and the fraction below near-black.
//
// TWO WAYS THIS COULD LIE, both closed by construction:
//
//  * THE HUD IS BRIGHT. The notification cards and the objectives panel would let
//    a pitch-black room score as readable on the strength of its own UI, so every
//    sample is cropped to the middle half of the frame.
//  * THE CIRCUIT MIGHT BE ON. ceilingCircuitPowered returns TRUE for free play
//    ("free play has working power"), so a non-campaign run measures a LIT room
//    and answers a question nobody asked. My first run did exactly that. The
//    precondition is now asserted and an unpowered circuit is required.
//
// AND IT SAMPLES THE ROOM, NOT ONE SPOT. The first version measured the interior
// centre looking one way, reported median 53 on both builds, and would have let
// me claim either "it is fine" or "my fix did nothing" from a single view
// direction. A ring of positions, four headings each, is what makes the darkest
// corner findable.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-dawn-readability.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/dawn-readability');
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

  out.staged = await page.evaluate(() => {
    const st = window.__fw.state;
    const arch = st?.shop?.reno?.architecture?.components?.ceiling ?? null;
    const cal = st?.clock?.minutes ?? null;
    return {
      clockMinutes: cal == null ? null : +(cal % 1440).toFixed(1),
      campaignEnabled: !!st?.campaign?.enabled,
      ceilingRestored: arch ? !!arch.restored : null,
      circuitPowered: (!st?.campaign?.enabled) || !!arch?.restored,
    };
  });
  console.log('STAGED', JSON.stringify(out.staged));
  if (out.staged.circuitPowered) {
    out.measure = { ABORTED: 'the ceiling circuit is POWERED; this would measure the lit room, not 9.3' };
    fs.writeFileSync(path.join(OUT, 'dawn-readability.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('DAWN-READABILITY', JSON.stringify(out.measure));
    return out;
  }

  const sharp = (await import('sharp')).default;
  const samples = [];
  const OFFSETS = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3]];
  const YAWS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  let index = 0;

  for (const [ox, oz] of OFFSETS) {
    for (const yaw of YAWS) {
      const placed = await page.evaluate(({ dx, dz, y }) => {
        const s3 = window.__fw.scene3d;
        const ch = s3.clubhouse();
        const c = ch.interior.position;
        const w = s3.walk.state;
        w.x = c.x + dx; w.z = c.z + dz; w.vx = 0; w.vz = 0;
        w.yaw = y; w.pitch = 0;
        return { inside: ch.isInside(w.x, w.z) };
      }, { dx: ox, dz: oz, y: yaw });
      if (!placed.inside) continue;
      await page.waitForTimeout(320);
      index += 1;
      const file = path.join(OUT, `sample-${String(index).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      const meta = await sharp(file).metadata();
      const raw = await sharp(file)
        .extract({
          left: Math.floor(meta.width / 4),
          top: Math.floor(meta.height / 4),
          width: Math.floor(meta.width / 2),
          height: Math.floor(meta.height / 2),
        })
        .greyscale()
        .raw()
        .toBuffer();
      const hist = new Array(256).fill(0);
      for (let i = 0; i < raw.length; i += 1) hist[raw[i]] += 1;
      let seen = 0;
      let median = 0;
      for (let v = 0; v < 256; v += 1) {
        seen += hist[v];
        if (seen >= raw.length / 2) { median = v; break; }
      }
      let nearBlack = 0;
      for (let v = 0; v < 24; v += 1) nearBlack += hist[v];
      samples.push({
        at: `${ox},${oz}`,
        yawDeg: Math.round(yaw * (180 / Math.PI)),
        medianLuma: median,
        nearBlackFraction: +(nearBlack / raw.length).toFixed(4),
      });
    }
  }

  const medians = samples.map((s) => s.medianLuma).sort((a, b) => a - b);
  out.measure = {
    samples: samples.length,
    medianOfMedians: medians.length ? medians[Math.floor(medians.length / 2)] : null,
    darkest: samples.slice().sort((a, b) => a.medianLuma - b.medianLuma)[0] || null,
    brightest: samples.slice().sort((a, b) => b.medianLuma - a.medianLuma)[0] || null,
    // "unreadably dark": half the picture indistinguishable from black
    unreadableSamples: samples.filter((s) => s.medianLuma < 24).length,
    all: samples,
  };
  console.log('DAWN-READABILITY', JSON.stringify({
    samples: out.measure.samples,
    medianOfMedians: out.measure.medianOfMedians,
    unreadableSamples: out.measure.unreadableSamples,
    darkest: out.measure.darkest,
    brightest: out.measure.brightest,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, 'dawn-readability.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
