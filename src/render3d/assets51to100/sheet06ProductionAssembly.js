import * as THREE from 'three';

import {
  ARCHITECTURE_DEFAULTS,
  ARCHITECTURE_FINISH_OPTIONS,
} from '../../sim/clubhouseRestoration.js';

const KIT_NUMBERS = Object.freeze([55, 56, 57, 58, 59, 60]);
const COLLISION_NAME = /^(?:COL(?:_|$)|.*Collision(?:_|$))/i;
const EPSILON = 1e-7;

export const SHEET06_FLOOR_FINISH_VARIANTS = Object.freeze({
  'natural-oak': 'oak',
  'medium-walnut': 'walnut',
  'muted-sage-carpet': 'sage_carpet',
  'warm-cream-tile': 'cream_tile',
});

export const SHEET06_DAMAGE_VARIANTS = Object.freeze({
  'natural-oak': 'damaged_wood',
  'medium-walnut': 'damaged_wood',
  'muted-sage-carpet': 'damaged_carpet',
  'warm-cream-tile': 'damaged_tile',
});

const REQUIRED_FLOOR_VARIANTS = Object.freeze(Object.values(SHEET06_FLOOR_FINISH_VARIANTS));
const REQUIRED_DAMAGE_VARIANTS = Object.freeze([...new Set(Object.values(SHEET06_DAMAGE_VARIANTS))]);

class AssemblyContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AssemblyContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AssemblyContractError(code, message);
}

function finite(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback;
}

function slug(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function userData(object) {
  if (!object.userData || typeof object.userData !== 'object') object.userData = {};
  return object.userData;
}

function traverse(root, visitor) {
  if (!root) return;
  if (typeof root.traverse === 'function') {
    root.traverse(visitor);
    return;
  }
  const visit = (node) => {
    visitor(node);
    for (const child of node?.children || []) visit(child);
  };
  visit(root);
}

function collisionNode(node) {
  const data = node?.userData || {};
  return COLLISION_NAME.test(String(node?.name || ''))
    || data.glb_collision === true
    || data.glbCollision === true
    || data.collision_proxy === true
    || data.collisionProxy === true;
}

function branchHasCollisionAncestor(node, stop) {
  for (let cursor = node; cursor && cursor !== stop?.parent; cursor = cursor.parent) {
    if (collisionNode(cursor)) return true;
    if (cursor === stop) break;
  }
  return false;
}

function renderMeshes(root) {
  const meshes = [];
  traverse(root, (node) => {
    if (node?.isMesh && node.geometry && node.material && !branchHasCollisionAncestor(node, root)) {
      meshes.push(node);
    }
  });
  return meshes;
}

function declaredVariant(node) {
  const data = node?.userData || {};
  return data.variant_id
    ?? data.variantId
    ?? data.finish_variant
    ?? data.finishVariant
    ?? data.damage_variant
    ?? data.damageVariant
    ?? (data.runtime_variant === true ? data.variant : undefined);
}

function variantChildren(templateRoot) {
  return (templateRoot?.children || []).filter((child) => declaredVariant(child) !== undefined);
}

function findVariant(templateRoot, wanted, assetNumber) {
  const selected = slug(wanted);
  const matches = variantChildren(templateRoot).filter((node) => slug(declaredVariant(node)) === selected);
  if (matches.length === 0) {
    fail('VARIANT_MISSING', `Asset ${assetNumber} has no top-level variant_id '${wanted}'.`);
  }
  if (matches.length !== 1) {
    fail('VARIANT_AMBIGUOUS', `Asset ${assetNumber} has ${matches.length} top-level variants named '${wanted}'.`);
  }
  const [variant] = matches;
  if (collisionNode(variant) || renderMeshes(variant).length === 0) {
    fail('VARIANT_NO_RENDER_MESH', `Asset ${assetNumber} variant '${wanted}' has no render mesh.`);
  }
  return variant;
}

function pruneCollisionBranches(root) {
  let removed = 0;
  const visit = (node) => {
    for (const child of [...(node.children || [])]) {
      if (collisionNode(child)) {
        node.remove(child);
        removed += 1;
      } else {
        visit(child);
      }
    }
  };
  visit(root);
  return removed;
}

function cloneVariant(source, assetNumber, variantId) {
  if (typeof source?.clone !== 'function') {
    fail('TEMPLATE_MALFORMED', `Asset ${assetNumber} variant '${variantId}' is not cloneable.`);
  }
  const clone = source.clone(true);
  pruneCollisionBranches(clone);
  traverse(clone, (node) => {
    node.visible = true;
    const data = userData(node);
    data.sheet06BorrowedCacheResources = node.isMesh === true;
    data.sheet06GlbCollisionActive = false;
  });
  if (renderMeshes(clone).length === 0) {
    fail('VARIANT_NO_RENDER_MESH', `Asset ${assetNumber} variant '${variantId}' clones no render mesh.`);
  }
  return clone;
}

function templateFor(templates, number) {
  if (typeof templates === 'function') return templates(number) || null;
  if (typeof templates?.getRoot === 'function') return templates.getRoot(number) || null;
  if (typeof templates?.get === 'function') return templates.get(number) ?? templates.get(String(number)) ?? null;
  return templates?.[number] ?? templates?.[String(number)] ?? null;
}

function fallbackFor(fallbacks, number) {
  if (!fallbacks) return null;
  if (typeof fallbacks.get === 'function') {
    return fallbacks.get(number)
      ?? fallbacks.get(String(number))
      ?? fallbacks.get(`asset${number}`)
      ?? null;
  }
  return fallbacks[number] ?? fallbacks[String(number)] ?? fallbacks[`asset${number}`] ?? null;
}

function fallbackVisible(handle) {
  if (!handle) return null;
  if (typeof handle.getVisible === 'function') return Boolean(handle.getVisible());
  return typeof handle.visible === 'boolean' ? handle.visible : null;
}

function setFallbackVisible(handle, visible) {
  if (!handle) return;
  if (typeof handle.setVisible === 'function') {
    handle.setVisible(Boolean(visible));
    return;
  }
  if ('visible' in handle) {
    handle.visible = Boolean(visible);
    return;
  }
  fail('FALLBACK_MALFORMED', 'Fallback handle must expose visible or setVisible().');
}

function validateTemplate(root, number) {
  if (!root || typeof root !== 'object' || !Array.isArray(root.children)) {
    fail('TEMPLATE_MISSING', `Asset ${number} template root is unavailable.`);
  }
  if (!root.scale || ![root.scale.x, root.scale.y, root.scale.z].every((value) => Number.isFinite(value) && value > 0)) {
    fail('TEMPLATE_MALFORMED', `Asset ${number} template has no positive runtime scale.`);
  }
  if (root.userData?.sheet06ScaleApplications !== undefined
    && root.userData.sheet06ScaleApplications !== 1) {
    fail('TEMPLATE_MALFORMED', `Asset ${number} template must carry exactly one runtime-scale application.`);
  }
  return root;
}

function validateMount(mount, label) {
  if (!mount || typeof mount.add !== 'function' || typeof mount.remove !== 'function') {
    fail('MOUNT_MISSING', `Sheet-6 ${label} mount is unavailable.`);
  }
  return mount;
}

function normalizedPosition(value, label, defaultY = 0) {
  const array = Array.isArray(value?.position) ? value.position : Array.isArray(value) ? value : null;
  const x = array ? array[0] : value?.x;
  const y = array ? array[1] : value?.y;
  const z = array ? array[2] : value?.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    fail('LAYOUT_MALFORMED', `${label} must provide finite x/z coordinates.`);
  }
  return [x, Number.isFinite(y) ? y : defaultY, z];
}

