// Restrained first-property objective card. The compact face shows one task;
// details reveal optional work, area progress, history, and recovery without
// turning normal play into a permanent checklist.

import { el, toast } from './ui.js';
import { TUTORIAL_STEPS, currentStep } from '../sim/tutorial.js';
import {
  campaignRecoveryStatus,
  campaignView,
  dismissCampaignGuide,
  recoverAllCampaignItems,
  recoverOpeningLayout,
  resetCampaignGuide,
} from '../sim/campaign.js';

const percent = (value) => `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;

export function makeObjectivesPanel(app) {
  let expanded = false;
  const root = el('div', { class: 'panel objectives-card', style: 'display:none' });

  const refreshWorld = () => {
    const clubhouse = app.scene3d?.clubhouse?.();
    clubhouse?.refreshCampaign?.();
    app.autosave?.();
    refresh();
  };

  function campaignContents(view) {
    const task = view.currentTask;
    const phaseProgress = view.totalCount
      ? view.completedCount / view.totalCount
      : 1;
    const header = el('div', { class: 'objective-head' },
      el('div', {},
        el('div', { class: 'objective-kicker', text: view.mainObjective }),
        el('div', { class: 'objective-count', text: `${view.completedCount}/${view.totalCount} real-state goals` }),
      ),
      el('button', {
        class: 'objective-icon-btn',
        text: '×',
        title: 'Hide the reopening guide',
        onclick: () => {
          dismissCampaignGuide(app.state);
          refresh();
        },
      }),
    );
    const overall = el('div', { class: 'objective-progress', title: `Campaign progress ${percent(phaseProgress)}` },
      el('i', { style: `width:${percent(phaseProgress)}` }),
    );
    const body = task
      ? el('div', { class: 'objective-current' },
        el('div', { class: 'objective-label', text: 'CURRENT TASK' }),
        el('div', { class: 'objective-title', text: task.title }),
        el('div', { class: 'objective-progress task', title: `${task.title}: ${percent(task.progress)}` },
          el('i', { style: `width:${percent(task.progress)}` }),
        ),
        task.blocked ? el('div', { class: 'objective-blocked', text: task.blocked }) : null,
        task.recommendedTool
          ? el('div', { class: 'objective-tool', text: `Use: ${task.recommendedTool}` })
          : null,
        el('div', { class: 'objective-hint', text: task.hint || '' }),
        task.zone ? el('div', { class: 'objective-zone', text: task.zone }) : null,
      )
      : el('div', { class: 'objective-current complete' },
        el('div', { class: 'objective-title', text: 'Opening day complete' }),
        el('div', { class: 'objective-hint', text: 'The club is operating. Build stock, reputation, and the course from here.' }),
      );

    const detailToggle = el('button', {
      class: 'objective-detail-toggle',
      text: expanded ? 'Hide details' : 'Details',
      onclick: () => { expanded = !expanded; refresh(); },
    });

    root.replaceChildren(header, overall, body, detailToggle);
    if (!expanded) return;

    const detail = el('div', { class: 'objective-details' });
    if (view.optional.length) {
      detail.append(el('div', { class: 'objective-section-title', text: 'OPTIONAL' }));
      const optional = el('div', { class: 'objective-mini-list' });
      for (const item of view.optional) {
        optional.append(el('div', { class: 'objective-mini-item' },
          el('span', { text: item.title }),
          el('span', { text: percent(item.progress) }),
        ));
      }
      detail.append(optional);
    }

    detail.append(el('div', { class: 'objective-section-title', text: 'AREA CONDITION' }));
    const zones = el('div', { class: 'objective-zones' });
    for (const [name, value] of Object.entries(view.zoneProgress)) {
      zones.append(el('div', {},
        el('span', { text: name.replace(/([A-Z])/g, ' $1') }),
        el('b', { text: percent(value) }),
      ));
    }
    detail.append(zones);

    if (view.history.length) {
      detail.append(el('div', { class: 'objective-section-title', text: 'RECENTLY COMPLETED' }));
      const history = el('div', { class: 'objective-history' });
      for (const item of view.history.slice(0, 4)) {
        history.append(el('div', { text: `✓ ${item.title}` }));
      }
      detail.append(history);
    }

    const recovery = campaignRecoveryStatus(app.state);
    if (recovery.needed) {
      detail.append(el('div', { class: 'objective-recovery' },
        el('div', { class: 'objective-section-title', text: 'RECOVERY' }),
        el('div', {
          class: 'objective-hint',
          text: recovery.items.length
            ? `${recovery.items.reduce((sum, item) => sum + item.missing, 0)} owned campaign item(s) are no longer accounted for.`
            : 'The authored safe customer route has been disrupted.',
        }),
        recovery.items.length ? el('button', {
          text: 'Recover owned items',
          onclick: () => {
            const result = recoverAllCampaignItems(app.state);
            toast(result.ok ? 'Replacement delivery scheduled for each missing owned item.' : 'No missing owned item needs recovery.', result.ok ? 'good' : 'warn');
            refreshWorld();
          },
        }) : null,
        recovery.layoutBlocked ? el('button', {
          text: 'Restore safe fixture layout',
          onclick: () => {
            const result = recoverOpeningLayout(app.state);
            toast(result.ok ? 'Required fixtures returned to their safe authored layout.' : result.reason, result.ok ? 'good' : 'warn');
            refreshWorld();
          },
        }) : null,
      ));
    }

    detail.append(el('button', {
      class: 'objective-reset',
      text: 'Reset guide presentation',
      title: 'Rebuild objective history from the unchanged world state',
      onclick: () => {
        resetCampaignGuide(app.state);
        toast('Guide presentation reset. Your world and progress were not rewound.');
        refresh();
      },
    }));
    root.append(detail);
  }

  function legacyContents(st) {
    const step = currentStep(st);
    if (!step) {
      root.style.display = 'none';
      return;
    }
    root.replaceChildren(
      el('div', { class: 'objective-head' },
        el('div', { class: 'objective-kicker', text: 'Getting started' }),
        el('div', { class: 'objective-count', text: `${st.tutorial.step + 1}/${TUTORIAL_STEPS.length}` }),
      ),
      el('div', { class: 'objective-title', text: step.title }),
      el('div', { class: 'objective-hint', text: step.hint }),
    );
  }

  function refresh() {
    const st = app.state;
    const view = st ? campaignView(st) : null;
    if (view) {
      if (view.hidden) {
        root.style.display = 'none';
        return;
      }
      root.style.display = '';
      campaignContents(view);
      return;
    }
    if (!st?.tutorial || st.tutorial.complete || st.tutorial.hidden) {
      root.style.display = 'none';
      return;
    }
    root.style.display = '';
    legacyContents(st);
  }

  return { root, refresh };
}
