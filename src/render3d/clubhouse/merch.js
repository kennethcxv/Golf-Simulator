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
import { CachedGLTFLoader as GLTFLoader } from '../gltfCache.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { closeTextureImages } from './resourceLifecycle.js';
import {
  CLUBHOUSE_SHARED_TEXTURE_FAMILIES, createSharedTexturePool,
} from './sharedTexturePool.js';
import { SHOP_FIXTURE_MODELS } from '../../data/shopAssets.js';

const FILES = [
  // goods
  'polo_hanging', 'polo_folded', 'jacket_hanging', 'glove', 'bag',
  'head_driver', 'head_iron', 'head_wedge', 'head_putter', 'cap',
  // furniture + operational kit (tools/blender/build_props.py)
  'trophy', 'cash_drawer',
  'carton', 'carton_open', 'pendant',
  // the register kit a cashier's hands touch (tools/blender/build_register.py)
  'basket',
  // production checkout kit (tools/blender/build_checkout_assets.py).
  // The two green task trays left this list 2026-07-30 (checkout-physicality
  // round): goods and counted change live on the bare counter now.
  'checkout_counter', 'checkout_cash_drawer', 'checkout_shopping_bag',
  // Compact, checkout-scale product families (tools/blender/build_checkout_products.py).
  // Sibling SKUs share one authored silhouette and vary through tint/tier identity.
  'checkout_product_driver', 'checkout_product_iron_set', 'checkout_product_putter',
  'checkout_product_wedge', 'checkout_product_ball_carton',
  'checkout_product_folded_polo', 'checkout_product_folded_jacket',
  'checkout_product_hanging_polo', 'checkout_product_hanging_jacket',
  'checkout_product_cap', 'checkout_product_glove', 'checkout_product_tee_pouch',
  'checkout_product_towel_roll', 'checkout_product_marker_blister',
  'checkout_product_rangefinder', 'checkout_product_umbrella',
  'checkout_product_stand_bag', 'checkout_product_shoe_pair', 'checkout_product_shoe_box',
  'checkout_product_sock_pair', 'checkout_product_headcover',
  'checkout_product_visor', 'checkout_product_folded_bottom',
  'checkout_product_divot_tool_card', 'checkout_product_eyewear_case',
  'checkout_product_bottle', 'checkout_product_scorecard',
  'checkout_product_beverage_can', 'checkout_product_snack_pouch',
  'checkout_product_snack_bar',
  // Delivery hero carton (tools/blender/build_delivery_hero.py). The cutter is
  // loaded by the first-person tool rig, avoiding a duplicate GLB allocation.
  'delivery_apparel_box', 'delivery_generic_merchandise_box', 'delivery_golf_club_box',
  'delivery_accessory_carton', 'delivery_golf_ball_case', 'delivery_shoe_carton',
  'delivery_golf_bag_carton', 'delivery_fixture_package', 'delivery_furniture_crate',
  'delivery_bulk_provisions_carton', 'delivery_umbrella_carton', 'delivery_iron_set_carton',
  'delivery_wooden_pallet', 'delivery_van', 'delivery_hand_truck',
  'delivery_stocking_cart', 'delivery_pallet_jack',
  'delivery_packing_tape_roll', 'delivery_recycling_station',
  // Project-owned Blender fixture pack. The layout already referenced these
  // names, but they were never queued by the runtime loader, leaving several
  // furnished-start anchors as signs and colliders with no physical cabinet.
  ...SHOP_FIXTURE_MODELS,
];

