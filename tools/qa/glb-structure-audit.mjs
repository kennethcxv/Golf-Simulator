import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

export function round(value, places = 5) {
  return Number.isFinite(value) ? Number(value.toFixed(places)) : null;
}

export function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function dimensionsText(value) {
  if (!value) return 'missing';
  return Object.entries(value)
    .map(([key, number]) => `${key}=${number == null ? '?' : number}`)
    .join(', ');
}

function parseGlb(buffer) {
  if (buffer.length < 12 || buffer.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('Invalid GLB header');
  }
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength !== buffer.length) {
    throw new Error(`Declared GLB length ${declaredLength} does not match ${buffer.length}`);
  }
  let json = null;
  let bin = Buffer.alloc(0);
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > buffer.length) throw new Error('GLB chunk exceeds file length');
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(buffer.subarray(start, end).toString('utf8').replace(/\0+$/g, '').trim());
    } else if (chunkType === 0x004e4942) {
      bin = buffer.subarray(start, end);
    }
    offset = end + ((4 - (end % 4)) % 4);
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { version, declaredLength, json, bin };
}

function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    offset += length;
  }
  return null;
}

function webpSize(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return [width, height];
  }
  return null;
}

function imageBytes(image, json, bin, glbDirectory) {
  if (Number.isInteger(image.bufferView)) {
    const view = (json.bufferViews || [])[image.bufferView];
    if (!view) return { bytes: null, missing: 'missing bufferView' };
    const start = view.byteOffset || 0;
    return { bytes: bin.subarray(start, start + (view.byteLength || 0)), missing: null };
  }
  if (typeof image.uri === 'string' && image.uri.startsWith('data:')) {
    const comma = image.uri.indexOf(',');
    if (comma < 0) return { bytes: null, missing: 'malformed data URI' };
    return { bytes: Buffer.from(image.uri.slice(comma + 1), 'base64'), missing: null };
  }
  if (typeof image.uri === 'string') {
    const external = path.resolve(glbDirectory, image.uri);
    return existsSync(external)
      ? { bytes: readFileSync(external), missing: null }
      : { bytes: null, missing: `missing external image ${image.uri}` };
  }
  return { bytes: null, missing: 'image has no bufferView or URI' };
}

function localMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return new Matrix4().fromArray(node.matrix);
  const translation = new Vector3().fromArray(node.translation || [0, 0, 0]);
  const rotation = new Quaternion().fromArray(node.rotation || [0, 0, 0, 1]);
  const scale = new Vector3().fromArray(node.scale || [1, 1, 1]);
  return new Matrix4().compose(translation, rotation, scale);
}

function accessorBounds(accessor) {
  if (!Array.isArray(accessor?.min) || !Array.isArray(accessor?.max)
    || accessor.min.length < 3 || accessor.max.length < 3) return null;
  return new Box3(
    new Vector3(accessor.min[0], accessor.min[1], accessor.min[2]),
    new Vector3(accessor.max[0], accessor.max[1], accessor.max[2]),
  );
}

