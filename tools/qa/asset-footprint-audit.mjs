// Deterministic, read-only GLB footprint audit for Golf Flipper.
//
// Default scan:
//   node tools/qa/asset-footprint-audit.mjs --json
// Runtime-only scan:
//   node tools/qa/asset-footprint-audit.mjs --json vendor/models
// Persist JSON and a one-row-per-asset CSV:
//   node tools/qa/asset-footprint-audit.mjs --output report.json --csv report.csv
//
// The scanner uses only Node built-ins. It never rewrites an asset. Hashes and output ordering are
// stable so reports can be diffed in CI. Bounds transform each POSITION accessor's local min/max
// box through the active scene graph; this is a conservative world AABB for rotated geometry.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPORT_SCHEMA_VERSION = 1;
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules']);
const TEXTURE_COMPRESSION_EXTENSIONS = new Set([
  'KHR_texture_basisu',
  'EXT_texture_webp',
  'EXT_texture_avif',
]);
const GEOMETRY_COMPRESSION_EXTENSIONS = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
]);

const COMPONENTS_PER_TYPE = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

const COMPONENT_BYTE_SIZE = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeSlashes(value) {
  return value.split(sep).join('/');
}

function projectPath(filePath, root = process.cwd()) {
  const rel = relative(root, filePath);
  return normalizeSlashes(rel || '.');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    const out = {};
    for (const key of Object.keys(value).sort(compareText)) out[key] = stableValue(value[key]);
    return out;
  }
  return value;
}

function stableStringify(value, space = 0) {
  return JSON.stringify(stableValue(value), null, space);
}

function semanticResource(value) {
  if (Array.isArray(value)) return value.map(semanticResource);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort(compareText)) {
      // Names and extras do not affect rendering/resource identity. Extensions do.
      if (key === 'name' || key === 'extras') continue;
      out[key] = semanticResource(value[key]);
    }
    return out;
  }
  return value;
}

function hashDescriptor(value) {
  return sha256(Buffer.from(stableStringify(semanticResource(value))));
}

function pad4(value) {
  return (value + 3) & ~3;
}

function parseGlb(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('GLB input must be a Buffer');
  if (buffer.length < 12) throw new Error('GLB is shorter than its 12-byte header');
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('bad GLB magic');

  const containerVersion = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength !== buffer.length) {
    throw new Error(`GLB declared length ${declaredLength} does not match ${buffer.length} bytes`);
  }

  let offset = 12;
  let json = null;
  let jsonChunkBytes = 0;
  const binaryChunks = [];
  const chunks = [];
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error(`truncated GLB chunk header at byte ${offset}`);
    const byteLength = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + byteLength;
    if (end > buffer.length) throw new Error(`GLB chunk at byte ${offset} exceeds file length`);
    const data = buffer.subarray(start, end);
    chunks.push({ type, byteLength });
    if (type === JSON_CHUNK) {
      if (json) throw new Error('GLB contains more than one JSON chunk');
      const text = data.toString('utf8').replace(/[\u0000\u0020]+$/u, '');
      json = JSON.parse(text);
      jsonChunkBytes = byteLength;
    } else if (type === BIN_CHUNK) {
      binaryChunks.push(data);
    }
    offset = end;
  }
  if (!json) throw new Error('GLB has no JSON chunk');

  return {
    json,
    containerVersion,
    declaredLength,
    jsonChunkBytes,
    binaryChunks,
    chunks,
  };
}

function decodeDataUri(uri) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/su.exec(uri);
  if (!match) return null;
  const mimeType = match[1] || null;
  const bytes = match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  return { bytes, mimeType };
}

function safeExternalPath(baseDir, uri) {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(uri)) return null;
  const clean = decodeURIComponent(uri.split(/[?#]/u, 1)[0]);
  return resolve(baseDir, clean);
}

function loadGlbBuffers(parsed, filePath, warnings) {
  const baseDir = filePath ? dirname(filePath) : process.cwd();
  const definitions = parsed.json.buffers || [];
  const out = [];
  let embeddedIndex = 0;

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    let bytes = null;
    if (!definition.uri) {
      bytes = parsed.binaryChunks[embeddedIndex] || null;
      embeddedIndex += 1;
    } else if (definition.uri.startsWith('data:')) {
      bytes = decodeDataUri(definition.uri)?.bytes || null;
    } else {
      const externalPath = safeExternalPath(baseDir, definition.uri);
      if (externalPath && existsSync(externalPath)) bytes = readFileSync(externalPath);
      else warnings.push(`buffer ${index} has unavailable external URI ${definition.uri}`);
    }

    if (bytes && Number.isInteger(definition.byteLength) && bytes.length < definition.byteLength) {
      warnings.push(`buffer ${index} provides ${bytes.length} bytes but declares ${definition.byteLength}`);
    }
    out.push(bytes);
  }

  // A valid GLB normally declares buffer 0. Retain its BIN chunk for useful diagnostics if it does not.
  if (out.length === 0 && parsed.binaryChunks.length) out.push(parsed.binaryChunks[0]);
  return out;
}

function bufferViewBytes(json, buffers, index) {
  const view = json.bufferViews?.[index];
  if (!view) return null;
  const source = buffers[view.buffer];
  if (!source) return null;
  const start = view.byteOffset || 0;
  const end = start + view.byteLength;
  if (start < 0 || end > source.length) return null;
  return source.subarray(start, end);
}

function align(value, multiple) {
  return Math.ceil(value / multiple) * multiple;
}

function accessorLayout(accessor) {
  const componentBytes = COMPONENT_BYTE_SIZE[accessor.componentType];
  const componentCount = COMPONENTS_PER_TYPE[accessor.type];
  if (!componentBytes || !componentCount) {
    throw new Error(`unsupported accessor format ${accessor.componentType}/${accessor.type}`);
  }

  const matrixMatch = /^MAT([234])$/u.exec(accessor.type);
  if (!matrixMatch) {
    return {
      componentBytes,
      componentCount,
      packedElementBytes: componentBytes * componentCount,
      sourceElementBytes: componentBytes * componentCount,
      componentOffsets: Array.from({ length: componentCount }, (_, index) => index * componentBytes),
    };
  }

  const dimension = Number(matrixMatch[1]);
  const columnBytes = dimension * componentBytes;
  const columnStride = componentBytes < 4 ? align(columnBytes, 4) : columnBytes;
  const componentOffsets = [];
  for (let column = 0; column < dimension; column += 1) {
    for (let row = 0; row < dimension; row += 1) {
      componentOffsets.push(column * columnStride + row * componentBytes);
    }
  }
  return {
    componentBytes,
    componentCount,
    packedElementBytes: componentBytes * componentCount,
    sourceElementBytes: columnStride * dimension,
    componentOffsets,
  };
}

function readUnsignedComponent(buffer, offset, componentType) {
  if (componentType === 5121) return buffer.readUInt8(offset);
  if (componentType === 5123) return buffer.readUInt16LE(offset);
  if (componentType === 5125) return buffer.readUInt32LE(offset);
  throw new Error(`invalid sparse index component type ${componentType}`);
}

function packedAccessorBytes(json, buffers, accessorIndex, cache = new Map()) {
  if (cache.has(accessorIndex)) return cache.get(accessorIndex);
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) return null;
  const layout = accessorLayout(accessor);
  const packed = Buffer.alloc(accessor.count * layout.packedElementBytes);

  if (accessor.bufferView != null) {
    const view = json.bufferViews?.[accessor.bufferView];
    const source = bufferViewBytes(json, buffers, accessor.bufferView);
    if (!view || !source) return null;
    const sourceStride = view.byteStride || layout.sourceElementBytes;
    const accessorOffset = accessor.byteOffset || 0;
    for (let element = 0; element < accessor.count; element += 1) {
      const sourceBase = accessorOffset + element * sourceStride;
      const targetBase = element * layout.packedElementBytes;
      for (let component = 0; component < layout.componentCount; component += 1) {
        const sourceOffset = sourceBase + layout.componentOffsets[component];
        const targetOffset = targetBase + component * layout.componentBytes;
        if (sourceOffset + layout.componentBytes > source.length) return null;
        source.copy(packed, targetOffset, sourceOffset, sourceOffset + layout.componentBytes);
      }
    }
  }

  const sparse = accessor.sparse;
  if (sparse) {
    const indexView = bufferViewBytes(json, buffers, sparse.indices.bufferView);
    const valueView = bufferViewBytes(json, buffers, sparse.values.bufferView);
    if (!indexView || !valueView) return null;
    const indexBytes = COMPONENT_BYTE_SIZE[sparse.indices.componentType];
    if (!indexBytes) return null;
    const indexOffset = sparse.indices.byteOffset || 0;
    const valueOffset = sparse.values.byteOffset || 0;
    for (let sparseIndex = 0; sparseIndex < sparse.count; sparseIndex += 1) {
      const targetElement = readUnsignedComponent(
        indexView,
        indexOffset + sparseIndex * indexBytes,
        sparse.indices.componentType,
      );
      if (targetElement >= accessor.count) return null;
      const sourceBase = valueOffset + sparseIndex * layout.sourceElementBytes;
      const targetBase = targetElement * layout.packedElementBytes;
      for (let component = 0; component < layout.componentCount; component += 1) {
        const sourceOffset = sourceBase + layout.componentOffsets[component];
        const targetOffset = targetBase + component * layout.componentBytes;
        if (sourceOffset + layout.componentBytes > valueView.length) return null;
        valueView.copy(packed, targetOffset, sourceOffset, sourceOffset + layout.componentBytes);
      }
    }
  }

  cache.set(accessorIndex, packed);
  return packed;
}

