// WHICH FIELD TURNS THE CAMERA?
//
// apparel-v7-shelf.js calibrates the yaw sign by writing walk.state.yaw and
// reading the camera back. It came back 0.000 rad: the write did nothing. That
// silently voided every frame in the run -- the sightline sweep picks a clear
// bearing, writes it to walk.state.yaw, and if that write is inert the garment
// is placed along the ORIGINAL forward, which is a wall. The frames were of
// plaster and the maps table beside them still said MAPS 2/3, so they looked
// like results.
//
// This asks the API instead of assuming: what is on walk.state, and which of
// its fields actually moves the camera.
//
//   node tools/qa/run-electron.cjs tools/qa/v7-yaw-probe.js --clubhouse=pine-hills-v2
async (page) => {
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(1000);
  const boot = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 180000 });
  } catch { /* keep going */ }
  await page.waitForTimeout(2500);

  const shape = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    const state = w.state || {};
    return {
      walkKeys: Object.keys(w).filter((k) => typeof w[k] !== 'object'),
      walkFns: Object.keys(w).filter((k) => typeof w[k] === 'function'),
      stateKeys: Object.keys(state),
      yaw: state.yaw, pitch: state.pitch,
      isActive: w.isActive?.() ?? null,
    };
  });
  console.log('walk.state keys :', shape.stateKeys.join(', '));
  console.log('walk functions  :', shape.walkFns.join(', '));
  console.log(`walk.isActive() : ${shape.isActive}   yaw ${shape.yaw}  pitch ${shape.pitch}`);

  const readCam = () => page.evaluate(() => {
    const app = window.__fw;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k]; if (v && v.isCamera) { cam = v; break; }
    }
    cam.updateMatrixWorld(true);
    return {
      ry: +cam.rotation.y.toFixed(4),
      yaw: +(app.scene3d.walk.state.yaw ?? NaN).toFixed(4),
      camName: cam.name || cam.type,
      parent: cam.parent ? (cam.parent.name || cam.parent.type) : null,
    };
  });

  // ONE FIELD AT A TIME, each with the write read back and the camera read
  // back after a real tick. A field that holds its value but does not move the
  // camera is a different fault from one the sim overwrites.
  const CANDIDATES = ['yaw', 'heading', 'ry', 'rotY', 'angle', 'lookYaw'];
  const before = await readCam();
  console.log(`\ncamera ${before.camName} under ${before.parent}: rotation.y ${before.ry}`);
  for (const field of CANDIDATES) {
    const applied = await page.evaluate((f) => {
      const s = window.__fw.scene3d.walk.state;
      if (!(f in s)) return { present: false };
      const was = s[f];
      s[f] = was + 0.4;
      return { present: true, was, wrote: s[f] };
    }, field);
    if (!applied.present) { console.log(`  ${field.padEnd(8)} not on walk.state`); continue; }
    await page.waitForTimeout(600);
    const after = await readCam();
    const held = await page.evaluate((f) => window.__fw.scene3d.walk.state[f], field);
    const d = after.ry - before.ry;
    console.log(`  ${field.padEnd(8)} wrote ${applied.was.toFixed(3)} -> ${applied.wrote.toFixed(3)}, `
      + `state now ${Number(held).toFixed(3)}, camera rotation.y moved ${d.toFixed(4)} rad`);
    // put it back
    await page.evaluate(([f, v]) => { window.__fw.scene3d.walk.state[f] = v; }, [field, applied.was]);
    await page.waitForTimeout(400);
  }

  // AND THE OTHER WAY: does the game have a method for it?
  const viaFn = await page.evaluate(async () => {
    const w = window.__fw.scene3d.walk;
    const names = Object.keys(w).filter((k) => typeof w[k] === 'function'
      && /look|yaw|face|turn|aim|orient/i.test(k));
    return names;
  });
  console.log(`\nfunctions that look like aiming: ${viaFn.join(', ') || '(none)'}`);

  // MOUSE LOOK IS THE REAL PATH. If the camera only turns through the pointer,
  // that is what the acceptance driver has to use.
  const beforeM = await readCam();
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    c?.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, movementX: 200, movementY: 0,
    }));
  });
  await page.waitForTimeout(600);
  const afterM = await readCam();
  console.log(`mousemove movementX=200: camera rotation.y ${beforeM.ry} -> ${afterM.ry} `
    + `(${(afterM.ry - beforeM.ry).toFixed(4)} rad), walk.state.yaw ${beforeM.yaw} -> ${afterM.yaw}`);

  return { shape };
}
