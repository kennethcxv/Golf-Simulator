// H2 — DO THE THREE VENDORED LIBRARIES ACTUALLY LOAD IN ELECTRON?
//
// An import that resolves in Node and 404s in the app is a shape that has
// bitten this project (npm install does nothing for the renderer; only the
// vendor/ copies are real). So the proof is a dynamic import IN THE RENDERER,
// through the import map, under the shipped CSP — not a Node resolve.
//
// Each lib must import AND yield a working signature symbol:
//   troika-three-text  -> new Text() constructs a THREE object (three resolved)
//   postprocessing     -> new BloomEffect() builds its shader strings
//   three-mesh-bvh     -> MeshBVH built over a real BoxGeometry, node count > 0
//
// CONTROL: importing vendor/definitely-absent.module.js must REJECT. If the
// control "loads", the instrument is measuring nothing and the run is void.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-vendor-libs.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/vendor-libs');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], libs: {}, control: null };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  out.libs = await page.evaluate(async () => {
    const r = {};
    try {
      const troika = await import('./vendor/troika-three-text.module.js');
      const t = new troika.Text();
      t.text = 'PROOF';
      r.troika = { loaded: true, textIsObject3D: !!t.isObject3D, symbols: ['Text', 'preloadFont'].filter((s) => s in troika) };
      t.dispose();
    } catch (e) { r.troika = { loaded: false, error: String(e) }; }
    try {
      const pp = await import('./vendor/postprocessing.module.js');
      const bloom = new pp.BloomEffect();
      r.postprocessing = {
        loaded: true,
        bloomHasShader: typeof bloom.getFragmentShader === 'function' && !!bloom.getFragmentShader(),
        symbols: ['EffectComposer', 'RenderPass', 'EffectPass', 'SMAAEffect'].filter((s) => s in pp),
      };
      bloom.dispose();
    } catch (e) { r.postprocessing = { loaded: false, error: String(e) }; }
    try {
      const [bvhLib, THREE] = await Promise.all([import('./vendor/three-mesh-bvh.module.js'), import('three')]);
      const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
      const bvh = new bvhLib.MeshBVH(geo);
      const nodeCount = bvh._roots ? bvh._roots.length : 0;
      r.bvh = { loaded: true, builtRoots: nodeCount, symbols: ['MeshBVH', 'acceleratedRaycast'].filter((s) => s in bvhLib) };
      geo.dispose();
    } catch (e) { r.bvh = { loaded: false, error: String(e) }; }
    return r;
  });

  // CONTROL — a missing vendor file must fail, or this driver proves nothing.
  out.control = await page.evaluate(async () => {
    try {
      await import('./vendor/definitely-absent.module.js');
      return { rejected: false, verdict: 'VOID — the instrument cannot see a 404' };
    } catch (e) {
      return { rejected: true, error: String(e).slice(0, 120) };
    }
  });

  const allLoaded = out.libs.troika?.loaded && out.libs.postprocessing?.loaded && out.libs.bvh?.loaded;
  out.verdict = allLoaded && out.control.rejected ? 'PASS' : 'FAIL';
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
