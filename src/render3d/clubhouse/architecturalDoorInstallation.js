import * as THREE from 'three';
import { DOOR_BACK, DOOR_MAIN, DOOR_STOCK, SHELL } from '../../data/shopLayout.js';
import {
  METERS_TO_YARDS,
  architecturalDoorScaleForOpening,
  architecturalDoorTierForQuality,
  validateArchitecturalDoorMount,
} from '../../data/architecturalDoors.js';
import { installedConstructionFinish } from '../../sim/constructionFinishes.js';
import { createArchitecturalDoorVisualRuntime } from './architecturalDoorVisuals.js';

const YARDS_TO_METERS = 0.9144;

function mountPlan(tier, openingWidthYards, openingHeightYards, {
  allowDownscale = true,
  ceilingHeightYards = SHELL.h,
} = {}) {
  const openingWidthM = openingWidthYards * YARDS_TO_METERS;
  const openingHeightM = openingHeightYards * YARDS_TO_METERS;
  const fitScale = architecturalDoorScaleForOpening(tier, openingWidthM, openingHeightM, {
    allowDownscale,
    maximumDownscale: 0.9,
  });
  if (!fitScale) {
    return Object.freeze({ ok: false, tier, fitScale: null, errors: Object.freeze(['scale-out-of-range']) });
  }
  const validation = validateArchitecturalDoorMount({
    tier,
    scale: fitScale,
    openingWidthM,
    openingHeightM,
    wallDepthM: SHELL.wallT * YARDS_TO_METERS,
    floorOffsetM: 0,
    cornerClearanceM: Infinity,
    swingClearanceM: Infinity,
    ceilingHeightM: ceilingHeightYards * YARDS_TO_METERS,
  });
  return Object.freeze({
    ok: validation.ok,
    tier,
    fitScale,
    openingWidthM,
    openingHeightM,
    validation,
    errors: validation.errors,
  });
}

