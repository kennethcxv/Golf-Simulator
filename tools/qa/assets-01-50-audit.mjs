// Cross-sheet GLB auditor + manifest generator for the authoritative 50 assets.
// Run from the repository root:
//   node tools/qa/assets-01-50-audit.mjs

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { ASSETS, SHEETS } from './assets-01-50-spec.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'qa', 'assets_01_50_master');
const BASELINE_RESULT = 'qa/assets_01_50_master/baseline/current/baseline-result.json';
mkdirSync(OUT, { recursive: true });

function posix(value) {
  return value.split(path.sep).join('/');
}

function round(value, places = 5) {
  return Number.isFinite(value) ? Number(value.toFixed(places)) : null;
}

function parseGlb(buffer) {
  if (buffer.length < 12 || buffer.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('Invalid GLB header');
  }
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
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
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return new Matrix4().fromArray(node.matrix);
  }
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

function intendedMaximum(spec) {
  return Math.max(...Object.values(spec.intendedDimensions).filter(Number.isFinite));
}

function auditAsset(spec) {
  const glbAbsolute = path.resolve(ROOT, spec.runtimeGlb);
  const sourceAbsolute = path.resolve(ROOT, spec.source);
  const base = {
    assetNumber: spec.assetNumber,
    referenceName: spec.referenceName,
    path: spec.runtimeGlb,
    sourcePath: spec.source,
    exists: existsSync(glbAbsolute),
    sourceExists: existsSync(sourceAbsolute),
    error: null,
  };
  if (!base.exists) {
    return {
      ...base,
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
    let vertices = 0;
    let triangles = 0;
    let primitiveCount = 0;
    let morphTargets = 0;
    for (const mesh of meshes) {
      for (const primitive of mesh.primitives || []) {
        primitiveCount += 1;
        const position = accessors[primitive.attributes?.POSITION];
        if (position) vertices += position.count || 0;
        const countAccessor = Number.isInteger(primitive.indices) ? accessors[primitive.indices] : position;
        triangles += triangleCount(primitive.mode ?? 4, countAccessor?.count || 0);
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

    const bounds = new Box3().makeEmpty();
    const meshCentres = [];
    const suspiciousTransforms = [];
    const hiddenNodes = [];
    const nodeNames = nodes.map((node, index) => node.name || `Node_${index}`);
    nodes.forEach((node, index) => {
      const name = nodeNames[index];
      if (node.extras?.visible === false || node.extras?.hidden === true || /^HIDDEN[_-]/i.test(name)) {
        hiddenNodes.push(name);
      }
      if (Number.isInteger(node.mesh)) {
        const scale = node.scale || [1, 1, 1];
        if (scale.some((value) => !Number.isFinite(value) || Math.abs(value - 1) > 0.001)) {
          suspiciousTransforms.push({ node: name, scale });
        }
        const nodeBox = new Box3().makeEmpty();
        for (const primitive of meshes[node.mesh]?.primitives || []) {
          const box = accessorBounds(accessors[primitive.attributes?.POSITION]);
          if (box) nodeBox.union(transformBox(box, worldMatrix(index)));
        }
        if (!nodeBox.isEmpty()) {
          bounds.union(nodeBox);
          const centre = nodeBox.getCenter(new Vector3());
          meshCentres.push({ node: name, offset: centre.length() });
        }
      }
    });
    if (bounds.isEmpty()) bounds.set(new Vector3(), new Vector3());
    const size = bounds.getSize(new Vector3());
    const centre = bounds.getCenter(new Vector3());
    const farMeshes = meshCentres.filter((entry) => entry.offset > 12)
      .map((entry) => ({ node: entry.node, offset: round(entry.offset) }));

    const duplicateMaterialNames = Object.entries(materials.reduce((counts, material, index) => {
      const name = material.name || `Material_${index}`;
      counts[name] = (counts[name] || 0) + 1;
      return counts;
    }, {})).filter(([, count]) => count > 1).map(([name, count]) => ({ name, count }));
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

    const collisionNodes = nodeNames.filter((name) => /^COL[_-]/i.test(name));
    const socketNodes = nodeNames.filter((name) => /(SOCKET|_SLOT_|^SLOT_|^ANCHOR_|_MOUNT$|_PLACEMENT$|_AREA$)/i.test(name));
    const stockingSockets = socketNodes.filter((name) => /(STOCK|SHELF|HANGER|HOOK|PEG|DISPLAY|TABLE|BAG_|SHOE|BALL|SNACK|DRINK|RF_|CLUB|PUTTER|APPAREL|GONDOLA|TOTE)/i.test(name));
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetMax = intendedMaximum(spec);
    const flags = [];
    if (!base.sourceExists) flags.push('MISSING_BLENDER_SOURCE');
    if ((json.cameras || []).length) flags.push('EXPORTED_CAMERA');
    const lights = json.extensions?.KHR_lights_punctual?.lights?.length || 0;
    if (lights) flags.push('EXPORTED_LIGHT');
    if (missingTextureReferences.length) flags.push('MISSING_TEXTURE_REFERENCE');
    if (duplicateMaterialNames.length) flags.push('DUPLICATE_MATERIAL_NAMES');
    if (farMeshes.length) flags.push('MESH_FAR_FROM_ORIGIN');
    if (maxDim > Math.max(16, targetMax * 1.75)) flags.push('OVERSIZED_BOUNDS');
    if (spec.collisionExpected && !collisionNodes.length) flags.push('MISSING_EXPECTED_COLLISION');
    if (spec.socketExpected && !socketNodes.length) flags.push('MISSING_EXPECTED_SOCKET');
    if (triangles > Number(spec.referencePolygonNote.replace(/\D/g, '')) * 2.5) flags.push('OVER_REFERENCE_GEOMETRY_REVIEW');
    if (materials.length > 12) flags.push('HIGH_MATERIAL_COUNT');
    if (textures.length > 12) flags.push('HIGH_TEXTURE_COUNT');
    if (suspiciousTransforms.length) flags.push('SUSPICIOUS_MESH_TRANSFORMS');

    return {
      ...base,
      fileSizeBytes: bytes.length,
      fileSizeKiB: round(bytes.length / 1024, 1),
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
      animationCount: (json.animations || []).length,
      cameraCount: (json.cameras || []).length,
      lightCount: lights,
      transparentMaterialCount: transparentMaterials,
      doubleSidedMaterialCount: doubleSidedMaterials,
      skinCount: (json.skins || []).length,
      morphTargetCount: morphTargets,
      hiddenNodes,
      duplicateMaterialNames,
      suspiciousTransforms,
      farMeshes,
      missingTextureReferences,
      bounds: {
        min: bounds.min.toArray().map((value) => round(value)),
        max: bounds.max.toArray().map((value) => round(value)),
        centre: centre.toArray().map((value) => round(value)),
        dimensions: { x: round(size.x), y: round(size.y), z: round(size.z) },
        maxDimension: round(maxDim),
        centreOffset: round(centre.length()),
        floorContactY: round(bounds.min.y),
      },
      origin: [0, 0, 0],
      sceneCount: (json.scenes || []).length,
      rootNodeNames: (json.scenes?.[json.scene || 0]?.nodes || []).map((index) => nodeNames[index]),
      collisionNodes,
      socketNodes,
      stockingSockets,
      flags,
    };
  } catch (error) {
    return { ...base, error: error.message, flags: ['UNREADABLE_GLB'] };
  }
}

const audits = ASSETS.map(auditAsset);
const pathUses = audits.reduce((uses, audit) => {
  if (audit.exists) (uses[audit.path] ||= []).push(audit.assetNumber);
  return uses;
}, {});
for (const audit of audits) {
  const users = pathUses[audit.path] || [];
  if (users.length > 1) {
    audit.sharedRuntimeGlbWithAssets = users.filter((number) => number !== audit.assetNumber);
    if (!audit.flags.includes('SHARED_PRIMARY_GLB')) audit.flags.push('SHARED_PRIMARY_GLB');
  } else audit.sharedRuntimeGlbWithAssets = [];
}

function performanceRisk(spec, audit) {
  if (!audit.exists || audit.error) return 'critical: missing or unreadable primary GLB';
  const reference = Number(spec.referencePolygonNote.replace(/\D/g, '')) || 1;
  if (audit.triangleCount > reference * 3 || audit.materialCount > 12 || audit.textureCount > 12) {
    return 'high: exceeds one or more per-asset review thresholds';
  }
  if (audit.triangleCount > reference * 1.5 || audit.materialCount > 6 || audit.textureCount > 6) {
    return 'medium: profile at maximum expected instance count';
  }
  return 'low: within baseline review thresholds; runtime profiling still required';
}

function requiredAction(spec, audit) {
  if (spec.assetNumber === 16) return 'Build the missing 20-unit coin; replace the erroneous 25-unit denomination in source, export, tests, drawer layout, and runtime.';
  if (spec.assetNumber === 10 && !audit.exists) return 'Build and integrate the distinct 2.4 cm Sheet-1 five-unit hero coin.';
  if (spec.assetNumber === 10) return 'Verify the distinct 2.4 cm bimetallic golfer-reverse coin in the customer tender hand through normal gameplay.';
  if (spec.assetNumber === 18) return 'Retain and verify the independent 2.1 cm Sheet-2 five-unit drawer/change coin.';
  if (!audit.exists || audit.error) return 'Restore/build the missing primary source/export before visual review.';
  return 'Complete individual reference, Blender source, clean-reimport, player-camera, collision, interaction, save/load, and performance review; rebuild if classified B-E.';
}

function missingParts(spec, audit) {
  const parts = [];
  if (spec.missingContract) parts.push(spec.missingContract);
  if (spec.duplicateContract) parts.push(spec.duplicateContract);
  if (!audit.sourceExists) parts.push('Blender source missing.');
  if (!audit.exists) parts.push('Runtime GLB missing.');
  if (spec.collisionExpected && audit.exists && !audit.collisionNodes?.length) parts.push('Expected authored collision proxy not found.');
  if (spec.socketExpected && audit.exists && !audit.socketNodes?.length) parts.push('Expected named placement/interaction socket not found.');
  return parts;
}

const manifestAssets = ASSETS.map((spec, index) => {
  const audit = audits[index];
  const runtimeFilesPresent = spec.runtimeIntegrationFiles.filter((file) => existsSync(path.resolve(ROOT, file)));
  const runtimeFilesMissing = spec.runtimeIntegrationFiles.filter((file) => !existsSync(path.resolve(ROOT, file)));
  return {
    assetNumber: spec.assetNumber,
    referenceSheet: spec.referenceSheet,
    referenceImagePath: spec.referenceImagePath,
    referenceAssetName: spec.referenceName,
    intendedGameplayPurpose: spec.intendedGameplayPurpose,
    currentBlenderSourcePath: spec.source,
    currentCanonicalGlbPath: spec.canonicalGlb,
    currentRuntimeGlbPath: spec.runtimeGlb,
    supportingVariantPaths: spec.supporting,
    runtimeLoaderOrIntegrationFiles: spec.runtimeIntegrationFiles,
    runtimeIntegrationFilesPresent: runtimeFilesPresent,
    runtimeIntegrationFilesMissing: runtimeFilesMissing,
    fixtureOrPlacementLocation: spec.fixtureOrPlacementLocation,
    currentDimensions: audit.bounds?.dimensions || null,
    intendedDimensions: spec.intendedDimensions,
    currentTriangleCount: audit.triangleCount ?? null,
    currentVertexCount: audit.vertexCount ?? null,
    currentMeshCount: audit.meshCount ?? null,
    currentMaterialCount: audit.materialCount ?? null,
    currentTextureCount: audit.textureCount ?? null,
    currentTextureSizes: audit.textureDimensions || [],
    currentFileSizeBytes: audit.fileSizeBytes ?? null,
    collisionType: audit.collisionNodes?.length
      ? `authored named collision proxy (${audit.collisionNodes.length})`
      : (spec.collisionExpected ? 'missing expected authored collision proxy' : 'runtime bounds / no authored collision required'),
    interactionType: spec.interactionType,
    animationRequirements: spec.animationRequirements,
    placementSockets: audit.socketNodes || [],
    stockingSockets: audit.stockingSockets || [],
    currentVisualQuality: 'Unverified classification pending per-asset close-up and reference comparison; cross-sheet runtime baseline captured.',
    currentTechnicalQuality: audit.exists && !audit.error
      ? (audit.flags.length ? `Requires review: ${audit.flags.join(', ')}` : 'Baseline automated audit has no structural flags')
      : `Failed baseline audit: ${audit.flags.join(', ')}`,
    currentIntegrationStatus: audit.exists && runtimeFilesPresent.length > 0 && runtimeFilesMissing.length === 0
      ? 'Primary GLB and declared runtime integration files present; normal-gameplay acceptance pending'
      : `Incomplete: ${[!audit.exists ? 'GLB missing' : null, runtimeFilesMissing.length ? `runtime files missing (${runtimeFilesMissing.join(', ')})` : null].filter(Boolean).join('; ')}`,
    currentPerformanceRisk: performanceRisk(spec, audit),
    missingSupportingParts: missingParts(spec, audit),
    requiredAction: requiredAction(spec, audit),
    initialClassification: 'UNVERIFIED',
    finalStatus: 'PENDING_INDIVIDUAL_PRODUCTION_REVIEW',
    auditFlags: audit.flags,
  };
});

let baseline = null;
if (existsSync(path.resolve(ROOT, BASELINE_RESULT))) {
  baseline = JSON.parse(readFileSync(path.resolve(ROOT, BASELINE_RESULT), 'utf8'));
}
const generatedAt = new Date().toISOString();
const manifest = {
  schemaVersion: 1,
  generatedAt,
  stage: 'BASELINE_DISCOVERY',
  authoritativeAssetCount: 50,
  referenceSheets: Object.entries(SHEETS).map(([sheet, file]) => ({ sheet: Number(sheet), file })),
  baselineEvidence: BASELINE_RESULT,
  baselinePerformance: baseline?.performance || null,
  knownContractGaps: [
    'Asset 16 (20-unit coin) is missing; an out-of-spec 25-unit coin is currently authored/loaded instead.',
    'Sheet 5 and refs 41/42/43/45 production files are currently untracked concurrent work and must not be overwritten.',
  ],
  assets: manifestAssets,
};

const finalAudit = {
  schemaVersion: 1,
  generatedAt,
  auditStage: 'BASELINE_DISCOVERY',
  final: false,
  primaryAssetCount: audits.length,
  presentGlbCount: audits.filter((record) => record.exists).length,
  presentSourceCount: audits.filter((record) => record.sourceExists).length,
  cleanStructuralAuditCount: audits.filter((record) => record.exists && !record.error && record.flags.length === 0).length,
  missingGlbAssets: audits.filter((record) => !record.exists).map((record) => record.assetNumber),
  missingSourceAssets: audits.filter((record) => !record.sourceExists).map((record) => record.assetNumber),
  records: audits,
};

function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function dimensionsText(value) {
  if (!value) return 'missing';
  return Object.entries(value).map(([key, number]) => `${key}=${number == null ? '?' : number}`).join(', ');
}

const manifestLines = [
  '# Assets 01-50 master manifest',
  '',
  `Generated: ${generatedAt}`,
  '',
  `Stage: **baseline discovery**. All 50 records exist, but final A-E classifications remain deliberately unverified until each asset completes the required close-up, clean-reimport, runtime, collision, interaction, save/load, and performance review.`,
  '',
  '## Authoritative reference sheets',
  '',
  '| Sheet | Exact path |',
  '|---:|---|',
  ...Object.entries(SHEETS).map(([sheet, file]) => `| ${sheet} | \`${mdCell(file)}\` |`),
  '',
  '## Blocking contract gaps found during discovery',
  '',
  ...manifest.knownContractGaps.map((gap) => `- ${gap}`),
  '',
  `Baseline: \`${BASELINE_RESULT}\``,
  '',
  '## Primary assets',
  '',
  '| # | Sheet | Reference asset | Source | Runtime GLB | Current dimensions (m) | Tris | Verts | Meshes | Mats / tex | Collision / sockets | Technical baseline | Required action | Final |',
  '|---:|---:|---|---|---|---|---:|---:|---:|---:|---|---|---|---|',
  ...manifestAssets.map((asset) => `| ${asset.assetNumber} | ${asset.referenceSheet} | ${mdCell(asset.referenceAssetName)} | \`${mdCell(asset.currentBlenderSourcePath)}\` | \`${mdCell(asset.currentRuntimeGlbPath)}\` | ${mdCell(dimensionsText(asset.currentDimensions))} | ${asset.currentTriangleCount ?? '—'} | ${asset.currentVertexCount ?? '—'} | ${asset.currentMeshCount ?? '—'} | ${asset.currentMaterialCount ?? '—'} / ${asset.currentTextureCount ?? '—'} | ${mdCell(`${asset.collisionType}; ${asset.placementSockets.length} sockets`)} | ${mdCell(asset.currentTechnicalQuality)} | ${mdCell(asset.requiredAction)} | ${asset.finalStatus} |`),
  '',
];

const auditLines = [
  '# Assets 01-50 automated GLB audit',
  '',
  `Generated: ${generatedAt}`,
  '',
  `Stage: **baseline discovery**, not final acceptance. Present GLBs: ${finalAudit.presentGlbCount}/50. Present Blender sources: ${finalAudit.presentSourceCount}/50. Structurally flag-free records: ${finalAudit.cleanStructuralAuditCount}/50.`,
  '',
  '| # | Asset | GLB | KiB | Nodes | Meshes | Verts | Tris | Mats | Tex | Anim | Cam | Light | Bounds (m) | Collision | Sockets | Flags |',
  '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|',
  ...audits.map((record) => `| ${record.assetNumber} | ${mdCell(record.referenceName)} | \`${mdCell(record.path)}\` | ${record.fileSizeKiB ?? '—'} | ${record.nodeCount ?? '—'} | ${record.meshCount ?? '—'} | ${record.vertexCount ?? '—'} | ${record.triangleCount ?? '—'} | ${record.materialCount ?? '—'} | ${record.textureCount ?? '—'} | ${record.animationCount ?? '—'} | ${record.cameraCount ?? '—'} | ${record.lightCount ?? '—'} | ${mdCell(dimensionsText(record.bounds?.dimensions))} | ${record.collisionNodes?.length ?? '—'} | ${record.socketNodes?.length ?? '—'} | ${mdCell(record.flags.join(', ') || 'none')} |`),
  '',
];

writeFileSync(path.join(OUT, 'asset_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(path.join(OUT, 'asset_manifest.md'), `${manifestLines.join('\n')}\n`);
writeFileSync(path.join(OUT, 'final_asset_audit.json'), `${JSON.stringify(finalAudit, null, 2)}\n`);
writeFileSync(path.join(OUT, 'final_asset_audit.md'), `${auditLines.join('\n')}\n`);

console.log(JSON.stringify({
  ok: finalAudit.presentGlbCount === 50 && finalAudit.presentSourceCount === 50,
  outputDirectory: posix(path.relative(ROOT, OUT)),
  manifestAssets: manifestAssets.length,
  presentGlbs: finalAudit.presentGlbCount,
  presentSources: finalAudit.presentSourceCount,
  cleanStructuralAudits: finalAudit.cleanStructuralAuditCount,
  missingGlbAssets: finalAudit.missingGlbAssets,
  missingSourceAssets: finalAudit.missingSourceAssets,
  totalFileBytes: audits.reduce((sum, record) => sum + (record.fileSizeBytes || 0), 0),
  totalTriangles: audits.reduce((sum, record) => sum + (record.triangleCount || 0), 0),
}, null, 2));
