// GOLF EMPIRE — application bootstrap: screens, game loop, input routing.
// All simulation lives in src/sim/ (headless-testable); this file wires it to
// the 3D course scene, the DOM UI, and the clock. The unit of play is the
// EMPIRE: one wallet, a property market, and whichever owned club is active.

import { BALANCE } from './sim/balance.js';
import { HOLE_STATUS, TURF_ZONES, ZONE } from './sim/constants.js';
import {
  EMPIRE_VERSION, newEmpire, buyProperty, confirmPropertySale, switchProperty, activeState,
  empireUpdate, empireSnapshot, deserializeEmpire,
} from './sim/empire.js';
import { SAVE_VERSION } from './sim/state.js';
import { addHole, courseDesignRating, holeNumber } from './sim/course.js';
import { formatMoney } from './core/utils.js';
import { createHeldKeys, overviewCameraDelta, OVERVIEW_KEYS } from './core/heldKeys.js';
import {
  makePlan, planPaintZone, planAdjustElev, planSmoothElev, applyPlan,
  worksSetTee, worksSetPin,
} from './sim/terrainEdit.js';
import { calendarOf } from './sim/time.js';
import { ensureReservationHorizon } from './sim/reservations.js';
import {
  clearNotifications, confirmDialog, containFocus, el, modal, notify, setPromptText, toast,
} from './ui/ui.js';
import { makeHud } from './ui/hud.js';
import { makeWorksPanel } from './ui/worksPanel.js';
import { makeInspectPanel } from './ui/inspectPanel.js';
import { makeGroundsPanel } from './ui/groundsPanel.js';
import { makeClubPanel } from './ui/clubPanel.js';
import { makeEmpirePanel } from './ui/empirePanel.js';
import { openMarketplace } from './ui/marketplacePanel.js';
import { makeObjectivesPanel } from './ui/objectivesPanel.js';
import { makeCourseMaintenancePanel } from './ui/courseMaintenancePanel.js';
import { makeLaptop } from './ui/laptop.js';
import { makeFrontDesk } from './ui/frontDesk.js';
import { makeSettingsPanel } from './ui/settingsPanel.js';
import { makeToolWheel } from './ui/toolWheel.js';
import { quadTransform, uvAt } from './core/laptopProjection.js';
import { makeAudio } from './core/audio.js';
import {
  tickTutorial, tutorialFlag, skipTutorial, replayTutorial, triggerContextTutorial,
} from './sim/tutorial.js';
import { makeMenu } from './screens/menu.js';
import { inspectData, saveData, summarizeSave } from './core/storage.js';
import { applyDocumentPreferences, makePreferences } from './core/preferences.js';
import { conditionRating, sectionTurfSummary, sectionStatus } from './sim/turf.js';
import { shopCondition, vacuumOwned, tickDeliveries } from './sim/shop.js';
import {
  changeDue as registerChangeDue,
  handTotal as registerHandTotal,
  unscannedCount as registerUnscannedCount,
} from './sim/register.js';
import { ownedWasher } from './sim/washing.js';
import { skuById } from './data/shopItems.js';
import { makeCourseScene } from './render3d/courseScene.js';
import {
  applyDivotMix,
  applyFungicideCourseMaintenancePath,
  clearCourseMaintenanceDebris,
  fertilizeCourseMaintenancePath,
  finalizeCourseMaintenanceAction,
  flagCourseMaintenanceDisease,
  inspectCourseMaintenanceAt,
  irrigateCourseMaintenancePath,
  maintenanceCellReport,
  maintenanceIndexAtWorld,
  manageCourseMaintenanceIrrigationHead,
  markCourseMaintenanceRouteStep,
  mowCourseMaintenancePath,
  nearestCourseMaintenanceIssue,
  rakeCourseMaintenancePath,
  repairBallMark,
  selectCourseMaintenanceEquipment,
  toggleCourseInspection,
  levelDivot,
} from './sim/courseMaintenance.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const preferences = makePreferences();
applyDocumentPreferences(preferences.values);

const app = {
  screen: 'menu', // 'menu' | 'game'
  view: 'course', // one continuous world — the shop is a building you walk into
  courseMode: 'walk', // 'walk' (first-person, the default) | 'overview' (management rig)
  empire: null, // the whole game: wallet, market, holdings
  empireOpen: false,
  state: null, // the ACTIVE property's club state (== activeState(app.empire))
  scene3d: null,
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
  frontDeskOpen: false,
  sectionIndex: null,
  sectionsRef: null,
  preferences,
};

let hud = null;
let worksPanel = null;
let inspectPanel = null;
let groundsPanel = null;
let clubPanel = null;
let empirePanel = null;
let walkOverlay = null;
let walkPrompt = null;
let walkLockHint = null;
let walkCondition = null;
let regHint = null;
let laptopUi = null;
let frontDeskUi = null;
let objectivesPanel = null;
let maintenancePanel = null;
let menu = null;
let gameUi = null;
let toolWheel = null;
let viewButtons = [];

function walkActive() {
  return app.view === 'course' && app.courseMode === 'walk' && app.scene3d && app.scene3d.walk.isActive();
}

