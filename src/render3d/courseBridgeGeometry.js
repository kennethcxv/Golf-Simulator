// Deterministic, renderer-agnostic bridge geometry for Course Editor paths.
//
// Stored path points are intentionally converted through `pointToWorld` so the
// helper does not know about course-grid dimensions. All returned coordinates
// use the game's world X/Y/Z axes in yards. This runs only when paths rebuild;
// no part of the result is allocated or updated per frame.

const EPSILON = 1e-7;

export const COURSE_BRIDGE_DEFAULTS = Object.freeze({
  sampleSpacingYd: 1.6,
  deckClearanceYd: 0.18,
  deckThicknessYd: 0.22,
  camberRatio: 0.005,
  maxCamberYd: 0.45,
  supportSpacingYd: 12,
  minSupportHeightYd: 0.55,
  supportInsetRatio: 0.64,
  supportBeamDepthYd: 0.24,
  pierRadiusYd: 0.18,
  railHeightYd: 1.05,
  railInsetYd: 0.12,
  railSpanYd: 4,
  railRadiusYd: 0.055,
  railPostRadiusYd: 0.045,
});

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

function nonNegativeNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0) throw new RangeError(`${label} must not be negative`);
  return number;
}

function resolvedStyle(options) {
  const defaults = COURSE_BRIDGE_DEFAULTS;
  const source = options.style || {};
  const read = (key) => source[key] ?? options[key] ?? defaults[key];
  const style = {
    sampleSpacingYd: positiveNumber(read('sampleSpacingYd'), 'sampleSpacingYd'),
    deckClearanceYd: nonNegativeNumber(read('deckClearanceYd'), 'deckClearanceYd'),
    deckThicknessYd: positiveNumber(read('deckThicknessYd'), 'deckThicknessYd'),
    camberRatio: nonNegativeNumber(read('camberRatio'), 'camberRatio'),
    maxCamberYd: nonNegativeNumber(read('maxCamberYd'), 'maxCamberYd'),
    supportSpacingYd: positiveNumber(read('supportSpacingYd'), 'supportSpacingYd'),
    minSupportHeightYd: nonNegativeNumber(read('minSupportHeightYd'), 'minSupportHeightYd'),
    supportInsetRatio: positiveNumber(read('supportInsetRatio'), 'supportInsetRatio'),
    supportBeamDepthYd: positiveNumber(read('supportBeamDepthYd'), 'supportBeamDepthYd'),
    pierRadiusYd: positiveNumber(read('pierRadiusYd'), 'pierRadiusYd'),
    railHeightYd: nonNegativeNumber(read('railHeightYd'), 'railHeightYd'),
    railInsetYd: nonNegativeNumber(read('railInsetYd'), 'railInsetYd'),
    railSpanYd: positiveNumber(read('railSpanYd'), 'railSpanYd'),
    railRadiusYd: positiveNumber(read('railRadiusYd'), 'railRadiusYd'),
    railPostRadiusYd: positiveNumber(read('railPostRadiusYd'), 'railPostRadiusYd'),
  };
  if (style.supportInsetRatio > 0.95) {
    throw new RangeError('supportInsetRatio must be at most 0.95');
  }
  return style;
}

function defaultPointToWorld(point) {
  return { x: point.x, z: point.z ?? point.y };
}

function mapControlPoints(path, pointToWorld) {
  if (!path || typeof path !== 'object') throw new TypeError('path is required');
  if (!Array.isArray(path.pts)) throw new TypeError('path.pts must be an array');
  if (path.pts.length < 2) throw new RangeError('A bridge path needs at least two points');

  const points = [];
  path.pts.forEach((point, index) => {
    const mapped = pointToWorld(point, index);
    if (!mapped || typeof mapped !== 'object') {
      throw new TypeError(`pointToWorld must return a point for path.pts[${index}]`);
    }
    const next = {
      x: finiteNumber(mapped.x, `path.pts[${index}].worldX`),
      z: finiteNumber(mapped.z, `path.pts[${index}].worldZ`),
    };
    const previous = points.at(-1);
    if (!previous || Math.hypot(next.x - previous.x, next.z - previous.z) > EPSILON) {
      points.push(next);
    }
  });

  if (points.length < 2) throw new RangeError('A bridge path needs two distinct points');
  return points;
}

function extrapolate(from, awayFrom) {
  return {
    x: from.x * 2 - awayFrom.x,
    z: from.z * 2 - awayFrom.z,
  };
}

