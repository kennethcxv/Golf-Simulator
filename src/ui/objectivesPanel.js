// FAIRWAY STATE — the guide card: the current tutorial objective, quietly in the
// corner. Retires itself when the arc completes or the player hides it.

import { el } from './ui.js';
import { TUTORIAL_STEPS, currentStep } from '../sim/tutorial.js';

export function makeObjectivesPanel(app) {
  const title = el('div', { style: 'font-weight:600' });
  const hint = el('div', { class: 'muted', style: 'font-size:0.85rem;line-height:1.35' });
  const progress = el('span', { class: 'muted', style: 'font-size:0.8rem' });
  const root = el(
    'div',
    { class: 'panel objectives-card', style: 'display:none' },
    el('div', { class: 'row', style: 'justify-content:space-between' },
      el('span', { text: '🎯 Getting started', style: 'color:var(--accent);font-size:0.85rem;letter-spacing:0.5px' }),
      progress,
      el('button', {
        text: '✕', title: 'Hide the guide', style: 'padding:0 8px',
        onclick: () => {
          if (app.state && app.state.tutorial) app.state.tutorial.hidden = true;
          refresh();
        },
      }),
    ),
    title,
    hint,
  );

  function refresh() {
    const st = app.state;
    if (!st || !st.tutorial || st.tutorial.complete || st.tutorial.hidden) {
      root.style.display = 'none';
      return;
    }
    const step = currentStep(st);
    if (!step) {
      root.style.display = 'none';
      return;
    }
    root.style.display = '';
    title.textContent = step.title;
    hint.textContent = step.hint;
    progress.textContent = `${st.tutorial.step + 1}/${TUTORIAL_STEPS.length}`;
  }

  return { root, refresh };
}