function presentationMode() {
  if (isPauseOpen()) return 'pause';
  if (toolWheel?.isOpen()) return 'tool-wheel';
  if (app.frontDeskOpen) return 'front-desk';
  if (regActive()) return 'register';
  if (app.laptopOpen) return 'laptop';
  const build = buildApi();
  if (build?.isActive()) return 'placement';
  if (app.worksMode) return 'course-editor';
  if (app.courseMode === 'overview') return 'overview';
  return 'walk';
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
let yardHintShown = false; // one nudge per session toward the earned-tractor arc

function enterWalk(spawn) {
  if (app.scene3d && app.scene3d.post && app.scene3d.post.gtao) app.scene3d.post.gtao.radius = 0.7; // first-person contact shadows
  if (!yardHintShown && app.state && app.state.tractor && !app.state.tractor.repaired) {
    yardHintShown = true;
    setTimeout(() => toast('The old tractor sits by the shed, east of the porch — she’d run again with some work.'), 1200);
  }
  app.courseMode = 'walk';
  app.scene3d.walk.enter(spawn);
  walkOverlay.style.display = '';
  const hint = document.querySelector('.hint-bar');
  if (hint) hint.style.display = 'none';
  inspectPanel.hide();
  requestLook();
}

function exitWalk() {
  if (app.frontDeskOpen) exitFrontDesk(true);
  if (app.laptopOpen) exitLaptop(true);
  if (app.scene3d && app.scene3d.post && app.scene3d.post.gtao) app.scene3d.post.gtao.radius = 1.5; // management-camera tuning
  if (app.scene3d) app.scene3d.walk.exit();
  walkOverlay.style.display = 'none';
  if (app.view === 'course') {
    const hint = document.querySelector('.hint-bar');
    if (hint) hint.style.display = '';
  }
}

// --- laptop mode --------------------------------------------------------------
// The real sequence: E parks you at the chair, the lid physically opens, the
// power light + boot play on the 3D screen, and THEN the Fairway Office DOM is
// projected onto that physical screen — the interface lives inside the bezel,
// never in a detached popup. The projection maps the interface rectangle onto
// the screen's four projected corners with a CSS matrix3d (recomputed on
// resize; the focus camera is parked, so it's stable).

// The interface's own pixel grid. 16:10, exactly like the physical panel it lands on — let the
// two disagree and every glyph is quietly stretched.
const LAPTOP_UI_W = 1024;
const LAPTOP_UI_H = 640;

// THE INTERFACE IS WELDED TO THE GLASS.
//
// This used to run twice, on setTimeout, while the camera was still easing into the seat and the
// lid was still swinging — so the transform always described where the screen HAD been. Measured
// in the browser: force one extra alignment and the DOM's box became exactly the live quad from
// the previous probe. Permanently one alignment behind, which crumpled the whole interface into
// a skewed trapezoid in the corner of the lid and left the canvas desktop showing around it.
// That one bug produced most of the brief's complaints at once: "screen too far away",
// "difficult to read", "feels like a popup", "cursor interaction is weak".
//
// So it runs EVERY FRAME now. Four projections and a 3x3 solve is nothing, and a transform that
// is never cached can never be stale. The interface now rides the lid as it opens.
let laptopQuad = null; // the live screen quad, in CSS px — also what the mouse ray is tested against

function laptopScreenQuad() {
  const ch = app.scene3d && app.scene3d.clubhouse && app.scene3d.clubhouse();
  if (!ch || !ch.laptopScreenCorners) return null;
  const corners = ch.laptopScreenCorners(); // already [tl, tr, br, bl] — the lid's frame knows
  if (!corners) return null;
  const cam = app.scene3d.camera;
  if (!cam) return null;
  cam.updateMatrixWorld();
  const rect = document.getElementById('game').getBoundingClientRect();
  return corners.map((v) => {
    const p = v.clone().project(cam);
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  });
}

function alignLaptopUi() {
  const quad = laptopScreenQuad();
  if (!quad) return false;
  laptopQuad = quad;
  // On the first frames the lid is still shut, so the glass is edge-on and the quad is
  // degenerate. quadTransform returns null rather than a matrix full of NaN — a NaN here would
  // poison the DOM's transform for the rest of the session and nothing would ever put it right.
  const m = quadTransform(LAPTOP_UI_W, LAPTOP_UI_H, quad);
  if (!m) return false;
  laptopUi.setTransform(m);
  return true;
}

let laptopResizeHandler = null;
let laptopTimers = [];
let laptopHiddenUi = null;

function setLaptopBackdropHidden(hidden) {
  gameUi?.classList.toggle('laptop-mode', hidden);
  const roots = [hud?.root, objectivesPanel?.root].filter(Boolean);
  if (hidden) {
    laptopHiddenUi = roots.map((root) => ({ root, display: root.style.display }));
    for (const { root } of laptopHiddenUi) root.style.display = 'none';
    return;
  }
  for (const item of laptopHiddenUi || []) item.root.style.display = item.display;
  laptopHiddenUi = null;
}

// build mode, if the clubhouse is up
function buildApi() {
  const ch = app.scene3d && app.scene3d.clubhouse && app.scene3d.clubhouse();
  return ch ? ch.build : null;
}

function seatPose(ch) {
  // the seat is fitted to the live camera, so the screen fills the view at any FOV or window shape
  const cam = app.scene3d && app.scene3d.camera;
  return ch.laptopPose(cam ? cam.fov : 60, cam ? cam.aspect : 16 / 9);
}

// SITTING DOWN IS A LENS CHANGE.
//
// Walk mode runs a 66-degree field of view — wide, because you are moving through a room. To
// fill 80% of the frame with a 15-inch panel through a 66-degree lens you have to sit 0.22 yd
// from it, and at 0.22 yd the keyboard is a foot from your eye: the keycaps come out enormous,
// the deck swallows the bottom third of the screen, and the top bezel clips off. The picture is
// *correct* and looks *wrong* — the same reason nobody shoots a portrait on a wide angle.
//
// So the seated camera gets a longer lens. At 34 degrees the same 80% coverage puts the eye
// 0.46 yd back — about 17 inches, which is where a person's face actually is when they read a
// laptop. The perspective flattens out, the keyboard settles, and the bezel stays in frame.
const WALK_NEAR = 0.15;
const LAPTOP_NEAR = 0.03;
const LAPTOP_FOV = 34;
const walkFov = () => preferences.values.camera.fov;
function setCameraLens(fov, near) {
  const cam = app.scene3d && app.scene3d.camera;
  if (!cam || (cam.fov === fov && cam.near === near)) return;
  cam.fov = fov;
  cam.near = near;
  cam.updateProjectionMatrix();
}

function enterLaptop() {
  if (!walkActive() || app.laptopOpen || app.frontDeskOpen) return;
  const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
  if (!ch) return;
  // The lens FIRST: the seat distance is derived from the field of view, so asking for the pose
  // before the lens has changed would seat you for a camera that no longer exists.
  setCameraLens(LAPTOP_FOV, LAPTOP_NEAR);
  const pose = seatPose(ch);
  if (!pose) { setCameraLens(walkFov(), WALK_NEAR); return; }
  app.laptopOpen = true;
  document.body.classList.add('laptop-mode');
  resetCameraInput(); // sitting down is a mode change too
  if (app.state) tutorialFlag(app.state, 'laptopOpened');
  app.scene3d.walk.focusOn(pose);
  if (document.pointerLockElement) document.exitPointerLock();
  closeLeftPanels('none');
  walkOverlay.style.display = 'none';
  setLaptopBackdropHidden(true);
  // the physical sequence: lid swings → power light → boot → interface lands on the glass
  if (ch.laptopLid) ch.laptopLid(true);
  if (audio.ready) audio.laptopOpen();
  laptopTimers.push(setTimeout(() => {
    if (!app.laptopOpen) return;
    if (ch.laptopBoot) ch.laptopBoot();
    if (audio.ready) audio.laptopBoot();
  }, 420));
  laptopTimers.push(setTimeout(() => {
    if (!app.laptopOpen) return;
    // 'live': the canvas becomes a flat sheet of the interface's own paper colour. It used to
    // paint a whole rival DESKTOP here — tiles and all — which stayed visible around the
    // misaligned DOM. Two interfaces on one screen is what made it read as a popup.
    if (ch.laptopScreen) ch.laptopScreen('live');
    laptopUi.open();
    alignLaptopUi(); // and from here the frame loop keeps it welded on, every frame
  }, 1350));
  laptopResizeHandler = () => {
    if (!app.laptopOpen) return;
    // the window changed shape: re-seat (the fit depends on aspect). The projection itself
    // catches up on the very next frame without being told.
    const c = app.scene3d.clubhouse && app.scene3d.clubhouse();
    if (c) app.scene3d.walk.focusOn(seatPose(c));
  };
  window.addEventListener('resize', laptopResizeHandler);
  const vt = document.querySelector('.view-toggle'); // the layer chips sit right across the lid
  if (vt) vt.style.display = 'none';
}

function exitLaptop(silent) {
  if (!app.laptopOpen) return;
  app.laptopOpen = false;
  document.body.classList.remove('laptop-mode');
  for (const t of laptopTimers) clearTimeout(t);
  laptopTimers = [];
  if (laptopResizeHandler) {
    window.removeEventListener('resize', laptopResizeHandler);
    laptopResizeHandler = null;
  }
  laptopUi.close();
  setLaptopBackdropHidden(false);
  laptopQuad = null;
  const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
  if (ch && ch.laptopScreen) ch.laptopScreen('desk'); // lid stays open, showing the lock screen
  app.scene3d.walk.clearFocus();
  setCameraLens(walkFov(), WALK_NEAR); // hand the player's lens back before standing up
  const vt = document.querySelector('.view-toggle');
  if (vt) vt.style.display = '';
  if (!silent) {
    walkOverlay.style.display = '';
    requestLook();
    if (audio.ready) audio.uiTick();
  }
}

// --- tee desk mode ------------------------------------------------------------
// The same physical counter serves golf operations and merchandise, but the
// workflows remain independent. This mode borrows only the proven cashier pose;
// it never enters registerMode or touches its live sale.
function enterFrontDesk(reservationId = null) {
  if (!walkActive() || app.frontDeskOpen || app.laptopOpen || regActive()) return;
  const ch = app.scene3d?.clubhouse?.();
  const pose = ch?.register?.cashierPose?.();
  if (!pose || !frontDeskUi) return;
  app.frontDeskOpen = true;
  resetCameraInput();
  app.scene3d.walk.focusOn(pose);
  if (document.pointerLockElement) document.exitPointerLock();
  closeLeftPanels('none');
  walkOverlay.style.display = 'none';
  const viewToggle = document.querySelector('.view-toggle');
  if (viewToggle) viewToggle.style.display = 'none';
  document.body.classList.add('front-desk-mode');
  frontDeskUi.open(reservationId);
  if (audio.ready) audio.uiTick();
}

function exitFrontDesk(silent = false) {
  if (!app.frontDeskOpen) return;
  app.frontDeskOpen = false;
  frontDeskUi?.close();
  document.body.classList.remove('front-desk-mode');
  app.scene3d?.walk?.clearFocus?.();
  const viewToggle = document.querySelector('.view-toggle');
  if (viewToggle) viewToggle.style.display = '';
  resetCameraInput();
  if (!silent && walkActive()) {
    walkOverlay.style.display = '';
    requestLook();
    if (audio.ready) audio.uiTick();
  }
}

const audio = makeAudio(preferences);
app.audio = audio;
const TOOL_AUDIO_LOOP = {
  fungicide: 'hose',
  spreader: 'divot',
  ballmark: 'divot',
  debris: 'rake',
  greensMower: 'mower',
};
// WebAudio needs a user gesture; arm it on the first interaction
for (const evt of ['pointerdown', 'keydown']) {
  window.addEventListener(evt, () => audio.init(), { once: true, capture: true });
}
document.addEventListener('visibilitychange', () => audio.setLifecycleActive(!document.hidden));
window.addEventListener('pagehide', () => audio.setLifecycleActive(false));

function closeLeftPanels(except) {
  if (except !== 'works' && app.worksMode) handlers.toggleWorks();
  if (except !== 'grounds' && app.groundsOpen) groundsPanel.setVisible(false);
  if (except !== 'club' && app.clubOpen) clubPanel.setVisible(false);
  if (except !== 'empire' && app.empireOpen) empirePanel.setVisible(false);
}

const MAINTENANCE_EQUIPMENT_FOR_TOOL = {
  hose: 'hose',
  divot: 'divotKit',
  ballmark: 'ballMarkFork',
  rake: 'bunkerRake',
  debris: 'debrisBag',
  fungicide: 'hose',
  spreader: 'spreader',
  greensMower: 'greensMower',
};

function setMaintenanceVisible(next) {
  if (!maintenancePanel || !app.state?.courseMaintenance) return;
  toggleCourseInspection(app.state, !!next);
  maintenancePanel.setVisible(!!next);
  if (app.scene3d) app.scene3d.updateCourseMaintenance(app.state, true);
  if (next && document.pointerLockElement) document.exitPointerLock();
}

function selectMaintenanceTool(tool) {
  selectWalkTool(tool);
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
  closePauseMenu({ resume: false }); // any pause overlay dies with the old world
  if (app.frontDeskOpen) exitFrontDesk(true);
  toolWheel?.close('scene-change');
  clearNotifications();
  if (app.scene3d) {
    app.scene3d.dispose();
    app.scene3d = null;
  }
  app.state = state;
  // Starting, loading, or switching into a club must always expose the same
  // deterministic forward booking window. Existing days are idempotently left alone.
  ensureReservationHorizon(app.state);
  app.screen = 'game';
  app.scene3d = makeCourseScene(canvas, state);
  // walk-up inspection: the walking controller asks, the app answers with the
  // same sections and status words the top-down click-to-inspect always used
  app.scene3d.walk.hooks.toast = (msg, kind) => toast(msg, kind);
  app.scene3d.walk.hooks.tutorial = (flag) => tutorialFlag(app.state, flag);
  // a restrained note when the game had to dig the player out of geometry
  app.scene3d.walk.hooks.recovered = (how) => toast(
    how === 'lastSafe' ? 'Stepped you back to where you last had room.' : 'Moved you clear of the furniture.',
  );
  app.scene3d.walk.hooks.sfx = (name) => { if (audio.ready && audio[name]) audio[name](); };
  // the clubhouse's in-world management surfaces route through these
  app.scene3d.walk.hooks.openLaptop = () => enterLaptop();
  app.scene3d.walk.hooks.openFrontDesk = (reservationId) => enterFrontDesk(reservationId);
  app.scene3d.walk.hooks.toggleOverview = () => handlers.toggleCourseMode();
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
    tutorialFlag(st, 'maintenanceUsed');
  };
  app.scene3d.walk.hooks.hoseLabelAt = (cx, cy) => {
    const st = app.state;
    const section = sectionAtCell(cx, cy);
    const i = cy * st.course.w + cx;
    if (!section || !TURF_ZONES.has(section.zone) || !st.turf) {
      return '💦 Hose out — aim at turf to water · [F] next tool';
    }
    return `💦 ${section.name} — moisture ${Math.round(st.turf.moisture[i])} — hold the mouse button to water · [F] next tool`;
  };
  // the divot kit patches traffic wear on turf — same wear array the crew's
  // aeration relieves; the olive-tan wear tint clears as you work
  app.scene3d.walk.hooks.repairAt = (cx, cy, dtSec) => {
    const st = app.state;
    if (!st || !st.turf) return;
    const section = sectionAtCell(cx, cy);
    if (!section || !TURF_ZONES.has(section.zone)) return;
    const i = cy * st.course.w + cx;
    const before = st.turf.wear[i];
    st.turf.wear[i] = Math.max(0, before - 45 * dtSec);
    if (st.turf.wear[i] < before) tutorialFlag(st, 'maintenanceUsed');
    // the completion moment: this patch just came smooth
    if (before > 1 && st.turf.wear[i] <= 0.01 && audio.ready) audio.chime();
  };
  app.scene3d.walk.hooks.divotLabelAt = (cx, cy) => {
    const st = app.state;
    const section = sectionAtCell(cx, cy);
    const i = cy * st.course.w + cx;
    if (!section || !TURF_ZONES.has(section.zone) || !st.turf) {
      return '⛏ Divot kit out — aim at worn turf · [F] next tool';
    }
    const w = Math.round(st.turf.wear[i]);
    return w <= 1
      ? `⛏ ${section.name} — smooth, no divots here · [F] next tool`
      : `⛏ ${section.name} — divot wear ${w} — hold the mouse button to patch`;
  };
  // the bunker rake smooths footprinted sand (wear on BUNKER cells, fed by
  // daily play traffic via sim/bunkers.js)
  app.scene3d.walk.hooks.rakeAt = (cx, cy, dtSec) => {
    const st = app.state;
    if (!st || !st.turf) return;
    // a rake sweeps: full strength on the aimed patch, half on adjoining sand
    const sweep = (x, y, frac) => {
      if (x < 0 || y < 0 || x >= st.course.w || y >= st.course.h) return;
      const i = y * st.course.w + x;
      if (st.course.zones[i] !== ZONE.BUNKER) return;
      const before = st.turf.wear[i];
      st.turf.wear[i] = Math.max(0, before - 55 * dtSec * frac);
      if (frac === 1 && st.turf.wear[i] < before) tutorialFlag(st, 'maintenanceUsed');
      if (frac === 1 && before > 1 && st.turf.wear[i] <= 0.01 && audio.ready) audio.chime();
    };
    sweep(cx, cy, 1);
    sweep(cx + 1, cy, 0.5);
    sweep(cx - 1, cy, 0.5);
    sweep(cx, cy + 1, 0.5);
    sweep(cx, cy - 1, 0.5);
  };
  // the hitched mower deck cuts for real: driving over turf writes heightMm to
  // the zone's ideal — the SAME array the crew's morning mow writes, so stripes
  // appear, growth continues from the cut, and the books stay honest (your
  // seat time is free labor, like hand-watering)
  const MOW_TARGET = {
    [ZONE.GREEN]: BALANCE.turf.ideal.green.height,
    [ZONE.TEE]: BALANCE.turf.ideal.tee.height,
    [ZONE.FAIRWAY]: BALANCE.turf.ideal.fairway.height,
    [ZONE.ROUGH]: BALANCE.turf.ideal.rough.height,
  };
  app.scene3d.walk.hooks.mowAt = (cx, cy) => {
    const st = app.state;
    if (!st || !st.turf) return false;
    const i = cy * st.course.w + cx;
    const target = MOW_TARGET[st.course.zones[i]];
    if (target === undefined || st.turf.heightMm[i] <= target + 0.5) return false;
    st.turf.heightMm[i] = target;
    return true;
  };
  app.scene3d.walk.hooks.engine = (on) => { if (audio.ready) audio.setToolLoop(on ? 'mower' : null); };
  app.scene3d.walk.hooks.rakeLabelAt = (cx, cy) => {
    const st = app.state;
    const i = cy * st.course.w + cx;
    if (!st.turf || st.course.zones[i] !== ZONE.BUNKER) {
      return '🧹 Bunker rake out — aim at sand · [F] next tool';
    }
    const w = Math.round(st.turf.wear[i]);
    return w <= 1
      ? '🧹 This sand is raked smooth · [F] next tool'
      : `🧹 Bunker — footprints ${w} — hold the mouse button to rake`;
  };

  // Hole 4's one-yard model takes over whenever the exact aim point falls in
  // its data-selected region. The established eight-yard hooks above remain a
  // safe fallback everywhere else on the course.
  const heroPoint = (cx, cy, wx, wz) => ({
    x: Number.isFinite(wx) ? wx : (cx + 0.5) * 8 - state.course.w * 4,
    z: Number.isFinite(wz) ? wz : (cy + 0.5) * 8 - state.course.h * 4,
  });
  const heroReportAt = (cx, cy, wx, wz) => {
    const point = heroPoint(cx, cy, wx, wz);
    const model = app.state.courseMaintenance;
    const index = model ? maintenanceIndexAtWorld(model, point.x, point.z) : -1;
    return index >= 0 ? { point, index, report: maintenanceCellReport(model, index) } : null;
  };
  const nearestOpen = (collection, point, radius = 2.6) => (
    nearestCourseMaintenanceIssue(app.state, collection, point.x, point.z, radius)
  );
  const completedNear = (collection, point, radius = 2.6) => (
    app.state.courseMaintenance.issues[collection].some((issue) => (
      (issue.repaired || issue.cleared)
      && Math.hypot(issue.x - point.x, issue.z - point.z) <= radius
    ))
  );
  const refreshMaintenance = (report = undefined) => {
    finalizeCourseMaintenanceAction(app.state);
    app.scene3d.updateCourseMaintenance(app.state);
    app.scene3d.updateTurf(app.state);
    if (report !== undefined && maintenancePanel) maintenancePanel.setReport(report);
    if (maintenancePanel) maintenancePanel.refresh(true);
  };

  const coarseTurfLabelAt = app.scene3d.walk.hooks.turfLabelAt;
  const coarseInspectAt = app.scene3d.walk.hooks.inspectAt;
  const coarseWaterAt = app.scene3d.walk.hooks.waterAt;
  const coarseHoseLabelAt = app.scene3d.walk.hooks.hoseLabelAt;
  const coarseRepairAt = app.scene3d.walk.hooks.repairAt;
  const coarseDivotLabelAt = app.scene3d.walk.hooks.divotLabelAt;
  const coarseRakeAt = app.scene3d.walk.hooks.rakeAt;
  const coarseRakeLabelAt = app.scene3d.walk.hooks.rakeLabelAt;
  const coarseMowAt = app.scene3d.walk.hooks.mowAt;
  app.scene3d.walk.hooks.turfLabelAt = (cx, cy, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    if (!hero) return coarseTurfLabelAt(cx, cy);
    const problem = hero.report.problems[0] || 'within target';
    return `Hole ${state.courseMaintenance.heroHoleNumber} · ${hero.report.surfaceName} · ${problem} · [E] inspect · [I] tablet`;
  };
  app.scene3d.walk.hooks.inspectAt = (cx, cy, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    if (!hero) return coarseInspectAt(cx, cy);
    const report = inspectCourseMaintenanceAt(app.state, hero.point.x, hero.point.z);
    toggleCourseInspection(app.state, true);
    app.scene3d.updateCourseMaintenance(app.state, true);
    if (maintenancePanel) {
      maintenancePanel.setReport(report);
      maintenancePanel.setVisible(true);
    }
    const diseaseHeadline = report.disease?.severity >= 5
      ? `${report.disease.name || 'Disease'} severity ${report.disease.severity}`
      : null;
    toast(`Inspection refreshed · ${report.surfaceName} · ${diseaseHeadline || report.problems[0] || 'no priority issue'}.`);
    if (document.pointerLockElement) document.exitPointerLock();
  };
  app.scene3d.walk.hooks.waterAt = (cx, cy, dtSec, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    if (!hero) return coarseWaterAt(cx, cy, dtSec);
    return irrigateCourseMaintenancePath(app.state, {
      ...hero.point, radiusYd: 2.4, pointsPerSecond: 18, dtSec,
    });
  };
  app.scene3d.walk.hooks.hoseLabelAt = (cx, cy, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    if (!hero) return coarseHoseLabelAt(cx, cy);
    return `Hose · ${hero.report.surfaceName} moisture ${hero.report.moisture} · hold LMB to irrigate`;
  };

  app.scene3d.walk.hooks.repairAt = (cx, cy, dtSec, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    if (!hero) {
      coarseRepairAt(cx, cy, dtSec);
      return { ok: true };
    }
    const found = nearestOpen('divots', hero.point, 2.8);
    if (!found) return completedNear('divots', hero.point, 2.8)
      ? { ok: true, complete: true }
      : { ok: false, reason: 'No open divot is under the tool.' };
    const result = found.issue.stage === 'open'
      ? applyDivotMix(app.state, found.issue.id, dtSec)
      : levelDivot(app.state, found.issue.id, dtSec);
    if (result.complete && audio.ready) audio.chime();
    return result;
  };
  app.scene3d.walk.hooks.divotLabelAt = (cx, cy, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    if (!hero) return coarseDivotLabelAt(cx, cy);
    const found = nearestOpen('divots', hero.point, 3.2);
    if (!found) return 'Divot kit · no open divot under the tool · [F] next';
    return found.issue.stage === 'open'
      ? `Divot ${found.issue.id.split('-').at(-1)} · hold LMB to add turf mix`
      : `Divot ${found.issue.id.split('-').at(-1)} · hold LMB to level the repair`;
  };
  app.scene3d.walk.hooks.rakeAt = (cx, cy, dtSec, wx, wz, directionRad = 0) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    if (!hero) {
      coarseRakeAt(cx, cy, dtSec);
      return { ok: true };
    }
    return rakeCourseMaintenancePath(app.state, {
      ...hero.point, radiusYd: 1.9, directionRad, dtSec,
    });
  };
  app.scene3d.walk.hooks.rakeLabelAt = (cx, cy, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    if (!hero) return coarseRakeLabelAt(cx, cy);
    return nearestOpen('bunkerFootprints', hero.point, 3.2)
      ? 'Bunker rake · hold LMB and sweep the footprints'
      : `${hero.report.surfaceName} · no footprint in reach`;
  };
  app.scene3d.walk.hooks.ballmarkLabelAt = (cx, cy, wx, wz) => {
    const point = heroPoint(cx, cy, wx, wz);
    return nearestOpen('ballMarks', point, 2.8)
      ? 'Ball-mark fork · hold LMB to lift the green'
      : 'Ball-mark fork · no mark under the tool · [F] next';
  };
  app.scene3d.walk.hooks.ballmarkAt = (cx, cy, dtSec, wx, wz) => {
    const point = heroPoint(cx, cy, wx, wz);
    const found = nearestOpen('ballMarks', point, 2.5);
    if (!found) return completedNear('ballMarks', point, 2.5)
      ? { ok: true, complete: true }
      : { ok: false, reason: 'No ball mark is under the fork.' };
    const result = repairBallMark(app.state, found.issue.id, dtSec);
    if (result.complete && audio.ready) audio.chime();
    return result;
  };
  app.scene3d.walk.hooks.debrisLabelAt = (cx, cy, wx, wz) => {
    const point = heroPoint(cx, cy, wx, wz);
    const found = nearestOpen('debris', point, 3.2);
    return found ? `Debris bag · ${found.issue.type} · hold LMB to collect` : 'Debris bag · no loose debris here · [F] next';
  };
  app.scene3d.walk.hooks.debrisAt = (cx, cy, dtSec, wx, wz) => {
    const point = heroPoint(cx, cy, wx, wz);
    const found = nearestOpen('debris', point, 3.0);
    if (!found) return completedNear('debris', point, 3.0)
      ? { ok: true, complete: true }
      : { ok: false, reason: 'No loose debris is in reach.' };
    const result = clearCourseMaintenanceDebris(app.state, found.issue.id, dtSec);
    if (result.complete && audio.ready) audio.thunk();
    return result;
  };
  app.scene3d.walk.hooks.fungicideLabelAt = (cx, cy, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    return hero
      ? `Treatment sprayer · disease ${hero.report.disease.severity} · ${app.state.courseMaintenance.inventory.fungicideLiters.toFixed(1)} L`
      : 'Treatment sprayer · assigned to Hole 4 · [F] next';
  };
  app.scene3d.walk.hooks.fungicideAt = (cx, cy, dtSec, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    if (!hero) return { ok: false, reason: 'The treatment sprayer is assigned to Hole 4.' };
    return applyFungicideCourseMaintenancePath(app.state, { ...hero.point, radiusYd: 2.5, dtSec });
  };
  app.scene3d.walk.hooks.spreaderLabelAt = (cx, cy, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    return hero
      ? `Rotary spreader · feed ${hero.report.fertilizer} · ${app.state.courseMaintenance.inventory.fertilizerKg.toFixed(1)} kg`
      : 'Rotary spreader · assigned to Hole 4 · [F] next';
  };
  app.scene3d.walk.hooks.spreaderAt = (cx, cy, dtSec, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    if (!hero) return { ok: false, reason: 'The spreader is assigned to Hole 4.' };
    return fertilizeCourseMaintenancePath(app.state, { ...hero.point, radiusYd: 2.2, dtSec });
  };
  app.scene3d.walk.hooks.mowAt = (cx, cy, options = {}) => {
    const point = heroPoint(cx, cy, options.x, options.z);
    if (maintenanceIndexAtWorld(app.state.courseMaintenance, point.x, point.z) < 0) {
      if (options.bladesEngaged === false) {
        return { ok: false, changed: 0, reason: 'Engage the mower blades with [R] before cutting.' };
      }
      return { ok: true, changed: coarseMowAt(cx, cy) ? 1 : 0 };
    }
    return mowCourseMaintenancePath(app.state, {
      ...point,
      radiusYd: options.radiusYd || 1.65,
      mowerType: options.mowerType,
      bladesEngaged: options.bladesEngaged,
      speedYdPerSec: options.speedYdPerSec || 0,
      directionRad: options.directionRad || 0,
    });
  };
  app.scene3d.walk.hooks.greensMowerLabelAt = (cx, cy, wx, wz) => {
    const hero = heroReportAt(cx, cy, wx, wz);
    const equipment = app.state.courseMaintenance.equipment.greensMower;
    return hero
      ? `Greens mower · ${hero.report.surfaceName} · ${hero.report.heightMm.toFixed(1)} mm · ${Math.abs(hero.report.heightMm - hero.report.targetHeightMm) < 0.1 ? 'at target' : `target ${hero.report.targetHeightMm.toFixed(1)}`} · blades ${equipment.bladesEngaged ? 'ON' : 'OFF [R]'}`
      : 'Greens mower · assigned to Hole 4 · [F] next';
  };
  app.scene3d.walk.hooks.greensMowerAt = (cx, cy, dtSec, wx, wz, directionRad, speedYdPerSec) => {
    const equipment = app.state.courseMaintenance.equipment.greensMower;
    return app.scene3d.walk.hooks.mowAt(cx, cy, {
      x: wx, z: wz, radiusYd: 0.78, mowerType: equipment.mowerType,
      bladesEngaged: equipment.bladesEngaged, directionRad, speedYdPerSec,
    });
  };
  app.scene3d.walk.hooks.engine = (on) => {
    app.state.courseMaintenance.equipment.tractor.engineOn = !!on;
    if (audio.ready) audio.setToolLoop(on ? 'mower' : null);
  };
  app.scene3d.walk.hooks.selectMaintenanceEquipment = (equipmentId) => {
    const result = selectCourseMaintenanceEquipment(app.state, equipmentId);
    if (result.ok && maintenancePanel) maintenancePanel.refresh(true);
    return result;
  };
  app.scene3d.walk.hooks.maintenanceArrive = () => {
    const first = app.state.courseMaintenance.route.arrivedAtMinute === null;
    const result = markCourseMaintenanceRouteStep(app.state, 'arrive');
    if (first && result.ok) toast('Maintenance yard reached. Review today’s board, then inspect Hole 4.');
    if (maintenancePanel) maintenancePanel.refresh(true);
    return result;
  };
  app.scene3d.walk.hooks.reviewMaintenance = () => {
    const result = markCourseMaintenanceRouteStep(app.state, 'review');
    if (!result.ok) toast(result.reason, 'warn');
    else {
      if (maintenancePanel) maintenancePanel.setVisible(true);
      if (document.pointerLockElement) document.exitPointerLock();
      toast('Work order reviewed. Start with inspection, then choose equipment.');
    }
    return result;
  };
  app.scene3d.walk.hooks.manageIrrigationHead = (headId) => {
    const result = manageCourseMaintenanceIrrigationHead(app.state, headId);
    if (!result.ok) toast(result.reason, 'warn');
    else if (result.repaired) toast('Sprinkler head cleared. Interact again to run it.');
    else toast(result.head.enabled ? 'Sprinkler running — monitor the moisture reading.' : 'Sprinkler shut off.');
    refreshMaintenance();
    return result;
  };
  app.scene3d.walk.hooks.flagDisease = () => {
    flagCourseMaintenanceDisease(app.state);
    refreshMaintenance();
  };
  app.scene3d.walk.hooks.finalizeMaintenance = () => {
    refreshMaintenance();
    autosave();
  };
  app.plan = makePlan();
  app.worksMode = false;
  app.activeTool = null;
  app.speedIdx = 1;
  app.viewMode = 'normal';
  app.courseMode = 'walk'; // the course is experienced on foot; Tab for the overview
  if (walkOverlay) walkOverlay.style.display = 'none';
  lastHourSeen = -1;
  lastPresentationMode = null;
  frontDeskLessonSeen = false;
  tutLookSpan = 0;
  tutLastYaw = null;
  tutWalked = 0;
  tutLastPos = null;
  endgameShown = !!(state.progression && state.progression.majorWon);
  failShown = false;
  rebuildSectionIndex();
  recomputeRating();
  lastDiseasedNames = currentDiseasedSet(); // prime silently
  if (groundsPanel) groundsPanel.setVisible(false);
  if (worksPanel) worksPanel.setVisible(false);
  if (maintenancePanel) {
    maintenancePanel.setReport(null);
    maintenancePanel.setVisible(!!state.courseMaintenance?.inspection.active);
  }
  menu.setVisible(false);
  gameUi.style.display = '';
  hud.update();
  if (objectivesPanel) objectivesPanel.refresh();
  toast(`Welcome to ${state.clubName} — ${state.mode} mode.`);
  if (lastDiseasedNames.size > 0) {
    toast(`The greenskeeper's note: ${lastDiseasedNames.size} greens are fighting disease. Step outside and click them to diagnose.`, 'warn');
  }
  // one continuous world: you arrive ON the property, at the clubhouse porch —
  // the shop is the building in front of you, and you walk in through its door
  enterWalk();
  applySettings(); // render scale / AO / bloom / FOV / sensitivity from the pause menu
  // hold an opaque veil over the first frames while every shader compiles and every
  // texture uploads — otherwise the first look-around freezes on lazy GPU work
  const veil = ensureLoadVeil();
  veil.show(`Arriving at ${state.clubName}`);
  app.prewarming = true;
  const sceneRef = app.scene3d;
  sceneRef
    .prewarm((label) => veil.set(label))
    .catch(() => {})
    .finally(() => {
      if (app.scene3d === sceneRef) app.prewarming = false;
      veil.hide();
    });
}

