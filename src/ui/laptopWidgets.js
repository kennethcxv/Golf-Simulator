// GOLF SIMULATOR — the laptop's shared instruments: charts and tables.
//
// Charts here are drawn from the ledger's real closed days, never from invented series.
// The palette is the validated dark-surface set (OKLCH band 0.48–0.67, CVD-checked):
// adjacency order [green, blue, gold, violet, terracotta]. Category identity keeps the
// same hue on every chart — a filter never repaints the survivors. Values, labels and
// legends wear the text tokens; only marks wear series color.

import { el } from './ui.js';

// entity → hue, fixed for the life of the application (validated adjacency order)
export const SERIES = {
  revenue: '#3f9d47',
  expenses: '#4f88c9',
  greenFees: '#3f9d47',
  shopSales: '#4f88c9',
  dues: '#bd8722',
  rentals: '#9a6ec2',
  other: '#c06744',
};
const INK = '#ede4cd';
const INK_DIM = '#6e8672';
const GRID = 'rgba(237,228,205,0.07)';
const SURFACE = '#14251a';

export function svgEl(tag, attrs = {}, ...kids) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'text') n.textContent = v;
    else n.setAttribute(k, String(v));
  }
  for (const k of kids) if (k != null && k !== false) n.appendChild(k);
  return n;
}

export const shortMoney = (v) => {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1000000) return `${sign}$${(a / 1000000).toFixed(1)}m`;
  if (a >= 10000) return `${sign}$${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
};

/** Scale a numeric series into chart space. Pure — unit tested headlessly. */
export function scalePoints(values, { w, h, padX = 6, padY = 8, min = null, max = null }) {
  const vals = values.map((v) => (Number.isFinite(v) ? v : 0));
  let lo = min != null ? min : Math.min(0, ...vals);
  let hi = max != null ? max : Math.max(...vals, 1);
  if (hi - lo < 1e-9) hi = lo + 1;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const n = Math.max(1, vals.length - 1);
  return vals.map((v, i) => ({
    x: padX + (i / n) * innerW,
    y: padY + (1 - (v - lo) / (hi - lo)) * innerH,
    v,
  }));
}

export const pathOf = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/**
 * A line chart over the ledger's closed days. Crosshair + tooltip by default; a legend when
 * there is more than one series; dashed stroke doubles as the color-blind-safe second encoding.
 * series: [{ label, color, values:number[], dash?:boolean }], labels: string[] (same length).
 */
export function lineChart({ series, labels, w = 640, h = 168, fmt = shortMoney }) {
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  const lo = Math.min(0, ...all, 0);
  const hi = Math.max(...all, 1);
  const padX = 8;
  const padY = 12;
  const chart = svgEl('svg', { class: 'lt-chart', viewBox: `0 0 ${w} ${h}`, width: '100%', height: h });

  // recessive grid: three horizontal rules + baseline
  const ticks = 3;
  for (let t = 0; t <= ticks; t++) {
    const y = padY + (t / ticks) * (h - padY * 2);
    chart.appendChild(svgEl('line', { x1: padX, x2: w - padX, y1: y, y2: y, stroke: GRID, 'stroke-width': 1 }));
    const val = hi - (t / ticks) * (hi - lo);
    chart.appendChild(svgEl('text', {
      x: padX + 2, y: y - 3, fill: INK_DIM, 'font-size': 9, text: fmt(val),
    }));
  }

  const ptsBySeries = series.map((s) => scalePoints(s.values, { w, h, padX: padX + 2, padY, min: lo, max: hi }));
  ptsBySeries.forEach((pts, si) => {
    const s = series[si];
    chart.appendChild(svgEl('path', {
      d: pathOf(pts), fill: 'none', stroke: s.color, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'stroke-dasharray': s.dash ? '5 4' : null,
    }));
  });

  // crosshair + tooltip
  const cross = svgEl('line', { y1: padY, y2: h - padY, stroke: 'rgba(237,228,205,0.25)', 'stroke-width': 1, visibility: 'hidden' });
  chart.appendChild(cross);
  const dots = series.map((s) => {
    const d = svgEl('circle', { r: 3.4, fill: s.color, stroke: SURFACE, 'stroke-width': 2, visibility: 'hidden' });
    chart.appendChild(d);
    return d;
  });

  const tip = el('div', {
    class: 'lt-charttip',
    style: 'position:absolute;display:none;pointer-events:none;background:#0a160e;border:1px solid #35573f;'
      + 'border-radius:6px;padding:5px 8px;font-size:0.72em;color:#ede4cd;z-index:5;white-space:nowrap;box-shadow:0 3px 10px rgba(3,8,5,0.5)',
  });
  const wrap = el('div', { style: 'position:relative' }, chart, tip);

  const n = Math.max(1, (labels || series[0].values).length);
  chart.addEventListener('mousemove', (e) => {
    const r = chart.getBoundingClientRect();
    if (!r.width) return;
    const fx = ((e.clientX - r.left) / r.width) * w;
    const i = Math.max(0, Math.min(n - 1, Math.round(((fx - padX) / (w - padX * 2)) * (n - 1))));
    const x = ptsBySeries[0][i] ? ptsBySeries[0][i].x : padX;
    cross.setAttribute('x1', x); cross.setAttribute('x2', x);
    cross.setAttribute('visibility', 'visible');
    ptsBySeries.forEach((pts, si) => {
      if (!pts[i]) return;
      dots[si].setAttribute('cx', pts[i].x);
      dots[si].setAttribute('cy', pts[i].y);
      dots[si].setAttribute('visibility', 'visible');
    });
    tip.replaceChildren(
      el('div', { style: 'color:#6e8672;margin-bottom:2px', text: labels && labels[i] != null ? String(labels[i]) : `#${i + 1}` }),
      ...series.map((s, si) => el('div', {},
        el('span', { style: `display:inline-block;width:7px;height:7px;border-radius:2px;background:${s.color};margin-right:5px` }),
        el('span', { text: `${s.label}  ${fmt(s.values[i] || 0)}` }))),
    );
    tip.style.display = 'block';
    const px = (x / w) * r.width;
    tip.style.left = `${Math.min(px + 10, r.width - 130)}px`;
    tip.style.top = '4px';
  });
  chart.addEventListener('mouseleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    tip.style.display = 'none';
  });

  const legend = series.length > 1
    ? el('div', { class: 'lt-legend' }, ...series.map((s) => el('div', { class: 'lt-legenditem' },
      el('span', { class: 'lt-legenddot', style: `background:${s.color}` }),
      el('span', { text: s.label }))))
    : null;
  return el('div', {}, wrap, legend);
}

