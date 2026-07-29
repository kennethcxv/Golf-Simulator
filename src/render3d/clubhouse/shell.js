// CLUBHOUSE SHELL — the building itself: walls with true openings, glazed
// mullioned windows, gabled roof + porch, split oak/concrete floors, the
// coffered beam ceiling, walnut wainscot, and the interior lighting rig
// (practicals + daylight fills + night window glow). Extracted from the
// clubhouse monolith and rebuilt to the production art guide (DEV_LOG
// PHASE 4). Everything positions from src/data/shopLayout.js.

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {
  SHELL, INTERIOR, DOOR_MAIN, DOOR_STOCK, DOOR_BACK, WINDOWS, WINDOW_DIM,
  PARTITIONS, STOCKROOM, HOURS_SIGN, CEILING_PANEL_RIG, SHELL_LIGHT_PLACEMENTS,
  FRONT_DESK, shopLightingTier,
} from '../../data/shopLayout.js';
import { roundedBox, makeSignTexture, makeConcreteTexture, makeSidingTexture } from './materials.js';
import { shopTierIndex } from '../../sim/shopProgression.js';
import { restorationSnapshot } from '../../sim/clubhouseRestoration.js';

let rectAreaLightsInitialized = false;
function ensureRectAreaLights() {
  if (rectAreaLightsInitialized) return;
  RectAreaLightUniformsLib.init();
  rectAreaLightsInitialized = true;
}

export const PINE_HILLS_CEILING_PANEL_LIGHTING = Object.freeze({
  backend: 'rect-area',
  color: 0xffd8ad,
  baseIntensity: 5.8,
  widthScale: 0.92,
  heightScale: 0.90,
});

// RectAreaLights are global fragment-shader inputs in Three rather than
// clustered/local lights. Four nearby panels cover the player's current room
// zone; every authored diffuser, fault state and repairable light remains live.
export const PINE_HILLS_RENDERED_PANEL_BUDGET = 4;

// The argument remains accepted for stable callers and diagnostics, but the
// authored Pine Hills panel rig is no longer substituted with point sources.
export function clubhouseCeilingLightBackend(_maxTextureImageUnits) {
  return PINE_HILLS_CEILING_PANEL_LIGHTING.backend;
}

const PRODUCTION_VISUAL_FALLBACK_KEYS = Object.freeze([
  'exteriorShellStructure',
  'apertureTrim',
  'porchVisuals',
  'windowVisuals',
  'renovatedFloor',
  'ceilingVisuals',
  'wainscotPanels',
  'interiorTrim',
  'servicePartitions',
]);

// These handles deliberately leave every mesh under its original scene parent.
// A production asset can therefore hide a logical visual set atomically without
// reparenting window holders (which later receive dirt) or changing transforms.
// Hiding snapshots every node's current state so a later restore preserves mixed
// visibility instead of blindly forcing the whole set on.
// Sets are disjoint: apertureTrim owns proud exterior window casing;
// windowVisuals owns jamb/frame, glass, and muntins; interiorTrim owns interior
// sills/aprons, base/cap rails, and crown. Composites can safely combine those
// handles when an authored asset owns more than one of these visual layers.
function productionVisualHandle(name, sourceNodes) {
  const nodes = Object.freeze([...new Set(sourceNodes)]);
  const initialVisibility = Object.freeze(nodes.map((node) => node.visible));
  let hiddenVisibility = null;

  const getVisible = () => nodes.some((node) => node.visible !== false);
  const setVisible = (nextVisible) => {
    if (!nextVisible) {
      if (hiddenVisibility === null) hiddenVisibility = nodes.map((node) => node.visible);
      for (const node of nodes) node.visible = false;
      return false;
    }

    if (hiddenVisibility !== null) {
      for (let i = 0; i < nodes.length; i++) nodes[i].visible = hiddenVisibility[i];
      hiddenVisibility = null;
    } else if (!getVisible()) {
      for (let i = 0; i < nodes.length; i++) nodes[i].visible = initialVisibility[i];
    }
    return getVisible();
  };

  const handle = { name, nodes, nodeCount: nodes.length, getVisible, setVisible };
  Object.defineProperty(handle, 'visible', {
    enumerable: true,
    get: getVisible,
    set: setVisible,
  });
  return Object.freeze(handle);
}

