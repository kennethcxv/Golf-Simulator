// THE CLUBHOUSE — one real building in the course world. The exterior shell
// and the pro-shop interior are the SAME geometry (walls with true openings),
// so they align by construction: you walk up the porch, open the hinged door
// with [E], and step inside with no transition, fade, or scene swap.
//
// Everything in here reads/writes game state ONLY through sim functions —
// this stays a live window onto state.shop, never a second simulation.
// Coordinates: the floor plan (src/data/shopLayout.js) is building-local;
// interaction props and colliders register into the course scene's shared
// walkProps/propColliders in WORLD coordinates.

import * as THREE from 'three';
import { clamp, rngOf } from '../core/utils.js';
import { makeCharacter } from './characterAsset.js';
import { SHOP_CATALOG, SHELF_CAP, DECOR_SPOTS } from '../data/shopItems.js';
import {
  SHELL, INTERIOR, FIXTURES, COUNTER, OFFICE, STOCKROOM, LOUNGE,
  DOOR_MAIN, DOOR_STOCK, DOOR_BACK, WINDOWS, WINDOW_DIM, PARTITIONS,
  MAT, HOURS_SIGN, queueSlot,
} from '../data/shopLayout.js';
import {
  RENO, shopCondition, cleanGrimeAt, clearClutter, placeDecor, removeDecor,
  restockShelfFromBackroom, priceFor,
} from '../sim/shop.js';
import {
  boxesOf, pickUpBox, putDownBox, carriedBox, openBox, emptyTrash,
} from '../sim/deliveries.js';
import { pickFromShelf, returnToShelf, checkoutSale } from '../sim/checkout.js';
import { tutorialFlag } from '../sim/tutorial.js';
import { dueForCheckIn, checkInReservation, fmtSlot } from '../sim/reservations.js';
import { makeWoodTexture, makePlasterTexture } from './proceduralTextures.js';

const CAT_COLORS = { balls: 0xf3f0e4, accessories: 0xc9a55a, apparel: 0x7f9fc2, clubs: 0x9a8265 };
const FLOOR_TOP = 0.3; // interior floor (and porch deck) height over the terrain base

