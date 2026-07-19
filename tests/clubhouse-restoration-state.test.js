import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHITECTURE_COMPONENTS,
  ARCHITECTURE_DEFAULTS,
  ARCHITECTURE_FINISH_OPTIONS,
  ARCHITECTURE_STATE_VERSION,
  MAIN_DOOR_LEAVES,
  MAIN_DOOR_STATES,
  defaultClubhouseArchitecture,
  ensureClubhouseArchitecture,
  setArchitectureComponent,
  setArchitectureFinish,
  updateArchitectureComponent,
  setShellRestored,
  setPorchRestored,
  setWindowsRestored,
  setPanelsRestored,
  setTrimRestored,
  setCeilingRestored,
  setFloorRestored,
  setMainDoorLeafState,
  setMainDoorState,
  toggleMainDoorLeafState,
  toggleMainDoorState,
} from '../src/sim/clubhouseRestoration.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';

const dirtyState = () => ({
  version: 73,
  shop: {
    reno: {
      grime: [0.8, 0.6],
      windows: [0.9, 0.7],
      wash: {
        sidingSW: { grime: [0.8], soap: [0] },
        sidingSE: { grime: [0.8], soap: [0] },
        foundation: { grime: [0.8], soap: [0] },
        porch: { grime: [0.8], soap: [0] },
        trim: { grime: [0.8], soap: [0] },
      },
      exterior: { weeds: [1, 1], gutter: 1, cobwebs: 1, light: 1 },
      untouched: { value: 42 },
    },
  },
});

const cleanWash = () => ({
  sidingSW: { grime: [0, 0.005], soap: [0, 0] },
  sidingSE: { grime: [0], soap: [0] },
  foundation: { grime: [0.01], soap: [0] },
  porch: { grime: [0, 0], soap: [0, 0] },
  trim: { grime: [0], soap: [0] },
});

test('constants and nested defaults are immutable while factory results are independent', () => {
  assert.equal(ARCHITECTURE_STATE_VERSION, 1);
  for (const value of [
    ARCHITECTURE_COMPONENTS,
    ARCHITECTURE_FINISH_OPTIONS,
    ARCHITECTURE_FINISH_OPTIONS.floor,
    ARCHITECTURE_DEFAULTS,
    ARCHITECTURE_DEFAULTS.components,
    ARCHITECTURE_DEFAULTS.components.shell,
    ARCHITECTURE_DEFAULTS.doors.main,
    MAIN_DOOR_LEAVES,
    MAIN_DOOR_STATES,
  ]) assert.ok(Object.isFrozen(value));

  assert.throws(() => { ARCHITECTURE_DEFAULTS.components.shell.restored = true; }, TypeError);
  assert.throws(() => { ARCHITECTURE_FINISH_OPTIONS.floor.push('invalid'); }, TypeError);

  const a = defaultClubhouseArchitecture();
  const b = defaultClubhouseArchitecture();
  assert.deepEqual(a, ARCHITECTURE_DEFAULTS);
  assert.deepEqual(b, ARCHITECTURE_DEFAULTS);
  assert.notEqual(a, b);
  assert.notEqual(a.components.shell, b.components.shell);
  a.components.shell.restored = true;
  assert.equal(b.components.shell.restored, false);
  assert.equal(ARCHITECTURE_DEFAULTS.components.shell.restored, false);
});

test('ensure creates only the nested architecture defaults and leaves global version alone', () => {
  const state = { version: 6 };
  const architecture = ensureClubhouseArchitecture(state);
  assert.deepEqual(architecture, ARCHITECTURE_DEFAULTS);
  assert.equal(state.version, 6, 'the global SAVE_VERSION is not this module\'s version');
  assert.equal(state.shop.reno.architecture, architecture);

  for (const component of ARCHITECTURE_COMPONENTS) {
    assert.equal(architecture.components[component].restored, false);
  }
  assert.deepEqual(architecture.doors.main, { left: 'closed', right: 'closed' });
});

test('complete legacy cleaning evidence is inferred without touching cleaning state', () => {
  const state = dirtyState();
  state.shop.reno.grime = [0, 0.005];
  state.shop.reno.windows = [0, 0.01];
  state.shop.reno.wash = cleanWash();
  state.shop.reno.exterior = { weeds: [0, false, 0], gutter: 0, cobwebs: false, light: 0 };
  const siblingSnapshot = JSON.stringify({
    grime: state.shop.reno.grime,
    windows: state.shop.reno.windows,
    wash: state.shop.reno.wash,
    exterior: state.shop.reno.exterior,
    untouched: state.shop.reno.untouched,
  });

  const architecture = ensureClubhouseArchitecture(state);
  assert.equal(architecture.components.shell.restored, true);
  assert.equal(architecture.components.porch.restored, true);
  assert.equal(architecture.components.windows.restored, true);
  assert.equal(architecture.components.floor.restored, true);
  assert.equal(architecture.components.panels.restored, false, 'cleanliness is not panel repair');
  assert.equal(architecture.components.trim.restored, false, 'gable washing is not interior trim repair');
  assert.equal(architecture.components.ceiling.restored, false, 'cleanliness is not ceiling repair');
  assert.equal(state.version, 73);
  assert.equal(JSON.stringify({
    grime: state.shop.reno.grime,
    windows: state.shop.reno.windows,
    wash: state.shop.reno.wash,
    exterior: state.shop.reno.exterior,
    untouched: state.shop.reno.untouched,
  }), siblingSnapshot);
});

