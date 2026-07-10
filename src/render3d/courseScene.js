// FAIRWAY STATE — the realistic 3D course view.
// A Three.js scene driven entirely by the serialized GameState: smoothed heightmap
// terrain with a splat shader (mow stripes, health browning, disease mottle, data
// views, plan ghost), carved ponds with water surfaces, instanced trees, sun/sky
// with time-of-day and weather, and 3D hole furniture (flags, tee markers, badges).
// World units are YARDS; 1 cell = 8x8 yd. The sim never knows this file exists.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ZONE, HOLE_STATUS, CELL_YD } from '../sim/constants.js';
import { holeNumber } from '../sim/course.js';
import { BALANCE } from '../sim/balance.js';
import { clamp } from '../core/utils.js';
import { makeCameraRig } from './cameraRig.js';
import { makeGrassTexture, makeSandTexture, makeScrubTexture, makePathTexture } from './proceduralTextures.js';
import { ZONE_COLORS } from '../render/palette.js';

const ELEV_FT_TO_YD = (1 / 3) * 1.5; // real feet→yards with 1.5x readability exaggeration
const SEG_PER_CELL = 2;

// --- real tree models (Kenney Nature Kit, CC0) — loaded once, shared across scenes ---
const TREE_FILES = {
  deciduous: ['tree_default', 'tree_oak', 'tree_detailed', 'tree_fat'],
  pine: ['tree_pineDefaultA', 'tree_pineRoundB'],
};
let treeAssetsPromise = null;

function loadTreeAssets() {
  if (treeAssetsPromise) return treeAssetsPromise;
  const loader = new GLTFLoader();

  const loadOne = (name) =>
    new Promise((resolve) => {
      loader.load(
        `vendor/models/trees/${name}.glb`,
        (gltf) => {
          try {
            gltf.scene.updateMatrixWorld(true);
            // gather geometry per material, transforms baked in
            const groups = new Map();
            gltf.scene.traverse((o) => {
              if (!o.isMesh || !o.geometry) return;
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              // per-group split for multi-material meshes is rare in this kit;
              // treat the whole mesh as its first material
              const mat = mats[0];
              const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
              // keep merges compatible: position + normal only (flat-color kit)
              for (const attr of Object.keys(g.attributes)) {
                if (attr !== 'position' && attr !== 'normal') g.deleteAttribute(attr);
              }
              if (!groups.has(mat.uuid)) groups.set(mat.uuid, { mat, list: [] });
              groups.get(mat.uuid).list.push(g);
            });
            const parts = [];
            const isPineModel = /pine/i.test(name);
            let partIdx = 0;
            for (const { mat, list } of groups.values()) {
              const merged = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
              // Kenney's pastel-mint palette reads toy-like against photo ground —
              // remap: green-dominant parts become believable leaf greens, the
              // rest becomes bark brown. Shapes stay, colors get real.
              const src = mat.color || new THREE.Color(0xffffff);
              const isFoliage = src.g > src.r * 1.02;
              const color = new THREE.Color();
              if (isFoliage) {
                const hueJitter = ((name.charCodeAt(5) + partIdx * 37) % 10) / 10;
                if (isPineModel) color.setHSL(0.34 + hueJitter * 0.03, 0.42, 0.2 + hueJitter * 0.04);
                else color.setHSL(0.26 + hueJitter * 0.05, 0.46, 0.26 + hueJitter * 0.05);
              } else {
                color.setHSL(0.07, 0.35, 0.24); // bark
              }
              const material = new THREE.MeshStandardMaterial({
                color,
                roughness: 0.92,
                metalness: 0,
              });
              parts.push({ geometry: merged, material });
              partIdx++;
            }
            // normalize the whole tree: feet on y=0, centered, height exactly 1
            const box = new THREE.Box3();
            for (const p of parts) {
              p.geometry.computeBoundingBox();
              box.union(p.geometry.boundingBox);
            }
            const height = Math.max(0.001, box.max.y - box.min.y);
            const cx = (box.min.x + box.max.x) / 2;
            const cz = (box.min.z + box.max.z) / 2;
            for (const p of parts) {
              p.geometry.translate(-cx, -box.min.y, -cz);
              p.geometry.scale(1 / height, 1 / height, 1 / height);
              p.geometry.computeBoundingSphere();
            }
            resolve({ name, parts });
          } catch (e) {
            console.warn(`tree model ${name} parse failed`, e);
            resolve(null);
          }
        },
        undefined,
        () => resolve(null),
      );
    });

  treeAssetsPromise = Promise.all([
    Promise.all(TREE_FILES.deciduous.map(loadOne)),
    Promise.all(TREE_FILES.pine.map(loadOne)),
  ]).then(([dec, pine]) => ({
    deciduous: dec.filter(Boolean),
    pine: pine.filter(Boolean),
  }));
  return treeAssetsPromise;
}

const GLSL_NOISE = /* glsl */ `
  float fwHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float fwNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(fwHash(i), fwHash(i + vec2(1, 0)), u.x),
               mix(fwHash(i + vec2(0, 1)), fwHash(i + vec2(1, 1)), u.x), u.y);
  }
  vec3 fwHeat(float h) {
    vec3 red = vec3(0.75, 0.16, 0.12);
    vec3 yel = vec3(0.88, 0.76, 0.22);
    vec3 grn = vec3(0.2, 0.62, 0.2);
    return h < 0.5 ? mix(red, yel, h * 2.0) : mix(yel, grn, (h - 0.5) * 2.0);
  }
`;

