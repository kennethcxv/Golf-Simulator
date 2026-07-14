// CLUBHOUSE DOORS — real hinged slabs that block when shut and swing on E.
// The entry is the reference's deep-green glazed door (4 lites over a raised
// panel, brass lever, kick plate); service doors are 6-panel walnut. Swing,
// auto-open (customers + full arms), auto-close, and collider toggling carry
// over verbatim from the proven monolith implementation.

import * as THREE from 'three';
import { SHELL, DOOR_MAIN, DOOR_STOCK, DOOR_BACK } from '../../data/shopLayout.js';
import { carriedBox } from '../../sim/deliveries.js';

export function buildDoors(B) {
  const { group, mats, addCol, removeCol, addProp, colBoxAt, L2W, FLOOR_TOP, state, hooks, walk, getCustomers } = B;
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

  // the glazed entry slab
  function buildEntrySlab(width, height) {
    const g = new THREE.Group();
    const t = 0.07;
    const stile = 0.13;
    // outer frame
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
    // raised lower panel
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
    // brass kick plate, outside face
    const kick = new THREE.Mesh(new THREE.BoxGeometry(width - stile * 2, 0.16, 0.012), mats.brass);
    kick.position.set(width / 2, 0.12, t / 2 + 0.004);
    g.add(kick);
    addLever(g, width - 0.16, 1.05, 0, 'x');
    return g;
  }

  // 6-panel painted service slab
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
    // inset panels (2 cols × 3 rows), both faces read the recess
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

  // architrave casing around a doorway (both faces)
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

  function makeDoor({ lx, lz, along, width, height, openSign, name, style, autoFor = 'both', isMain = false }) {
    const hinge = new THREE.Group();
    hinge.position.set(lx, FLOOR_TOP, lz);
    const slab = style === 'entry' ? buildEntrySlab(width, height - 0.04) : buildServiceSlab(width, height - 0.04, along);
    if (style === 'entry' && along === 'x') {
      // entry slab is built in the x-along frame already
    } else if (style === 'entry') {
      slab.rotation.y = -Math.PI / 2;
    }
    hinge.add(slab);
    group.add(hinge);

    const slabCenter = along === 'x' ? { x: lx + width / 2, z: lz } : { x: lx, z: lz + width / 2 };
    const collider = along === 'x'
      ? colBoxAt(slabCenter.x, slabCenter.z, width, 0.3)
      : colBoxAt(slabCenter.x, slabCenter.z, 0.3, width);
    addCol(collider);

    const door = {
      name, hinge, angle: 0, open: false, openSign, collider, colliderOn: true,
      autoFor, lastNear: 0, isMain,
      world: L2W(slabCenter.x, slabCenter.z),
      openAngle: openSign * 1.92,
    };
    doors.push(door);

    const wp = L2W(slabCenter.x, slabCenter.z);
    addProp({
      x: wp.x, z: wp.z, r: 2.1,
      label: () => `${name} — [E] ${door.open ? 'close' : 'open'}`,
      action: () => {
        door.open = !door.open;
        if (hooks.sfx) hooks.sfx(door.open ? 'doorSwing' : 'doorShut');
      },
    });
    return door;
  }

  const mainDoor = makeDoor({
    lx: DOOR_MAIN.hingeX, lz: halfD, along: 'x', width: DOOR_MAIN.w - 0.1, height: DOOR_MAIN.h,
    openSign: -1, name: 'Shop door', style: 'entry', isMain: true,
  });
  makeDoor({
    lx: DOOR_STOCK.hingeX, lz: 2.0, along: 'x', width: DOOR_STOCK.w - 0.06, height: DOOR_STOCK.h,
    openSign: 1, name: 'Stockroom door', style: 'service',
  });
  makeDoor({
    lx: halfW, lz: DOOR_BACK.hingeZ, along: 'z', width: DOOR_BACK.w - 0.08, height: DOOR_BACK.h,
    openSign: 1, name: 'Receiving door', style: 'service',
  });

  addCasing({ cx: DOOR_MAIN.x, cz: halfD, along: 'x', w: DOOR_MAIN.w, h: DOOR_MAIN.h, mat: mats.trimPaint });
  addCasing({ cx: DOOR_STOCK.x, cz: 2.0, along: 'x', w: DOOR_STOCK.w, h: DOOR_STOCK.h, mat: mats.walnut });
  addCasing({ cx: halfW, cz: DOOR_BACK.z, along: 'z', w: DOOR_BACK.w, h: DOOR_BACK.h, mat: mats.walnut });

  function updateDoors(dt, now) {
    const customers = getCustomers();
    for (const d of doors) {
      // customers can't press E — the door swings for them; it also closes
      // itself once nobody has been near it for a few seconds
      let near = false;
      if (walk.active && Math.hypot(walk.x - d.world.x, walk.z - d.world.z) < 2.2) {
        near = true;
        // arms full of delivery box: the door swings for you too
        if (!d.open && carriedBox(state)) d.open = true;
      }
      let custNear = false;
      for (const c of customers) {
        if (Math.hypot(c.mesh.position.x - d.world.x, c.mesh.position.z - d.world.z) < 1.5) {
          custNear = true;
          break;
        }
      }
      const audible = walk.active && Math.hypot(walk.x - d.world.x, walk.z - d.world.z) < 18;
      if (custNear && !d.open) {
        d.open = true;
        if (audible && hooks.sfx) {
          hooks.sfx('doorSwing');
          if (d.isMain) hooks.sfx('doorbell'); // the entrance bell greets shoppers
        }
      }
      if (near || custNear) d.lastNear = now;
      if (d.open && now - d.lastNear > 5) {
        d.open = false;
        if (audible && hooks.sfx) hooks.sfx('doorShut');
      }

      const target = d.open ? d.openAngle : 0;
      d.angle += (target - d.angle) * Math.min(1, dt * 5.5);
      d.hinge.rotation.y = d.angle;
      const passable = Math.abs(d.angle) > 0.55;
      if (passable && d.colliderOn) {
        removeCol(d.collider);
        d.colliderOn = false;
      } else if (!passable && !d.colliderOn && Math.abs(d.angle) < 0.35) {
        addCol(d.collider);
        d.colliderOn = true;
      }
    }
  }

  return { doors, mainDoor, updateDoors };
}