function readComponent(buffer, offset, componentType, normalized = false) {
  let value;
  if (componentType === 5120) value = buffer.readInt8(offset);
  else if (componentType === 5121) value = buffer.readUInt8(offset);
  else if (componentType === 5122) value = buffer.readInt16LE(offset);
  else if (componentType === 5123) value = buffer.readUInt16LE(offset);
  else if (componentType === 5125) value = buffer.readUInt32LE(offset);
  else if (componentType === 5126) value = buffer.readFloatLE(offset);
  else throw new Error(`unsupported accessor component type ${componentType}`);

  if (!normalized || componentType === 5126) return value;
  if (componentType === 5120) return Math.max(value / 127, -1);
  if (componentType === 5121) return value / 255;
  if (componentType === 5122) return Math.max(value / 32767, -1);
  if (componentType === 5123) return value / 65535;
  if (componentType === 5125) return value / 4294967295;
  return value;
}

function accessorMinMax(json, buffers, accessorIndex, packedCache) {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) return null;
  const components = COMPONENTS_PER_TYPE[accessor.type];
  if (!components) return null;
  if (
    Array.isArray(accessor.min)
    && Array.isArray(accessor.max)
    && accessor.min.length === components
    && accessor.max.length === components
    && [...accessor.min, ...accessor.max].every(Number.isFinite)
  ) {
    return { min: [...accessor.min], max: [...accessor.max], source: 'accessor' };
  }

  const bytes = packedAccessorBytes(json, buffers, accessorIndex, packedCache);
  if (!bytes) return null;
  const componentBytes = COMPONENT_BYTE_SIZE[accessor.componentType];
  const min = Array(components).fill(Infinity);
  const max = Array(components).fill(-Infinity);
  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < components; component += 1) {
      const offset = (element * components + component) * componentBytes;
      const value = readComponent(bytes, offset, accessor.componentType, accessor.normalized);
      if (!Number.isFinite(value)) continue;
      min[component] = Math.min(min[component], value);
      max[component] = Math.max(max[component], value);
    }
  }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) return null;
  return { min, max, source: 'decoded' };
}

function accessorContentHash(json, buffers, accessorIndex, packedCache) {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) return null;
  const bytes = packedAccessorBytes(json, buffers, accessorIndex, packedCache);
  if (!bytes) return null;
  const hash = createHash('sha256');
  hash.update(stableStringify({
    componentType: accessor.componentType,
    count: accessor.count,
    normalized: Boolean(accessor.normalized),
    type: accessor.type,
  }));
  hash.update(bytes);
  return hash.digest('hex');
}

function pngInfo(bytes) {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 26 || bytes.subarray(0, 8).toString('hex') !== signature) return null;
  const colorType = bytes.readUInt8(25);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType] || null;
  return {
    format: 'png',
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes.readUInt8(24),
    channels,
  };
}

function jpegInfo(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (sof.has(marker) && length >= 8) {
      return {
        format: 'jpeg',
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
        bitDepth: bytes.readUInt8(offset + 2),
        channels: bytes.readUInt8(offset + 7),
      };
    }
    offset += length;
  }
  return { format: 'jpeg', width: null, height: null, bitDepth: null, channels: null };
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpInfo(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  const type = bytes.toString('ascii', 12, 16);
  if (type === 'VP8X') {
    return {
      format: 'webp',
      width: readUInt24LE(bytes, 24) + 1,
      height: readUInt24LE(bytes, 27) + 1,
      bitDepth: 8,
      channels: (bytes[20] & 0x10) !== 0 ? 4 : 3,
    };
  }
  if (type === 'VP8 ' && bytes.length >= 30) {
    return {
      format: 'webp',
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
      bitDepth: 8,
      channels: 3,
    };
  }
  if (type === 'VP8L' && bytes[20] === 0x2f && bytes.length >= 25) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return {
      format: 'webp',
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      bitDepth: 8,
      channels: 4,
    };
  }
  return { format: 'webp', width: null, height: null, bitDepth: 8, channels: null };
}

function ktx2Info(bytes) {
  const signature = 'ab4b5458203230bb0d0a1a0a';
  if (bytes.length < 48 || bytes.subarray(0, 12).toString('hex') !== signature) return null;
  return {
    format: 'ktx2',
    width: bytes.readUInt32LE(20),
    height: bytes.readUInt32LE(24),
    bitDepth: null,
    channels: null,
    levels: bytes.readUInt32LE(40),
    supercompressionScheme: bytes.readUInt32LE(44),
  };
}

function ddsInfo(bytes) {
  if (bytes.length < 128 || bytes.toString('ascii', 0, 4) !== 'DDS ') return null;
  return {
    format: 'dds',
    width: bytes.readUInt32LE(16),
    height: bytes.readUInt32LE(12),
    bitDepth: null,
    channels: null,
  };
}

function imageDimensions(bytes) {
  return pngInfo(bytes) || jpegInfo(bytes) || webpInfo(bytes) || ktx2Info(bytes) || ddsInfo(bytes) || {
    format: 'unknown', width: null, height: null, bitDepth: null, channels: null,
  };
}

function mipmappedRgba8Bytes(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  let w = Math.floor(width);
  let h = Math.floor(height);
  let total = 0;
  while (true) {
    total += w * h * 4;
    if (w === 1 && h === 1) break;
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  }
  return total;
}

function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrices(a, b) {
  const out = Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  }
  return out;
}

function nodeLocalMatrix(node = {}) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.map(Number);
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  const denominator = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const inverseW = denominator && denominator !== 1 ? 1 / denominator : 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * inverseW,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * inverseW,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * inverseW,
  ];
}

function emptyBounds() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function includePoint(bounds, point) {
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
}

function includeBounds(bounds, addition) {
  if (!addition) return;
  includePoint(bounds, addition.min);
  includePoint(bounds, addition.max);
}

function transformBounds(bounds, matrix) {
  if (!bounds) return null;
  const out = emptyBounds();
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) includePoint(out, transformPoint(matrix, [x, y, z]));
    }
  }
  return out;
}

