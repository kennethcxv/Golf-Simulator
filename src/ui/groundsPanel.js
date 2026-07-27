// Grounds maintenance is a work board, not a magic inspector button. Players
// can perform open orders in first person; hired staff and owned equipment can
// be assigned to orders and then consume game time before turf changes.

import { el, toast } from './ui.js';
import { formatMoney } from '../core/utils.js';
import { ROLE, staffByRole } from '../sim/staff.js';
import { hasUpgrade } from '../sim/progression.js';
import {
  WORK_ORDER_TYPES, automationTier, assignWorkOrder, canAutomateOrder,
  cancelWorkOrder, workOrderProgress,
} from '../sim/maintenanceOrders.js';

const ZONE_LABELS = { green: 'Greens', tee: 'Tees', fairway: 'Fairways', rough: 'Rough' };
const MOW_HEIGHTS = {
  green: [3, 4, 5], tee: [8, 10, 13], fairway: [12, 14, 18], rough: [35, 45, 60],
};
const IRRIGATION = ['off', 'light', 'standard', 'heavy'];
const FERTILIZER = ['none', 'lean', 'standard', 'aggressive'];

function tierCopy(tier) {
  if (tier >= 3) return 'Tier 3 - smart irrigation can run covered watering orders.';
  if (tier >= 2) return 'Tier 2 - trained staff and specialized machines can take eligible orders.';
  if (tier >= 1) return 'Tier 1 - the repaired tractor enables powered field work; specialty equipment is still locked.';
  return 'Tier 0 - owner-operated. Create an order, then do the physical work in first person.';
}

