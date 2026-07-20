// REGISTER MODE — the counter you work with your hands.
//
// What this replaces was a single context-sensitive [E] on an invisible trigger:
// press it to scan an item, press it to total up, press it to run the card, press
// it to cycle a change amount, [R] to confirm. Every verb was the same keypress,
// and nothing on the counter ever moved. It was a menu wearing a register's clothes.
//
// Now the camera settles into a cashier's pose, the pointer becomes a cursor, and
// everything on the counter is a real object you grab and move. You pick a product
// up and drag it across the scanner — and it is the CROSSING that scans it, not a
// button. You take the customer's notes off the counter, open the drawer, put each
// note in its own well, pick change out of the other wells, and hand it back. Get it
// wrong in Realistic and the till comes up short by exactly what you fumbled.
//
// WHAT MAKES THIS SAFE: this file owns no rules. Every legality question — may this
// be scanned, is it already scanned, may payment start, is the change right, may the
// sale bank — goes to src/sim/register.js, which is pure and pinned by 40 tests. This
// module moves meshes and reports what the player did. Its worst possible bug is
// refusing to do something. It cannot invent money.

import * as THREE from 'three';
import { REGISTER, COUNTER, COUNTER_TOP, inRect, queueSlot } from '../../data/shopLayout.js';
import { skuById } from '../../data/shopItems.js';
import {
  DENOMS, BILLS, createTx, scanItem, unscannedCount, requestPayment,
  subtotal, discountOf, totalOf, dueOf, cashTotalOf,
  presentCard, runCard, retryCard, cancelCard, payCashInstead,
  customerCash, acceptCash, openDrawer, closeDrawer, depositPiece,
  takeFromDrawer, returnToDrawer, changeDue, handTotal, handOverChange,
  makeChangeFrom, printReceipt, takeReceipt, bagItem, allBagged, handOverGoods,
  completeSale, voidTx, segmentHitsBox, newDrawer, stackCount, stackTotal,
} from '../../sim/register.js';

const CARRY_Y = COUNTER_TOP + 0.115;  // how high a grabbed item rides — inside the scan volume
const REST_Y = COUNTER_TOP + 0.012;
const CARD_TIME = 1.5;                // seconds the terminal spends authorising
// how close to the bag counts as IN the bag. The carrier is 0.27 yd across, so this is
// the bag plus a hand's width — generous on purpose, because the alternative is a
// player who drops a box against the side of the bag and watches nothing happen.
const BAG_REACH = 0.34;

// ============================================================ TEXTURES ========
// A banknote IS its print. Modelling one buys you a rectangle: the entire identity
// is in the face. So the money is drawn, not sculpted. The currency is invented —
// FAIRWAY RESERVE, a crest, a denomination — because the brief says use fictional
// money, and because printing a real note would be forgery rendered at 60 fps.

