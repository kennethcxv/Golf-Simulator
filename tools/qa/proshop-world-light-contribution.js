async (page) => {
  // BLOCKER 8, the measurement half. What do the two GLOBAL lights actually
  // contribute to the unpowered clubhouse, and what would the course lose if
  // they were taken away?
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-world-light-contribution.js
  //
  // courseScene adds a HemisphereLight and an AmbientLight to the scene root.
  // Neither is occluded by anything â€” three.js has no shadowing for either â€” so
  // a sealed, windowless, unpowered room receives exactly the same sky fill as
  // the middle of the fairway. That is the reason the dark state is not dark,
  // and the interior daylight fills, the obvious suspect, are a minor term
  // beside it.
  //
  // This measures rather than argues: each pose is captured four ways â€” as
  // shipped, without the hemisphere, without the ambient, and without both â€”
  // and the same is done OUTDOORS, because any proposal has to be paid for in
  // what the course looks like. Nothing is changed permanently; the intensities
  // are restored after every capture.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const zlib = process.getBuiltinModule('node:zlib');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  const shotDir = path.join(outDir, 'world-light-contribution');
  fs.mkdirSync(shotDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  function decodePng(buffer) {
    let pos = 8;
    let width = 0; let height = 0; let colorType = 0;
    const idat = [];
    while (pos < buffer.length) {
      const len = buffer.readUInt32BE(pos);
      const type = buffer.toString('ascii', pos + 4, pos + 8);
      const data = buffer.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const bpp = colorType === 6 ? 4 : 3;
    const stride = width * bpp;
    const out = Buffer.alloc(height * stride);
    const paeth = (a, b, c) => {
      const pp = a + b - c;
      const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)];
      const rowIn = (y * (stride + 1)) + 1;
      const rowOut = y * stride;
      for (let x = 0; x < stride; x++) {
        const rb = raw[rowIn + x];
        const left = x >= bpp ? out[rowOut + x - bpp] : 0;
        const up = y > 0 ? out[rowOut - stride + x] : 0;
        const ul = y > 0 && x >= bpp ? out[rowOut - stride + x - bpp] : 0;
        let v;
        switch (filter) {
          case 0: v = rb; break;
          case 1: v = rb + left; break;
          case 2: v = rb + up; break;
          case 3: v = rb + ((left + up) >> 1); break;
          case 4: v = rb + paeth(left, up, ul); break;
          default: throw new Error(`bad filter ${filter}`);
        }
        out[rowOut + x] = v & 0xff;
      }
    }
    return { width, height, bpp, data: out };
  }

  const stats = (img, box) => {
    const x0 = Math.floor(box.x0 * img.width); const x1 = Math.floor(box.x1 * img.width);
    const y0 = Math.floor(box.y0 * img.height); const y1 = Math.floor(box.y1 * img.height);
    let sum = 0; let n = 0;
    const vals = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * img.bpp;
        const l = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
        sum += l; n += 1;
        if ((x + y) % 7 === 0) vals.push(l);
      }
    }
    vals.sort((a, b) => a - b);
    const pct = (q) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] : 0);
    return { mean: +(sum / Math.max(1, n)).toFixed(2), p05: +pct(0.05).toFixed(1), p95: +pct(0.95).toFixed(1) };
  };
  const WHOLE = { x0: 0, x1: 1, y0: 0, y1: 1 };
  const CEILING_BAND = { x0: 0.15, x1: 0.85, y0: 0.02, y1: 0.30 };
  const NAV_BAND = { x0: 0.15, x1: 0.85, y0: 0.62, y1: 0.96 };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    app.state.clock.minutes = 10 * 60;
    const ch = app.scene3d.clubhouse();
    ch.setTimeMood?.(10 * 60);
    const cs = typeof ch.customers === 'function' ? ch.customers() : ch.customers;
    if (Array.isArray(cs)) cs.forEach((c) => { if (c?.mesh) c.mesh.visible = false; });
    ch.setOrganicWalkins?.(false);
    document.querySelectorAll('.hud, .notification-center, .walk-overlay').forEach((n) => { n.style.display = 'none'; });
  });

  // The same gate the dark-state probe uses: a powered room measures nothing.
  const simPowered = await page.evaluate(async () => {
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    return R.ceilingCircuitPowered(window.__fw.state);
  });
  if (simPowered !== false) throw new Error(`needs an UNPOWERED room; sim reports powered=${simPowered}`);
  const agreed = await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().ceilingLightingDiagnostics?.().circuitPowered === false,
    null, { timeout: 30000, polling: 250 },
  ).then(() => true).catch(() => false);
  if (!agreed) throw new Error('the shell never agreed the circuit is dead');

  const lights = await page.evaluate(() => {
    const found = { hemi: null, ambient: null };
    window.__fw.scene3d.scene.traverse((o) => {
      if (o.isHemisphereLight && !found.hemi) found.hemi = o.intensity;
      if (o.isAmbientLight && !found.ambient) found.ambient = o.intensity;
    });
    return found;
  });
  if (lights.hemi === null || lights.ambient === null) throw new Error('could not find the global lights');

  // PIN THE VALUE, DO NOT JUST ASSIGN IT.
  //
  // applyTimeWeather runs EVERY FRAME from main.js and writes hemi.intensity
  // unconditionally (`hemi.intensity = rainy ? 0.9 : 1.0`, and the dusk/night
  // branches likewise). A plain assignment is therefore undone before the next
  // render, and the first run of this probe duly reported the hemisphere
  // contributing exactly 0.0% at all six poses â€” indoors and out, which is not
  // a result, it is a light that was never actually turned off. Ambient is not
  // reassigned anywhere, which is why only the hemisphere came out at zero and
  // why the discrepancy was visible at all.
  //
  // Replacing the property with an accessor makes the game's write a no-op for
  // the duration of the capture, and the plain data property is restored after.
  const setLights = (hemiScale, ambientScale) => page.evaluate(([hs, as, base]) => {
    const pin = (light, value) => {
      const own = Object.getOwnPropertyDescriptor(light, 'intensity');
      if (own && own.get) { light.__pinned = value; return; }
      light.__pinned = value;
      Object.defineProperty(light, 'intensity', {
        configurable: true,
        get() { return this.__pinned; },
        set() { /* the frame loop's write is deliberately ignored while pinned */ },
      });
    };
    window.__fw.scene3d.scene.traverse((o) => {
      if (o.isHemisphereLight) pin(o, base.hemi * hs);
      if (o.isAmbientLight) pin(o, base.ambient * as);
    });
  }, [hemiScale, ambientScale, lights]);

  const unpinLights = () => page.evaluate((base) => {
    window.__fw.scene3d.scene.traverse((o) => {
      if (!o.isHemisphereLight && !o.isAmbientLight) return;
      delete o.intensity;
      delete o.__pinned;
      o.intensity = o.isHemisphereLight ? base.hemi : base.ambient;
    });
  }, lights);

  // Prove the pin holds before measuring anything with it.
  await setLights(0, 0);
  await page.waitForTimeout(600);
  const pinHeld = await page.evaluate(() => {
    let hemi = null;
    window.__fw.scene3d.scene.traverse((o) => { if (o.isHemisphereLight && hemi === null) hemi = o.intensity; });
    return hemi;
  });
  if (pinHeld !== 0) {
    throw new Error(`the hemisphere pin did not hold (intensity=${pinHeld} after 600 ms of frames). `
      + 'Every contribution number below would be measuring a light that stayed on.');
  }

  const POSES = [
    { id: 'p1-door-in', where: 'interior', x: -0.8, z: 4.2, yaw: Math.PI, pitch: -0.02 },
    { id: 'p2-retail-wall', where: 'interior', x: -1.2, z: 0.6, yaw: -Math.PI / 2, pitch: 0.02 },
    { id: 'p3-under-faulted-run', where: 'interior', x: -0.2, z: -1.6, yaw: 0, pitch: 0.55 },
    { id: 'p4-desk-approach', where: 'interior', x: 2.4, z: 2.4, yaw: Math.PI * 0.75, pitch: -0.05 },
    // The bill. Any proposal that dims these two has to be paid for out here.
    { id: 'c1-porch-out', where: 'course', x: -0.8, z: 9.5, yaw: 0, pitch: -0.05 },
    { id: 'c2-fairway', where: 'course', x: 6.0, z: 26.0, yaw: 0.4, pitch: -0.02 },
  ];
  const VARIANTS = [
    { id: 'as-shipped', hemi: 1, ambient: 1 },
    { id: 'no-hemisphere', hemi: 0, ambient: 1 },
    { id: 'no-ambient', hemi: 1, ambient: 0 },
    { id: 'neither', hemi: 0, ambient: 0 },
  ];

  const rows = [];
  for (const pose of POSES) {
    for (const variant of VARIANTS) {
      // eslint-disable-next-line no-await-in-loop
      await setLights(variant.hemi, variant.ambient);
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((p) => {
        const app = window.__fw;
        const o = app.scene3d.clubhouse().center;
        const w = app.scene3d.walk.state;
        w.x = p.x + o.x; w.z = p.z + o.z; w.yaw = p.yaw; w.pitch = p.pitch;
      }, pose);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(650);
      const file = path.join(shotDir, `${pose.id}-${variant.id}.png`);
      // eslint-disable-next-line no-await-in-loop
      const buf = await page.screenshot({ path: file });
      const img = decodePng(buf);
      rows.push({
        pose: pose.id,
        where: pose.where,
        variant: variant.id,
        whole: stats(img, WHOLE),
        ceilingBand: pose.where === 'interior' ? stats(img, CEILING_BAND) : null,
        navBand: pose.where === 'interior' ? stats(img, NAV_BAND) : null,
      });
    }
  }
  await unpinLights();

  const at = (pose, variant) => rows.find((r) => r.pose === pose && r.variant === variant);
  const contribution = POSES.map((p) => {
    const base = at(p.id, 'as-shipped').whole.mean;
    const noHemi = at(p.id, 'no-hemisphere').whole.mean;
    const noAmb = at(p.id, 'no-ambient').whole.mean;
    const neither = at(p.id, 'neither').whole.mean;
    const pct = (v) => (base > 0 ? +(((base - v) / base) * 100).toFixed(1) : 0);
    return {
      pose: p.id,
      where: p.where,
      asShipped: base,
      hemisphereContributes: +(base - noHemi).toFixed(2),
      hemispherePct: pct(noHemi),
      ambientContributes: +(base - noAmb).toFixed(2),
      ambientPct: pct(noAmb),
      bothContribute: +(base - neither).toFixed(2),
      bothPct: pct(neither),
      remainingWithoutThem: neither,
    };
  });

  const mean = (list, key) => +(list.reduce((a, r) => a + r[key], 0) / list.length).toFixed(2);
  const interior = contribution.filter((c) => c.where === 'interior');
  const course = contribution.filter((c) => c.where === 'course');

  const out = {
    circuitPowered: false,
    shippedIntensities: lights,
    contribution,
    summary: {
      interiorMeanAsShipped: mean(interior, 'asShipped'),
      interiorMeanWithoutBoth: mean(interior, 'remainingWithoutThem'),
      interiorBothPct: mean(interior, 'bothPct'),
      courseMeanAsShipped: mean(course, 'asShipped'),
      courseMeanWithoutBoth: mean(course, 'remainingWithoutThem'),
      courseBothPct: mean(course, 'bothPct'),
    },
    rows,
    shots: shotDir,
  };
  fs.writeFileSync(path.join(outDir, 'world-light-contribution.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out.summary;
}
