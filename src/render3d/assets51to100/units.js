export const METERS_TO_YARDS = 1.0936133;

export const SHEET06_REGISTRATION_ID = 'PINEHOLLOW_CLUBHOUSE_S06_V1';

export function metersToYards(value) {
  return Number(value) * METERS_TO_YARDS;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function defineSheet06Binding(binding) {
  return deepFreeze({ ...binding });
}
