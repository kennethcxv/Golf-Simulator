// Production main menu: real save state, safe destructive actions, keyboard
// ownership, and an original abstract clubhouse-restoration backdrop.

import { formatMoney } from '../core/utils.js';
import { inspectData, summarizeSave } from '../core/storage.js';
import { EMPIRE_VERSION } from '../sim/empire.js';
import { SAVE_VERSION } from '../sim/state.js';
import { confirmDialog, el, modal, notify } from '../ui/ui.js';
import { devSessionActive } from '../data/clubhouseVariant.js';

const SLOTS = ['slot1', 'slot2', 'slot3'];
const LIMITS = { empireVersion: EMPIRE_VERSION, saveVersion: SAVE_VERSION };

function summaryLine(summary) {
  if (!summary) return 'No save details available';
  return `${summary.propertyName} · Day ${summary.day}, ${summary.clock} · ${formatMoney(summary.cash)}`;
}

function savedWhen(summary) {
  if (!summary?.savedAt) return 'Save time not recorded';
  return `Saved ${new Date(summary.savedAt).toLocaleString()}`;
}

export function makeMenu(handlers) {
  let autosaveRecord = { status: 'missing', data: null };
  let refreshToken = 0;

  const continueBtn = el('button', {
    class: 'menu-action menu-action-primary',
    type: 'button',
    disabled: true,
    onclick: async () => {
      if (!['ok', 'recovered'].includes(autosaveRecord.status)) return;
      continueBtn.disabled = true;
      continueBtn.classList.add('is-busy');
      try {
        await handlers.onContinue(autosaveRecord.data, autosaveRecord.status);
      } catch (error) {
        continueBtn.disabled = false;
        notify({
          message: 'The save was read, but the club could not be opened. Try a manual slot or start a new game.',
          category: 'invalid',
          persistent: true,
          dedupeKey: 'continue-boot-failed',
        });
        console.error('continue failed', error);
      } finally {
        continueBtn.classList.remove('is-busy');
      }
    },
  },
  el('span', { class: 'menu-action-label', text: 'Continue' }),
  el('span', { class: 'menu-action-detail', text: 'Checking for a restoration…' }));

  const saveState = el('div', { class: 'menu-save-state', role: 'status', 'aria-live': 'polite' },
    el('div', { class: 'menu-save-kicker', text: 'Current restoration' }),
    el('div', { class: 'menu-save-title', text: 'Checking saves…' }),
    el('div', { class: 'menu-save-detail', text: '' }),
  );

  const loadBtn = el('button', {
    class: 'menu-action', type: 'button', disabled: true,
    onclick: () => openLoadDialog(),
  }, el('span', { class: 'menu-action-label', text: 'Load game' }),
  el('span', { class: 'menu-action-detail', text: 'Choose a manual save slot' }));

  async function beginNewGame(mode) {
    const start = async () => handlers.onNewGame(mode);
    if (autosaveRecord.status === 'missing') {
      await start();
      return;
    }
    confirmDialog({
      title: 'Replace current autosave?',
      message: `Start a new ${mode === 'relaxed' ? 'Relaxed' : 'Realistic'} empire?`,
      detail: 'Your current Continue save will move to its backup. Manual save slots are not deleted.',
      confirmLabel: 'Start new game',
      danger: true,
      onConfirm: start,
    });
  }

  function openNewGameDialog() {
    modal('New game', (box, close) => {
      const children = [
        el('p', { class: 'dialog-message', text: 'Choose how demanding the restoration business should be.' }),
        autosaveRecord.status !== 'missing'
          ? el('div', { class: 'dialog-warning', text: 'Starting will replace the current Continue autosave. Manual slots remain safe.' })
          : null,
        el('div', { class: 'difficulty-grid' },
          el('button', {
            class: 'difficulty-card', type: 'button',
            onclick: () => { close(); beginNewGame('relaxed'); },
          },
          el('span', { class: 'difficulty-name', text: 'Relaxed' }),
          el('span', { class: 'difficulty-detail', text: 'Forgiving turf, softer finances, and simplified recovery.' })),
          el('button', {
            class: 'difficulty-card', type: 'button',
            onclick: () => { close(); beginNewGame('realistic'); },
          },
          el('span', { class: 'difficulty-name', text: 'Realistic' }),
          el('span', { class: 'difficulty-detail', text: 'Tighter margins, full maintenance pressure, and manual cash handling.' })),
        ),
        el('div', { class: 'dialog-actions' },
          el('button', { type: 'button', text: 'Cancel', onclick: close }),
        ),
      ];
      box.append(...children.filter(Boolean));
    }, { className: 'menu-dialog', dismissOnBackdrop: false, initialFocus: '.difficulty-card' });
  }

  function recordLabel(record, summary) {
    if (record.status === 'missing') return { title: 'Empty', detail: 'No save in this slot.', usable: false };
    if (record.status === 'corrupt') return { title: 'Unreadable save', detail: 'This slot is damaged. It will not be loaded.', usable: false };
    if (record.status === 'unsupported') return { title: 'Created by a newer version', detail: `Save version ${record.version} is not supported by this build.`, usable: false };
    return {
      title: summary?.clubName || 'Saved restoration',
      detail: `${summaryLine(summary)} · ${savedWhen(summary)}${record.status === 'recovered' ? ' · backup recovered' : ''}`,
      usable: true,
    };
  }

  function openLoadDialog() {
    modal('Load game', (box, close) => {
      box.classList.add('wide');
      const list = el('div', { class: 'save-slot-list', 'aria-busy': 'true' });
      box.append(
        el('p', { class: 'dialog-message', text: 'Loading replaces the current unsaved moment. Autosave and manual slots remain on disk.' }),
        list,
        el('div', { class: 'dialog-actions' }, el('button', { type: 'button', text: 'Close', onclick: close })),
      );
      Promise.all(SLOTS.map(async (slot, index) => {
        const [record, meta] = await Promise.all([inspectData(slot, LIMITS), inspectData(`${slot}-meta`)]);
        const summary = record.data ? summarizeSave(record.data, meta.data) : null;
        return { slot, index, record, label: recordLabel(record, summary) };
      })).then((rows) => {
        list.setAttribute('aria-busy', 'false');
        list.replaceChildren(...rows.map(({ slot, index, record, label }) => el('div', { class: 'save-slot-row' },
          el('div', { class: 'save-slot-number', text: String(index + 1).padStart(2, '0') }),
          el('div', { class: 'save-slot-copy' },
            el('div', { class: 'save-slot-title', text: label.title }),
            el('div', { class: 'save-slot-detail', text: label.detail }),
          ),
          el('button', {
            type: 'button', disabled: !label.usable, text: 'Load',
            onclick: () => confirmDialog({
              title: `Load slot ${index + 1}?`,
              message: label.title,
              detail: 'Any progress since your last save will be lost.',
              confirmLabel: 'Load game',
              onConfirm: async () => { close(); await handlers.onLoad(record.data, slot, record.status); },
            }),
          }),
        )));
      }).catch((error) => {
        list.setAttribute('aria-busy', 'false');
        list.textContent = 'Save slots could not be read. Close this window and try again.';
        console.error('load menu failed', error);
      });
    }, { className: 'menu-dialog', initialFocus: '.dialog-actions button' });
  }

  function openCredits() {
    modal('Credits', (box, close) => {
      box.append(
        el('div', { class: 'credits-mark', text: 'GOLF EMPIRE' }),
        el('p', { class: 'dialog-message', text: 'A golf-club restoration and management simulator by Prime Fairways.' }),
        el('p', { class: 'dialog-detail', text: 'Built with original code, procedural presentation, and Three.js. No third-party visual assets were added by this player-experience pass.' }),
        el('div', { class: 'dialog-actions' }, el('button', { class: 'primary', type: 'button', text: 'Back', onclick: close })),
      );
    }, { className: 'menu-dialog', initialFocus: '.dialog-actions button' });
  }

  function quit() {
    confirmDialog({
      title: 'Quit Golf Empire?',
      message: 'Return to your desktop?',
      detail: 'Only completed saves are kept from the main menu.',
      confirmLabel: 'Quit game',
      danger: true,
      onConfirm: () => handlers.onQuit?.(),
    });
  }

  const actionList = el('nav', { class: 'menu-actions', 'aria-label': 'Main menu' },
    continueBtn,
    el('button', { class: 'menu-action', type: 'button', onclick: openNewGameDialog },
      el('span', { class: 'menu-action-label', text: 'New game' }),
      el('span', { class: 'menu-action-detail', text: 'Choose Relaxed or Realistic mode' })),
    loadBtn,
    el('button', { class: 'menu-action', type: 'button', onclick: handlers.onSettings },
      el('span', { class: 'menu-action-label', text: 'Settings' }),
      el('span', { class: 'menu-action-detail', text: 'Audio, camera, display, and accessibility' })),
    el('button', { class: 'menu-action', type: 'button', onclick: openCredits },
      el('span', { class: 'menu-action-label', text: 'Credits' })),
    window.fairwayNative?.quit ? el('button', { class: 'menu-action', type: 'button', onclick: quit },
      el('span', { class: 'menu-action-label', text: 'Quit' })) : null,
    // Dev/QA entry point: boots straight into the maintenance-shed test scene
    // (its own save keys — never touches a real player's autosave or slots).
    //
    // GATED, 2026-08-07: the Section A verifier found this on the SHIPPING main
    // menu with no gate at all, one row below Quit. A player launching the game
    // was one click from a developer test scene. It now appears only in a dev
    // session, which is the same test every other dev affordance in this
    // codebase already uses.
    devSessionActive() ? el('button', {
      class: 'menu-action', type: 'button',
      onclick: () => { location.search = '?scene=shed'; },
    },
    el('span', { class: 'menu-action-label', text: 'Test scene: Maintenance Shed' })) : null,
  );
  actionList.addEventListener('keydown', (event) => {
    const actions = [...actionList.querySelectorAll('.menu-action:not([disabled])')];
    if (!actions.length) return;
    const current = actions.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown') next = actions[(Math.max(0, current) + 1) % actions.length];
    else if (event.key === 'ArrowUp') next = actions[(current <= 0 ? actions.length : current) - 1];
    else if (event.key === 'Home') next = actions[0];
    else if (event.key === 'End') next = actions.at(-1);
    else if (event.key === 'Tab' && !event.shiftKey && document.activeElement === actions.at(-1)) next = actions[0];
    else if (event.key === 'Tab' && event.shiftKey && document.activeElement === actions[0]) next = actions.at(-1);
    if (!next) return;
    event.preventDefault();
    next.focus();
  });

  const root = el('main', { class: 'menu-screen', 'aria-label': 'Golf Empire main menu' },
    el('div', { class: 'menu-atmosphere', 'aria-hidden': 'true' },
      el('div', { class: 'menu-sun' }),
      el('div', { class: 'menu-horizon menu-horizon-far' }),
      el('div', { class: 'menu-horizon menu-horizon-near' }),
      el('div', { class: 'menu-clubhouse' },
        el('div', { class: 'menu-clubhouse-roof' }),
        el('div', { class: 'menu-clubhouse-body' }),
        el('div', { class: 'menu-clubhouse-door' }),
      ),
      el('div', { class: 'menu-flag' }, el('span'), el('i')),
    ),
    el('section', { class: 'menu-brand-block' },
      el('div', { class: 'menu-eyebrow', text: 'Club restoration & management' }),
      el('h1', {}, 'GOLF ', el('span', { text: 'EMPIRE' })),
      el('div', { class: 'menu-rule' }),
      el('p', { class: 'tagline', text: 'Buy them broken. Bring them back. Build a club worth keeping.' }),
      saveState,
    ),
    actionList,
    el('footer', { class: 'menu-footer' },
      el('span', { text: 'WASD / Mouse in game' }),
      el('span', { 'aria-hidden': 'true', text: '•' }),
      el('span', { text: 'Tab and arrow keys navigate menus' }),
    ),
  );

  async function refresh() {
    const token = ++refreshToken;
    continueBtn.disabled = true;
    loadBtn.disabled = true;
    saveState.setAttribute('aria-busy', 'true');
    try {
      const [record, meta, ...slots] = await Promise.all([
        inspectData('autosave', LIMITS),
        inspectData('autosave-meta'),
        ...SLOTS.map((slot) => inspectData(slot, LIMITS)),
      ]);
      if (token !== refreshToken) return;
      autosaveRecord = record;
      const summary = record.data ? summarizeSave(record.data, meta.data) : null;
      const title = saveState.querySelector('.menu-save-title');
      const detail = saveState.querySelector('.menu-save-detail');
      const actionDetail = continueBtn.querySelector('.menu-action-detail');
      if (record.status === 'ok' || record.status === 'recovered') {
        title.textContent = summary?.clubName || 'Restoration in progress';
        detail.textContent = `${summaryLine(summary)} · ${savedWhen(summary)}${record.status === 'recovered' ? ' · previous backup recovered' : ''}`;
        saveState.dataset.state = record.status === 'recovered' ? 'warning' : 'ready';
        actionDetail.textContent = summary ? `${summary.propertyName} · Day ${summary.day}` : 'Resume restoration';
        continueBtn.disabled = false;
      } else if (record.status === 'corrupt') {
        title.textContent = 'Continue save is unreadable';
        detail.textContent = 'Try a manual slot. Starting a new game will preserve the damaged copy as a backup.';
        actionDetail.textContent = 'Autosave needs attention';
        saveState.dataset.state = 'error';
      } else if (record.status === 'unsupported') {
        title.textContent = 'Save created by a newer version';
        detail.textContent = `This build cannot open save version ${record.version}. Update the game before continuing.`;
        actionDetail.textContent = 'Game update required';
        saveState.dataset.state = 'warning';
      } else {
        title.textContent = 'No active restoration';
        detail.textContent = 'Start with a distressed property and make the clubhouse yours.';
        actionDetail.textContent = 'No Continue save yet';
        saveState.dataset.state = 'empty';
      }
      loadBtn.disabled = !slots.some((slot) => slot.status === 'ok' || slot.status === 'recovered');
    } catch (error) {
      if (token !== refreshToken) return;
      autosaveRecord = { status: 'corrupt', data: null };
      saveState.querySelector('.menu-save-title').textContent = 'Saves could not be checked';
      saveState.querySelector('.menu-save-detail').textContent = 'The game can still open Settings or start a new restoration.';
      saveState.dataset.state = 'error';
      console.error('menu save refresh failed', error);
    } finally {
      if (token === refreshToken) saveState.setAttribute('aria-busy', 'false');
    }
  }

  // H1 (Goal 20) — THE MAIN MENU HAD NO SOUND AT ALL.
  //
  // Not a quiet one: this file contained zero audio references, so every press
  // on New Game, Settings, Load and Quit was silent, and a silent button is
  // indistinguishable from a broken one. The stranger verifier reached the same
  // conclusion from the other end.
  //
  // ONE delegated capture-phase listener rather than a sound on each of the
  // twelve onclick sites, because the menu's dialogs (new game, load, credits,
  // the delete confirmation) build their own buttons and every one of them
  // needs to speak too. pointerdown, not click, so the sound lands with the
  // press the way the in-game button factory already does.
  //
  // audio.init() is called first: the context can only be created from a user
  // gesture, and this IS the first gesture of the session, so without it the
  // very click that should make the first sound is the one that cannot.
  const audio = handlers.audio || null;
  const pressSound = (event) => {
    const target = event.target?.closest?.('button');
    if (!target || target.disabled) return;
    audio?.init?.();
    if (target.classList.contains('menu-action-primary')) audio?.uiConfirm?.();
    else audio?.uiTick?.();
  };
  const hoverSound = (event) => {
    const target = event.target?.closest?.('button');
    if (!target || target.disabled || !audio?.ready) return;
    audio.uiTick();
  };

  // A2 (Goal 22) — THE MENU WAS SILENT BECAUSE THIS LINE NEVER RAN.
  //
  // The press handler above is correct and was correct when H1 shipped it. It
  // was attached in exactly one place: inside setVisible(true). And the menu is
  // BORN VISIBLE — `root` carries no display:none, main.js appends it at
  // uiRoot.append(menu.root, gameUi), and the only setVisible calls on the boot
  // path are setVisible(FALSE) for the shed scope. setVisible(true) exists for
  // RETURNING to the menu from a game. So on the one path every player takes,
  // launching the game, the listener was never installed and every button was
  // silent.
  //
  // The check that certified this was four regexes over the text of this file
  // (tests/menu-sound.test.js). One of them asserts this very
  // addEventListener line exists. It does exist. It never ran. A test that
  // reads the source cannot ask what the source does.
  //
  // Attaching here, at construction, matches the element's own initial state.
  // setVisible removes before it adds, so this cannot double-subscribe.
  document.addEventListener('pointerdown', pressSound, true);
  root.addEventListener('pointerover', hoverSound);

  function setVisible(visible) {
    root.style.display = visible ? '' : 'none';
    root.setAttribute('aria-hidden', String(!visible));
    // listeners live only while the menu is up, so nothing in the game world
    // ever ticks because a menu handler was left attached to the document
    document.removeEventListener('pointerdown', pressSound, true);
    root.removeEventListener('pointerover', hoverSound);
    if (visible) {
      document.addEventListener('pointerdown', pressSound, true);
      root.addEventListener('pointerover', hoverSound);
    }
    if (visible) {
      refresh().then(() => {
        const target = continueBtn.disabled ? actionList.querySelector('button:not([disabled])') : continueBtn;
        target?.focus();
      });
    }
  }

  refresh();
  return { root, setVisible, refresh };
}
