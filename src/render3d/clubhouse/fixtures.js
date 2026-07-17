// CLUBHOUSE RETAIL FIXTURES — the millwork: club-wall bays, retail wall units,
// nesting tables, apparel rail, hat tree, bag platforms, the lit shoe wall,
// the feature pedestal, the checkout island + back-counter, the furnished
// lounge, and the stockroom's working dressing. Walnut carcasses, beveled
// edges, brass pulls, cream category signs, warm under-shelf light strips —
// the reference language (Designs/RefrenceImages 1, 4-9).
//
// CONTRACT: merch placement (clubhouse.js rebuildStock) lands items on these
// exact surfaces — shelf boards y [0.5, 1.05, 1.6], rack base y≈0.14 with the
// back at z −0.4, table top ≈1.0 with the rail at (z −0.62, y 1.68), shoe
// boards y [0.35, 0.85, 1.35], feature top y 0.94, backshelf boards
// y [0.4, 1.05, 1.7]. Change those here and the stock floats or sinks.

import * as THREE from 'three';
import {
  FIXTURES, COUNTER, LOUNGE, STOCKROOM, INTERIOR, LOGO_RUG, REGISTER, COUNTER_TOP,
} from '../../data/shopLayout.js';
import { restockShelfFromBackroom } from '../../sim/shop.js';
import { skuById } from '../../data/shopItems.js';
import { placedFixtures } from '../../sim/layout.js';
import { tutorialFlag } from '../../sim/tutorial.js';
import { roundedBox, makeSignTexture, makeRugTexture } from './materials.js';

// warm under-shelf light strip (pure emissive — the real lights are the rig's)
function lightStrip(mats, w) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.018, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xfff3d9, emissive: 0xffe2b0, emissiveIntensity: 1.6 }),
  );
}

function categorySign(title, { w = 1.5, h = 0.26, charcoal = false } = {}) {
  const tex = makeSignTexture([title.toUpperCase()], {
    w: 512, h: 128, frame: false,
    field: charcoal ? '#23262b' : '#f4f0e6',
    ink: charcoal ? '#c9a227' : '#1f4a26',
    sizes: [54],
  });
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }),
  );
}