export function makeClubhouse(ctx) {
  // ctx: { scene, camera, state, center:{x,z}, heightAt, walkProps, propColliders, walk, hooks }
  const { scene, camera, state, center, heightAt, walkProps, propColliders, walk, hooks } = ctx;
  const baseY = heightAt(center.x, center.z);
  const floorY = baseY + FLOOR_TOP;

  const group = new THREE.Group();          // shell: walls, roof, porch — always visible
  group.position.set(center.x, baseY, center.z);
  const interior = new THREE.Group();       // fixtures, stock, grime, decor — distance-gated
  interior.position.set(center.x, floorY, center.z);
  const custGroup = new THREE.Group();      // customers walk in WORLD space (they go outside)
  scene.add(group, interior, custGroup);

  const L2W = (lx, lz) => ({ x: center.x + lx, z: center.z + lz });
  const W2L = (wx, wz) => ({ x: wx - center.x, z: wz - center.z });
  const isInside = (wx, wz) => {
    const l = W2L(wx, wz);
    return Math.abs(l.x) < INTERIOR.w / 2 && Math.abs(l.z) < INTERIOR.d / 2;
  };
  const onPorch = (wx, wz) => {
    const l = W2L(wx, wz);
    return Math.abs(l.x) < SHELL.w * 0.35 && l.z >= INTERIOR.d / 2 && l.z <= SHELL.d / 2 + SHELL.porchD;
  };
  const groundYAt = (wx, wz) => (isInside(wx, wz) || onPorch(wx, wz) ? floorY : null);

  // every collider registers in BOTH the player's shared list and the local
  // customer list; dynamic ones (doors, clutter, decor) toggle through these
  const custCols = [];
  const registeredProps = [];
  const registeredCols = [];
  function addCol(col) {
    propColliders.push(col);
    custCols.push(col);
    registeredCols.push(col);
    return col;
  }
  function removeCol(col) {
    for (const arr of [propColliders, custCols, registeredCols]) {
      const i = arr.indexOf(col);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  function addProp(p) {
    walkProps.push(p);
    registeredProps.push(p);
    return p;
  }
  function removeProp(p) {
    for (const arr of [walkProps, registeredProps]) {
      const i = arr.indexOf(p);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  const colBoxAt = (lx, lz, w, d) => {
    const p = L2W(lx, lz);
    return { minX: p.x - w / 2, maxX: p.x + w / 2, minZ: p.z - d / 2, maxZ: p.z + d / 2 };
  };

  // --- materials (style guide: cream siding, white trim, sage roof; warm interior) ----
  const texLoader = new THREE.TextureLoader();
  const loadTex = (file, srgb) => {
    const t = texLoader.load(`vendor/textures/${file}`, undefined, undefined, () => {});
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const sidingNor = loadTex('siding_nor.jpg');
  sidingNor.repeat.set(7, 2.4);
  const roofNor = loadTex('roof_nor.jpg');
  roofNor.repeat.set(4, 2);
  const sidingMat = new THREE.MeshStandardMaterial({ color: 0xe9e2cc, normalMap: sidingNor, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf5f2e6, roughness: 0.7 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x57795c, normalMap: roofNor, roughness: 0.75, side: THREE.DoubleSide });
  const woodTex = makeWoodTexture({});
  woodTex.repeat.set(7, 5);
  const plasterTex = makePlasterTexture({});
  plasterTex.repeat.set(10, 2);
  const floorMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.7 });
  const wallMat = new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.92 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x6b6156, roughness: 0.95 });
  const wainscotMat = new THREE.MeshStandardMaterial({ color: 0x57795c, roughness: 0.85 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6e5335, roughness: 0.8 });
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.85 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6b48, roughness: 0.75 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x53422e, roughness: 0.85 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xcfe4ee, roughness: 0.08, metalness: 0.3,
    transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
  });

  // --- walls with REAL openings ---------------------------------------------------------
  // A wall is a run of box segments; window holes stay see-through, door holes
  // stay walk-through. Collision is 2D: solid along the run except door gaps.
  // Boxes get siding outside / plaster inside via material arrays.
  function buildWall({ axis, at, from, to, openings = [], insideDir }) {
    // axis 'x': runs along x at z = at (insideDir −1 means interior is at z < at)
    const wallH = SHELL.wallH;
    const segs = [];
    const doors = openings.filter((o) => o.isDoor);
    const sorted = [...openings].sort((a, b) => a.c - b.c);
    let cursor = from;
    for (const o of sorted) {
      const o0 = o.c - o.w / 2;
      const o1 = o.c + o.w / 2;
      if (o0 > cursor) segs.push({ a: cursor, b: o0, y0: 0, y1: wallH });
      // header above the opening (and sill below, for windows)
      segs.push({ a: o0, b: o1, y0: FLOOR_TOP + o.top, y1: wallH });
      if (o.bottom > 0) segs.push({ a: o0, b: o1, y0: 0, y1: FLOOR_TOP + o.bottom });
      cursor = o1;
    }
    if (cursor < to) segs.push({ a: cursor, b: to, y0: 0, y1: wallH });

    for (const s of segs) {
      const len = s.b - s.a;
      const h = s.y1 - s.y0;
      if (len <= 0.01 || h <= 0.01) continue;
      const geo = axis === 'x'
        ? new THREE.BoxGeometry(len, h, SHELL.wallT)
        : new THREE.BoxGeometry(SHELL.wallT, h, len);
      // material per face: [+x, -x, +y, -y, +z, -z]
      let mats;
      if (axis === 'x') {
        mats = [trimMat, trimMat, trimMat, trimMat,
          insideDir < 0 ? sidingMat : wallMat, insideDir < 0 ? wallMat : sidingMat];
      } else {
        mats = [insideDir < 0 ? sidingMat : wallMat, insideDir < 0 ? wallMat : sidingMat,
          trimMat, trimMat, trimMat, trimMat];
      }
      const m = new THREE.Mesh(geo, mats);
      const mid = (s.a + s.b) / 2;
      if (axis === 'x') m.position.set(mid, (s.y0 + s.y1) / 2, at);
      else m.position.set(at, (s.y0 + s.y1) / 2, mid);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    // 2D collision: the run minus door gaps only
    const gaps = doors.map((d) => [d.c - d.w / 2, d.c + d.w / 2]).sort((a, b) => a[0] - b[0]);
    let c = from;
    const spans = [];
    for (const [g0, g1] of gaps) {
      if (g0 > c) spans.push([c, g0]);
      c = g1;
    }
    if (c < to) spans.push([c, to]);
    for (const [a, b] of spans) {
      if (axis === 'x') addCol(colBoxAt((a + b) / 2, at, b - a, SHELL.wallT + 0.12));
      else addCol(colBoxAt(at, (a + b) / 2, SHELL.wallT + 0.12, b - a));
    }
  }

  const win = (c) => ({ c, w: WINDOW_DIM.w, top: WINDOW_DIM.sill + WINDOW_DIM.h, bottom: WINDOW_DIM.sill });
  const halfW = SHELL.w / 2 - SHELL.wallT / 2; // wall centerlines
  const halfD = SHELL.d / 2 - SHELL.wallT / 2;
  buildWall({
    axis: 'x', at: halfD, from: -SHELL.w / 2, to: SHELL.w / 2, insideDir: -1,
    openings: [
      { c: DOOR_MAIN.x, w: DOOR_MAIN.w, top: DOOR_MAIN.h, bottom: 0, isDoor: true },
      ...WINDOWS.filter((w) => w.wall === 'S').map((w) => win(w.c)),
    ],
  });
  buildWall({
    axis: 'x', at: -halfD, from: -SHELL.w / 2, to: SHELL.w / 2, insideDir: 1,
    openings: WINDOWS.filter((w) => w.wall === 'N').map((w) => win(w.c)),
  });
  buildWall({ axis: 'z', at: -halfW, from: -SHELL.d / 2, to: SHELL.d / 2, insideDir: 1, openings: [] });
  buildWall({
    axis: 'z', at: halfW, from: -SHELL.d / 2, to: SHELL.d / 2, insideDir: -1,
    openings: [
      { c: DOOR_BACK.z, w: DOOR_BACK.w, top: DOOR_BACK.h, bottom: 0, isDoor: true },
      ...WINDOWS.filter((w) => w.wall === 'E').map((w) => win(w.c)),
    ],
  });

  // window glass + trim on both faces
  for (const w of WINDOWS) {
    const y = FLOOR_TOP + WINDOW_DIM.sill + WINDOW_DIM.h / 2;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_DIM.w, WINDOW_DIM.h), glassMat);
    let px = 0; let pz = 0; let ry = 0;
    if (w.wall === 'S') { px = w.c; pz = halfD; ry = 0; }
    if (w.wall === 'N') { px = w.c; pz = -halfD; ry = 0; }
    if (w.wall === 'E') { px = halfW; pz = w.c; ry = Math.PI / 2; }
    glass.position.set(px, y, pz);
    glass.rotation.y = ry;
    group.add(glass);
    for (const face of [-1, 1]) {
      const off = face * (SHELL.wallT / 2 + 0.02);
      const mk = (tw, th, ty, tx) => {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(tw, th, 0.05), railMat);
        if (ry === 0) trim.position.set(px + tx, y + ty, pz + off);
        else { trim.position.set(px + off, y + ty, pz + tx); trim.rotation.y = Math.PI / 2; }
        group.add(trim);
      };
      mk(WINDOW_DIM.w + 0.2, 0.08, WINDOW_DIM.h / 2 + 0.03, 0);
      mk(WINDOW_DIM.w + 0.2, 0.08, -WINDOW_DIM.h / 2 - 0.03, 0);
      mk(0.08, WINDOW_DIM.h + 0.16, 0, -WINDOW_DIM.w / 2 - 0.06);
      mk(0.08, WINDOW_DIM.h + 0.16, 0, WINDOW_DIM.w / 2 + 0.06);
      mk(0.05, WINDOW_DIM.h, 0, 0);
    }
  }

  // --- roof, gables, porch, chimney (the kept silhouette, ridge down the long axis) ----
  {
    const { w: W2, d: D2, wallH: WALL_H, peak: PEAK, porchD: PORCH_D } = SHELL;
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-D2 / 2, 0);
    gableShape.lineTo(D2 / 2, 0);
    gableShape.lineTo(0, PEAK);
    gableShape.closePath();
    const gableGeo = new THREE.ShapeGeometry(gableShape);
    for (const xSide of [-1, 1]) {
      const gable = new THREE.Mesh(gableGeo, sidingMat);
      gable.position.set(xSide * (W2 / 2 - 0.01), WALL_H, 0);
      gable.rotation.y = xSide > 0 ? -Math.PI / 2 : Math.PI / 2;
      gable.castShadow = true;
      group.add(gable);
    }
    const slopeLen = Math.hypot(PEAK, D2 / 2) + 1.6;
    const roofPitch = Math.atan2(PEAK, D2 / 2);
    for (const zSide of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W2 + 2.8, 0.22, slopeLen), roofMat);
      slab.rotation.x = zSide * roofPitch;
      slab.position.set(0, WALL_H + PEAK / 2 + 0.1, zSide * (D2 / 4 + 0.35));
      slab.castShadow = true;
      slab.receiveShadow = true;
      group.add(slab);
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(W2 + 2.4, 0.25, 0.6), trimMat);
    ridge.position.set(0, WALL_H + PEAK + 0.15, 0);
    group.add(ridge);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(W2 * 0.7, FLOOR_TOP, PORCH_D), trimMat);
    slab.position.set(0, FLOOR_TOP / 2, D2 / 2 + PORCH_D / 2);
    slab.receiveShadow = true;
    group.add(slab);
    const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(W2 * 0.7 + 1, 0.22, PORCH_D + 0.8), roofMat);
    porchRoof.position.set(0, WALL_H - 0.6, D2 / 2 + PORCH_D / 2);
    porchRoof.castShadow = true;
    group.add(porchRoof);
    for (const px of [-W2 * 0.32, -W2 * 0.11, W2 * 0.11, W2 * 0.32]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, WALL_H - 0.9 - FLOOR_TOP, 8), trimMat);
      col.position.set(px, (WALL_H - 0.9 + FLOOR_TOP) / 2, D2 / 2 + PORCH_D - 0.5);
      col.castShadow = true;
      group.add(col);
      addCol(colBoxAt(px, D2 / 2 + PORCH_D - 0.5, 0.4, 0.4));
    }
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 1.1), trimMat);
    step.position.set(DOOR_MAIN.x, 0.08, D2 / 2 + PORCH_D + 0.5);
    group.add(step);
    const chimney = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 3.2, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x7a5a4a, roughness: 0.9 }),
    );
    chimney.position.set(W2 * 0.3, WALL_H + PEAK - 0.4, -D2 * 0.15);
    chimney.castShadow = true;
    group.add(chimney);

    // hours sign by the door — store identity at the entrance
    const signCv = document.createElement('canvas');
    signCv.width = 128; signCv.height = 96;
    const sc = signCv.getContext('2d');
    sc.fillStyle = '#f2eee0'; sc.fillRect(0, 0, 128, 96);
    sc.fillStyle = '#1f4a26'; sc.fillRect(0, 0, 128, 26);
    sc.fillStyle = '#f2eee0'; sc.font = 'bold 15px Georgia'; sc.textAlign = 'center';
    sc.fillText('PRO SHOP', 64, 18);
    sc.fillStyle = '#2b2b30'; sc.font = '13px Georgia';
    sc.fillText('OPEN DAILY', 64, 48);
    sc.fillText('6 AM – 8 PM', 64, 68);
    const signTex = new THREE.CanvasTexture(signCv);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.6),
      new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.85 }),
    );
    sign.position.set(HOURS_SIGN.x, FLOOR_TOP + 1.55, halfD + SHELL.wallT / 2 + 0.02);
    group.add(sign);
  }

  // --- interior partitions (stockroom + office nook) -----------------------------------
  for (const p of PARTITIONS) {
    const openings = p.opening ? [{ c: p.opening.c, w: p.opening.w, top: DOOR_STOCK.h, bottom: 0, isDoor: true }] : [];
    // interior partitions are plaster both sides, ceiling height only
    const segs = [];
    let cursor = p.from;
    for (const o of openings.sort((a, b) => a.c - b.c)) {
      if (o.c - o.w / 2 > cursor) segs.push({ a: cursor, b: o.c - o.w / 2, y0: 0, y1: SHELL.h + FLOOR_TOP });
      segs.push({ a: o.c - o.w / 2, b: o.c + o.w / 2, y0: FLOOR_TOP + o.top, y1: SHELL.h + FLOOR_TOP });
      cursor = o.c + o.w / 2;
    }
    if (cursor < p.to) segs.push({ a: cursor, b: p.to, y0: 0, y1: SHELL.h + FLOOR_TOP });
    for (const s of segs) {
      const len = s.b - s.a;
      const h = s.y1 - s.y0;
      const geo = p.axis === 'x' ? new THREE.BoxGeometry(SHELL.wallT, h, len) : new THREE.BoxGeometry(len, h, SHELL.wallT);
      const m = new THREE.Mesh(geo, wallMat);
      const mid = (s.a + s.b) / 2;
      if (p.axis === 'x') m.position.set(p.at, (s.y0 + s.y1) / 2, mid);
      else m.position.set(mid, (s.y0 + s.y1) / 2, p.at);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    const gaps = openings.map((d) => [d.c - d.w / 2, d.c + d.w / 2]);
    let c = p.from;
    const spans = [];
    for (const [g0, g1] of gaps.sort((a, b) => a[0] - b[0])) {
      if (g0 > c) spans.push([c, g0]);
      c = g1;
    }
    if (c < p.to) spans.push([c, p.to]);
    for (const [a, b] of spans) {
      if (p.axis === 'x') addCol(colBoxAt(p.at, (a + b) / 2, SHELL.wallT + 0.12, b - a));
      else addCol(colBoxAt((a + b) / 2, p.at, b - a, SHELL.wallT + 0.12));
    }
  }

  // --- floor, ceiling, wainscot, beams ---------------------------------------------------
  {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(INTERIOR.w, FLOOR_TOP, INTERIOR.d), floorMat);
    slab.position.set(0, FLOOR_TOP / 2, 0);
    slab.receiveShadow = true;
    group.add(slab);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(INTERIOR.w, INTERIOR.d), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = SHELL.h;
    interior.add(ceil);
    for (const bz of [-5.8, -1.9, 2.0, 5.9]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(INTERIOR.w, 0.16, 0.15), beamMat);
      beam.position.set(0, SHELL.h - 0.09, bz);
      interior.add(beam);
    }
    // wainscot skirts + cap rails inside the exterior walls (door gap respected)
    const WAINSCOT_H = 0.92;
    const skirtSpecs = [
      { axis: 'x', at: INTERIOR.d / 2 - 0.02, from: -INTERIOR.w / 2, to: INTERIOR.w / 2, ry: Math.PI, gaps: [[DOOR_MAIN.x - DOOR_MAIN.w / 2, DOOR_MAIN.x + DOOR_MAIN.w / 2]] },
      { axis: 'x', at: -INTERIOR.d / 2 + 0.02, from: -INTERIOR.w / 2, to: INTERIOR.w / 2, ry: 0, gaps: [] },
      { axis: 'z', at: -INTERIOR.w / 2 + 0.02, from: -INTERIOR.d / 2, to: INTERIOR.d / 2, ry: Math.PI / 2, gaps: [] },
      { axis: 'z', at: INTERIOR.w / 2 - 0.02, from: -INTERIOR.d / 2, to: INTERIOR.d / 2, ry: -Math.PI / 2, gaps: [[DOOR_BACK.z - DOOR_BACK.w / 2, DOOR_BACK.z + DOOR_BACK.w / 2]] },
    ];
    for (const s of skirtSpecs) {
      let cursor = s.from;
      const spans = [];
      for (const [g0, g1] of s.gaps) {
        if (g0 > cursor) spans.push([cursor, g0]);
        cursor = g1;
      }
      if (cursor < s.to) spans.push([cursor, s.to]);
      for (const [a, b] of spans) {
        const len = b - a;
        const skirt = new THREE.Mesh(new THREE.PlaneGeometry(len, WAINSCOT_H), wainscotMat);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.03), railMat);
        const mid = (a + b) / 2;
        if (s.axis === 'x') {
          skirt.position.set(mid, WAINSCOT_H / 2, s.at);
          rail.position.set(mid, WAINSCOT_H + 0.02, s.at);
        } else {
          skirt.position.set(s.at, WAINSCOT_H / 2, mid);
          rail.position.set(s.at, WAINSCOT_H + 0.02, mid);
          rail.rotation.y = Math.PI / 2;
        }
        skirt.rotation.y = s.ry;
        interior.add(skirt, rail);
      }
    }
  }

  // --- grime overlay (the dirt you see IS state.shop.reno.grime) -------------------------
  const grimeCanvas = document.createElement('canvas');
  grimeCanvas.width = 832;
  grimeCanvas.height = 512;
  const grimeTex = new THREE.CanvasTexture(grimeCanvas);
  grimeTex.colorSpace = THREE.SRGBColorSpace;
  const grimePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(INTERIOR.w, INTERIOR.d),
    new THREE.MeshStandardMaterial({ map: grimeTex, transparent: true, depthWrite: false, roughness: 1 }),
  );
  grimePlane.rotation.x = -Math.PI / 2;
  grimePlane.position.y = 0.012;
  grimePlane.renderOrder = 1;
  interior.add(grimePlane);

  const hash01 = (n) => {
    const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  function repaintGrime() {
    const reno = state.shop && state.shop.reno;
    const c2 = grimeCanvas.getContext('2d');
    c2.clearRect(0, 0, grimeCanvas.width, grimeCanvas.height);
    if (!reno) { grimeTex.needsUpdate = true; return; }
    const px = grimeCanvas.width / RENO.grid.w;
    const py = grimeCanvas.height / RENO.grid.h;
    for (let cy = 0; cy < RENO.grid.h; cy++) {
      for (let cx = 0; cx < RENO.grid.w; cx++) {
        const d = reno.grime[cy * RENO.grid.w + cx];
        if (d <= 0.015) continue;
        const idx = cy * RENO.grid.w + cx;
        for (let b = 0; b < 3; b++) {
          const bx = (cx + 0.16 + 0.68 * hash01(idx * 7.3 + b * 3.1)) * px;
          const by = (cy + 0.16 + 0.68 * hash01(idx * 5.7 + b * 4.9 + 11)) * py;
          const r = (0.44 + 0.34 * hash01(idx * 3.3 + b)) * Math.min(px, py) * (0.6 + d * 0.6);
          const a = d * (0.34 + 0.26 * hash01(idx + b * 17));
          const g2 = c2.createRadialGradient(bx, by, r * 0.12, bx, by, r);
          g2.addColorStop(0, `rgba(148, 138, 116, ${a.toFixed(3)})`);
          g2.addColorStop(1, 'rgba(148, 138, 116, 0)');
          c2.fillStyle = g2;
          c2.fillRect(bx - r, by - r, r * 2, r * 2);
        }
        for (let b = 0; b < 3; b++) {
          const bx = (cx + 0.2 + 0.6 * hash01(idx * 9.1 + b * 6.7 + 5)) * px;
          const by = (cy + 0.2 + 0.6 * hash01(idx * 8.3 + b * 2.3 + 29)) * py;
          const r = (0.1 + 0.14 * hash01(idx * 4.9 + b + 3)) * Math.min(px, py);
          const a = d * (0.3 + 0.2 * hash01(idx * 2.1 + b * 13));
          const g2 = c2.createRadialGradient(bx, by, r * 0.2, bx, by, r);
          g2.addColorStop(0, `rgba(52, 43, 30, ${a.toFixed(3)})`);
          g2.addColorStop(1, 'rgba(52, 43, 30, 0)');
          c2.fillStyle = g2;
          c2.fillRect(bx - r, by - r, r * 2, r * 2);
        }
      }
    }
    grimeTex.needsUpdate = true;
  }

  // welcome mat inside the door
  {
    const matCv = document.createElement('canvas');
    matCv.width = 128; matCv.height = 64;
    const mc = matCv.getContext('2d');
    mc.fillStyle = '#5a4a33'; mc.fillRect(0, 0, 128, 64);
    mc.strokeStyle = '#8a7a5c'; mc.lineWidth = 5; mc.strokeRect(6, 6, 116, 52);
    mc.fillStyle = '#8a7a5c'; mc.font = 'bold 20px Georgia'; mc.textAlign = 'center';
    mc.fillText('WELCOME', 64, 40);
    const matTex = new THREE.CanvasTexture(matCv);
    matTex.colorSpace = THREE.SRGBColorSpace;
    const matMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 1.0),
      new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.95 }),
    );
    matMesh.rotation.x = -Math.PI / 2;
    matMesh.position.set(MAT.x, 0.016, MAT.z);
    matMesh.renderOrder = 1;
    interior.add(matMesh);
  }

  // --- hinged, E-operated, collidable doors ----------------------------------------------
  const doors = [];
  function makeDoor({ lx, lz, along, width, height, openSign, name, color = 0x3a5a40, autoFor = 'both' }) {
    // hinge at (lx,lz); slab extends `width` in +along direction ('x' or 'z')
    const hinge = new THREE.Group();
    hinge.position.set(lx, FLOOR_TOP, lz);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(along === 'x' ? width - 0.06 : 0.07, height - 0.04, along === 'x' ? 0.07 : width - 0.06),
      new THREE.MeshStandardMaterial({ color, roughness: 0.65 }),
    );
    slab.castShadow = true;
    if (along === 'x') slab.position.set(width / 2, (height - 0.04) / 2, 0);
    else slab.position.set(0, (height - 0.04) / 2, width / 2);
    hinge.add(slab);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xc9b37c, metalness: 0.6, roughness: 0.35 }),
    );
    if (along === 'x') knob.position.set(width - 0.14, 1.05, 0.07);
    else knob.position.set(0.07, 1.05, width - 0.14);
    hinge.add(knob);
    group.add(hinge);

    const slabCenter = along === 'x' ? { x: lx + width / 2, z: lz } : { x: lx, z: lz + width / 2 };
    const collider = along === 'x'
      ? colBoxAt(slabCenter.x, slabCenter.z, width, 0.3)
      : colBoxAt(slabCenter.x, slabCenter.z, 0.3, width);
    addCol(collider);

    const door = {
      name, hinge, angle: 0, open: false, openSign, collider, colliderOn: true,
      autoFor, lastNear: 0,
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
    openSign: -1, name: 'Shop door',
  });
  makeDoor({
    lx: DOOR_STOCK.hingeX, lz: 2.0, along: 'x', width: DOOR_STOCK.w - 0.06, height: DOOR_STOCK.h,
    openSign: 1, name: 'Stockroom door', color: 0x6e5335,
  });
  makeDoor({
    lx: halfW, lz: DOOR_BACK.hingeZ, along: 'z', width: DOOR_BACK.w - 0.08, height: DOOR_BACK.h,
    openSign: 1, name: 'Receiving door', color: 0x6e5335,
  });

  function updateDoors(dt, now) {
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
        if (audible && hooks.sfx) hooks.sfx('doorSwing');
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

  // --- lighting: interior bulbs (the sun and sky live outside the windows) --------------
  const BULB_I = 26;
  const bulbs = [];
  for (const [lx, lz] of [[-8, 0], [-1.5, 0], [5, 0.6], [10.6, -2.8], [10.6, 4.8]]) {
    const bulb = new THREE.PointLight(0xffe2b0, BULB_I, 13, 1.7);
    bulb.position.set(lx, SHELL.h - 0.25, lz);
    interior.add(bulb);
    const fixture = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.34, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0x2c2620, emissive: 0xffe2b0, emissiveIntensity: 0.7 }),
    );
    fixture.position.set(lx, SHELL.h - 0.1, lz);
    interior.add(fixture);
    bulbs.push({ light: bulb, fixture });
  }

  const WHITE = new THREE.Color(0xffffff);
  let conditionNow = 100;
  let condT = 1;
  let flickT = 0;

  function refreshCondition() {
    conditionNow = state && state.shop ? shopCondition(state) : 100;
    const t = clamp(conditionNow / 100, 0, 1);
    condT = t;
    floorMat.color.lerpColors(new THREE.Color(0x83786a), WHITE, t);
    wallMat.color.lerpColors(new THREE.Color(0xa2977f), WHITE, t);
    ceilMat.color.lerpColors(new THREE.Color(0x4e463c), new THREE.Color(0xcfc4ab), t);
    wainscotMat.color.lerpColors(new THREE.Color(0x4a5a48), new THREE.Color(0x57795c), t);
    glassMat.color.lerpColors(new THREE.Color(0x9a9484), new THREE.Color(0xcfe4ee), t);
    glassMat.opacity = 0.55 - 0.27 * t; // filthy panes read fogged, clean ones clear
    const dead = conditionNow < 45;
    bulbs[0].light.intensity = dead ? 0 : BULB_I;
    bulbs[0].fixture.material.emissiveIntensity = dead ? 0.04 : 0.7;
    if (conditionNow >= 40) bulbs[1].light.intensity = BULB_I;
    for (let i = 2; i < bulbs.length; i++) bulbs[i].light.intensity = BULB_I * (0.55 + 0.45 * t);
  }

  function updateFlicker(dt) {
    if (conditionNow >= 40) return;
    flickT += dt;
    const drop = Math.sin(flickT * 13.1) * Math.sin(flickT * 4.7 + 2.1) < -0.55;
    bulbs[1].light.intensity = BULB_I * (drop ? 0.06 : 0.72 + 0.18 * Math.sin(flickT * 31));
    bulbs[1].fixture.material.emissiveIntensity = drop ? 0.05 : 0.55;
  }

  // --- fixtures ---------------------------------------------------------------------------
  const fixtureAnchors = new Map(); // layout id -> THREE.Group (interior-local)

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
      rebuildStock();
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

  function shelfUnit(f) {
    const g = new THREE.Group();
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
      board.position.set(0, y, 0.02);
      g.add(board);
    }
    const w = Math.abs(f.ry % Math.PI) < 0.1 ? 3.0 : 0.5;
    const d = Math.abs(f.ry % Math.PI) < 0.1 ? 0.5 : 3.0;
    addCol(colBoxAt(f.x, f.z, w + 0.2, d + 0.2));
    return g;
  }

  function rackUnit(f) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.9), woodMat);
    base.position.y = 0.07;
    base.castShadow = true;
    g.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.9, 0.08), darkMat);
    back.position.set(0, 1.0, -0.4);
    g.add(back);
    addCol(colBoxAt(f.x, f.z, Math.abs(Math.sin(f.ry)) > 0.5 ? 1.0 : 2.8, Math.abs(Math.sin(f.ry)) > 0.5 ? 2.8 : 1.0));
    return g;
  }

  function tableUnit(f) {
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
    for (const rx of [-0.9, 0.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), darkMat);
      post.position.set(rx, 0.85, -0.62);
      g.add(post);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.9, 6), darkMat);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 1.68, -0.62);
    g.add(rail);
    addCol(colBoxAt(f.x, f.z, 2.4, 1.6));
    return g;
  }

  function hatstandUnit(f) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.75, 8), darkMat);
    pole.position.y = 0.87;
    pole.castShadow = true;
    g.add(pole);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.06, 10), woodMat);
    foot.position.y = 0.03;
    g.add(foot);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.26, 5), darkMat);
      peg.rotation.z = Math.PI / 2;
      peg.rotation.y = a;
      const py = 1.15 + (i % 2) * 0.35;
      peg.position.set(Math.sin(a) * 0.15, py, Math.cos(a) * 0.15);
      g.add(peg);
    }
    addCol(colBoxAt(f.x, f.z, 0.8, 0.8));
    return g;
  }

  function bagstandUnit(f) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.1), woodMat);
    base.position.y = 0.05;
    base.castShadow = true;
    g.add(base);
    const backRail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.08), darkMat);
    backRail.position.set(0, 1.0, -0.45);
    g.add(backRail);
    for (const px of [-1.15, 1.15]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), darkMat);
      post.position.set(px, 0.5, -0.45);
      g.add(post);
    }
    addCol(colBoxAt(f.x, f.z, 2.6, 1.3));
    return g;
  }

  function shoerackUnit(f) {
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.9, 0.06), woodMat);
    back.position.set(0, 0.95, -0.2);
    back.castShadow = true;
    g.add(back);
    for (const y of [0.35, 0.85, 1.35]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.04, 0.4), darkMat);
      board.position.set(0, y, 0.02);
      board.rotation.x = -0.18; // angled shoe display
      g.add(board);
    }
    const swap = Math.abs(Math.sin(f.ry)) > 0.5;
    addCol(colBoxAt(f.x, f.z, swap ? 0.7 : 2.8, swap ? 2.8 : 0.7));
    // fitting bench beside the rack
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.42, 0.42), woodMat);
    const bwp = { x: f.x - (swap ? 1.2 : 0), z: f.z + (swap ? 2.1 : 1.2) };
    bench.position.set(bwp.x - f.x, 0.21, bwp.z - f.z);
    bench.castShadow = true;
    g.add(bench);
    addCol(colBoxAt(bwp.x, bwp.z, 1.2, 0.5));
    return g;
  }

  function featureUnit(f) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 16), woodMat);
    top.position.y = 0.9;
    top.castShadow = true;
    g.add(top);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 10), darkMat);
    column.position.y = 0.45;
    g.add(column);
    addCol(colBoxAt(f.x, f.z, 1.8, 1.8));
    return g;
  }

  function backshelfUnit(f) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.3, 0.1), darkMat);
    frame.position.set(0, 1.15, -0.28);
    g.add(frame);
    for (const y of [0.4, 1.05, 1.7]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.6), woodMat);
      board.position.set(0, y, 0);
      g.add(board);
    }
    const swap = Math.abs(Math.sin(f.ry)) > 0.5;
    addCol(colBoxAt(f.x, f.z, swap ? 0.9 : 2.8, swap ? 2.8 : 0.9));
    return g;
  }

  const FIXTURE_BUILDERS = {
    shelf: shelfUnit, rack: rackUnit, table: tableUnit, hatstand: hatstandUnit,
    bagstand: bagstandUnit, shoerack: shoerackUnit, feature: featureUnit, backshelf: backshelfUnit,
  };
  for (const f of FIXTURES) {
    const g = FIXTURE_BUILDERS[f.kind](f);
    g.position.set(f.x, 0, f.z);
    g.rotation.y = f.ry;
    interior.add(g);
    fixtureAnchors.set(f.id, g);
    fixtureProp(f);
  }

  // --- counter, register, wordmark, office, lounge, stockroom dressing --------------------
  let drawRegister = () => {};
  {
    const counterBody = new THREE.Mesh(
      new THREE.BoxGeometry(COUNTER.len, 1.0, COUNTER.depth - 0.14),
      new THREE.MeshStandardMaterial({ color: 0x3d5c40, roughness: 0.85 }),
    );
    counterBody.position.set(COUNTER.x, 0.5, COUNTER.z);
    counterBody.castShadow = true;
    interior.add(counterBody);
    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(COUNTER.len + 0.16, 0.07, COUNTER.depth), woodMat);
    counterTop.position.set(COUNTER.x, 1.04, COUNTER.z);
    counterTop.castShadow = true;
    interior.add(counterTop);
    addCol(colBoxAt(COUNTER.x, COUNTER.z, COUNTER.len + 0.3, COUNTER.depth + 0.2));

    // register + card reader + bag stack + receipt printer — the checkout kit
    const register = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.35, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.4 }),
    );
    register.position.set(COUNTER.registerX, 1.25, COUNTER.z);
    interior.add(register);
    const regCv = document.createElement('canvas');
    regCv.width = 128;
    regCv.height = 80;
    const regTex = new THREE.CanvasTexture(regCv);
    regTex.colorSpace = THREE.SRGBColorSpace;
    const regScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.2),
      new THREE.MeshStandardMaterial({ map: regTex, emissive: 0xffffff, emissiveMap: regTex, emissiveIntensity: 0.5 }),
    );
    regScreen.position.set(COUNTER.registerX, 1.32, COUNTER.z - 0.26);
    regScreen.rotation.x = -0.25;
    regScreen.rotation.y = Math.PI;
    interior.add(regScreen);
    drawRegister = (lines, total) => {
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
    const cardReader = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.14, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x33373c, roughness: 0.5 }),
    );
    cardReader.position.set(COUNTER.registerX - 0.45, 1.14, COUNTER.z - 0.28);
    interior.add(cardReader);
    for (let i = 0; i < 3; i++) {
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.34, 0.02),
        new THREE.MeshStandardMaterial({ color: 0xdfd8c2, roughness: 0.9 }),
      );
      bag.position.set(COUNTER.x + COUNTER.len / 2 - 0.3, 1.25, COUNTER.z + 0.1 - i * 0.03);
      bag.rotation.y = 0.2;
      interior.add(bag);
    }
    const printer = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.12, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x44484e, roughness: 0.55 }),
    );
    printer.position.set(COUNTER.registerX + 0.42, 1.13, COUNTER.z + 0.1);
    interior.add(printer);

    const regWp = L2W(COUNTER.registerX, COUNTER.z);
    // the head of the queue with a basket, waiting on YOU
    const headForCheckout = () => {
      const c = counterQueue[0];
      return c && c.cart && c.cart.length && c.awaitingCheckout ? c : null;
    };
    addProp({
      x: regWp.x, z: regWp.z, r: 2.3,
      label: () => {
        const due = dueForCheckIn(state);
        if (due.length) {
          const r = due[0];
          return `Register — [E] check in ${r.name} (${fmtSlot(r.minute)} tee, ${Math.round(r.fee)} dollars)` +
            (due.length > 1 ? ` · ${due.length - 1} more waiting` : '');
        }
        const c = headForCheckout();
        if (c) {
          if (c.scanned < c.cart.length) {
            const next = SHOP_CATALOG.find((s) => s.id === c.cart[c.scanned].skuId);
            return `Ring up ${c.name} — [E] scan ${next ? next.name : 'item'} (${c.scanned}/${c.cart.length})`;
          }
          const total = c.cart.reduce((a, i) => a + i.price, 0);
          return `Ring up ${c.name} — [E] take payment ($${total.toFixed(2)})`;
        }
        const s = state.shop;
        const live = s.salesLive && s.salesLive.units ? ` · today at the counter: ${s.salesLive.units} rung up` : '';
        return `Register — yesterday: ${s.salesYesterday.units} sales, ${s.salesYesterday.revenue} dollars${live}`;
      },
      action: () => {
        const due = dueForCheckIn(state);
        if (due.length) {
          const res = checkInReservation(state, due[0].id);
          if (res.ok) {
            if (hooks.toast) hooks.toast(`${due[0].name} checked in — ${Math.round(res.fee)} dollar green fee collected.`);
            if (hooks.sfx) hooks.sfx('doorbell');
          }
          return;
        }
        const c = headForCheckout();
        if (!c) return;
        if (c.scanned < c.cart.length) {
          // one scan per press: the item beeps across, the total climbs
          c.scanned += 1;
          c.patience = Math.max(c.patience, 20); // being served restores their mood
          const sub = c.cart.slice(0, c.scanned).reduce((a, i) => a + i.price, 0);
          drawRegister(
            c.cart.slice(0, c.scanned).map((i) => {
              const s = SHOP_CATALOG.find((k) => k.id === i.skuId);
              return `${(s ? s.name : i.skuId).slice(0, 13)} ${i.price.toFixed(0)}`;
            }),
            sub,
          );
          if (hooks.sfx) hooks.sfx('scanBeep');
        } else {
          const res = checkoutSale(state, c.cart, c.name);
          if (!res.ok) return;
          drawRegister(['PAID — THANK YOU'], res.total);
          if (hooks.sfx) hooks.sfx('chime');
          if (hooks.toast) hooks.toast(`${c.name} paid $${res.total.toFixed(2)} — bagged and done.`);
          c.cart = [];
          c.awaitingCheckout = false;
          if (c.itemMesh) {
            c.mesh.remove(c.itemMesh);
            c.itemMesh = null;
          }
          leaveQueue(c);
          c.stopIdx += 1;
          c.linger = 0;
          rebuildStock(); // the shelf gap where their pick came from stays real
        }
      },
    });

    // the club's name painted on the wall behind the counter
    const logoCanvas = document.createElement('canvas');
    logoCanvas.width = 512;
    logoCanvas.height = 256;
    const logoTex = new THREE.CanvasTexture(logoCanvas);
    logoTex.colorSpace = THREE.SRGBColorSpace;
    const logoPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3.3, 1.65),
      new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.92 }),
    );
    logoPlane.position.set(COUNTER.x, 2.35, INTERIOR.d / 2 - 0.04);
    logoPlane.rotation.y = Math.PI;
    interior.add(logoPlane);
    redrawLogoInto(logoCanvas, logoTex);
  }

  function redrawLogoInto(cv, tex) {
    const name = (state && state.clubName) || 'THE CLUB';
    const c2 = cv.getContext('2d');
    c2.clearRect(0, 0, 512, 256);
    c2.fillStyle = '#2e5a35';
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
    let size = 44;
    c2.font = `bold ${size}px Georgia, serif`;
    while (c2.measureText(upper).width > 470 && size > 22) {
      size -= 2;
      c2.font = `bold ${size}px Georgia, serif`;
    }
    c2.fillText(upper, 256, 168);
    c2.font = 'italic 22px Georgia, serif';
    c2.fillStyle = '#57795c';
    c2.fillText('PRO SHOP', 256, 208);
    tex.needsUpdate = true;
  }

  // office: desk, chair, filing, wall course map, calendar, and (for now) the
  // computer that opens the management desk — the real laptop lands next
  const office = { computerProp: null };
  {
    const desk = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.95), woodMat);
    top.position.y = 0.92;
    top.castShadow = true;
    desk.add(top);
    for (const [lx, lz] of [[-0.85, -0.38], [0.85, -0.38], [-0.85, 0.38], [0.85, 0.38]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.92, 0.09), darkMat);
      leg.position.set(lx, 0.46, lz);
      desk.add(leg);
    }
    const drawers = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.8), darkMat);
    drawers.position.set(0.6, 0.35, 0);
    desk.add(drawers);
    desk.position.set(OFFICE.desk.x, 0, OFFICE.desk.z);
    desk.rotation.y = OFFICE.desk.ry;
    interior.add(desk);
    addCol(colBoxAt(OFFICE.desk.x, OFFICE.desk.z, 1.1, 2.0));

    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x3f6d45, roughness: 0.9 }));
    seat.position.y = 0.5;
    chair.add(seat);
    const backC = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.08), new THREE.MeshStandardMaterial({ color: 0x3f6d45, roughness: 0.9 }));
    backC.position.set(0, 0.85, 0.24);
    chair.add(backC);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), darkMat);
    post.position.y = 0.25;
    chair.add(post);
    chair.position.set(OFFICE.chair.x, 0, OFFICE.chair.z);
    chair.rotation.y = -Math.PI / 2;
    interior.add(chair);

    // wall course map (management surface: [E] opens the overview camera)
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = 240;
    mapCanvas.height = 160;
    const mapTex = new THREE.CanvasTexture(mapCanvas);
    mapTex.colorSpace = THREE.SRGBColorSpace;
    const courseMap = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.5),
      new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.85 }),
    );
    courseMap.position.set(INTERIOR.w / 2 - 0.05, 1.9, OFFICE.map.z);
    courseMap.rotation.y = -Math.PI / 2;
    interior.add(courseMap);
    const mapFrame = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.7),
      new THREE.MeshStandardMaterial({ color: 0x3d3122, roughness: 0.8 }),
    );
    mapFrame.position.set(INTERIOR.w / 2 - 0.04, 1.9, OFFICE.map.z);
    mapFrame.rotation.y = -Math.PI / 2;
    interior.add(mapFrame);
    const MAP_COLORS = ['#46543a', '#5c7d43', '#7cb257', '#96d377', '#8ac168', '#d8c78e', '#3e6f9e', '#a89f8d'];
    const redrawCourseMap = () => {
      const course = state.course;
      const c2 = mapCanvas.getContext('2d');
      c2.fillStyle = '#2a3324';
      c2.fillRect(0, 0, 240, 160);
      const sx = 240 / course.w;
      const sy = 160 / course.h;
      for (let y = 0; y < course.h; y++) {
        for (let x = 0; x < course.w; x++) {
          c2.fillStyle = MAP_COLORS[course.zones[y * course.w + x]] || '#46543a';
          c2.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
        }
      }
      c2.fillStyle = '#d84b3a';
      for (const h of state.course.holes) {
        if (h.pin) c2.fillRect(h.pin.x * sx - 1, h.pin.y * sy - 1, 3, 3);
      }
      mapTex.needsUpdate = true;
    };
    redrawCourseMap();
    const mapWp = L2W(INTERIOR.w / 2 - 0.5, OFFICE.map.z);
    addProp({
      x: mapWp.x, z: mapWp.z, r: 2.2,
      label: () => 'Course wall map — [E] step back to the overview camera',
      action: () => { if (hooks.toggleOverview) hooks.toggleOverview(); },
    });

    // calendar on the office's south wall
    const calCv = document.createElement('canvas');
    calCv.width = 96; calCv.height = 112;
    const cc = calCv.getContext('2d');
    cc.fillStyle = '#f2eee0'; cc.fillRect(0, 0, 96, 112);
    cc.fillStyle = '#1f8a34'; cc.fillRect(0, 0, 96, 24);
    cc.fillStyle = '#2b2b30';
    for (let r = 0; r < 5; r++) for (let col = 0; col < 7; col++) cc.fillRect(6 + col * 13, 32 + r * 15, 9, 10);
    const calTex = new THREE.CanvasTexture(calCv);
    calTex.colorSpace = THREE.SRGBColorSpace;
    const cal = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.82), new THREE.MeshStandardMaterial({ map: calTex, roughness: 0.9 }));
    cal.position.set(OFFICE.calendar.x, 1.8, INTERIOR.d / 2 - 0.05);
    cal.rotation.y = Math.PI;
    interior.add(cal);

    // THE LAPTOP — a real machine on the desk: body, keyboard, trackpad, and a
    // live screen (canvas) showing the Fairway Office homepage before you ever
    // sit down. [E] eases the camera in; the portal UI takes the screen over.
    const laptop = new THREE.Group();
    const chrome = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.5, metalness: 0.35 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.025, 0.42), chrome);
    deck.position.y = 0.0125;
    deck.castShadow = true;
    laptop.add(deck);
    // keyboard: a canvas keycap grid on the deck
    const kbCv = document.createElement('canvas');
    kbCv.width = 256; kbCv.height = 128;
    const kc = kbCv.getContext('2d');
    kc.fillStyle = '#33373c'; kc.fillRect(0, 0, 256, 128);
    kc.fillStyle = '#23262b';
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 14; c++) kc.fillRect(6 + c * 17.6, 8 + r * 17, 14, 13);
    }
    kc.fillRect(64, 96, 128, 22); // spacebar
    const kbTex = new THREE.CanvasTexture(kbCv);
    const kb = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.24),
      new THREE.MeshStandardMaterial({ map: kbTex, roughness: 0.7 }),
    );
    kb.rotation.x = -Math.PI / 2;
    kb.position.set(0, 0.026, -0.06);
    laptop.add(kb);
    const trackpad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.4 }),
    );
    trackpad.rotation.x = -Math.PI / 2;
    trackpad.position.set(0, 0.027, 0.13);
    laptop.add(trackpad);
    // lid + screen, hinged open at a laptop angle
    const lidHinge = new THREE.Group();
    lidHinge.position.set(0, 0.02, -0.21);
    lidHinge.rotation.x = 0.42; // open ~114°
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.018), chrome);
    lid.position.set(0, 0.21, 0);
    lid.castShadow = true;
    lidHinge.add(lid);
    const screenCv = document.createElement('canvas');
    screenCv.width = 512; screenCv.height = 320;
    const screenTex = new THREE.CanvasTexture(screenCv);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.365),
      new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 0.55, roughness: 0.25 }),
    );
    screen.position.set(0, 0.21, 0.011);
    lidHinge.add(screen);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0x2f8a4a, emissive: 0x35d06a, emissiveIntensity: 1.4 }),
    );
    led.position.set(0.27, 0.03, 0.2);
    laptop.add(led, lidHinge);
    laptop.position.set(OFFICE.laptop.x - 0.12, 0.96, OFFICE.laptop.z);
    laptop.rotation.y = OFFICE.laptop.ry;
    interior.add(laptop);

    function paintScreen() {
      const c2 = screenCv.getContext('2d');
      // wallpaper: soft fairway gradient
      const grad = c2.createLinearGradient(0, 0, 0, 320);
      grad.addColorStop(0, '#dfe9d4');
      grad.addColorStop(1, '#b9d2a8');
      c2.fillStyle = grad;
      c2.fillRect(0, 0, 512, 320);
      c2.fillStyle = '#1f4a26';
      c2.fillRect(0, 0, 512, 34);
      c2.fillStyle = '#f4f0e6';
      c2.font = 'bold 19px Georgia, serif';
      c2.textAlign = 'left';
      c2.fillText('⛳ Fairway Office', 12, 24);
      const mins = Math.floor(((state.clock.minutes % 1440) + 1440) % 1440);
      const hh = Math.floor(mins / 60);
      const mm = String(mins % 60).padStart(2, '0');
      c2.textAlign = 'right';
      c2.font = '15px system-ui, sans-serif';
      c2.fillText(`${((hh + 11) % 12) + 1}:${mm} ${hh >= 12 ? 'PM' : 'AM'}`, 500, 23);
      c2.textAlign = 'center';
      c2.fillStyle = '#2e3a2b';
      c2.font = '15px system-ui, sans-serif';
      c2.fillText((state.clubName || 'The Club') + ' — Clubhouse Manager', 256, 66);
      // app tiles
      const tiles = [['🛒', 'Supplier'], ['🏪', 'Pro Shop'], ['📅', 'Tee Sheet'], ['⛳', 'Course'], ['🔨', 'Renovate'], ['💰', 'Books']];
      tiles.forEach(([icon, name], i) => {
        const tx = 46 + (i % 3) * 150;
        const ty = 96 + Math.floor(i / 3) * 96;
        c2.fillStyle = 'rgba(244,240,230,0.88)';
        c2.fillRect(tx, ty, 118, 72);
        c2.strokeStyle = '#57795c';
        c2.strokeRect(tx + 0.5, ty + 0.5, 117, 71);
        c2.font = '26px system-ui';
        c2.fillStyle = '#1f4a26';
        c2.fillText(icon, tx + 59, ty + 34);
        c2.font = '13px system-ui';
        c2.fillStyle = '#23262b';
        c2.fillText(name, tx + 59, ty + 58);
      });
      c2.fillStyle = '#1f4a26';
      c2.font = '12px system-ui';
      c2.fillText('press E to use', 256, 305);
      screenTex.needsUpdate = true;
    }
    paintScreen();
    office.paintScreen = paintScreen;

    const compWp = L2W(OFFICE.laptop.x, OFFICE.laptop.z);
    office.computerProp = addProp({
      x: compWp.x, z: compWp.z, r: 2.3,
      label: () => 'Laptop — [E] open Fairway Office',
      action: () => { if (hooks.openLaptop) hooks.openLaptop(); },
    });
    office.laptop = laptop;
    // where the camera settles when you sit down at it (world pose)
    const seatPos = L2W(OFFICE.laptop.x - 1.02, OFFICE.laptop.z);
    office.laptopPose = {
      x: seatPos.x, y: floorY + 1.28, z: seatPos.z,
      yaw: -Math.PI / 2, // face east, square to the screen
      pitch: -0.1,
    };
  }

  // lounge dressing: trophy shelf + course photo (sofa arrives as decor)
  {
    const shelf = new THREE.Group();
    for (const y of [1.5, 1.05]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.3), woodMat);
      board.position.set(0, y, 0);
      shelf.add(board);
    }
    for (let i = 0; i < 3; i++) {
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.075, 0.2, 8),
        new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.7, roughness: 0.3 }),
      );
      cup.position.set(-0.5 + i * 0.5, 1.63, 0);
      shelf.add(cup);
    }
    const mags = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0x3b6fb3, roughness: 0.8 }));
    mags.position.set(0.4, 1.09, 0);
    shelf.add(mags);
    shelf.position.set(LOUNGE.trophy.x, 0, LOUNGE.trophy.z);
    shelf.rotation.y = LOUNGE.trophy.ry;
    interior.add(shelf);

    const photoCv = document.createElement('canvas');
    photoCv.width = 128; photoCv.height = 80;
    const pc = photoCv.getContext('2d');
    const grad = pc.createLinearGradient(0, 0, 0, 80);
    grad.addColorStop(0, '#8fd0f0');
    grad.addColorStop(0.55, '#bfe0f5');
    grad.addColorStop(0.56, '#5c8f3f');
    grad.addColorStop(1, '#7cb257');
    pc.fillStyle = grad; pc.fillRect(0, 0, 128, 80);
    pc.fillStyle = '#f2efe4'; pc.beginPath(); pc.arc(97, 60, 2.2, 0, 7); pc.fill();
    pc.fillStyle = '#d84b3a'; pc.fillRect(96, 40, 2, 18);
    const photoTex = new THREE.CanvasTexture(photoCv);
    photoTex.colorSpace = THREE.SRGBColorSpace;
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), new THREE.MeshStandardMaterial({ map: photoTex, roughness: 0.85 }));
    photo.position.set(LOUNGE.photo.x, 1.95, -INTERIOR.d / 2 + 0.05);
    interior.add(photo);
    const photoFrame = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 1.1), new THREE.MeshStandardMaterial({ color: 0x3d3122, roughness: 0.8 }));
    photoFrame.position.set(LOUNGE.photo.x, 1.95, -INTERIOR.d / 2 + 0.04);
    interior.add(photoFrame);
  }

  // stockroom dressing: hand truck, bin, receiving pad outside the back door
  {
    const truck = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.4), darkMat);
    plate.position.set(0, 0.04, 0.18);
    truck.add(plate);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.05), new THREE.MeshStandardMaterial({ color: 0xc23327, roughness: 0.55 }));
    frame.position.set(0, 0.6, -0.02);
    frame.rotation.x = -0.16;
    truck.add(frame);
    for (const wx of [-0.2, 0.2]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 10), darkMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.11, -0.05);
      truck.add(wheel);
    }
    truck.position.set(STOCKROOM.handTruck.x, 0, STOCKROOM.handTruck.z);
    truck.rotation.y = 0.6;
    interior.add(truck);

    const bin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.22, 0.6, 10),
      new THREE.MeshStandardMaterial({ color: 0x4a5258, roughness: 0.7 }),
    );
    bin.position.set(STOCKROOM.bin.x, 0.3, STOCKROOM.bin.z);
    interior.add(bin);

    // receiving pad — deliveries will land here (gravel patch + posts)
    const padWp = L2W(STOCKROOM.padOutside.x, STOCKROOM.padOutside.z);
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 18),
      new THREE.MeshStandardMaterial({ color: 0xa89f8d, roughness: 1 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(padWp.x, heightAt(padWp.x, padWp.z) + 0.03, padWp.z);
    scene.add(pad);
    ctx.extraMeshes = ctx.extraMeshes || [];
    ctx.extraMeshes.push(pad);
  }

  // --- clutter piles ------------------------------------------------------------------------
  const cardboard = new THREE.MeshStandardMaterial({ color: 0xb08f5e, roughness: 0.92 });
  const cardboardDark = new THREE.MeshStandardMaterial({ color: 0xa08050, roughness: 0.92 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x7c6034, roughness: 0.85 });
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.95 });
  const clutterObjs = [];

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
    interior.add(g);

    const collider = addCol(colBoxAt(pile.x, pile.z, 0.9, 0.9));
    const wp = L2W(pile.x, pile.z);
    const prop = addProp({
      x: wp.x, z: wp.z, r: 1.9,
      label: () => 'Old clutter — [E] haul it out',
      action: () => {
        const res = clearClutter(state, idx);
        if (!res.ok) return;
        removeCol(collider);
        removeProp(prop);
        const co = clutterObjs.find((c) => c.group === g);
        if (co) clutterObjs.splice(clutterObjs.indexOf(co), 1);
        tweenScale(g, 1, 0.01, 0.2, () => interior.remove(g));
        repaintGrime();
        refreshCondition();
        if (hooks.sfx) hooks.sfx('thunk');
        if (hooks.toast) hooks.toast('Hauled a pile of junk out the back.');
      },
    });
    clutterObjs.push({ group: g, collider, prop });
  }

  // --- decor (placed pieces + green placement ghosts) -----------------------------------------
  const decorObjs = [];
  let popNextDecor = null;
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x45d052, transparent: true, opacity: 0.32, depthWrite: false });

  function makeRugMesh() {
    const cv = document.createElement('canvas');
    cv.width = 192; cv.height = 128;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#3f6d45';
    c2.fillRect(0, 0, 192, 128);
    c2.strokeStyle = '#dfd8c2';
    c2.lineWidth = 7;
    c2.strokeRect(10, 10, 172, 108);
    c2.fillStyle = '#dfd8c2';
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
    return { group: g, colliders: [colBoxAt(spot.x, spot.z, 0.5, 0.5)] };
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
    c2.fillStyle = '#57795c';
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
    cord.position.y = SHELL.h - 0.35;
    g.add(cord);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.3, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a5a33, roughness: 0.7, side: THREE.DoubleSide }),
    );
    shade.position.y = SHELL.h - 0.78;
    g.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: 0xffe2b0, emissiveIntensity: ghost ? 0 : 1.2 }),
    );
    bulb.position.y = SHELL.h - 0.9;
    g.add(bulb);
    if (!ghost) {
      const light = new THREE.PointLight(0xffe2b0, 9, 9, 1.7);
      light.position.y = SHELL.h - 0.95;
      g.add(light);
    }
    return { group: g, colliders: [] };
  }

  function makeLoungeMesh(spot) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.8 });
    const cushion = new THREE.MeshStandardMaterial({ color: 0x3f6d45, roughness: 0.9 });
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
    const worldBox = (lx, lz, w, d) => {
      const sin = Math.sin(spot.ry);
      const cos = Math.cos(spot.ry);
      const bx = spot.x + lx * cos + lz * sin;
      const bz = spot.z - lx * sin + lz * cos;
      const swap = Math.abs(sin) > 0.5;
      return colBoxAt(bx, bz, swap ? 0.95 : w, swap ? w : d);
    };
    return { group: g, colliders: [worldBox(0, 0, 2.2, 0.95), worldBox(0, 1.05, 1.15, 0.6)] };
  }

  const DECOR_BUILDERS = {
    rug1: makeRugMesh, plant1: makePlantMesh, poster1: makePosterMesh,
    board1: makeBoardMesh, light1: makePendantMesh, lounge1: makeLoungeMesh,
  };

  function ghostify(g) {
    g.traverse((o) => {
      if (o.isMesh) {
        o.material = ghostMat;
        o.castShadow = false;
      }
      if (o.isPointLight) o.intensity = 0;
    });
    return g;
  }

  function buildDecorAt(skuId, spotIdx, ghost) {
    const spot = DECOR_SPOTS[skuId][spotIdx];
    const built = DECOR_BUILDERS[skuId](spot, ghost);
    built.group.position.set(spot.x, 0, spot.z);
    built.group.rotation.y = spot.ry;
    if (ghost) ghostify(built.group);
    interior.add(built.group);
    if (!ghost && popNextDecor && popNextDecor.skuId === skuId && popNextDecor.spot === spotIdx) {
      popNextDecor = null;
      tweenScale(built.group, 0.55, 1, 0.28);
    }
    const entry = { group: built.group, colliders: ghost ? [] : built.colliders, prop: null };
    for (const c of entry.colliders) addCol(c);
    const sku = SHOP_CATALOG.find((sk) => sk.id === skuId);
    const wp = L2W(spot.x, spot.z);
    if (!ghost) {
      entry.prop = addProp({
        x: wp.x, z: wp.z, r: 1.9,
        label: () => `${sku.name} — [E] pack it back up`,
        action: () => {
          if (!removeDecor(state, skuId, spotIdx).ok) return;
          rebuildDecor();
          refreshCondition();
          if (hooks.sfx) hooks.sfx('thunk');
          if (hooks.toast) hooks.toast(`${sku.name} packed up — it's back in the backroom.`);
        },
      });
    } else {
      entry.prop = addProp({
        x: wp.x, z: wp.z, r: 1.9,
        label: () => `Place the ${sku.name.toLowerCase()} here — [E]`,
        action: () => {
          const res = placeDecor(state, skuId, spotIdx);
          if (!res.ok) {
            if (hooks.toast) hooks.toast(res.reason || 'Cannot place that here.', 'warn');
            return;
          }
          popNextDecor = { skuId, spot: spotIdx };
          rebuildDecor();
          refreshCondition();
          if (hooks.sfx) hooks.sfx('thunk');
          if (hooks.toast) hooks.toast(`${sku.name} placed — the shop is coming together.`);
        },
      });
    }
    decorObjs.push(entry);
  }

  function rebuildDecor() {
    for (const d of decorObjs) {
      interior.remove(d.group);
      for (const c of d.colliders) removeCol(c);
      if (d.prop) removeProp(d.prop);
    }
    decorObjs.length = 0;
    const reno = state && state.shop && state.shop.reno;
    if (!reno) return;
    for (const d of reno.decor) {
      if (DECOR_BUILDERS[d.skuId] && DECOR_SPOTS[d.skuId] && DECOR_SPOTS[d.skuId][d.spot]) {
        buildDecorAt(d.skuId, d.spot, false);
      }
    }
    for (const skuId of Object.keys(DECOR_BUILDERS)) {
      const inv = state.shop.inventory[skuId];
      if (!inv || inv.back <= 0) continue;
      DECOR_SPOTS[skuId].forEach((spot, idx) => {
        if (!reno.decor.some((d) => d.skuId === skuId && d.spot === idx)) buildDecorAt(skuId, idx, true);
      });
    }
  }

  let decorSig = '';
  function decorSignature() {
    if (!state || !state.shop) return '';
    let sig = state.shop.reno ? String(state.shop.reno.decor.length) : '0';
    for (const skuId of Object.keys(DECOR_BUILDERS)) {
      const inv = state.shop.inventory[skuId];
      sig += ':' + (inv ? inv.back : 0);
    }
    return sig;
  }

  function rebuildReno() {
    for (const c of clutterObjs) {
      interior.remove(c.group);
      removeCol(c.collider);
      removeProp(c.prop);
    }
    clutterObjs.length = 0;
    const reno = state && state.shop && state.shop.reno;
    if (reno) reno.clutter.forEach((pile, idx) => { if (!pile.cleared) buildClutterPile(idx, pile); });
    rebuildDecor();
    decorSig = decorSignature();
    repaintGrime();
    refreshCondition();
  }

  // --- live stock silhouettes -------------------------------------------------------------
  const stockGroup = new THREE.Group();
  interior.add(stockGroup);
  const stockMeshes = new Map();

  function rebuildStock() {
    for (const g of stockMeshes.values()) stockGroup.remove(g);
    stockMeshes.clear();
    const inv = state.shop.inventory;
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f2e8, roughness: 0.6 });
    const POLO_TINTS = { polo1: 0x3f7a34, polo2: 0x3b6fb3, jacket2: 0x2c3e66 };

    for (const f of FIXTURES) {
      const anchor = fixtureAnchors.get(f.id);
      if (!anchor) continue;
      const hangCursor = { n: 0 };
      f.skus.forEach((skuId, idx) => {
        const sku = SHOP_CATALOG.find((s) => s.id === skuId);
        const count = inv[skuId] ? inv[skuId].shelf : 0;
        const g = new THREE.Group();
        const color = new THREE.Color(CAT_COLORS[sku.cat] || 0x999999);
        color.offsetHSL(0, 0, (sku.tier - 2) * 0.09);
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });

        if (sku.cat === 'clubs') {
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
            item.position.set(-1.05 + idx * 0.56 + col * 0.17, boardY + 0.09 + Math.floor(layer / 3) * 0.125, 0.1);
            item.castShadow = true;
            g.add(item);
          }
          if (show >= 3) {
            const bx = -1.05 + idx * 0.56 + 0.38;
            for (const [ox, oz, oy] of [[0, 0, 0], [0.055, 0, 0], [0.028, 0.045, 0], [0.028, 0.018, 0.045]]) {
              const ball = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), white);
              ball.position.set(bx + ox, 1.05 + 0.026 + oy, 0.14 + oz);
              g.add(ball);
            }
          }
        } else if (POLO_TINTS[sku.id] && count > 0) {
          const tint = new THREE.MeshStandardMaterial({ color: POLO_TINTS[sku.id], roughness: 0.85 });
          const show = Math.min(count, 10);
          const folded = Math.min(show, 6);
          for (let i = 0; i < folded; i++) {
            const slab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.055, 0.24), tint);
            slab.position.set(-0.85 + idx * 0.42, 1.03 + (i % 3) * 0.062, -0.15 + Math.floor(i / 3) * 0.3);
            slab.rotation.y = (i % 2) * 0.09 - 0.045;
            slab.castShadow = true;
            g.add(slab);
            const collar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.05), white);
            collar.position.set(slab.position.x, slab.position.y + 0.034, slab.position.z + 0.08);
            g.add(collar);
          }
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
            // hats hang around the hat tree's pegs
            const a = (i / 8) * Math.PI * 2;
            const py = 1.15 + (i % 2) * 0.35;
            dome.position.set(Math.sin(a) * 0.3, py + 0.03, Math.cos(a) * 0.3);
            brim.position.set(Math.sin(a) * 0.3, py, Math.cos(a) * 0.3 + 0.08);
            dome.castShadow = true;
            g.add(dome, brim);
          }
        } else if (sku.id === 'glove1') {
          const show = Math.min(count, 8);
          for (let i = 0; i < show; i++) {
            const glove = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.2), white);
            glove.position.set(-0.85 + idx * 0.42 + (i % 2) * 0.14, 1.08 + Math.floor(i / 2) * 0.026, 0.1);
            glove.rotation.y = (i % 2) * 0.2 - 0.1;
            g.add(glove);
          }
        } else if (sku.id === 'sock1') {
          const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.14, 10), woodMat);
          basket.position.set(-0.85 + idx * 0.42, 1.1, 0.1);
          g.add(basket);
          const show = Math.min(count, 9);
          for (let i = 0; i < show; i++) {
            const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.08, 6), white);
            roll.rotation.x = Math.PI / 2;
            roll.position.set(-0.85 + idx * 0.42 + ((i % 3) - 1) * 0.07, 1.18 + Math.floor(i / 3) * 0.055, 0.1);
            g.add(roll);
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
        } else if (sku.id === 'umb1') {
          const show = Math.min(count, 6);
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.5, 10), woodMat);
          barrel.position.set(1.62, 0.25, 0.3);
          g.add(barrel);
          for (let i = 0; i < show; i++) {
            const a = (i / 6) * Math.PI * 2;
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 5), darkMat);
            shaft.position.set(1.62 + Math.sin(a) * 0.09, 0.75, 0.3 + Math.cos(a) * 0.09);
            shaft.rotation.z = Math.sin(a) * 0.12;
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 8), m);
            tip.position.set(shaft.position.x, 1.3, shaft.position.z);
            g.add(shaft, tip);
          }
        } else if (sku.id === 'bag1') {
          const show = Math.min(count, 5);
          for (let i = 0; i < show; i++) {
            const tintB = new THREE.MeshStandardMaterial({ color: [0x2c3e66, 0xc23327, 0x3f7a34, 0x53422e, 0xd97538][i % 5], roughness: 0.8 });
            const bx = -0.95 + i * 0.48;
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.95, 10), tintB);
            body.position.set(bx, 0.55, -0.1);
            body.rotation.x = -0.22;
            body.castShadow = true;
            const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.08), tintB);
            pocket.position.set(bx, 0.42, 0.08);
            pocket.rotation.x = -0.22;
            const legA = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 5), darkMat);
            legA.position.set(bx - 0.08, 0.4, 0.22);
            legA.rotation.x = 0.5;
            const legB = legA.clone();
            legB.position.x = bx + 0.08;
            g.add(body, pocket, legA, legB);
          }
        } else if (sku.id === 'shoe1') {
          const show = Math.min(count, 8);
          for (let i = 0; i < show; i++) {
            const boardY = [0.35, 0.85, 1.35][Math.floor(i / 3) % 3];
            const px = -1.0 + (i % 3) * 0.75;
            for (const so of [-0.09, 0.09]) {
              const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.3), i % 2 ? white : m);
              upper.position.set(px + so, boardY + 0.12, 0.08);
              upper.rotation.x = -0.18;
              const sole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.32), darkMat);
              sole.position.set(px + so, boardY + 0.06, 0.08);
              sole.rotation.x = -0.18;
              g.add(upper, sole);
            }
          }
        } else {
          const box = sku.cat === 'apparel' ? [0.26, 0.07, 0.2] : sku.id === 'range2' ? [0.1, 0.12, 0.16] : [0.14, 0.1, 0.12];
          const show = Math.min(count, 12);
          for (let i = 0; i < show; i++) {
            const item = new THREE.Mesh(new THREE.BoxGeometry(...box), sku.id === 'range2' ? new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.5 }) : m);
            const layer = Math.floor(i / 3);
            const col = i % 3;
            const boardY = [0.5, 1.05, 1.6][layer % 3];
            item.position.set(-1.05 + idx * 0.56 + (Math.floor(layer / 3)) * 0.2, boardY + 0.03 + box[1] / 2, 0.06 + col * (box[2] * 0.35));
            item.castShadow = true;
            g.add(item);
          }
        }
        g.position.copy(anchor.position);
        g.rotation.copy(anchor.rotation);
        stockGroup.add(g);
        stockMeshes.set(f.id + ':' + skuId, g);
      });

      // the feature display shows whatever the featured category has on shelves
      if (f.kind === 'feature') {
        const cat = state.shop.featureCategory;
        const g = new THREE.Group();
        const catSkus = SHOP_CATALOG.filter((s) => s.cat === cat);
        const total = catSkus.reduce((a, s) => a + (inv[s.id] ? inv[s.id].shelf : 0), 0);
        const show = Math.min(total, 8);
        const fm = new THREE.MeshStandardMaterial({ color: CAT_COLORS[cat] || 0x999999, roughness: 0.6 });
        for (let i = 0; i < show; i++) {
          const a = (i / 8) * Math.PI * 2;
          const item = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), fm);
          item.position.set(Math.sin(a) * 0.5, 1.02 + (i % 2) * 0.13, Math.cos(a) * 0.5);
          item.rotation.y = a;
          g.add(item);
        }
        // little tent sign on top
        const tent = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.02), new THREE.MeshStandardMaterial({ color: 0x1f8a34, roughness: 0.8 }));
        tent.position.set(0, 1.06, 0);
        tent.rotation.x = -0.2;
        g.add(tent);
        g.position.copy(anchor.position);
        stockGroup.add(g);
        stockMeshes.set(f.id + ':feature', g);
      }

      // backroom shelving stacks generic cases scaled by what's actually back there
      if (f.kind === 'backshelf') {
        const g = new THREE.Group();
        const totalBack = SHOP_CATALOG.reduce((a, s) => a + (inv[s.id] ? inv[s.id].back : 0), 0);
        const show = Math.min(Math.ceil(totalBack / 6), 12);
        for (let i = 0; i < show; i++) {
          const bx = -0.95 + (i % 4) * 0.62;
          const by = [0.46, 1.11, 1.76][Math.floor(i / 4) % 3];
          const caseB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.44), i % 2 ? cardboard : cardboardDark);
          caseB.position.set(bx, by + 0.18, 0);
          caseB.rotation.y = (i % 3) * 0.1 - 0.1;
          caseB.castShadow = true;
          g.add(caseB);
        }
        g.position.copy(anchor.position);
        g.rotation.copy(anchor.rotation);
        stockGroup.add(g);
        stockMeshes.set(f.id + ':back', g);
      }
    }
  }

  let stockSig = '';
  function stockSignature() {
    const inv = state.shop.inventory;
    let sig = state.shop.featureCategory || '';
    for (const s of SHOP_CATALOG) {
      const e = inv[s.id];
      sig += ':' + (e ? e.shelf + '.' + e.back : '0');
    }
    return sig;
  }

  // --- the vacuum hook (the wand mesh rides the walk camera, courseScene-side) ----------
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
  let cleanClock = 0;
  let moteFade = 0;

  function vacuumAt(wx, wz, dt) {
    const l = W2L(wx, wz);
    const res = cleanGrimeAt(state, l.x, l.z, 0.5 * dt);
    if (res.cleaned > 0 && state.tutorial) tutorialFlag(state, 'vacuumed');
    cleanClock += dt;
    if (cleanClock > 0.16) {
      cleanClock = 0;
      if (res.cleaned > 0) repaintGrime();
      refreshCondition();
    }
    moteFade = 0.2;
    motes.visible = true;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const noz = camera.position.clone().add(fwd.multiplyScalar(0.8));
    noz.y -= 0.35;
    for (let i = 0; i < MOTES; i++) {
      const mo = moteState[i];
      mo.t += dt * (1.6 + (i % 5) * 0.14);
      if (mo.t >= 1) {
        mo.t = 0;
        mo.ox = (Math.random() - 0.5) * 1.1;
        mo.oz = (Math.random() - 0.5) * 1.1;
      }
      const sx = wx + mo.ox;
      const sz = wz + mo.oz;
      motePos[i * 3] = sx + (noz.x - sx) * mo.t;
      motePos[i * 3 + 1] = floorY + 0.03 + (noz.y - floorY - 0.03) * mo.t * mo.t;
      motePos[i * 3 + 2] = sz + (noz.z - sz) * mo.t;
    }
    moteGeo.attributes.position.needsUpdate = true;
  }

  function vacuumLabelAt(wx, wz) {
    const l = W2L(wx, wz);
    const reno = state.shop && state.shop.reno;
    if (!reno) return null;
    const cx = Math.floor(((l.x + RENO.room.w / 2) / RENO.room.w) * RENO.grid.w);
    const cy = Math.floor(((l.z + RENO.room.d / 2) / RENO.room.d) * RENO.grid.h);
    if (cx < 0 || cx >= RENO.grid.w || cy < 0 || cy >= RENO.grid.h) return 'Vacuum — aim at the floor';
    const d = reno.grime[cy * RENO.grid.w + cx];
    return d > 0.05 ? `Vacuum — this patch: ${Math.round(d * 100)}% dirty · hold LMB` : 'Vacuum — this patch is clean';
  }

  // --- physical deliveries: boxes on the pad, in your arms, in the stockroom ------------
  const boxGroup = new THREE.Group();
  scene.add(boxGroup);
  let carriedMesh = null;
  const boxProps = []; // dynamic per-box props, torn down on rebuild
  let boxSig = '';

  function makeBoxMesh(box) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.4, 0.46), cardboard);
    body.position.y = 0.2;
    body.castShadow = true;
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.015, 0.12), tapeMat);
    tape.position.y = 0.405;
    const sku = SHOP_CATALOG.find((s) => s.id === box.skuId);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.09, 0.47),
      new THREE.MeshStandardMaterial({ color: CAT_COLORS[sku ? sku.cat : 'accessories'] || 0x999999, roughness: 0.85 }),
    );
    stripe.position.y = 0.1;
    g.add(body, tape, stripe);
    return g;
  }

  function boxSignature() {
    const d = state.shop.deliveries;
    if (!d) return '';
    return d.boxes.map((b) => `${b.id}:${b.loc}`).join(',') + '|' + d.trash;
  }

  function rebuildBoxes() {
    boxGroup.clear();
    for (const p of boxProps) removeProp(p);
    boxProps.length = 0;
    if (carriedMesh) {
      camera.remove(carriedMesh);
      carriedMesh = null;
    }
    const d = state.shop.deliveries;
    if (!d) return;
    const stacks = { pad: 0, stock: 0 };
    for (const box of d.boxes) {
      if (box.loc === 'carried') {
        carriedMesh = makeBoxMesh(box);
        carriedMesh.scale.setScalar(0.8);
        carriedMesh.position.set(0, -0.62, -0.78);
        carriedMesh.rotation.y = 0.12;
        camera.add(carriedMesh);
        continue;
      }
      const at = box.loc === 'pad' ? STOCKROOM.padOutside : STOCKROOM.receivingInside;
      const i = stacks[box.loc]++;
      const lx = at.x + (i % 3 - 1) * 0.62;
      const lz = at.z + Math.floor(i / 3) * 0.56 - 0.3;
      const wp = L2W(lx, lz);
      const m = makeBoxMesh(box);
      const gy = groundYAt(wp.x, wp.z);
      m.position.set(wp.x, gy !== null && gy !== undefined ? gy : heightAt(wp.x, wp.z) + 0.02, wp.z);
      m.rotation.y = (box.id % 5) * 0.13;
      boxGroup.add(m);
      const sku = SHOP_CATALOG.find((s) => s.id === box.skuId);
      const name = sku ? sku.name : box.skuId;
      const prop = addProp({
        x: wp.x, z: wp.z, r: 1.9,
        label: () => {
          if (carriedBox(state)) return null; // the set-down verb owns E while loaded
          return box.loc === 'pad'
            ? `Delivery — ${name} ×${box.qty} — [E] pick up`
            : `Case of ${name} ×${box.qty} — [E] unpack into the backroom`;
        },
        action: () => {
          if (box.loc === 'pad') {
            const res = pickUpBox(state, box.id);
            if (!res.ok) { if (hooks.toast) hooks.toast(res.reason, 'warn'); return; }
            if (hooks.sfx) hooks.sfx('thunk');
          } else {
            const res = openBox(state, box.id);
            if (!res.ok) { if (hooks.toast) hooks.toast(res.reason, 'warn'); return; }
            rebuildStock();
            if (hooks.sfx) hooks.sfx('chime');
            if (hooks.toast) hooks.toast(`Unpacked ${res.qty} × ${name} into the backroom.`);
          }
          rebuildBoxes();
        },
      });
      boxProps.push(prop);
    }
    boxSig = boxSignature();
  }

  // the set-down verb follows the player while a box is in their arms
  const carryProp = addProp({
    x: 0, z: 0, r: 2.5,
    label: () => {
      const c = carriedBox(state);
      if (!c) return null;
      const l = W2L(walk.x, walk.z);
      const inStock = l.x >= STOCKROOM.bounds.minX && l.x <= STOCKROOM.bounds.maxX
        && l.z >= STOCKROOM.bounds.minZ && l.z <= STOCKROOM.bounds.maxZ;
      const nearPad = Math.hypot(l.x - STOCKROOM.padOutside.x, l.z - STOCKROOM.padOutside.z) < 4;
      const sku = SHOP_CATALOG.find((s) => s.id === c.skuId);
      if (inStock) return `Carrying ${sku ? sku.name : c.skuId} ×${c.qty} — [E] set it down here`;
      if (nearPad) return `Carrying ${sku ? sku.name : c.skuId} ×${c.qty} — [E] put it back on the pad`;
      return `Carrying ${sku ? sku.name : c.skuId} ×${c.qty} — take it to the stockroom (back door)`;
    },
    action: () => {
      const c = carriedBox(state);
      if (!c) return;
      const l = W2L(walk.x, walk.z);
      const inStock = l.x >= STOCKROOM.bounds.minX && l.x <= STOCKROOM.bounds.maxX
        && l.z >= STOCKROOM.bounds.minZ && l.z <= STOCKROOM.bounds.maxZ;
      const nearPad = Math.hypot(l.x - STOCKROOM.padOutside.x, l.z - STOCKROOM.padOutside.z) < 4;
      if (!inStock && !nearPad) {
        if (hooks.toast) hooks.toast('Set it down in the stockroom — in through the back door.', 'warn');
        return;
      }
      putDownBox(state, c.id, inStock ? 'stock' : 'pad');
      if (hooks.sfx) hooks.sfx('thunk');
      rebuildBoxes();
    },
  });

  // flattening the empties at the stockroom bin
  {
    const wp = L2W(STOCKROOM.bin.x, STOCKROOM.bin.z);
    addProp({
      x: wp.x, z: wp.z, r: 1.8,
      label: () => {
        const d = state.shop.deliveries;
        return d && d.trash > 0 ? `Empties (${d.trash}) — [E] flatten them into the bin` : null;
      },
      action: () => {
        if (emptyTrash(state).ok) {
          if (hooks.sfx) hooks.sfx('thunk');
          if (hooks.toast) hooks.toast('Cardboard flattened — the stockroom breathes again.');
          rebuildBoxes();
        }
      },
    });
  }

  // --- customers: they walk in from the course, through the real door -------------------
  const customers = [];
  const CUST_COLORS = [0x3b6fb3, 0x2c3e66, 0xd98bb0, 0xd97538, 0x3f7a34];
  const counterQueue = [];
  const doorW = L2W(DOOR_MAIN.x, halfD);
  const spawnW = { x: doorW.x + 1.5, z: doorW.z + SHELL.porchD + 9 };

  function queueSlotW(i) {
    const s = queueSlot(i);
    return L2W(s.x, s.z);
  }

  const CUST_NAMES = ['Alex R.', 'Sam T.', 'Jordan M.', 'Casey L.', 'Riley P.', 'Drew H.', 'Morgan W.', 'Quinn B.', 'Jamie F.', 'Robin K.'];

  function spawnCustomer(toCounter = false) {
    const rng = rngOf(state);
    const char = makeCharacter({
      polo: CUST_COLORS[rng.int(CUST_COLORS.length)],
      khaki: 0xc2b190,
      cap: rng.chance(0.6) ? 0xf2efe4 : 0x2c3e66,
    });
    char.root.scale.setScalar(0.92);
    char.setMode('Walk');
    char.root.userData.char = char;
    const g = char.root;
    g.position.set(spawnW.x + (rng.next() - 0.5) * 3, heightAt(spawnW.x, spawnW.z), spawnW.z + rng.next() * 2);
    custGroup.add(g);

    const stops = [];
    // the approach: porch step, then just inside the door (the doorbell moment)
    stops.push({ kind: 'walk', x: doorW.x, z: doorW.z + 2.6 });
    stops.push({ kind: 'enter', x: doorW.x, z: doorW.z - 1.4 });
    if (!toCounter) {
      const nStops = 1 + rng.int(2);
      const browsable = FIXTURES.filter((f) => f.skus.length > 0);
      for (let i = 0; i < nStops; i++) {
        const f = browsable[rng.int(browsable.length)];
        const wp = L2W(f.x, f.z);
        // stand a step off the fixture, on its open side
        const l = f;
        const offZ = l.z < -5 ? 1.2 : l.z > 5 ? -1.2 : (l.ry !== 0 ? 0 : 1.2);
        const offX = Math.abs(l.ry) > 0.5 ? (l.x < 0 ? 1.2 : -1.2) : 0;
        stops.push({
          kind: 'fixture',
          skus: f.skus,
          x: wp.x + offX + (rng.next() - 0.5) * 0.8,
          z: wp.z + offZ + (rng.next() - 0.5) * 0.4,
          faceX: wp.x,
          faceZ: wp.z,
        });
      }
    }
    if (toCounter || rng.chance(0.55)) {
      const regW = L2W(COUNTER.registerX, COUNTER.z);
      stops.push({ kind: 'counter', x: queueSlotW(0).x, z: queueSlotW(0).z, faceX: regW.x, faceZ: regW.z });
    }
    stops.push({ kind: 'exit', x: doorW.x, z: doorW.z + 2.6 });
    stops.push({ kind: 'gone', x: spawnW.x, z: spawnW.z });

    customers.push({
      mesh: g,
      name: CUST_NAMES[rng.int(CUST_NAMES.length)],
      stops,
      stopIdx: 0,
      linger: toCounter ? 26 + rng.next() * 10 : 2 + rng.next() * 4,
      speed: toCounter ? 1.15 : 1.1 + rng.next() * 0.5,
      queued: false,
      rangBell: false,
      cart: [],
      scanned: 0,
      patience: 45, // seconds they'll wait at the head of the line for service
      awaitingCheckout: false,
      itemMesh: null,
    });
  }

  // a shopper reaches for the display: the unit leaves the shelf THERE and
  // rides in their hands to the register
  function customerPick(c, stop) {
    if (!stop.skus || c.cart.length) return;
    const rng = rngOf(state);
    if (!rng.chance(0.55)) return;
    const stocked = stop.skus.filter((id) => state.shop.inventory[id] && state.shop.inventory[id].shelf > 0);
    if (!stocked.length) return;
    const skuId = stocked[rng.int(stocked.length)];
    if (!pickFromShelf(state, skuId).ok) return;
    const sku = SHOP_CATALOG.find((s) => s.id === skuId);
    c.cart.push({ skuId, price: priceFor(sku, state.shop.markup[sku.cat] || 1, null) });
    rebuildStock(); // the display visibly loses the unit
    const item = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.16, 0.16),
      new THREE.MeshStandardMaterial({ color: CAT_COLORS[sku.cat] || 0x999999, roughness: 0.7 }),
    );
    item.position.set(0.16, 0.68, 0.16);
    c.mesh.add(item);
    c.itemMesh = item;
    // a pick means they're heading to the counter — make sure a stop exists
    if (!c.stops.some((s, i) => i > c.stopIdx && s.kind === 'counter')) {
      const regW = L2W(COUNTER.registerX, COUNTER.z);
      c.stops.splice(c.stops.length - 2, 0, { kind: 'counter', x: queueSlotW(0).x, z: queueSlotW(0).z, faceX: regW.x, faceZ: regW.z });
    }
  }

  // the line gave up on us: put the pick back, remember the walk-out
  function customerGiveUp(c) {
    for (const it of c.cart) returnToShelf(state, it.skuId);
    if (c.cart.length) {
      state.shop.lostSalesTotal = (state.shop.lostSalesTotal || 0) + 1;
      if (hooks.toast && walk.active && isInside(walk.x, walk.z)) {
        hooks.toast(`${c.name} gave up waiting at the register and put it back.`, 'warn');
      }
      rebuildStock();
    }
    c.cart = [];
    c.awaitingCheckout = false;
    if (c.itemMesh) {
      c.mesh.remove(c.itemMesh);
      c.itemMesh = null;
    }
    leaveQueue(c);
    c.stopIdx += 1;
    c.linger = 0;
  }

  const arrivedResIds = new Set();
  function updateArrivals() {
    if (!state || !state.reservations) return;
    for (const r of dueForCheckIn(state)) {
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

  function resolveCustomer(c, nx, nz) {
    const r = 0.3;
    for (const col of custCols) {
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
    if (walk.active) {
      const pd = Math.hypot(nx - walk.x, nz - walk.z);
      if (pd > 0.01 && pd < 0.72) {
        nx = walk.x + ((nx - walk.x) / pd) * 0.72;
        nz = walk.z + ((nz - walk.z) / pd) * 0.72;
      }
    }
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
    return { nx, nz };
  }

  function updateCustomers(dt) {
    const minute = ((state.clock.minutes % 1440) + 1440) % 1440;
    const open = minute >= 360 && minute <= 1200;
    const targetCount = open ? clamp(Math.round(((state.shop.salesYesterday.units || 2) / 8) * 3), 1, 6) : 0;
    if (open && customers.length < targetCount && Math.random() < dt * 0.15) spawnCustomer();
    if (!open) {
      for (const c of customers) {
        if (c.stops[c.stopIdx] && c.stops[c.stopIdx].kind !== 'exit' && c.stops[c.stopIdx].kind !== 'gone') {
          leaveQueue(c);
          c.stopIdx = c.stops.length - 2; // head for the exit
          c.linger = 0;
        }
      }
    }

    for (let i = customers.length - 1; i >= 0; i--) {
      const c = customers[i];
      const char = c.mesh.userData.char;
      if (char) char.update(dt);
      const stop = c.stops[c.stopIdx];
      if (!stop) { custGroup.remove(c.mesh); customers.splice(i, 1); continue; }

      let tx = stop.x;
      let tz = stop.z;
      if (stop.kind === 'counter') {
        if (!c.queued) {
          counterQueue.push(c);
          c.queued = true;
        }
        const slot = queueSlotW(counterQueue.indexOf(c));
        tx = slot.x;
        tz = slot.z;
      }

      const dx = tx - c.mesh.position.x;
      const dz = tz - c.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.18) {
        if (stop.kind === 'enter' && !c.rangBell) {
          c.rangBell = true;
          if (hooks.sfx) hooks.sfx('doorbell');
        }
        const isPass = stop.kind === 'walk' || stop.kind === 'enter' || stop.kind === 'exit' || stop.kind === 'gone';
        const served = stop.kind !== 'counter' || counterQueue.indexOf(c) === 0;
        if (stop.kind === 'gone') {
          custGroup.remove(c.mesh);
          customers.splice(i, 1);
          continue;
        }
        // the head of the line with a basket waits for the PLAYER to ring
        // them up — patience runs out eventually and the pick goes back
        if (stop.kind === 'counter' && c.cart.length && counterQueue.indexOf(c) === 0) {
          c.awaitingCheckout = true;
          c.patience -= dt;
          if (char) char.setMode('Idle');
          if (c.patience <= 0) customerGiveUp(c);
        } else if (!served) {
          if (char) char.setMode('Idle');
        } else if (!isPass && c.linger > 0) {
          if (char) char.setMode(stop.kind === 'fixture' ? 'Browse' : 'Idle');
          c.linger -= dt;
        } else {
          if (stop.kind === 'fixture') customerPick(c, stop);
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
      c.mesh.position.y = groundYAt(c.mesh.position.x, c.mesh.position.z) ?? heightAt(c.mesh.position.x, c.mesh.position.z);
    }
  }

  // --- per-frame update -------------------------------------------------------------------
  let now = 0;
  let poll = 0;
  let visClock = 0;

  function update(dtMs) {
    const dt = Math.min(0.1, dtMs / 1000);
    now += dt;
    updateDoors(dt, now);
    updateCustomers(dt);
    updateFlicker(dt);
    if (moteFade > 0) {
      moteFade -= dt;
      if (moteFade <= 0) motes.visible = false;
    }
    // the set-down prompt rides just ahead of a loaded player
    if (carriedMesh) {
      carryProp.x = walk.x - Math.sin(walk.yaw) * 0.9;
      carryProp.z = walk.z - Math.cos(walk.yaw) * 0.9;
      carriedMesh.position.y = -0.62 + Math.sin(now * 6.2) * 0.012; // a carried weight breathes
    }
    poll += dt;
    if (poll > 1.1) {
      poll = 0;
      updateArrivals();
      if (boxSignature() !== boxSig) rebuildBoxes(); // the truck came, or staff unboxed
      if (office.paintScreen && interior.visible) office.paintScreen(); // live clock on the lid
      const ds = decorSignature();
      if (ds !== decorSig) {
        decorSig = ds;
        rebuildDecor();
        refreshCondition();
      }
      const ss = stockSignature();
      if (ss !== stockSig) {
        stockSig = ss;
        rebuildStock();
      }
    }
    // interior detail only draws when someone could actually see it
    visClock += dt;
    if (visClock > 0.5) {
      visClock = 0;
      const cd = Math.hypot(camera.position.x - center.x, camera.position.z - center.z);
      interior.visible = cd < 80;
    }
  }

  // --- boot -----------------------------------------------------------------------------
  rebuildReno();
  rebuildStock();
  rebuildBoxes();
  stockSig = stockSignature();

  function dispose() {
    scene.remove(group, interior, custGroup, motes, boxGroup);
    if (carriedMesh) camera.remove(carriedMesh);
    for (const p of [...registeredProps]) removeProp(p);
    for (const c of [...registeredCols]) removeCol(c);
    for (const m of ctx.extraMeshes || []) scene.remove(m);
    customers.length = 0;
  }

  return {
    group, interior,
    update, rebuildStock, rebuildReno, refreshCondition, repaintGrime,
    isInside, groundYAt, vacuumAt, vacuumLabelAt,
    doorWorld: doorW,
    laptopPose: () => office.laptopPose,
    condition: () => conditionNow,
    customers, doors, // QA access
    debugSpawn: spawnCustomer, // QA: force a walk-in
    dispose,
  };
}