function normalizeBounds(value, label) {
  const bounds = value || {};
  const result = {
    minX: finite(bounds.minX), maxX: finite(bounds.maxX),
    minZ: finite(bounds.minZ), maxZ: finite(bounds.maxZ),
  };
  if (Object.values(result).some((entry) => entry === null)
    || result.maxX - result.minX <= EPSILON
    || result.maxZ - result.minZ <= EPSILON) {
    fail('LAYOUT_MALFORMED', `${label} must be a positive finite X/Z rectangle.`);
  }
  return result;
}

function normalizePlacement(value, label, defaultY = 0, defaultVariant = null) {
  const position = normalizedPosition(value, label, defaultY);
  const rotationY = finite(value?.rotationY, finite(value?.ry, 0));
  const variant = value?.variant ?? value?.variantId ?? defaultVariant;
  if (!Number.isFinite(rotationY)) fail('LAYOUT_MALFORMED', `${label} rotationY must be finite.`);
  if (!variant) fail('LAYOUT_MALFORMED', `${label} must select a variant.`);
  return {
    id: String(value?.id ?? label),
    position,
    rotationY,
    variant: slug(variant),
    scaleAlong: finite(value?.scaleAlong, 1),
    scaleAcross: finite(value?.scaleAcross, 1),
  };
}

function resolveWindowPlacement(datum, index, layout) {
  const label = `Window datum ${index}`;
  if (Array.isArray(datum?.position) || (Number.isFinite(datum?.x) && Number.isFinite(datum?.z))) {
    return normalizePlacement(datum, label, finite(layout?.exteriorFloorY, 0), datum?.variant || 'standard');
  }
  const wall = String(datum?.wall || '').toUpperCase();
  const c = finite(datum?.c);
  if (!['N', 'S', 'E', 'W'].includes(wall) || c === null) {
    fail('LAYOUT_MALFORMED', `${label} needs a stable wall/c datum or an explicit position.`);
  }
  const bounds = normalizeBounds(layout?.shellBounds ?? layout?.exteriorBounds, 'layout.shellBounds');
  const floorY = finite(layout?.exteriorFloorY, 0);
  const sill = finite(datum?.sill, finite(layout?.windowSill, 0));
  const offset = finite(datum?.wallOffset, finite(layout?.windowWallOffset, 0));
  const positions = {
    S: [c, floorY + sill, bounds.maxZ + offset],
    N: [c, floorY + sill, bounds.minZ - offset],
    E: [bounds.maxX + offset, floorY + sill, c],
    W: [bounds.minX - offset, floorY + sill, c],
  };
  const rotations = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };
  return {
    id: String(datum.id ?? `window-${index}-${wall}-${c}`),
    position: positions[wall],
    rotationY: finite(datum.rotationY, rotations[wall]),
    variant: slug(datum.variant || 'standard'),
    scaleAlong: 1,
    scaleAcross: 1,
  };
}

function runtimeScale(template, scaleAlong = 1, scaleAcross = 1) {
  if (!Number.isFinite(scaleAlong) || scaleAlong <= 0) {
    fail('LAYOUT_MALFORMED', 'Placement scaleAlong must be positive and finite.');
  }
  if (!Number.isFinite(scaleAcross) || scaleAcross <= 0) {
    fail('LAYOUT_MALFORMED', 'Placement scaleAcross must be positive and finite.');
  }
  return [template.scale.x * scaleAlong, template.scale.y, template.scale.z * scaleAcross];
}

function makePlacedVariant({ template, source, assetNumber, placement, name }) {
  const placed = new THREE.Group();
  placed.name = name;
  placed.position.fromArray(placement.position);
  placed.rotation.y = placement.rotationY;
  const data = userData(placed);
  data.sheet06AssetNumber = assetNumber;
  data.sheet06PlacementId = placement.id;
  data.sheet06Variant = placement.variant;
  data.sheet06ScaleApplications = 0;
  data.sheet06ParkedTemplateSample = false;

  const metricFrame = new THREE.Group();
  metricFrame.name = `${name}_METRIC_TO_GAME_UNITS`;
  metricFrame.scale.fromArray(runtimeScale(template, placement.scaleAlong, placement.scaleAcross));
  userData(metricFrame).sheet06ScaleApplications = 1;
  metricFrame.add(cloneVariant(source, assetNumber, placement.variant));
  placed.add(metricFrame);
  return placed;
}