/** Pure donut geometry: entries → arc descriptors with a fixed 2px-equivalent gap. */
export function donutSegments(entries, { cx, cy, r, gapDeg = 2.4 }) {
  const total = entries.reduce((a, e) => a + Math.max(0, e.value), 0);
  if (total <= 0) return [];
  let a0 = -90;
  return entries.filter((e) => e.value > 0).map((e) => {
    const sweep = (e.value / total) * 360;
    const s = a0 + gapDeg / 2;
    const eDeg = a0 + Math.max(gapDeg, sweep) - gapDeg / 2;
    a0 += sweep;
    const rad = (d) => (d * Math.PI) / 180;
    const large = eDeg - s > 180 ? 1 : 0;
    return {
      ...e,
      frac: e.value / total,
      d: `M${(cx + r * Math.cos(rad(s))).toFixed(2)},${(cy + r * Math.sin(rad(s))).toFixed(2)} `
        + `A${r},${r} 0 ${large} 1 ${(cx + r * Math.cos(rad(eDeg))).toFixed(2)},${(cy + r * Math.sin(rad(eDeg))).toFixed(2)}`,
    };
  });
}

/**
 * Donut for a categorical share (revenue mix). Slices keep the validated adjacency order —
 * they are NOT re-sorted by size, so adjacent hues stay the checked pairs. Legend carries
 * label + value + share; slice gaps are the built-in secondary encoding.
 */
export function donutChart({ entries, size = 128, thickness = 15, fmt = shortMoney, centerLabel = 'total' }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - thickness / 2 - 2;
  const total = entries.reduce((a, e) => a + Math.max(0, e.value), 0);
  const segs = donutSegments(entries, { cx, cy, r });
  const svg = svgEl('svg', { class: 'lt-chart', viewBox: `0 0 ${size} ${size}`, width: size, height: size, style: 'flex-shrink:0' });
  svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', stroke: 'rgba(237,228,205,0.06)', 'stroke-width': thickness }));
  for (const s of segs) {
    svg.appendChild(svgEl('path', {
      d: s.d, fill: 'none', stroke: s.color, 'stroke-width': thickness, 'stroke-linecap': 'butt',
    }));
  }
  svg.appendChild(svgEl('text', {
    x: cx, y: cy - 1, fill: INK, 'font-size': 15, 'font-weight': 700, 'text-anchor': 'middle', text: fmt(total),
  }));
  svg.appendChild(svgEl('text', {
    x: cx, y: cy + 13, fill: INK_DIM, 'font-size': 8.5, 'text-anchor': 'middle', text: centerLabel,
  }));
  const legend = el('div', { style: 'display:flex;flex-direction:column;gap:4px;justify-content:center;min-width:0' },
    ...entries.filter((e) => e.value > 0).map((e) => el('div', { class: 'lt-legenditem', style: 'font-size:0.78em' },
      el('span', { class: 'lt-legenddot', style: `background:${e.color}` }),
      el('span', { style: 'color:#a7bda6', text: e.label }),
      el('span', { style: 'color:#ede4cd;font-weight:600;font-variant-numeric:tabular-nums', text: fmt(e.value) }),
      el('span', { style: 'color:#6e8672', text: total > 0 ? `${Math.round((e.value / total) * 100)}%` : '' }))));
  return el('div', { style: 'display:flex;gap:14px;align-items:center;flex-wrap:wrap;min-width:0' }, svg, legend);
}

