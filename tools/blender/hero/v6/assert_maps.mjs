/**
 * ARE THE FABRIC MAPS ACTUALLY IN THE FILE?
 *
 * Six revisions of fabric work -- the knit wale, the pique lattice, the
 * heather, the grain direction -- were authored as Bump nodes, and a Bump node
 * exports as NOTHING. Every garment shipped as a bare baseColorFactor and
 * every check in the pipeline was happy, because every check looked at the
 * Blender scene. This one opens the written file.
 *
 *   node assert_maps.mjs              # the eleven shipping assets
 *   node assert_maps.mjs --all        # every GLB in the hero dir
 *   node assert_maps.mjs --control    # prove the checker can fail AND pass
 *
 * A material is either FABRIC -- and must carry a normal map, an occlusion map
 * and a metallic-roughness map, all packed into the file -- or it is named in
 * HARDWARE below. A material that is in neither list FAILS: a new fabric that
 * nobody classified must not slip through as "not checked".
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const GLB_DIR = path.join(ROOT, "Assets", "models", "hero", "v5");

/** The eleven: ten garments plus the towel. */
const APPAREL = [
  "apparel_tee_hung.glb", "apparel_polo_hung.glb", "apparel_hoodie_hung.glb",
  "apparel_trousers_hung.glb", "apparel_cap.glb", "apparel_tee_folded.glb",
  "apparel_polo_folded.glb", "apparel_hoodie_folded.glb",
  "apparel_trousers_folded.glb", "apparel_cap_peg.glb", "hard_towel.glb",
];

/** The four hardgoods, which never went through the bake at all. */
const HARDGOODS = [
  "hard_driver.glb", "hard_putter.glb", "hard_iron.glb", "hard_counter.glb",
];

const SHIPPING = [...APPAREL, ...HARDGOODS];

/** Cloth. Matched as a case-insensitive substring of the material name. */
const FABRIC = [
  "twill", "fleece", "rib", "pique", "jersey", "terry", "trim", "under",
  "thread", "cord", "webbing",
];

/**
 * A GARMENT'S FINDINGS. A button, an eyelet, a hanger hook: millimetres
 * across, seen at shelf distance, and correct to ship as a plain factor.
 */
const FINDINGS = [
  "button", "eyelet", "metal", "wood", "hook", "steel", "chrome",
  "grommet", "clip", "buckle",
];

/**
 * A HARDGOOD'S OWN SURFACE, which is a different question entirely.
 *
 * On a shirt a chrome eyelet is a finding. On a driver the crown IS the
 * object -- it is the surface the whole asset is looked at for -- and the same
 * goes for a milled face, a corded grip and an oak counter top. Matched on the
 * asset's own prefix rather than on words like "metal" or "wood", because
 * those words also appear on garment findings that are right to leave bare,
 * and a substring list that tried to serve both would quietly change the
 * verdict on the eleven.
 */
const HARDGOOD = /^(driver|iron|putter|counter)/i;

function classify(name) {
  const n = (name || "").toLowerCase();
  if (HARDGOOD.test(n)) return "surface";
  // findings win over cloth: "CapMetal" is metal, and "HoodieEyelet" is an
  // eyelet even though a hoodie is cloth.
  if (FINDINGS.some((h) => n.includes(h))) return "finding";
  if (FABRIC.some((f) => n.includes(f))) return "fabric";
  return "unclassified";
}

/** Does this material have to carry the three maps? */
const NEEDS_MAPS = (kind) => kind === "fabric" || kind === "surface";

export function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`${path.basename(file)}: not a GLB`);
  }
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString("utf8"));
  let bin = null;
  let p = 20 + jsonLen;
  while (p + 8 <= b.length) {
    const len = b.readUInt32LE(p);
    const kind = b.readUInt32LE(p + 4);
    if (kind === 0x004e4942) { bin = b.slice(p + 8, p + 8 + len); break; }
    p += 8 + len;
  }
  return { json, bin, bytes: b.length };
}

function imageBytes(json, bin, img) {
  if (img._png) return img._png;                 // synthetic, control only
  if (img.bufferView === undefined || !bin) return null;
  const bv = (json.bufferViews || [])[img.bufferView];
  if (!bv) return null;
  const off = bv.byteOffset || 0;
  return bin.slice(off, off + bv.byteLength);
}