// Textured HERO products (Tripo scans, normalized by tools/blender/process_tripo.py).
// Unlike FILES, these keep their baked PBR atlas material. Repeated instances are
// later baked by material, so preserving the authored atlas retains fidelity without
// multiplying texture ownership. Loaded through instantiateRaw(), never slot-swapped.
const RAW = [
  // repeated products — one baked-atlas material each, so a whole shelf of them still
  // bakes (see bake()) into a single draw call, texture intact.
  'shoe_pro', 'cap_pro', 'rangefinder',
  // Exact packed contents and original provisions products retain their authored
  // stylized PBR materials. They are instanced at 1:1 into contract sockets.
  'provisions_fairway_spring_water', 'provisions_bunker_bites_chips',
  'delivery_fixture_product_vacuum', 'delivery_fixture_product_plant',
  'delivery_fixture_product_poster', 'delivery_fixture_product_events_board',
  'delivery_fixture_product_pendant', 'packed_product_rug1', 'packed_product_lounge1',
  // Original Pine Hills supplement. These retain their authored stylized PBR
  // palette and named sockets/pivots for runtime interaction.
  'pine_hills_front_desk_return_v1', 'pine_hills_opening_drinks_cooler_v1',
  'pine_hills_golf_tv_v1', 'pine_hills_water_cooler_v1',
  'pine_hills_public_waste_bin_v1', 'pine_hills_public_waste_bin_overflow_v1',
  'pine_hills_front_desk_clutter_v1', 'pine_hills_lounge_litter_v1',
  'pine_hills_fallen_frame_v1', 'pine_hills_floor_plant_v1',
  'pine_hills_counter_plant_v1',
  // HERO APPAREL (Assets/models/hero/v5, staged by the vendor manifest).
  //
  // RAW and not FILES, because the bake IS the garment. Each of these carries a
  // normal + occlusion + metallicRoughness set with KHR_texture_transform
  // tiling (the polo's pique lattice is scale 13), COLOR_0 on every primitive,
  // and KHR_materials_sheen for the fabric's light. instantiate() would replace
  // every one of those materials with a palette slot — and since none of these
  // material names are in SLOT or TINTABLE, they would all resolve to charcoal.
  // The whole v7 bake would be thrown away at load.
  //
  // Verified before wiring: all eleven report images>0 and COLOR_0 on every
  // primitive. The four v5 HARDGOODS (counter, driver, iron, putter) report
  // img 0 / COLOR_0 0 — they never went through the bake — and are deliberately
  // NOT here. See Designs/ProShop/GOAL_37_ASSET_MERGE.md.
  'hero_polo_hung', 'hero_polo_folded',
  'hero_tee_hung', 'hero_tee_folded',
  'hero_hoodie_hung', 'hero_hoodie_folded',
  'hero_trousers_hung', 'hero_trousers_folded',
  'hero_cap', 'hero_cap_peg',
  'hero_towel',
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
  M_displayglass: 'displayGlass',
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
  M_Label: 'trimPaint',
};

