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
import { createHeldKeys, overviewCameraDelta, OVERVIEW_KEYS } from './core/heldKeys.js';
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
import { skuById } from './data/shopItems.js';
import { makeCourseScene } from './render3d/courseScene.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');

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
  sectionIndex: null,
  sectionsRef: null,
};

let hud = null;
let worksPanel = null;
let inspectPanel = null;
let groundsPanel = null;
let clubPanel = null;
let empirePanel = null;
let walkOverlay = null;
let regHint = null;
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
  if (except !== 'works' && app.worksMode) handlers.toggleWorks();
  if (except !== 'grounds' && app.groundsOpen) groundsPanel.setVisible(false);
  if (except !== 'club' && app.clubOpen) clubPanel.setVisible(false);
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
  closePauseMenu(); // any pause overlay dies with the old world
  if (app.scene3d) {
    app.scene3d.dispose();
    app.scene3d = null;
  }
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
  app.plan = makePlan();
  app.worksMode = false;
  app.activeTool = null;
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
  if (worksPanel) worksPanel.setVisible(false);
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
  loadVeil = {
    show(t) {
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
      fill.style.width = '100%';
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; }, 420);
    },
  };
  return loadVeil;
}

function exitToMenu() {
  closePauseMenu();
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
  app.scene3d.renderer.setPixelRatio(Math.min(2.5, (window.devicePixelRatio || 1) * (settings.renderScale || 1)));
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
            ['Capture the mouse', 'Click'], ['Overview camera', 'Tab'],
          ]),
          group('Hands', [
            ['Interact · doors · laptop', 'E'], ['Pick up / set down a box', 'E'],
            ['Cycle tool', 'F'], ['Use tool', 'Hold LMB'],
          ]),
          group('Time & views', [
            ['Pause', 'Space'], ['Speed', '1', '2', '3'], ['Data views', 'V'],
          ]),
          group('Desks', [
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

canvas.addEventListener('click', () => {
  // first-person walking: clicking (re)captures the mouse — but NOT while the player
  // is behind the till, where the cursor is the whole interface
  if (regActive()) return;
  if (app.screen === 'game' && !document.pointerLockElement && walkActive()) {
    requestLook();
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (app.screen !== 'game') return;
  if (regActive()) { e.preventDefault(); regApi().onDown(e); return; }
  if (app.courseMode !== 'overview') {
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
  if (app.screen !== 'game' || app.view !== 'course' || app.courseMode !== 'overview') return;
  e.preventDefault();
  app.scene3d.rig.dolly(e.deltaY > 0 ? 1.13 : 1 / 1.13);
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (app.screen !== 'game') return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;

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
    // build mode owns the verbs while it is on: E places, R turns, X stows
    const bld = buildApi();
    if (bld && bld.isActive()) {
      switch (e.key) {
        case 'e': case 'E': bld.interact(); return;
        case 'r': case 'R': bld.rotate(); return;
        case 'x': case 'X': bld.stow(); return;
        case 'b': case 'B': bld.exit(); toast('Back to work.'); return;
        case 'Escape':
          if (bld.isCarrying()) bld.cancel();
          else bld.exit();
          return;
        default: break; // WASD still walks: you carry the fixture with you
      }
    }

    // first-person course: E is the interaction verb (shop convention)
    switch (e.key) {
      case 'e': case 'E':
        if (app.scene3d.walk.interact) app.scene3d.walk.interact();
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
          // the tool belt: inside the shop it's hands ↔ vacuum; outside it
          // cycles hose → divot kit → bunker rake → hands free
          const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
          const inside = ch && ch.isInside(walkApi.state.x, walkApi.state.z);
          let belt;
          if (inside) {
            if (!(app.state && vacuumOwned(app.state))) {
              toast('No vacuum here yet — order one at the office computer.', 'warn');
              break;
            }
            belt = [null, 'vacuum'];
          } else {
            belt = [null, 'washer', 'hose', 'divot', 'rake'];
          }
          const cur = belt.indexOf(walkApi.getTool());
          const next = belt[(cur + 1) % belt.length];
          walkApi.setTool(next);
          if (audio.ready) audio.equipTick();
          const washer = app.state ? ownedWasher(app.state) : null;
          toast(next === 'hose' ? 'Hose out — hold the mouse button to water.'
            : next === 'divot' ? 'Divot kit out — hold the button on worn turf.'
            : next === 'rake' ? 'Bunker rake out — hold the button on footprinted sand.'
            : next === 'vacuum' ? 'Vacuum out — hold the mouse button and work the dirty patches.'
            : next === 'washer' ? `${washer ? washer.name : 'Pressure washer'} — hold LEFT to blast, RIGHT to lay soap on the heavy stains.`
            : 'Tools away.');
        }
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
window.addEventListener('keydown', (e) => held.down(e.key, e.repeat));
window.addEventListener('keyup', (e) => held.up(e.key));
window.addEventListener('blur', () => resetCameraInput());
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
        if (ev.kind === 'morning') {
          toast(`📦 ${name} ships today — window ${clock12(ev.order.window.open)}–${clock12(ev.order.window.close)}.`);
        } else if (ev.kind === 'soon') {
          toast(`📦 The ${name} truck is close — under an hour out.`);
        } else if (ev.kind === 'arrived') {
          toast(`📦 Delivery! ${name} ×${ev.order.qty} is on the receiving pad.`);
          if (audio.ready && audio.thunk) audio.thunk();
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

function updateWalkOverlay() {
  if (regHint) regHint.style.display = regActive() ? 'flex' : 'none';
  const prompt = walkOverlay.querySelector('.shop-prompt');
  // build mode speaks over the world's own prompts: while it is on, the only controls that
  // matter are its controls
  const bld = buildApi();
  const label = (bld && bld.isActive() && bld.label())
    || (app.scene3d.walk.getFocusLabel ? app.scene3d.walk.getFocusLabel() : null);
  prompt.textContent = label || '';
  prompt.style.opacity = label ? '1' : '0';
  const lockHint = walkOverlay.querySelector('.shop-lockhint');
  // the control bar retires once the controls are demonstrably learned
  // (opening arc past the shelving step) — after that it only returns while
  // the pointer is free, as a click-to-play reminder
  const tut = app.state && app.state.tutorial;
  const learned = tut && (tut.complete || tut.hidden || tut.step >= 5);
  lockHint.style.display = document.pointerLockElement ? 'none' : '';
  lockHint.textContent = learned
    ? 'Click to play'
    : 'Click to look around · WASD walk · Shift run · E interact · F tool · Tab: overview camera · Esc: office menu';
  // inside the shop: the condition chip rides along (and tier-ups chime)
  const cond = walkOverlay.querySelector('.shop-cond');
  const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
  const inside = ch && ch.isInside(app.scene3d.walk.state.x, app.scene3d.walk.state.z);
  if (inside && app.state && app.state.shop) {
    if (app.state.tutorial) tutorialFlag(app.state, 'shopWalked');
    const c = shopCondition(app.state);
    const word = CONDITION_WORD(c);
    cond.textContent = `🧹 Shop condition ${c} — ${word}`;
    cond.style.display = '';
    if (lastCondWord && word !== lastCondWord && c >= 25 && audio.ready) audio.chime();
    lastCondWord = word;
  } else {
    cond.style.display = 'none';
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

function resize() {
  if (app.scene3d) app.scene3d.resize();
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
  laptopUi = makeLaptop(app, { close: () => exitLaptop() });
  worksPanel = makeWorksPanel(app, handlers);
  inspectPanel = makeInspectPanel(app, recomputeRating);
  groundsPanel = makeGroundsPanel(app);
  clubPanel = makeClubPanel(app, recomputeRating);
  empirePanel = makeEmpirePanel(app, handlers);
  objectivesPanel = makeObjectivesPanel(app);

  walkOverlay = el('div', { class: 'shop-overlay', style: 'display:none' },
    el('div', { class: 'shop-crosshair' }),
    el('div', { class: 'shop-prompt', text: '' }),
    el('div', { class: 'shop-cond', text: '', style: 'display:none' }),
    el('div', { class: 'shop-lockhint', text: 'Click to look around · WASD walk · Shift run · E interact · F tool · Tab: overview camera · Esc: office menu' }),
  );

  // BEHIND THE TILL the walk overlay is hidden — no crosshair, no prompt — so the
  // player has no way to discover [T] and [D] except by pressing every key. The
  // register screen tells them WHAT it wants ("PUT THEIR MONEY IN THE TILL"); this
  // tells them which hand to use.
  regHint = el('div', { class: 'reg-hint', style: 'display:none' },
    el('span', { text: 'Drag goods over the scanner to ring them up' }),
    el('span', { class: 'reg-keys' }, el('kbd', { text: 'T' }), el('span', { text: 'total up' })),
    el('span', { class: 'reg-keys' }, el('kbd', { text: 'D' }), el('span', { text: 'drawer' })),
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

  gameUi.append(hud.root, worksPanel.palette, worksPanel.planBar, inspectPanel.root, groundsPanel.root, clubPanel.root, empirePanel.root, walkOverlay, regHint, laptopUi.root, objectivesPanel.root, viewToggle,
    el('div', { class: 'hint-bar', text: 'Overview camera — Drag: pan · Right-drag: rotate · Wheel: zoom · 🗂 Manage or E/G/C/M keys for the desks · V: view · Space: pause · Tab/Esc: back on foot' }));

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
