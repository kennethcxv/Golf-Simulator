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
import { makeCharacter } from './characterAsset.js';
import { SHOP_CATALOG, SHELF_CAP, DECOR_SPOTS } from '../data/shopItems.js';
import {
  SHELL, INTERIOR, FIXTURES, COUNTER, OFFICE, STOCKROOM, LOUNGE,
  DOOR_MAIN, DOOR_STOCK, DOOR_BACK,
  MAT, HOURS_SIGN, queueSlot,
} from '../data/shopLayout.js';
import {
  RENO, shopCondition, cleanGrimeAt, clearClutter, placeDecor, removeDecor,
  restockShelfFromBackroom, priceFor, windowDirtAvg,
} from '../sim/shop.js';
import {
  boxesOf, pickUpBox, putDownBox, carriedBox, openBox, emptyTrash,
  cutBox, takeFromBox, flattenBox,
} from '../sim/deliveries.js';
import {
  pickFromShelf, returnToShelf, checkoutSale,
  startPayment, changeDue, giveChange, processCard,
} from '../sim/checkout.js';
import { addRevenue } from '../sim/economy.js';
import { tutorialFlag } from '../sim/tutorial.js';
import { dueForCheckIn, checkInReservation, fmtSlot } from '../sim/reservations.js';
import { makeClubhouseMaterials, roundedBox, makeSignTexture, makeProductLabel } from './clubhouse/materials.js';
import { buildShell } from './clubhouse/shell.js';
import { buildDoors } from './clubhouse/doors.js';
import { buildFixtures, buildLounge, buildStockroomDressing, buildCheckout } from './clubhouse/fixtures.js';
import { buildDirt } from './clubhouse/dirt.js';
import { makeNav } from './clubhouse/nav.js';
import { productThumb } from './clubhouse/thumbs.js';
import { buildExterior } from './clubhouse/exterior.js';
import { buildWashing } from './clubhouse/washing.js';
import { placedFixtures, ensureLayout } from '../sim/layout.js';
import { buildBuildMode } from './clubhouse/buildMode.js';
import { reviewFor, postReview } from '../sim/reviews.js';
import { boxDims } from '../data/boxes.js';

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
  // legacy aliases: sections still awaiting their v2 pass draw from the kit
  const woodMat = mats.walnut;
  const darkMat = mats.walnutDark;
  const railMat = mats.walnut;
  const trimMat = mats.trimPaint;
  const glassMat = mats.glass;
  const halfW = SHELL.w / 2 - SHELL.wallT / 2; // wall centerlines
  const halfD = SHELL.d / 2 - SHELL.wallT / 2;

  const B = {
    ctx, state, group, interior, custGroup, mats, hooks, walk,
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

  // --- counter, register, wordmark, office, lounge, stockroom dressing --------------------
  let drawRegister = () => {};
  let regConfirmChange = () => false; // [R] hands over counted change (Realistic)

  // the head shopper's items sit ON the counter: unscanned on their side,
  // scanned pushed across to the bagging side
  const counterItemsGroup = new THREE.Group();
  interior.add(counterItemsGroup);
  function syncCounterItems(c) {
    counterItemsGroup.clear();
    if (!c || !c.cart || !c.cart.length) return;
    c.cart.forEach((item, i) => {
      const sku = SHOP_CATALOG.find((s) => s.id === item.skuId);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.13, 0.15),
        new THREE.MeshStandardMaterial({ color: CAT_COLORS[sku ? sku.cat : 'accessories'] || 0x8a8577, roughness: 0.8 }),
      );
      m.position.set(
        COUNTER.registerX + 0.5 + (i % 4) * 0.24,
        1.055 + 0.065,
        COUNTER.z + (i < c.scanned ? -0.2 : 0.17),
      );
      m.rotation.y = i * 0.4;
      m.castShadow = true;
      counterItemsGroup.add(m);
    });
  }

  // a branded paper bag into the customer's hand — they carry it out
  function giveBag(c) {
    const bag = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.26, 0.13),
      new THREE.MeshStandardMaterial({ color: 0x2e5a3a, roughness: 0.85 }),
    );
    body.position.y = 0.13;
    bag.add(body);
    for (const off of [-0.05, 0.05]) {
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, 0.09, 0.015),
        new THREE.MeshStandardMaterial({ color: 0x1d3a26, roughness: 0.8 }),
      );
      handle.position.set(off, 0.3, 0);
      bag.add(handle);
    }
    bag.position.set(0.3, 0.62, 0.05);
    bag.rotation.y = 0.2;
    c.mesh.add(bag);
  }

  {
    drawRegister = buildCheckout(B).drawRegister;

    const regWp = L2W(COUNTER.registerX, COUNTER.z);
    // the head of the queue with a basket, waiting on YOU
    const headForCheckout = () => {
      const c = counterQueue[0];
      return c && c.cart && c.cart.length && c.awaitingCheckout ? c : null;
    };
    // hand the customer a printed receipt and a bag, close out their visit
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

    const completeSale = (c) => {
      const res = checkoutSale(state, c.cart, c.name);
      if (!res.ok) return;
      c.bought = true;
      leaveReview(c, true); // a served customer always says something
      if (c.tx && c.tx.lost) {
        // realistic miscount: the till is short what you over-handed
        if (c.tx.lost > 0) addRevenue(state, 'shopSales', -c.tx.lost);
        state.shop.log.unshift(c.tx.lost > 0
          ? `Change miscounted — the till is $${c.tx.lost.toFixed(0)} short.`
          : `${c.name} got shorted $${Math.abs(c.tx.lost).toFixed(0)} in change.`);
      }
      drawRegister(['PAID — RECEIPT OUT', c.tx && c.tx.method === 'card' ? 'CARD APPROVED' : 'DRAWER CLOSED'], res.total);
      if (hooks.sfx) hooks.sfx('receipt');
      if (hooks.toast) hooks.toast(`${c.name} paid $${res.total.toFixed(2)} — receipt and bag handed over.`);
      c.cart = [];
      c.tx = null;
      c.awaitingCheckout = false;
      if (c.itemMesh) { c.mesh.remove(c.itemMesh); c.itemMesh = null; }
      giveBag(c);
      syncCounterItems(null);
      leaveQueue(c);
      c.stopIdx += 1;
      c.linger = 0;
      rebuildStock(); // the shelf gap where their pick came from stays real
    };

    const changeOptions = (tx) => {
      const due = changeDue(tx);
      const opts = [due, due + 5, Math.max(0, due - 5), due + 1].filter((v, i, a) => a.indexOf(v) === i);
      // deterministic shuffle per transaction so E-cycling isn't always option 1
      const seed = Math.round(tx.total * 7 + tx.tendered * 3);
      return opts.map((v, i) => ({ v, k: (i * 2654435761 + seed) % 97 })).sort((a, b) => a.k - b.k).map((o) => o.v);
    };
    const drawChangeScreen = (c) => {
      const opts = c.txOpts;
      drawRegister([
        `CASH $${c.tx.tendered} FOR $${c.tx.total.toFixed(0)}`,
        ...opts.map((v, i) => `${i === c.txSel ? '>' : ' '} give $${v} change`),
        '[E] next · [R] hand over',
      ], c.tx.total);
    };

    let cardTimer = null;
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
          if (!c.tx) {
            const total = c.cart.reduce((a, i) => a + i.price, 0);
            return `All scanned — [E] total it up ($${total.toFixed(2)})`;
          }
          if (c.tx.stage === 'card') return `${c.name} taps their card — [E] run the terminal`;
          if (c.tx.stage === 'processing') return 'Terminal — processing…';
          if (c.tx.stage === 'declined') return 'CARD DECLINED — [E] run it again';
          if (c.tx.stage === 'change') {
            const due2 = changeDue(c.tx);
            if (state.mode === 'relaxed') return `Cash: $${c.tx.tendered} tendered — [E] hand back $${due2} change`;
            return `Cash: $${c.tx.tendered} tendered — [E] next amount · [R] hand it over`;
          }
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
          syncCounterItems(c);
          if (hooks.sfx) hooks.sfx('scanBeep');
          return;
        }
        if (!c.tx) {
          // total it up — the customer takes out their money
          const total = Math.round(c.cart.reduce((a, i) => a + i.price, 0) * 100) / 100;
          c.tx = startPayment(total, state.mode);
          c.patience = Math.max(c.patience, 25);
          if (c.tx.method === 'cash') {
            c.txOpts = state.mode === 'relaxed' ? [changeDue(c.tx)] : changeOptions(c.tx);
            c.txSel = 0;
            if (state.mode === 'relaxed') {
              drawRegister([`CASH $${c.tx.tendered} FOR $${total.toFixed(0)}`, `change due $${changeDue(c.tx)}`], total);
            } else {
              drawChangeScreen(c);
            }
          } else {
            drawRegister(['CARD PRESENTED', 'run the terminal'], total);
          }
          if (hooks.sfx) hooks.sfx(c.tx.method === 'cash' ? 'drawer' : 'thunk');
          return;
        }
        if (c.tx.stage === 'card' || c.tx.stage === 'declined') {
          c.tx.stage === 'declined' ? (c.tx.stage = 'card') : null;
          c.tx.stage = 'processing';
          drawRegister(['CARD — PROCESSING…'], c.tx.total);
          if (hooks.sfx) hooks.sfx('scanBeep');
          const cRef = c;
          if (cardTimer) clearTimeout(cardTimer);
          cardTimer = setTimeout(() => {
            cardTimer = null;
            if (!cRef.tx || !customers.includes(cRef)) return; // they gave up meanwhile
            cRef.tx.stage = 'card';
            const res = processCard(cRef.tx);
            if (res.approved) {
              completeSale(cRef);
            } else {
              drawRegister(['CARD DECLINED', 'ask them to retry'], cRef.tx.total);
              if (hooks.toast) hooks.toast(`${cRef.name}'s card declined — run it again.`, 'warn');
              if (hooks.sfx) hooks.sfx('thunk');
            }
          }, 1100);
          return;
        }
        if (c.tx.stage === 'change') {
          if (state.mode === 'relaxed') {
            const res = giveChange(c.tx, changeDue(c.tx));
            if (res.ok) completeSale(c);
          } else {
            // E cycles the counted amount; R hands it over
            c.txSel = (c.txSel + 1) % c.txOpts.length;
            drawChangeScreen(c);
            if (hooks.sfx) hooks.sfx('scanBeep');
          }
        }
      },
    });

    // [R] confirms the counted change in Realistic mode (exposed on the API)
    regConfirmChange = () => {
      const c = headForCheckout();
      if (!c || !c.tx || c.tx.stage !== 'change') return false;
      if (state.mode === 'relaxed') return false;
      const res = giveChange(c.tx, c.txOpts[c.txSel]);
      if (res.ok) {
        completeSale(c);
      } else if (hooks.toast) {
        hooks.toast(res.reason, 'warn');
      }
      return true;
    };

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

    // black leather task chair (ref 10)
    const chair = new THREE.Group();
    const chairLeather = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.55 });
    const seat = new THREE.Mesh(roundedBox(0.5, 0.1, 0.48, 0.04), chairLeather);
    seat.position.y = 0.5;
    chair.add(seat);
    const backC = new THREE.Mesh(roundedBox(0.48, 0.6, 0.1, 0.05), chairLeather);
    backC.position.set(0, 0.88, 0.26);
    backC.rotation.x = 0.08;
    chair.add(backC);
    for (const ax of [-0.27, 0.27]) {
      const arm = new THREE.Mesh(roundedBox(0.05, 0.04, 0.3, 0.015), mats.charcoal);
      arm.position.set(ax, 0.66, 0.04);
      chair.add(arm);
    }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), mats.chrome);
    post.position.y = 0.32;
    chair.add(post);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const legArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.24), mats.charcoal);
      legArm.position.set(Math.sin(a) * 0.13, 0.05, Math.cos(a) * 0.13);
      legArm.rotation.y = a;
      chair.add(legArm);
    }
    chair.position.set(OFFICE.chair.x, 0, OFFICE.chair.z);
    chair.rotation.y = -Math.PI / 2;
    interior.add(chair);

    // wall course map — a real framed board, flush on the office's south wall:
    // backing panel with thickness, mitered frame lip, map face proud of the
    // backer. Mounted on actual wall so no side ever shows a floating plane.
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = 240;
    mapCanvas.height = 160;
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
    const laptop = new THREE.Group();
    const alu = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.75 });
    const aluDark = new THREE.MeshStandardMaterial({ color: 0x62676d, roughness: 0.4, metalness: 0.7 });
    const deck = new THREE.Mesh(roundedBox(0.6, 0.022, 0.4, 0.008), alu);
    deck.position.y = 0.011;
    deck.castShadow = true;
    laptop.add(deck);
    // keyboard: a canvas keycap grid inset into the deck
    const kbCv = document.createElement('canvas');
    kbCv.width = 256; kbCv.height = 128;
    const kc = kbCv.getContext('2d');
    kc.fillStyle = '#5d6268'; kc.fillRect(0, 0, 256, 128);
    kc.fillStyle = '#23262b';
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 14; c++) kc.fillRect(6 + c * 17.6, 8 + r * 17, 14, 13);
    }
    kc.fillRect(64, 96, 128, 22); // spacebar
    const kbTex = new THREE.CanvasTexture(kbCv);
    const kb = new THREE.Mesh(
      new THREE.PlaneGeometry(0.54, 0.22),
      new THREE.MeshStandardMaterial({ map: kbTex, roughness: 0.7 }),
    );
    kb.rotation.x = -Math.PI / 2;
    kb.position.set(0, 0.023, 0.07); // keyboard on the FAR half — nearest keys sit by the hinge
    laptop.add(kb);
    const trackpad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x7d838a, roughness: 0.35, metalness: 0.5 }),
    );
    trackpad.rotation.x = -Math.PI / 2;
    trackpad.position.set(0, 0.024, -0.12); // trackpad between keyboard and the seated player
    laptop.add(trackpad);

    // lid: hinged on the FAR (window-side) edge — local +z is world-east here, and the
    // chair sits west — so the lid opens AWAY from the seated player and the display
    // leans back facing them. angle 0 = CLOSED flat over the deck.
    const LID_OPEN = 1.78; // ~102°: slight recline past vertical, like a real machine
    const lidHinge = new THREE.Group();
    lidHinge.position.set(0, 0.026, 0.2);
    const lid = new THREE.Mesh(roundedBox(0.6, 0.014, 0.4, 0.006), aluDark);
    lid.position.set(0, 0.007, -0.2);
    lid.castShadow = true;
    lidHinge.add(lid);
    const screenCv = document.createElement('canvas');
    screenCv.width = 512; screenCv.height = 320;
    const screenTex = new THREE.CanvasTexture(screenCv);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    // the display faces DOWN when closed (underside of the lid); the in-plane π turn
    // makes the painted image read upright and unmirrored to the seated player
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.35),
      new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 0.6, roughness: 0.2 }),
    );
    screen.rotation.set(Math.PI / 2, 0, Math.PI);
    screen.position.set(0, -0.0005, -0.2);
    lidHinge.add(screen);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0x223528, emissive: 0x35d06a, emissiveIntensity: 0.0 }),
    );
    led.position.set(0.26, 0.026, -0.19); // front edge, player side
    laptop.add(led, lidHinge);
    laptop.position.set(OFFICE.laptop.x - 0.12, 0.96, OFFICE.laptop.z);
    laptop.rotation.y = OFFICE.laptop.ry;
    interior.add(laptop);

    // screen state machine: 'off' → 'boot' → 'home'
    let screenMode = 'off';
    let bootT0 = 0;
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
        c2.fillStyle = '#2e5a35';
        // pine mark
        for (let t = 0; t < 3; t++) {
          const w = 44 - t * 10;
          const yTop = 96 + t * 20;
          c2.beginPath();
          c2.moveTo(256, yTop);
          c2.lineTo(256 - w / 2, yTop + 26);
          c2.lineTo(256 + w / 2, yTop + 26);
          c2.closePath();
          c2.fill();
        }
        c2.fillRect(253, 158, 6, 12);
        c2.fillStyle = '#f4f0e6';
        c2.font = 'bold 20px Georgia, serif';
        c2.textAlign = 'center';
        c2.fillText('Fairway Office', 256, 205);
        c2.strokeStyle = '#2b3138';
        c2.strokeRect(176, 232, 160, 8);
        c2.fillStyle = '#35d06a';
        c2.fillRect(178, 234, 156 * p, 4);
        screenTex.needsUpdate = true;
        return;
      }
      // 'home' — the desktop the portal opens over
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
    // world-space corners of the DISPLAY (main.js orders the projected corners itself)
    const cornerLocal = [
      new THREE.Vector3(0.28, 0, -0.2 + 0.175),
      new THREE.Vector3(-0.28, 0, -0.2 + 0.175),
      new THREE.Vector3(-0.28, 0, -0.2 - 0.175),
      new THREE.Vector3(0.28, 0, -0.2 - 0.175),
    ];
    office.screenCorners = () => {
      lidHinge.updateWorldMatrix(true, false);
      // hinge-local: x across the lid, z up the lid, y the screen normal.
      // main.js orders the projected corners itself, so order here is free.
      return cornerLocal.map((c) => lidHinge.localToWorld(new THREE.Vector3(c.x, -0.0005, c.z)));
    };

    const compWp = L2W(OFFICE.laptop.x, OFFICE.laptop.z);
    office.computerProp = addProp({
      x: compWp.x, z: compWp.z, r: 2.3,
      label: () => 'Laptop — [E] open Fairway Office',
      action: () => { if (hooks.openLaptop) hooks.openLaptop(); },
    });
    office.laptop = laptop;

    // Where the camera settles when you sit down. Derived from the *open* lid, the live field of
    // view and the window shape, so the screen fills the view on any monitor — a hardcoded seat
    // is what left it at 9.7% of the viewport. The lid is still shut when the player presses E,
    // so pose the hinge open, measure, and put it back.
    const SCREEN_W = 0.56;
    const SCREEN_H = 0.35;
    office.seatPose = (fovDeg = 60, aspect = 16 / 9) => {
      const wasLid = lidHinge.rotation.x;
      lidHinge.rotation.x = LID_OPEN;
      lidHinge.updateWorldMatrix(true, false);

      // screen centre and outward normal, in world space, with the lid open
      const centre = lidHinge.localToWorld(new THREE.Vector3(0, -0.0005, -0.2));
      const out = lidHinge.localToWorld(new THREE.Vector3(0, -0.6, -0.2)).sub(centre).normalize();

      lidHinge.rotation.x = wasLid;
      lidHinge.updateWorldMatrix(true, false);

      const dist = fitDistance({ screenW: SCREEN_W, screenH: SCREEN_H, fovDeg, aspect, fracH: 0.80, fracW: 0.90 });
      const eye = centre.clone().addScaledVector(out, dist);
      eye.y += 0.05; // sit up a touch, so a strip of keyboard stays in frame

      // look back at the screen: forward = (-sin y cos p, sin p, -cos y cos p)
      const f = centre.clone().sub(eye).normalize();
      return {
        x: eye.x, y: eye.y, z: eye.z,
        yaw: Math.atan2(-f.x, -f.z),
        pitch: Math.asin(Math.max(-1, Math.min(1, f.y))),
      };
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

  function rebuildStock() {
    for (const g of stockMeshes.values()) stockGroup.remove(g);
    stockMeshes.clear();
    const inv = state.shop.inventory;
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f2e8, roughness: 0.6 });
    const POLO_TINTS = { polo1: 0x3f7a34, polo2: 0x3b6fb3, jacket2: 0x2c3e66 };

    for (const f of placedFixtures(state)) {
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
          // real silhouettes: chrome shafts, dark grips, per-family heads
          const chrome = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.85 });
          const graphite = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.4 });
          const gripM = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.92 });
          const headM = new THREE.MeshStandardMaterial({
            color: sku.tier >= 3 ? 0x23262b : sku.tier === 2 ? 0x2c3e66 : 0x53575d,
            roughness: 0.28, metalness: 0.75,
          });
          const isDriver = sku.id.startsWith('driver');
          const isPutter = sku.id.startsWith('putter');
          const shaftM = isDriver ? graphite : chrome;
          for (let i = 0; i < Math.min(count, 6); i++) {
            const x = -1.0 + idx * 0.45 + i * 0.07;
            const z = 0.12 - i * 0.03;
            const lean = 0.16 + (i % 3) * 0.03;
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 1.12, 6), shaftM);
            shaft.position.set(x, 0.74, z);
            shaft.rotation.z = lean;
            const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.015, 0.24, 6), gripM);
            grip.position.set(x - Math.sin(lean) * 0.55, 0.74 + Math.cos(lean) * 0.55, z);
            grip.rotation.z = lean;
            g.add(shaft, grip);
            const hx = x + Math.sin(lean) * 0.56;
            if (isDriver) {
              const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), headM);
              head.scale.set(1.25, 0.62, 1.05);
              head.position.set(hx + 0.02, 0.2, z + 0.02);
              const face = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.012, 10), chrome);
              face.rotation.z = Math.PI / 2 - 0.2;
              face.position.set(hx - 0.07, 0.205, z + 0.02);
              g.add(head, face);
            } else if (isPutter) {
              const head = new THREE.Mesh(roundedBox(0.13, 0.03, 0.045, 0.012), headM);
              head.position.set(hx, 0.175, z + 0.02);
              const hosel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 5), chrome);
              hosel.position.set(hx - 0.05, 0.22, z + 0.02);
              g.add(head, hosel);
            } else {
              const blade = new THREE.Mesh(roundedBox(0.095, 0.085, 0.022, 0.01), headM);
              blade.position.set(hx, 0.19, z + 0.02);
              blade.rotation.y = 0.25;
              blade.rotation.z = -0.12;
              g.add(blade);
            }
          }
        } else if (sku.cat === 'balls') {
          // branded dozen boxes, tier-colored rows like the reference ball wall
          const label = ballLabelMat(sku);
          const plain = new THREE.MeshStandardMaterial({
            color: sku.tier >= 3 ? 0x1f4a26 : sku.tier === 2 ? 0x2c3e66 : 0xf0ead8, roughness: 0.7,
          });
          const boxMats = [plain, plain, plain, plain, label, plain]; // label faces the shopper (+z)
          const show = Math.min(count, 12);
          for (let i = 0; i < show; i++) {
            const layer = Math.floor(i / 3);
            const col = i % 3;
            const boardY = [0.5, 1.05, 1.6][layer % 3];
            const item = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.125, 0.13), boxMats);
            item.position.set(-1.05 + idx * 0.56 + col * 0.18, boardY + 0.095 + Math.floor(layer / 3) * 0.13, 0.1);
            item.castShadow = true;
            g.add(item);
          }
          if (show >= 3) {
            const bx = -1.05 + idx * 0.56 + 0.4;
            for (const [ox, oz, oy] of [[0, 0, 0], [0.055, 0, 0], [0.028, 0.045, 0], [0.028, 0.018, 0.045]]) {
              const ball = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), white);
              ball.position.set(bx + ox, 1.05 + 0.026 + oy, 0.14 + oz);
              g.add(ball);
            }
          }
        } else if (POLO_TINTS[sku.id] && count > 0) {
          const tint = new THREE.MeshStandardMaterial({ color: POLO_TINTS[sku.id], roughness: 0.85 });
          const show = Math.min(count, 10);
          // rails have no top: everything hangs (jacket rail); tables fold six
          const onRail = f.kind === 'rail';
          const hangZ = onRail ? 0 : -0.62;
          const hangMax = onRail ? 8 : 4;
          const folded = onRail ? 0 : Math.min(show, 6);
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
          for (let i = 0; i < show - folded && i < hangMax; i++) {
            const step = onRail ? 0.26 : 0.17;
            const hx = Math.min(-0.9 + hangCursor.n++ * step, 0.9);
            const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 5), darkMat);
            hook.position.set(hx, 1.63, hangZ);
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.035), tint);
            body.position.set(hx, 1.38, hangZ);
            body.rotation.y = 0.08;
            body.castShadow = true;
            const sleeveL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.03), tint);
            sleeveL.position.set(hx - 0.19, 1.5, hangZ);
            sleeveL.rotation.z = 0.5;
            const sleeveR = sleeveL.clone();
            sleeveR.position.x = hx + 0.19;
            sleeveR.rotation.z = -0.5;
            g.add(hook, body, sleeveL, sleeveR);
          }
        } else if (sku.id === 'cap1') {
          const show = Math.min(count, 8);
          const capColors = [0x2c3e66, 0xf0ead8, 0x1f4a26, 0xd9cbb2];
          for (let i = 0; i < show; i++) {
            const capMat = new THREE.MeshStandardMaterial({ color: capColors[i % 4], roughness: 0.88 });
            const a = (i / 8) * Math.PI * 2;
            const py = 1.15 + (i % 2) * 0.35;
            const cx = Math.sin(a) * 0.3;
            const cz = Math.cos(a) * 0.3;
            const dome = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
            dome.scale.y = 0.85;
            dome.position.set(cx, py + 0.02, cz);
            dome.rotation.y = a;
            dome.castShadow = true;
            // curved brim: a shallow cylinder slice tipped downward, facing out
            const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 10, 1, false, -0.7, 1.4), capMat);
            brim.position.set(cx + Math.sin(a) * 0.055, py + 0.005, cz + Math.cos(a) * 0.055);
            brim.rotation.y = a;
            brim.rotation.x = 0.12;
            // button on top
            const button = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), capMat);
            button.position.set(cx, py + 0.09, cz);
            g.add(dome, brim, button);
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
          const accent = new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.75 });
          for (let i = 0; i < show; i++) {
            const tintB = new THREE.MeshStandardMaterial({ color: [0x2c3e66, 0x1f4a26, 0x23262b, 0x6b4f37, 0x7a1f1f][i % 5], roughness: 0.78 });
            const bx = -0.95 + i * 0.48;
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.125, 0.95, 12), tintB);
            body.position.set(bx, 0.62, -0.1);
            body.rotation.x = -0.22;
            body.castShadow = true;
            // top cuff + club tubes peeking out
            const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.15, 0.09, 12), accent);
            cuff.position.set(bx, 1.07, -0.2);
            cuff.rotation.x = -0.22;
            for (let t = 0; t < 3; t++) {
              const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 5), darkMat);
              tube.position.set(bx - 0.05 + t * 0.05, 1.28, -0.23 - (t % 2) * 0.04);
              tube.rotation.x = -0.2;
              g.add(tube);
            }
            // front pocket + ball pocket + stitched band
            const pocket = new THREE.Mesh(roundedBox(0.13, 0.32, 0.07, 0.025), tintB);
            pocket.position.set(bx, 0.48, 0.06);
            pocket.rotation.x = -0.22;
            const ballPocket = new THREE.Mesh(roundedBox(0.11, 0.16, 0.06, 0.022), accent);
            ballPocket.position.set(bx, 0.82, 0.015);
            ballPocket.rotation.x = -0.22;
            const band = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.05, 12), accent);
            band.position.set(bx, 0.35, -0.04);
            band.rotation.x = -0.22;
            // stand legs + shoulder strap
            const legA = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.82, 5), darkMat);
            legA.position.set(bx - 0.09, 0.42, 0.24);
            legA.rotation.x = 0.5;
            const legB = legA.clone();
            legB.position.x = bx + 0.09;
            const strap = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.014, 6, 12, Math.PI * 1.1), darkMat);
            strap.position.set(bx + 0.02, 0.72, -0.26);
            strap.rotation.set(0.4, 0.5, 1.2);
            g.add(body, cuff, pocket, ballPocket, band, legA, legB, strap);
          }
        } else if (sku.id === 'shoe1') {
          const show = Math.min(count, 8);
          const shoeColors = [0xf2efe6, 0x2c3e66, 0x8b9299, 0xf2efe6];
          const soleM = new THREE.MeshStandardMaterial({ color: 0xe8e3d5, roughness: 0.6 });
          for (let i = 0; i < show; i++) {
            const boardY = [0.35, 0.85, 1.35][Math.floor(i / 3) % 3];
            const px = -1.0 + (i % 3) * 0.75;
            const upM = new THREE.MeshStandardMaterial({ color: shoeColors[i % 4], roughness: 0.62 });
            for (const so of [-0.09, 0.09]) {
              // sole with a slight rocker + rounded upper + tapered toe + collar
              const sole = new THREE.Mesh(roundedBox(0.115, 0.035, 0.325, 0.015), soleM);
              sole.position.set(px + so, boardY + 0.055, 0.08);
              sole.rotation.x = -0.18;
              const upper = new THREE.Mesh(roundedBox(0.1, 0.075, 0.24, 0.03), upM);
              upper.position.set(px + so, boardY + 0.105, 0.055);
              upper.rotation.x = -0.18;
              const toe = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 6), upM);
              toe.scale.set(1.0, 0.62, 1.15);
              toe.position.set(px + so, boardY + 0.085, 0.185);
              toe.rotation.x = -0.18;
              const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.03, 8), darkMat);
              collar.position.set(px + so, boardY + 0.145, -0.035);
              collar.rotation.x = -0.18;
              // saddle stripe
              const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.02, 0.05), darkMat);
              stripe.position.set(px + so, boardY + 0.115, 0.06);
              stripe.rotation.x = -0.18;
              g.add(sole, upper, toe, collar, stripe);
            }
          }
        } else if (sku.id === 'range2') {
          // rangefinders: charcoal body + lens ring on a small riser, boxed spares behind
          const show = Math.min(count, 6);
          const bodyM = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.45 });
          for (let i = 0; i < show; i++) {
            const boardY = [0.5, 1.05, 1.6][i % 3];
            const px = -1.05 + idx * 0.56 + Math.floor(i / 3) * 0.2;
            const body = new THREE.Mesh(roundedBox(0.09, 0.11, 0.15, 0.02), bodyM);
            body.position.set(px, boardY + 0.085, 0.1);
            body.rotation.y = -0.4;
            const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.012, 10), new THREE.MeshStandardMaterial({ color: 0x557a8c, roughness: 0.2, metalness: 0.6 }));
            lens.rotation.x = Math.PI / 2;
            lens.rotation.z = -0.4;
            lens.position.set(px + 0.03, boardY + 0.1, 0.17);
            g.add(body, lens);
          }
        } else {
          // cartoned smalls: cream cartons with a branded band, neatly fronted
          const box = sku.cat === 'apparel' ? [0.26, 0.07, 0.2] : [0.15, 0.11, 0.12];
          const brandOf = { tees1: 'CADDIE CLUB', marker1: 'CADDIE CLUB', glove1: 'SUNDAY ROUND' };
          const cartonMat = brandOf[sku.id]
            ? cartonLabelMat(sku, brandOf[sku.id])
            : m;
          const mats6 = brandOf[sku.id] ? [m, m, m, m, cartonMat, m] : cartonMat;
          const show = Math.min(count, 12);
          for (let i = 0; i < show; i++) {
            const item = new THREE.Mesh(new THREE.BoxGeometry(...box), mats6);
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

  // A driver does not arrive in a glove box: the carton is sized from what is inside it
  // (data/boxes.js), so the receiving pad reads as a delivery and not a pile of clones.
  function makeBoxMesh(box) {
    const g = new THREE.Group();
    const { w, h, d } = boxDims(box.box || 'carton');
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cardboard);
    body.position.y = h / 2;
    body.castShadow = true;
    g.add(body);

    const sku = SHOP_CATALOG.find((s) => s.id === box.skuId);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.02, Math.min(0.09, h * 0.24), d + 0.01),
      new THREE.MeshStandardMaterial({ color: CAT_COLORS[sku ? sku.cat : 'accessories'] || 0x999999, roughness: 0.85 }),
    );
    stripe.position.y = h * 0.25;
    g.add(stripe);

    if (!box.cut) {
      const tape = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.015, Math.min(0.12, d * 0.3)), tapeMat);
      tape.position.y = h + 0.002;
      g.add(tape);
    } else {
      // flaps folded out over the edges; the inside goes dark as it empties
      const fw = w * 0.96;
      const fd = d * 0.44;
      for (const [fx, fz, px, pz, rx, rz] of [
        [fw, fd, 0, -(d / 2 + fd / 2) * 0.72, 2.4, 0],
        [fw, fd, 0, (d / 2 + fd / 2) * 0.72, -2.4, 0],
        [w * 0.42, d * 0.96, -(w / 2 + w * 0.21) * 0.72, 0, 0, -2.4],
        [w * 0.42, d * 0.96, (w / 2 + w * 0.21) * 0.72, 0, 0, 2.4],
      ]) {
        const flap = new THREE.Mesh(new THREE.BoxGeometry(fx, 0.012, fz), cardboardDark);
        flap.position.set(px, h + 0.02, pz);
        flap.rotation.x = rx;
        flap.rotation.z = rz;
        g.add(flap);
      }
      const inside = new THREE.Mesh(
        new THREE.PlaneGeometry(d * 0.9, w * 0.9),
        new THREE.MeshStandardMaterial({ color: box.empty ? 0x241a10 : 0x59452e, roughness: 1 }),
      );
      inside.rotation.x = -Math.PI / 2;
      inside.rotation.z = Math.PI / 2;
      inside.position.y = box.empty ? h * 0.14 : h * 0.75;
      g.add(inside);
    }
    return g;
  }

  function boxSignature() {
    const d = state.shop.deliveries;
    if (!d) return '';
    return d.boxes.map((b) => `${b.id}:${b.loc}:${b.x || 0}:${b.z || 0}:${b.cut ? 1 : 0}:${b.qty}:${b.box || ''}`).join(',') + '|' + d.trash;
  }

  const inStockroomBounds = (lx, lz) => lx >= STOCKROOM.bounds.minX && lx <= STOCKROOM.bounds.maxX
    && lz >= STOCKROOM.bounds.minZ && lz <= STOCKROOM.bounds.maxZ;

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
      // world boxes sit exactly where they were set down; zone boxes stack tidily
      let lx;
      let lz;
      let ry;
      if (box.loc === 'world') {
        lx = box.x;
        lz = box.z;
        ry = box.ry || 0;
      } else {
        // cartons are no longer all one size, so the drop stack spaces itself off the widest one
        const at = box.loc === 'pad' ? STOCKROOM.padOutside : STOCKROOM.receivingInside;
        const i = stacks[box.loc]++;
        const dim = boxDims(box.box || 'carton');
        const pitchX = Math.max(0.62, dim.w + 0.14);
        const pitchZ = Math.max(0.56, dim.d + 0.14);
        lx = at.x + (i % 3 - 1) * pitchX;
        lz = at.z + Math.floor(i / 3) * pitchZ - 0.3;
        ry = (box.id % 5) * 0.13;
      }
      const wp = L2W(lx, lz);
      const m = makeBoxMesh(box);
      const gy = groundYAt(wp.x, wp.z);
      m.position.set(wp.x, gy !== null && gy !== undefined ? gy : heightAt(wp.x, wp.z) + 0.02, wp.z);
      m.rotation.y = ry;
      boxGroup.add(m);
      const sku = SHOP_CATALOG.find((s) => s.id === box.skuId);
      const name = sku ? sku.name : box.skuId;
      // one rule everywhere: inside the stockroom a case unpacks; anywhere else
      // E lifts it back into your arms
      const unpackHere = box.loc === 'stock' || (box.loc === 'world' && inStockroomBounds(lx, lz));
      const prop = addProp({
        x: wp.x, z: wp.z, r: 1.9,
        label: () => {
          if (carriedBox(state)) return null; // the set-down verb owns E while loaded
          if (box.empty) return `Empty ${name} box — [E] flatten it`;
          if (unpackHere) {
            if (!box.cut) return `Case of ${name} ×${box.qty} — [E] cut the tape`;
            return `Open case of ${name} ×${box.qty} — [E] take an armful to the backroom`;
          }
          return `${box.loc === 'pad' ? 'Delivery — ' : ''}${name} ×${box.qty}${box.cut ? ' (open)' : ''} — [E] pick up`;
        },
        action: () => {
          if (box.empty) {
            if (flattenBox(state, box.id).ok) {
              if (hooks.sfx) hooks.sfx('thunk');
              if (hooks.toast) hooks.toast('Flattened — the cardboard goes by the bin.');
              rebuildBoxes();
            }
            return;
          }
          if (unpackHere) {
            if (!box.cut) {
              if (cutBox(state, box.id).ok) {
                tutorialFlag(state, 'boxCut');
                if (hooks.sfx) hooks.sfx('wipe'); // blade through tape
                rebuildBoxes();
              }
              return;
            }
            const res = takeFromBox(state, box.id, 6);
            if (!res.ok) { if (hooks.toast) hooks.toast(res.reason, 'warn'); return; }
            rebuildStock();
            if (hooks.sfx) hooks.sfx('chime');
            if (hooks.toast) {
              hooks.toast(res.left > 0
                ? `${res.taken} × ${name} to the backroom — ${res.left} still in the case.`
                : `Case emptied — ${res.taken} × ${name} to the backroom.`);
            }
          } else {
            const res = pickUpBox(state, box.id);
            if (!res.ok) { if (hooks.toast) hooks.toast(res.reason, 'warn'); return; }
            tutorialFlag(state, 'boxCarried');
            if (hooks.sfx) hooks.sfx('thunk');
          }
          rebuildBoxes();
        },
      });
      boxProps.push(prop);
    }
    boxSig = boxSignature();
  }

  // the set-down verb follows the player while a box is in their arms.
  // A box goes down wherever you stand — floor, porch, yard — right where
  // you're facing; it only refuses a spot that would cross a wall.
  function boxDropSpot() {
    const fx = -Math.sin(walk.yaw);
    const fz = -Math.cos(walk.yaw);
    let dx = walk.x + fx * 0.9;
    let dz = walk.z + fz * 0.9;
    // never place it through the wall you're standing against
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
      const c = carriedBox(state);
      if (!c) return null;
      const l = W2L(walk.x, walk.z);
      const sku = SHOP_CATALOG.find((s) => s.id === c.skuId);
      const name = sku ? sku.name : c.skuId;
      if (inStockroomBounds(l.x, l.z)) return `Carrying ${name} ×${c.qty} — [E] set it down (unpacks here)`;
      return `Carrying ${name} ×${c.qty} — [E] set it down`;
    },
    action: () => {
      const c = carriedBox(state);
      if (!c) return;
      const drop = boxDropSpot();
      const l = W2L(drop.x, drop.z);
      putDownBox(state, c.id, { x: l.x, z: l.z, ry: walk.yaw + 0.1 });
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
        const f = pool[rng.int(pool.length)];
        const wp = L2W(f.x, f.z);
        // stand a step off the fixture, on its open side
        const l = f;
        const offZ = l.z < -5 ? 1.2 : l.z > 5 ? -1.2 : (l.ry !== 0 ? 0 : 1.2);
        const offX = Math.abs(l.ry) > 0.5 ? (l.x < 0 ? 1.2 : -1.2) : 0;
        stops.push({
          kind: 'fixture',
          skus: f.skus,
          title: f.title,
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
      // what a review will be written from: did they get in, did they buy, did they wait
      seed: rng.next(),
      entered: false,
      bought: false,
      reviewed: false,
      queuedAt: 0,
      queueLenOnArrival: 0,
      isGolfer: toCounter, // the ones with a tee time actually played the course
    });
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

    for (const it of c.cart) returnToShelf(state, it.skuId);
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
    syncCounterItems(null);
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

    if (c.cart && c.cart.length) {
      for (const it of c.cart) returnToShelf(state, it.skuId);
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
          if (!c.awaitingCheckout) syncCounterItems(c); // their items go ON the counter
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
    updateFlicker(dt);
    builder.update();
    if (office.updateLid) office.updateLid(dt);
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
    // tearing the scene down must not pocket whatever shoppers were holding: the save is written
    // from `state`, and stock in a deleted shopper's hands would simply cease to exist.
    for (let i = customers.length - 1; i >= 0; i--) removeCustomer(i);
  }

  return {
    group, interior,
    update, rebuildStock, rebuildReno, refreshCondition, repaintGrime,
    isInside, groundYAt, vacuumAt, vacuumLabelAt,
    doorWorld: doorW,
    laptopPose: (fovDeg, aspect) => (office.seatPose ? office.seatPose(fovDeg, aspect) : null),
    laptopLid: (open) => office.setLid && office.setLid(open),
    laptopBoot: () => office.startBoot && office.startBoot(),
    laptopScreen: (mode) => office.paintScreen && office.paintScreen(mode),
    laptopScreenCorners: () => (office.screenCorners ? office.screenCorners() : null),
    confirmChange: () => regConfirmChange(), // [R] hands over counted change (Realistic)
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