function catmullPoint(p0, p1, p2, p3, u) {
  // Barry-Goldman evaluation of a centripetal Catmull-Rom span. This matches
  // the path renderer's non-looping, alpha=0.5 curve without importing THREE.
  const interval = (a, b) => Math.max(EPSILON, Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)));
  const t0 = 0;
  const t1 = t0 + interval(p0, p1);
  const t2 = t1 + interval(p1, p2);
  const t3 = t2 + interval(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const blend = (a, b, ta, tb) => {
    const denominator = Math.max(EPSILON, tb - ta);
    return {
      x: ((tb - t) * a.x + (t - ta) * b.x) / denominator,
      z: ((tb - t) * a.z + (t - ta) * b.z) / denominator,
    };
  };
  const a1 = blend(p0, p1, t0, t1);
  const a2 = blend(p1, p2, t1, t2);
  const a3 = blend(p2, p3, t2, t3);
  const blendAt = (a, b, ta, tb) => {
    const denominator = Math.max(EPSILON, tb - ta);
    return {
      x: ((tb - t) * a.x + (t - ta) * b.x) / denominator,
      z: ((tb - t) * a.z + (t - ta) * b.z) / denominator,
    };
  };
  const b1 = blendAt(a1, a2, t0, t2);
  const b2 = blendAt(a2, a3, t1, t3);
  return blendAt(b1, b2, t1, t2);
}

function appendDistinct(points, point) {
  const previous = points.at(-1);
  if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > EPSILON) {
    points.push(point);
  }
}

function denseSpline(controlPoints, sampleSpacingYd) {
  const dense = [];
  for (let index = 0; index < controlPoints.length - 1; index += 1) {
    const p1 = controlPoints[index];
    const p2 = controlPoints[index + 1];
    const p0 = controlPoints[index - 1] || extrapolate(p1, p2);
    const p3 = controlPoints[index + 2] || extrapolate(p2, p1);
    const chord = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(8, Math.min(4096, Math.ceil(chord / sampleSpacingYd * 4)));
    if (index === 0) appendDistinct(dense, catmullPoint(p0, p1, p2, p3, 0));
    for (let step = 1; step <= steps; step += 1) {
      appendDistinct(dense, catmullPoint(p0, p1, p2, p3, step / steps));
    }
  }
  return dense;
}

function trimDenseByFraction(dense, startT, endT) {
  if (!Number.isFinite(startT) || !Number.isFinite(endT)
    || startT < 0 || endT > 1 || startT >= endT) {
    throw new RangeError('Bridge startT/endT must define an increasing span between zero and one');
  }
  if (startT === 0 && endT === 1) return dense;
  const cumulative = new Float64Array(dense.length);
  for (let index = 1; index < dense.length; index += 1) {
    cumulative[index] = cumulative[index - 1]
      + Math.hypot(dense[index].x - dense[index - 1].x, dense[index].z - dense[index - 1].z);
  }
  const total = cumulative.at(-1);
  if (!(total > EPSILON)) throw new RangeError('Bridge path length must be greater than zero');
  const pointAtDistance = (distance) => {
    let upper = 1;
    while (upper < cumulative.length - 1 && cumulative[upper] < distance) upper += 1;
    const beforeDistance = cumulative[upper - 1];
    const afterDistance = cumulative[upper];
    const amount = (distance - beforeDistance) / Math.max(EPSILON, afterDistance - beforeDistance);
    return {
      x: dense[upper - 1].x + (dense[upper].x - dense[upper - 1].x) * amount,
      z: dense[upper - 1].z + (dense[upper].z - dense[upper - 1].z) * amount,
    };
  };
  const startDistance = total * startT;
  const endDistance = total * endT;
  const trimmed = [pointAtDistance(startDistance)];
  for (let index = 1; index < dense.length - 1; index += 1) {
    if (cumulative[index] > startDistance && cumulative[index] < endDistance) {
      appendDistinct(trimmed, dense[index]);
    }
  }
  appendDistinct(trimmed, pointAtDistance(endDistance));
  if (trimmed.length < 2) throw new RangeError('Bridge span is too short to resolve');
  return trimmed;
}

