// FAIRWAY STATE — the HUD, restructured to the comps pattern (DEV_LOG
// 2026-07-10): a minimal always-on strip (club · date/time · speed · cash)
// plus ONE deliberately-entered Manage dock holding every management screen.
// Stats live on the dock entries that own them, not in the chrome.

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

  const speedBtns = BALANCE.speeds.map((s, i) =>
    el('button', {
      text: s === 0 ? '⏸' : '▶'.repeat(Math.min(3, Math.log2(s) / 2 + 1) | 0) || '▶',
      title: s === 0 ? 'Pause (Space)' : `${s}× speed`,
      onclick: () => handlers.setSpeed(i),
    }),
  );
  speedBtns[1].textContent = '▶';
  if (speedBtns[2]) speedBtns[2].textContent = '▶▶';
  if (speedBtns[3]) speedBtns[3].textContent = '▶▶▶';

  // --- the Manage dock: one entry point into every management screen -------
  const dockEntry = (icon, label, key, onOpen) => {
    const sub = el('span', { class: 'dock-sub', text: '' });
    const btn = el('button', { class: 'dock-entry', onclick: () => { setDockOpen(false); onOpen(); } },
      el('span', { class: 'dock-main' },
        el('span', { class: 'dock-icon', text: icon }),
        el('span', { class: 'dock-label', text: label }),
        el('kbd', { class: 'dock-key', text: key }),
      ),
      sub,
    );
    return { btn, sub };
  };

  const empireEntry = dockEntry('🏢', 'Empire', 'M', () => handlers.toggleEmpire());
  const clubEntry = dockEntry('🏛', 'Club office', 'C', () => handlers.toggleClub());
  const shopEntry = dockEntry('🛍', 'Pro shop desk', '', () => handlers.toggleShopPanel());
  const groundsEntry = dockEntry('⛳', 'Grounds', 'G', () => handlers.toggleGrounds());
  const worksEntry = dockEntry('🚧', 'Course works', 'E', () => handlers.toggleWorks());

  const dock = el('div', { class: 'manage-dock', style: 'display:none' },
    empireEntry.btn, clubEntry.btn, shopEntry.btn, groundsEntry.btn, worksEntry.btn,
  );

  let dockOpen = false;
  function setDockOpen(v) {
    dockOpen = v;
    dock.style.display = v ? '' : 'none';
    manageBtn.classList.toggle('active-tool', v);
    if (v) update(); // fresh sublines the moment it opens
  }

  const manageBtn = el('button', {
    class: 'manage-btn',
    text: '🗂 Manage',
    title: 'Every management screen — Empire, Club, Shop, Grounds, Works',
    onclick: (e) => {
      e.stopPropagation();
      setDockOpen(!dockOpen);
    },
  });
  const menuBtn = el('button', { text: '☰', title: 'Menu (Esc)', onclick: () => handlers.openMenu() });

  // clicking anywhere else puts the dock away
  window.addEventListener('pointerdown', (e) => {
    if (dockOpen && !dock.contains(e.target) && e.target !== manageBtn) setDockOpen(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dockOpen) setDockOpen(false);
  });

  const root = el(
    'div',
    { class: 'hud' },
    club,
    datetime,
    el('div', { class: 'speed-group' }, ...speedBtns),
    el('span', { class: 'spacer' }),
    cash,
    manageBtn,
    menuBtn,
    dock,
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
    speedBtns.forEach((b, i) => b.classList.toggle('on', app.speedIdx === i));

    // the dock carries the at-a-glance lines its screens own
    if (dockOpen || !last) {
      if (app.state.club && app.state.golfers) {
        const c = memberCounts(app.state);
        const prestige = app.state.progression ? ` · 🏆 ${Math.round(app.state.progression.prestige)}` : '';
        clubEntry.sub.textContent = `👥 ${c.weekday + c.full + c.premium} members · Rep ${Math.round(app.state.club.reputation)}${prestige}`;
      }
      const w = app.state.weather;
      let wText = weatherSummary(w.today);
      if (w.droughtDays >= 4) wText += ` · 🥵 ${w.droughtDays}d dry`;
      groundsEntry.sub.textContent = wText;
      worksEntry.sub.textContent = `Course ${Math.round(app.overallRating)} · Design ${Math.round(app.designRating)} / Condition ${Math.round(app.conditionRatingVal)}`;
      if (app.empire) {
        const holdings = app.empire.holdings ? app.empire.holdings.length : 1;
        empireEntry.sub.textContent = `${holdings} propert${holdings === 1 ? 'y' : 'ies'} · market & portfolio`;
      }
      const shop = app.state.shop;
      if (shop) {
        const sy = shop.salesYesterday || { units: 0, revenue: 0 };
        shopEntry.sub.textContent = `Yesterday ${sy.units} sales · ${formatMoney(sy.revenue)}`;
      }
    }

    // open-state dots on the entries
    worksEntry.btn.classList.toggle('active-tool', app.worksMode);
    groundsEntry.btn.classList.toggle('active-tool', app.groundsOpen);
    clubEntry.btn.classList.toggle('active-tool', app.clubOpen);
    empireEntry.btn.classList.toggle('active-tool', !!app.empireOpen);
    shopEntry.btn.classList.toggle('active-tool', app.shopOpen);
  }

  return { root, update };
}
