// ASSETS 71-100, PUT WHERE THEY BELONG.
//
// Thirty finished, clean-reimport-verified props were sitting in vendor/ with nothing loading them:
// a folder of geometry that never reached the screen. That is the exact failure the brief names —
// "assets exist but are not integrated" — and it is what this file ends.
//
// These are static dressing, not the modular state-driven kit Sheet 6 needed, so they do not go
// through the production-runtime/assembly/adapter machinery. They need one thing: to be placed.
//
// PLACEMENT CONTRACT
// Every asset carries a `SOCKET_PLACEMENT` empty authored at the point that should land on the
// target — the base of a floor prop, the wall face of a bracket, the ceiling plate of a camera.
// So nothing here guesses at bounding boxes or origin offsets: we load the asset, find its
// placement socket, and translate the model so that socket sits exactly on the target point.
//
// Coordinates are INTERIOR-LOCAL YARDS, matching src/data/shopLayout.js:
//   x  -10.25 (west wall) .. +10.25 (east wall)
//   z   -6.5  (north wall) .. +6.5  (south wall, the porch entrance)
//   y   0 at the floor
// The assets themselves are authored in METRES, so they are scaled on the way in.

import * as THREE from 'three';
import { INTERIOR, DOOR_MAIN, DOOR_CLEARWAY, STOCKROOM, OFFICE, COUNTER, COUNTER_TOP } from '../../data/shopLayout.js';

const M_TO_YD = 1.0936133;

// Wall faces, inset by half the wall thickness so a mounted prop sits ON the plaster.
const S_WALL = INTERIOR.d / 2;   // +6.5, the entrance wall
const N_WALL = -INTERIOR.d / 2;  // -6.5
const E_WALL = INTERIOR.w / 2;   // +10.25
const W_WALL = -INTERIOR.w / 2;  // -10.25

// Facing angles. A prop on the south wall must look NORTH, into the room.
const FACE_N = Math.PI;          // mounted on the south wall
const FACE_S = 0;                // mounted on the north wall
const FACE_W = Math.PI / 2;      // mounted on the east wall
const FACE_E = -Math.PI / 2;     // mounted on the west wall

const DESK_TOP = 0.78;           // office desk working surface

/**
 * Where each prop goes.
 *
 * `mount` says WHAT it is fixed to — 'floor', 'surface' (a desk or counter top), 'wall' or
 * 'ceiling'. It is not decoration: the placement tests use it to decide which rules apply. A
 * clock bolted to a wall must never cross a window; a printer standing on a cabinet under one is
 * simply a printer under a window.
 *
 * `y` is the height of the PLACEMENT SOCKET above the floor: 0 for anything standing on it.
 * `ry` is the yaw. `note` records why a position is what it is, because most of these are
 * constrained by something invisible — a door swing, a window, a clearway.
 */