test('version-zero aliases, finishes, completion, and door state migrate once', () => {
  const state = dirtyState();
  state.shop.reno.architecture = {
    version: 0,
    shellComplete: true,
    components: { panels: { restored: true }, floor: { finish: 'warm-cream-tile' } },
    finishes: { porch: 'medium-walnut' },
    trim: { status: 'completed', finish: 'deep-golf-green' },
    mainDoor: { leftOpen: true, right: 'closed' },
  };

  const architecture = ensureClubhouseArchitecture(state);
  assert.equal(architecture.version, ARCHITECTURE_STATE_VERSION);
  assert.equal(architecture.components.shell.restored, true);
  assert.equal(architecture.components.panels.restored, true);
  assert.equal(architecture.components.trim.restored, true);
  assert.equal(architecture.components.porch.finish, 'medium-walnut');
  assert.equal(architecture.components.floor.finish, 'warm-cream-tile');
  assert.equal(architecture.components.trim.finish, 'deep-golf-green');
  assert.deepEqual(architecture.doors.main, { left: 'open', right: 'closed' });
  assert.deepEqual(Object.keys(architecture), ['version', 'components', 'doors']);
});

test('an explicit legacy whole-building completion marker never regresses work', () => {
  const state = dirtyState();
  state.shop.reno.architectureComplete = true;
  const architecture = ensureClubhouseArchitecture(state);
  for (const component of ARCHITECTURE_COMPONENTS) {
    assert.equal(architecture.components[component].restored, true, component);
  }

  assert.equal(setFloorRestored(state, false).changed, true);
  assert.equal(ensureClubhouseArchitecture(state), architecture, 'migration produces one canonical authority');
  assert.equal(
    architecture.components.floor.restored,
    false,
    'a retained legacy marker cannot override a later canonical component update',
  );
});

test('canonical architecture is identity-idempotent and ignores later legacy completion evidence', () => {
  const state = dirtyState();
  const architecture = ensureClubhouseArchitecture(state);
  const unchanged = JSON.stringify(architecture);
  assert.equal(ensureClubhouseArchitecture(state), architecture);
  assert.equal(JSON.stringify(architecture), unchanged);

  state.shop.reno.grime = [0, 0.005];
  state.shop.reno.windows = [0, 0.01];
  state.shop.reno.wash = cleanWash();
  state.shop.reno.exterior = { weeds: [0, false, 0], gutter: 0, cobwebs: false, light: 0 };
  state.shop.reno.architectureComplete = true;
  state.shop.reno.restorationComplete = true;

  assert.equal(ensureClubhouseArchitecture(state), architecture, 'canonical object keeps identity');
  assert.equal(JSON.stringify(architecture), unchanged, 'canonical values remain authoritative');
  for (const component of ARCHITECTURE_COMPONENTS) {
    assert.equal(
      architecture.components[component].restored,
      false,
      `${component} is not promoted after canonicalization`,
    );
  }
});

test('clean canonical damage survives the real serializer and an unrelated door mutation', () => {
  let state = newGame('relaxed', 605106);
  const architecture = ensureClubhouseArchitecture(state);
  const reno = state.shop.reno;

  reno.grime.fill(0);
  reno.windows.fill(0);
  for (const surface of Object.values(reno.wash)) {
    if (Array.isArray(surface?.grime)) surface.grime.fill(0);
  }
  reno.exterior = { weeds: [0, 0, 0], gutter: 0, cobwebs: 0, light: 0 };

  for (const component of ARCHITECTURE_COMPONENTS) {
    assert.equal(architecture.components[component].restored, false, component);
  }

  state = deserialize(serialize(state));
  const loaded = ensureClubhouseArchitecture(state);
  for (const component of ARCHITECTURE_COMPONENTS) {
    assert.equal(
      loaded.components[component].restored,
      false,
      `${component} survives clean save/load as explicitly damaged`,
    );
  }

  assert.equal(setMainDoorState(state, 'open').ok, true);
  assert.deepEqual(loaded.doors.main, { left: 'open', right: 'open' });
  for (const component of ARCHITECTURE_COMPONENTS) {
    assert.equal(
      loaded.components[component].restored,
      false,
      `${component} is unchanged by the unrelated door mutation`,
    );
  }
});

test('corrupt architecture data normalizes while valid individual values survive', () => {
  const state = dirtyState();
  state.shop.reno.architecture = {
    version: 'broken',
    components: {
      shell: { restored: 'yes', finish: 'neon' },
      porch: null,
      floor: { restored: false, finish: 'medium-walnut' },
    },
    finishes: { panels: 99 },
    doors: { main: { left: 'ajar', right: 'open' } },
    junk: ['discard me'],
  };

  const architecture = ensureClubhouseArchitecture(state);
  assert.deepEqual(Object.keys(architecture), ['version', 'components', 'doors']);
  assert.equal(architecture.components.shell.restored, false);
  assert.equal(architecture.components.shell.finish, ARCHITECTURE_DEFAULTS.components.shell.finish);
  assert.equal(architecture.components.floor.finish, 'medium-walnut');
  assert.deepEqual(architecture.doors.main, { left: 'closed', right: 'open' });
  assert.equal(architecture.version, ARCHITECTURE_STATE_VERSION);
});

