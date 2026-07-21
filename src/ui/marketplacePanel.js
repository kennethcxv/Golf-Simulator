// GOLF EMPIRE — the property market: browse distressed listings, judge them,
// buy one. The hidden trueValue is deliberately NOT shown — reading a listing
// against its ask is the player's job.

import { el, modal } from './ui.js';
import { formatMoney } from '../core/utils.js';
import { propertyAccess, syncWallet, worldMinutes } from '../sim/empire.js';
import { marketConditionLabel, listingAgeLabel } from '../sim/marketplace.js';
import { calendarOf } from '../sim/time.js';

const MOOD_STYLE = {
  buyers: 'border-color:var(--accent-2)',
  sellers: 'border-color:var(--warn)',
  balanced: '',
};

export function openMarketplace(app, handlers) {
  modal('Property market', (box, close) => {
    box.classList.add('wide');
    const body = el('div');
    box.append(body);

    const render = () => {
      const empire = app.empire;
      if (!empire) return;
      const wallet = syncWallet(empire);
      const today = calendarOf(worldMinutes(empire)).dayAbs;
      const mood = marketConditionLabel(empire.marketCondition);
      const rows = [
        el('div', { class: 'row' },
          el('span', { class: 'status-chip', style: MOOD_STYLE[mood.key], title: mood.hint, text: `${mood.label}` }),
          el('span', { class: 'status-chip', text: `Empire wallet ${formatMoney(wallet)}` }),
          el('span', { class: 'status-chip', text: `${empire.market.length} listings` }),
          el('span', {
            class: 'muted',
            style: 'flex:1;font-size:0.85rem',
            text: 'Every ask is the seller’s number, not necessarily the truth. Judge the golf.',
          }),
        ),
      ];
      if (!empire.market.length) {
        rows.push(el('div', { class: 'row muted', text: 'Nothing listed right now — you bought the whole county.' }));
      }
      for (const p of empire.market) {
        const access = propertyAccess(empire, p);
        const affordable = access.unlocked && wallet >= p.askingPrice;
        rows.push(el('div', { class: 'listing' },
          el('div', { class: 'row' },
            el('strong', { text: p.name, style: 'font-size:1.02rem' }),
            el('span', { class: 'muted', text: `${p.size} holes · par ${p.par} · ${p.yards.toLocaleString('en-US')} yd · ${listingAgeLabel(today - (p.listedDay ?? today))}` }),
            el('span', { style: 'flex:1' }),
            el('span', { text: formatMoney(p.askingPrice), style: 'font-weight:600;color:var(--accent-2)' }),
          ),
          el('div', { class: 'row' },
            el('span', { class: 'status-chip', text: p.regionLabel || p.region }),
            el('span', { class: 'status-chip', text: p.climateLabel || p.climate }),
            el('span', { class: 'status-chip', text: p.difficultyLabel || `Difficulty ${p.difficulty}` }),
            el('span', { class: 'status-chip', text: `Design ${Math.round(p.design)}` }),
            el('span', { class: 'status-chip', text: `Condition ${Math.round(p.condition)}` }),
            el('span', { class: 'status-chip', text: `${p.startingMembers} members` }),
            el('span', { class: 'status-chip', text: `Rep ${p.startingReputation}` }),
            p.sickGreens > 0
              ? el('span', { class: 'status-chip', style: 'border-color:var(--warn)', text: `⚠ ${p.sickGreens} sick green${p.sickGreens > 1 ? 's' : ''}` })
              : null,
            el('span', { style: 'flex:1' }),
            el('button', {
              class: affordable ? 'primary' : '',
              text: !access.unlocked ? 'Locked' : affordable ? 'Buy' : 'Not enough cash',
              disabled: affordable ? null : 'disabled',
              title: !access.unlocked
                ? access.reason
                : affordable
                  ? `Pay ${formatMoney(p.askingPrice)} and take the keys`
                  : 'The wallet says no',
              onclick: () => {
                const res = handlers.buyFromMarket(p.id);
                if (res && res.closeMarket) close();
                else render();
              },
            }),
          ),
          !access.unlocked
            ? el('div', { class: 'row muted', style: 'font-size:0.87rem;color:var(--warn)', text: access.reason })
            : el('div', { class: 'row muted', style: 'font-size:0.87rem', text: `${formatMoney(p.operatingCostPerDay)}/day estimated property overhead` }),
          el('div', { class: 'row muted', style: 'font-size:0.87rem', text: p.blurb }),
        ));
      }
      rows.push(el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', { text: app.state ? 'Back to the club' : 'Close', onclick: close }),
      ));
      body.replaceChildren(...rows);
    };

    // The day-pass hook re-renders a market left open; once the modal is gone
    // from the DOM it unhooks itself. (modal() attaches the box AFTER building,
    // so only the live refresher may gate on isConnected — never the first render.)
    const liveRefresh = () => {
      if (!box.isConnected) {
        if (app.marketRefresh === liveRefresh) app.marketRefresh = null;
        return;
      }
      render();
    };
    app.marketRefresh = liveRefresh;
    render();
  });
}
