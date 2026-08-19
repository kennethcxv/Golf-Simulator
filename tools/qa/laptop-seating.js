// IS THE LAPTOP ACTUALLY ON THE DESK?
//
// It is placed at a CONSTANT: clubhouse.js does
//   laptop.position.set(FRONT_DESK.laptop.x, COUNTER_TOP + 0.003, FRONT_DESK.laptop.z)
// where COUNTER_TOP is the layout datum (1.055 m). Nothing in that line reads
// the desk. The desk meanwhile is a GLB that gets Y-SCALED by the placement
// helper -- fixtures.js scales the production counter by COUNTER_TOP / 1.015
// on the assumption its authored worktop sits at 1.015 m. If the hero desk's
// worktop is anywhere else, that scale lands the surface somewhere the caller
// never learns about, and every prop placed on the datum floats or sinks. That
// is the cap-on-peg shape: a helper applying a shift the caller cannot see.
//
// So nothing here is taken from a constant. The laptop's base is the world
// bounding box of its own drawn vertices, and the desk's top plane is found by
// RAYCASTING DOWN from inside the laptop -- which asks the scene what surface
// is actually underneath rather than which surface ought to be.
//
// THE NEGATIVE CONTROL is a deliberate lift: the laptop is raised 40 mm and
// re-measured through the identical code path. A probe that reports the same
// gap for a laptop that has demonstrably moved is reading a constant, not the
// scene, and its zero would mean nothing.
//
//   node tools/qa/run-electron.cjs tools/qa/laptop-seating.js --clubhouse=final
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  const out = { failures: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  await boot.clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2000);

  // the laptop facility has to exist before there is a laptop to seat
  await page.evaluate(() => {
    const st = window.__fw.state;
    const reno = st.shop.reno;
    reno.facilities = reno.facilities || {};
    reno.facilities.laptop = true;
    for (const k of Object.keys(reno.lightPanels)) reno.lightPanels[k] = 'working';
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630;
    window.__fw.scene3d.clubhouse().refreshShopProgression?.();
  });
  await page.waitForTimeout(1200);

  // One measurement routine, run twice -- once as shipped, once with the
  // laptop deliberately lifted -- so the control exercises the identical path.
  //
  // THREE is not on the page (the renderer has no bundler and the import map
  // owns `three`), so there is no bare Box3 or Raycaster to construct. The
  // bounds are computed by hand from transformed vertices, which is stricter
  // anyway because it ignores any stale bounding volume a loader is carrying,
  // and the Raycaster is taken off a live instance's prototype chain.
  const probe = (liftM) => page.evaluate((lift) => {
    const ch = window.__fw.scene3d.clubhouse();
    const rig = ch.laptopRig?.();
    const laptop = rig?.object;
    if (!laptop) return { error: 'no laptop object' };
    const baseY = laptop.position.y;
    laptop.position.y = baseY + lift;
    laptop.updateWorldMatrix(true, true);

    const vec = laptop.position.clone(); // a Vector3 borrowed from a live object
    const meshesOf = (root) => {
      const list = [];
      root.traverse((o) => {
        let vis = o.visible;
        for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
        if (vis && o.isMesh && o.geometry && o.geometry.attributes
          && o.geometry.attributes.position) list.push(o);
      });
      return list;
    };
    const spanY = (objs) => {
      let min = Infinity;
      let max = -Infinity;
      let verts = 0;
      for (const o of objs) {
        const pos = o.geometry.attributes.position;
        o.updateWorldMatrix(true, false);
        for (let i = 0; i < pos.count; i += 1) {
          vec.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
          if (vec.y < min) min = vec.y;
          if (vec.y > max) max = vec.y;
          verts += 1;
        }
      }
      return { min, max, verts };
    };
    const lapMeshes = meshesOf(laptop);
    const lap = spanY(lapMeshes);

    // WHAT IS UNDERNEATH. No raycast: there is no Raycaster reachable from the
    // API, and adding a QA-only hook to the renderer to answer a question about
    // the renderer is the wrong direction. Instead the surface is taken from
    // the DESK'S OWN VERTICES -- the highest vertex of any other drawn mesh
    // that lies inside the laptop's XZ footprint and at or below its base.
    // That is stricter than a ray, because it does not depend on face winding
    // and cannot slip between two triangles.
    //
    // The footprint is the laptop's own XZ extent, so the answer is "the
    // highest thing the laptop is standing over", which is the surface it must
    // touch whatever that surface turns out to be named.
    let lapMinX = Infinity; let lapMaxX = -Infinity;
    let lapMinZ = Infinity; let lapMaxZ = -Infinity;
    for (const o of lapMeshes) {
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        vec.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
        if (vec.x < lapMinX) lapMinX = vec.x;
        if (vec.x > lapMaxX) lapMaxX = vec.x;
        if (vec.z < lapMinZ) lapMinZ = vec.z;
        if (vec.z > lapMaxZ) lapMaxZ = vec.z;
      }
    }
    // The desk's top is a large flat quad: its only vertices are its four
    // corners, metres away from a laptop-sized footprint. Sampling vertices
    // therefore finds NOTHING under the laptop, which is how the first cut of
    // this probe reported "no surface" for a laptop plainly standing on a desk.
    //
    // So this is a hand-rolled ray/triangle intersection instead: a vertical
    // line dropped through the laptop's world centre, tested against every
    // triangle of every other drawn mesh, keeping the highest one at or below
    // the laptop's base. No THREE needed, no dependence on face winding, and
    // it cannot miss a surface for want of tessellation.
    const lapSet = new Set(lapMeshes);
    const centre = laptop.position.clone();
    laptop.getWorldPosition(centre);
    const px = centre.x;
    const pz = centre.z;
    const a = laptop.position.clone();
    const b = laptop.position.clone();
    const c = laptop.position.clone();
    let hit = null;
    const allHits = [];
    let trianglesTested = 0;
    for (const o of meshesOf(ch.interior)) {
      if (lapSet.has(o)) continue;
      const geo = o.geometry;
      const pos = geo.attributes.position;
      const idx = geo.index;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      o.updateWorldMatrix(true, false);
      for (let t = 0; t < triCount; t += 1) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(o.matrixWorld);
        b.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(o.matrixWorld);
        c.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(o.matrixWorld);
        trianglesTested += 1;
        // barycentric containment of (px, pz) in the triangle's XZ projection
        const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(d) < 1e-12) continue;
        const w0 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / d;
        if (w0 < 0 || w0 > 1) continue;
        const w1 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / d;
        if (w1 < 0 || w1 > 1) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < 0 || w2 > 1) continue;
        const y = w0 * a.y + w1 * b.y + w2 * c.y;
        allHits.push({ y, name: o.name || '(unnamed)' });
        if (y > lap.min + 0.002) continue; // above the laptop's base is not under it
        if (!hit || y > hit.y) hit = { y, name: o.name || '(unnamed)' };
      }
    }

    laptop.position.y = baseY;
    laptop.updateWorldMatrix(true, true);
    return {
      placedOriginLocalY: +(baseY + lift).toFixed(4),
      placedOriginWorldY: +centre.y.toFixed(4),
      trianglesTested,
      allHits: allHits.sort((p1, p2) => p2.y - p1.y).slice(0, 12).map((h) => ({ y: +h.y.toFixed(4), name: h.name })),
      laptopBaseY: +lap.min.toFixed(4),
      laptopTopY: +lap.max.toFixed(4),
      laptopVerts: lap.verts,
      originAboveOwnBase: +(centre.y - lap.min).toFixed(4),
      surface: hit ? { y: +hit.y.toFixed(4), name: hit.name } : null,
      parts: lapMeshes.map((o) => {
        const pos = o.geometry.attributes.position;
        let mn = Infinity; let mx = -Infinity;
        o.updateWorldMatrix(true, false);
        for (let i = 0; i < pos.count; i += 1) {
          vec.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
          if (vec.y < mn) mn = vec.y;
          if (vec.y > mx) mx = vec.y;
        }
        return { name: o.name || '(unnamed)', minY: +mn.toFixed(4), maxY: +mx.toFixed(4), verts: pos.count };
      }).sort((a, b) => a.minY - b.minY),
      footprint: { minX: +lapMinX.toFixed(3), maxX: +lapMaxX.toFixed(3), minZ: +lapMinZ.toFixed(3), maxZ: +lapMaxZ.toFixed(3) },
      gap: hit ? +(lap.min - hit.y).toFixed(4) : null,
    };
  }, liftM);

  const real = await probe(0);
  const lifted = await probe(0.04);
  out.real = real;
  out.control = lifted;
  if (real.error) { fail(real.error); return out; }

  console.log(`laptop origin  local Y ${real.placedOriginLocalY}   world Y ${real.placedOriginWorldY}   (${real.trianglesTested} triangles tested underneath)`);
  console.log(`laptop drawn base        Y ${real.laptopBaseY}   (origin sits ${real.originAboveOwnBase} m above its own base, over ${real.laptopVerts} verts)`);
  console.log(`surface underneath       Y ${real.surface ? real.surface.y : 'NONE FOUND'}   ${real.surface ? real.surface.name : ''}`);
  for (const part of (real.parts || [])) {
    console.log(`   part ${String(part.name).padEnd(22)} minY ${String(part.minY).padStart(8)}  maxY ${String(part.maxY).padStart(8)}  verts ${part.verts}`);
  }
  console.log('everything the vertical line through the laptop passes through, highest first:');
  for (const h of (real.allHits || [])) console.log(`     Y ${String(h.y).padStart(9)}  ${h.name}`);
  console.log(`GAP (base - surface)       ${real.gap === null ? 'n/a' : real.gap} m`);
  console.log(`CONTROL, lifted 40 mm: gap ${lifted.gap === null ? 'n/a' : lifted.gap} m`);

  const delta = (lifted.gap !== null && real.gap !== null) ? lifted.gap - real.gap : null;
  if (delta === null || Math.abs(delta - 0.04) > 0.002) {
    fail(`CONTROL FAILED -- a 40 mm lift moved the reported gap by ${delta === null ? 'n/a' : delta.toFixed(4)} m, not 0.0400. This probe is not measuring the scene.`);
  } else {
    console.log('CONTROL PASSED -- the 40 mm lift moved the gap by 40 mm, so the probe reads the scene.');
  }

  // Seated means touching. A millimetre of tolerance, no more.
  if (real.gap === null) fail('nothing was found under the laptop at all');
  else if (Math.abs(real.gap) > 0.001) {
    fail(`the laptop is ${real.gap > 0 ? 'FLOATING BY' : 'SUNK INTO THE DESK BY'} ${(Math.abs(real.gap) * 1000).toFixed(1)} mm`);
  } else console.log('the laptop is seated: gap is under 1 mm');

  fs.mkdirSync('qa/laptop-seating', { recursive: true });
  fs.writeFileSync('qa/laptop-seating/seating.json', JSON.stringify(out, null, 2));
  console.log(`failures: ${out.failures.length}`);
  return out;
}
