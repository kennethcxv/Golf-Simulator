// FAIRWAY STATE — top-down course renderer (placeholder-honest visuals).
// Terrain (zones + hillshade) renders to an offscreen canvas only when dirty;
// per-frame work is the camera blit plus overlays (holes, plan ghost, cursor).

import { ZONE, HOLE_STATUS } from '../sim/constants.js';
import { idx, holeNumber, holeDistanceYd, holePar } from '../sim/course.js';
import { CELL_PX, worldToScreen } from './camera.js';
import { clamp } from '../core/utils.js';

export const ZONE_COLORS = {
  [ZONE.OUT]: '#46543a',
  [ZONE.ROUGH]: '#5c7d43',
  [ZONE.FAIRWAY]: '#7cb257',
  [ZONE.GREEN]: '#96d377',
  [ZONE.TEE]: '#8ac168',
  [ZONE.BUNKER]: '#d8c78e',
  [ZONE.WATER]: '#3e6f9e',
  [ZONE.PATH]: '#a89f8d',
};

// cheap deterministic per-cell hash for texture speckle
function cellHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function shade(hex, factor) {
  const r = clamp(Math.round(parseInt(hex.slice(1, 3), 16) * factor), 0, 255);
  const g = clamp(Math.round(parseInt(hex.slice(3, 5), 16) * factor), 0, 255);
  const b = clamp(Math.round(parseInt(hex.slice(5, 7), 16) * factor), 0, 255);
  return `rgb(${r},${g},${b})`;
}

export function makeCourseRenderer(course) {
  const terrain = document.createElement('canvas');
  terrain.width = course.w * CELL_PX;
  terrain.height = course.h * CELL_PX;
  return {
    course,
    terrain,
    dirty: true,
  };
}

export function markTerrainDirty(renderer) {
  renderer.dirty = true;
}

function redrawTerrain(renderer) {
  const { course, terrain } = renderer;
  const ctx = terrain.getContext('2d');
  const { w, h, zones, elevation } = course;
  ctx.clearRect(0, 0, terrain.width, terrain.height);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const zone = zones[i];
      const base = ZONE_COLORS[zone];

      // hillshade: light from the NW
      const e = elevation[i];
      const ex = x < w - 1 ? elevation[i + 1] : e;
      const ey = y < h - 1 ? elevation[i + w] : e;
      const slope = (e - ex) + (e - ey); // positive = facing the light
      let f = 1 + clamp(slope * 0.045, -0.16, 0.16);

      // per-cell speckle so big fields don't read as flat plastic
      f *= 0.97 + cellHash(x, y) * 0.06;

      // water: darker, no hillshade texture
      if (zone === ZONE.WATER) f = 0.92 + cellHash(x, y) * 0.04;

      ctx.fillStyle = shade(base, f);
      ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);

      // scattered "trees" in out-of-play land
      if (zone === ZONE.OUT && cellHash(x * 7 + 3, y * 5 + 1) > 0.82) {
        ctx.fillStyle = shade('#2f4526', 0.9 + cellHash(x + 9, y + 4) * 0.25);
        const r = CELL_PX * (0.22 + cellHash(x + 1, y + 7) * 0.18);
        ctx.beginPath();
        ctx.arc(x * CELL_PX + CELL_PX / 2, y * CELL_PX + CELL_PX / 2, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // structures
  for (const s of course.structures) {
    const px = s.x * CELL_PX;
    const py = s.y * CELL_PX;
    const pw = s.w * CELL_PX;
    const ph = s.h * CELL_PX;
    ctx.fillStyle = '#6b5a44';
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#8a7458';
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);
    ctx.strokeStyle = '#3d3324';
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  }
  renderer.dirty = false;
}

