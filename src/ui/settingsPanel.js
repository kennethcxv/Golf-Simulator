import { QUALITY_PRESETS, QUALITY_PRESET_NOTES, RESOLUTION_PRESETS } from '../core/preferences.js';
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
        message: t('settings.error.save'),
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

  // PLAYTEST 3, ITEM 4 — THE BACKGROUND TRACK, IN *PLAYER* SETTINGS.
  //
  // "Several options changeable in SETTINGS — player settings, not dev — plus an
  // off switch." The sound-effect auditions are a development question and live
  // on the Developer tab; which music plays is a taste a player has every time
  // they sit down, so it belongs here beside the volume sliders.
  function musicTrackRow() {
    const fam = (audio?.sfxFamilies?.() || []).find((f) => f.family === 'music');
    if (!fam || !fam.options.length) return null;
    const path = 'audio.musicTrack';
    const applyTrack = (value) => {
      set(path, value);
      if (value === 'off') { audio?.musicStop?.(); return; }
      audio?.sfxSetFamilyOption?.('music', value || null);
      // Restart so the change is heard NOW rather than at the end of a loop that
      // may be two minutes long -- a music picker you have to wait out is one the
      // player assumes is broken.
      audio?.musicStop?.();
      audio?.musicStart?.();
    };
    const select = el('select', {
      'aria-label': t('settings.audio.music'),
      onchange: (event) => applyTrack(event.currentTarget.value),
    },
    el('option', { value: '', text: t('settings.audio.music.default'), selected: preferences.get(path) ? null : true }),
    ...fam.options.map((o) => el('option', {
      value: o.id, text: o.label, selected: preferences.get(path) === o.id ? true : null,
    })),
    el('option', { value: 'off', text: t('settings.audio.music.off'), selected: preferences.get(path) === 'off' ? true : null }));
    return row(t('settings.audio.music'), t('settings.audio.music.detail'), select);
  }

  function audioPage() {
    const mute = toggle(t('settings.audio.mute'), t('settings.audio.mute.detail'), 'audio.muted', { on: t('settings.audio.mute.on'), off: t('settings.audio.mute.off') });
    return section(t('settings.audio.title'), t('settings.audio.intro'),
      mute,
      slider(t('settings.audio.master'), t('settings.audio.master.detail'), 'audio.master'),
      slider(t('settings.audio.effects'), t('settings.audio.effects.detail'), 'audio.effects'),
      slider(t('settings.audio.ambience'), t('settings.audio.ambience.detail'), 'audio.ambience'),
      slider(t('settings.audio.ui'), t('settings.audio.ui.detail'), 'audio.ui'),
      musicTrackRow(),
    );
  }

  function cameraPage() {
    return section(t('settings.camera.title'), t('settings.camera.intro'),
      slider(t('settings.camera.sensitivity'), t('settings.camera.sensitivity.detail'), 'camera.sensitivity', {
        min: 0.35, max: 2.5, step: 0.05, format: (value) => Number(value).toFixed(2),
      }),
      toggle(t('settings.camera.invert'), t('settings.camera.invert.detail'), 'camera.invertY', { on: t('settings.camera.invert.on'), off: t('settings.camera.invert.off') }),
      slider(t('settings.camera.fov'), t('settings.camera.fov.detail'), 'camera.fov', {
        min: 50, max: 90, step: 1, format: (value) => `${Math.round(value)}°`,
      }),
      toggle(t('settings.camera.bob'), t('settings.camera.bob.detail'), 'camera.bob', { on: t('settings.camera.bob.on'), off: t('settings.camera.bob.off') }),
    );
  }

  function nativeDisplayRows(container) {
    const native = window.fairwayNative;
    if (!native?.displayInfo || !native?.setWindowMode || !native?.setResolution) return;
    const status = el('div', { class: 'setting-native-status', role: 'status', text: t('settings.display.reading') });
    container.append(status);
    native.displayInfo().then((info) => {
      status.replaceChildren();
      const mode = el('select', {
        'aria-label': t('settings.display.windowMode'),
        onchange: async (event) => {
          try {
            await native.setWindowMode(event.currentTarget.value);
            status.dataset.state = 'ready';
          } catch (error) {
            notify({ message: t('settings.error.windowMode'), category: 'invalid' });
            console.error('window mode change failed', error);
          }
        },
      },
      el('option', { value: 'windowed', text: 'Windowed', selected: info.mode === 'windowed' ? true : null }),
      el('option', { value: 'fullscreen', text: 'Fullscreen', selected: info.mode === 'fullscreen' ? true : null }));
      const resolutions = info.resolutions || [];
      const resolution = el('select', {
        'aria-label': t('settings.display.resolution'),
        disabled: info.mode === 'fullscreen' ? true : null,
        onchange: async (event) => {
          const [width, height] = event.currentTarget.value.split('x').map(Number);
          try {
            await native.setResolution(width, height);
          } catch (error) {
            notify({ message: t('settings.error.resolution'), category: 'invalid' });
            console.error('resolution change failed', error);
          }
        },
      }, ...resolutions.map(({ width, height, label, fits }) => el('option', {
        value: `${width}x${height}`,
        // A size the display cannot show is listed and greyed, with the reason,
        // rather than omitted — an absent 4K reads as a missing feature.
        text: `${width} × ${height}${label ? ` (${label})` : ''}${fits === false ? ' - larger than this display' : ''}`,
        disabled: fits === false ? true : null,
        selected: width === info.width && height === info.height ? true : null,
      })));
      mode.addEventListener('change', () => { resolution.disabled = mode.value === 'fullscreen'; });
      const area = info.workArea
        ? `This display has room for ${info.workArea.width} × ${info.workArea.height}.`
        : '';
      status.append(
        row(t('settings.display.windowMode'), t('settings.display.windowMode.detail'), mode),
        row(t('settings.display.resolution'), `${t('settings.display.resolution.detail')} ${area}`.trim(), resolution),
      );
    }).catch((error) => {
      status.textContent = 'Native display controls are unavailable in this session.';
      console.error('display info failed', error);
    });
  }

  function displayPage() {
    const quality = el('select', {
      'aria-label': t('settings.display.quality'),
      onchange: (event) => {
        const preset = QUALITY_PRESETS[event.currentTarget.value];
        if (!preset) return;
        update({ display: preset });
        // THE ROWS BELOW WERE LYING (Section A verifier, 2026-08-07). Every
        // slider and toggle on this page is built ONCE from preferences at
        // construction time, so choosing a preset changed the values and left
        // the controls showing the previous ones: pick Low and the rows still
        // read 100%/On/On/On; pick Ultra and they read Low's 65%/Off/Off/Off.
        // The preferences were always correct - the drawing buffer proves it -
        // which is worse, because the panel was contradicting the game while
        // being wrong about itself.
        //
        // Re-rendering the page is what makes the controls read the values that
        // were just applied. Deferred a frame so the change event finishes
        // before the element it fired on is replaced.
        requestAnimationFrame(() => render());
      },
    }, ...[
      ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom'],
    ].map(([value, text]) => el('option', {
      value, text, selected: preferences.values.display.quality === value ? true : null,
      disabled: value === 'custom' ? true : null,
    })));
    // E2: a preset that does not say what it does is a preset nobody dares move.
    // The line comes from QUALITY_PRESET_NOTES so it cannot drift from the values.
    const qualityNote = el('p', {
      class: 'settings-note',
      text: QUALITY_PRESET_NOTES[preferences.values.display.quality] || 'Your own mix of the settings below.',
    });
    quality.addEventListener('change', () => {
      qualityNote.textContent = QUALITY_PRESET_NOTES[quality.value] || 'Your own mix of the settings below.';
    });
    const shadowQuality = el('select', {
      'aria-label': 'Shadow quality',
      onchange: (event) => set('display.shadowQuality', event.currentTarget.value),
    }, ...[
      ['off', 'Off'], ['low', 'Low - 1024, 5 per second'],
      ['medium', 'Medium - 2048, 10 per second'], ['high', 'High - 4096, 16 per second'],
    ].map(([value, text]) => el('option', {
      value, text, selected: preferences.values.display.shadowQuality === value ? true : null,
    })));
    // A1 (Goal 18): select values are strings, so the cap converts back to a
    // number here — oneOf() in preferences would silently reject "120" and the
    // row would appear to do nothing.
    const fpsCap = el('select', {
      'aria-label': t('settings.display.fpsCap'),
      onchange: (event) => set('display.fpsCap', Number(event.currentTarget.value)),
    }, ...[
      [60, t('settings.display.fpsCap.default60')], [120, '120'], [144, '144'], [240, '240'],
      [0, t('settings.display.fpsCap.uncapped')],
    ].map(([value, text]) => el('option', {
      value: String(value), text, selected: preferences.values.display.fpsCap === value ? true : null,
    })));
    const page = section(t('settings.display.title'), t('settings.display.intro'),
      row(t('settings.display.qualityRow'), t('settings.display.quality.detail'), quality),
      qualityNote,
      row(t('settings.display.fpsCap'), t('settings.display.fpsCap.detail'), fpsCap),
      slider(t('settings.display.renderScale'), t('settings.display.renderScale.detail'), 'display.renderScale', {
        min: 0.65, max: 1.35, step: 0.05, format: pct,
      }),
      toggle(t('settings.display.ao'), t('settings.display.ao.detail'), 'display.ambientOcclusion'),
      toggle(t('settings.display.bloom'), t('settings.display.bloom.detail'), 'display.bloom'),
      toggle(t('settings.display.shadows'), t('settings.display.shadows.detail'), 'display.shadows'),
      row(t('settings.display.shadowDetail'), t('settings.display.shadowDetail.detail'), shadowQuality),
      slider(t('settings.display.uiScale'), t('settings.display.uiScale.detail'), 'display.uiScale', {
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
        // E5: an unbound action says so. describeKey renders '?' for nothing,
        // which reads like a rendering fault rather than a job to do.
        const bound = bindingsNow()[actionId];
        button.textContent = bound ? describeKey(bound) : 'Needs a key';
        button.classList.toggle('is-unbound', !bound);
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
        const holder = Object.entries(next)
          .find(([otherId, otherKey]) => otherKey === key && otherId !== action.id)?.[0];
        next[action.id] = key;
        // E5 — TAKING A KEY SAYS SO, AND THE OLD OWNER LOSES IT.
        //
        // This used to SWAP: the displaced action silently inherited whatever
        // key you were replacing. That is worse than a conflict, because two
        // bindings change on one keystroke and only one of them was asked for —
        // a player rebinding Run to Shift would find Crouch had quietly moved to
        // Ctrl and have no idea why. The key goes to the action being bound, the
        // old owner is left UNBOUND, and the screen says which one and that it
        // now needs a key.
        if (holder) next[holder] = '';
        stopCapture();
        set('controls.bindings', next);
        if (holder) {
          notify({
            message: `${describeKey(key)} was ${actionLabel(holder)}. It is ${actionLabel(action.id)} now, and ${actionLabel(holder)} has no key.`,
            category: 'binding-taken',
            dedupeKey: `binding-taken-${holder}`,
          });
        }
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
    rows.push(row(t('settings.controls.resetRow'), t('settings.controls.reset.detail'), el('button', {
      type: 'button',
      text: t('settings.reset.button'),
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
      ? row(t('settings.tutorials.title'), t('settings.tutorials.detail'),
        el('div', { class: 'setting-inline' },
          onResetTutorials ? el('button', {
            type: 'button', text: t('settings.tutorials.reset'), onclick: () => { onResetTutorials(); audio?.uiTick?.(); },
          }) : null,
          tutorialEnabled && onDisableTutorials ? el('button', {
            type: 'button', text: t('settings.tutorials.disable'), onclick: () => { onDisableTutorials(); audio?.uiTick?.(); },
          }) : null,
        ))
      : null;
    return section(t('settings.accessibility.title'), t('settings.accessibility.intro'),
      toggle(t('settings.accessibility.reducedMotion'), t('settings.accessibility.reducedMotion.detail'), 'accessibility.reducedMotion'),
      toggle(t('settings.accessibility.highContrast'), t('settings.accessibility.highContrast.detail'), 'accessibility.highContrast'),
      choice(t('settings.accessibility.toolActivation'), t('settings.accessibility.toolActivation.detail'), 'accessibility.toolActivation', [
        ['hold', t('settings.accessibility.toolActivation.hold')],
        ['toggle', t('settings.accessibility.toolActivation.toggle')],
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
    }, ...LOCALES.map((entry) => {
      // E3: say what is actually translated. Seven of the ten have no table yet
      // and fall through to English; listing them without saying so would be a
      // menu full of options that quietly do nothing.
      const share = coverage(entry.id);
      const state = share.fraction >= 0.999 ? ''
        : share.fraction <= 0.001 ? ' - not translated yet'
          : ` - ${Math.round(share.fraction * 100)}% translated`;
      return el('option', {
        value: entry.id,
        text: `${entry.endonym}${entry.id === current ? '' : ` (${entry.label})`}${state}`,
        selected: entry.id === current ? true : null,
      });
    }));
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
    'pine-hills': 'Pine Hills - the original room',
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

  // PLAYTEST 3, ITEM 1 — THE SFX AUDITION SWITCHER.
  //
  // "You cannot hear and I can." Everything below exists so a taste call can be
  // made by the person with ears instead of guessed at by the person with a peak
  // meter. Each family offers several genuinely different recordings; the owner
  // switches while the game runs, hears the change immediately, and names the
  // winner by its label.
  const SFX_FAMILIES = ['menuButton', 'drawerOpen', 'cashLand', 'ledgerTurn', 'ledgerPickup', 'ledgerClose'];
  const sfxFamilyLabel = (id) => (SFX_FAMILIES.includes(id) ? t(`settings.sfx.family.${id}`) : id);
  // Which cue to fire when Preview is pressed. A family covers several cues and
  // they are not equally representative -- previewing `uiError` to judge a menu
  // click would have the owner rejecting a sound they will rarely hear.
  const SFX_PREVIEW_CUE = {
    menuButton: 'uiTick',
    drawerOpen: 'drawerOpen',
    cashLand: 'coinDeposit',
    ledgerTurn: 'ledgerTurn',
    ledgerPickup: 'ledgerPickup',
    ledgerClose: 'ledgerClose',
  };

  function sfxAuditionRows() {
    const families = (audio?.sfxFamilies?.() || []).filter((f) => f.family !== 'music');
    if (!families.length) {
      // Said out loud rather than rendered as an empty panel. The bank is built
      // when the audio context unlocks, so before the first click there is
      // genuinely nothing to list -- and a blank picker looks like a broken one.
      return [el('div', { class: 'setting-native-status', role: 'status' },
        description(t('settings.sfx.none')))];
    }
    const saved = preferences.get('audio.sfx') || {};
    return families.map((fam) => {
      const label = sfxFamilyLabel(fam.family);
      let pending = saved[fam.family] || fam.current || '';
      // Cue preference, then whatever the option actually covers -- an option
      // that does not include the preferred cue must still be auditionable.
      const cueFor = (optionId) => {
        const opt = fam.options.find((o) => o.id === optionId);
        const want = SFX_PREVIEW_CUE[fam.family];
        if (opt && want && opt.cues.includes(want)) return want;
        return opt?.cues?.[0] || want || null;
      };
      const applyPin = (optionId) => {
        // Persisted AND applied. Persisting without applying is a picker that
        // works after a restart; applying without persisting is one that forgets
        // the winner overnight. Both have shipped in this repo before.
        const ok = audio?.sfxSetFamilyOption?.(fam.family, optionId || null);
        set('audio.sfx', { ...(preferences.get('audio.sfx') || {}), [fam.family]: optionId || '' });
        return ok;
      };
      const select = el('select', {
        'aria-label': `${label} sound`,
        onchange: (event) => {
          pending = event.currentTarget.value;
          applyPin(pending);
          // Hear it the instant it changes: the whole point is comparison, and
          // a switch you have to press a second button to hear is one nobody
          // A/Bs more than twice.
          const cue = cueFor(pending);
          if (cue) audio?.sfxPreview?.(fam.family, pending, cue);
        },
      },
      el('option', { value: '', text: t('settings.sfx.default'), selected: pending ? null : true }),
      ...fam.options.map((o) => el('option', {
        value: o.id,
        // The count suffix went through a template literal, which put a raw
        // player-facing format string back into this file -- the one file whose
        // whole job is to be readable in the player's own language. The label
        // itself is DATA (the recording's name, which is how the owner tells me
        // which wins); only the "(3)" around it is prose, and that is what t()
        // now owns.
        text: o.files > 1 ? t('settings.sfx.optionCount', { label: o.label, count: o.files }) : o.label,
        selected: pending === o.id ? true : null,
      })));
      const preview = el('button', {
        type: 'button',
        class: 'setting-toggle',
        text: t('settings.sfx.play'),
        onclick: () => {
          const cue = cueFor(pending);
          if (!cue) return;
          const heard = audio?.sfxPreview?.(fam.family, pending || fam.options[0]?.id, cue);
          // Report rather than shrug: a Play button that does nothing when the
          // bank has not loaded the file is indistinguishable from a sound the
          // owner simply cannot hear over the ambience.
          if (!heard) notify({ message: t('settings.sfx.noRecording', { family: label }), category: 'invalid' });
        },
      });
      return row(label, t('settings.sfx.detail', { count: fam.options.length }),
        el('div', { class: 'setting-inline' }, select, preview));
    });
  }

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
      'aria-label': t('settings.developer.room'),
      onchange: (event) => { pending = event.currentTarget.value; },
    },
    el('option', { value: '', text: VARIANT_LABELS['modern-public'], selected: pending ? null : true }),
    ...SELECTABLE_CLUBHOUSE_VARIANTS.filter((id) => id !== 'modern-public').map((id) => el('option', {
      value: id, text: VARIANT_LABELS[id] || id, selected: pending === id ? true : null,
    })));

    const applyRoom = () => {
      const result = storeClubhouseVariant(pending || null);
      if (!result.ok) {
        notify({ message: t('settings.error.room'), category: 'invalid' });
        return;
      }
      // Every clubhouse datum was frozen at module load, so the room can only change on
      // a fresh load. Reloading is the point of the button rather than a side effect.
      globalThis.location?.reload?.();
    };

    return el('div', {},
      section('Developer', t('settings.developer.intro'),
        status,
        row(t('settings.developer.room'), t('settings.developer.room.detail'), select),
        row(t('settings.developer.apply'), t('settings.developer.apply.detail'),
          el('button', { type: 'button', class: 'primary', text: t('settings.developer.save'), onclick: applyRoom })),
      ),
      section(t('settings.sfx.title'), t('settings.sfx.intro'), ...sfxAuditionRows()),
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

  // E4 — RESET TO DEFAULTS, on every page, with a confirmation. It sits at the
  // foot rather than in one tab because "put it back how it was" is a thought a
  // player has while looking at whatever they just broke, not a thought that
  // sends them hunting for a particular page.
  let confirmingReset = false;
  function resetFooter() {
    const button = el('button', {
      type: 'button',
      class: `setting-reset${confirmingReset ? ' is-confirming' : ''}`,
      text: confirmingReset ? t('settings.reset.confirm') : t('settings.reset.footerButton'),
      onclick: () => {
        if (!confirmingReset) {
          confirmingReset = true;
          render();
          // a confirmation that never expires is a button with two states
          setTimeout(() => { if (confirmingReset) { confirmingReset = false; render(); } }, 4000);
          return;
        }
        confirmingReset = false;
        changed(preferences.reset());
        render();
        notify({ message: t('settings.reset.done'), category: 'settings-reset' });
      },
    });
    return el('div', { class: 'settings-footer' },
      el('div', { class: 'setting-description', text: t('settings.reset.detail') }),
      button);
  }

  function render() {
    for (const button of tabs.children) {
      const selected = button.dataset.page === active;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    content.replaceChildren(pages[active](), resetFooter());
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
