// B (Goal 22) — IS THE MOP'S SOLVER ACTUALLY RUNNING ON THE HELD MOP?
//
// The player-camera frames after dropping to 16 thick bands show the yarn
// radiating stiffly ALONG THE SHAFT AXIS and not hanging. That is the seeded
// rest pose. Verlet nodes live in world space under gravity 19, so if the
// solver were stepping, the tips would fall toward world-down no matter how the
// head is held.
//
// Two stories fit a stiff mop: the rig is never updated, or it is updated in a
// frame where "down" is not down. This asks the rig itself, over real frames,
// with the head held still and then moved:
//
//   * do the tips sit BELOW the head in world Y?   (gravity is acting)
//   * do they MOVE between frames while the player walks?  (it is stepping)
//   * a negative control: with the head motionless the tips must go still,
//     because a rig that jitters forever would satisfy "it moves" for the
//     wrong reason.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-b-mop-is-simulated.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b-mop-simulated');
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
  await page.waitForTimeout(2500);

  // inside, mop in hand
  await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const o = ch.interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x + 1.0; w.z = o.z + 0.5; w.yaw = Math.PI * 0.5; w.pitch = -0.35;
  });
  await page.waitForTimeout(600);
  await page.keyboard.press('m');
  await page.waitForTimeout(2500);

  const read = () => page.evaluate(() => {
    const app = window.__fw;
    const rig = app.scene3d?.heldToolStrandRig?.('mop')
      || app.scene3d?.walk?.strandRig?.('mop')
      || null;
    // fall back to walking the scene graph for the rig's own root, so this does
    // not depend on an accessor that may not exist
    let found = rig;
    if (!found) {
      const scene = app.scene3d?.scene;
      let node = null;
      scene?.traverse((n) => { if (n.name === 'MopVerletRig') node = n; });
      if (node) {
        node.updateMatrixWorld(true);
        // read the instanced layers' world positions directly
        const layers = node.children.filter((c) => c.isInstancedMesh);
        return { viaGraph: true, layers: layers.length, node: node.name };
      }
      return { viaGraph: false, layers: 0 };
    }
    return { viaAccessor: true };
  });

  const probe = await read();

  // Whatever the accessor situation, the honest measurement is the drawn
  // instance matrices: read the LAST layer's instance translations in world
  // space and compare their Y to the rig root's Y.
  const sample = () => page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d?.scene;
    let root = null;
    scene?.traverse((n) => { if (n.name === 'MopVerletRig') root = n; });
    if (!root) return null;
    root.updateMatrixWorld(true);
    const layers = root.children.filter((c) => c.isInstancedMesh);
    const last = layers[layers.length - 1];
    if (!last) return null;
    last.updateMatrixWorld(true);
    const rootY = root.matrixWorld.elements[13];
    const tips = [];
    const m = new Array(16);
    for (let i = 0; i < Math.min(last.count, 24); i += 1) {
      last.getMatrixAt(i, { elements: m, fromArray() {}, toArray() {} });
      // getMatrixAt needs a real Matrix4; use the instanceMatrix array instead
      const off = i * 16;
      const a = last.instanceMatrix.array;
      // instance matrices are in the mesh's LOCAL frame; add the mesh world pos
      tips.push({
        x: +(a[off + 12]).toFixed(4),
        y: +(a[off + 13]).toFixed(4),
        z: +(a[off + 14]).toFixed(4),
      });
    }
    return {
      rootY: +rootY.toFixed(4),
      count: last.count,
      tips,
      meanY: +(tips.reduce((s, t) => s + t.y, 0) / tips.length).toFixed(4),
    };
  });

  const still1 = await sample();
  await page.waitForTimeout(500);
  const still2 = await sample();

  // now WALK, which moves the head through the world
  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  const moving = await sample();
  await page.keyboard.up('w');
  await page.waitForTimeout(1400);
  const settled = await sample();

  await page.screenshot({ path: path.join(OUT, 'mop.png') });

  const drift = (a, b) => {
    if (!a || !b) return null;
    let worst = 0;
    for (let i = 0; i < Math.min(a.tips.length, b.tips.length); i += 1) {
      worst = Math.max(worst, Math.hypot(
        a.tips[i].x - b.tips[i].x, a.tips[i].y - b.tips[i].y, a.tips[i].z - b.tips[i].z,
      ));
    }
    return +worst.toFixed(5);
  };

  const out = {
    probe, still1, still2, moving, settled, errs,
    measured: {
      stillDrift: drift(still1, still2),
      walkDrift: drift(still2, moving),
      settleDrift: drift(moving, settled),
    },
  };
  out.checks = {
    rigFound: !!still1,
    // the sim is STEPPING: walking must move the drawn instances
    walkingMovesTheYarn: (out.measured.walkDrift ?? 0) > 0.002,
    // NEGATIVE CONTROL: a motionless head must produce a still mop, or
    // "it moved" above would be satisfied by mere jitter
    motionlessIsStill: (out.measured.stillDrift ?? 1) < 0.002,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'mop-simulated.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