function finalizeBounds(bounds) {
  if (!bounds || !bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) return null;
  const dimensions = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const center = bounds.max.map((value, axis) => (value + bounds.min[axis]) / 2);
  return {
    min: bounds.min,
    max: bounds.max,
    dimensions,
    center,
    centerOffset: Math.hypot(...center),
    maxDimension: Math.max(...dimensions),
  };
}

function primitiveElementCount(json, primitive) {
  const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
  return json.accessors?.[accessorIndex]?.count || 0;
}

function primitiveTriangleCount(json, primitive) {
  const count = primitiveElementCount(json, primitive);
  const mode = primitive.mode ?? 4;
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

function collectExtensions(value, out = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (value.extensions && typeof value.extensions === 'object') {
    for (const key of Object.keys(value.extensions)) out.add(key);
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExtensions(item, out);
  } else {
    for (const child of Object.values(value)) collectExtensions(child, out);
  }
  return out;
}

function collectTextureIndices(material) {
  const indices = new Set();
  function visit(value, propertyName = '') {
    if (!value || typeof value !== 'object') return;
    if (
      propertyName.toLowerCase().endsWith('texture')
      && Number.isInteger(value.index)
    ) indices.add(value.index);
    for (const [key, child] of Object.entries(value)) visit(child, key);
  }
  visit(material);
  return [...indices].sort((a, b) => a - b);
}

function textureSourceIndices(texture) {
  const indices = new Set();
  if (Number.isInteger(texture.source)) indices.add(texture.source);
  for (const extensionName of ['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif']) {
    const source = texture.extensions?.[extensionName]?.source;
    if (Number.isInteger(source)) indices.add(source);
  }
  return [...indices].sort((a, b) => a - b);
}

function imageMimeType(definition, uri, detectedFormat) {
  if (definition.mimeType) return definition.mimeType;
  if (uri?.startsWith('data:')) return decodeDataUri(uri)?.mimeType || null;
  const extension = extname(uri || '').toLowerCase();
  if (extension === '.png' || detectedFormat === 'png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg' || detectedFormat === 'jpeg') return 'image/jpeg';
  if (extension === '.webp' || detectedFormat === 'webp') return 'image/webp';
  if (extension === '.ktx2' || detectedFormat === 'ktx2') return 'image/ktx2';
  if (extension === '.dds' || detectedFormat === 'dds') return 'image/vnd-ms.dds';
  return null;
}

function readImageResource(json, buffers, definition, index, filePath, warnings) {
  let bytes = null;
  let source = 'missing';
  let uri = null;
  if (Number.isInteger(definition.bufferView)) {
    bytes = bufferViewBytes(json, buffers, definition.bufferView);
    source = 'bufferView';
  } else if (typeof definition.uri === 'string') {
    uri = definition.uri;
    if (definition.uri.startsWith('data:')) {
      bytes = decodeDataUri(definition.uri)?.bytes || null;
      source = 'dataUri';
    } else {
      const externalPath = safeExternalPath(filePath ? dirname(filePath) : process.cwd(), definition.uri);
      if (externalPath && existsSync(externalPath)) {
        bytes = readFileSync(externalPath);
        source = 'external';
      } else {
        warnings.push(`image ${index} has unavailable external URI ${definition.uri}`);
      }
    }
  }

  const dimensions = bytes ? imageDimensions(bytes) : {
    format: 'unknown', width: null, height: null, bitDepth: null, channels: null,
  };
  const decodedRgba8Bytes = dimensions.width && dimensions.height
    ? dimensions.width * dimensions.height * 4
    : null;
  return {
    index,
    name: definition.name || null,
    source,
    uri,
    bufferView: Number.isInteger(definition.bufferView) ? definition.bufferView : null,
    mimeType: imageMimeType(definition, uri, dimensions.format),
    format: dimensions.format,
    width: dimensions.width,
    height: dimensions.height,
    bitDepth: dimensions.bitDepth,
    channels: dimensions.channels,
    compressedBytes: bytes?.length ?? null,
    estimatedDecodedRgba8Bytes: decodedRgba8Bytes,
    estimatedMipmappedRgba8Bytes: decodedRgba8Bytes == null
      ? null
      : mipmappedRgba8Bytes(dimensions.width, dimensions.height),
    sha256: bytes ? sha256(bytes) : null,
  };
}

function semanticTextureDescriptor(texture, samplers, images) {
  const descriptor = semanticResource(texture);
  delete descriptor.source;
  delete descriptor.sampler;
  if (descriptor.extensions) {
    for (const extensionName of ['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif']) {
      if (descriptor.extensions[extensionName]) delete descriptor.extensions[extensionName].source;
    }
  }
  const sampler = Number.isInteger(texture.sampler) ? samplers[texture.sampler] : null;
  return {
    descriptor,
    sampler: sampler ? semanticResource(sampler) : null,
    sources: textureSourceIndices(texture).map((index) => images[index]?.sha256 || `missing:${index}`),
  };
}

function semanticMaterialDescriptor(value, textureRecords, propertyName = '') {
  if (Array.isArray(value)) return value.map((item) => semanticMaterialDescriptor(item, textureRecords));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort(compareText)) {
      if (key === 'name' || key === 'extras') continue;
      if (key === 'index' && propertyName.toLowerCase().endsWith('texture') && Number.isInteger(value[key])) {
        out.textureHash = textureRecords[value[key]]?.sha256 || `missing:${value[key]}`;
      } else {
        out[key] = semanticMaterialDescriptor(value[key], textureRecords, key);
      }
    }
    return out;
  }
  return value;
}

function groupDuplicateRecords(records, sizeField = 'bytes') {
  const groups = new Map();
  for (const record of records) {
    if (!record.sha256) continue;
    if (!groups.has(record.sha256)) groups.set(record.sha256, []);
    groups.get(record.sha256).push(record);
  }
  return [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([hash, entries]) => {
      const sortedEntries = [...entries].sort((a, b) => {
        const pathOrder = compareText(a.file || '', b.file || '');
        return pathOrder || ((a.index ?? 0) - (b.index ?? 0));
      });
      const sizes = sortedEntries.map((entry) => entry[sizeField] || 0);
      const totalBytes = sizes.reduce((sum, value) => sum + value, 0);
      return {
        sha256: hash,
        count: sortedEntries.length,
        totalBytes,
        redundantBytes: Math.max(0, totalBytes - Math.max(...sizes, 0)),
        resources: sortedEntries,
      };
    })
    .sort((a, b) => b.redundantBytes - a.redundantBytes || compareText(a.sha256, b.sha256));
}

function inferredSceneRoots(json) {
  const nodes = json.nodes || [];
  const children = new Set();
  for (const node of nodes) for (const child of node.children || []) children.add(child);
  return nodes.map((_, index) => index).filter((index) => !children.has(index));
}

function rootsForScene(json, sceneIndex) {
  if (Number.isInteger(sceneIndex) && json.scenes?.[sceneIndex]) return json.scenes[sceneIndex].nodes || [];
  return inferredSceneRoots(json);
}

function reachableNodeSet(json, roots) {
  const reachable = new Set();
  const stack = [...roots].reverse();
  while (stack.length) {
    const index = stack.pop();
    if (!Number.isInteger(index) || reachable.has(index) || !json.nodes?.[index]) continue;
    reachable.add(index);
    const children = json.nodes[index].children || [];
    for (let child = children.length - 1; child >= 0; child -= 1) stack.push(children[child]);
  }
  return reachable;
}

function allSceneReachableNodes(json) {
  if (!json.scenes?.length) return reachableNodeSet(json, inferredSceneRoots(json));
  const roots = json.scenes.flatMap((scene) => scene.nodes || []);
  return reachableNodeSet(json, roots);
}

function complementIndices(length, used) {
  const out = [];
  for (let index = 0; index < length; index += 1) if (!used.has(index)) out.push(index);
  return out;
}

