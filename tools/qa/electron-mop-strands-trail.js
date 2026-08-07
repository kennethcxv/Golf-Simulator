// B3, SECOND HALF — "Same for the mop strands."
//
// The grip driver answered the broom half of B3: the palm stays on the pole
// through the whole look sweep. This is the OTHER claim in that sentence, and
// it is a different claim about a different object, so it needs its own
// instrument rather than a sentence borrowed from the first.
//
// The complaint is that the mop's fibres are rigid. The trap in measuring it is
// that the strands DO move on screen even when they are welded solid, because
// the head they hang from moves. Any measurement in world space therefore
// reports "the strands moved" for a mop carved from one block of plastic. That
// is the number that is correct about the wrong claim.
//
// So everything here is measured in the COLLAR'S OWN LOCAL FRAME. The collar is
// the thing the strands hang from; expressing a tip in its frame subtracts the
// head's motion exactly, and what is left is the only thing the complaint is
// about — whether the yarn moves RELATIVE to the head it is attached to.
//
// CONTROLS, three of them, and each one kills a different way of being wrong:
//   * THE WELDED CONE. MESH_MopSkirt is the authored solid head, rigid by
//     construction. In collar-local space it must read ~0 range. If it moves,
//     the frame subtraction is broken and every other number here is noise.
//   * THE STRAND ANCHOR. The anchors are children of the strand rig but are
//     never rotated by update() — only the joints below them are. An anchor
//     must also read ~0. This separates "the joints articulated" from "the
//     whole strand rig was moved by its parent", which the cone alone cannot.
//   * A FROZEN SECOND PASS. The same sweep is run again with update() stubbed
//     out. The tips must go quiet. A metric that reports motion for a rig that
//     is provably not being driven is measuring something else.
//
// And the lag, which is what "trail" actually means: the head's stroke signal
// and the tips' signal are cross-correlated, and the tips must peak AFTER the
// head. A strand that moves in lockstep is still rigid, just rigid and moving.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-strands-trail');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  // Stand inside the shop, mid-morning, NPCs at 1x per the rules.
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.28;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('mop'));
  await page.waitForTimeout(2000);

  // The sampler runs INSIDE requestAnimationFrame so it sees every frame the
  // rig is driven on, at the rig's own cadence. Reading it from the driver one
  // page.evaluate at a time would sample every third or fourth frame and alias
  // the very oscillation being measured.
  await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const s3 = window.__fw.scene3d;
    const cam = s3.camera;
    const under = (o) => { for (let p = o.parent; p; p = p.parent) if (p === cam) return true; return false; };

    window.__strandProbe = ({ frames, freeze, mopping, sweep }) => new Promise((resolve) => {
      // Find the mop's own strand rig, under the camera, so a mop lying in the
      // stockroom cannot be mistaken for the one in the player's hands.
      let strandRoot = null;
      let skirt = null;
      s3.scene.traverse((o) => {
        const n = String(o.name || '');
        if (!strandRoot && n === 'MopStrandRig' && under(o)) strandRoot = o;
        if (!skirt && n === 'MESH_MopSkirt' && under(o)) skirt = o;
      });
      if (!strandRoot) { resolve({ error: 'no MopStrandRig under the camera' }); return; }
      const collar = strandRoot.parent;

      // tips = the deepest joint of each strand; anchors = the strand roots the
      // update never rotates. Both are children of the same rig, which is what
      // makes the anchor a control rather than a second reading of the tip.
      const anchors = strandRoot.children.filter((c) => c.children.length);
      const tips = anchors.map((a) => {
        let node = a;
        while (node.children.some((c) => c.type === 'Group')) {
          node = node.children.find((c) => c.type === 'Group');
        }
        return node;
      });

      // CONTROL: run the same sweep with the rig provably not driven.
      // the rig is stored on the HELD GROUP, several levels above the collar it
      // was added to, so walk up rather than guessing at one parent
      let rig = null;
      for (let p = strandRoot; p && !rig; p = p.parent) rig = p.userData?.strandRig || null;
      let restore = null;
      if (freeze) {
        const target = rig || null;
        if (target && typeof target.update === 'function') {
          const original = target.update;
          target.update = () => {};
          restore = () => { target.update = original; };
        }
      }

      const inv = new THREE.Matrix4();
      const v = new THREE.Vector3();
      const local = (obj) => {
        obj.getWorldPosition(v);
        return v.applyMatrix4(inv).clone();
      };

      const samples = [];
      let n = 0;
      const w = window.__fw.scene3d.walk.state;
      const yaw0 = w.yaw;
      // MOPPING vs CARRYING are different states of the rig, and the strands
      // are driven differently in each, so they are measured separately rather
      // than averaged into one verdict.
      window.__fw.scene3d.walk.setSpraying(!!mopping);
      const step = () => {
        // ONE driver per run. Swinging the view while ALSO mopping puts two
        // oscillators into the tip signal, and a correlation against either one
        // then reads about half, with the best shift landing at zero — which is
        // "no trail" reported for a rig that trails. So the carry run swings the
        // view and does not mop; the mopping run mops and holds the view still.
        if (sweep) w.yaw = yaw0 + Math.sin(n * 0.13) * 0.55;
        collar.updateWorldMatrix(true, true);
        inv.copy(collar.matrixWorld).invert();
        const diag = s3.walk.toolRigDiagnostics?.('mop');
        samples.push({
          i: n,
          head: diag?.headLag?.angle ?? 0,
          stroke: diag?.strokeX ?? 0,
          tips: tips.map((t) => local(t).toArray().map((x) => +x.toFixed(5))),
          anchors: anchors.map((a) => local(a).toArray().map((x) => +x.toFixed(5))),
          skirt: skirt ? local(skirt).toArray().map((x) => +x.toFixed(5)) : null,
        });
        n += 1;
        if (n < frames) { requestAnimationFrame(step); return; }
        if (restore) restore();
        w.yaw = yaw0;
        window.__fw.scene3d.walk.setSpraying(false);
        resolve({ samples, tipCount: tips.length, drivenRigFound: !!rig });
      };
      requestAnimationFrame(step);
    });
  });

  // range of a point's collar-local position across the run, in yards
  const rangeOf = (series) => {
    if (!series.length || !series[0]) return 0;
    let best = 0;
    for (let a = 0; a < series.length; a += 1) {
      for (let b = a + 1; b < series.length; b += 1) {
        const d = Math.hypot(
          series[a][0] - series[b][0],
          series[a][1] - series[b][1],
          series[a][2] - series[b][2],
        );
        if (d > best) best = d;
      }
    }
    return +best.toFixed(5);
  };
  // best positive shift of `b` behind `a`, in frames
  const bestLag = (a, b, maxShift) => {
    const norm = (arr) => {
      const m = arr.reduce((s, x) => s + x, 0) / arr.length;
      const c = arr.map((x) => x - m);
      const mag = Math.sqrt(c.reduce((s, x) => s + x * x, 0)) || 1;
      return c.map((x) => x / mag);
    };
    const A = norm(a);
    const B = norm(b);
    let best = 0;
    let bestR = -2;
    for (let sft = 0; sft <= maxShift; sft += 1) {
      let r = 0;
      for (let i = 0; i + sft < A.length; i += 1) r += A[i] * B[i + sft];
      if (r > bestR) { bestR = r; best = sft; }
    }
    return { shift: best, r: +bestR.toFixed(3) };
  };

  // WHICH signal drives the yarn depends on the state, and correlating against
  // the wrong one reports "no trail" for a rig that trails perfectly. While
  // mopping the head swings on the stroke; while merely carried it fans on the
  // head lag. The driving signal is named per run rather than assumed.
  const analyse = (run, driver = 'stroke') => {
    if (run.error) return { error: run.error };
    const s = run.samples;
    const tipSeries = (k) => s.map((x) => x.tips[k]);
    const anchorSeries = (k) => s.map((x) => x.anchors[k]);
    const tipRanges = [];
    const anchorRanges = [];
    for (let k = 0; k < run.tipCount; k += 1) {
      tipRanges.push(rangeOf(tipSeries(k)));
      anchorRanges.push(rangeOf(anchorSeries(k)));
    }
    const skirtRange = s[0].skirt ? rangeOf(s.map((x) => x.skirt)) : null;
    // the tip signal: sideways travel of the first tip in the collar's frame
    const tipSignal = s.map((x) => x.tips[0][0]);
    const headSignal = s.map((x) => x.head);
    const driveSignal = s.map((x) => (driver === 'head' ? x.head : x.stroke));
    const lag = bestLag(driveSignal, tipSignal, 24);
    // do the strands FAN, or move as a slab? spread of per-tip ranges
    const spread = +(Math.max(...tipRanges) - Math.min(...tipRanges)).toFixed(5);
    return {
      frames: s.length,
      tipCount: run.tipCount,
      maxTipRangeYd: Math.max(...tipRanges),
      medianTipRangeYd: tipRanges.slice().sort((a, b) => a - b)[Math.floor(tipRanges.length / 2)],
      maxAnchorRangeYd: Math.max(...anchorRanges),
      weldedConeRangeYd: skirtRange,
      tipFanSpreadYd: spread,
      lagDrivenBy: driver,
      lagFrames: lag.shift,
      lagCorrelation: lag.r,
      headSwingRad: +(Math.max(...headSignal) - Math.min(...headSignal)).toFixed(4),
      driveSwingRad: +(Math.max(...driveSignal) - Math.min(...driveSignal)).toFixed(4),
    };
  };

  const mopping = analyse(await page.evaluate(
    () => window.__strandProbe({ frames: 220, freeze: false, mopping: true, sweep: false }),
  ), 'stroke');
  await page.screenshot({ path: path.join(OUT, 'mop-mopping.png') });
  const carrying = analyse(await page.evaluate(
    () => window.__strandProbe({ frames: 220, freeze: false, mopping: false, sweep: true }),
  ), 'head');
  await page.screenshot({ path: path.join(OUT, 'mop-carrying.png') });
  const frozen = analyse(await page.evaluate(
    () => window.__strandProbe({ frames: 220, freeze: true, mopping: true, sweep: false }),
  ), 'stroke');
  const driven = mopping;

  const out = {
    mopping,
    carrying,
    frozen,
    checks: {
      // CARRYING is its own claim: a mop swung about while walking has a head
      // that visibly trails (the rig lags it), and yarn that must trail with
      // it. This is the state the player spends most of their time in.
      strandsMoveWhenMerelyCarried: (carrying.maxTipRangeYd ?? 0) > 0.02,
      // THE FINDING: the yarn moves relative to the head it hangs from. A
      // strand tip 0.30 yd long sweeping even 15 degrees travels ~0.08 yd, so
      // this floor is deliberately well under what the eye reads as motion.
      strandsMoveRelativeToTheHead: (driven.maxTipRangeYd ?? 0) > 0.02,
      // ...and they trail rather than moving with it
      tipsLagTheHead: (driven.lagFrames ?? 0) > 0 && (driven.lagCorrelation ?? 0) > 0.5,
      // ...and they fan rather than swinging as one slab
      strandsFanRatherThanSlab: (driven.tipFanSpreadYd ?? 0) > 0.004,
      // CONTROL 1: the authored solid head is rigid in this frame
      weldedConeReadsStill: driven.weldedConeRangeYd != null && driven.weldedConeRangeYd < 0.002,
      // CONTROL 2: the un-rotated anchors are still, so the motion is the
      // joints articulating and not the rig being carried about
      anchorsReadStill: (driven.maxAnchorRangeYd ?? 1) < 0.002,
      // CONTROL 3: with update() stubbed the tips go quiet
      frozenRigGoesQuiet: (frozen.maxTipRangeYd ?? 1) < (driven.maxTipRangeYd ?? 0) * 0.25,
      // the head really was swinging, or none of the above was tested at all
      headActuallySwung: (driven.headSwingRad ?? 0) > 0.05,
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'mop-strands-trail.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