/** Mean and standard deviation per channel, 0..1. */
function stats(buf) {
  const png = PNG.sync.read(buf);
  const n = png.width * png.height;
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = png.data[i * 4 + c] / 255;
      sum[c] += v;
      sq[c] += v * v;
    }
  }
  const mean = sum.map((s) => s / n);
  const std = sq.map((s, c) => Math.sqrt(Math.max(0, s / n - mean[c] ** 2)));
  return { mean, std, w: png.width, h: png.height };
}

/**
 * IS THERE ANYTHING IN THE IMAGE?
 *
 * Assigning a colorspace to a generated image ZEROES its buffer in Blender
 * 5.1, and the first cut of the synthesiser did exactly that: seven solid
 * black tiles. The presence check above passed them all -- the normalTexture
 * was there, it just decoded to garbage -- and a black normal map is worse
 * than no normal map. So read the pixels.
 */
function contentFaults(kind, s, mat) {
  const bad = [];
  const [r, g, b] = s.mean;
  if (kind === "normal") {
    if (b < 0.70) {
      bad.push(`${mat}: normal map is not a normal map -- mean blue ${b.toFixed(3)}, `
        + `wanted > 0.70 (a flat surface encodes as 0.5, 0.5, 1.0)`);
    }
    if (Math.abs(r - 0.5) > 0.12 || Math.abs(g - 0.5) > 0.12) {
      bad.push(`${mat}: normal map is biased -- mean ${r.toFixed(3)}, ${g.toFixed(3)}, `
        + `wanted both near 0.5`);
    }
    if (s.std[0] < 0.004 && s.std[1] < 0.004) {
      bad.push(`${mat}: normal map is FLAT -- sd ${s.std[0].toFixed(4)}, `
        + `${s.std[1].toFixed(4)}. It costs bytes and does nothing.`);
    }
  } else {
    if (r < 0.25) {
      bad.push(`${mat}: occlusion channel means ${r.toFixed(3)} -- the whole `
        + `surface is in shadow`);
    }
    if (s.std[0] < 0.002) {
      bad.push(`${mat}: occlusion channel is FLAT (sd ${s.std[0].toFixed(4)})`);
    }
    if (g < 0.05) {
      bad.push(`${mat}: roughness channel means ${g.toFixed(3)} -- a mirror`);
    }
  }
  return bad;
}

/** Every fault this file can report, as a list of strings. */
export function faults(json, bin = null) {
  const bad = [];
  const images = json.images || [];
  const textures = json.textures || [];

  const texOk = (ti, what, mat, kind) => {
    if (ti === undefined || ti === null) {
      bad.push(`${mat}: no ${what}`);
      return;
    }
    const t = textures[ti.index];
    if (!t) {
      bad.push(`${mat}: ${what} points at texture ${ti.index}, which is not there`);
      return;
    }
    const img = images[t.source];
    if (!img) { bad.push(`${mat}: ${what} texture has no image`); return; }
    // PACKED, not a sibling file. An external URI is a broken asset the moment
    // the GLB is copied anywhere, and the game loads these by path.
    if (img.uri !== undefined) {
      bad.push(`${mat}: ${what} image is external (${img.uri})`);
      return;
    }
    if (img.bufferView === undefined && !img._png) {
      bad.push(`${mat}: ${what} image has neither bufferView nor uri`);
      return;
    }
    const buf = imageBytes(json, bin, img);
    if (!buf) return;                     // no BIN to read; presence is all we have
    if (img.mimeType && img.mimeType !== "image/png") return;
    let s;
    try {
      s = stats(buf);
    } catch (err) {
      bad.push(`${mat}: ${what} image will not decode (${err.message})`);
      return;
    }
    bad.push(...contentFaults(kind, s, `${mat} ${what}`));
  };

  for (const m of json.materials || []) {
    const kind = classify(m.name);
    if (kind === "unclassified") {
      bad.push(`${m.name}: unclassified -- add it to FABRIC, FINDINGS or HARDGOOD`);
      continue;
    }
    if (!NEEDS_MAPS(kind)) continue;
    // SHEEN WEIGHT IS DROPPED ON EXPORT. Measured across four authored
    // combinations in Blender 5.1: `Sheen Weight` never reaches the file and
    // `Sheen Tint` becomes sheenColorFactor verbatim. So cloth authored at 7%
    // sheen shipped at 100% WHITE sheen, and every grazing angle blew out --
    // which is why the hoodie's hood, an open tube seen from inside, read as a
    // silver plastic dome with a navy material.
    const sheen = (m.extensions || {}).KHR_materials_sheen;
    if (sheen) {
      const s = sheen.sheenColorFactor || [1, 1, 1];
      if (Math.max(...s) > 0.40) {
        bad.push(`${m.name}: sheenColorFactor ${s.map((x) => x.toFixed(2)).join(', ')} `
          + `-- that is the TINT with the weight dropped. Author weight 1.0 and `
          + `put the strength in the tint.`);
      }
    }
    const pbr = m.pbrMetallicRoughness || {};
    texOk(m.normalTexture, "normalTexture", m.name, "normal");
    texOk(m.occlusionTexture, "occlusionTexture", m.name, "orm");
    texOk(pbr.metallicRoughnessTexture, "metallicRoughnessTexture", m.name, "orm");
  }

  // BAKED MACRO OCCLUSION. The tiling ORM carries the cavity between two
  // yarns or two mill marks; it cannot carry the shadow a sole casts into a
  // cavity back, because that belongs to that object once and does not
  // repeat. It rides in COLOR_0, which is per PRIMITIVE, not per material.
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const mat = (json.materials || [])[prim.material];
      if (!mat || !NEEDS_MAPS(classify(mat.name))) continue;
      if (prim.attributes.COLOR_0 === undefined) {
        bad.push(`${mesh.name || "?"} / ${mat.name}: no COLOR_0 -- no baked `
          + `macro occlusion on this primitive`);
      }
    }
  }
  return bad;
}