function buildReachability(json, materialTextureIndices, textureSources) {
  const nodes = json.nodes || [];
  const meshes = json.meshes || [];
  const materials = json.materials || [];
  const textures = json.textures || [];
  const images = json.images || [];
  const cameras = json.cameras || [];
  const lights = json.extensions?.KHR_lights_punctual?.lights || [];
  const sceneNodes = allSceneReachableNodes(json);
  const sceneMeshes = new Set();
  const sceneCameras = new Set();
  const sceneLights = new Set();
  for (const nodeIndex of sceneNodes) {
    const node = nodes[nodeIndex];
    if (Number.isInteger(node.mesh)) sceneMeshes.add(node.mesh);
    if (Number.isInteger(node.camera)) sceneCameras.add(node.camera);
    const light = node.extensions?.KHR_lights_punctual?.light;
    if (Number.isInteger(light)) sceneLights.add(light);
  }

  const sceneMaterials = new Set();
  for (const meshIndex of sceneMeshes) {
    for (const primitive of meshes[meshIndex]?.primitives || []) {
      if (Number.isInteger(primitive.material)) sceneMaterials.add(primitive.material);
    }
  }
  const sceneTextures = new Set();
  for (const materialIndex of sceneMaterials) {
    for (const textureIndex of materialTextureIndices[materialIndex] || []) sceneTextures.add(textureIndex);
  }
  const sceneImages = new Set();
  for (const textureIndex of sceneTextures) {
    for (const imageIndex of textureSources[textureIndex] || []) sceneImages.add(imageIndex);
  }

  const anyMeshes = new Set();
  const anyCameras = new Set();
  const anyLights = new Set();
  for (const node of nodes) {
    if (Number.isInteger(node.mesh)) anyMeshes.add(node.mesh);
    if (Number.isInteger(node.camera)) anyCameras.add(node.camera);
    const light = node.extensions?.KHR_lights_punctual?.light;
    if (Number.isInteger(light)) anyLights.add(light);
  }
  const anyMaterials = new Set();
  const anyAccessors = new Set();
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives || []) {
      if (Number.isInteger(primitive.material)) anyMaterials.add(primitive.material);
      if (Number.isInteger(primitive.indices)) anyAccessors.add(primitive.indices);
      for (const accessor of Object.values(primitive.attributes || {})) if (Number.isInteger(accessor)) anyAccessors.add(accessor);
      for (const target of primitive.targets || []) {
        for (const accessor of Object.values(target)) if (Number.isInteger(accessor)) anyAccessors.add(accessor);
      }
    }
  }
  for (const animation of json.animations || []) {
    for (const sampler of animation.samplers || []) {
      if (Number.isInteger(sampler.input)) anyAccessors.add(sampler.input);
      if (Number.isInteger(sampler.output)) anyAccessors.add(sampler.output);
    }
  }
  for (const skin of json.skins || []) if (Number.isInteger(skin.inverseBindMatrices)) anyAccessors.add(skin.inverseBindMatrices);

  const anyTextures = new Set();
  for (const indices of materialTextureIndices) for (const textureIndex of indices) anyTextures.add(textureIndex);
  const anyImages = new Set();
  const anySamplers = new Set();
  for (let textureIndex = 0; textureIndex < textures.length; textureIndex += 1) {
    for (const imageIndex of textureSources[textureIndex] || []) anyImages.add(imageIndex);
    if (Number.isInteger(textures[textureIndex].sampler)) anySamplers.add(textures[textureIndex].sampler);
  }

  return {
    unreachableFromScenes: {
      nodes: complementIndices(nodes.length, sceneNodes),
      meshes: complementIndices(meshes.length, sceneMeshes),
      materials: complementIndices(materials.length, sceneMaterials),
      textures: complementIndices(textures.length, sceneTextures),
      images: complementIndices(images.length, sceneImages),
      cameras: complementIndices(cameras.length, sceneCameras),
      lights: complementIndices(lights.length, sceneLights),
    },
    unreferenced: {
      meshes: complementIndices(meshes.length, anyMeshes),
      materials: complementIndices(materials.length, anyMaterials),
      textures: complementIndices(textures.length, anyTextures),
      images: complementIndices(images.length, anyImages),
      samplers: complementIndices((json.samplers || []).length, anySamplers),
      accessors: complementIndices((json.accessors || []).length, anyAccessors),
      cameras: complementIndices(cameras.length, anyCameras),
      lights: complementIndices(lights.length, anyLights),
    },
  };
}

function meshLocalBounds(json, buffers, mesh, packedCache) {
  const bounds = emptyBounds();
  let hasBounds = false;
  for (const primitive of mesh.primitives || []) {
    const position = primitive.attributes?.POSITION;
    if (!Number.isInteger(position)) continue;
    const range = accessorMinMax(json, buffers, position, packedCache);
    if (!range || range.min.length < 3 || range.max.length < 3) continue;
    includeBounds(bounds, { min: range.min.slice(0, 3), max: range.max.slice(0, 3) });
    hasBounds = true;
  }
  return hasBounds ? bounds : null;
}

