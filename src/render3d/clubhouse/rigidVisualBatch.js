import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const AUTHORING_ONLY = /^(?:COL_|COLLISION_|VOLUME_)/i;

function materialHasTexture(material) {
  return Object.values(material || {}).some((value) => value?.isTexture);
}

function materialDescriptor(material) {
  if (!material?.isMeshStandardMaterial || material.visible === false
      || materialHasTexture(material) || material.transparent
      || Number(material.opacity) < 1 || Number(material.transmission) > 0
      || Number(material.alphaTest) > 0 || material.alphaHash
      || material.alphaToCoverage || material.vertexColors
      || material.clippingPlanes?.length) return null;
  const emissive = material.emissive?.getHex?.() || 0;
  if (emissive && Number(material.emissiveIntensity) > 0) return null;
  const metal = Number(material.metalness) >= 0.45;
  const smooth = Number(material.roughness) < 0.55;
  return {
    key: JSON.stringify({
      type: material.type,
      metal,
      smooth,
      side: material.side,
      depthTest: material.depthTest !== false,
      depthWrite: material.depthWrite !== false,
      colorWrite: material.colorWrite !== false,
      flatShading: !!material.flatShading,
      toneMapped: material.toneMapped !== false,
      fog: material.fog !== false,
    }),
    metalness: metal ? 0.72 : 0,
    roughness: metal ? (smooth ? 0.32 : 0.58) : (smooth ? 0.48 : 0.82),
  };
}

function fullGeometryDraw(geometry) {
  const position = geometry?.getAttribute?.('position');
  if (!position || position.isInterleavedBufferAttribute) return false;
  if (Object.values(geometry.attributes || {}).some((attribute) => (
    attribute.isInterleavedBufferAttribute
  ))) return false;
  if (Object.values(geometry.morphAttributes || {}).some((entries) => entries?.length)) return false;
  const available = geometry.index?.count ?? position.count;
  const start = Number(geometry.drawRange?.start) || 0;
  const count = geometry.drawRange?.count;
  return start === 0 && (!Number.isFinite(count) || count >= available);
}

