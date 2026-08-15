async (page) => {
  // PHASE 4 — the §3 key-light measurement. Bible §3's own correction: whole-
  // frame means cannot tell "darker everywhere" from "darker at the contact",
  // so this probe reads CROPS — contact bands at object bases and a vertical
  // face band — at identical poses with the key off and on, driven live via
  // the shell's __FW_KEY_LIGHT_SCALE QA hook (0 = off, 1 = authored). The
  // decision the numbers feed: adopt if the key buys tonal separation
  // (face-vs-floor delta) without flattening contacts or global washout.
  //
  // RESOLVED 2026-07-28: the candidate was REJECTED on this probe's numbers
  // (Phase4/data/phase4-keylight-probe.json — floor-biased global lift, no
  // face separation) and the key light plus its QA hook were removed. Bible
  // §3/§12 record the resolution. The harness stays as the instrument for
  // any future candidate: with no key in the build, both passes measure
  // identically and every delta reads 0.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-phase4-keylight-probe.js
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const zlib = process.getBuiltinModule('node:zlib');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.PHASE4_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Phase4', 'data'));
  const shotDir = path.resolve(process.env.PHASE4_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Phase4', 'screenshots', 'keylight-probe'));
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(shotDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  // Minimal PNG reader (8-bit RGB/RGBA, non-interlaced — what Chromium
  // screenshots are). Un-filters all five filter types; returns mean sRGB
  // luma over a rect.
  const decodePng = (buffer) => {
    if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
    let pos = 8;
    let width = 0; let height = 0; let bitDepth = 0; let colorType = 0;
    const idat = [];
    while (pos < buffer.length) {
      const len = buffer.readUInt32BE(pos);
      const type = buffer.toString('ascii', pos + 4, pos + 8);
      const data = buffer.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
        if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) {
          throw new Error(`unsupported PNG shape: depth ${bitDepth} color ${colorType} interlace ${data[12]}`);
        }
      } else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const bpp = colorType === 6 ? 4 : 3;
    const stride = width * bpp;
    const out = Buffer.alloc(height * stride);
    const paeth = (a, b, c) => {
      const p = a + b - c;
      const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)];
      const rowIn = (y * (stride + 1)) + 1;
      const rowOut = y * stride;
      for (let x = 0; x < stride; x++) {
        const rawByte = raw[rowIn + x];
        const left = x >= bpp ? out[rowOut + x - bpp] : 0;
        const up = y > 0 ? out[rowOut - stride + x] : 0;
        const upLeft = y > 0 && x >= bpp ? out[rowOut - stride + x - bpp] : 0;
        let value;
        switch (filter) {
          case 0: value = rawByte; break;
          case 1: value = rawByte + left; break;
          case 2: value = rawByte + up; break;
          case 3: value = rawByte + ((left + up) >> 1); break;
          case 4: value = rawByte + paeth(left, up, upLeft); break;
          default: throw new Error(`bad PNG filter ${filter}`);
        }
        out[rowOut + x] = value & 0xff;
      }
    }
    return { width, height, bpp, data: out };
  };
  const cropLuma = (png, rect) => {
    let sum = 0; let n = 0;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = (y * png.width + x) * png.bpp;
        sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
        n += 1;
      }
    }
    return sum / Math.max(1, n);
  };

  // Poses + their crop bands (1600×900 screen space). Contact bands sit at
  // object-base/floor lines; face bands on vertical surfaces — separation is
  // face-band minus adjacent floor-band movement.
  const POSES = [
    {
      id: 'p04-checkout', at: [0.0, 0.2], look: [0.0, 3.4], pitch: -0.16,
      crops: {
        deskBaseContact: { x: 600, y: 620, w: 400, h: 60 },
        floorOpen: { x: 240, y: 780, w: 300, h: 80 },
        deskFace: { x: 620, y: 470, w: 360, h: 100 },
      },
    },
    {
      id: 'p11-wide', at: [-2.3, -4.1], look: [4.6, 3.2], pitch: -0.05,
      crops: {
        tableBaseContact: { x: 760, y: 660, w: 320, h: 50 },
        floorOpen: { x: 420, y: 760, w: 360, h: 90 },
        wallFace: { x: 120, y: 420, w: 260, h: 160 },
      },
    },
    {
      id: 'p13-route', at: [-0.6, 4.8], look: [-0.9, -4.2], pitch: -0.30,
      crops: {
        fixtureBaseContact: { x: 300, y: 600, w: 340, h: 60 },
        floorOpen: { x: 700, y: 640, w: 360, h: 100 },
        sageBandFace: { x: 780, y: 420, w: 420, h: 70 },
      },
    },
  ];

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // Powered, all panels serviced — the key's fullest state; clock pinned.
  await page.evaluate(async () => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    R.restorationAction(app.state, { type: 'repair-component', component: 'ceiling', progress: 1 });
    const snapshot = R.restorationSnapshot(app.state);
    for (const targetId of Object.keys(snapshot?.targetProgress || {})) {
      if (targetId.startsWith('ceiling:')) R.restorationAction(app.state, { type: 'repair-light', targetId });
    }
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
    app.scene3d.clubhouse().pineHillsInterior?.refresh?.();
  });
  await page.waitForTimeout(14000);

  const setPose = (pose) => page.evaluate(({ p, minuteOfDay }) => {
    const app = window.__fw;
    const s3 = app.scene3d;
    const o = s3.clubhouse().interior.position;
    const w = s3.walk;
    w.clearKeys();
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + minuteOfDay;
    s3.applyTimeWeather(minuteOfDay, app.state.weather);
    const ax = o.x + p.at[0];
    const az = o.z + p.at[1];
    const dx = (o.x + p.look[0]) - ax;
    const dz = (o.z + p.look[1]) - az;
    const d = Math.hypot(dx, dz) || 1;
    w.state.x = ax; w.state.z = az;
    w.state.yaw = Math.atan2(-dx / d, -dz / d);
    w.state.pitch = p.pitch;
  }, { p: pose, minuteOfDay: 13 * 60 });

  const setKeyScale = (scale) => page.evaluate((s) => {
    window.__FW_KEY_LIGHT_SCALE = s;
    // applyPracticalLevels re-reads the hook on the next state application —
    // re-pinning the clock forces one immediately.
    const app = window.__fw;
    app.scene3d.applyTimeWeather(app.state.clock.minutes % 1440, app.state.weather);
    const key = app.scene3d.scene.getObjectByName('PineHillsInteriorKeyLight');
    return key ? { intensity: +key.intensity.toFixed(3), visible: key.visible } : null;
  }, scale);

  const measures = [];
  for (const scale of [0, 1]) {
    const keyState = await setKeyScale(scale);
    for (const pose of POSES) {
      await setPose(pose);
      await page.waitForTimeout(900);
      const buffer = await page.screenshot();
      fs.writeFileSync(path.join(shotDir, `${pose.id}--key${scale}.png`), buffer);
      const png = decodePng(buffer);
      const crops = {};
      for (const [name, rect] of Object.entries(pose.crops)) {
        crops[name] = +cropLuma(png, rect).toFixed(2);
      }
      measures.push({ pose: pose.id, keyScale: scale, keyState, crops });
    }
  }

  // Pair up off/on per pose and compute deltas.
  const deltas = POSES.map((pose) => {
    const off = measures.find((m) => m.pose === pose.id && m.keyScale === 0);
    const on = measures.find((m) => m.pose === pose.id && m.keyScale === 1);
    const d = {};
    for (const name of Object.keys(pose.crops)) {
      d[name] = +(on.crops[name] - off.crops[name]).toFixed(2);
    }
    return { pose: pose.id, off: off.crops, on: on.crops, delta: d };
  });

  const result = {
    hook: '__FW_KEY_LIGHT_SCALE',
    poses: POSES.map((p) => ({ id: p.id, at: p.at, look: p.look, pitch: p.pitch, crops: p.crops })),
    measures,
    deltas,
    errs: errs.slice(0, 12),
    ok: errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'phase4-keylight-probe.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