function analyzeScene(json, meshRecords) {
  const sceneIndex = Number.isInteger(json.scene) && json.scenes?.[json.scene]
    ? json.scene
    : (json.scenes?.length ? 0 : null);
  const roots = rootsForScene(json, sceneIndex);
  const bounds = emptyBounds();
  let hasBounds = false;
  let triangles = 0;
  let renderVertices = 0;
  let meshInstances = 0;
  const meshInstanceCounts = new Map();
  const cycles = [];

  function visit(nodeIndex, parentMatrix, ancestors) {
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    if (ancestors.has(nodeIndex)) {
      cycles.push(nodeIndex);
      return;
    }
    const world = multiplyMatrices(parentMatrix, nodeLocalMatrix(node));
    if (Number.isInteger(node.mesh) && meshRecords[node.mesh]) {
      const mesh = meshRecords[node.mesh];
      meshInstances += 1;
      meshInstanceCounts.set(node.mesh, (meshInstanceCounts.get(node.mesh) || 0) + 1);
      triangles += mesh.triangles;
      renderVertices += mesh.renderVertices;
      if (mesh.localBounds) {
        includeBounds(bounds, transformBounds(mesh.localBounds, world));
        hasBounds = true;
      }
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(nodeIndex);
    for (const child of node.children || []) visit(child, world, nextAncestors);
  }

  for (const root of roots) visit(root, identityMatrix(), new Set());
  return {
    sceneIndex,
    sceneName: Number.isInteger(sceneIndex) ? json.scenes?.[sceneIndex]?.name || null : null,
    roots: [...roots],
    meshInstances,
    meshInstanceCounts: [...meshInstanceCounts.entries()]
      .map(([mesh, instances]) => ({ mesh, instances }))
      .sort((a, b) => a.mesh - b.mesh),
    triangles,
    renderVertices,
    transformedBounds: hasBounds ? finalizeBounds(bounds) : null,
    cycles: [...new Set(cycles)].sort((a, b) => a - b),
  };
}

function analyzeAnimations(json, buffers, packedCache) {
  return (json.animations || []).map((animation, index) => {
    let start = Infinity;
    let end = -Infinity;
    let keyframes = 0;
    const inputAccessors = new Set();
    for (const sampler of animation.samplers || []) {
      if (!Number.isInteger(sampler.input)) continue;
      inputAccessors.add(sampler.input);
      const accessor = json.accessors?.[sampler.input];
      if (accessor) keyframes += accessor.count || 0;
      const range = accessorMinMax(json, buffers, sampler.input, packedCache);
      if (range?.min?.length && range?.max?.length) {
        start = Math.min(start, range.min[0]);
        end = Math.max(end, range.max[0]);
      }
    }
    return {
      index,
      name: animation.name || null,
      channels: (animation.channels || []).length,
      samplers: (animation.samplers || []).length,
      uniqueInputAccessors: inputAccessors.size,
      keyframes,
      startSeconds: Number.isFinite(start) ? start : null,
      endSeconds: Number.isFinite(end) ? end : null,
      durationSeconds: Number.isFinite(start) && Number.isFinite(end) ? end - start : null,
      targetNodes: [...new Set((animation.channels || [])
        .map((channel) => channel.target?.node)
        .filter(Number.isInteger))].sort((a, b) => a - b),
    };
  });
}

function classifyAsset(displayPath) {
  const lower = displayPath.toLowerCase();
  if (lower === 'vendor/models' || lower.startsWith('vendor/models/')) return 'runtime';
  if (lower === 'assets' || lower.startsWith('assets/')) return 'authoring';
  if (lower === 'qa' || lower.startsWith('qa/')) return 'qa';
  return 'other';
}

function assetScope(displayPath, classification) {
  const parts = displayPath.split('/');
  if (classification === 'runtime') {
    const rest = parts.slice(2);
    return `runtime:${rest.length > 1 ? rest[0].toLowerCase() : 'root'}`;
  }
  if (classification === 'authoring') {
    const lower = displayPath.toLowerCase();
    if (lower.startsWith('assets/pro_shop/glb/products/')) return 'authoring:pro-shop-products';
    if (lower.startsWith('assets/pro_shop/glb/fixtures/')) return 'authoring:pro-shop-fixtures';
    if (lower.startsWith('assets/checkout/glb/')) return 'authoring:checkout';
    return `authoring:${parts.length > 2 ? parts[1].toLowerCase() : 'root'}`;
  }
  return `${classification}:${parts.length > 1 ? parts[0].toLowerCase() : 'root'}`;
}

function resourceDuplicatesForAsset(resources) {
  const compact = (records, bytesField) => groupDuplicateRecords(
    records.map((record) => ({
      index: record.index,
      name: record.name || null,
      sha256: record.sha256,
      bytes: record[bytesField] || 0,
    })),
  );
  return {
    accessors: compact(resources.accessors, 'packedBytes'),
    meshes: compact(resources.meshes, 'packedBytes'),
    materials: compact(resources.materials, 'descriptorBytes'),
    textures: compact(resources.textures, 'descriptorBytes'),
    images: compact(resources.images, 'compressedBytes'),
  };
}

function auditGlbBuffer(buffer, options = {}) {
  const root = resolve(options.root || process.cwd());
  const filePath = options.filePath ? resolve(options.filePath) : null;
  const displayPath = options.displayPath
    || (filePath ? projectPath(filePath, root) : '<buffer>');
  const classification = options.classification || classifyAsset(displayPath);
  const parsed = parseGlb(buffer);
  const { json } = parsed;
  const warnings = [];
  const buffers = loadGlbBuffers(parsed, filePath, warnings);
  const packedCache = new Map();

  const accessorRecords = (json.accessors || []).map((accessor, index) => {
    const packed = packedAccessorBytes(json, buffers, index, packedCache);
    const range = accessorMinMax(json, buffers, index, packedCache);
    return {
      index,
      name: accessor.name || null,
      type: accessor.type,
      componentType: accessor.componentType,
      count: accessor.count,
      normalized: Boolean(accessor.normalized),
      sparseCount: accessor.sparse?.count || 0,
      packedBytes: packed?.length ?? null,
      sha256: packed ? accessorContentHash(json, buffers, index, packedCache) : null,
      min: range?.min || null,
      max: range?.max || null,
      boundsSource: range?.source || null,
    };
  });

  const imageRecords = (json.images || []).map((definition, index) => (
    readImageResource(json, buffers, definition, index, filePath, warnings)
  ));
  const samplerRecords = (json.samplers || []).map((sampler, index) => {
    const descriptor = semanticResource(sampler);
    const encoded = Buffer.from(stableStringify(descriptor));
    return {
      index,
      name: sampler.name || null,
      descriptor,
      descriptorBytes: encoded.length,
      sha256: sha256(encoded),
    };
  });
  const textureSources = (json.textures || []).map(textureSourceIndices);
  const textureRecords = (json.textures || []).map((texture, index) => {
    const descriptor = semanticTextureDescriptor(texture, json.samplers || [], imageRecords);
    const encoded = Buffer.from(stableStringify(descriptor));
    const sourceImages = textureSources[index];
    return {
      index,
      name: texture.name || null,
      sampler: Number.isInteger(texture.sampler) ? texture.sampler : null,
      sourceImages,
      formats: [...new Set(sourceImages.map((image) => imageRecords[image]?.format).filter(Boolean))].sort(compareText),
      compressedBytes: sourceImages.reduce((sum, image) => sum + (imageRecords[image]?.compressedBytes || 0), 0),
      estimatedDecodedRgba8Bytes: sourceImages.reduce((sum, image) => sum + (imageRecords[image]?.estimatedDecodedRgba8Bytes || 0), 0),
      estimatedMipmappedRgba8Bytes: sourceImages.reduce((sum, image) => sum + (imageRecords[image]?.estimatedMipmappedRgba8Bytes || 0), 0),
      descriptorBytes: encoded.length,
      sha256: sha256(encoded),
    };
  });

  const materialTextureIndices = (json.materials || []).map(collectTextureIndices);
  const materialPrimitiveUsage = Array((json.materials || []).length).fill(0);
  const materialRecords = (json.materials || []).map((material, index) => {
    const descriptor = semanticMaterialDescriptor(material, textureRecords);
    const encoded = Buffer.from(stableStringify(descriptor));
    return {
      index,
      name: material.name || null,
      alphaMode: material.alphaMode || 'OPAQUE',
      doubleSided: Boolean(material.doubleSided),
      unlit: Boolean(material.extensions?.KHR_materials_unlit),
      textureIndices: materialTextureIndices[index],
      descriptorBytes: encoded.length,
      sha256: sha256(encoded),
      primitiveUsage: 0,
    };
  });

  const meshInternal = (json.meshes || []).map((mesh, meshIndex) => {
    const referencedAccessors = new Set();
    const positionAccessors = new Set();
    let triangles = 0;
    let renderVertices = 0;
    const primitives = (mesh.primitives || []).map((primitive, primitiveIndex) => {
      const attributes = Object.fromEntries(Object.entries(primitive.attributes || {}).sort(([a], [b]) => compareText(a, b)));
      for (const accessor of Object.values(attributes)) if (Number.isInteger(accessor)) referencedAccessors.add(accessor);
      if (Number.isInteger(attributes.POSITION)) positionAccessors.add(attributes.POSITION);
      if (Number.isInteger(primitive.indices)) referencedAccessors.add(primitive.indices);
      const targets = (primitive.targets || []).map((target) => {
        const sorted = Object.fromEntries(Object.entries(target).sort(([a], [b]) => compareText(a, b)));
        for (const accessor of Object.values(sorted)) if (Number.isInteger(accessor)) referencedAccessors.add(accessor);
        return sorted;
      });
      if (Number.isInteger(primitive.material) && materialPrimitiveUsage[primitive.material] != null) {
        materialPrimitiveUsage[primitive.material] += 1;
      }

      const primitiveTriangles = primitiveTriangleCount(json, primitive);
      const primitiveRenderVertices = primitiveElementCount(json, primitive);
      triangles += primitiveTriangles;
      renderVertices += primitiveRenderVertices;
      const hashInput = {
        mode: primitive.mode ?? 4,
        attributes: Object.fromEntries(Object.entries(attributes).map(([semantic, accessor]) => [
          semantic,
          accessorRecords[accessor]?.sha256 || `missing:${accessor}`,
        ])),
        indices: Number.isInteger(primitive.indices)
          ? accessorRecords[primitive.indices]?.sha256 || `missing:${primitive.indices}`
          : null,
        material: Number.isInteger(primitive.material)
          ? materialRecords[primitive.material]?.sha256 || `missing:${primitive.material}`
          : null,
        targets: targets.map((target) => Object.fromEntries(Object.entries(target).map(([semantic, accessor]) => [
          semantic,
          accessorRecords[accessor]?.sha256 || `missing:${accessor}`,
        ]))),
        extensions: semanticResource(primitive.extensions || {}),
      };
      return {
        index: primitiveIndex,
        mode: primitive.mode ?? 4,
        material: Number.isInteger(primitive.material) ? primitive.material : null,
        attributes,
        indices: Number.isInteger(primitive.indices) ? primitive.indices : null,
        targets,
        triangles: primitiveTriangles,
        renderVertices: primitiveRenderVertices,
        uploadVertices: Number.isInteger(attributes.POSITION) ? json.accessors?.[attributes.POSITION]?.count || 0 : 0,
        sha256: hashDescriptor(hashInput),
      };
    });
    const meshHashInput = {
      primitives: primitives.map((primitive) => primitive.sha256),
      weights: mesh.weights || null,
    };
    const uploadVertices = [...positionAccessors].reduce((sum, accessor) => sum + (json.accessors?.[accessor]?.count || 0), 0);
    const packedBytes = [...referencedAccessors].reduce((sum, accessor) => sum + (accessorRecords[accessor]?.packedBytes || 0), 0);
    return {
      index: meshIndex,
      name: mesh.name || null,
      primitives,
      triangles,
      renderVertices,
      uploadVertices,
      packedBytes,
      referencedAccessors: [...referencedAccessors].sort((a, b) => a - b),
      sha256: hashDescriptor(meshHashInput),
      localBounds: meshLocalBounds(json, buffers, mesh, packedCache),
    };
  });
  for (let index = 0; index < materialRecords.length; index += 1) materialRecords[index].primitiveUsage = materialPrimitiveUsage[index];

  const scene = analyzeScene(json, meshInternal);
  const meshRecords = meshInternal.map((mesh) => ({
    ...mesh,
    localBounds: finalizeBounds(mesh.localBounds),
  }));
  const animations = analyzeAnimations(json, buffers, packedCache);
  const reachability = buildReachability(json, materialTextureIndices, textureSources);
  const extensions = [...new Set([
    ...(json.extensionsUsed || []),
    ...collectExtensions(json),
  ])].sort(compareText);
  const geometryCompression = extensions.filter((extension) => GEOMETRY_COMPRESSION_EXTENSIONS.has(extension));
  const textureCompression = extensions.filter((extension) => TEXTURE_COMPRESSION_EXTENSIONS.has(extension));
  if (imageRecords.some((image) => image.format === 'ktx2') && !textureCompression.includes('KHR_texture_basisu')) {
    textureCompression.push('KTX2 image');
  }
  textureCompression.sort(compareText);

  const uniquePositionAccessors = new Set();
  for (const mesh of meshRecords) {
    for (const primitive of mesh.primitives) {
      const position = primitive.attributes.POSITION;
      if (Number.isInteger(position)) uniquePositionAccessors.add(position);
    }
  }
  const geometry = {
    triangles: meshRecords.reduce((sum, mesh) => sum + mesh.triangles, 0),
    sceneTriangles: scene.triangles,
    renderVertices: meshRecords.reduce((sum, mesh) => sum + mesh.renderVertices, 0),
    sceneRenderVertices: scene.renderVertices,
    uploadVertices: [...uniquePositionAccessors]
      .reduce((sum, accessor) => sum + (json.accessors?.[accessor]?.count || 0), 0),
  };
  const imageTotals = {
    compressedBytes: imageRecords.reduce((sum, image) => sum + (image.compressedBytes || 0), 0),
    estimatedDecodedRgba8Bytes: imageRecords.reduce((sum, image) => sum + (image.estimatedDecodedRgba8Bytes || 0), 0),
    estimatedMipmappedRgba8Bytes: imageRecords.reduce((sum, image) => sum + (image.estimatedMipmappedRgba8Bytes || 0), 0),
    maxWidth: Math.max(0, ...imageRecords.map((image) => image.width || 0)),
    maxHeight: Math.max(0, ...imageRecords.map((image) => image.height || 0)),
  };

  const resources = {
    accessors: accessorRecords,
    meshes: meshRecords,
    materials: materialRecords,
    samplers: samplerRecords,
    textures: textureRecords,
    images: imageRecords,
  };
  const duplicates = resourceDuplicatesForAsset(resources);
  return {
    file: displayPath,
    classification,
    scope: assetScope(displayPath, classification),
    bytes: buffer.length,
    sha256: sha256(buffer),
    container: {
      version: parsed.containerVersion,
      declaredBytes: parsed.declaredLength,
      jsonChunkBytes: parsed.jsonChunkBytes,
      binaryChunkBytes: parsed.binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0),
      chunks: parsed.chunks,
    },
    asset: {
      version: json.asset?.version || null,
      minVersion: json.asset?.minVersion || null,
      generator: json.asset?.generator || null,
      copyright: json.asset?.copyright || null,
    },
    extensions: {
      used: extensions,
      required: [...(json.extensionsRequired || [])].sort(compareText),
      geometryCompression,
      textureCompression,
    },
    counts: {
      scenes: (json.scenes || []).length,
      nodes: (json.nodes || []).length,
      meshes: meshRecords.length,
      meshInstances: scene.meshInstances,
      primitives: meshRecords.reduce((sum, mesh) => sum + mesh.primitives.length, 0),
      accessors: accessorRecords.length,
      materials: materialRecords.length,
      samplers: samplerRecords.length,
      textures: textureRecords.length,
      images: imageRecords.length,
      animations: animations.length,
      skins: (json.skins || []).length,
      cameras: (json.cameras || []).length,
      lights: (json.extensions?.KHR_lights_punctual?.lights || []).length,
    },
    geometry,
    imageTotals,
    scene,
    animations,
    cameras: (json.cameras || []).map((camera, index) => ({
      index, name: camera.name || null, type: camera.type || null,
    })),
    lights: (json.extensions?.KHR_lights_punctual?.lights || []).map((light, index) => ({
      index, name: light.name || null, type: light.type || null,
    })),
    reachability,
    duplicates,
    resources,
    warnings: [...new Set(warnings)].sort(compareText),
  };
}

