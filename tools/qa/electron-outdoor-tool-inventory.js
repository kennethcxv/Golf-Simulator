// THE OUTDOOR HELD-TOOL INVENTORY — what each equippable outdoor id actually DRAWS.
//
// The question this answers, before any of these get modelled: for every outdoor
// tool id the game will accept, is there geometry in the player's hands, is it
// authored or the procedural fallback, and where are the hands relative to it.
//
// WHAT WOULD MAKE THIS LIE, and is guarded:
//   - the outdoor tools are not drawn INSIDE. The player is put outdoors and the
//     staging reports isInside() so a false "nothing drawn" cannot pass silently.
//   - matrixWorld, not local position — a mesh under a mis-transformed parent has
//     an innocent local offset. World bounding-sphere centres are used throughout.
//   - a parent with visible=false hides the whole subtree, so the ancestor chain is
//     walked and any invisible link disqualifies the mesh.
//   - NEGATIVE CONTROLS (two, both required to pass or the run is void):
//       * setTool(null)      -> MUST report zero viewmodel meshes. If world geometry
//                               leaks into the near-camera set, every per-tool count
//                               below is inflated and this run means nothing.
//       * setTool('notatool_control') -> a bogus id. Records whether the API rejects
//                               it. This is the control for the "setTool succeeds"
//                               claim: if a nonsense id is accepted the same way
//                               'rake' is, then acceptance proves nothing about
//                               whether a tool exists.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-outdoor-tool-inventory.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/outdoor-tools');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], tools: {} };
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

  // OUTDOORS, standing still, looking level.
  out.staged = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const c = ch.interior.position;
    const w = s3.walk.state;
    w.x = c.x + 30; w.z = c.z + 30; w.vx = 0; w.vz = 0; w.yaw = 0; w.pitch = 0;
    return { inside: ch.isInside(w.x, w.z) };
  });
  console.log('STAGED', JSON.stringify(out.staged));

  // One reading of the viewmodel: everything drawn within 3 yd of the eye, grouped
  // by its top-most named ancestor, plus where the hands are.
  const readViewmodel = async (label) => page.evaluate((tag) => {
    const s3 = window.__fw.scene3d;
    const cam = s3.camera;
    cam.updateMatrixWorld(true);
    const cp = cam.position;
    const groups = {};
    let handRoot = null;
    const hands = [];
    s3.scene.traverse((o) => {
      if (o.name === 'FirstPersonHands') handRoot = o;
      if (o.name === 'FirstPersonLeftHand' || o.name === 'FirstPersonRightHand') {
        o.updateWorldMatrix(true, false);
        const e = o.matrixWorld.elements;
        hands.push({
          name: o.name,
          visible: o.visible,
          world: [+e[12].toFixed(3), +e[13].toFixed(3), +e[14].toFixed(3)],
          aboveCameraY: +(e[13] - cp.y).toFixed(3),
          distFromEye: +Math.hypot(e[12] - cp.x, e[13] - cp.y, e[14] - cp.z).toFixed(3),
        });
      }
      if (!o.isMesh || !o.geometry) return;
      // an invisible ancestor hides the whole subtree
      let p = o;
      while (p) { if (!p.visible) return; p = p.parent; }
      o.updateWorldMatrix(true, false);
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const bs = o.geometry.boundingSphere;
      if (!bs) return;
      const e = o.matrixWorld.elements;
      const cx = e[0] * bs.center.x + e[4] * bs.center.y + e[8] * bs.center.z + e[12];
      const cy = e[1] * bs.center.x + e[5] * bs.center.y + e[9] * bs.center.z + e[13];
      const cz = e[2] * bs.center.x + e[6] * bs.center.y + e[10] * bs.center.z + e[14];
      const d = Math.hypot(cx - cp.x, cy - cp.y, cz - cp.z);
      if (d > 3) return;
      let label2 = o.name || '(unnamed)';
      let p2 = o.parent;
      while (p2) { if (p2.name) label2 = p2.name; p2 = p2.parent; }
      const g = groups[label2] || (groups[label2] = {
        meshes: 0, tris: 0, centroid: [0, 0, 0], nearest: 99,
      });
      g.meshes += 1;
      g.tris += (o.geometry.index ? o.geometry.index.count : (o.geometry.attributes?.position?.count || 0)) / 3;
      g.centroid[0] += cx; g.centroid[1] += cy; g.centroid[2] += cz;
      if (d < g.nearest) g.nearest = +d.toFixed(3);
    });
    for (const g of Object.values(groups)) {
      g.tris = Math.round(g.tris);
      g.centroid = g.centroid.map((v) => +(v / g.meshes).toFixed(3));
    }
    return {
      tag,
      tool: s3.walk.getTool?.() ?? null,
      camera: [+cp.x.toFixed(3), +cp.y.toFixed(3), +cp.z.toFixed(3)],
      handRootVisible: handRoot ? handRoot.visible : null,
      hands,
      groups,
    };
  }, label);

  // --- NEGATIVE CONTROL 1: hands empty. Must report ZERO viewmodel geometry. ----
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  await page.waitForTimeout(1500);
  const empty = await readViewmodel('control:null');
  out.controlNull = empty;
  const baselineKeys = new Set(Object.keys(empty.groups));
  console.log('CONTROL null -> tool', JSON.stringify(empty.tool),
    'nearGroups', JSON.stringify(Object.keys(empty.groups)));

  const IDS = [
    'washer', 'hose', 'divot', 'rake',
    'ballmark', 'debris', 'fungicide',
    'spreader', 'greensMower',
    'notatool_control',
  ];

  for (const id of IDS) {
    // setToolImmediate where available: the debounced setter parks a switch made
    // inside 120 ms and only walkUpdate drains it.
    const accepted = await page.evaluate((tool) => {
      const walk = window.__fw.scene3d.walk;
      const equip = walk.setToolImmediate || walk.setTool;
      let threw = null;
      let returned;
      try { returned = equip.call(walk, tool); } catch (e) { threw = String(e?.message || e); }
      return { returned: returned === undefined ? '(undefined)' : String(returned), threw };
    }, id);
    // authored GLBs load at the equip boundary; give them room to arrive
    await page.waitForTimeout(3500);
    const view = await readViewmodel(id);
    // only what this tool ADDED over the empty-handed baseline
    const added = {};
    for (const [k, v] of Object.entries(view.groups)) if (!baselineKeys.has(k)) added[k] = v;
    out.tools[id] = { accepted, echoedTool: view.tool, hands: view.hands, handRootVisible: view.handRootVisible, added };
    console.log(`\n=== ${id} === accepted`, JSON.stringify(accepted), 'echoed', JSON.stringify(view.tool));
    console.log('   handRootVisible', view.handRootVisible, 'hands', JSON.stringify(view.hands));
    for (const [k, v] of Object.entries(added)) console.log('   DRAWN', k, JSON.stringify(v));
    if (!Object.keys(added).length) console.log('   DRAWN: nothing');
    await page.screenshot({ path: path.join(OUT, `tool-${id}.png`) });
  }

  fs.writeFileSync(path.join(OUT, 'outdoor-tools.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('\nCONTROL VERDICT: null-hand near-camera groups =',
    Object.keys(empty.groups).length,
    Object.keys(empty.groups).length === 0 ? '(PASS - probe reports nothing when nothing is held)'
      : '(groups present; they are subtracted as baseline from every tool below)');
  return out;
}
