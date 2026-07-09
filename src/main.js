// FAIRWAY STATE — application bootstrap: screens, game loop, input routing.
// All simulation lives in src/sim/ (headless-testable); this file wires it to
// the 3D course scene, the DOM UI, and the clock.

import { BALANCE } from './sim/balance.js';
import { HOLE_STATUS, TURF_ZONES } from './sim/constants.js';
import { newGame, deserialize, snapshot, update } from './sim/state.js';
import { addHole, courseDesignRating, holeNumber } from './sim/course.js';
import {
  makePlan, planPaintZone, planAdjustElev, planSmoothElev, applyPlan,
  worksSetTee, worksSetPin,
} from './sim/terrainEdit.js';
import { calendarOf } from './sim/time.js';
import { el, toast, modal } from './ui/ui.js';
import { makeHud } from './ui/hud.js';
import { makeWorksPanel } from './ui/worksPanel.js';
import { makeInspectPanel } from './ui/inspectPanel.js';
import { makeGroundsPanel } from './ui/groundsPanel.js';
import { makeClubPanel } from './ui/clubPanel.js';
import { makeShopPanel } from './ui/shopPanel.js';
import { makeShopScene } from './render3d/shopScene.js';
import { makeMenu } from './screens/menu.js';
import { saveData, loadData } from './core/storage.js';
import { conditionRating, sectionTurfSummary } from './sim/turf.js';
import { makeCourseScene } from './render3d/courseScene.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');

const app = {
  screen: 'menu', // 'menu' | 'game'
  view: 'course', // 'course' | 'shop3d'
  state: null,
  scene3d: null,
  shopScene: null,
  plan: null,
  worksMode: false,
  activeTool: null,
  brushSize: 1,
  hoverCell: null,
  selectedSection: null,
  speedIdx: 1,
  designRating: 0,
  conditionRatingVal: 0,
  overallRating: 0,
  viewMode: 'normal', // 'normal' | 'health' | 'moisture'
  groundsOpen: false,
  sectionIndex: null,
  sectionsRef: null,
};

let hud = null;
let worksPanel = null;
let inspectPanel = null;
let groundsPanel = null;
let clubPanel = null;
let shopPanel = null;
let shopOverlay = null;
let menu = null;
let gameUi = null;

function closeLeftPanels(except) {
  if (except !== 'works' && app.worksMode) handlers.toggleWorks();
  if (except !== 'grounds' && app.groundsOpen) groundsPanel.setVisible(false);
  if (except !== 'club' && app.clubOpen) clubPanel.setVisible(false);
  if (except !== 'shop' && app.shopOpen) shopPanel.setVisible(false);
}

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
  if (!app.state) {
    app.designRating = 0;
    app.conditionRatingVal = 0;
    app.overallRating = 0;
    return;
  }
  app.designRating = courseDesignRating(app.state.course, app.state.sections);
  app.conditionRatingVal = app.state.turf ? conditionRating(app.state) : 0;
  // condition dominates how a course actually feels to play
  app.overallRating = 0.4 * app.designRating + 0.6 * app.conditionRatingVal;
}

// disease outbreak notifications: compare the diseased-section set day to day
let lastDiseasedNames = new Set();

function currentDiseasedSet() {
  const now = new Set();
  for (const s of app.state.sections) {
    if (!TURF_ZONES.has(s.zone)) continue;
    const sum = sectionTurfSummary(app.state, s);
    if (sum.disease) now.add(`${sum.disease.name}|${s.name}`);
  }
  return now;
}

function announceOutbreaks() {
  if (!app.state.turf) return;
  const now = currentDiseasedSet();
  for (const key of now) {
    if (!lastDiseasedNames.has(key)) {
      const [disease, name] = key.split('|');
      toast(`${disease} has broken out on ${name}.`, 'warn');
    }
  }
  for (const key of lastDiseasedNames) {
    if (!now.has(key)) {
      const [disease, name] = key.split('|');
      toast(`${name} has shaken off the ${disease.toLowerCase()}.`);
    }
  }
  lastDiseasedNames = now;
}

// --- game lifecycle -----------------------------------------------------------

