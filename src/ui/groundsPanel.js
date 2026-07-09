// FAIRWAY STATE — Grounds panel: maintenance policies, crew, and the morning report.
// The management face of the turf sim. Real staff records arrive in Phase 3; the
// crew slider here is day-labor by headcount.

import { el } from './ui.js';
import { BALANCE } from '../sim/balance.js';
import { formatMoney } from '../core/utils.js';

const ZONE_LABELS = { green: 'Greens', tee: 'Tees', fairway: 'Fairways', rough: 'Rough' };
const MOW_HEIGHTS = {
  green: [3, 4, 5],
  tee: [8, 10, 13],
  fairway: [12, 14, 18],
  rough: [35, 45, 60],
};
const IRRIGATION = ['off', 'light', 'standard', 'heavy'];
const FERTILIZER = ['none', 'lean', 'standard', 'aggressive'];

export function makeGroundsPanel(app) {
  const crewLabel = el('span', {});
  const crewMinus = el('button', { text: '−', title: 'Lay off one crew member', onclick: () => bumpCrew(-1) });
  const crewPlus = el('button', { text: '+', title: 'Hire one day-labor crew member', onclick: () => bumpCrew(1) });
  const reportBox = el('div', { class: 'muted', style: 'white-space:pre-line;font-size:0.85rem;line-height:1.5' });
  const policyBox = el('div');

  function bumpCrew(d) {
    const m = app.state.maintenance;
    m.crewUnits = Math.max(0, Math.min(8, m.crewUnits + d));
    refresh();
  }

  function policyRow(key) {
    const pol = app.state.maintenance.policies[key];
    const mkSelect = (options, value, onchange, fmt = (v) => v) => {
      const sel = el('select', { onchange: (e) => { onchange(e.target.value); refresh(); } },
        ...options.map((o) => el('option', { value: String(o), text: fmt(o) })));
      sel.value = String(value);
      return sel;
    };
    return el(
      'div',
      { class: 'row', style: 'align-items:baseline' },
      el('strong', { text: ZONE_LABELS[key], style: 'width:72px;display:inline-block' }),
      el('span', { class: 'muted', text: 'cut' }),
      mkSelect(MOW_HEIGHTS[key], pol.mowHeightMm, (v) => { pol.mowHeightMm = Number(v); }, (v) => `${v}mm`),
      el('span', { class: 'muted', text: 'every' }),
      mkSelect([1, 2, 3, 4, 6, 8, 10], pol.mowEveryDays, (v) => { pol.mowEveryDays = Number(v); }, (v) => `${v}d`),
      el('span', { class: 'muted', text: '💧' }),
      mkSelect(IRRIGATION, pol.irrigation, (v) => { pol.irrigation = v; }),
      el('span', { class: 'muted', text: '🌱' }),
      mkSelect(FERTILIZER, pol.fertilizer, (v) => { pol.fertilizer = v; }),
    );
  }

  const root = el(
    'div',
    { class: 'panel grounds-panel', style: 'display:none' },
    el('h3', { text: 'Grounds crew' }),
    el('div', { class: 'row' }, crewMinus, crewLabel, crewPlus,
      el('span', { class: 'muted', text: `${formatMoney(BALANCE.turf.wagePerCrewDay.realistic)}/day each · ${BALANCE.turf.crewHoursPerDay}h` })),
    el('h3', { text: 'Policies', style: 'margin-top:10px' }),
    policyBox,
    el('h3', { text: 'This morning', style: 'margin-top:10px' }),
    reportBox,
  );

  function refresh() {
    if (!app.state || !app.state.maintenance) return;
    const m = app.state.maintenance;
    crewLabel.textContent = `${m.crewUnits} on the crew`;
    policyBox.replaceChildren(...Object.keys(m.policies).map(policyRow));

    const r = m.lastReport;
    if (!r) {
      reportBox.textContent = 'No report yet — the crew starts at 5:00 AM.';
    } else {
      const lines = [];
      if (r.frostDelay) lines.push('❄ Frost delay — crews waited for the thaw.');
      for (const d of r.done) {
        if (d.task === 'mow') lines.push(`✔ Mowed ${ZONE_LABELS[d.zone].toLowerCase()} (${d.hours}h)`);
        else if (d.task === 'fertilize') lines.push(`✔ Fed ${ZONE_LABELS[d.zone].toLowerCase()}`);
      }
      for (const s of r.skipped) {
        lines.push(`✖ Skipped ${s.task} on ${ZONE_LABELS[s.zone].toLowerCase()} — ${s.reason}`);
      }
      const c = r.costs;
      lines.push(`Spent: wages ${formatMoney(c.wages)} · water ${formatMoney(c.water)} · fertilizer ${formatMoney(c.fertilizer)}`);
      if (typeof r.hoursLeft === 'number') lines.push(`Crew hours left over: ${r.hoursLeft}h`);
      reportBox.textContent = lines.join('\n');
    }
  }

  function setVisible(v) {
    root.style.display = v ? '' : 'none';
    app.groundsOpen = v;
    if (v) refresh();
  }

  return { root, refresh, setVisible };
}