/**
 * Pure table query: search + filters + sort + pagination in one pass.
 * q: { search, searchIn(row)→string[], filters:[(row)→bool], sortVal(row)→any, sortDir:1|-1,
 *      page, pageSize }
 * Returns { rows, total, page, pages }. Unit tested headlessly.
 */
export function applyTableQuery(rows, q = {}) {
  let out = rows.slice();
  const needle = String(q.search || '').trim().toLowerCase();
  if (needle && q.searchIn) {
    out = out.filter((r) => q.searchIn(r).some((s) => String(s || '').toLowerCase().includes(needle)));
  }
  for (const f of q.filters || []) if (typeof f === 'function') out = out.filter(f);
  if (q.sortVal) {
    const dir = q.sortDir === -1 ? -1 : 1;
    out = out.map((r, i) => [r, i]).sort((a, b) => {
      const va = q.sortVal(a[0]);
      const vb = q.sortVal(b[0]);
      let c;
      if (typeof va === 'number' && typeof vb === 'number') c = (Number.isFinite(va) ? va : -Infinity) - (Number.isFinite(vb) ? vb : -Infinity);
      else c = String(va ?? '').localeCompare(String(vb ?? ''));
      return c !== 0 ? c * dir : a[1] - b[1]; // stable
    }).map((p) => p[0]);
  }
  const total = out.length;
  const pageSize = q.pageSize > 0 ? q.pageSize : total || 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(0, Math.min(q.page || 0, pages - 1));
  return { rows: out.slice(page * pageSize, page * pageSize + pageSize), total, page, pages };
}

/** A sortable header cell. `ts` is the page's table state ({sortKey, sortDir}). */
export function sortHeader(label, key, ts, rerender, { num = false } = {}) {
  const on = ts.sortKey === key;
  return el('th', { class: num ? 'lt-num' : '' }, el('button', {
    class: `lt-th-sort ${on ? 'on' : ''}`,
    onclick: () => {
      if (ts.sortKey === key) ts.sortDir = -ts.sortDir;
      else { ts.sortKey = key; ts.sortDir = num ? -1 : 1; }
      ts.page = 0;
      rerender();
    },
  }, el('span', { text: label }), el('span', { text: on ? (ts.sortDir === 1 ? '▲' : '▼') : '' })));
}

/** Search box wired to a table state. */
export function searchBox(ts, rerender, placeholder = 'Search…') {
  const input = el('input', {
    class: 'lt-input', type: 'text', placeholder, value: ts.search || '',
    oninput: (e) => { ts.search = e.target.value; ts.page = 0; rerender(); },
  });
  return input;
}

/** Pager row. q is the applyTableQuery result; ts the page's table state. */
export function pagerRow(q, ts, rerender) {
  if (q.pages <= 1) return null;
  return el('div', { class: 'lt-pager' },
    el('button', {
      class: 'lt-mini', text: '‹ Prev', disabled: q.page <= 0 ? 'disabled' : undefined,
      onclick: () => { ts.page = Math.max(0, q.page - 1); rerender(); },
    }),
    el('span', { text: `Page ${q.page + 1} of ${q.pages} · ${q.total} rows` }),
    el('button', {
      class: 'lt-mini', text: 'Next ›', disabled: q.page >= q.pages - 1 ? 'disabled' : undefined,
      onclick: () => { ts.page = Math.min(q.pages - 1, q.page + 1); rerender(); },
    }));
}

/** Filter pill strip. options: [{value,label}]; ts.filter holds the current value. */
export function filterTabs(ts, options, rerender, field = 'filter') {
  return el('div', { class: 'lt-tabs', style: 'margin-bottom:0' },
    ...options.map((o) => el('button', {
      class: `lt-tab ${ts[field] === o.value ? 'on' : ''}`,
      text: o.label,
      onclick: () => { ts[field] = o.value; ts.page = 0; rerender(); },
    })));
}
