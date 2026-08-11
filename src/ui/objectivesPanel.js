// Context-aware guide card. The arrival arc appears only during ordinary walk;
// first-use lessons can temporarily replace it in the mode that triggered them.

import { el } from './ui.js';
import {
  TUTORIAL_STEPS,
  currentContextTutorial,
  currentStep,
  dismissContextTutorial,
} from '../sim/tutorial.js';
import { campaignView, dismissCampaignGuide } from '../sim/campaign.js';

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
    if (!app.state) return;
    if (contextualId) { dismissContextTutorial(app.state, contextualId); refresh(); return; }
    // X3: the × wrote tutorial.hidden, which campaign mode never reads — so in
    // a real game the dismiss button did nothing at all. Same fault as the
    // render gate, on the way out instead of the way in.
    if (app.state.campaign?.enabled) dismissCampaignGuide(app.state);
    else if (app.state.tutorial) app.state.tutorial.hidden = true;
    refresh();
  });

  function refresh() {
    const state = app.state;
    const context = getContext();
    contextualId = null;
    // X3 (Goal 21) — THE CARD EXISTS AND NEVER RENDERS.
    //
    // A stranger played for 25 minutes and could not find out what the game
    // wanted from them. The reason is here: every gate in this function reads
    // `state.tutorial`, and in campaign mode — which is what a new game IS —
    // the current task comes from campaignView(). Two consequences, both fatal:
    // a save with no tutorial object hid the card outright, and tickTutorial
    // sets tutorial.complete once the first day is done, which hid it FOREVER
    // while the campaign still had tasks to give.
    //
    // The right object was gated on the wrong state. In campaign mode the card
    // now follows the campaign, including its own hidden flag.
    const campaign = campaignView(state);
    if (!state || (!campaign && !state.tutorial)
      || ['pause', 'laptop', 'register', 'course-editor', 'overview'].includes(context)) {
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

    // The campaign has its own dismissal; the tutorial's completion flags must
    // not speak for it.
    const hidden = campaign ? campaign.hidden : (state.tutorial.complete || state.tutorial.hidden);
    if (context !== 'walk' || hidden) {
      root.style.display = 'none';
      return;
    }
    const step = currentStep(state);
    if (!step) {
      root.style.display = 'none';
      return;
    }
    eyebrow.textContent = step.chapter || 'Getting started';
    progress.textContent = campaign
      ? `${campaign.completedCount}/${campaign.totalCount}`
      : `${state.tutorial.step + 1}/${TUTORIAL_STEPS.length}`;
    title.textContent = step.title;
    hint.textContent = step.hint;
    later.style.display = 'none';
    root.style.display = '';
  }

  return { root, refresh };
}