function auditGlbFile(filePath, options = {}) {
  const absolutePath = resolve(filePath);
  return auditGlbBuffer(readFileSync(absolutePath), {
    ...options,
    filePath: absolutePath,
  });
}

function walkGlbFiles(roots, options = {}) {
  const ignoredDirs = new Set(options.ignoredDirs || DEFAULT_IGNORED_DIRS);
  const found = new Map();
  const missing = [];

  function visit(candidate) {
    if (!existsSync(candidate)) {
      missing.push(candidate);
      return;
    }
    const info = statSync(candidate);
    if (info.isFile()) {
      if (candidate.toLowerCase().endsWith('.glb')) found.set(candidate.toLowerCase(), candidate);
      return;
    }
    if (!info.isDirectory()) return;
    const entries = readdirSync(candidate, { withFileTypes: true })
      .sort((a, b) => compareText(a.name, b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
      const child = join(candidate, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.glb')) found.set(child.toLowerCase(), child);
    }
  }

  for (const root of roots.map((candidate) => resolve(candidate)).sort(compareText)) visit(root);
  return {
    files: [...found.values()].sort((a, b) => compareText(normalizeSlashes(a), normalizeSlashes(b))),
    missing: missing.sort(compareText),
  };
}

function emptyTotals() {
  return {
    files: 0,
    bytes: 0,
    triangles: 0,
    sceneTriangles: 0,
    renderVertices: 0,
    sceneRenderVertices: 0,
    uploadVertices: 0,
    nodes: 0,
    meshes: 0,
    meshInstances: 0,
    primitives: 0,
    accessors: 0,
    materials: 0,
    textures: 0,
    images: 0,
    animations: 0,
    cameras: 0,
    lights: 0,
    embeddedImageCompressedBytes: 0,
    estimatedDecodedRgba8Bytes: 0,
    estimatedMipmappedRgba8Bytes: 0,
    warnings: 0,
  };
}

function addAssetToTotals(totals, asset) {
  totals.files += 1;
  totals.bytes += asset.bytes;
  totals.triangles += asset.geometry.triangles;
  totals.sceneTriangles += asset.geometry.sceneTriangles;
  totals.renderVertices += asset.geometry.renderVertices;
  totals.sceneRenderVertices += asset.geometry.sceneRenderVertices;
  totals.uploadVertices += asset.geometry.uploadVertices;
  totals.nodes += asset.counts.nodes;
  totals.meshes += asset.counts.meshes;
  totals.meshInstances += asset.counts.meshInstances;
  totals.primitives += asset.counts.primitives;
  totals.accessors += asset.counts.accessors;
  totals.materials += asset.counts.materials;
  totals.textures += asset.counts.textures;
  totals.images += asset.counts.images;
  totals.animations += asset.counts.animations;
  totals.cameras += asset.counts.cameras;
  totals.lights += asset.counts.lights;
  totals.embeddedImageCompressedBytes += asset.imageTotals.compressedBytes;
  totals.estimatedDecodedRgba8Bytes += asset.imageTotals.estimatedDecodedRgba8Bytes;
  totals.estimatedMipmappedRgba8Bytes += asset.imageTotals.estimatedMipmappedRgba8Bytes;
  totals.warnings += asset.warnings.length;
  return totals;
}

function groupedTotals(assets, key) {
  const groups = new Map();
  for (const asset of assets) {
    const group = asset[key];
    if (!groups.has(group)) groups.set(group, emptyTotals());
    addAssetToTotals(groups.get(group), asset);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => compareText(a, b)));
}

function assetSummary(asset, metric, value) {
  return {
    file: asset.file,
    classification: asset.classification,
    scope: asset.scope,
    [metric]: value,
    bytes: asset.bytes,
    triangles: asset.geometry.triangles,
    sceneTriangles: asset.geometry.sceneTriangles,
    materials: asset.counts.materials,
    textures: asset.counts.textures,
    images: asset.counts.images,
    imageCompressedBytes: asset.imageTotals.compressedBytes,
    estimatedDecodedRgba8Bytes: asset.imageTotals.estimatedDecodedRgba8Bytes,
    estimatedMipmappedRgba8Bytes: asset.imageTotals.estimatedMipmappedRgba8Bytes,
  };
}

function topAssets(assets, metric, getter, limit) {
  return assets
    .map((asset) => assetSummary(asset, metric, getter(asset)))
    .filter((record) => Number.isFinite(record[metric]) && record[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || compareText(a.file, b.file))
    .slice(0, limit);
}

function aggregateDuplicateGroups(assets) {
  const fileRecords = assets.map((asset) => ({
    file: asset.file,
    sha256: asset.sha256,
    bytes: asset.bytes,
  }));
  const resourceRecords = (resourceName, bytesField) => assets.flatMap((asset) => (
    asset.resources[resourceName].map((resource) => ({
      file: asset.file,
      index: resource.index,
      name: resource.name || null,
      sha256: resource.sha256,
      bytes: resource[bytesField] || 0,
    }))
  ));
  return {
    files: groupDuplicateRecords(fileRecords),
    accessors: groupDuplicateRecords(resourceRecords('accessors', 'packedBytes')),
    meshes: groupDuplicateRecords(resourceRecords('meshes', 'packedBytes')),
    materials: groupDuplicateRecords(resourceRecords('materials', 'descriptorBytes')),
    textures: groupDuplicateRecords(resourceRecords('textures', 'descriptorBytes')),
    images: groupDuplicateRecords(resourceRecords('images', 'compressedBytes')),
  };
}

function duplicateSummary(groups) {
  return Object.fromEntries(Object.entries(groups).map(([name, records]) => [name, {
    groups: records.length,
    resources: records.reduce((sum, record) => sum + record.count, 0),
    redundantBytes: records.reduce((sum, record) => sum + record.redundantBytes, 0),
  }]));
}

function topImageOffenders(assets, limit) {
  return assets.flatMap((asset) => asset.resources.images.map((image) => ({
    file: asset.file,
    index: image.index,
    name: image.name,
    format: image.format,
    width: image.width,
    height: image.height,
    compressedBytes: image.compressedBytes,
    estimatedDecodedRgba8Bytes: image.estimatedDecodedRgba8Bytes,
    estimatedMipmappedRgba8Bytes: image.estimatedMipmappedRgba8Bytes,
    sha256: image.sha256,
  })))
    .filter((image) => image.estimatedMipmappedRgba8Bytes)
    .sort((a, b) => (
      b.estimatedMipmappedRgba8Bytes - a.estimatedMipmappedRgba8Bytes
      || b.compressedBytes - a.compressedBytes
      || compareText(a.file, b.file)
      || a.index - b.index
    ))
    .slice(0, limit);
}

function buildAssetFootprintReport(options = {}) {
  const root = resolve(options.root || process.cwd());
  const roots = (options.roots?.length ? options.roots : ['.'])
    .map((candidate) => isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate));
  const topLimit = Number.isInteger(options.topLimit) && options.topLimit > 0 ? options.topLimit : 25;
  const scan = walkGlbFiles(roots, options);
  const assets = [];
  const errors = [];

  for (const filePath of scan.files) {
    try {
      assets.push(auditGlbFile(filePath, { root }));
    } catch (error) {
      let bytes = null;
      let fileHash = null;
      try {
        const raw = readFileSync(filePath);
        bytes = raw.length;
        fileHash = sha256(raw);
      } catch { /* retain parse/read error only */ }
      errors.push({
        file: projectPath(filePath, root),
        bytes,
        sha256: fileHash,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  assets.sort((a, b) => compareText(a.file, b.file));
  errors.sort((a, b) => compareText(a.file, b.file));

  const totals = emptyTotals();
  for (const asset of assets) addAssetToTotals(totals, asset);
  const duplicateGroups = aggregateDuplicateGroups(assets);
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: 'tools/qa/asset-footprint-audit.mjs',
    roots: roots.map((candidate) => projectPath(candidate, root)).sort(compareText),
    definitions: {
      triangles: 'Triangle-list index/vertex count divided by 3; strips and fans use max(count - 2, 0). Unique mesh definitions are counted once.',
      sceneTriangles: 'Triangles multiplied by mesh instances reachable from the active/default scene.',
      renderVertices: 'Indices submitted by indexed primitives, otherwise POSITION count, summed once per mesh definition.',
      sceneRenderVertices: 'Render vertices multiplied by mesh instances reachable from the active/default scene.',
      uploadVertices: 'POSITION accessor counts, deduplicated by accessor index within each GLB.',
      transformedBounds: 'Conservative world AABB made by transforming the eight corners of each POSITION accessor local min/max box.',
      estimatedDecodedRgba8Bytes: 'Width x height x 4 for every glTF image definition; an upper-bound estimate, not measured residency.',
      estimatedMipmappedRgba8Bytes: 'Complete RGBA8 mip pyramid down to 1x1; an upper-bound estimate, not measured residency.',
      duplicateHashes: 'Accessor/mesh/material/texture hashes omit names and extras and include rendering content; image/file hashes are exact bytes.',
    },
    scan: {
      discovered: scan.files.length,
      audited: assets.length,
      failed: errors.length,
      missingRoots: scan.missing.map((candidate) => projectPath(candidate, root)),
    },
    totals,
    byClassification: groupedTotals(assets, 'classification'),
    byScope: groupedTotals(assets, 'scope'),
    topOffenders: {
      fileBytes: topAssets(assets, 'fileBytes', (asset) => asset.bytes, topLimit),
      triangles: topAssets(assets, 'triangleCount', (asset) => asset.geometry.triangles, topLimit),
      sceneTriangles: topAssets(assets, 'sceneTriangleCount', (asset) => asset.geometry.sceneTriangles, topLimit),
      materials: topAssets(assets, 'materialCount', (asset) => asset.counts.materials, topLimit),
      primitives: topAssets(assets, 'primitiveCount', (asset) => asset.counts.primitives, topLimit),
      embeddedImageBytes: topAssets(assets, 'embeddedImageBytes', (asset) => asset.imageTotals.compressedBytes, topLimit),
      decodedTextureBytes: topAssets(assets, 'decodedTextureBytes', (asset) => asset.imageTotals.estimatedDecodedRgba8Bytes, topLimit),
      mipmappedTextureBytes: topAssets(assets, 'mipmappedTextureBytes', (asset) => asset.imageTotals.estimatedMipmappedRgba8Bytes, topLimit),
      transformedMaxDimension: topAssets(assets, 'transformedMaxDimension', (asset) => asset.scene.transformedBounds?.maxDimension || 0, topLimit),
      images: topImageOffenders(assets, topLimit),
    },
    duplicateSummary: duplicateSummary(duplicateGroups),
    duplicateGroups,
    errors,
    assets,
  };
  return report;
}

function csvCell(value) {
  if (value == null) return '';
  const text = Array.isArray(value) ? value.join('|') : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function reportCsv(report) {
  const columns = [
    ['file', (asset) => asset.file],
    ['classification', (asset) => asset.classification],
    ['scope', (asset) => asset.scope],
    ['bytes', (asset) => asset.bytes],
    ['sha256', (asset) => asset.sha256],
    ['triangles', (asset) => asset.geometry.triangles],
    ['sceneTriangles', (asset) => asset.geometry.sceneTriangles],
    ['renderVertices', (asset) => asset.geometry.renderVertices],
    ['sceneRenderVertices', (asset) => asset.geometry.sceneRenderVertices],
    ['uploadVertices', (asset) => asset.geometry.uploadVertices],
    ['nodes', (asset) => asset.counts.nodes],
    ['meshes', (asset) => asset.counts.meshes],
    ['meshInstances', (asset) => asset.counts.meshInstances],
    ['primitives', (asset) => asset.counts.primitives],
    ['materials', (asset) => asset.counts.materials],
    ['textures', (asset) => asset.counts.textures],
    ['images', (asset) => asset.counts.images],
    ['animations', (asset) => asset.counts.animations],
    ['cameras', (asset) => asset.counts.cameras],
    ['lights', (asset) => asset.counts.lights],
    ['imageCompressedBytes', (asset) => asset.imageTotals.compressedBytes],
    ['estimatedDecodedRgba8Bytes', (asset) => asset.imageTotals.estimatedDecodedRgba8Bytes],
    ['estimatedMipmappedRgba8Bytes', (asset) => asset.imageTotals.estimatedMipmappedRgba8Bytes],
    ['maxImageWidth', (asset) => asset.imageTotals.maxWidth],
    ['maxImageHeight', (asset) => asset.imageTotals.maxHeight],
    ['boundsMaxDimension', (asset) => asset.scene.transformedBounds?.maxDimension],
    ['boundsCenterOffset', (asset) => asset.scene.transformedBounds?.centerOffset],
    ['unreachableNodes', (asset) => asset.reachability.unreachableFromScenes.nodes.length],
    ['unreachableMeshes', (asset) => asset.reachability.unreachableFromScenes.meshes.length],
    ['unreachableMaterials', (asset) => asset.reachability.unreachableFromScenes.materials.length],
    ['unreachableTextures', (asset) => asset.reachability.unreachableFromScenes.textures.length],
    ['unreachableImages', (asset) => asset.reachability.unreachableFromScenes.images.length],
    ['duplicateAccessorGroups', (asset) => asset.duplicates.accessors.length],
    ['duplicateMeshGroups', (asset) => asset.duplicates.meshes.length],
    ['duplicateMaterialGroups', (asset) => asset.duplicates.materials.length],
    ['duplicateTextureGroups', (asset) => asset.duplicates.textures.length],
    ['duplicateImageGroups', (asset) => asset.duplicates.images.length],
    ['generator', (asset) => asset.asset.generator],
    ['extensionsUsed', (asset) => asset.extensions.used],
    ['geometryCompression', (asset) => asset.extensions.geometryCompression],
    ['textureCompression', (asset) => asset.extensions.textureCompression],
    ['warnings', (asset) => asset.warnings],
  ];
  const rows = [columns.map(([name]) => csvCell(name)).join(',')];
  for (const asset of report.assets) rows.push(columns.map(([, getter]) => csvCell(getter(asset))).join(','));
  return `${rows.join('\n')}\n`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function humanSummary(report) {
  const lines = [
    `ASSET FOOTPRINT AUDIT - ${report.scan.audited}/${report.scan.discovered} GLBs audited`,
    `  disk: ${formatBytes(report.totals.bytes)}`,
    `  geometry: ${report.totals.triangles.toLocaleString('en-US')} triangles, ${report.totals.uploadVertices.toLocaleString('en-US')} upload vertices`,
    `  resources: ${report.totals.meshes} meshes, ${report.totals.materials} materials, ${report.totals.textures} textures, ${report.totals.images} images`,
    `  embedded images: ${formatBytes(report.totals.embeddedImageCompressedBytes)} compressed, ${formatBytes(report.totals.estimatedMipmappedRgba8Bytes)} estimated RGBA8+mips`,
    `  duplicates: ${report.duplicateSummary.files.groups} file groups / ${formatBytes(report.duplicateSummary.files.redundantBytes)} redundant`,
  ];
  if (report.scan.failed) lines.push(`  parse failures: ${report.scan.failed}`);
  if (report.scan.missingRoots.length) lines.push(`  missing roots: ${report.scan.missingRoots.join(', ')}`);
  lines.push('', 'TOP FILES:');
  for (const asset of report.topOffenders.fileBytes.slice(0, 10)) {
    lines.push(`  ${formatBytes(asset.fileBytes).padStart(10)}  ${asset.triangles.toLocaleString('en-US').padStart(9)} tris  ${asset.file}`);
  }
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv) {
  const options = { roots: [], json: false, output: null, csv: null, topLimit: 25, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json') options.json = true;
    else if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--output') {
      if (!argv[index + 1]) throw new Error('--output requires a path');
      options.output = argv[++index];
    } else if (value === '--csv') {
      if (!argv[index + 1]) throw new Error('--csv requires a path');
      options.csv = argv[++index];
    } else if (value === '--top') {
      const parsed = Number(argv[++index]);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--top requires a positive integer');
      options.topLimit = parsed;
    } else if (value === '--root') {
      if (!argv[index + 1]) throw new Error('--root requires a path');
      options.roots.push(argv[++index]);
    } else if (value.startsWith('--')) throw new Error(`unknown option ${value}`);
    else options.roots.push(value);
  }
  if (!options.roots.length) options.roots.push('.');
  return options;
}

function cliHelp() {
  return `Usage: node tools/qa/asset-footprint-audit.mjs [options] [root ...]

Recursively scans GLBs without changing them. The default root is the repository working directory.

Options:
  --json             Print deterministic, pretty JSON to stdout
  --output PATH      Write deterministic JSON to PATH
  --csv PATH         Write one summary row per asset to PATH
  --root PATH        Add a scan root (repeatable; positional roots are also accepted)
  --top N            Retain N entries in each top-offender list (default: 25)
  --help, -h         Show this help
`;
}

export {
  REPORT_SCHEMA_VERSION,
  auditGlbBuffer,
  auditGlbFile,
  buildAssetFootprintReport,
  classifyAsset,
  imageDimensions,
  mipmappedRgba8Bytes,
  parseGlb,
  reportCsv,
  stableStringify,
  walkGlbFiles,
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(cliHelp());
    } else {
      const report = buildAssetFootprintReport({ roots: options.roots, topLimit: options.topLimit });
      const json = `${stableStringify(report, 2)}\n`;
      if (options.output) writeFileSync(resolve(options.output), json);
      if (options.csv) writeFileSync(resolve(options.csv), reportCsv(report));
      if (options.json && !options.output) process.stdout.write(json);
      else process.stdout.write(humanSummary(report));
      if (report.scan.failed || report.scan.missingRoots.length) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`asset-footprint-audit: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