function bridgeBuildOptions(path, options) {
  const metadata = path?.bridge && typeof path.bridge === 'object' && !Array.isArray(path.bridge)
    ? path.bridge
    : {};
  const merged = { ...options };
  if (merged.supportSpacingYd == null && merged.style?.supportSpacingYd == null
    && metadata.supportSpacingYd != null) {
    merged.supportSpacingYd = metadata.supportSpacingYd;
  }
  if (merged.railHeightYd == null && merged.style?.railHeightYd == null
    && metadata.railings === false) {
    merged.railHeightYd = 0;
  }
  if (merged.deckClearanceYd == null && merged.style?.deckClearanceYd == null) {
    // deckHeightFt is the authored rise while clearanceFt is a safety floor;
    // using the larger value keeps either setting meaningful at both banks.
    const authoredFeet = [metadata.deckHeightFt, metadata.clearanceFt]
      .filter(Number.isFinite);
    if (authoredFeet.length) merged.deckClearanceYd = Math.max(...authoredFeet) / 3;
  }
  return {
    options: merged,
    startT: options.startT ?? metadata.startT ?? 0,
    endT: options.endT ?? metadata.endT ?? 1,
  };
}

function uniformCenterline(dense, spacing) {
  const cumulative = new Float64Array(dense.length);
  for (let index = 1; index < dense.length; index += 1) {
    cumulative[index] = cumulative[index - 1]
      + Math.hypot(dense[index].x - dense[index - 1].x, dense[index].z - dense[index - 1].z);
  }
  const total = cumulative.at(-1);
  if (!(total > EPSILON)) throw new RangeError('Bridge path length must be greater than zero');

  const segmentCount = Math.max(1, Math.ceil(total / spacing));
  const points = [];
  let cursor = 1;
  for (let index = 0; index <= segmentCount; index += 1) {
    const distance = index === segmentCount ? total : total * index / segmentCount;
    while (cursor < cumulative.length - 1 && cumulative[cursor] < distance) cursor += 1;
    const startDistance = cumulative[cursor - 1];
    const endDistance = cumulative[cursor];
    const amount = (distance - startDistance) / Math.max(EPSILON, endDistance - startDistance);
    const start = dense[cursor - 1];
    const end = dense[cursor];
    points.push({
      x: start.x + (end.x - start.x) * amount,
      z: start.z + (end.z - start.z) * amount,
      distanceYd: distance,
      t: distance / total,
    });
  }
  return { points, lengthYd: total };
}

function addTangents(points) {
  for (let index = 0; index < points.length; index += 1) {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.hypot(dx, dz);
    if (!(length > EPSILON)) throw new RangeError('Bridge path contains an unresolved zero-length span');
    points[index].tx = dx / length;
    points[index].tz = dz / length;
    points[index].nx = -points[index].tz;
    points[index].nz = points[index].tx;
  }
}

function terrainSample(heightAt, x, z, label) {
  return finiteNumber(heightAt(x, z), label);
}

function sampleTerrainAcross(stations, halfWidth, heightAt) {
  for (let index = 0; index < stations.length; index += 1) {
    const station = stations[index];
    const leftX = station.x + station.nx * halfWidth;
    const leftZ = station.z + station.nz * halfWidth;
    const rightX = station.x - station.nx * halfWidth;
    const rightZ = station.z - station.nz * halfWidth;
    station.terrainY = terrainSample(heightAt, station.x, station.z, `heightAt station ${index}`);
    station.leftTerrainY = terrainSample(heightAt, leftX, leftZ, `heightAt left edge ${index}`);
    station.rightTerrainY = terrainSample(heightAt, rightX, rightZ, `heightAt right edge ${index}`);
    station.highTerrainY = Math.max(
      station.terrainY,
      station.leftTerrainY,
      station.rightTerrainY,
    );
  }
}

function setDeckElevations(stations, lengthYd, style) {
  const first = stations[0];
  const last = stations.at(-1);
  const startY = first.highTerrainY + style.deckClearanceYd;
  const endY = last.highTerrainY + style.deckClearanceYd;
  let camberYd = Math.min(style.maxCamberYd, lengthYd * style.camberRatio);

  // If a gently raised bank lies between the endpoints, use available camber
  // before allowing the bridge to clip it. Water bowls remain on the simple
  // bank-to-bank profile because their terrain is below that profile.
  for (let index = 1; index < stations.length - 1; index += 1) {
    const station = stations[index];
    const wave = Math.sin(Math.PI * station.t);
    if (wave <= EPSILON) continue;
    const lineY = startY + (endY - startY) * station.t;
    const required = (station.highTerrainY + style.deckClearanceYd - lineY) / wave;
    camberYd = Math.max(camberYd, Math.min(style.maxCamberYd, required));
  }

  for (const station of stations) {
    const lineY = startY + (endY - startY) * station.t;
    station.deckY = lineY + Math.sin(Math.PI * station.t) * camberYd;
  }
  return camberYd;
}

