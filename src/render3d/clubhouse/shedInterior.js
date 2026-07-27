// THE SHED'S DIRTY CONTENT — placeholder furniture, the eleven discrete
// cleaning-target visuals, the two service stations (mop bucket + waste bin),
// the intro/completion beats, and the pineHills-shaped applyCleaningTool()
// renderer half that drives the THREE-free sim (src/sim/shedCleaning.js).
//
// Module shape mirrors createPineHillsInterior: one whitelisted group under the
// interior root, a refresh() that reads state and repaints every visual, an
// applyCleaningTool(toolId, localX, localZ, dt, options) that resolves the
// nearest in-range target and returns the SAME {handled,did,targetId,reason}
// shape cleanWithTool's pre-gate consumes, an update(dt) for sway + the
// completion watch, and a dispose() that releases everything it mints.
//
// Window targets are special (trap #1): tool contact routes through
// cleanShedWindow(state, index, amount) so the film in reno.windows[] drains and
// mirror-drives the target — never through the generic schedule path, which
// would advance the target while leaving the completion-gating film untouched.
//
// Every node is named 'ShedInteriorLayer' (the interior-added root, whitelisted
// by startsWith('Shed')) or SHED_*-prefixed beneath it; only the root passes
// through interior.add(), so the case-sensitive 'Shed' whitelist covers the lot.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  TARGET_POSES, FURNITURE, STATIONS,
  DOOR, WINDOWS, SHED_PROP_PLACEMENTS, SHED_FLOOR_PARK, SHED_CLUTTER_SPOTS,
} from '../../data/shedLayout.js';
import {
  SHED_TARGET_IDS, SHED_TARGET_SCHEDULES, applyShedToolProgress, cleanShedWindow,
  shedCleanupComplete, shedTargetAction,
} from '../../sim/shedCleaning.js';
import { ensureShedScene } from '../../sim/shedScene.js';
import {
  cleaningStatus, serviceMop, changeBucketWater, emptyPanIntoBag, tieBag, disposeTiedBag,
} from '../../sim/cleaningToolState.js';

const round3 = (v) => Math.round(v * 1000) / 1000;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Presentation copy for a target-complete beat. Mirrors SHED_TARGET_LABELS in
// src/sim/shedCleaning.js (kept out of the sim's export surface on purpose);
// the ids are held in sync by tests, so drift is caught there.
const SHED_TARGET_TOASTS = Object.freeze({
  'web:corner-nw': 'Northwest cobweb cleared.',
  'web:corner-ne': 'Northeast cobweb cleared.',
  'bench:grease': 'Workbench grease scrubbed off.',
  'wall:scuff-door': 'Scuff by the door wiped clean.',
  'floor:oil-patch': 'Oil patch scrubbed out.',
  'shelf:dust': 'Shelf dust wiped away.',
  'entry:leaf-drift': 'Leaf drift swept and bagged.',
  'trash:cans': 'Trash cans cleared out.',
  'trash:pizza-box': 'Pizza box thrown out.',
  'window:south': 'South window is clear.',
  'window:east': 'East window is clear.',
});

const MESSAGED_REASONS = new Set(['spray-first', 'sweep-first', 'bag-tied', 'bag-full']);
const WINDOW_INDEX = { 'window:south': 0, 'window:east': 1 };
const WINDOW_LOOSEN = 0.7;      // film level after a spray snap = target 0.3
const WINDOW_CLOTH_RATE = 0.95; // film drained per second of steady cloth contact

