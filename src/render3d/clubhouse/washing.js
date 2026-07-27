// THE PRESSURE WASHER, in the world.
//
// Every washable face of the building carries a grime layer whose alpha is the sim's mask. The
// jet raycasts to whatever you are actually pointing at, erodes the mask at that exact spot, and
// the clean siding underneath is revealed — a patch at a time, in the shape of the fan, wherever
// the water lands. Nowhere else.
//
// Heavy staining is a different colour and shrugs the water off once the loose film is gone; soap
// goes on as a pale foam that sits there until the jet takes it, and the stain, away with it.

import * as THREE from 'three';
import { SHELL } from '../../data/shopLayout.js';
import {
  ensureWash, washState, WASH_SURFACES, washAt, soapAt, surfaceClean, exteriorWashScore,
} from '../../sim/washing.js';
import { firstUnoccludedHit } from '../toolSockets.js';

const CELL_PX = 14; // canvas resolution per mask cell (the grid is ~0.25yd, so this is plenty)

// Exterior wetness is feedback, not progress. It stays runtime-only like a particle system, but
// lives long enough to leave a readable dark sheen after the trigger is released.
export const WASH_WET_DRY_SEC = 12;

/** Lay a soft, surface-local wet fan into a flat grid. Exported for deterministic lifecycle tests. */
export function applyWashWetness(field, surface, u, v, radiusYd, amount = 1) {
  if (!field || !surface?.grid || !surface?.size) return 0;
  const width = surface.grid.w;
  const height = surface.grid.h;
  const radius = Math.max(0.01, Number(radiusYd) || 0.01);
  const centreU = Math.max(0, Math.min(1, Number(u) || 0));
  const centreV = Math.max(0, Math.min(1, Number(v) || 0));
  const rx = Math.ceil((radius / surface.size.w) * width) + 1;
  const ry = Math.ceil((radius / surface.size.h) * height) + 1;
  const cx = centreU * width;
  const cy = centreV * height;
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(width - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(height - 1, Math.ceil(cy + ry));
  let touched = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const du = ((x + 0.5) / width - centreU) * surface.size.w;
      const dv = ((y + 0.5) / height - centreV) * surface.size.h;
      const distance = Math.hypot(du, dv);
      if (distance > radius) continue;
      const strength = Math.max(0, 1 - (distance / radius) ** 2);
      const index = y * width + x;
      const next = Math.max(field[index] || 0, Math.min(1, amount * strength));
      if (next > (field[index] || 0) + 1e-6) touched += 1;
      field[index] = next;
    }
  }
  return touched;
}

/** Advance runtime wet feedback. Returns diagnostics so callers can retire dry surfaces cheaply. */
export function fadeWashWetness(field, dtSec) {
  const step = Math.max(0, Number(dtSec) || 0) / WASH_WET_DRY_SEC;
  let changed = false;
  let activeCells = 0;
  let total = 0;
  let max = 0;
  for (let index = 0; index < (field?.length || 0); index++) {
    const before = Number(field[index]) || 0;
    const next = Math.max(0, before - step);
    if (Math.abs(next - before) > 1e-6) changed = true;
    field[index] = next;
    if (next <= 0) continue;
    activeCells += 1;
    total += next;
    max = Math.max(max, next);
  }
  return {
    changed,
    activeCells,
    total,
    mean: activeCells ? total / activeCells : 0,
    max,
  };
}

// Where each washable face lives on the building, in building-local yards. `rot` orients the
// plane; the default faces +z (south).
//
// These are fitted to the SIDING, not to the wall: the south windows are 2.4 x 1.9 on an 0.85
// sill at x -8.3 and -4.9, and the main door is at -0.8. Grime belongs on clapboard, not glass.
// The west gable has no openings at all, so it is the big canvas.
function placements() {
  const halfD = SHELL.d / 2;
  const halfW = SHELL.w / 2;
  const zS = halfD + SHELL.wallT / 2 + 0.02; // just proud of the south wall
  const xW = -halfW - SHELL.wallT / 2 - 0.02; // just proud of the west wall
  return {
    // the band under the eave, above both south windows (their heads are at y 2.75)
    sidingSW: { w: 8.2, h: 1.05, pos: [-6.2, 3.42, zS], rot: [0, 0, 0] },
    // the whole south face east of the door — no openings, so it takes the full height
    sidingSE: { w: 9.0, h: 3.0, pos: [5.6, 2.3, zS], rot: [0, 0, 0] },
    // the damp base of the wall, below the window sills (0.85) — where mould actually grows.
    // NOT the buried skirt: half of that is under the grass, and you cannot wash what you
    // cannot see or point at.
    foundation: { w: 20.6, h: 0.8, pos: [0, 0.45, zS], rot: [0, 0, 0] },
    // the decking is horizontal: lay the plane flat, face up
    porch: { w: 12.6, h: 3.2, pos: [-1.0, 0.32, halfD + SHELL.porchD / 2 + 0.2], rot: [-Math.PI / 2, 0, 0] },
    // the west gable: solid clapboard, top to bottom
    trim: { w: 12.0, h: 3.2, pos: [xW, 2.3, 0], rot: [0, -Math.PI / 2, 0] },
  };
}