function writePoint(array, offset, x, y, z) {
  array[offset] = x;
  array[offset + 1] = y;
  array[offset + 2] = z;
}

function buildDeck(stations, halfWidth, thicknessYd) {
  const stationCount = stations.length;
  const positions = new Float32Array(stationCount * 4 * 3);
  const uvs = new Float32Array(stationCount * 4 * 2);
  const leftEdge = new Float32Array(stationCount * 3);
  const rightEdge = new Float32Array(stationCount * 3);
  const elevations = new Float32Array(stationCount);
  const terrainElevations = new Float32Array(stationCount);

  for (let index = 0; index < stationCount; index += 1) {
    const station = stations[index];
    const leftX = station.x + station.nx * halfWidth;
    const leftZ = station.z + station.nz * halfWidth;
    const rightX = station.x - station.nx * halfWidth;
    const rightZ = station.z - station.nz * halfWidth;
    const vertex = index * 12;
    writePoint(positions, vertex, leftX, station.deckY, leftZ);
    writePoint(positions, vertex + 3, rightX, station.deckY, rightZ);
    writePoint(positions, vertex + 6, leftX, station.deckY - thicknessYd, leftZ);
    writePoint(positions, vertex + 9, rightX, station.deckY - thicknessYd, rightZ);
    writePoint(leftEdge, index * 3, leftX, station.deckY, leftZ);
    writePoint(rightEdge, index * 3, rightX, station.deckY, rightZ);
    elevations[index] = station.deckY;
    terrainElevations[index] = station.terrainY;
    const v = station.distanceYd / 4;
    const uv = index * 8;
    uvs.set([0, v, 1, v, 0, v, 1, v], uv);
  }

  // Four faces per span (top, underside and both fascia boards), then two end
  // caps. Shared vertices keep the bridge compact; courseScene computes normals.
  const indices = new Uint32Array((stationCount - 1) * 24 + 12);
  let at = 0;
  for (let index = 0; index < stationCount - 1; index += 1) {
    const current = index * 4;
    const next = current + 4;
    indices.set([
      current, next, current + 1, current + 1, next, next + 1,
      current + 2, current + 3, next + 2, current + 3, next + 3, next + 2,
      current, current + 2, next, current + 2, next + 2, next,
      current + 1, next + 1, current + 3, current + 3, next + 1, next + 3,
    ], at);
    at += 24;
  }
  const end = (stationCount - 1) * 4;
  indices.set([
    0, 1, 2, 1, 3, 2,
    end, end + 2, end + 1, end + 1, end + 2, end + 3,
  ], at);

  return {
    stationCount,
    positions,
    uvs,
    indices,
    leftEdge,
    rightEdge,
    elevations,
    terrainElevations,
  };
}

function stationAtDistance(stations, distanceYd) {
  const bounded = Math.max(0, Math.min(stations.at(-1).distanceYd, distanceYd));
  let upperIndex = 1;
  while (upperIndex < stations.length - 1 && stations[upperIndex].distanceYd < bounded) {
    upperIndex += 1;
  }
  const before = stations[upperIndex - 1];
  const after = stations[upperIndex];
  const amount = (bounded - before.distanceYd)
    / Math.max(EPSILON, after.distanceYd - before.distanceYd);
  const tx = before.tx + (after.tx - before.tx) * amount;
  const tz = before.tz + (after.tz - before.tz) * amount;
  const tangentLength = Math.hypot(tx, tz) || 1;
  return {
    distanceYd: bounded,
    x: before.x + (after.x - before.x) * amount,
    z: before.z + (after.z - before.z) * amount,
    deckY: before.deckY + (after.deckY - before.deckY) * amount,
    tx: tx / tangentLength,
    tz: tz / tangentLength,
    nx: -tz / tangentLength,
    nz: tx / tangentLength,
  };
}

function pointAtLateral(station, lateral, y) {
  return {
    x: station.x + station.nx * lateral,
    y,
    z: station.z + station.nz * lateral,
  };
}

