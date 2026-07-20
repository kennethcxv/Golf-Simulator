// AUTHORED CUSTOMER SOCKETS — stable local-space places for arrivals, doors,
// displays, the service line, and ambient clubhouse life. Customers target these
// points, never arbitrary mesh centres. Display sockets follow player-moved
// fixtures because they are derived from the authored side preference plus the
// fixture's live footprint.

import { COUNTER, DOOR_MAIN, INTERIOR, LOUNGE, fixtureRect, queueSlot } from './shopLayout.js';

const ENTRY_Z = INTERIOR.d / 2;

export const CUSTOMER_EXTERIOR_SOCKETS = Object.freeze({
  spawns: [
    { id: 'exterior-spawn-west', x: -6.2, z: ENTRY_Z + 11.5 },
    { id: 'exterior-spawn-center', x: -0.8, z: ENTRY_Z + 12.7 },
    { id: 'exterior-spawn-east', x: 4.8, z: ENTRY_Z + 11.9 },
    { id: 'exterior-spawn-path', x: -9.0, z: ENTRY_Z + 9.6 },
    { id: 'exterior-spawn-west-far', x: -8.1, z: ENTRY_Z + 13.2 },
    { id: 'exterior-spawn-west-near', x: -4.3, z: ENTRY_Z + 13.7 },
    { id: 'exterior-spawn-center-left', x: -2.4, z: ENTRY_Z + 11.1 },
    { id: 'exterior-spawn-center-right', x: 1.0, z: ENTRY_Z + 14.0 },
    { id: 'exterior-spawn-east-near', x: 2.8, z: ENTRY_Z + 11.0 },
    { id: 'exterior-spawn-east-far', x: 5.8, z: ENTRY_Z + 13.5 },
    { id: 'exterior-spawn-path-west', x: -10.0, z: ENTRY_Z + 12.1 },
    { id: 'exterior-spawn-path-east', x: 7.2, z: ENTRY_Z + 10.6 },
  ],
  arrivals: [
    { id: 'exterior-arrival-west', x: -4.4, z: ENTRY_Z + 7.2 },
    { id: 'exterior-arrival-center', x: -0.8, z: ENTRY_Z + 7.8 },
    { id: 'exterior-arrival-east', x: 3.2, z: ENTRY_Z + 7.1 },
    { id: 'exterior-arrival-far-west', x: -7.0, z: ENTRY_Z + 6.5 },
    { id: 'exterior-arrival-mid-east', x: 1.4, z: ENTRY_Z + 6.2 },
    { id: 'exterior-arrival-far-east', x: 5.4, z: ENTRY_Z + 6.8 },
  ],
  approach: [
    { id: 'door-approach-west', x: DOOR_MAIN.x - 1.15, z: ENTRY_Z + 2.7 },
    { id: 'door-approach-center', x: DOOR_MAIN.x, z: ENTRY_Z + 2.9 },
    { id: 'door-approach-east', x: DOOR_MAIN.x + 1.15, z: ENTRY_Z + 2.7 },
    { id: 'door-approach-far-west', x: DOOR_MAIN.x - 2.25, z: ENTRY_Z + 3.25 },
    { id: 'door-approach-back', x: DOOR_MAIN.x, z: ENTRY_Z + 4.05 },
    { id: 'door-approach-far-east', x: DOOR_MAIN.x + 2.25, z: ENTRY_Z + 3.25 },
  ],
  entry: { id: 'door-entry', x: DOOR_MAIN.x, z: ENTRY_Z - 1.25 },
  exitWait: { id: 'door-exit-wait', x: DOOR_MAIN.x + 0.75, z: ENTRY_Z - 1.8 },
  exit: { id: 'door-exit', x: DOOR_MAIN.x, z: ENTRY_Z + 2.5 },
  gone: { id: 'exterior-gone', x: DOOR_MAIN.x - 3.6, z: ENTRY_Z + 10.5 },
});

export const CUSTOMER_SAFE_ANCHORS = Object.freeze({
  entry: { id: 'safe-entry', x: DOOR_MAIN.x - 1.7, z: ENTRY_Z - 2.2 },
  salesFloor: { id: 'safe-sales-floor', x: -1.0, z: 0.2 },
  queue: { id: 'safe-queue', x: COUNTER.queueBase.x - 2.5, z: COUNTER.queueBase.z - 1.8 },
  exit: { id: 'safe-exit', x: DOOR_MAIN.x + 1.5, z: ENTRY_Z - 2.4 },
});