function placementsFromRuns(runs, {
  label,
  defaultY,
  defaultVariant,
  moduleLengthMeters,
  runtimeScaleX,
}) {
  const placements = [];
  for (const [runIndex, run] of (runs || []).entries()) {
    const start = normalizedPosition(run?.start, `${label} ${runIndex} start`, defaultY);
    const end = normalizedPosition(run?.end, `${label} ${runIndex} end`, defaultY);
    const dx = end[0] - start[0];
    const dz = end[2] - start[2];
    const length = Math.hypot(dx, dz);
    if (length <= EPSILON) fail('LAYOUT_MALFORMED', `${label} ${runIndex} has zero length.`);
    const nominal = moduleLengthMeters * runtimeScaleX;
    // Quiet carrier fields (currently the Sheet-6 ceiling plaster) are authored
    // to tolerate non-uniform runtime scaling. Keeping one carrier avoids a row
    // of beveled module ends showing through an otherwise continuous finish.
    const count = run?.singleModule === true
      ? 1
      : Math.max(1, Math.ceil(length / nominal - EPSILON));
    const segment = length / count;
    const rotationY = finite(run?.rotationY, -Math.atan2(dz, dx));
    const variant = slug(run?.variant || defaultVariant);
    for (let index = 0; index < count; index += 1) {
      const ratio = (index + 0.5) / count;
      placements.push({
        id: String(run?.id ?? `${label}-${runIndex}`) + `-${index}`,
        position: [
          start[0] + dx * ratio,
          start[1] + (end[1] - start[1]) * ratio,
          start[2] + dz * ratio,
        ],
        rotationY,
        variant,
        scaleAlong: segment / nominal,
        scaleAcross: finite(run?.scaleAcross, 1),
      });
    }
  }
  return placements;
}

function explicitPlacements(values, options) {
  return (values || []).map((value, index) => normalizePlacement(
    value,
    `${options.label} ${index}`,
    options.defaultY,
    options.defaultVariant,
  ));
}

function createRepeatedKit({
  assetNumber,
  template,
  mount,
  placements,
  requireKinds = null,
}) {
  if (!placements.length) fail('LAYOUT_MISSING', `Asset ${assetNumber} has no production placements.`);
  if (requireKinds) {
    for (const [label, predicate] of Object.entries(requireKinds)) {
      if (!placements.some(predicate)) fail('LAYOUT_MISSING', `Asset ${assetNumber} needs at least one ${label}.`);
    }
  }
  const root = new THREE.Group();
  root.name = `SHEET06_ASSET_${assetNumber}_PRODUCTION_ASSEMBLY`;
  const variants = new Set();
  placements.forEach((placement, index) => {
    const source = findVariant(template, placement.variant, assetNumber);
    const instance = makePlacedVariant({
      template,
      source,
      assetNumber,
      placement,
      name: `SHEET06_${assetNumber}_${placement.id || index}`,
    });
    root.add(instance);
    variants.add(placement.variant);
  });
  const data = userData(root);
  data.sheet06AssetNumber = assetNumber;
  data.sheet06InstanceCount = placements.length;
  data.sheet06TemplateSourceY = template.position?.y ?? null;
  data.sheet06ParkedTemplateSample = false;
  mount.add(root);
  return {
    root,
    instanceCount: placements.length,
    variants: [...variants].sort(),
  };
}

function meshDescriptorsInMetricFrame(source, assetNumber, variantId) {
  // The parked template root already carries the shared meters-to-game-units
  // scale. Cancel that ancestor transform here so each instance matrix applies
  // the metric conversion exactly once, matching makePlacedVariant().
  source.updateWorldMatrix?.(true, true);
  const parentWorld = source.parent?.matrixWorld || new THREE.Matrix4();
  const toMetricFrame = new THREE.Matrix4().copy(parentWorld).invert();
  return renderMeshes(source).map((mesh, index) => {
    if (mesh.isSkinnedMesh || mesh.morphTargetInfluences) {
      fail(
        'TEMPLATE_NOT_INSTANCEABLE',
        `Asset ${assetNumber} variant '${variantId}' mesh '${mesh.name || index}' is not a static instancing resource.`,
      );
    }
    mesh.updateWorldMatrix?.(true, false);
    return {
      mesh,
      index,
      relative: new THREE.Matrix4().multiplyMatrices(toMetricFrame, mesh.matrixWorld),
    };
  });
}

function instanceMatrixForPlacement(template, placement, relative, target) {
  const [scaleX, scaleY, scaleZ] = runtimeScale(
    template,
    placement.scaleAlong,
    placement.scaleAcross,
  );
  return target
    .makeTranslation(...placement.position)
    .multiply(new THREE.Matrix4().makeRotationY(placement.rotationY))
    .multiply(new THREE.Matrix4().makeScale(scaleX, scaleY, scaleZ))
    .multiply(relative);
}

