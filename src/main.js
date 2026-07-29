// GOLF EMPIRE — application bootstrap: screens, game loop, input routing.
// All simulation lives in src/sim/ (headless-testable); this file wires it to
// the 3D course scene, the DOM UI, and the clock. The unit of play is the
// EMPIRE: one wallet, a property market, and whichever owned club is active.

import { BALANCE } from './sim/balance.js';
import { HOLE_STATUS, TURF_ZONES, ZONE } from './sim/constants.js';
import {
  EMPIRE_VERSION, newStarterEmpire, buyProperty, sellProperty, switchProperty, activeState,
  empireUpdate, empireSnapshot, deserializeEmpireWithReport,
} from './sim/empire.js';
import { buildShedEmpire } from './sim/shedScene.js';
import { SAVE_VERSION } from './sim/state.js';
import { addHole, courseDesignRating, holeNumber } from './sim/course.js';
import { formatMoney } from './core/utils.js';
import { createHeldKeys, overviewCameraDelta, OVERVIEW_KEYS, isTextEntryTarget } from './core/heldKeys.js';
import { calendarOf } from './sim/time.js';
import {
  clearNotifications, clearToasts, confirmDialog, containFocus, el, modal, notify,
  setNotificationScope, setPromptText, toast,
} from './ui/ui.js';
import { makeHud } from './ui/hud.js';
import { makeCourseEditor } from './ui/courseEditor.js';
import { makeInspectPanel } from './ui/inspectPanel.js';
import { makeGroundsPanel } from './ui/groundsPanel.js';
import { makeClubPanel } from './ui/clubPanel.js';
import { makeEmpirePanel } from './ui/empirePanel.js';
import { openMarketplace } from './ui/marketplacePanel.js';
import { makeObjectivesPanel } from './ui/objectivesPanel.js';
import { makeShedChecklist } from './ui/shedChecklist.js';
import { makeCourseMaintenancePanel } from './ui/courseMaintenancePanel.js';
import { makeGolfDayPanel } from './ui/golfDayPanel.js';
import { makeLaptop } from './ui/laptop.js';
import { makeSettingsPanel } from './ui/settingsPanel.js';
import { makeToolWheel } from './ui/toolWheel.js';
import { quadTransform, uvAt } from './core/laptopProjection.js';
import { makeAudio } from './core/audio.js';
import {
  tickTutorial, tutorialFlag, skipTutorial, replayTutorial, triggerContextTutorial,
} from './sim/tutorial.js';
import { makeMenu } from './screens/menu.js';
import {
  inspectData, loadDataWithStatus, saveData, summarizeSave,
} from './core/storage.js';
import { applyDocumentPreferences, makePreferences } from './core/preferences.js';
import { conditionRating, sectionTurfSummary, sectionStatus } from './sim/turf.js';
import { shopCondition, vacuumOwned, tickDeliveries } from './sim/shop.js';
import {
  changeDue as registerChangeDue,
  handTotal as registerHandTotal,
  unscannedCount as registerUnscannedCount,
} from './sim/register.js';
import { ownedWasher } from './sim/washing.js';
import { liveGolfSummary, setGolfSimulationFocus } from './sim/golfDay.js';
import { BELT_ORDER, CLEANING_TOOLS } from './data/cleaningTools.js';
import { skuById } from './data/shopItems.js';
import { makeCourseScene } from './render3d/courseScene.js';
import { deliveryEtaText } from './sim/deliveryEta.js';
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

// ?scene=shed boots straight past the menu into the maintenance-shed test scene,
// on its own save keys (golfempire:shed-autosave, +-meta, +slots) so it never
// reads or overwrites a real player's autosave or manual slots. Guarded the same
// way any location read here should be, though main.js is browser-only today
// (document.getElementById above already assumes a DOM).
const sceneScope = (() => {
  try {
    return new URLSearchParams(location.search).get('scene') === 'shed' ? 'shed' : null;
  } catch {
    return null;
  }
})();
const sceneFresh = (() => {
  try {
    return new URLSearchParams(location.search).get('fresh') === '1';
  } catch {
    return false;
  }
})();
const scopedKey = (key) => (sceneScope ? `${sceneScope}-${key}` : key);
// Scope on-screen banners to the shed when booted there, so course/campaign notices
// (greenskeeper note, tractor hint, disease outbreaks) never leak into the shed test scene.
setNotificationScope(sceneScope);

const app = {
  screen: 'menu', // 'menu' | 'market' | 'game'
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
  frontDeskOpen: false,
  sectionIndex: null,
  sectionsRef: null,
  preferences,
};

// Successful loads can surface migration/recovery details only after their new
// scene's opaque prewarm veil has cleared. Keying by the deserialized empire
// keeps the handoff explicit without changing every load caller's return shape.
const loadNotices = new WeakMap();

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
let walkPrompt = null;
let walkLockHint = null;
let walkCondition = null;
let regHint = null;
let regHintText = null;
let regHintTotal = null;
let regHintDrawer = null;
let laptopUi = null;
let frontDeskUi = null;
let objectivesPanel = null;
let shedChecklist = null; // shed-only cleaning readout (created at mount when sceneScope === 'shed')
let maintenancePanel = null;
let golfDayPanel = null;
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
  if (regActive()) return 'register';
  if (app.laptopOpen) return 'laptop';
  const build = buildApi();
  if (build?.isActive()) return 'placement';
  if (app.courseMode === 'editor') return 'course-editor';
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
  // GTAO radius is deliberately NOT set per mode. This line used to read
  // `post.gtao.radius = 0.7`, which did nothing at all: GTAOPass keeps the radius in
  // gtaoMaterial.uniforms.radius and never reads a bare property, so the value the code
  // claimed and the value the shader used disagreed for the whole life of the feature.
  // Making it real would have meant shipping an untested 0.7 in first person; the
  // measured finding is that a smaller radius tightens contact and a larger one smears
  // it, so if per-mode tuning is ever wanted it must go through updateGtaoMaterial() and
  // be verified on the contact crops. One configured radius, honestly applied, until then.
  // See GTAO_CONFIG in render3d/courseScene.js and tests/gtao-config.test.js.
  if (!yardHintShown && app.state && app.state.tractor && !app.state.tractor.repaired) {
    yardHintShown = true;
    setTimeout(() => toast('The old tractor sits by the shed, east of the porch — she’d run again with some work.'), 1200);
  }
  app.courseMode = 'walk';
  app.scene3d.walk.enter(spawn);
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    && document.activeElement.closest('#ui')) document.activeElement.blur();
  walkOverlay.style.display = '';
  const viewToggle = document.querySelector('.view-toggle');
  if (viewToggle) viewToggle.style.display = 'none';
  const hint = document.querySelector('.hint-bar');
  if (hint) hint.style.display = 'none';
  inspectPanel.hide();
  // Pointer lock is opt-in through the canvas click below. This keeps visible
  // HUD controls usable on arrival and matches the "Click to look around"
  // instruction; arrow-key look and WASD movement are available immediately.
}

