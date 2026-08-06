import { QUALITY_PRESETS } from '../core/preferences.js';
import {
  BINDABLE_ACTIONS, DEFAULT_BINDINGS, actionLabel, bindingConflicts,
  canonicalKeyName, describeKey, isBindableKey,
} from '../core/keyBindings.js';
import {
  SELECTABLE_CLUBHOUSE_VARIANTS,
  devSessionActive,
  storeClubhouseVariant,
} from '../data/clubhouseVariant.js';
import { CLUBHOUSE_VARIANT_REQUEST } from '../data/shopLayout.js';
import { DEFAULT_LOCALE, LOCALES, coverage, onLocaleChange, t } from '../core/i18n.js';
import { el, notify } from './ui.js';

const pct = (value) => `${Math.round(Number(value) * 100)}%`;

export function makeSettingsPanel({
  preferences,
  audio,
  apply,
  onResetTutorials,
  onDisableTutorials,
  tutorialEnabled,
} = {}) {
  const root = el('div', { class: 'settings-shell' });
  const tabs = el('div', { class: 'settings-tabs', role: 'tablist', 'aria-label': 'Settings categories' });
  const content = el('div', { class: 'settings-page' });
  let active = 'audio';

  function changed(result) {
    apply?.();
    if (!result?.ok) {
      notify({
        message: 'This setting works for this session, but it could not be saved. Check that the game can write to local storage.',
        category: 'save-failure',
        persistent: true,
        dedupeKey: 'preferences-write-failed',
      });
    }
    if (audio?.ready) audio.uiTick();
    return result;
  }

  function set(path, value) {
    return changed(preferences.set(path, value));
  }

  function update(patch) {
    return changed(preferences.update(patch));
  }

  const description = (text) => el('div', { class: 'setting-description', text });
  const row = (label, detail, control) => el('div', { class: 'setting-row' },
    el('div', { class: 'setting-copy' }, el('div', { class: 'setting-label', text: label }), description(detail)),
    el('div', { class: 'setting-control' }, control),
  );

  function slider(label, detail, path, { min = 0, max = 1, step = 0.05, format = pct } = {}) {
    const output = el('output', { class: 'setting-value', text: format(preferences.get(path)) });
    const input = el('input', {
      type: 'range', min, max, step, value: preferences.get(path),
      'aria-label': label,
      oninput: (event) => {
        const value = Number(event.currentTarget.value);
        output.value = format(value);
        output.textContent = format(value);
        set(path, value);
      },
    });
    return row(label, detail, el('div', { class: 'setting-inline' }, input, output));
  }

  function toggle(label, detail, path, { on = 'On', off = 'Off' } = {}) {
    const button = el('button', {
      type: 'button',
      class: `setting-toggle${preferences.get(path) ? ' is-on' : ''}`,
      'aria-pressed': String(!!preferences.get(path)),
      text: preferences.get(path) ? on : off,
      onclick: () => {
        const value = !preferences.get(path);
        set(path, value);
        button.classList.toggle('is-on', value);
        button.setAttribute('aria-pressed', String(value));
        button.textContent = value ? on : off;
      },
    });
    return row(label, detail, button);
  }

  function choice(label, detail, path, choices) {
    const select = el('select', {
      'aria-label': label,
      onchange: (event) => set(path, event.currentTarget.value),
    }, ...choices.map(([value, text]) => el('option', {
      value,
      text,
      selected: preferences.get(path) === value ? true : null,
    })));
    return row(label, detail, select);
  }

  function section(title, intro, ...rows) {
    return el('section', { class: 'settings-group' },
      el('div', { class: 'settings-group-head' },
        el('h3', { text: title }),
        intro ? el('p', { text: intro }) : null,
      ),
      ...rows,
    );
  }

  function audioPage() {
    const mute = toggle('Mute all audio', 'Silences the master output without changing the category levels.', 'audio.muted', { on: 'Muted', off: 'Sound on' });
    return section(t('settings.audio.title'), t('settings.audio.intro'),
      mute,
      slider('Master volume', 'Overall game volume.', 'audio.master'),
      slider('Effects volume', 'Tools, doors, products, checkout, and movement feedback.', 'audio.effects'),
      slider('Ambience volume', 'Weather, course life, and clubhouse atmosphere.', 'audio.ambience'),
      slider('Interface volume', 'Menu navigation, confirmations, errors, and notifications.', 'audio.ui'),
    );
  }

  function cameraPage() {
    return section(t('settings.camera.title'), t('settings.camera.intro'),
      slider('Mouse sensitivity', 'How quickly the first-person camera turns.', 'camera.sensitivity', {
        min: 0.35, max: 2.5, step: 0.05, format: (value) => Number(value).toFixed(2),
      }),
      toggle('Invert vertical look', 'Moving the mouse up looks down, and moving it down looks up.', 'camera.invertY', { on: 'Inverted', off: 'Standard' }),
      slider('Field of view', 'First-person horizontal comfort range. Laptop focus uses its own readable lens.', 'camera.fov', {
        min: 50, max: 90, step: 1, format: (value) => `${Math.round(value)}°`,
      }),
      toggle('Camera movement', 'Adds a small walking motion and tool sway. Reduced motion always overrides this.', 'camera.bob', { on: 'Enabled', off: 'Disabled' }),
    );
  }

  function nativeDisplayRows(container) {
    const native = window.fairwayNative;
    if (!native?.displayInfo || !native?.setWindowMode || !native?.setResolution) return;
    const status = el('div', { class: 'setting-native-status', role: 'status', text: 'Reading display…' });
    container.append(status);
    native.displayInfo().then((info) => {
      status.replaceChildren();
      const mode = el('select', {
        'aria-label': 'Window mode',
        onchange: async (event) => {
          try {
            await native.setWindowMode(event.currentTarget.value);
            status.dataset.state = 'ready';
          } catch (error) {
            notify({ message: 'Window mode could not be changed. Try again after returning to the main menu.', category: 'invalid' });
            console.error('window mode change failed', error);
          }
        },
      },
      el('option', { value: 'windowed', text: 'Windowed', selected: info.mode === 'windowed' ? true : null }),
      el('option', { value: 'fullscreen', text: 'Fullscreen', selected: info.mode === 'fullscreen' ? true : null }));
      const resolutions = info.resolutions || [];
      const resolution = el('select', {
        'aria-label': 'Window resolution',
        disabled: info.mode === 'fullscreen' ? true : null,
        onchange: async (event) => {
          const [width, height] = event.currentTarget.value.split('x').map(Number);
          try {
            await native.setResolution(width, height);
          } catch (error) {
            notify({ message: 'That window size is not available on this display.', category: 'invalid' });
            console.error('resolution change failed', error);
          }
        },
      }, ...resolutions.map(({ width, height }) => el('option', {
        value: `${width}x${height}`,
        text: `${width} × ${height}`,
        selected: width === info.width && height === info.height ? true : null,
      })));
      mode.addEventListener('change', () => { resolution.disabled = mode.value === 'fullscreen'; });
      status.append(
        row('Window mode', 'Fullscreen uses the active display. Windowed mode supports explicit sizes.', mode),
        row('Window resolution', 'Available while windowed; the game UI remains responsive.', resolution),
      );
    }).catch((error) => {
      status.textContent = 'Native display controls are unavailable in this session.';
      console.error('display info failed', error);
    });
  }

  function displayPage() {
    const quality = el('select', {
      'aria-label': 'Graphics quality',
      onchange: (event) => {
        const preset = QUALITY_PRESETS[event.currentTarget.value];
        if (preset) update({ display: preset });
      },
    }, ...[
      ['low', 'Low'], ['balanced', 'Balanced'], ['high', 'High'], ['custom', 'Custom'],
    ].map(([value, text]) => el('option', {
      value, text, selected: preferences.values.display.quality === value ? true : null,
      disabled: value === 'custom' ? true : null,
    })));
    const page = section(t('settings.display.title'), t('settings.display.intro'),
      row('Graphics quality', 'Sets render scale, ambient occlusion, bloom, and shadows together.', quality),
      slider('Render scale', 'Internal 3D resolution. The interface remains at full clarity.', 'display.renderScale', {
        min: 0.65, max: 1.35, step: 0.05, format: pct,
      }),
      toggle('Ambient occlusion', 'Adds contact depth around furniture, walls, and terrain.', 'display.ambientOcclusion'),
      toggle('Bloom', 'Adds restrained glow to bright fixtures and highlights.', 'display.bloom'),
      toggle('Shadows', 'Enables real-time object and terrain shadows.', 'display.shadows'),
      slider('Interface scale', 'Scales menus, HUD, prompts, notifications, and the laptop interface.', 'display.uiScale', {
        min: 0.9, max: 1.3, step: 0.05, format: pct,
      }),
    );
    nativeDisplayRows(page);
    return page;
  }

  // --- Controls (N2/F2) ----------------------------------------------------
  // One row per rebindable verb. Click the keycap, press the new key; if that
  // key already belongs to another verb the two SWAP, so no verb is ever left
  // without a key. Escape cancels a capture. Reserved keys (Escape itself,
  // modifiers alone as chords, F11/F12) are refused by the table.
  function controlsPage() {
    const bindingsNow = () => preferences.values.controls.bindings;
    const buttons = new Map();
    let capture = null;

    const refreshButtons = () => {
      for (const [actionId, button] of buttons) {
        if (capture?.actionId === actionId) continue;
        button.textContent = describeKey(bindingsNow()[actionId]);
      }
    };

    const stopCapture = () => {
      if (!capture) return;
      window.removeEventListener('keydown', capture.onKey, true);
      capture.button.classList.remove('is-capturing');
      capture = null;
      refreshButtons();
    };

    const beginCapture = (action, button) => {
      stopCapture();
      button.classList.add('is-capturing');
      button.textContent = 'Press a key';
      const onKey = (event) => {
        // the panel may have been torn down mid-capture; never leak the hook
        if (!button.isConnected) {
          window.removeEventListener('keydown', onKey, true);
          capture = null;
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const key = canonicalKeyName(event);
        if (key === 'escape') { stopCapture(); return; }
        if (!isBindableKey(key)) return; // stay in capture for a usable key
        const next = { ...bindingsNow() };
        const previousKey = next[action.id];
        const holder = Object.entries(next)
          .find(([otherId, otherKey]) => otherKey === key && otherId !== action.id)?.[0];
        next[action.id] = key;
        if (holder) next[holder] = previousKey; // swap - nothing goes unbound
        stopCapture();
        set('controls.bindings', next);
        refreshButtons();
      };
      window.addEventListener('keydown', onKey, true);
      capture = { actionId: action.id, button, onKey };
    };

    const groups = new Map();
    for (const action of BINDABLE_ACTIONS) {
      if (!groups.has(action.group)) groups.set(action.group, []);
      groups.get(action.group).push(action);
    }

    const conflictNote = () => {
      const conflicts = bindingConflicts(bindingsNow());
      if (!conflicts.length) return null;
      return el('div', {
        class: 'setting-description',
        text: `Shared keys: ${conflicts.map((c) => `${describeKey(c.key)} (${c.actions.map(actionLabel).join(', ')})`).join('; ')}`,
      });
    };

    const rows = [];
    for (const [groupName, actions] of groups) {
      rows.push(el('div', { class: 'settings-group-head' }, el('h3', { text: groupName })));
      for (const action of actions) {
        const button = el('button', {
          type: 'button',
          class: 'setting-toggle setting-keycap',
          text: describeKey(bindingsNow()[action.id]),
          'aria-label': `Rebind ${action.label}`,
          onclick: (event) => beginCapture(action, event.currentTarget),
        });
        buttons.set(action.id, button);
        rows.push(row(action.label, action.hold ? 'Hold and tap both follow this key.' : '', button));
      }
    }
    rows.push(row('Reset controls', 'Every verb returns to its shipped key.', el('button', {
      type: 'button',
      text: 'Reset to defaults',
      onclick: () => {
        stopCapture();
        set('controls.bindings', { ...DEFAULT_BINDINGS });
        refreshButtons();
      },
    })));

    return section(t('settings.controls.title'), t('settings.controls.intro'),
      conflictNote(),
      ...rows,
    );
  }

  function accessibilityPage() {
    const tutorialControls = onResetTutorials || onDisableTutorials
      ? row('Contextual tutorials', 'Progress is saved with the current game. Reset re-enables every first-use lesson.',
        el('div', { class: 'setting-inline' },
          onResetTutorials ? el('button', {
            type: 'button', text: 'Reset tutorials', onclick: () => { onResetTutorials(); audio?.uiTick?.(); },
          }) : null,
          tutorialEnabled && onDisableTutorials ? el('button', {
            type: 'button', text: 'Disable guidance', onclick: () => { onDisableTutorials(); audio?.uiTick?.(); },
          }) : null,
        ))
      : null;
    return section(t('settings.accessibility.title'), t('settings.accessibility.intro'),
      toggle('Reduced motion', 'Removes menu animation, camera bob, tool sway, and eased focus transitions.', 'accessibility.reducedMotion'),
      toggle('High-contrast interface', 'Strengthens panel, focus, prompt, and status boundaries.', 'accessibility.highContrast'),
      choice('Sustained tool use', 'Choose whether cleaning and maintenance tools run while held or toggle on each press.', 'accessibility.toolActivation', [
        ['hold', 'Hold button'], ['toggle', 'Press to toggle'],
      ]),
      tutorialControls,
    );
  }

  // --- Language ------------------------------------------------------------------
  // Q3 (2026-08-06): "add a languages section in the settings so people who speak
  // spanish, french, english etc can play my game just fine". The picker is
  // labelled in each language's OWN name, because someone who cannot read the
  // current language still has to be able to find theirs. Coverage is reported
  // honestly rather than implied: anything not yet translated stays in English
  // and the page says how much that is.
  function languagePage() {
    const current = preferences.get('locale') || DEFAULT_LOCALE;
    const select = el('select', {
      'aria-label': t('settings.language.select'),
      class: 'setting-language-select',
      onchange: (event) => {
        set('locale', event.currentTarget.value);
        render(); // the page itself is written in the language being chosen
      },
    }, ...LOCALES.map((entry) => el('option', {
      value: entry.id,
      text: entry.id === current ? entry.endonym : `${entry.endonym} (${entry.label})`,
      selected: entry.id === current ? true : null,
    })));
    const cover = coverage(current);
    return section(t('settings.language.title'), t('settings.language.intro'),
      row(t('settings.language.select'), t('settings.language.select.detail'), select),
      el('div', { class: 'setting-native-status', role: 'status' },
        description(t('settings.language.coverage', { done: cover.done, total: cover.total })),
      ),
    );
  }

  // --- Developer -----------------------------------------------------------------
  // The packaged app has no address bar, so ?clubhouse=pine-hills-v2 made the greybox
  // room reachable only from a browser tab — which is where most of the reported input
  // bugs (X closing a tab, Shift+W reloading) actually live. This tab exists so the
  // shipping runtime can be tested. It appears only in a development session; see
  // isDevSession in src/data/clubhouseVariant.js.
  const VARIANT_LABELS = {
    'pine-hills-v2': 'Pine Hills v2 - Phase 3 greybox',
    'pine-hills': 'Pine Hills - v1 authored room',
    'modern-public': 'Modern municipal (default)',
    'mountain-lodge': 'Mountain lodge',
    legacy: 'Legacy envelope',
  };
  const SOURCE_LABELS = {
    query: 'the ?clubhouse= query on the URL',
    'launch-flag': 'the --clubhouse launch flag',
    setting: 'this saved setting',
    default: 'the default (no room was requested)',
  };

  function developerPage() {
    const active = CLUBHOUSE_VARIANT_REQUEST.variant;
    const source = CLUBHOUSE_VARIANT_REQUEST.source;
    // The room in force RIGHT NOW, and what put it there. Reported rather than assumed:
    // the query still outranks the setting, so a session entered with a query will not
    // change room until the query is gone, and saying so beats a control that looks
    // like it did nothing.
    const status = el('div', { class: 'setting-native-status', role: 'status' },
      el('div', { class: 'setting-label', text: `Now drawing: ${VARIANT_LABELS[active] || VARIANT_LABELS['modern-public']}` }),
      description(`From ${SOURCE_LABELS[source] || source}.`),
    );

    let pending = active || '';
    const select = el('select', {
      'aria-label': 'Clubhouse room',
      onchange: (event) => { pending = event.currentTarget.value; },
    },
    el('option', { value: '', text: VARIANT_LABELS['modern-public'], selected: pending ? null : true }),
    ...SELECTABLE_CLUBHOUSE_VARIANTS.filter((id) => id !== 'modern-public').map((id) => el('option', {
      value: id, text: VARIANT_LABELS[id] || id, selected: pending === id ? true : null,
    })));

    const applyRoom = () => {
      const result = storeClubhouseVariant(pending || null);
      if (!result.ok) {
        notify({ message: 'The room choice could not be saved. Check that the game can write to local storage.', category: 'invalid' });
        return;
      }
      // Every clubhouse datum was frozen at module load, so the room can only change on
      // a fresh load. Reloading is the point of the button rather than a side effect.
      globalThis.location?.reload?.();
    };

    return section('Developer', 'Not player-facing. Visible because this is a development session.',
      status,
      row('Clubhouse room', 'Which clubhouse the next load builds. Saved, so plain `npm run dev` keeps returning to it.', select),
      row('Apply', 'Saves the choice and reloads - the floor plan resolves once, at load, so nothing changes until then.',
        el('button', { type: 'button', class: 'primary', text: 'Save and reload', onclick: applyRoom })),
    );
  }

  const pages = {
    audio: audioPage,
    camera: cameraPage,
    controls: controlsPage,
    display: displayPage,
    language: languagePage,
    accessibility: accessibilityPage,
    ...(devSessionActive() ? { developer: developerPage } : {}),
  };

  function render() {
    for (const button of tabs.children) {
      const selected = button.dataset.page === active;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    content.replaceChildren(pages[active]());
  }

  // Driven off `pages` so the Developer tab cannot be present in one list and missing
  // from the other — the arrow-key handler indexes the same keys.
  // the tab strip is drawn in the chosen language too, so it is rebuilt on a
  // language change rather than left in the one the player just left
  const tabLabel = (id) => t(`settings.tab.${id}`);
  function buildTabs() {
    tabs.replaceChildren(...Object.keys(pages).map((id) => el('button', {
      type: 'button', role: 'tab', class: 'settings-tab', text: tabLabel(id), 'data-page': id,
      onclick: () => { active = id; render(); audio?.uiTick?.(); },
    })));
  }
  buildTabs();
  onLocaleChange(() => { buildTabs(); render(); });
  tabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const ids = Object.keys(pages);
    let index = ids.indexOf(active);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = ids.length - 1;
    else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    active = ids[index];
    render();
    tabs.children[index].focus();
  });

  root.append(tabs, content);
  render();
  return root;
}