function createInstancedRepeatedKit({
  assetNumber,
  template,
  mount,
  placements,
  requireKinds = null,
}) {
  if (!placements.length) fail('LAYOUT_MISSING', `Asset ${assetNumber} has no production placements.`);
  if (requireKinds) {
    for (const [label, predicate] of Object.entries(requireKinds)) {
      if (!placements.some(predicate)) fail('LAYOUT_MISSING', `Asset ${assetNumber} needs at least one ${label}.`);
    }
  }

  const placementsByVariant = new Map();
  for (const placement of placements) {
    if (!placementsByVariant.has(placement.variant)) placementsByVariant.set(placement.variant, []);
    placementsByVariant.get(placement.variant).push(placement);
  }

  // Resolve every source before allocating object-owned instance buffers. A
  // malformed variant therefore cannot strand a partially built batch.
  const descriptorsByVariant = new Map();
  for (const [variantId] of placementsByVariant) {
    const source = findVariant(template, variantId, assetNumber);
    const descriptors = meshDescriptorsInMetricFrame(source, assetNumber, variantId);
    if (!descriptors.length) {
      fail('VARIANT_NO_RENDER_MESH', `Asset ${assetNumber} variant '${variantId}' has no render mesh.`);
    }
    descriptorsByVariant.set(variantId, descriptors);
  }

  const root = new THREE.Group();
  root.name = `SHEET06_ASSET_${assetNumber}_PRODUCTION_ASSEMBLY`;
  const rootData = userData(root);
  rootData.sheet06AssetNumber = assetNumber;
  rootData.sheet06InstanceCount = placements.length;
  rootData.sheet06TemplateSourceY = template.position?.y ?? null;
  rootData.sheet06ParkedTemplateSample = false;
  rootData.sheet06Batching = 'INSTANCED_BY_VARIANT_SOURCE_MESH';

  const ownedInstancedMeshes = [];
  try {
    for (const [variantId, variantPlacements] of placementsByVariant) {
      for (const descriptor of descriptorsByVariant.get(variantId)) {
        const sourceMesh = descriptor.mesh;
        const requestedStride = Math.floor(finite(sourceMesh.userData?.damage_sample_stride, 1));
        const stride = Math.max(1, requestedStride);
        const offset = Math.max(0, Math.floor(finite(sourceMesh.userData?.damage_sample_offset, 0))) % stride;
        const descriptorPlacements = stride > 1
          ? variantPlacements.filter((_, index) => index % stride === offset)
          : variantPlacements;
        // Authored sampling metadata is optional. If a malformed/oversized
        // offset would empty a real damage batch, keep one deterministic bay
        // so an unrestored state can never become visually indistinguishable.
        if (descriptorPlacements.length === 0 && variantPlacements.length > 0) {
          descriptorPlacements.push(variantPlacements[Math.min(offset, variantPlacements.length - 1)]);
        }
        const batch = new THREE.InstancedMesh(
          sourceMesh.geometry,
          sourceMesh.material,
          descriptorPlacements.length,
        );
        batch.name = `SHEET06_${assetNumber}_${variantId}_${descriptor.index}_${sourceMesh.name || 'MESH'}_INSTANCES`;
        batch.castShadow = sourceMesh.castShadow;
        batch.receiveShadow = sourceMesh.receiveShadow;
        batch.frustumCulled = sourceMesh.frustumCulled;
        batch.renderOrder = sourceMesh.renderOrder;
        batch.layers.mask = sourceMesh.layers.mask;
        batch.instanceMatrix.setUsage(THREE.StaticDrawUsage);

        const batchData = userData(batch);
        Object.assign(batchData, sourceMesh.userData || {});
        batchData.sheet06AssetNumber = assetNumber;
        batchData.sheet06Variant = variantId;
        batchData.sheet06InstanceCount = descriptorPlacements.length;
        batchData.sheet06PlacementIds = descriptorPlacements.map((placement) => placement.id);
        batchData.sheet06DamageSampleStride = stride;
        batchData.sheet06DamageSampleOffset = offset;
        batchData.sheet06ScaleApplications = 1;
        batchData.sheet06MetricFrame = 'INSTANCE_MATRIX';
        batchData.sheet06BorrowedCacheResources = true;
        batchData.sheet06GlbCollisionActive = false;
        batchData.sheet06ParkedTemplateSample = false;

        const matrix = new THREE.Matrix4();
        descriptorPlacements.forEach((placement, index) => {
          batch.setMatrixAt(
            index,
            instanceMatrixForPlacement(template, placement, descriptor.relative, matrix),
          );
        });
        batch.instanceMatrix.needsUpdate = true;
        root.add(batch);
        ownedInstancedMeshes.push(batch);
      }
    }
    mount.add(root);
  } catch (error) {
    root.parent?.remove(root);
    for (const mesh of ownedInstancedMeshes) mesh.dispose?.();
    throw error;
  }

  return {
    root,
    ownedInstancedMeshes,
    instanceCount: placements.length,
    variants: [...placementsByVariant.keys()].sort(),
  };
}

function boundsForVariant(variant) {
  const meshes = renderMeshes(variant);
  if (!meshes.length) fail('VARIANT_NO_RENDER_MESH', `Variant ${declaredVariant(variant)} has no render mesh.`);
  variant.updateMatrixWorld?.(true);
  const inverse = new THREE.Matrix4().copy(variant.matrixWorld).invert();
  const union = new THREE.Box3();
  let initialized = false;
  for (const mesh of meshes) {
    mesh.geometry.computeBoundingBox?.();
    if (!mesh.geometry.boundingBox) fail('TEMPLATE_MALFORMED', `Mesh ${mesh.name} has no measurable bounds.`);
    const relative = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    const box = mesh.geometry.boundingBox.clone().applyMatrix4(relative);
    if (!initialized) {
      union.copy(box);
      initialized = true;
    } else {
      union.union(box);
    }
  }
  return union;
}

function floorResource(template, variantId) {
  const variant = findVariant(template, variantId, 59);
  const meshes = renderMeshes(variant);
  if (meshes.length !== 1) {
    fail('FLOOR_RESOURCE_INVALID', `Asset 59 variant '${variantId}' must contain exactly one joined render mesh.`);
  }
  const [mesh] = meshes;
  variant.updateMatrixWorld?.(true);
  const relative = new THREE.Matrix4().multiplyMatrices(
    new THREE.Matrix4().copy(variant.matrixWorld).invert(),
    mesh.matrixWorld,
  );
  mesh.geometry.computeBoundingBox?.();
  if (!mesh.geometry.boundingBox) {
    fail('FLOOR_RESOURCE_INVALID', `Asset 59 variant '${variantId}' has no geometry bounds.`);
  }
  const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(relative);
  const size = bounds.getSize(new THREE.Vector3());
  if (size.x <= EPSILON || size.y <= EPSILON || size.z <= EPSILON) {
    fail('FLOOR_RESOURCE_INVALID', `Asset 59 variant '${variantId}' has degenerate bounds.`);
  }
  return { variant, mesh, relative, bounds, size };
}