export function buildFixtures(B) {
  const {
    interior, mats, merch, addCol: rawAddCol, addProp: rawAddProp, removeCol, removeProp,
    colBoxAt, L2W, state, hooks,
  } = B;

  // Only what the fixture loop lays down is re-layable; the counter, the rug and the lounge are
  // architecture, not furniture the player pushes around.
  let tracking = false;
  const laidCols = [];
  const laidProps = [];
  const addCol = (c) => {
    if (tracking) laidCols.push(c);
    return rawAddCol(c);
  };
  const addProp = (p) => {
    const made = rawAddProp(p);
    if (tracking) laidProps.push(made || p);
    return made;
  };
  const fixtureAnchors = new Map();

  function shelfLabel(f) {
    const inv = state.shop.inventory;
    const shelf = f.skus.reduce((a, id) => a + inv[id].shelf, 0);
    const back = f.skus.reduce((a, id) => a + inv[id].back, 0);

    // if you are holding product, this fixture is either where it goes or somewhere it does not —
    // and it says which. This is the physical stocking path (hold [E] to place, tap for one).
    const held = B.carriedGoods && B.carriedGoods();
    if (held) {
      const heldSku = skuById(held.skuId);
      if (f.skus.includes(held.skuId)) {
        return `${f.title} — hold [E] to stock the ${heldSku.name.toLowerCase()} (${held.qty} in hand)`;
      }
      return null;   // wrong fixture: let the player carry on to the right one without a false prompt
    }

    if (back > 0) return `${f.title} — ${shelf} out · ${back} in the back — [E] restock`;
    return `${f.title} — ${shelf} out · backroom empty (order at the office)`;
  }

  // stock this fixture from what is in the player's hands: tap = one, hold = a flow
  function stockHere(f, units) {
    const res = B.stockFromHands(f.id, units);
    if (!res.ok) {
      if (res.invalid && hooks.toast) hooks.toast(res.reason, 'warn');
      return;
    }
    if (hooks.sfx) hooks.sfx(res.full ? 'fullShelf' : 'stock');
    if (res.full && hooks.toast) hooks.toast(`The ${f.title.toLowerCase()} is full.`);
  }

  // the old convenience path: pull already-unpacked stock from the backroom straight to the shelf.
  // Kept for empty hands — it is the "faster stocking" the brief allows once the goods are unboxed.
  function restockAll(f) {
    let moved = 0;
    for (const id of f.skus) {
      const res = restockShelfFromBackroom(state, id);
      if (res.ok) moved += res.moved;
    }
    if (moved > 0) {
      B.rebuildStock();
      if (state.tutorial) tutorialFlag(state, 'shelved');
      if (hooks.toast) hooks.toast(`Restocked ${moved} items on the ${f.title.toLowerCase()}.`);
      if (hooks.sfx) hooks.sfx('stock');
    } else if (hooks.toast) {
      hooks.toast('Nothing in the back for this display.', 'warn');
    }
  }

  function fixtureProp(f) {
    if (!f.skus.length) return;
    const wp = L2W(f.x, f.z);
    addProp({
      x: wp.x, z: wp.z, r: 2.3,
      label: () => shelfLabel(f),
      action: () => {
        const held = B.carriedGoods && B.carriedGoods();
        if (held) { if (f.skus.includes(held.skuId)) stockHere(f, 1); }   // tap: one at a time
        else restockAll(f);
      },
      // hold: stock a flow from the hands. Only when holding something this fixture accepts.
      hold: (dt) => {
        const held = B.carriedGoods && B.carriedGoods();
        if (held && f.skus.includes(held.skuId)) {
          stockRate += dt * 8;                 // eight a second while you hold
          const n = Math.floor(stockRate);
          if (n >= 1) { stockRate -= n; stockHere(f, n); }
        }
      },
    });
  }
  let stockRate = 0;

  // ------------------------------------------------------------ wall unit ---
  // Sheet-03 modules replace the millwork the moment the kit loads: the ball
  // wall gets three ball_shelf modules (one per line), the accessory runs get
  // three accessory_slatwall modules each. The legacy carcass stands in
  // until then so the wall is never bare.
  function shelfUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    // carcass: sides, plinth, crown, back panel
    for (const sx of [-1.5, 1.5]) {
      const side = new THREE.Mesh(roundedBox(0.08, 2.3, 0.56, 0.02), mats.walnut);
      side.position.set(sx, 1.15, -0.02);
      side.castShadow = true;
      legacy.add(side);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.25, 0.05), mats.walnutDark);
    back.position.set(0, 1.15, -0.24);
    back.receiveShadow = true;
    legacy.add(back);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.06, 0.16, 0.6), mats.walnutDark);
    plinth.position.set(0, 0.08, -0.01);
    legacy.add(plinth);
    const crown = new THREE.Mesh(roundedBox(3.22, 0.14, 0.66, 0.03), mats.walnut);
    crown.position.set(0, 2.34, -0.01);
    crown.castShadow = true;
    legacy.add(crown);
    for (const y of [0.5, 1.05, 1.6]) {
      const board = new THREE.Mesh(roundedBox(2.94, 0.05, 0.48, 0.015), mats.walnut);
      board.position.set(0, y, 0.02);
      board.castShadow = true;
      board.receiveShadow = true;
      legacy.add(board);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.94, 0.022, 0.012), mats.brass);
      edge.position.set(0, y + 0.012, 0.265);
      legacy.add(edge);
      const strip = lightStrip(mats, 2.8);
      strip.position.set(0, y - 0.032, 0.2);
      legacy.add(strip);
    }
    const legacySign = categorySign(f.title);
    legacySign.position.set(0, 2.05, 0.255);
    legacy.add(legacySign);
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const kitName = f.id === 'shelf_balls' ? 'ball_shelf' : 'accessory_slatwall';
      const modules = [-1.0, 0.0, 1.0].map((mx) => {
        const m = merch.instantiateKit && merch.instantiateKit(kitName);
        if (m) m.position.x = mx;
        return m;
      });
      if (modules.some((m) => !m)) return;
      for (const m of modules) g.add(m);
      // the aisle sign rides above the modules (the ball merchandiser is low)
      const sign = categorySign(f.title);
      sign.position.set(0, f.id === 'shelf_balls' ? 1.48 : 2.06, 0.17);
      g.add(sign);
      g.remove(legacy);
    });
    const w = Math.abs(f.ry % Math.PI) < 0.1 ? 3.0 : 0.5;
    const d = Math.abs(f.ry % Math.PI) < 0.1 ? 0.5 : 3.0;
    addCol(colBoxAt(f.x, f.z, w + 0.2, d + 0.2));
    return g;
  }

  // ----------------------------------------------------------- club bay -----
  // Sheet-03 floor racks: two club_rack modules for the driver and iron runs,
  // two putter_rack groove modules for the putter studio. The old wall bay
  // stands in until the kit arrives.
  function rackUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    // tall framed back
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.35, 0.06), mats.walnutDark);
    back.position.set(0, 1.2, -0.42);
    back.receiveShadow = true;
    legacy.add(back);
    for (const sx of [-1.44, 1.44]) {
      const stile = new THREE.Mesh(roundedBox(0.1, 2.42, 0.16, 0.02), mats.walnut);
      stile.position.set(sx, 1.21, -0.38);
      stile.castShadow = true;
      legacy.add(stile);
    }
    const header = new THREE.Mesh(roundedBox(2.98, 0.34, 0.2, 0.02), mats.walnut);
    header.position.set(0, 2.28, -0.36);
    header.castShadow = true;
    legacy.add(header);
    const legacySign = categorySign(f.title, { w: 1.9, h: 0.3, charcoal: true });
    legacySign.position.set(0, 2.28, -0.25);
    legacy.add(legacySign);
    const strip = lightStrip(mats, 2.7);
    strip.position.set(0, 2.08, -0.3);
    legacy.add(strip);
    // base cabinet: the stand the clubs lean from, drawer fronts + brass pulls
    const base = new THREE.Mesh(roundedBox(2.88, 0.15, 0.9, 0.02), mats.walnut);
    base.position.set(0, 0.075, -0.05);
    base.castShadow = true;
    legacy.add(base);
    for (let i = 0; i < 3; i++) {
      const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.09, 0.03), mats.walnutDark);
      drawer.position.set(-0.94 + i * 0.94, 0.075, 0.41);
      legacy.add(drawer);
      const pull = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), mats.brass);
      pull.position.set(-0.94 + i * 0.94, 0.075, 0.435);
      legacy.add(pull);
    }
    // shaft cradle rails with brass clips
    for (const y of [0.62, 1.32]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.05, 0.05), mats.walnut);
      rail.position.set(0, y, -0.3);
      legacy.add(rail);
      for (let i = 0; i < 8; i++) {
        const clip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.04), mats.brass);
        clip.position.set(-1.22 + i * 0.35, y, -0.27);
        legacy.add(clip);
      }
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const putters = f.id === 'rack_putters';
      const spots = putters ? [-0.53, 0.53] : [-0.6, 0.6];
      const modules = spots.map((mx) => {
        const m = merch.instantiateKit && merch.instantiateKit(putters ? 'putter_rack' : 'club_rack');
        if (m) m.position.x = mx;
        return m;
      });
      if (modules.some((m) => !m)) return;
      for (const m of modules) g.add(m);
      // the category sign moves to the wall the rack stands against
      const sign = categorySign(f.title, { w: 1.9, h: 0.3, charcoal: true });
      sign.position.set(0, 1.78, -0.40);
      g.add(sign);
      g.remove(legacy);
    });
    addCol(colBoxAt(f.x, f.z, Math.abs(Math.sin(f.ry)) > 0.5 ? 1.0 : 3.0, Math.abs(Math.sin(f.ry)) > 0.5 ? 3.0 : 1.0));
    return g;
  }

  // ------------------------------------------------------- apparel table ----
  // The Sheet-04 folded-apparel table (1.60 x 0.90 walnut top on a steel
  // frame) replaces the old nesting tables + rear hang rail. Both polo lanes
  // fold onto the SAME top — twelve stack poses per lane, see
  // fixtureSlots.js tableApparel. The old millwork stands in until the kit
  // loads.
  function tableUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const top = new THREE.Mesh(roundedBox(2.2, 0.09, 1.4, 0.025), mats.walnut);
    top.position.y = 0.96;
    top.castShadow = true;
    top.receiveShadow = true;
    legacy.add(top);
    const apron = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.09, 1.2), mats.walnutDark);
    apron.position.y = 0.88;
    legacy.add(apron);
    for (const [lx, lz] of [[-0.95, -0.55], [0.95, -0.55], [-0.95, 0.55], [0.95, 0.55]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.92, 8), mats.walnut);
      leg.position.set(lx, 0.46, lz);
      leg.castShadow = true;
      legacy.add(leg);
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const m = merch.instantiateKit && merch.instantiateKit('apparel_table');
      if (!m) return;
      g.add(m);
      g.remove(legacy);
    });
    addCol(colBoxAt(f.x, f.z, 1.9, 1.2));
    return g;
  }

  // -------------------------------------------------- apparel wall fixture ----
  // The Sheet-02 modular apparel wall (assets/checkout/apparel_wall): two
  // 1.10 m kit modules side by side fill the rail's 2.2 yd footprint. The rod
  // sits at the same y 1.68 the old freestanding rail put its bar, so the
  // hanger slots in fixtureSlots.js stay on the metal. Until the kit loads,
  // the old millwork rail stands in.
  function railUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    for (const rx of [-1.0, 1.0]) {
      const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.66, 10), mats.iron);
      upright.position.set(rx, 0.85, 0);
      upright.castShadow = true;
      legacy.add(upright);
      const foot = new THREE.Mesh(roundedBox(0.16, 0.05, 0.7, 0.02), mats.walnut);
      foot.position.set(rx, 0.025, 0);
      legacy.add(foot);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.1, 10), mats.brass);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 1.68, 0);
    legacy.add(bar);
    const signBacker = new THREE.Mesh(roundedBox(0.98, 0.26, 0.03, 0.012), mats.walnut);
    signBacker.position.set(0, 1.92, 0);
    legacy.add(signBacker);
    const signBoard = categorySign(f.title, { w: 0.9, h: 0.2 });
    signBoard.position.set(0, 1.92, 0.017);
    legacy.add(signBoard);
    const signBoardB = categorySign(f.title, { w: 0.9, h: 0.2 });
    signBoardB.position.set(0, 1.92, -0.017);
    signBoardB.rotation.y = Math.PI;
    legacy.add(signBoardB);
    for (const dx of [-0.4, 0.4]) {
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), mats.brass);
      drop.position.set(dx, 1.75, 0);
      legacy.add(drop);
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const modules = [-0.55, 0.55].map((mx) => {
        const m = merch.instantiateKit && merch.instantiateKit('apparel_wall');
        if (m) m.position.x = mx;
        return m;
      });
      if (modules.some((m) => !m)) return;
      for (const m of modules) g.add(m);
      g.remove(legacy);
    });
    addCol(colBoxAt(f.x, f.z, Math.abs(Math.sin(f.ry)) > 0.5 ? 0.9 : 2.2, Math.abs(Math.sin(f.ry)) > 0.5 ? 2.2 : 0.9));
    return g;
  }

  // ----------------------------------------------------------- hat wall -----
  // The Sheet-03 hat wall replaces the old hat tree on the same footprint:
  // a freestanding slat panel with twelve brass pegs, finished on the back
  // (it stands mid-floor in the apparel zone). The tree remains the stand-in.
  function hatstandUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.75, 10), mats.walnut);
    pole.position.y = 0.87;
    pole.castShadow = true;
    legacy.add(pole);
    for (const [py, r] of [[0.42, 0.09], [1.72, 0.07]]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, 0.05, 10), mats.walnutDark);
      collar.position.y = py;
      legacy.add(collar);
    }
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.07, 12), mats.walnutDark);
    foot.position.y = 0.035;
    legacy.add(foot);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.28, 6), mats.brass);
      peg.rotation.z = Math.PI / 2;
      peg.rotation.y = a;
      const py = 1.15 + (i % 2) * 0.35;
      peg.position.set(Math.sin(a) * 0.15, py, Math.cos(a) * 0.15);
      legacy.add(peg);
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const m = merch.instantiateKit && merch.instantiateKit('hat_wall');
      if (!m) return;
      g.add(m);
      g.remove(legacy);
    });
    addCol(colBoxAt(f.x, f.z, 0.8, 0.8));
    return g;
  }

  // -------------------------------------------------------- bag platform ----
  // The Sheet-03 bag display: a walnut deck on a steel frame with a rear lean
  // rail, bags standing four across. The old two-tier platform stands in.
  function bagstandUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const lowTier = new THREE.Mesh(roundedBox(2.5, 0.12, 1.15, 0.025), mats.walnut);
    lowTier.position.set(0, 0.06, 0.05);
    lowTier.castShadow = true;
    lowTier.receiveShadow = true;
    legacy.add(lowTier);
    const highTier = new THREE.Mesh(roundedBox(2.5, 0.3, 0.5, 0.025), mats.walnut);
    highTier.position.set(0, 0.15, -0.45);
    highTier.castShadow = true;
    legacy.add(highTier);
    const backRail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 8), mats.brass);
    backRail.rotation.z = Math.PI / 2;
    backRail.position.set(0, 1.02, -0.45);
    legacy.add(backRail);
    for (const px of [-1.15, 1.15]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 1.0, 8), mats.iron);
      post.position.set(px, 0.5, -0.45);
      legacy.add(post);
    }
    const legacySign = categorySign(f.title, { w: 1.0, h: 0.2 });
    legacySign.position.set(0, 1.16, -0.45);
    legacy.add(legacySign);
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const m = merch.instantiateKit && merch.instantiateKit('bag_display');
      if (!m) return;
      g.add(m);
      const sign = categorySign(f.title, { w: 1.0, h: 0.2 });
      sign.position.set(0, 1.18, -0.245);
      g.add(sign);
      g.remove(legacy);
    });
    addCol(colBoxAt(f.x, f.z, 2.6, 1.3));
    return g;
  }

  // ------------------------------------------------------- lit shoe wall ----
  // Two Sheet-03 shoe_wall modules (angled boards, box shelf, crest header)
  // replace the lit millwork; the fitting bench and mirror stay.
  function shoerackUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.1, 0.05), mats.walnutDark);
    back.position.set(0, 1.05, -0.22);
    back.receiveShadow = true;
    legacy.add(back);
    for (const sx of [-1.34, 1.34]) {
      const side = new THREE.Mesh(roundedBox(0.07, 2.1, 0.5, 0.02), mats.walnut);
      side.position.set(sx, 1.05, -0.02);
      side.castShadow = true;
      legacy.add(side);
    }
    const crown = new THREE.Mesh(roundedBox(2.86, 0.12, 0.56, 0.025), mats.walnut);
    crown.position.set(0, 2.14, -0.02);
    legacy.add(crown);
    const legacySign = categorySign(f.title);
    legacySign.position.set(0, 1.88, 0.2);
    legacy.add(legacySign);
    // angled shoe boards (merch contract y) with lips + light strips
    for (const y of [0.35, 0.85, 1.35]) {
      const board = new THREE.Mesh(roundedBox(2.6, 0.04, 0.44, 0.012), mats.walnut);
      board.position.set(0, y, 0.02);
      board.rotation.x = -0.18;
      board.receiveShadow = true;
      legacy.add(board);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.03, 0.015), mats.brass);
      lip.position.set(0, y - 0.035, 0.22);
      legacy.add(lip);
      const strip = lightStrip(mats, 2.45);
      strip.position.set(0, y - 0.055, 0.14);
      legacy.add(strip);
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const modules = [-0.6, 0.6].map((mx) => {
        const m = merch.instantiateKit && merch.instantiateKit('shoe_wall');
        if (m) m.position.x = mx;
        return m;
      });
      if (modules.some((m) => !m)) return;
      for (const m of modules) g.add(m);
      const sign = categorySign(f.title);
      sign.position.set(0, 2.06, 0.16);
      g.add(sign);
      g.remove(legacy);
    });
    const swap = Math.abs(Math.sin(f.ry)) > 0.5;
    addCol(colBoxAt(f.x, f.z, swap ? 0.7 : 2.9, swap ? 2.9 : 0.7));
    // fitting bench + mirror beside the rack
    const benchG = new THREE.Group();
    const cushion = new THREE.Mesh(roundedBox(1.1, 0.14, 0.42, 0.05), mats.sageFabric);
    cushion.position.y = 0.38;
    const benchBody = new THREE.Mesh(roundedBox(1.1, 0.3, 0.42, 0.02), mats.walnut);
    benchBody.position.y = 0.16;
    benchBody.castShadow = true;
    benchG.add(benchBody, cushion);
    const bwp = { x: f.x - (swap ? 1.2 : 0), z: f.z + (swap ? 2.1 : 1.2) };
    benchG.position.set(bwp.x - f.x, 0, bwp.z - f.z);
    g.add(benchG);
    addCol(colBoxAt(bwp.x, bwp.z, 1.2, 0.5));
    const mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 1.55),
      new THREE.MeshStandardMaterial({ color: 0xdfe9ee, roughness: 0.05, metalness: 0.9 }),
    );
    mirror.position.set(0, 1.15, -0.19);
    const mirrorFrame = new THREE.Mesh(roundedBox(0.68, 1.7, 0.05, 0.02), mats.walnut);
    mirrorFrame.position.set(0, 1.15, -0.22);
    const mirrorHolder = new THREE.Group();
    mirrorHolder.add(mirrorFrame, mirror);
    mirrorHolder.position.set(bwp.x - f.x - (swap ? 0 : 1.5), 0, bwp.z - f.z + (swap ? 1.4 : 0.0));
    // lean the mirror against whatever wall the bench faces
    g.add(mirrorHolder);
    return g;
  }

  // ------------------------------------------------------ feature table -----
  // The Sheet-04 centre merchandise table (1.40 x 0.80, two-tier walnut on
  // steel) replaces the round pedestal as the feature spot. The featured
  // stock is dressed onto its top grid by rebuildStock (top 0.75, lower
  // shelf 0.29). The pedestal stands in until the kit loads.
  function featureUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.08, 24), mats.walnut);
    top.position.y = 0.9;
    top.castShadow = true;
    top.receiveShadow = true;
    legacy.add(top);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.885, 0.885, 0.03, 24), mats.brass);
    band.position.y = 0.87;
    legacy.add(band);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.86, 12), mats.walnutDark);
    column.position.y = 0.44;
    legacy.add(column);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.06, 20), mats.walnutDark);
    foot.position.y = 0.03;
    legacy.add(foot);
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const m = merch.instantiateKit && merch.instantiateKit('merch_table');
      if (!m) return;
      g.add(m);
      g.remove(legacy);
      if (B.rebuildStock) B.rebuildStock();   // re-dress the feature onto the table grid
    });
    addCol(colBoxAt(f.x, f.z, 1.7, 1.1));
    return g;
  }

  // ------------------------------------------------------- back counter -----
  function backcounterUnit(f) {
    const g = new THREE.Group();
    // lower cabinets with doors + brass pulls
    const cab = new THREE.Mesh(roundedBox(3.2, 0.95, 0.5, 0.02), mats.walnut);
    cab.position.set(0, 0.48, 0);
    cab.castShadow = true;
    g.add(cab);
    const cabTop = new THREE.Mesh(roundedBox(3.3, 0.06, 0.56, 0.02), mats.walnutDark);
    cabTop.position.set(0, 0.98, 0);
    g.add(cabTop);
    for (let i = 0; i < 4; i++) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.02), mats.walnutDark);
      door.position.set(-1.2 + i * 0.8, 0.46, 0.26);
      g.add(door);
      const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), mats.brass);
      pull.position.set(-1.2 + i * 0.8 + 0.26, 0.52, 0.27);
      g.add(pull);
    }
    // hutch shelves above for branded bags + boxes
    for (const y of [1.5, 1.95]) {
      const board = new THREE.Mesh(roundedBox(3.0, 0.045, 0.32, 0.015), mats.walnut);
      board.position.set(0, y, -0.08);
      g.add(board);
      const strip = lightStrip(mats, 2.85);
      strip.position.set(0, y - 0.03, -0.02);
      g.add(strip);
    }
    for (const sx of [-1.55, 1.55]) {
      const cheek = new THREE.Mesh(roundedBox(0.07, 1.35, 0.36, 0.02), mats.walnut);
      cheek.position.set(sx, 1.6, -0.08);
      g.add(cheek);
    }
    // The hutch was two lit boards with NOTHING on them — the back counter is
    // where a pro shop keeps its branded bags and boxed stock (ref 4).
    if (merch) merch.onReady(() => {
      // the Sheet-03 rangefinder case presents the premium optics behind the
      // counter, where a shop keeps its $279 glass. It ships EMPTY like every
      // fixture — its felt tiers fill when optics are stocked, not before.
      const kase = merch.instantiateKit && merch.instantiateKit('rangefinder_display');
      if (kase) {
        kase.position.set(-1.05, 1.01, 0.0);
        g.add(kase);
      }
      const dress = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const box = merch.instantiate('carton');
        if (!box) break;
        box.scale.setScalar(0.40 + (i % 3) * 0.06);
        box.position.set(-1.25 + i * 0.42, 1.545, -0.08);
        box.rotation.y = 0.1 * ((i % 2) ? 1 : -1);
        dress.add(box);
      }
      // the club's own carrier bags, stood on the upper shelf
      const bagMat = new THREE.MeshStandardMaterial({ color: 0x2c5233, roughness: 0.86 });
      for (let i = 0; i < 5; i++) {
        const bag = new THREE.Mesh(roundedBox(0.24, 0.30, 0.09, 0.012), bagMat);
        bag.position.set(-1.0 + i * 0.45, 2.12, -0.08);
        bag.rotation.y = 0.08 * ((i % 2) ? 1 : -1);
        bag.castShadow = true;
        dress.add(bag);
        for (const hx of [-0.06, 0.06]) {
          const handle = new THREE.Mesh(
            new THREE.TorusGeometry(0.035, 0.005, 4, 8, Math.PI), mats.kraft);
          handle.position.set(-1.0 + i * 0.45 + hx, 2.27, -0.08);
          handle.rotation.y = Math.PI / 2;
          dress.add(handle);
        }
      }
      g.add(merch.bake(dress));
    });
    addCol(colBoxAt(f.x, f.z, 3.4, 0.7));
    return g;
  }

  // ------------------------------------------------------ backroom shelf ----
  // THE WEAKEST FIXTURE IN THE GAME, per the audit: two flat posts and three
  // bare boards, floating with no feet, no bracing, and nothing on them. A
  // stockroom rack is a FRAME — four uprights, diagonal bracing, feet — and the
  // whole point of a stockroom is that it is FULL (ref 8).
  // Sheet-04 stock_shelving modules (1.20 x 0.50 x 2.00, X-braced steel with
  // four pale boards) replace the welded frame: two modules side by side for
  // the long runs, one for the doorway-adjacent short unit. Board tops sit at
  // 0.1455 / 0.6455 / 1.1455 / 1.6455 — the carton dressing and the ':back'
  // stock in rebuildStock land on those exact planes. The frame stands in
  // until the kit loads.
  function backshelfUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const wZ = f.short ? 1.7 : 2.6; // doorway-adjacent short unit
    const D = 0.62;
    const H = 2.30;
    const boards = [0.16, 0.62, 1.10, 1.58, 2.06];

    for (const sx of [-wZ / 2 + 0.04, wZ / 2 - 0.04]) {
      for (const sz of [-D / 2 + 0.04, D / 2 - 0.04]) {
        const post = new THREE.Mesh(roundedBox(0.06, H, 0.06, 0.008), mats.iron);
        post.position.set(sx, H / 2, sz);
        post.castShadow = true;
        legacy.add(post);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.11), mats.iron);
        foot.position.set(sx, 0.01, sz);
        legacy.add(foot);
      }
    }
    for (const y of boards) {
      const board = new THREE.Mesh(roundedBox(wZ - 0.02, 0.05, D - 0.02, 0.008), mats.rawWood);
      board.position.set(0, y, 0);
      board.receiveShadow = true;
      board.castShadow = true;
      legacy.add(board);
      // the front lip that stops a carton walking off the shelf
      const lip = new THREE.Mesh(new THREE.BoxGeometry(wZ - 0.02, 0.05, 0.018), mats.iron);
      lip.position.set(0, y + 0.048, D / 2 - 0.03);
      legacy.add(lip);
    }
    // X-bracing across the back — what actually stops a rack racking
    for (let i = 0; i < boards.length - 1; i++) {
      const y0 = boards[i];
      const y1 = boards[i + 1];
      const dy = y1 - y0;
      const len = Math.hypot(wZ - 0.1, dy);
      for (const dir of [1, -1]) {
        const brace = new THREE.Mesh(
          new THREE.BoxGeometry(len, 0.02, 0.014), mats.iron);
        brace.position.set(0, (y0 + y1) / 2, -D / 2 + 0.03);
        brace.rotation.z = dir * Math.atan2(dy, wZ - 0.1);
        legacy.add(brace);
      }
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const spots = f.short ? [0] : [-0.62, 0.62];
      const modules = spots.map((mx) => {
        const m = merch.instantiateKit && merch.instantiateKit('stock_shelving');
        if (m) m.position.x = mx;
        return m;
      });
      if (modules.some((m) => !m)) return;
      for (const m of modules) g.add(m);
      g.remove(legacy);
    });
    const swap = Math.abs(Math.sin(f.ry)) > 0.5;
    const halfLen = wZ / 2 + 0.15;
    addCol(colBoxAt(f.x, f.z, swap ? 0.9 : halfLen * 2, swap ? halfLen * 2 : 0.9));
    return g;
  }

  const FIXTURE_BUILDERS = {
    shelf: shelfUnit, rack: rackUnit, table: tableUnit, rail: railUnit,
    hatstand: hatstandUnit, bagstand: bagstandUnit, shoerack: shoerackUnit,
    feature: featureUnit, backcounter: backcounterUnit, backshelf: backshelfUnit,
  };
  // The shop as the PLAYER has it, not as it was designed — placedFixtures() applies whatever they
  // moved, turned or put away, and falls through to the default plan for everything else.
  //
  // Build mode needs to re-lay the floor after every change, so the loop records exactly the
  // colliders and prompts IT created (tracking is off for everything else in this file) and can
  // take them all back without disturbing the counter, the rug or the lounge.
  function layFixtures() {
    tracking = true;
    for (const f of placedFixtures(state)) {
      const build = FIXTURE_BUILDERS[f.kind];
      if (!build) continue;
      const g = build(f);
      g.position.set(f.x, 0, f.z);
      g.rotation.y = f.ry;
      interior.add(g);
      fixtureAnchors.set(f.id, g);
      fixtureProp(f);
    }
    tracking = false;
  }

  function relayFixtures() {
    for (const c of laidCols) removeCol(c);
    for (const p of laidProps) removeProp(p);
    laidCols.length = 0;
    laidProps.length = 0;
    for (const g of fixtureAnchors.values()) interior.remove(g);
    fixtureAnchors.clear();
    layFixtures();
  }

  layFixtures();

  // --- Sheet-03 standing decor (architecture, not re-layable furniture) -----
  // The snack & drink shelf stands between the south windows — impulse goods
  // on the way out. Pure set dressing: its stock is authored into the asset.
  if (merch) merch.onReady(() => {
    const snack = merch.instantiateKit && merch.instantiateKit('snack_shelf');
    if (snack) {
      snack.position.set(-6.6, 0, 6.02);
      snack.rotation.y = Math.PI;
      interior.add(snack);
    }
    // The face-out apparel display stands EMPTY beside the shoe wall — its
    // arms and base shelf are landing spots for garments the player hangs,
    // not pre-dressed decor. (Every fixture ships bare; stock is earned.)
    const disp = merch.instantiateKit && merch.instantiateKit('apparel_wall_display');
    if (disp) {
      disp.position.set(5.44, 0, 1.35);
      disp.rotation.y = -Math.PI / 2;
      interior.add(disp);
    }
    // The Sheet-04 double-sided gondola holds the centre floor between the
    // feature table and the apparel zone. It ships EMPTY — its 24 shelf
    // slots await future product lines.
    const gondola = merch.instantiateKit && merch.instantiateKit('retail_gondola');
    if (gondola) {
      gondola.position.set(0.4, 0, -0.9);
      interior.add(gondola);
    }
  });
  addCol(colBoxAt(-6.6, 6.02, 1.06, 0.5));
  addCol(colBoxAt(5.44, 1.35, 0.5, 1.26));
  addCol(colBoxAt(0.4, -0.9, 1.3, 0.7));

  // permanent club logo rug on the entry axis
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(LOGO_RUG.w, LOGO_RUG.d),
    new THREE.MeshStandardMaterial({ map: makeRugTexture((state && state.clubName) || 'The Club'), roughness: 0.98 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(LOGO_RUG.x, 0.02, LOGO_RUG.z);
  rug.renderOrder = 1;
  rug.receiveShadow = true;
  interior.add(rug);

  return { fixtureAnchors, relayFixtures };
}

// ------------------------------------------------------------- lounge -------
// Furnished from day one (ref 8): two leather club chairs, a round walnut
// coffee table, a bordered rug, and the club-events board. The lounge1 decor
// upgrade still layers the premium suite on top.
export function buildLounge(B) {
  const { interior, mats, merch, addCol, colBoxAt } = B;

  // The Sheet-04 lounge armchair (0.85 m leather club chair: rolled arms,
  // rolled back rail, walnut feet) — authored to the reference this fixture
  // always chased. Kit front faces +Z at ry 0.
  function clubChair(spot) {
    addCol(colBoxAt(spot.x, spot.z, 0.95, 0.95));   // the collider does not wait
    if (!merch) return;
    merch.onReady(() => {
      const model = (merch.instantiateKit && merch.instantiateKit('lounge_armchair'))
        || merch.instantiateRaw('armchair');
      if (!model) return;
      model.position.set(spot.x, 0, spot.z);
      model.rotation.y = spot.ry;
      interior.add(model);
    });
  }
  clubChair(LOUNGE.chairA);
  clubChair(LOUNGE.chairB);

  // trophies on the partition shelf — were three gold cylinders
  if (merch) merch.onReady(() => {
    const shelf = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const t = merch.instantiate('trophy');
      if (!t) break;
      t.scale.setScalar(0.9 + (i % 2) * 0.22);
      t.position.set(LOUNGE.trophy.x - 0.08, 1.30, LOUNGE.trophy.z - 0.32 + i * 0.32);
      t.rotation.y = -Math.PI / 2 + (i - 1) * 0.2;
      shelf.add(t);
    }
    interior.add(merch.bake(shelf));
  });

  // round coffee table + magazines + mug. The magazines and the mug are
  // dressing on whichever top is current: the procedural table (top 0.465)
  // until the kit loads, then the Sheet-04 lounge_coffee_table (top 0.45).
  function coffeeDressing(topY) {
    const d = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const mag = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.008, 0.32),
        new THREE.MeshStandardMaterial({ color: [0x2e5a35, 0xc9d7e4, 0xd7c9a8][i], roughness: 0.7 }),
      );
      mag.position.set(-0.08 + i * 0.05, topY + 0.005 + i * 0.01, 0.02 + i * 0.03);
      mag.rotation.y = i * 0.3 - 0.2;
      d.add(mag);
    }
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10), mats.greenPaint);
    mug.position.set(0.25, topY + 0.045, -0.12);
    d.add(mug);
    return d;
  }
  const coffee = new THREE.Group();
  const cTop = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20), mats.walnut);
  cTop.position.y = 0.44;
  cTop.castShadow = true;
  coffee.add(cTop);
  const cPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.42, 10), mats.walnutDark);
  cPost.position.y = 0.21;
  coffee.add(cPost);
  const cFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.04, 16), mats.walnutDark);
  cFoot.position.y = 0.02;
  coffee.add(cFoot);
  coffee.add(coffeeDressing(0.465));
  coffee.position.set(LOUNGE.coffee.x, 0, LOUNGE.coffee.z);
  interior.add(coffee);
  addCol(colBoxAt(LOUNGE.coffee.x, LOUNGE.coffee.z, 1.1, 1.1));
  if (merch) merch.onReady(() => {
    const table = merch.instantiateKit && merch.instantiateKit('lounge_coffee_table');
    if (!table) return;
    const g = new THREE.Group();
    g.add(table, coffeeDressing(0.45));
    g.position.set(LOUNGE.coffee.x, 0, LOUNGE.coffee.z);
    interior.add(g);
    interior.remove(coffee);
    // the companion side table in the corner beside chair A
    const side = merch.instantiateKit && merch.instantiateKit('lounge_side_table');
    if (side) {
      side.position.set(2.75, 0, -6.05);
      side.rotation.y = 0.4;
      interior.add(side);
      addCol(colBoxAt(2.75, -6.05, 0.65, 0.65));
    }
  });

  // bordered lounge rug (pine motif, no lettering)
  const loungeRug = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 2.5),
    new THREE.MeshStandardMaterial({ map: makeRugTexture(' ', { w: 256, h: 224 }), roughness: 0.98 }),
  );
  loungeRug.rotation.x = -Math.PI / 2;
  loungeRug.position.set(LOUNGE.rug.x, 0.018, LOUNGE.rug.z);
  loungeRug.renderOrder = 1;
  loungeRug.receiveShadow = true;
  interior.add(loungeRug);

  // club events board on the partition (ref 8's CLUB EVENTS)
  const evTex = makeSignTexture(
    ['CLUB EVENTS', 'Member–Member · May 17–18', 'Pine Classic · June 7', 'Junior Championship · Aug 2–3', 'Fall Classic · Sept 13'],
    { w: 512, h: 640, field: '#f4f0e6', ink: '#1f4a26', pine: false, sizes: [56, 30, 30, 30, 30] },
  );
  const evFrame = new THREE.Mesh(roundedBox(0.05, 1.16, 0.95, 0.02), mats.walnut);
  evFrame.position.set(LOUNGE.events.x + 0.025, 1.62, LOUNGE.events.z);
  interior.add(evFrame);
  const events = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 1.06),
    new THREE.MeshStandardMaterial({ map: evTex, roughness: 0.85 }),
  );
  // proud of the backer board so the face can't be swallowed by it
  events.position.set(LOUNGE.events.x - 0.005, 1.62, LOUNGE.events.z);
  events.rotation.y = LOUNGE.events.ry;
  interior.add(events);
}

