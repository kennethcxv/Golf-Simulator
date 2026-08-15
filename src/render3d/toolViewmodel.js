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
import { createVerletMopStrands, SHIPPED_MOP_YARN } from './mopVerlet.js';

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
    entry.equipAction = playClip(toolId, on
      ? [`${toolId}_equip`, `${toolId}wand_equip`, 'equip']
      : [`${toolId}_unequip`, `${toolId}wand_unequip`, 'unequip', 'putaway']);
    return entry.equipAction;
  }

  function setUsing(toolId, on) {
    // 5.2 (Goal 26): the yarn solver keeps two tunings and cannot pick between
    // them on its own -- from inside the solver, "carried" and "mopping" are the
    // same nodes moving. The tool's own use flag is the only honest source, and
    // routing it here means there is exactly one place that decides, next to the
    // animation that decides the same thing. D1 is the warning: a solver whose
    // switch nobody flips is a solver that only ever runs one of its two modes.
    const entry = loaded.get(toolId);
    entry?.strandRig?.setActive?.(!!on);
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
                // E1 (Goal 19, the fifth found-false): Goal 18 "rebuilt the
                // mop head" in Blender — many fine damp-grey strands — but
                // the mesh it rebuilt is THIS hidden skirt; the player sees
                // the procedural rig, which kept its old pale-cream yarn.
                // The damp grey lives HERE now (the authored skirt's own
                // A9A294 family, darkened wet), matte like waterlogged
                // cotton.
                // PLAYTEST 4, ITEM 3a — THE COLOUR WAS THE BIGGEST GAP.
                //
                // 0x8f8a80 is a mid-grey, chosen in Goal 19 to read as damp
                // waterlogged cotton. Put beside the owner's reference in
                // Designs/ProShop/Images/Goal_26/after/mop-vs-reference.png it is
                // the whole difference: his mop is a BRIGHT WHITE microfibre disc
                // and the game's is a charcoal ring, in the same frame as a
                // correctly-lit red hub, so this is pigment and not lighting.
                //
                // 0xe9e5db is off-white with the warmth left in, so it still sits
                // in the room's palette rather than glowing. Roughness stays at
                // 0.97: microfibre has no specular to speak of, and a white
                // material with a highlight would read as plastic.
                const yarn = new THREE.MeshStandardMaterial({
                  color: 0xe9e5db, roughness: 0.97, metalness: 0,
                });
                // B1 (Goal 17) — MEASURED, NOT GUESSED.
                //
                // The frozen-strand control (tools/qa/electron-b1-divergence.js)
                // showed that 69% of everything the eye sees during a stroke
                // happens with the fibres WELDED to the head: the strand-
                // specific signal was 42 348 pixels against an idle shimmer of
                // 22 991, only 1.84x the noise. The owner reports the yarn
                // welded to a swinging head, and that is exactly what those
                // numbers describe.
                //
                // So the job is not "make them move" - they moved 0.135 m. It
                // is to make their share of the picture dominate the head's.
                // Two levers, both applied:
                //
                // DENSITY: 26 strands read as a fringe, and a fringe hides its
                // own motion because there is nothing behind it to move
                // against. 84 fills the head. Instanced, so it is still 3 draw
                // calls (the old 26 cost 78).
                //
                // MOTION: a slower chase means the segments arrive later and
                // further apart, which is what trailing IS; more push and drag
                // means they swing wider than the head; a bigger carry deficit
                // is the direct answer to "welded when walked about".
                // B2 (Goal 20) — THE SIXTH ATTEMPT, AND THE FIRST WITH PHYSICS.
                //
                // Everything above this line is the history of tuning a lag
                // filter: density, thickness, push, chase, deficit, splay. The
                // measurements were honest and the tuning was real, and the
                // owner's verdict after all of it was still "rigid and
                // animated". A filter chasing a target angle cannot be anything
                // else — it has no momentum, no floor, and no idea where it is
                // in the room.
                //
                // The yarn is now simulated: Verlet integration with iterated
                // distance constraints and a real floor contact, in WORLD space.
                // See src/render3d/mopVerlet.js for why that solver and why it
                // was not vendored. The broom keeps the filtered rig above,
                // untouched, because the owner says its bristles are right.
                //
                // B3 asked for more strands, finer, with length variation:
                // 640 fibres at 3.0 mm tapering to 1.6 mm (was 480 at 3.8/2.6),
                // each cut to its own length within +/-18% so the hem is ragged
                // instead of machined. Four segments instead of three, so the
                // drape can curve rather than kink. Still one draw call per
                // segment index, because they are instanced: 4 calls total.
                let rig = createVerletMopStrands({
                  THREE,
                  material: yarn,
                  // B (Goal 22) — SIXTH ATTEMPT, AND THE COUNT WAS THE FAULT.
                  //
                  // Every previous pass chased DENSITY. 480 -> 640 -> 820, each
                  // time because the disc "no longer FILLED" and a planted head
                  // "splayed the gaps open". The reasoning was internally sound
                  // and aimed at the wrong target: it was trying to make an
                  // opaque disc, and an opaque disc is not what a string mop is.
                  //
                  // Go and look at one. It is fifteen to thirty THICK BANDS of
                  // yarn. Each band is a rope several millimetres across that
                  // hangs heavy and moves as one piece, and you can see daylight
                  // between them. The gaps are not a defect to be filled; they
                  // are most of what makes it read as a mop and not a brush. A
                  // thousand 3.4 mm fibres packed to 54% coverage of the disc is
                  // a pom-pom.
                  //
                  // So: 16 bands at 11 mm, not 820 fibres at 3.4 mm. The solver
                  // is untouched — it was never the problem, and fewer heavier
                  // bodies read BETTER under it, because each one is now large
                  // enough on screen to show its own momentum instead of
                  // averaging into a mass. radialSegments rises to 8 because a
                  // rope that wide shows its facets where a hair could not; at
                  // 16 strands that is free. Cost falls from 3,280 instances to
                  // 64, still 4 draw calls.
                  // ...and the numbers live in mopVerlet.js beside the solver,
                  // so the test that guards them measures the mop that SHIPS
                  // rather than the function defaults nobody holds.
                  ...SHIPPED_MOP_YARN,
                });
                // PLAYTEST 3 ITEM 5, THE VERTICAL HALF OF "they form a ring
                // floating around AND BELOW it". The hub is a cone spanning
                // y 0.007 .. 0.045, and the yarn hung from y = 0: the strand
                // tops began 7 mm UNDER the underside of the clamp, so even
                // where the radii overlapped there was a horizontal slot of
                // daylight between the two. Lifting the rig to 0.022 puts the
                // anchors in the middle of the hub's body, so the tops are
                // INSIDE it and the clamp visibly grips them.
                rig.root.position.y = 0.022;
                collar.add(rig.root);

                // 5.1 (Goal 26) — "IT DOES NOT CONNECT TO THE STEM. There is a
                // gap between the yarn and the shaft. On a real mop the yarn is
                // clamped into a BAND that meets the handle."
                //
                // Photographed at the default camera (mop-planted.png): the
                // shaft simply ends and the yarn begins somewhere below it, with
                // daylight in between. There was no band at all -- the strands
                // hang from an invisible anchor, so the eye has nothing joining
                // the two halves of the object.
                //
                // His reference is a SPIN MOP, whose hub is a hard plastic disc
                // that clamps the yarn and swallows the end of the handle. That
                // is what this is: a short tapered ferrule sitting where the
                // strands start, wide enough to cover the collar circle they
                // hang from, plus a rim ring so it reads as a clamp rather than
                // a blob. Two meshes, no texture, no new material family.
                const bandMat = new THREE.MeshStandardMaterial({
                  color: 0xb5322a, roughness: 0.42, metalness: 0.05,
                });
                const HEAD_R = SHIPPED_MOP_YARN.radius;
                // SIZED AGAINST THE REFERENCE, AND MY FIRST TRY WAS WRONG.
                // At 0.86 of the head radius the hub was as wide as the whole
                // head: it read as a red disc with a fringe under it, and it
                // HID the yarn I had just doubled. In his reference the hub is a
                // small clamp at the centre of a large white disc -- the yarn is
                // the object and the hub is the fitting. 0.52 leaves the outer
                // two thirds of the head as yarn.
                const hub = new THREE.Mesh(
                  new THREE.CylinderGeometry(HEAD_R * 0.30, HEAD_R * 0.52, 0.038, 20, 1, false),
                  bandMat,
                );
                hub.name = 'MESH_MopHub';
                // Sits just ABOVE where the yarn starts, so the strand tops
                // disappear into it instead of floating below it.
                hub.position.y = 0.026;
                collar.add(hub);
                const hubRim = new THREE.Mesh(
                  new THREE.TorusGeometry(HEAD_R * 0.51, 0.008, 8, 22),
                  bandMat,
                );
                hubRim.name = 'MESH_MopHubRim';
                hubRim.rotation.x = Math.PI / 2;
                hubRim.position.y = 0.008;
                collar.add(hubRim);
                entry.mopHub = hub;

                // PLAYTEST 4, ITEM 3a — "a DENSE UNIFORM DISC... the hub clamping
                // it CLEANLY."
                //
                // The bunches hang from a collar at 0.50 of the head radius and
                // splay outward, so everything inside that ring is empty air. From
                // straight above the hub hides it; from the angle the player
                // actually holds the tool you see daylight through the middle of
                // the head, which is why it still reads as a ring.
                //
                // On the reference the microfibre is CONTINUOUS under the clamp —
                // the red fitting is pressed onto a backing that is already fabric.
                // So a thin disc of the same yarn material sits just under the hub
                // and closes the hole. It is backing, not strands: it adds nothing
                // to the strand count and nothing to the physics, so the 18-bunch
                // spacing and the density ruling the owner has reserved are both
                // untouched by it.
                const pad = new THREE.Mesh(
                  new THREE.CylinderGeometry(HEAD_R * 0.60, HEAD_R * 0.54, 0.020, 18, 1, false),
                  yarn,
                );
                pad.name = 'MESH_MopPad';
                pad.position.y = 0.004;
                collar.add(pad);
                entry.mopPad = pad;

                entry.strandRig = rig;
                entry.strandMaterial = yarn;
                group.userData.strandRig = rig;
                // D (Goal 23) — REBUILD THE YARN WITH DIFFERENT NUMBERS.
                //
                // The band count and thickness are baked at load, so choosing
                // between 22 thick bands and 30 thicker ones meant a rebuild
                // and a fresh boot per candidate. That is how five rounds of
                // the broom head were spent arguing from numbers instead of
                // photographs. One run, one contact sheet, and the owner picks.
                entry.rebuildYarn = (overrides = {}) => {
                  const next = createVerletMopStrands({
                    THREE, material: yarn, ...SHIPPED_MOP_YARN, ...overrides,
                  });
                  rig.root.removeFromParent();
                  rig.dispose?.();
                  collar.add(next.root);
                  entry.strandRig = next;
                  group.userData.strandRig = next;
                  rig = next;
                  return { count: next.strandCount, drawCalls: next.drawCalls };
                };
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
                // B2 (Goal 17) — IT READ AS A RAKE BECAUSE IT WAS ONE.
                //
                // 22 tufts across a 0.46 m block is one every 46 mm, and a tuft
                // is 26 mm thick: twenty millimetres of daylight between
                // neighbours, in two rows 50 mm apart. Separated tines with
                // gaps you can see through is the definition of a rake.
                //
                // A real push broom's bristles touch. 96 tufts in 4 rows puts
                // them at 19 mm across a 0.46 m block against a 22 mm tuft, so
                // neighbours now overlap slightly and the block reads solid
                // from every angle a first-person camera can reach.
                //
                // This is only affordable because the fibres are INSTANCED now
                // (see mopStrands.js): 96 tufts x 2 segments is 2 draw calls,
                // where the old 22 tufts cost 44. A1 measured this renderer as
                // draw-call bound, so the dense head is CHEAPER than the sparse
                // one it replaces.
                const rig = createMopStrands({
                  THREE,
                  material: bristle,
                  layout: 'bar',
                  // MEASURED, not guessed (tools/qa/electron-b2-blockbounds.js):
                  // MESH_BroomBlock is 0.52 x 0.078 in this local space. The
                  // field was 0.46 x 0.075, inset THIRTY MILLIMETRES either
                  // side, which is the daylight visible past the last tuft in
                  // the player-camera crop. Nothing had ever checked the layout
                  // constants against the block they are meant to fill.
                  //
                  // 36 columns across 0.50 m is 14.3 mm spacing against an 18 mm
                  // tuft, so neighbours overlap by a fifth and the field reads
                  // as a brush; 5 rows over 0.062 m does the same front to back.
                  // 180 tufts is affordable because they are instanced: still
                  // 2 draw calls, where the original 22-tuft comb cost 44.
                  // ...AND THEN THE PICTURE STILL DISAGREED WITH THE ARITHMETIC.
                  // At 36 columns the spacing is 14.3 mm and the tuft is 18 mm
                  // at its TOP, which should overlap - but the tuft TAPERS to
                  // 11 mm at the tip, and the tip is the part the eye reads.
                  // 11 mm of bristle every 14.3 mm is a gap, so it went on
                  // looking like a comb while the numbers said brush. A real
                  // push broom's bristles barely taper at all.
                  // B2 RE-LANDED, AND THE REASON IT WAS PULLED WAS NOT TRUE.
                  //
                  // This line used to read `count: 200` with the comment "B2
                  // REVERTED: 720 cost +5.5 s on tool equip (measured)". That
                  // measurement was one sample against one sample — 8282 ms vs
                  // 2770 ms — taken on the tool-equip frame, which is the single
                  // noisiest number in the build because it is dominated by a
                  // nine-program shader compile. The conviction was retracted in
                  // the report; the revert was left standing anyway, so the
                  // codebase kept the sparse head AND a comment asserting a fact
                  // that had been withdrawn.
                  //
                  // Re-measured properly with tools/qa/electron-b2-broom-cost.js:
                  // five runs, a distribution per phase, and an idle-no-tool
                  // drift control that paired exactly across the two sets
                  // (5.4 / 5.8 ms in both, in the same order).
                  //
                  //                 200 bristles      720 bristles
                  //   draw calls     +32               +32          <- identical
                  //   sweeping med   7.9 / 7.8 ms      7.6 / 7.6 / 7.3 ms
                  //   equip worst    345 / 795 ms      339 / 336 ms
                  //
                  // The equip frame swings 2.3x at FIXED configuration, which is
                  // the retracted conviction reproducing itself on demand. Draw
                  // calls do not move at all: the instancing claim is true.
                  count: 720,
                  segments: 2,
                  length: 0.115,        // GLB-local metres: block underside to floor
                  barWidth: 0.50,       // block is 0.52; 10 mm inset each side
                  barDepth: 0.062,      // block is 0.078; 8 mm inset front and back
                  barRows: 5,
                  // B2 (Goal 17) — "THE BRISTLES READ AS SEPARATED TINES
                  // RATHER THAN A BRUSH."
                  //
                  // 200 bristles at a 10 mm radius is a 20 mm shaft. Against a
                  // ~100 mm bristle that is 5:1 - the SAME ratio the mop was
                  // diagnosed with at 240 strands x 18 mm, where the recorded
                  // verdict was that chunky cylinders "look like kindling
                  // however many you draw". Tines and kindling are the same
                  // complaint about the same geometry.
                  //
                  // The mop's answer applies unchanged: thinner is the fix, and
                  // thinner needs more of them to keep the block covered. 720
                  // at 3.4 mm is ~15:1 - stiffer and stubbier than the mop's
                  // yarn, which is what a push broom should be - and it fills
                  // the bar instead of fencing it. Instanced, so the draw call
                  // count does not move.
                  strandRadiusTop: 0.0034,
                  strandRadiusBottom: 0.0028,
                  // ...AND THE COST THE FIRST ATTEMPT NEVER LOOKED FOR.
                  //
                  // What density DID cost is triangles: 8,976 -> 19,376, which is
                  // +20 for each of the 520 extra fibres. That number is not a
                  // property of density at all — it is 5 sides x 2 triangles x 2
                  // segments, and the 5 was a literal in the geometry call that
                  // nobody had ever questioned.
                  //
                  // A 3.4 mm bristle is a handful of pixels wide, dark, and
                  // overlapping its neighbours. Three sides buys the same
                  // silhouette as five and gives 40% of the strand triangles
                  // back, so the head gets 3.6x the fibres for a fraction of the
                  // geometry the naive re-land would have spent.
                  radialSegments: 3,
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
      const damp = (material) => {
        if (!material?.color) return;
        if (!Number.isFinite(material.userData.cleaningBaseColor)) {
          material.userData.cleaningBaseColor = material.color.getHex();
        }
        material.color.setHex(material.userData.cleaningBaseColor);
        if (wet > 0.01) material.color.multiplyScalar(1 - 0.34 * wet);
      };
      entry.root.traverse((object) => {
        if (!object.isMesh || !/skirt/i.test(object.name || '')) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) damp(material);
      });
      // ...AND THE YARN THE PLAYER CAN ACTUALLY SEE. MESH_MopSkirt is hidden
      // (Goal 19, E1) and the procedural fibres are the mop's visible head, so
      // for as long as the skirt has been invisible the wetness tint has been
      // painting a mesh nobody renders. Exactly the fault E1 was: the right
      // material, on the wrong mesh.
      damp(entry.strandMaterial);
      entry.root.userData.mopWet = wet;
      return true;
    },
    update(dtSec, floorWorldY = null) {
      const dt = Math.max(0, Math.min(0.1, Number(dtSec) || 0));
      for (const entry of loaded.values()) {
        entry.mixer?.update(dt);
        // D1 (Goal 23) — THE SOLVER WAS NEVER CALLED. ZERO CALL SITES.
        //
        // Six passes have gone into how the mop's yarn behaves — momentum,
        // trailing, whip, floor spread, frame-rate independence — and every one
        // was tuned against unit tests that step the rig by hand. In the game
        // it has never moved: createVerletMopStrands builds the rig here and
        // stores it on the entry, and the only `strandRig.update(...)` in the
        // repository is in broomViewmodel.js, which owns its own bespoke rig
        // and knows nothing about this one. Goal 22 measured the drift while
        // walking as exactly ZERO and read it as a frozen solver. The solver
        // was fine. Nobody was turning the handle.
        //
        // The head's world matrix is already current when this runs (the rig
        // hangs off the viewmodel group, which the camera rig has posed for
        // this frame), and the nodes live in world space, so one call is all it
        // needs.
        if (entry.strandRig && typeof entry.strandRig.update === 'function') {
          entry.strandRig.root?.parent?.updateMatrixWorld(true);
          entry.strandRig.update(dt, floorWorldY);
        }
      }
    },
    // PLAYTEST 4, ITEM 3b: the yarn solver's own view of itself. A clip of the
    // mop is worthless without this, because "the strands did not move" and "the
    // mop was never equipped, so nothing moved" produce identical footage -- and
    // the first attempt at that clip made exactly that mistake.
    strandRigDiagnostics: (id) => {
      const entry = loaded.get(id);
      const rig = entry?.strandRig;
      if (!rig) return null;
      return {
        equipped: equippedTool === id,
        using: !!entry.using,
        active: typeof rig.isActive === 'function' ? rig.isActive() : null,
        feel: typeof rig.feel === 'function' ? rig.feel() : null,
        strands: rig.strandCount ?? null,
      };
    },
    // D (Goal 23): rebuild a tool's yarn with different parameters, for the
    // sweep that chooses the look. Returns null for a tool that has none.
    rebuildYarn: (id, overrides) => {
      const entry = loaded.get(id);
      return entry && entry.rebuildYarn ? entry.rebuildYarn(overrides) : null;
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
        equipped: entry.equipped,
        equipAction: entry.equipAction ? (() => {
          const clip = entry.equipAction.getClip?.();
          const duration = Number(clip?.duration) || 0;
          const time = Number(entry.equipAction.time) || 0;
          return {
            clip: clip?.name || null,
            time,
            duration,
            running: entry.equipAction.isRunning?.() === true,
            settled: duration <= 0 || time >= duration - 0.001
              || entry.equipAction.isRunning?.() === false,
          };
        })() : { clip: null, time: 0, duration: 0, running: false, settled: true },
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
