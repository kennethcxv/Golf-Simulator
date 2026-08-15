// Requirement 2 (Goal 17) — THE OTHER HALF OF THE STALE-ASSET CHECK.
//
// Reads the RUNTIME GLB the game actually fetches (vendor/models/...), and
// summarises the same content the Blender-side dump summarises: node names,
// node world positions, mesh vertex totals, animation names. Then diffs.
//
// Byte hashes are deliberately not the test. The canonical copy under assets/
// and the runtime copy under vendor/models/ are legitimately different files
// (the canonical carries JPEG textures the runtime does not), and two runs of
// Blender's exporter differ in ordering anyway. What must match is the RIG.
//
//   node tools/qa/compare-shipped-asset.mjs <blend-dump.json> <runtime.glb>
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [, , dumpPath, glbPath] = process.argv;
if (!dumpPath || !glbPath) {
  console.error('usage: compare-shipped-asset.mjs <blend-dump.json> <runtime.glb>');
  process.exit(2);
}

const blend = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
// The shipped GLBs declare KHR_texture_transform as REQUIRED, so a bare reader
// refuses them outright. Registering the full extension set is what lets this
// read the same file the game reads.
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glbPath);
const root = doc.getRoot();

// A GLB node's translation is LOCAL. A socket that moved in the source shows up
// in its WORLD position, so the parent chain has to be walked - comparing local
// translations would miss a socket whose parent moved, which is exactly the
// shape of stale-asset bug this check exists to catch.
const parentOf = new Map();
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const worldOf = (node) => {
  let x = 0; let y = 0; let z = 0;
  for (let cur = node; cur; cur = parentOf.get(cur)) {
    const t = cur.getTranslation();
    x += t[0]; y += t[1]; z += t[2];
  }
  return [+x.toFixed(4), +y.toFixed(4), +z.toFixed(4)];
};

const nodes = root.listNodes().map((n) => {
  const mesh = n.getMesh();
  let verts = 0;
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (pos) verts += pos.getCount();
    }
  }
  return { name: n.getName(), verts, world: worldOf(n) };
});
const glbNames = new Set(nodes.map((n) => n.name));
const glbVerts = nodes.reduce((a, n) => a + n.verts, 0);
const glbAnims = root.listAnimations().map((a) => a.getName()).sort();

const blendNames = new Set(blend.objects.map((o) => o.name));
const blendVerts = blend.meshTotalVerts;

// Sockets are the contract the rig reads. An empty in Blender becomes a node in
// the GLB, so every SOCKET_ name must survive the export.
const blendSockets = Object.keys(blend.sockets).sort();
const glbSockets = [...glbNames].filter((n) => n.startsWith('SOCKET_')).sort();

const missingInGlb = blendSockets.filter((s) => !glbNames.has(s));
const extraInGlb = glbSockets.filter((s) => !blendNames.has(s));

// Socket world positions, source against shipped. Blender is Z-up and the
// exporter writes Y-up, so the axes are permuted: (x, y, z) becomes (x, z, -y).
// The comparison applies that rather than pretending the numbers should match
// as written, because a check that always fails teaches nobody anything.
const socketDrift = [];
for (const name of blendSockets) {
  const node = nodes.find((n) => n.name === name);
  if (!node) continue;
  const b = blend.sockets[name];
  const expected = [b[0], b[2], -b[1]];
  const got = node.world;
  const dist = Math.hypot(expected[0] - got[0], expected[1] - got[1], expected[2] - got[2]);
  socketDrift.push({ name, blendYup: expected.map((v) => +v.toFixed(4)), glb: got, driftM: +dist.toFixed(4) });
}
const worstDrift = socketDrift.length ? Math.max(...socketDrift.map((d) => d.driftM)) : null;

const result = {
  glb: glbPath,
  blend: blend.blend,
  blendObjects: blend.objectCount,
  glbNodes: nodes.length,
  blendMeshVerts: blendVerts,
  glbMeshVerts: glbVerts,
  // Blender's exporter splits and merges, so an exact vertex match is not
  // expected; a LARGE divergence is what a stale asset looks like.
  vertRatio: blendVerts ? +(glbVerts / blendVerts).toFixed(3) : null,
  blendSockets,
  glbSockets,
  socketDrift,
  worstSocketDriftM: worstDrift,
  socketsMissingFromGlb: missingInGlb,
  socketsNotInBlend: extraInGlb,
  blendActions: blend.actions,
  glbAnimations: glbAnims,
  animationsMissingFromGlb: blend.actions.filter((a) => !glbAnims.includes(a)),
  verdict: {
    everySocketShipped: missingInGlb.length === 0,
    everyActionShipped: blend.actions.filter((a) => !glbAnims.includes(a)).length === 0,
    // THE REAL TEST: a socket that moved in the source but not in the shipped
    // file. 1 mm is far below anything a rig cares about and far above export
    // rounding.
    socketsAgree: worstDrift != null && worstDrift < 0.001,
    // The exporter splits vertices at UV and normal seams, so the GLB carrying
    // roughly one to three times the source's vertex count is HEALTHY, not
    // suspicious. Only a wild ratio means a different mesh.
    vertexRatioHealthy: blendVerts > 0 && glbVerts / blendVerts > 0.9 && glbVerts / blendVerts < 3.5,
  },
};
console.log(JSON.stringify(result, null, 1));
