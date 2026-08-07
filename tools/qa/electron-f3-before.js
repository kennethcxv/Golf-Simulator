// F3 BEFORE-CONTROL (Full_Goal_16): run against the PRE-F3 register module
// (the E-commit version, swapped in by the caller and restored afterward).
// The old build's signature under the SAME instrument: the projected bbox
// height COLLAPSES while the item still has pixels (a shrink), and the item
// ends packed at 0.38 scale, visible, in the carrier. The fixed build's run
// (f-checkout) shows the opposite: bbox steady, pixels to zero, hidden at
// full scale.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd()}/`);
  const sharp = require2('sharp');
  const OUT = path.resolve('qa/electron/f-checkout');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.bringToFront().catch(() => {});
  const out = {};

  out.stage = await page.evaluate(async () => {
    const state = window.__fw.state;
    const sign = await import(new URL('src/sim/shopSign.js', document.baseURI).href);
    if (!sign.signIsOpen(state)) sign.flipSign(state, ((state.clock.minutes % 1440) + 1440) % 1440);
    window.__fw.speedIdx = 1;
    const stocked = Object.entries(state.shop.inventory || {})
      .filter(([, inv]) => inv && inv.shelf > 0).map(([sku]) => sku).slice(0, 1);
    if (!stocked.length) return { fail: 'no stock' };
    const ch = window.__fw.scene3d.clubhouse();
    const name = ch.sendToCounter(stocked, 'cash');
    window.__fc = ch.customerByName(name);
    return { spawned: !!window.__fc };
  });
  const staged = await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return ch.register.hasTx() && !!window.__fc?.awaitingCheckout;
  }, null, { timeout: 120000 }).then(() => true).catch(() => false);
  out.staged = staged;
  if (!staged) {
    fs.writeFileSync(path.join(OUT, 'f3-before.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const st = s3.walk.stations()[0];
    const w = s3.walk.state;
    w.x = st.x; w.z = st.z + 1.15;
    w.yaw = Math.atan2(-(st.x - w.x), -(st.z - w.z));
    w.pitch = -0.2;
  });
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  await page.waitForTimeout(1000);

  const setup = await page.evaluate(async () => {
    const s3 = window.__fw.scene3d;
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const tx = s3.clubhouse().register.getTx();
    const uid = tx.items[0].uid;
    let mesh = null;
    s3.scene.traverse((o) => { if (!mesh && o.userData && o.userData.uid === uid) mesh = o; });
    if (!mesh) return { fail: 'no mesh' };
    const saved = [];
    mesh.traverse((o) => {
      if (o.isMesh) {
        saved.push([o, o.material]);
        o.material = new THREE.MeshBasicMaterial({ color: 0xff0000, fog: false });
      }
    });
    window.__b4restore = () => { for (const [o, m] of saved) o.material = m; };
    window.__b4tone = s3.renderer.toneMapping;
    s3.renderer.toneMapping = THREE.NoToneMapping;
    s3.setPostEnabled?.(false);
    window.__b4track = [];
    const tick = () => {
      let m = null;
      s3.scene.traverse((o) => { if (!m && o.userData && o.userData.uid === uid) m = o; });
      if (m && m.visible) {
        const box = new THREE.Box3().setFromObject(m);
        const pts = [[box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z],
          [box.min.x, box.max.y, box.min.z], [box.max.x, box.min.y, box.max.z]];
        let lo = Infinity; let hi = -Infinity;
        for (const [x, y, z] of pts) {
          const v = new THREE.Vector3(x, y, z).project(s3.camera);
          lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
        }
        window.__b4track.push({ h: +(((hi - lo) / 2) * window.innerHeight).toFixed(1), s: +m.scale.x.toFixed(3), vis: m.visible });
      }
      if (window.__b4track.on !== false) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const wp = mesh.getWorldPosition(new THREE.Vector3());
    const v = wp.project(s3.camera);
    return { uid, x: (v.x + 1) / 2 * window.innerWidth, y: (1 - (v.y + 1) / 2) * window.innerHeight };
  });
  if (setup.fail) {
    fs.writeFileSync(path.join(OUT, 'f3-before.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }
  await page.mouse.click(setup.x, setup.y);
  const frames = [];
  const countRed = async (file) => {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 190 && data[i + 1] < 90 && data[i + 2] < 90) n += 1;
    }
    return n;
  };
  for (let i = 0; i < 8; i += 1) {
    const file = path.join(OUT, `f3-before-${i}.png`);
    await page.screenshot({ path: file });
    frames.push({ i, red: await countRed(file) });
    await page.waitForTimeout(50);
  }
  out.frames = frames;
  out.track = await page.evaluate(([uid]) => {
    window.__b4track.on = false;
    window.__b4restore?.();
    const s3 = window.__fw.scene3d;
    s3.renderer.toneMapping = window.__b4tone;
    s3.setPostEnabled?.(true);
    let m = null;
    s3.scene.traverse((o) => { if (!m && o.userData && o.userData.uid === uid) m = o; });
    return {
      samples: window.__b4track.slice(-40),
      finalVisible: m ? m.visible : null,
      finalScale: m ? +m.scale.x.toFixed(3) : null,
    };
  }, [setup.uid]);
  const hs = out.track.samples.map((s2) => s2.h);
  const ss = out.track.samples.map((s2) => s2.s);
  out.signature = {
    bboxCollapse: hs.length >= 4 ? +(1 - Math.min(...hs) / Math.max(...hs)).toFixed(3) : null,
    scaleCollapse: ss.length >= 4 ? +(1 - Math.min(...ss) / Math.max(...ss)).toFixed(3) : null,
  };
  // the BEFORE signature: scale and bbox both collapse hard, and the packed
  // item is still VISIBLE (a miniature keepsake in the bag)
  out.beforeSignature = (out.signature.scaleCollapse ?? 0) > 0.4
    && (out.signature.bboxCollapse ?? 0) > 0.3
    && out.track.finalVisible === true
    && (out.track.finalScale ?? 1) < 0.6;
  fs.writeFileSync(path.join(OUT, 'f3-before.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