// ------------------------------------------------------- stockroom extras ---
// The working room (ref 9): packing bench, cleaning corner, receiving sign.
export function buildStockroomDressing(B) {
  const { interior, mats, merch, addCol, colBoxAt } = B;
  const P = STOCKROOM.packing;

  // A STOCKROOM IS FULL. Ref 8: shelves of cartons, a hand truck, a packing
  // bench. The old one was three bare racks and a mop, and it was the emptiest,
  // weakest room in the building. These cartons are BACKROOM DRESSING — they are
  // not the delivery boxes the player opens (those are spawned by the delivery
  // system and carry real stock); they are what a working backroom looks like.
  // The models arrive asynchronously, well after the shop is built, so the
  // dressing is deferred rather than placed inline — otherwise it would simply
  // never appear.
  if (merch) merch.onReady(() => {
    const RACKS = [
      { x: 8.05, z: -6.1, ry: 0, len: 2.6 },
      { x: 9.9, z: -5.6, ry: -Math.PI / 2, len: 1.7 },
      { x: 9.9, z: -0.6, ry: -Math.PI / 2, len: 2.6 },
    ];
    const dress = new THREE.Group();
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (const rk of RACKS) {
      // the Sheet-04 stock_shelving board tops, less the old 0.025 board
      // half-thickness the carton offset was calibrated against
      for (const y of [0.1205, 0.6205, 1.1205, 1.6205]) {
        const n = 2 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
          if (rnd() < 0.18) continue;          // a working shelf has gaps in it
          const box = merch.instantiate(rnd() < 0.15 ? 'carton_open' : 'carton');
          if (!box) break;
          const along = -rk.len / 2 + 0.34 + i * (rk.len - 0.6) / Math.max(1, n - 1);
          const s = 0.72 + rnd() * 0.45;       // cartons are not all one size
          box.scale.setScalar(s);
          const lx = rk.x + Math.cos(rk.ry) * along;
          const lz = rk.z - Math.sin(rk.ry) * along;
          box.position.set(lx, y + 0.055, lz);
          box.rotation.y = rk.ry + (rnd() - 0.5) * 0.3;
          dress.add(box);
        }
      }
    }
    // a stack by the receiving door, and the hand truck parked beside it
    for (let i = 0; i < 3; i++) {
      const box = merch.instantiate('carton');
      if (!box) break;
      box.scale.setScalar(0.9 + i * 0.06);
      box.position.set(STOCKROOM.receivingInside.x + (i % 2) * 0.12,
        i * 0.30, STOCKROOM.receivingInside.z + 0.5 + (i % 2) * 0.08);
      box.rotation.y = 0.2 + i * 0.5;
      dress.add(box);
    }
    const truck = merch.instantiate('handtruck');
    if (truck) {
      truck.position.set(STOCKROOM.handTruck.x, 0, STOCKROOM.handTruck.z);
      truck.rotation.y = 1.9;
      dress.add(truck);
      addCol(colBoxAt(STOCKROOM.handTruck.x, STOCKROOM.handTruck.z, 0.5, 0.5));
    }
    interior.add(merch.bake(dress));

    // Sheet-04 storage totes, stacked where the work happens: a supply pair
    // by the packing bench, a returns pair by receiving. Kit props keep
    // their own baked materials — they stay out of the merged dress group.
    const TOTES = [
      { name: 'storage_tote_olive', x: 6.55, z: -0.35, y: 0, ry: 0.35 },
      { name: 'storage_tote_slate', x: 6.55, z: -0.35, y: 0.288, ry: 0.15 },
      { name: 'storage_tote_charcoal', x: 7.9, z: -5.0, y: 0, ry: -0.5 },
      { name: 'storage_tote_stone', x: 7.9, z: -5.0, y: 0.288, ry: -0.75 },
    ];
    for (const t of TOTES) {
      const tote = merch.instantiateKit && merch.instantiateKit(t.name);
      if (!tote) continue;
      tote.position.set(t.x, t.y, t.z);
      tote.rotation.y = t.ry;
      interior.add(tote);
    }
  });

  // packing bench: steel legs, worn walnut top, clipboard, tape gun and the
  // authored reference-50 roll used by the delivery workflow.
  const bench = new THREE.Group();
  const top = new THREE.Mesh(roundedBox(1.7, 0.07, 0.85, 0.02), mats.rawWood);
  top.position.y = 0.92;
  top.castShadow = true;
  top.receiveShadow = true;
  bench.add(top);
  const under = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.7), mats.rawWood);
  under.position.y = 0.42;
  bench.add(under);
  for (const [lx, lz] of [[-0.78, -0.36], [0.78, -0.36], [-0.78, 0.36], [0.78, 0.36]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.92, 0.06), mats.iron);
    leg.position.set(lx, 0.46, lz);
    bench.add(leg);
  }
  const clipboard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.3), mats.trimPaint);
  clipboard.position.set(-0.4, 0.965, 0.1);
  clipboard.rotation.y = 0.3;
  bench.add(clipboard);
  const tapeGun = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.06), mats.charcoal);
  tapeGun.position.set(0.35, 0.99, -0.1);
  tapeGun.rotation.y = -0.4;
  bench.add(tapeGun);
  if (merch) merch.onReady(() => {
    const tapeRoll = merch.instantiate('delivery_packing_tape_roll');
    if (!tapeRoll) return;
    tapeRoll.name = 'PackingBenchTapeRoll';
    // The authored roll is 10 cm in diameter. With its Z axis rotated upright,
    // a 1.01 m centre rests its lower rim on the 0.955 m bench surface instead
    // of burying the prop inside the worktop.
    tapeRoll.position.set(0.18, 1.01, -0.12);
    tapeRoll.rotation.set(Math.PI / 2, -0.2, 0);
    bench.add(tapeRoll);
  });
  bench.position.set(P.x, 0, P.z);
  bench.rotation.y = P.ry;
  interior.add(bench);
  addCol(colBoxAt(P.x, P.z, 1.9, 1.05));

  // cleaning corner: mop bucket, mop, broom against the partition
  const C = STOCKROOM.cleaning;
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0xd9c944, roughness: 0.7 }));
  bucket.position.set(C.x, 0.15, C.z);
  interior.add(bucket);
  const mopPole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.45, 6), mats.rawWood);
  mopPole.position.set(C.x + 0.05, 0.75, C.z + 0.03);
  mopPole.rotation.z = 0.18;
  interior.add(mopPole);
  const mopHead = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.16, 8), mats.trimPaint);
  mopHead.position.set(C.x + 0.18, 0.1, C.z + 0.03);
  interior.add(mopHead);
  const broomPole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 6), mats.rawWood);
  broomPole.position.set(C.x - 0.22, 0.72, C.z);
  broomPole.rotation.z = -0.14;
  interior.add(broomPole);
  const broomHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), mats.kraft);
  broomHead.position.set(C.x - 0.4, 0.08, C.z);
  interior.add(broomHead);
  addCol(colBoxAt(C.x, C.z, 0.7, 0.5));

  // RECEIVING sign over the back door (inside face)
  const recTex = makeSignTexture(['RECEIVING', 'deliveries sign in'], { w: 384, h: 160, sizes: [44, 26] });
  const rec = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.42),
    new THREE.MeshStandardMaterial({ map: recTex, roughness: 0.85 }),
  );
  rec.position.set(INTERIOR.w / 2 - 0.04, 2.62, -3.6);
  rec.rotation.y = -Math.PI / 2;
  interior.add(rec);
}