export function createShedInterior({
  interior,
  state,
  addProp = () => {},
  removeProp = () => {},
  addCol = (c) => c,
  colBoxAt = (x, z, w, d) => ({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }),
  L2W = (x, z) => ({ x, z }),
  mats = {},
  hooks = {},
  presentRestorationFeedback = () => {},
  refreshFilms = () => {},
  loader = new GLTFLoader(),
} = {}) {
  if (!interior?.add) throw new TypeError('Shed interior requires an Object3D mount.');

  const group = new THREE.Group();
  group.name = 'ShedInteriorLayer';
  interior.add(group);

  // --- minted-resource ledger (shared B.mats materials are NOT tracked) -------
  const ownedGeo = [];
  const ownedMat = [];
  const ownedTex = [];
  const props = [];
  const kitRoots = [];      // authored GLB kit props (own their loader-clone resources)
  let disposed = false;
  const geo = (g) => { ownedGeo.push(g); return g; };
  const mat = (m) => { ownedMat.push(m); return m; };
  const tex = (t) => { ownedTex.push(t); return t; };

  const wood = mats.rawWood || mat(new THREE.MeshStandardMaterial({ color: 0xcaa877, roughness: 0.9 }));
  const darkWood = mats.walnutDark || mat(new THREE.MeshStandardMaterial({ color: 0x3c2a1c, roughness: 0.85 }));
  const metal = mats.charcoal || mat(new THREE.MeshStandardMaterial({ color: 0x33352f, roughness: 0.7 }));
  const steel = mats.iron || metal;

  const say = (msg, tone) => { if (hooks.toast) hooks.toast(msg, tone); };

  // ==========================================================================
  //  PLACEHOLDER FURNITURE — simple box/prism assemblies, one group per
  //  placement name (Phase-4 GLB swap slots). Colliders use the layout AABBs.
  // ==========================================================================
  function partGroup(name, x, z) {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, 0, z);
    group.add(g);
    return g;
  }
  function box(parent, w, h, d, material, x, y, z) {
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function cyl(parent, rt, rb, h, material, x, y, z, seg = 16) {
    const m = new THREE.Mesh(geo(new THREE.CylinderGeometry(rt, rb, h, seg)), material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  const furniture = {};

  // Workbench: top slab + four legs + a lower shelf (footprint 4.6 x 1.1).
  {
    const wb = FURNITURE.workbench;
    const g = partGroup('SHED_Workbench', wb.x, wb.z);
    const H = 0.92;
    box(g, wb.w, 0.08, wb.d, wood, 0, H, 0);
    const lx = wb.w / 2 - 0.18;
    const lz = wb.d / 2 - 0.14;
    for (const sxn of [-1, 1]) for (const szn of [-1, 1]) box(g, 0.1, H, 0.1, darkWood, sxn * lx, H / 2, szn * lz);
    box(g, wb.w - 0.5, 0.05, wb.d - 0.3, wood, 0, 0.28, 0);
    // a little back board so it reads as a bench, not a table
    box(g, wb.w, 0.5, 0.06, wood, 0, H + 0.27, -wb.d / 2 + 0.03);
    addCol(colBoxAt(wb.x, wb.z, wb.w, wb.d));
    furniture.workbench = g;
  }

  // Shelving: two uprights + three boards, flush to the west wall (0.7 x 2.8).
  {
    const sh = FURNITURE.shelving;
    const g = partGroup('SHED_Shelving', sh.x, sh.z);
    const H = 2.0;
    for (const szn of [-1, 1]) {
      box(g, 0.08, H, 0.08, darkWood, -sh.w / 2 + 0.06, H / 2, szn * (sh.d / 2 - 0.08));
      box(g, 0.08, H, 0.08, darkWood, sh.w / 2 - 0.06, H / 2, szn * (sh.d / 2 - 0.08));
    }
    const boards = [0.5, 1.15, 1.8];
    for (const by of boards) box(g, sh.w, 0.05, sh.d, wood, 0, by, 0);
    addCol(colBoxAt(sh.x, sh.z, sh.w, sh.d));
    furniture.shelving = g;
  }

  // Crate stack: two-three stacked boxes (1.1 x 1.1). Pizza box sits on top.
  let crateTop = 0;
  {
    const cs = FURNITURE.crateStack;
    const g = partGroup('SHED_CrateStack', cs.x, cs.z);
    const sizes = [0.6, 0.5, 0.4];
    let y = 0;
    for (let i = 0; i < 3; i++) {
      const s = sizes[i];
      box(g, s, s, s, i % 2 ? wood : darkWood, (i % 2 ? 0.06 : -0.05), y + s / 2, (i % 2 ? -0.04 : 0.05));
      y += s;
    }
    crateTop = y;
    addCol(colBoxAt(cs.x, cs.z, cs.w, cs.d));
    furniture.crateStack = g;
  }

  // Sawhorse: a small A-frame (no collider — layout marks it collider-free).
  {
    const sw = FURNITURE.sawhorse;
    const g = partGroup('SHED_Sawhorse', sw.x, sw.z);
    box(g, 1.0, 0.09, 0.12, wood, 0, 0.72, 0);
    for (const sxn of [-1, 1]) for (const szn of [-1, 1]) {
      const leg = box(g, 0.06, 0.78, 0.06, darkWood, sxn * 0.42, 0.36, szn * 0.16);
      leg.rotation.z = sxn * 0.16;
    }
    furniture.sawhorse = g;
  }

  // Mop bucket: yellow body + a grey wringer block (also the mop station).
  {
    const b = STATIONS.mopBucket;
    const g = partGroup('SHED_Bucket', b.x, b.z);
    const yellow = mat(new THREE.MeshStandardMaterial({ color: 0xd7b032, roughness: 0.55 }));
    cyl(g, 0.28, 0.22, 0.42, yellow, 0, 0.21, 0, 18);
    box(g, 0.34, 0.2, 0.24, metal, 0, 0.52, -0.02);
    furniture.bucket = g;
  }

  // Waste bin: a dark cylinder (also the disposal station).
  {
    const b = STATIONS.disposalBin;
    const g = partGroup('SHED_DisposalBin', b.x, b.z);
    cyl(g, 0.3, 0.26, 0.72, metal, 0, 0.36, 0, 18);
    cyl(g, 0.31, 0.31, 0.05, steel, 0, 0.72, 0, 18);
    furniture.bin = g;
  }

  // Tool rack: a wall board with a few pegs, flush to the west wall.
  {
    const g = partGroup('SHED_ToolRack', -3.9, -1.6);
    box(g, 0.06, 0.7, 1.4, darkWood, 0, 1.4, 0);
    for (const pz of [-0.45, 0, 0.45]) cyl(g, 0.03, 0.03, 0.18, steel, 0.12, 1.5, pz, 8).rotation.z = Math.PI / 2;
    furniture.toolRack = g;
  }

  const FURNITURE_COUNT = Object.keys(furniture).length; // derived from the built registry (was a magic 7)

  // ==========================================================================
  //  AUTHORED KIT — swap the placeholder wall rack for the walnut tool rack,
  //  dress the two shell window openings and the doorway, and scatter floor
  //  parks + clutter. Visual-only on purpose: the GLB collision proxies and the
  //  window glazing are hidden (the shell owns the colliders, the glazed pane
  //  and the wipeable dirt film), and nothing here calls addCol/addProp, so the
  //  shed's collider-count and focus-prompt contracts hold. Every kit root mounts
  //  under `group`, which is the whitelisted node, so suppression never touches it.
  // ==========================================================================
  const KIT_DIR = 'vendor/models/shed/';

  function prepKit(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.name || '';
      if (/^COL_/i.test(name) || o.userData?.collision_proxy === true
        || /glass/i.test(name) || o.userData?.pane_glass === true) {
        o.visible = false;
        return;
      }
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  function mountKit(part, parent, pose, { y = 0, scale = 1.0, onReady } = {}) {
    loader.load(`${KIT_DIR}shed_${part}.glb`, (gltf) => {
      if (disposed) return;
      const root = gltf.scene;
      root.name = `SHED_Kit_${part}`;
      root.scale.setScalar(scale);
      root.position.set(pose.x || 0, y, pose.z || 0);
      root.rotation.y = pose.ry || 0;
      prepKit(root);
      (parent || group).add(root);
      kitRoots.push(root);
      if (onReady) onReady(root);
    }, undefined, () => { /* a missing kit GLB leaves the placeholder in place */ });
  }

  // Tool wall rack: mount under SHED_ToolRack (panel centre at y 1.4, facing east off the
  // west wall) and retire the placeholder panel + pegs once the authored rack arrives.
  mountKit('wallrack', furniture.toolRack, { ry: Math.PI / 2 }, {
    y: 1.4,
    onReady: () => {
      for (const child of [...furniture.toolRack.children]) {
        if (child.isMesh) furniture.toolRack.remove(child);
      }
    },
  });

  // Window casings dressing the two shell openings — nudged just inside the opening so the
  // walnut frame reads from the room without z-fighting the shell's charcoal frame. The
  // shell's glazed pane + dirt film stay untouched behind them (glass hidden on mount).
  // Once the casing lands, the shell's charcoal placeholder frame + muntin RETIRE
  // (same pattern as the wallrack swap): left visible they poke out around and
  // behind the walnut casing as dark slabs that read as leftover grime even on a
  // fully cleaned window (visual-QA iteration 1, defect #3). The placeholder
  // chrome is exactly the holder's BoxGeometry children; the glazed pane and the
  // shedDirt film are planes and MUST stay visible.
  const retireShellWindowChrome = (id) => () => {
    const shellRoot = interior.parent || interior;
    const holder = shellRoot.getObjectByName?.(`ShedWindow_${id}`);
    if (!holder) return;
    for (const child of holder.children) {
      if (child.isMesh && child.geometry?.type === 'BoxGeometry') child.visible = false;
    }
  };
  {
    const south = SHED_PROP_PLACEMENTS.SHED_WindowSouth;
    mountKit('window', group, { x: south.x, z: south.z - 0.09, ry: south.ry },
      { y: WINDOWS[0].sill + WINDOWS[0].h / 2, onReady: retireShellWindowChrome('south') });
    const east = SHED_PROP_PLACEMENTS.SHED_WindowEast;
    mountKit('window', group, { x: east.x - 0.09, z: east.z, ry: east.ry },
      { y: WINDOWS[1].sill + WINDOWS[1].h / 2, onReady: retireShellWindowChrome('east') });
  }

  // Door frame around the open south doorway (opening stays passable — no collider).
  mountKit('door', group, { x: DOOR.x, z: DOOR.z - 0.02, ry: 0 }, { y: 0 });

  // Floor parks near the tool rack, and clutter scattered across the open floor.
  // Matte-down the park mats on mount: the authored materials (roughness
  // 0.56-0.66) catch the bulb as a broad specular core, so the dark mats read
  // as glossy glass tablets instead of rubber parking mats (visual-QA
  // iteration 3, defect #2). Roughness-only — colors and geometry untouched.
  mountKit('parks', group, SHED_FLOOR_PARK, {
    y: 0.002,
    onReady: (root) => {
      root.traverse((o) => {
        if (o.isMesh && o.material && o.material.roughness != null) o.material.roughness = 0.92;
      });
    },
  });

  // Per-spot clutter dressing so the same authored cluster GLB never repeats
  // verbatim (visual-QA iteration 2, defect #1: three identical
  // rope/rag/bottle/can groups read as copy-paste). Spot 0 keeps the full
  // authored set; the other spots hide whole semantic prop groups (the kit's
  // COL_* proxies name them: PaintCans = Cylinder..Cylinder_3 primitives,
  // Solvent = Cylinder007*, plus MESH_RagPile / MESH_Rope) and take their own
  // scale + extra yaw. Visibility-only: node names and counts are untouched,
  // so the acceptance census and the collider/prompt contracts hold.
  const CLUTTER_VARIANTS = [
    { scale: 1.0, ry: 0, hide: [] },                                        // full cluster
    { scale: 0.92, ry: 1.15, hide: [/^Cylinder(_\d+)?$/] },                 // no cans/red rag
    { scale: 1.06, ry: -0.6, hide: [/^Cylinder007/, /^MESH_Rope$/] },       // no solvent/rope
  ];
  SHED_CLUTTER_SPOTS.forEach((spot, i) => {
    const variant = CLUTTER_VARIANTS[i % CLUTTER_VARIANTS.length];
    mountKit('clutter', group, { x: spot.x, z: spot.z, ry: (spot.ry || 0) + variant.ry }, {
      scale: variant.scale,
      onReady: (root) => {
        root.name = `SHED_Kit_clutter_${i}`;
        root.traverse((o) => {
          if (o.isMesh && variant.hide.some((re) => re.test(o.name))) o.visible = false;
        });
      },
    });
  });

  // ==========================================================================
  //  TARGET VISUALS — one per SHED_TARGET_IDS entry (windows excepted; their
  //  film is owned by shedDirt). Cached for refresh().
  // ==========================================================================
  const targetVisual = {};

  function decalMat(rgb, opacity, rough = 0.5) {
    return mat(new THREE.MeshStandardMaterial({
      color: new THREE.Color(rgb), transparent: true, opacity, roughness: rough,
      depthWrite: false, side: THREE.DoubleSide,
    }));
  }

  // --- cobweb texture (radial strands + arcs, apex at 0,0) -------------------
  const webTex = tex((() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(226, 224, 214, 0.55)';
    g.lineWidth = 1.1;
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); g.stroke();
    }
    for (let r = 20; r <= 120; r += 20) {
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI / 2); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })());

  function makeCobweb(name, cx, cz, faceSign) {
    const g = new THREE.Group();
    g.name = name;
    // Anchored at 2.52 (was 2.35) and pulled 0.12 deeper into the corner: at
    // 2.35 the NW fan's lower spokes cut straight through the wall rack's top
    // rail (rack top ~1.83) and read as clipping (visual-QA iteration 3,
    // defect #1). Visual-only — TARGET_POSES contact circles are untouched,
    // and the fan top stays under the 2.86 ceiling deck.
    g.position.set(cx, 2.52, cz + (cz < 0 ? -0.12 : 0.12));
    const webMat = mat(new THREE.MeshStandardMaterial({
      map: webTex, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, roughness: 1,
    }));
    for (let i = 0; i < 3; i++) {
      const fan = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.9, 0.9)), webMat);
      fan.position.set(faceSign * -0.2, -0.2 - i * 0.02, 0.0 + i * 0.06);
      fan.rotation.set(-0.5, faceSign * (0.6 + i * 0.2), faceSign * 0.4);
      g.add(fan);
    }
    group.add(g);
    return g;
  }
  targetVisual['web:corner-nw'] = makeCobweb('SHED_Cobweb_NW', TARGET_POSES['web:corner-nw'].x, TARGET_POSES['web:corner-nw'].z, 1);
  targetVisual['web:corner-ne'] = makeCobweb('SHED_Cobweb_NE', TARGET_POSES['web:corner-ne'].x, TARGET_POSES['web:corner-ne'].z, -1);
  const cobwebSway = [targetVisual['web:corner-nw'], targetVisual['web:corner-ne']];

  // --- bench grease: an irregular soaked-in stain on the bench top -----------
  // Canvas-alpha decal instead of a bare colored quad: the plain plane read as
  // a razor-edged pure-black hole cut into the bench (visual-QA iteration 2,
  // defect #2). Soft-edged overlapping blots + satellite drips keep the same
  // quad/fade contract (refresh drives material.opacity) while reading as
  // grease that soaked into the wood.
  {
    const p = TARGET_POSES['bench:grease'];
    const greaseTex = tex((() => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const g = c.getContext('2d');
      const blob = (x, y, r, a, squash = 1) => {
        const grad = g.createRadialGradient(x, y, r * 0.15, x, y, r);
        grad.addColorStop(0, `rgba(30, 24, 18, ${a})`);
        grad.addColorStop(0.72, `rgba(26, 21, 16, ${a * 0.8})`);
        grad.addColorStop(1, 'rgba(26, 21, 16, 0)');
        g.save();
        g.translate(x, y);
        g.scale(1, squash);
        g.translate(-x, -y);
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
        g.restore();
      };
      blob(60, 34, 34, 0.98, 0.8);   // main soak
      blob(84, 26, 22, 0.9, 0.9);    // smeared lobe
      blob(40, 40, 18, 0.85, 0.75);  // second lobe
      for (let i = 0; i < 7; i++) {  // satellite drips
        const a = i * 2.6 + 0.9;
        blob(64 + Math.cos(a) * (30 + i * 3.1), 32 + Math.sin(a) * (16 + i * 1.7), 4.5 + (i % 3) * 2, 0.75);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })());
    const m = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.3, 0.7)), mat(new THREE.MeshStandardMaterial({
      map: greaseTex, transparent: true, opacity: 0.85, roughness: 0.3,
      depthWrite: false, side: THREE.DoubleSide,
    })));
    m.name = 'SHED_BenchGrease';
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, 0.965, p.z); // just above the 0.96 bench-top surface
    m.renderOrder = 4;
    group.add(m);
    targetVisual['bench:grease'] = m;
  }

  // --- wall scuff by the door: smudged boot/gear marks on the south wall -----
  // Canvas-alpha decal for the same reason as the bench grease: the bare
  // colored quad read as a hard-edged dark rectangle stuck on the wall
  // (visual-QA iteration 3, defect #3). Vertical drag smears + heel arcs with
  // soft edges keep the fading-quad contract while reading as scuffed paint.
  {
    const p = TARGET_POSES['wall:scuff-door'];
    const scuffTex = tex((() => {
      const c = document.createElement('canvas');
      c.width = 96; c.height = 112;
      const g = c.getContext('2d');
      const smear = (x, y, w, h, a) => {
        const grad = g.createRadialGradient(x, y, 2, x, y, Math.max(w, h));
        grad.addColorStop(0, `rgba(38, 31, 24, ${a})`);
        grad.addColorStop(1, 'rgba(38, 31, 24, 0)');
        g.save();
        g.translate(x, y);
        g.scale(w / Math.max(w, h), h / Math.max(w, h));
        g.translate(-x, -y);
        g.fillStyle = grad;
        g.fillRect(x - Math.max(w, h), y - Math.max(w, h), Math.max(w, h) * 2, Math.max(w, h) * 2);
        g.restore();
      };
      smear(48, 62, 26, 44, 0.95);  // main dragged smudge
      smear(30, 84, 16, 30, 0.8);   // low left smear
      smear(66, 44, 14, 26, 0.75);  // upper right smear
      smear(52, 96, 20, 12, 0.7);   // baseboard-height rub
      g.strokeStyle = 'rgba(30, 24, 18, 0.5)';
      g.lineCap = 'round';
      for (let i = 0; i < 5; i++) {  // heel-drag arcs
        g.lineWidth = 2.5 + (i % 2);
        g.beginPath();
        g.arc(34 + i * 9, 58 + (i % 3) * 14, 12 + i * 2.5, 0.4 + i * 0.5, 1.6 + i * 0.5);
        g.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })());
    const m = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.8, 0.95)), mat(new THREE.MeshStandardMaterial({
      map: scuffTex, transparent: true, opacity: 0.8, roughness: 0.7,
      depthWrite: false, side: THREE.DoubleSide,
    })));
    m.name = 'SHED_WallScuff';
    m.position.set(p.x, 1.15, 3.0);
    m.rotation.y = Math.PI; // face into the room (-z)
    group.add(m);
    targetVisual['wall:scuff-door'] = m;
  }

  // --- floor oil patch: darker ring quad above the grime plane ---------------
  {
    const p = TARGET_POSES['floor:oil-patch'];
    // matte (high roughness) so the overhead bulb does not reflect off it as a
    // gray specular blob — an oil stain reads as a dead-flat dark ring.
    const m = new THREE.Mesh(geo(new THREE.CircleGeometry(0.6, 24)), decalMat(0x140f0b, 0.72, 0.98));
    m.name = 'SHED_OilPatch';
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, 0.033, p.z); // above grime(0.026)/wet(0.028)
    m.renderOrder = 5;
    group.add(m);
    targetVisual['floor:oil-patch'] = m;
  }

  // --- shelf dust: pale strips on the shelf boards ---------------------------
  {
    const g = new THREE.Group();
    g.name = 'SHED_ShelfDust';
    const dustMat = decalMat(0xb8ad95, 0.65, 0.95);
    const sh = FURNITURE.shelving;
    for (const by of [0.53, 1.18, 1.83]) {
      const m = new THREE.Mesh(geo(new THREE.PlaneGeometry(sh.w - 0.06, sh.d - 0.1)), dustMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(sh.x, by, sh.z);
      g.add(m);
    }
    group.add(g);
    targetVisual['shelf:dust'] = g;
  }

  // --- entry leaf drift: ~14 flat leaves inside the drift radius -------------
  // Leaf-shaped alpha texture + per-leaf scale spread: the bare 0.16x0.11
  // quads read as scattered paper scraps, not leaves (visual-QA iteration 2,
  // defect #3). The pointed-oval silhouette with a midrib is tinted by the
  // material color, so the fade/gather/bag refresh contract is unchanged.
  {
    const p = TARGET_POSES['entry:leaf-drift'];
    const g = new THREE.Group();
    g.name = 'SHED_LeafDrift';
    const leafTex = tex((() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 44;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.beginPath(); // pointed oval: stem tip at left, apex at right
      ctx.moveTo(4, 22);
      ctx.bezierCurveTo(16, 2, 46, 4, 61, 22);
      ctx.bezierCurveTo(46, 40, 16, 42, 4, 22);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(96, 74, 40, 0.55)'; // midrib vein, darker after tint
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(6, 22);
      ctx.lineTo(58, 22);
      ctx.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })());
    const leafMat = mat(new THREE.MeshStandardMaterial({
      map: leafTex, color: 0x8a6a34, transparent: true, opacity: 0.95, roughness: 0.9,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    const leaves = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + i * 0.7;
      const rr = 0.2 + ((i * 37) % 100) / 100 * 0.75;
      const ox = Math.cos(a) * rr;
      const oz = Math.sin(a) * rr;
      const leaf = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.16, 0.11)), leafMat);
      leaf.rotation.x = -Math.PI / 2;
      leaf.rotation.z = a;
      leaf.position.set(p.x + ox, 0.04, p.z + oz);
      const s = 0.8 + ((i * 53) % 100) / 100 * 0.5; // deterministic size spread
      leaf.scale.set(s, s, 1);
      leaf.userData.base = { ox, oz };
      g.add(leaf);
      leaves.push(leaf);
    }
    group.add(g);
    targetVisual['entry:leaf-drift'] = g;
    g.userData.leaves = leaves;
    g.userData.center = { x: p.x, z: p.z };
  }

  // --- trash cans: 3-4 small cylinders in the radius -------------------------
  {
    const p = TARGET_POSES['trash:cans'];
    const g = new THREE.Group();
    g.name = 'SHED_TrashCans';
    const canMat = mat(new THREE.MeshStandardMaterial({ color: 0x9a9c8f, roughness: 0.6, metalness: 0.2 }));
    const spots = [[-0.35, -0.2], [0.3, 0.15], [-0.1, 0.4], [0.45, -0.35]];
    const cans = [];
    const TILT = 0.18;
    spots.forEach(([ox, oz], i) => {
      const h = 0.22 + (i % 2) * 0.06;
      // Rest the tilted rim ON the floor: with the old fixed 0.11 centre the
      // taller cans sank ~0.05 into the grime plane (visual-QA iteration 4,
      // defect #1). Lowest point of a tilted cylinder = h/2*cos + r*sin below
      // the centre, so seat the centre exactly that high (+ a hair of clear).
      const y = (h / 2) * Math.cos(TILT) + 0.12 * Math.sin(TILT) + 0.002;
      const can = cyl(g, 0.11, 0.12, h, canMat, p.x + ox, y, p.z + oz, 12);
      can.rotation.z = TILT * (i % 2 ? 1 : -1);
      cans.push(can);
    });
    group.add(g);
    targetVisual['trash:cans'] = g;
    g.userData.cans = cans;
  }

  // --- pizza box: flat box on the crate stack (direct-E) ---------------------
  {
    const cs = FURNITURE.crateStack;
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(0.5, 0.06, 0.5)), mat(new THREE.MeshStandardMaterial({ color: 0xb98a4e, roughness: 0.85 })));
    m.name = 'SHED_PizzaBox';
    m.position.set(cs.x + 0.05, crateTop + 0.05, cs.z - 0.02);
    m.rotation.y = 0.3;
    group.add(m);
    targetVisual['trash:pizza-box'] = m;
  }

  // ==========================================================================
  //  WIPE STREAKS — ONE reused 256^2 canvas-decal quad, repositioned per surface
  //  target. Cloth/sponge work stamps arc strokes along an advancing wipe phase;
  //  the whole quad fades over ~2 s, revealing the cleaner surface. One canvas,
  //  one quad — no per-target allocation.
  // ==========================================================================
  const wipeCanvas = document.createElement('canvas');
  wipeCanvas.width = 256; wipeCanvas.height = 256;
  const wipeCtx = wipeCanvas.getContext('2d');
  const wipeTex = tex(new THREE.CanvasTexture(wipeCanvas));
  wipeTex.colorSpace = THREE.SRGBColorSpace;
  const wipeQuad = new THREE.Mesh(
    geo(new THREE.PlaneGeometry(1, 1)),
    mat(new THREE.MeshBasicMaterial({
      map: wipeTex, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    })),
  );
  wipeQuad.name = 'SHED_WipeStreak';
  wipeQuad.renderOrder = 6;
  wipeQuad.visible = false;
  group.add(wipeQuad);
  const wipeWinY = WINDOWS[0].sill + WINDOWS[0].h / 2;
  const WIPE_PLACEMENT = {
    'bench:grease': { pos: [TARGET_POSES['bench:grease'].x, 0.985, TARGET_POSES['bench:grease'].z], rot: [-Math.PI / 2, 0, 0], size: [1.3, 0.7] },
    'wall:scuff-door': { pos: [TARGET_POSES['wall:scuff-door'].x, 1.15, 2.96], rot: [0, Math.PI, 0], size: [0.8, 0.95] },
    'shelf:dust': { pos: [FURNITURE.shelving.x, 1.185, FURNITURE.shelving.z], rot: [-Math.PI / 2, 0, 0], size: [FURNITURE.shelving.w - 0.06, FURNITURE.shelving.d - 0.1] },
    'window:south': { pos: [WINDOWS[0].x, wipeWinY, WINDOWS[0].z - 0.05], rot: [0, 0, 0], size: [WINDOWS[0].w * 0.7, WINDOWS[0].h * 0.7] },
    'window:east': { pos: [WINDOWS[1].x - 0.05, wipeWinY, WINDOWS[1].z], rot: [0, Math.PI / 2, 0], size: [WINDOWS[1].w * 0.7, WINDOWS[1].h * 0.7] },
  };
  let wipeTarget = null;
  let wipePhase = 0;
  let wipeOpacity = 0;
  function stampWipe(targetId) {
    const place = WIPE_PLACEMENT[targetId];
    if (!place) return;
    if (targetId !== wipeTarget) {
      wipeTarget = targetId;
      wipeCtx.clearRect(0, 0, 256, 256);
      wipePhase = 0;
      wipeQuad.position.set(place.pos[0], place.pos[1], place.pos[2]);
      wipeQuad.rotation.set(place.rot[0], place.rot[1], place.rot[2]);
      wipeQuad.scale.set(place.size[0], place.size[1], 1);
    }
    // a curved wipe stroke at the advancing phase — arcs sweeping across the surface
    wipePhase += 0.7;
    const cx = 128 + Math.cos(wipePhase) * 40;
    const cy = 128 + Math.sin(wipePhase * 0.8) * 46;
    wipeCtx.strokeStyle = 'rgba(216, 240, 242, 0.5)';
    wipeCtx.lineWidth = 16;
    wipeCtx.lineCap = 'round';
    wipeCtx.beginPath();
    wipeCtx.arc(cx, cy, 40 + (wipePhase % 3) * 10, wipePhase, wipePhase + 1.5);
    wipeCtx.stroke();
    wipeTex.needsUpdate = true;
    wipeOpacity = 0.5;
    wipeQuad.material.opacity = wipeOpacity;
    wipeQuad.visible = true;
  }
  function updateWipe(dt) {
    if (wipeOpacity <= 0) return;
    wipeOpacity = Math.max(0, wipeOpacity - dt / 2.0); // fade the whole quad over ~2 s
    wipeQuad.material.opacity = wipeOpacity;
    if (wipeOpacity <= 0) { wipeQuad.visible = false; wipeTarget = null; }
  }

  // ==========================================================================
  //  REFRESH — read state, repaint every visual, fire per-target beats.
  // ==========================================================================
  const prevProgress = {};
  let completedFired = Number.isFinite(ensureShedScene(state)?.completedAt);

  function targetProgress(id) {
    const shed = ensureShedScene(state);
    return clamp01(shed?.targets?.[id] || 0);
  }

  function refresh() {
    const shed = ensureShedScene(state);
    const targets = shed?.targets || {};

    // cobwebs: scale + fade with (1 - progress)
    for (const id of ['web:corner-nw', 'web:corner-ne']) {
      const g = targetVisual[id];
      const p = clamp01(targets[id] || 0);
      g.visible = p < 1;
      const k = 1 - p;
      g.scale.setScalar(0.5 + k * 0.5);
      g.traverse((o) => { if (o.material?.opacity != null && o !== g) o.material.opacity = 0.85 * k; });
    }
    // simple opacity decals
    const fade = (id, base) => {
      const v = targetVisual[id];
      const p = clamp01(targets[id] || 0);
      v.visible = p < 1;
      if (v.material) v.material.opacity = base * (1 - p);
    };
    fade('bench:grease', 0.85);
    fade('wall:scuff-door', 0.8);
    fade('floor:oil-patch', 0.7);
    // shelf dust: shared material across the three strips
    {
      const g = targetVisual['shelf:dust'];
      const p = clamp01(targets['shelf:dust'] || 0);
      g.visible = p < 1;
      g.children.forEach((m) => { if (m.material) m.material.opacity = 0.65 * (1 - p); });
    }
    // leaf drift: broom phase (0..0.66) draws them toward centre; bag phase removes
    {
      const g = targetVisual['entry:leaf-drift'];
      const p = clamp01(targets['entry:leaf-drift'] || 0);
      const leaves = g.userData.leaves;
      const c = g.userData.center;
      const gather = Math.min(1, p / 0.66);        // 0 -> spread, 1 -> piled at centre
      const bagged = Math.max(0, (p - 0.66) / 0.34); // 0 -> all present, 1 -> gone
      leaves.forEach((leaf, i) => {
        const b = leaf.userData.base;
        leaf.position.x = c.x + b.ox * (1 - gather * 0.72);
        leaf.position.z = c.z + b.oz * (1 - gather * 0.72);
        leaf.visible = (i / leaves.length) >= bagged;
      });
      g.visible = p < 1;
    }
    // trash cans: each disappears as progress crosses its fraction
    {
      const g = targetVisual['trash:cans'];
      const p = clamp01(targets['trash:cans'] || 0);
      const cans = g.userData.cans;
      cans.forEach((can, i) => { can.visible = p < (i + 1) / cans.length; });
      g.visible = p < 1;
    }
    // pizza box
    targetVisual['trash:pizza-box'].visible = clamp01(targets['trash:pizza-box'] || 0) < 1;

    // windows: film is owned by shedDirt
    refreshFilms();

    // per-target completion beats (edge-triggered)
    for (const id of SHED_TARGET_IDS) {
      const p = clamp01(targets[id] || 0);
      const prev = prevProgress[id];
      if (prev != null && prev < 1 && p >= 1) {
        hooks.sfx?.('shed-target-complete');
        say(SHED_TARGET_TOASTS[id], 'positive');
      }
      prevProgress[id] = p;
    }
    checkCompletion();
    return shed;
  }

  function checkCompletion() {
    if (completedFired) return;
    if (shedCleanupComplete(state)) {
      completedFired = true;
      presentRestorationFeedback({
        ok: true,
        events: [
          { type: 'audio', cue: 'clubhouse-restoration-complete' },
          { type: 'toast', tone: 'positive', text: 'The shed is spotless.' },
        ],
      });
    }
  }

  // ==========================================================================
  //  APPLY CLEANING TOOL — the renderer half of the sim's schedules.
  // ==========================================================================
  function applyWindowTool(targetId, toolId, dt) {
    const index = WINDOW_INDEX[targetId];
    const film = Number(state.shop?.reno?.windows?.[index]) || 0;
    if (film <= 0.01) return { handled: true, did: 0, targetId };
    if (toolId === 'spray') {
      if (film <= WINDOW_LOOSEN + 1e-6) return { handled: true, did: 0, targetId };
      const res = cleanShedWindow(state, index, film - WINDOW_LOOSEN);
      refresh();
      if (res.milestone) presentRestorationFeedback(res.milestone);
      return { handled: true, did: round3(film - res.left), targetId };
    }
    // cloth: only lifts what the spray loosened
    if (film > WINDOW_LOOSEN + 1e-6) return { handled: true, did: 0, reason: 'spray-first', targetId };
    const amount = Math.max(0.06, dt * WINDOW_CLOTH_RATE);
    const res = cleanShedWindow(state, index, amount);
    refresh();
    if (res.milestone) presentRestorationFeedback(res.milestone);
    if (film - res.left > 0.001) stampWipe(targetId);
    return { handled: true, did: round3(film - res.left), targetId };
  }

  function toolRelevant(targetId, toolId) {
    if (targetId in WINDOW_INDEX) return toolId === 'spray' || toolId === 'cloth';
    const sched = SHED_TARGET_SCHEDULES[targetId];
    if (!sched || sched.directE) return false;
    return sched.tools.includes(toolId);
  }

  function applyCleaningTool(toolId, localX, localZ, dt, options = {}) {
    const shed = ensureShedScene(state);
    if (!shed) return { handled: false, did: 0 };
    const targets = shed.targets || {};

    let best = null;
    let bestDist = Infinity;
    for (const targetId of SHED_TARGET_IDS) {
      const pose = TARGET_POSES[targetId];
      if (!pose) continue;
      if ((targets[targetId] || 0) >= 1) continue;
      if (!toolRelevant(targetId, toolId)) continue;
      const d = Math.hypot(localX - pose.x, localZ - pose.z);
      if (d > pose.radius) continue;
      if (d < bestDist) { bestDist = d; best = targetId; }
    }
    if (!best) return { handled: false, did: 0 };

    if (best in WINDOW_INDEX) return applyWindowTool(best, toolId, dt);

    const res = applyShedToolProgress(state, best, toolId, dt, {
      bagSpace: Number(options.bagSpace) || 0,
      bagTied: options.bagTied === true,
    });
    if (res.did > 0) {
      if (toolId === 'cloth' || toolId === 'sponge') stampWipe(best); // no-op unless best is a wipe surface
      refresh();
      return { handled: true, did: res.did, targetId: best };
    }
    if (res.blocked && MESSAGED_REASONS.has(res.reason)) {
      return { handled: true, did: 0, reason: res.reason, targetId: best };
    }
    // relevant tool, no progress this frame (e.g. a repeated spray snap): consume it
    return { handled: true, did: 0, targetId: best };
  }

  // ==========================================================================
  //  STATIONS — mop bucket (wring / change water) + waste bin (pan/tie/dispose)
  // ==========================================================================
  {
    const w = L2W(STATIONS.mopBucket.x, STATIONS.mopBucket.z);
    const bucketProp = {
      x: w.x, z: w.z, r: STATIONS.mopBucket.radius, aimY: 0.4,
      label: () => {
        const c = cleaningStatus(state);
        if (!c) return 'Mop bucket';
        if (hooks.getTool?.() === 'mop') {
          return c.bucket.level > 0.02
            ? `Mop bucket · ${c.bucket.water} water — [E] wring the mop`
            : 'Mop bucket empty — [X] change the water';
        }
        return `Mop bucket · ${c.bucket.water} water — equip the mop to wring`;
      },
      get secondaryLabel() { return hooks.getTool?.() === 'mop' ? 'change bucket water' : null; },
      secondaryAction: () => {
        if (changeBucketWater(state).ok) { hooks.sfx?.('mopStart'); say('Fresh clean water in the bucket.'); }
      },
      action: () => {
        if (hooks.getTool?.() !== 'mop') { say('Equip the mop to wring it here.', 'warn'); return; }
        const result = serviceMop(state);
        if (!result.ok) { say('The bucket is empty — press [X] here to change the water.', 'warn'); return; }
        hooks.sfx?.('mopStart');
        say(`Mop wrung and ready · bucket water ${result.water}.`);
      },
    };
    addProp(bucketProp);
    props.push(bucketProp);
  }
  {
    const w = L2W(STATIONS.disposalBin.x, STATIONS.disposalBin.z);
    const binProp = {
      x: w.x, z: w.z, r: STATIONS.disposalBin.radius, aimY: 0.5,
      label: () => {
        const c = cleaningStatus(state);
        if (!c) return 'Waste bin';
        if (c.pan.load > 0) return `Waste bin — [E] empty the dustpan (${c.pan.load.toFixed(1)})`;
        if (c.bag.tied) return 'Waste bin — [E] dispose the tied bag';
        if (c.bag.load > 0) return `Waste bin — [E] tie & dispose the bag (${c.bag.load.toFixed(1)})`;
        return 'Waste bin';
      },
      action: () => {
        const c = cleaningStatus(state);
        if (!c) return;
        if (c.pan.load > 0) {
          const r = emptyPanIntoBag(state);
          if (r.moved > 0) { hooks.sfx?.('disposal'); say(r.left > 0 ? `Bag full · ${r.left.toFixed(1)} left in the pan.` : 'Dustpan emptied into the bag.'); }
          checkCompletion();
          return;
        }
        if (c.bag.tied) {
          const r = disposeTiedBag(state);
          if (r.ok) { hooks.sfx?.('disposal'); say(`Tied bag hauled out · ${r.disposed.toFixed(1)}.`); }
          checkCompletion();
          return;
        }
        if (c.bag.load > 0) {
          tieBag(state);
          const r = disposeTiedBag(state);
          if (r.ok) { hooks.sfx?.('disposal'); say(`Bag tied and hauled out · ${r.disposed.toFixed(1)}.`); }
          checkCompletion();
          return;
        }
        say('Nothing to dispose yet.', 'warn');
      },
    };
    addProp(binProp);
    props.push(binProp);
  }
  const STATION_COUNT = props.length;

  // --- pizza box direct-E prop ----------------------------------------------
  {
    const p = TARGET_POSES['trash:pizza-box'];
    const w = L2W(p.x, p.z);
    const pizzaProp = {
      x: w.x, z: w.z, r: p.radius, aimY: crateTop + 0.1,
      label: () => (targetProgress('trash:pizza-box') >= 1 ? null : 'Greasy pizza box — [E] throw it out'),
      action: () => {
        if (targetProgress('trash:pizza-box') >= 1) return;
        shedTargetAction(state, { targetId: 'trash:pizza-box', progress: 1 });
        hooks.sfx?.('paper');
        refresh(); // hides the box + fires the edge-triggered completion beat
      },
    };
    addProp(pizzaProp);
    props.push(pizzaProp);
  }

  // ==========================================================================
  //  INTRO BEAT + FRAME UPDATE (sway + completion watch)
  // ==========================================================================
  let introPending = false;
  let introShown = false;
  {
    const shed = ensureShedScene(state);
    const allZero = SHED_TARGET_IDS.every((id) => (shed?.targets?.[id] || 0) === 0);
    introPending = shed?.completedAt == null && allZero;
  }

  let swayClock = 0;
  let completionClock = 0;
  function update(dt) {
    const step = Math.max(0, dt || 0);
    // intro toast fires on the first frame AFTER boot, once the main.js toast
    // hook is installed (construction-time toasts would be swallowed).
    if (introPending && hooks.toast) {
      introPending = false;
      introShown = true;
      hooks.toast("This shed hasn't been touched in years — clean it out. Tap F for tools.");
    }
    swayClock += step;
    cobwebSway.forEach((g, i) => {
      if (!g.visible) return;
      g.rotation.z = Math.sin(swayClock * 1.3 + i * 2.1) * 0.04;
    });
    completionClock += step;
    if (completionClock >= 0.3) { completionClock = 0; checkCompletion(); }
    updateWipe(step);
  }

  // initial paint
  refresh();

  // ==========================================================================
  return {
    group,
    refresh,
    applyCleaningTool,
    update,
    roots: () => [group],
    diagnostics: () => ({
      targets: SHED_TARGET_IDS.length,
      films: WINDOWS.length, // single source: the authoritative shed-window count (one dirt film per window)
      stations: STATION_COUNT,
      furniture: FURNITURE_COUNT,
      introShown,
      completed: completedFired,
    }),
    dispose() {
      disposed = true;
      for (const p of props) removeProp(p);
      for (const root of kitRoots) {
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry?.dispose();
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          for (const material of materials) material?.dispose();
        });
        root.removeFromParent();
      }
      kitRoots.length = 0;
      group.removeFromParent();
      for (const g of ownedGeo) g.dispose();
      for (const m of ownedMat) m.dispose();
      for (const t of ownedTex) t.dispose();
      return { furniture: FURNITURE_COUNT, targets: SHED_TARGET_IDS.length };
    },
  };
}