function triangleCount(mode, count) {
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

function transformBox(source, matrix) {
  const target = new Box3().makeEmpty();
  for (const x of [source.min.x, source.max.x]) {
    for (const y of [source.min.y, source.max.y]) {
      for (const z of [source.min.z, source.max.z]) {
        target.expandByPoint(new Vector3(x, y, z).applyMatrix4(matrix));
      }
    }
  }
  return target;
}

function countDuplicateNames(items, fallback) {
  const counts = new Map();
  items.forEach((item, index) => {
    const name = item.name || `${fallback}_${index}`;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));
}

function intendedMaximum(dimensions) {
  return Math.max(0, ...Object.values(dimensions || {}).filter(Number.isFinite));
}

export function auditGlbFile({
  root,
  glbPath,
  sourcePath,
  intendedDimensions = {},
  collisionExpected = false,
  requiredSockets = [],
  requiredAnimations = [],
  budgets = {},
}) {
  const glbAbsolute = glbPath ? path.resolve(root, glbPath) : null;
  const sourceAbsolute = sourcePath ? path.resolve(root, sourcePath) : null;
  const base = {
    path: glbPath || null,
    sourcePath: sourcePath || null,
    exists: !!glbAbsolute && existsSync(glbAbsolute),
    sourceExists: !!sourceAbsolute && existsSync(sourceAbsolute),
    error: null,
  };
  if (!base.exists) {
    return {
      ...base,
      requiredSockets,
      missingRequiredSockets: [...requiredSockets],
      requiredAnimations,
      missingRequiredAnimations: [...requiredAnimations],
      budgetViolations: [],
      flags: ['MISSING_RUNTIME_GLB', ...(base.sourceExists ? [] : ['MISSING_BLENDER_SOURCE'])],
    };
  }

  try {
    const bytes = readFileSync(glbAbsolute);
    const { version, declaredLength, json, bin } = parseGlb(bytes);
    const accessors = json.accessors || [];
    const meshes = json.meshes || [];
    const nodes = json.nodes || [];
    const materials = json.materials || [];
    const images = json.images || [];
    const textures = json.textures || [];
    const animations = json.animations || [];
    let vertices = 0;
    let triangles = 0;
    let primitiveCount = 0;
    let morphTargets = 0;
    for (const mesh of meshes) {
      for (const primitive of mesh.primitives || []) {
        primitiveCount += 1;
        const position = accessors[primitive.attributes?.POSITION];
        if (position) vertices += position.count || 0;
        const counted = Number.isInteger(primitive.indices) ? accessors[primitive.indices] : position;
        triangles += triangleCount(primitive.mode ?? 4, counted?.count || 0);
        morphTargets += (primitive.targets || []).length;
      }
    }

    const parent = new Array(nodes.length).fill(-1);
    nodes.forEach((node, index) => {
      for (const child of node.children || []) parent[child] = index;
    });
    const worldCache = new Map();
    function worldMatrix(index) {
      if (worldCache.has(index)) return worldCache.get(index);
      const own = localMatrix(nodes[index] || {});
      const result = parent[index] >= 0 ? worldMatrix(parent[index]).clone().multiply(own) : own;
      worldCache.set(index, result);
      return result;
    }

    const nodeNames = nodes.map((node, index) => node.name || `Node_${index}`);
    const bounds = new Box3().makeEmpty();
    const suspiciousTransforms = [];
    const hiddenNodes = [];
    const genericNames = [];
    const meshCentres = [];
    nodes.forEach((node, index) => {
      const name = nodeNames[index];
      if (node.extras?.visible === false || node.extras?.hidden === true || /^HIDDEN[_-]/i.test(name)) {
        hiddenNodes.push(name);
      }
      if (/^(Cube|Cylinder|Sphere|Plane|Cone|Torus|BezierCurve|Material)(\.\d+)?$/i.test(name)) {
        genericNames.push(name);
      }
      if (!Number.isInteger(node.mesh)) return;
      const scale = node.scale || [1, 1, 1];
      if (scale.some((value) => !Number.isFinite(value) || Math.abs(value - 1) > 0.001)) {
        suspiciousTransforms.push({ node: name, scale });
      }
      const nodeBox = new Box3().makeEmpty();
      for (const primitive of meshes[node.mesh]?.primitives || []) {
        const primitiveBox = accessorBounds(accessors[primitive.attributes?.POSITION]);
        if (primitiveBox) nodeBox.union(transformBox(primitiveBox, worldMatrix(index)));
      }
      if (!nodeBox.isEmpty()) {
        bounds.union(nodeBox);
        const centre = nodeBox.getCenter(new Vector3());
        meshCentres.push({ node: name, offset: centre.length() });
      }
    });
    if (bounds.isEmpty()) bounds.set(new Vector3(), new Vector3());
    const size = bounds.getSize(new Vector3());
    const centre = bounds.getCenter(new Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    const farMeshes = meshCentres
      .filter((entry) => entry.offset > Math.max(12, intendedMaximum(intendedDimensions) * 3))
      .map((entry) => ({ node: entry.node, offset: round(entry.offset) }));

    const duplicateMaterialNames = countDuplicateNames(materials, 'Material');
    const duplicateNodeNames = countDuplicateNames(nodes, 'Node');
    const transparentMaterials = materials.filter((material) => material.alphaMode === 'BLEND'
      || (material.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1) < 1).length;
    const doubleSidedMaterials = materials.filter((material) => material.doubleSided === true).length;
    const missingTextureReferences = [];
    textures.forEach((texture, index) => {
      if (!Number.isInteger(texture.source) || !images[texture.source]) {
        missingTextureReferences.push(`texture ${texture.name || index} has invalid image source`);
      }
      if (texture.sampler != null && !(json.samplers || [])[texture.sampler]) {
        missingTextureReferences.push(`texture ${texture.name || index} has invalid sampler`);
      }
    });
    const textureDimensions = images.map((entry, index) => {
      const found = imageBytes(entry, json, bin, path.dirname(glbAbsolute));
      if (found.missing) missingTextureReferences.push(`image ${entry.name || index}: ${found.missing}`);
      const dimensions = found.bytes
        ? (pngSize(found.bytes) || jpegSize(found.bytes) || webpSize(found.bytes))
        : null;
      return {
        image: entry.name || `Image_${index}`,
        mimeType: entry.mimeType || null,
        width: dimensions?.[0] ?? null,
        height: dimensions?.[1] ?? null,
        embedded: Number.isInteger(entry.bufferView) || String(entry.uri || '').startsWith('data:'),
      };
    });

    const collisionNodes = nodeNames.filter((name) => /^(COL|UCX|UBX|USP|UCP)[_-]/i.test(name));
    const socketNodes = nodeNames.filter((name) => /(^SOCKET[_-]|[_-]SOCKET[_-]|^ANCHOR[_-]|^SLOT[_-]|[_-]SLOT[_-])/i.test(name));
    const lodNodes = nodeNames.filter((name) => /(^LOD[0-9][_-]|[_-]LOD[0-9]$)/i.test(name));
    const animationNames = animations.map((animation, index) => animation.name || `Animation_${index}`);
    const normalizedNodes = new Set(nodeNames.map((name) => name.toUpperCase()));
    const normalizedAnimations = new Set(animationNames.map((name) => name.toUpperCase()));
    const missingRequiredSockets = requiredSockets.filter((name) => !normalizedNodes.has(name.toUpperCase()));
    const missingRequiredAnimations = requiredAnimations.filter((name) => !normalizedAnimations.has(name.toUpperCase()));

    const budgetViolations = [];
    if (Number.isFinite(budgets.triangleBudget) && triangles > budgets.triangleBudget) {
      budgetViolations.push({ metric: 'triangles', actual: triangles, budget: budgets.triangleBudget });
    }
    if (Number.isFinite(budgets.meshBudget) && meshes.length > budgets.meshBudget) {
      budgetViolations.push({ metric: 'meshes', actual: meshes.length, budget: budgets.meshBudget });
    }
    if (Number.isFinite(budgets.materialBudget) && materials.length > budgets.materialBudget) {
      budgetViolations.push({ metric: 'materials', actual: materials.length, budget: budgets.materialBudget });
    }
    if (Number.isFinite(budgets.textureBudget) && textures.length > budgets.textureBudget) {
      budgetViolations.push({ metric: 'textures', actual: textures.length, budget: budgets.textureBudget });
    }
    if (Number.isFinite(budgets.maxTextureSize)) {
      const oversized = textureDimensions.filter((entry) => (entry.width || 0) > budgets.maxTextureSize
        || (entry.height || 0) > budgets.maxTextureSize);
      if (oversized.length) {
        budgetViolations.push({ metric: 'textureDimensions', actual: oversized, budget: budgets.maxTextureSize });
      }
    }

    const flags = [];
    if (!base.sourceExists) flags.push('MISSING_BLENDER_SOURCE');
    if ((json.cameras || []).length) flags.push('EXPORTED_CAMERA');
    const lights = json.extensions?.KHR_lights_punctual?.lights?.length || 0;
    if (lights) flags.push('EXPORTED_LIGHT');
    if (missingTextureReferences.length) flags.push('MISSING_TEXTURE_REFERENCE');
    if (duplicateMaterialNames.length) flags.push('DUPLICATE_MATERIAL_NAMES');
    if (duplicateNodeNames.length) flags.push('DUPLICATE_NODE_NAMES');
    if (genericNames.length) flags.push('GENERIC_NODE_NAMES');
    if (farMeshes.length) flags.push('MESH_FAR_FROM_ORIGIN');
    const targetMaximum = intendedMaximum(intendedDimensions);
    if (targetMaximum > 0 && maxDimension > targetMaximum * 1.75) flags.push('OVERSIZED_BOUNDS');
    if (collisionExpected && !collisionNodes.length) flags.push('MISSING_EXPECTED_COLLISION');
    if (missingRequiredSockets.length) flags.push('MISSING_REQUIRED_SOCKET');
    if (missingRequiredAnimations.length) flags.push('MISSING_REQUIRED_ANIMATION');
    if (suspiciousTransforms.length) flags.push('SUSPICIOUS_MESH_TRANSFORMS');
    if (budgetViolations.length) flags.push('BUDGET_VIOLATION');

    const rootIndices = json.scenes?.[json.scene || 0]?.nodes || [];
    return {
      ...base,
      fileSizeBytes: bytes.length,
      fileSizeKiB: round(bytes.length / 1024, 1),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      glbVersion: version,
      declaredLength,
      nodeCount: nodes.length,
      meshCount: meshes.length,
      primitiveCount,
      vertexCount: vertices,
      triangleCount: triangles,
      materialCount: materials.length,
      textureCount: textures.length,
      imageCount: images.length,
      textureDimensions,
      animationCount: animations.length,
      animationNames,
      cameraCount: (json.cameras || []).length,
      lightCount: lights,
      transparentMaterialCount: transparentMaterials,
      doubleSidedMaterialCount: doubleSidedMaterials,
      skinCount: (json.skins || []).length,
      skeletonCount: (json.skins || []).length,
      morphTargetCount: morphTargets,
      hiddenNodes,
      duplicateMaterialNames,
      duplicateNodeNames,
      genericNames,
      suspiciousTransforms,
      farMeshes,
      missingTextureReferences,
      bounds: {
        min: bounds.min.toArray().map((value) => round(value)),
        max: bounds.max.toArray().map((value) => round(value)),
        centre: centre.toArray().map((value) => round(value)),
        dimensions: { x: round(size.x), y: round(size.y), z: round(size.z) },
        maxDimension: round(maxDimension),
        centreOffset: round(centre.length()),
        floorContactY: round(bounds.min.y),
      },
      origin: [0, 0, 0],
      rootNodeNames: rootIndices.map((index) => nodeNames[index]),
      rootTransforms: rootIndices.map((index) => ({
        node: nodeNames[index],
        translation: nodes[index]?.translation || [0, 0, 0],
        rotation: nodes[index]?.rotation || [0, 0, 0, 1],
        scale: nodes[index]?.scale || [1, 1, 1],
      })),
      collisionNodes,
      socketNodes,
      lodNodes,
      requiredSockets,
      missingRequiredSockets,
      requiredAnimations,
      missingRequiredAnimations,
      budgetViolations,
      flags,
    };
  } catch (error) {
    return {
      ...base,
      error: error.message,
      requiredSockets,
      missingRequiredSockets: [...requiredSockets],
      requiredAnimations,
      missingRequiredAnimations: [...requiredAnimations],
      budgetViolations: [],
      flags: ['UNREADABLE_GLB'],
    };
  }
}
