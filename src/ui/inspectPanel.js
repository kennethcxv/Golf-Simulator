// FAIRWAY STATE — inspect panel: click a section of the course, see what it is.
// Legibility rule: ONE status word up front; numbers behind a Details toggle;
// plain-language diagnosis and actions when something is actually wrong.

import { el, toast } from './ui.js';
import { ZONE_NAMES, CELL_YD, ZONE, TURF_ZONES } from '../sim/constants.js';
import { holeNumber } from '../sim/course.js';
import {
  sectionTurfSummary, sectionStatus, diagnoseSection, treatSection, aerateSection,
  treatSectionCost, aerateSectionCost, greenSpeedOf,
} from '../sim/turf.js';
import { formatMoney } from '../core/utils.js';

const STATUS_COLORS = { Healthy: '#8ed072', Stressed: '#e0a33c', Declining: '#d84b3a' };

export function makeInspectPanel(app, onStateChanged) {
  const title = el('h3', { text: '' });
  const body = el('div');
  const closeBtn = el('button', { text: '✕', style: 'position:absolute;top:8px;right:8px;padding:2px 8px', onclick: hide });
  const root = el('div', { class: 'panel inspect-panel', style: 'display:none' }, closeBtn, title, body);

  let detailsOpen = false;

  function hide() {
    root.style.display = 'none';
    app.selectedSection = null;
  }

  function bar(label, value, max = 100, suffix = '') {
    const pct = Math.round((value / max) * 100);
    return el(
      'div',
      { class: 'row', style: 'gap:6px;margin:3px 0' },
      el('span', { class: 'muted', text: label, style: 'width:76px;display:inline-block;font-size:0.85rem' }),
      el('div', { style: 'flex:1;height:8px;background:#182412;border-radius:4px;overflow:hidden' },
        el('div', { style: `width:${Math.min(100, pct)}%;height:100%;background:#7fb35b;border-radius:4px` })),
      el('span', { class: 'muted', text: `${value}${suffix}`, style: 'width:44px;text-align:right;font-size:0.85rem' }),
    );
  }

  function show(section) {
    const st = app.state;
    const course = st.course;
    app.selectedSection = section;
    title.textContent = section.name;
    const areaSqYd = section.size * CELL_YD * CELL_YD;
    const rows = [];
    rows.push(el('div', {
      class: 'muted',
      style: 'font-size:0.76rem;letter-spacing:0.08em;text-transform:uppercase',
      text: 'Maintenance map · planning only',
    }));

    const isTurf = TURF_ZONES.has(section.zone) && st.turf;
    let summary = null;

    if (isTurf) {
      summary = sectionTurfSummary(st, section);
      const status = sectionStatus(st, section);
      rows.push(
        el('div', { class: 'row' },
          el('span', {
            class: 'status-chip',
            text: status,
            style: `border-color:${STATUS_COLORS[status]};color:${STATUS_COLORS[status]}`,
          }),
          section.zone === ZONE.GREEN
            ? el('span', { class: 'muted', text: `rolls ${greenSpeedOf(st, section)} (stimp)` })
            : null,
        ),
      );
      if (summary.disease) {
        rows.push(el('div', {
          class: 'row',
          style: 'color:var(--warn);font-size:0.9rem;line-height:1.35',
          text: diagnoseSection(st, section),
        }));
      }
    } else {
      rows.push(el('div', { class: 'row' }, el('span', { class: 'status-chip', text: ZONE_NAMES[section.zone] })));
      // bunkers report their footprints — the rake's work order
      if (section.zone === ZONE.BUNKER && st.turf) {
        let sum = 0;
        for (const i of section.cells) sum += st.turf.wear[i];
        const foot = Math.round(sum / section.cells.length);
        if (foot > 5) {
          rows.push(el('div', {
            class: 'row muted',
            text: `Footprints ${foot} - ${foot > 50 ? 'churned up; bring the rake' : foot > 25 ? 'needs raking' : 'a light pass would do'}`,
          }));
        } else {
          rows.push(el('div', { class: 'row muted', text: 'Sand raked smooth.' }));
        }
        const estimate = estimateWorkOrder('rakeBunker', section);
        rows.push(el('div', { class: 'row' }, el('button', {
          text: `Create rake order · ~${estimate.durationMinutes} min`,
          onclick: () => {
            const res = createWorkOrder(st, 'rakeBunker', section);
            toast(res.ok ? `Rake order added for ${section.name}. No sand changes until the work is performed.` : res.reason,
              res.ok ? '' : 'warn');
            show(section);
          },
        })));
      }
    }

    rows.push(el('div', { class: 'row muted' }, `${ZONE_NAMES[section.zone]} · ${section.size} cells · ${areaSqYd.toLocaleString('en-US')} sq yd`));
    if (section.holeId != null) {
      const hole = course.holes.find((h) => h.id === section.holeId);
      rows.push(el('div', { class: 'row muted' }, `Part of hole ${holeNumber(course, section.holeId)} (${hole ? hole.status : '?'})`));
    }

    if (isTurf) {
      const detailsBtn = el('button', {
        text: detailsOpen ? 'Details ▾' : 'Details ▸',
        style: 'padding:3px 10px;font-size:0.85rem',
        onclick: () => {
          detailsOpen = !detailsOpen;
          show(section);
        },
      });
      rows.push(el('div', { class: 'row' }, detailsBtn));
      if (detailsOpen) {
        rows.push(
          bar('Health', summary.health),
          bar('Moisture', summary.moisture),
          bar('Nutrients', summary.nutrients),
          bar('Height', summary.heightMm, 90, 'mm'),
          bar('Wear', summary.wear),
          bar('Divots', summary.divots, Math.max(6, section.size * 0.2)),
          bar('Ball marks', summary.ballMarks, Math.max(6, section.size * 0.2)),
        );
      }

      const actions = [];
      if (summary.disease) {
        const cost = treatSectionCost(st, section);
        actions.push(el('button', {
          class: primary ? 'primary' : '',
          text: `${label} · ~${estimate.durationMinutes} min`,
          onclick: () => {
            const res = createWorkOrder(st, type, section);
            toast(res.ok
              ? `${label} order added for ${section.name}. Turf is unchanged until player, staff, or equipment does the work.`
              : res.reason, res.ok ? '' : 'warn');
            show(section);
          },
        }));
      };
      if (summary.disease) {
        addOrder('treatDisease', '💊 Treat disease', true);
      }
      const aerateCost = aerateSectionCost(st, section);
      actions.push(el('button', {
        text: `⛏ Aerate ${formatMoney(aerateCost)}`,
        title: 'Relieves wear and compaction',
        onclick: () => {
          const res = aerateSection(st, section);
          toast(res.ok ? `${section.name} aerated.` : res.reason, res.ok ? '' : 'warn');
          if (res.ok && onStateChanged) onStateChanged();
          show(section);
        },
      }));
      rows.push(el('div', { class: 'row' }, ...actions));
    }

    body.replaceChildren(...rows);
    root.style.display = '';
  }

  // refresh the open panel in place (turf numbers move while time runs)
  function refreshIfOpen() {
    if (app.selectedSection && root.style.display !== 'none') show(app.selectedSection);
  }

  return { root, show, hide, refreshIfOpen };
}
