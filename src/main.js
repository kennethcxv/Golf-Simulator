// GOLF EMPIRE — application bootstrap: screens, game loop, input routing.
// All simulation lives in src/sim/ (headless-testable); this file wires it to
// the 3D course scene, the DOM UI, and the clock. The unit of play is the
// EMPIRE: one wallet, a property market, and whichever owned club is active.

import { BALANCE, simSpeedMultipliers } from './sim/balance.js';
import { installFaultGuard, reportFault, showFatalPanel } from './core/faultGuard.js';
import { watchGpuHealth } from './core/gpuHealth.js';
import { installQaLookCapture } from './core/qaLookCapture.js';
import { createFrameCap } from './core/frameCap.js';
import { createStartupHold, installStartupInputHold } from './core/startupHold.js';
import { ringingPhoneRequest, acceptBookingRequest, declineBookingRequest, fmtSlot } from './sim/reservations.js';
import { devSessionActive, resolveClubhouseVariant } from './data/clubhouseVariant.js';
import { HOLE_STATUS, TURF_ZONES, ZONE } from './sim/constants.js';
import {
  EMPIRE_VERSION, newStarterEmpire, buyProperty, sellProperty, switchProperty, activeState,
  empireUpdate, empireSnapshot, deserializeEmpireWithReport,
} from './sim/empire.js';
import { buildShedEmpire } from './sim/shedScene.js';
import { SAVE_VERSION } from './sim/state.js';
import { checkoutWalIsQuarantined, releaseCheckoutWalQuarantine } from './sim/checkoutSettlement.js';
import { addHole, courseDesignRating, holeNumber } from './sim/course.js';
import { formatMoney } from './core/utils.js';
import { createHeldKeys, overviewCameraDelta, OVERVIEW_KEYS, isTextEntryTarget } from './core/heldKeys.js';
import { calendarOf } from './sim/time.js';
import {
  clearNotifications, clearToasts, confirmDialog, containFocus, el, modal, notify,
  setNotificationScope, setPromptBindingsProvider, setPromptText, toast,
} from './ui/ui.js';
import { t } from './core/i18n.js';
import { makeHud } from './ui/hud.js';
import { makeCourseEditor } from './ui/courseEditor.js';
import { makeInspectPanel } from './ui/inspectPanel.js';
import { makeGroundsPanel } from './ui/groundsPanel.js';
import { makeClubPanel } from './ui/clubPanel.js';
import { makeEmpirePanel } from './ui/empirePanel.js';
import { openMarketplace } from './ui/marketplacePanel.js';
import { STARTING_PROPERTY_NAME } from './sim/marketplace.js';
import { makeObjectivesPanel } from './ui/objectivesPanel.js';
import { makeShedChecklist } from './ui/shedChecklist.js';
import { makeCourseMaintenancePanel } from './ui/courseMaintenancePanel.js';
import { makeGolfDayPanel } from './ui/golfDayPanel.js';
import { makeLaptop } from './ui/laptop.js';
import { makePhoneUi } from './ui/phone.js';
import { makeSettingsPanel } from './ui/settingsPanel.js';
import { makeToolWheel } from './ui/toolWheel.js';
import { makeToolTuner } from './ui/toolTuner.js';
import { startCompileScreen, primeDriverVersions } from './ui/compileScreen.js';
import { quadTransform, uvAt } from './core/laptopProjection.js';
import { makeAudio } from './core/audio.js';
import {
  tickTutorial, tutorialFlag, skipTutorial, replayTutorial, triggerContextTutorial,
} from './sim/tutorial.js';
import { makeMenu } from './screens/menu.js';
import {
  inspectData, loadDataWithStatus, saveData, summarizeSave,
} from './core/storage.js';
import {
  applyDocumentPreferences, makePreferences, RESOLUTION_PRESETS, SHADOW_QUALITY_LEVELS,
} from './core/preferences.js';
import { actionForKey, keyForAction, describeKey } from './core/keyBindings.js';
import { conditionRating, sectionTurfSummary, sectionStatus } from './sim/turf.js';
import { shopCondition, vacuumOwned, tickDeliveries } from './sim/shop.js';
import {
  changeDue as registerChangeDue,
  handTotal as registerHandTotal,
  unscannedCount as registerUnscannedCount,
} from './sim/register.js';
import { ownedWasher } from './sim/washing.js';
import { liveGolfSummary, setGolfSimulationFocus } from './sim/golfDay.js';
import {
  BELT_ORDER, CLEANING_TOOLS, MEDIUM, MEDIUM_STYLE, toolMedia,
} from './data/cleaningTools.js';
import { skuById } from './data/shopItems.js';
import { makeCourseScene } from './render3d/courseScene.js';
import { deliveryEtaText } from './sim/deliveryEta.js';
import {
  applyDivotMix,
  applyFungicideCourseMaintenancePath,
  clearCourseMaintenanceDebris,
  ensureCourseMaintenance,
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

// GOAL 28 P1 attribution seam: everything ABOVE this mark is the static
// dependency graph's fetch+parse+eval (three included — imports hoist);
// everything from here to menu-mount is the app's own top-level init. The
// load-breakdown driver reports it as pageMarks['app-eval-start'].
performance.mark('app-eval-start');

// A (Goal 20): before ANY listener is registered, a QA launch swaps the DOM's
// pointer-lock primitive for one that does not seize the operator's real
// cursor. Inert in the shipped game — see src/core/qaLookCapture.js.
installQaLookCapture();

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const preferences = makePreferences();
applyDocumentPreferences(preferences.values);
// prompts print the BOUND key for every [E]/[X]/... token; a rebind repaints
// them because setPromptBindingsProvider bumps the render revision, and the
// subscribe below bumps it again on every later preference write
setPromptBindingsProvider(() => preferences.values.controls.bindings);
preferences.subscribe(() => setPromptBindingsProvider(() => preferences.values.controls.bindings));

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
  // the live preferences document, so a QA driver can audit whether a setting
  // actually drives anything instead of only being written to storage
  preferences,
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

const NORMAL_PLAY_SPEED_IDX = Math.max(0, BALANCE.speeds.indexOf(1));
const startupHold = createStartupHold();
// This capture barrier is installed once, before UI and scene components add
// their own capture handlers. The opaque veil catches hit-testing, but document
// and window listeners would otherwise still receive its hidden input.
installStartupInputHold({ scope: window, hold: startupHold });
Object.defineProperty(app, 'startupHoldDiagnostics', {
  value: startupHold.diagnostics,
  enumerable: true,
  configurable: false,
  writable: false,
});

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
let walkQueueNote = null;
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
let toolTuner = null; // B2: the live mop/broom tuning overlay (F9)
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

// PHASE 8 (Goal 26) — ONE ESCAPE ROUTER, WITH EXPLICIT PRIORITY.
//
// "One top-level capture-phase Escape router with explicit priority. Nothing
// lower-level double-handles it."
//
// Before this there were EIGHTEEN Escape handlers across nine files -- main.js,
// simplifiedRegisterMode, courseEditor, laptop, phone, toolWheel and ui.js --
// each deciding for itself, in whatever order the listeners happened to be
// registered. That is why Escape could unwind two layers at once, or none.
//
// The router runs in the CAPTURE phase on window, so it sees the key before any
// of them, and it calls stopImmediatePropagation() whenever it acts. A layer
// therefore either gets handled here or is not reached at all -- which is the
// literal meaning of "nothing lower-level double-handles it".
//
// THE ORDER IS THE BRIEF'S, verbatim:
//   1. cancel an active drag or placement
//   2. the ledger open or animating -> close it, restore camera and input
//   3. the laptop, register, desk screen, phone or any modal -> unwind ONE layer
//   4. otherwise the pause menu
//
// Each step returns a string when it acted, so escapeRouterLog records WHICH rung
// fired. A router that silently does nothing and a router that unwound the wrong
// layer are indistinguishable from outside without that.
const escapeRouterLog = [];

function escapeRouteOnce() {
  // 1 — AN ACTIVE DRAG OR PLACEMENT. First because it is the most local thing
  // the player is holding, and because abandoning it must never also close the
  // screen it is being performed on.
  try {
    const build = buildApi();
    if (build?.isActive?.()) { build.cancel?.(); return 'placement'; }
  } catch { /* the build API is absent outside the editor */ }
  try {
    const boxes = boxPlacementApi();
    if (boxes?.isActive?.()) { boxes.cancel?.(); return 'box-placement'; }
  } catch { /* no carried box */ }
  try {
    if (toolWheel?.isOpen?.()) { toolWheel.close?.(); return 'tool-wheel'; }
  } catch { /* ditto */ }

  // 2 — THE LEDGER, including while it is still animating. The brief calls it
  // out separately from the other modals because it owns the camera and the
  // movement lock, and leaving either behind is the failure it is guarding.
  try {
    const ch = app.scene3d?.clubhouse?.();
    if (ch?.ledgerHasThePlayer?.()) {
      ch.ledgerBook?.setCarried?.(false);
      ch.ledgerBook?.setOpen?.(false);
      return 'ledger';
    }
  } catch { /* no clubhouse yet */ }

  // 3 — ONE LAYER OF WHATEVER ELSE IS OPEN. Exactly one: the brief says "unwind
  // one layer", so each of these returns immediately rather than falling
  // through and closing the thing behind it too.
  try {
    const reg = app.scene3d?.clubhouse?.()?.register;
    if (reg?.isActive?.()) { reg.leave?.({ restorePointer: false }); return 'register'; }
  } catch { /* no register */ }
  if (app.laptopOpen) { exitLaptop(); return 'laptop'; }
  if (app.frontDeskOpen) { exitFrontDesk(); return 'desk-screen'; }
  try {
    if (phoneUi?.isOpen?.()) { phoneUi.close?.(); return 'phone'; }
  } catch { /* no phone */ }

  // 4 — OTHERWISE THE PAUSE MENU, and Escape closes it again when it is up.
  if (isPauseOpen()) { closePauseMenu(); return 'pause-close'; }
  openPauseMenu();
  return 'pause-open';
}

function installEscapeRouter() {
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // A text field owns its own Escape (clearing a search box), and stealing it
    // would make the laptop's own search unusable.
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (app.screen !== 'game') return;
    const rung = escapeRouteOnce();
    escapeRouterLog.push({ at: Date.now(), rung });
    if (escapeRouterLog.length > 64) escapeRouterLog.shift();
    event.preventDefault();
    // THE LINE THAT MAKES IT A ROUTER rather than a nineteenth handler.
    event.stopImmediatePropagation();
  }, true);
  if (typeof window !== 'undefined') {
    window.__fwEscapeLog = () => escapeRouterLog.slice();
  }
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
    setTimeout(() => toast(t('hud.theOldTractorSits')), 1200);
  }
  app.courseMode = 'walk';
  app.scene3d?.setOverviewPin?.(false);
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

// D3/D4 (Goal 17) — ONE QUESTION: IS ANYTHING IN THE PLAYER'S HANDS?
//
// Carrying was never one mechanism. Cartons go through boxPlacementMode
// (`hasCarriedBox`), the ledger has its own `setCarried`/`isCarried`, and
// deliveries carry a third notion in save state. `hasCarriedCarton()` above
// knows about the first and third and nothing about the book - which is why you
// can cycle the whole cleaning belt with a ledger in your arms.
//
// This is the single predicate the belt, the prompts and the invariant all ask.
// Adding a new carryable means adding one line HERE, not remembering to guard
// four call sites, which is the "make this one system" D4 asks for.
function carriedThing() {
  if (hasCarriedCarton()) return 'carton';
  try {
    const book = app.scene3d?.clubhouse?.()?.ledgerBook;
    if (book?.isCarried?.()) return 'ledger';
  } catch { /* no clubhouse in this scene */ }
  // D4's audit found a THIRD carry notion nobody had joined up: loose GOODS,
  // tracked in `state.shop.stocking` rather than by either of the other two
  // systems. `carriedBox(state) || carriedGoods(state)` appears together three
  // times in clubhouse.js, which is the shape of a family that was known about
  // locally and never given one name.
  // The path is `state.shop.carry` - read from sim/stocking.js's own
  // `carriedGoods()` rather than guessed at. My first attempt wrote
  // `shop.stocking.carried`, which is a plausible name for a field that does
  // not exist, and would have made this branch permanently false while looking
  // completely reasonable.
  if (app.state?.shop?.carry) return 'goods';
  return null;
}

// D2 — WHAT THE SET-DOWN PREDICATE ACTUALLY SEES, READABLE FROM OUTSIDE.
//
// The set-down arm was measured RUNNING (a capture/bubble listener pair caught
// `defaultPrevented` flipping false -> true across it) while the book stayed
// carried. That puts the fault on one predicate — `carriedThing() === 'ledger'`
// — and `carriedThing` is module-scope, so no driver could read what it returns
// at the moment the key is pressed.
//
// Five links in this path were each settled by one live measurement: the
// binding, keyboard delivery, `placeAt`, `ledgerKeyHandler`, and everything
// upstream of the predicate. This is the sixth, and it exists because guessing
// at it produced four wrong answers first.
//
// A read-only accessor. It calls the same function the handler calls and adds
// the sub-answers that decide its branch order, so a driver can see WHICH of the
// three families claimed the carry.
if (typeof window !== 'undefined') {
  window.__fwCarryDiag = () => {
    let carton = null;
    let ledger = null;
    try { carton = hasCarriedCarton(); } catch (e) { carton = `threw: ${e.message}`; }
    try { ledger = !!app.scene3d?.clubhouse?.()?.ledgerBook?.isCarried?.(); } catch (e) { ledger = `threw: ${e.message}`; }
    return {
      carriedThing: carriedThing(),
      hasCarriedCarton: carton,
      ledgerIsCarried: ledger,
      shopCarry: app.state?.shop?.carry ?? null,
      // The two that separate "entered and ineffective" from "never entered".
      putDownCarriedCalls,
      putDownCarriedLastSaw,
    };
  };
}

// D1/D2 (Goal 17) — NOTHING IS EVER ABANDONED IN MID-AIR.
//
// The mechanism, found rather than guessed: the carried ledger is positioned
// every frame by `followCarry`, driven from `walk.x/walk.z/walk.yaw`
// (clubhouse.js). Enter a station and the walk controller stops driving those,
// so the book simply STOPS - hanging at waist height wherever the player last
// stood. That is "the book stays hanging in the air where I was standing",
// verbatim, and it is not a bug in carrying. It is a bug at the STATION
// BOUNDARY, which means every station is a place a carried thing can be
// stranded and fixing the cashier alone would leave the class untouched.
//
// So it is fixed once, here, at the boundary itself: anything in the player's
// hands is put DOWN before a station takes over the camera. Put down where they
// stand, which is where a person would set a book to use a till.
// D2: how many times this has been ENTERED, and what it saw. Read through
// window.__fwCarryDiag.
//
// "Entered and ineffective" and "never entered" are different bugs, and watching
// side effects cannot tell them apart — six rounds of inference on this item all
// foundered on exactly that. This counter is the only thing that distinguishes
// them, and it costs one integer.
let putDownCarriedCalls = 0;
let putDownCarriedLastSaw = null;
function putDownCarried() {
  putDownCarriedCalls += 1;
  const carried = carriedThing();
  putDownCarriedLastSaw = carried;
  if (!carried) return null;
  if (carried === 'ledger') {
    const book = app.scene3d?.clubhouse?.()?.ledgerBook;
    const walk = app.scene3d?.walk;
    if (!book || !walk) return null;
    const off = app.scene3d.clubhouse().interior.position;
    book.placeAt({
      x: walk.x - Math.sin(walk.yaw) * 0.52 - off.x,
      z: walk.z - Math.cos(walk.yaw) * 0.52 - off.z,
      ry: walk.yaw,
    });
    if (audio.ready) audio.ledgerClose?.();
    return 'ledger';
  }
  // Cartons already have their own placement verb and their own put-down; this
  // predicate exists so a future carryable cannot be forgotten here.
  return carried;
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
// N2/F2: the one place a keyboard event becomes a game verb
const boundAction = (e) => actionForKey(preferences.values.controls.bindings, e.key);
function setCameraLens(fov, near) {
  const cam = app.scene3d && app.scene3d.camera;
  if (!cam || (cam.fov === fov && cam.near === near)) return;
  cam.fov = fov;
  cam.near = near;
  cam.updateProjectionMatrix();
}

// THE OPEN IS A TIMER, AND THESE ARE ITS THREE BEATS.
//
// Named because the measurement said so: profiled on the owner's own save,
// inside the clubhouse, profile-cold (qa/goal36/cold1.json), the whole open is
// 1,401 ms of which the laptop's own JS is 14 ms. Twice now this has been
// chased as shader work — it is at zero program arrivals and always was.
//
// The lid's ease has a 154 ms time constant, so it is 99% open by ~710 ms; the
// boot screen needs long enough to read as a machine waking, not long enough to
// wait through. 1,350 ms was the old reveal and nothing measured chose it.
const LAPTOP_BOOT_MS = 420; // lid swinging → power light and boot screen
const LAPTOP_BUILD_MS = 470; // interface built here, hidden, while the lid finishes
const LAPTOP_REVEAL_MS = 900; // bar completes and the glass goes live

function enterLaptop(startPage = null) {
  putDownCarried(); // D1: a station takes the camera; nothing is left floating
  // 7 (Goal 25) — THE EXCLUSION HAS TO GO BOTH WAYS.
  //
  // `enterLedger()` already refuses while the laptop is open. Nothing refused
  // the LAPTOP while the ledger owned input, so the guard was one-way and the
  // two could stack: the Phase 7 matrix caught `ledgerOpen: true` and
  // `laptopOpen: true` in the same sample. Escape then has to unwind two layers
  // that should never have coexisted, and the book keeps suppressing movement
  // underneath a screen that has its own idea of the camera.
  if (!walkActive() || app.laptopOpen || app.frontDeskOpen || app.ledgerOpen) return;
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
    // The bar's pace is THIS number, handed over rather than copied. It used to
    // carry its own 480 ms nominal in clubhouse.js, which is the same beat
    // written twice and free to drift; and because it was a constant rather
    // than a measurement, on a machine slower than the beat the bar sprinted to
    // nine tenths and crawled. It now paces against the choreography and
    // re-estimates from what this machine actually does.
    if (ch.laptopBoot) ch.laptopBoot(LAPTOP_REVEAL_MS - LAPTOP_BOOT_MS);
    if (audio.ready) audio.laptopBoot();
  }, LAPTOP_BOOT_MS));
  // BUILD DURING THE SWING, NOT AFTER IT. The interface used to be built inside
  // the reveal timer, so its cost was ADDED to the choreography and the boot
  // bar sat finished while it ran. Measured on his own save, inside, with the
  // CDP profiler (qa/goal36/cold1.json): the build itself is 11–14 ms and the
  // whole open is 1,401 ms — the open is a TIMER, not work. But the build
  // blocks the main thread, so on a slower machine or a heavier save every one
  // of those milliseconds used to land after the bar had already claimed to be
  // done. Built here, hidden, it overlaps the lid instead.
  laptopTimers.push(setTimeout(() => {
    if (!app.laptopOpen) return;
    laptopUi.root.style.visibility = 'hidden';
    laptopUi.open(startPage);
    alignLaptopUi();
  }, LAPTOP_BUILD_MS));
  laptopTimers.push(setTimeout(() => {
    if (!app.laptopOpen) return;
    if (!laptopUi.isOpen()) { // the early build never ran; do it now rather than show nothing
      laptopUi.root.style.visibility = 'hidden';
      laptopUi.open(startPage);
    }
    // The bar completes HERE — when the interface exists — and not on a clock.
    if (ch.laptopBootFinish) ch.laptopBootFinish();
    requestAnimationFrame(() => {
      if (!app.laptopOpen) return;
      // 'live': the canvas becomes a flat sheet of the interface's own paper colour. It used to
      // paint a whole rival DESKTOP here — tiles and all — which stayed visible around the
      // misaligned DOM. Two interfaces on one screen is what made it read as a popup.
      if (ch.laptopScreen) ch.laptopScreen('live');
      laptopUi.root.style.visibility = '';
      alignLaptopUi(); // and from here the frame loop keeps it welded on, every frame
    });
  }, LAPTOP_REVEAL_MS));
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
  // Leaving between the hidden build and the reveal would otherwise strand the
  // interface at visibility:hidden.
  laptopUi.root.style.visibility = '';
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
  putDownCarried(); // D1: a station takes the camera; nothing is left floating
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

// --- the ledger book (L3) -----------------------------------------------------
// The club register on the front desk opens IN PLACE: the camera leans over the
// open spread (the laptop focus pattern), pages turn physically, Escape or E
// stands back up. No DOM UI — the book itself is the interface.
let ledgerKeyHandler = null;
let ledgerClickHandler = null;
// B3 (Goal 18): the walk overlay (and its control line) hides the moment the
// book rises, and the only key teaching left was the footer INSIDE the open
// spread — a raised-shut book taught nothing. This is the same bottom chip
// as the tool control line, phase-aware, alive for the whole interaction.
let ledgerHintEl = null;