// full-screen loading veil (opaque — it also hides the prewarm camera swings)
let loadVeil = null;
function ensureLoadVeil() {
  if (loadVeil) return loadVeil;
  const el = document.createElement('div');
  el.className = 'load-veil';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-busy', 'false');
  el.innerHTML = `
    <div class="load-veil-card">
      <div class="load-veil-logo">GOLF EMPIRE</div>
      <div class="load-veil-title"></div>
      <div class="load-veil-bar" role="progressbar" aria-label="Loading game" aria-valuemin="0" aria-valuemax="100" aria-valuenow="8"><div class="load-veil-fill"></div></div>
      <div class="load-veil-step"></div>
      <div class="load-veil-tip" aria-live="off"></div>
    </div>`;
  document.body.appendChild(el);
  const title = el.querySelector('.load-veil-title');
  const stepEl = el.querySelector('.load-veil-step');
  const fill = el.querySelector('.load-veil-fill');
  const tip = el.querySelector('.load-veil-tip');
  const progress = el.querySelector('[role="progressbar"]');
  const STEPS = ['Compiling shaders', 'Uploading textures', 'Warming the view'];
  const TIPS = [
    'Tap F for the next available tool; hold F to open the full tool belt.',
    'P pauses from walking, checkout, the laptop, placement, or overview.',
    'A clean, stocked shop gives the register work worth doing.',
    'Manual save slots are separate from the Continue autosave.',
  ];
  let tipTimer = null;
  let tipIndex = 0;
  const showNextTip = () => {
    tip.textContent = TIPS[tipIndex % TIPS.length];
    tipIndex += 1;
  };
  loadVeil = {
    show(t) {
      title.textContent = t || 'Loading';
      stepEl.textContent = 'Building the course';
      fill.style.width = '12%';
      progress.setAttribute('aria-valuenow', '12');
      if (tipTimer) clearInterval(tipTimer);
      showNextTip();
      tipTimer = setInterval(showNextTip, 2400);
      el.setAttribute('aria-busy', 'true');
      el.style.display = 'flex';
      el.style.opacity = '1';
    },
    set(label) {
      stepEl.textContent = label;
      const i = STEPS.indexOf(label);
      if (i >= 0) {
        const value = Math.round(25 + (i / STEPS.length) * 70);
        fill.style.width = `${value}%`;
        progress.setAttribute('aria-valuenow', String(value));
      }
    },
    hide() {
      if (tipTimer) clearInterval(tipTimer);
      tipTimer = null;
      fill.style.width = '100%';
      progress.setAttribute('aria-valuenow', '100');
      el.setAttribute('aria-busy', 'false');
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; }, preferences.values.accessibility.reducedMotion ? 0 : 420);
    },
  };
  return loadVeil;
}

