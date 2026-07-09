// FAIRWAY STATE — inspect panel: click a section of the course, see what it is.
// Phase 1 shows identity/geometry; the turf sim (Phase 2) adds condition here —
// one status line by default, detail on demand, per the legibility rule.

import { el } from './ui.js';
import { ZONE_NAMES, CELL_YD } from '../sim/constants.js';
import { holeNumber } from '../sim/course.js';

export function makeInspectPanel(app) {
  const title = el('h3', { text: '' });
  const body = el('div');
  const closeBtn = el('button', { text: '✕', style: 'position:absolute;top:8px;right:8px;padding:2px 8px', onclick: hide });
  const root = el('div', { class: 'panel inspect-panel', style: 'display:none' }, closeBtn, title, body);

  function hide() {
    root.style.display = 'none';
    app.selectedSection = null;
  }

  function show(section) {
    const course = app.state.course;
    app.selectedSection = section;
    title.textContent = section.name;
    const areaSqYd = section.size * CELL_YD * CELL_YD;
    const rows = [
      el('div', { class: 'row' }, el('span', { class: 'status-chip', text: ZONE_NAMES[section.zone] })),
      el('div', { class: 'row muted' }, `${section.size} cells · ${areaSqYd.toLocaleString('en-US')} sq yd`),
    ];
    if (section.holeId != null) {
      const hole = course.holes.find((h) => h.id === section.holeId);
      rows.push(el('div', { class: 'row muted' }, `Part of hole ${holeNumber(course, section.holeId)} (${hole ? hole.status : '?'})`));
    }
    rows.push(el('div', { class: 'row muted', text: 'Turf condition tracking arrives with the grounds crew (Phase 2).' }));
    body.replaceChildren(...rows);
    root.style.display = '';
  }

  return { root, show, hide };
}
