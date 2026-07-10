// FAIRWAY STATE — the walkable pro shop: a bounded first-person interior.
// WASD + pointer-lock look (arrow keys as fallback), circle-vs-AABB collision,
// shelves whose stacks ARE the live inventory, and customers whose presence
// reflects the day's real shopper flow. A window onto the shop sim — the sim
// itself stays headless in src/sim/shop.js.

import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { makeCharacter } from './characterAsset.js';
import { SHOP_CATALOG, SHELF_CAP } from '../data/shopItems.js';
import { restockShelfFromBackroom, RENO, shopCondition, clearClutter } from '../sim/shop.js';
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

  const floorMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.7 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // grime overlay — a transparent canvas painted from the sim's reno grid, so
  // the dirt you see IS state.shop.reno.grime, patch for patch
  const grimeCanvas = document.createElement('canvas');
  grimeCanvas.width = 448;
  grimeCanvas.height = 320;
  const grimeTex = new THREE.CanvasTexture(grimeCanvas);
  grimeTex.colorSpace = THREE.SRGBColorSpace;
  const grimePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    // lit material: the dust layer dims with the room light instead of glowing
    new THREE.MeshStandardMaterial({ map: grimeTex, transparent: true, depthWrite: false, roughness: 1 }),
  );
  grimePlane.rotation.x = -Math.PI / 2;
  grimePlane.position.y = 0.012;
  grimePlane.renderOrder = 1;
  scene.add(grimePlane);

  const hash01 = (n) => {
    const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  function repaintGrime() {
    const reno = appRef.app.state && appRef.app.state.shop && appRef.app.state.shop.reno;
    const ctx = grimeCanvas.getContext('2d');
    ctx.clearRect(0, 0, grimeCanvas.width, grimeCanvas.height);
    if (!reno) { grimeTex.needsUpdate = true; return; }
    const px = grimeCanvas.width / RENO.grid.w;   // pixels per cell
    const py = grimeCanvas.height / RENO.grid.h;
    for (let cy = 0; cy < RENO.grid.h; cy++) {
      for (let cx = 0; cx < RENO.grid.w; cx++) {
        const d = reno.grime[cy * RENO.grid.w + cx];
        if (d <= 0.015) continue;
        const idx = cy * RENO.grid.w + cx;
        // a broad pale dust haze per cell, then darker specks for texture —
        // pale-on-wood reads in the dim rundown room AND on the clean floor
        for (let b = 0; b < 3; b++) {
          const bx = (cx + 0.16 + 0.68 * hash01(idx * 7.3 + b * 3.1)) * px;
          const by = (cy + 0.16 + 0.68 * hash01(idx * 5.7 + b * 4.9 + 11)) * py;
          const r = (0.44 + 0.34 * hash01(idx * 3.3 + b)) * Math.min(px, py) * (0.6 + d * 0.6);
          const a = d * (0.34 + 0.26 * hash01(idx + b * 17));
          const g = ctx.createRadialGradient(bx, by, r * 0.12, bx, by, r);
          g.addColorStop(0, `rgba(148, 138, 116, ${a.toFixed(3)})`);
          g.addColorStop(1, 'rgba(148, 138, 116, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(bx - r, by - r, r * 2, r * 2);
        }
        for (let b = 0; b < 3; b++) {
          const bx = (cx + 0.2 + 0.6 * hash01(idx * 9.1 + b * 6.7 + 5)) * px;
          const by = (cy + 0.2 + 0.6 * hash01(idx * 8.3 + b * 2.3 + 29)) * py;
          const r = (0.1 + 0.14 * hash01(idx * 4.9 + b + 3)) * Math.min(px, py);
          const a = d * (0.3 + 0.2 * hash01(idx * 2.1 + b * 13));
          const g = ctx.createRadialGradient(bx, by, r * 0.2, bx, by, r);
          g.addColorStop(0, `rgba(52, 43, 30, ${a.toFixed(3)})`);
          g.addColorStop(1, 'rgba(52, 43, 30, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(bx - r, by - r, r * 2, r * 2);
        }
      }
    }
    grimeTex.needsUpdate = true;
  }

  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x6b6156, roughness: 0.95 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), ceilMat);
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

  // course management map on the wall beside the door — the other way "out"
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = 240;
  mapCanvas.height = 160;
  const mapTex = new THREE.CanvasTexture(mapCanvas);
  mapTex.colorSpace = THREE.SRGBColorSpace;
  const courseMap = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.6),
    new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.85 }),
  );
  courseMap.position.set(3.4, 1.9, ROOM.d / 2 - 0.03);
  courseMap.rotation.y = Math.PI;
  scene.add(courseMap);
  const mapFrame = new THREE.Mesh(
    new THREE.PlaneGeometry(2.62, 1.82),
    new THREE.MeshStandardMaterial({ color: 0x3d3122, roughness: 0.8 }),
  );
  mapFrame.position.set(3.4, 1.9, ROOM.d / 2 - 0.02);
  mapFrame.rotation.y = Math.PI;
  scene.add(mapFrame);
  interactives.push({
    kind: 'map',
    point: new THREE.Vector3(3.4, 1.6, ROOM.d / 2),
    label: () => 'Course management — open the course overview',
    action: () => appRef.exitShop(),
  });

  const MAP_COLORS = ['#46543a', '#5c7d43', '#7cb257', '#96d377', '#8ac168', '#d8c78e', '#3e6f9e', '#a89f8d'];

  function redrawCourseMap() {
    const course = appRef.app.state.course;
    const ctx2 = mapCanvas.getContext('2d');
    ctx2.fillStyle = '#2a3324';
    ctx2.fillRect(0, 0, 240, 160);
    const sx = 240 / course.w;
    const sy = 160 / course.h;
    for (let y = 0; y < course.h; y++) {
      for (let x = 0; x < course.w; x++) {
        ctx2.fillStyle = MAP_COLORS[course.zones[y * course.w + x]] || '#46543a';
        ctx2.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      }
    }
    // pins
    ctx2.fillStyle = '#d84b3a';
    for (const h of course.holes) {
      if (h.pin) ctx2.fillRect(h.pin.x * sx - 1, h.pin.y * sy - 1, 3, 3);
    }
    mapTex.needsUpdate = true;
  }
  interactives.push({
    kind: 'door',
    point: new THREE.Vector3(0, 1.3, ROOM.d / 2),
    label: () => 'Step out to the course — greens, works, and the grounds crew',
    action: () => appRef.exitShop(),
  });

  // --- lighting ----------------------------------------------------------------------
  // STYLE GUIDE §3: brighter, cleaner interior — daylight does the work.
  // Intensities are BASE values for a pristine shop; the restoration arc scales
  // them down while the place is still a rundown mess (applyConditionVisuals).
  const ambient = new THREE.AmbientLight(0xfff4e2, 0.75);
  scene.add(ambient);
  const winLight = new THREE.DirectionalLight(0xcfe4f5, 1.4);
  winLight.position.set(0, 2.6, -8);
  scene.add(winLight);
  const BULB_I = 26;
  const bulbs = [];
  for (const lx of [-3.6, 3.6]) {
    const bulb = new THREE.PointLight(0xffe2b0, BULB_I, 14, 1.6);
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
    bulbs.push({ light: bulb, fixture });
  }

  // --- fixtures + live stock ------------------------------------------------------------
  const stockGroup = new THREE.Group();
  scene.add(stockGroup);
  // §1: warmer, lighter fixture wood so the shop reads bright and friendly
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6b48, roughness: 0.75 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x53422e, roughness: 0.85 });

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

  // --- restoration arc: clutter piles + condition-driven look ------------------------------
  const cardboard = new THREE.MeshStandardMaterial({ color: 0xb08f5e, roughness: 0.92 });
  const cardboardDark = new THREE.MeshStandardMaterial({ color: 0xa08050, roughness: 0.92 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x7c6034, roughness: 0.85 });
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.95 });
  const clutterObjs = []; // { group, collider, interactive }

  function buildClutterPile(idx, pile) {
    const g = new THREE.Group();
    const big = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.5), cardboard);
    big.position.y = 0.25;
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.015, 0.12), tapeMat);
    tape.position.y = 0.505;
    const small = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.36, 0.42), cardboardDark);
    small.position.set(0.08, 0.68, -0.03);
    small.rotation.y = 0.45;
    const flat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.44), cardboard);
    flat.position.set(-0.45, 0.05, 0.22);
    flat.rotation.y = -0.5;
    flat.rotation.z = 0.05;
    const paper = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), paperMat);
    paper.position.set(0.42, 0.09, 0.3);
    for (const m of [big, small, flat]) m.castShadow = true;
    g.add(big, tape, small, flat, paper);
    g.position.set(pile.x, 0, pile.z);
    g.rotation.y = pile.ry;
    scene.add(g);

    const collider = { minX: pile.x - 0.45, maxX: pile.x + 0.45, minZ: pile.z - 0.45, maxZ: pile.z + 0.45 };
    colliders.push(collider);
    const interactive = {
      kind: 'clutter',
      point: new THREE.Vector3(pile.x, 0.7, pile.z),
      label: () => 'Old clutter — [E] haul it out',
      action: () => {
        const res = clearClutter(appRef.app.state, idx);
        if (!res.ok) return;
        scene.remove(g);
        colliders.splice(colliders.indexOf(collider), 1);
        interactives.splice(interactives.indexOf(interactive), 1);
        const co = clutterObjs.find((c) => c.group === g);
        if (co) clutterObjs.splice(clutterObjs.indexOf(co), 1);
        repaintGrime();
        refreshCondition();
        appRef.toast('Hauled a pile of junk out the back.');
      },
    };
    interactives.push(interactive);
    clutterObjs.push({ group: g, collider, interactive });
  }

  function rebuildReno() {
    for (const c of clutterObjs) {
      scene.remove(c.group);
      const ci = colliders.indexOf(c.collider);
      if (ci >= 0) colliders.splice(ci, 1);
      const ii = interactives.indexOf(c.interactive);
      if (ii >= 0) interactives.splice(ii, 1);
    }
    clutterObjs.length = 0;
    const reno = appRef.app.state && appRef.app.state.shop && appRef.app.state.shop.reno;
    if (reno) reno.clutter.forEach((pile, idx) => { if (!pile.cleared) buildClutterPile(idx, pile); });
    repaintGrime();
    refreshCondition();
  }

  // the whole room reads the 0-100 condition: light level, dead/flickering
  // bulbs, dingy surfaces, filthy windows — all recover as the value climbs
  const WHITE = new THREE.Color(0xffffff);
  let conditionNow = 100;
  let flickT = 0;

  function refreshCondition() {
    const st = appRef.app.state;
    conditionNow = st && st.shop ? shopCondition(st) : 100;
    const t = clamp(conditionNow / 100, 0, 1);
    ambient.intensity = 0.46 + 0.29 * t;
    winLight.intensity = 0.95 + 0.45 * t;
    windowMat.color.lerpColors(new THREE.Color(0x77705f), new THREE.Color(0xbcd8ee), Math.min(1, t * 1.5));
    floorMat.color.lerpColors(new THREE.Color(0x83786a), WHITE, t);
    wallMat.color.lerpColors(new THREE.Color(0xa2977f), WHITE, t);
    ceilMat.color.lerpColors(new THREE.Color(0x4e463c), new THREE.Color(0x6b6156), t);
    const dead = conditionNow < 45; // one tube burnt out until the place is half-decent
    bulbs[0].light.intensity = dead ? 0 : BULB_I;
    bulbs[0].fixture.material.emissiveIntensity = dead ? 0.04 : 0.7;
    if (conditionNow >= 40) bulbs[1].light.intensity = BULB_I;
  }

  function updateFlicker(dt) {
    if (conditionNow >= 40) return;
    flickT += dt;
    const drop = Math.sin(flickT * 13.1) * Math.sin(flickT * 4.7 + 2.1) < -0.55;
    bulbs[1].light.intensity = BULB_I * (drop ? 0.06 : 0.72 + 0.18 * Math.sin(flickT * 31));
    bulbs[1].fixture.material.emissiveIntensity = drop ? 0.05 : 0.55;
  }

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
  const CUST_COLORS = [0x3b6fb3, 0x2c3e66, 0xd98bb0, 0xd97538, 0x3f7a34]; // §5 polo palette

  function spawnCustomer() {
    const rng = rngOf(appRef.app.state);
    const char = makeCharacter({
      polo: CUST_COLORS[rng.int(CUST_COLORS.length)],
      khaki: 0xc2b190,
      cap: rng.chance(0.6) ? 0xf2efe4 : 0x2c3e66,
    });
    char.root.scale.setScalar(0.92); // indoor scale beside 1.05-yd counters
    char.setMode('Walk');
    char.root.userData.char = char;
    const g = char.root;
    g.position.set(0, 0, ROOM.d / 2 - 0.6);
    custGroup.add(g);
    if (appRef.audio && appRef.audio.ready) appRef.audio.doorbell();

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
      const char = c.mesh.userData.char;
      if (char) char.update(dt);
      const target = c.stops[c.stopIdx];
      const dx = target.x - c.mesh.position.x;
      const dz = target.z - c.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.15) {
        if (c.linger > 0) {
          if (char) char.setMode(c.stopIdx < c.stops.length - 1 ? 'Browse' : 'Idle');
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
        if (char) char.setMode('Walk');
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
    rebuildReno();
    redrawCourseMap();
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
    updateFlicker(dt);
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
    rebuildReno,
    refreshCondition,
    repaintGrime,
    getFocusLabel: () => (focused ? focused.label() : null),
    getPlayer: () => player,
    domElement: renderer.domElement,
  };
}
