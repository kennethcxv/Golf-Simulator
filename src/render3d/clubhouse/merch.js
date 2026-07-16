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
  // goods
  'polo_hanging', 'polo_folded', 'jacket_hanging', 'glove', 'shoe', 'bag',
  'head_driver', 'head_iron', 'head_wedge', 'head_putter', 'cap',
  // furniture + operational kit (tools/blender/build_props.py)
  'chair_lounge', 'chair_office', 'trophy',
  'register', 'scanner', 'cardterm', 'printer', 'cash_drawer',
  'carton', 'carton_open', 'handtruck', 'pendant',
  // the register kit a cashier's hands touch (tools/blender/build_register.py)
  'basket', 'bag_open', 'impulse_rack', 'divider',
  // production checkout kit (tools/blender/build_checkout_assets.py)
  'checkout_counter', 'checkout_cash_drawer', 'checkout_scanner',
  'checkout_card_reader', 'checkout_receipt_printer', 'checkout_shopping_bag',
  // Compact, checkout-scale product families (tools/blender/build_checkout_products.py).
  // Sibling SKUs share one authored silhouette and vary through tint/tier identity.
  'checkout_product_driver', 'checkout_product_iron_set', 'checkout_product_putter',
  'checkout_product_wedge', 'checkout_product_ball_carton',
  'checkout_product_folded_polo', 'checkout_product_folded_jacket',
  'checkout_product_cap', 'checkout_product_glove', 'checkout_product_tee_pouch',
  'checkout_product_towel_roll', 'checkout_product_marker_blister',
  'checkout_product_rangefinder', 'checkout_product_umbrella',
  'checkout_product_stand_bag', 'checkout_product_shoe_pair',
  'checkout_product_sock_pair', 'checkout_product_headcover',
];

// Textured HERO props (Tripo scans, normalised by tools/blender/process_tripo.py).
// Unlike FILES, these KEEP their own baked PBR atlas material. They are placed as
// singletons (a pair of chairs, one card terminal, one gondola), so the material-count
// discipline that instantiate() enforces buys nothing here and would only throw away
// the fidelity that is the whole point of using a real scan. Loaded the same way,
// handed out by instantiateRaw(), never slot-swapped.
const RAW = [
  'armchair', 'office_chair', 'cardterm_pro', 'kiosk',
  // repeated products — one baked-atlas material each, so a whole shelf of them still
  // bakes (see bake()) into a single draw call, texture intact.
  'shoe_pro', 'cap_pro', 'rangefinder',
];

// Which slot in the GLB maps to which material in the clubhouse kit.
const SLOT = {
  M_rubber: 'merchRubber',
  M_steel: 'merchSteel',
  M_darkmetal: 'merchDark',
  M_wood: 'merchWood',
  M_plastic: 'merchPlastic',
  M_white: 'merchWhite',
  M_trim: 'merchWhite',
  // props
  M_darkwood: 'walnutDark',
  M_brass: 'brass',
  M_charcoal: 'charcoal',
  M_kraft: 'kraft',
  M_tape: 'merchWhite',
  M_paper: 'trimPaint',
  M_glass: 'glass',
  M_screen: 'charcoal',   // the live screens get their own canvas material
  // production checkout palette
  M_Cream: 'trimPaint',
  M_OffWhite: 'merchWhite',
  M_DeepGreen: 'greenPaint',
  M_Sage: 'sagePaint',
  M_Walnut: 'walnut',
  M_DarkWalnut: 'walnutDark',
  M_NaturalOak: 'rawWood',
  M_Charcoal: 'charcoal',
  M_Plastic: 'plastic',
  M_Rubber: 'rubber',
  M_Brass: 'brass',
  M_Steel: 'chrome',
  M_Glass: 'glass',
  M_Paper: 'trimPaint',
  M_Kraft: 'kraft',
};

// These small authored materials carry meaningful emissive feedback. Keeping the
// imported material preserves that signal without adding a per-instance material.
const PRESERVE = new Set(['M_Screen', 'M_ScannerBeam', 'M_StatusLED']);

// The slots that take a per-item colour. A polo's body is fabric; a golf shoe's
// upper is LEATHER — tinting only fabric left every shoe on the wall the same
// shade of brown. Both are tintable, and both cache by (slot, colour) so twelve
// polos in four colours still cost four materials, not twelve.
const TINTABLE = {
  M_fabric: 'merchFabric',
  M_leather: 'merchLeather',
  // Checkout sibling SKUs share geometry but tint one authored identity band.
  // The cache key includes the tint, so three tiers cost three stable materials,
  // never one clone per transaction item.
  M_SKUAccent: 'merchPlastic',
};

export function createMerch(mats) {
  const protos = new Map();
  const clips = new Map();
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
    if (PRESERVE.has(name)) return src;
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
      // remember which Blender slot this was BEFORE it is swapped out, so a
      // caller can still find, say, the register's screen and hang a live
      // canvas on it
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      o.userData.slot = (src && src.name) || null;
      // Authoring-only collision and contents volumes are valuable to validators
      // and runtime lookup, but must never become visible shop geometry.
      if (o.name.startsWith('COL_') || o.name.startsWith('VOLUME_') || o.name === 'ScannerBeam') {
        o.visible = false;
      }
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => resolve(m, tint))
        : resolve(o.material, tint);
    });
    if (scale !== 1) obj.scale.setScalar(scale);
    return obj;
  }

  // A textured hero prop: clone (which shares geometry AND the baked material by
  // reference, so ten instances cost ten draw calls and exactly ONE material) with no
  // slot remapping — the Tripo atlas is left exactly as authored.
  function instantiateRaw(name, { scale = 1 } = {}) {
    const proto = protos.get(name);
    if (!proto) return null;
    const obj = proto.clone(true);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    if (scale !== 1) obj.scale.setScalar(scale);
    return obj;
  }

  // find the mesh that came from a given Blender material slot
  function slotMesh(obj, slot) {
    let hit = null;
    obj.traverse((o) => { if (!hit && o.isMesh && o.userData.slot === slot) hit = o; });
    return hit;
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
  let pending = FILES.length + RAW.length;
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
        clips.set(name, g.animations || []);
        done();
      },
      undefined,
      () => done(), // a missing model must not wedge the shop; it just won't show
    );
  }
  for (const name of RAW) {
    loader.load(
      `vendor/models/clubhouse/${name}.glb`,
      (g) => {
        const root = g.scene;
        root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
        protos.set(name, root);
        done();
      },
      undefined,
      () => done(),
    );
  }

  return {
    instantiate,
    instantiateRaw,
    slotMesh,
    bake,
    isReady: () => ready,
    has: (n) => protos.has(n),
    animations: (n) => clips.get(n) || [],
    // the models arrive after the shop is built; the caller restocks on ready
    onReady(fn) { if (ready) fn(); else waiting.push(fn); },
  };
}
