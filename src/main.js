// GOLF EMPIRE — application bootstrap: screens, game loop, input routing.
// All simulation lives in src/sim/ (headless-testable); this file wires it to
// the 3D course scene, the DOM UI, and the clock. The unit of play is the
// EMPIRE: one wallet, a property market, and whichever owned club is active.

import { BALANCE } from './sim/balance.js';
import { HOLE_STATUS, TURF_ZONES, ZONE } from './sim/constants.js';
import {
  newEmpire, buyProperty, sellProperty, switchProperty, activeState,
  empireUpdate, empireSnapshot, deserializeEmpire,
} from './sim/empire.js';
import { addHole, courseDesignRating, holeNumber } from './sim/course.js';
import { formatMoney } from './core/utils.js';
import { createHeldKeys, overviewCameraDelta, OVERVIEW_KEYS, isTextEntryTarget } from './core/heldKeys.js';
import { calendarOf } from './sim/time.js';
import { el, toast, modal } from './ui/ui.js';
import { makeHud } from './ui/hud.js';
import { makeCourseEditor } from './ui/courseEditor.js';
import { makeInspectPanel } from './ui/inspectPanel.js';
import { makeGroundsPanel } from './ui/groundsPanel.js';
import { makeClubPanel } from './ui/clubPanel.js';
import { makeEmpirePanel } from './ui/empirePanel.js';
import { openMarketplace } from './ui/marketplacePanel.js';
import { makeObjectivesPanel } from './ui/objectivesPanel.js';
import { makeLaptop } from './ui/laptop.js';
import { quadTransform, uvAt } from './core/laptopProjection.js';
import { makeAudio } from './core/audio.js';
import { tickTutorial, tutorialFlag, skipTutorial, replayTutorial } from './sim/tutorial.js';
import { makeMenu } from './screens/menu.js';
import { saveData, loadData } from './core/storage.js';
import { conditionRating, sectionTurfSummary, sectionStatus } from './sim/turf.js';
import { shopCondition, vacuumOwned, tickDeliveries } from './sim/shop.js';
import { ownedWasher } from './sim/washing.js';
import { BELT_ORDER, CLEANING_TOOLS } from './data/cleaningTools.js';
import { skuById } from './data/shopItems.js';
import { makeCourseScene } from './render3d/courseScene.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');

