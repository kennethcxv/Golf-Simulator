// THE KEEPER'S JOURNAL (L3 + the 2026-08-05 book ruling) — a real bound book
// on the front desk. Ruled: "make the book more like an actual book... when
// the player clicks E on it it opens up and gets closer to the face... a full
// book with a cover and multiple pages with locked things."
//
// So: E does not teleport a spread onto the desk. The book RISES to the
// player's face (the card reader's comes-to-you pattern — the camera holds
// still, per the register's stillness doctrine), the brass clasp frees, the
// COVER swings open, a couple of leaves riffle and settle, and the journal
// hangs there like something held. Pages turn about the spine with the paper
// cue. Closing reverses the whole beat and lays it back where it was picked
// up — including wherever the player has carried it ([X]/[Z], persisted).
//
// The content is the club's own working record, every page a LENS on state
// the sim already keeps (src/sim/clubRoster.js — the NamedGolfers spec's
// load-bearing rule): the guest register, house notes, the day sheet, the
// takings, and two LOCKED sections (course log, champions) the reader can
// turn to but not read yet. Locks withhold content; they never grant
// anything.

import {
  rosterEntries, rosterDateLabel, houseNotes,
  daySheetSummary, takingsSummary, journalSections,
} from '../../sim/clubRoster.js';

const PAGE_W = 768;
const PAGE_H = 512;
const ROWS_PER_PAGE = 6;
const NOTES_PER_PAGE = 7;
const LEAF_SECONDS = 0.38;
const OPEN_SECONDS = 0.85;
const CLOSE_SECONDS = 0.65;
const FACE_DISTANCE = 0.50;   // metres ahead of the eye
const FACE_DROP = 0.11;       // below the view axis, like a held journal
const FACE_TILT = 1.12;       // radians the spread leans up toward the eye
const FOLLOW_RATE = 9;        // 1/s soft-follow while open

const smoothstep = (t) => t * t * (3 - 2 * t);

