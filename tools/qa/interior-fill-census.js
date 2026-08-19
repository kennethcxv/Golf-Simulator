// WHY A VERTICAL SURFACE IN THE CLUBHOUSE IS TWENTY TIMES DARKER THAN A
// HORIZONTAL ONE, NAMED PER LIGHT.
//
// The asset session measured it on garments -- hung polo 6.4% against folded
// polo 43.5%, and 4.6% against 43.5% at THE SAME HEIGHT -- and ruled out
// albedo, baked occlusion, the normal map, metalness, layer scoping and height.
// What is left is orientation, which is a statement about the room's lights,
// not about the garment.
//
// So this asks the lights directly. For every light that actually contributes
// at a probe point (visible up its whole parent chain, and passing the camera
// layer test the renderer applies), it computes the irradiance that light
// delivers at a chosen normal, using three's own formulas:
//
//   ambient      color * intensity                       (normal-independent)
//   hemisphere   mix(ground, sky, 0.5 * dot(N, up) + 0.5) * intensity
//   directional  color * intensity * max(0, dot(N, L))
//   point/spot   color * intensity * max(0, dot(N, L)) * falloff
//
// Reported per light and per normal, so "the room has no fill" becomes a table
// naming which term is missing rather than an impression. The RATIO up:side is
// the number the fix has to move.
//
//   node tools/qa/run-electron.cjs tools/qa/interior-fill-census.js --clubhouse=pine-hills-v2
async (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d, null, { timeout: 120000 });
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 300000 });
  } catch { /* the census does not need the veil down, only the lights */ }
  await page.waitForTimeout(2500);

  // Stand the player inside, so the interior fill scale is in the state the
  // garments were measured in. Its whole job is to react to where the body is.
  const placed = await page.evaluate(() => {
    const sc = window.__fw.scene3d;
    const ch = sc.clubhouse();
    const p = ch.interior ? { x: ch.interior.position.x, z: ch.interior.position.z } : null;
    if (!p) return null;
    if (!sc.walk.isActive()) sc.walk.enter({ x: p.x, z: p.z, yaw: 0 });
    const st = sc.walk.state;
    st.x = p.x; st.z = p.z; st.yaw = 0; st.pitch = -0.1;
    return { x: st.x, z: st.z, inside: ch.isInside ? !!ch.isInside(st.x, st.z) : null };
  });
  if (!placed) throw new Error('no clubhouse interior to stand in');
  // Let the fill ease and the 2 Hz interior gates settle before reading.
  await page.waitForTimeout(3000);

  const census = await page.evaluate((probe) => {
    const sc = window.__fw.scene3d;
    const scene = sc.scene;
    const camera = sc.camera;
    const THREE = window.__fw.THREE || null;

    const V = (x, y, z) => ({ x, y, z });
    const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const len = (a) => Math.hypot(a.x, a.y, a.z);
    const norm = (a) => { const l = len(a) || 1; return V(a.x / l, a.y / l, a.z / l); };
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

    // The probe point: the player's eye height, at the player's feet, which is
    // where the garments and the customers are.
    const st = sc.walk.state;
    const at = V(probe.x, (st.y ?? 0) + 1.6, probe.z);

    const normals = {
      up: V(0, 1, 0),
      side_pz: V(0, 0, 1),
      side_nz: V(0, 0, -1),
      side_px: V(1, 0, 0),
      side_nx: V(-1, 0, 0),
      down: V(0, -1, 0),
    };

    const lights = [];
    scene.traverse((o) => {
      if (!o.isLight) return;
      let vis = true;
      for (let p = o; p; p = p.parent) { if (!p.visible) { vis = false; break; } }
      const layered = o.layers.test(camera.layers);
      o.updateMatrixWorld(true);
      const e = o.matrixWorld.elements;
      const pos = V(e[12], e[13], e[14]);
      let targetPos = null;
      if (o.target && o.target.isObject3D) {
        o.target.updateMatrixWorld(true);
        const te = o.target.matrixWorld.elements;
        targetPos = V(te[12], te[13], te[14]);
      }
      lights.push({
        name: o.name || '(unnamed)',
        type: o.type,
        intensity: o.intensity,
        color: { r: o.color?.r ?? 0, g: o.color?.g ?? 0, b: o.color?.b ?? 0 },
        ground: o.groundColor ? { r: o.groundColor.r, g: o.groundColor.g, b: o.groundColor.b } : null,
        distance: o.distance ?? null,
        decay: o.decay ?? null,
        visible: vis,
        layered,
        contributes: vis && layered,
        pos,
        targetPos,
      });
    });

    // Irradiance at one normal from one light, in three's own terms. Relative
    // units throughout -- the ratio between normals is the claim, not lux.
    const irradiance = (L, N) => {
      if (!L.contributes) return 0;
      const c = lum(L.color);
      if (L.type === 'AmbientLight') return c * L.intensity;
      if (L.type === 'HemisphereLight') {
        const g = L.ground ? lum(L.ground) : 0;
        const t = 0.5 * dot(N, V(0, 1, 0)) + 0.5;
        return (g * (1 - t) + c * t) * L.intensity;
      }
      if (L.type === 'DirectionalLight') {
        const dir = L.targetPos ? norm(sub(L.pos, L.targetPos)) : norm(L.pos);
        return c * L.intensity * Math.max(0, dot(N, dir));
      }
      // point and spot: three's physically-correct falloff
      const d = sub(L.pos, at);
      const dist = len(d) || 1e-6;
      if (L.distance && dist > L.distance) return 0;
      const dir = norm(d);
      const ndl = Math.max(0, dot(N, dir));
      if (ndl <= 0) return 0;
      const decay = L.decay == null ? 2 : L.decay;
      let falloff = 1 / Math.max(1e-6, Math.pow(dist, decay));
      if (L.distance > 0) {
        const t = Math.min(1, Math.pow(dist / L.distance, 4));
        falloff *= Math.max(0, 1 - t * t);
      }
      return c * L.intensity * ndl * falloff;
    };

    const perNormal = {};
    for (const [nName, N] of Object.entries(normals)) {
      const terms = lights
        .filter((L) => L.contributes)
        .map((L) => ({ light: `${L.type}:${L.name}`, E: +irradiance(L, N).toFixed(5) }))
        .filter((t) => t.E > 0)
        .sort((a, b) => b.E - a.E);
      perNormal[nName] = {
        total: +terms.reduce((s, t) => s + t.E, 0).toFixed(5),
        terms: terms.slice(0, 8),
      };
    }

    const sideAvg = ['side_pz', 'side_nz', 'side_px', 'side_nx']
      .reduce((s, k) => s + perNormal[k].total, 0) / 4;

    return {
      probe: at,
      interiorFill: {
        scale: sc.interiorFill?.scale?.() ?? null,
        factor: sc.interiorFill?.factor?.() ?? null,
        hemiIntensity: sc.interiorFill?.hemiIntensity?.() ?? null,
      },
      hemiLive: lights.filter((l) => l.type === 'HemisphereLight')
        .map((l) => ({ intensity: l.intensity, contributes: l.contributes })),
      lightCount: lights.length,
      contributing: lights.filter((l) => l.contributes).length,
      lights: lights.filter((l) => l.contributes).map((l) => ({
        type: l.type, name: l.name, intensity: +l.intensity.toFixed(4),
        distance: l.distance, decay: l.decay,
        pos: { x: +l.pos.x.toFixed(1), y: +l.pos.y.toFixed(1), z: +l.pos.z.toFixed(1) },
      })),
      perNormal,
      upOverSide: +(perNormal.up.total / Math.max(1e-9, sideAvg)).toFixed(2),
      sideAvg: +sideAvg.toFixed(5),
      threeAvailable: !!THREE,
    };
  }, placed);

  return { placed, census, errors: errors.slice(0, 8) };
}
