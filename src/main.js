// GOLF EMPIRE — application bootstrap: screens, game loop, input routing.
// All simulation lives in src/sim/ (headless-testable); this file wires it to
// the 3D course scene, the DOM UI, and the clock. The unit of play is the
// EMPIRE: one wallet, a property market, and whichever owned club is active.

import { BALANCE } from './sim/balance.js';
import { HOLE_STATUS, TURF_ZONES } from './sim/constants.js';
import {
  newEmpire, buyProperty, sellProperty, switchProperty, activeState,
  empireUpdate, empireSnapshot, deserializeEmpire,
} from './sim/empire.js';
import { addHole, courseDesignRating, holeNumber } from './sim/course.js';
import { formatMoney } from './core/utils.js';
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
import { makeEmpirePanel } from './ui/empirePanel.js';
import { openMarketplace } from './ui/marketplacePanel.js';
import { makeShopScene } from './render3d/shopScene.js';
import { makeObjectivesPanel } from './ui/objectivesPanel.js';
import { makeAudio } from './core/audio.js';
import { tickTutorial, tutorialFlag } from './sim/tutorial.js';
import { makeMenu } from './screens/menu.js';
import { saveData, loadData } from './core/storage.js';
import { conditionRating, sectionTurfSummary, sectionStatus } from './sim/turf.js';
import { makeCourseScene } from './render3d/courseScene.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');

const app = {
  screen: 'menu', // 'menu' | 'game'
  view: 'course', // 'course' | 'shop3d'
  courseMode: 'walk', // 'walk' (first-person, the default) | 'overview' (management rig)
  empire: null, // the whole game: wallet, market, holdings
  empireOpen: false,
  state: null, // the ACTIVE property's club state (== activeState(app.empire))
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
let empirePanel = null;
let shopOverlay = null;
let walkOverlay = null;
let objectivesPanel = null;
let menu = null;
let gameUi = null;

function walkActive() {
  return app.view === 'course' && app.courseMode === 'walk' && app.scene3d && app.scene3d.walk.isActive();
}

function requestLook() {
  try {
    const p = canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {}); // some environments refuse; arrows still steer
  } catch { /* click-to-look covers it */ }
}

// Entering/leaving the first-person course experience (the default). The old
// management rig stays one Tab away — Works still lives there until its
// walkable redesign.
function enterWalk(spawn) {
  app.courseMode = 'walk';
  app.scene3d.walk.enter(spawn);
  walkOverlay.style.display = '';
  const hint = document.querySelector('.hint-bar');
  if (hint) hint.style.display = 'none';
  inspectPanel.hide();
  requestLook();
}

function exitWalk() {
  if (app.scene3d) app.scene3d.walk.exit();
  walkOverlay.style.display = 'none';
  if (app.view === 'course') {
    const hint = document.querySelector('.hint-bar');
    if (hint) hint.style.display = '';
  }
}

const audio = makeAudio();
app.audio = audio;
// WebAudio needs a user gesture; arm it on the first interaction
for (const evt of ['pointerdown', 'keydown']) {
  window.addEventListener(evt, () => audio.init(), { once: true, capture: true });
}

