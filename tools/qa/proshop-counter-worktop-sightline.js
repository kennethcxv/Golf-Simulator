// Can the worktable worktop and the reception counter run appear in ONE frame?
//
// ART_BIBLE §7.4.1's [V] gate asks for exactly that: both surfaces in a single front
// elevation, because two medium-walnut surfaces that read as two different woods is the
// failure calibration is most likely to produce. Whether one frame is physically
// possible is a property of the room, not of the gate, so it gets measured before a
// pose is authored — a composite would be the honest fallback, but only if the room
// forbids the real thing.
//
// Reports both subjects' world bounds and, for each candidate camera, whether an
// unobstructed ray reaches each subject and whether both fall inside the walk lens.
async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.SPIKE_SEED || 20260727);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(5000);

  return page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const origin = ch.interior.position;

    // Subjects. The counter is matched by name because it is built in clubhouse.js
    // rather than imported, so it has no AssetRuntime wrapper.
    const found = { worktop: null, counter: [] };
    const namesSeen = [];
    ch.interior.traverse((n) => {
      const name = n.name || '';
      if (/AssetRuntime_65_/.test(name)) found.worktop = n;
      if (/counter|reception|frontdesk|front_desk/i.test(name)) {
        namesSeen.push(name);
        if (n.isMesh) found.counter.push(n);
      }
    });

    const localBox = (obj) => {
      const b = new THREE.Box3().setFromObject(obj);
      return {
        min: [+(b.min.x - origin.x).toFixed(2), +(b.min.y - origin.y).toFixed(2), +(b.min.z - origin.z).toFixed(2)],
        max: [+(b.max.x - origin.x).toFixed(2), +(b.max.y - origin.y).toFixed(2), +(b.max.z - origin.z).toFixed(2)],
      };
    };

    const counterGroup = new THREE.Group();
    const counterBox = new THREE.Box3();
    found.counter.forEach((m) => counterBox.expandByObject(m));

    // Occlusion test: shoot from the candidate eye at each subject's top-surface centre
    // and see what the ray hits FIRST. A wall between them shows up as a nearer hit.
    const raycaster = new THREE.Raycaster();
    // Sprites raycast against the camera and throw without one. They are billboards,
    // never occluders, so exclude them rather than hand the raycaster a camera.
    raycaster.camera = s3.camera;
    const eye = window.__fw.scene3d.walk.state.eye ?? 1.75;

    const targets = {
      worktop: found.worktop
        ? (() => { const b = new THREE.Box3().setFromObject(found.worktop);
          return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y - 0.02, (b.min.z + b.max.z) / 2); })()
        : null,
      counter: found.counter.length
        ? new THREE.Vector3((counterBox.min.x + counterBox.max.x) / 2, counterBox.max.y - 0.02,
          (counterBox.min.z + counterBox.max.z) / 2)
        : null,
    };

    const candidates = [
      { id: 'shop-centre-east', at: [2.0, 2.6] },
      { id: 'shop-north-east', at: [1.0, 3.6] },
      { id: 'partition-doorway', at: [5.2, 1.2] },
      { id: 'room-centre', at: [0.0, 2.0] },
      { id: 'far-west', at: [-4.0, 2.0] },
      { id: 'stockroom-mouth', at: [4.8, -0.4] },
    ];

    const probe = candidates.map((c) => {
      const from = new THREE.Vector3(origin.x + c.at[0], origin.y + eye, origin.z + c.at[1]);
      const out = { id: c.id, at: c.at };
      for (const [key, target] of Object.entries(targets)) {
        if (!target) { out[key] = 'subject-not-found'; continue; }
        const dir = target.clone().sub(from);
        const dist = dir.length();
        raycaster.set(from, dir.normalize());
        raycaster.far = dist + 0.05;
        const hits = raycaster.intersectObject(s3.scene, true)
          .filter((h) => h.object.visible && h.object.isMesh && !h.object.isSprite && h.distance > 0.05);
        const first = hits[0];
        out[key] = {
          distYd: +dist.toFixed(2),
          clear: !!first && first.distance > dist - 0.25,
          firstHit: first ? `${first.object.name || '(unnamed)'} @${first.distance.toFixed(2)}` : 'nothing',
          // Bearing from the camera, so a pose can be authored to contain both.
          bearingDeg: +(Math.atan2(target.x - from.x, target.z - from.z) * 180 / Math.PI).toFixed(1),
        };
      }
      if (out.worktop?.bearingDeg != null && out.counter?.bearingDeg != null) {
        let spread = Math.abs(out.worktop.bearingDeg - out.counter.bearingDeg);
        if (spread > 180) spread = 360 - spread;
        out.bearingSpreadDeg = +spread.toFixed(1);
        // Horizontal FOV from the walk lens at 16:9.
        const vFov = window.__fw.scene3d.walk.state.fov;
        const hFov = 2 * Math.atan(Math.tan((vFov * Math.PI / 180) / 2) * (1600 / 900)) * 180 / Math.PI;
        out.hFovDeg = +hFov.toFixed(1);
        out.bothInFrame = spread < hFov * 0.9 && out.worktop.clear && out.counter.clear;
      }
      return out;
    });

    return {
      ok: true,
      worktopLocal: found.worktop ? localBox(found.worktop) : null,
      counterMeshCount: found.counter.length,
      counterNames: [...new Set(namesSeen)].slice(0, 20),
      counterLocal: found.counter.length ? {
        min: [+(counterBox.min.x - origin.x).toFixed(2), +(counterBox.min.y - origin.y).toFixed(2), +(counterBox.min.z - origin.z).toFixed(2)],
        max: [+(counterBox.max.x - origin.x).toFixed(2), +(counterBox.max.y - origin.y).toFixed(2), +(counterBox.max.z - origin.z).toFixed(2)],
      } : null,
      probe,
      anySingleFrame: probe.some((p) => p.bothInFrame),
    };
  });
}