export function buildShell(B) {
  const { group, interior, mats, merch, addCol, colBoxAt, FLOOR_TOP, state } = B;
  const halfW = SHELL.w / 2 - SHELL.wallT / 2; // wall centerlines
  const halfD = SHELL.d / 2 - SHELL.wallT / 2;
  const productionFallbackNodes = Object.fromEntries(
    PRODUCTION_VISUAL_FALLBACK_KEYS.map((key) => [key, []]),
  );
  const trackProductionFallback = (key, node) => {
    productionFallbackNodes[key].push(node);
    return node;
  };
  let businessSignOpen = true;
  let repaintBusinessSign = () => {};
  let retailSlab = null;
  const partitionColliders = [];
  const luxuryFloorMaterial = mats.oakFloor.clone();
  luxuryFloorMaterial.color.setHex(0xf1d8ad);

  // --- exterior finishes (normal-mapped siding + roof, kept from the yard kit) ---
  const texLoader = new THREE.TextureLoader();
  const loadTex = (file) => {
    const t = texLoader.load(`vendor/textures/${file}`, undefined, undefined, () => {});
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const sidingNor = loadTex('siding_nor.jpg');
  sidingNor.repeat.set(6, 2.2);
  const roofNor = loadTex('roof_nor.jpg');
  roofNor.repeat.set(4, 2);
  const sidingTex = makeSidingTexture({});
  sidingTex.repeat.set(6, 2.2);
  const sidingMat = new THREE.MeshStandardMaterial({ map: sidingTex, normalMap: sidingNor, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2e5a35, normalMap: roofNor, roughness: 0.72 });
  // Shell trim is independently tintable in renovation mode. Keeping this as one
  // shared shell material preserves batching while avoiding a room-style change
  // recolouring every cream-painted prop in the rest of the clubhouse.
  const trimMat = mats.trimPaint.clone();
  let retailFloorMaterial = null;
  // eave/porch undersides fight the hemisphere's green ground bounce with a
  // faint warm self-light (they read as shadowed cream, not lime)
  const soffitMat = new THREE.MeshStandardMaterial({ color: 0xf5f2e6, roughness: 0.85, emissive: 0xfff2dc, emissiveIntensity: 0.10 });

  // --- walls: runs of box segments around true openings --------------------------
  function buildWall({ axis, at, from, to, openings = [], insideDir }) {
    const wallH = SHELL.wallH;
    const segs = [];
    const doorGaps = openings.filter((o) => o.isDoor);
    const sorted = [...openings].sort((a, b) => a.c - b.c);
    let cursor = from;
    for (const o of sorted) {
      const o0 = o.c - o.w / 2;
      const o1 = o.c + o.w / 2;
      if (o0 > cursor) segs.push({ a: cursor, b: o0, y0: 0, y1: wallH });
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
      let faceMats;
      if (axis === 'x') {
        faceMats = [trimMat, trimMat, trimMat, trimMat,
          insideDir < 0 ? sidingMat : mats.plaster, insideDir < 0 ? mats.plaster : sidingMat];
      } else {
        faceMats = [insideDir < 0 ? sidingMat : mats.plaster, insideDir < 0 ? mats.plaster : sidingMat,
          trimMat, trimMat, trimMat, trimMat];
      }
      const m = new THREE.Mesh(geo, faceMats);
      const mid = (s.a + s.b) / 2;
      if (axis === 'x') m.position.set(mid, (s.y0 + s.y1) / 2, at);
      else m.position.set(at, (s.y0 + s.y1) / 2, mid);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      trackProductionFallback('exteriorShellStructure', m);
    }
    const gaps = doorGaps.map((d) => [d.c - d.w / 2, d.c + d.w / 2]).sort((a, b) => a[0] - b[0]);
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
  // exterior foundation skirt
  for (const side of [
    { w: SHELL.w + 0.3, d: 0.18, x: 0, z: halfD + SHELL.wallT / 2 + 0.05 },
    { w: SHELL.w + 0.3, d: 0.18, x: 0, z: -halfD - SHELL.wallT / 2 - 0.05 },
    { w: 0.18, d: SHELL.d + 0.3, x: halfW + SHELL.wallT / 2 + 0.05, z: 0 },
    { w: 0.18, d: SHELL.d + 0.3, x: -halfW - SHELL.wallT / 2 - 0.05, z: 0 },
  ]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(side.w, 0.9, side.d), mats.charcoal);
    skirt.position.set(side.x, -0.14, side.z); // deep enough to meet sloped ground
    group.add(skirt);
    trackProductionFallback('exteriorShellStructure', skirt);
  }

  // --- windows: jambs, sills, muntin grids, casings — real glazed openings --------
  const windowDefs = [];
  for (const w of WINDOWS) {
    const y = FLOOR_TOP + WINDOW_DIM.sill + WINDOW_DIM.h / 2;
    let px = 0; let pz = 0; let ry = 0;
    if (w.wall === 'S') { px = w.c; pz = halfD; ry = 0; }
    if (w.wall === 'N') { px = w.c; pz = -halfD; ry = 0; }
    if (w.wall === 'E') { px = halfW; pz = w.c; ry = Math.PI / 2; }
    const holder = new THREE.Group();
    holder.position.set(px, y, pz);
    holder.rotation.y = ry;
    group.add(holder);

    const W = WINDOW_DIM.w;
    const H = WINDOW_DIM.h;
    const jambD = SHELL.wallT + 0.08;
    // glass
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, H - 0.1), mats.glass);
    holder.add(glass);
    trackProductionFallback('windowVisuals', glass);
    // jamb lining (top/bottom/left/right boards through the wall)
    const jamb = (bw, bh, bx, by) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, jambD), mats.trimPaint);
      b.position.set(bx, by, 0);
      holder.add(b);
      trackProductionFallback('windowVisuals', b);
    };
    jamb(W + 0.12, 0.07, 0, H / 2 + 0.02);
    jamb(W + 0.12, 0.07, 0, -H / 2 - 0.02);
    jamb(0.07, H + 0.1, -W / 2 - 0.02, 0);
    jamb(0.07, H + 0.1, W / 2 + 0.02, 0);
    // muntin grid: one vertical + one horizontal bar (4 lites), both faces read it
    const muntinV = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.08, 0.055), mats.trimPaint);
    holder.add(muntinV);
    trackProductionFallback('windowVisuals', muntinV);
    const muntinH = new THREE.Mesh(new THREE.BoxGeometry(W - 0.08, 0.05, 0.055), mats.trimPaint);
    muntinH.position.y = -H * 0.12;
    holder.add(muntinH);
    trackProductionFallback('windowVisuals', muntinH);
    // interior sill board + apron (walnut, beveled feel via thin cap)
    const sill = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.05, 0.24), mats.walnut);
    sill.position.set(0, -H / 2 - 0.045, (SHELL.wallT / 2 + 0.09) * -Math.sign(1)); // inside face
    // orient inside: S wall inside is -z, N inside +z, E inside -x (after ry)
    const insideSign = (w.wall === 'S' || w.wall === 'E') ? -1 : 1;
    sill.position.z = insideSign * (SHELL.wallT / 2 + 0.1);
    holder.add(sill);
    trackProductionFallback('interiorTrim', sill);
    const apron = new THREE.Mesh(new THREE.BoxGeometry(W + 0.14, 0.1, 0.03), mats.walnut);
    apron.position.set(0, -H / 2 - 0.12, insideSign * (SHELL.wallT / 2 + 0.015));
    holder.add(apron);
    trackProductionFallback('interiorTrim', apron);
    // exterior casing (proud trim frame)
    const outSign = -insideSign;
    const caseOut = (bw, bh, bx, by) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.05), trimMat);
      b.position.set(bx, by, outSign * (SHELL.wallT / 2 + 0.03));
      holder.add(b);
      trackProductionFallback('apertureTrim', b);
    };
    caseOut(W + 0.34, 0.12, 0, H / 2 + 0.1);
    caseOut(W + 0.34, 0.12, 0, -H / 2 - 0.1);
    caseOut(0.12, H + 0.1, -W / 2 - 0.11, 0);
    caseOut(0.12, H + 0.1, W / 2 + 0.11, 0);

    windowDefs.push({ wall: w.wall, c: w.c, holder, y, w: W, h: H, insideSign });
  }

  // --- roof, gables, fascia, porch, chimney ---------------------------------------
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
      trackProductionFallback('exteriorShellStructure', gable);
    }
    const slopeLen = Math.hypot(PEAK, D2 / 2) + 1.3;
    const roofPitch = Math.atan2(PEAK, D2 / 2);
    for (const zSide of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W2 + 2.2, 0.2, slopeLen), roofMat);
      slab.rotation.x = zSide * roofPitch;
      slab.position.set(0, WALL_H + PEAK / 2 + 0.08, zSide * (D2 / 4 + 0.3));
      slab.castShadow = true;
      slab.receiveShadow = true;
      group.add(slab);
      trackProductionFallback('exteriorShellStructure', slab);
      // fascia along the eave
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(W2 + 2.2, 0.26, 0.07), trimMat);
      fascia.rotation.x = zSide * roofPitch;
      fascia.position.set(0, WALL_H - 0.02, zSide * (D2 / 2 + 0.78));
      group.add(fascia);
      trackProductionFallback('exteriorShellStructure', fascia);
      // soffit under the overhang (clean cream underside, kills the striping)
      const soffit = new THREE.Mesh(new THREE.PlaneGeometry(W2 + 2.1, 0.95), soffitMat);
      soffit.rotation.x = Math.PI / 2;
      soffit.position.set(0, WALL_H - 0.1, zSide * (D2 / 2 + 0.32));
      group.add(soffit);
      trackProductionFallback('exteriorShellStructure', soffit);
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(W2 + 2.0, 0.18, 0.5), new THREE.MeshStandardMaterial({ color: 0x24462a, roughness: 0.7 }));
    ridge.position.set(0, WALL_H + PEAK + 0.1, 0);
    group.add(ridge);
    trackProductionFallback('exteriorShellStructure', ridge);

    // --- RAINWATER GOODS -------------------------------------------------------
    // The brief asks for gutters and downspouts and the building had neither, so
    // the eaves just stopped in mid-air. (Fascia and soffits, contrary to my own
    // audit, already existed a few lines above — corrected there.) Ref panel 9
    // shows the downspout the pressure-washer works around.
    const gutterMat = new THREE.MeshStandardMaterial({
      color: 0xe6e0cf, roughness: 0.55, metalness: 0.25,
    });
    const EAVE_Z = D2 / 2 + 0.80;
    const EAVE_Y = WALL_H - 0.16;
    for (const zSide of [-1, 1]) {
      // an OPEN half-round trough, not a solid bar — you can see into a gutter
      const trough = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, W2 + 2.2, 10, 1, true, 0, Math.PI),
        gutterMat,
      );
      trough.material.side = THREE.DoubleSide;
      trough.rotation.z = Math.PI / 2;
      trough.rotation.y = Math.PI / 2;
      trough.position.set(0, EAVE_Y, zSide * EAVE_Z);
      trough.castShadow = true;
      group.add(trough);
      trackProductionFallback('exteriorShellStructure', trough);
      // the bead along the outer lip
      const bead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, W2 + 2.2, 6), gutterMat);
      bead.rotation.z = Math.PI / 2;
      bead.position.set(0, EAVE_Y, zSide * (EAVE_Z + 0.108));
      group.add(bead);
      trackProductionFallback('exteriorShellStructure', bead);
    }
    // downspouts at all four corners: outlet, stack, and an elbow kicking clear
    for (const xSide of [-1, 1]) {
      for (const zSide of [-1, 1]) {
        const px = xSide * (W2 / 2 - 0.35);
        const pz = zSide * EAVE_Z;
        const outlet = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.045, 0.16, 8), gutterMat);
        outlet.position.set(px, EAVE_Y - 0.12, pz);
        group.add(outlet);
        trackProductionFallback('exteriorShellStructure', outlet);
        const stack = new THREE.Mesh(
          new THREE.BoxGeometry(0.085, EAVE_Y - 0.55, 0.085), gutterMat);
        stack.position.set(px, (EAVE_Y - 0.30) / 2 + 0.02, pz - zSide * 0.06);
        stack.castShadow = true;
        group.add(stack);
        trackProductionFallback('exteriorShellStructure', stack);
        for (const by of [1.35, 3.05]) {   // the straps that hold it to the wall
          const strap = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.03), gutterMat);
          strap.position.set(px, by, pz - zSide * 0.10);
          group.add(strap);
          trackProductionFallback('exteriorShellStructure', strap);
        }
        const elbow = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.34), gutterMat);
        elbow.position.set(px, 0.16, pz - zSide * 0.21);
        elbow.rotation.x = zSide * 0.5;
        group.add(elbow);
        trackProductionFallback('exteriorShellStructure', elbow);
        const splash = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.03, 0.42),
          new THREE.MeshStandardMaterial({ color: 0x8d8a80, roughness: 0.95 }),
        );
        splash.position.set(px, 0.015, pz - zSide * 0.48);
        group.add(splash);
        trackProductionFallback('exteriorShellStructure', splash);
      }
    }

    // --- LANDSCAPING -----------------------------------------------------------
    // The turf ran straight into the foundation, which is what made the building
    // look dropped on the lawn rather than built there.
    const mulch = new THREE.MeshStandardMaterial({ color: 0x4a3628, roughness: 0.98 });
    const shrubA = new THREE.MeshStandardMaterial({ color: 0x3f5c33, roughness: 0.95 });
    const shrubB = new THREE.MeshStandardMaterial({ color: 0x50703c, roughness: 0.95 });
    const BEDS = [
      { x: -7.4, z: D2 / 2 + 0.75, w: 5.4, d: 1.3 },   // south, west of the porch
      { x: 6.6, z: D2 / 2 + 0.75, w: 6.2, d: 1.3 },    // south, east of the porch
      { x: -W2 / 2 - 0.7, z: -1.0, w: 1.3, d: 7.0, rot: true },  // west gable
    ];
    let bs = 31;
    const brnd = () => {
      bs = (bs * 1103515245 + 12345) & 0x7fffffff;
      return bs / 0x7fffffff;
    };
    for (const b of BEDS) {
      const bw = b.rot ? b.w : b.w;
      const bd = b.rot ? b.d : b.d;
      const bed = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.09, bd), mulch);
      bed.position.set(b.x, 0.045, b.z);
      bed.receiveShadow = true;
      group.add(bed);
      // an edging board, then shrubs at irregular spacing — a planted bed, not a row
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(bw + 0.08, 0.13, 0.06), trimMat);
      edge.position.set(b.x, 0.065, b.z + (b.rot ? 0 : bd / 2));
      if (b.rot) {
        edge.rotation.y = Math.PI / 2;
        edge.position.set(b.x + bw / 2, 0.065, b.z);
      }
      group.add(edge);
      const n = Math.max(3, Math.round((b.rot ? bd : bw) / 1.15));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const along = -((b.rot ? bd : bw) / 2) + t * (b.rot ? bd : bw);
        const sx = b.rot ? b.x : b.x + along;
        const sz = b.rot ? b.z + along : b.z;
        const r = 0.28 + brnd() * 0.20;
        const bush = new THREE.Mesh(
          new THREE.IcosahedronGeometry(r, 1), brnd() < 0.5 ? shrubA : shrubB);
        bush.position.set(sx + (brnd() - 0.5) * 0.18, r * 0.78,
          sz + (brnd() - 0.5) * 0.22);
        bush.scale.y = 0.80 + brnd() * 0.25;
        bush.castShadow = true;
        group.add(bush);
      }
    }

    // porch: deck, posts with base/cap, cream soffit, step, path pad
    const porchW = W2 * 0.62;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(porchW, FLOOR_TOP, PORCH_D), new THREE.MeshStandardMaterial({ map: makeConcreteTexture({ seed: 88 }), color: 0xd9d2c2, roughness: 0.85 }));
    deck.position.set(-1.0, FLOOR_TOP / 2, D2 / 2 + PORCH_D / 2);
    deck.receiveShadow = true;
    group.add(deck);
    trackProductionFallback('porchVisuals', deck);
    const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(porchW + 0.9, 0.18, PORCH_D + 0.7), roofMat);
    porchRoof.position.set(-1.0, WALL_H - 0.75, D2 / 2 + PORCH_D / 2);
    porchRoof.castShadow = true;
    group.add(porchRoof);
    trackProductionFallback('porchVisuals', porchRoof);
    const porchSoffit = new THREE.Mesh(new THREE.PlaneGeometry(porchW + 0.8, PORCH_D + 0.5), soffitMat);
    porchSoffit.rotation.x = Math.PI / 2;
    porchSoffit.position.set(-1.0, WALL_H - 0.85, D2 / 2 + PORCH_D / 2);
    group.add(porchSoffit);
    trackProductionFallback('porchVisuals', porchSoffit);
    const porchFascia = new THREE.Mesh(new THREE.BoxGeometry(porchW + 0.9, 0.2, 0.06), trimMat);
    porchFascia.position.set(-1.0, WALL_H - 0.72, D2 / 2 + PORCH_D + 0.32);
    group.add(porchFascia);
    trackProductionFallback('porchVisuals', porchFascia);
    for (const px of [-1.0 - porchW / 2 + 0.35, -1.0 - porchW / 6, -1.0 + porchW / 6, -1.0 + porchW / 2 - 0.35]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.17, WALL_H - 1.05 - FLOOR_TOP, 0.17), trimMat);
      post.position.set(px, (WALL_H - 0.75 + FLOOR_TOP) / 2 - 0.15, D2 / 2 + PORCH_D - 0.45);
      post.castShadow = true;
      group.add(post);
      trackProductionFallback('porchVisuals', post);
      for (const [py, s] of [[FLOOR_TOP + 0.14, 0.24], [WALL_H - 1.0, 0.22]]) {
        const capB = new THREE.Mesh(new THREE.BoxGeometry(s, 0.1, s), trimMat);
        capB.position.set(px, py, D2 / 2 + PORCH_D - 0.45);
        group.add(capB);
        trackProductionFallback('porchVisuals', capB);
      }
      addCol(colBoxAt(px, D2 / 2 + PORCH_D - 0.45, 0.4, 0.4));
    }
    // REAL steps off the porch: two treads on stringers with closed risers and
    // a handrail each side — the old floating pads read as unfinished geometry
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.9 });
    const stairW = 3.0;
    const stairZ0 = D2 / 2 + PORCH_D; // porch edge
    for (let i = 0; i < 2; i++) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(stairW, 0.05, 0.42), stepMat);
      tread.position.set(DOOR_MAIN.x, FLOOR_TOP - 0.125 - i * 0.15, stairZ0 + 0.21 + i * 0.38);
      tread.castShadow = true;
      tread.receiveShadow = true;
      group.add(tread);
      trackProductionFallback('porchVisuals', tread);
      const riser = new THREE.Mesh(new THREE.BoxGeometry(stairW, 0.13, 0.04), stepMat);
      riser.position.set(DOOR_MAIN.x, FLOOR_TOP - 0.195 - i * 0.15, stairZ0 + 0.02 + i * 0.38);
      group.add(riser);
      trackProductionFallback('porchVisuals', riser);
    }
    for (const sx of [-1, 1]) {
      // stringer cheek
      const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.86), stepMat);
      stringer.position.set(DOOR_MAIN.x + sx * (stairW / 2 - 0.025), FLOOR_TOP - 0.19, stairZ0 + 0.4);
      group.add(stringer);
      trackProductionFallback('porchVisuals', stringer);
      // handrail: two turned posts + rail following the run
      const hrMat = trimMat;
      for (const [pz, py] of [[stairZ0 + 0.05, FLOOR_TOP + 0.45], [stairZ0 + 0.82, FLOOR_TOP + 0.15]]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), hrMat);
        post.position.set(DOOR_MAIN.x + sx * (stairW / 2 + 0.06), py, pz);
        post.castShadow = true;
        group.add(post);
        trackProductionFallback('porchVisuals', post);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), hrMat);
      rail.position.set(DOOR_MAIN.x + sx * (stairW / 2 + 0.06), FLOOR_TOP + 0.72, stairZ0 + 0.44);
      rail.rotation.x = 0.36;
      group.add(rail);
      trackProductionFallback('porchVisuals', rail);
    }
    // a real concrete walk out to the course, jointed slabs, full width
    const walkMat = new THREE.MeshStandardMaterial({ map: makeConcreteTexture({ seed: 41 }), color: 0xc9c2b2, roughness: 0.95 });
    for (let i = 0; i < 4; i++) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 1.18), walkMat);
      pad.position.set(DOOR_MAIN.x, 0.025, stairZ0 + 1.15 + i * 1.24);
      pad.receiveShadow = true;
      pad.name = `LegacyApproachWalk_${i + 1}`;
      group.add(pad);
    }

    // (the rainwater goods used to be here: a solid box bar for a gutter and
    // plain box spouts. They were replaced up in the roof block with an open
    // half-round trough, a lip bead, wall straps and splash blocks.)

    // foundation skirt sunk into the grade — the old thin dark band hovered
    // over the grass wherever the terrain dipped
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(W2 + 0.5, 0.9, D2 + 0.5),
      new THREE.MeshStandardMaterial({ map: makeConcreteTexture({ seed: 23 }), color: 0x9a9284, roughness: 0.95 }),
    );
    skirt.position.set(0, -0.28, 0);
    group.add(skirt);
    trackProductionFallback('exteriorShellStructure', skirt);

    // post-mounted club sign by the walk (the reference's PINEHOLLOW board)
    const words = ((state && state.clubName) || 'GOLF CLUB').toUpperCase().split(' ');
    const mid = Math.ceil(words.length / 2);
    const clubSignTex = makeSignTexture([words.slice(0, mid).join(' '), words.slice(mid).join(' ') || 'GOLF CLUB'], { w: 384, h: 160 });
    const signG = new THREE.Group();
    signG.name = 'LegacyClubApproachSign';
    for (const sx of [-0.85, 0.85]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.5, 0.11), mats.walnutDark);
      post.position.set(sx, 0.75, 0);
      post.castShadow = true;
      signG.add(post);
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 0.06), mats.walnutDark);
    board.position.set(0, 1.15, 0);
    board.castShadow = true;
    signG.add(board);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(1.98, 0.6),
      new THREE.MeshStandardMaterial({ map: clubSignTex, roughness: 0.8 }),
    );
    face.position.set(0, 1.15, 0.033);
    signG.add(face);
    signG.position.set(DOOR_MAIN.x + 3.4, 0, stairZ0 + 2.3);
    signG.rotation.y = 0.35;
    group.add(signG);
    const clubSignCollider = colBoxAt(DOOR_MAIN.x + 3.4, stairZ0 + 2.3, 2.0, 0.4);
    signG.userData.presentationCollider = clubSignCollider;
    addCol(clubSignCollider);
    const chimney = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 3.0, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x7a5a4a, roughness: 0.9 }),
    );
    chimney.position.set(W2 * 0.3, WALL_H + PEAK - 0.5, -D2 * 0.15);
    chimney.castShadow = true;
    group.add(chimney);
    trackProductionFallback('exteriorShellStructure', chimney);
    const chimCap = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.12, 1.16), mats.charcoal);
    chimCap.position.set(W2 * 0.3, WALL_H + PEAK + 1.0, -D2 * 0.15);
    group.add(chimCap);
    trackProductionFallback('exteriorShellStructure', chimCap);

    // hours sign (sign kit) + porch sconce by the door
    const signTex = makeSignTexture(['PRO SHOP', 'OPEN TODAY', '6 AM – 8 PM'], { w: 256, h: 192 });
    repaintBusinessSign = (open) => {
      const nextOpen = !!open;
      if (nextOpen === businessSignOpen) return;
      businessSignOpen = nextOpen;
      const painted = makeSignTexture(
        nextOpen
          ? ['PRO SHOP', 'OPEN TODAY', '6 AM – 8 PM']
          : ['PRO SHOP', 'CLOSED', 'RESTORATION'],
        {
          w: 256,
          h: 192,
          field: nextOpen ? '#f4f0e6' : '#e8dfcb',
          ink: nextOpen ? '#1f4a26' : '#473c31',
          secondaryInk: nextOpen ? '#3f3a30' : '#8a4d3a',
        },
      );
      const canvas = signTex.image;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(painted.image, 0, 0);
      painted.dispose();
      signTex.needsUpdate = true;
    };
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.54),
      new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.85 }),
    );
    sign.name = 'LegacyBusinessHoursSign';
    sign.position.set(HOURS_SIGN.x, FLOOR_TOP + 1.5, halfD + SHELL.wallT / 2 + 0.02);
    group.add(sign);
  }

  // --- interior partitions ---------------------------------------------------------
  for (const p of PARTITIONS) {
    const openings = p.opening ? [{ c: p.opening.c, w: p.opening.w, top: DOOR_STOCK.h, bottom: 0, isDoor: true }] : [];
    const segs = [];
    let cursor = p.from;
    for (const o of openings.sort((a, b) => a.c - b.c)) {
      if (o.c - o.w / 2 > cursor) segs.push({ a: cursor, b: o.c - o.w / 2, y0: 0, y1: SHELL.h + FLOOR_TOP });
      segs.push({ a: o.c - o.w / 2, b: o.c + o.w / 2, y0: FLOOR_TOP + o.top, y1: SHELL.h + FLOOR_TOP });
      cursor = o.c + o.w / 2;
    }
    if (cursor < p.to) segs.push({ a: cursor, b: p.to, y0: 0, y1: SHELL.h + FLOOR_TOP });
    for (let segmentIndex = 0; segmentIndex < segs.length; segmentIndex += 1) {
      const s = segs[segmentIndex];
      const len = s.b - s.a;
      const h = s.y1 - s.y0;
      const geo = p.axis === 'x' ? new THREE.BoxGeometry(SHELL.wallT, h, len) : new THREE.BoxGeometry(len, h, SHELL.wallT);
      const m = new THREE.Mesh(geo, mats.plaster);
      m.name = `LegacyServicePartition_${p.axis}_${p.at}_${segmentIndex}`;
      const mid = (s.a + s.b) / 2;
      if (p.axis === 'x') m.position.set(p.at, (s.y0 + s.y1) / 2, mid);
      else m.position.set(mid, (s.y0 + s.y1) / 2, p.at);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      trackProductionFallback('servicePartitions', m);
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
      const collider = p.axis === 'x'
        ? colBoxAt(p.at, (a + b) / 2, SHELL.wallT + 0.12, b - a)
        : colBoxAt((a + b) / 2, p.at, b - a, SHELL.wallT + 0.12);
      collider.legacyServicePartition = true;
      collider.partitionAxis = p.axis;
      partitionColliders.push(addCol(collider) || collider);
    }
  }

  // --- floors: honey oak retail + office, sealed concrete stockroom -----------------
  {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(INTERIOR.w, FLOOR_TOP, INTERIOR.d), mats.oakFloor);
    slab.position.set(0, FLOOR_TOP / 2, 0);
    slab.receiveShadow = true;
    group.add(slab);
    retailSlab = slab;
    trackProductionFallback('renovatedFloor', slab);
    // concrete sits a hair proud over the stockroom (a different pour)
    const sb = STOCKROOM.bounds;
    const concTex = makeConcreteTexture({});
    concTex.repeat.set((sb.maxX - sb.minX) / 3.4, (sb.maxZ - sb.minZ) / 3.4);
    const conc = new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.92 });
    const concSlab = new THREE.Mesh(
      new THREE.BoxGeometry(sb.maxX - sb.minX, FLOOR_TOP + 0.008, sb.maxZ - sb.minZ),
      conc,
    );
    concSlab.position.set((sb.minX + sb.maxX) / 2, (FLOOR_TOP + 0.008) / 2, (sb.minZ + sb.maxZ) / 2);
    concSlab.receiveShadow = true;
    group.add(concSlab);
    // walnut thresholds at the doors
    for (const t of [
      { x: DOOR_MAIN.x, z: INTERIOR.d / 2, w: DOOR_MAIN.w, d: 0.16 },
      { x: DOOR_STOCK.x, z: 2.0, w: DOOR_STOCK.w, d: 0.16 },
      { x: INTERIOR.w / 2, z: DOOR_BACK.z, w: 0.16, d: DOOR_BACK.w },
    ]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.02, t.d), mats.walnut);
      strip.position.set(t.x, FLOOR_TOP + 0.012, t.z);
      group.add(strip);
    }
  }

  // --- ceiling: cream coffer panels between walnut beams, crown all around ----------
  // NOTE: the `interior` group's origin sits AT floor-top height, so interior
  // y-coordinates are measured from the finished floor (no FLOOR_TOP offset).
  {
    // oversized so the edge tucks under the wall heads (no roof-slab slivers)
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(INTERIOR.w + 0.6, INTERIOR.d + 0.6), mats.ceiling);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = SHELL.h;
    interior.add(ceil);
    trackProductionFallback('ceilingVisuals', ceil);
    const salesW = STOCKROOM.bounds.minX + INTERIOR.w / 2; // west edge → partition
    for (const bz of [-3.9, -1.3, 1.3, 3.9]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(salesW, 0.26, 0.22), mats.walnut);
      beam.position.set(-INTERIOR.w / 2 + salesW / 2, SHELL.h - 0.13, bz);
      beam.castShadow = true;
      interior.add(beam);
      trackProductionFallback('ceilingVisuals', beam);
    }
    // one crossing beam ties the coffers where the aisle turns
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, INTERIOR.d), mats.walnut);
    cross.position.set(-2.3, SHELL.h - 0.13, 0);
    interior.add(cross);
    trackProductionFallback('ceilingVisuals', cross);
    // crown molding around the room + along the partitions
    const crown = (len, x, z, rotY = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.08), mats.walnut);
      m.position.set(x, SHELL.h - 0.07, z);
      m.rotation.y = rotY;
      interior.add(m);
      trackProductionFallback('interiorTrim', m);
    };
    crown(INTERIOR.w, 0, INTERIOR.d / 2 - 0.06);
    crown(INTERIOR.w, 0, -INTERIOR.d / 2 + 0.06);
    crown(INTERIOR.d, -INTERIOR.w / 2 + 0.06, 0, Math.PI / 2);
    crown(INTERIOR.d, INTERIOR.w / 2 - 0.06, 0, Math.PI / 2);
    crown(INTERIOR.d - 4.5, STOCKROOM.bounds.minX - 0.06, -2.25, Math.PI / 2);
  }

  // --- wainscot: walnut rail + panel field below, cream plaster above ---------------
  // (interior space: y measured from the finished floor)
  {
    const RAIL_Y = 1.0;
    const specs = [
      { axis: 'x', at: INTERIOR.d / 2 - 0.02, dir: -1, from: -INTERIOR.w / 2, to: INTERIOR.w / 2, gaps: [[DOOR_MAIN.x - DOOR_MAIN.w / 2 - 0.12, DOOR_MAIN.x + DOOR_MAIN.w / 2 + 0.12]] },
      { axis: 'x', at: -INTERIOR.d / 2 + 0.02, dir: 1, from: -INTERIOR.w / 2, to: INTERIOR.w / 2, gaps: [] },
      { axis: 'z', at: -INTERIOR.w / 2 + 0.02, dir: 1, from: -INTERIOR.d / 2, to: INTERIOR.d / 2, gaps: [] },
      { axis: 'z', at: INTERIOR.w / 2 - 0.02, dir: -1, from: -INTERIOR.d / 2, to: INTERIOR.d / 2, gaps: [[DOOR_BACK.z - DOOR_BACK.w / 2 - 0.12, DOOR_BACK.z + DOOR_BACK.w / 2 + 0.12]] },
      { axis: 'z', at: STOCKROOM.bounds.minX - SHELL.wallT / 2 - 0.02, dir: -1, from: -INTERIOR.d / 2, to: 2.0, gaps: [] },
    ];
    for (const s of specs) {
      let cursor = s.from;
      const spans = [];
      for (const [g0, g1] of s.gaps) {
        if (g0 > cursor) spans.push([cursor, g0]);
        cursor = g1;
      }
      if (cursor < s.to) spans.push([cursor, s.to]);
      for (const [a, b] of spans) {
        const len = b - a;
        const mid = (a + b) / 2;
        const place = (mesh, y, off = 0) => {
          if (s.axis === 'x') {
            mesh.position.set(mid, y, s.at + s.dir * off);
          } else {
            mesh.position.set(s.at + s.dir * off, y, mid);
            mesh.rotation.y = Math.PI / 2;
          }
          interior.add(mesh);
        };
        // panel field
        const field = new THREE.Mesh(new THREE.BoxGeometry(len, RAIL_Y - 0.1, 0.03), mats.walnutDark);
        place(field, RAIL_Y / 2, 0.015);
        trackProductionFallback('wainscotPanels', field);
        // base + cap rails
        const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.13, 0.05), mats.walnut);
        place(base, 0.065, 0.03);
        trackProductionFallback('interiorTrim', base);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.06), mats.walnut);
        place(cap, RAIL_Y, 0.035);
        trackProductionFallback('interiorTrim', cap);
        // stiles every ~1.15 for the frame-panel rhythm
        const n = Math.max(1, Math.round(len / 1.15));
        for (let i = 0; i <= n; i++) {
          const sx = a + (i / n) * len;
          const stile = new THREE.Mesh(new THREE.BoxGeometry(0.07, RAIL_Y - 0.14, 0.045), mats.walnut);
          if (s.axis === 'x') stile.position.set(sx, RAIL_Y / 2 - 0.02, s.at + s.dir * 0.028);
          else {
            stile.position.set(s.at + s.dir * 0.028, RAIL_Y / 2 - 0.02, sx);
            stile.rotation.y = Math.PI / 2;
          }
          interior.add(stile);
          trackProductionFallback('wainscotPanels', stile);
        }
      }
    }
  }

  // --- lighting rig ------------------------------------------------------------------
  // practicals: 3 iron lantern pendants over the sales floor + recessed cans;
  // daylight fills at the windows sell real sun through the glass; night turns
  // the glass warm from outside. All returned through one API.
  const practicals = []; // {light, glow(emissive mesh), base}
  const CEIL_Y = SHELL.h; // interior space: measured from the finished floor

  function addCan(lx, lz, { real = false, intensity = 9 } = {}) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.05, 12, 1, true), mats.charcoal);
    ring.position.set(lx, CEIL_Y - 0.025, lz);
    interior.add(ring);
    trackProductionFallback('ceilingVisuals', ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.145, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff5e6, emissive: 0xffecd1, emissiveIntensity: 1.25 }),
    );
    disc.rotation.x = Math.PI / 2;
    disc.position.set(lx, CEIL_Y - 0.056, lz);
    interior.add(disc);
    trackProductionFallback('ceilingVisuals', disc);
    let light = null;
    if (real) {
      light = new THREE.PointLight(0xffecd1, intensity, 8.5, 1.8);
      light.position.set(lx, CEIL_Y - 0.35, lz);
      interior.add(light);
    }
    practicals.push({ light, glow: disc, base: real ? intensity : 0 });
    return practicals[practicals.length - 1];
  }

  function addLantern(lx, lz) {
    // The pendant is the first thing you see on entering, and it was a flat black
    // box with white panels on a stick. It is a modelled lantern now — a chain, a
    // cap, four tapered posts, glass — with the glow driven from its glass slot.
    // The old build stays as the fallback until the GLB lands (the light itself
    // must not wait, or the shop opens dark).
    const light = new THREE.PointLight(0xffe8c8, 11.5, 9.5, 1.7);
    light.position.set(lx, CEIL_Y - 0.85, lz);
    interior.add(light);

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xfff4e4, emissive: 0xffe8c8, emissiveIntensity: 1.35,
    });
    const entry = { light, glow: { material: glassMat }, base: 11.5 };
    practicals.push(entry);

    if (merch) {
      merch.onReady(() => {
        const lamp = merch.instantiate('pendant');
        if (!lamp) return;
        // The model is 0.50 yd tall and its pivot is the ceiling mount, so at 1:1
        // it tucked up under the ceiling and read as a dark speck — the lantern it
        // replaced dropped 0.75 yd and hung in view. Scaled to hang properly.
        lamp.scale.setScalar(1.45);
        lamp.position.set(lx, CEIL_Y, lz);
        lamp.traverse((o) => {
          if (o.isMesh && o.userData.slot === 'M_glass') o.material = glassMat;
        });
        interior.add(lamp);
      });
      return entry;
    }

    const g = new THREE.Group();
    g.position.set(lx, 0, lz);
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.55, 6), mats.iron);
    drop.position.y = CEIL_Y - 0.28;
    g.add(drop);
    const glassBody = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.32, 0.27), glassMat);
    glassBody.position.y = CEIL_Y - 0.75;
    g.add(glassBody);
    interior.add(g);
    return entry;
  }

  const displaySpots = [];
  function addDisplaySpot(lx, lz, tx, tz, { base = 13, minTier = 1, color = 0xffe6bf } = {}) {
    const light = new THREE.SpotLight(color, 0, 8.5, 0.52, 0.72, 1.8);
    light.position.set(lx, CEIL_Y - 0.28, lz);
    light.castShadow = false;
    const target = new THREE.Object3D();
    target.position.set(tx, 1.08, tz);
    interior.add(light, target);
    light.target = target;
    displaySpots.push({ light, base, minTier });
    return light;
  }

  // The previous pendant/can grid remains as an uncalled fallback builder for
  // older focused tests. Production lighting is the eight-panel rig below.

  // daylight fills (cool bounce at the glazed walls; scaled by time of day).
  // pulled a body-length into the room with short throw — point lights don't
  // shadow, so anything nearer the wall bleeds onto the exterior siding.
  const fills = [];
  for (const [fx, fz] of SHELL_LIGHT_PLACEMENTS.daylightFills) {
    const f = new THREE.PointLight(0xeaf2ff, 0, 5.5, 2.0);
    f.position.set(fx, 2.2, fz);
    interior.add(f);
    fills.push(f);
  }

  // Pine Hills' eight luminous panels are authored area sources on every
  // supported renderer. Three owns the shared LTC lookup textures, so initialize
  // them once and never dispose them with an individual clubhouse instance.
  ensureRectAreaLights();
  const panelRig = new THREE.Group();
  panelRig.name = 'PineHillsCeilingPanelRig';
  panelRig.userData.resourceOwner = 'clubhouse-interior';
  panelRig.userData.sharedUniformOwner = 'RectAreaLightUniformsLib';
  interior.add(panelRig);
  const panelEntries = [];
  // The rig hangs from the variant's ceiling — the v1 shell plane (SHELL.h,
  // so v1 output is unchanged) or the v2 greybox lid at 2.80. Panel rows carry
  // `simId`: the save/sim key their fault state, flicker and repair semantics
  // run on; in v1 it always equals the position id.
  const PANEL_RIG_Y = CEILING_PANEL_RIG.y;
  for (const panel of CEILING_PANEL_RIG.panels) {
    const housing = new THREE.Mesh(
      roundedBox(panel.w + 0.11, 0.055, panel.d + 0.11, 0.025),
      new THREE.MeshStandardMaterial({ color: 0x7b6855, roughness: 0.72 }),
    );
    housing.name = `CeilingPanelHousing_${panel.id}`;
    housing.position.set(panel.x, PANEL_RIG_Y - 0.025, panel.z);
    panelRig.add(housing);
    const faceMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff2dc,
      emissive: 0xffd6a1,
      emissiveIntensity: 1.45,
      roughness: 0.66,
    });
    const face = new THREE.Mesh(new THREE.BoxGeometry(panel.w, 0.025, panel.d), faceMaterial);
    face.name = `CeilingPanelFace_${panel.id}`;
    face.position.set(panel.x, PANEL_RIG_Y - 0.063, panel.z);
    panelRig.add(face);
    const light = new THREE.RectAreaLight(
      PINE_HILLS_CEILING_PANEL_LIGHTING.color,
      0,
      panel.w * PINE_HILLS_CEILING_PANEL_LIGHTING.widthScale,
      panel.d * PINE_HILLS_CEILING_PANEL_LIGHTING.heightScale,
    );
    light.name = `CeilingPanelLight_${panel.id}`;
    light.position.set(panel.x, PANEL_RIG_Y - 0.09, panel.z);
    light.rotation.x = -Math.PI / 2;
    light.castShadow = false;
    light.userData.lightingBackend = PINE_HILLS_CEILING_PANEL_LIGHTING.backend;
    light.userData.panelId = panel.id;
    light.userData.resourceOwner = 'clubhouse-interior';
    light.userData.sharedUniformOwner = 'RectAreaLightUniformsLib';
    panelRig.add(light);
    panelEntries.push({
      ...panel,
      housing,
      face,
      light,
      faceMaterial,
      base: PINE_HILLS_CEILING_PANEL_LIGHTING.baseIntensity,
      authoredLayerMask: light.layers.mask,
    });
  }

  // Reception and retail each receive one modest, non-shadowed warm accent.
  const accentEntries = [
    { id: 'reception', x: FRONT_DESK.logoBackdrop.x + 0.2, z: FRONT_DESK.logoBackdrop.z + 0.8, base: 7.6 },
    { id: 'retail', x: SHELL_LIGHT_PLACEMENTS.retailAccent.x, z: SHELL_LIGHT_PLACEMENTS.retailAccent.z, base: 7.2 },
  ].map((accent) => {
    const light = new THREE.PointLight(0xffcf9b, 0, 5.8, 2.0);
    light.name = `PineHillsAccent_${accent.id}`;
    light.position.set(accent.x, 2.45, accent.z);
    light.castShadow = false;
    interior.add(light);
    return { ...accent, light };
  });
  // porch light by the door (sconce + light)
  const sconce = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.24, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2b2e33, emissive: 0xffdfa4, emissiveIntensity: 0.0 }),
  );
  sconce.position.set(DOOR_MAIN.x + DOOR_MAIN.w / 2 + 0.42, FLOOR_TOP + 2.05, halfD + SHELL.wallT / 2 + 0.06);
  group.add(sconce);
  // Asset 54 carries the porch construction but only exposes exterior-light
  // sockets; keep this actual fixture with the live PointLight when the authored
  // porch replaces the procedural deck/roof/railings.
  const porchLight = new THREE.PointLight(0xffdfa4, 0, 7, 1.8);
  porchLight.position.set(DOOR_MAIN.x, FLOOR_TOP + 2.3, halfD + 1.2);
  group.add(porchLight);

  let conditionNow = 100;
  let shopTierNow = shopTierIndex(state);
  let flickT = 0;
  let moodDayF = 1;
  let windowDim = 1; // filthy glass chokes the daylight fills
  let tierNow = Math.max(1, Math.min(3, state.shop?.unlockedTier || 1));
  let tierProfile = shopLightingTier(tierNow);
  let ceilingCircuitPowered = true;
  let panelStates = restorationSnapshot(state)?.lightPanels || {};
  let panelBudgetLocalX = DOOR_MAIN.x;
  let panelBudgetLocalZ = INTERIOR.d / 2 - 1.0;
  let panelRenderBudgetState = Object.freeze({
    limit: PINE_HILLS_RENDERED_PANEL_BUDGET,
    eligible: 0,
    rendered: 0,
    renderedPanelIds: Object.freeze([]),
  });
  const panelState = (panelId) => panelStates[panelId]
    || (panelId === 'panel-02' ? 'flicker' : panelId === 'panel-07' ? 'dead' : 'working');

  function applyPanelRenderBudget() {
    const eligible = panelEntries
      .filter((panel) => panel.light.visible && panel.light.intensity > 0)
      .map((panel, authoredIndex) => ({
        panel,
        authoredIndex,
        distanceSq: (panel.x - panelBudgetLocalX) ** 2 + (panel.z - panelBudgetLocalZ) ** 2,
      }))
      .sort((left, right) => left.distanceSq - right.distanceSq
        || left.authoredIndex - right.authoredIndex);
    const rendered = new Set(
      eligible.slice(0, PINE_HILLS_RENDERED_PANEL_BUDGET).map((entry) => entry.panel),
    );
    for (const panel of panelEntries) {
      const active = rendered.has(panel);
      panel.light.layers.mask = active ? panel.authoredLayerMask : 0;
      panel.light.userData.renderBudgetActive = active;
    }
    panelRenderBudgetState = Object.freeze({
      limit: PINE_HILLS_RENDERED_PANEL_BUDGET,
      eligible: eligible.length,
      rendered: rendered.size,
      renderedPanelIds: Object.freeze(
        eligible.slice(0, PINE_HILLS_RENDERED_PANEL_BUDGET).map((entry) => entry.panel.id),
      ),
    });
    return panelRenderBudgetState;
  }

  function applyPracticalLevels() {
    // practicals stay on all day (retail) but carry the room after dark
    const finishScale = [0.60, 0.80, 1.0, 1.14][shopTierNow] || 0.60;
    const scale = (0.72 + 0.55 * (1 - moodDayF)) * finishScale;
    practicals.forEach((p, i) => {
      let on = ceilingCircuitPowered ? 1 : 0;
      if (shopTierNow === 0 && [1, 2, 4, 5, 6].includes(i)) on = 0;
      if (shopTierNow === 1 && [2, 5].includes(i)) on = 0;
      if (conditionNow < 45 && i === 4) on = 0;              // a dead can in the neglect years
      if (conditionNow < 55 && (i === 9 || i === 12)) on = 0; // dark corners until refurbished
      if (p.light) p.light.intensity = p.base * scale * on;
      const glowMaterial = p.glow.material;
      if (!glowMaterial.userData.ceilingCircuitOnColor) {
        glowMaterial.userData.ceilingCircuitOnColor = glowMaterial.color.clone();
        glowMaterial.userData.ceilingCircuitOffColor = glowMaterial.color.clone().multiplyScalar(0.16);
      }
      glowMaterial.color.copy(ceilingCircuitPowered
        ? glowMaterial.userData.ceilingCircuitOnColor
        : glowMaterial.userData.ceilingCircuitOffColor);
      p.glow.material.emissiveIntensity = on
        ? (i < 3 ? 2.0 : 1.4) * (0.8 + 0.45 * (1 - moodDayF)) * tierProfile.practicalScale
        : (ceilingCircuitPowered ? 0.04 : 0);
    });
    for (const spot of displaySpots) {
      const visibleAtTier = ceilingCircuitPowered && tierNow >= spot.minTier ? 1 : 0;
      spot.light.intensity = spot.base * tierProfile.displayScale
        * (0.86 + 0.18 * (1 - moodDayF)) * visibleAtTier;
    }
    panelStates = restorationSnapshot(state)?.lightPanels || panelStates;
    const panelFinishScale = [0.82, 0.92, 1.0, 1.06][shopTierNow] || 0.82;
    const panelScale = (0.92 + 0.20 * (1 - moodDayF))
      * panelFinishScale * tierProfile.practicalScale;
    for (const panel of panelEntries) {
      const stateNow = panelState(panel.simId);
      const on = ceilingCircuitPowered && stateNow !== 'dead';
      panel.light.visible = on;
      panel.light.intensity = on ? panel.base * panelScale : 0;
      // A failed fluorescent is still a cream diffuser, not a black ceiling
      // hole. Let the room's ambient/daylight reveal a warm unlit face while
      // keeping emission and the physical area source completely off.
      panel.faceMaterial.color.setHex(on ? 0xfff2dc : 0xc9c1b3);
      panel.faceMaterial.emissive.setHex(on ? 0xffd6a1 : 0x000000);
      panel.faceMaterial.emissiveIntensity = on ? 1.45 * panelScale : 0;
    }
    for (const accent of accentEntries) {
      accent.light.visible = ceilingCircuitPowered;
      accent.light.intensity = ceilingCircuitPowered
        ? accent.base * (0.88 + 0.20 * (1 - moodDayF)) * tierProfile.displayScale
        : 0;
    }
    applyPanelRenderBudget();
  }

  const lighting = {
    setShopTier(tierId = null) {
      shopTierNow = tierId == null ? shopTierIndex(state) : shopTierIndex(state, tierId);
      if (retailSlab) {
        retailSlab.material = [mats.concrete, mats.rawWood, mats.oakFloor, luxuryFloorMaterial][shopTierNow]
          || mats.concrete;
      }
      applyPracticalLevels();
    },
    setTimeMood(minuteOfDay) {
      // full day 07:00–18:30, 75-minute ramps either side
      const up = (minuteOfDay - 345) / 75;
      const down = (1185 - minuteOfDay) / 75;
      moodDayF = Math.max(0, Math.min(1, up, down));
      for (const f of fills) {
        f.visible = moodDayF > 0.001;
        f.intensity = 15 * moodDayF * windowDim;
      }
      porchLight.visible = moodDayF < 0.999;
      porchLight.intensity = 9 * (1 - moodDayF);
      sconce.material.emissiveIntensity = 1.2 * (1 - moodDayF);
      mats.glass.emissive = mats.glass.emissive || new THREE.Color(0xffd9a8);
      mats.glass.emissive.setHex(0xffd9a8);
      mats.glass.emissiveIntensity = 0.3 * (1 - moodDayF);
      applyPracticalLevels();
    },
    refreshCondition(cond) {
      conditionNow = cond;
      applyPracticalLevels();
    },
    setWindowDirt(avg) {
      windowDim = 1 - 0.45 * Math.max(0, Math.min(1, avg));
      for (const f of fills) f.intensity = 15 * moodDayF * windowDim;
    },
    setCeilingCircuitPowered(powered) {
      const next = powered !== false;
      if (next === ceilingCircuitPowered) return false;
      ceilingCircuitPowered = next;
      applyPracticalLevels();
      return true;
    },
    isCeilingCircuitPowered: () => ceilingCircuitPowered,
    refreshRestoration() {
      panelStates = restorationSnapshot(state)?.lightPanels || panelStates;
      applyPracticalLevels();
      return { ...panelStates };
    },
    setCameraLocalPosition(x, z) {
      if (Number.isFinite(x)) panelBudgetLocalX = x;
      if (Number.isFinite(z)) panelBudgetLocalZ = z;
      return applyPanelRenderBudget();
    },
    panelRenderBudget: () => panelRenderBudgetState,
    updateFlicker(dt) {
      if (!ceilingCircuitPowered) return;
      if (panelState('panel-02') !== 'flicker') return;
      flickT += dt;
      const p = panelEntries.find((panel) => panel.simId === 'panel-02');
      if (!p) return;
      const drop = Math.sin(flickT * 13.1) * Math.sin(flickT * 4.7 + 2.1) < -0.55;
      const scale = (0.92 + 0.20 * (1 - moodDayF)) * tierProfile.practicalScale;
      p.light.intensity = p.base * scale
        * (drop ? 0.04 : 0.84 + 0.16 * Math.sin(flickT * 31));
      p.faceMaterial.emissiveIntensity = drop ? 0.04 : 1.25 * scale;
    },
  };
  lighting.setShopTier();
  lighting.setTimeMood(600);

  const productionVisualFallbacks = Object.freeze(Object.fromEntries(
    PRODUCTION_VISUAL_FALLBACK_KEYS.map((key) => [
      key,
      productionVisualHandle(key, productionFallbackNodes[key]),
    ]),
  ));
  const productionVisualFallbackCounts = Object.freeze(Object.fromEntries(
    PRODUCTION_VISUAL_FALLBACK_KEYS.map((key) => [
      key, productionVisualFallbacks[key].nodeCount,
    ]),
  ));

  return {
    windowDefs,
    lighting,
    sidingMat,
    roofMat,
    productionVisualFallbacks,
    productionVisualFallbackKeys: PRODUCTION_VISUAL_FALLBACK_KEYS,
    productionVisualFallbackCounts,
    partitionColliders: Object.freeze(partitionColliders),
    setBusinessOpen: (open) => repaintBusinessSign(open),
  };
}
