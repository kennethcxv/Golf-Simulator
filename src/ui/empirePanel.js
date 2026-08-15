// GOLF EMPIRE — the empire overview: every owned property, the one wallet,
// combined income, portfolio value, switching, and the (permanent) sale flow.

import { el, toast, modal } from './ui.js';
import { formatMoney } from '../core/utils.js';
import { conditionRating } from '../sim/turf.js';
import {
  holdingValue, syncWallet, requestPropertyAppraisal, rejectPropertyAppraisal,
} from '../sim/empire.js';
import { propertyTier } from '../sim/propertyProgression.js';
import { marketConditionLabel } from '../sim/marketplace.js';

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
    const mood = marketConditionLabel(empire.marketCondition);
    rows.push(el('div', { class: 'row' },
      el('span', { class: 'muted', text: `Use the open laptop on the clubhouse front desk to browse ${empire.market.length} available propert${empire.market.length === 1 ? 'y' : 'ies'}.` }),
      el('span', { class: 'status-chip', title: mood.hint, text: mood.label }),
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
          el('span', { class: 'muted', text: isActive ? 'you are here' : `away ${h.passive.days}d - caretaker crew` }),
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
          el('button', { class: 'danger', text: 'Appraise / sell…', onclick: () => confirmSell(h) }),
        ),
      ));
    }

    if (empire.log.length) {
      rows.push(el('h3', { text: 'Ledger of deeds', style: 'margin-top:10px' }));
      for (const entry of empire.log.slice(0, 8)) {
        const icon = entry.kind === 'rival' ? '🏴 ' : entry.kind === 'market' ? '🏷 ' : '';
        rows.push(el('div', { class: 'row muted', style: 'font-size:0.86rem', text: `Day ${entry.day + 1} - ${icon}${entry.text}` }));
      }
    }

    body.replaceChildren(...rows);
  }

  // Selling is the weightiest click in the game — pause the world while the
  // player reads the number, and make the permanence unmistakable.
  function confirmSell(holding) {
    const prevSpeed = app.speedIdx;
    app.speedIdx = 0;
    const requested = requestPropertyAppraisal(app.empire, holding.property.id);
    if (!requested.ok) {
      app.speedIdx = prevSpeed || 1;
      toast(requested.reason, 'warn');
      return;
    }
    const appraisal = requested.appraisal;
    const unmet = appraisal.readiness.saleRequirements.filter((requirement) => !requirement.met);
    const tier = propertyTier(holding.property);
    modal(`Appraisal · ${holding.property.name}`, (box, close) => {
      box.append(
        el('div', { class: 'row', style: 'line-height:1.5' },
          `${tier.name} · appraised at ${formatMoney(appraisal.appraisedValue)} · market ${Math.round(appraisal.marketModifier * 100)}%.`),
        el('div', { class: 'listing' },
          el('div', { class: 'row' }, el('strong', { text: 'Offer' }), el('span', { style: 'flex:1' }), el('strong', { text: formatMoney(appraisal.offer) })),
          el('div', { class: 'row muted' }, el('span', { text: 'Closing costs' }), el('span', { style: 'flex:1' }), el('span', { text: `−${formatMoney(appraisal.closingCosts)}` })),
          appraisal.outstanding > 0 ? el('div', { class: 'row muted' }, el('span', { text: 'Outstanding expenses' }), el('span', { style: 'flex:1' }), el('span', { text: `−${formatMoney(appraisal.outstanding)}` })) : null,
          el('div', { class: 'row' }, el('strong', { text: 'Net proceeds' }), el('span', { style: 'flex:1' }), el('strong', { text: formatMoney(appraisal.netProceeds) })),
        ),
        unmet.length ? el('div', { class: 'row', style: 'line-height:1.5;color:var(--warn)' },
          `Not sale-ready: ${unmet.map((requirement) => requirement.label).join(' · ')}`) : null,
        el('div', { class: 'row', style: 'line-height:1.5;color:var(--warn)' },
          appraisal.eligible
            ? 'Confirmation closes the deed permanently. A recovery snapshot is written before the property, members, regulars, and staff leave the portfolio.'
            : 'Keep improving the real property state, then request another appraisal.'),
        el('div', { class: 'row', style: 'margin-top:12px' },
          appraisal.eligible ? el('button', {
            class: 'danger',
            text: `Confirm permanent sale · ${formatMoney(appraisal.netProceeds)} net`,
            onclick: () => { close(); handlers.sellHolding(holding.property.id, prevSpeed, appraisal.id); },
          }) : null,
          el('button', { class: 'primary', text: appraisal.eligible ? 'Reject offer' : 'Continue improving', onclick: () => {
            rejectPropertyAppraisal(app.empire, appraisal.id, appraisal.eligible ? 'rejected' : 'keep');
            app.speedIdx = prevSpeed || 1;
            close();
          } }),
          appraisal.eligible ? el('button', { text: 'Keep operating', onclick: () => {
            rejectPropertyAppraisal(app.empire, appraisal.id, 'keep');
            app.speedIdx = prevSpeed || 1;
            close();
          } }) : null,
        ),
      );
    }, () => {
      if (app.speedIdx === 0) app.speedIdx = prevSpeed || 1;
    });
  }

  function setVisible(v) {
    root.style.display = v ? '' : 'none';
    app.empireOpen = v;
    if (v) refresh();
  }

  return { root, refresh, setVisible };
}
