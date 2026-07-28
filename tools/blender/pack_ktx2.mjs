// Post-export step: bring a GLB's textures down to the resolution ceiling and
// compress them to KTX2/Basis.
//
// This is the half of the texture-memory policy that cannot happen in Blender.
// Blender exports PNG/JPEG, which decide download size only — the GPU is handed
// decoded RGBA either way, so a 1024² map costs 5.59 MB of VRAM whatever the file
// weighs. Two things change that number and both happen here:
//
//   --max-size   fewer texels.        1024² -> 512² is 4x.
//   KTX2/Basis   fewer bytes/texel.   RGBA8 -> BC7 is another 4x.
//
// Codec per slot, not one setting for the whole file:
//
//   baseColor, emissive        ETC1S  — small, and colour tolerates it well
//   normal                     UASTC  — ETC1S wrecks normals; the block endpoints
//                                       are chosen for perceptual colour, and a
//                                       normal map's channels are geometry
//   metallicRoughness, occlusion  ETC1S — independent data channels, but they are
//                                       low-frequency here and ETC1S holds up;
//                                       --data-uastc switches them if it does not
//
// Both transcode to BC7 at 1 byte/texel on any GPU with BPTC, so the choice is
// about encode quality, not runtime cost. See src/render3d/ktx2Support.js.
//
// Usage:
//   node tools/blender/pack_ktx2.mjs --in a.glb --out b.glb --max-size 512
//   node tools/blender/pack_ktx2.mjs --in a.glb --report        (measure only)

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { KHRTextureBasisu, KHRTextureTransform } from '@gltf-transform/extensions';
import { encodeToKTX2 } from 'ktx2-encoder';
import sharp from 'sharp';

const COLOUR_SLOTS = /^(baseColorTexture|emissiveTexture)$/;
const NORMAL_SLOTS = /^normalTexture$/;

function parseArgs(argv) {
  const out = { maxSize: 512, dataUastc: false, report: false, quality: 128 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--in') out.in = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--max-size') out.maxSize = Number(argv[++i]);
    else if (a === '--quality') out.quality = Number(argv[++i]);
    else if (a === '--data-uastc') out.dataUastc = true;
    else if (a === '--report') out.report = true;
    // Resolution lever without the format lever. Needed because KTX2 transcoding
    // requires a CSP relaxation this app has not adopted — see ART_BIBLE §7.3.
    else if (a === '--no-compress') out.noCompress = true;
  }
  if (!out.in) throw new Error('--in <file.glb> is required');
  return out;
}

const imageDecoder = async (buf) => {
  const img = sharp(Buffer.from(buf));
  const meta = await img.metadata();
  const data = await img.ensureAlpha().raw().toBuffer();
  return { width: meta.width, height: meta.height, data: new Uint8Array(data) };
};

