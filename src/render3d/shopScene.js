// FAIRWAY STATE — the walkable pro shop: a bounded first-person interior.
// WASD + pointer-lock look (arrow keys as fallback), circle-vs-AABB collision,
// shelves whose stacks ARE the live inventory, and customers whose presence
// reflects the day's real shopper flow. A window onto the shop sim — the sim
// itself stays headless in src/sim/shop.js.

import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { makeCharacter } from './characterAsset.js';
import { SHOP_CATALOG, SHELF_CAP, DECOR_SPOTS } from '../data/shopItems.js';
import { restockShelfFromBackroom, RENO, shopCondition, clearClutter, cleanGrimeAt, placeDecor, removeDecor } from '../sim/shop.js';
import { dueForCheckIn, checkInReservation, fmtSlot } from '../sim/reservations.js';
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
  // reference shell: dark-green wainscoting under cream plaster, wood cap rail
  const wainscotMat = new THREE.MeshStandardMaterial({ color: 0x57795c, roughness: 0.85 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6e5335, roughness: 0.8 });
  const WAINSCOT_H = 0.92;
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
    const inward = 0.015; // proud of the plaster
    const nx = Math.sin(spec.ry);
    const nz = Math.cos(spec.ry);
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, WAINSCOT_H), wainscotMat);
    skirt.position.set(spec.x + nx * inward, WAINSCOT_H / 2, spec.z + nz * inward);
    skirt.rotation.y = spec.ry;
    scene.add(skirt);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(spec.w, 0.05, 0.03), railMat);
    rail.position.set(spec.x + nx * (inward + 0.01), WAINSCOT_H + 0.02, spec.z + nz * (inward + 0.01));
    rail.rotation.y = spec.ry;
    scene.add(rail);
  }

  // exposed ceiling beams — the reference's roof-truss language on a flat lid
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.85 });
  for (const bz of [-3.2, 0, 3.2]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.16, 0.15), beamMat);
    beam.position.set(0, ROOM.h - 0.09, bz);
    scene.add(beam);
  }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, ROOM.d), beamMat);
  ridge.position.set(0, ROOM.h - 0.08, 0);
  scene.add(ridge);
  // wall colliders (thick)
  colliders.push(
    { minX: -ROOM.w / 2 - 1, maxX: ROOM.w / 2 + 1, minZ: -ROOM.d / 2 - 1, maxZ: -ROOM.d / 2 },
    { minX: -ROOM.w / 2 - 1, maxX: ROOM.w / 2 + 1, minZ: ROOM.d / 2, maxZ: ROOM.d / 2 + 1 },
    { minX: -ROOM.w / 2 - 1, maxX: -ROOM.w / 2, minZ: -ROOM.d / 2 - 1, maxZ: ROOM.d / 2 + 1 },
    { minX: ROOM.w / 2, maxX: ROOM.w / 2 + 1, minZ: -ROOM.d / 2 - 1, maxZ: ROOM.d / 2 + 1 },
  );

  // windows (emissive daylight planes) with wood trim + door
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xbcd8ee });
  for (const wx of [-4.2, 0, 4.2]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), windowMat);
    win.position.set(wx, 1.9, -ROOM.d / 2 + 0.02);
    scene.add(win);
    for (const [tw, th, ty, tx] of [[2.8, 0.08, 2.59, 0], [2.8, 0.08, 1.21, 0], [0.08, 1.46, 1.9, -1.36], [0.08, 1.46, 1.9, 1.36]]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(tw, th, 0.05), railMat);
      trim.position.set(wx + tx, ty, -ROOM.d / 2 + 0.03);
      scene.add(trim);
    }
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 0.03), railMat);
    mullion.position.set(wx, 1.9, -ROOM.d / 2 + 0.03);
    scene.add(mullion);
  }
  // the door swings on a real hinge — it opens for whoever walks up to it
  // (player or customer) and closes behind them
  const doorHinge = new THREE.Group();
  doorHinge.position.set(-0.8, 0, ROOM.d / 2 - 0.02);
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 2.5),
    new THREE.MeshStandardMaterial({ color: 0x5d4a33, roughness: 0.8, side: THREE.DoubleSide }),
  );
  door.position.set(0.8, 1.25, 0);
  door.rotation.y = Math.PI;
  doorHinge.add(door);
  scene.add(doorHinge);
  let doorAngle = 0;

  function updateDoor(dt) {
    const dx = 0 - player.x;
    const dz = ROOM.d / 2 - player.z;
    let want = Math.hypot(dx, dz) < 2.0 ? 1 : 0;
    if (!want) {
      for (const c of customers) {
        if (Math.hypot(c.mesh.position.x, ROOM.d / 2 - c.mesh.position.z) < 1.6) {
          want = 1;
          break;
        }
      }
    }
    const target = want * -1.65; // swings inward, out of the walkway
    doorAngle += (target - doorAngle) * Math.min(1, dt * 6);
    doorHinge.rotation.y = doorAngle;
  }

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
    // garment rail along the table's back edge — hung stock goes here
    for (const rx of [-0.9, 0.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), darkMat);
      post.position.set(rx, 0.85, -0.62);
      g.add(post);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.9, 6), darkMat);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 1.68, -0.62);
    g.add(rail);
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

  // counter + register (east) — reference style: green panel body, wood top
  const counterBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.86, 1.0, 3.2),
    new THREE.MeshStandardMaterial({ color: 0x3d5c40, roughness: 0.85 }),
  );
  counterBody.position.set(ROOM.w / 2 - 1.3, 0.5, 1.4);
  counterBody.castShadow = true;
  scene.add(counterBody);
  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, 3.36), woodMat);
  counterTop.position.set(ROOM.w / 2 - 1.3, 1.04, 1.4);
  counterTop.castShadow = true;
  scene.add(counterTop);
  addCollider(ROOM.w / 2 - 1.3, 1.4, 1.1, 3.4);

  // the club's name painted on the wall behind the counter — every property
  // hangs its own identity here (redrawn per enter)
  const logoCanvas = document.createElement('canvas');
  logoCanvas.width = 512;
  logoCanvas.height = 256;
  const logoTex = new THREE.CanvasTexture(logoCanvas);
  logoTex.colorSpace = THREE.SRGBColorSpace;
  const logoPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 1.65),
    new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.92 }),
  );
  logoPlane.position.set(ROOM.w / 2 - 0.03, 2.15, 1.2);
  logoPlane.rotation.y = -Math.PI / 2;
  scene.add(logoPlane);

  function redrawLogo() {
    const name = (appRef.app.state && appRef.app.state.clubName) || 'THE CLUB';
    const c2 = logoCanvas.getContext('2d');
    c2.clearRect(0, 0, 512, 256);
    c2.fillStyle = '#2e5a35';
    // three pines over the wordmark, like the reference wall
    for (const [px, s] of [[216, 0.8], [256, 1], [296, 0.72]]) {
      for (let t = 0; t < 3; t++) {
        const w = (46 - t * 10) * s;
        const yTop = 26 + t * 18 * s;
        c2.beginPath();
        c2.moveTo(px, yTop);
        c2.lineTo(px - w / 2, yTop + 26 * s);
        c2.lineTo(px + w / 2, yTop + 26 * s);
        c2.closePath();
        c2.fill();
      }
      c2.fillRect(px - 3, 26 + 54 * s, 6, 12);
    }
    const upper = name.toUpperCase();
    c2.textAlign = 'center';
    c2.font = 'bold 44px Georgia, serif';
    // shrink long names to fit the plank
    let size = 44;
    while (c2.measureText(upper).width > 470 && size > 22) {
      size -= 2;
      c2.font = `bold ${size}px Georgia, serif`;
    }
    c2.fillText(upper, 256, 168);
    c2.font = 'italic 22px Georgia, serif';
    c2.fillStyle = '#57795c';
    c2.fillText('PRO SHOP', 256, 208);
    logoTex.needsUpdate = true;
  }
  const register = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.5), new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.4 }));
  register.position.set(ROOM.w / 2 - 1.3, 1.22, 0.6);
  scene.add(register);
  interactives.push({
    kind: 'counter',
    point: new THREE.Vector3(ROOM.w / 2 - 1.3, 1.1, 1.4),
    label: () => {
      const st = appRef.app.state;
      // a booked golfer standing at the counter takes over the register
      const due = dueForCheckIn(st);
      if (due.length) {
        const r = due[0];
        return `Register — [E] check in ${r.name} (${fmtSlot(r.minute)} tee, ${Math.round(r.fee)} dollars)` +
          (due.length > 1 ? ` · ${due.length - 1} more waiting` : '');
      }
      const s = st.shop;
      return `Register — yesterday: ${s.salesYesterday.units} sales, ${s.salesYesterday.revenue} dollars` +
        (s.lostSalesYesterday ? ` · ${s.lostSalesYesterday} walked out empty-handed` : '');
    },
    action: () => {
      const st = appRef.app.state;
      const due = dueForCheckIn(st);
      if (!due.length) return;
      const res = checkInReservation(st, due[0].id);
      if (res.ok) {
        appRef.toast(`${due[0].name} checked in — ${Math.round(res.fee)} dollar green fee collected.`);
        if (appRef.audio && appRef.audio.ready) appRef.audio.doorbell();
      }
    },
  });

  // office computer on the counter — the diegetic door into the supplier/order
  // desk (the same shopPanel the top bar opens; this is the in-world way in)
  const monitor = new THREE.Group();
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.36, 0.045),
    new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.45 }),
  );
  bezel.position.y = 0.36;
  const screenGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x0d1a12, emissive: 0x2f8a4a, emissiveIntensity: 0.9 }),
  );
  screenGlow.position.set(0, 0.36, 0.024);
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.06, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.5 }),
  );
  stand.position.y = 0.1;
  const keyboard = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.02, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x33373c, roughness: 0.6 }),
  );
  keyboard.position.set(0, 0.01, 0.22);
  monitor.add(bezel, screenGlow, stand, keyboard);
  monitor.position.set(ROOM.w / 2 - 1.3, 1.06, 2.4);
  monitor.rotation.y = -Math.PI / 2; // faces the shop floor
  scene.add(monitor);
  interactives.push({
    kind: 'computer',
    point: new THREE.Vector3(ROOM.w / 2 - 1.3, 1.3, 2.4),
    label: () => 'Office computer — [E] supplier orders & pricing',
    action: () => appRef.openShopDesk(),
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
        colliders.splice(colliders.indexOf(collider), 1);
        interactives.splice(interactives.indexOf(interactive), 1);
        const co = clutterObjs.find((c) => c.group === g);
        if (co) clutterObjs.splice(clutterObjs.indexOf(co), 1);
        tweenScale(g, 1, 0.01, 0.2, () => scene.remove(g)); // hauled, not vanished
        repaintGrime();
        refreshCondition();
        if (appRef.audio && appRef.audio.ready) appRef.audio.thunk();
        appRef.toast('Hauled a pile of junk out the back.');
      },
    };
    interactives.push(interactive);
    clutterObjs.push({ group: g, collider, interactive });
  }

  // one-shot scale tween for interaction "moments" (place-in, haul-out)
  function tweenScale(obj, from, to, dur, onDone) {
    const t0 = performance.now();
    obj.scale.setScalar(from);
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / (dur * 1000));
      const e = 1 - Math.pow(1 - t, 3);
      obj.scale.setScalar(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(step);
      else if (onDone) onDone();
    };
    requestAnimationFrame(step);
  }

  // --- decor: real meshes for placed items, green ghosts on free valid spots ---------
  const decorObjs = []; // { group, colliders: [], interactive|null }
  let popNextDecor = null; // { skuId, spot } — the just-placed piece lands with a pop
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0x45d052, transparent: true, opacity: 0.32, depthWrite: false,
  });

  function makeRugMesh() {
    const cv = document.createElement('canvas');
    cv.width = 192; cv.height = 128;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#3f6d45';
    c2.fillRect(0, 0, 192, 128);
    c2.strokeStyle = '#dfd8c2';
    c2.lineWidth = 7;
    c2.strokeRect(10, 10, 172, 108);
    c2.fillStyle = '#dfd8c2'; // the reference rug's pine motif
    c2.beginPath();
    c2.moveTo(96, 30); c2.lineTo(120, 62); c2.lineTo(104, 62); c2.lineTo(124, 92);
    c2.lineTo(68, 92); c2.lineTo(88, 62); c2.lineTo(72, 62);
    c2.closePath(); c2.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 2.0),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.018;
    rug.receiveShadow = true;
    const g = new THREE.Group();
    g.add(rug);
    return { group: g, colliders: [] };
  }

  function makePlantMesh(spot) {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 0.26, 10),
      new THREE.MeshStandardMaterial({ color: 0x9a5a3c, roughness: 0.85 }),
    );
    pot.position.y = 0.13;
    pot.castShadow = true;
    g.add(pot);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3d7a3a, roughness: 0.8 });
    for (const [dx, dy, dz, r] of [[0, 0.5, 0, 0.2], [0.13, 0.42, 0.06, 0.13], [-0.12, 0.44, -0.05, 0.14], [0.02, 0.62, -0.02, 0.13]]) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMat);
      puff.position.set(dx, dy, dz);
      puff.castShadow = true;
      g.add(puff);
    }
    return { group: g, colliders: [{ minX: spot.x - 0.25, maxX: spot.x + 0.25, minZ: spot.z - 0.25, maxZ: spot.z + 0.25 }] };
  }

  function makePosterMesh() {
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 128;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#e9e2cc';
    c2.fillRect(0, 0, 96, 128);
    c2.fillStyle = '#1f8a34';
    c2.fillRect(0, 0, 96, 30);
    c2.fillStyle = '#e9e2cc';
    c2.font = 'bold 13px sans-serif';
    c2.fillText('KEEP IT', 22, 13);
    c2.fillText('GREEN', 24, 26);
    c2.fillStyle = '#57795c'; // stylized fairway graphic
    c2.beginPath(); c2.ellipse(48, 74, 34, 22, 0.2, 0, 7); c2.fill();
    c2.fillStyle = '#8a8069';
    for (let i = 0; i < 3; i++) c2.fillRect(14, 104 + i * 7, 68 - i * 16, 3);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 1.22, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x3d5c40, roughness: 0.8 }),
    );
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(0.84, 1.14),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
    );
    sheet.position.z = 0.017;
    frame.add(sheet);
    frame.position.y = 1.85;
    g.add(frame);
    return { group: g, colliders: [] };
  }

  function makeBoardMesh() {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.1, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x3d5c40, roughness: 0.8 }),
    );
    const cork = new THREE.Mesh(
      new THREE.PlaneGeometry(1.36, 0.96),
      new THREE.MeshStandardMaterial({ color: 0xa8794e, roughness: 0.95 }),
    );
    cork.position.z = 0.028;
    frame.add(cork);
    const noteMat = new THREE.MeshStandardMaterial({ color: 0xf2eee0, roughness: 0.9 });
    for (const [nx, ny, w, h, rz] of [[-0.4, 0.18, 0.3, 0.34, 0.05], [0.05, 0.1, 0.34, 0.26, -0.04], [0.42, 0.2, 0.26, 0.3, 0.03], [-0.1, -0.26, 0.3, 0.3, -0.06], [0.36, -0.24, 0.3, 0.22, 0.05]]) {
      const note = new THREE.Mesh(new THREE.PlaneGeometry(w, h), noteMat);
      note.position.set(nx, ny, 0.034);
      note.rotation.z = rz;
      frame.add(note);
    }
    const header = new THREE.Mesh(
      new THREE.PlaneGeometry(1.36, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x1f8a34, roughness: 0.8 }),
    );
    header.position.set(0, 0.4, 0.034);
    frame.add(header);
    frame.position.y = 1.8;
    g.add(frame);
    return { group: g, colliders: [] };
  }

  function makePendantMesh(spot, ghost) {
    const g = new THREE.Group();
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5),
      new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.9 }),
    );
    cord.position.y = ROOM.h - 0.35;
    g.add(cord);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.3, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a5a33, roughness: 0.7, side: THREE.DoubleSide }),
    );
    shade.position.y = ROOM.h - 0.78;
    g.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: 0xffe2b0, emissiveIntensity: ghost ? 0 : 1.2 }),
    );
    bulb.position.y = ROOM.h - 0.9;
    g.add(bulb);
    if (!ghost) {
      const light = new THREE.PointLight(0xffe2b0, 9, 9, 1.7);
      light.position.y = ROOM.h - 0.95;
      g.add(light);
    }
    return { group: g, colliders: [] };
  }

  function makeLoungeMesh(spot) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.8 });
    const cushion = new THREE.MeshStandardMaterial({ color: 0x3f6d45, roughness: 0.9 });
    // sofa: wood base, three cushions, low back and arms — the reference's green lounge
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 0.8), wood);
    base.position.y = 0.22;
    base.castShadow = true;
    g.add(base);
    for (let i = -1; i <= 1; i++) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.72), cushion);
      seat.position.set(i * 0.6, 0.44, 0);
      seat.castShadow = true;
      g.add(seat);
      const backC = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.42, 0.16), cushion);
      backC.position.set(i * 0.6, 0.72, -0.31);
      backC.rotation.x = -0.12;
      backC.castShadow = true;
      g.add(backC);
    }
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.8), wood);
      arm.position.set(sx * 1.02, 0.52, 0);
      arm.castShadow = true;
      g.add(arm);
    }
    // coffee table out front, mug on top
    const tbl = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.08, 0.5), wood);
    tbl.position.set(0, 0.4, 1.05);
    tbl.castShadow = true;
    g.add(tbl);
    for (const [lx, lz] of [[-0.45, 0.85], [0.45, 0.85], [-0.45, 1.25], [0.45, 1.25]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.07), wood);
      leg.position.set(lx, 0.2, lz);
      g.add(leg);
    }
    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.04, 0.09, 8),
      new THREE.MeshStandardMaterial({ color: 0xf2eee0, roughness: 0.7 }),
    );
    mug.position.set(0.2, 0.49, 1.05);
    g.add(mug);
    // colliders in world space (sofa slab + table): rotate the local anchor by
    // the spot's yaw, swap extents when the piece stands side-on
    const worldBox = (lx, lz, w, d) => {
      const sin = Math.sin(spot.ry);
      const cos = Math.cos(spot.ry);
      const wx = spot.x + lx * cos + lz * sin;
      const wz = spot.z - lx * sin + lz * cos;
      const swap = Math.abs(sin) > 0.5;
      const ew = swap ? d : w;
      const ed = swap ? w : d;
      return { minX: wx - ew / 2, maxX: wx + ew / 2, minZ: wz - ed / 2, maxZ: wz + ed / 2 };
    };
    return { group: g, colliders: [worldBox(0, 0, 2.2, 0.95), worldBox(0, 1.05, 1.15, 0.6)] };
  }

  const DECOR_BUILDERS = {
    rug1: makeRugMesh, plant1: makePlantMesh, poster1: makePosterMesh,
    board1: makeBoardMesh, light1: makePendantMesh, lounge1: makeLoungeMesh,
  };

  function ghostify(group) {
    group.traverse((o) => {
      if (o.isMesh) {
        o.material = ghostMat;
        o.castShadow = false;
      }
      if (o.isPointLight) o.intensity = 0;
    });
    return group;
  }

  function buildDecorAt(skuId, spotIdx, ghost) {
    const spot = DECOR_SPOTS[skuId][spotIdx];
    const built = DECOR_BUILDERS[skuId](spot, ghost);
    built.group.position.set(spot.x, 0, spot.z);
    built.group.rotation.y = spot.ry;
    if (ghost) ghostify(built.group);
    scene.add(built.group);
    if (!ghost && popNextDecor && popNextDecor.skuId === skuId && popNextDecor.spot === spotIdx) {
      popNextDecor = null;
      tweenScale(built.group, 0.55, 1, 0.28); // set down with a real moment
    }
    const entry = { group: built.group, colliders: ghost ? [] : built.colliders, interactive: null };
    for (const c of entry.colliders) colliders.push(c);
    if (!ghost) {
      // placed pieces can be packed back up (returns to the backroom)
      const skuP = SHOP_CATALOG.find((sk) => sk.id === skuId);
      const spotP = DECOR_SPOTS[skuId][spotIdx];
      const yP = spotP.mount === 'ceiling' ? 1.7 : spotP.mount === 'wall' ? 1.6 : 0.7;
      entry.interactive = {
        kind: 'decor-placed',
        point: new THREE.Vector3(spotP.x, yP, spotP.z),
        label: () => `${skuP.name} — [E] pack it back up`,
        action: () => {
          if (!removeDecor(appRef.app.state, skuId, spotIdx).ok) return;
          rebuildDecor();
          refreshCondition();
          if (appRef.audio && appRef.audio.ready) appRef.audio.thunk();
          appRef.toast(`${skuP.name} packed up — it's back in the backroom.`);
        },
      };
      interactives.push(entry.interactive);
    }
    if (ghost) {
      const sku = SHOP_CATALOG.find((s) => s.id === skuId);
      const anchorY = spot.mount === 'ceiling' ? 1.7 : spot.mount === 'wall' ? 1.6 : 0.8;
      entry.interactive = {
        kind: 'decor-ghost',
        point: new THREE.Vector3(spot.x, anchorY, spot.z),
        label: () => `Place the ${sku.name.toLowerCase()} here — [E]`,
        action: () => {
          const res = placeDecor(appRef.app.state, skuId, spotIdx);
          if (!res.ok) {
            appRef.toast(res.reason || 'Cannot place that here.', 'warn');
            return;
          }
          popNextDecor = { skuId, spot: spotIdx };
          rebuildDecor();
          refreshCondition();
          if (appRef.audio && appRef.audio.ready) appRef.audio.thunk();
          appRef.toast(`${sku.name} placed — the shop is coming together.`);
        },
      };
      interactives.push(entry.interactive);
    }
    decorObjs.push(entry);
  }

  function rebuildDecor() {
    for (const d of decorObjs) {
      scene.remove(d.group);
      for (const c of d.colliders) {
        const ci = colliders.indexOf(c);
        if (ci >= 0) colliders.splice(ci, 1);
      }
      if (d.interactive) {
        const ii = interactives.indexOf(d.interactive);
        if (ii >= 0) interactives.splice(ii, 1);
      }
    }
    decorObjs.length = 0;
    const st = appRef.app.state;
    const reno = st && st.shop && st.shop.reno;
    if (!reno) return;
    for (const d of reno.decor) {
      if (DECOR_BUILDERS[d.skuId] && DECOR_SPOTS[d.skuId] && DECOR_SPOTS[d.skuId][d.spot]) {
        buildDecorAt(d.skuId, d.spot, false);
      }
    }
    // ghosts for everything owned-but-unplaced, on each free valid spot
    for (const skuId of Object.keys(DECOR_BUILDERS)) {
      const inv = st.shop.inventory[skuId];
      if (!inv || inv.back <= 0) continue;
      DECOR_SPOTS[skuId].forEach((spot, idx) => {
        if (!reno.decor.some((d) => d.skuId === skuId && d.spot === idx)) buildDecorAt(skuId, idx, true);
      });
    }
  }

  // ghosts appear the moment a delivery lands, even while you stand in the shop
  let decorSig = '';
  let decorPoll = 0;
  function decorSignature() {
    const st = appRef.app.state;
    if (!st || !st.shop) return '';
    let sig = st.shop.reno ? String(st.shop.reno.decor.length) : '0';
    for (const skuId of Object.keys(DECOR_BUILDERS)) {
      const inv = st.shop.inventory[skuId];
      sig += ':' + (inv ? inv.back : 0);
    }
    return sig;
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
    rebuildDecor();
    decorSig = decorSignature();
    repaintGrime();
    refreshCondition();
  }

  // the whole room reads the 0-100 condition: light level, dead/flickering
  // bulbs, dingy surfaces, filthy windows — all recover as the value climbs
  const WHITE = new THREE.Color(0xffffff);
  let conditionNow = 100;
  let condT = 1; // cleanliness factor refreshCondition computed last
  let flickT = 0;

  // the windows live in the same day as the course: cool dawn, bright noon,
  // amber evening, dark night (the bulbs carry the room after dark)
  let dayClock = 0;
  const PHASES = [
    [0, new THREE.Color(0x0d1420), 0.05],     // deep night
    [330, new THREE.Color(0x0d1420), 0.05],
    [420, new THREE.Color(0xd8c9a8), 0.75],   // dawn gold
    [720, new THREE.Color(0xbcd8ee), 1.0],    // noon
    [1050, new THREE.Color(0xe8c489), 0.85],  // evening amber
    [1230, new THREE.Color(0x1a2233), 0.12],  // dusk out
    [1440, new THREE.Color(0x0d1420), 0.05],
  ];

  function daylightAt(minute) {
    for (let i = 1; i < PHASES.length; i++) {
      if (minute <= PHASES[i][0]) {
        const [m0, c0, i0] = PHASES[i - 1];
        const [m1, c1, i1] = PHASES[i];
        const f = (minute - m0) / Math.max(1, m1 - m0);
        return { color: c0.clone().lerp(c1, f), strength: i0 + (i1 - i0) * f };
      }
    }
    return { color: PHASES[0][1].clone(), strength: PHASES[0][2] };
  }

  function updateDaylight(dt) {
    dayClock += dt;
    if (dayClock < 1) return; // 1 Hz is plenty for the sun
    dayClock = 0;
    const st = appRef.app.state;
    if (!st) return;
    const minute = ((st.clock.minutes % 1440) + 1440) % 1440;
    const sun = daylightAt(minute);
    const dingy = new THREE.Color(0x77705f);
    windowMat.color.copy(dingy.lerp(sun.color, Math.min(1, condT * 1.5)));
    winLight.intensity = (0.95 + 0.45 * condT) * sun.strength;
    winLight.color.copy(sun.color);
  }

  function refreshCondition() {
    const st = appRef.app.state;
    conditionNow = st && st.shop ? shopCondition(st) : 100;
    const t = clamp(conditionNow / 100, 0, 1);
    ambient.intensity = 0.46 + 0.29 * t;
    condT = t;
    dayClock = 1; // let the daylight pass re-apply the window state now
    floorMat.color.lerpColors(new THREE.Color(0x83786a), WHITE, t);
    wallMat.color.lerpColors(new THREE.Color(0xa2977f), WHITE, t);
    ceilMat.color.lerpColors(new THREE.Color(0x4e463c), new THREE.Color(0xcfc4ab), t);
    wainscotMat.color.lerpColors(new THREE.Color(0x4a5a48), new THREE.Color(0x57795c), t);
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

  // --- the vacuum: equip (F), hold LMB to clean the patch you're facing ---------------
  // same equip/aim/hold shape as the course hose; feedback is the dust overlay
  // receding in place plus motes streaming into the nozzle
  scene.add(camera); // held tools are camera children
  let tool = null;
  let vacuuming = false;
  let cleanClock = 0;

  const wand = new THREE.Group();
  const wandBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, 0.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6 }),
  );
  wandBody.rotation.x = Math.PI / 2 - 0.22;
  const wandHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.06, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xc23327, roughness: 0.55 }), // guide §4 equipment red
  );
  wandHead.position.set(0, -0.09, -0.32);
  wand.add(wandBody, wandHead);
  wand.position.set(0.34, -0.42, -0.7);
  wand.visible = false;
  camera.add(wand);

  const MOTES = 26;
  const moteState = [];
  const motePos = new Float32Array(MOTES * 3);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0xa2937c, size: 0.05, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  motes.visible = false;
  motes.frustumCulled = false;
  scene.add(motes);
  for (let i = 0; i < MOTES; i++) moteState.push({ t: Math.random(), ox: 0, oz: 0 });

  const aimPoint = () => ({
    x: player.x - Math.sin(player.yaw) * 1.15,
    z: player.z - Math.cos(player.yaw) * 1.15,
  });

  // equip easing + a small carried bob — same feel language as the course tools
  const wandAnim = { t: 1, show: false };
  let wandBob = 0;

  function setTool(t) {
    tool = t;
    if (tool === 'vacuum') {
      wand.visible = true;
      wandAnim.show = true;
      wandAnim.t = 0;
    } else if (wand.visible) {
      wandAnim.show = false;
      wandAnim.t = 0;
    }
    if (!tool) { vacuuming = false; motes.visible = false; }
  }

  function updateWandFeel(dt) {
    if (!wand.visible) return;
    wandAnim.t = Math.min(1, wandAnim.t + dt / 0.24);
    const e = 1 - Math.pow(1 - wandAnim.t, 3);
    const k = wandAnim.show ? e : 1 - e;
    if (!wandAnim.show && wandAnim.t >= 1) {
      wand.visible = false;
      return;
    }
    const moving = held.has('w') || held.has('a') || held.has('s') || held.has('d');
    wandBob += dt * (moving ? 8.7 : 1.6);
    const sway = moving ? 1 : 0.25;
    wand.position.set(
      0.34 + Math.cos(wandBob * 0.5) * 0.008 * sway,
      -0.42 - 0.34 * (1 - k) + Math.sin(wandBob) * 0.011 * sway,
      -0.7,
    );
    wand.rotation.x = 0.4 * (1 - k);
  }

  function setVacuuming(v) {
    vacuuming = v && tool === 'vacuum';
    motes.visible = vacuuming;
  }

  function updateVacuum(dt) {
    if (!vacuuming) return;
    const aim = aimPoint();
    const res = cleanGrimeAt(appRef.app.state, aim.x, aim.z, 0.5 * dt);
    cleanClock += dt;
    if (cleanClock > 0.16) { // repaint/relight at ~6 Hz, not every frame
      cleanClock = 0;
      if (res.cleaned > 0) repaintGrime();
      refreshCondition();
    }
    // motes stream from the floor around the aim point up into the nozzle
    wand.updateMatrixWorld();
    const noz = new THREE.Vector3();
    wandHead.getWorldPosition(noz);
    for (let i = 0; i < MOTES; i++) {
      const m = moteState[i];
      m.t += dt * (1.6 + (i % 5) * 0.14);
      if (m.t >= 1) {
        m.t = 0;
        m.ox = (Math.random() - 0.5) * 1.1;
        m.oz = (Math.random() - 0.5) * 1.1;
      }
      const sx = aim.x + m.ox;
      const sz = aim.z + m.oz;
      motePos[i * 3] = sx + (noz.x - sx) * m.t;
      motePos[i * 3 + 1] = 0.03 + (noz.y - 0.03) * m.t * m.t;
      motePos[i * 3 + 2] = sz + (noz.z - sz) * m.t;
    }
    moteGeo.attributes.position.needsUpdate = true;
  }

  // --- live stock visualization -----------------------------------------------------------
  const stockMeshes = new Map(); // skuId -> Group

  function rebuildStock() {
    for (const g of stockMeshes.values()) stockGroup.remove(g);
    stockMeshes.clear();
    const inv = appRef.app.state.shop.inventory;

    for (const fixture of FIXTURES) {
      const anchor = fixture.anchor;
      const hangCursor = { n: 0 }; // shared across this fixture's hung garments
      fixture.skus.forEach((skuId, idx) => {
        const sku = SHOP_CATALOG.find((s) => s.id === skuId);
        const count = inv[skuId].shelf;
        const g = new THREE.Group();
        const isClub = sku.cat === 'clubs';
        const color = new THREE.Color(CAT_COLORS[sku.cat]);
        color.offsetHSL(0, 0, (sku.tier - 2) * 0.09);
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });

        // distinct silhouettes per product type (reference density/variety):
        // clubs lean on racks, balls stack as sleeves + loose pyramids, polos
        // fold in their real colors or hang from the rail, caps show dome+brim,
        // towels roll, small goods stay honest little boxes
        const POLO_TINTS = { polo1: 0x3f7a34, polo2: 0x3b6fb3, jacket2: 0x2c3e66 };
        const white = new THREE.MeshStandardMaterial({ color: 0xf5f2e8, roughness: 0.6 });

        if (isClub) {
          for (let i = 0; i < Math.min(count, 6); i++) {
            const lean = 0.16 + (i % 3) * 0.03;
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 5), m);
            shaft.position.set(-1.0 + idx * 0.45 + i * 0.07, 0.72, 0.12 - i * 0.03);
            shaft.rotation.z = lean;
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.13), m);
            head.position.set(shaft.position.x - 0.1, 0.16, shaft.position.z);
            g.add(shaft, head);
            if (sku.id.startsWith('driver')) {
              const cover = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), m);
              cover.position.set(shaft.position.x + 0.09, 1.27, shaft.position.z);
              g.add(cover);
            }
          }
        } else if (sku.cat === 'balls') {
          const show = Math.min(count, 12);
          for (let i = 0; i < show; i++) {
            const layer = Math.floor(i / 3);
            const col = i % 3;
            const boardY = [0.5, 1.05, 1.6][layer % 3];
            const item = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), m);
            // spread across the board face, second course stacks on top
            item.position.set(
              -1.05 + idx * 0.56 + col * 0.17,
              boardY + 0.09 + Math.floor(layer / 3) * 0.125,
              0.1,
            );
            item.castShadow = true;
            g.add(item);
          }
          // a loose pyramid of balls beside each facing sells "golf" instantly
          if (show >= 3) {
            const bx = -1.05 + idx * 0.56 + 0.38;
            for (const [ox, oz, oy] of [[0, 0, 0], [0.055, 0, 0], [0.028, 0.045, 0], [0.028, 0.018, 0.045]]) {
              const ball = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), white);
              ball.position.set(bx + ox, 1.05 + 0.026 + oy, 0.14 + oz);
              g.add(ball);
            }
          }
        } else if (sku.cat === 'apparel' && POLO_TINTS[sku.id] && count > 0) {
          const tint = new THREE.MeshStandardMaterial({ color: POLO_TINTS[sku.id], roughness: 0.85 });
          const show = Math.min(count, 10);
          const folded = Math.min(show, 6);
          for (let i = 0; i < folded; i++) {
            // folded pile on the table: soft slabs with a collar stripe
            const slab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.055, 0.24), tint);
            slab.position.set(-0.85 + idx * 0.42, 1.03 + (i % 3) * 0.062, -0.15 + Math.floor(i / 3) * 0.3);
            slab.rotation.y = (i % 2) * 0.09 - 0.045;
            slab.castShadow = true;
            g.add(slab);
            const collar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.05), white);
            collar.position.set(slab.position.x, slab.position.y + 0.034, slab.position.z + 0.08);
            g.add(collar);
          }
          // the rest hang from the rail (a shared cursor keeps every shirt ON it)
          for (let i = 0; i < show - folded && i < 4; i++) {
            const hx = Math.min(-0.82 + hangCursor.n++ * 0.17, 0.85);
            const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 5), darkMat);
            hook.position.set(hx, 1.63, -0.62);
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.035), tint);
            body.position.set(hx, 1.38, -0.62);
            body.rotation.y = 0.08;
            body.castShadow = true;
            const sleeveL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.03), tint);
            sleeveL.position.set(hx - 0.19, 1.5, -0.62);
            sleeveL.rotation.z = 0.5;
            const sleeveR = sleeveL.clone();
            sleeveR.position.x = hx + 0.19;
            sleeveR.rotation.z = -0.5;
            g.add(hook, body, sleeveL, sleeveR);
          }
        } else if (sku.id === 'cap1') {
          const show = Math.min(count, 8);
          for (let i = 0; i < show; i++) {
            const capMat = i % 3 === 0 ? new THREE.MeshStandardMaterial({ color: 0x2c3e66, roughness: 0.85 }) : white;
            const dome = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
            const brim = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.014, 0.09), capMat);
            const px = -0.85 + idx * 0.42 + (i % 2) * 0.22;
            const pz = -0.42 + Math.floor(i / 2) * 0.24;
            dome.position.set(px, 1.02 + 0.0, pz);
            brim.position.set(px, 1.005, pz + 0.1);
            dome.castShadow = true;
            g.add(dome, brim);
          }
        } else if (sku.id === 'glove1') {
          const show = Math.min(count, 8);
          for (let i = 0; i < show; i++) {
            const glove = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.2), white);
            glove.position.set(-0.85 + idx * 0.42 + (i % 2) * 0.14, 1.02 + Math.floor(i / 2) * 0.026, 0.28);
            glove.rotation.y = (i % 2) * 0.2 - 0.1;
            g.add(glove);
          }
        } else if (sku.id === 'towel1') {
          const show = Math.min(count, 9);
          for (let i = 0; i < show; i++) {
            const layer = Math.floor(i / 3);
            const boardY = [0.5, 1.05, 1.6][layer % 3];
            const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), white);
            roll.rotation.x = Math.PI / 2;
            roll.position.set(-1.05 + idx * 0.56 + (i % 3) * 0.11, boardY + 0.08, 0.1);
            roll.castShadow = true;
            g.add(roll);
          }
        } else {
          const box = sku.cat === 'apparel' ? [0.26, 0.07, 0.2] : sku.id === 'range2' ? [0.1, 0.12, 0.16] : [0.14, 0.1, 0.12];
          const show = Math.min(count, 12);
          for (let i = 0; i < show; i++) {
            const item = new THREE.Mesh(new THREE.BoxGeometry(...box), sku.id === 'range2' ? new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.5 }) : m);
            const layer = Math.floor(i / 3);
            const col = i % 3;
            const boardY = [0.5, 1.05, 1.6][layer % 3];
            item.position.set(
              -1.05 + idx * 0.56 + (Math.floor(layer / 3)) * 0.2,
              boardY + 0.03 + box[1] / 2,
              0.06 + col * (box[2] * 0.35),
            );
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

  // customers queue at the register in a real line angling back into the floor
  const QUEUE_BASE = { x: ROOM.w / 2 - 2.5, z: 1.4 };
  const QUEUE_STEP = { x: -0.62, z: 0.68 };
  const counterQueue = []; // customer objects, slot 0 = being served

  function queueSlot(i) {
    return { x: QUEUE_BASE.x + QUEUE_STEP.x * i, z: QUEUE_BASE.z + QUEUE_STEP.z * i };
  }

  function spawnCustomer(toCounter = false) {
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

    // stops are typed: fixtures get browsed facing the shelf, the counter is a
    // queue you join, the door is the way out
    const stops = [];
    if (!toCounter) {
      const nStops = 1 + rng.int(2);
      for (let i = 0; i < nStops; i++) {
        const f = FIXTURES[rng.int(FIXTURES.length)];
        const p = f.anchor.position;
        stops.push({
          kind: 'fixture',
          x: p.x + (rng.next() - 0.5) * 1.2,
          z: p.z + (p.z < -3 ? 1.1 : p.z > 3 ? -1.1 : 1.2),
          faceX: p.x,
          faceZ: p.z,
        });
      }
    }
    if (toCounter || rng.chance(0.55)) {
      stops.push({ kind: 'counter', x: QUEUE_BASE.x, z: QUEUE_BASE.z, faceX: ROOM.w / 2 - 1.3, faceZ: 1.4 });
    }
    stops.push({ kind: 'door', x: 0, z: ROOM.d / 2 - 0.6 });

    customers.push({
      mesh: g,
      stops,
      stopIdx: 0,
      linger: toCounter ? 26 + rng.next() * 10 : 2 + rng.next() * 4,
      speed: toCounter ? 1.15 : 1.1 + rng.next() * 0.5,
      queued: false,
    });
  }

  // booked golfers physically show up around their slot (visual layer only)
  const arrivedResIds = new Set();
  function updateArrivals() {
    const st = appRef.app.state;
    if (!st || !st.reservations) return;
    for (const r of dueForCheckIn(st)) {
      if (arrivedResIds.has(r.id)) continue;
      arrivedResIds.add(r.id);
      spawnCustomer(true);
    }
  }

  function leaveQueue(c) {
    const qi = counterQueue.indexOf(c);
    if (qi >= 0) {
      counterQueue.splice(qi, 1);
      c.queued = false;
    }
  }

  // the same push-out resolution the player uses, sized for a customer
  function resolveCustomer(c, nx, nz) {
    const r = 0.3;
    for (const col of colliders) {
      if (nx + r > col.minX && nx - r < col.maxX && nz + r > col.minZ && nz - r < col.maxZ) {
        const pushLeft = nx + r - col.minX;
        const pushRight = col.maxX - (nx - r);
        const pushUp = nz + r - col.minZ;
        const pushDown = col.maxZ - (nz - r);
        const min = Math.min(pushLeft, pushRight, pushUp, pushDown);
        if (min === pushLeft) nx = col.minX - r;
        else if (min === pushRight) nx = col.maxX + r;
        else if (min === pushUp) nz = col.minZ - r;
        else nz = col.maxZ + r;
      }
    }
    // never through the player…
    const pd = Math.hypot(nx - player.x, nz - player.z);
    if (pd > 0.01 && pd < 0.72) {
      nx = player.x + ((nx - player.x) / pd) * 0.72;
      nz = player.z + ((nz - player.z) / pd) * 0.72;
    }
    // …or through each other
    for (const o of customers) {
      if (o === c) continue;
      const dx = nx - o.mesh.position.x;
      const dz = nz - o.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.6) {
        nx = o.mesh.position.x + (dx / d) * 0.6;
        nz = o.mesh.position.z + (dz / d) * 0.6;
      }
    }
    return { nx: clamp(nx, -ROOM.w / 2 + 0.4, ROOM.w / 2 - 0.4), nz: clamp(nz, -ROOM.d / 2 + 0.4, ROOM.d / 2 - 0.4) };
  }

  function updateCustomers(dt) {
    // presence scales with yesterday's real traffic (x3 for liveliness)
    const targetCount = clamp(Math.round(((appRef.app.state.shop.salesYesterday.units || 2) / 8) * 3), 1, 6);
    if (customers.length < targetCount && Math.random() < dt * 0.15) spawnCustomer();

    for (let i = customers.length - 1; i >= 0; i--) {
      const c = customers[i];
      const char = c.mesh.userData.char;
      if (char) char.update(dt);
      const stop = c.stops[c.stopIdx];

      // the counter is a queue: join it on approach, target your slot, only
      // the head of the line gets served (linger), everyone else waits
      let tx = stop.x;
      let tz = stop.z;
      if (stop.kind === 'counter') {
        if (!c.queued) {
          counterQueue.push(c);
          c.queued = true;
        }
        const slot = queueSlot(counterQueue.indexOf(c));
        tx = slot.x;
        tz = slot.z;
      }

      const dx = tx - c.mesh.position.x;
      const dz = tz - c.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.15) {
        const served = stop.kind !== 'counter' || counterQueue.indexOf(c) === 0;
        if (!served) {
          // waiting in line: stand patient, face the counter
          if (char) char.setMode('Idle');
        } else if (c.linger > 0) {
          if (char) char.setMode(stop.kind === 'fixture' ? 'Browse' : 'Idle');
          c.linger -= dt;
        } else {
          if (stop.kind === 'counter') leaveQueue(c);
          c.stopIdx++;
          c.linger = 1.5 + Math.random() * 3.5;
          if (c.stopIdx >= c.stops.length) {
            leaveQueue(c);
            custGroup.remove(c.mesh);
            customers.splice(i, 1);
            continue;
          }
        }
        // settle into facing the thing you're at
        if (stop.faceX !== undefined) {
          const want = Math.atan2(stop.faceX - c.mesh.position.x, stop.faceZ - c.mesh.position.z);
          let dy = want - c.mesh.rotation.y;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          c.mesh.rotation.y += dy * Math.min(1, dt * 6);
        }
      } else {
        if (char) char.setMode('Walk');
        const step = Math.min(dist, c.speed * dt);
        const res = resolveCustomer(c, c.mesh.position.x + (dx / dist) * step, c.mesh.position.z + (dz / dist) * step);
        c.mesh.position.x = res.nx;
        c.mesh.position.z = res.nz;
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
    redrawLogo();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
  }

  function exit() {
    active = false;
    setTool(null); // stow the vacuum on the way out
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
    updateVacuum(dt);
    updateWandFeel(dt);
    updateDoor(dt);
    updateDaylight(dt);

    // deliveries can land while you stand here — surface new ghosts within a second
    decorPoll += dt;
    if (decorPoll > 1.1) {
      decorPoll = 0;
      updateArrivals();
      const sig = decorSignature();
      if (sig !== decorSig) {
        decorSig = sig;
        rebuildDecor();
      }
    }

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
    setTool,
    getTool: () => tool,
    setVacuuming,
    isVacuuming: () => vacuuming,
    getFocusLabel: () => (focused ? focused.label() : null),
    getPlayer: () => player,
    domElement: renderer.domElement,
  };
}