const app = {
  screen: 'menu', // 'menu' | 'game'
  view: 'course', // one continuous world — the shop is a building you walk into
  courseMode: 'walk', // 'walk' (first-person, default) | 'overview' (management rig) | 'editor' (course editor)
  empire: null, // the whole game: wallet, market, holdings
  empireOpen: false,
  state: null, // the ACTIVE property's club state (== activeState(app.empire))
  scene3d: null,
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

function editorActive() {
  return app.courseMode === 'editor';
}

let hud = null;
let editorUi = null;
let editorPrevMode = 'walk';
let editorPrevSpeed = 1;
let inspectPanel = null;
let groundsPanel = null;
let clubPanel = null;
let empirePanel = null;
let walkOverlay = null;
let regHint = null;
let regHintText = null;
let regHintTotal = null;
let regHintDrawer = null;
let laptopUi = null;
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

// build mode, if the clubhouse is up
function buildApi() {
  const ch = app.scene3d && app.scene3d.clubhouse && app.scene3d.clubhouse();
  return ch ? ch.build : null;
}

function boxPlacementApi() {
  const ch = app.scene3d && app.scene3d.clubhouse && app.scene3d.clubhouse();
  return ch ? ch.boxPlacement : null;
}

function hasCarriedCarton() {
  const placement = boxPlacementApi();
  if (placement) return placement.hasCarriedBox();
  return !!app.state?.shop?.deliveries?.boxes?.some((box) => box.loc === 'carried');
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
const WALK_FOV = 66;
const LAPTOP_NEAR = 0.03;
const LAPTOP_FOV = 34;
function setCameraLens(fov, near) {
  const cam = app.scene3d && app.scene3d.camera;
  if (!cam || (cam.fov === fov && cam.near === near)) return;
  cam.fov = fov;
  cam.near = near;
  cam.updateProjectionMatrix();
}

function enterLaptop() {
  if (!walkActive() || app.laptopOpen) return;
  const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
  if (!ch) return;
  // The lens FIRST: the seat distance is derived from the field of view, so asking for the pose
  // before the lens has changed would seat you for a camera that no longer exists.
  setCameraLens(LAPTOP_FOV, LAPTOP_NEAR);
  const pose = seatPose(ch);
  if (!pose) { setCameraLens(WALK_FOV, WALK_NEAR); return; }
  app.laptopOpen = true;
  resetCameraInput(); // sitting down is a mode change too
  if (app.state) tutorialFlag(app.state, 'laptopOpened');
  app.scene3d.walk.focusOn(pose);
  if (document.pointerLockElement) document.exitPointerLock();
  closeLeftPanels('none');
  walkOverlay.style.display = 'none';
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
  for (const t of laptopTimers) clearTimeout(t);
  laptopTimers = [];
  if (laptopResizeHandler) {
    window.removeEventListener('resize', laptopResizeHandler);
    laptopResizeHandler = null;
  }
  laptopUi.close();
  laptopQuad = null;
  const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
  if (ch && ch.laptopScreen) ch.laptopScreen('desk'); // lid stays open, showing the lock screen
  app.scene3d.walk.clearFocus();
  setCameraLens(WALK_FOV, WALK_NEAR); // hand the wide lens back before you stand up
  const vt = document.querySelector('.view-toggle');
  if (vt) vt.style.display = '';
  if (!silent) {
    walkOverlay.style.display = '';
    requestLook();
    if (audio.ready) audio.uiTick();
  }
}

const audio = makeAudio();
app.audio = audio;
// WebAudio needs a user gesture; arm it on the first interaction
for (const evt of ['pointerdown', 'keydown']) {
  window.addEventListener(evt, () => audio.init(), { once: true, capture: true });
}

function closeLeftPanels(except) {
  if (except !== 'grounds' && app.groundsOpen) groundsPanel.setVisible(false);
  if (except !== 'club' && app.clubOpen) clubPanel.setVisible(false);
  if (except !== 'empire' && app.empireOpen) empirePanel.setVisible(false);
}

// --- the course editor: a full mode, like walking or the overview ---------------
function enterEditor() {
  if (editorActive() || !app.scene3d || app.screen !== 'game') return;
  if (hasCarriedCarton()) {
    toast('Set down or recycle the carton before opening the course editor.', 'warn');
    return;
  }
  closePauseMenu();
  closeLeftPanels('none');
  inspectPanel.hide();
  if (app.laptopOpen) exitLaptop(true);
  editorPrevMode = app.courseMode === 'editor' ? 'walk' : app.courseMode;
  editorPrevSpeed = app.speedIdx || 1;
  if (app.courseMode === 'walk') exitWalk();
  app.courseMode = 'editor';
  app.speedIdx = 0; // the world holds its breath while you shape it
  // the editor is a production surface: data heat-maps (health/moisture) are
  // grounds-desk tools and must never tint the design view
  handlers.setViewMode('normal');
  resetCameraInput();
  const hint = document.querySelector('.hint-bar');
  if (hint) hint.style.display = 'none';
  const vt = document.querySelector('.view-toggle');
  if (vt) vt.style.display = 'none';
  hud.root.style.display = 'none'; // the editor bar carries money + clock itself
  objectivesPanel.root.style.display = 'none';
  editorUi.show();
}

function exitEditor() {
  if (!editorActive()) return;
  editorUi.hide();
  hud.root.style.display = '';
  objectivesPanel.root.style.display = '';
  app.speedIdx = editorPrevSpeed || 1;
  resetCameraInput();
  // Editor tools refresh their affected course layers as they are authored,
  // and discard performs its own targeted fullRefresh before reaching here.
  // Rebuilding the entire scene on exit also destroyed and asynchronously
  // reloaded the unchanged clubhouse, causing a large hitch and invalidating
  // otherwise-live checkout/customer presentation state.
  rebuildSectionIndex();
  recomputeRating();
  const vt = document.querySelector('.view-toggle');
  if (vt) vt.style.display = '';
  if (editorPrevMode === 'walk') {
    app.courseMode = 'walk';
    enterWalk('resume');
  } else {
    app.courseMode = 'overview';
    const hint = document.querySelector('.hint-bar');
    if (hint) hint.style.display = '';
  }
  autosave();
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

let sceneStartGeneration = 0;
let pendingSceneBarrier = null;

function destroyCurrentScene({ hideVeil = false } = {}) {
  if (app.laptopOpen) exitLaptop(true);
  const scene = app.scene3d;
  const barrier = scene?.assetBarrier ? scene.assetBarrier(12000) : null;
  if (scene) scene.dispose();
  if (app.scene3d === scene) app.scene3d = null;
  app.prewarming = false;
  if (hideVeil && loadVeil) loadVeil.hide();
  if (barrier && !barrier.idle) {
    const pending = Promise.resolve(barrier.promise).catch(() => {});
    pendingSceneBarrier = pending;
    pending.finally(() => {
      if (pendingSceneBarrier === pending) pendingSceneBarrier = null;
    });
  }
  return pendingSceneBarrier;
}

function startGame(state) {
  closePauseMenu(); // any pause overlay dies with the old world
  const generation = ++sceneStartGeneration;
  const veil = ensureLoadVeil();
  veil.show('Preparing the course');
  app.prewarming = true;
  app.speedIdx = 0;
  resetCameraInput();

  // A single animation-frame callback runs before paint. Yield through two so
  // the opaque veil reaches the screen before teardown and course construction
  // occupy the main thread.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (generation !== sceneStartGeneration) return;
      const barrier = destroyCurrentScene();
      app.prewarming = true; // destroyCurrentScene clears this while disposing
      if (barrier) {
        veil.set('Finishing the previous course load');
        barrier.finally(() => {
          if (generation !== sceneStartGeneration) return;
          startGameNow(state);
        });
        return;
      }
      startGameNow(state);
    });
  });
}

function startGameNow(state) {
  app.state = state;
  app.screen = 'game';
  app.scene3d = makeCourseScene(canvas, state);
  // walk-up inspection: the walking controller asks, the app answers with the
  // same sections and status words the top-down click-to-inspect always used
  app.scene3d.walk.hooks.toast = (msg, kind) => toast(msg, kind);
  // a restrained note when the game had to dig the player out of geometry
  app.scene3d.walk.hooks.recovered = (how) => toast(
    how === 'lastSafe' ? 'Stepped you back to where you last had room.' : 'Moved you clear of the furniture.',
  );
  app.scene3d.walk.hooks.sfx = (name) => { if (audio.ready && audio[name]) audio[name](); };
  app.scene3d.walk.hooks.toolLoop = (kind) => { if (audio.ready) audio.setToolLoop(kind); };
  // the clubhouse's in-world management surfaces route through these
  app.scene3d.walk.hooks.openLaptop = () => enterLaptop();
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
  app.scene3d.walk.hooks.engine = (on, vehicleType = 'tractor') => {
    if (audio.ready) audio.setToolLoop(on ? (vehicleType === 'golf_cart' ? 'electricCart' : 'mower') : null);
  };
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
  if (editorUi && editorUi.isActive()) editorUi.hide();
  app.speedIdx = 1;
  app.viewMode = 'normal';
  app.courseMode = 'walk'; // the course is experienced on foot; Tab for the overview
  if (walkOverlay) walkOverlay.style.display = 'none';
  lastHourSeen = -1;
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
    .prewarm((label) => { if (app.scene3d === sceneRef) veil.set(label); })
    .catch(() => {})
    .finally(() => {
      if (app.scene3d !== sceneRef) return;
      app.prewarming = false;
      veil.hide();
    });
}

