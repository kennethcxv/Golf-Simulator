// THE MAINTENANCE SHED SHELL — a small real room substituted for the clubhouse
// under the 'shed' presentation. It builds walls / floor / roof / an open door
// gap / two glazed window openings / one warm bare bulb, registers per-segment
// wall colliders (the doorway is left open), and returns the FULL shell contract
// that makeClubhouse consumes (windowDefs, lighting facade, styleSurfaces,
// productionVisualFallbacks, partitionColliders, setSignFace) so the shed
// drops straight into the clubhouse's existing walk / cleaning / lighting wiring
// with zero downstream change.
//
// Coordinate convention (shopLayout.js / shedLayout.js): origin at room center,
// +z = SOUTH = the door side, +x = EAST. In group-space y = 0 sits on the
// terrain (baseY); the finished floor is FLOOR_TOP above it. In interior-space
// y = 0 sits at the finished floor. Walls / floor / roof / windows go on B.group
// (they cast the sun shadow onto the course); the ceiling deck, beams and the
// bulb go on B.interior, exactly as the legacy buildShell splits them.

import * as THREE from 'three';
import { SHED_SHELL, SHED_ROOM, DOOR, WINDOWS } from '../../data/shedLayout.js';
import { makeSidingTexture } from './materials.js';

// Same nine keys the legacy shell exposes (shell.js). The sheet-06 production
// runtime validates that every fallback facade exposes visible/getVisible/
// setVisible and looks each of these up by name, so the shed must present the
// full set — as EMPTY handles (zero nodes) so nothing downstream can ever hide
// the real shed shell.
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

function emptyFallbackHandle(name) {
  return Object.freeze({
    name,
    nodes: Object.freeze([]),
    nodeCount: 0,
    getVisible: () => true,
    setVisible: () => true,
    visible: true,
  });
}

