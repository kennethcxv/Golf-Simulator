// FAIRWAY STATE — top HUD bar: club, date/time, speed, cash, rating, works toggle, menu.

import { el } from './ui.js';
import { calendarOf, formatClock, formatDate } from '../sim/time.js';
import { formatMoney } from '../core/utils.js';
import { BALANCE } from '../sim/balance.js';
import { weatherSummary } from '../sim/weather.js';
import { memberCounts } from '../sim/club.js';

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

  const weather = el('span', { class: 'weather', title: 'Today at the course' });
  const clubStats = el('span', { class: 'rating', title: 'Members · Reputation' });
  const clubBtn = el('button', {
    text: '🏛 Club',
    title: 'Members, pricing, staff, amenities (C)',
    onclick: () => handlers.toggleClub(),
  });
  const shopBtn = el('button', {
    text: '🛍 Shop',
    title: 'Pro shop desk — orders, pricing, rentals; walk the floor from there (P)',
    onclick: () => handlers.toggleShopPanel(),
  });
  const groundsBtn = el('button', {
    text: '⛳ Grounds',
    title: 'Maintenance policies and crew (G)',
    onclick: () => handlers.toggleGrounds(),
  });
  const worksBtn = el('button', {
    text: '🚧 Works',
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
    weather,
    el('span', { class: 'spacer' }),
    clubStats,
    rating,
    cash,
    clubBtn,
    shopBtn,
    groundsBtn,
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
    const w = app.state.weather;
    let wText = weatherSummary(w.today);
    if (w.droughtDays >= 4) wText += ` · 🥵 ${w.droughtDays}d dry`;
    weather.textContent = wText;
    rating.textContent = `Course ${Math.round(app.overallRating)} · D${Math.round(app.designRating)}/C${Math.round(app.conditionRatingVal)}`;
    rating.title = 'Overall course rating · Design / Condition';
    if (app.state.club && app.state.golfers) {
      const c = memberCounts(app.state);
      const prestige = app.state.progression ? ` · 🏆${Math.round(app.state.progression.prestige)}` : '';
      clubStats.textContent = `👥 ${c.weekday + c.full + c.premium} · Rep ${Math.round(app.state.club.reputation)}${prestige}`;
      clubStats.title = 'Members · Reputation · Prestige';
    }
    speedBtns.forEach((b, i) => b.classList.toggle('on', app.speedIdx === i));
    worksBtn.classList.toggle('active-tool', app.worksMode);
    groundsBtn.classList.toggle('active-tool', app.groundsOpen);
    clubBtn.classList.toggle('active-tool', app.clubOpen);
    shopBtn.classList.toggle('active-tool', app.shopOpen || app.view === 'shop3d');
  }

  return { root, update };
}
