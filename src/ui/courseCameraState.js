// Pure state helpers for the course editor camera controls. Keeping flyover
// timing and restore semantics out of the DOM makes the selector lifecycle
// deterministic and directly testable in Node.

export const COURSE_CAMERA_VIEW_OPTIONS = Object.freeze([
  Object.freeze(['frame-hole', 'Frame Hole']),
  Object.freeze(['tee', 'Tee View']),
  Object.freeze(['fairway', 'Fairway View']),
  Object.freeze(['approach', 'Approach View']),
  Object.freeze(['green', 'Green View']),
  Object.freeze(['ground-preview', 'Ground Preview']),
  Object.freeze(['course-overview', 'Course Overview']),
]);

export const FLYOVER_CAMERA_VIEW = 'flyover';
export const COURSE_FLYOVER_DURATION_SECONDS = 7.5;

const CAMERA_VIEW_SET = new Set(COURSE_CAMERA_VIEW_OPTIONS.map(([value]) => value));

function clamp(value, lo, hi) {
  const finite = Number.isFinite(value) ? value : lo;
  return Math.max(lo, Math.min(hi, finite));
}

export function normalizeCourseCameraView(mode) {
  return CAMERA_VIEW_SET.has(mode) ? mode : 'frame-hole';
}

export function beginCourseCameraFlyover(hole, restoreView) {
  if (!hole) return null;
  return {
    hole,
    t: 0,
    restoreView: normalizeCourseCameraView(restoreView),
    statusPercent: 0,
  };
}

export function advanceCourseCameraFlyover(
  flight,
  deltaSeconds,
  durationSeconds = COURSE_FLYOVER_DURATION_SECONDS,
) {
  if (!flight) return null;
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : COURSE_FLYOVER_DURATION_SECONDS;
  const t = clamp(flight.t + Math.max(0, Number(deltaSeconds) || 0) / duration, 0, 1);
  // Five-percent buckets keep the visible selector status useful without
  // rewriting an option every animation frame.
  const statusPercent = Math.min(100, Math.floor(t * 20 + 1e-9) * 5);
  return { ...flight, t, statusPercent };
}

export function courseCameraFlyoverLabel(flight) {
  const percent = clamp(flight?.statusPercent, 0, 100);
  return `Flyover \u00b7 ${percent}%`;
}

