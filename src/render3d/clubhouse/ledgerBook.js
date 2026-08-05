// THE LEDGER BOOK (L3, per task #127's ruling) — a bound club register on the
// front desk. A PROP, not a stat screen: it lies closed on the counter, opens
// in place when the player presses E, and turns physical pages. It records
// what the game tracks (src/sim/clubRoster.js — the identity directory's own
// visit history): each golfer's signature, first visit, rounds and last
// visit. Blank ruled pages are a legitimate day-one state.
//
// Open/close is a visibility swap between a closed body and an open spread,
// timed under the camera's focus ease so the book reads as opened during the
// lean-in. Page turns animate a single leaf about the spine; the underlying
// page canvases swap at the vertical.

import { rosterEntries, rosterDateLabel } from '../../sim/clubRoster.js';

// LANDSCAPE, like the page itself: from the reading pose each page is wider
// than deep, and the first portrait canvas rendered its ledger lines squashed
// 2.4:1 and rotated 90 degrees from the reader (photographed, 03-signed.png
// of the first run). Canvas X runs across the spread, canvas Y toward the
// reader.
const PAGE_W = 768;
const PAGE_H = 512;
const ROWS_PER_PAGE = 6;
const LEAF_SECONDS = 0.38;

export function createLedgerBook({ THREE, state, anchor, counterTop, onPlaced = null }) {
  const root = new THREE.Group();
  root.name = 'FrontDeskLedgerBook';
  // The book is MOVEABLE (ruled 2026-08-05): the anchor is only where a new
  // club finds it. Once the player carries it somewhere, the spot persists in
  // state.shop.ledgerSpot and wins on every later boot.
  const savedSpot = state?.shop?.ledgerSpot;
  const spawn = savedSpot && Number.isFinite(savedSpot.x) && Number.isFinite(savedSpot.z)
    ? savedSpot
    : { x: anchor.x, z: anchor.z, y: counterTop, ry: anchor.ry || 0 };
  root.position.set(spawn.x, Number.isFinite(spawn.y) ? spawn.y : counterTop, spawn.z);
  root.rotation.y = spawn.ry || 0;

  // ---- materials -----------------------------------------------------------
  const leather = new THREE.MeshStandardMaterial({ color: 0x24382e, roughness: 0.72, metalness: 0.04 });
  const leatherDark = new THREE.MeshStandardMaterial({ color: 0x18271f, roughness: 0.78, metalness: 0.04 });
  const pageEdge = new THREE.MeshStandardMaterial({ color: 0xe6dcc2, roughness: 0.92, metalness: 0 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb58a42, roughness: 0.42, metalness: 0.55 });

  // ---- the closed book -----------------------------------------------------
  // 0.30 x 0.22 footprint, 0.034 thick: a real ledger, readable as one from
  // the working frame.
  const closed = new THREE.Group();
  closed.name = 'LedgerClosed';
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.008, 0.22), leather);
  cover.position.y = 0.030;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.006, 0.22), leather);
  back.position.y = 0.003;
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.284, 0.020, 0.206), pageEdge);
  block.position.y = 0.016;
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.036, 0.224), leatherDark);
  spine.position.set(-0.148, 0.018, 0);
  const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.010, 0.028), brass);
  clasp.position.set(0.146, 0.018, 0);
  const titlePlate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.05),
    new THREE.MeshStandardMaterial({ map: coverPlateTexture(THREE), roughness: 0.6, metalness: 0.1 }),
  );
  titlePlate.rotation.x = -Math.PI / 2;
  titlePlate.position.set(0.012, 0.0345, 0);
  closed.add(cover, back, block, spine, clasp, titlePlate);
  root.add(closed);

  // ---- the open spread -----------------------------------------------------
  const open = new THREE.Group();
  open.name = 'LedgerOpen';
  open.visible = false;
  const boardLeft = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.006, 0.22), leather);
  boardLeft.position.set(-0.152, 0.003, 0);
  const boardRight = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.006, 0.22), leather);
  boardRight.position.set(0.152, 0.003, 0);
  const stackLeft = new THREE.Mesh(new THREE.BoxGeometry(0.284, 0.009, 0.206), pageEdge);
  stackLeft.position.set(-0.150, 0.0105, 0);
  const stackRight = new THREE.Mesh(new THREE.BoxGeometry(0.284, 0.009, 0.206), pageEdge);
  stackRight.position.set(0.150, 0.0105, 0);
  open.add(boardLeft, boardRight, stackLeft, stackRight);

  const makePageFace = () => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.276, 0.190),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    // face up, with the canvas TOP at the page's far edge from the reader
    // (the reading pose stands at local -z): rotateX lays it flat, rotateZ PI
    // turns the text upright for that reader
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.PI;
    return { canvas, texture, mesh };
  };
  const leftFace = makePageFace();
  leftFace.mesh.position.set(-0.150, 0.0155, 0);
  const rightFace = makePageFace();
  rightFace.mesh.position.set(0.150, 0.0155, 0);
  open.add(leftFace.mesh, rightFace.mesh);

  // the turning leaf: pivoted at the spine, textures on both faces
  const leafPivot = new THREE.Group();
  leafPivot.position.set(0, 0.017, 0);
  const leafFront = makePageFace();
  leafFront.mesh.rotation.set(-Math.PI / 2, 0, Math.PI);
  leafFront.mesh.position.set(0.150, 0.0012, 0);
  const leafBack = makePageFace();
  leafBack.mesh.rotation.set(Math.PI / 2, 0, Math.PI);
  leafBack.mesh.position.set(0.150, -0.0012, 0);
  leafPivot.add(leafFront.mesh, leafBack.mesh);
  leafPivot.visible = false;
  open.add(leafPivot);
  root.add(open);

  // ---- page painting -------------------------------------------------------
  function coverPlateTexture(three) {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#b58a42';
    ctx.fillRect(0, 0, 300, 100);
    ctx.strokeStyle = '#7d5c26';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 284, 84);
    ctx.fillStyle = '#2c2313';
    ctx.font = '700 34px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CLUB REGISTER', 150, 52);
    const texture = new three.CanvasTexture(canvas);
    texture.colorSpace = three.SRGBColorSpace;
    return texture;
  }

  function paintPage(face, { pageIndex, entries, title = false, clubName = '' }) {
    const ctx = face.canvas.getContext('2d');
    ctx.fillStyle = '#efe6cd';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    // paper tone: a faint aged edge
    const edge = ctx.createLinearGradient(0, 0, PAGE_W, 0);
    edge.addColorStop(0, 'rgba(120,96,58,0.10)');
    edge.addColorStop(0.12, 'rgba(120,96,58,0)');
    edge.addColorStop(0.88, 'rgba(120,96,58,0)');
    edge.addColorStop(1, 'rgba(120,96,58,0.10)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    if (title) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#3a4a40';
      ctx.font = '700 52px Georgia, serif';
      ctx.fillText('CLUB REGISTER', PAGE_W / 2, 170);
      ctx.font = 'italic 400 32px Georgia, serif';
      ctx.fillText(clubName, PAGE_W / 2, 230);
      ctx.strokeStyle = '#b58a42';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(140, 274);
      ctx.lineTo(PAGE_W - 140, 274);
      ctx.stroke();
      ctx.fillStyle = '#6b7268';
      ctx.font = '400 26px Georgia, serif';
      ctx.fillText('Guests of the club sign below after their first round.', PAGE_W / 2, 340);
      face.texture.needsUpdate = true;
      return 0;
    }

    // one line per golfer: signature | first visit | last seen | rounds
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8a8272';
    ctx.font = '700 19px Georgia, serif';
    ctx.fillText('SIGNATURE', 44, 58);
    ctx.fillText('FIRST VISIT', 372, 58);
    ctx.fillText('LAST SEEN', 532, 58);
    ctx.fillText('ROUNDS', 676, 58);
    ctx.strokeStyle = 'rgba(90,80,58,0.45)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(36, 74);
    ctx.lineTo(PAGE_W - 36, 74);
    ctx.stroke();

    const rowHeight = (PAGE_H - 96) / ROWS_PER_PAGE;
    let painted = 0;
    for (let row = 0; row < ROWS_PER_PAGE; row += 1) {
      const y = 82 + (row + 1) * rowHeight;
      ctx.strokeStyle = 'rgba(90,80,58,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(36, y);
      ctx.lineTo(PAGE_W - 36, y);
      ctx.stroke();
      const entry = entries[pageIndex * ROWS_PER_PAGE + row];
      if (!entry) continue;
      painted += 1;
      // the signature: the golfer's own hand, in ink
      ctx.fillStyle = '#2c3e50';
      ctx.font = 'italic 700 30px Georgia, serif';
      ctx.fillText(fitLine(ctx, entry.name, 300), 44, y - 14);
      ctx.fillStyle = '#4a5248';
      ctx.font = '400 21px Georgia, serif';
      ctx.fillText(rosterDateLabel(entry.firstVisitDayAbs), 372, y - 18);
      ctx.fillText(rosterDateLabel(entry.lastVisitDayAbs), 532, y - 18);
      ctx.textAlign = 'center';
      ctx.font = '700 26px Georgia, serif';
      ctx.fillText(String(entry.visits), 706, y - 18);
      ctx.textAlign = 'left';
    }
    face.texture.needsUpdate = true;
    return painted;
  }

  function fitLine(ctx, value, maxWidth) {
    let text = String(value || '');
    while (text.length > 2 && ctx.measureText(text).width > maxWidth) text = text.slice(0, -1);
    return text === String(value || '') ? text : `${text}…`;
  }

  // ---- state ---------------------------------------------------------------
  let isOpen = false;
  let carried = false;
  let spread = 0; // 0 = title + first entry page
  let leaf = null; // { direction, t }
  let lastPaint = { entries: 0, spread: 0, painted: 0, contentReady: false };

  function entriesNow() {
    try {
      return rosterEntries(state);
    } catch {
      return [];
    }
  }

  function spreadCount(entries) {
    // spread 0: title | page 0. spread N: page 2N-1 | page 2N.
    const pages = Math.max(1, Math.ceil(Math.max(1, entries.length) / ROWS_PER_PAGE));
    return Math.max(1, Math.ceil((pages + 1) / 2));
  }

  function paintSpread() {
    const entries = entriesNow();
    const clubName = state?.club?.name || state?.shop?.name || 'Pine Hills Municipal Golf';
    let painted = 0;
    if (spread === 0) {
      paintPage(leftFace, { title: true, clubName, entries, pageIndex: 0 });
      painted += paintPage(rightFace, { entries, pageIndex: 0 });
    } else {
      painted += paintPage(leftFace, { entries, pageIndex: spread * 2 - 1 });
      painted += paintPage(rightFace, { entries, pageIndex: spread * 2 });
    }
    lastPaint = {
      entries: entries.length,
      spread,
      painted,
      // the content-ready predicate: the CANVASES were painted from the live
      // roster for this spread — not merely "the book is open"
      contentReady: true,
    };
    return lastPaint;
  }

  function setOpen(next) {
    if (next === isOpen) return isOpen;
    if (next && carried) return isOpen; // a book in your arms is not a book on a desk
    isOpen = !!next;
    if (isOpen) {
      spread = 0;
      paintSpread();
    }
    closed.visible = !isOpen;
    open.visible = isOpen;
    leafPivot.visible = false;
    leaf = null;
    return isOpen;
  }

  function turnPage(direction) {
    if (!isOpen || leaf) return false;
    const entries = entriesNow();
    const total = spreadCount(entries);
    const next = spread + (direction > 0 ? 1 : -1);
    if (next < 0 || next >= total) return false;
    // the leaf carries the CURRENT right page on its front and the NEXT left
    // page on its back (or the reverse when turning backward)
    const clubName = state?.club?.name || state?.shop?.name || 'Pine Hills Municipal Golf';
    if (direction > 0) {
      paintPage(leafFront, { entries, pageIndex: spread === 0 ? 0 : spread * 2 });
      paintPage(leafBack, { entries, pageIndex: next * 2 - 1 });
    } else {
      paintPage(leafFront, { entries, pageIndex: next === 0 ? 0 : next * 2 });
      paintPage(leafBack, { entries, pageIndex: spread * 2 - 1 });
    }
    spread = next;
    // repaint the pages that will be revealed under the moving leaf
    if (spread === 0) {
      paintPage(leftFace, { title: true, clubName, entries, pageIndex: 0 });
      paintPage(rightFace, { entries, pageIndex: 0 });
    } else {
      paintPage(leftFace, { entries, pageIndex: spread * 2 - 1 });
      paintPage(rightFace, { entries, pageIndex: spread * 2 });
    }
    lastPaint = { entries: entries.length, spread, painted: lastPaint.painted, contentReady: true };
    leaf = { direction: direction > 0 ? 1 : -1, t: 0 };
    leafPivot.visible = true;
    leafPivot.rotation.z = leaf.direction > 0 ? 0 : Math.PI;
    return true;
  }

  function update(dt) {
    if (!leaf) return;
    leaf.t += dt / LEAF_SECONDS;
    const eased = leaf.t >= 1 ? 1 : 1 - (1 - leaf.t) ** 2;
    leafPivot.rotation.z = leaf.direction > 0 ? eased * Math.PI : (1 - eased) * Math.PI;
    if (leaf.t >= 1) {
      leaf = null;
      leafPivot.visible = false;
    }
  }

  // the reading pose: eye above the open spread on the staff side, looking
  // down the page — derived from the book's own transform like the laptop's
  // seat, so a layout move never orphans it
  function readPose() {
    root.updateWorldMatrix(true, false);
    const centre = root.localToWorld(new THREE.Vector3(0, 0.02, 0));
    const staffSide = new THREE.Vector3(0, 0, -0.34).applyQuaternion(root.quaternion);
    const eye = centre.clone().add(staffSide).add(new THREE.Vector3(0, 0.52, 0));
    const forward = centre.clone().sub(eye).normalize();
    return {
      x: eye.x,
      y: eye.y,
      z: eye.z,
      yaw: Math.atan2(-forward.x, -forward.z),
      pitch: Math.asin(Math.max(-1, Math.min(1, forward.y))),
    };
  }

  // ---- carrying ------------------------------------------------------------
  function setCarried(next) {
    if (next && isOpen) setOpen(false);
    carried = !!next;
    if (carried) root.rotation.x = 0.14; // hugged slightly toward the chest
    else root.rotation.x = 0;
    return carried;
  }

  // per-frame while carried: the caller (clubhouse update) hands the hold
  // pose in interior-local coordinates
  function followCarry(pose) {
    if (!carried || !pose) return;
    root.position.set(pose.x, pose.y, pose.z);
    root.rotation.y = pose.ry || 0;
  }

  function placeAt(spot) {
    carried = false;
    root.rotation.x = 0;
    const y = Number.isFinite(spot.y) ? spot.y : counterTop;
    root.position.set(spot.x, y, spot.z);
    root.rotation.y = spot.ry || 0;
    if (onPlaced) onPlaced({ x: spot.x, z: spot.z, y, ry: spot.ry || 0 });
    return { x: spot.x, z: spot.z, y, ry: spot.ry || 0 };
  }

  return {
    root,
    setOpen,
    isOpen: () => isOpen,
    setCarried,
    isCarried: () => carried,
    followCarry,
    placeAt,
    position: () => ({ x: root.position.x, y: root.position.y, z: root.position.z }),
    turnPage,
    update,
    readPose,
    diagnostics: () => ({
      open: isOpen,
      carried,
      spread,
      spreadCount: spreadCount(entriesNow()),
      turning: !!leaf,
      ...lastPaint,
    }),
  };
}
