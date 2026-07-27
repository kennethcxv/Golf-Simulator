// TOOL SOCKETS — the effect comes out of the tool.
//
// The washer used to emit its jet from `camera.localToWorld(0.24, -0.24, -1.25)`: a constant that
// somebody hand-tuned until the water looked roughly right, standing still, already equipped. It
// was wrong in three ways at once. It approximated the tip rather than being it; it ignored
// `heldRoot`, which the gait bob and the 0.26 s equip ease move every frame (up to 42 cm); and the
// aim ray started at the camera, so the water and the cleaning disagreed about where they were.
//
// A socket is an empty parented to the tool at the authored point. Because it is IN the tool, it
// inherits every transform the viewmodel applies for free — bob, sway, recoil, equip — and the
// answer is right by construction instead of right by tuning.
//
// Sockets are named, not indexed, and a missing one throws. A tool that emits from its origin
// because somebody typo'd 'nozle' is exactly the class of bug this module exists to end.

import * as THREE from 'three';

const SOCKET_PREFIX = 'SOCKET_';

// Scratch, reused. These run inside the frame loop; allocating a Vector3 per jet per frame is the
// kind of thing that shows up as GC sawtooth in a profile.
const _m = new THREE.Matrix4();
const _raycaster = new THREE.Raycaster();
const _fwd = new THREE.Vector3();

/**
 * Author a named attachment point on a tool.
 * @param {THREE.Object3D} tool  the tool group the socket belongs to
 * @param {string} name          bare name, e.g. 'nozzle' — stored as 'SOCKET_nozzle'
 * @param {number[]} position    [x,y,z] in the tool's local frame
 * @param {number[]} [rotation]  [x,y,z] euler; a socket's -Z is the direction it emits
 * @returns {THREE.Object3D} the socket
 */
export function attachSocket(tool, name, position, rotation = [0, 0, 0]) {
  const socket = new THREE.Object3D();
  socket.name = SOCKET_PREFIX + name;
  socket.position.set(position[0], position[1], position[2]);
  socket.rotation.set(rotation[0], rotation[1], rotation[2]);
  // Nothing is drawn at a socket, so it must never cost a matrix update it does not need.
  socket.matrixAutoUpdate = true;
  tool.add(socket);
  return socket;
}

/** Find a socket, or null. Direct children first — sockets belong to the tool they mark. */
export function findSocket(tool, name) {
  if (!tool) return null;
  const want = SOCKET_PREFIX + name;
  for (const child of tool.children) if (child.name === want) return child;
  return tool.getObjectByName(want) || null;
}

/**
 * World position of a socket. Throws if the socket is missing — silently emitting from the tool
 * origin is the failure this replaces.
 */
export function socketWorld(tool, name, target) {
  const socket = findSocket(tool, name);
  if (!socket) {
    throw new Error(
      `toolSockets: no socket '${name}' on ${tool?.name || 'tool'} — ` +
      `expected a child named '${SOCKET_PREFIX}${name}'`,
    );
  }
  socket.updateWorldMatrix(true, false);
  return target.setFromMatrixPosition(socket.matrixWorld);
}

/** Unit world direction a socket faces (its local -Z), for aiming the effect it emits. */
export function socketWorldDirection(tool, name, target) {
  const socket = findSocket(tool, name);
  if (!socket) {
    throw new Error(
      `toolSockets: no socket '${name}' on ${tool?.name || 'tool'} — ` +
      `expected a child named '${SOCKET_PREFIX}${name}'`,
    );
  }
  socket.updateWorldMatrix(true, false);
  _m.extractRotation(socket.matrixWorld);
  return target.set(0, 0, -1).applyMatrix4(_m).normalize();
}

/**
 * Raycast at cleanable surfaces, but only reach the ones you can actually see.
 *
 * The shipped `aim` intersected the grime planes alone. With no occluders in the set the building
 * did not exist as far as the ray was concerned, so the south siding was washable from inside the
 * clubhouse, through the wall, at up to 7 yards.
 *
 * @param {THREE.Vector3} origin      world origin — the nozzle, not the camera
 * @param {THREE.Vector3} dir         unit world direction
 * @param {THREE.Object3D[]} targets  cleanable surfaces
 * @param {THREE.Object3D[]} occluders geometry that blocks the effect
 * @param {number} far                tool reach
 * @param {boolean} [recursive=false]
 * @returns {THREE.Intersection|null}
 */
export function firstUnoccludedHit(origin, dir, targets, occluders, far, recursive = false) {
  if (!targets || !targets.length) return null;
  _raycaster.far = far;
  _raycaster.set(origin, dir);

  const hits = _raycaster.intersectObjects(targets, recursive);
  if (!hits.length) return null;
  const hit = hits[0];

  if (occluders && occluders.length) {
    const blockers = _raycaster.intersectObjects(occluders, recursive);
    // 1 mm of slack: a grime plane sits ~2 cm proud of the wall it covers, and a surface must not
    // be occluded by the very geometry it is painted onto.
    for (const b of blockers) {
      if (b.distance < hit.distance - 1e-3) return null;
    }
  }
  return hit;
}

/**
 * Where the effect actually lands: the socket point, aimed along the socket, stopped by the world.
 * Returns null when the tool is pointed at nothing it can act on.
 */
export function aimFromSocket(tool, name, targets, occluders, far, out = {}) {
  const origin = socketWorld(tool, name, out.origin || new THREE.Vector3());
  const dir = socketWorldDirection(tool, name, _fwd);
  const hit = firstUnoccludedHit(origin, dir, targets, occluders, far);
  return hit ? { origin, dir, hit } : { origin, dir, hit: null };
}
