// Texture footprint for a set of GLBs, counted the way the GPU counts it.
//
// Why this exists. `Designs/ProShop/TEXTURE_MEMORY_POLICY.md` records the counting
// mistake that made the first measurement wrong by 78%: three.js keys an upload on
// (Source, parameter key), and `repeat`/`offset` are shader uniforms rather than part
// of that key. So N glTF textures pointing at ONE image cost ONE upload, and a tool
// that counts `textures` or `THREE.Texture` instances over-reports.
//
// This counts image BYTES — one entry per distinct embedded image, deduplicated by
// content hash ACROSS files, because a material shared between assets loads its map
// once for the whole scene. That cross-file dedup is the entire reason a 19-asset
// pass can add texture coverage without adding much texture memory.
//
//   node tools/blender/texture_footprint.mjs vendor/models/assets_51_100/sheet_07 ...
//
// Reports decoded RGBA + mip footprint (w*h*4*4/3), which is what the driver's
// `WebGLInfo.memory.textures` equivalent charges before any KTX2 transcode.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

function glbChunks(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const out = { json: null, bin: null };
  let off = 12;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) out.json = JSON.parse(body.toString('utf8'));
    if (type === 0x004e4942) out.bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4) * 0;
    off += (4 - (len % 4)) % 4;
  }
  return out;
}

/** Dimensions from the image's own header — never from a manifest. */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), kind: 'png' };
  }
  if (buf.length > 32 && buf[0] === 0xab && buf[1] === 0x4b && buf[2] === 0x54 && buf[3] === 0x58) {
    return { width: buf.readUInt32LE(20), height: buf.readUInt32LE(24), kind: 'ktx2' };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), kind: 'jpeg' };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function walk(target) {
  const st = statSync(target);
  if (st.isFile()) return target.endsWith('.glb') ? [target] : [];
  return readdirSync(target).flatMap((f) => walk(join(target, f)));
}

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('usage: node tools/blender/texture_footprint.mjs <glb-or-dir> ...');
  process.exit(2);
}

const sources = new Map();   // content hash -> { width, height, kind, bytes, users:Set }
const perFile = [];

for (const file of targets.flatMap(walk).sort()) {
  const { json, bin } = glbChunks(readFileSync(file));
  const images = json.images || [];
  const local = [];
  for (const img of images) {
    if (img.bufferView == null) continue;
    const bv = json.bufferViews[img.bufferView];
    const data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const hash = createHash('sha1').update(data).digest('hex');
    const size = imageSize(data) || { width: 0, height: 0, kind: 'unknown' };
    if (!sources.has(hash)) {
      sources.set(hash, { ...size, fileBytes: data.length, users: new Set() });
    }
    sources.get(hash).users.add(basename(file));
    local.push({ hash, ...size });
  }
  perFile.push({
    file: basename(file),
    materials: (json.materials || []).length,
    images: images.length,
    distinct: new Set(local.map((l) => l.hash)).size,
    textured: images.length > 0,
    gpuBytes: local.reduce((a, l) => a + (l.width || 0) * (l.height || 0) * 4 * (4 / 3), 0),
  });
}

// Decoded RGBA8 + full mip chain, which is what the GPU is handed for PNG/JPEG.
const MIP = 4 / 3;
let gpu = 0;
let disk = 0;
const bySize = new Map();
for (const s of sources.values()) {
  gpu += s.width * s.height * 4 * MIP;
  disk += s.fileBytes;
  const k = `${s.width}x${s.height}`;
  bySize.set(k, (bySize.get(k) || 0) + 1);
}

// Two bounds, because which one is true depends on the runtime, and quoting only the
// flattering one is how the sharedTexturePool "166 MB avoided" number went wrong.
//
//   deduped   every distinct image uploaded once. What the app gets WITH the shared
//             texture pool, since a GLB embedding the same bytes resolves to one upload.
//   perFile   every GLB's images uploaded independently. What a plain GLTFLoader does,
//             because each parse builds its own Source objects.
//
// The truth for any given scene is between them and depends on what is loaded together.
let perFileGpu = 0;
for (const f of perFile) perFileGpu += f.gpuBytes;

const out = {
  files: perFile.length,
  filesWithTextures: perFile.filter((f) => f.textured).length,
  distinctImageSources: sources.size,
  imageReferences: perFile.reduce((a, f) => a + f.images, 0),
  bySize: Object.fromEntries([...bySize].sort()),
  embeddedDiskMB: +(disk / 1048576).toFixed(2),
  decodedGpuMB: +(gpu / 1048576).toFixed(2),
  decodedGpuMBNoSharing: +(perFileGpu / 1048576).toFixed(2),
  perFile: perFile.map(({ gpuBytes, ...rest }) => rest),
};
console.log(JSON.stringify(out, null, 1));