function subtractRectangle(outer, excluded) {
  if (!excluded) return [outer];
  const cut = {
    minX: Math.max(outer.minX, excluded.minX), maxX: Math.min(outer.maxX, excluded.maxX),
    minZ: Math.max(outer.minZ, excluded.minZ), maxZ: Math.min(outer.maxZ, excluded.maxZ),
  };
  if (cut.maxX - cut.minX <= EPSILON || cut.maxZ - cut.minZ <= EPSILON) return [outer];
  const candidates = [
    { minX: outer.minX, maxX: outer.maxX, minZ: outer.minZ, maxZ: cut.minZ },
    { minX: outer.minX, maxX: outer.maxX, minZ: cut.maxZ, maxZ: outer.maxZ },
    { minX: outer.minX, maxX: cut.minX, minZ: cut.minZ, maxZ: cut.maxZ },
    { minX: cut.maxX, maxX: outer.maxX, minZ: cut.minZ, maxZ: cut.maxZ },
  ];
  return candidates.filter((rect) => rect.maxX - rect.minX > EPSILON && rect.maxZ - rect.minZ > EPSILON);
}

function cellsForRegion(region, nominalTileSize) {
  const width = region.maxX - region.minX;
  const depth = region.maxZ - region.minZ;
  const columns = Math.max(1, Math.ceil(width / nominalTileSize - EPSILON));
  const rows = Math.max(1, Math.ceil(depth / nominalTileSize - EPSILON));
  const cellWidth = width / columns;
  const cellDepth = depth / rows;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        x: region.minX + (column + 0.5) * cellWidth,
        z: region.minZ + (row + 0.5) * cellDepth,
        width: cellWidth,
        depth: cellDepth,
      });
    }
  }
  return cells;
}

function floorCells(layout, nominalTileSize) {
  if (Array.isArray(layout?.floorCells) && layout.floorCells.length) {
    return layout.floorCells.map((cell, index) => {
      const [x, , z] = normalizedPosition(cell, `Floor cell ${index}`);
      const width = finite(cell.width);
      const depth = finite(cell.depth);
      if (width === null || depth === null || width <= 0 || depth <= 0) {
        fail('LAYOUT_MALFORMED', `Floor cell ${index} needs positive width/depth.`);
      }
      return { x, z, width, depth };
    });
  }
  let regions;
  if (Array.isArray(layout?.floorRegions) && layout.floorRegions.length) {
    regions = layout.floorRegions.map((region, index) => normalizeBounds(region, `Floor region ${index}`));
  } else {
    const interior = normalizeBounds(layout?.interiorBounds, 'layout.interiorBounds');
    const stockroom = layout?.stockroomBounds
      ? normalizeBounds(layout.stockroomBounds, 'layout.stockroomBounds')
      : null;
    regions = subtractRectangle(interior, stockroom);
  }
  return regions.flatMap((region) => cellsForRegion(region, nominalTileSize));
}

function sameFloorFootprint(resources) {
  const baseline = resources.values().next().value.size;
  for (const resource of resources.values()) {
    if (Math.abs(resource.size.x - baseline.x) > 1e-5
      || Math.abs(resource.size.z - baseline.z) > 1e-5
      || Math.abs(resource.size.y - baseline.y) > 1e-5) return false;
  }
  return true;
}