export function makeGroundsPanel(app) {
  const tierBox = el('div', { class: 'muted' });
  const queueBox = el('div');
  const reportBox = el('div', { class: 'muted', style: 'white-space:pre-line;font-size:0.85rem;line-height:1.5' });
  const policyBox = el('div');

  function notifyResult(res, success) {
    toast(res.ok ? success(res) : res.reason, res.ok ? 'good' : 'warn');
    refresh();
  }

  function policyRow(key) {
    const pol = app.state.maintenance.policies[key];
    const irrigationOwned = hasUpgrade(app.state, 'smartIrrigation');
    const fertilizerOwned = hasUpgrade(app.state, 'sprayRig');
    const mkSelect = (options, value, onchange, fmt = (v) => v, disabled = false, title = '') => {
      const sel = el('select', {
        disabled: disabled ? '' : null, title,
        onchange: (e) => { onchange(e.target.value); refresh(); },
      }, ...options.map((o) => el('option', { value: String(o), text: fmt(o) })));
      sel.value = String(value);
      return sel;
    };
    return el('div', { class: 'row', style: 'align-items:baseline' },
      el('strong', { text: ZONE_LABELS[key], style: 'width:72px;display:inline-block' }),
      el('span', { class: 'muted', text: 'cut' }),
      mkSelect(MOW_HEIGHTS[key], pol.mowHeightMm, (v) => { pol.mowHeightMm = Number(v); }, (v) => `${v}mm`),
      el('span', { class: 'muted', text: 'every' }),
      mkSelect([1, 2, 3, 4, 6, 8, 10], pol.mowEveryDays, (v) => { pol.mowEveryDays = Number(v); }, (v) => `${v}d`),
      el('span', { class: 'muted', text: 'water' }),
      mkSelect(IRRIGATION, irrigationOwned ? pol.irrigation : 'off', (v) => { pol.irrigation = v; }, (v) => v,
        !irrigationOwned, 'Requires Smart irrigation controllers'),
      el('span', { class: 'muted', text: 'feed' }),
      mkSelect(FERTILIZER, fertilizerOwned ? pol.fertilizer : 'none', (v) => { pol.fertilizer = v; }, (v) => v,
        !fertilizerOwned, 'Requires Precision spray rig'),
    );
  }

  function orderCard(order) {
    const spec = WORK_ORDER_TYPES[order.type];
    const active = ['open', 'queued', 'in_progress'].includes(order.status);
    const progress = Math.round(workOrderProgress(order) * 100);
    const staffAvailable = staffByRole(app.state, ROLE.GROUNDSKEEPER, { available: true }).length > 0;
    const automate = canAutomateOrder(app.state, order);
    const status = order.status === 'open' ? 'awaiting physical work'
      : order.status === 'queued' ? 'scheduled'
        : order.status === 'in_progress' ? `working - ${progress}%`
          : order.status;
    const controls = [];
    if (active) {
      controls.push(
        el('button', {
          text: 'Player', disabled: order.assignment === 'player' ? '' : null,
          onclick: () => notifyResult(assignWorkOrder(app.state, order.id, 'player'), () => 'Assigned to you. Use the matching tool on that surface.'),
        }),
        el('button', {
          text: 'Groundskeeper', disabled: !staffAvailable || order.reservedCost > 0 ? '' : null,
          title: staffAvailable ? '' : 'Hire a groundskeeper first',
          onclick: () => notifyResult(assignWorkOrder(app.state, order.id, 'staff'), (r) => `Groundskeeper scheduled for ${formatMoney(r.cost)}.`),
        }),
        el('button', {
          text: 'Equipment', disabled: !automate || order.reservedCost > 0 ? '' : null,
          title: automate ? '' : 'Required equipment is not unlocked',
          onclick: () => notifyResult(assignWorkOrder(app.state, order.id, 'automation'), (r) => `Equipment scheduled for ${formatMoney(r.cost)}.`),
        }),
        el('button', {
          text: 'Cancel',
          onclick: () => notifyResult(cancelWorkOrder(app.state, order.id), () => 'Work order cancelled.'),
        }),
      );
    }
    const result = order.result
      ? ` - ${order.result.changed || 0} worked${order.result.missed ? `, ${order.result.missed} missed` : ''}`
      : '';
    return el('div', { class: 'card', style: 'margin:6px 0;padding:8px' },
      el('div', {},
        el('strong', { text: `${spec.label} - ${order.target.name}` }),
        el('span', { class: 'muted', text: `  ${status}${result}` }),
      ),
      el('div', { class: 'muted', text: `${order.durationMinutes} game min - ${order.equipment} - estimate ${formatMoney(order.estimatedCost)}` }),
      active ? el('div', { style: 'height:5px;background:#29332d;margin:6px 0' },
        el('div', { style: `height:100%;width:${progress}%;background:#a99a62` })) : null,
      controls.length ? el('div', { class: 'row', style: 'flex-wrap:wrap' }, ...controls) : null,
    );
  }

  const root = el('div', { class: 'panel grounds-panel', style: 'display:none' },
    el('h3', { text: 'MAINTENANCE - Work board' }),
    tierBox,
    el('div', { class: 'muted', text: 'Planning never repairs turf instantly. Open player orders advance only through the matching first-person tool.' }),
    queueBox,
    el('h3', { text: 'Automation policies', style: 'margin-top:10px' }),
    el('div', { class: 'muted', text: 'Cut targets are planning settings. Watering and feeding remain locked until their real equipment is earned.' }),
    policyBox,
    el('h3', { text: 'This morning', style: 'margin-top:10px' }),
    reportBox,
  );

  function refresh() {
    if (!app.state?.maintenance) return;
    const m = app.state.maintenance;
    tierBox.textContent = tierCopy(automationTier(app.state));
    const shown = [...m.orders]
      .sort((a, b) => (['open', 'queued', 'in_progress'].includes(b.status) ? 1 : 0)
        - (['open', 'queued', 'in_progress'].includes(a.status) ? 1 : 0) || b.id - a.id)
      .slice(0, 12);
    queueBox.replaceChildren(...(shown.length ? shown.map(orderCard) : [
      el('div', { class: 'muted', style: 'padding:8px 0', text: 'No work orders. Inspect a course section to plan one.' }),
    ]));
    policyBox.replaceChildren(...Object.keys(m.policies).map(policyRow));

    const r = m.lastReport;
    if (!r) {
      reportBox.textContent = 'No automated morning run yet.';
      return;
    }
    const lines = [];
    if (r.frostDelay) lines.push('Frost delay - crews waited for the thaw.');
    for (const d of r.done) {
      if (d.task === 'mow') lines.push(`Mowed ${ZONE_LABELS[d.zone].toLowerCase()} (${d.hours}h)`);
      else if (d.task === 'fertilize') lines.push(`Fed ${ZONE_LABELS[d.zone].toLowerCase()}`);
      else lines.push(`${d.task} - ${ZONE_LABELS[d.zone].toLowerCase()}`);
    }
    for (const s of r.skipped) lines.push(`Skipped ${s.task} on ${ZONE_LABELS[s.zone].toLowerCase()} - ${s.reason}`);
    const c = r.costs;
    lines.push(`Spent: labor ${formatMoney(c.wages)} - water ${formatMoney(c.water)} - fertilizer ${formatMoney(c.fertilizer)}`);
    if (typeof r.hoursLeft === 'number') lines.push(`Crew hours remaining: ${r.hoursLeft}h`);
    reportBox.textContent = lines.join('\n');
  }

  function setVisible(v) {
    root.style.display = v ? '' : 'none';
    app.groundsOpen = v;
    if (v) refresh();
  }

  return { root, refresh, setVisible };
}
