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
  rosterEntries, rosterDateShort, houseNotes,
  daySheetSummary, takingsSummary, journalSections,
} from '../../sim/clubRoster.js';
import { CachedGLTFLoader as GLTFLoader } from '../gltfCache.js';

const PAGE_W = 768;
const PAGE_H = 512;
// 2026-08-06 ruling: "make the ui and text bigger". One scale drives every
// glyph on every page, so the whole book stays in proportion when it moves.
// Rows per page come DOWN to buy the height the larger type needs.
const TYPE_SCALE = 1.34;
const T = (px) => Math.round(px * TYPE_SCALE);
const ROWS_PER_PAGE = 5;
const NOTES_PER_PAGE = 5;
const LEAF_SECONDS = 0.55;
const OPEN_SECONDS = 0.85;
const CLOSE_SECONDS = 0.65;
// 2026-08-06 ruling: "closer to the user so its more visible... up and on an
// angle". FACE_TILT is measured from VERTICAL: PI/2 lies the spread flat on
// its back, 0 stands it straight up. 0.60 rad is a lectern angle - the pages
// face the eye, the fore-edges still read as a book rather than a poster.
const FACE_DISTANCE = 0.40;   // metres ahead of the eye
const FACE_DROP = 0.055;      // below the view axis - held UP, per the ruling
const FACE_TILT = 0.60;       // radians off vertical
const FOLLOW_RATE = 9;        // 1/s soft-follow while open

