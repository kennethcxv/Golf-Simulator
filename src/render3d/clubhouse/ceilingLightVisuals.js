import * as THREE from 'three';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const materialsOf = (object) => (
  Array.isArray(object.material) ? object.material : [object.material]
);

const headIndexFrom = (name, suffix) => {
  const match = new RegExp(`Spotlight_(\\d+)_${suffix}$`, 'i').exec(String(name || ''));
  return match ? Number(match[1]) - 1 : null;
};

function configureRuntimeLight(light, profile) {
  const data = light.userData || {};
  const intensity = Number(data.runtime_intensity ?? data.runtimeIntensity);
  const range = Number(data.runtime_range_yards ?? data.runtimeRangeYards);
  const angle = Number(data.runtime_angle_radians ?? data.runtimeAngleRadians);
  const penumbra = Number(data.runtime_penumbra ?? data.runtimePenumbra);
  const authoredIntensity = Number.isFinite(intensity) ? intensity : Math.min(light.intensity || 1, 14);
  light.userData.ceilingLightOnIntensity = authoredIntensity
    * clamp(Number(profile?.lightIntensityScale) || 1, 0.05, 1);
  light.intensity = light.userData.ceilingLightOnIntensity;
  if (Array.isArray(profile?.runtimeColorLinear) && profile.runtimeColorLinear.length >= 3) {
    light.color.setRGB(
      clamp(Number(profile.runtimeColorLinear[0]) || 0, 0, 1),
      clamp(Number(profile.runtimeColorLinear[1]) || 0, 0, 1),
      clamp(Number(profile.runtimeColorLinear[2]) || 0, 0, 1),
    );
  }
  if (Number.isFinite(range)) light.distance = range;
  light.decay = 2;
  light.castShadow = false;
  if (light.isSpotLight) {
    if (Number.isFinite(angle) && angle > 0) {
      light.angle = angle / 2 * clamp(Number(profile?.spotAngleScale) || 1, 0.55, 1.35);
    }
    if (Number.isFinite(penumbra)) light.penumbra = clamp(penumbra, 0, 1);
    // KHR_lights_punctual carries the lamp's rotation, but Three.js renders a
    // SpotLight toward a separate target object. Bind that target to local -Z
    // so the real beam follows the authored lamp orientation and every parent
    // yaw/tilt pivot. Without this, imported fixtures can look downward while
    // their photons still travel toward Three's default world-space target.
    const target = new THREE.Object3D();
    target.name = `${light.name || 'CeilingSpot'}_RuntimeTarget`;
    target.position.set(0, 0, -1);
    target.userData.ceilingLightTarget = true;
    light.add(target);
    light.target = target;
  }
}

function closestPresetIndex(presets, aim) {
  if (!presets.length) return 0;
  let best = 0;
  let distance = Infinity;
  presets.forEach((preset, index) => {
    const candidate = Math.hypot((preset.yaw || 0) - aim.yaw, (preset.tilt || 0) - aim.tilt);
    if (candidate < distance) {
      best = index;
      distance = candidate;
    }
  });
  return best;
}