// D3 (Goal 18): the phone booking channel. The desk phone rings for a couple
// of game-minutes; the chip says WHO is calling and what they want (read
// first, then decide), and Y/N answer it without leaving pointer lock —
// booking rides the same bookSlot path as every other channel.
let phoneChipEl = null;
let phoneRingForId = null;
let phoneLastBellAt = 0;
let phoneUi = null;
const phoneKeyLabel = () => describeKey(keyForAction(preferences.values.controls?.bindings, 'phone') || 't');
function updatePhoneRing(nowMs) {
  const state = app.state;
  if (!state || app.screen !== 'game') { removePhoneChip(); return; }
  const ring = app.laptopOpen || app.frontDeskOpen || regActive() ? null : ringingPhoneRequest(state);
  if (!ring) { removePhoneChip(); return; }
  // A1 (Goal 19): the ring is a RINGTONE now, and it keeps trilling whether
  // the phone is up or in the pocket — it stops when the call is dealt with.
  if (ring.id !== phoneRingForId || nowMs - phoneLastBellAt > 2600) {
    phoneRingForId = ring.id;
    if (audio.ready) (audio.phoneRing || audio.doorbell)?.();
    phoneLastBellAt = nowMs;
  }
  // with the phone in hand the incoming-call screen carries the choice; the
  // banner is only for a phone still in the pocket
  if (phoneUi?.isOpen()) {
    if (phoneChipEl) { phoneChipEl.remove(); phoneChipEl = null; }
    return;
  }
  const cal = Math.floor(state.clock.minutes / 1440);
  const when = `${ring.dayAbs === cal ? 'today' : `+${ring.dayAbs - cal}d`} ${fmtSlot(ring.minute)}`;
  if (!phoneChipEl) {
    phoneChipEl = el('div', { class: 'shop-lockhint phone-ring-chip' });
    document.getElementById('ui')?.appendChild(phoneChipEl);
  }
  phoneChipEl.textContent = `${t('bookings.phone.ringing')} · ${t('bookings.request.row', { name: ring.holder, size: ring.partySize, when })} · Y ${t('bookings.accept')} · N ${t('bookings.decline')} · ${phoneKeyLabel()} ${t('phone.chip.open')}`;
}
function removePhoneChip() {
  if (phoneChipEl) { phoneChipEl.remove(); phoneChipEl = null; }
  phoneRingForId = null;
}
window.addEventListener('keydown', (event) => {
  if (!phoneChipEl || !app.state) return;
  const key = event.key.toLowerCase();
  if (key !== 'y' && key !== 'n') return;
  const ring = ringingPhoneRequest(app.state);
  if (!ring) { removePhoneChip(); return; }
  event.preventDefault();
  event.stopPropagation();
  if (key === 'y') {
    const result = acceptBookingRequest(app.state, ring.id);
    toast(result.ok ? `${ring.holder} · ${fmtSlot(ring.minute)}` : result.reason, result.ok ? 'good' : 'warn');
    if (result.ok && audio.ready) audio.uiTick();
  } else {
    declineBookingRequest(app.state, ring.id);
    if (audio.ready) audio.uiTick();
  }
  removePhoneChip();
}, true);
function updateLedgerHint() {
  if (!app.ledgerOpen) {
    if (ledgerHintEl) { ledgerHintEl.remove(); ledgerHintEl = null; }
    return;
  }
  if (!ledgerHintEl) {
    ledgerHintEl = el('div', { class: 'shop-lockhint ledger-keys-hint' });
    document.getElementById('ui')?.appendChild(ledgerHintEl);
  }
  const b = preferences.values.controls?.bindings;
  const key = (action, fallback) => describeKey(keyForAction(b, action)) || fallback;
  const book = ledgerBookApi();
  // D4 (Goal 19): ONE key opens and turns forward — E all the way through the
  // book. F3 (Goal 20): and Q is the one that shuts it, not Esc.
  ledgerHintEl.textContent = book && book.isOpen()
    ? `${key('interact', 'E')} next page · ${key('moveLeft', 'A')} back · ${key('dirtSense', 'Q')} put the book away`
    : `${key('interact', 'E')} open the book · ${key('dirtSense', 'Q')} put it back`;
}
function ledgerBookApi() {
  const ch = app.scene3d?.clubhouse?.();
  return ch && ch.ledgerBook ? ch.ledgerBook : null;
}
function enterLedger() {
  if (!walkActive() || app.ledgerOpen || app.laptopOpen || app.frontDeskOpen || regActive()) return;
  const book = ledgerBookApi();
  if (!book) return;
  cancelToolKey();
  // the book's own footer teaches the keys, so it needs the LIVE bindings.
  // D4 (Goal 19): the interact key opens AND turns forward; Esc closes.
  book.setControlLabels?.({
    prev: describeKey(keyForAction(preferences.values.controls?.bindings, 'moveLeft')) || 'A',
    next: describeKey(keyForAction(preferences.values.controls?.bindings, 'interact')) || 'E',
    // F3 (Goal 20): Q closes the book. It was Esc, which is the menu key
    // everywhere else in the game and reads as "abandon" rather than "shut the
    // book". Q is the near hand on the keyboard while E is the far one, which
    // is the shape of opening and closing something you are holding.
    close: describeKey(keyForAction(preferences.values.controls?.bindings, 'dirtSense')) || 'Q',
  });
  // THE BOOK COMES TO THE PLAYER (2026-08-05 ruling): no lens change, no
  // camera focus — the journal rises to the face, the clasp frees, the cover
  // swings. The camera holds still, exactly like the card reader.
  // C1 (Goal 17): the FIRST press only brings the book up, SHUT. The second
  // press opens it. advance() owns that order; this just refuses to continue if
  // the book would not come (it is in your arms right now).
  book.advance();
  if (!book.isInHand?.()) return;
  app.ledgerOpen = true;
  document.body.classList.add('ledger-mode');
  // C1 (Full_Goal_16): NEVER take control away. resetCameraInput() clears
  // any strafe key held at the moment of opening (the C6 ordering case —
  // open mid-strafe must not glide), but pointer lock STAYS: the player
  // keeps looking around while the book rises, and the book follows the
  // face. The old exitPointerLock() here was the "control is taken away".
  resetCameraInput();
  closeLeftPanels('none');
  walkOverlay.style.display = 'none';
  const viewToggle = document.querySelector('.view-toggle');
  if (viewToggle) viewToggle.style.display = 'none';
  ledgerKeyHandler = (event) => {
    if (!app.ledgerOpen) return;
    const key = event.key.toLowerCase();
    // C6: page turns read the LIVE movement bindings, not literals — rebind
    // strafe to J/L and J/L turn pages. stopPropagation is what actually
    // CONSUMES the key: without it the walk controller's bubble listener
    // still records the hold and the character strafes under the book.
    const action = boundAction(event);
    // F3 (Goal 20): Q is the close key and it is what the footer teaches.
    // Escape still works and is deliberately NOT advertised: it is the key
    // every player reaches for to get out of anything, and letting it fall
    // through to the pause menu would open the pause veil on top of an open
    // book, which is a worse state than an unadvertised second way out.
    if (key === 'escape' || action === 'dirtSense') {
      event.preventDefault();
      event.stopPropagation();
      exitLedger();
    } else if (action === 'interact') {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return; // a held E is one action, not a page-riffle
      // D4 (Goal 19): ONE key, forward, the whole way — E raises the shut
      // book, opens it, and then TURNS THE NEXT PAGE. It never closes;
      // Esc is the one way down. ("Opening the book and turning to the next
      // page should be the same key. Do not make me learn two.")
      const held = ledgerBookApi();
      if (held && !held.isOpen()) {
        held.advance();
        if (audio.ready) audio.ledgerOpen();
        // the hint flips from "open the book" to the page controls a beat
        // after the cover starts to swing
        setTimeout(updateLedgerHint, 300);
      } else if (held) {
        const turned = held.turnPage(1);
        if (turned && audio.ready) audio.ledgerTurn();
      }
    } else if (key === 'backspace') {
      // PHASE 6 — "BACK AND FORWARD THAT BEHAVE." Backspace steps back through
      // JUMPS, shift+Backspace forward. Deliberately not the arrow keys: those
      // already turn pages, and conflating "go back a page" with "go back to
      // where I was" is what makes a Back button untrustworthy.
      //
      // Unhandled when there is nowhere to go, rather than swallowed -- a key
      // that silently does nothing teaches the player it is broken.
      const book = ledgerBookApi();
      const moved = event.shiftKey ? book?.navigateForward() : book?.navigateBack();
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        audio.ledgerTurn?.();
      }
    } else if (/^[1-9]$/.test(key)) {
      // I3 (Goal 23): the contents list prints page numbers and now they work.
      // Reaching The Deed on page 9 from the index was seven presses of E.
      //
      // PHASE 6 (Goal 26) — "OBVIOUS NAVIGATION TO EVERY SECTION FROM ANYWHERE."
      //
      // A page number is only navigation if you are looking at the contents
      // page, which is the one place you do not need it. From page 7 the number
      // keys addressed a folio the reader could no longer see. So a digit now
      // means the Nth SECTION -- the same seven names the contents lists, in the
      // same order, reachable from any page in the book.
      //
      // goToSection has existed and been exported since Goal 23 with ZERO call
      // sites: "navigation to every section" was implemented and unreachable.
      // This is the call site.
      event.preventDefault();
      event.stopPropagation();
      const book = ledgerBookApi();
      const sections = book?.sections?.() || [];
      const wanted = sections[Number(key) - 1];
      // Falls back to the page number when the digit is past the last section,
      // so nothing a reader already learned stops working.
      const jumped = wanted ? book.goToSection(wanted.id) : book?.goToPage(Number(key));
      if (jumped) audio.ledgerTurn?.();
    } else if (key === 'arrowright') {
      // F4 (Goal 20): the moveRight binding (D by default) used to turn
      // forward here as well as E. Two keys for one verb, one of them never
      // taught by the footer, and the player found it by accident. E is the
      // forward key; D does nothing in the book now. The arrows keep working
      // because they are the one pair nobody has to be told about, and A still
      // turns BACK, which is the direction E cannot express.
      event.preventDefault();
      event.stopPropagation();
      const turned = ledgerBookApi()?.turnPage(1);
      if (turned && audio.ready) audio.ledgerTurn();
    } else if (key === 'arrowleft' || action === 'moveLeft') {
      event.preventDefault();
      event.stopPropagation();
      const turned = ledgerBookApi()?.turnPage(-1);
      if (turned && audio.ready) audio.ledgerTurn();
    }
  };
  ledgerClickHandler = (event) => {
    if (!app.ledgerOpen) return;
    // C1: pointer lock stays on while reading, and a locked cursor has no
    // meaningful clientX — the mouse BUTTONS are the page directions there
    // (left = next, right = back). Unlocked clicks keep the screen-half rule.
    const direction = document.pointerLockElement
      ? (event.button === 2 ? -1 : 1)
      : (event.clientX > window.innerWidth / 2 ? 1 : -1);
    const turned = ledgerBookApi()?.turnPage(direction);
    if (turned && audio.ready) audio.ledgerTurn();
  };
  window.addEventListener('keydown', ledgerKeyHandler, true);
  window.addEventListener('pointerdown', ledgerClickHandler, true);
  updateLedgerHint(); // B3: teach the keys from the first (shut) stage
  // E2: the book has its own voice — clasp, cover, leaves — not a menu tick
  if (audio.ready) audio.ledgerOpen();
}
function exitLedger(silent = false) {
  if (!app.ledgerOpen) return;
  app.ledgerOpen = false;
  document.body.classList.remove('ledger-mode');
  updateLedgerHint(); // B3: the chip leaves with the book
  if (ledgerKeyHandler) window.removeEventListener('keydown', ledgerKeyHandler, true);
  if (ledgerClickHandler) window.removeEventListener('pointerdown', ledgerClickHandler, true);
  ledgerKeyHandler = null;
  ledgerClickHandler = null;
  // the close beat runs in the book itself: cover shuts, clasp returns, and
  // it floats back to wherever it rose from
  ledgerBookApi()?.setOpen(false);
  if (!silent && audio.ready) audio.ledgerClose();
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

// 1.4 (Goal 26) — THE ONE CLICK SINK FOR THE WHOLE SESSION.
//
// Module scope, and idempotent, because it is called from two places that cannot
// be collapsed into one: at UI construction (so the menu and its dialogs are
// covered from the first frame) and again on the game-start path (so a rebuilt
// game UI cannot end up without it). Installing twice would double every click,
// so the guard is not decoration.
//
// E1: the laptop subtree is excluded -- its own dispatcher already ticks every
// press centrally in laptop.js, and covering it here would be the second
// population all over again.
const CANCEL_WORDS = /^\s*(cancel|back|close|dismiss|not now|no thanks|never mind)\s*$/i;
const DESTRUCTIVE = /(danger|destructive|delete|remove|discard|void|quit|restart)/i;
let uiClickSinkInstalled = false;
function installUiClickSink() {
  if (uiClickSinkInstalled) return;
  uiClickSinkInstalled = true;
  window.__fwUiClick = (node) => {
    if (!audio.ready) return;
    if (node && node.closest && node.closest('.laptop-screen')) return;
    // 1.4: "Disabled controls stay silent." A disabled control did not act, and
    // the capture-phase listener below sees presses on it regardless.
    if (node && (node.disabled || node.getAttribute?.('aria-disabled') === 'true')) return;
    // 1.4: "Cancel and destructive actions get their own variant." Classified
    // from what the control IS -- its label, its class, its data-action -- so a
    // dialog's Cancel sounds like a cancel without every dialog knowing it.
    const label = (node?.textContent || node?.getAttribute?.('aria-label') || '').trim();
    const cls = `${node?.className || ''} ${node?.dataset?.action || ''}`;
    if (node && (CANCEL_WORDS.test(label) || DESTRUCTIVE.test(cls) || DESTRUCTIVE.test(label))) {
      if (audio.uiCancel) { audio.uiCancel(); return; }
    }
    audio.uiTick();
  };
  // Buttons born outside the factory still click. Factory buttons carry
  // __fwClickCue and bring their own pointerdown listener, so skipping them here
  // is what keeps one press to one sound.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    const btn = target && target.closest ? target.closest('button') : null;
    if (btn && !btn.__fwClickCue) window.__fwUiClick(btn);
  }, true);
}
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
    toast(`${advanced.length} ${advanced.length === 1 ? 'job was' : 'jobs were'} already done. Ticked off.`, 'good');
  } else {
    for (const step of advanced) toast(`✓ ${step.title}`, 'good');
  }
  if (result.phaseChanged) toast(t('hud.milestone', { title: result.phaseChanged.title }), 'good');
  if (result.firstDayCompleted) showFirstDaySummary();
  if (advanced.length || result.phaseChanged || result.firstDayCompleted) {
    if (objectivesPanel) objectivesPanel.refresh(result.view);
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
    toast(t('hud.setDownOrRecycle'), 'warn');
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
    app.scene3d?.setOverviewPin?.(true);
    const hint = document.querySelector('.hint-bar');
    if (hint) hint.style.display = '';
  }
  // GOAL 32 — the EXIT mirror of d359453's entry fix. The camera snaps back
  // in this turn, but the clubhouse gates (interior draw-distance, lamp
  // budget) settle inside the loop, so exit's stretched first frame drew a
  // one-point-light census that exists nowhere in the played day — and the
  // grass sway shader compiled a program for it, synchronously, mid-frame:
  // the 4.8 s Exit hang (qa/goal32/editor-exit-profile.json, top self-time
  // getProgramInfoLog; qa/goal32/exit-program-keys.json, one novel key one
  // field off: numPointLights 1 vs 4). Settle the gates in the same turn and
  // that frame never exists.
  app.scene3d?.settleClubhouseCameraVisibility?.();
  syncPresentationMode(presentationMode());
  // GOAL 35 — the boot warm opens and closes the editor before the veil lifts.
  // It must not rotate autosave-prev: that slot is the player's previous
  // session, and a boot that has not been played yet has nothing to put there.
  if (!editorWarmActive) autosave();
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
      toast(t('hud.diseaseOutbreak', { disease, hole: name }), 'warn');
    }
  }
  for (const key of lastDiseasedNames) {
    if (!now.has(key)) {
      const [disease, name] = key.split('|');
      toast(t('hud.diseaseCleared', { hole: name, disease: disease.toLowerCase() }));
    }
  }
  lastDiseasedNames = now;
}

// --- game lifecycle -----------------------------------------------------------

let sceneStartGeneration = 0;
let disposeGpuHealthWatch = null;
let pendingSceneBarrier = null;

function destroyCurrentScene({ hideVeil = false } = {}) {
  disposeGpuHealthWatch?.();
  disposeGpuHealthWatch = null;
  if (app.laptopOpen) exitLaptop(true);
  toolWheel?.close('scene-change');
  clearNotifications();
  audio.setToolLoop(null);
  audio.setPaused(false);
  const scene = app.scene3d;
  startupHold.cancelForScene(scene);
  const barrier = scene?.assetBarrier ? scene.assetBarrier(12000) : null;
  if (scene) scene.dispose();
  if (app.scene3d === scene) app.scene3d = null;
  app.prewarming = startupHold.isPending();
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

// GOAL 28 P3 — starter-empire generation off the main thread. The 2,240 ms
// newStarterEmpire block runs in a module worker while the veil's compositor
// animation AND its JS-driven progress bar stay alive (the main thread is
// free). The product crosses back as serializeEmpire's own string and is
// revived through deserializeEmpireWithReport — the shipping save/Continue
// machinery — and is accepted only if that revive reports a byte-clean pass
// (no migrations, no repairs). ANY other outcome — worker error, timeout,
// construction failure, dirty revive — falls back to synchronous
// newStarterEmpire with the SAME seed, so both paths are deterministic and
// identical in result. The worker owns no scene, no GL, no listeners;
// abandoning it is terminate() + GC.
const NEW_GAME_WORKER_TIMEOUT_MS = 8000;
function generateStarterEmpire(mode, seed) {
  return new Promise((resolve) => {
    const fallback = (why) => {
      if (why) console.warn(`new-game worker fell back to sync generation: ${why}`);
      performance.mark('ng-leg-sync-fallback');
      resolve(newStarterEmpire(mode, seed));
    };
    let worker;
    try {
      // The worker is its own module graph with NO preload and NO page query:
      // left alone it resolves the DEFAULT clubhouse variant while the page
      // runs pine-hills-v2, and generation seeds the wrong room's layout —
      // the goldens caught that as deterministic floor drift on every
      // worker-path New Game (sync A/B green, worker red, empire values
      // equal in Node where both sides share one environment). The variant
      // resolver's first source is the query string, so the page's RESOLVED
      // variant (flag, query, or stored setting alike) rides the worker URL
      // and the worker's shopLayout freezes the same datums at module eval.
      const workerUrl = new URL('src/workers/newGameGeneration.js', document.baseURI);
      const variant = resolveClubhouseVariant()?.variant;
      if (variant) workerUrl.searchParams.set('clubhouse', variant);
      worker = new Worker(workerUrl, { type: 'module' });
    } catch (error) {
      fallback(error?.message || error);
      return;
    }
    const token = `ng-${seed}-${Date.now()}`;
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      worker.terminate();
      fn(arg);
    };
    const watchdog = setTimeout(() => finish(fallback, `timeout after ${NEW_GAME_WORKER_TIMEOUT_MS} ms`), NEW_GAME_WORKER_TIMEOUT_MS);
    worker.onerror = (event) => finish(fallback, event?.message || 'worker error');
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.token !== token) return; // stale/foreign message: keep waiting, watchdog covers us
      if (data.error) { finish(fallback, data.error); return; }
      try {
        if (data.empire) {
          // the runtime object, structured-cloned: same code, same seed, no
          // main-thread generation. Cheap shape sanity only — this is our own
          // product, not foreign data.
          const empire = data.empire;
          if (!Array.isArray(empire.holdings) || !empire.holdings.length || !empire.activeId) {
            finish(fallback, 'worker product failed shape sanity');
            return;
          }
          // structured clone drops non-enumerable properties, and the course
          // maintenance model keeps its runtime exactly there. The worker
          // aliases it enumerably (runtimeCarry) because its coarseShadow is
          // world-meaningful — the pending coarse-to-fine import lives in it,
          // and a rebuilt shadow loses that import (goldens caught the drift).
          // Move the carried runtime back behind the non-enumerable property;
          // ensureCourseMaintenance stays as the backstop heal if a carry is
          // ever absent, and the contract test value-diffs the whole graph.
          let carried = 0;
          for (const holding of empire.holdings) {
            const model = holding?.state?.courseMaintenance;
            if (!model) continue;
            if (model.runtimeCarry) {
              Object.defineProperty(model, 'runtime', {
                configurable: true,
                enumerable: false,
                value: model.runtimeCarry,
              });
              delete model.runtimeCarry;
              carried += 1;
            }
            ensureCourseMaintenance(holding.state);
          }
          performance.mark(`ng-leg-clone-adopt-carried-${carried}`);
          finish(resolve, empire);
          return;
        }
        // JSON envelope (worker hit DataCloneError): revive through the save
        // machinery — this path regenerates the course and costs ~2 s, which
        // is why it is the fallback and not the design.
        performance.mark('ng-revive-start');
        const loaded = deserializeEmpireWithReport(data.json);
        performance.mark('ng-revive-end');
        if (loaded.report.migrations.length || loaded.report.recovered) {
          finish(fallback, 'worker product needed migrations/repairs (shape drift)');
          return;
        }
        finish(resolve, loaded.empire);
      } catch (error) {
        finish(fallback, error?.message || error);
      }
    };
    worker.postMessage({ token, mode, seed });
  });
}

function startGame(state, loadNotice = null) {
  closePauseMenu({ resume: false }); // any pause overlay dies with the old world
  // Playtest 5 P0 — THE COURSE EDITOR IS UNUSABLE.
  //
  // startGameNow already hid the editor, but it does so AFTER the new scene is
  // built, and the gap in between is the whole defect: the teardown below nulls
  // app.scene3d, then this function waits two frames and up to a 12 s asset
  // barrier before startGameNow runs. For that whole stretch the editor
  // was live, painted, and holding five capture-phase window listeners over a
  // scene that no longer existed. The editor's own pause shell carries "Load
  // game" and "Reload the game", so a player reaches it without leaving.
  //
  // Hidden here instead: while the OLD scene is still alive, which is the only
  // moment hide() can hand its camera limits and overrides back.
  if (editorUi?.isActive()) editorUi.hide();
  const generation = ++sceneStartGeneration;
  const startupToken = startupHold.begin({
    generation,
    intendedSpeedIdx: NORMAL_PLAY_SPEED_IDX,
  });
  const veil = ensureLoadVeil();
  veil.show('Preparing the course');
  app.prewarming = true;
  app.speedIdx = 0;
  resetCameraInput();
  resetStartupInputLatches();

  // A single animation-frame callback runs before paint. Yield through two so
  // the opaque veil reaches the screen before teardown and course construction
  // occupy the main thread.
  // MARKS ACROSS THE PRE-SCENE STRETCH. tools/qa/boot-mark-breakdown.js measured
  // 2,317 ms between the player committing at the menu and scene construction
  // even STARTING -- 28% of the veil, and the only large stretch of it that
  // touches nothing the player can stutter on. It was one opaque number because
  // nothing in here was stamped. Now it is three.
  performance.mark('start-scene-entry');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (generation !== sceneStartGeneration) return;
      const barrier = destroyCurrentScene();
      app.prewarming = true; // destroyCurrentScene clears this while disposing
      if (barrier) {
        veil.set('Finishing the previous course load');
        barrier.finally(() => {
          performance.mark('destroy-barrier-settled');
          if (generation !== sceneStartGeneration) return;
          startGameNow(state, loadNotice, generation, startupToken);
        });
        return;
      }
      startGameNow(state, loadNotice, generation, startupToken);
    });
  });
}

