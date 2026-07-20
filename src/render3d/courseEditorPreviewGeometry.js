// Pure planar geometry for course-editor placement previews. Points use the
// game's world X/Z axes in yards; the renderer remains responsible for sampling
// terrain height and lifting the line/fill slightly above the ground.

export const COURSE_EDITOR_PREVIEW_COLORS = Object.freeze({
  valid: 0x7fd66b,
  invalid: 0xd84b3a,
});

export const COURSE_EDITOR_PREVIEW_DEFAULTS = Object.freeze({
  tee: Object.freeze({ widthYd: 19.2, lengthYd: 28.8, shape: 'rectangle' }),
  green: Object.freeze({ sizeYd: 30, shape: 'oval' }),
  bunker: Object.freeze({ sizeYd: 14, shape: 'kidney' }),
  water: Object.freeze({ sizeYd: 36, shape: 'pond' }),
});

const TAU = Math.PI * 2;
const ELLIPSE_SEGMENTS = 32;

// Matches the normalized kidney authored by stampGreen. Keeping this data here
// makes the preview stable even when the next vector id or property seed changes.
const KIDNEY_OUTLINE = Object.freeze([
  [1.02, -0.18], [0.9, 0.28], [0.62, 0.74], [0.14, 1.02],
  [-0.34, 0.94], [-0.74, 0.62], [-0.94, 0.14], [-0.82, -0.34],
  [-0.42, -0.72], [0.02, -0.42], [0.42, -0.82], [0.82, -0.62],
]);

// Fixed radial profiles give pond/lake previews an organic shoreline without
// depending on mutable vector ids or random placement order.
const POND_RADII = Object.freeze([
  1.00, 0.91, 1.06, 0.96, 1.03, 0.88, 1.02, 0.94,
  1.08, 0.92, 1.01, 0.89, 1.05, 0.95, 1.02, 0.90,
]);
const LAKE_RADII = Object.freeze([
  1.00, 0.96, 1.03, 0.98, 1.06, 0.95, 1.01, 0.93, 1.04, 0.97,
  1.02, 0.94, 1.05, 0.98, 1.01, 0.95, 1.04, 0.97, 1.02, 0.94,
]);

