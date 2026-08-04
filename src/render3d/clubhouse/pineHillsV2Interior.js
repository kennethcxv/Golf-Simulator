// PINE HILLS V2 — the Phase 3 greybox interior (Designs/ProShop/Greybox/FLOOR_PLAN.md).
//
// This module is the v2 sibling of pineHillsInterior.js and satisfies the exact same
// consumed API (the dormant stub in clubhouse.js is the checklist). It builds NO GLBs,
// NO textures and NO lighting: every scheduled fixture stands as an untextured grey
// volume at its final dimensions (GREY_<id>), the legacy/authored furniture visuals
// are suppressed, and every functional system — register hardware, colliders, doors,
// cleaning tools, campaign anchors, customers, stock — keeps running on the shared
// builders, which already read the variant-resolved datums from shopLayout.js.
//
// What this module owns: grey stand-in visuals, the v2 cleanup-pose table, the
// restoration [E]/hold interactions, and the suppression of the furniture visuals the
// grey volumes replace. What it deliberately does not own: collision (the analytic
// colliders from fixtures.js/buildCheckout are the only navigation authority) and any
// transaction logic.

import * as THREE from 'three';

import {
  CEILING_PANEL_RIG,
  PINE_HILLS_V2_LAYOUT,
  COUNTER_TOP,
  FRONT_DESK_BACKDROP,
  FRONT_DESK_FRAME,
  LOUNGE,
  SHELL,
  fixtureRect,
  frontDeskPoint,
} from '../../data/shopLayout.js';
import { placedFixtures } from '../../sim/layout.js';
import { facilityInstalled } from '../../sim/campaign.js';
import {
  ARCHITECTURE_COMPONENT_LABELS,
  ARCHITECTURE_FINISH_LABELS,
  ARCHITECTURE_FINISH_OPTIONS,
  ARCHITECTURE_PAINT_COSTS,
  ARCHITECTURE_REPAIR_SKU,
  ceilingCircuitPowered,
  ceilingPanelPromptLabel,
  panelRepairKitAvailable,
  restorationAction,
  restorationSnapshot,
} from '../../sim/clubhouseRestoration.js';
import { availableSupplyUnits } from '../../sim/supplyUnits.js';
import {
  PINE_HILLS_CLEANUP_POSES,
  PINE_HILLS_CLEANUP_VISUAL_POSES,
  createPineHillsLeafLitter,
  createPineHillsOfficeDoorReveal,
  pineHillsInteractionWorldY,
  pineHillsRestorationObjectName,
} from './pineHillsInterior.js';
import { makeV2ArchitectureMaterials } from './materials.js';

// The resized room's ceiling (OVERNIGHT_REPORT.md §3, item 10): 2.80 yd = 2.56 m
// under the original 2.93 m shell, with exposed grey beams just below it.
const CEILING_Y = PINE_HILLS_V2_LAYOUT.ceilingY;
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

// The v1 pose table is authored against frontDeskPoint at module load, so the desk
// targets already follow the v2 frame. Two entries need v2-specific homes:
export const PINE_HILLS_V2_CLEANUP_POSES = Object.freeze({
  ...PINE_HILLS_CLEANUP_POSES,
  // The v1 east scuff's contact zone lands inside the v2 desk slab. The v2 scuff
  // lives on the partition's public face, in the clear band between tour_vault's
  // run and the panels repair site.
  'wall:scuff-east': Object.freeze({ x: 4.95, z: -0.05, radius: 1.05 }),
  // Just west of the return's end panel, 0.25 yd clear of the door clearway.
  'desk:overflow-bin': Object.freeze({ ...frontDeskPoint(-2.55, 1.30), radius: 1.35 }),
  // THE RESIZE re-homes every neglect beat the new walls orphaned. The v1 poses
  // for these sat against walls that are now sealed cavity; each moves to the
  // equivalent spot on the 70 m² envelope (lounge beats follow the switched
  // LOUNGE datums on their own).
  'entry:leaves-trash': Object.freeze({ x: -2.30, z: 4.95, radius: 1.05 }),
  'corner:cobweb-nw': Object.freeze({ x: -2.20, z: -4.15, radius: 1.15 }),
  'wall:scuff-west': Object.freeze({ x: -2.28, z: 4.20, radius: 1.05 }),
  'wall:fallen-frame': Object.freeze({ x: 4.60, z: -4.28, radius: 1.05 }),
});

export const PINE_HILLS_V2_CLEANUP_VISUAL_POSES = Object.freeze({
  ...PINE_HILLS_CLEANUP_VISUAL_POSES,
  'wall:scuff-east': Object.freeze({ x: 5.60, z: -0.05 }),
  // On the resized envelope's own surfaces: NW corner web, NE web pulled to the
  // new north wall, west scuff on the sliver of west wall the clearway leaves
  // visible beside the door.
  'corner:cobweb-nw': Object.freeze({ x: -2.48, z: -4.48 }),
  'corner:cobweb-ne': Object.freeze({ x: 2.05, z: -4.48 }),
  'wall:scuff-west': Object.freeze({ x: -2.53, z: 4.20 }),
});

// Greybox heights per fixture kind — FLOOR_PLAN.md §4, and the same table the layout
// test audits the F1 strip against.
const KIND_HEIGHT = {
  shelf: 2.2, pegboard: 2.2, apparelwall: 2.2, rack: 2.2,
  table: 1.0, feature: 1.0, rail: 1.45, hatstand: 1.75, bagstand: 1.25,
  shoerack: 2.0, fittingroom: 2.05, premiumcase: 1.9, fridge: 1.9,
  snackrack: 1.6, service: 1.1, demo: 0.4, backcounter: 1.0,
};

// The service wing keeps its production assets (fixed invariant, zero §4 findings);
// only the public retail floor is greyboxed.
const GREYBOX_ZONES_EXCLUDED = new Set(['stockroom', 'office']);

