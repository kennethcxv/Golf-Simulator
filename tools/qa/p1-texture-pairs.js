// P1: every asset in the 19-file texture pass, rendered against its own untextured self.
//
// The pass is only real if the difference is VISIBLE, and only honest if the two halves
// differ in nothing but the maps. So the "before" half is not a memory or a previous
// screenshot: it is the exact bytes git holds at HEAD for the same file, extracted to
// qa/p1-texture/before/, loaded into the SAME scene, at the SAME camera, under the SAME
// lights, in the runtime renderer the player actually looks through.
//
// NEGATIVE CONTROL, and it matters more here than usual. A pair-differ that reports
// "changed" for every pair proves nothing — it could be reporting camera jitter, a
// different framing, or its own noise. So every asset is ALSO compared against itself:
// the textured render captured twice. That self-pair must come back at ~0% changed. If
// it does not, the instrument is measuring something other than the texture pass and no
// number below can be trusted.
//
//   node tools/qa/run-electron.cjs tools/qa/p1-texture-pairs.js
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const OUT = path.join(repo, 'qa', 'p1-texture', 'pairs');
  fs.mkdirSync(OUT, { recursive: true });

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  const beforeDir = path.join(repo, 'qa', 'p1-texture', 'before');
  const glbRoot = path.join(repo, 'vendor', 'models', 'assets_51_100');
  const pairs = [];
  for (const sheet of ['sheet_07', 'sheet_08', 'firstperson']) {
    const dir = path.join(glbRoot, sheet);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.glb')) continue;
      if (!fs.existsSync(path.join(beforeDir, file))) continue;  // unchanged by the pass
      pairs.push({
        file,
        after: `vendor/models/assets_51_100/${sheet}/${file}`,
        before: `qa/p1-texture/before/${file}`,
      });
    }
  }

  const shots = await page.evaluate(async (assets) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const { GLTFLoader } = await import(new URL('vendor/addons/loaders/GLTFLoader.js', document.baseURI).href);

    const W = 640;
    const H = 480;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const loader = new GLTFLoader();
    const load = (url) => new Promise((res, rej) =>
      loader.load(new URL(url, document.baseURI).href, res, undefined, rej));

    // Fixed three-point rig. Deliberately NOT the shop's lighting: a texture has to
    // survive a neutral studio before it earns a place in a lit room, and a rig that
    // moves between the halves would put its own difference into the comparison.
    function makeScene() {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x2a2d31);
      scene.add(new THREE.HemisphereLight(0xdfe6ea, 0x2b2622, 1.05));
      const key = new THREE.DirectionalLight(0xfff3e2, 2.3);
      key.position.set(2.4, 3.2, 2.0);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xcfe0ff, 0.65);
      fill.position.set(-2.6, 1.4, -1.2);
      scene.add(fill);
      return scene;
    }

    // One camera solve per ASSET, from the textured half, reused for both halves —
    // so a bounding-box difference could never reframe one of them.
    function frame(camera, box) {
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.length() * 0.5, 0.05);
      const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 0.92;
      camera.position.set(
        centre.x + dist * 0.62, centre.y + dist * 0.44, centre.z + dist * 0.65,
      );
      camera.lookAt(centre);
      camera.near = Math.max(dist * 0.01, 0.01);
      camera.far = dist * 8;
      camera.updateProjectionMatrix();
    }

    // Raw framebuffer, not a re-decoded PNG. Comparing the pixels the GPU produced
    // removes the encoder from the loop entirely, which is one fewer thing that could
    // be the source of a difference.
    function pixels() {
      const gl = renderer.getContext();
      const buf = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf;
    }

    // Percentage of the frame is the wrong denominator. A pressure-washer hose is a
    // thin dark line on a dark ground: it can be completely retextured and still move
    // under 1% of the FRAME, which reads as "no change" when the truth is "small
    // object". So the denominator is the pixels the object actually covers.
    //
    // The threshold is 3/765, not the 12 an anti-aliased photo comparison would want,
    // because these two renders are bit-identical wherever nothing changed — the
    // self-pair control proves it at 0.000%. With no noise to reject, a low threshold
    // costs nothing and lets a dark surface report the few code values it genuinely
    // moves. The mean delta over covered pixels is reported beside it, because a
    // fraction alone cannot distinguish "barely moved everywhere" from "moved a lot".
    const BG = [0x2a, 0x2d, 0x31];
    function compare(a, b) {
      let changed = 0;
      let covered = 0;
      let sum = 0;
      for (let i = 0; i < a.length; i += 4) {
        const isBg = Math.abs(a[i] - BG[0]) + Math.abs(a[i + 1] - BG[1]) + Math.abs(a[i + 2] - BG[2]) <= 2
          && Math.abs(b[i] - BG[0]) + Math.abs(b[i + 1] - BG[1]) + Math.abs(b[i + 2] - BG[2]) <= 2;
        if (isBg) continue;
        covered += 1;
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        sum += d;
        if (d > 3) changed += 1;
      }
      return {
        coveredPx: covered,
        changedOfCoveredPct: covered ? +((changed / covered) * 100).toFixed(2) : 0,
        meanDeltaOverCovered: covered ? +(sum / covered).toFixed(2) : 0,
        changedOfFramePct: +((changed / (W * H)) * 100).toFixed(2),
      };
    }

    async function shoot(url, camera, boxOut) {
      const gltf = await load(url);
      const scene = makeScene();
      scene.add(gltf.scene);
      // Authoring-only geometry would dominate a silhouette and is never drawn in game.
      gltf.scene.traverse((n) => {
        if (n.isMesh && /collision|COL_|_col$/i.test(n.name || '')) n.visible = false;
      });
      const box = new THREE.Box3().setFromObject(gltf.scene);
      if (boxOut) boxOut.copy(box);
      if (camera === null) return null;
      renderer.render(scene, camera);
      const result = { png: canvas.toDataURL('image/png'), raw: pixels() };
      scene.clear();
      return result;
    }

    const out = [];
    for (const asset of assets) {
      try {
        const camera = new THREE.PerspectiveCamera(38, W / H, 0.01, 100);
        const box = new THREE.Box3();
        await shoot(asset.after, null, box);      // measure only
        frame(camera, box);
        const after = await shoot(asset.after, camera);
        const before = await shoot(asset.before, camera);
        // NEGATIVE CONTROL: the same half twice, through the same path.
        const afterAgain = await shoot(asset.after, camera);
        out.push({
          file: asset.file,
          afterPng: after.png,
          beforePng: before.png,
          diff: compare(after.raw, before.raw),
          control: compare(after.raw, afterAgain.raw),
        });
      } catch (err) {
        out.push({ file: asset.file, error: String(err && err.message ? err.message : err) });
      }
    }
    renderer.dispose();
    return out;
  }, pairs);

  const rows = [];
  for (const shot of shots) {
    if (shot.error) { rows.push({ file: shot.file, error: shot.error }); continue; }
    const stem = shot.file.replace(/\.glb$/, '');
    fs.writeFileSync(path.join(OUT, `${stem}__after.png`), Buffer.from(shot.afterPng.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, `${stem}__before.png`), Buffer.from(shot.beforePng.split(',')[1], 'base64'));
    rows.push({
      file: shot.file,
      coveredPx: shot.diff.coveredPx,
      changedOfCoveredPct: shot.diff.changedOfCoveredPct,
      meanDeltaOverCovered: shot.diff.meanDeltaOverCovered,
      changedOfFramePct: shot.diff.changedOfFramePct,
      controlChangedOfCoveredPct: shot.control.changedOfCoveredPct,
    });
  }

  const real = rows.filter((r) => !r.error);
  const checks = {
    everyAssetRendered: rows.length > 0 && rows.every((r) => !r.error),
    // Every asset must LOOK different over its own surface, not just carry bytes.
    everyAssetVisiblyChanged: real.every((r) => r.changedOfCoveredPct >= 5),
    // NEGATIVE CONTROL: the same render twice must be identical, or the differ is noise.
    controlIsQuiet: real.every((r) => r.controlChangedOfCoveredPct < 0.05),
    noPageErrors: errs.length === 0,
  };
  const out = {
    assets: rows.length,
    medianChangedOfCoveredPct: real.length
      ? real.map((r) => r.changedOfCoveredPct).sort((x, y) => x - y)[Math.floor(real.length / 2)]
      : 0,
    worstControlPct: real.length ? Math.max(...real.map((r) => r.controlChangedOfCoveredPct)) : 0,
    rows, errs: errs.slice(0, 8), checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'pairs.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
