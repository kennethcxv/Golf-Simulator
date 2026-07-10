// GOLF EMPIRE — the empire overview: every owned property, the one wallet,
// combined income, portfolio value, switching, and the (permanent) sale flow.

import { el, toast, modal } from './ui.js';
import { formatMoney } from '../core/utils.js';
import { conditionRating } from '../sim/turf.js';
import { holdingValue, syncWallet } from '../sim/empire.js';

export function makeEmpirePanel(app, handlers) {
  const body = el('div');
  const root = el('div', { class: 'panel grounds-panel', style: 'display:none' },
    el('h3', { text: '🏢 Golf Empire' }), body);

  function refresh() {
    const empire = app.empire;
    if (!empire) return;
    const wallet = syncWallet(empire);
    const rows = [];

    let totalValue = 0;
    let combinedNet = 0;
    for (const h of empire.holdings) {
      totalValue += holdingValue(empire, h);
      if (h.property.id === empire.activeId) {
        combinedNet += h.state.ledger.yesterday ? h.state.ledger.yesterday.net : 0;
      } else if (h.passive) {
        combinedNet += h.passive.lastNet;
      }
    }

    rows.push(el('div', { class: 'row' },
      el('span', { class: 'status-chip', text: `Wallet ${formatMoney(wallet)}` }),
      el('span', { class: 'status-chip', text: `Portfolio value ${formatMoney(totalValue)}` }),
      el('span', { class: 'status-chip', title: 'Active club’s closed books + every parked club’s passive day', text: `All courses yesterday: ${combinedNet >= 0 ? '+' : ''}${formatMoney(combinedNet)}` }),
    ));
    rows.push(el('div', { class: 'row' },
      el('button', { class: 'primary', text: `🏷 Browse the market (${empire.market.length})`, onclick: () => handlers.openMarket() }),
    ));

    rows.push(el('h3', { text: `Properties (${empire.holdings.length})`, style: 'margin-top:10px' }));
    if (!empire.holdings.length) {
      rows.push(el('div', { class: 'row muted', text: 'You own nothing yet. The market is where empires start.' }));
    }
    for (const h of empire.holdings) {
      const isActive = h.property.id === empire.activeId;
      const cond = isActive ? conditionRating(h.state) : Math.round(h.passive.conditionEst);
      const value = holdingValue(empire, h);
      const income = isActive
        ? (h.state.ledger.yesterday ? h.state.ledger.yesterday.net : 0)
        : h.passive.lastNet;
      rows.push(el('div', { class: 'listing' },
        el('div', { class: 'row' },
          el('strong', { text: `${isActive ? '📍 ' : ''}${h.property.name}`, style: 'flex:1' }),
          el('span', { class: 'muted', text: isActive ? 'you are here' : `away ${h.passive.days}d — caretaker crew` }),
        ),
        el('div', { class: 'row' },
          el('span', { class: 'status-chip', text: `${h.property.size} holes` }),
          el('span', { class: 'status-chip', text: `Cond ${cond}` }),
          el('span', { class: 'status-chip', text: `Value ${formatMoney(value)}` }),
          el('span', { class: 'status-chip', text: `${income >= 0 ? '+' : ''}${formatMoney(income)}/day` }),
        ),
        !isActive && h.passive.sinceVisitNet !== 0
          ? el('div', { class: 'row muted', style: 'font-size:0.85rem', text: `${h.passive.sinceVisitNet >= 0 ? 'Earned' : 'Bled'} ${formatMoney(h.passive.sinceVisitNet)} while you were away.` })
          : null,
        el('div', { class: 'row' },
          isActive
            ? el('span', { class: 'muted', text: 'Running it in person.' })
            : el('button', { class: 'primary', text: '⛳ Go there', onclick: () => handlers.switchTo(h.property.id) }),
          el('span', { style: 'flex:1' }),
          el('button', { class: 'danger', text: 'Sell…', onclick: () => confirmSell(h) }),
        ),
      ));
    }

    if (empire.log.length) {
      rows.push(el('h3', { text: 'Ledger of deeds', style: 'margin-top:10px' }));
      for (const entry of empire.log.slice(0, 6)) {
        rows.push(el('div', { class: 'row muted', style: 'font-size:0.86rem', text: `Day ${entry.day + 1} — ${entry.text}` }));
      }
    }

    body.replaceChildren(...rows);
  }

  // Selling is the weightiest click in the game — pause the world while the
  // player reads the number, and make the permanence unmistakable.
  function confirmSell(holding) {
    const prevSpeed = app.speedIdx;
    app.speedIdx = 0;
    const value = holdingValue(app.empire, holding);
    modal(`Sell ${holding.property.name}?`, (box, close) => {
      box.append(
        el('div', { class: 'row', style: 'line-height:1.5' },
          `The buyer pays ${formatMoney(value)} — today’s honest appraisal, cash at closing.`),
        el('div', { class: 'row', style: 'line-height:1.5;color:var(--warn)' },
          'This is permanent. Every member, every regular who knows your name, and the whole staff go with the deed. There is no undo.'),
        el('div', { class: 'row', style: 'margin-top:12px' },
          el('button', {
            class: 'danger',
            text: `Sell for ${formatMoney(value)}`,
            onclick: () => { close(); handlers.sellHolding(holding.property.id, prevSpeed); },
          }),
          el('button', { class: 'primary', text: 'Keep it', onclick: () => { app.speedIdx = prevSpeed || 1; close(); } }),
        ),
      );
    });
  }

  function setVisible(v) {
    root.style.display = v ? '' : 'none';
    app.empireOpen = v;
    if (v) refresh();
  }

  return { root, refresh, setVisible };
}
