import { el } from './ui.js';

const CATEGORY_LABELS = {
  mowing: 'Mowing',
  moisture: 'Moisture',
  turfHealth: 'Turf health',
  greenQuality: 'Green',
  teeQuality: 'Tee',
  fairwayQuality: 'Fairway',
  roughManagement: 'Rough',
  bunkerCondition: 'Bunker',
  divotsAndBallMarks: 'Repairs',
  debris: 'Debris',
  disease: 'Disease',
};

const TOOL_LABELS = [
  ['hose', 'Hose'],
  ['divot', 'Divot kit'],
  ['ballmark', 'Ball-mark fork'],
  ['rake', 'Bunker rake'],
  ['debris', 'Debris bag'],
  ['fungicide', 'Treatment sprayer'],
  ['spreader', 'Rotary spreader'],
  ['greensMower', 'Greens mower'],
];

const pct = (value) => `${Math.round(value || 0)}`;
const signed = (value) => `${value > 0 ? '+' : ''}${value}`;

export function makeCourseMaintenancePanel(app, handlers) {
  const title = el('div', { class: 'cm-title', text: 'Maintenance' });
  const score = el('div', { class: 'cm-score' });
  const scoreWhy = el('div', { class: 'cm-score-why muted' });
  const categories = el('div', { class: 'cm-categories' });
  const report = el('div', { class: 'cm-report' });
  const work = el('div', { class: 'cm-work-order' });
  const workLabel = el('div', { class: 'cm-section-label', text: 'Work order' });
  const inventory = el('div', { class: 'cm-inventory muted' });
  const toolGrid = el('div', { class: 'cm-tools' });
  const inspectButton = el('button', {
    class: 'cm-inspect-btn',
    text: 'Inspection off',
    onclick: () => handlers.toggleInspection(),
  });
  const close = el('button', {
    class: 'cm-close',
    text: '×',
    title: 'Close maintenance tablet',
    onclick: () => handlers.setVisible(false),
  });

  for (const [id, label] of TOOL_LABELS) {
    toolGrid.append(el('button', {
      class: 'cm-tool',
      'data-tool': id,
      text: label,
      onclick: () => handlers.selectTool(id),
    }));
  }

  const root = el('section', { class: 'cm-panel', style: 'display:none' },
    el('header', { class: 'cm-head' }, title, close),
    el('div', { class: 'cm-kicker', text: 'GROUNDS · DAILY WORK ORDER' }),
    el('div', { class: 'cm-score-row' }, score, inspectButton),
    scoreWhy,
    categories,
    el('div', { class: 'cm-section-label', text: 'Aimed patch' }),
    report,
    el('div', { class: 'cm-section-label', text: 'Equipment' }),
    toolGrid,
    inventory,
    workLabel,
    work,
    el('div', { class: 'cm-controls muted', text: 'I close · F cycle tool · hold LMB use · R mower blades · E interact' }),
  );

  let visible = false;
  let aimedReport = null;
  let lastSignature = '';

  function setVisible(next) {
    visible = !!next;
    root.style.display = visible ? '' : 'none';
    if (visible) refresh(true);
  }

  function setReport(next) {
    aimedReport = next || null;
    if (visible) refresh(true);
  }

  function refresh(force = false) {
    const model = app.state?.courseMaintenance;
    if (!model) return;
    const activeTool = app.scene3d?.walk?.getTool?.() || null;
    const signature = JSON.stringify({
      visible,
      activeTool,
      inspection: model.inspection.active,
      score: model.score,
      report: aimedReport,
      inventory: model.inventory,
      work: model.workOrder.steps.map((step) => step.complete),
      scoreHistoryLength: model.scoreHistory.length,
    });
    if (!force && signature === lastSignature) return;
    lastSignature = signature;

    title.textContent = `Hole ${model.heroHoleNumber} maintenance`;
    score.replaceChildren(
      el('span', { class: 'cm-score-value', text: pct(model.score.total) }),
      el('span', { class: 'cm-score-unit', text: '/100 condition' }),
    );
    inspectButton.textContent = model.inspection.active ? 'Inspection on' : 'Inspection off';
    inspectButton.classList.toggle('on', model.inspection.active);
    const latestMeaningfulScore = [...model.scoreHistory]
      .reverse()
      .find((entry) => entry.reasons?.length);
    const reasons = model.score.reasons?.length
      ? model.score.reasons
      : latestMeaningfulScore?.reasons || [];
    const saveLoadComplete = model.workOrder.steps.find((step) => step.id === 'save-load')?.complete;
    scoreWhy.textContent = saveLoadComplete
      ? 'Work order complete · save and reload verified'
      : aimedReport?.fertilizerPending > 0
        ? 'Feed response pending · releases gradually over game time'
        : reasons.length
          ? reasons.slice(0, 2).map((row) => `${CATEGORY_LABELS[row.category] || row.category} ${signed(row.delta)}`).join(' · ')
          : 'Score changes are recorded after each maintenance action.';

    categories.replaceChildren(...Object.entries(model.score.categories).map(([key, value]) =>
      el('div', { class: `cm-category ${value >= 80 ? 'good' : value < 55 ? 'bad' : ''}` },
        el('span', { text: CATEGORY_LABELS[key] || key }),
        el('strong', { text: pct(value) }),
      )));

    if (aimedReport) {
      report.replaceChildren(
        el('div', { class: 'cm-report-head' },
          el('strong', { text: aimedReport.surfaceName }),
          el('span', { text: `${aimedReport.heightMm.toFixed(1)} mm · target ${aimedReport.targetHeightMm.toFixed(1)}` }),
        ),
        el('div', { class: 'cm-report-metrics' },
          el('span', { text: `Moisture ${aimedReport.moisture}` }),
          el('span', { text: `Health ${aimedReport.health}` }),
          el('span', { text: `Feed ${aimedReport.fertilizer}${aimedReport.fertilizerPending ? ` +${aimedReport.fertilizerPending} pending` : ''}` }),
          el('span', { text: `Disease ${aimedReport.disease.severity}` }),
        ),
        el('div', {
          class: `cm-problems ${aimedReport.problems.length ? 'warn' : 'clear'}`,
          text: aimedReport.problems.length ? aimedReport.problems.join(' ') : 'No priority issue in this one-yard patch.',
        }),
      );
    } else {
      report.replaceChildren(el('div', { class: 'cm-empty', text: 'Aim at Hole ' + model.heroHoleNumber + ' and press E to inspect a one-yard patch.' }));
    }

    for (const button of toolGrid.querySelectorAll('.cm-tool')) {
      button.classList.toggle('on', button.dataset.tool === activeTool);
    }
    inventory.textContent = `Fertilizer ${model.inventory.fertilizerKg.toFixed(1)} kg · Fungicide ${model.inventory.fungicideLiters.toFixed(1)} L · Turf mix ${model.inventory.turfMixUses} · Bags ${model.inventory.debrisBags}`;
    const completedSteps = model.workOrder.steps.filter((step) => step.complete).length;
    workLabel.textContent = `Work order · ${completedSteps}/${model.workOrder.steps.length}`;
    work.replaceChildren(...model.workOrder.steps.map((step) =>
      el('div', { class: `cm-step ${step.complete ? 'done' : ''}` },
        el('span', { class: 'cm-check', text: step.complete ? '✓' : '○' }),
        el('span', { text: step.label }),
      )));
  }

  return {
    root,
    setVisible,
    toggle: () => setVisible(!visible),
    isVisible: () => visible,
    setReport,
    refresh,
  };
}
