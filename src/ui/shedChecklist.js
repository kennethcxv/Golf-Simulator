// The shed's quiet readout: a fixed top-left card listing the cleaning
// objectives with done-ticks and counts, derived entirely from shedView(state)
// (no new save fields). Styled on the .objectives-card idiom. Mounted ONLY when
// the shed scene is active (main.js gates on sceneScope) and refreshed on a
// 500 ms interval plus immediately after restoration-feedback events.

import { el } from './ui.js';
import { shedView } from '../sim/shedCleaning.js';

// Denominators for the counted rows (the floor row is a live % from the view).
const ROW_TOTALS = { 'pick-up-trash': 2, 'scrub-marks': 6, windows: 2 };

function countText(item) {
  if (item.id === 'vacuum-mop-floor') return item.done ? 'clean' : `${item.count}% clean`;
  const total = ROW_TOTALS[item.id];
  if (total == null || typeof item.count !== 'number') return '';
  return `${item.count}/${total}`;
}

export function makeShedChecklist(app) {
  const heading = el('div', { class: 'shed-checklist-head', text: 'Clean out the shed' });
  const list = el('ul', { class: 'shed-checklist-rows' });
  const root = el('aside', {
    class: 'shed-checklist', 'aria-live': 'polite', 'aria-label': 'Shed cleaning checklist',
  }, heading, list);

  const rows = new Map(); // id -> { row, tick, label, count }
  let completeShown = false;

  function ensureRows(items) {
    if (rows.size || !items.length) return;
    for (const item of items) {
      const tick = el('span', { class: 'shed-check-tick', 'aria-hidden': 'true' });
      const label = el('span', { class: 'shed-check-label', text: item.label });
      const count = el('span', { class: 'shed-check-count' });
      const row = el('li', { class: 'shed-check-row', 'data-id': item.id }, tick, label, count);
      list.append(row);
      rows.set(item.id, { row, tick, label, count });
    }
  }

  function refresh() {
    if (!app.state) return;
    const view = shedView(app.state);
    ensureRows(view.items);
    for (const item of view.items) {
      const node = rows.get(item.id);
      if (!node) continue;
      node.label.textContent = item.label;
      node.count.textContent = countText(item);
      node.tick.textContent = item.done ? '✓' : '';
      node.row.classList.toggle('is-done', !!item.done);
    }
    if (view.complete !== completeShown) {
      completeShown = view.complete;
      root.classList.toggle('is-complete', view.complete);
      heading.textContent = view.complete ? 'Shed restored ✓' : 'Clean out the shed';
    }
  }

  refresh(); // initial paint (all rows unticked before any cleaning)
  return { root, refresh };
}
