// Context-aware guide card. The arrival arc appears only during ordinary walk;
// first-use lessons can temporarily replace it in the mode that triggered them.

import { el } from './ui.js';
import {
  TUTORIAL_STEPS,
  currentContextTutorial,
  currentStep,
  dismissContextTutorial,
} from '../sim/tutorial.js';

export function makeObjectivesPanel(app, { getContext = () => 'walk' } = {}) {
  const eyebrow = el('span', { class: 'objective-eyebrow', text: 'Current objective' });
  const progress = el('span', { class: 'objective-progress' });
  const title = el('div', { class: 'objective-title' });
  const hint = el('div', { class: 'objective-hint' });
  const later = el('button', { class: 'objective-later', type: 'button', text: 'Remind me later' });
  const dismiss = el('button', { class: 'objective-dismiss', type: 'button', text: '×', title: 'Dismiss this guidance', 'aria-label': 'Dismiss this guidance' });
  const root = el('aside', { class: 'objectives-card', style: 'display:none', 'aria-live': 'polite' },
    el('div', { class: 'objective-head' }, eyebrow, progress, dismiss),
    title,
    hint,
    later,
  );
  let contextualId = null;

  later.addEventListener('click', () => {
    if (!contextualId || !app.state) return;
    dismissContextTutorial(app.state, contextualId, { remind: true });
    refresh();
  });
  dismiss.addEventListener('click', () => {
    if (!app.state?.tutorial) return;
    if (contextualId) dismissContextTutorial(app.state, contextualId);
    else app.state.tutorial.hidden = true;
    refresh();
  });

  function refresh() {
    const state = app.state;
    const context = getContext();
    contextualId = null;
    if (!state?.tutorial || ['pause', 'laptop', 'register', 'course-editor', 'overview'].includes(context)) {
      root.style.display = 'none';
      return;
    }

    const contextual = currentContextTutorial(state, context);
    if (contextual) {
      contextualId = contextual.id;
      eyebrow.textContent = 'First use';
      progress.textContent = 'Optional';
      title.textContent = contextual.title;
      hint.textContent = contextual.hint;
      later.style.display = '';
      root.style.display = '';
      return;
    }

    if (context !== 'walk' || state.tutorial.complete || state.tutorial.hidden) {
      root.style.display = 'none';
      return;
    }
    const step = currentStep(state);
    if (!step) {
      root.style.display = 'none';
      return;
    }
    eyebrow.textContent = step.chapter || 'Getting started';
    progress.textContent = `${state.tutorial.step + 1}/${TUTORIAL_STEPS.length}`;
    title.textContent = step.title;
    hint.textContent = step.hint;
    later.style.display = 'none';
    root.style.display = '';
  }

  return { root, refresh };
}
