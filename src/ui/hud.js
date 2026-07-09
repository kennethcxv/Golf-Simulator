// FAIRWAY STATE — top HUD bar: club, date/time, speed, cash, rating, works toggle, menu.

import { el } from './ui.js';
import { calendarOf, formatClock, formatDate } from '../sim/time.js';
import { formatMoney } from '../core/utils.js';
import { BALANCE } from '../sim/balance.js';

export function makeHud(app, handlers) {
  const club = el('span', { class: 'club', text: '' });
  const datetime = el('span', { class: 'datetime' });
  const cash = el('span', { class: 'cash' });
  const rating = el('span', { class: 'rating' });

  const speedBtns = BALANCE.speeds.map((s, i) =>
    el('button', {
      text: s === 0 ? '⏸' : '▶'.repeat(Math.min(3, Math.log2(s) / 2 + 1) | 0) || '▶',
      title: s === 0 ? 'Pause (Space)' : `${s}× speed`,
      onclick: () => handlers.setSpeed(i),
    }),
  );
  // clearer labels
  speedBtns[1].textContent = '▶';
  if (speedBtns[2]) speedBtns[2].textContent = '▶▶';
  if (speedBtns[3]) speedBtns[3].textContent = '▶▶▶';

  const worksBtn = el('button', {
    text: '🚧 Course Works',
    title: 'Toggle terrain editing mode (E)',
    onclick: () => handlers.toggleWorks(),
  });
  const menuBtn = el('button', { text: '☰', title: 'Menu (Esc)', onclick: () => handlers.openMenu() });

  const root = el(
    'div',
    { class: 'hud' },
    club,
    datetime,
    el('div', { class: 'speed-group' }, ...speedBtns),
    el('span', { class: 'spacer' }),
    rating,
    cash,
    worksBtn,
    menuBtn,
  );

  let last = '';
  function update() {
    if (!app.state) return;
    club.textContent = app.state.clubName;
    const cal = calendarOf(app.state.clock.minutes);
    const dt = `${formatDate(cal)} · ${formatClock(cal.minuteOfDay)}`;
    if (dt !== last) {
      datetime.textContent = dt;
      last = dt;
    }
    cash.textContent = formatMoney(app.state.cash);
    rating.textContent = `Design ${Math.round(app.designRating)}`;
    speedBtns.forEach((b, i) => b.classList.toggle('on', app.speedIdx === i));
    worksBtn.classList.toggle('active-tool', app.worksMode);
  }

  return { root, update };
}