function exitWalk() {
  cancelToolKey();
  if (app.frontDeskOpen) exitFrontDesk(true);
  if (app.laptopOpen) exitLaptop(true);
  // No per-mode GTAO radius here either — see the note in enterWalk.
  if (app.scene3d) app.scene3d.walk.exit();
  walkOverlay.style.display = 'none';
  const viewToggle = document.querySelector('.view-toggle');
  if (viewToggle) viewToggle.style.display = '';
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

function enterLaptop(startPage = null) {
  if (!walkActive() || app.laptopOpen || app.frontDeskOpen) return;
  const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
  if (!ch) return;
  cancelToolKey();
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
    laptopUi.open(startPage);
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
  if (vt) vt.style.display = 'none'; // returning to first-person, not the overview map
  if (!silent) {
    walkOverlay.style.display = '';
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
  if (except !== 'grounds' && app.groundsOpen) groundsPanel.setVisible(false);
  if (except !== 'club' && app.clubOpen) clubPanel.setVisible(false);
  if (except !== 'empire' && app.empireOpen) empirePanel.setVisible(false);
}

function showFirstDaySummary() {
  const view = app.state ? campaignView(app.state) : null;
  const first = view?.firstDay;
  if (!first?.complete) return;
  if (document.pointerLockElement) document.exitPointerLock();
  const result = first.result || {};
  modal('Opening day complete', (box, close) => {
    box.append(
      el('div', { class: 'campaign-day-summary' },
        el('div', {}, el('span', { text: 'Revenue' }), el('b', { text: formatMoney(first.revenue) })),
        el('div', {}, el('span', { text: 'Operating result' }), el('b', { text: formatMoney(result.net || 0) })),
        el('div', {}, el('span', { text: 'Customer feedback' }), el('b', { text: first.review ? 'First review received' : 'Pending' })),
        el('div', {}, el('span', { text: 'Stock signal' }), el('b', { text: first.shelfGap ? 'First shelf gap recorded' : 'Shelves holding' })),
      ),
      el('p', { class: 'muted', text: 'Next goal: keep two core product lines stocked and build a full week of reliable service and strong reviews.' }),
      el('div', { class: 'row' }, el('button', { text: 'Continue operating', onclick: close })),
    );
  });
}

function handleGuideTick(result) {
  if (!result) return;
  const advanced = result.advanced || [];
  if (advanced.length > 3) {
    toast(`${advanced.length} completed objectives were recovered from the real world state.`, 'good');
  } else {
    for (const step of advanced) toast(`✓ ${step.title}`, 'good');
  }
  if (result.phaseChanged) toast(`Milestone — ${result.phaseChanged.title}`, 'good');
  if (result.firstDayCompleted) showFirstDaySummary();
  if (advanced.length || result.phaseChanged || result.firstDayCompleted) {
    if (objectivesPanel) objectivesPanel.refresh();
    if (laptopUi?.isOpen()) laptopUi.render();
  }
}

function campaignPresentationChanged(kind, result) {
  const clubhouse = app.scene3d?.clubhouse?.();
  clubhouse?.refreshCampaign?.();
  handleGuideTick(tickTutorial(app.state));
  objectivesPanel?.refresh();
  if (laptopUi?.isOpen()) laptopUi.render();
  autosave();
  if (kind === 'opening' && result?.ok && audio.ready) audio.chime();
}

function showCampaignArrival() {
  const campaign = app.state?.campaign;
  if (!campaign?.enabled || campaign.arrivalShown || !gameUi) return;
  campaign.arrivalShown = true;
  arrivalIntro?.remove();
  const dismiss = () => {
    if (!arrivalIntro) return;
    arrivalIntro.classList.add('leaving');
    const retiring = arrivalIntro;
    arrivalIntro = null;
    setTimeout(() => retiring.remove(), 280);
    requestLook();
  };
  arrivalIntro = el('div', { class: 'arrival-intro', role: 'status' },
    el('div', { class: 'arrival-eyebrow', text: 'YOUR FIRST PROPERTY' }),
    el('div', { class: 'arrival-title', text: app.state.clubName || 'The Club' }),
    el('div', { class: 'arrival-copy', text: 'Years of neglect left the clubhouse closed. Survey it, restore the office, then reopen on your terms.' }),
    el('div', { class: 'arrival-task', text: 'Look around · Walk toward the clubhouse' }),
    el('button', { text: 'Begin restoration', onclick: dismiss }),
  );
  gameUi.append(arrivalIntro);
  autosave();
  setTimeout(() => {
    if (arrivalIntro) dismiss();
  }, 9000);
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
  clearToasts(); // customer/shop dialogue must not leak into the design surface
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
  syncPresentationMode(presentationMode());
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
  syncPresentationMode(presentationMode());
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
  toolWheel?.close('scene-change');
  clearNotifications();
  audio.setToolLoop(null);
  audio.setPaused(false);
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

function startGame(state, loadNotice = null) {
  closePauseMenu({ resume: false }); // any pause overlay dies with the old world
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
          startGameNow(state, loadNotice, generation);
        });
        return;
      }
      startGameNow(state, loadNotice, generation);
    });
  });
}

