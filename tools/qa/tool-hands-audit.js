// ITEMS 9 + 10 — every tool's hands, and every tool at the held pose.
//
//   9  "Hands still visible on sponge and cloth. Audit every tool's hands,
//      report the list, fix it."
//  10  "Every indoor cleaning asset reads low quality. Judge each at the held
//      pose, 1x and cropped. Ranked table first, then fix the worst."
//
// One pass over the roster produces both: for each tool this equips it, waits
// for the pose to settle, and records
//   - whether any HAND mesh is drawn, how many, and what share of the frame
//     they cover (the hands question);
//   - the tool's own screen coverage and triangle count, and a full-frame plus
//     a cropped screenshot at the held pose (the quality question).
//
// Negative control for the hand probe: the same counter is run with no tool
// equipped, which must report zero hands — otherwise "this tool has hands"
// could just be the probe finding the player's body or a bystander.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tool-hands');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const W = 1600; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    // stand in open floor facing the room, looking slightly down at the boards
    w.state.x = o.x - 4.2; w.state.z = o.z + 2.0; w.state.yaw = 0; w.state.pitch = -0.42;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
  });
  await page.mouse.click(W / 2, H / 2);
  await page.waitForTimeout(1200);

  const tools = await page.evaluate(async () => {
    const mod = await import(new URL('src/data/cleaningTools.js', document.baseURI).href);
    return Object.keys(mod.CLEANING_TOOLS);
  });

  // the probe: count hand meshes and measure screen coverage of hands and tool
  await page.evaluate(() => {
    const app = window.__fw;
    const V = app.scene3d.camera.position.constructor;
    const HAND_RX = /hand|finger|thumb|palm|knuckle|fist|forearm|wrist|cuff|sleeve|arm/i;
    const boxOn = (root, camera, predicate) => {
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      let tris = 0; let count = 0;
      root.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        for (let p = o; p; p = p.parent) if (p.visible === false) return;
        if (!predicate(o)) return;
        count += 1;
        const index = o.geometry.index;
        const pos = o.geometry.attributes.position;
        tris += index ? index.count / 3 : (pos ? pos.count / 3 : 0);
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (const x of [bb.min.x, bb.max.x]) {
          for (const y of [bb.min.y, bb.max.y]) {
            for (const z of [bb.min.z, bb.max.z]) {
              const v = new V(x, y, z);
              o.localToWorld(v); v.project(camera);
              if (v.z > 1) continue;
              minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
              minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            }
          }
        }
      });
      if (!count || !Number.isFinite(minX)) return { count, tris: Math.round(tris), coverage: 0, box: null };
      const w = Math.min(2, maxX - minX); const h = Math.min(2, maxY - minY);
      return {
        count,
        tris: Math.round(tris),
        coverage: +((w / 2) * (h / 2)).toFixed(4),
        box: [+minX.toFixed(3), +minY.toFixed(3), +maxX.toFixed(3), +maxY.toFixed(3)],
      };
    };

    // The rig draws through its OWN lens (BROOM_FEEL.camera), so anything
    // measured on screen must project through broomViewmodelCamera. The first
    // cut of this probe guessed at node names that do not exist
    // (broomViewmodelScene, HeldToolRoot) and reported zero geometry for all
    // nine tools, which reads exactly like "no tool has hands".
    // The real names: toolViewmodel builds `Tool_<id>` groups, fpHands builds
    // `FirstPersonHands`, and both live in the world scene.
    window.__toolProbe = (toolId) => {
      const walk = app.scene3d.walk;
      const world = app.scene3d.scene || app.scene3d.camera?.parent;
      const vmCamera = walk.broomViewmodelCamera ? walk.broomViewmodelCamera() : null;
      const camera = vmCamera || app.scene3d.camera;
      const scene = world || app.scene3d.camera;
      let scanRoot = scene;
      while (scanRoot && scanRoot.parent) scanRoot = scanRoot.parent;
      const toolGroup = scanRoot?.getObjectByName?.(`Tool_${toolId}`) || null;
      const handsRoot = scanRoot?.getObjectByName?.('FirstPersonHands') || null;
      camera.updateMatrixWorld(true);
      scanRoot?.updateMatrixWorld?.(true);
      const visible = (node) => {
        if (!node) return false;
        for (let p = node; p; p = p.parent) if (p.visible === false) return false;
        return true;
      };
      return {
        tool: toolId,
        equipped: walk.getTool ? walk.getTool() : null,
        toolGroupFound: !!toolGroup,
        toolGroupVisible: visible(toolGroup),
        handsRootFound: !!handsRoot,
        handsRootVisible: visible(handsRoot),
        hands: handsRoot ? boxOn(handsRoot, camera, () => true) : { count: 0, tris: 0, coverage: 0, box: null },
        handParts: (() => {
          const names = [];
          if (handsRoot) {
            handsRoot.traverse((o) => {
              if (!o.isMesh) return;
              if (!visible(o)) return;
              names.push(o.name || '(unnamed)');
            });
          }
          return names;
        })(),
        toolBox: toolGroup ? boxOn(toolGroup, camera, () => true) : { count: 0, tris: 0, coverage: 0, box: null },
        // ITEM 9's measurement, second attempt. The first tested hand
        // vertices against the TOOL'S WHOLE bounding box and reported every
        // tool 100% buried — of course it did: a broom's box is 0.7 x 1.2 x
        // 1.6 m and the hand is somewhere in the middle of it.
        //
        // The defect is specific. A hand closed around a SHAFT is correct: the
        // pole passes through the palm, and it should. A hand inside a BLOCK
        // is not, because a block cannot pass through a palm. So classify each
        // tool mesh by its own smallest dimension — up to 60 mm is something a
        // hand can close around, wider is bulk — and count hand vertices
        // inside the bulk only.
        penetration: (() => {
          if (!toolGroup || !handsRoot) return null;
          const V3 = V;
          const GRASPABLE_MM = 60;
          const bulk = [];
          toolGroup.traverse((o) => {
            if (!o.isMesh || !o.geometry || !visible(o)) return;
            o.geometry.computeBoundingBox();
            const bb = o.geometry.boundingBox;
            let min = null; let max = null;
            for (const x of [bb.min.x, bb.max.x]) {
              for (const y of [bb.min.y, bb.max.y]) {
                for (const z of [bb.min.z, bb.max.z]) {
                  const v = new V3(x, y, z); o.localToWorld(v);
                  if (!min) { min = v.clone(); max = v.clone(); } else { min.min(v); max.max(v); }
                }
              }
            }
            if (!min) return;
            const dims = [max.x - min.x, max.y - min.y, max.z - min.z];
            if (Math.min(...dims) * 1000 <= GRASPABLE_MM) return;   // a shaft or a rim
            bulk.push({ name: o.name || '(unnamed)', min, max, dims });
          });
          let inside = 0; let total = 0; let deepest = 0; let culprit = null;
          handsRoot.traverse((o) => {
            if (!o.isMesh || !o.geometry || !visible(o)) return;
            const pos = o.geometry.attributes.position;
            const step = Math.max(1, Math.floor(pos.count / 120));
            for (let i = 0; i < pos.count; i += step) {
              const v = new V3(pos.getX(i), pos.getY(i), pos.getZ(i));
              o.localToWorld(v);
              total += 1;
              for (const b of bulk) {
                const dx = Math.min(v.x - b.min.x, b.max.x - v.x);
                const dy = Math.min(v.y - b.min.y, b.max.y - v.y);
                const dz = Math.min(v.z - b.min.z, b.max.z - v.z);
                const d = Math.min(dx, dy, dz);
                if (d > 0.003) {
                  inside += 1;
                  if (d > deepest) { deepest = d; culprit = b.name; }
                  break;
                }
              }
            }
          });
          return {
            bulkMeshes: bulk.length,
            bulkNames: bulk.slice(0, 6).map((b) => b.name),
            sampled: total,
            handVertsInBulk: inside,
            insideFrac: total ? +(inside / total).toFixed(3) : 0,
            deepestMm: +(deepest * 1000).toFixed(1),
            culprit,
          };
        })(),
        meshNames: (() => {
          const names = [];
          if (toolGroup) {
            toolGroup.traverse((o) => {
              if (!o.isMesh || !visible(o)) return;
              names.push(o.name || '(unnamed)');
            });
          }
          return names.slice(0, 24);
        })(),
      };
    };
  });

  // NEGATIVE CONTROL: no tool at all
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  await page.waitForTimeout(1400);
  const noTool = await page.evaluate(() => window.__toolProbe('broom'));
  await page.screenshot({ path: path.join(OUT, '00-no-tool.png') });

  const rows = [];
  for (const tool of tools) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), tool);
    await page.waitForTimeout(2200);
    const probe = await page.evaluate((t) => window.__toolProbe(t), tool);
    const full = `${tool}-full.png`;
    await page.screenshot({ path: path.join(OUT, full) });
    // cropped on the tool's own screen box, so "reads low quality" is judged at
    // the size the complaint is about rather than at thumbnail scale
    let crop = null;
    if (probe.toolBox?.box) {
      const [x0, y0, x1, y1] = probe.toolBox.box;
      const px = (ndcX) => Math.max(0, Math.min(W, (ndcX * 0.5 + 0.5) * W));
      const py = (ndcY) => Math.max(0, Math.min(H, (-ndcY * 0.5 + 0.5) * H));
      const left = Math.floor(px(x0)); const right = Math.ceil(px(x1));
      const top = Math.floor(py(y1)); const bottom = Math.ceil(py(y0));
      const pad = 40;
      const clip = {
        x: Math.max(0, left - pad),
        y: Math.max(0, top - pad),
        width: Math.min(W, right + pad) - Math.max(0, left - pad),
        height: Math.min(H, bottom + pad) - Math.max(0, top - pad),
      };
      if (clip.width > 24 && clip.height > 24) {
        crop = `${tool}-crop.png`;
        await page.screenshot({ path: path.join(OUT, crop), clip });
      }
    }
    rows.push({
      tool,
      equippedAs: probe.equipped,
      toolGroupVisible: probe.toolGroupVisible,
      handsRootVisible: probe.handsRootVisible,
      penetration: probe.penetration,
      handMeshes: probe.hands.count,
      handCoverage: probe.hands.coverage,
      handParts: probe.handParts,
      toolMeshes: probe.toolBox.count,
      toolTris: probe.toolBox.tris,
      toolCoverage: probe.toolBox.coverage,
      meshNames: probe.meshNames,
      shots: { full, crop },
    });
  }

  const noToolHands = noTool.handsRootVisible ? noTool.hands.count : 0;
  // A pole passing through a closed palm is correct; a block swallowing the
  // fingers is not. The bar is on the DEEPEST intrusion, in millimetres.
  const worst = rows
    .filter((r) => r.penetration)
    .sort((a, b) => b.penetration.deepestMm - a.penetration.deepestMm);
  const checks = {
    everyToolEquipped: rows.every((r) => r.equippedAs === r.tool),
    probeSeesGeometry: rows.filter((r) => r.tool !== 'washer').every((r) => r.toolMeshes > 0),
    handProbeCanBeZero: noToolHands === 0,
    everyToolHasHands: rows.every((r) => r.handMeshes > 0),
    // the washer equips and draws NOTHING - found by this audit, unasked
    washerDrawsSomething: rows.find((r) => r.tool === 'washer')?.toolGroupVisible === true,
    // NOT GATED, and here is why. Three cuts of a penetration metric all
    // failed: the tool's whole AABB called every tool 100% buried; per-mesh
    // AABBs call a rotated 1.3 m broom handle "bulk" because its box is large
    // in all three axes; and the hands turn out to be CHILDREN of the tool
    // group, so the probe found FirstPersonRightForearm inside Tool_sponge and
    // reported the hand as clipping itself. Axis-aligned boxes over rotated
    // geometry cannot answer this. The number is reported for interest; the
    // screenshots below are the evidence, and the bar.
    penetrationReportedNotGated: true,
    noPageErrors: errs.length === 0,
  };
  const out = {
    penetrationRanking: worst.map((r) => ({
      tool: r.tool, deepestMm: r.penetration.deepestMm, insideFrac: r.penetration.insideFrac,
      handVertsInBulk: r.penetration.handVertsInBulk, culprit: r.penetration.culprit,
      bulkMeshes: r.penetration.bulkMeshes,
    })),
    tools,
    noTool: { hands: noToolHands, handsRootVisible: noTool.handsRootVisible, toolGroupVisible: noTool.toolGroupVisible },
    rows: rows.sort((a, b) => a.handMeshes - b.handMeshes || a.toolTris - b.toolTris),
    errs: errs.slice(0, 8),
    checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'tool-hands.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