// full-screen loading veil (opaque — it also hides the prewarm camera swings)
let loadVeil = null;
function ensureLoadVeil() {
  if (loadVeil) return loadVeil;
  const el = document.createElement('div');
  el.className = 'load-veil';
  el.innerHTML = `
    <div class="load-veil-card">
      <div class="load-veil-logo">GOLF EMPIRE</div>
      <div class="load-veil-title"></div>
      <div class="load-veil-bar"><div class="load-veil-fill"></div></div>
      <div class="load-veil-step"></div>
    </div>`;
  document.body.appendChild(el);
  const title = el.querySelector('.load-veil-title');
  const stepEl = el.querySelector('.load-veil-step');
  const fill = el.querySelector('.load-veil-fill');
  const STEPS = ['Compiling shaders', 'Uploading textures', 'Warming the view'];
  let revision = 0;
  let hideTimer = null;
  loadVeil = {
    show(t) {
      revision += 1;
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = null;
      title.textContent = t || 'Loading';
      stepEl.textContent = 'Building the course';
      fill.style.width = '12%';
      el.style.display = 'flex';
      el.style.opacity = '1';
    },
    set(label) {
      stepEl.textContent = label;
      const i = STEPS.indexOf(label);
      if (i >= 0) fill.style.width = `${25 + (i / STEPS.length) * 70}%`;
    },
    hide() {
      const expectedRevision = revision;
      fill.style.width = '100%';
      el.style.opacity = '0';
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (revision === expectedRevision) el.style.display = 'none';
      }, 420);
    },
  };
  return loadVeil;
}

