// A1 — IS THE INDOOR SPIKE A TEXTURE UPLOAD?
//
// The lead: indoor spikes submit byte-identical draw calls and triangles to calm
// frames, arrive on a ~74 ms rhythm, and show no heap drop. That is the exact
// signature of a texture re-upload, and this codebase has measured one before —
// the ledger's page canvases cost "~55 ms per needsUpdate REGARDLESS of canvas
// size" until mipmaps were turned off (ledgerBook.js:175).
//
// HOW TO SEE AN UPLOAD WITHOUT PATCHING ANYTHING. `needsUpdate` is a setter on
// THREE.Texture that does `this.version++`. So a texture whose version rose
// since last frame will be re-uploaded on this one. Collect every texture in the
// scene ONCE, then per frame sum their versions — a jump in the sum IS an upload,
// and reading a fixed array of numbers costs nothing the measurement will notice.
//
// (Traversing the scene every frame would have been the obvious way to do this
// and would have made the driver itself one of the spikes.)
//
// THE CONTROLS: the calm frames of the same run for the correlation, and the
// OUTDOOR window for the place. If version bumps coincide with spikes indoors
// and there are none outdoors, the lead is confirmed; if bumps and spikes are
// independent, it is dead and the ~74 ms rhythm belongs to something else.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-texture-uploads.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-texture-uploads');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  const sample = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    // Collect once. Named where possible so a culprit can be pointed at.
    const texes = [];
    const seen = new Set();
    const SLOTS = ['map', 'emissiveMap', 'alphaMap', 'aoMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'lightMap'];
    s3.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        for (const slot of SLOTS) {
          const t = m[slot];
          if (!t || seen.has(t.uuid)) continue;
          seen.add(t.uuid);
          let label = o.name || '';
          let p = o.parent;
          while (!label && p) { label = p.name || ''; p = p.parent; }
          texes.push({
            t,
            slot,
            owner: label || '(unnamed)',
            isCanvas: !!(t.image && t.image.tagName === 'CANVAS'),
          });
        }
      }
    });
    const rows = [];
    let prev = performance.now();
    let prevSum = texes.reduce((a, x) => a + x.t.version, 0);
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      let sum = 0;
      const bumped = [];
      for (const x of texes) {
        sum += x.t.version;
        if (x.t.version !== x.last) {
          if (x.last !== undefined) bumped.push(`${x.owner}:${x.slot}${x.isCanvas ? ':canvas' : ''}`);
          x.last = x.t.version;
        }
      }
      rows.push({
        t: +(now - t0).toFixed(0),
        dt: +(now - prev).toFixed(2),
        dVersions: sum - prevSum,
        bumped: bumped.slice(0, 4),
      });
      prev = now; prevSum = sum;
      if (now - t0 < dur) requestAnimationFrame(tick);
      else {
        resolve({
          rows,
          textureCount: texes.length,
          canvasCount: texes.filter((x) => x.isCanvas).length,
          canvasOwners: [...new Set(texes.filter((x) => x.isCanvas).map((x) => x.owner))].slice(0, 20),
        });
      }
    };
    requestAnimationFrame(tick);
  }), ms);

  const analyse = (res) => {
    const rows = res.rows.slice(1); // the first row has no previous to compare
    const spike = rows.filter((r) => r.dt > 16.7);
    const calm = rows.filter((r) => r.dt <= 16.7);
    const withBump = rows.filter((r) => r.dVersions > 0);
    const pct = (a, b) => (b ? +((a / b) * 100).toFixed(1) : null);
    const tally = {};
    for (const r of spike) for (const b of r.bumped) tally[b] = (tally[b] || 0) + 1;
    return {
      textureCount: res.textureCount,
      canvasCount: res.canvasCount,
      canvasOwners: res.canvasOwners,
      frames: rows.length,
      spikes: spike.length,
      framesWithUpload: withBump.length,
      uploadSharePct: pct(withBump.length, rows.length),
      // THE CORRELATION, both directions.
      spikesThatUploaded: spike.filter((r) => r.dVersions > 0).length,
      spikesThatUploadedPct: pct(spike.filter((r) => r.dVersions > 0).length, spike.length),
      calmThatUploadedPct: pct(calm.filter((r) => r.dVersions > 0).length, calm.length),
      topBumpedOnSpikes: Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  };

  out.outdoor = analyse(await sample(11000));
  out.teleport = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw?.scene3d?.clubhouse?.();
    const st = fw?.scene3d?.walk?.state;
    if (!ch || !st) return { ok: false };
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 3.0;
    st.z = book.z + (to.z / len) * 3.0;
    st.pitch = -0.2;
    return { ok: true, inside: !!ch.isInside(st.x, st.z, 0.35) };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(4000);
  out.indoor = analyse(await sample(11000));

  out.verdict = {
    inside: out.teleport?.inside ?? null,
    indoorCanvasTextures: out.indoor.canvasCount,
    outdoorCanvasTextures: out.outdoor.canvasCount,
    indoorUploadSharePct: out.indoor.uploadSharePct,
    outdoorUploadSharePct: out.outdoor.uploadSharePct,
    // If uploads cause spikes, the first is high and the second is low.
    indoorSpikesThatUploadedPct: out.indoor.spikesThatUploadedPct,
    indoorCalmThatUploadedPct: out.indoor.calmThatUploadedPct,
  };
  fs.writeFileSync(path.join(OUT, 'a1-texture-uploads.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-TEX', JSON.stringify(out.verdict));
  console.log('  indoor top bumped on spikes:', JSON.stringify(out.indoor.topBumpedOnSpikes));
  console.log('  indoor canvas owners:', JSON.stringify(out.indoor.canvasOwners));
  return out;
}
