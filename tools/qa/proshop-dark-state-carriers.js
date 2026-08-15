async (page) => {
  // B8 FOLLOW-UP â€” the fill lever is spent (interiorFillScale ships at 0.10 and
  // the whole remaining range moves the room ~10%), so before any next lever is
  // chosen this measures WHAT CARRIES the remaining interior luma at the same
  // four unpowered poses, one contributor at a time.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-dark-state-carriers.js
  //
  // The light inventory is discovered, not assumed: the first run of this probe
  // pinned only sun/hemi/ambient and its `none` captures still showed a fully
  // readable room â€” the clubhouse's own interior lights (the daylight fills and
  // any fixture lights) were never in the pin set, so the "floor" number was
  // conflating them with the glazing view. Every light in the scene is now
  // inventoried, classified (sun / hemi / ambient / other), and the `none`
  // variant pins ALL of them. What still cannot be removed â€” emissive
  // materials and the bright course seen through the glazing itself â€” is the
  // floor `none` names. The hemisphere's INDOOR value is the interior fill
  // (updateInteriorFill multiplies it by 1 - factor*(1-scale), so "fill
  // remnant" and "hemi leak" are one lever with two ends).
  //
  // Discipline inherited from proshop-world-light-contribution.js: per-frame
  // writes make plain assignment a no-op, so intensities are PINNED via an
  // accessor and the pin is PROVEN to hold before anything is measured with it.
  // Built-in control: `fill-0` (setScale(0), hemi live) and `no-hemi` (hemi
  // pinned 0) must agree at fully-interior poses â€” if they disagree beyond
  // noise, the fill factor is not 1 at that pose and the numbers say so.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const zlib = process.getBuiltinModule('node:zlib');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  const shotDir = path.join(outDir, 'dark-state-carriers');
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
    // The FULL overlay set from the B8 sweep (fault 4 in DARK_STATE_PROPOSAL:
    // the chips are .hud-min and the lock hint .shop-lockhint sits inside the
    // nav-band crop â€” the first run of this probe cloned the older, weaker
    // selector list and measured white caption text as room luma).
    document.querySelectorAll('.hud, .hud-min, .shop-lockhint, .notification-center, '
      + '.walk-overlay, .objectives-card, .shed-checklist')
      .forEach((n) => { n.style.display = 'none'; });
  });

  // Same gate as every dark-state instrument: a powered room measures nothing.
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

  // DISCOVER the full light inventory. The first run assumed three globals and
  // was wrong â€” the clubhouse carries its own interior lights that kept the
  // `none` room readable. Each light is classified and given a stable index so
  // pins can name their base values.
  const inventory = await page.evaluate(() => {
    const lights = [];
    window.__fw.scene3d.scene.traverse((o) => {
      if (!o.isLight) return;
      const role = o.isDirectionalLight ? 'sun'
        : o.isHemisphereLight ? 'hemi'
          : o.isAmbientLight ? 'ambient' : 'other';
      o.__carrierIdx = lights.length;
      lights.push({
        idx: o.__carrierIdx,
        role,
        type: o.type,
        name: o.name || o.parent?.name || '',
        intensity: o.intensity,
      });
    });
    return lights;
  });
  const roles = (r) => inventory.filter((l) => l.role === r);
  if (!roles('sun').length || !roles('hemi').length || !roles('ambient').length) {
    throw new Error(`missing a global light: ${JSON.stringify(inventory)}`);
  }
  const shipped = { fillScale: await page.evaluate(() => window.__fw.scene3d.interiorFill.scale()) };

  // Pin/unpin by ROLE. A pin replaces `intensity` with an accessor so any
  // frame-loop write is a no-op for the capture; unpin restores the plain
  // property at its inventoried base (applyTimeWeather rewrites sun and hemi
  // on the next frame anyway; nothing rewrites the others, so the base
  // matters for them).
  const applyVariant = (v) => page.evaluate(([variant, base, inv]) => {
    const scene = window.__fw.scene3d;
    scene.interiorFill.setScale(variant.fillScale ?? base.fillScale);
    const zeroRoles = new Set(variant.zero || []);
    const byIdx = new Map(inv.map((l) => [l.idx, l]));
    const pin = (light, value) => {
      light.__pinned = value;
      const own = Object.getOwnPropertyDescriptor(light, 'intensity');
      if (own && own.get) return;
      Object.defineProperty(light, 'intensity', {
        configurable: true,
        get() { return this.__pinned; },
        set() { /* frame-loop write deliberately ignored while pinned */ },
      });
    };
    const unpin = (light, value) => {
      delete light.intensity;
      delete light.__pinned;
      light.intensity = value;
    };
    scene.scene.traverse((o) => {
      if (!o.isLight || o.__carrierIdx === undefined) return;
      const entry = byIdx.get(o.__carrierIdx);
      if (!entry) return;
      if (zeroRoles.has(entry.role)) pin(o, 0);
      else unpin(o, entry.intensity);
    });
  }, [v, shipped, inventory]);

  // NEGATIVE CONTROL before any measurement: prove the sun pin actually holds
  // against the weather branches, the same proof the hemisphere needed. (This
  // control already caught one real fault: a refactor changed the variant
  // shape to `zero: [...]` and the old `{ sun: 0 }` call pinned nothing â€” the
  // run failed here instead of shipping numbers with the sun still on.)
  await applyVariant({ zero: ['sun'] });
  await page.waitForTimeout(600);
  const sunPinned = await page.evaluate(() => {
    let sun = null;
    window.__fw.scene3d.scene.traverse((o) => { if (o.isDirectionalLight && sun === null) sun = o.intensity; });
    return sun;
  });
  if (sunPinned !== 0) {
    throw new Error(`the sun pin did not hold (intensity=${sunPinned} after 600 ms). `
      + 'Every carrier number below would include a sun that stayed on.');
  }
  await applyVariant({});
  const scaleRoundTrip = await page.evaluate(() => {
    const f = window.__fw.scene3d.interiorFill;
    f.setScale(0); const zero = f.scale(); f.setScale(0.10);
    return zero;
  });
  if (scaleRoundTrip !== 0) throw new Error(`setScale(0) clamps to ${scaleRoundTrip}; fill-0 would be mislabeled`);

  const POSES = [
    { id: 'p1-door-in', where: 'interior', x: -0.8, z: 4.2, yaw: Math.PI, pitch: -0.02 },
    { id: 'p2-retail-wall', where: 'interior', x: -1.2, z: 0.6, yaw: -Math.PI / 2, pitch: 0.02 },
    { id: 'p3-under-faulted-run', where: 'interior', x: -0.2, z: -1.6, yaw: 0, pitch: 0.55 },
    { id: 'p4-desk-approach', where: 'interior', x: 2.4, z: 2.4, yaw: Math.PI * 0.75, pitch: -0.05 },
    // The bill: any lever that dims a GLOBAL term is paid for out here.
    { id: 'c1-porch-out', where: 'course', x: -0.8, z: 9.5, yaw: 0, pitch: -0.05 },
    { id: 'c2-fairway', where: 'course', x: 6.0, z: 26.0, yaw: 0.4, pitch: -0.02 },
  ];
  const VARIANTS = [
    { id: 'as-shipped' },
    { id: 'no-sun', zero: ['sun'] },
    { id: 'fill-0', fillScale: 0 },
    { id: 'no-hemi', zero: ['hemi'] },
    { id: 'no-ambient', zero: ['ambient'] },
    // Every light that is not one of the three globals â€” the clubhouse's own
    // interior daylight fills and any fixture lights. Its course poses are a
    // control: interior lights should carry ~nothing on the fairway.
    { id: 'no-interior-fills', zero: ['other'] },
    { id: 'none', zero: ['sun', 'hemi', 'ambient', 'other'], fillScale: 0 },
  ];

  const rows = [];
  for (const pose of POSES) {
    for (const variant of VARIANTS) {
      // eslint-disable-next-line no-await-in-loop
      await applyVariant(variant);
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((p) => {
        const app = window.__fw;
        const o = app.scene3d.clubhouse().interior.position;
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
  await applyVariant({});

  const at = (pose, variant) => rows.find((r) => r.pose === pose && r.variant === variant);
  const carriers = POSES.map((p) => {
    const base = at(p.id, 'as-shipped').whole.mean;
    const d = (variant) => +(base - at(p.id, variant).whole.mean).toFixed(2);
    const pct = (variant) => (base > 0 ? +((d(variant) / base) * 100).toFixed(1) : 0);
    return {
      pose: p.id,
      where: p.where,
      asShipped: base,
      sunCarries: d('no-sun'),
      sunPct: pct('no-sun'),
      fillRemnantCarries: d('fill-0'),
      fillRemnantPct: pct('fill-0'),
      hemiCarries: d('no-hemi'),
      hemiPct: pct('no-hemi'),
      ambientCarries: d('no-ambient'),
      ambientPct: pct('no-ambient'),
      interiorFillsCarry: d('no-interior-fills'),
      interiorFillsPct: pct('no-interior-fills'),
      floorWithoutAll: at(p.id, 'none').whole.mean,
      floorPct: (base > 0 ? +((at(p.id, 'none').whole.mean / base) * 100).toFixed(1) : 0),
      // The built-in control: indoors these two should agree within noise.
      fillVsHemiControlDelta: +(at(p.id, 'fill-0').whole.mean - at(p.id, 'no-hemi').whole.mean).toFixed(2),
    };
  });

  const mean = (list, key) => +(list.reduce((a, r) => a + r[key], 0) / list.length).toFixed(2);
  const interior = carriers.filter((c) => c.where === 'interior');
  const course = carriers.filter((c) => c.where === 'course');
  const out = {
    circuitPowered: false,
    shipped,
    lightInventory: inventory,
    carriers,
    summary: {
      interiorAsShipped: mean(interior, 'asShipped'),
      interiorSunPct: mean(interior, 'sunPct'),
      interiorFillRemnantPct: mean(interior, 'fillRemnantPct'),
      interiorAmbientPct: mean(interior, 'ambientPct'),
      interiorFillsPct: mean(interior, 'interiorFillsPct'),
      interiorFloorPct: mean(interior, 'floorPct'),
      courseSunPct: mean(course, 'sunPct'),
      courseHemiPct: mean(course, 'hemiPct'),
      courseAmbientPct: mean(course, 'ambientPct'),
      courseInteriorFillsPct: mean(course, 'interiorFillsPct'),
    },
    rows,
    shots: shotDir,
  };
  fs.writeFileSync(path.join(outDir, 'dark-state-carriers.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out.summary;
}
