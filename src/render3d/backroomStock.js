// Turn backroom unit counts into a restrained case display shared across the
// available racks. One case represents six units; it must never be duplicated
// on every rack or protrude beyond a short doorway-adjacent shelf.

export const BACKROOM_CASE_UNITS = 6;
export const BACKROOM_CASE_ROWS = 4;

export function backroomCaseColumns(fixture) {
  return fixture?.short ? 2 : 4;
}

export function backroomCaseCapacity(fixture) {
  return backroomCaseColumns(fixture) * BACKROOM_CASE_ROWS;
}

export function allocateBackroomCases(fixtures, totalUnits) {
  const racks = fixtures.filter((fixture) => fixture.kind === 'backshelf');
  const counts = new Map(racks.map((fixture) => [fixture.id, 0]));
  if (!racks.length) return counts;

  const totalCapacity = racks.reduce((sum, fixture) => sum + backroomCaseCapacity(fixture), 0);
  let remaining = Math.min(
    Math.ceil(Math.max(0, Number(totalUnits) || 0) / BACKROOM_CASE_UNITS),
    totalCapacity,
  );
  let cursor = 0;
  while (remaining > 0) {
    const fixture = racks[cursor % racks.length];
    const count = counts.get(fixture.id);
    if (count < backroomCaseCapacity(fixture)) {
      counts.set(fixture.id, count + 1);
      remaining--;
    }
    cursor++;
  }
  return counts;
}

export function backroomCaseSlots(fixture, count) {
  const columns = backroomCaseColumns(fixture);
  const boardTops = [0.185, 0.645, 1.125, 1.605];
  return Array.from({ length: Math.min(count, backroomCaseCapacity(fixture)) }, (_, index) => ({
    x: (index % columns - (columns - 1) / 2) * 0.62,
    y: boardTops[Math.floor(index / columns)] + 0.18,
    z: 0,
  }));
}