export const CUSTOMER_AMBIENT_SOCKETS = Object.freeze([
  {
    id: 'lounge-chair-a', kind: 'sit', x: LOUNGE.chairA.x, z: LOUNGE.chairA.z,
    faceX: LOUNGE.coffee.x, faceZ: LOUNGE.coffee.z,
  },
  {
    id: 'lounge-chair-b', kind: 'sit', x: LOUNGE.chairB.x, z: LOUNGE.chairB.z,
    faceX: LOUNGE.coffee.x, faceZ: LOUNGE.coffee.z,
  },
  {
    id: 'lounge-events', kind: 'noticeboard', x: 4.45, z: -3.72,
    faceX: LOUNGE.events.x, faceZ: LOUNGE.events.z,
  },
  {
    id: 'lounge-window', kind: 'window', x: 3.0, z: -5.85,
    faceX: 3.0, faceZ: -6.5,
  },
  {
    id: 'lounge-scorecards', kind: 'scorecards', x: 4.95, z: -5.55,
    faceX: LOUNGE.trophy.x, faceZ: LOUNGE.trophy.z,
  },
  {
    id: 'lounge-talk-a', kind: 'talk', x: 2.75, z: -4.25,
    faceX: 3.75, faceZ: -4.2,
  },
  {
    id: 'lounge-talk-b', kind: 'talk', x: 3.75, z: -4.2,
    faceX: 2.75, faceZ: -4.25,
  },
  {
    // The accessories run already renders umbrellas standing in a barrel.
    id: 'accessory-umbrella-barrel', kind: 'umbrella', x: -2.25, z: -5.35,
    faceX: -2.25, faceZ: -6.15,
  },
]);

export function serviceQueueSockets(capacity = 6) {
  return Array.from({ length: capacity }, (_, index) => {
    const point = queueSlot(index);
    return {
      id: `service-queue-${index}`,
      index,
      x: point.x,
      z: point.z,
      faceX: COUNTER.registerX,
      faceZ: COUNTER.z,
    };
  });
}

// The preferred customer-facing side for each authored display. This remains
// stable as fixtures move; the live rectangle supplies the translated/rotated
// footprint while the preference keeps shoppers on the intended sales side.
const DISPLAY_SIDES = Object.freeze({
  rack_drivers: ['east'],
  rack_irons: ['east'],
  rack_putters: ['east'],
  shelf_balls: ['south'],
  shelf_acc: ['south'],
  shelf_small: ['south'],
  table_polos: ['north', 'south'],
  rail_outer: ['east', 'west'],
  hatstand: ['east', 'west'],
  bagstand: ['south', 'west'],
  shoerack: ['west'],
  feature: ['south', 'east'],
});

const sidePoints = (rect, side, distance = 0.58) => {
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  if (side === 'north') {
    return [
      { x: cx - Math.min(0.45, w * 0.22), z: rect.minZ - distance },
      { x: cx + Math.min(0.45, w * 0.22), z: rect.minZ - distance },
    ];
  }
  if (side === 'south') {
    return [
      { x: cx - Math.min(0.45, w * 0.22), z: rect.maxZ + distance },
      { x: cx + Math.min(0.45, w * 0.22), z: rect.maxZ + distance },
    ];
  }
  if (side === 'east') {
    return [
      { x: rect.maxX + distance, z: cz - Math.min(0.45, d * 0.22) },
      { x: rect.maxX + distance, z: cz + Math.min(0.45, d * 0.22) },
    ];
  }
  return [
    { x: rect.minX - distance, z: cz - Math.min(0.45, d * 0.22) },
    { x: rect.minX - distance, z: cz + Math.min(0.45, d * 0.22) },
  ];
};

export function browseSocketsForFixture(fixture) {
  if (!fixture?.skus?.length) return [];
  const rect = fixtureRect(fixture);
  const faceX = (rect.minX + rect.maxX) / 2;
  const faceZ = (rect.minZ + rect.maxZ) / 2;
  const sides = DISPLAY_SIDES[fixture.id] || ['south', 'north', 'east', 'west'];
  const sockets = [];
  for (const side of sides) {
    sidePoints(rect, side).forEach((point, index) => sockets.push({
      id: `browse-${fixture.id}-${side}-${index}`,
      fixtureId: fixture.id,
      side,
      x: point.x,
      z: point.z,
      faceX,
      faceZ,
    }));
  }
  return sockets;
}
