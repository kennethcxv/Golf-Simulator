// TEE DESK - the player-facing golf check-in surface.
//
// This is deliberately separate from merchandise checkout. It uses the same
// counter and familiar payment feedback, but the transaction is a reservation
// balance: there are no fake products and no scanner step.

import { cashTender } from '../sim/checkout.js';
import { judgeSwipe, SWIPE_MSG } from '../sim/cardSwipe.js';
import { calendarOf, formatDate } from '../sim/time.js';
import {
  addGuestToReservation,
  availableSlots,
  resolveTeeTimeRequest,
  beginReservationPayment,
  cancelReservation,
  cancelReservationPayment,
  checkInReservation,
  completeReservationPayment,
  confirmReservation,
  createWalkInBooking,
  daySheet,
  dueForCheckIn,
  fmtSlot,
  handleNoShow,
  markReservationLate,
  moveReservation,
  operationsPolicySummary,
  operationsSummary,
  reservationById,
} from '../sim/reservations.js';
import { teeTimeOffers } from '../sim/teeTimeOffer.js';
import { el, toast } from './ui.js';
import {
  CUSTOMER_INTENT, CUSTOMER_STATE, customerSimulationOf, customerById, walkInRequestDeclined,
} from '../sim/customerSimulation.js';
import { DEFAULT_CLUB_NAME } from '../sim/state.js';

const money = (value) => Number(value || 0).toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const statusLabel = (reservation) => {
  if (reservation.status === 'cancelled') return ['Cancelled', 'bad'];
  if (reservation.status === 'noShow') return ['No-show', 'bad'];
  if (reservation.courseAccess?.status === 'departed') return ['Departed', 'ok'];
  if (reservation.checkIn?.status === 'checked-in') return ['Course ready', 'ok'];
  if (reservation.arrival?.status === 'late') return ['Late · waiting', 'warn'];
  if (reservation.arrival?.status === 'arrived') return ['Waiting', 'warn'];
  if (reservation.arrival?.lateMarkedAtMinute != null) return ['Late · not here', 'bad'];
  return ['Scheduled', ''];
};

const paymentLabel = (reservation) => {
  const payment = reservation.payment;
  if (payment.status === 'member-pass') return ['Member pass', 'ok'];
  if (payment.status === 'paid') return ['Paid', 'ok'];
  if (payment.status === 'deposit') return [`Deposit · ${money(payment.amountDue)} due`, 'warn'];
  return [`${money(payment.amountDue)} due`, 'bad'];
};

const arrivalCopy = (reservation) => {
  const arrival = reservation.arrival;
  if (arrival.status === 'no-show') return 'Grace period expired';
  if (arrival.status === 'cancelled') return 'Booking cancelled';
  if (arrival.arrivedAtMinute != null) {
    const delta = arrival.arrivedAtMinute - (reservation.dayAbs * 1440 + reservation.minute);
    if (delta < 0) return `${Math.abs(delta)} min early`;
    if (delta > 0) return `${delta} min late`;
    return 'On time';
  }
  if (arrival.lateMarkedAtMinute != null) return 'Late · not yet present';
  return 'Not yet arrived';
};

function partyLine(reservation) {
  return reservation.party.members.map((member) => member.name).join(' · ');
}