function hashN(number) {
  const value = Math.sin(number * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number`);
  return number;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (!(number > 0)) throw new RangeError(`${label} must be greater than zero`);
  return number;
}

function worldPoint(point, label) {
  if (!point || typeof point !== 'object') throw new TypeError(`${label} is required`);
  return {
    x: finiteNumber(point.x, `${label}.x`),
    z: finiteNumber(point.z, `${label}.z`),
  };
}

function cellPoint(point) {
  if (point == null) return null;
  if (typeof point !== 'object') throw new TypeError('hoverCell must be an object');
  return {
    x: finiteNumber(point.x, 'hoverCell.x'),
    y: finiteNumber(point.y, 'hoverCell.y'),
  };
}

function resolveRotation({ rotationRad, rotationDeg, aimWorld }, center) {
  if (rotationRad != null && rotationDeg != null) {
    throw new TypeError('Pass rotationRad or rotationDeg, not both');
  }
  if (rotationRad != null) return finiteNumber(rotationRad, 'rotationRad');
  if (rotationDeg != null) return finiteNumber(rotationDeg, 'rotationDeg') * Math.PI / 180;
  if (aimWorld) return Math.atan2(aimWorld.z - center.z, aimWorld.x - center.x);
  return 0;
}

function rotateLocal(center, localX, localZ, rotationRad) {
  const cosine = Math.cos(rotationRad);
  const sine = Math.sin(rotationRad);
  const x = center.x + localX * cosine - localZ * sine;
  const z = center.z + localX * sine + localZ * cosine;
  return {
    x: Math.abs(x) < 1e-12 ? 0 : x,
    z: Math.abs(z) < 1e-12 ? 0 : z,
  };
}

function ellipse(center, radiusX, radiusZ, rotationRad, segments = ELLIPSE_SEGMENTS) {
  const points = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * TAU;
    points.push(rotateLocal(
      center,
      Math.cos(angle) * radiusX,
      Math.sin(angle) * radiusZ,
      rotationRad,
    ));
  }
  return points;
}

function normalizedOutline(center, outline, radiusX, radiusZ, rotationRad) {
  return outline.map(([x, z]) => rotateLocal(
    center,
    x * radiusX,
    z * radiusZ,
    rotationRad,
  ));
}

function radialOutline(center, radii, radiusX, radiusZ, rotationRad) {
  return radii.map((scale, index) => {
    const angle = index / radii.length * TAU;
    return rotateLocal(
      center,
      Math.cos(angle) * radiusX * scale,
      Math.sin(angle) * radiusZ * scale,
      rotationRad,
    );
  });
}

function cross2(ax, az, bx, bz) {
  return ax * bz - az * bx;
}

function clipSegmentToPolygon(start, end, polygon) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const hits = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const denominator = cross2(dx, dz, ex, ez);
    if (Math.abs(denominator) < 1e-9) continue;
    const qx = a.x - start.x;
    const qz = a.z - start.z;
    const t = cross2(qx, qz, ex, ez) / denominator;
    const u = cross2(qx, qz, dx, dz) / denominator;
    if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) hits.push(t);
  }
  hits.sort((a, b) => a - b);
  const unique = hits.filter((value, index) => index === 0 || Math.abs(value - hits[index - 1]) > 1e-7);
  const segments = [];
  for (let index = 0; index + 1 < unique.length; index += 2) {
    const a = unique[index];
    const b = unique[index + 1];
    if (b - a < 1e-7) continue;
    segments.push([
      { x: start.x + dx * a, z: start.z + dz * a },
      { x: start.x + dx * b, z: start.z + dz * b },
    ]);
  }
  return segments;
}

function greenContourGrid(center, polygon, rotationRad, radiusYd, elongation) {
  const guides = [];
  const addClipped = (start, end) => {
    for (const points of clipSegmentToPolygon(start, end, polygon)) {
      guides.push({ kind: 'contour-grid', closed: false, points });
    }
  };
  const majorSpan = radiusYd * elongation * 1.8;
  const minorSpan = radiusYd * 1.8;
  for (const offset of [-0.45, 0, 0.45]) {
    addClipped(
      rotateLocal(center, -majorSpan, offset * radiusYd, rotationRad),
      rotateLocal(center, majorSpan, offset * radiusYd, rotationRad),
    );
    addClipped(
      rotateLocal(center, offset * radiusYd * elongation, -minorSpan, rotationRad),
      rotateLocal(center, offset * radiusYd * elongation, minorSpan, rotationRad),
    );
  }
  return guides;
}

function seededGreenOutline(center, seed, radiusX, radiusZ, rotationRad) {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * TAU;
    const jitter = 0.82 + 0.30 * hashN(seed * 31 + index * 7.13);
    points.push(rotateLocal(
      center,
      Math.cos(angle) * radiusX * jitter,
      Math.sin(angle) * radiusZ * jitter,
      rotationRad,
    ));
  }
  return points;
}

function seededBunkerOutline(center, seed, radiusX, radiusZ, rotationRad, lobes) {
  const points = [];
  const count = 8 + Math.floor(hashN(seed * 17.7) * 4);
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * TAU;
    const lobe = Math.sin(angle * lobes + seed) * 0.24;
    const jitter = 0.62 + 0.55 * hashN(seed * 13 + index * 3.7) + lobe;
    points.push(rotateLocal(
      center,
      Math.cos(angle) * radiusX * jitter,
      Math.sin(angle) * radiusZ * jitter,
      rotationRad,
    ));
  }
  return points;
}

function seededWaterOutline(center, seed, radiusX, radiusZ, rotationRad) {
  const points = [];
  for (let index = 0; index < 12; index += 1) {
    const angle = index / 12 * TAU;
    const jitter = 0.72 + 0.42 * hashN(seed * 23 + index * 5.3);
    points.push(rotateLocal(
      center,
      Math.cos(angle) * radiusX * jitter,
      Math.sin(angle) * radiusZ * jitter,
      rotationRad,
    ));
  }
  return points;
}

function validityMetadata(valid, reason) {
  const isValid = valid !== false;
  return {
    valid: isValid,
    color: isValid ? COURSE_EDITOR_PREVIEW_COLORS.valid : COURSE_EDITOR_PREVIEW_COLORS.invalid,
    validColor: COURSE_EDITOR_PREVIEW_COLORS.valid,
    invalidColor: COURSE_EDITOR_PREVIEW_COLORS.invalid,
    reason: reason == null ? null : String(reason),
  };
}

function result({
  feature, shape, center, cell, rotationRad, points, guides = [], dimensions,
  valid, invalidReason,
}) {
  return {
    feature,
    shape,
    center: { world: { ...center }, cell: cell ? { ...cell } : null },
    rotationRad,
    dimensions,
    outline: { closed: true, points },
    fill: { points: points.map((point) => ({ ...point })) },
    guides,
    validity: validityMetadata(valid, invalidReason),
  };
}

function buildTeePreview(options, center, cell, aimWorld, rotationRad) {
  const defaults = COURSE_EDITOR_PREVIEW_DEFAULTS.tee;
  const lengthYd = positiveNumber(
    options.lengthYd ?? options.sizeYd ?? defaults.lengthYd,
    'lengthYd',
  );
  const widthYd = positiveNumber(
    options.widthYd ?? (options.sizeYd == null ? defaults.widthYd : options.sizeYd * (2 / 3)),
    'widthYd',
  );
  const halfLength = lengthYd / 2;
  const halfWidth = widthYd / 2;
  const points = [
    rotateLocal(center, -halfLength, -halfWidth, rotationRad),
    rotateLocal(center, halfLength, -halfWidth, rotationRad),
    rotateLocal(center, halfLength, halfWidth, rotationRad),
    rotateLocal(center, -halfLength, halfWidth, rotationRad),
  ];
  const aimStart = rotateLocal(center, halfLength, 0, rotationRad);
  const aimEnd = aimWorld || rotateLocal(center, halfLength + Math.max(12, lengthYd), 0, rotationRad);
  return result({
    feature: 'tee',
    shape: 'rectangle',
    center,
    cell,
    rotationRad,
    points,
    guides: [{ kind: 'aim', closed: false, points: [aimStart, { ...aimEnd }] }],
    dimensions: { widthYd, lengthYd },
    valid: options.valid,
    invalidReason: options.invalidReason,
  });
}

function buildGreenPreview(options, center, cell, rotationRad) {
  const defaults = COURSE_EDITOR_PREVIEW_DEFAULTS.green;
  const shape = options.shape ?? defaults.shape;
  if (!['round', 'oval', 'kidney'].includes(shape)) {
    throw new RangeError(`Unsupported green shape: ${shape}`);
  }
  const sizeYd = positiveNumber(options.sizeYd ?? defaults.sizeYd, 'sizeYd');
  const radiusYd = sizeYd / 2;
  // stampGreen uses a restrained 1.02 stretch for its nominally round option
  // so the preview and authored footprint share the same major axis.
  const elongation = shape === 'round' ? 1.02 : 1.35;
  const seed = options.seed == null ? null : finiteNumber(options.seed, 'seed');
  const points = shape === 'kidney'
    ? normalizedOutline(center, KIDNEY_OUTLINE, radiusYd * elongation, radiusYd, rotationRad)
    : seed == null
      ? ellipse(center, radiusYd * elongation, radiusYd, rotationRad)
      : seededGreenOutline(center, seed, radiusYd * elongation, radiusYd, rotationRad);
  const guides = options.contourGrid === false
    ? []
    : greenContourGrid(center, points, rotationRad, radiusYd, elongation);
  return result({
    feature: 'green', shape, center, cell, rotationRad, points, guides,
    dimensions: { sizeYd, radiusYd, elongation },
    valid: options.valid,
    invalidReason: options.invalidReason,
  });
}

function buildBunkerPreview(options, center, cell, rotationRad) {
  const defaults = COURSE_EDITOR_PREVIEW_DEFAULTS.bunker;
  const shape = options.shape ?? defaults.shape;
  if (!['round', 'oval', 'kidney'].includes(shape)) {
    throw new RangeError(`Unsupported bunker shape: ${shape}`);
  }
  const sizeYd = positiveNumber(options.sizeYd ?? defaults.sizeYd, 'sizeYd');
  const radiusYd = sizeYd / 2;
  const stretch = shape === 'round' ? 1 : shape === 'oval' ? 1.45 : 1.12;
  const seed = options.seed == null ? null : finiteNumber(options.seed, 'seed');
  const lobes = shape === 'round' ? 1 : shape === 'oval' ? 2 : 3;
  const points = seed == null
    ? shape === 'kidney'
      ? normalizedOutline(center, KIDNEY_OUTLINE, radiusYd * stretch, radiusYd, rotationRad)
      : ellipse(center, radiusYd * stretch, radiusYd, rotationRad)
    : seededBunkerOutline(center, seed, radiusYd * stretch, radiusYd, rotationRad, lobes);
  return result({
    feature: 'bunker', shape, center, cell, rotationRad, points,
    dimensions: { sizeYd, radiusYd, stretch },
    valid: options.valid,
    invalidReason: options.invalidReason,
  });
}

function buildWaterPreview(options, center, cell, rotationRad) {
  const defaults = COURSE_EDITOR_PREVIEW_DEFAULTS.water;
  const shape = options.shape ?? defaults.shape;
  if (!['pond', 'lake'].includes(shape)) {
    throw new RangeError(`Unsupported water shape: ${shape}`);
  }
  const sizeYd = positiveNumber(options.sizeYd ?? defaults.sizeYd, 'sizeYd');
  const radiusYd = sizeYd / 2;
  const scale = shape === 'lake' ? 1.6 : 1;
  const elongation = shape === 'lake' ? 1.4 : 1.15;
  const radiusX = radiusYd * scale * elongation;
  const radiusZ = radiusYd * scale;
  const seed = options.seed == null ? null : finiteNumber(options.seed, 'seed');
  const points = seed == null
    ? radialOutline(
      center,
      shape === 'lake' ? LAKE_RADII : POND_RADII,
      radiusX,
      radiusZ,
      rotationRad,
    )
    : seededWaterOutline(center, seed, radiusX, radiusZ, rotationRad);
  return result({
    feature: 'water', shape, center, cell, rotationRad, points,
    dimensions: { sizeYd, radiusYd, scale, elongation, radiusX, radiusZ },
    valid: options.valid,
    invalidReason: options.invalidReason,
  });
}

export function buildCourseEditorPreviewGeometry(options = {}) {
  const feature = options.feature;
  if (!['tee', 'green', 'bunker', 'water'].includes(feature)) {
    throw new RangeError(`Unsupported editor preview feature: ${feature}`);
  }
  const center = worldPoint(options.hoverWorld, 'hoverWorld');
  const cell = cellPoint(options.hoverCell);
  const aimWorld = options.aimWorld == null ? null : worldPoint(options.aimWorld, 'aimWorld');
  const rotationRad = resolveRotation(options, center);

  if (feature === 'tee') return buildTeePreview(options, center, cell, aimWorld, rotationRad);
  if (feature === 'green') return buildGreenPreview(options, center, cell, rotationRad);
  if (feature === 'bunker') return buildBunkerPreview(options, center, cell, rotationRad);
  return buildWaterPreview(options, center, cell, rotationRad);
}