// Furniture visuals the grey volumes replace. The first is procedural and present at
// build; the GLB pair and the tier-2 lounge set mount asynchronously, so update()
// sweeps for them until all are retired.
const LEGACY_VISUAL_SUPPRESSIONS = [
  'LegacyCheckoutCounter',
  'PineHillsFrontDeskReturn',
  'LegacyCheckoutProductionCounter',
  'TieredMemberLounge',
  'lounge-trophies',
];

const STRUCTURAL_WORK_SITES = Object.freeze([
  { id: 'ceiling', x: 7.15, z: 3.55, aimY: 2.35 },
  { id: 'floor', x: -2.1, z: -0.8, aimY: 0.25 },
  { id: 'panels', x: 5.15, z: 0.75, aimY: 1.25 },
  { id: 'trim', x: -2.0, z: 5.72, aimY: 1.0 },
  // The resize seals the old north window behind the new wall; the office's
  // east window is the one glazed opening left to repair.
  { id: 'windows', x: 8.25, z: 4.25, aimY: 1.35 },
  { id: 'porch', x: 1.6, z: 7.55, aimY: 0.45 },
  { id: 'shell', x: -10.8, z: 0.1, aimY: 1.3 },
]);
const STRUCTURAL_REPAIR_HOLD_SECONDS = 3.2;

function setPatternVisible(root, pattern, visible) {
  root?.traverse((object) => {
    if (pattern.test(object.name || '')) object.visible = visible;
  });
}