function startGameNow(state, loadNotice = null, generation = sceneStartGeneration) {
  app.state = state;
  // Loading a club is a pure restore boundary. The rolling tee-sheet horizon
  // advances in dailyTick; generating it here would post online deposits while
  // the opaque loading veil is still up and make Continue change saved cash.
  app.screen = 'game';
  app.scene3d = makeCourseScene(canvas, state);
  // walk-up inspection: the walking controller asks, the app answers with the
  // same sections and status words the top-down click-to-inspect always used
  app.scene3d.walk.hooks.toast = (msg, kind) => {
    if (editorActive()) return;
    // In the shed, tag gameplay toasts shedScoped so the notification gate keeps them (untagged
    // course banners are dropped), and refresh the checklist immediately on each cleaning beat.
    toast(msg, kind, sceneScope === 'shed' ? { shedScoped: true } : undefined);
    if (sceneScope === 'shed') shedChecklist?.refresh();
  };
  app.scene3d.walk.hooks.clearToasts = clearToasts;
  app.scene3d.walk.hooks.tutorial = (flag) => tutorialFlag(app.state, flag);
  // a restrained note when the game had to dig the player out of geometry
  app.scene3d.walk.hooks.recovered = (how) => toast(
    how === 'lastSafe' ? 'Stepped you back to where you last had room.' : 'Moved you clear of the furniture.',
  );
  app.scene3d.walk.hooks.sfx = (name) => { if (audio.ready && audio[name]) audio[name](); };
  // Task-4 cleaning cadence hooks, routed through the generic audio surface: a stroke turnaround
  // fires a velocity-scaled accent (rate-limited in audio), a spray squeeze fires a trigger puff.
  app.scene3d.walk.hooks.onStrokeReversal = (toolId, intensity) => {
    if (audio.ready && audio.strokeAccent) audio.strokeAccent(toolId, intensity);
  };
  app.scene3d.walk.hooks.onSprayPulse = () => { if (audio.ready && audio.sprayPulse) audio.sprayPulse(); };
  // Switching, stowing, focus loss, and mode changes are all trigger releases. The renderer owns
  // those lifecycle edges, so it tells audio here instead of waiting for a pointerup that may
  // never arrive (alt-tab and rapid belt cycling are the common cases).
  app.scene3d.walk.hooks.toolChanged = () => {
    // Pointer-lock recovery clears held tools too. While mounted that cleanup
    // must not also silence the separately owned vehicle motor loop.
    if (app.scene3d?.walk?.cart?.mounted) return;
    if (audio.ready) audio.setToolLoop(null);
  };
  // the clubhouse's in-world management surfaces route through these
  app.scene3d.walk.hooks.openLaptop = (startPage = null) => enterLaptop(startPage);
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
    const localized = section.zone === ZONE.GREEN ? st.turf.ballMarks?.[i] || 0 : st.turf.divots?.[i] || 0;
    const damageLabel = section.zone === ZONE.GREEN ? 'ball marks' : 'divots';
    return w <= 1 && localized <= 0.1
      ? `⛏ ${section.name} — smooth, no ${damageLabel} here · [F] next tool`
      : `⛏ ${section.name} — ${damageLabel} ${localized.toFixed(1)} · wear ${w} — hold to repair`;
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
      if (frac === 1) recordManualWork(st, 'rakeBunker', i);
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
    recordManualWork(st, 'mow', i);
    return true;
  };
  app.scene3d.walk.hooks.engine = (on, vehicleKind = 'tractor') => {
    if (audio.ready) audio.setToolLoop(on ? (vehicleKind === 'golf-cart' ? 'cart' : 'mower') : null);
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
  menu.setVisible(false);
  gameUi.style.display = '';
  hud.update();
  golfDayPanel?.update();
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
      if (loadNotice) {
        setTimeout(() => {
          if (generation === sceneStartGeneration && app.scene3d === sceneRef) {
            toast(loadNotice, 'warn');
          }
        }, 460);
      }
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
  let revision = 0;
  let hideTimer = null;
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
      revision += 1;
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = null;
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
      const expectedRevision = revision;
      if (tipTimer) clearInterval(tipTimer);
      tipTimer = null;
      fill.style.width = '100%';
      progress.setAttribute('aria-valuenow', '100');
      el.setAttribute('aria-busy', 'false');
      el.style.opacity = '0';
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (revision === expectedRevision) el.style.display = 'none';
      }, preferences.values.accessibility.reducedMotion ? 0 : 420);
    },
  };
  return loadVeil;
}

function exitToMenu() {
  // Leaving a scoped test scene must not hand the player the UNSCOPED menu:
  // its Continue/Load would boot the real campaign with saves still diverted
  // to the scene's keys and notifications still scene-gated. A full reload
  // without the query string resets sceneScope and every gate with it.
  if (sceneScope) {
    location.href = location.pathname;
    return;
  }
  sceneStartGeneration += 1;
  closePauseMenu({ resume: false });
  toolWheel?.close('menu');
  clearNotifications();
  audio.setToolLoop(null);
  audio.setPaused(false);
  destroyCurrentScene({ hideVeil: true });
  app.screen = 'menu';
  app.state = null;
  gameUi.style.display = 'none';
  if (objectivesPanel) objectivesPanel.root.style.display = 'none';
  menu.setVisible(true);
}

