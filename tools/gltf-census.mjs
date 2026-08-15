// glTF census — H3. Replaces the hand-rolled census scripts.
//
// Usage:
//   node tools/gltf-census.mjs <file.glb> [more...]
//
// For each file, reports meshes / materials / textures / triangles via
// @gltf-transform, then reports what `dedup` and `prune` WOULD remove by
// running them on an in-memory copy and diffing the counts. REPORT ONLY —
// nothing on disk is touched.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { statSync } from 'node:fs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function counts(doc) {
  const root = doc.getRoot();
  let tris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const verts = idx ? idx.getCount() : pos ? pos.getCount() : 0;
      if (prim.getMode() === 4) tris += Math.floor(verts / 3);
    }
  }
  return {
    meshes: root.listMeshes().length,
    prims: root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    accessors: root.listAccessors().length,
    triangles: tris,
  };
}

const rows = [];
for (const f of process.argv.slice(2)) {
  const before = counts(await io.read(f));
  const dedupDoc = await io.read(f);
  await dedupDoc.transform(dedup());
  const afterDedup = counts(dedupDoc);
  const pruneDoc = await io.read(f);
  await pruneDoc.transform(dedup(), prune());
  const afterBoth = counts(pruneDoc);
  const glb = await io.writeBinary(pruneDoc);
  rows.push({
    file: f.replace(/\\/g, '/').split('/').pop(),
    sizeKB: Math.round(statSync(f).size / 1024),
    ...before,
    dedupWouldRemove: {
      materials: before.materials - afterDedup.materials,
      textures: before.textures - afterDedup.textures,
      accessors: before.accessors - afterDedup.accessors,
    },
    pruneAfterDedupKB: Math.round(glb.byteLength / 1024),
  });
}
console.table(rows.map((r) => ({
  file: r.file, KB: r.sizeKB, meshes: r.meshes, mats: r.materials, tex: r.textures,
  tris: r.triangles,
  'dedup: -mats': r.dedupWouldRemove.materials, '-tex': r.dedupWouldRemove.textures, '-acc': r.dedupWouldRemove.accessors,
  'dedup+prune KB': r.pruneAfterDedupKB,
})));