export const PROP_PLACEMENTS = [
  // --- Sheet 8: the stockroom cleaning bay -------------------------------------------------
  // STOCKROOM.cleaning is (6.1, 1.45) — the corner the layout already reserves for this kit.
  { n: 71, sheet: 'sheet_08', stem: 'asset_071_vacuum_cleaner', x: 6.30, z: 0.95, mount: 'floor', ry: -0.5,
    note: 'cleaning bay, hose end toward the room' },
  { n: 72, sheet: 'sheet_08', stem: 'asset_072_mop', x: 5.95, z: 1.78, mount: 'floor', ry: 0.35,
    note: 'stood against the partition beside the bucket' },
  { n: 73, sheet: 'sheet_08', stem: 'asset_073_mop_bucket_and_wringer', x: 6.28, z: 1.62, mount: 'floor', ry: -0.3,
    note: 'the bay the layout names' },
  { n: 74, sheet: 'sheet_08', stem: 'asset_074_broom', x: 6.62, z: 1.82, mount: 'floor', ry: -0.25,
    note: 'leant beside the mop' },
  { n: 75, sheet: 'sheet_08', stem: 'asset_075_dustpan', x: 6.92, z: 1.66, mount: 'floor', ry: 0.4,
    note: 'hung with the broom' },
  { n: 76, sheet: 'sheet_08', stem: 'asset_076_cleaning_spray_bottle', x: 7.18, z: 1.30, mount: 'floor', ry: 0.8,
    note: 'supplies, clear of the stock door swing at x 8.9' },
  { n: 77, sheet: 'sheet_08', stem: 'asset_077_cleaning_cloth_and_sponge_set', x: 7.44, z: 1.42, mount: 'floor', ry: -0.2,
    note: 'beside the spray' },
  { n: 78, sheet: 'sheet_08', stem: 'asset_078_pressure_washer', x: 9.15, z: -5.55, mount: 'floor', ry: 0.25,
    note: 'equipment storage by the receiving door, clear of BACKDOOR_CLEARWAY' },
  { n: 79, sheet: 'sheet_08', stem: 'asset_079_pressure_washer_hose_and_wand', x: 8.62, z: -5.62, mount: 'floor', ry: 0.6,
    note: 'coiled beside its machine' },
  { n: 80, sheet: 'sheet_08', stem: 'asset_080_trash_bag', x: 7.70, z: 1.20, mount: 'floor', ry: -0.15,
    note: 'the disposal end of the bay' },

  // --- Sheet 9: office and service desk ------------------------------------------------------
  { n: 81, sheet: 'sheet_09', stem: 'asset_081_office_chair_sheet09',
    x: OFFICE.chair.x, z: OFFICE.chair.z, mount: 'floor', ry: FACE_W,
    note: 'the layout\'s own chair spot, turned to face the desk' },
  { n: 82, sheet: 'sheet_09', stem: 'asset_082_filing_cabinet_sheet09', x: 9.92, z: 2.75, mount: 'floor', ry: FACE_W,
    note: 'east office wall, north of the window at z 4.6' },
  { n: 83, sheet: 'sheet_09', stem: 'asset_083_desk_lamp', x: 9.72, z: 5.18, y: DESK_TOP, mount: 'surface', ry: -1.1,
    note: 'on the desk, far corner from the chair' },
  { n: 84, sheet: 'sheet_09', stem: 'asset_084_office_printer', x: 9.88, z: 3.55, y: 0.72, mount: 'surface', ry: FACE_W,
    note: 'on the filing cabinet run beside the desk' },
  { n: 85, sheet: 'sheet_09', stem: 'asset_085_office_telephone', x: 9.70, z: 3.98, y: DESK_TOP, mount: 'surface', ry: -1.4,
    note: 'desk, within reach of the chair' },
  { n: 86, sheet: 'sheet_09', stem: 'asset_086_corkboard_noticeboard', x: 6.55, z: 2.12, y: 1.62, mount: 'wall', ry: FACE_S,
    note: 'partition B, the office north wall. The south wall is full: the framed course map '
      + 'sits at x 8.9 and the staff calendar at x 7.1 — a corkboard at 7.15 hung on that '
      + 'calendar, 6 cm apart. This face is clear, and clear of the stock door at x 8.9.' },
  { n: 87, sheet: 'sheet_09', stem: 'asset_087_wall_clock', x: E_WALL - 0.06, z: 3.05, y: 2.25, mount: 'wall', ry: FACE_W,
    note: 'office east wall. The south wall is taken: the framed course map at x 8.9 is ~2.4 wide, '
      + 'and a clock at 9.75 hung squarely on top of it. Here it is above the filing cabinet and '
      + 'south of the window at z 4.6.' },
  { n: 88, sheet: 'sheet_09', stem: 'asset_088_key_rack', x: E_WALL - 0.06, z: -1.35, y: 1.52, mount: 'wall', ry: FACE_W,
    note: 'stockroom east wall, clear of the receiving door at z -3.6' },
  { n: 89, sheet: 'sheet_09', stem: 'asset_089_reservation_clipboard',
    x: COUNTER.x + 1.05, z: COUNTER.z, y: COUNTER_TOP, mount: 'surface', ry: 0.25,
    note: 'front desk, staff side' },
  { n: 90, sheet: 'sheet_09', stem: 'asset_090_scorecard_holder',
    x: COUNTER.x - 1.05, z: COUNTER.z, y: COUNTER_TOP, mount: 'surface', ry: -0.15,
    note: 'front desk, customer end' },

  // --- Sheet 10: safety, signage and utilities -----------------------------------------------
  { n: 91, sheet: 'sheet_10', stem: 'asset_091_fire_extinguisher', x: 5.52, z: -0.85, y: 1.02, mount: 'wall', ry: FACE_E,
    note: 'partition A west face — code-visible from the shop floor' },
  { n: 92, sheet: 'sheet_10', stem: 'asset_092_first_aid_kit_cabinet', x: 9.15, z: N_WALL + 0.06, y: 1.42, mount: 'wall', ry: FACE_S,
    note: 'stockroom north wall at reachable height, moved east clear of the existing wall '
      + 'dressing it was sharing a foot of wall with' },
  { n: 93, sheet: 'sheet_10', stem: 'asset_093_security_camera', x: 1.25, z: 6.28, y: 2.92, mount: 'ceiling', ry: FACE_N,
    note: 'high above the entrance, covering the door and the counter' },
  { n: 94, sheet: 'sheet_10', stem: 'asset_094_exit_sign', x: DOOR_MAIN.x, z: S_WALL - 0.05, y: 2.96, mount: 'wall', ry: FACE_N,
    note: 'over the main door. Its placement socket sits 0.235 above the sign base, so y 2.86 put '
      + 'the base at 2.625 — under the 2.68 door head. 2.96 clears it and still fits the 3.2 ceiling.' },
  { n: 95, sheet: 'sheet_10', stem: 'asset_095_emergency_light', x: W_WALL + 0.06, z: -1.40, y: 2.78, mount: 'wall', ry: FACE_E,
    note: 'high west wall, covering the shop floor' },
  { n: 96, sheet: 'sheet_10', stem: 'asset_096_bulletin_board', x: -4.10, z: N_WALL + 0.06, y: 1.58, mount: 'wall', ry: FACE_S,
    note: 'public north wall, clear of the lounge window at x 3.0' },
  { n: 97, sheet: 'sheet_10', stem: 'asset_097_key_cabinet', x: E_WALL - 0.06, z: 0.70, y: 1.48, mount: 'wall', ry: FACE_W,
    note: 'secure service wall, above the key rack run' },
  { n: 98, sheet: 'sheet_10', stem: 'asset_098_hand_sanitizer_station', x: 0.98, z: S_WALL - 0.06, y: 1.22, mount: 'wall', ry: FACE_N,
    note: 'entrance wall at hand height, east of DOOR_CLEARWAY (maxX 0.5)' },
  { n: 99, sheet: 'sheet_10', stem: 'asset_099_umbrella_stand', x: 1.42, z: 5.72, mount: 'floor', ry: 0.3,
    note: 'entrance corner, outside the door swing and the clearway' },
  { n: 100, sheet: 'sheet_10', stem: 'asset_100_floor_mat_welcome_mat', x: DOOR_MAIN.x, z: 5.48, y: 0.004, mount: 'floor', ry: 0,
    note: 'square inside the threshold; flat, so it may sit in the clearway a solid prop could not' },
];