function createFloorKit({ template, mount, layout, stateView }) {
  const resources = new Map();
  for (const variant of REQUIRED_FLOOR_VARIANTS) resources.set(variant, floorResource(template, variant));
  if (!sameFloorFootprint(resources)) {
    fail('FLOOR_RESOURCE_INVALID', 'Asset 59 save-selectable variants must share one metric footprint.');
  }
  const selectedVariant = SHEET06_FLOOR_FINISH_VARIANTS[stateView.components.floor.finish];
  const selected = resources.get(selectedVariant);
  const nominalTile = Math.max(selected.size.x * template.scale.x, selected.size.z * template.scale.z);
  const cells = floorCells(layout, nominalTile);
  if (!cells.length) fail('LAYOUT_MISSING', 'Asset 59 has no non-stockroom floor cells.');

  const mesh = new THREE.InstancedMesh(selected.mesh.geometry, selected.mesh.material, cells.length);
  mesh.name = 'SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES';
  mesh.castShadow = selected.mesh.castShadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  const floorY = finite(layout?.floorY, 0);
  const center = selected.bounds.getCenter(new THREE.Vector3());
  const align = new THREE.Matrix4().makeTranslation(-center.x, -selected.bounds.min.y, -center.z);
  const matrix = new THREE.Matrix4();
  const translate = new THREE.Matrix4();
  const scale = new THREE.Matrix4();
  cells.forEach((cell, index) => {
    translate.makeTranslation(cell.x, floorY, cell.z);
    scale.makeScale(cell.width / selected.size.x, template.scale.y, cell.depth / selected.size.z);
    matrix.copy(translate).multiply(scale).multiply(align).multiply(selected.relative);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  const meshData = userData(mesh);
  meshData.sheet06AssetNumber = 59;
  meshData.sheet06ScaleApplications = 1;
  meshData.sheet06GlbCollisionActive = false;
  meshData.sheet06NonStockroomOnly = true;
  meshData.sheet06InstanceCount = cells.length;

  const root = new THREE.Group();
  root.name = 'SHEET06_ASSET_59_PRODUCTION_ASSEMBLY';
  userData(root).sheet06AssetNumber = 59;
  userData(root).sheet06ParkedTemplateSample = false;
  root.add(mesh);
  mount.add(root);
  const surfaceY = floorY + selected.size.y * template.scale.y;
  return {
    root,
    mesh,
    ownedInstancedMeshes: [mesh],
    resources,
    cells,
    surfaceY,
    selectedVariant,
    instanceCount: cells.length,
    variants: [selectedVariant],
  };
}

function deterministicDamageSites(layout, cells) {
  if (Array.isArray(layout?.damageSites) && layout.damageSites.length) {
    return layout.damageSites.map((site, index) => {
      const [x, , z] = normalizedPosition(site, `Damage site ${index}`);
      return {
        id: String(site.id ?? `damage-${index}`),
        x,
        z,
        rotationY: finite(site.rotationY, finite(site.ry, (index % 4) * Math.PI / 2)),
      };
    });
  }
  const desired = Math.min(6, Math.max(1, Math.floor(cells.length / 48)));
  const result = [];
  const used = new Set();
  for (let index = 0; index < desired; index += 1) {
    let selected = Math.floor(((index + 1) / (desired + 1)) * cells.length);
    while (used.has(selected) && selected + 1 < cells.length) selected += 1;
    used.add(selected);
    const cell = cells[selected];
    result.push({
      id: `damage-${index}`,
      x: cell.x,
      z: cell.z,
      rotationY: (index % 4) * Math.PI / 2,
    });
  }
  return result;
}

function damageVariantBounds(source) {
  const bounds = boundsForVariant(source);
  if (!Number.isFinite(bounds.min.y)) fail('TEMPLATE_MALFORMED', 'Asset 60 damage variant has invalid bounds.');
  return bounds;
}

function createDamageKit({ template, mount, layout, stateView, floorRecord }) {
  if (!floorRecord?.cells || !Number.isFinite(floorRecord.surfaceY)) {
    fail('FLOOR_AUTHORITY_MISSING', 'Asset 60 requires the successful Asset 59 walk-plane assembly.');
  }
  const sources = new Map();
  for (const variantId of REQUIRED_DAMAGE_VARIANTS) {
    const source = findVariant(template, variantId, 60);
    sources.set(variantId, { source, bounds: damageVariantBounds(source) });
  }
  const sites = deterministicDamageSites(layout, floorRecord.cells);
  if (!sites.length) fail('LAYOUT_MISSING', 'Asset 60 has no deterministic damage sites.');
  const selectedVariant = SHEET06_DAMAGE_VARIANTS[stateView.components.floor.finish];
  const root = new THREE.Group();
  root.name = 'SHEET06_ASSET_60_PRODUCTION_ASSEMBLY';
  userData(root).sheet06AssetNumber = 60;
  userData(root).sheet06ParkedTemplateSample = false;
  const siteRecords = [];
  for (const [index, site] of sites.entries()) {
    const siteRoot = new THREE.Group();
    siteRoot.name = `SHEET06_60_${site.id}`;
    siteRoot.position.set(site.x, floorRecord.surfaceY, site.z);
    siteRoot.rotation.y = site.rotationY;
    userData(siteRoot).sheet06FloorSurfaceY = floorRecord.surfaceY;
    const variants = new Map();
    for (const [variantId, descriptor] of sources) {
      const metricFrame = new THREE.Group();
      metricFrame.name = `SHEET06_60_${site.id}_${variantId}_METRIC_TO_GAME_UNITS`;
      metricFrame.scale.copy(template.scale);
      userData(metricFrame).sheet06ScaleApplications = 1;
      const alignment = new THREE.Group();
      alignment.position.y = -descriptor.bounds.min.y;
      const clone = cloneVariant(descriptor.source, 60, variantId);
      alignment.add(clone);
      metricFrame.add(alignment);
      metricFrame.visible = variantId === selectedVariant;
      variants.set(variantId, metricFrame);
      siteRoot.add(metricFrame);
    }
    userData(siteRoot).sheet06PlacementId = site.id;
    userData(siteRoot).sheet06DamageIndex = index;
    siteRecords.push({ root: siteRoot, variants });
    root.add(siteRoot);
  }
  root.visible = !stateView.components.floor.restored;
  mount.add(root);
  return {
    root,
    sites: siteRecords,
    selectedVariant,
    surfaceY: floorRecord.surfaceY,
    instanceCount: sites.length,
    variants: [selectedVariant],
  };
}

function architectureStateView(state) {
  const source = state?.shop?.reno?.architecture?.components;
  const components = {};
  for (const [name, defaults] of Object.entries(ARCHITECTURE_DEFAULTS.components)) {
    const candidate = source?.[name];
    const allowed = ARCHITECTURE_FINISH_OPTIONS[name];
    components[name] = Object.freeze({
      restored: typeof candidate?.restored === 'boolean' ? candidate.restored : defaults.restored,
      finish: allowed.includes(candidate?.finish) ? candidate.finish : defaults.finish,
    });
  }
  return Object.freeze({
    components: Object.freeze(components),
    windowFilm: Array.isArray(state?.shop?.reno?.windows) ? state.shop.reno.windows : null,
    floorGrime: Array.isArray(state?.shop?.reno?.grime) ? state.shop.reno.grime : null,
  });
}

function setDamageOverlayVisibility(root, visible) {
  traverse(root, (node) => {
    if (node?.userData?.damage_overlay === true || node?.userData?.damageOverlay === true) {
      node.visible = visible;
    }
  });
}

function updateKitMetadata(record, component, stateView) {
  if (!record?.root) return;
  const value = stateView.components[component];
  const data = userData(record.root);
  data.sheet06StateAuthority = 'state.shop.reno.architecture';
  data.sheet06Component = component;
  data.sheet06Restored = value.restored;
  data.sheet06Finish = value.finish;
}

function updateWindows(record, stateView) {
  updateKitMetadata(record, 'windows', stateView);
  for (const [index, instance] of record.root.children.entries()) {
    const data = userData(instance);
    data.sheet06WindowIndex = index;
    data.sheet06WindowBroken = !stateView.components.windows.restored;
    data.sheet06WindowFilm = stateView.windowFilm?.[index] ?? null;
    data.sheet06WindowFilmAuthority = 'state.shop.reno.windows';
  }
}

function updateFloor(record, stateView) {
  updateKitMetadata(record, 'floor', stateView);
  const finish = stateView.components.floor.finish;
  const variant = SHEET06_FLOOR_FINISH_VARIANTS[finish];
  const resource = record.resources.get(variant);
  if (!resource) fail('STATE_VARIANT_MISSING', `Asset 59 cannot select floor finish '${finish}'.`);
  record.mesh.geometry = resource.mesh.geometry;
  record.mesh.material = resource.mesh.material;
  record.selectedVariant = variant;
  record.variants = [variant];
  const data = userData(record.mesh);
  data.sheet06SelectedVariant = variant;
  data.sheet06FloorGrimeAuthority = 'state.shop.reno.grime';
  data.sheet06FloorGrimeCellCount = stateView.floorGrime?.length ?? 0;
}

function updateDamage(record, stateView) {
  updateKitMetadata(record, 'floor', stateView);
  const variant = SHEET06_DAMAGE_VARIANTS[stateView.components.floor.finish];
  if (!variant) fail('STATE_VARIANT_MISSING', `Asset 60 has no damage family for '${stateView.components.floor.finish}'.`);
  for (const site of record.sites) {
    for (const [candidate, object] of site.variants) object.visible = candidate === variant;
  }
  record.root.visible = !stateView.components.floor.restored;
  record.selectedVariant = variant;
  record.variants = [variant];
  const data = userData(record.root);
  data.sheet06DamageVisible = record.root.visible;
  data.sheet06AdditiveDamageOnly = true;
  data.sheet06FloorGrimeAuthority = 'state.shop.reno.grime';
}

function errorDiagnostic(error) {
  return Object.freeze({
    code: String(error?.code || 'ASSEMBLY_FAILED'),
    message: String(error?.message || 'Unknown Sheet-6 production assembly failure.'),
  });
}

/**
 * Builds the visible Sheet-6 modular kits from the six cache-owned templates.
 * The template roots may remain parked by the loader: only named top-level
 * variant resources are used. Per-window and floor-damage objects retain their
 * logical clones, while dense static modular runs use InstancedMesh batches.
 * Every derived object borrows geometry/material/texture identities from the
 * cache.
 */
export function createSheet06ProductionAssembly({
  templates = null,
  exterior = null,
  interior = null,
  mounts = null,
  windowDatums = [],
  layout = {},
  state = null,
  fallbacks = {},
} = {}) {
  const resolvedExterior = exterior ?? mounts?.exterior ?? mounts?.group ?? null;
  const resolvedInterior = interior ?? mounts?.interior ?? null;
  const records = new Map();
  const fallbackRecords = new Map();
  let disposed = false;
  let stateApplications = 0;
  let stateView = architectureStateView(state);
  const disposedOwnedInstancedMeshes = new WeakSet();

  function releaseOwnedInstancedMeshes(record) {
    const candidates = Array.isArray(record?.ownedInstancedMeshes)
      ? record.ownedInstancedMeshes
      : (record?.mesh?.isInstancedMesh ? [record.mesh] : []);
    let released = 0;
    for (const mesh of candidates) {
      if (!mesh?.isInstancedMesh || disposedOwnedInstancedMeshes.has(mesh)) continue;
      // InstancedMesh owns only its per-object renderer/instance-buffer state.
      // Geometry, materials, and textures remain cache-owned borrowed resources.
      mesh.dispose?.();
      disposedOwnedInstancedMeshes.add(mesh);
      released += 1;
    }
    return released;
  }

  function buildKit(number, builder) {
    const fallback = fallbackFor(fallbacks, number);
    const originalFallbackVisibility = fallbackVisible(fallback);
    let built = null;
    try {
      const template = validateTemplate(templateFor(templates, number), number);
      built = builder(template);
      if (!built?.root?.parent) fail('ASSEMBLY_FAILED', `Asset ${number} did not mount a derived production root.`);
      try {
        setFallbackVisible(fallback, false);
      } catch (error) {
        built.root.parent?.remove(built.root);
        if (originalFallbackVisibility !== null) {
          try { setFallbackVisible(fallback, originalFallbackVisibility); } catch { /* leave diagnostic below */ }
        }
        throw error;
      }
      records.set(number, {
        ...built,
        number,
        status: 'assembled',
        error: null,
        stateError: null,
      });
      fallbackRecords.set(number, { handle: fallback, original: originalFallbackVisibility, hidden: fallbackVisible(fallback) === false });
    } catch (error) {
      built?.root?.parent?.remove(built.root);
      releaseOwnedInstancedMeshes(built);
      records.set(number, {
        number,
        root: null,
        status: 'fallback',
        error: errorDiagnostic(error),
        stateError: null,
        instanceCount: 0,
        variants: [],
      });
      fallbackRecords.set(number, { handle: fallback, original: originalFallbackVisibility, hidden: false });
    }
  }

  buildKit(55, (template) => {
    const mount = validateMount(resolvedExterior, 'exterior');
    if (!Array.isArray(windowDatums) || windowDatums.length === 0) {
      fail('LAYOUT_MISSING', 'Asset 55 requires stable clubhouse window datums.');
    }
    const placements = windowDatums.map((datum, index) => resolveWindowPlacement(datum, index, layout));
    return createRepeatedKit({ assetNumber: 55, template, mount, placements });
  });

  buildKit(56, (template) => {
    const mount = validateMount(resolvedInterior, 'interior');
    const defaultY = finite(layout?.interiorFloorY, 0);
    const placements = [
      ...placementsFromRuns(layout.wallPanelRuns ?? layout.panelRuns, {
        label: 'wall-panel-run', defaultY, defaultVariant: 'straight',
        moduleLengthMeters: 1.2, runtimeScaleX: template.scale.x,
      }),
      ...explicitPlacements(layout.wallPanels ?? layout.panelPlacements, {
        label: 'wall-panel', defaultY, defaultVariant: 'straight',
      }),
      ...explicitPlacements(layout.panelConnectors, {
        label: 'panel-connector', defaultY, defaultVariant: 'inside_corner',
      }),
    ];
    return createInstancedRepeatedKit({ assetNumber: 56, template, mount, placements });
  });

  buildKit(57, (template) => {
    const mount = validateMount(resolvedInterior, 'interior');
    const defaultY = finite(layout?.interiorFloorY, 0);
    const placements = [
      ...placementsFromRuns(layout.trimRuns ?? layout.baseboardRuns, {
        label: 'trim-run', defaultY, defaultVariant: 'baseboard',
        moduleLengthMeters: 2.4, runtimeScaleX: template.scale.x,
      }),
      ...explicitPlacements(layout.trimPlacements, {
        label: 'trim-placement', defaultY, defaultVariant: 'baseboard',
      }),
    ];
    return createInstancedRepeatedKit({ assetNumber: 57, template, mount, placements });
  });

  buildKit(58, (template) => {
    const mount = validateMount(resolvedInterior, 'interior');
    const defaultY = finite(layout?.ceilingY, 3.2);
    const beamPlacements = [
      ...placementsFromRuns(layout.beamRuns, {
        label: 'ceiling-beam-run', defaultY, defaultVariant: 'straight',
        moduleLengthMeters: 3.6, runtimeScaleX: template.scale.x,
      }),
      ...explicitPlacements(layout.beamPlacements, {
        label: 'ceiling-beam', defaultY, defaultVariant: 'straight',
      }),
    ];
    const ceilingPanels = [
      ...placementsFromRuns(layout.ceilingPanelRuns, {
        label: 'ceiling-panel-run', defaultY, defaultVariant: 'ceiling_panel',
        moduleLengthMeters: 1.8, runtimeScaleX: template.scale.x,
      }),
      ...explicitPlacements(layout.ceilingPanels ?? layout.ceilingPanelPlacements, {
        label: 'ceiling-panel', defaultY, defaultVariant: 'ceiling_panel',
      }),
    ];
    const placements = [...beamPlacements, ...ceilingPanels];
    return createInstancedRepeatedKit({
      assetNumber: 58,
      template,
      mount,
      placements,
      requireKinds: {
        'beam placement': (placement) => placement.variant !== 'ceiling_panel',
        'ceiling-panel placement': (placement) => placement.variant === 'ceiling_panel',
      },
    });
  });

  buildKit(59, (template) => createFloorKit({
    template,
    mount: validateMount(resolvedInterior, 'interior'),
    layout,
    stateView,
  }));

  buildKit(60, (template) => createDamageKit({
    template,
    mount: validateMount(resolvedInterior, 'interior'),
    layout,
    stateView,
    floorRecord: records.get(59)?.status === 'assembled' ? records.get(59) : null,
  }));

  function applyState(nextState) {
    if (disposed) return Object.freeze({ applied: 0, failed: 0, disposed: true, rebuilt: 0 });
    stateApplications += 1;
    stateView = architectureStateView(nextState);
    let applied = 0;
    let failed = 0;
    for (const number of KIT_NUMBERS) {
      const record = records.get(number);
      if (record?.status !== 'assembled') continue;
      try {
        if (number === 55) updateWindows(record, stateView);
        if (number === 56) {
          updateKitMetadata(record, 'panels', stateView);
          setDamageOverlayVisibility(record.root, !stateView.components.panels.restored);
        }
        if (number === 57) updateKitMetadata(record, 'trim', stateView);
        if (number === 58) updateKitMetadata(record, 'ceiling', stateView);
        if (number === 59) updateFloor(record, stateView);
        if (number === 60) updateDamage(record, stateView);
        record.stateError = null;
        applied += 1;
      } catch (error) {
        record.stateError = errorDiagnostic(error);
        failed += 1;
      }
    }
    return Object.freeze({ applied, failed, disposed: false, rebuilt: 0 });
  }

  // Initial state application deliberately uses the same read-only refresh
  // path as later save/load updates. No component ever writes through `state`.
  applyState(state);

  function diagnostics() {
    const kits = KIT_NUMBERS.map((number) => {
      const record = records.get(number);
      const fallback = fallbackRecords.get(number);
      return Object.freeze({
        assetNumber: number,
        status: record?.status || 'fallback',
        instanceCount: record?.instanceCount || 0,
        variants: Object.freeze([...(record?.variants || [])]),
        fallbackHidden: fallback?.handle ? fallbackVisible(fallback.handle) === false : null,
        error: record?.error || null,
        stateError: record?.stateError || null,
      });
    });
    const successful = kits.filter((kit) => kit.status === 'assembled');
    const floor = records.get(59);
    const damage = records.get(60);
    return Object.freeze({
      lifecycle: disposed ? 'disposed' : 'active',
      stateAuthority: 'state.shop.reno.architecture',
      stateApplications,
      assembledKitCount: successful.length,
      fallbackKitCount: kits.length - successful.length,
      instanceCount: successful.reduce((sum, kit) => sum + kit.instanceCount, 0),
      parkedTemplateSamples: 0,
      glbCollisionObjectsActivated: 0,
      scalePolicy: 'ONE_METERS_TO_GAME_UNITS_FRAME_PER_DERIVED_INSTANCE',
      floor: Object.freeze({
        instanceCount: floor?.instanceCount || 0,
        selectedVariant: floor?.selectedVariant || null,
        damageInstanceCount: damage?.instanceCount || 0,
        damageVariant: damage?.selectedVariant || null,
        damageVisible: damage?.root?.visible ?? false,
        surfaceY: Number.isFinite(floor?.surfaceY) ? floor.surfaceY : null,
      }),
      kits: Object.freeze(kits),
    });
  }

  function dispose() {
    if (disposed) {
      return Object.freeze({ alreadyDisposed: true, removedRoots: 0, restoredFallbacks: 0, disposedResources: 0 });
    }
    disposed = true;
    let removedRoots = 0;
    let restoredFallbacks = 0;
    let disposedResources = 0;
    for (const number of KIT_NUMBERS) {
      const record = records.get(number);
      if (record?.root?.parent) {
        record.root.parent.remove(record.root);
        removedRoots += 1;
      }
      disposedResources += releaseOwnedInstancedMeshes(record);
      const fallback = fallbackRecords.get(number);
      if (record?.status === 'assembled' && fallback?.handle && fallback.original !== null) {
        try {
          setFallbackVisible(fallback.handle, fallback.original);
          restoredFallbacks += 1;
        } catch {
          // Teardown remains idempotent and must not dispose borrowed resources.
        }
      }
    }
    return Object.freeze({ alreadyDisposed: false, removedRoots, restoredFallbacks, disposedResources });
  }

  return Object.freeze({
    getRoot(number) {
      if (disposed) return null;
      return records.get(Number(number))?.root || null;
    },
    diagnostics,
    applyState,
    refreshState: applyState,
    dispose,
  });
}

export default createSheet06ProductionAssembly;