export function createPineHillsV2Interior({
  interior,
  state,
  addProp,
  removeProp,
  L2W = (x, z) => ({ x, z }),
  getFixtureAnchor = () => null,
  getRuntimeAssetRoot = () => null,
  hooks = {},
  onRestoration = () => {},
  onStockSocketsReady = () => {},
} = {}) {
  if (!interior?.add) throw new TypeError('Pine Hills v2 interior requires an Object3D mount.');
  void getRuntimeAssetRoot; // v2 rotates its own grey chairB; the GLB chair is suppressed
  const group = new THREE.Group();
  group.name = 'PineHillsV2InteriorLayer';
  interior.add(group);

  const grey = new THREE.MeshStandardMaterial({ color: 0x8f8f8f, roughness: 0.92, metalness: 0 });
  const greyDark = new THREE.MeshStandardMaterial({ color: 0x6f6f6f, roughness: 0.95, metalness: 0 });
  const greyScuff = new THREE.MeshStandardMaterial({
    color: 0x3f3b36, transparent: true, opacity: 0.54, roughness: 1, side: THREE.DoubleSide, depthWrite: false,
  });
  const ownedGeometries = new Set();
  const ownedMaterials = new Set([grey, greyDark, greyScuff]);
  const box = (w, h, d) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    ownedGeometries.add(geometry);
    return geometry;
  };

  const interactionProps = [];
  const neglectRoots = new Map();
  // Static volumes (desk, boards, lounge) live for the module's lifetime; fixture
  // volumes are re-cut on every layout relay. Two maps so the rebuild cannot wipe
  // the statics out of getRoot()/diagnostics().
  const greyStaticRoots = new Map();
  const greyFixtureRoots = new Map();
  const greyRootFor = (key) => greyStaticRoots.get(key) || greyFixtureRoots.get(key) || null;
  const suppressedLegacy = new Set();
  const hiddenAnchorIds = new Set();
  let disposed = false;
  let sweepCountdown = 0;
  let sweepDeadline = 60;

  // --- suppression: the furniture the grey volumes replace --------------------------
  function hideRetailFixtureAnchors() {
    for (const fixture of placedFixtures(state)) {
      if (GREYBOX_ZONES_EXCLUDED.has(fixture.zone)) continue;
      const anchor = getFixtureAnchor(fixture.id);
      if (anchor && anchor.visible) {
        anchor.visible = false;
        hiddenAnchorIds.add(fixture.id);
      }
    }
  }

  function sweepLegacyVisuals() {
    for (const name of LEGACY_VISUAL_SUPPRESSIONS) {
      if (suppressedLegacy.has(name)) continue;
      const root = interior.getObjectByName(name);
      if (root) {
        root.visible = false;
        suppressedLegacy.add(name);
      }
    }
    return suppressedLegacy.size === LEGACY_VISUAL_SUPPRESSIONS.length;
  }

  // --- grey volumes -----------------------------------------------------------------
  const greyFixturesRoot = new THREE.Group();
  greyFixturesRoot.name = 'GreyboxFixtureVolumes';
  group.add(greyFixturesRoot);

  function addGrey(name, mesh) {
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    greyFixtureRoots.set(name, mesh);
    greyFixturesRoot.add(mesh);
    return mesh;
  }

  function greyBoxFor(fixture) {
    const rect = fixtureRect(fixture);
    const width = rect.maxX - rect.minX;
    const depth = rect.maxZ - rect.minZ;
    const height = KIND_HEIGHT[fixture.kind] ?? 1.0;
    if (fixture.kind === 'fittingroom') {
      // Hollow booth matching the collision proxies: rear + two side walls, open
      // front, low bench. Local +z is the curtain face; the group carries the ry.
      const booth = new THREE.Group();
      const wallH = height;
      const rear = new THREE.Mesh(box(2.2, wallH, 0.12), grey);
      rear.position.set(0, wallH / 2, -0.72);
      const left = new THREE.Mesh(box(0.12, wallH, 1.56), grey);
      left.position.set(-1.02, wallH / 2, 0);
      const right = new THREE.Mesh(box(0.12, wallH, 1.56), grey);
      right.position.set(1.02, wallH / 2, 0);
      const bench = new THREE.Mesh(box(0.42, 0.45, 0.92), greyDark);
      bench.position.set(-0.47, 0.225, 0);
      booth.add(rear, left, right, bench);
      booth.position.set(fixture.x, 0, fixture.z);
      booth.rotation.y = fixture.ry || 0;
      return booth;
    }
    if (fixture.kind === 'demo') {
      // Putting strip: flat green-height slab plus the west return wall — the strip
      // itself stays walkable, matching the analytic collision proxy.
      const demo = new THREE.Group();
      const strip = new THREE.Mesh(box(4.0, 0.15, 1.24), greyDark);
      strip.position.y = 0.075;
      const wall = new THREE.Mesh(box(0.18, 0.4, 1.12), grey);
      wall.position.set(-1.87, 0.2, 0);
      demo.add(strip, wall);
      demo.position.set(fixture.x, 0, fixture.z);
      demo.rotation.y = fixture.ry || 0;
      return demo;
    }
    const mesh = new THREE.Mesh(box(width, height, depth), grey);
    mesh.position.set((rect.minX + rect.maxX) / 2, height / 2, (rect.minZ + rect.maxZ) / 2);
    return mesh;
  }

  function rebuildGreyFixtures() {
    for (const child of [...greyFixturesRoot.children]) {
      child.removeFromParent();
    }
    greyFixtureRoots.clear();
    for (const fixture of placedFixtures(state)) {
      if (GREYBOX_ZONES_EXCLUDED.has(fixture.zone)) continue;
      addGrey(`GREY_${fixture.id}`, greyBoxFor(fixture));
    }
  }

  // Desk shell: slab + return + the corridor end panel that seals the west slot
  // (the 0.52-yd gap is already narrower than a capsule; the panel makes it read).
  const deskRoot = new THREE.Group();
  deskRoot.name = 'GreyboxFrontDesk';
  group.add(deskRoot);
  {
    const frontHalf = FRONT_DESK_FRAME.frontLength / 2;
    const depthHalf = FRONT_DESK_FRAME.frontDepth / 2;
    const slab = new THREE.Mesh(
      box(FRONT_DESK_FRAME.frontLength, COUNTER_TOP, FRONT_DESK_FRAME.frontDepth), grey,
    );
    slab.name = 'GREY_frontCounter';
    const slabCentre = frontDeskPoint(0, 0);
    slab.position.set(slabCentre.x, COUNTER_TOP / 2, slabCentre.z);
    slab.rotation.y = FRONT_DESK_FRAME.ry;
    slab.receiveShadow = true;
    deskRoot.add(slab);

    greyStaticRoots.set(slab.name, slab);
    // C5: no return leg under pine-hills-v2 — this slab was the west wall of the
    // pocket that made the till unreachable. A non-positive span means the desk
    // is an I and its near end is the staff pass-through.
    const returnSpan = FRONT_DESK_FRAME.returnStaffExtent - depthHalf;
    if (returnSpan > 0.01) {
      const returnCentre = frontDeskPoint(
        -frontHalf + FRONT_DESK_FRAME.returnCollisionWidth / 2,
        depthHalf + returnSpan / 2,
      );
      const returnRun = new THREE.Mesh(
        box(FRONT_DESK_FRAME.returnCollisionWidth, COUNTER_TOP, returnSpan), grey,
      );
      returnRun.name = 'GREY_frontCounterReturn';
      returnRun.position.set(returnCentre.x, COUNTER_TOP / 2, returnCentre.z);
      returnRun.rotation.y = FRONT_DESK_FRAME.ry;
      deskRoot.add(returnRun);
      greyStaticRoots.set(returnRun.name, returnRun);
    }
  }

  // Wall boards: grey panels on the real wall plane at the frame-local x positions.
  // The v1 +0.20 world-Z board compensation is ry-PI-specific and is NOT applied.
  const boardsRoot = new THREE.Group();
  boardsRoot.name = 'GreyboxWallBoards';
  group.add(boardsRoot);
  const boardPanel = (name, localX, width, height, y) => {
    const pose = frontDeskPoint(localX, FRONT_DESK_BACKDROP.surfaceLocalZ);
    const panel = new THREE.Mesh(box(width, height, 0.05), greyDark);
    panel.name = name;
    panel.position.set(pose.x, y, pose.z);
    panel.rotation.y = FRONT_DESK_FRAME.ry + Math.PI;
    boardsRoot.add(panel);
    greyStaticRoots.set(name, panel);
    return { panel, pose };
  };
  boardPanel('GREY_keyRack', -1.93, 0.82, 0.50, 1.52);
  const teeBoard = boardPanel('GREY_teeTimeBoard', -0.75, 1.38, 0.96, 1.61);
  boardPanel('GREY_logoBackdrop', 0.95, 1.20, 0.90, 1.60);

  // Lounge suite: always-visible grey furniture at the LOUNGE datums — the day-one
  // dirty read the plan's F5 protects. chairB is the entrance-visible hero.
  const loungeRoot = new THREE.Group();
  loungeRoot.name = 'GreyboxLounge';
  group.add(loungeRoot);
  const greyChair = (name, pose) => {
    const chair = new THREE.Group();
    chair.name = name;
    const seat = new THREE.Mesh(box(0.85, 0.45, 0.85), grey);
    seat.name = `${name}_seat`;
    seat.position.y = 0.225;
    const back = new THREE.Mesh(box(0.85, 0.50, 0.18), grey);
    back.name = `${name}_back`;
    back.position.set(0, 0.70, -0.335);
    chair.add(seat, back);
    chair.position.set(pose.x, 0, pose.z);
    chair.rotation.y = pose.ry || 0;
    loungeRoot.add(chair);
    greyStaticRoots.set(name, chair);
    return chair;
  };
  // --- the resized envelope: new west/north walls, dropped ceiling, beams ----------
  // Phase 4: the architecture wears its real materials (ART_BIBLE §7/§8) while
  // every FIXTURE volume stays grey — that is Phase 5's line. The two wall
  // COLLIDERS are builder-owned — clubhouse.js registers them at these same
  // datums; everything here is visual. Mesh/group NAMES are unchanged (the
  // greybox acceptance pins presence by name).
  const archMaterials = makeV2ArchitectureMaterials();
  {
    const envelope = PINE_HILLS_V2_LAYOUT.publicBounds;
    const wallT = PINE_HILLS_V2_LAYOUT.wallT;
    const archRoot = new THREE.Group();
    archRoot.name = 'GreyboxResizeArchitecture';
    group.add(archRoot);
    // §8 wall language: sage panelling below the chair rail, warm cream above,
    // walnut rail and skirting proud of the face. RAIL_TOP = 1.0 is the v1
    // wainscot's own RAIL_Y, so the new walls and the v1 south wall carry one
    // construction line around the room. Bands are real geometry — GTAO only
    // grounds a crevice that exists (§2.1). uv1 mirrors uv on every band so
    // the Phase 5 dirt mask (aoMap, channel 1) lands without material rework.
    const RAIL_TOP = 1.0;
    const RAIL_H = 0.08;
    const SKIRT_H = 0.12;
    const withUv1 = (mesh) => {
      mesh.geometry.setAttribute('uv1', mesh.geometry.attributes.uv);
      return mesh;
    };
    const bandedWall = (name, { runLength, thickness, centerX, centerZ, axis }) => {
      const wall = new THREE.Group();
      wall.name = name;
      const sizes = (h, extra) => (axis === 'x'
        ? [thickness + extra, h, runLength]
        : [runLength, h, thickness + extra]);
      // Every band is named: a texel or material probe that reports
      // "(unnamed)" cannot tell the reader which surface it measured, and
      // §7.3's gate is explicitly "read the hit field".
      const piece = (suffix, material, h, yCenter, extra = 0) => {
        const mesh = withUv1(new THREE.Mesh(box(...sizes(h, extra)), material));
        mesh.name = `${name}_${suffix}`;
        mesh.position.set(0, yCenter, 0);
        mesh.receiveShadow = true;
        wall.add(mesh);
        return mesh;
      };
      // §7.3 classes: the panelling below the rail is reached at standing
      // distance; the field above it is background; rail and skirting are
      // trim at arm's length and take the hero requirement.
      piece('SageBand', archMaterials.surface('sage', runLength, RAIL_TOP, { cls: 'standing' }), RAIL_TOP, RAIL_TOP / 2);
      piece(
        'CreamField',
        archMaterials.surface('cream', runLength, CEILING_Y - RAIL_TOP, { cls: 'background' }),
        CEILING_Y - RAIL_TOP, RAIL_TOP + (CEILING_Y - RAIL_TOP) / 2,
      );
      piece('ChairRail', archMaterials.surface('walnut', runLength, RAIL_H, { cls: 'hero' }), RAIL_H, RAIL_TOP + RAIL_H / 2, 0.04);
      piece('Skirting', archMaterials.surface('walnut', runLength, SKIRT_H, { cls: 'hero' }), SKIRT_H, SKIRT_H / 2, 0.03);
      wall.position.set(centerX, 0, centerZ);
      return wall;
    };
    const westWall = bandedWall('GREY_WestWall', {
      runLength: envelope.maxZ - (envelope.minZ - wallT),
      thickness: wallT,
      centerX: envelope.minX - wallT / 2,
      centerZ: (envelope.minZ - wallT + envelope.maxZ) / 2,
      axis: 'x',
    });
    const northWall = bandedWall('GREY_NorthWall', {
      runLength: envelope.maxX - (envelope.minX - wallT),
      thickness: wallT,
      centerX: (envelope.minX - wallT + envelope.maxX) / 2,
      centerZ: envelope.minZ - wallT / 2,
      axis: 'z',
    });
    // One cream lid over the public envelope, and the four exposed dark-walnut
    // beams (§8: beam faces) that make 2.56 m read as pressure instead of
    // paint. The faint emissive is the kit ceiling's faked-bounce idiom,
    // restrained — the dark start still reads dark.
    const ceilingLid = withUv1(new THREE.Mesh(
      box(envelope.maxX - envelope.minX, 0.06, envelope.maxZ - envelope.minZ),
      archMaterials.surface(
        'ceilingPaint',
        envelope.maxX - envelope.minX,
        envelope.maxZ - envelope.minZ,
        { cls: 'outofreach', emissive: 0xfff2dc, emissiveIntensity: 0.06 },
      ),
    ));
    ceilingLid.name = 'GREY_Ceiling';
    ceilingLid.position.set(
      (envelope.minX + envelope.maxX) / 2, CEILING_Y + 0.03, (envelope.minZ + envelope.maxZ) / 2,
    );
    ceilingLid.receiveShadow = true;
    archRoot.add(westWall, northWall, ceilingLid);
    const beams = PINE_HILLS_V2_LAYOUT.beams;
    // The beam presents an 8.30 × 0.22 face; the requirement-solved repeat is
    // what keeps that thin face off 1,400 texels/yd (see materials.js).
    const beamMaterial = archMaterials.surface(
      'walnutDark', envelope.maxX - envelope.minX, beams.width, { cls: 'outofreach' },
    );
    beams.zStations.forEach((zStation, index) => {
      const beam = new THREE.Mesh(
        box(envelope.maxX - envelope.minX, beams.depth, beams.width), beamMaterial,
      );
      beam.name = `GREY_CeilingBeam_${index + 1}`;
      beam.position.set((envelope.minX + envelope.maxX) / 2, CEILING_Y - beams.depth / 2, zStation);
      beam.receiveShadow = true;
      archRoot.add(beam);
      greyStaticRoots.set(beam.name, beam);
    });
    greyStaticRoots.set('GREY_WestWall', westWall);
    greyStaticRoots.set('GREY_NorthWall', northWall);
    greyStaticRoots.set('GREY_Ceiling', ceilingLid);
    // The corridor seal: partition line continued to the desk, as §6 draws it —
    // banded like the walls it joins.
    const seal = PINE_HILLS_V2_LAYOUT.corridorSeal;
    const sealWall = bandedWall('GREY_CorridorSeal', {
      runLength: seal.zTo - seal.zFrom,
      thickness: seal.t,
      centerX: seal.x,
      centerZ: (seal.zFrom + seal.zTo) / 2,
      axis: 'x',
    });
    archRoot.add(sealWall);
    greyStaticRoots.set('GREY_CorridorSeal', sealWall);
    // The west seal: cabinet-height fillets closing the Z-channel behind the
    // return (see the layout's corridorWestSeal note). Cabinetry: medium
    // walnut, grain up the panel.
    // Driven off the layout's own key set rather than a hand-listed three, so
    // deleting a fillet (C5 removed returnBackFill to open the staff pass-
    // through) takes its geometry with it instead of throwing on a missing rect.
    const westSeal = PINE_HILLS_V2_LAYOUT.corridorWestSeal;
    const fillName = (key) => `GREY_${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    for (const [name, rect] of Object.entries(westSeal).map(([k, v]) => [fillName(k), v])) {
      // Size the repeat to the LARGEST face the piece presents, not to its x
      // extent: the hutch-east sliver is 0.20 wide by 0.60 deep and the
      // corridor sees its depth face, so keying off the width under-supplied
      // that face by 3x (measured 443 texels/yd — exactly sqrt(256 x 768),
      // the geometric mean of a mismatched axis pair).
      const fillW = rect.maxX - rect.minX;
      const fillD = rect.maxZ - rect.minZ;
      const fill = withUv1(new THREE.Mesh(
        box(fillW, 2.20, fillD),
        archMaterials.surface('walnut', Math.max(fillW, fillD), 2.20, { cls: 'hero' }),
      ));
      fill.name = name;
      fill.position.set(
        (rect.minX + rect.maxX) / 2, 1.10, (rect.minZ + rect.maxZ) / 2,
      );
      fill.receiveShadow = true;
      archRoot.add(fill);
      greyStaticRoots.set(name, fill);
    }
  }

  greyChair('GREY_chairA', LOUNGE.chairA);
  const greyChairB = greyChair('GREY_chairB', LOUNGE.chairB);
  const coffee = new THREE.Mesh(box(0.95, 0.48, 0.60), grey);
  coffee.name = 'GREY_coffee';
  coffee.position.set(LOUNGE.coffee.x, 0.24, LOUNGE.coffee.z);
  loungeRoot.add(coffee);
  greyStaticRoots.set(coffee.name, coffee);
  const rug = new THREE.Mesh(box(2.2, 0.02, 1.6), greyDark);
  rug.name = 'GREY_loungeRug';
  rug.position.set(LOUNGE.rug.x, 0.011, LOUNGE.rug.z);
  loungeRoot.add(rug);
  greyStaticRoots.set(rug.name, rug);
  for (const [name, pose, w, h, d, y] of [
    ['GREY_trophy', LOUNGE.trophy, 0.90, 1.90, 0.35, 0.95],
    ['GREY_events', LOUNGE.events, 0.90, 0.70, 0.06, 1.50],
    ['GREY_photo', LOUNGE.photo, 0.70, 0.50, 0.05, 1.60],
  ]) {
    const piece = new THREE.Mesh(box(w, h, d), greyDark);
    piece.name = name;
    piece.position.set(pose.x, y, pose.z);
    piece.rotation.y = pose.ry || 0;
    loungeRoot.add(piece);
    greyStaticRoots.set(name, piece);
  }

  const officeDoorReveal = createPineHillsOfficeDoorReveal(group, state);

  // --- neglect visuals (grey stand-ins, RestorationTarget_* names) -------------------
  function addNeglect(targetId, root) {
    root.name = pineHillsRestorationObjectName(targetId);
    group.add(root);
    neglectRoots.set(targetId, root);
    return root;
  }
  {
    const entryPose = PINE_HILLS_V2_CLEANUP_POSES['entry:leaves-trash'];
    const entry = new THREE.Group();
    entry.position.set(entryPose.x, 0.018, entryPose.z);
    entry.add(createPineHillsLeafLitter(greyDark));
    const wrapper = new THREE.Mesh(box(0.22, 0.025, 0.13), grey);
    wrapper.position.set(0.31, 0.025, -0.18);
    wrapper.rotation.y = 0.38;
    entry.add(wrapper);
    addNeglect('entry:leaves-trash', entry);
  }
  const cobweb = (targetId) => {
    const pose = PINE_HILLS_V2_CLEANUP_VISUAL_POSES[targetId];
    const vertices = [];
    const radius = 0.56;
    for (let spoke = 0; spoke < 7; spoke += 1) {
      const angle = (spoke / 12) * Math.PI * 2;
      vertices.push(0, 0, 0, Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    }
    for (const ring of [0.22, 0.39, 0.55]) {
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const a = (spoke / 12) * Math.PI * 2;
        const b = ((spoke + 1) / 12) * Math.PI * 2;
        vertices.push(Math.cos(a) * ring, Math.sin(a) * ring, 0, Math.cos(b) * ring, Math.sin(b) * ring, 0);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    ownedGeometries.add(geometry);
    const web = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xd8d2c5, transparent: true, opacity: 0.62 }),
    );
    web.position.set(pose.x, 2.78, pose.z);
    addNeglect(targetId, web);
  };
  cobweb('corner:cobweb-nw');
  cobweb('corner:cobweb-ne');
  const scuff = (targetId, rotationY) => {
    const pose = PINE_HILLS_V2_CLEANUP_VISUAL_POSES[targetId];
    const material = greyScuff.clone(); // per-mark: refresh() drives opacity per target
    ownedMaterials.add(material);
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.38), material);
    ownedGeometries.add(mark.geometry);
    mark.position.set(pose.x, 1.05, pose.z);
    mark.rotation.y = rotationY;
    addNeglect(targetId, mark);
  };
  scuff('wall:scuff-west', Math.PI / 2);
  scuff('wall:scuff-east', -Math.PI / 2);
  {
    const litter = new THREE.Group();
    litter.position.set(LOUNGE.coffee.x, 0.48, LOUNGE.coffee.z);
    const pizza = new THREE.Mesh(box(0.38, 0.045, 0.38), greyDark);
    pizza.name = 'GREY_PizzaBox';
    pizza.position.set(-0.12, 0.023, 0.02);
    pizza.rotation.y = 0.24;
    const napkin = new THREE.Mesh(box(0.12, 0.008, 0.10), grey);
    napkin.name = 'GREY_LoungeNapkin';
    napkin.position.set(0.16, 0.004, -0.14);
    litter.add(pizza, napkin);
    for (const [index, offset] of [[1, 0.24], [2, 0.34]]) {
      const cupGeometry = new THREE.CylinderGeometry(0.045, 0.038, 0.13, 10);
      ownedGeometries.add(cupGeometry);
      const cup = new THREE.Mesh(cupGeometry, grey);
      cup.name = `GREY_EmptyCup_${index}`;
      cup.position.set(offset, 0.065, 0.12);
      litter.add(cup);
    }
    litter.name = 'GreyboxLoungeLitter';
    group.add(litter);
    neglectRoots.set('lounge:litter-visual', litter);
  }
  const fallenFramePose = PINE_HILLS_V2_CLEANUP_POSES['wall:fallen-frame'];
  const fallenFrame = new THREE.Mesh(box(0.62, 0.46, 0.03), greyDark);
  fallenFrame.name = 'GreyboxFallenFrame';
  fallenFrame.position.set(fallenFramePose.x, 0.24, fallenFramePose.z);
  fallenFrame.rotation.set(-0.35, -0.26, 0.05);
  group.add(fallenFrame);
  const paperPose = PINE_HILLS_V2_CLEANUP_POSES['desk:paper-stack'];
  const paperStack = new THREE.Mesh(box(0.30, 0.12, 0.22), grey);
  paperStack.name = 'GREY_PaperStack';
  paperStack.position.set(paperPose.x, COUNTER_TOP + 0.06, paperPose.z);
  paperStack.rotation.y = 0.18;
  group.add(paperStack);
  const notesPose = frontDeskPoint(-1.36, 0.30);
  const stickyNotes = new THREE.Mesh(box(0.16, 0.006, 0.16), greyDark);
  stickyNotes.name = 'GREY_DeskPhoneNote';
  stickyNotes.position.set(notesPose.x, COUNTER_TOP + 0.004, notesPose.z);
  group.add(stickyNotes);
  const binPose = PINE_HILLS_V2_CLEANUP_POSES['desk:overflow-bin'];
  const binGeometry = new THREE.CylinderGeometry(0.22, 0.19, 0.52, 12);
  ownedGeometries.add(binGeometry);
  const overflowBin = new THREE.Mesh(binGeometry, greyDark);
  overflowBin.name = 'GreyboxOverflowBin';
  overflowBin.position.set(binPose.x, 0.26, binPose.z);
  group.add(overflowBin);

  // --- interactions ------------------------------------------------------------------
  const addInteraction = ({
    x, z, r = 1.2, label, action, hold = null, aimY = 1.0, focusBias = 0,
  }) => {
    const world = L2W(x, z);
    const prop = {
      x: world.x,
      z: world.z,
      r,
      label,
      action,
      aimY: pineHillsInteractionWorldY(interior, aimY),
      focusBias,
    };
    if (hold) prop.hold = hold;
    addProp?.(prop);
    interactionProps.push(prop);
    return prop;
  };

  const completeTarget = (targetId) => {
    const result = restorationAction(state, { type: 'set-target-progress', targetId, progress: 1 });
    if (result.changed) {
      refresh();
      onRestoration(result);
    }
    return result;
  };

  for (const [targetId, verb] of [
    ['lounge:chair-crooked', 'straighten chair'],
    ['wall:fallen-frame', 'rehang frame'],
    ['desk:paper-stack', 'organize papers'],
    ['desk:sticky-notes', 'clear sticky notes'],
  ]) {
    const pose = PINE_HILLS_V2_CLEANUP_POSES[targetId];
    addInteraction({
      ...pose,
      r: pose.radius,
      label: () => restorationSnapshot(state)?.targetProgress[targetId] < 1
        ? `${verb[0].toUpperCase()}${verb.slice(1)} — [E]`
        : null,
      action: () => completeTarget(targetId),
    });
  }

  // The repairable panels, at the v2 rig's own stations. `simId` is the
  // sim/save key — the only two repair targets that exist are
  // ceiling:panel-02 (flicker) and ceiling:panel-07 (dead), and in v2 the
  // flicker panel renders at the old panel-03 station (shopLayout's
  // CEILING_PANEL_RIG). The previous code here targeted ceiling:panel-03,
  // which matches NO sim target (LIGHT_TARGET_TO_PANEL), so the flicker beat
  // was unrepairable in this room.
  // The sim's two faults, as the SIM names them. These are only true of what is
  // on screen once the circuit is live: applyPracticalLevels drives every
  // fitting to zero intensity while the ceiling circuit is dead, and
  // updateFlicker returns before it animates anything. So at campaign start
  // both panels are simply dark, and calling one of them "Flickering" describes
  // a state the player has never seen. Whatever the save file calls it, the
  // prompt names what is overhead.
  const PANEL_FAULT_LABELS = {
    'panel-02': 'Flickering ceiling panel',
    'panel-07': 'Dead ceiling panel',
  };
  const PANEL_UNPOWERED_LABEL = 'Dark ceiling panel';
  for (const panel of CEILING_PANEL_RIG.panels.filter(({ simId }) => PANEL_FAULT_LABELS[simId])) {
    const targetId = `ceiling:${panel.simId}`;
    addInteraction({
      x: panel.x,
      z: panel.z,
      r: 1.45,
      aimY: CEILING_Y - 0.08,
      // The prompt never offers [E] unless pressing it would actually change
      // the room. Two gates stand in front of this repair — the ceiling circuit
      // and a kit — and the player can only see the fitting, so the prompt has
      // to name whichever one is shut.
      label: () => ceilingPanelPromptLabel({
        faultName: PANEL_FAULT_LABELS[panel.simId],
        unpoweredName: PANEL_UNPOWERED_LABEL,
        powered: ceilingCircuitPowered(state),
        kitAvailable: panelRepairKitAvailable(state),
        repaired: restorationSnapshot(state)?.targetProgress[targetId] >= 1,
      }),
      action: () => {
        if (!ceilingCircuitPowered(state)) {
          hooks.toast?.('The ceiling circuit is dead. Repair the office power and ceiling first.', 'warn');
          return;
        }
        if (!panelRepairKitAvailable(state)) {
          hooks.toast?.('Bring the inherited clubhouse repair kit to service this panel.', 'warn');
          return;
        }
        const result = restorationAction(state, { type: 'repair-light', targetId });
        if (result.changed) {
          refresh();
          onRestoration(result);
        } else if (!result.ok && result.reason) {
          hooks.toast?.(result.reason, 'warn');
        }
      },
    });
  }

  for (const site of STRUCTURAL_WORK_SITES) {
    const siteLabel = ARCHITECTURE_COMPONENT_LABELS[site.id];
    const componentOf = () => (
      restorationSnapshot(state)?.architecture?.components?.[site.id] || null
    );
    const nextFinishOf = (component) => {
      const options = ARCHITECTURE_FINISH_OPTIONS[site.id];
      return options[(options.indexOf(component.finish) + 1) % options.length];
    };
    addInteraction({
      x: site.x,
      z: site.z,
      r: 1.6,
      aimY: site.aimY,
      focusBias: 0.35,
      label: () => {
        const component = componentOf();
        if (!component) return null;
        if (state.campaign?.enabled && !component.restored) return null;
        if (!component.restored) {
          const units = availableSupplyUnits(state, ARCHITECTURE_REPAIR_SKU);
          const progress = restorationSnapshot(state)?.componentRepairProgress?.[site.id] || 0;
          const percent = progress > 0 ? ` (${Math.round(progress * 100)}%)` : '';
          return units > 0
            ? `${siteLabel} — hold [E] to repair${percent} · ${units} repair components ready`
            : `${siteLabel} — bring repair components to fix${percent}`;
        }
        const next = nextFinishOf(component);
        const nextLabel = ARCHITECTURE_FINISH_LABELS[next] || next;
        return `${siteLabel} — [E] refinish: ${nextLabel} ($${ARCHITECTURE_PAINT_COSTS[site.id]})`;
      },
      hold: (dt) => {
        if (state.campaign?.enabled) return;
        const component = componentOf();
        if (!component || component.restored) return;
        if (availableSupplyUnits(state, ARCHITECTURE_REPAIR_SKU) <= 0) return;
        const current = restorationSnapshot(state)?.componentRepairProgress?.[site.id] || 0;
        const progress = Math.min(1, current + dt / STRUCTURAL_REPAIR_HOLD_SECONDS);
        const result = restorationAction(state, {
          type: 'repair-component', component: site.id, progress,
        });
        if (result.changed && result.restored) {
          refresh();
          onRestoration(result);
        } else if (result.changed && current === 0) {
          onRestoration(result);
        } else if (!result.ok && result.reason) {
          hooks.toast?.(result.reason, 'warn');
        }
      },
      action: () => {
        const component = componentOf();
        if (!component || !component.restored) return;
        const result = restorationAction(state, {
          type: 'paint-component', component: site.id, finish: nextFinishOf(component),
        });
        if (result.changed) {
          onRestoration(result);
        } else if (!result.ok && result.reason) {
          hooks.toast?.(result.reason, 'warn');
        }
      },
    });
  }

  addInteraction({
    x: teeBoard.pose.x,
    z: teeBoard.pose.z,
    r: 1.55,
    aimY: 1.64,
    focusBias: 2.25,
    label: () => 'Today\'s tee-time board — [E] open reservations',
    action: () => hooks.openLaptop?.('reservations'),
  });

  // --- state sync --------------------------------------------------------------------
  function refresh() {
    const snapshot = restorationSnapshot(state);
    if (!snapshot) return null;
    for (const [targetId, root] of neglectRoots) {
      if (targetId === 'lounge:litter-visual') continue;
      const progress = clamp01(snapshot.targetProgress[targetId]);
      root.visible = progress < 1;
      if (targetId === 'entry:leaves-trash') root.scale.setScalar(1 - progress * 0.38);
      if (root.material?.opacity != null) root.material.opacity = Math.max(0, 0.62 * (1 - progress));
    }
    const litter = neglectRoots.get('lounge:litter-visual');
    setPatternVisible(litter, /GREY_PizzaBox|GREY_LoungeNapkin/, snapshot.targetProgress['lounge:pizza-box'] < 1);
    setPatternVisible(litter, /GREY_EmptyCup/, snapshot.targetProgress['lounge:empty-cups'] < 1);
    paperStack.visible = snapshot.targetProgress['desk:paper-stack'] < 1;
    stickyNotes.visible = snapshot.targetProgress['desk:sticky-notes'] < 1;
    overflowBin.visible = snapshot.targetProgress['desk:overflow-bin'] < 1;
    const frameRepaired = snapshot.targetProgress['wall:fallen-frame'] >= 1;
    if (frameRepaired) {
      fallenFrame.position.set(3.60, 1.62, -4.54);
      fallenFrame.rotation.set(0, 0, 0);
    } else {
      fallenFrame.position.set(fallenFramePose.x, 0.24, fallenFramePose.z);
      fallenFrame.rotation.set(-0.35, -0.26, 0.05);
    }
    greyChairB.rotation.y = snapshot.targetProgress['lounge:chair-crooked'] >= 1
      ? -2.38
      : (LOUNGE.chairB.ry ?? -2.10);
    // The grey desk respects the campaign's frontCounter facility exactly as the
    // production shell does.
    deskRoot.visible = facilityInstalled(state, 'frontCounter');
    boardsRoot.visible = deskRoot.visible;
    officeDoorReveal.refresh();
    return snapshot;
  }

  function progressTarget(targetId, progress) {
    const result = restorationAction(state, { type: 'set-target-progress', targetId, progress: clamp01(progress) });
    if (result.changed) {
      refresh();
      onRestoration(result);
    }
    return result;
  }

  function applyCleaningTool(toolId, localX, localZ, dt, options = {}) {
    const snapshot = restorationSnapshot(state);
    if (!snapshot) return { handled: false, did: 0 };
    const candidates = [
      'entry:leaves-trash',
      'corner:cobweb-nw', 'corner:cobweb-ne',
      'wall:scuff-west', 'wall:scuff-east',
      'lounge:pizza-box', 'lounge:empty-cups', 'desk:overflow-bin',
    ];
    for (const targetId of candidates) {
      const pose = PINE_HILLS_V2_CLEANUP_POSES[targetId];
      const current = clamp01(snapshot.targetProgress[targetId]);
      if (current >= 1 || Math.hypot(localX - pose.x, localZ - pose.z) > pose.radius) continue;
      let next = current;
      let reason = null;
      if (targetId === 'entry:leaves-trash') {
        if (toolId === 'broom' && current < 0.66) next = Math.min(0.66, current + Math.max(0.02, dt * 0.55));
        else if (toolId === 'trashbag' && options.bagTied) reason = 'bag-tied';
        else if (toolId === 'trashbag' && !(Number(options.bagSpace) > 0)) reason = 'bag-full';
        else if (toolId === 'trashbag' && current >= 0.55) next = 1;
        else if (toolId === 'trashbag') reason = 'sweep-first';
        else continue;
      } else if (targetId.startsWith('corner:cobweb')) {
        if (toolId !== 'vacuum') continue;
        next = Math.min(1, current + Math.max(0.025, dt * 0.72));
      } else if (targetId.startsWith('wall:scuff')) {
        if (toolId === 'spray') next = Math.max(current, 0.28);
        else if ((toolId === 'cloth' || toolId === 'sponge') && current >= 0.25) {
          next = Math.min(1, current + Math.max(0.025, dt * 0.68));
        } else if (toolId === 'cloth' || toolId === 'sponge') reason = 'spray-first';
        else continue;
      } else {
        if (toolId !== 'trashbag') continue;
        if (options.bagTied) return { handled: true, did: 0, reason: 'bag-tied', targetId };
        if (!(Number(options.bagSpace) > 0)) return { handled: true, did: 0, reason: 'bag-full', targetId };
        next = Math.min(1, current + Math.max(0.05, dt * 1.1));
      }
      if (next <= current) return { handled: true, did: 0, reason, targetId };
      const result = progressTarget(targetId, next);
      return { handled: true, did: next - current, targetId, restoration: result };
    }
    return { handled: false, did: 0 };
  }

  // --- initial pass ------------------------------------------------------------------
  // onStockSocketsReady is deliberately NOT called: v1 fires it only when the cooler
  // GLB adds stocking sockets, and calling it synchronously mid-clubhouse-construction
  // trips the module's later declarations. The greybox changes no stock sockets.
  void onStockSocketsReady;
  hideRetailFixtureAnchors();
  rebuildGreyFixtures();
  sweepLegacyVisuals();
  refresh();

  const ready = Promise.resolve(Object.freeze({ loaded: 0, failed: 0, greybox: true }));

  return {
    group,
    ready,
    refresh,
    applyCleaningTool,
    detachFixturePlacements() {},
    syncFixturePlacements() {
      // rebuildLayout() recreates fixture anchors after a build-mode move: re-hide
      // the new anchors and re-cut the grey volumes to the live poses.
      hideRetailFixtureAnchors();
      rebuildGreyFixtures();
      sweepLegacyVisuals();
      return true;
    },
    update(dt) {
      if (sweepDeadline <= 0) return;
      sweepCountdown -= Math.max(0, dt || 0);
      if (sweepCountdown > 0) return;
      sweepCountdown = 0.5;
      sweepDeadline -= 0.5;
      // The production counter, return GLB and tier lounge mount asynchronously
      // (merch-ready / tier changes); sweep until all are retired, give up quietly
      // after a minute — a missing name means its loader never produced it.
      if (sweepLegacyVisuals()) sweepDeadline = 0;
      hideRetailFixtureAnchors();
    },
    getRoot: (key) => greyRootFor(key) || greyRootFor(`GREY_${key}`),
    roots: () => [...greyStaticRoots.values(), ...greyFixtureRoots.values()],
    // Phase 5 dirt hook: every architecture material carries an aoMap (channel
    // uv1, authored on every band). Passing null restores the neutral no-op
    // mask. No dirt is AUTHORED here — this is the mount point.
    setArchitectureDirtMask(texture) {
      const mask = texture || archMaterials.neutralMask;
      for (const material of archMaterials.materials) {
        material.aoMap = mask;
        material.needsUpdate = true;
      }
      return archMaterials.materials.length;
    },
    diagnostics: () => ({
      greybox: true,
      expected: 0,
      loaded: 0,
      failed: 0,
      failures: [],
      coolerMounted: false,
      cleanupTargets: Object.keys(PINE_HILLS_V2_CLEANUP_POSES).length,
      interactions: interactionProps.length,
      staticDressingBatch: null,
      greyVolumes: greyStaticRoots.size + greyFixtureRoots.size,
      architectureMaterials: archMaterials.materials.length,
      suppressedLegacy: [...suppressedLegacy],
      hiddenFixtureAnchors: [...hiddenAnchorIds],
    }),
    dispose() {
      if (disposed) return { greybox: true };
      disposed = true;
      for (const prop of interactionProps) removeProp?.(prop);
      group.removeFromParent();
      for (const geometry of ownedGeometries) geometry.dispose();
      ownedGeometries.clear();
      for (const material of ownedMaterials) material.dispose();
      ownedMaterials.clear();
      archMaterials.dispose();
      greyStaticRoots.clear();
      greyFixtureRoots.clear();
      neglectRoots.clear();
      return { greybox: true, disposedGeometries: true };
    },
  };
}
