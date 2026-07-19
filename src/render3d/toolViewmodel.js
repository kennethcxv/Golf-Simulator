// TOOL VIEWMODELS — built from the registry, not hand-wired one at a time.
//
// Reads src/data/cleaningTools.js and produces the held group for a tool: its geometry, its named
// sockets, and the transform that puts it in frame. Materials and geometries are shared across
// every tool that asks for the same thing, so nine tools do not mean nine copies of the same
// black polymer.
//
// The point of going data-driven: a new tool is an entry in the registry. It does not need a new
// build function here, a new branch in courseScene, or a new grip table in fpHands.

import * as THREE from 'three';
import { CLEANING_TOOLS, PALETTE } from '../data/cleaningTools.js';
import { attachSocket } from './toolSockets.js';

// One material per palette entry, shared by every tool. Disposed together.
function makePalette() {
  const mats = new Map();
  for (const [name, spec] of Object.entries(PALETTE)) {
    mats.set(name, new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness ?? 0.8,
      metalness: spec.metalness ?? 0.0,
    }));
  }
  return mats;
}

function partGeometry(part, cache) {
  // Key on the numbers, so two tools asking for the same cylinder get one buffer.
  const key = JSON.stringify([part.kind, part.r0, part.r1, part.h, part.size, part.r, part.seg,
    part.path]);
  const hit = cache.get(key);
  if (hit) return hit;

  let g;
  switch (part.kind) {
    case 'cyl':
      g = new THREE.CylinderGeometry(part.r0, part.r1, part.h, part.seg ?? 10);
      break;
    case 'box':
      g = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
      break;
    case 'sph':
      g = new THREE.SphereGeometry(part.r, part.seg ?? 10, Math.max(6, (part.seg ?? 10) - 2));
      break;
    case 'cone':
      g = new THREE.ConeGeometry(part.r, part.h, part.seg ?? 10);
      break;
    case 'tube': {
      const pts = part.path.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, part.r, 6, false);
      break;
    }
    default:
      throw new Error(`toolViewmodel: unknown part kind '${part.kind}'`);
  }
  cache.set(key, g);
  return g;
}

/**
 * Build every registry tool that owns its own geometry.
 * Tools flagged `external: true` are built elsewhere (the washer still lives in courseScene) but
 * still get their sockets and grips from the registry.
 *
 * @returns {{groups: Object<string, THREE.Group>, dispose: function}}
 */
