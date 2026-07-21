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

  const loaded = new Map(); // toolId -> authored scene, mixer, clips and actions
  const pending = new Map(); // toolId -> one in-flight load, shared by rapid equip requests
  const motionState = new Map(); // survives an equip/use request that beats the async GLB load
  let disposed = false;

  const stateFor = (id) => {
    let state = motionState.get(id);
    if (!state) {
      state = { equipped: false, using: false };
      motionState.set(id, state);
    }
    return state;
  };

  function stopSequence(entry) {
    entry.sequence = null;
    entry.sequenceIndex = 0;
    entry.pendingLoop = null;
  }

  function playAction(entry, name, { repeat = false, fade = 0.08 } = {}) {
    const action = name ? entry.actions.get(name) : null;
    if (!action) return false;
    const previous = entry.activeAction;
    if (previous && previous !== action) previous.fadeOut(fade);
    action.reset();
    action.enabled = true;
    action.clampWhenFinished = !repeat;
    action.setLoop(repeat ? THREE.LoopRepeat : THREE.LoopOnce, repeat ? Infinity : 1);
    action.fadeIn(fade).play();
    entry.activeAction = action;
    entry.activeName = name;
    return true;
  }

  function beginUseLoop(entry) {
    const names = entry.definition.fp?.motion?.useLoop || [];
    if (!names.length) return false;
    entry.sequence = names;
    entry.sequenceIndex = 0;
    entry.pendingLoop = null;
    return playAction(entry, names[0], { repeat: names.length === 1 });
  }

  function bindMixerLifecycle(entry) {
    if (!entry.mixer) return;
    entry.onFinished = ({ action }) => {
      if (action !== entry.activeAction) return;
      const state = stateFor(entry.definition.id);
      if (!state.using) return;
      if (entry.pendingLoop) {
        beginUseLoop(entry);
        return;
      }
      if (!entry.sequence || entry.sequence.length < 2) return;
      entry.sequenceIndex = (entry.sequenceIndex + 1) % entry.sequence.length;
      playAction(entry, entry.sequence[entry.sequenceIndex]);
    };
    entry.mixer.addEventListener('finished', entry.onFinished);
  }

  function applyMotionState(id) {
    const entry = loaded.get(id);
    if (!entry) return false;
    const state = stateFor(id);
    const motion = entry.definition.fp?.motion || {};
    if (state.using) {
      stopSequence(entry);
      if (motion.useStart && playAction(entry, motion.useStart)) {
        entry.pendingLoop = motion.useLoop || [];
      } else {
        beginUseLoop(entry);
      }
    } else if (state.equipped && motion.equip) {
      playAction(entry, motion.equip);
    }
    return true;
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
  function ensureAuthored(id, loader) {
    const def = CLEANING_TOOLS[id];
    if (!def?.fp?.glb) return Promise.resolve({ id, ok: false, reason: 'no authored asset' });
    if (loaded.has(id)) return Promise.resolve({ id, ok: true, cached: true });
    if (pending.has(id)) return pending.get(id);

    const job = new Promise((resolve) => {
        loader.load(def.fp.glb, (gltf) => {
          try {
            if (disposed) {
              gltf.scene?.traverse((o) => {
                if (!o.isMesh) return;
                o.geometry?.dispose();
                const materials = Array.isArray(o.material) ? o.material : [o.material];
                for (const material of materials) material?.dispose();
              });
              return resolve({ id: def.id, ok: false, reason: 'disposed' });
            }
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
            root.scale.setScalar(M_TO_YD * (def.fp.scale || 1));
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
            group.add(root);
            const mixer = gltf.animations?.length ? new THREE.AnimationMixer(root) : null;
            const actions = new Map();
            for (const clip of gltf.animations || []) {
              const action = mixer?.clipAction(clip, root);
              if (action) actions.set(clip.name, action);
            }
            const entry = {
              root,
              mixer,
              actions,
              definition: def,
              activeAction: null,
              activeName: null,
              sequence: null,
              sequenceIndex: 0,
              pendingLoop: null,
              onFinished: null,
            };
            loaded.set(def.id, entry);
            bindMixerLifecycle(entry);
            applyMotionState(def.id);
            resolve({ id: def.id, ok: true });
          } catch (err) {
            resolve({ id: def.id, ok: false, reason: err.message });
          }
        }, undefined, (err) => {
          // A missing authored asset is not fatal: the procedural tool is already on screen and
          // fully playable. Report it rather than throwing away a working viewmodel.
          resolve({ id: def.id, ok: false, reason: err?.message || 'load failed' });
        });
      });
    pending.set(id, job);
    job.finally(() => pending.delete(id));
    return job;
  }

  async function adoptAuthored(loader, onReady) {
    const jobs = Object.values(CLEANING_TOOLS)
      .filter((def) => def.fp?.glb)
      .map((def) => ensureAuthored(def.id, loader));
    const results = await Promise.all(jobs);
    if (onReady) onReady(results);
    return results;
  }

  return {
    groups,
    adoptAuthored,
    ensureAuthored,
    authoredCount: () => loaded.size,
    setEquipped(id, equipped) {
      const state = stateFor(id);
      state.equipped = !!equipped;
      if (!equipped) state.using = false;
      const entry = loaded.get(id);
      if (!entry) return false;
      stopSequence(entry);
      const motion = entry.definition.fp?.motion || {};
      return playAction(entry, equipped ? motion.equip : motion.unequip);
    },
    setUsing(id, using) {
      if (!id) return false;
      const state = stateFor(id);
      if (state.using === !!using) return !!loaded.get(id);
      state.using = !!using;
      const entry = loaded.get(id);
      if (!entry) return false;
      const motion = entry.definition.fp?.motion || {};
      stopSequence(entry);
      if (using) {
        if (motion.useStart && playAction(entry, motion.useStart)) {
          entry.pendingLoop = motion.useLoop || [];
          return true;
        }
        return beginUseLoop(entry);
      }
      if (motion.useStop) return playAction(entry, motion.useStop);
      if (entry.activeAction) entry.activeAction.fadeOut(0.10);
      entry.activeAction = null;
      entry.activeName = null;
      return true;
    },
    update(dt) {
      const delta = Math.max(0, dt);
      for (const [id, entry] of loaded.entries()) {
        const state = stateFor(id);
        // Loaded viewmodels stay cached so cycling the belt never hitches, but a
        // hidden tool has no animation work to contribute. Several authored clips
        // carry large keyframe tracks; advancing every cached mixer after the tool
        // was put away produced a permanent frame-time tax that grew with each new
        // belt item the player had inspected.
        if (state.equipped || state.using) entry.mixer?.update(delta);
      }
    },
    motionDiagnostics() {
      return Object.freeze([...loaded.entries()].map(([id, entry]) => Object.freeze({
        id,
        clipCount: entry.actions.size,
        activeClip: entry.activeName,
        using: stateFor(id).using,
        equipped: stateFor(id).equipped,
        mixerTime: entry.mixer?.time ?? null,
      })));
    },
    dispose() {
      disposed = true;
      for (const entry of loaded.values()) {
        if (entry.mixer && entry.onFinished) entry.mixer.removeEventListener('finished', entry.onFinished);
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
      pending.clear();
      motionState.clear();
      for (const g of geoCache.values()) g.dispose();
      for (const m of mats.values()) m.dispose();
      geoCache.clear();
      mats.clear();
    },
  };
}
