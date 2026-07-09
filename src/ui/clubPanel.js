// FAIRWAY STATE — Club panel: membership, pricing, staff, amenities, outings,
// the news feed, and yesterday's books. The management desk of the clubhouse.

import { el, toast, modal } from './ui.js';
import { formatMoney } from '../core/utils.js';
import {
  TIERS, AMENITIES, memberCounts, clubRatings, amenityScore, fairGreenFee, fairDues,
  upgradeAmenity, acceptOuting, declineOuting,
} from '../sim/club.js';
import { members } from '../sim/golfers.js';
import { hireStaff, fireStaff, trainStaff, ROLE } from '../sim/staff.js';
import { calendarOf } from '../sim/time.js';

const ROLE_LABEL = { groundskeeper: '⛳ Groundskeeper', instructor: '🎯 Instructor', fnb: '🍽 Food & Bev' };

function stars(skill) {
  const full = Math.round(skill);
  return '★'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
}

export function makeClubPanel(app, onStateChanged) {
  const body = el('div');
  const root = el('div', { class: 'panel grounds-panel', style: 'display:none' },
    el('h3', { text: 'Club Office' }), body);

  function stepper(value, step, min, onSet, fmt = (v) => formatMoney(v)) {
    const label = el('span', { text: fmt(value), style: 'min-width:74px;display:inline-block;text-align:center' });
    return el('div', { class: 'row', style: 'gap:4px;display:inline-flex' },
      el('button', { text: '−', onclick: () => { onSet(Math.max(min, value - step)); refresh(); } }),
      label,
      el('button', { text: '+', onclick: () => { onSet(value + step); refresh(); } }),
    );
  }

  function refresh() {
    const st = app.state;
    if (!st || !st.club) return;
    const club = st.club;
    const ratings = clubRatings(st);
    const amen = amenityScore(st);
    const counts = memberCounts(st);
    const ms = members(st);
    const avgSat = ms.length ? Math.round(ms.reduce((a, g) => a + g.satisfaction, 0) / ms.length) : 0;
    const dayAbs = calendarOf(st.clock.minutes).dayAbs;
    const rows = [];

    // --- overview ---------------------------------------------------------
    rows.push(
      el('div', { class: 'row' },
        el('span', { class: 'status-chip', text: `Reputation ${Math.round(club.reputation)}` }),
        el('span', { class: 'status-chip', text: `Members ${counts.weekday + counts.full + counts.premium}` }),
        el('span', { class: 'status-chip', text: `Satisfaction ${avgSat}` }),
        el('span', { class: 'status-chip', text: `Rounds ${club.lastRounds ?? '—'}/day` }),
      ),
    );
    const y = st.ledger.yesterday;
    if (y) {
      rows.push(el('div', {
        class: 'row muted',
        text: `Yesterday: ${formatMoney(y.revenueTotal)} in · ${formatMoney(y.expenseTotal)} out · net ${formatMoney(y.net)}`,
      }));
    }

    // --- pricing ----------------------------------------------------------
    rows.push(el('h3', { text: 'Pricing', style: 'margin-top:10px' }));
    rows.push(el('div', { class: 'row' },
      el('strong', { text: 'Green fee', style: 'width:110px' }),
      stepper(club.greenFee, 2, 6, (v) => { club.greenFee = v; }),
      el('span', { class: 'muted', text: `fair ≈ ${formatMoney(fairGreenFee(ratings.overall, amen))}` }),
    ));
    for (const tier of Object.keys(TIERS)) {
      rows.push(el('div', { class: 'row' },
        el('strong', { text: TIERS[tier].name, style: 'width:110px' }),
        stepper(club.dues[tier], 20, 40, (v) => { club.dues[tier] = v; }),
        el('span', { class: 'muted', text: `${counts[tier]} members · fair ≈ ${formatMoney(fairDues(st, tier, ratings.overall, amen))}/season` }),
      ));
    }

    // --- staff --------------------------------------------------------------
    rows.push(el('h3', { text: `Payroll (${st.staff.employees.length})`, style: 'margin-top:10px' }));
    if (!st.staff.employees.length) rows.push(el('div', { class: 'row muted', text: 'Nobody on salary — just you and the day-labor crew.' }));
    for (const emp of st.staff.employees) {
      rows.push(el('div', { class: 'row' },
        el('span', { text: ROLE_LABEL[emp.role], style: 'width:150px' }),
        el('span', { text: `${emp.name} ${stars(emp.skill)}`, style: 'flex:1' }),
        el('span', { class: 'muted', text: `${formatMoney(emp.wage)}/d` }),
        emp.trainingDays > 0
          ? el('span', { class: 'muted', text: `📚 ${emp.trainingDays}d` })
          : el('button', {
              text: 'Train',
              title: 'Two days away, +half a star',
              onclick: () => {
                const res = trainStaff(st, emp.id);
                toast(res.ok ? `${emp.name} sent on a course (${formatMoney(res.cost)}).` : res.reason, res.ok ? '' : 'warn');
                refresh(); onStateChanged?.();
              },
            }),
        el('button', {
          class: 'danger', text: '✕', title: 'Let go (3 days severance)',
          onclick: () => {
            const res = fireStaff(st, emp.id);
            toast(res.ok ? `${emp.name} let go (${formatMoney(res.severance)} severance).` : res.reason, 'warn');
            refresh(); onStateChanged?.();
          },
        }),
      ));
    }
    rows.push(el('h3', { text: 'Hiring market', style: 'margin-top:8px' }));
    for (const c of st.staff.market) {
      rows.push(el('div', { class: 'row' },
        el('span', { text: ROLE_LABEL[c.role], style: 'width:150px' }),
        el('span', { text: `${c.name} ${stars(c.skill)}`, style: 'flex:1' }),
        el('span', { class: 'muted', text: `${formatMoney(c.wage)}/d` }),
        el('button', {
          class: 'primary', text: 'Hire',
          onclick: () => {
            const res = hireStaff(st, c.id);
            toast(res.ok ? `${c.name} joins the team.` : res.reason, res.ok ? '' : 'warn');
            refresh(); onStateChanged?.();
          },
        }),
      ));
    }
    rows.push(el('div', { class: 'muted', text: 'New candidates come through every few days.' }));

    // --- amenities ------------------------------------------------------------
    rows.push(el('h3', { text: 'Amenities', style: 'margin-top:10px' }));
    for (const key of Object.keys(AMENITIES)) {
      const spec = AMENITIES[key];
      const level = st.club.amenities[key];
      const atMax = level >= spec.maxLevel;
      const needNote =
        key === 'instruction' && level > 0 && !st.staff.employees.some((e) => e.role === ROLE.INSTRUCTOR)
          ? ' — needs an instructor!'
          : '';
      rows.push(el('div', { class: 'row' },
        el('strong', { text: spec.name, style: 'width:150px' }),
        el('span', { class: 'muted', text: `Level ${level}/${spec.maxLevel}${needNote}`, style: 'flex:1' }),
        atMax ? null : el('button', {
          text: `Upgrade ${formatMoney(spec.cost[level])}`,
          onclick: () => {
            const res = upgradeAmenity(st, key);
            toast(res.ok ? `${spec.name} upgraded.` : res.reason, res.ok ? '' : 'warn');
            refresh(); onStateChanged?.();
          },
        }),
      ));
    }

    // --- outings ------------------------------------------------------------------
    rows.push(el('h3', { text: 'Corporate outings', style: 'margin-top:10px' }));
    if (!club.outings.offers.length && !club.outings.scheduled.length) {
      rows.push(el('div', { class: 'row muted', text: 'No offers on the desk.' }));
    }
    for (const o of club.outings.offers) {
      rows.push(el('div', { class: 'row' },
        el('span', { text: `${o.company}`, style: 'flex:1' }),
        el('span', { class: 'muted', text: `${o.size} players · day ${o.day - dayAbs > 0 ? `+${o.day - dayAbs}` : 'today'} · ${formatMoney(o.payout)}` }),
        el('button', { class: 'primary', text: 'Book', onclick: () => { acceptOuting(st, o.id); refresh(); } }),
        el('button', { text: 'Pass', onclick: () => { declineOuting(st, o.id); refresh(); } }),
      ));
    }
    for (const o of club.outings.scheduled) {
      rows.push(el('div', { class: 'row muted', text: `Booked: ${o.company}, ${o.size} players, in ${Math.max(0, o.day - dayAbs)} day(s) — members will grumble that day.` }));
    }

    // --- the regulars (the persistent-golfer heart of the club) -------------------
    rows.push(el('h3', { text: 'The regulars', style: 'margin-top:10px' }));
    const regulars = ms
      .filter((g) => (g.roundsPlayed || 0) > 0)
      .sort((a, b) => (b.champion ? 1 : 0) - (a.champion ? 1 : 0) || (b.roundsPlayed || 0) - (a.roundsPlayed || 0))
      .slice(0, 6);
    if (!regulars.length) {
      rows.push(el('div', { class: 'row muted', text: 'Nobody has teed it up yet — give it a day.' }));
    }
    for (const g of regulars) {
      const lastThought = g.memory && g.memory[0] && g.memory[0].thoughts[0];
      rows.push(el('div', { class: 'row', style: 'font-size:0.88rem;cursor:pointer', onclick: () => showGolferCard(g) },
        el('span', { text: `${g.champion ? '⭐ ' : ''}${g.name}`, style: 'width:150px;font-weight:600' }),
        el('span', { class: 'muted', text: `${TIERS[g.memberTier].name} · cap ${g.skill.toFixed(1)} · 😊${Math.round(g.satisfaction)} · ${g.roundsPlayed} rds` }),
      ));
      if (lastThought) {
        rows.push(el('div', { class: 'row muted', style: 'font-size:0.82rem;padding-left:12px;font-style:italic', text: `“${lastThought}”` }));
      }
    }

    // --- feed ------------------------------------------------------------------------
    rows.push(el('h3', { text: 'Around the club', style: 'margin-top:10px' }));
    if (!club.feed.length) rows.push(el('div', { class: 'row muted', text: 'Quiet so far.' }));
    for (const f of club.feed.slice(0, 9)) {
      const icon =
        f.kind === 'join' ? '🟢' : f.kind === 'quit' ? '🔴' : f.kind === 'quit-forever' ? '⛔' :
        f.kind === 'offer' ? '📨' : f.kind === 'outing' ? '🏢' : f.kind === 'champion' ? '⭐' :
        f.kind === 'thought' ? (f.mood === 'bad' ? '💢' : f.mood === 'good' ? '💬' : '💭') : '🛠';
      rows.push(el('div', { class: 'row muted', style: 'font-size:0.87rem', text: `${icon} ${f.text}` }));
    }

    // --- books ------------------------------------------------------------------------
    if (y) {
      rows.push(el('h3', { text: "Yesterday's books", style: 'margin-top:10px' }));
      const lines = [];
      for (const [k, v] of Object.entries(y.revenue)) if (v > 0) lines.push(`+ ${k}: ${formatMoney(v)}`);
      for (const [k, v] of Object.entries(y.expense)) if (v > 0) lines.push(`− ${k}: ${formatMoney(v)}`);
      const hist = st.ledger.history.slice(-7);
      const weekNet = hist.reduce((a, d) => a + d.net, 0);
      lines.push(`7-day net: ${formatMoney(weekNet)}`);
      rows.push(el('div', { class: 'muted', style: 'white-space:pre-line;font-size:0.85rem;line-height:1.5', text: lines.join('\n') }));
    }

    body.replaceChildren(...rows);
  }

  function showGolferCard(g) {
    modal(`${g.champion ? '⭐ ' : ''}${g.name}`, (box, close) => {
      box.append(
        el('div', { class: 'row muted' },
          `${TIERS[g.memberTier] ? TIERS[g.memberTier].name : 'Not a member'} · handicap ${g.skill.toFixed(1)} · ` +
          `${g.roundsPlayed} rounds here · best ${g.bestScore ?? '—'} · picky about ${g.persona}`),
        el('div', { class: 'row' },
          el('span', { class: 'status-chip', text: `Satisfaction ${Math.round(g.satisfaction)}` }),
          g.fittedDay != null ? el('span', { class: 'status-chip', text: 'Recently fitted' }) : null,
        ),
        el('h2', { text: 'Recent visits', style: 'font-size:1rem;margin-top:10px' }),
      );
      if (!g.memory || !g.memory.length) {
        box.append(el('div', { class: 'row muted', text: 'No rounds on record yet.' }));
      }
      for (const m of (g.memory || []).slice(0, 6)) {
        box.append(el('div', { class: 'row muted', style: 'font-size:0.85rem', text: `Day ${m.day + 1} — shot ${m.score}` }));
        for (const t of m.thoughts) {
          box.append(el('div', { class: 'row', style: 'font-size:0.84rem;padding-left:12px;font-style:italic;color:var(--text-dim)', text: `“${t}”` }));
        }
      }
      box.append(el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', { class: 'primary', text: 'Close', onclick: close })));
    });
  }

  function setVisible(v) {
    root.style.display = v ? '' : 'none';
    app.clubOpen = v;
    if (v) refresh();
  }

  return { root, refresh, setVisible };
}