export function createCeilingLightController(roots, sku, {
  lightState = null,
  circuitPowered = () => true,
  onPowerStateChange = null,
  onAimStateChange = null,
} = {}) {
  const profile = sku?.lightingProfile;
  if (!profile || !Array.isArray(roots) || !roots.length) return null;

  const runtimeLights = [];
  const emitterMaterials = new Set();
  const headNodes = Array.from({ length: profile.adjustableHeads || 0 }, () => []);

  roots.forEach((root, lodIndex) => {
    const perRoot = new Map();
    let rootLightOrdinal = 0;
    root.traverse((node) => {
      if (node.isLight) {
        configureRuntimeLight(node, profile);
        node.userData.ceilingLightLodIndex = lodIndex;
        node.userData.ceilingLightOrdinal = rootLightOrdinal;
        rootLightOrdinal += 1;
        runtimeLights.push(node);
      }
      if (node.isMesh) {
        for (const material of materialsOf(node)) {
          if (!material) continue;
          if (material.color && Array.isArray(profile.trimColorLinear)
              && /Premium_DarkBronze/i.test(material.name || '')) {
            material.color.setRGB(...profile.trimColorLinear);
          }
          if (material.color && Array.isArray(profile.darkMetalColorLinear)
              && /(?:Track_MatteBlack|AdjustmentKnob_Black)/i.test(material.name || '')) {
            material.color.setRGB(...profile.darkMetalColorLinear);
          }
          const authoredEmitter = /(?:Emitter|Emissive|WarmIntegratedLight)/i.test(material.name || '');
          const litDiffuser = Number(profile.diffuserEmissionIntensity) > 0
            && /FrostedDiffuser/i.test(material.name || '');
          if (!authoredEmitter && !litDiffuser) continue;
          if (!material.userData.ceilingLightEmission) {
            const diffuserColor = Array.isArray(profile.diffuserEmissionColorLinear)
              ? new THREE.Color().setRGB(
                clamp(Number(profile.diffuserEmissionColorLinear[0]) || 0, 0, 1),
                clamp(Number(profile.diffuserEmissionColorLinear[1]) || 0, 0, 1),
                clamp(Number(profile.diffuserEmissionColorLinear[2]) || 0, 0, 1),
              ) : null;
            material.userData.ceilingLightEmission = {
              color: litDiffuser && diffuserColor
                ? diffuserColor
                : material.emissive?.clone?.() || new THREE.Color(0xffffff),
              intensity: litDiffuser
                ? Number(profile.diffuserEmissionIntensity)
                : Number.isFinite(material.emissiveIntensity) ? material.emissiveIntensity : 1,
            };
          }
          emitterMaterials.add(material);
        }
      }
      const yawIndex = headIndexFrom(node.name, 'YawPivot');
      const tiltIndex = headIndexFrom(node.name, 'TiltPivot');
      const interactIndex = headIndexFrom(node.name, 'INTERACT');
      if (yawIndex != null) {
        const record = perRoot.get(yawIndex) || { lodIndex, yaw: null, tilt: null, interactionNode: null };
        record.yaw = node;
        perRoot.set(yawIndex, record);
      }
      if (tiltIndex != null) {
        const record = perRoot.get(tiltIndex) || { lodIndex, yaw: null, tilt: null, interactionNode: null };
        record.tilt = node;
        perRoot.set(tiltIndex, record);
      }
      const interactionMatch = /INTERACT_Spotlight_(\d+)$/i.exec(String(node.name || ''));
      const interactionIndex = interactionMatch ? Number(interactionMatch[1]) - 1 : interactIndex;
      if (interactionIndex != null) {
        const record = perRoot.get(interactionIndex) || { lodIndex, yaw: null, tilt: null, interactionNode: null };
        record.interactionNode = node;
        perRoot.set(interactionIndex, record);
      }
    });
    for (const [index, record] of perRoot) {
      if (headNodes[index]) headNodes[index].push(record);
    }
  });

  const state = {
    isOn: typeof lightState?.isOn === 'boolean' ? lightState.isOn : profile.defaultOn !== false,
    spotlights: Array.from({ length: profile.adjustableHeads || 0 }, (_, index) => ({
      yaw: Number(lightState?.spotlights?.[index]?.yaw ?? profile.defaultAim?.[index]?.yaw) || 0,
      tilt: Number(lightState?.spotlights?.[index]?.tilt ?? profile.defaultAim?.[index]?.tilt) || 0,
    })),
  };
  const displayedAims = state.spotlights.map((aim) => ({ ...aim }));
  let effectiveOn = null;
  let circuitOn = !!circuitPowered();
  const maxPhysicalLights = Math.max(0, Number(profile.runtimeLights) || 0);
  let physicalLightBudget = maxPhysicalLights;

  function applyPower(force = false) {
    const nextEffective = state.isOn && circuitOn;
    if (!force && nextEffective === effectiveOn) return false;
    effectiveOn = nextEffective;
    for (const light of runtimeLights) {
      const budgetAllows = light.userData.ceilingLightOrdinal < physicalLightBudget;
      light.visible = nextEffective && budgetAllows;
      light.intensity = nextEffective && budgetAllows ? light.userData.ceilingLightOnIntensity : 0;
    }
    for (const material of emitterMaterials) {
      const saved = material.userData.ceilingLightEmission;
      if (material.emissive) material.emissive.copy(nextEffective ? saved.color : new THREE.Color(0x000000));
      material.emissiveIntensity = nextEffective
        ? saved.intensity * clamp(Number(profile.emissiveScale) || 1, 0.05, 1)
        : 0;
      material.needsUpdate = true;
    }
    return true;
  }

  function applyAim(index, aim = displayedAims[index]) {
    if (!aim) return false;
    for (const record of headNodes[index] || []) {
      if (record.yaw) record.yaw.quaternion.setFromAxisAngle(Y_AXIS, aim.yaw);
      if (record.tilt) record.tilt.quaternion.setFromAxisAngle(X_AXIS, aim.tilt);
      record.yaw?.updateMatrix();
      record.tilt?.updateMatrix();
    }
    return true;
  }

  const presets = Array.isArray(profile.aimPresets) ? profile.aimPresets : [];
  const headControllers = state.spotlights.map((aim, index) => {
    let presetIndex = closestPresetIndex(presets, aim);
    const interactionNode = headNodes[index]?.find((record) => record.lodIndex === 0)?.interactionNode
      || headNodes[index]?.[0]?.interactionNode
      || null;
    const controller = {
      index,
      label: `Spotlight ${index + 1}`,
      interactionNode,
      get yaw() { return state.spotlights[index].yaw; },
      get tilt() { return state.spotlights[index].tilt; },
      get presetIndex() { return presetIndex; },
      get presetLabel() { return presets[presetIndex]?.label || 'custom'; },
      setAim(yaw, tilt, { notify = true } = {}) {
        state.spotlights[index] = {
          yaw: clamp(Number(yaw) || 0, -Math.PI * 0.9, Math.PI * 0.9),
          tilt: clamp(Number(tilt) || 0, -Math.PI * 0.28, Math.PI * 0.28),
        };
        presetIndex = closestPresetIndex(presets, state.spotlights[index]);
        if (notify && typeof onAimStateChange === 'function') {
          onAimStateChange({
            headIndex: index,
            yaw: state.spotlights[index].yaw,
            tilt: state.spotlights[index].tilt,
            presetIndex,
            presetLabel: controller.presetLabel,
          });
        }
        return state.spotlights[index];
      },
      cycle() {
        if (!presets.length) return controller.setAim(controller.yaw + Math.PI / 8, controller.tilt);
        presetIndex = (presetIndex + 1) % presets.length;
        const preset = presets[presetIndex];
        return controller.setAim(preset.yaw, preset.tilt);
      },
    };
    return controller;
  });

  state.spotlights.forEach((_, index) => applyAim(index));
  applyPower(true);

  return {
    profile,
    controlNode: roots[0].getObjectByName('LIGHT_CONTROL_INTERACTION')
      || roots[0].getObjectByName('INTERACT_ShelfLights')
      || roots[0],
    headControllers,
    runtimeLights,
    emitterMaterials: [...emitterMaterials],
    isOn: () => state.isOn,
    isEffectivelyOn: () => effectiveOn,
    isCircuitPowered: () => circuitOn,
    physicalLightBudget: () => physicalLightBudget,
    maxPhysicalLights: () => maxPhysicalLights,
    setPhysicalLightBudget(count) {
      const next = clamp(Math.floor(Number(count) || 0), 0, maxPhysicalLights);
      if (next === physicalLightBudget) return false;
      physicalLightBudget = next;
      applyPower(true);
      return true;
    },
    setOn(on, { notify = true } = {}) {
      const next = !!on;
      const changed = state.isOn !== next;
      state.isOn = next;
      applyPower();
      if (changed && notify && typeof onPowerStateChange === 'function') onPowerStateChange(next);
      return state.isOn;
    },
    toggle() {
      return this.setOn(!state.isOn);
    },
    update(dt = 0) {
      let changed = false;
      const nextCircuit = !!circuitPowered();
      if (nextCircuit !== circuitOn) {
        circuitOn = nextCircuit;
        changed = applyPower() || changed;
      }
      const frameSeconds = Math.max(0, Number(dt) || 0);
      const blend = frameSeconds > 0 ? 1 - Math.exp(-frameSeconds * 13.5) : 0;
      for (let index = 0; index < state.spotlights.length; index += 1) {
        const shown = displayedAims[index];
        const target = state.spotlights[index];
        const yawDelta = target.yaw - shown.yaw;
        const tiltDelta = target.tilt - shown.tilt;
        if (Math.abs(yawDelta) < 0.0005 && Math.abs(tiltDelta) < 0.0005) {
          if (yawDelta !== 0 || tiltDelta !== 0) {
            shown.yaw = target.yaw;
            shown.tilt = target.tilt;
            applyAim(index, shown);
            changed = true;
          }
          continue;
        }
        shown.yaw += yawDelta * blend;
        shown.tilt += tiltDelta * blend;
        applyAim(index, shown);
        changed = true;
      }
      return changed;
    },
    diagnostics: () => ({
      requestedOn: state.isOn,
      effectiveOn,
      circuitPowered: circuitOn,
      runtimeLightCount: runtimeLights.length,
      activeRuntimeLightCount: runtimeLights.filter((light) => {
        if (light.intensity <= 0) return false;
        let cursor = light;
        while (cursor) {
          if (cursor.visible === false) return false;
          cursor = cursor.parent;
        }
        return true;
      }).length,
      expectedLightsPerLod: profile.runtimeLights,
      physicalLightBudget,
      maxPhysicalLights,
      lodCount: roots.length,
      emitterMaterialCount: emitterMaterials.size,
      spotlights: headControllers.map((head) => ({
        index: head.index,
        yaw: head.yaw,
        tilt: head.tilt,
        presetIndex: head.presetIndex,
        presetLabel: head.presetLabel,
        displayedYaw: displayedAims[head.index].yaw,
        displayedTilt: displayedAims[head.index].tilt,
      })),
      lightDirections: runtimeLights
        .filter((light) => light.userData.ceilingLightLodIndex === 0 && light.isSpotLight)
        .map((light) => {
          const quaternionDirection = new THREE.Vector3(0, 0, -1)
            .applyQuaternion(light.getWorldQuaternion(new THREE.Quaternion()))
            .normalize();
          const origin = light.getWorldPosition(new THREE.Vector3());
          const target = light.target.getWorldPosition(new THREE.Vector3());
          const direction = target.sub(origin).normalize();
          return {
            name: light.name,
            kind: 'spot',
            x: direction.x,
            y: direction.y,
            z: direction.z,
            quaternionX: quaternionDirection.x,
            quaternionY: quaternionDirection.y,
            quaternionZ: quaternionDirection.z,
            targetBoundToLamp: light.target.parent === light,
          };
        }),
    }),
  };
}