function billTexture(denom) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 112;
  const c = cv.getContext('2d');
  const hue = { 1: '#cbd4c0', 5: '#dcc7bd', 10: '#c6d0da', 20: '#c9d8c1', 50: '#d6cbdd' }[denom];
  const ink = { 1: '#3b5036', 5: '#6d4038', 10: '#2e4a64', 20: '#2d5c33', 50: '#4a3560' }[denom];
  c.fillStyle = hue;
  c.fillRect(0, 0, 256, 112);
  // guilloche — the fine wavy linework that makes a note read as PRINTED, not painted
  c.strokeStyle = ink;
  c.globalAlpha = 0.15;
  for (let i = 0; i < 24; i++) {
    c.beginPath();
    for (let x = 0; x <= 256; x += 6) {
      const y = 56 + Math.sin((x + i * 13) * 0.05) * (16 + i) * Math.cos(i * 0.42);
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  }
  c.globalAlpha = 1;
  c.lineWidth = 3;
  c.strokeRect(7, 7, 242, 98);
  c.lineWidth = 1;
  c.strokeRect(13, 13, 230, 86);
  c.fillStyle = ink;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = 'bold 42px Georgia, serif';
  c.fillText(String(denom), 44, 58);
  c.fillText(String(denom), 212, 58);
  c.font = 'bold 12px Georgia, serif';
  c.fillText('FAIRWAY RESERVE', 128, 32);
  c.font = '9px Georgia, serif';
  c.fillText('LEGAL TENDER', 128, 82);
  c.globalAlpha = 0.55;
  for (const r of [20, 14]) {
    c.beginPath();
    c.arc(128, 57, r, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function coinTexture(denom) {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#8f959b';
  c.fillRect(0, 0, 128, 128);
  const g = c.createRadialGradient(48, 44, 4, 64, 64, 66);
  g.addColorStop(0, '#e9ecef');
  g.addColorStop(0.55, '#a9afb5');
  g.addColorStop(1, '#787e84');
  c.fillStyle = g;
  c.beginPath();
  c.arc(64, 64, 63, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#6b7177';
  c.lineWidth = 3;
  c.beginPath();
  c.arc(64, 64, 54, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = '#4b5157';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = 'bold 44px Georgia, serif';
  c.fillText(String(Math.round(denom * 100)), 64, 58);
  c.font = 'bold 13px Georgia, serif';
  c.fillText('CENTS', 64, 94);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a white sticker with black bars — the thing that actually has to cross the glass
function barcodeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#f5f3ed';
  c.fillRect(0, 0, 128, 64);
  c.fillStyle = '#15171b';
  let x = 7;
  let s = 7;
  while (x < 119) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const w = 1 + (s % 4);
    c.fillRect(x, 5, w, 40);
    x += w + 1 + ((s >> 6) % 4);
  }
  c.font = '11px monospace';
  c.textAlign = 'center';
  c.fillText('0 74512 88190', 64, 58);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a boxed product: the SKU's own name, printed, so an item on the counter is
// identifiable at a glance instead of being an anonymous coloured cube
function boxTexture(name, cat) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const c = cv.getContext('2d');
  const base = { clubs: '#2c3742', balls: '#f0ede4', apparel: '#3d5346', accessories: '#4a4034' }[cat] || '#40474d';
  const fg = cat === 'balls' ? '#26302a' : '#ece8dd';
  c.fillStyle = base;
  c.fillRect(0, 0, 256, 256);
  c.strokeStyle = fg;
  c.globalAlpha = 0.25;
  c.lineWidth = 2;
  c.strokeRect(14, 14, 228, 228);
  c.globalAlpha = 1;
  c.fillStyle = fg;
  c.textAlign = 'center';
  c.font = 'bold 15px Georgia, serif';
  const words = String(name).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 13) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  lines.slice(0, 3).forEach((l, i) => c.fillText(l, 128, 108 + i * 22));
  c.globalAlpha = 0.7;
  c.font = '11px Georgia, serif';
  c.fillText('WILLOW CREEK PRO SHOP', 128, 200);
  c.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// merch models that are the right size to sit on a counter. Everything else is a
// boxed product, which is honest: a driver comes to the till in its box.
const MODEL_FOR = { polo1: 'polo_folded', polo2: 'polo_folded', jacket2: 'polo_folded', cap1: 'cap', glove1: 'glove' };
const BOX_SIZE = {
  clubs: [0.20, 0.11, 0.15], balls: [0.155, 0.075, 0.115],
  apparel: [0.19, 0.07, 0.15], accessories: [0.15, 0.09, 0.12],
};

// =========================================================== THE MODE =========

export function createRegisterMode(B) {
  const { interior, mats, merch, hooks, walk, state, L2W, FLOOR_TOP } = B;
  const camera = B.ctx.camera;
  const canvas = B.ctx.canvas || document.querySelector('canvas');
  // NOT walk.focusOn — `walk` here is the raw state bag (x, z, yaw), not the API.
  const focusOn = B.ctx.focusOn || (() => {});
  const clearFocus = B.ctx.clearFocus || (() => {});
  const sfx = (n) => { if (hooks.sfx) hooks.sfx(n); };
  const toast = (m, k) => { if (hooks.toast) hooks.toast(m, k); };

  const root = new THREE.Group();
  interior.add(root);

  // --- shared materials, one per denomination, built once -------------------------
  const billMat = {};
  const coinMat = {};
  for (const d of DENOMS) {
    if (BILLS.includes(d)) billMat[d] = new THREE.MeshStandardMaterial({ map: billTexture(d), roughness: 0.87 });
    else {
      const f = new THREE.MeshStandardMaterial({ map: coinTexture(d), roughness: 0.4, metalness: 0.6 });
      const e = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.45, metalness: 0.6 });
      coinMat[d] = [e, f, f];   // cylinder material order: side, top, bottom
    }
  }
  const barcodeMat = new THREE.MeshStandardMaterial({ map: barcodeTexture(), roughness: 0.8 });
  const boxMats = new Map();
  const cardMat = new THREE.MeshStandardMaterial({ color: 0x2c4c66, roughness: 0.25, metalness: 0.25 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5 });

  const BILL_GEO = new THREE.BoxGeometry(0.152, 0.0018, 0.066);
  const COIN_GEO = new THREE.CylinderGeometry(0.0125, 0.0125, 0.0024, 16);
  const BC_GEO = new THREE.PlaneGeometry(0.05, 0.025);
  const makePiece = (d) => {
    const m = BILLS.includes(d)
      ? new THREE.Mesh(BILL_GEO, billMat[d])
      : new THREE.Mesh(COIN_GEO, coinMat[d]);
    m.castShadow = true;
    m.userData = { pick: true, kind: 'money', denom: d };
    return m;
  };

  // --- the register screen ---------------------------------------------------------
  // Everything the brief demands on the actual monitor: line items, quantity, unit
  // price, discount, subtotal, total, method, tendered, change, status. There is no
  // tax in this economy, so there is no tax line — inventing one would be a lie on
  // a receipt.
  const scv = document.createElement('canvas');
  scv.width = 384;
  scv.height = 240;
  const stex = new THREE.CanvasTexture(scv);
  stex.colorSpace = THREE.SRGBColorSpace;
  const screenMaterial = new THREE.MeshStandardMaterial({
    map: stex, emissive: 0xffffff, emissiveMap: stex, emissiveIntensity: 0.75,
  });

  // the card terminal has its own little screen, and it prompts
  const tcv = document.createElement('canvas');
  tcv.width = 192;
  tcv.height = 144;
  const ttex = new THREE.CanvasTexture(tcv);
  ttex.colorSpace = THREE.SRGBColorSpace;
  const termMaterial = new THREE.MeshStandardMaterial({
    map: ttex, emissive: 0xffffff, emissiveMap: ttex, emissiveIntensity: 0.7,
  });

  // THE DISPLAYS ARE THEIR OWN PLANES, and they have to be.
  //
  // The register model's screen face was UV-unwrapped by Blender's smart_project, so
  // its UV island sits somewhere in an atlas — NOT 0..1. Painting a canvas onto that
  // face samples an arbitrary sub-rectangle of the image, and the register rendered as
  // a black slab: it was showing a magnified corner of the dark background. The
  // material was fine and the texture was updating (version 17, live) — the UVs were
  // the lie.
  //
  // Same class of bug as roundedBox()'s planar world-scaled UVs, which cropped a
  // product label into mush last session, and the same fix: never trust an atlas UV to
  // carry a 0..1 image. A PlaneGeometry has clean 0..1 UVs by construction.
  //
  // The live transaction canvases ride the Tripo devices' real screens, whose pose was
  // MEASURED off the atlas geometry (tools/blender/measure_screens.py: the screen is the
  // largest flat panel facing out) rather than guessed. orientPlane lays the plane's +Z
  // along the measured glass normal, so the canvas sits flat on the screen at whatever
  // tilt the scan modelled, and — being parented to the prop — rides its rotation too.
  function orientPlane(p, cx, cy, cz, nx, ny, nz) {
    p.position.set(cx, cy, cz);
    // Build the plane's basis against world-up, not an arbitrary one: aligning +Z to the
    // normal with setFromUnitVectors leaves a free ROLL, which tilted the screen text ~10
    // deg off the bezel. Projecting world-up onto the glass fixes the plane's own up.
    const n = new THREE.Vector3(nx, ny, nz).normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(n.dot(up)) > 0.97) up = new THREE.Vector3(0, 0, 1);   // glass facing straight up
    const right = new THREE.Vector3().crossVectors(up, n).normalize();
    const up2 = new THREE.Vector3().crossVectors(n, right).normalize();
    p.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up2, n));
    p.translateZ(0.006);   // a hair proud of the glass, so it never z-fights the bezel
  }
  function attachScreen(reg) {
    // kiosk glass: measured centre (0.019, 0.315, 0), normal (0.84, 0.54, 0). The prop
    // is placed at ry -PI/2 so this swings round to face the staff, tilted up.
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.225), screenMaterial);
    orientPlane(p, 0.019, 0.315, 0.0, 0.84, 0.54, 0.0);
    reg.add(p);
  }
  function attachTerm(t) {
    // card-reader glass: measured centre (0.004, 0.057, -0.049), normal ~(0, 0.05, -1),
    // facing the customer at ry 0.
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.044), termMaterial);
    orientPlane(p, 0.004, 0.057, -0.049, 0.0, 0.05, -1.0);
    t.add(p);
  }

  function drawScreen() {
    const c = scv.getContext('2d');
    c.fillStyle = '#0c1712';
    c.fillRect(0, 0, 384, 240);
    c.fillStyle = '#1a2b21';
    c.fillRect(0, 0, 384, 26);
    c.fillStyle = '#7fe0a0';
    c.font = 'bold 14px monospace';
    c.textAlign = 'left';
    c.fillText(tx ? `ORDER · ${cust ? cust.name.toUpperCase().slice(0, 14) : ''}` : 'REGISTER · READY', 8, 18);

    if (!tx) {
      c.fillStyle = '#3f7a58';
      c.font = '12px monospace';
      const s = state.shop;
      c.fillText(`yesterday   ${s.salesYesterday.units} sales`, 8, 60);
      c.fillText(`            $${Math.round(s.salesYesterday.revenue)}`, 8, 78);
      if (s.salesLive && s.salesLive.units) {
        c.fillStyle = '#7fe0a0';
        c.fillText(`today       ${s.salesLive.units} rung up`, 8, 104);
      }
      stex.needsUpdate = true;
      return;
    }

    // Cash-counting gets the whole diegetic monitor. Five compact line items and a
    // footer were technically complete but unreadable from the drawer, precisely
    // when a player needs the numbers most. The physical monitor remains the UI;
    // only its information hierarchy changes for this state.
    if (tx.stage === 'cash-tender' || tx.stage === 'cash-drawer') {
      const purchaseTotal = cashTotalOf(tx);
      const received = tx.tenderedTotal != null
        ? tx.tenderedTotal
        : stackTotal(tx.tendered || {});
      const due = Math.max(0, changeDue(tx));
      const selected = Math.max(0, handTotal(tx));
      const remaining = Math.round((due - selected) * 100) / 100;
      const rows = [
        ['TOTAL', purchaseTotal, '#f4f7ef'],
        ['CASH RECEIVED', received, '#d7e8dc'],
        ['CHANGE DUE', due, '#ffd98a'],
        ['SELECTED', selected, '#8fd6ff'],
        ['REMAINING', remaining, remaining < 0 ? '#ff9a8a' : remaining === 0 ? '#9fe8b4' : '#f4f7ef'],
      ];
      rows.forEach(([label, amount, color], i) => {
        const y = 50 + i * 33;
        c.textAlign = 'left';
        c.fillStyle = '#7fbf9a';
        c.font = 'bold 11px monospace';
        c.fillText(label, 10, y);
        c.textAlign = 'right';
        c.fillStyle = color;
        c.font = 'bold 21px monospace';
        const value = amount < 0 ? `OVER $${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
        c.fillText(value, 374, y + 2);
        if (i < rows.length - 1) {
          c.fillStyle = '#233b2e';
          c.fillRect(10, y + 10, 364, 1);
        }
      });

      c.fillStyle = '#14271d';
      c.fillRect(0, 202, 384, 38);
      c.textAlign = 'center';
      c.font = 'bold 13px monospace';
      let status = 'TAKE THE CUSTOMER CASH';
      let color = '#ffd98a';
      if (tx.stage === 'cash-tender') status = 'TAKE THE CUSTOMER CASH';
      else if (tx.stage === 'cash-drawer' && !tx.drawerOpen) status = 'OPEN THE CASH DRAWER';
      else if (tx.stage === 'cash-drawer' && !tx.deposited) status = 'PUT THEIR CASH IN THE TILL';
      else if (remaining > 0) status = `SELECT $${remaining.toFixed(2)} MORE`;
      else if (remaining < 0) { status = `OVER BY $${Math.abs(remaining).toFixed(2)} — RETURN A PIECE`; color = '#ff9a8a'; }
      else if (due <= 0) { status = 'EXACT PAYMENT — CLOSE THE DRAWER'; color = '#9fe8b4'; }
      else { status = 'EXACT CHANGE — HAND IT OVER'; color = '#9fe8b4'; }
      c.fillStyle = color;
      c.fillText(status, 192, 226);
      stex.needsUpdate = true;
      return;
    }

    // line items: only what has been SCANNED is on the bill
    c.font = '12px monospace';
    let y = 46;
    for (const it of tx.items) {
      const on = it.scanned;
      c.fillStyle = on ? '#cfead9' : '#2f5842';
      c.textAlign = 'left';
      c.fillText((on ? '1  ' : '·  ') + it.name.slice(0, 20), 8, y);
      c.textAlign = 'right';
      c.fillText(on ? it.price.toFixed(2) : '—', 376, y);
      y += 17;
      if (y > 150) break;
    }

    const left = unscannedCount(tx);
    c.textAlign = 'left';
    c.fillStyle = '#35604a';
    c.fillRect(8, 158, 368, 1);

    const row = (k, v, col, bold) => {
      c.fillStyle = col;
      c.font = (bold ? 'bold ' : '') + '13px monospace';
      c.textAlign = 'left';
      c.fillText(k, 8, y2);
      c.textAlign = 'right';
      c.fillText(v, 376, y2);
      y2 += 17;
    };
    let y2 = 176;
    row('SUBTOTAL', '$' + subtotal(tx).toFixed(2), '#7fbf9a');
    if (tx.discount > 0) row('MEMBER DISCOUNT', '-$' + discountOf(tx).toFixed(2), '#7fbf9a');
    row('TOTAL', '$' + dueOf(tx).toFixed(2), '#eaffef', true);

    // status line — the one that tells you what the register is waiting for
    c.textAlign = 'left';
    c.font = 'bold 13px monospace';
    let msg = '';
    let col = '#ffd98a';
    if (left > 0) msg = `${left} ITEM${left > 1 ? 'S' : ''} STILL TO SCAN`;
    else if (tx.stage === 'scanning') msg = 'ALL SCANNED — TOTAL IT UP';
    else if (tx.stage === 'payment') msg = 'CHOOSE A PAYMENT METHOD';
    else if (tx.stage === 'card-present') msg = 'CARD — ASK THEM TO PRESENT';
    else if (tx.stage === 'card-ready') msg = 'CARD READY — RUN THE TERMINAL';
    else if (tx.stage === 'card-busy') msg = 'AUTHORISING…';
    else if (tx.stage === 'card-declined') { msg = tx.cardResult === 'timeout' ? 'TIMED OUT — TRY AGAIN' : 'DECLINED — ANOTHER CARD'; col = '#ff9a8a'; }
    else if (tx.stage === 'cash-tender') msg = `CASH $${stackTotal(tx.tendered || {}).toFixed(2)} — TAKE IT`;
    else if (tx.stage === 'cash-drawer') {
      const due = changeDue(tx);
      if (!tx.deposited) msg = 'PUT THEIR MONEY IN THE TILL';
      else if (due <= 0) msg = 'EXACT — CLOSE THE DRAWER';
      else msg = `CHANGE $${due.toFixed(2)} · HOLDING $${handTotal(tx).toFixed(2)}`;
    } else if (tx.stage === 'receipt') msg = tx.receiptPrinted ? 'TAKE THE RECEIPT' : 'PRINTING…';
    else if (tx.stage === 'bagging') msg = `BAG THE GOODS (${tx.items.filter((i) => i.bagged).length}/${tx.items.length})`;
    else if (tx.stage === 'done') { msg = 'HAND IT OVER'; col = '#9fe8b4'; }
    c.fillStyle = col;
    c.fillText(msg, 8, 232);

    // and, in Relaxed, the count the register is telling you to make
    if (tx.stage === 'cash-drawer' && tx.mode === 'relaxed' && tx.deposited && changeDue(tx) > 0) {
      const want = makeChangeFrom(drawer, changeDue(tx));
      if (want) {
        const s = Object.entries(want).map(([d, n]) => `${n}x${Number(d) < 1 ? Math.round(d * 100) + 'c' : '$' + d}`).join(' ');
        c.textAlign = 'right';
        c.fillStyle = '#8fd6ff';
        c.font = '11px monospace';
        c.fillText(s.slice(0, 34), 376, 232);
      }
    }
    stex.needsUpdate = true;
  }

  function drawTerm() {
    const c = tcv.getContext('2d');
    c.fillStyle = '#101418';
    c.fillRect(0, 0, 192, 144);
    c.textAlign = 'center';
    if (!tx || tx.method !== 'card') {
      c.fillStyle = '#3a4550';
      c.font = '13px monospace';
      c.fillText('IDLE', 96, 76);
      ttex.needsUpdate = true;
      return;
    }
    c.fillStyle = '#dfe7ee';
    c.font = 'bold 22px monospace';
    c.fillText('$' + totalOf(tx).toFixed(2), 96, 44);
    c.font = 'bold 14px monospace';
    if (tx.stage === 'card-present') { c.fillStyle = '#8fd6ff'; c.fillText('PRESENT CARD', 96, 92); }
    else if (tx.stage === 'card-ready') { c.fillStyle = '#8fd6ff'; c.fillText('TAP TO PAY', 96, 92); c.font = '10px monospace'; c.fillText('click to run', 96, 116); }
    else if (tx.stage === 'card-busy') { c.fillStyle = '#ffd98a'; c.fillText('AUTHORISING', 96, 92); }
    else if (tx.stage === 'card-declined') {
      c.fillStyle = '#ff8a7a';
      c.fillText(tx.cardResult === 'timeout' ? 'TIMED OUT' : 'DECLINED', 96, 92);
      c.font = '10px monospace';
      c.fillText('another card?', 96, 116);
    } else { c.fillStyle = '#9fe8b4'; c.fillText('APPROVED', 96, 92); }
    ttex.needsUpdate = true;
  }

  // --- the drawer -------------------------------------------------------------------
  const drawerGroup = new THREE.Group();
  const DZ = COUNTER.z + COUNTER.depth / 2 - 0.22;   // shut: tucked inside the carcass
  drawerGroup.position.set(REGISTER.drawer.x, REGISTER.drawer.y, DZ);
  root.add(drawerGroup);
  const drawerMoney = new THREE.Group();
  drawerGroup.add(drawerMoney);
  let drawerAmt = 0;
  let drawerWant = 0;

  // slot positions inside the drawer, in its local frame. These MUST agree with
  // build_register.py: five bill wells nearest the player, three coin cups behind.
  const SLOT = {};
  BILLS.forEach((d, i) => { SLOT[d] = { x: -0.152 + i * 0.076, y: 0.118, z: 0.095 }; });
  [0.25, 0.1, 0.05].forEach((d, i) => { SLOT[d] = { x: -0.11 + i * 0.11, y: 0.112, z: -0.098 }; });

  if (merch) {
    merch.onReady(() => {
      const d = merch.instantiate('cash_drawer');
      if (d) drawerGroup.add(d);
    });
  }

  // --- counter dressing this mode owns ------------------------------------------------
  const matOf = (r, col) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(r.maxX - r.minX, 0.008, r.maxZ - r.minZ),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.95 }),
    );
    m.position.set((r.minX + r.maxX) / 2, COUNTER_TOP + 0.004, (r.minZ + r.maxZ) / 2);
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  matOf(REGISTER.staging, 0x2b3630);
  matOf(REGISTER.bagging, 0x342f28);

  const bagGroup = new THREE.Group();
  bagGroup.position.set(REGISTER.bagging.minX + 0.20, COUNTER_TOP, (REGISTER.bagging.minZ + REGISTER.bagging.maxZ) / 2);
  root.add(bagGroup);

  // the ring that says "put it HERE" — exactly BAG_REACH across, so what the player
  // sees is precisely what the code accepts. A hint that lies about its own hitbox is
  // worse than no hint.
  const bagRing = new THREE.Mesh(
    new THREE.RingGeometry(BAG_REACH - 0.03, BAG_REACH, 28),
    new THREE.MeshBasicMaterial({ color: 0x8fe3b0, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
  );
  bagRing.rotation.x = -Math.PI / 2;
  bagRing.position.set(bagGroup.position.x, COUNTER_TOP + 0.009, bagGroup.position.z);
  bagRing.visible = false;
  root.add(bagRing);

  if (merch) {
    merch.onReady(() => {
      const bag = merch.instantiate('bag_open');
      if (bag) { bag.scale.setScalar(0.8); bagGroup.add(bag); }
      const rack = merch.instantiate('impulse_rack');
      if (rack) { rack.position.set(REGISTER.impulse.x, COUNTER_TOP, REGISTER.impulse.z); rack.rotation.y = Math.PI; root.add(rack); }
      const div = merch.instantiate('divider');
      if (div) { div.position.set(REGISTER.divider.x, COUNTER_TOP, REGISTER.divider.z); root.add(div); }
    });
  }

  // --- the receipt --------------------------------------------------------------------
  const rcv = document.createElement('canvas');
  rcv.width = 128;
  rcv.height = 288;
  const rtex = new THREE.CanvasTexture(rcv);
  rtex.colorSpace = THREE.SRGBColorSpace;
  const receiptMat = new THREE.MeshStandardMaterial({ map: rtex, roughness: 0.93, side: THREE.DoubleSide });
  const RECEIPT_GEO = new THREE.PlaneGeometry(0.075, 0.17);
  let receiptMesh = null;

  function drawReceipt(r) {
    const c = rcv.getContext('2d');
    c.fillStyle = '#f7f5ee';
    c.fillRect(0, 0, 128, 288);
    c.fillStyle = '#2b2c27';
    c.textAlign = 'center';
    c.font = 'bold 10px monospace';
    c.fillText((state.clubName || 'THE CLUB').toUpperCase().slice(0, 17), 64, 20);
    c.font = '8px monospace';
    c.fillText('PRO SHOP', 64, 32);
    let y = 52;
    c.font = '8px monospace';
    for (const l of r.lines.slice(0, 12)) {
      c.textAlign = 'left';
      c.fillText(l.name.slice(0, 12), 6, y);
      c.textAlign = 'right';
      c.fillText(l.price.toFixed(2), 122, y);
      y += 11;
    }
    y += 3;
    c.fillRect(6, y, 116, 1);
    y += 13;
    const row = (k, v, bold) => {
      c.font = (bold ? 'bold ' : '') + '9px monospace';
      c.textAlign = 'left';
      c.fillText(k, 6, y);
      c.textAlign = 'right';
      c.fillText(v, 122, y);
      y += 12;
    };
    row('SUBTOTAL', r.subtotal.toFixed(2));
    if (r.discount > 0) row('MEMBER', '-' + r.discount.toFixed(2));
    if (r.rounding) row('ROUNDING', (r.rounding > 0 ? '+' : '') + r.rounding.toFixed(2));
    row('TOTAL', r.total.toFixed(2), true);
    row(r.method === 'cash' ? 'CASH' : 'CARD', r.method === 'cash' ? r.tendered.toFixed(2) : 'APPROVED');
    if (r.method === 'cash' && r.change > 0) row('CHANGE', r.change.toFixed(2));
    y += 8;
    c.textAlign = 'center';
    c.font = '8px monospace';
    c.fillText('THANK YOU', 64, y);
    rtex.needsUpdate = true;
  }

  // --- the customer's open palm ---------------------------------------------------------
  // Change and the bag go INTO A HAND. A key press would be a menu again, so the hand
  // is a real target on their side of the counter that lights up when it is waiting
  // for something.
  const palm = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xf0d8b4, roughness: 0.85, transparent: true, opacity: 0.0 }),
  );
  palm.position.set(queueSlot(0).x + 0.18, COUNTER_TOP + 0.07, COUNTER.z - COUNTER.depth / 2 - 0.06);
  palm.userData = { pick: true, kind: 'palm' };
  palm.visible = false;
  root.add(palm);

  // --- hotspots ---------------------------------------------------------------------
  // The equipment itself is clickable. These are invisible boxes sitting over the real
  // models, because the models are merged and shared and have no business carrying
  // interaction state. Every one of them is a thing you would physically touch on a
  // real till: the terminal, the drawer's finger pull, the TOTAL key.
  const HOT = new THREE.MeshBasicMaterial({ visible: false });
  function hotspot(kind, x, y, z, w, h, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HOT);
    m.position.set(x, y, z);
    m.userData = { pick: true, kind };
    root.add(m);
    return m;
  }
  const hotTerm = hotspot('terminal', REGISTER.cardterm.x, COUNTER_TOP + 0.06, REGISTER.cardterm.z, 0.16, 0.14, 0.16);
  const hotTotal = hotspot('total', REGISTER.monitor.x, COUNTER_TOP + 0.07, REGISTER.monitor.z - 0.08, 0.22, 0.15, 0.12);
  // the drawer's pull moves WITH the drawer, so it is parented to it
  const hotPull = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.08), HOT);
  hotPull.position.set(0, 0.07, -0.20);
  hotPull.userData = { pick: true, kind: 'pull' };
  drawerGroup.add(hotPull);

  // ============================================================ STATE ==========
  let active = false;
  let tx = null;
  let cust = null;
  let drawer = null;
  const itemMeshes = new Map();   // uid -> mesh
  const loose = [];               // grabbable product meshes on the counter
  let tenderMeshes = [];          // the notes the customer put down
  let handMeshes = [];            // pieces the player has picked out to give back
  let cardMesh = null;
  let grabbed = null;
  const grabPrev = new THREE.Vector3();
  let cardT = 0;
  let printT = 0;
  let scanFlash = 0;

  // --- cursor raycasting ---------------------------------------------------------------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function setNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  }

  // where the cursor meets a horizontal plane at interior-local height y
  function cursorAt(y) {
    ray.setFromCamera(ndc, camera);
    plane.constant = -(interior.position.y + y);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x - interior.position.x, z: hit.z - interior.position.z };
  }

  function pickables() {
    const t = [...loose, ...tenderMeshes, ...handMeshes, ...drawerMoney.children,
      hotTerm, hotTotal, hotPull];
    if (receiptMesh) t.push(receiptMesh);
    if (palm.visible) t.push(palm);
    return t;
  }

  function pickUnder() {
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables(), true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.pick && o.parent) o = o.parent;
    return o && o.userData.pick ? o : null;
  }

  // the BARCODE's world position, not the item's origin: waving a box's base past the
  // glass while its label points at the ceiling should not scan it
  function barcodeAt(mesh) {
    const b = mesh.userData.bc;
    (b || mesh).getWorldPosition(tmp);
    return { x: tmp.x - interior.position.x, y: tmp.y - interior.position.y, z: tmp.z - interior.position.z };
  }

  // ============================================================ BUILD ==========

  function buildItemMesh(item) {
    const sku = skuById(item.skuId);
    const cat = sku ? sku.cat : 'accessories';
    let mesh = null;
    const modelName = MODEL_FOR[item.skuId];
    if (modelName && merch && merch.has(modelName)) {
      mesh = merch.instantiate(modelName, { tint: 0x8a8f86 });
      if (mesh) {
        const g = new THREE.Group();
        g.add(mesh);
        mesh = g;
      }
    }
    if (!mesh) {
      const [w, h, d] = BOX_SIZE[cat] || BOX_SIZE.accessories;
      let bm = boxMats.get(item.skuId);
      if (!bm) {
        bm = new THREE.MeshStandardMaterial({ map: boxTexture(sku ? sku.name : item.skuId, cat), roughness: 0.78 });
        boxMats.set(item.skuId, bm);
      }
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bm);
      box.castShadow = true;
      const g = new THREE.Group();
      g.add(box);
      box.position.y = h / 2;
      mesh = g;
    }
    // The barcode sticker, lying on the item's top face. box.max.y — the TOP of the
    // bounding box — not (max.y - min.y), which is its HEIGHT. Those are the same
    // number only when the origin sits at the base, which is true of the boxed products
    // and false of the GLB goods, whose origins are centred. The first cut used the
    // height and every glove and cap wore its barcode floating half a body above it.
    const bc = new THREE.Mesh(BC_GEO, barcodeMat);
    bc.rotation.x = -Math.PI / 2;
    const box = new THREE.Box3().setFromObject(mesh);
    bc.position.set(0, box.max.y + 0.003, 0.006);
    mesh.add(bc);

    mesh.userData = { pick: true, kind: 'item', uid: item.uid, bc };
    mesh.castShadow = true;
    return mesh;
  }

  function layOutGoods() {
    const r = REGISTER.staging;
    const n = tx.items.length;
    const cols = Math.min(3, n);
    tx.items.forEach((it, i) => {
      const m = itemMeshes.get(it.uid);
      if (!m) return;
      const cx = i % cols;
      const cz = Math.floor(i / cols);
      const px = r.minX + 0.16 + cx * ((r.maxX - r.minX - 0.28) / Math.max(1, cols - 1) || 0);
      const pz = r.minZ + 0.10 + cz * 0.14;
      m.position.set(px, REST_Y, Math.min(pz, r.maxZ - 0.06));
      m.rotation.y = (i * 0.7) % 1.2 - 0.6;
    });
  }

  function refillDrawerMoney() {
    drawerMoney.clear();
    if (!drawer) return;
    for (const d of DENOMS) {
      const n = Math.min(drawer[d] || 0, 8);   // a well only shows the top of its stack
      const s = SLOT[d];
      if (!s) continue;
      for (let i = 0; i < n; i++) {
        const p = makePiece(d);
        p.userData.from = 'drawer';
        p.position.set(s.x, s.y + i * (BILLS.includes(d) ? 0.0022 : 0.0028), s.z);
        // Bill wells are narrow across X and deep across Z. Turning the notes with
        // the well leaves a real gap between denominations; the old overlapping
        // fan let a click on $10 ray-hit the neighbouring $5 first.
        if (BILLS.includes(d)) p.rotation.y = Math.PI / 2 + (i % 2) * 0.02;
        drawerMoney.add(p);
      }
    }
  }

  function layHand() {
    handMeshes.forEach((m, i) => {
      m.position.set(REGISTER.scanner.x - 0.44 + (i % 6) * 0.055, COUNTER_TOP + 0.006 + Math.floor(i / 6) * 0.004, COUNTER.z + 0.40);
      m.rotation.y = 0.1;
    });
  }

  // ============================================================ FLOW ===========

  function begin(customer) {
    if (tx) return false;
    const items = customer.cart.map((it, i) => ({
      uid: it.uid || `${customer.id}-${i}`,
      skuId: it.skuId,
      name: (skuById(it.skuId) || {}).name || it.skuId,
      price: it.price,
    }));
    if (!items.length) return false;
    if (!state.shop.drawer) state.shop.drawer = newDrawer();
    drawer = state.shop.drawer;
    tx = createTx({ items, mode: state.mode, discount: customer.discount || 0, prefer: customer.payMethod || null });
    cust = customer;
    customer.tx = tx;
    if (customer.onCheckoutStarted) customer.onCheckoutStarted(tx);

    for (const it of tx.items) {
      const m = buildItemMesh(it);
      itemMeshes.set(it.uid, m);
      root.add(m);
      loose.push(m);
    }
    layOutGoods();
    refillDrawerMoney();
    printT = 0;
    drawScreen();
    drawTerm();
    sfx('thunk');
    return true;
  }

  // The customer walks out, or the shop shuts, or the scene tears down. Nothing is
  // banked and the goods go back where they came from — clubhouse.js owns returning
  // them to the shelf; this just clears the counter.
  function abandon() {
    if (tx) voidTx(tx);
    for (const m of loose) root.remove(m);
    loose.length = 0;
    itemMeshes.clear();
    for (const m of tenderMeshes) root.remove(m);
    tenderMeshes = [];
    for (const m of handMeshes) root.remove(m);
    handMeshes = [];
    if (receiptMesh) { root.remove(receiptMesh); receiptMesh = null; }
    if (cardMesh) { root.remove(cardMesh); cardMesh = null; }
    grabbed = null;
    drawerWant = 0;
    printT = 0;
    palm.visible = false;
    if (cust) cust.tx = null;
    tx = null;
    cust = null;
    drawScreen();
    drawTerm();
  }

  // THE CASHIER POSE. Derived, not eyeballed: the brief demands clear sight of the
  // customer, the goods, the register screen AND the card terminal, and the first cut
  // had the monitor 46 degrees off-axis — right at the edge of a 91-degree frustum,
  // clipped clean out of frame. The screen you must read all sale was the one thing
  // you could not see.
  //
  // From eye (2.78, 1.92, 5.52) looking at (2.70, 1.05, 4.05), everything lands inside
  // the frustum (vertical +/-30, horizontal +/-46):
  //   scanner    0 deg   dead centre        customer's head  -7 deg vertical
  //   terminal  21 deg   monitor  25 deg    bag  37 deg      open drawer -56 deg
  // The camera sits behind the stand, not on it, because a cashier leans back to see
  // the whole counter and forward to work it.
  // Authored checkout anchors live under the scanner frame, not in world space.
  // Moving or rotating the live checkout transform moves every eye and target with it.
  const interactionFrame = new THREE.Group();
  interactionFrame.name = 'checkoutInteractionFrame';
  interactionFrame.position.set(REGISTER.scanner.x, 0, REGISTER.scanner.z);
  root.add(interactionFrame);
  const anchorSpecs = {
    cashierStandAnchor:       { eye: [0.10, 1.76, 0.88], at: [0.00, 1.05, 0.00], fov: 58 },
    scanCameraAnchor:         { eye: [-0.05, 1.76, 0.88], at: [-0.20, 1.08, 0.02], fov: 58 },
    cashDisplayCameraAnchor:  { eye: [-0.08, 1.64, 0.74], at: [-0.30, 1.16, 0.28], fov: 52 },
    drawerCameraAnchor:       { eye: [-0.08, 1.72, 1.00], at: [-0.28, 1.12, 0.32], fov: 55 },
    cardTerminalCameraAnchor: { eye: [-0.12, 1.64, 0.78], at: [-0.58, 1.10, -0.30], fov: 52 },
    receiptCameraAnchor:      { eye: [0.18, 1.65, 0.78], at: [0.48, 1.12, 0.30], fov: 52 },
    baggingCameraAnchor:      { eye: [0.30, 1.70, 0.92], at: [0.72, 1.10, 0.20], fov: 55 },
    handoffCameraAnchor:      { eye: [0.10, 1.72, 0.86], at: [-0.70, 1.12, -0.58], fov: 56 },
  };
  const anchorNodes = {};
  for (const [name, spec] of Object.entries(anchorSpecs)) {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.fromArray(spec.eye);
    interactionFrame.add(node);
    anchorNodes[name] = node;
  }

  function anchorPose(name) {
    const spec = anchorSpecs[name] || anchorSpecs.scanCameraAnchor;
    interactionFrame.updateWorldMatrix(true, false);
    const eye = new THREE.Vector3().fromArray(spec.eye);
    const at = new THREE.Vector3().fromArray(spec.at);
    interactionFrame.localToWorld(eye);
    interactionFrame.localToWorld(at);
    const dx = at.x - eye.x;
    const dy = at.y - eye.y;
    const dz = at.z - eye.z;
    const dh = Math.hypot(dx, dz) || 1;
    return {
      x: eye.x, y: eye.y, z: eye.z,
      yaw: Math.atan2(-dx / dh, -dz / dh),
      pitch: Math.atan2(dy, dh),
      fov: spec.fov,
      duration: 0.18,
    };
  }

  let activeAnchor = null;
  let transitionBlock = 0;
  function focusAnchor(name) {
    if (!active || activeAnchor === name) return;
    activeAnchor = name;
    focusOn(anchorPose(name));
    transitionBlock = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 0.10;
  }

  function desiredAnchor() {
    if (!tx) return 'scanCameraAnchor';
    if (tx.stage === 'cash-tender') return 'cashDisplayCameraAnchor';
    if (tx.stage === 'cash-drawer') return tx.drawerOpen ? 'drawerCameraAnchor' : 'cashDisplayCameraAnchor';
    if (tx.stage.startsWith('card')) return 'cardTerminalCameraAnchor';
    if (tx.stage === 'receipt') return 'receiptCameraAnchor';
    if (tx.stage === 'bagging') return allBagged(tx) ? 'handoffCameraAnchor' : 'baggingCameraAnchor';
    if (tx.stage === 'done') return 'handoffCameraAnchor';
    return 'scanCameraAnchor';
  }

  function enter() {
    if (active) return false;
    active = true;
    activeAnchor = null;
    focusAnchor(desiredAnchor());
    if (document.pointerLockElement) document.exitPointerLock();
    document.body.classList.add('register-mode');
    drawScreen();
    drawTerm();
    return true;
  }

  function leave() {
    if (!active) return;
    active = false;
    grabbed = null;
    drawerWant = 0;
    activeAnchor = null;
    transitionBlock = 0;
    clearFocus();
    document.body.classList.remove('register-mode');
  }

  // ============================================================ VERBS ==========

  function tryScan(m) {
    const uid = m.userData.uid;
    const it = tx.items.find((i) => i.uid === uid);
    if (!it || it.scanned) return;
    const res = scanItem(tx, uid);
    if (!res.ok) return;
    scanFlash = 0.22;
    sfx('scanBeep');
    drawScreen();
  }

  function grab(m) {
    grabbed = m;
    m.userData.grabY = m.position.y;
    grabPrev.set(0, 0, 0);
    const b = barcodeAt(m);
    grabPrev.set(b.x, b.y, b.z);
    if (m.userData.kind === 'item') sfx('equipTick');
  }

  function release() {
    if (!grabbed) return;
    const m = grabbed;
    grabbed = null;
    const k = m.userData.kind;

    if (k === 'item') {
      // DID IT GO IN THE BAG?
      //
      // This used to ask "is the item's origin inside REGISTER.bagging" — an abstract
      // rectangle with a hard edge. In the first playthrough two boxes came to rest at
      // x = 3.201 and x = 3.299 against a rect starting at x = 3.300, so one missed by
      // ten centimetres and the other BY ONE MILLIMETRE, and neither went in the bag.
      // Nothing told the player why. A one-millimetre miss cannot be a failure.
      //
      // So the question is the physical one: did you put it near the bag? The bag is a
      // real object at a real place, and a hand's width around it counts.
      if (tx && tx.stage === 'bagging') {
        const near = Math.hypot(m.position.x - bagGroup.position.x, m.position.z - bagGroup.position.z);
        if (near <= BAG_REACH) {
          const res = bagItem(tx, m.userData.uid);
          if (res.ok) {
            sfx('paper');
            m.visible = false;                       // it is IN the bag now
            const i = loose.indexOf(m);
            if (i >= 0) loose.splice(i, 1);
            drawScreen();
            if (allBagged(tx)) { palm.visible = true; toast('All bagged — hand it over.'); }
            return;
          }
        } else {
          // and if you missed, SAY SO. Silence here is what made the millimetre bug
          // feel like the bag was broken rather than like the player had missed.
          toast('That did not go in the bag.', 'warn');
        }
      }
      // otherwise it just lands where you let go of it, on the counter
      m.position.y = REST_Y;
      m.position.x = Math.max(COUNTER.x - COUNTER.len / 2 + 0.12, Math.min(COUNTER.x + COUNTER.len / 2 - 0.12, m.position.x));
      m.position.z = Math.max(COUNTER.z - COUNTER.depth / 2 + 0.10, Math.min(COUNTER.z + COUNTER.depth / 2 - 0.10, m.position.z));
      sfx('thunk');
      return;
    }

    if (k === 'money') {
      const d = m.userData.denom;
      const from = m.userData.from;
      // dropped over the open drawer → it goes in
      const overDrawer = drawerAmt > 0.5
        && Math.abs(m.position.x - REGISTER.drawer.x) < 0.30
        && m.position.z > COUNTER.z + 0.30;

      if (from === 'tender' && overDrawer) {
        const res = depositPiece(tx, drawer, d);
        if (res.ok) {
          root.remove(m);
          tenderMeshes = tenderMeshes.filter((x) => x !== m);
          refillDrawerMoney();
          sfx(BILLS.includes(d) ? 'paper' : 'coin');
          drawScreen();
          if (res.deposited && changeDue(tx) <= 0) toast('Exact — close the drawer.');
        }
        return;
      }
      if (from === 'hand' && overDrawer) {
        const res = returnToDrawer(tx, drawer, d);
        if (res.ok) {
          root.remove(m);
          handMeshes = handMeshes.filter((x) => x !== m);
          refillDrawerMoney();
          layHand();
          sfx(BILLS.includes(d) ? 'paper' : 'coin');
          drawScreen();
        }
        return;
      }
      // anywhere else: it settles on the counter where it is
      m.position.y = COUNTER_TOP + 0.006;
      return;
    }

    if (k === 'receipt') {
      m.position.y = COUNTER_TOP + 0.01;
    }
  }

  // click, rather than drag: the things that are switches, not objects
  function clickAt(o) {
    if (!tx) return false;
    const k = o.userData.kind;

    if (k === 'terminal') { tapTerminal(); return true; }
    if (k === 'total') { totalUp(); return true; }
    if (k === 'pull') { toggleDrawer(); return true; }

    if (o.userData.kind === 'palm') {
      // handing change back
      if (tx.stage === 'cash-drawer' && tx.deposited) {
        const res = handOverChange(tx, drawer);
        if (!res.ok) { toast(res.reason, 'warn'); sfx('thunk'); return true; }
        for (const m of handMeshes) root.remove(m);
        handMeshes = [];
        drawerWant = 0;
        sfx('drawer');
        if (res.lost > 0) toast(`You handed over $${res.lost.toFixed(2)} too much.`, 'warn');
        else if (res.lost < 0) toast(`You shorted them $${Math.abs(res.lost).toFixed(2)}.`, 'warn');
        palm.visible = false;
        drawScreen();
        return true;
      }
      // handing over the bag
      if (tx.stage === 'bagging' && allBagged(tx) && !receiptMesh) {
        const done = handOverGoods(tx);
        if (!done.ok) { toast(done.reason, 'warn'); return true; }
        finish();
        return true;
      }
      if (tx.stage === 'bagging' && receiptMesh) { toast('Take the receipt first.', 'warn'); return true; }
      return true;
    }

    if (o.userData.kind === 'money' && o.userData.from === 'drawer') {
      if (!tx.drawerOpen) { toast('Open the drawer first.', 'warn'); return true; }
      const d = o.userData.denom;
      const res = takeFromDrawer(tx, drawer, d);
      if (!res.ok) { toast(res.reason, 'warn'); return true; }
      const m = makePiece(d);
      m.userData.from = 'hand';
      handMeshes.push(m);
      root.add(m);
      layHand();
      refillDrawerMoney();
      sfx(BILLS.includes(d) ? 'paper' : 'coin');
      drawScreen();
      if (changeDue(tx) > 0 && handTotal(tx) >= changeDue(tx)) palm.visible = true;
      return true;
    }

    if (o.userData.kind === 'money' && o.userData.from === 'hand') {
      const d = o.userData.denom;
      const res = returnToDrawer(tx, drawer, d);
      if (!res.ok) return true;
      root.remove(o);
      handMeshes = handMeshes.filter((x) => x !== o);
      refillDrawerMoney();
      layHand();
      sfx(BILLS.includes(d) ? 'paper' : 'coin');
      drawScreen();
      return true;
    }

    if (o.userData.kind === 'receipt') {
      const res = takeReceipt(tx);
      if (!res.ok) { toast(res.reason, 'warn'); return true; }
      root.remove(receiptMesh);
      receiptMesh = null;
      sfx('paper');
      toast('Receipt taken — now bag the goods.');
      drawScreen();
      return true;
    }
    return false;
  }

  // the sale is over: bank it, and let the customer go
  function finish() {
    const res = completeSale(state, tx, cust ? cust.name : 'A customer');
    if (!res.ok) { toast(res.reason, 'warn'); return; }
    sfx('chime');
    const bits = [`$${res.total.toFixed(2)} taken`];
    if (res.lost) bits.push(res.lost > 0 ? `till short $${res.lost.toFixed(2)}` : `shorted them $${Math.abs(res.lost).toFixed(2)}`);
    toast(`${cust ? cust.name : 'They'} paid — ${bits.join(' · ')}.`);
    if (cust && cust.onPaid) cust.onPaid(tx);
    const done = cust;
    abandon();
    if (done) done.paid = true;
    leave();
  }

  // ============================================================ INPUT ==========

  function onDown(e) {
    if (transitionBlock > 0) return;
    if (!active) return false;
    setNdc(e);
    if (e.button === 2) { leave(); return true; }
    const o = pickUnder();
    if (!o) return true;

    // PUTTING YOUR HAND ON THEIR CASH IS ACCEPTING IT. There is no separate "accept"
    // verb, because in a shop there isn't one: you reach out and take the notes.
    if (o.userData.kind === 'money' && o.userData.from === 'tender'
        && tx && tx.stage === 'cash-tender') takeTender();

    if (clickAt(o)) return true;
    // not a switch → it is an object you can move
    if (o.userData.kind === 'item' || (o.userData.kind === 'money' && o.userData.from !== 'drawer')) grab(o);
    return true;
  }

  function onMove(e) {
    if (transitionBlock > 0) return;
    if (!active) return false;
    setNdc(e);
    return true;
  }

  function onUp() {
    if (transitionBlock > 0) return;
    if (!active) return false;
    release();
    return true;
  }

  // TOTAL. On a real till this is a key you press, so here it is a key you press AND
  // a spot on the register you click. It is the moment the customer reaches for their
  // money, so it is also the moment the money becomes real objects on the counter.
  function totalUp() {
    if (!tx) return;
    const res = requestPayment(tx);
    if (!res.ok) { toast(res.reason, 'warn'); sfx('thunk'); return; }
    sfx('uiTick');
    if (tx.method === 'cash') {
      customerCash(tx);
      tenderMeshes.forEach((m) => root.remove(m));
      tenderMeshes = [];
      let i = 0;
      for (const [d, n] of Object.entries(tx.tendered)) {
        for (let k = 0; k < n; k++) {
          const m = makePiece(Number(d));
          m.userData.from = 'tender';
          m.position.set(
            REGISTER.staging.minX + 0.12 + (i % 4) * 0.085,
            COUNTER_TOP + 0.008 + Math.floor(i / 4) * 0.004,
            REGISTER.staging.maxZ - 0.07,
          );
          m.rotation.y = (i * 0.31) % 0.4 - 0.2;
          root.add(m);
          tenderMeshes.push(m);
          i++;
        }
      }
      sfx('paper');
      toast(`${cust.name} counts out $${stackTotal(tx.tendered).toFixed(2)} — take it and open the drawer.`);
    } else {
      cardMesh = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.002, 0.054), cardMat);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.0012, 0.014), stripeMat);
      st.position.set(0, 0.0016, -0.016);
      cardMesh.add(st);
      cardMesh.position.set(REGISTER.cardterm.x - 0.03, COUNTER_TOP + 0.15, REGISTER.cardterm.z - 0.15);
      root.add(cardMesh);
      toast(`${cust.name} takes out a card — activate the terminal.`);
    }
    drawScreen();
    drawTerm();
  }

  function toggleDrawer() {
    if (!tx) return;
    if (tx.stage !== 'cash-drawer') {
      // the money has to be IN YOUR HAND before the till opens for it
      if (tx.stage === 'cash-tender') toast('Take their money off the counter first.', 'warn');
      else toast('The drawer stays shut.', 'warn');
      sfx('thunk');
      return;
    }
    if (!tx.drawerOpen) {
      if (openDrawer(tx).ok) { drawerWant = 1; sfx('drawer'); }
    } else {
      closeDrawer(tx);
      drawerWant = 0;
      sfx('drawer');
      // shutting the till on an exact-cash sale is what ends it
      if (tx.deposited && changeDue(tx) <= 0) {
        const res = handOverChange(tx, drawer);
        if (res.ok) toast('Exact — no change due.');
      }
    }
    drawScreen();
  }

  // taking the customer's cash off the counter: it stops being theirs and becomes
  // yours to put away
  function takeTender() {
    if (!tx || tx.stage !== 'cash-tender') return false;
    const res = acceptCash(tx);
    if (!res.ok) { toast(res.reason, 'warn'); return false; }
    sfx('paper');
    toast(`Took $${res.taken.toFixed(2)} — open the drawer and put it away.`);
    drawScreen();
    return true;
  }

  function onKey(k) {
    if (transitionBlock > 0 && k !== 'Escape') return;
    if (!active) return false;
    if (k === 'Escape') { leave(); return true; }
    if (!tx) return true;
    if (k === 't' || k === 'T') { totalUp(); return true; }
    if (k === 'd' || k === 'D') { toggleDrawer(); return true; }
    return true;   // behind the till, the till swallows the rest
  }

  // clicking the card terminal — routed in from the clubhouse prop
  function tapTerminal() {
    if (!tx || tx.method !== 'card') return;
    if (tx.stage === 'card-present') {
      presentCard(tx);
      if (cardMesh) {
        cardMesh.position.set(REGISTER.cardterm.x, COUNTER_TOP + 0.09, REGISTER.cardterm.z - 0.01);
      }
      sfx('cardTap');
      toast(`${cust.name} holds the card to the terminal.`);
    } else if (tx.stage === 'card-ready') {
      tx.stage = 'card-busy';
      cardT = CARD_TIME;
      sfx('uiTick');
    } else if (tx.stage === 'card-declined') {
      retryCard(tx);
      toast(`${cust.name} digs out another card.`);
      sfx('uiTick');
    }
    drawScreen();
    drawTerm();
  }

  // ============================================================ FRAME ==========

  function update(dt) {
    if (transitionBlock > 0) transitionBlock = Math.max(0, transitionBlock - dt);
    if (active) focusAnchor(desiredAnchor());
    // the drawer slides
    const target = drawerWant;
    if (Math.abs(drawerAmt - target) > 0.001) {
      drawerAmt += Math.sign(target - drawerAmt) * Math.min(Math.abs(target - drawerAmt), dt * 3.2);
      drawerGroup.position.z = DZ + drawerAmt * REGISTER.drawer.travel;
    }
    if (scanFlash > 0) scanFlash = Math.max(0, scanFlash - dt);

    // the terminal thinks about it
    if (tx && tx.stage === 'card-busy') {
      cardT -= dt;
      if (cardT <= 0) {
        tx.stage = 'card-ready';
        const res = runCard(tx);
        if (res.result === 'approved') {
          sfx('approve');
          toast('Approved.');
        } else {
          sfx('decline');
          toast(`${cust ? cust.name : 'Their'} card was declined — ask for another.`, 'warn');
          if (cardMesh) cardMesh.position.set(REGISTER.cardterm.x - 0.02, COUNTER_TOP + 0.14, REGISTER.cardterm.z - 0.14);
        }
        drawScreen();
        drawTerm();
      }
    }

    // THE PRINTER runs the moment payment clears, whichever way it cleared — an
    // approved card and a counted-out drawer both land on stage 'receipt'. printT
    // is 0 while nothing is pending, so arriving here starts the roll.
    if (tx && tx.stage === 'receipt' && !tx.receiptPrinted) {
      if (printT === 0) printT = 0.8;
      printT -= dt;
      if (printT <= 0) {
        const r = printReceipt(tx);
        if (r.ok) {
          drawReceipt(r.receipt);
          receiptMesh = new THREE.Mesh(RECEIPT_GEO, receiptMat);
          receiptMesh.rotation.x = -Math.PI / 2 + 0.16;
          receiptMesh.position.set(REGISTER.printer.x - 0.02, COUNTER_TOP + 0.10, REGISTER.printer.z - 0.12);
          receiptMesh.userData = { pick: true, kind: 'receipt' };
          root.add(receiptMesh);
          sfx('receipt');
          toast('Receipt printed — take it.');
          drawScreen();
        }
      }
    }

    // the grabbed thing follows the cursor, and its barcode sweeps the scanner
    if (active && grabbed) {
      const p = cursorAt(CARRY_Y);
      if (p) {
        grabbed.position.x = Math.max(COUNTER.x - COUNTER.len / 2 - 0.1, Math.min(COUNTER.x + COUNTER.len / 2 + 0.1, p.x));
        grabbed.position.z = Math.max(COUNTER.z - COUNTER.depth / 2 - 0.15, Math.min(COUNTER.z + COUNTER.depth / 2 + 0.35, p.z));
        grabbed.position.y = CARRY_Y;
      }
      if (grabbed.userData.kind === 'item' && tx && tx.stage === 'scanning') {
        const b = barcodeAt(grabbed);
        // SWEPT, not sampled: a fast flick must not tunnel through the glass
        if (segmentHitsBox(grabPrev, b, REGISTER.scan)) tryScan(grabbed);
        grabPrev.set(b.x, b.y, b.z);
      }
    }

    // THE BAG is the target during bagging, so it says so: a soft ring on the mat that
    // pulses while there are goods still to pack.
    if (bagRing) {
      const want = !!(tx && tx.stage === 'bagging' && !allBagged(tx));
      bagRing.visible = want;
      if (want) bagRing.material.opacity = 0.22 + Math.sin(performance.now() * 0.004) * 0.10;
    }

    // the palm opens when it is waiting for something
    if (tx) {
      const wantsChange = tx.stage === 'cash-drawer' && tx.deposited && changeDue(tx) > 0 && handTotal(tx) > 0;
      const wantsGoods = tx.stage === 'bagging' && allBagged(tx) && !receiptMesh;
      const wantsExact = tx.stage === 'cash-drawer' && tx.deposited && changeDue(tx) <= 0;
      palm.visible = !!(wantsChange || wantsGoods || wantsExact);
      if (palm.visible) {
        palm.material.opacity = 0.35 + Math.sin(performance.now() * 0.005) * 0.12;
      }
    }
  }

  return {
    root,
    screenMaterial,
    termMaterial,
    attachScreen,
    attachTerm,
    isActive: () => active,
    hasTx: () => !!tx,
    getTx: () => tx,
    getCustomer: () => cust,
    getAnchors: () => Object.fromEntries(Object.keys(anchorNodes).map((name) => [name, anchorPose(name)])),
    scanFlash: () => scanFlash,
    begin,
    abandon,
    enter,
    leave,
    update,
    onDown,
    onMove,
    onUp,
    onKey,
    tapTerminal,
    drawScreen,
    // the HUD prompt when you are standing at the counter, out of register mode
    label() {
      if (!tx) return null;
      const left = unscannedCount(tx);
      if (left > 0) return `${cust.name} is waiting — [E] work the register (${left} to scan)`;
      return `${cust.name} is waiting — [E] work the register`;
    },
  };
}