export const PLACED_ASSET_NUMBERS = Object.freeze(PROP_PLACEMENTS.map((p) => p.n));

/**
 * Stand-ins these authored assets replace.
 *
 * The clubhouse already builds crude versions of some of this: five primitives for a mop, bucket
 * and broom in the stockroom corner, and a canvas welcome mat on the threshold. Placing the
 * authored assets without removing them gives you two mops and two mats — the "duplicate assets"
 * failure, and a visible regression rather than an improvement.
 *
 * Each entry names an object in the interior and the assets whose arrival retires it. Nothing is
 * removed until its replacements are actually on screen, so a failed load leaves the stand-in
 * standing rather than emptying the corner.
 */
export const SUPERSEDES = [
  { legacy: 'LegacyCleaningCornerScenery', replacedBy: [71, 72, 73, 74, 75] },
  { legacy: 'LegacyWelcomeMat', replacedBy: [100] },
  { legacy: 'LegacyOfficeChair', replacedBy: [81] },
];

const runtimeUrl = (p) => `vendor/models/assets_51_100/${p.sheet}/${p.stem}.glb`;

/**
 * Load and place every prop.
 *
 * Failures are reported, never thrown: one missing prop must not take the clubhouse down with it.
 * @returns {{group: THREE.Group, ready: Promise, diagnostics: function, dispose: function}}
 */
