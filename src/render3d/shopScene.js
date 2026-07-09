// FAIRWAY STATE — the walkable pro shop: a bounded first-person interior.
// WASD + pointer-lock look (arrow keys as fallback), circle-vs-AABB collision,
// shelves whose stacks ARE the live inventory, and customers whose presence
// reflects the day's real shopper flow. A window onto the shop sim — the sim
// itself stays headless in src/sim/shop.js.

import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { SHOP_CATALOG, SHELF_CAP } from '../data/shopItems.js';
import { restockShelfFromBackroom } from '../sim/shop.js';
import { makeWoodTexture, makePlasterTexture } from './proceduralTextures.js';
import { rngOf } from '../core/utils.js';

// room: x ∈ [-7, 7], z ∈ [-5, 5] yards; door at south (z = +5)
const ROOM = { w: 14, d: 10, h: 3.4 };
const EYE = 1.7;

const CAT_COLORS = { balls: 0xf3f0e4, accessories: 0xc9a55a, apparel: 0x7f9fc2, clubs: 0x9a8265 };

export function makeShopScene(renderer, appRef) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a140e);
  const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 200);

  const player = {
    x: 0, z: 3.6, yaw: 0, pitch: 0, // just inside the door, facing into the shop
    speed: 3.1,
  };

  const colliders = []; // {minX, maxX, minZ, maxZ}
  const interactives = []; // {kind, skuIds?, mesh, label(), action(), point}

  // --- room shell -----------------------------------------------------------------
  const woodTex = makeWoodTexture({});
  woodTex.repeat.set(4, 3);
  const plasterTex = makePlasterTexture({});
  plasterTex.repeat.set(6, 2);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.7 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    new THREE.MeshStandardMaterial({ color: 0x6b6156, roughness: 0.95 }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ROOM.h;
  scene.add(ceil);

  const wallMat = new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.92 });
  const walls = [
    { w: ROOM.w, x: 0, z: -ROOM.d / 2, ry: 0 },
    { w: ROOM.w, x: 0, z: ROOM.d / 2, ry: Math.PI },
    { w: ROOM.d, x: -ROOM.w / 2, z: 0, ry: Math.PI / 2 },
    { w: ROOM.d, x: ROOM.w / 2, z: 0, ry: -Math.PI / 2 },
  ];
  for (const spec of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, ROOM.h), wallMat);
    wall.position.set(spec.x, ROOM.h / 2, spec.z);
    wall.rotation.y = spec.ry;
    scene.add(wall);
  }
  // wall colliders (thick)
  colliders.push(
    { minX: -ROOM.w / 2 - 1, maxX: ROOM.w / 2 + 1, minZ: -ROOM.d / 2 - 1, maxZ: -ROOM.d / 2 },
    { minX: -ROOM.w / 2 - 1, maxX: ROOM.w / 2 + 1, minZ: ROOM.d / 2, maxZ: ROOM.d / 2 + 1 },
    { minX: -ROOM.w / 2 - 1, maxX: -ROOM.w / 2, minZ: -ROOM.d / 2 - 1, maxZ: ROOM.d / 2 + 1 },
    { minX: ROOM.w / 2, maxX: ROOM.w / 2 + 1, minZ: -ROOM.d / 2 - 1, maxZ: ROOM.d / 2 + 1 },
  );

  // windows (emissive daylight planes) + door
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xbcd8ee });
  for (const wx of [-4.2, 0, 4.2]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), windowMat);
    win.position.set(wx, 1.9, -ROOM.d / 2 + 0.02);
    scene.add(win);
  }
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 2.5),
    new THREE.MeshStandardMaterial({ color: 0x5d4a33, roughness: 0.8 }),
  );
  door.position.set(0, 1.25, ROOM.d / 2 - 0.02);
  door.rotation.y = Math.PI;
  scene.add(door);
  interactives.push({
    kind: 'door',
    point: new THREE.Vector3(0, 1.3, ROOM.d / 2),
    label: () => 'Head back out to the course',
    action: () => appRef.exitShop(),
  });

  // --- lighting ----------------------------------------------------------------------
  scene.add(new THREE.AmbientLight(0xfff2dd, 0.55));
  const winLight = new THREE.DirectionalLight(0xcfe4f5, 1.4);
  winLight.position.set(0, 2.6, -8);
  scene.add(winLight);
  for (const lx of [-3.6, 3.6]) {
    const bulb = new THREE.PointLight(0xffe2b0, 26, 14, 1.6);
    bulb.position.set(lx, ROOM.h - 0.25, 0);
    bulb.castShadow = true;
    bulb.shadow.mapSize.set(512, 512);
    scene.add(bulb);
    const fixture = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.34, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0x2c2620, emissive: 0xffe2b0, emissiveIntensity: 0.7 }),
    );
    fixture.position.set(lx, ROOM.h - 0.1, 0);
    scene.add(fixture);
  }

  // --- fixtures + live stock ------------------------------------------------------------
  const stockGroup = new THREE.Group();
  scene.add(stockGroup);
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e563c, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x463a2b, roughness: 0.85 });

  function addCollider(cx, cz, w, d) {
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  }

  function shelfUnit(cx, cz, ry, skuIds, title) {
    const g = new THREE.Group();
    // hollow unit: back panel + sides + boards, so the stock actually shows
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.1, 0.06), woodMat);
    back.position.set(0, 1.05, -0.2);
    back.castShadow = true;
    g.add(back);
    for (const sx of [-1.47, 1.47]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 0.5), woodMat);
      side.position.set(sx, 1.05, 0.02);
      g.add(side);
    }
    for (const y of [0.5, 1.05, 1.6]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.05, 0.44), darkMat);
      board.position.y = y;
      board.position.z = 0.02;
      g.add(board);
    }
    g.position.set(cx, 0, cz);
    g.rotation.y = ry;
    scene.add(g);
    const w = Math.abs(ry % Math.PI) < 0.1 ? 3.0 : 0.5;
    const d = Math.abs(ry % Math.PI) < 0.1 ? 0.5 : 3.0;
    addCollider(cx, cz, w + 0.2, d + 0.2);
    interactives.push({
      kind: 'shelf',
      skuIds,
      point: new THREE.Vector3(cx, 1.2, cz),
      label: () => shelfLabel(skuIds, title),
      action: () => restockAll(skuIds, title),
    });
    return g;
  }

  function rackUnit(cx, cz, ry, skuIds, title) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.9), woodMat);
    base.position.y = 0.07;
    base.castShadow = true;
    g.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.9, 0.08), darkMat);
    back.position.set(0, 1.0, -0.4);
    g.add(back);
    g.position.set(cx, 0, cz);
    g.rotation.y = ry;
    scene.add(g);
    addCollider(cx, cz, Math.abs(Math.sin(ry)) > 0.5 ? 1.0 : 2.8, Math.abs(Math.sin(ry)) > 0.5 ? 2.8 : 1.0);
    interactives.push({
      kind: 'shelf',
      skuIds,
      point: new THREE.Vector3(cx, 1.2, cz),
      label: () => shelfLabel(skuIds, title),
      action: () => restockAll(skuIds, title),
    });
    return g;
  }

  function tableUnit(cx, cz, skuIds, title) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 1.4), woodMat);
    top.position.y = 0.95;
    top.castShadow = true;
    g.add(top);
    for (const [lx, lz] of [[-0.95, -0.55], [0.95, -0.55], [-0.95, 0.55], [0.95, 0.55]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.1), darkMat);
      leg.position.set(lx, 0.47, lz);
      g.add(leg);
    }
    g.position.set(cx, 0, cz);
    scene.add(g);
    addCollider(cx, cz, 2.4, 1.6);
    interactives.push({
      kind: 'shelf',
      skuIds,
      point: new THREE.Vector3(cx, 1.1, cz),
      label: () => shelfLabel(skuIds, title),
      action: () => restockAll(skuIds, title),
    });
    return g;
  }

  // layout
  const FIXTURES = [];
  FIXTURES.push({ skus: ['balls1', 'balls2', 'balls3'], anchor: shelfUnit(-2.2, -ROOM.d / 2 + 0.45, 0, ['balls1', 'balls2', 'balls3'], 'Ball wall') });
  FIXTURES.push({ skus: ['tees1', 'towel1', 'marker1', 'range2'], anchor: shelfUnit(2.2, -ROOM.d / 2 + 0.45, 0, ['tees1', 'towel1', 'marker1', 'range2'], 'Accessories') });
  FIXTURES.push({ skus: ['driver1', 'driver2', 'driver3', 'wedge1', 'wedge2'], anchor: rackUnit(-ROOM.w / 2 + 0.75, -1.6, Math.PI / 2, ['driver1', 'driver2', 'driver3', 'wedge1', 'wedge2'], 'Driver & wedge rack') });
  FIXTURES.push({ skus: ['irons1', 'irons2', 'putter1', 'putter2'], anchor: rackUnit(-ROOM.w / 2 + 0.75, 1.6, Math.PI / 2, ['irons1', 'irons2', 'putter1', 'putter2'], 'Iron & putter rack') });
  FIXTURES.push({ skus: ['glove1', 'polo1', 'polo2', 'cap1', 'jacket2'], anchor: tableUnit(-0.6, 0.4, ['glove1', 'polo1', 'polo2', 'cap1', 'jacket2'], 'Apparel table') });

  // counter + register (east)
  const counter = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.05, 3.2), woodMat);
  counter.position.set(ROOM.w / 2 - 1.3, 0.53, 1.4);
  counter.castShadow = true;
  scene.add(counter);
  addCollider(ROOM.w / 2 - 1.3, 1.4, 1.1, 3.4);
  const register = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.5), new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.4 }));
  register.position.set(ROOM.w / 2 - 1.3, 1.22, 0.6);
  scene.add(register);
  interactives.push({
    kind: 'counter',
    point: new THREE.Vector3(ROOM.w / 2 - 1.3, 1.1, 1.4),
    label: () => {
      const s = appRef.app.state.shop;
      return `Register — yesterday: ${s.salesYesterday.units} sales, ${s.salesYesterday.revenue} dollars` +
        (s.lostSalesYesterday ? ` · ${s.lostSalesYesterday} walked out empty-handed` : '');
    },
    action: () => {},
  });

  // fitting bay (NE corner)
  const mat = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.04, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x2e5230, roughness: 0.9 }),
  );
  mat.position.set(ROOM.w / 2 - 1.6, 0.02, -ROOM.d / 2 + 1.3);
  scene.add(mat);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x111418, emissive: 0x2a3d55, emissiveIntensity: 0.8 }),
  );
  screen.position.set(ROOM.w / 2 - 0.06, 1.7, -ROOM.d / 2 + 1.3);
  screen.rotation.y = -Math.PI / 2;
  scene.add(screen);
  interactives.push({
    kind: 'fitting',
    point: new THREE.Vector3(ROOM.w / 2 - 1.4, 1.2, -ROOM.d / 2 + 1.3),
    label: () => {
      const n = appRef.app.state.shop.fittingsYesterday;
      return `Fitting bay — ${n ? `${n} fitting${n > 1 ? 's' : ''} yesterday` : 'book a pro to run fittings'}`;
    },
    action: () => {},
  });

  // --- live stock visualization -----------------------------------------------------------
  const stockMeshes = new Map(); // skuId -> Group

  function rebuildStock() {
    for (const g of stockMeshes.values()) stockGroup.remove(g);
    stockMeshes.clear();
    const inv = appRef.app.state.shop.inventory;

    for (const fixture of FIXTURES) {
      const anchor = fixture.anchor;
      fixture.skus.forEach((skuId, idx) => {
        const sku = SHOP_CATALOG.find((s) => s.id === skuId);
        const count = inv[skuId].shelf;
        const g = new THREE.Group();
        const isClub = sku.cat === 'clubs';
        const color = new THREE.Color(CAT_COLORS[sku.cat]);
        color.offsetHSL(0, 0, (sku.tier - 2) * 0.09);
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });

        if (isClub) {
          for (let i = 0; i < Math.min(count, 6); i++) {
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 5), m);
            shaft.position.set(-1.0 + idx * 0.45 + i * 0.07, 0.72, 0.12 - i * 0.03);
            shaft.rotation.z = 0.16;
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.13), m);
            head.position.set(shaft.position.x - 0.1, 0.16, shaft.position.z);
            g.add(shaft, head);
          }
        } else {
          const onTable = fixture.skus.includes('glove1');
          const perRow = 3;
          const box = sku.cat === 'balls' ? [0.18, 0.12, 0.14] : sku.cat === 'apparel' ? [0.26, 0.07, 0.2] : [0.14, 0.1, 0.12];
          const show = Math.min(count, 12);
          for (let i = 0; i < show; i++) {
            const item = new THREE.Mesh(new THREE.BoxGeometry(...box), m);
            const layer = Math.floor(i / perRow);
            const col = i % perRow;
            if (onTable) {
              // stacks on the table top
              item.position.set(
                -0.85 + idx * 0.42,
                1.05 + layer * (box[1] + 0.012),
                col * (box[2] + 0.04) - 0.4,
              );
            } else {
              // spread across the unit's three boards, standing proud of the frame
              const boardY = [0.5, 1.05, 1.6][layer % 3];
              item.position.set(
                -1.05 + idx * 0.56 + (Math.floor(layer / 3)) * 0.2,
                boardY + 0.03 + box[1] / 2,
                0.06 + col * (box[2] * 0.35),
              );
            }
            item.castShadow = true;
            g.add(item);
          }
        }
        g.position.copy(anchor.position);
        g.rotation.copy(anchor.rotation);
        stockGroup.add(g);
        stockMeshes.set(skuId, g);
      });
    }
  }

  function shelfLabel(skuIds, title) {
    const inv = appRef.app.state.shop.inventory;
    const shelf = skuIds.reduce((a, id) => a + inv[id].shelf, 0);
    const back = skuIds.reduce((a, id) => a + inv[id].back, 0);
    if (back > 0) return `${title} — ${shelf} out · ${back} in the back — [E] restock`;
    return `${title} — ${shelf} out · backroom empty (order from the Shop desk)`;
  }

  function restockAll(skuIds, title) {
    let moved = 0;
    for (const id of skuIds) {
      const res = restockShelfFromBackroom(appRef.app.state, id);
      if (res.ok) moved += res.moved;
    }
    if (moved > 0) {
      rebuildStock();
      appRef.toast(`Restocked ${moved} items on the ${title.toLowerCase()}.`);
    } else {
      appRef.toast('Nothing in the back for this display.', 'warn');
    }
  }

  // --- customers (visual reflection of real flow) --------------------------------------------
  const customers = [];
  const custGroup = new THREE.Group();
  scene.add(custGroup);
  const CUST_COLORS = [0x8f4f3b, 0x3b5a8f, 0x4f8f3b, 0x8f7a3b, 0x6b4f8f];

  function spawnCustomer() {
    const rng = rngOf(appRef.app.state);
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.26, 0.85, 3, 8),
      new THREE.MeshStandardMaterial({ color: CUST_COLORS[rng.int(CUST_COLORS.length)], roughness: 0.8 }),
    );
    body.position.y = 0.9;
    body.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9b38c, roughness: 0.7 }),
    );
    head.position.y = 1.72;
    const g = new THREE.Group();
    g.add(body, head);
    g.position.set(0, 0, ROOM.d / 2 - 0.6);
    custGroup.add(g);

    const stops = [];
    const nStops = 1 + rng.int(2);
    for (let i = 0; i < nStops; i++) {
      const f = FIXTURES[rng.int(FIXTURES.length)];
      const p = f.anchor.position;
      stops.push(new THREE.Vector3(p.x + (rng.next() - 0.5) * 1.2, 0, p.z + (p.z < -3 ? 1.1 : p.z > 3 ? -1.1 : 1.2)));
    }
    if (rng.chance(0.55)) stops.push(new THREE.Vector3(ROOM.w / 2 - 2.6, 0, 1.4)); // counter
    stops.push(new THREE.Vector3(0, 0, ROOM.d / 2 - 0.6)); // door

    customers.push({ mesh: g, stops, stopIdx: 0, linger: 2 + rng.next() * 4, speed: 1.1 + rng.next() * 0.5 });
  }

  function updateCustomers(dt) {
    // presence scales with yesterday's real traffic (x3 for liveliness)
    const targetCount = clamp(Math.round(((appRef.app.state.shop.salesYesterday.units || 2) / 8) * 3), 1, 6);
    if (customers.length < targetCount && Math.random() < dt * 0.15) spawnCustomer();

    for (let i = customers.length - 1; i >= 0; i--) {
      const c = customers[i];
      const target = c.stops[c.stopIdx];
      const dx = target.x - c.mesh.position.x;
      const dz = target.z - c.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.15) {
        if (c.linger > 0) {
          c.linger -= dt;
        } else {
          c.stopIdx++;
          c.linger = 1.5 + Math.random() * 3.5;
          if (c.stopIdx >= c.stops.length) {
            custGroup.remove(c.mesh);
            customers.splice(i, 1);
          }
        }
      } else {
        const step = Math.min(dist, c.speed * dt);
        c.mesh.position.x += (dx / dist) * step;
        c.mesh.position.z += (dz / dist) * step;
        c.mesh.rotation.y = Math.atan2(dx, dz);
      }
    }
  }

  // --- movement & collision ---------------------------------------------------------------------
  const held = new Set();

  function onKeyDown(e) {
    held.add(e.key.toLowerCase());
  }
  function onKeyUp(e) {
    held.delete(e.key.toLowerCase());
  }

  function tryMove(dx, dz) {
    const r = 0.34;
    let nx = player.x + dx;
    let nz = player.z + dz;
    for (const c of colliders) {
      // push out along the shallow axis
      if (nx + r > c.minX && nx - r < c.maxX && nz + r > c.minZ && nz - r < c.maxZ) {
        const pushLeft = nx + r - c.minX;
        const pushRight = c.maxX - (nx - r);
        const pushUp = nz + r - c.minZ;
        const pushDown = c.maxZ - (nz - r);
        const min = Math.min(pushLeft, pushRight, pushUp, pushDown);
        if (min === pushLeft) nx = c.minX - r;
        else if (min === pushRight) nx = c.maxX + r;
        else if (min === pushUp) nz = c.minZ - r;
        else nz = c.maxZ + r;
      }
    }
    player.x = clamp(nx, -ROOM.w / 2 + 0.4, ROOM.w / 2 - 0.4);
    player.z = clamp(nz, -ROOM.d / 2 + 0.4, ROOM.d / 2 - 0.4);
  }

  function onMouseMove(e) {
    if (document.pointerLockElement !== renderer.domElement) return;
    player.yaw -= e.movementX * 0.0021;
    player.pitch = clamp(player.pitch - e.movementY * 0.0019, -1.35, 1.35);
  }

  // --- interaction ----------------------------------------------------------------------------------
  let focused = null;

  function findFocus() {
    focused = null;
    let best = 3.1;
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    for (const it of interactives) {
      const to = new THREE.Vector3(it.point.x - player.x, 0, it.point.z - player.z);
      const dist = to.length();
      if (dist > best) continue;
      to.normalize();
      if (to.dot(fwd) > 0.45) {
        best = dist;
        focused = it;
      }
    }
    return focused;
  }

  function interact() {
    if (focused) focused.action();
  }

  // --- lifecycle -------------------------------------------------------------------------------------
  let active = false;

  function enter() {
    active = true;
    player.x = 0;
    player.z = 3.6;
    player.yaw = 0;
    player.pitch = 0;
    rebuildStock();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
  }

  function exit() {
    active = false;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousemove', onMouseMove);
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    for (let i = customers.length - 1; i >= 0; i--) {
      custGroup.remove(customers[i].mesh);
    }
    customers.length = 0;
  }

  function update(dtMs) {
    if (!active) return;
    const dt = dtMs / 1000;

    // fallback look controls (also QA/accessibility)
    if (held.has('arrowleft')) player.yaw += 1.9 * dt;
    if (held.has('arrowright')) player.yaw -= 1.9 * dt;
    if (held.has('arrowup')) player.pitch = clamp(player.pitch + 1.3 * dt, -1.35, 1.35);
    if (held.has('arrowdown')) player.pitch = clamp(player.pitch - 1.3 * dt, -1.35, 1.35);

    const run = held.has('shift') ? 1.7 : 1;
    let mx = 0;
    let mz = 0;
    if (held.has('w')) mz -= 1;
    if (held.has('s')) mz += 1;
    if (held.has('a')) mx -= 1;
    if (held.has('d')) mx += 1;
    if (mx || mz) {
      const len = Math.hypot(mx, mz);
      const s = (player.speed * run * dt) / len;
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      // right = (cos, -sin), forward = (-sin, -cos); W sets mz = -1
      tryMove((mx * cos + mz * sin) * s, (-mx * sin + mz * cos) * s);
    }

    camera.position.set(player.x, EYE, player.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;

    updateCustomers(dt);
    findFocus();
  }

  function render() {
    renderer.render(scene, camera);
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    scene,
    camera,
    enter,
    exit,
    update,
    render,
    resize,
    interact,
    rebuildStock,
    getFocusLabel: () => (focused ? focused.label() : null),
    getPlayer: () => player,
    domElement: renderer.domElement,
  };
}