function exitToMenu() {
  sceneStartGeneration += 1;
  closePauseMenu();
  destroyCurrentScene({ hideVeil: true });
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
  openEditor() {
    enterEditor();
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
    if (app.view !== 'course' || !app.scene3d || editorActive()) return;
    if (app.courseMode === 'walk' && hasCarriedCarton()) {
      toast('Set down or recycle the carton before changing cameras.', 'warn');
      return;
    }
    resetCameraInput(); // the map opens still — nothing carries over from the walk
    if (app.courseMode === 'walk') {
      app.courseMode = 'overview';
      exitWalk();
      toast('Overview camera — Tab returns you to your feet.');
    } else {
      app.courseMode = 'walk';
      enterWalk('resume');
    }
  },
  setViewMode(mode) {
    app.viewMode = mode;
    app.scene3d.setViewMode(mode);
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
// One instance, Esc toggles it, torn down on any mode change. Two panes: section
// nav on the left, content on the right — a commercial pause screen, not a form.

const SLOTS = ['slot1', 'slot2', 'slot3'];
let pauseUi = null;
let pausePrevSpeed = 1;

const SETTINGS_KEY = 'gc-settings';
const settings = { renderScale: 1, ao: true, bloom: true, fov: 60, sens: 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* fresh */ }
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
}
function applySettings() {
  if (!app.scene3d) return;
  // Cap device pixel ratio at 1.5 — the perf ceiling the scene is tuned for. A
  // 4K/retina panel at native DPR quadruples the pixel cost for no visible gain
  // at this art style. renderScale still lets the player trade sharpness for fps.
  app.scene3d.renderer.setPixelRatio(Math.min(1.5, (window.devicePixelRatio || 1) * (settings.renderScale || 1)));
  app.scene3d.resize();
  if (app.scene3d.post) {
    if (app.scene3d.post.gtao) app.scene3d.post.gtao.enabled = settings.ao !== false;
    if (app.scene3d.post.bloom) app.scene3d.post.bloom.enabled = settings.bloom !== false;
  }
  app.scene3d.camera.fov = settings.fov || 60;
  app.scene3d.camera.updateProjectionMatrix();
  if (app.scene3d.walk && app.scene3d.walk.state) app.scene3d.walk.state.sens = settings.sens || 1;
}

function isPauseOpen() { return !!pauseUi; }
function closePauseMenu() {
  if (!pauseUi) return;
  pauseUi.remove();
  pauseUi = null;
  if (app.screen === 'game') app.speedIdx = pausePrevSpeed || 1;
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
  resetCameraInput(); // whatever was down when you hit Esc stays down no longer
  if (pauseUi || app.screen !== 'game') return;
  pausePrevSpeed = app.speedIdx || 1;
  app.speedIdx = 0;

  const content = el('div', { class: 'pause-content' });
  const nav = el('div', { class: 'pause-nav' });
  const navBtns = new Map();

  const setPage = (key) => {
    for (const [k, b] of navBtns) b.classList.toggle('active', k === key);
    content.replaceChildren();
    PAGES[key](content);
  };
  const navItem = (key, label, action) => {
    const b = el('button', { class: 'pause-nav-btn', text: label, onclick: action || (() => setPage(key)) });
    navBtns.set(key, b);
    nav.append(b);
    return b;
  };

  function slotRow(container, mode) {
    container.append(el('div', {
      class: 'pause-hint',
      text: mode === 'save' ? 'Three slots. Saving overwrites the slot.' : 'Load returns you to the moment you saved.',
    }));
    SLOTS.forEach((slot, i) => {
      const card = el('div', { class: 'slot-card' },
        el('div', { class: 'slot-name', text: `Slot ${i + 1}` }),
        el('div', { class: 'slot-meta', text: '…' }),
      );
      const act = el('button', {
        class: mode === 'save' ? 'slot-act primary' : 'slot-act',
        text: mode === 'save' ? 'Save here' : 'Load',
        onclick: async () => {
          if (mode === 'save') {
            await saveData(slot, empireSnapshot(app.empire));
            const st = app.state;
            tutorialFlag(st, 'savedGame');
            await saveData(`${slot}-meta`, {
              name: st.clubName, when: hudClockText(), cash: st.cash,
              cond: st.shop && st.shop.reno ? Math.round(st.shop.reno.condition) : null,
              savedAt: Date.now(),
            });
            toast(`Saved to slot ${i + 1}.`);
            setPage('save');
          } else {
            const data = await loadData(slot);
            if (!data) { toast(`Slot ${i + 1} is empty.`, 'warn'); return; }
            closePauseMenu();
            bootEmpire(deserializeEmpire(data));
          }
        },
      });
      card.append(act);
      container.append(card);
      loadData(`${slot}-meta`).then((meta) => {
        const line = card.querySelector('.slot-meta');
        if (!meta) {
          line.textContent = 'Empty';
          if (mode === 'load') act.disabled = true;
          return;
        }
        const when = new Date(meta.savedAt).toLocaleString();
        line.textContent = `${meta.name} — ${meta.when} — ${formatMoney(meta.cash)}`
          + (meta.cond != null ? ` — shop ${meta.cond}` : '') + `  ·  saved ${when}`;
      }).catch(() => { card.querySelector('.slot-meta').textContent = 'Empty'; });
    });
  }

  function settingRow(label, control) {
    return el('div', { class: 'set-row' }, el('div', { class: 'set-label', text: label }), control);
  }

  const PAGES = {
    save: (c) => slotRow(c, 'save'),
    load: (c) => slotRow(c, 'load'),
    settings: (c) => {
      c.append(
        settingRow('Volume', el('div', { class: 'set-ctl' },
          el('input', {
            type: 'range', min: '0', max: '1', step: '0.05', value: String(audio.getVolume()),
            oninput: (e) => audio.setVolume(Number(e.target.value)),
          }),
          el('button', {
            class: 'chip-btn',
            text: audio.isMuted() ? 'Unmute' : 'Mute',
            onclick: (e) => { audio.setMuted(!audio.isMuted()); e.target.textContent = audio.isMuted() ? 'Unmute' : 'Mute'; },
          }),
        )),
        settingRow('Difficulty', el('div', { class: 'set-ctl' }, ...['relaxed', 'realistic'].map((m) =>
          el('button', {
            class: `chip-btn${app.state.mode === m ? ' on' : ''}`,
            text: m === 'relaxed' ? 'Relaxed' : 'Realistic',
            onclick: () => { app.state.mode = m; setPage('settings'); },
          })))),
        settingRow('Render scale', el('div', { class: 'set-ctl' }, ...[0.75, 1, 1.25].map((v) =>
          el('button', {
            class: `chip-btn${settings.renderScale === v ? ' on' : ''}`,
            text: `${Math.round(v * 100)}%`,
            onclick: () => { settings.renderScale = v; saveSettings(); applySettings(); setPage('settings'); },
          })))),
        settingRow('Ambient occlusion', el('div', { class: 'set-ctl' },
          el('button', {
            class: `chip-btn${settings.ao !== false ? ' on' : ''}`,
            text: settings.ao !== false ? 'On' : 'Off',
            onclick: () => { settings.ao = settings.ao === false; saveSettings(); applySettings(); setPage('settings'); },
          }))),
        settingRow('Bloom', el('div', { class: 'set-ctl' },
          el('button', {
            class: `chip-btn${settings.bloom !== false ? ' on' : ''}`,
            text: settings.bloom !== false ? 'On' : 'Off',
            onclick: () => { settings.bloom = settings.bloom === false; saveSettings(); applySettings(); setPage('settings'); },
          }))),
        settingRow('Field of view', el('div', { class: 'set-ctl' },
          el('input', {
            type: 'range', min: '50', max: '90', step: '1', value: String(settings.fov || 60),
            oninput: (e) => { settings.fov = Number(e.target.value); saveSettings(); applySettings(); },
          }),
          el('span', { class: 'set-val', text: `${settings.fov || 60}°` }),
        )),
        settingRow('Mouse sensitivity', el('div', { class: 'set-ctl' },
          el('input', {
            type: 'range', min: '0.4', max: '2', step: '0.1', value: String(settings.sens || 1),
            oninput: (e) => { settings.sens = Number(e.target.value); saveSettings(); applySettings(); },
          }),
        )),
        settingRow('Tutorial', el('div', { class: 'set-ctl' },
          el('button', {
            class: 'chip-btn',
            text: app.state.tutorial && app.state.tutorial.complete ? 'Replay the guide' : 'Skip the guide',
            onclick: () => {
              if (app.state.tutorial && app.state.tutorial.complete) replayTutorial(app.state);
              else skipTutorial(app.state);
              objectivesPanel.refresh();
              setPage('settings');
            },
          }))),
      );
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
            ['Capture the mouse', 'Click'], ['Overview camera (hands free)', 'Tab'],
          ]),
          group('Hands', [
            ['Interact · pick up · place', 'E'], ['Reposition closed carton', 'X'],
            ['Rotate carton placement', 'R'],
            ['Cancel preview · keep carrying', 'Esc'],
            ['Cycle tool', 'F'], ['Use tool', 'Hold LMB'],
          ]),
          group('Time & views', [
            ['Pause', 'Space'], ['Speed', '1', '2', '3'], ['Data views', 'V'],
          ]),
          group('Desks', [
            ['Course editor (hands free)', 'J'],
            ['Grounds desk', 'G'], ['Club office', 'C'], ['Empire', 'M'], ['This menu', 'Esc'],
          ]),
        ),
      );
    },
    office: (c) => {
      c.append(
        el('div', { class: 'pause-hint', text: 'Management shortcuts and the way out.' }),
        el('button', {
          class: 'pause-wide',
          text: '🧭 Get me unstuck',
          onclick: () => {
            const w = app.scene3d && app.scene3d.walk;
            if (!w || !w.unstick) return;
            const how = w.unstick();
            closePauseMenu();
            toast(how ? 'Freed you up — back on solid ground.' : 'Nowhere clear to move you to.', how ? 'good' : 'warn');
          },
        }),
        el('button', {
          class: 'pause-wide',
          text: 'Empire overview',
          onclick: () => { closePauseMenu(); handlers.toggleEmpire(); },
        }),
        el('button', {
          class: 'pause-wide danger',
          text: 'Exit to main menu (autosaves)',
          onclick: async () => { await autosave(); closePauseMenu(); exitToMenu(); },
        }),
      );
    },
  };

  navItem('resume', 'Resume', () => closePauseMenu());
  navItem('save', 'Save game');
  navItem('load', 'Load game');
  navItem('settings', 'Settings');
  navItem('controls', 'Controls');
  navItem('office', 'Office');

  const panel = el('div', { class: 'pause-panel' },
    el('div', { class: 'pause-head' },
      el('div', { class: 'pause-club', text: (app.state && app.state.clubName) || 'GOLF EMPIRE' }),
      el('div', { class: 'pause-word', text: 'PAUSED' }),
    ),
    el('div', { class: 'pause-body' }, nav, content),
  );
  pauseUi = el('div', { class: 'pause-veil-ui' }, panel);
  pauseUi.addEventListener('pointerdown', (e) => { if (e.target === pauseUi) closePauseMenu(); });
  document.getElementById('ui').append(pauseUi);
  setPage('save');
}

