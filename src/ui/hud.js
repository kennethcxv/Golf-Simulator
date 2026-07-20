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

  const contextIcon = el('span', { class: 'hud-context-icon', 'aria-hidden': 'true' });
  const contextTitle = el('span', { class: 'hud-context-title' });
  const contextDetail = el('span', { class: 'hud-context-detail' });
  const context = el('div', { class: 'hud-context', style: 'display:none' },
    contextIcon,
    el('span', { class: 'hud-context-copy' }, contextTitle, contextDetail),
  );
  const root = el('div', { class: 'hud-min' }, cash, clock, context);

  let lastClock = '';
  let lastCash = '';
  let lastContext = '';
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
    const money = formatMoney(app.empire ? app.empire.cash : app.state.cash);
    if (money !== lastCash) {
      lastCash = money;
      cash.textContent = money;
    }

    const walk = app.scene3d?.walk;
    const tool = walk?.getTool?.();
    const carrying = app.state.shop?.carry;
    let title = '';
    let detail = '';
    let icon = '';
    if (carrying?.qty) {
      const sku = skuById(carrying.skuId);
      icon = '□';
      title = `Carrying ${sku?.name || carrying.skuId} ×${carrying.qty}`;
      detail = 'Take it to its matching display';
    } else if (tool) {
      const names = { hose: 'Watering hose', divot: 'Divot kit', rake: 'Bunker rake', boxcutter: 'Box cutter' };
      icon = '◇';
      title = CLEANING_TOOLS[tool]?.label || names[tool] || tool;
      const activation = handlers.getToolActivation?.() === 'toggle' ? 'Press LMB to toggle' : 'Hold LMB to use';
      detail = tool === 'washer' ? `${activation} · RMB applies soap` : activation;
    }
    const signature = `${icon}|${title}|${detail}`;
    if (signature !== lastContext) {
      lastContext = signature;
      context.style.display = title ? '' : 'none';
      contextIcon.textContent = icon;
      contextTitle.textContent = title;
      contextDetail.textContent = detail;
    }
  }

  return { root, update };
}