// These small authored materials carry meaningful emissive feedback. Keeping the
// imported material preserves that signal without adding a per-instance material.
const PRESERVE = new Set([
  'M_Screen', 'M_ScannerBeam', 'M_StatusLED',
  // Delivery cartons need their authored translucent kraft tape and dark
  // corrugated interior. Mapping these to generic white/charcoal destroys the
  // material read and makes the hero carton look like a flat legacy prop.
  'M_tape', 'M_KraftDark',
  'M_BoxTape', 'M_BoxKraftInterior', 'M_PackingFoam',
]);

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
  // GLTF clones deliberately share their prototype resources. Keep ownership at
  // this loader boundary so tearing down a clubhouse can release each imported
  // resource exactly once without ever touching the caller-owned material kit.
  const prototypeGeometries = new Set();
  const prototypeMaterials = new Set();
  const prototypeTextures = new Set();
  const bakedGeometries = new Set();
  const sharedTexturePool = createSharedTexturePool();
  let ready = false;
  let disposed = false;
  let disposalSummary = null;
  const waiting = [];

  function resourcesIn(root) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    if (!root || typeof root.traverse !== 'function') return { geometries, materials, textures };
    root.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    });
    return { geometries, materials, textures };
  }

  function rememberPrototype(root) {
    const resources = resourcesIn(root);
    resources.geometries.forEach((resource) => prototypeGeometries.add(resource));
    resources.materials.forEach((resource) => prototypeMaterials.add(resource));
    resources.textures.forEach((resource) => prototypeTextures.add(resource));
  }

  function disposeRootResources(root) {
    const resources = resourcesIn(root);
    const closedImages = new Set();
    resources.textures.forEach((resource) => {
      closeTextureImages(resource, closedImages);
      resource.dispose();
    });
    resources.materials.forEach((resource) => resource.dispose());
    resources.geometries.forEach((resource) => resource.dispose());
    return {
      geometries: resources.geometries.size,
      materials: resources.materials.size,
      textures: resources.textures.size,
    };
  }

  function rememberBakedGeometry(geometry) {
    if (!geometry || bakedGeometries.has(geometry)) return geometry;
    bakedGeometries.add(geometry);
    // Existing stock rebuilds already dispose their owned baked geometry. Drop
    // that externally released resource from this registry immediately so the
    // loader neither retains it nor attempts a second release at teardown.
    const forget = () => {
      bakedGeometries.delete(geometry);
      geometry.removeEventListener('dispose', forget);
    };
    geometry.addEventListener('dispose', forget);
    return geometry;
  }

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
    if (disposed) return null;
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
      if (o.userData?.collision_proxy || o.name.startsWith('COL_') || o.name.startsWith('COLLISION_')
        || o.name.startsWith('VOLUME_') || o.name === 'ScannerBeam') {
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
    if (disposed) return null;
    const proto = protos.get(name);
    if (!proto) return null;
    const obj = proto.clone(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      if (o.userData?.collision_proxy || o.name.startsWith('COL_')
        || o.name.startsWith('COLLISION_') || o.name.startsWith('VOLUME_')) {
        o.visible = false;
      }
    });
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
  function bake(group, { visibleOnly = false } = {}) {
    if (!group || disposed) return group || null;
    const buckets = new Map();
    const keep = [];
    group.updateMatrixWorld(true);
    const visit = visibleOnly
      ? (visitor) => group.traverseVisible(visitor)
      : (visitor) => group.traverse(visitor);
    visit((o) => {
      if (!o.isMesh) return;
      // Visibility is the primary contract. The metadata checks are defensive:
      // a malformed export must not turn an authoring helper or collision volume
      // into visible geometry merely because its visibility flag was left on.
      if (visibleOnly && (
        o.userData?.helper
        || o.userData?.collision_proxy
        || /^(?:COL_|COLLISION_|VOLUME_)/i.test(String(o.name || ''))
      )) return;
      if (Array.isArray(o.material) || !o.geometry) { keep.push(o); return; }
      const m = o.material;
      const g = o.geometry.clone();
      g.userData.merchBakeOwned = true;
      g.applyMatrix4(o.matrixWorld);
      // merging needs identical attribute sets; drop anything exotic
      //
      // `color` IS NOT EXOTIC — it is the v7 bake. The hero garments carry
      // COLOR_0 on every primitive and their materials come out of the loader
      // with vertexColors = true. Deleting the attribute here left the material
      // asking for a colour stream that no longer existed, which is not "the
      // authored colour" and not "no colour" but undefined. Measured on the
      // towel: material.vertexColors true, geometry.color absent
      // (qa/goal37/wired.json, before this line changed).
      for (const attr of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv', 'color'].includes(attr)) g.deleteAttribute(attr);
      }
      if (!g.attributes.uv) {
        const n = g.attributes.position.count;
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      }
      if (!buckets.has(m)) buckets.set(m, []);
      buckets.get(m).push(g);
    });
    if (!buckets.size) return group;

    // A bucket is keyed by MATERIAL, so its members agree about whether they
    // carry colour — but a mismatched set would make mergeGeometries throw and
    // drop the whole display to loose meshes. Fill the gaps with white, which
    // multiplies to a no-op, exactly as the uv fallback above does.
    for (const geos of buckets.values()) {
      const withColor = geos.find((g) => g.attributes.color);
      if (!withColor || geos.every((g) => g.attributes.color)) continue;
      const size = withColor.attributes.color.itemSize;
      for (const g of geos) {
        if (g.attributes.color) continue;
        const n = g.attributes.position.count;
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * size).fill(1), size));
      }
    }

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
        for (const g of geos) rememberBakedGeometry(g);
        continue;
      }
      // mergeGeometries creates a new BufferGeometry. Its cloned inputs are no
      // longer reachable and must be explicitly released instead of waiting for
      // a later renderer teardown. A one-geometry bucket already is its output.
      for (const g of geos) if (g !== merged) g.dispose();
      rememberBakedGeometry(merged);
      const mesh = new THREE.Mesh(merged, m);
      mesh.geometry.userData.sharedGeometry = false;
      mesh.userData.disposeGeometry = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.add(mesh);
    }
    for (const k of keep) out.add(k);
    out.userData.merchBaked = true;
    out.userData.merchBakeVisibleOnly = visibleOnly;
    return out;
  }

  // Dispose only geometry minted by bake(). Shared prototype geometry and the
  // caller's material kit are deliberately outside this method's ownership.
  // If several clones share one baked geometry, pass a common ancestor after
  // removing every clone; the Set makes duplicate references and repeat calls
  // safe.
  function disposeBaked(root) {
    if (!root || typeof root.traverse !== 'function') return 0;
    const found = new Set();
    root.traverse((object) => {
      if (object.geometry && bakedGeometries.has(object.geometry)) found.add(object.geometry);
    });
    for (const geometry of found) {
      geometry.dispose();
      bakedGeometries.delete(geometry);
    }
    return found.size;
  }

  // THE CHECKOUT KIT (assets/checkout/glb, staged to vendor/models/checkout).
  // These are the finished hero assets for the TCG-style register: baked
  // materials are kept as authored (no slot remap), collision proxies hidden.
  const KIT = [
    'checkout_counter', 'pos_monitor', 'cash_drawer', 'payment_terminal',
    'barcode_scanner',
    'receipt_printer', 'shopping_bag', 'payment_card', 'customer_display',
    'loose_receipt', 'apparel_wall',
    'cash_bill_1', 'cash_bill_5', 'cash_bill_10', 'cash_bill_20', 'cash_bill_50',
    // cash_coin_20 stays loaded for save-migration visuals; cash_coin_25 is the
    // live quarter the drawer's fourth well now carries (see COINS).
    'cash_coin_01', 'cash_coin_05', 'cash_coin_05_sheet01', 'cash_coin_10',
    'cash_coin_20', 'cash_coin_25', 'cash_coin_50',
    // Asset Sheet 03: the retail fixture family
    'apparel_wall_display', 'hat_wall', 'accessory_slatwall', 'club_rack',
    'putter_rack', 'bag_display', 'shoe_wall', 'ball_shelf', 'snack_shelf',
    'rangefinder_display',
    // Asset Sheet 04: the furniture family
    'merch_table', 'retail_gondola', 'apparel_table', 'stock_shelving',
    'storage_tote_olive', 'storage_tote_slate', 'storage_tote_charcoal',
    'storage_tote_stone', 'lounge_armchair', 'lounge_coffee_table',
    'lounge_side_table', 'office_desk', 'office_chair', 'filing_cabinet',
  ];

  function instantiateKit(name, { scale = 1 } = {}) {
    if (disposed) return null;
    const proto = protos.get(`kit:${name}`);
    if (!proto) return null;
    const obj = proto.clone(true);
    obj.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
      if (o.name.startsWith('COL_')) o.visible = false;
    });
    if (scale !== 1) obj.scale.setScalar(scale);
    return obj;
  }

  const sharedImageSourceCache = new Map();
  const loader = new GLTFLoader();
  if (typeof loader.setSharedImageCache === 'function') {
    loader.setSharedImageCache(
      sharedImageSourceCache,
      (source) => CLUBHOUSE_SHARED_TEXTURE_FAMILIES[source?.name] || null,
    );
  }
  let pending = FILES.length + RAW.length + KIT.length;
  const done = () => {
    if (disposed) return;
    if (--pending > 0) return;
    // Materials/prototypes now own the canonical Textures. The decode-promise
    // cache has served its startup purpose and must not become a second owner.
    sharedImageSourceCache.clear();
    ready = true;
    for (const fn of waiting) fn();
    waiting.length = 0;
  };
  for (const name of FILES) {
    loader.load(
      `vendor/models/clubhouse/${name}.glb`,
      (g) => {
        const root = g.scene;
        if (disposed) {
          disposeRootResources(root);
          return;
        }
        root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        sharedTexturePool.intern(root);
        rememberPrototype(root);
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
        if (disposed) {
          disposeRootResources(root);
          return;
        }
        root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
        sharedTexturePool.intern(root);
        rememberPrototype(root);
        protos.set(name, root);
        // Raw project-owned props can still carry authored interaction clips
        // (the Pine Hills cooler door is the first one).  "Raw" means preserve
        // its PBR materials, not discard its animation payload.
        clips.set(name, g.animations || []);
        done();
      },
      undefined,
      () => done(),
    );
  }
  for (const name of KIT) {
    loader.load(
      `vendor/models/checkout/${name}.glb`,
      (g) => {
        const root = g.scene;
        if (disposed) {
          disposeRootResources(root);
          return;
        }
        root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
        sharedTexturePool.intern(root);
        rememberPrototype(root);
        protos.set(`kit:${name}`, root);
        clips.set(`kit:${name}`, g.animations || []);
        done();
      },
      undefined,
      () => done(),
    );
  }

  function dispose() {
    if (disposed) return { ...disposalSummary, alreadyDisposed: true };
    disposed = true;
    ready = false;
    waiting.length = 0;

    const summary = {
      bakedGeometries: bakedGeometries.size,
      tintMaterials: tints.size,
      prototypeTextures: prototypeTextures.size,
      prototypeMaterials: prototypeMaterials.size,
      prototypeGeometries: prototypeGeometries.size,
    };
    const closedImages = new Set();
    bakedGeometries.forEach((resource) => resource.dispose());
    tints.forEach((resource) => resource.dispose());
    prototypeTextures.forEach((resource) => {
      closeTextureImages(resource, closedImages);
      resource.dispose();
    });
    prototypeMaterials.forEach((resource) => resource.dispose());
    prototypeGeometries.forEach((resource) => resource.dispose());

    bakedGeometries.clear();
    tints.clear();
    prototypeTextures.clear();
    prototypeMaterials.clear();
    prototypeGeometries.clear();
    sharedTexturePool.clear();
    sharedImageSourceCache.clear();
    protos.clear();
    clips.clear();
    disposalSummary = Object.freeze(summary);
    return { ...disposalSummary, alreadyDisposed: false };
  }

  // The clubhouse teardown walks its procedural Object3D roots, some of which
  // contain clones backed by this loader's prototypes. Expose identity-only
  // snapshots so the outer owner can exclude those resources and leave their
  // single release to dispose(). Caller-owned material-kit textures are not
  // included merely because a tint clone references them.
  function ownedResources() {
    return {
      geometries: new Set([...prototypeGeometries, ...bakedGeometries]),
      materials: new Set([...prototypeMaterials, ...tints.values()]),
      textures: new Set(prototypeTextures),
    };
  }

  return {
    instantiate,
    instantiateRaw,
    instantiateKit,
    slotMesh,
    bake,
    disposeBaked,
    ownedResources,
    sharedTextureStats: () => sharedTexturePool.stats(),
    dispose,
    isReady: () => ready && !disposed,
    has: (n) => !disposed && protos.has(n),
    hasKit: (n) => !disposed && protos.has(`kit:${n}`),
    animations: (n) => (disposed ? [] : clips.get(n) || []),
    // the models arrive after the shop is built; the caller restocks on ready
    onReady(fn) {
      if (disposed) return;
      if (ready) fn(); else waiting.push(fn);
    },
  };
}
