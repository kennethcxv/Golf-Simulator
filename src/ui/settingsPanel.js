import { QUALITY_PRESETS } from '../core/preferences.js';
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
    return section('Audio', 'Each category is mixed through one lifecycle-safe audio graph.',
      mute,
      slider('Master volume', 'Overall game volume.', 'audio.master'),
      slider('Effects volume', 'Tools, doors, products, checkout, and movement feedback.', 'audio.effects'),
      slider('Ambience volume', 'Weather, course life, and clubhouse atmosphere.', 'audio.ambience'),
      slider('Interface volume', 'Menu navigation, confirmations, errors, and notifications.', 'audio.ui'),
    );
  }

  function cameraPage() {
    return section('Camera', 'Changes apply immediately and are restored on every mode transition.',
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
    const page = section('Display', 'Visual settings change real renderer features; unsupported toggles are intentionally omitted.',
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
    return section('Accessibility', 'Critical state is paired with text and symbols; no setting depends on color alone.',
      toggle('Reduced motion', 'Removes menu animation, camera bob, tool sway, and eased focus transitions.', 'accessibility.reducedMotion'),
      toggle('High-contrast interface', 'Strengthens panel, focus, prompt, and status boundaries.', 'accessibility.highContrast'),
      choice('Sustained tool use', 'Choose whether cleaning and maintenance tools run while held or toggle on each press.', 'accessibility.toolActivation', [
        ['hold', 'Hold button'], ['toggle', 'Press to toggle'],
      ]),
      tutorialControls,
    );
  }

  const pages = {
    audio: audioPage,
    camera: cameraPage,
    display: displayPage,
    accessibility: accessibilityPage,
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

  for (const [id, label] of [['audio', 'Audio'], ['camera', 'Camera'], ['display', 'Display'], ['accessibility', 'Accessibility']]) {
    tabs.append(el('button', {
      type: 'button', role: 'tab', class: 'settings-tab', text: label, 'data-page': id,
      onclick: () => { active = id; render(); audio?.uiTick?.(); },
    }));
  }
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
