// MERCHANDISE MODELS — the Blender-authored goods, and the rules for putting
// them in the shop cheaply.
//
// The audit found two separate problems and this module fixes both.
//
// SILHOUETTE. Polos were flat saturated slabs, driver heads squashed spheres,
// bags cylinders, shoes lumps. Those are organic forms that primitives cannot
// reach, so they are modelled in Blender (tools/blender/build_merch.py) and
// loaded from vendor/models/clubhouse/.
//
// COST. The old rebuildStock() called `new THREE.MeshStandardMaterial(...)`
// inside a per-SKU, per-fixture, per-ITEM loop. Stocking the shop minted 77 new
// materials and 685 new meshes, and the interior was already carrying 1,214
// meshes for 42,000 triangles — 34 triangles per mesh. The shop is draw-call
// bound, not triangle bound.
//
// So: every model's Blender material is a NAMED SLOT (`M_fabric`, `M_leather`,
// …) that is remapped here onto ONE shared kit material — tints are cached by
// colour, never rebuilt — and a whole fixture's goods are merged, per material,
// into a handful of geometries. Detail is close to free; a draw call is not.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FILES = [
  'polo_hanging', 'polo_folded', 'jacket_hanging', 'glove', 'shoe', 'bag',
  'head_driver', 'head_iron', 'head_wedge', 'head_putter', 'cap',
];

// Which slot in the GLB maps to which material in the clubhouse kit.
const SLOT = {
  M_leather: 'merchLeather',
  M_rubber: 'merchRubber',
  M_steel: 'merchSteel',
  M_darkmetal: 'merchDark',
  M_wood: 'merchWood',
  M_plastic: 'merchPlastic',
  M_white: 'merchWhite',
  M_trim: 'merchWhite',
};

// The slots that take a per-item colour. A polo's body is fabric; a golf shoe's
// upper is LEATHER — tinting only fabric left every shoe on the wall the same
// shade of brown. Both are tintable, and both cache by (slot, colour) so twelve
// polos in four colours still cost four materials, not twelve.
const TINTABLE = { M_fabric: 'merchFabric', M_leather: 'merchLeather' };

export function createMerch(mats) {
  const protos = new Map();
  const tints = new Map();     // 'fabric|0x3f7a34' -> Material, built once, reused forever
  let ready = false;
  const waiting = [];

  function tinted(slot, tint) {
    const base = mats[TINTABLE[slot]];
    if (tint == null) return base;
    const key = slot + '|' + tint;
    let m = tints.get(key);
    if (!m) {
      m = base.clone();
      m.color = new THREE.Color(tint);
      tints.set(key, m);
    }
    return m;
  }

  function resolve(src, tint) {
    const name = (src && src.name) || 'M_fabric';
    if (TINTABLE[name]) return tinted(name, tint);
    return mats[SLOT[name]] || mats.charcoal;
  }

  // A clone shares geometry (free) and we overwrite the material with a shared
  // one, so an instantiated polo costs a draw call and nothing else.
  function instantiate(name, { tint = null, scale = 1 } = {}) {
    const proto = protos.get(name);
    if (!proto) return null;
    const obj = proto.clone(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => resolve(m, tint))
        : resolve(o.material, tint);
    });
    if (scale !== 1) obj.scale.setScalar(scale);
    return obj;
  }

  // Collapse a built group into one mesh per material. Rebuilt only when stock
  // changes, so the merge cost is paid on restock, not per frame.
  function bake(group) {
    const buckets = new Map();
    const keep = [];
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!o.isMesh) return;
      if (Array.isArray(o.material) || !o.geometry) { keep.push(o); return; }
      const m = o.material;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      // merging needs identical attribute sets; drop anything exotic
      for (const attr of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(attr)) g.deleteAttribute(attr);
      }
      if (!g.attributes.uv) {
        const n = g.attributes.position.count;
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      }
      if (!buckets.has(m)) buckets.set(m, []);
      buckets.get(m).push(g);
    });
    if (!buckets.size) return group;

    const out = new THREE.Group();
    for (const [m, geos] of buckets) {
      let merged;
      try {
        merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      } catch (e) {
        merged = null;
      }
      if (!merged) { // a mismatched set: keep them loose rather than lose them
        for (const g of geos) out.add(new THREE.Mesh(g, m));
        continue;
      }
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.add(mesh);
    }
    for (const k of keep) out.add(k);
    return out;
  }

  const loader = new GLTFLoader();
  let pending = FILES.length;
  const done = () => {
    if (--pending > 0) return;
    ready = true;
    for (const fn of waiting) fn();
    waiting.length = 0;
  };
  for (const name of FILES) {
    loader.load(
      `vendor/models/clubhouse/${name}.glb`,
      (g) => {
        const root = g.scene;
        root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        protos.set(name, root);
        done();
      },
      undefined,
      () => done(), // a missing model must not wedge the shop; it just won't show
    );
  }

  return {
    instantiate,
    bake,
    isReady: () => ready,
    has: (n) => protos.has(n),
    // the models arrive after the shop is built; the caller restocks on ready
    onReady(fn) { if (ready) fn(); else waiting.push(fn); },
  };
}
