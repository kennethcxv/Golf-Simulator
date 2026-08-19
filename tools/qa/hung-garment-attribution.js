// WHY IS A HUNG GARMENT DARK? -- attributed, in one boot, by turning one thing
// off at a time.
//
// The brief says the room has no fill and lights everything from straight above,
// and that this is why a hung polo reads 6.4% against a folded one at 43.5%.
// tools/qa/interior-fill-census.js measured the room's own terms at the player's
// eye and says that cannot be the mechanism:
//
//   up 0.268   side average 0.378   up:side 0.71
//   AmbientLight 0.144 of it, and ambient is NORMAL-INDEPENDENT
//   HemisphereLight 0.082 up against 0.062 side -- 1.33:1, not 20:1
//
// Ambient alone is 54% of the up total, so the smallest side:up ratio these
// lights can produce is about 0.54. 20:1 is arithmetically out of reach. The
// darkness is therefore local to the garment, and this driver finds which local
// thing it is by measuring the SAME mesh under four conditions in one session:
//
//   in situ      exactly as the game draws it
//   isolated     every other mesh hidden. The difference from `in situ` is
//                everything cast BY the room onto the garment -- shadow maps and
//                occlusion -- which the analytic census cannot model.
//   no shadows   renderer.shadowMap.enabled = false, everything else in place.
//   flat white   the material replaced by an unlit white basic material. This is
//                the geometry control: it removes albedo, vertex colours, maps
//                and lighting at once, so whatever difference SURVIVES it is
//                orientation and framing rather than shading.
//
// Pixels are read from real screenshots of the target mesh ALONE against a black
// background, so "its own pixels" means its own pixels and not a crop that
// happens to contain it.
//
// THE CONTROL is the flat-white pass. If a white unlit material does not read
// far brighter than the garment under every condition, the reader is not
// measuring the mesh at all and nothing else here is evidence.
//
//   node tools/qa/run-electron.cjs tools/qa/hung-garment-attribution.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/hung-garment';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], rows: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // Mid-morning, lights on, stock on the rails: the state the garments were
  // measured in. A garment photographed in an unrepaired shop is a photograph of
  // a dead ceiling circuit, which is the trap the club wall hit.
  await page.evaluate(() => {
    const st = window.__fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630;
    const reno = st.shop.reno;
    for (const k of Object.keys(reno.architecture.components)) {
      reno.architecture.components[k].restored = true;
    }
    for (const k of Object.keys(reno.lightPanels)) reno.lightPanels[k] = 'working';
    const inv = st.shop.inventory;
    for (const id of ['polo1', 'polo2', 'tee1', 'tee2', 'hoodie1', 'trouser1', 'cap1', 'towel1']) {
      inv[id] = inv[id] || { shelf: 0, back: 0 };
      inv[id].shelf = 4;
    }
  });
  await page.evaluate(() => window.__fw.scene3d.clubhouse().refreshShopProgression?.());
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().rebuildStock?.());
  await page.waitForTimeout(2000);

  // Find the hero garment meshes by authored material name and record, for each,
  // the facts that could explain a dark read on their own.
  const HUNG = ['PoloPique', 'TeeJersey', 'HoodieFleece', 'TrouserTwill'];
  const FOLDED = ['PoloFPique', 'TeeFJersey', 'HoodieFFleece', 'TrouserFTwill'];
  out.meshes = await page.evaluate((names) => {
    const ch = window.__fw.scene3d.clubhouse();
    let scene = ch.interior; while (scene.parent) scene = scene.parent;
    const res = {};
    let uid = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (!m || !names.includes(m.name)) continue;
        if (res[m.name]) continue;
        o.userData.__attrId = `att${uid += 1}`;
        o.updateWorldMatrix(true, false);
        const e = o.matrixWorld.elements;
        // The mesh's average world normal, which is the whole orientation claim.
        const nAttr = o.geometry?.getAttribute?.('normal');
        let nx = 0; let ny = 0; let nz = 0;
        if (nAttr) {
          const step = Math.max(1, Math.floor(nAttr.count / 400));
          for (let i = 0; i < nAttr.count; i += step) {
            nx += nAttr.getX(i); ny += nAttr.getY(i); nz += nAttr.getZ(i);
          }
        }
        const nl = Math.hypot(nx, ny, nz) || 1;
        res[m.name] = {
          id: o.userData.__attrId,
          pos: { x: +e[12].toFixed(2), y: +e[13].toFixed(2), z: +e[14].toFixed(2) },
          meanLocalNormal: { x: +(nx / nl).toFixed(3), y: +(ny / nl).toFixed(3), z: +(nz / nl).toFixed(3) },
          side: m.side, transparent: !!m.transparent, opacity: m.opacity,
          vertexColors: !!m.vertexColors,
          hasColorAttr: !!o.geometry?.getAttribute?.('color'),
          colorHex: m.color ? m.color.getHexString() : null,
          aoMap: !!m.aoMap, normalMap: !!m.normalMap,
          receiveShadow: !!o.receiveShadow, castShadow: !!o.castShadow,
        };
      }
    });
    return res;
  }, [...HUNG, ...FOLDED]);

  const present = Object.keys(out.meshes);
  console.log(`hero garment meshes found: ${present.length} — ${present.join(', ')}`);
  if (!present.length) {
    fail('no hero garment mesh is in the scene — nothing below can be measured');
    fs.writeFileSync(`${OUT}/attribution.json`, JSON.stringify(out, null, 2));
    return;
  }
  for (const [n, m] of Object.entries(out.meshes)) {
    console.log(`  ${n.padEnd(14)} normal ${JSON.stringify(m.meanLocalNormal)}  side=${m.side}`
      + ` vc=${m.vertexColors} colorAttr=${m.hasColorAttr} color=#${m.colorHex}`
      + ` ao=${m.aoMap} recvShadow=${m.receiveShadow}`);
  }

  // Frame one mesh alone against black, render, and read its pixels.
  const shoot = async (matName, mode, tag) => {
    const framed = await page.evaluate(([name, m]) => {
      const sc = window.__fw.scene3d;
      const ch = sc.clubhouse();
      let scene = ch.interior; while (scene.parent) scene = scene.parent;
      const THREE = sc.THREE || window.THREE;
      let target = null;
      scene.traverse((o) => {
        if (target || !o.isMesh || !o.material) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        if (ms.some((x) => x && x.name === name)) target = o;
      });
      if (!target) return null;

      const st = { hidden: [], mats: [], shadow: sc.renderer.shadowMap.enabled, bg: scene.background };
      window.__attrRestore = st;

      if (m === 'isolated' || m === 'flat') {
        // Hide every other mesh. layers.mask is what actually gates drawing for
        // batched props, so both are recorded and both are put back.
        scene.traverse((o) => {
          if (!o.isMesh || o === target) return;
          st.hidden.push([o, o.visible, o.layers.mask]);
          o.visible = false;
        });
        scene.background = new THREE.Color(0x000000);
      }
      if (m === 'flat') {
        const ms = Array.isArray(target.material) ? target.material : [target.material];
        st.mats.push([target, target.material]);
        target.material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: ms[0].side });
      }
      if (m === 'noshadow') sc.renderer.shadowMap.enabled = false;

      // Frame it: put the camera a fixed distance along the mesh's own facing.
      target.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(target);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const r = Math.max(0.25, size.length() * 0.6);
      const w = window.__fw.scene3d.walk;
      w.state.x = c.x; w.state.z = c.z + r * 2.2;
      w.state.yaw = Math.atan2(w.state.x - c.x, w.state.z - c.z);
      w.state.pitch = 0;
      return {
        center: { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2) },
        size: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) },
      };
    }, [matName, mode]);
    if (!framed) return null;
    await page.waitForTimeout(900);
    const file = `${OUT}/${tag}.png`;
    await page.screenshot({ path: file });
    await page.evaluate(() => {
      const sc = window.__fw.scene3d;
      const st = window.__attrRestore;
      if (!st) return;
      for (const [o, vis, mask] of st.hidden) { o.visible = vis; o.layers.mask = mask; }
      for (const [o, mat] of st.mats) o.material = mat;
      sc.renderer.shadowMap.enabled = st.shadow;
      let scene = sc.clubhouse().interior; while (scene.parent) scene = scene.parent;
      scene.background = st.bg;
      window.__attrRestore = null;
    });
    await page.waitForTimeout(400);
    return { file, framed };
  };

  // Read the screenshot: mean luma over pixels that are not the black backdrop.
  const readPixels = async (file) => {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let lit = 0; let sum = 0; let mx = 0;
    for (let i = 0; i < data.length; i += ch) {
      const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      if (l > 0.02) { lit += 1; sum += l; if (l > mx) mx = l; }
    }
    return {
      coverage: +(lit / (info.width * info.height)).toFixed(5),
      meanLuma: lit ? +(sum / lit).toFixed(4) : 0,
      maxLuma: +mx.toFixed(4),
    };
  };

  console.log('\n  material        mode        coverage   mean luma   max luma');
  for (const name of present) {
    for (const mode of ['isolated', 'noshadow-isolated', 'flat']) {
      const m = mode === 'noshadow-isolated' ? 'isolated' : mode;
      if (mode === 'noshadow-isolated') {
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate(() => { window.__fw.scene3d.renderer.shadowMap.enabled = false; });
      }
      // eslint-disable-next-line no-await-in-loop
      const shot = await shoot(name, m, `${name}-${mode}`);
      if (mode === 'noshadow-isolated') {
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate(() => { window.__fw.scene3d.renderer.shadowMap.enabled = true; });
      }
      if (!shot) continue;
      // eslint-disable-next-line no-await-in-loop
      const px = await readPixels(shot.file);
      const row = { material: name, mode, ...px };
      out.rows.push(row);
      console.log(`  ${name.padEnd(15)} ${mode.padEnd(19)} ${String(px.coverage).padStart(8)}`
        + `   ${String(px.meanLuma).padStart(9)}   ${String(px.maxLuma).padStart(8)}`);
    }
  }

  // THE CONTROL: flat white must read far brighter than the shaded garment.
  for (const name of present) {
    const flat = out.rows.find((r) => r.material === name && r.mode === 'flat');
    const lit = out.rows.find((r) => r.material === name && r.mode === 'isolated');
    if (!flat || !lit) continue;
    if (!(flat.meanLuma > lit.meanLuma * 1.5)) {
      fail(`${name}: flat white read ${flat.meanLuma} against the shaded ${lit.meanLuma} — `
        + 'the reader is not resolving this mesh, so its rows are not evidence');
    }
  }

  fs.writeFileSync(`${OUT}/attribution.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
