// Property-scoped vehicle persistence and operating contracts.
//
// Rendering owns meshes and interpolation; this module is the sole authority for
// which vehicles exist, their last legal parked pose, condition, energy, lights,
// and carried equipment.  Stable IDs let every property save migrate without
// duplicating a tractor or starter cart.

export const VEHICLE_SAVE_SCHEMA = 1;

export const VEHICLE_SPECS = Object.freeze({
  tractor: Object.freeze({
    id: 'tractor',
    label: 'Pinehollow grounds tractor',
    model: 'vendor/models/vehicles/grounds_tractor.glb',
    brokenModel: 'vendor/models/vehicles/grounds_tractor_broken.glb',
    speedYdPerSec: 9.2,
    reverseYdPerSec: 3.4,
    turnRateRadPerSec: 1.25,
    seatEyeYd: 1.82,
    collisionRadiusYd: 1.18,
    wheelRadiusM: Object.freeze({ front: 0.46, rear: 0.60 }),
    steeringLimitRad: Math.PI * 0.19,
    storageSlots: 2,
    fuelCapacity: 100,
    energyKind: 'fuel',
    lodDistanceYd: 62,
  }),
  golf_cart: Object.freeze({
    id: 'golf_cart',
    label: 'Pinehollow utility golf cart',
    model: 'vendor/models/vehicles/fleet_golf_cart.glb',
    speedYdPerSec: 10.5,
    reverseYdPerSec: 4.2,
    turnRateRadPerSec: 1.7,
    seatEyeYd: 1.42,
    collisionRadiusYd: 1.0,
    wheelRadiusM: Object.freeze({ front: 0.255, rear: 0.255 }),
    steeringLimitRad: Math.PI * 0.18,
    storageSlots: 4,
    fuelCapacity: 100,
    energyKind: 'charge',
    lodDistanceYd: 58,
  }),
});

const DEFAULT_VEHICLES = Object.freeze([
  Object.freeze({ id: 'tractor-1', type: 'tractor', home: 'maintenance-yard' }),
  Object.freeze({ id: 'golf-cart-1', type: 'golf_cart', home: 'clubhouse-cart-bay' }),
]);

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function clamp(value, lo, hi) {
  const number = Number(value);
  return Math.max(lo, Math.min(hi, Number.isFinite(number) ? number : hi));
}

function normalizeCargo(cargo, slots) {
  if (!Array.isArray(cargo)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of cargo) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || '').trim();
    if (!id || seen.has(id)) continue;
    const quantity = Math.max(1, Math.floor(Number(raw.quantity) || 1));
    seen.add(id);
    out.push({ id, kind: String(raw.kind || 'equipment'), quantity });
    if (out.length >= slots) break;
  }
  return out;
}

function normalizeRecord(raw, fallback) {
  const type = VEHICLE_SPECS[raw?.type] ? raw.type : fallback.type;
  const spec = VEHICLE_SPECS[type];
  return {
    ...raw,
    id: fallback.id,
    type,
    home: typeof raw?.home === 'string' && raw.home ? raw.home : fallback.home,
    x: finiteOrNull(raw?.x),
    z: finiteOrNull(raw?.z),
    yaw: finiteOrNull(raw?.yaw),
    parked: raw?.parked !== false,
    engineOn: raw?.engineOn === true,
    lightsOn: raw?.lightsOn === true,
    condition: clamp(raw?.condition, 0, 100),
    cleanliness: clamp(raw?.cleanliness, 0, 100),
    energy: clamp(raw?.energy, 0, spec.fuelCapacity),
    odometerYd: Math.max(0, Number(raw?.odometerYd) || 0),
    cargo: normalizeCargo(raw?.cargo, spec.storageSlots),
  };
}

export function initVehicles(state) {
  state.vehicles = {
    schema: VEHICLE_SAVE_SCHEMA,
    activeId: null,
    records: DEFAULT_VEHICLES.map((entry) => normalizeRecord(null, entry)),
  };
  return state.vehicles;
}

function currentShapeIsUsable(value) {
  if (!value || value.schema !== VEHICLE_SAVE_SCHEMA || !Array.isArray(value.records)) return false;
  const ids = value.records.map((record) => String(record?.id || ''));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return false;
  return DEFAULT_VEHICLES.every((fallback) => ids.includes(fallback.id));
}