function buildSupports(stations, lengthYd, halfWidth, heightAt, style) {
  const supportCount = Math.max(1, Math.floor(lengthYd / style.supportSpacingYd));
  const lateral = halfWidth * style.supportInsetRatio;
  const supports = [];
  for (let index = 1; index <= supportCount; index += 1) {
    const distanceYd = lengthYd * index / (supportCount + 1);
    const station = stationAtDistance(stations, distanceYd);
    const topY = station.deckY - style.deckThicknessYd;
    const piers = [];
    for (const [side, direction] of [['left', 1], ['right', -1]]) {
      const top = pointAtLateral(station, lateral * direction, topY);
      const terrainY = terrainSample(
        heightAt,
        top.x,
        top.z,
        `heightAt ${side} support ${index}`,
      );
      const heightYd = topY - terrainY;
      if (heightYd >= style.minSupportHeightYd) {
        piers.push({
          side,
          bottom: { x: top.x, y: terrainY, z: top.z },
          top,
          heightYd,
          radiusYd: style.pierRadiusYd,
        });
      }
    }
    if (piers.length) {
      supports.push({
        distanceYd,
        beam: {
          from: pointAtLateral(station, halfWidth, topY),
          to: pointAtLateral(station, -halfWidth, topY),
          depthYd: style.supportBeamDepthYd,
        },
        piers,
      });
    }
  }
  return supports;
}

function buildRails(stations, lengthYd, halfWidth, style) {
  if (style.railHeightYd <= 0) return { segments: [], posts: [] };
  const spanCount = Math.max(1, Math.ceil(lengthYd / style.railSpanYd));
  const lateral = Math.max(halfWidth * 0.5, halfWidth - style.railInsetYd);
  const nodes = { left: [], right: [] };
  for (let index = 0; index <= spanCount; index += 1) {
    const station = stationAtDistance(stations, lengthYd * index / spanCount);
    nodes.left.push({
      bottom: pointAtLateral(station, lateral, station.deckY + 0.03),
      top: pointAtLateral(station, lateral, station.deckY + style.railHeightYd),
    });
    nodes.right.push({
      bottom: pointAtLateral(station, -lateral, station.deckY + 0.03),
      top: pointAtLateral(station, -lateral, station.deckY + style.railHeightYd),
    });
  }

  const segments = [];
  const posts = [];
  for (const side of ['left', 'right']) {
    for (let index = 0; index < nodes[side].length; index += 1) {
      const node = nodes[side][index];
      posts.push({
        side,
        distanceYd: lengthYd * index / spanCount,
        from: node.bottom,
        to: node.top,
        radiusYd: style.railPostRadiusYd,
      });
      if (index > 0) {
        const previous = nodes[side][index - 1];
        segments.push({
          side,
          from: previous.top,
          to: node.top,
          radiusYd: style.railRadiusYd,
        });
      }
    }
  }
  return { segments, posts };
}

/**
 * Build a complete bridge for one editor path.
 *
 * @param {{pts: Array<{x:number,y:number}>, width:number}} path
 * @param {object} options
 * @param {(point: object, index: number) => {x:number,z:number}} [options.pointToWorld]
 * @param {(x:number, z:number) => number} options.heightAt
 * @returns {{deck: object, supports: object[], railSegments: object[], railPosts: object[]}}
 */
export function buildCourseBridgeGeometry(path, options = {}) {
  if (typeof options.heightAt !== 'function') throw new TypeError('heightAt must be a function');
  const pointToWorld = options.pointToWorld ?? defaultPointToWorld;
  if (typeof pointToWorld !== 'function') throw new TypeError('pointToWorld must be a function');
  const widthYd = positiveNumber(path?.width, 'path.width');
  const build = bridgeBuildOptions(path, options);
  const style = resolvedStyle(build.options);
  const controls = mapControlPoints(path, pointToWorld);
  const dense = trimDenseByFraction(
    denseSpline(controls, style.sampleSpacingYd),
    build.startT,
    build.endT,
  );
  const { points: stations, lengthYd } = uniformCenterline(dense, style.sampleSpacingYd);
  addTangents(stations);
  const halfWidth = widthYd / 2;
  sampleTerrainAcross(stations, halfWidth, options.heightAt);
  const camberYd = setDeckElevations(stations, lengthYd, style);
  const deck = buildDeck(stations, halfWidth, style.deckThicknessYd);
  const supports = buildSupports(stations, lengthYd, halfWidth, options.heightAt, style);
  const rails = buildRails(stations, lengthYd, halfWidth, style);

  const centerline = new Float32Array(stations.length * 3);
  for (let index = 0; index < stations.length; index += 1) {
    writePoint(
      centerline,
      index * 3,
      stations[index].x,
      stations[index].deckY,
      stations[index].z,
    );
  }

  return {
    spanStartT: build.startT,
    spanEndT: build.endT,
    lengthYd,
    widthYd,
    camberYd,
    centerline,
    deck,
    supports,
    railSegments: rails.segments,
    railPosts: rails.posts,
    style,
  };
}
