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
    title: 'Click or Space: pause / resume',
    // F1: "A click on every button, everywhere. If it can be pressed, it makes
    // a sound." This chip was the only silent control among the ten the click
    // audit reached — measured, not assumed: tools/qa/electron-f1-click-audit.js
    // hooks AudioBufferSourceNode/OscillatorNode `start`, so it counts sounds
    // that actually reach the graph rather than calls to the audio module, and
    // it reported `silent: ["hud-chip:Y1 · Spring · Day 1 · 6:02 A"]` with its
    // dead-space control passing.
    //
    // It is a real button doing a substantial thing — cycling game speed — and
    // its own title advertises the press. Silence there is the defect F1 names.
    onclick: () => {
      app.audio?.uiTick?.();
      handlers.setSpeed(app.speedIdx === 0 ? 1 : 0);
    },
  });

  // MODIFIER CHIP — what is holding a modifier, on screen.
  //
  // A phantom modifier has no visible effect until an OS hotkey starts eating
  // keys, so the player experiences it as "D stopped working" with nothing to
  // look at. This is the instrument for that.
  //
  // IT WATCHED THE WRONG QUANTITY UNTIL 2026-07-29. It rendered the walk
  // controller's BELIEF (`heldModifiers`), which is only ever populated by a
  // keydown the page received. In an OS-level strand the shell consumes the
  // keydown before the browser sees anything, so the belief stays empty and the
  // chip stayed hidden through the exact fault it was built to expose. Measured,
  // not deduced: with Windows holding Meta, `osStrandWarnedOnHud: false`.
  //
  // So it now renders the union of what the OS reports and what the walker
  // believes, and tells them apart — because the remedies differ. A page-side
  // phantom clears itself on the next mouse movement. An OS-held modifier cannot
  // be released by any page code at all; only the player tapping the physical
  // key will do it, so that is what the chip says.
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
  let lastRootDisplay = null;
  function update() {
    if (!app.state) return;
    const mode = handlers.getPresentationMode?.() || 'walk';
    const quiet = ['pause', 'laptop', 'register', 'course-editor'].includes(mode);
    // THE ONE UNGUARDED WRITE ON A PATH THAT GUARDS EVERYTHING ELSE.
    //
    // Every textContent write below sits behind a change check, with a comment
    // saying why: "this runs every frame — only touch the DOM when the number
    // actually moved". This line did not, and it is the write with the widest
    // blast radius: assigning to `style.display` on the HUD ROOT dirties style
    // resolution for the whole overlay subtree, every frame, to set it to the
    // value it already had.
    //
    // Measured (tools/qa/electron-a1-hud-cost.js): hiding the entire overlay
    // indoors takes frames over 16.7 ms from 23.3% to 17.0% — the DOM overlay is
    // 6.7 of invariant 1's ~23 points, the largest single cause found, and it
    // costs zero draw calls because the renderer never draws it.
    const wantDisplay = quiet ? 'none' : '';
    if (wantDisplay !== lastRootDisplay) {
      lastRootDisplay = wantDisplay;
      root.style.display = wantDisplay;
    }
    if (quiet) return;
    const cal = calendarOf(app.state.clock.minutes);
    const glyph = ['⏸', '▶'][app.speedIdx] || '▶' || '▶';
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
    let os = [];
    try { held = app.scene3d?.walk?.heldModifiers?.() || []; } catch { held = []; }
    try { os = app.scene3d?.walk?.osModifiers?.() || []; } catch { os = []; }
    const modLine = `${os.join('+')}|${held.join('+')}`;
    if (modLine !== lastModifiers) {
      lastModifiers = modLine;
      const shown = [...new Set([...os, ...held])];
      // Held by the SYSTEM: unreachable from here, and the thing actually eating
      // keys. Takes precedence in the message because it is the one the player
      // has to act on.
      const osStuck = os.filter((m) => UNBOUND_MODIFIERS.includes(m));
      // Believed by the page but not reported by the OS: a phantom, already on
      // its way out — the next mouse movement reconciles it away.
      const pageStuck = held.filter((m) => UNBOUND_MODIFIERS.includes(m) && !os.includes(m));
      modifiers.style.display = shown.length ? '' : 'none';
      modifiers.classList.toggle('stuck', osStuck.length > 0 || pageStuck.length > 0);
      // Named as the consequence and the remedy, not the state: "Meta held" means
      // nothing to a player mid-game; "Windows is holding it, tap it" is an
      // instruction they can follow without leaving the room.
      if (osStuck.length) {
        modifiers.textContent = `⚠ ${osStuck.join(' + ')} held by the system - tap and release it`;
        modifiers.title = `Your operating system reports ${osStuck.join(' and ')} as held down. `
          + 'While it is, the OS takes your keypresses as shortcuts before the game sees them. '
          + 'Nothing in the game can release it - press and release the physical key.';
      } else if (pageStuck.length) {
        modifiers.textContent = `⚠ ${pageStuck.join(' + ')} held - keys may not reach the game`;
        modifiers.title = 'A modifier is down that nothing in the game uses. It should clear as '
          + 'soon as you look around; if it does not, tap and release the key.';
      } else {
        modifiers.textContent = `⇧ ${shown.join(' + ')}`;
        modifiers.title = 'Modifier keys currently held.';
      }
    }
  }

  return { root, update };
}