// ----------------------------------------------------------- checkout -------
// The checkout island + register. The register's canvas screen and its whole
// scan/payment interaction are wired by clubhouse.js (they touch customers,
// live sales, reservations); this builds only the physical kit and returns
// the screen-drawing hook.
export function buildCheckout(B) {
  const { interior, mats, merch, addCol, colBoxAt } = B;

  // paneled island: walnut body, panel insets, wood top, brass foot rail
  // This remains a zero-network fallback while the GLB loader is warming up. Once
  // the production Blender counter is ready it is removed as one group, avoiding a
  // duplicate shell or z-fighting surfaces.
  const legacyCounter = new THREE.Group();
  interior.add(legacyCounter);
  const body = new THREE.Mesh(roundedBox(COUNTER.len, 0.96, COUNTER.depth - 0.16, 0.02), mats.walnut);
  body.position.set(COUNTER.x, 0.5, COUNTER.z);
  body.castShadow = true;
  legacyCounter.add(body);
  for (let i = 0; i < 3; i++) {
    const inset = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.02), mats.walnutDark);
    inset.position.set(COUNTER.x - 1.05 + i * 1.05, 0.52, COUNTER.z - COUNTER.depth / 2 + 0.07);
    legacyCounter.add(inset);
  }
  const top = new THREE.Mesh(roundedBox(COUNTER.len + 0.2, 0.07, COUNTER.depth + 0.06, 0.025), mats.walnutDark);
  top.position.set(COUNTER.x, 1.02, COUNTER.z);
  top.castShadow = true;
  top.receiveShadow = true;
  legacyCounter.add(top);
  const footRail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, COUNTER.len, 8), mats.brass);
  footRail.rotation.z = Math.PI / 2;
  footRail.position.set(COUNTER.x, 0.16, COUNTER.z - COUNTER.depth / 2 + 0.02);
  legacyCounter.add(footRail);
  addCol(colBoxAt(COUNTER.x, COUNTER.z, COUNTER.len + 0.3, COUNTER.depth + 0.2));

  if (merch) merch.onReady(() => {
    // The finished checkout-kit counter (assets/checkout): charcoal top with alu
    // trim, lit cream staff shelf, closed register cabinet under the POS block.
    // Authored 2.60 x 0.85 m with the top at 0.95; non-uniform scale maps it onto
    // the plan's 3.2 x 1.0 footprint with the top exactly at COUNTER_TOP.
    const counter = merch.instantiateKit && merch.instantiateKit('checkout_counter');
    if (!counter) return;
    counter.scale.set(COUNTER.len / 2.6, COUNTER_TOP / 0.95, COUNTER.depth / 0.85);
    counter.position.set(COUNTER.x, 0, COUNTER.z);
    interior.add(counter);
    interior.remove(legacyCounter);
  });

  // REGISTER KIT. The positions are no longer eyeballed offsets from registerX —
  // they come from REGISTER in shopLayout.js, which was DERIVED against the player's
  // reach circle and the customer's, and which checkout-space.test.js holds open.
  // The card reader sits where BOTH can touch it; the monitor faces the staff; the
  // scanner sits mid-depth so goods pass over it on their way to the bag.
  //
  // The screens are live canvases owned by registerMode.js, because what is ON them
  // is a function of the transaction, not of the furniture.
  // deferred: the models land well after the shop is built
  if (merch) merch.onReady(() => {
    // THE FINISHED CHECKOUT KIT (assets/checkout/glb → vendor/models/checkout).
    // Each device authors its screen face toward -Y, which the exporter converts
    // to the game's +Z staff side at rotation zero. Origins are bottom-centre, so
    // every prop sits directly on COUNTER_TOP.
    const placeKit = (name, spec, { ry = 0, scale = 1 } = {}) => {
      const o = merch.instantiateKit && merch.instantiateKit(name, { scale });
      if (!o) return null;
      o.position.set(spec.x, COUNTER_TOP, spec.z);
      o.rotation.y = ry;
      interior.add(o);
      return o;
    };
    // Large readable POS head like the reference. The kit monitor is authored
    // real-world sized; the reference treats the POS as the primary gameplay
    // interface, so it carries a deliberate scale-up — the physical bezel and
    // the live screen scale together (the canvas hangs on the POS_Screen node).
    const reg = placeKit('pos_monitor', REGISTER.monitor, { scale: 1.6 });
    // NOT `slotMesh(...).material = screenMaterial`: registerMode hangs its own
    // clean-UV canvas plane onto the kit's POS_Screen face.
    if (reg && B.register) B.register.attachScreen(reg);
    const term = placeKit('payment_terminal', REGISTER.cardterm, { scale: 1.35 });
    if (term && B.register) B.register.attachTerm(term);
    const printer = placeKit('receipt_printer', REGISTER.printer, { ry: -0.18, scale: 1.1 });
    if (printer && B.register) B.register.attachPrinter(printer);
    // Customer-facing total display, turned toward the queue.
    placeKit('customer_display', REGISTER.custdisplay, { ry: Math.PI, scale: 1.15 });
  });

  // the screen is drawn by registerMode from the live transaction — a furniture
  // module has no business deciding what a register says
  const drawRegister = () => {};

  // the spare carriers, folded flat at the bagging end. The OPEN bag you actually
  // drop goods into, the divider and the impulse rack are registerMode's — they are
  // part of the transaction, not part of the room.
  if (!B.register || !B.register.simplified) {
    for (let i = 0; i < 3; i++) {
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.02, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x2c4a30, roughness: 0.88 }),
      );
      bag.position.set(REGISTER.bagstand.x, COUNTER_TOP + 0.012 + i * 0.021, REGISTER.bagstand.z);
      bag.rotation.y = 0.08 + i * 0.05;
      bag.castShadow = true;
      interior.add(bag);
    }
  }

  // a hand basket, parked at the aisle end for shoppers to take
  if (merch) merch.onReady(() => {
    const bk = merch.instantiate('basket');
    if (!bk) return;
    bk.position.set(COUNTER.x - COUNTER.len / 2 - 0.34, 0.30, COUNTER.z - 0.30);
    bk.rotation.y = -0.35;
    interior.add(bk);
    const bk2 = merch.instantiate('basket');
    if (bk2) {
      bk2.position.set(COUNTER.x - COUNTER.len / 2 - 0.34, 0.44, COUNTER.z - 0.30);
      bk2.rotation.y = -0.28;
      interior.add(bk2);
    }
  });

  return { drawRegister };
}