function hexToVec3(hex) {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

export function makeCourseScene(canvas, state) {
  const course = state.course;
  const W = course.w;
  const H = course.h;
  const worldW = W * CELL_YD;
  const worldH = H * CELL_YD;

  // --- renderer / scene / camera -------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92; // AO darkens; retuned with the post stack

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9db8c9, 0.00035);

  const camera = new THREE.PerspectiveCamera(46, 1, 1, 6000);
  const rig = makeCameraRig(camera, worldW, worldH);

  // --- post-processing: render → GTAO contact shadows → gentle bloom → output ---
  const composerTarget = new THREE.WebGLRenderTarget(2, 2, {
    samples: 4, // keep MSAA edges through the composer
    type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 2, 2);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({
    radius: 3.0, // yards — readable grounding at management camera distances
    distanceExponent: 1,
    thickness: 1,
    scale: 1.2,
    samples: 12,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 8 });
  composer.addPass(gtao);
  // the physical Sky emits HDR radiance in the tens (sun disc: thousands) — the
  // bloom threshold must clear the whole sky field so only sun/glint energy blooms
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.5, 0.35, 40.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let postEnabled = true;

  // --- lights & sky -----------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xffffff, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -worldW * 0.62;
  sc.right = worldW * 0.62;
  sc.top = worldH * 0.75;
  sc.bottom = -worldH * 0.75;
  sc.near = 50;
  sc.far = 2600;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 1.2;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbdd6ee, 0x40512e, 0.85);
  scene.add(hemi);

  const sky = new Sky();
  sky.scale.setScalar(20000);
  const skyU = sky.material.uniforms;
  skyU.turbidity.value = 6;
  skyU.rayleigh.value = 1.6;
  skyU.mieCoefficient.value = 0.004;
  skyU.mieDirectionalG.value = 0.8;
  scene.add(sky);

  // --- ground textures: real CC0 PBR sets (Poly Haven), procedural fallback ------------
  const texLoader = new THREE.TextureLoader();

  function loadGroundTex(file, { srgb = false, fallback = null } = {}) {
    const tex = texLoader.load(
      `vendor/textures/${file}`,
      undefined,
      undefined,
      () => {
        // offline / missing file: fall back to the old procedural look for this slot
        if (fallback) {
          const proc = fallback();
          tex.image = proc.image;
          tex.needsUpdate = true;
          console.warn(`ground texture ${file} missing — procedural fallback in use`);
        }
      },
    );
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  const texFair = loadGroundTex('fairway_diff.jpg', { srgb: true, fallback: () => makeGrassTexture({ seed: 3, base: '#5f9c44', dark: '#4d8236', light: '#74b556' }) });
  const texFairN = loadGroundTex('fairway_nor.jpg');
  const texRough = loadGroundTex('rough_diff.jpg', { srgb: true, fallback: () => makeGrassTexture({ seed: 9, base: '#47752f', dark: '#385f24', light: '#568a3c', blades: 6500 }) });
  const texRoughN = loadGroundTex('rough_nor.jpg');
  const texSand = loadGroundTex('sand_diff.jpg', { srgb: true, fallback: () => makeSandTexture({}) });
  const texSandN = loadGroundTex('sand_nor.jpg');
  const texScrub = loadGroundTex('scrub_diff.jpg', { srgb: true, fallback: () => makeScrubTexture({}) });
  const texScrubN = loadGroundTex('scrub_nor.jpg');
  const texPath = loadGroundTex('path_diff.jpg', { srgb: true, fallback: () => makePathTexture({}) });
  const texPathN = loadGroundTex('path_nor.jpg');

  // --- data textures fed from sim state --------------------------------------------------
  const zoneData = new Uint8Array(W * H * 4);
  const auxData = new Uint8Array(W * H * 4);
  const planData = new Uint8Array(W * H * 4);
  const zoneTex = new THREE.DataTexture(zoneData, W, H);
  const auxTex = new THREE.DataTexture(auxData, W, H);
  const planTex = new THREE.DataTexture(planData, W, H);
  for (const t of [zoneTex, auxTex, planTex]) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }

  // --- terrain ------------------------------------------------------------------------------
  const segsX = W * SEG_PER_CELL;
  const segsY = H * SEG_PER_CELL;
  const vertsX = segsX + 1;
  const vertsY = segsY + 1;
  const heights = new Float32Array(vertsX * vertsY);
  let waterMeshes = [];

  function elevAtCell(cx, cy) {
    const x = clamp(cx, 0, W - 1);
    const y = clamp(cy, 0, H - 1);
    return course.elevation[y * W + x] * ELEV_FT_TO_YD;
  }

  function isWaterCell(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return 0;
    return course.zones[cy * W + cx] === ZONE.WATER ? 1 : 0;
  }

  // bilinear ground height (before water carve) at fractional cell coords
  function rawHeightAtCellCoords(fx, fy) {
    const x0 = Math.floor(fx - 0.5);
    const y0 = Math.floor(fy - 0.5);
    const tx = fx - 0.5 - x0;
    const ty = fy - 0.5 - y0;
    const h00 = elevAtCell(x0, y0);
    const h10 = elevAtCell(x0 + 1, y0);
    const h01 = elevAtCell(x0, y0 + 1);
    const h11 = elevAtCell(x0 + 1, y0 + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
  }

  function waterMaskAtCellCoords(fx, fy) {
    const x0 = Math.floor(fx - 0.5);
    const y0 = Math.floor(fy - 0.5);
    const tx = fx - 0.5 - x0;
    const ty = fy - 0.5 - y0;
    const m00 = isWaterCell(x0, y0);
    const m10 = isWaterCell(x0 + 1, y0);
    const m01 = isWaterCell(x0, y0 + 1);
    const m11 = isWaterCell(x0 + 1, y0 + 1);
    return (m00 * (1 - tx) + m10 * tx) * (1 - ty) + (m01 * (1 - tx) + m11 * tx) * ty;
  }

  const terrainGeo = new THREE.PlaneGeometry(worldW, worldH, segsX, segsY);
  terrainGeo.rotateX(-Math.PI / 2); // XZ plane, +Y up; UV v runs 0 at -z edge after rotation? verify via raycast mapping below

  const terrainMat = new THREE.MeshStandardMaterial({
    map: texFair,
    normalMap: texFairN, // enables the tangent-frame normal path; shader picks per-zone
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 1.0,
    metalness: 0.0,
  });

  const shaderRefs = { uniforms: null };
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uZoneTex = { value: zoneTex };
    shader.uniforms.uAuxTex = { value: auxTex };
    shader.uniforms.uPlanTex = { value: planTex };
    shader.uniforms.uCells = { value: new THREE.Vector2(W, H) };
    shader.uniforms.uViewMode = { value: 0 };
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uStripeModes = { value: new THREE.Vector3(1, 1, 1) }; // green, fairway, tee
    shader.uniforms.tRough = { value: texRough };
    shader.uniforms.tSand = { value: texSand };
    shader.uniforms.tScrub = { value: texScrub };
    shader.uniforms.tPath = { value: texPath };
    shader.uniforms.tRoughN = { value: texRoughN };
    shader.uniforms.tSandN = { value: texSandN };
    shader.uniforms.tScrubN = { value: texScrubN };
    shader.uniforms.tPathN = { value: texPathN };
    shaderRefs.uniforms = shader.uniforms;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWp;
        uniform sampler2D uZoneTex, uAuxTex, uPlanTex, tRough, tSand, tScrub, tPath;
        uniform sampler2D tRoughN, tSandN, tScrubN, tPathN;
        uniform vec2 uCells;
        uniform float uViewMode, uTime;
        uniform vec3 uStripeModes;
        vec3 gSplatN = vec3(0.5, 0.5, 1.0);
        vec2 gSplatUv = vec2(0.0);
        float gSplatRough = 0.95;
        ${GLSL_NOISE}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        {
          // geometry row 0 sits at -z but UV v runs the other way — flip v so the
          // data textures line up with world positions
          vec2 flippedUv = vec2(vMapUv.x, 1.0 - vMapUv.y);
          vec2 cellUv = flippedUv * uCells;
          float wn1 = fwNoise(cellUv * 1.6 + 13.1) * 0.75 + fwNoise(cellUv * 5.2 + 40.0) * 0.25;
          float wn2 = fwNoise(cellUv * 1.6 + 71.7) * 0.75 + fwNoise(cellUv * 5.2 + 90.0) * 0.25;
          vec2 warped = cellUv + (vec2(wn1, wn2) - 0.5) * 0.9;
          warped = clamp(warped, vec2(0.0), uCells - 0.001);
          vec2 sUv = (floor(warped) + 0.5) / uCells;
          vec4 zd = texture2D(uZoneTex, sUv);
          float zone = floor(zd.r * 255.0 / 30.0 + 0.5);
          float hRel = zd.a * 255.0 / 64.0;
          vec4 ax = texture2D(uAuxTex, sUv);
          float disType = floor(ax.r * 255.0 / 100.0 + 0.5);
          float disSev = ax.g;

          // smooth (manual bilinear) reads for the condition tints so per-cell
          // variance doesn't render as camouflage blocks
          vec2 texel = 1.0 / uCells;
          vec2 bUv = (cellUv - 0.5) * texel;
          vec2 bF = fract(cellUv - 0.5);
          vec2 b0 = (floor(cellUv - 0.5) + 0.5) * texel;
          vec4 z00 = texture2D(uZoneTex, b0);
          vec4 z10 = texture2D(uZoneTex, b0 + vec2(texel.x, 0.0));
          vec4 z01 = texture2D(uZoneTex, b0 + vec2(0.0, texel.y));
          vec4 z11 = texture2D(uZoneTex, b0 + texel);
          vec4 zSmooth = mix(mix(z00, z10, bF.x), mix(z01, z11, bF.x), bF.y);
          float health = zSmooth.g;
          float wear = zSmooth.b;
          vec4 a00 = texture2D(uAuxTex, b0);
          vec4 a10 = texture2D(uAuxTex, b0 + vec2(texel.x, 0.0));
          vec4 a01 = texture2D(uAuxTex, b0 + vec2(0.0, texel.y));
          vec4 a11 = texture2D(uAuxTex, b0 + texel);
          float moisture = mix(mix(a00, a10, bF.x), mix(a01, a11, bF.x), bF.y).b;

          // real PBR surfaces — sample every set in uniform control flow so mip
          // derivatives stay valid across warped zone borders, then select
          vec2 wxz = vWp.xz;
          vec2 uvFair = wxz * 0.16;   // ~6 yd repeat: blade detail at play zoom
          vec2 uvGreen = wxz * 0.30;  // tighter cut on the greens
          vec2 uvTee = wxz * 0.24;
          vec2 uvRough = wxz * 0.12;
          vec2 uvSand = wxz * 0.11;
          vec2 uvScrub = wxz * 0.14;
          vec2 uvPath = wxz * 0.30;

          vec3 dFair = texture2D(map, uvFair).rgb;
          vec3 dGreen = texture2D(map, uvGreen).rgb;
          vec3 dTee = texture2D(map, uvTee).rgb;
          vec3 dRough = texture2D(tRough, uvRough).rgb;
          vec3 dSand = texture2D(tSand, uvSand).rgb;
          vec3 dScrub = texture2D(tScrub, uvScrub).rgb;
          vec3 dPath = texture2D(tPath, uvPath).rgb;

          vec3 nFair = texture2D(normalMap, uvFair).xyz;
          vec3 nGreen = texture2D(normalMap, uvGreen).xyz;
          vec3 nTee = texture2D(normalMap, uvTee).xyz;
          vec3 nRough = texture2D(tRoughN, uvRough).xyz;
          vec3 nSand = texture2D(tSandN, uvSand).xyz;
          vec3 nScrub = texture2D(tScrubN, uvScrub).xyz;
          vec3 nPath = texture2D(tPathN, uvPath).xyz;

          vec3 col;
          float stripeAmp = 0.0;
          float stripeFreq = 0.0;
          float modeSel = 0.0;
          if (zone < 0.5) {
            col = dScrub * 0.98; gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.97;
          } else if (zone < 1.5) {
            col = dRough * vec3(0.62, 0.88, 0.5); gSplatN = nRough; gSplatUv = uvRough; gSplatRough = 0.96;
          } else if (zone < 2.5) {
            col = dFair * vec3(0.68, 0.98, 0.55); gSplatN = nFair; gSplatUv = uvFair; gSplatRough = 0.94;
            stripeAmp = 0.1; stripeFreq = 0.062; modeSel = uStripeModes.y;
          } else if (zone < 3.5) {
            col = dGreen * vec3(0.78, 1.04, 0.6); gSplatN = nGreen; gSplatUv = uvGreen; gSplatRough = 0.9;
            stripeAmp = 0.085; stripeFreq = 0.24; modeSel = uStripeModes.x;
          } else if (zone < 4.5) {
            col = dTee * vec3(0.74, 1.0, 0.58); gSplatN = nTee; gSplatUv = uvTee; gSplatRough = 0.93;
            stripeAmp = 0.08; stripeFreq = 0.16; modeSel = uStripeModes.z;
          } else if (zone < 5.5) {
            col = dSand * 1.04; gSplatN = nSand; gSplatUv = uvSand; gSplatRough = 0.82;
          } else if (zone < 6.5) {
            col = dScrub * vec3(0.45, 0.5, 0.45); gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.85;
          } else {
            col = dPath; gSplatN = nPath; gSplatUv = uvPath; gSplatRough = 0.9;
          }
          // large-scale luminance drift breaks photo-texture tiling repetition
          col *= 0.93 + fwNoise(cellUv * 0.33) * 0.14;

          if (stripeAmp > 0.001 && modeSel > 0.5) {
            float fade = clamp(1.7 - hRel, 0.0, 1.0);
            vec2 dir1 = normalize(vec2(1.0, 0.32));
            vec2 dir2 = normalize(vec2(-dir1.y, dir1.x));
            float s1 = sin(dot(vWp.xz, dir1) * stripeFreq * 6.28318);
            float band = smoothstep(-0.35, 0.35, s1) * 2.0 - 1.0;
            if (modeSel > 1.5) {
              float s2 = sin(dot(vWp.xz, dir2) * stripeFreq * 6.28318);
              band = (band + (smoothstep(-0.35, 0.35, s2) * 2.0 - 1.0)) * 0.6;
            }
            col *= 1.0 + band * stripeAmp * fade;
          }

          if (zone > 0.5 && zone < 4.5) {
            float dry = clamp(1.0 - health / 0.78, 0.0, 1.0);
            // real grass photos already carry dry texture — tint lighter than before
            col = mix(col, vec3(0.56, 0.47, 0.26), dry * 0.42);
            col = mix(col, vec3(0.46, 0.39, 0.27), smoothstep(0.45, 1.0, wear) * 0.5);
            if (disSev > 0.03) {
              float spots = fwNoise(cellUv * (disType < 1.5 ? 6.5 : 3.2) + disType * 31.0);
              float cut = 1.0 - disSev * 0.6;
              float blot = smoothstep(cut, cut + 0.12, spots);
              vec3 blotch = disType < 1.5 ? vec3(0.84, 0.79, 0.6) : vec3(0.52, 0.4, 0.24);
              col = mix(col, blotch, blot * 0.78);
            }
          }

          if (uViewMode > 0.5 && uViewMode < 1.5) {
            col = (zone > 0.5 && zone < 4.5) ? fwHeat(health) : col * 0.22;
          } else if (uViewMode > 1.5) {
            col = (zone > 0.5 && zone < 4.5)
              ? mix(vec3(0.76, 0.66, 0.44), vec3(0.14, 0.34, 0.72), moisture)
              : col * 0.22;
          }

          vec2 pUv = (floor(cellUv) + 0.5) / uCells;
          vec4 plan = texture2D(uPlanTex, pUv);
          if (plan.a > 0.05) {
            float pulse = 0.7 + 0.3 * sin(uTime * 4.5);
            col = mix(col, plan.rgb, 0.6 * pulse * plan.a);
          }

          diffuseColor.rgb *= 0.0;
          diffuseColor.rgb += col;
        }
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        {
          // apply the per-zone PBR normal picked in the splat stage, using a
          // derivative tangent frame against the SAME world-scaled uv
          vec3 mapN = gSplatN * 2.0 - 1.0;
          mapN.xy *= normalScale;
          mat3 tbnSplat = getTangentFrame( - vViewPosition, normal, gSplatUv );
          normal = normalize( tbnSplat * mapN );
        }
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ 'float roughnessFactor = gSplatRough;',
      );
  };

  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  terrain.castShadow = true; // rolling land self-shadows at low sun
  scene.add(terrain);

  // purely visual micro-undulation so gentle land still catches light;
  // damped on greens/tees so putting surfaces read flat and true
  function microRelief(fx, fy) {
    const n =
      Math.sin(fx * 0.9 + Math.sin(fy * 0.55) * 1.7) * Math.cos(fy * 0.74 + Math.sin(fx * 0.42) * 1.3) * 0.34 +
      Math.sin(fx * 2.3 + 1.7) * Math.cos(fy * 1.9 + 0.6) * 0.12;
    const cx = clamp(Math.floor(fx), 0, W - 1);
    const cy = clamp(Math.floor(fy), 0, H - 1);
    const zone = course.zones[cy * W + cx];
    const damp = zone === ZONE.GREEN || zone === ZONE.TEE ? 0.12 : zone === ZONE.BUNKER ? 0.4 : 1;
    return n * damp;
  }

  function rebuildTerrainHeights() {
    const pos = terrainGeo.attributes.position;
    let vi = 0;
    for (let vy = 0; vy < vertsY; vy++) {
      for (let vx = 0; vx < vertsX; vx++, vi++) {
        const fx = (vx / SEG_PER_CELL);
        const fy = (vy / SEG_PER_CELL);
        let h = rawHeightAtCellCoords(fx, fy) + microRelief(fx, fy);
        const wm = waterMaskAtCellCoords(fx, fy);
        if (wm > 0.01) h -= wm * 2.3; // carve pond bowls
        heights[vy * vertsX + vx] = h;
        pos.setY(vi, h);
      }
    }
    pos.needsUpdate = true;
    terrainGeo.computeVertexNormals();
    // exaggerate slope shading so gentle golf-course land still reads in the light
    const nrm = terrainGeo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) {
      const nx = nrm.getX(i);
      const ny = nrm.getY(i) * 0.55;
      const nz = nrm.getZ(i);
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nrm.setXYZ(i, nx / len, ny / len, nz / len);
    }
    nrm.needsUpdate = true;
    terrainGeo.computeBoundingSphere();
  }

  // ground height lookup in world coords (post-carve)
  function heightAt(x, z) {
    const fx = clamp((x + worldW / 2) / CELL_YD, 0, W - 0.001);
    const fy = clamp((z + worldH / 2) / CELL_YD, 0, H - 0.001);
    const vx = clamp(fx * SEG_PER_CELL, 0, vertsX - 1.001);
    const vy = clamp(fy * SEG_PER_CELL, 0, vertsY - 1.001);
    const x0 = Math.floor(vx);
    const y0 = Math.floor(vy);
    const tx = vx - x0;
    const ty = vy - y0;
    const h00 = heights[y0 * vertsX + x0];
    const h10 = heights[y0 * vertsX + Math.min(x0 + 1, vertsX - 1)];
    const h01 = heights[Math.min(y0 + 1, vertsY - 1) * vertsX + x0];
    const h11 = heights[Math.min(y0 + 1, vertsY - 1) * vertsX + Math.min(x0 + 1, vertsX - 1)];
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
  }
  rig.heightAt = (x, z) => heightAt(x, z);

  function worldX(cx) {
    return (cx + 0.5) * CELL_YD - worldW / 2;
  }
  function worldZ(cy) {
    return (cy + 0.5) * CELL_YD - worldH / 2;
  }

  // --- water surfaces: real reflective Water (three examples) per pond disk;
  // the carved bowl still makes the shoreline ------------------------------------
  const waterNormalsTex = texLoader.load('vendor/textures/waternormals.jpg', (t) => {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  });

  function rebuildWater() {
    for (const m of waterMeshes) {
      scene.remove(m);
      m.geometry.dispose();
      if (m.material && m.material.dispose) m.material.dispose();
    }
    waterMeshes = [];
    // find pond components on the cell grid
    const seen = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || course.zones[i] !== ZONE.WATER) continue;
      const cells = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        cells.push(j);
        const x = j % W;
        const y = (j / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (!seen[k] && course.zones[k] === ZONE.WATER) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      let minX = W;
      let maxX = 0;
      let minY = H;
      let maxY = 0;
      let sum = 0;
      for (const j of cells) {
        const x = j % W;
        const y = (j / W) | 0;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        sum += rawHeightAtCellCoords(x + 0.5, y + 0.5);
      }
      const level = sum / cells.length - 0.7;
      const cx = worldX((minX + maxX) / 2);
      const cz = worldZ((minY + maxY) / 2);
      const radius = (Math.max(maxX - minX, maxY - minY) / 2 + 1.4) * CELL_YD;
      const geo = new THREE.CircleGeometry(radius, 40);
      geo.rotateX(-Math.PI / 2);
      const water = new Water(geo, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: waterNormalsTex,
        sunDirection: sun.position.clone().normalize(),
        sunColor: 0xffffff,
        waterColor: 0x0a2b30, // deep pond teal — graded for the linear->OutputPass pipeline
        distortionScale: 2.8,
        fog: !!scene.fog,
      });
      water.material.uniforms.size.value = 3.5; // ripple scale
      water.position.set(cx, level, cz);
      scene.add(water);
      waterMeshes.push(water);
    }
  }

  // --- trees --------------------------------------------------------------------------------
  let treeGroup = null;

  function treeHash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function computeTreeSpots() {
    const spots = [];
    // interior scrub trees
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (course.zones[y * W + x] !== ZONE.OUT) continue;
        const h = treeHash(x * 7 + 3, y * 5 + 1);
        if (h > 0.78) spots.push({ x, y, r: h });
      }
    }
    // boundary forest ring (outside the property line)
    for (let y = -6; y < H + 6; y++) {
      for (let x = -6; x < W + 6; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) continue;
        const h = treeHash(x * 11 + 5, y * 13 + 7);
        if (h > 0.5) spots.push({ x, y, r: h, edge: true });
      }
    }
    return spots;
  }

  function placeSpot(s) {
    const jx = (treeHash(s.x + 91, s.y + 3) - 0.5) * 6;
    const jz = (treeHash(s.x + 7, s.y + 43) - 0.5) * 6;
    const x = worldX(s.x) + jx;
    const z = worldZ(s.y) + jz;
    const inMap = s.x >= 0 && s.y >= 0 && s.x < W && s.y < H;
    const y = inMap ? heightAt(x, z) : heightAt(clamp(x, -worldW / 2 + 1, worldW / 2 - 1), clamp(z, -worldH / 2 + 1, worldH / 2 - 1));
    return { x, y, z };
  }

  let treeBuildToken = 0;

  function clearTreeGroup() {
    if (treeGroup) {
      scene.remove(treeGroup);
      treeGroup.traverse((o) => {
        if (o.isInstancedMesh) o.dispose(); // releases instanced attributes, keeps shared geometry
      });
    }
    treeGroup = new THREE.Group();
  }

  // Real Kenney Nature Kit models (CC0), one InstancedMesh per model part.
  function rebuildTreesFromModels(assets) {
    clearTreeGroup();
    const spots = computeTreeSpots();

    // bucket spots: 72% deciduous, 28% pine; then by variant within the class
    const buckets = new Map(); // key `${class}:${variantIdx}` -> spots[]
    for (const s of spots) {
      const isPine = treeHash(s.x + 31, s.y + 17) >= 0.72;
      const variants = isPine ? assets.pine : assets.deciduous;
      const vi = Math.floor(treeHash(s.x + 57, s.y + 5) * variants.length) % variants.length;
      const key = `${isPine ? 'p' : 'd'}:${vi}`;
      if (!buckets.has(key)) buckets.set(key, { variant: variants[vi], isPine, list: [] });
      buckets.get(key).list.push(s);
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();

    for (const { variant, isPine, list } of buckets.values()) {
      const meshes = variant.parts.map(({ geometry, material }) => {
        const im = new THREE.InstancedMesh(geometry, material, list.length);
        im.castShadow = true;
        im.frustumCulled = false; // base-geometry bounds would cull the whole forest
        return im;
      });
      list.forEach((s, i) => {
        const p = placeSpot(s);
        const height = isPine
          ? 8 + treeHash(s.x + 3, s.y + 77) * 4 // 8–12 yd pines
          : 6 + treeHash(s.x + 3, s.y + 77) * 3.2; // 6–9 yd deciduous
        eu.set(0, treeHash(s.x, s.y) * 6.28, 0);
        q.setFromEuler(eu);
        m.compose(v.set(p.x, p.y, p.z), q, sc.set(height, height, height));
        const b = 0.82 + treeHash(s.x + 13, s.y + 29) * 0.32; // brightness variety
        col.setRGB(b * (0.95 + treeHash(s.x, s.y + 1) * 0.1), b, b * 0.92);
        for (const im of meshes) {
          im.setMatrixAt(i, m);
          im.setColorAt(i, col);
        }
      });
      for (const im of meshes) treeGroup.add(im);
    }
    scene.add(treeGroup);
  }

  // offline fallback: the old primitive forest
  function rebuildTreesProcedural() {
    clearTreeGroup();
    const spots = computeTreeSpots();

    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.5, 2.8, 6);
    const crownGeo = new THREE.IcosahedronGeometry(2.7, 1);
    crownGeo.scale(1, 0.88, 1);
    const pineGeo = new THREE.ConeGeometry(2.1, 5.6, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.95 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });

    const deciduous = spots.filter((s) => treeHash(s.x + 31, s.y + 17) < 0.72);
    const pines = spots.filter((s) => treeHash(s.x + 31, s.y + 17) >= 0.72);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, deciduous.length);
    const pinesMesh = new THREE.InstancedMesh(pineGeo, pineMat, pines.length);
    for (const im of [trunks, crowns, pinesMesh]) {
      im.castShadow = true;
      im.frustumCulled = false;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const v = new THREE.Vector3();
    const col = new THREE.Color();
    spots.forEach((s, i) => {
      const p = placeSpot(s);
      const scale = 0.85 + treeHash(s.x + 3, s.y + 77) * 0.9;
      eu.set(0, treeHash(s.x, s.y) * 6.28, 0);
      q.setFromEuler(eu);
      m.compose(v.set(p.x, p.y + 1.4 * scale, p.z), q, new THREE.Vector3(scale, scale, scale));
      trunks.setMatrixAt(i, m);
    });
    deciduous.forEach((s, i) => {
      const p = placeSpot(s);
      const scale = 0.85 + treeHash(s.x + 3, s.y + 77) * 0.9;
      eu.set(0, treeHash(s.x, s.y) * 6.28, 0);
      q.setFromEuler(eu);
      m.compose(v.set(p.x, p.y + 5.0 * scale, p.z), q, new THREE.Vector3(scale, scale, scale));
      crowns.setMatrixAt(i, m);
      const g = 0.32 + treeHash(s.x + 13, s.y + 29) * 0.22;
      col.setRGB(0.16 + treeHash(s.x, s.y + 1) * 0.1, g, 0.13);
      crowns.setColorAt(i, col);
    });
    pines.forEach((s, i) => {
      const p = placeSpot(s);
      const scale = 0.85 + treeHash(s.x + 3, s.y + 77) * 0.9;
      eu.set(0, treeHash(s.x, s.y) * 6.28, 0);
      q.setFromEuler(eu);
      m.compose(v.set(p.x, p.y + 5.0 * scale, p.z), q, new THREE.Vector3(scale, scale, scale));
      pinesMesh.setMatrixAt(i, m);
      const g = 0.3 + treeHash(s.x + 3, s.y + 9) * 0.14;
      col.setRGB(0.1, g, 0.14);
      pinesMesh.setColorAt(i, col);
    });
    treeGroup.add(trunks, crowns, pinesMesh);
    scene.add(treeGroup);
  }

  function rebuildTrees() {
    const token = ++treeBuildToken;
    loadTreeAssets().then((assets) => {
      if (token !== treeBuildToken) return; // superseded by a newer rebuild
      if (assets && assets.deciduous.length && assets.pine.length) {
        rebuildTreesFromModels(assets);
      } else {
        console.warn('tree models unavailable — procedural fallback in use');
        rebuildTreesProcedural();
      }
    });
  }

  // --- structures ------------------------------------------------------------------------------
  let structGroup = null;

  function rebuildStructures() {
    if (structGroup) scene.remove(structGroup);
    structGroup = new THREE.Group();
    for (const s of course.structures) {
      const wx = (s.x + s.w / 2) * CELL_YD - worldW / 2;
      const wz = (s.y + s.h / 2) * CELL_YD - worldH / 2;
      const y = heightAt(wx, wz);
      const bw = s.w * CELL_YD * 0.92;
      const bd = s.h * CELL_YD * 0.92;
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(bw, 7, bd),
        new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 0.85 }),
      );
      body.position.set(wx, y + 3.5, wz);
      body.castShadow = true;
      body.receiveShadow = true;
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(bw, bd) * 0.72, 4.5, 4),
        new THREE.MeshStandardMaterial({ color: 0x4d3b2a, roughness: 0.9 }),
      );
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(bw / Math.max(bw, bd), 1, bd / Math.max(bw, bd));
      roof.position.set(wx, y + 7 + 2.25, wz);
      roof.castShadow = true;
      structGroup.add(body, roof);
    }
    scene.add(structGroup);
  }

  // --- hole furniture: flags, tee markers, status badges ------------------------------------------
  let holeGroup = null;

  function textSprite(text, { fg = '#ffffff', bg = 'rgba(20,30,16,0.85)', border = '#cfe3bd', w = 256, fontPx = 96, scaleW = 9 } = {}) {
    const cnv = document.createElement('canvas');
    cnv.width = w;
    cnv.height = 128;
    const c2 = cnv.getContext('2d');
    c2.fillStyle = bg;
    c2.beginPath();
    c2.roundRect(6, 10, w - 12, 108, 26);
    c2.fill();
    c2.strokeStyle = border;
    c2.lineWidth = 5;
    c2.stroke();
    c2.fillStyle = fg;
    c2.font = `700 ${fontPx}px "Segoe UI", sans-serif`;
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.fillText(text, w / 2, 68);
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
    sp.scale.set(scaleW, scaleW * (128 / w), 1);
    return sp;
  }

  function updateHoles() {
    if (holeGroup) {
      scene.remove(holeGroup);
      holeGroup.traverse((o) => {
        if (o.material && o.material.map && o.material.map.isCanvasTexture) o.material.map.dispose();
        if (o.geometry) o.geometry.dispose();
      });
    }
    holeGroup = new THREE.Group();

    const poleMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e4, roughness: 0.5 });

    for (const hole of course.holes) {
      const n = holeNumber(course, hole.id);
      const open = hole.status === HOLE_STATUS.OPEN;

      if (hole.pin) {
        const px = worldX(hole.pin.x);
        const pz = worldZ(hole.pin.y);
        const py = heightAt(px, pz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6), poleMat);
        pole.position.set(px, py + 1.25, pz);
        pole.castShadow = true;
        const flagCnv = document.createElement('canvas');
        flagCnv.width = 96;
        flagCnv.height = 64;
        const fc = flagCnv.getContext('2d');
        fc.fillStyle = open ? '#d8402e' : '#8b8b8b';
        fc.fillRect(0, 0, 96, 64);
        fc.fillStyle = '#ffffff';
        fc.font = '700 44px "Segoe UI", sans-serif';
        fc.textAlign = 'center';
        fc.textBaseline = 'middle';
        fc.fillText(String(n), 48, 34);
        const ftex = new THREE.CanvasTexture(flagCnv);
        ftex.colorSpace = THREE.SRGBColorSpace;
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(1.35, 0.85),
          new THREE.MeshStandardMaterial({ map: ftex, side: THREE.DoubleSide, roughness: 0.7 }),
        );
        flag.position.set(px + 0.7, py + 2.12, pz);
        flag.castShadow = true;
        flag.userData.pole = { x: px, z: pz, y: py + 2.12 };
        flag.userData.isFlag = true;
        holeGroup.add(pole, flag);

        // the cup
        const cup = new THREE.Mesh(
          new THREE.CircleGeometry(0.18, 12),
          new THREE.MeshBasicMaterial({ color: 0x101408 }),
        );
        cup.rotation.x = -Math.PI / 2;
        cup.position.set(px, py + 0.03, pz);
        holeGroup.add(cup);
      }

      if (hole.tee) {
        const tx = worldX(hole.tee.x);
        const tz = worldZ(hole.tee.y);
        const ty = heightAt(tx, tz);
        for (const off of [-1.4, 1.4]) {
          const mk = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 10, 8),
            new THREE.MeshStandardMaterial({ color: open ? 0xf2efe4 : 0x9a9a92, roughness: 0.4 }),
          );
          mk.position.set(tx + off, ty + 0.22, tz);
          mk.castShadow = true;
          holeGroup.add(mk);
        }
        const label = textSprite(String(n), { w: 128, scaleW: 5 });
        label.position.set(tx, ty + 4.2, tz);
        holeGroup.add(label);
      }

      if (hole.tee && hole.pin && (hole.status === HOLE_STATUS.RENOVATION || hole.status === HOLE_STATUS.CONSTRUCTION)) {
        const mx = (worldX(hole.tee.x) + worldX(hole.pin.x)) / 2;
        const mz = (worldZ(hole.tee.y) + worldZ(hole.pin.y)) / 2;
        const my = heightAt(mx, mz);
        const label = hole.status === HOLE_STATUS.RENOVATION ? `⛏ H${n} · ${hole.daysLeft}d` : `🏗 H${n} · ${hole.daysLeft}d`;
        const badge = textSprite(label, { w: 512, fontPx: 72, fg: '#ffe9c4', bg: 'rgba(110,64,16,0.9)', border: '#ffd27a', scaleW: 22 });
        badge.position.set(mx, my + 10, mz);
        holeGroup.add(badge);
      }
    }
    scene.add(holeGroup);
  }

  // --- golfers out on the course (visual reflection of real play volume) ---------------
  const golferGroup = new THREE.Group();
  scene.add(golferGroup);
  const golfers = [];
  const GOLFER_COLORS = [0x9c3f31, 0x2f4f8f, 0x3f7a34, 0x8a7030, 0x5d3f8a, 0x2e7d78];

  function golferHoleCorridor(course2) {
    const open = course2.holes.filter((h) => h.status === HOLE_STATUS.OPEN && h.tee && h.pin);
    if (!open.length) return null;
    return open[Math.floor(Math.random() * open.length)];
  }

  function spawnGolfer(st) {
    const hole = golferHoleCorridor(st.course);
    if (!hole) return;
    const color = GOLFER_COLORS[Math.floor(Math.random() * GOLFER_COLORS.length)];
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.95, 3, 8),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
    );
    body.position.y = 1.05;
    body.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9b38c, roughness: 0.7 }),
    );
    head.position.y = 1.95;
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.23, 0.09, 10),
      new THREE.MeshStandardMaterial({ color: 0xf2efe4, roughness: 0.8 }),
    );
    cap.position.y = 2.1;
    const g = new THREE.Group();
    g.add(body, head, cap);
    golferGroup.add(g);
    const lateral = (Math.random() - 0.5) * 10;
    golfers.push({
      mesh: g,
      hole,
      t: 0,
      lateral,
      speed: 0.011 + Math.random() * 0.005, // corridor fraction per second
      pause: 0,
      nextStop: 0.12 + Math.random() * 0.1,
    });
  }

  function updateGolfers(dt, st) {
    const cal = st ? Math.floor((st.clock.minutes % 1440)) : 720;
    const openHours = cal >= 360 && cal <= 1200;
    const target = openHours ? clamp(Math.round((st.club && st.club.lastRounds ? st.club.lastRounds : 8) / 5), 0, 10) : 0;
    if (golfers.length < target && Math.random() < dt * 0.4) spawnGolfer(st);

    for (let i = golfers.length - 1; i >= 0; i--) {
      const w = golfers[i];
      const stillOpen = w.hole.status === HOLE_STATUS.OPEN && w.hole.tee && w.hole.pin;
      if (!stillOpen || (!openHours && w.pause <= 0) || (golfers.length > target && w.t >= 1)) {
        golferGroup.remove(w.mesh);
        golfers.splice(i, 1);
        continue;
      }
      if (w.pause > 0) {
        w.pause -= dt;
      } else {
        w.t += w.speed * dt;
        if (w.t >= w.nextStop && w.nextStop < 1) {
          w.pause = 1.4 + Math.random() * 1.6; // address the ball, swing, admire it
          w.nextStop += 0.28 + Math.random() * 0.15;
        }
        if (w.t >= 1) {
          // walk off to another hole
          const next = golferHoleCorridor(st.course);
          if (next) {
            w.hole = next;
            w.t = 0;
            w.nextStop = 0.12 + Math.random() * 0.1;
            w.lateral = (Math.random() - 0.5) * 10;
          } else {
            golferGroup.remove(w.mesh);
            golfers.splice(i, 1);
            continue;
          }
        }
      }
      const hx = worldX(w.hole.tee.x) + (worldX(w.hole.pin.x) - worldX(w.hole.tee.x)) * w.t;
      const hz = worldZ(w.hole.tee.y) + (worldZ(w.hole.pin.y) - worldZ(w.hole.tee.y)) * w.t;
      // gentle lateral wander that tapers near the green
      const taper = 1 - w.t * 0.8;
      const dirX = worldX(w.hole.pin.x) - worldX(w.hole.tee.x);
      const dirZ = worldZ(w.hole.pin.y) - worldZ(w.hole.tee.y);
      const len = Math.hypot(dirX, dirZ) || 1;
      const px = hx + (-dirZ / len) * w.lateral * taper;
      const pz = hz + (dirX / len) * w.lateral * taper;
      w.mesh.position.set(px, heightAt(px, pz), pz);
      w.mesh.rotation.y = Math.atan2(dirX, dirZ) + (w.pause > 0 ? 0.9 : 0);
    }
  }

  // --- brush ring / marker cursor -----------------------------------------------------------------
  const brushRing = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }),
  );
  brushRing.rotation.x = -Math.PI / 2;
  brushRing.renderOrder = 999;
  brushRing.visible = false;
  scene.add(brushRing);

  function setBrush(cell, radiusCells, kind) {
    if (!cell || !kind) {
      brushRing.visible = false;
      return;
    }
    const x = worldX(cell.x);
    const z = worldZ(cell.y);
    brushRing.visible = true;
    brushRing.position.set(x, heightAt(x, z) + 0.25, z);
    const r = Math.max(0.6, (radiusCells + 0.5)) * CELL_YD;
    brushRing.scale.setScalar(kind === 'marker' ? 3.5 : r);
    brushRing.material.color.set(kind === 'marker' ? 0xffe9a0 : 0xffffff);
  }

  // --- data texture refresh from sim state -----------------------------------------------------------
  const ideals = BALANCE.turf.ideal;
  const IDEAL_BY_ZONE = {
    [ZONE.GREEN]: ideals.green.height,
    [ZONE.TEE]: ideals.tee.height,
    [ZONE.FAIRWAY]: ideals.fairway.height,
    [ZONE.ROUGH]: ideals.rough.height,
  };

  function updateTurf(st) {
    const t = st.turf;
    const zones = st.course.zones;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      const zone = zones[i];
      zoneData[o] = zone * 30;
      if (t) {
        zoneData[o + 1] = clamp(t.health[i] * 2.55, 0, 255);
        zoneData[o + 2] = clamp(t.wear[i] * 2.55, 0, 255);
        const ideal = IDEAL_BY_ZONE[zone] || 10;
        zoneData[o + 3] = clamp((t.heightMm[i] / ideal) * 64, 0, 255);
        auxData[o] = t.disType[i] * 100;
        auxData[o + 1] = clamp(t.disSev[i] * 2.55, 0, 255);
        auxData[o + 2] = clamp(t.moisture[i] * 2.55, 0, 255);
        auxData[o + 3] = 255;
      } else {
        zoneData[o + 1] = 180;
        zoneData[o + 3] = 64;
        auxData[o + 3] = 255;
      }
      zoneData[o + 3] = zoneData[o + 3] || 64;
    }
    zoneTex.needsUpdate = true;
    auxTex.needsUpdate = true;
    // stripe modes from mowing pattern policies
    if (shaderRefs.uniforms && st.maintenance) {
      const modeOf = (p) => (p === 'stripes' ? 1 : p === 'cross' ? 2 : 0);
      const pol = st.maintenance.policies;
      shaderRefs.uniforms.uStripeModes.value.set(modeOf(pol.green.pattern), modeOf(pol.fairway.pattern), modeOf(pol.tee.pattern));
    }
  }

  const planColorCache = {};
  function planColor(zone) {
    if (!planColorCache[zone]) planColorCache[zone] = hexToVec3(ZONE_COLORS[zone]);
    return planColorCache[zone];
  }

  function updatePlan(plan) {
    planData.fill(0);
    if (plan) {
      for (const e of plan.cells.values()) {
        const o = (e.y * W + e.x) * 4;
        if (e.zone !== undefined) {
          const c = planColor(e.zone);
          planData[o] = c.x * 255;
          planData[o + 1] = c.y * 255;
          planData[o + 2] = c.z * 255;
          planData[o + 3] = 235;
        } else if (e.dElev !== undefined) {
          if (e.dElev > 0) {
            planData[o] = 255;
            planData[o + 1] = 214;
            planData[o + 2] = 120;
          } else {
            planData[o] = 120;
            planData[o + 1] = 184;
            planData[o + 2] = 255;
          }
          planData[o + 3] = 200;
        }
      }
    }
    planTex.needsUpdate = true;
  }

  // --- sun / time-of-day / weather ------------------------------------------------------------------
  const sunPos = new THREE.Vector3();

  function applyTimeWeather(minuteOfDay, weather) {
    const t = clamp((minuteOfDay - 330) / (1260 - 330), 0, 1); // 5:30 → 21:00
    const elevDeg = Math.sin(t * Math.PI) * 62 - 2;
    const azimDeg = 96 + t * 168;
    const phi = THREE.MathUtils.degToRad(90 - elevDeg);
    const theta = THREE.MathUtils.degToRad(azimDeg);
    sunPos.setFromSphericalCoords(1, phi, theta);
    skyU.sunPosition.value.copy(sunPos);

    const rainy = weather && weather.today.rainIn > 0;
    const heavyRain = weather && weather.today.rainIn > 0.5;
    skyU.turbidity.value = rainy ? 14 : 6;
    skyU.rayleigh.value = rainy ? 0.6 : 1.6;

    const day = elevDeg > 2;
    const dusk = elevDeg > -6 && elevDeg <= 2;
    sun.position.copy(sunPos).multiplyScalar(1600);
    sun.position.y = Math.max(sun.position.y, -200);

    if (day) {
      const warm = clamp(1 - Math.abs(elevDeg) / 30, 0, 1) * (elevDeg < 25 ? 1 : 0);
      sun.color.setRGB(1, 1 - warm * 0.2, 1 - warm * 0.36);
      sun.intensity = (rainy ? 1.8 : 3.1) * clamp(elevDeg / 12, 0.4, 1);
      hemi.intensity = rainy ? 0.95 : 1.05;
      scene.fog.density = heavyRain ? 0.001 : rainy ? 0.00062 : 0.00028;
    } else if (dusk) {
      sun.color.setRGB(1, 0.62, 0.42);
      sun.intensity = 0.8;
      hemi.intensity = 0.55;
      scene.fog.density = 0.00045;
    } else {
      // night: dim blue moonlight so the course stays readable
      sun.color.setRGB(0.55, 0.65, 0.95);
      sun.intensity = 0.3;
      sun.position.set(600, 900, 400);
      hemi.intensity = 0.3;
      scene.fog.density = 0.00055;
    }
    sun.target.position.set(0, 0, 0);

    // keep the water's sun highlights in step with the real sun
    for (const w of waterMeshes) {
      w.material.uniforms.sunDirection.value.copy(sunPos).normalize();
      w.material.uniforms.sunColor.value.copy(sun.color).multiplyScalar(Math.max(0.15, sun.intensity / 3));
    }
  }

  // --- picking ------------------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function raycastCell(px, py) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((px - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((py - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(terrain, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    const cx = Math.floor((p.x + worldW / 2) / CELL_YD);
    const cy = Math.floor((p.z + worldH / 2) / CELL_YD);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
    return { x: cx, y: cy, point: p };
  }

  // --- frame -------------------------------------------------------------------------------------------
  let time = 0;

  function render(dtMs, st) {
    time += dtMs / 1000;
    if (shaderRefs.uniforms) shaderRefs.uniforms.uTime.value = time;
    for (const w of waterMeshes) {
      w.material.uniforms.time.value = time * 0.55;
    }
    if (st) updateGolfers(dtMs / 1000, st);
    // flag wave
    if (holeGroup) {
      for (const o of holeGroup.children) {
        if (o.userData && o.userData.isFlag) {
          const s = Math.sin(time * 2.2 + o.position.z * 0.05);
          o.position.x = o.userData.pole.x + 0.7 + s * 0.08;
          o.rotation.y = s * 0.35;
        }
      }
    }
    if (postEnabled) {
      try {
        composer.render();
      } catch (e) {
        console.warn('post-processing failed, falling back to direct render', e);
        postEnabled = false;
        renderer.render(scene, camera);
      }
    } else {
      renderer.render(scene, camera);
    }
  }

  function resize() {
    const wpx = canvas.clientWidth || window.innerWidth;
    const hpx = canvas.clientHeight || window.innerHeight;
    renderer.setSize(wpx, hpx, false);
    camera.aspect = wpx / hpx;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr);
    composer.setSize(wpx, hpx);
  }

  function setViewMode(mode) {
    if (shaderRefs.uniforms) {
      shaderRefs.uniforms.uViewMode.value = mode === 'health' ? 1 : mode === 'moisture' ? 2 : 0;
    }
  }

  function rebuildAll(st) {
    rebuildTerrainHeights();
    rebuildWater();
    rebuildTrees();
    rebuildStructures();
    updateHoles();
    updateTurf(st);
  }

  function dispose() {
    if (gtao.dispose) gtao.dispose();
    composerTarget.dispose();
    renderer.dispose();
    terrainGeo.dispose();
  }

  // initial build
  rebuildAll(state);
  updatePlan(null);
  resize();
  rig.apply();

  return {
    renderer,
    scene,
    camera,
    rig,
    post: { composer, gtao, bloom },
    render,
    resize,
    raycastCell,
    updateTurf,
    updatePlan,
    updateHoles,
    rebuildAll,
    setViewMode,
    setBrush,
    applyTimeWeather,
    heightAt,
    dispose,
  };
}
