// GOAL 29 P4 — round 2: the plant never reaches compile()'s traverse or the
// render list. Establish WHERE it goes missing with direct evidence.
//   node tools/qa/run-electron.cjs tools/qa/goal29-properties-probe.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  const out = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const renderer = s3.renderer;
    const scene = s3.scene;
    const camera = s3.camera;
    const report = {};
    report.sceneType = scene?.type;
    report.sceneIsScene = scene?.isScene === true;
    report.cameraLayersMask = camera?.layers?.mask;
    report.sceneChildrenBefore = scene.children.length;
    report.addOwn = Object.prototype.hasOwnProperty.call(scene, 'add') ? 'scene has OWN add (patched)' : 'prototype add';

    let donor = null;
    scene.traverse((o) => {
      if (donor || !o.isMesh || Array.isArray(o.material)) return;
      const pos = o.geometry?.attributes?.position;
      if (pos && !pos.isInterleavedBufferAttribute) donor = o;
    });
    const donorProps = renderer.properties.get(donor.material);
    report.donorName = donor.name || donor.type;
    report.donorMaterialPropKeys = Object.keys(donorProps || {}).slice(0, 12);
    report.donorProgramsSize = donorProps?.programs?.size ?? null;

    const material = donor.material.clone();
    material.name = 'Goal29ProbePlant2';
    material.side = 2;
    const GeoC = donor.geometry.constructor;
    const BA = donor.geometry.attributes.position.constructor;
    const tri = new GeoC();
    tri.setIndex?.(null);
    for (const name of Object.keys(tri.attributes || {})) tri.deleteAttribute(name);
    tri.setAttribute('position', new BA(new Float32Array([0, 0, 0, 0.05, 0, 0, 0, 0.05, 0]), 3));
    tri.computeVertexNormals();
    tri.setAttribute('uv', new BA(new Float32Array(6), 2));
    const mesh = new donor.constructor(tri, material);
    mesh.name = 'Goal29ProbePlantMesh2';
    mesh.frustumCulled = false;
    scene.add(mesh);
    report.meshParentIsScene = mesh.parent === scene;
    report.sceneChildrenAfter = scene.children.length;
    report.meshInChildren = scene.children.includes(mesh);
    let foundByTraverse = false;
    scene.traverse((o) => { foundByTraverse = foundByTraverse || o === mesh; });
    report.foundByTraverse = foundByTraverse;

    report.plantIsMesh = mesh.isMesh === true;
    report.plantType = mesh.type;
    report.plantCtor = donor.constructor.name;
    report.compileSource = String(renderer.compile).slice(0, 260);
    // compile's own filter, reimplemented byte-for-byte: does it reach the plant?
    let reimplVisited = false;
    scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      if (o === mesh && o.material) reimplVisited = true;
    });
    report.reimplVisited = reimplVisited;

    let compileErr = null;
    let setSize = null;
    let setHasPlant = null;
    let setHasDonorMat = null;
    try {
      const set = renderer.compile(scene, camera);
      setSize = set?.size ?? String(set);
      setHasPlant = set?.has?.(material) ?? null;
      setHasDonorMat = set?.has?.(donor.material) ?? null;
    } catch (e) { compileErr = String(e?.message || e); }
    const props = renderer.properties.get(material);
    report.compileErr = compileErr;
    report.compileSetSize = setSize;
    report.compileSetHasPlant = setHasPlant;
    report.compileSetHasDonorMaterial = setHasDonorMat;
    report.plantPropKeysAfterCompile = Object.keys(props || {}).slice(0, 12);
    report.plantProgramsSizeAfterCompile = props?.programs?.size ?? null;

    mesh.removeFromParent();
    material.dispose();
    tri.dispose();
    return report;
  });
  console.log(JSON.stringify(out, null, 2));
  return out;
}
