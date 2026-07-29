// FAIRWAY STATE — the minimal simulator HUD (2026-07-13 overhaul, style guide
// §"Persistent HUD"): two small corner chips — money, and clock+speed — and
// nothing else permanent. Management lives in the world now: the laptop, the
// register, the wall map, the desks' hotkeys, and the Esc office menu. The
// old top strip and Manage dock are gone; their re-homing map is in DEV_LOG.

import { el } from './ui.js';
import { calendarOf, formatClock, formatDate } from '../sim/time.js';
import { formatMoney } from '../core/utils.js';
import { BALANCE } from '../sim/balance.js';
import { skuById } from '../data/shopItems.js';
import { CLEANING_TOOLS } from '../data/cleaningTools.js';

export function makeHud(app, handlers) {
  const cash = el('div', { class: 'hud-chip hud-cash', text: '' });

  // the clock chip doubles as the one mouse affordance for time: click cycles
  // pause → 1× → 4× → 16× (Space and 1/2/3 remain the fast path)
  const clock = el('button', {
    class: 'hud-chip hud-clock',
    title: 'Click: cycle speed · Space: pause · 1/2/3: speeds',
    onclick: () => handlers.setSpeed((app.speedIdx + 1) % BALANCE.speeds.length),
  });

  // MODIFIER CHIP — the walk controller's held-modifier belief, on screen.
  //
  // A phantom modifier has no visible effect until an OS hotkey starts eating
  // keys, so the player experiences it as "D stopped working" with nothing to
  // look at. This is the missing instrument: whatever the walker thinks is held,
  // you can see.
  //
  // Shift is shown plainly because holding it to run is normal and a chip that
  // lights up every sprint would train you to ignore it. Ctrl, Alt and Meta are
  // shown as an alert because the walker binds none of them — any of the three
  // being down is, by itself, the fault.
  const modifiers = el('div', { class: 'hud-chip hud-modifiers', style: 'display:none' });

  const contextIcon = el('span', { class: 'hud-context-icon', 'aria-hidden': 'true' });
  const contextTitle = el('span', { class: 'hud-context-title' });
  const contextDetail = el('span', { class: 'hud-context-detail' });
  const context = el('div', { class: 'hud-context', style: 'display:none' },
    contextIcon,
    el('span', { class: 'hud-context-copy' }, contextTitle, contextDetail),
  );
  const root = el('div', { class: 'hud-min' }, cash, clock, modifiers, context);

  // Nothing in the walker uses these three, so believing one is down is the bug
  // rather than a state the bug produces.
  const UNBOUND_MODIFIERS = ['Control', 'Alt', 'AltGraph', 'Meta'];

  let lastClock = '';
  let lastCash = '';
  let lastContext = '';
  let lastModifiers = '';
  function update() {
    if (!app.state) return;
    const mode = handlers.getPresentationMode?.() || 'walk';
    const quiet = ['pause', 'laptop', 'register', 'course-editor'].includes(mode);
    root.style.display = quiet ? 'none' : '';
    if (quiet) return;
    const cal = calendarOf(app.state.clock.minutes);
    const glyph = ['⏸', '▶', '▶▶', '▶▶▶'][app.speedIdx] || '▶';
    const line = `${formatDate(cal)} · ${formatClock(cal.minuteOfDay)} ${glyph}`;
    if (line !== lastClock) {
      lastClock = line;
      clock.textContent = line;
      clock.classList.toggle('paused', app.speedIdx === 0);
    }
    // this runs every frame — only touch the DOM when the number actually moved
    const cashLine = formatMoney(Number.isFinite(app.state?.cash) ? app.state.cash : app.empire?.cash || 0);
    if (cashLine !== lastCash) {
      lastCash = cashLine;
      cash.textContent = cashLine;
    }

    let held = [];
    try { held = app.scene3d?.walk?.heldModifiers?.() || []; } catch { held = []; }
    const modLine = held.join('+');
    if (modLine !== lastModifiers) {
      lastModifiers = modLine;
      const stuck = held.filter((m) => UNBOUND_MODIFIERS.includes(m));
      modifiers.style.display = held.length ? '' : 'none';
      modifiers.classList.toggle('stuck', stuck.length > 0);
      modifiers.textContent = stuck.length
        // Named as the consequence, not the state: "Meta held" means nothing to a
        // player, "keys may not reach the game" is the thing they are seeing.
        ? `⚠ ${stuck.join(' + ')} held — keys may not reach the game`
        : `⇧ ${held.join(' + ')}`;
      modifiers.title = stuck.length
        ? 'A modifier is down that nothing in the game uses. Tap and release it, or click the '
          + 'game window, to clear it.'
        : 'Modifier keys the game currently sees as held.';
    }
  }

  return { root, update };
}
