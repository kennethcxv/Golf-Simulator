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
import { createMopStrands } from './mopStrands.js';

// Scratch for resolving an authored socket into the tool group's frame. Reused every frame the
// hands re-sync onto live sockets, so allocating here rather than per-call keeps it off the heap.
const _gripInv = new THREE.Matrix4();
const _gripRel = new THREE.Matrix4();
const _gripPos = new THREE.Vector3();
const _gripQuat = new THREE.Quaternion();
const _gripScale = new THREE.Vector3();
const _gripStandoff = new THREE.Vector3();

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

  const loaded = new Map();
  const activeTools = new Set();
  let equippedTool = null;

  const PHASE_CLIP = Object.freeze({
    equip: /_Equip$/i,
    unequip: /_Unequip$/i,
    start: /_(?:Start|TriggerDown|HeadCompress|BristleContact|PickUp|Tie)$/i,
    active: /_(?:FloorHeadContact|StrokeLeft|StrokeRight|SweepLeft|SweepRight|Wipe|Scrub|Recoil|Trigger|Swallow)$/i,
    stop: /_(?:Stop|TriggerUp|SetDown)$/i,
  });
  const lower = (value) => String(value || '').toLowerCase();

  function clipsFor(entry, phase) {
    const pattern = PHASE_CLIP[phase];
    return pattern ? entry.clips.filter((clip) => pattern.test(clip.name || '')) : [];
  }

  function playAction(entry, clip, { loop = false, fade = 0 } = {}) {
    if (!entry?.mixer || !clip) return null;
    const action = entry.mixer.clipAction(clip);
    action.stop();
    action.reset();
    action.enabled = true;
    action.clampWhenFinished = !loop;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    if (fade > 0) action.fadeIn(fade);
    action.play();
    entry.actions.add(action);
    entry.played.add(clip.name);
    entry.lastClip = clip.name;
    return action;
  }

  function playPhase(toolId, phase, options = {}) {
    const entry = loaded.get(toolId);
    const clips = entry ? clipsFor(entry, phase) : [];
    if (!clips.length) return null;
    const index = phase === 'active' ? entry.activeVariant++ % clips.length : 0;
    return playAction(entry, clips[index], options);
  }

  function findClip(entry, needles) {
    const wanted = (Array.isArray(needles) ? needles : [needles]).map(lower);
    if (!entry?.clips) return null;
    for (const needle of wanted) {
      const clip = entry.clips.find((candidate) => lower(candidate.name).includes(needle));
      if (clip) return clip;
    }
    return null;
  }

  function playClip(toolId, needles, { loop = false, fade = 0.06 } = {}) {
    const entry = loaded.get(toolId);
    return !!playAction(entry, findClip(entry, needles), { loop, fade });
  }

  function setActive(toolId, on) {
    if (!toolId) return false;
    if (on) activeTools.add(toolId);
    else activeTools.delete(toolId);
    const entry = loaded.get(toolId);
    if (!entry || entry.active === !!on) return false;
    entry.active = !!on;
    entry.using = !!on;
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
    return true;
  }

  function setEquipped(toolId, on) {
    const entry = loaded.get(toolId);
    if (!entry || entry.equipped === !!on) return false;
    entry.equipped = !!on;
    // A clamped equip/unequip pose must not blend with the next belt cycle.
    entry.mixer?.stopAllAction();
    entry.activeAction = null;
    return playClip(toolId, on
      ? [`${toolId}_equip`, `${toolId}wand_equip`, 'equip']
      : [`${toolId}_unequip`, `${toolId}wand_unequip`, 'unequip', 'putaway']);
  }

  function setUsing(toolId, on) {
    return setActive(toolId, !!on);
  }

  function setTool(nextTool, previousTool = equippedTool) {
    if (previousTool && previousTool !== nextTool) {
      setActive(previousTool, false);
      setEquipped(previousTool, false);
    }
    equippedTool = nextTool || null;
    if (nextTool && nextTool !== previousTool) setEquipped(nextTool, true);
  }

  function authoredGrip(group, root, name, fallback) {
    const node = name ? root.getObjectByName(name) : null;
    if (!node) return fallback ? { ...fallback, pos: [...fallback.pos], rot: [...fallback.rot] } : null;
    // Resolve the authored socket in the tool group's OWN frame — position AND orientation. The
    // builders author every grip socket with the same forward convention (local -Z onto the held
    // tool's -Y shaft axis), so the quaternion is the truth about which way the hand must wrap;
    // discarding it was why flat/hook/trigger grips fanned open. A tool with no authored socket
    // keeps the registry fallback (no quat) and falls through to the entryPitch heuristic.
    node.updateWorldMatrix(true, false);
    _gripInv.copy(group.matrixWorld).invert();
    _gripRel.multiplyMatrices(_gripInv, node.matrixWorld);
    _gripRel.decompose(_gripPos, _gripQuat, _gripScale);
    // ITEM 9 (2026-08-06): "hands still visible on sponge and cloth."
    //
    // Photographed at the held pose, five fingertips stand up THROUGH the top
    // of the sponge and through the folded cloth — the hand is inside the tool,
    // not holding it. The cause is here: the authored socket's position wins
    // outright over the registry's, and on the palm-held tools that socket sits
    // at the block's own centre, which is fine for a shaft (the hand closes
    // around a 3 cm pole) and wrong for a 9 cm block (the hand closes through
    // it).
    //
    // A tool that declares a grip `standoff` moves the resolved socket in the
    // TOOL's own frame — the same frame the registry's fallback pos is written
    // in, so the two numbers can be read against each other. A pole needs none
    // (the shaft passes through the closed palm, which is correct); a block
    // needs the hand lifted clear of its surface.
    const standoff = fallback?.standoff;
    if (Array.isArray(standoff) && standoff.length === 3) {
      _gripStandoff.set(standoff[0], standoff[1], standoff[2]);
      _gripPos.add(_gripStandoff);
    }
    return {
      ...(fallback || {}),
      pos: [_gripPos.x, _gripPos.y, _gripPos.z],
      rot: fallback?.rot ? [...fallback.rot] : [0, 0, 0],
      quat: [_gripQuat.x, _gripQuat.y, _gripQuat.z, _gripQuat.w],
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
            group.updateWorldMatrix(true, true);
            const entry = {
              group,
              root,
              mixer: authoredClips.length ? new THREE.AnimationMixer(root) : null,
              clips: authoredClips,
              actions: new Set(),
              played: new Set(),
              active: false,
              using: false,
              equipped: false,
              activeAction: null,
              activeVariant: 0,
              gripNames: {
                right: def.fp.grips?.right || null,
                left: def.fp.grips?.left || null,
              },
              gripFallbacks: {
                right: def.grip,
                left: def.support,
              },
              lastClip: null,
            };
            loaded.set(def.id, entry);
            if (def.id === equippedTool) setEquipped(def.id, true);
            if (activeTools.has(def.id)) setUsing(def.id, true);
            // ITEM 8 → B3 (2026-08-07): the moving fibres ARE the visible
            // fibres now. B0 measured the old arrangement's lie in pixels:
            // the authored MESH_MopSkirt is a WELDED bundle (the builder
            // joins its modelled strands into one static mesh) and the 14
            // thin procedural strands hung among it were only 25.2% of the
            // skirt's pixels — the eye watched a solid block while the
            // instruments truthfully measured the moving minority. The
            // welded mesh is HIDDEN (kept in the GLB so hash gates and
            // controls can still find it) and the procedural rig is sized
            // up to BE the skirt. The broom gets the same treatment for the
            // first time: its authored MESH_BroomBristles is the same
            // welded construction, hidden here, replaced by stiff tuft rows
            // driven from the rig's own stroke (bar layout, fast chase, low
            // slack — push-broom character per the goal).
            if (def.id === 'mop' && !entry.strandRig) {
              const skirt = root.getObjectByName('MESH_MopSkirt');
              const collar = root.getObjectByName('MESH_MopCollar') || skirt;
              if (collar) {
                if (skirt) skirt.visible = false;
                const yarn = new THREE.MeshStandardMaterial({
                  color: 0xe4dcc6, roughness: 0.95, metalness: 0,
                });
                const rig = createMopStrands({
                  THREE,
                  material: yarn,
                  count: 26,
                  radius: 0.115,
                  length: 0.30,
                  strandRadiusTop: 0.011,
                  strandRadiusBottom: 0.0075,
                });
                collar.add(rig.root);
                entry.strandRig = rig;
                entry.strandMaterial = yarn;
                group.userData.strandRig = rig;
              }
            }
            if (def.id === 'broom' && !entry.strandRig) {
              const weldedBristles = root.getObjectByName('MESH_BroomBristles');
              const contact = root.getObjectByName('SOCKET_FloorContact');
              const parent = contact?.parent || null;
              if (parent) {
                if (weldedBristles) weldedBristles.visible = false;
                const bristle = new THREE.MeshStandardMaterial({
                  color: 0x27231f, roughness: 0.85, metalness: 0,
                });
                const rig = createMopStrands({
                  THREE,
                  material: bristle,
                  layout: 'bar',
                  count: 22,
                  segments: 2,
                  length: 0.115,        // GLB-local metres: block underside to floor
                  barWidth: 0.46,
                  barDepth: 0.05,
                  barRows: 2,
                  strandRadiusTop: 0.013,
                  strandRadiusBottom: 0.009,
                  // push-broom character: fast settle, short travel, little slack
                  params: {
                    chaseBase: 26, chaseFall: 5, pushGain: 0.55, dragGain: 0.05,
                    splayBase: 0.18, splayGrow: 0.22, slackScale: 0.55,
                    deficitBase: 0.35, deficitGrow: 0.18, targetBase: 0.5,
                    targetGrow: 0.22, carryChase: 0.8,
                  },
                });
                rig.root.position.copy(contact.position);
                rig.root.position.y += 0.115;
                parent.add(rig.root);
                entry.strandRig = rig;
                entry.strandMaterial = bristle;
                group.userData.strandRig = rig;
              }
            }
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
    setEquipped,
    setUsing,
    gripsFor(id) {
      const entry = loaded.get(id);
      if (!entry) return null;
      // Resolve sockets after the current animation step so the hands follow authored motion.
      entry.group.updateWorldMatrix(true, true);
      // Q7: THE REGISTRY DECIDES HOW MANY HANDS, not the GLB.
      //
      // Every authored tool ships a SOCKET_GripSupport whether or not the tool
      // is held two-handed, so resolving the socket unconditionally handed a
      // second hand back for tools the registry had already set to
      // `support: null` - which is why turning the stick tools single-handed
      // changed nothing on screen. The socket stays in the asset so a
      // two-handed tool can opt back in by declaring a support again.
      const wantsSupport = entry.gripFallbacks.left != null;
      return {
        grip: authoredGrip(entry.group, entry.root, entry.gripNames.right, entry.gripFallbacks.right),
        support: wantsSupport
          ? authoredGrip(entry.group, entry.root, entry.gripNames.left, entry.gripFallbacks.left)
          : null,
      };
    },
    // Normalised playhead (0..1) of a clip-driven tool's looping work action, or null when the tool
    // has no authored active clip. Phase-6 audio and the contact gate read this to fire on the beat
    // of the authored motion instead of a wall clock.
    activePhase(id) {
      const entry = loaded.get(id);
      const action = entry?.activeAction;
      if (!action) return null;
      const clip = action.getClip ? action.getClip() : null;
      const duration = clip?.duration;
      if (!duration || duration <= 0) return null;
      return (action.time % duration) / duration;
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
    // Tint the mop's cotton skirt toward a damp, darker ecru while it holds charge; restore
    // to dry when it runs out. Mirrors setFillState's base-colour caching guard so repeated
    // frames re-apply from the authored colour and never ratchet the tint down.
    setMopDamp(id, charge = 0, capacity = 1) {
      const entry = loaded.get(id);
      if (!entry || id !== 'mop') return false;
      const cap = Number(capacity) || 0;
      const wet = cap > 0 ? Math.max(0, Math.min(1, (Number(charge) || 0) / cap)) : 0;
      entry.root.traverse((object) => {
        if (!object.isMesh || !/skirt/i.test(object.name || '')) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material?.color) continue;
          if (!Number.isFinite(material.userData.cleaningBaseColor)) {
            material.userData.cleaningBaseColor = material.color.getHex();
          }
          material.color.setHex(material.userData.cleaningBaseColor);
          if (wet > 0.01) material.color.multiplyScalar(1 - 0.34 * wet);
        }
      });
      entry.root.userData.mopWet = wet;
      return true;
    },
    update(dtSec) {
      const dt = Math.max(0, Math.min(0.1, Number(dtSec) || 0));
      for (const entry of loaded.values()) entry.mixer?.update(dt);
    },
    diagnostics: () => ({
      authoredCount: loaded.size,
      authored: loaded.size,
      equippedTool,
      activeTools: [...activeTools],
      animated: [...loaded.entries()].filter(([, entry]) => !!entry.mixer).map(([id]) => id),
      playing: [...loaded.entries()].filter(([, entry]) => entry.using).map(([id]) => id),
      clips: Object.fromEntries([...loaded.entries()].map(([id, entry]) => [id, entry.clips.map((clip) => clip.name)])),
      tools: Object.fromEntries([...loaded.entries()].map(([id, entry]) => [id, {
        clips: entry.clips.map((clip) => clip.name),
        played: [...entry.played],
        active: entry.active,
      }])),
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
        for (const action of entry.actions) action.stop();
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
      activeTools.clear();
      for (const g of geoCache.values()) g.dispose();
      for (const m of mats.values()) m.dispose();
      geoCache.clear();
      mats.clear();
    },
  };
}