function closeLeftPanels(except) {
  if (except !== 'works' && app.worksMode) handlers.toggleWorks();
  if (except !== 'grounds' && app.groundsOpen) groundsPanel.setVisible(false);
  if (except !== 'club' && app.clubOpen) clubPanel.setVisible(false);
  if (except !== 'shop' && app.shopOpen) shopPanel.setVisible(false);
  if (except !== 'empire' && app.empireOpen) empirePanel.setVisible(false);
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
  // walk-up inspection: the walking controller asks, the app answers with the
  // same sections and status words the top-down click-to-inspect always used
  app.scene3d.walk.hooks.turfLabelAt = (cx, cy) => {
    const section = sectionAtCell(cx, cy);
    if (!section) return null;
    if (TURF_ZONES.has(section.zone) && app.state.turf) {
      return `${section.name} — ${sectionStatus(app.state, section)} — [E] inspect`;
    }
    return `${section.name} — [E] inspect`;
  };
  app.scene3d.walk.hooks.inspectAt = (cx, cy) => {
    const section = sectionAtCell(cx, cy);
    if (!section) return;
    if (document.pointerLockElement) document.exitPointerLock(); // the panel needs the cursor
    inspectPanel.show(section);
  };
  // the hand hose writes into the SAME turf moisture the crew's irrigation
  // reads and writes — one source of truth, no parallel watering system
  app.scene3d.walk.hooks.waterAt = (cx, cy, dtSec) => {
    const st = app.state;
    if (!st || !st.turf) return;
    const w = st.course.w;
    const h = st.course.h;
    const soak = (x, y, frac) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      if (!TURF_ZONES.has(st.course.zones[i])) return; // only turf drinks
      st.turf.moisture[i] = Math.min(100, st.turf.moisture[i] + 30 * frac * dtSec);
    };
    soak(cx, cy, 1); // the nozzle cell, full rate: bone-dry to soaked in ~3 s
    soak(cx + 1, cy, 0.35); // splash on the neighbors
    soak(cx - 1, cy, 0.35);
    soak(cx, cy + 1, 0.35);
    soak(cx, cy - 1, 0.35);
  };
  app.scene3d.walk.hooks.hoseLabelAt = (cx, cy) => {
    const st = app.state;
    const section = sectionAtCell(cx, cy);
    const i = cy * st.course.w + cx;
    if (!section || !TURF_ZONES.has(section.zone) || !st.turf) {
      return '💦 Hose out — aim at turf to water · [F] put it away';
    }
    return `💦 ${section.name} — moisture ${Math.round(st.turf.moisture[i])} — hold the mouse button to water · [F] put away`;
  };
  app.plan = makePlan();
  app.worksMode = false;
  app.activeTool = null;
  app.speedIdx = 1;
  app.viewMode = 'normal';
  app.courseMode = 'walk'; // the course is experienced on foot; Tab for the overview
  if (walkOverlay) walkOverlay.style.display = 'none';
  lastHourSeen = -1;
  endgameShown = !!(state.progression && state.progression.majorWon);
  failShown = false;
  rebuildSectionIndex();
  recomputeRating();
  lastDiseasedNames = currentDiseasedSet(); // prime silently
  if (groundsPanel) groundsPanel.setVisible(false);
  if (worksPanel) worksPanel.setVisible(false);
  menu.setVisible(false);
  gameUi.style.display = '';
  hud.update();
  if (objectivesPanel) objectivesPanel.refresh();
  toast(`Welcome to ${state.clubName} — ${state.mode} mode.`);
  if (lastDiseasedNames.size > 0) {
    toast(`The greenskeeper's note: ${lastDiseasedNames.size} greens are fighting disease. Step outside and click them to diagnose.`, 'warn');
  }
  // home base: the game LIVES in the pro shop — boot straight onto the floor;
  // the course is a mode you deliberately step out into (shop door, E)
  handlers.enterShop();
}

function exitToMenu() {
  app.screen = 'menu';
  app.state = null;
  gameUi.style.display = 'none';
  menu.setVisible(true);
}

// Bring a whole empire to life: boot its active club, or — when nothing is
// owned yet (fresh empire, or the whole portfolio was sold) — open the market.
function bootEmpire(empire) {
  app.empire = empire;
  const st = activeState(empire);
  if (st) {
    startGame(st);
  } else {
    exitToMenu();
    openMarketplace(app, handlers);
  }
}