const titleCase = (value) => String(value || '')
  .replace(/-/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

export function frontDeskDisplayBrand(state) {
  return String(state?.clubName || DEFAULT_CLUB_NAME).trim() || DEFAULT_CLUB_NAME;
}

export function makeFrontDesk(app, options = {}) {
  let selectedId = null;
  let tab = 'arrivals';
  let confirm = null;
  let notice = null;
  let showReceipt = null;
  let swipeMessage = 'Start at the top and swipe down';
  let swipeGestureActive = false;
  let cashDrawerOpen = false;
  let guestName = '';
  let renderedSignature = '';
  const walkInDraft = {
    holder: '',
    partySize: 1,
    slotValue: '',
    checkInImmediately: true,
  };

  const content = el('div', { class: 'fd-content' });
  const root = el('section', { class: 'front-desk', style: 'display:none' },
    el('div', { class: 'fd-world-shade' }),
    el('div', { class: 'fd-shell' }, content),
  );
  root.addEventListener('pointerdown', (event) => event.stopPropagation());
  root.addEventListener('click', (event) => event.stopPropagation());

  const audio = (name) => {
    if (app.audio?.ready && typeof app.audio[name] === 'function') app.audio[name]();
  };
  const chip = (text, tone = '') => el('span', { class: `fd-chip ${tone}`, text });
  const button = (text, onClick, kind = '', disabled = false) => el('button', {
    class: `fd-btn ${kind}`,
    text,
    disabled: disabled ? 'disabled' : undefined,
    onclick: () => { audio('uiTick'); onClick(); },
  });
  const fact = (label, value, sub = '') => el('div', { class: 'fd-fact' },
    el('span', { class: 'fd-fact-label', text: label }),
    el('strong', { text: value }),
    sub ? el('span', { class: 'fd-fact-sub', text: sub }) : null,
  );

  function currentReservation() {
    return selectedId == null ? null : reservationById(app.state, selectedId);
  }

  function stateSignature() {
    if (!app.state?.reservations) return 'no-state';
    const cal = calendarOf(app.state.clock.minutes);
    return [
      cal.dayAbs,
      frontDeskDisplayBrand(app.state),
      tab,
      selectedId,
      ...app.state.reservations.booked.map((reservation) => [
        reservation.id,
        reservation.dayAbs,
        reservation.minute,
        reservation.status,
        reservation.partySize,
        reservation.arrival?.status,
        reservation.arrival?.lateMarkedAtMinute,
        reservation.checkIn?.status,
        reservation.courseAccess?.status,
        reservation.payment?.status,
        reservation.payment?.amountDue,
        reservation.payment?.pending?.transactionId,
        reservation.payment?.pending?.status,
      ].join(':')),
    ].join('|');
  }

  function setNotice(text, tone = '') {
    notice = { text, tone };
  }

  function ask(text, actionLabel, action) {
    confirm = { text, actionLabel, action };
    render();
  }

  function confirmBar() {
    if (!confirm) return null;
    return el('div', { class: 'fd-confirm' },
      el('span', { text: confirm.text }),
      button('Back', () => { confirm = null; render(); }),
      button(confirm.actionLabel, () => {
        const action = confirm.action;
        confirm = null;
        action();
      }, 'danger'),
    );
  }

  function receiptPanel() {
    if (!showReceipt) return null;
    return el('div', { class: 'fd-receipt-wrap' },
      el('div', { class: 'fd-receipt' },
        el('div', {
          class: 'fd-receipt-brand',
          text: `${frontDeskDisplayBrand(app.state).toUpperCase()} · TEE DESK`,
        }),
        el('div', { class: 'fd-receipt-rule' }),
        el('strong', { text: showReceipt.holder }),
        el('span', { text: `${fmtSlot(showReceipt.minute)} · ${showReceipt.partySize} player${showReceipt.partySize === 1 ? '' : 's'}` }),
        el('span', { text: `${showReceipt.method.toUpperCase()}  ${money(showReceipt.amount)}` }),
        showReceipt.change > 0 ? el('span', { text: `CHANGE  ${money(showReceipt.change)}` }) : null,
        el('div', { class: 'fd-receipt-rule' }),
        el('small', { text: showReceipt.id }),
      ),
      button('Take receipt', () => {
        audio('paper');
        showReceipt = null;
        render();
      }, 'primary'),
    );
  }

  function completePayment(reservation, input) {
    const result = completeReservationPayment(app.state, reservation.id, input);
    if (!result.ok) {
      audio(result.declined ? 'decline' : 'thunk');
      setNotice(result.reason || 'Payment did not complete.', 'bad');
      render();
      return;
    }
    const receipt = reservation.payment.receipts.find((entry) => entry.id === result.receiptId)
      || reservation.payment.receipts.at(-1);
    audio('approve');
    setTimeout(() => audio('receipt'), 180);
    showReceipt = {
      ...receipt,
      holder: reservation.reservationHolder,
      minute: reservation.minute,
      partySize: reservation.partySize,
    };
    cashDrawerOpen = false;
    setNotice(`${money(result.amount)} received exactly once.`, 'ok');
    render();
  }

  function cardPayment(reservation, pending) {
    const track = el('div', { class: 'fd-swipe-track', 'aria-label': 'Card swipe track' },
      el('span', { class: 'fd-swipe-top', text: 'START' }),
      el('span', { class: 'fd-swipe-bottom', text: 'FINISH' }),
    );
    const card = el('div', { class: 'fd-card', text: 'FAIRWAY MEMBER' });
    track.append(card);
    let samples = [];
    let dragging = false;

    const reset = () => { card.style.transform = 'translate(-50%, 0)'; };
    card.addEventListener('pointerdown', (event) => {
      dragging = true;
      swipeGestureActive = true;
      samples = [];
      card.setPointerCapture(event.pointerId);
      const bounds = track.getBoundingClientRect();
      const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      samples.push({ y, t: performance.now() / 1000 });
      event.preventDefault();
    });
    card.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const bounds = track.getBoundingClientRect();
      const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      samples.push({ y, t: performance.now() / 1000 });
      card.style.transform = `translate(-50%, ${Math.round(y * (bounds.height - card.offsetHeight))}px)`;
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      swipeGestureActive = false;
      if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
      const judged = judgeSwipe(samples);
      swipeMessage = SWIPE_MSG[judged.code];
      if (judged.ok) {
        audio('cardTap');
        completePayment(reservation, { transactionId: pending.transactionId, cardApproved: true });
      } else {
        audio('decline');
        reset();
        render();
      }
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);

    return el('div', { class: 'fd-payment-card' },
      el('div', { class: 'fd-pay-head' },
        el('span', {}, el('small', { text: 'CARD BALANCE' }), el('strong', { text: money(pending.amount) })),
        chip('Not charged yet', 'warn')),
      track,
      el('div', { class: 'fd-swipe-message', text: swipeMessage }),
      button('Cancel payment', () => {
        cancelReservationPayment(app.state, reservation.id, pending.transactionId);
        swipeMessage = 'Start at the top and swipe down';
        render();
      }),
    );
  }

  function cashPayment(reservation, pending) {
    const tendered = cashTender(pending.amount, () => 0);
    const change = Math.round((tendered - pending.amount) * 100) / 100;
    return el('div', { class: 'fd-payment-cash' },
      el('div', { class: 'fd-pay-head' },
        el('span', {}, el('small', { text: 'CASH BALANCE' }), el('strong', { text: money(pending.amount) })),
        chip('Not charged yet', 'warn')),
      el('div', { class: `fd-cash-drawer ${cashDrawerOpen ? 'open' : ''}` },
        el('div', { class: 'fd-cash-counter' },
          el('span', { text: 'Customer tender' }),
          el('strong', { text: money(tendered) })),
        el('div', { class: 'fd-drawer-tray' },
          ...[20, 10, 5, 1].map((value) => el('span', { class: 'fd-bill', text: `$${value}` }))),
      ),
      el('div', { class: 'fd-cash-summary' },
        el('span', { text: cashDrawerOpen ? `Return ${money(change)} change` : 'Open the drawer before accepting cash' }),
        !cashDrawerOpen
          ? button('Open drawer', () => { cashDrawerOpen = true; audio('drawer'); render(); }, 'primary')
          : button(`Accept ${money(tendered)} & print`, () => {
            audio('coin');
            completePayment(reservation, { transactionId: pending.transactionId, tendered });
          }, 'primary')),
      button('Cancel payment', () => {
        cancelReservationPayment(app.state, reservation.id, pending.transactionId);
        cashDrawerOpen = false;
        render();
      }),
    );
  }

  function paymentPanel(reservation) {
    const payment = reservation.payment;
    if (payment.pending) {
      if (payment.pending.status === 'declined') {
        cancelReservationPayment(app.state, reservation.id, payment.pending.transactionId);
      }
      const pending = reservation.payment.pending;
      if (pending?.method === 'card') return cardPayment(reservation, pending);
      if (pending?.method === 'cash') return cashPayment(reservation, pending);
    }
    if (payment.amountDue <= 0) {
      return el('div', { class: 'fd-paid' },
        el('span', { class: 'fd-paid-mark', text: '✓' }),
        el('span', {}, el('strong', { text: payment.status === 'member-pass' ? 'Member access verified' : 'Paid in full' }),
          el('small', { text: payment.receipts.length ? `Receipt ${payment.receipts.at(-1).id}` : 'No payment required' })),
      );
    }
    return el('div', { class: 'fd-payment-choice' },
      el('div', {},
        el('small', { text: payment.amountPaid > 0 ? `${money(payment.amountPaid)} already paid` : 'BALANCE DUE' }),
        el('strong', { text: money(payment.amountDue) })),
      el('div', { class: 'fd-payment-actions' },
        button('Pay cash', () => {
          const result = beginReservationPayment(app.state, reservation.id, 'cash');
          if (!result.ok) setNotice(result.reason, 'bad');
          cashDrawerOpen = false;
          render();
        }, 'cash'),
        button('Pay by card', () => {
          const result = beginReservationPayment(app.state, reservation.id, 'card');
          if (!result.ok) setNotice(result.reason, 'bad');
          swipeMessage = 'Start at the top and swipe down';
          render();
        }, 'card'),
      ),
    );
  }

  function moveControl(reservation) {
    const config = app.state.reservations.config;
    const todayAbs = calendarOf(app.state.clock.minutes).dayAbs;
    const choices = [];
    for (let dayOffset = 0; dayOffset <= config.horizonDays && choices.length < 36; dayOffset++) {
      const dayAbs = todayAbs + dayOffset;
      for (const slot of availableSlots(app.state, dayAbs, { partySize: reservation.partySize })) {
        if (dayAbs === reservation.dayAbs && slot.minute === reservation.minute) continue;
        choices.push({ dayAbs, minute: slot.minute, label: `${dayOffset === 0 ? 'Today' : dayOffset === 1 ? 'Tomorrow' : `+${dayOffset}d`} · ${fmtSlot(slot.minute)} · ${slot.availableSeats} open` });
        if (choices.length >= 36) break;
      }
    }
    const select = el('select', { class: 'fd-select', 'aria-label': 'Move reservation slot' },
      el('option', { value: '', text: choices.length ? 'Choose an open slot' : 'No suitable slot' }),
      ...choices.map((choice) => el('option', { value: `${choice.dayAbs}:${choice.minute}`, text: choice.label })),
    );
    return el('div', { class: 'fd-inline-action' }, select, button('Move', () => {
      if (!select.value) return;
      const [dayAbs, minute] = select.value.split(':').map(Number);
      const result = moveReservation(app.state, reservation.id, dayAbs, minute);
      setNotice(result.ok ? `Moved to ${fmtSlot(minute)}.` : result.reason, result.ok ? 'ok' : 'bad');
      render();
    }, '', !choices.length));
  }

  function guestControl(reservation) {
    const input = el('input', {
      class: 'fd-input', type: 'text', placeholder: 'Guest name', value: guestName,
      'aria-label': 'Guest name',
      oninput: (event) => { guestName = event.target.value; },
    });
    return el('div', { class: 'fd-inline-action' }, input, button('Add guest', () => {
      const result = addGuestToReservation(app.state, reservation.id, guestName);
      if (result.ok) {
        setNotice(`${guestName} added. ${money(result.amountDueAdded)} added to the balance.`, 'ok');
        guestName = '';
      } else setNotice(result.reason, 'bad');
      render();
    }));
  }

  function reservationDetails(reservation) {
    const [status, statusTone] = statusLabel(reservation);
    const [payStatus, payTone] = paymentLabel(reservation);
    const terminal = ['cancelled', 'noShow'].includes(reservation.status);
    const present = ['arrived', 'late'].includes(reservation.arrival.status);
    const confirmed = reservation.checkIn.status === 'confirmed';
    const paid = reservation.payment.amountDue <= 0;

    return el('div', { class: 'fd-detail' },
      el('div', { class: 'fd-detail-head' },
        el('div', {},
          el('span', { class: 'fd-kicker', text: reservation.walkIn ? 'WALK-IN BOOKING' : 'RESERVATION' }),
          el('h2', { text: reservation.reservationHolder }),
          el('p', { text: reservation.partySize === 1 ? 'Solo player' : partyLine(reservation) })),
        el('div', { class: 'fd-head-chips' }, chip(status, statusTone), chip(payStatus, payTone))),
      el('div', { class: 'fd-facts' },
        fact('Tee time', fmtSlot(reservation.minute), formatDate(calendarOf(reservation.dayAbs * 1440))),
        fact('Party', `${reservation.partySize} player${reservation.partySize === 1 ? '' : 's'}`, titleCase(reservation.membershipStatus)),
        fact('Arrival', arrivalCopy(reservation), reservation.arrival.status),
        fact('Total', money(reservation.payment.total), reservation.payment.depositPaid ? `${money(reservation.payment.depositPaid)} deposit` : 'green fees'),
      ),
      reservation.notes.length ? el('div', { class: 'fd-notes' }, el('strong', { text: 'Notes' }), el('span', { text: reservation.notes.join(' · ') })) : null,
      notice ? el('div', { class: `fd-notice ${notice.tone}`, text: notice.text }) : null,
      confirmBar(),
      !terminal && reservation.checkIn.status !== 'checked-in' ? el('div', { class: 'fd-service-grid' },
        el('section', { class: 'fd-card-panel' },
          el('h3', { text: '1 · Confirm party' }),
          el('p', { text: confirmed ? 'Reservation and party confirmed.' : 'Verify the holder, tee time, and party before taking payment.' }),
          button(confirmed ? 'Confirmed' : 'Confirm reservation', () => {
            const result = confirmReservation(app.state, reservation.id);
            setNotice(result.ok ? 'Reservation confirmed.' : result.reason, result.ok ? 'ok' : 'bad');
            render();
          }, confirmed ? 'done' : 'primary', confirmed || !present),
          guestControl(reservation),
          moveControl(reservation),
        ),
        el('section', { class: 'fd-card-panel' },
          el('h3', { text: '2 · Settle balance' }),
          paymentPanel(reservation),
        ),
        el('section', { class: 'fd-card-panel fd-finalize' },
          el('h3', { text: '3 · Course access' }),
          el('p', { text: paid ? 'Payment requirement cleared.' : `${money(reservation.payment.amountDue)} must be settled before check-in.` }),
          button('Check in party', () => {
            const result = checkInReservation(app.state, reservation.id);
            if (result.ok) {
              audio('chime');
              setNotice(`Course access granted · ${result.courseAccess.assignedCourse} · Hole ${result.courseAccess.startingHole}.`, 'ok');
              options.onCheckedIn?.(reservation.id);
              toast(`${reservation.reservationHolder} is ready for the first tee.`, 'good');
            } else {
              audio('thunk');
              setNotice(result.reason, 'bad');
            }
            render();
          }, 'primary', !present || !confirmed || !paid),
        ),
      ) : el('div', { class: `fd-complete ${reservation.checkIn.status === 'checked-in' ? 'ok' : ''}` },
        el('strong', { text: reservation.checkIn.status === 'checked-in' ? 'Party cleared for course' : status }),
        el('span', { text: reservation.checkIn.status === 'checked-in'
          ? `${reservation.courseAccess.assignedCourse} · Start at hole ${reservation.courseAccess.startingHole}`
          : (reservation.cancellation.reason || 'No further front-desk action required.') }),
      ),
      !terminal && reservation.checkIn.status !== 'checked-in' ? el('div', { class: 'fd-exception-actions' },
        button('Mark late', () => {
          const result = markReservationLate(app.state, reservation.id);
          setNotice(result.ok ? 'Party marked late.' : result.reason, result.ok ? 'warn' : 'bad');
          render();
        }, '', reservation.arrival.lateMarkedAtMinute != null),
        button('Handle no-show', () => ask(
          `Apply the visible no-show policy to ${reservation.reservationHolder}?`,
          'Mark no-show',
          () => {
            const result = handleNoShow(app.state, reservation.id);
            setNotice(result.ok ? `No-show recorded${result.feeApplied ? ` · ${money(result.feeApplied)} applied` : ''}.` : result.reason, result.ok ? 'warn' : 'bad');
            render();
          },
        )),
        button('Cancel booking', () => ask(
          `Cancel ${reservation.reservationHolder}'s ${fmtSlot(reservation.minute)} booking? Fees and refunds follow the policy shown below.`,
          'Cancel booking',
          () => {
            const result = cancelReservation(app.state, reservation.id);
            setNotice(result.ok ? `Cancelled · ${money(result.refund)} refunded · ${money(result.fee)} retained.` : result.reason, result.ok ? 'warn' : 'bad');
            render();
          },
        ), 'danger'),
      ) : null,
      el('details', { class: 'fd-policy' },
        el('summary', { text: 'Club policy' }),
        ...operationsPolicySummary(app.state).map((line) => el('p', { text: line }))),
    );
  }

  function queuePanel() {
    const cal = calendarOf(app.state.clock.minutes);
    const todayReservations = app.state.reservations.booked
      .filter((reservation) => reservation.dayAbs === cal.dayAbs)
      .sort((a, b) => a.minute - b.minute);
    const waiting = dueForCheckIn(app.state);
    const late = todayReservations.filter((reservation) => (
      reservation.status === 'booked'
      && reservation.arrival.lateMarkedAtMinute != null
      && !waiting.some((entry) => entry.id === reservation.id)
    ));
    const recent = todayReservations.filter((reservation) => (
      ['cancelled', 'noShow', 'played'].includes(reservation.status)
    )).slice(-4);
    const rows = [...waiting, ...late, ...recent]
      .filter((reservation, index, all) => all.findIndex((entry) => entry.id === reservation.id) === index);
    return el('aside', { class: 'fd-queue' },
      el('div', { class: 'fd-queue-head' },
        el('span', { text: 'FRONT DESK' }),
        chip(`${waiting.length} waiting`, waiting.length ? 'warn' : 'ok')),
      rows.length ? el('div', { class: 'fd-queue-list' }, ...rows.map((reservation) => {
        const [status, tone] = statusLabel(reservation);
        return el('button', {
          class: `fd-queue-row ${String(selectedId) === String(reservation.id) ? 'selected' : ''}`,
          onclick: () => { selectedId = reservation.id; notice = null; confirm = null; render(); },
        },
        el('span', { class: 'fd-queue-time', text: fmtSlot(reservation.minute) }),
        el('span', { class: 'fd-queue-name', text: reservation.reservationHolder }),
        el('small', { text: `${reservation.partySize} player${reservation.partySize === 1 ? '' : 's'} · ${status}` }),
        el('i', { class: tone }));
      })) : el('div', { class: 'fd-empty' },
        el('strong', { text: 'Counter clear' }),
        el('span', { text: 'No arrived parties are waiting.' })),
      button('+ Create walk-in', () => { tab = 'walk-in'; notice = null; render(); }, 'walkin'),
    );
  }

  // Who is standing at the desk asking, and for when. Null when the head of
  // the service queue is not a walk-in golfer.
  function waitingWalkInAsk() {
    const sim = customerSimulationOf(app.state);
    const entity = customerById(app.state, sim.serviceQueue?.[0]);
    if (!entity || entity.state !== CUSTOMER_STATE.FRONT_DESK_INQUIRY) return null;
    if (entity.intent !== CUSTOMER_INTENT.WALK_IN_TEE_TIME) return null;
    return {
      id: entity.id,
      name: entity.name,
      requestedTeeMinute: Number.isFinite(entity.requestedTeeMinute) ? entity.requestedTeeMinute : null,
    };
  }

  function walkInPanel() {
    const cal = calendarOf(app.state.clock.minutes);
    const partySize = Number(walkInDraft.partySize);
    const asker = waitingWalkInAsk();
    // The customer's name fills the holder automatically — they are standing
    // right there saying it — and their ask decides the DEFAULT slot through
    // the scheduler, replacing the old first-open-slot-of-the-day default that
    // turned a 4:00 request into 8:30.
    if (asker && !walkInDraft.holder.trim()) walkInDraft.holder = asker.name;
    const resolved = asker && asker.requestedTeeMinute != null
      ? resolveTeeTimeRequest(app.state, cal.dayAbs, asker.requestedTeeMinute, { partySize })
      : null;
    // WHAT TO OFFER, CLUSTERED AROUND THE ASK (B4, 2026-08-03).
    //
    // This list used to be every open slot across the whole horizon, sorted by
    // clock: a 1:00 ask produced forty options running from this morning to the
    // day after tomorrow. The right answer was in there and so was every wrong
    // one. When somebody has said a time, the offers are now the slots NEAR it,
    // nearest first — 1:00, 1:30, 12:30, 2:00 — and only if nothing is inside
    // the window does the list fall back to the nearest single time, marked as
    // such, which is the offer the report asks the player to make.
    //
    // With no ask on the counter (a booking the player is making themselves)
    // the full sheet is still the right list, so that path is unchanged.
    const askedForOffers = asker?.requestedTeeMinute;
    const slots = [];
    let offerBeyondWindow = false;
    if (askedForOffers != null) {
      const open = availableSlots(app.state, cal.dayAbs, { partySize, walkIn: true });
      const offered = teeTimeOffers(open, askedForOffers, { partySize });
      offerBeyondWindow = offered.beyondWindow;
      for (const entry of offered.offers) {
        slots.push({
          value: `${cal.dayAbs}:${entry.slot.minute}`,
          label: `Today · ${fmtSlot(entry.slot.minute)} · ${entry.slot.availableSeats} open`,
        });
      }
    }
    if (!slots.length) {
      for (let offset = 0; offset <= Math.min(2, app.state.reservations.config.horizonDays); offset++) {
        const dayAbs = cal.dayAbs + offset;
        for (const slot of availableSlots(app.state, dayAbs, { partySize, walkIn: true })) {
          slots.push({
            value: `${dayAbs}:${slot.minute}`,
            label: `${offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : `+${offset}d`} · ${fmtSlot(slot.minute)} · ${slot.availableSeats} open`,
          });
        }
      }
    }
    if (!slots.some((slot) => slot.value === walkInDraft.slotValue)) {
      const preferred = resolved?.ok ? `${cal.dayAbs}:${resolved.slot.minute}` : null;
      walkInDraft.slotValue = (preferred && slots.some((slot) => slot.value === preferred))
        ? preferred
        : slots[0]?.value || '';
    }
    let createButton = null;
    const holder = el('input', {
      class: 'fd-input', type: 'text', placeholder: 'Reservation holder', value: walkInDraft.holder,
      'aria-label': 'Walk-in reservation holder',
      oninput: (event) => {
        walkInDraft.holder = event.target.value;
        if (createButton) createButton.disabled = !slots.length || !walkInDraft.holder.trim();
      },
    });
    const size = el('select', {
      class: 'fd-select', 'aria-label': 'Walk-in party size',
      onchange: (event) => { walkInDraft.partySize = Number(event.target.value); walkInDraft.slotValue = ''; render(); },
    }, ...Array.from({ length: app.state.reservations.config.maxPartySize }, (_, index) => el('option', {
      value: String(index + 1), text: `${index + 1} player${index ? 's' : ''}`,
      selected: index + 1 === partySize ? 'selected' : undefined,
    })));
    const asked = asker?.requestedTeeMinute;
    const slot = el('select', {
      class: 'fd-select', 'aria-label': 'Available walk-in slot',
      onchange: (event) => { walkInDraft.slotValue = event.target.value; },
    }, ...slots.map((entry) => {
      // Each option says how far it sits from the ask, so the offer the player
      // is about to make reads as one ("15 min later"), not as a guess.
      let label = entry.label;
      if (asked != null) {
        const [entryDay, entryMinute] = entry.value.split(':').map(Number);
        if (entryDay === cal.dayAbs) {
          const delta = entryMinute - asked;
          label += delta === 0 ? ' · exactly their ask'
            : ` · ${Math.abs(delta)} min ${delta > 0 ? 'later' : 'earlier'}`;
        }
      }
      return el('option', {
        value: entry.value,
        text: label,
        selected: entry.value === walkInDraft.slotValue ? 'selected' : undefined,
      });
    }));
    const immediate = el('input', {
      type: 'checkbox',
      checked: walkInDraft.checkInImmediately ? 'checked' : undefined,
      onchange: (event) => { walkInDraft.checkInImmediately = !!event.target.checked; },
    });

    createButton = button('Create booking', () => {
      if (!walkInDraft.slotValue) {
        setNotice('No real slot has enough capacity.', 'bad');
        render();
        return;
      }
      const [dayAbs, minute] = walkInDraft.slotValue.split(':').map(Number);
      const liveAsker = waitingWalkInAsk();
      const result = createWalkInBooking(app.state, {
        holder: walkInDraft.holder,
        partySize,
        dayAbs,
        minute,
        checkInImmediately: walkInDraft.checkInImmediately,
        requestedMinute: liveAsker?.requestedTeeMinute ?? undefined,
      });
      if (!result.ok) {
        // A DECLINE is the customer's answer, not a validation error: the slot
        // was more than an hour from their ask, they pass, and they leave.
        if (result.declined && liveAsker) {
          walkInRequestDeclined(app.state, liveAsker.id, result.reason);
        }
        setNotice(result.reason, 'bad');
        render();
        return;
      }
      selectedId = result.res.id;
      tab = 'arrivals';
      notice = { text: `Walk-in assigned to ${fmtSlot(result.res.minute)}.`, tone: 'ok' };
      options.onWalkInCreated?.(result.res.id, walkInDraft.checkInImmediately);
      walkInDraft.holder = '';
      walkInDraft.partySize = 1;
      walkInDraft.slotValue = '';
      render();
    }, 'primary', !slots.length || !walkInDraft.holder.trim());

    const askBanner = asker ? el('div', { class: 'fd-notice' },
      el('strong', { text: asker.requestedTeeMinute != null
        ? `${asker.name} is asking for ${fmtSlot(asker.requestedTeeMinute)}`
        : `${asker.name} wants a tee time` }),
      el('span', {
        text: asker.requestedTeeMinute == null ? 'Any open slot suits them.'
          : resolved?.exact ? 'That exact time is open.'
            : resolved?.ok ? `Nearest open is ${fmtSlot(resolved.slot.minute)} (${Math.abs(resolved.deltaMin)} min ${resolved.deltaMin > 0 ? 'later' : 'earlier'}) - they will take anything within an hour.`
              : resolved?.reason || 'Nothing near that time is open.',
      })) : null;

    return el('div', { class: 'fd-walkin-panel' },
      askBanner,
      el('div', { class: 'fd-walkin-head' },
        el('span', { class: 'fd-kicker', text: 'REAL-TIME AVAILABILITY' }),
        el('h2', { text: 'Create walk-in booking' }),
        el('p', { text: 'Only slots with enough live capacity appear here. Course closures and lead time are already applied.' })),
      notice ? el('div', { class: `fd-notice ${notice.tone}`, text: notice.text }) : null,
      el('div', { class: 'fd-walkin-form' },
        el('label', {}, el('span', { text: 'Reservation holder' }), holder),
        el('label', {}, el('span', { text: 'Party size' }), size),
        el('label', { class: 'wide' }, el('span', { text: 'Available slot' }), slot),
        el('label', { class: 'fd-check wide' }, immediate, el('span', {},
          el('strong', { text: 'Check in immediately' }),
          el('small', { text: 'Turn off to create the booking now and serve the party later.' }))),
      ),
      el('div', { class: 'fd-walkin-actions' },
        button('Back to arrivals', () => { tab = 'arrivals'; notice = null; render(); }),
        createButton,
      ),
    );
  }

  function render() {
    if (root.style.display === 'none' || !app.state) return;
    const cal = calendarOf(app.state.clock.minutes);
    const summary = operationsSummary(app.state, cal.dayAbs);
    if (tab === 'arrivals' && selectedId == null) selectedId = dueForCheckIn(app.state)[0]?.id ?? null;
    const reservation = currentReservation();
    const children = [
      el('header', { class: 'fd-header' },
        el('div', { class: 'fd-brand' },
          el('span', { class: 'fd-crest', text: 'WC' }),
          el('span', {}, el('strong', { text: 'TEE DESK' }), el('small', { text: app.state.clubName }))),
        el('div', { class: 'fd-header-stats' },
          el('span', {}, el('small', { text: 'WAITING' }), el('strong', { text: String(summary.waiting.length) })),
          el('span', {}, el('small', { text: 'NEXT' }), el('strong', { text: summary.nextArrival ? fmtSlot(summary.nextArrival.minute) : '-' })),
          el('span', {}, el('small', { text: 'TODAY' }), el('strong', { text: `${Math.round(summary.utilization * 100)}%` }))),
        button('Close  Esc', () => options.close?.(), 'close')),
      el('div', { class: 'fd-tabs' },
        button('Arrivals & check-in', () => { tab = 'arrivals'; notice = null; render(); }, tab === 'arrivals' ? 'tab on' : 'tab'),
        button('Walk-in booking', () => { tab = 'walk-in'; notice = null; render(); }, tab === 'walk-in' ? 'tab on' : 'tab')),
      tab === 'walk-in'
        ? el('div', { class: 'fd-body fd-walkin-body' }, queuePanel(), walkInPanel())
        : el('div', { class: 'fd-body' },
          queuePanel(),
          reservation ? reservationDetails(reservation) : el('div', { class: 'fd-no-selection' },
            el('span', { class: 'fd-no-selection-mark', text: '✓' }),
            el('h2', { text: 'Front desk clear' }),
            el('p', { text: 'Open the walk-in tab to assign a real available slot, or wait for the next scheduled arrival.' }),
            summary.nextArrival ? el('div', { class: 'fd-next-card' },
              el('span', { text: 'NEXT EXPECTED' }),
              el('strong', { text: summary.nextArrival.reservationHolder }),
              el('small', { text: `${fmtSlot(summary.nextArrival.minute)} · ${summary.nextArrival.partySize} players` })) : null,
          )),
      receiptPanel(),
    ].filter(Boolean);
    content.replaceChildren(...children);
    renderedSignature = stateSignature();
  }

  function open(reservationId = null) {
    selectedId = reservationId ?? dueForCheckIn(app.state)[0]?.id ?? null;
    tab = 'arrivals';
    confirm = null;
    notice = null;
    showReceipt = null;
    swipeMessage = 'Start at the top and swipe down';
    cashDrawerOpen = false;
    root.style.display = 'flex';
    render();
  }

  function close() {
    // Closing is not a transaction verb. A pending payment remains serializable
    // and resumes on reopen/load; the explicit Cancel payment buttons are the
    // only UI action that abandons it.
    root.style.display = 'none';
    selectedId = null;
    confirm = null;
    showReceipt = null;
    swipeGestureActive = false;
  }

  function refresh() {
    // The main loop polls once per second, but rebuilding a gesture surface in
    // the middle of pointer capture would interrupt a valid card swipe. Only
    // redraw when the operations state actually changed.
    if (!swipeGestureActive && root.style.display !== 'none' && stateSignature() !== renderedSignature) render();
  }

  return {
    root,
    open,
    close,
    refresh,
    isOpen: () => root.style.display !== 'none',
    selectedReservation: () => currentReservation(),
  };
}