export function createClubhouseArchitecturalDoorInstallation({
  group,
  state,
  doorApi,
  floorTop,
  halfWidth,
  halfDepth,
  camera = null,
  // The pine-hills presentation keeps its authored Course-1 entrance (deep
  // green leaves, damage boards) instead of replacing it with a catalog
  // tier — mounting the luxury GLB there both broke the failing-municipal
  // fantasy and z-layered a second door over the authored one.
  replaceMainEntrance = true,
  visualRuntime = createArchitecturalDoorVisualRuntime(),
} = {}) {
  if (!group?.add) throw new TypeError('Architectural doors require a clubhouse group.');
  if (!doorApi?.bindArchitecturalMainEntranceVisual) {
    throw new TypeError('Architectural doors require the production door controller API.');
  }

  let disposed = false;
  let serviceGeneration = 0;
  let installedServiceTier = null;
  let serviceSyncClock = 0;
  const holders = [];
  const mountReports = [];
  const active = { main: null, stockroom: null, receiving: null };
  let stressRoot = null;
  let stressReady = null;
  let stressForceLod = null;
  let receivingSignOffsetY = 0;
  const stressHolders = [];

  function syncReceivingSign(tier) {
    const sign = group.getObjectByName?.('DeliveryReceivingExteriorSign');
    if (!sign) return false;
    if (!Number.isFinite(sign.userData.architecturalDoorBaseY)) {
      sign.userData.architecturalDoorBaseY = sign.position.y;
    }
    receivingSignOffsetY = tier === 'high-end' ? 0.24 : 0;
    sign.position.y = sign.userData.architecturalDoorBaseY + receivingSignOffsetY;
    sign.userData.architecturalDoorClearanceTier = tier;
    sign.userData.architecturalDoorOffsetY = receivingSignOffsetY;
    return true;
  }

  function recordMount(which, plan, holder = null, bind = null) {
    const report = Object.freeze({
      which,
      tier: plan.tier,
      ok: plan.ok && (!bind || bind.ok),
      fitScale: plan.fitScale,
      openingWidthM: plan.openingWidthM,
      openingHeightM: plan.openingHeightM,
      validation: plan.validation || null,
      holder: holder?.name || null,
      bind: bind || null,
    });
    mountReports.push(report);
    return report;
  }

  function createMount(which, tier, plan, {
    x,
    z,
    rotationY = 0,
    generation = serviceGeneration,
  }) {
    if (!plan.ok) {
      recordMount(which, plan);
      return Promise.resolve(null);
    }
    const holder = visualRuntime.instantiate(tier, {
      parent: group,
      name: `ArchitecturalDoor_${which}_${tier}`,
      scale: METERS_TO_YARDS * plan.fitScale,
      position: new THREE.Vector3(x, floorTop, z),
      rotationY,
      visible: false,
    });
    holder.userData.mountPlan = plan;
    holder.userData.mountRole = which;
    holders.push(holder);
    return holder.userData.ready.then(() => {
      if (disposed || holder.userData.loadError) {
        holder.visible = false;
        recordMount(which, plan, holder, holder.userData.loadError
          ? Object.freeze({ ok: false, reason: 'load-error', error: holder.userData.loadError })
          : Object.freeze({ ok: false, reason: 'disposed' }));
        return holder;
      }
      if (which !== 'main' && generation !== serviceGeneration) {
        holder.visible = false;
        return holder;
      }
      const bind = which === 'main'
        ? doorApi.bindArchitecturalMainEntranceVisual(holder, {
          tier,
          fitScale: plan.fitScale,
        })
        : doorApi.bindArchitecturalServiceDoorVisual(which, holder, {
          tier,
          fitScale: plan.fitScale,
        });
      holder.visible = bind.ok;
      if (bind.ok) active[which] = holder;
      recordMount(which, plan, holder, bind);
      return holder;
    });
  }

  const mainPlan = replaceMainEntrance ? mountPlan('luxury', DOOR_MAIN.w, DOOR_MAIN.h) : null;
  const mainReady = replaceMainEntrance
    ? createMount('main', 'luxury', mainPlan, {
      x: DOOR_MAIN.x,
      z: halfDepth,
    })
    : Promise.resolve(null);

  function selectedServiceTier() {
    const quality = installedConstructionFinish(state, 'doors')?.qualityId || 'municipal';
    return architecturalDoorTierForQuality(quality);
  }

  function syncServiceDoors({ force = false } = {}) {
    const tier = selectedServiceTier();
    if (!force && tier === installedServiceTier) {
      syncReceivingSign(tier);
      return Promise.resolve(Object.freeze({ changed: false, tier }));
    }
    installedServiceTier = tier;
    serviceGeneration += 1;
    const generation = serviceGeneration;
    for (const which of ['stockroom', 'receiving']) {
      if (active[which]) active[which].visible = false;
      active[which] = null;
      doorApi.unbindArchitecturalServiceDoorVisual(which, { restoreFallback: true });
    }
    const stockPlan = mountPlan(tier, DOOR_STOCK.w, DOOR_STOCK.h);
    const receivingPlan = mountPlan(tier, DOOR_BACK.w, DOOR_BACK.h);
    return Promise.all([
      createMount('stockroom', tier, stockPlan, {
        x: DOOR_STOCK.x,
        z: DOOR_STOCK.z,
        generation,
      }),
      // The east-wall installation turns the authored exterior toward +X.
      // Its hinge therefore lands on the high-Z jamb and the analytic runtime
      // mirrors handedness/swing, without a negative render scale.
      createMount('receiving', tier, receivingPlan, {
        x: halfWidth,
        z: DOOR_BACK.z,
        rotationY: Math.PI / 2,
        generation,
      }),
    ]).then(() => {
      syncReceivingSign(tier);
      return Object.freeze({ changed: true, tier });
    });
  }

  const initialServiceReady = syncServiceDoors({ force: true });
  const ready = Promise.all([mainReady, initialServiceReady]).then(() => diagnostics());

  function update(dt) {
    if (stressRoot?.visible) {
      const world = new THREE.Vector3();
      for (const holder of stressHolders) {
        const controller = holder.userData.controller;
        if (!controller) continue;
        if (stressForceLod !== null) controller.setLod(stressForceLod);
        else if (camera?.position) {
          holder.getWorldPosition(world);
          controller.update(dt, world.distanceTo(camera.position) / METERS_TO_YARDS);
        }
      }
    }
    serviceSyncClock += Math.max(0, Number(dt) || 0);
    if (serviceSyncClock < 0.5) return;
    serviceSyncClock = 0;
    void syncServiceDoors();
  }

  function diagnostics() {
    return Object.freeze({
      disposed,
      ready: Boolean((active.main || !replaceMainEntrance) && active.stockroom && active.receiving),
      installedServiceTier,
      receivingSign: Object.freeze({
        found: Boolean(group.getObjectByName?.('DeliveryReceivingExteriorSign')),
        offsetY: receivingSignOffsetY,
      }),
      main: doorApi.mainEntranceDiagnostics?.() || null,
      service: doorApi.serviceDoorDiagnostics?.() || null,
      mounts: Object.freeze([...mountReports]),
      visuals: visualRuntime.diagnostics(),
      stress: stressRoot ? Object.freeze({
        visible: stressRoot.visible,
        requestedCount: stressHolders.length,
        loadedCount: stressHolders.filter((holder) => holder.userData.loaded).length,
        forcedLod: stressForceLod,
        tiers: Object.freeze(stressHolders.reduce((counts, holder) => {
          const tier = holder.userData.architecturalDoorTier;
          counts[tier] = (counts[tier] || 0) + 1;
          return counts;
        }, {})),
        lods: Object.freeze(stressHolders.reduce((counts, holder) => {
          const lod = holder.userData.rig?.lodLevel;
          if (Number.isInteger(lod)) counts[lod] = (counts[lod] || 0) + 1;
          return counts;
        }, {})),
      }) : null,
    });
  }

  function createStressSet({ visible = true } = {}) {
    if (stressRoot) {
      stressRoot.visible = visible;
      return stressReady;
    }
    stressRoot = new THREE.Group();
    stressRoot.name = 'ArchitecturalDoorStressSet_53';
    stressRoot.position.set(0, floorTop, -30);
    stressRoot.visible = visible;
    group.add(stressRoot);
    const counts = Object.freeze({ basic: 15, standard: 15, premium: 10, 'high-end': 8, luxury: 5 });
    const sequence = Object.entries(counts).flatMap(([tier, count]) => (
      Array.from({ length: count }, () => tier)
    ));
    const columns = 9;
    const spacingX = 2.75;
    const spacingZ = 1.05;
    const promises = sequence.map((tier, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const holder = visualRuntime.instantiate(tier, {
        parent: stressRoot,
        name: `DoorStress_${String(index + 1).padStart(2, '0')}_${tier}`,
        scale: METERS_TO_YARDS,
        position: new THREE.Vector3(
          (column - (columns - 1) / 2) * spacingX,
          0,
          row * spacingZ,
        ),
        visible: true,
      });
      holder.userData.stressInstance = true;
      holders.push(holder);
      stressHolders.push(holder);
      return holder.userData.ready;
    });
    stressReady = Promise.all(promises).then(() => diagnostics());
    return stressReady;
  }

  function setStressVisible(visible) {
    if (!stressRoot) return false;
    stressRoot.visible = Boolean(visible);
    return stressRoot.visible;
  }

  function forceStressLod(level = null) {
    stressForceLod = level === null ? null : Math.max(0, Math.min(2, Math.round(Number(level) || 0)));
    if (stressForceLod !== null) {
      for (const holder of stressHolders) holder.userData.controller?.setLod?.(stressForceLod);
    }
    return stressForceLod;
  }

  function dispose() {
    if (disposed) return Object.freeze({ alreadyDisposed: true });
    disposed = true;
    syncReceivingSign('basic');
    doorApi.unbindArchitecturalServiceDoorVisual('stockroom', { restoreFallback: false });
    doorApi.unbindArchitecturalServiceDoorVisual('receiving', { restoreFallback: false });
    const visuals = visualRuntime.dispose();
    return Object.freeze({ alreadyDisposed: false, visuals });
  }

  return Object.freeze({
    ready,
    update,
    syncServiceDoors,
    createStressSet,
    setStressVisible,
    forceStressLod,
    diagnostics,
    ownedResources: () => visualRuntime.ownedResources(),
    dispose,
    holders: () => [...holders],
  });
}

export { mountPlan as architecturalDoorMountPlan };
