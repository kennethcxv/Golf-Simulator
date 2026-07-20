import { el } from './ui.js';
import { liveGolfSummary } from '../sim/golfDay.js';

const titleCase = (value) => String(value || '')
  .split('-')
  .map((word) => word ? word[0].toUpperCase() + word.slice(1) : '')
  .join(' ');

function scoreText(party) {
  const golfer = party.golfers[party.currentGolferIndex] || party.golfers[0];
  if (!golfer) return '—';
  const completed = party.scorecard.filter((hole) => hole.complete);
  const completedPar = completed.reduce((sum, hole) => sum + hole.par, 0);
  const delta = golfer.totalStrokes - completedPar;
  const relative = delta === 0 ? 'E' : delta > 0 ? `+${delta}` : String(delta);
  const current = golfer.holeStrokes
    ? `${golfer.holeStrokes} ${golfer.holeStrokes === 1 ? 'stroke' : 'strokes'}`
    : '';
  if (!completed.length) return current || '—';
  return current ? `${relative} · ${current}` : relative;
}

export function makeGolfDayPanel(app) {
  const body = el('div', { class: 'golf-live-body' });
  const root = el('section', { class: 'golf-live-panel', 'aria-label': 'Live course operations' }, body);
  let signature = '';
  let lastPaintAt = -Infinity;

  function update(force = false) {
    const now = performance.now();
    if (!force && now - lastPaintAt < 400) return;
    lastPaintAt = now;
    const state = app.state;
    if (!state?.golfDay) {
      root.style.display = 'none';
      return;
    }
    const summary = liveGolfSummary(state);
    const parties = state.golfDay.parties.slice(0, 3);
    const latest = summary.latestCompleted;
    const marshalAlerts = state.golfDay.marshalTasks.filter((task) => task.status !== 'complete');
    const shouldShow = summary.congestion.level !== 'clear'
      || marshalAlerts.length > 0
      || state.golfDay.starter.currentPartyId != null;
    const nextSignature = JSON.stringify({
      congestion: summary.congestion,
      queue: summary.starterQueue,
      carts: summary.cartsAssigned,
      practice: summary.practice,
      marshal: marshalAlerts.map((task) => [task.id, task.status]),
      starterCurrent: state.golfDay.starter.currentPartyId,
      parties: parties.map((party) => [
        party.id, party.state, party.holeIndex, party.currentGolferIndex,
        party.pace.waitingMinutes, party.pace.behindMinutes,
        party.golfers.map((golfer) => [golfer.totalStrokes, golfer.holeStrokes]),
      ]),
      latest: latest?.id,
    });
    if (nextSignature === signature) return;
    signature = nextSignature;
    root.style.display = shouldShow ? '' : 'none';
    if (!shouldShow) return;
    const nodes = [
      el('div', { class: 'golf-live-head' },
        el('span', { class: 'golf-live-kicker', text: 'COURSE LIVE' }),
        el('span', { class: `golf-live-congestion ${summary.congestion.level}`, text: titleCase(summary.congestion.level) })),
      marshalAlerts.length ? el('div', { class: 'golf-live-alert', text: `${marshalAlerts.length} pace alert${marshalAlerts.length === 1 ? '' : 's'} · use the Course laptop page` }) : null,
      el('div', { class: 'golf-live-metrics' },
        el('span', { text: `${summary.activeParties} groups` }),
        el('span', { text: `${summary.starterQueue.length} starter queue` }),
        el('span', { text: `${summary.cartsAssigned} carts out` })),
      ...parties.map((party) => el('article', { class: 'golf-live-party' },
        el('div', { class: 'golf-live-partyline' },
          el('strong', { text: party.partyName }),
          el('span', { text: `H${Math.min(party.scorecard.length, party.holeIndex + 1)} · ${scoreText(party)}` })),
        el('div', { class: 'golf-live-phase', text: titleCase(party.state) }),
        el('div', { class: 'golf-live-detail' },
          el('span', { text: party.transport === 'ride' ? `Cart ${party.cartId?.replace('cart-', '') || '—'}` : 'Walking' }),
          party.state === 'practicing' && party.practiceKind
            ? el('span', { text: titleCase(party.practiceKind) })
            : null,
          party.pace.waitingMinutes > 0 ? el('span', { class: 'warn', text: `${Math.round(party.pace.waitingMinutes)}m waiting` }) : null,
          party.pace.behindMinutes > 0 ? el('span', { class: 'warn', text: `${Math.round(party.pace.behindMinutes)}m behind` }) : null)),
      ),
      !parties.length && latest
        ? el('div', { class: 'golf-live-latest' },
          el('strong', { text: `${latest.partyName} finished` }),
          el('span', { text: `${latest.durationMinutes} min · ${latest.scores.map((score) => score.total).join(' / ')}` }))
        : null,
      !parties.length && !latest
        ? el('div', { class: 'golf-live-empty', text: 'No checked-in groups on the course.' })
        : null,
    ].filter(Boolean);
    body.replaceChildren(...nodes);
  }

  return { root, update };
}