function exitToMenu() {
  closePauseMenu({ resume: false });
  if (app.frontDeskOpen) exitFrontDesk(true);
  toolWheel?.close('menu');
  clearNotifications();
  audio.setToolLoop(null);
  audio.setPaused(false);
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
    await saveData('autosave-meta', currentSaveMetadata());
    return { ok: true };
  } catch (error) {
    notify({
      message: 'Autosave could not write to disk. Open the pause menu and try a manual slot before leaving.',
      category: 'save-failure',
      persistent: true,
      dedupeKey: 'autosave-failed',
    });
    if (audio.ready) audio.uiError();
    console.error('autosave failed', error);
    return { ok: false, error };
  }
}

function currentSaveMetadata() {
  const state = app.state || activeState(app.empire);
  return {
    name: state?.clubName || 'Property market',
    when: hudClockText(),
    cash: app.empire?.cash ?? state?.cash ?? 0,
    cond: state?.shop?.reno ? Math.round(state.shop.reno.condition) : null,
    savedAt: Date.now(),
  };
}

async function saveSlot(slot) {
  if (!app.empire) throw new Error('There is no active empire to save.');
  await saveData(slot, empireSnapshot(app.empire));
  await saveData(`${slot}-meta`, currentSaveMetadata());
  tutorialFlag(app.state, 'savedGame');
  return currentSaveMetadata();
}

// --- handlers -------------------------------------------------------------------