// --- input ------------------------------------------------------------------------

let dragging = null; // { mode: 'pan'|'orbit'|'pan-or-click', lastX, lastY, moved, cell }
let handledPlacementPointer = false;

function refreshHover(clientX, clientY) {
  if (!app.scene3d) return;
  const hit = app.scene3d.raycastCell(clientX, clientY);
  app.hoverCell = hit ? { x: hit.x, y: hit.y } : null;
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

canvas.addEventListener('click', () => {
  if (handledPlacementPointer) {
    handledPlacementPointer = false;
    return;
  }
  // first-person walking: clicking (re)captures the mouse — but NOT while the player
  // is behind the till, where the cursor is the whole interface
  if (regActive() || editorActive()) return;
  if (app.screen === 'game' && !document.pointerLockElement && walkActive()) {
    requestLook();
    return;
  }
  // Pointer already captured and the crosshair is on the laptop: a click opens it, exactly
  // like [E]. Only the laptop gets the click verb — everything else keeps its established
  // key so a stray click can't fling boxes or swing doors.
  if (app.screen === 'game' && document.pointerLockElement && walkActive()
    && !app.laptopOpen && app.courseMode !== 'overview') {
    const placement = boxPlacementApi();
    if (placement?.hasCarriedBox()) return;
    const bld = buildApi();
    if (bld && bld.isActive()) return; // build placement owns the mouse
    if (app.scene3d.walk.getTool && app.scene3d.walk.getTool()) return; // so does a held tool
    const label = app.scene3d.walk.getFocusLabel && app.scene3d.walk.getFocusLabel();
    if (label && /laptop/i.test(label) && app.scene3d.walk.interact) app.scene3d.walk.interact(false);
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (app.screen !== 'game') return;
  if (editorActive()) return; // the editor owns its own pointer plumbing
  if (regActive()) { e.preventDefault(); regApi().onDown(e); return; }
  if (app.courseMode !== 'overview') {
    const placement = boxPlacementApi();
    if (walkActive() && placement?.hasCarriedBox()) {
      if (e.button === 0) {
        e.preventDefault();
        handledPlacementPointer = true;
        if (placement.isActive()) placement.commit();
        else placement.activate();
      } else if (e.button === 2 && placement.isActive()) {
        e.preventDefault();
        placement.cancel();
      }
      return;
    }
    // walking with any tool out: the held button is the use trigger
    const bld = buildApi();
    if (bld && bld.isActive()) {
      if (e.button === 0) bld.interact(); // put it down where you're pointing
      else if (e.button === 2) bld.cancel(); // changed your mind
      return;
    }
    const tool = walkActive() && app.scene3d.walk.getTool();
    if (e.button === 0 && tool) {
      app.scene3d.walk.setSpraying(true);
      if (audio.ready) audio.setToolLoop(tool);
    } else if (e.button === 2 && tool === 'washer') {
      // right button on the washer lays soap, for the stains water alone won't touch
      e.preventDefault();
      app.scene3d.walk.setSoaping(true);
      if (audio.ready) audio.setToolLoop('soap');
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
  }
  dragging.lastX = e.clientX;
  dragging.lastY = e.clientY;
});

window.addEventListener('pointerup', (e) => {
  if (regActive()) { regApi().onUp(e); return; }
  if (walkActive() && app.scene3d.walk.isSpraying()) app.scene3d.walk.setSpraying(false);
  if (walkActive() && app.scene3d.walk.isSoaping && app.scene3d.walk.isSoaping()) app.scene3d.walk.setSoaping(false);
  if (audio.ready) audio.setToolLoop(null);
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
  if (editorActive()) return; // the editor's own wheel handler zooms
  if (regActive()) {
    e.preventDefault();
    regApi().onWheel(e.deltaY, e.shiftKey);
    return;
  }
  if (app.screen !== 'game' || app.view !== 'course' || app.courseMode !== 'overview') return;
  e.preventDefault();
  app.scene3d.rig.dolly(e.deltaY > 0 ? 1.13 : 1 / 1.13);
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (app.screen !== 'game') return;
  if (editorActive()) return; // the editor's capture-phase handler owns the keys
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;

  // BEHIND THE TILL, THE TILL OWNS THE ACTION KEYS — but not the feet. WASD
  // reaches the walk controller through its own listener (walkHeld), so the
  // cashier can shuffle along the counter mid-transaction; Tab stays blocked
  // (swapping to the overview from behind the till is never what you meant).
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
    // A carried delivery carton owns placement before build mode or ordinary
    // world props. This prevents one E press from both committing the exact
    // green preview and firing the old nearest-prop interaction underneath it.
    const placement = boxPlacementApi();
    if (placement?.hasCarriedBox()) {
      switch (e.key) {
        case 'e': case 'E':
          e.preventDefault();
          if (e.repeat) return;
          if (placement.isActive()) placement.commit();
          else placement.activate();
          return;
        case 'r': case 'R':
          e.preventDefault();
          if (e.repeat) return;
          if (!placement.isActive()) placement.activate();
          placement.rotate();
          return;
        case 'Escape':
          if (placement.isActive()) {
            e.preventDefault();
            placement.cancel();
            return;
          }
          break;
        case 'b': case 'B':
          toast('Set down or recycle the carton before rearranging fixtures.', 'warn');
          return;
        default: break;
      }
    }

    // build mode owns the verbs while it is on: E places, R turns, X stows
    const bld = buildApi();
    if (bld && bld.isActive()) {
      switch (e.key) {
        case 'e': case 'E':
          e.preventDefault();
          if (!e.repeat) bld.interact();
          return;
        case 'r': case 'R':
          e.preventDefault();
          if (!e.repeat) bld.rotate(e.shiftKey);
          return;
        case 'x': case 'X':
          e.preventDefault();
          if (!e.repeat) bld.stow();
          return;
        case 'i': case 'I':
          e.preventDefault();
          if (!e.repeat) bld.toggleInventory();
          return;
        case 'ArrowUp': case 'ArrowLeft':
          e.preventDefault();
          if (!e.repeat) bld.cycleInventory(-1);
          return;
        case 'ArrowDown': case 'ArrowRight':
          e.preventDefault();
          if (!e.repeat) bld.cycleInventory(1);
          return;
        case 'Delete': case 'Backspace':
          e.preventDefault();
          if (!e.repeat) bld.sellSelected();
          return;
        case 'z': case 'Z':
          e.preventDefault();
          if (!e.repeat) bld.undo();
          return;
        case 'b': case 'B':
          e.preventDefault();
          bld.exit();
          toast('Back to work.');
          return;
        case 'Escape':
          e.preventDefault();
          if (bld.isInventoryOpen() || bld.isCarrying()) bld.cancel();
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
      case 'x': case 'X':
        if (app.scene3d.walk.interactSecondary) app.scene3d.walk.interactSecondary(e.repeat);
        break;
      case 'j': case 'J': // the drafting table: open the course editor from your feet
        enterEditor();
        break;
      case 'b': case 'B': {
        const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
        const w = app.scene3d.walk.state;
        if (!ch || !ch.isInside(w.x, w.z)) {
          toast('Rearranging is for indoors.', 'warn');
          break;
        }
        ch.build.enter();
        break;
      }
      case 'r': case 'R': {
        // at the register in Realistic mode, R hands over the counted change
        const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
        if (ch && ch.confirmChange) ch.confirmChange();
        break;
      }
      case 'f': case 'F': {
        const walkApi = app.scene3d.walk;
        if (!walkApi.cart.mounted) {
          if (walkApi.getTool() === 'boxcutter') {
            walkApi.setTool(null);
            if (audio.ready) audio.equipTick();
            toast('Box cutter put away.');
            break;
          }
          // The tool belt. Indoors you cycle the cleaning kit; outdoors the groundskeeping tools
          // plus the washer. The cleaning half is driven by the registry, so a new tool joins the
          // belt and gets its own equip line by existing — no edit here.
          const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
          const inside = ch && ch.isInside(walkApi.state.x, walkApi.state.z);
          let belt;
          if (inside) {
            if (!(app.state && vacuumOwned(app.state))) {
              toast('No cleaning kit here yet — order one at the office computer.', 'warn');
              break;
            }
            // indoor cleaning tools, in the registry's own order
            belt = [null, ...BELT_ORDER.filter(
              (id) => id && !CLEANING_TOOLS[id].external && CLEANING_TOOLS[id].indoorOnly !== false,
            )];
          } else {
            belt = [null, 'washer', 'hose', 'divot', 'rake'];
          }
          const cur = belt.indexOf(walkApi.getTool());
          const next = belt[(cur + 1) % belt.length];
          walkApi.setTool(next);
          if (audio.ready) audio.equipTick();
          const washer = app.state ? ownedWasher(app.state) : null;
          const def = next ? CLEANING_TOOLS[next] : null;
          toast(next === 'hose' ? 'Hose out — hold the mouse button to water.'
            : next === 'divot' ? 'Divot kit out — hold the button on worn turf.'
            : next === 'rake' ? 'Bunker rake out — hold the button on footprinted sand.'
            : next === 'washer' ? `${washer ? washer.name : 'Pressure washer'} — hold LEFT to blast, RIGHT to lay soap on the heavy stains.`
            : def ? `${def.label} out — ${def.equipToast}`
            : 'Tools away.', 'tool');
        }
        break;
      }
      case 'l': case 'L':
        if (!e.repeat && app.scene3d.walk.toggleVehicleLights) app.scene3d.walk.toggleVehicleLights();
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
    case 'j': case 'J':
      enterEditor();
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
  // text typed into a field is not camera input (see heldKeys rule 3)
  if (isTextEntryTarget(e.target)) return;
  held.down(e.key, e.repeat);
});
window.addEventListener('keyup', (e) => held.up(e.key));
window.addEventListener('blur', () => {
  resetCameraInput();
  const reg = regApi();
  if (reg && reg.isActive()) reg.recoverInput('focus loss');
});
document.addEventListener('pointerlockchange', () => {
  resetCameraInput();
  // behind the till the CURSOR is the interface — never let a stray relock
  // swallow it while the register is active
  if (regActive() && document.pointerLockElement) document.exitPointerLock();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  const reg = regApi();
  if (reg && reg.isActive()) reg.recoverInput('tab change');
});

// every mode transition hands the camera a clean slate: nothing is "still down" from the mode
// you just left, and a half-finished drag cannot resume into the new one.
function resetCameraInput() {
  held.clear();
  dragging = null;
  const w = app.scene3d && app.scene3d.walk;
  if (w && w.clearKeys) w.clearKeys(); // ...and the feet, so a paused stride doesn't resume
}

function keyboardCamera(dtMs) {
  if (app.screen !== 'game' || app.view !== 'course' || !app.scene3d) return;
  if (app.courseMode !== 'overview' && !(editorActive() && !editorUi.isPlaytesting())) return;
  const { panX, panY, orbit, moving } = overviewCameraDelta(held, dtMs);
  if (moving) {
    // Hand-driving the camera has to retire the active preset, exactly as every
    // editor-side camera write already does. Without this the preset survives,
    // and the next resize() re-applies it (frameCourse / frameHole / flyover) —
    // so the view snaps back to where it was before the player panned.
    app.scene3d.clearCourseCameraPreset?.();
    if (panX || panY) app.scene3d.rig.pan(-panX, -panY, canvas.clientHeight || window.innerHeight);
    if (orbit) app.scene3d.rig.orbit(orbit, 0);
  }
}

// --- main loop -----------------------------------------------------------------------

let lastTs = 0;
let lastHourSeen = -1;
let autosaveClock = 0;
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
        app.scene3d.updateHoles();
        announceReopenings();
        announceOutbreaks();
        checkBigMoments();
        const shopEvent = app.state.lastShopProgressionEvent;
        if (shopEvent) {
          if (shopEvent.kind === 'complete') app.scene3d.clubhouse()?.refreshShopProgression?.();
          toast(shopEvent.message, shopEvent.kind === 'blocked' ? 'warn' : 'good');
          app.state.lastShopProgressionEvent = null;
        }
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
        autosaveClock = 0;
      }
      // At a 2×-real clock a nightly autosave is half a wall-day apart — too much to
      // lose to a crash. A quiet save every five real minutes bounds the damage.
      autosaveClock += dtMs;
      if (autosaveClock >= 300000) {
        autosaveClock = 0;
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
    // delivery windows tick at minute grain: statuses progress and the truck
    // announces itself — morning heads-up, one-hour warning, arrival
    if (app.state.shop) {
      for (const ev of tickDeliveries(app.state, app.state.clock.minutes)) {
        const sku = skuById(ev.order.skuId);
        const name = sku ? sku.name : ev.order.skuId;
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
        } else if (ev.kind === 'arrived') {
          toast(`📦 Delivery inbound! ${name} ×${ev.order.qty} — the van is turning into receiving with ${boxes}.`);
          const clubhouse = app.scene3d && app.scene3d.clubhouse
            ? app.scene3d.clubhouse() : null;
          const presented = clubhouse && clubhouse.presentDeliveryArrival
            ? clubhouse.presentDeliveryArrival({
              orderId: ev.order.id,
              skuId: ev.order.skuId,
              name,
              qty: ev.order.qty,
              boxCount: man ? man.boxCount : 1,
              supplier: ev.order.supplier || man?.supplier || null,
            })
            : false;
          // The authored runtime owns the brake-beat sound. Keep the old cue as
          // a reliable fallback if the model is unavailable or the scene is rebuilding.
          if (!presented && audio.ready && audio.truck) audio.truck();
        } else if (ev.kind === 'blocked') {
          // The receiving area is blocked. The van did not dump the boxes anyway, and it did not
          // quietly delete them either — the order is still out there and will try again.
          toast(`🚫 The van could not unload — the receiving pad is full. ${name} ×${ev.order.qty} is still on board. Carry some cartons inside.`, 'warn');
        }
      }
    }
    if (editorUi) editorUi.onFrame(dtMs); // compass, power bar, the flying ball
    if (walkActive()) {
      app.scene3d.walk.update(dtMs);
      updateWalkOverlay(dtMs);
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
        for (const step of tut.advanced) toast(`🎯 ${step.title} — done.`);
        if (tut.advanced.length) {
          if (app.state.tutorial.complete) toast('The guide retires — the club is yours now. The Open awaits.', '');
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

// The overlay runs every frame, so it must cost nothing when nothing changed: element
// lookups are cached once, every DOM write is guarded by a last-value check (an identical
// textContent assignment still rebuilds the text node and dirties layout), and the shop
// condition — a whole grime-grid scan — is polled at 4Hz instead of 90.
const ovEl = { prompt: null, lockHint: null, cond: null, propertyInventory: null };
const ovLast = {
  prompt: null, opacity: null, lockDisp: null, lockText: null,
  condText: null, condDisp: null, propertyInventoryText: null, propertyInventoryDisplay: null,
};
let condClock = 0;
function updateWalkOverlay(dtMs = 16.7) {
  const registerActive = regActive();
  const registerDisplay = registerActive ? 'flex' : 'none';
  if (regHint && regHint.style.display !== registerDisplay) regHint.style.display = registerDisplay;
  if (registerActive) {
    const register = regApi();
    const hint = register && register.hint ? register.hint() : null;
    const hintText = (hint && hint.text) || 'Work the physical register';
    const totalDisplay = hint && hint.total ? '' : 'none';
    const drawerDisplay = hint && hint.drawer ? '' : 'none';
    if (regHintText && regHintText.textContent !== hintText) regHintText.textContent = hintText;
    if (regHintTotal && regHintTotal.style.display !== totalDisplay) regHintTotal.style.display = totalDisplay;
    if (regHintDrawer && regHintDrawer.style.display !== drawerDisplay) regHintDrawer.style.display = drawerDisplay;
  }
  if (!ovEl.prompt) {
    ovEl.prompt = walkOverlay.querySelector('.shop-prompt');
    ovEl.lockHint = walkOverlay.querySelector('.shop-lockhint');
    ovEl.cond = walkOverlay.querySelector('.shop-cond');
    ovEl.propertyInventory = walkOverlay.querySelector('.property-inventory');
  }
  // build mode speaks over the world's own prompts: while it is on, the only controls that
  // matter are its controls
  const placement = boxPlacementApi();
  const bld = buildApi();
  const propertyInventoryText = bld?.inventoryText ? bld.inventoryText() : '';
  const propertyInventoryDisplay = propertyInventoryText ? '' : 'none';
  if (propertyInventoryText !== ovLast.propertyInventoryText) {
    ovLast.propertyInventoryText = propertyInventoryText;
    ovEl.propertyInventory.textContent = propertyInventoryText;
  }
  if (propertyInventoryDisplay !== ovLast.propertyInventoryDisplay) {
    ovLast.propertyInventoryDisplay = propertyInventoryDisplay;
    ovEl.propertyInventory.style.display = propertyInventoryDisplay;
  }
  const label = (placement?.hasCarriedBox() && placement.label())
    || (bld && bld.isActive() && bld.label())
    || (app.scene3d.walk.getFocusLabel ? app.scene3d.walk.getFocusLabel() : null)
    || '';
  if (label !== ovLast.prompt) {
    ovLast.prompt = label;
    ovEl.prompt.textContent = label;
  }
  // A focus prompt only has meaning while mouse-look owns the pointer. When
  // the pointer is free, "Click to play" is the single actionable instruction;
  // stacking both bars made the queue/customer name unreadable.
  const opacity = label && document.pointerLockElement ? '1' : '0';
  if (opacity !== ovLast.opacity) {
    ovLast.opacity = opacity;
    ovEl.prompt.style.opacity = opacity;
  }
  // the control bar retires once the controls are demonstrably learned
  // (opening arc past the shelving step) — after that it only returns while
  // the pointer is free, as a click-to-play reminder
  const tut = app.state && app.state.tutorial;
  const learned = tut && (tut.complete || tut.hidden || tut.step >= 5);
  const lockDisp = document.pointerLockElement ? 'none' : '';
  if (lockDisp !== ovLast.lockDisp) {
    ovLast.lockDisp = lockDisp;
    ovEl.lockHint.style.display = lockDisp;
  }
  const lockText = learned
    ? (placement?.hasCarriedBox()
      ? 'Click to play · Carrying carton: E place · R rotate · Esc keep carrying'
      : 'Click to play')
    : (placement?.hasCarriedBox()
      ? 'Click to look around · WASD walk · E place · R rotate · Esc keep carrying'
      : 'Click to look around · WASD walk · Shift run · E interact · F tool · J course editor · Tab overview · Esc menu');
  if (lockText !== ovLast.lockText) {
    ovLast.lockText = lockText;
    ovEl.lockHint.textContent = lockText;
  }
  // inside the shop: the condition chip rides along (and tier-ups chime) — 4Hz is plenty
  condClock += dtMs;
  if (condClock >= 250) {
    condClock = 0;
    const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
    const inside = ch && ch.isInside(app.scene3d.walk.state.x, app.scene3d.walk.state.z);
    let condText = null;
    if (inside && app.state && app.state.shop) {
      if (app.state.tutorial) tutorialFlag(app.state, 'shopWalked');
      const c = shopCondition(app.state);
      const word = CONDITION_WORD(c);
      condText = `🧹 Shop condition ${c} — ${word}`;
      if (lastCondWord && word !== lastCondWord && c >= 25 && audio.ready) audio.chime();
      lastCondWord = word;
    }
    if (condText !== ovLast.condText) {
      ovLast.condText = condText;
      if (condText) ovEl.cond.textContent = condText;
    }
    const condDisp = condText ? '' : 'none';
    if (condDisp !== ovLast.condDisp) {
      ovLast.condDisp = condDisp;
      ovEl.cond.style.display = condDisp;
    }
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

// Debounce resize: a window drag fires dozens of resize events per second, and
// each one re-allocates the renderer + composer buffers (expensive, and a source
// of judder while dragging). Coalesce them to one setSize after motion settles,
// with a light immediate pass so the aspect never looks stretched mid-drag.
let resizeTimer = 0;
let resizeCoarse = 0;
function resize() {
  if (!app.scene3d) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  if (now - resizeCoarse > 120) { // at most ~8 immediate passes/sec while dragging
    resizeCoarse = now;
    app.scene3d.resize();
  }
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (app.scene3d) app.scene3d.resize(); }, 160);
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
  laptopUi = makeLaptop(app, {
    close: () => exitLaptop(),
    // The Course page's "Open the works desk": the laptop closes cleanly and the real
    // course editor takes the screen — same enterEditor every other entry point uses.
    openCourseEditor: () => enterEditor(),
    refreshShopProgression: () => {
      const result = app.scene3d?.clubhouse?.()?.refreshShopProgression?.();
      autosave();
      return result;
    },
    buyProperty: (propertyId) => handlers.buyFromMarket(propertyId),
    switchProperty: (propertyId) => handlers.switchTo(propertyId),
    sellProperty: (propertyId) => handlers.sellHolding(propertyId, app.speedIdx || 1),
    autosave: () => autosave(),
  });
  editorUi = makeCourseEditor(app, {
    onExit: () => exitEditor(),
    afterApply: () => {
      // The editor has already applied every visual mutation live. Build only
      // settles economics/renovation metadata, so keep the scene and clubhouse.
      rebuildSectionIndex();
      recomputeRating();
      autosave();
    },
    autosave: () => autosave(),
  });
  inspectPanel = makeInspectPanel(app, recomputeRating);
  groundsPanel = makeGroundsPanel(app);
  clubPanel = makeClubPanel(app, recomputeRating);
  empirePanel = makeEmpirePanel(app, handlers);
  objectivesPanel = makeObjectivesPanel(app);

  walkOverlay = el('div', { class: 'shop-overlay', style: 'display:none' },
    el('div', { class: 'shop-crosshair' }),
    el('div', { class: 'shop-prompt', text: '' }),
    el('div', { class: 'property-inventory', text: '', style: 'display:none' }),
    el('div', { class: 'shop-cond', text: '', style: 'display:none' }),
    el('div', { class: 'shop-lockhint', text: 'Click to look around · WASD walk · Shift run · E interact · F tool · J course editor · Tab overview · Esc menu' }),
  );

  // BEHIND THE TILL the walk overlay is hidden — no crosshair, no prompt — so the
  // player has no way to discover [T] and [D] except by pressing every key. The
  // register screen tells them WHAT it wants ("PUT THEIR MONEY IN THE TILL"); this
  // tells them which hand to use.
  regHintText = el('span', { text: 'Work the physical register' });
  regHintTotal = el('span', { class: 'reg-keys' }, el('kbd', { text: 'T' }), el('span', { text: 'total up' }));
  regHintDrawer = el('span', { class: 'reg-keys' }, el('kbd', { text: 'D' }), el('span', { text: 'drawer' }));
  regHint = el('div', { class: 'reg-hint', style: 'display:none' },
    regHintText,
    regHintTotal,
    regHintDrawer,
    el('span', { class: 'reg-keys' }, el('kbd', { text: 'Esc' }), el('span', { text: 'step back' })),
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

  gameUi.append(hud.root, inspectPanel.root, groundsPanel.root, clubPanel.root, empirePanel.root, walkOverlay, regHint, laptopUi.root, objectivesPanel.root, viewToggle, editorUi.root,
    el('div', { class: 'hint-bar', text: 'Overview camera — Drag: pan · Right-drag: rotate · Wheel: zoom · E: course editor · G/C/M: desks · V: view · Space: pause · Tab/Esc: back on foot' }));

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
app.editorUi = () => editorUi; // QA hook: drive the editor from tooling