// Bring a whole empire to life: boot its active club, or — when nothing is
// owned yet (fresh empire, or the whole portfolio was sold) — open the market.
function bootEmpire(empire) {
  app.empire = empire;
  const loadNotice = loadNotices.get(empire) || null;
  loadNotices.delete(empire);
  const st = activeState(empire);
  if (st) {
    startGame(st, loadNotice);
  } else {
    exitToMenu();
    openMarketplace(app, handlers);
    if (loadNotice) toast(loadNotice, 'warn');
  }
}

async function loadEmpireSave(key, label) {
  let status;
  try {
    // A syntactically valid backup may still belong to a newer build. Defer
    // repairing the primary until empire validation accepts the candidate.
    status = await loadDataWithStatus(key, { repair: false });
  } catch (error) {
    console.error(`${label} storage read failed`, error);
    toast(`${label} could not be read. The current game was left untouched.`, 'warn');
    return null;
  }
  if (status.value == null) {
    toast(status.missing
      ? `${label} is empty.`
      : `${label} is damaged and no valid backup is available.`, 'warn');
    return null;
  }
  try {
    const loaded = deserializeEmpireWithReport(status.value);
    const notices = [];
    if (status.recovered) notices.push('recovered from its previous valid backup');
    if (loaded.report.migrations.length) {
      notices.push(`migrated ${loaded.report.migrations.length} save schema step(s)`);
    }
    if (loaded.report.recovered) {
      notices.push(`repaired ${loaded.report.repairs.length} invalid save field(s)`);
    }
    if (status.recovered && !status.repairedPrimary) {
      try {
        await saveData(key, status.value);
        status.repairedPrimary = true;
      } catch (error) {
        console.warn(`${label} primary repair failed`, error);
        notices.push('could not repair its primary copy');
      }
    }
    if (notices.length) {
      loadNotices.set(loaded.empire, `${label} ${notices.join(' and ')}.`);
    }
    return loaded.empire;
  } catch (error) {
    console.warn(`${label} validation refused`, error);
    const future = error?.code === 'SAVE_VERSION_UNSUPPORTED';
    toast(future
      ? `${label} was written by a newer build and was not changed.`
      : `${label} could not be validated. The current game was left untouched.`, 'warn');
    return null;
  }
}