function geometryWithVertexColor(source, transform) {
  let geometry = source.geometry.clone();
  geometry.applyMatrix4(transform);
  for (const name of Object.keys(geometry.attributes || {})) {
    if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
  }
  if (geometry.index) {
    const indexed = geometry;
    geometry = indexed.toNonIndexed();
    indexed.dispose();
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const vertices = geometry.getAttribute('position')?.count || 0;
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertices * 2), 2));
  }
  const color = source.material.color || new THREE.Color(0xffffff);
  const colors = new Float32Array(vertices * 3);
  for (let index = 0; index < vertices; index += 1) {
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function candidateMesh(object, excludedNames) {
  if (!object?.isMesh || !object.geometry || !object.material
      || Array.isArray(object.material) || object.isSkinnedMesh || object.isInstancedMesh
      || object.customDepthMaterial || object.customDistanceMaterial
      || excludedNames.has(object.name) || AUTHORING_ONLY.test(String(object.name || ''))
      || !fullGeometryDraw(object.geometry)) return false;
  const data = object.userData || {};
  if (data.helper || data.collision_proxy || data.dynamic || data.animated || data.do_not_batch) {
    return false;
  }
  return !!materialDescriptor(object.material);
}

/**
 * Collapse rigid, untextured PBR pieces by a small set of stylized material
 * responses. Exact authored colours move to vertex attributes, while textured,
 * emissive, animated and explicitly excluded meshes stay live in the original
 * hierarchy. Named sockets and children are never removed.
 */
export function batchRigidVisualsByPbrResponse(parent, roots, {
  name = 'RigidVisualPbrBatch',
  excludeNames = [],
} = {}) {
  if (!parent?.add || !parent?.updateWorldMatrix) return null;
  const sourceRoots = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
  if (!sourceRoots.length) return null;
  const excluded = new Set(excludeNames);
  parent.updateWorldMatrix(true, true);
  const inverseParent = parent.matrixWorld.clone().invert();
  const candidates = [];
  for (const root of sourceRoots) {
    root.traverseVisible((object) => {
      if (!candidateMesh(object, excluded) || object.layers.mask === 0) return;
      const determinant = object.matrixWorld.determinant();
      if (!object.matrixWorld.elements.every(Number.isFinite)
          || !Number.isFinite(determinant) || determinant <= 1e-12) return;
      candidates.push(object);
    });
  }
  if (candidates.length < 2) return null;

  const buckets = new Map();
  for (const source of candidates) {
    const descriptor = materialDescriptor(source.material);
    const key = [
      descriptor.key,
      source.castShadow ? 1 : 0,
      source.receiveShadow ? 1 : 0,
      source.layers.mask,
      source.renderOrder || 0,
      source.frustumCulled ? 1 : 0,
    ].join('::');
    let bucket = buckets.get(key);
    if (!bucket) {
      const material = source.material.clone();
      material.name = `${name}_${buckets.size + 1}`;
      material.color.setHex(0xffffff);
      material.vertexColors = true;
      material.metalness = descriptor.metalness;
      material.roughness = descriptor.roughness;
      bucket = {
        material,
        geometries: [],
        castShadow: source.castShadow,
        receiveShadow: source.receiveShadow,
        layers: source.layers.mask,
        renderOrder: source.renderOrder || 0,
        frustumCulled: source.frustumCulled,
      };
      buckets.set(key, bucket);
    }
    bucket.geometries.push(geometryWithVertexColor(
      source,
      inverseParent.clone().multiply(source.matrixWorld),
    ));
  }

  const batchRoot = new THREE.Group();
  batchRoot.name = name;
  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  for (const bucket of buckets.values()) {
    let geometry = null;
    try {
      geometry = bucket.geometries.length === 1
        ? bucket.geometries[0]
        : mergeGeometries(bucket.geometries, false);
    } catch (_) {
      geometry = null;
    }
    if (!geometry) {
      for (const entry of bucket.geometries) entry.dispose();
      bucket.material.dispose();
      continue;
    }
    for (const entry of bucket.geometries) if (entry !== geometry) entry.dispose();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.name = `${name}_Draw_${batchRoot.children.length + 1}`;
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.layers.mask = bucket.layers;
    mesh.renderOrder = bucket.renderOrder;
    mesh.frustumCulled = bucket.frustumCulled;
    mesh.userData.rigidVisualPbrBatch = true;
    batchRoot.add(mesh);
    ownedGeometries.add(geometry);
    ownedMaterials.add(bucket.material);
  }
  if (!batchRoot.children.length || batchRoot.children.length >= candidates.length) {
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
    return null;
  }

  const sourceLayers = candidates.map((source) => ({ source, mask: source.layers.mask }));
  for (const { source } of sourceLayers) {
    source.layers.mask = 0;
    source.userData.rigidVisualBatchSuppressed = true;
  }
  batchRoot.userData.rigidVisualPbrBatch = true;
  parent.add(batchRoot);
  const diagnostics = Object.freeze({
    sourceDrawCalls: candidates.length,
    batchDrawCalls: batchRoot.children.length,
    drawCallsSaved: candidates.length - batchRoot.children.length,
    excludedNames: Object.freeze([...excluded]),
  });
  parent.userData.rigidVisualBatchDiagnostics = diagnostics;
  let disposed = false;
  return {
    root: batchRoot,
    diagnostics,
    dispose({ restoreSources = true } = {}) {
      if (disposed) return false;
      disposed = true;
      batchRoot.removeFromParent();
      if (restoreSources) {
        for (const { source, mask } of sourceLayers) {
          source.layers.mask = mask;
          delete source.userData.rigidVisualBatchSuppressed;
        }
      }
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      return true;
    },
  };
}

