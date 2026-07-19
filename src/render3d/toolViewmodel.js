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

  const loaded = new Map(); // toolId -> { root, mixer, clips, actions }
  const activeTools = new Set();
  let equippedTool = null;

  const PHASE_CLIP = Object.freeze({
    equip: /_Equip$/i,
    unequip: /_Unequip$/i,
    start: /_(?:Start|TriggerDown|HeadCompress|BristleContact|PickUp|Tie)$/i,
    active: /_(?:FloorHeadContact|StrokeLeft|StrokeRight|SweepLeft|SweepRight|Wipe|Scrub|Recoil|Trigger)$/i,
    stop: /_(?:Stop|TriggerUp|SetDown)$/i,
  });

  function clipsFor(entry, phase) {
    const pattern = PHASE_CLIP[phase];
    return pattern ? entry.clips.filter((clip) => pattern.test(clip.name || '')) : [];
  }

  function playClip(entry, clip, { loop = false } = {}) {
    if (!entry || !clip) return null;
    const action = entry.mixer.clipAction(clip);
    action.stop();
    action.reset();
    action.enabled = true;
    action.clampWhenFinished = !loop;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.play();
    entry.actions.add(action);
    entry.played.add(clip.name);
    return action;
  }

  function playPhase(toolId, phase, options = {}) {
    const entry = loaded.get(toolId);
    const clips = entry ? clipsFor(entry, phase) : [];
    if (!clips.length) return null;
    // Opposed stroke/sweep clips animate the same pivots. Pick one per hold; the next hold uses
    // the other authored direction instead of blending both into a stationary average.
    const index = phase === 'active' ? entry.activeVariant++ % clips.length : 0;
    return playClip(entry, clips[index], options);
  }

  function setActive(toolId, on) {
    if (!toolId) return;
    if (on) activeTools.add(toolId);
    else activeTools.delete(toolId);
    const entry = loaded.get(toolId);
    if (!entry || entry.active === on) return;
    entry.active = on;
    if (entry.activeAction) {
      entry.activeAction.stop();
      entry.activeAction = null;
    }
    if (on) {
      playPhase(toolId, 'start');
      entry.activeAction = playPhase(toolId, 'active', { loop: true });
    } else {
      playPhase(toolId, 'stop');
    }
  }

  function setTool(nextTool, previousTool = equippedTool) {
    if (previousTool && previousTool !== nextTool) {
      setActive(previousTool, false);
      playPhase(previousTool, 'unequip');
    }
    equippedTool = nextTool || null;
    if (nextTool && nextTool !== previousTool) playPhase(nextTool, 'equip');
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
              if (/^(?:COL_|COLLISION_|VOLUME_)/i.test(o.name || '')
                || o.userData?.collision_proxy === true) o.visible = false;
              o.castShadow = false;
              o.receiveShadow = false;
            });
            group.add(root);
            const authoredClips = def.fp.only
              ? (gltf.animations || []).filter((clip) => (
                (clip.name || '').toLowerCase().includes(def.fp.only.toLowerCase())
              ))
              : [...(gltf.animations || [])];
            const entry = {
              root,
              mixer: new THREE.AnimationMixer(root),
              clips: authoredClips,
              actions: new Set(),
              played: new Set(),
              active: false,
              activeAction: null,
              activeVariant: 0,
            };
            loaded.set(def.id, entry);
            if (def.id === equippedTool) playPhase(def.id, 'equip');
            if (activeTools.has(def.id)) setActive(def.id, true);
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
    setTool,
    setActive,
    update(dt) {
      for (const entry of loaded.values()) entry.mixer.update(dt);
    },
    diagnostics: () => ({
      authoredCount: loaded.size,
      equippedTool,
      activeTools: [...activeTools],
      tools: Object.fromEntries([...loaded.entries()].map(([id, entry]) => [id, {
        clips: entry.clips.map((clip) => clip.name),
        played: [...entry.played],
        active: entry.active,
      }])),
    }),
    dispose() {
      for (const entry of loaded.values()) {
        for (const action of entry.actions) action.stop();
        entry.mixer.stopAllAction();
        entry.mixer.uncacheRoot(entry.root);
        entry.root.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry?.dispose();
          const m = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of m) mat?.dispose();
        });
      }
      loaded.clear();
      activeTools.clear();
      for (const g of geoCache.values()) g.dispose();
      for (const m of mats.values()) m.dispose();
      geoCache.clear();
      mats.clear();
    },
  };
}