export function createLedgerBook({ THREE, state, anchor, counterTop, camera = null, sfx = null, onPlaced = null }) {
  const root = new THREE.Group();
  root.name = 'FrontDeskLedgerBook';
  // The book is MOVEABLE: the anchor is only where a new club finds it. Once
  // the player carries it somewhere, the spot persists in
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
  const endpaper = new THREE.MeshStandardMaterial({ color: 0xded2b4, roughness: 0.9, metalness: 0 });
  const pageEdge = new THREE.MeshStandardMaterial({ color: 0xe6dcc2, roughness: 0.92, metalness: 0 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb58a42, roughness: 0.42, metalness: 0.55 });
  const ribbonMat = new THREE.MeshStandardMaterial({
    color: 0x2f5c46, roughness: 0.6, metalness: 0, side: THREE.DoubleSide,
  });

  // ---- the body ------------------------------------------------------------
  // Base board and the right half of the page block never move. The COVER is
  // a hinged assembly at the spine carrying the top board, the title plate
  // and its half of the clasp; opening swings it through PI to lie flat on
  // the left, exactly as a book does.
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.006, 0.22), leather);
  back.position.y = 0.003;
  const blockRight = new THREE.Mesh(new THREE.BoxGeometry(0.284, 0.018, 0.206), pageEdge);
  blockRight.position.set(0.002, 0.015, 0);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.040, 0.224), leatherDark);
  // VERIFY2_L: the first build hinged the book mirror-image and the open
  // spread read RIGHT-TO-LEFT from the reading pose (photographed). The
  // reader faces local -z, so their LEFT is local +x: spine at +x, clasp and
  // fore-edge at -x, cover swinging -x over to +x.
  spine.position.set(0.152, 0.019, 0);
  const claspBase = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.030), brass);
  claspBase.position.set(-0.150, 0.012, 0);
  root.add(back, blockRight, spine, claspBase);

  const coverPivot = new THREE.Group();
  coverPivot.position.set(0.146, 0.028, 0);
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.008, 0.22), leather);
  cover.position.set(-0.15, 0.004, 0);
  const coverInner = new THREE.Mesh(new THREE.PlaneGeometry(0.284, 0.206), endpaper);
  coverInner.rotation.x = Math.PI / 2; // faces down while closed, up when opened over
  coverInner.position.set(-0.15, -0.0005, 0);
  const titlePlate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.05),
    new THREE.MeshStandardMaterial({ map: coverPlateTexture(THREE), roughness: 0.6, metalness: 0.1 }),
  );
  titlePlate.rotation.x = -Math.PI / 2;
  titlePlate.position.set(-0.162, 0.0085, 0);
  const claspStrap = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.006, 0.028), brass);
  claspStrap.position.set(-0.298, -0.004, 0);
  coverPivot.add(cover, coverInner, titlePlate, claspStrap);
  root.add(coverPivot);

  // ---- the open spread -----------------------------------------------------
  const openGroup = new THREE.Group();
  openGroup.visible = false;
  // open anatomy: the spine (x +0.152) is the MIDDLE of the spread - the
  // left page stack lies over the swung cover beside it, the right stack is
  // the block that never moved. The first at-face build kept closed-book
  // coordinates and the left page hid UNDER the cover (photographed).
  // the left stack RESTS ON the swung cover (its inner face tops out at
  // y~0.028), not at desk-stack height - the first fix left it buried
  const blockLeft = new THREE.Mesh(new THREE.BoxGeometry(0.284, 0.010, 0.206), pageEdge);
  blockLeft.position.set(0.294, 0.034, 0);
  openGroup.add(blockLeft);

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
    // face up, canvas top at the page's far edge from the reader (who stands
    // at local -z when it lies on the desk, and faces it when held up)
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.PI;
    return { canvas, texture, mesh };
  };
  const leftFace = makePageFace();
  leftFace.mesh.position.set(0.294, 0.0398, 0);
  const rightFace = makePageFace();
  rightFace.mesh.position.set(0.002, 0.0255, 0);
  openGroup.add(leftFace.mesh, rightFace.mesh);

  // the turning leaf, pivoted at the spine
  const leafPivot = new THREE.Group();
  leafPivot.position.set(0.152, 0.033, 0);
  const leafFront = makePageFace();
  leafFront.mesh.rotation.set(-Math.PI / 2, 0, Math.PI);
  leafFront.mesh.position.set(-0.150, 0.0012, 0);
  const leafBack = makePageFace();
  leafBack.mesh.rotation.set(Math.PI / 2, 0, Math.PI);
  leafBack.mesh.position.set(-0.150, -0.0012, 0);
  leafPivot.add(leafFront.mesh, leafBack.mesh);
  leafPivot.visible = false;
  openGroup.add(leafPivot);

  // two blank riffle leaves that flutter home as the cover lands
  const riffles = [];
  for (let i = 0; i < 2; i += 1) {
    const pivot = new THREE.Group();
    pivot.position.set(0.152, 0.032 + i * 0.0015, 0);
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(0.276, 0.190),
      new THREE.MeshStandardMaterial({ color: 0xefe6cd, roughness: 0.95, side: THREE.DoubleSide }),
    );
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.set(-0.15, 0, 0);
    pivot.add(sheet);
    pivot.visible = false;
    openGroup.add(pivot);
    riffles.push({ pivot, t: -1, delay: 0.10 + i * 0.16 });
  }

  // the bookmark ribbon, draped over the right page
  const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.16), ribbonMat);
  ribbon.rotation.x = -Math.PI / 2;
  ribbon.rotation.z = 0.06;
  ribbon.position.set(0.128, 0.0285, 0.055);
  ribbon.visible = false;
  openGroup.add(ribbon);
  root.add(openGroup);

  // ---- textures ------------------------------------------------------------
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

  function paperGround(ctx) {
    ctx.fillStyle = '#efe6cd';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    const edge = ctx.createLinearGradient(0, 0, PAGE_W, 0);
    edge.addColorStop(0, 'rgba(120,96,58,0.10)');
    edge.addColorStop(0.12, 'rgba(120,96,58,0)');
    edge.addColorStop(0.88, 'rgba(120,96,58,0)');
    edge.addColorStop(1, 'rgba(120,96,58,0.10)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  }

  function pageHeader(ctx, title) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#8a8272';
    ctx.font = '700 24px Georgia, serif';
    ctx.fillText(title, 44, 64);
    ctx.strokeStyle = 'rgba(90,80,58,0.45)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(36, 82);
    ctx.lineTo(PAGE_W - 36, 82);
    ctx.stroke();
  }

  function pageFooter(ctx, index) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9a927e';
    ctx.font = '400 18px Georgia, serif';
    ctx.fillText(String(index), PAGE_W / 2, PAGE_H - 22);
  }

  function fitLine(ctx, value, maxWidth) {
    let text = String(value || '');
    while (text.length > 2 && ctx.measureText(text).width > maxWidth) text = text.slice(0, -1);
    return text === String(value || '') ? text : `${text}…`;
  }

  const hourLabel = (minute) => {
    if (!Number.isFinite(minute)) return 'none today';
    const h = Math.floor(minute / 60);
    const m = minute % 60;
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const money = (value) => `$${(Number(value) || 0).toFixed(2)}`;

  // ---- the page painters ---------------------------------------------------
  function paintContents(face, clubName, sections, pageOfSection) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3a4a40';
    ctx.font = '700 46px Georgia, serif';
    ctx.fillText('CLUB REGISTER', PAGE_W / 2, 120);
    ctx.font = 'italic 400 28px Georgia, serif';
    ctx.fillText(clubName, PAGE_W / 2, 164);
    ctx.strokeStyle = '#b58a42';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(150, 198);
    ctx.lineTo(PAGE_W - 150, 198);
    ctx.stroke();
    // the table of contents IS the pitch: what the book holds, and what is
    // still locked - the chase on page one
    let y = 254;
    for (const section of sections) {
      ctx.textAlign = 'left';
      ctx.fillStyle = section.locked ? '#8a8272' : '#3f4a42';
      ctx.font = section.locked ? 'italic 400 25px Georgia, serif' : '400 25px Georgia, serif';
      ctx.fillText(section.title, 120, y);
      ctx.textAlign = 'right';
      if (section.locked) {
        // a small drawn padlock, not an emoji
        const lx = PAGE_W - 138;
        ctx.strokeStyle = '#8a8272';
        ctx.lineWidth = 3;
        ctx.strokeRect(lx, y - 16, 16, 12);
        ctx.beginPath();
        ctx.arc(lx + 8, y - 16, 6, Math.PI, 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#6b7268';
        ctx.font = '400 22px Georgia, serif';
        ctx.fillText(String(pageOfSection[section.id] ?? ''), PAGE_W - 120, y);
      }
      ctx.strokeStyle = 'rgba(90,80,58,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(120, y + 10);
      ctx.lineTo(PAGE_W - 120, y + 10);
      ctx.stroke();
      y += 42;
    }
    face.texture.needsUpdate = true;
    return sections.length;
  }

  function paintGuests(face, entries, guestPage, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'GUEST REGISTER');
    ctx.fillStyle = '#8a8272';
    ctx.font = '700 19px Georgia, serif';
    ctx.fillText('SIGNATURE', 44, 112);
    ctx.fillText('FIRST VISIT', 372, 112);
    ctx.fillText('LAST SEEN', 532, 112);
    ctx.fillText('ROUNDS', 676, 112);
    const rowHeight = (PAGE_H - 158) / ROWS_PER_PAGE;
    let painted = 0;
    for (let row = 0; row < ROWS_PER_PAGE; row += 1) {
      const y = 122 + (row + 1) * rowHeight;
      ctx.strokeStyle = 'rgba(90,80,58,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(36, y);
      ctx.lineTo(PAGE_W - 36, y);
      ctx.stroke();
      const entry = entries[guestPage * ROWS_PER_PAGE + row];
      if (!entry) continue;
      painted += 1;
      ctx.fillStyle = '#2c3e50';
      ctx.font = 'italic 700 28px Georgia, serif';
      ctx.fillText(fitLine(ctx, entry.name, 300), 44, y - 12);
      ctx.fillStyle = '#4a5248';
      ctx.font = '400 20px Georgia, serif';
      ctx.fillText(rosterDateLabel(entry.firstVisitDayAbs), 372, y - 15);
      ctx.fillText(rosterDateLabel(entry.lastVisitDayAbs), 532, y - 15);
      ctx.textAlign = 'center';
      ctx.font = '700 25px Georgia, serif';
      ctx.fillText(String(entry.visits), 706, y - 15);
      ctx.textAlign = 'left';
    }
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return painted;
  }

  function paintNotes(face, notes, notesPage, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'HOUSE NOTES');
    let y = 134;
    let written = 0;
    const from = notesPage * NOTES_PER_PAGE;
    for (const note of notes.slice(from, from + NOTES_PER_PAGE)) {
      if (note.outstanding) {
        ctx.fillStyle = '#7a4a34';
        ctx.fillRect(44, y - 15, 10, 10);
        ctx.fillStyle = '#3f4a42';
        ctx.font = '400 24px Georgia, serif';
        ctx.fillText(fitLine(ctx, note.text, PAGE_W - 120), 68, y);
      } else {
        ctx.fillStyle = '#6b7268';
        ctx.font = 'italic 400 24px Georgia, serif';
        ctx.fillText(fitLine(ctx, note.text, PAGE_W - 100), 44, y);
      }
      written += 1;
      y += 54;
    }
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return written;
  }

  function paintDaySheet(face, day, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'DAY SHEET');
    ctx.fillStyle = '#3a4a40';
    ctx.font = 'italic 700 30px Georgia, serif';
    ctx.fillText(day.dateLabel || 'Today', 44, 136);
    const rows = [
      ['Tee times filled', `${day.filledSlots} of ${day.slotCount}`],
      ['Players booked', String(day.bookedPlayers)],
      ['Rounds played', String(day.played)],
      ['Next open time', hourLabel(day.nextOpenMinute)],
    ];
    let y = 200;
    for (const [label, value] of rows) {
      ctx.fillStyle = '#6b7268';
      ctx.font = '400 24px Georgia, serif';
      ctx.fillText(label, 60, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#2c3e50';
      ctx.font = '700 26px Georgia, serif';
      ctx.fillText(value, PAGE_W - 80, y);
      ctx.textAlign = 'left';
      ctx.strokeStyle = 'rgba(90,80,58,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(60, y + 14);
      ctx.lineTo(PAGE_W - 80, y + 14);
      ctx.stroke();
      y += 62;
    }
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return rows.length;
  }

  function paintTakings(face, takings, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'TAKINGS');
    const rows = [
      ['Green fees', money(takings.greenFees)],
      ['Shop sales', money(takings.shopSales)],
      ['Everything else', money(takings.otherRevenue)],
      ['Taken today', money(takings.revenueTotal)],
      ['Spent today', money(takings.expenseTotal)],
    ];
    let y = 160;
    for (const [index, [label, value]] of rows.entries()) {
      const strong = index === 3;
      ctx.fillStyle = strong ? '#3f4a42' : '#6b7268';
      ctx.font = `${strong ? 700 : 400} 24px Georgia, serif`;
      ctx.fillText(label, 60, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#2c3e50';
      ctx.font = `${strong ? 700 : 400} 26px Georgia, serif`;
      ctx.fillText(value, PAGE_W - 80, y);
      ctx.textAlign = 'left';
      ctx.strokeStyle = index === 2 ? 'rgba(90,80,58,0.5)' : 'rgba(90,80,58,0.22)';
      ctx.lineWidth = index === 2 ? 1.8 : 1;
      ctx.beginPath();
      ctx.moveTo(60, y + 14);
      ctx.lineTo(PAGE_W - 80, y + 14);
      ctx.stroke();
      y += 56;
    }
    const ahead = takings.net >= 0;
    ctx.fillStyle = ahead ? '#2f5c46' : '#7a3a30';
    ctx.font = 'italic 700 28px Georgia, serif';
    ctx.fillText(`${ahead ? 'Ahead' : 'Down'} ${money(Math.abs(takings.net))} on the day.`, 60, y + 12);
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return rows.length;
  }

  function paintLocked(face, section, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(90,80,58,0.55)';
    ctx.font = '700 40px Georgia, serif';
    ctx.fillText(section.title.toUpperCase(), PAGE_W / 2, 130);
    // the strap: a leather band drawn corner to corner with a brass buckle -
    // these pages are tied shut, not missing
    ctx.save();
    ctx.translate(PAGE_W / 2, PAGE_H / 2 + 30);
    ctx.rotate(-0.16);
    ctx.fillStyle = '#3a2f22';
    ctx.fillRect(-PAGE_W / 2 - 40, -26, PAGE_W + 80, 52);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(-PAGE_W / 2 - 40, -26, PAGE_W + 80, 8);
    ctx.fillStyle = '#b58a42';
    ctx.fillRect(-34, -34, 68, 68);
    ctx.fillStyle = '#3a2f22';
    ctx.fillRect(-20, -20, 40, 40);
    ctx.restore();
    ctx.fillStyle = '#6b7268';
    ctx.font = 'italic 400 24px Georgia, serif';
    ctx.fillText(section.lockedLine || 'Not yet.', PAGE_W / 2, PAGE_H - 90);
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return 0;
  }

  function paintBlank(face) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    face.texture.needsUpdate = true;
    return 0;
  }

  // ---- the page model ------------------------------------------------------
  function readModel() {
    let entries = [];
    let notes = [];
    let day = null;
    let takings = null;
    let sections = [];
    try { entries = rosterEntries(state); } catch { entries = []; }
    try { notes = houseNotes(state); } catch { notes = []; }
    try { day = daySheetSummary(state); } catch { day = null; }
    try { takings = takingsSummary(state); } catch { takings = null; }
    try { sections = journalSections(state); } catch { sections = []; }
    const guestPageCount = Math.max(1, Math.ceil(Math.max(1, entries.length) / ROWS_PER_PAGE));
    const pages = [{ kind: 'contents' }];
    const pageOfSection = {};
    pageOfSection.guests = pages.length + 1; // 1-based, printed in the ToC
    for (let p = 0; p < guestPageCount; p += 1) pages.push({ kind: 'guests', guestPage: p });
    // the house section paginates like the guest register - a dilapidated
    // starter has more notes than one page holds, and a note the book never
    // shows is teaching silently thrown away
    const notesPageCount = Math.max(1, Math.ceil(Math.max(1, notes.length) / NOTES_PER_PAGE));
    pageOfSection.house = pages.length + 1;
    for (let p = 0; p < notesPageCount; p += 1) pages.push({ kind: 'notes', notesPage: p });
    pageOfSection.day = pages.length + 1;
    pages.push({ kind: 'day' });
    pageOfSection.takings = pages.length + 1;
    pages.push({ kind: 'takings' });
    for (const section of sections.filter((s) => s.locked)) {
      pageOfSection[section.id] = pages.length + 1;
      pages.push({ kind: 'locked', section });
    }
    return { entries, notes, day, takings, sections, pages, pageOfSection };
  }

  function paintIndexWith(model, face, index) {
    const clubName = state?.club?.name || state?.shop?.name || 'Pine Hills Municipal Golf';
    const page = model.pages[index];
    if (!page) return paintBlank(face);
    switch (page.kind) {
      case 'contents': return paintContents(face, clubName, model.sections, model.pageOfSection);
      case 'guests': return paintGuests(face, model.entries, page.guestPage, index + 1);
      case 'notes': return paintNotes(face, model.notes, page.notesPage, index + 1);
      case 'day': return paintDaySheet(face, model.day || {}, index + 1);
      case 'takings': return paintTakings(face, model.takings || {}, index + 1);
      case 'locked': return paintLocked(face, page.section, index + 1);
      default: return paintBlank(face);
    }
  }

  // ---- state ---------------------------------------------------------------
  let bookState = 'closed'; // closed | opening | open | closing
  let stateT = 0;
  let carried = false;
  let spread = 0;
  let leaf = null;
  let lastPaint = { entries: 0, notes: 0, spread: 0, painted: 0, contentReady: false };
  let model = null;
  let deskSpot = null;   // where the book rose from, to lay it back
  let facePose = null;   // { position: Vector3(world), quaternion }
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchEuler = new THREE.Euler();

  const play = (name) => { if (sfx) sfx(name); };

  function spreadCount() {
    return model ? Math.ceil(model.pages.length / 2) : 1;
  }

  function paintSpread() {
    if (!model) model = readModel();
    let painted = 0;
    painted += paintIndexWith(model, leftFace, spread * 2);
    painted += paintIndexWith(model, rightFace, spread * 2 + 1);
    lastPaint = {
      entries: model.entries.length,
      notes: model.notes.length,
      spread,
      painted,
      // the content-ready predicate: canvases painted from the live model
      // for THIS spread - never merely "the book is open"
      contentReady: true,
    };
    return lastPaint;
  }

  function computeFacePose() {
    if (!camera) return null;
    camera.updateMatrixWorld(true);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const position = eye.clone()
      .addScaledVector(forward, FACE_DISTANCE)
      .add(new THREE.Vector3(0, -FACE_DROP, 0));
    const yaw = Math.atan2(-forward.x, -forward.z);
    // the spread leans up toward the eye like a journal in two hands
    const quaternion = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(FACE_TILT - Math.PI / 2, yaw + Math.PI, 0, 'YXZ'));
    // the open spread's centre is the SPINE (local +0.146), not the root
    // origin - pull the root sideways so the spread sits on the view axis
    const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    position.addScaledVector(localX, -0.146);
    return { position, quaternion };
  }

  function setOpen(next) {
    const wantOpen = !!next;
    const isOpenish = bookState === 'open' || bookState === 'opening';
    if (wantOpen === isOpenish) return isOpenish;
    if (wantOpen) {
      if (carried) return false; // a book in your arms is not a book to read
      model = readModel();
      spread = 0;
      paintSpread();
      // the spot it will return to is where it LAY, never a mid-flight
      // position from a re-open during the close beat
      if (bookState === 'closed' || !deskSpot) {
        deskSpot = {
          x: root.position.x,
          y: root.position.y,
          z: root.position.z,
          ry: root.rotation.y,
        };
      }
      facePose = computeFacePose();
      // reversing mid-close continues from the matching point of the rise
      stateT = bookState === 'closing' ? Math.max(0, 1 - stateT) : 0;
      bookState = 'opening';
      for (const r of riffles) r.t = -1;
      play('paper');
    } else {
      stateT = bookState === 'opening' ? Math.max(0, 1 - stateT) : 0;
      bookState = 'closing';
      leaf = null;
      leafPivot.visible = false;
      play('paper');
    }
    return wantOpen;
  }

  function isOpen() {
    return bookState === 'open' || bookState === 'opening';
  }

  function turnPage(direction) {
    if (bookState !== 'open' || leaf || !model) return false;
    const total = spreadCount();
    const next = spread + (direction > 0 ? 1 : -1);
    if (next < 0 || next >= total) return false;
    if (direction > 0) {
      paintIndexWith(model, leafFront, spread * 2 + 1);
      paintIndexWith(model, leafBack, next * 2);
    } else {
      paintIndexWith(model, leafBack, spread * 2);
      paintIndexWith(model, leafFront, next * 2 + 1);
    }
    spread = next;
    paintSpread();
    leaf = { direction: direction > 0 ? 1 : -1, t: 0 };
    leafPivot.visible = true;
    leafPivot.rotation.z = leaf.direction > 0 ? 0 : -Math.PI;
    play('paper');
    return true;
  }

  function goToSection(sectionId) {
    if (!isOpen() || !model) return false;
    const pageNumber = model.pageOfSection[sectionId];
    if (!Number.isFinite(pageNumber)) return false;
    spread = Math.floor((pageNumber - 1) / 2);
    paintSpread();
    return true;
  }

  function applyClosedPose() {
    coverPivot.rotation.z = 0;
    openGroup.visible = false;
    coverPivot.visible = true;
    claspStrap.visible = true;
    ribbon.visible = false;
  }

  function update(dt) {
    // the leaf turn, whatever else is happening
    if (leaf) {
      leaf.t += dt / LEAF_SECONDS;
      const eased = leaf.t >= 1 ? 1 : 1 - (1 - leaf.t) ** 2;
      leafPivot.rotation.z = leaf.direction > 0 ? -eased * Math.PI : -(1 - eased) * Math.PI;
      if (leaf.t >= 1) {
        leaf = null;
        leafPivot.visible = false;
      }
    }

    if (bookState === 'opening') {
      stateT = Math.min(1, stateT + dt / OPEN_SECONDS);
      const rise = smoothstep(Math.min(1, stateT / 0.75));
      if (facePose && deskSpot) {
        scratchPos.set(deskSpot.x, deskSpot.y, deskSpot.z).lerp(
          root.parent.worldToLocal(facePose.position.clone()),
          rise,
        );
        root.position.copy(scratchPos);
        scratchEuler.set(0, deskSpot.ry, 0, 'YXZ');
        scratchQuat.setFromEuler(scratchEuler);
        root.quaternion.copy(scratchQuat).slerp(facePose.quaternion, rise);
      }
      // the clasp frees early, the cover swings through the middle of the
      // rise, the riffle leaves land as it settles
      if (stateT > 0.12) claspStrap.visible = false;
      const swing = smoothstep(Math.max(0, Math.min(1, (stateT - 0.30) / 0.55)));
      coverPivot.rotation.z = -swing * Math.PI;
      if (swing > 0.12 && !openGroup.visible) openGroup.visible = true;
      if (swing > 0.9) {
        ribbon.visible = true;
        for (const r of riffles) {
          if (r.t < 0 && stateT > 0.62 + r.delay * 0.3) {
            r.t = 0;
            r.pivot.visible = true;
            play('paper');
          }
        }
      }
      if (stateT >= 1) {
        bookState = 'open';
        coverPivot.rotation.z = -Math.PI;
      }
    } else if (bookState === 'open') {
      // soft-follow the face so the journal rides the reader's view without
      // swimming - the card reader's feel, held rather than bolted
      const pose = computeFacePose();
      if (pose && root.parent) {
        const alpha = Math.min(1, FOLLOW_RATE * dt);
        root.position.lerp(root.parent.worldToLocal(pose.position.clone()), alpha);
        root.quaternion.slerp(pose.quaternion, alpha);
      }
    } else if (bookState === 'closing') {
      stateT = Math.min(1, stateT + dt / CLOSE_SECONDS);
      const fall = smoothstep(stateT);
      const swing = 1 - smoothstep(Math.min(1, stateT / 0.6));
      coverPivot.rotation.z = -swing * Math.PI;
      if (swing < 0.12 && openGroup.visible) openGroup.visible = false;
      if (stateT > 0.85) claspStrap.visible = true;
      if (facePose && deskSpot && root.parent) {
        const from = root.parent.worldToLocal(facePose.position.clone());
        scratchPos.copy(from).lerp(new THREE.Vector3(deskSpot.x, deskSpot.y, deskSpot.z), fall);
        root.position.copy(scratchPos);
        scratchEuler.set(0, deskSpot.ry, 0, 'YXZ');
        scratchQuat.setFromEuler(scratchEuler);
        root.quaternion.copy(facePose.quaternion).slerp(scratchQuat, fall);
      }
      if (stateT >= 1) {
        bookState = 'closed';
        applyClosedPose();
        if (deskSpot) {
          root.position.set(deskSpot.x, deskSpot.y, deskSpot.z);
          root.rotation.set(0, deskSpot.ry, 0);
        }
      }
    }

    // riffle leaves settle
    for (const r of riffles) {
      if (r.t < 0 || !r.pivot.visible) continue;
      r.t += dt / (0.22 + r.delay);
      const eased = r.t >= 1 ? 1 : 1 - (1 - r.t) ** 3;
      r.pivot.rotation.z = -(1 - eased) * (Math.PI * 0.9);
      if (r.t >= 1) r.pivot.visible = false;
    }
  }

  // ---- carrying ------------------------------------------------------------
  function setCarried(next) {
    if (next && isOpen()) setOpen(false);
    carried = !!next;
    root.rotation.x = carried ? 0.14 : 0;
    return carried;
  }

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
    root.rotation.set(0, spot.ry || 0, 0);
    if (onPlaced) onPlaced({ x: spot.x, z: spot.z, y, ry: spot.ry || 0 });
    return { x: spot.x, z: spot.z, y, ry: spot.ry || 0 };
  }

  applyClosedPose();

  return {
    root,
    setOpen,
    isOpen,
    setCarried,
    isCarried: () => carried,
    followCarry,
    placeAt,
    position: () => ({ x: root.position.x, y: root.position.y, z: root.position.z }),
    turnPage,
    goToSection,
    update,
    diagnostics: () => ({
      state: bookState,
      open: isOpen(),
      carried,
      float: bookState === 'open' ? 1 : (bookState === 'opening' ? +stateT.toFixed(2) : 0),
      cover: +Math.abs(coverPivot.rotation.z / Math.PI).toFixed(2),
      spread,
      spreadCount: spreadCount(),
      pageCount: model ? model.pages.length : null,
      sections: model ? model.sections.map((s) => ({ id: s.id, locked: !!s.locked })) : [],
      turning: !!leaf,
      ...lastPaint,
    }),
  };
}
