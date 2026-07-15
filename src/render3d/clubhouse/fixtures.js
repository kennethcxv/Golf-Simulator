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
  function shelfUnit(f) {
    const g = new THREE.Group();
    // carcass: sides, plinth, crown, back panel
    for (const sx of [-1.5, 1.5]) {
      const side = new THREE.Mesh(roundedBox(0.08, 2.3, 0.56, 0.02), mats.walnut);
      side.position.set(sx, 1.15, -0.02);
      side.castShadow = true;
      g.add(side);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.25, 0.05), mats.walnutDark);
    back.position.set(0, 1.15, -0.24);
    back.receiveShadow = true;
    g.add(back);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.06, 0.16, 0.6), mats.walnutDark);
    plinth.position.set(0, 0.08, -0.01);
    g.add(plinth);
    const crown = new THREE.Mesh(roundedBox(3.22, 0.14, 0.66, 0.03), mats.walnut);
    crown.position.set(0, 2.34, -0.01);
    crown.castShadow = true;
    g.add(crown);
    // shelf boards (merch contract y) + brass gallery edge + light strips
    for (const y of [0.5, 1.05, 1.6]) {
      const board = new THREE.Mesh(roundedBox(2.94, 0.05, 0.48, 0.015), mats.walnut);
      board.position.set(0, y, 0.02);
      board.castShadow = true;
      board.receiveShadow = true;
      g.add(board);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.94, 0.022, 0.012), mats.brass);
      edge.position.set(0, y + 0.012, 0.265);
      g.add(edge);
      const strip = lightStrip(mats, 2.8);
      strip.position.set(0, y - 0.032, 0.2);
      g.add(strip);
    }
    // header sign
    const sign = categorySign(f.title);
    sign.position.set(0, 2.05, 0.255);
    g.add(sign);
    const w = Math.abs(f.ry % Math.PI) < 0.1 ? 3.0 : 0.5;
    const d = Math.abs(f.ry % Math.PI) < 0.1 ? 0.5 : 3.0;
    addCol(colBoxAt(f.x, f.z, w + 0.2, d + 0.2));
    return g;
  }

  // ----------------------------------------------------------- club bay -----
  function rackUnit(f) {
    const g = new THREE.Group();
    // tall framed back
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.35, 0.06), mats.walnutDark);
    back.position.set(0, 1.2, -0.42);
    back.receiveShadow = true;
    g.add(back);
    for (const sx of [-1.44, 1.44]) {
      const stile = new THREE.Mesh(roundedBox(0.1, 2.42, 0.16, 0.02), mats.walnut);
      stile.position.set(sx, 1.21, -0.38);
      stile.castShadow = true;
      g.add(stile);
    }
    const header = new THREE.Mesh(roundedBox(2.98, 0.34, 0.2, 0.02), mats.walnut);
    header.position.set(0, 2.28, -0.36);
    header.castShadow = true;
    g.add(header);
    const sign = categorySign(f.title, { w: 1.9, h: 0.3, charcoal: true });
    sign.position.set(0, 2.28, -0.25);
    g.add(sign);
    const strip = lightStrip(mats, 2.7);
    strip.position.set(0, 2.08, -0.3);
    g.add(strip);
    // base cabinet: the stand the clubs lean from, drawer fronts + brass pulls
    const base = new THREE.Mesh(roundedBox(2.88, 0.15, 0.9, 0.02), mats.walnut);
    base.position.set(0, 0.075, -0.05);
    base.castShadow = true;
    g.add(base);
    for (let i = 0; i < 3; i++) {
      const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.09, 0.03), mats.walnutDark);
      drawer.position.set(-0.94 + i * 0.94, 0.075, 0.41);
      g.add(drawer);
      const pull = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), mats.brass);
      pull.position.set(-0.94 + i * 0.94, 0.075, 0.435);
      g.add(pull);
    }
    // shaft cradle rails with brass clips
    for (const y of [0.62, 1.32]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.05, 0.05), mats.walnut);
      rail.position.set(0, y, -0.3);
      g.add(rail);
      for (let i = 0; i < 8; i++) {
        const clip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.04), mats.brass);
        clip.position.set(-1.22 + i * 0.35, y, -0.27);
        g.add(clip);
      }
    }
    addCol(colBoxAt(f.x, f.z, Math.abs(Math.sin(f.ry)) > 0.5 ? 1.0 : 3.0, Math.abs(Math.sin(f.ry)) > 0.5 ? 3.0 : 1.0));
    return g;
  }

  // ------------------------------------------------------- nesting tables ---
  function tableUnit(f) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(roundedBox(2.2, 0.09, 1.4, 0.025), mats.walnut);
    top.position.y = 0.96;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);
    const apron = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.09, 1.2), mats.walnutDark);
    apron.position.y = 0.88;
    g.add(apron);
    for (const [lx, lz] of [[-0.95, -0.55], [0.95, -0.55], [-0.95, 0.55], [0.95, 0.55]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.92, 8), mats.walnut);
      leg.position.set(lx, 0.46, lz);
      leg.castShadow = true;
      g.add(leg);
    }
    // lower nesting table peeking out the front
    const nestTop = new THREE.Mesh(roundedBox(1.3, 0.07, 0.8, 0.02), mats.walnut);
    nestTop.position.set(0.35, 0.55, 0.5);
    nestTop.castShadow = true;
    g.add(nestTop);
    for (const [lx, lz] of [[-0.2, 0.2], [0.9, 0.2], [-0.2, 0.8], [0.9, 0.8]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.52, 8), mats.walnut);
      leg.position.set(lx, 0.26, lz);
      g.add(leg);
    }
    // hang rail behind (merch contract: posts z −0.62, bar y 1.68)
    for (const rx of [-0.9, 0.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.7, 8), mats.iron);
      post.position.set(rx, 0.85, -0.62);
      g.add(post);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 8), mats.brass);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 1.68, -0.62);
    g.add(rail);
    addCol(colBoxAt(f.x, f.z, 2.4, 1.6));
    return g;
  }

  // -------------------------------------------------------- apparel rail ----
  function railUnit(f) {
    const g = new THREE.Group();
    for (const rx of [-1.0, 1.0]) {
      const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.66, 10), mats.iron);
      upright.position.set(rx, 0.85, 0);
      upright.castShadow = true;
      g.add(upright);
      const foot = new THREE.Mesh(roundedBox(0.16, 0.05, 0.7, 0.02), mats.walnut);
      foot.position.set(rx, 0.025, 0);
      g.add(foot);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.1, 10), mats.brass);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 1.68, 0);
    g.add(bar);
    // hanging sign board: walnut backer on two brass drops off the bar
    const signBacker = new THREE.Mesh(roundedBox(0.98, 0.26, 0.03, 0.012), mats.walnut);
    signBacker.position.set(0, 1.92, 0);
    g.add(signBacker);
    const signBoard = categorySign(f.title, { w: 0.9, h: 0.2 });
    signBoard.position.set(0, 1.92, 0.017);
    g.add(signBoard);
    const signBoardB = categorySign(f.title, { w: 0.9, h: 0.2 });
    signBoardB.position.set(0, 1.92, -0.017);
    signBoardB.rotation.y = Math.PI;
    g.add(signBoardB);
    for (const dx of [-0.4, 0.4]) {
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), mats.brass);
      drop.position.set(dx, 1.75, 0);
      g.add(drop);
    }
    addCol(colBoxAt(f.x, f.z, Math.abs(Math.sin(f.ry)) > 0.5 ? 0.9 : 2.2, Math.abs(Math.sin(f.ry)) > 0.5 ? 2.2 : 0.9));
    return g;
  }

  // ----------------------------------------------------------- hat tree -----
  function hatstandUnit(f) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.75, 10), mats.walnut);
    pole.position.y = 0.87;
    pole.castShadow = true;
    g.add(pole);
    for (const [py, r] of [[0.42, 0.09], [1.72, 0.07]]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, 0.05, 10), mats.walnutDark);
      collar.position.y = py;
      g.add(collar);
    }
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.07, 12), mats.walnutDark);
    foot.position.y = 0.035;
    g.add(foot);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.28, 6), mats.brass);
      peg.rotation.z = Math.PI / 2;
      peg.rotation.y = a;
      const py = 1.15 + (i % 2) * 0.35;
      peg.position.set(Math.sin(a) * 0.15, py, Math.cos(a) * 0.15);
      g.add(peg);
    }
    addCol(colBoxAt(f.x, f.z, 0.8, 0.8));
    return g;
  }

  // -------------------------------------------------------- bag platforms ---
  function bagstandUnit(f) {
    const g = new THREE.Group();
    // two-tier walnut display platforms (ref 7), bags stand on the low tier
    const lowTier = new THREE.Mesh(roundedBox(2.5, 0.12, 1.15, 0.025), mats.walnut);
    lowTier.position.set(0, 0.06, 0.05);
    lowTier.castShadow = true;
    lowTier.receiveShadow = true;
    g.add(lowTier);
    const highTier = new THREE.Mesh(roundedBox(2.5, 0.3, 0.5, 0.025), mats.walnut);
    highTier.position.set(0, 0.15, -0.45);
    highTier.castShadow = true;
    g.add(highTier);
    // back rail the bags lean toward (merch contract: posts at z −0.45)
    const backRail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 8), mats.brass);
    backRail.rotation.z = Math.PI / 2;
    backRail.position.set(0, 1.02, -0.45);
    g.add(backRail);
    for (const px of [-1.15, 1.15]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 1.0, 8), mats.iron);
      post.position.set(px, 0.5, -0.45);
      g.add(post);
    }
    const sign = categorySign(f.title, { w: 1.0, h: 0.2 });
    sign.position.set(0, 1.16, -0.45);
    g.add(sign);
    addCol(colBoxAt(f.x, f.z, 2.6, 1.3));
    return g;
  }

  // ------------------------------------------------------- lit shoe wall ----
  function shoerackUnit(f) {
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.1, 0.05), mats.walnutDark);
    back.position.set(0, 1.05, -0.22);
    back.receiveShadow = true;
    g.add(back);
    for (const sx of [-1.34, 1.34]) {
      const side = new THREE.Mesh(roundedBox(0.07, 2.1, 0.5, 0.02), mats.walnut);
      side.position.set(sx, 1.05, -0.02);
      side.castShadow = true;
      g.add(side);
    }
    const crown = new THREE.Mesh(roundedBox(2.86, 0.12, 0.56, 0.025), mats.walnut);
    crown.position.set(0, 2.14, -0.02);
    g.add(crown);
    const sign = categorySign(f.title);
    sign.position.set(0, 1.88, 0.2);
    g.add(sign);
    // angled shoe boards (merch contract y) with lips + light strips
    for (const y of [0.35, 0.85, 1.35]) {
      const board = new THREE.Mesh(roundedBox(2.6, 0.04, 0.44, 0.012), mats.walnut);
      board.position.set(0, y, 0.02);
      board.rotation.x = -0.18;
      board.receiveShadow = true;
      g.add(board);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.03, 0.015), mats.brass);
      lip.position.set(0, y - 0.035, 0.22);
      g.add(lip);
      const strip = lightStrip(mats, 2.45);
      strip.position.set(0, y - 0.055, 0.14);
      g.add(strip);
    }
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

  // ------------------------------------------------------ feature pedestal --
  function featureUnit(f) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.08, 24), mats.walnut);
    top.position.y = 0.9;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.885, 0.885, 0.03, 24), mats.brass);
    band.position.y = 0.87;
    g.add(band);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.86, 12), mats.walnutDark);
    column.position.y = 0.44;
    g.add(column);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.06, 20), mats.walnutDark);
    foot.position.y = 0.03;
    g.add(foot);
    // green felt runner on top (the display cloth)
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.012, 24), mats.feltGreen);
    felt.position.y = 0.945;
    g.add(felt);
    addCol(colBoxAt(f.x, f.z, 1.8, 1.8));
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
  function backshelfUnit(f) {
    const g = new THREE.Group();
    const wZ = f.short ? 1.7 : 2.6; // doorway-adjacent short unit
    const D = 0.62;
    const H = 2.30;
    const boards = [0.16, 0.62, 1.10, 1.58, 2.06];

    for (const sx of [-wZ / 2 + 0.04, wZ / 2 - 0.04]) {
      for (const sz of [-D / 2 + 0.04, D / 2 - 0.04]) {
        const post = new THREE.Mesh(roundedBox(0.06, H, 0.06, 0.008), mats.iron);
        post.position.set(sx, H / 2, sz);
        post.castShadow = true;
        g.add(post);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.11), mats.iron);
        foot.position.set(sx, 0.01, sz);
        g.add(foot);
      }
    }
    for (const y of boards) {
      const board = new THREE.Mesh(roundedBox(wZ - 0.02, 0.05, D - 0.02, 0.008), mats.rawWood);
      board.position.set(0, y, 0);
      board.receiveShadow = true;
      board.castShadow = true;
      g.add(board);
      // the front lip that stops a carton walking off the shelf
      const lip = new THREE.Mesh(new THREE.BoxGeometry(wZ - 0.02, 0.05, 0.018), mats.iron);
      lip.position.set(0, y + 0.048, D / 2 - 0.03);
      g.add(lip);
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
        g.add(brace);
      }
    }
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

  // Was six beveled boxes and four peg legs — it read as a blob. A club chair is
  // defined by its ROLLED arms and rolled back rail (ref 8), which is exactly
  // what a stack of boxes cannot say. Modelled now, with the old build kept as
  // the fallback for the moment before the GLBs land.
  function clubChair(spot) {
    addCol(colBoxAt(spot.x, spot.z, 0.95, 0.95));   // the collider does not wait
    if (!merch) return;
    merch.onReady(() => {
      const model = merch.instantiateRaw('armchair');
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

  // round coffee table + magazines + mug
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
  for (let i = 0; i < 3; i++) {
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.008, 0.32),
      new THREE.MeshStandardMaterial({ color: [0x2e5a35, 0xc9d7e4, 0xd7c9a8][i], roughness: 0.7 }),
    );
    mag.position.set(-0.08 + i * 0.05, 0.47 + i * 0.01, 0.02 + i * 0.03);
    mag.rotation.y = i * 0.3 - 0.2;
    coffee.add(mag);
  }
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10), mats.greenPaint);
  mug.position.set(0.25, 0.5, -0.12);
  coffee.add(mug);
  coffee.position.set(LOUNGE.coffee.x, 0, LOUNGE.coffee.z);
  interior.add(coffee);
  addCol(colBoxAt(LOUNGE.coffee.x, LOUNGE.coffee.z, 1.1, 1.1));

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
      for (const y of [0.16, 0.62, 1.10, 1.58, 2.06]) {
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
  });

  // packing bench: steel legs, worn walnut top, clipboard + tape gun
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
  const body = new THREE.Mesh(roundedBox(COUNTER.len, 0.96, COUNTER.depth - 0.16, 0.02), mats.walnut);
  body.position.set(COUNTER.x, 0.5, COUNTER.z);
  body.castShadow = true;
  interior.add(body);
  for (let i = 0; i < 3; i++) {
    const inset = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.02), mats.walnutDark);
    inset.position.set(COUNTER.x - 1.05 + i * 1.05, 0.52, COUNTER.z - COUNTER.depth / 2 + 0.07);
    interior.add(inset);
  }
  const top = new THREE.Mesh(roundedBox(COUNTER.len + 0.2, 0.07, COUNTER.depth + 0.06, 0.025), mats.walnutDark);
  top.position.set(COUNTER.x, 1.02, COUNTER.z);
  top.castShadow = true;
  top.receiveShadow = true;
  interior.add(top);
  const footRail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, COUNTER.len, 8), mats.brass);
  footRail.rotation.z = Math.PI / 2;
  footRail.position.set(COUNTER.x, 0.16, COUNTER.z - COUNTER.depth / 2 + 0.02);
  interior.add(footRail);
  addCol(colBoxAt(COUNTER.x, COUNTER.z, COUNTER.len + 0.3, COUNTER.depth + 0.2));

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
    const placeProp = (name, spec, ry) => {
      const o = merch.instantiate(name);
      if (!o) return null;
      o.position.set(spec.x, COUNTER_TOP, spec.z);
      o.rotation.y = ry !== undefined ? ry : (spec.ry || 0);
      interior.add(o);
      return o;
    };
    const reg = placeProp('register', REGISTER.monitor);
    // NOT `slotMesh(...).material = screenMaterial`. The model's screen face carries an
    // atlas UV from smart_project, so a 0..1 canvas lands on it as a magnified corner —
    // the register rendered as a black slab. registerMode hangs its own clean-UV plane.
    if (reg && B.register) B.register.attachScreen(reg);
    placeProp('scanner', REGISTER.scanner);
    const term = placeProp('cardterm', REGISTER.cardterm);
    if (term && B.register) B.register.attachTerm(term);
    placeProp('printer', REGISTER.printer);
  });

  // the screen is drawn by registerMode from the live transaction — a furniture
  // module has no business deciding what a register says
  const drawRegister = () => {};

  // the spare carriers, folded flat at the bagging end. The OPEN bag you actually
  // drop goods into, the divider and the impulse rack are registerMode's — they are
  // part of the transaction, not part of the room.
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