function check(files) {
  let failed = 0;
  console.log();
  console.log("=".repeat(78));
  console.log("SURFACE MAPS IN THE FILE");
  console.log("=".repeat(78));
  for (const f of files) {
    const p = path.join(GLB_DIR, f);
    if (!fs.existsSync(p)) {
      console.log(`  ${f.padEnd(30)} MISSING`);
      failed++;
      continue;
    }
    const { json, bin, bytes } = readGlb(p);
    const bad = faults(json, bin);
    const kinds = (json.materials || []).map((m) => classify(m.name));
    const nFab = kinds.filter((k) => NEEDS_MAPS(k)).length;
    const head = `  ${f.padEnd(30)} `
      + `${String((json.images || []).length).padStart(2)} img `
      + `${String((json.textures || []).length).padStart(2)} tex  `
      + `${String(nFab).padStart(2)} mapped mat  ${(bytes / 1024).toFixed(0).padStart(5)} KiB`;
    if (bad.length) {
      failed++;
      console.log(`${head}   FAIL`);
      for (const line of bad) console.log(`      ${line}`);
    } else {
      console.log(`${head}   ok`);
    }
  }
  console.log();
  if (failed) {
    console.log(`FAILED: ${failed} of ${files.length} assets ship a mapped `
      + `surface without its maps.`);
    return 1;
  }
  console.log(`all ${files.length} assets carry packed normal, occlusion and `
    + `metallic-roughness maps, and baked COLOR_0, on every mapped surface`);
  return 0;
}

/**
 * THE CONTROL. A check that only ever fails proves as little as one that only
 * ever passes: it could be reading the wrong field, or no field at all. So
 * build the material eight ways and require the verdict to change.
 */
