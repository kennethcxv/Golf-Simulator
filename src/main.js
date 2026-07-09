// FAIRWAY STATE — application bootstrap: screens, game loop, input routing.
// All simulation lives in src/sim/ (headless-testable); this file wires it to
// the canvas, the DOM UI, and the clock.

import { BALANCE } from './sim/balance.js';
import { HOLE_STATUS } from './sim/constants.js';
import { newGame, deserialize, snapshot, update } from './sim/state.js';
import { addHole, courseDesignRating, holeNumber } from './sim/course.js';
import {
  makePlan, planPaintZone, planAdjustElev, planSmoothElev, applyPlan,
  worksSetTee, worksSetPin,
} from './sim/terrainEdit.js';
import { makeCamera, panBy, zoomAt, screenToCell, clampToCourse } from './render/camera.js';
import { makeCourseRenderer, drawCourse, markTerrainDirty } from './render/courseRenderer.js';
import { calendarOf } from './sim/time.js';
import { el, toast, modal } from './ui/ui.js';
import { makeHud } from './ui/hud.js';
import { makeWorksPanel } from './ui/worksPanel.js';
import { makeInspectPanel } from './ui/inspectPanel.js';
import { makeMenu } from './screens/menu.js';
import { saveData, loadData } from './core/storage.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const uiRoot = document.getElementById('ui');

const app = {
  screen: 'menu', // 'menu' | 'game'
  state: null,
  camera: null,
  renderer: null,
  plan: null,
  worksMode: false,
  activeTool: null,
  brushSize: 1,
  hoverCell: null,
  hoverHoleId: null,
  selectedSection: null,
  speedIdx: 1,
  designRating: 0,
  dpr: 1,
  sectionIndex: null, // Int32Array cell → section id, rebuilt when sections change
  sectionsRef: null,
};

let hud = null;
let worksPanel = null;
let inspectPanel = null;
let menu = null;
let gameUi = null;

// --- canvas sizing -------------------------------------------------------

function resize() {
  app.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * app.dpr);
  canvas.height = Math.round(window.innerHeight * app.dpr);
}
window.addEventListener('resize', resize);
resize();

// --- section lookup --------------------------------------------------------

function rebuildSectionIndex() {
  const st = app.state;
  const map = new Int32Array(st.course.w * st.course.h).fill(-1);
  for (const s of st.sections) {
    for (const i of s.cells) map[i] = s.id;
  }
  app.sectionIndex = map;
  app.sectionsRef = st.sections;
}

function sectionAtCell(x, y) {
  const st = app.state;
  if (!st) return null;
  if (app.sectionsRef !== st.sections) rebuildSectionIndex();
  if (x < 0 || y < 0 || x >= st.course.w || y >= st.course.h) return null;
  const sid = app.sectionIndex[y * st.course.w + x];
  return sid === -1 ? null : st.sections[sid];
}

function recomputeRating() {
  app.designRating = app.state ? courseDesignRating(app.state.course, app.state.sections) : 0;
}

// --- game lifecycle -----------------------------------------------------------

function startGame(state) {
  app.state = state;
  app.screen = 'game';
  app.camera = makeCamera(state.course, canvas);
  app.renderer = makeCourseRenderer(state.course);
  app.plan = makePlan();
  app.worksMode = false;
  app.activeTool = null;
  app.speedIdx = 1;
  rebuildSectionIndex();
  recomputeRating();
  menu.setVisible(false);
  gameUi.style.display = '';
  hud.update();
  toast(`Welcome to ${state.clubName} — ${state.mode} mode.`);
}

function exitToMenu() {
  app.screen = 'menu';
  app.state = null;
  gameUi.style.display = 'none';
  menu.setVisible(true);
}

async function autosave() {
  if (!app.state) return;
  try {
    await saveData('autosave', snapshot(app.state));
  } catch (e) {
    console.error('autosave failed', e);
  }
}

// --- works handlers -------------------------------------------------------------

