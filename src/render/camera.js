// FAIRWAY STATE — top-down camera: pan/zoom between world (cell) space and screen px.

import { clamp } from '../core/utils.js';

export const CELL_PX = 8; // base pixels per cell at zoom 1

export function makeCamera(course, canvas) {
  const cam = {
    // world-pixel coordinates of the screen center (world px = cell * CELL_PX)
    cx: (course.w * CELL_PX) / 2,
    cy: (course.h * CELL_PX) / 2,
    zoom: 1.4,
    minZoom: 0.6,
    maxZoom: 6,
    canvas,
  };
  return cam;
}

export function worldToScreen(cam, wx, wy) {
  return {
    x: (wx - cam.cx) * cam.zoom + cam.canvas.width / 2,
    y: (wy - cam.cy) * cam.zoom + cam.canvas.height / 2,
  };
}

export function screenToWorld(cam, sx, sy) {
  return {
    x: (sx - cam.canvas.width / 2) / cam.zoom + cam.cx,
    y: (sy - cam.canvas.height / 2) / cam.zoom + cam.cy,
  };
}

export function screenToCell(cam, sx, sy) {
  const w = screenToWorld(cam, sx, sy);
  return { x: Math.floor(w.x / CELL_PX), y: Math.floor(w.y / CELL_PX) };
}

export function panBy(cam, dxScreen, dyScreen) {
  cam.cx -= dxScreen / cam.zoom;
  cam.cy -= dyScreen / cam.zoom;
}

export function zoomAt(cam, sx, sy, factor) {
  const before = screenToWorld(cam, sx, sy);
  cam.zoom = clamp(cam.zoom * factor, cam.minZoom, cam.maxZoom);
  const after = screenToWorld(cam, sx, sy);
  cam.cx += before.x - after.x;
  cam.cy += before.y - after.y;
}

export function clampToCourse(cam, course) {
  const worldW = course.w * CELL_PX;
  const worldH = course.h * CELL_PX;
  const margin = 300 / cam.zoom;
  cam.cx = clamp(cam.cx, -margin, worldW + margin);
  cam.cy = clamp(cam.cy, -margin, worldH + margin);
}
