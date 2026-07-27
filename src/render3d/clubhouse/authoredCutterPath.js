// Immutable, dependency-free interpretation of Blender-authored carton cut
// paths. CUT_PATH extras are written in Blender's Z-up coordinates while the
// exported glTF scene is Y-up, so metadata points use the same deterministic
// (x, z, -y) conversion as Blender's exporter.

function parsedArray(value, label) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`${label} must be valid JSON`);
    }
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be an array`);
  return parsed;
}

function runtimePoint(value, index) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`CUT_PATH point ${index + 1} must contain x, y and z`);
  }
  const [x, blenderY, blenderZ] = value.map(Number);
  if (![x, blenderY, blenderZ].every(Number.isFinite)) {
    throw new Error(`CUT_PATH point ${index + 1} must be finite`);
  }
  return Object.freeze({ x, y: blenderZ, z: blenderY === 0 ? 0 : -blenderY });
}

function immutableNames(value, label) {
  return Object.freeze(parsedArray(value, label).map((entry, index) => {
    const name = String(entry || '');
    if (!name) throw new Error(`${label} entry ${index + 1} must name a tape mesh`);
    return name;
  }));
}

export function createAuthoredCutterPathContract({
  points,
  segmentNodes,
  orderedTapeNames = [],
  durationSec = 0,
  completionThreshold = 1,
} = {}) {
  const runtimePoints = Object.freeze(parsedArray(points, 'CUT_PATH points')
    .map(runtimePoint));
  if (runtimePoints.length < 2) throw new Error('CUT_PATH requires at least two points');

  const ordered = immutableNames(orderedTapeNames, 'ordered tape names');
  const declared = segmentNodes == null || segmentNodes === ''
    ? ordered
    : immutableNames(segmentNodes, 'CUT_PATH segment_nodes');
  if (!declared.length) throw new Error('CUT_PATH must declare at least one tape mesh');
  if (new Set(declared).size !== declared.length) {
    throw new Error('CUT_PATH segment_nodes must be unique');
  }
  if (ordered.length && (ordered.length !== declared.length
    || ordered.some((name, index) => name !== declared[index]))) {
    throw new Error('CUT_PATH segment_nodes must match tape cut_order');
  }

  const pathSegments = [];
  let totalLength = 0;
  for (let index = 0; index < runtimePoints.length - 1; index += 1) {
    const start = runtimePoints[index];
    const end = runtimePoints[index + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    if (!(length > 1e-6)) throw new Error(`CUT_PATH segment ${index + 1} has zero length`);
    totalLength += length;
    pathSegments.push({ start, end, length });
  }

  let cursor = 0;
  const weightedSegments = Object.freeze(pathSegments.map((segment, index) => {
    const startProgress = cursor / totalLength;
    cursor += segment.length;
    const endProgress = index === pathSegments.length - 1 ? 1 : cursor / totalLength;
    return Object.freeze({
      start: segment.start,
      end: segment.end,
      span: endProgress - startProgress,
      startProgress,
      endProgress,
    });
  }));
  const segmentIndexByName = Object.freeze(Object.fromEntries(
    declared.map((name, index) => [name, index]),
  ));
  const duration = Number(durationSec);
  const threshold = Number(completionThreshold);

  return Object.freeze({
    points: runtimePoints,
    pathSegments: weightedSegments,
    segmentNodes: declared,
    segmentIndexByName,
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : 0,
    completionThreshold: Number.isFinite(threshold)
      ? Math.max(0, Math.min(1, threshold))
      : 1,
    totalLength,
  });
}

export function authoredCutterPathSegment(contract, progress) {
  if (!contract || !Array.isArray(contract.pathSegments) || !contract.pathSegments.length) return null;
  const value = Number(progress);
  const cut = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const segments = contract.pathSegments;
  let segment = segments[segments.length - 1];
  for (const candidate of segments) {
    if (cut < candidate.endProgress || candidate === segments[segments.length - 1]) {
      segment = candidate;
      break;
    }
  }
  const localProgress = segment.span > 0
    ? Math.max(0, Math.min(1, (cut - segment.startProgress) / segment.span))
    : 0;
  return Object.freeze({
    start: segment.start,
    end: segment.end,
    progress: localProgress,
    span: segment.span,
  });
}

// Only meshes explicitly listed by CUT_PATH participate in aggregate cut
// progress. Side returns and reinforcement bands remain sealed and readable
// throughout cutting, then yield when the carton physically starts opening.
export function authoredTapeMeshVisible(contract, name, progress, opening = false) {
  if (!contract) return !opening;
  const index = contract.segmentIndexByName[String(name || '')];
  if (index == null) return !opening;
  const cut = Math.max(0, Math.min(1, Number(progress) || 0));
  const cutCount = Math.floor(cut * contract.segmentNodes.length + 1e-7);
  return index >= cutCount;
}