export function buildProps({ interior, loader, visibilityForAsset = () => true }) {
  const group = new THREE.Group();
  group.name = 'Assets71to100Props';
  interior.add(group);

  const placed = [];
  const failed = [];
  const roots = new Map();

  const refreshVisibility = () => {
    for (const [number, root] of roots) root.visible = visibilityForAsset(number) !== false;
  };

  const jobs = PROP_PLACEMENTS.map((p) => new Promise((resolve) => {
    loader.load(runtimeUrl(p), (gltf) => {
      try {
        const root = gltf.scene;
        root.name = `Prop_${p.n}_${p.stem}`;
        root.scale.setScalar(M_TO_YD);
        root.rotation.y = p.ry || 0;
        root.updateMatrixWorld(true);

        // Land SOCKET_PLACEMENT on the target point. Without this every prop would be positioned
        // by its authoring origin, which sits mid-body on most of them — a fire extinguisher would
        // hang 0.44 m through the wall it is bracketed to.
        const socket = root.getObjectByName('SOCKET_PLACEMENT');
        const target = new THREE.Vector3(p.x, p.y || 0, p.z);
        if (socket) {
          socket.updateWorldMatrix(true, false);
          const at = new THREE.Vector3().setFromMatrixPosition(socket.matrixWorld);
          root.position.set(target.x - at.x, target.y - at.y, target.z - at.z);
        } else {
          root.position.copy(target);
          failed.push({ n: p.n, reason: 'no SOCKET_PLACEMENT; positioned by origin' });
        }

        root.traverse((o) => {
          if (!o.isMesh) return;
          // Small dressing does not earn a shadow map slot. The interior already excludes its
          // contents from the sun pass; this keeps these thirty consistent with that.
          o.castShadow = false;
          o.receiveShadow = false;
        });

        group.add(root);
        roots.set(p.n, root);
        root.visible = visibilityForAsset(p.n) !== false;
        placed.push({ n: p.n, name: root.name, at: [p.x, p.y || 0, p.z] });
        resolve(true);
      } catch (err) {
        failed.push({ n: p.n, reason: err.message });
        resolve(false);
      }
    }, undefined, (err) => {
      failed.push({ n: p.n, reason: err?.message || 'load failed' });
      resolve(false);
    });
  }));

  const superseded = [];
  const ready = Promise.all(jobs).then(() => {
    // Retire each stand-in, but only once everything replacing it is genuinely on screen.
    const placedNumbers = new Set(placed.map((p) => p.n));
    for (const rule of SUPERSEDES) {
      if (!rule.replacedBy.every((n) => placedNumbers.has(n))) continue;
      const legacy = interior.getObjectByName(rule.legacy);
      if (!legacy) continue;
      // UNPARENT ONLY — never dispose.
      //
      // These stand-ins are built from the clubhouse's SHARED material palette: the legacy mop and
      // broom use mats.rawWood and mats.kraft, which half the stockroom is also drawing with.
      // Disposing them here freed geometry and materials that were still in use, and then teardown
      // disposed them a second time — which is precisely what
      // tests/clubhouse-resource-lifecycle.test.js counts. Whoever created a resource owns
      // releasing it; superseding is a scene-graph decision, not an ownership transfer.
      legacy.removeFromParent();
      superseded.push(rule.legacy);
    }
    return { placed: placed.length, superseded: [...superseded] };
  });

  return {
    group,
    ready,
    refreshVisibility,
    getRoot: (number) => roots.get(number) || null,
    diagnostics: () => ({
      expected: PROP_PLACEMENTS.length,
      placed: placed.length,
      failed: failed.length,
      failures: failed,
      assetNumbers: placed.map((p) => p.n).sort((a, b) => a - b),
      superseded: [...superseded],
    }),
    dispose() {
      // Dispose each distinct resource ONCE. Two props can legitimately share a geometry or a
      // material — the cloth and sponge come out of one authored set, and a stubbed loader in the
      // tests hands every prop the same fixture — so disposing per-mesh releases the same buffer
      // thirty times. tests/clubhouse-resource-lifecycle.test.js counts exactly that.
      const geometries = new Set();
      const materials = new Set();
      group.traverse((o) => {
        if (!o.isMesh) return;
        if (o.geometry) geometries.add(o.geometry);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m) materials.add(m);
      });
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      group.removeFromParent();
      placed.length = 0;
      roots.clear();
    },
  };
}
