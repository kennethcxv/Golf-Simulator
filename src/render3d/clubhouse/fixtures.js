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
  FIXTURES, COUNTER, LOUNGE, STOCKROOM, INTERIOR, LOGO_RUG,
} from '../../data/shopLayout.js';
import { restockShelfFromBackroom } from '../../sim/shop.js';
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
    interior, mats, addCol: rawAddCol, addProp: rawAddProp, removeCol, removeProp,
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

  function shelfLabel(skuIds, title) {
    const inv = state.shop.inventory;
    const shelf = skuIds.reduce((a, id) => a + inv[id].shelf, 0);
    const back = skuIds.reduce((a, id) => a + inv[id].back, 0);
    if (back > 0) return `${title} — ${shelf} out · ${back} in the back — [E] restock`;
    return `${title} — ${shelf} out · backroom empty (order at the office)`;
  }

  function restockAll(skuIds, title) {
    let moved = 0;
    for (const id of skuIds) {
      const res = restockShelfFromBackroom(state, id);
      if (res.ok) moved += res.moved;
    }
    if (moved > 0) {
      B.rebuildStock();
      if (state.tutorial) tutorialFlag(state, 'shelved');
      if (hooks.toast) hooks.toast(`Restocked ${moved} items on the ${title.toLowerCase()}.`);
      if (hooks.sfx) hooks.sfx('thunk');
    } else if (hooks.toast) {
      hooks.toast('Nothing in the back for this display.', 'warn');
    }
  }

  function fixtureProp(f) {
    if (!f.skus.length) return;
    const wp = L2W(f.x, f.z);
    addProp({
      x: wp.x, z: wp.z, r: 2.3,
      label: () => shelfLabel(f.skus, f.title),
      action: () => restockAll(f.skus, f.title),
    });
  }

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
    addCol(colBoxAt(f.x, f.z, 3.4, 0.7));
    return g;
  }

  // ------------------------------------------------------ backroom shelf ----
  function backshelfUnit(f) {
    const g = new THREE.Group();
    const wZ = f.short ? 1.7 : 2.6; // doorway-adjacent short unit
    for (const sx of [-wZ / 2, wZ / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.3, 0.6), mats.rawWood);
      post.position.set(sx, 1.15, 0);
      post.castShadow = true;
      g.add(post);
    }
    for (const y of [0.4, 1.05, 1.7]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(wZ, 0.06, 0.6), mats.rawWood);
      board.position.set(0, y, 0);
      board.receiveShadow = true;
      g.add(board);
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
  const { interior, mats, addCol, colBoxAt } = B;

  function clubChair(spot) {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(roundedBox(0.72, 0.24, 0.68, 0.07), mats.leather);
    seat.position.y = 0.35;
    g.add(seat);
    const backC = new THREE.Mesh(roundedBox(0.72, 0.62, 0.2, 0.07), mats.leather);
    backC.position.set(0, 0.62, -0.28);
    backC.rotation.x = -0.12;
    backC.castShadow = true;
    g.add(backC);
    for (const ax of [-0.33, 0.33]) {
      const arm = new THREE.Mesh(roundedBox(0.14, 0.5, 0.66, 0.055), mats.leather);
      arm.position.set(ax, 0.42, -0.02);
      g.add(arm);
    }
    const cushion = new THREE.Mesh(roundedBox(0.56, 0.09, 0.5, 0.04), mats.sageFabric);
    cushion.position.set(0, 0.49, 0.02);
    g.add(cushion);
    for (const [lx, lz] of [[-0.3, -0.28], [0.3, -0.28], [-0.3, 0.28], [0.3, 0.28]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.24, 8), mats.walnutDark);
      leg.position.set(lx, 0.12, lz);
      g.add(leg);
    }
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = spot.ry;
    interior.add(g);
    addCol(colBoxAt(spot.x, spot.z, 0.95, 0.95));
  }
  clubChair(LOUNGE.chairA);
  clubChair(LOUNGE.chairB);

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
  const { interior, mats, addCol, colBoxAt } = B;
  const P = STOCKROOM.packing;

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
  const { interior, mats, addCol, colBoxAt } = B;

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

  // register: charcoal body, canvas screen on an arm, scanner, card reader,
  // receipt printer, branded bag stack
  const registerBase = new THREE.Mesh(roundedBox(0.34, 0.08, 0.3, 0.015), mats.charcoal);
  registerBase.position.set(COUNTER.registerX, 1.09, COUNTER.z);
  interior.add(registerBase);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.3, 8), mats.charcoal);
  arm.position.set(COUNTER.registerX, 1.24, COUNTER.z + 0.05);
  arm.rotation.x = 0.35;
  interior.add(arm);
  const regCv = document.createElement('canvas');
  regCv.width = 128;
  regCv.height = 80;
  const regTex = new THREE.CanvasTexture(regCv);
  regTex.colorSpace = THREE.SRGBColorSpace;
  const screenBack = new THREE.Mesh(roundedBox(0.36, 0.26, 0.03, 0.012), mats.charcoal);
  screenBack.position.set(COUNTER.registerX, 1.4, COUNTER.z - 0.02);
  screenBack.rotation.x = -0.25;
  interior.add(screenBack);
  const regScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.2),
    new THREE.MeshStandardMaterial({ map: regTex, emissive: 0xffffff, emissiveMap: regTex, emissiveIntensity: 0.55 }),
  );
  regScreen.position.set(COUNTER.registerX, 1.4, COUNTER.z - 0.04);
  regScreen.rotation.x = -0.25;
  regScreen.rotation.y = Math.PI;
  interior.add(regScreen);
  const drawRegister = (lines, total) => {
    const c2 = regCv.getContext('2d');
    c2.fillStyle = '#0d1a12';
    c2.fillRect(0, 0, 128, 80);
    c2.fillStyle = '#35d06a';
    c2.font = '11px monospace';
    c2.textAlign = 'left';
    (lines || ['READY']).slice(0, 4).forEach((l, i) => c2.fillText(l.slice(0, 19), 5, 15 + i * 14));
    if (total !== undefined) {
      c2.fillStyle = '#8ed072';
      c2.font = 'bold 13px monospace';
      c2.textAlign = 'right';
      c2.fillText(`$${total.toFixed(2)}`, 123, 74);
    }
    regTex.needsUpdate = true;
  };
  drawRegister();

  // hand scanner in its cradle
  const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.12), mats.charcoal);
  cradle.position.set(COUNTER.registerX + 0.28, 1.08, COUNTER.z - 0.12);
  interior.add(cradle);
  const scanner = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, 0.14, 8), mats.charcoal);
  scanner.position.set(COUNTER.registerX + 0.28, 1.15, COUNTER.z - 0.12);
  scanner.rotation.x = 0.5;
  interior.add(scanner);
  // card reader facing the customer
  const cardReader = new THREE.Mesh(roundedBox(0.12, 0.16, 0.09, 0.015), mats.charcoal);
  cardReader.position.set(COUNTER.registerX - 0.45, 1.12, COUNTER.z - 0.3);
  cardReader.rotation.x = -0.3;
  interior.add(cardReader);
  const cardScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.08, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x9fd6b4, emissive: 0x6fae86, emissiveIntensity: 0.8 }),
  );
  cardScreen.position.set(COUNTER.registerX - 0.45, 1.16, COUNTER.z - 0.345);
  cardScreen.rotation.x = -0.3;
  cardScreen.rotation.y = Math.PI;
  interior.add(cardScreen);
  // receipt printer
  const printer = new THREE.Mesh(roundedBox(0.2, 0.11, 0.18, 0.02), mats.charcoal);
  printer.position.set(COUNTER.registerX + 0.5, 1.1, COUNTER.z + 0.12);
  interior.add(printer);
  const slip = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.06), mats.trimPaint);
  slip.position.set(COUNTER.registerX + 0.5, 1.18, COUNTER.z + 0.1);
  slip.rotation.x = -0.5;
  interior.add(slip);
  // branded paper bags at the bagging end
  for (let i = 0; i < 3; i++) {
    const bag = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.34, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x1f4a26, roughness: 0.85 }),
    );
    bag.position.set(COUNTER.x + COUNTER.len / 2 - 0.3, 1.22, COUNTER.z + 0.14 - i * 0.05);
    bag.rotation.y = 0.2 + i * 0.06;
    interior.add(bag);
  }
  // cash drawer under the register: steel face, brass pull, till lip
  const drawerBody = new THREE.Mesh(roundedBox(0.4, 0.13, 0.34, 0.015), mats.charcoal);
  drawerBody.position.set(COUNTER.registerX, 0.985, COUNTER.z + 0.02);
  interior.add(drawerBody);
  const drawerFace = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.09, 0.015), new THREE.MeshStandardMaterial({ color: 0x3a4044, roughness: 0.45, metalness: 0.5 }));
  drawerFace.position.set(COUNTER.registerX, 0.985, COUNTER.z + 0.2);
  interior.add(drawerFace);
  const pull = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), mats.brass);
  pull.position.set(COUNTER.registerX, 0.975, COUNTER.z + 0.215);
  interior.add(pull);

  // counter divider on the customer side — marks where the next order starts
  const divider = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), mats.walnutDark);
  divider.position.set(COUNTER.registerX + 1.0, 1.09, COUNTER.z + 0.05);
  interior.add(divider);

  // a hand basket parked at the counter end
  const basket = new THREE.Group();
  const bBase = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.28), new THREE.MeshStandardMaterial({ color: 0x2e5a35, roughness: 0.7 }));
  bBase.position.y = 0.015;
  basket.add(bBase);
  for (const [w, d2, px, pz] of [[0.4, 0.02, 0, -0.13], [0.4, 0.02, 0, 0.13], [0.02, 0.28, -0.19, 0], [0.02, 0.28, 0.19, 0]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d2), new THREE.MeshStandardMaterial({ color: 0x2e5a35, roughness: 0.7, transparent: true, opacity: 0.85 }));
    wall.position.set(px, 0.11, pz);
    basket.add(wall);
  }
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), mats.charcoal);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, 0.26, 0);
  basket.add(handle);
  basket.position.set(COUNTER.x + COUNTER.len / 2 - 0.35, 1.055, COUNTER.z - 0.18);
  basket.rotation.y = -0.3;
  interior.add(basket);

  // impulse rack on the aisle end of the island (ref 4)
  for (const y of [0.45, 0.68]) {
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.3), mats.walnutDark);
    tray.position.set(COUNTER.x - COUNTER.len / 2 - 0.12, y, COUNTER.z);
    interior.add(tray);
    for (let i = 0; i < 3; i++) {
      const pack = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.12, 0.05),
        new THREE.MeshStandardMaterial({ color: [0x2e5a35, 0xc9a227, 0x7f9fc2][i], roughness: 0.7 }),
      );
      pack.position.set(COUNTER.x - COUNTER.len / 2 - 0.12, y + 0.07, COUNTER.z - 0.09 + i * 0.09);
      interior.add(pack);
    }
  }

  return { drawRegister };
}
