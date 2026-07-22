// CLUBHOUSE DOORS — real hinged slabs in real frames. Every doorway gets a jamb
// lining that fills the wall depth, a header, a threshold sill, and (where the
// swing is one-way) door stops — so a closed door is visually sealed: no slits,
// no light leak. The two service leaves park on their operational side: the
// stock door in the stockroom, the receiving door outside. This keeps freight
// and furnished-office aisles clear. The entry is architecturally inward (into
// the shop) and gently pushes a body out of its sweep instead of passing through
// it. The player operates doors with E — the only automatic opens are for
// customers (with the entrance bell) and for a player whose arms are full.

import * as THREE from 'three';
import { SHELL, DOOR_MAIN, DOOR_STOCK, DOOR_BACK } from '../../data/shopLayout.js';
import { chooseSwingAngle, hingeBearing, sweptBy, SWING } from '../../data/doorMath.js';
import { carriedBox } from '../../sim/deliveries.js';
import { carriedGoods } from '../../sim/stocking.js';
import { tutorialFlag } from '../../sim/tutorial.js';
import {
  ensureClubhouseArchitecture,
  setMainDoorState,
} from '../../sim/clubhouseRestoration.js';

const MAIN_DOOR_OPEN_RADIANS = 100 * Math.PI / 180;

export function armsFullForDoor(state) {
  return !!(carriedBox(state) || carriedGoods(state));
}