function control() {
  // Real PNGs, so the content half of the checker is exercised too. `png()`
  // takes a function of (x, y) returning [r, g, b] in 0..1.
  const png = (fn, n = 32) => {
    const im = new PNG({ width: n, height: n });
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const c = fn(x / n, y / n);
        const i = (y * n + x) * 4;
        im.data[i] = Math.round(c[0] * 255);
        im.data[i + 1] = Math.round(c[1] * 255);
        im.data[i + 2] = Math.round(c[2] * 255);
        im.data[i + 3] = 255;
      }
    }
    return PNG.sync.write(im);
  };
  const wobble = (u, v) => 0.5 + 0.30 * Math.sin(u * 8 * Math.PI)
    * Math.sin(v * 8 * Math.PI);
  const GOOD_N = png((u, v) => [wobble(u, v), wobble(v, u), 0.94]);
  const GOOD_ORM = png((u, v) => [0.55 + 0.35 * wobble(u, v), 0.8, 0.0]);
  const BLACK = png(() => [0, 0, 0]);
  const FLAT_N = png(() => [0.5, 0.5, 1.0]);

  const base = (nrm = GOOD_N, orm = GOOD_ORM) => ({
    images: [{ _png: nrm, mimeType: "image/png" },
             { _png: orm, mimeType: "image/png" }],
    textures: [{ source: 0 }, { source: 1 }],
    materials: [{
      name: "ControlPique",
      normalTexture: { index: 0 },
      occlusionTexture: { index: 1 },
      pbrMetallicRoughness: { metallicRoughnessTexture: { index: 1 } },
    }],
  });
  const drop = (f) => { const g = base(); f(g); return g; };

  const cases = [
    ["a complete fabric material", base(), true],
    ["a hardware material with no maps at all",
      { materials: [{ name: "hangerWood" }] }, true],
    ["fabric with the normal map removed",
      drop((g) => delete g.materials[0].normalTexture), false],
    ["fabric with the occlusion map removed",
      drop((g) => delete g.materials[0].occlusionTexture), false],
    ["fabric with the roughness map removed",
      drop((g) => delete g.materials[0].pbrMetallicRoughness), false],
    ["a normal map whose image is an external file",
      drop((g) => { g.images[0] = { uri: "weave_n.png" }; }), false],
    ["a normal map pointing at a texture that is not there",
      drop((g) => { g.materials[0].normalTexture = { index: 9 }; }), false],
    ["a fabric nobody classified",
      drop((g) => { g.materials[0].name = "PoloSomethingNew"; }), false],
    // THE HARDGOOD SURFACE CLASS, and the baked occlusion. New code needs new
    // cases or it is untested code with a green control beside it.
    ["a driver crown with no maps at all",
      { materials: [{ name: "DriverCrown" }] }, false],
    ["a putter grip with no maps at all",
      { materials: [{ name: "PutterGrip" }] }, false],
    ["a garment finding -- a hanger hook -- with no maps",
      { materials: [{ name: "hangerHook" }] }, true],
    ["a mapped surface on a primitive that carries COLOR_0",
      (() => {
        const g = base();
        g.meshes = [{ name: "m", primitives: [{ material: 0, attributes: { COLOR_0: 3 } }] }];
        return g;
      })(), true],
    ["a mapped surface on a primitive with NO COLOR_0",
      (() => {
        const g = base();
        g.meshes = [{ name: "m", primitives: [{ material: 0, attributes: {} }] }];
        return g;
      })(), false],
    ["a FINDING on a primitive with no COLOR_0, which is fine",
      { materials: [{ name: "PoloButton" }],
        meshes: [{ name: "b", primitives: [{ material: 0, attributes: {} }] }] }, true],
    ["a fabric with a believable sheen",
      drop((g) => {
        g.materials[0].extensions = {
          KHR_materials_sheen: { sheenColorFactor: [0.17, 0.17, 0.17] } };
      }), true],
    ["a fabric shipping FULL WHITE sheen because the weight was dropped",
      drop((g) => {
        g.materials[0].extensions = {
          KHR_materials_sheen: { sheenColorFactor: [1, 1, 1] } };
      }), false],
    // THE ONE THAT NEARLY SHIPPED. Every field present, every index valid,
    // and the image is solid black because assigning a colorspace after
    // writing the pixels wipes the buffer.
    ["a normal map that is present and SOLID BLACK", base(BLACK), false],
    ["an ORM that is present and solid black", base(GOOD_N, BLACK), false],
    ["a normal map that is present and perfectly FLAT", base(FLAT_N), false],
    ["a normal map that will not decode",
      drop((g) => { g.images[0]._png = Buffer.from("not a png"); }), false],
  ];
  console.log();
  console.log("CONTROL -- the checker must change its answer for each of these");
  let wrong = 0;
  for (const [what, glb, shouldPass] of cases) {
    const bad = faults(glb);
    const passed = bad.length === 0;
    const ok = passed === shouldPass;
    if (!ok) wrong++;
    console.log(`  ${ok ? "ok   " : "WRONG"}  ${passed ? "passes" : "fails "}  ${what}`
      + (bad.length ? `
            -> ${bad[0]}` : ""));
  }
  console.log();
  if (wrong) {
    console.log(`CONTROL FAILED: ${wrong} of ${cases.length} verdicts were wrong.`);
    return 1;
  }
  console.log(`control passed: ${cases.length} of ${cases.length}. The checker `
    + `tells a mapped material from an unmapped one, and a real map from a `
    + `black one.`);
  return 0;
}

const argv = process.argv.slice(2);
if (argv.includes("--control")) {
  process.exit(control());
} else {
  const files = argv.includes("--all")
    ? fs.readdirSync(GLB_DIR).filter((f) => f.endsWith(".glb")).sort()
    : SHIPPING;
  process.exit(check(files));
}