async function autosave() {
  if (!app.empire) return;
  try {
    await saveData('autosave', empireSnapshot(app.empire));
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
    if (!app.worksMode && walkActive()) {
      toast('Course Works is being redesigned for the walkable course. For now, press Tab for the overview camera and edit from there.', 'warn');
      return;
    }
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
    if (next && app.state) tutorialFlag(app.state, 'groundsOpened');
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
    exitWalk();
    app.view = 'shop3d';
    if (!app.shopScene) {
      app.shopScene = makeShopScene(app.scene3d.renderer, {
        app,
        toast,
        audio,
        exitShop: () => handlers.exitShop(),
      });
    }
    app.shopScene.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
    app.shopScene.enter();
    if (app.state) tutorialFlag(app.state, 'shopWalked');
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
    // stepping out the door puts you ON the course, at the door — the walkable
    // view is the course experience; the overview rig is one Tab away
    if (app.courseMode === 'walk') enterWalk();
  },
  toggleCourseMode() {
    if (app.view !== 'course' || !app.scene3d) return;
    if (app.courseMode === 'walk') {
      app.courseMode = 'overview';
      exitWalk();
      toast('Overview camera — Tab returns you to your feet.');
    } else {
      if (app.worksMode) handlers.toggleWorks(); // plans belong to the overview
      enterWalk('resume');
    }
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

  // --- empire layer -------------------------------------------------------
  toggleEmpire() {
    if (!app.empire) return;
    if (app.view === 'shop3d') handlers.exitShop(); // panels live over the course view
    const next = !app.empireOpen;
    if (next) closeLeftPanels('empire');
    empirePanel.setVisible(next);
  },
  openMarket() {
    openMarketplace(app, handlers);
  },
  // Returns { closeMarket: true } when the purchase boots a club (first buy).
  buyFromMarket(propertyId) {
    const hadActive = !!activeState(app.empire);
    const res = buyProperty(app.empire, propertyId);
    if (!res.ok) {
      toast(res.reason, 'warn');
      return {};
    }
    toast(`Bought ${res.property.name} for ${formatMoney(res.property.askingPrice)}.`);
    if (!hadActive) {
      startGame(activeState(app.empire));
      autosave();
      return { closeMarket: true };
    }
    if (app.empireOpen) empirePanel.refresh();
    hud.update();
    autosave();
    return {};
  },
  switchTo(propertyId) {
    const res = switchProperty(app.empire, propertyId);
    if (!res.ok) {
      toast(res.reason, 'warn');
      return;
    }
    if (res.already) return;
    startGame(activeState(app.empire));
    autosave();
  },
  sellHolding(propertyId, prevSpeed = 1) {
    const empire = app.empire;
    const wasActive = empire.activeId === propertyId;
    const res = sellProperty(empire, propertyId);
    if (!res.ok) {
      toast(res.reason, 'warn');
      app.speedIdx = prevSpeed || 1;
      return;
    }
    toast(`Sold for ${formatMoney(res.payout)}. The deed is done.`);
    if (wasActive) {
      if (empire.holdings.length > 0) {
        switchProperty(empire, empire.holdings[0].property.id);
        startGame(activeState(empire));
        toast(`The office moves to ${activeState(empire).clubName}.`);
      } else {
        // sold the whole portfolio — back to the market with a full wallet
        autosave();
        exitToMenu();
        openMarketplace(app, handlers);
        return;
      }
    } else {
      app.speedIdx = prevSpeed || 1;
      if (app.empireOpen) empirePanel.refresh();
      hud.update();
    }
    autosave();
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
      el('div', { class: 'row' }, el('button', { class: 'primary', text: app.view === 'shop3d' ? 'Back to the shop' : 'Back to the course', onclick: () => { app.speedIdx = prevSpeed || 1; close(); } })),
      el('div', { class: 'row' }, el('button', {
        text: '🏢 Empire overview',
        onclick: () => {
          close();
          app.speedIdx = prevSpeed || 1;
          handlers.toggleEmpire();
        },
      })),
      el('h2', { text: 'Save', style: 'margin-top:14px;font-size:1rem' }),
      el('div', { class: 'row' }, ...SLOTS.map((slot, i) =>
        el('button', {
          text: `Save slot ${i + 1}`,
          onclick: closeAnd(async () => {
            await saveData(slot, empireSnapshot(app.empire));
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
            bootEmpire(deserializeEmpire(data));
          }),
        }),
      )),
      el('h2', { text: 'Sound', style: 'margin-top:8px;font-size:1rem' }),
      el('div', { class: 'row' },
        el('input', {
          type: 'range', min: '0', max: '1', step: '0.05', value: String(audio.getVolume()), style: 'flex:1',
          oninput: (e) => audio.setVolume(Number(e.target.value)),
        }),
        el('button', {
          text: audio.isMuted() ? '🔇 Unmute' : '🔊 Mute',
          onclick: (e) => {
            audio.setMuted(!audio.isMuted());
            e.target.textContent = audio.isMuted() ? '🔇 Unmute' : '🔊 Mute';
          },
        }),
      ),
      el('h2', { text: 'Difficulty', style: 'margin-top:8px;font-size:1rem' }),
      el('div', { class: 'row' },
        el('button', {
          text: app.state.mode === 'relaxed' ? '✔ Relaxed' : 'Relaxed',
          onclick: () => {
            app.state.mode = 'relaxed';
            toast('Relaxed mode: gentler turf, softer finances, the bank forgives.');
            close();
            app.speedIdx = prevSpeed || 1;
          },
        }),
        el('button', {
          text: app.state.mode === 'realistic' ? '✔ Realistic' : 'Realistic',
          onclick: () => {
            app.state.mode = 'realistic';
            toast('Realistic mode: real stakes. Watch the books.', 'warn');
            close();
            app.speedIdx = prevSpeed || 1;
          },
        }),
      ),
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
  // first-person views (shop, walkable course): clicking (re)captures the mouse
  if (app.screen === 'game' && !document.pointerLockElement
    && (app.view === 'shop3d' || walkActive())) {
    requestLook();
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (app.screen !== 'game' || app.view !== 'course') return;
  if (app.courseMode !== 'overview') {
    // walking with the hose out: the held button is the spray trigger
    if (e.button === 0 && walkActive() && app.scene3d.walk.getTool() === 'hose') {
      app.scene3d.walk.setSpraying(true);
    }
    return;
  }
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
  if (app.screen !== 'game' || app.view !== 'course' || app.courseMode !== 'overview') return;
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

window.addEventListener('pointerup', () => {
  if (walkActive() && app.scene3d.walk.isSpraying()) app.scene3d.walk.setSpraying(false);
});

canvas.addEventListener('pointerup', () => {
  if (app.screen !== 'game' || app.view !== 'course' || app.courseMode !== 'overview' || !dragging) return;
  if (dragging.mode === 'pan-or-click' && dragging.moved <= 6 && dragging.cell) {
    const section = sectionAtCell(dragging.cell.x, dragging.cell.y);
    if (section) inspectPanel.show(section);
    else inspectPanel.hide();
  }
  dragging = null;
});

canvas.addEventListener('wheel', (e) => {
  if (app.screen !== 'game' || app.view !== 'course' || app.courseMode !== 'overview') return;
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
        handlers.exitShop(); // quick toggle out to the course
        break;
      case 'Escape':
        // first Esc releases the pointer (browser); a second one opens the
        // office menu — the shop is home, Esc doesn't leave it
        if (!document.pointerLockElement) openPauseMenu();
        break;
    }
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault(); // Tab is the camera toggle, not DOM focus
    handlers.toggleCourseMode();
    return;
  }

  if (walkActive()) {
    // first-person course: E is the interaction verb (shop convention)
    switch (e.key) {
      case 'e': case 'E':
        if (app.scene3d.walk.interact) app.scene3d.walk.interact();
        break;
      case 'f': case 'F': {
        const walkApi = app.scene3d.walk;
        if (!walkApi.cart.mounted) walkApi.setTool(walkApi.getTool() === 'hose' ? null : 'hose');
        break;
      }
      case 'g': case 'G':
        if (document.pointerLockElement) document.exitPointerLock(); // free the cursor for the panel
        handlers.toggleGrounds();
        break;
      case 'c': case 'C':
        if (document.pointerLockElement) document.exitPointerLock();
        handlers.toggleClub();
        break;
      case 'm': case 'M':
        if (document.pointerLockElement) document.exitPointerLock();
        handlers.toggleEmpire();
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
        // first Esc releases the pointer (browser); the next opens the office
        if (app.selectedSection) inspectPanel.hide();
        else if (app.groundsOpen || app.clubOpen || app.shopOpen || app.empireOpen) closeLeftPanels('none');
        else if (!document.pointerLockElement) openPauseMenu();
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
    case 'm': case 'M':
      handlers.toggleEmpire();
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
      } else if (app.groundsOpen || app.clubOpen || app.shopOpen) {
        closeLeftPanels('none');
      } else {
        // leaving the overview returns to your feet on the course
        handlers.toggleCourseMode();
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
  if (app.screen !== 'game' || app.view !== 'course' || app.courseMode !== 'overview' || !app.scene3d) return;
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
let audioClock = 0;

function frame(ts) {
  const dtMs = Math.min(250, ts - lastTs || 16);
  lastTs = ts;

  if (app.screen === 'game' && app.state && app.scene3d) {
    keyboardCamera(dtMs);
    const speed = BALANCE.speeds[app.speedIdx];
    if (speed > 0) {
      const gameMinutes = (dtMs / 1000) * BALANCE.gameMinutesPerRealSecond * speed;
      const { daysPassed } = empireUpdate(app.empire, gameMinutes);
      if (daysPassed > 0) {
        rebuildSectionIndex();
        worksPanel.refreshHoles();
        app.scene3d.updateHoles();
        announceReopenings();
        announceOutbreaks();
        checkBigMoments();
        if (app.clubOpen) clubPanel.refresh();
        if (app.empireOpen) empirePanel.refresh();
        if (app.marketRefresh) app.marketRefresh(); // market left open stays live
        autosave();
      }
      const hourNow = Math.floor(app.state.clock.minutes / 60);
      if (hourNow !== lastHourSeen) {
        lastHourSeen = hourNow;
        app.scene3d.updateTurf(app.state);
        recomputeRating();
        inspectPanel.refreshIfOpen();
        if (app.groundsOpen) groundsPanel.refresh();
        const tut = tickTutorial(app.state);
        for (const step of tut.advanced) toast(`🎯 ${step.title} — done.`);
        if (app.state.tutorial && app.state.tutorial.complete && tut.advanced.length) {
          toast('The guide retires — the club is yours now. The Open awaits.', '');
        }
        objectivesPanel.refresh();
      }
    }
    if (app.view === 'shop3d' && app.shopScene) {
      app.shopScene.update(dtMs);
      app.shopScene.render();
      updateShopOverlay();
    } else {
      if (walkActive()) {
        app.scene3d.walk.update(dtMs);
        updateWalkOverlay();
      }
      const cal = calendarOf(app.state.clock.minutes);
      app.scene3d.applyTimeWeather(cal.minuteOfDay, app.state.weather);
      app.scene3d.render(dtMs, app.state);
    }
    audioClock += dtMs;
    if (audioClock >= 1000) {
      const cal2 = calendarOf(app.state.clock.minutes);
      audio.update(audioClock / 1000, {
        minuteOfDay: cal2.minuteOfDay,
        rainIn: app.state.weather.today.rainIn,
        golfersVisible: cal2.minuteOfDay >= 360 && cal2.minuteOfDay <= 1200 ? (app.state.club.lastRounds || 0) : 0,
        inShop: app.view === 'shop3d',
        tempHiF: app.state.weather.today.tempHiF,
      });
      audioClock = 0;
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

function updateWalkOverlay() {
  const prompt = walkOverlay.querySelector('.shop-prompt');
  const label = app.scene3d.walk.getFocusLabel ? app.scene3d.walk.getFocusLabel() : null;
  prompt.textContent = label || '';
  prompt.style.opacity = label ? '1' : '0';
  const lockHint = walkOverlay.querySelector('.shop-lockhint');
  lockHint.style.display = document.pointerLockElement ? 'none' : '';
}

// one-shot endgame + failure modals
let endgameShown = false;
let failShown = false;

function checkBigMoments() {
  const st = app.state;
  if (!st) return;
  if (st.progression && st.progression.majorWon && !endgameShown) {
    endgameShown = true;
    app.speedIdx = 0;
    modal('🏆 THE WILLOW CREEK OPEN', (box, close) => {
      box.append(
        el('div', { class: 'row', style: 'font-size:1.05rem;line-height:1.5' },
          'You did it. The muni nobody wanted became the club everyone talks about — and today it hosted a major. ' +
          'The greens rolled true, the members watched from the clubhouse they helped build, and the write-ups are glowing.'),
        el('div', { class: 'row muted' }, 'The club keeps running — there is always another season. Thanks for building it.'),
        el('div', { class: 'row', style: 'margin-top:12px' },
          el('button', { class: 'primary', text: 'Back to the course', onclick: () => { app.speedIdx = 1; close(); } })),
      );
    });
  }
  if (st.failed && !failShown) {
    failShown = true;
    app.speedIdx = 0;
    modal('The bank has called', (box, close) => {
      box.append(
        el('div', { class: 'row', style: 'line-height:1.5' }, st.failed.reason),
        el('div', { class: 'row muted' }, 'Load a save to try that stretch again, or head back to the menu.'),
        el('div', { class: 'row', style: 'margin-top:12px' },
          el('button', {
            class: 'primary', text: 'Load autosave',
            onclick: async () => {
              const data = await loadData('autosave');
              close();
              failShown = false;
              if (data) bootEmpire(deserializeEmpire(data));
            },
          }),
          el('button', { class: 'danger', text: 'Exit to menu', onclick: () => { close(); exitToMenu(); } }),
        ),
      );
    });
  }
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
      // a new empire starts in the property market — the first act is judgment
      app.empire = newEmpire(mode, (Math.random() * 2 ** 31) | 0);
      autosave();
      openMarketplace(app, handlers);
    },
    async onContinue() {
      const data = await loadData('autosave');
      if (data) bootEmpire(deserializeEmpire(data));
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
  empirePanel = makeEmpirePanel(app, handlers);
  objectivesPanel = makeObjectivesPanel(app);

  shopOverlay = el('div', { class: 'shop-overlay', style: 'display:none' },
    el('div', { class: 'shop-crosshair' }),
    el('div', { class: 'shop-prompt', text: '' }),
    el('div', { class: 'shop-lockhint', text: 'Click to look around · WASD move · E interact · P: course · Esc: office menu' }),
    el('button', { class: 'shop-leave', text: '⛳ Out to the course (P)', onclick: () => handlers.exitShop() }),
  );

  walkOverlay = el('div', { class: 'shop-overlay', style: 'display:none' },
    el('div', { class: 'shop-crosshair' }),
    el('div', { class: 'shop-prompt', text: '' }),
    el('div', { class: 'shop-lockhint', text: 'Click to look around · WASD walk · Shift run · E interact · F hose · Tab: overview camera · P: shop · Esc: office menu' }),
    el('button', { class: 'shop-leave', text: '🏪 Back to the shop (P)', onclick: () => handlers.enterShop() }),
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

  gameUi.append(hud.root, worksPanel.palette, worksPanel.planBar, inspectPanel.root, groundsPanel.root, clubPanel.root, shopPanel.root, empirePanel.root, shopOverlay, walkOverlay, objectivesPanel.root, viewToggle,
    el('div', { class: 'hint-bar', text: 'Drag: pan · Right-drag: rotate · Wheel: zoom · E: Works · G: Grounds · C: Club · M: Empire · V: view · Space: pause · Esc/P: back to shop' }));

  uiRoot.append(menu.root, gameUi);
  requestAnimationFrame(frame);
}

boot();

// Debug/QA hook: lets browser tooling inspect and drive the live app state.
// Harmless in production (read-mostly), invaluable for automated QA.
window.__fw = app;