/** Which material slots reference this texture, so the codec can follow the role. */
function slotsOf(document, texture) {
  const root = document.getRoot();
  return [...new Set(
    texture.getGraph().listParentEdges(texture)
      .filter((edge) => edge.getParent() !== root)
      .map((edge) => edge.getName()),
  )];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const io = new NodeIO().registerExtensions([KHRTextureBasisu, KHRTextureTransform]);
  const document = await io.read(args.in);
  const textures = document.getRoot().listTextures();
  const before = statSync(args.in).size;

  const rows = [];
  for (const texture of textures) {
    const mime = texture.getMimeType();
    const image = texture.getImage();
    const slots = slotsOf(document, texture);
    const meta = image ? await sharp(Buffer.from(image)).metadata() : null;
    rows.push({
      name: texture.getName() || '(unnamed)',
      mime,
      slots,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      bytesIn: image ? image.byteLength : 0,
    });
  }

  if (args.report) {
    const residentMB = rows.reduce(
      (acc, r) => acc + ((r.width || 0) * (r.height || 0) * 4 * (4 / 3)) / 1048576, 0,
    );
    console.log(JSON.stringify({
      file: args.in,
      glbBytes: before,
      textures: rows,
      estResidentRGBA8MB: +residentMB.toFixed(2),
    }, null, 2));
    return;
  }

  if (!args.out) throw new Error('--out <file.glb> is required unless --report');

  for (const texture of textures) {
    const image = texture.getImage();
    const mime = texture.getMimeType();
    if (!image || mime === 'image/ktx2') continue;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) continue;

    const slots = slotsOf(document, texture);
    const isColour = slots.some((s) => COLOUR_SLOTS.test(s));
    const isNormal = slots.some((s) => NORMAL_SLOTS.test(s));
    const uastc = isNormal || (!isColour && args.dataUastc);

    // 1. resolution ceiling, before compression so the encoder works on the
    //    pixels that will actually ship.
    let pixels = Buffer.from(image);
    let img = sharp(pixels);
    let meta = await img.metadata();
    if (args.maxSize && Math.max(meta.width, meta.height) > args.maxSize) {
      pixels = await img
        .resize({
          width: Math.min(meta.width, args.maxSize),
          height: Math.min(meta.height, args.maxSize),
          fit: 'inside',
          // Lanczos: a box filter on a normal or roughness map loses the
          // high-frequency detail that is the entire reason the map exists.
          kernel: 'lanczos3',
        })
        // KTX2/Basis requires dimensions divisible by 4 for the block codecs.
        .png({ compressionLevel: 9 })
        .toBuffer();
      meta = await sharp(pixels).metadata();
    }

    if (args.noCompress) {
      texture.setImage(new Uint8Array(pixels)).setMimeType('image/png');
      const row0 = rows.find((r) => r.name === (texture.getName() || '(unnamed)'));
      if (row0) {
        row0.codec = 'none (RGBA8)';
        row0.outWidth = meta.width;
        row0.outHeight = meta.height;
        row0.bytesOut = pixels.byteLength;
      }
      continue;
    }

    // 2. compress
    const ktx2Bytes = await encodeToKTX2(new Uint8Array(pixels), {
      imageDecoder,
      isUASTC: uastc,
      isKTX2File: true,
      generateMipmap: true,
      qualityLevel: args.quality,
      isNormalMap: isNormal,
      // Perceptual weighting and the sRGB transfer flag belong on colour only;
      // setting them on a roughness or normal map tells the encoder to spend bits
      // where a human eye would look, which is the wrong objective for data.
      isPerceptual: isColour,
      isSetKTX2SRGBTransferFunc: isColour,
      needSupercompression: uastc,
      isYFlip: false,
    });

    texture.setImage(ktx2Bytes).setMimeType('image/ktx2');
    const row = rows.find((r) => r.name === (texture.getName() || '(unnamed)'));
    if (row) {
      row.codec = uastc ? 'UASTC' : 'ETC1S';
      row.outWidth = meta.width;
      row.outHeight = meta.height;
      row.bytesOut = ktx2Bytes.byteLength;
    }
  }

  if (!args.noCompress) document.createExtension(KHRTextureBasisu).setRequired(true);
  await io.write(args.out, document);

  const after = statSync(args.out).size;
  const residentBefore = rows.reduce(
    (a, r) => a + ((r.width || 0) * (r.height || 0) * 4 * (4 / 3)) / 1048576, 0,
  );
  // BC7 on any GPU with BPTC, which is the target hardware; 1 byte per texel.
  const residentAfter = rows.reduce(
    (a, r) => a + ((r.outWidth || r.width || 0) * (r.outHeight || r.height || 0) * (args.noCompress ? 4 : 1) * (4 / 3)) / 1048576, 0,
  );
  console.log(JSON.stringify({
    in: args.in,
    out: args.out,
    maxSize: args.maxSize,
    glbBytesBefore: before,
    glbBytesAfter: after,
    estResidentBeforeMB: +residentBefore.toFixed(2),
    estResidentAfterMB: +residentAfter.toFixed(2),
    residentReduction: +(residentBefore / Math.max(residentAfter, 1e-9)).toFixed(2),
    textures: rows,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
