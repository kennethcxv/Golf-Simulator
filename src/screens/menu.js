// FAIRWAY STATE — main menu screen.

import { el } from '../ui/ui.js';
import { loadData } from '../core/storage.js';

export function makeMenu(handlers) {
  const continueBtn = el('button', {
    class: 'primary',
    text: 'Continue',
    disabled: 'disabled',
    onclick: () => handlers.onContinue(),
  });

  const root = el(
    'div',
    { class: 'menu-screen' },
    el('h1', {}, 'GOLF ', el('span', { class: 'accent', text: 'EMPIRE' })),
    el('div', { class: 'tagline', text: 'Buy them broken. Bring them back. Keep the gems — flip the rest.' }),
    el(
      'div',
      { class: 'menu-buttons' },
      continueBtn,
      el('button', { text: 'New Empire — Relaxed', title: 'Forgiving turf, softer finances', onclick: () => handlers.onNewGame('relaxed') }),
      el('button', { text: 'New Empire — Realistic', title: 'Real stakes: turf, margins, members', onclick: () => handlers.onNewGame('realistic') }),
    ),
    el('div', {
      class: 'footnote',
      text: 'Restore the clubhouse. Rebuild the course. Grow a club worth keeping — or selling.',
    }),
  );

  async function refresh() {
    const auto = await loadData('autosave');
    continueBtn.disabled = !auto;
  }

  function setVisible(v) {
    root.style.display = v ? '' : 'none';
    if (v) refresh();
  }

  refresh();
  return { root, setVisible };
}