function startGame(state) {
  if (app.view === 'shop3d' && app.shopScene) {
    app.shopScene.exit();
    if (shopOverlay) shopOverlay.style.display = 'none';
    app.view = 'course';
  }
  if (app.scene3d) {
    app.scene3d.dispose();
    app.scene3d = null;
  }
  app.shopScene = null; // rebuilt lazily against the new renderer
  app.state = state;
  app.screen = 'game';
  app.scene3d = makeCourseScene(canvas, state);
  app.plan = makePlan();
  app.worksMode = false;
  app.activeTool = null;
  app.speedIdx = 1;
  app.viewMode = 'normal';
  lastHourSeen = -1;
  rebuildSectionIndex();
  recomputeRating();
  lastDiseasedNames = currentDiseasedSet(); // prime silently
  if (groundsPanel) groundsPanel.setVisible(false);
  if (worksPanel) worksPanel.setVisible(false);
  menu.setVisible(false);
  gameUi.style.display = '';
  hud.update();
  toast(`Welcome to ${state.clubName} — ${state.mode} mode.`);
  if (lastDiseasedNames.size > 0) {
    toast(`The greenskeeper's note: ${lastDiseasedNames.size} greens are fighting disease. Click them to diagnose.`, 'warn');
  }
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

// --- handlers -------------------------------------------------------------------

const handlers = {
  setSpeed(i) {
    app.speedIdx = i;
  },
  toggleWorks() {
    app.worksMode = !app.worksMode;
    if (!app.worksMode) {
      handlers.cancelPlan(true);
      app.activeTool = null;
      app.scene3d.setBrush(null, 0, null);
    } else {
      closeLeftPanels('works');
    }
    worksPanel.setVisible(app.worksMode);
    worksPanel.updateToolHighlight();
    inspectPanel.hide();
    const hint = document.querySelector('.hint-bar');
    if (hint) hint.style.display = app.worksMode ? 'none' : '';
  },
  toggleGrounds() {
    const next = !app.groundsOpen;
    if (next) closeLeftPanels('grounds');
    groundsPanel.setVisible(next);
  },
  toggleClub() {
    const next = !app.clubOpen;
    if (next) closeLeftPanels('club');
    clubPanel.setVisible(next);
  },
  toggleShopPanel() {
    const next = !app.shopOpen;
    if (next) closeLeftPanels('shop');
    shopPanel.setVisible(next);
  },
  enterShop() {
    if (app.view === 'shop3d') return;
    closeLeftPanels('none');
    inspectPanel.hide();
    app.view = 'shop3d';
    if (!app.shopScene) {
      app.shopScene = makeShopScene(app.scene3d.renderer, {
        app,
        toast,
        exitShop: () => handlers.exitShop(),
      });
    }
    app.shopScene.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
    app.shopScene.enter();
    shopOverlay.style.display = '';
    document.querySelector('.hint-bar').style.display = 'none';
    try {
      const p = canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {}); // some environments refuse; click-to-look covers it
    } catch { /* fall back to click-to-look */ }
  },
  exitShop() {
    if (app.view !== 'shop3d') return;
    app.view = 'course';
    app.shopScene.exit();
    shopOverlay.style.display = 'none';
    document.querySelector('.hint-bar').style.display = '';
    app.scene3d.resize();
  },
  setViewMode(mode) {
    app.viewMode = mode;
    app.scene3d.setViewMode(mode);
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
    app.scene3d.rebuildAll(app.state);
    app.scene3d.updatePlan(app.plan);
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
      app.scene3d.updatePlan(app.plan);
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

let dragging = null; // { mode: 'pan'|'orbit'|'paint'|'pan-or-click', lastX, lastY, moved, strokeCells, cell }

function applyToolAtCell(cell, strokeCells) {
  const t = app.activeTool;
  if (!t || !cell) return;
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
  app.scene3d.updatePlan(app.plan);
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
  app.scene3d.setBrush(null, 0, null);
  app.scene3d.updateHoles();
  worksPanel.updateToolHighlight();
  worksPanel.refreshHoles();
  worksPanel.refreshPlan();
  rebuildSectionIndex();
  recomputeRating();
}

function refreshHover(clientX, clientY) {
  if (!app.scene3d) return;
  const hit = app.scene3d.raycastCell(clientX, clientY);
  app.hoverCell = hit ? { x: hit.x, y: hit.y } : null;
  if (app.worksMode && app.activeTool) {
    app.scene3d.setBrush(app.hoverCell, app.brushSize, app.activeTool.kind);
  } else {
    app.scene3d.setBrush(null, 0, null);
  }
}

canvas.addEventListener('click', () => {
  // in the shop, clicking (re)captures the mouse for looking around
  if (app.screen === 'game' && app.view === 'shop3d' && !document.pointerLockElement) {
    try {
      const p = canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch { /* arrow keys still steer the view */ }
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (app.screen !== 'game' || app.view !== 'course') return;
  canvas.setPointerCapture(e.pointerId);

  if (e.button === 1 || e.button === 2) {
    dragging = { mode: 'orbit', lastX: e.clientX, lastY: e.clientY, moved: 0 };
    return;
  }
  if (e.button === 0) {
    refreshHover(e.clientX, e.clientY);
    if (app.worksMode && app.activeTool) {
      if (app.activeTool.kind === 'marker') {
        if (app.hoverCell) placeMarkerAt(app.hoverCell);
        return;
      }
      dragging = { mode: 'paint', lastX: e.clientX, lastY: e.clientY, moved: 0, strokeCells: new Set(), lastCell: app.hoverCell };
      applyToolAtCell(app.hoverCell, dragging.strokeCells);
      return;
    }
    dragging = { mode: 'pan-or-click', lastX: e.clientX, lastY: e.clientY, moved: 0, cell: app.hoverCell };
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (app.screen !== 'game' || app.view !== 'course') return;
  refreshHover(e.clientX, e.clientY);

  if (!dragging) return;
  const dx = e.clientX - dragging.lastX;
  const dy = e.clientY - dragging.lastY;
  dragging.moved += Math.abs(dx) + Math.abs(dy);

  if (dragging.mode === 'orbit') {
    app.scene3d.rig.orbit(-dx * 0.0052, dy * 0.0038);
  } else if (dragging.mode === 'pan' || (dragging.mode === 'pan-or-click' && dragging.moved > 6)) {
    dragging.mode = 'pan';
    app.scene3d.rig.pan(dx, dy, canvas.clientHeight || window.innerHeight);
  } else if (dragging.mode === 'paint') {
    const from = dragging.lastCell;
    const to = app.hoverCell;
    if (from && to) {
      const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
      for (let i = 1; i <= steps; i++) {
        const cx = Math.round(from.x + ((to.x - from.x) * i) / steps);
        const cy = Math.round(from.y + ((to.y - from.y) * i) / steps);
        applyToolAtCell({ x: cx, y: cy }, dragging.strokeCells);
      }
    }
    dragging.lastCell = to;
  }
  dragging.lastX = e.clientX;
  dragging.lastY = e.clientY;
});

canvas.addEventListener('pointerup', () => {
  if (app.screen !== 'game' || app.view !== 'course' || !dragging) return;
  if (dragging.mode === 'pan-or-click' && dragging.moved <= 6 && dragging.cell) {
    const section = sectionAtCell(dragging.cell.x, dragging.cell.y);
    if (section) inspectPanel.show(section);
    else inspectPanel.hide();
  }
  dragging = null;
});

canvas.addEventListener('wheel', (e) => {
  if (app.screen !== 'game' || app.view !== 'course') return;
  e.preventDefault();
  app.scene3d.rig.dolly(e.deltaY > 0 ? 1.13 : 1 / 1.13);
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (app.screen !== 'game') return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;

  // time controls work in either view
  switch (e.key) {
    case ' ':
      e.preventDefault();
      app.speedIdx = app.speedIdx === 0 ? 1 : 0;
      return;
    case '1': app.speedIdx = 1; return;
    case '2': app.speedIdx = 2; return;
    case '3': app.speedIdx = 3; return;
  }

  if (app.view === 'shop3d') {
    switch (e.key) {
      case 'e': case 'E':
        app.shopScene.interact();
        break;
      case 'p': case 'P':
        handlers.exitShop();
        break;
      case 'Escape':
        // first Esc releases the pointer (browser); a second one leaves the shop
        if (!document.pointerLockElement) handlers.exitShop();
        break;
    }
    return;
  }

  switch (e.key) {
    case 'e': case 'E':
      handlers.toggleWorks();
      break;
    case 'g': case 'G':
      handlers.toggleGrounds();
      break;
    case 'c': case 'C':
      handlers.toggleClub();
      break;
    case 'p': case 'P':
      handlers.enterShop();
      break;
    case 'v': case 'V': {
      const modes = ['normal', 'health', 'moisture'];
      handlers.setViewMode(modes[(modes.indexOf(app.viewMode) + 1) % modes.length]);
      break;
    }
    case 'Escape':
      if (app.activeTool) {
        app.activeTool = null;
        app.scene3d.setBrush(null, 0, null);
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

// held-key camera movement
const held = new Set();
window.addEventListener('keydown', (e) => {
  if (['w', 'a', 's', 'd', 'q', 'e', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) held.add(e.key);
});
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('blur', () => held.clear());

function keyboardCamera(dtMs) {
  if (app.screen !== 'game' || app.view !== 'course' || !app.scene3d) return;
  const v = 0.7 * dtMs;
  let dx = 0;
  let dy = 0;
  if (held.has('a') || held.has('ArrowLeft')) dx += v;
  if (held.has('d') || held.has('ArrowRight')) dx -= v;
  if (held.has('w') || held.has('ArrowUp')) dy += v;
  if (held.has('s') || held.has('ArrowDown')) dy -= v;
  if (dx || dy) app.scene3d.rig.pan(-dx, -dy, canvas.clientHeight || window.innerHeight);
  if (held.has('q')) app.scene3d.rig.orbit(0.0016 * dtMs, 0);
  // note: 'e' toggles works mode on keydown; rotation uses Q + right-drag only
}

// --- main loop -----------------------------------------------------------------------

let lastTs = 0;
let lastHourSeen = -1;

function frame(ts) {
  const dtMs = Math.min(250, ts - lastTs || 16);
  lastTs = ts;

  if (app.screen === 'game' && app.state && app.scene3d) {
    keyboardCamera(dtMs);
    const speed = BALANCE.speeds[app.speedIdx];
    if (speed > 0) {
      const gameMinutes = (dtMs / 1000) * BALANCE.gameMinutesPerRealSecond * speed;
      const { daysPassed } = update(app.state, gameMinutes);
      if (daysPassed > 0) {
        rebuildSectionIndex();
        worksPanel.refreshHoles();
        app.scene3d.updateHoles();
        announceReopenings();
        announceOutbreaks();
        if (app.clubOpen) clubPanel.refresh();
        autosave();
      }
      const hourNow = Math.floor(app.state.clock.minutes / 60);
      if (hourNow !== lastHourSeen) {
        lastHourSeen = hourNow;
        app.scene3d.updateTurf(app.state);
        recomputeRating();
        inspectPanel.refreshIfOpen();
        if (app.groundsOpen) groundsPanel.refresh();
      }
    }
    if (app.view === 'shop3d' && app.shopScene) {
      app.shopScene.update(dtMs);
      app.shopScene.render();
      updateShopOverlay();
    } else {
      const cal = calendarOf(app.state.clock.minutes);
      app.scene3d.applyTimeWeather(cal.minuteOfDay, app.state.weather);
      app.scene3d.render(dtMs, app.state);
    }
    hud.update();
  }
  requestAnimationFrame(frame);
}

function updateShopOverlay() {
  const prompt = shopOverlay.querySelector('.shop-prompt');
  const label = app.shopScene.getFocusLabel();
  prompt.textContent = label || '';
  prompt.style.opacity = label ? '1' : '0';
  const lockHint = shopOverlay.querySelector('.shop-lockhint');
  lockHint.style.display = document.pointerLockElement ? 'none' : '';
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

function resize() {
  if (app.scene3d) app.scene3d.resize();
  if (app.shopScene) app.shopScene.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
}
window.addEventListener('resize', resize);

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
  inspectPanel = makeInspectPanel(app, recomputeRating);
  groundsPanel = makeGroundsPanel(app);
  clubPanel = makeClubPanel(app, recomputeRating);
  shopPanel = makeShopPanel(app, handlers);

  shopOverlay = el('div', { class: 'shop-overlay', style: 'display:none' },
    el('div', { class: 'shop-crosshair' }),
    el('div', { class: 'shop-prompt', text: '' }),
    el('div', { class: 'shop-lockhint', text: 'Click to look around · WASD move · E interact · P leave' }),
    el('button', { class: 'shop-leave', text: '← Back to the course (P)', onclick: () => handlers.exitShop() }),
  );

  const viewButtons = ['normal', 'health', 'moisture'].map((mode) =>
    el('button', {
      text: mode === 'normal' ? '🗺 Normal' : mode === 'health' ? '❤ Health' : '💧 Moisture',
      onclick: () => handlers.setViewMode(mode),
    }),
  );
  const viewToggle = el('div', { class: 'view-toggle' }, ...viewButtons);
  setInterval(() => {
    viewButtons.forEach((b, i) => b.classList.toggle('active-tool', ['normal', 'health', 'moisture'][i] === app.viewMode));
  }, 250);

  gameUi.append(hud.root, worksPanel.palette, worksPanel.planBar, inspectPanel.root, groundsPanel.root, clubPanel.root, shopPanel.root, shopOverlay, viewToggle,
    el('div', { class: 'hint-bar', text: 'Drag: pan · Right-drag: rotate · Wheel: zoom · E: Works · G: Grounds · C: Club · P: Pro shop · V: view · Space: pause' }));

  uiRoot.append(menu.root, gameUi);
  requestAnimationFrame(frame);
}

boot();

// Debug/QA hook: lets browser tooling inspect and drive the live app state.
// Harmless in production (read-mostly), invaluable for automated QA.
window.__fw = app;