function startGameNow(
  state,
  loadNotice = null,
  generation = sceneStartGeneration,
  startupToken = null,
) {
  app.state = state;
  // The veil is already opaque here. Paint the real campaign-derived chip now,
  // before scene construction and long before the first doorway threshold, so
  // entry changes only the opacity of an already-sized layer.
  primeWalkConditionForState(app.state);
  // Loading a club is a pure restore boundary. The rolling tee-sheet horizon
  // advances in dailyTick; generating it here would post online deposits while
  // the opaque loading veil is still up and make Continue change saved cash.
  app.screen = 'game';
  performance.mark('scene-construct-start');
  app.scene3d = makeCourseScene(canvas, state);
  performance.mark('scene-construct-end');
  // GPU HEALTH (2026-08-13): the owner played a whole session at 3 fps because
  // his GPU process died and nothing in the game said so -- software rendering
  // spent a night masquerading as a performance regression. The watch names
  // both observable forms: a context that boots in SwiftShader, and a context
  // lost mid-session. reportFault lands it in crash.log next to the checkout
  // diagnostics; the toast tells the player the one thing that helps (restart).
  disposeGpuHealthWatch?.();
  disposeGpuHealthWatch = watchGpuHealth({
    canvas,
    gl: app.scene3d.renderer?.getContext?.(),
    report: (origin, message, extra) => reportFault(origin, new Error(message), extra || {}),
    notify: (kind) => toast(t(kind === 'software' ? 'gpu.softwareMode' : 'gpu.contextLost'), 'warn'),
  });
  if (!startupHold.attachScene(startupToken, app.scene3d)) {
    throw new Error('Course startup hold ownership changed before scene attachment.');
  }
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
  // G2 (Goal 23): the extra arguments are forwarded. They were dropped here, so
  // a cue that wants to know HOW FULL the drawer already is — which is the whole
  // difference between a note landing on wood and a note landing on nine other
  // notes — could not be told, and every deposit would have sounded identical.
  app.scene3d.walk.hooks.sfx = (name, ...args) => {
    if (!audio.ready) return;
    // ITEM 2: the RESULT travels back. A cue that answers a question -- how long
    // is the drawer, did the sequence start -- was answering into a void, so the
    // register could not time the cash against the drawer it had just opened.
    if (audio[name]) return audio[name](...args);
    // E1: an unmapped cue is a sender defect, not a silent no-op. Named once
    // per cue; the list stays readable for QA drivers.
    window.__fwUnknownCues = window.__fwUnknownCues || [];
    if (!window.__fwUnknownCues.includes(name)) {
      window.__fwUnknownCues.push(name);
      console.warn('[audio] unknown cue:', name);
    }
  };
  app.scene3d.walk.hooks.footstep = (surface, intensity) => {
    if (audio.ready) audio.footstep(surface, intensity);
    // R-G: the surface is logged beside each step so a driver can assert
    // 100% agreement between where the player stands and which voice spoke.
    const log = (window.__fwFootsteps = window.__fwFootsteps || []);
    const w = app.scene3d?.walk?.state;
    log.push({ at: performance.now(), surface, x: w ? +w.x.toFixed(2) : null, z: w ? +w.z.toFixed(2) : null });
    if (log.length > 240) log.splice(0, log.length - 240);
  };
  // E1: the button-factory click sink. The laptop subtree is excluded here
  // (its dispatcher already ticks every press centrally in laptop.js).
  // 1.4 — "Cancel and destructive actions get their own variant. Disabled
  // controls stay silent."
  //
  // Routed here rather than at each call site because there is one sink and
  // dozens of call sites, and a per-site rule would be wrong at whichever site
  // somebody forgot. The classification reads what the button IS -- its class,
  // its type, its accessible name -- so a dialog's Cancel sounds like a cancel
  // without every dialog having to know it.
  installUiClickSink();
  // Task-4 cleaning cadence hooks, routed through the generic audio surface: a stroke turnaround
  // fires a velocity-scaled accent (rate-limited in audio), a spray squeeze fires a trigger puff.
  app.scene3d.walk.hooks.onStrokeReversal = (toolId, intensity) => {
    if (audio.ready && audio.strokeAccent) audio.strokeAccent(toolId, intensity);
  };
  app.scene3d.walk.hooks.onSprayPulse = () => { if (audio.ready && audio.sprayPulse) audio.sprayPulse(); };
  // Phase 6 — the broom's three audio layers ride the rig's live intensity:
  // a start transient on the contact edge, the loop's gain/pulse following the
  // stroke, and a soft tail on release. Edge state lives here because audio
  // owns the layers and the renderer only reports feel.
  let broomContactWas = false;
  app.scene3d.walk.hooks.onBroomFeel = (intensity, inContact, surface) => {
    if (!audio.ready) return;
    audio.setToolLoopIntensity?.('broom', intensity, surface);
    if (inContact && !broomContactWas && audio.broomStart) audio.broomStart();
    if (!inContact && broomContactWas && audio.broomStop) audio.broomStop();
    broomContactWas = inContact;
  };
  // E3 — the same three layers for the other eight tools. The broom keeps its
  // own authored transients above; this drives every other tool's loop from the
  // live stroke intensity and fires a shaped contact/release burst on the edges,
  // rendered from the shape the tool itself declares (cleaningTools.js `tone`).
  let toolContactWas = false;
  let toolContactKind = null;
  app.scene3d.walk.hooks.onToolFeel = (toolId, intensity, inContact, surface) => {
    if (!audio.ready) return;
    audio.setToolLoopIntensity?.(toolId, intensity, surface);
    if (inContact && !toolContactWas) audio.toolContactStart?.(toolId);
    // Release on the tool that was actually in contact, not on whatever is in
    // hand by the time the edge lands — swapping mid-stroke would otherwise play
    // the new tool's tail for the old tool's work.
    if (!inContact && toolContactWas) audio.toolContactStop?.(toolContactKind || toolId);
    toolContactWas = inContact;
    if (inContact) toolContactKind = toolId;
  };

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
  app.scene3d.walk.hooks.openLedger = () => enterLedger();
  // F2: the one place that knows a station panel is up. courseScene's dirt
  // sense asks it every frame so the reveal cannot stay lit behind the till, the
  // laptop lid or the ledger — the player is reading, not looking round.
  app.scene3d.walk.hooks.stationOpen = () => !!(
    app.laptopOpen || app.ledgerOpen || app.frontDeskOpen || regActive()
  );
  // N2/F2: the walk controller resolves movement and hold verbs through the
  // same binding table as the dispatcher above
  app.scene3d.walk.hooks.bindings = () => preferences.values.controls.bindings;
  app.scene3d.walk.hooks.openFrontDesk = (reservationId) => enterFrontDesk(reservationId);
  app.scene3d.walk.hooks.toggleOverview = () => handlers.toggleCourseMode();
  app.scene3d.walk.hooks.turfLabelAt = (cx, cy) => {
    const section = sectionAtCell(cx, cy);
    if (!section) return null;
    if (TURF_ZONES.has(section.zone) && app.state.turf) {
      return `${section.name} - ${sectionStatus(app.state, section)} - [E] inspect`;
    }
    return `${section.name} - [E] inspect`;
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
      return '💦 Hose out - aim at turf to water · [F] next tool';
    }
    return `💦 ${section.name} - moisture ${Math.round(st.turf.moisture[i])} - hold the mouse button to water · [F] next tool`;
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
      return '⛏ Divot kit out - aim at worn turf · [F] next tool';
    }
    const w = Math.round(st.turf.wear[i]);
    const localized = section.zone === ZONE.GREEN ? st.turf.ballMarks?.[i] || 0 : st.turf.divots?.[i] || 0;
    const damageLabel = section.zone === ZONE.GREEN ? 'ball marks' : 'divots';
    return w <= 1 && localized <= 0.1
      ? `⛏ ${section.name} - smooth, no ${damageLabel} here · [F] next tool`
      : `⛏ ${section.name} - ${damageLabel} ${localized.toFixed(1)} · wear ${w} - hold to repair`;
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
      return '🧹 Bunker rake out - aim at sand · [F] next tool';
    }
    const w = Math.round(st.turf.wear[i]);
    return w <= 1
      ? '🧹 This sand is raked smooth · [F] next tool'
      : `🧹 Bunker - footprints ${w} - hold the mouse button to rake`;
  };
  if (editorUi && editorUi.isActive()) editorUi.hide();
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
  toast(t('hud.welcome', { club: state.clubName, mode: state.mode }));
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
  // FIRST-RUN COMPILE SCREEN: on a fresh profile (or after a driver update)
  // the load ahead is real shader compilation, so the veil says so the way
  // shipped games do, with the live program count as the number. The stamp
  // that gates it is written by finish(true) only after the belt warm — an
  // aborted first run shows the screen again next boot, which is the truth.
  const compileScreen = startCompileScreen({ renderer: sceneRef.renderer, veil });
  // WHAT EACH WARM STAGE COSTS, not only what it minted.
  //
  // The compile SCREEN is gated on the stamp; the warms below it are not, and
  // until this ledger existed nobody could say what that was worth. Every stage
  // records its wall time and the programs it minted, so "this stage mints zero
  // on a stamped boot" becomes a number rather than an argument -- which is the
  // whole test for whether it still needs to run.
  const bootLedger = {
    stamped: !compileScreen.active,
    mode: compileScreen.mode,
    startedAt: performance.now(),
    stages: [],
  };
  window.__fwBoot = bootLedger;
  // EVERY WARM STAGE IS A rAF LOOP, so the honest unit is not only wall time but
  // FRAMES and the cadence they arrived at. A stamped boot that reproduces a
  // cold boot stage-for-stage within 1% is not paying for compiles -- compiles
  // vary -- it is paying a fixed number of frames at whatever rate the browser
  // is willing to give, and Chromium throttles rAF to 1 Hz for an occluded
  // window. Without this the two cases are indistinguishable in the record.
  // A STAGE CAN BE TURNED OFF FROM THE URL, so what each one BUYS can be
  // measured rather than argued about. `?nowarm=belt,editor` skips those stages
  // and records them as skipped in the ledger, which is how the A/B that decides
  // whether a stage earns its place in the boot is run (tools/qa/warm-stage-
  // value.js). It changes nothing when the parameter is absent.
  const skippedWarms = (() => {
    try {
      // window.__fwNoWarm is the same switch reachable from a QA init script,
      // because the Electron shell loads index.html with no query string and a
      // driver cannot add one before the scene starts.
      const raw = new URLSearchParams(location.search).get('nowarm')
        || (typeof window !== 'undefined' ? window.__fwNoWarm : '') || '';
      return new Set(String(raw).split(',').map((x) => x.trim()).filter(Boolean));
    } catch { return new Set(); }
  })();
  const timeWarmStage = async (label, fn) => {
    // A RETIRED STAGE CAN BE PUT BACK FOR A MEASUREMENT. `?forcewarm=belt-outdoor`
    // (or window.__fwForceWarm) runs a stage the retirement list would skip, so
    // "what did retiring this cost" is answerable without editing the source --
    // which matters because the retirement was decided on a driver that only
    // ever stood indoors.
    const forced = (() => {
      try {
        const raw = new URLSearchParams(location.search).get('forcewarm')
          || (typeof window !== 'undefined' ? window.__fwForceWarm : '') || '';
        return new Set(String(raw).split(',').map((x) => x.trim()).filter(Boolean));
      } catch { return new Set(); }
    })();
    const retired = RETIRED_WARM_STAGES.has(label) && !forced.has(label) && !forced.has('all');
    if (retired || skippedWarms.has(label) || skippedWarms.has('all')) {
      bootLedger.stages.push({
        label,
        ms: 0,
        frames: 0,
        msPerFrame: null,
        msPerYield: null,
        skipped: true,
        retired: RETIRED_WARM_STAGES.has(label),
        forced: false,
        minted: 0,
      });
      return undefined;
    }
    const programsBefore = sceneRef.renderer?.info?.programs?.length ?? -1;
    const t0 = performance.now();
    warmBudgetHit = false;
    warmDeadlineAt = t0 + (WARM_STAGE_BUDGET_MS[label] ?? Infinity);
    let frames = 0;
    let counting = true;
    const count = () => { if (!counting) return; frames += 1; requestAnimationFrame(count); };
    requestAnimationFrame(count);
    const visible = typeof document !== 'undefined' ? document.visibilityState : null;
    const focused = typeof document !== 'undefined' && document.hasFocus ? document.hasFocus() : null;
    const value = await fn();
    counting = false;
    warmDeadlineAt = Infinity;
    const ms = performance.now() - t0;
    const programsAfter = sceneRef.renderer?.info?.programs?.length ?? -1;
    bootLedger.stages.push({
      label,
      ms: +ms.toFixed(1),
      frames,
      // NOT A PRESENTATION RATE, and it was read as one for a week. During a
      // stage that blocks the main thread this is wall time PER YIELD: the
      // editor stage measured 3,008.4 here on 2026-08-19 while rAF on the same
      // page ran at 9.9 ms. A metronomic ~1005 across four stages was four
      // stages blocking about a second at a time, not a 1 Hz compositor.
      // msPerYield is the same number under the name that cannot mislead;
      // msPerFrame stays because tools/qa/boot-cost-ledger.js reads it.
      msPerFrame: frames ? +(ms / frames).toFixed(1) : null,
      msPerYield: frames ? +(ms / frames).toFixed(1) : null,
      budgetMs: WARM_STAGE_BUDGET_MS[label] ?? null,
      // NO SILENT CAPS: a stage that ran out of budget says so, because
      // "warmed 9/9" and "warmed 3 then ran out" must never read the same.
      budgetHit: warmBudgetHit,
      visible,
      focused,
      programsBefore,
      programsAfter,
      minted: programsAfter - programsBefore,
    });
    return value;
  };
  let prewarmSucceeded = false;
  let degradedPrewarmNotice = null;
  const prewarmProgramsBefore = sceneRef.renderer?.info?.programs?.length ?? -1;
  const prewarmStartedAt = performance.now();
  sceneRef
    .prewarm((label) => { if (app.scene3d === sceneRef) veil.set(label); })
    .then((completed) => {
      const prewarmProgramsAfter = sceneRef.renderer?.info?.programs?.length ?? -1;
      const prewarmRowLabel = 'prewarm'; // bound first: the strings ratchet
      bootLedger.stages.push({
        label: prewarmRowLabel,
        ms: +(performance.now() - prewarmStartedAt).toFixed(1),
        frames: null,
        msPerFrame: null,
        visible: typeof document !== 'undefined' ? document.visibilityState : null,
        focused: typeof document !== 'undefined' && document.hasFocus ? document.hasFocus() : null,
        programsBefore: prewarmProgramsBefore,
        programsAfter: prewarmProgramsAfter,
        minted: prewarmProgramsAfter - prewarmProgramsBefore,
      });
      if (app.scene3d !== sceneRef || generation !== sceneStartGeneration) return;
      if (completed !== true) throw new Error('Course prewarm ended before completion.');
      const report = sceneRef.firstDoorVisibilityReport?.();
      if (report?.status === 'degraded') {
        const sources = report.degradedSources?.length
          ? report.degradedSources.join(', ')
          : 'clubhouse assets';
        degradedPrewarmNotice = `Some ${sources} used safe fallback visuals.`;
      }
      prewarmSucceeded = true;
    })
    .catch((error) => {
      const report = error?.firstDoorVisibilityReport
        || sceneRef.firstDoorVisibilityReport?.()
        || null;
      reportFault('scene.prewarm', error, {
        generation,
        currentGeneration: sceneStartGeneration,
        firstDoorVisibility: report,
      });
      // An old scene finishing late cannot dispose, veil, or otherwise affect
      // the scene that replaced it.
      if (app.scene3d !== sceneRef || generation !== sceneStartGeneration) return;
      sceneStartGeneration += 1;
      compileScreen.finish(false); // no stamp: an unfinished compile is not done
      veil.set('Course loading could not finish safely');
      destroyCurrentScene({ hideVeil: false });
      showFatalPanel({
        message: report?.status === 'timed-out'
          ? 'Clubhouse assets did not finish loading safely. Reload to try again.'
          : `Course loading failed: ${String(error?.message || error)}`,
      });
    })
    .finally(async () => {
      if (!prewarmSucceeded
        || app.scene3d !== sceneRef
        || generation !== sceneStartGeneration) { compileScreen.finish(false); return; }
      const startupCompletion = startupHold.complete(startupToken, sceneRef);
      if (!startupCompletion) { compileScreen.finish(false); return; }
      app.speedIdx = startupCompletion.intendedSpeedIdx;
      lastTs = performance.now();
      app.prewarming = false;
      // PLAYTEST 5 P0 — "I see the map before I load in."
      //
      // Nothing here brings the camera back to the player. enterWalk() ran long
      // before prewarm, so walk.active has been true the whole time and reads
      // healthy, but prewarm SWINGS THE CAMERA out over the course to warm the
      // overview and editor programs — measured at camY 147.96 for the whole
      // prewarm on a fresh boot, against a walk eye of −0.84
      // (tools/qa/electron-load-in-hands-and-camera.js). The camera only comes
      // home on the next production frame, which is scheduled, while this line
      // starts a 420 ms CSS fade immediately. Whether the player sees the course
      // view was decided by which of those two won a race, and on that boot the
      // frame won by 287 ms.
      //
      // GOAL 27 PHASE 2, ATTEMPTED AND REVERTED — the editor's first entry
      // (875-1051 ms, +38-46 programs, BOTH disk-cache tiers) was warmed here
      // as a real enter/exit round trip under the opaque veil. The census then
      // measured the player's first entry at NINE AND A HALF SECONDS (+12p):
      // the under-veil exit leaves state (rebuildSectionIndex / layer refresh
      // territory) that makes the next real entry rebuild far more than the
      // lazy build it replaced. Do not retry this shape without understanding
      // what exitEditor invalidates. The stall itself is still open, and the
      // warm-tier fact stands: ANGLE translation/link do not disk-cache, so
      // the owner pays ~1 s on his first editor open of every session.
      //
      // The BELT warm is a different story: tool equips through the live loop
      // are the same verbs the game runs all day, and their under-veil round
      // trip leaves nothing behind (census: every tool's first press clean).
      // The clip standard moved them here from the deferred slot — see
      // warmBeltThroughLiveLoop.
      // RETIRED 2026-08-19 -- MEASURED, NOT ASSUMED. See the tombstone below the
      // overview stage for the table and the reasoning. The functions stay,
      // reachable through the ledger's stage machinery, because the measurement
      // that retired them is a measurement of THIS machine on THIS build.
      await timeWarmStage('belt', () => warmBeltThroughLiveLoop(sceneRef, generation, () => sceneStartGeneration));
      if (app.scene3d !== sceneRef || generation !== sceneStartGeneration) { compileScreen.finish(false); return; }
      // The same belt again under the COURSE's light count. The pass above
      // mints the four-light variant of every tool because the interior's
      // lamps are still lit under this veil; outdoors is one light, and the
      // player pays 3.5 s for the washer the first time he presses it out
      // there. See warmBeltUnderCourseLights.
      await timeWarmStage('belt-outdoor', () => warmBeltUnderCourseLights(sceneRef, generation, () => sceneStartGeneration));
      if (app.scene3d !== sceneRef || generation !== sceneStartGeneration) { compileScreen.finish(false); return; }
      // GOAL 32: the laptop close-up is the one station view the warms above
      // never draw — its five first-open programs (2.1 s in the player's
      // hands on a resumed save) are paid here instead.
      await timeWarmStage('laptop-view', () => warmLaptopViewThroughLiveLoop(sceneRef, generation, () => sceneStartGeneration));
      if (app.scene3d !== sceneRef || generation !== sceneStartGeneration) { compileScreen.finish(false); return; }
      // GOAL 35: the editor and Tab, the last two surfaces that still compiled
      // in his hands — pressed for real, their rails pressed for real, closed
      // for real, all of it under this veil.
      await timeWarmStage('editor', () => warmEditorThroughLiveLoop(sceneRef, generation, () => sceneStartGeneration));
      if (app.scene3d !== sceneRef || generation !== sceneStartGeneration) { compileScreen.finish(false); return; }
      // AFTER the editor, deliberately. The editor's hide() ends on
      // frameCourse(), which re-poses the SHARED orbit rig — so a Tab warm run
      // before it frames the course from one place and the player's real Tab
      // frames it from another, which is six programs' worth of different
      // objects in shot (qa/goal34/warm4.json row 04, all six one key-step from
      // their twins on the light-count field with the census IDENTICAL either
      // side, so framing is what is left).
      await timeWarmStage('overview', () => warmOverviewThroughLiveLoop(sceneRef, generation, () => sceneStartGeneration));
      if (app.scene3d !== sceneRef || generation !== sceneStartGeneration) { compileScreen.finish(false); return; }
      // The compile work under this veil is done (prewarm + belt warm), so the
      // stamp is earned: land the count on n / n and gate the screen off for
      // every later boot on this profile and driver.
      compileScreen.finish(true);
      bootLedger.warmsDoneMs = +(performance.now() - bootLedger.startedAt).toFixed(1);
      bootLedger.prewarmTimings = sceneRef.prewarmTimings?.() || null;
      // Yield through two animation frames instead — the same paint-yield idiom
      // startGame uses. The startup hold is released above, so the first of
      // those is a real production frame drawn from the walk camera, and the
      // veil is opaque over it. The player's first visible frame is their feet.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (app.scene3d !== sceneRef || generation !== sceneStartGeneration) return;
          veil.hide();
          bootLedger.veilLiftedMs = +(performance.now() - bootLedger.startedAt).toFixed(1);
        });
      });
      // ROUND 4: the first-press stalls come back warm, DEFERRED -- seconds
      // after the game is interactive, never at this boundary. The full story
      // is on scheduleDeferredGpuWarm below.
      scheduleDeferredGpuWarm(sceneRef);
      const notices = [degradedPrewarmNotice, loadNotice].filter(Boolean);
      if (notices.length) {
        setTimeout(() => {
          if (generation === sceneStartGeneration && app.scene3d === sceneRef) {
            for (const notice of notices) toast(notice, 'warn');
          }
        }, 460);
      }
    });
}

// full-screen loading veil (opaque — it also hides the prewarm camera swings)
let loadVeil = null;
// DISABLED, and kept rather than deleted so the next attempt starts from what
// was learned rather than from scratch.
//
// It worked: the dustpan's first equip went from 282 ms / +8 GL programs to
// 46 ms / +0, and the broom's from 362 ms / +9 to 102 ms / +1. But the owner
// then reported the game "absolutely unplayable, like 3 fps" with
// `GPU state invalid after WaitForGetOffsetInRange` in the log -- a GPU process
// loss, after which Chromium falls back to software rendering, which is exactly
// what 3 fps looks like.
//
// I CANNOT PROVE THIS CAUSED IT. The harness measures the current build as
// FASTER than the pre-change build on every axis I could take (load 49 s vs
// 64 s, 63 fps standing in both, 20.5 vs 7.0 fps after walking outdoors), and no
// run of mine reproduced the GPU loss. What is true is that this is the only
// thing tonight that asks the driver to compile shader programs at a NEW moment
// -- the veil boundary, while prewarm's uploads are still settling -- and a
// driver reset under exactly that load is a known hazard.
//
// So it is off on risk, not on evidence: a one-time 280 ms hitch on the first
// tool equip is a far better trade than a chance of a GPU reset. If the owner's
// next session is healthy with this disabled, that is the evidence, and the warm
// can come back spread over several frames well after the veil has lifted rather
// than in a burst at the boundary.
//
// ROUND 4: IT IS WANTED BACK. The owner, with the warm withdrawn: "I lag
// whenever I move from the white bottle to the dusk cleaner... I also lagged
// really hard the first time I clicked on the button to be the cashier...
// glitchy with first time button presses." Every one of those is the first
// draw of a material set compiling its GL programs on a player-facing frame.
//
// The placement is the difference from the withdrawn version. That one ran AT
// the veil boundary, while prewarm's uploads were still settling -- the one
// moment a burst of compiles could plausibly aggravate a wobbly driver. This
// one runs SECONDS AFTER the game is interactive, from a timeout, in two
// stages: the hands warm first (a real draw -- the only mechanism measured to
// actually compile the 8 hand programs; 16 renderer.compile() configurations
// and one forced-prewarm draw all failed), then compileAsync over the whole
// scene, which uses KHR_parallel_shader_compile to build every remaining
// program off the render thread -- the register mode's, the ledger's -- without
// blocking a single frame. A player equipping a tool inside the first two
// seconds simply beats the warm and pays what they always paid; the warm skips
// itself rather than fight them for the hands.
// GOAL 27 PHASE 2 — THE WHOLE BELT, THROUGH THE LIVE LOOP, UNDER THE VEIL.
//
// The veil prewarm equipped every tool and drew warm-only frames, and the
// mop's first in-play equip STILL arrived +1 program +10 geometries (93-485
// ms disk-cold, census-measured): the lazy piece builds in walkUpdate's own
// tool branches, which no warm-only draw runs. So the warm runs the PLAYER'S
// OWN PATH — each tool equipped through the immediate door while the real
// loop ticks, a few frames apiece. It first ran post-veil, deferred; the
// clip standard caught THAT as a visible parade of tools flashing at the
// player's feet (qa/clips/g27-load tiles-10). Same frames, moved under the
// still-opaque veil, where they are invisible and the mop's one first-draw
// stall lands where stalls belong.
//
// The immediate door, not the debounced one: the debounced setter parks a
// switch made inside 120 ms in a queue drained only by walkUpdate — the
// dustpan-in-your-hands bug of Playtest 5. And getTool, not walk.tool.
// THE NUMBER THAT SAYS WHETHER A WARM AND A PRESS SAW THE SAME LIGHTING.
// Counts by light type, visibility chain and camera layers included, because
// that is exactly what three keys a program on. A warm that reports 'done'
// while standing under a different census warmed a state the player never
// reaches, and this repo has now shipped that mistake four times.
// A WARM STAGE IS A FRAME COUNT, SO ITS WALL COST IS THE FRAME INTERVAL.
//
// The belt is 36 frames, the laptop 54, the editor 39, the overview 8: 137
// frames, and NOT ONE of them is bounded in time. On a machine presenting at
// 60 Hz that is about two seconds. On 2026-08-19, on a box whose WebGL surface
// presents at 1 Hz -- menu 14.6 ms per frame, scene 1009.9 ms per frame, same
// window, visibilityState 'visible' throughout -- the same 137 frames cost 137
// SECONDS, and turned a 40 s boot into a 177 s one. Nothing about that is
// visible as "slow": every stage reports 'done' and mints what it always mints.
//
// So each stage gets a deadline. It is COOPERATIVE, checked at the top of each
// loop beside the generation guards, so a stage that runs out still leaves
// through its own `finally` and restores the lid, the camera and the mode. A
// stage that stops early says so in the ledger; what it did not warm is what
// the deferred GPU warm and the player's first press pay for, which is the
// trade that was already being made silently every time a frame ran long.
//
// The budgets are set well above what a healthy machine measured (belt 6.2 s,
// laptop 2.0 s, editor 6.5 s, overview 2.4 s on the fast run of the same day),
// so on hardware that is not in trouble nothing here changes at all.
const WARM_STAGE_BUDGET_MS = {
  // The laptop is the only stage still on the critical path, and 4 s is a real
  // ceiling rather than the 10 s one it used to overrun. Its two holds are time
  // bounded already but carry MINIMUM frame floors (24 and 30 frames), and at
  // the 150 ms/frame the thumbnail rig costs those floors alone were 8-9.6 s.
  belt: 10000, 'belt-outdoor': 10000, 'laptop-view': 4000, editor: 10000, overview: 5000,
};

// FOUR OF THE FIVE WARM STAGES WERE RETIRED FROM THE BOOT ON 2026-08-19.
//
// They were built one at a time, each against a real stall in the owner's
// hands, and each was correct when it was written. Together they had grown to
// 45 s of a 67 s stamped boot. tools/qa/warm-stage-value.js booted with them
// skipped and then TOUCHED every surface they exist to protect -- every belt
// tool equipped for the first time, the laptop opened, Tab, the editor entered
// and exited -- measuring the worst main-thread block each first touch caused,
// on a timer-queue recorder with a deliberate 400 ms block as its control.
//
//   first touch, with NO warm at all      worst block   programs minted
//     all nine belt tools                   <= 54.3 ms   vacuum 6, mop 2
//     Tab, the overview                        44.8 ms   2
//     enter the editor                         79.3 ms   7
//     exit the editor                          32.0 ms   0
//     open the laptop                       1,197.8 ms   6
//
// So four stages were spending ~23 s of every boot to prevent at most 79 ms of
// hitch, once, on surfaces the player reaches minutes in. Prewarm's compile
// pass and its hidden-object reveal had grown to cover what they were written
// for. The laptop is the one that still buys something real and it stays.
//
// TWO WARNINGS FOR WHOEVER REVISITS THIS. The first measurement of this A/B was
// void: the skip flag was delivered through addInitScript on an already-loaded
// page, so two CONTROL boots were compared and a 20 s "saving" was nearly
// reported from a switch that was not connected. The second was void too: the
// laptop row pressed 'l' (cart lights) and the editor check asked
// scene3d.courseEditor(), which does not exist -- so three surfaces read as
// costing nothing on a boot where they never opened. Both are why every surface
// in that driver now asserts that it actually opened before its number counts.
//
// Boot times on this machine are enormously variable -- three identical control
// boots read 45.2 s, 25.2 s and 16.2 s -- so these are decisions taken on
// repeated runs, not on one.
// AND THE FIFTH WENT ON 2026-08-19 TOO, ON A MEASUREMENT THE ABOVE COULD NOT
// MAKE: what the stage COSTS on a stamped boot, per phase.
//
// The row above kept the laptop because its first open was worth 1,197.8 ms.
// That number is still right; what was never put beside it is the price. On a
// stamped boot tools/qa/prewarm-draw-anatomy.js reads the stage at 7,300 ms --
// and reads it drawing ONE frame, minting 4 programs, with laptopThumbs
// `frames:0`. The budget above expires inside the stage's first atomic frame
// (laptopScreen('live') and the draw that follows it are one uninterruptible
// block, so a 4 s ceiling cannot stop a 7.3 s frame), and both hold loops then
// break immediately. The stage pays for the expensive half and skips the
// thumbnail half it exists for.
//
// So it was 7.3 s of every launch to save 1.2 s once, on a desk the player has
// to walk across the room to reach -- and it was not even buying the 1.2 s on
// these boots. It cannot be moved to an idle warm after the veil either: it
// takes the camera (walk.focusOn) and opens the real screen, which is not
// something that can happen while a player is holding the controls.
//
// The trade is stated rather than hidden: the FIRST laptop open of a session
// now costs about 1.2 s, and every launch is 7.3 s shorter.
const RETIRED_WARM_STAGES = new Set(['belt', 'belt-outdoor', 'laptop-view', 'editor', 'overview']);
let warmDeadlineAt = Infinity;
let warmBudgetHit = false;
const warmBudgetExpired = () => {
  if (performance.now() < warmDeadlineAt) return false;
  warmBudgetHit = true;
  return true;
};