const handlers = {
  getPresentationMode: presentationMode,
  getToolActivation: () => preferences.values.accessibility.toolActivation,
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
  toggleCourseMode() {
    if (app.view !== 'course' || !app.scene3d) return;
    resetCameraInput(); // the map opens still — nothing carries over from the walk
    if (app.courseMode === 'walk') {
      app.courseMode = 'overview';
      exitWalk();
      toast('Overview camera — Tab returns you to your feet.');
    } else {
      if (app.worksMode) handlers.toggleWorks(); // plans belong to the overview
      enterWalk('resume');
    }
    syncPresentationMode(presentationMode());
  },
  setViewMode(mode) {
    app.viewMode = mode;
    app.scene3d.setViewMode(mode);
    viewButtons.forEach((button) => button.classList.toggle('active-tool', button.dataset.mode === mode));
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
    syncPresentationMode(presentationMode());
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
  sellHolding(propertyId, prevSpeed = 1, appraisalId = null) {
    const empire = app.empire;
    const wasActive = empire.activeId === propertyId;
    const res = confirmPropertySale(empire, propertyId, appraisalId, true);
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
// One instance, Esc toggles it, torn down on any mode change. Two panes: section
// nav on the left, content on the right — a commercial pause screen, not a form.

const SLOTS = ['slot1', 'slot2', 'slot3'];
let pauseUi = null;
let pausePrevSpeed = 1;
let pauseHadPointerLock = false;
let releasePauseFocus = () => {};
const SAVE_LIMITS = { empireVersion: EMPIRE_VERSION, saveVersion: SAVE_VERSION };

function applySettings() {
  const values = preferences.values;
  applyDocumentPreferences(values);
  audio.applyPreferences();
  if (laptopUi) laptopUi.setScale(values.display.uiScale);
  if (!app.scene3d) return;
  app.scene3d.renderer.setPixelRatio(Math.min(2.5, (window.devicePixelRatio || 1) * values.display.renderScale));
  app.scene3d.renderer.shadowMap.enabled = values.display.shadows;
  app.scene3d.resize();
  if (app.scene3d.post) {
    if (app.scene3d.post.gtao) app.scene3d.post.gtao.enabled = values.display.ambientOcclusion;
    if (app.scene3d.post.bloom) app.scene3d.post.bloom.enabled = values.display.bloom;
  }
  app.scene3d.walk?.configure?.({
    sensitivity: values.camera.sensitivity,
    invertY: values.camera.invertY,
    fov: values.camera.fov,
    cameraBob: values.camera.bob,
    reducedMotion: values.accessibility.reducedMotion,
  });
}

preferences.subscribe(() => applySettings());

function isPauseOpen() { return !!pauseUi; }
function closePauseMenu({ resume = true } = {}) {
  if (!pauseUi) return;
  releasePauseFocus();
  releasePauseFocus = () => {};
  pauseUi.remove();
  pauseUi = null;
  document.body.classList.remove('pause-open');
  gameUi?.classList.remove('is-obscured');
  gameUi?.removeAttribute('aria-hidden');
  audio.setPaused(false);
  if (resume && app.screen === 'game') {
    app.speedIdx = pausePrevSpeed ?? 1;
    if (pauseHadPointerLock && !regActive() && !app.laptopOpen) requestLook();
  }
  pauseHadPointerLock = false;
}
function togglePauseMenu() { if (pauseUi) closePauseMenu(); else openPauseMenu(); }

function hudClockText() {
  const chip = document.querySelector('.hud-clock');
  return chip ? chip.textContent.replace(/[⏸▶]/g, '').trim() : '';
}

function keycaps(...keys) {
  const row = el('span', { class: 'kc-row' });
  for (const k of keys) row.append(el('kbd', { class: 'kc', text: k }));
  return row;
}

function openPauseMenu() {
  if (pauseUi || app.screen !== 'game') return;
  toolWheel?.close('pause');
  resetCameraInput();
  pauseHadPointerLock = document.pointerLockElement === canvas;
  if (document.pointerLockElement) document.exitPointerLock();
  app.scene3d?.walk?.setSpraying?.(false);
  app.scene3d?.walk?.setSoaping?.(false);
  audio.setToolLoop(null);
  pausePrevSpeed = app.speedIdx;
  app.speedIdx = 0;
  audio.setPaused(true);
  document.body.classList.add('pause-open');
  gameUi?.classList.add('is-obscured');
  gameUi?.setAttribute('aria-hidden', 'true');

  const content = el('div', { class: 'pause-content' });
  const nav = el('div', { class: 'pause-nav' });
  const navBtns = new Map();
  const status = el('div', { class: 'pause-status', role: 'status', 'aria-live': 'polite', text: 'Gameplay paused' });

  const setPage = (key) => {
    for (const [k, b] of navBtns) b.classList.toggle('active', k === key);
    content.replaceChildren();
    PAGES[key](content);
    content.scrollTop = 0;
    content.querySelector('button, input, select')?.focus({ preventScroll: true });
    if (audio.ready) audio.uiTick();
  };
  const navItem = (key, label, action) => {
    const b = el('button', { class: 'pause-nav-btn', text: label, onclick: action || (() => setPage(key)) });
    navBtns.set(key, b);
    nav.append(b);
    return b;
  };

  async function slotRecord(slot) {
    const [record, metadata] = await Promise.all([inspectData(slot, SAVE_LIMITS), inspectData(`${slot}-meta`)]);
    return { record, summary: record.data ? summarizeSave(record.data, metadata.data) : null };
  }

  function saveDescription(record, summary) {
    if (record.status === 'missing') return 'Empty — ready for a new save';
    if (record.status === 'corrupt') return 'Unreadable — saving here will preserve the damaged copy as a backup';
    if (record.status === 'unsupported') return `Created by newer version ${record.version}`;
    const when = summary?.savedAt ? new Date(summary.savedAt).toLocaleString() : 'time not recorded';
    return `${summary?.clubName || 'Saved restoration'} · Day ${summary?.day || '?'} at ${summary?.clock || '?'} · ${formatMoney(summary?.cash || 0)} · ${when}`
      + (record.status === 'recovered' ? ' · previous backup recovered' : '');
  }

  function slotRows(container, mode) {
    container.append(el('div', {
      class: 'pause-hint',
      text: mode === 'save'
        ? 'Three manual slots. Existing saves ask before they are replaced.'
        : 'Loading returns to the saved moment and discards progress since your last save.',
    }));
    SLOTS.forEach((slot, index) => {
      const meta = el('div', { class: 'slot-meta', text: 'Checking slot…' });
      const action = el('button', { class: `slot-act${mode === 'save' ? ' primary' : ''}`, text: mode === 'save' ? 'Save here' : 'Load', disabled: true });
      const card = el('div', { class: 'slot-card', 'aria-busy': 'true' },
        el('div', { class: 'slot-name', text: `Slot ${index + 1}` }), meta, action,
      );
      container.append(card);
      slotRecord(slot).then(({ record, summary }) => {
        if (!card.isConnected) return;
        card.setAttribute('aria-busy', 'false');
        meta.textContent = saveDescription(record, summary);
        action.disabled = mode === 'load' && !['ok', 'recovered'].includes(record.status);
        if (mode === 'save') action.disabled = false;
        action.onclick = () => {
          if (mode === 'save') {
            const write = async () => {
              action.disabled = true;
              card.dataset.state = 'saving';
              meta.textContent = 'Saving…';
              status.textContent = `Saving slot ${index + 1}…`;
              try {
                await saveSlot(slot);
                status.textContent = `Saved to slot ${index + 1}`;
                notify({ message: `Saved to slot ${index + 1}.`, category: 'save-success', dedupeKey: `saved-${slot}` });
                audio.uiConfirm?.();
                objectivesPanel.refresh();
                setPage('save');
                return true;
              } catch (error) {
                action.disabled = false;
                card.dataset.state = 'error';
                meta.textContent = 'Save failed — your previous slot is still preserved. Check storage access and try another slot.';
                status.textContent = `Slot ${index + 1} could not be saved`;
                notify({ message: `Slot ${index + 1} could not be saved. Your previous copy was preserved.`, category: 'save-failure', persistent: true, dedupeKey: `save-failed-${slot}` });
                audio.uiError?.();
                console.error(`save ${slot} failed`, error);
                return false;
              }
            };
            if (record.status !== 'missing') {
              confirmDialog({
                title: `Replace slot ${index + 1}?`,
                message: summary?.clubName || 'This slot already contains save data.',
                detail: 'The existing copy moves to the recovery backup before the new save is written.',
                confirmLabel: 'Replace and save', danger: true, onConfirm: write,
              });
            } else write();
            return;
          }
          confirmDialog({
            title: `Load slot ${index + 1}?`,
            message: summary?.clubName || 'Load this restoration?',
            detail: 'Progress since your last save will be lost.',
            confirmLabel: 'Load game',
            onConfirm: async () => {
              try {
                const empire = deserializeEmpire(record.data);
                closePauseMenu({ resume: false });
                bootEmpire(empire);
                return true;
              } catch (error) {
                notify({ message: 'That save could not be opened. Try another slot; the file has not been changed.', category: 'invalid', persistent: true });
                audio.uiError?.();
                console.error(`load ${slot} failed`, error);
                return false;
              }
            },
          });
        };
      }).catch((error) => {
        card.setAttribute('aria-busy', 'false');
        card.dataset.state = 'error';
        meta.textContent = 'This slot could not be checked.';
        action.disabled = mode === 'load';
        console.error(`inspect ${slot} failed`, error);
      });
    });
  }

  const PAGES = {
    home: (c) => {
      const summary = summarizeSave(empireSnapshot(app.empire), currentSaveMetadata());
      c.append(
        el('div', { class: 'pause-overview' },
          el('div', { class: 'pause-overview-kicker', text: 'Current restoration' }),
          el('h2', { text: summary?.clubName || app.state?.clubName || 'Golf Empire' }),
          el('p', { text: `${summary?.propertyName || ''} · Day ${summary?.day || 1}, ${summary?.clock || ''} · ${formatMoney(summary?.cash || 0)}` }),
        ),
        el('button', { class: 'pause-resume-primary', text: 'Resume game', onclick: () => closePauseMenu() }),
        el('div', { class: 'pause-hint', text: 'The simulation clock, tools, and looping effects remain paused while this menu is open.' }),
      );
    },
    save: (c) => slotRows(c, 'save'),
    load: (c) => slotRows(c, 'load'),
    settings: (c) => {
      c.append(makeSettingsPanel({
        preferences,
        audio,
        apply: applySettings,
        tutorialEnabled: !!(app.state?.tutorial && !app.state.tutorial.complete),
        onResetTutorials: () => {
          replayTutorial(app.state);
          objectivesPanel.refresh();
          notify({ message: 'Contextual tutorials reset. Lessons will return when their activity is next used.', category: 'objective' });
        },
        onDisableTutorials: () => {
          skipTutorial(app.state);
          objectivesPanel.refresh();
          notify({ message: 'Tutorial guidance disabled. Reset it here at any time.', category: 'info' });
        },
      }));
    },
    controls: (c) => {
      const group = (title, rows) => {
        const g = el('div', { class: 'ctl-group' }, el('div', { class: 'ctl-title', text: title }));
        for (const [what, ...keys] of rows) {
          g.append(el('div', { class: 'ctl-row' }, keycaps(...keys), el('span', { class: 'ctl-what', text: what })));
        }
        return g;
      };
      c.append(
        el('div', { class: 'ctl-cols' },
          group('Move', [
            ['Walk', 'W', 'A', 'S', 'D'], ['Run', 'Shift'], ['Look around', 'Mouse'],
            ['Capture the mouse', 'Click'], ['Course overview', 'Tab'],
          ]),
          group('Hands', [
            ['Context action', 'E'], ['Tool belt: tap / hold', 'F'],
            ['Previous tool', 'Q'], ['Use selected tool', 'LMB'],
            ['Placement mode', 'B'], ['Rotate placement', 'R'],
          ]),
          group('Time & views', [
            ['Pause menu', 'P', 'Esc'], ['Pause simulation clock', 'Space'],
            ['Simulation speed', '1', '2', '3'], ['Course data view', 'V'],
          ]),
          group('Management', [
            ['Grounds desk', 'G'], ['Club office', 'C'], ['Empire overview', 'M'],
            ['Leave laptop / register step back', 'Esc'],
          ]),
        ),
      );
    },
    exit: (c) => {
      c.append(
        el('div', { class: 'pause-hint', text: 'Recovery and session controls. Leaving the game always asks first.' }),
        el('button', {
          class: 'pause-wide',
          text: 'Move me to a safe position',
          onclick: () => {
            const w = app.scene3d && app.scene3d.walk;
            if (!w || !w.unstick) return;
            const how = w.unstick();
            closePauseMenu();
            toast(how ? 'Freed you up — back on solid ground.' : 'Nowhere clear to move you to.', how ? 'good' : 'warn');
          },
        }),
        el('button', {
          class: 'pause-wide danger',
          text: 'Return to main menu',
          onclick: () => confirmDialog({
            title: 'Return to main menu?',
            message: 'Save the current restoration and leave this session?',
            detail: 'If saving fails, the game will keep this menu open so you can choose a manual slot.',
            confirmLabel: 'Save and return',
            danger: true,
            onConfirm: async () => {
              const result = await autosave();
              if (!result?.ok) return false;
              closePauseMenu({ resume: false });
              exitToMenu();
              return true;
            },
          }),
        }),
        window.fairwayNative?.quit ? el('button', {
          class: 'pause-wide danger',
          text: 'Save and quit to desktop',
          onclick: () => confirmDialog({
            title: 'Quit Golf Empire?',
            message: 'Save this restoration and return to the desktop?',
            detail: 'The game will not quit if the autosave fails.',
            confirmLabel: 'Save and quit', danger: true,
            onConfirm: async () => {
              const result = await autosave();
              if (!result?.ok) return false;
              await window.fairwayNative.quit();
              return true;
            },
          }),
        }) : null,
      );
    },
  };

  navItem('resume', 'Resume', () => closePauseMenu());
  navItem('home', 'Overview');
  navItem('save', 'Save game');
  navItem('load', 'Load game');
  navItem('settings', 'Settings');
  navItem('controls', 'Controls');
  navItem('exit', 'Session');
  nav.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...nav.querySelectorAll('button')];
    let index = buttons.indexOf(document.activeElement);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = buttons.length - 1;
    else index = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  });

  const panel = el('div', { class: 'pause-panel' },
    el('div', { class: 'pause-head' },
      el('div', { class: 'pause-club', text: (app.state && app.state.clubName) || 'GOLF EMPIRE' }),
      el('div', { class: 'pause-word', text: 'PAUSED' }),
    ),
    el('div', { class: 'pause-body' }, nav, content),
    el('div', { class: 'pause-footer' }, status, el('span', { text: 'P or Esc resumes' })),
  );
  pauseUi = el('div', { class: 'pause-veil-ui', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pause menu' }, panel);
  pauseUi.addEventListener('pointerdown', (event) => event.stopPropagation());
  pauseUi.addEventListener('keydown', (event) => {
    if (event.key !== 'p' && event.key !== 'P') return;
    event.preventDefault();
    event.stopPropagation();
    closePauseMenu();
  }, true);
  document.getElementById('ui').append(pauseUi);
  releasePauseFocus = containFocus(panel, { onEscape: () => closePauseMenu(), initialFocus: navBtns.get('home') });
  setPage('home');
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

// REGISTER MODE. While it is up the camera is frozen (walk.focusOn) and the pointer
// is FREE, because the player is working a counter with a cursor rather than looking
// around with the mouse. So it has to intercept the pointer before the walk handlers
// see it — otherwise a left-click on a banknote would also fire the tool trigger,
// and clicking the canvas would grab pointer lock back and start the camera spinning.
function regApi() {
  const ch = app.scene3d && app.scene3d.clubhouse && app.scene3d.clubhouse();
  return ch && ch.register ? ch.register : null;
}
function regActive() {
  const r = regApi();
  return !!(r && r.isActive());
}

let toolKeyTimer = null;
let toolKeyStarted = 0;
let toolHoldOpened = false;
let previousWalkTool = null;

function walkToolEntries() {
  const walk = app.scene3d?.walk;
  const clubhouse = app.scene3d?.clubhouse?.();
  const inside = !!(walk && clubhouse?.isInside(walk.state.x, walk.state.z));
  const washer = app.state ? ownedWasher(app.state) : null;
  return [
    { id: null, label: 'Hands free', icon: '○', detail: 'Interact, carry, and inspect' },
    {
      id: 'vacuum', label: 'Shop vacuum', icon: 'V',
      available: inside && !!(app.state && vacuumOwned(app.state)),
      reason: !inside ? 'Use this inside the clubhouse' : 'Order a shop vacuum from the laptop',
      detail: 'Cleans floor grime inside the shop',
    },
    {
      id: 'washer', label: washer?.name || 'Pressure washer', icon: 'W',
      available: !inside,
      reason: 'Use this on the clubhouse exterior',
      detail: 'LMB washes · RMB applies soap',
    },
    { id: 'hose', label: 'Watering hose', icon: 'H', available: !inside, reason: 'Use this on course turf', detail: 'Raises live turf moisture' },
    { id: 'divot', label: 'Divot kit', icon: 'D', available: !inside, reason: 'Use this on course turf', detail: 'Repairs worn turf patches' },
    { id: 'ballmark', label: 'Ball-mark fork', icon: 'B', available: !inside, reason: 'Use this on course greens', detail: 'Repairs ball marks on greens' },
    { id: 'rake', label: 'Bunker rake', icon: 'R', available: !inside, reason: 'Use this on course bunkers', detail: 'Smooths footprinted sand' },
    { id: 'debris', label: 'Debris bag', icon: 'G', available: !inside, reason: 'Use this around the hero hole', detail: 'Clears loose course debris' },
    { id: 'fungicide', label: 'Treatment sprayer', icon: 'T', available: !inside, reason: 'Use this on diagnosed turf disease', detail: 'Treats active disease after inspection' },
    { id: 'spreader', label: 'Rotary spreader', icon: 'S', available: !inside, reason: 'Use this on weak course turf', detail: 'Applies fertilizer by coverage' },
    { id: 'greensMower', label: 'Greens mower', icon: 'M', available: !inside, reason: 'Use this on the hero green', detail: 'Press R for blades, then mow a real path' },
  ];
}

function selectWalkTool(tool) {
  const walk = app.scene3d?.walk;
  if (!walk) return;
  const current = walk.getTool();
  if (current !== tool) previousWalkTool = current;
  walk.setSpraying(false);
  walk.setSoaping?.(false);
  audio.setToolLoop(null);
  walk.setTool(tool);
  const equipmentId = MAINTENANCE_EQUIPMENT_FOR_TOOL[tool];
  if (equipmentId && walk.hooks.selectMaintenanceEquipment) {
    const result = walk.hooks.selectMaintenanceEquipment(equipmentId);
    if (result && result.ok === false) {
      toast(result.reason, 'warn');
      walk.setTool(current);
      return;
    }
  }
  if (audio.ready) audio.equipTick();
  if (app.state) {
    tutorialFlag(app.state, 'toolSelected');
    if (tool === 'vacuum') triggerContextTutorial(app.state, 'cleaning-tools');
    else if (['washer', 'hose', 'divot', 'rake'].includes(tool)) triggerContextTutorial(app.state, 'maintenance-tools');
  }
  objectivesPanel?.refresh();
  hud?.update();
}

function cycleWalkTool() {
  const entries = walkToolEntries().filter((entry) => entry.available !== false);
  if (!entries.length) return;
  const current = app.scene3d.walk.getTool();
  const index = entries.findIndex((entry) => entry.id === current);
  selectWalkTool(entries[(index + 1 + entries.length) % entries.length].id);
}

function showToolWheel() {
  if (!walkActive() || regActive() || app.laptopOpen || buildApi()?.isActive() || isPauseOpen()) return;
  toolHoldOpened = true;
  resetCameraInput();
  app.scene3d.walk.setSpraying(false);
  app.scene3d.walk.setSoaping?.(false);
  audio.setToolLoop(null);
  if (document.pointerLockElement) document.exitPointerLock();
  triggerContextTutorial(app.state, 'tool-wheel');
  objectivesPanel.refresh();
  toolWheel.show(walkToolEntries(), app.scene3d.walk.getTool());
}

function beginToolKey(event) {
  if (event.repeat || toolKeyTimer || toolWheel?.isOpen()) return;
  toolKeyStarted = performance.now();
  toolHoldOpened = false;
  toolKeyTimer = setTimeout(() => {
    toolKeyTimer = null;
    showToolWheel();
  }, 230);
}

function endToolKey() {
  if (toolKeyTimer) {
    clearTimeout(toolKeyTimer);
    toolKeyTimer = null;
  }
  if (!toolHoldOpened && performance.now() - toolKeyStarted < 500 && walkActive()) cycleWalkTool();
  toolKeyStarted = 0;
  toolHoldOpened = false;
}

const MAINTENANCE_STROKE_TOOLS = new Set([
  'hose', 'divot', 'ballmark', 'rake', 'debris', 'fungicide', 'spreader', 'greensMower',
]);

function stopToolUse() {
  const walk = app.scene3d?.walk;
  if (!walk) return;
  const completedMaintenanceStroke = !!(walk.isSpraying()
    && MAINTENANCE_STROKE_TOOLS.has(walk.getTool()));
  walk.setSpraying(false);
  walk.setSoaping?.(false);
  audio.setToolLoop(null);
  if (completedMaintenanceStroke) walk.hooks.finalizeMaintenance?.();
}

canvas.addEventListener('click', () => {
  // first-person walking: clicking (re)captures the mouse — but NOT while the player
  // is behind the till, where the cursor is the whole interface
  if (regActive() || app.frontDeskOpen || toolWheel?.isOpen() || isPauseOpen()) return;
  if (app.screen === 'game' && !document.pointerLockElement && walkActive()) {
    requestLook();
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (app.screen !== 'game') return;
  if (app.frontDeskOpen || toolWheel?.isOpen() || isPauseOpen()) { e.preventDefault(); return; }
  if (regActive()) { e.preventDefault(); regApi().onDown(e); return; }
  if (app.courseMode !== 'overview') {
    // walking with any tool out: the held button is the use trigger
    const bld = buildApi();
    if (bld && bld.isActive()) {
      // The first click after closing the catalog is only allowed to recapture
      // look control. Treating that same gesture as placement could commit a sofa
      // while the player was merely dismissing "Click to play".
      if (!document.pointerLockElement) {
        requestLook();
        return;
      }
      if (e.button === 0) bld.interact(); // put it down where you're pointing
      else if (e.button === 2) bld.cancel(); // changed your mind
      return;
    }
    const tool = walkActive() && app.scene3d.walk.getTool();
    if (e.button === 0 && tool) {
      const toggle = preferences.values.accessibility.toolActivation === 'toggle';
      const active = toggle ? !app.scene3d.walk.isSpraying() : true;
      if (active) {
        app.scene3d.walk.setSpraying(true);
        if (audio.ready) audio.setToolLoop(TOOL_AUDIO_LOOP[tool] || tool);
      } else stopToolUse();
    } else if (e.button === 2 && tool === 'washer') {
      // right button on the washer lays soap, for the stains water alone won't touch
      e.preventDefault();
      const toggle = preferences.values.accessibility.toolActivation === 'toggle';
      const active = toggle ? !app.scene3d.walk.isSoaping() : true;
      app.scene3d.walk.setSoaping(active);
      if (audio.ready) audio.setToolLoop(active ? 'soap' : null);
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
  if (regActive()) { regApi().onMove(e); return; }
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

window.addEventListener('pointerup', (e) => {
  if (regActive()) { regApi().onUp(e); return; }
  if (preferences.values.accessibility.toolActivation === 'hold') stopToolUse();
});

canvas.addEventListener('pointerup', () => {
  if (!dragging) return;
  // a drag always ends on pointerup, even if the mode changed mid-drag — otherwise the stale
  // anchor survives and the next map open jumps the camera by the whole gap.
  if (app.screen === 'game' && app.view === 'course' && app.courseMode === 'overview'
      && dragging.mode === 'pan-or-click' && dragging.moved <= 6 && dragging.cell) {
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

  // The pause shell owns every key while open. P is a universal pause key in
  // register, laptop, placement, overview, and ordinary walk; Esc remains the
  // contextual "step back" key where those modes need it.
  if (isPauseOpen()) {
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      closePauseMenu();
    }
    return;
  }
  if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    openPauseMenu();
    return;
  }
  if (app.frontDeskOpen) {
    if (e.key === 'Escape') {
      e.preventDefault();
      exitFrontDesk();
    }
    return;
  }
  if (toolWheel?.isOpen()) return;

  // BEHIND THE TILL, THE TILL OWNS THE KEYBOARD. This sits above even the speed keys
  // and Tab, deliberately: Tab would swap to the overview camera while the cashier
  // pose is still latched, which strands the player looking at a counter from orbit.
  // Escape is the way out, and registerMode handles it.
  if (regActive()) {
    e.preventDefault();
    regApi().onKey(e.key);
    return;
  }

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

  if (e.key === 'Tab') {
    e.preventDefault(); // Tab is the camera toggle, not DOM focus
    handlers.toggleCourseMode();
    return;
  }

  if (app.laptopOpen) {
    // seated at the laptop: the portal owns the keyboard; Esc closes the lid
    if (e.key === 'Escape') exitLaptop();
    return;
  }

  if (walkActive()) {
    // Renovation mode owns customization keys while leaving WASD as the familiar
    // first-person movement scheme. A preview is state-free until E/LMB confirms.
    const bld = buildApi();
    if (bld && bld.isActive()) {
      if (e.ctrlKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) bld.redo(); else bld.undo();
        return;
      }
      if (e.ctrlKey && !e.altKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        bld.redo();
        return;
      }
      if (bld.isCatalogOpen()) {
        if (e.key === 'i' || e.key === 'I' || e.key === 'Escape') {
          e.preventDefault();
          bld.toggleCatalog();
        } else if (e.key === 'b' || e.key === 'B') {
          e.preventDefault();
          bld.exit();
          toast('Renovation mode finished.');
        }
        return;
      }
      switch (e.key) {
        case 'e': case 'E': e.preventDefault(); bld.interact(); return;
        case 'r': case 'R': e.preventDefault(); bld.rotate(e.shiftKey ? -1 : 1); return;
        case 'x': case 'X': e.preventDefault(); bld.stow(); return;
        case 'Delete': e.preventDefault(); bld.sellById(); return;
        case 'g': case 'G': e.preventDefault(); bld.toggleGrid(); return;
        case 't': case 'T': e.preventDefault(); bld.toggleRotationSnap(); return;
        case 'i': case 'I': e.preventDefault(); bld.toggleCatalog(); return;
        case 'o': case 'O': e.preventDefault(); bld.returnOriginal(); return;
        // The walk controller also offers arrow-key look as an accessibility
        // fallback. In renovation mode these keystrokes belong exclusively to
        // furniture nudging; letting the same event reach that second window
        // listener rotates the camera and moves the view ray against the nudge.
        case 'ArrowUp': e.preventDefault(); e.stopImmediatePropagation(); bld.nudge('up', e.shiftKey); return;
        case 'ArrowDown': e.preventDefault(); e.stopImmediatePropagation(); bld.nudge('down', e.shiftKey); return;
        case 'ArrowLeft': e.preventDefault(); e.stopImmediatePropagation(); bld.nudge('left', e.shiftKey); return;
        case 'ArrowRight': e.preventDefault(); e.stopImmediatePropagation(); bld.nudge('right', e.shiftKey); return;
        case 'b': case 'B': e.preventDefault(); bld.exit(); toast('Renovation mode finished.'); return;
        case 'Escape':
          if (bld.isCarrying()) bld.cancel();
          else bld.exit();
          return;
        default: break; // WASD still walks: you carry the fixture with you
      }
    }

    // first-person course: E is the interaction verb (shop convention). The repeat flag matters:
    // cutting tape and stocking a shelf are HOLD verbs driven per-frame, and a tap verb must not
    // fire thirty times a second just because the key is down.
    switch (e.key) {
      case 'e': case 'E':
        if (app.scene3d.walk.interact) app.scene3d.walk.interact(e.repeat);
        break;
      case 'b': case 'B': {
        const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
        const w = app.scene3d.walk.state;
        if (!ch || !ch.isInside(w.x, w.z)) {
          toast('Rearranging is for indoors.', 'warn');
          break;
        }
        ch.build.enter();
        triggerContextTutorial(app.state, 'placement');
        objectivesPanel.refresh();
        break;
      }
      case 'r': case 'R': {
        const bladeResult = app.scene3d.walk.toggleBlades?.();
        if (bladeResult?.handled) {
          toast(bladeResult.enabled ? `${bladeResult.label} blades engaged.` : `${bladeResult.label} blades disengaged.`);
          if (audio.ready) audio.setToolLoop(bladeResult.enabled ? 'mower' : null);
          if (maintenancePanel) maintenancePanel.refresh(true);
          break;
        }
        // at the register in Realistic mode, R hands over the counted change
        const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
        if (ch && ch.confirmChange) ch.confirmChange();
        break;
      }
      case 'f': case 'F': {
        if (!app.scene3d.walk.cart.mounted) beginToolKey(e);
        break;
      }
      case 'q': case 'Q': {
        if (app.scene3d.walk.cart.mounted) break;
        const current = app.scene3d.walk.getTool();
        const previous = previousWalkTool;
        if (previous !== undefined && previous !== current) {
          previousWalkTool = current;
          selectWalkTool(previous);
        }
        break;
      }
      case 'i': case 'I':
        setMaintenanceVisible(!maintenancePanel?.isVisible());
        break;
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
      case 'v': case 'V': {
        const modes = ['normal', 'health', 'moisture'];
        handlers.setViewMode(modes[(modes.indexOf(app.viewMode) + 1) % modes.length]);
        break;
      }
      case 'Escape':
        // first Esc releases the pointer (browser); the next toggles the pause menu
        if (isPauseOpen()) closePauseMenu();
        else if (app.selectedSection) inspectPanel.hide();
        else if (app.groundsOpen || app.clubOpen || app.empireOpen) closeLeftPanels('none');
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
    case 'm': case 'M':
      handlers.toggleEmpire();
      break;
    case 'v': case 'V': {
      const modes = ['normal', 'health', 'moisture'];
      handlers.setViewMode(modes[(modes.indexOf(app.viewMode) + 1) % modes.length]);
      break;
    }
    case 'Escape':
      if (isPauseOpen()) {
        closePauseMenu();
      } else if (app.activeTool) {
        app.activeTool = null;
        app.scene3d.setBrush(null, 0, null);
        worksPanel.updateToolHighlight();
      } else if (app.worksMode) {
        handlers.toggleWorks();
      } else if (app.selectedSection) {
        inspectPanel.hide();
      } else if (app.groundsOpen || app.clubOpen) {
        closeLeftPanels('none');
      } else {
        // leaving the overview returns to your feet on the course
        handlers.toggleCourseMode();
      }
      break;
  }
});

// held-key camera movement. The set is normalised and repeat-safe (see core/heldKeys.js) —
// a key released mid-run used to strand its shifted spelling here and pan the map forever.
const held = createHeldKeys(OVERVIEW_KEYS);
window.addEventListener('keydown', (e) => {
  if (!app.frontDeskOpen && !isPauseOpen() && !toolWheel?.isOpen()) held.down(e.key, e.repeat);
});
window.addEventListener('keyup', (e) => {
  held.up(e.key);
  if (e.key === 'f' || e.key === 'F') endToolKey();
});
window.addEventListener('blur', () => {
  if (toolKeyTimer) clearTimeout(toolKeyTimer);
  toolKeyTimer = null;
  toolHoldOpened = false;
  stopToolUse();
  resetCameraInput();
});
document.addEventListener('pointerlockchange', () => resetCameraInput());

// every mode transition hands the camera a clean slate: nothing is "still down" from the mode
// you just left, and a half-finished drag cannot resume into the new one.
function resetCameraInput() {
  held.clear();
  dragging = null;
  const w = app.scene3d && app.scene3d.walk;
  if (w && w.clearKeys) w.clearKeys(); // ...and the feet, so a paused stride doesn't resume
}

function keyboardCamera(dtMs) {
  if (app.screen !== 'game' || app.view !== 'course' || app.courseMode !== 'overview' || !app.scene3d) return;
  const { panX, panY, orbit, moving } = overviewCameraDelta(held, dtMs);
  if (moving) {
    if (panX || panY) app.scene3d.rig.pan(-panX, -panY, canvas.clientHeight || window.innerHeight);
    if (orbit) app.scene3d.rig.orbit(orbit, 0);
  }
}

// --- main loop -----------------------------------------------------------------------

let lastTs = 0;
let lastHourSeen = -1;
// arrival-tutorial senses (reset per game)
let tutLookSpan = 0;
let tutLastYaw = null;
let tutWalked = 0;
let tutLastPos = null;
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
        // the rent: announced two days out, then said out loud when it lands
        const pe = app.state && app.state.lastPropertyEvent;
        if (pe && pe.message) {
          toast(pe.message, pe.missed || pe.severe ? 'warn' : pe.warning ? 'warn' : 'good');
          app.state.lastPropertyEvent = null;
        }
        if (app.clubOpen) clubPanel.refresh();
        if (app.empireOpen) empirePanel.refresh();
        if (app.marketRefresh) app.marketRefresh(); // market left open stays live
        autosave();
      }
      const hourNow = Math.floor(app.state.clock.minutes / 60);
      if (hourNow !== lastHourSeen) {
        lastHourSeen = hourNow;
        app.scene3d.updateTurf(app.state);
        app.scene3d.updateCourseMaintenance(app.state);
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
    // delivery windows tick at minute grain: statuses progress and the truck
    // announces itself — morning heads-up, one-hour warning, arrival
    if (app.state.shop) {
      for (const ev of tickDeliveries(app.state, app.state.clock.minutes)) {
        const sku = skuById(ev.order.skuId);
        const lineNames = (ev.order.lines || [])
          .map((line) => skuById(line.skuId)?.name || line.skuId)
          .filter(Boolean);
        const name = lineNames.length
          ? lineNames.slice(0, 2).join(' + ')
          : (sku ? sku.name : ev.order.skuId);
        const clock12 = (m) => {
          const mm = ((m % 1440) + 1440) % 1440;
          const h = Math.floor(mm / 60);
          return `${((h + 11) % 12) + 1} ${h >= 12 ? 'PM' : 'AM'}`;
        };
        const man = ev.order.manifest;
        const boxes = man ? `${man.boxCount} box${man.boxCount === 1 ? '' : 'es'}` : 'boxes';
        if (ev.kind === 'morning') {
          toast(`📦 ${name} ships today — window ${clock12(ev.order.window.open)}–${clock12(ev.order.window.close)}. ${boxes}, ${man ? `${man.weight} lb` : ''}.`);
        } else if (ev.kind === 'soon') {
          toast(`📦 The ${ev.order.supplier || name} van is close — under an hour out.`);
        } else if (ev.kind === 'arrived' || ev.kind === 'partial-arrival') {
          const clubhouse = app.scene3d && app.scene3d.clubhouse ? app.scene3d.clubhouse() : null;
          if (clubhouse && clubhouse.playDeliveryArrival) clubhouse.playDeliveryArrival(ev);
          const zone = ev.usedFallback ? 'in the safe stockroom receiving zone' : 'on the receiving pad';
          const prefix = ev.kind === 'partial-arrival' ? 'Partial delivery' : 'Delivery';
          const remaining = ev.kind === 'partial-arrival'
            ? ` ${ev.order.remainingUnreceivedQuantity} units remain on the vehicle.`
            : '';
          toast(`📦 ${prefix}! ${name} ×${ev.order.qty} — ${ev.boxes.length} new ${ev.boxes.length === 1 ? 'box' : 'boxes'} ${zone}.${remaining}`);
          if (audio.ready && audio.truck) audio.truck();
        } else if (ev.kind === 'blocked') {
          // The receiving area is blocked. The van did not dump the boxes anyway, and it did not
          // quietly delete them either — the order is still out there and will try again.
          toast(`🚫 The van could not unload — the receiving pad is full. ${name} ×${ev.order.qty} is still on board. Carry some cartons inside.`, 'warn');
        }
      }
    }
    if (walkActive()) {
      app.scene3d.walk.update(dtMs);
      updateWalkOverlay();
      // arrival-chapter senses: real looking and real walking
      if (app.state.tutorial && !app.state.tutorial.complete) {
        const w = app.scene3d.walk.state;
        if (tutLastYaw !== null) {
          let dy = Math.abs(w.yaw - tutLastYaw);
          if (dy > Math.PI) dy = Math.PI * 2 - dy;
          tutLookSpan += dy;
          if (tutLookSpan > 2.6) tutorialFlag(app.state, 'lookedAround');
        }
        tutLastYaw = w.yaw;
        if (tutLastPos) tutWalked += Math.hypot(w.x - tutLastPos.x, w.z - tutLastPos.z);
        tutLastPos = { x: w.x, z: w.z };
        if (tutWalked > 6) tutorialFlag(app.state, 'walkedABit');
      }
    }
    const cal = calendarOf(app.state.clock.minutes);
    app.scene3d.applyTimeWeather(cal.minuteOfDay, app.state.weather);
    if (!app.prewarming) app.scene3d.render(dtMs, app.state); // prewarm owns the GPU behind the veil
    audioClock += dtMs;
    if (audioClock >= 1000) {
      // the guide answers real actions within a second, not at the hour
      if (app.state.tutorial && !app.state.tutorial.complete) {
        const tut = tickTutorial(app.state);
        if (!app.state.tutorial.hidden) {
          for (const step of tut.advanced) toast(`🎯 ${step.title} — done.`);
        }
        if (tut.advanced.length) {
          if (app.state.tutorial.complete && !app.state.tutorial.hidden) {
            toast('The guide retires — the club is yours now. The Open awaits.', '');
          }
          objectivesPanel.refresh();
        }
      }
      const cal2 = calendarOf(app.state.clock.minutes);
      audio.update(audioClock / 1000, {
        minuteOfDay: cal2.minuteOfDay,
        rainIn: app.state.weather.today.rainIn,
        golfersVisible: cal2.minuteOfDay >= 360 && cal2.minuteOfDay <= 1200 ? (app.state.club.lastRounds || 0) : 0,
        inShop: !!(app.scene3d && app.scene3d.clubhouse && app.scene3d.clubhouse()
          && app.scene3d.clubhouse().isInside(app.scene3d.walk.state.x, app.scene3d.walk.state.z)),
        tempHiF: app.state.weather.today.tempHiF,
      });
      if (app.frontDeskOpen) frontDeskUi?.refresh();
      if (maintenancePanel?.isVisible()) maintenancePanel.refresh();
      audioClock = 0;
    }
    hud.update();
  }
  // Weld the interface to the glass. Every frame, unconditionally, for as long as the lid is
  // open — through the camera's ease into the seat, through the lid's swing, through a window
  // resize. A transform that is never cached is a transform that can never go stale.
  if (app.laptopOpen) alignLaptopUi();
  requestAnimationFrame(frame);
}

const CONDITION_WORD = (c) =>
  c < 25 ? 'filthy' : c < 45 ? 'grimy' : c < 70 ? 'getting there' : c < 90 ? 'clean' : 'showroom';
let lastCondWord = null;
let lastPresentationMode = null;
let frontDeskLessonSeen = false;

function registerPrompt() {
  const tx = regApi()?.getTx?.();
  if (!tx) return '';
  const exit = ' · [Esc] step back';
  switch (tx.stage) {
    case 'scanning': {
      const left = registerUnscannedCount(tx);
      return left > 0
        ? `Drag ${left} item${left === 1 ? '' : 's'} through the scanner${exit}`
        : `All items scanned · [T] total the sale${exit}`;
    }
    case 'payment': return `Choose card or cash on the register screen${exit}`;
    case 'card-present': return `Take the customer's card, then use the terminal${exit}`;
    case 'card-ready': return `Run the card through the terminal${exit}`;
    case 'card-busy': return 'Authorising card — please wait';
    case 'card-declined': return `Card declined · try another card or choose cash${exit}`;
    case 'cash-tender': return `Take the customer's cash · [D] open the drawer${exit}`;
    case 'cash-drawer': {
      if (!tx.deposited) return `Put the tender into the open drawer${exit}`;
      const due = registerChangeDue(tx);
      const held = registerHandTotal(tx);
      return due > 0
        ? `Select exactly $${due.toFixed(2)} change · holding $${held.toFixed(2)} · hand it to the customer${exit}`
        : `No change due · close the drawer${exit}`;
    }
    case 'receipt': return `Take the printed receipt${exit}`;
    case 'bagging': return `Place every item in the bag, then take the receipt${exit}`;
    case 'done': return 'Hand the completed order to the customer';
    default: return `Follow the register screen${exit}`;
  }
}

function syncPresentationMode(mode) {
  if (mode === lastPresentationMode) return;
  lastPresentationMode = mode;
  document.body.dataset.uiMode = mode;
  const viewToggle = document.querySelector('.view-toggle');
  if (viewToggle) viewToggle.style.display = mode === 'overview' ? '' : 'none';
  const hint = document.querySelector('.hint-bar');
  if (hint) hint.style.display = mode === 'overview' ? '' : 'none';
  if (mode === 'register' && app.state) triggerContextTutorial(app.state, 'checkout');
  objectivesPanel?.refresh();
}

function updateWalkOverlay() {
  const mode = presentationMode();
  syncPresentationMode(mode);
  if (regHint) {
    const text = mode === 'register' ? registerPrompt() : '';
    setPromptText(regHint, text);
    regHint.style.display = text ? '' : 'none';
    const tx = regApi()?.getTx?.();
    if (tx?.stage === 'done') tutorialFlag(app.state, 'checkoutCompleted');
  }
  // build mode speaks over the world's own prompts: while it is on, the only controls that
  // matter are its controls
  const bld = buildApi();
  const label = ['walk', 'placement'].includes(mode)
    ? ((bld && bld.isActive() && bld.label())
      || (app.scene3d.walk.getFocusLabel ? app.scene3d.walk.getFocusLabel() : null))
    : null;
  setPromptText(walkPrompt, label || '');
  const promptVisible = !!label && !toolWheel?.isOpen();
  if (walkPrompt.dataset.visible !== String(promptVisible)) {
    walkPrompt.dataset.visible = String(promptVisible);
    walkPrompt.style.opacity = promptVisible ? '1' : '0';
  }
  if (label?.includes('check in')) {
    frontDeskLessonSeen = true;
    triggerContextTutorial(app.state, 'front-desk');
    objectivesPanel.refresh();
  } else if (frontDeskLessonSeen && label?.startsWith('Register — yesterday')) {
    tutorialFlag(app.state, 'frontDeskCheckedIn');
    frontDeskLessonSeen = false;
  }
  // the control bar retires once the controls are demonstrably learned
  // (opening arc past the shelving step) — after that it only returns while
  // the pointer is free, as a click-to-play reminder
  const tut = app.state && app.state.tutorial;
  const learned = tut && (tut.complete || tut.hidden || tut.step >= 5);
  const cursorPanelOpen = !!maintenancePanel?.isVisible?.();
  const workingMaintenanceRoute = learned && app.state?.courseMaintenance?.route?.arrivedAtMinute != null;
  const showLockHint = mode === 'walk' && !document.pointerLockElement
    && !cursorPanelOpen && !workingMaintenanceRoute;
  if (walkLockHint.dataset.visible !== String(showLockHint)) {
    walkLockHint.dataset.visible = String(showLockHint);
    walkLockHint.style.display = showLockHint ? '' : 'none';
  }
  const lockText = learned
    ? 'Click to resume looking'
    : 'Click to look · WASD move · E interact · tap/hold F tools · P pause';
  setPromptText(walkLockHint, lockText);
  // inside the shop: the condition chip rides along (and tier-ups chime)
  const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
  const inside = ch && ch.isInside(app.scene3d.walk.state.x, app.scene3d.walk.state.z);
  if (inside && mode === 'walk' && app.state && app.state.shop) {
    if (app.state.tutorial) tutorialFlag(app.state, 'shopWalked');
    const c = shopCondition(app.state);
    const word = CONDITION_WORD(c);
    const conditionText = `Shop condition ${c} — ${word}`;
    if (walkCondition.textContent !== conditionText) walkCondition.textContent = conditionText;
    if (walkCondition.style.display !== '') walkCondition.style.display = '';
    if (lastCondWord && word !== lastCondWord && c >= 25 && audio.ready) audio.chime();
    lastCondWord = word;
  } else {
    if (walkCondition.style.display !== 'none') walkCondition.style.display = 'none';
  }
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
              const record = await inspectData('autosave', SAVE_LIMITS);
              if (!['ok', 'recovered'].includes(record.status)) {
                notify({ message: 'The autosave is unavailable. Use a manual slot from the main menu.', category: 'invalid', persistent: true });
                audio.uiError?.();
                return;
              }
              try {
                const empire = deserializeEmpire(record.data);
                close();
                failShown = false;
                bootEmpire(empire);
              } catch (error) {
                notify({ message: 'The autosave could not be opened. It has not been changed.', category: 'invalid', persistent: true });
                console.error('failure autosave load failed', error);
              }
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
}
window.addEventListener('resize', resize);

function openMenuSettings() {
  modal('Settings', (box, close) => {
    box.classList.add('wide', 'settings-dialog');
    box.append(
      makeSettingsPanel({ preferences, audio, apply: applySettings }),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'primary', type: 'button', text: 'Done', onclick: close }),
      ),
    );
  }, { className: 'menu-dialog settings-dialog', dismissOnBackdrop: false, initialFocus: '.settings-tab' });
}

function boot() {
  menu = makeMenu({
    async onNewGame(mode) {
      // a new empire starts in the property market — the first act is judgment
      app.empire = newEmpire(mode, (Math.random() * 2 ** 31) | 0);
      await autosave();
      openMarketplace(app, handlers);
    },
    async onContinue(data, status) {
      const empire = deserializeEmpire(data);
      if (status === 'recovered') {
        notify({ message: 'The latest autosave was damaged, so the previous backup was restored.', category: 'save-success', persistent: true });
      }
      bootEmpire(empire);
    },
    async onLoad(data, _slot, status) {
      const empire = deserializeEmpire(data);
      if (status === 'recovered') notify({ message: 'Loaded the slot’s recovery backup.', category: 'save-success' });
      bootEmpire(empire);
    },
    onSettings: openMenuSettings,
    onQuit: () => window.fairwayNative?.quit?.(),
  });

  gameUi = el('div', { class: 'game-ui', style: 'display:none' });
  hud = makeHud(app, handlers);
  laptopUi = makeLaptop(app, {
    close: () => exitLaptop(),
    sellHolding: handlers.sellHolding,
    openMarket: () => {
      exitLaptop(true);
      handlers.openMarket();
    },
  });
  frontDeskUi = makeFrontDesk(app, {
    close: () => exitFrontDesk(),
    onCheckedIn(reservationId) {
      const ch = app.scene3d?.clubhouse?.();
      ch?.releaseReservationParty?.(reservationId);
    },
    onWalkInCreated(reservationId, arrivingNow) {
      if (!arrivingNow) return;
      const ch = app.scene3d?.clubhouse?.();
      ch?.spawnReservationParty?.(reservationId, { atCounter: true });
    },
  });
  app.frontDeskUi = frontDeskUi;
  worksPanel = makeWorksPanel(app, handlers);
  inspectPanel = makeInspectPanel(app, recomputeRating);
  groundsPanel = makeGroundsPanel(app);
  clubPanel = makeClubPanel(app, recomputeRating);
  empirePanel = makeEmpirePanel(app, handlers);
  objectivesPanel = makeObjectivesPanel(app, { getContext: presentationMode });
  maintenancePanel = makeCourseMaintenancePanel(app, {
    setVisible: setMaintenanceVisible,
    toggleInspection: () => setMaintenanceVisible(!app.state?.courseMaintenance?.inspection.active),
    selectTool: selectMaintenanceTool,
  });
  toolWheel = makeToolWheel({
    audio,
    onSelect: selectWalkTool,
    onClose: () => {
      if (walkActive() && !regActive() && !app.frontDeskOpen && !app.laptopOpen && !isPauseOpen()) requestLook();
      syncPresentationMode(presentationMode());
    },
  });

  walkPrompt = el('div', { class: 'shop-prompt', text: '' });
  walkCondition = el('div', { class: 'shop-cond', text: '', style: 'display:none' });
  walkLockHint = el('div', { class: 'shop-lockhint', text: 'Click to look · WASD move · E interact · tap/hold F tools · P pause' });
  walkOverlay = el('div', { class: 'shop-overlay', style: 'display:none' },
    el('div', { class: 'shop-crosshair' }),
    walkPrompt,
    walkCondition,
    walkLockHint,
  );

  // BEHIND THE TILL the walk overlay is hidden — no crosshair, no prompt — so the
  // player has no way to discover [T] and [D] except by pressing every key. The
  // register screen tells them WHAT it wants ("PUT THEIR MONEY IN THE TILL"); this
  // tells them which hand to use.
  regHint = el('div', { class: 'reg-hint', style: 'display:none', role: 'status', 'aria-live': 'polite' });

  viewButtons = ['normal', 'health', 'moisture'].map((mode) =>
    el('button', {
      'data-mode': mode,
      text: mode === 'normal' ? '🗺 Normal' : mode === 'health' ? '❤ Health' : '💧 Moisture',
      onclick: () => handlers.setViewMode(mode),
    }),
  );
  viewButtons[0].classList.add('active-tool');
  const viewToggle = el('div', { class: 'view-toggle', style: 'display:none' }, ...viewButtons);

  gameUi.append(hud.root, worksPanel.palette, worksPanel.planBar, inspectPanel.root, groundsPanel.root, clubPanel.root, empirePanel.root, maintenancePanel.root, walkOverlay, regHint, laptopUi.root, frontDeskUi.root, objectivesPanel.root, viewToggle, toolWheel.root,
    el('div', { class: 'hint-bar', style: 'display:none', text: 'Course overview · drag to pan · right-drag to rotate · wheel to zoom · V data view · Tab returns on foot · P pause' }));

  uiRoot.append(menu.root, gameUi);
  requestAnimationFrame(frame);
}

boot();

// Debug/QA hook: lets browser tooling inspect and drive the live app state.
// Harmless in production (read-mostly), invaluable for automated QA.
// the autosave, reachable for tooling. tools/qa/register-recover.js takes the game's
// OWN save mid-transaction — the exact write the day rollover makes — and reloads, to
// prove the shelf comes back. A recovery test that used a different save path would
// be testing the wrong thing.
app.autosave = autosave;
window.__fw = app;
