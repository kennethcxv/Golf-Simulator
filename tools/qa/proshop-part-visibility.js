// Per-part visibility sweep across the pro-shop prop population (assets 061-100).
//
// The asset_087 wall clock shipped with a complete cream dial that no camera angle could
// ever see, because a sibling part (a solid bezel cap) stood 8 mm in front of it. This
// tool measures for that defect class directly: for every named MESH_ part of every prop,
// it renders the asset in isolation with each part flat-coloured on the screen-time
// tool's 6-level ID lattice, from 26 directions on a sphere, and counts pixels per part.
// An opaque part with ZERO pixels from EVERY direction is authored geometry the player
// cannot see from any angle -- the 087 class.
//
// Choices that matter:
//  - Assets load straight from vendor/models (the runtime path), not from the room, so
//    room occlusion, the placed-static batch and starter-state gating cannot contaminate
//    the measurement. Bind pose; animations are not played.
//  - Parts whose ORIGINAL material is transparent (blend mode or opacity < 1) are hidden
//    for the pass and reported separately, never flagged: glass in front of a dial does
//    not hide it in the shipped game, and must not hide it here. They also cannot be
//    measured as subjects -- an ID material would make them opaque occluders.
//  - The flat ID material copies `side` from the original: a panel that backface-culls
//    in the game must backface-cull here, or the sweep under-reports.
//  - 512x512, no antialias, own renderer, NoToneMapping; render targets read back in the
//    working colour space, so 6-level linear values {0,.2,.4,.6,.8,1} round-trip exactly.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const crypto = process.getBuiltinModule('node:crypto');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const dataDir = path.join(repo, 'Designs', 'ProShop', 'Discriminator', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // Under Electron the window already sits on the packaged app at file://, which has
  // three.js and every GLB reachable relative to it. Navigating away would only swap
  // that for an HTTP server that has to be running. Under Playwright the page starts
  // blank, so it still needs the origin.
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  if (!page.url().startsWith('file://')) {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(800);

  // Population: every sheet under assets_51_100, asset number >= 61 with no upper
  // bound. tests/proshop-part-visibility.test.js enumerates the SAME rule and fails
  // when the JSON and the disk disagree, so an asset added to a new sheet cannot ship
  // unswept. Each entry carries the sha256 of the GLB bytes at sweep time -- the test's
  // staleness gate: rebuild a GLB and the suite refuses to trust this file until the
  // sweep is re-run.
  const glbRoot = path.join(repo, 'vendor', 'models', 'assets_51_100');
  const list = [];
  for (const sheet of fs.readdirSync(glbRoot).filter((d) => /^sheet_\d+$/.test(d))) {
    for (const file of fs.readdirSync(path.join(glbRoot, sheet))) {
      const m = /^asset_(\d{3})_.+\.glb$/.exec(file);
      if (!m) continue;
      const n = Number(m[1]);
      if (n < 61) continue;
      const bytes = fs.readFileSync(path.join(glbRoot, sheet, file));
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      // Relative, not root-absolute. Resolved page-side against document.baseURI the
      // same way three.js is, so the sweep runs unchanged on file:// and on http://.
      list.push({ n, url: `vendor/models/assets_51_100/${sheet}/${file}`, file, sheet, sha256 });
    }
  }
  list.sort((a, b) => a.n - b.n);

  const results = await page.evaluate(async (assets) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const { GLTFLoader } = await import(new URL('vendor/addons/loaders/GLTFLoader.js', document.baseURI).href);

    const SIZE = 512;
    const FILL = 0.85;
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(SIZE, SIZE);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 1);
    const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      depthBuffer: true,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    const loader = new GLTFLoader();
    const buf = new Uint8Array(SIZE * SIZE * 4);
    const decode = (v) => Math.round((v / 255) * 5);

    // 26 directions: the 3x3x3 lattice minus the centre, normalised. Full sphere --
    // the 087 defect is self-occlusion by sibling parts, which is orientation-free.
    const dirs = [];
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
      if (x || y || z) dirs.push(new THREE.Vector3(x, y, z).normalize());
    }

    const out = [];
    for (const asset of assets) {
      const gltf = await new Promise((resolve, reject) => {
        loader.load(new URL(asset.url, document.baseURI).href, resolve, undefined, reject);
      });
      const root = gltf.scene;
      root.updateMatrixWorld(true);

      const opaque = [];
      const transparent = [];
      const restore = [];
      root.traverse((node) => {
        if (!node.isMesh) return;
        const name = node.name || '';
        if (name.startsWith('COL_')) { restore.push([node, node.visible]); node.visible = false; return; }
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        const isTransparent = mats.some((m) => m && (m.transparent || m.opacity < 1));
        if (isTransparent) {
          transparent.push(name);
          restore.push([node, node.visible]);
          node.visible = false;
          return;
        }
        opaque.push(node);
      });

      // ID materials on the 6-level lattice; id 0 is the background.
      const originals = new Map();
      opaque.forEach((mesh, index) => {
        const id = index + 1;
        const mat = new THREE.MeshBasicMaterial();
        mat.color.setRGB((Math.floor(id / 36) % 6) / 5, (Math.floor(id / 6) % 6) / 5, (id % 6) / 5,
          THREE.LinearSRGBColorSpace);
        const orig = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        mat.side = orig ? orig.side : THREE.FrontSide;
        originals.set(mesh, mesh.material);
        mesh.material = mat;
      });

      const scene = new THREE.Scene();
      scene.add(root);

      const box = new THREE.Box3();
      for (const mesh of opaque) box.expandByObject(mesh);
      const centre = box.getCenter(new THREE.Vector3());
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.01);
      const fovV = (camera.fov * Math.PI) / 180;
      const dist = radius / Math.sin((FILL * fovV) / 2);
      camera.near = Math.max(dist - radius * 2, 0.005);
      camera.far = dist + radius * 4;
      camera.updateProjectionMatrix();

      const counts = opaque.map(() => ({ maxPx: 0, seenAngles: 0, totalPx: 0 }));
      let subjectPxTotal = 0;
      for (const dir of dirs) {
        camera.position.copy(centre).addScaledVector(dir, dist);
        camera.up.set(0, Math.abs(dir.y) > 0.9 ? 0 : 1, Math.abs(dir.y) > 0.9 ? 1 : 0);
        camera.lookAt(centre);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, buf);
        renderer.setRenderTarget(null);
        const perPart = opaque.map(() => 0);
        for (let i = 0; i < buf.length; i += 4) {
          const id = decode(buf[i]) * 36 + decode(buf[i + 1]) * 6 + decode(buf[i + 2]);
          if (id > 0 && id <= opaque.length) perPart[id - 1] += 1;
        }
        perPart.forEach((px, index) => {
          const c = counts[index];
          c.totalPx += px;
          if (px > 0) c.seenAngles += 1;
          if (px > c.maxPx) c.maxPx = px;
          subjectPxTotal += px;
        });
      }

      const parts = opaque.map((mesh, index) => ({
        name: mesh.name,
        triangles: mesh.geometry.index
          ? mesh.geometry.index.count / 3
          : mesh.geometry.attributes.position.count / 3,
        maxPx: counts[index].maxPx,
        seenAngles: counts[index].seenAngles,
        sharePct: subjectPxTotal ? +(100 * counts[index].totalPx / subjectPxTotal).toFixed(3) : 0,
      }));
      out.push({
        n: asset.n,
        file: asset.file,
        sheet: asset.sheet,
        sha256: asset.sha256,
        opaqueParts: opaque.length,
        transparentParts: transparent,
        animations: (gltf.animations || []).map((a) => a.name),
        parts,
        invisible: parts.filter((p) => p.maxPx === 0).map((p) => p.name),
        nearInvisible: parts
          .filter((p) => p.maxPx > 0 && p.maxPx < 8)
          .map((p) => `${p.name}(${p.maxPx}px)`),
      });

      for (const [mesh, material] of originals) mesh.material = material;
      for (const [node, visible] of restore) node.visible = visible;
      scene.remove(root);
    }
    renderer.dispose();
    target.dispose();
    return out;
  }, list);

  const flagged = results.filter((r) => r.invisible.length);
  const lines = [];
  for (const r of results) {
    if (!r.invisible.length && !r.nearInvisible.length) continue;
    lines.push(`asset_${String(r.n).padStart(3, '0')}  invisible: [${r.invisible.join(', ') || '-'}]`
      + (r.nearInvisible.length ? `  near: [${r.nearInvisible.join(', ')}]` : '')
      + (r.animations.length ? `  (has animations: ${r.animations.length})` : ''));
  }
  console.log(lines.join('\n') || 'no invisible parts anywhere');
  console.log(`assets with zero-visibility opaque parts: ${flagged.length} of ${results.length}; `
    + `parts flagged: ${flagged.reduce((s, r) => s + r.invisible.length, 0)}`);
  fs.writeFileSync(path.join(dataDir, 'part-visibility.json'),
    `${JSON.stringify({ directions: 26, size: 512, results }, null, 2)}\n`);
}
