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
import { ZONE, HOLE_STATUS, CELL_YD, ZONE_TEX_SCALE } from '../sim/constants.js';
import { holeNumber } from '../sim/course.js';
import { BALANCE } from '../sim/balance.js';
import { clamp } from '../core/utils.js';
import { resolveOverlaps, createStuckMonitor, createSafeTrail, nearestFree } from '../core/unstick.js';
import { ownedWasher } from '../sim/washing.js';
import { makeFpHands, GRIPS } from './fpHands.js';
import { tractorStep, repairTractor, tractorRemaining, STEP_LABEL } from '../sim/tractor.js';
import { clearLitter, fixTeeSign, PROPS } from '../sim/props.js';
import { conditionRating } from '../sim/turf.js';
import { makeCameraRig } from './cameraRig.js';
import { makeCharacter } from './characterAsset.js';
import { makeClubhouse } from './clubhouse.js';
import { makeGrassTexture, makeSandTexture, makeScrubTexture, makePathTexture } from './proceduralTextures.js';
import { ZONE_COLORS } from '../render/palette.js';

const ELEV_FT_TO_YD = (1 / 3) * 1.5; // real feet→yards with 1.5x readability exaggeration
const SEG_PER_CELL = 2;

// --- asset-idle tracking: every loader here uses THREE.DefaultLoadingManager, so the
// prewarm can wait for in-flight GLB/texture loads before compiling and uploading
// (models finishing AFTER prewarm were the source of the remaining first-look hitches)
let assetsInFlight = false;
const assetIdleResolvers = [];
THREE.DefaultLoadingManager.onStart = () => { assetsInFlight = true; };
THREE.DefaultLoadingManager.onLoad = () => {
  assetsInFlight = false;
  while (assetIdleResolvers.length) assetIdleResolvers.shift()();
};
function whenAssetsIdle(timeoutMs) {
  if (!assetsInFlight) return Promise.resolve();
  return new Promise((res) => {
    assetIdleResolvers.push(res);
    setTimeout(res, timeoutMs); // never hold the veil hostage to a missing file
  });
}

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
                // §1 vegetation: brighter, more saturated canopies that hold color at distance
                if (isPineModel) color.setHSL(0.36 + hueJitter * 0.03, 0.5, 0.26 + hueJitter * 0.05);
                else color.setHSL(0.28 + hueJitter * 0.05, 0.55, 0.33 + hueJitter * 0.06);
              } else {
                color.setHSL(0.07, 0.38, 0.28); // bark
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // DPR 1.5 cap: above that the post chain pays quadratically for sharpness nobody reads
  // at gameplay distance — a 4K/200% desktop was rendering 78% more pixels than this.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // baked on the throttle in render(), not per frame
  // STYLE GUIDE §3: neutral, bright, no filmic grade — saturation lives in albedo
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xbfdcf2, 0.00012); // near-none on a clear day (§3)

  const camera = new THREE.PerspectiveCamera(46, 1, 1, 6000);
  const rig = makeCameraRig(camera, worldW, worldH);
  // default view: standing behind the clubhouse looking up the course — the
  // natural "just stepped outside" framing, close enough to read the turf
  rig.target.set(-20, 0, 150);
  rig.yaw = 0.12;

  // --- post-processing: render → GTAO contact shadows → gentle bloom → output ---
  const composerTarget = new THREE.WebGLRenderTarget(2, 2, {
    samples: 4, // keep MSAA edges through the composer
    type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 2, 2);
  gtao.output = GTAOPass.OUTPUT.Default;
  // STYLE GUIDE §3: tight contact darkening only — no corner grime spread
  gtao.blendIntensity = 0.4;
  gtao.updateGtaoMaterial({
    radius: 1.5, // yards — hugs feet, wheels, and trunks; stays out of open turf
    distanceExponent: 1,
    thickness: 1,
    scale: 1.0,
    samples: 12,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 8 });
  // AO at HALF resolution. The pass re-renders the whole scene for depth+normals and then
  // runs two more full-screen passes; at full size that measured ~5ms/frame on the fixed
  // spin route (90.5 → 175.8 fps with the pass off). setSize here touches only the pass's
  // own targets — the beauty image stays full-res and the soft contact darkening (§3) is
  // upsampled bilinearly, which its own denoiser already smooths past noticing.
  const gtaoFullSetSize = gtao.setSize.bind(gtao);
  gtao.setSize = (w, h) => gtaoFullSetSize(Math.max(1, Math.ceil(w * 0.5)), Math.max(1, Math.ceil(h * 0.5)));
  composer.addPass(gtao);
  // STYLE GUIDE §3: bloom effectively OFF for the scene — only the sun disc
  // (radiance in the thousands) may glint; turf and trim never halo
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.12, 0.3, 60.0);
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

  // STYLE GUIDE §3: strong sky fill so shadows stay colorful (~60-70% of lit)
  const hemi = new THREE.HemisphereLight(0xcfe6fa, 0x5d7a44, 1.25);
  scene.add(hemi);

  const sky = new Sky();
  sky.scale.setScalar(20000);
  const skyU = sky.material.uniforms;
  skyU.turbidity.value = 2; // clear vivid blue, not milky (§1 sky)
  skyU.rayleigh.value = 4;
  skyU.mieCoefficient.value = 0.002;
  skyU.mieDirectionalG.value = 0.8;
  scene.add(sky);

  // §1 sky: puffy white cumulus — the physical Sky has none, so a stylized
  // billboard layer supplies them (toneMapped off so they stay paper-white)
  function makeCloudTexture() {
    const cnv = document.createElement('canvas');
    cnv.width = 256;
    cnv.height = 128;
    const c2 = cnv.getContext('2d');
    const puff = (x, y, r) => {
      const g = c2.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.8, 'rgba(255,255,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c2.fillStyle = g;
      c2.beginPath();
      c2.arc(x, y, r, 0, Math.PI * 2);
      c2.fill();
    };
    puff(64, 86, 40);
    puff(102, 66, 48);
    puff(148, 58, 52);
    puff(192, 80, 42);
    puff(120, 88, 56);
    puff(166, 90, 46);
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const cloudGroup = new THREE.Group();
  {
    const cloudTex = makeCloudTexture();
    const cloudHash = (i, s) => {
      let h = (i * 374761393 + s * 668265263) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.SpriteMaterial({
        map: cloudTex,
        transparent: true,
        opacity: 0.85 + cloudHash(i, 9) * 0.15,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const sp = new THREE.Sprite(mat);
      const sc = 260 + cloudHash(i, 1) * 340;
      sp.scale.set(sc, sc * 0.42, 1);
      sp.position.set(
        (cloudHash(i, 2) - 0.5) * 4200,
        320 + cloudHash(i, 3) * 300,
        (cloudHash(i, 4) - 0.5) * 4200,
      );
      cloudGroup.add(sp);
    }
  }
  scene.add(cloudGroup);

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
    normalScale: new THREE.Vector2(0.45, 0.45), // §4: texture whispers, tint talks
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
          float zone = floor(zd.r * 255.0 / 18.0 + 0.5);
          float hRel = zd.a * 255.0 / 64.0;
          vec4 ax = texture2D(uAuxTex, sUv);
          float disType = floor(ax.r * 255.0 / 100.0 + 0.5);
          float disSev = ax.g;
          // per-cell mowing direction (radians / 2pi in aux.a), smoothed across
          // cells so stripe bands bend with the hole instead of snapping
          float dirN = ax.a;

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

          // STYLE GUIDE §4: photo textures supply BRIGHTNESS variation only;
          // hue comes from flat saturated zone tints (Farming-Sim clean fields).
          // Wide luma swing keeps blade texture alive inside the clean color.
          #define FW_LUMA vec3(0.299, 0.587, 0.114)
          #define FW_STYLIZE(tex, tint) ((0.25 + dot(tex, FW_LUMA) * 2.6) * (tint))

          vec3 col;
          float stripeAmp = 0.0;
          float stripeFreq = 0.0;
          float modeSel = 0.0;
          bool followFlow = false;
          if (zone < 0.5) {        // OUT — native scrub
            col = FW_STYLIZE(dScrub, vec3(0.148, 0.225, 0.082)); gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.97;
          } else if (zone < 1.5) { // ROUGH
            col = FW_STYLIZE(dRough, vec3(0.105, 0.295, 0.055)); gSplatN = nRough; gSplatUv = uvRough; gSplatRough = 0.96;
          } else if (zone < 2.5) { // FAIRWAY
            col = FW_STYLIZE(dFair, vec3(0.118, 0.35, 0.055)); gSplatN = nFair; gSplatUv = uvFair; gSplatRough = 0.94;
            stripeAmp = 0.22; stripeFreq = 0.062; modeSel = uStripeModes.y; followFlow = true;
          } else if (zone < 3.5) { // GREEN
            col = FW_STYLIZE(dGreen, vec3(0.148, 0.455, 0.078)); gSplatN = nGreen; gSplatUv = uvGreen; gSplatRough = 0.9;
            stripeAmp = 0.1; stripeFreq = 0.24; modeSel = uStripeModes.x; followFlow = true;
          } else if (zone < 4.5) { // TEE
            col = FW_STYLIZE(dTee, vec3(0.132, 0.395, 0.064)); gSplatN = nTee; gSplatUv = uvTee; gSplatRough = 0.93;
            stripeAmp = 0.14; stripeFreq = 0.16; modeSel = uStripeModes.z; followFlow = true;
          } else if (zone < 5.5) { // BUNKER — warm sand that never washes to white
            col = FW_STYLIZE(dSand, vec3(0.68, 0.57, 0.36)); gSplatN = nSand; gSplatUv = uvSand; gSplatRough = 0.82;
          } else if (zone < 6.5) { // WATER bed
            col = FW_STYLIZE(dScrub, vec3(0.10, 0.16, 0.07)); gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.85;
          } else if (zone < 7.5) { // PATH — a dusty worn shoulder; the ribbon mesh is the pavement
            col = FW_STYLIZE(dRough, vec3(0.16, 0.275, 0.09)); gSplatN = nRough; gSplatUv = uvRough; gSplatRough = 0.95;
          } else if (zone < 8.5) { // FRINGE — a shade deeper than green, tight cut
            col = FW_STYLIZE(dGreen, vec3(0.128, 0.40, 0.066)); gSplatN = nGreen; gSplatUv = uvGreen; gSplatRough = 0.92;
          } else if (zone < 9.5) { // HEAVY rough — tall, warm, golden-tipped
            col = FW_STYLIZE(dRough, vec3(0.155, 0.26, 0.06)); gSplatN = nRough; gSplatUv = uvRough; gSplatRough = 0.97;
            col = mix(col, vec3(0.38, 0.36, 0.14), fwNoise(cellUv * 2.7) * 0.28); // seedhead shimmer
          } else if (zone < 10.5) { // DIRT
            col = FW_STYLIZE(dPath, vec3(0.42, 0.31, 0.20)); gSplatN = nPath; gSplatUv = uvPath; gSplatRough = 0.95;
          } else if (zone < 11.5) { // BED — dark mulch
            col = FW_STYLIZE(dScrub, vec3(0.23, 0.15, 0.09)); gSplatN = nScrub; gSplatUv = uvScrub; gSplatRough = 0.98;
          } else {                 // SEMI — first cut between fairway and rough
            col = FW_STYLIZE(dFair, vec3(0.108, 0.315, 0.050)); gSplatN = nFair; gSplatUv = uvFair; gSplatRough = 0.95;
            stripeAmp = 0.08; stripeFreq = 0.062; modeSel = uStripeModes.y; followFlow = true;
          }
          // large-scale luminance drift breaks photo-texture tiling repetition
          col *= 0.93 + fwNoise(cellUv * 0.33) * 0.14;

          if (stripeAmp > 0.001 && modeSel > 0.5) {
            // overgrown turf softens the bands but never erases the pattern —
            // a freshly-mown surface still pops the most
            float fade = max(0.4, clamp(1.7 - hRel, 0.0, 1.0));
            // mow bands follow the HOLE: per-cell direction from the flow field
            // (bilinear-smoothed so the bands bend around doglegs)
            vec2 texel2 = 1.0 / uCells;
            vec2 f0 = (floor(cellUv - 0.5) + 0.5) * texel2;
            vec2 fF = fract(cellUv - 0.5);
            float a00 = texture2D(uAuxTex, f0).a;
            float a10 = texture2D(uAuxTex, f0 + vec2(texel2.x, 0.0)).a;
            float a01 = texture2D(uAuxTex, f0 + vec2(0.0, texel2.y)).a;
            float a11 = texture2D(uAuxTex, f0 + texel2).a;
            // average as VECTORS (angles wrap); flow is stored as angle/2pi
            vec2 v00 = vec2(cos(a00 * 6.28318), sin(a00 * 6.28318));
            vec2 v10 = vec2(cos(a10 * 6.28318), sin(a10 * 6.28318));
            vec2 v01 = vec2(cos(a01 * 6.28318), sin(a01 * 6.28318));
            vec2 v11 = vec2(cos(a11 * 6.28318), sin(a11 * 6.28318));
            vec2 flow = normalize(mix(mix(v00, v10, fF.x), mix(v01, v11, fF.x), fF.y) + vec2(1e-5));
            vec2 dir1 = followFlow ? vec2(-flow.y, flow.x) : normalize(vec2(1.0, 0.32));
            vec2 dir2 = vec2(-dir1.y, dir1.x);
            float s1 = sin(dot(vWp.xz, dir1) * stripeFreq * 6.28318);
            float band = smoothstep(-0.35, 0.35, s1) * 2.0 - 1.0;
            if (modeSel > 1.5) {
              float s2 = sin(dot(vWp.xz, dir2) * stripeFreq * 6.28318);
              band = (band + (smoothstep(-0.35, 0.35, s2) * 2.0 - 1.0)) * 0.6;
            }
            col *= 1.0 + band * stripeAmp * fade;
          }

          bool isTurf = (zone > 0.5 && zone < 4.5) || (zone > 7.5 && zone < 9.5) || zone > 11.5;
          if (isTurf) {
            float dry = clamp(1.0 - health / 0.78, 0.0, 1.0);
            // §1: decay reads as OLIVE-TAN desaturation, never brown-black
            col = mix(col, vec3(0.42, 0.40, 0.16), dry * 0.55);
            col = mix(col, vec3(0.40, 0.35, 0.18), smoothstep(0.45, 1.0, wear) * 0.5);
            // freshly-watered turf reads darker until it drains — the hand-hose's
            // visible feedback, and honest for any saturated ground
            col *= 1.0 - smoothstep(0.58, 1.0, moisture) * 0.2;
            if (disSev > 0.03) {
              float spots = fwNoise(cellUv * (disType < 1.5 ? 6.5 : 3.2) + disType * 31.0);
              float cut = 1.0 - disSev * 0.6;
              float blot = smoothstep(cut, cut + 0.12, spots);
              vec3 blotch = disType < 1.5 ? vec3(0.84, 0.79, 0.6) : vec3(0.52, 0.4, 0.24);
              col = mix(col, blotch, blot * 0.78);
            }
          }

          if (zone > 4.5 && zone < 5.5) {
            // footprinted sand: visibly churned and shadowed — raking smooths it back
            float foot = smoothstep(0.1, 0.8, wear);
            col *= 1.0 - foot * 0.24;
            float churn = fwNoise(cellUv * 9.0) * 0.6 + fwNoise(cellUv * 23.0) * 0.4;
            col = mix(col, vec3(0.55, 0.44, 0.27), foot * smoothstep(0.35, 0.8, churn) * 0.6);
          }

          if (uViewMode > 0.5 && uViewMode < 1.5) {
            col = isTurf ? fwHeat(health) : col * 0.22;
          } else if (uViewMode > 1.5) {
            col = isTurf
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

  // --- surrounding countryside: the course sits IN a landscape, not on a slab
  // floating in the void. A big displaced ring matched to the boundary heights
  // rolls away into forested hills; fog and the boundary forest close the seam.
  const RING_REACH = 2600; // yards of world beyond the course edge
  let envRing = null;
  function envHillNoise(x, z) {
    return (
      Math.sin(x * 0.0021 + 1.7) * Math.cos(z * 0.0017 + 0.4) * 26 +
      Math.sin(x * 0.0063 + 4.2) * Math.cos(z * 0.0051 + 2.1) * 9 +
      Math.sin(x * 0.017 + 0.8) * Math.cos(z * 0.013 + 5.2) * 2.5
    );
  }
  function buildEnvironmentRing() {
    if (envRing) {
      scene.remove(envRing);
      envRing.geometry.dispose();
    }
    const w = worldW + RING_REACH * 2;
    const h = worldH + RING_REACH * 2;
    const geo = new THREE.PlaneGeometry(w, h, 110, 90);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const halfW = worldW / 2;
    const halfH = worldH / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // how far outside the property this vertex sits
      const dx = Math.max(0, Math.abs(x) - halfW);
      const dz = Math.max(0, Math.abs(z) - halfH);
      const outside = Math.hypot(dx, dz);
      const edgeH = heightAt(clamp(x, -halfW + 1, halfW - 1), clamp(z, -halfH + 1, halfH - 1));
      if (outside <= 0.001) {
        pos.setY(i, edgeH - 1.2); // tucked safely under the real terrain
        continue;
      }
      // rolling hills that grow with distance; a slight rise closes the horizon
      const ramp = Math.min(1, outside / 420);
      const hills = envHillNoise(x, z) * ramp + outside * 0.012 * ramp;
      pos.setY(i, edgeH * (1 - Math.min(1, outside / 260)) + hills - 0.5);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: texScrub,
      normalMap: texScrubN,
      normalScale: new THREE.Vector2(0.4, 0.4),
      color: 0x99a878, // OUT-zone family so the seam reads as one landscape
      roughness: 1,
    });
    mat.onBeforeCompile = (sh) => {
      // same stylize trick as the terrain: texture supplies brightness only
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <map_fragment>',
        `{
          vec4 sampledDiffuseColor = texture2D( map, vMapUv * 90.0 );
          float luma = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb *= 0.35 + luma * 1.9;
        }`,
      );
    };
    envRing = new THREE.Mesh(geo, mat);
    envRing.receiveShadow = true;
    scene.add(envRing);
  }

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
      // the water table sits just under the LOWEST point of the shore ring —
      // carved beds vary, but a pond's surface answers its banks
      let shoreMin = Infinity;
      for (const j of cells) {
        const x = j % W;
        const y = (j / W) | 0;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (course.zones[ny * W + nx] === ZONE.WATER) continue;
          shoreMin = Math.min(shoreMin, rawHeightAtCellCoords(nx + 0.5, ny + 0.5));
        }
      }
      let bedAvg = 0;
      for (const j of cells) bedAvg += rawHeightAtCellCoords((j % W) + 0.5, ((j / W) | 0) + 0.5);
      bedAvg /= cells.length;
      const level = Number.isFinite(shoreMin) ? shoreMin - 0.32 : bedAvg - 0.7;
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
        sunColor: 0xf4ede0, // soften the specular so low angles don't read as ice
        waterColor: 0x2a6d8f, // §1: friendly stream blue, not swamp-deep teal
        distortionScale: 3.6, // choppier normals break the full-sky mirror
        fog: !!scene.fog,
      });
      water.material.uniforms.size.value = 5.5; // ripple scale
      water.position.set(cx, level, cz);
      scene.add(water);
      waterMeshes.push(water);
    }
  }

  // --- trees --------------------------------------------------------------------------------
  // Placed trees come from course.objects — the editor's (and the generator's)
  // INTENTIONAL planting. Only the boundary forest outside the property line is
  // procedural: a deep hash ring that fades with distance and closes the horizon.
  let treeGroup = null;

  function treeHash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const RING_DEPTH = 34; // cells of procedural forest beyond the property line

  function computeTreeSpots() {
    const spots = [];
    // placed trees (typed, exact positions)
    for (const o of course.objects || []) {
      if (!o.type.startsWith('tree_')) continue;
      spots.push({ obj: o, x: o.x, y: o.y });
    }
    // boundary forest ring (outside the property line), density fading outward
    for (let y = -RING_DEPTH; y < H + RING_DEPTH; y++) {
      for (let x = -RING_DEPTH; x < W + RING_DEPTH; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) continue;
        const d = Math.max(x < 0 ? -x : x - (W - 1), y < 0 ? -y : y - (H - 1), 1);
        const p = d <= 3 ? 0.62 : d <= 8 ? 0.42 : d <= 16 ? 0.24 : 0.13;
        const h = treeHash(x * 11 + 5, y * 13 + 7);
        if (h < 1 - p) continue;
        spots.push({ x, y, r: h, edge: true, far: d });
      }
    }
    return spots;
  }

  function placeSpot(s) {
    if (s.obj) {
      const x = worldX(s.obj.x);
      const z = worldZ(s.obj.y);
      return { x, y: heightAt(x, z), z };
    }
    const jx = (treeHash(s.x + 91, s.y + 3) - 0.5) * 6;
    const jz = (treeHash(s.x + 7, s.y + 43) - 0.5) * 6;
    const x = worldX(s.x) + jx;
    const z = worldZ(s.y) + jz;
    // ring trees stand on the environment ring: sample its same hill function
    const halfW = worldW / 2;
    const halfH = worldH / 2;
    const dx = Math.max(0, Math.abs(x) - halfW);
    const dz = Math.max(0, Math.abs(z) - halfH);
    const outside = Math.hypot(dx, dz);
    const edgeH = heightAt(clamp(x, -halfW + 1, halfW - 1), clamp(z, -halfH + 1, halfH - 1));
    const ramp = Math.min(1, outside / 420);
    const y = outside <= 0.001
      ? edgeH
      : edgeH * (1 - Math.min(1, outside / 260)) + envHillNoise(x, z) * ramp + outside * 0.012 * ramp - 0.5;
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
    const byName = new Map();
    for (const v of [...assets.deciduous, ...assets.pine]) byName.set(v.name, v);

    // bucket by variant: placed trees use their exact type, ring trees hash one
    const buckets = new Map(); // variantName -> { variant, isPine, list }
    for (const s of spots) {
      let name;
      if (s.obj && byName.has(s.obj.type)) {
        name = s.obj.type;
      } else {
        const isPine = treeHash(Math.round(s.x) + 31, Math.round(s.y) + 17) >= 0.62;
        const variants = isPine ? assets.pine : assets.deciduous;
        name = variants[Math.floor(treeHash(Math.round(s.x) + 57, Math.round(s.y) + 5) * variants.length) % variants.length].name;
      }
      if (!buckets.has(name)) {
        buckets.set(name, { variant: byName.get(name), isPine: /pine/i.test(name), list: [] });
      }
      buckets.get(name).list.push(s);
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
        const hx = Math.round(s.x);
        const hy = Math.round(s.y);
        let height;
        let rot;
        if (s.obj) {
          height = (isPine ? 9.4 : 7.3) * (s.obj.scale || 1);
          rot = s.obj.rot || 0;
        } else {
          const farBoost = 1 + Math.min(1.1, (s.far || 1) * 0.028); // distant forest reads taller
          height = (isPine ? 8 + treeHash(hx + 3, hy + 77) * 4 : 6 + treeHash(hx + 3, hy + 77) * 3.2) * farBoost;
          rot = treeHash(hx, hy) * 6.28;
        }
        eu.set(0, rot, 0);
        q.setFromEuler(eu);
        m.compose(v.set(p.x, p.y, p.z), q, sc.set(height, height, height));
        const b = 0.82 + treeHash(hx + 13, hy + 29) * 0.32; // brightness variety
        col.setRGB(b * (0.95 + treeHash(hx, hy + 1) * 0.1), b, b * 0.92);
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

  // --- placed non-tree objects: shrubs, rocks, golf props, decorations -----------
  // GLBs from vendor/models/course/<type>.glb are preferred; a procedural
  // factory covers every type so the editor never places an invisible thing.
  let objectGroup = null;
  const objectGlbCache = new Map(); // type -> { parts: [{geometry, material}] } | 'missing'
  let objectGlbPending = 0;

  function proceduralObjectParts(type) {
    const std = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const parts = [];
    const push = (geo, mat) => parts.push({ geometry: geo, material: mat });
    switch (type) {
      case 'bush_round': {
        const g1 = new THREE.IcosahedronGeometry(0.55, 1);
        g1.scale(1, 0.8, 1);
        g1.translate(0, 0.42, 0);
        const g2 = new THREE.IcosahedronGeometry(0.4, 1);
        g2.translate(0.35, 0.32, 0.1);
        push(g1, std(0x3d5c2e));
        push(g2, std(0x466b34));
        break;
      }
      case 'bush_flower': {
        const g1 = new THREE.IcosahedronGeometry(0.5, 1);
        g1.scale(1, 0.75, 1);
        g1.translate(0, 0.38, 0);
        push(g1, std(0x44603a));
        for (let i = 0; i < 5; i++) {
          const f = new THREE.SphereGeometry(0.07, 6, 5);
          const a = (i / 5) * Math.PI * 2;
          f.translate(Math.cos(a) * 0.34, 0.62, Math.sin(a) * 0.34);
          push(f, std(i % 2 ? 0xd98bb0 : 0xe8e0c8, 0.7));
        }
        break;
      }
      case 'hedge': {
        const g = new THREE.BoxGeometry(1.6, 0.8, 0.5);
        g.translate(0, 0.4, 0);
        push(g, std(0x3a5730));
        break;
      }
      case 'grass_clump': {
        for (let i = 0; i < 7; i++) {
          const blade = new THREE.ConeGeometry(0.045, 0.7 + (i % 3) * 0.2, 4);
          const a = (i / 7) * Math.PI * 2;
          blade.translate(Math.cos(a) * 0.16, 0.36, Math.sin(a) * 0.16);
          blade.rotateZ((i % 2 ? 1 : -1) * 0.13);
          push(blade, std(0x8a8f4a, 0.95));
        }
        break;
      }
      case 'reeds': {
        for (let i = 0; i < 8; i++) {
          const reed = new THREE.CylinderGeometry(0.02, 0.03, 1.1 + (i % 4) * 0.22, 4);
          const a = (i / 8) * Math.PI * 2;
          reed.translate(Math.cos(a) * 0.2, 0.6, Math.sin(a) * 0.2);
          reed.rotateZ((i % 2 ? 1 : -1) * 0.08);
          push(reed, std(0x6d7a3f, 0.95));
        }
        break;
      }
      case 'flowers': {
        const bed = new THREE.CylinderGeometry(0.5, 0.55, 0.1, 10);
        bed.translate(0, 0.05, 0);
        push(bed, std(0x4a3421));
        for (let i = 0; i < 8; i++) {
          const f = new THREE.SphereGeometry(0.06, 6, 5);
          const a = (i / 8) * Math.PI * 2;
          f.translate(Math.cos(a) * 0.3, 0.26, Math.sin(a) * 0.3);
          push(f, std([0xd98bb0, 0xe8d34a, 0xe8e0c8][i % 3], 0.7));
        }
        break;
      }
      case 'rock_s':
      case 'rock_m':
      case 'rock_l': {
        const size = type === 'rock_s' ? 0.35 : type === 'rock_m' ? 0.7 : 1.15;
        const g = new THREE.IcosahedronGeometry(size, 1);
        g.scale(1, 0.62, 0.85);
        g.translate(0, size * 0.45, 0);
        push(g, std(0x8d8a82, 0.98));
        break;
      }
      case 'rock_cluster': {
        for (const [ox, oz, s] of [[0, 0, 0.7], [0.7, 0.3, 0.42], [-0.5, 0.4, 0.34], [0.2, -0.55, 0.4]]) {
          const g = new THREE.IcosahedronGeometry(s, 1);
          g.scale(1, 0.6, 0.85);
          g.translate(ox, s * 0.42, oz);
          push(g, std(0x8d8a82, 0.98));
        }
        break;
      }
      case 'bench': {
        const seat = new THREE.BoxGeometry(1.5, 0.08, 0.45);
        seat.translate(0, 0.48, 0);
        const back = new THREE.BoxGeometry(1.5, 0.4, 0.07);
        back.translate(0, 0.78, -0.2);
        push(seat, std(0x7a5c38, 0.8));
        push(back, std(0x7a5c38, 0.8));
        for (const sx of [-0.62, 0.62]) {
          const leg = new THREE.BoxGeometry(0.08, 0.48, 0.4);
          leg.translate(sx, 0.24, 0);
          push(leg, std(0x2e2b26, 0.7));
        }
        break;
      }
      case 'trash_bin': {
        const g = new THREE.CylinderGeometry(0.26, 0.22, 0.75, 10);
        g.translate(0, 0.38, 0);
        push(g, std(0x3d5c40, 0.7));
        const rim = new THREE.TorusGeometry(0.26, 0.03, 6, 12);
        rim.rotateX(Math.PI / 2);
        rim.translate(0, 0.76, 0);
        push(rim, std(0x2e2b26, 0.6));
        break;
      }
      case 'ball_washer': {
        const post = new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8);
        post.translate(0, 0.45, 0);
        push(post, std(0x2e4d24, 0.6));
        const body = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 10);
        body.translate(0, 1.0, 0);
        push(body, std(0x2e4d24, 0.55));
        const crank = new THREE.SphereGeometry(0.05, 6, 5);
        crank.translate(0, 1.22, 0);
        push(crank, std(0xc9b98a, 0.5));
        break;
      }
      case 'distance_marker': {
        const g = new THREE.CylinderGeometry(0.09, 0.11, 0.55, 8);
        g.translate(0, 0.27, 0);
        push(g, std(0xe5ddc4, 0.7));
        const band = new THREE.CylinderGeometry(0.1, 0.1, 0.1, 8);
        band.translate(0, 0.42, 0);
        push(band, std(0xd8402e, 0.7));
        break;
      }
      case 'tee_sign': {
        const post = new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6);
        post.translate(0, 0.55, 0);
        push(post, std(0x5b4630, 0.85));
        const board = new THREE.BoxGeometry(0.85, 0.55, 0.06);
        board.translate(0, 1.25, 0);
        push(board, std(0x2e4d24, 0.7));
        break;
      }
      case 'planter': {
        const g = new THREE.CylinderGeometry(0.4, 0.32, 0.42, 10);
        g.translate(0, 0.21, 0);
        push(g, std(0x9a8f78, 0.9));
        const soil = new THREE.CylinderGeometry(0.36, 0.36, 0.05, 10);
        soil.translate(0, 0.42, 0);
        push(soil, std(0x4a3421, 1));
        const plant = new THREE.IcosahedronGeometry(0.3, 1);
        plant.translate(0, 0.62, 0);
        push(plant, std(0x466b34));
        break;
      }
      default: {
        const g = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        g.translate(0, 0.25, 0);
        push(g, std(0xb05fa0));
      }
    }
    return { parts };
  }

  function objectParts(type) {
    const cached = objectGlbCache.get(type);
    if (cached && cached !== 'missing' && cached !== 'loading') return cached;
    if (!cached) {
      objectGlbCache.set(type, 'loading');
      objectGlbPending++;
      new GLTFLoader().load(
        `vendor/models/course/${type}.glb`,
        (g) => {
          try {
            g.scene.updateMatrixWorld(true);
            const parts = [];
            g.scene.traverse((o) => {
              if (!o.isMesh || !o.geometry) return;
              const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
              parts.push({ geometry: geo, material: o.material });
            });
            objectGlbCache.set(type, parts.length ? { parts } : 'missing');
          } catch {
            objectGlbCache.set(type, 'missing');
          }
          if (--objectGlbPending === 0) rebuildObjects();
        },
        undefined,
        () => {
          objectGlbCache.set(type, 'missing');
          if (--objectGlbPending === 0) rebuildObjects();
        },
      );
    }
    return proceduralObjectParts(type);
  }

  function rebuildObjects() {
    if (objectGroup) {
      scene.remove(objectGroup);
      objectGroup.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
      });
    }
    objectGroup = new THREE.Group();
    const byType = new Map();
    for (const o of course.objects || []) {
      if (o.type.startsWith('tree_')) continue; // trees have their own pipeline
      if (!byType.has(o.type)) byType.set(o.type, []);
      byType.get(o.type).push(o);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const [type, list] of byType) {
      const { parts } = objectParts(type);
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        im.castShadow = true;
        im.frustumCulled = false;
        list.forEach((o, i) => {
          const x = worldX(o.x);
          const z = worldZ(o.y);
          eu.set(0, o.rot || 0, 0);
          q.setFromEuler(eu);
          const s = o.scale || 1;
          m.compose(v.set(x, heightAt(x, z), z), q, sc.set(s, s, s));
          im.setMatrixAt(i, m);
        });
        objectGroup.add(im);
      }
    }
    scene.add(objectGroup);
  }

  // nearest placed object to a world point (for the Select tool)
  function pickObject(wx, wz, maxDistYd = 3) {
    let best = null;
    let bestD = maxDistYd;
    for (const o of course.objects || []) {
      const d = Math.hypot(worldX(o.x) - wx, worldZ(o.y) - wz);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  // --- cart-path ribbons: smooth curves laid on the terrain ------------------------
  let pathGroup = null;
  // the diffuse map multiplies DOWN, so these read two shades lighter in place
  const PATH_MATERIALS = {
    asphalt: () => new THREE.MeshStandardMaterial({ map: texPath, color: 0xc9cdd2, roughness: 0.92 }),
    concrete: () => new THREE.MeshStandardMaterial({ map: texPath, color: 0xe8e2d4, roughness: 0.88 }),
    gravel: () => new THREE.MeshStandardMaterial({ map: texPath, color: 0xd9cba4, roughness: 1 }),
    dirt: () => new THREE.MeshStandardMaterial({ map: texPath, color: 0xc09a6a, roughness: 1 }),
  };

  function ribbonForPath(path) {
    // Catmull-Rom through the stored points (cell coords → world)
    const pts = path.pts.map((p) => new THREE.Vector3(worldX(p.x), 0, worldZ(p.y)));
    if (pts.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const segs = Math.max(16, Math.round(curve.getLength() / 1.6));
    const half = (path.width || 2.6) / 2;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const nx = -tan.z;
      const nz = tan.x;
      const lx = p.x + nx * half;
      const lz = p.z + nz * half;
      const rx = p.x - nx * half;
      const rz = p.z - nz * half;
      // ride safely above the micro-relief between height samples
      positions.push(lx, heightAt(lx, lz) + 0.24, lz, rx, heightAt(rx, rz) + 0.24, rz);
      uvs.push(0, t * segs * 0.4, 1, t * segs * 0.4);
      if (i < segs) {
        const b = i * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    // the strip must face the sky: flip the winding if the curve ran the other way
    const nrm = geo.attributes.normal;
    let upSum = 0;
    for (let i = 0; i < nrm.count; i += 7) upSum += nrm.getY(i);
    if (upSum < 0) {
      const idx = geo.getIndex();
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, a);
      }
      idx.needsUpdate = true;
      geo.computeVertexNormals();
    }
    const mat = (PATH_MATERIALS[path.material] || PATH_MATERIALS.asphalt)();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  function rebuildPaths() {
    if (pathGroup) {
      scene.remove(pathGroup);
      pathGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose) o.material.dispose();
      });
    }
    pathGroup = new THREE.Group();
    pathGroup.name = 'courseCartPaths';
    for (const p of course.paths || []) {
      const mesh = ribbonForPath(p);
      if (mesh) pathGroup.add(mesh);
    }
    scene.add(pathGroup);
  }

  // --- structures: a real little clubhouse ------------------------------------------------
  let structGroup = null;
  const windowMats = []; // glass panes that glow after dark

  const sidingTex = loadGroundTex('siding_diff.jpg', { srgb: true });
  const sidingNor = loadGroundTex('siding_nor.jpg');
  sidingTex.repeat.set(7, 2.4);
  sidingNor.repeat.set(7, 2.4);
  const roofTex = loadGroundTex('roof_diff.jpg', { srgb: true });
  const roofNor = loadGroundTex('roof_nor.jpg');
  roofTex.repeat.set(4, 2);
  roofNor.repeat.set(4, 2);

  function rebuildStructures() {
    // THE CLUBHOUSE is a real building now (clubhouse.js): exterior shell and
    // pro-shop interior share one wall geometry, doors hinge and collide, and
    // the player walks in with no transition. It registers its own interaction
    // props and colliders into walkProps/propColliders.
    if (structGroup) scene.remove(structGroup);
    structGroup = new THREE.Group();
    windowMats.length = 0;
    if (clubhouseApi) {
      // never let a clubhouse teardown bug take the whole course rebuild down
      try {
        clubhouseApi.dispose();
      } catch (e) {
        console.warn('clubhouse dispose failed (continuing)', e);
      }
      clubhouseApi = null;
    }
    const s = course.structures[0];
    if (s) {
      const wx = (s.x + s.w / 2) * CELL_YD - worldW / 2;
      const wz = (s.y + s.h / 2) * CELL_YD - worldH / 2;
      clubhouseApi = makeClubhouse({
        scene, camera, state,
        center: { x: wx, z: wz },
        heightAt, walkProps, propColliders, walk,
        hooks: walkHooks,
        canvas, // register mode raycasts the CURSOR into the scene, so it needs the rect
        // The clubhouse is handed the raw walk STATE (x, z, yaw...), not the walk API,
        // so it cannot reach focusOn/clearFocus — register mode called walk.focusOn()
        // and threw. These are the two it needs: the cashier pose is a focus pose,
        // exactly like the laptop seat. (Both are function declarations, so hoisted.)
        focusOn: walkFocusOn,
        clearFocus: walkClearFocus,
      });
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
    // toneMapped:false — the badge keeps its designed colors instead of being
    // crushed to a black square against a bright anti-sun sky (KNOWN_ISSUES)
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true, toneMapped: false }));
    sp.scale.set(scaleW, scaleW * (128 / w), 1);
    return sp;
  }

  // hole furniture models (owner GLBs): loaded once, cloned per hole; clones
  // share geometry, so the rebuild-dispose pass must skip them (sharedGeo)
  let flagstickModel = null;
  let teeMarkersModel = null;
  function cloneShared(model) {
    const c = model.clone(true);
    c.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.userData.sharedGeo = true;
      }
    });
    return c;
  }
  new GLTFLoader().load('vendor/models/flagpole.glb', (g) => {
    flagstickModel = g.scene;
    updateHoles();
  }, undefined, () => {});
  new GLTFLoader().load('vendor/models/tee_markers.glb', (g) => {
    teeMarkersModel = g.scene;
    updateHoles();
  }, undefined, () => {});

  function updateHoles() {
    if (holeGroup) {
      scene.remove(holeGroup);
      holeGroup.traverse((o) => {
        if (o.material && o.material.map && o.material.map.isCanvasTexture) o.material.map.dispose();
        if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
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
        if (open && flagstickModel) {
          // the real flagstick (owner GLB) on every open hole
          const stick = cloneShared(flagstickModel);
          stick.scale.setScalar(2.7);
          stick.position.set(px, py, pz);
          stick.rotation.y = (n * 0.7) % 6.28; // flags don't all face one way
          holeGroup.add(stick);
        } else {
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
        }

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
        if (open && teeMarkersModel && hole.pin) {
          // the real tee-marker pair, set square to the line of play
          const pair = cloneShared(teeMarkersModel);
          pair.scale.setScalar(2.3);
          pair.position.set(tx, ty, tz);
          pair.rotation.y = Math.atan2(worldX(hole.pin.x) - tx, worldZ(hole.pin.y) - tz);
          holeGroup.add(pair);
        } else {
          for (const off of [-1.4, 1.4]) {
            const mk = new THREE.Mesh(
              new THREE.SphereGeometry(0.22, 10, 8),
              new THREE.MeshStandardMaterial({ color: open ? 0xf2efe4 : 0x9a9a92, roughness: 0.4 }),
            );
            mk.position.set(tx + off, ty + 0.22, tz);
            mk.castShadow = true;
            holeGroup.add(mk);
          }
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
  // STYLE GUIDE §5: one saturated polo per figure over khaki — the references'
  // golfer wardrobe (blue/navy/pink/orange/white/green)
  const POLO_COLORS = [0x3b6fb3, 0x2c3e66, 0xd98bb0, 0xd97538, 0xf0ede2, 0x3f7a34];
  const KHAKI_COLORS = [0xc2b190, 0xb9a67e, 0x9a8f78];
  const CAP_COLORS = [0xf2efe4, 0x2c3e66, 0x2f5c38, 0xe9e2cc];

  function golferHoleCorridor(course2) {
    const open = course2.holes.filter((h) => h.status === HOLE_STATUS.OPEN && h.tee && h.pin);
    if (!open.length) return null;
    return open[Math.floor(Math.random() * open.length)];
  }

  function spawnGolfer(st) {
    const hole = golferHoleCorridor(st.course);
    if (!hole) return;
    // §5: two-tone figure — khaki legs, saturated polo torso, skin head, cap —
    // articulated (real joints, procedural gait), variety from the wardrobe
    const polo = POLO_COLORS[Math.floor(Math.random() * POLO_COLORS.length)];
    const khaki = KHAKI_COLORS[Math.floor(Math.random() * KHAKI_COLORS.length)];
    const capC = CAP_COLORS[Math.floor(Math.random() * CAP_COLORS.length)];
    const char = makeCharacter({ polo, khaki, cap: capC });
    char.setMode('Walk');
    char.root.userData.char = char;
    golferGroup.add(char.root);
    golfers.push({
      mesh: char.root,
      hole,
      t: 0,
      lateral: (Math.random() - 0.5) * 10,
      speed: 0.011 + Math.random() * 0.005,
      pause: 0,
      nextStop: 0.12 + Math.random() * 0.1,
    });
  }

  let golfersFrozen = false; // QA/photography: hold the walkers still
  let clubhouseApi = null; // the real building (clubhouse.js): doors, interior, customers

  function updateGolfers(dt, st) {
    if (golfersFrozen) return;
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
      // animation follows behavior: swing at a stop, idle at the green, walk between
      const char = w.mesh.userData.char;
      if (char) {
        char.setMode(w.pause > 0 ? (w.t > 0.88 ? 'Idle' : 'Swing') : 'Walk');
        char.update(dt);
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

      // separation: golfers give way to each other, the walking player, and
      // the tractor — a spring-back offset off the scripted line, not a
      // rewrite of it (they drift back once the way is clear)
      const decay = Math.min(1, dt * 2.2);
      w.avoidX = (w.avoidX || 0) * (1 - decay);
      w.avoidZ = (w.avoidZ || 0) * (1 - decay);
      const pushFrom = (ox, oz, r) => {
        const dx = px + w.avoidX - ox;
        const dz = pz + w.avoidZ - oz;
        const d = Math.hypot(dx, dz);
        if (d > 0.01 && d < r) {
          const f = (r - d) / r;
          w.avoidX += (dx / d) * f * 4.5 * dt;
          w.avoidZ += (dz / d) * f * 4.5 * dt;
        }
      };
      for (const o of golfers) {
        if (o !== w) pushFrom(o.mesh.position.x, o.mesh.position.z, 1.3);
      }
      if (walk.active && !cart.mounted) pushFrom(walk.x, walk.z, 1.5);
      if (!cartHidden) pushFrom(cart.x, cart.z, 2.6);
      const avMag = Math.hypot(w.avoidX, w.avoidZ);
      if (avMag > 2.5) {
        w.avoidX *= 2.5 / avMag;
        w.avoidZ *= 2.5 / avMag;
      }
      const fx = px + w.avoidX;
      const fz = pz + w.avoidZ;
      w.mesh.position.set(fx, heightAt(fx, fz), fz);
      w.mesh.rotation.y = Math.atan2(dirX, dirZ) + (w.pause > 0 ? 0.9 : 0);
    }
  }

  // --- walkable mode: first-person on the real course ------------------------------------
  // Adapted from shopScene's controller: WASD + pointer-lock look (arrows as
  // fallback), circle collision against what the course already has — tree
  // instances, the clubhouse body, and pond water. No new collision data:
  // trees come from the same computeTreeSpots/placeSpot the renderer plants,
  // structures from course.structures, water from course.zones.

  const walk = {
    active: false,
    x: 0,
    z: 0,
    yaw: Math.PI, // shop-door convention: forward = (-sin, -cos); π faces +z, down the course
    pitch: 0,
    eye: 1.75, // human eye height in yards over the terrain
    speed: 3.4, // yd/s — the shop's tuned 3.1 reads a hair brisker outdoors
    runMult: 1.8,
    radius: 0.34, // same body circle the shop uses
  };

  const walkHeld = new Set();
  const treeColliders = []; // {x, z, r}
  const structColliders = []; // {minX, maxX, minZ, maxZ}

  function refreshWalkColliders() {
    treeColliders.length = 0;
    for (const s of computeTreeSpots()) {
      if (s.x < 0 || s.y < 0 || s.x >= W || s.y >= H) continue; // boundary forest sits outside the walkable clamp
      const p = placeSpot(s);
      treeColliders.push({ x: p.x, z: p.z, r: 0.55 }); // trunk-and-a-bit — forgiving under a wide canopy
    }
    structColliders.length = 0;
    // the clubhouse no longer blocks as one solid box — its walls register
    // real per-segment colliders (with door gaps) via clubhouse.js
  }

  function walkIsWaterAt(x, z) {
    const cx = Math.floor((x + worldW / 2) / CELL_YD);
    const cy = Math.floor((z + worldH / 2) / CELL_YD);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
    return course.zones[cy * W + cx] === ZONE.WATER;
  }

  function walkBlocked(nx, nz, r = walk.radius, ignoreCart = false) {
    for (const c of structColliders) {
      if (nx + r > c.minX && nx - r < c.maxX && nz + r > c.minZ && nz - r < c.maxZ) return true;
    }
    for (const c of propColliders) {
      if (c.minX !== undefined) {
        if (nx + r > c.minX && nx - r < c.maxX && nz + r > c.minZ && nz - r < c.maxZ) return true;
      } else {
        const dx = nx - c.x;
        const dz = nz - c.z;
        const rr = c.r + r;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
    }
    for (const t of treeColliders) {
      const dx = nx - t.x;
      const dz = nz - t.z;
      const rr = t.r + r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    // the parked cart is solid too (you're never "inside" it except driving it)
    if (cartHidden) { /* a broken tractor elsewhere is its own collider */ } else
    if (!cart.mounted && !ignoreCart) {
      const dx = nx - cart.x;
      const dz = nz - cart.z;
      const rr = 1.1 + r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    // ponds: you stop at the water's edge (sample the toe of the step)
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (walkIsWaterAt(nx + ox, nz + oz)) return true;
    }
    return false;
  }

  // axis-separated so blocked diagonals slide along the obstacle, shop-style
  function walkTryMove(dx, dz, r = walk.radius) {
    const mX = worldW / 2 - 2;
    const mZ = worldH / 2 - 2;
    const nx = clamp(walk.x + dx, -mX, mX);
    if (!walkBlocked(nx, walk.z, r)) walk.x = nx;
    const nz = clamp(walk.z + dz, -mZ, mZ);
    if (!walkBlocked(walk.x, nz, r)) walk.z = nz;
  }

  // --- never permanently trapped ------------------------------------------------------
  // walkTryMove only ever refuses to move INTO something; it cannot get you OUT of something.
  // A door swinging shut, a box set down at your feet, a fixture placed on you — any of them
  // used to end the run. Every frame we now push out of overlaps, breadcrumb the good ground,
  // and escalate if the player is pressing a key and going nowhere anyway.
  const safeTrail = createSafeTrail(30);
  const stuckMon = createStuckMonitor({ softMs: 700, hardMs: 1800 });
  const cartCol = []; // the parked cart, as a collider, only while it is parked
  let safeClock = 0;

  function walkColliderGroups() {
    cartCol.length = 0;
    if (!cart.mounted && !cartHidden) cartCol.push({ x: cart.x, z: cart.z, r: 1.1 });
    return [structColliders, propColliders, treeColliders, cartCol];
  }

  // free = clear of every collider AND out of the water (walkBlocked knows about both)
  const walkFreeAt = (x, z, r) => !walkBlocked(x, z, r);

  function walkRecover(dtMs, px0, pz0) {
    const r = cart.mounted ? cart.radius : walk.radius;

    // 1. depenetrate: shortest way out of anything we are standing in
    const fixed = resolveOverlaps(walk.x, walk.z, r, walkColliderGroups());
    if (fixed.pushed) {
      walk.x = fixed.x;
      walk.z = fixed.z;
    }

    const overlapping = !walkFreeAt(walk.x, walk.z, r);
    const moved = Math.hypot(walk.x - px0, walk.z - pz0);

    // 2. breadcrumb ground we know is good
    safeClock += dtMs;
    if (!overlapping && safeClock > 180) {
      safeClock = 0;
      safeTrail.record(walk.x, walk.z);
    }

    // 3. still pinned? escalate. (read the keys, not walkMoving — a wedged cart counts too)
    const wants = walkHeld.has('w') || walkHeld.has('a') || walkHeld.has('s') || walkHeld.has('d');
    const escalate = stuckMon.update(dtMs, { wantsToMove: wants, moved, overlapping });
    if (escalate) walkUnstick(escalate);
  }

  // also the pause menu's manual fallback, so the player is never at the mercy of a heuristic
  function walkUnstick(how = 'auto') {
    const r = cart.mounted ? cart.radius : walk.radius;
    if (how === 'auto' || how === 'depenetrate') {
      const fixed = resolveOverlaps(walk.x, walk.z, r, walkColliderGroups());
      if (fixed.pushed && walkFreeAt(fixed.x, fixed.z, r)) {
        walk.x = fixed.x;
        walk.z = fixed.z;
        stuckMon.reset();
        return 'depenetrate';
      }
    }
    if (how !== 'nearestFree') {
      const back = safeTrail.recall((x, z) => walkFreeAt(x, z, r));
      if (back) {
        walk.x = back.x;
        walk.z = back.z;
        stuckMon.reset();
        if (walkHooks.recovered) walkHooks.recovered('lastSafe');
        return 'lastSafe';
      }
    }
    const spot = nearestFree(walk.x, walk.z, (x, z) => walkFreeAt(x, z, r), 0.25, 60);
    if (spot) {
      walk.x = spot.x;
      walk.z = spot.z;
      stuckMon.reset();
      if (walkHooks.recovered) walkHooks.recovered('nearestFree');
      return 'nearestFree';
    }
    return null; // nowhere to go: the caller can say so honestly rather than teleport into a wall
  }

  // --- generic walk-up props ([E] interactables placed by scene features) --------------
  const walkProps = []; // { x, z, r, label(), action()|null }
  const propColliders = []; // circles {x,z,r} or AABBs {minX,maxX,minZ,maxZ}
  let cartHidden = false; // the drivable tractor doesn't exist until repaired

  // one-shot scale tween so removals read as hauled away, not blinked out
  function tweenOut(obj, onDone) {
    const t0 = performance.now();
    const s0 = obj.scale.x;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 200);
      obj.scale.setScalar(s0 * (1 - t) + 0.01 * t);
      if (t < 1) requestAnimationFrame(step);
      else if (onDone) onDone();
    };
    requestAnimationFrame(step);
  }

  // --- the golf cart: fast traversal, shop-convention interaction ---------------------
  // Not vehicle physics — a faster movement profile with steer-to-turn handling
  // and a wider collision circle, plus a real mesh that parks where you leave it.

  const cart = {
    x: 0, z: 0, yaw: Math.PI,
    mounted: false,
    speed: 10, // yd/s ≈ 20 mph — honest golf-cart pace, ~3× walking
    reverse: 3.5,
    turnRate: 1.6, // rad/s at driving speed
    eye: 1.9, // the tractor seat sits high
    radius: 1.15, // real tractor footprint (deck included, forgivingly)
  };
  let cartMesh = null;

  function buildCartMesh() {
    // STYLE GUIDE §1/§5 equipment: grounds-crew utility language — green body,
    // tan bench, cream canopy, black running gear (the references' "Turf Boss")
    const g = new THREE.Group();
    const green = new THREE.MeshStandardMaterial({ color: 0x3d5c40, roughness: 0.6 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xe5ddc4, roughness: 0.55 });
    const tan = new THREE.MeshStandardMaterial({ color: 0xc9b98a, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24221e, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 2.4), green);
    body.position.y = 0.55;
    body.castShadow = true;
    g.add(body);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.45, 0.9), tan);
    seat.position.set(0, 0.95, 0.4);
    g.add(seat);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.35, 0.25), dark);
    dash.position.set(0, 0.95, -0.65);
    g.add(dash);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 2.0), cream);
    roof.position.y = 2.0;
    roof.castShadow = true;
    g.add(roof);
    for (const [px, pz] of [[-0.6, -0.9], [0.6, -0.9], [-0.6, 0.75], [0.6, 0.75]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.25, 6), dark);
      post.position.set(px, 1.38, pz);
      g.add(post);
    }
    const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [px, pz] of [[-0.62, -0.85], [0.62, -0.85], [-0.62, 0.85], [0.62, 0.85]]) {
      const wheel = new THREE.Mesh(wheelGeo, dark);
      wheel.position.set(px, 0.28, pz);
      g.add(wheel);
    }
    return g;
  }

  function placeCartMesh() {
    if (!cartMesh) return;
    cartMesh.visible = !cartHidden;
    cartMesh.position.set(cart.x, heightAt(cart.x, cart.z), cart.z);
    cartMesh.rotation.y = cart.yaw;
  }

  function parkCartAtClubhouse() {
    const spawn = walkDefaultSpawn();
    cart.x = spawn.x + 5.5;
    cart.z = spawn.z + 1.5;
    cart.yaw = Math.PI;
    for (let push = 1; push < 30 && walkBlocked(cart.x, cart.z, cart.radius + 0.4, true); push++) cart.z += 1.5;
    placeCartMesh();
  }

  function mountCart() {
    cart.mounted = true;
    walk.x = cart.x;
    walk.z = cart.z;
    walk.yaw = cart.yaw;
    if (walkHooks.engine) walkHooks.engine(true); // she idles the moment you're up
  }

  function dismountCart() {
    cart.mounted = false;
    if (walkHooks.engine) walkHooks.engine(false);
    cart.x = walk.x;
    cart.z = walk.z;
    cart.yaw = walk.yaw;
    // step out the side: right door first, then left, then out the back
    const rx = Math.cos(walk.yaw);
    const rz = -Math.sin(walk.yaw);
    const exits = [[rx * 1.7, rz * 1.7], [-rx * 1.7, -rz * 1.7], [Math.sin(walk.yaw) * 2.4, Math.cos(walk.yaw) * 2.4]];
    for (const [ox, oz] of exits) {
      if (!walkBlocked(walk.x + ox, walk.z + oz)) {
        walk.x += ox;
        walk.z += oz;
        break;
      }
    }
    placeCartMesh();
  }

  // --- the hand hose: instant, tangible watering ---------------------------------------
  // Hold-to-spray writes moisture straight into the SAME turf array the crew's
  // scheduled irrigation uses (via a main.js hook) — one source of truth. The
  // visual answer is immediate: spray particles, a live moisture readout on the
  // prompt, and the wet-darkening term in the turf shader above.

  let walkTool = null; // null | 'hose' | 'divot' | 'rake'
  let walkSpraying = false; // "holding the use button" for whichever tool is out
  let walkSoaping = false; // right button, pressure washer only: lay foam instead of water
  let washHintClock = 0; // don't nag about soap more than once every few seconds
  let walkWaterTexClock = 0;
  let mowTexClock = 0;

  // held tool models (owner-supplied GLBs) ride the camera like the shop's wand
  scene.add(camera);
  const heldRoot = new THREE.Group();
  heldRoot.visible = false;
  camera.add(heldRoot);

  // Somebody is holding the thing. The hands are re-parented INTO whichever tool group is out, so
  // the grip poses in fpHands.GRIPS are in the tool's own frame and a new tool declares its grip
  // rather than needing its own pair of hands modelled.
  const fpHands = makeFpHands();
  const heldGroups = {
    hose: new THREE.Group(), divot: new THREE.Group(), rake: new THREE.Group(),
    vacuum: new THREE.Group(), washer: new THREE.Group(), boxcutter: new THREE.Group(),
  };
  for (const g of Object.values(heldGroups)) {
    g.visible = false;
    heldRoot.add(g);
  }
  {
    // the pressure-washer lance: a two-handed wand with a trigger grip and a fan tip
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3aa, roughness: 0.42, metalness: 0.7 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x1e2b22, roughness: 0.85 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.6 });

    const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.023, 0.86, 10), steel);
    lance.rotation.x = Math.PI / 2 - 0.16;
    lance.position.set(0, 0, -0.28);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.2), grip);
    body.position.set(0, -0.05, 0.16);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.17, 0.06), grip);
    handle.position.set(0, -0.16, 0.2);
    handle.rotation.x = -0.22;
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.02), yellow);
    trigger.position.set(0, -0.11, 0.13);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.03, 0.09, 8), yellow);
    tip.rotation.x = Math.PI / 2 - 0.16;
    tip.position.set(0, 0.075, -0.7);
    // the hose, curling away out of frame
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.2, 0.26), new THREE.Vector3(0.1, -0.42, 0.5),
      new THREE.Vector3(-0.05, -0.6, 0.85), new THREE.Vector3(-0.3, -0.75, 1.1),
    ]);
    const hoseMesh = new THREE.Mesh(
      new THREE.TubeGeometry(hoseCurve, 14, 0.022, 6, false),
      new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.9 }),
    );
    heldGroups.washer.add(lance, body, handle, trigger, tip, hoseMesh);
    // brought in from the frame edge once it had hands on it: a two-handed tool has to be far
    // enough into shot that you can see somebody holding it
    heldGroups.washer.position.set(0.24, -0.34, -0.60);
    heldGroups.washer.rotation.set(0.06, -0.13, 0);
  }
  {
    // the shop vacuum wand (procedural — same one the old shop scene carried)
    const wandBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6 }),
    );
    wandBody.rotation.x = Math.PI / 2 - 0.22;
    const wandHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.06, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xc23327, roughness: 0.55 }),
    );
    wandHead.position.set(0, -0.09, -0.32);
    heldGroups.vacuum.add(wandBody, wandHead);
    heldGroups.vacuum.position.set(0.34, -0.42, -0.7);
  }
  {
    // the box cutter: a stubby retractable utility knife. Yellow body, a short angled blade — read
    // at arm's length, it is unmistakably the thing you run down a seam of tape.
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.5 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcdd2d6, roughness: 0.25, metalness: 0.8 });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.14), bodyMat);
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.012, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.7 }));
    slide.position.set(0.016, 0.02, 0.01);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.03, 0.05), bladeMat);
    blade.position.set(0, 0.03, -0.085);
    blade.rotation.x = -0.5;
    heldGroups.boxcutter.add(handle, slide, blade);
    heldGroups.boxcutter.scale.setScalar(1.6);          // a utility knife is small; read it at arm's length
    heldGroups.boxcutter.position.set(0.22, -0.30, -0.5);
    heldGroups.boxcutter.rotation.set(0.15, -0.2, 0);
  }
  const loadHeld = (url, group, scale, pos, rot) => {
    new GLTFLoader().load(url, (g) => {
      const m = g.scene;
      m.scale.setScalar(scale);
      m.position.set(...pos);
      m.rotation.set(...rot);
      group.add(m);
    }, undefined, () => {});
  };
  loadHeld('vendor/models/hose_nozzle.glb', heldGroups.hose, 0.38, [0.4, -0.52, -0.85], [0.15, -0.4, 0]);
  loadHeld('vendor/models/hand_fork.glb', heldGroups.divot, 0.55, [0.38, -0.5, -0.72], [0.75, 0.15, 0]);
  loadHeld('vendor/models/bucket_soil.glb', heldGroups.divot, 0.42, [-0.44, -0.66, -0.9], [0, 0.3, 0]);
  loadHeld('vendor/models/rake.glb', heldGroups.rake, 0.95, [0.42, -0.6, -0.95], [0.6, 0.1, -0.18]);

  const TOOL_SPRAY = {
    hose: { color: 0xbfe2ff, size: 0.04 },
    divot: { color: 0x9a7c4e, size: 0.05 }, // soil from the repair mix
    rake: { color: 0xd8c08c, size: 0.05 },  // kicked sand
  };

  // tool FEEL: equip/stow easing + a carried bob synced to the gait, so tools
  // read as held in hands rather than glued to the camera
  const heldAnim = { t: 1, show: false, pendingHide: false };
  let bobPhase = 0;
  let walkMoving = false;
  let mountBlend = 0; // 0 = on foot (first person) … 1 = in the seat (chase cam)
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  // FOCUS MODE: the camera settles onto a fixed pose (the laptop screen, a
  // seat) and input is parked until clearFocus() eases it back to the eyes.
  let walkFocusPose = null; // { x, y, z, yaw, pitch }
  let lastFocusPose = null; // survives the ease-out
  let focusBlend = 0;

  function walkFocusOn(pose) {
    walkFocusPose = pose;
  }
  function walkClearFocus() {
    walkFocusPose = null;
  }

  function updateHeldFeel(dt) {
    // the hands breathe, rise into frame, and shove back under the trigger — or draw the box
    // cutter down the seam while you hold E on a taped carton
    fpHands.update(dt, walkSpraying || walkSoaping || holdActive);
    if (!heldRoot.visible) return;
    heldAnim.t = Math.min(1, heldAnim.t + dt / 0.26);
    const k = heldAnim.show ? easeOutCubic(heldAnim.t) : 1 - easeOutCubic(heldAnim.t);
    if (!heldAnim.show && heldAnim.t >= 1) {
      heldRoot.visible = false;
      return;
    }
    // gait-synced bob: strong under way, a slow breathe at rest
    bobPhase += dt * (walkMoving ? 8.7 : 1.6); // 8.7 = the characters' stride rate
    const sway = walkMoving ? 1 : 0.25;
    heldRoot.position.set(
      Math.cos(bobPhase * 0.5) * 0.01 * sway,
      -0.42 * (1 - k) + Math.sin(bobPhase) * 0.014 * sway,
      0,
    );
    heldRoot.rotation.x = 0.45 * (1 - k);
    heldRoot.rotation.z = Math.sin(bobPhase * 0.5) * 0.012 * sway;
  }

  const sprayCount = 90;
  const sprayPositions = new Float32Array(sprayCount * 3);
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPositions, 3));
  const sprayPoints = new THREE.Points(
    sprayGeo,
    new THREE.PointsMaterial({ color: 0xbfe2ff, size: 0.04, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  sprayPoints.visible = false;
  sprayPoints.frustumCulled = false;

  // grass clippings behind the cutting deck — the mowing loop's visible juice
  const CLIP_N = 70;
  const clipPos = new Float32Array(CLIP_N * 3);
  const clipState = [];
  for (let i = 0; i < CLIP_N; i++) clipState.push({ t: 1 + Math.random(), ox: 0, oz: 0, vx: 0, vy: 0, vz: 0 });
  const clipGeo = new THREE.BufferGeometry();
  clipGeo.setAttribute('position', new THREE.BufferAttribute(clipPos, 3));
  const clipPoints = new THREE.Points(
    clipGeo,
    new THREE.PointsMaterial({ color: 0x7fa04b, size: 0.14, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  clipPoints.visible = false;
  clipPoints.frustumCulled = false;
  scene.add(clipPoints);
  let clipActive = 0; // seconds of spray left after the last real cut

  function updateClippings(dt, deckX, deckY, deckZ, cutting) {
    if (cutting) clipActive = 0.35;
    else clipActive = Math.max(0, clipActive - dt);
    if (clipActive <= 0) {
      clipPoints.visible = false;
      return;
    }
    clipPoints.visible = true;
    for (let i = 0; i < CLIP_N; i++) {
      const c = clipState[i];
      c.t += dt * 1.8;
      if (c.t >= 1) {
        c.t = Math.random() * 0.15;
        c.ox = deckX + (Math.random() - 0.5) * 2.2;
        c.oz = deckZ + (Math.random() - 0.5) * 0.8;
        c.oy = deckY + 0.25;
        c.vx = (Math.random() - 0.5) * 2.4;
        c.vy = 2.2 + Math.random() * 1.8;
        c.vz = (Math.random() - 0.5) * 2.4;
      }
      const tt = c.t;
      clipPos[i * 3] = c.ox + c.vx * tt;
      clipPos[i * 3 + 1] = Math.max(deckY + 0.03, c.oy + c.vy * tt - 6.5 * tt * tt);
      clipPos[i * 3 + 2] = c.oz + c.vz * tt;
    }
    clipGeo.attributes.position.needsUpdate = true;
  }
  scene.add(sprayPoints);

  function updateSpray(aimWorld) {
    // a loose parabolic arc from the nozzle to the patch; the arc starts a full
    // yard out and never hugs the camera, so attenuated points stay droplets
    const hx = walk.x - Math.sin(walk.yaw) * 1.1;
    const hz = walk.z - Math.cos(walk.yaw) * 1.1;
    const hy = heightAt(walk.x, walk.z) + walk.eye - 0.55;
    for (let i = 0; i < sprayCount; i++) {
      const t = 0.12 + Math.random() * 0.88;
      const o = i * 3;
      sprayPositions[o] = hx + (aimWorld.x - hx) * t + (Math.random() - 0.5) * 0.3 * t;
      sprayPositions[o + 1] = hy + (aimWorld.y - hy) * t + Math.sin(t * Math.PI) * 0.55 + (Math.random() - 0.5) * 0.08;
      sprayPositions[o + 2] = hz + (aimWorld.z - hz) * t + (Math.random() - 0.5) * 0.3 * t;
    }
    sprayGeo.attributes.position.needsUpdate = true;
  }

  function walkSetTool(tool) {
    walkTool = tool;
    for (const [name, g] of Object.entries(heldGroups)) g.visible = name === tool;
    // the hands move to whatever is now in them
    if (tool && heldGroups[tool] && GRIPS[tool]) {
      heldGroups[tool].add(fpHands.root);
      fpHands.setTool(tool);
    } else {
      fpHands.setTool(null);
    }
    if (tool) {
      heldRoot.visible = true;
      heldAnim.show = true;
      heldAnim.t = 0; // rise into the hands
    } else if (heldRoot.visible) {
      heldAnim.show = false;
      heldAnim.t = 0; // drop away, then hide
    }
    if (tool && TOOL_SPRAY[tool]) {
      sprayPoints.material.color.set(TOOL_SPRAY[tool].color);
      sprayPoints.material.size = TOOL_SPRAY[tool].size;
    }
    if (!tool) {
      walkSpraying = false;
      sprayPoints.visible = false;
    }
  }

  function walkSetSpraying(on) {
    walkSpraying = !!(on && walkTool && !cart.mounted);
    if (!walkSpraying) sprayPoints.visible = false;
  }

  // --- what you're looking at (shop-style focus + [E]) -------------------------------
  let walkFocus = null; // { kind, label, cell? }
  const walkHooks = {}; // main.js provides turfLabelAt / inspectAt / waterAt / hoseLabelAt

  // the patch of ground a walking player is looking at, in cell coords
  function walkAimCell(dist = 2.4) {
    const ax = walk.x - Math.sin(walk.yaw) * dist;
    const az = walk.z - Math.cos(walk.yaw) * dist;
    const cx = Math.floor((ax + worldW / 2) / CELL_YD);
    const cy = Math.floor((az + worldH / 2) / CELL_YD);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
    return { x: cx, y: cy };
  }

  function walkFindFocus() {
    if (cart.mounted) {
      const cutting = state.tractor && state.tractor.repaired;
      walkFocus = { kind: 'cart', label: cutting ? 'Tractor — the deck cuts as you drive · [E] park here' : 'Tractor — [E] park here' };
      return;
    }
    if (!cartHidden) {
      const dx = cart.x - walk.x;
      const dz = cart.z - walk.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3.6) {
        const facing = ((dx / dist) * -Math.sin(walk.yaw)) + ((dz / dist) * -Math.cos(walk.yaw));
        if (facing > 0.35) {
          walkFocus = { kind: 'cart', label: 'Tractor — [E] take the wheel' };
          return;
        }
      }
    }
    // placed props (repair yard, tools, signs): nearest one you're facing
    let bestProp = null;
    let bestDist = 1e9;
    for (const p of walkProps) {
      const dx = p.x - walk.x;
      const dz = p.z - walk.z;
      const dist = Math.hypot(dx, dz);
      if (dist > p.r || dist >= bestDist) continue;
      const facing = ((dx / dist) * -Math.sin(walk.yaw)) + ((dz / dist) * -Math.cos(walk.yaw));
      if (facing > 0.3 && p.label()) { // a falsy label = the prop is dormant right now
        bestProp = p;
        bestDist = dist;
      }
    }
    if (bestProp) {
      walkFocus = { kind: 'prop', label: bestProp.label(), prop: bestProp };
      return;
    }
    // a tool out: the prompt becomes a live readout on the patch ahead
    if (walkTool === 'vacuum') {
      if (clubhouseApi) {
        const ax = walk.x - Math.sin(walk.yaw) * 1.5;
        const az = walk.z - Math.cos(walk.yaw) * 1.5;
        const label = clubhouseApi.isInside(ax, az)
          ? clubhouseApi.vacuumLabelAt(ax, az)
          : 'Vacuum — take it inside the shop';
        if (label) {
          walkFocus = { kind: 'hose', label, cell: null };
          return;
        }
      }
    } else if (walkTool) {
      const labelHook = { hose: walkHooks.hoseLabelAt, divot: walkHooks.divotLabelAt, rake: walkHooks.rakeLabelAt }[walkTool];
      const aim = walkAimCell(3.0);
      if (aim && labelHook) {
        walkFocus = { kind: 'hose', label: labelHook(aim.x, aim.y), cell: aim };
        return;
      }
    }
    // the ground ahead: the same inspect the top-down click used to open
    const aim = walkAimCell();
    if (aim && walkHooks.turfLabelAt) {
      const label = walkHooks.turfLabelAt(aim.x, aim.y);
      if (label) {
        walkFocus = { kind: 'turf', label, cell: aim };
        return;
      }
    }
    walkFocus = null;
  }

  // TAP verbs fire here, on the KEY-DOWN — once per press. HOLD verbs do not: a held key repeats
  // the keydown ~30 times a second, and a verb that fires 30 times a second is not a hold, it is a
  // machine gun. So `isRepeat` (the browser's own auto-repeat flag) drops those, and the per-frame
  // loop below drives anything the prop exposes as `hold(dt)` off walkHeld instead.
  function walkInteract(isRepeat = false) {
    if (!walk.active) return;
    if (cart.mounted) {
      if (!isRepeat) dismountCart();
      return;
    }
    if (!walkFocus) return;
    if (walkFocus.kind === 'cart') {
      if (isRepeat) return;
      walkSetTool(null); // hands on the wheel
      mountCart();
    } else if (walkFocus.kind === 'prop') {
      // a prop that has a hold verb is driven per-frame; the tap only fires its one-shot action
      if (isRepeat) return;
      if (walkFocus.prop.action) walkFocus.prop.action();
    } else if ((walkFocus.kind === 'turf' || walkFocus.kind === 'hose') && walkFocus.cell && walkHooks.inspectAt) {
      if (!isRepeat) walkHooks.inspectAt(walkFocus.cell.x, walkFocus.cell.y);
    }
  }

  // --- HOLD-TO-PROGRESS + CONTEXTUAL TOOL ----------------------------------------------------
  // A prop can expose `hold(dt)` (run the box cutter down the seam, feed the shelf one at a time)
  // and `tool` (what appears in your hands while you are looking at it). Both are reconciled every
  // frame from whatever you are focused on, so nothing here is a mode you enter and forget.
  let autoTool = null;         // a tool equipped BY context, to be taken away again when you look off
  let holdActive = false;      // are we mid-hold this frame? (drives the hands' cutting motion)

  function reconcileAutoTool() {
    const want = (walkFocus && walkFocus.kind === 'prop' && walkFocus.prop.tool) || null;
    // never fight a tool the player chose by hand (the vacuum, the washer): only manage our own
    if (want === autoTool) return;
    if (autoTool && (walkTool === autoTool || walkTool === null)) {
      walkSetTool(want);       // swap straight from one contextual tool to the next, or to nothing
    } else if (!walkTool) {
      walkSetTool(want);
    }
    autoTool = want;
  }

  function runHold(dt) {
    holdActive = false;
    if (!walkFocus || walkFocus.kind !== 'prop' || !walkFocus.prop.hold) return;
    if (!walkHeld.has('e')) return;
    walkFocus.prop.hold(dt);
    holdActive = true;
  }

  function walkKeyDown(e) {
    walkHeld.add(e.key.toLowerCase());
  }
  function walkKeyUp(e) {
    walkHeld.delete(e.key.toLowerCase());
  }
  function walkBlur() {
    walkHeld.clear();
  }
  function walkMouseMove(e) {
    if (document.pointerLockElement !== canvas) return;
    const sens = walk.sens || 1; // pause-menu mouse sensitivity
    walk.yaw -= e.movementX * 0.0021 * sens;
    walk.pitch = clamp(walk.pitch - e.movementY * 0.0019 * sens, -1.35, 1.35);
  }

  // where you land when stepping out the clubhouse door: just past the porch
  function walkDefaultSpawn() {
    const s = course.structures[0];
    if (!s) return { x: 0, z: 0, yaw: Math.PI };
    const wx = (s.x + s.w / 2) * CELL_YD - worldW / 2;
    const wz = (s.y + s.h / 2) * CELL_YD - worldH / 2;
    return { x: wx, z: wz + 8.2 + 5.5, yaw: Math.PI }; // beyond the body + porch, facing the course
  }

  function walkEnter(spawn) {
    if (walk.active) return;
    walk.active = true;
    if (spawn !== 'resume') {
      if (cart.mounted) dismountCart(); // the cart stays where it was driven, not where you respawn
      const p = spawn || walkDefaultSpawn();
      walk.x = p.x;
      walk.z = p.z;
      walk.yaw = p.yaw ?? Math.PI;
      walk.pitch = 0;
    }
    refreshWalkColliders();
    if (walkBlocked(walk.x, walk.z)) {
      // never spawn inside a tree that grew since the spot was chosen
      for (let push = 1; push < 30 && walkBlocked(walk.x, walk.z); push++) walk.z += 1.5;
    }
    camera.fov = 66; // the shop's human FOV; the management rig uses 46
    camera.near = 0.15;
    camera.updateProjectionMatrix();
    heldRoot.visible = !!walkTool; // pick your tool back up
    window.addEventListener('keydown', walkKeyDown);
    window.addEventListener('keyup', walkKeyUp);
    window.addEventListener('blur', walkBlur);
    document.addEventListener('mousemove', walkMouseMove);
  }

  function walkExit() {
    if (!walk.active) return;
    walk.active = false;
    walkSetSpraying(false);
    heldRoot.visible = false; // the overview camera carries no hand tools
    walkHeld.clear();
    window.removeEventListener('keydown', walkKeyDown);
    window.removeEventListener('keyup', walkKeyUp);
    window.removeEventListener('blur', walkBlur);
    document.removeEventListener('mousemove', walkMouseMove);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    camera.fov = 46; // hand the camera back to the management rig
    camera.near = 1;
    camera.updateProjectionMatrix();
    rig.apply();
  }

  function walkUpdate(dtMs) {
    if (!walk.active) return;
    const dt = dtMs / 1000;
    const px0 = walk.x; // where this frame started, so recovery can tell moving from pinned
    const pz0 = walk.z;

    // focus mode (laptop): ease the camera onto the pose, park all input
    focusBlend = clamp(focusBlend + (walkFocusPose ? 1 : -1) * (dt / 0.4), 0, 1);
    if (walkFocusPose || focusBlend > 0.001) {
      const fb = focusBlend * focusBlend * (3 - 2 * focusBlend);
      const gy = (clubhouseApi && clubhouseApi.groundYAt(walk.x, walk.z)) ?? heightAt(walk.x, walk.z);
      const p = lastFocusPose || walkFocusPose;
      if (walkFocusPose) lastFocusPose = walkFocusPose;
      if (p) {
        camera.position.set(
          walk.x + (p.x - walk.x) * fb,
          gy + walk.eye + (p.y - gy - walk.eye) * fb,
          walk.z + (p.z - walk.z) * fb,
        );
        camera.rotation.order = 'YXZ';
        let dy = p.yaw - walk.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        camera.rotation.y = walk.yaw + dy * fb;
        camera.rotation.x = walk.pitch + (p.pitch - walk.pitch) * fb;
      }
      if (walkFocusPose) {
        walkFocus = null; // no prompts while seated at the screen
        updateHeldFeel(dt);
        return;
      }
    } else {
      lastFocusPose = null;
    }

    // fallback look controls (also QA/accessibility — same as the shop)
    if (walkHeld.has('arrowleft')) walk.yaw += 1.9 * dt;
    if (walkHeld.has('arrowright')) walk.yaw -= 1.9 * dt;
    if (walkHeld.has('arrowup')) walk.pitch = clamp(walk.pitch + 1.3 * dt, -1.35, 1.35);
    if (walkHeld.has('arrowdown')) walk.pitch = clamp(walk.pitch - 1.3 * dt, -1.35, 1.35);

    if (cart.mounted) {
      walkMoving = false; // hands on the wheel
      // cart handling: W/S throttle along the heading, A/D steer — no strafing
      const throttle = (walkHeld.has('w') ? 1 : 0) - (walkHeld.has('s') ? 1 : 0);
      const steer = (walkHeld.has('a') ? 1 : 0) - (walkHeld.has('d') ? 1 : 0);
      if (steer) {
        // full authority under way, gentle pivot when stopped; reversed in reverse
        const authority = throttle > 0 ? 1 : throttle < 0 ? -0.7 : 0.35;
        walk.yaw += steer * cart.turnRate * authority * dt;
      }
      if (throttle > 0) {
        walkTryMove(-Math.sin(walk.yaw) * cart.speed * dt, -Math.cos(walk.yaw) * cart.speed * dt, cart.radius);
      } else if (throttle < 0) {
        walkTryMove(Math.sin(walk.yaw) * cart.reverse * dt, Math.cos(walk.yaw) * cart.reverse * dt, cart.radius);
      }
      cart.x = walk.x;
      cart.z = walk.z;
      cart.yaw = walk.yaw;
      placeCartMesh();

      // the hitched deck CUTS: cells under it (2.5 yd behind the seat, the
      // deck's width) mow to the zone's ideal height through the same hook
      // family the hose uses — real sim writes, stripes as the payoff
      if (throttle && walkHooks.mowAt && state.tractor && state.tractor.repaired) {
        const dxT = walk.x + Math.sin(walk.yaw) * 2.5;
        const dzT = walk.z + Math.cos(walk.yaw) * 2.5;
        const rx = Math.cos(walk.yaw);
        const rz = -Math.sin(walk.yaw);
        let cut = false;
        for (const off of [-1.1, 0, 1.1]) {
          const mx = dxT + rx * off;
          const mz = dzT + rz * off;
          const cx = Math.floor((mx + worldW / 2) / CELL_YD);
          const cy = Math.floor((mz + worldH / 2) / CELL_YD);
          if (cx >= 0 && cy >= 0 && cx < W && cy < H && walkHooks.mowAt(cx, cy)) cut = true;
        }
        if (cut) {
          mowTexClock += dt;
          if (mowTexClock >= 0.25) {
            mowTexClock = 0;
            updateTurf(state);
          }
        } else {
          mowTexClock = 0.25; // next cut repaints immediately
        }
        updateClippings(dt, dxT, heightAt(dxT, dzT), dzT, cut);
        if (mowerMesh) mowerMesh.position.y = 0.02 + (cut ? Math.sin(time * 42) * 0.02 : 0);
      } else {
        updateClippings(dt, walk.x, heightAt(walk.x, walk.z), walk.z, false);
      }
    } else {
      updateClippings(dt, walk.x, 0, walk.z, false); // clippings settle after you hop off
      const run = walkHeld.has('shift') ? walk.runMult : 1;
      // a full armful or a heavy carton slows you down — sim/stocking says by how much
      const load = clubhouseApi && clubhouseApi.carrySpeedFactor ? clubhouseApi.carrySpeedFactor() : 1;
      let mx = 0;
      let mz = 0;
      if (walkHeld.has('w')) mz -= 1;
      if (walkHeld.has('s')) mz += 1;
      if (walkHeld.has('a')) mx -= 1;
      if (walkHeld.has('d')) mx += 1;
      walkMoving = !!(mx || mz);
      if (mx || mz) {
        const len = Math.hypot(mx, mz);
        const s = (walk.speed * run * load * dt) / len;
        const sin = Math.sin(walk.yaw);
        const cos = Math.cos(walk.yaw);
        walkTryMove((mx * cos + mz * sin) * s, (-mx * sin + mz * cos) * s);
      }
    }

    walkRecover(dtMs, px0, pz0);

    // camera: first-person on foot, third-person chase in the seat — EASED
    // between the two so mounting reads as a real transition, not a cut
    mountBlend = clamp(mountBlend + (cart.mounted ? 1 : -1) * (dt / 0.45), 0, 1);
    const mb = mountBlend * mountBlend * (3 - 2 * mountBlend);
    // inside the clubhouse (or on its porch) you stand on the level floor slab
    const floorY = clubhouseApi ? clubhouseApi.groundYAt(walk.x, walk.z) : null;
    const groundY = floorY !== null && floorY !== undefined ? floorY : heightAt(walk.x, walk.z);
    if (mb <= 0.001) {
      camera.position.set(walk.x, groundY + walk.eye, walk.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = walk.yaw;
      camera.rotation.x = walk.pitch;
    } else {
      const cosP = Math.cos(walk.pitch);
      const fpx = walk.x;
      const fpy = groundY + (cart.mounted ? cart.eye : walk.eye);
      const fpz = walk.z;
      const fLookX = fpx - Math.sin(walk.yaw) * 6 * cosP;
      const fLookY = fpy + Math.sin(walk.pitch) * 6;
      const fLookZ = fpz - Math.cos(walk.yaw) * 6 * cosP;
      const back = 8.5;
      const up = 4.0;
      const cx = walk.x + Math.sin(walk.yaw) * back;
      const cz = walk.z + Math.cos(walk.yaw) * back;
      const cy = Math.max(heightAt(cx, cz) + 1.4, groundY + up);
      camera.position.set(
        fpx + (cx - fpx) * mb,
        fpy + (cy - fpy) * mb,
        fpz + (cz - fpz) * mb,
      );
      camera.lookAt(
        fLookX + (walk.x - fLookX) * mb,
        fLookY + (groundY + 1.7 - fLookY) * mb,
        fLookZ + (walk.z - fLookZ) * mb,
      );
    }
    walkFindFocus();
    reconcileAutoTool();   // the box cutter appears when you look at a taped box, and only then
    runHold(dt);           // holding E runs whatever the focused prop exposes as a hold verb
    updateHeldFeel(dt);

    // the pressure washer works against the BUILDING, not the turf: raycast where the player is
    // actually pointing, erode the grime mask at that exact spot, and put the stream on screen
    // between the nozzle and the contact point. Right button lays soap instead of water.
    if (walkTool === 'washer' && !cart.mounted && clubhouseApi && clubhouseApi.washAim) {
      const on = walkSpraying || walkSoaping;
      let hit = null;
      if (on) {
        const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
        hit = clubhouseApi.washAim(camera.position, dir);
        if (hit) {
          const w = ownedWasher(state);
          const mode = walkSoaping ? 'soap' : 'wash';
          const res = clubhouseApi.washApply(hit, mode, w.radius, w.power, dt, time);
          if (res.blocked && !walkSoaping) washHintClock -= dt;
          if (washHintClock <= 0 && res.blocked) {
            washHintClock = 4;
            if (walkHooks.toast) walkHooks.toast('The water is running straight off it — this needs soap first (hold the right button).', 'warn');
          }
          // The stream starts at the TIP of the lance, not at the grip — begin it at the grip and
          // the cone is drawn straight over the hands holding it.
          const nozzle = camera.localToWorld(new THREE.Vector3(0.24, -0.24, -1.25));
          clubhouseApi.washJet(nozzle, hit.point, true, dt);
        }
      }
      if (!hit) clubhouseApi.washJet(null, null, false, dt);
      clubhouseApi.washTick(dt);
    } else if (clubhouseApi && clubhouseApi.washJet) {
      clubhouseApi.washJet(null, null, false, dt);
    }

    // hold-to-use: each tool writes through its hook, with the same live
    // texture + particle feedback loop the hose established
    if (walkSpraying && walkTool === 'vacuum' && !cart.mounted) {
      // the vacuum cleans the shop floor at a continuous world point, not a turf cell
      const ax = walk.x - Math.sin(walk.yaw) * 1.5;
      const az = walk.z - Math.cos(walk.yaw) * 1.5;
      if (clubhouseApi && clubhouseApi.isInside(ax, az)) clubhouseApi.vacuumAt(ax, az, dt);
    } else if (walkSpraying && walkTool && walkTool !== 'washer' && !cart.mounted) {
      const useHook = { hose: walkHooks.waterAt, divot: walkHooks.repairAt, rake: walkHooks.rakeAt }[walkTool];
      const aim = walkAimCell(3.0);
      if (aim && useHook) {
        useHook(aim.x, aim.y, dt);
        const wx = (aim.x + 0.5) * CELL_YD - worldW / 2;
        const wz = (aim.y + 0.5) * CELL_YD - worldH / 2;
        sprayPoints.visible = true;
        updateSpray({ x: wx, y: heightAt(wx, wz) + 0.1, z: wz });
        walkWaterTexClock += dt;
        if (walkWaterTexClock >= 0.2) {
          walkWaterTexClock = 0;
          updateTurf(state); // moisture darkens / wear tint clears as you work
        }
      } else {
        sprayPoints.visible = false;
      }
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

  // world-space editor brush: fractional position, yard radius, mood color
  function setEditorBrush(opts) {
    if (!opts) {
      brushRing.visible = false;
      return;
    }
    brushRing.visible = true;
    brushRing.position.set(opts.x, heightAt(opts.x, opts.z) + 0.25, opts.z);
    brushRing.scale.setScalar(Math.max(1.2, opts.radiusYd || 8));
    brushRing.material.color.set(opts.color || 0xffffff);
  }

  // --- placement ghost: the object you are about to place, green/red ----------------
  let ghost = null;
  let ghostType = null;
  function setPlacementGhost(type, x, z, { rot = 0, scale = 1, valid = true } = {}) {
    if (!type) {
      if (ghost) ghost.visible = false;
      ghostType = null;
      return;
    }
    if (ghostType !== type) {
      if (ghost) scene.remove(ghost);
      ghost = new THREE.Group();
      const { parts } = ghostPartsFor(type);
      for (const p of parts) {
        const mesh = new THREE.Mesh(p.geometry, p.material.clone());
        mesh.material.transparent = true;
        mesh.material.opacity = 0.62;
        ghost.add(mesh);
      }
      const disc = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1, 32),
        new THREE.MeshBasicMaterial({ color: 0x7fd66b, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.15;
      disc.renderOrder = 998;
      disc.userData.isDisc = true;
      ghost.add(disc);
      scene.add(ghost);
      ghostType = type;
    }
    ghost.visible = true;
    ghost.position.set(x, heightAt(x, z), z);
    ghost.rotation.y = rot;
    const tint = valid ? 0x7fd66b : 0xd84b3a;
    ghost.traverse((o) => {
      if (o.userData.isDisc) {
        o.material.color.set(tint);
        o.scale.setScalar(2.2 * scale);
      } else if (o.isMesh) {
        o.material.emissive = new THREE.Color(valid ? 0x1a3a12 : 0x511710);
        o.scale.setScalar(type.startsWith('tree_') ? 7.3 * scale : scale);
      }
    });
  }

  function ghostPartsFor(type) {
    if (type.startsWith('tree_')) {
      // a light stand-in silhouette (trunk + crown) — the real instanced model
      // appears the moment it is placed
      const trunk = new THREE.CylinderGeometry(0.02, 0.03, 0.35, 6);
      trunk.translate(0, 0.17, 0);
      const crown = new THREE.IcosahedronGeometry(/pine/i.test(type) ? 0.22 : 0.3, 1);
      if (/pine/i.test(type)) crown.scale(1, 1.8, 1);
      crown.translate(0, /pine/i.test(type) ? 0.6 : 0.62, 0);
      return {
        parts: [
          { geometry: trunk, material: new THREE.MeshStandardMaterial({ color: 0x5a4630 }) },
          { geometry: crown, material: new THREE.MeshStandardMaterial({ color: 0x3f7a34 }) },
        ],
      };
    }
    return proceduralObjectParts(type);
  }

  // --- measure tool line -----------------------------------------------------------
  let measureGroup = null;
  function setMeasureLine(worldPts, label) {
    if (measureGroup) {
      scene.remove(measureGroup);
      measureGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.map && o.material.map.isCanvasTexture) o.material.map.dispose();
      });
      measureGroup = null;
    }
    if (!worldPts || worldPts.length < 1) return;
    measureGroup = new THREE.Group();
    const lift = (p) => new THREE.Vector3(p.x, heightAt(p.x, p.z) + 0.5, p.z);
    if (worldPts.length >= 2) {
      const pts = [];
      for (let i = 0; i < worldPts.length - 1; i++) {
        const a = lift(worldPts[i]);
        const b = lift(worldPts[i + 1]);
        for (let k = 0; k <= 18; k++) {
          const t = k / 18;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          pts.push(new THREE.Vector3(x, heightAt(x, z) + 0.5, z));
        }
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      measureGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff2c8, depthTest: false, transparent: true })));
    }
    for (const p of worldPts) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xfff2c8, depthTest: false }),
      );
      dot.renderOrder = 999;
      dot.position.copy(lift(p));
      measureGroup.add(dot);
    }
    if (label && worldPts.length >= 2) {
      const mid = lift(worldPts[Math.floor(worldPts.length / 2)]);
      const sp = textSprite(label, { w: 384, fontPx: 72, scaleW: 16 });
      sp.position.set(mid.x, mid.y + 4, mid.z);
      measureGroup.add(sp);
    }
    scene.add(measureGroup);
  }

  // --- the playtest ball + aim arc ----------------------------------------------------
  const ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0xf6f4ea, roughness: 0.35 }),
  );
  ballMesh.castShadow = true;
  ballMesh.visible = false;
  scene.add(ballMesh);
  let aimArc = null;
  function setBallVisual(pos) {
    if (!pos) {
      ballMesh.visible = false;
      return;
    }
    ballMesh.visible = true;
    ballMesh.position.set(pos.x, pos.y + 0.12, pos.z);
  }
  function setAimArc(pts) {
    if (aimArc) {
      scene.remove(aimArc);
      aimArc.geometry.dispose();
      aimArc = null;
    }
    if (!pts || pts.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    aimArc = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xfff2c8, dashSize: 1.4, gapSize: 0.9, transparent: true, opacity: 0.9 }));
    aimArc.computeLineDistances();
    scene.add(aimArc);
  }

  // --- editor camera helpers -------------------------------------------------------------
  function frameCourse() {
    rig.target.set(0, 0, 0);
    rig.yaw = 0;
    rig.pitch = 1.05;
    rig.dist = Math.max(worldW, worldH) * 0.62;
    rig.apply();
  }
  function frameHole(hole) {
    if (!hole || !hole.tee || !hole.pin) return frameCourse();
    const tx = worldX(hole.tee.x);
    const tz = worldZ(hole.tee.y);
    const px = worldX(hole.pin.x);
    const pz = worldZ(hole.pin.y);
    rig.target.set((tx + px) / 2, 0, (tz + pz) / 2);
    // look UP the hole: camera behind the tee, pin ahead
    rig.yaw = Math.atan2(tx - px, tz - pz);
    rig.pitch = 0.78;
    rig.dist = clamp(Math.hypot(px - tx, pz - tz) * 1.15, 120, 620);
    rig.apply();
  }

  // --- data texture refresh from sim state -----------------------------------------------------------
  const ideals = BALANCE.turf.ideal;
  const IDEAL_BY_ZONE = {
    [ZONE.GREEN]: ideals.green.height,
    [ZONE.TEE]: ideals.tee.height,
    [ZONE.FAIRWAY]: ideals.fairway.height,
    [ZONE.ROUGH]: ideals.rough.height,
    [ZONE.FRINGE]: ideals.tee.height,
    [ZONE.SEMI]: ideals.fairway.height,
    [ZONE.HEAVY]: ideals.rough.height,
  };

  // --- mow-direction flow field: every fairway/tee/green cell knows the local
  // direction of its hole, so stripe bands bend with the routing. Angle/2π is
  // packed into auxData alpha (recomputed only when holes or zones change).
  const flowField = new Float32Array(W * H); // angle / 2π, 0..1
  function rebuildFlowField() {
    const holes = course.holes.filter((h) => h.tee && h.pin);
    const segs = [];
    for (const h of holes) {
      // route through the hole's waypoints when the generator recorded them,
      // so stripes bend around doglegs instead of cutting the corner
      const pts = [h.tee, ...(h.wp || []), h.pin];
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push({ ax: pts[i].x, ay: pts[i].y, bx: pts[i + 1].x, by: pts[i + 1].y });
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let best = null;
        let bestD = Infinity;
        for (const s of segs) {
          const vx = s.bx - s.ax;
          const vy = s.by - s.ay;
          const len2 = vx * vx + vy * vy || 1;
          const t = clamp(((x - s.ax) * vx + (y - s.ay) * vy) / len2, 0, 1);
          const dx = x - (s.ax + vx * t);
          const dy = y - (s.ay + vy * t);
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
        let ang = 0.13; // default diagonal for land that belongs to no hole
        if (best) ang = Math.atan2(best.by - best.ay, best.bx - best.ax);
        const norm = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        flowField[y * W + x] = norm / (Math.PI * 2);
      }
    }
  }
  rebuildFlowField();

  function updateTurf(st) {
    const t = st.turf;
    const zones = st.course.zones;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      const zone = zones[i];
      // clamped pack: an unknown/oversized id must degrade to a sane surface,
      // never wrap the byte into a random one
      zoneData[o] = Math.min(255, zone * ZONE_TEX_SCALE);
      if (t) {
        zoneData[o + 1] = clamp(t.health[i] * 2.55, 0, 255);
        zoneData[o + 2] = clamp(t.wear[i] * 2.55, 0, 255);
        const ideal = IDEAL_BY_ZONE[zone] || 10;
        zoneData[o + 3] = clamp((t.heightMm[i] / ideal) * 64, 0, 255);
        auxData[o] = t.disType[i] * 100;
        auxData[o + 1] = clamp(t.disSev[i] * 2.55, 0, 255);
        auxData[o + 2] = clamp(t.moisture[i] * 2.55, 0, 255);
      } else {
        zoneData[o + 1] = 180;
        zoneData[o + 3] = 64;
      }
      auxData[o + 3] = clamp(Math.round(flowField[i] * 255), 0, 255);
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

  // --- rain streaks: a recycling column around the camera, fed by the same
  // weather the turf drinks (KNOWN_ISSUES: "no rain particles" — shipped)
  const RAIN_N = 800;
  const rainPos = new Float32Array(RAIN_N * 6); // two verts per streak
  const rainSeed = [];
  for (let i = 0; i < RAIN_N; i++) {
    const x = (Math.random() - 0.5) * 52;
    const z = (Math.random() - 0.5) * 52;
    const y = Math.random() * 26;
    rainSeed.push({ x, z, y });
    rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x; rainPos[i * 6 + 4] = y + 0.8; rainPos[i * 6 + 5] = z;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(
    rainGeo,
    new THREE.LineBasicMaterial({ color: 0xcadcec, transparent: true, opacity: 0.34, toneMapped: false }),
  );
  rain.visible = false;
  rain.frustumCulled = false;
  scene.add(rain);
  let rainLevel = 0; // smoothed 0..1 from rainIn

  function updateRain(dt, weather) {
    const target = weather ? clamp(weather.today.rainIn / 0.6, 0, 1) : 0;
    rainLevel += (target - rainLevel) * Math.min(1, dt * 1.5);
    if (rainLevel < 0.02) {
      rain.visible = false;
      return;
    }
    rain.visible = true;
    rain.material.opacity = 0.14 + rainLevel * 0.28;
    rainGeo.setDrawRange(0, Math.floor(RAIN_N * rainLevel) * 2);
    rain.position.set(camera.position.x, 0, camera.position.z);
    const fall = 24 * dt;
    for (let i = 0; i < RAIN_N; i++) {
      let y = rainPos[i * 6 + 1] - fall;
      if (y < 0) y = 24 + Math.random() * 3;
      rainPos[i * 6 + 1] = y;
      rainPos[i * 6 + 4] = y + 0.8;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  // The editor edits in daylight regardless of the game clock: a lighting
  // override pins the sun to a preview preset until cleared.
  let lightingOverride = null; // null | 'day' | 'morning' | 'golden' | 'overcast'
  const LIGHT_PRESETS = {
    day: { minute: 13 * 60, rainIn: 0 },
    morning: { minute: 8 * 60 + 30, rainIn: 0 },
    golden: { minute: 19 * 60 + 35, rainIn: 0 },
    overcast: { minute: 13 * 60, rainIn: 0.28 },
  };
  function setLightingOverride(mode) {
    lightingOverride = LIGHT_PRESETS[mode] ? mode : null;
  }

  function applyTimeWeather(minuteOfDayIn, weatherIn) {
    let minuteOfDay = minuteOfDayIn;
    let weather = weatherIn;
    if (lightingOverride) {
      const p = LIGHT_PRESETS[lightingOverride];
      minuteOfDay = p.minute;
      weather = { today: { ...(weatherIn && weatherIn.today), rainIn: p.rainIn } };
    }
    const t = clamp((minuteOfDay - 330) / (1260 - 330), 0, 1); // 5:30 → 21:00
    const elevDeg = Math.sin(t * Math.PI) * 62 - 2;
    const azimDeg = 96 + t * 168;
    const phi = THREE.MathUtils.degToRad(90 - elevDeg);
    const theta = THREE.MathUtils.degToRad(azimDeg);
    sunPos.setFromSphericalCoords(1, phi, theta);
    skyU.sunPosition.value.copy(sunPos);

    const rainy = weather && weather.today.rainIn > 0;
    const heavyRain = weather && weather.today.rainIn > 0.5;
    skyU.turbidity.value = rainy ? 11 : 3;
    skyU.rayleigh.value = rainy ? 0.8 : 2.6;

    const day = elevDeg > 2;
    const dusk = elevDeg > -6 && elevDeg <= 2;
    // anchored on the shadow target (the world origin in overview, the player on foot) so the
    // shading direction and the fitted shadow frustum always agree
    sun.position.set(
      sun.target.position.x + sunPos.x * 1600,
      sunPos.y * 1600,
      sun.target.position.z + sunPos.z * 1600,
    );
    sun.position.y = Math.max(sun.position.y, -200);

    if (day) {
      const warm = clamp(1 - Math.abs(elevDeg) / 30, 0, 1) * (elevDeg < 25 ? 1 : 0);
      // §3: one bright slightly-warm sun; strong ambient keeps shadows colorful
      sun.color.setRGB(1, 0.985 - warm * 0.19, 0.93 - warm * 0.3);
      sun.intensity = (rainy ? 1.6 : 2.6) * clamp(elevDeg / 12, 0.4, 1);
      hemi.intensity = rainy ? 1.15 : 1.35;
      scene.fog.density = heavyRain ? 0.0009 : rainy ? 0.0005 : 0.0001;
    } else if (dusk) {
      sun.color.setRGB(1, 0.62, 0.42);
      sun.intensity = 0.8;
      hemi.intensity = 0.75;
      scene.fog.density = 0.0003;
    } else {
      // night: dim blue moonlight so the course stays readable
      sun.color.setRGB(0.55, 0.65, 0.95);
      sun.intensity = 0.3;
      sun.position.set(600, 900, 400);
      hemi.intensity = 0.45;
      scene.fog.density = 0.0004;
    }
    // the sun TARGET is owned by fitSunShadow — the world origin from the overview map,
    // the player on foot. Resetting it here every frame is what once yanked the fitted
    // shadow box back to the origin and left the player's surroundings shadowless.

    // stylized cumulus only belong to a bright sky
    cloudGroup.visible = day && !heavyRain;

    // keep the water's sun highlights in step with the real sun
    for (const w of waterMeshes) {
      w.material.uniforms.sunDirection.value.copy(sunPos).normalize();
      w.material.uniforms.sunColor.value.copy(sun.color).multiplyScalar(Math.max(0.15, sun.intensity / 3));
    }

    // the clubhouse follows the clock: practicals carry the room after dark,
    // daylight fills die at night, the glass glows warm from outside
    if (clubhouseApi && clubhouseApi.setTimeMood) clubhouseApi.setTimeMood(minuteOfDay);
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

  // the editor's ray: fractional cell coords + the world point (smooth brushes)
  function raycastGround(px, py) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((px - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((py - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(terrain, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    const fx = (p.x + worldW / 2) / CELL_YD - 0.5;
    const fy = (p.z + worldH / 2) / CELL_YD - 0.5;
    return {
      fx, fy,
      x: clamp(Math.round(fx), 0, W - 1),
      y: clamp(Math.round(fy), 0, H - 1),
      point: p,
      inBounds: fx >= -0.5 && fy >= -0.5 && fx <= W - 0.5 && fy <= H - 0.5,
    };
  }

  // --- frame -------------------------------------------------------------------------------------------
  let time = 0;

  // THE SHADOW THROTTLE. The sun's shadow map is world-space: moving the CAMERA never
  // changes it, only the sun's crawl and the handful of things that walk or get built do —
  // and none of those need a 4096² rebake 90 times a second. Measured on the fixed spin
  // route, the every-frame bake was ~5ms of GPU per frame (90.5 → 164.1 fps frozen). Ten
  // bakes a second keeps character shadows visually glued to their feet and gives almost
  // all of that time back.
  const SHADOW_BAKE_MS = 100;
  let shadowClock = Infinity; // Infinity → the very first frame always bakes
  let shadowBakes = 0; // perf probes read this to attribute frame spikes to bakes

  // SHADOW FITTING. On foot, only the ±120 yards around the player can ever be read — so
  // that is all the shadow map covers: a 2048 map over 240yd is 2.5× the texel density the
  // old whole-course 4096 had, for a quarter of the raster cost, and the pass culls to the
  // box so far-course casters stop being drawn at all. The overview map keeps the classic
  // whole-course fit. The box is snapped to the shadow texel grid in light space, so a
  // 10Hz rebake never swims as the player moves.
  const SHADOW_WALK_SPAN = 120;
  const SHADOW_WALK_MAP = 2048;
  const SHADOW_FULL_MAP = 4096;
  let shadowFitMode = null;
  const shadowFwd = new THREE.Vector3();
  const shadowRight = new THREE.Vector3();
  const shadowUp = new THREE.Vector3();
  const shadowFocus = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  function fitSunShadow() {
    const mode = walk.active ? 'walk' : 'full';
    const size = mode === 'walk' ? SHADOW_WALK_MAP : SHADOW_FULL_MAP;
    // re-assert on size drift too, not just mode flips — a QA/debug hand on mapSize
    // must never leave the fit half-applied
    if (mode !== shadowFitMode || sun.shadow.mapSize.x !== size) {
      shadowFitMode = mode;
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      if (mode === 'full') {
        sc.left = -worldW * 0.62;
        sc.right = worldW * 0.62;
        sc.top = worldH * 0.75;
        sc.bottom = -worldH * 0.75;
        sun.target.position.set(0, 0, 0);
      } else {
        sc.left = -SHADOW_WALK_SPAN;
        sc.right = SHADOW_WALK_SPAN;
        sc.top = SHADOW_WALK_SPAN;
        sc.bottom = -SHADOW_WALK_SPAN;
      }
      sc.updateProjectionMatrix();
    }
    if (mode === 'walk') {
      // sunPos is the unit sun direction applyTimeWeather maintains every frame
      shadowFwd.copy(sunPos).negate().normalize();
      shadowRight.crossVectors(WORLD_UP, shadowFwd);
      if (shadowRight.lengthSq() < 1e-6) shadowRight.set(1, 0, 0); else shadowRight.normalize();
      shadowUp.crossVectors(shadowFwd, shadowRight).normalize();
      shadowFocus.set(walk.x, 0, walk.z);
      const texel = (SHADOW_WALK_SPAN * 2) / SHADOW_WALK_MAP;
      const px = shadowFocus.dot(shadowRight);
      const py = shadowFocus.dot(shadowUp);
      shadowFocus.addScaledVector(shadowRight, Math.round(px / texel) * texel - px);
      shadowFocus.addScaledVector(shadowUp, Math.round(py / texel) * texel - py);
      sun.target.position.set(shadowFocus.x, 0, shadowFocus.z);
      sun.position.set(
        shadowFocus.x + sunPos.x * 1600,
        Math.max(sunPos.y * 1600, -200),
        shadowFocus.z + sunPos.z * 1600,
      );
      sun.target.updateMatrixWorld();
    }
  }

  function render(dtMs, st) {
    time += dtMs / 1000;
    shadowClock += dtMs;
    if (shadowClock >= SHADOW_BAKE_MS) {
      fitSunShadow();
      renderer.shadowMap.needsUpdate = true;
      shadowClock = 0;
      shadowBakes++;
    }
    if (shaderRefs.uniforms) shaderRefs.uniforms.uTime.value = time;
    for (const w of waterMeshes) {
      w.material.uniforms.time.value = time * 0.55;
    }
    if (st) updateGolfers(dtMs / 1000, st);
    if (st) updateRain(dtMs / 1000, st.weather);
    if (clubhouseApi) clubhouseApi.update(dtMs); // doors, shop customers, interior life
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
    buildEnvironmentRing();
    rebuildWater();
    rebuildTrees();
    rebuildObjects();
    rebuildPaths();
    rebuildStructures();
    updateHoles();
    rebuildFlowField();
    updateTurf(st);
    if (walk.active) refreshWalkColliders(); // works can plant or fell obstacles
  }

  // the editor's cheap incremental refresh after a stroke: terrain heights +
  // water + paths follow the land; trees/objects only when asked
  function refreshGround(st, { water = false, objects = false, paths = false, holes = false, flow = false } = {}) {
    rebuildTerrainHeights();
    if (water) rebuildWater();
    if (paths) rebuildPaths();
    if (objects) {
      rebuildTrees();
      rebuildObjects();
    }
    if (holes) updateHoles();
    if (flow) rebuildFlowField();
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
  cartMesh = buildCartMesh(); // primitive placeholder until the real model lands
  scene.add(cartMesh);
  cartHidden = !!(state.tractor && !state.tractor.repaired); // earn it first

  // the mower deck rides behind the restored tractor (owner-supplied implement)
  let mowerMesh = null;
  function attachMower() {
    if (!cartMesh) return;
    if (mowerMesh) {
      if (mowerMesh.parent !== cartMesh) cartMesh.add(mowerMesh);
      return;
    }
    new GLTFLoader().load('vendor/models/mower_deck.glb', (g) => {
      const m = g.scene;
      m.scale.setScalar(2.6);
      m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      m.rotation.y = Math.PI / 2; // deck width across the tractor's tail
      m.position.set(0, 0.02, 2.45);
      mowerMesh = m;
      cartMesh.add(mowerMesh);
    }, undefined, () => {});
  }

  // the real tractor: owner-supplied model first (Assets/, matches the Designs
  // references), the bpy-scripted one as fallback, primitives if offline
  function adoptTractor(m, scale, flip = false) {
    m.scale.setScalar(scale);
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const wrap = new THREE.Group();
    m.position.y = -0.1; // settle the tires into the turf on slopes
    if (flip) m.rotation.y = Math.PI; // model authored front-toward-viewer (+Z)
    wrap.add(m);
    scene.remove(cartMesh);
    cartMesh = wrap;
    scene.add(cartMesh);
    if (mowerMesh) cartMesh.add(mowerMesh); // survive the mesh swap
    placeCartMesh();
  }
  new GLTFLoader().load('vendor/models/tractor_red.glb',
    (g) => adoptTractor(g.scene, 3.6, true),
    undefined,
    () => new GLTFLoader().load('vendor/models/tractor.glb', (g) => adoptTractor(g.scene, 1), undefined, () => {}));

  // shared prop loader for the yard/entrance dressing
  const putModel = (url, scale, x, z, ry, onLoaded) => {
    new GLTFLoader().load(url, (g) => {
      const m = g.scene;
      m.scale.setScalar(scale);
      m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      m.position.set(x, heightAt(x, z), z);
      m.rotation.y = ry;
      scene.add(m);
      if (onLoaded) onLoaded(m);
    }, undefined, () => {});
  };

  // --- the maintenance yard: shed, workbench, and the EARNED tractor -------------------
  // At game start the tractor sits here broken (weathered twin of the red one).
  // Three chores — clear the junk, fuel it, fit a belt — then [E] repairs it:
  // the broken shell swaps for the restored machine with the mower deck hitched.
  function buildMaintenanceYard(bx, bz) {
    // the yard sits on the open approach east of the porch — the west side has
    // the entrance sign and flags; the east side earns you the tractor
    const yard = { x: bx + 14.5, z: bz + 18.5, yaw: 0.7 };
    const t = state.tractor;

    putModel('vendor/models/shed.glb', 5.2, bx + 20.5, bz + 13, -1.9);
    propColliders.push({ minX: bx + 17.8, maxX: bx + 23.2, minZ: bz + 10.3, maxZ: bz + 15.7 });
    putModel('vendor/models/workbench.glb', 2.5, bx + 18.6, bz + 17.2, -Math.PI / 2);
    propColliders.push({ x: bx + 18.6, z: bz + 17.2, r: 1.0 });
    putModel('vendor/models/tool_chest.glb', 1.35, bx + 21.6, bz + 17.1, -Math.PI / 2);
    propColliders.push({ x: bx + 21.6, z: bz + 17.1, r: 0.75 });

    if (!t || t.repaired) {
      attachMower();
      return yard; // the machine already runs — the yard is scenery
    }

    // the broken tractor: same silhouette, visibly let go — dulled, rusted, sagging
    let brokenGroup = null;
    const brokenCollider = { x: yard.x, z: yard.z, r: 1.5 };
    propColliders.push(brokenCollider);
    putModel('vendor/models/tractor_broken.glb', 3.55, yard.x, yard.z, yard.yaw + Math.PI / 2, (m) => {
      brokenGroup = m;
      m.rotation.z = 0.045; // flat rear tire sag
      m.position.y -= 0.14;
      m.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          if (o.material.color) {
            o.material.color.multiplyScalar(0.6);
            o.material.color.lerp(new THREE.Color(0x6e4a2c), 0.28); // rust film
          }
          o.material.roughness = 1;
        }
      });
    });

    const say = (msg) => { if (walkHooks.toast) walkHooks.toast(msg); };
    const play = (n) => { if (walkHooks.sfx) walkHooks.sfx(n); };

    // chore 1: the junk heaped against it
    let leavesMesh = null;
    const leavesProp = {
      x: bx + 11.8, z: bz + 20.4, r: 2.4,
      label: () => 'Old leaves and junk — [E] clear it out',
      action: () => {
        if (!tractorStep(state, 'cleared').ok) return;
        if (leavesMesh) tweenOut(leavesMesh, () => scene.remove(leavesMesh));
        walkProps.splice(walkProps.indexOf(leavesProp), 1);
        play('thunk');
        say('Junk cleared — you can get at the engine now.');
      },
    };
    putModel('vendor/models/leaves_pile.glb', 2.2, leavesProp.x, leavesProp.z, 0.4, (m) => { leavesMesh = m; });
    walkProps.push(leavesProp);

    // chore 2: the fuel can by the bench
    let canMesh = null;
    const canProp = {
      x: bx + 17.4, z: bz + 18.9, r: 2.0,
      label: () => 'Fuel can — [E] fill the tractor’s tank',
      action: () => {
        if (!tractorStep(state, 'fuel').ok) return;
        if (canMesh) tweenOut(canMesh, () => scene.remove(canMesh));
        walkProps.splice(walkProps.indexOf(canProp), 1);
        play('thunk');
        say('Tank filled — smells like a running machine already.');
      },
    };
    putModel('vendor/models/gas_can.glb', 0.55, canProp.x, canProp.z, 0.9, (m) => { canMesh = m; });
    walkProps.push(canProp);

    // chore 3: the drive belt on the chest
    let beltMesh = null;
    const beltProp = {
      x: bx + 21.0, z: bz + 18.8, r: 2.0,
      label: () => 'Drive belt — [E] fit it to the tractor',
      action: () => {
        if (!tractorStep(state, 'belt').ok) return;
        if (beltMesh) tweenOut(beltMesh, () => scene.remove(beltMesh));
        walkProps.splice(walkProps.indexOf(beltProp), 1);
        play('thunk');
        say('Belt on the pulleys — one pull of the starter to go.');
      },
    };
    putModel('vendor/models/belt.glb', 0.7, beltProp.x, beltProp.z, 0.3, (m) => { beltMesh = m; });
    walkProps.push(beltProp);

    // the machine itself: reports what it still needs, then comes alive
    const tractorProp = {
      x: yard.x, z: yard.z, r: 3.4,
      label: () => {
        const left = tractorRemaining(state);
        if (left.length) return `Broken tractor — needs ${left.map((s) => STEP_LABEL[s]).join(', ')}`;
        return 'Broken tractor — [E] get her running';
      },
      action: () => {
        if (!repairTractor(state).ok) return;
        if (brokenGroup) scene.remove(brokenGroup);
        walkProps.splice(walkProps.indexOf(tractorProp), 1);
        propColliders.splice(propColliders.indexOf(brokenCollider), 1);
        cart.x = yard.x;
        cart.z = yard.z;
        cart.yaw = yard.yaw;
        cartHidden = false;
        placeCartMesh();
        attachMower();
        play('chime');
        say('She lives! The tractor is yours — mower deck hitched. [E] to take the wheel.');
      },
    };
    walkProps.push(tractorProp);
    return yard;
  }

  // --- course restoration props: storm litter + the broken tee sign ------------------
  function buildCourseProps() {
    const props = state.props;
    if (!props) return;

    // litter piles (leaves GLB) at their seeded cells, hauled off with E
    props.litter.forEach((pile, idx) => {
      if (pile.cleared) return;
      const wx = (pile.cx + 0.5) * CELL_YD - worldW / 2;
      const wz = (pile.cy + 0.5) * CELL_YD - worldH / 2;
      let mesh = null;
      const prop = {
        x: wx, z: wz, r: 2.6,
        label: () => 'Storm debris — [E] haul it away',
        action: () => {
          if (!clearLitter(state, idx).ok) return;
          if (mesh) tweenOut(mesh, () => scene.remove(mesh));
          walkProps.splice(walkProps.indexOf(prop), 1);
          updateTurf(state); // the flattened grass under it recovers
          if (walkHooks.sfx) walkHooks.sfx('thunk');
          if (walkHooks.toast) walkHooks.toast('Debris hauled off — the grass under it can breathe.');
        },
      };
      putModel('vendor/models/leaves_pile.glb', 1.9, wx, wz, (idx * 1.7) % 6.28, (m) => { mesh = m; });
      walkProps.push(prop);
    });

    // the first tee's sign: broken at start, repaired for real money
    const h0 = course.holes[0];
    if (!h0 || !h0.tee) return;
    const sx = (h0.tee.x + 0.5) * CELL_YD - worldW / 2 + 3.2;
    const sz = (h0.tee.y + 0.5) * CELL_YD - worldH / 2 + 1.5;
    let signMesh = null;
    const placeSign = (broken) => {
      if (signMesh) scene.remove(signMesh);
      putModel(broken ? 'vendor/models/tee_sign_broken.glb' : 'vendor/models/course_sign.glb',
        2.2, sx, sz, -0.5, (m) => { signMesh = m; });
    };
    placeSign(!props.teeSignFixed);
    if (!props.teeSignFixed) {
      const signProp = {
        x: sx, z: sz, r: 2.6,
        label: () => `Broken tee sign — [E] repair it (${PROPS.signRepairCost} dollars)`,
        action: () => {
          const res = fixTeeSign(state);
          if (!res.ok) {
            if (walkHooks.toast) walkHooks.toast(res.reason || 'Cannot repair it right now.', 'warn');
            return;
          }
          placeSign(false);
          walkProps.splice(walkProps.indexOf(signProp), 1);
          if (walkHooks.sfx) walkHooks.sfx('chime');
          if (walkHooks.toast) walkHooks.toast('Tee sign restored — first impressions matter.');
        },
      };
      walkProps.push(signProp);
    }
  }

  // entrance decor: the stone club sign on the approach, weathered to match the
  // course's actual condition at load. (The old small sign is now the tee sign;
  // the "pennant poles" were really flagsticks and moved to the holes.)
  let yardHome = null;
  {
    const s0 = course.structures[0];
    if (s0) {
      const bx = (s0.x + s0.w / 2) * CELL_YD - worldW / 2;
      const bz = (s0.y + s0.h / 2) * CELL_YD - worldH / 2;
      putModel('vendor/models/club_sign.glb', 3.4, bx - 15, bz + 16, 0.45, (m) => {
        // dead-course look: the sign dulls and leans with poor condition,
        // straightening up as the property recovers (applied per scene build)
        const cond = state.turf ? conditionRating(state) : 60;
        const neglect = clamp(1 - (cond - 35) / 40, 0, 1);
        if (neglect > 0.05) {
          m.rotation.z = 0.035 * neglect;
          m.traverse((o) => {
            if (o.isMesh && o.material) {
              o.material = o.material.clone();
              if (o.material.color) {
                o.material.color.multiplyScalar(1 - 0.3 * neglect);
                o.material.color.lerp(new THREE.Color(0x5c5648), 0.22 * neglect);
              }
              o.material.roughness = 1;
            }
          });
        }
      });
      propColliders.push({ x: bx - 15, z: bz + 16, r: 1.6 });
      yardHome = buildMaintenanceYard(bx, bz);

      // the groundskeeper's residence — the owner-supplied house GLB, optimized
      // (334k→67k tris, see DEV_LOG 2026-07-13) and finally on the property.
      // Its baked garden bed reads as its own yard on the entrance approach.
      putModel('vendor/models/clubhouse_ext_opt.glb', 20, bx - 30, bz + 27, 1.25, (m) => {
        m.position.y -= 0.12; // settle the baked landscaping bed into the turf
      });
      propColliders.push({ minX: bx - 40, maxX: bx - 20, minZ: bz + 21, maxZ: bz + 33 });
      walkProps.push({
        x: bx - 30, z: bz + 24, r: 4.5,
        label: () => "The groundskeeper's house — someone kept a nicer yard than the course",
        action: null,
      });

      // the club's golf cart, parked by the porch (ambient prop for now)
      putModel('vendor/models/golf_cart.glb', 2.6, bx + 9.5, bz + 12.5, 2.2);
      propColliders.push({ x: bx + 9.5, z: bz + 12.5, r: 1.3 });
      walkProps.push({
        x: bx + 9.5, z: bz + 12.5, r: 2.6,
        label: () => "The club's cart — members' shuttle (the tractor is yours)",
        action: null,
      });
    }
  }
  buildCourseProps();
  refreshWalkColliders(); // parking needs to see the world
  if (yardHome) {
    // the tractor lives at the yard, broken or not
    cart.x = yardHome.x;
    cart.z = yardHome.z;
    cart.yaw = yardHome.yaw;
    placeCartMesh();
  } else {
    parkCartAtClubhouse();
  }
  resize();
  rig.apply();

  // --- prewarm: compile every shader program + upload every texture behind the loading
  // veil so the first real look-around never hitches on lazy GPU work (356ms freezes
  // were measured on the first cold 360° turn before this existed)
  async function prewarm(onStep) {
    const tick = () => new Promise((res) => requestAnimationFrame(res));
    const step = (label) => { if (onStep) onStep(label); };
    step('Loading models');
    await whenAssetsIdle(8000);
    await tick();
    step('Compiling shaders');
    await tick();
    renderer.compile(scene, camera);
    await tick();
    step('Uploading textures');
    const seen = new Set();
    const texKeys = ['map', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap', 'alphaMap', 'bumpMap'];
    const pending = [];
    scene.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of texKeys) {
          const t = m[k];
          if (t && t.isTexture && !seen.has(t)) { seen.add(t); pending.push(t); }
        }
      }
    });
    // batched across frames — one giant burst would itself be the hitch we're removing
    for (let i = 0; i < pending.length; i += 24) {
      for (let j = i; j < Math.min(i + 24, pending.length); j++) renderer.initTexture(pending[j]);
      await tick();
    }
    step('Warming the view');
    // linking programs is not enough — Windows/ANGLE drivers defer the real compile to a
    // program's FIRST DRAW. One frame with frustum culling off forces a draw of every
    // visible material (and uploads its geometry); fragments off-screen are clipped.
    const culled = [];
    scene.traverse((o) => {
      if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
    });
    renderer.shadowMap.needsUpdate = true; // bake once here so depth-pass programs compile behind the veil
    try { composer.render(); } catch (e) { renderer.render(scene, camera); }
    for (const o of culled) o.frustumCulled = true;
    await tick();
    // a couple of normal frames settle the AO history and bloom targets
    for (let i = 0; i < 3; i++) {
      camera.rotation.set(0, (i * Math.PI * 2) / 3, 0, 'YXZ');
      renderer.shadowMap.needsUpdate = true;
      try { composer.render(); } catch (e) { renderer.render(scene, camera); }
      await tick();
    }
  }

  return {
    renderer,
    scene,
    prewarm,
    camera,
    rig,
    post: { composer, gtao, bloom, sun, stats: () => ({ shadowBakes }) },
    render,
    resize,
    raycastCell,
    raycastGround,
    updateTurf,
    updatePlan,
    updateHoles,
    rebuildAll,
    refreshGround,
    rebuildObjects,
    rebuildPaths,
    rebuildTrees,
    rebuildWater,
    rebuildFlowField,
    setViewMode,
    setBrush,
    setEditorBrush,
    setPlacementGhost,
    setMeasureLine,
    setBallVisual,
    setAimArc,
    setLightingOverride,
    frameCourse,
    frameHole,
    pickObject,
    worldX,
    worldZ,
    applyTimeWeather,
    heightAt,
    zoneAtWorld: (x, z) => {
      const cx = Math.floor((x + worldW / 2) / CELL_YD);
      const cy = Math.floor((z + worldH / 2) / CELL_YD);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return ZONE.OUT;
      return course.zones[cy * W + cx];
    },
    inBoundsWorld: (x, z) => Math.abs(x) <= worldW / 2 + 40 && Math.abs(z) <= worldH / 2 + 40,
    setGolfersFrozen: (v) => { golfersFrozen = !!v; },
    clubhouse: () => clubhouseApi,
    walk: {
      enter: walkEnter,
      exit: walkExit,
      update: walkUpdate,
      interact: walkInteract,
      getFocusLabel: () => (walkFocus ? walkFocus.label : null),
      getFocus: () => walkFocus,
      hooks: walkHooks,
      placeCart: (x, z, yaw) => {
        cart.x = x;
        cart.z = z;
        if (yaw !== undefined) cart.yaw = yaw;
        placeCartMesh();
      },
      setTool: walkSetTool,
      getTool: () => walkTool,
      setSpraying: walkSetSpraying,
      isSpraying: () => walkSpraying,
      setSoaping: (on) => { walkSoaping = !!on && walkTool === 'washer'; },
      isSoaping: () => walkSoaping,
      clearKeys: walkBlur, // a mode change drops whatever was held, so you never resume walking into a wall
      unstick: walkUnstick, // the pause menu's manual fallback; returns how it got you out, or null
      isFree: (x, z, r) => walkFreeAt(x, z, r ?? walk.radius), // also what placement validation asks
      focusOn: walkFocusOn,
      clearFocus: walkClearFocus,
      isFocused: () => !!walkFocusPose,
      aimCell: walkAimCell,
      isActive: () => walk.active,
      state: walk, // position/yaw/pitch — also the QA hook
      cart, // cart state, same purpose
      colliders: { trees: treeColliders, structures: structColliders }, // read-only for QA
    },
    dispose,
  };
}
