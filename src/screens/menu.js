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
    el('h1', {}, 'FAIRWAY ', el('span', { class: 'accent', text: 'STATE' })),
    el('div', { class: 'tagline', text: 'Real turf. Real members. Your golf club.' }),
    el(
      'div',
      { class: 'menu-buttons' },
      continueBtn,
      el('button', { text: 'New Club — Relaxed', title: 'Forgiving turf, softer finances', onclick: () => handlers.onNewGame('relaxed') }),
      el('button', { text: 'New Club — Realistic', title: 'Real stakes: turf, margins, members', onclick: () => handlers.onNewGame('realistic') }),
    ),
    el('div', {
      class: 'footnote',
      text: 'Working build — placeholder art. You start in your pro shop: WASD walk · E interact · door/map: out to the course',
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
