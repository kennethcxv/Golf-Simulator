// FAIRWAY STATE — the minimal simulator HUD (2026-07-13 overhaul, style guide
// §"Persistent HUD"): two small corner chips — money, and clock+speed — and
// nothing else permanent. Management lives in the world now: the laptop, the
// register, the wall map, the desks' hotkeys, and the Esc office menu. The
// old top strip and Manage dock are gone; their re-homing map is in DEV_LOG.

import { el } from './ui.js';
import { calendarOf, formatClock, formatDate } from '../sim/time.js';
import { formatMoney } from '../core/utils.js';
import { BALANCE } from '../sim/balance.js';

export function makeHud(app, handlers) {
  const cash = el('div', { class: 'hud-chip hud-cash', text: '' });

  // the clock chip doubles as the one mouse affordance for time: click cycles
  // pause → 1× → 4× → 16× (Space and 1/2/3 remain the fast path)
  const clock = el('button', {
    class: 'hud-chip hud-clock',
    title: 'Click: cycle speed · Space: pause · 1/2/3: speeds',
    onclick: () => handlers.setSpeed((app.speedIdx + 1) % BALANCE.speeds.length),
  });

  const root = el('div', { class: 'hud-min' }, cash, clock);

  let last = '';
  function update() {
    if (!app.state) return;
    const cal = calendarOf(app.state.clock.minutes);
    const glyph = ['⏸', '▶', '▶▶', '▶▶▶'][app.speedIdx] || '▶';
    const line = `${formatDate(cal)} · ${formatClock(cal.minuteOfDay)} ${glyph}`;
    if (line !== last) {
      last = line;
      clock.textContent = line;
      clock.classList.toggle('paused', app.speedIdx === 0);
    }
    cash.textContent = formatMoney(app.empire ? app.empire.cash : app.state.cash);
  }

  return { root, update };
}