const handlers = {
  setSpeed(i) {
    app.speedIdx = i;
  },
  toggleWorks() {
    app.worksMode = !app.worksMode;
    if (!app.worksMode) {
      handlers.cancelPlan(true);
      app.activeTool = null;
    }
    worksPanel.setVisible(app.worksMode);
    worksPanel.updateToolHighlight();
    inspectPanel.hide();
    const hint = document.querySelector('.hint-bar');
    if (hint) hint.style.display = app.worksMode ? 'none' : '';
  },
  setTool(tool) {
    app.activeTool = tool;
    worksPanel.updateToolHighlight();
  },
  setBrush(v) {
    app.brushSize = v;
  },
  newHole() {
    addHole(app.state.course);
    worksPanel.refreshHoles();
  },
  confirmPlan() {
    const res = applyPlan(app.state, app.plan);
    if (!res.ok) {
      toast(res.reason, 'warn');
      return;
    }
    markTerrainDirty(app.renderer);
    rebuildSectionIndex();
    recomputeRating();
    worksPanel.refreshPlan();
    worksPanel.refreshHoles();
    const closed = res.report.holesAffected.length;
    toast(
      `Works confirmed — ${res.report.cells} cells for ${res.report.cost.toLocaleString('en-US')} dollars` +
        (closed ? ` · ${closed} hole${closed > 1 ? 's' : ''} closed for renovation` : ''),
    );
    autosave();
  },
  cancelPlan(silent = false) {
    if (app.plan && app.plan.cells.size > 0) {
      app.plan.cells.clear();
      worksPanel.refreshPlan();
      if (!silent) toast('Plan scrapped.');
    }
  },
  openMenu() {
    openPauseMenu();
  },
};

// --- pause menu -------------------------------------------------------------------

const SLOTS = ['slot1', 'slot2', 'slot3'];

function openPauseMenu() {
  const prevSpeed = app.speedIdx;
  app.speedIdx = 0;
  modal('Clubhouse Office', (box, close) => {
    const closeAnd = (fn) => async () => { await fn(); close(); };
    box.append(
      el('div', { class: 'row' }, el('button', { class: 'primary', text: 'Back to the course', onclick: () => { app.speedIdx = prevSpeed || 1; close(); } })),
      el('h2', { text: 'Save', style: 'margin-top:14px;font-size:1rem' }),
      el('div', { class: 'row' }, ...SLOTS.map((slot, i) =>
        el('button', {
          text: `Save slot ${i + 1}`,
          onclick: closeAnd(async () => {
            await saveData(slot, snapshot(app.state));
            toast(`Saved to slot ${i + 1}.`);
            app.speedIdx = prevSpeed || 1;
          }),
        }),
      )),
      el('h2', { text: 'Load', style: 'margin-top:8px;font-size:1rem' }),
      el('div', { class: 'row' }, ...SLOTS.map((slot, i) =>
        el('button', {
          text: `Load slot ${i + 1}`,
          onclick: closeAnd(async () => {
            const data = await loadData(slot);
            if (!data) {
              toast(`Slot ${i + 1} is empty.`, 'warn');
              app.speedIdx = prevSpeed || 1;
              return;
            }
            startGame(deserialize(data));
          }),
        }),
      )),
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('button', { class: 'danger', text: 'Exit to menu (autosaves)', onclick: closeAnd(async () => { await autosave(); exitToMenu(); }) }),
      ),
    );
  });
}

// --- input ------------------------------------------------------------------------

let dragging = null; // { mode: 'pan'|'paint', lastX, lastY, moved, strokeCells:Set }

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * app.dpr, y: (e.clientY - rect.top) * app.dpr };
}

function applyToolAtCell(cell, strokeCells) {
  const t = app.activeTool;
  if (!t) return;
  const key = cell.x + cell.y * 100000;
  if (t.kind === 'zone') {
    planPaintZone(app.plan, app.state.course, cell.x, cell.y, app.brushSize, t.zone);
  } else if (t.kind === 'elev') {
    if (strokeCells.has(key)) return;
    strokeCells.add(key);
    if (t.dir === 'raise') planAdjustElev(app.plan, app.state.course, cell.x, cell.y, app.brushSize, +0.5);
    else if (t.dir === 'lower') planAdjustElev(app.plan, app.state.course, cell.x, cell.y, app.brushSize, -0.5);
    else planSmoothElev(app.plan, app.state.course, cell.x, cell.y, Math.max(1, app.brushSize), 0.5);
  }
  worksPanel.refreshPlan();
}