function sceneLightCensus(sceneRef) {
  const scene = sceneRef?.scene;
  const camera = sceneRef?.camera;
  if (!scene || !camera) return 'no-scene';
  const counts = new Map();
  scene.traverse((o) => {
    if (!o.isLight) return;
    for (let p = o; p; p = p.parent) { if (!p.visible) return; }
    if (!o.layers.test(camera.layers)) return;
    counts.set(o.type, (counts.get(o.type) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([t, n]) => `${t}:${n}`).join('|');
}

async function warmBeltThroughLiveLoop(sceneRef, generationAtStart, generationNow) {
  const walk = sceneRef?.walk;
  if (!walk || typeof walk.setTool !== 'function') return;
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const held = typeof walk.getTool === 'function' ? walk.getTool() : null;
  window.__fwWarm = { hands: 'skipped', belt: 'skipped', ...(window.__fwWarm || {}) };
  if (held) return; // a resumed save can arrive holding a tool — leave it be
  const equip = walk.setToolImmediate || walk.setTool;
  const belt = BELT_ORDER.filter((tool) => tool && CLEANING_TOOLS[tool]);
  let warmed = 0;
  for (const tool of belt) {
    if (app.scene3d !== sceneRef || generationNow() !== generationAtStart) return;
    if (warmBudgetExpired()) break;
    if (walk.getTool?.() != null) break;
    equip.call(walk, tool);
    await frame();
    await frame();
    await frame();
    if (app.scene3d !== sceneRef || generationNow() !== generationAtStart) return;
    if (walk.getTool?.() === tool) equip.call(walk, null);
    await frame();
    warmed += 1;
  }
  window.__fwWarm.belt = `${warmed}/${belt.length}`;
  window.__fwWarm.hands = walk.getTool?.() == null ? 'done' : 'left-a-tool-behind';
}

// THE SAME BELT, UNDER THE COURSE'S LIGHT COUNT. 2026-08-19, round two.
//
// REINSTATED ON THE OWNER'S CALL, and built a different way from the withdrawn
// attempt below, because the measurement that justified withdrawing it was
// wrong in two places.
//
// WHAT THE NEW MEASUREMENT SAYS (qa/outdoor/red2.json, settled census reader):
//
//   indoor   PointLight:4   vacuum +1, mop +2     worst block   607 ms
//   outdoor  PointLight:1   washer +1, vacuum +1, mop +2   worst block 3,539 ms
//
// The census is the OTHER WAY ROUND from the note below: indoors is four point
// lights and the course is one. The old reading came from a fixed 1.6 s wait,
// and the settle history shows the outdoor station reading a stale
// PointLight:4 for its first 306 ms before the gate caught up -- so every
// pre-fix run recorded the previous station's value. Nothing ever "relit the
// interior": indoors was always 4.
//
// AND THE LAG HAS A REAL NUMBER NOW. The old driver reported worstMs: null for
// the presses that stalled, because a press that blocks the thread for most of
// its window produces too few rAF callbacks to have any GAPS -- a stall so big
// it erased its own evidence. Measured on the timer queue instead, the outdoor
// washer's first press blocks for 3.5 SECONDS. That is what "switching items
// out there is laggy" is.
//
// THE FIX DOES NOT MOVE THE PLAYER. All four late program arrivals differ from
// their nearest existing twin in exactly one field -- 36, the light count --
// wanting 1 where the warm produced 4 and 7. The warm runs under the veil with
// the interior's lamps all still visible, so it mints the four-light variant of
// every tool and the player walks outside and pays for the one-light variant.
// So: hide the scene's point lights down to the course's count, run the same
// belt through the same live loop, and put every light back exactly as it was.
//
// No teleport, no camera move, no settleClubhouseCameraVisibility() -- which is
// what poisoned the previous attempt, because it re-gates materials and
// programs release on material dispose. Nothing here disposes anything. The
// tool viewmodel is drawn by the walk camera on every frame, which is why this
// reaches the materials that the goal-34 light-census experiment could not:
// that one hid lights and drew the SHOP, whose props batch at layers.mask 0.
//
// The restore is asserted, and it is the control: window.__fwWarm.beltOutdoor
// records lightsRestored, and a mismatch is reported rather than swallowed.
async function warmBeltUnderCourseLights(sceneRef, generationAtStart, generationNow) {
  const walk = sceneRef?.walk;
  const scene = sceneRef?.scene;
  const camera = sceneRef?.camera;
  window.__fwWarm = { hands: 'skipped', belt: 'skipped', ...(window.__fwWarm || {}) };
  if (!walk || typeof walk.setTool !== 'function' || !scene || !camera) {
    window.__fwWarm.beltOutdoor = 'no-scene';
    return;
  }
  if (typeof walk.getTool === 'function' && walk.getTool()) {
    window.__fwWarm.beltOutdoor = 'holding-a-tool';
    return;
  }
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  // Every point light the camera can currently see, with the visibility it
  // arrived with. THIS LIST IS THE RESTORE, so it is captured before anything
  // is touched and nothing else may be added to it.
  const lit = [];
  scene.traverse((o) => {
    if (!o.isPointLight) return;
    let shown = o.visible;
    for (let q = o.parent; q && shown; q = q.parent) shown = q.visible;
    if (!shown) return;
    if (!o.layers.test(camera.layers)) return;
    lit.push(o);
  });
  const censusBefore = sceneLightCensus(sceneRef);
  // Leave ONE standing: the course reads PointLight:1, not zero, and warming a
  // count the player never stands in is the exact mistake this is fixing.
  const hidden = lit.slice(1);

  // THE LAYER MASK, NOT `visible`. The first cut of this set o.visible = false
  // and the census still read PointLight:4 during the whole warm
  // (warmSummary.beltOutdoor.censusDuring, which is why that field exists): the
  // interior's per-lamp budget gate WRITES o.visible on its own tick, so the
  // hide was undone before the next frame and nine tools were warmed under
  // exactly the census they were already warmed under. Three keys the light
  // count off lights that are visible AND pass the camera's layer test, and
  // nothing re-asserts the mask.
  const wasMask = hidden.map((o) => o.layers.mask);
  hidden.forEach((o) => { o.layers.mask = 0; });
  await frame();
  const censusDuring = sceneLightCensus(sceneRef);

  let warmed = 0;
  const equip = walk.setToolImmediate || walk.setTool;
  const belt = BELT_ORDER.filter((tool) => tool && CLEANING_TOOLS[tool]);
  // IF THE CENSUS DID NOT MOVE, DO NOT WARM. Nine tool equips under the census
  // the previous stage already warmed is pure cost for zero arrivals removed,
  // and -- worse -- it would report "warmed 9/9" while warming nothing new.
  if (censusDuring === censusBefore) {
    hidden.forEach((o, i) => { o.layers.mask = wasMask[i]; });
    window.__fwWarm.beltOutdoor = {
      warmed: '0/0',
      skipped: 'the light census did not change when the point lights were masked',
      pointLightsHidden: hidden.length,
      censusBefore,
      censusDuring,
      censusAfter: sceneLightCensus(sceneRef),
      lightsRestored: sceneLightCensus(sceneRef) === censusBefore,
    };
    return;
  }
  try {
    for (const tool of belt) {
      if (app.scene3d !== sceneRef || generationNow() !== generationAtStart) break;
      if (warmBudgetExpired()) break;
      if (walk.getTool?.() != null) break;
      equip.call(walk, tool);
      await frame();
      await frame();
      await frame();
      if (walk.getTool?.() === tool) equip.call(walk, null);
      await frame();
      warmed += 1;
    }
  } finally {
    // ALWAYS, including on an aborted generation or a thrown equip: a warm that
    // leaves the shop dark is a far worse bug than a slow tool switch.
    hidden.forEach((o, i) => { o.layers.mask = wasMask[i]; });
    if (walk.getTool?.() != null) equip.call(walk, null);
  }
  await frame();
  const censusAfter = sceneLightCensus(sceneRef);
  window.__fwWarm.beltOutdoor = {
    warmed: `${warmed}/${belt.length}`,
    pointLightsHidden: hidden.length,
    censusBefore,
    censusDuring,
    censusAfter,
    // THE CONTROL. The inside is only safe if the census it started with is the
    // census it ends with, and this says so in the record rather than assuming.
    lightsRestored: censusAfter === censusBefore,
  };
}

// THE SAME BELT, ON THE COURSE — MEASURED, BUILT, AND NOT SHIPPED. 2026-08-19.
//
// THE FAULT IS REAL AND IT HAS A NUMBER. The belt was pressed indoors and on
// hole 1 in ONE boot, twice, the second time with the route order REVERSED so
// "whichever ran first is free" could be ruled out. Both runs agreed exactly:
//
//   indoor   census ...|PointLight:1   every tool mints 0
//   outdoor  census ...|PointLight:4   washer +1, vacuum +1, mop +2
//
// Four programs that only ever arrive in the player's hands, outdoors, because
// three keys a program on the light COUNT and the belt warm only ever sees the
// spawn census. That is the owner's "switching items out there is laggy", and
// it is the axis he guessed: the belt warm is warming the wrong lighting.
//
// THE FIX WORKED AND WAS STILL WITHDRAWN. A second belt pass at a real point on
// hole 1, position saved and restored, took the outdoor first-press cost from
// 4 programs to 0 with indoor still at 0 (qa/outdoor/switch.json vs fixed.json).
// But the INDOOR census in the verification run read PointLight:4 where every
// pre-fix run read PointLight:1, and the interior's draw-distance and per-lamp
// budget settle on a 2 Hz gate. On the box this was measured on the WebGL
// surface presents at 1 Hz (menu 14.6 ms/frame, scene 1009.9 ms/frame, same
// window, visibilityState 'visible' throughout), so a 2 Hz gate cannot settle
// between the teleport and the reading, and "the inside changed" and "the gate
// had not caught up" are indistinguishable from here.
//
// Adding settleClubhouseCameraVisibility() after the restore did not resolve
// it: the census still read 4 AND the outdoor cost came back to 4 (fixed2.json),
// because that call re-gates materials and programs release on material dispose.
//
// The owner's instruction was DO NOT BREAK THE INSIDE. Shipping a warm that
// might relight the clubhouse, on evidence that cannot tell whether it does,
// is not a trade to make on his behalf. What is needed first is a machine that
// presents frames, or an instrument that reads the interior census after the
// gate has provably settled rather than after a fixed wait.

// THE POINT-LIGHT CENSUS — TRIED, MEASURED, REMOVED. READ THIS BEFORE RETRYING.
//
// Goal 34 left three surfaces arriving programs on their first press — the
// editor (7), Tab (3), the editor's tool bar (2) — and the nearest-twin diff
// says they are the same axis: the field 19-20 from the end of the cache key,
// which is the light COUNT the material was compiled against. The editor goes
// 4 -> 0, Tab 4 -> 1, editor tools 4 -> 3. The twin always exists at the same
// field width, so the material itself is drawn in ordinary play; only the count
// is new.
//
// So a warm was written that hid the scene's point lights one at a time and drew
// a real production frame at every count, under the veil. It ran
// (`pointLightCensus: "drawn:6,5,4,3,2,1,0"`, qa/goal34/census1.json) and it
// changed NOTHING: editor 7 -> 7, Tab 3, editor tools 2, with five of the
// editor's seven still naming 4 -> 0.
//
// WHY, AND THIS IS THE USEFUL PART. Drawing the census from the WALK camera only
// creates programs for the materials the walk camera submits. The ones that need
// a 0-light program are the same class the laptop warm had to open the laptop to
// reach: props batched with layers.mask = 0 in normal play, which no shop-floor
// camera draws at all. Reaching them means putting the camera in the editor or
// the overview — and goal 27 measured an under-veil editor round trip making the
// player's NEXT real entry take nine and a half seconds. That door is still shut.
//
// Removed rather than left in: seven extra frames on every boot for zero
// arrivals removed is a cost with no return. The next attempt has to be
// camera-side (warm the overview at each count and measure whether Tab's own
// entry pays for it), not light-side, and it needs the goal-27 aftermath
// measured before it ships.
//
// GOAL 35 TOOK THAT NEXT ATTEMPT — see warmEditorThroughLiveLoop below. The
// aftermath was measured first and is gone; the census is now drawn from the
// editor's own camera because the editor is really open when it is drawn.

// GOAL 32 — THE LAPTOP FOCUS VIEW, WARMED THE WAY THE REGISTER IS.
//
// A resumed save's first real laptop open carried a 2.1 s longtask that
// profiles as getProgramInfoLog — five programs compile because the close-up
// submits office/cart materials no boot camera ever draws (batched props
// render via layers.mask=0 in normal play; qa/goal32/laptop-program-keys.json
// has the key diffs). Same shape ROUND 7 closed for the register: do the
// thing, not a resemblance of it. This drives the GL half of enterLaptop —
// lens, seat pose, lid, live screen — through real frames under the veil,
// then restores every piece from what it actually read. The DOM half
// (laptopUi) is a CSS matrix3d projection and contributes no GL programs, so
// it stays untouched and the warm costs frames, not lid-theater seconds.
async function warmLaptopViewThroughLiveLoop(sceneRef, generationAtStart, generationNow) {
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  window.__fwWarm = { laptopView: 'skipped', ...(window.__fwWarm || {}) };
  const ch = sceneRef?.clubhouse?.();
  const walk = sceneRef?.walk;
  if (!ch || typeof walk?.focusOn !== 'function' || typeof walk?.clearFocus !== 'function') return;
  const pose = seatPose(ch);
  if (!pose) return;
  const screenBefore = ch.laptopScreenMode ? ch.laptopScreenMode() : null;
  try {
    setCameraLens(LAPTOP_FOV, LAPTOP_NEAR);
    walk.focusOn(pose);
    ch.laptopLid?.(true);
    ch.laptopBoot?.();
    ch.laptopScreen?.('live');
    // GOAL 34 — THIS WARM WAS DRAWING THE SEAT'S TRANSIT, NEVER THE SEAT.
    //
    // walkFocusOn does not snap: it starts a 0.4 s ease (pose.duration), and
    // the clubhouse's own gates — interior draw distance, per-lamp budget,
    // batched props — settle LATER inside the loop, after the camera lands.
    // Four frames is about 66 ms, so every frame this warm drew was a camera
    // in flight through states play never holds. Play's open waits 1,350 ms
    // before the screen goes live.
    //
    // Measured on a played session, resumed save, twice independently: five
    // programs still arrived at the real first open on a boot where this warm
    // reported 'done' (qa/goal34/sess1.json row 05, qa/goal34/lap1.json). Same
    // five, same axes — texture-slot shapes and one custom shader identity,
    // not a light count — which is the signature of materials that simply never
    // got submitted rather than a state one field off.
    //
    // So hold through the ease, settle the clubhouse gates in the same turn the
    // camera lands (the goal-32 editor-entry fix, applied to the seat), and
    // keep drawing afterwards so the settled state is what compiles.
    const settleUntil = performance.now() + 900;
    let laptopWarmFrames = 0;
    while (laptopWarmFrames < 90
      && (performance.now() < settleUntil || laptopWarmFrames < 24)) {
      if (app.scene3d !== sceneRef || generationNow() !== generationAtStart) return;
      if (warmBudgetExpired()) break;
      await frame();
      laptopWarmFrames += 1;
      if (laptopWarmFrames === 20) sceneRef.settleClubhouseCameraVisibility?.();
    }
    // ...and the settled seat still was not enough: the five arrivals survived
    // a 65-frame hold (qa/goal34/lap2.json). They are not the ROOM at all.
    // The laptop's first page renders fifteen PRODUCT THUMBNAILS, each a real
    // 3D draw of a catalogue proxy whose material carries a different texture-
    // slot shape from anything the shop floor submits — which is exactly what
    // the arrival axes said (uv->false, srgb->srgb-linear, a custom shader
    // identity) and why holding the camera longer could never help. The second
    // open costs 0.1 ms of thumbs and mints nothing, so they cache.
    //
    // So the warm renders them, by opening the real screen and closing it. This
    // is the belt warm's rule again: do the thing, not a resemblance of it.
    // laptopUi.open() is the DOM half only — it does not set app.laptopOpen,
    // take the camera, or stamp the tutorial flag, so nothing here is a mode
    // the player can be left in if the scene dies mid-warm.
    // The hold here is TIME-bounded, not frame-counted, because the thumbnails
    // do not all land in the open() call: an eight-frame hold drew them on one
    // run and missed them on the next, and the played-session row flipped
    // between five arrivals and zero with the warm reporting 'drawn' both times
    // (qa/goal34/lap3.json vs sess2/sess3). The tell that separates the two is
    // dTextures at the real open — fifteen new textures is fifteen thumbnails
    // being painted in the player's hands.
    try {
      laptopUi?.open?.(null);
      // GOAL 36 — `drawn:90` WAS A FRAME COUNT, NOT A THUMBNAIL COUNT, AND THE
      // WARM SAT ON A PAGE THAT HAS NO PRODUCT CARDS ON IT. Thumbnails are
      // generated lazily per sku into the thumbs rig's own WebGL context and
      // cached forever, so whichever desk shows them first pays for all of
      // them: the Pro Shop page measured 116 ms to paint against 22–43 ms for
      // every other desk, profile-cold on his own save, with toDataURL and
      // getProgramInfoLog in its self-time (qa/goal36/cold1.json). Painting
      // every desk once here is the same move the editor warm makes with the
      // tool rail — do the thing, not a resemblance of it.
      const warmed = laptopUi?.warmPages?.() || [];
      window.__fwWarm.laptopPages = warmed.join('|') || 'none';
      const thumbsUntil = performance.now() + 900;
      let thumbFrames = 0;
      while (thumbFrames < 90 && (performance.now() < thumbsUntil || thumbFrames < 30)) {
        if (app.scene3d !== sceneRef || generationNow() !== generationAtStart) return;
        if (warmBudgetExpired()) break;
        await frame();
        thumbFrames += 1;
        laptopWarmFrames += 1;
      }
      window.__fwWarm.laptopThumbs = `frames:${thumbFrames}`;
    } finally {
      laptopUi?.close?.();
    }
    window.__fwWarm.laptopView = 'done';
    window.__fwWarm.laptopViewFrames = laptopWarmFrames;
    window.__fwWarm.laptopCensus = sceneLightCensus(sceneRef);
  } finally {
    ch.laptopScreen?.(screenBefore || 'off');
    ch.laptopLid?.(false);
    walk.clearFocus();
    setCameraLens(walkFov(), WALK_NEAR);
  }
}

// GOAL 35 — TAB, WARMED BY PRESSING TAB.
//
// The overview has been warmed inside prewarm twice (goal 28 P4's framing, then
// the owner-play fix that added the real walkExit and the player pin), and it
// still arrived programs on the first press: 3 on his route, the largest one
// key-step from its twin on the point-light field, 4 -> 1. Same story as the
// editor's, same answer — the one-shot warm cannot reproduce a state the
// clubhouse's own 2 Hz gate settles into. Press the key instead.
async function warmOverviewThroughLiveLoop(sceneRef, generationAtStart, generationNow) {
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  window.__fwWarm = { overview: 'skipped', ...(window.__fwWarm || {}) };
  const alive = () => app.scene3d === sceneRef && generationNow() === generationAtStart;
  if (!alive() || app.courseMode !== 'walk' || app.laptopOpen || hasCarriedCarton()) return;
  const before = sceneRef.renderer?.info?.programs?.length ?? -1;
  const hold = async (ms, minFrames) => {
    const started = performance.now();
    const until = started + ms;
    const deadline = started + Math.max(2500, ms * 3); // an occluded window throttles rAF to 1 Hz
    let n = 0;
    while ((n < minFrames || performance.now() < until) && performance.now() < deadline) {
      if (!alive() || n > 240 || warmBudgetExpired()) break;
      await frame();
      n += 1;
    }
  };
  try {
    handlers.toggleCourseMode();
    if (app.courseMode !== 'overview') return;
    await hold(1500, 30);
    window.__fwWarm.overviewCensus = sceneLightCensus(sceneRef);
  } catch (error) {
    reportFault('scene.overview-warm', error);
  } finally {
    try { if (app.courseMode === 'overview') handlers.toggleCourseMode(); } catch (error) {
      reportFault('scene.overview-warm-exit', error);
    }
    // toggleCourseMode announces itself; nobody was watching, and the message
    // must not still be on screen when the veil lifts.
    clearToasts();
  }
  if (!alive()) return;
  await hold(300, 8);
  window.__fwWarm.overview = app.courseMode === 'walk' ? 'done' : 'left-in-overview';
  window.__fwWarm.overviewMinted = (sceneRef.renderer?.info?.programs?.length ?? -1) - before;
}

// GOAL 35 — THE COURSE EDITOR, WARMED BY OPENING THE COURSE EDITOR.
//
// The editor was the last surface still paying at the player's hands: 7 program
// arrivals and a 2.5 s frame to open it, 2 more and an 8.4 s frame on the first
// tool press (qa/goal34/census1.json rows 07 and 08 — his "I clicked FIRST TEE
// and waited about ten seconds").
//
// TWO EARLIER SHAPES MISSED, AND THEY MISSED FOR THE SAME REASON.
//   * courseScene's prewarm already puts the camera at the persisted editor pose
//     and draws ONE frame there. Its own comment records the residual: "the rest
//     needs the entry state produced by the editor's own loop."
//   * Goal 34's point-light census hid lights one at a time and drew from the
//     WALK camera. It reported drawn:6,5,4,3,2,1,0 and removed zero arrivals,
//     because the materials that need those programs are batched with
//     layers.mask = 0 and no shop-floor camera submits them at all.
// Both were resemblances. This one opens the editor.
//
// WHAT THE FIRST TOOL PRESS ACTUALLY COSTS, which is why the tools are swept:
// setTool pulls the rig IN — `rig.dist = key === 'objects' ? 155 : 260`, and
// rig.apply() is a hard cut with no tween — while
// clubhouse visibility is a function of camera distance (syncCameraVisibility's
// draw-distance gate, then shell.js's nearest-N panel budget). So the first
// press is a light-count change, which is a cache-key change on every physical
// material in frame. Three distances, three states: the entry framing, 260, 155.
//
// THE GOAL-27 BAN THIS RETIRES. Goal 27 tried an under-veil round trip and
// measured the player's next real entry at NINE AND A HALF SECONDS, and the ban
// stood for two goals on the theory that exitEditor invalidates warmed state.
// Goal 34's deletion detector measured that theory FALSE — zero deletions across
// three round trips with a proven control (qa/goal34/rt*.json, cold1.json);
// programs only ever grow. The aftermath was re-measured on this build before
// this shipped, not assumed.
//
// exitEditor's autosave is suppressed for the duration: the warm must not
// rotate autosave-prev, which is the player's previous-session safety net, over
// a boot that has not been played yet.
let editorWarmActive = false;
async function warmEditorThroughLiveLoop(sceneRef, generationAtStart, generationNow) {
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  window.__fwWarm = { editorView: 'skipped', ...(window.__fwWarm || {}) };
  const alive = () => app.scene3d === sceneRef && generationNow() === generationAtStart;
  if (!editorUi || !alive()) return;
  // enterEditor refuses (and toasts) while a carton is carried, and a resumed
  // save can arrive mid-carry. Nothing to warm through, so leave it.
  if (app.courseMode !== 'walk' || app.laptopOpen || hasCarriedCarton()) return;
  const programs = () => sceneRef.renderer?.info?.programs?.length ?? -1;
  const minted = [];
  // TIME-BOUNDED, NOT FRAME-COUNTED, and the first cut got this wrong in the
  // way this repo keeps getting it wrong. Four frames is ~28 ms; the clubhouse
  // gates settle on a 2 Hz clock, so every tool in that version warmed the
  // camera's OLD light census and minted nothing (`terrain+0p paint+0p ...`,
  // qa/goal34/warm1.json). A warm must outlast the slowest thing it is waiting
  // for, and here that is half a second.
  const hold = async (label, minFrames, minMs = 0) => {
    const before = programs();
    const started = performance.now();
    const until = started + minMs;
    // A frame budget alone is not a bound: an occluded window throttles rAF to
    // 1 Hz, and 240 of those is four minutes of black veil. Both bounds, and
    // the wall clock wins.
    const deadline = started + Math.max(2500, minMs * 3);
    let n = 0;
    while ((n < minFrames || performance.now() < until) && performance.now() < deadline) {
      if (!alive() || n > 240 || warmBudgetExpired()) break;
      await frame();
      n += 1;
    }
    minted.push(`${label}+${programs() - before}p`);
    return alive();
  };
  editorWarmActive = true;
  // enterEditor stores `app.speedIdx || 1` and exitEditor restores THAT, so a
  // boot that intended speed 0 would come back out of this warm at speed 1.
  // The warm restores what the startup hold actually chose.
  const speedBefore = app.speedIdx;
  try {
    enterEditor();
    if (!editorActive()) return;
    // The editor's own show() snaps the camera and settles the clubhouse gates
    // in the same turn, so the frames below are the settled entry state rather
    // than a transit through states play never holds — the mistake the laptop
    // warm had to be corrected for.
    if (!(await hold('entry', 24, 700))) return;
    // Then the tool rail, every button, through the editor's real setTool. A
    // press that MOVES the camera changes the light census and is held long
    // enough for the settled state to be drawn; one that does not costs four
    // frames for its own panel and previews.
    for (const key of ['terrain', 'paint', 'tee', 'green', 'bunker', 'water', 'objects', 'paths', 'measure', 'select']) {
      if (!alive()) return;
      const distBefore = sceneRef.rig?.dist ?? 0;
      try { editorUi.setTool(key); } catch (error) { reportFault('scene.editor-warm-tool', error, { key }); }
      const moved = Math.abs((sceneRef.rig?.dist ?? 0) - distBefore) > 0.5;
      if (!(await hold(key, moved ? 12 : 4, moved ? 620 : 0))) return;
    }
    // THE OVERLAYS THE CURSOR CARRIES. The brush ring, the shaped-feature
    // outline and its fill are module-level meshes that stay hidden until the
    // pointer first moves over the course, so their basic/line programs are
    // minted in the player's hand. They are RETAINED across pointer moves,
    // which is what makes them warmable — unlike the object placement ghost,
    // whose materials are cloned per type and disposed on the next one, so its
    // program is released with them and can never be pre-built.
    try {
      const tx = sceneRef.rig?.target?.x ?? 0;
      const tz = sceneRef.rig?.target?.z ?? 0;
      sceneRef.setEditorBrush?.({ x: tx, z: tz, radiusYd: 8, color: 0xffe9a0, falloff: 0.5 });
      sceneRef.setEditorFeaturePreview?.({
        outline: {
          closed: true,
          points: [
            { x: tx - 6, z: tz - 6 }, { x: tx + 6, z: tz - 6 },
            { x: tx + 6, z: tz + 6 }, { x: tx - 6, z: tz + 6 },
          ],
        },
        guides: [{ points: [{ x: tx - 6, z: tz }, { x: tx + 6, z: tz }] }],
        controls: [{ x: tx, z: tz }],
      });
      sceneRef.setMeasureLine?.([{ x: tx - 10, z: tz }, { x: tx + 10, z: tz }], '20 yd');
      await hold('overlays', 8, 200);
      window.__fwWarm.editorCensus = sceneLightCensus(sceneRef);
    } catch (error) {
      reportFault('scene.editor-warm-overlays', error);
    } finally {
      // hide() clears all three on the way out; this is belt and braces so a
      // throw between here and there cannot leave a ring on the course.
      try {
        sceneRef.setEditorBrush?.(null);
        sceneRef.setEditorFeaturePreview?.(null);
        sceneRef.setMeasureLine?.(null);
      } catch { /* hide() clears them */ }
    }
  } catch (error) {
    reportFault('scene.editor-warm', error);
  } finally {
    try { if (editorActive()) exitEditor(); } catch (error) { reportFault('scene.editor-warm-exit', error); }
    app.speedIdx = speedBefore;
    editorWarmActive = false;
  }
  if (!alive()) return;
  // The way back is a surface too: exitEditor snaps to walk and settles the
  // gates, and goal 32 paid 4.8 s for the one frame that ran before it did.
  await hold('exit', 12);
  window.__fwWarm.editorView = alive() && app.courseMode === 'walk' ? 'done' : 'left-the-editor-open';
  window.__fwWarm.editorMinted = minted.join(' ');
}

// GOAL 27, THE 10-SECOND TARGET — THE DEFERRED SWEEP IS GONE, MEASURED OFF.
//
// The compileAsync sweep at +1.6 s landed a 119-535 ms frame on the first
// minute of every boot (rAF-gap-measured on both tiers) — the exact hitch
// class this session exists to kill. Its coverage is redundant today: the
// veil prewarm already runs renderer.compile() over the same scene+camera,
// the ledger/register/belt states it was added for are warmed pre-veil, and
// program binaries disk-cache across boots. The census
// (tools/qa/electron-first-press-census.js) is the regression guard: if a
// surface starts arriving programs first-press, the coverage claim here is
// the first suspect. `sweep: 'retired'` keeps drivers that wait on
// `sweep !== 'pending'` moving.
function scheduleDeferredGpuWarm(sceneRef) {
  setTimeout(() => {
    try {
      if (app.scene3d !== sceneRef || app.prewarming) return;
      window.__fwWarm = { ...(window.__fwWarm || { hands: 'skipped', belt: 'skipped' }), sweep: 'retired' };
    } catch (error) {
      reportFault('scene.deferred-warm', error);
    }
  }, 1600);
}

function ensureLoadVeil() {
  if (loadVeil) return loadVeil;
  const el = document.createElement('div');
  el.className = 'load-veil';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-busy', 'false');
  // I (Goal 20) — A PLACE, NOT A VEIL.
  //
  // It was a logo, a bar and four tips on flat colour: thirteen seconds with
  // nothing to look at and no sense of where you were going. The backdrop below
  // is the MENU's own clubhouse scene, reused class for class — sky, horizon,
  // clubhouse, flag — so the loading screen shows the club rather than a
  // rectangle, at the cost of no new asset, no image to decode and no bytes on
  // a frame that is already busy compiling shaders.
  //
  // The club's own name goes under the logo, because "GOLF EMPIRE" is the game
  // and the player is arriving somewhere specific.
  el.innerHTML = `
    <div class="load-veil-plate" aria-hidden="true"></div>
    <div class="load-veil-plate load-veil-plate-b" aria-hidden="true"></div>
    <div class="load-veil-scrim" aria-hidden="true"></div>
    <div class="load-veil-place" aria-hidden="true"></div>
    <div class="load-veil-card">
      <div class="load-veil-logo">GOLF EMPIRE</div>
      <div class="load-veil-club"></div>
      <div class="load-veil-title"></div>
      <div class="load-veil-compile-note"></div>
      <div class="load-veil-bar" role="progressbar" aria-label="Loading game" aria-valuemin="0" aria-valuemax="100" aria-valuenow="8"><div class="load-veil-fill"></div></div>
      <div class="load-veil-compile-count" aria-hidden="true"></div>
      <div class="load-veil-step"></div>
      <div class="load-veil-tip" aria-live="off"></div>
    </div>`;
  document.body.appendChild(el);
  // E (Goal 21) — REAL GAME IMAGES, A DIFFERENT ONE EVERY TIME.
  //
  // The CSS landscape this replaces was never the ask, and worse, the check
  // that passed it counted DOM NODES rather than pixels — the same error as
  // X3's. These are photographs of this club, taken at the player's own eye
  // height with the shipped renderer (tools/qa/electron-e-loading-plates.js),
  // graded and compressed by tools/build-loading-plates.mjs.
  //
  // Chosen fresh on every show(), never repeating the previous one, so two
  // consecutive loads are never the same picture.
  const plateEl = el.querySelector('.load-veil-plate');
  const placeEl = el.querySelector('.load-veil-place');
  const PLATES = [
    { file: 'approach.jpg', caption: 'The approach, Pine Hills Municipal' },
    { file: 'porch.jpg', caption: 'The clubhouse porch, late light' },
    { file: 'fairway.jpg', caption: 'Looking down the first' },
    { file: 'treeline.jpg', caption: 'The shed and the treeline' },
    { file: 'shopfront.jpg', caption: 'The pro shop windows' },
    { file: 'green.jpg', caption: 'A green at first light' },
  ];
  // J (Goal 23) — TWO OR THREE PLATES PER LOAD, CROSS-FADING.
  //
  // One photograph per load was the Goal 21 fix for a blank veil, and on a load
  // that takes twenty seconds one picture is a still frame you sit and look at.
  // Two layers, alternating: the incoming plate is set on the hidden one and the
  // opacity is swapped, so the fade is a CSS transition and neither picture ever
  // pops.
  //
  // The drift animation restarts on whichever layer is coming forward, so every
  // plate gets the whole slow push rather than joining one already in progress.
  const plateElB = el.querySelector('.load-veil-plate-b');
  // MEASURED, and shorter than "a few seconds" sounds, for a reason. The veil on
  // this machine is up for TWO SECONDS on a fresh boot
  // (tools/qa/electron-j-loading-plates-alternate.js), so a six-second rotation
  // never fired once and the player saw exactly the one picture the old code
  // gave them. 3.5 s puts a second plate on screen inside a seven-second load
  // and a third inside eleven, while still reading as a held photograph rather
  // than a slideshow.
  //
  // On a fast machine with a short load the first plate is still the only one
  // seen, and that is correct: there is nothing to fill.
  const PLATE_SECONDS = 3.5;
  let lastPlate = -1;
  let frontIsB = false;
  let plateTimer = null;

  const paintPlate = (node, plate) => {
    node.style.backgroundImage = `url("Assets/loading/${plate.file}")`;
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
  };
  const pickPlate = () => {
    let pick = Math.floor(Math.random() * PLATES.length);
    if (PLATES.length > 1 && pick === lastPlate) pick = (pick + 1) % PLATES.length;
    lastPlate = pick;
    return PLATES[pick];
  };
  const nextPlate = () => {
    if (PLATES.length === 0) return;
    const plate = pickPlate();
    const incoming = frontIsB ? plateEl : plateElB;
    const outgoing = frontIsB ? plateElB : plateEl;
    paintPlate(incoming, plate);
    incoming.style.opacity = '1';
    outgoing.style.opacity = '0';
    frontIsB = !frontIsB;
    placeEl.textContent = plate.caption;
  };
  const showPlate = () => {
    if (PLATES.length === 0) return;
    if (plateTimer) clearInterval(plateTimer);
    // the first plate of a load appears immediately, without a fade from black
    frontIsB = true;
    const plate = pickPlate();
    paintPlate(plateEl, plate);
    plateEl.style.opacity = '1';
    plateElB.style.opacity = '0';
    frontIsB = false;
    placeEl.textContent = plate.caption;
    plateTimer = setInterval(nextPlate, PLATE_SECONDS * 1000);
  };
  const stopPlates = () => {
    if (plateTimer) clearInterval(plateTimer);
    plateTimer = null;
  };

  const clubEl = el.querySelector('.load-veil-club');
  const title = el.querySelector('.load-veil-title');
  const stepEl = el.querySelector('.load-veil-step');
  const fill = el.querySelector('.load-veil-fill');
  const tip = el.querySelector('.load-veil-tip');
  const progress = el.querySelector('[role="progressbar"]');
  const compileNote = el.querySelector('.load-veil-compile-note');
  const compileCountEl = el.querySelector('.load-veil-compile-count');
  // FIRST-RUN COMPILE SCREEN state. While on, the compile block owns the title
  // and the bar (the bar becomes REAL progress: programs built over programs
  // expected), and set()'s phase labels stay out of the way.
  let compileOn = false;
  let shownTitle = '';
  const STEPS = ['Compiling shaders', 'Uploading textures', 'Warming the view', 'Warming the day'];
  let revision = 0;
  let hideTimer = null;
  // I (Goal 20): tips that TEACH. The four this replaces were true and thin —
  // two were about menus. These are the things a player actually gets stuck on,
  // in the order they meet them, and every one of them is a fact about how the
  // game works rather than a slogan.
  const TIPS = [
    'Tap F for the next tool on the belt. HOLD F to open the whole belt, where every tool shows its own key.',
    'Your phone is in your pocket on T. The world keeps running while you read it, so you can take a booking on the way to the counter.',
    'A caller who rings out leaves a voicemail. Open the phone, play the message, then ring them back and they will answer.',
    'Tee times only come from the phone and the inbox. Ignore both and the sheet stays empty.',
    'Walk-ins ask for the next hour, not next week. What they want is on the desk screen once they reach the front of the line.',
    'The ledger opens with E and turns pages with E. Q puts it away.',
    'Dirt has to be under the crosshair to clean it. Hold Q to see where it all is.',
    'The mop works wet. When it runs dry, take it to the bucket in the cleaning bay.',
    'P pauses from anywhere: walking, the checkout, the laptop, placement or overview.',
    'Stock the shelves from the back room. An empty peg sells nothing, however good the shop looks.',
    'The laptop in the office runs the business: orders, staff, the books, the tee sheet.',
    'Manual save slots are separate from the Continue autosave, and the autosave keeps its previous generation as a spare.',
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
      showPlate(); // a different photograph of the club every load
      shownTitle = t || 'Loading';
      // a new load decides the compile screen afresh; stale mode must not leak
      compileOn = false;
      el.classList.remove('load-veil-compiling');
      delete el.dataset.compileMode;
      compileNote.textContent = '';
      compileCountEl.textContent = '';
      title.textContent = t || 'Loading';
      // the club you are arriving at, named. Falls back to the starting
      // property so the very first load is not blank. Null-tolerant: the
      // veil now rises BEFORE new-game state generation (Goal 28 P2), when
      // app.empire does not exist yet — and the starting property is exactly
      // the right name for that moment.
      clubEl.textContent = (app.empire ? activeState(app.empire)?.club?.name : null)
        || app.state?.club?.name || STARTING_PROPERTY_NAME;
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
      // While the compile screen is up, the count pump owns the bar and the
      // compile block carries the story; a phase label under it would just
      // repeat the title ("Compiling shaders" is one of the phases).
      if (compileOn) return;
      stepEl.textContent = label;
      const i = STEPS.indexOf(label);
      if (i >= 0) {
        const value = Math.round(25 + (i / STEPS.length) * 70);
        fill.style.width = `${value}%`;
        progress.setAttribute('aria-valuenow', String(value));
      }
    },
    compileBegin(mode, titleText, line2) {
      compileOn = true;
      el.classList.add('load-veil-compiling');
      el.dataset.compileMode = mode;
      title.textContent = titleText;
      compileNote.textContent = line2;
      compileCountEl.textContent = '';
      stepEl.textContent = '';
      fill.style.width = '0%';
      progress.setAttribute('aria-valuenow', '0');
    },
    compileCount(done, total) {
      if (!compileOn) return;
      compileCountEl.textContent = `${done} / ${total}`;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      fill.style.width = `${pct}%`;
      progress.setAttribute('aria-valuenow', String(pct));
    },
    compileEnd() {
      if (!compileOn) return;
      compileOn = false;
      el.classList.remove('load-veil-compiling');
      delete el.dataset.compileMode;
      title.textContent = shownTitle || 'Loading';
      compileNote.textContent = '';
      compileCountEl.textContent = '';
    },
    hide() {
      const expectedRevision = revision;
      if (tipTimer) clearInterval(tipTimer);
      tipTimer = null;
      // J (Goal 23): a rotation left running behind a hidden veil keeps
      // decoding jpegs and restarting a CSS animation for the rest of the
      // session, and the next show() would inherit a plate mid-fade.
      stopPlates();
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
  app.loadVeil = loadVeil; // reachable from QA via window.__fw (planted-activation control)
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
  startupHold.cancel();
  // Playtest 5 P0: the editor must be told BEFORE the scene it draws through is
  // destroyed. startGameNow does this on the reload path; this one did not, so
  // quitting from the editor left it live over a null scene. hide() is safe with
  // a dead scene now, but ordering it correctly is the point.
  if (editorUi?.isActive()) editorUi.hide();
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
    performance.mark('save-read-start');
    status = await loadDataWithStatus(key, { repair: false });
    performance.mark('save-read-end');
  } catch (error) {
    console.error(`${label} storage read failed`, error);
    toast(t('hud.saveUnreadable', { label }), 'warn');
    return null;
  }
  if (status.value == null) {
    toast(status.missing
      ? `${label} is empty.`
      : `${label} is damaged and no valid backup is available.`, 'warn');
    return null;
  }
  try {
    performance.mark('save-deserialize-start');
    const loaded = deserializeEmpireWithReport(status.value);
    performance.mark('save-deserialize-end');
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

// H2: the game saves by itself — every 5 minutes, on day rollover, and on quit
// — and every write records its TRIGGER in the meta. The trigger matters
// because ~15 mutation sites already call autosave(): "a fresh file exists"
// proves nothing about WHY it was written, so a driver asserting the timer
// reads the trigger field inside a mutation-free window rather than the mtime.
const AUTOSAVE_INTERVAL_MS = 5 * 60_000;
// The store already keeps primary + .bak per key. Rotating one more generation
// (autosave-prev, with its own .bak) happens on the timed/boundary triggers
// only: a mutation autosave can fire many times a minute in the editor, and
// doubling an ~800 KB write on each buys nothing the .bak does not already
// cover inside a session. Across sessions the prev generation is what survives
// a bad write landing at the worst moment.
const AUTOSAVE_ROTATING_TRIGGERS = new Set(['interval', 'rollover', 'quit']);
let autosaveChipTimer = 0;

function showAutosaveChip() {
  let chip = document.querySelector('.hud-autosave');
  if (!chip) {
    chip = document.createElement('div');
    chip.className = 'hud-autosave';
    chip.textContent = 'Autosaved';
    document.getElementById('ui').append(chip);
  }
  chip.classList.add('show');
  clearTimeout(autosaveChipTimer);
  autosaveChipTimer = setTimeout(() => chip.classList.remove('show'), 1700);
}

async function autosave(reason = 'mutation') {
  if (!app.empire) return;
  try {
    if (AUTOSAVE_ROTATING_TRIGGERS.has(reason)) {
      try {
        const current = await loadDataWithStatus(scopedKey('autosave'), { repair: false });
        if (current.value != null) await saveData(scopedKey('autosave-prev'), current.value);
      } catch (error) {
        // Rotation must never block the save itself — but it must not fail
        // SILENTLY either: the first landing of this feature swallowed an
        // "Unsupported save key" from the IPC allowlist right here and the
        // rotation quietly never happened.
        console.warn('autosave rotation skipped', error);
      }
    }
    const snapshot = empireSnapshot(app.empire);
    await saveData(scopedKey('autosave'), snapshot);
    await saveData(scopedKey('autosave-meta'), { ...currentSaveMetadata(), trigger: reason });
    // PHASE 8: the day-start snapshot that "Restart the current day" restores.
    // Written ONLY on rollover -- the interval trigger would make it drift into
    // "a few minutes ago", which is what already disqualified autosave-prev for
    // this job. Failing to write it must not fail the autosave that matters.
    if (reason === 'rollover') {
      try {
        await saveData(scopedKey('daystart'), snapshot);
        await saveData(scopedKey('daystart-meta'), { ...currentSaveMetadata(), trigger: 'daystart' });
      } catch (error) {
        console.warn('day-start snapshot skipped', error);
      }
    }
    showAutosaveChip();
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

// The timer itself. Armed once at module load; the guard keeps it silent on
// the menu, in scoped test scenes without an empire, and while paused.
setInterval(() => {
  if (app.screen === 'game' && app.empire && !isPauseOpen()) autosave('interval');
}, AUTOSAVE_INTERVAL_MS);

// OS-level close (the window X, a reload): best-effort — the in-game quit
// buttons await a real autosave('quit') and remain the reliable path.
window.addEventListener('beforeunload', () => {
  if (app.empire && app.screen === 'game') autosave('quit');
});

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
      toast(t('hud.setDownOrRecycle15'), 'warn');
      return;
    }
    resetCameraInput(); // the map opens still — nothing carries over from the walk
    if (app.courseMode === 'walk') {
      performance.mark('ov-enter-start'); // Goal 28 P4: first-press attribution
      app.courseMode = 'overview';
      app.scene3d?.setOverviewPin?.(true);
      performance.mark('ov-pin');
      exitWalk();
      performance.mark('ov-exitwalk');
      // The overview is the half of dirt visibility that answers WHICH WAY to
      // go — House Flipper 2's Flipper Sense only lights what you already face,
      // and the documented complaint is exactly that. Standing pillars over
      // every remaining pile makes the map say where the work is.
      const ch = app.scene3d.clubhouse?.();
      const piles = ch?.setDirtReveal ? (ch.dirtSenseDiagnostics?.().clusters || 0) : 0;
      performance.mark('ov-dirt-diag');
      ch?.setDirtReveal?.(1, true);
      performance.mark('ov-dirt-reveal');
      // GOAL 34 — settle the gates in the SAME TURN as the camera, the way
      // entering and leaving the editor already do. exitWalk() re-poses the rig
      // instantly, but the clubhouse's interior draw-distance and per-lamp
      // budget settle later inside the loop, so the first overview frames drew
      // a light census that exists nowhere in the played day and compiled
      // programs for it. Measured on a played session from inside the shop:
      // three arrivals on the first Tab, the largest one step from its twin on
      // the point-light field, 4 -> 1 (qa/goal34/sess1.json row 04).
      app.scene3d?.settleClubhouseCameraVisibility?.();
      toast(piles
        ? `Overview camera - ${piles} dirty spot${piles === 1 ? '' : 's'} marked. Tab returns you to your feet.`
        : 'Overview camera - Tab returns you to your feet.');
      performance.mark('ov-enter-end');
    } else {
      performance.mark('ov-exit-start');
      app.courseMode = 'walk';
      app.scene3d.clubhouse?.()?.setDirtReveal?.(0, false);
      enterWalk('resume');
      // THE EXIT NEVER GOT THE SETTLE THE ENTRY GOT.
      //
      // Goal 34 put settleClubhouseCameraVisibility() in the branch above so
      // the interior draw-distance and per-lamp budget land in the SAME TURN as
      // the camera, and the first overview frame stops drawing a light census
      // that exists nowhere in the played day. Coming BACK was left alone, and
      // it has the identical problem in the identical shape: the rig re-poses
      // instantly, the clubhouse gates settle later inside the loop, and the
      // first walk frame after Tab draws a census whose program has to be
      // compiled synchronously, mid-frame.
      //
      // Measured on the owner's own resumed save (tools/qa/tab-overview-cost.js,
      // qa/tab-overview/): the first Tab minted 3 programs going in and 1 more
      // coming back, and the first exit blocked the main thread for 658.3 ms --
      // one gap over 250 ms in the whole round trip, and it is this one. The
      // cursor is not heavy in the overview at all (p50 8.3 ms against 24.6 in
      // walk); the freeze is the toggle, and mostly the way back.
      app.scene3d?.settleClubhouseCameraVisibility?.();
      performance.mark('ov-exit-settled');
      // P1 (Goal 25 playtest): "Tab, then Tab again to leave, and the game
      // effectively crashed."
      //
      // Measured across the round trip: pointer lock true before, FALSE after,
      // and it never came back. WASD still moved (2.11 yd) so every
      // keyboard-based probe called it healthy, but mouse-look went 0.378 rad to
      // EXACTLY ZERO and stayed there through a second round trip. A player who
      // can walk and cannot turn is looking at a game that has stopped
      // responding to the mouse, which is what "effectively crashed" describes.
      //
      // enterWalk leaves lock opt-in on purpose -- on ARRIVAL the HUD controls
      // should be clickable and "Click to look around" is the instruction. The
      // Tab RETURN is a different situation: the player was mouse-looking a
      // second ago and pressed a key that means "put me back on my feet".
      // Restoring it only here keeps the arrival behaviour untouched.
      //
      // The Tab keydown is a user activation, so the request is allowed;
      // requestLook already swallows a refusal, and a refusal just leaves
      // today's click-to-look behaviour.
      requestLook();
      performance.mark('ov-exit-end');
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
    toast(t('hud.boughtProperty', { name: res.property.name, price: formatMoney(res.property.askingPrice) }));
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
    toast(t('hud.soldProperty', { price: formatMoney(res.payout) }));
    if (wasActive) {
      if (empire.holdings.length > 0) {
        switchProperty(empire, empire.holdings[0].property.id);
        startGame(activeState(empire));
        toast(t('hud.officeMoves', { club: activeState(empire).clubName }));
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

// A4 — the applying label. A small corner note, not a modal veil: Requirement 5
// forbids taking control away, and the player keeps looking around while the
// materials rebuild. It stays up long enough to cover the settling window
// measured on this machine (1.6 s for the expensive direction) rather than a
// frame, because the cost three pays lazily is spread over the frames after
// the click and a label that vanished immediately would be a lie.
let qualityApplyingEl = null;
let qualityApplyingTimer = null;
function showQualityApplying(ms = 1800) {
  if (!qualityApplyingEl) {
    qualityApplyingEl = el('div', { class: 'quality-applying', text: t('settings.display.applying') });
    document.body.append(qualityApplyingEl);
  }
  clearTimeout(qualityApplyingTimer);
  qualityApplyingTimer = setTimeout(() => {
    qualityApplyingEl?.remove();
    qualityApplyingEl = null;
  }, ms);
}

// A1 (Goal 23): the cap counts VSYNCS. A wall-clock interval cannot pace on a
// panel whose refresh does not divide it — see the measurements in
// src/core/frameCap.js.
const frameCap = createFrameCap();
app.frameCapDiagnostics = () => frameCap.diagnostics();

// GOAL 34 — ASK THE OS FOR THE REFRESH RATE, ONCE THE WINDOW EXISTS.
//
// frameCap used to infer the panel from rAF gaps, which on a GPU-bound frame is
// the game's own rate: it reported 58-63 Hz for a display Electron calls 240,
// so everyNVsyncs came out 1 and the cap never skipped a tick at any setting.
// The screen API knows. Re-asked on every display change, because dragging the
// window between a 60 Hz laptop panel and a 240 Hz desktop one is exactly the
// case no constant survives.
function refreshPanelHzFromOs() {
  const native = globalThis.fairwayNative;
  if (!native?.displayInfo) return Promise.resolve(null);
  return native.displayInfo().then((info) => {
    const hz = Number(info?.refreshHz) || 0;
    frameCap.setPanelHz(hz);
    return hz;
  }).catch(() => null);
}
app.refreshPanelHzFromOs = refreshPanelHzFromOs;
refreshPanelHzFromOs();
globalThis.addEventListener?.('resize', () => { refreshPanelHzFromOs(); });

// GOAL 27 PHASE 6 — THE PIXEL RATIO FOLLOWS THE MONITOR, so this formula is
// shared by applySettings AND the window resize path. The renderer caches the
// ratio it was constructed with, and scene3d.resize() reads that cache — so a
// drag from the 4K panel (dpr 1.5) to another display, or any change to
// window.devicePixelRatio, silently kept the old ratio: booted at 1.0 the 4K
// panel got a blurry upscale, booted at 1.5 the smaller panel paid for pixels
// it cannot show. Re-deriving here on every resize keeps the preference
// formula authoritative in both directions.
//
// A4 (Goal 17), AFTER THE VERIFIER — A PIXEL BUDGET, BECAUSE A5 CHANGED THE
// SIZE THIS SETTING IS PAID AT. Ultra asks for renderScale 1.15; since A5 the
// window fills a 4K panel and 1.15 asks for 10.4 MPix — a third more than the
// display can show. Measured on two fresh profiles: switching to Ultra froze
// the game for 10,814 and 9,885 ms — the render target reallocating. So the
// buffer is capped at what a 4K display can actually show; supersampling
// still works where it is cheap and visible (a 1080p window at 1.15 is
// 2.7 MPix and untouched).
function applyPixelRatioForViewport(values = preferences.values) {
  if (!app.scene3d?.renderer) return;
  const scale = values.display.renderScale;
  const dprCeiling = scale > 1 ? 2 : 1.5;
  const nativeRatio = window.devicePixelRatio || 1;
  let pixelRatio = Math.min(dprCeiling, nativeRatio * scale);
  const canvas = app.scene3d.renderer.domElement;
  const cssW = canvas.clientWidth || window.innerWidth;
  const cssH = canvas.clientHeight || window.innerHeight;
  const PIXEL_BUDGET = 3840 * 2160;
  if (cssW > 0 && cssH > 0) {
    const budgetRatio = Math.sqrt(PIXEL_BUDGET / (cssW * cssH));
    pixelRatio = Math.min(pixelRatio, budgetRatio);
    // ...and snap to the display's own ratio when the cap lands within a few
    // per cent of it, so a preset change does not reallocate every buffer in
    // the post chain to gain 4% of area nobody can see.
    if (Math.abs(pixelRatio - nativeRatio) / nativeRatio < 0.06) pixelRatio = nativeRatio;
  }
  // setPixelRatio re-runs setSize internally; when the ratio is unchanged the
  // buffers keep their size and nothing reallocates, so calling this on every
  // debounced resize is cheap.
  app.scene3d.renderer.setPixelRatio(pixelRatio);
}

function applySettings() {
  const values = preferences.values;
  applyDocumentPreferences(values);
  frameCap.setCap(Number(values.display.fpsCap) || 0);
  // E4 (Goal 17) — THE FORMATTED CONTROLS LIST FOLLOWS THE BINDINGS.
  //
  // "Changing a key in Controls must change it in the formatted controls list
  // too, immediately, in the same layout."
  //
  // The rebind dialog already refreshed its own BUTTONS. What it never touched
  // is the list the player actually reads in the world - the lock hint that
  // spells out "Click to look, WASD move, Shift run, E interact, X carry, Z set
  // down..." - because that string is built by walkControlHintText() once at
  // mount and then never again. Rebind Forward to T and the game went on
  // telling you it was W.
  //
  // applySettings already runs on every preference change, so this is where the
  // list belongs. Every element carrying the hint is updated, not one captured
  // reference, because the hint is mounted in two places.
  try {
    const hint = walkControlHintText();
    for (const node of document.querySelectorAll('.shop-lockhint')) node.textContent = hint;
  } catch { /* before the UI is mounted there is nothing to update */ }
  audio.applyPreferences();
  if (laptopUi) laptopUi.setScale(values.display.uiScale);
  if (!app.scene3d) return;
  // Cap device pixel ratio at 1.5 — the perf ceiling the scene is tuned for. A
  // 4K/retina panel at native DPR quadruples the pixel cost for no visible gain
  // at this art style. renderScale still lets the player trade sharpness for fps.
  //
  // ...BUT THE CAP MUST NOT SWALLOW A DELIBERATE REQUEST FOR MORE. On a 1.5-DPR
  // panel, `Math.min(1.5, 1.5 * renderScale)` returns 1.5 for renderScale 1.0
  // AND 1.15, so Ultra rendered exactly as many pixels as High. Measured
  // 2026-08-06 (tools/qa/electron-quality-presets.js): high→ultra separated by
  // -2.1%, +3.9% and +1.3% at the three fixed poses, all inside the run's own
  // 8.4% drift — a tier that cost nothing and gave nothing. The cap is a
  // DEFAULT ceiling, so it applies only while the player is at or below 100%.
  applyPixelRatioForViewport(values);
  // TOGGLING shadowMap.enabled REQUIRES RECOMPILING EVERY MATERIAL. Three bakes
  // the shadow sampler declarations into the shader, so a program compiled with
  // shadows on keeps sampling a map that is no longer being written. Measured in
  // Electron 2026-08-06 while A/Bing the quality presets: turning shadows off at
  // runtime produced a continuous stream of
  //   GL_INVALID_OPERATION: glDrawElements: Mismatch between texture format and
  //   sampler type (signed/unsigned/float/shadow)
  // — one per draw call, for as long as the setting stayed off. It has been
  // possible to reach this from the settings screen for as long as the toggle
  // has existed. Guarded on an actual change so moving any OTHER slider does not
  // pay for a full recompile.
  if (app.scene3d.renderer.shadowMap.enabled !== values.display.shadows) {
    // A4 (Goal 17) — THE COST IS REAL, THE LABEL IS NEW, AND THE EAGER REBUILD
    // WAS TRIED AND REVERTED.
    //
    // needsUpdate compiles nothing: three rebuilds each material at its NEXT
    // draw, so the bill used to arrive whenever the player happened to look at
    // something. Measured before A1 landed: switching to Ultra gave a 5197.5 ms
    // worst frame with the program count STILL changing 16.7 SECONDS after the
    // click, and switching to Low blocked so hard that not one animation frame
    // ran in the 600 ms after it.
    //
    // Then A1's load-time warm of the 701 hidden objects landed, and this got
    // most of the way better on its own: re-measured on the same driver, Ultra
    // now costs a 71-77 ms worst frame with NO program changes at all, and Low
    // costs 1586-1591 ms settling by 2.7-3.4 s.
    //
    // TRIED AND REVERTED: forcing the rebuild eagerly behind the label with
    // renderer.compile(). It measured WORSE than leaving three to its own
    // scheduling - Ultra 226-6224 ms against 71-77, Low 3368-6842 against
    // 1587-1591 - because compiling every visible material in one blocking
    // frame is more work than three does lazily once the hidden set is already
    // warm. Recorded so nobody spends the afternoon on it twice.
    //
    // What stays is the honest part the brief asked for: a label saying what is
    // happening, up while it happens, that does not take control away.
    showQualityApplying();
    app.scene3d.renderer.shadowMap.enabled = values.display.shadows;
    app.scene3d.scene.traverse((object) => {
      if (!object.material) return;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (material) material.needsUpdate = true;
      }
    });
  }
  // E2/A: the shadow tier is the biggest single lever on the number the player
  // feels. The map baked on foot and how often it is baked both come from here;
  // courseScene owns sun.shadow.mapSize and re-asserts it, so this is a request
  // rather than a write.
  const shadowLevel = SHADOW_QUALITY_LEVELS[values.display.shadowQuality]
    || SHADOW_QUALITY_LEVELS.medium;
  app.scene3d.setShadowQuality?.({
    walkMap: shadowLevel.walkMap,
    editorMap: shadowLevel.walkMap,
    fullMap: shadowLevel.fullMap,
    bakeMs: shadowLevel.bakeMs,
  });
  app.scene3d.resize();
  if (app.scene3d.post) {
    if (app.scene3d.post.gtao) app.scene3d.post.gtao.enabled = values.display.ambientOcclusion;
    if (app.scene3d.post.bloom) app.scene3d.post.bloom.enabled = values.display.bloom;
  }
  // E2/A: Low skips the composer entirely rather than running it with both
  // effects switched off — see the note on QUALITY_PRESETS.low.
  app.scene3d.setPostEnabled?.(values.display.postProcessing !== false);
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
    if (record.status === 'missing') return 'Empty - ready for a new save';
    if (record.status === 'corrupt') return 'Unreadable - saving here will preserve the damaged copy as a backup';
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
                meta.textContent = 'Save failed - your previous slot is still preserved. Check storage access and try another slot.';
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
      // D3 (Full_Goal_16): this page used to print HARDCODED key literals,
      // so a rebound key never appeared here. It renders from the live
      // bindings table now — built fresh each time the page shows, which is
      // the honest claim (no app reload, no stale caps). Rows the player
      // cannot rebind (mouse, Space, Esc) stay written out.
      const bindings = preferences.values.controls?.bindings || {};
      const cap = (actionId, fallback) => describeKey(
        keyForAction(bindings, actionId) || fallback || '',
      ) || (fallback || 'unbound');
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
            ['Walk', cap('moveForward', 'W'), cap('moveLeft', 'A'), cap('moveBack', 'S'), cap('moveRight', 'D')],
            ['Run', cap('run', 'Shift')], ['Look around', 'Mouse'],
            ['Capture the mouse', 'Click'], ['Overview camera (hands free)', cap('overview', 'Tab')],
          ]),
          group('Hands', [
            ['Interact · pick up · place', cap('interact', 'E')],
            ['Secondary action · reposition carton', cap('carry', 'X')],
            ['Tool belt: tap / hold', cap('toolBelt', 'F')],
            // V3 (Goal 19): this row said "Previous tool" against the DIRT
            // SENSE key — the stranger verifier caught the reference page
            // contradicting the HUD pill ("Q reveal dirt"). The label now
            // states the verb the binding actually performs.
            ['Dirt sense: hold to reveal', cap('dirtSense', 'Q')], ['Use selected tool', 'LMB'],
            ['Placement mode', cap('buildMode', 'B')], ['Rotate placement', cap('mowerBlades', 'R')],
            ['Cancel preview', 'Esc'],
          ]),
          group('Time & views', [
            ['Pause menu', cap('pause', 'P'), 'Esc'], ['Pause simulation clock', 'Space'],
            ['Course data view', cap('cartCamera', 'V')],
          ]),
          group('Management', [
            ['Course editor (hands free)', cap('courseEditor', 'J')],
            ['Grounds desk', cap('groundsPanel', 'G')], ['Club office', cap('clubPanel', 'C')],
            ['Empire overview', cap('empirePanel', 'M')],
            ['Maintenance tablet', cap('maintenancePanel', 'I')],
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
            toast(how ? 'Freed you up - back on solid ground.' : 'Nowhere clear to move you to.', how ? 'good' : 'warn');
          },
        }),
        // PHASE 8 (Goal 26): "The pause menu offers: Resume, RESTART THE CURRENT
        // DAY, Return to main menu, Quit -- with confirmation on the destructive
        // ones." The other three already existed; this is the one that did not.
        //
        // It restores the `daystart` snapshot, written once per rollover. The
        // button is created DISABLED and only enables once that snapshot is
        // confirmed present, because a restart that silently does nothing (or
        // worse, loads a save from some other moment) is a destructive action
        // failing quietly -- and on the very first day of a new game there is no
        // rollover behind you and so nothing to restart to.
        (() => {
          const restart = el('button', {
            class: 'pause-wide danger',
            text: t('pause.restartDay'),
            disabled: true,
            title: 'Checking for this morning’s snapshot...',
          });
          loadDataWithStatus(scopedKey('daystart'), { repair: false })
            .then((found) => {
              if (found.value == null) {
                restart.title = 'No snapshot from the start of this day yet - available from tomorrow.';
                return;
              }
              restart.disabled = false;
              restart.title = '';
              restart.onclick = () => confirmDialog({
                title: 'Restart the current day?',
                message: 'Go back to the start of today.',
                detail: 'Everything you have done since this morning is discarded. This cannot be undone.',
                confirmLabel: t('pause.restartDayConfirm'),
                danger: true,
                onConfirm: async () => {
                  const empire = await loadEmpireSave(scopedKey('daystart'), 'Start of day');
                  if (!empire) return false;
                  closePauseMenu({ resume: false });
                  bootEmpire(empire);
                  return true;
                },
              });
            })
            .catch(() => {
              restart.title = 'The start-of-day snapshot could not be read.';
            });
          return restart;
        })(),
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
              const result = await autosave('quit');
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
              const result = await autosave('quit');
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
// What was in hand when the belt key went down, so a hold can put it back after
// the keydown tap has already been applied (see beginToolKey).
let toolKeyToolAtPress = null;
let toolKeyCycled = false;
let previousWalkTool = null;
let walkToolWheelRemainder = 0;

// K3 (Goal 23) — THE TOOL WHEEL ADVERTISED KEYS THAT MEAN SOMETHING ELSE.
//
// The stranger found one instance: "the tool wheel says B is the push broom;
// B opens Build mode." Reading the table against src/core/keyBindings.js, ELEVEN
// OF TWELVE collided with a global binding, and two collided with each other:
//
//   washer W = move forward     vacuum V = cart camera    mop M = empire panel
//   broom  B = BUILD MODE       dustpan D = move right    spray S = move back
//   cloth  C = club panel       sponge G = grounds panel  trashbag T = phone
//   rake   R = mower blades     divot D = move right AND dustpan
//
// The letters only fire while the wheel is OPEN, so they worked — but the label
// promises a key that does something else everywhere else in the game, which is
// worse than no label. And divot/dustpan sharing D meant the divot kit could
// never be selected by letter at all, because toolShortcutIndex returns the
// first match: a dead control nobody had pressed.
//
// The wheel already handles 1-9 by POSITION. So the advertised key is now the
// position, which collides with nothing, is correct whichever set is showing
// (indoor and outdoor belts differ), and needs no second table to drift from
// the first. tests/tool-wheel-shortcuts.test.js holds the line.
function numberToolEntries(entries) {
  return entries.map((entry, index) => (index < 9
    ? { ...entry, shortcut: String(index + 1) }
    : { ...entry, shortcut: null }));
}

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
        available: inside && cleaningKitOwned,
        reason: !inside ? 'Use this inside the clubhouse' : 'Order the cleaning kit from the laptop',
        detail: def.equipToast,
      };
    });
  const handsFree = { id: null, label: 'Hands free', detail: 'Interact, carry, and inspect' };
  if (inside) return numberToolEntries([handsFree, ...indoorTools]);
  return numberToolEntries([
    handsFree,
    {
      id: 'washer', label: washer?.name || 'Pressure washer',
      available: true,
      detail: 'LMB washes · RMB applies soap',
    },
    { id: 'hose', label: 'Watering hose', detail: 'Raises live turf moisture' },
    { id: 'divot', label: 'Divot kit', detail: 'Repairs worn turf patches' },
    { id: 'rake', label: 'Bunker rake', detail: 'Smooths footprinted sand' },
  ]);
}

// Tools whose one-line lesson has already been given this session.
const toolLessonsShown = new Set();

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
  // K (Goal 23) — TOOL USE WAS TAUGHT ONLY BY FAILING.
  //
  // Every cleaning tool carries an `equipToast` in src/data/cleaningTools.js
  // saying exactly how to work it -- "sweep dirt and leaves into a pile, then
  // collect it with the dustpan". That text was referenced in ONE place in the
  // whole repository: as the `detail` line of a tool-wheel row. So the game had
  // written the lesson for every tool and only ever showed it inside a menu the
  // player may never open, never at the moment they actually pick the thing up.
  //
  // Said once per tool per session: a player cycling the belt with F should not
  // be lectured on every pass, and someone reaching for the mop for the first
  // time should not have to fail at it to find out what it does.
  if (tool && tool !== current) {
    const def = CLEANING_TOOLS[tool];
    if (def?.equipToast && !toolLessonsShown.has(tool)) {
      toolLessonsShown.add(tool);
      // The lesson text itself, not a new sentence built around it: a template
      // literal here is a NEW player-facing string, and the strings ratchet
      // caught it and was right to. The tool has just been equipped, so the
      // player knows which one it is.
      toast(def.equipToast);
    }
  }
  if (app.state) {
    tutorialFlag(app.state, 'toolSelected');
    if (tool === 'vacuum') triggerContextTutorial(app.state, 'cleaning-tools');
    else if (['washer', 'hose', 'divot', 'rake'].includes(tool)) triggerContextTutorial(app.state, 'maintenance-tools');
  }
  objectivesPanel?.refresh();
  hud?.update();
}

function cycleWalkTool(direction = 1) {
  // D3: your hands are full. The belt is refused rather than silently
  // swapping a tool into an arm that is already holding something.
  const carried = carriedThing();
  if (carried) {
    toast(carried === 'ledger'
      ? 'Put the book down first.'
      : 'Put that down first.', 'warn');
    return;
  }
  const entries = walkToolEntries().filter((entry) => entry.available !== false);
  if (!entries.length) return;
  const current = app.scene3d.walk.getTool();
  const index = entries.findIndex((entry) => entry.id === current);
  const start = index >= 0 ? index : 0;
  const step = direction < 0 ? -1 : 1;
  selectWalkTool(entries[(start + step + entries.length) % entries.length].id);
}

// Q is tap-to-swap / hold-to-reveal (see the keydown handler). 220 ms is the
// usual tap ceiling: comfortably longer than a deliberate press, comfortably
// shorter than the shortest useful glance at the dirt overlay.
const Q_TAP_MS = 220;
let qPressedAt = null;

function swapPreviousWalkTool() {
  const walk = app.scene3d?.walk;
  if (!walk || walk.cart?.mounted) return;
  const current = walk.getTool();
  const previous = previousWalkTool;
  if (previous === undefined || previous === current) return;
  previousWalkTool = current;
  selectWalkTool(previous);
}

// I — the maintenance tablet. makeCourseMaintenancePanel was imported from day
// one, but the call that creates the panel was lost, so this identifier never
// existed and the key threw a live ReferenceError straight into the fault veil
// (H1, 2026-08-05). Created lazily: a session that never presses I pays nothing.
function setMaintenanceVisible(visible) {
  if (!gameUi) return;
  if (!maintenancePanel) {
    maintenancePanel = makeCourseMaintenancePanel(app, {
      setVisible: (next) => setMaintenanceVisible(next),
      toggleInspection: () => {
        if (!app.state) return;
        toggleCourseInspection(app.state);
        maintenancePanel.refresh(true);
      },
      selectTool: (id) => {
        if (app.state) {
          const result = selectCourseMaintenanceEquipment(app.state, id);
          if (result && result.ok === false) {
            toast(result.reason, 'warn');
            return;
          }
        }
        selectWalkTool(id);
        maintenancePanel.refresh(true);
      },
    });
    gameUi.append(maintenancePanel.root);
  }
  maintenancePanel.setVisible(!!visible);
  // The tablet has buttons; give the cursor back while it is up.
  if (maintenancePanel.isVisible() && document.pointerLockElement) document.exitPointerLock();
}

function showToolWheel() {
  if (!walkActive() || regActive() || app.laptopOpen || buildApi()?.isActive() || isPauseOpen()) return;
  // D3: the wheel is the other half of the belt. Guarding only the tap-to-cycle
  // path would leave hold-to-open working, and a player who can SEE the wheel
  // with a book in their arms has been told the belt is available.
  const carried = carriedThing();
  if (carried) {
    toast(carried === 'ledger' ? 'Put the book down first.' : 'Put that down first.', 'warn');
    return;
  }
  resetCameraInput();
  app.scene3d.walk.setSpraying(false);
  app.scene3d.walk.setSoaping?.(false);
  audio.setToolLoop(null);
  if (document.pointerLockElement) document.exitPointerLock();
  triggerContextTutorial(app.state, 'tool-wheel');
  objectivesPanel.refresh();
  toolWheel.show(walkToolEntries(), app.scene3d.walk.getTool());
}

// THE BELT CYCLES ON KEY DOWN. IT USED TO CYCLE ON KEY UP.
//
// Measured 2026-08-19 with tools/qa/tool-swap-input-to-pixel.js -- the first
// instrument in this repo to press an actual key rather than call
// `walk.setTool()`. On a warm belt, a live scene and a 90 ms press:
//
//   input to pixel, real key press   p50 122.1 ms   (nine of nine, 108-128)
//   the same swap through the API     28.1 ms
//   frame intervals over that run     p50 5.6, p95 16.5, p99 21.8 ms
//
// The renderer was never the problem. 94 of those 122 ms were spent waiting for
// the player to LET GO, because `cycleWalkTool()` hung off endToolKey and
// endToolKey runs on key up. Every tool swap therefore cost the player the
// duration of their own finger before anything began, and no frame-time probe
// could ever see it -- the frames in that window are 5 ms and perfectly healthy.
// That is the "every tool swap has noticeable latency" the owner reported after
// playing, against a harness that answered 4.2 ms.
//
// It also swallowed presses outright: endToolKey only cycled when the press had
// lasted under 500 ms, so any block longer than half a second (and boot blocks
// here reach seconds) turned a normal tap into a discarded one. A run with an
// 8,142 ms stall in it lost seven presses in a row.
//
// The tap/hold split survives intact. The tap is applied at once; if the key is
// still down at the hold threshold the wheel opens and the tool equipped at
// keydown is put back, so a hold ends exactly where it began. THE COST of that
// arrangement, stated rather than discovered later: a player who HOLDS the belt
// key sees the next tool in hand for the 230 ms before the wheel appears. Taps
// outnumber holds by a wide margin and a tap is the gesture that felt broken,
// so the flash is the right side of the trade -- but it is a real artifact.
function beginToolKey(event) {
  if (event.repeat || toolKeyTimer || toolWheel?.isOpen()) return;
  toolKeyToolAtPress = app.scene3d?.walk?.getTool?.() ?? null;
  toolKeyCycled = false;
  if (walkActive()) {
    cycleWalkTool();
    toolKeyCycled = true;
  }
  toolKeyTimer = setTimeout(() => {
    toolKeyTimer = null;
    // Hold: undo the tap that has already been applied, then open the wheel.
    if (toolKeyCycled) {
      selectWalkTool(toolKeyToolAtPress);
      toolKeyCycled = false;
    }
    showToolWheel();
  }, 230);
}

function endToolKey() {
  if (toolKeyTimer) {
    clearTimeout(toolKeyTimer);
    toolKeyTimer = null;
  }
  toolKeyCycled = false;
}

function cancelToolKey() {
  if (toolKeyTimer) clearTimeout(toolKeyTimer);
  toolKeyTimer = null;
  toolKeyCycled = false;
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
  //
  // ...nor while the tuning overlay is up (Goal 17 R1). The panel needs the
  // cursor to drag a slider; a left click that silently re-locks the pointer
  // turns every drag into a camera pan. RIGHT mouse still looks around, which
  // is the panel's own documented gesture.
  if (regActive() || editorActive() || toolWheel?.isOpen() || isPauseOpen()
    || toolTuner?.isOpen()) return;
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
      toolPressStartedAt = performance.now(); // Verifier 3 finding 1: tap vs hold
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

// VERIFIER 3, FINDING 1 — SILENCE ON A WRONG INPUT IS THE FAILURE.
//
// A stranger spent fifteen minutes on the porch. The door asked them to wash it,
// they had the washer in hand, they clicked it five times and NOTHING happened:
// no water, no refusal, no hint. The tool is correct and their input was
// correct-but-too-short — a held button is the use trigger, and a tap sets
// spraying on and off inside a frame, which produces exactly nothing.
//
// A player who taps is not doing something forbidden, they are doing something
// incomplete, and the game had no way to say so. It does now, once per tool per
// session, so it teaches without nagging the player who already knows.
const TAP_HINT_MS = 260;
// X2: how long a tapped trigger sprays. Long enough to see the jet and hear it,
// short enough that it reads as a squeeze rather than a stuck button.
const TAP_BURST_MS = 260;
let tapBurstTimer = null;
let toolPressStartedAt = 0;
const tappedToolsHinted = new Set();

window.addEventListener('pointerup', (e) => {
  if (regActive()) { regApi().onUp(e); return; }
  const heldFor = toolPressStartedAt ? performance.now() - toolPressStartedAt : Infinity;
  const tool = walkActive() && app.scene3d.walk.getTool && app.scene3d.walk.getTool();
  toolPressStartedAt = 0;
  if (preferences.values.accessibility.toolActivation === 'hold') stopToolUse();
  if (tool && heldFor < TAP_HINT_MS
    && preferences.values.accessibility.toolActivation === 'hold') {
    // X2 (Goal 21) — A TAP IS A SHORT SQUEEZE OF THE TRIGGER, NOT A NO-OP.
    //
    // The stranger verifier tapped the pressure washer five times on the porch
    // and got nothing: no water, no sound, no number moving. Goal 20 added a
    // hint, which fires and which they quoted back, and a hint is still an
    // apology for a dead control. A real trigger gives a real short burst.
    //
    // This routes through the SAME spray path a hold uses, so the jet, the
    // sound and the actual cleaning progress are the genuine ones rather than a
    // cosmetic puff. A short burst that cleans a little is honest: it is what
    // the tool would do.
    app.scene3d.walk.setSpraying(true);
    if (audio.ready) audio.setToolLoop(tool);
    if (tapBurstTimer) clearTimeout(tapBurstTimer);
    tapBurstTimer = setTimeout(() => {
      tapBurstTimer = null;
      stopToolUse();
    }, TAP_BURST_MS);
    // ...and the hint still teaches the better gesture, once per tool.
    if (!tappedToolsHinted.has(tool)) {
      tappedToolsHinted.add(tool);
      toast(t('hud.holdToUseTool'));
    }
  }
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
    if (boundAction(e) === 'pause' || e.key === 'Escape') {
      e.preventDefault();
      closePauseMenu();
    }
    return;
  }
  if (boundAction(e) === 'pause') {
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
    case 'F9':
      // B2: the live mop/broom tuning overlay. Dev-facing; the sim keeps
      // running and the held tool stays drawn while the panel is up.
      e.preventDefault();
      toolTuner?.toggle();
      return;
  }
  // A3: the speed ladder above 1x is deleted — Space is the only time
  // control (pause/resume). The old bound 1/2/3 actions are gone from the
  // bindings table; rebinds stored for them normalize away on load.

  // Tab must never reach DOM focus in-game, whatever it is bound to
  if (e.key === 'Tab') e.preventDefault();
  if (boundAction(e) === 'overview') {
    e.preventDefault();
    // GOAL 31, the Tab flake: this toggle had no repeat guard, so holding the
    // key a beat past Windows' ~400 ms repeat delay fired keydown again and
    // toggled BACK — a firm press read as "nothing happened", and the owner's
    // "~3 s before I can move" was him retrying around it. One toggle per
    // physical press: auto-repeat is never a second press.
    if (e.repeat) return;
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
      // the carried carton follows the bound interact key; its rotate stays
      // on the blades/rotate key family, Escape and B stay literal
      const placementAction = boundAction(e);
      if (placementAction === 'interact') {
        e.preventDefault();
        if (e.repeat) return;
        if (placement.isActive()) placement.commit();
        else placement.activate();
        return;
      }
      if (placementAction === 'mowerBlades') {
        e.preventDefault();
        if (e.repeat) return;
        if (!placement.isActive()) placement.activate();
        placement.rotate();
        return;
      }
      // ITEM 23: the build key is BOUND here too. Escape stays literal because
      // keyBindings reserves it.
      if (placementAction === 'buildMode') {
        toast(t('hud.setDownOrRecycle16'), 'warn');
        return;
      }
      if (e.key === 'Escape' && placement.isActive()) {
        e.preventDefault();
        placement.cancel();
        return;
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
          toast(t('hud.backToWork'));
        }
        return;
      }
      // ITEM 23: build mode's own keys. The two that duplicate a MAIN binding
      // are routed through it - the inventory key is the maintenance-panel
      // binding and the exit key is the build-mode binding, so rebinding either
      // moves both places at once. The rest (rotate, stow, undo, arrows) are
      // build-mode-only verbs with no row on the rebinding screen; they are
      // recorded in the report as the remaining literal set rather than
      // invented bindings nobody asked for.
      const buildAction = boundAction(e);
      if (buildAction === 'maintenancePanel') {
        e.preventDefault();
        if (!e.repeat) bld.toggleInventory();
        return;
      }
      if (buildAction === 'buildMode') {
        e.preventDefault();
        bld.exit();
        toast(t('hud.backToWork'));
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
        case 'Escape':
          e.preventDefault();
          if (bld.isInventoryOpen() || bld.isCarrying()) bld.cancel();
          else bld.exit();
          return;
        default: break; // WASD still walks: you carry the fixture with you
      }
    }

    // first-person course: the BOUND interact key is the interaction verb (shop
    // convention). N2/F2: every rebindable verb dispatches on its ACTION,
    // resolved through the one binding table; mode-scoped keys (B build, I
    // maintenance, panel toggles, Escape) stay literal below. The repeat flag
    // matters: cutting tape and stocking a shelf are HOLD verbs driven
    // per-frame, and a tap verb must not fire thirty times a second just
    // because the key is down.
    switch (boundAction(e)) {
      case 'interact':
        if (app.scene3d.walk.interact) app.scene3d.walk.interact(e.repeat);
        return;
      case 'carry':
        if (app.scene3d.walk.interactSecondary) app.scene3d.walk.interactSecondary(e.repeat);
        return;
      // SET DOWN releases what you are holding — the inverse of carry.
      // Reported 2026-07-29: "Add a button to put a held item down." A carton prompt already
      // said "put down what you're holding first" and no key did it.
      //
      // The carton lands one pace ahead of the player rather than underfoot, so it does not
      // materialise inside the body and immediately shove them.
      case 'setDown': {
        if (e.repeat) return;
        e.preventDefault();
        // D2 (Goal 17) — THE BOOK GETS THE SAME VERB AS EVERY OTHER CARRYABLE.
        //
        // "There is no way to put the book down. Add one. The same verb as
        // every other carryable thing." The verb already exists and the HUD
        // already teaches it - "Z set down" - it simply only ever asked the
        // carton system. One extra branch, deliberately BEFORE the carton
        // branch, and the book answers the key the player has already been
        // taught.
        if (carriedThing() === 'ledger') {
          putDownCarried();
          toast(t('hud.bookSetDown'));
          return;
        }
        const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
        if (!ch?.setDownCarried) return;
        const w = app.scene3d.walk.state;
        const ahead = 0.85;
        const result = ch.setDownCarried(
          w.x - Math.sin(w.yaw) * ahead,
          w.z - Math.cos(w.yaw) * ahead,
          w.yaw,
        );
        if (result?.ok) {
          if (result.message) toast(result.message);
        } else if (result?.reason) {
          toast(result.reason, 'warn');
        }
        return;
      }
      case 'courseEditor': // the drafting table: open the course editor from your feet
        enterEditor();
        return;
      case 'phone': // A1: the pocket phone — up and away on the same key
        if (e.repeat) return;
        e.preventDefault();
        phoneUi?.toggle();
        return;
      // G1 (Goal 24): the ledger opens from anywhere in the clubhouse. Asked for
      // in Goal 22 and in Goal 23; `enterLedger()` existed both times and no key
      // pointed at it, so the only way in was to walk to the desk and aim at the
      // cover. Same key closes it, like the phone.
      case 'ledger':
        if (e.repeat) return;
        e.preventDefault();
        if (app.ledgerOpen) exitLedger();
        else enterLedger();
        return;
      case 'mowerBlades': {
        const bladeResult = app.scene3d.walk.toggleBlades?.();
        if (bladeResult?.handled) {
          toast(bladeResult.enabled ? `${bladeResult.label} blades engaged.` : `${bladeResult.label} blades disengaged.`);
          if (audio.ready) audio.setToolLoop(bladeResult.enabled ? 'mower' : null);
          if (maintenancePanel) maintenancePanel.refresh(true);
          return;
        }
        // at the register in Realistic mode, this key hands over the counted change
        const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
        if (ch && ch.confirmChange) ch.confirmChange();
        return;
      }
      case 'cartLights': {
        if (e.repeat) return;
        const lightResult = app.scene3d.walk.toggleLights?.();
        if (lightResult?.handled) {
          e.preventDefault();
          toast(lightResult.enabled ? `${lightResult.label} on.` : `${lightResult.label} off.`);
        }
        return;
      }
      case 'toolBelt': {
        if (!app.scene3d.walk.cart.mounted) beginToolKey(e);
        return;
      }
      case 'dirtSense': {
        // THE DIRT-SENSE KEY CARRIES TWO VERBS: TAP SWAPS, HOLD REVEALS.
        //
        // D3: this used to swap on keydown, while courseScene's dirt sense
        // reads the same key HELD. So every time a player did the thing the HUD
        // tells them to do — "reveal dirt" — their tool silently changed to
        // the previous one, and the reveal they were looking at was then
        // filtered for a tool they were no longer holding. Caught by a driver
        // that measured the tool before and during the hold and got different
        // answers.
        //
        // Deferring the swap to key-up, and only for a press short enough to be
        // a tap, keeps both verbs on the advertised key and makes them
        // unambiguous. Holding no longer swaps anything. Rebinding moves the
        // KEY; this tap/hold split rides with the action.
        e.preventDefault();
        if (!e.repeat) qPressedAt = performance.now();
        return;
      }
      case 'cartCamera': {
        if (e.repeat) return;
        const cameraResult = app.scene3d.walk.toggleVehicleCamera?.();
        if (cameraResult?.handled) {
          e.preventDefault();
          toast(cameraResult.mode === 'driver' ? 'Driver camera.' : 'Chase camera.');
          return;
        }
        // on foot the same key cycles the turf view, as it always has
        const modes = ['normal', 'health', 'moisture'];
        handlers.setViewMode(modes[(modes.indexOf(app.viewMode) + 1) % modes.length]);
        return;
      }
      // ITEM 23: build mode and the four panel toggles now live HERE, in the
      // bound-action switch, instead of as literal `case 'b'` arms in the
      // switch below. They were the eight verbs the rebinding screen offered
      // no row for, and two of them were written out twice - once for inside
      // the clubhouse and once for outside - so the same key had to be changed
      // in two places and neither was reachable from settings.
      case 'buildMode': {
        const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
        const w = app.scene3d.walk.state;
        if (!ch || !ch.isInside(w.x, w.z)) {
          toast(t('hud.rearrangingIsForIndoors'), 'warn');
          break;
        }
        ch.build.enter();
        triggerContextTutorial(app.state, 'placement');
        objectivesPanel.refresh();
        break;
      }
      case 'maintenancePanel':
        setMaintenanceVisible(!maintenancePanel?.isVisible());
        break;
      case 'groundsPanel':
        if (document.pointerLockElement) document.exitPointerLock(); // free the cursor for the panel
        handlers.toggleGrounds();
        break;
      case 'clubPanel':
        if (document.pointerLockElement) document.exitPointerLock();
        handlers.toggleClub();
        break;
      case 'empirePanel':
        if (document.pointerLockElement) document.exitPointerLock();
        handlers.toggleEmpire();
        break;
      default: break;
    }
    // ESCAPE STAYS LITERAL, and must: keyBindings reserves it precisely so the
    // pause-menu escape hatch can never be rebound away. boundAction returns
    // null for it, so it cannot live in the switch above.
    if (e.key === 'Escape') {
      e.preventDefault();
      if (app.selectedSection) inspectPanel.hide();
      else if (app.groundsOpen || app.clubOpen || app.empireOpen) closeLeftPanels('none');
      else {
        stopToolUse();
        if (document.pointerLockElement) document.exitPointerLock();
        openPauseMenu();
      }
    }
    return;
  }

  // the overview map: the bound interact/editor keys open the editor, the
  // bound camera key cycles the turf view; panel toggles stay literal
  const overviewAction = boundAction(e);
  if (overviewAction === 'interact' || overviewAction === 'courseEditor') {
    // F1 (Full_Goal_16): E at an OPEN station must never fall through to the
    // drafting table — the register/ledger/laptop/front-desk own the screen.
    // The editor still opens from the overview proper, and always on its own
    // bound key.
    if (overviewAction === 'interact'
      && (regActive() || app.ledgerOpen || app.laptopOpen || app.frontDeskOpen)) return;
    enterEditor();
    return;
  }
  if (overviewAction === 'cartCamera') {
    const modes = ['normal', 'health', 'moisture'];
    handlers.setViewMode(modes[(modes.indexOf(app.viewMode) + 1) % modes.length]);
    return;
  }
  // ITEM 23: the overview map's panel toggles were a SECOND literal copy of
  // the same three keys, so rebinding had to be done twice and could be done
  // in neither. One binding, one place.
  switch (overviewAction) {
    case 'groundsPanel':
      handlers.toggleGrounds();
      break;
    case 'clubPanel':
      handlers.toggleClub();
      break;
    case 'empirePanel':
      handlers.toggleEmpire();
      break;
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
  const releasedAction = boundAction(e);
  if (releasedAction === 'toolBelt') endToolKey();
  if (releasedAction === 'dirtSense') {
    // A tap is a tool swap; anything longer was a dirt-sense hold and must not
    // change what is in your hands. See the keydown case for why.
    const heldMs = qPressedAt == null ? Infinity : performance.now() - qPressedAt;
    qPressedAt = null;
    if (heldMs <= Q_TAP_MS) swapPreviousWalkTool();
  }
});
window.addEventListener('blur', () => {
  if (toolKeyTimer) clearTimeout(toolKeyTimer);
  toolKeyTimer = null;
  toolKeyCycled = false;
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

function resetStartupInputLatches() {
  qPressedAt = null;
  toolPressStartedAt = 0;
  handledPlacementPointer = false;
  walkToolWheelRemainder = 0;
  if (toolKeyTimer) clearTimeout(toolKeyTimer);
  toolKeyTimer = null;
  toolKeyCycled = false;
  if (tapBurstTimer) clearTimeout(tapBurstTimer);
  tapBurstTimer = null;
  stopToolUse();
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

// E6 — THE CONTROL HINT MUST SHOW THE PLAYER'S OWN KEYS.
//
// Both copies of the lock hint were literal strings: "WASD move · E interact ·
// X carry · Z set down · tap/hold F tools · J course editor · Tab overview · P
// pause". Rebind anything and the line under the crosshair goes on teaching the
// defaults - which is worse than no hint, because it is a wrong one the player
// has no reason to distrust. Built from the same binding table every key read
// resolves through, so it cannot drift.
function walkControlHintText() {
  const bindings = preferences.values.controls?.bindings || {};
  const k = (id, fallback) => {
    const key = keyForAction(bindings, id);
    return key ? describeKey(key) : fallback;
  };
  const move = [k('moveForward', 'W'), k('moveLeft', 'A'), k('moveBack', 'S'), k('moveRight', 'D')];
  // WASD reads as one word when it IS WASD, and as four keys when it is not
  const moveLabel = move.join('').toUpperCase() === 'WASD' ? 'WASD' : move.join('/');
  return [
    'Click to look',
    `${moveLabel} move`,
    `${k('run', 'Shift')} run`,
    `${k('interact', 'E')} interact`,
    `${k('carry', 'X')} carry`,
    `${k('setDown', 'Z')} set down`,
    `tap/hold ${k('toolBelt', 'F')} tools`,
    `${k('phone', 'T')} phone`,
    `${k('courseEditor', 'J')} course editor`,
    `${k('overview', 'Tab')} overview`,
    `${k('pause', 'P')} pause`,
  ].join(' · ');
}

// Goal 24: own every production-frame request in one lexical scheduler. These
// counters begin before the first request and have no reset/mutation hook, so a
// checkpoint can prove the loop had exactly one root start and never had more
// than one production callback queued. The getter returns a fresh snapshot;
// tooling cannot start, stop, or otherwise drive the loop through it.
const PRODUCTION_FRAME_LOOP_OWNER = 'golf-flipper/src/main.js:production-frame-loop:v1';
const productionFrameLoopState = {
  rootStartCount: 0,
  scheduleCount: 0,
  callbackCount: 0,
  pendingCallbackCount: 0,
  maximumPendingCallbackCount: 0,
  schedulingFailureCount: 0,
  pendingUnderflowCount: 0,
  firstRootStartAtMs: null,
  lastCallbackAtMs: null,
};

function productionFrameLoopDiagnostics() {
  const state = productionFrameLoopState;
  const accountingConsistent = state.scheduleCount - state.callbackCount
    === state.pendingCallbackCount;
  const singleRootStart = state.rootStartCount === 1;
  const atMostOnePendingCallback = state.maximumPendingCallbackCount === 1
    && state.pendingCallbackCount <= 1;
  const oneCallbackCurrentlyPending = state.pendingCallbackCount === 1;
  const noSchedulerFaults = state.schedulingFailureCount === 0
    && state.pendingUnderflowCount === 0;
  return {
    schemaVersion: 1,
    ownerToken: PRODUCTION_FRAME_LOOP_OWNER,
    rootStartCount: state.rootStartCount,
    scheduleCount: state.scheduleCount,
    callbackCount: state.callbackCount,
    pendingCallbackCount: state.pendingCallbackCount,
    maximumPendingCallbackCount: state.maximumPendingCallbackCount,
    schedulingFailureCount: state.schedulingFailureCount,
    pendingUnderflowCount: state.pendingUnderflowCount,
    firstRootStartAtMs: state.firstRootStartAtMs,
    lastCallbackAtMs: state.lastCallbackAtMs,
    accountingConsistent,
    singleRootStart,
    atMostOnePendingCallback,
    oneCallbackCurrentlyPending,
    invariantHolds: singleRootStart
      && atMostOnePendingCallback
      && oneCallbackCurrentlyPending
      && accountingConsistent
      && noSchedulerFaults,
  };
}

function runProductionFrame(timestamp) {
  const state = productionFrameLoopState;
  if (state.pendingCallbackCount === 0) state.pendingUnderflowCount += 1;
  else state.pendingCallbackCount -= 1;
  state.callbackCount += 1;
  state.lastCallbackAtMs = timestamp;
  frame(timestamp);
}

function scheduleProductionFrame() {
  const state = productionFrameLoopState;
  try {
    const callbackId = requestAnimationFrame(runProductionFrame);
    state.scheduleCount += 1;
    state.pendingCallbackCount += 1;
    state.maximumPendingCallbackCount = Math.max(
      state.maximumPendingCallbackCount,
      state.pendingCallbackCount,
    );
    return callbackId;
  } catch (error) {
    state.schedulingFailureCount += 1;
    throw error;
  }
}

function startProductionFrameLoop() {
  const state = productionFrameLoopState;
  state.rootStartCount += 1;
  if (state.firstRootStartAtMs == null) state.firstRootStartAtMs = performance.now();
  return scheduleProductionFrame();
}

Object.defineProperty(app, 'frameLoopDiagnostics', {
  value: productionFrameLoopDiagnostics,
  enumerable: true,
  configurable: false,
  writable: false,
});

function frame(ts) {
  // A1 (Goal 18/23) — the framerate cap. A skipped tick returns before any sim
  // or render work, so the whole frame's CPU is saved and not just the draw.
  // WHICH ticks are skipped is decided by counting vsyncs rather than comparing
  // wall time: on a 181.8 Hz panel the old interval compare achieved 97 fps
  // at a cap of 120 with 0.2% of intervals on cadence — a 5.5/11 ms sawtooth
  // that averages right and feels wrong.
  if (!frameCap.shouldRender(ts)) {
    scheduleProductionFrame();
    return;
  }
  const dtMs = Math.min(250, ts - lastTs || 16);
  lastTs = ts;

  // Prewarm owns the renderer while the opaque veil is up. More importantly,
  // the startup capability owns every state boundary: no clock, deliveries,
  // tutorial, walk input, audio cadence, or autosave clock may advance until the
  // still-current scene has completed prewarm successfully.
  if (startupHold.isPending()) {
    scheduleProductionFrame();
    return;
  }

  if (app.screen === 'game' && app.state && app.scene3d) {
    keyboardCamera(dtMs);
    const speed = BALANCE.speeds[app.speedIdx];
    // SIM-TIME-001. The clubhouse loop is handed raw wall dt, so it has no way
    // to know the day is running 16x faster unless it is told. Pushed every
    // frame rather than on the speed control, because pause/resume, the editor,
    // the pause menu and the golf-day presentation all move speedIdx from
    // different places and any one of them forgetting would put the shop back
    // where it was.
    // TWO multipliers, and they are not the same number.
    //
    // DECISIONS scale with the ratio of game time to wall time against the rate
    // the NPC timings were authored at — the speed rung AND the day's length.
    // Using the rung alone was a latent bug: shortening the day would speed the
    // clock and leave shoppers wall-bound, SIM-TIME-001 by the other door.
    //
    // LOCOMOTION scales with the RUNG ONLY. Day length must never reach it. When
    // it did (2026-07-29, day 12h→3h) every shopper sprinted at the 4x cap on the
    // default rung, because a compression of 4 was being read as a walk speed of
    // 4. Walking is a look; the player asking for fast-forward is the only thing
    // entitled to change it.
    // The arithmetic lives in balance.js so a test can drive it with a doctored
    // day length and prove locomotion does not move. Doing it inline here is how
    // the two numbers got conflated in the first place.
    const simMult = simSpeedMultipliers(app.speedIdx);
    app.scene3d.clubhouse?.()?.setSimSpeed?.(simMult.decision, simMult.locomotion);
    // The golfers' pace pricing (sim/golfDay routeDuration) needs the live
    // rung; golfDay ticks receive minutes only, so it rides the state.
    if (app.state.golfDay) app.state.golfDay.speedRung = BALANCE.speeds[app.speedIdx] || 1;
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
        // H2: a day boundary is a natural save point, whatever moved the clock.
        // Watching daysPassed rather than any particular code path means sleep
        // skips and multi-day batches save exactly once per crossing too.
        autosave('rollover');
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
          toast(`📦 ${name} has dispatched - ${deliveryEtaText(ev.order, app.state.clock.minutes)}. ${boxes}, ${man ? `${man.weight} lb` : ''}.`);
        } else if (ev.kind === 'soon') {
          toast(`📦 The ${ev.order.supplier || name} van is close - ${deliveryEtaText(ev.order, app.state.clock.minutes)}.`);
        } else if (ev.kind === 'arrived') {
          toast(`📦 Delivery inbound! ${name} ×${ev.order.qty} - the van is turning into receiving with ${boxes}.`);
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
          toast(`🚫 The van could not unload - the receiving pad is full. ${name} ×${ev.order.qty} is still on board. Carry some cartons inside.`, 'warn');
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
          for (const step of tut.advanced) toast(`🎯 ${step.title} - done.`);
        }
        if (tut.advanced.length) {
          if (app.state.tutorial.complete && !app.state.tutorial.hidden) {
            toast(t('hud.theGuideRetiresThe'), '');
          }
          objectivesPanel.refresh(tut.view);
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
    updatePhoneRing(ts); // D3: the desk phone rings through the frame loop
    phoneUi?.update(); // A1: badge, incoming-call face, status clock
  }
  // Weld the interface to the glass. Every frame, unconditionally, for as long as the lid is
  // open — through the camera's ease into the seat, through the lid's swing, through a window
  // resize. A transform that is never cached is a transform that can never go stale.
  if (app.laptopOpen) alignLaptopUi();
  scheduleProductionFrame();
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
    case 'card-busy': return 'Authorising card - please wait';
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
    // GOAL 25 legibility — the behind-the-till hint carried the same silence as
    // the register screen: it named the gesture and not the reason. Nothing is
    // banked until the bag is in their hand.
    case 'done': return 'Drag the bag to the customer’s palm - the sale banks when they take it';
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
const ovEl = { prompt: null, lockHint: null, cond: null, propertyInventory: null, queueNote: null };
const ovLast = {
  prompt: null, opacity: null, lockDisp: null, lockText: null,
  condText: null, condVisible: null, propertyInventoryText: null, propertyInventoryDisplay: null,
  queueNoteText: null, queueNoteVisible: null,
};
let condClock = 0;

function shopConditionLabel(state, score = null) {
  if (!state?.shop) return '🧹 Shop condition -';
  const condition = Number.isFinite(score) ? score : shopCondition(state);
  return `🧹 Shop condition ${condition} - ${CONDITION_WORD(condition)}`;
}

function primeWalkConditionForState(state) {
  if (!walkCondition) return;
  const conditionText = shopConditionLabel(state);
  if (conditionText === ovLast.condText) return;
  ovLast.condText = conditionText;
  setPromptText(walkCondition, conditionText);
}

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
    ovEl.dirtSense = walkOverlay.querySelector('.dirt-sense-hint');
    ovEl.dirtReticle = walkOverlay.querySelector('.dirt-reticle');
    ovEl.queueNote = walkOverlay.querySelector('.shop-queue-note');
  }
  if (ovEl.dirtReticle) {
    const aimed = app.scene3d.walk.dirtSense ? app.scene3d.walk.dirtSense().aimed : null;
    // J2: the reticle names the MEDIUM from the legend authority, so what you
    // aim at, the marker colour and the HUD chips all say the same thing.
    const reticleText = aimed
      ? (aimed.kind === 'litter'
        ? 'Litter - sweep or bag it'
        : `${MEDIUM_STYLE[MEDIUM.DEBRIS].label} - ${MEDIUM_STYLE[MEDIUM.DEBRIS].verb}`)
      : '';
    if (reticleText !== ovLast.dirtReticleText) {
      ovLast.dirtReticleText = reticleText;
      ovEl.dirtReticle.textContent = reticleText;
      ovEl.dirtReticle.style.display = reticleText ? 'block' : 'none';
    }
  }
  // The dirt-sense affordance: offered only when there is dirt left to find,
  // and lit while the key is actually down.
  if (ovEl.dirtSense) {
    const sense = app.scene3d.walk.dirtSense ? app.scene3d.walk.dirtSense() : null;
    const clusters = sense?.overlay?.clusters || 0;
    // F2: and the affordance goes with it. Offering "[Q] reveal dirt" while a
    // panel is up advertises a key that does nothing.
    const stationUp = app.laptopOpen || app.ledgerOpen || app.frontDeskOpen || regActive();
    const senseDisplay = clusters > 0 && document.pointerLockElement && !stationUp ? 'flex' : 'none';
    if (senseDisplay !== ovLast.senseDisplay) {
      ovLast.senseDisplay = senseDisplay;
      ovEl.dirtSense.style.display = senseDisplay;
    }
    const senseOn = !!sense && sense.alpha > 0.02;
    if (senseOn !== ovLast.senseOn) {
      ovLast.senseOn = senseOn;
      ovEl.dirtSense.classList.toggle('is-on', senseOn);
    }
    // J2: THE LEGEND, literally. While the reveal is up, the hint shows which
    // media the held tool can shift as coloured chips — the same colours the
    // markers use, from the same authority. No tool = both media (the bare
    // reveal shows everything). One DOM write per change of tool/state.
    const senseTool = app.scene3d.walk.getTool ? app.scene3d.walk.getTool() : null;
    const senseMedia = senseOn
      ? (CLEANING_TOOLS[senseTool] ? toolMedia(senseTool) : [MEDIUM.DEBRIS, MEDIUM.GRIME])
      : [];
    const senseMediaKey = senseMedia.join(',');
    if (senseMediaKey !== ovLast.senseMediaKey) {
      ovLast.senseMediaKey = senseMediaKey;
      let chips = ovEl.dirtSense.querySelector('.dirt-sense-media');
      if (!chips) {
        chips = el('span', { class: 'dirt-sense-media' });
        ovEl.dirtSense.append(chips);
      }
      chips.replaceChildren(...senseMedia.map((medium) => el('span', { class: 'dirt-medium-chip' },
        el('span', {
          class: 'dirt-medium-dot',
          style: `background:#${MEDIUM_STYLE[medium].color.toString(16).padStart(6, '0')}`,
        }),
        el('span', { text: MEDIUM_STYLE[medium].label }))));
    }
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
  const promptVisible = !!(label && document.pointerLockElement);
  const opacity = promptVisible ? '1' : '0.004';
  if (opacity !== ovLast.opacity) {
    ovLast.opacity = opacity;
    ovEl.prompt.style.opacity = opacity;
    ovEl.prompt.setAttribute('aria-hidden', promptVisible ? 'false' : 'true');
  }
  if (label?.includes('check in')) {
    frontDeskLessonSeen = true;
    triggerContextTutorial(app.state, 'front-desk');
    objectivesPanel.refresh();
  } else if (frontDeskLessonSeen && label?.startsWith('Register - yesterday')) {
    tutorialFlag(app.state, 'frontDeskCheckedIn');
    frontDeskLessonSeen = false;
  }
  // the control bar retires once the controls are demonstrably learned
  // (opening arc past the shelving step) — after that it only returns while
  // the pointer is free, as a click-to-play reminder
  const tut = app.state && app.state.tutorial;
  const learned = tut && (tut.complete || tut.hidden || tut.step >= 5);
  // K (Goal 23): the overview is NOT silent -- it raises its own `.hint-bar`
  // with a full legend ("drag to pan, right-drag to rotate, wheel to zoom, Tab
  // returns on foot"). I extended this gate to cover it before checking, and
  // the change was dead: the walk overlay is hidden in overview, so the hint it
  // controls cannot be seen there anyway. Reverted rather than shipped.
  const showLockHint = ['walk', 'placement'].includes(mode) && !document.pointerLockElement;
  const lockDisp = showLockHint ? '' : 'none';
  if (lockDisp !== ovLast.lockDisp) {
    ovLast.lockDisp = lockDisp;
    ovEl.lockHint.style.display = lockDisp;
  }
  // E6: THIS is the copy the player actually reads — the two built at
  // construction are only the initial text. All three were literal, so a
  // rebound key was taught wrong under the crosshair on every frame.
  const bind = preferences.values.controls?.bindings || {};
  const bk = (id, fallback) => {
    const key = keyForAction(bind, id);
    return key ? describeKey(key) : fallback;
  };
  const lockText = learned
    ? (placement?.hasCarriedBox()
      ? `Click to resume · Carrying carton: ${bk('interact', 'E')} place · R rotate · ${bk('setDown', 'Z')} set down · Esc keep carrying`
      : 'Click to resume looking')
    : (placement?.hasCarriedBox()
      ? `Click to look around · ${bk('moveForward', 'W')}${bk('moveLeft', 'A')}${bk('moveBack', 'S')}${bk('moveRight', 'D')} walk · ${bk('interact', 'E')} place · R rotate · ${bk('setDown', 'Z')} set down · Esc keep carrying`
      : walkControlHintText());
  if (lockText !== ovLast.lockText) {
    ovLast.lockText = lockText;
    setPromptText(ovEl.lockHint, lockText);
  }
  // Inside the shop the condition chip rides along (and tier-ups chime). Keep
  // its text painted while outside and reveal only its precomposited opacity
  // layer at the threshold. A first text/layout paint here used to make
  // Chromium flush the backed-up WebGL queue about 200 ms after door entry.
  // Condition itself still changes at only 4 Hz.
  condClock += dtMs;
  if (condClock >= 250) {
    condClock = 0;
    const ch = app.scene3d.clubhouse && app.scene3d.clubhouse();
    const inside = ch && ch.isInside(app.scene3d.walk.state.x, app.scene3d.walk.state.z);
    const conditionVisible = !!(inside && mode === 'walk' && app.state?.shop);
    const conditionScore = conditionVisible ? shopCondition(app.state) : null;
    const conditionText = conditionVisible
      ? shopConditionLabel(app.state, conditionScore)
      : ovLast.condText;
    if (conditionVisible) {
      if (app.state.tutorial) tutorialFlag(app.state, 'shopWalked');
      const word = CONDITION_WORD(conditionScore);
      if (lastCondWord && word !== lastCondWord && conditionScore >= 25 && audio.ready) audio.chime();
      lastCondWord = word;
    }
    if (conditionText !== ovLast.condText) {
      ovLast.condText = conditionText;
      setPromptText(ovEl.cond, conditionText);
    }
    if (conditionVisible !== ovLast.condVisible) {
      ovLast.condVisible = conditionVisible;
      ovEl.cond.classList.toggle('is-visible', conditionVisible);
      ovEl.cond.setAttribute('aria-hidden', conditionVisible ? 'false' : 'true');
    }
    // GOAL 25 legibility — SAY WHY THE LINE IS NOT MOVING.
    //
    // Only while the player is inside and on foot: outside the shop it is not
    // actionable, and in register mode the whole walk overlay is hidden anyway.
    // The rule itself is `ch.deskHoldup()`, which lives beside the router; this
    // only renders what it returns, so there is no second copy of the rule to
    // drift.
    const holdup = (inside && mode === 'walk' && ch?.deskHoldup) ? ch.deskHoldup() : null;
    // Through t(), and the count is a COLON-SEPARATED NUMBER rather than
    // "3 shoppers": English plural agreement baked into a template is not
    // translatable, and all ten locale tables are currently at zero missing
    // keys. A line that only reads correctly in English would be the first
    // crack in that.
    const kindText = holdup
      ? t(holdup.kind === 'check-in' ? 'hud.deskKindCheckIn' : 'hud.deskKindTeeTime')
      : '';
    const noteText = holdup
      ? (holdup.behind > 0
        ? t('hud.deskHoldup', { name: holdup.name, kind: kindText, behind: holdup.behind })
        : t('hud.deskHoldupAlone', { name: holdup.name, kind: kindText }))
      : '';
    // Text only when the sentence actually changed, and NEVER a display write —
    // opacity class only, so the threshold crossing stays free of layout.
    if (noteText && noteText !== ovLast.queueNoteText && ovEl.queueNote) {
      ovLast.queueNoteText = noteText;
      setPromptText(ovEl.queueNote, noteText);
    }
    const noteVisible = !!noteText;
    if (noteVisible !== ovLast.queueNoteVisible && ovEl.queueNote) {
      ovLast.queueNoteVisible = noteVisible;
      ovEl.queueNote.classList.toggle('is-visible', noteVisible);
      ovEl.queueNote.setAttribute('aria-hidden', noteVisible ? 'false' : 'true');
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
          'You did it. The muni nobody wanted became the club everyone talks about - and today it hosted a major. ' +
          'The greens rolled true, the members watched from the clubhouse they helped build, and the write-ups are glowing.'),
        el('div', { class: 'row muted' }, 'The club keeps running - there is always another season. Thanks for building it.'),
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
      toast(t('hud.holeReopened', { number: holeNumber(course, hole.id) }));
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
    // dpr first: a cross-monitor drag changes window.devicePixelRatio, and
    // scene3d.resize() sizes the composer from the renderer's CACHED ratio —
    // stale until this re-derives it (Goal 27 Phase 6).
    applyPixelRatioForViewport();
    app.scene3d.resize();
  }
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!app.scene3d) return;
    applyPixelRatioForViewport();
    app.scene3d.resize();
  }, 160);
}
window.addEventListener('resize', resize);
// ...and the dpr change that arrives WITHOUT a resize: changing Windows
// display scaling, or a cross-monitor move whose DIP size happens to match.
// matchMedia is the standard signal for it; the listener must re-arm on the
// new ratio each time it fires (a media query only matches its own value).
(function watchDprChanges() {
  let query = null;
  const arm = () => {
    query?.removeEventListener?.('change', onChange);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', onChange);
  };
  function onChange() {
    resize();
    arm();
  }
  arm();
})();

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
    audio, // H1 (Goal 20): the menu was silent because nothing gave it a voice
    async onNewGame(mode) {
      // Begin in the authored three-hole fixer-upper. Later acquisitions belong
      // on the physical clubhouse laptop, after the player knows the space.
      //
      // GOAL 28 P2: the veil goes up BEFORE state generation — measured at
      // 2,240 ms of synchronous work that used to run with the menu still on
      // screen, so the click appeared to do nothing for two seconds. Two rAFs
      // guarantee the veil's frame actually reaches the compositor before the
      // block lands. The attribution marks stay; they are how the block was
      // found and how any regression will be seen.
      // The seed draw is the FIRST random call in this handler: the QA seed
      // pin intercepts Math.random in exactly this frame
      // (tests/qa-boot-seed-pin.test.js), and veil.show() below draws random
      // numbers of its own for the plate pick — the suite's pin test caught
      // the seed landing on the photograph when the veil went first.
      const seed = (Math.random() * 2 ** 31) | 0;
      ensureLoadVeil().show('Founding the club');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      performance.mark('ng-stategen-start');
      app.empire = await generateStarterEmpire(mode, seed);
      performance.mark('ng-stategen-end');
      bootEmpire(app.empire);
      performance.mark('ng-boot-returned');
      await autosave();
      performance.mark('ng-autosave-done');
    },
    async onContinue() {
      // H2: the rotated generation is a real fallback, not just a file on disk.
      // If the whole autosave pair (primary + .bak) fails validation, the
      // previous generation still boots the run.
      //
      // MARKED, because this is where the boot's biggest unexamined stretch
      // lives. tools/qa/boot-mark-breakdown.js measured 2,291 ms between the
      // player committing here and startScene being ENTERED, with the teardown
      // and scene construction inside it taking 10.4 ms and 0.5 ms. All of that
      // time is save load plus bootEmpire, it touches nothing the player can
      // stutter on, and it had never been split.
      performance.mark('continue-handler-start');
      const empire = await loadEmpireSave('autosave', 'Autosave')
        || await loadEmpireSave('autosave-prev', 'Previous autosave');
      performance.mark('save-loaded');
      if (empire) bootEmpire(empire);
      performance.mark('boot-empire-returned');
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
  // The opts object is captured on app so a driver can ask the LAPTOP what it
  // would do, rather than re-deriving the answer from state and certifying that
  // its own copy of the rule agrees with itself. The laptop reads its
  // capabilities from here, so this is the surface that decides whether a fix is
  // reachable at all.
  const laptopOpts = {
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
    // B5 (Goal 24): the laptop's way out of a wedged counter. The clubhouse owns
    // the verb — it funnels through removeCustomer so the register lets go and
    // the stock returns — and this only carries the result back to the screen.
    clearCounterCustomer: () => app.scene3d?.clubhouse?.()?.dismissCounterCustomer?.() ?? null,
    // P0: the checkout interlock's key. Both halves go through the sim module
    // that owns the latch -- the laptop asks whether it is set and asks it to be
    // released, and never touches state.shop itself.
    checkoutRecordsWedged: () => checkoutWalIsQuarantined(app.state),
    resolveCheckoutRecords: () => releaseCheckoutWalQuarantine(app.state, { acknowledgedBy: 'owner' }).released === true,
  };
  app.laptopOpts = laptopOpts; // reachable from window.__fw, see the note above
  laptopUi = makeLaptop(app, laptopOpts);
  // The laptop component itself, reachable from window.__fw — the drivers already read
  // app.laptopOpen for the door state, and tools/qa/laptop-search-navigate.js needs the
  // instrument side too (searchIndexKinds, lastSearchReveal).
  app.laptop = laptopUi;
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
  toolTuner = makeToolTuner(app);
  app.toolTuner = toolTuner; // reachable from QA via window.__fw

  // A1 (Goal 19) — the pocket phone. Lives in #ui beside the ring chip; the
  // world keeps running while it is up (no pause, pointer lock untouched).
  if (!phoneUi) {
    phoneUi = makePhoneUi({
      app,
      audio,
      keyLabel: phoneKeyLabel,
      onBooking: () => {
        if (app.frontDeskOpen) frontDeskUi?.refresh();
        hud?.update();
      },
    });
    document.getElementById('ui')?.appendChild(phoneUi.root);
    app.phone = phoneUi; // reachable from QA via window.__fw
  }

  walkPrompt = el('div', { class: 'shop-prompt', 'aria-hidden': 'true' });
  // Build the same keycap/text/background compositor path while the loading
  // phase still owns first paint. Exact-zero opacity made Chromium defer that
  // Skia pipeline until the first world-space focus prompt during movement.
  setPromptText(walkPrompt, '[E] interact');
  walkCondition = el('div', {
    class: 'shop-cond', text: shopConditionLabel(app.state), role: 'status',
    'aria-live': 'polite', 'aria-hidden': 'true',
  });
  walkLockHint = el('div', { class: 'shop-lockhint', text: walkControlHintText() });
  // GOAL 25 legibility — the line is stopped and here is who stopped it. Its own
  // element rather than the condition chip: the chip is ambient decor the eye
  // learns to skip, and this is the sentence that unsticks a player who thinks
  // the game is broken.
  //
  // Built the CONDITION CHIP's way, not the obvious way. A `display:none` node
  // that appears when the queue blocks would flip display for the first time
  // just after door entry — the exact layout-and-first-paint flush that cost
  // this project 200 ms of stalled WebGL queue at every threshold, and which
  // `goal24-door-condition-chip-compositor.test.js` exists to prevent. So it
  // carries representative text from boot, stays on the translucent compositor
  // path at 0.004, and only its opacity class changes at runtime.
  walkQueueNote = el('div', {
    class: 'shop-queue-note', role: 'status', 'aria-live': 'polite',
    'aria-hidden': 'true',
    // Deliberately the real key with NO placeholder values: i18n leaves an
    // unfilled placeholder visible, so this paints glyphs of the right shape and
    // length in the player's own language without inventing a second sentence to
    // translate ten times. It is never read — the note only becomes visible
    // after real text has replaced it in the same tick.
    text: t('hud.deskHoldupAlone'),
  });
  walkOverlay = el('div', { class: 'shop-overlay', style: 'display:none' },
    el('div', { class: 'shop-crosshair' }),
    // House Flipper 1's reticle behaviour: point at dirt and a small label
    // under the crosshair confirms it is cleanable. It gets its OWN element
    // rather than sharing the prompt line — the room is full of props, and
    // routing it through the single prompt meant a desk or a window outranked
    // the dirt at every pile in the shop.
    el('div', { class: 'dirt-reticle', text: '', style: 'display:none' }),
    walkPrompt,
    // Flipper-Sense-style affordance: the reveal is worthless if nobody knows
    // the key exists, so the eye and its binding sit in the lower left whenever
    // there is actually dirt to find.
    el('div', { class: 'dirt-sense-hint', style: 'display:none' },
      el('span', { class: 'dirt-sense-eye', text: '◉' }),
      el('span', { class: 'dirt-sense-key', text: 'Q' }),
      el('span', { class: 'dirt-sense-text', text: 'reveal dirt' })),
    el('div', { class: 'property-inventory', text: '', style: 'display:none' }),
    walkCondition,
    walkLockHint,
    walkQueueNote,
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

  gameUi.append(hud.root, golfDayPanel.root, inspectPanel.root, groundsPanel.root, clubPanel.root, empirePanel.root, walkOverlay, regHint, laptopUi.root, objectivesPanel.root, viewToggle, editorUi.root, toolWheel.root, toolTuner.root,
    el('div', { class: 'hint-bar', style: 'display:none', text: 'Course overview · drag to pan · right-drag to rotate · wheel to zoom · V data view · Tab returns on foot · P pause' }));

  uiRoot.append(menu.root, gameUi);

  // PHASE 8: the single Escape router, installed at construction so it is the
  // FIRST capture-phase listener on window and therefore sees Escape before the
  // eighteen handlers it supersedes.
  installEscapeRouter();

  // 1.4 — ONE CLICK SINK, INSTALLED AT CONSTRUCTION.
  //
  // This used to live inside startGameNow(), which meant window.__fwUiClick did
  // not exist until the player had already started a game. Measured at the menu:
  // `sinkExists: false`. Menu presses were therefore served by a SECOND,
  // independent handler in menu.js -- two populations answering one question
  // (shape 1), with the menu's copy covering only what it happens to see. The
  // trace showed the consequence plainly: the first press of a session called
  // uiTick once, and the second press called it ZERO times, because the menu's
  // own listener is removed and re-added around visibility changes and the
  // global sink that should have covered the gap was not there yet.
  //
  // Installing here makes the sink exist for the whole session -- menu, every
  // dialog, and the game -- so 1.4's "every clickable control, including controls
  // inside dialogs" has one rule instead of a per-screen one. The menu's own
  // handler stays: it is what calls audio.init() on the very first gesture, which
  // is the only moment a context can legally be created, and the debounce inside
  // uiTick means the overlap costs one sound rather than two.
  installUiClickSink();
  // X3 (Goal 21) — THE LINE THAT MADE THE OBJECTIVES CARD INVISIBLE.
  //
  // `document.body.append(objectivesPanel.root)` used to sit here, one line
  // after the card had already been appended to gameUi above. append() MOVES a
  // node, so it tore the card out of #ui (position:absolute, z-index 3, layered
  // over the canvas) and re-parented it to <body>, where it painted BEHIND the
  // game. Every CSS check said it was fine: display, visibility and opacity were
  // all correct, checkVisibility() returned true, and it had a real 300x104 rect
  // at (16, 778). document.elementFromPoint at its own centre returned the
  // canvas.
  //
  // A stranger played for 25 minutes and never found out what the game wanted.
  // That is the whole cause.
  //
  // SHAPE 6 for the found-false ledger: VISIBLE BUT NOT PAINTED. Every property
  // the check reads is correct and the pixels belong to something else. The
  // question that catches it is "what does elementFromPoint say is there?"
  startProductionFrameLoop();

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

// F3: installed BEFORE boot, so a fault during the load itself is caught. This
// is the load a player is most likely to see fail — a missing model, a shader
// that will not compile on their driver — and it used to leave the veil up
// forever with nothing said.
installFaultGuard();

boot();

// Debug/QA hook: lets browser tooling inspect and drive the live app state.
// Harmless in production (read-mostly), invaluable for automated QA.
// the autosave, reachable for tooling. tools/qa/register-recover.js takes the game's
// OWN save mid-transaction — the exact write the day rollover makes — and reloads, to
// prove the shelf comes back. A recovery test that used a different save path would
// be testing the wrong thing.
app.autosave = autosave;
// GOAL 34: the frame cap can only be proved by CHANGING it and measuring what
// the player was shown. The settings panel is the player's door to this; a
// driver that clicked through it would be testing the select element.
app.setFpsCapForQa = (fps) => {
  preferences.set('display.fpsCap', Number(fps) || 0);
  applySettings();
  return frameCap.diagnostics();
};
window.__fw = app;

// The GPU process's driver version, primed for the compile screen's gate. It
// resolves in milliseconds while the player is still on the menu; if a load
// ever starts first, the gate compares GL strings only for that boot and says
// nothing (unknown is not "changed").
window.fairwayNative?.gpuDriverVersions?.()
  .then((versions) => primeDriverVersions(versions))
  .catch(() => {});
app.editorUi = () => editorUi; // QA hook: drive the editor from tooling

// ?keydebug=1 — watch a REAL keypress travel from the OS to the walker. Off by
// default and dynamically imported, so the normal build never loads it. This
// exists because a key can pass every synthetic harness and still do nothing
// under a real hand, and nothing else in the app can tell those apart.
// The flag is read inline rather than imported, so the overlay module is never
// fetched or parsed unless it is actually asked for.
if (new URLSearchParams(window.location.search).get('keydebug') === '1') {
  import(/* @vite-ignore */ new URL('src/debug/keyCapture.js', document.baseURI).href)
    .then(({ startKeyCapture }) => startKeyCapture(app))
    .catch((e) => console.error('key capture failed to start', e));
}

// The six-case input probe, attached in development sessions only. It must be reachable
// identically from a Chromium driver and from the Electron shell driver, because the whole
// question is browser-versus-desktop — and a measurement that arrives by two different
// routes is two measurements. Nothing is installed until a driver calls arm(); the object
// here is inert.
if (devSessionActive()) {
  import(/* @vite-ignore */ new URL('src/debug/inputProbe.js', document.baseURI).href)
    .then(({ createInputProbe, SIX_KEY_CASES }) => {
      app.inputProbe = createInputProbe(app);
      app.inputProbe.cases = SIX_KEY_CASES;
    })
    .catch((e) => console.error('input probe failed to load', e));
}