async function autosave() {
  if (!app.empire) return;
  try {
    await saveData(scopedKey('autosave'), empireSnapshot(app.empire));
    await saveData(scopedKey('autosave-meta'), currentSaveMetadata());
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
  await saveData(scopedKey(slot), empireSnapshot(app.empire));
  await saveData(scopedKey(`${slot}-meta`), currentSaveMetadata());
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
  openEditor() {
    enterEditor();
  },
  toggleGrounds() {
    const next = !app.groundsOpen;
    if (next) closeLeftPanels('grounds');
    groundsPanel.setVisible(next);
    if (next) {
      inspectPanel.hide();
      if (app.state) tutorialFlag(app.state, 'groundsOpened');
    }
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
    syncPresentationMode(presentationMode());
  },
  setViewMode(mode) {
    app.viewMode = mode;
    app.scene3d.setViewMode(mode);
    viewButtons.forEach((button) => button.classList.toggle('active-tool', button.dataset.mode === mode));
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
    if (app.screen === 'menu') {
      app.screen = 'market';
      menu.setVisible(false);
    }
    openMarketplace(app, handlers);
  },
  marketClosed() {
    // A fresh empire has no game scene underneath the market. Return to the
    // deliberate menu surface instead of exposing a dimmed menu through it.
    if (app.screen === 'market') {
      app.screen = 'menu';
      menu.setVisible(true);
    }
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
    golfDayPanel?.update();
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
        handlers.openMarket();
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
  // Cap device pixel ratio at 1.5 — the perf ceiling the scene is tuned for. A
  // 4K/retina panel at native DPR quadruples the pixel cost for no visible gain
  // at this art style. renderScale still lets the player trade sharpness for fps.
  app.scene3d.renderer.setPixelRatio(Math.min(1.5, (window.devicePixelRatio || 1) * values.display.renderScale));
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
applySettings();

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
    app.speedIdx = pausePrevSpeed;
    if (pauseHadPointerLock && !regActive() && !app.laptopOpen) requestLook();
  }
  pauseHadPointerLock = false;
  syncPresentationMode(presentationMode());
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
    const [record, metadata] = await Promise.all([inspectData(scopedKey(slot), SAVE_LIMITS), inspectData(scopedKey(`${slot}-meta`))]);
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
              const empire = await loadEmpireSave(scopedKey(slot), `Slot ${index + 1}`);
              if (!empire) return false;
              closePauseMenu({ resume: false });
              bootEmpire(empire);
              return true;
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
            ['Capture the mouse', 'Click'], ['Overview camera (hands free)', 'Tab'],
          ]),
          group('Hands', [
            ['Interact · pick up · place', 'E'], ['Secondary action · reposition carton', 'X'],
            ['Tool belt: tap / hold', 'F'],
            ['Previous tool', 'Q'], ['Use selected tool', 'LMB'],
            ['Placement mode', 'B'], ['Rotate placement', 'R'], ['Cancel preview', 'Esc'],
          ]),
          group('Time & views', [
            ['Pause menu', 'P', 'Esc'], ['Pause simulation clock', 'Space'],
            ['Simulation speed', '1', '2', '3'], ['Course data view', 'V'],
          ]),
          group('Management', [
            ['Course editor (hands free)', 'J'],
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
  syncPresentationMode('pause');
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

let toolKeyTimer = null;
let toolKeyStarted = 0;
let toolHoldOpened = false;
let previousWalkTool = null;
let walkToolWheelRemainder = 0;

const WALK_TOOL_SHORTCUTS = Object.freeze({
  washer: 'W',
  vacuum: 'V',
  mop: 'M',
  broom: 'B',
  dustpan: 'D',
  spray: 'S',
  cloth: 'C',
  sponge: 'G',
  trashbag: 'T',
  hose: 'H',
  divot: 'D',
  rake: 'R',
});

function walkToolEntries() {
  const walk = app.scene3d?.walk;
  const clubhouse = app.scene3d?.clubhouse?.();
  const inside = !!(walk && clubhouse?.isInside(walk.state.x, walk.state.z));
  const cleaningKitOwned = !!(app.state && vacuumOwned(app.state));
  const washer = app.state ? ownedWasher(app.state) : null;
  const indoorTools = BELT_ORDER
    .filter((id) => id && CLEANING_TOOLS[id] && !CLEANING_TOOLS[id].external)
    .map((id) => {
      const def = CLEANING_TOOLS[id];
      return {
        id,
        label: def.label,
        shortcut: WALK_TOOL_SHORTCUTS[id],
        available: inside && cleaningKitOwned,
        reason: !inside ? 'Use this inside the clubhouse' : 'Order the cleaning kit from the laptop',
        detail: def.equipToast,
      };
    });
  const handsFree = { id: null, label: 'Hands free', shortcut: 'X', detail: 'Interact, carry, and inspect' };
  if (inside) return [handsFree, ...indoorTools];
  return [
    handsFree,
    {
      id: 'washer', label: washer?.name || 'Pressure washer', shortcut: WALK_TOOL_SHORTCUTS.washer,
      available: true,
      detail: 'LMB washes · RMB applies soap',
    },
    { id: 'hose', label: 'Watering hose', shortcut: WALK_TOOL_SHORTCUTS.hose, detail: 'Raises live turf moisture' },
    { id: 'divot', label: 'Divot kit', shortcut: WALK_TOOL_SHORTCUTS.divot, detail: 'Repairs worn turf patches' },
    { id: 'rake', label: 'Bunker rake', shortcut: WALK_TOOL_SHORTCUTS.rake, detail: 'Smooths footprinted sand' },
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
  if (audio.ready) audio.equipTick();
  if (app.state) {
    tutorialFlag(app.state, 'toolSelected');
    if (tool === 'vacuum') triggerContextTutorial(app.state, 'cleaning-tools');
    else if (['washer', 'hose', 'divot', 'rake'].includes(tool)) triggerContextTutorial(app.state, 'maintenance-tools');
  }
  objectivesPanel?.refresh();
  hud?.update();
}

function cycleWalkTool(direction = 1) {
  const entries = walkToolEntries().filter((entry) => entry.available !== false);
  if (!entries.length) return;
  const current = app.scene3d.walk.getTool();
  const index = entries.findIndex((entry) => entry.id === current);
  const start = index >= 0 ? index : 0;
  const step = direction < 0 ? -1 : 1;
  selectWalkTool(entries[(start + step + entries.length) % entries.length].id);
}

function swapPreviousWalkTool() {
  const walk = app.scene3d?.walk;
  if (!walk || walk.cart?.mounted) return;
  const current = walk.getTool();
  const previous = previousWalkTool;
  if (previous === undefined || previous === current) return;
  previousWalkTool = current;
  selectWalkTool(previous);
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

function cancelToolKey() {
  if (toolKeyTimer) clearTimeout(toolKeyTimer);
  toolKeyTimer = null;
  toolKeyStarted = 0;
  toolHoldOpened = false;
  if (toolWheel?.isOpen()) toolWheel.close('mode-change');
  stopToolUse();
}

function stopToolUse() {
  if (!app.scene3d?.walk) return;
  app.scene3d.walk.setSpraying(false);
  app.scene3d.walk.setSoaping?.(false);
  if (!app.scene3d.walk.cart?.mounted) audio.setToolLoop(null);
}

canvas.addEventListener('click', () => {
  if (handledPlacementPointer) {
    handledPlacementPointer = false;
    return;
  }
  // first-person walking: clicking (re)captures the mouse — but NOT while the player
  // is behind the till, where the cursor is the whole interface
  if (regActive() || editorActive() || toolWheel?.isOpen() || isPauseOpen()) return;
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
  if (editorActive() || toolWheel?.isOpen() || isPauseOpen()) return;
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
      app.scene3d.walk.setSpraying(active);
      if (audio.ready) audio.setToolLoop(active ? tool : null);
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
  if (editorActive()) return; // the editor's own wheel handler zooms
  if (regActive()) {
    e.preventDefault();
    regApi().onWheel(e.deltaY, e.shiftKey);
    return;
  }
  if (walkActive() && !app.laptopOpen && !buildApi()?.isActive()
    && !boxPlacementApi()?.hasCarriedBox() && !isPauseOpen()) {
    e.preventDefault();
    walkToolWheelRemainder += e.deltaY || e.deltaX;
    if (Math.abs(walkToolWheelRemainder) >= 18) {
      cycleWalkTool(Math.sign(walkToolWheelRemainder));
      walkToolWheelRemainder = 0;
    }
    return;
  }
  if (app.screen !== 'game' || app.view !== 'course' || app.courseMode !== 'overview') return;
  e.preventDefault();
  app.scene3d.rig.dolly(e.deltaY > 0 ? 1.13 : 1 / 1.13);
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (app.screen !== 'game') return;
  if (app.frontDeskOpen) {
    if (e.key === 'Escape') {
      e.preventDefault();
      exitFrontDesk();
    }
    return;
  }
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
  if (editorActive()) return; // the editor's capture-phase handler owns its remaining keys
  if (toolWheel?.isOpen()) return;

  // Behind the till, the register owns action keys while the walk controller's
  // separate listener still permits small WASD position adjustments. Tab stays
  // blocked so the judged checkout pose cannot be stranded in overview.
  // Escape is the way out, and register mode handles it.
  if (regActive()) {
    e.preventDefault();
    regApi().onKey(e.key);
    return;
  }

  // time controls work in either view
  switch (e.key) {
    case ' ':
      e.preventDefault();
      // Space is the mounted vehicle brake. The walk controller's held-key
      // listener still receives it; this global shortcut must not also resume
      // the simulation while the player is braking.
      if (walkActive() && app.scene3d?.walk?.cart?.mounted) return;
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
      if (bld.isCatalogOpen?.()) {
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
      case 'l': case 'L': {
        if (e.repeat) break;
        const lightResult = app.scene3d.walk.toggleLights?.();
        if (lightResult?.handled) {
          e.preventDefault();
          if (!e.repeat) toast(lightResult.enabled ? `${lightResult.label} on.` : `${lightResult.label} off.`);
        }
        break;
      }
      case 'f': case 'F': {
        if (!app.scene3d.walk.cart.mounted) beginToolKey(e);
        break;
      }
      case 'q': case 'Q': {
        e.preventDefault();
        if (!e.repeat) swapPreviousWalkTool();
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
        if (e.repeat) break;
        const cameraResult = app.scene3d.walk.toggleVehicleCamera?.();
        if (cameraResult?.handled) {
          e.preventDefault();
          if (!e.repeat) toast(cameraResult.mode === 'driver' ? 'Driver camera.' : 'Chase camera.');
          break;
        }
        const modes = ['normal', 'health', 'moisture'];
        handlers.setViewMode(modes[(modes.indexOf(app.viewMode) + 1) % modes.length]);
        break;
      }
      case 'Escape':
        e.preventDefault();
        if (app.selectedSection) inspectPanel.hide();
        else if (app.groundsOpen || app.clubOpen || app.empireOpen) closeLeftPanels('none');
        else {
          stopToolUse();
          if (document.pointerLockElement) document.exitPointerLock();
          openPauseMenu();
        }
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
let golfFocusClock = 0;
let golfAudioSequence = 0;
let golfAudioDay = null;

function frame(ts) {
  const dtMs = Math.min(250, ts - lastTs || 16);
  lastTs = ts;

  if (app.screen === 'game' && app.state && app.scene3d) {
    keyboardCamera(dtMs);
    const speed = BALANCE.speeds[app.speedIdx];
    // SIM-TIME-001. The clubhouse loop is handed raw wall dt, so it has no way
    // to know the day is running 16x faster unless it is told. Pushed every
    // frame rather than on the speed control, because pause/resume, the editor,
    // the pause menu and the golf-day presentation all move speedIdx from
    // different places and any one of them forgetting would put the shop back
    // where it was.
    app.scene3d.clubhouse?.()?.setSimSpeed?.(speed || 1);
    if (speed > 0) {
      const golfParties = app.state.golfDay?.parties || [];
      const nearbyShot = app.speedIdx === 1 && golfParties.find((party) => (
        party.simulationTier === 'near' && party.state === 'ball-in-play'
      ));
      const nearbyAddress = app.speedIdx === 1 && golfParties.find((party) => (
        party.simulationTier === 'near'
        && ['preparing-shot', 'on-green', 'putting'].includes(party.state)
      ));
      let gameMinutes = (dtMs / 1000) * BALANCE.gameMinutesPerRealSecond * speed;
      // At normal speed, a shot the player is close enough to watch gets a
      // real presentation beat. First stop this frame at address so a tiny
      // trajectory cannot start and finish in one sim tick, then advance an
      // active flight slowly enough for the ball, swing and audio to read.
      if (nearbyShot) gameMinutes = Math.min(gameMinutes, (dtMs / 1000) * 0.08);
      else if (nearbyAddress) {
        const untilAddress = Number(nearbyAddress.nextActionMinute) - Number(app.state.clock.minutes);
        if (Number.isFinite(untilAddress) && untilAddress <= gameMinutes) {
          gameMinutes = Math.min(gameMinutes, Math.max(0.001, untilAddress + 0.001));
        }
      }
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
        app.scene3d.updateCourseMaintenance(app.state);
        recomputeRating();
        inspectPanel.refreshIfOpen();
        if (app.groundsOpen) groundsPanel.refresh();
        handleGuideTick(tickTutorial(app.state));
        objectivesPanel.refresh();
      }
    }
    // Delivery promises tick at minute grain: statuses progress and the truck
    // announces dispatch, the final approach, arrival or a blocked pad.
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
        if (ev.kind === 'dispatched') {
          toast(`📦 ${name} has dispatched — ${deliveryEtaText(ev.order, app.state.clock.minutes)}. ${boxes}, ${man ? `${man.weight} lb` : ''}.`);
        } else if (ev.kind === 'soon') {
          toast(`📦 The ${ev.order.supplier || name} van is close — ${deliveryEtaText(ev.order, app.state.clock.minutes)}.`);
        } else if (ev.kind === 'arrived') {
          toast(`📦 Delivery inbound! ${name} ×${ev.order.qty} — the van is turning into receiving with ${boxes}.`);
          // A carton is the only thing in the game opened by hold-and-drag, and
          // the entire retail loop is behind it. Teach it the moment there is
          // actually a box to open; the lesson retires itself on the first cut.
          triggerContextTutorial(app.state, 'delivery-carton');
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
    golfFocusClock += dtMs;
    if (golfFocusClock >= 500) {
      const focus = walkActive()
        ? app.scene3d.walk.state
        : { x: app.scene3d.camera.position.x, z: app.scene3d.camera.position.z };
      setGolfSimulationFocus(app.state, focus);
      golfFocusClock = 0;
    }
    const cal = calendarOf(app.state.clock.minutes);
    app.scene3d.applyTimeWeather(cal.minuteOfDay, app.state.weather);
    if (!app.prewarming) app.scene3d.render(dtMs, app.state); // prewarm owns the GPU behind the veil
    const activeGolfDay = app.state.golfDay || null;
    const golfEvents = activeGolfDay?.events || [];
    if (activeGolfDay !== golfAudioDay) {
      // A midnight rollover owns a fresh event stream. A loaded game is primed
      // in startGame below, so this path only lets genuinely new-day events play.
      golfAudioDay = activeGolfDay;
      golfAudioSequence = 0;
    } else if (golfEvents.length && golfEvents[golfEvents.length - 1].sequence < golfAudioSequence) {
      // Migration/recovery may deliberately rebuild a truncated event window.
      golfAudioSequence = 0;
    }
    const unseenGolfEvents = golfEvents.filter((event) => event.sequence > golfAudioSequence);
    if (unseenGolfEvents.length) {
      golfAudioSequence = unseenGolfEvents[unseenGolfEvents.length - 1].sequence;
      if (audio.ready) {
        for (const event of unseenGolfEvents.slice(-4)) {
          const party = app.state.golfDay.parties.find((entry) => entry.id === event.partyId);
          if (party?.simulationTier !== 'near') continue;
          if (event.type === 'shot-started' || event.type === 'practice-shot-started') {
            audio.ballStrike(event.detail.club || event.detail.shot);
          } else if (event.type === 'shot-complete' || event.type === 'practice-shot-complete') {
            audio.ballLanding(event.detail.lie || event.detail.practice);
          } else if (event.type === 'starter-called-party') audio.starterCall();
          else if (event.type === 'cart-returned') audio.thunk();
        }
      }
    }
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
        golfersVisible: liveGolfSummary(app.state).activeGolfers,
        inShop: !!(app.scene3d && app.scene3d.clubhouse && app.scene3d.clubhouse()
          && app.scene3d.clubhouse().isInside(app.scene3d.walk.state.x, app.scene3d.walk.state.z)),
        tempHiF: app.state.weather.today.tempHiF,
      });
      if (app.frontDeskOpen) frontDeskUi?.refresh();
      if (maintenancePanel?.isVisible()) maintenancePanel.refresh();
      audioClock = 0;
    }
    hud.update();
    golfDayPanel?.update();
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
  const mode = presentationMode();
  syncPresentationMode(mode);
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
    const tx = register.getTx?.();
    if (tx?.stage === 'done') tutorialFlag(app.state, 'checkoutCompleted');
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
    setPromptText(ovEl.prompt, label);
  }
  // A focus prompt only has meaning while mouse-look owns the pointer. When
  // the pointer is free, "Click to play" is the single actionable instruction;
  // stacking both bars made the queue/customer name unreadable.
  const opacity = label && document.pointerLockElement ? '1' : '0';
  if (opacity !== ovLast.opacity) {
    ovLast.opacity = opacity;
    ovEl.prompt.style.opacity = opacity;
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
  const showLockHint = ['walk', 'placement'].includes(mode) && !document.pointerLockElement;
  const lockDisp = showLockHint ? '' : 'none';
  if (lockDisp !== ovLast.lockDisp) {
    ovLast.lockDisp = lockDisp;
    ovEl.lockHint.style.display = lockDisp;
  }
  const lockText = learned
    ? (placement?.hasCarriedBox()
      ? 'Click to resume · Carrying carton: E place · R rotate · Esc keep carrying'
      : 'Click to resume looking')
    : (placement?.hasCarriedBox()
      ? 'Click to look around · WASD walk · E place · R rotate · Esc keep carrying'
      : 'Click to look · WASD move · Shift run · E interact · tap/hold F tools · J course editor · Tab overview · P pause');
  if (lockText !== ovLast.lockText) {
    ovLast.lockText = lockText;
    setPromptText(ovEl.lockHint, lockText);
  }
  // inside the shop: the condition chip rides along (and tier-ups chime) — 4Hz is plenty
  condClock += dtMs;
  if (condClock >= 250) {
    condClock = 0;
    const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
    const inside = ch && ch.isInside(app.scene3d.walk.state.x, app.scene3d.walk.state.z);
    let condText = null;
    if (inside && mode === 'walk' && app.state && app.state.shop) {
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
              const empire = await loadEmpireSave(scopedKey('autosave'), 'Autosave');
              if (!empire) return;
              close();
              failShown = false;
              bootEmpire(empire);
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
      // Begin in the authored three-hole fixer-upper. Later acquisitions belong
      // on the physical clubhouse laptop, after the player knows the space.
      app.empire = newStarterEmpire(mode, (Math.random() * 2 ** 31) | 0);
      bootEmpire(app.empire);
      await autosave();
    },
    async onContinue() {
      const empire = await loadEmpireSave('autosave', 'Autosave');
      if (empire) bootEmpire(empire);
    },
    async onLoad(_data, slot) {
      const index = SLOTS.indexOf(slot);
      const empire = await loadEmpireSave(slot, index >= 0 ? `Slot ${index + 1}` : 'Save');
      if (empire) bootEmpire(empire);
    },
    onSettings: openMenuSettings,
    onQuit: () => window.fairwayNative?.quit?.(),
  });
  // ?scene=shed skips the menu entirely (its Continue/Load stay pointed at the
  // real player's autosave/slots above — unscoped, on purpose). Hide it before
  // it is ever appended/painted so there is no menu flash before bootShedScene
  // takes over.
  if (sceneScope === 'shed') menu.setVisible(false);

  gameUi = el('div', { class: 'game-ui', style: 'display:none' });
  hud = makeHud(app, handlers);
  laptopUi = makeLaptop(app, {
    close: () => exitLaptop(),
    openPropertyMarket: () => {
      exitLaptop();
      handlers.openMarket();
    },
    onCampaignChanged: (kind, result) => campaignPresentationChanged(kind, result),
    // The Course page's "Open the works desk": the laptop closes cleanly and the real
    // course editor takes the screen — same enterEditor every other entry point uses.
    openCourseEditor: () => enterEditor(),
    refreshShopProgression: () => {
      const result = app.scene3d?.clubhouse?.()?.refreshShopProgression?.();
      autosave();
      return result;
    },
  });
  editorUi = makeCourseEditor(app, {
    onExit: () => exitEditor(),
    isPaused: () => isPauseOpen(),
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
  objectivesPanel = makeObjectivesPanel(app, { getContext: presentationMode });
  golfDayPanel = makeGolfDayPanel(app);
  toolWheel = makeToolWheel({
    audio,
    onSelect: selectWalkTool,
    onPause: openPauseMenu,
    onSwap: swapPreviousWalkTool,
    onUnavailable: (entry) => toast(entry.reason || `${entry.label} is not available yet.`, 'warn'),
    onClose: (reason) => {
      if (reason !== 'pause' && walkActive() && !regActive() && !app.laptopOpen && !isPauseOpen()) requestLook();
      syncPresentationMode(presentationMode());
    },
  });

  walkPrompt = el('div', { class: 'shop-prompt', text: '' });
  walkCondition = el('div', { class: 'shop-cond', text: '', style: 'display:none' });
  walkLockHint = el('div', { class: 'shop-lockhint', text: 'Click to look · WASD move · E interact · tap/hold F tools · P pause' });
  walkOverlay = el('div', { class: 'shop-overlay', style: 'display:none' },
    el('div', { class: 'shop-crosshair' }),
    el('div', { class: 'shop-prompt', text: '' }),
    el('div', { class: 'property-inventory', text: '', style: 'display:none' }),
    el('div', { class: 'shop-cond', text: '', style: 'display:none' }),
    el('div', { class: 'shop-lockhint', text: 'Click to look · WASD move · E interact · tap/hold F tools · J course editor · Tab overview · P pause' }),
  );

  // BEHIND THE TILL the walk overlay is hidden — no crosshair, no prompt — so the
  // player has no way to discover [T] and [D] except by pressing every key. The
  // register screen tells them WHAT it wants ("PUT THEIR MONEY IN THE TILL"); this
  // tells them which hand to use.
  regHintText = el('span', { text: 'Work the physical register' });
  regHintTotal = el('span', { class: 'reg-keys' }, el('kbd', { text: 'T' }), el('span', { text: 'total up' }));
  regHintDrawer = el('span', { class: 'reg-keys' }, el('kbd', { text: 'D' }), el('span', { text: 'drawer' }));
  regHint = el('div', { class: 'reg-hint', style: 'display:none', role: 'status', 'aria-live': 'polite' },
    regHintText,
    regHintTotal,
    regHintDrawer,
    el('span', { class: 'reg-keys' }, el('kbd', { text: 'Esc' }), el('span', { text: 'step back' })),
  );

  viewButtons = ['normal', 'health', 'moisture'].map((mode) =>
    el('button', {
      'data-mode': mode,
      text: mode === 'normal' ? '🗺 Normal' : mode === 'health' ? '❤ Health' : '💧 Moisture',
      onclick: () => handlers.setViewMode(mode),
    }),
  );
  viewButtons[0].classList.add('active-tool');
  const viewToggle = el('div', { class: 'view-toggle', style: 'display:none' }, ...viewButtons);

  gameUi.append(hud.root, golfDayPanel.root, inspectPanel.root, groundsPanel.root, clubPanel.root, empirePanel.root, walkOverlay, regHint, laptopUi.root, objectivesPanel.root, viewToggle, editorUi.root, toolWheel.root,
    el('div', { class: 'hint-bar', style: 'display:none', text: 'Course overview · drag to pan · right-drag to rotate · wheel to zoom · V data view · Tab returns on foot · P pause' }));

  uiRoot.append(menu.root, gameUi);
  document.body.append(objectivesPanel.root);
  requestAnimationFrame(frame);

  if (sceneScope === 'shed') {
    // The persistent shed readout: created ONLY here (never in normal play), before bootShedScene
    // so the toast hook can refresh it on the first cleaning beat. Derives from shedView(state);
    // a 500 ms interval is the periodic backstop, the toast hook refreshes it immediately.
    shedChecklist = makeShedChecklist(app);
    gameUi.append(shedChecklist.root);
    setInterval(() => shedChecklist?.refresh(), 500);
    bootShedScene();
  }
}

// ?scene=shed / ?scene=shed&fresh=1 — the maintenance-shed test scene, booted
// straight past the menu on its own save keys (scopedKey). Mirrors onNewGame's
// own empire -> bootEmpire -> autosave order; unless fresh=1, prefers a prior
// shed autosave (fresh=1 does not delete it — the next autosave overwrites it).
async function bootShedScene() {
  let empire = null;
  if (!sceneFresh) {
    const loaded = await loadEmpireSave(scopedKey('autosave'), 'Shed autosave');
    if (loaded && activeState(loaded)?.property?.clubhouseVariant === 'shed') empire = loaded;
  }
  if (!empire) empire = buildShedEmpire((Math.random() * 2 ** 31) | 0);
  app.empire = empire;
  bootEmpire(empire);
  await autosave();
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

// ?keydebug=1 — watch a REAL keypress travel from the OS to the walker. Off by
// default and dynamically imported, so the normal build never loads it. This
// exists because a key can pass every synthetic harness and still do nothing
// under a real hand, and nothing else in the app can tell those apart.
// The flag is read inline rather than imported, so the overlay module is never
// fetched or parsed unless it is actually asked for.
if (new URLSearchParams(window.location.search).get('keydebug') === '1') {
  import('./debug/keyCapture.js')
    .then(({ startKeyCapture }) => startKeyCapture(app))
    .catch((e) => console.error('key capture failed to start', e));
}