export function buildToolViewmodels() {
  const mats = makePalette();
  const geoCache = new Map();
  const groups = {};

  for (const def of Object.values(CLEANING_TOOLS)) {
    const group = new THREE.Group();
    group.name = `Tool_${def.id}`;
    group.visible = false;

    if (Array.isArray(def.parts)) {
      for (const part of def.parts) {
        const mat = mats.get(part.mat);
        if (!mat) throw new Error(`toolViewmodel: '${def.id}' wants unknown material '${part.mat}'`);
        const mesh = new THREE.Mesh(partGeometry(part, geoCache), mat);
        // A tube carries its route in the part's own coordinates, so it has no placement of its
        // own; everything else is positioned explicitly.
        if (part.pos) mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
        if (part.rot) mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
        // A viewmodel is drawn over the world at arm's length; it neither casts nor receives the
        // sun's shadow, and paying for either is pure waste.
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        group.add(mesh);
      }
    }

    for (const [name, s] of Object.entries(def.sockets || {})) {
      attachSocket(group, name, s.pos, s.rot || [0, 0, 0]);
    }

    if (def.place) group.position.set(def.place[0], def.place[1], def.place[2]);
    if (def.orient) group.rotation.set(def.orient[0], def.orient[1], def.orient[2]);

    groups[def.id] = group;
  }

  const loaded = new Map(); // toolId -> { root, mixer, clips, using, grips }

  const lower = (value) => String(value || '').toLowerCase();
  const findClip = (entry, needles) => {
    const wanted = (Array.isArray(needles) ? needles : [needles]).map(lower);
    if (!entry?.clips) return null;
    for (const needle of wanted) {
      const clip = entry.clips.find((candidate) => lower(candidate.name).includes(needle));
      if (clip) return clip;
    }
    return null;
  };

  function playClip(toolId, needles, { loop = false, fade = 0.06 } = {}) {
    const entry = loaded.get(toolId);
    const clip = findClip(entry, needles);
    if (!entry?.mixer || !clip) return false;
    const action = entry.mixer.clipAction(clip);
    action.enabled = true;
    action.reset();
    action.clampWhenFinished = !loop;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    if (fade > 0) action.fadeIn(fade);
    action.play();
    entry.lastClip = clip.name;
    return true;
  }

  function authoredGrip(group, root, name, fallback) {
    const node = name ? root.getObjectByName(name) : null;
    if (!node) return fallback ? { ...fallback, pos: [...fallback.pos], rot: [...fallback.rot] } : null;
    group.updateWorldMatrix(true, false);
    node.updateWorldMatrix(true, false);
    const position = node.getWorldPosition(new THREE.Vector3());
    group.worldToLocal(position);
    // Authored sockets are the positional authority. Registry rotations remain the hand-pose
    // authority: Blender empties differ in axis convention between older sheets, while their
    // placement points are consistent and eliminate the detached-wrist gap.
    return {
      ...(fallback || {}),
      pos: [position.x, position.y, position.z],
      rot: fallback?.rot ? [...fallback.rot] : [0, 0, 0],
    };
  }

  /**
   * Swap the authored first-person GLB in over the procedural fallback.
   *
   * The pipeline builds real viewmodels for these tools, and until now nothing loaded them — a
   * folder of finished geometry that never reached the screen. The procedural parts stay as the
   * instant fallback, because equipping a tool must never wait on a fetch; the authored mesh
   * replaces them the moment it arrives.
   *
   * The authored assets carry their own sockets (SOCKET_FloorContact, SOCKET_SprayEmission,
   * SOCKET_GripPrimary…). Those are the truth once loaded — the registry's hand-authored socket
   * positions were only ever standing in for them.
   */
  async function adoptAuthored(loader, onReady) {
    const jobs = [];
    for (const def of Object.values(CLEANING_TOOLS)) {
      if (!def.fp || !def.fp.glb) continue;
      jobs.push(new Promise((resolve) => {
        loader.load(def.fp.glb, (gltf) => {
          try {
            const group = groups[def.id];
            if (!group) return resolve({ id: def.id, ok: false, reason: 'no group' });
            const root = gltf.scene;

            // A shared set (cloth + sponge live in one asset) shows only its own half.
            if (def.fp.only) {
              const keep = def.fp.only.toLowerCase();
              const drop = [];
              root.traverse((o) => {
                if (!o.isMesh) return;
                if (!(o.name || '').toLowerCase().includes(keep)) drop.push(o);
              });
              for (const o of drop) o.parent?.remove(o);
            }

            // ALIGN THE AUTHORED MESH ONTO THE REGISTRY'S SOCKETS — do not move the sockets.
            //
            // The two frames disagree in three ways. The authored assets are METRES, their origin
            // sits at SOCKET_GripPrimary, and they run along +Z; the registry works in yards from
            // the tool's own origin along -Z. Re-pointing the registry sockets at the authored ones
            // moved every contact point and quietly broke sweeping and collecting.
            //
            // So the sockets — which are tuned, tested, and what the gameplay reads — stay exactly
            // where they are, and the authored geometry is transformed to meet them. Visual quality
            // improves; behaviour does not move a millimetre.
            const M_TO_YD = 1.0936133;
            root.scale.setScalar(M_TO_YD);
            root.rotation.y = Math.PI; // authored +Z forward -> our -Z forward
            root.updateMatrixWorld(true);

            // Land the authored working point on ours.
            const ourName = Object.keys(def.fp.sockets || {})[0];
            const theirName = def.fp.sockets?.[ourName];
            const ours = ourName ? group.children.find((c) => c.name === `SOCKET_${ourName}`) : null;
            const theirs = theirName ? root.getObjectByName(theirName) : null;
            if (ours && theirs) {
              theirs.updateWorldMatrix(true, false);
              const theirLocal = new THREE.Vector3().setFromMatrixPosition(theirs.matrixWorld);
              root.position.set(
                ours.position.x - theirLocal.x,
                ours.position.y - theirLocal.y,
                ours.position.z - theirLocal.z,
              );
            }

            // Retire the procedural stand-in now that the authored mesh is placed.
            for (const child of [...group.children]) {
              if (child.isMesh) group.remove(child);
            }

            root.traverse((o) => {
              if (!o.isMesh) return;
              o.castShadow = false;
              o.receiveShadow = false;
            });

            // The spray sheet's pivot was exported while its equip action was evaluated, leaving
            // the trigger blade below the bottle in the GLB's static pose. The named trigger socket
            // is authored at the correct hinge, and the Trigger clip only animates rotation, so
            // restoring the pivot to that sibling is lossless and keeps the blade attached.
            if (def.id === 'spray') {
              const pivot = root.getObjectByName('PIVOT_Trigger');
              const triggerSocket = root.getObjectByName('SOCKET_Trigger');
              if (pivot && triggerSocket && pivot.parent === triggerSocket.parent) {
                pivot.position.copy(triggerSocket.position);
                pivot.quaternion.identity();
                pivot.scale.set(1, 1, 1);
              }
            }
            group.add(root);
            group.updateWorldMatrix(true, true);
            const mixer = Array.isArray(gltf.animations) && gltf.animations.length
              ? new THREE.AnimationMixer(root) : null;
            const grips = {
              grip: authoredGrip(group, root, def.fp.grips?.right, def.grip),
              support: authoredGrip(group, root, def.fp.grips?.left, def.support),
            };
            loaded.set(def.id, {
              root,
              mixer,
              clips: gltf.animations || [],
              using: false,
              equipped: false,
              grips,
              lastClip: null,
            });
            resolve({ id: def.id, ok: true });
          } catch (err) {
            resolve({ id: def.id, ok: false, reason: err.message });
          }
        }, undefined, (err) => {
          // A missing authored asset is not fatal: the procedural tool is already on screen and
          // fully playable. Report it rather than throwing away a working viewmodel.
          resolve({ id: def.id, ok: false, reason: err?.message || 'load failed' });
        });
      }));
    }
    const results = await Promise.all(jobs);
    if (onReady) onReady(results);
    return results;
  }

  return {
    groups,
    adoptAuthored,
    authoredCount: () => loaded.size,
    gripsFor: (id) => loaded.get(id)?.grips || null,
    setEquipped(id, on) {
      const entry = loaded.get(id);
      if (!entry || entry.equipped === !!on) return false;
      entry.equipped = !!on;
      return playClip(id, on
        ? [`${id}_equip`, `${id}wand_equip`, 'equip']
        : [`${id}_unequip`, `${id}wand_unequip`, 'unequip', 'putaway']);
    },
    setUsing(id, on) {
      const entry = loaded.get(id);
      if (!entry || entry.using === !!on) return false;
      entry.using = !!on;
      if (!on) {
        entry.mixer?.stopAllAction();
        return playClip(id, ['triggerup', 'trigger_up', 'stop', 'release']);
      }
      entry.mixer?.stopAllAction();
      const work = {
        washer: ['recoil', 'triggerdown', 'trigger_down'],
        vacuum: ['floorheadcontact', 'start'],
        mop: ['strokeleft', 'strokeright', 'headcompress'],
        broom: ['sweepleft', 'sweepright', 'bristle'],
        dustpan: ['setdown', 'pickup'],
        spray: ['trigger'],
        cloth: ['clothwipe', 'wipe'],
        sponge: ['spongescrub', 'scrub'],
        trashbag: ['bagpickup', 'pickup'],
      }[id] || ['work', 'use'];
      return playClip(id, work, { loop: true, fade: 0.04 });
    },
    play(id, needles, options) {
      loaded.get(id)?.mixer?.stopAllAction();
      return playClip(id, needles, options);
    },
    setFillState(id, fraction = 0, tied = false) {
      const entry = loaded.get(id);
      if (!entry || id !== 'trashbag') return false;
      const f = Math.max(0, Math.min(1, Number(fraction) || 0));
      entry.root.traverse((object) => {
        if (!object.isMesh || !/bag/i.test(object.name || '')) return;
        // Scale mesh geometry around authored origins, leaving the root and grip socket fixed.
        object.scale.set(0.78 + f * 0.28, 0.82 + f * 0.22, 0.78 + f * 0.28);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material?.color) continue;
          if (!Number.isFinite(material.userData.cleaningBaseColor)) {
            material.userData.cleaningBaseColor = material.color.getHex();
          }
          material.color.setHex(material.userData.cleaningBaseColor);
          if (tied) material.color.multiplyScalar(0.82);
          if ('roughness' in material) material.roughness = 0.82;
          if ('metalness' in material) material.metalness = 0;
        }
      });
      entry.root.userData.cleaningFill = f;
      entry.root.userData.cleaningTied = !!tied;
      return true;
    },
    update(dtSec) {
      const dt = Math.max(0, Math.min(0.1, Number(dtSec) || 0));
      for (const entry of loaded.values()) entry.mixer?.update(dt);
    },
    diagnostics: () => ({
      authored: loaded.size,
      animated: [...loaded.entries()].filter(([, entry]) => !!entry.mixer).map(([id]) => id),
      playing: [...loaded.entries()].filter(([, entry]) => entry.using).map(([id]) => id),
      clips: Object.fromEntries([...loaded.entries()].map(([id, entry]) => [id, entry.clips.map((clip) => clip.name)])),
    }),
    releaseForSceneDispose() {
      const liveGeometries = new Set();
      const liveMaterials = new Set();
      for (const group of Object.values(groups)) group.traverse((object) => {
        if (!object.isMesh) return;
        if (object.geometry) liveGeometries.add(object.geometry);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material) liveMaterials.add(material);
      });
      let detachedGeometries = 0;
      let detachedMaterials = 0;
      for (const geometry of geoCache.values()) {
        if (liveGeometries.has(geometry)) continue;
        geometry.dispose();
        detachedGeometries++;
      }
      for (const material of mats.values()) {
        if (liveMaterials.has(material)) continue;
        material.dispose();
        detachedMaterials++;
      }
      for (const entry of loaded.values()) {
        entry.mixer?.stopAllAction();
        entry.mixer?.uncacheRoot(entry.root);
      }
      geoCache.clear();
      mats.clear();
      return { detachedGeometries, detachedMaterials, mixers: loaded.size };
    },
    dispose() {
      for (const entry of loaded.values()) {
        entry.mixer?.stopAllAction();
        entry.mixer?.uncacheRoot(entry.root);
        entry.root.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry?.dispose();
          const m = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of m) mat?.dispose();
        });
      }
      loaded.clear();
      for (const g of geoCache.values()) g.dispose();
      for (const m of mats.values()) m.dispose();
      geoCache.clear();
      mats.clear();
    },
  };
}