export function buildDoors(B) {
  const { group, mats, addCol, addProp, colBoxAt, L2W, W2L, FLOOR_TOP, state, hooks, walk, getCustomers } = B;
  const halfW = SHELL.w / 2 - SHELL.wallT / 2;
  const halfD = SHELL.d / 2 - SHELL.wallT / 2;
  const doors = [];

  const greenDeep = new THREE.MeshStandardMaterial({ color: 0x1f4a26, roughness: 0.5 });
  const greenPanel = new THREE.MeshStandardMaterial({ color: 0x193d20, roughness: 0.55 });
  // One fallback handle owns only the procedural main entrance. Service doors,
  // their collisions, and the shared interaction controller remain independent.
  const mainEntranceFallback = new THREE.Group();
  mainEntranceFallback.name = 'ProceduralMainEntranceFallback';
  group.add(mainEntranceFallback);
  let authoredMainEntranceRoot = null;
  let authoredMainEntrancePivots = null;

  // brass lever on a backplate, both faces
  function addLever(parent, x, y, z, along) {
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? 0.05 : 0.09, 0.2, along === 'x' ? 0.09 : 0.05), mats.brass);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.16, 8), mats.brass);
      lever.rotation.z = Math.PI / 2;
      if (along === 'x') {
        plate.position.set(x, y, z + side * 0.05);
        lever.position.set(x - 0.07, y, z + side * 0.065);
      } else {
        plate.position.set(x + side * 0.05, y, z);
        lever.rotation.y = Math.PI / 2;
        lever.position.set(x + side * 0.065, y, z - 0.07);
      }
      parent.add(plate, lever);
    }
  }

  // the glazed entry slab (built extending +x from its hinge edge)
  function buildEntrySlab(width, height, closedSign = 1) {
    const g = new THREE.Group();
    const t = 0.07;
    const stile = 0.13;
    const partsSpec = [
      { w: width, h: stile, x: width / 2, y: height - stile / 2 },          // top rail
      { w: width, h: 0.3, x: width / 2, y: 0.15 },                          // bottom rail
      { w: stile, h: height, x: stile / 2, y: height / 2 },                 // hinge stile
      { w: stile, h: height, x: width - stile / 2, y: height / 2 },         // latch stile
      { w: width, h: 0.12, x: width / 2, y: height * 0.42 },                // lock rail
    ];
    for (const p of partsSpec) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, t), greenDeep);
      m.position.set(p.x, p.y, 0);
      m.castShadow = true;
      g.add(m);
    }
    const panel = new THREE.Mesh(new THREE.BoxGeometry(width - stile * 2 - 0.06, height * 0.42 - 0.36, t * 0.75), greenPanel);
    panel.position.set(width / 2, (height * 0.42 + 0.3) / 2 - 0.02, 0);
    g.add(panel);
    // glazing above the lock rail: one pane + muntin cross = 4 lites
    const gw = width - stile * 2;
    const gh = height - stile - height * 0.42 - 0.06;
    const gy = height * 0.42 + 0.06 + gh / 2;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), mats.glass);
    glass.position.set(width / 2, gy, 0);
    g.add(glass);
    const mv = new THREE.Mesh(new THREE.BoxGeometry(0.045, gh, t * 0.8), greenDeep);
    mv.position.set(width / 2, gy, 0);
    g.add(mv);
    const mh = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.045, t * 0.8), greenDeep);
    mh.position.set(width / 2, gy, 0);
    g.add(mh);
    const kick = new THREE.Mesh(new THREE.BoxGeometry(width - stile * 2, 0.16, 0.012), mats.brass);
    kick.position.set(width / 2, 0.12, t / 2 + 0.004);
    g.add(kick);
    addLever(g, width - 0.16, 1.05, 0, 'x');
    // The right leaf grows toward -X from its outer hinge. Mirroring the entire
    // fallback slab keeps its hardware on the meeting edge; this branch is only
    // visible while the authored Asset 53 is unavailable.
    if (closedSign < 0) g.scale.x = -1;
    return g;
  }

  // 6-panel painted service slab (extending +x or +z from its hinge edge)
  function buildServiceSlab(width, height, along) {
    const g = new THREE.Group();
    const t = 0.06;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(along === 'x' ? width : t, height, along === 'x' ? t : width),
      mats.walnut,
    );
    slab.castShadow = true;
    if (along === 'x') slab.position.set(width / 2, height / 2, 0);
    else slab.position.set(0, height / 2, width / 2);
    g.add(slab);
    for (let col = 0; col < 2; col++) {
      for (let row = 0; row < 3; row++) {
        const pw = width * 0.34;
        const ph = height * 0.24;
        const px = width * (0.28 + col * 0.44);
        const py = height * (0.2 + row * 0.28);
        const inset = new THREE.Mesh(
          new THREE.BoxGeometry(along === 'x' ? pw : t + 0.012, ph, along === 'x' ? t + 0.012 : pw),
          mats.walnutDark,
        );
        if (along === 'x') inset.position.set(px, py, 0);
        else inset.position.set(0, py, px);
        g.add(inset);
      }
    }
    addLever(g, along === 'x' ? width - 0.14 : 0, 1.05, along === 'x' ? 0 : width - 0.14, along);
    return g;
  }

  // architrave casing on both wall faces (decorative surround)
  function addCasing({ cx, cz, along, w, h, mat, parent = group }) {
    for (const side of [-1, 1]) {
      const off = side * (SHELL.wallT / 2 + 0.03);
      const head = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? w + 0.3 : 0.06, 0.14, along === 'x' ? 0.06 : w + 0.3), mat);
      if (along === 'x') head.position.set(cx, FLOOR_TOP + h + 0.07, cz + off);
      else head.position.set(cx + off, FLOOR_TOP + h + 0.07, cz);
      parent.add(head);
      for (const end of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? 0.12 : 0.06, h + 0.1, along === 'x' ? 0.06 : 0.12), mat);
        if (along === 'x') jamb.position.set(cx + end * (w / 2 + 0.09), FLOOR_TOP + (h + 0.1) / 2, cz + off);
        else jamb.position.set(cx + off, FLOOR_TOP + (h + 0.1) / 2, cz + end * (w / 2 + 0.09));
        parent.add(jamb);
      }
    }
  }

  // the REAL frame: jambs lining the opening depth, header, threshold sill, and
  // optional stops on one face (for the one-way entry door). This is what makes
  // a closed door read sealed instead of floating in a raw hole.
  function addFrame({ cx, cz, along, w, h, mat, stopsSide = 0, sillMat, parent = group }) {
    const depth = SHELL.wallT + 0.02;
    const JAMB = 0.09;
    // side jambs — inside the opening, full height
    for (const end of [-1, 1]) {
      const jamb = new THREE.Mesh(
        new THREE.BoxGeometry(along === 'x' ? JAMB : depth, h, along === 'x' ? depth : JAMB),
        mat,
      );
      if (along === 'x') jamb.position.set(cx + end * (w / 2 - JAMB / 2), FLOOR_TOP + h / 2, cz);
      else jamb.position.set(cx, FLOOR_TOP + h / 2, cz + end * (w / 2 - JAMB / 2));
      parent.add(jamb);
    }
    // header across the top of the clear opening
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(along === 'x' ? w : depth, 0.1, along === 'x' ? depth : w),
      mat,
    );
    header.position.set(cx, FLOOR_TOP + h - 0.05, cz);
    parent.add(header);
    // threshold sill — slightly proud both faces, covers the floorless wall strip
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(along === 'x' ? w : depth + 0.12, 0.045, along === 'x' ? depth + 0.12 : w),
      sillMat || mat,
    );
    sill.position.set(cx, FLOOR_TOP + 0.0225, cz);
    parent.add(sill);
    // stops: thin strips the closed slab rests against (one-way doors only)
    if (stopsSide !== 0) {
      const t = 0.05; // slab-plane offset
      const off = stopsSide * t;
      const clear = w - JAMB * 2;
      for (const end of [-1, 1]) {
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(along === 'x' ? 0.035 : 0.05, h - 0.1, along === 'x' ? 0.05 : 0.035),
          mat,
        );
        if (along === 'x') strip.position.set(cx + end * (clear / 2 + 0.0175), FLOOR_TOP + (h - 0.1) / 2, cz + off);
        else strip.position.set(cx + off, FLOOR_TOP + (h - 0.1) / 2, cz + end * (clear / 2 + 0.0175));
        parent.add(strip);
      }
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(along === 'x' ? clear : 0.05, 0.035, along === 'x' ? 0.05 : clear),
        mat,
      );
      if (along === 'x') top.position.set(cx, FLOOR_TOP + h - 0.117, cz + off);
      else top.position.set(cx + off, FLOOR_TOP + h - 0.117, cz);
      parent.add(top);
    }
  }

  // door angular basis: position angle of a point around the hinge, measured so
  // that 0 = the closed slab direction and + matches positive hinge rotation
  const hingeAngleOf = (d, lx, lz) => hingeBearing(d, lx, lz); // shared with the occupancy rule

  function updateDoorCollider(d) {
    // AABB over the slab from hinge to tip at the current angle, padded
    const a = d.angle;
    const closedSign = d.closedSign === -1 ? -1 : 1;
    const dir = d.along === 'x'
      ? { x: closedSign * Math.cos(a), z: -closedSign * Math.sin(a) }
      : { x: closedSign * Math.sin(a), z: closedSign * Math.cos(a) };
    const tipX = d.lx + dir.x * d.slabW;
    const tipZ = d.lz + dir.z * d.slabW;
    const p1 = L2W(d.lx, d.lz);
    const p2 = L2W(tipX, tipZ);
    const pad = d.collisionPad;
    d.collider.minX = Math.min(p1.x, p2.x) - pad;
    d.collider.maxX = Math.max(p1.x, p2.x) + pad;
    d.collider.minZ = Math.min(p1.z, p2.z) - pad;
    d.collider.maxZ = Math.max(p1.z, p2.z) + pad;
  }

  function makeDoor({
    cx, cz, along, w, h, name, style, isMain = false, fixedSwing = 0,
    closedSign = 1, hingeLx = null, hingeLz = null, slabWOverride = null,
    visualParent = group, registerInteraction = true, mainLeaf = null,
  }) {
    const JAMB = 0.09;
    const clear = w - JAMB * 2;
    const slabW = Number.isFinite(slabWOverride) ? slabWOverride : clear - 0.015;
    const slabH = h - 0.16; // clears the header (top reveal hides behind the stops)
    // Service slabs are 6 cm thick. The former 12 cm radial pad produced a
    // 24 cm collision leaf even at ninety degrees and consumed the last usable
    // centimetres of the receiving opening for the visible freight crate.
    // Preserve the broader entrance buffer, but keep service collision close
    // to its authored geometry with a small safety allowance.
    const collisionPad = style === 'service' ? 0.055 : 0.12;
    // hinge at the low-coordinate jamb's inner face
    const lx = Number.isFinite(hingeLx)
      ? hingeLx
      : (along === 'x' ? cx - w / 2 + JAMB : cx);
    const lz = Number.isFinite(hingeLz)
      ? hingeLz
      : (along === 'x' ? cz : cz - w / 2 + JAMB);
    const hinge = new THREE.Group();
    hinge.position.set(lx, FLOOR_TOP + 0.048, lz);
    const slab = style === 'entry'
      ? buildEntrySlab(slabW, slabH, closedSign)
      : buildServiceSlab(slabW, slabH, along);
    if (style === 'entry' && along !== 'x') slab.rotation.y = -Math.PI / 2;
    hinge.add(slab);
    visualParent.add(hinge);

    const slabCenter = along === 'x'
      ? { x: lx + closedSign * slabW / 2, z: lz }
      : { x: lx, z: lz + closedSign * slabW / 2 };
    const collider = along === 'x'
      ? colBoxAt(slabCenter.x, slabCenter.z, slabW + collisionPad * 2, collisionPad * 2)
      : colBoxAt(slabCenter.x, slabCenter.z, collisionPad * 2, slabW + collisionPad * 2);
    collider.door = true; // nav grid ignores doors — they open for walkers
    addCol(collider);

    const door = {
      name, hinge, angle: 0, open: false, collider, isMain,
      along, lx, lz, slabW, fixedSwing, closedSign, mainLeaf, collisionPad,
      swingTarget: 0, lastNear: 0,
      world: L2W(slabCenter.x, slabCenter.z),
    };
    doors.push(door);

    // service doors swing away from whoever opens them; the entry keeps its
    // real-world inward swing (pure math shared with the tests)
    door.chooseSwing = (wx, wz) => {
      const lp = W2L(wx, wz);
      return chooseSwingAngle(door, lp.x, lp.z);
    };
    door.openFor = (wx, wz, holdAt = null) => {
      door.swingTarget = door.chooseSwing(wx, wz);
      door.open = true;
      // A controller may request the door before its actor reaches the short
      // automatic proximity gate. Supplying the shared scene clock prevents
      // the close timer from undoing that request one frame later.
      if (Number.isFinite(holdAt)) door.lastNear = Math.max(door.lastNear, holdAt);
    };

    const wp = L2W(slabCenter.x, slabCenter.z);
    if (registerInteraction) {
      addProp({
        x: wp.x, z: wp.z, r: 2.1,
        label: () => `${name} — [E] ${door.open ? 'close' : 'open'}`,
        action: () => {
          if (door.open) {
            const blocker = doorBlockedBy(door);
            if (blocker) {
              if (hooks.toast) {
                hooks.toast(blocker === 'customer'
                  ? 'Someone is still in the doorway.'
                  : 'A box is in the way of the door.', 'warn');
              }
              return; // the slab does not move through anyone
            }
            door.open = false;
          } else {
            door.openFor(walk.x, walk.z);
            if (door.isMain) {
              tutorialFlag(state, 'doorOpened');
              if (hooks.sfx) hooks.sfx('doorbell');
            }
          }
          if (hooks.sfx) hooks.sfx(door.open ? 'doorSwing' : 'doorShut');
        },
      });
    }
    return door;
  }

  // The entrance is one assembly with two real outer hinges and two analytic
  // leaf colliders. Normal controls operate both leaves together; the save
  // schema still retains independent leaf state for safe migration/debugging.
  const mainJamb = 0.09;
  const mainClear = DOOR_MAIN.w - mainJamb * 2;
  const mainLeafWidth = (mainClear - 0.02) / 2;
  const mainLeftHingeX = DOOR_MAIN.x - DOOR_MAIN.w / 2 + mainJamb;
  const mainRightHingeX = DOOR_MAIN.x + DOOR_MAIN.w / 2 - mainJamb;
  const mainDoor = makeDoor({
    cx: DOOR_MAIN.x, cz: halfD, along: 'x', w: DOOR_MAIN.w, h: DOOR_MAIN.h,
    name: 'Shop door', style: 'entry', isMain: true,
    fixedSwing: MAIN_DOOR_OPEN_RADIANS, closedSign: 1,
    hingeLx: mainLeftHingeX, hingeLz: halfD, slabWOverride: mainLeafWidth,
    visualParent: mainEntranceFallback, registerInteraction: false, mainLeaf: 'left',
  });
  const mainDoorRight = makeDoor({
    cx: DOOR_MAIN.x, cz: halfD, along: 'x', w: DOOR_MAIN.w, h: DOOR_MAIN.h,
    name: 'Shop door right leaf', style: 'entry', isMain: true,
    fixedSwing: -MAIN_DOOR_OPEN_RADIANS, closedSign: -1,
    hingeLx: mainRightHingeX, hingeLz: halfD, slabWOverride: mainLeafWidth,
    visualParent: mainEntranceFallback, registerInteraction: false, mainLeaf: 'right',
  });
  mainDoor.isMainPrimary = true;
  mainDoorRight.isMainFollower = true;
  mainDoor.leaves = [mainDoor, mainDoorRight];
  mainDoorRight.leaves = mainDoor.leaves;
  const mainWorld = L2W(DOOR_MAIN.x, halfD);
  mainDoor.world = mainWorld;
  mainDoorRight.world = mainWorld;

  const persistedMain = ensureClubhouseArchitecture(state)?.doors?.main;
  mainDoor.desiredOpen = persistedMain?.left === 'open';
  mainDoorRight.desiredOpen = persistedMain?.right === 'open';
  mainDoor.open = mainDoor.desiredOpen || mainDoorRight.desiredOpen;
  mainDoorRight.open = mainDoor.open;
  mainDoor.swingTarget = MAIN_DOOR_OPEN_RADIANS;
  mainDoorRight.swingTarget = -MAIN_DOOR_OPEN_RADIANS;

  function setMainAssemblyOpen(open, { persist = true } = {}) {
    const desired = Boolean(open);
    mainDoor.desiredOpen = desired;
    mainDoorRight.desiredOpen = desired;
    mainDoor.open = desired;
    mainDoorRight.open = desired;
    if (persist) setMainDoorState(state, desired ? 'open' : 'closed');
    return desired;
  }

  mainDoor.openFor = () => setMainAssemblyOpen(true);
  mainDoorRight.openFor = mainDoor.openFor;

  function toggleMainEntrance() {
    if (mainDoor.open) {
      const blocker = mainDoorBlockedBy();
      if (blocker) {
        if (hooks.toast) {
          hooks.toast(blocker === 'customer'
            ? 'Someone is still in the doorway.'
            : blocker === 'player'
              ? 'Step clear of the doorway first.'
              : 'A box is in the way of the door.', 'warn');
        }
        return false;
      }
      setMainAssemblyOpen(false);
    } else {
      setMainAssemblyOpen(true);
      tutorialFlag(state, 'doorOpened');
      if (hooks.sfx) hooks.sfx('doorbell');
    }
    if (hooks.sfx) hooks.sfx(mainDoor.open ? 'doorSwing' : 'doorShut');
    return true;
  }

  const mainInteraction = {
    x: mainWorld.x, z: mainWorld.z, r: 2.1,
    label: () => `Shop door — [E] ${mainDoor.open ? 'close' : 'open'}`,
    action: toggleMainEntrance,
  };
  addProp(mainInteraction);
  makeDoor({
    cx: DOOR_STOCK.x, cz: DOOR_STOCK.z, along: 'x', w: DOOR_STOCK.w, h: DOOR_STOCK.h,
    name: 'Stockroom door', style: 'service', fixedSwing: SWING,
  });
  makeDoor({
    cx: halfW, cz: DOOR_BACK.z, along: 'z', w: DOOR_BACK.w, h: DOOR_BACK.h,
    name: 'Receiving door', style: 'service', fixedSwing: SWING,
  });

  // frames (jambs/header/sill/stops) + surface casings
  addFrame({
    cx: DOOR_MAIN.x, cz: halfD, along: 'x', w: DOOR_MAIN.w, h: DOOR_MAIN.h,
    mat: mats.trimPaint, stopsSide: 1, sillMat: mats.walnut,
    parent: mainEntranceFallback,
  });
  addFrame({ cx: DOOR_STOCK.x, cz: DOOR_STOCK.z, along: 'x', w: DOOR_STOCK.w, h: DOOR_STOCK.h, mat: mats.walnut });
  addFrame({ cx: halfW, cz: DOOR_BACK.z, along: 'z', w: DOOR_BACK.w, h: DOOR_BACK.h, mat: mats.walnut });
  addCasing({
    cx: DOOR_MAIN.x, cz: halfD, along: 'x', w: DOOR_MAIN.w, h: DOOR_MAIN.h,
    mat: mats.trimPaint, parent: mainEntranceFallback,
  });
  addCasing({ cx: DOOR_STOCK.x, cz: DOOR_STOCK.z, along: 'x', w: DOOR_STOCK.w, h: DOOR_STOCK.h, mat: mats.walnut });
  addCasing({ cx: halfW, cz: DOOR_BACK.z, along: 'z', w: DOOR_BACK.w, h: DOOR_BACK.h, mat: mats.walnut });

  // per-customer motion memory: a door opens for someone HEADING through it, not
  // for anyone loitering at arm's length (that caused endless open/close flapping)
  const custMotion = new WeakMap();

  // "Never close through an actor." A door may only shut through empty air: not a customer
  // standing in it (too still to read as "heading through", too far to read as "in it"), not a
  // delivery box set down in the threshold, and not the player. The player used to be left to the
  // radial push-out below (which shoves them out of the arc); but that is a correction after the
  // fact, and the coarse 2.0yd proximity gate that also held the door misses the far tip of the
  // wide main door's swing (reach ~2.7yd from the door centre). So the player is an actor here
  // too, held by the same precise swept-arc test as everyone else; the push-out stays as a backstop.
  function doorBlockedBy(d) {
    if (walk.active) {
      const lp = W2L(walk.x, walk.z);
      if (sweptBy(d, lp.x, lp.z, walk.radius || 0.34)) return 'player';
    }
    for (const c of getCustomers()) {
      const lp = W2L(c.mesh.position.x, c.mesh.position.z);
      if (sweptBy(d, lp.x, lp.z, 0.32)) return 'customer';
    }
    const boxes = (state.shop && state.shop.deliveries && state.shop.deliveries.boxes) || [];
    for (const b of boxes) {
      if (b.loc !== 'world' || b.x === undefined) continue;
      const lp = W2L(b.x, b.z);
      if (sweptBy(d, lp.x, lp.z, 0.32)) return 'box';
    }
    return null;
  }

  function mainDoorBlockedBy() {
    for (const leaf of mainDoor.leaves) {
      const blocker = doorBlockedBy(leaf);
      if (blocker) return blocker;
    }
    return null;
  }

  function applyDoorVisualRotation(d) {
    d.hinge.rotation.y = d.angle;
    if (!d.authoredPivot) return;
    d.authoredPivot.rotation.y = d.angle;
    d.authoredPivot.matrixWorldNeedsUpdate = true;
    d.authoredPivot.updateMatrix?.();
  }

  function updateDoors(dt, now) {
    const customers = getCustomers();
    // A carton and its unpacked contents both occupy the player's hands. The
    // stockroom put-away helper deliberately owns E while goods are carried,
    // so service doors must recognise either load or the player can become
    // trapped between receiving and the sales floor after unboxing.
    const playerDeliveryLoad = walk.active
      ? (carriedBox(state) || carriedGoods(state))
      : null;
    const snaps = [];
    for (const c of customers) {
      const p = c.mesh.position;
      const prev = custMotion.get(c) || { x: p.x, z: p.z };
      snaps.push({ x: p.x, z: p.z, vx: p.x - prev.x, vz: p.z - prev.z });
      custMotion.set(c, { x: p.x, z: p.z });
    }
    for (const d of doors) {
      const playerDist = walk.active ? Math.hypot(walk.x - d.world.x, walk.z - d.world.z) : 99;
      const audible = walk.active && playerDist < 18;

      // customers use doors themselves (bell on the entrance)
      let custNear = false;
      if (!d.isMainFollower) {
        for (const s of snaps) {
          const dx = d.world.x - s.x;
          const dz = d.world.z - s.z;
          const dist = Math.hypot(dx, dz);
          const inDoorway = dist < 0.95; // mid-passage: hold it open, never close on them
          const heading = dist < 1.5 && (s.vx * dx + s.vz * dz) > 0.0004;
          if (inDoorway || heading) {
            custNear = true;
            if (!d.open) {
              d.openFor(s.x, s.z);
              if (audible && hooks.sfx) {
                hooks.sfx('doorSwing');
                if (d.isMain) hooks.sfx('doorbell');
              }
            }
            break;
          }
        }
        // Arms full: the service door swings for a carton or unpacked goods.
        if (walk.active && playerDist < 1.6 && !d.open && playerDeliveryLoad) {
          d.openFor(walk.x, walk.z);
          if (audible && hooks.sfx) hooks.sfx('doorSwing');
        }
      }

      // hold open while anyone lingers in it; close shortly after they clear — but never
      // through someone. A shopper reading a label in the doorway keeps it open as long as
      // they stand there.
      if (!d.isMainFollower) {
        const blocker = d.isMainPrimary ? mainDoorBlockedBy() : doorBlockedBy(d);
        if (custNear || (d.open && playerDist < 2.0) || (d.open && blocker)) d.lastNear = now;
        if (d.open && now - d.lastNear > 2.5) {
          if (d.isMainPrimary) setMainAssemblyOpen(false);
          else d.open = false;
          if (audible && hooks.sfx) hooks.sfx('doorShut');
        }
      }

      const target = d.mainLeaf
        ? (d.desiredOpen ? d.fixedSwing : 0)
        : (d.open ? d.swingTarget : 0);
      const prev = d.angle;
      d.angle += (target - d.angle) * Math.min(1, dt * 5.5);
      if (Math.abs(d.angle - prev) > 0.0005) {
        applyDoorVisualRotation(d);
        updateDoorCollider(d);
        // A full delivery box already triggers this door before contact and uses
        // the live slab collider. The body-only radial correction would otherwise
        // shove a long carried profile sideways into the opposite jamb.
        if (walk.active && !playerDeliveryLoad && Math.abs(d.angle) > 0.05) {
          const lp = W2L(walk.x, walk.z);
          const dx = lp.x - d.lx;
          const dz = lp.z - d.lz;
          const dist = Math.hypot(dx, dz);
          if (dist < d.slabW + 0.35 && dist > 0.001) {
            const psi = hingeAngleOf(d, lp.x, lp.z);
            const t = psi / (d.angle || 0.001);
            if (t > -0.06 && t < 1.15) {
              const push = (d.slabW + 0.38 - dist) * Math.min(1, dt * 10);
              const wp1 = L2W(d.lx, d.lz);
              const nx = (walk.x - wp1.x) / dist;
              const nz = (walk.z - wp1.z) / dist;
              walk.x += nx * push;
              walk.z += nz * push;
            }
          }
        }
      }
    }
  }

  function findNamed(root, name) {
    if (!root) return null;
    const direct = root.getObjectByName?.(name);
    if (direct) return direct;
    let found = null;
    root.traverse?.((node) => {
      if (!found && String(node?.name || '') === name) found = node;
    });
    return found;
  }

  function bindMainEntranceVisual(root) {
    if (!root) return Object.freeze({ ok: false, reason: 'missing-root' });
    const left = findNamed(root, 'PIVOT_DoorLeft') || findNamed(root, 'DOOR_MAIN_LEFT');
    const right = findNamed(root, 'PIVOT_DoorRight') || findNamed(root, 'DOOR_MAIN_RIGHT');
    if (!left || !right || left === right) {
      return Object.freeze({ ok: false, reason: 'missing-double-leaf-pivots' });
    }
    authoredMainEntranceRoot = root;
    authoredMainEntrancePivots = { left, right };
    // Rebase the analytic door contract onto the authored municipal hinges.
    // This shell is intentionally smaller than the legacy retail plan, while
    // checkout/save coordinates must remain untouched for migration safety.
    root.updateWorldMatrix?.(true, true);
    group.updateWorldMatrix?.(true, false);
    const leftLocal = group.worldToLocal(left.getWorldPosition(new THREE.Vector3()));
    const rightLocal = group.worldToLocal(right.getWorldPosition(new THREE.Vector3()));
    const centreX = (leftLocal.x + rightLocal.x) / 2;
    const centreZ = (leftLocal.z + rightLocal.z) / 2;
    mainDoor.lx = leftLocal.x;
    mainDoor.lz = leftLocal.z;
    mainDoorRight.lx = rightLocal.x;
    mainDoorRight.lz = rightLocal.z;
    mainDoor.slabW = Math.hypot(rightLocal.x - leftLocal.x, rightLocal.z - leftLocal.z) / 2;
    mainDoorRight.slabW = mainDoor.slabW;
    const authoredWorld = L2W(centreX, centreZ);
    mainDoor.world = authoredWorld;
    mainDoorRight.world = authoredWorld;
    mainInteraction.x = authoredWorld.x;
    mainInteraction.z = authoredWorld.z;
    mainDoor.authoredPivot = left;
    mainDoorRight.authoredPivot = right;
    applyDoorVisualRotation(mainDoor);
    applyDoorVisualRotation(mainDoorRight);
    mainEntranceFallback.visible = false;
    root.userData.sheet06LiveDoorController = true;
    root.userData.sheet06DoorCollisionAuthority = 'ANALYTIC_DOUBLE_LEAF';
    return Object.freeze({ ok: true, leafCount: 2 });
  }

  function unbindMainEntranceVisual({ restoreFallback = true } = {}) {
    const wasBound = Boolean(authoredMainEntranceRoot);
    if (authoredMainEntranceRoot?.userData) {
      authoredMainEntranceRoot.userData.sheet06LiveDoorController = false;
    }
    mainDoor.authoredPivot = null;
    mainDoorRight.authoredPivot = null;
    authoredMainEntranceRoot = null;
    authoredMainEntrancePivots = null;
    if (restoreFallback) mainEntranceFallback.visible = true;
    return Object.freeze({ wasBound, fallbackVisible: mainEntranceFallback.visible });
  }

  function syncMainEntranceFromState() {
    const persisted = ensureClubhouseArchitecture(state)?.doors?.main;
    if (!persisted) return Object.freeze({ ok: false });
    mainDoor.desiredOpen = persisted.left === 'open';
    mainDoorRight.desiredOpen = persisted.right === 'open';
    mainDoor.open = mainDoor.desiredOpen || mainDoorRight.desiredOpen;
    mainDoorRight.open = mainDoor.open;
    return Object.freeze({
      ok: true,
      left: mainDoor.desiredOpen ? 'open' : 'closed',
      right: mainDoorRight.desiredOpen ? 'open' : 'closed',
    });
  }

  function mainEntranceDiagnostics() {
    return Object.freeze({
      authoredBound: Boolean(authoredMainEntranceRoot),
      authoredPivotCount: authoredMainEntrancePivots ? 2 : 0,
      proceduralFallbackVisible: mainEntranceFallback.visible,
      leafCount: mainDoor.leaves.length,
      colliderCount: mainDoor.leaves.filter((leaf) => leaf.collider).length,
      leftAngle: mainDoor.angle,
      rightAngle: mainDoorRight.angle,
      leftState: mainDoor.desiredOpen ? 'open' : 'closed',
      rightState: mainDoorRight.desiredOpen ? 'open' : 'closed',
      interactionX: mainInteraction.x,
      interactionZ: mainInteraction.z,
    });
  }

  return {
    doors,
    mainDoor,
    mainEntranceFallback,
    updateDoors,
    bindMainEntranceVisual,
    unbindMainEntranceVisual,
    syncMainEntranceFromState,
    toggleMainEntrance,
    mainEntranceIsOpen: () => Boolean(mainDoor.open),
    mainEntranceDiagnostics,
  };
}
