// GOLF EMPIRE — the property market: browse distressed listings, judge them,
// buy one. The hidden trueValue is deliberately NOT shown — reading a listing
// against its ask is the player's job.

import { el, modal } from './ui.js';
import { formatMoney } from '../core/utils.js';
import { syncWallet, worldMinutes } from '../sim/empire.js';
import { marketConditionLabel, listingAgeLabel } from '../sim/marketplace.js';
import { calendarOf } from '../sim/time.js';
import { propertyTier, tierUnlocked, ensureEmpireProgression } from '../sim/propertyProgression.js';

const MOOD_STYLE = {
  buyers: 'border-color:var(--accent-2)',
  sellers: 'border-color:var(--warn)',
  balanced: '',
};

export function openMarketplace(app, handlers) {
  modal('Property market', (box, close) => {
    box.classList.add('wide', 'market-dialog');
    const body = el('div');
    box.append(body);

    const render = () => {
      const empire = app.empire;
      if (!empire) return;
      const wallet = syncWallet(empire);
      const today = calendarOf(worldMinutes(empire)).dayAbs;
      const mood = marketConditionLabel(empire.marketCondition);
      const progression = ensureEmpireProgression(empire);
      const rows = [
        el('section', { class: 'market-overview', 'aria-label': 'Market summary' },
          el('div', { class: 'market-stats' },
          el('span', { class: 'status-chip', style: MOOD_STYLE[mood.key], title: mood.hint, text: `${mood.label}` }),
          el('span', { class: 'status-chip', text: `Wallet ${formatMoney(wallet)}` }),
          el('span', { class: 'status-chip', text: `${empire.market.length} listings` }),
          ),
          el('p', { class: 'market-advice', text: 'The asking price is the seller’s number. Judge the golf, the work, and the recovery.' }),
        ),
      ];
      if (!empire.market.length) {
        rows.push(el('div', { class: 'row muted', text: 'Nothing listed right now — you bought the whole county.' }));
      }
      for (const p of empire.market) {
        const tier = propertyTier(p);
        const unlocked = tierUnlocked(empire, tier.id);
        const affordable = wallet >= p.askingPrice;
        rows.push(el('article', { class: 'listing market-listing' },
          el('div', { class: 'listing-main' },
            el('div', { class: 'listing-title-block' },
              el('strong', { class: 'listing-title', text: p.name }),
              el('span', { class: 'listing-meta muted', text: `${p.size} holes · par ${p.par} · ${p.yards.toLocaleString('en-US')} yd · ${listingAgeLabel(today - (p.listedDay ?? today))}` }),
            ),
            el('div', { class: 'listing-purchase' },
              el('span', { class: 'listing-price', text: formatMoney(p.askingPrice) }),
              el('button', {
                class: affordable ? 'primary' : '',
                text: affordable ? 'Buy' : 'Not enough cash',
                disabled: affordable ? null : 'disabled',
                title: affordable ? `Pay ${formatMoney(p.askingPrice)} and take the keys` : 'The wallet says no',
                onclick: () => {
                  const res = handlers.buyFromMarket(p.id);
                  if (res && res.closeMarket) close();
                  else render();
                },
              }),
            ),
          ),
          el('div', { class: 'listing-signals' },
            el('span', { class: 'status-chip', text: `Design ${Math.round(p.design)}` }),
            el('span', { class: 'status-chip', text: `Condition ${Math.round(p.condition)}` }),
            el('span', { class: 'status-chip', text: `${p.startingMembers} members` }),
            el('span', { class: 'status-chip', text: `Rep ${p.startingReputation}` }),
            el('span', { class: 'status-chip', text: tier.name }),
            p.sickGreens > 0
              ? el('span', { class: 'status-chip', style: 'border-color:var(--warn)', text: `⚠ ${p.sickGreens} sick green${p.sickGreens > 1 ? 's' : ''}` })
              : null,
          ),
          el('p', { class: 'listing-blurb muted', text: p.blurb }),
        ));
      }
      rows.push(el('div', { class: 'market-actions' },
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
  }, { onClose: () => handlers.marketClosed?.() });
}
