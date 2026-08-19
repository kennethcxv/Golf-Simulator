// IS A VERTICAL SURFACE IN THIS ROOM REALLY TWENTY TIMES DARKER THAN A
// HORIZONTAL ONE? -- asked with two identical plates instead of two garments.
//
// The brief's evidence is a hung polo at 6.4% against a folded polo at 43.5%.
// Those are two different meshes, in two different places, on two different
// fixtures, with two different bakes -- so "orientation" is only one of the
// things that differs between them, and the conclusion drawn from the pair was
// that the room lights nothing from the side.
//
// tools/qa/interior-fill-census.js already says the room's own terms cannot do
// that: at the player's eye, up reads 0.268 and the side average 0.378, and the
// largest single term is an AmbientLight at 0.144 which is normal-independent
// by construction. So this settles it with a controlled pair instead of an
// observed one.
//
// SIX PLATES, one geometry, one material, one position, six normals: +Y, -Y and
// the four horizontals. Identical in every respect except which way they face.
// Whatever ratio they produce IS the room's treatment of orientation, with real
// shading, real shadow maps and real tone mapping -- none of which the analytic
// census can model.
//
// Each is rendered ALONE against black so its pixels are its own, at three
// stations (mid-floor, at the club wall, and where the apparel rail would be if
// pine-hills-v2 had not cut it).
//
// TWO CONTROLS.
//   UNLIT   the same plates as MeshBasicMaterial. Lighting cannot reach a basic
//           material, so all six MUST read the same. If they do not, the reader
//           is measuring framing or projected area rather than shading, and
//           every lit number here is that artifact instead.
//   RANGE   the lit +Y plate must be brighter than pure black and darker than
//           pure white, or the reader is clipping and cannot resolve a ratio.
//
//   node tools/qa/run-electron.cjs tools/qa/vertical-vs-horizontal-probe.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/vertical-probe';
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

  // Mid-morning with the ceiling circuit repaired. A room measured with a dead
  // circuit is a measurement of the starter's damage, not of its lighting.
  out.lit = await page.evaluate(() => {
    const st = window.__fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630;
    const reno = st.shop.reno;
    for (const k of Object.keys(reno.architecture.components)) {
      reno.architecture.components[k].restored = true;
    }
    for (const k of Object.keys(reno.lightPanels)) reno.lightPanels[k] = 'working';
    return Object.keys(reno.lightPanels).length;
  });
  await page.evaluate(() => window.__fw.scene3d.clubhouse().refreshShopProgression?.());
  await page.waitForTimeout(2500);

  const NORMALS = {
    up: [0, 1, 0], down: [0, -1, 0],
    north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0],
  };

  // Build the plates once, parented to the scene at a station, all hidden.
  const build = (station, unlit) => page.evaluate(([st, isUnlit]) => {
    const sc = window.__fw.scene3d;
    const ch = sc.clubhouse();
    let scene = ch.interior; while (scene.parent) scene = scene.parent;
    // THREE IS NOT ON THE PAGE. The renderer has no bundler and the import map
    // owns `three`, so nothing hangs a THREE namespace off window -- the first
    // run of this driver died on `sc.THREE.Group`. Constructors are taken from
    // objects the live scene already holds instead, which is also stricter: the
    // probe is built from the same classes the game is built from, not from a
    // second copy of three that might differ.
    const THREE = window.__probeTHREE || (() => {
      let mesh = null; let grp = null;
      scene.traverse((o) => {
        if (!mesh && o.isMesh && o.geometry?.getAttribute?.('position')
          && o.material && !Array.isArray(o.material) && o.material.isMeshStandardMaterial) mesh = o;
        if (!grp && o.isGroup) grp = o;
      });
      if (!mesh) return null;
      const t = {
        Group: (grp || scene).constructor,
        Mesh: mesh.constructor,
        Vector3: mesh.position.constructor,
        Color: mesh.material.color.constructor,
        // The base BufferGeometry, reached through the prototype chain of a
        // geometry the scene already holds, plus its position attribute's class.
        // A quad is then built by hand -- PlaneGeometry itself is not reachable
        // without the module namespace, and guessing at it is how a probe ends
        // up measuring a different mesh than it thinks.
        BufferGeometry: Object.getPrototypeOf(mesh.geometry.constructor.prototype).constructor,
        BufferAttribute: mesh.geometry.getAttribute('position').constructor,
        Standard: mesh.material.constructor,
      };
      window.__probeTHREE = t;
      return t;
    })();
    if (!THREE) return null;
    if (window.__probeRoot) { scene.remove(window.__probeRoot); }
    const root = new THREE.Group();
    root.name = 'VerticalProbeRoot';
    window.__probeRoot = root;
    const w = ch.localToWorld(st.x, st.z);
    // A 0.5 yd quad in the XY plane, facing +Z, built explicitly.
    const h = 0.25;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -h, -h, 0, h, -h, 0, h, h, 0, -h, -h, 0, h, h, 0, -h, h, 0,
    ]), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
    ]), 2));
    // THE UNLIT CONTROL IS AN EMISSIVE STANDARD MATERIAL, not a basic one.
    // MeshBasicMaterial is not reachable either, and emissive is exactly the
    // property the control needs: it is added after shading and is completely
    // independent of the normal, so all six plates MUST read the same. If they
    // do not, the reader is measuring framing or projected area.
    const mk = () => {
      const m = new THREE.Standard({ roughness: 0.85, metalness: 0 });
      m.side = 2;
      if (isUnlit) { m.color.setHex(0x000000); m.emissive.setHex(0xb0b0b0); }
      else { m.color.setHex(0xb0b0b0); m.emissive.setHex(0x000000); }
      return m;
    };
    const dirs = {
      up: [0, 1, 0], down: [0, -1, 0],
      north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0],
    };
    // SAME GEOMETRY, SAME PLACE, SAME CAMERA -- ONLY THE SHADING NORMAL MOVES.
    //
    // The first version rotated each plate to face its normal and moved the
    // camera onto that normal. Its unlit control failed at 37%, and the reason
    // is visible in the table it produced: mean luma tracked COVERAGE row for
    // row, because a rotated plate seen from a fixed eye height projects a
    // different number of pixels. That instrument was measuring projected area.
    //
    // Shading reads the normal ATTRIBUTE; projected area comes from the
    // positions. So every plate now sits in the same place with the same
    // orientation -- square to the camera -- and carries a different constant
    // normal. Identical pixels, identical framing, and the only difference left
    // is the one under test.
    window.__probes = {};
    for (const [name, d] of Object.entries(dirs)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', geo.getAttribute('position'));
      g.setAttribute('uv', geo.getAttribute('uv'));
      const n = new Float32Array(18);
      for (let i = 0; i < 6; i += 1) { n[i * 3] = d[0]; n[i * 3 + 1] = d[1]; n[i * 3 + 2] = d[2]; }
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
      const m = new THREE.Mesh(g, mk());
      m.name = `Probe_${name}`;
      m.position.set(w.x, st.y, w.z);
      // Square to the camera station, which is a fixed offset in +Z.
      m.lookAt(w.x, st.y, w.z + 1);
      m.visible = false;
      m.receiveShadow = true;
      m.castShadow = false;
      m.frustumCulled = false;
      root.add(m);
      window.__probes[name] = m;
    }
    scene.add(root);
    return { at: { x: +w.x.toFixed(2), y: st.y, z: +w.z.toFixed(2) }, n: Object.keys(dirs).length };
  }, [station, unlit]);

  // Render one plate alone against black, from a camera on its own normal, at a
  // fixed distance -- so projected area is identical for all six and cannot be
  // mistaken for brightness.
  const shootProbe = async (name, tag) => {
    await page.evaluate((which) => {
      const sc = window.__fw.scene3d;
      const THREE = window.__probeTHREE;
      const ch = sc.clubhouse();
      let scene = ch.interior; while (scene.parent) scene = scene.parent;
      const st = { hidden: [], bg: scene.background };
      window.__probeRestore = st;
      scene.traverse((o) => {
        if (!o.isMesh) return;
        if (o.name === `Probe_${which}`) { o.visible = true; return; }
        st.hidden.push([o, o.visible, o.layers.mask]);
        o.visible = false;
      });
      scene.background = new THREE.Color(0x000000);
      const p = window.__probes[which];
      p.updateWorldMatrix(true, false);
      // ONE camera pose for all six, on the +Z side at the plate's own height.
      const w = sc.walk;
      w.state.x = p.position.x;
      w.state.z = p.position.z + 1.1;
      w.state.yaw = 0;
      w.state.pitch = 0;
    }, name);
    await page.waitForTimeout(700);
    const file = `${OUT}/${tag}.png`;
    await page.screenshot({ path: file });
    await page.evaluate(() => {
      const sc = window.__fw.scene3d;
      const st = window.__probeRestore;
      if (!st) return;
      for (const [o, vis, mask] of st.hidden) { o.visible = vis; o.layers.mask = mask; }
      let scene = sc.clubhouse().interior; while (scene.parent) scene = scene.parent;
      scene.background = st.bg;
      window.__probeRestore = null;
    });
    return file;
  };

  const readPixels = async (file) => {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let lit = 0; let sum = 0;
    for (let i = 0; i < data.length; i += ch) {
      const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      if (l > 0.02) { lit += 1; sum += l; }
    }
    return {
      coverage: +(lit / (info.width * info.height)).toFixed(5),
      meanLuma: lit ? +(sum / lit).toFixed(4) : 0,
    };
  };

  const STATIONS = [
    { label: 'mid-floor', x: 0, z: 1.2, y: 1.4 },
    { label: 'at the club wall', x: -0.10, z: -3.6, y: 1.4 },
    { label: 'where the apparel rail was', x: 2.2, z: -2.0, y: 1.4 },
  ];

  const runPass = async (unlit) => {
    const kind = unlit ? 'UNLIT CONTROL' : 'LIT';
    console.log(`\n== ${kind} ==`);
    console.log('  station                       normal    coverage   mean luma');
    for (const st of STATIONS) {
      // eslint-disable-next-line no-await-in-loop
      await build(st, unlit);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(500);
      for (const name of Object.keys(NORMALS)) {
        // eslint-disable-next-line no-await-in-loop
        const file = await shootProbe(name, `${unlit ? 'unlit' : 'lit'}-${st.label.replace(/\s+/g, '_')}-${name}`);
        // eslint-disable-next-line no-await-in-loop
        const px = await readPixels(file);
        out.rows.push({ station: st.label, unlit, normal: name, ...px });
        console.log(`  ${st.label.padEnd(28)}  ${name.padEnd(7)} ${String(px.coverage).padStart(9)}`
          + `   ${String(px.meanLuma).padStart(9)}`);
      }
    }
  };

  await runPass(false);
  await runPass(true);
  await page.evaluate(() => {
    const sc = window.__fw.scene3d;
    let scene = sc.clubhouse().interior; while (scene.parent) scene = scene.parent;
    if (window.__probeRoot) scene.remove(window.__probeRoot);
    window.__probeRoot = null;
  });

  // ---- THE DECISIVE CONTROL: DOES THE LIT PLATE RESPOND TO LIGHT AT ALL?
  //
  // The lit pass and the emissive pass came back within a few percent of each
  // other, and a lit plate that reads the same as an unlit one is exactly what a
  // probe that is not being shaded would produce. So every light in the scene is
  // switched off and the lit plate re-read. If it does not go dark, this probe is
  // not measuring the room's lighting and its up:side ratio is worthless -- which
  // is a verdict this driver must be able to reach about itself.
  await build(STATIONS[0], false);
  await page.waitForTimeout(500);
  const litOn = await readPixels(await shootProbe('up', 'darkcontrol-lights-on'));
  await page.evaluate(() => {
    const sc = window.__fw.scene3d;
    let scene = sc.clubhouse().interior; while (scene.parent) scene = scene.parent;
    window.__lightsOff = [];
    scene.traverse((o) => {
      if (!o.isLight) return;
      window.__lightsOff.push([o, o.intensity]);
      o.intensity = 0;
    });
    return window.__lightsOff.length;
  });
  await page.waitForTimeout(600);
  const litOff = await readPixels(await shootProbe('up', 'darkcontrol-lights-off'));
  await page.evaluate(() => {
    for (const [o, i] of (window.__lightsOff || [])) o.intensity = i;
    window.__lightsOff = null;
  });
  out.darkControl = { on: litOn.meanLuma, off: litOff.meanLuma };
  console.log(`
DARK CONTROL: lit plate reads ${litOn.meanLuma} with the lights on, `
    + `${litOff.meanLuma} with every light at zero intensity`);
  if (!(litOff.meanLuma < litOn.meanLuma * 0.6)) {
    fail(`killing every light in the scene moved the lit plate from ${litOn.meanLuma} to ${litOff.meanLuma} — `
      + 'this probe is not being shaded by the room, so its up:side ratio measures nothing');
  }

  // ---- CONTROLS
  const unlitRows = out.rows.filter((r) => r.unlit);
  const unlitLumas = unlitRows.map((r) => r.meanLuma).filter((x) => x > 0);
  const spread = unlitLumas.length
    ? (Math.max(...unlitLumas) - Math.min(...unlitLumas)) / Math.max(...unlitLumas) : null;
  console.log(`\nUNLIT control spread across all normals and stations: ${(spread * 100).toFixed(1)}%`);
  if (spread == null || spread > 0.12) {
    fail(`the unlit plates differ by ${(spread * 100).toFixed(1)}% across normals — `
      + 'lighting cannot reach a basic material, so this reader is measuring framing, not shading');
  }

  // ---- THE ANSWER
  console.log('\n  station                        up      side avg    up:side');
  for (const st of STATIONS) {
    const at = (n) => out.rows.find((r) => !r.unlit && r.station === st.label && r.normal === n);
    const up = at('up');
    const sides = ['north', 'south', 'east', 'west'].map(at).filter(Boolean);
    if (!up || !sides.length) continue;
    const sideAvg = sides.reduce((a, r) => a + r.meanLuma, 0) / sides.length;
    const ratio = sideAvg > 0 ? +(up.meanLuma / sideAvg).toFixed(2) : null;
    out[`ratio_${st.label}`] = ratio;
    console.log(`  ${st.label.padEnd(30)} ${String(up.meanLuma).padStart(6)}   `
      + `${sideAvg.toFixed(4).padStart(8)}    ${String(ratio).padStart(6)}`);
    if (up.meanLuma <= 0.02 || up.meanLuma >= 0.99) {
      fail(`${st.label}: the lit up-facing plate read ${up.meanLuma} — clipped, so no ratio from this station means anything`);
    }
  }

  fs.writeFileSync(`${OUT}/probe.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