export function drawCourse(ctx, renderer, cam, app) {
  const { course } = renderer;
  if (renderer.dirty) redrawTerrain(renderer);

  const canvas = ctx.canvas;
  ctx.fillStyle = '#1c2618';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // terrain blit under camera transform
  ctx.save();
  ctx.imageSmoothingEnabled = cam.zoom < 1;
  const topLeft = worldToScreen(cam, 0, 0);
  ctx.translate(topLeft.x, topLeft.y);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.drawImage(renderer.terrain, 0, 0);
  ctx.restore();

  // subtle grid when zoomed in
  if (cam.zoom >= 2.4) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    const cellScreen = CELL_PX * cam.zoom;
    const origin = worldToScreen(cam, 0, 0);
    const startX = Math.max(0, origin.x % cellScreen);
    for (let sx = startX; sx < canvas.width; sx += cellScreen) {
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
      ctx.stroke();
    }
    const startY = Math.max(0, origin.y % cellScreen);
    for (let sy = startY; sy < canvas.height; sy += cellScreen) {
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPlanGhost(ctx, cam, app);
  drawHoles(ctx, cam, course, app);
  drawBrushCursor(ctx, cam, app);
}

function cellScreenRect(cam, x, y) {
  const p = worldToScreen(cam, x * CELL_PX, y * CELL_PX);
  const size = CELL_PX * cam.zoom;
  return { x: p.x, y: p.y, size };
}

function drawPlanGhost(ctx, cam, app) {
  const plan = app.plan;
  if (!plan || plan.cells.size === 0) return;
  ctx.save();
  for (const e of plan.cells.values()) {
    const r = cellScreenRect(cam, e.x, e.y);
    if (r.x + r.size < 0 || r.y + r.size < 0 || r.x > ctx.canvas.width || r.y > ctx.canvas.height) continue;
    if (e.zone !== undefined) {
      ctx.fillStyle = ZONE_COLORS[e.zone];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(r.x, r.y, r.size, r.size);
      ctx.globalAlpha = 1;
    }
    if (e.dElev !== undefined) {
      ctx.fillStyle = e.dElev > 0 ? 'rgba(255,235,170,0.5)' : 'rgba(140,190,255,0.5)';
      ctx.fillRect(r.x, r.y, r.size, r.size);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.size - 1, r.size - 1);
  }
  ctx.restore();
}

function drawHoles(ctx, cam, course, app) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const hole of course.holes) {
    const n = holeNumber(course, hole.id);
    const showLine = app.worksMode || app.hoverHoleId === hole.id;

    if (hole.tee && hole.pin && showLine) {
      const a = worldToScreen(cam, (hole.tee.x + 0.5) * CELL_PX, (hole.tee.y + 0.5) * CELL_PX);
      const b = worldToScreen(cam, (hole.pin.x + 0.5) * CELL_PX, (hole.pin.y + 0.5) * CELL_PX);
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // tee marker
    if (hole.tee) {
      const t = worldToScreen(cam, (hole.tee.x + 0.5) * CELL_PX, (hole.tee.y + 0.5) * CELL_PX);
      const s = Math.max(9, 5 * cam.zoom);
      ctx.fillStyle = '#20351b';
      ctx.strokeStyle = '#cfe3bd';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(t.x - s, t.y - s * 0.7, s * 2, s * 1.4, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e8e4d8';
      ctx.font = `600 ${Math.max(9, 6.5 * cam.zoom)}px "Segoe UI", sans-serif`;
      ctx.fillText(String(n), t.x, t.y + 0.5);
    }

    // pin flag
    if (hole.pin) {
      const p = worldToScreen(cam, (hole.pin.x + 0.5) * CELL_PX, (hole.pin.y + 0.5) * CELL_PX);
      const poleH = Math.max(14, 11 * cam.zoom);
      ctx.strokeStyle = '#f2efe4';
      ctx.lineWidth = Math.max(1.5, 0.9 * cam.zoom);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - poleH);
      ctx.stroke();
      ctx.fillStyle = hole.status === HOLE_STATUS.OPEN ? '#d84b3a' : '#8b8b8b';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - poleH);
      ctx.lineTo(p.x + poleH * 0.62, p.y - poleH * 0.78);
      ctx.lineTo(p.x, p.y - poleH * 0.56);
      ctx.closePath();
      ctx.fill();
      // hole dot
      ctx.fillStyle = '#1c2618';
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.6, 1.1 * cam.zoom), 0, Math.PI * 2);
      ctx.fill();
    }

    // status badge at the midpoint
    if (hole.tee && hole.pin && (hole.status === HOLE_STATUS.RENOVATION || hole.status === HOLE_STATUS.CONSTRUCTION)) {
      const mx = ((hole.tee.x + hole.pin.x) / 2 + 0.5) * CELL_PX;
      const my = ((hole.tee.y + hole.pin.y) / 2 + 0.5) * CELL_PX;
      const m = worldToScreen(cam, mx, my);
      const label = hole.status === HOLE_STATUS.RENOVATION ? `⛏ H${n} · ${hole.daysLeft}d` : `🏗 H${n} · ${hole.daysLeft}d`;
      ctx.font = `600 12px "Segoe UI", sans-serif`;
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = hole.status === HOLE_STATUS.RENOVATION ? 'rgba(120,70,20,0.92)' : 'rgba(110,100,30,0.92)';
      ctx.strokeStyle = 'rgba(255,220,150,0.7)';
      ctx.beginPath();
      ctx.roundRect(m.x - tw / 2, m.y - 11, tw, 22, 11);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffe9c4';
      ctx.fillText(label, m.x, m.y + 0.5);
    }
  }
  ctx.restore();
}

function drawBrushCursor(ctx, cam, app) {
  if (!app.worksMode || !app.activeTool || !app.hoverCell) return;
  const { x, y } = app.hoverCell;
  const kind = app.activeTool.kind;
  const c = worldToScreen(cam, (x + 0.5) * CELL_PX, (y + 0.5) * CELL_PX);

  if (kind === 'zone' || kind === 'elev') {
    const r = (app.brushSize + 0.5) * CELL_PX * cam.zoom;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  } else if (kind === 'marker') {
    ctx.save();
    ctx.strokeStyle = '#ffe9c4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x - 12, c.y);
    ctx.lineTo(c.x + 12, c.y);
    ctx.moveTo(c.x, c.y - 12);
    ctx.lineTo(c.x, c.y + 12);
    ctx.stroke();
    ctx.restore();
  }
}

// Small helper for UI copy: "Hole 4 · Par 5 · 482 yd"
export function holeSummary(course, hole) {
  const n = holeNumber(course, hole.id);
  if (!hole.tee || !hole.pin) return `Hole ${n} · unfinished`;
  return `Hole ${n} · Par ${holePar(hole)} · ${Math.round(holeDistanceYd(hole))} yd`;
}
