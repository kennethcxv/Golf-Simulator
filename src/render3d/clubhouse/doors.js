// CLUBHOUSE DOORS — real hinged slabs in real frames. Every doorway gets a jamb
// lining that fills the wall depth, a header, a threshold sill, and (where the
// swing is one-way) door stops — so a closed door is visually sealed: no slits,
// no light leak. Swing direction is chosen when the door opens: service doors
// swing AWAY from whoever opens them; the entry door is architecturally inward
// (into the shop) and gently pushes a body out of its sweep instead of passing
// through it. The player operates doors with E — the only automatic opens are
// for customers (with the entrance bell) and for a player whose arms are full.

import * as THREE from 'three';
import { SHELL, DOOR_MAIN, DOOR_STOCK, DOOR_BACK } from '../../data/shopLayout.js';
import { chooseSwingAngle, hingeBearing, sweptBy } from '../../data/doorMath.js';
import { carriedBox } from '../../sim/deliveries.js';
import { carriedGoods } from '../../sim/stocking.js';
import { tutorialFlag } from '../../sim/tutorial.js';

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
  function buildEntrySlab(width, height) {
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
  function addCasing({ cx, cz, along, w, h, mat }) {
    for (const side of [-1, 1]) {
      const off = side * (SHELL.wallT / 2 + 0.03);
      const head = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? w + 0.3 : 0.06, 0.14, along === 'x' ? 0.06 : w + 0.3), mat);
      if (along === 'x') head.position.set(cx, FLOOR_TOP + h + 0.07, cz + off);
      else head.position.set(cx + off, FLOOR_TOP + h + 0.07, cz);
      group.add(head);
      for (const end of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? 0.12 : 0.06, h + 0.1, along === 'x' ? 0.06 : 0.12), mat);
        if (along === 'x') jamb.position.set(cx + end * (w / 2 + 0.09), FLOOR_TOP + (h + 0.1) / 2, cz + off);
        else jamb.position.set(cx + off, FLOOR_TOP + (h + 0.1) / 2, cz + end * (w / 2 + 0.09));
        group.add(jamb);
      }
    }
  }

  // the REAL frame: jambs lining the opening depth, header, threshold sill, and
  // optional stops on one face (for the one-way entry door). This is what makes
  // a closed door read sealed instead of floating in a raw hole.
  function addFrame({ cx, cz, along, w, h, mat, stopsSide = 0, sillMat }) {
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
      group.add(jamb);
    }
    // header across the top of the clear opening
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(along === 'x' ? w : depth, 0.1, along === 'x' ? depth : w),
      mat,
    );
    header.position.set(cx, FLOOR_TOP + h - 0.05, cz);
    group.add(header);
    // threshold sill — slightly proud both faces, covers the floorless wall strip
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(along === 'x' ? w : depth + 0.12, 0.045, along === 'x' ? depth + 0.12 : w),
      sillMat || mat,
    );
    sill.position.set(cx, FLOOR_TOP + 0.0225, cz);
    group.add(sill);
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
        group.add(strip);
      }
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(along === 'x' ? clear : 0.05, 0.035, along === 'x' ? 0.05 : clear),
        mat,
      );
      if (along === 'x') top.position.set(cx, FLOOR_TOP + h - 0.117, cz + off);
      else top.position.set(cx + off, FLOOR_TOP + h - 0.117, cz);
      group.add(top);
    }
  }

  // door angular basis: position angle of a point around the hinge, measured so
  // that 0 = the closed slab direction and + matches positive hinge rotation
  const hingeAngleOf = (d, lx, lz) => hingeBearing(d, lx, lz); // shared with the occupancy rule

  function updateDoorCollider(d) {
    // AABB over the slab from hinge to tip at the current angle, padded
    const a = d.angle;
    const dir = d.along === 'x' ? { x: Math.cos(a), z: -Math.sin(a) } : { x: Math.sin(a), z: Math.cos(a) };
    const tipX = d.lx + dir.x * d.slabW;
    const tipZ = d.lz + dir.z * d.slabW;
    const p1 = L2W(d.lx, d.lz);
    const p2 = L2W(tipX, tipZ);
    const pad = 0.12;
    d.collider.minX = Math.min(p1.x, p2.x) - pad;
    d.collider.maxX = Math.max(p1.x, p2.x) + pad;
    d.collider.minZ = Math.min(p1.z, p2.z) - pad;
    d.collider.maxZ = Math.max(p1.z, p2.z) + pad;
  }

  function makeDoor({ cx, cz, along, w, h, name, style, isMain = false, fixedSwing = 0 }) {
    const JAMB = 0.09;
    const clear = w - JAMB * 2;
    const slabW = clear - 0.015;
    const slabH = h - 0.16; // clears the header (top reveal hides behind the stops)
    // hinge at the low-coordinate jamb's inner face
    const lx = along === 'x' ? cx - w / 2 + JAMB : cx;
    const lz = along === 'x' ? cz : cz - w / 2 + JAMB;
    const hinge = new THREE.Group();
    hinge.position.set(lx, FLOOR_TOP + 0.048, lz);
    const slab = style === 'entry' ? buildEntrySlab(slabW, slabH) : buildServiceSlab(slabW, slabH, along);
    if (style === 'entry' && along !== 'x') slab.rotation.y = -Math.PI / 2;
    hinge.add(slab);
    group.add(hinge);

    const slabCenter = along === 'x' ? { x: lx + slabW / 2, z: lz } : { x: lx, z: lz + slabW / 2 };
    const collider = along === 'x'
      ? colBoxAt(slabCenter.x, slabCenter.z, slabW + 0.24, 0.24)
      : colBoxAt(slabCenter.x, slabCenter.z, 0.24, slabW + 0.24);
    collider.door = true; // nav grid ignores doors — they open for walkers
    addCol(collider);

    const door = {
      name, hinge, angle: 0, open: false, collider, isMain,
      along, lx, lz, slabW, fixedSwing,
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
    door.openFor = (wx, wz) => {
      door.swingTarget = door.chooseSwing(wx, wz);
      door.open = true;
    };

    const wp = L2W(slabCenter.x, slabCenter.z);
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
    return door;
  }

  // entry: inward (north into the shop, resting toward the west wall)
  const mainDoor = makeDoor({
    cx: DOOR_MAIN.x, cz: halfD, along: 'x', w: DOOR_MAIN.w, h: DOOR_MAIN.h,
    name: 'Shop door', style: 'entry', isMain: true, fixedSwing: 1.92,
  });
  makeDoor({
    cx: DOOR_STOCK.x, cz: DOOR_STOCK.z, along: 'x', w: DOOR_STOCK.w, h: DOOR_STOCK.h,
    name: 'Stockroom door', style: 'service',
  });
  makeDoor({
    cx: halfW, cz: DOOR_BACK.z, along: 'z', w: DOOR_BACK.w, h: DOOR_BACK.h,
    name: 'Receiving door', style: 'service',
  });

  // frames (jambs/header/sill/stops) + surface casings
  addFrame({ cx: DOOR_MAIN.x, cz: halfD, along: 'x', w: DOOR_MAIN.w, h: DOOR_MAIN.h, mat: mats.trimPaint, stopsSide: 1, sillMat: mats.walnut });
  addFrame({ cx: DOOR_STOCK.x, cz: DOOR_STOCK.z, along: 'x', w: DOOR_STOCK.w, h: DOOR_STOCK.h, mat: mats.walnut });
  addFrame({ cx: halfW, cz: DOOR_BACK.z, along: 'z', w: DOOR_BACK.w, h: DOOR_BACK.h, mat: mats.walnut });
  addCasing({ cx: DOOR_MAIN.x, cz: halfD, along: 'x', w: DOOR_MAIN.w, h: DOOR_MAIN.h, mat: mats.trimPaint });
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

  function updateDoors(dt, now) {
    const customers = getCustomers();
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
      // A carton and an unpacked armful both occupy E with their carry/drop
      // action. Service doors therefore open for either kind of full hands;
      // otherwise unpacked stock can never leave the stockroom normally.
      if (walk.active && playerDist < 1.6 && !d.open && armsFullForDoor(state)) {
        d.openFor(walk.x, walk.z);
        if (audible && hooks.sfx) hooks.sfx('doorSwing');
      }

      // hold open while anyone lingers in it; close shortly after they clear — but never
      // through someone. A shopper reading a label in the doorway keeps it open as long as
      // they stand there.
      if (custNear || (d.open && playerDist < 2.0) || (d.open && doorBlockedBy(d))) d.lastNear = now;
      if (d.open && now - d.lastNear > 2.5) {
        d.open = false;
        if (audible && hooks.sfx) hooks.sfx('doorShut');
      }

      const target = d.open ? d.swingTarget : 0;
      const prev = d.angle;
      d.angle += (target - d.angle) * Math.min(1, dt * 5.5);
      if (Math.abs(d.angle - prev) > 0.0005) {
        d.hinge.rotation.y = d.angle;
        updateDoorCollider(d);
        // never sweep through the player: radial push out of the moving slab's arc
        if (walk.active && Math.abs(d.angle) > 0.05) {
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

  return { doors, mainDoor, updateDoors };
}