function placeMarkerAt(cell) {
  const t = app.activeTool;
  const fn = t.which === 'tee' ? worksSetTee : worksSetPin;
  const res = fn(app.state, t.holeId, cell.x, cell.y);
  if (!res.ok) {
    toast(res.reason, 'warn');
    return;
  }
  const n = holeNumber(app.state.course, t.holeId);
  toast(`${t.which === 'tee' ? 'Tee' : 'Pin'} set for hole ${n}.`);
  app.activeTool = null;
  worksPanel.updateToolHighlight();
  worksPanel.refreshHoles();
  worksPanel.refreshPlan();
  rebuildSectionIndex();
  recomputeRating();
}

canvas.addEventListener('pointerdown', (e) => {
  if (app.screen !== 'game') return;
  const p = canvasPos(e);
  canvas.setPointerCapture(e.pointerId);

  if (e.button === 1 || e.button === 2) {
    dragging = { mode: 'pan', lastX: p.x, lastY: p.y, moved: 0 };
    return;
  }
  if (e.button === 0) {
    const cell = screenToCell(app.camera, p.x, p.y);
    if (app.worksMode && app.activeTool) {
      if (app.activeTool.kind === 'marker') {
        placeMarkerAt(cell);
        return;
      }
      dragging = { mode: 'paint', lastX: p.x, lastY: p.y, moved: 0, strokeCells: new Set() };
      applyToolAtCell(cell, dragging.strokeCells);
      return;
    }
    // no tool: left-drag pans, plain click inspects
    dragging = { mode: 'pan-or-click', lastX: p.x, lastY: p.y, moved: 0, cell };
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (app.screen !== 'game') return;
  const p = canvasPos(e);
  app.hoverCell = screenToCell(app.camera, p.x, p.y);
  updateHoverHole();

  if (!dragging) return;
  const dx = p.x - dragging.lastX;
  const dy = p.y - dragging.lastY;
  dragging.moved += Math.abs(dx) + Math.abs(dy);

  if (dragging.mode === 'pan' || (dragging.mode === 'pan-or-click' && dragging.moved > 6)) {
    dragging.mode = dragging.mode === 'pan-or-click' ? 'pan' : dragging.mode;
    panBy(app.camera, dx, dy);
    clampToCourse(app.camera, app.state.course);
  } else if (dragging.mode === 'paint') {
    // walk the segment so fast drags don't leave gaps
    const from = screenToCell(app.camera, dragging.lastX, dragging.lastY);
    const to = app.hoverCell;
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
    for (let i = 1; i <= steps; i++) {
      const cx = Math.round(from.x + ((to.x - from.x) * i) / steps);
      const cy = Math.round(from.y + ((to.y - from.y) * i) / steps);
      applyToolAtCell({ x: cx, y: cy }, dragging.strokeCells);
    }
  }
  dragging.lastX = p.x;
  dragging.lastY = p.y;
});

canvas.addEventListener('pointerup', (e) => {
  if (app.screen !== 'game' || !dragging) return;
  if (dragging.mode === 'pan-or-click' && dragging.moved <= 6) {
    const section = sectionAtCell(dragging.cell.x, dragging.cell.y);
    if (section) inspectPanel.show(section);
    else inspectPanel.hide();
  }
  dragging = null;
});

canvas.addEventListener('wheel', (e) => {
  if (app.screen !== 'game') return;
  e.preventDefault();
  const p = canvasPos(e);
  zoomAt(app.camera, p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  clampToCourse(app.camera, app.state.course);
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (app.screen !== 'game') return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      app.speedIdx = app.speedIdx === 0 ? 1 : 0;
      break;
    case '1': app.speedIdx = 1; break;
    case '2': app.speedIdx = 2; break;
    case '3': app.speedIdx = 3; break;
    case 'e': case 'E':
      handlers.toggleWorks();
      break;
    case 'Escape':
      if (app.activeTool) {
        app.activeTool = null;
        worksPanel.updateToolHighlight();
      } else if (app.worksMode) {
        handlers.toggleWorks();
      } else if (app.selectedSection) {
        inspectPanel.hide();
      } else {
        openPauseMenu();
      }
      break;
  }
});

function updateHoverHole() {
  app.hoverHoleId = null;
  if (!app.state || !app.hoverCell) return;
  const { x, y } = app.hoverCell;
  for (const hole of app.state.course.holes) {
    if (!hole.tee || !hole.pin) continue;
    const dx1 = hole.tee.x - x;
    const dy1 = hole.tee.y - y;
    const dx2 = hole.pin.x - x;
    const dy2 = hole.pin.y - y;
    if (Math.min(dx1 * dx1 + dy1 * dy1, dx2 * dx2 + dy2 * dy2) < 16) {
      app.hoverHoleId = hole.id;
      return;
    }
  }
}

// --- keyboard pan (held keys) -----------------------------------------------------

const held = new Set();
window.addEventListener('keydown', (e) => {
  if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) held.add(e.key);
});
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('blur', () => held.clear());

