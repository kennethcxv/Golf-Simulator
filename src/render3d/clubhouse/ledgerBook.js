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
  courseLogSummary, championEntries,
  complaintsAndFixes, restorationRecord, firstsEntries, takingsHistory, deedSummary,
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
// C1 (Full_Goal_16): 0.85 -> 0.4. The long rise WAS the "control is taken
// away" complaint's other half — with pointer lock now kept through the
// open, a brisk rise reads as picking a book up rather than a cutscene.
const OPEN_SECONDS = 0.4;
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
const LEAF_W = 0.264;         // the turning leaf, just inside the painted faces
const LEAF_D = 0.174;
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

  // R6, and the real reason the book "reads cheap": IT IS NOT LIT. The pages
  // are unlit canvases so they always read, but the leather, the brass and the
  // gold are MeshStandard in a clubhouse whose interior is deliberately dim —
  // measured on the first pass, the boards came back near-black no matter what
  // base colour they were given, and lifting the albedo just made a flat grey-
  // green. Raising the albedo further would have been the wrong fix twice.
  //
  // A book held up to your face catches light, so the book carries its own. A
  // small warm point light rides the spine, lives only while the book is open,
  // and is scoped to the pages' own decay so it lights the object rather than
  // the room. The gold turn-in and the new gilt fore-edges have nothing to
  // catch without it.
  const readingLight = new THREE.PointLight(0xffe6bd, 0, 0.85, 2.0);
  readingLight.name = 'LedgerReadingLight';
  readingLight.position.set(HINGE_X, 0.30, 0.16);
  readingLight.castShadow = false;
  root.add(readingLight);
  const READING_LIGHT_MAX = 1.45;

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

  // A2/C5: `scale` shrinks the BACKING (and so the per-turn GPU upload —
  // the measured cost; the paints themselves were 0.3 ms) while painters
  // keep drawing in PAGE_W×PAGE_H coordinates through a persistent
  // transform (no painter in this file touches setTransform). The turning
  // LEAF runs at half res: it is in motion for its whole life, so the eye
  // never reads its texels the way it reads a settled page's.
  const makePageCanvas = (scale = 1) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PAGE_W * scale);
    canvas.height = Math.round(PAGE_H * scale);
    if (scale !== 1) canvas.getContext('2d').setTransform(scale, 0, 0, scale, 0, 0);
    // C3: every string this face ever draws records its rect (PAGE-space —
    // the transform applies at raster, not here), so overlap detection is a
    // property of the CLASS of painters, not a per-painter promise. The
    // front desk records truncations; the ledger records collisions.
    const face = {};
    const ctx = canvas.getContext('2d');
    face.draws = [];
    const origFillText = ctx.fillText.bind(ctx);
    ctx.fillText = (text, x, y, maxWidth) => {
      try {
        const metrics = ctx.measureText(String(text));
        const w = Math.min(metrics.width, maxWidth ?? Infinity);
        const asc = metrics.actualBoundingBoxAscent ?? 18;
        const desc = metrics.actualBoundingBoxDescent ?? 5;
        let left = x;
        if (ctx.textAlign === 'center') left = x - w / 2;
        else if (ctx.textAlign === 'right' || ctx.textAlign === 'end') left = x - w;
        face.draws.push({
          text: String(text).slice(0, 48), x: +left.toFixed(1), y: +(y - asc).toFixed(1),
          w: +w.toFixed(1), h: +(asc + desc).toFixed(1),
        });
      } catch { /* recording must never break painting */ }
      return origFillText(text, x, y, maxWidth);
    };
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // A2/C5 (measured, run 8): every needsUpdate paid a ~55 ms frame
    // REGARDLESS of canvas size — the constant cost of regenerating a full
    // sRGB mip chain per upload, three times per turn. The pages are read
    // nearly 1:1 on screen; mips bought nothing a bilinear min filter does
    // not, and turning them off removes the hitch at its source.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    return Object.assign(face, { canvas, texture });
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
  leafPivot.name = 'LedgerTurningLeafPivot';
  // R1/R4: the leaf's rest height USED to be the constant 0.038 — "clear of
  // the arched stacks (which top out near 0.034)". Once the block was rebuilt
  // to sit ON the covers instead of inside them it tops out at 0.048, so a
  // fixed height would start every turn from inside the paper. The profile is
  // now SAMPLED from the shipped page mesh, so the leaf lies on whatever the
  // GLB actually is and cannot drift from it.
  //   pageProfile[u] = height of the page surface u of the way from the
  //   gutter to the fore-edge, in the book's own frame.
  const PROFILE_SAMPLES = 33;
  let pageProfile = null;   // Float32Array | null until the GLB lands
  let gutterHeight = 0.021;
  leafPivot.position.set(HINGE_X, gutterHeight, 0);

  function samplePageProfile(faceMesh) {
    // LB_FaceL/R carry no local transform inside LB_Open, so their vertex
    // positions are already the open book's own frame: |x| is the distance
    // from the gutter, y is the surface height.
    const position = faceMesh?.geometry?.attributes?.position;
    if (!position || position.count < 4) return null;
    const bins = new Float32Array(PROFILE_SAMPLES);
    const hits = new Uint16Array(PROFILE_SAMPLES);
    let maxX = 0;
    for (let i = 0; i < position.count; i += 1) maxX = Math.max(maxX, Math.abs(position.getX(i)));
    if (maxX <= 1e-5) return null;
    for (let i = 0; i < position.count; i += 1) {
      const u = Math.abs(position.getX(i)) / maxX;
      const bin = Math.min(PROFILE_SAMPLES - 1, Math.round(u * (PROFILE_SAMPLES - 1)));
      bins[bin] += position.getY(i);
      hits[bin] += 1;
    }
    // fill any empty bin from its nearest filled neighbour
    let last = null;
    for (let i = 0; i < PROFILE_SAMPLES; i += 1) {
      if (hits[i] > 0) { bins[i] /= hits[i]; last = bins[i]; } else if (last !== null) bins[i] = last;
    }
    for (let i = PROFILE_SAMPLES - 1; i >= 0; i -= 1) {
      if (hits[i] === 0 && i + 1 < PROFILE_SAMPLES) bins[i] = bins[i + 1];
      else if (hits[i] > 0) break;
    }
    return bins;
  }

  function pageHeightAt(u) {
    if (!pageProfile) return 0.038;
    const clamped = Math.max(0, Math.min(1, u)) * (PROFILE_SAMPLES - 1);
    const lo = Math.floor(clamped);
    const hi = Math.min(PROFILE_SAMPLES - 1, lo + 1);
    const f = clamped - lo;
    return pageProfile[lo] * (1 - f) + pageProfile[hi] * f;
  }
  const leafFront = makePageCanvas(0.5);
  const leafBack = makePageCanvas(0.5);
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
    // NAMED, so the turn can be probed. Unnamed, the only handle on the leaf
    // was "a node with two 768x512 planes under it" — which also describes
    // LB_Open, and a driver looking for the turning leaf measured the two
    // static page faces instead and reported a leaf that never moved.
    front.name = 'LedgerTurningLeafFront';
    back.name = 'LedgerTurningLeafBack';
    leafFront.mesh = front;
    leafBack.mesh = back;
    leafPivot.add(front, back);
  }
  leafPivot.visible = false;
  openShell.add(leafPivot);

  function bendLeaf(turnProgress) {
    // The sheet has to do three things at once: LIE on the page it starts
    // from, BEND through the middle, and SETTLE onto the page it lands on.
    //
    // The pivot rotates by theta = progress * PI about the gutter, and that
    // rotation maps local (x, y) -> (-x, -y) at the end. So a rest height of
    // +h would land at -h, i.e. under the left page. The conforming term is
    // therefore h*cos(theta): +h flat on the right page at the start, -h at
    // the end, which the rotation turns back into +h on the left page. The
    // bend rides sin(theta), strongest side-on where it actually reads.
    const p = Math.min(1, Math.max(0, turnProgress));
    const theta = p * Math.PI;
    const conform = Math.cos(theta);
    const arc = Math.sin(theta);
    for (const geometry of [leafGeoFront, leafGeoBack]) {
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i += 1) {
        const baseX = leafBase[i * 3];
        const u = Math.max(0, Math.min(1, (-baseX - 0.004) / LEAF_W));
        // height of the page under this point, relative to the pivot
        const rest = pageHeightAt(u) - gutterHeight;
        positions.array[i * 3 + 1] = leafBase[i * 3 + 1]
          + rest * conform
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
    // the turning leaf takes its rest shape from the page it will lie on
    pageProfile = samplePageProfile(faceR) || samplePageProfile(faceL);
    if (pageProfile) {
      gutterHeight = pageProfile[0] + 0.0012;
      leafPivot.position.set(HINGE_X, gutterHeight, 0);
      bendLeaf(0);
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
    // the framing solve needs the real book, so it is re-measured the moment
    // the GLB replaces the fallback slab
    openBounds = null;
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
    // C2: paper FIBRE — the missing cue between "canvas with text" and a
    // page. Short horizontal laid-lines at whisper alpha, deterministic so
    // reprints are identical and the driver's pixel checks stay stable.
    const fibre = mulberry(0xf1b3e);
    ctx.strokeStyle = 'rgba(96,78,48,0.045)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 130; i += 1) {
      const fx = fibre() * PAGE_W;
      const fy = fibre() * PAGE_H;
      const len = 14 + fibre() * 46;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + len, fy + (fibre() - 0.5) * 2.2);
      ctx.stroke();
    }
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
  //
  // R3 (2026-08-06): "'Ahead X on that day' overlaps the page controls.
  // Measure before you draw." It did — the takings summary's box ran
  // 463..500 straight through the control line at 479..501, and the summary
  // moves with the number's length, so eyeballing one figure proved nothing.
  //
  // The page now has a FOOT BAND that the controls and the folio own outright,
  // and its top edge is MEASURED from the glyphs actually drawn in it rather
  // than assumed. Every content painter stops at FOOT_TOP. The row inside the
  // band is laid out by measurement too: left cell, right cell, and the folio
  // in whatever centre gap survives — if it does not survive, the folio is
  // dropped rather than printed over a control.
  let footerHint = { prev: 'A', next: 'D', close: 'E' };
  const FOOT_PAD = 14;              // breathing room above the band
  const FOOT_MARGIN = 40;           // side margin the foot row keeps
  const CONTROL_FONT = () => `400 ${T(17)}px Georgia, serif`;
  const FOLIO_FONT = () => `400 ${T(18)}px Georgia, serif`;
  const controlBaseline = () => PAGE_H - 16;
  const folioBaseline = () => PAGE_H - 15;

  let measureCtx = null;
  function measurer() {
    if (!measureCtx) {
      const canvas = document.createElement('canvas');
      canvas.width = PAGE_W;
      canvas.height = PAGE_H;
      measureCtx = canvas.getContext('2d');
    }
    return measureCtx;
  }
  function textBox(ctx, text, font, x, baseline, align = 'left') {
    ctx.font = font;
    const m = ctx.measureText(String(text));
    const ascent = m.actualBoundingBoxAscent || 0;
    const descent = m.actualBoundingBoxDescent || 0;
    let x0 = x;
    if (align === 'right') x0 = x - m.width;
    else if (align === 'center') x0 = x - m.width / 2;
    return { x0, x1: x0 + m.width, y0: baseline - ascent, y1: baseline + descent, width: m.width };
  }

  // the labels that will actually be printed in the band, for this binding
  function footCells(side) {
    if (side === 'left') {
      return { left: `◀  ${footerHint.prev}  previous page`, right: null };
    }
    return { left: `${footerHint.close}  close the book`, right: `next page  ${footerHint.next}  ▶` };
  }

  // The band's top edge: the highest ink any foot row can reach, over BOTH
  // pages and the current key labels. Recomputed whenever the bindings change.
  let footTop = PAGE_H - 34;
  function remeasureFoot() {
    const ctx = measurer();
    let top = PAGE_H;
    for (const side of ['left', 'right']) {
      const cells = footCells(side);
      if (cells.left) {
        top = Math.min(top, textBox(ctx, cells.left, CONTROL_FONT(), FOOT_MARGIN, controlBaseline()).y0);
      }
      if (cells.right) {
        top = Math.min(top, textBox(ctx, cells.right, CONTROL_FONT(), PAGE_W - FOOT_MARGIN, controlBaseline(), 'right').y0);
      }
    }
    top = Math.min(top, textBox(ctx, '888', FOLIO_FONT(), PAGE_W / 2, folioBaseline(), 'center').y0);
    footTop = Math.floor(top - FOOT_PAD);
    return footTop;
  }
  remeasureFoot();
  const contentBottom = () => footTop;

  function pageFoot(ctx, side, folio) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(78,66,46,0.72)';
    ctx.font = CONTROL_FONT();
    const cells = footCells(side);
    const y = controlBaseline();
    let leftEdge = FOOT_MARGIN;
    let rightEdge = PAGE_W - FOOT_MARGIN;
    if (cells.left) {
      ctx.textAlign = 'left';
      ctx.fillText(cells.left, FOOT_MARGIN, y);
      leftEdge = textBox(ctx, cells.left, CONTROL_FONT(), FOOT_MARGIN, y).x1;
    }
    if (cells.right) {
      ctx.textAlign = 'right';
      ctx.fillText(cells.right, PAGE_W - FOOT_MARGIN, y);
      rightEdge = textBox(ctx, cells.right, CONTROL_FONT(), PAGE_W - FOOT_MARGIN, y, 'right').x0;
    }
    // the folio only prints if the measured gap actually holds it
    if (Number.isFinite(folio)) {
      const box = textBox(ctx, folio, FOLIO_FONT(), PAGE_W / 2, folioBaseline(), 'center');
      if (box.x0 > leftEdge + 16 && box.x1 < rightEdge - 16) {
        ctx.fillStyle = '#9a927e';
        ctx.font = FOLIO_FONT();
        ctx.textAlign = 'center';
        ctx.fillText(String(folio), PAGE_W / 2, folioBaseline());
      }
    }
    ctx.textAlign = 'left';
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

  // The folio is drawn by pageFoot now, which measures the gap first. Kept as
  // a no-op seam so a painter that forgets is a missing number, not an
  // overlap — the number is the least important thing on the page.
  function pageFooter() {}

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
    // still locked - the chase on page one. The step is solved from the row
    // count so a seventh section shortens the rows instead of writing one
    // into the foot band.
    const tocTop = 246;
    const step = Math.min(41, Math.max(26,
      (contentBottom() - 12 - tocTop) / Math.max(1, sections.length)));
    // C3 (caught by the new overlap recorder on its first live run): at
    // seven sections the solved step ran tighter than a T(25) Georgia line's
    // ascent+descent and adjacent titles collided by ~3.5 px. The FONT now
    // fits the STEP — rows can tighten without their glyphs touching.
    const rowPx = Math.min(T(25), Math.floor(step * 0.68));
    let y = tocTop;
    for (const section of sections) {
      ctx.textAlign = 'left';
      ctx.fillStyle = section.locked ? '#8a8272' : '#3f4a42';
      ctx.font = section.locked ? `italic 400 ${rowPx}px Georgia, serif` : `400 ${rowPx}px Georgia, serif`;
      ctx.fillText(section.title, 92, y);
      ctx.textAlign = 'right';
      if (section.locked) {
        // C4: a small drawn padlock, RIGHT-ALIGNED to the same column edge
        // the page numbers use (PAGE_W - 92) and optically centred on the
        // row's text. The old glyph ended 6 px left of the number column
        // with its shackle poking above the row — the "unaligned, sloppy"
        // read, worst on Firsts because Firsts is usually the locked one.
        const bodyW = 20;
        const bodyH = 12;
        const lx = PAGE_W - 92 - bodyW;
        const by = y - bodyH - 2; // body top; baseline-aligned like a digit
        ctx.strokeStyle = '#8a8272';
        ctx.lineWidth = 3;
        ctx.strokeRect(lx, by, bodyW, bodyH);
        ctx.beginPath();
        ctx.arc(lx + bodyW / 2, by, 6, Math.PI, 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#6b7268';
        ctx.font = `400 ${T(22)}px Georgia, serif`;
        ctx.fillText(String(pageOfSection[section.id] ?? ''), PAGE_W - 92, y);
      }
      ctx.strokeStyle = 'rgba(90,80,58,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(92, y + step * 0.27);
      ctx.lineTo(PAGE_W - 92, y + step * 0.27);
      ctx.stroke();
      y += step;
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
    const bottom = contentBottom();
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
    const notesTop = 148;
    const shown = notes.slice(notesPage * NOTES_PER_PAGE, notesPage * NOTES_PER_PAGE + NOTES_PER_PAGE);
    const step = Math.min(72, Math.max(34,
      (contentBottom() - 8 - notesTop) / Math.max(1, shown.length)));
    let y = notesTop;
    let written = 0;
    for (const note of shown) {
      if (note.outstanding) {
        ctx.fillStyle = '#7a4a34';
        ctx.fillRect(40, y - 19, 13, 13);
        ctx.fillStyle = '#3f4a42';
        ctx.font = `400 ${T(21)}px Georgia, serif`;
        ctx.fillText(fitLine(ctx, note.text, PAGE_W - 100), 66, y);
        // ITEM 17: the standing instruction, under the note that needs it, in
        // the desk's quieter hand. What it needs and what to press - the two
        // questions the book used to leave a first-timer to guess.
        if (note.action) {
          ctx.fillStyle = 'rgba(107,114,104,0.92)';
          ctx.font = `italic 400 ${T(16)}px Georgia, serif`;
          ctx.fillText(fitLine(ctx, note.action, PAGE_W - 120), 66, y + T(19));
        }
      } else {
        ctx.fillStyle = '#6b7268';
        ctx.font = `italic 400 ${T(21)}px Georgia, serif`;
        ctx.fillText(fitLine(ctx, note.text, PAGE_W - 72), 36, y);
      }
      written += 1;
      y += step;
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
    const daysTop = 216;
    const step = Math.min(74, Math.max(38,
      (contentBottom() - 10 - daysTop) / Math.max(1, rows.length)));
    let y = daysTop;
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
      ctx.moveTo(48, y + step * 0.22);
      ctx.lineTo(PAGE_W - 48, y + step * 0.22);
      ctx.stroke();
      y += step;
    }
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return rows.length;
  }

  // D3 — THE FIVE NEW SECTIONS.
  //
  // Every one of them is a lens on state the sim already keeps, per the rule the
  // top of clubRoster.js sets: the book owns nothing and invents nothing. A line
  // that has not happened yet is PRINTED and says "not yet", because an empty
  // ruled line is an invitation and a missing line is a secret.

  // A ruled table with a label column and a value column, the shape three of
  // these pages want. Returns the y it finished at so a caller can put a footer
  // note under it.
  function ruledRows(ctx, rows, top, { labelFont = 21, valueFont = 22, maxStep = 56 } = {}) {
    // C3 (recorder catch #2, complaints page at real content): a row's NOTE
    // line sits ~T(17) below its baseline, and a floor step of 28 marched
    // the NEXT label straight through it (10.7 px of collision). Note rows
    // now carry their own extra height, budgeted out of the available run,
    // and the separator rule moves BELOW the note it used to cross.
    const noteExtra = T(17) + 6;
    const noteCount = rows.filter((row) => row.note).length;
    const step = Math.min(maxStep, Math.max(24,
      (contentBottom() - 14 - top - noteCount * noteExtra) / Math.max(1, rows.length)));
    let y = top;
    for (const row of rows) {
      const strong = !!row.strong;
      const muted = !!row.muted;
      ctx.fillStyle = muted ? 'rgba(107,114,104,0.72)' : strong ? '#3f4a42' : '#6b7268';
      ctx.font = `${strong ? 700 : 400} ${T(labelFont)}px Georgia, serif`;
      ctx.fillText(fitLine(ctx, row.label, PAGE_W - 300), 48, y);
      if (row.value != null) {
        ctx.textAlign = 'right';
        ctx.fillStyle = row.valueColor || (muted ? 'rgba(107,114,104,0.72)' : '#2c3e50');
        ctx.font = `${strong ? 700 : 400} ${T(valueFont)}px Georgia, serif`;
        // the page MESH curves into the gutter and crops the canvas's last
        // ~25 px: a value ending at -48 rasterises clipped ("waiting on the
        // ceili..."). The shared right edge pulls in to survive the crop.
        ctx.fillText(fitLine(ctx, String(row.value), 205), PAGE_W - 72, y);
        ctx.textAlign = 'left';
      }
      // a settled complaint is struck through, not deleted: "we had that
      // problem and we dealt with it" is the sentence this page exists to say
      if (row.struck) {
        ctx.strokeStyle = 'rgba(90,80,58,0.55)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(46, y - T(labelFont) * 0.3);
        ctx.lineTo(48 + ctx.measureText(fitLine(ctx, row.label, PAGE_W - 300)).width + 4, y - T(labelFont) * 0.3);
        ctx.stroke();
      }
      let noteDrop = 0;
      if (row.note) {
        ctx.fillStyle = 'rgba(107,114,104,0.92)';
        ctx.font = `italic 400 ${T(15)}px Georgia, serif`;
        ctx.fillText(fitLine(ctx, row.note, PAGE_W - 120), 66, y + T(17));
        noteDrop = noteExtra;
      }
      ctx.strokeStyle = 'rgba(90,80,58,0.20)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(48, y + noteDrop + step * 0.24);
      ctx.lineTo(PAGE_W - 48, y + noteDrop + step * 0.24);
      ctx.stroke();
      y += step + noteDrop;
    }
    return y;
  }

  function paintComplaints(face, model, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'Complaints and Fixes');
    ctx.fillStyle = '#3a4a40';
    ctx.font = `italic 400 ${T(19)}px Georgia, serif`;
    const heading = model.reviewsRead
      ? `${model.outstanding} still standing, ${model.settled} dealt with, from ${model.reviewsRead} reviews`
      : 'Nobody has written anything yet.';
    ctx.fillText(fitLine(ctx, heading, PAGE_W - 80), 40, 144);
    const rows = model.complaints.map((row) => ({
      label: row.label,
      value: row.count > 1 ? `${row.count} times` : 'once',
      struck: row.settled,
      muted: row.settled,
      note: row.settled ? 'put right' : (row.lastLabel ? `last heard ${row.lastLabel}` : ''),
    }));
    // and the jobs nobody has had to complain about yet, because the doors have
    // not been open long enough for anyone to see them
    for (const note of model.house.slice(0, Math.max(0, 7 - rows.length))) {
      rows.push({ label: note.text, value: 'not said yet', note: note.action || '' });
    }
    if (!rows.length) rows.push({ label: 'Nothing outstanding. The house behaves.', muted: true });
    ruledRows(ctx, rows.slice(0, 7), 190);
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return rows.length;
  }

  function paintRestoration(face, model, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'The Restoration Record');
    ctx.fillStyle = '#3a4a40';
    ctx.font = `italic 700 ${T(26)}px Georgia, serif`;
    ctx.fillText(model.total
      ? `${model.done} of ${model.total} put right`
      : 'Nothing surveyed yet.', 40, 148);
    let lastGroup = null;
    const rows = [];
    for (const row of model.rows.slice(0, 8)) {
      if (row.group !== lastGroup) {
        lastGroup = row.group;
        rows.push({ label: row.group.toUpperCase(), strong: true, muted: true });
      }
      rows.push({
        label: `   ${row.label}`,
        value: row.done ? 'done' : row.state,
        valueColor: row.done ? '#3f6b4a' : '#7a4a34',
        muted: row.done,
        // F3: the job that unblocks this one, under it, in the desk's quieter
        // hand. "dead" teaches nothing; "do the ceiling beams first" does.
        note: row.blockedBy ? `do ${row.blockedBy} first` : '',
      });
    }
    if (!rows.length) rows.push({ label: 'The survey has not been done.', muted: true });
    ruledRows(ctx, rows.slice(0, 9), 196, { labelFont: 19, valueFont: 19, maxStep: 44 });
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return rows.length;
  }

  function paintFirsts(face, firsts, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'Firsts');
    ctx.fillStyle = '#3a4a40';
    ctx.font = `italic 400 ${T(19)}px Georgia, serif`;
    const done = firsts.filter((entry) => entry.done).length;
    ctx.fillText(`${done} of ${firsts.length} have happened.`, 40, 144);
    ruledRows(ctx, firsts.map((entry) => ({
      label: entry.label,
      value: entry.dateLabel,
      muted: !entry.done,
      valueColor: entry.done ? '#2c3e50' : 'rgba(107,114,104,0.66)',
      note: entry.done && entry.detail ? entry.detail : '',
    })), 190, { maxStep: 52 });
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return firsts.length;
  }

  function paintTakingsHistory(face, model, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'The Takings');
    ctx.fillStyle = '#3a4a40';
    ctx.font = `italic 400 ${T(18)}px Georgia, serif`;
    ctx.fillText(model.daysClosed
      ? `${model.daysClosed} days closed. Best ${money(model.best?.net || 0)}, worst ${money(model.worst?.net || 0)}.`
      : 'The first day is not closed yet.', 40, 140);
    // a column head, because this page is a table and the others are lists
    ctx.fillStyle = 'rgba(107,114,104,0.8)';
    ctx.font = `400 ${T(15)}px Georgia, serif`;
    ctx.fillText('DAY', 48, 172);
    ctx.textAlign = 'right';
    ctx.fillText('IN', PAGE_W - 300, 172);
    ctx.fillText('OUT', PAGE_W - 176, 172);
    ctx.fillText('NET', PAGE_W - 48, 172);
    ctx.textAlign = 'left';
    const rows = model.rows.slice(-9);
    const top = 202;
    const step = Math.min(46, Math.max(24, (contentBottom() - 14 - top) / Math.max(1, rows.length)));
    let y = top;
    for (const row of rows) {
      const strong = !row.closed;
      ctx.fillStyle = strong ? '#3f4a42' : '#6b7268';
      ctx.font = `${strong ? 700 : 400} ${T(18)}px Georgia, serif`;
      ctx.fillText(fitLine(ctx, row.dateLabel, 240), 48, y);
      ctx.textAlign = 'right';
      ctx.font = `400 ${T(18)}px Georgia, serif`;
      ctx.fillStyle = '#6b7268';
      ctx.fillText(money(row.revenue), PAGE_W - 300, y);
      ctx.fillText(money(row.expense), PAGE_W - 176, y);
      ctx.fillStyle = row.net >= 0 ? '#3f6b4a' : '#7a4a34';
      ctx.font = `700 ${T(18)}px Georgia, serif`;
      ctx.fillText(money(row.net), PAGE_W - 48, y);
      ctx.textAlign = 'left';
      ctx.strokeStyle = 'rgba(90,80,58,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(48, y + step * 0.24);
      ctx.lineTo(PAGE_W - 48, y + step * 0.24);
      ctx.stroke();
      y += step;
    }
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return rows.length;
  }

  function paintDeed(face, deed, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'The Deed');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3a4a40';
    ctx.font = `italic 700 ${T(30)}px Georgia, serif`;
    ctx.fillText(fitLine(ctx, deed.clubName, PAGE_W - 96), PAGE_W / 2, 158);
    if (deed.location) {
      ctx.fillStyle = '#6b7268';
      ctx.font = `italic 400 ${T(19)}px Georgia, serif`;
      ctx.fillText(fitLine(ctx, deed.location, PAGE_W - 120), PAGE_W / 2, 188);
    }
    ctx.textAlign = 'left';
    const na = (value, format) => (value == null ? 'not recorded' : format(value));
    ruledRows(ctx, [
      { label: 'Acquired', value: deed.acquiredLabel, strong: true },
      { label: 'Paid', value: na(deed.paid, (v) => money(v)) },
      { label: 'Valued at', value: na(deed.valuation, (v) => money(v)) },
      { label: 'Ground rent', value: na(deed.rent, (v) => `${money(v)} a month`) },
      { label: 'Land', value: na(deed.acres, (v) => `${v} acres`) },
      { label: 'Holes', value: deed.holes == null ? 'not recorded' : String(deed.holes) },
      { label: 'Standing', value: `${deed.reputation} reputation` },
    ], 226, { maxStep: 50 });
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return 7;
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
    // MEASURE, THEN DRAW. The summary line is the tallest thing on the page
    // and the only one whose width follows the money, so the layout is solved
    // from the bottom up: the summary sits on the last line that clears the
    // foot band, and the rows share whatever height is left above it.
    const ahead = takings.net >= 0;
    const summary = `${ahead ? 'Ahead' : 'Down'} ${money(Math.abs(takings.net))} on the day.`;
    const summaryFont = `italic 700 ${T(28)}px Georgia, serif`;
    const probe = textBox(measurer(), summary, summaryFont, 48, 0);
    const summaryHeight = probe.y1 - probe.y0;
    const summaryBaseline = contentBottom() - (probe.y1 - 0);   // descent clears the band
    const top = 152;
    const available = summaryBaseline - summaryHeight - 18 - top;
    const step = Math.min(64, Math.max(34, available / rows.length));
    let y = top;
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
      ctx.moveTo(48, y + step * 0.25);
      ctx.lineTo(PAGE_W - 48, y + step * 0.25);
      ctx.stroke();
      y += step;
    }
    // and if the money is long enough to run past the page, shrink to fit
    // rather than print off the edge
    let font = summaryFont;
    let size = T(28);
    while (textBox(measurer(), summary, font, 48, 0).width > PAGE_W - 96 && size > T(17)) {
      size -= 1;
      font = `italic 700 ${size}px Georgia, serif`;
    }
    ctx.fillStyle = ahead ? '#2f5c46' : '#7a3a30';
    ctx.font = font;
    ctx.fillText(summary, 48, summaryBaseline);
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return rows.length;
  }

  // R5: "unearned = blank ruled pages". The locked spread used to be a drawn
  // leather strap and a brass buckle laid across the paper — a graphic saying
  // FORBIDDEN, which reads like a store page, not a book. A real ledger's
  // unearned sections are simply pages nobody has written on yet: the section
  // is headed, the lines are ruled and waiting, and one quiet italic says what
  // will fill them. Nothing is barred; there is just nothing there yet.
  function paintLocked(face, section, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, section.title);
    const top = 128;
    const bottom = contentBottom() - 40;
    const lines = Math.max(4, Math.floor((bottom - top) / 44));
    const step = (bottom - top) / lines;
    ctx.strokeStyle = 'rgba(96,78,50,0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < lines; i += 1) {
      const y = top + step * (i + 1);
      ctx.moveTo(56, y);
      ctx.lineTo(PAGE_W - 56, y);
    }
    ctx.stroke();
    // the ruled margin a bound register carries down its inner edge
    ctx.strokeStyle = 'rgba(150,86,66,0.24)';
    ctx.beginPath();
    ctx.moveTo(104, top);
    ctx.lineTo(104, bottom);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(107,114,104,0.85)';
    ctx.font = `italic 400 ${T(21)}px Georgia, serif`;
    ctx.fillText(
      fitLine(ctx, section.lockedLine || 'Nothing written here yet.', PAGE_W - 130),
      PAGE_W / 2,
      contentBottom() - 12,
    );
    ctx.textAlign = 'left';
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return 0;
  }

  function paintCourseLog(face, course, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'Course Log');
    const rows = [
      ['Holes open for play', `${course.open} of ${course.holeCount}`],
      ['Under renovation', String(course.renovating)],
      ['Still to build', String(course.construction + course.unbuilt)],
      ['Par for the round', String(course.par)],
      ['Green fee', money(course.greenFee)],
      ['Standing', `${course.reputation} of 100`],
    ];
    const top = 152;
    const step = Math.min(58, Math.max(32, (contentBottom() - 14 - top) / rows.length));
    let y = top;
    for (const [label, value] of rows) {
      ctx.fillStyle = '#6b7268';
      ctx.font = `400 ${T(23)}px Georgia, serif`;
      ctx.fillText(label, 48, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#2c3e50';
      ctx.font = `700 ${T(24)}px Georgia, serif`;
      ctx.fillText(value, PAGE_W - 48, y);
      ctx.textAlign = 'left';
      ctx.strokeStyle = 'rgba(90,80,58,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(48, y + step * 0.24);
      ctx.lineTo(PAGE_W - 48, y + step * 0.24);
      ctx.stroke();
      y += step;
    }
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return rows.length;
  }

  function paintChampions(face, champions, pageIndex) {
    const ctx = face.canvas.getContext('2d');
    paperGround(ctx);
    pageHeader(ctx, 'Champions');
    const top = 150;
    const step = Math.min(62, Math.max(34,
      (contentBottom() - 14 - top) / Math.max(1, champions.length)));
    let y = top;
    let written = 0;
    for (const entry of champions) {
      ctx.fillStyle = '#2c3a50';
      ctx.font = `400 ${T(26)}px ${SCRIPT_FONT}`;
      ctx.fillText(fitLine(ctx, entry.name, PAGE_W - 250), 56, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#3d3325';
      ctx.font = `400 ${T(22)}px Georgia, serif`;
      ctx.fillText(`${entry.visits} rounds`, PAGE_W - 56, y);
      ctx.textAlign = 'left';
      ctx.strokeStyle = 'rgba(96,78,50,0.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(56, y + step * 0.26);
      ctx.lineTo(PAGE_W - 56, y + step * 0.26);
      ctx.stroke();
      written += 1;
      y += step;
    }
    pageFooter(ctx, pageIndex);
    face.texture.needsUpdate = true;
    return written;
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
    let course = null;
    let champions = [];
    try { entries = rosterEntries(state); } catch { entries = []; }
    try { notes = houseNotes(state); } catch { notes = []; }
    try { day = daySheetSummary(state); } catch { day = null; }
    try { takings = takingsSummary(state); } catch { takings = null; }
    try { sections = journalSections(state); } catch { sections = []; }
    try { course = courseLogSummary(state); } catch { course = null; }
    try { champions = championEntries(state); } catch { champions = []; }
    // D3 — each new page reads its own summary, each behind its own guard, so a
    // save shaped by an older build loses one PAGE rather than the whole book.
    let complaints = null;
    let restoration = null;
    let firsts = [];
    let history = null;
    let deed = null;
    try { complaints = complaintsAndFixes(state); } catch { complaints = null; }
    try { restoration = restorationRecord(state); } catch { restoration = null; }
    try { firsts = firstsEntries(state); } catch { firsts = []; }
    try { history = takingsHistory(state); } catch { history = null; }
    try { deed = deedSummary(state); } catch { deed = null; }
    const guestPageCount = Math.max(1, Math.ceil(Math.max(1, entries.length) / ROWS_PER_PAGE));
    const pages = [{ kind: 'contents' }];
    const pageOfSection = {};
    pageOfSection.guests = pages.length + 1; // 1-based, printed in the ToC
    for (let p = 0; p < guestPageCount; p += 1) pages.push({ kind: 'guests', guestPage: p });
    // the house section paginates like the guest register - a dilapidated
    // starter has more notes than one page holds, and a note the book never
    // shows is teaching silently thrown away
    // D3: the seven sections the brief names, in its order. `notes` is still
    // paginated because a dilapidated starter has more outstanding jobs than one
    // page holds, and a note the book never shows is teaching thrown away — but
    // it now lives INSIDE Complaints and Fixes rather than as its own section.
    pageOfSection.complaints = pages.length + 1;
    pages.push({ kind: 'complaints' });
    const notesPageCount = Math.max(0, Math.ceil(Math.max(0, notes.filter((n) => n.outstanding).length - 7) / NOTES_PER_PAGE));
    for (let p = 0; p < notesPageCount; p += 1) pages.push({ kind: 'notes', notesPage: p });
    pageOfSection.restoration = pages.length + 1;
    pages.push({ kind: 'restoration' });
    pageOfSection.firsts = pages.length + 1;
    pages.push({ kind: 'firsts' });
    pageOfSection.takings = pages.length + 1;
    pages.push({ kind: 'takings' });
    // R5: the earned sections turn to their own page; the unearned ones turn
    // to ruled blanks. Either way the LEAF exists — locking withholds what is
    // written, never the page, so the book's thickness never changes under
    // the reader's hand.
    for (const section of sections.filter((entry) => ['course', 'deed'].includes(entry.id))) {
      pageOfSection[section.id] = pages.length + 1;
      if (section.locked) pages.push({ kind: 'locked', section });
      else if (section.id === 'course') pages.push({ kind: 'course' });
      else pages.push({ kind: 'deed' });
    }
    return {
      entries, notes, day, takings, sections, course, champions, pages, pageOfSection,
      complaints, restoration, firsts, takingsHistory: history, deed,
    };
  }

  // C3: the overlap ledger — {pageIndex, a, b} for every intersecting pair
  // of drawn strings, capped so a pathological page cannot flood memory.
  const LEDGER_OVERLAPS = [];
  function paintIndexWith(model, face, index) {
    const r = paintIndexWithInner(model, face, index);
    scanOverlaps(face, index);
    return r;
  }
  function scanOverlaps(face, pageIndex) {
    const draws = face.draws || [];
    for (let i = 0; i < draws.length; i += 1) {
      for (let j = i + 1; j < draws.length; j += 1) {
        const a = draws[i]; const b = draws[j];
        const xOver = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const yOver = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        // >2px both axes = a real collision, not kerning-tight neighbours
        if (xOver > 2 && yOver > 2 && LEDGER_OVERLAPS.length < 60) {
          LEDGER_OVERLAPS.push({ pageIndex, a: a.text, b: b.text, xOver: +xOver.toFixed(1), yOver: +yOver.toFixed(1) });
        }
      }
    }
  }
  function paintIndexWithInner(model, face, index) {
    if (face.draws) face.draws.length = 0;
    const clubName = state?.club?.name || state?.shop?.name || 'Pine Hills Municipal Golf';
    const page = model.pages[index];
    if (!page) return paintBlank(face);
    switch (page.kind) {
      case 'contents': return paintContents(face, clubName, model.sections, model.pageOfSection);
      case 'guests': return paintGuests(face, model.entries, page.guestPage, index + 1);
      case 'notes': return paintNotes(face, model.notes, page.notesPage, index + 1);
      case 'day': return paintDaySheet(face, model.day || {}, index + 1);
      case 'complaints': return paintComplaints(face,
        model.complaints || { complaints: [], house: [], outstanding: 0, settled: 0, reviewsRead: 0 }, index + 1);
      case 'restoration': return paintRestoration(face,
        model.restoration || { rows: [], done: 0, total: 0 }, index + 1);
      case 'firsts': return paintFirsts(face, model.firsts || [], index + 1);
      case 'takings': return model.takingsHistory
        ? paintTakingsHistory(face, model.takingsHistory, index + 1)
        : paintTakings(face, model.takings || {}, index + 1);
      case 'deed': return paintDeed(face, model.deed || { clubName: 'Pine Hills Municipal Golf', acquiredLabel: 'not recorded', reputation: 0 }, index + 1);
      case 'locked': return paintLocked(face, page.section, index + 1);
      case 'course': return paintCourseLog(face, model.course || {}, index + 1);
      case 'champions': return paintChampions(face, model.champions || [], index + 1);
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
  // A2/C5: the turn's deferred paint jobs (drained on visibility inside the
  // leaf animation) and the phase costs a driver reads instead of guessing
  const turnDeferred = [];
  const paintStats = { lastTurnFrameMs: 0, lastDeferredMs: 0 };
  let model = null;
  let deskSpot = null;   // where the book rose from, to lay it back
  let facePose = null;   // { position: Vector3(world), quaternion }
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchEuler = new THREE.Euler();

  // cueLog records what the book ASKED for, so a driver can check the paper
  // cues fire on the turn and the settle without reaching into the mixer (the
  // sfx reference is captured at construction, so wrapping it later misses).
  const cueLog = [];
  const play = (name) => {
    cueLog.push(name);
    if (cueLog.length > 64) cueLog.shift();
    if (sfx) sfx(name);
  };

  function spreadCount() {
    return model ? Math.ceil(model.pages.length / 2) : 1;
  }

  function paintSpread() {
    if (!model) model = readModel();
    let painted = 0;
    painted += paintIndexWith(model, leftFace, spread * 2);
    painted += paintIndexWith(model, rightFace, spread * 2 + 1);
    // the foot row goes on LAST, over whatever the page painted, so a long
    // page can never bury it - but the painters have already stopped at
    // contentBottom(), so it should never have anything to cover
    pageFoot(leftFace.canvas.getContext('2d'), 'left', spread * 2 + 1);
    pageFoot(rightFace.canvas.getContext('2d'), 'right', spread * 2 + 2);
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

  // R2 (2026-08-06): "too wide, cut off by the frame edges — that is most of
  // why it reads cheap. Whole spread in frame with margin on all four sides."
  //
  // Measured on the shipped build, the open book filled 90.5% of the frame's
  // width and sat 42 px left of centre, leaving a 33 px margin on one side and
  // 118 on the other. Both faults came from the same assumption: that the
  // GUTTER is the book's centre, and that a hand-tuned FACE_DISTANCE would
  // frame it. The gutter is not the centre — the covers, brass caps and the
  // ribbon tail are not symmetric about it — and a fixed distance cannot know
  // the aspect ratio it is being framed in.
  //
  // So the pose is SOLVED instead: measure the open book's own bounding box
  // once, put its centre on the view axis, and set the distance from the
  // camera's actual FOV so the box subtends at most FRAME_FILL of the frame in
  // BOTH axes. The margin is then a guarantee at any window size, not a hope.
  const FRAME_FILL = 0.74;      // the fraction of the frame the book may cover
  let openBounds = null;        // { center: Vector3, corners: Vector3[] } in root space

  function measureOpenBounds() {
    if (!openShell.children.length) return null;
    const wasVisible = openShell.visible;
    openShell.visible = true;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let found = false;
    openShell.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      if (node === leafFront.mesh || node === leafBack.mesh) return;  // the leaf is transient
      node.geometry.computeBoundingBox();
      const bounds = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
      if (found) box.union(bounds); else { box.copy(bounds); found = true; }
    });
    openShell.visible = wasVisible;
    if (!found) return null;
    // back into the root's own frame, so it survives the book being moved
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const local = box.clone().applyMatrix4(inverse);
    const min = local.min; const max = local.max;
    const corners = [];
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
    return { center: local.getCenter(new THREE.Vector3()), corners };
  }

  function computeFacePose() {
    if (!camera) return null;
    camera.updateMatrixWorld(true);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const yaw = Math.atan2(-forward.x, -forward.z);
    // the spread leans up toward the eye like a journal in two hands
    const quaternion = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(FACE_TILT - Math.PI / 2, yaw + Math.PI, 0, 'YXZ'));
    if (!openBounds) openBounds = measureOpenBounds();

    let distance = FACE_DISTANCE;
    let offset = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).multiplyScalar(-HINGE_X);
    if (openBounds && Number.isFinite(camera.fov) && Number.isFinite(camera.aspect)) {
      // the book's extent along the camera's own right/up axes, once turned
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const center = openBounds.center.clone().applyQuaternion(quaternion);
      let halfRight = 0; let halfUp = 0;
      for (const corner of openBounds.corners) {
        const turned = corner.clone().applyQuaternion(quaternion).sub(center);
        halfRight = Math.max(halfRight, Math.abs(turned.dot(right)));
        halfUp = Math.max(halfUp, Math.abs(turned.dot(up)));
      }
      const halfFovY = (camera.fov * Math.PI) / 360;
      const halfFovX = Math.atan(Math.tan(halfFovY) * camera.aspect);
      const needX = halfRight / (Math.tan(halfFovX) * FRAME_FILL);
      const needY = halfUp / (Math.tan(halfFovY) * FRAME_FILL);
      distance = Math.max(0.26, needX, needY);
      // put the measured CENTRE on the axis, not the gutter
      offset = center.clone().multiplyScalar(-1);
    }
    const position = eye.clone()
      .addScaledVector(forward, distance)
      .add(new THREE.Vector3(0, -FACE_DROP, 0))
      .add(offset);
    return { position, quaternion };
  }

  // D1/D2 — WARM THE BOOK WHILE THE PLAYER IS STILL WALKING UP TO IT.
  //
  // Called from the desk prop's own label callback, which fires exactly when the
  // player is inside the book's reach and roughly facing it — the same moment
  // the "[E] read" prompt appears. Cheap on every call after the first: the
  // model is rebuilt only when the day has turned or the page count has moved,
  // because the summaries behind it are day-granular.
  let prewarmedKey = null;
  function prewarm() {
    const dayAbs = Math.floor((state?.clock?.minutes || 0) / 1440);
    const key = `${dayAbs}:${state?.club?.reviews?.length || 0}:${state?.ledger?.history?.length || 0}`;
    if (model && prewarmedKey === key) return false;
    model = readModel();
    prewarmedKey = key;
    facePose = computeFacePose();
    paintTitleFace();
    // ...AND THE FIRST SPREAD. Moving only readModel() out of the swing left the
    // stall at 104 ms against 112: the summaries are arithmetic, and the cost is
    // painting two 768px page canvases and uploading them. The spread the book
    // opens ON is always spread 0, so it can be painted now.
    spread = 0;
    paintSpread();
    return true;
  }

  function setOpen(next) {
    const wantOpen = !!next;
    const isOpenish = bookState === 'open' || bookState === 'opening';
    if (wantOpen === isOpenish) return isOpenish;
    if (wantOpen) {
      if (carried) return false; // a book in your arms is not a book to read
      // D2 — THE GLITCH IN THE OPEN IS WORK, NOT MOTION.
      //
      // Measured in Electron (tools/qa/electron-ledger-prompt-and-pages.js,
      // 2026-08-06): across 436 frames of the swing the cover angle moves in
      // steps of at most 0.03 of PI — the animation itself is smooth — but ONE
      // frame costs 112.5 ms. It is this line and the two below it: readModel()
      // runs all seven page summaries and paintSpread() paints two 768px
      // canvases and uploads them, all inside the frame that starts the swing.
      // So the book stands still for a tenth of a second and then jumps.
      //
      // prewarm() does the same work while the player is walking up to the desk,
      // and is a no-op if it has already run for this state. By the time E is
      // pressed there is nothing left to compute.
      // repaints only if the day turned since the walk-up; otherwise free
      if (!prewarm() && spread !== 0) { spread = 0; paintSpread(); }
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
    // A2/C5: a turn used to paint FOUR 768px canvases in one frame (both
    // leaf faces + both destination faces) — the measured hitch. Paints now
    // follow VISIBILITY: at the turn frame only the leaf's front and the
    // face being revealed under its lift exist on screen; the leaf's back
    // is hidden until the flip passes 90° (deferred to t≥0.25) and the
    // face the leaf lands ON is covered until it settles (t≥0.55, painted
    // by the full paintSpread with page feet). Worst frame: 2 paints.
    // A2/C5 VERDICT (probe chain, runs 5-10 of the acceptance driver): every
    // FRAME that carries canvas uploads pays one FIXED ~55 ms stall on this
    // stack (Electron/ANGLE canvas->texture sync) — size-independent
    // (half-res leaf: no change), not mipmaps (off: no change), not shader
    // churn (programGrowth 0), not the room (ambient windows 18-23 ms, zero
    // over-33), not the harness (direct API turns identical). Uploads in the
    // SAME frame share ONE stall, so batching all five paints on the turn
    // frame is the honest minimum: exactly one ~55 ms frame per turn. The
    // visibility-split tried first (2 paints at t0, rest at t.25/t.55) made
    // THREE hitch frames per turn and was reverted on the evidence. The
    // 16 ms bound is unreachable for that one frame on this stack, and the
    // report says so with this chain as the exhibit.
    const t0 = performance.now();
    turnDeferred.length = 0;
    if (direction > 0) {
      paintIndexWith(model, leafFront, spread * 2 + 1);
      paintIndexWith(model, leafBack, next * 2);
    } else {
      paintIndexWith(model, leafBack, spread * 2);
      paintIndexWith(model, leafFront, next * 2 + 1);
    }
    spread = next;
    paintSpread();
    paintStats.lastTurnFrameMs = +(performance.now() - t0).toFixed(1);
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
    // a close mid-flight must not leave deferred paints to fire into the
    // next open's spread
    leaf = null;
    turnDeferred.length = 0;
  }

  function update(dt) {
    // the leaf turn, whatever else is happening: an eased arc with a real
    // paper BEND through the middle and a settle cue as it lands
    if (leaf) {
      leaf.t = Math.min(1, leaf.t + dt / LEAF_SECONDS);
      // A2/C5: the deferred halves of the turn's paint work land on the
      // frames where their content first becomes visible
      while (turnDeferred.length && leaf.t >= turnDeferred[0].at) {
        const job = turnDeferred.shift();
        const tJob = performance.now();
        job.run();
        paintStats.lastDeferredMs = +(performance.now() - tJob).toFixed(1);
      }
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

    // the reading light comes up with the rise and falls with the close, so it
    // never pops on over a book still lying shut on the desk
    const lightWant = bookState === 'open' ? 1
      : bookState === 'opening' ? Math.min(1, stateT / 0.7)
        : bookState === 'closing' ? Math.max(0, 1 - stateT / 0.5) : 0;
    readingLight.intensity = lightWant * READING_LIGHT_MAX;
    readingLight.visible = readingLight.intensity > 0.001;

    if (bookState === 'opening') {
      stateT = Math.min(1, stateT + dt / OPEN_SECONDS);
      const rise = smoothstep(Math.min(1, stateT / 0.75));
      // C1: the face pose is re-solved every frame of the RISE, not captured
      // once at setOpen — pointer lock stays on now, so a player who turns
      // while the book comes up must have it come up to where they are
      // looking, not to where they were.
      const liveFace = computeFacePose();
      if (liveFace) facePose = liveFace;
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
    prewarm,
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
      // A2/C5: what the last turn actually paid at the turn frame vs in the
      // deferred visibility slots — the phase split a driver grades
      paintStats: { ...paintStats, deferredPending: turnDeferred.length },
      overlaps: LEDGER_OVERLAPS.slice(0, 60),
      glbReady: glbNodes.ready,
      float: bookState === 'open' ? 1 : (bookState === 'opening' ? +stateT.toFixed(2) : 0),
      cover: +Math.abs(glbNodes.cover.rotation.z / Math.PI).toFixed(2),
      spread,
      spreadCount: spreadCount(),
      pageCount: model ? model.pages.length : null,
      sections: model ? model.sections.map((s) => ({ id: s.id, locked: !!s.locked })) : [],
      turning: !!leaf,
      // R2's solve, exposed so a driver reads the same numbers the pose used
      frameFill: FRAME_FILL,
      framed: openBounds ? {
        center: openBounds.center.toArray().map((v) => +v.toFixed(4)),
        span: [
          +(Math.max(...openBounds.corners.map((c) => c.x))
            - Math.min(...openBounds.corners.map((c) => c.x))).toFixed(4),
          +(Math.max(...openBounds.corners.map((c) => c.y))
            - Math.min(...openBounds.corners.map((c) => c.y))).toFixed(4),
          +(Math.max(...openBounds.corners.map((c) => c.z))
            - Math.min(...openBounds.corners.map((c) => c.z))).toFixed(4),
        ],
      } : null,
      leafProfile: pageProfile ? {
        gutter: +pageProfile[0].toFixed(4),
        fore: +pageProfile[pageProfile.length - 1].toFixed(4),
        pivotY: +gutterHeight.toFixed(4),
      } : null,
      footTop,
      readingLight: {
        intensity: +readingLight.intensity.toFixed(3),
        visible: readingLight.visible,
        max: READING_LIGHT_MAX,
      },
      cues: cueLog.slice(-12),
      ...lastPaint,
    }),
  };
}