// the Blender asset's one set of measurements (tools/blender/build_ledger_book.py)
const HINGE_X = 0.151;        // the spine hinge line = the open book's gutter
const LEAF_W = 0.278;         // the turning leaf, just inside the painted faces
const LEAF_D = 0.184;
const LEAF_SEGS = 24;
const SWAP_POINT = 0.72;      // cover swing fraction where closed<->open swap hides

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

  // ---- the body: the Blender asset -----------------------------------------
  // vendor/models/clubhouse/ledger_book.glb (tools/blender/build_ledger_book.py,
  // authored against Designs/LedgerBook): green leather, gold double border,
  // brass corner caps, five spine bands, clasp + buckle, layered arched page
  // stacks. Two subtrees the state machine toggles: LB_Closed (with the
  // hinged LB_CoverFront the swing animates) and LB_Open (whose LB_FaceL/R
  // curved quads carry the live page canvases). Until the GLB lands - or if
  // it never does - a plain slab holds the desk spot so the prompt works.
  const leather = new THREE.MeshStandardMaterial({ color: 0x24382e, roughness: 0.72, metalness: 0.04 });
  const pageEdge = new THREE.MeshStandardMaterial({ color: 0xe6dcc2, roughness: 0.92, metalness: 0 });

  const closedShell = new THREE.Group();
  const openShell = new THREE.Group();
  openShell.visible = false;
  root.add(closedShell, openShell);

  const fallbackSlab = new THREE.Group();
  {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.07, 0.226), leather);
    slab.position.y = 0.035;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.284, 0.052, 0.21), pageEdge);
    edge.position.set(-0.004, 0.036, 0);
    fallbackSlab.add(slab, edge);
  }
  closedShell.add(fallbackSlab);

  // a stub the diagnostics + swing math can address before the GLB arrives
  const coverStub = new THREE.Group();
  const glbNodes = {
    ready: false,
    cover: coverStub,
    faceL: null,
    faceR: null,
    faceTitle: null,
    titleAnchor: null,
  };

  const makePageCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { canvas, texture };
  };
  // the live page surfaces; their meshes are the GLB's curved face quads
  const leftFace = makePageCanvas();
  const rightFace = makePageCanvas();
  const titleFace = makePageCanvas();

  // ---- the turning leaf: a real sheet that BENDS through the turn ----------
  // One shared segmented geometry deformed per-frame; front and back meshes
  // carry the outgoing and incoming page canvases.
  // Two geometries, one shape. The FRONT carries the page being turned away
  // and the BACK the page arriving; a back face seen through a sheet is
  // mirrored, so its u runs the other way - one shared buffer would have
  // printed the incoming page in reverse.
  function makeLeafGeometry(flipU, flipV) {
    const geometry = new THREE.PlaneGeometry(LEAF_W, LEAF_D, LEAF_SEGS, 1);
    geometry.rotateX(-Math.PI / 2);           // lie flat, normal +y
    // the sheet extends toward VIEWER-RIGHT (local -x) so a forward turn lifts
    // the right page and lays it on the left, the way a book actually reads
    geometry.translate(-(LEAF_W / 2 + 0.004), 0, 0);
    // PlaneGeometry's default winding printed the turning page rotated 180
    // degrees against the GLB's own pages (the exporter flips v on the way
    // out of Blender). Photographed, then corrected on both axes.
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) {
      if (flipU) uv.setX(i, 1 - uv.getX(i));
      if (flipV) uv.setY(i, 1 - uv.getY(i));
    }
    uv.needsUpdate = true;
    return geometry;
  }
  const leafGeoFront = makeLeafGeometry(true, true);
  const leafGeoBack = makeLeafGeometry(false, true);
  const leafBase = leafGeoFront.attributes.position.array.slice();
  const leafPivot = new THREE.Group();
  // clear of the arched stacks (which top out near 0.034) or the whole turn
  // happens INSIDE the page block and is never seen
  leafPivot.position.set(HINGE_X, 0.038, 0);
  const leafFront = makePageCanvas();
  const leafBack = makePageCanvas();
  {
    const front = new THREE.Mesh(
      leafGeoFront,
      new THREE.MeshBasicMaterial({
        map: leafFront.texture, toneMapped: false, color: 0xd7cfb8, side: THREE.FrontSide,
      }),
    );
    const back = new THREE.Mesh(
      leafGeoBack,
      new THREE.MeshBasicMaterial({
        map: leafBack.texture, toneMapped: false, color: 0xd7cfb8, side: THREE.BackSide,
      }),
    );
    leafFront.mesh = front;
    leafBack.mesh = back;
    leafPivot.add(front, back);
  }
  leafPivot.visible = false;
  openShell.add(leafPivot);

  function bendLeaf(turnProgress) {
    // the sheet arcs hardest mid-turn and lies flat at both ends, with the
    // free edge curling a touch more than the hinge side - paper, not a door
    const arc = Math.sin(Math.min(1, Math.max(0, turnProgress)) * Math.PI);
    for (const geometry of [leafGeoFront, leafGeoBack]) {
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i += 1) {
        const baseX = leafBase[i * 3];
        const u = Math.max(0, Math.min(1, (-baseX - 0.004) / LEAF_W));
        positions.array[i * 3 + 1] = leafBase[i * 3 + 1]
          + Math.sin(u * Math.PI * 0.92) * 0.040 * arc * (0.62 + 0.38 * u);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    }
  }

  function wireGlb(scene) {
    const closedNode = scene.getObjectByName('LB_Closed');
    const openNode = scene.getObjectByName('LB_Open');
    const coverNode = scene.getObjectByName('LB_CoverFront');
    const faceL = scene.getObjectByName('LB_FaceL');
    const faceR = scene.getObjectByName('LB_FaceR');
    const faceTitle = scene.getObjectByName('LB_FaceTitle');
    const titleAnchor = scene.getObjectByName('LB_TitleAnchor');
    if (!closedNode || !openNode || !coverNode || !faceL || !faceR) return false;
    // the open subtree's gutter sits ON the closed book's spine hinge, so the
    // mid-swing swap does not jump
    openNode.position.x += HINGE_X;
    closedShell.remove(fallbackSlab);
    closedShell.add(closedNode);
    openShell.add(openNode);
    // unlit so the page is always legible in the dark clubhouse, but tinted
    // DOWN: at full white the canvas read as a glowing screen rather than
    // paper ("not too white where we cant see it well", 2026-08-06)
    const pageMaterial = (texture) => new THREE.MeshBasicMaterial({
      map: texture, toneMapped: false, color: 0xd7cfb8,
    });
    // viewer-left is local +x from the reading pose (VERIFY2_L photographed):
    // the +x half (LB_FaceR, authored side +1) carries the LEFT page canvas
    faceR.material = pageMaterial(leftFace.texture);
    faceL.material = pageMaterial(rightFace.texture);
    leftFace.mesh = faceR;
    rightFace.mesh = faceL;
    if (faceTitle) {
      faceTitle.material = pageMaterial(titleFace.texture);
      titleFace.mesh = faceTitle;
    }
    glbNodes.ready = true;
    glbNodes.cover = coverNode;
    glbNodes.faceL = faceL;
    glbNodes.faceR = faceR;
    glbNodes.faceTitle = faceTitle;
    glbNodes.titleAnchor = titleAnchor;
    // the embossed cover title follows the CLUB NAME, so it is a canvas the
    // runtime paints, hung on the authored anchor and riding the cover swing
    if (titleAnchor) {
      const titlePlane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.215, 0.15),
        new THREE.MeshBasicMaterial({
          map: coverTitleTexture(), transparent: true, toneMapped: false,
        }),
      );
      titlePlane.rotation.x = -Math.PI / 2;
      titleAnchor.add(titlePlane);
    }
    paintTitleFace();
    // if the player opened the book during the load, the update loop owns
    // the shells from the next frame - only a closed book gets reposed here
    if (bookState === 'closed') applyClosedPose();
    return true;
  }

  new GLTFLoader().load(
    'vendor/models/clubhouse/ledger_book.glb',
    (gltf) => { wireGlb(gltf.scene); },
    undefined,
    () => { /* the fallback slab stays; every interaction still works */ },
  );

  // ---- textures ------------------------------------------------------------
  const clubNameOf = () => state?.club?.name || state?.shop?.name || 'Pine Hills Municipal Golf';

  function coverTitleTexture() {
    // gold lettering on TRANSPARENT ground - the leather shows through, so
    // this reads as embossing rather than a sticker
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 448;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 640, 448);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c9a44a';
    ctx.strokeStyle = '#c9a44a';
    let size = 52;
    ctx.font = `700 ${size}px Georgia, serif`;
    const name = clubNameOf().toUpperCase();
    while (ctx.measureText(name).width > 560 && size > 24) {
      size -= 2;
      ctx.font = `700 ${size}px Georgia, serif`;
    }
    ctx.fillText(name, 320, 180);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(200, 226);
    ctx.lineTo(300, 226);
    ctx.moveTo(340, 226);
    ctx.lineTo(440, 226);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(320, 219);
    ctx.lineTo(327, 226);
    ctx.lineTo(320, 233);
    ctx.lineTo(313, 226);
    ctx.closePath();
    ctx.fill();
    ctx.font = '700 30px Georgia, serif';
    ctx.fillText('MEMBERS AND GUESTS', 320, 272);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  // deterministic foxing: the same aged page every boot, no Math.random
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function paperGround(ctx) {
    // aged parchment: warm centre, browned edges, a scatter of foxing
    const base = ctx.createRadialGradient(
      PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.2,
      PAGE_W / 2, PAGE_H / 2, PAGE_W * 0.62,
    );
    base.addColorStop(0, '#efe4c8');
    base.addColorStop(0.72, '#e9dcba');
    base.addColorStop(1, '#dcc9a0');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    const edge = ctx.createLinearGradient(0, 0, PAGE_W, 0);
    edge.addColorStop(0, 'rgba(122,94,54,0.14)');
    edge.addColorStop(0.10, 'rgba(122,94,54,0)');
    edge.addColorStop(0.90, 'rgba(122,94,54,0)');
    edge.addColorStop(1, 'rgba(122,94,54,0.14)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    const rand = mulberry(0x5eed);
    for (let i = 0; i < 14; i += 1) {
      const x = rand() * PAGE_W;
      const y = rand() * PAGE_H;
      const r = 6 + rand() * 22;
      const fox = ctx.createRadialGradient(x, y, 0, x, y, r);
      fox.addColorStop(0, `rgba(150,112,62,${0.045 + rand() * 0.05})`);
      fox.addColorStop(1, 'rgba(150,112,62,0)');
      ctx.fillStyle = fox;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  function pageHeader(ctx, title) {
    // the reference's centred header with a double rule beneath
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#4a3b2a';
    ctx.font = `400 ${T(30)}px Georgia, serif`;
    ctx.fillText(title, PAGE_W / 2, 62);
    ctx.strokeStyle = 'rgba(90,74,48,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(40, 78);
    ctx.lineTo(PAGE_W - 40, 78);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90,74,48,0.28)';
    ctx.beginPath();
    ctx.moveTo(40, 83);
    ctx.lineTo(PAGE_W - 40, 83);
    ctx.stroke();
    ctx.textAlign = 'left';
  }

  // THE CONTROLS LIVE IN THE BOOK (2026-08-06 ruling: "add instructions on the
  // bottom for how to switch pages"). Written into the page's own foot in the
  // desk's hand, so nothing floats over the world and the keys can never drift
  // from what is bound - the labels come from the live binding table.
  let footerHint = { prev: 'A', next: 'D', close: 'E' };
  function pageControls(ctx, side) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(78,66,46,0.72)';
    ctx.font = `400 ${T(17)}px Georgia, serif`;
    const y = PAGE_H - 16;
    if (side === 'left') {
      ctx.textAlign = 'left';
      ctx.fillText(`◀  ${footerHint.prev}  previous page`, 40, y);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(`next page  ${footerHint.next}  ▶`, PAGE_W - 40, y);
      ctx.textAlign = 'left';
      ctx.fillText(`${footerHint.close}  close the book`, 40, y);
    }
    ctx.restore();
  }

  function paintTitleFace() {
    // the page the cover swing reveals on the closed block
    if (!titleFace) return;
    const ctx = titleFace.canvas.getContext('2d');
    paperGround(ctx);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3a4a40';
    ctx.font = '700 54px Georgia, serif';
    ctx.fillText('CLUB REGISTER', PAGE_W / 2, 205);
    ctx.font = 'italic 400 32px Georgia, serif';
    ctx.fillText(clubNameOf(), PAGE_W / 2, 258);
    ctx.strokeStyle = '#b58a42';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(190, 300);
    ctx.lineTo(PAGE_W - 190, 300);
    ctx.stroke();
    ctx.fillStyle = '#6b7268';
    ctx.font = 'italic 400 24px Georgia, serif';
    ctx.fillText('Members and guests sign within.', PAGE_W / 2, 345);
    ctx.textAlign = 'left';
    titleFace.texture.needsUpdate = true;
  }

  function pageFooter(ctx, index) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9a927e';
    ctx.font = `400 ${T(18)}px Georgia, serif`;
    ctx.fillText(String(index), PAGE_W / 2, PAGE_H - 15);
    ctx.textAlign = 'left';
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
    ctx.font = `700 ${T(46)}px Georgia, serif`;
    ctx.fillText('CLUB REGISTER', PAGE_W / 2, 122);
    ctx.font = `italic 400 ${T(28)}px Georgia, serif`;
    ctx.fillText(clubName, PAGE_W / 2, 176);
    ctx.strokeStyle = '#b58a42';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(160, 208);
    ctx.lineTo(PAGE_W - 160, 208);
    ctx.stroke();
    // the table of contents IS the pitch: what the book holds, and what is
    // still locked - the chase on page one
    // six rows have to clear the controls line at PAGE_H-16
    let y = 246;
    for (const section of sections) {
      ctx.textAlign = 'left';
      ctx.fillStyle = section.locked ? '#8a8272' : '#3f4a42';
      ctx.font = section.locked ? `italic 400 ${T(25)}px Georgia, serif` : `400 ${T(25)}px Georgia, serif`;
      ctx.fillText(section.title, 92, y);
      ctx.textAlign = 'right';
      if (section.locked) {
        // a small drawn padlock, not an emoji
        const lx = PAGE_W - 118;
        ctx.strokeStyle = '#8a8272';
        ctx.lineWidth = 3.4;
        ctx.strokeRect(lx, y - 20, 20, 15);
        ctx.beginPath();
        ctx.arc(lx + 10, y - 20, 7.5, Math.PI, 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#6b7268';
        ctx.font = `400 ${T(22)}px Georgia, serif`;
        ctx.fillText(String(pageOfSection[section.id] ?? ''), PAGE_W - 92, y);
      }
      ctx.strokeStyle = 'rgba(90,80,58,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(92, y + 11);
      ctx.lineTo(PAGE_W - 92, y + 11);
      ctx.stroke();
      y += 41;
    }
    face.texture.needsUpdate = true;
    return sections.length;
  }

  // the reference sheet's ruled table: column dividers, a full grid to the
  // page's foot, and entries in a written hand
  // Column edges. The date columns were 130px and 166px against a 12-character
  // stamp and both truncated; the name column had room to spare. Widened to fit
  // `rosterDateShort` with margin, taking the space from NAME.
  const GUEST_COLS = [36, 204, 448, 616, 732];
  const SCRIPT_FONT = "'Segoe Script', 'Comic Sans MS', cursive";

  function paintGuests(face, entries, guestPage, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'Members and Guests');
    const top = 100;
    const bottom = PAGE_H - 44;
    const headRow = 42;
    ctx.fillStyle = '#6b5a40';
    ctx.font = `700 ${T(15)}px Georgia, serif`;
    ctx.textAlign = 'center';
    const labels = ['FIRST VISIT', 'NAME', 'LAST SEEN', 'ROUNDS'];
    for (let c = 0; c < labels.length; c += 1) {
      ctx.fillText(labels[c], (GUEST_COLS[c] + GUEST_COLS[c + 1]) / 2, top + 29);
    }
    ctx.textAlign = 'left';
    const rowHeight = (bottom - (top + headRow)) / ROWS_PER_PAGE;
    ctx.strokeStyle = 'rgba(96,78,50,0.42)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(GUEST_COLS[0], top, GUEST_COLS[4] - GUEST_COLS[0], bottom - top);
    ctx.beginPath();
    for (let c = 1; c < 4; c += 1) {
      ctx.moveTo(GUEST_COLS[c], top);
      ctx.lineTo(GUEST_COLS[c], bottom);
    }
    ctx.moveTo(GUEST_COLS[0], top + headRow);
    ctx.lineTo(GUEST_COLS[4], top + headRow);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(96,78,50,0.26)';
    ctx.beginPath();
    for (let row = 1; row < ROWS_PER_PAGE; row += 1) {
      const y = top + headRow + row * rowHeight;
      ctx.moveTo(GUEST_COLS[0], y);
      ctx.lineTo(GUEST_COLS[4], y);
    }
    ctx.stroke();
    let painted = 0;
    for (let row = 0; row < ROWS_PER_PAGE; row += 1) {
      const entry = entries[guestPage * ROWS_PER_PAGE + row];
      if (!entry) continue;
      painted += 1;
      const base = top + headRow + row * rowHeight + rowHeight * 0.68;
      ctx.fillStyle = '#3d3325';
      ctx.font = `400 ${T(21)}px ${SCRIPT_FONT}`;
      ctx.fillText(fitLine(ctx, rosterDateShort(entry.firstVisitDayAbs), GUEST_COLS[1] - GUEST_COLS[0] - 18), GUEST_COLS[0] + 10, base);
      ctx.fillStyle = '#2c3a50';
      ctx.font = `400 ${T(26)}px ${SCRIPT_FONT}`;
      ctx.fillText(fitLine(ctx, entry.name, GUEST_COLS[2] - GUEST_COLS[1] - 20), GUEST_COLS[1] + 12, base);
      ctx.fillStyle = '#3d3325';
      ctx.font = `400 ${T(21)}px ${SCRIPT_FONT}`;
      ctx.fillText(fitLine(ctx, rosterDateShort(entry.lastVisitDayAbs), GUEST_COLS[3] - GUEST_COLS[2] - 18), GUEST_COLS[2] + 10, base);
      ctx.textAlign = 'center';
      ctx.font = `400 ${T(24)}px ${SCRIPT_FONT}`;
      ctx.fillText(String(entry.visits), (GUEST_COLS[3] + GUEST_COLS[4]) / 2, base);
      ctx.textAlign = 'left';
    }
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return painted;
  }

  function paintNotes(face, notes, notesPage, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'House Notes');
    let y = 148;
    let written = 0;
    const from = notesPage * NOTES_PER_PAGE;
    for (const note of notes.slice(from, from + NOTES_PER_PAGE)) {
      if (note.outstanding) {
        ctx.fillStyle = '#7a4a34';
        ctx.fillRect(40, y - 19, 13, 13);
        ctx.fillStyle = '#3f4a42';
        ctx.font = `400 ${T(21)}px Georgia, serif`;
        ctx.fillText(fitLine(ctx, note.text, PAGE_W - 100), 66, y);
      } else {
        ctx.fillStyle = '#6b7268';
        ctx.font = `italic 400 ${T(21)}px Georgia, serif`;
        ctx.fillText(fitLine(ctx, note.text, PAGE_W - 72), 36, y);
      }
      written += 1;
      y += 72;
    }
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return written;
  }

  function paintDaySheet(face, day, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'Day Sheet');
    ctx.fillStyle = '#3a4a40';
    ctx.font = `italic 700 ${T(30)}px Georgia, serif`;
    ctx.fillText(day.dateLabel || 'Today', 40, 148);
    const rows = [
      ['Tee times filled', `${day.filledSlots} of ${day.slotCount}`],
      ['Players booked', String(day.bookedPlayers)],
      ['Rounds played', String(day.played)],
      ['Next open time', hourLabel(day.nextOpenMinute)],
    ];
    let y = 216;
    for (const [label, value] of rows) {
      ctx.fillStyle = '#6b7268';
      ctx.font = `400 ${T(24)}px Georgia, serif`;
      ctx.fillText(label, 48, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#2c3e50';
      ctx.font = `700 ${T(26)}px Georgia, serif`;
      ctx.fillText(value, PAGE_W - 48, y);
      ctx.textAlign = 'left';
      ctx.strokeStyle = 'rgba(90,80,58,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(48, y + 16);
      ctx.lineTo(PAGE_W - 48, y + 16);
      ctx.stroke();
      y += 74;
    }
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return rows.length;
  }

  function paintTakings(face, takings, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'Takings');
    const rows = [
      ['Green fees', money(takings.greenFees)],
      ['Shop sales', money(takings.shopSales)],
      ['Everything else', money(takings.otherRevenue)],
      ['Taken today', money(takings.revenueTotal)],
      ['Spent today', money(takings.expenseTotal)],
    ];
    let y = 158;
    for (const [index, [label, value]] of rows.entries()) {
      const strong = index === 3;
      ctx.fillStyle = strong ? '#3f4a42' : '#6b7268';
      ctx.font = `${strong ? 700 : 400} ${T(24)}px Georgia, serif`;
      ctx.fillText(label, 48, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#2c3e50';
      ctx.font = `${strong ? 700 : 400} ${T(26)}px Georgia, serif`;
      ctx.fillText(value, PAGE_W - 48, y);
      ctx.textAlign = 'left';
      ctx.strokeStyle = index === 2 ? 'rgba(90,80,58,0.5)' : 'rgba(90,80,58,0.22)';
      ctx.lineWidth = index === 2 ? 1.8 : 1;
      ctx.beginPath();
      ctx.moveTo(48, y + 16);
      ctx.lineTo(PAGE_W - 48, y + 16);
      ctx.stroke();
      y += 64;
    }
    const ahead = takings.net >= 0;
    ctx.fillStyle = ahead ? '#2f5c46' : '#7a3a30';
    ctx.font = `italic 700 ${T(28)}px Georgia, serif`;
    ctx.fillText(`${ahead ? 'Ahead' : 'Down'} ${money(Math.abs(takings.net))} on the day.`, 48, y + 14);
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return rows.length;
  }

  function paintLocked(face, section, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(90,80,58,0.55)';
    ctx.font = `700 ${T(40)}px Georgia, serif`;
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
    ctx.font = `italic 400 ${T(24)}px Georgia, serif`;
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
    // the controls go on LAST, over whatever the page painted, so a long page
    // can never bury them
    pageControls(leftFace.canvas.getContext('2d'), 'left');
    pageControls(rightFace.canvas.getContext('2d'), 'right');
    leftFace.texture.needsUpdate = true;
    rightFace.texture.needsUpdate = true;
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
    // the open spread's centre is the GUTTER (local +HINGE_X), not the root
    // origin - pull the root sideways so the spread sits on the view axis
    const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    position.addScaledVector(localX, -HINGE_X);
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
      paintTitleFace();
      // reversing mid-close continues from the matching point of the rise
      stateT = bookState === 'closing' ? Math.max(0, 1 - stateT) : 0;
      bookState = 'opening';
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
    leaf = { direction: direction > 0 ? 1 : -1, t: 0, settled: false };
    leafPivot.visible = true;
    leafPivot.rotation.z = leaf.direction > 0 ? 0 : -Math.PI;
    bendLeaf(0);
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

  // Blender's hinge swing (rotation about its -Y) lands in glTF as rotation
  // about +Z: positive angles open the cover over the spine
  const COVER_SIGN = 1;
  function setCoverSwing(fraction) {
    glbNodes.cover.rotation.z = COVER_SIGN * fraction * Math.PI;
  }

  function applyClosedPose() {
    setCoverSwing(0);
    openShell.visible = false;
    closedShell.visible = true;
    leafPivot.visible = false;
  }

  function update(dt) {
    // the leaf turn, whatever else is happening: an eased arc with a real
    // paper BEND through the middle and a settle cue as it lands
    if (leaf) {
      leaf.t = Math.min(1, leaf.t + dt / LEAF_SECONDS);
      const eased = smoothstep(leaf.t);
      // The sheet hangs toward viewer-right (local -x). Rotating about +z by a
      // NEGATIVE angle lifts that edge: (-1,0) -> (-cos, +sin) for theta<0.
      // Positive angles drove it down THROUGH the page block, which is why
      // the turn photographed as nothing happening at all.
      leafPivot.rotation.z = leaf.direction > 0 ? -eased * Math.PI : -(1 - eased) * Math.PI;
      bendLeaf(eased);
      if (!leaf.settled && leaf.t >= 0.82) {
        leaf.settled = true;
        play('paper');
      }
      if (leaf.t >= 1) {
        leaf = null;
        leafPivot.visible = false;
        bendLeaf(0);
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
      // the cover swings through the middle of the rise; the closed block
      // exchanges for the arched open spread behind it at the swap point
      const swing = smoothstep(Math.max(0, Math.min(1, (stateT - 0.26) / 0.58)));
      setCoverSwing(swing);
      if (swing > SWAP_POINT && !openShell.visible) {
        openShell.visible = true;
        closedShell.visible = false;
        play('paper');
      }
      if (stateT >= 1) {
        bookState = 'open';
        setCoverSwing(1);
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
      setCoverSwing(swing);
      if (swing < SWAP_POINT && openShell.visible) {
        openShell.visible = false;
        closedShell.visible = true;
        play('paper');
      }
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
    // the footer's key labels come from the LIVE binding table (N2), so a
    // rebound interact key cannot leave the book teaching the wrong key
    setControlLabels: (labels) => {
      footerHint = { ...footerHint, ...(labels || {}) };
      if (isOpen()) paintSpread();
    },
    update,
    diagnostics: () => ({
      state: bookState,
      open: isOpen(),
      carried,
      glbReady: glbNodes.ready,
      float: bookState === 'open' ? 1 : (bookState === 'opening' ? +stateT.toFixed(2) : 0),
      cover: +Math.abs(glbNodes.cover.rotation.z / Math.PI).toFixed(2),
      spread,
      spreadCount: spreadCount(),
      pageCount: model ? model.pages.length : null,
      sections: model ? model.sections.map((s) => ({ id: s.id, locked: !!s.locked })) : [],
      turning: !!leaf,
      ...lastPaint,
    }),
  };
}