test('component helpers validate atomically and cover all seven restoration groups', () => {
  const state = dirtyState();
  const architecture = ensureClubhouseArchitecture(state);
  const before = JSON.stringify(architecture);

  assert.equal(setArchitectureComponent(state, 'roof', true).ok, false);
  assert.equal(setArchitectureComponent(state, 'shell', 1).ok, false);
  assert.equal(setArchitectureFinish(state, 'floor', 'lava').ok, false);
  assert.equal(updateArchitectureComponent(state, 'floor', {}).ok, false);
  assert.equal(updateArchitectureComponent(state, 'floor', { restored: true, typo: true }).ok, false);
  assert.equal(updateArchitectureComponent(state, 'floor', { restored: true, finish: 'lava' }).ok, false);
  assert.equal(updateArchitectureComponent(null, 'floor', { restored: true }).ok, false);
  assert.equal(JSON.stringify(architecture), before, 'invalid updates do not partially mutate');

  const setters = [
    setShellRestored,
    setPorchRestored,
    setWindowsRestored,
    setPanelsRestored,
    setTrimRestored,
    setCeilingRestored,
    setFloorRestored,
  ];
  setters.forEach((setter, index) => {
    const result = setter(state, true);
    assert.equal(result.ok, true, ARCHITECTURE_COMPONENTS[index]);
    assert.equal(result.changed, true, ARCHITECTURE_COMPONENTS[index]);
  });
  assert.equal(setFloorRestored(state, true).changed, false, 'same update is a no-op');
  assert.equal(setArchitectureFinish(state, 'floor', 'muted-sage-carpet').ok, true);
  assert.deepEqual(
    updateArchitectureComponent(state, 'panels', { restored: false, finish: 'medium-walnut' }).value,
    { restored: false, finish: 'medium-walnut' },
  );
});

test('double-door helpers persist independent leaves and reject invalid input safely', () => {
  const state = dirtyState();
  const architecture = ensureClubhouseArchitecture(state);
  const before = JSON.stringify(architecture);
  assert.equal(setMainDoorLeafState(state, 'middle', 'open').ok, false);
  assert.equal(setMainDoorLeafState(state, 'left', 'ajar').ok, false);
  assert.equal(setMainDoorState(state, true).ok, false);
  assert.equal(toggleMainDoorLeafState(state, 'middle').ok, false);
  assert.equal(JSON.stringify(architecture), before);

  assert.equal(setMainDoorLeafState(state, 'left', 'open').changed, true);
  assert.deepEqual(architecture.doors.main, { left: 'open', right: 'closed' });
  assert.equal(toggleMainDoorLeafState(state, 'right').state, 'open');
  assert.deepEqual(architecture.doors.main, { left: 'open', right: 'open' });
  assert.equal(toggleMainDoorState(state).state, 'closed');
  assert.deepEqual(architecture.doors.main, { left: 'closed', right: 'closed' });
  assert.equal(setMainDoorState(state, 'open').changed, true);
  assert.equal(setMainDoorState(state, 'open').changed, false);
});

test('architecture state is deterministic and survives a JSON round-trip', () => {
  const state = dirtyState();
  setShellRestored(state, true);
  setArchitectureFinish(state, 'floor', 'warm-cream-tile');
  setMainDoorLeafState(state, 'right', 'open');
  const expected = structuredClone(state.shop.reno.architecture);
  const siblingSnapshot = JSON.stringify({
    grime: state.shop.reno.grime,
    windows: state.shop.reno.windows,
    wash: state.shop.reno.wash,
  });

  const loaded = JSON.parse(JSON.stringify(state));
  const architecture = ensureClubhouseArchitecture(loaded);
  assert.deepEqual(architecture, expected);
  assert.equal(ensureClubhouseArchitecture(loaded), architecture);
  assert.equal(JSON.stringify({
    grime: loaded.shop.reno.grime,
    windows: loaded.shop.reno.windows,
    wash: loaded.shop.reno.wash,
  }), siblingSnapshot);
  assert.equal(JSON.stringify(architecture).includes('undefined'), false);
});

test('invalid root and read-only state inputs fail without throwing', () => {
  assert.equal(ensureClubhouseArchitecture(null), null);
  assert.equal(ensureClubhouseArchitecture([]), null);
  assert.equal(ensureClubhouseArchitecture(Object.freeze({ version: 7 })), null);
  assert.equal(setShellRestored(Object.freeze({ version: 7 }), true).ok, false);

  const state = dirtyState();
  const architecture = ensureClubhouseArchitecture(state);
  Object.freeze(architecture.components);
  assert.equal(setFloorRestored(state, true).ok, false);
  assert.equal(architecture.components.floor.restored, false);
});
