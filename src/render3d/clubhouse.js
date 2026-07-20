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
import { fitDistance } from '../core/screenFit.js';
import { LAPTOP, screenCornersLocal, screenNormalLocal } from '../core/laptopRig.js';
import { makeCharacter } from './characterAsset.js';
import { SHOP_CATALOG, SHELF_CAP, DECOR_SPOTS } from '../data/shopItems.js';
import {
  SHELL, INTERIOR, FIXTURES, COUNTER, OFFICE, STOCKROOM, LOUNGE,
  DOOR_MAIN, DOOR_STOCK, DOOR_BACK,
  MAT, HOURS_SIGN, queueSlot, fixtureSockets, REGISTER, COUNTER_TOP,
} from '../data/shopLayout.js';
import {
  RENO, shopCondition, cleanGrimeAt, clearClutter, placeDecor, removeDecor,
  restockShelfFromBackroom, priceFor, windowDirtAvg,
} from '../sim/shop.js';
import {
  boxesOf, pickUpBox, putDownBox, carriedBox, openBox, emptyTrash,
  cutTape, openFlap, takeFromBox, flattenBox, recycleBox,
  tapeCut, tapeUncut, flapsOpen, isEmpty, boxState,
} from '../sim/deliveries.js';
import {
  carriedGoods, stockFixture, storeInBack, homeOf, carrySpeedFactor,
} from '../sim/stocking.js';
import { boxDims, boxKindFor } from '../data/boxes.js';
import { pickFromShelf, returnToShelf } from '../sim/checkout.js';
import { addRevenue } from '../sim/economy.js';
import { tutorialFlag } from '../sim/tutorial.js';
import { dueForCheckIn, checkInReservation, fmtSlot } from '../sim/reservations.js';
import { makeClubhouseMaterials, roundedBox, makeSignTexture, makeProductLabel } from './clubhouse/materials.js';
import { createMerch } from './clubhouse/merch.js';
import { slotsFor } from '../data/fixtureSlots.js';
import { buildShell } from './clubhouse/shell.js';
import { buildDoors } from './clubhouse/doors.js';
import { buildFixtures, buildLounge, buildStockroomDressing, buildCheckout } from './clubhouse/fixtures.js';
import { createRegisterMode } from './clubhouse/registerMode.js';
import { buildDirt } from './clubhouse/dirt.js';
import { makeNav } from './clubhouse/nav.js';
import { productThumb } from './clubhouse/thumbs.js';
import { buildExterior } from './clubhouse/exterior.js';
import { buildWashing } from './clubhouse/washing.js';
import { placedFixtures, ensureLayout, legalBoxDrop } from '../sim/layout.js';
import { buildBuildMode } from './clubhouse/buildMode.js';
import { reviewFor, postReview } from '../sim/reviews.js';

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
  let colVersion = 0; // customers' nav grid rebakes when the collider world changes
  function addCol(col) {
    propColliders.push(col);
    custCols.push(col);
    registeredCols.push(col);
    colVersion++;
    return col;
  }
  function removeCol(col) {
    for (const arr of [propColliders, custCols, registeredCols]) {
      const i = arr.indexOf(col);
      if (i >= 0) arr.splice(i, 1);
    }
    colVersion++;
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

  // --- materials + the building shell (clubhouse/materials.js + clubhouse/shell.js) ------
  const mats = makeClubhouseMaterials((state && state.clubName) || 'The Club');
  // The Blender-authored goods. They arrive after the shop is built, so the shop
  // restocks once they land — a shelf that is briefly bare beats one permanently
  // made of boxes. The restock hook is registered at the END of the build, not
  // here: a GLB that fails fast can call back before this function has finished
  // running, and rebuildStock() closes over state declared further down (it hit
  // exactly that dead zone once).
  const merch = createMerch(mats);
  // legacy aliases: sections still awaiting their v2 pass draw from the kit
  const woodMat = mats.walnut;
  const darkMat = mats.walnutDark;
  const railMat = mats.walnut;
  const trimMat = mats.trimPaint;
  const glassMat = mats.glass;
  const halfW = SHELL.w / 2 - SHELL.wallT / 2; // wall centerlines
  const halfD = SHELL.d / 2 - SHELL.wallT / 2;

  const B = {
    ctx, state, group, interior, custGroup, mats, merch, hooks, walk,
    addCol, removeCol, addProp, removeProp, colBoxAt, L2W, W2L, FLOOR_TOP,
    getCustomers: () => customers,
  };
  const shell = buildShell(B);

  // --- grime + window film (clubhouse/dirt.js — art-directed, state-masked) --------------
  B.onWindowDirt = () => shell.lighting.setWindowDirt(windowDirtAvg(state));
  const dirt = buildDirt(B, shell.windowDefs);
  const repaintGrime = dirt.repaintGrime;
  B.onWindowDirt();

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

  // --- doors + interior lighting (clubhouse/doors.js + the shell rig) --------------------
  const doorsApi = buildDoors(B);
  const doors = doorsApi.doors;
  const updateDoors = doorsApi.updateDoors;
  buildExterior(B); // yard neglect + physical repair verbs (clubhouse/exterior.js)
  const washing = buildWashing(B); // exterior grime: a mask you erode with the jet, not an [E] verb
  scene.add(washing.jet, washing.mist);

  let conditionNow = 100;
  function refreshCondition() {
    conditionNow = state && state.shop ? shopCondition(state) : 100;
    shell.lighting.refreshCondition(conditionNow);
  }
  const updateFlicker = (dt) => shell.lighting.updateFlicker(dt);

  // --- fixtures, lounge, stockroom dressing (clubhouse/fixtures.js) ----------------------
  B.rebuildStock = (...a) => rebuildStock(...a); // function is hoisted; wired before use
  const { fixtureAnchors, relayFixtures } = buildFixtures(B);

  // the player moved something: re-lay the floor and put the stock back on it. The customers'
  // paths rebake themselves — removeCol/addCol bump colVersion, and navFresh() watches it — so a
  // shelf that moved is a wall that moved, as far as they are concerned.
  function rebuildLayout() {
    relayFixtures();
    rebuildStock();
  }

  // build mode needs the anchors it is going to hide and the re-lay it is going to trigger, so it
  // is built here rather than up with the rest of the scene
  const builder = buildBuildMode(B, { rebuildLayout, fixtureAnchors });
  buildLounge(B);
  buildStockroomDressing(B);

  // --- THE REGISTER ---------------------------------------------------------------------
  // The old checkout lived here: one addProp with a context-sensitive [E] that scanned
  // an item, then totalled up, then ran the card, then cycled a change amount, with [R]
  // to confirm. Every verb was the same key on the same invisible trigger, and nothing
  // on the counter ever moved. All of that is gone. clubhouse/registerMode.js owns the
  // counter now, and it owns it PHYSICALLY.
  //
  // What is left here is the join: a customer reaching the head of the queue starts a
  // transaction, standing at the counter offers [E] to step into it, and a customer who
  // walks out takes their goods back to the shelf.
  const register = createRegisterMode(B);
  B.register = register;

  const checkout = buildCheckout(B);
  const drawRegister = checkout.drawRegister;

  const regWp = L2W(REGISTER.scanner.x, COUNTER.z);

  // what this customer's day was actually like — the only thing a review is allowed to read
  const visitOf = (c, bought) => ({
    waitedSec: c.queuedAt ? Math.max(0, now - c.queuedAt) : 0,
    queueLen: c.queueLenOnArrival || 0,
    bought,
    played: !!c.isGolfer,
    foundWhatTheyWanted: bought,
  });
  const leaveReview = (c, bought) => {
    if (c.reviewed) return null;
    c.reviewed = true;
    const r = reviewFor(state, visitOf(c, bought), Math.round((c.seed || 0) * 1000 + (state.dayAbs || 0)));
    postReview(state, r);
    return r;
  };

  // the head of the queue, with goods, waiting on YOU
  const headForCheckout = () => {
    const c = counterQueue[0];
    return c && c.cart && c.cart.length && c.awaitingCheckout ? c : null;
  };

  // The sale banked. registerMode calls this through cust.onPaid, because IT owns the
  // money and the goods, and clubhouse.js owns the person.
  function onCustomerPaid(c) {
    c.bought = true;
    leaveReview(c, true);
    if (c.itemMesh) { c.mesh.remove(c.itemMesh); c.itemMesh = null; }
    // a branded carrier into their hand — they walk out with it
    const bag = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.26, 0.13),
      new THREE.MeshStandardMaterial({ color: 0x2e5a3a, roughness: 0.85 }),
    );
    body.position.y = 0.13;
    bag.add(body);
    for (const off of [-0.05, 0.05]) {
      const h = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, 0.09, 0.015),
        new THREE.MeshStandardMaterial({ color: 0x1d3a26, roughness: 0.8 }),
      );
      h.position.set(off, 0.3, 0);
      bag.add(h);
    }
    bag.position.set(0.3, 0.62, 0.05);
    bag.rotation.y = 0.2;
    c.mesh.add(bag);

    c.cart = [];
    c.awaitingCheckout = false;
    leaveQueue(c);
    c.stopIdx += 1;
    c.linger = 0;
    rebuildStock(); // the shelf gap where their pick came from stays real
  }

  addProp({
    x: regWp.x, z: regWp.z, r: 2.2,
    label: () => {
      const due = dueForCheckIn(state);
      if (due.length) {
        const r = due[0];
        return `Register — [E] check in ${r.name} (${fmtSlot(r.minute)} tee, ${Math.round(r.fee)} dollars)`
          + (due.length > 1 ? ` · ${due.length - 1} more waiting` : '');
      }
      const l = register.label();
      if (l) return l;
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
      if (register.hasTx()) register.enter();
      else if (hooks.toast) hooks.toast('Nobody to serve.', 'warn');
    },
  });

  // [R] is gone as a checkout verb — the change goes into a hand now, not into a
  // keypress. The API keeps the name so main.js does not have to care.
  const regConfirmChange = () => false;

  {

    // THE CREST PANEL behind the counter. This was the club's name and three flat
    // triangles PAINTED DIRECTLY ON THE PLASTER as a transparent decal, and it was
    // the loudest placeholder left in the room: a wall wordmark reads as a decal
    // because that is exactly what it was. Ref 4 has an architectural feature —
    // a cream field set in a walnut surround, standing proud of the wall, lit from
    // above by its own picture light. That is what this is now.
    // The wall behind the counter is not free: the back-counter hutch runs up to
    // y 2.27 and the ceiling is at 3.2, so there is 0.9 yd of wall to work with.
    // A tall portrait panel simply hid behind the shelves. This is a wide sign
    // board above them — which is what ref 4 actually shows.
    const logoCanvas = document.createElement('canvas');
    logoCanvas.width = 1024;
    logoCanvas.height = 288;
    const logoTex = new THREE.CanvasTexture(logoCanvas);
    logoTex.colorSpace = THREE.SRGBColorSpace;

    const crest = new THREE.Group();
    crest.position.set(COUNTER.x, 2.74, INTERIOR.d / 2 - 0.02);
    crest.rotation.y = Math.PI;

    const PW = 2.90;
    const PH = 0.80;
    // walnut surround: a backer with real thickness, plus four mitered rails
    const backer = new THREE.Mesh(roundedBox(PW + 0.22, PH + 0.22, 0.07, 0.015), mats.walnut);
    backer.position.z = -0.035;
    backer.castShadow = true;
    crest.add(backer);
    for (const [w, h, px, py] of [
      [PW + 0.22, 0.11, 0, (PH + 0.11) / 2], [PW + 0.22, 0.11, 0, -(PH + 0.11) / 2],
      [0.11, PH + 0.22, (PW + 0.11) / 2, 0], [0.11, PH + 0.22, -(PW + 0.11) / 2, 0],
    ]) {
      const rail = new THREE.Mesh(roundedBox(w, h, 0.06, 0.012), mats.walnutDark);
      rail.position.set(px, py, 0.01);
      crest.add(rail);
    }
    // the field itself: a lit cream panel, not a hole in the plaster
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(PW, PH),
      new THREE.MeshStandardMaterial({
        map: logoTex, roughness: 0.88,
        emissive: 0xfff0d6, emissiveMap: logoTex, emissiveIntensity: 0.28,
      }),
    );
    field.position.z = 0.005;
    crest.add(field);
    interior.add(crest);

    // its own picture light, throwing a wash down the panel
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 6), mats.iron);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(COUNTER.x, 3.22, INTERIOR.d / 2 - 0.16);
    interior.add(arm);
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.5, 10, 1, true), mats.iron);
    hood.rotation.z = Math.PI / 2;
    hood.position.set(COUNTER.x, 3.22, INTERIOR.d / 2 - 0.27);
    hood.material.side = THREE.DoubleSide;
    interior.add(hood);
    const wash = new THREE.SpotLight(0xffe9c2, 6, 3.2, 0.8, 0.7, 1.6);
    wash.position.set(COUNTER.x, 3.18, INTERIOR.d / 2 - 0.30);
    wash.target.position.set(COUNTER.x, 2.72, INTERIOR.d / 2 - 0.05);
    interior.add(wash, wash.target);

    redrawLogoInto(logoCanvas, logoTex);
  }

  // The crest panel's face. It used to clearRect() to transparent — because it was
  // a decal stuck on the plaster. It is a real printed panel now, so it has a
  // field, a rule, and a single pine mark instead of three floating triangles.
  function redrawLogoInto(cv, tex) {
    const name = (state && state.clubName) || 'THE CLUB';
    const W = cv.width;
    const H = cv.height;
    const c2 = cv.getContext('2d');

    // aged cream field with a little tooth
    c2.fillStyle = '#f2ecdc';
    c2.fillRect(0, 0, W, H);
    let s = 991;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = 0; i < 5000; i++) {
      c2.fillStyle = rnd() < 0.5 ? '#e6dfcb30' : '#fbf6e920';
      c2.fillRect(rnd() * W, rnd() * H, 2, 2);
    }

    // a hairline gold border, as a real sign board has
    c2.strokeStyle = '#b99a3e';
    c2.lineWidth = 3;
    c2.strokeRect(14, 14, W - 28, H - 28);

    // ONE pine on the left, drawn as stacked tiers with a trunk — a mark, not
    // three floating triangles
    const px = W * 0.135;
    const top = H * 0.18;
    c2.fillStyle = '#2c5233';
    for (let t = 0; t < 4; t++) {
      const w = 34 + t * 20;
      const y = top + t * 34;
      c2.beginPath();
      c2.moveTo(px, y);
      c2.lineTo(px - w / 2, y + 48);
      c2.lineTo(px + w / 2, y + 48);
      c2.closePath();
      c2.fill();
    }
    c2.fillRect(px - 6, top + 158, 12, 24);

    // name + sub-line to the right of the mark
    const tx = W * 0.58;
    c2.textAlign = 'center';
    c2.fillStyle = '#2c5233';
    let size = 78;
    const upper = name.toUpperCase();
    c2.font = `bold ${size}px Georgia, serif`;
    while (c2.measureText(upper).width > W * 0.68 && size > 30) {
      size -= 2;
      c2.font = `bold ${size}px Georgia, serif`;
    }
    c2.fillText(upper, tx, H * 0.52);

    c2.strokeStyle = '#b99a3e';
    c2.lineWidth = 2.5;
    c2.beginPath();
    c2.moveTo(tx - W * 0.16, H * 0.63);
    c2.lineTo(tx + W * 0.16, H * 0.63);
    c2.stroke();

    c2.fillStyle = '#6b7f68';
    c2.font = '30px Georgia, serif';
    c2.fillText('P R O   S H O P', tx, H * 0.83);
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

    // task chair (ref 10) — a real green-leather executive chair (Tripo scan) with a
    // gas lift, five-star base and casters, replacing the procedural block.
    merch.onReady(() => {
      const chair = merch.instantiateRaw('office_chair');
      if (!chair) return;
      chair.position.set(OFFICE.chair.x, 0, OFFICE.chair.z);
      chair.rotation.y = -Math.PI / 2;
      interior.add(chair);
    });

    // wall course map — a real framed board, flush on the office's south wall:
    // backing panel with thickness, mitered frame lip, map face proud of the
    // backer. Mounted on actual wall so no side ever shows a floating plane.
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = 600;
    mapCanvas.height = 400;
    const mapTex = new THREE.CanvasTexture(mapCanvas);
    mapTex.colorSpace = THREE.SRGBColorSpace;
    const mapBoard = new THREE.Group();
    mapBoard.position.set(OFFICE.map.x, 1.72, OFFICE.map.z);
    mapBoard.rotation.y = OFFICE.map.ry;
    const mapBacker = new THREE.Mesh(roundedBox(2.42, 1.68, 0.05, 0.012), mats.walnutDark);
    mapBacker.position.z = -0.025;
    mapBacker.castShadow = true;
    mapBoard.add(mapBacker);
    // frame lip (four mitered rails proud of the face)
    const lipMat = mats.walnut;
    for (const [w, h, px, py] of [
      [2.42, 0.07, 0, 0.805], [2.42, 0.07, 0, -0.805],
      [0.07, 1.68, 1.175, 0], [0.07, 1.68, -1.175, 0],
    ]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.045), lipMat);
      rail.position.set(px, py, 0.012);
      mapBoard.add(rail);
    }
    const courseMap = new THREE.Mesh(
      new THREE.PlaneGeometry(2.24, 1.5),
      new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.85 }),
    );
    courseMap.position.z = 0.003;
    mapBoard.add(courseMap);
    interior.add(mapBoard);
    const MAP_COLORS = ['#46543a', '#5c7d43', '#7cb257', '#96d377', '#8ac168', '#d8c78e', '#3e6f9e', '#a89f8d'];
    const redrawCourseMap = () => {
      const course = state.course;
      const c2 = mapCanvas.getContext('2d');
      const W = 600, H = 400, M = 24, TOP = 48;
      c2.fillStyle = '#efe7d2'; c2.fillRect(0, 0, W, H);          // parchment mount
      c2.fillStyle = '#1f4a2e'; c2.fillRect(0, 0, W, TOP);        // title band
      c2.fillStyle = '#efe7d2'; c2.textBaseline = 'middle';
      c2.font = 'bold 23px Georgia, serif'; c2.fillText('PINEHOLLOW GOLF CLUB', 20, TOP / 2 - 1);
      c2.font = 'italic 13px Georgia, serif'; c2.textAlign = 'right'; c2.fillText('COURSE MAP', W - 20, TOP / 2);
      c2.textAlign = 'left';
      const x0 = M, y0 = TOP + 12, iw = W - M * 2, ih = H - y0 - M;
      const sx = iw / course.w, sy = ih / course.h;
      for (let y = 0; y < course.h; y++) {
        for (let x = 0; x < course.w; x++) {
          c2.fillStyle = MAP_COLORS[course.zones[y * course.w + x]] || '#46543a';
          c2.fillRect(x0 + x * sx, y0 + y * sy, sx + 0.6, sy + 0.6);
        }
      }
      c2.font = 'bold 12px Arial';
      state.course.holes.forEach((h, i) => {
        if (!h.pin) return;
        const px = x0 + h.pin.x * sx, py = y0 + h.pin.y * sy;
        c2.fillStyle = '#d84b3a'; c2.beginPath(); c2.arc(px, py, 4.5, 0, 7); c2.fill();
        c2.fillStyle = '#efe7d2'; c2.strokeStyle = '#22331e'; c2.lineWidth = 2.5;
        c2.strokeText(String(i + 1), px + 6, py); c2.fillText(String(i + 1), px + 6, py);
      });
      c2.strokeStyle = '#8a7a52'; c2.lineWidth = 3; c2.strokeRect(x0 - 5, y0 - 5, iw + 10, ih + 10);
      mapTex.needsUpdate = true;
    };
    redrawCourseMap();
    const mapWp = L2W(OFFICE.map.x, OFFICE.map.z - 0.5);
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

    // THE LAPTOP — a real ~15" machine that starts CLOSED on the desk. E parks
    // you at the chair, the lid swings open around its rear hinge, the power
    // light comes on, a short boot plays on the physical screen — and then the
    // Fairway Office interface is projected ONTO that screen (main.js aligns
    // the DOM to the projected corners; no detached popup).
    // Every dimension comes from src/core/laptopRig.js and nothing is invented here, so the
    // orientation tests in laptop-rig.test.js are testing THIS machine and not a paper one.
    // The old machine was 21.6 inches across the deck with a 23.8-inch display — a television.
    const LID_OPEN = LAPTOP.lidOpen;
    const laptop = new THREE.Group();
    const alu = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.75 });
    const aluDark = new THREE.MeshStandardMaterial({ color: 0x62676d, roughness: 0.4, metalness: 0.7 });
    const deck = new THREE.Mesh(roundedBox(LAPTOP.deck.w, LAPTOP.deck.t, LAPTOP.deck.d, 0.005), alu);
    deck.position.y = LAPTOP.deck.t / 2;
    deck.castShadow = true;
    laptop.add(deck);
    // keyboard: a canvas keycap grid inset into the deck. It sits BEYOND the trackpad and
    // NEARER than the display — the order a real laptop has, and the one the brief asks for.
    const kbCv = document.createElement('canvas');
    kbCv.width = 280; kbCv.height = 104;
    const kc = kbCv.getContext('2d');
    kc.fillStyle = '#4a4f55'; kc.fillRect(0, 0, 280, 104);
    kc.fillStyle = '#1d2024';
    const rowKeys = [14, 14, 13, 12, 9];
    for (let r = 0; r < 5; r++) {
      const n = rowKeys[r];
      const kw = 280 / n - 4;
      for (let c = 0; c < n; c++) kc.fillRect(3 + c * (280 / n), 4 + r * 20, kw, 16);
    }
    kc.fillStyle = '#1d2024';
    kc.fillRect(84, 84, 112, 16); // spacebar
    const kbTex = new THREE.CanvasTexture(kbCv);
    kbTex.colorSpace = THREE.SRGBColorSpace;
    const kb = new THREE.Mesh(
      new THREE.PlaneGeometry(LAPTOP.keyboard.w, LAPTOP.keyboard.d),
      new THREE.MeshStandardMaterial({ map: kbTex, roughness: 0.8 }),
    );
    kb.rotation.x = -Math.PI / 2;
    kb.position.set(0, LAPTOP.deck.t + 0.0012, LAPTOP.keyboard.z);
    laptop.add(kb);
    const trackpad = new THREE.Mesh(
      new THREE.PlaneGeometry(LAPTOP.trackpad.w, LAPTOP.trackpad.d),
      new THREE.MeshStandardMaterial({ color: 0x83898f, roughness: 0.3, metalness: 0.45 }),
    );
    trackpad.rotation.x = -Math.PI / 2;
    trackpad.position.set(0, LAPTOP.deck.t + 0.0014, LAPTOP.trackpad.z); // the palm rest, nearest the seat
    laptop.add(trackpad);

    // lid: hinged on the FAR edge (local +z), so it opens AWAY from the seated player and the
    // display leans back toward them. angle 0 = CLOSED, flat over the deck.
    const lidHinge = new THREE.Group();
    lidHinge.position.set(0, LAPTOP.hingeY, LAPTOP.hingeZ);
    const lid = new THREE.Mesh(roundedBox(LAPTOP.lid.w, LAPTOP.lid.t, LAPTOP.lid.d, 0.004), aluDark);
    lid.position.set(0, LAPTOP.lid.t / 2, -LAPTOP.lid.d / 2);
    lid.castShadow = true;
    lidHinge.add(lid);
    // THE BEZEL. There wasn't one: the glass was the whole underside of the lid, edge to edge,
    // which is why the interface always looked like a panel stuck to a slab rather than a screen
    // set into a machine. A black surround, and the display inset into it.
    const bezel = new THREE.Mesh(
      new THREE.PlaneGeometry(LAPTOP.lid.w - 0.004, LAPTOP.lid.d - 0.004),
      new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.55 }),
    );
    bezel.rotation.set(Math.PI / 2, 0, Math.PI);
    bezel.position.set(0, -0.0004, -LAPTOP.lid.d / 2);
    lidHinge.add(bezel);

    const screenCv = document.createElement('canvas');
    screenCv.width = 512; screenCv.height = 320; // 16:10, same as the interface
    const screenTex = new THREE.CanvasTexture(screenCv);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    // The glass faces DOWN when closed (it is the underside of the lid). The in-plane π turn
    // makes the painted image read upright and unmirrored to the seated player: plane-right
    // becomes local -x (the player's right) and plane-up becomes local -z (away from the
    // barrel, which is UP once the lid stands). laptopRig's screenCornersLocal assumes exactly
    // this — the two must not drift apart, or the DOM lands on the glass upside down.
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(LAPTOP.screen.w, LAPTOP.screen.h),
      new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 0.62, roughness: 0.22 }),
    );
    screen.rotation.set(Math.PI / 2, 0, Math.PI);
    screen.position.set(0, -0.0006, -LAPTOP.lid.d / 2);
    lidHinge.add(screen);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.005, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0x223528, emissive: 0x35d06a, emissiveIntensity: 0.0 }),
    );
    led.position.set(LAPTOP.led.x, LAPTOP.deck.t, LAPTOP.led.z); // front lip, player side
    laptop.add(led, lidHinge);
    laptop.position.set(OFFICE.laptop.x - 0.10, 0.96, OFFICE.laptop.z);
    laptop.rotation.y = OFFICE.laptop.ry;
    interior.add(laptop);

    // SCREEN STATE: 'off' → 'boot' → 'live' (the DOM is on the glass) | 'desk' (nobody sitting)
    //
    // This canvas used to paint a full DESKTOP — a green wallpaper with Supplier / Pro Shop /
    // Tee Sheet tiles — and it kept painting it while the real interface was projected on top.
    // Two interfaces, one screen. You could read the canvas menu THROUGH the gaps around the
    // misaligned DOM, and the whole thing read as a popup floating over a wallpaper, which is
    // exactly what the brief rejected. There is now no second menu anywhere:
    //
    //   'live' — a flat sheet of the interface's own paper colour. The DOM covers it exactly, so
    //            even a sub-pixel seam at the bezel shows cream, never a competing screen.
    //   'desk' — what you see walking PAST the open laptop: a lock screen. Crest, club, clock.
    //            Information, not navigation. There is nothing on it to click.
    let screenMode = 'off';
    let bootT0 = 0;
    const clock12 = () => {
      const mins = Math.floor(((state.clock.minutes % 1440) + 1440) % 1440);
      const hh = Math.floor(mins / 60);
      return `${((hh + 11) % 12) + 1}:${String(mins % 60).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
    };
    const pineMark = (c2, cx, cy, s, fill) => {
      c2.fillStyle = fill;
      for (let t = 0; t < 3; t++) {
        const w = s * (1 - t * 0.22);
        const yTop = cy - s * 0.6 + t * s * 0.34;
        c2.beginPath();
        c2.moveTo(cx, yTop);
        c2.lineTo(cx - w / 2, yTop + s * 0.44);
        c2.lineTo(cx + w / 2, yTop + s * 0.44);
        c2.closePath();
        c2.fill();
      }
      c2.fillRect(cx - s * 0.06, cy + s * 0.5, s * 0.12, s * 0.2);
    };
    function paintScreen(mode) {
      if (mode) screenMode = mode;
      const c2 = screenCv.getContext('2d');
      if (screenMode === 'off') {
        const g = c2.createLinearGradient(0, 0, 512, 320);
        g.addColorStop(0, '#14171b');
        g.addColorStop(0.5, '#1c2026');
        g.addColorStop(1, '#14171b');
        c2.fillStyle = g;
        c2.fillRect(0, 0, 512, 320);
        screenTex.needsUpdate = true;
        return;
      }
      if (screenMode === 'boot') {
        const p = Math.min(1, (performance.now() - bootT0) / 850);
        c2.fillStyle = '#10141a';
        c2.fillRect(0, 0, 512, 320);
        pineMark(c2, 256, 120, 48, '#2e5a35');
        c2.fillStyle = '#f4f0e6';
        c2.font = 'bold 21px Georgia, serif';
        c2.textAlign = 'center';
        c2.fillText('Fairway Office', 256, 208);
        c2.strokeStyle = '#2b3138';
        c2.strokeRect(176, 232, 160, 8);
        c2.fillStyle = '#35d06a';
        c2.fillRect(178, 234, 156 * p, 4);
        screenTex.needsUpdate = true;
        return;
      }
      if (screenMode === 'live') {
        // the interface itself is a DOM welded to this rectangle. Underneath it, paper.
        c2.fillStyle = '#f4f0e6';
        c2.fillRect(0, 0, 512, 320);
        screenTex.needsUpdate = true;
        return;
      }
      // 'desk' — the lock screen. Nothing here is a menu.
      const grad = c2.createLinearGradient(0, 0, 0, 320);
      grad.addColorStop(0, '#1d3324');
      grad.addColorStop(1, '#0f1a14');
      c2.fillStyle = grad;
      c2.fillRect(0, 0, 512, 320);
      pineMark(c2, 256, 108, 44, '#2f5c39');
      c2.textAlign = 'center';
      c2.fillStyle = '#e8efe4';
      c2.font = 'bold 22px Georgia, serif';
      c2.fillText(state.clubName || 'The Club', 256, 196);
      c2.fillStyle = '#8fae95';
      c2.font = '15px system-ui, sans-serif';
      c2.fillText(clock12(), 256, 224);
      c2.fillStyle = '#5d7a64';
      c2.font = '12px system-ui, sans-serif';
      c2.fillText('Fairway Office — press E to sign in', 256, 286);
      screenTex.needsUpdate = true;
    }
    paintScreen('off');
    office.paintScreen = paintScreen;
    office.screenMode = () => screenMode;

    // lid animation driven from the clubhouse update loop
    const lidState = { angle: 0, target: 0 };
    office.updateLid = (dt) => {
      const diff = lidState.target - lidState.angle;
      if (Math.abs(diff) > 0.001) {
        lidState.angle += diff * Math.min(1, dt * 6.5);
        lidHinge.rotation.x = lidState.angle;
      }
      if (screenMode === 'boot') paintScreen(); // animate the progress bar
    };
    office.setLid = (open) => {
      lidState.target = open ? LID_OPEN : 0;
      led.material.emissiveIntensity = open ? 1.4 : 0.0;
    };
    office.startBoot = () => {
      bootT0 = performance.now();
      paintScreen('boot');
    };
    // World-space corners of the DISPLAY, in the order the seated player reads them:
    // [top-left, top-right, bottom-right, bottom-left].
    //
    // main.js used to project all four and SORT them by y to guess which pair was the top. That
    // guess is only ever as good as the camera angle, and it is unnecessary: the lid's own frame
    // knows the answer exactly. laptopRig hands it over; the guess is deleted.
    //
    // Note this reads the LIVE lid angle, so the corners are correct mid-swing too — which is
    // what lets the interface ride the lid open instead of popping in once it has stopped.
    office.screenCorners = () => {
      laptop.updateWorldMatrix(true, false);
      return screenCornersLocal(lidState.angle)
        .map((c) => laptop.localToWorld(new THREE.Vector3(c.x, c.y, c.z)));
    };
    office.lidAngle = () => lidState.angle;
    office.lidOpenAngle = LID_OPEN;
    office.laptopObject = laptop;

    const compWp = L2W(OFFICE.laptop.x, OFFICE.laptop.z);
    office.computerProp = addProp({
      x: compWp.x, z: compWp.z, r: 2.3,
      label: () => 'Laptop — [E] open Fairway Office',
      action: () => { if (hooks.openLaptop) hooks.openLaptop(); },
    });
    office.laptop = laptop;

    // Where the camera settles when you sit down. Derived from the OPEN lid, the live field of
    // view and the window shape, so the screen fills the view on any monitor — a hardcoded seat
    // is what left it at 9.7% of the viewport once before. The lid is still shut when the player
    // presses E, so this asks the rig where the glass WILL be rather than posing the mesh.
    office.seatPose = (fovDeg = 60, aspect = 16 / 9) => {
      laptop.updateWorldMatrix(true, false);
      const corners = screenCornersLocal(LID_OPEN)
        .map((c) => laptop.localToWorld(new THREE.Vector3(c.x, c.y, c.z)));
      const centre = new THREE.Vector3();
      for (const c of corners) centre.add(c);
      centre.multiplyScalar(0.25);
      const n = screenNormalLocal(LID_OPEN);
      const out = new THREE.Vector3(n.x, n.y, n.z).transformDirection(laptop.matrixWorld).normalize();

      const dist = fitDistance({
        screenW: LAPTOP.screen.w, screenH: LAPTOP.screen.h, fovDeg, aspect, fracH: 0.80, fracW: 0.90,
      });
      // Sit a touch high and aim a touch low. Both together push the screen up in frame and
      // leave the bezel and a strip of keyboard showing underneath it — which is the difference
      // between sitting at a laptop and having a menu shoved in your face.
      const eye = centre.clone().addScaledVector(out, dist);
      eye.y += LAPTOP.screen.h * 0.16;
      const aim = centre.clone();
      aim.y -= LAPTOP.screen.h * 0.10;

      // look back at the screen: forward = (-sin y cos p, sin p, -cos y cos p)
      const f = aim.clone().sub(eye).normalize();
      return {
        x: eye.x, y: eye.y, z: eye.z,
        yaw: Math.atan2(-f.x, -f.z),
        pitch: Math.asin(Math.max(-1, Math.min(1, f.y))),
      };
    };

    // The orientation gizmos that lived here (forward vector, keyboard direction, screen
    // normal, hinge axis, interaction point, camera position and target) did their job and
    // have been removed, as the brief asks. They proved the machine faces the chair ONCE.
    // tests/laptop-rig.test.js proves it on every run — which is the version worth keeping.
    // Evidence: qa/laptop/debug/.
  }

  // lounge dressing: trophy shelf + course photo (sofa arrives as decor)
  {
    const shelf = new THREE.Group();
    for (const y of [1.5, 1.05]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.3), woodMat);
      board.position.set(0, y, 0);
      shelf.add(board);
    }
    // trophies — were plain gold cylinders; a real cup has a bowl, a stem, a base
    // and two handles, which is what the audit asked for (ref 8).
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: 0.85, roughness: 0.26 });
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.6 });
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.066, 0.036, 14), plinthMat);
      base.position.y = 0.018;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.055, 10), goldMat);
      stem.position.y = 0.064;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.02, 0.085, 14, 1, true), goldMat);
      bowl.position.y = 0.134;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 16), goldMat);
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.176;
      t.add(base, stem, bowl, rim);
      for (const sgn of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.005, 6, 12, Math.PI), goldMat);
        h.position.set(sgn * 0.05, 0.146, 0);
        h.rotation.set(Math.PI / 2, 0, sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
        t.add(h);
      }
      t.castShadow = true;
      t.scale.setScalar(0.85 + (i % 2) * 0.22);
      t.position.set(-0.5 + i * 0.5, 1.55, 0);
      shelf.add(t);
    }
    const mags = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0x3b6fb3, roughness: 0.8 }));
    mags.position.set(0.4, 1.09, 0);
    shelf.add(mags);
    shelf.position.set(LOUNGE.trophy.x, 0, LOUNGE.trophy.z);
    shelf.rotation.y = LOUNGE.trophy.ry;
    interior.add(shelf);

    // A framed photograph of the home course — was a flat two-stop gradient with a
    // 2px flag. A painterly landscape now: warm sky, clouds, a tree line, a fairway
    // sweeping in mown stripes to a green with the pin and a bunker beside it.
    const photoCv = document.createElement('canvas');
    photoCv.width = 480; photoCv.height = 304;
    const pc = photoCv.getContext('2d');
    const sky = pc.createLinearGradient(0, 0, 0, 180);
    sky.addColorStop(0, '#7fb4e6'); sky.addColorStop(0.7, '#c3e2f2'); sky.addColorStop(1, '#e9f2ec');
    pc.fillStyle = sky; pc.fillRect(0, 0, 480, 180);
    pc.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [cx, cy, r] of [[92, 46, 24], [122, 52, 32], [154, 46, 20], [332, 34, 26], [368, 42, 36], [402, 34, 22]]) {
      pc.beginPath(); pc.ellipse(cx, cy, r, r * 0.58, 0, 0, 7); pc.fill();
    }
    pc.fillStyle = '#3f5f3a';   // rolling tree line
    pc.beginPath(); pc.moveTo(0, 180);
    for (let x = 0; x <= 480; x += 20) pc.lineTo(x, 156 + Math.sin(x * 0.045) * 13 - (x % 60 < 20 ? 8 : 0));
    pc.lineTo(480, 180); pc.closePath(); pc.fill();
    const turf = pc.createLinearGradient(0, 176, 0, 304);
    turf.addColorStop(0, '#6fa049'); turf.addColorStop(1, '#8cbf5f');
    pc.fillStyle = turf; pc.fillRect(0, 174, 480, 130);
    pc.fillStyle = '#5c8340';   // rough framing the fairway
    pc.beginPath(); pc.moveTo(0, 178); pc.lineTo(150, 178); pc.lineTo(0, 304); pc.closePath(); pc.fill();
    pc.beginPath(); pc.moveTo(480, 178); pc.lineTo(336, 178); pc.lineTo(480, 304); pc.closePath(); pc.fill();
    pc.strokeStyle = 'rgba(255,255,255,0.07)'; pc.lineWidth = 7;   // mowing stripes
    for (let i = -3; i < 8; i++) { pc.beginPath(); pc.moveTo(240 + i * 12, 178); pc.lineTo(240 + i * 64, 304); pc.stroke(); }
    pc.fillStyle = '#e6d5a2'; pc.beginPath(); pc.ellipse(300, 214, 32, 11, 0, 0, 7); pc.fill();   // bunker
    pc.fillStyle = '#93cc66'; pc.beginPath(); pc.ellipse(232, 216, 46, 16, 0, 0, 7); pc.fill();    // green
    pc.strokeStyle = '#39392f'; pc.lineWidth = 2; pc.beginPath(); pc.moveTo(232, 214); pc.lineTo(232, 174); pc.stroke();
    pc.fillStyle = '#d84b3a'; pc.beginPath(); pc.moveTo(232, 174); pc.lineTo(254, 181); pc.lineTo(232, 189); pc.closePath(); pc.fill();
    const vg = pc.createRadialGradient(240, 150, 70, 240, 150, 300);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(24,20,8,0.30)');
    pc.fillStyle = vg; pc.fillRect(0, 0, 480, 304);
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
  const cardboard = mats.kraft;
  const cardboardDark = new THREE.MeshStandardMaterial({ map: mats.kraft.map, color: 0xd8c3a4, roughness: 0.92 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x8a6f42, roughness: 0.75 });
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.95 });
  const shipLabelMat = new THREE.MeshStandardMaterial({
    map: makeProductLabel({ brand: 'FAIRWAY SUPPLY CO.', name: 'FRAGILE', band: '#57795c', glyph: 'bar', field: '#efe9d9' }),
    roughness: 0.85,
  });
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
    // abandoned shipment: kraft cases with a shipping label, one burst open
    const big = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.5), [cardboard, cardboard, cardboard, cardboard, shipLabelMat, cardboard]);
    big.position.y = 0.25;
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.015, 0.12), tapeMat);
    tape.position.y = 0.505;
    const small = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.36, 0.42), cardboardDark);
    small.position.set(0.08, 0.68, -0.03);
    small.rotation.y = 0.45;
    // open flaps on the small case
    for (const [fx, fr] of [[-0.2, 0.9], [0.2, -0.8]]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.4), cardboardDark);
      flap.position.set(0.08 + fx, 0.875, -0.03);
      flap.rotation.set(0, 0.45, fr);
      g.add(flap);
    }
    const flat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.44), cardboard);
    flat.position.set(-0.45, 0.05, 0.22);
    flat.rotation.y = -0.5;
    flat.rotation.z = 0.05;
    const paper = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), paperMat);
    paper.position.set(0.42, 0.09, 0.3);
    // loose packing paper sheets around the pile
    for (let i = 0; i < 3; i++) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), paperMat);
      sheet.rotation.set(-Math.PI / 2 + (idx % 3) * 0.04, (idx * 31 + i * 73) % 6, 0);
      sheet.position.set(Math.sin(idx * 5 + i * 2.4) * 0.65, 0.012 + i * 0.002, Math.cos(idx * 3 + i * 1.7) * 0.55);
      g.add(sheet);
    }
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

  // one label texture per SKU, shared by every box mesh of that line
  const labelCache = new Map();
  function ballLabelMat(sku) {
    if (!labelCache.has(sku.id)) {
      const brandOf = { balls1: 'FAIRWAY SUPPLY', balls2: 'IRONWOOD', balls3: 'GREENLINE' };
      const bandOf = { 1: '#8a8272', 2: '#2c3e66', 3: '#1f4a26' };
      const tex = makeProductLabel({
        brand: brandOf[sku.id] || 'FAIRWAY SUPPLY',
        name: sku.name.replace(/ dozen$/i, '').toUpperCase(),
        band: bandOf[sku.tier] || '#1f4a26',
      });
      labelCache.set(sku.id, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    }
    return labelCache.get(sku.id);
  }
  function cartonLabelMat(sku, brand) {
    const key = 'carton:' + sku.id;
    if (!labelCache.has(key)) {
      const tex = makeProductLabel({
        brand, name: sku.name.toUpperCase().slice(0, 13), band: '#57795c', glyph: 'bar',
      });
      labelCache.set(key, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
    }
    return labelCache.get(key);
  }

  // --- ONE ITEM, ONE SLOT ------------------------------------------------------------------
  //
  // This was a 250-line if/else chain in which every line of stock invented its own positions AND
  // its own maximum — `Math.min(count, 12)` here, `Math.min(count, 15)` there — while the sim
  // enforced a completely different capacity out of a per-category table. Nothing compared the two
  // numbers, so a full accessories shelf drew twelve of its twenty-four and looked half empty AT
  // CAPACITY; the ball wall drew fifteen of its twenty-four and padded the gap with a row of boxes
  // standing behind the front row that represented no stock at all. That is the definition of
  // visually faking a full shelf, and the brief says not to.
  //
  // The places live in data now (data/fixtureSlots.js) and the sim's capacity IS the length of that
  // list, so this loop cannot draw the wrong number: it walks the slots and puts one thing in each.
  // Every unit on the shelf is on the shelf. Nothing on the shelf is not a unit.
  const BALL_BOX_GEO = new THREE.BoxGeometry(0.165, 0.12, 0.125);
  // NOT roundedBox: its UVs are planar and world-scaled, which crops a 0..1 label into mush.
  const CARTON_GEO = new THREE.BoxGeometry(0.12, 0.10, 0.11);
  const POLO_TINTS = { polo1: 0x4e7a52, polo2: 0x5b7f9e, jacket2: 0x33455e };
  const BAG_TINTS = [0x53688c, 0x4e8059, 0xb9b3a6, 0x9a7a56];
  const CARTON_BRAND = { tees1: 'CADDIE CLUB', marker1: 'CADDIE CLUB' };
  const skuMats = new Map();
  const ballBoxMats = new Map();

  function skuMat(sku) {
    if (!skuMats.has(sku.id)) {
      const color = new THREE.Color(CAT_COLORS[sku.cat] || 0x999999);
      color.offsetHSL(0, 0, (sku.tier - 2) * 0.09);
      skuMats.set(sku.id, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    }
    return skuMats.get(sku.id);
  }

  function ballBoxMat(sku) {
    if (!ballBoxMats.has(sku.id)) {
      const plain = new THREE.MeshStandardMaterial({
        color: sku.tier >= 3 ? 0x1f4a26 : sku.tier === 2 ? 0x2c3e66 : 0xf0ead8,
        roughness: 0.72,
      });
      // the brand faces the shopper (+z); the other five faces are the carton
      ballBoxMats.set(sku.id, [plain, plain, plain, plain, ballLabelMat(sku), plain]);
    }
    return ballBoxMats.get(sku.id);
  }

  function cartonMat(sku) {
    const brand = CARTON_BRAND[sku.id];
    const m = skuMat(sku);
    if (!brand) return m;
    const label = cartonLabelMat(sku, brand);
    return [m, m, m, m, label, m];
  }

  // where the container that a line stands IN sits — derived from the line's own slots, so a
  // basket can never end up somewhere the socks are not
  function slotCentre(skuId) {
    const s = slotsFor(skuId);
    if (!s.length) return { x: 0, y: 0, z: 0 };
    const n = s.length;
    return {
      x: s.reduce((a, p) => a + p.x, 0) / n,
      y: Math.min(...s.map((p) => p.y)),
      z: s.reduce((a, p) => a + p.z, 0) / n,
    };
  }

  // the basket / barrel a line lives in — furniture, drawn only under the stock it actually holds
  function stockHolder(sku, count) {
    if (sku.id === 'sock1') {
      // one basket per board that has socks in it: an empty basket on the top shelf is a prop
      const g = new THREE.Group();
      const used = slotsFor('sock1').slice(0, count);
      const boards = [...new Set(used.map((s) => s.base))];
      for (const base of boards) {
        const on = used.filter((s) => s.base === base);
        const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.14, 12), woodMat);
        basket.position.set(
          on.reduce((a, s) => a + s.x, 0) / on.length,
          base + 0.07,
          on[0].z,
        );
        g.add(basket);
      }
      return g;
    }
    if (sku.id === 'umb1') {
      const c = slotCentre('umb1');
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.5, 10), woodMat);
      b.position.set(c.x, c.y, c.z);
      return b;
    }
    return null;
  }

  // one unit of stock, posed in its slot
  function makeStockItem(sku, s, i) {
    const id = sku.id;

    if (sku.cat === 'clubs') {
      // A club is a shaft, a grip and a HEAD, and the head was the tell: a driver was a squashed
      // sphere and an iron a flat tab. The heads are modelled (vendor/models/clubhouse/head_*.glb),
      // pivoted at the shaft entry, so they hang off the tip of the shaft.
      const g = new THREE.Group();
      const isDriver = id.startsWith('driver');
      const headModel = isDriver ? 'head_driver'
        : id.startsWith('putter') ? 'head_putter'
          : id.startsWith('wedge') ? 'head_wedge' : 'head_iron';
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0075, 0.0105, s.len, 10),
        isDriver ? mats.merchDark : mats.merchSteel,
      );
      shaft.position.set(s.x + Math.sin(s.lean) * s.len / 2, s.y + Math.cos(s.lean) * s.len / 2, s.z);
      shaft.rotation.z = -s.lean;
      shaft.castShadow = true;
      const grip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0135, 0.0115, 0.24, 8), mats.merchRubber,
      );
      grip.position.set(
        s.x + Math.sin(s.lean) * (s.len - 0.10),
        s.y + Math.cos(s.lean) * (s.len - 0.10),
        s.z,
      );
      grip.rotation.z = -s.lean;
      g.add(shaft, grip);
      const head = merch.instantiate(headModel);
      if (head) {
        head.position.set(s.x, s.y, s.z);
        head.rotation.z = -s.lean;
        head.rotation.y = s.ry;
        g.add(head);
      }
      return g;
    }

    if (sku.cat === 'balls') {
      const box = new THREE.Mesh(BALL_BOX_GEO, ballBoxMat(sku));
      box.position.set(s.x, s.y, s.z);
      box.castShadow = true;
      return box;
    }

    if (POLO_TINTS[id]) {
      // THE WORST ASSET IN THE SHOP, per the audit: a hanging polo was a 0.3 x 0.38 x 0.035 box
      // with two box sleeves stuck on at 30 degrees. Both the hanging and the folded shirts are
      // modelled garments now, and the tints sit on the room's palette.
      const tint = POLO_TINTS[id];
      if (s.folded) {
        const fold = merch.instantiate('polo_folded', { tint });
        if (!fold) return null;
        fold.position.set(s.x, s.y, s.z);
        fold.rotation.y = s.ry || 0;
        return fold;
      }
      const shirt = merch.instantiate(id === 'jacket2' ? 'jacket_hanging' : 'polo_hanging', { tint });
      if (!shirt) return null;
      shirt.position.set(s.x, s.y, s.z);   // the model's pivot is the hanger HOOK
      shirt.rotation.y = s.ry || 0;
      return shirt;
    }

    if (id === 'cap1') {
      const cap = merch.instantiateRaw('cap_pro');   // a real six-panel cap (Tripo)
      if (!cap) return null;
      cap.position.set(s.x, s.y, s.z);
      cap.rotation.y = s.ry + Math.PI / 2;   // the model's bill runs +x; turn it out off the tree
      return cap;
    }

    if (id === 'glove1') {
      // STOOD UP, not laid flat. Flat on a board at chest height they are edge-on to a standing
      // player and a full shelf of them renders as a row of white slivers.
      const glove = merch.instantiate('glove');
      if (!glove) return null;
      glove.position.set(s.x, s.y, s.z);
      glove.rotation.set(-0.12, s.ry || 0, 0);   // fronted, leaning back on the board
      return glove;
    }

    if (id === 'sock1') {
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.08, 6), mats.merchWhite);
      roll.rotation.x = Math.PI / 2;
      roll.position.set(s.x, s.y, s.z);
      return roll;
    }

    if (id === 'towel1') {
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), mats.merchWhite);
      roll.rotation.x = Math.PI / 2;
      roll.position.set(s.x, s.y, s.z);
      roll.castShadow = true;
      return roll;
    }

    if (id === 'umb1') {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 5), darkMat);
      shaft.position.set(s.x, s.y + 0.50, s.z);
      shaft.rotation.z = s.lean || 0;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 8), skuMat(sku));
      tip.position.set(s.x, s.y + 1.05, s.z);
      g.add(shaft, tip);
      return g;
    }

    if (id === 'range2') {
      // was a rounded box with a cylinder lens; a real laser rangefinder now (Tripo)
      const rf = merch.instantiateRaw('rangefinder');
      if (!rf) return null;
      rf.position.set(s.x, s.y, s.z);
      rf.rotation.y = s.ry;
      return rf;
    }

    if (id === 'shoe1') {
      // Was a slab sole, a box upper and a sphere toe — a computer mouse. A real spiked
      // golf shoe now (Tripo), and a slot is still a PAIR, toed apart on the board. The
      // model's length runs +z, so s.ry aims the toe out; the pair splays a touch.
      const g = new THREE.Group();
      for (const so of [-0.075, 0.075]) {
        const shoe = merch.instantiateRaw('shoe_pro');
        if (!shoe) break;
        shoe.position.set(s.x + so, s.y, s.z);
        shoe.rotation.set(0, (s.ry || 0) + (so > 0 ? 0.18 : -0.18), 0);
        g.add(shoe);
      }
      return g;
    }

    if (id === 'bag1') {
      // The modelled bag ships WITH its fan of clubs, because that fan is the whole silhouette:
      // a golf bag with nothing in it is just a bin (ref 7).
      const bag = merch.instantiate('bag', { tint: BAG_TINTS[i % 4] });
      if (!bag) return null;
      bag.position.set(s.x, s.y, s.z);
      bag.rotation.x = s.lean || 0;      // leaning on the rail
      bag.rotation.y = s.ry || 0;
      return bag;
    }

    // cartoned smalls: cream cartons with a branded band, neatly fronted
    const item = new THREE.Mesh(CARTON_GEO, cartonMat(sku));
    item.position.set(s.x, s.y, s.z);
    item.castShadow = true;
    return item;
  }

  function rebuildStock() {
    for (const g of stockMeshes.values()) stockGroup.remove(g);
    stockMeshes.clear();
    const inv = state.shop.inventory;

    for (const f of placedFixtures(state)) {
      const anchor = fixtureAnchors.get(f.id);
      if (!anchor) continue;

      for (const skuId of f.skus) {
        const sku = SHOP_CATALOG.find((s) => s.id === skuId);
        if (!sku) continue;
        const slots = slotsFor(skuId);
        // the shelf cannot hold more than it has places for — the sim enforces the same number,
        // so this min() is a belt, not a braces: it can only ever bite on a corrupted save
        const count = Math.min(inv[skuId] ? inv[skuId].shelf : 0, slots.length);
        const g = new THREE.Group();
        if (count > 0) {
          const holder = stockHolder(sku, count);
          if (holder) g.add(holder);
          for (let i = 0; i < count; i++) {
            const item = makeStockItem(sku, slots[i], i);
            if (item) g.add(item);
          }
        }
        // Collapse the whole display into one mesh per material before it goes in. A shelf of 15
        // ball boxes was 15 draw calls; a rack of 12 clubs was 36. This happens on restock, not
        // per frame.
        const baked = merch.bake(g);
        baked.position.copy(anchor.position);
        baked.rotation.copy(anchor.rotation);
        stockGroup.add(baked);
        stockMeshes.set(f.id + ':' + skuId, baked);
      }

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
        const tent = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.02), new THREE.MeshStandardMaterial({ color: 0x1f8a34, roughness: 0.8 }));
        tent.position.set(0, 1.06, 0);
        tent.rotation.x = -0.2;
        g.add(tent);
        g.position.copy(anchor.position);
        stockGroup.add(g);
        stockMeshes.set(f.id + ':feature', g);
      }

      // The backroom shelving is STORAGE, not a sales fixture: it shows the volume of stock behind
      // the door as cases, not one case per unit (a hundred golf balls do not sit on that shelf as
      // a hundred boxes, they sit as the cases they came in). It is an honest representation of a
      // quantity rather than a count of items, and the difference is stated rather than hidden.
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
  //
  // The whole retail loop is physical here: a labelled carton with tape you run a cutter down, two
  // flaps that pivot open, the actual product visible inside, and an armful you carry to a shelf.
  // Nothing teleports. The state lives in the sim (sim/deliveries.js, sim/stocking.js); this draws
  // it and turns [E] into the right verb for whatever the box is currently doing.
  const boxGroup = new THREE.Group();
  scene.add(boxGroup);
  let carriedBoxMesh = null;
  let carriedGoodsMesh = null;
  const boxProps = new Map();   // id -> prop, reused across rebuilds so a hold survives a redraw
  const boxCols = new Map();    // id -> { col, sig } — a set-down box is a real obstacle, tracked here
  let boxSig = '';

  // one shipping-label texture per box id (supplier, order #, weight, category, FRAGILE)
  const shipLabelCache = new Map();
  function boxLabelMat(box, sku) {
    const key = `${box.id}:${box.qty}`;
    if (shipLabelCache.has(key)) return shipLabelCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 160;
    const c = cv.getContext('2d');
    c.fillStyle = '#efe7d4'; c.fillRect(0, 0, 256, 160);
    c.strokeStyle = '#b9a074'; c.lineWidth = 4; c.strokeRect(6, 6, 244, 148);
    c.fillStyle = '#1f3a24'; c.font = 'bold 22px Georgia';
    c.fillText((box.supplier || 'FAIRWAY SUPPLY CO.').slice(0, 18), 16, 34);
    c.fillStyle = '#2a2a26'; c.font = '16px Georgia';
    c.fillText(`ORDER #${String(box.orderId || 0).padStart(4, '0')}`, 16, 60);
    c.fillText(`${(sku ? sku.name : box.skuId).slice(0, 20)}`, 16, 82);
    c.fillText(`QTY ${box.qty}    ${box.lb != null ? box.lb + ' LB' : ''}`, 16, 104);
    const glyph = { balls: '●', clubs: 'T', apparel: '▧', accessories: '◆', supplies: '⚙', decor: '❖' }[sku ? sku.cat : 'accessories'] || '◆';
    c.font = 'bold 30px Georgia'; c.fillText(glyph, 214, 44);
    if (box.fragile) {
      c.fillStyle = '#a12a1e'; c.font = 'bold 20px Georgia';
      c.fillText('! FRAGILE', 16, 138);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    shipLabelCache.set(key, mat);
    return mat;
  }

  // a few of the actual product, sitting in the open carton — capped so a big case is a layer, not
  // five hundred meshes. This is what makes "see physical contents" and "partial contents" real.
  function contentsInBox(box, w, h, d) {
    const g = new THREE.Group();
    const sku = SHOP_CATALOG.find((s) => s.id === box.skuId);
    const cat = sku ? sku.cat : 'accessories';
    const show = Math.min(box.qty, 8);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(CAT_COLORS[cat] || 0xb08d57), roughness: 0.7 });
    for (let i = 0; i < show; i++) {
      const item = cat === 'balls'
        ? new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), mats.merchWhite)
        : new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, h * 0.3, d * 0.22), mat);
      const col = i % 3;
      const row = Math.floor(i / 3);
      item.position.set(-w * 0.28 + col * (w * 0.28), h * 0.42 + (i >= 6 ? 0.03 : 0), -d * 0.24 + row * (d * 0.24));
      g.add(item);
    }
    return g;
  }

  // A driver does not arrive in a glove box: the carton is sized from what is inside it, and its
  // seams and flaps show exactly what the sim says the box is doing right now.
  function makeBoxMesh(box) {
    const g = new THREE.Group();
    const { w, h, d } = boxDims(box.box || 'carton');
    const sku = SHOP_CATALOG.find((s) => s.id === box.skuId);

    if (box.flat) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d * 1.6), cardboardDark);
      slab.position.y = 0.015;
      slab.castShadow = true;
      g.add(slab);
      return g;
    }

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cardboard);
    body.position.y = h / 2;
    body.castShadow = true;
    g.add(body);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(w * 0.8, 0.5), Math.min(h * 0.7, 0.32)),
      boxLabelMat(box, sku),
    );
    label.position.set(0, h * 0.55, d / 2 + 0.002);
    g.add(label);

    if (!tapeCut(box)) {
      // tape down the centre seam — recedes from the front as the cut runs (box.tape 0..1)
      const cut = box.tape || 0;
      const remain = 1 - Math.min(1, cut / 0.6);   // the centre seam is the first 60% of the cut
      if (remain > 0.02) {
        const tape = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.012, d * remain), tapeMat);
        tape.position.set(0, h + 0.006, -d / 2 + (d * remain) / 2);
        g.add(tape);
      }
      if (cut < 1) {
        for (const sx of [-w * 0.32, w * 0.32]) {   // the two cross tapes, until the very end
          const cross = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, 0.012, d + 0.01), tapeMat);
          cross.position.set(sx, h + 0.006, 0);
          g.add(cross);
        }
      }
    } else {
      // two flaps, pivoting up-and-out on box.flaps[0..1] (0 shut .. 1 open)
      const flapGeo = new THREE.BoxGeometry(w * 0.98, 0.012, d * 0.5);
      const fl = box.flaps || [0, 0];
      for (const [i, sign] of [[0, -1], [1, 1]]) {
        const a = (fl[i] || 0) * (Math.PI * 0.62);
        const flap = new THREE.Group();
        const panel = new THREE.Mesh(flapGeo, cardboardDark);
        panel.position.z = sign * d * 0.25;
        flap.add(panel);
        flap.position.set(0, h, sign * d * 0.5);
        flap.rotation.x = sign * -a;
        g.add(flap);
      }
      if (flapsOpen(box) && box.qty > 0) g.add(contentsInBox(box, w, h, d));
      const inside = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.9, d * 0.9),
        new THREE.MeshStandardMaterial({ color: isEmpty(box) ? 0x241a10 : 0x4a3a28, roughness: 1 }),
      );
      inside.rotation.x = -Math.PI / 2;
      inside.position.y = h * 0.35;
      g.add(inside);
    }
    return g;
  }

  // a small stack of the product you are carrying in your arms, on the camera. Distinct little
  // items with a dark edge between them, so an armful reads as an armful and not one pale slab.
  function makeGoodsMesh(carry) {
    const g = new THREE.Group();
    const sku = SHOP_CATALOG.find((s) => s.id === carry.skuId);
    const cat = sku ? sku.cat : 'accessories';
    const base = new THREE.Color(CAT_COLORS[cat] || 0xb08d57);
    const show = Math.min(carry.qty, 6);
    for (let i = 0; i < show; i++) {
      let item;
      if (cat === 'clubs') {
        item = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.46, 6), mats.merchSteel);
        item.position.set((i - 2) * 0.03, 0.02, 0);
        item.rotation.z = 1.45 + i * 0.05;
      } else {
        const c = base.clone().offsetHSL(0, 0, (i % 2 ? -0.06 : 0.03));  // alternate shade = a visible seam
        const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });
        item = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.09), m);
        const col = i % 3;
        const row = Math.floor(i / 3);
        item.position.set((col - 1) * 0.115, row * 0.06, row * 0.015);
        item.rotation.y = (i % 2 ? 0.08 : -0.05);
      }
      g.add(item);
    }
    return g;
  }

  function boxSignature() {
    const d = state.shop.deliveries;
    if (!d) return '';
    const c = state.shop.carry;
    return d.boxes.map((b) => `${b.id}:${b.loc}:${b.x || 0}:${b.z || 0}:${b.tape || 0}:${(b.flaps || [0, 0]).join('')}:${b.qty}:${b.flat ? 1 : 0}`).join(',')
      + '|' + (c ? c.skuId + c.qty : '') + '|' + d.trash;
  }

  const inStockroomBounds = (lx, lz) => lx >= STOCKROOM.bounds.minX && lx <= STOCKROOM.bounds.maxX
    && lz >= STOCKROOM.bounds.minZ && lz <= STOCKROOM.bounds.maxZ;

  const sfx = (name) => { if (hooks.sfx) hooks.sfx(name); };
  const say = (msg, tone) => { if (hooks.toast) hooks.toast(msg, tone); };

  // put an armful onto the fixture it belongs on (or say why not) — the fixture props call this
  function stockFromHands(fixtureId, units) {
    const res = stockFixture(state, fixtureId, units);
    if (res.ok) {
      rebuildStock();
      rebuildBoxes();       // the arms emptied by that much
      tutorialFlag(state, 'shelved');
    }
    return res;
  }
  B.stockFromHands = stockFromHands;
  B.carriedGoods = () => carriedGoods(state);
  B.rebuildCarry = () => rebuildBoxes();

  function rebuildBoxes() {
    boxGroup.clear();
    const d = state.shop.deliveries;
    if (carriedBoxMesh) { camera.remove(carriedBoxMesh); carriedBoxMesh = null; }
    if (carriedGoodsMesh) { camera.remove(carriedGoodsMesh); carriedGoodsMesh = null; }

    const cg = carriedGoods(state);
    if (cg) {
      carriedGoodsMesh = makeGoodsMesh(cg);
      carriedGoodsMesh.position.set(0.12, -0.4, -0.62);   // held in the arms, low in frame
      carriedGoodsMesh.rotation.x = 0.35;
      camera.add(carriedGoodsMesh);
    }

    const seen = new Set();
    const colSeen = new Set();   // world boxes that hold a live collider this pass
    if (d) {
      const stacks = { pad: 0, stock: 0 };
      for (const box of d.boxes) {
        if (box.loc === 'carried') {
          carriedBoxMesh = makeBoxMesh(box);
          carriedBoxMesh.scale.setScalar(0.8);
          carriedBoxMesh.position.set(0, -0.62, -0.82);
          carriedBoxMesh.rotation.y = 0.12;
          camera.add(carriedBoxMesh);
          continue;
        }
        let lx; let lz; let ry;
        if (box.loc === 'world') {
          lx = box.x; lz = box.z; ry = box.ry || 0;
        } else {
          const at = box.loc === 'pad' ? STOCKROOM.padOutside : STOCKROOM.receivingInside;
          const i = stacks[box.loc]++;
          const dim = boxDims(box.box || 'carton');
          lx = at.x + (i % 3 - 1) * Math.max(0.62, dim.w + 0.14);
          lz = at.z + Math.floor(i / 3) * Math.max(0.56, dim.d + 0.14) - 0.3;
          ry = (box.id % 5) * 0.13;
        }
        const wp = L2W(lx, lz);
        const m = makeBoxMesh(box);
        const gy = groundYAt(wp.x, wp.z);
        m.position.set(wp.x, gy !== null && gy !== undefined ? gy : heightAt(wp.x, wp.z) + 0.02, wp.z);
        m.rotation.y = ry;
        boxGroup.add(m);

        seen.add(box.id);
        let prop = boxProps.get(box.id);
        if (!prop) { prop = boxPropFor(box.id); boxProps.set(box.id, prop); }
        prop.x = wp.x; prop.z = wp.z; prop.lx = lx; prop.lz = lz;

        // a set-down box occupies the floor: register a collider so the player AND the
        // customer nav grid (which bakes from the same list) both treat it as solid. Only
        // WORLD drops — the ones a player can put anywhere; pad/stock stacks sit at
        // known-clear spots. The sig gate means a hold-to-cut (same spot) never re-bakes nav.
        if (box.loc === 'world') {
          const cdim = boxDims(box.box || 'carton');
          const cswap = Math.abs(Math.sin(ry)) > 0.5;
          const cw = cswap ? cdim.d : cdim.w;
          const cd = cswap ? cdim.w : cdim.d;
          const csig = `${lx.toFixed(2)},${lz.toFixed(2)},${cw.toFixed(2)},${cd.toFixed(2)}`;
          colSeen.add(box.id);
          const prevc = boxCols.get(box.id);
          if (!prevc || prevc.sig !== csig) {
            if (prevc) removeCol(prevc.col);
            boxCols.set(box.id, { col: addCol(colBoxAt(lx, lz, cw, cd)), sig: csig });
          }
        }
      }
    }
    for (const [id, prop] of [...boxProps]) {
      if (!seen.has(id)) { removeProp(prop); boxProps.delete(id); }
    }
    for (const [id, entry] of [...boxCols]) {
      if (!colSeen.has(id)) { removeCol(entry.col); boxCols.delete(id); }  // picked up, moved, or gone
    }
    boxSig = boxSignature();
  }

  // a box in the stockroom is unpacked in place; anywhere else, [E] lifts it into your arms
  function unpackHere(prop, b) {
    return b.loc === 'stock' || (b.loc === 'world' && inStockroomBounds(prop.lx, prop.lz));
  }

  // the box's verbs, chosen live from its state. Reused across rebuilds (keyed by id) so a
  // hold-to-cut is never torn down mid-cut.
  function boxPropFor(id) {
    const box = () => boxesOf(state).find((b) => b.id === id);
    const pickUp = (b) => {
      const r = pickUpBox(state, b.id);
      if (!r.ok) { say(r.reason, 'warn'); return; }
      sfx('boxup');
      rebuildBoxes();
    };
    const prop = addProp({
      x: 0, z: 0, r: 1.9,
      label: () => {
        const b = box();
        if (!b || b.loc === 'carried' || carriedBox(state)) return null;
        const sku = SHOP_CATALOG.find((s) => s.id === b.skuId);
        const name = sku ? sku.name : b.skuId;
        if (b.flat) return 'Flattened carton — [E] carry it to the recycling';
        if (isEmpty(b)) return `Empty ${name} box — [E] flatten it`;
        if (!unpackHere(prop, b)) {
          return `${b.loc === 'pad' ? 'Delivery: ' : ''}${name} ×${b.qty}${b.lb ? ` · ${b.lb} lb` : ''} — [E] pick up`;
        }
        if (tapeUncut(b)) return `${name} case · ${b.qty} inside — hold [E] to cut the tape`;
        if (!tapeCut(b)) return `${name} — hold [E] to finish the cut`;
        if (!flapsOpen(b)) return `${name} — [E] open a flap`;
        const held = carriedGoods(state);
        if (held && held.skuId !== b.skuId) return `${name} ×${b.qty}, open — put down what you're holding first`;
        return `${name} ×${b.qty} in the case — [E] take an armful`;
      },
      get tool() {
        const b = box();
        if (!b || carriedBox(state)) return null;
        return unpackHere(prop, b) && !b.flat && !tapeCut(b) && !isEmpty(b) ? 'boxcutter' : null;
      },
      hold: (dt) => {
        const b = box();
        if (!b || !unpackHere(prop, b) || b.flat || tapeCut(b) || isEmpty(b)) return;
        const r = cutTape(state, b.id, dt * 0.7);   // ~1.4s to run the whole seam
        if (r.ok) {
          sfx('tape');
          if (r.done) tutorialFlag(state, 'boxCut');
          rebuildBoxes();
        }
      },
      action: () => {
        const b = box();
        if (!b) return;
        const sku = SHOP_CATALOG.find((s) => s.id === b.skuId);
        const name = sku ? sku.name : b.skuId;
        if (b.flat) { pickUp(b); return; }
        if (isEmpty(b)) {
          if (flattenBox(state, b.id).ok) { sfx('recycle'); say('Flattened — carry it to the recycling.'); rebuildBoxes(); }
          return;
        }
        if (!unpackHere(prop, b)) { pickUp(b); return; }
        if (!tapeCut(b)) return;              // cutting is the hold verb; a tap does nothing here
        if (!flapsOpen(b)) {
          if (openFlap(state, b.id).ok) { sfx('flap'); rebuildBoxes(); }
          return;
        }
        const r = takeFromBox(state, b.id);
        if (!r.ok) { say(r.reason, 'warn'); return; }
        sfx('product');
        tutorialFlag(state, 'boxCarried');
        say(r.left > 0
          ? `${r.taken} × ${name} in your arms — ${r.left} still in the case.`
          : `${r.taken} × ${name} — the case is empty.`);
        rebuildBoxes();
      },
    });
    return prop;
  }

  // the set-down / put-away verb follows the player while their arms are full — its prop rides just
  // ahead of the player each frame (see the walkUpdate block far below)
  function boxDropSpot() {
    const fx = -Math.sin(walk.yaw);
    const fz = -Math.cos(walk.yaw);
    let dx = walk.x + fx * 0.9;
    let dz = walk.z + fz * 0.9;
    if (isInside(walk.x, walk.z) !== isInside(dx, dz)) {
      dx = walk.x + fx * 0.35;
      dz = walk.z + fz * 0.35;
      if (isInside(walk.x, walk.z) !== isInside(dx, dz)) { dx = walk.x; dz = walk.z; }
    }
    return { x: dx, z: dz };
  }
  const carryProp = addProp({
    x: 0, z: 0, r: 2.5,
    label: () => {
      const cb = carriedBox(state);
      if (cb) {
        const sku = SHOP_CATALOG.find((s) => s.id === cb.skuId);
        const name = sku ? sku.name : cb.skuId;
        const l = W2L(walk.x, walk.z);
        if (cb.flat) return 'Carrying a flattened carton — [E] set it down';
        if (inStockroomBounds(l.x, l.z)) return `Carrying ${name} ×${cb.qty} — [E] set it down to open it`;
        return `Carrying ${name} ×${cb.qty} — [E] set it down`;
      }
      const cg = carriedGoods(state);
      if (cg) {
        const sku = SHOP_CATALOG.find((s) => s.id === cg.skuId);
        const l = W2L(walk.x, walk.z);
        if (inStockroomBounds(l.x, l.z)) return `Holding ${sku.name} ×${cg.qty} — [E] set them on the backroom shelf`;
        const home = homeOf(cg.skuId);
        return `Holding ${sku.name} ×${cg.qty} — carry them to the ${home ? home.title.toLowerCase() : 'shelf'}`;
      }
      return null;
    },
    action: () => {
      const cb = carriedBox(state);
      if (cb) {
        const drop = boxDropSpot();
        const l = W2L(drop.x, drop.z);
        // refuse a drop into a wall/fixture/doorway/another box — snap to the nearest legal
        // spot, or say so if there is genuinely no room in front of you.
        const spot = legalBoxDrop(state, cb, l.x, l.z, walk.yaw + 0.1);
        if (!spot) { say('No room to set it down here — turn around.', 'warn'); return; }
        putDownBox(state, cb.id, spot);
        sfx('boxdown');
        rebuildBoxes();
        return;
      }
      const cg = carriedGoods(state);
      if (cg) {
        const l = W2L(walk.x, walk.z);
        if (inStockroomBounds(l.x, l.z)) {
          const r = storeInBack(state);
          if (r.ok) {
            sfx('product');
            say(`${r.moved} × ${SHOP_CATALOG.find((s) => s.id === cg.skuId).name} on the backroom shelf.`);
            rebuildStock();
            rebuildBoxes();
          }
        } else {
          say('Carry these to the right fixture and hold [E], or take them to the backroom.', 'warn');
        }
      }
    },
  });

  // the recycling bin by the stock door
  {
    const wp = L2W(STOCKROOM.bin.x, STOCKROOM.bin.z);
    addProp({
      x: wp.x, z: wp.z, r: 1.8,
      label: () => {
        const cb = carriedBox(state);
        if (cb && cb.flat) return 'Recycling — [E] drop the flattened carton in';
        const dd = state.shop.deliveries;
        const flatNear = dd && dd.boxes.some((b) => b.flat && b.loc !== 'carried');
        return flatNear || (dd && dd.trash > 0) ? 'Recycling — [E] break down the flattened cartons' : null;
      },
      action: () => {
        const cb = carriedBox(state);
        if (cb && cb.flat) {
          putDownBox(state, cb.id, { x: STOCKROOM.bin.x, z: STOCKROOM.bin.z, ry: 0 });
          if (recycleBox(state, cb.id).ok) { sfx('recycle'); say('Cardboard recycled.'); rebuildBoxes(); }
          return;
        }
        if (emptyTrash(state).ok) { sfx('recycle'); say('Cardboard recycled — the stockroom breathes again.'); rebuildBoxes(); }
      },
    });
  }

  // --- customers: they walk in from the course, through the real door -------------------
  let unitSeq = 0;   // every unit a shopper lifts gets its own identity
  const customers = [];
  // golfer-wardrobe palette, muted to the club color language
  const CUST_COLORS = [0x4a6d94, 0x2c3e66, 0xb0788f, 0xb3714a, 0x4a7050, 0x8a8577, 0x6b4f37];
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
    // real variety on the floor: builds, trousers, skin tones, hats or hair
    const TROUSERS = [0xc2b190, 0x8a8577, 0x4b545c, 0x6b5a44];
    const SKINS = [0xd9a97e, 0xb9865e, 0x8a5f42, 0xe8c39a];
    const char = makeCharacter({
      polo: CUST_COLORS[rng.int(CUST_COLORS.length)],
      khaki: TROUSERS[rng.int(TROUSERS.length)],
      skin: SKINS[rng.int(SKINS.length)],
      cap: rng.chance(0.55) ? (rng.chance(0.5) ? 0xf2efe4 : 0x2c3e66) : null,
    });
    char.root.scale.setScalar(0.87 + rng.next() * 0.12);
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
      const browsable = placedFixtures(state).filter((f) => f.skus && f.skus.length > 0);
      // shoppers gravitate to displays with something ON them — a stocked
      // fixture is four times as likely to make their route as a bare one
      const pool = [];
      for (const f of browsable) {
        pool.push(f);
        const hasStock = f.skus.some((id) => state.shop.inventory[id] && state.shop.inventory[id].shelf > 0);
        if (hasStock) pool.push(f, f, f);
      }
      for (let i = 0; i < nStops; i++) {
        // Reserve an authored standing socket. Looking at the fixture centre put
        // shoppers inside cabinets and random jitter stacked them into one body.
        const claimed = new Set(customers.flatMap((c) => c.stops
          .slice(c.stopIdx)
          .map((s) => s.socketKey)
          .filter(Boolean)));
        for (const s of stops) if (s.socketKey) claimed.add(s.socketKey);
        const available = pool.filter((candidate) => fixtureSockets(candidate).some((s) => !claimed.has(s.key)));
        if (!available.length) break;
        const f = available[rng.int(available.length)];
        const open = fixtureSockets(f).filter((s) => !claimed.has(s.key));
        const socket = open[rng.int(open.length)];
        const wp = L2W(socket.x, socket.z);
        const face = L2W(f.x, f.z);
        stops.push({
          kind: 'fixture',
          skus: f.skus,
          title: f.title,
          fixtureId: f.id,
          socketKey: socket.key,
          x: wp.x,
          z: wp.z,
          faceX: face.x,
          faceZ: face.z,
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
      // what a review will be written from: did they get in, did they buy, did they wait
      seed: rng.next(),
      entered: false,
      bought: false,
      reviewed: false,
      queuedAt: 0,
      queueLenOnArrival: 0,
      isGolfer: toCounter, // the ones with a tee time actually played the course
    });
    return customers[customers.length - 1];
  }

  // HOW LONG THEY HAVE BEEN WAITING, shown RESTRAINEDLY — the brief's word. A red bar
  // over a shopper's head in a stylised pro shop is a mobile-game tell. This is a thin
  // ring that fills as their patience burns down, and it only appears once they have
  // actually been kept waiting: 45 seconds of goodwill costs them nothing, so nothing
  // is drawn. It goes amber at half and red at a quarter, which is the point at which
  // a player who is paying attention still has time to save the sale.
  const PATIENCE_FULL = 45;
  const patRing = new THREE.RingGeometry(0.10, 0.125, 20, 1, Math.PI / 2, Math.PI * 2);
  function setPatience(c) {
    const frac = clamp(c.patience / PATIENCE_FULL, 0, 1);
    if (frac > 0.72) {                       // still fresh — do not nag
      if (c.patienceMesh) c.patienceMesh.visible = false;
      return;
    }
    if (!c.patienceMesh) {
      const m = new THREE.Mesh(patRing.clone(), new THREE.MeshBasicMaterial({
        color: 0xf2c14e, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
      }));
      m.position.set(0, 1.62, 0);
      m.renderOrder = 3;
      c.mesh.add(m);
      c.patienceMesh = m;
    }
    const m = c.patienceMesh;
    m.visible = true;
    // the ring EMPTIES clockwise as the patience runs out
    m.geometry.dispose();
    m.geometry = new THREE.RingGeometry(0.10, 0.125, 24, 1, Math.PI / 2, -Math.PI * 2 * frac);
    m.material.color.setHex(frac < 0.25 ? 0xe8635a : frac < 0.5 ? 0xf2a03d : 0xf2c14e);
    m.material.opacity = 0.55 + (1 - frac) * 0.35;
    // it always faces the player, so it reads from anywhere on the floor
    if (walk.active) m.rotation.y = Math.atan2(walk.x - c.mesh.position.x, walk.z - c.mesh.position.z) - c.mesh.rotation.y;
  }

  // a shopper reaches for the display: the unit leaves the shelf THERE and
  // rides in their hands to the register
  function customerPick(c, stop) {
    if (!stop.skus || c.cart.length) return;
    const rng = rngOf(state);
    const stocked = stop.skus.filter((id) => state.shop.inventory[id] && state.shop.inventory[id].shelf > 0);
    if (!stocked.length) {
      // bare display: they glance and move on — and someone occasionally says so
      c.emptyStops = (c.emptyStops || 0) + 1;
      if (rng.chance(0.18) && hooks.toast && walk.active && isInside(walk.x, walk.z)) {
        hooks.toast(`${c.name} looked over the empty ${stop.title || 'display'} and moved on.`, 'warn');
      }
      return;
    }
    if (!rng.chance(0.55)) return;
    // a third of interested shoppers inspect the item and put it back — real
    // browsing, visible on the shelf count, no sale
    if (rng.chance(0.3)) {
      const skuId = stocked[rng.int(stocked.length)];
      if (pickFromShelf(state, skuId).ok) {
        rebuildStock(); // the unit leaves the display while they look it over
        returnToShelf(state, skuId);
        c.linger = Math.max(c.linger, 2.2); // the look-it-over beat
        setTimeout(() => { if (interior.parent) rebuildStock(); }, 1600); // and back it goes
      }
      return;
    }
    const skuId = stocked[rng.int(stocked.length)];
    // Each unit gets its own uid. That is what makes two identical Pro-V dozens two
    // PIECES rather than a tally of two — so one can be scanned and the other not,
    // and so a save taken while they are in a shopper's hands can put THEM back.
    const uid = `u${++unitSeq}`;
    if (!pickFromShelf(state, skuId, uid).ok) return;
    const sku = SHOP_CATALOG.find((s) => s.id === skuId);
    c.cart.push({ uid, skuId, price: priceFor(sku, state.shop.markup[sku.cat] || 1, null) });
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
    // they stood there, nobody came, and they put it back. That is a review, and a deserved one —
    // every single time.
    if (!c.reviewed) {
      c.reviewed = true;
      postReview(state, reviewFor(state, {
        waitedSec: c.queuedAt ? Math.max(0, now - c.queuedAt) : 0,
        queueLen: c.queueLenOnArrival || 0,
        bought: false,
        played: !!c.isGolfer,
        foundWhatTheyWanted: false,
      }, Math.round((c.seed || 0) * 1000 + (state.dayAbs || 0))));
    }

    for (const it of c.cart) returnToShelf(state, it.skuId, it.uid);
    if (c.cart.length) {
      state.shop.lostSalesTotal = (state.shop.lostSalesTotal || 0) + 1;
      if (hooks.toast && walk.active && isInside(walk.x, walk.z)) {
        hooks.toast(`${c.name} gave up waiting at the register and put it back.`, 'warn');
      }
      rebuildStock();
    }
    c.cart = [];
    c.tx = null;
    c.awaitingCheckout = false;
    // they walked out mid-sale: void it, clear the counter, and put the goods back.
    // registerMode holds no authority over stock — the shelf is credited right here.
    if (register.getCustomer() === c) { register.abandon(); register.leave(); }
    if (c.itemMesh) {
      c.mesh.remove(c.itemMesh);
      c.itemMesh = null;
    }
    leaveQueue(c);
    c.stopIdx += 1;
    c.linger = 0;
  }

  // The ONLY way a shopper leaves the floor. pickFromShelf takes a unit off the shelf the instant
  // they lift it, so a shopper deleted while still holding one destroys it — the player's stock
  // drains for no reason they can see. Three separate removal sites used to do exactly that; they
  // all come through here now, and anything still in their hands goes back on the display.
  function removeCustomer(i) {
    const c = customers[i];
    if (!c) return;

    // They came in, they saw the place, they left. That is a visit, and a visit is reviewable —
    // not just the ones that ended in a sale or a tantrum at the till, which is how most of them
    // used to leave without anyone hearing a word about it. About two in five bother to write.
    if (!c.reviewed && c.entered) {
      c.reviewed = true;
      const seed = Math.round((c.seed || 0) * 1000 + (state.dayAbs || 0));
      if (Math.abs(Math.sin(seed * 7.13)) < 0.42) {
        postReview(state, reviewFor(state, {
          waitedSec: c.queuedAt ? Math.max(0, now - c.queuedAt) : 0,
          queueLen: c.queueLenOnArrival || 0,
          bought: !!c.bought,
          played: !!c.isGolfer,
          foundWhatTheyWanted: !!c.bought,
        }, seed));
      }
    }

    // THE REGISTER HAS TO LET GO OF THEM, and this is the place it must happen.
    //
    // removeCustomer is the single funnel every shopper leaves through — giving up at
    // the till, reaching the exit, the shop closing at eight, the scene being torn
    // down. abandon() lived only in customerGiveUp, so a shopper removed by any OTHER
    // route left register mode holding a live transaction over goods that had already
    // gone back on the shelf (the line below returns them). Finish that sale and it
    // banks revenue for stock you no longer sold: money out of nothing, and the player
    // stranded at a till serving a person who is not there.
    //
    // voidTx() makes the transaction terminal, so completeSale() can never touch it.
    if (register.getCustomer() === c) { register.abandon(); register.leave(); }

    if (c.cart && c.cart.length) {
      for (const it of c.cart) returnToShelf(state, it.skuId, it.uid);
      c.cart = [];
      rebuildStock();
    }
    if (c.tx) c.tx = null;
    c.awaitingCheckout = false;
    leaveQueue(c);
    if (c.itemMesh) {
      c.mesh.remove(c.itemMesh);
      c.itemMesh = null;
    }
    custGroup.remove(c.mesh);
    customers.splice(i, 1);
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

  // walkable grid around the building; doors are excluded (they open for walkers)
  const nav = makeNav({
    minX: center.x - 16, maxX: center.x + 16,
    minZ: center.z - 13, maxZ: center.z + 15,
    cell: 0.3, radius: 0.32,
  });
  let navVersion = -1;
  function navFresh() {
    if (navVersion !== colVersion) {
      nav.rebuild(custCols.filter((c) => !c.door));
      navVersion = colVersion;
    }
    return nav;
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
      if (!stop) { removeCustomer(i); continue; }

      let tx = stop.x;
      let tz = stop.z;
      if (stop.kind === 'counter') {
        if (!c.queued) {
          counterQueue.push(c);
          c.queued = true;
          c.queuedAt = now; // the clock a review will quote back at you
          c.queueLenOnArrival = counterQueue.length - 1;
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
          c.entered = true; // they got through the door, so they have an opinion
          if (hooks.sfx) hooks.sfx('doorbell');
        }
        const isPass = stop.kind === 'walk' || stop.kind === 'enter' || stop.kind === 'exit' || stop.kind === 'gone';
        const served = stop.kind !== 'counter' || counterQueue.indexOf(c) === 0;
        if (stop.kind === 'gone') {
          removeCustomer(i);
          continue;
        }
        // the head of the line with a basket waits for the PLAYER to ring
        // them up — patience runs out eventually and the pick goes back
        if (stop.kind === 'counter' && c.cart.length && counterQueue.indexOf(c) === 0) {
          if (!c.awaitingCheckout) {
            // they reach the counter and LAY THEIR GOODS OUT on it, one by one
            c.onPaid = () => onCustomerPaid(c);
            register.begin(c);
          }
          c.awaitingCheckout = true;
          c.patience -= dt;
          setPatience(c);
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
            removeCustomer(i);
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
        // path on destination change only; string-pulled waypoints thereafter
        if (!c.pathGoal || Math.hypot(c.pathGoal.x - tx, c.pathGoal.z - tz) > 0.22) {
          c.path = navFresh().path(c.mesh.position.x, c.mesh.position.z, tx, tz) || [{ x: tx, z: tz }];
          c.pathGoal = { x: tx, z: tz };
          c.stuckT = 0;
        }
        while (c.path.length > 1
          && Math.hypot(c.path[0].x - c.mesh.position.x, c.path[0].z - c.mesh.position.z) < 0.3) {
          c.path.shift();
        }
        const wp = c.path[0] || { x: tx, z: tz };
        const wdx = wp.x - c.mesh.position.x;
        const wdz = wp.z - c.mesh.position.z;
        const wdist = Math.hypot(wdx, wdz) || 1;
        const step = Math.min(wdist, c.speed * dt);
        const res = resolveCustomer(c, c.mesh.position.x + (wdx / wdist) * step, c.mesh.position.z + (wdz / wdist) * step);
        const moved = Math.hypot(res.nx - c.mesh.position.x, res.nz - c.mesh.position.z);
        c.mesh.position.x = res.nx;
        c.mesh.position.z = res.nz;
        c.mesh.rotation.y = Math.atan2(wdx, wdz);
        // stuck detection: 1.2s pinned → one repath against the fresh world;
        // 3s pinned → sidestep off whatever is holding them and start over
        if (step > 0.001 && moved < step * 0.25) {
          c.stuckT = (c.stuckT || 0) + dt;
          if (c.stuckT > 3.0) {
            const side = Math.random() < 0.5 ? 1 : -1;
            const sres = resolveCustomer(c, c.mesh.position.x + (wdz / wdist) * 0.6 * side, c.mesh.position.z - (wdx / wdist) * 0.6 * side);
            c.mesh.position.x = sres.nx;
            c.mesh.position.z = sres.nz;
            c.pathGoal = null;
            c.stuckT = 0;
            c.repathed = false;
          } else if (c.stuckT > 1.2 && !c.repathed) {
            c.pathGoal = null;
            navVersion = -1; // rebake — a door or hauled pile may have changed the world
            c.repathed = true;
          }
        } else if (moved > step * 0.6) {
          c.stuckT = 0;
          c.repathed = false;
        }
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
    register.update(dt);
    updateFlicker(dt);
    builder.update();
    if (office.updateLid) office.updateLid(dt);
    if (moteFade > 0) {
      moteFade -= dt;
      if (moteFade <= 0) motes.visible = false;
    }
    // the set-down / put-away prompt rides just ahead of a loaded player (a box OR an armful)
    if (carriedBoxMesh || carriedGoodsMesh) {
      carryProp.x = walk.x - Math.sin(walk.yaw) * 0.9;
      carryProp.z = walk.z - Math.cos(walk.yaw) * 0.9;
      if (carriedBoxMesh) carriedBoxMesh.position.y = -0.62 + Math.sin(now * 6.2) * 0.012; // a carried weight breathes
      if (carriedGoodsMesh) carriedGoodsMesh.position.y = -0.4 + Math.sin(now * 6.2) * 0.01;
    } else {
      carryProp.x = 1e6; // parked far away so an empty-handed player never focuses it
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
  // Everything rebuildStock() closes over now exists, so it is safe to let the
  // model loader call back into it when the goods land.
  merch.onReady(() => { if (interior && interior.parent) rebuildStock(); });

  function dispose() {
    scene.remove(group, interior, custGroup, motes, boxGroup);
    if (carriedBoxMesh) camera.remove(carriedBoxMesh);
    if (carriedGoodsMesh) camera.remove(carriedGoodsMesh);
    for (const p of [...registeredProps]) removeProp(p);
    for (const c of [...registeredCols]) removeCol(c);
    for (const m of ctx.extraMeshes || []) scene.remove(m);
    // tearing the scene down must not pocket whatever shoppers were holding: the save is written
    // from `state`, and stock in a deleted shopper's hands would simply cease to exist.
    for (let i = customers.length - 1; i >= 0; i--) removeCustomer(i);
  }

  return {
    group, interior,
    update, rebuildStock, rebuildReno, refreshCondition, repaintGrime,
    rebuildBoxes,
    carrySpeedFactor: () => carrySpeedFactor(state),
    isInside, groundYAt, vacuumAt, vacuumLabelAt,
    doorWorld: doorW,
    laptopPose: (fovDeg, aspect) => (office.seatPose ? office.seatPose(fovDeg, aspect) : null),
    laptopLid: (open) => office.setLid && office.setLid(open),
    laptopBoot: () => office.startBoot && office.startBoot(),
    laptopScreen: (mode) => office.paintScreen && office.paintScreen(mode),
    laptopScreenMode: () => (office.screenMode ? office.screenMode() : null),
    laptopScreenCorners: () => (office.screenCorners ? office.screenCorners() : null),
    laptopRig: () => (office.laptopObject
      ? { object: office.laptopObject, lidAngle: office.lidAngle(), lidOpen: office.lidOpenAngle, LAPTOP }
      : null),
    confirmChange: () => regConfirmChange(), // dead: change goes into a hand now, not a keypress
    // REGISTER MODE — main.js routes the pointer and the keyboard in here while it is up
    register: {
      isActive: () => register.isActive(),
      hasTx: () => register.hasTx(),
      enter: () => register.enter(),
      leave: () => register.leave(),
      onDown: (e) => register.onDown(e),
      onMove: (e) => register.onMove(e),
      onUp: (e) => register.onUp(e),
      onKey: (k) => register.onKey(k),
      tapTerminal: () => register.tapTerminal(),
      // read-only, for the HUD and for tools/qa — the transaction is never mutated
      // from out here; every verb goes through the module above
      getTx: () => register.getTx(),
      getCustomer: () => register.getCustomer(),
    },
    // DIAGNOSTICS. Not a cheat: sendToCounter() puts a shopper at the head of the
    // queue holding goods it took off the shelf through pickFromShelf, exactly as if
    // it had walked the floor and chosen them — real shelf debits, real held-unit
    // uids. It skips the browsing, not the accounting. tools/qa/ drives the checkout
    // through it, because waiting on the RNG to produce a two-item cash customer is
    // not a test, it is a lottery.
    customers: () => customers,
    sendToCounter(skuIds, payMethod = null) {
      const c = spawnCustomer(false);
      if (!c) return null;
      c.payMethod = payMethod;   // a cash person or a card person, decided in advance
      for (const skuId of skuIds) {
        const uid = `u${++unitSeq}`;
        if (!pickFromShelf(state, skuId, uid).ok) continue;
        const sku = SHOP_CATALOG.find((k) => k.id === skuId);
        c.cart.push({ uid, skuId, price: priceFor(sku, state.shop.markup[sku.cat] || 1, null) });
      }
      if (!c.cart.length) return null;
      rebuildStock();
      const q = queueSlotW(0);
      c.mesh.position.set(q.x, c.mesh.position.y, q.z);
      const regW = L2W(REGISTER.scanner.x, COUNTER.z);
      c.stops = [
        { kind: 'counter', x: q.x, z: q.z, faceX: regW.x, faceZ: regW.z },
        { kind: 'exit', x: doorW.x, z: doorW.z },
        { kind: 'gone', x: doorW.x, z: doorW.z + 6 },
      ];
      c.stopIdx = 0;
      c.linger = 0;
      c.entered = true;
      return c.name;
    },
    productThumb: (sku) => productThumb(sku), // rendered supplier-card imagery
    condition: () => conditionNow,
    setTimeMood: (minuteOfDay) => shell.lighting.setTimeMood(minuteOfDay),
    // build mode: the shop is the player's to arrange
    build: builder,
    // the pressure washer: aim at the building, pull the trigger, watch the wall come back
    washAim: (origin, dir) => washing.aim(origin, dir),
    washApply: (hit, mode, radius, power, dt, now) => {
      const r = washing.apply(hit, mode, radius, power, dt, now);
      if (r.cleaned > 0) washing.announceIfDone(hit.id);
      return r;
    },
    washJet: (from, to, on, dt) => washing.setJet(from, to, on, dt),
    washTick: (dt) => washing.tick(dt),
    customers, doors, // QA access
    debugSpawn: spawnCustomer, // QA: force a walk-in
    dispose,
  };
}