export function ensureVehicles(state, { recoverActive = false } = {}) {
  if (!recoverActive && currentShapeIsUsable(state.vehicles)) return state.vehicles;
  const source = state.vehicles && typeof state.vehicles === 'object' ? state.vehicles : null;
  const shouldRecoverActive = recoverActive || source?.schema !== VEHICLE_SAVE_SCHEMA;
  const records = Array.isArray(source?.records) ? source.records : [];
  const byId = new Map();
  for (const record of records) {
    const id = String(record?.id || '');
    if (!id || byId.has(id)) continue;
    byId.set(id, record);
  }

  const normalized = DEFAULT_VEHICLES.map((fallback) => normalizeRecord(byId.get(fallback.id), fallback));
  const knownIds = new Set(normalized.map((record) => record.id));
  // Preserve forward-compatible records once each, but never allow an unknown
  // type to become drivable until its specification ships.
  for (const record of records) {
    const id = String(record?.id || '').trim();
    if (!id || knownIds.has(id) || !VEHICLE_SPECS[record?.type]) continue;
    knownIds.add(id);
    normalized.push(normalizeRecord(record, {
      id,
      type: record.type,
      home: String(record.home || 'fleet-overflow'),
    }));
  }

  const activeId = shouldRecoverActive ? null : String(source?.activeId || '') || null;
  for (const record of normalized) {
    const wasActive = source?.activeId === record.id;
    if (shouldRecoverActive && wasActive) record.parked = true;
    if (shouldRecoverActive || activeId !== record.id) record.engineOn = false;
  }

  state.vehicles = {
    schema: VEHICLE_SAVE_SCHEMA,
    activeId: normalized.some((record) => record.id === activeId) ? activeId : null,
    records: normalized,
  };
  return state.vehicles;
}

export function vehiclesOf(state) {
  ensureVehicles(state);
  return state.vehicles.records;
}

export function vehicleById(state, id) {
  ensureVehicles(state);
  return state.vehicles.records.find((record) => record.id === id) || null;
}

export function setVehiclePose(state, id, pose, distanceYd = 0) {
  const vehicle = vehicleById(state, id);
  if (!vehicle) return { ok: false, reason: 'unknown-vehicle' };
  if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || !Number.isFinite(pose.yaw)) {
    return { ok: false, reason: 'invalid-pose' };
  }
  vehicle.x = pose.x;
  vehicle.z = pose.z;
  vehicle.yaw = pose.yaw;
  const distance = Math.max(0, Number(distanceYd) || 0);
  vehicle.odometerYd += distance;
  vehicle.condition = Math.max(0, vehicle.condition - distance / 5000);
  vehicle.cleanliness = Math.max(0, vehicle.cleanliness - distance / 900);
  const energyDivisor = vehicle.type === 'golf_cart' ? 320 : 600;
  vehicle.energy = Math.max(0, vehicle.energy - distance / energyDivisor);
  return { ok: true, vehicle };
}

export function mountVehicle(state, id) {
  ensureVehicles(state);
  const vehicle = vehicleById(state, id);
  if (!vehicle) return { ok: false, reason: 'unknown-vehicle' };
  if (vehicle.type === 'tractor' && state.tractor && !state.tractor.repaired) {
    return { ok: false, reason: 'tractor-broken' };
  }
  vehicle.parked = false;
  vehicle.engineOn = true;
  state.vehicles.activeId = vehicle.id;
  return { ok: true, vehicle };
}

export function parkVehicle(state, id, pose) {
  const vehicle = vehicleById(state, id);
  if (!vehicle) return { ok: false, reason: 'unknown-vehicle' };
  if (pose) {
    const positioned = setVehiclePose(state, id, pose);
    if (!positioned.ok) return positioned;
  }
  vehicle.parked = true;
  vehicle.engineOn = false;
  if (state.vehicles.activeId === id) state.vehicles.activeId = null;
  return { ok: true, vehicle };
}

export function toggleVehicleLights(state, id) {
  const vehicle = vehicleById(state, id);
  if (!vehicle) return { ok: false, reason: 'unknown-vehicle' };
  vehicle.lightsOn = !vehicle.lightsOn;
  return { ok: true, lightsOn: vehicle.lightsOn, vehicle };
}

export function storeVehicleCargo(state, id, item) {
  const vehicle = vehicleById(state, id);
  if (!vehicle) return { ok: false, reason: 'unknown-vehicle' };
  const spec = VEHICLE_SPECS[vehicle.type];
  const cargoId = String(item?.id || '').trim();
  if (!cargoId) return { ok: false, reason: 'invalid-cargo' };
  const existing = vehicle.cargo.find((entry) => entry.id === cargoId);
  if (existing) {
    existing.quantity += Math.max(1, Math.floor(Number(item.quantity) || 1));
    return { ok: true, stacked: true, vehicle };
  }
  if (vehicle.cargo.length >= spec.storageSlots) return { ok: false, reason: 'storage-full' };
  vehicle.cargo.push({
    id: cargoId,
    kind: String(item.kind || 'equipment'),
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
  });
  return { ok: true, stacked: false, vehicle };
}

export function takeVehicleCargo(state, id, cargoId, quantity = 1) {
  const vehicle = vehicleById(state, id);
  if (!vehicle) return { ok: false, reason: 'unknown-vehicle' };
  const index = vehicle.cargo.findIndex((entry) => entry.id === cargoId);
  if (index < 0) return { ok: false, reason: 'cargo-missing' };
  const entry = vehicle.cargo[index];
  const taken = Math.min(entry.quantity, Math.max(1, Math.floor(Number(quantity) || 1)));
  entry.quantity -= taken;
  if (entry.quantity <= 0) vehicle.cargo.splice(index, 1);
  return { ok: true, taken, kind: entry.kind, vehicle };
}