function keyboardPan(dtMs) {
  if (app.screen !== 'game') return;
  const v = 0.9 * dtMs;
  let dx = 0;
  let dy = 0;
  if (held.has('a') || held.has('ArrowLeft')) dx += v;
  if (held.has('d') || held.has('ArrowRight')) dx -= v;
  if (held.has('w') || held.has('ArrowUp')) dy += v;
  if (held.has('s') || held.has('ArrowDown')) dy -= v;
  if (dx || dy) {
    panBy(app.camera, dx, dy);
    clampToCourse(app.camera, app.state.course);
  }
}

// --- night overlay ------------------------------------------------------------------

function drawNight(ctx2) {
  const cal = calendarOf(app.state.clock.minutes);
  const m = cal.minuteOfDay;
  let alpha = 0;
  if (m < 5 * 60) alpha = 0.42;
  else if (m < 7 * 60) alpha = 0.42 * (1 - (m - 5 * 60) / 120);
  else if (m > 21 * 60) alpha = 0.42;
  else if (m > 19 * 60) alpha = 0.42 * ((m - 19 * 60) / 120);
  if (alpha > 0.01) {
    ctx2.fillStyle = `rgba(10, 16, 34, ${alpha})`;
    ctx2.fillRect(0, 0, ctx2.canvas.width, ctx2.canvas.height);
  }
}

// --- main loop -----------------------------------------------------------------------

let lastTs = 0;

function frame(ts) {
  const dtMs = Math.min(250, ts - lastTs || 16);
  lastTs = ts;

  if (app.screen === 'game' && app.state) {
    keyboardPan(dtMs);
    const speed = BALANCE.speeds[app.speedIdx];
    if (speed > 0) {
      const gameMinutes = (dtMs / 1000) * BALANCE.gameMinutesPerRealSecond * speed;
      const { daysPassed } = update(app.state, gameMinutes);
      if (daysPassed > 0) {
        markTerrainDirty(app.renderer);
        rebuildSectionIndex();
        recomputeRating();
        worksPanel.refreshHoles();
        announceReopenings();
        autosave();
      }
    }
    drawCourse(ctx, app.renderer, app.camera, app);
    drawNight(ctx);
    hud.update();
  }
  requestAnimationFrame(frame);
}

// surfacing renovation completions as toasts
let lastStatuses = new Map();

function announceReopenings() {
  const course = app.state.course;
  for (const hole of course.holes) {
    const prev = lastStatuses.get(hole.id);
    if (prev && prev !== HOLE_STATUS.OPEN && hole.status === HOLE_STATUS.OPEN) {
      toast(`Hole ${holeNumber(course, hole.id)} is back open.`);
    }
    lastStatuses.set(hole.id, hole.status);
  }
}

// --- boot ------------------------------------------------------------------------------

function boot() {
  menu = makeMenu({
    onNewGame(mode) {
      startGame(newGame(mode, (Math.random() * 2 ** 31) | 0));
    },
    async onContinue() {
      const data = await loadData('autosave');
      if (data) startGame(deserialize(data));
      else toast('No autosave found.', 'warn');
    },
  });

  gameUi = el('div', { style: 'display:none' });
  hud = makeHud(app, handlers);
  worksPanel = makeWorksPanel(app, handlers);
  inspectPanel = makeInspectPanel(app);
  gameUi.append(hud.root, worksPanel.palette, worksPanel.planBar, inspectPanel.root,
    el('div', { class: 'hint-bar', text: 'Drag: pan · Wheel: zoom · E: Course Works · Click: inspect · Space: pause' }));

  uiRoot.append(menu.root, gameUi);
  requestAnimationFrame(frame);
}

boot();

// Debug/QA hook: lets browser tooling inspect and drive the live app state.
// Harmless in production (read-mostly), invaluable for automated QA.
window.__fw = app;