export function buildShedShell(B) {
  const { group, interior, mats, addCol, colBoxAt, FLOOR_TOP } = B;

  const wallT = SHED_SHELL.wallT;
  const roomHW = SHED_ROOM.w / 2;         // interior clear half-width  (x) = 4.03
  const roomHD = SHED_ROOM.d / 2;         // interior clear half-depth  (z) = 3.03
  const wallMidX = roomHW + wallT / 2;    // side-wall centerline x
  const wallMidZ = roomHD + wallT / 2;    // front/back-wall centerline z
  const outerHW = roomHW + wallT;         // outer wall face x (= SHED_SHELL.w/2)
  const outerHD = roomHD + wallT;         // outer wall face z (= SHED_SHELL.d/2)
  const wallTop = FLOOR_TOP + SHED_SHELL.h;    // group-space ceiling height

  // --- materials: borrow the clubhouse generators, re-tinted for a weathered
  //     sage-grey shed. Concrete slab floor, charcoal beams/trim. ------------
  const sidingTex = makeSidingTexture({ seed: 613, base: '#9aa196' });
  sidingTex.wrapS = THREE.RepeatWrapping;
  sidingTex.wrapT = THREE.RepeatWrapping;
  sidingTex.repeat.set(3.4, 1.5);
  const wallMat = new THREE.MeshStandardMaterial({ map: sidingTex, roughness: 0.93 });
  // Sealed concrete pour. Task-6: raised from the near-black 0x6f6a62 tint so a fully cleaned floor
  // visibly BRIGHTENS (the §8 payoff). The grime plane is transparent when clean, so the clean-floor
  // luminance IS this albedo — halving it (the old value) is why a scrubbed floor read no brighter
  // than dirty. Kept below the shared near-white concrete so the floor/wall junction still reads as a
  // muted baseboard, not a bright skirting band (Task-5 trap #4). Cloned to keep it shed-scoped.
  const floorMat = mats.concrete.clone();
  floorMat.color.setHex(0x968f83);
  const trimMat = mats.charcoal;    // charcoal beams + window frames
  // Plywood deck underside — cloned and matted down (visual-QA iteration 4,
  // defect #2): at the shared rawWood roughness the bare bulb drew a hard
  // white specular band across the deck that read as a render artifact.
  const ceilMat = mats.rawWood.clone();
  ceilMat.roughness = 0.96;
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3934, roughness: 0.86 });

  const windowDefs = [];

  // --- floor slab (group; top at FLOOR_TOP, mirrors buildShell's retail slab) ---
  {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(SHED_SHELL.w, FLOOR_TOP, SHED_SHELL.d), floorMat,
    );
    slab.position.set(0, FLOOR_TOP / 2, 0);
    slab.receiveShadow = true;
    slab.name = 'ShedFloor';
    group.add(slab);
  }

  // --- walls: runs of box segments around the openings (buildShell idiom, at a
  //     small scale). Colliders leave the DOOR gap open; window openings stay
  //     behind a solid wall collider exactly as the legacy shell does. --------
  function buildWall({ axis, at, from, to, openings }) {
    const sorted = [...openings].sort((a, b) => a.c - b.c);
    const segs = [];
    let cursor = from;
    for (const o of sorted) {
      const o0 = o.c - o.w / 2;
      const o1 = o.c + o.w / 2;
      if (o0 > cursor) segs.push({ a: cursor, b: o0, y0: FLOOR_TOP, y1: wallTop });
      if (o.y1 < wallTop) segs.push({ a: o0, b: o1, y0: o.y1, y1: wallTop });   // header
      if (o.y0 > FLOOR_TOP) segs.push({ a: o0, b: o1, y0: FLOOR_TOP, y1: o.y0 }); // sill
      cursor = o1;
    }
    if (cursor < to) segs.push({ a: cursor, b: to, y0: FLOOR_TOP, y1: wallTop });

    for (const s of segs) {
      const len = s.b - s.a;
      const h = s.y1 - s.y0;
      if (len <= 0.01 || h <= 0.01) continue;
      const geo = axis === 'x'
        ? new THREE.BoxGeometry(len, h, wallT)
        : new THREE.BoxGeometry(wallT, h, len);
      const m = new THREE.Mesh(geo, wallMat);
      const mid = (s.a + s.b) / 2;
      if (axis === 'x') m.position.set(mid, (s.y0 + s.y1) / 2, at);
      else m.position.set(at, (s.y0 + s.y1) / 2, mid);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = 'ShedWall';
      group.add(m);
    }

    // colliders: solid spans that leave only the door gaps open (windows stay
    // solid), matching buildShell's `spans` rule.
    const doorGaps = openings.filter((o) => o.isDoor)
      .map((d) => [d.c - d.w / 2, d.c + d.w / 2]).sort((a, b) => a[0] - b[0]);
    let c = from;
    const spans = [];
    for (const [g0, g1] of doorGaps) {
      if (g0 > c) spans.push([c, g0]);
      c = g1;
    }
    if (c < to) spans.push([c, to]);
    for (const [a, b] of spans) {
      if (axis === 'x') addCol(colBoxAt((a + b) / 2, at, b - a, wallT + 0.12));
      else addCol(colBoxAt(at, (a + b) / 2, wallT + 0.12, b - a));
    }
  }

  // both windows share one dimension set
  const winY0 = FLOOR_TOP + WINDOWS[0].sill;
  const winY1 = winY0 + WINDOWS[0].h;

  // Door header: the walnut kit door frame tops out at interior y 2.30, so a
  // full-height gap left a 0.6-yd open sky slit between the frame and the eave
  // (visual-QA iteration 1, defect #2). The header seg starts just below the
  // frame top so the kit's proud header bar covers the seam; the door-gap
  // COLLIDER spans are horizontal and ignore y, so passability is unchanged.
  const doorHeadY = FLOOR_TOP + 2.26;

  // South wall (+z): door gap + south window opening
  buildWall({
    axis: 'x', at: wallMidZ, from: -outerHW, to: outerHW,
    openings: [
      { c: DOOR.x, w: DOOR.w, y0: FLOOR_TOP, y1: doorHeadY, isDoor: true },
      { c: WINDOWS[0].x, w: WINDOWS[0].w, y0: winY0, y1: winY1 },
    ],
  });
  // Threshold saddle across the open doorway: the bare slab edge sat in the
  // header's shadow and read as a black void strip across the door base from
  // the approach (visual-QA iteration 4, defect #3). A low oak saddle catches
  // the light and reads as a doorway, not a step down. Visual-only: no
  // collider, and the walk floor height comes from layout data, not meshes.
  {
    const saddle = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR.w, 0.03, wallT + 0.12),
      new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 }),
    );
    saddle.position.set(DOOR.x, FLOOR_TOP + 0.015, wallMidZ);
    saddle.receiveShadow = true;
    saddle.name = 'ShedThreshold';
    group.add(saddle);
  }

  // North wall (-z): solid
  buildWall({ axis: 'x', at: -wallMidZ, from: -outerHW, to: outerHW, openings: [] });
  // West wall (-x): solid
  buildWall({ axis: 'z', at: -wallMidX, from: -outerHD, to: outerHD, openings: [] });
  // East wall (+x): east window opening
  buildWall({
    axis: 'z', at: wallMidX, from: -outerHD, to: outerHD,
    openings: [{ c: WINDOWS[1].z, w: WINDOWS[1].w, y0: winY0, y1: winY1 }],
  });

  // --- windows: glazed holders + charcoal frames; windowDefs are the contract
  //     buildDirt / lighting consume (order = index into reno.windows). -------
  function addWindow(w, i) {
    const holder = new THREE.Group();
    const W = w.w;
    const H = w.h;
    const y = FLOOR_TOP + w.sill + H / 2;
    let px = 0;
    let pz = 0;
    let ry = 0;
    if (w.wall === 'S') { px = w.x; pz = wallMidZ; ry = 0; }
    if (w.wall === 'E') { px = wallMidX; pz = w.z; ry = Math.PI / 2; }
    // S and E interior faces point toward -z / -x respectively (see buildShell)
    const insideSign = -1;
    holder.position.set(px, y, pz);
    holder.rotation.y = ry;
    holder.name = `ShedWindow_${w.id}`;
    group.add(holder);

    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.08, H - 0.08), mats.glass);
    holder.add(glass);
    const frame = (bw, bh, bx, by) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, wallT + 0.06), trimMat);
      b.position.set(bx, by, 0);
      holder.add(b);
    };
    frame(W + 0.12, 0.08, 0, H / 2 + 0.02);
    frame(W + 0.12, 0.08, 0, -H / 2 - 0.02);
    frame(0.08, H + 0.12, -W / 2 - 0.02, 0);
    frame(0.08, H + 0.12, W / 2 + 0.02, 0);
    // one muntin bar so the pane reads as glazing, not a hole
    const muntin = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.06, 0.05), trimMat);
    holder.add(muntin);

    windowDefs.push({
      wall: w.wall,
      c: w.wall === 'S' ? w.x : w.z,
      holder,
      y,
      w: W,
      h: H,
      insideSign,
    });
  }
  addWindow(WINDOWS[0], 0); // south -> windowDefs[0] -> reno.windows[0]
  addWindow(WINDOWS[1], 1); // east  -> windowDefs[1] -> reno.windows[1]

  // --- roof: a flat slab seated on the wall plate (group; casts the sun
  //     shadow onto the course). The old 0.12-pitched slab floated its high
  //     side ~0.4 yd off the level wall tops, so the approach view read a
  //     doubled roofline with a bright sky slit under the raised edge
  //     (visual-QA iteration 1, defect #1). Seated flat, the underside sits at
  //     wallTop + 0.02, inside a full charcoal fascia ring, so every elevation
  //     seals wall-to-roof. ---------------------------------------------------
  {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(SHED_SHELL.w + 0.6, 0.16, SHED_SHELL.d + 0.6), roofMat,
    );
    roof.position.set(0, wallTop + 0.10, 0);
    roof.castShadow = true;
    roof.receiveShadow = true;
    roof.name = 'ShedRoof';
    group.add(roof);
    // a thin charcoal fascia band under the eave — a full ring (front/back +
    // both rakes) so no slit opens between wall top and roof underside
    for (const zSide of [-1, 1]) {
      const fascia = new THREE.Mesh(
        new THREE.BoxGeometry(SHED_SHELL.w + 0.6, 0.14, 0.06), trimMat,
      );
      fascia.position.set(0, wallTop + 0.02, zSide * (outerHD + 0.28));
      fascia.name = 'ShedFascia';
      group.add(fascia);
    }
    for (const xSide of [-1, 1]) {
      const fascia = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.14, SHED_SHELL.d + 0.6), trimMat,
      );
      fascia.position.set(xSide * (outerHW + 0.28), wallTop + 0.02, 0);
      fascia.name = 'ShedFascia';
      group.add(fascia);
    }
  }

  // --- ceiling deck + beams (interior; whitelisted 'Shed' names) ------------
  {
    const ceil = new THREE.Mesh(
      new THREE.BoxGeometry(SHED_ROOM.w, 0.08, SHED_ROOM.d), ceilMat,
    );
    ceil.position.set(0, SHED_SHELL.h - 0.04, 0); // interior-space (floor origin)
    ceil.name = 'ShedCeiling';
    interior.add(ceil);
    for (const bx of [-2.4, 0, 2.4]) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.2, SHED_ROOM.d), trimMat,
      );
      beam.position.set(bx, SHED_SHELL.h - 0.18, 0);
      beam.name = 'ShedBeam';
      interior.add(beam);
    }
  }

  // --- one warm bare bulb on a short cord + the lighting facade -------------
  const bulbGroup = new THREE.Group();
  bulbGroup.name = 'ShedBulb';
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d6, emissive: 0xffd79a, emissiveIntensity: 1.0,
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), bulbMat);
  const bulbX = 0.4;
  const bulbZ = -0.3;
  const bulbY = SHED_SHELL.h - 0.4; // interior-space
  bulb.position.set(bulbX, bulbY, bulbZ);
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.007, 0.007, 0.36, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.9 }),
  );
  cord.position.set(bulbX, bulbY + 0.2, bulbZ);
  const bulbLight = new THREE.PointLight(0xffd79a, 9, 10, 2);
  bulbLight.position.set(bulbX, bulbY, bulbZ);
  bulbLight.castShadow = false;
  bulbGroup.add(bulb, cord, bulbLight);
  interior.add(bulbGroup);

  let ceilingCircuitPowered = true;
  let moodDayF = 1;
  const applyBulb = () => {
    const night = 1 - moodDayF;
    if (ceilingCircuitPowered) {
      bulbLight.intensity = 4.5 + 6.5 * night;
      bulbMat.emissiveIntensity = 0.65 + 0.9 * night;
    } else {
      bulbLight.intensity = 0;
      bulbMat.emissiveIntensity = 0.04;
    }
  };
  applyBulb();

  // The lighting facade implements every method makeClubhouse calls on
  // shell.lighting; visuals are the single bulb + a daylight mood on it.
  const lighting = {
    setShopTier() {},
    setTimeMood(minuteOfDay) {
      // full day 07:00-18:30, 75-minute ramps either side (same curve as shell)
      const up = (minuteOfDay - 345) / 75;
      const down = (1185 - minuteOfDay) / 75;
      moodDayF = Math.max(0, Math.min(1, up, down));
      applyBulb();
    },
    refreshCondition() {},
    setWindowDirt() {},
    setCeilingCircuitPowered(powered) {
      const next = powered !== false;
      if (next === ceilingCircuitPowered) return false;
      ceilingCircuitPowered = next;
      applyBulb();
      return true;
    },
    isCeilingCircuitPowered: () => ceilingCircuitPowered,
    refreshRestoration() { return {}; },
    setCameraLocalPosition() { return null; },
    panelRenderBudget: () => Object.freeze({ shed: true, panels: 0 }),
    updateFlicker() {},
  };
  lighting.setTimeMood(600);

  const productionVisualFallbacks = Object.freeze(Object.fromEntries(
    PRODUCTION_VISUAL_FALLBACK_KEYS.map((key) => [key, emptyFallbackHandle(key)]),
  ));

  return {
    windowDefs,
    lighting,
    styleSurfaces: {},
    productionVisualFallbacks,
    productionVisualFallbackKeys: PRODUCTION_VISUAL_FALLBACK_KEYS,
    partitionColliders: [],
    // The shed has no street frontage and no board on it. It still answers the
    // shell contract so the registry can register it unconditionally.
    setSignFace: () => {},
    exteriorSignName: null,
    // harmless extras mirroring buildShell's return (unused downstream under shed)
    sidingMat: wallMat,
    roofMat,
  };
}