// one shared grime look, drawn once: streaks, splashes and blotches. The mask decides where any
// of it survives, so the dirt never reads as a flat coat of paint.
function grimeSheet(w, h, heavy, seed) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true });
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  // weathered, not painted black: this tints and mottles the clapboard, it does not replace it —
  // but it has to be dark enough that a washed patch obviously *reads* as washed
  c.fillStyle = heavy ? 'rgba(78,92,62,1)' : 'rgba(101,92,70,1)';
  c.fillRect(0, 0, w, h);

  // vertical run-down streaks — the signature of a wall nobody has washed
  for (let i = 0; i < w / 3; i++) {
    const x = rnd() * w;
    const wide = 2 + rnd() * 9;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(58,60,42,0.34)');
    g.addColorStop(1, 'rgba(58,60,42,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, wide, h * (0.35 + rnd() * 0.65));
  }
  // blotches
  for (let i = 0; i < w / 5; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 6 + rnd() * 26;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, heavy ? 'rgba(70,92,58,0.5)' : 'rgba(88,76,54,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
  // fine speckle
  const img = c.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 34;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  c.putImageData(img, 0, 0);
  return cv;
}

export function buildWashing(B) {
  const { group, state, hooks } = B;
  ensureWash(state);
  const place = placements();
  const surfaces = {};
  const meshes = [];
  const wash = new THREE.Group();
  group.add(wash);

  for (const surf of WASH_SURFACES) {
    const p = place[surf.id];
    if (!p) continue;
    const gw = surf.grid.w;
    const gh = surf.grid.h;
    const W = gw * CELL_PX;
    const H = gh * CELL_PX;

    const sheet = grimeSheet(W, H, surf.kind === 'heavy', gw * 7 + gh);
    const maskCv = document.createElement('canvas'); // the mask, at cell resolution
    maskCv.width = gw;
    maskCv.height = gh;
    const maskCtx = maskCv.getContext('2d', { willReadFrequently: true });

    const outCv = document.createElement('canvas');
    outCv.width = W;
    outCv.height = H;
    const outCtx = outCv.getContext('2d');
    const wet = new Float32Array(gw * gh);

    const tex = new THREE.CanvasTexture(outCv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(p.w, p.h),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, depthWrite: false }),
    );
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    mesh.renderOrder = 2;
    mesh.userData.washId = surf.id;
    wash.add(mesh);
    meshes.push(mesh);

    // fade the mask out at the plane's border so the dirt blends into the wall instead of ending
    // on a hard rectangle — a decal with a visible edge reads as a sticker, not as grime
    const feather = (cx, cy) => {
      const ex = Math.min(cx + 0.5, gw - 0.5 - cx) / Math.max(1, gw * 0.16);
      const ey = Math.min(cy + 0.5, gh - 0.5 - cy) / Math.max(1, gh * 0.16);
      return Math.min(1, Math.max(0, ex)) * Math.min(1, Math.max(0, ey));
    };

    const MAX_ALPHA = 0.74; // grime weathers the clapboard; it never blacks it out

    const repaint = () => {
      const w = washState(state)[surf.id];
      const img = maskCtx.createImageData(gw, gh);
      for (let cy = 0; cy < gh; cy++) {
        for (let cx = 0; cx < gw; cx++) {
          const g = w.grime[cy * gw + cx];
          // mask row 0 is the BOTTOM of the surface (uv v=0), canvas row 0 is the top
          const px = ((gh - 1 - cy) * gw + cx) * 4;
          img.data[px] = 255;
          img.data[px + 1] = 255;
          img.data[px + 2] = 255;
          img.data[px + 3] = Math.round(Math.min(1, g) * MAX_ALPHA * feather(cx, cy) * 255);
        }
      }
      maskCtx.putImageData(img, 0, 0);

      outCtx.globalCompositeOperation = 'source-over';
      outCtx.clearRect(0, 0, W, H);
      outCtx.drawImage(sheet, 0, 0);
      // keep the dirt only where the mask says there is dirt — smoothed, so it erodes as a soft
      // front under the stream instead of a staircase of cells
      outCtx.globalCompositeOperation = 'destination-in';
      outCtx.imageSmoothingEnabled = true;
      outCtx.imageSmoothingQuality = 'high';
      outCtx.drawImage(maskCv, 0, 0, W, H);

      // foam sits on top of whatever is still there
      outCtx.globalCompositeOperation = 'source-over';
      const ws = washState(state)[surf.id];
      for (let cy = 0; cy < gh; cy++) {
        for (let cx = 0; cx < gw; cx++) {
          const i = cy * gw + cx;
          if (!(ws.soap[i] > 0) || ws.grime[i] <= 0.02) continue;
          const x = (cx + 0.5) * CELL_PX;
          const y = (gh - 1 - cy + 0.5) * CELL_PX;
          const g2 = outCtx.createRadialGradient(x, y, 0, x, y, CELL_PX * 0.95);
          g2.addColorStop(0, 'rgba(244,248,244,0.62)');
          g2.addColorStop(1, 'rgba(244,248,244,0)');
          outCtx.fillStyle = g2;
          outCtx.beginPath();
          outCtx.arc(x, y, CELL_PX * 0.95, 0, Math.PI * 2);
          outCtx.fill();
        }
      }

      // Water leaves a cool, darker sheen on both clean and dirty material. It is drawn last so a
      // washed-clean stripe still looks freshly wet rather than snapping straight to dry siding.
      // Only active cells allocate gradients, keeping an idle/dry exterior at zero repaint cost.
      for (let cy = 0; cy < gh; cy++) {
        for (let cx = 0; cx < gw; cx++) {
          const level = wet[cy * gw + cx];
          if (!(level > 0.002)) continue;
          const x = (cx + 0.5) * CELL_PX;
          const y = (gh - 1 - cy + 0.5) * CELL_PX;
          const alpha = Math.min(0.24, level * 0.24) * feather(cx, cy);
          const wetGlow = outCtx.createRadialGradient(x, y, 0, x, y, CELL_PX * 1.35);
          wetGlow.addColorStop(0, `rgba(24,54,60,${alpha})`);
          wetGlow.addColorStop(1, 'rgba(24,54,60,0)');
          outCtx.fillStyle = wetGlow;
          outCtx.beginPath();
          outCtx.arc(x, y, CELL_PX * 1.35, 0, Math.PI * 2);
          outCtx.fill();
        }
      }
      tex.needsUpdate = true;
    };

    repaint();
    surfaces[surf.id] = { surf, mesh, repaint, wet };
  }

  // --- the jet: a narrow stream from the nozzle, and mist where it lands -------------------
  //
  // Additive, not alpha-over. Water catching the light adds brightness to whatever is behind it;
  // a flat translucent cone over a dark wall just reads as a grey wedge, which is what the first
  // pass looked like — somebody poking the siding with a steel spike.
  const jetMat = new THREE.MeshBasicMaterial({
    color: 0xbcdcff,
    transparent: true,
    opacity: 0.10,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const jet = new THREE.Group();
  jet.name = 'PressureWasherJet';
  const jetBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.015, 1, 6, 1, true), jetMat);
  jetBeam.frustumCulled = false;
  jet.add(jetBeam);
  jet.visible = false;

  // A round, soft droplet. An untextured THREE.Points renders as a hard SQUARE — at 0.075 world
  // units that is a cluster of white cubes stapled to the wall, which is exactly how the shipped
  // spatter read. One 32px radial gradient, generated once and shared, fixes it.
  const dropletTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 32;
    cv.height = 32;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(226,242,255,0.85)');
    g.addColorStop(1.0, 'rgba(200,228,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  const MIST = 60;
  const mistPos = new Float32Array(MIST * 3);
  const mistLife = new Array(MIST).fill(0);
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
  const mist = new THREE.Points(mistGeo, new THREE.PointsMaterial({
    color: 0xeaf6ff,
    size: 0.085,
    map: dropletTex,
    alphaTest: 0.02,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  }));
  mist.visible = false;
  mist.frustumCulled = false;

  // Moving droplets carry the stream. The faint beam above only connects them at distance; it is
  // no longer the solid tapered wedge that made the washer look like a white spike.
  const STREAM = 46;
  const streamPos = new Float32Array(STREAM * 3);
  const streamGeo = new THREE.BufferGeometry();
  streamGeo.setAttribute('position', new THREE.BufferAttribute(streamPos, 3));
  const stream = new THREE.Points(streamGeo, new THREE.PointsMaterial({
    color: 0xd8efff,
    size: 0.040,
    map: dropletTex,
    alphaTest: 0.02,
    transparent: true,
    opacity: 0.74,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  }));
  stream.frustumCulled = false;
  jet.add(stream);
  const jetDirection = new THREE.Vector3();
  const jetNormalized = new THREE.Vector3();
  const jetMidpoint = new THREE.Vector3();
  const jetUp = new THREE.Vector3(0, 1, 0);

  const REACH = 7;

  // --- occluders: you cannot wash what you cannot see ---------------------------------------
  //
  // `aim` used to intersect the five grime planes and nothing else, so as far as the ray was
  // concerned the building did not exist. The porch roof, the columns and the walls were not in
  // the way of anything, and the siding under the eave could be scrubbed straight through the
  // porch it sits behind.
  //
  // Only substantial architecture occludes. A live scene walk shows 459 meshes in this group, of
  // which ~109 are big enough to stop a jet — the roof planes, the gables, the walls, the
  // foundation. Shrubs and trim are not worth the raycast. The set is cached and rebuilt only when
  // the architecture actually changes, because the sheet-06 runtime swaps geometry underneath us.
  const OCCLUDER_MIN_SPAN = 1.2; // yards
  const OCCLUDER_MIN_AREA = 1.0; // square yards of the largest face
  let occluders = null;

  function collectOccluders() {
    const found = [];
    const box = new THREE.Vector3();
    group.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (o.userData && o.userData.washId) return; // a surface never occludes itself
      const g = o.geometry;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      g.boundingBox.getSize(box);
      const sx = box.x * o.scale.x;
      const sy = box.y * o.scale.y;
      const sz = box.z * o.scale.z;
      if (Math.max(sx, sy, sz) < OCCLUDER_MIN_SPAN) return;
      if (Math.max(sx * sy, sy * sz, sx * sz) < OCCLUDER_MIN_AREA) return;
      found.push(o);
    });
    return found;
  }

  const occluderSet = () => (occluders || (occluders = collectOccluders()));

  let dirty = new Set();
  const wetSurfaces = new Set();
  let repaintClock = 0;

  return {
    jet,
    mist,
    meshes,

    // what is the player pointing at? origin/dir are world-space.
    // Geometry in front of a surface blocks it — no washing through the porch roof or a wall.
    aim(origin, dir) {
      const h = firstUnoccludedHit(origin, dir, meshes, occluderSet(), REACH);
      if (!h || !h.uv) return null;
      return {
        id: h.object.userData.washId,
        u: h.uv.x,
        v: h.uv.y,
        point: h.point,
        dist: h.distance,
      };
    },

    // the sheet-06 runtime swaps architecture on restoration; drop the cached occluders so the
    // next aim rebuilds against what is actually standing there now
    invalidateOccluders() {
      occluders = null;
    },

    // pull the trigger: water, or soap. radius is in yards — a real spray pattern.
    apply(hit, mode, radius, power, dtSec, nowSec) {
      if (!hit) return { cleaned: 0, blocked: false };
      const r = mode === 'soap' ? radius * 1.4 : radius; // foam fans wider than the jet
      const res = mode === 'soap'
        ? { cleaned: 0, blocked: false, ...soapAt(state, hit.id, hit.u, hit.v, r, nowSec) }
        : washAt(state, hit.id, hit.u, hit.v, r, power, dtSec, nowSec);
      if (mode !== 'soap') {
        const target = surfaces[hit.id];
        if (target && applyWashWetness(target.wet, target.surf, hit.u, hit.v, r, 1) > 0) {
          wetSurfaces.add(hit.id);
        }
      }
      dirty.add(hit.id);
      return res;
    },

    // the visual: stream from the nozzle to the contact point, mist bursting off it
    setJet(from, to, on, dt) {
      jet.visible = !!(on && from && to);
      mist.visible = jet.visible;
      if (!jet.visible) return;
      jetDirection.subVectors(to, from);
      const len = jetDirection.length();
      jetMidpoint.copy(from).addScaledVector(jetDirection, 0.5);
      jetBeam.position.copy(jetMidpoint);
      jetBeam.scale.set(1, len, 1);
      jetBeam.quaternion.setFromUnitVectors(jetUp, jetNormalized.copy(jetDirection).normalize());
      const phase = performance.now() * 0.004;
      for (let i = 0; i < STREAM; i++) {
        const t = ((i / STREAM) + phase * (0.80 + (i % 3) * 0.07)) % 1;
        const spread = 0.006 + t * 0.022;
        const o = i * 3;
        streamPos[o] = from.x + jetDirection.x * t + Math.sin(i * 4.1 + phase) * spread;
        streamPos[o + 1] = from.y + jetDirection.y * t + Math.cos(i * 3.7 + phase) * spread;
        streamPos[o + 2] = from.z + jetDirection.z * t + Math.sin(i * 2.9 - phase) * spread;
      }
      streamGeo.attributes.position.needsUpdate = true;

      for (let i = 0; i < MIST; i++) {
        mistLife[i] -= dt;
        if (mistLife[i] <= 0) {
          mistLife[i] = 0.12 + Math.random() * 0.22;
          mistPos[i * 3] = to.x + (Math.random() - 0.5) * 0.22;
          mistPos[i * 3 + 1] = to.y + (Math.random() - 0.5) * 0.22;
          mistPos[i * 3 + 2] = to.z + (Math.random() - 0.5) * 0.22;
        } else {
          // spatter runs off the wall and falls
          mistPos[i * 3] += (Math.random() - 0.5) * 0.02;
          mistPos[i * 3 + 1] -= dt * 0.9;
          mistPos[i * 3 + 2] += (Math.random() - 0.5) * 0.02;
        }
      }
      mistGeo.attributes.position.needsUpdate = true;
    },

    // repainting a canvas is not free: batch it to ~15Hz while the trigger is down
    tick(dt) {
      if (!dirty.size && !wetSurfaces.size) return;
      repaintClock += Math.max(0, Number(dt) || 0);
      if (repaintClock < 0.066) return;
      const elapsed = repaintClock;
      repaintClock = 0;
      for (const id of [...wetSurfaces]) {
        const target = surfaces[id];
        if (!target) {
          wetSurfaces.delete(id);
          continue;
        }
        const faded = fadeWashWetness(target.wet, elapsed);
        if (faded.changed) dirty.add(id);
        if (faded.activeCells === 0) wetSurfaces.delete(id);
      }
      for (const id of dirty) if (surfaces[id]) surfaces[id].repaint();
      dirty = new Set();
    },

    wetnessDiagnostics() {
      let activeCells = 0;
      let total = 0;
      let max = 0;
      let cells = 0;
      for (const target of Object.values(surfaces)) {
        cells += target.wet.length;
        for (const level of target.wet) {
          if (!(level > 0)) continue;
          activeCells += 1;
          total += level;
          max = Math.max(max, level);
        }
      }
      return {
        activeCells,
        mean: activeCells ? total / activeCells : 0,
        coverage: cells ? activeCells / cells : 0,
        max,
        drying: wetSurfaces.size > 0,
      };
    },

    // called when a surface finishes, so the player is told
    announceIfDone(id) {
      const s = surfaceClean(state, id);
      if (s > 0.985 && hooks.toast) {
        const surf = WASH_SURFACES.find((x) => x.id === id);
        hooks.toast(`${surf.label} is clean.`);
        if (exteriorWashScore(state) > 0.985) {
          hooks.toast('The whole outside is washed down — the place looks cared for again.');
        }
        return true;
      }
      return false;
    },

    repaintAll() {
      for (const id of Object.keys(surfaces)) surfaces[id].repaint();
    },
  };
}
