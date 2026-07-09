// FAIRWAY STATE — Course Works UI: tool palette + the plan bar (cost, downtime
// warnings, confirm/cancel). Editing is plan-then-confirm; see terrainEdit.js.

import { el, toast } from './ui.js';
import { ZONE } from '../sim/constants.js';
import { BALANCE } from '../sim/balance.js';
import { planCost, planAffectedHoles, zoneCostPerCell } from '../sim/terrainEdit.js';
import { ZONE_COLORS, holeSummary } from '../render/courseRenderer.js';
import { formatMoney } from '../core/utils.js';
import { holeNumber } from '../sim/course.js';

const ZONE_TOOLS = [
  { zone: ZONE.FAIRWAY, label: 'Fairway' },
  { zone: ZONE.GREEN, label: 'Green' },
  { zone: ZONE.TEE, label: 'Tee pad' },
  { zone: ZONE.BUNKER, label: 'Bunker' },
  { zone: ZONE.WATER, label: 'Water' },
  { zone: ZONE.ROUGH, label: 'Rough' },
  { zone: ZONE.PATH, label: 'Path' },
  { zone: ZONE.OUT, label: 'Clear' },
];

const ELEV_TOOLS = [
  { dir: 'raise', label: '▲ Raise' },
  { dir: 'lower', label: '▼ Lower' },
  { dir: 'smooth', label: '≈ Smooth' },
];

export function makeWorksPanel(app, handlers) {
  const toolButtons = new Map();

  function toolBtn(key, label, swatchColor, makeTool, title = '') {
    const btn = el(
      'button',
      { title, onclick: () => handlers.setTool(makeTool()) },
      swatchColor ? el('span', { class: 'swatch', style: `background:${swatchColor}` }) : null,
      label,
    );
    toolButtons.set(key, btn);
    return btn;
  }

  const zoneGrid = el(
    'div',
    { class: 'tool-grid' },
    ...ZONE_TOOLS.map((t) =>
      toolBtn(
        `zone:${t.zone}`,
        t.label,
        ZONE_COLORS[t.zone],
        () => ({ kind: 'zone', zone: t.zone }),
        `${formatMoney(zoneCostPerCell(t.zone))} per cell`,
      ),
    ),
  );

  const elevGrid = el(
    'div',
    { class: 'tool-grid' },
    ...ELEV_TOOLS.map((t) =>
      toolBtn(`elev:${t.dir}`, t.label, null, () => ({ kind: 'elev', dir: t.dir }),
        `${formatMoney(BALANCE.elevationCostPerFoot)} per cell per ft`),
    ),
  );

  const brushLabel = el('span', { class: 'muted', text: `Brush ${app.brushSize + 1}` });
  const brush = el('input', {
    type: 'range', min: '0', max: '3', step: '1', value: String(app.brushSize),
    oninput: (e) => {
      handlers.setBrush(Number(e.target.value));
      brushLabel.textContent = `Brush ${app.brushSize + 1}`;
    },
  });

  const holeSelect = el('select');
  const holeInfo = el('div', { class: 'muted', text: '' });

  function refreshHoles() {
    const course = app.state.course;
    const prev = holeSelect.value;
    holeSelect.replaceChildren(
      ...course.holes.map((h) =>
        el('option', { value: String(h.id), text: `Hole ${holeNumber(course, h.id)} (${h.status})` }),
      ),
    );
    if ([...holeSelect.options].some((o) => o.value === prev)) holeSelect.value = prev;
    const hole = course.holes.find((h) => h.id === Number(holeSelect.value));
    holeInfo.textContent = hole ? holeSummary(course, hole) : '';
  }
  holeSelect.addEventListener('change', refreshHoles);

  const palette = el(
    'div',
    { class: 'panel works-palette' },
    el('h3', { text: 'Surfaces' }),
    zoneGrid,
    el('h3', { text: 'Land', style: 'margin-top:12px' }),
    elevGrid,
    el('div', { class: 'row' }, brushLabel, brush),
    el('h3', { text: 'Holes', style: 'margin-top:12px' }),
    el('div', { class: 'row' }, holeSelect),
    holeInfo,
    el(
      'div',
      { class: 'row' },
      toolBtn('marker:tee', '⛳ Place tee', null, () => ({ kind: 'marker', which: 'tee', holeId: Number(holeSelect.value) }),
        `${formatMoney(BALANCE.holeMoveCost)} — must sit on a tee pad`),
      toolBtn('marker:pin', '🚩 Place pin', null, () => ({ kind: 'marker', which: 'pin', holeId: Number(holeSelect.value) }),
        `${formatMoney(BALANCE.holeMoveCost)} — must sit on a green`),
    ),
    el('div', { class: 'row' },
      el('button', {
        text: '+ New hole',
        onclick: () => {
          handlers.newHole();
          refreshHoles();
          toast('New hole added — paint a tee pad and a green, then place its markers.');
        },
      }),
    ),
    el('div', { class: 'muted', text: 'Confirmed works near an open hole close it for renovation. No undo after confirm.' }),
  );

  // --- plan bar -----------------------------------------------------------

  const costLabel = el('span', { class: 'cost', text: '—' });
  const detailLabel = el('span', { class: 'muted', text: 'Paint changes to plan a project.' });
  const warnLabel = el('span', { class: 'warn', text: '' });
  const confirmBtn = el('button', { class: 'primary', text: 'Confirm works', onclick: () => handlers.confirmPlan() });
  const cancelBtn = el('button', { text: 'Cancel', onclick: () => handlers.cancelPlan() });

  const planBar = el('div', { class: 'plan-bar' }, costLabel, detailLabel, warnLabel, confirmBtn, cancelBtn);

  function refreshPlan() {
    const plan = app.plan;
    const st = app.state;
    if (!plan || plan.cells.size === 0) {
      costLabel.textContent = '—';
      detailLabel.textContent = 'Paint changes to plan a project.';
      warnLabel.textContent = '';
      confirmBtn.disabled = true;
      return;
    }
    const cost = planCost(plan, st.course);
    costLabel.textContent = formatMoney(cost.total);
    const bits = [];
    if (cost.cellCount) bits.push(`${cost.cellCount} cells`);
    if (cost.elevFeet > 0.01) bits.push(`${cost.elevFeet.toFixed(1)} ft of earthworks`);
    detailLabel.textContent = bits.join(' · ');
    const affected = planAffectedHoles(plan, st.course, st.mode);
    warnLabel.textContent = affected.length
      ? '⚠ closes ' + affected.map((a) => `H${holeNumber(st.course, a.holeId)} ${a.days}d`).join(', ')
      : '';
    confirmBtn.disabled = cost.total > st.cash;
    confirmBtn.textContent = cost.total > st.cash ? 'Not enough cash' : 'Confirm works';
  }

  function updateToolHighlight() {
    const t = app.activeTool;
    for (const [key, btn] of toolButtons) {
      let on = false;
      if (t) {
        if (t.kind === 'zone') on = key === `zone:${t.zone}`;
        else if (t.kind === 'elev') on = key === `elev:${t.dir}`;
        else if (t.kind === 'marker') on = key === `marker:${t.which}`;
      }
      btn.classList.toggle('active-tool', on);
    }
  }

  function setVisible(v) {
    palette.style.display = v ? '' : 'none';
    planBar.style.display = v ? '' : 'none';
    if (v) {
      refreshHoles();
      refreshPlan();
    }
  }
  setVisible(false);

  return { palette, planBar, refreshPlan, refreshHoles, updateToolHighlight, setVisible };
}
